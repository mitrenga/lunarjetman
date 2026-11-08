// begin code

/**
 * The one-bit beeper of the ZX Spectrum, and Lunar Jetman's ten sound routines
 * on it.
 *
 * ★ **The whole of the game's audio is one primitive and nine callers.**
 * `$B8DA` waits `C` times round a `DJNZ`, flips bit 4 of port $FE up, waits
 * `C` times again and flips it down — one square cycle, and the pitch is `C`
 * and nothing else. Everything above it is a loop that moves `C` or repeats
 * the cycle: two sweeps, four fixed tones, a warble and a noise
 * (sources/docs/disasm_notes.md chap. 8, data/sounds.json).
 *
 * ? Whether the game has **music** is the one thing still open. There is a
 * second layer — `$B922` and `$B934` play a sound out of an entity slot, and
 * `$B934` walks a table of periods, which is a tune in all but name; `$B950`
 * copies a descriptor into slot 4 and the tables at `$B95C`, `$B978`, `$B98B`
 * and `$B9A6` hold rising and falling runs of periods. Porting those needs
 * the entity handlers, so they are M4/M5 and **are not in here yet**. Until
 * then there is one bus and one volume, as in Sabre Wulf (R-024).
 *
 * Because the pitch of a beeper tone is a **count of Z80 T-states**, this
 * class does not approximate the routines with oscillators: it runs them,
 * instruction by instruction, keeping the clock rather than the registers, and
 * emits the very list of speaker writes the original would make.
 * tools/tracesound.py records what the original really writes to port $FE by
 * **calling each routine in a simulator**, and tools/matchsound.mjs runs this
 * file against those recordings **pulse by pulse** — so a mistake of one
 * T-state in one instruction shows up as a difference rather than as a
 * slightly wrong note.
 *
 * The output goes to the svision pulse handlers in the shape they take
 * ({fragments, pulses}), which is the same shape the machine produces: a list
 * of how long the speaker stayed where it was. Nothing is sampled.
 *
 * Deliberately free of DOM and Node dependencies, so an offline tool
 * can synthesize with the very same code.
 */

/** the Z80 in a ZX Spectrum, hw_notes.md */
const CLOCK = 3500000;

/**
 * T-states of the instructions these routines are made of. They are the
 * machine's, not the game's, so they are here rather than in a data file —
 * but they are what decides the pitch, so tools/matchsound.js checks every one
 * of them against the original pulse by pulse.
 */
const T = {
  ld_a_n: 7, ld_r_r: 4, ld_a_nn: 13, ld_rr_nn: 10, ld_a_ix: 19, add_a_ix: 19,
  ld_r_hl: 7, ld_hl_r: 7, inc_hl: 6, dec_hl: 6, inc_de: 6, dec_bc: 6,
  inc_at_hl: 11, alu_r: 4, alu_n: 7, rot_a: 4, daa: 4, cpl: 4,
  add_hl_rr: 11, push: 11, pop: 10, call: 17, ret: 10, ret_cc_taken: 11,
  ret_cc_skipped: 5, jp: 10, jr_taken: 12, jr_skipped: 7, bit_r: 8,
  out_n_a: 11, in_a_n: 11, di: 4, ei: 4,
  /** and the moment inside OUT (n),A at which the write reaches the ULA */
  out_write: 12,
  /** DJNZ: 13 T while it loops, 8 on the pass that leaves */
  djnz_taken: 13, djnz_skipped: 8
};

/** `DJNZ $` run to exhaustion from B — and B = 0 means 256, as always on a Z80 */
function djnz(b) {
  const count = b || 256;
  return T.djnz_taken*(count-1)+T.djnz_skipped;
} // djnz

/** `DAA` after `OR n`, which leaves N=0, H=0 and C=0 — so it is the plain adjust */
function daa(value) {
  let result = value;
  if ((result & 0x0F) > 9) { result += 0x06; }
  if (result > 0x9F) { result += 0x60; }
  return result & 0xFF;
} // daa

/** `RLCA` n times */
function rotateLeft(value, times) {
  let result = value;
  for (let i = 0; i < times; i++) { result = ((result << 1) | (result >> 7)) & 0xFF; }
  return result;
} // rotateLeft

/** `RRCA` n times */
function rotateRight(value, times) {
  let result = value;
  for (let i = 0; i < times; i++) { result = ((result >> 1) | (result << 7)) & 0xFF; }
  return result;
} // rotateRight

/**
 * One run of one of the original's audio routines: the clock, and the writes
 * to port $FE it made on the way.
 */
