#!/usr/bin/env python3
"""Vytahne z originalu jeho **vlastni znakovou sadu** -> data/font.json.

    ./tools/dumpfont.py [data/font.json] [--png build/font.png]

Lunar Jetman se tim lisi od Sabre Wulfa i od Jetpacu: ty tisknou ROM fontem
Spectra pres `CHARS` ($5C36). Tady **v celem obrazu neni jediny odkaz na
`$5C36` ani na `$3D00`** a tisk bere glyfy z vlastni tabulky:

    $89EF  SUB $20          ; kod znaku - 32
           LD L,A / LD H,0
           ADD HL,HL ×3     ; ×8
           LD DE,($5E04)    ; zaklad fontu je v promenne
           ADD HL,DE
           ... 8× LD A,(DE) / LD (HL),A / INC DE / INC H

Zaklad fontu se do `$5E04` uklada hned na zacatku hry (`$8018 LD HL,nn`),
a **nastroj si tu adresu prectе z kodu**, misto aby ji mel napsanou natvrdo.

Rozsah: glyfy `$20`..`$5F` (64 kusu, mezera az podtrzitko). Vys zadny retezec
v programu nejde - nejvyssi pouzity kod je `$59` ('Y').
"""
import argparse, base64, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, '..', 'app', 'svision', 'tools', 'retro'))
import ljmlib as L   # noqa: E402

SET_FONT = 0x8018       # LD HL,nn  -- nn je zaklad fontu
FIRST = 0x20
COUNT = 64


def font_base(mem):
    """Zaklad fontu prectený z instrukce `LD HL,nn` na $8018."""
    op = L.peek(mem, SET_FONT, 1)[0]
    if op != 0x21:
        raise SystemExit('na $%04X neni LD HL,nn ale $%02X' % (SET_FONT, op))
    return L.word(mem, SET_FONT + 1)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('dst', nargs='?', default=os.path.join(HERE, '..', 'data', 'font.json'))
    ap.add_argument('--png', default=os.path.join(HERE, '..', 'build', 'font.png'))
    args = ap.parse_args()

    mem = L.memory_image()
    base = font_base(mem)
    glyphs = L.peek(mem, base, COUNT * 8)

    data = {
        'note': 'vlastni znakova sada originalu (tools/dumpfont.py); '
                'hra netiskne ROM fontem Spectra',
        'address': '$%04X' % base,
        'firstChar': FIRST,
        'count': COUNT,
        'width': 8, 'height': 8,
        'glyphs': base64.b64encode(glyphs).decode('ascii'),
    }
    os.makedirs(os.path.dirname(os.path.abspath(args.dst)), exist_ok=True)
    with open(args.dst, 'w') as f:
        json.dump(data, f, indent=2)
        f.write('\n')
    print('font $%04X, %d glyfu -> %s' % (base, COUNT, args.dst))

    if args.png:
        from scr2png import write_png
        cols = 32
        rows = []
        for r in range((COUNT + cols - 1) // cols):
            for y in range(8):
                row = bytearray()
                for c in range(cols):
                    g = r * cols + c
                    b = glyphs[g * 8 + y] if g < COUNT else 0
                    for bit in range(7, -1, -1):
                        v = 255 if (b >> bit) & 1 else 0
                        row += bytes((v, v, v))
                rows.append(bytes(row))
        os.makedirs(os.path.dirname(os.path.abspath(args.png)), exist_ok=True)
        write_png(args.png, rows, cols * 8, 4)
        print('prehled -> %s' % args.png)


if __name__ == '__main__':
    main()
