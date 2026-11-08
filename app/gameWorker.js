// begin code

/**
 * Lunar Jetman game worker.
 *
 * It keeps the game state, the clock and the protocol (WORKER-PROTOCOL.md);
 * the model only sends it the controls and draws what comes back.
 *
 * ★ **The state is the game's own: twenty-four entity records of twenty-four
 * bytes, $6000 to $623F.** The main loop of the original walks them through
 * IX — `$8259` does `ADD IX,DE` with `DE = $0018` and stops when IX reaches
 * `$6240` — and dispatches each one through a table of 244 handlers at
 * `$82C5`, indexed by the record's own first byte. The same byte, less one,
 * indexes the sprite table at `$BAC0`. The worker keeps exactly that shape,
 * so a port of a handler has the same bytes under it as the original
 * (sources/docs/disasm_notes.md chap. 3 and 9).
 *
 * Of those twenty-four bytes, **two are understood**: `+$00` is the type and
 * `+$07` the attribute. The rest is carried whole and untouched. That is on
 * purpose: M3 to M5 will read them one at a time out of the handlers, and
 * until then an invented meaning would be worse than none.
 *
 * ★ **Two cadences, because the original has two.** Its loop normally runs
 * all twenty-four slots, but `$8217` patches the loop's own limit — the
 * operand at `$8262` — down to `$6078`, which is **the first five slots**,
 * and `$822F` puts `$6240` back. So five slots step on one schedule and all
 * twenty-four on another, exactly the shape Sabre Wulf and Jetpac turned out
 * to have. **Which five and how often is not measured yet** (M3), so M1
 * records the fact and runs one pass per tick.
 *
 * ★ The tick is the ULA interrupt rate, 50.08 Hz. ? Whether the original is
 * tied to the frame at all is **not measured**: Sabre Wulf took two frames
 * per pass, Jetpac did not wait for the frame at all. Everything measured in
 * M3-M5 is therefore written down **per pass**, never per frame.
 *
 * **M1: the worker ticks, holds the state and moves nobody.** The physics is
 * M3, the round is M4, the enemies M5, the sound M6 — each arriving with its
 * own `match*` tool that compares it with the original.
 */

var TICK_MS = 1000*69888/3500000;     // 50.08 Hz, the ULA interrupt rate

/** $6000-$623F: twenty-four records of twenty-four bytes ($8259) */
var SLOTS = 24;
var RECORD = 24;
var TABLE = 0x6000;
/**
 * $8217 patches the loop limit down to $6078 — **the first five slots**, which
 * are ★ the four laser shots and the sound (disasm_notes.md chap. 11). So the
 * shortened pass is the lasers and the sound, and everything from Jetman
 * upwards runs on the full one. ? How often the short pass happens is not
 * measured (M3).
 */
var SHORT_LIMIT = 5;

/**
 * ★ Which slot is what, measured by comparing runs with different keys held
 * (tools/playtrace.py --dump, disasm_notes.md chap. 11):
 *
 * - **0-3** the four laser shots — they appear only while the `A`-`ENTER` row
 *   is held
 * - **4** the sound ($B950 copies a descriptor here, $B934 plays from it)
 * - **5** **Jetman** — his `+$01` is fixed at `$78`, the middle of the screen:
 *   he pushes the viewport rather than moving across it
 * - **6** **the lunar rover** ($A8FC reads ($6090) to decide whether to print
 *   YOUR LUNAR ROVER HAS BEEN DESTROYED)
 * - 7-23 ? the bomb, the bridges, the teleports and the enemies (M4/M5)
 */
var SLOT = {lasers: [0, 1, 2, 3], sound: 4, jetman: 5, rover: 6};

var state = null;
var timer = 0;
var lastTime = false;
var accumulator = 0;

/**
 * The source of randomness — **injectable from the first line of the
 * project**, not bolted on afterwards (../STANDARDS.md).
 *
 * `Math.random()` cannot be seeded, so a run made with it cannot be repeated
 * and a regression has no fingerprint to compare against
 * (../METHODOLOGY.md). This is a plain 32 bit xorshift fed by the seed of the
 * `init` message; `match*` tools replace `nextRand` wholesale and push the
 * values recorded off the original back in, call by call.
 *
 * ? Where the original takes its randomness from — Sabre Wulf used `LD A,R`
 * through a mixer — is **not measured yet** (M3). When it is, the mixer and
 * its thresholds are reproduced exactly and only the entropy going in is
 * replaced by this.
 */
var randState = 1;

function seedRand(seed) {
  randState = (seed >>> 0) || 1;
} // seedRand

function nextRand() {
  randState ^= randState << 13; randState >>>= 0;
  randState ^= randState >>> 17;
  randState ^= randState << 5;  randState >>>= 0;
  return randState & 0xFF;
} // nextRand

