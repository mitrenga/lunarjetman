#!/usr/bin/env node
/**
 * Postaví menu `GAME SELECTION` **skutečným kódem, který jde do prohlížeče**,
 * a porovná ho s videopamětí originálu bajt po bajtu.
 *
 *   ./tools/matchmenu.mjs [--verbose]
 *
 * Pouští `app/screenComposer.js` — tedy `printString`, což je port `$89EF` —
 * s **vlastní znakovou sadou originálu** z `data/font.json` a s rozvržením
 * z `data/menu.json` (tabulky `$810E` a `$8115`). Referencí je
 * `sources/media/screens/menu.scr`, vlastní snímek z běžícího originálu.
 *
 * ★ **Tímhle se uzavírá otázka fontu** (`ZADANI.md` §9.7). Kdyby hra tiskla
 * ROM fontem Spectra jako Sabre Wulf a Jetpac, bitmapa by se neshodla ani
 * náhodou. Shoda na nulu rozdílů je důkaz, že znaková sada z `$D347` je ta
 * pravá — a zároveň že `printString` je opravdu port `$89EF`.
 *
 * Kontrolují se **znakové řádky 4 až 23**, tedy menu a copyright.
 * ? Panel (řádky 0–2) se zatím neskládá: jak se v originálu sází, není
 * odečtené (M2), a postavit ho od oka by znamenalo si ho vymyslet.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const FIRST_ROW = 4;
const LAST_ROW = 23;

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

  const menu = load('menu');
  const font = load('font');
  const screen = load('screen');
  const reference = fs.readFileSync(path.join(ROOT, 'sources/media/screens/menu.scr'));

  // the composer needs a background; the menu of the original is drawn over a
  // cleared screen, so the scene is only there to satisfy the constructor
  const render = new ScreenComposer(screen, null, font);
  const videoRAM = new ZXVideoRAM();

  // background: $43 across, $00 in the two edge columns (0 and 31)
  const edge = parseInt(menu.background.edgeAttr.substring(1), 16);
  const back = parseInt(menu.background.attr.substring(1), 16);
  for (let row = 0; row < 23; row++) {
    for (let col = 0; col < 32; col++) {
      videoRAM.pokeAttribute(row, col,
        menu.background.edgeColumns.includes(col) ? edge : back);
    }
  }

  // the seven menu lines out of the tables $810E and $8115
  menu.lines.forEach((line, index) => {
    let attr = parseInt(line.attr.substring(1), 16);
    // ★ the selected number of players and the selected control flash
    if (menu.selectedFlash && (index === menu.selectedLines.players
                               || index === menu.selectedLines.control)) {
      attr |= 0x80;
    }
    render.printString(videoRAM, line.col*8, line.y, line.text, attr);
  });

  // the copyright line: its attribute is the first byte of the string ($8A11)
  const copyAttr = parseInt(menu.copyright.attr.substring(1), 16);
  for (let col = 0; col < 32; col++) {
    videoRAM.pokeAttribute(menu.copyright.row, col, copyAttr);
  }
  render.printString(videoRAM, menu.copyright.col*8, menu.copyright.row*8,
                     menu.copyright.text, copyAttr);

  let bitmapChecks = 0, bitmapDiffs = 0, attrChecks = 0, attrDiffs = 0;
  for (let row = FIRST_ROW; row <= LAST_ROW; row++) {
    for (let col = 0; col < 32; col++) {
      for (let line = 0; line < 8; line++) {
        const at = offsetOf(row*8 + line, col);
        bitmapChecks++;
        if (videoRAM.bytes[at] !== reference[at]) {
          bitmapDiffs++;
          if (verbose) {
            console.log(`  bitmapa r${row} c${col} +${line}: ` +
                        `$${videoRAM.bytes[at].toString(16)} != ` +
                        `$${reference[at].toString(16)}`);
          }
        }
      }
      const attrAt = 6144 + row*32 + col;
      attrChecks++;
      if (videoRAM.bytes[attrAt] !== reference[attrAt]) {
        attrDiffs++;
        if (verbose) {
          console.log(`  atribut r${row} c${col}: ` +
                      `$${videoRAM.bytes[attrAt].toString(16)} != ` +
                      `$${reference[attrAt].toString(16)}`);
        }
      }
    }
  }

  console.log(`bitmapa  ${bitmapChecks} kontrol, **${bitmapDiffs} rozdílů**`);
  console.log(`atributy ${attrChecks} kontrol, **${attrDiffs} rozdílů**`);
  console.log(`celkem   ${bitmapChecks+attrChecks} kontrol, ` +
              `**${bitmapDiffs+attrDiffs} rozdílů**`);
  process.exit(bitmapDiffs + attrDiffs ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(2); });
