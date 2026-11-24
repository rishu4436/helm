"""v2 EDL: product demo, picture retimed to the Chatterbox narration (VO starts at g=2.2). Real captures only."""
import json, os
GL = '/workspace/helm-video/captures/glasses'; CO = '/workspace/helm-video/captures/companion'
frames = {r: sorted(int(f[:-4]) for f in os.listdir(f'{GL}/{r}/frames')) for r in ('run1', 'run2', 'run3')}
cnt = {s: len(os.listdir(f'{CO}/f{s}')) for s in ('a', 'b')}
L = lambda k: [8, 54 + 27 * k, 568, 81 + 27 * k]
shots = []
def S(kind, src, g0, g1, segs, hl=(), cap=()): shots.append(dict(kind=kind, src=src, g0=g0, g1=g1, segs=segs, hl=list(hl), cap=list(cap), cam=None))
# hook montage (glasses, real screens)
S('g', 'run1', 2.0, 5.8, [[2.0, 6.4, 11.3]])            # overview
S('g', 'run1', 5.8, 9.8, [[5.8, 25.6, 31.5]])           # positions
S('g', 'run1', 9.8, 13.6, [[9.8, 135.1, 141.0]])        # exposure compass
S('g', 'run1', 13.6, 19.1, [[13.6, 1.6, 2.9]])          # home
# input explanation + real swipe / tap / double-tap
S('g', 'run1', 19.1, 33.4, [[19.1, 142.3, 142.35], [28.0, 145.0, 147.3], [30.3, 150.1, 150.9], [31.1, 155.1, 157.2]])
# connect (companion)
S('c', 'a', 33.4, 37.4, [[33.4, 1.2]])
S('c', 'a', 37.4, 49.6, [[37.4, 9.4]])
S('c', 'a', 49.6, 56.6, [[49.6, 6.6, 9.2]], hl=[[50.4, 56.3, [654, 208, 1024, 313]]], cap=[[50.6, 56.3, 'OKX: supported · untested from India · Bybit Demo stands in']])
# morning glance + voice "show all my positions"
S('g', 'run1', 56.6, 77.0, [[56.6, 2.0, 3.3], [57.9, 6.3, 11.3], [65.0, 13.2, 14.05], [65.8, 14.1, 18.5], [70.2, 19.1, 20.3], [71.4, 25.6, 31.5]])
# voice "buy 100 dollars of BTC" -> Which exchange? -> Binance Demo -> preview -> confirm
S('g', 'run1', 77.0, 102.0, [[77.0, 34.0, 34.65], [77.6, 34.8, 39.5], [82.3, 40.3, 42.8], [84.8, 43.1, 45.6], [87.0, 45.6, 47.6], [89.0, 51.9, 57.15], [94.1, 57.3, 60.85], [97.6, 61.0, 65.4]])
# submit -> real Binance Demo fill
S('g', 'run1', 102.0, 114.4, [[102.0, 65.5, 66.6], [103.1, 72.1, 78.0]], hl=[[106.4, 111.8, L(2)]])
# double-tap backs out, nothing sent
S('g', 'run3', 114.4, 121.0, [[114.4, 15.0, 18.5], [117.9, 18.5, 20.5]], cap=[[118.2, 120.8, 'Double-tap: backed out · nothing sent']])
# Bybit: long + 3% stop -> PROTECTED
S('g', 'run1', 121.0, 140.1, [[121.0, 79.4, 81.7], [123.3, 81.7, 83.9], [125.5, 83.9, 87.5], [129.1, 96.7, 98.2], [130.6, 101.0, 102.0], [131.6, 105.8, 107.4], [133.2, 107.5, 108.3], [134.0, 121.2, 127.2]], hl=[[135.5, 140.0, L(3)]])
S('c', 'a', 140.1, 142.9, [[140.1, 51.0, 55.0]])
# close, reduce-only, orphan stop canceled
S('g', 'run2', 142.9, 157.2, [[142.9, 7.0, 10.15], [146.0, 19.6, 24.65], [151.0, 24.8, 25.8], [152.0, 28.6, 30.75], [154.1, 30.9, 31.5], [154.7, 50.7, 56.7]], hl=[[147.6, 150.9, L(5)], [155.0, 157.1, L(3)]])
S('intro', None, 0.0, 2.0, []); S('end', None, 157.2, 167.2, []); S('outro', None, 167.2, 169.2, [])
gest, ui = [], []
for sh in shots:
    if sh['kind'] != 'g': continue
    ev = json.load(open(f"{GL}/{sh['src']}/events.json"))['events']
    for i, (g0, s0, *s1) in enumerate(sh['segs']):
        gend = sh['segs'][i + 1][0] if i + 1 < len(sh['segs']) else sh['g1']
        send = s1[0] if s1 else s0 + (gend - g0)
        for e in ev:
            ts = e['t'] / 1000
            if e['k'] == 'input' and s0 <= ts < send and g0 + ts - s0 < gend: gest.append([round(g0 + ts - s0, 3), e['v']])
json.dump(dict(shots=shots, frames=frames, cnt=cnt, DUR=169.2, gest=sorted(gest), confirm=[101.9, 133.2, 154.1]), open('/workspace/helm-video/edit/edl_v2.json', 'w'))
print(len(shots), 'shots', len(gest), 'gestures')
