#!/usr/bin/env node
/**
 * Složí celou herní obrazovku z `data/` a porovná ji s videopamětí originálu.
 *
 *   ./tools/matchsprites.mjs [--verbose]
 *
 * ★ **Nepotřebuje k tomu fyziku.** Entity se neberou z workeru, ale
 * **z paměti běžícího originálu** — `tools/playtrace.py --dump` uloží celou
 * RAM a k ní snímek obrazovky. Z tabulky `$6000`–`$623F` se vezme typ, poloha
 * a atribut každé entity a `app/screenComposer.js` z toho postaví obraz.
 * Tím se měří **jen kreslení**, ne pohyb: M3 a M5 do toho nemají co mluvit.
 *
 * ★ Dvojice RAM + obrazovka si nástroj **vyrábí sám** jedním voláním
 * `playtrace.py`. Sbírat je z toho, co zrovna leží v `build/`, je past:
 * `ram00400.bin` a `frame00400.scr` můžou pocházet z různých průletů a pak
 * se porovnává jablko s hruškou (stalo se, 2026-09-17).
 *
 * Co se tím kontroluje:
 *
 * - tabulka předloh `$BAC0` a oba formáty spritů (`data/sprites.json`),
 * - **XOR bez masky**, řádky odspodu nahoru a posun 0–7 px za běhu,
 * - **atributy**: barva `(IX+$07)`, blok 2–3 sloupce × `(((v>>2)+1)>>1)+1`
 *   řádků, ★ jen do buněk, které **nejsou černé**, a ★ **bez zalomení**
 *   na pravém okraji (`disasm_notes.md` §14),
 * - dlaždicová krajina a panel se skóre.
 *
 * ★ Poloha na obrazovce je `(IX+$01)`, a tu si originál počítá sám:
 * `$86A1` dělá `screenX = worldX + $78 − ($607A)`, tedy **vůči Jetmanovi**,
 * který sedí napevno na `$78`. Bere se z paměti, takže se tu neověřuje ona,
 * ale to, co se z ní nakreslí.
 *
 * ## Z čeho se staví pozadí
 *
 * **Bitmapa** se staví **z černé plus terénu** — nic jiného tam originál
 * nemá, všechno ostatní jsou entity z tabulky. Kdyby se místo toho vzal
 * zachycený snímek `data/screen.json`, byly by v něm sprity už zapečené
 * a druhé nakreslení by je XORem zase smazalo.
 *
 * **Atributy** se berou z `data/screen.json`, protože ? **jak originál
 * vybarvuje oblohu, změřené není** — není jednobarevná, mění se po řádcích
 * a s posunem. Je to otevřená položka M2; do té doby se porovnává to, co
 * sprity do atributů **přidají**, ne pozadí pod nimi.
 */
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const TABLE = 0x6000, SLOTS = 24, RECORD = 24, JETMAN = 0x6078;
const PLAY_ROWS = [5, 23];      // panel je řádky 0–4, ten má svůj matchpanel

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

  const render = new ScreenComposer(load('screen'), load('sprites'), load('font'),
                                    load('terrain'), load('panel'));

  // jeden běh, jedna sada dvojic — viz hlavička
  const SHOTS = ['00400', '00700', '01000', '01200'];
  const out = path.join(ROOT, 'build', 'sprites');
  fs.mkdirSync(out, {recursive: true});
  execFileSync('python3', [path.join(ROOT, 'tools/playtrace.py'),
                           '--frames', '1250', '--out', out,
                           '--shots', SHOTS.map((s) => +s).join(','),
                           '--dump', SHOTS.map((s) => +s).join(',')],
               {stdio: 'ignore'});
  const cases = SHOTS.filter((n) => fs.existsSync(path.join(out, `ram${n}.bin`))
                                 && fs.existsSync(path.join(out, `frame${n}.scr`)));
  if (!cases.length) {
    console.log('playtrace.py nevyrobil dvojice');
    process.exit(2);
  }

  let checks = 0, diffs = 0;
  cases.forEach((name) => {
    const ram = fs.readFileSync(path.join(out, `ram${name}.bin`));
    const reference = fs.readFileSync(path.join(out, `frame${name}.scr`));
    const peek = (address) => ram[address - 0x4000];
    const worldX = peek(JETMAN + 2) | (peek(JETMAN + 3) << 8);

    const entities = [];
    for (let slot = 0; slot < SLOTS; slot++) {
      const base = TABLE + slot*RECORD;
      const raw = [];
      for (let byte = 0; byte < RECORD; byte++) { raw.push(peek(base + byte)); }
      if (!raw[0]) { continue; }
      entities.push({slot: slot, type: raw[0], x: raw[1], y: raw[4],
                     attr: raw[7], raw: raw});
    }

    // bitmapa: černá + terén; atributy: z data/screen.json (viz hlavička)
    const videoRAM = new ZXVideoRAM();
    render.clearScreen(videoRAM);
    videoRAM.bytes.fill(0, 0, 6144);
    render.drawTerrain(videoRAM, worldX);
    entities.forEach((entity) => {
      render.drawSprite(videoRAM, entity, render.spriteFor(entity.type));
    });

    let bitmap = 0, attributes = 0;
    for (let row = PLAY_ROWS[0]; row <= PLAY_ROWS[1]; row++) {
      for (let col = 0; col < 32; col++) {
        for (let line = 0; line < 8; line++) {
          const at = offsetOf(row*8 + line, col);
          checks++;
          if (videoRAM.bytes[at] !== reference[at]) { bitmap++; }
        }
        const attrAt = 6144 + row*32 + col;
        checks++;
        if (videoRAM.bytes[attrAt] !== reference[attrAt]) { attributes++; }
      }
    }
    diffs += bitmap + attributes;
    const rows = PLAY_ROWS[1]-PLAY_ROWS[0]+1;
    console.log(`  ram${name}: ${String(entities.length).padStart(2)} entit, ` +
                `bitmapa ${String(bitmap).padStart(4)}/${rows*32*8}, ` +
                `atributy ${String(attributes).padStart(3)}/${rows*32} ` +
                `(${(100*(rows*32*9-bitmap-attributes)/(rows*32*9)).toFixed(1)} % shoda)`);
    if (verbose) {
      entities.forEach((e) => console.log(`     slot ${e.slot} typ $${e.type.toString(16)} ` +
                                          `x ${e.x} y ${e.y} attr $${e.attr.toString(16)}`));
    }
  });

  console.log(`${cases.length} snímků, ${checks} kontrol, **${diffs} rozdílů** ` +
              `(${(100*(checks-diffs)/checks).toFixed(1)} % shoda)`);
}

main().catch((error) => { console.error(error); process.exit(2); });
