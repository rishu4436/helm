import json, os, sys
from PIL import Image
d = sys.argv[1]; ev = json.load(open(f'{d}/events.json'))['events']
fr = sorted(int(f[:-4]) for f in os.listdir(f'{d}/frames'))
os.makedirs(f'{d}/key', exist_ok=True)
# frame just before each input = what the screen showed after settle
ins = [e for e in ev if e['k'] == 'input'] + [{'t': fr[-1] + 1, 'v': 'end'}]
n = 0
for e in ins:
    c = [f for f in fr if f < e['t'] - 30]
    if not c: continue
    im = Image.open(f'{d}/frames/{c[-1]:07d}.png').convert('RGBA'); bg = Image.new('RGBA', im.size, (0, 0, 0, 255)); bg.alpha_composite(im)
    bg.convert('RGB').save(f'{d}/key/{n:02d}-{c[-1]}-before-{e["v"]}.png'); n += 1
print(n, Image.open(f'{d}/frames/{fr[0]:07d}.png').size)
