#!/usr/bin/env node
/**
 * Porovná měsíční krajinu, kterou remake složí, s videopamětí originálu.
 *
 *   ./tools/matchterrain.mjs [--verbose]
 *
 * Staví ji **skutečným kódem, který jde do prohlížeče** —
 * `ScreenComposer.drawTerrain()` z `data/terrain.json` — a porovnává ji
 * s vlastními snímky z běžícího originálu.
 *
 * ★ Referenční snímek je `sources/media/screens/gameplay.scr`, na kterém
 * **terén nikdo nezakrývá**: tam se čeká **nula rozdílů ve všech 32
 * sloupcích řádku 22**, tedy 256 bajtů bitmapy.
 *
 * Nástroj si posun i polohu ve světě **nebere odjinud, hledá je**: projde
 * všech 1328 sloupců mapy a osm posunů a najde ten, na kterém se to shodne.
 * Tím se zároveň kontroluje tvrzení z `disasm_notes.md` §13, že posun je
 * `worldX & 7` a že výřez začíná na `(worldX >> 3) − 15`.
 *
 * Akceptační kritérium M2 pro terén: nula rozdílů na nezakrytém snímku.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const ROW = 22;

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

  const terrain = load('terrain');
  const render = new ScreenComposer(load('screen'), null, null, terrain);
  const reference = fs.readFileSync(path.join(ROOT, 'sources/media/screens/gameplay.scr'));

  // najdi worldX, na kterém to sedí nejlíp — nebere se odjinud, hledá se
  let best = {diffs: 6912, worldX: -1};
  for (let column = 0; column < terrain.map.length; column++) {
    for (let shift = 0; shift < 8; shift++) {
      const worldX = column*8 + shift;
      const videoRAM = new ZXVideoRAM();
      render.drawTerrain(videoRAM, worldX);
      let diffs = 0;
      for (let col = 0; col < 32 && diffs <= best.diffs; col++) {
        for (let line = 0; line < 8; line++) {
          const at = offsetOf(ROW*8 + line, col);
          if (videoRAM.bytes[at] !== reference[at]) { diffs++; }
        }
      }
      if (diffs < best.diffs) { best = {diffs: diffs, worldX: worldX}; }
      if (!best.diffs) { break; }
    }
    if (!best.diffs) { break; }
  }

  console.log(`nalezené worldX = ${best.worldX} ` +
              `(sloupec mapy ${best.worldX >> 3}, posun ${best.worldX & 7})`);
  if (verbose) {
    console.log(`  Jetmanův sloupec by podle §13 byl ` +
                `${(best.worldX >> 3) + terrain.jetmanColumn}`);
  }
  console.log(`řádek ${ROW}: 256 kontrol, **${best.diffs} rozdílů**`);
  process.exit(best.diffs ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(2); });
