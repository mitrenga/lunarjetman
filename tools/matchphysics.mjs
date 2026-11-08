#!/usr/bin/env node
/**
 * Přehraje záznam Jetmana z originálu **krok po kroku** proti portu
 * `app/jetmanPhysics.js`.
 *
 *   ./tools/matchphysics.mjs [--verbose] [build/physics.json]
 *
 * Záznam dělá `tools/tracephysics.py`: zastaví simulátor na dispečeru
 * `$81FB`, a když je na řadě slot 5, opíše celý 24bajtový záznam i stav
 * klávesnice. Z toho jsou trojice (stav před, klávesy) → (stav po).
 *
 * ★ Porovnávají se **jen průchody, které obsluhuje `$8D06`** (typy 1–8).
 * Typy 9–16 jede `$8C71` a ten **portovaný není** — je to zbytek M3 a
 * tvářit se, že je hotový, by bylo horší než ho vynechat.
 *
 * ★ Kontrolují se tři bajty záznamu: **`+$04` (y)**, **`+$05` (vodorovná
 * rychlost)** a **`+$06` (svislá rychlost)**. Poloha ve světě (`+$02`,
 * `+$03`) a rolování portované nejsou.
 *
 * ★ Stranou se počítají **průchody, ve kterých Jetman ze stavu 1–8 odejde**
 * (typ po průchodu je mimo rozsah — smrt, přistání, teleport). Tam obsluha
 * skočí jinam a záznam přepíše kód, který portovaný není. Nejsou to rozdíly,
 * ale **ani se neschovávají**: jejich počet je ve výpisu.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const FIELDS = [[0x04, 'y'], [0x05, 'vodorovná rychlost'], [0x06, 'svislá rychlost']];

async function main() {
  const verbose = process.argv.includes('--verbose');
  const file = process.argv.find((a) => a.endsWith('.json'))
               || path.join(ROOT, 'build/physics.json');
  global.atob = (data) => Buffer.from(data, 'base64').toString('binary');
  await import(url.pathToFileURL(path.join(ROOT, 'app/svision/tools/nodeEnv.mjs')).href);
  const { JetmanPhysics } = await import(
    url.pathToFileURL(path.join(ROOT, 'app/jetmanPhysics.js')).href);

  const trace = JSON.parse(fs.readFileSync(file, 'utf8'));
  const range = JetmanPhysics.FLYING_TYPES;
  // ★ the ground check reads the tile map — the same data the screen is drawn
  // from (data/terrain.json), which is the point: one map, two readers
  // ★ dlaždice pod Jetmanem se berou **ze záznamu**, ne ze statického
  // data/terrain.json: mapa na $7000 je pracovní paměť a hra ji za běhu mění
  // (kráter po bombě). Statická mapa je pro kreslení, ne pro kolize.

  let steps = 0, checks = 0, diffs = 0, skipped = 0, transitions = 0;
  const byField = new Map(FIELDS.map(([o, n]) => [o, 0]));
  trace.trace.forEach((entry, index) => {
    const type = entry.before[0];
    if (type < range.first || type > range.last) { skipped++; return; }
    const after = entry.after[0];
    if (after < range.first || after > range.last) { transitions++; return; }
    steps++;
    const record = entry.before.slice();
    const control = JetmanPhysics.readControls(entry.keys);
    JetmanPhysics.step(record, control, entry.tiles);
    FIELDS.forEach(([offset, name]) => {
      checks++;
      if (record[offset] !== entry.after[offset]) {
        diffs++;
        byField.set(offset, byField.get(offset)+1);
        if (verbose || diffs <= 6) {
          console.log(`  krok ${index} (typ $${type.toString(16)}, ` +
                      `control $${control.toString(16)}) ${name}: ` +
                      `$${record[offset].toString(16)} != ` +
                      `$${entry.after[offset].toString(16)}`);
        }
      }
    });
  });

  FIELDS.forEach(([offset, name]) => {
    console.log(`  ${name.padEnd(20)} ${byField.get(offset)} rozdílů z ${steps}`);
  });
  console.log(`${steps} kroků (typ 1–8), ${transitions} přechodů ven ze stavu, ` +
              `${skipped} přeskočeno (typ 9–16, obsluha $8C71 není portovaná)`);
  console.log(`${checks} kontrol, **${diffs} rozdílů**`);
  process.exit(diffs ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(2); });
