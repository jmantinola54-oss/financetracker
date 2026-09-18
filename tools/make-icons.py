"""
make-icons.py — regenerates the Ledger app icons.

The mark is drawn geometrically (no font dependency) so it stays crisp at
every size: a peso monogram — stem, bowl, and the two crossbars — sitting on
a ledger baseline, in gold on the app's deep-green field.

Run:  python3 tools/make-icons.py
Output: icons/icon-192.png, icons/icon-512.png, icons/maskable-512.png,
        icons/apple-touch-icon.png, icons/favicon-32.png
"""
from PIL import Image, ImageDraw
import os

INK = (22, 36, 31, 255)        # --ink   #16241F
GOLD = (201, 162, 39, 255)     # --gold  #C9A227
PAPER = (243, 241, 231, 255)   # --paper #F3F1E7

SS = 4  # supersample factor for smooth edges


def rounded_field(size, radius_ratio, bleed=False):
    """Base canvas: the deep-green field the mark sits on."""
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if bleed:
        d.rectangle([0, 0, size, size], fill=INK)
    else:
        r = int(size * radius_ratio)
        d.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=INK)
    return img


def draw_mark(img, scale=1.0, offset_y=0.0, field=INK):
    """
    Draws the peso monogram centred on img.
    `scale` is the fraction of the canvas the mark occupies (its cap height).

    The bowl is built as a filled disc with the counter punched back out in
    the field colour — that gives a perfectly smooth ring, which a stroked
    arc does not.
    """
    size = img.size[0]
    d = ImageDraw.Draw(img)

    cap = size * scale                 # cap height of the glyph
    stroke = cap * 0.155               # weight of the strokes
    cx = size / 2
    cy = size / 2 + size * offset_y

    top = cy - cap / 2
    bottom = cy + cap / 2

    stem_x = cx - cap * 0.34           # left edge of the stem
    stem_r = stem_x + stroke           # right edge of the stem

    # --- bowl of the P ---
    bowl_d = cap * 0.58
    bowl_top = top
    bowl_cy = bowl_top + bowl_d / 2
    bowl_left = stem_x
    # outer disc
    d.ellipse([bowl_left, bowl_top, bowl_left + bowl_d, bowl_top + bowl_d], fill=GOLD)
    # punch the counter back out
    inset = stroke
    d.ellipse(
        [bowl_left + inset, bowl_top + inset,
         bowl_left + bowl_d - inset, bowl_top + bowl_d - inset],
        fill=field,
    )
    # square off the bowl where it meets the stem, so it reads as a P and
    # not as a stray "o" floating next to a bar
    d.rectangle([bowl_left, bowl_top, stem_r, bowl_top + bowl_d], fill=GOLD)

    # --- stem ---
    d.rectangle([stem_x, top, stem_r, bottom - stroke / 2], fill=GOLD)
    d.rounded_rectangle([stem_x, bottom - stroke, stem_r, bottom],
                        radius=stroke / 2, fill=GOLD)

    # --- the two crossbars that make it a peso ---
    bar_left = stem_x - cap * 0.23
    bar_right = stem_r + cap * 0.23
    gap = stroke * 0.70                       # space between the two bars
    # seat both bars in the clear space below the bowl
    bar1_y = bowl_top + bowl_d + stroke * 0.62
    bar2_y = bar1_y + stroke * 0.60 + gap
    for by in (bar1_y, bar2_y):
        d.rounded_rectangle(
            [bar_left, by - stroke * 0.30, bar_right, by + stroke * 0.30],
            radius=stroke * 0.30, fill=GOLD,
        )
    return img


def build(size, radius_ratio=0.22, mark_scale=0.50, bleed=False, offset_y=0.0):
    big = size * SS
    img = rounded_field(big, radius_ratio, bleed=bleed)
    draw_mark(img, scale=mark_scale, offset_y=offset_y, field=INK)
    return img.resize((size, size), Image.LANCZOS)


def main():
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out = os.path.join(here, 'icons')
    os.makedirs(out, exist_ok=True)

    # Standard icons — rounded field, mark at a comfortable size.
    build(192).save(os.path.join(out, 'icon-192.png'))
    build(512).save(os.path.join(out, 'icon-512.png'))

    # Maskable — full bleed, mark shrunk into the safe zone so Android can
    # crop it to a circle/squircle without clipping anything.
    build(512, mark_scale=0.34, bleed=True).save(os.path.join(out, 'maskable-512.png'))

    # iOS home screen — no transparency, no rounding (iOS masks it itself).
    build(180, radius_ratio=0.0).save(os.path.join(out, 'apple-touch-icon.png'))

    # Browser tab favicon — mark scaled up, it's tiny.
    build(32, radius_ratio=0.24, mark_scale=0.56).save(os.path.join(out, 'favicon-32.png'))

    print('icons written to', out)


if __name__ == '__main__':
    main()
