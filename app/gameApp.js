const { Version } = await import('./version.js?ver='+window.srcVersion);
const { AbstractApp } = await import('./svision/js/abstractApp.js?ver='+window.srcVersion);
const { AudioManager } = await import('./audioManager.js?ver='+window.srcVersion);
const { ZXFonts8x8 } = await import('./svision/js/platform/canvas2D/zx/zxFonts8x8.js?ver='+window.srcVersion);
const { Fonts5x5 } = await import('./svision/js/platform/canvas2D/fonts5x5.js?ver='+window.srcVersion);
const { Fonts3x3 } = await import('./svision/js/platform/canvas2D/fonts3x3.js?ver='+window.srcVersion);
const { ZXResetModel } = await import('./svision/js/platform/canvas2D/zx/zxResetModel.js?ver='+window.srcVersion);
const { MenuModel } = await import('./menuModel.js?ver='+window.srcVersion);
const { AboutModel } = await import('./aboutModel.js?ver='+window.srcVersion);
const { HallOfFameModel } = await import('./hallOfFameModel.js?ver='+window.srcVersion);
const { GameModel } = await import('./gameModel.js?ver='+window.srcVersion);
const { GameOverModel } = await import('./gameOverModel.js?ver='+window.srcVersion);
const { TapeLoadingModel } = await import('./tapeLoadingModel.js?ver='+window.srcVersion);
const { ZXErrorEntity } = await import('./svision/js/platform/canvas2D/zx/zxErrorEntity.js?ver='+window.srcVersion);
const { Tool } = await import('./svision/js/tool.js?ver='+window.srcVersion);
const { ZXColor } = await import('./svision/js/platform/canvas2D/zx/zxColor.js?ver='+window.srcVersion);
// begin code

/**
 * Lunar Jetman application shell (M1 skeleton, built on the Sabre Wulf one — the
 * same company, the same machine, the same discipline, and a ZX game on
 * ZXPlatform).
 * LoadingModel -> MenuModel -> GameModel (the game) -> GameOverModel, plus
 * TapeLoadingModel, HallOfFameModel and AboutModel off the menu.
 *
 * ★ **LOAD TAPE is one of the ways to start**, not a decoration: the tape
 * carries a SCREEN$ block (`JMSP`, 6912 bytes at $4000) and the remake loads
 * that picture for real, byte by byte, because the sound *is* those bytes
 * (tapeLoadingModel.js, data/loading.json, ZADANI chap. 1).
 *
 * Two things are the original's rather than the remake's idea:
 *
 * - **Two players and the choice of controls.** The original's own menu is
 *   `GAME SELECTION` with `1 PLAYER GAME`, `2 PLAYER GAME`, `KEYBOARD`,
 *   `KEMPSTON JOYSTICK`, `CURSOR   JOYSTICK` and `START GAME`, and the answer
 *   sits in one byte, `$5E00` ($8F90 reads it). There is no difficulty
 *   setting. The panel carries 1UP, HI and 2UP always.
 * - **A hall of fame.** `THE ULTIMATE HALL OF FAME`, `CONGRATULATIONS
 *   PLAYER`, `JETMAN WILL REMEMBER YOU` ($F4AA onwards) — so in the remake it
 *   is faithfulness, not an addition.
 * - **The controls.** ★ Whole rows rather than particular keys ($8F9F): the
 *   number row, the Q-P row, the A-ENTER row, and the bottom row split
 *   between X/V/N and C/M/SPACE. CAPS, Z, B and SYM are not read at all.
 *   ? Which of those five bits is which action is **not measured yet** (M3).
 *
 * ? Whether the game has music is **not measured**: the beeper is written at
 * $B8DF and $B8E5 and the routines around it are M6. Until then there is one
 * bus and one volume, as in Sabre Wulf (R-024).
 *
 * ? How many lives the original gives is **not measured either**, so nothing
 * is asserted here — the panel shows something either side of HI whose
 * meaning is still open (sources/docs/screen_layout.md).
 */
export class GameApp extends AbstractApp {

  /** the original's own choice: 1UP or 2UP (GameOptions, $9692) */
  static get PLAYERS() { return [1, 2]; }

