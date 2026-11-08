# Protokol mezi `gameModel.js` a `gameWorker.js`

Worker drží herní stav a tiká; model do něj posílá jen vstupy a kreslí to,
co dostane zpátky.

## ★ Stav je stav originálu

**Dvacet čtyři záznamů po dvaceti čtyřech bajtech**, `$6000`–`$623F`.
Hlavní smyčka originálu je obchází přes `IX`: `$8259` dělá `ADD IX,DE`
s `DE = $0018` a končí, když `IX` dojde na `$6240`. Každý záznam se
rozeskočí tabulkou **244 obsluh na `$82C5`** podle svého prvního bajtu;
tentýž bajt minus jedna indexuje **tabulku předloh na `$BAC0`**
(`sources/docs/disasm_notes.md` §3 a §9).

Ze čtyřiadvaceti bajtů záznamu jsou dnes **rozumíme dvěma**:

| offset | co to je |
|---|---|
| `+$00` | **typ** — index do tabulky obsluh `$82C5` i (−1) do tabulky předloh `$BAC0` |
| `+$07` | **atribut** |

Zbytek se nese **celý a nedotčený**. Je to záměr: M3–M5 ho budou číst po
jednom z obsluh, a do té doby by vymyšlený význam byl horší než žádný.
Právě proto má tabulka tvar originálu — aby mělo porovnání co s čím srovnávat.

Počáteční obsah tabulky **není vymyšlený**: je to snímek paměti originálu
na začátku života (`data/global.json`, `tools/mkglobal.py`).

## ★ Dvě kadence, protože je má originál

Smyčka normálně projde všech 24 slotů, ale `$8217` **přepíše operand vlastní
smyčky** na `$8262` na `$6078`, tedy na **prvních pět slotů**, a `$822F` tam
vrátí `$6240`. Pět slotů tedy běží na jiný rozvrh než ostatních devatenáct —
je to týž tvar, jaký se ukázal u Sabre Wulfa i u Jetpacu.

★ **Které to jsou, změřené je**: `$6078` je začátek slotu 5, takže zkrácená
smyčka pokrývá **sloty 0 až 4** — čtyři laserové střely a zvuk
(`sources/docs/disasm_notes.md` §11). Je to týž tvar jako u Sabre Wulfa
a Jetpacu.

? **Jak často se ten krátký průchod dělá, změřené není** (M3). M1 ten fakt
zapisuje a jede jeden průchod na tik.

### ★ Které sloty jsou co

| slot | co to je |
|---|---|
| 0–3 | laserové střely |
| 4 | zvuk (`$B950` sem kopíruje popis, `$B934` z něj hraje) |
| **5** | **Jetman** — `+$01` je napevno `$78`, tedy střed obrazovky |
| **6** | **vozidlo** |
| 7–23 | ? bomba, mosty, teleporty, nepřátelé (M4/M5) |

## ★ Tik je 50,08 Hz

Frekvence přerušení ULA (69 888 T-stavů na snímek).

? **Jestli je originál na snímek vůbec vázaný, změřené není.** Sabre Wulf
měl průchod na dva snímky, Jetpac na snímek nečekal vůbec (1,593 průchodu na
snímek). Lunar Jetman je od téhož autora o rok později a **nemusí platit ani
jedno**. Proto se všechno měřené v M3–M5 zapisuje **na průchod**, ne na
snímek: až se kadence změří, je to výměna časové osy, ne přeměření fyziky.

## Model → worker

| zpráva | pole | význam |
|---|---|---|
| `init` | `initData: {headless, players, hiScore, seed, global}` | start nové hry. `headless: true` tiká jen na vyžádání zprávou `tick` (pro `tools/runworker.js`). |
| `controls` | `left`, `right`, `thrust`, `fire`, `bomb` (boolean) | úplný stav ovládání; posílá se při každé změně a **celý**. |
| `pause` | – | zastaví tikání. |
| `continue` | – | pokračuje. |
| `tick` | – | jeden průchod v režimu `headless`. |
| `reset` | – | zahodí stav. |

### `initData`

| klíč | obsah |
|---|---|
| `players` | 1 nebo 2 — ★ volba z menu originálu (`GAME SELECTION`, `1 PLAYER GAME` / `2 PLAYER GAME`). |
| `hiScore` | nejvyšší skóre. ★ Originál **má vlastní síň slávy** (`THE ULTIMATE HALL OF FAME`, `$F4AA`), takže tohle je věrnost, ne přídavek. |
| `seed` | **semínko generátoru náhody** — od začátku, ne dodatečně (`../STANDARDS.md`). Bez něj se průlet nedá zopakovat a regres nemá o co opřít otisk. |
| `global` | `data/global.json` — snímek tabulky entit `$6000`–`$623F` a proměnných `$5E00`–`$5EFF` z běžícího originálu (`tools/mkglobal.py`). |

### ★ Náhoda

`Math.random()` v herní logice **nikdy** (`../METHODOLOGY.md`). Worker má
seedovaný xorshift (`nextRand`) a **dosaditelný zdroj**: `match*` nástroje
ho vymění a sypou do něj hodnoty nahrané z originálu „call by call".

? Kde bere náhodu originál (u Sabre Wulfa `LD A,R` + mixér `Rand8`), změřené
zatím není (M3). Až bude, reprodukuje se **mixér i prahy přesně** a nahradí
se jen vstupní entropie.

## Worker → model

| zpráva | pole | význam |
|---|---|---|
| `frame` | `pass`, `entities[]`, `panel`, `controls`, `sounds[]` | jeden průchod. Posílá se po každém tiku. |
| `gameOver` | `score` | konec hry (M4/M5). |
| `error` | `message` | chybějící data nebo rozbitý stav. |

### `frame`

| klíč | obsah |
|---|---|
| `pass` | počítadlo průchodů. |
| `entities[]` | `{slot, type, attr, raw}` pro všech 24 slotů; `raw` je těch 24 bajtů, jak leží v originálu. |
| `panel` | `{score, score2, hiScore, lives, lives2, player}`. ? `lives` je zatím `null` — **kolik životů originál dává, změřené není** a panel po stranách `HI` ukazuje něco, čemu zatím nerozumíme (`sources/docs/screen_layout.md`). |
| `controls` | stav ovládání, jak ho worker vidí. |
| `sounds[]` | co se má přehrát (M6). |

## Stav

**M1: worker tiká, drží stav originálu a nikým nehýbe.** Fyzika Jetmana
a vlečení vozidla je M3, cyklus kola M4, nepřátelé M5, zvuk M6 — a každý
z nich dorazí s vlastním `match*` nástrojem.

Hlídá to `tools/runworker.js`: projde celý protokol bez prohlížeče
a kontroluje, že tabulka má tvar originálu a že se seed opravdu propisuje.
