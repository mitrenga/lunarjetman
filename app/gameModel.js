const { AbstractModel } = await import('./svision/js/abstractModel.js?ver='+window.srcVersion);
const { BorderEntity } = await import('./borderEntity.js?ver='+window.srcVersion);
const { TextEntity } = await import('./svision/js/platform/canvas2D/textEntity.js?ver='+window.srcVersion);
const { PauseGameEntity } = await import('./pauseGameEntity.js?ver='+window.srcVersion);
const { ZXColor } = await import('./svision/js/platform/canvas2D/zx/zxColor.js?ver='+window.srcVersion);
const { ScreenLayout } = await import('./screenLayout.js?ver='+window.srcVersion);
const { ScreenComposer } = await import('./screenComposer.js?ver='+window.srcVersion);
const { GameAreaEntity } = await import('./gameAreaEntity.js?ver='+window.srcVersion);
// begin code

/**
 * The game screen — the moon, which in the original scrolls sideways
 * (sources/docs/screen_layout.md).
 *
 * The whole 256x192 picture is one {@link GameAreaEntity}, panel and all,
 * because that is how the game holds it: the panel is printed into the same
 * video memory as the game. ScreenComposer builds those 6912 bytes, and
 * tools/matchscreen.js checks the result against the original's own video
 * memory byte for byte.
 *
 * The worker (gameWorker.js, WORKER-PROTOCOL.md) keeps the state and ticks;
 * this model routes the controls into it and draws what comes back.
 *
 * ★ **M1 shows the screen a life starts on and nothing moves yet, and the
 * background is a picture captured off the original** (data/screen.json,
 * tools/mkscene.py). That is deliberate on both counts: the physics is M3 and
 * will arrive with numbers read out of the program rather than invented here,
 * and how the terrain is described is M2 — composing the moon out of data
 * that has not been measured would mean making it up. Every byte on the
 * screen is still a byte the original drew.
 */
export class GameModel extends AbstractModel {

  constructor(app) {
    super(app);
    this.id = 'GameModel';

    this.gameOver = false;
    // ★ The original reads **whole rows of keys**, not particular keys
    // ($8F9F): the number row, the Q-P row, the A-ENTER row, and the bottom
    // row split between X/V/N and C/M/SPACE — five bits in all, plus Kempston
    // ($8F9B, IN A,($1F)) and Cursor. CAPS, Z, B and SYM are not read at all
    // (sources/docs/disasm_notes.md chap. 4).
    // ? **Which of the five bits is which action is not measured yet**, so
    // these five names are the remake's working set and M3 will pin them to
    // the original's bits.
    this.controlsState = {left: false, right: false, thrust: false, fire: false,
                          bomb: false};
    this.worker = null;
    this.render = null;
    this.gameAreaEntity = null;
    this.fpsEntity = null;
    this.inputEntity = null;
    this.fps = {frames: 0, workerFrames: 0, ticks: 0, since: false, lastPass: false};
    // a touch that is shorter than one pass of the worker has to be held
    this.heldTaps = {};
  } // constructor

  init() {
    super.init();

    // ★ $608A does XOR A / OUT ($FE),A before every level, so the border is
    // black and the game never touches it again — there is nothing in the
    // program that writes to it a second time.
    this.borderEntity.bkColor = ZXColor.black;
    this.desktopEntity.bkColor = ZXColor.black;

    this.sendEvent(0, {id: 'openAudioBus', bus: 'sounds',
                       options: {muted: this.app.muted.sounds}});

    // the data files: at once from localStorage, or from the server when
    // they are missing there (R-062)
    this.loadDataFiles(['global', 'screen', 'sprites', 'font', 'terrain', 'sounds'], (files, error) => this.initData(files, error));
  } // init

