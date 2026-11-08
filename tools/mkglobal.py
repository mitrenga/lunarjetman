#!/usr/bin/env python3
"""Zachyti pocatecni stav hry z originalu -> data/global.json.

    ./tools/mkglobal.py [--frame N] [data/global.json]

Nechá hru rozjet v simulatoru (`tools/playtrace.py --dump`) a opise
**tabulku entit tak, jak ji originál ma v pameti** na zacatku zivota:

- `$6000`-`$623F`, **24 slotu po 24 bajtech** (`sources/docs/disasm_notes.md`);
  hlavni smycka je obchazi pres `IX`, krok `ADD IX,DE` s `DE = $0018`, konec
  `$6240` (`$8259`)
- k tomu obraz promennych hry `$5E00`-`$5EFF`, ve kterych sedi volba ovladani
  (`$5E00`) a stav, na ktery se obsluhy odkazuji

★ **Nic z toho se nevymysli.** Je to snimek pameti; co ktery bajt v zaznamu
znamena, **zatim vetsinou nevime** -- jiste je `+$00` typ (index do skokove
tabulky `$82C5` i do tabulky predloh `$BAC0`) a `+$07` atribut. Zbytek nese
worker jako neprusvitnych 24 bajtu, presne proto, aby melo M3-M5 co s cim
porovnavat.

Volba snimku: hra rozjeta, prvni zivot bezi, nic podstatneho se jeste
nestalo.
"""
import argparse, base64, json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..')
sys.path.insert(0, HERE)
import ljmlib as L   # noqa: E402

TABLE = 0x6000
SLOTS = 24
RECORD = 24
VARS = 0x5E00
VARS_LEN = 0x100


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('dst', nargs='?', default=os.path.join(ROOT, 'data', 'global.json'))
    ap.add_argument('--frame', type=int, default=170)
    ap.add_argument('--out', default=os.path.join(ROOT, 'build'))
    args = ap.parse_args()

    subprocess.run([sys.executable, os.path.join(HERE, 'playtrace.py'),
                    '--frames', str(args.frame + 20),
                    '--out', args.out,
                    '--shots', str(args.frame),
                    '--dump', str(args.frame)],
                   check=True, stdout=subprocess.DEVNULL)
    ram = open(os.path.join(args.out, 'ram%05d.bin' % args.frame), 'rb').read()
    table = ram[TABLE - 0x4000:TABLE - 0x4000 + SLOTS * RECORD]
    variables = ram[VARS - 0x4000:VARS - 0x4000 + VARS_LEN]

    used = [slot for slot in range(SLOTS)
            if any(table[slot * RECORD:(slot + 1) * RECORD])]
    data = {
        'note': 'pocatecni stav z originalu (tools/mkglobal.py), snimek %d. '
                'Tabulka entit $6000-$623F: 24 slotu po 24 bajtech. '
                '+$00 je typ (index do $82C5 i do $BAC0), +$07 atribut; '
                'zbytek zaznamu zatim neni rozebrany a nese se cely'
                % args.frame,
        'frame': args.frame,
        'entityTable': {'address': '$%04X' % TABLE, 'slots': SLOTS,
                        'record': RECORD, 'usedSlots': used,
                        'bytes': base64.b64encode(table).decode('ascii')},
        'variables': {'address': '$%04X' % VARS, 'length': VARS_LEN,
                      'bytes': base64.b64encode(variables).decode('ascii')},
        'entryPoint': '$%04X' % L.ENTRY,
    }
    os.makedirs(os.path.dirname(os.path.abspath(args.dst)), exist_ok=True)
    with open(args.dst, 'w') as f:
        json.dump(data, f, indent=2)
        f.write('\n')
    print('snimek %d: %d obsazenych slotu z %d -> %s'
          % (args.frame, len(used), SLOTS, args.dst))


if __name__ == '__main__':
    main()
