const { ZXVideoRAM } = await import('./svision/js/platform/canvas2D/zx/zxVideoRAM.js?ver='+window.srcVersion);
const { ScreenLayout } = await import('./screenLayout.js?ver='+window.srcVersion);
// begin code

/**
 * Builds the Lunar Jetman screen — all 6912 bytes of it — out of what the
 * original draws with.
 *
 * What the machine is (the video memory, the ULA's interleaved addressing,
 * `poke`/`peek`, turning bytes plus attributes into pixels) is svision's
 * ZXVideoRAM (R-003). What is left here is the game's own drawing, ported
 * routine by routine out of `sources/asm/lunarjetman.asm`
 * (sources/docs/disasm_notes.md chap. 9):
 *
 * - `$857F` picks a sprite out of the table at `$BAC0`, indexed with the
 *   entity's own type byte minus one — the very byte the handler is chosen
 *   with — {@link spriteFor}
 * - `$85CF` shifts a row and writes it into the screen — {@link drawSprite}
 * - `$89EF` prints a character out of the game's **own** character set,
 *   whose base lives in `$5E04` and is set to `$D347` — {@link printString}
 * - `$8506` turns a screen address into an attribute address
 *
 * ★ Four things about the original's drawing are measured, not assumed, and
 * all four are **different from Jetpac**:
 *
 * 1. **A sprite is stored bottom row first and drawn upwards.** `$85F6` does
 *    `DEC H` after every row and steps `L` back by `$20` when it leaves the
 *    character cell, so the byte at offset 0 lands on the entity's own y and
 *    every further row a pixel higher.
 * 2. **There is no mask, because the drawing is XOR.** `$85E9` is
 *    `XOR (HL) / LD (HL),A`: the same write both draws a sprite and rubs it
 *    out again. Jetpac had a silhouette used twice, with AND and OR.
 * 3. **The shift is done at run time, one pixel at a time.** `$85D7` is a
 *    self-modifying jump into a chain of `ADD HL,HL / ADC A,A`, so a sprite
 *    can sit on any x — Jetpac carried four pre-shifted copies per direction
 *    and could only ever draw on even x. Here the horizontal resolution is
 *    **one pixel**, and the remake must shift the same way rather than
 *    pre-compute eight variants.
 * 4. **Two sprite formats.** Narrow ones are `[height][height x 2 bytes]`,
 *    wide ones `[width in bytes][height][width x height]`. Which is which is
 *    decided in data/sprites.json by the spacing to the next sprite in
 *    memory, never guessed from the content; the ones that could not be
 *    settled that way carry `verified: false` and this composer skips them.
 *
 * ★ **M1 draws the background out of data/screen.json** — the static game
 * screen captured off the original by majority vote (tools/mkscene.py, 24
 * samples, 98.1 % of the bytes unanimous). That is temporary and deliberate:
 * how the terrain is described and how the panel's labels are laid out is not
 * read out of the program yet (M2), and composing the screen from data that
 * has not been measured would mean inventing it. Nothing is redrawn even so —
 * every byte of that background is a byte of the original's video memory.
 *
 * Free of DOM dependencies, so the offline tools render with this very code
 * (R-001).
 */
export class ScreenComposer {

  /** the first character code the game's character set covers ($89EF: `SUB $20`) */
  static get FIRST_CHAR() { return 0x20; }

  /**
   * @param {Object} scene - The parsed data/screen.json: the static screen
   *        captured off the original (tools/mkscene.py).
   * @param {Object} [gfx] - The parsed data/sprites.json: the sprite table
   *        $BAC0 with its two formats.
   * @param {Object} [font] - The parsed data/font.json: the game's **own**
   *        character set from $D347. Without it nothing is printed — and the
   *        ROM font of svision is deliberately **not** a fallback, because
   *        the original does not use it (disasm_notes.md chap. 2).
   * @param {Object} [terrain] - The parsed data/terrain.json: the tiles at
   *        $F66E and the map at $F6CE (disasm_notes.md chap. 13).
   * @param {Object} [panel] - The parsed data/panel.json: where the scores
   *        and their labels sit on character rows 0 and 1.
   */
  constructor(scene, gfx, font, terrain, panel) {
    if (!scene || !scene.videoRAM) {
      throw new Error('screen data missing (data/screen.json)');
    }
    this.scene = ZXVideoRAM.decode(scene.videoRAM);

    this.sprites = {};
    ((gfx && gfx.sprites) || []).forEach((sprite) => {
      this.sprites[parseInt(sprite.address.substring(1), 16)] = {
        widthBytes: sprite.widthBytes,
        height: sprite.height,
        verified: sprite.verified,
        bytes: ZXVideoRAM.decode(sprite.data)
      };
    });
    // the table itself: index is the entity's type byte minus one ($857F)
    this.byType = {};
    ((gfx && gfx.sprites) || []).forEach((sprite) => {
      (sprite.types || []).forEach((type) => {
        this.byType[Number(type)] = parseInt(sprite.address.substring(1), 16);
      });
    });

    this.terrain = null;
    if (terrain && terrain.tiles && terrain.map) {
      this.terrain = {
        tiles: ZXVideoRAM.decode(terrain.tiles.bytes),
        tileHeight: terrain.tiles.height,
        map: ZXVideoRAM.decode(terrain.map.bytes),
        length: terrain.map.length,
        row: terrain.row
      };
    }

    this.panel = panel || null;

    this.font = null;
    this.firstChar = ScreenComposer.FIRST_CHAR;
    if (font && font.glyphs) {
      this.font = ZXVideoRAM.decode(font.glyphs);
      this.firstChar = font.firstChar !== undefined ? font.firstChar
                                                    : ScreenComposer.FIRST_CHAR;
      this.glyphCount = font.count || (this.font.length >> 3);
    }
  } // constructor

