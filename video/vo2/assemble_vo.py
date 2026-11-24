"""Join the 12 Chatterbox paragraph reads (each one unbroken take) with natural paragraph pauses. No time-stretch, no line-level joins."""
import numpy as np, soundfile as sf, json
src = {i: f'full/v_p{i:02d}.wav' for i in range(12)}
src.update({i: f's31/v_p{i:02d}.wav' for i in (1, 2, 3, 4)})
ORDER = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11]  # p09 (Shield aside) dropped to stay under 2:55
gap = [0.7, 0.8, 0.8, 0.7, 0.6, 0.6, 0.7, 0.8, 0.8, 0.9]       # pause after paragraph i
out = []; marks = []; t = 0.0; sr = 24000
for k, i in enumerate(ORDER):
    a, sr = sf.read(src[i]); a = a if a.ndim == 1 else a.mean(1)
    e = np.convolve(np.abs(a), np.ones(240) / 240, 'same'); th = 0.02 * e.max()
    nz = np.where(e > th)[0]; s0 = max(0, nz[0] - int(.08 * sr)); s1 = min(len(a), nz[-1] + int(.25 * sr))
    a = a[s0:s1]; a = a / np.sqrt(np.mean(a[np.abs(a) > .02] ** 2)) * 0.12
    f = int(.01 * sr); a[:f] *= np.linspace(0, 1, f); a[-f:] *= np.linspace(1, 0, f)
    marks.append([i, round(t, 3), round(t + len(a) / sr, 3)]); out.append(a); t += len(a) / sr
    if k < len(ORDER) - 1: out.append(np.zeros(int(gap[k] * sr))); t += gap[k]
v = np.concatenate(out); v = v / np.max(np.abs(v)) * 0.95
sf.write('vo2_final.wav', v, sr, subtype='PCM_16'); json.dump({'para': marks, 'src': src}, open('vo2_marks.json', 'w'))
print('total', round(len(v) / sr, 2)); [print(i, m) for i, m in enumerate(marks)]
