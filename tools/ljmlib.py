#!/usr/bin/env python3
"""Společné čtení kazety a obrazu paměti Lunar Jetmana.

Jedno místo, kde je napsané, co je na kazetě, jak se z ní skládá obraz paměti
a kde v něm co leží. Nástroje `dump*`, `trace*` a `match*` to berou odsud,
aby se ta znalost nemusela opakovat (a rozcházet).

**Na rozdíl od Jetpacu je kód zamíchaný.** Kazeta je sice celá standardní ROM
rychlostí a se správnými součty (žádný Speedlock, žádný vlastní zavaděč), ale
blok `0` se nahraje na `$7FFF` v zamíchané podobě a rozmíchá ho patnáctibajtový
blok `1` na `$5B80` smyčkou `RRD` — rotací půlbajtů přes celý blok. Teprve pak
je na `$8000` platný kód. Viz `sources/docs/tape_layout.md`.
"""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAPE = os.path.join(ROOT, 'sources', 'tape',
                    'Lunar Jetman (1983)(Ultimate Play The Game).tzx')
SKOOLKIT = os.path.join(ROOT, 'app', 'svision', 'sources', 'skoolkit')

# --- kazeta -----------------------------------------------------------------

TYPES = {0: 'Program', 1: 'Number array', 2: 'Character array', 3: 'Bytes'}


def tzx_version(path=TAPE):
    """Verze obalu TZX jako (major, minor) – např. (1, 10)."""
    raw = open(path, 'rb').read(10)
    if raw[:8] != b'ZXTape!\x1a':
        raise ValueError('%s neni TZX' % path)
    return raw[8], raw[9]


def tzx_blocks(path=TAPE):
    """TZX → seznam bloků: (flag, data, checksum_ok, header_or_None, pause_ms).

    Kazeta Lunar Jetmana je celá z bloků ID $10 (standardní ROM rychlost),
    takže stačí ta jedna větev; na cokoli jiného nástroj schválně spadne,
    aby se nestalo, že se turbo blok tiše přeskočí.

    `pause_ms` je pauza za blokem zapsaná v TZX. **Není to vlastnost hry, ale
    obalu** – dva dumpy téže kazety se v ní liší (viz
    `sources/docs/tape_layout.md`), takže časování `tapeLoadingModel` se o ni
    může opřít jen jako o řádovou hodnotu, ne jako o měřené číslo.
    """
    raw = open(path, 'rb').read()
    if raw[:8] != b'ZXTape!\x1a':
        raise ValueError('%s neni TZX' % path)
    out, i = [], 10
    while i < len(raw):
        bid = raw[i]
        i += 1
        if bid != 0x10:
            raise NotImplementedError('blok ID $%02X na offsetu %d' % (bid, i - 1))
        pause = raw[i] | (raw[i + 1] << 8)
        length = raw[i + 2] | (raw[i + 3] << 8)
        i += 4
        blk = raw[i:i + length]
        i += length
        flag, body, chk = blk[0], blk[1:-1], blk[-1]
        acc = 0
        for b in blk[:-1]:
            acc ^= b
        header = None
        if flag == 0 and len(body) == 17:
            header = {
                'type': body[0],
                'typeName': TYPES.get(body[0], str(body[0])),
                'name': body[1:11].decode('latin1'),
                'length': body[11] | (body[12] << 8),
                'param1': body[13] | (body[14] << 8),
                'param2': body[15] | (body[16] << 8),
            }
        out.append((flag, body, acc == chk, header, pause))
    return out


def tape_data_blocks(path=TAPE):
    """Datové bloky (flag $FF) v pořadí, jak jdou po kazetě."""
    return [b for b in tzx_blocks(path) if b[0] == 0xFF]


def loading_screen(path=TAPE):
    """6912 B bloku SCREEN$ `JMSP` – přesně to, co kazeta nahraje na $4000."""
    blocks = tzx_blocks(path)
    for i, (flag, body, ok, hdr, pause) in enumerate(blocks):
        if hdr and hdr['name'].strip() == 'JMSP':
            data = blocks[i + 1][1]
            assert len(data) == 6912, len(data)
            return data
    raise LookupError('blok SCREEN$ JMSP na kazete neni')


# --- obraz paměti -----------------------------------------------------------

