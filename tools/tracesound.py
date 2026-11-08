#!/usr/bin/env python3
"""Nahraje zvukove rutiny originalu -- pulz po pulzu, v T-stavech.

    ./tools/tracesound.py [--play] [data/sounds.json]

## Jak to meri

Kazda zvukova rutina se **zavola primo v simulatoru**: nastavi se registry,
na zasobnik se polozi navratova adresa, PC se posadi na rutinu a bezi se, nez
se vrati. Pritom se zaznamenava **kazdy zapis na port `$FE`** i s casem
v T-stavech Z80. To, co z toho vypadne, je proud hran reproduktoru -- presne
to, co ma `app/beeper.js` umet zopakovat.

★ Cas je **v T-stavech, ne v milisekundach**. Zvuk ZX Spectra je delka smycky
`DJNZ`; prepocet pres milisekundy by zaokrouhlil prave to, co je na nem
slyset. Vzor je `sabrewulf/tools/tracesound.py` (63 038 kontrol).

## Rutiny (sources/docs/disasm_notes.md §8)

| adresa | co dela |
|---|---|
| `$B8DA` | **jeden pulz**: `LD B,C / DJNZ` (ticho), `OUT $10` (zapnout), `LD B,C / DJNZ`, `OUT $00` (vypnout). `C` je pulperioda |
| `$B8E8` | `D` cyklu periody `C` (pocita z `B`) |
| `$B8A8` | **klesajici rozmet**: `C` od `$08` do `$37` |
| `$B8B4` | **stoupajici rozmet**: `C` od `$38` do `1` |
| `$B8BD` | ton `D=$20`, `C=$50` |
| `$B8C3` | ton `D=$30`, `C=$40` |
| `$B8C9` | ton `D=$40`, `C=$30` |
| `$B8D4` | ton `D=$10`, `C=$60` |
| `$B8FF` | **sum**: perioda se michá z `DAA`/`XOR $F0`/`RLCA` a z `($5E42)` |
| `$B918` | **warble**: perioda strida `C` a `~C` |

`--play` misto toho nahraje cely beh hry (jako `tools/playtrace.py`) a ulozi
proud hran do `build/sound.json`; slouzi to k tomu, aby bylo videt, ktere
rutiny hra opravdu pousti, ne k porovnavani.
"""
import argparse, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..')
RETRO = os.path.join(ROOT, 'app', 'svision', 'tools', 'retro')
sys.path.insert(0, os.path.join(RETRO, '..', '..', 'sources', 'skoolkit'))
sys.path.insert(0, HERE)

from skoolkit.snapshot import Snapshot                          # noqa: E402
from skoolkit.simulator import Simulator                        # noqa: E402
from skoolkit.simutils import from_snapshot                     # noqa: E402
from skoolkit.trace import Tracer                               # noqa: E402
try:
    from skoolkit.csimulator import CSimulator
except ImportError:                                             # pragma: no cover
    CSimulator = None

import playtrace                                                # noqa: E402

A, F, B, C, D, E, H, L = 0, 1, 2, 3, 4, 5, 6, 7
SP, PC, T = 12, 24, 25
SPEAKER = 0x10
RETURN = 0xFFF0          # navratova adresa: nic tam nelezi, bezi se jen k ni

# rutina -> (jmeno, registry, ktere se pred volanim nastavi)
ROUTINES = [
    ('pulse',       0xB8DA, [{'C': c} for c in (0x10, 0x20, 0x30, 0x40, 0x50, 0x60)]),
    ('cycles',      0xB8E8, [{'B': 8, 'C': 0x30}, {'B': 16, 'C': 0x20}]),
    ('sweepDown',   0xB8A8, [{}]),
    ('sweepUp',     0xB8B4, [{}]),
    ('toneA',       0xB8BD, [{}]),
    ('toneB',       0xB8C3, [{}]),
    ('toneC',       0xB8C9, [{}]),
    ('toneD',       0xB8D4, [{}]),
    # $B8FF si bere periodu i z promenne hry $5E42 -- je to vstup, ne konstanta
    ('noise',       0xB8FF, [{'@5E42': 0x00}, {'@5E42': 0x55}, {'@5E42': 0xAA}]),
    ('warble',      0xB918, [{'C': 0x30, 'D': 0x10}, {'C': 0x18, 'D': 0x08}]),
]


