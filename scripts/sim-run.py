#!/usr/bin/env python3
"""Drive the Even Hub simulator (automation port) through a scripted flow and capture each screen.
Each step: an input action, then wait until the app logs the expected `[HELM] screen <name>` line, then screenshot.
Usage: sim-run.py <flow.json> <outdir>   flow = [{"do": "click"|"up"|"down"|"double_click"|null, "expect": "impact", "shot": "08-impact", "timeout": 20}]"""
import json, sys, time, urllib.request, io, os
from PIL import Image
PORT = os.environ.get('SIM_PORT', '9898'); B = f'http://localhost:{PORT}'
def console():
    return json.load(urllib.request.urlopen(f'{B}/api/console'))['entries']
def inp(a):
    urllib.request.urlopen(urllib.request.Request(f'{B}/api/input', data=json.dumps({'action': a}).encode(), headers={'Content-Type': 'application/json'}, method='POST'))
def shot(path):
    raw = Image.open(io.BytesIO(urllib.request.urlopen(f'{B}/api/screenshot/glasses').read())).convert('RGBA')
    bg = Image.new('RGBA', raw.size, (0, 0, 0, 255)); bg.alpha_composite(raw)
    bg.convert('RGB').resize((raw.size[0] * 2, raw.size[1] * 2), Image.NEAREST).save(path)
flow = json.load(open(sys.argv[1])); out = sys.argv[2]; os.makedirs(out, exist_ok=True)
log = []
for st in flow:
    seen = len(console())
    if st.get('do'): inp(st['do'])
    ok = True
    if st.get('expect'):
        t0 = time.time(); ok = False
        while time.time() - t0 < st.get('timeout', 20):
            new = [e['message'] for e in console()[seen:]]
            if any(m.startswith(f"[HELM] screen {st['expect']}") for m in new): ok = True; break
            time.sleep(0.25)
    time.sleep(st.get('settle', 0.9))
    if st.get('shot'): shot(f"{out}/{st['shot']}.png")
    rec = {'do': st.get('do'), 'expect': st.get('expect'), 'reached': ok, 'shot': st.get('shot')}
    log.append(rec); print(('OK  ' if ok else 'MISS'), json.dumps(rec), flush=True)
    if not ok and st.get('expect'): break
msgs = [e['message'] for e in console() if '[HELM]' in e['message'] or e['level'] == 'error']
json.dump({'steps': log, 'helmConsole': msgs}, open(f'{out}/run-log.json', 'w'), indent=1)
sys.exit(0 if all(r['reached'] for r in log) else 1)
