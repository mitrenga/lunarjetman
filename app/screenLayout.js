// begin code

/**
 * Geometry of the Lunar Jetman screen, measured on the original rather than
 * off a photograph (sources/docs/screen_layout.md, hw_notes.md).
 *
 * The screen is the plain ZX Spectrum one: 256x192 pixels, attributes in 8x8
 * cells. Like Jetpac and unlike the room based remakes there is **no separate
 * panel surface**: the game prints the panel into the same video memory it
 * draws the moon into, so all 6912 bytes are one picture and ScreenComposer
 * builds all of it.
 *
 * ★ Measured on four independent frames taken off the running original
 * (tools/playtrace.py): the panel is character rows 0-4 and the play area
 * rows 5-23. The bottom two rows of the play area carry the surface of the
 * moon — row 22 has all 256 bitmap bytes set in every frame, row 23 is solid
 * paper.
 */
export const ScreenLayout = {

  WIDTH: 256,
  HEIGHT: 192,

  CELL: 8,
  COLS: 32,
  ROWS: 24,

  // ★ character rows 0-4, measured on four frames. Row 1 is the scores and is
  // the only row whose attributes are the same in every frame; rows 2-4 carry
  // the status band, whose colours move.
  PANEL_ROWS: 5,
  PANEL_HEIGHT: 40,

  // ★ the play area starts under the panel and runs to the bottom of the
  // screen; the surface of the moon is in rows 22-23
  PLAY_TOP: 40,
  PLAY_ROWS: 19,
  SURFACE_ROW: 22,

  // ★ the paper of the ground, read out of the captured frames: bright
  // magenta ($5B). It is the only attribute of row 23.
  ATTR_GROUND: 0x5B,
  // black screen behind everything (the game clears to zero)
  ATTR_SCREEN: 0x00,

  // 50.08 Hz — 69888 T states per frame on a 3.5 MHz Z80 (hw_notes.md).
  //
  // ★ Whether the original is tied to the frame at all is **not measured
  // yet**. Sabre Wulf turned out to take two frames per pass; Jetpac turned
  // out not to wait for the frame at all (1.593 passes per frame). Lunar
  // Jetman is by the same author and a year later and **neither may apply**,
  // so M1 ticks at the interrupt rate and everything measured in M3-M5 is
  // written down **per pass**, never per frame. The day the cadence is
  // measured, that is a change of time base rather than a re-measurement.
  FRAME_RATE: 3500000/69888

}; // ScreenLayout