  /**
   * The part of init() that needs the data files. Runs inside init() when
   * they are in localStorage, later when they had to come from the server.
   * @param {Object|null} files - The data files, or null.
   * @param {Error} [error] - Why they are missing.
   */
  initData(files, error) {
    if (this.app.model !== this) {
      return;
    }
    if (!files) {
      this.app.showErrorMessage(error ? error.message : 'Game data could not be loaded.', 'restart');
    }
    if (!this.initScreen()) {
      this.desktopEntity.addEntity(new TextEntity(this.desktopEntity, this.app.fonts.zxFonts8x8, 0, 8*8, this.desktopWidth, 8, 'LUNAR JETMAN', ZXColor.brightWhite, false, {align: 'center'}));
      this.desktopEntity.addEntity(new TextEntity(this.desktopEntity, this.app.fonts.fonts5x5, 8, 8*8+16, this.desktopWidth-16, 40,
        'GAME DATA MISSING (data/screen.json, data/sprites.json, data/font.json, data/terrain.json, data/global.json). RUN tools/mkscene.py, tools/dumpsprites.py, tools/dumpfont.py, tools/dumpterrain.py AND tools/mkglobal.py.', ZXColor.brightGreen, false, {align: 'center', textWrap: true}));
      return;
    }

    if (this.app.devModeName !== false) {
      this.fpsEntity = new TextEntity(this.desktopEntity, this.app.fonts.fonts3x3, 16*8, 2, 10*8, 4, '', ZXColor.brightGreen, false, {align: 'right'});
      this.desktopEntity.addEntity(this.fpsEntity);
      this.inputEntity = new TextEntity(this.desktopEntity, this.app.fonts.fonts3x3, 16*8, 8, 10*8, 4, '', ZXColor.brightCyan, false, {align: 'right'});
      this.desktopEntity.addEntity(this.inputEntity);
    }

    this.showTouchIcons();

    this.worker = this.app.worker;
    this.app.inputEventsManager.sendEventsActiveKeys('Press');
    this.sendWorkerMessage({
      id: 'init',
      initData: {
        headless: false,
        players: this.app.players,
        hiScore: this.app.hiScore,
        // ★ the seed of the game's randomness, from the first line of the
        // project rather than bolted on later (../STANDARDS.md): without it a
        // run cannot be repeated and a regression has no fingerprint
        seed: this.app.gameSeed || 1,
        // the entity table as the original has it when a life starts —
        // a snapshot of its memory, not a template we wrote (tools/mkglobal.py)
        global: this.globalData
      }
    });
  } // initData

  shutdown() {
    super.shutdown();
    this.sendWorkerMessage({id: 'reset'});
    this.sendEvent(0, {id: 'stopAllAudioBuses'});
  } // shutdown

  /**
   * Builds the renderer and adds the screen.
   * @returns {boolean} True when the screen was created.
   */
  initScreen() {
    this.globalData = this.loadDataFile('global');
    var scene = this.loadDataFile('screen');
    var gfx = this.loadDataFile('sprites');
    // ★ the game's **own** character set, out of its own memory ($D347) —
    // svision's ROM font is deliberately not a fallback, because unlike Sabre
    // Wulf and Jetpac this game does not print with it
    // (sources/docs/disasm_notes.md chap. 2)
    var font = this.loadDataFile('font');
    // ★ the moon: tiles at $F66E and a map at $F6CE, one byte per eight pixel
    // columns of the world (disasm_notes.md chap. 13). Checked against the
    // original byte for byte by tools/matchterrain.mjs
    var terrain = this.loadDataFile('terrain');
    if (!scene) {
      return false;
    }
    this.gfxData = gfx;
    try {
      this.render = new ScreenComposer(scene, gfx, font, terrain);
    } catch (error) {
      console.error(error.message);
      return false;
    }
    this.gameAreaEntity = new GameAreaEntity(this.desktopEntity, 0, 0, this.render);
    this.desktopEntity.addEntity(this.gameAreaEntity);
    return true;
  } // initScreen

  sendWorkerMessage(event) {
    if (this.worker) {
      this.worker.postMessage(event);
    }
  } // sendWorkerMessage

  /**
   * Sets one control and sends the whole state over when it changed. The whole
   * state goes rather than the change, because left and thrust held together
   * are a diagonal climb, not a conflict.
   * @param {string} action - The control action.
   * @param {boolean} value - Pressed or released.
   */
  setControl(action, value) {
    if (!(action in this.controlsState) || this.controlsState[action] === value) {
      return;
    }
    this.controlsState[action] = value;
    this.sendWorkerMessage(Object.assign({id: 'controls'}, this.controlsState));
  } // setControl

