# Data vytažená z originálu

Commituje se. Každý soubor má nástroj, který ho vyrobí — jinak by to nebyl
podklad, ale ruční práce.

| soubor | co v něm je | vyrábí |
|---|---|---|
| `loading.json` | loading screen z kazety (blok SCREEN$ `JMSP`), celá videopaměť `$4000–$5AFF` tak, jak leží v paměti stroje | `tools/mkscreen.py` |
| `font.json` | **vlastní znaková sada originálu** z `$D347`, 64 glyfů 8×8 od kódu `$20`. Hra netiskne ROM fontem Spectra — na rozdíl od Sabre Wulfa i Jetpacu | `tools/dumpfont.py` |
| `texts.json` | všech 27 textů hry i s adresou a atributem; konec řetězce je bit 7 na posledním znaku | `tools/dumptext.py` |
| `sprites.json` | 209 předloh z tabulky `$BAC0` (index = typ entity − 1). Dva formáty, **řádky odspodu nahoru**, kreslí se **XOR** bez masky, posun 0–7 px za běhu | `tools/dumpsprites.py` |
| `menu.json` | rozvržení menu `GAME SELECTION`: pozice z `$8115`, atributy z `$810E`, sloupec 7; k tomu pozadí a pravidlo, že **vybraný počet hráčů a vybrané ovládání blikají** | `tools/dumpmenu.py` |
| `screen.json` | **statická herní obrazovka zachycená z originálu** (většinový hlas z 24 vzorků, 98,1 % bajtů jednomyslných). ★ Prozatímní: v M2 to nahradí složení z `terrain.json` a `sprites.json` | `tools/mkscene.py` |
| `global.json` | **snímek tabulky entit** `$6000`–`$623F` (24 slotů po 24 bajtech) a proměnných `$5E00`–`$5EFF` z běžícího originálu. Není to šablona, kterou bychom napsali | `tools/mkglobal.py` |
| `sounds.json` | deset zvukových rutin nahraných **voláním přímo v simulátoru**; hrana je `[T-stav od začátku rutiny, stav reproduktoru]` | `tools/tracesound.py` |
| `terrain.json` | **měsíční krajina**: dlaždice z `$F66E` a mapa z `$F6CE`, **1024 sloupců = 8192 px** světa (délka je v kódu: `$91BB` maskuje `AND $1F`). Roluje se po pixelech (`worldX & 7`). ★ Za běhu hra čte **kopii na `$7000`**, kterou mění — kolize se ptají jí, ne tohohle souboru | `tools/dumpterrain.py` |
| `panel.json` | rozvržení panelu se skóre (řádky 0–1): pozice a atributy `1UP` / `HI` / `2UP`, obou skóre a čítačů, plus ikonka z `$D151` | `tools/dumppanel.py` |

Přibude v M2–M4: `levels.json` — a v M7
`cadence.json`, pokud se ukáže, že hlavní smyčka na snímek nečeká.
