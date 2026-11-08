const { ZXVideoRAMEntity } = await import('./svision/js/platform/canvas2D/zx/zxVideoRAMEntity.js?ver='+window.srcVersion);
const { ScreenLayout } = await import('./screenLayout.js?ver='+window.srcVersion);
const { ScreenComposer } = await import('./screenComposer.js?ver='+window.srcVersion);
// begin code

/**
 * The screen: **all of it**, 256x192, panel included.
 *
 * Lunar Jetman prints its panel into the same video memory it draws the moon
 * into, so splitting the two would be a remake's idea rather than the game's.
 *
 * The memory, the painting and the off-screen cache are svision's
 * {@link ZXVideoRAMEntity} (R-003, R-022). What is left here is feeding it
 * with a frame from the worker, which ScreenComposer turns into 6912 bytes.
 */
export class GameAreaEntity extends ZXVideoRAMEntity {

  /**
   * @param {AbstractEntity} parentEntity - The parent entity.
   * @param {number} x - X position relative to the parent.
   * @param {number} y - Y position relative to the parent.
   * @param {ScreenComposer} render - The shared renderer.
   */
  constructor(parentEntity, x, y, render) {
    super(parentEntity, x, y,
          {col: 0, row: 0, cols: ScreenLayout.COLS, rows: ScreenLayout.ROWS});
    this.id = 'GameAreaEntity';

    this.render = render;
    this.frameState = {};
  } // constructor

  /**
   * The screen the menu, the hall of fame and the about page sit on: the
   * game's own picture, so they look like the game rather than like a web
   * page. It is built by the same composer out of the same data.
   * @param {AbstractModel} model - The model that owns the desktop.
   * @returns {ZXVideoRAMEntity|null} The screen, added to the desktop.
   */
  static panelScreen(model) {
    var scene = model.loadDataFile('screen');
    if (!scene) {
      return null;
    }
    try {
      var render = new ScreenComposer(scene, model.loadDataFile('sprites'),
                                      model.loadDataFile('font'),
                                      model.loadDataFile('terrain'));
      var screen = new ZXVideoRAMEntity(model.desktopEntity, 0, 0);
      render.clearScreen(screen.videoRAM);
      screen.invalidate();
      model.desktopEntity.addEntity(screen);
      return screen;
    } catch (error) {
      console.error(error.message);
      return null;
    }
  } // panelScreen

  /**
   * Stores the newest frame and invalidates the cache.
   * @param {Object} state - The 'frame' message of the worker.
   */
  setFrame(state) {
    this.frameState = state;
    this.invalidate();
  } // setFrame

  /**
   * Composes the screen. Called only when the cache is dirty, so the pixel
   * work happens once per game pass rather than once per display frame.
   */
  compose() {
    this.render.composeInto(this.videoRAM, this.frameState);
  } // compose

} // GameAreaEntity
