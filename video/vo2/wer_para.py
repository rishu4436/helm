import sys, re, wave, numpy as np, glob, json
from faster_whisper import WhisperModel
m = WhisperModel('small.en', device='cpu', compute_type='int8')
P = open('/workspace/helm-video/vo2/script_v2.txt').read().strip().split('\n\n')
norm = lambda s: re.sub(r"[^a-z0-9' ]", ' ', s.lower().replace('-', ' ').replace('bye bit', 'bybit').replace('by bit', 'bybit')).split()
def wer(r, h):
    d = np.arange(len(h) + 1)
    for i, rw in enumerate(r, 1):
        p = d.copy(); d[0] = i
        for j, hw in enumerate(h, 1): d[j] = min(p[j] + 1, d[j - 1] + 1, p[j - 1] + (rw != hw))
    return d[-1] / len(r)
out = {}
for f in sorted(glob.glob(sys.argv[1] + '_p*.wav')):
    i = int(f[-6:-4])
    import subprocess
    x = np.frombuffer(subprocess.run(['ffmpeg','-v','error','-i',f,'-f','f32le','-ac','1','-ar','16000','-'],capture_output=True).stdout, np.float32); a = x; sr = 16000
    segs, _ = m.transcribe(x, language='en'); hyp = ' '.join(s.text for s in segs)
    e = wer(norm(P[i]), norm(hyp)); out[i] = e
    print(f"p{i:02d} {len(a)/sr:5.1f}s WER {e*100:4.1f}%  {hyp.strip()[:300]}")