  constructor(platform, importPath, wsURL, devModeName, appIconSprite) {
    super(platform, 'bodyApp', importPath, wsURL);

    this.worker = new Worker(this.importPath+'/gameWorker.js?ver='+window.srcVersion);
    this.worker.onmessage = (event) => {
      if (this.model) {
        this.model.handleWorkerMessage(event);
      }
    };

    this.version = Version;
    this.devModeName = devModeName;
    this.appIconSprite = appIconSprite;

    this.audioManager = new AudioManager(this);
    // one switch for both buses: the music follows the sounds (menuModel.js)
    this.muted = {sounds: false};

    // ★ These are the **remake's** fonts — menus, dialogs, settings — and
    // they are svision's, ZX ROM font and all. The **game's own** character
    // set is a different thing entirely and is deliberately not loaded here:
    // Lunar Jetman does not print with the ROM font. There is no reference to
    // CHARS ($5C36) or to $3D00 anywhere in its 31 744 bytes; $89EF takes the
    // glyph out of a table of its own whose base sits in $5E04 and is set to
    // $D347. That set lives in data/font.json and is handed straight to
    // ScreenComposer (disasm_notes.md chap. 2). Using ZXFonts8x8 for the game
    // screen would be exactly the kind of near-enough this project does not
    // do — and tools/matchscreen.js would catch it.
    this.fonts = {
      zxFonts8x8Mono: new ZXFonts8x8(this, false),
      zxFonts8x8: new ZXFonts8x8(this, true),
      fonts5x5: new Fonts5x5(this),
      fonts3x3: new Fonts3x3(this)
    };
    // Hard/short spaces live in the game (svision core fonts have the normal space only).
    this.fonts.fonts5x5.addSpace('␣', {width: 2, breaking: false, stretch: true});

    this.fonts.zxFonts8x8.addSpace('␣', {width: 3, breaking: false, stretch: false});
    this.fonts.zxFonts8x8.addSpace('▭', {width: 4, breaking: false, stretch: false});

    // ★ The original reads **whole rows** ($8F9F), plus Kempston ($8F9B) and
    // Cursor, and `O` on its own pauses ($8298). ? Which row is which action
    // is not measured yet (M3), so the remake's defaults are the arrow keys
    // and SPACE, as in the sibling remakes (getControls()), and
    // **every key comes from SETTINGS** — nothing is accepted beside the
    // configured keys, so the remap dialog always tells the truth. The mouse
    // is not offered for the game: it serves the buttons and the menu.
    this.controlsOptions = {
      keyboard: {
        device: 'keyboard',
        keys: [
          {action: 'left', label: 'FLY LEFT'},
          {action: 'right', label: 'FLY RIGHT'},
          {action: 'thrust', label: 'THRUST'},
          {action: 'bomb', label: 'BOMB'},
          {action: 'fire', label: 'LASER'},
          {action: 'sounds', label: 'MUTE SOUNDS'}
        ]
      },
      gamepads: {
        device: 'gamepads',
        keys: [
          {action: 'left', label: 'FLY LEFT', eventKey: 'GamepadLeft'},
          {action: 'right', label: 'FLY RIGHT', eventKey: 'GamepadRight'},
          {action: 'thrust', label: 'THRUST', eventKey: 'GamepadUp'},
          {action: 'bomb', label: 'BOMB', eventKey: 'GamepadDown'},
          {action: 'fire', label: 'LASER', eventKey: 'GamepadFire'},
          // the buttons of the menu, the dialogs and the tape loading listen
          // to GamepadOK (like manicminer, jetsetwilly)
          {action: 'ok', label: 'OK', eventKey: 'GamepadOK'},
          {action: 'exit', label: 'EXIT', eventKey: 'GamepadExit'}
        ]
      },
      // ★ Touch controls are part of M1, not of a later milestone. That is the
      // lesson of Underwurlde, where they were put off and left a hole (M5b);
      // here there are fewer actions than anywhere — left, right, thrust,
      // laser — so there is no reason to wait.
      //
      // One half of the screen is a **stick** — left, right and up for the
      // thrust, because Jetman has no "down": he falls on his own — the other
      // a **laser button**. Which half is which is the left-handed /
      // right-handed choice in SETTINGS; that is all `types` says.
      touchscreen: {
        device: 'touchscreen',
        types: {
          // ★ default is the laser on the left and the stick on the right;
          // the first key is also the fallback for a broken cookie
          keys: [
            'leftLaser',
            'rightLaser'
          ],
          rightLaser: {
            left: {half: 'stick', sprite: 'stick'},
            right: {half: 'laser', sprite: 'laser'}
          },
          leftLaser: {
            left: {half: 'laser', sprite: 'laser'},
            right: {half: 'stick', sprite: 'stick'}
          }
        },
        // What each half does. `rect` is a fraction of that half
        // ([x, y, width, height]), so the layout does not depend on how big
        // the half happens to be — a phone gets the same thing upright and on
        // its side.
        halves: {
          // ★ the stick is **horizontal only**: Jetman has no "down", he
          // falls on his own, and up is the thrust, which is held rather than
          // steered — so pushing the stick up sets the thrust
          stick: {
            icon: 'stick',
            zones: [
              {rect: [0, 0, 1, 1], type: 'joystick', control: 'both',
               actions: {left: 'left', right: 'right', up: 'thrust', down: 'bomb'}}
            ]
          },
          laser: {
            icon: 'laser',
            zones: [
              // the laser is held, like the whole middle row of the keyboard
              {rect: [0, 0, 1, 1], type: 'button', action: 'fire'}
            ]
          }
        },
        // A short tap has to be seen by the worker: it reads the controls once
        // per pass of the main loop (50.08 Hz), so even the briefest tap is
        // held at least this long.
        tapHoldTime: 120,
        // how far the finger has to move before the stick changes direction
        joystickStep: 10,
        icons: {
          // the four arrows for the stick are a control glyph of the svision
          // family (the same one the sibling remakes use); the laser is the
          // game's own
          stick: {
            compressedSpriteData: 'lP101300N0E2P0111030Z051012320B0P020N0601234561718191AB9BCDB1BDCB9BA19181716543210'
          },
          laser: {
            // ★ the game's own laser: Jetman firing, the shot leaving him to
            // the right. Drawn on the same 39x23 canvas as the stick glyph so
            // both icons take the same room in the border; a readable grid,
            // `-` transparent, `#` pen colour (setGameControlIcons takes this
            // shape as well as compressedSpriteData).
            width: 39, height: 23, frames: 1, directions: 1,
            sprite: [[
              '---------------------------------------',
              '---------------------------------------',
              '--------#####--------------------------',
              '-------#######-------------------------',
              '------##-###-##------------------------',
              '------##-###-##------------------------',
              '------#########------------------------',
              '-------#######-------------------------',
              '--------#####--------------------------',
              '-----###########-----------------------',
              '----#############----------------------',
              '---###-#######-###----#####----#####---',
              '---##---#####---##---------------------',
              '--------#####--------------------------',
              '-------##---##-------------------------',
              '------##-----##------------------------',
              '------##-----##------------------------',
              '-----###-----###-----------------------',
              '----####-----####----------------------',
              '---------------------------------------',
              '---------------------------------------',
              '---------------------------------------',
              '---------------------------------------'
            ]]
          }
        }
      }
    };

    this.controls = {
      keyboard: this.getControls('keyboard'),
      touchscreen: this.getControls('touchscreen'),
      gamepads: this.getControls('gamepads')
    };

    this.players = GameApp.PLAYERS[0];
    // ? how many lives the original gives is **not measured** — nothing is
    // asserted, and the panel is drawn from the original's own picture rather
    // than from a number we made up (M1)
    this.lives = null;
    this.score = 0;
    this.score2 = 0;
    this.hiScore = 0;
    this.player = 1;
    this.level = 0;
    // ★ the seed of the game's randomness, settled before the worker starts
    // so that a run can be repeated and a regression has a fingerprint
    // (../METHODOLOGY.md, ../STANDARDS.md). It is a field rather than a
    // constant because tools/runworker.js and the regression pass their own.
    this.gameSeed = 1;
    this.playerName = Tool.readCookie('playerName', '');
    this.globalData = false;
    this.id = 'GameApp';
    this.fetchDataId = '';
    this.setModel('LoadingModel');
    this.loadAppData();
  } // constructor