  /**
   * Lays the captured screen down as the background. It is one memcpy: the
   * bitmap and the attributes together, exactly the 6912 bytes the original
   * had on the screen.
   * @param {ZXVideoRAM} videoRAM - The memory to fill.
   */
  clearScreen(videoRAM) {
    videoRAM.bytes.set(this.scene.subarray(0, videoRAM.bytes.length));
  } // clearScreen

  /**
   * The sprite of an entity, the way `$857F` picks it: the table at `$BAC0`
   * is indexed with the type byte minus one.
   * @param {number} type - The entity's type byte ($00 means an empty slot).
   * @returns {Object|null} {widthBytes, height, bytes} or null.
   */
  spriteFor(type) {
    var address = this.byType[type];
    var sprite = address !== undefined ? this.sprites[address] : null;
    // a sprite whose format could not be settled by the spacing is not drawn:
    // half a picture in the right place is worse than nothing in M1
    return (sprite && sprite.verified) ? sprite : null;
  } // spriteFor

  /**
   * Blits one entity — the port of `$85CF`.
   *
   * The row is shifted right by `x & 7` into three bytes and **XORed** into
   * the screen, and the rows are walked **upwards** from the entity's own y.
   * Neither is a stylistic choice: both fall out of the original's own code
   * and both differ from Jetpac.
   * @param {ZXVideoRAM} videoRAM - The memory to draw into.
   * @param {Object} entity - {x, y} of the worker's frame.
   * @param {Object} sprite - The sprite record.
   */
  drawSprite(videoRAM, entity, sprite) {
    if (!sprite) {
      return;
    }
    // ★ The shift is the low three bits of the screen x, and the sprite is
    // written one byte wider when it does not come out zero.
    //
    // ? `$86C8` works an offset into the chain of `ADD HL,HL` at `$85D9` out
    // as `((x-1) & 7) * 2`, which would suggest `(8 - ((x-1) & 7)) & 7`.
    // **Measured against the original's own video memory, `x & 7` is the one
    // that fits** (325 differing bytes against 535), so that is what is here.
    // Why the two disagree is not settled — it is one of the open items of M2.
    var shift = entity.x & 0x07;
    var columns = shift ? sprite.widthBytes + 1 : sprite.widthBytes;
    var column = entity.x & 0xF8;
    for (var row = 0; row < sprite.height; row++) {
      var y = entity.y - row;
      if (y < 0 || y >= ScreenLayout.HEIGHT) {
        continue;
      }
      var carry = 0;
      for (var byte = 0; byte < sprite.widthBytes; byte++) {
        var bits = sprite.bytes[row*sprite.widthBytes + byte];
        var out = ((bits >> shift) | carry) & 0xFF;
        carry = (bits << (8 - shift)) & 0xFF;
        if (out) {
          // ★ the original does not clip at the right hand edge: the address
          // is stepped inside the page, so a sprite running off the right
          // comes back on the left. Reproduced, not clipped.
          var at = ZXVideoRAM.addressOf((column + byte*8) & 0xFF, y);
          videoRAM.poke(at.h, at.l, out, 'xor');
        }
      }
      if (carry) {
        var tail = ZXVideoRAM.addressOf((column + sprite.widthBytes*8) & 0xFF, y);
        videoRAM.poke(tail.h, tail.l, carry, 'xor');
      }
    }
    if (entity.attr !== undefined) {
      this.drawAttributes(videoRAM, entity, sprite, columns);
    }
  } // drawSprite