  handleEvent(event) {
    if (super.handleEvent(event)) {
      return true;
    }

    switch (event.id) {

      case 'exitGame':
        this.app.setModel('MenuModel');
        return true;

      case 'blurWindow':
        this.pauseGame();
        return true;

      case 'continueGame':
        this.sendWorkerMessage({id: 'continue'});
        this.sendEvent(0, {id: 'continueAllAudioBuses'});
        return true;

      case 'releaseTouchAction':
        if (this.heldTaps[event.action]) {
          this.heldTaps[event.action]--;
        }
        this.releaseTouchAction(event.action);
        return true;

      case 'keyPress':
        var key = event.key;
        if (key.length == 1) {
          key = key.toUpperCase();
        }
        switch (key) {
          // ★ The original pauses while CAPS SHIFT is **held** ($69BD spins in
          // place) and has no pause screen at all. The remake binds Escape to
          // a pause panel instead, as the sibling remakes do — a browser tab
          // that loses focus has to stop somewhere (ZADANI chap. 10).
          case 'Escape':
          case 'GamepadExit':
            this.pauseGame();
            return true;
          case 'Touch':
            if (this.borderEntity.leftControlEntity && this.borderEntity.leftControlEntity.pointOnEntity(event)) {
              this.app.inputEventsManager.touchesMap[event.identifier] = this.borderEntity.leftControlEntity;
              this.touchStart(event, 'left', this.borderEntity.leftControlEntity);
              return true;
            }
            if (this.borderEntity.rightControlEntity && this.borderEntity.rightControlEntity.pointOnEntity(event)) {
              this.app.inputEventsManager.touchesMap[event.identifier] = this.borderEntity.rightControlEntity;
              this.touchStart(event, 'right', this.borderEntity.rightControlEntity);
              return true;
            }
            break;
          case 'RetryTouch':
            this.setControl(event.action, true);
            return true;
          case this.app.controls.keyboard.sounds:
            this.app.muted.sounds = !this.app.muted.sounds;
            this.sendEvent(0, {id: 'muteAudioBus', bus: 'sounds', muted: this.app.muted.sounds});
            return true;
        }
        var action = this.controlAction(key);
        if (action !== false) {
          this.setControl(action, true);
          return true;
        }
        break;

      case 'keyRelease':
        var releasedKey = event.key;
        if (releasedKey.length == 1) {
          releasedKey = releasedKey.toUpperCase();
        }
        if (releasedKey == 'Touch') {
          this.touchEnd(event);
          return true;
        }
        var releasedAction = this.controlAction(releasedKey);
        if (releasedAction !== false) {
          this.setControl(releasedAction, false);
          return true;
        }
        break;

      case 'keyMove':
        if (event.key == 'Touch') {
          this.touchMove(event);
          return true;
        }
        break;

      case 'errorAudioBus':
        this.app.showErrorMessage(event.error, 'reopen');
        return true;
    }

    return false;
  } // handleEvent

  /** pauses the worker and opens the pause menu */
  pauseGame() {
    if (this.desktopEntity.modalEntity || this.gameOver) {
      return;
    }
    this.sendWorkerMessage({id: 'pause'});
    this.sendEvent(0, {id: 'pauseAllAudioBuses'});
    this.desktopEntity.addModalEntity(new PauseGameEntity(this.desktopEntity, 52, 34, 153, 97, 'PAUSE GAME', 'MenuModel'));
  } // pauseGame

  handleWorkerMessage(event) {
    var data = event.data;
    switch (data.id) {
      case 'frame':
        this.fps.workerFrames++;
        if (this.fps.lastPass !== false && data.pass > this.fps.lastPass) {
          this.fps.ticks += data.pass-this.fps.lastPass;
        }
        this.fps.lastPass = data.pass;
        if (data.panel) {
          this.app.score = data.panel.score;
          this.app.score2 = data.panel.score2;
          this.app.hiScore = data.panel.hiScore;
          this.app.lives = data.panel.lives;
          this.app.player = data.panel.player;
        }
        if (this.gameAreaEntity) {
          this.gameAreaEntity.setFrame(data);
        }
        if (this.inputEntity && data.controls) {
          var held = Object.keys(data.controls).filter((key) => data.controls[key]);
          this.inputEntity.setText(held.length ? held.join(' ').toUpperCase() : '-');
        }
        if (data.sounds && data.sounds.length && this.app.audioManager) {
          this.app.audioManager.playFrame(data);
        }
        break;
      case 'gameOver':
        if (!this.gameOver) {
          this.gameOver = true;
          this.app.score = data.score;
          this.app.setModel('GameOverModel');
        }
        break;
      case 'error':
        console.error(data.message);
        break;
    }
  } // handleWorkerMessage