class Run {

  constructor() {
    /** T-states since the routine was entered */
    this.t = 0;
    /** every OUT ($FE),A the routine did: {t, value} */
    this.writes = [];
  } // constructor

  /** advance the clock without touching the speaker */
  wait(tstates) {
    this.t += tstates;
  } // wait

  /** `OUT ($FE),A` — the write lands part way into the instruction */
  out(value) {
    this.writes.push({t: this.t+T.out_write, value: value});
    this.t += T.out_n_a;
  } // out

} // class Run

export class Beeper {

  static get CLOCK() { return CLOCK; }

  /**
   * @param {Object} sounds - The parsed data/sounds.json (tools/tracesound.py).
   */
  constructor(sounds) {
    this.sounds = sounds;
    this.speakerOn = 0x10;
    this.speakerOff = 0x00;
  } // constructor

  // -------------------------------------------------------------------------
  // The primitive everything else is made of
  // -------------------------------------------------------------------------

  /**
   * `$B8DA` — one square cycle, and the pitch is C and nothing else.
   *
   * ```
   * $B8DA  LD B,C          ; C is the half period
   * $B8DB  DJNZ $B8DB      ; silence
   * $B8DD  LD A,$10
   * $B8DF  OUT ($FE),A     ; speaker up
   * $B8E1  LD B,C
   * $B8E2  DJNZ $B8E2
   * $B8E4  XOR A
   * $B8E5  OUT ($FE),A     ; speaker down
   * $B8E7  RET
   * ```
   * @param {Run} run - The run being clocked.
   * @param {number} c - The half period; 0 means 256, as on the Z80.
   */
  pulse(run, c) {
    run.wait(T.ld_r_r);                             // $B8DA LD B,C
    run.wait(djnz(c));                              // $B8DB DJNZ
    run.wait(T.ld_a_n);                             // $B8DD LD A,$10
    run.out(this.speakerOn);                        // $B8DF OUT ($FE),A
    run.wait(T.ld_r_r);                             // $B8E1 LD B,C
    run.wait(djnz(c));                              // $B8E2 DJNZ
    run.wait(T.alu_r);                              // $B8E4 XOR A
    run.out(this.speakerOff);                       // $B8E5 OUT ($FE),A
    run.wait(T.ret);                                // $B8E7 RET
  } // pulse

  /**
   * `$B8E8` — B cycles of the period in C. The count comes out of B and is
   * copied into D, so B is spent and C is not.
   * @param {Run} run - The run being clocked.
   * @param {number} b - How many cycles; 0 means 256.
   * @param {number} c - The half period.
   */
  cycles(run, b, c) {
    run.wait(T.ld_r_r);                             // $B8E8 LD D,B
    run.wait(T.push);                               // $B8E9 PUSH BC
    const count = b || 256;
    for (let i = 0; i < count; i++) {
      run.wait(T.call);                             // $B8EA CALL $B8DA
      this.pulse(run, c);
      run.wait(T.alu_r);                            // $B8ED DEC D
      run.wait(i+1 < count ? T.jr_taken : T.jr_skipped);   // $B8EE JR NZ
    }
    run.wait(T.pop);                                // $B8F0 POP BC
    run.wait(T.ret);                                // $B8F1 RET
  } // cycles

  // -------------------------------------------------------------------------
  // The nine sounds
  // -------------------------------------------------------------------------

  /**
   * `$B8A8` — the half period grows from $08 to $37, so the **pitch falls**.
   * @param {Run} run - The run being clocked.
   */
  sweepDown(run) {
    run.wait(T.ld_a_n);                             // $B8A8 LD C,$08
    for (let c = 0x08; c < 0x38; c++) {
      run.wait(T.call);                             // $B8AA CALL $B8DA
      this.pulse(run, c);
      run.wait(T.alu_r);                            // $B8AD INC C
      run.wait(T.ld_r_r);                           // $B8AE LD A,C
      run.wait(T.alu_n);                            // $B8AF CP $38
      run.wait(c+1 < 0x38 ? T.jr_taken : T.jr_skipped);    // $B8B1 JR NZ
    }
    run.wait(T.ret);                                // $B8B3 RET
  } // sweepDown

