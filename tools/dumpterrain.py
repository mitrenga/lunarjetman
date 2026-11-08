#!/usr/bin/env python3
"""Vytahne popis mesicni krajiny -> data/terrain.json.

    ./tools/dumpterrain.py [data/terrain.json]

★ **Krajina neni bitmapa.** Je to **radka dlazdic**: tabulka osmibajtovych
dlazdic na `$F66E` a za ni **mapa na `$F6CE`**, ve ktere je **jeden bajt na
kazdy osmipixelovy sloupec sveta** a ten bajt je index do te tabulky.

To se nehada -- doklada to `tools/matchterrain.mjs`: na snimku z originalu,
kde teren nikdo nezakryva, se **vsech 32 sloupcu radky 22 slozi bajt po bajtu
z mapy** (256 kontrol, 0 rozdilu).

## Cisla

| co | hodnota |
|---|---|
| dlazdice | `$F66E`, 8 B na dlazdici (jedna znakova radka) |
| mapa | `$F6CE`, **1024 bajtu** = 1024 sloupcu = **8192 px sveta** |
| za mapou | nuly az do `$FBFD`, pak ocas zamichaneho bloku (`tape_layout.md`) |

★ **Delka 1024 neni odhad z dat, je v kodu**: `$91BB` maskuje svetove x
`AND $1F` na hornim bajtu (tedy na `$1FFF` = 8191) a deli osmi -> index
0..1023. Svet se timhle maskem **zacykli**.

★ **Za behu mapa nelezi na `$F6CE`, ale na `$7000`**: `$91BB` cte
`LD BC,$7000 / ADD HL,BC`. Je to kopie prvnich 1024 bajtu -- overeno proti
pameti simulatoru, **1024/1024 shoda**.

Abeceda je uzka: jen hodnoty `1, 2, 4, 11`. Dlazdice `11`
(`00 00 00 81 81 C3 E7 FF`) je vzacna, 19×.

## Jak se to kresli

★ Teren se posouva **po pixelech, ne po dlazdicich**: radka se sklada ze dvou
sousednich dlazdic posunutych o `worldX & 7`. Overeno na peti snimcich --
posun vzdy presne `worldX & 7`.

? Vyrez zacina na indexu `(worldX >> 3) - 15`, tedy **Jetman sedi ve sloupci
15** (jeho x na obrazovce je `$78` = 120 = sloupec 15, §11). Sedi to na trech
z peti zmerenych snimku; zbyle dva jsou z prubehu, ktery se mezitim rozesel
(smrt a novy zivot), takze se to **nebere jako uzavrene**.
"""
import argparse, base64, collections, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..')
sys.path.insert(0, HERE)
import ljmlib as L   # noqa: E402

TILES = 0xF66E
TILE_BYTES = 8
MAP = 0xF6CE
RUNTIME_MAP = 0x7000     # kam si ji hra za behu zkopiruje ($91BB)
MAP_LEN = 1024           # $91BB: world x AND $1FFF, pak /8 -> 0..1023
JETMAN_COLUMN = 15       # x na obrazovce $78 >> 3


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('dst', nargs='?', default=os.path.join(ROOT, 'data', 'terrain.json'))
    args = ap.parse_args()

    mem = L.memory_image()
    tilemap = L.peek(mem, MAP, MAP_LEN)
    used = sorted(set(tilemap))
    count = max(used) + 1
    tiles = L.peek(mem, TILES, count * TILE_BYTES)

    histogram = collections.Counter(tilemap)
    data = {
        'note': 'mesicni krajina z originalu (tools/dumpterrain.py): tabulka '
                'dlazdic $F66E po 8 B a mapa $F6CE po jednom bajtu na '
                'osmipixelovy sloupec. Kresli se posunute o worldX & 7',
        'tiles': {'address': '$%04X' % TILES, 'height': TILE_BYTES,
                  'width': 8, 'count': count,
                  'bytes': base64.b64encode(tiles).decode('ascii')},
        'map': {'address': '$%04X' % MAP, 'runtimeAddress': '$%04X' % RUNTIME_MAP,
                'length': MAP_LEN, 'worldWidth': MAP_LEN * 8,
                'bytes': base64.b64encode(tilemap).decode('ascii')},
        'row': 22,
        'jetmanColumn': JETMAN_COLUMN,
        'tilesUsed': used,
        'histogram': {str(k): v for k, v in sorted(histogram.items())},
    }
    os.makedirs(os.path.dirname(os.path.abspath(args.dst)), exist_ok=True)
    with open(args.dst, 'w') as f:
        json.dump(data, f, indent=1)
        f.write('\n')
    print('%d dlazdic, mapa %d sloupcu (%d px sveta), pouzite indexy %s -> %s'
          % (count, MAP_LEN, MAP_LEN * 8, used, args.dst))
    print('  cetnost: %s' % ', '.join('%d×%d' % (v, k) for k, v in sorted(histogram.items())))


if __name__ == '__main__':
    main()
