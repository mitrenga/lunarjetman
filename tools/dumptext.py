#!/usr/bin/env python3
"""Vytahne z originalu vsechny jeho texty -> data/texts.json.

    ./tools/dumptext.py [data/texts.json]

Konec retezce je vzdy stejny: **posledni znak ma nastaveny bit 7**.
Nastroj proto hleda souvisly usek tisknutelnych znaku zakonceny takovym
bajtem. Adresy se **necetou z tabulky** (zadna souvisla tabulka retezcu
v programu neni), ale ze skenu celeho obrazu - co projde, je v
`data/texts.json` i s adresou, aby se to dalo overit.

**Odkud se bere atribut, se ale lisi podle tiskove rutiny, a nesmi se to
splest:**

- `$8A11` (herni hlasky) cte **prvni bajt retezce jako atribut** a teprve
  za nim zacina text. Prevod adresy obrazovky na adresu atributu dela `$8506`
- menu `GAME SELECTION` (`$811C`-`$8189`) tiskne `$80D1` a atributy si bere
  z **tabulky `$810E`** (sedm bajtu `$47`), pozice z tabulky `$8115`.
  Tam je **prvni bajt retezce uz pismeno**

Nastroj proto vypisuje **cely retezec tak, jak lezi v pameti**, a u kazdeho
rekne, jestli je prvni bajt atribut (`inlineAttr`). Hranice je adresa menu
bloku, ne dohad z obsahu.

Texty jsou **autorita na pravidla, ktera se z kodu ctou spatne**: nazev
menu, hlaska o odpalene raketе, GAME OVER, sin slavy. Viz
`sources/docs/disasm_notes.md`.
"""
import argparse, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import ljmlib as L   # noqa: E402

DEFAULT_MIN = 8

# blok menu: retezce, ktere tiskne $80D1 a atribut si bere z tabulky $810E
MENU = (0x811C, 0x818A)


def scan(mem, minlen=DEFAULT_MIN):
    out = []
    i = 0
    n = len(mem)
    while i < n:
        j = i
        s = []
        while j < n:
            c = mem[j]
            ch = c & 0x7F
            if not (0x20 <= ch < 0x7F):
                break
            s.append(chr(ch))
            j += 1
            if c & 0x80:
                break
        if len(s) >= minlen and j > i and (mem[j - 1] & 0x80):
            out.append((0x4000 + i, ''.join(s)))
            i = j
        else:
            i += 1
    return out


def inline_attr(addr):
    """Bere se prvni bajt retezce jako atribut? (viz hlavicka)"""
    return not (MENU[0] <= addr < MENU[1])


def looks_like_text(s):
    """Odfiltruje nahodne shluky z kodu: chce prevahu pismen a mezer."""
    letters = sum(1 for c in s if c.isalpha() or c in ' .,')
    upper = sum(1 for c in s if c.isupper() or c in ' .,')
    return letters >= 0.85 * len(s) and upper >= 0.85 * len(s)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('dst', nargs='?', default=os.path.join(HERE, '..', 'data', 'texts.json'))
    ap.add_argument('--min', type=int, default=DEFAULT_MIN)
    ap.add_argument('--all', action='store_true', help='vypsat i to, co filtr zahodil')
    args = ap.parse_args()

    mem = L.memory_image()
    found = scan(mem, args.min)
    keep = [(a, s) for a, s in found if looks_like_text(s)]

    strings = []
    for a, s in keep:
        item = {'address': '$%04X' % a, 'raw': s, 'inlineAttr': inline_attr(a)}
        if item['inlineAttr']:
            item['attr'] = '$%02X' % ord(s[0])
            item['text'] = s[1:]
        else:
            item['text'] = s
        strings.append(item)

    data = {
        'note': 'texty originalu (tools/dumptext.py); konec = bit 7 na poslednim '
                'znaku. U retezcu s inlineAttr je PRVNI bajt atribut ($8A11), '
                'u menu bloku $811C-$8189 ne (atributy z tabulky $810E)',
        'count': len(strings),
        'strings': strings,
    }
    os.makedirs(os.path.dirname(os.path.abspath(args.dst)), exist_ok=True)
    with open(args.dst, 'w') as f:
        json.dump(data, f, indent=2)
        f.write('\n')
    for it in strings:
        print('%s  %-9s %r' % (it['address'],
                               ('attr ' + it['attr']) if it['inlineAttr'] else 'bez attr',
                               it['text']))
    print('%d textu -> %s (ze %d kandidatu)' % (len(keep), args.dst, len(found)))
    if args.all:
        for a, s in found:
            if (a, s) not in keep:
                print('  zahozeno $%04X %r' % (a, s))


if __name__ == '__main__':
    main()
