"""Lengthen a few existing sentence gaps of the single continuous take (cut placed at the quietest 10 ms inside the gap). No re-synthesis, no stretching."""
import json, numpy as np, soundfile as sf, re
a, sr = sf.read('vo_full_24k.wav'); W = json.load(open('words.json'))
norm = lambda s: re.sub(r'[^a-z0-9$%]', '', s.lower())
anchors = [('g2', .4), ('today', .8), ('labeled', .4), ('positions', 2.2), ('sits', .6), ('btc', 1.6), ('demo', 1.0, 'binance'), ('through', .6), ('confirm', .8, 'confirm'),
           ('assumed', 1.2), ('confirm', 5.3, 'deliberate'), ('in', 1.0, 'counted'), ('behind', .6), ('again', 1.2), ('advice', .8)]
cuts = []; i = 0
for an in anchors:
    w, extra = an[0], an[1]; prev = an[2] if len(an) > 2 else None
    while i < len(W) and not (norm(W[i]['w']) == w and (prev is None or (i > 0 and norm(W[i-1]['w']) == prev) or (prev == 'confirm' and norm(W[i]['w']) == 'confirm'))): i += 1
    assert i < len(W) - 1, an
    e, s2 = W[i]['e'], W[i+1]['s']
    lo, hi = int((e - .25) * sr), int((max(s2, e) + .6) * sr); n = int(.01 * sr)
    r = np.array([np.sqrt(np.mean(a[k:k+n]**2)) for k in range(lo, hi - n, n)]) < .004
    best, bl, run, rs = None, 0, 0, 0
    for j, q in enumerate(r):
        if q: run += 1; rs = j - run + 1
        else: run = 0
        if run > bl: bl, best = run, rs
    if bl < 6: print('SKIP (no clean silence)', an); i += 1; continue
    k = lo + (best + bl // 2) * n - int(e * sr)
    cuts.append((int(e*sr) + k, extra, W[i]['w'], W[i+1]['w'])); i += 1
out = []; last = 0
for pos, extra, w1, w2 in cuts:
    out += [a[last:pos], np.zeros(int(extra*sr))]; last = pos; print(f'{pos/sr:7.2f}s +{extra}s  {w1} | {w2}')
out.append(a[last:]); b = np.concatenate(out)
sf.write('vo_final_24k.wav', b, sr, subtype='PCM_16'); print('final', len(b)/sr)
