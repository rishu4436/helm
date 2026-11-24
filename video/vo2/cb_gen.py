"""Chatterbox: generate paragraphs (each one natural, unbroken read) with a reference voice. Usage: cb_gen.py ref.wav outprefix exag cfg [paragraph indices or 'all'] [seed]"""
import sys, torch, torchaudio as ta, time
from chatterbox.tts import ChatterboxTTS
torch.set_num_threads(8)
ref, out, ex, cfg = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4])
sel = sys.argv[5] if len(sys.argv) > 5 else 'all'; seed = int(sys.argv[6]) if len(sys.argv) > 6 else 7
P = open('script_v2.txt').read().strip().split('\n\n')
idx = range(len(P)) if sel == 'all' else [int(x) for x in sel.split(',')]
m = ChatterboxTTS.from_pretrained(device='cpu')
for i in idx:
    torch.manual_seed(seed + i)
    t0 = time.time(); w = m.generate(P[i].replace('Bybit', 'Bye-bit'), audio_prompt_path=ref, exaggeration=ex, cfg_weight=cfg, temperature=0.8)
    ta.save(f'{out}_p{i:02d}.wav', w, m.sr); print(i, round(w.shape[-1] / m.sr, 1), 's took', round(time.time() - t0), flush=True)
