import json, sys, numpy as np, wave
from faster_whisper import WhisperModel
path = sys.argv[1]; out = sys.argv[2]
with wave.open(path) as w:
    sr = w.getframerate(); n = w.getnframes(); ch = w.getnchannels(); sw = w.getsampwidth()
    raw = w.readframes(n)
a = np.frombuffer(raw, dtype=np.int16 if sw == 2 else np.int32).astype(np.float32) / (32768 if sw == 2 else 2**31)
if ch > 1: a = a.reshape(-1, ch).mean(1)
x = np.interp(np.arange(int(len(a) * 16000 / sr)) / 16000, np.arange(len(a)) / sr, a).astype(np.float32)
m = WhisperModel('base.en', device='cpu', compute_type='float32')
segs, _ = m.transcribe(x, word_timestamps=True, language='en')
words = [{'w': w.word.strip(), 's': round(w.start, 2), 'e': round(w.end, 2)} for s in segs for w in s.words]
json.dump(words, open(out, 'w'))
for p, q in zip(words, words[1:]):
    if q['s'] - p['e'] > 0.3: print(f"{p['e']:6.2f} gap {q['s']-p['e']:.2f} after '{p['w']}' -> '{q['w']}'")
print(len(words), words[-1])
