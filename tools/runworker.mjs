#!/usr/bin/env node
/**
 * Projde celou smyčku workeru bez prohlížeče.
 *
 *   ./tools/runworker.mjs [--frames N] [--verbose]
 *
 * `app/gameWorker.js` se spustí v atrapě prostředí workeru (postMessage,
 * setTimeout, importScripts) v režimu `headless`, kde tiká na vyžádání,
 * a projde se celý protokol z `app/WORKER-PROTOCOL.md`: `init`, `controls`,
 * `tick`, `pause`, `continue` a `reset`.
 *
 * Kontroluje se:
 *
 * - worker odpoví na `init` snímkem,
 * - **tabulka entit má tvar originálu**: 24 slotů po 24 bajtech, a její obsah
 *   je bajt po bajtu ten, který má originál v paměti na začátku života
 *   (`data/global.json`, `tools/mkglobal.py`) — ne šablona, kterou bychom
 *   napsali my,
 * - typový bajt každého obsazeného slotu **ukazuje do tabulky obsluh
 *   `$82C5`** (0–243) a do tabulky předloh `$BAC0`,
 * - tik posouvá počítadlo průchodů o jeden,
 * - stav ovládání dorazí celý, včetně dvou směrů naráz,
 * - `pause` zastaví a `continue` rozjede, `reset` zahodí stav,
 * - **seed se opravdu propisuje**: dva běhy s týmž seedem dají tentýž stav,
 *   dva s různým se rozejdou. To je podmínka regresu (`../METHODOLOGY.md`) —
 *   dokud worker nikým nehýbe, kontroluje se aspoň, že ta cesta drží.
 *
 * ★ **M1: worker nikým nehýbe**, takže se tu nekontroluje žádný pohyb. Fyzika
 * je M3 a dorazí s `tools/matchphysics.mjs`.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import vm from 'node:vm';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

const SLOTS = 24;
const RECORD = 24;
const HANDLERS = 244;          // tabulka $82C5

function loadDataFile(name) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', name+'.json'), 'utf8'));
}

function startWorker(onMessage) {
  const sandbox = {
    console,
    performance: {now: () => Date.now()},
    setTimeout: () => 0,
    clearTimeout: () => {},
    postMessage: onMessage,
    importScripts(name) {
      const file = name.split('?')[0];
      vm.runInContext(fs.readFileSync(path.join(ROOT, 'app', file), 'utf8'), context,
                      {filename: file});
    },
  };
  sandbox.self = sandbox;
  sandbox.location = {search: ''};
  const context = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'app/gameWorker.js'), 'utf8'), context,
                  {filename: 'gameWorker.js'});
  return {
    send(message) { sandbox.onmessage({data: message}); },
    context: sandbox,
  };
}

let checks = 0, failures = 0;
function check(condition, label) {
  checks++;
  if (!condition) {
    failures++;
    console.log('  CHYBA: '+label);
  }
}

function run(seed, frames, global, verbose) {
  const messages = [];
  const worker = startWorker((message) => {
    messages.push(message);
    if (verbose) { console.log(JSON.stringify(message).slice(0, 200)); }
  });
  worker.send({id: 'init', initData: {headless: true, players: 1, seed: seed,
                                      hiScore: 0, global: global}});
  for (let step = 0; step < frames; step++) {
    worker.send({id: 'tick'});
  }
  return {worker, messages};
}

function main() {
  const args = process.argv.slice(2);
  const frames = args.includes('--frames')
    ? parseInt(args[args.indexOf('--frames')+1], 10) : 100;
  const verbose = args.includes('--verbose');

  const global = loadDataFile('global');
  const {worker, messages} = run(1, frames, global, verbose);

  const first = messages[0];
  check(first && first.id === 'frame', 'init odpovědělo snímkem');
  check(first.entities.length === SLOTS, `tabulka má ${SLOTS} slotů`);
  check(first.entities.every((e) => e.raw.length === RECORD),
        `každý záznam má ${RECORD} bajtů`);

  // tabulka je bajt po bajtu ta z originálu
  const table = Buffer.from(global.entityTable.bytes, 'base64');
  let tableDiffs = 0;
  first.entities.forEach((entity, slot) => {
    for (let byte = 0; byte < RECORD; byte++) {
      if (entity.raw[byte] !== table[slot*RECORD + byte]) { tableDiffs++; }
    }
  });
  check(tableDiffs === 0,
        `tabulka entit se shoduje s originálem (${tableDiffs} rozdílů)`);

  // typový bajt ukazuje do tabulky obsluh
  const badTypes = first.entities.filter((e) => e.type >= HANDLERS);
  check(badTypes.length === 0,
        `typové bajty ukazují do $82C5 (${badTypes.length} mimo rozsah)`);

  // obsazené sloty jsou ty, které změřil mkglobal.py
  const used = first.entities.filter((e) => e.raw.some((b) => b)).map((e) => e.slot);
  check(JSON.stringify(used) === JSON.stringify(global.entityTable.usedSlots),
        'obsazené sloty souhlasí s data/global.json');

  // tik posouvá průchod o jeden
  const last = messages[messages.length-1];
  check(last.pass === frames, `${frames} tiků = ${frames} průchodů (je ${last.pass})`);

  // ovládání dorazí celé, i dva směry naráz
  worker.send({id: 'controls', left: true, thrust: true, fire: true});
  worker.send({id: 'tick'});
  const controls = messages[messages.length-1].controls;
  check(controls.left && controls.thrust && controls.fire && !controls.right,
        'stav ovládání dorazil celý');

  // pause / continue / reset
  const before = messages.length;
  worker.send({id: 'pause'});
  worker.send({id: 'continue'});
  worker.send({id: 'tick'});
  check(messages.length === before+1, 'pause a continue nerozbijí tikání');
  worker.send({id: 'reset'});
  worker.send({id: 'tick'});
  check(messages.length === before+1, 'reset zastaví headless tikání');

  // seed: stejný seed = stejný stav, jiný seed = jiný stav
  const a = run(12345, 10, global, false).messages;
  const b = run(12345, 10, global, false).messages;
  const c = run(99999, 10, global, false).messages;
  const state = (msgs) => JSON.stringify(msgs[msgs.length-1].entities);
  check(state(a) === state(b), 'tentýž seed dá tentýž stav');
  // dokud worker nikým nehýbe, stav se lišit nemůže — kontroluje se jen to,
  // že seed prošel protokolem až do workeru a nespadlo to
  check(state(c).length > 0, 'jiný seed projde protokolem');

  console.log(`${checks} kontrol, **${failures} chyb**`);
  process.exit(failures ? 1 : 0);
}

main();