class PortTracer(Tracer):
    """Tracer, ktery si navic zapisuje kazdy zapis na port $FE."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.pulses = []

    # ★ `registers[T]` je cas **zacatku** instrukce `OUT (n),A`; ULA zapis
    # uvidi az 12 T-stavu do ni. Pricitame ho, aby to byla tataz konvence
    # jako v sabrewulf a jetpac (`T.out_write` v `app/beeper.js`).
    OUT_WRITE = 12

    def _write_port(self, registers, port, value, offset):
        if port % 2 == 0:
            self.pulses.append((registers[T] + self.OUT_WRITE,
                                1 if value & SPEAKER else 0))
        return super()._write_port(registers, port, value, offset)


def make_simulator(snapshot_path):
    snapshot = Snapshot.get(snapshot_path)
    if snapshot is None:
        raise SystemExit('nelze nacist snapshot %s' % snapshot_path)
    cls = CSimulator or Simulator
    simulator = from_snapshot(cls, snapshot, {}, {'ay': [None] * 16},
                              {'fast_djnz': False, 'fast_ldir': False}, None)
    tracer = PortTracer(simulator, snapshot.border, snapshot.out7ffd,
                        snapshot.outfffd, list(snapshot.ay), snapshot.outfe, True)
    simulator.set_tracer(tracer)
    return simulator, tracer, snapshot


def call(simulator, tracer, address, registers):
    """Zavola rutinu a vrati hrany reproduktoru relativne k zacatku."""
    regs = simulator.registers
    for name, value in registers.items():
        if name.startswith('@'):
            simulator.memory[int(name[1:], 16)] = value
        else:
            regs[{'A': A, 'B': B, 'C': C, 'D': D, 'E': E, 'H': H, 'L': L}[name]] = value
    sp = 0x7F00
    regs[SP] = sp
    simulator.memory[sp] = RETURN & 0xFF
    simulator.memory[sp + 1] = RETURN >> 8
    regs[PC] = address
    start = regs[T]
    tracer.pulses = []
    # bez preruseni: merime samotnou rutinu, ne to, co do ni vpadne
    simulator.run(address, RETURN, False)
    edges = [[t - start, level] for t, level in tracer.pulses]
    return edges, regs[T] - start


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('dst', nargs='?', default=os.path.join(ROOT, 'data', 'sounds.json'))
    ap.add_argument('--snapshot', default=os.path.join(ROOT, 'build/lunarjetman.z80'))
    ap.add_argument('--play', action='store_true')
    ap.add_argument('--frames', type=int, default=2500)
    args = ap.parse_args()

    simulator, tracer, snapshot = make_simulator(args.snapshot)

    if args.play:
        def draw(scr, frame, border, keyboard):
            for i in range(8):
                keyboard[i] = 0
            for start, end, key in playtrace.SCRIPT:
                if start <= frame < end:
                    row, bit = playtrace.KEYS[key]
                    keyboard[playtrace.ROWS[row]] |= 1 << bit
            return frame < args.frames
        tracer.run(snapshot.pc, -1, 0, 0, True, draw, None, None, None, '$', '04X', '04X')
        edges, last = [], None
        for t, level in tracer.pulses:
            if level != last:
                edges.append([t, level])
                last = level
        out = os.path.join(ROOT, 'build', 'sound.json')
        json.dump({'note': 'cely beh hry', 'edges': len(edges), 'edgeList': edges},
                  open(out, 'w'))
        print('%d hran za %d snimku -> %s' % (len(edges), args.frames, out))
        return

    sounds = []
    total = 0
    for name, address, cases in ROUTINES:
        for index, registers in enumerate(cases):
            edges, length = call(simulator, tracer, address, registers)
            total += len(edges)
            sounds.append({
                'name': name if len(cases) == 1 else '%s.%d' % (name, index),
                'address': '$%04X' % address,
                'registers': registers,
                'tstates': length,
                'edges': edges,
            })
            print('  %-12s $%04X %-20s %4d hran, %7d T-stavu'
                  % (sounds[-1]['name'], address, registers, len(edges), length))

    data = {
        'note': 'zvukove rutiny originalu, nahrane volanim primo v simulatoru '
                '(tools/tracesound.py). Cas je v T-stavech Z80, hrana je '
                '[T od zacatku rutiny, stav reproduktoru]',
        'clock': 3500000,
        'count': len(sounds),
        'edges': total,
        'sounds': sounds,
    }
    os.makedirs(os.path.dirname(os.path.abspath(args.dst)), exist_ok=True)
    with open(args.dst, 'w') as f:
        json.dump(data, f, indent=1)
        f.write('\n')
    print('%d rutin, %d hran -> %s' % (len(sounds), total, args.dst))


if __name__ == '__main__':
    main()
