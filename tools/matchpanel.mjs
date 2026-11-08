#!/usr/bin/env node
/**
 * Porovná panel se skóre **skutečným kódem, který jde do prohlížeče**,
 * se snímky z běžícího originálu — bajt po bajtu.
 *
 *   ./tools/matchpanel.mjs [--verbose]
 *
 * Staví ho `ScreenComposer.drawPanel()` z `data/panel.json` a `data/font.json`,
 * tedy **vlastní znakovou sadou originálu** (`$D347`) a portem `$89EF`.
 * Referencí jsou tři nezávislé snímky **z `sources/media/screens/`**, tedy
 * commitnuté vlastní záznamy z běžícího originálu, ne průběžný výstup
 * v `build/`: menu, hra krátce po startu a hra později. Vyrábí je
 * `./tools/playtrace.py --frames 1250 --shots 40,400,1200`.
 *
 * ★ Kontrolují se **znakové řádky 0 a 1**, tedy 512 bajtů bitmapy a 64
 * atributů na snímek. To je týž rozsah, jaký má `matchpanel` u sourozenců
 * (sabrewulf: tři snímky, 512 B + 64 B, nula rozdílů).
 *
 * ? Řádky 2 až 4 — pás `TRUCK` / `FUEL` / `TIME` / `BASE` — tady nejsou:
 * jejich labely nejsou glyfy téhle sady a proužky se hýbou. Je to zbytek M2.
 *
 * Akceptační kritérium M1: nula rozdílů.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const ROWS = [0, 1];

// (snímek, co je na něm vidět) — hodnoty jsou odečtené z toho snímku, stejně
// jako je odečítá matchpanel v sabrewulf
const FRAMES = [
  ['sources/media/screens/panel_00040.scr',
   {score: 0, hiScore: 105140, score2: 0, leftCount: 'L00', rightCount: 'L00',
    counter: null}],
  ['sources/media/screens/panel_00400.scr',
   {score: 0, hiScore: 105140, score2: 0, leftCount: 'L00', rightCount: 'L00',
    counter: 4}],
  ['sources/media/screens/panel_01200.scr',
   {score: 0, hiScore: 105140, score2: 0, leftCount: 'L00', rightCount: 'L00',
    counter: 2}],
];

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', name+'.json'), 'utf8'));
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

  const render = new ScreenComposer(load('screen'), null, load('font'), null,
                                    load('panel'));

  let checks = 0, diffs = 0, frames = 0;
  FRAMES.forEach(([name, state]) => {
    const file = path.join(ROOT, name);
    if (!fs.existsSync(file)) {
      console.log(`  (chybí ${name} — přeskočeno)`);
      return;
    }
    frames++;
    const reference = fs.readFileSync(file);
    const videoRAM = new ZXVideoRAM();
    render.drawPanel(videoRAM, state);
    let local = 0;
    ROWS.forEach((row) => {
      for (let col = 0; col < 32; col++) {
        for (let line = 0; line < 8; line++) {
          const at = offsetOf(row*8 + line, col);
          checks++;
          if (videoRAM.bytes[at] !== reference[at]) {
            local++;
            if (verbose || local <= 4) {
              console.log(`  ${path.basename(name)} bitmapa r${row} c${col} ` +
                          `+${line}: $${videoRAM.bytes[at].toString(16)} != ` +
                          `$${reference[at].toString(16)}`);
            }
          }
        }
        const attrAt = 6144 + row*32 + col;
        checks++;
        if (videoRAM.bytes[attrAt] !== reference[attrAt]) {
          local++;
          if (verbose || local <= 4) {
            console.log(`  ${path.basename(name)} atribut r${row} c${col}: ` +
                        `$${videoRAM.bytes[attrAt].toString(16)} != ` +
                        `$${reference[attrAt].toString(16)}`);
          }
        }
      }
    });
    console.log(`  ${path.basename(name).padEnd(20)} ${local} rozdílů`);
    diffs += local;
  });

  console.log(`${frames} snímky, ${checks} kontrol, **${diffs} rozdílů**`);
  process.exit(diffs ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(2); });