  /**
   * The colour of an entity — the port of `$8733` and its loop at `$8750`.
   *
   * ★ The colour itself is **`(IX+$07)`**, a byte of the entity record.
   * How big a block it covers comes out of `$8733`:
   *
   * - **rows** = `(((height >> 2) + 1) >> 1) + 1` — `RRCA / RRCA / INC A /
   *   RRCA / AND $1F / INC A` on the sprite's height
   * - **columns** = **2 or 3**: three when the sprite is shifted across a byte
   *   boundary, two when it is not (`$86D9 LD A,$02 / JR Z / INC A`)
   *
   * And two rules that are the whole reason this game looks as clean as it
   * does:
   *
   * 1. ★ **`LD A,(HL) / AND A / JR Z`** — the colour goes **only into cells
   *    whose attribute is not already zero**. A black cell stays black, so a
   *    sprite flying over the empty sky does not smear colour across it.
   *    That is Lunar Jetman's answer to attribute clash, and it is the same
   *    idea as `$BB47` in Sabre Wulf.
   * 2. ★ **`INC L / AND $1F / JR Z`** — the run stops at the right hand edge
   *    of the character row. So the **attributes do not wrap** even though
   *    the bitmap does.
   *
   * The rows are walked **upwards** (`HL -= $20`), the same direction the
   * sprite is drawn in.
   * @param {ZXVideoRAM} videoRAM - The memory to draw into.
   * @param {Object} entity - {x, y, attr} of the worker's frame.
   * @param {Object} sprite - The sprite record being drawn.
   * @param {number} columns - 2 or 3, as $86D9 works it out.
   */
  drawAttributes(videoRAM, entity, sprite, columns) {
    var rows = ((((sprite.height >> 2) + 1) >> 1) & 0x1F) + 1;
    var column = entity.x >> 3;
    for (var row = 0; row < rows; row++) {
      var y = entity.y - row*8;
      if (y < 0 || y >= ScreenLayout.HEIGHT) {
        continue;
      }
      var cellRow = y >> 3;
      for (var cell = 0; cell < columns; cell++) {
        var col = column + cell;
        if (col > 31) {
          break;                     // $876A: no wrap for the attributes
        }
        if (videoRAM.peekAttribute(cellRow, col)) {
          videoRAM.pokeAttribute(cellRow, col, entity.attr);
        }
      }
    }
  } // drawAttributes

  /**
   * The surface of the moon — the port of how the original lays it out.
   *
   * ★ **The landscape is not a bitmap, it is a row of tiles**: one byte of
   * the map at $F6CE per eight pixel columns of the world, indexing the
   * eight byte tiles at $F66E (data/terrain.json, disasm_notes.md chap. 13).
   *
   * ★ And it scrolls **by pixels, not by tiles**: each character cell is two
   * neighbouring tiles shifted by `worldX & 7`. Measured on five frames off
   * the original — the shift was `worldX & 7` every time.
   *
   * @param {ZXVideoRAM} videoRAM - The memory to draw into.
   * @param {number} worldX - The world coordinate of the left of the view.
   */
  drawTerrain(videoRAM, worldX) {
    if (!this.terrain) {
      return;
    }
    const map = this.terrain.map;
    const length = this.terrain.length;
    const shift = worldX & 0x07;
    const first = (worldX >> 3);
    const row = this.terrain.row;
    for (var column = 0; column < ScreenLayout.COLS; column++) {
      var left = this.tileAt(map, length, first + column);
      var right = this.tileAt(map, length, first + column + 1);
      for (var line = 0; line < this.terrain.tileHeight; line++) {
        var bits = ((this.terrain.tiles[left*8 + line] << shift) & 0xFF)
                   | (shift ? (this.terrain.tiles[right*8 + line] >> (8 - shift)) : 0);
        var at = ZXVideoRAM.addressOf(column*8, row*8 + line);
        videoRAM.poke(at.h, at.l, bits);
      }
    }
  } // drawTerrain

  /**
   * The tile index of one column of the world; the map wraps, because the
   * moon does.
   * @param {Uint8Array} map - The tile map.
   * @param {number} length - How long it is.
   * @param {number} column - The column, which may run off either end.
   * @returns {number} The tile index.
   */
  tileAt(map, length, column) {
    var index = column % length;
    return map[index < 0 ? index + length : index];
  } // tileAt

  /**
   * A string in the game's **own** character set, one glyph per character
   * cell — the port of `$89EF`: the code less `$20`, times eight, plus the
   * base held in `$5E04`; eight bytes written with `INC H` between them, then
   * `H -= 8` and `INC L` for the next cell.
   * @param {ZXVideoRAM} videoRAM - The memory to draw into.
   * @param {number} x - Left edge in pixels.
   * @param {number} y - Top row in pixels.
   * @param {string} text - The characters.
   * @param {number} [attr] - The attribute of the cells; left alone when absent.
   */
  printString(videoRAM, x, y, text, attr) {
    if (!this.font) {
      return;
    }
    for (var index = 0; index < text.length; index++) {
      var code = text.charCodeAt(index) - this.firstChar;
      var column = (x >> 3) + index;
      if (code >= 0 && code < this.glyphCount) {
        for (var line = 0; line < 8; line++) {
          var at = ZXVideoRAM.addressOf((column*8) & 0xFF, y + line);
          videoRAM.poke(at.h, at.l, this.font[code*8 + line]);
        }
      }
      if (attr !== undefined) {
        videoRAM.pokeAttribute(y >> 3, column & 0x1F, attr);
      }
    }
  } // printString

