#!/usr/bin/env python3
"""Odmeri rozvrzeni panelu se skore -> data/panel.json.

    ./tools/dumppanel.py [data/panel.json]

Panel jsou znakove radky **0 az 4** (`sources/docs/screen_layout.md`).
Tenhle nastroj popisuje **radky 0 a 1**, tedy skore -- to same, co u sourozencu
dela `matchpanel` (sabrewulf popisuje take dva radky).

★ **Radky 0 a 1 jsou cely tisk vlastni znakovou sadou.** Overeno: kazda
neprazdna bunka obou radku ve trech nezavislych snimcich je **presne glyf**
z tabulky na `$D347` -- az na jednu, ktera je **ikona na `$D151`**
(`$896F LD DE,$D151`), osm bajtu male postavicky.

Pole a atributy jsou **odmerene na snimcich** a nastroj si je proti nim
**sam kontroluje** -- kdyz nesedi, spadne. Referencni snimky jsou commitnute
v `sources/media/screens/panel_*.scr`; vyrabi je
`./tools/playtrace.py --frames 1250 --shots 40,400,1200`.

? Radky 2 az 4 -- pas `TRUCK` / `FUEL` / `TIME` / `BASE` -- tady nejsou.
Jejich labely nejsou glyfy z teto sady a prouzky se hybou; je to zbytek M2.

? Co znamena pole `L00` po stranach `HI` a citac s ikonou na radku 0,
**zmerene neni**. V zaznamu jsou jako zmerena mista, ne jako vyznam.
"""
import argparse, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..')
sys.path.insert(0, HERE)
import ljmlib as L   # noqa: E402

FONT = 0xD347
ICON = 0xD151        # $896F LD DE,$D151 -- ikona u citace na radku 0

# odmereno na snimcich; nastroj to proti nim overi
LAYOUT = {
    'rows': [0, 1],
    'background': [
        {'row': 0, 'attr': 0x43, 'edgeColumns': [0, 31], 'edgeAttr': 0x00},
        {'row': 1, 'attr': 0x46, 'edgeColumns': [], 'edgeAttr': 0x00},
    ],
    'labels': [
        {'row': 0, 'col': 3,  'text': '1UP', 'attr': 0x47},
        {'row': 0, 'col': 15, 'text': 'HI',  'attr': 0x45},
        {'row': 0, 'col': 27, 'text': '2UP', 'attr': 0x47},
    ],
    'fields': [
        {'name': 'score',     'row': 1, 'col': 1,  'digits': 6, 'attr': 0x46},
        {'name': 'leftCount', 'row': 1, 'col': 9,  'digits': 3, 'attr': 0x44},
        {'name': 'hiScore',   'row': 1, 'col': 13, 'digits': 6, 'attr': 0x46},
        {'name': 'rightCount', 'row': 1, 'col': 20, 'digits': 3, 'attr': 0x44},
        {'name': 'score2',    'row': 1, 'col': 25, 'digits': 6, 'attr': 0x46},
    ],
    # citac s ikonou: jedna cislice a za ni osmibajtova ikona z $D151
    'counter': {'row': 0, 'col': 8, 'attr': 0x43, 'icon': '$%04X' % ICON},
}

FRAMES = ['sources/media/screens/panel_00040.scr',
          'sources/media/screens/panel_00400.scr',
          'sources/media/screens/panel_01200.scr']


def cell(data, row, col):
    out = bytearray()
    for line in range(8):
        y = row * 8 + line
        third, char_row, pix = y >> 6, (y >> 3) & 7, y & 7
        out.append(data[(third << 11) | (pix << 8) | (char_row << 5) | col])
    return bytes(out)


def verify(mem, layout):
    """Zkontroluje odmereny popis proti referencnim snimkum."""
    glyphs = {}
    for index in range(96):
        glyphs.setdefault(bytes(L.peek(mem, FONT + index * 8, 8)), index)
    checked = 0
    for name in FRAMES:
        path = os.path.join(ROOT, name)
        if not os.path.exists(path):
            print('  (chybi %s - preskoceno)' % name)
            continue
        data = open(path, 'rb').read()
        for back in layout['background']:
            for col in range(32):
                want = (back['edgeAttr'] if col in back['edgeColumns']
                        else back['attr'])
                got = data[6144 + back['row'] * 32 + col]
                # pole maji vlastni atribut, pozadi jen tam, kde nic neni
                if got != want and not any(
                        f['row'] == back['row'] and f['col'] <= col < f['col'] + f['digits']
                        for f in layout['fields']) and not any(
                        l['row'] == back['row'] and l['col'] <= col < l['col'] + len(l['text'])
                        for l in layout['labels']) and not (
                        layout['counter']['row'] == back['row']
                        and layout['counter']['col'] <= col <= layout['counter']['col'] + 1):
                    raise SystemExit('%s: pozadi r%d c%d je $%02X, cekam $%02X'
                                     % (name, back['row'], col, got, want))
                checked += 1
        for label in layout['labels']:
            for offset, char in enumerate(label['text']):
                col = label['col'] + offset
                got = cell(data, label['row'], col)
                if glyphs.get(got) != ord(char) - 0x20:
                    raise SystemExit('%s: r%d c%d neni %r' % (name, label['row'], col, char))
                if data[6144 + label['row'] * 32 + col] != label['attr']:
                    raise SystemExit('%s: atribut r%d c%d' % (name, label['row'], col))
                checked += 2
        for field in layout['fields']:
            for offset in range(field['digits']):
                col = field['col'] + offset
                got = cell(data, field['row'], col)
                if got not in glyphs:
                    raise SystemExit('%s: pole %s r%d c%d neni glyf'
                                     % (name, field['name'], field['row'], col))
                if data[6144 + field['row'] * 32 + col] != field['attr']:
                    raise SystemExit('%s: atribut pole %s c%d' % (name, field['name'], col))
                checked += 2
    return checked


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('dst', nargs='?', default=os.path.join(ROOT, 'data', 'panel.json'))
    args = ap.parse_args()

    mem = L.memory_image()
    checked = verify(mem, LAYOUT)

    data = dict(LAYOUT)
    data['note'] = ('rozvrzeni panelu se skore (tools/dumppanel.py). Radky 0 a 1 '
                    'jsou tisk vlastni znakovou sadou $D347; pole a atributy jsou '
                    'odmerene na snimcich z originalu a nastroj si je proti nim '
                    'kontroluje. Radky 2-4 (pas TRUCK/FUEL/TIME/BASE) tu nejsou')
    data['font'] = '$%04X' % FONT
    data['iconBytes'] = list(L.peek(mem, ICON, 8))
    # jednotlive polozky slovnikem, at to jde cist z JS
    os.makedirs(os.path.dirname(os.path.abspath(args.dst)), exist_ok=True)
    with open(args.dst, 'w') as f:
        json.dump(data, f, indent=1)
        f.write('\n')
    print('rozvrzeni overeno proti snimkum: %d kontrol -> %s' % (checked, args.dst))


if __name__ == '__main__':
    main()
