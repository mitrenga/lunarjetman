#!/usr/bin/env node
/**
 * Porovná obrazovku, kterou remake složí, s videopamětí originálu.
 *
 *   ./tools/matchscreen.mjs [--verbose]
 *
 * Staví ji **skutečným kódem, který jde do prohlížeče** —
 * `app/screenComposer.js` nakrmený snímkem z `app/gameWorker.js` —
 * a porovnává ho se snímkem z běžícího originálu
 * (`sources/media/screens/gameplay.scr`, `tools/playtrace.py`).
 *
 * ★ **V M1 tohle ještě nemá hlásit nulu, a je dobře, že ji nehlásí.** Worker
 * nikým nehýbe (fyzika je M3) a pozadí je zatím **zachycený obraz**
 * (`data/screen.json`, `tools/mkscene.py`), protože jak je popsaný terén se
 * teprve odečte (M2). Číslo, které tenhle nástroj vypíše, je proto **měřítko
 * toho, kolik práce M2 a M3 zbývá** — a musí klesat, ne růst.
 *
 * Co už nulu hlásí, je `tools/matchmenu.mjs`: menu originálu bajt po bajtu,
 * složené touž znakovou sadou a týmž `printString`.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import vm from 'node:vm';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

function loadDataFile(name) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', name+'.json'), 'utf8'));
}

/** spustí gameWorker.js v atrapě workeru a vrátí jeho první snímek */
function workerFrame(global) {
  let frame = null;
  const sandbox = {
    console, performance: {now: () => Date.now()},
    setTimeout: () => 0, clearTimeout: () => {},
    postMessage: (message) => { if (!frame) { frame = message; } },
    importScripts() {},
  };
  sandbox.self = sandbox;
  sandbox.location = {search: ''};
  const context = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'app/gameWorker.js'), 'utf8'),
                  context, {filename: 'gameWorker.js'});
  sandbox.onmessage({data: {id: 'init', initData: {headless: true, players: 1,
                                                   seed: 1, global: global}}});
  return frame;
}

function offsetOf(y, col) {
  const third = y >> 6, charRow = (y >> 3) & 7, pix = y & 7;
  return (third << 11) | (pix << 8) | (charRow << 5) | col;
}

async function main() {
  const verbose = process.argv.includes('--verbose');
  global.atob = (data) => Buffer.from(data, 'base64').toString('binary');
  await import(url.pathToFileURL(path.join(ROOT, 'app/svision/tools/nodeEnv.mjs')).href);
  const { ScreenComposer } = await import(
    url.pathToFileURL(path.join(ROOT, 'app/screenComposer.js')).href);
  const { ZXVideoRAM } = await import(
    url.pathToFileURL(path.join(ROOT, 'app/svision/js/platform/canvas2D/zx/zxVideoRAM.js')).href);

  const render = new ScreenComposer(loadDataFile('screen'), loadDataFile('sprites'),
                                    loadDataFile('font'));
  const videoRAM = new ZXVideoRAM();
  render.composeInto(videoRAM, workerFrame(loadDataFile('global')));

  const reference = fs.readFileSync(path.join(ROOT, 'sources/media/screens/gameplay.scr'));
  let bitmapDiffs = 0, attrDiffs = 0;
  for (let index = 0; index < 6144; index++) {
    if (videoRAM.bytes[index] !== reference[index]) { bitmapDiffs++; }
  }
  for (let index = 6144; index < 6912; index++) {
    if (videoRAM.bytes[index] !== reference[index]) { attrDiffs++; }
  }
  if (verbose) {
    for (let row = 0; row < 24; row++) {
      let rowDiffs = 0;
      for (let col = 0; col < 32; col++) {
        for (let line = 0; line < 8; line++) {
          const at = offsetOf(row*8 + line, col);
          if (videoRAM.bytes[at] !== reference[at]) { rowDiffs++; }
        }
      }
      console.log(`  řádek ${String(row).padStart(2)}: ${rowDiffs} rozdílů v bitmapě`);
    }
  }
  console.log(`bitmapa  6144 kontrol, ${bitmapDiffs} rozdílů`);
  console.log(`atributy  768 kontrol, ${attrDiffs} rozdílů`);
  console.log(`celkem   6912 kontrol, **${bitmapDiffs+attrDiffs} rozdílů** ` +
              `(${(100*(6912-bitmapDiffs-attrDiffs)/6912).toFixed(1)} % shoda)`);
  // M1 nečeká nulu — viz hlavička. Nástroj proto nepadá, jen měří.
}

main().catch((error) => { console.error(error); process.exit(2); });
