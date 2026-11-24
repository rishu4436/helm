import sys, re, json, wave, numpy as np
from faster_whisper import WhisperModel
m = WhisperModel('small.en', device='cpu', compute_type='int8')
ref = open('script_v2.txt').read().strip().split('\n\n'); ref = ' '.join(ref[:2])
norm = lambda s: re.sub(r"[^a-z0-9' ]", ' ', s.lower().replace('-', ' ')).split()
def wer(r, h):
    d = np.arange(len(h) + 1)
    for i, rw in enumerate(r, 1):
        p = d.copy(); d[0] = i
        for j, hw in enumerate(h, 1): d[j] = min(p[j] + 1, d[j - 1] + 1, p[j - 1] + (rw != hw))
    return d[-1] / len(r)
for p in sys.argv[1:]:
    with wave.open(p) as w: sr = w.getframerate(); a = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768
    x = np.interp(np.arange(int(len(a) * 16000 / sr)) / 16000, np.arange(len(a)) / sr, a).astype(np.float32)
    segs, _ = m.transcribe(x, word_timestamps=True, language='en'); ws = [w for s in segs for w in s.words]
    hyp = ' '.join(w.word for w in ws); gaps = [b.start - a.end for a, b in zip(ws, ws[1:])]
    dur = len(a) / sr; spk = sum(w.end - w.start for w in ws)
    print(f"{p}: WER {wer(norm(ref), norm(hyp))*100:.1f}%  wpm {len(ws)/dur*60:.0f}  pauses>0.25s {sum(g>0.25 for g in gaps)}  longest {max(gaps):.2f}s\n   {hyp}")