  /**
   * Maps a key or gamepad event onto a control action.
   *
   * The keyboard keys are **only** the configured ones (`app.controls.keyboard`
   * — arrows and SPACE by default, remapped from SETTINGS); nothing is
   * accepted beside them, so a remapped key never keeps a hidden second
   * meaning. The gamepad keys are the fixed names the library gives its
   * buttons. The mouse is not a game control here — it serves the buttons and
   * the menu. The original is played on Q W E R T — Q left, W right, E up,
   * R down, T the combat button (ZADANI chap. 1); whoever wants that sets it.
   * @param {string} key - The event key.
   * @returns {string|false} The action, or false.
   */
  controlAction(key) {
    var kb = this.app.controls.keyboard;
    switch (key) {
      case kb.left: case 'GamepadLeft': return 'left';
      case kb.right: case 'GamepadRight': return 'right';
      case kb.up: case 'GamepadUp': case 'GamepadJump': return 'up';
      case kb.down: case 'GamepadDown': return 'down';
      case kb.sword: case 'GamepadFire': case 'GamepadOK': return 'sword';
    }
    return false;
  } // controlAction

  /**
   * What this half of the screen does: an eight-way stick or the sword
   * (controlsOptions.touchscreen.halves). Which half is which is the
   * left-handed / right-handed choice in SETTINGS.
   * @param {string} side - 'left' or 'right'.
   * @returns {Object} {icon, zones}
   */
  touchHalf(side) {
    var ts = this.app.controlsOptions.touchscreen;
    return ts.halves[ts.types[this.app.controls.touchscreen.type][side].half];
  } // touchHalf

  /**
   * Icons into the border: what each half of the screen does. The border draws
   * them only where there is room for them outside the play area.
   */
  showTouchIcons() {
    if (!this.app.controls.touchscreen.supported || !this.borderEntity) {
      return;
    }
    var icons = this.app.controlsOptions.touchscreen.icons;
    this.borderEntity.setGameControlIcons(icons[this.touchHalf('left').icon],
                                          icons[this.touchHalf('right').icon]);
  } // showTouchIcons

  /**
   * The zone of the layout under the finger. `rect` is a fraction of the half,
   * so it is worked out from where on that half the finger is, not from pixels.
   * @param {Object} event - The touch event (x, y).
   * @param {string} side - 'left' or 'right'.
   * @param {Object} entity - The half of the screen (borderEntity).
   * @returns {Object|false} The zone, or false.
   */
  touchZone(event, side, entity) {
    var half = this.touchHalf(side);
    var width = Math.max(entity.width, 1), height = Math.max(entity.height, 1);
    var rx = (event.x-(entity.parentX+entity.x))/width;
    var ry = (event.y-(entity.parentY+entity.y))/height;
    for (var z = 0; z < half.zones.length; z++) {
      var r = half.zones[z].rect;
      if (rx >= r[0] && rx <= r[0]+r[2] && ry >= r[1] && ry <= r[1]+r[3]) {
        return half.zones[z];
      }
    }
    return false;
  } // touchZone

  /**
   * A new touch on a half of the screen. There can be several at once: each
   * keeps its own record in `touchesGameControls` and the control state is
   * their sum, so flying and firing go together, and so do left and thrust.
   * @param {Object} event - The touch event.
   * @param {string} side - 'left' or 'right'.
   * @param {Object} entity - The half of the screen.
   */
  touchStart(event, side, entity) {
    var zone = this.touchZone(event, side, entity);
    var control = {side: side, entity: entity, action: false,
                   type: zone === false ? 'none' : zone.type,
                   control: zone === false ? false : zone.control,
                   actions: zone === false ? false : zone.actions,
                   tap: zone !== false && zone.type == 'button' && !!zone.tap,
                   since: this.app.now,
                   origin: {x: event.x, y: event.y},
                   at: {x: event.x, y: event.y}};
    this.app.inputEventsManager.touchesGameControls[event.identifier] = control;
    // A button holds its action from the moment the finger lands; the stick
    // does nothing until the finger moves, so a tap on it sends nothing.
    if (zone !== false && zone.type == 'button') {
      control.action = zone.action;
      this.setControl(zone.action, true);
    }
  } // touchStart