  getControls(device) {
    var result = {};

    switch (device) {
      case 'keyboard':
        // The defaults of the remake: the arrows and SPACE, as in the sibling
        // remakes. ★ The original does not have keys, it has **rows**: the
        // whole top row (Q to P) is the thrust, the whole middle row (A to
        // ENTER) the laser, and the bottom row is split — Z, C, M and B are
        // left, X, V, N and SYMBOL SHIFT right ($733E, $7374, $7393). Anyone
        // who wants that back sets it in SETTINGS; the arrows are what the
        // sibling remakes use and what a player expects.
        // ★ `brake` on the down arrow is the faithful place for it: on a
        // Kempston the original reads it as DOWN ($7473), and on the keyboard
        // as the whole number row.
        result = {left: 'ArrowLeft', right: 'ArrowRight', thrust: 'ArrowUp',
                  brake: 'ArrowDown', fire: ' ', sounds: 'S'};
        break;
      case 'touchscreen':
        result = {supported: false, type: 'leftLaser'};
        break;
      case 'gamepads':
        result = {supported: false, devices: {}};
        break;
    }

    switch (device) {
      case 'keyboard':
      case 'touchscreen':
        var cfgString = Tool.readCookie(device, false);
        if (cfgString !== false) {
          try {
            var cfg = JSON.parse(cfgString);
            Object.keys(cfg).forEach((item) => {
              result[item] = cfg[item];
              if (device == 'touchscreen' && !(result[item] in this.controlsOptions.touchscreen.types)) {
                result[item] = this.controlsOptions.touchscreen.types.keys[0];
              }
            });
          } catch (error) {
            console.error(error.message);
          }
        }
        break;
      case 'gamepads':
        var devicesString = Tool.readCookie('gamepads', false);
        if (devicesString !== false) {
          try {
            var devices = JSON.parse(devicesString);
          } catch (error) {
            console.error(error.message);
          } finally {
            if (Array.isArray(devices)) {
              devices.forEach((id) => {
                var deviceString = Tool.readCookie(id, false);
                if (deviceString !== false) {
                  try {
                    var device = JSON.parse(deviceString);
                  } catch (error) {
                    console.error(error.message);
                  } finally {
                    result.devices[id] = device;
                  }
                }
              });
            }
          }
        }
        break;
    }
    return result;
  } // getControls