# Kam co kazeta nahraje (z hlaviček, ne z odhadu)
CODE_LOAD = 0x7FFF      # blok "0", 31745 B, zamíchaný  ($7FFF–$FBFF)
CODE_LEN = 31745
DESCRAMBLER = 0x5B80    # blok "1", 18 B: LD HL,$7FFF / LD BC,$007C / RRD-smyčka
TRAMPOLINE = 0x5CB0     # blok "2", 1 B: $E9 = JP (HL)
FRAMES_PATCH = 0x5C78   # blok "3", 2 B: $34 $83 → FRAMES = $008334
ENTRY = 0x8000          # kam descrambler skočí
VARS = 0x5E00           # $8001: LD SP,$5E00; $800A: vynuluje $5E00 délky $2200
VARS_LEN = 0x2200       # tedy $5E00–$7FFF

SCRAMBLE_ROUNDS = (0x7C, 0x100)   # C=$7C, B=$00 → 124*256 = 31744 bajtů


def descramble(mem):
    """Rozmíchá `mem` (obraz $4000–$FFFF) tak, jak to dělá blok na `$5B80`.

    Blok je patnáct bajtů plus tři na skok:

        LD HL,$7FFF / LD BC,$007C / XOR A
      loop:  RRD / INC HL / DJNZ loop / DEC C / JR NZ,loop
        JP $8000

    `RRD` rotuje o půlbajt vpravo dvanáctibitovou hodnotu složenou ze spodního
    půlbajtu `A` a celého `(HL)`, takže smyčka protáhne **jeden souvislý proud
    půlbajtů** celým blokem: co bylo v souboru, je o půlbajt posunuté proti
    tomu, co má být v paměti. `A` je na začátku 0, takže první půlbajt kódu
    je nula — proto je na `$7FFF` po rozmíchání `$00` a hra začíná až `$8000`.

    Pozor na dva detaily, kvůli kterým se to nedá „udělat od oka":

    - smyčka jede **31744** bajtů (`$7FFF`–`$FBFE`), ale blok má 31745 B.
      Poslední bajt `$FBFF` zůstane, jak se nahrál — je v něm jen ten
      půlbajt, který ze smyčky vypadl
    - `A` skončí nulové, což je kontrola, že se proud přečetl celý
    """
    a = 0
    hl = CODE_LOAD
    c, b = SCRAMBLE_ROUNDS
    for _ in range(c * b):
        i = hl - 0x4000
        v = mem[i]
        al = a & 0x0F
        a = (a & 0xF0) | (v & 0x0F)
        mem[i] = (al << 4) | (v >> 4)
        hl += 1
    assert a == 0, 'RRD smycka neskoncila s A=0 (A=$%02X)' % a
    return mem


def memory_image(path=TAPE):
    """Obraz RAM $4000–$FFFF **po rozmíchání**, tedy tak, jak hra opravdu běží.

    Kazeta nahraje čtyři bloky CODE (`$4000` obrazovka, `$7FFF` kód, `$5B80`
    descrambler, `$5CB0` trampolína, `$5C78` FRAMES) a `PRINT USR 23424` skočí
    na `$5B80`, které blok od `$7FFF` rozmíchá a skočí na `$8000`.

    Tohle je jediný správný obraz pro disassembly i pro extrakci dat — v tom,
    co leží v souboru, nejsou instrukce, ale prokládané půlbajty.
    """
    mem = bytearray(0xC000)          # $4000–$FFFF
    blocks = tzx_blocks(path)
    for i, (flag, body, ok, hdr, pause) in enumerate(blocks):
        if hdr and hdr['type'] == 3:
            addr, data = hdr['param1'], blocks[i + 1][1]
            mem[addr - 0x4000:addr - 0x4000 + len(data)] = data
    return bytes(descramble(mem))


def code_image(path=TAPE):
    """Jen kód a data hry: $8000–$FFFF po rozmíchání."""
    mem = memory_image(path)
    return mem[ENTRY - 0x4000:]


def peek(mem, addr, n=1):
    return mem[addr - 0x4000:addr - 0x4000 + n]


def word(mem, addr):
    b = peek(mem, addr, 2)
    return b[0] | (b[1] << 8)


def string_at(mem, addr, limit=64):
    """Text ukončený bitem 7 na posledním znaku (`GAME SELECTIO` + `$CE`)."""
    out = []
    for i in range(limit):
        c = mem[addr - 0x4000 + i]
        out.append(chr(c & 0x7F))
        if c & 0x80:
            return ''.join(out), i + 1
    raise ValueError('neukonceny retezec na $%04X' % addr)
