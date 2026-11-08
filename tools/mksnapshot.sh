#!/bin/sh
# Z kazety udělá snapshot a obraz RAM. Potřebuje sources/tape/*.tzx (mimo git,
# viz sources/tape/README.md) a SkoolKit v app/svision/sources/skoolkit (R-008).
#
# Kazeta je standardní ROM rychlostí a bez Speedlocku, ale kód **je zamíchaný**
# (RRD smyčka na $5B80, viz sources/docs/tape_layout.md). Simulované nahrání
# v tap2sna.py ten descrambler doopravdy provede, takže snapshot je už
# rozmíchaný — a právě proto se hodí jako nezávislá kontrola toho, co počítá
# tools/ljmlib.py.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SK="$ROOT/app/svision/sources/skoolkit"
TAPE="$ROOT/sources/tape/Lunar Jetman (1983)(Ultimate Play The Game).tzx"
mkdir -p "$ROOT/build"
[ -f "$TAPE" ] || { echo "chybi $TAPE - viz sources/tape/README.md"; exit 1; }
PYTHONPATH="$SK" python3 "$SK/skoolkit-10.1.data/scripts/tap2sna.py" \
    --start 0x8000 "$TAPE" "$ROOT/build/lunarjetman.z80"
PYTHONPATH="$SK" python3 - "$ROOT" <<'PY'
import sys
sys.path.insert(0, sys.argv[1] + '/tools')
from skoolkit.snapshot import Snapshot
import ljmlib as L
root = sys.argv[1]
ram = bytes(Snapshot.get(root + '/build/lunarjetman.z80').ram(-1))
open(root + '/build/lunarjetman.bin', 'wb').write(ram)
mine = L.memory_image()
lo = L.CODE_LOAD - 0x4000
hi = lo + L.CODE_LEN
d = sum(1 for a, b in zip(ram[lo:hi], mine[lo:hi]) if a != b)
print('RAM $4000-$FFFF: %d B; rozmichany kod $7FFF-$FBFF souhlasi s '
      'tools/ljmlib.py: %d kontrol, %d rozdilu' % (len(ram), L.CODE_LEN, d))
PY
