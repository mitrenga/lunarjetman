#!/usr/bin/env python3
"""Zachyti statickou herni obrazovku originalu -> data/screen.json.

    ./tools/mkscene.py [--samples N] [--first F] [--step S] [data/screen.json]

Nechá hru bezet v simulatoru (`tools/playtrace.py`) a z N vzorku vybere
**po bajtech nejcastejsi hodnotu**, takze co se hybe, vetsinovym hlasem
neprojde. Vzor je `sabrewulf/tools/mkroom.py` (131 vzorku).

## Proc zachyceny obraz a ne slozena scena

★ **Je to docasne, a je to napsane naschval.** V M1 jeste neni odectene, jak
je popsany teren ani jak se sklada panel (labely `TRUCK`/`FUEL`/`TIME`/
`BASE`/`ALIEN` jsou grafika, ne text), takze slozit obrazovku z dat by
znamenalo si ty rozvrzeni vymyslet. Misto toho se **vezme, co originál
opravdu nakreslil**, a slozeni z dat prijde v M2 spolu s
`data/terrain.json`. Nic se nedokresluje ani ted: kazdy bajt v
`data/screen.json` je bajt z videopameti originalu.

## Vzorky se **neberou pres cely beh**

Krajina roluje, takze prumerovat pres dlouhy usek by teren rozmazalo. Vzorky
se proto beru z kratkeho useku hned po zacatku zivota, kdy vyrez stoji;
nastroj vypise, **kolik bajtu bylo jednomyslnych** -- to cislo rika, jak moc
se do vysledku promitlo neco pohybliveho (ubyvajici prouzky FUEL a TIME
a sipky smeru).
"""
import argparse, base64, collections, glob, json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..')
sys.path.insert(0, HERE)

SCREEN_BYTES = 6912


def capture(first, step, samples, out_dir):
    shots = [first + step * i for i in range(samples)]
    for old in glob.glob(os.path.join(out_dir, 'frame*.scr')):
        os.remove(old)
    subprocess.run([sys.executable, os.path.join(HERE, 'playtrace.py'),
                    '--frames', str(shots[-1] + 20),
                    '--out', out_dir,
                    '--shots', ','.join(str(s) for s in shots)],
                   check=True, stdout=subprocess.DEVNULL)
    return sorted(glob.glob(os.path.join(out_dir, 'frame*.scr')))


def vote(files):
    data = [open(f, 'rb').read() for f in files]
    if not data:
        raise SystemExit('zadne vzorky')
    out = bytearray(SCREEN_BYTES)
    unanimous = 0
    for index in range(SCREEN_BYTES):
        counts = collections.Counter(sample[index] for sample in data)
        value, votes = counts.most_common(1)[0]
        out[index] = value
        if votes == len(data):
            unanimous += 1
    return bytes(out), unanimous, len(data)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('dst', nargs='?', default=os.path.join(ROOT, 'data', 'screen.json'))
    ap.add_argument('--samples', type=int, default=24)
    ap.add_argument('--first', type=int, default=200)
    ap.add_argument('--step', type=int, default=2)
    ap.add_argument('--out', default=os.path.join(ROOT, 'build'))
    args = ap.parse_args()

    files = capture(args.first, args.step, args.samples, args.out)
    scr, unanimous, count = vote(files)

    data = {
        'note': 'staticka herni obrazovka zachycena z originalu '
                '(tools/mkscene.py, vetsinovy hlas po bajtech); videopamet '
                '$4000-$5AFF tak, jak ji drzi stroj. M2 to nahradi slozenim '
                'z data/terrain.json a data/sprites.json',
        'samples': count,
        'unanimousBytes': unanimous,
        'width': 256, 'height': 192,
        'videoRAM': base64.b64encode(scr).decode('ascii'),
    }
    os.makedirs(os.path.dirname(os.path.abspath(args.dst)), exist_ok=True)
    with open(args.dst, 'w') as f:
        json.dump(data, f, indent=2)
        f.write('\n')
    open(os.path.join(args.out, 'scene.scr'), 'wb').write(scr)
    print('%d vzorku, %d/%d bajtu jednomyslnych (%.1f %%) -> %s'
          % (count, unanimous, SCREEN_BYTES, 100.0 * unanimous / SCREEN_BYTES, args.dst))


if __name__ == '__main__':
    main()
