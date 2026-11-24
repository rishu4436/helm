"""ONE continuous Kokoro am_adam read of the whole script (single create() call). No stitching, no time-stretch.
Paragraph breaks become a sentence pause inside the same read."""
import json, numpy as np, soundfile as sf
from kokoro_onnx import Kokoro
txt = open('/workspace/helm-video/vo/script.txt').read().strip()
k = Kokoro('/workspace/tts/kokoro-v1.0.onnx', '/workspace/tts/voices-v1.0.bin')
flat = ' '.join(p.strip().replace('\n', ' ') for p in txt.split('\n\n')).replace('Bybit', 'Bye-bit')
audio, sr = k.create(flat, voice='am_adam', speed=0.92, lang='en-us')
a = np.asarray(audio, dtype=np.float32)
a = a / (np.max(np.abs(a)) or 1) * 0.9
sf.write('/workspace/helm-video/vo/vo_full_24k.wav', a, sr)
print('duration', len(a) / sr)