  setModel(model) {
    if (model == 'MenuModel' && this.globalData === false) {
      // the fetch may still be pending or has failed: as a last resort try the
      // data cached in localStorage before bothering the user
      if (!this.loadGlobalDataFromStorage()) {
        this.showErrorMessage('Game data could not be loaded.', 'retry');
        return;
      }
    }
    var needResizeApp = false;
    var selectionItem = 0;
    if (this.model) {
      // where to put the menu cursor on the way back (menuModel.menuItems)
      if (this.model.id == 'TapeLoadingModel') {
        selectionItem = 5;
      } else if (this.model.id == 'AboutModel') {
        selectionItem = 6;
      } else if (this.model.id == 'HallOfFameModel') {
        selectionItem = 2;
      }
      this.model.shutdown();
      needResizeApp = true;
    }
    switch (model) {
      case 'LoadingModel':
        this.model = new ZXResetModel(this);
        break;
      case 'MenuModel':
        this.model = new MenuModel(this, selectionItem);
        break;
      case 'AboutModel':
        this.model = new AboutModel(this);
        break;
      case 'HallOfFameModel':
        this.model = new HallOfFameModel(this);
        break;
      case 'GameModel':
        this.model = new GameModel(this);
        break;
      case 'GameOverModel':
        this.model = new GameOverModel(this, 'MenuModel');
        break;
      case 'TapeLoadingModel':
        this.model = new TapeLoadingModel(this);
        break;
    } // switch
    this.model.init();
    if (needResizeApp) {
      this.resizeApp();
    }
  } // setModel

