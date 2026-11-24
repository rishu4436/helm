import torch
from TTS.api import TTS
torch.set_num_threads(8)
tts = TTS('tts_models/multilingual/multi-dataset/xtts_v2').to('cpu')
ref = "I remember the first time I walked into that old harbor town. The fog was low, the boats were quiet, and somewhere down the street, someone was laughing."
hook = open('script_v2.txt').read().split('\n\n')
for sp in ["Damien Black", "Aaron Dreschner"]:
    n = sp.split()[0].lower()
    tts.tts_to_file(text=ref, speaker=sp, language='en', file_path=f"ref_{n}.wav")
    tts.tts_to_file(text=hook[0] + ' ' + hook[1], speaker=sp, language='en', file_path=f"candA_xtts_{n}.wav")
print('done')
