// Exporta a história como um único .html jogável, com as imagens embutidas (data URIs).
// Só entram as cenas alcançáveis a partir da cena inicial; ações sem destino ficam ocultas.

const blobToDataUrl = (b) =>
  new Promise((ok, err) => {
    const r = new FileReader();
    r.onload = () => ok(r.result);
    r.onerror = () => err(r.error);
    r.readAsDataURL(b);
  });
async function toDataUrl(url) {
  if (!url || url.startsWith('data:')) return url || '';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return blobToDataUrl(await res.blob());
}

function reachable(state) {
  const byId = new Map(state.scenes.map((s) => [s.id, s])),
    seen = new Set(),
    todo = [state.start];
  while (todo.length) {
    const id = todo.pop();
    const s = byId.get(id);
    if (!s || seen.has(id)) continue;
    seen.add(id);
    if (s.choices?.length) s.choices.forEach((c) => c.target && todo.push(c.target));
    else if (s.next) todo.push(s.next);
  }
  return state.scenes.filter((s) => seen.has(s.id));
}

export async function buildStoryHtml(state) {
  const scenes = reachable(state);
  if (!scenes.length) throw new Error('Defina uma cena inicial.');
  const imgs = new Map(),
    failed = [];
  const want = (url) => {
    if (url && !imgs.has(url)) imgs.set(url, null);
    return url;
  };
  const chars = {},
    bgs = {};
  const data = {
    title: state.title || 'História',
    start: state.start,
    scenes: scenes.map((s) => {
      const bg = state.backgrounds.find((b) => b.id === s.bg);
      if (bg && bg.img && !bgs[bg.id]) bgs[bg.id] = { name: bg.name, img: want(bg.img) };
      const cs = s.chars
        .map((cc) => {
          const c = state.characters.find((x) => x.id === cc.c),
            sp = c?.sprites.find((x) => x.id === cc.s);
          if (!sp?.img) return null;
          return { name: c.name, pose: sp.name, img: want(sp.img) };
        })
        .filter(Boolean);
      const spk = s.kind === 'dialogue' ? state.characters.find((c) => c.id === s.speaker) : null;
      return {
        id: s.id,
        title: s.title,
        bg: bg?.img ? bg.id : '',
        chars: cs,
        speaker: spk ? { name: spk.name, color: spk.color || '' } : null,
        text: s.text || '',
        next: s.next || '',
        choices: (s.choices || [])
          .filter((c) => c.target)
          .map((c) => ({ label: c.label || '…', target: c.target })),
      };
    }),
    bgs,
  };
  await Promise.all(
    [...imgs.keys()].map(async (u) => {
      try {
        imgs.set(u, await toDataUrl(u));
      } catch (e) {
        failed.push(u);
        imgs.set(u, '');
      }
    }),
  );
  const swap = (u) => imgs.get(u) || '';
  Object.values(data.bgs).forEach((b) => (b.img = swap(b.img)));
  data.scenes.forEach((s) => s.chars.forEach((c) => (c.img = swap(c.img))));
  return { html: page(data), failed, count: scenes.length };
}

export async function downloadStoryHtml(state) {
  const r = await buildStoryHtml(state);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([r.html], { type: 'text/html' }));
  a.download =
    ((state.title || 'historia').replace(/[^\p{L}\p{N}\- ]+/gu, '').trim() || 'historia') + '.html';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return r;
}

const escHtml = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );

function page(data) {
  // JSON dentro de <script>: neutraliza "</script" e afins.
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHtml(data.title)}</title>
<style>
:root{--ink:#111214;--surface:#1c1d21;--surface-2:#24252a;--line:#2f3137;--line-3:#34363d;--text:#e7e5e0;--text-2:#b9bbc1;--muted:#8d8f96;--amber:#f2a541;--amber-hi:#ffb95c;--amber-soft:#f2c48a;
--sans:'IBM Plex Sans',system-ui,-apple-system,'Segoe UI',sans-serif;--mono:'IBM Plex Mono',ui-monospace,Menlo,monospace;color-scheme:dark}
*{box-sizing:border-box}html,body{height:100%;margin:0}
body{background:var(--ink);color:var(--text);font-family:var(--sans);font-size:13px}
button{font:inherit;color:inherit;cursor:pointer}:focus-visible{outline:2px solid #6cb6ff;outline-offset:2px}
.play{min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px 16px}
.phead{width:min(100%,calc((100vh - 140px)*16/9));display:flex;align-items:center;gap:8px;font-family:var(--mono);font-size:12px;color:var(--muted)}
.phead .grow{flex:1}
.pbtn{height:32px;padding:0 12px;border-radius:8px;border:1px solid var(--line-3);background:transparent;color:#d6d4cf;font-size:13px}
.pbtn:hover:not(:disabled){border-color:var(--amber);color:var(--amber-soft)}.pbtn:disabled{opacity:.35;cursor:default}
.stage{position:relative;width:min(100%,calc((100vh - 140px)*16/9));aspect-ratio:16/9;border-radius:14px;overflow:hidden;background:var(--surface);box-shadow:inset 0 0 0 1px var(--line),0 24px 64px rgba(0,0,0,.5)}
.pic{position:absolute;inset:0}
.pic>.bgimg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;animation:bgin .5s ease-out both}
.schar{position:absolute;bottom:0;height:86%;transform:translateX(-50%);object-fit:contain;object-position:bottom;animation:charin .5s cubic-bezier(.2,1.4,.4,1) both}
.tbox{position:absolute;left:3%;right:3%;bottom:4%;border-radius:12px;padding:18px 22px 16px;font-size:clamp(14px,1.7vw,19px);line-height:1.55;min-height:24%;animation:rowpop .35s cubic-bezier(.2,1.4,.4,1) both}
.tbox.dialogue{background:rgba(28,29,33,.94);box-shadow:inset 0 0 0 1px var(--line),0 12px 32px rgba(0,0,0,.45)}
.tbox.narration{background:rgba(17,18,20,.72);box-shadow:inset 0 0 0 1px rgba(255,255,255,.08);color:#d5d1c8;font-style:italic;text-align:center;display:grid;place-items:center;backdrop-filter:blur(3px)}
.nametag{position:absolute;top:-15px;left:18px;background:var(--surface-2);box-shadow:inset 0 0 0 1px var(--line-3);border-radius:7px;padding:4px 12px;font-weight:600;font-style:normal;font-size:clamp(12px,1.4vw,15px)}
.tcaret{display:inline-block;width:.45em;height:1em;background:var(--amber);vertical-align:-.12em;margin-left:3px;animation:blink .6s steps(1) infinite}
.pchoices{position:absolute;left:50%;top:42%;transform:translate(-50%,-50%);display:flex;flex-direction:column;gap:8px;width:min(70%,460px)}
.pchoice{min-height:44px;text-align:left;padding:0 14px;border-radius:8px;border:1px solid var(--line-3);background:rgba(36,37,42,.95);color:var(--text);font-size:clamp(13px,1.4vw,15px);display:flex;align-items:center;gap:10px;box-shadow:0 8px 24px rgba(0,0,0,.4);animation:rowpop .4s cubic-bezier(.2,1.4,.4,1) both}
.pchoice:hover{border-color:var(--amber);background:#2b2a27}
.pnum{font-family:var(--mono);font-size:12px;color:var(--amber-soft);width:12px}
.pcont{position:absolute;right:4%;bottom:7%;z-index:2}.pcont .pbtn{background:rgba(28,29,33,.94)}
.pend{position:absolute;inset:0;display:grid;place-items:center;background:rgba(10,10,12,.55);animation:fade .4s ease-out}
.pend div{display:flex;flex-direction:column;align-items:center;gap:14px}
.pend span{font-family:var(--mono);font-size:15px;color:var(--text-2);letter-spacing:.1em}
.primary{height:36px;padding:0 16px;border-radius:8px;border:0;background:var(--amber);color:#1a1308;font-weight:600}.primary:hover{background:var(--amber-hi)}
@keyframes bgin{from{opacity:0;filter:brightness(2) saturate(.3)}to{opacity:1;filter:none}}
@keyframes charin{from{opacity:0;transform:translate(-50%,18%) scale(.92)}to{opacity:1;transform:translate(-50%,0)}}
@keyframes rowpop{0%{opacity:0;transform:translateX(-14px)}100%{opacity:1;transform:none}}
@keyframes blink{50%{opacity:0}}@keyframes fade{from{opacity:0}}
@media (max-width:600px){.phead{flex-wrap:wrap}.phead>span:first-child{flex-basis:100%}}
@media (max-width:600px) and (orientation:portrait){
  .play{justify-content:flex-start}
  .stage{width:100%;aspect-ratio:auto;overflow:visible;background:none;box-shadow:none;border-radius:0;display:flex;flex-direction:column;gap:12px}
  .pic{position:relative;aspect-ratio:16/9;border-radius:14px;overflow:hidden;background:var(--surface);box-shadow:inset 0 0 0 1px var(--line)}
  .tbox{position:static;min-height:0;font-size:16px;padding:14px 16px}.tbox.dialogue{margin-top:12px}
  .pchoices{position:static;transform:none;width:100%}.pchoice{min-height:48px;font-size:15px}
  .pcont{position:static;display:flex;justify-content:flex-end}.pend{position:static;background:none;padding:16px}
}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important}}
</style></head>
<body><main class="play" id="app"></main>
<script id="story" type="application/json">${json}</script>
<script>
(function(){
var D=JSON.parse(document.getElementById('story').textContent);
var SLOTS={1:[50],2:[30,70],3:[20,50,80],4:[14,38,62,86],5:[10,30,50,70,90],6:[8,25,42,58,75,92]};
var reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
var app=document.getElementById('app'),cur=D.start,hist=[],iv=null,skip=null;
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function scene(id){for(var i=0;i<D.scenes.length;i++)if(D.scenes[i].id===id)return D.scenes[i];}
function draw(){clearInterval(iv);var s=scene(cur),n=s.chars.length,pos=SLOTS[n]||[],w=n>3?Math.max(18,100/n*1.25):30,bg=D.bgs[s.bg];
  var chars=s.chars.map(function(c,i){return c.img?'<img class="schar" style="left:'+pos[i]+'%;max-width:'+w+'%;animation-delay:'+(i*90)+'ms" src="'+c.img+'" alt="'+esc(c.name+' ('+c.pose+')')+'">':'';}).join('');
  var box=s.text?(s.speaker?'<div class="tbox dialogue"><div class="nametag" style="color:'+esc(s.speaker.color||'var(--text)')+'">'+esc(s.speaker.name)+'</div><span data-t></span><span class="tcaret"></span></div>':'<div class="tbox narration"><span><span data-t></span><span class="tcaret"></span></span></div>'):'';
  app.innerHTML='<div class="phead"><span>'+esc(D.title)+' · '+esc(s.title)+'</span><span class="grow"></span><button class="pbtn" data-back'+(hist.length?'':' disabled')+'>Voltar</button><button class="pbtn" data-restart>Reiniciar</button></div><div class="stage"><div class="pic">'+(bg&&bg.img?'<img class="bgimg" src="'+bg.img+'" alt="'+esc(bg.name)+'">':'')+chars+'</div>'+box+'<div data-after></div></div>';
  document.title=D.title+' · '+s.title;
  function after(){var host=app.querySelector('[data-after]'),cr=app.querySelector('.tcaret');if(cr)cr.remove();var h;
    if(s.choices.length)h='<div class="pchoices">'+s.choices.map(function(c,i){return'<button class="pchoice" data-go="'+esc(c.target)+'" style="animation-delay:'+(i*80)+'ms"><span class="pnum">'+(i+1)+'</span>'+esc(c.label)+'</button>';}).join('')+'</div>';
    else if(s.next&&scene(s.next))h='<div class="pcont"><button class="pbtn" data-go="'+esc(s.next)+'">Continuar ▸</button></div>';
    else h='<div class="pend"><div><span>— fim —</span><button class="primary" data-restart>Recomeçar</button></div></div>';
    host.innerHTML=h;}
  var t=app.querySelector('[data-t]');
  if(t&&!reduced){var i=0;skip=function(){clearInterval(iv);t.textContent=s.text;skip=null;after();};iv=setInterval(function(){i+=2;t.textContent=s.text.slice(0,i);if(i>=s.text.length)skip();},22);}
  else{if(t)t.textContent=s.text;skip=null;after();}}
function go(id){if(!scene(id))return;hist.push(cur);cur=id;draw();}
app.onclick=function(e){var b=e.target.closest('button');if(!b){if(skip&&e.target.closest('.stage'))skip();return;}
  if(b.hasAttribute('data-go'))go(b.getAttribute('data-go'));else if(b.hasAttribute('data-back')){cur=hist.pop();draw();}else if(b.hasAttribute('data-restart')){hist=[];cur=D.start;draw();}};
addEventListener('keydown',function(e){if(/^[1-9]$/.test(e.key)){var b=app.querySelectorAll('.pchoice')[+e.key-1];if(b)b.click();}
  else if(e.key==='Enter'||e.key===' '){if(skip){e.preventDefault();skip();return;}var c=app.querySelector('.pcont .pbtn');if(c){e.preventDefault();c.click();}}
  else if(e.key==='Backspace'&&hist.length){cur=hist.pop();draw();}});
draw();
})();
</script></body></html>`;
}