  /**
   * How many players the game runs with. Anything that is not one of
   * GameApp.PLAYERS is ignored, so a missing parameter keeps the current
   * choice — the same shape the original keeps in GameOptions ($9692).
   * @param {number} [players] - 1 or 2.
   * @returns {number} The number of players in force.
   */
  setPlayers(players) {
    if (GameApp.PLAYERS.indexOf(players) >= 0) {
      this.players = players;
    }
    return this.players;
  } // setPlayers

  /**
   * Starts a new game on the first level.
   * @param {number} [players] - 1 or 2; without it the menu's choice stays.
   */
  startGame(players) {
    this.setPlayers(players);
    this.score = 0;
    this.score2 = 0;
    this.player = 1;
    this.level = 0;
    // ? how many lives the original gives is not measured (M4)
    this.lives = (this.globalData && this.globalData.lives) || null;
    // a fresh seed per game, so two runs differ — but a recorded one can be
    // replayed exactly (WORKER-PROTOCOL.md)
    this.gameSeed = (Date.now() & 0x7FFFFFFF) || 1;
    this.setModel('GameModel');
  } // startGame

  applyGlobalData(global) {
    // ★ a data file that is not there yet arrives as null (db/appData.php), so
    // this must survive it: a missing file is a milestone that has not
    // happened, not a reason to refuse to start
    if (!global) {
      return;
    }
    this.globalData = global;
    this.lives = global.lives !== undefined ? global.lives : this.lives;
    // ★ the original **has** a hall of fame of its own (THE ULTIMATE HALL OF
    // FAME, $F4AA), so a preset HI out of the game's data is faithful
    if (global.hiScore && !this.hiScore) {
      this.hiScore = global.hiScore;
    }
  } // applyGlobalData

  setGlobalData(data) {
    this.applyGlobalData(data.data.global);

    var files = {};
    Object.keys(data.data).forEach((key) => {
      if (key == 'hiScore') {
        // the server's hall of fame wins over the game's preset one, but only
        // when somebody has actually beaten it
        this.hiScore = Math.max(this.hiScore || 0, data.data[key] || 0);
      } else if (key != 'global') {
        files[key] = data.data[key];
      }
    });
    // global goes last; a full localStorage is cleared and tried once more
    // (R-062)
    this.saveAppDataToStorage(files, data.data.global);
  } // setGlobalData

  // Load the application data: from the server when online (which also refreshes
  // localStorage), or rehydrate the global data from localStorage when offline.
  loadAppData() {
    if (navigator.onLine) {
      this.fetchDataId = this.fetchData('appData.db', false, {}, this, 2000);
    } else {
      this.loadGlobalDataFromStorage();
    }
  } // loadAppData

  loadGlobalDataFromStorage() {
    var stored = localStorage.getItem(window.appPrefix+'.global');
    if (stored !== null) {
      try {
        this.applyGlobalData(JSON.parse(stored));
        return true;
      } catch (error) {
        console.error(error.message);
      }
    }
    return false;
  } // loadGlobalDataFromStorage

  setData(data) {
    this.setGlobalData(data);
  } // setData

  errorData(error) {
    // The network request failed (offline, unreachable server, or the fetch
    // timeout). Fall back to the data cached in localStorage; if none exists,
    // log it and let the MenuModel guard surface the error to the user.
    if (!this.loadGlobalDataFromStorage()) {
      console.error(error.message ? error.message : error);
      return;
    }
    if (this.model && this.model.id == 'ZXResetModel'
        && !this.model.events.some((queued) => queued.id == 'setMenuModel')
        && !this.model.desktopEntity.modalEntity) {
      this.setModel('MenuModel');
    }
  } // errorData

  showErrorMessage(message, action) {
    var topModalEntity = this.model.desktopEntity.topModalEntity();
    topModalEntity.addModalEntity(
      new ZXErrorEntity(
        topModalEntity,
        -topModalEntity.absoluteX(),
        -topModalEntity.absoluteY(),
        this.fonts.zxFonts8x8,
        message,
        action,
        ZXColor.white,
        ZXColor.red
      )
    );
  } // showErrorMessage

} // GameApp
