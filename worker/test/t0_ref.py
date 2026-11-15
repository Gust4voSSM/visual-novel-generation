"""T0 Python reference. Reads the evidence images (read-only) and writes keyed outputs to OUT.

- magenta-*: the key_magenta.py top-level math, copied verbatim except paths (its own
  top level writes into the evidence folder, so it is not executed in place).
- soft-*: key() loaded via AST from gpt-green-key-study/analyze.py, unchanged
  (its HSV hard key needs cv2, which is not installed: a stub cv2 is injected; the hard
  output is discarded and does not touch the soft key).
- distance-*: the screen-distance block of macaw-green-key-study/analyze.py, verbatim,
  with the screen from key() as in that script.
- cornerexcess-*: key_magenta.py generalised to the green axis (the production path).
"""
from pathlib import Path
import ast, sys, json
import numpy as np
from PIL import Image

IMG = Path(sys.argv[1])  # output/imagegen
OUT = Path(sys.argv[2]); OUT.mkdir(parents=True, exist_ok=True)

class _Cv2Stub:
    COLOR_RGB2HSV = 0
    @staticmethod
    def cvtColor(a, code): return a
    @staticmethod
    def inRange(a, lo, hi): return np.zeros(a.shape[:2], np.uint8)

src = IMG / 'gpt-green-key-study/analyze.py'
fn = next(n for n in ast.parse(src.read_text(encoding='utf-8-sig')).body if isinstance(n, ast.FunctionDef) and n.name == 'key')
ns = {'np': np, 'Image': Image, 'cv2': _Cv2Stub}
exec(compile(ast.Module(body=[fn], type_ignores=[]), str(src), 'exec'), ns)
key = ns['key']
report = {}

# --- key_magenta.py ---
rgb = Image.open(IMG / 'macaw-magenta-key-study/pose-magenta.png').convert('RGB')
c=np.array(rgb).astype(np.float32)
patches=[c[:32,:32],c[:32,-32:],c[-32:,:32],c[-32:,-32:]]
medians=np.array([np.median(p.reshape(-1,3),axis=0) for p in patches])
bg=np.median(medians,axis=0)
if np.linalg.norm(medians-bg,axis=1).max()>20:
    raise ValueError('Corner patches disagree; background estimation rejected')
screen_excess=min(bg[0]-bg[1],bg[2]-bg[1])
if screen_excess<120:raise ValueError('Background is not strong magenta')
excess=np.minimum(c[:,:,0]-c[:,:,1],c[:,:,2]-c[:,:,1])
a=1-np.clip((excess-8)/(screen_excess-16),0,1)
da=np.clip((np.linalg.norm(c-bg,axis=2)-8)/72,0,1)

def rgba(alpha,unmix):
    out=c.copy()
    if unmix:out=np.clip((c-(1-alpha[:,:,None])*bg)/np.maximum(alpha[:,:,None],1/255),0,255)
    a8=np.rint(alpha*255).astype(np.uint8);out[a8==0]=0
    return Image.fromarray(np.dstack([np.rint(out).astype(np.uint8),a8]))

for name, im in [('distance', rgba(da, True)), ('raw-alpha', rgba(a, False)), ('recovered', rgba(a, True))]:
    im.save(OUT / f'magenta-{name}.png')
report['magenta'] = {'corner_medians': medians.tolist(), 'background': bg.tolist(), 'max_dev': float(np.linalg.norm(medians-bg,axis=1).max()), 'screen_excess': float(screen_excess)}

# --- green poses ---
greens = {'speaking': IMG/'gpt-green-key-study/speaking-green.png', 'listening': IMG/'gpt-green-key-study/listening-green.png',
          'thinking': IMG/'gpt-green-key-study/thinking-green.png', 'macaw': IMG/'macaw-green-key-study/pose-green.png'}
for pose, path in greens.items():
    rgb = Image.open(path).convert('RGB')
    soft, hard, alpha, screen = key(rgb)
    soft.save(OUT / f'soft-{pose}.png')
    # macaw-green-key-study/analyze.py, screen-distance block
    arr=np.array(rgb).astype(np.float32);bg=np.array(screen,np.float32)
    distance=np.linalg.norm(arr-bg,axis=2)
    da=np.clip((distance-8)/72,0,1)
    da8=np.rint(da*255).astype(np.uint8)
    recovered=np.clip((arr-(1-da[:,:,None])*bg)/np.maximum(da[:,:,None],1/255),0,255)
    recovered[da8==0]=0
    Image.fromarray(np.dstack([np.rint(recovered).astype(np.uint8),da8])).save(OUT / f'distance-{pose}.png')
    # key_magenta.py generalised to green: corners + excess G-max(R,B) + unmix, no despill
    c=arr
    patches=[c[:32,:32],c[:32,-32:],c[-32:,:32],c[-32:,-32:]]
    medians=np.array([np.median(p.reshape(-1,3),axis=0) for p in patches])
    cbg=np.median(medians,axis=0)
    dev=float(np.linalg.norm(medians-cbg,axis=1).max())
    se=cbg[1]-max(cbg[0],cbg[2])
    ex=c[:,:,1]-np.maximum(c[:,:,0],c[:,:,2])
    a=1-np.clip((ex-8)/(se-16),0,1)
    out=np.clip((c-(1-a[:,:,None])*cbg)/np.maximum(a[:,:,None],1/255),0,255)
    a8=np.rint(a*255).astype(np.uint8);out[a8==0]=0
    Image.fromarray(np.dstack([np.rint(out).astype(np.uint8),a8])).save(OUT / f'cornerexcess-{pose}.png')
    report[pose] = {'border_screen': screen, 'corner_background': cbg.tolist(), 'corner_max_dev': dev, 'corner_screen_excess': float(se)}

(OUT / 'report.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