  /**
   * The finger came up. A short tap has to be **held**: the worker reads the
   * controls once per pass of the main loop (50.08 Hz), so a tap shorter than
   * one pass would never be seen at all.
   * @param {Object} event - The touch event.
   */
  touchEnd(event) {
    var controls = this.app.inputEventsManager.touchesGameControls;
    var control = controls[event.identifier];
    if (control === undefined) {
      return;
    }
    delete controls[event.identifier];
    if (control.action === false) {
      return;
    }
    var rest = this.app.controlsOptions.touchscreen.tapHoldTime-(this.app.now-control.since);
    if (control.tap && rest > 0) {
      this.heldTaps[control.action] = (this.heldTaps[control.action] || 0)+1;
      this.sendEvent(rest, {id: 'releaseTouchAction', action: control.action});
      return;
    }
    [].concat(control.action).forEach((action) => this.releaseTouchAction(action));
  } // touchEnd

  /**
   * Releases an action, but only when no other finger is still holding it —
   * two fingers on the same action must not cancel each other.
   * @param {string} action - The control action.
   */
  releaseTouchAction(action) {
    if (this.heldTaps[action]) {
      return;
    }
    var controls = this.app.inputEventsManager.touchesGameControls;
    var held = Object.keys(controls).some((id) => controls[id].action !== false
                                                  && [].concat(controls[id].action).indexOf(action) !== -1);
    if (!held) {
      this.setControl(action, false);
    }
  } // releaseTouchAction

  /**
   * The finger moved. The stick is **absolute**: the direction is where the
   * finger has moved to from where it landed, with a dead zone of
   * `joystickStep` in the middle. It holds two directions at once, because
   * the original walks in eight directions and a diagonal is two of them.
   * @param {Object} event - The touch event.
   */
  touchMove(event) {
    var controls = this.app.inputEventsManager.touchesGameControls;
    var control = controls[event.identifier];
    if (control === undefined || control.type != 'joystick') {
      return;
    }
    control.at = {x: event.x, y: event.y};
    var step = this.app.controlsOptions.touchscreen.joystickStep;
    var axis = {x: false, y: false};
    if (control.control == 'horizontal' || control.control == 'both') {
      if (event.x-control.origin.x < -step) { axis.x = control.actions.left; }
      if (event.x-control.origin.x > step) { axis.x = control.actions.right; }
    }
    if (control.control == 'vertical' || control.control == 'both') {
      if (event.y-control.origin.y < -step) { axis.y = control.actions.up; }
      if (event.y-control.origin.y > step) { axis.y = control.actions.down; }
    }
    var next = [axis.x, axis.y].filter((action) => action !== false);
    var previous = control.action === false ? [] : [].concat(control.action);
    if (previous.length == next.length && previous.every((action) => next.indexOf(action) !== -1)) {
      return;
    }
    control.action = next.length == 0 ? false : (next.length == 1 ? next[0] : next);
    previous.forEach((action) => {
      if (next.indexOf(action) === -1) {
        this.releaseTouchAction(action);
      }
    });
    next.forEach((action) => this.setControl(action, true));
  } // touchMove

