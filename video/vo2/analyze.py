import sys, json, numpy as np, librosa, re
for p in sys.argv[1:]:
    y, sr = librosa.load(p, sr=16000)
    f0, vf, _ = librosa.pyin(y, fmin=60, fmax=300, sr=sr, frame_length=1024)
    f = f0[vf & ~np.isnan(f0)]
    st = 12 * np.log2(f / np.median(f))
    rms = librosa.feature.rms(y=y, frame_length=400, hop_length=160)[0]; sil = rms < 0.01 * rms.max() * 3
    print(f"{p}: dur {len(y)/sr:.1f}s  medianF0 {np.median(f):.0f}Hz  F0 sd {st.std():.2f} st  range(5-95) {np.percentile(st,95)-np.percentile(st,5):.1f} st  silence {sil.mean()*100:.0f}%")
