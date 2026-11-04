"""Encode the browser-rendered 1200x630 card; no repainting or generated scenery.
Usage: python3 scripts/branding/export-share.py [path/to/capture.png]
"""
from pathlib import Path
import sys
from PIL import Image

root = Path(__file__).resolve().parents[2]
source = Path(sys.argv[1]) if len(sys.argv) > 1 else root / 'branding/share-card.png'
output = root / 'public/social/komorebi-shrine-v1.jpg'
image = Image.open(source).convert('RGB')
if image.size != (1200, 630):
    raise SystemExit(f'Capture must be exactly 1200x630; received {image.size}. No resizing was performed.')
image.save(output, format='JPEG', quality=90, subsampling=0, optimize=True)
print(f'{output}: 1200x630, {output.stat().st_size} bytes')
