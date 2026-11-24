"""Edit decision list for helm_demo_v1. Global time g (s). VO starts at g=5.0. Glasses = real simulator frames (run1/run2),
companion = real Playwright recordings (a/b). Each shot: segments [g0, g1, s0] (source time s0 at g0, plays 1x, holds the
last real frame if the source segment ends: s1 optional)."""
import json, os
GL = '/workspace/helm-video/captures/glasses'; CO = '/workspace/helm-video/captures/companion'
frames = {r: sorted(int(f[:-4]) for f in os.listdir(f'{GL}/{r}/frames')) for r in ('run1', 'run2')}
cnt = {s: len(os.listdir(f'{CO}/f{s}')) for s in ('a', 'b')}
L = lambda k: [8, 54 + 27 * k, 568, 81 + 27 * k]          # glasses text line k (native 576x288 px)
HDR = [8, 8, 568, 32]
def cam(*k): return [list(x) for x in k]                  # [g, focusX, focusY, scale] in panel-native px
shots = []
def S(kind, src, g0, g1, segs, chapter=None, hl=(), cap=(), camk=None): shots.append(dict(kind=kind, src=src, g0=g0, g1=g1, segs=segs, chapter=chapter, hl=list(hl), cap=list(cap), cam=camk))
GC = [288, 144, 1]; CC = [720, 405, 1]                  # neutral cams
# 1 hero
S('g', 'run1', 5.0, 8.6, [[5.0, 1.6, 2.9]], camk=cam([5.0, 288, 144, 1.0], [8.6, 288, 144, 1.05]))
# 2 connect (companion a)
S('c', 'a', 8.6, 14.3, [[8.6, 1.2]], '01', hl=[[12.3, 13.9, [271, 208, 642, 313]], [13.9, 14.3, [1036, 208, 1406, 313]]], camk=cam([8.6, 720, 405, 1.0], [14.3, 720, 330, 1.08]))
S('c', 'a', 14.3, 24.9, [[14.3, 11.0]], '01', cap=[[16.8, 24.4, 'Keys verified · encrypted server-side · never on the glasses']], camk=cam([14.3, 720, 405, 1.0], [24.9, 720, 405, 1.03]))
S('c', 'a', 24.9, 34.9, [[24.9, 6.6, 9.2]], '01', hl=[[26.4, 34.6, [654, 208, 1024, 313]]], cap=[[27.0, 34.6, 'OKX: supported · untested from India · Bybit Demo stands in']], camk=cam([24.9, 720, 405, 1.0], [26.4, 720, 405, 1.0], [28.0, 839, 300, 1.6], [34.9, 839, 300, 1.66]))
# 3 portfolio
S('g', 'run1', 34.9, 44.6, [[34.9, 2.2, 3.3], [35.9, 6.3, 11.3]], '02', hl=[[39.1, 41.6, L(0)], [42.0, 44.4, L(4)]], cap=[[42.0, 44.4, 'Simulated & sandbox funds kept separate']], camk=cam([34.9, 288, 144, 1.0], [38.6, 288, 144, 1.0], [39.6, 288, 130, 1.25], [44.6, 288, 140, 1.25]))
# 4 voice: positions
S('g', 'run1', 44.6, 55.4, [[44.6, 13.4], [45.2, 14.1, 18.5], [49.6, 19.1, 20.6], [51.1, 25.6, 31.5]], '03', hl=[[51.6, 55.2, [8, 52, 568, 84]]], camk=cam([44.6, 288, 144, 1.0], [51.1, 288, 144, 1.0], [52.0, 288, 120, 1.2], [55.4, 288, 120, 1.22]))
# 5 voice: buy -> which exchange
S('g', 'run1', 55.4, 66.0, [[55.4, 34.0], [56.0, 34.8, 39.5], [60.7, 40.3, 42.8], [63.2, 43.1, 45.6]], '04', hl=[[61.6, 63.2, L(3)], [63.4, 64.4, [8, 46, 568, 70]], [64.4, 66.0, [8, 76, 380, 120]]], cap=[[63.4, 66.0, 'No exchange named → HELM asks']], camk=cam([55.4, 288, 144, 1.0], [63.2, 288, 144, 1.0], [64.0, 260, 100, 1.3], [66.0, 260, 100, 1.32]))
# 6 risk preview (Binance)
S('g', 'run1', 66.0, 85.4, [[66.0, 45.6, 46.0], [66.4, 51.9, 57.0], [73.3, 57.3, 60.8], [76.8, 61.2, 61.25], [81.0, 61.0, 64.0], [84.0, 64.0, 65.4]], '05',
  hl=[[68.5, 70.0, L(0)], [70.0, 72.0, L(1)], [72.0, 73.3, L(4)], [73.6, 75.4, L(0)], [77.0, 80.8, [8, 170, 330, 245]], [81.3, 84.0, [440, 8, 568, 32]]],
  cap=[[70.0, 73.2, 'Est. cost & fee · buying power after'], [77.2, 80.8, 'Cursor starts on Cancel'], [81.3, 84.0, 'Preview expires — 45 s']],
  camk=cam([66.0, 288, 144, 1.0], [68.0, 288, 144, 1.0], [68.6, 288, 110, 1.3], [73.2, 288, 110, 1.3], [73.6, 288, 144, 1.0], [76.8, 288, 144, 1.0], [77.4, 200, 200, 1.2], [80.8, 200, 200, 1.2], [81.4, 288, 144, 1.0]))
