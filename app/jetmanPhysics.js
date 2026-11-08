// begin code

/**
 * Jetman's physics — the port of the original's own handler `$8D06`.
 *
 * ★ **Every number in here is the operand of an actual instruction**, and
 * every one is checked against runs recorded off the original
 * (tools/tracephysics.py, tools/matchphysics.mjs). Nothing is tuned by feel.
 *
 * What the handler works on is the entity record, `$6078` for Jetman
 * (sources/docs/disasm_notes.md chap. 11 and 12):
 *
 * | offset | what |
 * |---|---|
 * | `+$00` | type; the low bits are the animation phase |
 * | `+$01` | x on the screen — **fixed at `$78`**: Jetman pushes the view |
 * | `+$02`, `+$03` | position in the world, 16 bits |
 * | `+$04` | **y** |
 * | `+$05` | **horizontal speed, signed** |
 * | `+$06` | **vertical speed, signed** |
 * | `+$07` | attribute |
 * | `+$08` | flags; bit 0 picks the gentler acceleration |
 *
 * ★ The arithmetic is **not** Jetpac's 8.8. There the speed was a byte and a
 * fraction kept outside the record; here the speed is one signed byte and the
 * position moves by **`speed >> 4`**, an arithmetic shift — `$8D64` is four
 * `SRA A` in a row. So it is integer and it is reproduced as integer.
 *
 * ★ And the accelerations are not ramps but **steps with a jump in them**:
 * across the band at `$30` (and `$D0` going the other way) the speed moves by
 * a further `$10` in one go. That is in the code, not an artefact.
 *
 * ? **What is not in here**: the world position and the scrolling (the
 * handler hands them to a routine this port has not read yet), the rover in
 * tow, the collision with the terrain (`$91BB` reads the tile map at `$7000`)
 * and the laser. Those are the rest of M3, and leaving them out is better
 * than guessing them.
 *
 * Deliberately free of DOM dependencies, so the offline tools run it from
 * Node (R-001).
 *
 * ★ **Today nothing in the browser loads this file** — the worker still moves
 * nobody (M1), so it is an ES module that only the tools import. The day M3
 * wires it into `gameWorker.js` it has to become a **classic script** with no
 * `import` and no `export`, the way `sabremanPhysics.js` is in Sabre Wulf:
 * `importScripts()` cannot take a module (`../CLAUDE.md`, R-001), and the
 * tools then load it through `app/svision/tools/classicScript.cjs`.
 */

/** the entity record is 24 bytes ($8259 steps IX by $18) */
const RECORD = 24;

/** $8F9F: which bit of the control byte is what (disasm_notes.md chap. 4) */
const CONTROL = {
  right: 0x01,      // $8D0E BIT 0,A
  left: 0x02,       // $8D09 BIT 1,A
  bit2: 0x04,       // $8D49 BIT 2,B — the number row
  thrust: 0x08,     // $8D44 BIT 3,B — the Q-P row
  fire: 0x10        // $8DE2 BIT 4,A — the A-ENTER row, the laser
};

/** a byte as a signed value, which is how the speeds are read */
function signed(value) {
  return (value & 0x80) ? value - 256 : value;
} // signed

/** `SRA A` — an arithmetic shift right, sign preserved */
function sra(value) {
  return ((value & 0x80) | (value >> 1)) & 0xFF;
} // sra

export class JetmanPhysics {

  /** the handler $8D06 covers these types; 9-16 are $8C71 and are not ported */
  static get FLYING_TYPES() { return {first: 1, last: 8}; }

  /** ★ $8D6F: above this y the handler stops him — the underside of the panel */
  static get CEILING() { return 0x40; }
  /** ★ $8D74: at or below this the terrain is asked about */
  static get GROUND_TEST() { return 0xB0; }
  /** ★ $8FFE: the y the original puts him down on */
  static get FLOOR() { return 0xAF; }
  /** ★ $91C2: the world wraps at $2000, so the map is 1024 columns */
  static get WORLD_MASK() { return 0x1FFF; }

  /**
   * The two tiles under Jetman — the port of `$91BB`:
   *
   * ```
   * $91BB  LD H,(IX+$03) / LD L,(IX+$02)   ; world x
   *        LD A,H / AND $1F / LD H,A       ; the world wraps at $2000
   *        SRA H / RR L   ×3               ; /8 -> the column
   *        LD BC,$7000 / ADD HL,BC / LD D,(HL)
   *        INC HL / LD A,H / AND $03 / LD H,A / ADD HL,BC / LD E,(HL)
   * ```
   *
   * ★ The map the game reads at run time is at **`$7000`**, not where it was
   * loaded — it is a copy of the first 1024 bytes of `$F6CE`, checked against
   * the simulator's memory (1024/1024).
   *
   * @param {Array} record - The entity record.
   * @param {Uint8Array} [map] - The 1024 byte tile map.
   * @returns {Object} {left, right} tile indices.
   */
  static tilesUnder(record, map) {
    if (!map) {
      return {left: 1, right: 1};
    }
    var world = ((record[0x03] & 0x1F) << 8) | record[0x02];
    var column = (world >> 3) & 0x3FF;
    return {left: map[column], right: map[(column + 1) & 0x3FF]};
  } // tilesUnder

