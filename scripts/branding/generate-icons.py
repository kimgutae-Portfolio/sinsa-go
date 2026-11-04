"""Hand-drawn torii mark, rendered from the same geometry as the SVG. No AI image assets.
Run: python3 scripts/branding/generate-icons.py (Pillow required only for regeneration).
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
PAPER = '#f4f0e6'
RED = '#884738'
SVG = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <title>こもれび神社</title>
  <rect width="64" height="64" rx="6" fill="#884738"/>
  <g fill="#f4f0e6">
    <path d="M10 15 Q32 23 54 15 L53 21 Q32 29 11 21 Z"/>
    <path d="M20 23 H25 L23 53 H17 Z M39 23 H44 L47 53 H41 Z"/>
    <path d="M13 29 H51 V34 H13 Z M30 23 H34 V29 H30 Z"/>
  </g>
</svg>
'''

def quadratic(a, b, c):
    return [((1-t)**2*a[0]+2*(1-t)*t*b[0]+t*t*c[0],
             (1-t)**2*a[1]+2*(1-t)*t*b[1]+t*t*c[1]) for t in [i/64 for i in range(65)]]

def render(size, square=False):
    scale = 8
    output = Image.new('RGBA', (size*scale, size*scale), RED if square else (0, 0, 0, 0))
    draw = ImageDraw.Draw(output)
    unit = size*scale/64
    def polygon(points):
        draw.polygon([(round(x*unit), round(y*unit)) for x,y in points], fill=PAPER)
    draw.rounded_rectangle((0,0,size*scale-1,size*scale-1), radius=6*unit, fill=RED)
    polygon(quadratic((10,15),(32,23),(54,15)) + quadratic((53,21),(32,29),(11,21)))
    polygon([(20,23),(25,23),(23,53),(17,53)])
    polygon([(39,23),(44,23),(47,53),(41,53)])
    polygon([(13,29),(51,29),(51,34),(13,34)])
    polygon([(30,23),(34,23),(34,29),(30,29)])
    return output.resize((size,size), Image.Resampling.LANCZOS)

(ROOT/'public/icons').mkdir(parents=True, exist_ok=True)
(ROOT/'public/favicon.svg').write_text(SVG)
for size in [32,48,96]:
    render(size).save(ROOT/f'public/icons/favicon-{size}.png', optimize=True)
render(256).save(ROOT/'public/favicon.ico', sizes=[(16,16),(32,32),(48,48)])
render(180, True).convert('RGB').save(ROOT/'public/apple-touch-icon.png', optimize=True)
for size in [192,512]:
    render(size, True).save(ROOT/f'public/icons/icon-{size}.png', optimize=True)
print('Created SVG, ICO (16/32/48), PNG (32/48/96), Apple (180), and bookmark icons (192/512).')
