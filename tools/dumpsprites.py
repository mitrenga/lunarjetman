#!/usr/bin/env python3
"""Vytahne grafiku originalu -> data/sprites.json (+ build/sprites.png).

    ./tools/dumpsprites.py [data/sprites.json] [--png build/sprites.png]

## Odkud se berou

Tabulka ukazatelu je na **`$BAC0`**, 239 polozek po dvou bajtech, **index je
typovy bajt entity minus 1** -- tedy tentyz bajt `(IX+$00)`, kterym se vybira
obsluha ze skokove tabulky `$82C5` (`sources/docs/disasm_notes.md` §3).
Cte ji `$857F`:

    $857F  LD BC,$BAC0
           LD A,(IX+$00) / DEC A
           LD L,A / LD H,0 / ADD HL,HL / ADD HL,BC
           LD E,(HL) / INC HL / LD D,(HL)

## Dva formaty, a nesmi se splest

- **A (uzky):** `[vyska][vyska x N bajtu]`, kde **N je 1, 2 nebo 3** --
  tedy 8, 16 nebo 24 px siroky. Sirka v hlavicce neni; vi ji az rutina,
  ktera sprite kresli
- **B (siroky):** `[sirka v bajtech][vyska][sirka x vyska bajtu]`

Ktery to je, **se neháda z obsahu**: rozhodne to rozestup k dalsimu spritu
v pameti (`1 + N*h` proti `2 + w*h`). Kde rozestup neni k dispozici (posledni
sprite v souvislem useku), je polozka oznacena `"verified": false` a format
je odhad -- takove sprity se do remaku neprebiraji, dokud je nepotvrdi
obsluha, ktera je kresli.

## Radky jdou **odspodu nahoru**

Kreslici rutina `$85CF` po kazdem radku dela `DEC H`, tedy jde po obrazovce
**vzhuru**. Prvni radek dat je proto **spodni** radek spritu. Nastroj to
neprehazuje -- uklada data tak, jak lezi, a rika to priznakem `bottomUp`.

## Kresli se **XOR**

`$85E9 XOR (HL) / LD (HL),A` -- sprite se timtez kreslenim i maze, proto
k nemu neni zadna maska (Jetpac mel masku a obraz zvlast).

## Druha tabulka: **neprateleé**, `$EE7A`

★ Krome tabulky `$BAC0` je v obrazu jeste jedna, na **`$EE7A`**, a cte ji
`$8564`. Vybira se z ni jinak: `$8550` vezme hodnotu, podle pasma nastavi
`H` na `$10` nebo `$18` a pricte `A AND $07` -- tedy **skupiny po osmi
s posunutym zacatkem**.

Ma **32 polozek = ctyri druhy po osmi fazich**: pristavaci modul, netopyri
tvor, rotujici mina a jiskra. Vsechny ve formatu A (16 px siroke).
Do `data/sprites.json` jdou jako `enemies`.

? Cim se vybira ktery druh, zmerene neni -- ceka se, ze kolem (M5).

## Posun je **runtime, po jednom pixelu**

`$85D6 XOR A / JR ...` je samomodifikujici skok do retezce `ADD HL,HL /
ADC A,A`; hra si sprite posune o 0-7 pixelu za behu a zapise o bajt siri.
**To je proti Jetpacu zmena**: ten mel ctyri predsunute kopie na smer a
kreslil jen na sudych x. Tady je vodorovne rozliseni **1 px**.
"""
import argparse, base64, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, '..', 'app', 'svision', 'tools', 'retro'))
import ljmlib as L   # noqa: E402

TABLE = 0xBAC0
COUNT = 239          # $BAC0 + 2*239 = $BCA6, dalsi polozka uz mimo tabulku
ENEMY_TABLE = 0xEE7A
ENEMY_COUNT = 32     # ctyri druhy po osmi fazich ($8550: H = $10 nebo $18)
GFX = (0xB9D2, 0xFC00)


def pointers(mem):
    return [L.word(mem, TABLE + 2 * i) for i in range(COUNT)]


def classify(mem, addr, gap):
    """(sirka v bajtech, vyska, offset dat, format, overeno)"""
    h_a = mem[addr - 0x4000]
    w_b = mem[addr - 0x4000]
    h_b = mem[addr - 0x4000 + 1]
    if gap is not None:
        # format A, sirka 2 napred: je nejcastejsi, takze se nesebere
        # jednobajtovemu vykladu neco, co patri jemu
        for width in (2, 1, 3):
            if h_a and 1 + width * h_a == gap:
                return width, h_a, addr + 1, 'A', True
        if 2 + w_b * h_b == gap:
            return w_b, h_b, addr + 2, 'B', True
    # bez rozestupu: odhad, a rekne se o nem
    if 1 <= w_b <= 8 and 1 <= h_b <= 64 and w_b != h_a:
        return w_b, h_b, addr + 2, 'B', False
    return 2, h_a, addr + 1, 'A', False