  static get CONTROL() { return CONTROL; }

  /**
   * The control byte, the port of `$8F9F`: the keyboard is read **by whole
   * rows**, and a bit of C is **cleared** when anything in its row is down.
   * The result is returned the same way round as the original returns it, so
   * `BIT n,A` being zero means pressed.
   *
   * @param {Array} keys - The eight half rows as the machine sees them, one
   *        bit per key, **set when down** (that is how a tracer records them).
   *        Index 0 is $FEFE (CAPS..V), 1 is $FDFE (A..G), 2 is $FBFE (Q..T),
   *        3 is $F7FE (1..5), 4 is $EFFE (0..6), 5 is $DFFE (P..Y),
   *        6 is $BFFE (ENTER..H), 7 is $7FFE (SPACE..B).
   * @returns {number} The control byte, a bit **clear** meaning pressed.
   */
  static readControls(keys) {
    var control = 0xFF;
    // $8FA1: A = $E7, which selects rows $F7 and $EF at once — the number row
    if ((keys[3] | keys[4]) & 0x1F) {
      control &= ~0x04;
    }
    // $8FAE: A = $DB — rows $FB and $DF, the whole Q to P row
    if ((keys[2] | keys[5]) & 0x1F) {
      control &= ~0x08;
    }
    // $8FBB: A = $BD — rows $FD and $BF, the whole A to ENTER row
    if ((keys[1] | keys[6]) & 0x1F) {
      control &= ~0x10;
    }
    // $8FC8: row $FE — X and V ($14) clear bit 1, C ($08) clears bit 0
    if (keys[0] & 0x14) {
      control &= ~0x02;
    }
    if (keys[0] & 0x08) {
      control &= ~0x01;
    }
    // $8FDD: row $7F — N ($08) clears bit 1, M and SPACE ($14) clear bit 0
    if (keys[7] & 0x08) {
      control &= ~0x02;
    }
    if (keys[7] & 0x14) {
      control &= ~0x01;
    }
    return control & 0xFF;
  } // readControls

  /**
   * The horizontal speed when nothing is held — `$8D13` to `$8D37`: it decays
   * by two a pass, **and jumps by `$10` across a band**.
   * @param {number} speed - The current speed byte.
   * @returns {number} The new speed byte.
   */
  static coast(speed) {
    if (!speed) {
      return speed;                                  // $8D17 JR Z
    }
    var value = speed;
    if (value & 0x80) {                              // $8D19 JP P — negative
      value = (value + 0x02) & 0xFF;                 // $8D1C ADD A,$02
      if (value >= 0xD0 && value < 0xE0) {           // $8D1E CP $D0 / $8D22 CP $E0
        value = (value + 0x10) & 0xFF;               // $8D26 ADD A,$10
      }
    } else {
      value = (value + 0xFE) & 0xFF;                 // $8D2A ADD A,$FE
      if (value < 0x40 && value >= 0x30) {           // $8D2C CP $40 / $8D30 CP $30
        value = (value - 0x10) & 0xFF;               // $8D35 SUB $10
      }
    }
    return value;
  } // coast

  /**
   * Accelerating sideways — `$8E5A` (one way) and `$8EC5` (the other). The
   * step is **+8 with a ceiling of `$40`**, or **+4 with a ceiling of `$20`**
   * when bit 0 of `+$08` is set, and there is the same `$10` jump across the
   * band at `$30`.
   * @param {number} speed - The current speed byte.
   * @param {boolean} gentle - Bit 0 of `+$08`.
   * @returns {number} The new speed byte.
   */
  static accelerate(speed, gentle) {
    var value = speed;
    if (gentle) {                                    // $8E97
      if (!(value & 0x80)) {
        if (value >= 0x20) {                         // $8EA6 CP $20
          return 0x20;                               // $8EC0 LD A,$20
        }
        return (value + 0x04) & 0xFF;                // $8EAB ADD A,$04
      }
      if (value < 0xD0) {                            // $8EB0 CP $D0
        value = (value + 0x10) & 0xFF;               // $8EB4 ADD A,$10
      }
      return (value + 0x08) & 0xFF;                  // $8EB6 ADD A,$08
    }
    if (!(value & 0x80)) {
      if (value >= 0x40) {                           // $8E79 CP $40
        return value;                                // at the ceiling already
      }
      value = (value + 0x08) & 0xFF;                 // $8E7E ADD A,$08
      if (value >= 0x30) {                           // $8E80 CP $30
        value = (value + 0x10) & 0xFF;               // $8E84 ADD A,$10
      }
      return value;
    }
    if (value >= 0xD0) {                             // $8E89 CP $D0
      return (value + 0x08) & 0xFF;                  // $8E8F ADD A,$08
    }
    return ((value + 0x10 + 0x08)) & 0xFF;           // $8E8D ADD A,$10 / ADD A,$08
  } // accelerate

