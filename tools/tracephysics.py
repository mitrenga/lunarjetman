#!/usr/bin/env python3
"""Nahraje krok po kroku, co originál dela s Jetmanem.

    ./tools/tracephysics.py [--steps N] [--script "..."] [build/physics.json]

Zaznam je **na pruchod, ne na snimek** (`ZADANI.md` §10): simulator se pusti
a zastavuje se na dispečeru entit `$81FB`, kde `IX` rika, ktera entita je na
rade. Kdyz je to **slot 5, tedy Jetman** (`$6078`,
`sources/docs/disasm_notes.md` §11), opise se cely jeho 24bajtovy zaznam
a stav klavesnice; pak se dobehne k dalsimu pruchodu Jetmanem a opise se
zaznam znovu.

Z toho vznikaji trojice (stav pred, klavesy) -> (stav po), a presne ty
prehrava `tools/matchphysics.mjs` proti `app/jetmanPhysics.js`.

★ Zaznamenava se **stav klavesnice po pulradcich**, ne uz hotovy bajt
ovladani. Prevod dela `app/jetmanPhysics.js` jako port `$8F9F` -- takze
porovnani zaroven kontroluje, jestli je ten prevod spravne.
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

A, IXh, IXl, PC, T = 0, 8, 9, 24, 25
DISPATCH = 0x81FB        # LD L,(IX+$00) -- tady uz IX ukazuje na entitu
JETMAN = 0x6078          # slot 5
RUNTIME_MAP = 0x7000     # mapa terenu za behu ($91BB)
RECORD = 24
FRAME = 69888
WARMUP = 200             # snimku, nez se zacne merit: hra musi bezet


def make(snapshot_path):
    snapshot = Snapshot.get(snapshot_path)
    if snapshot is None:
        raise SystemExit('nelze nacist snapshot %s' % snapshot_path)
    cls = CSimulator or Simulator
    simulator = from_snapshot(cls, snapshot, {}, {'ay': [None] * 16},
                              {'fast_djnz': False, 'fast_ldir': False}, None)
    tracer = Tracer(simulator, snapshot.border, snapshot.out7ffd, snapshot.outfffd,
                    list(snapshot.ay), snapshot.outfe, True)
    simulator.set_tracer(tracer)
    tracer.keyboard = [0] * 8
    return simulator, tracer, snapshot


def set_keys(tracer, frame, script):
    for index in range(8):
        tracer.keyboard[index] = 0
    for start, end, key in script:
        if start <= frame < end:
            row, bit = playtrace.KEYS[key]
            tracer.keyboard[playtrace.ROWS[row]] |= 1 << bit


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('dst', nargs='?', default=os.path.join(ROOT, 'build', 'physics.json'))
    ap.add_argument('--snapshot', default=os.path.join(ROOT, 'build/lunarjetman.z80'))
    ap.add_argument('--steps', type=int, default=2000)
    ap.add_argument('--script')
    args = ap.parse_args()

    script = playtrace.parse_script(args.script) if args.script else playtrace.SCRIPT
    simulator, tracer, snapshot = make(args.snapshot)
    regs = simulator.registers
    memory = simulator.memory

    # faze 1: rozjet hru normalne (rychle), teprve pak merit
    def draw(scr, frame, border, keyboard):
        for index in range(8):
            keyboard[index] = 0
        for start, end, key in script:
            if start <= frame < end:
                row, bit = playtrace.KEYS[key]
                keyboard[playtrace.ROWS[row]] |= 1 << bit
        return frame < WARMUP
    tracer.run(snapshot.pc, -1, 0, 0, True, draw, None, None, None, '$', '04X', '04X')

    # faze 2: zastavovat se na dispečeru a sbirat pruchody Jetmanem
    steps = []
    base = JETMAN
    guard = 0
    pending = None
    while len(steps) < args.steps and guard < args.steps * 400 + 100000:
        guard += 1
        set_keys(tracer, regs[T] // FRAME, script)
        simulator.run(regs[PC], DISPATCH, True)
        if regs[IXh] * 256 + regs[IXl] != base:
            continue
        record = [memory[base + i] for i in range(RECORD)]
        if pending is not None:
            pending['after'] = record
            steps.append(pending)
        # ★ dva bajty mapy, ktere by $91BB precetl -- **z bezici pameti**,
        # ne ze statickeho data/terrain.json: mapa na $7000 je pracovni
        # a hra ji meni (krater po bombe)
        world = ((record[3] & 0x1F) << 8) | record[2]
        column = (world >> 3) & 0x3FF
        pending = {'before': record, 'keys': list(tracer.keyboard),
                   'frame': regs[T] // FRAME,
                   'tiles': [memory[RUNTIME_MAP - 0x4000 + column],
                             memory[RUNTIME_MAP - 0x4000 + ((column + 1) & 0x3FF)]]}

    data = {
        'note': 'stav Jetmana pruchod po pruchodu z originalu '
                '(tools/tracephysics.py); slot 5 = $6078, zaznam 24 B, '
                'ovladani je to, co vratila rutina $8F90',
        'slot': 5, 'address': '$%04X' % JETMAN, 'record': RECORD,
        'warmupFrames': WARMUP,
        'steps': len(steps),
        'trace': steps,
    }
    os.makedirs(os.path.dirname(os.path.abspath(args.dst)), exist_ok=True)
    with open(args.dst, 'w') as f:
        json.dump(data, f)
        f.write('\n')
    moved = sum(1 for s in steps if s['before'] != s['after'])
    print('%d pruchodu Jetmanem, z toho %d neco zmenilo -> %s'
          % (len(steps), moved, args.dst))


if __name__ == '__main__':
    main()