  /**
   * The panel — character rows 0 and 1, the scores.
   *
   * ★ It is all printed with the game's **own** character set, the same
   * `printString` that is the port of `$89EF`: every non-blank cell of both
   * rows in three independent frames off the original is exactly a glyph from
   * `$D347`, bar one, which is the little figure at `$D151` beside the
   * counter (`$896F LD DE,$D151`).
   *
   * ? Rows 2 to 4 — the band with `TRUCK`, `FUEL`, `TIME` and `BASE` — are
   * **not** drawn here: their labels are not glyphs of this set and the bars
   * move. That is the rest of M2, and drawing them by eye would be inventing
   * them.
   *
   * ? What the field either side of `HI` counts, and what the counter with
   * the figure on row 0 counts, is **not measured**. They are drawn from
   * whatever the worker sends; nothing here claims to know what they mean.
   *
   * @param {ZXVideoRAM} videoRAM - The memory to draw into.
   * @param {Object} state - {score, score2, hiScore, leftCount, rightCount,
   *        counter}.
   */
  drawPanel(videoRAM, state) {
    if (!this.panel || !this.font) {
      return;
    }
    var values = state || {};
    this.panel.background.forEach((back) => {
      for (var col = 0; col < ScreenLayout.COLS; col++) {
        videoRAM.pokeAttribute(back.row, col,
          back.edgeColumns.indexOf(col) >= 0 ? back.edgeAttr : back.attr);
      }
    });
    this.panel.labels.forEach((label) => {
      this.printString(videoRAM, label.col*8, label.row*8, label.text, label.attr);
    });
    this.panel.fields.forEach((field) => {
      var value = values[field.name];
      if (value === null || value === undefined) {
        // ★ a field with nothing in it is **blanked**, not left alone: on the
        // menu screen of the original both counters read L00 and the scores
        // read six noughts, so there is never a gap
        value = 0;
      }
      var text = ScreenComposer.digits(value, field.digits);
      this.printString(videoRAM, field.col*8, field.row*8, text, field.attr);
    });
    var counter = this.panel.counter;
    if (counter && values.counter !== undefined && values.counter !== null) {
      this.printString(videoRAM, counter.col*8, counter.row*8,
                       String(values.counter % 10), counter.attr);
      for (var line = 0; line < 8; line++) {
        var at = ZXVideoRAM.addressOf((counter.col + 1)*8, counter.row*8 + line);
        videoRAM.poke(at.h, at.l, this.panel.iconBytes[line]);
      }
      videoRAM.pokeAttribute(counter.row, counter.col + 1, counter.attr);
    }
  } // drawPanel

  /**
   * A number as a fixed run of digits, the way the panel prints it: nothing
   * is suppressed, so nought is a row of noughts.
   *
   * ★ The `leftCount` and `rightCount` fields print an `L` and then two
   * digits — that is what is on the screen (`L00`), and it is copied rather
   * than interpreted, because what they count is not measured.
   * @param {number|string} value - The value; a string is taken as it is.
   * @param {number} digits - How many cells.
   * @returns {string} The text.
   */
  static digits(value, digits) {
    if (typeof value === 'string') {
      return (value + '      ').substring(0, digits);
    }
    var text = String(Math.max(0, Math.floor(value)));
    while (text.length < digits) {
      text = '0' + text;
    }
    return text.slice(-digits);
  } // digits

  /**
   * Composes a whole frame: the captured background, then every entity that
   * is alive, in slot order — the order the original's main loop walks them
   * in ($8259 steps IX by 24 from $6000), so two sprites that overlap come
   * out the same way round.
   * @param {ZXVideoRAM} videoRAM - The memory to build into.
   * @param {Object} state - The worker's 'frame' message.
   */
  composeInto(videoRAM, state) {
    this.clearScreen(videoRAM);
    // ★ the moon is laid out from data/terrain.json once the worker knows
    // where in the world the view is; until M3 does, the captured background
    // is all there is and nothing is drawn over it
    if (state && state.worldX !== undefined) {
      this.drawTerrain(videoRAM, state.worldX);
    }
    if (state && state.panel) {
      this.drawPanel(videoRAM, state.panel);
    }
    ((state && state.entities) || []).forEach((entity) => {
      if (!entity || !entity.type) {
        return;
      }
      this.drawSprite(videoRAM, entity, this.spriteFor(entity.type));
    });
  } // composeInto

} // ScreenComposer