  /**
   * `$B8B4` — the half period falls from $38 to 1, so the **pitch rises**.
   * @param {Run} run - The run being clocked.
   */
  sweepUp(run) {
    run.wait(T.ld_a_n);                             // $B8B4 LD C,$38
    for (let c = 0x38; c > 0; c--) {
      run.wait(T.call);                             // $B8B6 CALL $B8DA
      this.pulse(run, c);
      run.wait(T.alu_r);                            // $B8B9 DEC C
      run.wait(c-1 > 0 ? T.jr_taken : T.jr_skipped);       // $B8BA JR NZ
    }
    run.wait(T.ret);                                // $B8BC RET
  } // sweepUp

  /**
   * The shared tail of the four fixed tones, `$B8CD`: D cycles of period C.
   * @param {Run} run - The run being clocked.
   * @param {number} d - How many cycles.
   * @param {number} c - The half period.
   */
  toneTail(run, d, c) {
    const count = d || 256;
    for (let i = 0; i < count; i++) {
      run.wait(T.call);                             // $B8CD CALL $B8DA
      this.pulse(run, c);
      run.wait(T.alu_r);                            // $B8D0 DEC D
      run.wait(i+1 < count ? T.jr_taken : T.jr_skipped);   // $B8D1 JR NZ
    }
    run.wait(T.ret);                                // $B8D3 RET
  } // toneTail

  /**
   * One of the four fixed tones. ★ Three of them jump into the shared tail,
   * `toneC` **falls through** into it — which costs it the twelve T-states of
   * the `JR` the others pay, and that is audible as a different first pulse.
   * @param {Run} run - The run being clocked.
   * @param {string} name - 'toneA', 'toneB', 'toneC' or 'toneD'.
   */
  tone(run, name) {
    const table = {
      toneA: {d: 0x20, c: 0x50, jump: true},        // $B8BD
      toneB: {d: 0x30, c: 0x40, jump: true},        // $B8C3
      toneC: {d: 0x40, c: 0x30, jump: false},       // $B8C9, falls through
      toneD: {d: 0x10, c: 0x60, jump: true}         // $B8D4
    }[name];
    if (!table) {
      return;
    }
    run.wait(T.ld_a_n);                             // LD D,n
    run.wait(T.ld_a_n);                             // LD C,n
    if (table.jump) {
      run.wait(T.jr_taken);                         // JR $B8CD
    }
    this.toneTail(run, table.d, table.c);
  } // tone

  /**
   * `$B8FF` — the noise. The half period is mixed out of the loop counter
   * (`DAA / XOR $F0 / RLCA`) and out of a **game variable, `$5E42`**, rotated
   * right three times and masked with $60. So it is not random at all: it is
   * a function of where the game is, which is why the noise changes as the
   * game runs.
   * @param {Run} run - The run being clocked.
   * @param {number} rand - The byte at $5E42.
   */
  noise(run, rand) {
    run.wait(T.ld_a_n);                             // $B8FF LD D,$07
    for (let d = 0x07; d > 0; d--) {
      run.wait(T.ld_r_r);                           // $B901 LD A,D
      let value = daa(d);                           // $B902 DAA
      run.wait(T.daa);
      value ^= 0xF0;                                // $B903 XOR $F0
      run.wait(T.alu_n);
      value = rotateLeft(value, 1);                 // $B905 RLCA
      run.wait(T.rot_a);
      let c = value;                                // $B906 LD C,A
      run.wait(T.ld_r_r);
      let mix = rand & 0xFF;                        // $B907 LD A,($5E42)
      run.wait(T.ld_a_nn);
      mix = rotateRight(mix, 3);                    // $B90A RRCA x3
      run.wait(T.rot_a*3);
      mix &= 0x60;                                  // $B90D AND $60
      run.wait(T.alu_n);
      c ^= mix;                                     // $B90F XOR C
      run.wait(T.alu_r);
      run.wait(T.ld_r_r);                           // $B910 LD C,A
      run.wait(T.call);                             // $B911 CALL $B8DA
      this.pulse(run, c & 0xFF);
      run.wait(T.alu_r);                            // $B914 DEC D
      run.wait(d-1 > 0 ? T.jr_taken : T.jr_skipped);       // $B915 JR NZ
    }
    run.wait(T.ret);                                // $B917 RET
  } // noise

  /**
   * `$B918` — the warble: the half period alternates between C and its own
   * complement, so the tone jumps between two pitches every cycle.
   * @param {Run} run - The run being clocked.
   * @param {number} c - The starting half period.
   * @param {number} d - How many cycles.
   */
  warble(run, c, d) {
    const count = d || 256;
    let period = c;
    for (let i = 0; i < count; i++) {
      run.wait(T.call);                             // $B918 CALL $B8DA
      this.pulse(run, period);
      run.wait(T.ld_r_r);                           // $B91B LD A,C
      period = (~period) & 0xFF;                    // $B91C CPL
      run.wait(T.cpl);
      run.wait(T.ld_r_r);                           // $B91D LD C,A
      run.wait(T.alu_r);                            // $B91E DEC D
      run.wait(i+1 < count ? T.jr_taken : T.jr_skipped);   // $B91F JR NZ
    }
    run.wait(T.ret);                                // $B921 RET
  } // warble