function reset() {
  clearTimeout(timer);
  timer = 0;
  lastTime = false;
  accumulator = 0;
  seedRand(1);
  state = {
    running: false, paused: false, headless: false,
    pass: 0,
    players: 1, player: 1,
    score: [0, 0],
    hiScore: 0,
    seed: 1,
    // ? how many lives the original starts with is **not measured**; the panel
    // shows something either side of HI whose meaning is still open
    // (sources/docs/screen_layout.md), so nothing is asserted here
    lives: [null, null],
    controls: {left: false, right: false, thrust: false, fire: false, bomb: false},
    entities: [],
    sounds: []
  };
} // reset

/**
 * Lays the entity table out the way the original has it when a life starts —
 * copied out of its memory rather than made up (data/global.json,
 * tools/mkglobal.py).
 * @param {Object} global - The parsed data/global.json.
 */
function initEntities(global) {
  state.entities = [];
  for (var slot = 0; slot < SLOTS; slot++) {
    state.entities.push(new Array(RECORD).fill(0));
  }
  var table = global && global.entityTable && global.entityTable.bytes;
  if (!table) {
    return;
  }
  var bytes = decodeBase64(table);
  for (var index = 0; index < SLOTS; index++) {
    for (var byte = 0; byte < RECORD; byte++) {
      state.entities[index][byte] = bytes[index*RECORD + byte] || 0;
    }
  }
} // initEntities

/**
 * base64 to bytes, without the DOM: the worker has neither `atob` on every
 * engine we support nor `Buffer`.
 * @param {string} text - The base64 block.
 * @returns {Array} The bytes.
 */
function decodeBase64(text) {
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var out = [];
  var buffer = 0, bits = 0;
  for (var index = 0; index < text.length; index++) {
    var value = chars.indexOf(text.charAt(index));
    if (value < 0) {
      continue;
    }
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xFF);
    }
  }
  return out;
} // decodeBase64

/**
 * The frame the model draws: the entity records in the shape the composer
 * wants them, plus everything the panel says.
 * @returns {Object} The 'frame' message.
 */
function frame() {
  return {
    id: 'frame',
    pass: state.pass,
    entities: state.entities.map((record, slot) => ({
      slot: slot,
      // ★ the first byte is the type: the index into the handler table $82C5
      // and, less one, into the sprite table $BAC0
      type: record[0],
      // ★ the eighth byte is the attribute
      attr: record[7],
      // the rest is carried whole, because its meaning is M3-M5
      raw: record.slice()
    })),
    panel: {
      score: state.score[0],
      score2: state.score[1],
      hiScore: state.hiScore,
      lives: state.lives[0],
      lives2: state.lives[1],
      player: state.player
    },
    controls: state.controls,
    sounds: state.sounds.splice(0, state.sounds.length)
  };
} // frame

/**
 * One pass over the entities — one tick.
 *
 * **M1 moves nobody.** Every handler is M3 to M5, and inventing one here
 * would mean putting an unmeasured number into the game, which is the one
 * thing this project does not do (../METHODOLOGY.md).
 */
function pass() {
  state.pass++;
  postMessage(frame());
} // pass

function schedule() {
  if (!state.running || state.paused || state.headless) {
    return;
  }
  timer = setTimeout(() => {
    var now = Date.now();
    if (lastTime === false) {
      lastTime = now;
    }
    accumulator += now - lastTime;
    lastTime = now;
    // catch up rather than drift, but never run away with it after a stall
    var steps = Math.min(Math.floor(accumulator/TICK_MS), 4);
    accumulator -= steps*TICK_MS;
    for (var step = 0; step < steps; step++) {
      pass();
    }
    schedule();
  }, TICK_MS);
} // schedule

onmessage = function(event) {
  var message = event.data;
  switch (message.id) {

    case 'init':
      reset();
      var initData = message.initData || {};
      state.headless = !!initData.headless;
      state.players = initData.players || 1;
      state.hiScore = initData.hiScore || 0;
      state.seed = initData.seed || 1;
      seedRand(state.seed);
      initEntities(initData.global);
      state.running = true;
      postMessage(frame());
      schedule();
      break;

    case 'controls':
      Object.keys(state.controls).forEach((key) => {
        if (key in message) {
          state.controls[key] = !!message[key];
        }
      });
      break;

    case 'pause':
      state.paused = true;
      clearTimeout(timer);
      lastTime = false;
      break;

    case 'continue':
      state.paused = false;
      lastTime = false;
      accumulator = 0;
      schedule();
      break;

    case 'tick':
      if (state.headless) {
        pass();
      }
      break;

    case 'reset':
      reset();
      break;

  } // switch
}; // onmessage

reset();
