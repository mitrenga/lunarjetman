#!/usr/bin/env python3
"""Vyrobi disassembly Lunar Jetmana -> sources/asm/lunarjetman.asm.

    ./tools/mkasm.py [--map build/map.txt,build/map1.txt,...]

Pracuje na **rozmichanem obrazu** (`tools/ljmlib.py`), nikdy na tom, co lezi
na kazete.

Kod se hleda tremi cestami naraz:

1. **rekurzivnim sestupem** od vstupniho bodu `$8000`
2. **tabulkou obsluh entit** na `$82C5` - 244 polozek po dvou bajtech,
   index je typovy bajt `(IX+$00)`, dispecer je `$81FB..$8206` a konci
   `JP $5CB0`, kde lezi `JP (HL)`. Bez teto tabulky najde sestup jen ~1000
   adres; s ni pres 16 000
3. **mapou pokryti z behu** v simulatoru (`tools/playtrace.py --map`), ktera
   doplni to, kam se skace jinak, a naopak potvrdi, co je opravdu kod

Co nezbude ani jednou cestou, je vypsane jako data.

Vystup se **commituje** (`../STANDARDS.md`): je to podklad, ne artefakt buildu.
"""
import argparse, glob, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import asmlib                                            # noqa: E402
import ljmlib as L                                       # noqa: E402

DEFAULT_MAPS = ('build/map.txt', 'build/map1.txt', 'build/map2.txt')

JUMPTABLE = (0x82C5, 244)     # $82C5: obsluhy entit, index = (IX+$00)


def jumptable_seeds(mem):
    addr, count = JUMPTABLE
    return [L.word(mem, addr + 2 * i) for i in range(count)]


def build(map_paths):
    covered = set()
    for p in map_paths:
        p = p if os.path.isabs(p) else os.path.join(HERE, '..', p)
        if os.path.exists(p):
            covered |= asmlib.load_map(p)
    covered = {a for a in covered if L.ENTRY <= a < 0x10000}
    mem = L.memory_image()
    seeds = [L.ENTRY] + jumptable_seeds(mem)
    code, _ = asmlib.walk(seeds=seeds, extra=sorted(covered))
    return code, covered


def targets(code):
    """Adresy, na ktere se nekdo odkazuje - z nich budou navesti."""
    out = set()
    for ins in code.values():
        op = ins.operation
        head = op.split()[0]
        if head in ('JP', 'JR', 'CALL', 'DJNZ'):
            arg = op[len(head):].strip().split(',')[-1].strip()
            if arg.startswith('$'):
                out.add(int(arg[1:], 16))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--map', default=','.join(DEFAULT_MAPS))
    ap.add_argument('--out', default=os.path.join(HERE, '..', 'sources', 'asm',
                                                  'lunarjetman.asm'))
    args = ap.parse_args()

    code, covered = build(args.map.split(','))
    mem = L.memory_image()
    labels = targets(code)

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    n_code = n_data = 0
    with open(args.out, 'w') as f:
        f.write('; Lunar Jetman (Ultimate Play The Game, 1983, ZX Spectrum 48K)\n')
        f.write('; Vyrobil tools/mkasm.py z ROZMICHANEHO obrazu kazety\n')
        f.write('; (tools/ljmlib.py -- blok $7FFF je zamichany smyckou RRD na $5B80).\n')
        f.write(';\n')
        f.write('; Kod: rekurzivni sestup od $8000 + tabulka obsluh $82C5 (244 polozek)\n')
        f.write('; + mapa pokryti z behu. Co neni kod, je vypsane jako data.\n;\n')
        addr = L.ENTRY
        while addr < 0xFC00:
            if addr in code:
                ins = code[addr]
                if addr in labels:
                    f.write('\nL%04X:\n' % addr)
                f.write('  $%04X  %-18s ; %s\n'
                        % (addr, ins.operation,
                           ' '.join('%02X' % b for b in ins.bytes)))
                addr += len(ins.bytes)
                n_code += 1
                continue
            start = addr
            while addr < 0xFC00 and addr not in code:
                addr += 1
            blob = L.peek(mem, start, addr - start)
            n_data += len(blob)
            f.write('\n; ---- data $%04X-$%04X (%d B) ----\n' % (start, addr - 1, len(blob)))
            for off in range(0, len(blob), 16):
                chunk = blob[off:off + 16]
                f.write('  $%04X  DEFB %s\n'
                        % (start + off, ','.join('$%02X' % b for b in chunk)))
    total = 0xFC00 - L.ENTRY
    print('%s: %d instrukci, %d B kodu, %d B dat z %d B (%.1f %% kodu)'
          % (args.out, len(code), total - n_data, n_data, total,
             100.0 * (total - n_data) / total))


if __name__ == '__main__':
    main()
