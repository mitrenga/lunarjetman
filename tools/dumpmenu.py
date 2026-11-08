#!/usr/bin/env python3
"""Vytahne rozvrzeni menu `GAME SELECTION` -> data/menu.json.

    ./tools/dumpmenu.py [data/menu.json]

Menu tiskne `$80D1` a **vsechno, co k tomu potrebuje, je v tabulkach**:

    $80D1  LD DE,$810E     ; atributy, sedm bajtu
           EXX
           LD HL,$8115     ; pozice, sedm bajtu
           LD DE,$811C     ; retezce, sedm za sebou
           LD B,$07
    ...    LD A,(HL) / LD H,A / LD L,$38 / CALL $81AB

★ Odectene, ne odmerene z obrazku:

- **`$810E`**: sedm atributu, vsechny `$47` (bright white)
- **`$8115`**: sedm pozic -- `$20 $38 $48 $58 $68 $78 $98`, coz je **y
  v pixelech**, tedy znakove radky 4, 7, 9, 11, 13, 15 a 19
- **`$38`** v `L`: sloupec 7
- `$811C` a dal: sedm retezcu ukoncenych bitem 7 (`data/texts.json`)
- `$818A`: radek s copyrightem, jeho **prvni bajt je atribut** ($45)

A dve veci odmerene na snimku z originalu
(`sources/media/screens/menu.scr`):

- pozadi menu je **`$43`** ve sloupcich 1-30; krajni sloupce **0 a 31** maji
  `$00`, takze menu ma po stranach cerny ram siroky jednu bunku
- **vybrany pocet hracu a vybrane ovladani blikaji** -- jejich radky maji
  atribut `$C7`, tedy `$47` s bitem 7. Je to pravidlo hry, ne dekorace

Overuje to `tools/matchmenu.js`: postavi menu **skutecnym kodem, ktery jde do
prohlizece** (`app/screenComposer.js`) a porovna bajt po bajtu s videopameti
originalu.
"""
import argparse, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..')
sys.path.insert(0, HERE)
import ljmlib as L   # noqa: E402

ATTRS = 0x810E       # sedm atributu
POSITIONS = 0x8115   # sedm pozic (y v pixelech)
STRINGS = 0x811C     # sedm retezcu za sebou
COPYRIGHT = 0x818A
COLUMN = 7           # `LD L,$38` -> $38 >> 3
LINES = 7
BACKGROUND = 0x43    # odmereno na menu.scr, sloupce 1-30
EDGE = 0x00          # krajni sloupce 0 a 31


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('dst', nargs='?', default=os.path.join(ROOT, 'data', 'menu.json'))
    args = ap.parse_args()

    mem = L.memory_image()
    attrs = list(L.peek(mem, ATTRS, LINES))
    positions = list(L.peek(mem, POSITIONS, LINES))
    lines = []
    address = STRINGS
    for index in range(LINES):
        text, size = L.string_at(mem, address, 64)
        lines.append({'address': '$%04X' % address, 'text': text,
                      'y': positions[index], 'row': positions[index] >> 3,
                      'col': COLUMN, 'attr': '$%02X' % attrs[index]})
        address += size
    copyright_text, _ = L.string_at(mem, COPYRIGHT, 64)

    data = {
        'note': 'rozvrzeni menu GAME SELECTION ($80D1); pozice z $8115 (y '
                'v pixelech), atributy z $810E, sloupec 7 z LD L,$38. '
                'Pozadi a blikani vybranych radku odmereno na '
                'sources/media/screens/menu.scr',
        'tables': {'attributes': '$%04X' % ATTRS, 'positions': '$%04X' % POSITIONS,
                   'strings': '$%04X' % STRINGS},
        'column': COLUMN,
        'background': {'attr': '$%02X' % BACKGROUND, 'edgeAttr': '$%02X' % EDGE,
                       'edgeColumns': [0, 31]},
        'lines': lines,
        'copyright': {'address': '$%04X' % COPYRIGHT, 'row': 23, 'col': 0,
                      'attr': '$%02X' % ord(copyright_text[0]),
                      'text': copyright_text[1:]},
        # ★ vybrany pocet hracu a vybrane ovladani blikaji ($47 | $80)
        'selectedFlash': True,
        'selectedLines': {'players': 1, 'control': 3},
    }
    os.makedirs(os.path.dirname(os.path.abspath(args.dst)), exist_ok=True)
    with open(args.dst, 'w') as f:
        json.dump(data, f, indent=2)
        f.write('\n')
    for line in lines:
        print('  radek %2d sloupec %d attr %s  %r'
              % (line['row'], line['col'], line['attr'], line['text']))
    print('  radek 23 sloupec 0 attr %s  %r'
          % (data['copyright']['attr'], data['copyright']['text']))
    print('%d radku -> %s' % (len(lines) + 1, args.dst))


if __name__ == '__main__':
    main()
