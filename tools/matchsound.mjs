#!/usr/bin/env node
/**
 * Porovná zvuk remaku se zvukem originálu **pulz po pulzu**.
 *
 *   ./tools/matchsound.mjs [--verbose]
 *
 * `app/beeper.js` je port zvukových rutin originálu **instrukci po instrukci
 * v T-stavech Z80**; `data/sounds.json` je záznam týchž rutin zavolaných
 * přímo v simulátoru (`tools/tracesound.py`). Tenhle nástroj je pustí proti
 * sobě a kontroluje **každou hranu reproduktoru**: její čas v T-stavech i to,
 * kam se reproduktor pohnul.
 *
 * ★ Proto se to měří v T-stavech a ne v milisekundách: výška tónu na ZX
 * Spectru **je** délka smyčky `DJNZ`. Chyba o jeden T-stav v jedné instrukci
 * se tady projeví jako rozdíl, ne jako trochu jiný tón.
 *
 * Akceptační kritérium M6: nula rozdílů.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

/** z názvu v data/sounds.json na jméno rutiny a její vstupy */
function callOf(sound) {
  const name = sound.name.split('.')[0];
  const registers = sound.registers || {};
  return {
    name: name,
    params: {
      b: registers.B, c: registers.C, d: registers.D,
      rand: registers['@5E42'] || 0
    }
  };
}

async function main() {
  const verbose = process.argv.includes('--verbose');
  global.atob = (data) => Buffer.from(data, 'base64').toString('binary');
  await import(url.pathToFileURL(path.join(ROOT, 'app/svision/tools/nodeEnv.mjs')).href);
  const { Beeper } = await import(
    url.pathToFileURL(path.join(ROOT, 'app/beeper.js')).href);

  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/sounds.json'), 'utf8'));
  const beeper = new Beeper(data);

  let checks = 0, diffs = 0;
  data.sounds.forEach((sound) => {
    const call = callOf(sound);
    const run = beeper.effect(call.name, call.params);
    // hrany: zápis, který reproduktorem nepohne, hrana není
    const edges = [];
    let level = 0;
    run.writes.forEach((write) => {
      const value = (write.value & 0x10) ? 1 : 0;
      if (value !== level) { edges.push([write.t, value]); level = value; }
    });

    let local = 0;
    checks++;
    if (edges.length !== sound.edges.length) {
      local++;
      console.log(`  ${sound.name}: hran ${edges.length}, originál ` +
                  `${sound.edges.length}`);
    }
    const count = Math.min(edges.length, sound.edges.length);
    for (let index = 0; index < count; index++) {
      checks += 2;
      if (edges[index][0] !== sound.edges[index][0]) {
        local++;
        if (verbose || local < 4) {
          const delta = edges[index][0]-sound.edges[index][0];
          console.log(`  ${sound.name} hrana ${index}: T ${edges[index][0]}, ` +
                      `originál ${sound.edges[index][0]} (${delta > 0 ? '+' : ''}${delta})`);
        }
      }
      if (edges[index][1] !== sound.edges[index][1]) { local++; }
    }
    checks++;
    if (run.tstates !== sound.tstates) {
      local++;
      console.log(`  ${sound.name}: délka ${run.tstates} T, ` +
                  `originál ${sound.tstates} T`);
    }
    diffs += local;
    if (verbose) {
      console.log(`  ${sound.name.padEnd(12)} ${edges.length} hran, ` +
                  `${local} rozdílů`);
    }
  });

  console.log(`${checks} kontrol, **${diffs} rozdílů**`);
  process.exit(diffs ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(2); });
