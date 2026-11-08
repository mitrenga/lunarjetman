#!/usr/bin/env python3
"""Ověří, že `tools/ljmlib.py` rozmíchá kód **přesně tak, jak to udělá stroj**.

    ./tools/matchdescramble.py

Kód Lunar Jetmana leží na kazetě zamíchaný: blok `0` se nahraje na `$7FFF`
a rozmíchá ho osmnáctibajtový blok `1` na `$5B80` smyčkou `RRD`
(`sources/docs/tape_layout.md`). Python replika téhle smyčky je
`ljmlib.descramble()` a **musí se shodovat bajt po bajtu** s tím, co po
nahrání kazety zbude v paměti simulátoru – jinak stojí celá disassembly
a všechna extrakce dat na výmyslu.

Potřebuje `build/lunarjetman.bin` z `./tools/mksnapshot.sh`.

Akceptační kritérium M0: 31 745 kontrol, nula rozdílů.
"""
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import ljmlib as L   # noqa: E402


def main():
    root = os.path.join(HERE, '..')
    snap = os.path.join(root, 'build', 'lunarjetman.bin')
    if not os.path.exists(snap):
        raise SystemExit('chybi %s – spust ./tools/mksnapshot.sh' % snap)
    ram = open(snap, 'rb').read()
    mine = L.memory_image()
    lo = L.CODE_LOAD - 0x4000
    hi = lo + L.CODE_LEN
    diffs = [L.CODE_LOAD + i for i in range(L.CODE_LEN) if ram[lo + i] != mine[lo + i]]
    print('$%04X-$%04X: %d kontrol, **%d rozdílů**'
          % (L.CODE_LOAD, L.CODE_LOAD + L.CODE_LEN - 1, L.CODE_LEN, len(diffs)))
    for a in diffs[:16]:
        print('  $%04X: simulátor $%02X, ljmlib $%02X'
              % (a, ram[a - 0x4000], mine[a - 0x4000]))
    return 1 if diffs else 0


if __name__ == '__main__':
    sys.exit(main())
