#!/usr/bin/env python3
"""HELM bed: graphite/amber mood. D minor, i–VI–III–VII, soft pad + pluck arp + sub, light hats in the body. Procedural (numpy/scipy), Atlas approach."""
import numpy as np, json
from scipy import signal
from scipy.io import wavfile
SR = 48000; DUR = 167.0; N = int(SR * DUR); rng = np.random.default_rng(7)
T = lambda d: np.arange(int(SR * d)) / SR
mus = np.zeros((N, 2))
def add(x, t, g=1.0, pan=0.0):
    i = int(t * SR)
    if i >= N: return
    x = x[:N - i]; l = np.cos((pan + 1) * np.pi / 4) * 1.414; r = np.sin((pan + 1) * np.pi / 4) * 1.414
    mus[i:i + len(x), 0] += x * g * l; mus[i:i + len(x), 1] += x * g * r
lp = lambda x, f, o=2: signal.sosfilt(signal.butter(o, f, 'low', fs=SR, output='sos'), x)
hp = lambda x, f, o=2: signal.sosfilt(signal.butter(o, f, 'high', fs=SR, output='sos'), x)
hz = lambda n: 440 * 2 ** ((n - 69) / 12)
saw = lambda f, t, ph=0: 2 * ((f * t + ph) % 1) - 1
BEAT = 60 / 92; BAR = 4 * BEAT
CH = [[50, 53, 57, 62], [46, 50, 53, 58], [53, 57, 60, 65], [48, 52, 55, 60]]  # Dm Bb F C
def chord_at(t): return CH[int(t // (2 * BAR)) % 4]
# pad: per 2-bar chord, detuned saws, lowpassed, slow attack/release
seg = 2 * BAR; k = 0
while k * seg < DUR:
    t0 = k * seg; d = seg + 1.5; t = T(d); ch = CH[k % 4]
    x = sum(sum(saw(hz(n) * (1 + dt), t, rng.random()) for dt in (-.004, 0, .004)) for n in ch) / 12
    x = lp(x, 900 if 8 < t0 < 146 else 600, 2)
    env = np.minimum(1, t / 1.2) * np.minimum(1, np.maximum(0, (d - t) / 1.5)); add(x * env, t0, .22, 0)
    k += 1
# sub bass (body only)
k = 0
while k * seg < DUR:
    t0 = k * seg
    if 6.0 <= t0 < 146:
        t = T(seg); f = hz(CH[k % 4][0] - 12); x = np.sin(2 * np.pi * f * t) * np.minimum(1, t / .08) * np.exp(-t * .25); add(x, t0, .20)
    k += 1
# pluck arp, 8ths, body
def pluck(f, d=.45):
    t = T(d); x = (2 * np.abs(saw(f, t)) - 1) * np.exp(-t * 7.5); return lp(x, 2600, 2)
t = 6.0
i = 0
while t < 146.5:
    ch = chord_at(t); n = [ch[0] + 12, ch[1] + 12, ch[2] + 12, ch[3] + 12, ch[2] + 12, ch[1] + 12][i % 6]
    add(pluck(hz(n)), t, .075, -.35 + .7 * ((i % 6) / 5)); t += BEAT / 2; i += 1
# hats + soft kick (body)
def hat(): tt = T(.06); return hp(rng.standard_normal(len(tt)), 7000, 4) * np.exp(-tt * 60)
def kick(): tt = T(.45); f = 45 + 70 * np.exp(-tt * 22); return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 7)
b = 8.0
while b < 145.5:
    add(hat(), b + BEAT / 2, .045, .25)
    if int(round((b - 8.0) / BEAT)) % 4 == 0: add(kick(), b, .16)
    b += BEAT
# bells / hits
def bell(f, d=3.0):
    tt = T(d); return (np.sin(2 * np.pi * f * tt) + .35 * np.sin(2 * np.pi * f * 2.76 * tt) * np.exp(-tt * 3)) * np.exp(-tt * 1.6)
def boom(): tt = T(2.5); f = 38 + 30 * np.exp(-tt * 6); return lp(np.sin(2 * np.pi * np.cumsum(f) / SR), 200) * np.exp(-tt * 1.8)
add(boom(), .9, .30); add(bell(hz(74)), .9, .10, -.2); add(bell(hz(81)), 1.05, .07, .2)
for tt_, n in [(154.4, 74), (155.5, 77), (156.8, 81)]: add(bell(hz(n)), tt_, .07, 0)
add(boom(), 161.9, .22); add(bell(hz(74)), 161.9, .09, -.2); add(bell(hz(81)), 162.05, .06, .2)
# riser into film + soft swell to end card
tt = T(1.2); add(hp(rng.standard_normal(len(tt)), 3000) * (tt / 1.2) ** 2 * .5, 3.8, .05)
# master envelope: fade in 0.3s, fade out last 2.5s
env = np.ones(N); fi = int(.3 * SR); env[:fi] = np.linspace(0, 1, fi); fo = int(2.5 * SR); env[-fo:] = np.linspace(1, 0, fo) ** 2
mus *= env[:, None]; mus /= np.max(np.abs(mus)) * 1.12
wavfile.write('bed.wav', SR, (mus * 32767).astype(np.int16)); print('bed', DUR)
# SFX: soft tap clicks at real glasses inputs + whooshes at section changes
edl = json.load(open('/workspace/helm-video/edit/edl.json'))
sfx = np.zeros((N, 2))
def tick():
    tt = T(.05); return (np.sin(2 * np.pi * 2300 * tt) * np.exp(-tt * 120) + .4 * hp(rng.standard_normal(len(tt)), 4000) * np.exp(-tt * 250))
def whoosh(d=.7):
    tt = T(d); x = signal.sosfilt(signal.butter(2, [600, 3500], 'band', fs=SR, output='sos'), rng.standard_normal(len(tt))); return x * np.sin(np.pi * tt / d) ** 2
for t_, a in edl['sfx']:
    x = tick() * (.6 if a == 'click' else .35 if a == 'double_click' else .25); i = int(t_ * SR); sfx[i:i + len(x)] += x[:, None] * .5
for t_ in (4.7, 148.3, 160.7):
    x = whoosh(); i = int(t_ * SR); sfx[i:i + len(x)] += x[:, None] * .08
wavfile.write('sfx.wav', SR, (np.clip(sfx, -1, 1) * 32767).astype(np.int16)); print('sfx', len(edl['sfx']))
