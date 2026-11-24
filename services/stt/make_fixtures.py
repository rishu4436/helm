"""Generate real spoken WAV fixtures with the local Kokoro TTS (open source, offline). 16 kHz mono PCM16."""
import sys, wave
import numpy as np
from kokoro_onnx import Kokoro
K = Kokoro("/workspace/tts/kokoro-v1.0.onnx", "/workspace/tts/voices-v1.0.bin")
PHRASES = {
  "buy-100-btc-bybit": ("Buy 100 dollars of BTC on Bybit", "af_heart"),
  "buy-100-btc": ("Buy 100 dollars of BTC", "am_michael"),
  "show-positions": ("Show all my positions", "bf_emma"),
  "long-eth-stop": ("Long 200 dollars of ETH on Binance with a 3 percent stop", "am_adam"),
  "close-btc-bybit": ("Close my BTC position on Bybit", "af_sarah"),
  "withdraw": ("Withdraw all my bitcoin to this address", "af_heart"),
}
out = sys.argv[1]
for name, (text, voice) in PHRASES.items():
    s, sr = K.create(text, voice=voice, speed=1.0, lang="en-us")
    n = int(len(s) * 16000 / sr)
    s16 = np.interp(np.linspace(0, len(s) - 1, n), np.arange(len(s)), s)
    pcm = (np.clip(s16, -1, 1) * 32767).astype(np.int16)
    with wave.open(f"{out}/{name}.wav", "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000); w.writeframes(pcm.tobytes())
    open(f"{out}/{name}.txt", "w").write(text + "\n")
    print(name, voice, f"{len(pcm)/16000:.2f}s")