def collect(mem):
    ptrs = pointers(mem)
    uniq = sorted({p for p in ptrs if GFX[0] <= p < GFX[1]})
    out = []
    for i, p in enumerate(uniq):
        gap = uniq[i + 1] - p if i + 1 < len(uniq) else None
        w, h, data, fmt, ok = classify(mem, p, gap)
        if w == 0 or h == 0:
            continue
        out.append({
            'address': '$%04X' % p,
            'format': fmt,
            'verified': ok,
            'widthBytes': w, 'width': w * 8, 'height': h,
            'bottomUp': True,
            'types': ['%d' % (n + 1) for n, q in enumerate(ptrs) if q == p],
            'data': base64.b64encode(L.peek(mem, data, w * h)).decode('ascii'),
        })
    return out


def enemies(mem):
    """Tabulka $EE7A: ctyri druhy nepratel po osmi fazich, vsechny format A."""
    out = []
    for index in range(ENEMY_COUNT):
        address = L.word(mem, ENEMY_TABLE + 2 * index)
        if not (GFX[0] <= address < GFX[1]):
            continue
        height = mem[address - 0x4000]
        if not height or height > 64:
            continue
        out.append({
            'index': index,
            'kind': index // 8,
            'phase': index % 8,
            'address': '$%04X' % address,
            'format': 'A',
            'widthBytes': 2, 'width': 16, 'height': height,
            'bottomUp': True,
            'data': base64.b64encode(L.peek(mem, address + 1, 2 * height)).decode('ascii'),
        })
    return out


def render(mem, sprites, path):
    from scr2png import write_png
    cols = 16
    cw = max(s['width'] for s in sprites) + 2
    ch = max(s['height'] for s in sprites) + 2
    rowsn = (len(sprites) + cols - 1) // cols
    canvas = [[0] * (cols * cw) for _ in range(rowsn * ch)]
    for idx, s in enumerate(sprites):
        base = int(s['address'][1:], 16) + (1 if s['format'] == 'A' else 2)
        w, h = s['widthBytes'], s['height']
        gx, gy = (idx % cols) * cw, (idx // cols) * ch
        for y in range(h):
            ty = gy + (h - 1 - y)          # bottomUp -> na obrazovku spravne
            for bx in range(w):
                b = mem[base - 0x4000 + y * w + bx]
                for bit in range(8):
                    canvas[ty][gx + bx * 8 + bit] = 255 if (b >> (7 - bit)) & 1 else 0
    px = [bytes(c for v in row for c in (v, v, v)) for row in canvas]
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    write_png(path, px, cols * cw, 2)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('dst', nargs='?', default=os.path.join(HERE, '..', 'data', 'sprites.json'))
    ap.add_argument('--png', default=os.path.join(HERE, '..', 'build', 'sprites.png'))
    args = ap.parse_args()

    mem = L.memory_image()
    sprites = collect(mem)
    enemy = enemies(mem)
    ok = sum(1 for s in sprites if s['verified'])
    data = {
        'note': 'grafika originalu (tools/dumpsprites.py); tabulka $BAC0, '
                'index = typ entity - 1. Radky jdou ODSPODU NAHORU, kresli se XOR, '
                'posun 0-7 px se dela za behu',
        'table': '$%04X' % TABLE,
        'count': len(sprites),
        'verified': ok,
        'sprites': sprites,
        'enemyTable': '$%04X' % ENEMY_TABLE,
        'enemies': enemy,
    }
    os.makedirs(os.path.dirname(os.path.abspath(args.dst)), exist_ok=True)
    with open(args.dst, 'w') as f:
        json.dump(data, f, indent=2)
        f.write('\n')
    print('%d predloh (%d overenych rozestupem, %d odhadnutych) '
          '+ %d nepratel z $%04X -> %s'
          % (len(sprites), ok, len(sprites) - ok, len(enemy), ENEMY_TABLE, args.dst))
    if args.png:
        render(mem, sprites, args.png)
        print('prehled -> %s' % args.png)


if __name__ == '__main__':
    main()