# 7 receipt (Binance)
S('g', 'run1', 85.4, 96.6, [[85.4, 65.5, 66.6], [86.5, 72.1, 78.2]], '06', hl=[[86.8, 88.8, L(0)], [89.6, 92.4, L(2)], [92.6, 96.3, L(4)]], cap=[[89.8, 96.2, 'Real Binance Demo order · ID & status from the exchange']],
  camk=cam([85.4, 288, 144, 1.0], [88.9, 288, 144, 1.0], [89.8, 288, 120, 1.3], [96.6, 288, 130, 1.32]))
# 8 second exchange (Bybit)
S('g', 'run1', 96.6, 113.3, [[96.6, 78.5, 81.7], [99.8, 81.7, 83.9], [102.0, 83.9, 87.5], [105.6, 96.7, 98.7], [107.6, 101.0, 102.2], [108.8, 105.3, 107.4], [110.9, 107.5, 108.3], [111.7, 121.2, 122.8]], '07',
  hl=[[105.9, 107.6, L(5)], [111.9, 113.3, L(3)]], cap=[[105.0, 108.7, 'Bybit Demo · BTC perp long · 3% stop']],
  camk=cam([96.6, 288, 144, 1.0], [113.3, 288, 144, 1.04]))
# 9 Shield
S('c', 'a', 113.3, 117.3, [[113.3, 26.0, 30.0]], '08', hl=[[114.6, 117.3, [282, 563, 782, 614]]], camk=cam([113.3, 720, 405, 1.0], [114.4, 720, 405, 1.0], [115.6, 570, 560, 1.45], [117.3, 570, 560, 1.5]))
S('g', 'run1', 117.3, 122.4, [[117.3, 135.1, 141.0]], '08', hl=[[118.8, 122.4, L(1)]], cap=[[119.6, 122.3, 'Insight: 67% of funds sit on one exchange']], camk=cam([117.3, 288, 144, 1.0], [118.6, 288, 120, 1.25], [122.4, 288, 120, 1.28]))
S('c', 'a', 122.4, 128.6, [[122.4, 36.6, 44.6]], '08', cap=[[124.0, 128.3, 'Stress test · venue-listed stops counted']], camk=cam([122.4, 720, 405, 1.0], [128.6, 720, 405, 1.04]))
# 10 Trade-to-Protect
S('g', 'run1', 128.6, 134.7, [[128.6, 122.8, 127.3]], '09', hl=[[129.6, 134.7, L(3)]], cap=[[132.4, 134.6, 'PROTECTED only because Bybit lists the stop']], camk=cam([128.6, 288, 144, 1.0], [129.4, 288, 130, 1.3], [134.7, 288, 130, 1.32]))
S('c', 'a', 134.7, 137.0, [[134.7, 51.2, 55.6]], '09', cap=[[134.7, 137.0, 'PROTECTED only because Bybit lists the stop']], camk=cam([134.7, 720, 405, 1.0], [137.0, 720, 405, 1.03]))
S('g', 'run2', 137.0, 139.8, [[137.0, 19.7, 22.5]], '09', hl=[[137.4, 139.8, L(5)]], camk=cam([137.0, 288, 144, 1.0], [137.6, 288, 150, 1.25], [139.8, 288, 150, 1.27]))
S('g', 'run2', 139.8, 143.4, [[139.8, 50.7, 56.7]], '09', hl=[[140.1, 143.4, L(3)]], cap=[[140.3, 143.3, 'Close is reduce-only · leftover stop canceled']], camk=cam([139.8, 288, 144, 1.0], [140.3, 288, 130, 1.28], [143.4, 288, 130, 1.3]))
S('c', 'b', 143.4, 148.6, [[143.4, 5.0, 11.9]], '09', cap=[[143.8, 148.3, 'Timeouts are reconciled with the exchange — never blindly resent']], camk=cam([143.4, 720, 405, 1.0], [148.6, 720, 405, 1.04]))
# brand
S('intro', None, 0.0, 5.0, []); S('end', None, 148.6, 161.0, []); S('outro', None, 161.0, 167.0, [])
CH = {'01': 'Connect accounts', '02': 'Universal portfolio', '03': '“HELM, show all my positions”', '04': '“Buy 100 dollars of BTC”', '05': 'Risk preview', '06': 'Confirm on the glasses',
      '07': 'Second exchange · Bybit Demo', '08': 'Shield · combined exposure', '09': 'Trade-to-Protect'}
END = dict(disc=149.2, w=[154.5, 155.6, 156.9])
# click SFX from real inputs that fall inside visible glasses segments
sfx = []
for sh in shots:
    if sh['kind'] != 'g': continue
    ev = json.load(open(f"{GL}/{sh['src']}/events.json"))['events']
    for i, (g0, s0, *s1) in enumerate(sh['segs']):
        gend = sh['segs'][i + 1][0] if i + 1 < len(sh['segs']) else sh['g1']
        send = s1[0] if s1 else s0 + (gend - g0)
        for e in ev:
            if e['k'] == 'input' and s0 <= e['t'] / 1000 < send and g0 + (e['t'] / 1000 - s0) < gend: sfx.append([round(g0 + e['t'] / 1000 - s0, 3), e['v']])
json.dump(dict(shots=shots, frames=frames, cnt=cnt, CH=CH, END=END, DUR=167.0, sfx=sorted(sfx)), open('/workspace/helm-video/edit/edl.json', 'w'))
print(len(shots), 'shots', len(sfx), 'clicks')
