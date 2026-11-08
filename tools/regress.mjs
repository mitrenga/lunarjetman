#!/usr/bin/env node
/**
 * regress — otisk průletu proti minulému běhu.
 *
 *   ./tools/regress.mjs [--passes N] [--seed N] [--update] [--verbose]
 *
 * ★ **Tohle není `match`.** `match*` se ptá „sedíme na originál?" a potřebuje
 * k tomu zlatý záznam z emulátoru. `regress` se ptá „nerozbila dnešní změna
 * včerejšek?" a potřebuje jen **determinismus a otisk** — dá se proto pustit
 * i na úplně rozdělané hře (`../../METHODOLOGY.md`).
 *
 * Co se otiskuje:
 *
 * 1. **posloupnost seedovaného generátoru** — kdyby se změnil, rozejdou se
 *    všechny průlety a nic jiného by to nechytlo;
 * 2. **stav workeru** po N průchodech — celá tabulka entit, 24 slotů po
 *    24 bajtech;
 * 3. **videopaměť, kterou složí `app/screenComposer.js`** — a to ★ z paměti,
 *    **ne z canvasu**: do otisku z canvasu by propadla bordura a vyhlazování
 *    (`../../METHODOLOGY.md`).
 *
 * Otisk se drží v `tools/regress.baseline.json` a **commituje se**. `--update`
 * ho přepíše; dělá se to vědomě, když se změna do otisku promítnout má.
 *
 * ★ Že dnes worker nikým nehýbe, regresu nevadí — hlídá `screenComposer.js`,
 * data v `data/` a cestu z workeru na obrazovku, což je přesně to, co rozbije
 * změna ve svision.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import vm from 'node:vm';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const BASELINE = path.join(HERE, 'regress.baseline.json');

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', name+'.json'), 'utf8'));
}

function digest(bytes) {
  return crypto.createHash('sha256').update(Buffer.from(bytes)).digest('hex').slice(0, 32);
}

/** spustí app/gameWorker.js v atrapě workeru */
function startWorker(onMessage) {
  const sandbox = {
    console, performance: {now: () => Date.now()},
    setTimeout: () => 0, clearTimeout: () => {},
    postMessage: onMessage, importScripts() {},
  };
  sandbox.self = sandbox;
  sandbox.location = {search: ''};
  const context = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'app/gameWorker.js'), 'utf8'),
                  context, {filename: 'gameWorker.js'});
  return sandbox;
}

async function main() {
  const args = process.argv.slice(2);
  const passes = args.includes('--passes')
    ? parseInt(args[args.indexOf('--passes')+1], 10) : 300;
  const seed = args.includes('--seed')
    ? parseInt(args[args.indexOf('--seed')+1], 10) : 0xC0DE;
  const update = args.includes('--update');
  const verbose = args.includes('--verbose');

  global.atob = (data) => Buffer.from(data, 'base64').toString('binary');
  await import(url.pathToFileURL(path.join(ROOT, 'app/svision/tools/nodeEnv.mjs')).href);
  const { ScreenComposer } = await import(
    url.pathToFileURL(path.join(ROOT, 'app/screenComposer.js')).href);
  const { ZXVideoRAM } = await import(
    url.pathToFileURL(path.join(ROOT, 'app/svision/js/platform/canvas2D/zx/zxVideoRAM.js')).href);
  const { JetmanPhysics } = await import(
    url.pathToFileURL(path.join(ROOT, 'app/jetmanPhysics.js')).href);

  // 1. generátor: stejný seed musí dát stejnou posloupnost
  const worker = startWorker(() => {});
  worker.onmessage({data: {id: 'init', initData: {headless: true, players: 1,
                                                  seed: seed, global: load('global')}}});

  // 2. stav workeru po N průchodech
  const frames = [];
  const sandbox = startWorker((message) => frames.push(message));
  sandbox.onmessage({data: {id: 'init', initData: {headless: true, players: 1,
                                                   seed: seed, global: load('global')}}});
  for (let pass = 0; pass < passes; pass++) {
    sandbox.onmessage({data: {id: 'tick'}});
  }
  const last = frames[frames.length-1];
  const state = Buffer.from(last.entities.flatMap((e) => e.raw));

  // 3. videopaměť, kterou složí skutečný composer — z paměti, ne z canvasu
  const render = new ScreenComposer(load('screen'), load('sprites'), load('font'),
                                    load('terrain'), load('panel'));
  const videoRAM = new ZXVideoRAM();
  render.composeInto(videoRAM, Object.assign({worldX: 72,
    panel: {score: 0, score2: 0, hiScore: 105140, leftCount: 'L00',
            rightCount: 'L00', counter: 4}}, last));

  // 4. fyzika: pár kroků ze známého stavu, ať se pozná změna v jetmanPhysics
  const record = new Array(24).fill(0);
  record[0x04] = 0xA0;
  record[0x06] = 0x00;
  const physics = [];
  for (let step = 0; step < 32; step++) {
    JetmanPhysics.step(record, 0xF7, [1, 1]);     // tryska držená
    physics.push(record[0x04], record[0x05], record[0x06]);
  }

  const fingerprint = {
    passes: passes, seed: seed,
    workerPass: last.pass,
    workerState: digest(state),
    videoRAM: digest(videoRAM.bytes),
    physics: digest(physics),
  };

  if (update) {
    fs.writeFileSync(BASELINE, JSON.stringify(fingerprint, null, 1)+'\n');
    console.log('otisk zapsán do tools/regress.baseline.json');
    Object.keys(fingerprint).forEach((key) =>
      console.log(`  ${key.padEnd(12)} ${fingerprint[key]}`));
    return;
  }

  if (!fs.existsSync(BASELINE)) {
    console.log('otisk neexistuje — vyrob ho `./tools/regress.mjs --update`');
    process.exit(2);
  }
  const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  let diffs = 0;
  Object.keys(fingerprint).forEach((key) => {
    const same = baseline[key] === fingerprint[key];
    if (!same) { diffs++; }
    if (verbose || !same) {
      console.log(`  ${key.padEnd(12)} ${same ? 'sedí' : `${fingerprint[key]} != ${baseline[key]}`}`);
    }
  });
  console.log(`${Object.keys(fingerprint).length} otisků, **${diffs} rozdílů**`);
  process.exit(diffs ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(2); });
