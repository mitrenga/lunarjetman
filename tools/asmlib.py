#!/usr/bin/env python3
"""Rozebrani kodu Lunar Jetmana: rekurzivni pruchod od vstupniho bodu + mapa pokryti.

Pracuje se **na rozmichanem obrazu** z `ljmlib.memory_image()`, nikdy na tom,
co lezi na kazete - ten je zamichany smyckou `RRD` a nejsou v nem instrukce
(`sources/docs/tape_layout.md`).

Rekurzivni sestup od `$8000` najde hodne, ale ne vsechno: 31 744 B je ctyrikrat
vic nez Jetpac a hra skace pres tabulky. Mapa z behu (`tools/playtrace.py --map`)
k tomu prida to, co se vola neprimo, a naopak potvrdi, co je opravdu kod.
"""
import os, sys
from types import SimpleNamespace

HERE = os.path.dirname(os.path.abspath(__file__))
RETRO = os.path.join(HERE, '..', 'app', 'svision', 'tools', 'retro')
sys.path.insert(0, os.path.join(RETRO, '..', '..', 'sources', 'skoolkit'))
sys.path.insert(0, HERE)

from skoolkit.disassembler import Disassembler   # noqa: E402
import ljmlib as L                            # noqa: E402

class Ins:
    """Instrukce: adresa, text a bajty."""
    def __init__(self, address, operation, data):
        self.address, self.operation, self.bytes = address, operation, list(data)

    def __repr__(self):
        return '$%04X %-16s %s' % (self.address, self.operation,
                                   ' '.join('%02X' % b for b in self.bytes))


CFG = SimpleNamespace(defb_size=8, defm_size=66, defw_size=1, asm_hex=True,
                      asm_lower=False, wrap=False, opcodes='', handle_rst=False,
                      imaker=Ins)

STOP = ('RET', 'RETI', 'RETN')


def make(mem=None):
    if mem is None:
        mem = L.memory_image()
    snapshot = [0] * 0x4000 + list(mem)
    return Disassembler(snapshot, CFG), snapshot


def decode(dis, addr):
    """Jedna instrukce na adrese."""
    return dis.disassemble(addr, addr + 1, 'h')[0]


def walk(seeds=(L.ENTRY,), extra=(), limit=(0x8000, 0x10000)):
    """Rekurzivní sestup. Vrátí (instrukce podle adresy, množina adres kódu)."""
    dis, _ = make()
    lo, hi = limit
    code, todo = {}, list(seeds) + list(extra)
    seen = set()
    while todo:
        addr = todo.pop()
        while True:
            if addr in seen or not (lo <= addr < hi):
                break
            ins = decode(dis, addr)
            seen.add(addr)
            code[addr] = ins
            op = ins.operation
            head = op.split()[0]
            target = None
            rest = op[len(head):].strip()
            if head in ('JP', 'JR', 'CALL', 'DJNZ'):
                arg = rest.split(',')[-1].strip()
                if arg.startswith('$'):
                    target = int(arg[1:], 16)
                elif arg.startswith('('):
                    target = None          # JP (HL) / JP (IX)
            if target is not None and lo <= target < hi:
                todo.append(target)
            # konec lineárního toku?
            if head in STOP and not rest:
                break
            if head == 'JP' and ',' not in rest:
                break
            if head == 'JR' and ',' not in rest:
                break
            if head == 'JP' and rest.startswith('('):
                break
            addr += len(ins.bytes)
    return code, seen


def load_map(path):
    out = set()
    for line in open(path):
        line = line.strip().lstrip('$')
        if line:
            out.add(int(line, 16))
    return out
