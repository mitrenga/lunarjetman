# Nástroje projektu

Prefixy podle `../../METHODOLOGY.md`: `dump*` (data z originálu),
`trace*` (záznam z běhu), `match*` (porovnání), `mk*` (artefakty),
`*lib` (sdílené).

Spouští se z kořene projektu. SkoolKit 10.1 je **sdílený** ve
`app/svision/sources/skoolkit` (R-008), ne v projektu.

| nástroj | co dělá |
|---|---|
| `ljmlib.py` | **jedno místo, kde je napsané, co je na kazetě** a jak se z ní skládá obraz paměti: `tzx_blocks()`, `descramble()` (smyčka `RRD` z `$5B80`), `memory_image()`, `code_image()`, `loading_screen()`, `string_at()` |
| `tapinfo.py` | vypíše kazetu blok po bloku a zavaděč v BASICu → `sources/docs/tape_layout.md` |
| `mksnapshot.sh` | kazeta → `build/lunarjetman.z80` + `.bin`; ověří, že rozmíchaný kód souhlasí s `ljmlib.py` |
| `mkscreen.py` | `.scr` → `data/loading.json` pro variantu spuštění LOAD TAPE |
| `matchdescramble.py` | replika rozmíchávací smyčky proti paměti simulátoru — **31 745 kontrol, 0 rozdílů** |
| `matchloading.py` | loading screen: kazeta / `.scr` / `data/loading.json` / paměť — **20 736 kontrol, 0 rozdílů** |
| `playtrace.py` | běh v simulátoru se skriptovanými klávesami → snímky (PNG + SCR) a mapa pokrytí |
| `asmlib.py` | rozebrání kódu: rekurzivní sestup od `$8000` + mapa pokrytí |
| `mkasm.py` | disassembly → `sources/asm/lunarjetman.asm` (commituje se). Semínka: `$8000` + **skoková tabulka `$82C5`** + mapa z běhu |
| `dumpfont.py` | vlastní znaková sada originálu → `data/font.json` (+ `build/font.png`) |
| `dumptext.py` | všechny texty hry → `data/texts.json` |
| `dumpsprites.py` | grafika z tabulky `$BAC0` → `data/sprites.json` + `build/sprites.png` |
| `dumpmenu.py` | rozvržení menu `GAME SELECTION` (tabulky `$810E` a `$8115`) → `data/menu.json` |
| `mkscene.py` | statická herní obrazovka z originálu (většinový hlas) → `data/screen.json` |
| `mkglobal.py` | snímek tabulky entit `$6000`–`$623F` z běžícího originálu → `data/global.json` |
| `matchmenu.mjs` | menu bajt po bajtu **skutečným `app/screenComposer.js`** — **5 760 kontrol, 0 rozdílů** |
| `matchscreen.mjs` | celá obrazovka proti běžícímu originálu — **měřítko M2/M3**, ne akceptace |
| `runworker.mjs` | celý protokol workeru bez prohlížeče — **12 kontrol, 0 chyb** |
| `tracesound.py` | zvukové rutiny volané **přímo v simulátoru** → `data/sounds.json` (hrany v T-stavech) |
| `matchsound.mjs` | `app/beeper.js` proti originálu **pulz po pulzu** — **1 394 kontrol, 0 rozdílů** |
| `tracephysics.py` | stav Jetmana **průchod po průchodu** (dispečer `$81FB`, slot 5) → `build/physics.json` |
| `dumpterrain.py` | dlaždice `$F66E` a mapa `$F6CE` → `data/terrain.json` |
| `matchterrain.mjs` | řádek měsíčního povrchu skutečným `screenComposer.js` — **256 kontrol, 0 rozdílů** |
| `matchphysics.mjs` | `app/jetmanPhysics.js` proti záznamu krok po kroku — **4 371 kontrol, 2 rozdíly** |
| `dumppanel.py` | rozvržení panelu se skóre → `data/panel.json`; **sám si ho ověří proti snímkům** |
| `matchpanel.mjs` | panel skutečným `screenComposer.js`, tři snímky — **1 728 kontrol, 0 rozdílů** |
| `regress.mjs` | **otisk průletu proti minulému běhu** (`regress.baseline.json`, commituje se) — **6 otisků, 0 rozdílů** |
| `matchsprites.mjs` | celá hrací plocha z `data/` proti originálu; entity bere **z paměti**, ne z workeru — **21 888 kontrol, 92,2 % shoda** |
| `dumppanel.py` | rozvržení panelu se skóre → `data/panel.json`; **sám si ho ověří proti snímkům** |
| `matchpanel.mjs` | panel skutečným `screenComposer.js`, tři snímky — **1 728 kontrol, 0 rozdílů** |
| `regress.mjs` | **otisk průletu proti minulému běhu** (`regress.baseline.json`, commituje se) — **6 otisků, 0 rozdílů** |
| `matchsprites.mjs` | celá hrací plocha z `data/` proti originálu; entity bere **z paměti**, ne z workeru — **21 888 kontrol, 92,2 % shoda** |

Sdílené s ostatními projekty (v `app/svision/tools/retro/`): `skoolkit/`,
`scr2png.py`, `pngread.py`, `png.mjs`.

**Nové nástroje jsou `.mjs`**, ne `.js`: `package.json` v kořeni značí
repozitář jako ES moduly (R-001) a `../../STANDARDS.md` to tak chce.
Starší `.py` nástroje zůstávají v pythonu.

**`mkscreen.py` je tady potřetí** (sabrewulf, jetpac, lunarjetman) a je to
kandidát na přesun do `svision/tools/retro/` (R-008), ne na čtvrtou kopii.

`playtrace.py`, `asmlib.py` a `mkasm.py` jsou z jetpacu přenesené a upravené
(vstup `$8000`, rozsah `$8000–$FFFF`, jiná skoková tabulka, TZX místo TAP).
Jsou to **taky kandidáti na `svision/tools/retro/`** — `playtrace.py` je dnes
v projektech podruhé a liší se jen tabulkou kláves a výchozími hodnotami.
