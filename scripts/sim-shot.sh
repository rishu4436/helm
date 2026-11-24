#!/usr/bin/env bash
# Capture the Even Hub simulator glasses display (RGBA, transparent = off) as a viewable PNG.
set -euo pipefail
out=$1; port=${SIM_PORT:-9898}
curl -sf "localhost:$port/api/screenshot/glasses" -o "$out.raw.png"
python3 - "$out" <<'PY'
import sys; from PIL import Image
o=sys.argv[1]; im=Image.open(o+'.raw.png'); bg=Image.new('RGBA',im.size,(0,0,0,255)); bg.alpha_composite(im)
bg.convert('RGB').resize((im.size[0]*2,im.size[1]*2),Image.NEAREST).save(o+'.png')
PY
rm "$out.raw.png"
