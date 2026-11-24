"""
HELM local speech-to-text sidecar (open source, no paid key): faster-whisper on CPU, bound to 127.0.0.1 only.
POST /transcribe  body = WAV (16 kHz mono PCM16)  → {"text","confidence","noSpeechProb","durationMs","model","language"}
GET  /health
Env: HELM_STT_MODEL (default base.en), HELM_STT_COMPUTE (default float32), HELM_STT_PORT (default 8178), HELM_STT_THREADS (default 4).
"""
import io, json, math, os, time, wave
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import numpy as np
from faster_whisper import WhisperModel

MODEL = os.environ.get("HELM_STT_MODEL", "base.en")
PORT = int(os.environ.get("HELM_STT_PORT", "8178"))
MAX_BYTES = 2 * 1024 * 1024  # ~60 s of 16 kHz PCM16
# Domain hint only biases spelling of tickers/venues; it never adds words that were not spoken.
PROMPT = "Trading commands: buy, sell, long, short, close, stop, BTC, ETH, SOL, Bitcoin, Ethereum, Solana, Binance, Bybit, OKX, Coinbase, dollars, percent, leverage."

t0 = time.time()
# float32 on purpose: on this box's Xeon the int8 kernels gave non-deterministic, sometimes garbage transcripts
# for the same audio (measured: ~40% variants over 25 runs); float32 gave 25/25 identical. See docs/STT.md.
COMPUTE = os.environ.get("HELM_STT_COMPUTE", "float32")
model = WhisperModel(MODEL, device="cpu", compute_type=COMPUTE, cpu_threads=int(os.environ.get("HELM_STT_THREADS", "4")))
print(f"[helm-stt] loaded {MODEL} ({COMPUTE}) in {time.time()-t0:.1f}s on 127.0.0.1:{PORT}", flush=True)


def decode_wav(b: bytes) -> np.ndarray:
    with wave.open(io.BytesIO(b)) as w:
        if w.getsampwidth() != 2:
            raise ValueError("PCM16 WAV required")
        sr, ch = w.getframerate(), w.getnchannels()
        a = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
    if ch > 1:
        a = a.reshape(-1, ch).mean(axis=1)
    if sr != 16000:  # linear resample (adequate for speech)
        n = int(len(a) * 16000 / sr)
        a = np.interp(np.linspace(0, len(a) - 1, n), np.arange(len(a)), a).astype(np.float32)
    return a


LOCK = threading.Lock()


class H(BaseHTTPRequestHandler):
    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)

    def log_message(self, *a):  # no request logging (audio content is private)
        pass

    def do_GET(self):
        if self.path == "/health":
            return self._json(200, {"status": "ok", "model": MODEL})
        self._json(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/transcribe":
            return self._json(404, {"error": "not found"})
        n = int(self.headers.get("Content-Length", "0"))
        if n <= 0 or n > MAX_BYTES:
            return self._json(413, {"error": "audio too large or empty"})
        try:
            audio = decode_wav(self.rfile.read(n))
        except Exception as e:
            return self._json(400, {"error": f"bad wav: {e}"})
        t = time.time()
        with LOCK:
            segs, info = model.transcribe(audio, language="en", beam_size=5, temperature=0.0, vad_filter=True, initial_prompt=PROMPT, condition_on_previous_text=False)
            segs = list(segs)
        text = " ".join(s.text.strip() for s in segs).strip()
        lp = [s.avg_logprob for s in segs]
        conf = round(math.exp(sum(lp) / len(lp)), 4) if lp else 0.0
        nsp = round(max((s.no_speech_prob for s in segs), default=1.0), 4)
        self._json(200, {"text": text[:500], "confidence": conf, "noSpeechProb": nsp, "durationMs": int(info.duration * 1000), "elapsedMs": int((time.time() - t) * 1000), "model": f"faster-whisper:{MODEL}", "language": info.language})


ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
