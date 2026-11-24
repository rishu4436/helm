#!/usr/bin/env python3
"""Record the Even Hub simulator glasses display continuously (real screenshots via automation API) while driving a flow.
Writes frames/<t_ms>.png (raw RGBA as returned), events.json (actions, audio plays, [HELM] screen logs, all with t)."""
import json, sys, time, urllib.request, os, threading, subprocess
B = 'http://localhost:9898'
flow = json.load(open(sys.argv[1])); out = sys.argv[2]; os.makedirs(f'{out}/frames', exist_ok=True)
T0 = time.time(); ev = []; stop = False
def now(): return round((time.time() - T0) * 1000)
def console(): return json.load(urllib.request.urlopen(f'{B}/api/console'))['entries']
def inp(a): urllib.request.urlopen(urllib.request.Request(f'{B}/api/input', data=json.dumps({'action': a}).encode(), headers={'Content-Type': 'application/json'}, method='POST'))
def rec():
    while not stop:
        t = now()
        try: d = urllib.request.urlopen(f'{B}/api/screenshot/glasses', timeout=5).read(); open(f'{out}/frames/{t:07d}.png', 'wb').write(d)
        except Exception as e: ev.append({'t': t, 'k': 'shot-error', 'v': str(e)})
        time.sleep(max(0, 0.08 - (now() - t) / 1000))
seen0 = len(console())
th = threading.Thread(target=rec, daemon=True); th.start()
ok_all = True
for st in flow:
    if 'mark' in st: ev.append({'t': now(), 'k': 'mark', 'v': st['mark']}); continue
    if 'wait' in st: time.sleep(st['wait']); continue
    if 'play' in st:
        ev.append({'t': now(), 'k': 'play-start', 'v': st['play']}); subprocess.run(['paplay', '-d', 'speakers', st['play']]); ev.append({'t': now(), 'k': 'play-end', 'v': st['play']}); continue
    seen = len(console())
    if st.get('do'): inp(st['do']); ev.append({'t': now(), 'k': 'input', 'v': st['do']})
    if st.get('expect'):
        t1 = time.time(); ok = False
        while time.time() - t1 < st.get('timeout', 20):
            if any(e['message'].startswith(f"[HELM] screen {st['expect']}") for e in console()[seen:]): ok = True; break
            time.sleep(0.1)
        ev.append({'t': now(), 'k': 'reached' if ok else 'MISS', 'v': st['expect']}); print('OK  ' if ok else 'MISS', st['expect'], flush=True)
        if not ok: ok_all = False; break
    time.sleep(st.get('settle', 0.6))
time.sleep(1.0); stop = True; th.join()
msgs = [e['message'] for e in console()[seen0:] if '[HELM]' in e['message'] or e.get('level') == 'error']
json.dump({'t0_epoch': T0, 'events': ev, 'helmConsole': msgs}, open(f'{out}/events.json', 'w'), indent=1)
print('frames', len(os.listdir(f'{out}/frames')), 'ok', ok_all); sys.exit(0 if ok_all else 1)