  /**
   * The finger moved. The stick is **absolute**: the direction is where the
   * finger has moved to from where it landed, with a dead zone of
   * `joystickStep` in the middle. It holds two directions at once, because
   * the original walks in eight directions and a diagonal is two of them.
   * @param {Object} event - The touch event.
   */
  touchMove(event) {
    var controls = this.app.inputEventsManager.touchesGameControls;
    var control = controls[event.identifier];
    if (control === undefined || control.type != 'joystick') {
      return;
    }
    control.at = {x: event.x, y: event.y};
    var step = this.app.controlsOptions.touchscreen.joystickStep;
    var axis = {x: false, y: false};
    if (control.control == 'horizontal' || control.control == 'both') {
      if (event.x-control.origin.x < -step) { axis.x = control.actions.left; }
      if (event.x-control.origin.x > step) { axis.x = control.actions.right; }
    }
    if (control.control == 'vertical' || control.control == 'both') {
      if (event.y-control.origin.y < -step) { axis.y = control.actions.up; }
      if (event.y-control.origin.y > step) { axis.y = control.actions.down; }
    }
    var next = [axis.x, axis.y].filter((action) => action !== false);
    var previous = control.action === false ? [] : [].concat(control.action);
    if (previous.length == next.length && previous.every((action) => next.indexOf(action) !== -1)) {
      return;
    }
    control.action = next.length == 0 ? false : (next.length == 1 ? next[0] : next);
    previous.forEach((action) => {
      if (next.indexOf(action) === -1) {
        this.releaseTouchAction(action);
      }
    });
    next.forEach((action) => this.setControl(action, true));
  } // touchMove

  updateFps(timestamp) {
    if (!this.fpsEntity) {
      return;
    }
    this.fps.frames++;
    if (this.fps.since === false) {
      this.fps.since = timestamp;
      return;
    }
    var elapsed = timestamp-this.fps.since;
    if (elapsed >= 1000) {
      this.fpsEntity.setText(Math.round(this.fps.frames*1000/elapsed)+'/'+Math.round(this.fps.workerFrames*1000/elapsed)+'/'+Math.round(this.fps.ticks*1000/elapsed)+' FPS');
      this.fps.frames = 0;
      this.fps.workerFrames = 0;
      this.fps.ticks = 0;
      this.fps.since = timestamp;
    }
  } // updateFps

  /**
   * The finger moved. The stick is **absolute**: the direction is where the
   * finger has moved to from where it landed, with a dead zone of
   * `joystickStep` in the middle. It holds two directions at once, because
   * the original walks in eight directions and a diagonal is two of them.
   * @param {Object} event - The touch event.
   */
  touchMove(event) {
    var controls = this.app.inputEventsManager.touchesGameControls;
    var control = controls[event.identifier];
    if (control === undefined || control.type != 'joystick') {
      return;
    }
    control.at = {x: event.x, y: event.y};
    var step = this.app.controlsOptions.touchscreen.joystickStep;
    var axis = {x: false, y: false};
    if (control.control == 'horizontal' || control.control == 'both') {
      if (event.x-control.origin.x < -step) { axis.x = control.actions.left; }
      if (event.x-control.origin.x > step) { axis.x = control.actions.right; }
    }
    if (control.control == 'vertical' || control.control == 'both') {
      if (event.y-control.origin.y < -step) { axis.y = control.actions.up; }
      if (event.y-control.origin.y > step) { axis.y = control.actions.down; }
    }
    var next = [axis.x, axis.y].filter((action) => action !== false);
    var previous = control.action === false ? [] : [].concat(control.action);
    if (previous.length == next.length && previous.every((action) => next.indexOf(action) !== -1)) {
      return;
    }
    control.action = next.length == 0 ? false : (next.length == 1 ? next[0] : next);
    previous.forEach((action) => {
      if (next.indexOf(action) === -1) {
        this.releaseTouchAction(action);
      }
    });
    next.forEach((action) => this.setControl(action, true));
  } // touchMove

  updateFps(timestamp) {
    if (!this.fpsEntity) {
      return;
    }
    this.fps.frames++;
    if (this.fps.since === false) {
      this.fps.since = timestamp;
      return;
    }
    var elapsed = timestamp-this.fps.since;
    if (elapsed >= 1000) {
      this.fpsEntity.setText(Math.round(this.fps.frames*1000/elapsed)+'/'+Math.round(this.fps.workerFrames*1000/elapsed)+'/'+Math.round(this.fps.ticks*1000/elapsed)+' FPS');
      this.fps.frames = 0;
      this.fps.workerFrames = 0;
      this.fps.ticks = 0;
      this.fps.since = timestamp;
    }
  } // updateFps

  loopModel(timestamp) {
    super.loopModel(timestamp);

    if (this.desktopEntity.modalEntity) {
      this.desktopEntity.modalEntity.loopEntity(timestamp);
    }

    this.updateFps(timestamp);
    this.drawModel();
  } // loopModel

} // GameModel
