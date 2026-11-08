![](/images/app-icon-256x256.png)

LUNAR JETMAN
=====================
The 1983 classic, reborn for modern web browsers.

## About
Originally written in 1983 by Ultimate Play The Game for the 48K ZX Spectrum,
as the sequel to Jetpac. This will be a faithful remake based on the original
ZX Spectrum version — not an emulator and not a binary copy.

**Status: analysis in progress (M0).** The tape has been taken apart, the
game code has been descrambled and verified against an emulator, and the
loading screen has been extracted. There is no application yet — see
`ZADANI.md` (specification), `MILNIKY.md` (milestones) and
`sources/docs/tape_layout.md` (what is actually on the tape).

## Planned
- 256×192 + border, integer scaling, `ZXPlatform`
- graphics extracted from the original program, not redrawn
- 1-bit beeper sound reproduced in Z80 T-states
- keyboard, gamepad, touch, PWA

## Requirements (once the app exists)
- PHP 8.1+
- nginx
- MySQL / MariaDB
- Node.js + terser, for building the bundle (`npm i -g terser`)
- es-check, for the ES2018 gate in `svtool verify` (`npm i -g es-check`)
- Python 3, only for the tools that extract and verify the data of the original

The remake will also offer **LOAD TAPE** as one of the ways to start the game:
the pilot tone, the border stripes, the headers and the loading screen loaded
for real, byte by byte, because the sound *is* the 6912 bytes of the picture.
That is why the tape image (TZX) is the source this project is built from.

The original tape image is copyrighted and is **not** part of this repository —
it is needed only to regenerate the game data, see `sources/tape/README.md`.

## License
See the [LICENSE](LICENSE) file. *(To be added in M1.)*