  /**
   * The vertical speed of one pass — the thrust `$8F34` or the fall `$8D50`.
   *
   * ★ The thrust is **−8 a pass and stops at `$B8`**: `$8F47 CP $C0` leaves
   * through `JP C` once the speed has passed `$C0`, so it settles at −72.
   * Measured on the original: 00, F0, E8, E0, D8, D0, C8, C0, B8, B8, B8 …
   *
   * ★ The fall is **+8 a pass with a ceiling of `$40`** (`$8D57 CP $40`).
   *
   * @param {number} speed - The current speed byte.
   * @param {boolean} thrust - Whether the thrust is held.
   * @param {boolean} gentle - Bit 0 of `+$08`.
   * @returns {number} The new speed byte.
   */
  static vertical(speed, thrust, gentle) {
    if (thrust) {
      if (!(speed & 0x80)) {                         // $8F39 JP P — falling
        return (speed + 0xF8) & 0xFF;                // $8F4C LD C,$F8
      }
      if (gentle) {                                  // $8F41 BIT 0,(IX+$08)
        if (speed >= 0xE0) {                         // $8F51 CP $E0
          return (speed + 0xFC) & 0xFF;              // $8F53 LD C,$FC
        }
        return 0xE0;                                 // $8F58 LD (IX+$06),$E0
      }
      if (speed < 0xC0) {                            // $8F47 CP $C0 / JP C
        return speed;                                // at the ceiling
      }
      return (speed + 0xF8) & 0xFF;                  // $8F4C LD C,$F8
    }
    // $8D50: the fall
    if (!(speed & 0x80) && speed >= 0x40) {          // $8D57 CP $40
      return speed;
    }
    return (speed + 0x08) & 0xFF;                    // $8D5D ADD A,C with C = 8
  } // vertical

  /**
   * One pass over Jetman — the port of `$8D06` as far as it has been read.
   *
   * @param {Array} record - The 24 bytes of the entity, changed in place.
   * @param {number} control - The control byte from {@link readControls};
   *        a bit **clear** means pressed.
   * @param {Array} [tiles] - The two tile bytes `$91BB` would read, `[left,
   *        right]`. ★ They come from the **live** map at `$7000`, not from
   *        data/terrain.json: that map is working memory and the game changes
   *        it (a bomb leaves a crater). The static one is for drawing.
   * @returns {Object} What the pass did: {y, speedX, speedY}.
   */
  static step(record, control, tiles) {
    var gentle = !!(record[0x08] & 0x01);

    // sideways: $8D09 / $8D0E, then the coast at $8D13
    if (!(control & CONTROL.left)) {
      record[0x05] = JetmanPhysics.accelerate(record[0x05], gentle);
    } else if (!(control & CONTROL.right)) {
      record[0x05] = JetmanPhysics.accelerate(record[0x05], gentle);
    } else {
      record[0x05] = JetmanPhysics.coast(record[0x05]);
    }

    // up and down: $8D44 the thrust, $8D49 kills the speed outright
    if (!(control & CONTROL.bit2)) {
      record[0x06] = 0x00;                           // $8F61
    } else {
      record[0x06] = JetmanPhysics.vertical(record[0x06],
                                            !(control & CONTROL.thrust), gentle);
    }

    // $8D61: y += speed >> 4, arithmetic
    var speed = record[0x06];
    for (var shift = 0; shift < 4; shift++) {
      speed = sra(speed);
    }
    var y = (record[0x04] + signed(speed)) & 0xFF;

    // ★ $8D6F CP $40 / JP C,$8F61 — the ceiling. $8F61 sets the vertical
    // speed to nought and jumps **past** the store at $8D90, so y keeps the
    // value it had: Jetman does not get pushed back, he simply stops.
    if (y < JetmanPhysics.CEILING) {
      record[0x06] = 0x00;
      return {y: record[0x04], speedX: signed(record[0x05]),
              speedY: 0, hitCeiling: true};
    }
    // ★ $8D74 CP $B0 — at or below that it is the ground, and the handler
    // asks the tile map what is underneath ($91BB).
    if (y >= JetmanPhysics.GROUND_TEST) {
      var under = tiles || [1, 1];
      record[0x04] = JetmanPhysics.FLOOR;                 // $8D8E / $8FFE
      // $8D7B / $8D7F: an empty tile either side, or $8D83: bit 3 of the two
      // together set — then it is not a landing but a knock, and the vertical
      // speed is thrown back to $E0
      var knock = !under[0] || !under[1] || ((under[0] | under[1]) & 0x08);
      if (knock) {
        record[0x06] = 0xE0;                              // $8D8A
      } else {
        // $8FF4: bit 3 of the type goes up — he is standing on it
        record[0x00] = ((((record[0x00] - 1) & 0xFF) | 0x08) + 1) & 0xFF;
      }
      return {y: record[0x04], speedX: signed(record[0x05]),
              speedY: signed(record[0x06]), onGround: true, knock: !!knock};
    }
    record[0x04] = y;

    return {
      y: record[0x04],
      speedX: signed(record[0x05]),
      speedY: signed(record[0x06])
    };
  } // step

} // class JetmanPhysics