  /**
   * Runs one of the game's sound routines and returns what it wrote to the
   * speaker.
   * @param {string} name - The routine's name in data/sounds.json.
   * @param {Object} [params] - What the routine reads out of the machine:
   *        `c` (the half period), `b` / `d` (how many cycles), `rand` (the
   *        byte at $5E42 the noise mixes in).
   * @returns {Object} {writes, tstates} — every OUT ($FE),A and how long the
   *          routine took, both counted from the moment it was entered.
   */
  effect(name, params) {
    const run = new Run();
    const values = params || {};
    switch (name) {
      case 'pulse':
        this.pulse(run, values.c);
        break;
      case 'cycles':
        this.cycles(run, values.b, values.c);
        break;
      case 'sweepDown':
        this.sweepDown(run);
        break;
      case 'sweepUp':
        this.sweepUp(run);
        break;
      case 'toneA':
      case 'toneB':
      case 'toneC':
      case 'toneD':
        this.tone(run, name);
        break;
      case 'noise':
        this.noise(run, values.rand || 0);
        break;
      case 'warble':
        this.warble(run, values.c, values.d);
        break;
      default:
        return {writes: [], tstates: 0};
    }
    return {writes: run.writes, tstates: run.t};
  } // effect

  // -------------------------------------------------------------------------
  // From the speaker to the loudspeaker
  // -------------------------------------------------------------------------

  /**
   * Turns the writes a run made into the list of pulse lengths the svision
   * handlers play: how long the speaker stayed where it was, starting from
   * down — which is where a ZX Spectrum's speaker sits when nothing is playing.
   *
   * A write of the value the speaker already holds is not an edge and makes no
   * pulse. That happens for real: the music player writes zero at the top of
   * every cycle, and on the very first one the speaker is already at zero.
   *
   * @param {Object} run - What effect() or tune() returned.
   * @returns {Array} Pulse lengths in T-states, the first at speaker down.
   */
  static pulses(run) {
    const lengths = [];
    let level = 0;
    let last = 0;
    run.writes.forEach((write) => {
      const value = (write.value & 0x10) ? 1 : 0;
      if (value === level) { return; }
      lengths.push(write.t-last);
      last = write.t;
      level = value;
    });
    if (run.tstates > last) { lengths.push(run.tstates-last); }
    return lengths;
  } // pulses

  /**
   * And those pulse lengths in the shape the svision pulse handlers take.
   * Rounding is carried from one pulse to the next rather than done on each,
   * so a long tune does not drift away from the original's clock.
   *
   * ★ The svision processor plays the **first** fragment with the speaker up,
   * and `pulses()` begins with the speaker down: its first length is the lead
   * from the routine's entry to the first OUT. So the lead is not a fragment;
   * it only moves the clock. A run with no OUT at all — a footstep that is
   * not the eighth — is one lead and nothing else, and that is no sound:
   * played as a fragment it would be one or two samples at full volume, a
   * click on every frame Sabreman walks (audible on an iPhone speaker,
   * 2026-09-10).
   *
   * @param {Array} lengths - Pulse lengths in T-states, the first of them low.
   * @param {number} sampleRate - The audio context's sample rate.
   * @param {number} volume - Bus volume level.
   * @returns {Object|boolean} svision pulse data {fragments, pulses, volume},
   *          or false when the speaker never moves.
   */
  static audioData(lengths, sampleRate, volume) {
    if (lengths.length < 2) {
      return false;
    }
    const fragments = [];
    const index = new Map();
    const pulses = [];
    let tstates = lengths[0];
    let written = Math.round(tstates*sampleRate/CLOCK);
    for (let i = 1; i < lengths.length; i++) {
      tstates += lengths[i];
      const target = Math.round(tstates*sampleRate/CLOCK);
      const samples = Math.max(1, target-written);
      written += samples;
      if (!index.has(samples)) {
        index.set(samples, fragments.length);
        fragments.push(samples);
      }
      pulses.push(index.get(samples));
    }
    return {fragments: fragments, pulses: pulses, volume: volume};
  } // audioData


} // class Beeper
