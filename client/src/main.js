import { DbConnection } from './module_bindings';
import qrcode from 'qrcode-generator';
import { downloadStoryHtml } from './export.js';
/* ---------- elenco de exemplo (desenhos em art.js, arquivos em public/example) ---------- */
import { EXAMPLE, MARKET, spriteKey, bgKey, norm } from './art.js';

/* ---------- state ---------- */
// Os ids do elenco de exemplo precisam ser iguais em todos os navegadores (o elenco
// fica no cliente neste spike); depois do seed, ids novos são aleatórios.
let seq = 1,
  seeding = true;
const uid = (p) =>
  seeding ? p + (seq++).toString(36) : p + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
const SLOTS = {
  1: [50],
  2: [30, 70],
  3: [20, 50, 80],
  4: [14, 38, 62, 86],
  5: [10, 30, 50, 70, 90],
  6: [8, 25, 42, 58, 75, 92],
};
const MAXCH = 6;
// Imagens são links (image_key): img/… no KV, example/… e placeholders/… estáticos (veja imgUrl).
const IMG_BASE = import.meta.env.VITE_IMAGE_BASE || '/';
const imgUrl = (k) => (!k ? '' : /^(data:|https?:)/.test(k) ? k : IMG_BASE + k);
function makeChar(def, src) {
  return {
    id: uid('c'),
    name: def.name,
    desc: def.desc,
    color: def.color || '',
    source: src || 'example',
    status: '',
    error: '',
    sheetId: '',
    sprites: def.emotions.map(([n, d], i) => {
      const imageKey = spriteKey(def.slug, i);
      return {
        id: uid('sp'),
        name: n,
        desc: d,
        imageKey,
        img: imgUrl(imageKey),
        status: '',
        error: '',
      };
    }),
  };
}
function makeBg(def, src) {
  const imageKey = bgKey(def.slug);
  return {
    id: uid('b'),
    name: def.name,
    desc: def.desc,
    source: src || 'example',
    imageKey,
    img: imgUrl(imageKey),
    status: '',
    error: '',
  };
}
// Posição no palco, em % do quadro 16:9: x é o centro do sprite, y desce a base (corta mais do corpo).
// Personagens sem posição (IA, dados antigos) caem nos slots fixos.
// k: escala do sprite (1 = altura padrão do palco); roda do mouse sobre o personagem muda.
const SPRITE_H = 0.96,
  K_MIN = 0.4,
  K_MAX = 3.5,
  POS_VIS = 12; // % do quadro que sempre fica visível do personagem (não some por baixo nem por cima)
const clampK = (k) => +Math.max(K_MIN, Math.min(K_MAX, k || 1)).toFixed(2);
// Limites de y proporcionais à altura do sprite: um corpo inteiro em escala grande pode descer
// até mostrar só o busto, e qualquer um pode subir até restar POS_VIS do quadro abaixo do topo.
const clampY = (y, k) => +Math.max(-(100 - POS_VIS), Math.min(SPRITE_H * 100 * clampK(k) - POS_VIS, y)).toFixed(1);
const clampX = (x) => +Math.max(0, Math.min(100, x)).toFixed(1);
function posOf(s, i) {
  const cc = s.chars[i];
  const k = clampK(cc.k);
  if (cc.x != null) return { x: cc.x, y: cc.y || 0, k };
  return { x: (SLOTS[s.chars.length] || [])[i] ?? 50, y: 0, k };
}
function materialize(s) {
  const ps = s.chars.map((_, i) => posOf(s, i));
  s.chars.forEach((cc, i) => {
    cc.x = ps[i].x;
    cc.y = ps[i].y;
    if (ps[i].k !== 1) cc.k = ps[i].k;
    else delete cc.k;
  });
}
// Escala do personagem arrastado: a de quando saiu do palco, ou a do onion skin em que encaixou.
const dk = (d) => (d.snap && !d.alt && d.snap.k ? d.snap.k : clampK(d.src.k));
// Alça no topo do personagem selecionado: arrastar para cima/baixo redimensiona (um passo de desfazer por gesto).
let kdrag = null;
function startScaleDrag(e, hd) {
  const st = hd.closest('[data-stage]'),
    sid = st.dataset.stage,
    s = scene(sid);
  if (!s || remoteDrag.has(sid)) return;
  const i = s.chars.findIndex((x) => x.c === hd.dataset.c);
  if (i < 0) return;
  e.preventDefault();
  e.stopPropagation();
  const fr = st.querySelector('.stage-frame').getBoundingClientRect();
  const k0 = posOf(s, i).k;
  kdrag = {
    pid: e.pointerId,
    sid,
    c: hd.dataset.c,
    y0: e.clientY,
    k0,
    k: k0,
    base: fr.height * SPRITE_H,
    img: st.querySelector(`.pchar[data-c="${hd.dataset.c}"]`),
    hd,
    bottom: -posOf(s, i).y,
  };
  document.body.classList.add('kscaling');
  window.addEventListener('pointermove', onScaleMove);
  window.addEventListener('pointerup', onScaleUp);
  window.addEventListener('pointercancel', onScaleUp);
}
function onScaleMove(e) {
  const d = kdrag;
  if (!d || e.pointerId !== d.pid) return;
  d.k = clampK(d.k0 + (d.y0 - e.clientY) / d.base);
  const h = (SPRITE_H * 100 * d.k).toFixed(1) + '%';
  if (d.img) d.img.style.height = h;
  d.hd.style.bottom = `calc(${d.bottom}% + ${h})`;
  d.hd.dataset.pct = Math.round(d.k * 100) + '%';
}
function onScaleUp(e) {
  const d = kdrag;
  if (!d || e.pointerId !== d.pid) return;
  kdrag = null;
  document.body.classList.remove('kscaling');
  window.removeEventListener('pointermove', onScaleMove);
  window.removeEventListener('pointerup', onScaleUp);
  window.removeEventListener('pointercancel', onScaleUp);
  const s = scene(d.sid);
  const i = s ? s.chars.findIndex((x) => x.c === d.c) : -1;
  if (i < 0 || d.k === d.k0) {
    renderNodes();
    return;
  }
  pushUndo();
  materialize(s);
  if (d.k !== 1) s.chars[i].k = d.k;
  else delete s.chars[i].k;
  refresh();
}
function byX(s) {
  return s.chars
    .map((cc, i) => ({ cc, x: posOf(s, i).x }))
    .sort((a, b) => a.x - b.x)
    .map((o) => o.cc);
}
// Quem fala sai da cena: passa a fala para quem está na frente, ou vira narração se o palco esvaziou.
function fixSpeaker(s) {
  if (s.kind !== 'dialogue' || s.chars.some((x) => x.c === s.speaker)) return;
  if (s.chars.length) {
    s.speaker = s.chars[s.chars.length - 1].c;
    return;
  }
  s.kind = 'narration';
  s.speaker = null;
  toast('A cena ficou sem personagens; o texto virou narração.');
}

const [lia, davi, cida] = EXAMPLE.characters.map((d) => makeChar(d));
const [bPraia, bFarol, bCafe] = EXAMPLE.backgrounds.map((d) => makeBg(d));
const S = (id, title, x, y, bg, chars, kind, speaker, text, extra) =>
  Object.assign(
    { id, title, x, y, bg, chars, kind, speaker, text, choices: [], next: null },
    extra || {},
  );
let state = {
  title: 'O Farol de Itamaracá',
  start: 's1',
  characters: [lia, davi, cida],
  backgrounds: [bPraia, bFarol, bCafe],
  scenes: [
    S(
      's1',
      'Chegada',
      0,
      40,
      bPraia.id,
      [{ c: lia.id, s: lia.sprites[0].id }],
      'narration',
      null,
      'O ônibus deixa Lia na beira da praia. Ao longe, o farol apagado parece observar a vila.',
      { next: 's2' },
    ),
    S(
      's2',
      'Reencontro',
      360,
      0,
      bPraia.id,
      [
        { c: lia.id, s: lia.sprites[1].id },
        { c: davi.id, s: davi.sprites[1].id },
      ],
      'dialogue',
      davi.id,
      'Lia! Achei que você nunca mais ia voltar pra cá.',
      {
        choices: [
          { id: 'ch1', label: 'Ir ao café da Dona Cida', target: 's3' },
          { id: 'ch2', label: 'Perguntar sobre o farol', target: 's4' },
        ],
      },
    ),
    S(
      's3',
      'No café',
      720,
      -90,
      bCafe.id,
      [
        { c: lia.id, s: lia.sprites[0].id },
        { c: cida.id, s: cida.sprites[1].id },
        { c: davi.id, s: davi.sprites[0].id },
      ],
      'dialogue',
      cida.id,
      'Senta, menina. O café ainda é o mesmo, mas a vila mudou muito desde que você foi embora.',
      {
        choices: [
          { id: 'ch3', label: 'Contar por que voltou', target: 's5' },
          { id: 'ch4', label: 'Pedir um bolo de rolo', target: null },
        ],
      },
    ),
    S(
      's4',
      'O farol',
      720,
      290,
      bFarol.id,
      [
        { c: lia.id, s: lia.sprites[2].id },
        { c: davi.id, s: davi.sprites[2].id },
      ],
      'dialogue',
      lia.id,
      'Ele está apagado desde quando? Ninguém nunca me contou isso.',
      { next: 's5' },
    ),
    S(
      's5',
      'A luz',
      1080,
      110,
      bFarol.id,
      [],
      'narration',
      null,
      'A luz do farol pisca uma única vez, mesmo sem ninguém lá dentro.',
    ),
  ],
};
const market = {
  characters: MARKET.characters.map((d) => ({ author: d.author, ...makeChar(d, 'marketplace') })),
  backgrounds: MARKET.backgrounds.map((d) => ({ author: d.author, ...makeBg(d, 'marketplace') })),
};
seeding = false;
// A história de exemplo vai para o servidor só no "reiniciar demo"; o grafo local
// começa vazio e é preenchido pela assinatura.
const SEED = {
  title: state.title,
  start: state.start,
  scenes: state.scenes,
  characters: state.characters,
  backgrounds: state.backgrounds,
};
state.scenes = [];
state.title = '';
state.start = '';
state.characters = [];
state.backgrounds = [];

/* ---------- helpers ---------- */
const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const scene = (id) => state.scenes.find((s) => s.id === id);
// Rascunho da proposta do chat aberta no canvas (veja renderDraft): {p, card, plan, t0, view}.
let draft = null;
const draftsEl = $('#drafts');
const charById = (id) => state.characters.find((c) => c.id === id);
const bgById = (id) => state.backgrounds.find((b) => b.id === id);
const spriteOf = (c, sid) => c && c.sprites.find((s) => s.id === sid);
const SPARK =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9z"/></svg>';
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
function toast(msg, kind) {
  const t = document.createElement('div');
  t.className = 'toast' + (kind ? ' ' + kind : '');
  t.innerHTML =
    (kind === 'ai'
      ? SPARK.replace('<svg', '<svg style="width:13px;height:13px;flex:none;margin-top:2px"')
      : '') +
    '<span>' +
    esc(msg) +
    '</span>';
  $('#toasts').appendChild(t);
  setTimeout(
    () => {
      t.style.transition = 'opacity .25s,transform .25s';
      t.style.opacity = '0';
      t.style.transform = 'translateY(6px)';
      setTimeout(() => t.remove(), 260);
    },
    kind === 'err' ? 4200 : 2600,
  );
}
const outs = (s) =>
  s.choices.length ? s.choices.map((c) => c.target).filter(Boolean) : s.next ? [s.next] : [];
function reaches(from, to) {
  const seen = new Set(),
    st = [from];
  while (st.length) {
    const x = st.pop();
    if (x === to) return true;
    if (seen.has(x)) continue;
    seen.add(x);
    const s = scene(x);
    if (s) st.push(...outs(s));
  }
  return false;
}
// Troca o background de uma cena e leva a troca adiante: as cenas seguintes que ainda usavam o
// background antigo (herdado quando foram criadas a partir desta) passam a usar o novo.
function applyBg(s, bid) {
  const old = s.bg || null;
  if (old === bid) return 0;
  const seen = new Set([s.id]),
    st = [s],
    now = performance.now();
  let n = 0;
  while (st.length) {
    const x = st.pop();
    x.bg = bid;
    n++;
    if (bid) {
      reveal.set(x.id, now);
      setTimeout(() => reveal.delete(x.id), 1700);
    }
    for (const id of outs(x)) {
      const c = scene(id);
      if (!c || seen.has(id) || (c.bg || null) !== old) continue;
      seen.add(id);
      st.push(c);
    }
  }
  return n;
}
const isFinal = (s) => !s.choices.length && !s.next;
const edgeKey = (sid, ch) => sid + '|' + (ch || '');
const targetOf = (s, ch) => (ch ? s.choices.find((c) => c.id === ch)?.target : s.next);
function setTarget(s, ch, t) {
  if (ch) s.choices.find((c) => c.id === ch).target = t;
  else s.next = t;
}
function edges() {
  const out = [];
  state.scenes.forEach((s) => {
    if (s.choices.length)
      s.choices.forEach((c) => {
        if (c.target && scene(c.target))
          out.push({ key: edgeKey(s.id, c.id), from: s.id, ch: c.id, to: c.target });
      });
    else if (s.next && scene(s.next))
      out.push({ key: edgeKey(s.id, ''), from: s.id, ch: '', to: s.next });
  });
  return out;
}

/* ---------- undo ---------- */
// Desfazer por usuário: cada passo guarda a foto de antes e as entidades que
// ESTE usuário mudou depois dela (preenchidas pelo syncNow). Desfazer restaura só
// essas entidades, contra o estado atual, e manda as operações ao servidor.
const undoS = [],
  redoS = [];
const snapStr = () => JSON.stringify(state);
let collector = new Set(); // entidades tocadas desde o último pushUndo
let typingTouched = null; // durante digitação, o passo só nasce no change
function pushUndo(str, touched) {
  const e = { flat: flatOf(JSON.parse(str ?? snapStr())), touched: touched || new Set() };
  undoS.push(e);
  collector = e.touched;
  if (undoS.length > 200) undoS.shift();
  redoS.length = 0;
  syncUndo();
}
function restoreStep(e) {
  const cur = flatOf(state);
  const inv = { flat: cloneFlat(cur), touched: e.touched };
  for (const k of e.touched) {
    const [t, id] = k.split(/:(.*)/);
    if (t === 's') {
      const v = e.flat.scenes.get(id);
      v ? cur.scenes.set(id, { ...v }) : cur.scenes.delete(id);
    } else if (t === 'c') {
      const v = e.flat.choices.get(id);
      v ? cur.choices.set(id, { ...v }) : cur.choices.delete(id);
    } else if (t === 'k') {
      const v = e.flat.chars.get(id);
      v ? cur.chars.set(id, { ...v }) : cur.chars.delete(id);
    } else if (t === 'p') {
      const v = e.flat.sprites.get(id);
      v ? cur.sprites.set(id, { ...v }) : cur.sprites.delete(id);
    } else if (t === 'g') {
      const v = e.flat.bgs.get(id);
      v ? cur.bgs.set(id, { ...v }) : cur.bgs.delete(id);
    } else if (k === 'title') cur.title = e.flat.title;
    else if (k === 'start') cur.start = e.flat.start;
  }
  writeFlat(cur);
  collector = new Set();
  return inv;
}
function undo() {
  if (!undoS.length) return;
  redoS.push(restoreStep(undoS.pop()));
  afterRestore();
}
function redo() {
  if (!redoS.length) return;
  undoS.push(restoreStep(redoS.pop()));
  afterRestore();
}
function afterRestore() {
  for (const id of gens.keys()) {
    const s = scene(id);
    if (s) s.aiStatus = '';
  }
  gens.clear();
  lit.clear();
  fades.clear();
  tweens.clear();
  selected.clear();
  renderAll();
}
function syncUndo() {
  $('#btnUndo').disabled = !undoS.length;
  $('#btnRedo').disabled = !redoS.length;
}

/* ---------- validation ---------- */
function warnings() {
  const w = [];
  const reach = new Set();
  if (scene(state.start)) {
    const st = [state.start];
    while (st.length) {
      const x = st.pop();
      if (reach.has(x)) continue;
      reach.add(x);
      const s = scene(x);
      if (s) st.push(...outs(s));
    }
  }
  let finalReach = false;
  state.scenes.forEach((s) => {
    if (!reach.has(s.id))
      w.push({ id: s.id, t: `“${s.title}” não é alcançável a partir da cena inicial` });
    s.choices.forEach((c) => {
      if (!c.target)
        w.push({ id: s.id, t: `Ação “${c.label || 'sem texto'}” em “${s.title}” não tem destino` });
    });
    if (!s.text.trim() && !gens.has(s.id)) w.push({ id: s.id, t: `“${s.title}” está sem texto` });
    if (reach.has(s.id) && isFinal(s)) finalReach = true;
  });
  if (!finalReach) w.push({ id: null, t: 'Nenhum final alcançável' });
  return { list: w, reach };
}

/* ---------- viewport ---------- */
const view = { x: 40, y: 90, z: 1 };
const canvas = $('#canvas'),
  world = $('#world'),
  nodesEl = $('#nodes'),
  wiresEl = $('#wires'),
  dragEl = $('#dragwires'),
  fxEl = $('#fx'),
  cutsEl = $('#cuts');
function applyView() {
  world.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.z})`;
  const g = $('#grid');
  g.style.backgroundSize = `${24 * view.z}px ${24 * view.z}px`;
  g.style.backgroundPosition = `${view.x}px ${view.y}px`;
  $('#btnZoomReset').textContent = Math.round(view.z * 100) + '%';
  dirty = true;
}
function toWorld(cx, cy) {
  const r = canvas.getBoundingClientRect();
  return { x: (cx - r.left - view.x) / view.z, y: (cy - r.top - view.y) / view.z };
}
function zoomAt(z2, cx, cy) {
  const r = canvas.getBoundingClientRect();
  const px = cx - r.left,
    py = cy - r.top;
  const z = Math.max(0.3, Math.min(2, z2));
  const wx = (px - view.x) / view.z,
    wy = (py - view.y) / view.z;
  view.z = z;
  view.x = px - wx * z;
  view.y = py - wy * z;
  applyView();
}
function nodeH(id) {
  const el = nodeEl(id);
  return el ? el.offsetHeight : 460;
}
const nodeEl = (id) => nodesEl.querySelector(`.node[data-id="${id}"]`);
// Enquadra a história inteira; animate desliza até lá (botão Centralizar) em vez de pular.
function fitView(animate) {
  if (!state.scenes.length) return;
  const r = canvas.getBoundingClientRect();
  let x0 = 1e9,
    y0 = 1e9,
    x1 = -1e9,
    y1 = -1e9;
  state.scenes.forEach((s) => {
    x0 = Math.min(x0, s.x);
    y0 = Math.min(y0, s.y);
    x1 = Math.max(x1, s.x + 300);
    y1 = Math.max(y1, s.y + nodeH(s.id));
  });
  const top = 70,
    pad = 40;
  const z = Math.min(
    1,
    Math.max(
      0.5,
      Math.min((r.width - pad * 2) / (x1 - x0), (r.height - top - pad - 60) / (y1 - y0)),
    ),
  );
  const x =
      (x1 - x0) * z <= r.width - pad * 2 ? (r.width - (x1 - x0) * z) / 2 - x0 * z : pad - x0 * z,
    y =
      (y1 - y0) * z <= r.height - top - pad - 60
        ? top + (r.height - top - 60 - (y1 - y0) * z) / 2 - y0 * z
        : top - y0 * z;
  if (animate === true && !reduced) {
    flyTo(x, y, z);
    return;
  }
  view.x = x;
  view.y = y;
  view.z = z;
  applyView();
}

/* ---------- live fx state ---------- */
let dirty = true;
const lit = new Set(); // AI wires while generating (hue cycling)
const fades = new Map(); // key -> t0 : violet -> amber
const tweens = new Map(); // key -> {fx,fy,t0,ai,noland,to}
let ghosts = []; // retracting wires
const gens = new Map(); // sceneId -> {full,i,comp,key,labelFor}
const fresh = new Map(); // id -> {t0,cls}
const freshRows = new Map(); // rowId -> t0
const reveal = new Map(); // sceneId -> t0
const selected = new Set();
let expanded = null,
  animUntil = 0;
const castSel = new Map(); // sceneId -> personagem escolhido na barra de sprites
let cdrag = null,
  landing = null;
const remoteChars = new Map(); // conexão -> personagem que outra pessoa arrasta    // personagem sendo arrastado / pousando no palco (o original fica oculto)
const remoteDrag = new Map(); // sceneId -> {x,y,tx,ty,color,name,conn,seen,done}: nós que outra pessoa arrasta
const pushOff = new Map();
const dispY = (s) => {
  const r = remoteDrag.get(s.id);
  return r ? r.y : s.y + (pushOff.get(s.id) || 0);
};
const dispX = (s) => {
  const r = remoteDrag.get(s.id);
  return r ? r.x : s.x;
};
function applyPush(prevTops) {
  const E = expanded && scene(expanded);
  const el = E && nodeEl(E.id);
  pushOff.clear();
  if (E && el) {
    const hE = el.offsetHeight;
    const aff = state.scenes.filter(
      (n) => n.id !== E.id && n.x < E.x + 300 && n.x + 300 > E.x && n.y > E.y,
    );
    if (aff.length) {
      const minY = Math.min(...aff.map((n) => n.y));
      const d = Math.max(0, E.y + hE + 24 - minY);
      if (d > 0) aff.forEach((n) => pushOff.set(n.id, d));
    }
  }
  state.scenes.forEach((s) => {
    const n = nodeEl(s.id);
    if (
      !n ||
      (drag && drag.type === 'move' && drag.moved && drag.orig.some((o) => o.s.id === s.id))
    )
      return;
    const t = dispY(s);
    const cur = prevTops ? prevTops.get(s.id) : parseFloat(getComputedStyle(n).top);
    n.getAnimations().forEach((a) => {
      if (a.__push) a.cancel();
    });
    n.style.top = t + 'px';
    if (!reduced && cur != null && !isNaN(cur) && Math.abs(cur - t) > 0.5) {
      const a = n.animate([{ top: cur + 'px' }, { top: t + 'px' }], {
        duration: 360,
        easing: 'cubic-bezier(.2,1,.3,1)',
      });
      a.__push = true;
      animUntil = Math.max(animUntil, performance.now() + 400);
    }
  });
  dirty = true;
}
function setExpanded(id) {
  if (expanded === id) return;
  expanded = id;
  refresh();
}
let drag = null,
  hover = null,
  shiftOn = false,
  altOn = false,
  spaceDown = false,
  openMenu = null;
// toque: um dedo arrasta a tela, dois dedos dão zoom, segurar parado faz o papel do Shift (IA)
const touchUI = matchMedia('(pointer:coarse)').matches,
  HOLD_MS = 450;
const touches = new Map();
let pinch = null,
  holdTimer = 0,
  heldAdd = false,
  selectMode = false;
function startPinch() {
  const [a, b] = [...touches.values()];
  pinch = {
    d: Math.hypot(a.x - b.x, a.y - b.y) || 1,
    mx: (a.x + b.x) / 2,
    my: (a.y + b.y) / 2,
    v: { ...view },
  };
  drag = { type: 'pinch' };
  canvas.classList.add('panning');
}
function doPinch() {
  const [a, b] = [...touches.values()];
  const d = Math.hypot(a.x - b.x, a.y - b.y) || 1,
    mx = (a.x + b.x) / 2,
    my = (a.y + b.y) / 2,
    r = canvas.getBoundingClientRect(),
    v = pinch.v;
  const z = Math.max(0.3, Math.min(2, (v.z * d) / pinch.d)),
    wx = (pinch.mx - r.left - v.x) / v.z,
    wy = (pinch.my - r.top - v.y) / v.z;
  view.z = z;
  view.x = mx - r.left - wx * z;
  view.y = my - r.top - wy * z;
  applyView();
}
function flyTo(x, y, z) {
  const v0 = { ...view },
    t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / 260),
      q = 1 - Math.pow(1 - k, 3);
    view.x = v0.x + (x - v0.x) * q;
    view.y = v0.y + (y - v0.y) * q;
    view.z = v0.z + (z - v0.z) * q;
    applyView();
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function focusScene(id) {
  const s = scene(id);
  if (s) focusAt(s.x, dispY(s));
}
function focusAt(x, y) {
  const r = canvas.getBoundingClientRect();
  const z = Math.max(view.z, Math.min(1, (r.width - 24) / 300));
  const top = $('.hud').getBoundingClientRect().bottom - r.top + 16;
  flyTo((r.width - 300 * z) / 2 - x * z, top - y * z, z);
}
const geom = new Map(); // key -> {a,b}
function ago(t0) {
  return Math.round(performance.now() - t0);
}

/* ---------- node rendering ---------- */
const REMOTE_GEN = { full: '', i: 0 };
const genOf = (s) => gens.get(s.id) || (s.aiStatus === 'generating' ? REMOTE_GEN : null);
function hiddenChar(sid, c) {
  for (const g of remoteChars.values()) if (!g.done && g.p.sid === sid && g.p.c === c) return true;
  return !!(
    (cdrag && cdrag.moved && cdrag.src.sid === sid && cdrag.src.c === c) ||
    (landing && landing.sid === sid && landing.c === c)
  );
}
function castSelOf(s) {
  const v = castSel.get(s.id);
  if (v && s.chars.some((x) => x.c === v)) return v;
  if (s.kind === 'dialogue' && s.speaker) return s.speaker;
  return s.chars.length ? s.chars[s.chars.length - 1].c : null;
}
function stageMini(s) {
  const bg = bgById(s.bg);
  const g = genOf(s);
  if (g)
    return `<div class="stage-mini"><div class="gen-veil"><span class="skel" style="width:72%"></span><span class="skel" style="width:54%"></span><span class="skel" style="width:63%"></span></div></div>`;
  const rv = reveal.has(s.id) ? ago(reveal.get(s.id)) : null;
  const rvOn = rv !== null && rv < 1600;
  let h =
    bg && bg.img
      ? `<img class="bgimg" src="${bg.img}" alt="" ${rvOn ? `style="animation-delay:-${rv}ms"` : ''}>`
      : `<div class="nobg">sem background</div>`;
  const dlg = s.kind === 'dialogue' && s.speaker,
    sel = expanded === s.id ? castSelOf(s) : null;
  let ch = '';
  s.chars.forEach((cc, i) => {
    const c = charById(cc.c),
      sp = spriteOf(c, cc.s);
    if (!sp || !sp.img) return;
    const p = posOf(s, i);
    const cls = ['pchar'];
    if (hiddenChar(s.id, cc.c)) cls.push('hold');
    if (dlg && cc.c !== s.speaker) cls.push('dim');
    if (sel === cc.c) cls.push('sel');
    ch += `<img class="${cls.join(' ')}" data-c="${cc.c}" draggable="false" style="left:${p.x}%;bottom:${-p.y}%;height:${(SPRITE_H * 100 * p.k).toFixed(1)}%;${rvOn ? `animation-delay:${180 + i * 110 - rv}ms` : ''}" src="${sp.img}" alt="${esc(c.name)}" title="${esc(c.name)} · arraste para mover, clique para a alça de tamanho">`;
  });
  const si = sel ? s.chars.findIndex((x) => x.c === sel) : -1;
  if (si >= 0 && !hiddenChar(s.id, sel)) {
    const p = posOf(s, si);
    ch += `<div class="khandle" data-c="${sel}" data-pct="${Math.round(p.k * 100)}%" style="left:${p.x}%;bottom:calc(${-p.y}% + ${(SPRITE_H * 100 * p.k).toFixed(1)}%)" title="Arraste para cima ou para baixo para redimensionar" role="slider" aria-label="Tamanho" aria-valuenow="${Math.round(p.k * 100)}"></div>`;
  }
  return `<div class="stage-mini${rvOn ? ' reveal' : ''}" data-stage="${s.id}">${h}<div class="stage-frame">${ch}</div></div>`;
}
function rowFresh(id) {
  const t = freshRows.get(id);
  if (t == null) return '';
  const a = ago(t);
  if (a > 700) {
    freshRows.delete(id);
    return '';
  }
  return ` fresh" style="animation-delay:-${a}ms`;
}
function nodeHTML(s, ws, reach, lnk, incoming) {
  const g = genOf(s);
  const isStart = state.start === s.id;
  const exp = expanded === s.id && !g;
  const cls = ['node'];
  if (exp) cls.push('exp');
  if (s.ai) cls.push('ai');
  if (selected.has(s.id)) cls.push('sel');
  if (!reach.has(s.id) && !g) cls.push('unreach');
  const dv = draft && draft.view;
  if (dv) {
    if (dv.del.has(s.id)) cls.push('ddel');
    if (dv.edit.has(s.id)) cls.push('dunder');
  }
  const rd = remoteDrag.get(s.id);
  if (rd) cls.push('rdrag');
  const lkTitle = lockOf('scene:' + s.id + ':title'),
    lkText = lockOf('scene:' + s.id + ':text');
  let style = `left:${dispX(s)}px;top:${dispY(s)}px${rd ? `;--rc:${rd.color}` : ''}`;
  const f = fresh.get(s.id);
  if (g) {
    cls.push('gen');
    if (f) style += `;animation-delay:-${ago(f.t0)}ms,${700 - ago(f.t0)}ms`;
  } else if (f) {
    const a = ago(f.t0);
    if (a < 800) {
      cls.push(f.cls);
      style += `;animation-delay:-${a}ms`;
    } else fresh.delete(s.id);
  }
  const head = `<div class="nhead" data-drag><span class="port in${incoming.has(s.id) ? ' linked' : ''}" aria-hidden="true"></span><input class="ntitle${lkTitle ? ' locked' : ''}" data-act="title" value="${esc(s.title)}" aria-label="Título da cena" ${g ? 'disabled' : ''}${lkTitle ? ` readonly title="${esc(lkTitle.name)} está escrevendo…" style="--lc:${lkTitle.color}"` : ''}>${isStart ? '<span class="tag start">início</span>' : ''}${s.ai ? `<span class="tag ai">${SPARK}IA</span>` : ''}${isFinal(s) && !g ? '<span class="tag final">final</span>' : ''}${!g && s.aiStatus === 'failed' && !s.text ? '<span class="tag warn" title="A IA não conseguiu montar esta cena">IA falhou</span><button class="addbtn ai" data-act="retry" title="Pedir a cena de novo à IA" style="padding:2px 7px;font-size:11px">tentar de novo</button>' : ''}${ws.has(s.id) ? '<span class="tag warn" title="Há avisos nesta cena">!</span>' : ''}${g ? '' : `<button class="iconbtn sm ntoggle" data-act="toggle" aria-expanded="${exp}" aria-label="${exp ? 'Recolher' : 'Expandir'} cena" title="${exp ? 'Recolher' : 'Expandir para editar'}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></button>`}<button class="iconbtn sm" data-act="menu" aria-label="Mais opções da cena"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg></button></div>`;
  if (g) {
    return `<div class="${cls.join(' ')}" data-id="${s.id}" style="${style}">${head}<div class="sec">${stageMini(s)}</div><div class="sec"><div class="ntext typing" data-typing>${esc(g.full.slice(0, g.i))}<span class="caret"></span></div></div><div class="orow"><span class="skel" style="width:38%"></span><span class="skel" style="width:26%"></span></div><div class="nfoot"><span class="hintsm">montando a cena…</span></div></div>`;
  }
  const nOpts = s.choices.length;
  if (!exp) {
    const spk = s.kind === 'dialogue' ? charById(s.speaker) : null;
    const sum = s.text
      ? `${spk ? `<span class="who" style="color:${spk.color || 'var(--text)'}">${esc(spk.name)}</span>` : ''}<span class="${spk ? '' : 'narr'}">${esc(s.text)}</span>`
      : '<span class="none">sem texto · clique para editar</span>';
    const opts = s.choices
      .map((ch, i) => {
        const pc = portCls(s.id, ch.id, lnk);
        return `<div class="orow c${ch.gen ? ' optgen' : ''}${ch.target ? '' : ' draft'}${rowFresh('opt:' + ch.id)}"><span class="onum">${i + 1}</span><span class="olabel" data-act="clabel" data-i="${i}">${ch.label ? esc(ch.label) : '<i class="none">sem texto</i>'}</span>${ch.target ? '' : '<span class="tag warn">sem destino</span>'}<button class="port out ${pc}${ch.target ? '' : ' draft'}" data-out="${s.id}" data-ch="${ch.id}" aria-label="Saída da ação ${esc(ch.label)}${ch.target ? '' : ', sem destino'}"></button></div>`;
      })
      .join('');
    const single = !nOpts
      ? `<div class="orow c"><span class="nextlabel">${s.next ? 'continuar → ' + esc(scene(s.next)?.title || '') : 'continuar'}</span><button class="port out ${portCls(s.id, '', lnk)}" data-out="${s.id}" data-ch="" aria-label="Saída única de ${esc(s.title)}"></button></div>`
      : '';
    return `<div class="${cls.join(' ')}" data-id="${s.id}" style="${style}">${head}<div class="mid"><div class="sec">${stageMini(s)}${lkText ? lockBadge(lkText) : ''}<div class="sum">${sum}</div></div></div>${opts}${single}</div>`;
  }
  // elenco = quem está no palco; a barra mostra os sprites do personagem escolhido (clique nele no palco)
  const selC = castSelOf(s),
    selCC = s.chars.find((x) => x.c === selC),
    selCh = selCC && charById(selC);
  const cast = selCh
    ? `<div class="castbar${rowFresh('cast:' + s.id + ':' + selC)}"><div class="cb-head"><span class="cast-name" style="color:${selCh.color || 'inherit'}">${esc(selCh.name)}</span><span class="hintsm">${s.chars.length}/${MAXCH} · solte fora da cena para tirar</span></div><div class="cb-sprites" role="group" aria-label="Sprite de ${esc(selCh.name)}">${selCh.sprites
        .filter((p) => p.img || p.id === selCC.s)
        .map(
          (p) =>
            `<button class="cb-sp" data-act="sprite" data-c="${selC}" data-v="${p.id}" aria-pressed="${p.id === selCC.s}" title="${esc(p.name)}"><img src="${p.img}" alt="" draggable="false"><span>${esc(p.name)}</span></button>`,
        )
        .join('')}</div></div>`
    : `<div class="castempty">Arraste personagens do painel até a cena</div>`;
  const speaker =
    s.kind === 'dialogue'
      ? `<div class="speaker"><span class="lbl">quem fala</span><div class="spk" role="group" aria-label="Quem fala">${byX(
          s,
        )
          .map((cc) => {
            const c = charById(cc.c);
            if (!c) return '';
            return `<button class="spk-chip" data-act="speaker" data-v="${c.id}" aria-pressed="${c.id === s.speaker}" style="--cc:${c.color || 'var(--text)'}"><img src="${spriteOf(c, cc.s)?.img || ''}" alt="" draggable="false">${esc(c.name)}</button>`;
          })
          .join('')}</div></div>`
      : '';
  const opts = s.choices
    .map((ch, i) => {
      const pc = portCls(s.id, ch.id, lnk);
      const og = ch.gen ? ' optgen' : '';
      const lk = lockOf('choice:' + ch.id + ':label');
      return `<div class="orow${og}${ch.target ? '' : ' draft'}${rowFresh('opt:' + ch.id)}"><span class="onum">${i + 1}</span><input class="oin${lk ? ' locked' : ''}" data-act="clabel" data-i="${i}" value="${esc(ch.label)}" placeholder="Texto da ação" aria-label="Ação do jogador"${lk ? ` readonly title="${esc(lk.name)} está escrevendo…" style="--lc:${lk.color}"` : ''}><button class="iconbtn sm" data-act="rmchoice" data-i="${i}" aria-label="Remover ação"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M7 7l10 10M17 7L7 17"/></svg></button><button class="port out ${pc}${ch.target ? '' : ' draft'}" data-out="${s.id}" data-ch="${ch.id}" aria-label="Saída da ação ${esc(ch.label)}${ch.target ? '' : ', sem destino'}"></button></div>`;
    })
    .join('');
  const single = !nOpts
    ? `<div class="orow"><span class="nextlabel">${s.next ? 'continuar → ' + esc(scene(s.next)?.title || '') : 'continuar'}</span><button class="port out ${portCls(s.id, '', lnk)}" data-out="${s.id}" data-ch="" aria-label="Saída única de ${esc(s.title)}"></button></div>`
    : '';
  return `<div class="${cls.join(' ')}" data-id="${s.id}" style="${style}">${head}
  <div class="mid"><div class="sec">${stageMini(s)}<select class="msel" data-act="bg" aria-label="Background"><option value="">sem background</option>${state.backgrounds
    .filter((b) => b.img || b.id === s.bg)
    .map(
      (b) => `<option value="${b.id}"${b.id === s.bg ? ' selected' : ''}>${esc(b.name)}</option>`,
    )
    .join('')}</select></div>
  <div class="sec grow-in">${cast}</div>
  <div class="sec grow-in"><div class="seg" role="group" aria-label="Tipo de texto"><button data-act="kind" data-v="narration" aria-pressed="${s.kind === 'narration'}">Narração</button><button data-act="kind" data-v="dialogue" aria-pressed="${s.kind === 'dialogue'}">Fala</button></div>${speaker}${lkText ? lockBadge(lkText) : ''}<textarea class="ntext${s.kind === 'narration' ? ' narr' : ''}${lkText ? ' locked' : ''}" data-act="text" placeholder="${s.kind === 'narration' ? 'Descreva o ambiente…' : 'O que o personagem diz…'}" aria-label="Texto da cena"${lkText ? ` readonly style="--lc:${lkText.color}"` : ''}>${esc(s.text)}</textarea></div></div>
  ${opts}${single}
  <div class="nfoot grow-in"><button class="addbtn" data-act="addchoice" data-hover="add">+ ação</button><button class="addbtn ai" data-act="complete" title="Completar o texto com IA">IA: completar</button><span class="hintsm">${nOpts ? nOpts + (nOpts > 1 ? ' ações' : ' ação') : 'saída única'}</span></div></div>`;
}
function portCls(sid, ch, lnk) {
  let c = lnk.has(edgeKey(sid, ch)) ? 'linked' : '';
  if (!drag && hover && hover.sid === sid && hover.ch === ch && shiftOn) c += ' primed';
  if (drag && drag.type === 'wire' && drag.s.id === sid && drag.ch === ch)
    c += drag.ai ? ' charging' : ' active';
  return c;
}
function renderNodes() {
  const { list, reach } = warnings();
  const ws = new Set(list.map((w) => w.id).filter(Boolean));
  const es = edges();
  const lnk = new Set(es.map((e) => e.key));
  const inc = new Set(es.map((e) => e.to));
  const focus = document.activeElement;
  let keep = null;
  if (focus && nodesEl.contains(focus)) {
    const n = focus.closest('.node');
    keep = {
      id: n?.dataset.id,
      act: focus.dataset.act,
      i: focus.dataset.i,
      s: focus.selectionStart,
      e: focus.selectionEnd,
    };
  }
  const prevTops = new Map();
  nodesEl
    .querySelectorAll('.node')
    .forEach((n) => prevTops.set(n.dataset.id, parseFloat(getComputedStyle(n).top)));
  const prevMid = new Map();
  nodesEl.querySelectorAll('.node').forEach((n) => {
    const m = n.querySelector('.mid');
    if (m) prevMid.set(n.dataset.id, { h: m.offsetHeight, exp: n.classList.contains('exp') });
  });
  renderDraft();
  nodesEl.innerHTML = state.scenes.map((s) => nodeHTML(s, ws, reach, lnk, inc)).join('');
  applyPush(prevTops);
  if (!reduced)
    prevMid.forEach((v, id) => {
      const n = nodeEl(id);
      const m = n && n.querySelector('.mid');
      if (!m) return;
      const ex = n.classList.contains('exp');
      if (ex === v.exp) return;
      const h = m.offsetHeight;
      m.animate([{ height: v.h + 'px' }, { height: h + 'px' }], {
        duration: 360,
        easing: 'cubic-bezier(.2,1,.3,1)',
      });
      n.classList.add(ex ? 'opening' : 'closing');
      setTimeout(() => n.classList.remove('opening', 'closing'), 380);
      animUntil = performance.now() + 400;
    });
  if (keep && keep.id) {
    const n = nodeEl(keep.id);
    const el =
      n &&
      n.querySelector(`[data-act="${keep.act}"]${keep.i != null ? `[data-i="${keep.i}"]` : ''}`);
    if (el) {
      el.focus({ preventScroll: true });
      try {
        if (keep.s != null) el.setSelectionRange(keep.s, keep.e);
      } catch (_) {}
    }
  }
  renderStats(list);
  renderSelbar();
  dirty = true;
}
function refresh() {
  renderNodes();
  scheduleSync();
}
function renderStats(list) {
  const nA = state.scenes.reduce((a, s) => a + s.choices.length, 0);
  $('#stats').innerHTML =
    `${state.scenes.length} cena${state.scenes.length === 1 ? '' : 's'} · ${nA} aç${nA === 1 ? 'ão' : 'ões'}${list.length ? ` · <button class="warnlink" id="warnBtn">⚠ ${list.length} aviso${list.length > 1 ? 's' : ''}</button>` : ''}`;
  const b = $('#warnBtn');
  if (b)
    b.onclick = (e) => {
      e.stopPropagation();
      const h = $('#warnHost');
      if (h.innerHTML) {
        h.innerHTML = '';
        return;
      }
      h.innerHTML = `<div class="warnpop"><h3>Avisos de qualidade</h3><div class="hint">Não bloqueiam o salvamento; a publicação pede confirmação.</div><ul>${list.map((w) => `<li>${esc(w.t)}</li>`).join('')}</ul></div>`;
    };
}
function renderSelbar() {
  const h = $('#selbarHost');
  const n = [...selected].filter((id) => scene(id)).length;
  if (!n || (touchUI && !selectMode && n < 2)) {
    h.innerHTML = '';
    delete h.dataset.n;
    return;
  }
  if (h.dataset.n == String(n) && h.innerHTML) return;
  h.dataset.n = n;
  h.innerHTML = `<div class="selbar"><span>${n} ${n === 1 ? 'selecionada' : 'selecionadas'}</span><button class="btn sm" id="selDel">Excluir</button><button class="btn sm" id="selClear">Limpar</button></div>`;
  $('#selDel').onclick = () => deleteScenes([...selected]);
  $('#selClear').onclick = () => {
    selected.clear();
    syncSel();
  };
}
function syncSel() {
  if (!selected.size) selectMode = false;
  nodesEl
    .querySelectorAll('.node')
    .forEach((n) => n.classList.toggle('sel', selected.has(n.dataset.id)));
  renderSelbar();
}
function renderAll() {
  if (document.activeElement !== $('#storyTitle')) $('#storyTitle').value = state.title;
  renderNodes();
  renderRail();
  syncUndo();
  scheduleSync();
}

/* ---------- geometry ---------- */
function centerOf(el) {
  const r = el.getBoundingClientRect();
  return toWorld(r.left + r.width / 2, r.top + r.height / 2);
}
function outPos(sid, ch) {
  const el = nodesEl.querySelector(`.port.out[data-out="${sid}"][data-ch="${ch}"]`);
  return el ? centerOf(el) : null;
}
function inPos(id) {
  const el = nodesEl.querySelector(`.node[data-id="${id}"] .port.in`);
  return el ? centerOf(el) : null;
}
const ctrl = (a, b) => Math.max(50, Math.abs(b.x - a.x) * 0.5);
const curve = (a, b) => {
  const dx = ctrl(a, b),
    f = (v) => v.toFixed(1);
  return `M ${f(a.x)} ${f(a.y)} C ${f(a.x + dx)} ${f(a.y)}, ${f(b.x - dx)} ${f(b.y)}, ${f(b.x)} ${f(b.y)}`;
};
function bez(a, b, t) {
  const dx = ctrl(a, b),
    u = 1 - t;
  return {
    x: u * u * u * a.x + 3 * u * u * t * (a.x + dx) + 3 * u * t * t * (b.x - dx) + t * t * t * b.x,
    y: u * u * u * a.y + 3 * u * u * t * a.y + 3 * u * t * t * b.y + t * t * t * b.y,
  };
}
function poly(a, b, s0, s1) {
  if (s1 - s0 < 0.004) return '';
  let d = '';
  for (let i = 0; i <= 14; i++) {
    const p = bez(a, b, s0 + ((s1 - s0) * i) / 14);
    d += (i ? ' L ' : 'M ') + p.x.toFixed(1) + ' ' + p.y.toFixed(1);
  }
  return d;
}

/* ---------- wire drawing (every frame while something moves) ---------- */
function edgeStyle(key, now) {
  const tw = tweens.get(key);
  const fd = fades.get(key);
  if (lit.has(key)) {
    const c = 'hsl(' + Math.round(255 + 45 * Math.sin(now / 320)) + ', 85%, 70%)';
    return {
      stroke: c,
      sw: 3.5,
      dash: '16 8',
      off: (-(now * 0.06) % 24).toFixed(1),
      gs: c,
      gw: 12,
      go: 0.55,
    };
  }
  const t0 = fd != null ? fd : tw && tw.ai ? tw.t0 : null;
  if (t0 != null) {
    const x = Math.min(1, (now - t0) / 800),
      k = 1 - Math.pow(1 - x, 3);
    const mix = (a, b) => Math.round(a + (b - a) * k);
    const c = `rgb(${mix(167, 242)},${mix(139, 165)},${mix(250, 65)})`;
    const gap = 8 * (1 - k);
    return {
      stroke: c,
      sw: (3.5 - k).toFixed(2),
      dash: gap < 0.3 ? 'none' : '16 ' + gap.toFixed(2),
      off: (-(now * 0.06) % 24).toFixed(1),
      gs: c,
      gw: (12 - 9.5 * k).toFixed(1),
      go: (0.55 * (1 - k)).toFixed(2),
    };
  }
  return { stroke: '#f2a541', sw: 2.5, dash: 'none', off: 0, gs: '#f2a541', gw: 2, go: 0 };
}
const cutBtns = new Map();
function drawWires(now) {
  let h = '';
  geom.clear();
  const es = edges();
  const live = new Set();
  for (const e of es) {
    const a = outPos(e.from, e.ch),
      pf = inPos(e.to);
    if (!a || !pf) continue;
    let b = pf;
    const tw = tweens.get(e.key);
    if (tw && tw.fx != null) {
      const p = Math.min(1, (now - tw.t0) / 420);
      const s = 1 + 3 * Math.pow(p - 1, 3) + 2 * Math.pow(p - 1, 2);
      b = { x: tw.fx + (pf.x - tw.fx) * s, y: tw.fy + (pf.y - tw.fy) * s };
    }
    const st = edgeStyle(e.key, now);
    const d = curve(a, b);
    h += `<path class="eglow" d="${d}" style="stroke:${st.gs};stroke-width:${st.gw}px;opacity:${st.go}"/><path class="wpath" d="${d}" style="stroke:${st.stroke};stroke-width:${st.sw}px;stroke-dasharray:${st.dash};stroke-dashoffset:${st.off};opacity:.9"/>`;
    geom.set(e.key, { a, b: pf });
    live.add(e.key);
    let btn = cutBtns.get(e.key);
    if (!btn) {
      btn = document.createElement('button');
      btn.className = 'cutbtn';
      btn.setAttribute('aria-label', 'Cortar ligação');
      btn.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12"/></svg>';
      btn.dataset.key = e.key;
      btn.addEventListener('pointerdown', (ev) => ev.stopPropagation());
      btn.onclick = (ev) => {
        ev.stopPropagation();
        cutEdge(btn.dataset.key);
      };
      cutsEl.appendChild(btn);
      cutBtns.set(e.key, btn);
    }
    const m = bez(a, b, 0.5);
    btn.style.left = m.x.toFixed(1) + 'px';
    btn.style.top = m.y.toFixed(1) + 'px';
    btn.hidden = lit.has(e.key) || (tw && tw.fx != null && now - tw.t0 < 420);
  }
  for (const [k, b] of cutBtns)
    if (!live.has(k)) {
      b.remove();
      cutBtns.delete(k);
    }
  ghosts = ghosts.filter((g) => now - g.t0 < 520);
  for (const g of ghosts) {
    const p = Math.min(1, (now - g.t0) / 480),
      k = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
    let d1 = '',
      d2 = '';
    if (g.kind === 'cut') {
      d1 = poly(g.a, g.b, 0, g.t * (1 - k));
      d2 = poly(g.a, g.b, g.t + (1 - g.t) * k, 1);
    } else if (g.kind === 'start') d1 = poly(g.a, g.b, 0, 1 - k);
    else d1 = poly(g.a, g.b, k, 1);
    const sw = (2.5 * (1 - 0.5 * k)).toFixed(2),
      o = (0.9 * (1 - 0.7 * k * k)).toFixed(2);
    if (d1)
      h += `<path class="wpath" d="${d1}" style="stroke:${g.col};stroke-width:${sw}px;opacity:${o}"/>`;
    if (d2)
      h += `<path class="wpath" d="${d2}" style="stroke:${g.col};stroke-width:${sw}px;opacity:${o}"/>`;
  }
  h += draftWires();
  wiresEl.innerHTML = h;
  // landed glow
  nodesEl.querySelectorAll('.node.landed,.node.landed-plain').forEach((n) => {
    const t = [...tweens.values()].find(
      (x) => x.to === n.dataset.id && !x.noland && now - x.t0 > 280,
    );
    if (!t) n.classList.remove('landed', 'landed-plain');
  });
  for (const t of tweens.values()) {
    if (t.noland || now - t.t0 <= 280) continue;
    const n = nodeEl(t.to);
    if (n) n.classList.add(t.ai ? 'landed' : 'landed-plain');
  }
  drawDrag(now);
}
let phase = 0;
function drawDrag(now) {
  let h = '';
  let ghostHTML = '',
    badgeHTML = '';
  if (drag && drag.type === 'wire') {
    const a = outPos(drag.s.id, drag.ch);
    if (a) {
      const tgt = drag.over ? nodeEl(drag.over) : null;
      const b = tgt ? inPos(drag.over) : { x: drag.mx, y: drag.my };
      const d = curve(a, b);
      const sh = drag.ai;
      if (sh) {
        h += `<path class="eglow" d="${d}" style="stroke:hsl(${Math.round(255 + 60 * Math.sin(now / 230))},85%,72%);stroke-width:12px;opacity:.55"/>`;
      }
      h += `<path class="wpath" d="${d}" style="stroke:${sh ? `hsl(${Math.round(255 + 60 * Math.sin(now / 230))},85%,72%)` : drag.bad ? '#ff6b6b' : '#f2a541'};stroke-width:${sh ? 3.5 : 2.5}px;stroke-dasharray:${sh ? '16 8' : '5 7'};stroke-dashoffset:${sh ? (-(now * 0.08) % 24).toFixed(1) : 0};opacity:${sh ? 1 : 0.85}"/>`;
      if (sh) {
        phase = (phase + 0.009) % 1;
        for (let k = 0; k < 20; k++) {
          const t = (k / 20 + phase) % 1,
            p = bez(a, b, t),
            wob = Math.sin(t * 24 + k) * 5,
            s = 2 + 4 * Math.sin(t * Math.PI) * (0.55 + 0.45 * Math.sin(k * 1.7));
          h += `<circle class="spark" cx="${p.x.toFixed(1)}" cy="${(p.y + wob).toFixed(1)}" r="${(Math.max(2, s) / 2).toFixed(1)}" opacity="${(0.25 + 0.75 * Math.sin(t * Math.PI)).toFixed(2)}"/>`;
        }
      }
      if (!tgt && drag.moved)
        ghostHTML = `<div class="ghost${sh ? ' shift' : ''}" style="left:${Math.round(drag.mx)}px;top:${Math.round(drag.my - 20)}px"><span class="ghostlabel">${SPARK}${sh ? 'A IA vai montar esta cena' : 'Nova cena'}</span><span class="skel" style="width:100%;height:64px;border-radius:7px"></span><span class="skel" style="width:80%"></span><span class="skel" style="width:86%"></span><span class="skel" style="width:54%"></span></div>`;
      const txt = tgt
        ? drag.bad
          ? 'Fecharia um ciclo'
          : `Ligar a “${scene(drag.over).title}”`
        : sh
          ? 'Solte para gerar'
          : touchUI
            ? 'Solte para criar · para IA, segure antes de arrastar'
            : 'Solte para criar · segure Shift para IA';
      if (drag.moved)
        badgeHTML = `<div class="badge${drag.bad ? ' bad' : sh && !tgt ? ' shift' : ''}" style="left:${Math.round(drag.mx + 18)}px;top:${Math.round(drag.my - 52)}px">${sh && !tgt ? SPARK : ''}${esc(txt)}</div>`;
    }
  } else if (drag && drag.type === 'cut') {
    if (Math.hypot(drag.x2 - drag.x1, drag.y2 - drag.y1) > 4)
      h += `<path d="M ${drag.x1.toFixed(1)} ${drag.y1.toFixed(1)} L ${drag.x2.toFixed(1)} ${drag.y2.toFixed(1)}" fill="none" stroke="#ff6b6b" stroke-width="2" stroke-dasharray="6 5" stroke-linecap="round"/>`;
  } else if (drag && drag.type === 'box') {
    const x = Math.min(drag.x1, drag.x2),
      y = Math.min(drag.y1, drag.y2),
      w = Math.abs(drag.x2 - drag.x1),
      hh = Math.abs(drag.y2 - drag.y1);
    if (w + hh > 3)
      ghostHTML = `<div class="marquee" style="left:${x}px;top:${y}px;width:${w}px;height:${hh}px"></div>`;
  } else if (hover) {
    const p = hover.ch === 'add' ? null : outPos(hover.sid, hover.ch);
    const el = hover.el;
    if (el && el.isConnected) {
      const c = centerOf(el);
      const isAdd = hover.ch === 'add';
      const txt = isAdd
        ? shiftOn
          ? 'Clique: a IA escreve a ação'
          : 'Clique · segure Shift para IA'
        : shiftOn
          ? 'Clique ou arraste: a IA monta a cena'
          : 'Clique ou arraste · Shift = IA';
      badgeHTML = `<div class="badge${shiftOn ? ' shift' : ''}" style="left:${Math.round(isAdd ? c.x - 30 : c.x + 22)}px;top:${Math.round(isAdd ? c.y - 50 : c.y - 14)}px">${shiftOn ? SPARK : ''}${txt}</div>`;
    }
  }
  dragEl.innerHTML = h;
  const tmp =
    fxEl.querySelector('.dyn') ||
    Object.assign(document.createElement('div'), { className: 'dyn' });
  if (!tmp.isConnected) fxEl.appendChild(tmp);
  tmp.innerHTML = ghostHTML + badgeHTML;
  $('#wash').classList.toggle(
    'on',
    !!((drag && drag.type === 'wire' && drag.ai) || (!drag && hover && shiftOn)),
  );
}
function loop(now) {
  stepRemote(now);
  autoPan();
  const anim =
    dirty ||
    now < animUntil ||
    lit.size ||
    fades.size ||
    tweens.size ||
    ghosts.length ||
    drag ||
    hover ||
    remoteDrag.size;
  for (const [k, t] of fades) if (now - t > 900) fades.delete(k);
  for (const [k, t] of tweens) if (now - t.t0 > 1100) tweens.delete(k);
  if (anim) {
    drawWires(now);
    dirty = false;
  }
  requestAnimationFrame(loop);
}

function ensureVisible(id) {
  const el = nodeEl(id),
    sc = scene(id);
  if (!el || !sc || (drag && drag.type === 'pan')) return;
  const cr = canvas.getBoundingClientRect();
  const r = { left: cr.left, top: cr.top, right: cr.right, bottom: cr.bottom };
  const L = cr.left + view.x + sc.x * view.z,
    T = cr.top + view.y + sc.y * view.z;
  const b = { left: L, top: T, right: L + 300 * view.z, bottom: T + el.offsetHeight * view.z };
  const m = 40;
  let dx = 0,
    dy = 0;
  if (b.right > r.right - m) dx = r.right - m - b.right;
  if (b.left + dx < r.left + m) dx = r.left + m - b.left;
  if (b.top < r.top + 70) dy = r.top + 70 - b.top;
  else if (b.top > r.bottom - 200) dy = r.bottom - 200 - b.top;
  if (!dx && !dy) return;
  const x0 = view.x,
    y0 = view.y,
    t0 = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - t0) / 450),
      e = 1 - Math.pow(1 - k, 3);
    view.x = x0 + dx * e;
    view.y = y0 + dy * e;
    applyView();
    if (k < 1) requestAnimationFrame(step);
  };
  if (reduced) {
    view.x = x0 + dx;
    view.y = y0 + dy;
    applyView();
  } else requestAnimationFrame(step);
}
/* ---------- bursts / shake ---------- */
function burst(x, y, kind) {
  const b = document.createElement('div');
  b.className = 'burst ' + kind;
  b.style.left = Math.round(x) + 'px';
  b.style.top = Math.round(y) + 'px';
  let h = '<span class="ring"></span><span class="ring r2"></span>';
  const ai = kind.includes('ai'),
    mini = kind.includes('mini');
  const k = ai ? (mini ? 6 : 16) : 0;
  for (let i = 0; i < k; i++) {
    const a = mini
      ? Math.round((i * 360) / k + Math.random() * 30)
      : Math.round((i * 360) / k + Math.random() * 18);
    const d = mini ? Math.round(260 + Math.random() * 140) : Math.round(420 + Math.random() * 380);
    const w = mini ? Math.round(5 + Math.random() * 5) : Math.round(10 + Math.random() * 20);
    h += `<span class="shardwrap" style="transform:rotate(${a}deg)"><span class="shard" style="width:${w}px;animation-duration:${d}ms"></span></span>`;
  }
  b.innerHTML = h;
  fxEl.appendChild(b);
  setTimeout(() => b.remove(), 1000);
}
function shake() {
  if (reduced) return;
  const s = $('#shaker');
  s.classList.remove('shake');
  void s.offsetWidth;
  s.classList.add('shake');
  setTimeout(() => s.classList.remove('shake'), 400);
}
function nodeShake(id) {
  const el = nodeEl(id);
  if (el) {
    el.classList.remove('err');
    void el.offsetWidth;
    el.classList.add('err');
  }
}

/* ---------- create / connect / cut ---------- */
function blankScene(x, y) {
  return {
    id: uid('s'),
    title: 'Nova cena',
    x: Math.round(x),
    y: Math.round(y),
    bg: null,
    chars: [],
    kind: 'narration',
    speaker: null,
    text: '',
    choices: [],
    next: null,
  };
}
// extra: cenas que ainda não estão no grafo (rascunho), como {x,y}.
function freeSpot(sp, k = 1, extra = []) {
  let x = sp.x + 120,
    y = sp.y - 20;
  const hit = (cx, cy, nx, ny, nh) =>
    cx < nx + 330 && cx + 340 * (k - 1) + 330 > nx && cy < ny + nh + 30 && cy + 480 > ny;
  const clash = (cx, cy) =>
    state.scenes.some((n) => hit(cx, cy, n.x, dispY(n), nodeH(n.id))) ||
    extra.some((n) => hit(cx, cy, n.x, n.y, 300));
  for (let i = 0; i < 40; i++) {
    if (!clash(x, y)) break;
    y += 90;
    if (i % 8 === 7) {
      x += 340;
      y = sp.y - 20;
    }
  }
  return { x, y };
}
function createScene(src, ch, at, ai, opts = {}) {
  const sp = outPos(src.id, ch) || { x: src.x + 300, y: src.y + 200 };
  const click = !at;
  const p = at || freeSpot(sp);
  if (!opts.skipUndo) pushUndo();
  const ns = blankScene(p.x, click ? p.y : p.y - 20);
  state.scenes.push(ns);
  const prevT = targetOf(src, ch);
  setTarget(src, ch, ns.id);
  const key = edgeKey(src.id, ch);
  fresh.set(ns.id, { t0: performance.now(), cls: ai ? 'pop-ai' : 'pop' });
  if (click)
    tweens.set(key, {
      fx: sp.x,
      fy: sp.y,
      t0: performance.now(),
      ai: false,
      noland: true,
      to: ns.id,
    });
  burst(click ? ns.x : p.x, click ? ns.y + 20 : p.y, ai ? 'ai' : 'plain');
  // sem IA, a cena nova continua a anterior: mesmo background e o elenco nas mesmas posições
  if (!ai) {
    expanded = ns.id;
    ns.bg = src.bg || null;
    ns.chars = src.chars.map((cc, i) => {
      const p = posOf(src, i);
      return { c: cc.c, s: cc.s, x: p.x, y: p.y };
    });
  }
  if (ai) {
    ns.ai = true;
    ns.title = 'Gerando…';
    gens.set(ns.id, { full: '', i: 0, comp: null, key, labelCh: opts.labelCh || null });
    lit.add(key);
    shake();
  }
  refresh();
  ensureVisible(ns.id);
  if (ai) runSuggest(ns.id, src.id, ch);
  return ns;
}
// A cena já existe para todos com ai = 'generating'; o worker só devolve o conteúdo.
function runSuggest(id, srcId, chId) {
  const g = gens.get(id);
  aiJob('scene', {
    sourceSceneId: srcId,
    choiceId: chId || '',
    instruction: '',
    context: aiContext(),
  })
    .then((o) => {
      if (gens.get(id) !== g) return; // apagada ou desfeita enquanto gerava
      const chars = o.characters
        .filter((x) => spriteOf(charById(x.character_id), x.sprite_id))
        .map((x) => ({ c: x.character_id, s: x.sprite_id }));
      const speaker =
        o.text_kind === 'dialogue' && chars.some((x) => x.c === o.speaker_character_id)
          ? o.speaker_character_id
          : null;
      g.comp = {
        title: o.title,
        bg: bgById(o.background_id) ? o.background_id : null,
        chars,
        kind: speaker ? 'dialogue' : 'narration',
        speaker,
        text: o.body,
      };
      g.full = o.body;
      const src = scene(srcId),
        ch = g.labelCh && src && src.choices.find((c) => c.id === g.labelCh);
      if (ch && ch.gen) ch.gen.full = o.action_label;
    })
    .catch((err) => {
      if (gens.get(id) !== g) return;
      genFailed(id, err);
    });
} // catch: um erro ao aplicar também não pode deixar a cena presa
function genFailed(id, err) {
  const g = gens.get(id);
  gens.delete(id);
  const s = scene(id);
  if (g) {
    lit.delete(g.key);
  }
  for (const t of state.scenes) for (const c of t.choices) if (c.gen && !c.gen.full) delete c.gen; // a ação fica sem texto: o aviso pede um rótulo
  if (s) {
    s.aiStatus = 'failed';
    s.ai = false;
    s.title = 'Nova cena';
  }
  refresh();
  toast('A IA não conseguiu montar a cena: ' + aiMessage(err), 'err');
}
function retryGen(s) {
  let src = null,
    chId = '';
  for (const t of state.scenes) {
    if (t.next === s.id) {
      src = t;
      break;
    }
    const c = t.choices.find((c) => c.target === s.id);
    if (c) {
      src = t;
      chId = c.id;
      break;
    }
  }
  if (!src) {
    toast('Ligue uma saída a esta cena para a IA saber de onde continuar.', 'err');
    return;
  }
  const key = edgeKey(src.id, chId);
  const ch = chId && src.choices.find((c) => c.id === chId);
  if (ch && !ch.label) ch.gen = { full: '', i: 0 }; // a IA escreve também a ação
  s.aiStatus = '';
  s.ai = true;
  s.title = 'Gerando…';
  gens.set(s.id, { full: '', i: 0, comp: null, key, labelCh: ch && ch.gen ? chId : null });
  lit.add(key);
  refresh();
  runSuggest(s.id, src.id, chId);
}
function finishGen(id) {
  const g = gens.get(id);
  const s = scene(id);
  gens.delete(id);
  if (!s) return;
  s.aiStatus = '';
  const c = g.comp;
  Object.assign(s, {
    title: c.title,
    bg: c.bg,
    chars: c.chars,
    kind: c.kind,
    speaker: c.speaker,
    text: c.text,
  });
  lit.delete(g.key);
  fades.set(g.key, performance.now());
  reveal.set(id, performance.now());
  setTimeout(() => reveal.delete(id), 1700);
  const n = performance.now();
  s.chars.forEach((cc) => freshRows.set('cast:' + id + ':' + cc.c, n));
  s.ai = true;
  refresh();
  const pi = inPos(id);
  if (pi) burst(pi.x, pi.y, 'ai mini');
  setTimeout(() => {
    const t = scene(id);
    if (t) {
      t.ai = false;
      refresh();
    }
  }, 2600);
}
function tryConnect(src, ch, toId, at, ai) {
  if (toId === src.id || reaches(toId, src.id)) {
    toast('Essa ligação fecharia um ciclo. A história não volta a cenas anteriores.', 'err');
    nodeShake(toId);
    const ip = inPos(toId);
    if (ip) burst(ip.x, ip.y, 'red');
    return false;
  }
  pushUndo();
  setTarget(src, ch, toId);
  const key = edgeKey(src.id, ch);
  tweens.set(key, { fx: at.x, fy: at.y, t0: performance.now(), ai, to: toId });
  refresh();
  setTimeout(() => {
    const tp = inPos(toId);
    if (tp) burst(tp.x, tp.y, ai ? 'ai mini' : 'plain');
  }, 300);
  return true;
}
function cutEdge(key) {
  const gm = geom.get(key);
  const [sid, ch] = key.split('|');
  const s = scene(sid);
  if (!s) return;
  pushUndo();
  setTarget(s, ch, null);
  if (gm) {
    ghosts.push({ kind: 'cut', a: gm.a, b: gm.b, t: 0.5, col: '#f2a541', t0: performance.now() });
    const m = bez(gm.a, gm.b, 0.5);
    burst(m.x, m.y, 'plain');
  }
  refresh();
}
function segHit(x1, y1, x2, y2, x3, y3, x4, y4) {
  const d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
  if (Math.abs(d) < 1e-9) return false;
  const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d,
    u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}
function applyCut(d) {
  const dead = [];
  for (const [key, g] of geom) {
    let prev = bez(g.a, g.b, 0);
    for (let i = 1; i <= 32; i++) {
      const cur = bez(g.a, g.b, i / 32);
      if (segHit(d.x1, d.y1, d.x2, d.y2, prev.x, prev.y, cur.x, cur.y)) {
        dead.push({ key, at: cur, t: i / 32, g });
        break;
      }
      prev = cur;
    }
  }
  if (!dead.length) return;
  pushUndo();
  dead.forEach((x) => {
    const [sid, ch] = x.key.split('|');
    setTarget(scene(sid), ch, null);
    ghosts.push({ kind: 'cut', a: x.g.a, b: x.g.b, t: x.t, col: '#f2a541', t0: performance.now() });
    burst(x.at.x, x.at.y, 'plain');
  });
  refresh();
  toast(dead.length > 1 ? `${dead.length} fios cortados` : 'Fio cortado');
}
function deleteScenes(ids) {
  ids = ids.filter((id) => {
    if (id === state.start) {
      toast('A cena inicial não pode ser excluída.', 'err');
      nodeShake(id);
      return false;
    }
    return true;
  });
  if (!ids.length) return;
  for (const [key, g] of geom) {
    const [sid] = key.split('|');
    const s = scene(sid);
    const to = s && targetOf(s, key.split('|')[1]);
    if (ids.includes(to))
      ghosts.push({ kind: 'start', a: g.a, b: g.b, col: '#f2a541', t0: performance.now() });
    else if (ids.includes(sid))
      ghosts.push({ kind: 'end', a: g.a, b: g.b, col: '#f2a541', t0: performance.now() });
  }
  pushUndo();
  state.scenes = state.scenes.filter((s) => !ids.includes(s.id));
  state.scenes.forEach((s) => {
    if (ids.includes(s.next)) s.next = null;
    s.choices.forEach((c) => {
      if (ids.includes(c.target)) c.target = null;
    });
  });
  ids.forEach((i) => {
    selected.delete(i);
    gens.delete(i);
  });
  refresh();
  toast(ids.length > 1 ? `${ids.length} cenas excluídas` : 'Cena excluída');
}

/* ---------- IA (procedures e fila do worker) ---------- */
const pick = (a) => a[Math.floor(Math.random() * a.length)];
// No spike o elenco e os backgrounds ficam no cliente, então vão como contexto para a IA.
function aiContext() {
  return {
    characters: state.characters.map((c) => ({
      id: c.id,
      name: c.name,
      desc: c.desc,
      sprites: c.sprites
        .filter((s) => s.img)
        .map((s) => ({ id: s.id, name: s.name, desc: s.desc })),
    })),
    backgrounds: state.backgrounds
      .filter((b) => b.img)
      .map((b) => ({ id: b.id, name: b.name, desc: b.desc, prompt: bgPromptText(b.prompt) })),
  };
}
// Prompt guardado no background (JSON {scene, time, mood}) como uma linha para o chat.
function bgPromptText(json) {
  try {
    const v = JSON.parse(json || 'null');
    if (!v?.scene) return undefined;
    return [v.scene, v.time && `time: ${v.time}`, v.mood && `mood: ${v.mood}`].filter(Boolean).join(' | ');
  } catch {
    return undefined;
  }
}
const AI_ERRS = {
  AI_DISABLED: 'a IA está desabilitada neste servidor.',
  RATE_LIMITED: 'limite de pedidos de IA por minuto atingido. Tente de novo em instantes.',
  AI_PROVIDER_ERROR: 'o provedor de IA falhou. Tente de novo.',
  AI_KEY_INVALID: 'a chave do provedor de IA foi recusada. Avise quem mantém o servidor.',
  TIMEOUT: 'o provedor demorou demais. Tente de novo.',
  AI_INVALID_OUTPUT: 'a resposta da IA não respeitou as regras da cena.',
  WORKER_RESTARTED: 'o serviço de IA reiniciou no meio do pedido. Tente de novo.',
  NOT_FOUND: 'a cena de origem não existe mais.',
  INVALID: 'pedido inválido.',
  OFFLINE: 'sem conexão com o servidor.',
};
function aiMessage(err) {
  const m = String((err && err.message) || err);
  const c = Object.keys(AI_ERRS).find((k) => m.includes(k));
  return c ? AI_ERRS[c] : m.slice(0, 120);
}
// Procedures devolvem {ok, ...} ou {error}.
async function callProc(name, args) {
  if (!connected) throw new Error('OFFLINE');
  const r = JSON.parse(await conn.procedures[name](args));
  if (r.error) throw new Error(r.error);
  return r;
}
// Pedidos ao worker: resolve quando o ai_job termina (chega pela view my_ai_job).
const jobWaiters = new Map();
function requestAi(kind, input) {
  const id = uid('j');
  return conn.reducers
    .requestAi({ id, storyId, kind, input: JSON.stringify(input) })
    .then(() => id);
}
function waitJob(id) {
  const j = conn.db.myAiJob.id.find(id);
  if (j && (j.status === 'done' || j.status === 'failed')) return Promise.resolve(j);
  return new Promise((res) => jobWaiters.set(id, res));
}
// Pedido de texto ao worker (cena, completar, ação): devolve o resultado já lido.
const aiJob = (kind, input) =>
  requestAi(kind, input)
    .then(waitJob)
    .then((j) => {
      if (j.status !== 'done') throw new Error(j.error);
      return JSON.parse(j.result);
    });
function onJobRow(row) {
  const w = jobWaiters.get(row.id);
  if (w && (row.status === 'done' || row.status === 'failed')) {
    jobWaiters.delete(row.id);
    w(row);
  }
  if (row.kind === 'chat') chatJobChanged(row);
}

/* ---------- typing ticker (reference: 2 chars / 30ms) ---------- */
setInterval(() => {
  let changed = false;
  for (const [id, g] of gens) {
    if (!g.comp) continue;
    g.i += 1;
    const el = nodeEl(id)?.querySelector('[data-typing]');
    if (g.i >= g.full.length) {
      finishGen(id);
      changed = true;
      continue;
    }
    if (el) el.innerHTML = esc(g.full.slice(0, g.i)) + '<span class="caret"></span>';
  }
  for (const s of state.scenes)
    for (const c of s.choices) {
      if (!c.gen || !c.gen.full) continue;
      c.gen.i += 1;
      const inp = nodeEl(s.id)?.querySelector(
        `[data-act="clabel"][data-i="${s.choices.indexOf(c)}"]`,
      );
      if (c.gen.i >= c.gen.full.length) {
        c.label = c.gen.full;
        delete c.gen;
        changed = true;
      } else {
        c.label = c.gen.full.slice(0, c.gen.i);
        if (inp) {
          if (inp.tagName === 'INPUT') inp.value = c.label;
          else inp.textContent = c.label;
        }
      }
    }
  if (changed) refresh();
}, 30);

/* ---------- node events ---------- */
let pendingSnap = null;
nodesEl.addEventListener('focusin', (e) => {
  if (
    e.target.matches('[data-act=text],[data-act=title],[data-act=clabel]') &&
    !e.target.readOnly
  ) {
    pendingSnap = snapStr();
    typingTouched = new Set();
    takeFieldLock(e.target);
  }
});
nodesEl.addEventListener('focusout', (e) => {
  if (e.target.matches('[data-act=text],[data-act=title],[data-act=clabel]'))
    dropFieldLock(e.target);
});
nodesEl.addEventListener('input', (e) => {
  const n = e.target.closest('.node');
  if (!n) return;
  const s = scene(n.dataset.id);
  const a = e.target.dataset.act;
  if (a === 'text') {
    s.text = e.target.value;
    if (expanded === s.id) applyPush();
    dirty = true;
  } else if (a === 'title') s.title = e.target.value;
  else if (a === 'clabel') s.choices[+e.target.dataset.i].label = e.target.value;
  if (['text', 'title', 'clabel'].includes(a)) syncSoon();
});
nodesEl.addEventListener('change', (e) => {
  const n = e.target.closest('.node');
  if (!n) return;
  const s = scene(n.dataset.id);
  const a = e.target.dataset.act;
  const v = e.target.value;
  if (['text', 'title', 'clabel'].includes(a)) {
    endTyping();
    renderStats(warnings().list);
    return;
  }
  if (a === 'bg') {
    pushUndo();
    applyBg(s, v || null);
    refresh();
  }
});
nodesEl.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  const n = e.target.closest('.node');
  if (!b || !n) return;
  const s = scene(n.dataset.id);
  const a = b.dataset.act;
  if (a === 'sprite') {
    const cc = s.chars.find((x) => x.c === b.dataset.c);
    if (!cc || cc.s === b.dataset.v) return;
    pushUndo();
    cc.s = b.dataset.v;
    refresh();
  } else if (a === 'speaker') {
    castSel.set(s.id, b.dataset.v);
    if (s.speaker === b.dataset.v) {
      renderNodes();
      return;
    }
    pushUndo();
    s.speaker = b.dataset.v;
    refresh();
  } else if (a === 'kind') {
    const v = b.dataset.v;
    if (v === s.kind) return;
    if (v === 'dialogue' && !s.chars.length) {
      toast('Para criar uma fala, arraste antes um personagem para a cena.', 'err');
      nodeShake(s.id);
      return;
    }
    pushUndo();
    s.kind = v;
    s.speaker = v === 'dialogue' ? castSelOf(s) : null;
    refresh();
  } else if (a === 'addchoice') {
    if (heldAdd) {
      heldAdd = false;
      return;
    }
    addChoice(s, e.shiftKey);
  } else if (a === 'rmchoice') {
    const i = +b.dataset.i;
    const ch = s.choices[i];
    const g = geom.get(edgeKey(s.id, ch.id));
    if (g) ghosts.push({ kind: 'end', a: g.a, b: g.b, col: '#f2a541', t0: performance.now() });
    pushUndo();
    s.choices.splice(i, 1);
    refresh();
  } else if (a === 'menu') {
    e.stopPropagation();
    showMenu(n, s);
  } else if (a === 'toggle') {
    setExpanded(expanded === s.id ? null : s.id);
  } else if (a === 'complete') {
    completeText(s);
  } else if (a === 'retry') {
    retryGen(s);
  }
});
function addChoice(s, ai) {
  pushUndo();
  const ch = { id: uid('ch'), label: ai ? '' : 'Nova ação', target: null };
  if (!s.choices.length && s.next) {
    ch.target = s.next;
    s.next = null;
  }
  s.choices.push(ch);
  freshRows.set('opt:' + ch.id, performance.now());
  // Shift: a IA escreve só o rótulo da ação; a cena seguinte fica por conta do autor.
  if (ai) {
    ch.gen = { full: '', i: 0 };
    refresh();
    const p = outPos(s.id, ch.id);
    if (p) burst(p.x, p.y, 'ai mini');
    aiJob('option', { sceneId: s.id, choiceId: ch.id, context: aiContext() }).then(
      (r) => {
        if (ch.gen) ch.gen.full = r.label;
      },
      (err) => {
        if (!ch.gen) return;
        delete ch.gen;
        if (!ch.label) ch.label = 'Nova ação';
        refresh();
        toast('A IA não conseguiu sugerir a ação: ' + aiMessage(err), 'err');
      },
    );
  } else refresh();
}
nodesEl.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'touch') return;
  heldAdd = false;
  const b = e.target.closest('[data-act="addchoice"]');
  if (!b) return;
  const n = b.closest('.node');
  const x0 = e.clientX,
    y0 = e.clientY;
  const stop = () => {
    clearTimeout(holdTimer);
    b.classList.remove('holding');
    removeEventListener('pointerup', stop);
    removeEventListener('pointercancel', stop);
    removeEventListener('pointermove', mv);
  };
  const mv = (ev) => {
    if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 10) stop();
  };
  addEventListener('pointerup', stop);
  addEventListener('pointercancel', stop);
  addEventListener('pointermove', mv);
  b.classList.add('holding');
  clearTimeout(holdTimer);
  holdTimer = setTimeout(() => {
    stop();
    const s = scene(n.dataset.id);
    if (!s) return;
    heldAdd = true;
    navigator.vibrate?.(15);
    const c = centerOf(b);
    burst(c.x, c.y, 'ai mini');
    addChoice(s, true);
  }, HOLD_MS);
});
// com o teclado do celular aberto, mantém o campo em edição à vista
function keepFieldVisible(el) {
  if (!el || !el.isConnected || !nodesEl.contains(el) || !el.matches('input,textarea')) return;
  const r = el.getBoundingClientRect(),
    cr = canvas.getBoundingClientRect(),
    vv = window.visualViewport;
  const top = $('.hud').getBoundingClientRect().bottom + 12,
    bottom = Math.min(cr.bottom, vv ? vv.offsetTop + vv.height : innerHeight) - 16;
  if (r.top >= top && r.bottom <= bottom) return;
  const want = Math.max(top, Math.min(r.top, bottom - r.height));
  flyTo(view.x, view.y + (want - r.top), view.z);
}
if (touchUI) {
  nodesEl.addEventListener('focusin', (e) => setTimeout(() => keepFieldVisible(e.target), 350));
  window.visualViewport?.addEventListener('resize', () => keepFieldVisible(document.activeElement));
}
nodesEl.addEventListener('mouseover', (e) => {
  const p = e.target.closest('.port.out,[data-hover="add"]');
  if (!p || drag) return;
  const n = p.closest('.node');
  const h = { sid: n.dataset.id, ch: p.classList.contains('port') ? p.dataset.ch : 'add', el: p };
  if (hover && hover.el === p) return;
  hover = h;
  shiftOn = e.shiftKey;
  updatePrimed(true);
  dirty = true;
});
nodesEl.addEventListener('mouseout', (e) => {
  const p = e.target.closest('.port.out,[data-hover="add"]');
  if (!p || !hover || hover.el !== p) return;
  if (e.relatedTarget && p.contains(e.relatedTarget)) return;
  hover = null;
  updatePrimed(false);
  dirty = true;
});
function updatePrimed(burstIt) {
  nodesEl.querySelectorAll('.primed').forEach((x) => x.classList.remove('primed'));
  if (hover && shiftOn && !drag) {
    hover.el.classList.add('primed');
    hover.el.closest('.node')?.classList.add('primed');
    if (burstIt !== false) {
      const c = centerOf(hover.el);
      burst(c.x, c.y, 'ai mini');
    }
  }
}
function showMenu(n, s) {
  closeMenu();
  const m = document.createElement('div');
  m.className = 'menu';
  m.innerHTML = `<button data-m="start">Definir como cena inicial</button><button data-m="play">Jogar a partir daqui</button><button data-m="del" class="danger">Excluir cena</button>`;
  n.appendChild(m);
  openMenu = m;
  m.onclick = (e) => {
    const k = e.target.dataset.m;
    closeMenu();
    if (k === 'start') {
      pushUndo();
      state.start = s.id;
      refresh();
      toast(`“${s.title}” agora é a cena inicial`);
    } else if (k === 'play') openPlay(s.id);
    else if (k === 'del') deleteScenes([s.id]);
  };
}
function closeMenu() {
  if (openMenu) {
    openMenu.remove();
    openMenu = null;
  }
}

/* ---------- canvas pointer ---------- */
canvas.addEventListener('contextmenu', (e) => {
  if (!e.target.closest('input,textarea')) e.preventDefault();
});
canvas.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.hud,.ched,.hudpop,.zoombar,.selbar,.warnpop,.menu,.cutbtn')) return;
  closeMenu();
  $('#warnHost').innerHTML = '';
  const touch = e.pointerType === 'touch';
  if (touch) {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (
      touches.size === 2 &&
      (!drag || drag.type === 'pan' || (drag.type === 'wire' && !drag.moved))
    ) {
      e.preventDefault();
      clearTimeout(holdTimer);
      if (drag && drag.type === 'wire') {
        drag = null;
        refreshPorts();
      }
      startPinch();
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (touches.size > 1) return;
  }
  const port = e.target.closest('.port.out');
  if (port && e.button === 0) {
    e.preventDefault();
    const s = scene(port.dataset.out);
    if (gens.has(s.id)) return;
    const p = toWorld(e.clientX, e.clientY);
    drag = {
      type: 'wire',
      pid: e.pointerId,
      touch,
      s,
      ch: port.dataset.ch,
      sx: p.x,
      sy: p.y,
      mx: p.x,
      my: p.y,
      ai: e.shiftKey,
      held: false,
      moved: false,
      over: null,
      bad: false,
    };
    hover = null;
    updatePrimed(false);
    canvas.setPointerCapture(e.pointerId);
    refreshPorts();
    if (touch) {
      clearTimeout(holdTimer);
      const d = drag;
      holdTimer = setTimeout(() => {
        if (drag !== d || d.moved) return;
        d.held = d.ai = true;
        refreshPorts();
        const c = centerOf(port);
        burst(c.x, c.y, 'ai mini');
        navigator.vibrate?.(15);
        dirty = true;
      }, HOLD_MS);
    }
    return;
  }
  if (
    e.button === 2 ||
    e.button === 1 ||
    (e.button === 0 && spaceDown) ||
    (touch && !e.target.closest('.node'))
  ) {
    e.preventDefault();
    if (touch) canvas.focus({ preventScroll: true });
    drag = {
      type: 'pan',
      pid: e.pointerId,
      touch,
      moved: false,
      cx: e.clientX,
      cy: e.clientY,
      vx: view.x,
      vy: view.y,
    };
    canvas.classList.add('panning');
    canvas.setPointerCapture(e.pointerId);
    return;
  }
  if (e.button !== 0) return;
  const khd = !cdrag && e.target.closest('.stage-mini[data-stage] .khandle');
  if (khd) {
    startScaleDrag(e, khd);
    return;
  }
  const pc = !e.altKey && !cdrag && e.target.closest('.stage-mini[data-stage] .pchar');
  if (pc) {
    const sid = pc.closest('[data-stage]').dataset.stage,
      s = scene(sid),
      cc = s && s.chars.find((x) => x.c === pc.dataset.c);
    if (cc) {
      if (remoteDrag.has(sid)) {
        toast(`${remoteDrag.get(sid).name} está movendo esta cena.`, 'err');
        return;
      }
      if (document.activeElement && nodesEl.contains(document.activeElement))
        document.activeElement.blur();
      const r = pc.getBoundingClientRect();
      startCharDrag(e, { sid, c: cc.c, s: cc.s, k: clampK(cc.k) }, pc.src, {
        ax: r.left + r.width / 2,
        ay: r.bottom,
        h: r.height,
        clip: 1,
        free: r.height,
      });
      return;
    }
  }
  if (e.altKey) {
    e.preventDefault();
    const p = toWorld(e.clientX, e.clientY);
    drag = { type: 'cut', x1: p.x, y1: p.y, x2: p.x, y2: p.y };
    canvas.setPointerCapture(e.pointerId);
    return;
  }
  const nodeHit = e.target.closest('.node');
  const titleHit = e.target.closest('.ntitle');
  if (
    nodeHit &&
    !(titleHit && document.activeElement === titleHit) &&
    (titleHit || !e.target.closest('textarea,select,button,input,label,.menu,.port'))
  ) {
    e.preventDefault();
    if (document.activeElement && nodesEl.contains(document.activeElement))
      document.activeElement.blur();
    const id = nodeHit.dataset.id;
    if (remoteDrag.has(id)) {
      toast(`${remoteDrag.get(id).name} está movendo esta cena.`, 'err');
      return;
    }
    if (touch && selectMode); // no modo de seleção o toque só marca/desmarca ao soltar
    else if (e.shiftKey || e.ctrlKey || e.metaKey) {
      selected.has(id) ? selected.delete(id) : selected.add(id);
    } else if (!selected.has(id)) {
      selected.clear();
      selected.add(id);
    }
    syncSel();
    const p = toWorld(e.clientX, e.clientY);
    const el = nodeEl(id);
    nodesEl.appendChild(el);
    const group = touch && selectMode && !selected.has(id) ? [id] : [...selected];
    drag = {
      type: 'move',
      pid: e.pointerId,
      touch,
      px: p.x,
      py: p.y,
      cx: e.clientX,
      cy: e.clientY,
      title: titleHit,
      orig: group.map((i) => ({ s: scene(i), x: scene(i).x, y: scene(i).y })),
      snap: snapStr(),
      moved: false,
      held: false,
      id,
    };
    canvas.setPointerCapture(e.pointerId);
    if (touch) {
      clearTimeout(holdTimer);
      const d = drag;
      el.classList.add('holding');
      holdTimer = setTimeout(() => {
        el.classList.remove('holding');
        if (drag !== d || d.moved) return;
        d.held = true;
        navigator.vibrate?.(15);
        if (!selectMode) {
          selectMode = true;
          selected.clear();
          if (expanded) setExpanded(null);
          toast('Seleção: toque em outras cenas para marcar. Toque no fundo para sair.');
        }
        selected.add(id);
        d.orig = [...selected].map((i) => ({ s: scene(i), x: scene(i).x, y: scene(i).y }));
        syncSel();
      }, HOLD_MS);
    }
    return;
  }
  if (e.target.closest('.node')) return;
  e.preventDefault();
  canvas.focus({ preventScroll: true });
  const add = e.shiftKey || e.ctrlKey || e.metaKey;
  if (!add) {
    selected.clear();
    if (expanded) setExpanded(null);
  }
  syncSel();
  const p = toWorld(e.clientX, e.clientY);
  drag = { type: 'box', x1: p.x, y1: p.y, x2: p.x, y2: p.y, base: new Set(selected) };
  canvas.setPointerCapture(e.pointerId);
});
function onPointerMove(e) {
  if (drag && (drag.type === 'wire' || drag.type === 'move'))
    lastMove = {
      clientX: e.clientX,
      clientY: e.clientY,
      shiftKey: e.shiftKey,
      pointerId: e.pointerId,
      pointerType: e.pointerType,
    };
  if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (drag && drag.type === 'pinch') {
      if (touches.size >= 2) doPinch();
      return;
    }
  }
  if (!drag || (drag.pid != null && drag.pid !== e.pointerId)) return;
  if (drag.type === 'pan') {
    if (Math.hypot(e.clientX - drag.cx, e.clientY - drag.cy) > 6) drag.moved = true;
    view.x = drag.vx + e.clientX - drag.cx;
    view.y = drag.vy + e.clientY - drag.cy;
    applyView();
    return;
  }
  const p = toWorld(e.clientX, e.clientY);
  if (drag.type === 'cut') {
    drag.x2 = p.x;
    drag.y2 = p.y;
    dirty = true;
    return;
  }
  if (drag.type === 'box') {
    drag.x2 = p.x;
    drag.y2 = p.y;
    const x1 = Math.min(drag.x1, p.x),
      x2 = Math.max(drag.x1, p.x),
      y1 = Math.min(drag.y1, p.y),
      y2 = Math.max(drag.y1, p.y);
    selected.clear();
    drag.base.forEach((i) => selected.add(i));
    state.scenes.forEach((s) => {
      if (s.x < x2 && s.x + 300 > x1 && dispY(s) < y2 && dispY(s) + nodeH(s.id) > y1)
        selected.add(s.id);
    });
    syncSel();
    dirty = true;
    return;
  }
  if (drag.type === 'move') {
    const dx = p.x - drag.px,
      dy = p.y - drag.py;
    if (!drag.moved) {
      if (
        Math.hypot(e.clientX - drag.cx, e.clientY - drag.cy) < (e.pointerType === 'touch' ? 10 : 4)
      )
        return;
      drag.moved = true;
      canvas.classList.add('moving');
      nodesEl.querySelectorAll('.node.holding').forEach((n) => n.classList.remove('holding'));
      drag.orig.forEach((o) => nodeEl(o.s.id)?.classList.add('lifting'));
    }
    drag.orig.forEach((o) => {
      o.s.x = Math.round(o.x + dx);
      o.s.y = Math.round(o.y + dy);
      const el = nodeEl(o.s.id);
      if (el) {
        el.style.left = o.s.x + 'px';
        el.style.top = dispY(o.s) + 'px';
      }
    });
    sendDrag(drag.orig, false);
    dirty = true;
    return;
  }
  if (drag.type === 'wire') {
    drag.mx = p.x;
    drag.my = p.y;
    if (Math.hypot(p.x - drag.sx, p.y - drag.sy) > (drag.touch ? 12 / view.z : 6))
      drag.moved = true;
    const was = drag.ai;
    drag.ai = e.shiftKey || drag.held;
    if (was !== drag.ai) refreshPorts();
    const under = document.elementFromPoint(e.clientX, e.clientY)?.closest('.node');
    const over =
      under && under.dataset.id !== drag.s.id ? under.dataset.id : under ? under.dataset.id : null;
    nodesEl.querySelectorAll('.node.target').forEach((n) => {
      if (n.dataset.id !== over) n.classList.remove('target', 'bad');
      nodesEl.querySelectorAll('.port.in.hot').forEach((x) => x.classList.remove('hot'));
    });
    drag.over = over;
    drag.bad = !!over && (over === drag.s.id || reaches(over, drag.s.id));
    if (over) {
      const el = nodeEl(over);
      el.classList.add('target');
      el.classList.toggle('bad', drag.bad);
      if (!drag.bad) el.querySelector('.port.in')?.classList.add('hot');
    }
    dirty = true;
  }
}
canvas.addEventListener('pointermove', onPointerMove);
// arrastando uma ligação ou cena perto da borda, a tela anda sozinha
let lastMove = null;
function autoPan() {
  if (!drag || !lastMove || !drag.moved || !(drag.type === 'wire' || drag.type === 'move')) return;
  const r = canvas.getBoundingClientRect(),
    m = touchUI ? 56 : 32,
    sp = touchUI ? 14 : 10;
  const edge = (v, lo, hi) =>
    v < lo + m ? (lo + m - v) / m : v > hi - m ? -(v - (hi - m)) / m : 0;
  const dx = edge(lastMove.clientX, r.left, r.right),
    dy = edge(lastMove.clientY, r.top, r.bottom);
  if (!dx && !dy) return;
  view.x += dx * sp;
  view.y += dy * sp;
  applyView();
  onPointerMove(lastMove);
}
canvas.addEventListener('pointercancel', (e) => {
  lastMove = null;
  touches.delete(e.pointerId);
  clearTimeout(holdTimer);
  if (drag && ['pinch', 'pan', 'wire', 'box'].includes(drag.type)) {
    drag = null;
    pinch = null;
    refreshPorts();
    canvas.classList.remove('panning');
    dirty = true;
  }
});
canvas.addEventListener('pointerup', (e) => {
  lastMove = null;
  if (e.pointerType === 'touch') {
    touches.delete(e.pointerId);
    clearTimeout(holdTimer);
    nodesEl.querySelectorAll('.node.holding').forEach((n) => n.classList.remove('holding'));
    if (drag && drag.type === 'pinch') {
      if (touches.size === 1) {
        const [[pid, t]] = [...touches];
        drag = {
          type: 'pan',
          pid,
          touch: true,
          moved: true,
          cx: t.x,
          cy: t.y,
          vx: view.x,
          vy: view.y,
        };
      } else if (!touches.size) {
        drag = null;
        pinch = null;
        canvas.classList.remove('panning');
      }
      return;
    }
  }
  if (!drag || (drag.pid != null && drag.pid !== e.pointerId)) return;
  const d = drag;
  drag = null;
  canvas.classList.remove('panning');
  nodesEl.querySelectorAll('.node.target').forEach((n) => n.classList.remove('target', 'bad'));
  nodesEl.querySelectorAll('.port.hot').forEach((x) => x.classList.remove('hot'));
  if (d.type === 'move') {
    canvas.classList.remove('moving');
    nodesEl.querySelectorAll('.node.lifting').forEach((n) => {
      n.classList.remove('lifting');
      n.classList.add('dropped');
      setTimeout(() => n.classList.remove('dropped'), 320);
    });
    if (d.moved) {
      pushUndo(d.snap);
      applyPush();
      sendDrag(d.orig, true);
      syncNow();
    } else if (d.touch && (d.held || selectMode)) {
      if (!d.held) {
        selected.has(d.id) ? selected.delete(d.id) : selected.add(d.id);
        syncSel();
      }
    } else {
      if (!e.shiftKey && selected.size > 1) {
        selected.clear();
        selected.add(d.id);
        syncSel();
      }
      if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
        setExpanded(d.id);
        if (e.pointerType === 'touch') focusScene(d.id);
      }
      const tt = d.title ? nodeEl(d.id)?.querySelector('.ntitle') : null;
      if (tt) {
        tt.focus({ preventScroll: true });
        const L = tt.value.length;
        try {
          tt.setSelectionRange(L, L);
        } catch (_) {}
      }
    }
    dirty = true;
    return;
  }
  if (d.type === 'cut') {
    applyCut(d);
    dirty = true;
    return;
  }
  if (d.type === 'pan' && d.touch && !d.moved) {
    selected.clear();
    if (expanded) setExpanded(null);
    syncSel();
  }
  if (d.type === 'box' || d.type === 'pan') {
    dirty = true;
    return;
  }
  if (d.type === 'wire') {
    const ai = e.shiftKey || d.ai;
    const cur = targetOf(d.s, d.ch);
    refreshPorts();
    if (!d.moved) {
      if (!cur) createScene(d.s, d.ch, null, ai);
      dirty = true;
      return;
    }
    if (d.over) {
      if (d.over === cur) {
        dirty = true;
        return;
      }
      tryConnect(d.s, d.ch, d.over, { x: d.mx, y: d.my }, ai);
    } else {
      createScene(d.s, d.ch, { x: d.mx, y: d.my }, ai);
    }
    dirty = true;
  }
});
function refreshPorts() {
  nodesEl.querySelectorAll('.port.out').forEach((p) => {
    p.classList.remove('charging', 'active');
    if (drag && drag.type === 'wire' && drag.s.id === p.dataset.out && drag.ch === p.dataset.ch)
      p.classList.add(drag.ai ? 'charging' : 'active');
  });
}
canvas.addEventListener(
  'wheel',
  (e) => {
    const t = e.target;
    if (t && t.closest && t.closest('.ched')) return;
    if (t && t.tagName === 'TEXTAREA' && t.scrollHeight > t.clientHeight) return;
    e.preventDefault();
    zoomAt(view.z * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX, e.clientY);
  },
  { passive: false },
);
canvas.addEventListener('keydown', (e) => {
  const p = e.target.closest('.port.out');
  if (p && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    e.stopPropagation();
    const s = scene(p.dataset.out);
    if (!targetOf(s, p.dataset.ch)) createScene(s, p.dataset.ch, null, e.shiftKey);
  }
});
const inField = (t) => t && (t.matches('input,textarea,select') || t.isContentEditable);
addEventListener('keydown', (e) => {
  if (e.key === 'Shift' && !shiftOn) {
    shiftOn = true;
    if (hover) {
      updatePrimed(true);
    }
    if (drag && drag.type === 'wire') {
      drag.ai = true;
      refreshPorts();
    }
    dirty = true;
  }
  if (e.key === 'Alt') altOn = true;
  if (document.querySelector('.modal-wrap')) {
    if (e.key === 'Escape') closeModal();
    return;
  }
  if (play) {
    if (e.key === 'Escape') closePlay();
    else if (/^[1-9]$/.test(e.key)) {
      const b = play.el.querySelectorAll('.pchoice')[+e.key - 1];
      if (b) b.click();
    } else if (e.key === 'Enter' || e.key === ' ') {
      const c = play.el.querySelector('.pcont .pbtn');
      if (c) {
        e.preventDefault();
        c.click();
      }
    }
    return;
  }
  if (inField(e.target)) return;
  if (e.code === 'Space') {
    spaceDown = true;
    e.preventDefault();
  }
  const mod = e.ctrlKey || e.metaKey,
    k = e.key.toLowerCase();
  if (mod && k === 'z') {
    e.preventDefault();
    e.shiftKey ? redo() : undo();
  } else if (mod && k === 'y') {
    e.preventDefault();
    redo();
  } else if (mod && k === 'a') {
    e.preventDefault();
    state.scenes.forEach((s) => selected.add(s.id));
    syncSel();
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    if (selected.size) {
      e.preventDefault();
      deleteScenes([...selected]);
    }
  } else if (e.key === 'Escape') {
    if (drag) {
      drag = null;
      refreshPorts();
    }
    selected.clear();
    syncSel();
    closeMenu();
    if (expanded) setExpanded(null);
    dirty = true;
  }
});
addEventListener('keyup', (e) => {
  if (e.key === 'Shift') {
    shiftOn = false;
    updatePrimed(false);
    if (drag && drag.type === 'wire') {
      drag.ai = false;
      refreshPorts();
    }
    dirty = true;
  }
  if (e.key === 'Alt') altOn = false;
  if (e.code === 'Space') spaceDown = false;
});
addEventListener('blur', () => {
  shiftOn = false;
  altOn = false;
  spaceDown = false;
  updatePrimed(false);
  dirty = true;
});
addEventListener('resize', () => {
  dirty = true;
});
document.addEventListener('pointerdown', (e) => {
  if (!e.target.closest('.menu,[data-act="menu"]')) closeMenu();
  if (!e.target.closest('.warnpop,#warnBtn')) $('#warnHost').innerHTML = '';
});

/* ---------- HUD ---------- */
$('#storyTitle').addEventListener('focus', (e) => {
  if (e.target.readOnly) return;
  pendingSnap = snapStr();
  typingTouched = new Set();
  takeFieldLock(e.target);
});
$('#storyTitle').addEventListener('blur', (e) => dropFieldLock(e.target));
$('#storyTitle').addEventListener('input', (e) => {
  state.title = e.target.value;
  syncSoon();
});
$('#storyTitle').addEventListener('change', endTyping);
// Fim de uma digitação: grava o texto já e vira um passo de desfazer.
function endTyping() {
  clearTimeout(syncTimer);
  syncNow();
  if (pendingSnap && typingTouched && typingTouched.size) pushUndo(pendingSnap, typingTouched);
  pendingSnap = null;
  typingTouched = null;
}
$('#btnUndo').onclick = undo;
$('#btnRedo').onclick = redo;
const ctr = () => {
  const r = canvas.getBoundingClientRect();
  return [r.left + r.width / 2, r.top + r.height / 2];
};
$('#btnZoomIn').onclick = () => zoomAt(view.z * 1.25, ...ctr());
$('#btnZoomOut').onclick = () => zoomAt(view.z * 0.8, ...ctr());
$('#btnZoomReset').onclick = () => fitView(true);
$('#btnCenter').onclick = () => fitView(true);
$('#btnAddScene').onclick = () => {
  const [cx, cy] = ctr();
  const p = toWorld(cx - 150, cy - 200);
  pushUndo();
  const s = blankScene(p.x, p.y);
  state.scenes.push(s);
  expanded = s.id;
  if (!scene(state.start)) state.start = s.id;
  fresh.set(s.id, { t0: performance.now(), cls: 'pop' });
  refresh();
  burst(s.x, s.y + 20, 'plain');
};
$('#btnPlay').onclick = () => openPlay();
$('#btnExport').onclick = async (e) => {
  const b = e.currentTarget;
  if (b.disabled) return;
  if (!scene(state.start)) {
    toast('Defina uma cena inicial.', 'err');
    return;
  }
  b.disabled = true;
  toast('Gerando HTML…');
  try {
    const r = await downloadStoryHtml(state);
    toast(
      r.failed.length
        ? `Exportado (${r.count} cenas), mas ${r.failed.length} imagem(ns) não carregaram.`
        : `Exportado: ${r.count} cenas.`,
      r.failed.length ? 'err' : undefined,
    );
  } catch (err) {
    console.error(err);
    toast('Falha ao exportar: ' + err.message, 'err');
  } finally {
    b.disabled = false;
  }
};
const appEl = $('.app');
const mqNarrow = matchMedia('(max-width:900px)');
const panels = { rail: true, chat: true };
try {
  const sv = JSON.parse(localStorage.getItem('vn-panels') || 'null');
  if (sv) {
    panels.rail = sv.rail !== false;
    panels.chat = sv.chat !== false;
  }
} catch (_) {}
function syncToggles() {
  const nr = mqNarrow.matches;
  const rOpen = nr ? $('#rail').classList.contains('open') : panels.rail;
  const cOpen = nr ? $('#chat').classList.contains('open') : panels.chat;
  $('#tglRail').setAttribute('aria-expanded', rOpen);
  $('#tglChat').setAttribute('aria-expanded', cOpen);
}
function setPanel(which, open, animate = true) {
  if (mqNarrow.matches) {
    const el = $('#' + which),
      other = $('#' + (which === 'rail' ? 'chat' : 'rail'));
    el.classList.toggle('open', open);
    if (open) other.classList.remove('open');
    syncToggles();
    return;
  }
  if (panels[which] === open) return;
  panels[which] = open;
  try {
    localStorage.setItem('vn-panels', JSON.stringify(panels));
  } catch (_) {}
  const anchor = canvas.getBoundingClientRect().left + view.x;
  appEl.classList.toggle(which + '-off', !open);
  syncToggles();
  if (!animate || reduced) {
    if (which === 'rail') {
      view.x = anchor - canvas.getBoundingClientRect().left;
      applyView();
    }
    dirty = true;
    return;
  }
  const t0 = performance.now();
  const follow = (now) => {
    if (which === 'rail') {
      view.x = anchor - canvas.getBoundingClientRect().left;
      applyView();
    }
    dirty = true;
    if (now - t0 < 520) requestAnimationFrame(follow);
  };
  requestAnimationFrame(follow);
}
const togglePanel = (w) =>
  setPanel(w, mqNarrow.matches ? !$('#' + w).classList.contains('open') : !panels[w]);
$('#tglRail').onclick = () => togglePanel('rail');
$('#tglChat').onclick = () => togglePanel('chat');
$('#railClose').onclick = () => setPanel('rail', false);
$('#chatClose').onclick = () => setPanel('chat', false);
mqNarrow.addEventListener('change', () => {
  $('#rail').classList.remove('open');
  $('#chat').classList.remove('open');
  syncToggles();
  dirty = true;
});
appEl.classList.add('no-anim');
appEl.classList.toggle('rail-off', !panels.rail);
appEl.classList.toggle('chat-off', !panels.chat);
syncToggles();
requestAnimationFrame(() => requestAnimationFrame(() => appEl.classList.remove('no-anim')));

/* ---------- left rail ---------- */
let railTab = 'chars';
const openCards = new Set();
const freshCards = new Map();
const freshSprites = new Map();
$('#tabChars').onclick = () => {
  railTab = 'chars';
  renderRail();
};
$('#tabBgs').onclick = () => {
  railTab = 'bgs';
  renderRail();
};
function usage(kind, id) {
  return state.scenes
    .filter((s) =>
      kind === 'bg'
        ? s.bg === id
        : kind === 'char'
          ? s.chars.some((c) => c.c === id)
          : s.chars.some((c) => c.s === id),
    )
    .map((s) => s.title);
}
const X =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M7 7l10 10M17 7L7 17"/></svg>';
const SPARK13 = () => SPARK.replace('<svg', '<svg style="width:13px;height:13px"');
function cardFresh(id, src) {
  const t = freshCards.get(id);
  if (t == null) return '';
  const a = ago(t);
  if (a > 1400) {
    freshCards.delete(id);
    return '';
  }
  return ` fresh${src === 'ai' ? ' ai' : ''}" style="animation-delay:-${Math.min(a, 500)}ms`;
}
const readySprites = (c) => c.sprites.filter((p) => p.img);
const busy = (x) => x.status === 'generating' || x.status === 'pending';
// Imagem de um sprite ou background, ou o estado da geração no lugar dela.
function artOf(x, cls, alt) {
  if (x.img) return `<img class="${cls}" src="${esc(x.img)}" alt="${esc(alt || '')}">`;
  if (busy(x))
    return `<span class="${cls} artgen" title="${x.status === 'pending' ? 'Esperando o charsheet' : 'Gerando…'}"><span class="spinner"></span></span>`;
  return `<span class="${cls} artgen failed" title="${esc(aiMessage(x.error || 'falhou'))}">!</span>`;
}
function genLine(x, what, id) {
  if (busy(x))
    return `<div class="genline"><span class="spinner"></span>${x.status === 'pending' ? 'esperando o charsheet' : 'gerando ' + what + '…'}</div>`;
  if (x.status === 'failed')
    return `<div class="genline failed"><span>${esc(what)} falhou: ${esc(aiMessage(x.error))}</span><button class="addbtn ai" data-retry="${id}">tentar de novo</button></div>`;
  return '';
}
function charSub(c) {
  if (c.status === 'generating') return 'gerando charsheet…';
  if (c.status === 'failed') return 'charsheet falhou';
  const n = readySprites(c).length,
    g = c.sprites.filter(busy).length;
  return `${n} sprite${n === 1 ? '' : 's'}${g ? ` · ${g} gerando` : ''}${c.source === 'marketplace' ? ' · marketplace' : c.source === 'ai' ? ' · gerado por IA' : ''}`;
}
function spriteRow(s) {
  const t = freshSprites.get(s.id);
  const fr = t != null && ago(t) < 1400 ? ' fresh' : '';
  return `<div class="sprite${fr}" data-sp="${s.id}">${artOf(s, '', s.name)}<div class="sprite-f"><input class="inp" data-sf="name" value="${esc(s.name)}" placeholder="Nome da emoção" aria-label="Nome do sprite"><input class="inp" data-sf="desc" value="${esc(s.desc)}" placeholder="Descrição para a IA" aria-label="Descrição do sprite">${genLine(s, 'a pose', 'sp:' + s.id)}</div><button class="iconbtn sm" data-sdel aria-label="Excluir sprite">${X}</button></div>`;
}
// Com IA: pose nova a partir do charsheet; sem charsheet (personagem enviado), gera o charsheet antes.
function poseButtons(c) {
  const up = `<label class="addbtn" style="display:inline-flex;align-items:center">+ pose (upload)<input type="file" accept="image/png,image/jpeg,image/webp" data-upsprite hidden></label>`;
  // Sem charsheet o botão continua visível: explica o que falta e leva até a caixa do charsheet.
  const ai =
    c.sheetId || c.status === 'generating'
      ? `<button class="addbtn ai" data-aipose>${SPARK13()}gerar pose com IA</button>`
      : `<button class="addbtn ai off" data-needsheet aria-describedby="needSheetTip">${SPARK13()}gerar pose com IA<span class="tip" id="needSheetTip" role="tooltip">Adicione um charsheet para gerar com IA</span></button>`;
  return `<div class="row" style="flex-wrap:wrap">${up}${ai}</div>`;
}
// Editor de personagem: painel sobre o canvas (não modal; os painéis laterais seguem livres).
let editChar = null;
const charEd = $('#charEd');
function sheetOf(c) {
  try {
    return c.sheetId && conn ? conn.db.curCharsheet.id.find(c.sheetId) : null;
  } catch (_) {
    return null;
  }
}
// Envio do charsheet: 1 imagem (vale para frente e perfil) ou 2 (frente, depois perfil).
const sheetUpload = (label) =>
  `<label class="addbtn" style="display:inline-flex;align-items:center" title="Uma imagem (frente) ou duas (frente e perfil)">${label}<input type="file" accept="image/png,image/jpeg,image/webp" multiple data-upsheet hidden></label>`;
function sheetHTML(c) {
  const sh = sheetOf(c);
  if (sh)
    return `<div class="sheet">${[
      ['frente', sh.front],
      ['perfil', sh.side],
    ]
      .map(
        ([l, k]) =>
          `<figure><img src="${esc(imgUrl(k))}" alt="${esc(c.name)}: ${l}"><figcaption>${l}</figcaption></figure>`,
      )
      .join(
        '',
      )}</div><div class="row">${sheetUpload('trocar charsheet')}<button class="addbtn" data-rmsheet>remover charsheet</button></div>`;
  if (c.status === 'generating')
    return '<div class="sheet empty-sheet"><span class="spinner"></span>gerando o charsheet…</div>';
  return `<div class="sheet empty-sheet"><span>${c.status === 'failed' ? 'O charsheet falhou. Gere de novo ou envie o seu.' : 'Sem charsheet. As poses com IA são geradas a partir dele.'}</span><div class="row" style="justify-content:center;flex-wrap:wrap"><button class="addbtn ai" data-gensheet title="Frente e perfil do personagem, gerados a partir da descrição.">${SPARK13()}gerar charsheet com IA</button>${sheetUpload('enviar charsheet')}</div></div>`;
}
function renderCharEd() {
  const c = editChar && charById(editChar);
  if (!c) {
    editChar = null;
    charEd.hidden = true;
    charEd.innerHTML = '';
    return;
  }
  const keep = charEd.querySelector('.ched-body')?.scrollTop || 0;
  charEd.hidden = false;
  charEd.innerHTML = `<div class="card" data-c="${c.id}"><div class="ched-head"><span class="swatch" style="background:${c.color || 'transparent'}"></span><h2 style="color:${c.color || 'inherit'}">${esc(c.name)}</h2><span class="card-sub">${charSub(c)}</span><button class="iconbtn" data-edclose aria-label="Fechar editor">${X}</button></div>
  <div class="ched-body"><div class="ched-col">${genLine(c, 'o charsheet', 'c:' + c.id)}<div class="field"><span class="lbl">charsheet</span>${sheetHTML(c)}</div>
    <label class="field"><span class="lbl">nome</span><input class="inp" data-cf="name" value="${esc(c.name)}"></label>
    <div class="field"><span class="lbl">cor do nome · opcional</span><div class="row"><label class="row" style="gap:6px;font-size:12.5px;color:var(--text-2)"><input type="checkbox" data-cf="hascolor"${c.color ? ' checked' : ''}> usar cor</label><input type="color" data-cf="color" value="${c.color || '#f2a541'}"${c.color ? '' : ' disabled'} aria-label="Cor" style="width:34px;height:24px;border:0;background:none;padding:0"></div></div>
    <label class="field"><span class="lbl">descrição</span><textarea class="inp" data-cf="desc" rows="6">${esc(c.desc)}</textarea></label>
    <div class="row"><button class="btn sm" data-pub>Publicar no marketplace</button><button class="btn sm danger" data-cdel>Excluir</button></div></div>
  <div class="ched-col"><div class="field"><span class="lbl">sprites · emoções</span>${poseButtons(c)}<div class="sprites">${c.sprites.map(spriteRow).join('') || '<div class="empty">Sem sprites. Envie ao menos um para usar este personagem em cenas.</div>'}</div></div></div></div></div>`;
  const b = charEd.querySelector('.ched-body');
  if (b) b.scrollTop = keep;
}
function renderRail() {
  railDirty = false;
  $('#tabChars').setAttribute('aria-selected', railTab === 'chars');
  $('#tabBgs').setAttribute('aria-selected', railTab === 'bgs');
  $('#nChars').textContent = state.characters.length;
  $('#nBgs').textContent = state.backgrounds.length;
  const acts = $('#railActions'),
    body = $('#railBody');
  if (railTab === 'chars') {
    acts.innerHTML = `<button class="addbtn" id="newChar">+ novo (upload)</button><button class="btn sm violet" id="genChar">${SPARK13()}Gerar com IA</button><button class="btn sm" id="mkChar">Marketplace</button>`;
    body.innerHTML = state.characters.length
      ? state.characters
          .map((c) => {
            const o = editChar === c.id;
            const av = readySprites(c)[0];
            return `<div class="card${o ? ' sel' : ''}${cardFresh(c.id, c.source)}" data-c="${c.id}"><div class="card-row" data-toggle>${av ? `<img class="avatar" src="${esc(av.img)}" alt="">` : c.status === 'failed' ? artOf({ status: 'failed', error: c.error }, 'avatar') : busy(c) || c.sprites.some(busy) ? artOf({ status: 'generating' }, 'avatar') : '<span class="avatar" title="Sem sprites"></span>'}<div style="min-width:0;flex:1"><div class="card-name"><span class="swatch" style="background:${c.color || 'transparent'}"></span><span style="color:${c.color || 'inherit'}">${esc(c.name)}</span></div><div class="card-sub">${charSub(c)}</div></div><span class="chev">${o ? '›' : '+'}</span></div></div>`;
          })
          .join('')
      : '<div class="empty">Nenhum personagem. Envie sprites, gere com IA ou copie do Marketplace.</div>';
    $('#newChar').onclick = () => {
      pushUndo();
      const c = {
        id: uid('c'),
        name: 'Novo personagem',
        desc: '',
        color: '',
        source: 'upload',
        status: '',
        error: '',
        sheetId: '',
        sprites: [],
      };
      state.characters.push(c);
      editChar = c.id;
      freshCards.set(c.id, performance.now());
      renderRail();
      refresh();
    };
    $('#genChar').onclick = genCharModal;
    $('#mkChar').onclick = () => marketModal('chars');
  } else {
    acts.innerHTML = `<label class="addbtn" style="display:inline-flex;align-items:center">+ upload<input type="file" accept="image/png,image/jpeg,image/webp" id="upBg" hidden></label><button class="btn sm violet" id="genBg">${SPARK13()}Gerar com IA</button><button class="btn sm" id="mkBg">Marketplace</button>`;
    body.innerHTML = state.backgrounds.length
      ? state.backgrounds
          .map((b) => {
            const o = openCards.has(b.id);
            return `<div class="card${cardFresh(b.id, b.source)}" data-b="${b.id}"><div class="card-row" data-toggle>${artOf(b, 'bg-thumb')}<div style="min-width:0;flex:1"><div class="card-name"><span>${esc(b.name)}</span></div><div class="card-sub">${busy(b) ? 'gerando…' : b.status === 'failed' ? 'falhou' : usage('bg', b.id).length + ' cena(s)'}${b.source === 'marketplace' ? ' · marketplace' : b.source === 'ai' ? ' · gerado por IA' : ''}</div></div><span class="chev">${o ? '−' : '+'}</span></div>
      ${o ? `<div class="card-edit">${b.img ? `<img src="${esc(b.img)}" alt="Ampliar ${esc(b.name)}" data-zoom title="Ampliar" style="width:100%;border-radius:8px;aspect-ratio:16/9;object-fit:cover">` : ''}${genLine(b, 'o background', 'b:' + b.id)}<label class="field"><span class="lbl">nome</span><input class="inp" data-bf="name" value="${esc(b.name)}"></label><label class="field"><span class="lbl">descrição</span><textarea class="inp" data-bf="desc">${esc(b.desc)}</textarea></label><label class="addbtn" style="align-self:flex-start;display:inline-flex;align-items:center">${b.img ? 'trocar imagem' : 'enviar imagem'}<input type="file" accept="image/png,image/jpeg,image/webp" data-upbg hidden></label><div class="row"><button class="btn sm" data-pub>Publicar no marketplace</button><button class="btn sm danger" data-bdel>Excluir</button></div></div>` : ''}</div>`;
          })
          .join('')
      : '<div class="empty">Nenhum background. Envie uma imagem, gere com IA ou copie do Marketplace.</div>';
    $('#upBg').onchange = (e) => {
      const f = e.target.files[0];
      uploadImage(f).then((key) => {
        pushUndo();
        const b = {
          id: uid('b'),
          name: (f.name || 'Background').replace(/\.[^.]+$/, ''),
          desc: '',
          source: 'upload',
          imageKey: key,
          img: imgUrl(key),
          status: '',
          error: '',
        };
        state.backgrounds.push(b);
        openCards.add(b.id);
        freshCards.set(b.id, performance.now());
        renderRail();
        refresh();
        toast('Background enviado');
      }, uploadFailed);
    };
    $('#genBg').onclick = genBgModal;
    $('#mkBg').onclick = () => marketModal('bgs');
  }
  renderCharEd();
}
// Atualização vinda do servidor com alguém digitando no painel: redesenha quando o campo perde o foco.
let railDirty = false;
function renderRailSoon() {
  const a = document.activeElement;
  if (
    a &&
    (railBody.contains(a) || charEd.contains(a)) &&
    a.matches('input:not([type=checkbox]):not([type=file]):not([type=color]),textarea')
  ) {
    railDirty = true;
    return;
  }
  renderRail();
}
// Envio de imagem: vai para o KV pelas Pages Functions e volta só a chave (image_key) que o banco guarda.
const UPLOAD_TYPES = ['image/png', 'image/jpeg', 'image/webp'],
  UPLOAD_MAX = 8 * 1024 * 1024;
const UPLOAD_ERRS = {
  FORBIDDEN: 'entre de novo para enviar imagens.',
  TOO_LARGE: 'a imagem passa de 8 MB.',
  UNSUPPORTED_TYPE: 'use PNG, JPEG ou WebP.',
  NO_STORAGE: 'o armazenamento de imagens não está configurado neste servidor.',
};
async function uploadImage(f) {
  if (!f) throw new Error('EMPTY');
  if (!UPLOAD_TYPES.includes(f.type)) throw new Error('UNSUPPORTED_TYPE');
  if (f.size > UPLOAD_MAX) throw new Error('TOO_LARGE');
  const r = await fetch('/api/upload', {
    method: 'POST',
    body: f,
    headers: { 'Content-Type': f.type },
    credentials: 'same-origin',
  }).catch(() => {
    throw new Error('OFFLINE');
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || !body.key) throw new Error(body.error || 'HTTP_' + r.status);
  return body.key;
}
const uploadFailed = (err) => {
  const m = errMsg(err);
  toast('Não foi possível enviar a imagem: ' + (UPLOAD_ERRS[m] || AI_ERRS[m] || m), 'err');
};
// Pedidos de geração do elenco: as linhas aparecem já no painel (gerando) e o resultado chega pela tabela.
const CAST_ERRS = { NO_SHEET: 'o personagem ainda não tem charsheet.', BUSY: 'já está gerando.' };
const castFailed = (what) => (err) => {
  const m = errMsg(err);
  const c = Object.keys(CAST_ERRS).find((k) => m.includes(k));
  toast(`Não foi possível ${what}: ` + (c ? CAST_ERRS[c] : aiMessage(err)), 'err');
};
function retryCast(ref) {
  const [t, id] = ref.split(/:(.*)/);
  const target = { c: 'character', sp: 'sprite', b: 'background' }[t];
  conn.reducers
    .retryGeneration({ storyId, target, id, jobId: uid('j') })
    .catch(castFailed('gerar de novo'));
}
function askPose(c) {
  askModal(
    `<label class="field"><span class="lbl">nome da emoção</span><input class="inp" name="n" maxlength="80" placeholder="ex.: Pensativa" autocomplete="off"></label><label class="field"><span class="lbl">descrição da pose</span><input class="inp" name="d" maxlength="300" placeholder="ex.: mão no queixo, olhar para o lado" autocomplete="off"></label><div class="hint">A pose é gerada a partir do charsheet de ${esc(c.name)} e aparece no painel quando ficar pronta.</div>`,
    { title: 'Pose nova com IA', ok: 'Gerar pose' },
    (w) => {
      const n = w.querySelector('[name=n]').value.trim();
      return n ? { n, d: w.querySelector('[name=d]').value.trim() } : null;
    },
  ).then((v) => {
    if (!v) return;
    conn.reducers
      .addPose({
        storyId,
        characterId: c.id,
        spriteId: uid('sp'),
        jobId: uid('j'),
        name: v.n,
        desc: v.d,
      })
      .then(() => openCards.add(c.id), castFailed('gerar a pose'));
  });
}
const railBody = $('#railBody');
// Os mesmos handlers servem o painel e o editor de personagem.
const onCast = (ev, fn) => [railBody, charEd].forEach((el) => el.addEventListener(ev, fn));
onCast('focusout', () =>
  setTimeout(() => {
    if (railDirty) renderRailSoon();
  }, 0),
);
onCast('click', (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  const cid = card.dataset.c,
    bid = card.dataset.b;
  if (e.target.closest('[data-edclose]')) {
    editChar = null;
    renderRail();
    return;
  }
  if (bid && e.target.closest('img[data-zoom],img.bg-thumb')) {
    const b = state.backgrounds.find((x) => x.id === bid);
    if (b?.img) {
      bgViewer(b);
      return;
    }
  }
  if (e.target.closest('[data-toggle]')) {
    if (cid) {
      editChar = editChar === cid ? null : cid;
      renderRail();
      return;
    }
    const k = cid || bid;
    openCards.has(k) ? openCards.delete(k) : openCards.add(k);
    renderRail();
    return;
  }
  if (cid) {
    const c = charById(cid);
    if (e.target.closest('[data-cdel]')) {
      const u = usage('char', cid);
      if (u.length) {
        toast(
          `Não dá para excluir ${c.name}: está em ${u.map((t) => '“' + t + '”').join(', ')}. Tire das cenas antes.`,
          'err',
        );
        return;
      }
      pushUndo();
      state.characters = state.characters.filter((x) => x.id !== cid);
      if (editChar === cid) editChar = null;
      renderRail();
      refresh();
      toast('Personagem excluído');
    } else if (e.target.closest('[data-sdel]')) {
      const spid = e.target.closest('[data-sp]').dataset.sp;
      const u = usage('sprite', spid);
      if (u.length) {
        toast(
          `Sprite em uso em ${u.map((t) => '“' + t + '”').join(', ')}. Troque o sprite nessas cenas antes.`,
          'err',
        );
        return;
      }
      pushUndo();
      c.sprites = c.sprites.filter((s) => s.id !== spid);
      renderRail();
      refresh();
    } else if (e.target.closest('[data-aipose]')) askPose(c);
    else if (e.target.closest('[data-rmsheet]'))
      askConfirm({
        title: 'Remover charsheet',
        text: `O charsheet de ${esc(c.name)} será apagado. As poses que já existem continuam; para gerar novas com IA, será preciso outro charsheet.`,
        ok: 'Remover',
        danger: true,
      }).then((yes) => {
        if (yes)
          conn.reducers
            .removeCharsheet({ storyId, characterId: c.id })
            .then(() => toast('Charsheet removido'), castFailed('remover o charsheet'));
      });
    else if (e.target.closest('[data-needsheet]')) {
      const g = charEd.querySelector('[data-gensheet]');
      if (g) {
        g.scrollIntoView({ block: 'center', behavior: 'smooth' });
        g.focus({ preventScroll: true });
        g.classList.remove('nudge');
        void g.offsetWidth;
        g.classList.add('nudge');
      }
    } else if (e.target.closest('[data-gensheet]'))
      conn.reducers
        .retryGeneration({ storyId, target: 'character', id: c.id, jobId: uid('j') })
        .catch(castFailed('gerar o charsheet'));
    else if (e.target.closest('[data-retry]'))
      retryCast(e.target.closest('[data-retry]').dataset.retry);
    else if (e.target.closest('[data-pub]')) publish('chars', c);
  }
  if (bid) {
    const b = bgById(bid);
    if (e.target.closest('[data-bdel]')) {
      const u = usage('bg', bid);
      if (u.length) {
        toast(
          `Não dá para excluir “${b.name}”: está em ${u.map((t) => '“' + t + '”').join(', ')}.`,
          'err',
        );
        return;
      }
      pushUndo();
      state.backgrounds = state.backgrounds.filter((x) => x.id !== bid);
      renderRail();
      refresh();
      toast('Background excluído');
    } else if (e.target.closest('[data-retry]'))
      retryCast(e.target.closest('[data-retry]').dataset.retry);
    else if (e.target.closest('[data-pub]')) publish('bgs', b);
  }
});
onCast('focusin', (e) => {
  if (e.target.matches('input:not([type=checkbox]):not([type=file]),textarea'))
    pendingSnap = snapStr();
});
onCast('input', (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  const t = e.target;
  if (card.dataset.c) {
    const c = charById(card.dataset.c);
    if (t.dataset.cf === 'name' || t.dataset.cf === 'desc') c[t.dataset.cf] = t.value;
    if (t.dataset.cf === 'color') c.color = t.value;
    const sp = t.closest('[data-sp]');
    if (sp && t.dataset.sf) c.sprites.find((s) => s.id === sp.dataset.sp)[t.dataset.sf] = t.value;
  } else if (card.dataset.b) {
    const b = bgById(card.dataset.b);
    if (t.dataset.bf) b[t.dataset.bf] = t.value;
  }
  syncSoon();
});
onCast('change', (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  const t = e.target;
  if (t.dataset.cf === 'hascolor') {
    pushUndo();
    const c = charById(card.dataset.c);
    c.color = t.checked ? card.querySelector('[data-cf=color]').value || '#f2a541' : '';
    renderRail();
    refresh();
    return;
  }
  if (t.matches('[data-upsheet]')) {
    const cid = card.dataset.c;
    const files = [...t.files].slice(0, 2);
    if (!files.length) return;
    Promise.all(files.map(uploadImage)).then(
      ([front, side]) =>
        conn.reducers
          .uploadCharsheet({
            storyId,
            characterId: cid,
            sheetId: uid('cs'),
            front,
            side: side || front,
          })
          .then(() => toast('Charsheet enviado'), castFailed('enviar o charsheet')),
      uploadFailed,
    );
    return;
  }
  if (t.matches('[data-upsprite]')) {
    const cid = card.dataset.c;
    uploadImage(t.files[0]).then((key) => {
      const c = charById(cid);
      if (!c) return;
      pushUndo();
      c.sprites.push({
        id: uid('sp'),
        name: 'Nova emoção',
        desc: '',
        imageKey: key,
        img: imgUrl(key),
        status: '',
        error: '',
      });
      renderRail();
      refresh();
      toast('Sprite enviado. Dê um nome e uma descrição a ele.');
    }, uploadFailed);
    return;
  }
  if (t.matches('[data-upbg]')) {
    const bid = card.dataset.b;
    uploadImage(t.files[0]).then((key) => {
      const b = bgById(bid);
      if (!b) return;
      pushUndo();
      b.imageKey = key;
      b.img = imgUrl(key);
      renderRail();
      refresh();
    }, uploadFailed);
    return;
  }
  if (pendingSnap && pendingSnap !== snapStr()) pushUndo(pendingSnap);
  pendingSnap = null;
  renderRail();
  refresh();
});


/* ---------- backgrounds: arrastar do painel para uma cena ---------- */
let bdrag = null;
railBody.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || cdrag || bdrag) return;
  const card = e.target.closest('.card[data-b]');
  if (!card || !e.target.closest('.card-row')) return;
  if (e.pointerType === 'touch' && !e.target.closest('.bg-thumb')) return; // no toque, o resto do cartão rola o painel
  const b = bgById(card.dataset.b);
  if (!b || !b.img) return;
  bdrag = { pid: e.pointerId, b, sx: e.clientX, sy: e.clientY, moved: false, g: null, st: null };
  addEventListener('pointermove', onBgMove);
  addEventListener('pointerup', onBgUp);
  addEventListener('pointercancel', onBgUp);
});
function bgTarget(x, y) {
  const n = document.elementFromPoint(x, y)?.closest('.node[data-id]');
  return n ? n.querySelector('.stage-mini[data-stage]') || n : null;
}
function onBgMove(e) {
  const d = bdrag;
  if (!d || e.pointerId !== d.pid) return;
  if (!d.moved) {
    if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < (e.pointerType === 'touch' ? 10 : 5)) return;
    d.moved = true;
    railSuppress = true;
    const g = document.createElement('img');
    g.className = 'bghost';
    g.src = d.b.img;
    g.alt = '';
    g.draggable = false;
    document.body.appendChild(g);
    d.g = g;
    document.body.classList.add('chardrag');
  }
  e.preventDefault();
  d.g.style.transform = `translate(${e.clientX - 64}px,${e.clientY - 36}px)`;
  const st = bgTarget(e.clientX, e.clientY);
  if (st !== d.st) {
    d.st?.classList.remove('drop-ok');
    st?.classList.add('drop-ok');
    d.st = st;
  }
}
function onBgUp(e) {
  const d = bdrag;
  if (!d || e.pointerId !== d.pid) return;
  bdrag = null;
  removeEventListener('pointermove', onBgMove);
  removeEventListener('pointerup', onBgUp);
  removeEventListener('pointercancel', onBgUp);
  if (!d.moved) return;
  document.body.classList.remove('chardrag');
  d.st?.classList.remove('drop-ok');
  d.g.remove();
  const node = e.type === 'pointerup' && bgTarget(e.clientX, e.clientY)?.closest('.node[data-id]');
  const s = node && scene(node.dataset.id);
  if (!s || s.bg === d.b.id) return;
  pushUndo();
  const n = applyBg(s, d.b.id);
  if (n > 1) toast(`Background aplicado a “${s.title}” e a ${n - 1} cena(s) seguinte(s).`);
  renderRail();
  refresh();
}
/* ---------- personagens no palco: arrastar do painel, mover, tirar ---------- */
// Enquanto arrasta, o sprite aparece inteiro; ao pousar, o recorte do palco fecha sobre ele (e abre ao pegar de volta).
// O fantasma é ancorado na base (centro embaixo), como o sprite no palco, para o pouso não dar salto.
let railSuppress = false;
railBody.addEventListener('pointerdown', (e) => {
  railSuppress = false;
  if (e.button !== 0 || cdrag) return;
  const card = e.target.closest('.card[data-c]');
  if (!card) return;
  const spImg = e.target.closest('.sprite img'),
    row = e.target.closest('.card-row');
  if (!spImg && !row) return;
  if (e.pointerType === 'touch' && !e.target.closest('.avatar,.sprite img')) return; // no toque, o resto do cartão rola o painel
  const c = charById(card.dataset.c);
  const sp = spImg ? spriteOf(c, spImg.closest('[data-sp]').dataset.sp) : readySprites(c)[0];
  if (!sp || !sp.img) return; // ainda gerando: nada para arrastar
  const r = (spImg || row.querySelector('.avatar')).getBoundingClientRect();
  startCharDrag(e, { c: c.id, s: sp.id }, sp.img, {
    ax: e.clientX,
    ay: e.clientY + r.height * 0.5,
    h: r.height,
    clip: 0,
    free: Math.max(110, Math.min(260, ((300 * 9) / 16) * SPRITE_H * view.z)),
  });
});
railBody.addEventListener(
  'click',
  (e) => {
    if (railSuppress) {
      railSuppress = false;
      e.stopPropagation();
      e.preventDefault();
    }
  },
  true,
);
const stageEl = (sid) => nodesEl.querySelector(`.stage-mini[data-stage="${sid}"]`);
const frameRect = (st) => st.querySelector('.stage-frame').getBoundingClientRect();
const easeOut = (k) => 1 - Math.pow(1 - k, 3),
  easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
function startCharDrag(e, src, img, from) {
  e.preventDefault();
  const g = document.createElement('img');
  g.className = 'cghost';
  g.src = img;
  g.alt = '';
  g.draggable = false;
  g.style.visibility = 'hidden';
  document.body.appendChild(g);
  // ox/oy: âncora relativa ao ponteiro, em alturas do sprite (vale enquanto o tamanho muda)
  cdrag = {
    pid: e.pointerId,
    touch: e.pointerType === 'touch',
    src,
    g,
    sx: e.clientX,
    sy: e.clientY,
    px: e.clientX,
    py: e.clientY,
    ox: (from.ax - e.clientX) / from.h,
    oy: (from.ay - e.clientY) / from.h,
    ax: from.ax,
    ay: from.ay,
    h: from.h,
    clip: from.clip,
    free: from.free,
    moved: false,
    end: false,
    over: null,
    ok: false,
    why: '',
  };
  addEventListener('pointermove', onCharMove);
  addEventListener('pointerup', onCharUp);
  addEventListener('pointercancel', onCharCancel);
}
function offChar() {
  removeEventListener('pointermove', onCharMove);
  removeEventListener('pointerup', onCharUp);
  removeEventListener('pointercancel', onCharCancel);
  document.body.classList.remove('chardrag');
  nodesEl
    .querySelectorAll('.drop-ok,.drop-bad')
    .forEach((x) => x.classList.remove('drop-ok', 'drop-bad'));
  nodesEl.querySelectorAll('.stage-mini[data-onion]').forEach(clearOnion);
  nodesEl.querySelectorAll('.pchar.clash').forEach((x) => x.classList.remove('clash'));
}
function paintGhost(d, clipTo, p) {
  const g = d.g,
    ar = g.naturalWidth ? g.naturalWidth / g.naturalHeight : 2 / 3,
    w = d.h * ar,
    L = d.ax - w / 2,
    T = d.ay - d.h;
  g.style.height = d.h + 'px';
  g.style.transform = `translate(${L.toFixed(1)}px,${T.toFixed(1)}px)`;
  if (clipTo && p > 0) {
    const it = Math.max(0, clipTo.top - T) * p,
      ir = Math.max(0, L + w - clipTo.right) * p,
      ib = Math.max(0, T + d.h - clipTo.bottom) * p,
      il = Math.max(0, clipTo.left - L) * p;
    g.style.clipPath = `inset(${it}px ${ir}px ${ib}px ${il}px round ${(7 * view.z * p).toFixed(1)}px)`;
  } else g.style.clipPath = '';
}
// O personagem continua no palco enquanto uma parte razoável dele está dentro do quadro, mesmo com o
// ponteiro fora (sprites grandes são agarrados longe da base). Medido no tamanho que teria naquele palco.
function spriteInFrame(d, st) {
  const r = frameRect(st),
    th = r.height * SPRITE_H * dk(d),
    ar = d.g.naturalWidth && d.g.naturalHeight ? d.g.naturalWidth / d.g.naturalHeight : 0.5,
    w = th * ar,
    ax = d.px + d.ox * th,
    ay = d.py + d.oy * th;
  const iw = Math.min(ax + w / 2, r.right) - Math.max(ax - w / 2, r.left),
    ih = Math.min(ay, r.bottom) - Math.max(ay - th, r.top);
  return iw >= Math.min(w * 0.3, r.width * 0.06) && ih >= (r.height * POS_VIS) / 100;
}
function stageUnderSprite(d) {
  const src = d.src.sid && stageEl(d.src.sid);
  if (src && spriteInFrame(d, src)) return src;
  for (const st of nodesEl.querySelectorAll('.stage-mini[data-stage]')) if (st !== src && spriteInFrame(d, st)) return st;
  return null;
}
function hoverStage() {
  const d = cdrag;
  const hit = document.elementFromPoint(d.px, d.py);
  const st = (hit && hit.closest('.stage-mini[data-stage]')) || stageUnderSprite(d);
  const sid = st ? st.dataset.stage : null;
  nodesEl.querySelectorAll('.drop-ok,.drop-bad').forEach((x) => {
    if (x !== st) x.classList.remove('drop-ok', 'drop-bad');
  });
  nodesEl.querySelectorAll('.pchar.clash').forEach((x) => {
    if (!st || !st.contains(x)) x.classList.remove('clash');
  });
  nodesEl.querySelectorAll('.stage-mini[data-onion]').forEach((x) => {
    if (x !== st || (!d.ok && x.dataset.onion)) clearOnion(x);
  });
  d.over = sid;
  d.ok = false;
  d.why = '';
  if (!st) return;
  const s = scene(sid),
    same = sid === d.src.sid;
  if (!same && s.chars.some((x) => x.c === d.src.c)) {
    d.why = 'dup';
    st.querySelector(`.pchar[data-c="${d.src.c}"]`)?.classList.add('clash');
  } else if (!same && s.chars.length >= MAXCH) d.why = 'full';
  else d.ok = true;
  st.classList.toggle('drop-ok', d.ok);
  st.classList.toggle('drop-bad', !d.ok);
  if (d.ok && st.dataset.onion !== d.src.c) paintOnion(st, sid, d.src.c);
  else if (!d.ok) clearOnion(st);
}
/* Onion skin: onde o personagem arrastado está na cena anterior e na seguinte, para manter a posição entre cenas. */
function neighbors(sid) {
  const s = scene(sid);
  const prev = state.scenes.filter(
    (o) => o.id !== sid && (o.next === sid || o.choices.some((c) => c.target === sid)),
  );
  const next = s
    ? [...new Set([s.next, ...s.choices.map((c) => c.target)].filter(Boolean))]
        .map(scene)
        .filter(Boolean)
    : [];
  return { prev, next };
}
function onionOf(sid, c) {
  const out = [];
  const { prev, next } = neighbors(sid);
  for (const [dir, list] of [
    ['prev', prev],
    ['next', next],
  ])
    for (const o of list) {
      const i = o.chars.findIndex((x) => x.c === c);
      if (i < 0) continue;
      const sp = spriteOf(charById(c), o.chars[i].s);
      if (!sp) continue;
      const p = posOf(o, i);
      if (out.some((q) => Math.abs(q.x - p.x) < 0.5 && Math.abs(q.y - p.y) < 0.5)) {
        const q = out.find((q) => Math.abs(q.x - p.x) < 0.5 && Math.abs(q.y - p.y) < 0.5);
        if (q.dir !== dir) q.dir = 'both';
        q.titles.push(o.title);
        continue;
      }
      out.push({ x: p.x, y: p.y, k: p.k, img: sp.img, dir, titles: [o.title] });
    }
  return out;
}
function paintOnion(st, sid, c) {
  clearOnion(st);
  const fr = st.querySelector('.stage-frame');
  if (!fr) return;
  st.dataset.onion = c;
  for (const o of onionOf(sid, c)) {
    const el = document.createElement('img');
    el.className = 'onion ' + o.dir;
    el.src = o.img;
    el.alt = '';
    el.draggable = false;
    el.dataset.x = o.x;
    el.dataset.y = o.y;
    el.dataset.k = o.k;
    el.style.height = (SPRITE_H * 100 * o.k).toFixed(1) + '%';
    el.style.left = o.x + '%';
    el.style.bottom = -o.y + '%';
    el.title =
      (o.dir === 'next'
        ? 'na cena seguinte: '
        : o.dir === 'prev'
          ? 'na cena anterior: '
          : 'nas cenas vizinhas: ') + o.titles.join(', ');
    fr.prepend(el);
  }
}
function clearOnion(st) {
  delete st.dataset.onion;
  st.querySelectorAll('.onion').forEach((x) => x.remove());
}
// Atrai para a posição de uma cena vizinha quando perto (Alt solta o ímã).
const SNAP_X = 4,
  SNAP_Y = 6;
function rawPos(d, r, h) {
  const ax = d.px + d.ox * h,
    ay = d.py + d.oy * h;
  return { x: ((ax - r.left) / r.width) * 100, y: ((ay - r.bottom) / r.height) * 100 };
}
// Cada onion é medido no tamanho dele: o fantasma, ao encaixar, assume essa escala, e a base fica onde ela ficaria.
function snapOnion(d, st, r) {
  let best = null,
    bd = 1e9;
  st.querySelectorAll('.onion').forEach((o) => {
    o.classList.remove('hit');
    if (d.alt) return;
    const ok = +o.dataset.k || 1,
      p = rawPos(d, r, r.height * SPRITE_H * ok),
      dx = Math.abs(+o.dataset.x - p.x),
      dy = Math.abs(+o.dataset.y - p.y);
    if (dx <= SNAP_X * ok && dy <= SNAP_Y * ok && dx + dy < bd) {
      bd = dx + dy;
      best = o;
    }
  });
  if (!best) return null;
  best.classList.add('hit');
  return { x: +best.dataset.x, y: +best.dataset.y, k: +best.dataset.k || 1 };
}
function charLoop() {
  const d = cdrag;
  if (!d || d.end) return;
  hoverStage();
  const th = d.over && d.ok ? frameRect(stageEl(d.over)).height * SPRITE_H * dk(d) : d.free;
  d.h += (th - d.h) * 0.28;
  d.ax = d.px + d.ox * d.h;
  d.ay = d.py + d.oy * d.h;
  d.snap = null;
  const ost = d.over && d.ok && stageEl(d.over);
  if (ost) {
    const r = frameRect(ost),
      sn = snapOnion(d, ost, r);
    if (sn) {
      d.snap = sn;
      const tx = r.left + (sn.x / 100) * r.width,
        ty = r.bottom + (sn.y / 100) * r.height;
      d.sax = (d.sax ?? d.ax) + (tx - (d.sax ?? d.ax)) * 0.45;
      d.say = (d.say ?? d.ay) + (ty - (d.say ?? d.ay)) * 0.45;
      d.ax = d.sax;
      d.ay = d.say;
    } else d.sax = d.say = null;
  }
  if (d.clip > 0) d.clip = Math.max(0, d.clip - 0.09);
  const src = d.clip > 0 && d.src.sid && stageEl(d.src.sid);
  paintGhost(d, src && src.getBoundingClientRect(), easeInOut(d.clip));
  sendCharDrag(d, false);
  requestAnimationFrame(charLoop);
}
function onCharMove(e) {
  const d = cdrag;
  if (!d || e.pointerId !== d.pid) return;
  d.px = e.clientX;
  d.py = e.clientY;
  d.alt = e.altKey;
  if (!d.moved) {
    if (Math.hypot(d.px - d.sx, d.py - d.sy) < (d.touch ? 8 : 4)) return;
    d.moved = true;
    document.body.classList.add('chardrag');
    if (d.src.sid) renderNodes();
    else if (mqNarrow.matches) setPanel('rail', false);
    paintGhost(d, d.src.sid && stageEl(d.src.sid)?.getBoundingClientRect(), 1);
    d.g.style.visibility = '';
    requestAnimationFrame(charLoop);
  }
  hoverStage();
  sendCharDrag(d, false);
}
// Pousa o fantasma em pos (% do quadro) do palco sid, fechando o recorte; o sprite real só aparece no fim.
function landGhost(d, sid, pos, done) {
  const a0 = { ax: d.ax, ay: d.ay, h: d.h },
    t0 = performance.now(),
    D = reduced ? 1 : 300;
  const me = { sid, c: d.src.c };
  landing = me;
  let fin = false;
  // sem rAF (aba em segundo plano) o pouso termina pelo relógio, para o sprite real não ficar oculto
  const finish = () => {
    if (fin) return;
    fin = true;
    if (landing === me) landing = null;
    done();
    requestAnimationFrame(() => d.g.remove());
    setTimeout(() => d.g.remove(), 80);
  };
  const step = (t) => {
    if (fin) return;
    const st = stageEl(sid);
    if (!st) {
      finish();
      return;
    }
    const r = frameRect(st),
      k = Math.min(1, (t - t0) / D),
      q = easeOut(k);
    d.ax = a0.ax + (r.left + (pos.x / 100) * r.width - a0.ax) * q;
    d.ay = a0.ay + (r.bottom + (pos.y / 100) * r.height - a0.ay) * q;
    d.h = a0.h + (r.height * SPRITE_H * (pos.k || 1) - a0.h) * q;
    paintGhost(d, st.getBoundingClientRect(), easeInOut(k));
    if (k < 1) requestAnimationFrame(step);
    else finish();
  };
  requestAnimationFrame(step);
  setTimeout(finish, D + 250);
}
function fadeGhost(d, poof) {
  const g = d.g;
  if (poof) {
    const r = g.getBoundingClientRect();
    screenBurst(r.left + r.width / 2, r.top + r.height / 2, false);
  }
  g.style.transition = 'opacity .22s,height .22s';
  g.style.opacity = '0';
  setTimeout(() => g.remove(), 240);
}
function flyBack(d) {
  cdrag = null;
  const s = scene(d.src.sid),
    i = s ? s.chars.findIndex((x) => x.c === d.src.c) : -1;
  if (i < 0) {
    fadeGhost(d);
    renderNodes();
    return;
  }
  landGhost(d, s.id, posOf(s, i), renderNodes);
}
function onCharUp(e) {
  const d = cdrag;
  if (!d || e.pointerId !== d.pid) return;
  d.px = e.clientX;
  d.py = e.clientY;
  d.alt = e.altKey;
  if (d.moved) hoverStage();
  // o ímã é decidido aqui também: sem rAF (aba em segundo plano) o loop não roda
  const ust = d.moved && d.over && d.ok && stageEl(d.over);
  if (ust) {
    const r = frameRect(ust);
    d.snap = snapOnion(d, ust, r);
  }
  if (d.moved) sendCharDrag(d, true);
  offChar();
  if (!d.moved) {
    d.g.remove();
    cdrag = null;
    if (d.src.sid) {
      castSel.set(d.src.sid, d.src.c);
      expanded === d.src.sid ? renderNodes() : setExpanded(d.src.sid);
    }
    return;
  }
  d.end = true;
  if (!d.src.sid) {
    railSuppress = true;
    setTimeout(() => (railSuppress = false), 0);
  }
  if (d.over && d.ok) {
    dropChar(d);
    return;
  }
  if (d.over) {
    toast(
      d.why === 'dup'
        ? `${charById(d.src.c).name} já está nesta cena.`
        : 'Uma cena tem no máximo 6 personagens.',
      'err',
    );
    nodeShake(d.over);
  }
  if (!d.src.sid) {
    cdrag = null;
    fadeGhost(d);
    return;
  }
  if (d.over) {
    flyBack(d);
    return;
  }
  // de um palco para fora de qualquer palco: sai da cena
  const s = scene(d.src.sid);
  cdrag = null;
  if (s && s.chars.some((x) => x.c === d.src.c)) {
    pushUndo();
    materialize(s);
    s.chars = s.chars.filter((x) => x.c !== d.src.c);
    fixSpeaker(s);
    refresh();
  } else renderNodes();
  fadeGhost(d, true);
}
function onCharCancel(e) {
  const d = cdrag;
  if (!d || e.pointerId !== d.pid) return;
  if (d.moved) sendCharDrag(d, true, true);
  offChar();
  d.end = true;
  if (d.moved && d.src.sid) {
    flyBack(d);
    return;
  }
  cdrag = null;
  d.g.remove();
  renderNodes();
}
function dropChar(d) {
  const s = scene(d.over);
  if (!s) {
    cdrag = null;
    fadeGhost(d);
    renderNodes();
    return;
  }
  const r = frameRect(stageEl(s.id)),
    th = r.height * SPRITE_H * dk(d),
    ax = d.px + d.ox * th,
    ay = d.py + d.oy * th;
  const pos =
    d.snap && !d.alt
      ? { ...d.snap }
      : {
          x: clampX(((ax - r.left) / r.width) * 100),
          y: clampY(((ay - r.bottom) / r.height) * 100, dk(d)),
          k: dk(d),
        };
  pushUndo();
  materialize(s);
  let cc = s.chars.find((x) => x.c === d.src.c);
  if (d.src.sid && d.src.sid !== s.id) {
    const o = scene(d.src.sid);
    if (o) {
      const old = o.chars.find((x) => x.c === d.src.c);
      materialize(o);
      o.chars = o.chars.filter((x) => x !== old);
      fixSpeaker(o);
    }
  }
  if (cc) s.chars = s.chars.filter((x) => x !== cc);
  else {
    cc = { c: d.src.c, s: d.src.s };
    freshRows.set('cast:' + s.id + ':' + cc.c, performance.now());
  }
  cc.x = pos.x;
  cc.y = pos.y;
  if (pos.k && pos.k !== 1) cc.k = pos.k;
  else delete cc.k;
  s.chars.push(cc); // por último = na frente
  castSel.set(s.id, cc.c);
  cdrag = null;
  landGhost(d, s.id, pos, renderNodes);
  refresh();
}
function publish(kind, item) {
  const copy = JSON.parse(JSON.stringify(item));
  copy.id = uid(kind === 'chars' ? 'c' : 'b');
  copy.author = '@você';
  copy.source = 'marketplace';
  if (kind === 'chars') copy.sprites.forEach((s) => (s.id = uid('sp')));
  market[kind === 'chars' ? 'characters' : 'backgrounds'].unshift(copy);
  toast(`“${item.name}” publicado no marketplace`);
}

/* ---------- modals ---------- */
function modal(html, cls) {
  closeModal();
  const w = document.createElement('div');
  w.className = 'modal-wrap';
  w.innerHTML = `<div class="modal ${cls || ''}" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(w);
  w.addEventListener('pointerdown', (e) => {
    if (e.target === w) closeModal();
  });
  w.querySelectorAll('[data-close]').forEach((b) => (b.onclick = closeModal));
  const f = w.querySelector('input,textarea');
  if (f) f.focus();
  return w;
}
// Background em tamanho grande; clicar na imagem alterna entre caber na tela e 100% (arrastando para mover).
function bgViewer(b) {
  const w = modal(
    `<div class="modal-head"><h2>${esc(b.name)}</h2><span class="hint" id="bvSize"></span><button class="iconbtn" data-close aria-label="Fechar">${X}</button></div>
  <div class="bv-stage" id="bvStage"><img src="${esc(b.img)}" alt="${esc(b.name)}" draggable="false"></div>
  <div class="modal-foot"><span class="hint" style="margin-right:auto">${b.desc ? esc(b.desc) : 'Clique na imagem para ver em 100% e arraste para mover.'}</span><button class="btn" data-close>Fechar</button></div>`,
    'viewer',
  );
  const st = w.querySelector('#bvStage'),
    img = st.querySelector('img');
  // 100% só ajuda quando a imagem é maior que a área em que ela cabe.
  const big = () => img.naturalWidth > st.clientWidth + 1 || img.naturalHeight > img.clientHeight + 1;
  const ready = () => {
    w.querySelector('#bvSize').textContent = `${img.naturalWidth}×${img.naturalHeight}`;
    st.classList.toggle('zoomable', big());
  };
  img.addEventListener('load', ready);
  if (img.complete && img.naturalWidth) ready();
  let drag = null,
    moved = false;
  st.addEventListener('pointerdown', (e) => {
    if (!st.classList.contains('full')) return;
    drag = { x: e.clientX, y: e.clientY, l: st.scrollLeft, t: st.scrollTop };
    moved = false;
    st.setPointerCapture(e.pointerId);
  });
  st.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x,
      dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
    st.scrollLeft = drag.l - dx;
    st.scrollTop = drag.t - dy;
  });
  st.addEventListener('pointerup', () => {
    drag = null;
  });
  img.addEventListener('click', (e) => {
    if (moved) {
      moved = false;
      return;
    }
    if (st.classList.contains('full')) {
      st.classList.remove('full');
      return;
    }
    if (!big()) return;
    const r = img.getBoundingClientRect(),
      fx = (e.clientX - r.left) / r.width,
      fy = (e.clientY - r.top) / r.height;
    st.classList.add('full');
    st.scrollLeft = fx * img.naturalWidth - st.clientWidth / 2;
    st.scrollTop = fy * img.naturalHeight - st.clientHeight / 2;
  });
}
function closeModal() {
  const m = document.querySelector('.modal-wrap');
  if (m) {
    m.remove();
    if (m.onclose) m.onclose();
  }
}
// Substitutos de prompt()/confirm(): resolvem com o valor, ou null/false ao cancelar (Esc, fora, ×).
function askModal(body, { title, ok, danger }, read) {
  return new Promise((res) => {
    const w = modal(
      `<form class="askform"><div class="modal-head"><h2>${esc(title)}</h2><button type="button" class="iconbtn" data-close aria-label="Fechar">${X}</button></div>
    <div class="modal-body">${body}</div>
    <div class="modal-foot"><button type="button" class="btn" data-close>Cancelar</button><button type="submit" class="btn ${danger ? 'danger solid' : 'primary'}">${esc(ok)}</button></div></form>`,
      'narrow ask',
    );
    let done = false;
    const end = (v) => {
      if (!done) {
        done = true;
        res(v);
      }
    };
    w.onclose = () => end(read ? null : false);
    const inp = w.querySelector('input');
    if (inp) inp.select(); // o texto atual já vem selecionado
    w.querySelector('form').onsubmit = (e) => {
      e.preventDefault();
      const v = read ? read(w) : true;
      if (v === null) return;
      end(v);
      closeModal();
    };
    // Ação destrutiva: o foco começa em Cancelar, para Enter não excluir por engano.
    if (danger) w.querySelector('[data-close].btn').focus();
  });
}
const askText = ({ label, value = '', max = 200, ...o }) =>
  askModal(
    `<label class="field"><span class="lbl">${esc(label)}</span><input class="inp" name="v" maxlength="${max}" value="${esc(value)}" autocomplete="off"></label>`,
    o,
    (w) => {
      const v = w.querySelector('input').value.trim();
      return v || null;
    },
  );
const askConfirm = ({ text, ...o }) => askModal(`<p class="ask-text">${text}</p>`, o);
function marketModal(tab) {
  const draw = () => {
    const items = tab === 'chars' ? market.characters : market.backgrounds;
    const w =
      modal(`<div class="modal-head"><h2>Marketplace</h2><div class="tabs" style="width:250px"><button class="tab" data-mt="chars" aria-selected="${tab === 'chars'}">Personagens</button><button class="tab" data-mt="bgs" aria-selected="${tab === 'bgs'}">Backgrounds</button></div><button class="iconbtn" data-close aria-label="Fechar">${X}</button></div>
  <div class="modal-body"><div class="hint">Itens publicados por usuários. Ao incluir, uma cópia vai para esta história e passa a ser independente do original.</div><div class="mk-grid">${items
    .map(
      (it, i) =>
        `<div class="mk-card" style="animation:rowpop .4s cubic-bezier(.2,1.4,.4,1) both;animation-delay:${i * 50}ms"><div class="mk-art">${
          tab === 'chars'
            ? `<div class="strip">${it.sprites
                .slice(0, 3)
                .map((s) => `<img src="${s.img}" alt="">`)
                .join('')}</div>`
            : `<img class="full" src="${it.img}" alt="">`
        }</div><div class="mk-info"><b style="color:${it.color || 'inherit'}">${esc(it.name)}</b><span class="hint">${esc(it.desc)}</span>${tab === 'chars' ? `<span class="card-sub">${it.sprites.map((s) => esc(s.name)).join(' · ')}</span>` : ''}<span class="card-sub">por ${esc(it.author)}</span><button class="btn sm primary" data-add="${i}" style="align-self:flex-start;margin-top:6px">Incluir na história</button></div></div>`,
    )
    .join('')}</div></div>`);
    w.querySelectorAll('[data-mt]').forEach(
      (b) =>
        (b.onclick = () => {
          tab = b.dataset.mt;
          draw();
        }),
    );
    w.querySelectorAll('[data-add]').forEach(
      (b) =>
        (b.onclick = () => {
          const it = JSON.parse(JSON.stringify(items[+b.dataset.add]));
          delete it.author;
          pushUndo();
          it.id = uid(tab === 'chars' ? 'c' : 'b');
          it.source = 'marketplace';
          if (tab === 'chars') {
            it.sprites.forEach((s) => (s.id = uid('sp')));
            state.characters.push(it);
            railTab = 'chars';
          } else {
            state.backgrounds.push(it);
            railTab = 'bgs';
          }
          freshCards.set(it.id, performance.now());
          renderRail();
          refresh();
          toast(`“${it.name}” incluído na história`);
          b.textContent = 'Incluído ✓';
          b.disabled = true;
          const r = b.getBoundingClientRect();
          screenBurst(r.left + r.width / 2, r.top + r.height / 2);
        }),
    );
  };
  draw();
}
function screenBurst(x, y, ai) {
  const b = document.createElement('div');
  b.className = 'burst ' + (ai ? 'ai' : 'plain');
  b.style.position = 'fixed';
  b.style.left = x + 'px';
  b.style.top = y + 'px';
  b.style.zIndex = 90;
  b.innerHTML = '<span class="ring"></span><span class="ring r2"></span>';
  document.body.appendChild(b);
  setTimeout(() => b.remove(), 900);
}
function genCharModal() {
  if (!storyId) return;
  const w = modal(
    `<div class="modal-head"><h2>Gerar personagem com IA</h2><span class="tag ai">${SPARK}IA</span><button class="iconbtn" data-close aria-label="Fechar">${X}</button></div>
  <div class="modal-body"><div class="row" style="align-items:flex-end"><label class="field" style="flex:1"><span class="lbl">nome</span><input class="inp" id="gcName" value="Marta"></label><div class="field"><span class="lbl">cor · opcional</span><span class="row" style="height:30px"><input type="checkbox" id="gcHas" checked aria-label="Usar cor"><input type="color" id="gcColor" value="#5eead4" aria-label="Cor" style="width:34px;height:24px;border:0;background:none;padding:0"></span></div></div>
  <label class="field"><span class="lbl">descrição física</span><textarea class="inp" id="gcDesc">Mulher de 30 anos, alta, pele morena, cabelo preto longo preso em trança, usa jaqueta de couro.</textarea></label>
  <div class="field"><span class="lbl">emoções desejadas · nome e descrição viram o sprite</span><div id="gcEmos" style="display:flex;flex-direction:column;gap:6px"></div><button class="addbtn" id="gcAdd" style="align-self:flex-start">+ emoção</button></div>
  <div class="hint">Primeiro sai o charsheet (frente e perfil); depois cada pose, uma por vez. Dá para fechar esta janela e seguir editando: o andamento aparece no painel de personagens.</div></div>
  <div class="modal-foot"><button class="btn" data-close>Cancelar</button><button class="btn violet solid" id="gcGo">${SPARK13()}Gerar personagem</button></div>`,
    'ai-glow',
  );
  const row = ([n, d], anim) => {
    const r = document.createElement('div');
    r.className = 'emo-row' + (anim ? ' fresh' : '');
    r.innerHTML = `<input class="inp" value="${esc(n)}" placeholder="Nome" aria-label="Nome da emoção"><input class="inp" value="${esc(d)}" placeholder="Descrição" aria-label="Descrição da emoção"><button class="iconbtn sm" aria-label="Remover emoção">${X}</button>`;
    r.querySelector('button').onclick = () => r.remove();
    w.querySelector('#gcEmos').appendChild(r);
  };
  [
    ['Neutro', 'expressão calma'],
    ['Feliz', 'sorriso confiante'],
    ['Brava', 'olhar duro, sobrancelhas franzidas'],
    ['Surpresa', 'olhos arregalados'],
  ].forEach((x) => row(x));
  w.querySelector('#gcAdd').onclick = () => row(['', ''], true);
  w.querySelector('#gcHas').onchange = (e) =>
    (w.querySelector('#gcColor').disabled = !e.target.checked);
  w.querySelector('#gcGo').onclick = (e) => {
    const name = w.querySelector('#gcName').value.trim();
    const list = [...w.querySelectorAll('.emo-row')]
      .map((r) => [r.children[0].value.trim(), r.children[1].value.trim()])
      .filter((x) => x[0]);
    if (!name || !list.length) {
      toast('Informe o nome e ao menos uma emoção.', 'err');
      return;
    }
    if (list.length > 12) {
      toast('No máximo 12 emoções por vez; as outras dá para pedir depois.', 'err');
      return;
    }
    const btn = e.currentTarget;
    btn.disabled = true;
    const desc = w.querySelector('#gcDesc').value,
      color = w.querySelector('#gcHas').checked ? w.querySelector('#gcColor').value : '';
    const characterId = uid('c');
    conn.reducers
      .generateCharacter({
        storyId,
        characterId,
        jobId: uid('j'),
        name,
        desc,
        color,
        poses: JSON.stringify(list.map(([n, d]) => ({ id: uid('sp'), name: n, desc: d }))),
      })
      .then(
        () => {
          if (w.isConnected) closeModal();
          railTab = 'chars';
          editChar = characterId;
          freshCards.set(characterId, performance.now());
          renderRail();
          toast(
            `Gerando ${name}: o charsheet primeiro, depois ${list.length} pose${list.length > 1 ? 's' : ''}`,
            'ai',
          );
        },
        (err) => {
          btn.disabled = false;
          castFailed('gerar o personagem')(err);
        },
      );
  };
}
function genBgModal() {
  if (!storyId) return;
  const w = modal(
    `<div class="modal-head"><h2>Gerar background com IA</h2><span class="tag ai">${SPARK}IA</span><button class="iconbtn" data-close aria-label="Fechar">${X}</button></div>
  <div class="modal-body"><label class="field"><span class="lbl">nome</span><input class="inp" id="gbName" value="Floresta do manguezal"></label><label class="field"><span class="lbl">descrição</span><textarea class="inp" id="gbDesc">Mata fechada perto do mangue, fim de tarde, raízes aparentes e luz filtrada entre as árvores.</textarea></label><div class="hint">Descreva o lugar com suas palavras: a IA detalha a descrição num prompt no estilo anime da história (sem personagens, com espaço no chão para os sprites) antes de gerar. O background aparece no painel; dá para seguir editando.</div></div>
  <div class="modal-foot"><button class="btn" data-close>Cancelar</button><button class="btn violet solid" id="gbGo">${SPARK13()}Gerar background</button></div>`,
    'narrow ai-glow',
  );
  w.querySelector('#gbGo').onclick = (e) => {
    const n = w.querySelector('#gbName').value.trim();
    if (!n) {
      toast('Dê um nome ao background.', 'err');
      return;
    }
    const btn = e.currentTarget;
    btn.disabled = true;
    const desc = w.querySelector('#gbDesc').value;
    const backgroundId = uid('b');
    conn.reducers
      .generateBackground({ storyId, backgroundId, jobId: uid('j'), name: n, desc })
      .then(
        () => {
          if (w.isConnected) closeModal();
          railTab = 'bgs';
          freshCards.set(backgroundId, performance.now());
          renderRail();
          toast(`Gerando o background “${n}”`, 'ai');
        },
        (err) => {
          btn.disabled = false;
          castFailed('gerar o background')(err);
        },
      );
  };
}
function completeText(s) {
  if (gens.has(s.id)) return;
  const prev = snapStr();
  const old = s.text;
  let result = null,
    iv = 0,
    req = 0;
  const w = modal(
    `<div class="modal-head"><h2>Completar texto</h2><span class="tag ai">${SPARK}IA</span><button class="iconbtn" data-close aria-label="Fechar">${X}</button></div><div class="modal-body"><label class="field"><span class="lbl">instrução opcional</span><span class="row"><input class="inp" id="ctInstr" placeholder="ex.: deixar mais tenso" style="flex:1"><button class="btn sm" id="ctAgain">Gerar de novo</button></span></label><div class="field"><span class="lbl">sugestão</span><div class="suggest" id="ctSug"></div></div><div class="hint">O texto só é substituído se você aceitar.</div></div><div class="modal-foot"><button class="btn" data-close>Recusar</button><button class="btn violet solid" id="ctOk" disabled>Aceitar</button></div>`,
    'narrow ai-glow',
  );
  const sug = w.querySelector('#ctSug'),
    ok = w.querySelector('#ctOk'),
    again = w.querySelector('#ctAgain');
  const gen = () => {
    const my = ++req;
    clearInterval(iv);
    result = null;
    ok.disabled = true;
    again.disabled = true;
    sug.innerHTML = `${esc(old)}<span class="add"></span><span class="spinner" style="margin-left:6px"></span>`;
    aiJob('complete', {
      sceneId: s.id,
      text: old,
      textKind: s.kind,
      speakerName: s.kind === 'dialogue' ? charById(s.speaker)?.name || '' : '',
      instruction: w.querySelector('#ctInstr').value.trim(),
    }).then(
      (r) => {
        if (my !== req || !w.isConnected) return;
        again.disabled = false;
        result = r.text;
        // Continuação mostra só o trecho novo; reescrita mostra o texto inteiro.
        const cont = result.startsWith(old.trimEnd());
        const extra = cont ? result.slice(old.trimEnd().length) : result;
        sug.innerHTML = `${cont ? esc(old.trimEnd()) : ''}<span class="add"></span><span class="caret"></span>`;
        const add = sug.querySelector('.add');
        let i = 0;
        iv = setInterval(() => {
          if (!add.isConnected) {
            clearInterval(iv);
            return;
          }
          i += 2;
          add.textContent = extra.slice(0, i);
          if (i >= extra.length) {
            clearInterval(iv);
            sug.querySelector('.caret')?.remove();
            ok.disabled = false;
          }
        }, 30);
      },
      (err) => {
        if (my !== req || !w.isConnected) return;
        again.disabled = false;
        sug.innerHTML = `${esc(old)}<div class="hint" style="color:#ffb4a8;margin-top:6px">${esc('Falhou: ' + aiMessage(err))}</div>`;
      },
    );
  };
  again.onclick = gen;
  w.querySelector('#ctInstr').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      gen();
    }
  });
  gen();
  ok.onclick = () => {
    if (result == null) return;
    if (!scene(s.id)) {
      toast('A cena foi apagada.', 'err');
      closeModal();
      return;
    }
    pushUndo(prev);
    s.text = result;
    closeModal();
    refresh();
    const n = nodeEl(s.id);
    if (n) {
      n.classList.add('landed');
      setTimeout(() => n.classList.remove('landed'), 900);
    }
    toast('Texto atualizado', 'ai');
  };
}

/* ---------- chat de IA ----------
   Pedido por request_ai; os pedaços chegam por chat_chunk (só os meus) e a mensagem final,
   com as propostas, por my_chat_message. A conversa fica no servidor e volta ao recarregar. */
const log = $('#chatLog');
function addMsg(html, who) {
  const d = document.createElement('div');
  d.className = 'msg ' + who;
  d.innerHTML = html;
  log.appendChild(d);
  log.scrollTop = log.scrollHeight;
  return d;
}
const CHAT_HELLO =
  'Conheço o grafo, o elenco e os backgrounds desta história. Peça algo como <b>“continue a partir do final com três cenas”</b>, <b>“reescreva a cena do farol como diálogo”</b> ou <b>“remova o final triste”</b>. Toda mudança chega como proposta para você ver no canvas e aceitar.';
addMsg(CHAT_HELLO, 'bot');
const chatJobs = new Map();
const chatSeen = new Set(); // jobId -> {el, next, held, text, done}
let chatLive = false; // depois do histórico: propostas novas abrem o rascunho sozinhas
const chatDropped = new Set(); // pedidos em andamento quando o chat foi limpo: pedaços e falhas são ignorados
// Faixas de seq dos pedaços (veja runChat no worker): texto da resposta, resumo do raciocínio
// e andamento da proposta (JSON; vale o último).
const THOUGHT_SEQ = 0x80000000,
  PROGRESS_SEQ = 0xc0000000;
// Cartão provisório enquanto a proposta chega: o que já deu para ler dela.
function showBuilding(j, seq, text) {
  if (seq < j.pseq) return;
  j.pseq = seq;
  let p;
  try {
    p = JSON.parse(text);
  } catch (_) {
    return;
  }
  if (!j.build) {
    j.build = document.createElement('div');
    j.build.className = 'proposal building';
    j.build.innerHTML = `<h3>${SPARK}<span class="blabel"></span><span class="typingdots"><i></i><i></i><i></i></span></h3><div class="bbody"></div>`;
    j.el.after(j.build);
    j.bn = 0;
  }
  const label =
    p.attempt > 1 ? `corrigindo a proposta · tentativa ${p.attempt}` : 'montando proposta';
  const lb = j.build.querySelector('.blabel');
  if (lb.textContent !== label) {
    lb.textContent = label;
    j.bn = 0;
  }
  const items = [
    ...p.criar.map((t) => ['Criar', t]),
    ...p.alterar.map((t) => ['Alterar', t]),
    ...p.remover.map((t) => ['Remover', t]),
  ];
  if (p.ligar) items.push([`${p.ligar} ligaç${p.ligar > 1 ? 'ões' : 'ão'}`, '']);
  // Só os itens novos entram com animação; o resto é redesenhado parado.
  j.build.querySelector('.bbody').innerHTML = items.length
    ? `<ul>${items.map(([v, t], i) => `<li${i >= j.bn && !(i === items.length - 1 && p.ligar && j.bl) ? ' class="new"' : ''}>${t ? `${v} “${esc(t)}”` : v}</li>`).join('')}</ul>`
    : '<div class="hint">planejando as mudanças…</div>';
  j.bn = items.length - (p.ligar ? 1 : 0);
  j.bl = !!p.ligar;
  log.scrollTop = log.scrollHeight;
}
function endBuilding(j) {
  j.build?.remove();
  j.build = null;
}
function chatJob(jobId) {
  let j = chatJobs.get(jobId);
  if (!j) {
    const el = addMsg(
      '<details class="think" hidden><summary><span class="think-label">Pensando…</span></summary><div class="think-body"></div></details><div class="mtext"><span class="typingdots"><i></i><i></i><i></i></span></div>',
      'bot',
    );
    j = {
      el,
      txt: el.querySelector('.mtext'),
      think: el.querySelector('.think'),
      next: 0,
      held: new Map(),
      text: '',
      tnext: 0,
      theld: new Map(),
      thought: '',
      t0: 0,
      tText: 0,
      tLast: 0,
      pseq: -1,
      build: null,
      done: false,
    };
    // Abrir ou fechar à mão vale até o fim: o bloco deixa de abrir e fechar sozinho.
    j.think.querySelector('summary').addEventListener('click', () => {
      j.think.dataset.touched = '1';
    });
    chatJobs.set(jobId, j);
  }
  return j;
}
const thoughtHTML = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
function setThought(j, t, live) {
  j.thought = t;
  j.think.hidden = !t;
  if (!t) return;
  const b = j.think.querySelector('.think-body');
  b.innerHTML = thoughtHTML(t);
  if (live && !j.tText && !j.think.dataset.touched) j.think.open = true;
  b.scrollTop = b.scrollHeight;
}
// Recolhe o raciocínio quando a resposta começa; o tempo vai até o último pedaço de raciocínio ou o 1º de texto.
function endThought(j) {
  if (!j.thought) return;
  const end = Math.max(j.tText, j.tLast);
  const s = j.t0 && end ? Math.max(1, Math.round((end - j.t0) / 1000)) : 0;
  j.think.querySelector('.think-label').textContent = s ? `Pensou por ${s} s` : 'Raciocínio';
  if (!j.think.dataset.touched) j.think.open = false;
}
function onChatChunk(row) {
  if (chatDropped.has(row.jobId)) return;
  const j = chatJob(row.jobId);
  if (j.done) return;
  if (row.seq >= PROGRESS_SEQ) {
    showBuilding(j, row.seq, row.text);
    return;
  }
  if (row.seq >= THOUGHT_SEQ) {
    const now = performance.now();
    j.t0 ||= now;
    j.tLast = now;
    j.theld.set(row.seq - THOUGHT_SEQ, row.text);
    let t = j.thought;
    while (j.theld.has(j.tnext)) {
      t += j.theld.get(j.tnext);
      j.theld.delete(j.tnext);
      j.tnext++;
    }
    setThought(j, t, true);
    log.scrollTop = log.scrollHeight;
    return;
  }
  j.held.set(row.seq, row.text);
  while (j.held.has(j.next)) {
    j.text += j.held.get(j.next);
    j.held.delete(j.next);
    j.next++;
  }
  if (j.text) {
    if (!j.tText) {
      j.tText = performance.now();
      endThought(j);
    }
    j.txt.innerHTML = esc(j.text) + '<span class="caret"></span>';
    log.scrollTop = log.scrollHeight;
  }
}
function chatJobChanged(row) {
  if (row.status !== 'failed' || chatDropped.has(row.id)) return;
  const j = chatJob(row.id);
  if (j.done) return;
  j.done = true;
  endThought(j);
  endBuilding(j);
  j.txt.innerHTML =
    (j.text ? esc(j.text) + '<br>' : '') +
    `<span style="color:#ffb4a8">A IA falhou: ${esc(aiMessage(row.error))}</span>`;
}
function renderChatRow(row) {
  if (chatSeen.has(row.id)) return;
  chatSeen.add(row.id);
  if (row.role === 'user') {
    addMsg(esc(row.content), 'me');
    const job = conn.db.myAiJob.id.find(row.jobId);
    if (job && (job.status === 'pending' || job.status === 'running')) chatJob(row.jobId);
    else if (job) chatJobChanged(job);
    return;
  }
  const j = chatJob(row.jobId);
  j.done = true;
  endBuilding(j);
  j.txt.innerHTML = esc(row.content);
  // O raciocínio completo fica no resultado do pedido: vale depois de recarregar e cobre pedaços perdidos.
  try {
    const r = JSON.parse(conn.db.myAiJob.id.find(row.jobId)?.result || '{}');
    if (r.thoughts) setThought(j, r.thoughts, false);
  } catch (_) {}
  endThought(j);
  let props = [];
  try {
    props = JSON.parse(row.proposals);
  } catch (_) {}
  const cards = props.map((p, i) => log.appendChild(proposalCard(p, row.id + ':' + i)));
  log.scrollTop = log.scrollHeight;
  const i = chatLive ? cards.findIndex((c) => !c.classList.contains('done')) : -1;
  if (i >= 0) showDraft(props[i], cards[i]);
}
/* Rascunho da proposta: o canvas mostra a história como ficaria, sem mexer no grafo. Cenas novas
   aparecem tracejadas onde vão cair, cenas alteradas mostram a versão nova no lugar da atual, cenas
   removidas ficam apagadas em vermelho; fios novos são tracejados e fios que somem ficam vermelhos. */
// Cenas que a proposta cria. Propostas antigas não marcam: vale o upsert de cena que ainda não existe.
const createdOf = (p) =>
  p.created ||
  p.ops.filter((o) => o.op === 'upsert_scene' && !scene(o.scene.id)).map((o) => o.scene.id);
const choicesOfFlat = (f, sid) =>
  [...f.choices].filter(([, c]) => c.sceneId === sid).sort((a, b) => a[1].position - b[1].position);
// key -> {from, ch, to}, como edges(), sobre um grafo plano.
function flatEdges(f) {
  const out = new Map();
  for (const [sid, s] of f.scenes) {
    const cs = choicesOfFlat(f, sid);
    if (cs.length) {
      for (const [cid, c] of cs)
        if (c.target && f.scenes.has(c.target))
          out.set(edgeKey(sid, cid), { from: sid, ch: cid, to: c.target });
    } else if (s.next && f.scenes.has(s.next))
      out.set(edgeKey(sid, ''), { from: sid, ch: '', to: s.next });
  }
  return out;
}
// gone: cenas removidas; perder o fio para uma delas não conta como alteração (o fio vermelho já mostra).
function sceneChanged(a, b, id, gone = new Set()) {
  const x = a.scenes.get(id),
    y = b.scenes.get(id),
    t = (v) => (gone.has(v) ? '' : v);
  for (const k of ['title', 'bg', 'chars', 'kind', 'speaker', 'text'])
    if (x[k] !== y[k]) return true;
  if (t(x.next) !== y.next) return true;
  const cs = (f, m) =>
    JSON.stringify(choicesOfFlat(f, id).map(([cid, c]) => [cid, c.label, m(c.target)]));
  return cs(a, t) !== cs(b, (v) => v);
}
// Posição das cenas novas: perto da saída que leva até elas, sem cobrir nada; uma sequência fica lado a lado.
function proposalPlan(p) {
  const before = flatOf(state);
  const created = new Set(createdOf(p).filter((id) => !before.scenes.has(id)));
  const ops = JSON.parse(JSON.stringify(p.ops));
  const es = [...flatEdges(applyOps(cloneFlat(before), ops)).values()];
  const pos = new Map(),
    placed = [];
  const kids = new Map();
  const chain = (id) => {
    let n = 0,
      cur = id;
    const seen = new Set();
    while (cur && created.has(cur) && !pos.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      n++;
      cur = es.find((e) => e.from === cur && created.has(e.to))?.to;
    }
    return Math.max(1, n);
  };
  const put = (id, at) => {
    pos.set(id, { x: Math.round(at.x), y: Math.round(at.y) });
    placed.push(pos.get(id));
  };
  while (pos.size < created.size) {
    const todo = [...created].filter((id) => !pos.has(id));
    // Primeiro quem sai de uma cena já no canvas, depois quem sai de uma cena nova já posicionada.
    let e = null;
    for (const id of todo) {
      e = es.find((x) => x.to === id && !created.has(x.from) && scene(x.from));
      if (e) break;
    }
    if (e) {
      const s = scene(e.from);
      put(
        e.to,
        freeSpot(outPos(e.from, e.ch) || { x: s.x + 300, y: s.y + 200 }, chain(e.to), placed),
      );
      continue;
    }
    for (const id of todo) {
      e = es.find((x) => x.to === id && pos.has(x.from));
      if (e) break;
    }
    if (e) {
      const pp = pos.get(e.from),
        k = kids.get(e.from) || 0;
      kids.set(e.from, k + 1);
      put(e.to, freeSpot({ x: pp.x + 220, y: pp.y + 20 + k * 280 }, chain(e.to), placed));
      continue;
    }
    // Sem ligação: à direita de tudo.
    const right = Math.max(0, ...state.scenes.map((s) => s.x), ...placed.map((q) => q.x)),
      top = Math.min(...state.scenes.map((s) => s.y), 0);
    put(todo[0], freeSpot({ x: right + 220, y: top + 20 }, chain(todo[0]), placed));
  }
  for (const o of ops)
    if (o.op === 'upsert_scene' && pos.has(o.scene.id)) Object.assign(o.scene, pos.get(o.scene.id));
  return { ops, created };
}
// O que o rascunho mostra, contra o estado atual (o grafo pode mudar com o rascunho aberto).
function draftView() {
  if (!draft) {
    return null;
  }
  const before = flatOf(state),
    after = applyOps(cloneFlat(before), draft.plan.ops);
  const created = new Set(
    [...draft.plan.created].filter((id) => after.scenes.has(id) && !before.scenes.has(id)),
  );
  const del = new Set([...before.scenes.keys()].filter((id) => !after.scenes.has(id)));
  const edit = new Set(
    [...before.scenes.keys()].filter(
      (id) => after.scenes.has(id) && sceneChanged(before, after, id, del),
    ),
  );
  const be = flatEdges(before),
    ae = flatEdges(after),
    drawn = (id) => created.has(id) || edit.has(id);
  const add = [...ae]
    .filter(([k, e]) => be.get(k)?.to !== e.to || drawn(e.from) || drawn(e.to))
    .map(([, e]) => e);
  const cut = [...be].filter(([k, e]) => ae.get(k)?.to !== e.to).map(([, e]) => e);
  return (draft.view = { before, after, created, del, edit, add, cut });
}
function draftHTML(id, v, f, tag, i) {
  let chars = [];
  try {
    chars = JSON.parse(v.chars || '[]');
  } catch (_) {}
  const spk = v.kind === 'dialogue' ? charById(v.speaker) : null;
  const s = scene(id);
  const sum = v.text
    ? `${spk ? `<span class="who" style="color:${spk.color || 'var(--text)'}">${esc(spk.name)}</span>` : ''}<span class="${spk ? '' : 'narr'}">${esc(v.text)}</span>`
    : '<span class="none">sem texto</span>';
  const cs = choicesOfFlat(f, id);
  const rows = cs.length
    ? cs
        .map(
          ([cid, c], k) =>
            `<div class="orow c${c.target ? '' : ' draft'}"><span class="onum">${k + 1}</span><span class="olabel">${c.label ? esc(c.label) : '<i class="none">sem texto</i>'}</span>${c.target ? '' : '<span class="tag warn">sem destino</span>'}<span class="port out${c.target ? '' : ' draft'}" data-dout="${id}" data-dch="${cid}"></span></div>`,
        )
        .join('')
    : `<div class="orow c"><span class="nextlabel">${v.next ? 'continuar → ' + esc(f.scenes.get(v.next)?.title || '') : 'continuar'}</span><span class="port out" data-dout="${id}" data-dch=""></span></div>`;
  const at = s ? { x: dispX(s), y: dispY(s) } : v;
  return `<div class="node dnode${s ? ' dedit' : ''}" style="left:${at.x}px;top:${at.y}px;animation-delay:${i * 90 - ago(draft.t0)}ms"><div class="nhead"><span class="port in" data-din="${id}"></span><span class="dtitle">${esc(v.title)}</span><span class="tag ai">${SPARK}${tag}</span></div><div class="mid"><div class="sec">${stageMini({ ...v, chars })}<div class="sum">${sum}</div></div></div>${rows}</div>`;
}
// Chamado pelo renderNodes: as marcas nas cenas reais e as cenas do rascunho acompanham o grafo.
function renderDraft() {
  const v = draftView();
  if (!v) {
    draftsEl.innerHTML = '';
    return;
  }
  let i = 0;
  draftsEl.innerHTML = [
    ...[...v.edit].map((id) => draftHTML(id, v.after.scenes.get(id), v.after, 'alterada', i++)),
    ...[...v.created].map((id) => draftHTML(id, v.after.scenes.get(id), v.after, 'nova', i++)),
  ].join('');
}
function draftWires() {
  const v = draft && draft.view;
  if (!v) return '';
  const at = (sel, root) => {
    const el = root && root.querySelector(sel);
    return el ? centerOf(el) : null;
  };
  const drawn = (id) => v.created.has(id) || v.edit.has(id);
  const src = (e) =>
    drawn(e.from)
      ? at(`.port.out[data-dout="${e.from}"][data-dch="${e.ch}"]`, draftsEl)
      : outPos(e.from, e.ch);
  const dst = (id) =>
    drawn(id) ? at(`.port.in[data-din="${id}"]`, draftsEl) : at('.port.in', nodeEl(id));
  let h = '';
  for (const e of v.cut) {
    const a = outPos(e.from, e.ch),
      b = at('.port.in', nodeEl(e.to));
    if (a && b)
      h += `<path class="wpath" d="${curve(a, b)}" style="stroke:#f87171;stroke-width:3px;stroke-dasharray:4 6;opacity:.9"/>`;
  }
  for (const e of v.add) {
    const a = src(e),
      b = dst(e.to);
    if (a && b)
      h += `<path class="wpath" d="${curve(a, b)}" style="stroke:#a78bfa;stroke-width:2.5px;stroke-dasharray:8 6;opacity:.85"/>`;
  }
  return h;
}
function draftBtn(card, on) {
  card.classList.toggle('previewing', on);
  const b = card.querySelector('[data-draft]');
  if (b) b.textContent = on ? 'Ocultar do canvas' : 'Ver no canvas';
}
function clearDraft() {
  if (!draft) return;
  draftBtn(draft.card, false);
  draft = null;
  renderNodes();
}
function showDraft(p, card) {
  clearDraft();
  draft = { p, card, plan: proposalPlan(p), t0: performance.now() };
  draftBtn(card, true);
  renderNodes();
  const v = draft.view;
  if (!v.created.size && !v.edit.size && !v.del.size && !v.add.length && !v.cut.length) {
    clearDraft();
    toast('A proposta não muda mais nada na história.', 'err');
    return;
  }
  const first = [...v.created][0];
  if (first) {
    const q = v.after.scenes.get(first);
    focusAt(q.x, q.y);
    return;
  }
  const id = [...v.edit, ...v.del][0] || v.add[0]?.from || v.cut[0]?.from;
  if (id) focusScene(id);
}
// Aceita ou recusada fica guardado neste navegador; sem registro, aceita = a história já tem o que ela propõe.
const PROP_KEY = 'roteiro:proposta:';
const propMark = (key, v) => {
  try {
    localStorage.setItem(PROP_KEY + key, v);
  } catch (_) {}
};
function propStatus(p, key) {
  let v = null;
  try {
    v = localStorage.getItem(PROP_KEY + key);
  } catch (_) {}
  if (v) return v;
  const created = createdOf(p);
  if (!p.created) return created.length ? null : 'ok'; // proposta antiga: só criava cenas, e a cena nova já existe
  if (created.length) return created.some((id) => scene(id)) ? 'ok' : null;
  const f = flatOf(state);
  return diffFlat(f, applyOps(cloneFlat(f), JSON.parse(JSON.stringify(p.ops)))).length
    ? null
    : 'ok';
}
function proposalCard(p, key) {
  const card = document.createElement('div');
  card.className = 'proposal';
  const created = new Set(createdOf(p)),
    nNew = created.size,
    nDel = p.ops.filter((o) => o.op === 'delete_scene').length,
    nEdit = new Set(
      p.ops
        .filter((o) => o.op === 'upsert_scene' && !created.has(o.scene.id))
        .map((o) => o.scene.id),
    ).size;
  const chips = [
    nNew && `+${nNew} cena${nNew > 1 ? 's' : ''}`,
    nEdit && `${nEdit} alterada${nEdit > 1 ? 's' : ''}`,
    nDel && `${nDel} removida${nDel > 1 ? 's' : ''}`,
  ]
    .filter(Boolean)
    .join(' · ');
  const st = propStatus(p, key);
  card.innerHTML = `<h3>${SPARK}proposta${chips ? ' · ' + chips : ''} · 1 passo de desfazer</h3><ul>${p.summary.map((t) => `<li>${esc(t)}</li>`).join('')}</ul><div class="row">${st ? `<span class="hint">${st === 'ok' ? 'Aceita' : 'Recusada'}</span>` : `<button class="btn sm violet solid" data-ok>Aceitar</button><button class="btn sm" data-no>Recusar</button><button class="btn sm" data-draft>Ver no canvas</button>`}</div>`;
  if (st) card.classList.add('done');
  card.querySelector('[data-ok]')?.addEventListener('click', () => {
    if (acceptProposal(p)) {
      propMark(key, 'ok');
      card.classList.add('done');
      card.querySelector('.row').innerHTML =
        '<span class="hint">Aceita · Ctrl+Z desfaz tudo de uma vez</span>';
    }
  });
  card.querySelector('[data-draft]')?.addEventListener('click', () => {
    if (draft && draft.card === card) clearDraft();
    else showDraft(p, card);
  });
  card.querySelector('[data-no]')?.addEventListener('click', () => {
    if (draft && draft.card === card) clearDraft();
    propMark(key, 'no');
    card.classList.add('done');
    card.querySelector('.row').innerHTML = '<span class="hint">Recusada</span>';
  });
  return card;
}
// Mesmas regras do validate do servidor, em palavras; null se o grafo vale.
function graphProblem(f) {
  if (!f.scenes.has(f.start)) return 'a cena inicial seria removida.';
  const outs = new Map([...f.scenes.keys()].map((id) => [id, []]));
  for (const c of f.choices.values()) {
    if (!f.scenes.has(c.sceneId)) return ERRS.NOT_FOUND;
    if (c.target) {
      if (!f.scenes.has(c.target)) return ERRS.NOT_FOUND;
      outs.get(c.sceneId).push(c.target);
    }
  }
  for (const [id, s] of f.scenes) {
    if (s.next) {
      if (choicesOfFlat(f, id).length) return ERRS.BOTH;
      if (!f.scenes.has(s.next)) return ERRS.NOT_FOUND;
      outs.get(id).push(s.next);
    }
    let cast;
    try {
      cast = JSON.parse(s.chars);
    } catch (_) {
      return ERRS.INVALID;
    }
    if (cast.length > MAXCH) return ERRS.TOO_MANY;
    if (new Set(cast.map((x) => x.c)).size !== cast.length) return ERRS.DUP_CHAR;
    if (s.kind === 'dialogue' && !cast.some((x) => x.c === s.speaker)) return ERRS.SPEAKER;
  }
  const color = new Map();
  const visit = (id) => {
    color.set(id, 1);
    for (const n of outs.get(id)) {
      const k = color.get(n) || 0;
      if (k === 1 || (!k && visit(n))) return true;
    }
    color.set(id, 2);
    return false;
  };
  for (const id of outs.keys())
    if (!color.get(id) && visit(id)) return 'as ligações formariam um ciclo.';
  return null;
}
// Aceitar valida contra o estado atual, que pode ter mudado desde a proposta.
// Backgrounds novos que o agente pediu na proposta: gerados com o prompt dele (sem a melhoria do fluxo manual).
// As cenas já apontam para o id; o background aparece no painel como "gerando…" até a imagem chegar.
function genProposalBackgrounds(p) {
  const todo = (p.backgrounds || []).filter((b) => !state.backgrounds.some((x) => x.id === b.id));
  for (const b of todo) {
    conn.reducers
      .generateBackgroundPrompted({
        storyId,
        backgroundId: b.id,
        jobId: uid('j'),
        name: b.name,
        desc: b.desc || '',
        prompt: b.prompt,
        time: b.time || '',
        mood: b.mood || '',
      })
      .then(
        () => freshCards.set(b.id, performance.now()),
        (err) => toast(`Não deu para gerar o background “${b.name}”: ${err?.message || err}`, 'err'),
      );
  }
  if (todo.length)
    toast(todo.length > 1 ? `Gerando ${todo.length} backgrounds` : `Gerando o background “${todo[0].name}”`, 'ai');
}
function acceptProposal(p) {
  const f = flatOf(state);
  // As cenas novas caem onde o rascunho mostrou; sem rascunho na tela, o lugar é calculado agora.
  const plan = draft && draft.p === p ? draft.plan : proposalPlan(p);
  // Alterar uma cena ou ação que alguém apagou recriaria a linha pela metade.
  const made = new Set(plan.created);
  let stale = null;
  for (const o of plan.ops) {
    if (o.op === 'upsert_scene' && !made.has(o.scene.id) && !f.scenes.has(o.scene.id)) {
      stale = 'uma das cenas que ela altera foi apagada.';
      break;
    }
    if (o.op === 'upsert_choice') {
      const c = o.choice;
      if (c.sceneId) {
        made.add(c.id);
        if (!f.scenes.has(c.sceneId) && !made.has(c.sceneId)) {
          stale = 'a cena de origem foi apagada.';
          break;
        }
      } else if (!f.choices.has(c.id) && !made.has(c.id)) {
        stale = 'uma das ações que ela usa foi apagada.';
        break;
      }
    }
  }
  const err = stale || graphProblem(applyOps(cloneFlat(f), plan.ops));
  if (err) {
    toast('A proposta não vale mais: ' + err, 'err');
    return false;
  }
  if (draft && draft.p === p) clearDraft();
  const before = cloneFlat(f);
  pushUndo();
  applyOps(f, plan.ops);
  writeFlat(f);
  genProposalBackgrounds(p);
  const now = performance.now(),
    born = [...plan.created].filter((id) => scene(id)),
    gone = [...before.scenes.keys()].filter((id) => !f.scenes.has(id));
  gone.forEach((id) => {
    selected.delete(id);
    gens.delete(id);
  });
  const changed = [...f.scenes.keys()].filter(
    (id) => before.scenes.has(id) && sceneChanged(before, f, id, new Set(gone)),
  );
  for (const id of [...born, ...changed]) {
    const ns = scene(id);
    ns.ai = true;
    fresh.set(id, { t0: now, cls: 'pop-ai' });
    reveal.set(id, now);
    setTimeout(() => reveal.delete(id), 1700);
    setTimeout(() => {
      const t = scene(id);
      if (t) {
        t.ai = false;
        refresh();
      }
    }, 2600);
  }
  refresh();
  const first = born[0] || changed[0];
  if (first) {
    ensureVisible(first);
    const n = scene(first);
    burst(n.x, n.y + 20, 'ai');
    shake();
  }
  if (gone.length)
    toast(gone.length > 1 ? `${gone.length} cenas removidas` : 'Cena removida', 'ai');
  return true;
}
// Conversa anterior para a IA, mais antiga primeiro, com cada proposta resumida e o que o usuário decidiu.
const PROP_STATE = { ok: 'aceita', no: 'recusada' };
function chatHistory() {
  return [...conn.db.myChatMessage.iter()]
    .sort(
      (a, b) =>
        Number(a.createdAt.microsSinceUnixEpoch - b.createdAt.microsSinceUnixEpoch) ||
        (a.role === 'user' ? -1 : 1),
    )
    .map((r) => {
      let content = r.content;
      let props = [];
      try {
        props = JSON.parse(r.proposals);
      } catch (_) {}
      props.forEach((p, i) => {
        content +=
          `\n\n[Proposta ${i + 1}, ${PROP_STATE[propStatus(p, r.id + ':' + i)] || 'pendente: o usuário ainda não decidiu'}]\n` +
          p.summary.map((l) => '- ' + l).join('\n');
      });
      return { role: r.role === 'user' ? 'user' : 'assistant', content };
    });
}
$('#chatForm').onsubmit = (e) => {
  e.preventDefault();
  const t = $('#chatInput').value.trim();
  if (!t) return;
  if (!connected) {
    toast('Sem conexão com o servidor.', 'err');
    return;
  }
  const btn = $('#chatForm button[type=submit]');
  btn.disabled = true;
  requestAi('chat', { message: t, context: aiContext(), history: chatHistory() })
    .then(
      () => {
        $('#chatInput').value = '';
      },
      (err) => toast('A IA não recebeu o pedido: ' + aiMessage(err), 'err'),
    )
    .finally(() => {
      btn.disabled = false;
    });
};
$('#chatClear').onclick = () => {
  if (!connected) {
    toast('Sem conexão com o servidor.', 'err');
    return;
  }
  if (!confirm('Limpar a conversa com o assistente? As propostas ainda não aceitas somem.')) return;
  conn.reducers.clearChat({}).then(
    () => {
      for (const j of conn.db.myAiJob.iter())
        if (j.kind === 'chat' && (j.status === 'pending' || j.status === 'running'))
          chatDropped.add(j.id);
      clearDraft();
      resetChat();
    },
    (err) => toast('Não foi possível limpar o chat: ' + aiMessage(err), 'err'),
  );
};
$('#chatInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    $('#chatForm').requestSubmit();
  }
});

/* ---------- play mode ---------- */
let play = null;
function openPlay(from) {
  const st = from || state.start;
  if (!scene(st)) {
    toast('Defina uma cena inicial.', 'err');
    return;
  }
  const el = document.createElement('div');
  el.className = 'play';
  document.body.appendChild(el);
  play = { el, cur: st, hist: [], from: st };
  drawPlay();
}
function closePlay() {
  if (play) {
    clearInterval(play.iv);
    play.el.remove();
    play = null;
  }
}
function go(t) {
  if (!t) {
    toast('Esta ação não tem destino (rascunho). No player público ela fica oculta.', 'err');
    return;
  }
  play.hist.push(play.cur);
  play.cur = t;
  drawPlay();
}
function drawPlay() {
  clearInterval(play.iv);
  const s = scene(play.cur);
  const bg = bgById(s.bg);
  const dlg = s.kind === 'dialogue' && s.speaker;
  const chars = s.chars
    .map((cc, i) => {
      const c = charById(cc.c),
        sp = spriteOf(c, cc.s),
        p = posOf(s, i);
      return sp
        ? `<img class="schar${dlg && cc.c !== s.speaker ? ' dim' : ''}" style="left:${p.x}%;bottom:${-p.y}%;height:${(SPRITE_H * 100 * p.k).toFixed(1)}%;animation-delay:${i * 90}ms" src="${sp.img}" alt="${esc(c.name)} (${esc(sp.name)})">`
        : '';
    })
    .join('');
  const spk = s.kind === 'dialogue' ? charById(s.speaker) : null;
  const box = s.text
    ? spk
      ? `<div class="tbox dialogue"><div class="nametag" style="color:${spk.color || 'var(--text)'}">${esc(spk.name)}</div><span data-t></span><span class="tcaret"></span></div>`
      : `<div class="tbox narration"><span><span data-t></span><span class="tcaret"></span></span></div>`
    : '';
  play.el.innerHTML = `<div class="phead"><span>${esc(state.title)} · ${esc(s.title)}</span><span class="grow"></span><button class="pbtn" data-back ${play.hist.length ? '' : 'disabled'}>Voltar</button><button class="pbtn" data-restart>Reiniciar</button><button class="pbtn" data-exit>Voltar ao editor</button></div><div class="stage"><div class="pic">${bg ? `<img class="bgimg" src="${bg.img}" alt="${esc(bg.name)}">` : ''}${chars}</div>${box}<div data-after></div></div>`;
  const after = () => {
    const host = play.el.querySelector('[data-after]');
    const cr = play.el.querySelector('.tcaret');
    if (cr) cr.remove();
    let h = '';
    if (s.choices.length)
      h = `<div class="pchoices">${s.choices.map((c, i) => `<button class="pchoice" data-go="${c.target || ''}" ${c.target ? '' : 'title="Ação sem destino"'} style="animation-delay:${i * 80}ms"><span class="pnum">${i + 1}</span>${esc(c.label || '(ação sem texto)')}${c.target ? '' : ' <span class="mono" style="color:#ffc98a;font-size:12px">· sem destino</span>'}</button>`).join('')}</div>`;
    else if (s.next)
      h = `<div class="pcont"><button class="pbtn" data-go="${s.next}" style="background:rgba(28,29,33,.94)">Continuar ▸</button></div>`;
    else
      h = `<div class="pend"><div><span>— fim —</span><button class="btn primary" data-restart>Recomeçar</button></div></div>`;
    host.innerHTML = h;
  };
  const tEl = play.el.querySelector('[data-t]');
  if (tEl && !reduced) {
    let i = 0;
    const full = s.text;
    play.skip = () => {
      clearInterval(play.iv);
      tEl.textContent = full;
      play.skip = null;
      after();
    };
    play.iv = setInterval(() => {
      i += 2;
      tEl.textContent = full.slice(0, i);
      if (i >= full.length) play.skip();
    }, 22);
  } else {
    if (tEl) tEl.textContent = s.text;
    play.skip = null;
    after();
  }
  play.el.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) {
      if (play.skip && e.target.closest('.stage')) play.skip();
      return;
    }
    if (b.hasAttribute('data-go')) go(b.dataset.go);
    else if (b.hasAttribute('data-back')) {
      play.cur = play.hist.pop();
      drawPlay();
    } else if (b.hasAttribute('data-restart')) {
      play.hist = [];
      play.cur = play.from;
      drawPlay();
    } else if (b.hasAttribute('data-exit')) closePlay();
  };
}

/* ---------- tempo real (SpacetimeDB) ----------
   O grafo local é sempre: servidor ⊕ lotes em voo ⊕ edições ainda não enviadas.
   `base` = servidor ⊕ lotes em voo; o que o usuário mudou é diff(base, local).
   A história aberta (open_story) define o que as views cur_* trazem; uma conta tem uma
   história aberta por vez, então a aba que ganha o foco reabre a sua (reclaim).
   Personagens e backgrounds ficam só no cliente neste spike. */
const STDB_URI = import.meta.env.VITE_STDB_URI || 'ws://localhost:3000';
const STDB_DB = import.meta.env.VITE_STDB_DB || 'roteiro-spike';
// Identidade anônima por aba, sem login (só com o módulo local publicado com AUTH_DEV_ANON=1).
const DEV_ANON = import.meta.env.VITE_AUTH_DEV_ANON === '1';
const TOKEN_KEY = 'stdb-token:' + STDB_URI + '/' + STDB_DB; // o token de um servidor não vale em outro
const WHERE = /localhost|127\.0\.0\.1/.test(STDB_URI) ? 'local' : 'Maincloud';
let conn = null,
  myId = null,
  myConn = null,
  connected = false,
  ready = false,
  resetting = false,
  subsReady = false;
let storyId = '',
  myRole = '',
  dragSub = null;
let base = null;
const inflight = [];
let retryOps = [];
const errMsg = (err) => String((err && err.message) || err).slice(0, 160);
// As views ainda mostram esta história (outra aba da mesma conta pode ter aberto outra).
const viewsMine = () => !!(conn && storyId && conn.db.curStory.id.find(storyId));

// Elenco: chars (character), sprites e bgs (background). Só os campos que o autor edita; status,
// error e sheetId vêm direto das linhas do servidor em writeFlat.
const emptyFlat = () => ({
  title: '',
  start: '',
  scenes: new Map(),
  choices: new Map(),
  chars: new Map(),
  sprites: new Map(),
  bgs: new Map(),
});
const cloneMap = (m) => new Map([...m].map(([k, v]) => [k, { ...v }]));
const cloneFlat = (f) => ({
  title: f.title,
  start: f.start,
  scenes: cloneMap(f.scenes),
  choices: cloneMap(f.choices),
  chars: cloneMap(f.chars),
  sprites: cloneMap(f.sprites),
  bgs: cloneMap(f.bgs),
});
function flatOf(st) {
  const f = emptyFlat();
  f.title = st.title;
  f.start = st.start || '';
  for (const s of st.scenes) {
    f.scenes.set(s.id, {
      title: s.title,
      x: Math.round(s.x),
      y: Math.round(s.y),
      bg: s.bg || '',
      chars: JSON.stringify(
        s.chars.map((x) => {
          const o = x.x != null ? { c: x.c, s: x.s, x: x.x, y: x.y || 0 } : { c: x.c, s: x.s };
          if (x.k && x.k !== 1) o.k = clampK(x.k);
          return o;
        }),
      ),
      kind: s.kind,
      speaker: s.speaker || '',
      text: s.text,
      next: s.next || '',
      ai: gens.has(s.id) ? 'generating' : s.aiStatus === 'failed' && s.text ? '' : s.aiStatus || '',
    });
    s.choices.forEach((c, i) =>
      f.choices.set(c.id, { sceneId: s.id, label: c.label, target: c.target || '', position: i }),
    );
  }
  for (const c of st.characters || []) {
    f.chars.set(c.id, {
      name: c.name,
      desc: c.desc || '',
      color: c.color || '',
      source: c.source || 'upload',
    });
    c.sprites.forEach((p, i) =>
      f.sprites.set(p.id, {
        characterId: c.id,
        name: p.name,
        desc: p.desc || '',
        imageKey: p.imageKey || '',
        position: i,
      }),
    );
  }
  for (const b of st.backgrounds || [])
    f.bgs.set(b.id, {
      name: b.name,
      desc: b.desc || '',
      imageKey: b.imageKey || '',
      source: b.source || 'upload',
    });
  return f;
}
function flatServer() {
  const f = emptyFlat();
  const st = conn.db.curStory.id.find(storyId);
  if (st) {
    f.title = st.title;
    f.start = st.startScene;
  }
  for (const r of conn.db.curScene.iter())
    f.scenes.set(r.id, {
      title: r.title,
      x: r.x,
      y: r.y,
      bg: r.bg,
      chars: r.chars,
      kind: r.kind,
      speaker: r.speaker,
      text: r.text,
      next: r.next,
      ai: r.ai,
    });
  for (const r of conn.db.curChoice.iter())
    f.choices.set(r.id, {
      sceneId: r.sceneId,
      label: r.label,
      target: r.target,
      position: r.position,
    });
  const byTime = (a, b) =>
    Number(a.createdAt.microsSinceUnixEpoch - b.createdAt.microsSinceUnixEpoch) ||
    (a.id < b.id ? -1 : 1);
  for (const r of [...conn.db.curCharacter.iter()].sort(byTime))
    f.chars.set(r.id, { name: r.name, desc: r.desc, color: r.color, source: r.source });
  for (const r of [...conn.db.curSprite.iter()].sort(
    (a, b) => a.position - b.position || (a.id < b.id ? -1 : 1),
  ))
    f.sprites.set(r.id, {
      characterId: r.characterId,
      name: r.name,
      desc: r.desc,
      imageKey: r.imageKey,
      position: r.position,
    });
  for (const r of [...conn.db.curBackground.iter()].sort(byTime))
    f.bgs.set(r.id, { name: r.name, desc: r.desc, imageKey: r.imageKey, source: r.source });
  return f;
}
// Mesma semântica do reducer: valores finais, campos parciais, seguro de repetir.
function applyOps(f, ops) {
  for (const o of ops) {
    if (o.op === 'upsert_scene') {
      const { id, ...rest } = o.scene;
      f.scenes.set(id, {
        ...(f.scenes.get(id) || {
          title: 'Nova cena',
          x: 0,
          y: 0,
          bg: '',
          chars: '[]',
          kind: 'narration',
          speaker: '',
          text: '',
          next: '',
          ai: '',
        }),
        ...rest,
      });
    } else if (o.op === 'delete_scene') {
      if (!f.scenes.has(o.id)) continue;
      f.scenes.delete(o.id);
      for (const [k, c] of f.choices) {
        if (c.sceneId === o.id) f.choices.delete(k);
        else if (c.target === o.id) f.choices.set(k, { ...c, target: '' });
      }
      for (const [k, s] of f.scenes) if (s.next === o.id) f.scenes.set(k, { ...s, next: '' });
    } else if (o.op === 'upsert_choice') {
      const { id, ...rest } = o.choice;
      f.choices.set(id, {
        ...(f.choices.get(id) || { sceneId: '', label: '', target: '', position: 0 }),
        ...rest,
      });
    } else if (o.op === 'delete_choice') f.choices.delete(o.id);
    else if (o.op === 'set_start') f.start = o.id;
    else if (o.op === 'set_title') f.title = o.title;
    else if (o.op === 'upsert_character') {
      const { id, ...rest } = o.character;
      f.chars.set(id, {
        ...(f.chars.get(id) || { name: 'Novo personagem', desc: '', color: '', source: 'upload' }),
        ...rest,
      });
    } else if (o.op === 'delete_character') {
      f.chars.delete(o.id);
      for (const [k, p] of f.sprites) if (p.characterId === o.id) f.sprites.delete(k);
    } else if (o.op === 'upsert_sprite') {
      const { id, ...rest } = o.sprite;
      f.sprites.set(id, {
        ...(f.sprites.get(id) || {
          characterId: '',
          name: 'Nova emoção',
          desc: '',
          imageKey: '',
          position: 0,
        }),
        ...rest,
      });
    } else if (o.op === 'delete_sprite') f.sprites.delete(o.id);
    else if (o.op === 'upsert_background') {
      const { id, ...rest } = o.background;
      f.bgs.set(id, {
        ...(f.bgs.get(id) || { name: 'Background', desc: '', imageKey: '', source: 'upload' }),
        ...rest,
      });
    } else if (o.op === 'delete_background') f.bgs.delete(o.id);
  }
  return f;
}
function diffFlat(a, b, skipPos) {
  const ups = [],
    cups = [],
    cdel = [],
    sdel = [],
    meta = [];
  for (const [id, s] of b.scenes) {
    const o = a.scenes.get(id);
    if (!o) {
      ups.push({ op: 'upsert_scene', scene: { id, ...s } });
      continue;
    }
    const ch = {};
    for (const k in s) {
      if (skipPos && skipPos.has(id) && (k === 'x' || k === 'y')) continue;
      if (s[k] !== o[k]) ch[k] = s[k];
    }
    if (Object.keys(ch).length) ups.push({ op: 'upsert_scene', scene: { id, ...ch } });
  }
  for (const [id, c] of b.choices) {
    const o = a.choices.get(id);
    if (!o) {
      cups.push({ op: 'upsert_choice', choice: { id, ...c } });
      continue;
    }
    const ch = {};
    for (const k in c) if (c[k] !== o[k]) ch[k] = c[k];
    if (Object.keys(ch).length) cups.push({ op: 'upsert_choice', choice: { id, ...ch } });
  }
  for (const [id, c] of a.choices)
    if (!b.choices.has(id) && b.scenes.has(c.sceneId)) cdel.push({ op: 'delete_choice', id });
  for (const id of a.scenes.keys()) if (!b.scenes.has(id)) sdel.push({ op: 'delete_scene', id });
  if (b.start && a.start !== b.start) meta.push({ op: 'set_start', id: b.start });
  if (a.title !== b.title) meta.push({ op: 'set_title', title: b.title });
  // Elenco antes das cenas (uma cena nova usa um personagem novo) e as exclusões dele no fim
  // (o servidor recusa apagar o que uma cena ainda usa).
  const kups = [],
    kdel = [];
  const upsMap = (am, bm, op, key) => {
    for (const [id, v] of bm) {
      const o = am.get(id);
      if (!o) {
        kups.push({ op, [key]: { id, ...v } });
        continue;
      }
      const ch = {};
      for (const k in v) if (v[k] !== o[k]) ch[k] = v[k];
      if (Object.keys(ch).length) kups.push({ op, [key]: { id, ...ch } });
    }
  };
  upsMap(a.chars, b.chars, 'upsert_character', 'character');
  upsMap(a.sprites, b.sprites, 'upsert_sprite', 'sprite');
  upsMap(a.bgs, b.bgs, 'upsert_background', 'background');
  for (const [id, p] of a.sprites)
    if (!b.sprites.has(id) && b.chars.has(p.characterId)) kdel.push({ op: 'delete_sprite', id });
  for (const id of a.chars.keys()) if (!b.chars.has(id)) kdel.push({ op: 'delete_character', id });
  for (const id of a.bgs.keys()) if (!b.bgs.has(id)) kdel.push({ op: 'delete_background', id });
  return [...kups, ...ups, ...cups, ...cdel, ...meta, ...sdel, ...kdel];
}
function touchKeys(o, f) {
  if (o.op === 'upsert_scene') return ['s:' + o.scene.id];
  if (o.op === 'upsert_character') return ['k:' + o.character.id];
  if (o.op === 'upsert_sprite') return ['p:' + o.sprite.id];
  if (o.op === 'upsert_background') return ['g:' + o.background.id];
  if (o.op === 'delete_character')
    return [
      'k:' + o.id,
      ...[...f.sprites].filter(([, p]) => p.characterId === o.id).map(([k]) => 'p:' + k),
    ];
  if (o.op === 'delete_sprite') return ['p:' + o.id];
  if (o.op === 'delete_background') return ['g:' + o.id];
  if (o.op === 'upsert_choice') return ['c:' + o.choice.id];
  if (o.op === 'delete_choice') return ['c:' + o.id];
  if (o.op === 'delete_scene')
    return [
      's:' + o.id,
      ...[...f.choices].filter(([, c]) => c.sceneId === o.id).map(([k]) => 'c:' + k),
    ];
  return [o.op === 'set_title' ? 'title' : 'start'];
}
// Escreve um grafo no estado do demo sem trocar os objetos (arrasto, IA e menus guardam referências).
function writeFlat(f) {
  state.title = f.title;
  state.start = f.start;
  const per = new Map();
  for (const [id, c] of f.choices) {
    if (!per.has(c.sceneId)) per.set(c.sceneId, []);
    per.get(c.sceneId).push([id, c]);
  }
  const byId = new Map(state.scenes.map((s) => [s.id, s]));
  const order = [
    ...state.scenes.map((s) => s.id).filter((id) => f.scenes.has(id)),
    ...[...f.scenes.keys()].filter((id) => !byId.has(id)),
  ];
  state.scenes = order.map((id) => {
    const v = f.scenes.get(id);
    let s = byId.get(id);
    if (!s) {
      s = { id, choices: [], next: null };
      if (ready)
        fresh.set(id, { t0: performance.now(), cls: v.ai === 'generating' ? 'pop-ai' : 'pop' });
    }
    Object.assign(s, {
      title: v.title,
      x: v.x,
      y: v.y,
      bg: v.bg || null,
      kind: v.kind,
      speaker: v.speaker || null,
      text: v.text,
      next: v.next || null,
    });
    try {
      s.chars = JSON.parse(v.chars);
    } catch (_) {
      s.chars = [];
    }
    if (!gens.has(id)) s.aiStatus = v.ai;
    const old = new Map(s.choices.map((c) => [c.id, c]));
    s.choices = (per.get(id) || [])
      .sort((a, b) => a[1].position - b[1].position)
      .map(([cid, c]) => {
        const o = old.get(cid) || { id: cid };
        if (!o.gen) o.label = c.label;
        o.target = c.target || null;
        return o;
      });
    return s;
  });
  writeCast(f);
}
// Elenco a partir do grafo plano, mantendo os objetos (cartões abertos e campos em edição apontam para eles).
// Estado da geração (status, error, sheetId, meta) vem das linhas do servidor.
function writeCast(f) {
  const row = (t, id) => (conn ? conn.db[t].id.find(id) : null);
  const oldC = new Map(state.characters.map((c) => [c.id, c])),
    oldS = new Map(state.characters.flatMap((c) => c.sprites).map((p) => [p.id, p])),
    oldB = new Map(state.backgrounds.map((b) => [b.id, b]));
  const per = new Map();
  for (const [id, p] of f.sprites) {
    if (!per.has(p.characterId)) per.set(p.characterId, []);
    per.get(p.characterId).push([id, p]);
  }
  state.characters = [...f.chars].map(([id, v]) => {
    const c = oldC.get(id) || { id, sprites: [] };
    const r = row('curCharacter', id);
    Object.assign(c, v, {
      status: r?.status || '',
      error: r?.error || '',
      sheetId: r?.sheetId || '',
    });
    c.sprites = (per.get(id) || [])
      .sort((a, b) => a[1].position - b[1].position)
      .map(([sid, pv]) => {
        const p = oldS.get(sid) || { id: sid };
        const pr = row('curSprite', sid);
        Object.assign(p, {
          name: pv.name,
          desc: pv.desc,
          imageKey: pv.imageKey,
          img: imgUrl(pv.imageKey),
          status: pr?.status || '',
          error: pr?.error || '',
        });
        return p;
      });
    return c;
  });
  state.backgrounds = [...f.bgs].map(([id, v]) => {
    const b = oldB.get(id) || { id };
    const r = row('curBackground', id);
    Object.assign(b, v, {
      img: imgUrl(v.imageKey),
      status: r?.status || '',
      error: r?.error || '',
      prompt: r?.prompt || '',
    });
    return b;
  });
}

/* envio */
let syncQueued = false,
  syncTimer = 0,
  roAt = 0;
function scheduleSync() {
  if (syncQueued) return;
  syncQueued = true;
  queueMicrotask(() => {
    syncQueued = false;
    syncNow();
  });
}
function syncSoon() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncNow, 800);
}
function syncNow() {
  if (!base || !connected || resetting || !viewsMine()) return;
  const skip = drag && drag.type === 'move' ? new Set(drag.orig.map((o) => o.s.id)) : null;
  const ops = diffFlat(base, flatOf(state), skip);
  if (!ops.length) return;
  // Leitor: a edição local volta ao estado do servidor.
  if (myRole === 'viewer') {
    writeFlat(cloneFlat(base));
    renderNodes();
    const n = Date.now();
    if (n - roAt > 4000) {
      roAt = n;
      toast('Você tem acesso só de leitura a esta história.', 'err');
    }
    return;
  }
  const touched = typingTouched || collector;
  for (const o of ops) touchKeys(o, base).forEach((k) => touched.add(k));
  applyOps(base, ops);
  const b = { ops, t0: performance.now() };
  inflight.push(b);
  renderNet();
  conn.reducers.applyOperations({ storyId, ops: JSON.stringify(ops) }).then(
    () => {
      rtt.add('op', performance.now() - b.t0);
      settle(b);
    },
    (err) => {
      settle(b);
      rejected(err, ops);
    },
  );
}
function settle(b) {
  const i = inflight.indexOf(b);
  if (i >= 0) inflight.splice(i, 1);
  renderNet();
  scheduleRebuild();
}
const ERRS = {
  CYCLE: 'Essa ligação fecharia um ciclo. Alguém pode ter criado o outro fio agora há pouco.',
  LOCKED: 'Outra pessoa está escrevendo nesse campo.',
  START: 'A cena inicial não pode ser excluída.',
  NO_START: 'A história ficaria sem cena inicial.',
  BOTH: 'Uma cena não pode ter ações e saída única ao mesmo tempo.',
  NOT_FOUND: 'Essa cena foi apagada por outra pessoa.',
  TOO_MANY: 'Uma cena tem no máximo 6 personagens.',
  DUP_CHAR: 'Esse personagem já está na cena.',
  SPEAKER: 'Quem fala precisa estar na cena.',
  INVALID: 'Alteração inválida.',
  FORBIDDEN: 'Você não tem permissão para essa alteração.',
  USED: 'Esse item do elenco ainda aparece em uma cena (talvez alguém acabou de usá-lo).',
};
function rejected(err, ops) {
  const m = errMsg(err);
  const code =
    m.match(
      /\b(CYCLE|LOCKED|START|NO_START|BOTH|NOT_FOUND|TOO_MANY|DUP_CHAR|SPEAKER|INVALID|FORBIDDEN|USED)\b(?::\d+(?::([\w-]+))?)?/,
    ) || [];
  if (code[1]) {
    toast('Recusado pelo servidor: ' + ERRS[code[1]], 'err');
    if (code[2] && scene(code[2])) nodeShake(code[2]);
    else shake();
    return;
  }
  // Queda de conexão: o lote pode ou não ter sido aplicado; como é seguro repetir, reenviamos depois.
  retryOps.push(ops);
  toast('Sem conexão — a alteração será reenviada ao reconectar.', 'err');
}

/* recebimento */
let rebuildQueued = false;
// setTimeout, não requestAnimationFrame: abas em segundo plano não recebem frames e ficariam desatualizadas.
function scheduleRebuild() {
  if (rebuildQueued) return;
  rebuildQueued = true;
  setTimeout(() => {
    rebuildQueued = false;
    rebuild();
  }, 0);
}
function rebuild() {
  if (!conn || !ready || !viewsMine()) return;
  const srv = flatServer();
  const unsent = base && !resetting ? diffFlat(base, flatOf(state), null) : [];
  for (const b of inflight) applyOps(srv, b.ops);
  const local = cloneFlat(srv);
  for (const ops of retryOps) applyOps(local, ops);
  applyOps(local, unsent);
  const hadRetry = retryOps.length > 0;
  retryOps = [];
  base = srv;
  writeFlat(local);
  renderNodes();
  renderRailSoon();
  migrateLegacyCast();
  if (document.activeElement !== $('#storyTitle')) $('#storyTitle').value = state.title;
  if (hadRetry && connected) scheduleSync();
}

// O exemplo vira operações com ids novos: ids de cena e ação são globais no banco.
// O elenco também: ids de personagem, sprite e background são globais.
function exampleGraph() {
  const ops = diffFlat(emptyFlat(), flatOf(SEED), null).filter(
    (o) => o.op !== 'set_title' && o.op !== 'set_start',
  );
  const ids = new Map();
  const re = (id, p) => {
    if (!id) return id;
    if (!ids.has(id)) ids.set(id, uid(p));
    return ids.get(id);
  };
  for (const o of ops) {
    if (o.op === 'upsert_scene') {
      o.scene.id = re(o.scene.id, 's');
      o.scene.next = re(o.scene.next, 's');
      o.scene.bg = re(o.scene.bg, 'b');
      o.scene.speaker = re(o.scene.speaker, 'c');
      o.scene.chars = JSON.stringify(
        JSON.parse(o.scene.chars).map((x) => ({ c: re(x.c, 'c'), s: re(x.s, 'sp') })),
      );
    } else if (o.op === 'upsert_choice') {
      o.choice.id = re(o.choice.id, 'c');
      o.choice.sceneId = re(o.choice.sceneId, 's');
      o.choice.target = re(o.choice.target, 's');
    } else if (o.op === 'upsert_character') o.character.id = re(o.character.id, 'c');
    else if (o.op === 'upsert_sprite') {
      o.sprite.id = re(o.sprite.id, 'sp');
      o.sprite.characterId = re(o.sprite.characterId, 'c');
    } else if (o.op === 'upsert_background') o.background.id = re(o.background.id, 'b');
  }
  return { ops, start: re(SEED.start, 's') };
}
// Histórias de antes do elenco em tabelas apontam para os ids fixos do elenco de exemplo (c1, sp2…),
// que ficava só no navegador. Ao abrir uma delas sem elenco no banco, quem edita grava o elenco de
// exemplo com ids próprios da história (iguais em todos os navegadores: duas abas não duplicam) e
// as cenas passam a apontar para eles.
const migrated = new Set();
function migrateLegacyCast() {
  if (!connected || !storyId || migrated.has(storyId) || myRole === 'viewer' || !myRole) return;
  if (conn.db.curCharacter.count() > 0 || conn.db.curBackground.count() > 0) return;
  const seedIds = new Set([
    ...SEED.characters.flatMap((c) => [c.id, ...c.sprites.map((p) => p.id)]),
    ...SEED.backgrounds.map((b) => b.id),
  ]);
  const rows = [...conn.db.curScene.iter()];
  const uses = (s) =>
    seedIds.has(s.bg) ||
    seedIds.has(s.speaker) ||
    castOf(s).some((x) => seedIds.has(x.c) || seedIds.has(x.s));
  if (!rows.some(uses)) return;
  migrated.add(storyId);
  const re = (id) => (seedIds.has(id) ? `${id}-${storyId}`.slice(0, 64) : id);
  const cast = diffFlat(
    emptyFlat(),
    flatOf({
      title: '',
      start: '',
      scenes: [],
      characters: SEED.characters,
      backgrounds: SEED.backgrounds,
    }),
    null,
  );
  for (const o of cast) {
    if (o.character) o.character.id = re(o.character.id);
    if (o.sprite) {
      o.sprite.id = re(o.sprite.id);
      o.sprite.characterId = re(o.sprite.characterId);
    }
    if (o.background) o.background.id = re(o.background.id);
  }
  const scenes = rows.filter(uses).map((s) => ({
    op: 'upsert_scene',
    scene: {
      id: s.id,
      bg: re(s.bg),
      speaker: re(s.speaker),
      chars: JSON.stringify(castOf(s).map((x) => ({ c: re(x.c), s: re(x.s) }))),
    },
  }));
  conn.reducers.applyOperations({ storyId, ops: JSON.stringify([...cast, ...scenes]) }).then(
    () => toast('O elenco desta história agora fica salvo no servidor.'),
    (err) => {
      migrated.delete(storyId);
      console.warn('migração do elenco', errMsg(err));
    },
  );
}
const castOf = (s) => {
  try {
    const a = JSON.parse(s.chars);
    return Array.isArray(a) ? a : [];
  } catch (_) {
    return [];
  }
};
function resetExample() {
  if (!conn || !connected || !storyId) return;
  resetting = true;
  undoS.length = 0;
  redoS.length = 0;
  syncUndo();
  gens.clear();
  lit.clear();
  const { ops, start } = exampleGraph();
  const t0 = performance.now();
  conn.reducers
    .resetStory({ storyId, title: SEED.title, startScene: start, ops: JSON.stringify(ops) })
    .then(
      () => {
        rtt.add('op', performance.now() - t0);
        resetting = false;
        base = null;
        state.scenes = [];
        rebuild();
        requestAnimationFrame(fitView);
        toast('História de exemplo restaurada');
      },
      (err) => {
        resetting = false;
        toast('Falha ao reiniciar: ' + errMsg(err), 'err');
      },
    );
}

/* latência */
const rtt = {
  op: [],
  ping: [],
  add(k, v) {
    const a = this[k];
    a.push(v);
    if (a.length > 200) a.shift();
    renderNet();
  },
};
const pct = (a, p) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]);
};
setInterval(() => {
  if (!connected) return;
  const t0 = performance.now();
  conn.reducers.ping({}).then(
    () => rtt.add('ping', performance.now() - t0),
    () => {},
  );
}, 2000);

/* presença, cursores e arrasto ao vivo */
const hex = (id) => id.toHexString();
function profOf(identity) {
  const p = conn && conn.db.curProfile.identity.find(identity);
  return p ? { name: p.name, color: p.color } : { name: 'Alguém', color: '#9aa0aa' };
}
const isMine = (cid) => myConn && cid.isEqual(myConn);
function lockOf(target) {
  if (!conn) return null;
  for (const l of conn.db.curLocks.iter())
    if (l.target === target) return isMine(l.connectionId) ? null : profOf(l.identity);
  return null;
}
function lockBadge(p) {
  return `<div class="lockbadge" style="--lc:${p.color}" role="status"><span class="ldot"></span>${esc(p.name)} está escrevendo…</div>`;
}

let lastDrag = 0;
function sendDrag(orig, done) {
  if (!connected) return;
  const now = performance.now();
  if (!done && now - lastDrag < 50) return;
  lastDrag = now;
  conn.reducers
    .sendDrag({ moves: JSON.stringify(orig.map((o) => [o.s.id, o.s.x, o.s.y])), done })
    .catch(() => {});
}
/* Personagem sendo arrastado: vai na mesma tabela drags, como ['@char', json, 0] (clientes antigos
   não acham a cena '@char' e ignoram). Sobre um palco, a posição vai em % do quadro; fora, em
   coordenadas do mundo, para cada um ver no lugar certo com o seu zoom e a sua câmera. */
let lastCharSend = 0,
  lastCharMsg = '';
function sendCharDrag(d, done, cancel) {
  if (!connected) return;
  const now = performance.now();
  if (!done && now - lastCharSend < 50) return;
  const st = d.over && d.ok && stageEl(d.over);
  let pos = null;
  if (st) {
    const r = frameRect(st),
      q = d.snap && !d.alt ? d.snap : rawPos(d, r, r.height * SPRITE_H * dk(d));
    pos = {
      x: clampX(q.x),
      y: clampY(q.y, dk(d)),
      k: dk(d),
    };
  }
  const w = toWorld(d.px + d.ox * d.h, d.py + d.oy * d.h); // do ponteiro: d.ax/ay só andam com o rAF
  const p = {
    c: d.src.c,
    s: d.src.s,
    sid: d.src.sid || '',
    over: pos ? d.over : '',
    x: pos ? pos.x : 0,
    y: pos ? pos.y : 0,
    k: pos ? pos.k : 1,
    wx: Math.round(w.x),
    wy: Math.round(w.y),
    wh: Math.round(d.h / view.z),
    drop: done && !cancel && !!pos,
  };
  const msg = JSON.stringify([['@char', JSON.stringify(p), 0]]);
  // parado: só um sinal de vida por segundo (o outro lado solta o fantasma após 2,5 s sem notícia)
  if (!done && msg === lastCharMsg && now - lastCharSend < 1000) return;
  lastCharSend = now;
  lastCharMsg = msg;
  conn.reducers.sendDrag({ moves: msg, done }).catch(() => {});
}
function onRemoteChar(row, raw, prof, now) {
  let p;
  try {
    p = JSON.parse(raw);
  } catch (_) {
    return;
  }
  const c = charById(p.c),
    sp = c && spriteOf(c, p.s);
  if (!sp || !sp.img) return;
  const key = row.connectionId.toHexString();
  let g = remoteChars.get(key);
  if (!g) {
    const el = document.createElement('div');
    el.className = 'rghost';
    el.style.setProperty('--rc', prof.color);
    el.innerHTML = `<img alt="" draggable="false"><span></span>`;
    document.body.appendChild(el);
    g = { el, img: el.querySelector('img'), x: null, y: null, h: null, p };
    remoteChars.set(key, g);
    if (p.sid) renderNodes();
  }
  if (g.img.getAttribute('src') !== sp.img) g.img.src = sp.img;
  g.el.querySelector('span').textContent = prof.name;
  const wasDone = g.done;
  g.p = p;
  g.seen = now;
  g.done = row.done;
  if (row.done && !wasDone) {
    g.doneAt = now;
    if (p.sid) renderNodes();
  }
}
// Alvo em pixels de tela, recalculado a cada quadro (o palco pode mudar com zoom, pan ou re-render).
function remoteCharTarget(p) {
  const st = p.over && stageEl(p.over);
  if (st) {
    const r = frameRect(st);
    return {
      x: r.left + (p.x / 100) * r.width,
      y: r.bottom + (p.y / 100) * r.height,
      h: r.height * SPRITE_H * (p.k || 1),
    };
  }
  const cr = canvas.getBoundingClientRect();
  return {
    x: cr.left + view.x + p.wx * view.z,
    y: cr.top + view.y + p.wy * view.z,
    h: p.wh * view.z,
  };
}
function stepRemoteChars(now, k) {
  for (const [key, g] of remoteChars) {
    if (now - g.seen > 2500 || (g.done && now - g.doneAt > (g.p.drop ? 320 : 260))) {
      g.el.remove();
      remoteChars.delete(key);
      if (!g.done && g.p.sid) renderNodes();
      continue;
    }
    const tg = remoteCharTarget(g.p);
    if (g.x == null) {
      g.x = tg.x;
      g.y = tg.y;
      g.h = tg.h;
    }
    const kk = g.done ? Math.max(k, 0.35) : k;
    g.x += (tg.x - g.x) * kk;
    g.y += (tg.y - g.y) * kk;
    g.h += (tg.h - g.h) * kk;
    const ar = g.img.naturalWidth ? g.img.naturalWidth / g.img.naturalHeight : 2 / 3;
    g.img.style.height = g.h + 'px';
    g.el.style.transform = `translate(${(g.x - (g.h * ar) / 2).toFixed(1)}px,${(g.y - g.h).toFixed(1)}px)`;
    // soltou fora de um palco: some; soltou num palco: a cena sincronizada mostra o sprite de verdade
    g.el.classList.toggle('out', !!g.done);
  }
}
function onRemoteDrag(row) {
  if (isMine(row.connectionId) || row.storyId !== storyId) return;
  let moves;
  try {
    moves = JSON.parse(row.moves);
  } catch (_) {
    return;
  }
  const p = profOf(row.identity);
  const now = performance.now();
  if (Array.isArray(moves[0]) && moves[0][0] === '@char') {
    onRemoteChar(row, moves[0][1], p, now);
    return;
  }
  for (const [id, x, y] of moves) {
    const s = scene(id);
    if (!s) continue;
    let r = remoteDrag.get(id);
    if (!r) {
      r = { x: s.x, y: dispY(s), color: p.color, name: p.name };
      remoteDrag.set(id, r);
      const el = nodeEl(id);
      if (el) {
        el.classList.add('rdrag');
        el.style.setProperty('--rc', p.color);
        el.dataset.who = p.name;
      }
    }
    Object.assign(r, { tx: x, ty: y, seen: now, done: row.done });
  }
  dirty = true;
}
const cursors = new Map();
let cursorLayer = null;
// Suavização pelo tempo real entre quadros (não por quadro), para não depender do fps.
let lastStep = 0;
function stepRemote(now) {
  const dt = Math.min(250, lastStep ? now - lastStep : 16);
  lastStep = now;
  const k = 1 - Math.exp(-dt / 60);
  for (const [id, r] of remoteDrag) {
    const s = scene(id);
    r.x += (r.tx - r.x) * k;
    r.y += (r.ty - r.y) * k;
    if (r.done && now - r.seen > 400) {
      r.x = r.tx;
      r.y = r.ty;
    }
    const settled = Math.abs(r.x - r.tx) < 0.5 && Math.abs(r.y - r.ty) < 0.5;
    const landed =
      r.done &&
      settled &&
      (!s || (Math.abs(s.x - r.tx) < 1 && Math.abs(s.y - r.ty) < 1) || now - r.seen > 1500);
    const el = nodeEl(id);
    if (!s || landed || (!r.done && now - r.seen > 2000)) {
      remoteDrag.delete(id);
      if (el) {
        el.classList.remove('rdrag');
        el.style.left = (s ? s.x : 0) + 'px';
        el.style.top = (s ? dispY(s) : 0) + 'px';
      }
      continue;
    }
    if (el) {
      el.style.left = r.x + 'px';
      el.style.top = r.y + 'px';
      if (!el.classList.contains('rdrag')) {
        el.classList.add('rdrag');
        el.style.setProperty('--rc', r.color);
        el.dataset.who = r.name;
      }
    }
  }
  stepRemoteChars(now, k);
  for (const c of cursors.values()) {
    c.x += (c.tx - c.x) * k;
    c.y += (c.ty - c.y) * k;
    c.el.style.transform = `translate(${c.x}px,${c.y}px) scale(${1 / view.z})`;
  }
}
function syncCursors() {
  if (!conn) return;
  if (!cursorLayer) {
    cursorLayer = document.createElement('div');
    cursorLayer.className = 'rcursors';
    world.appendChild(cursorLayer);
  }
  const live = new Set();
  for (const p of conn.db.curPresence.iter()) {
    const key = p.connectionId.toHexString();
    if (isMine(p.connectionId) || !p.hasCursor) continue;
    live.add(key);
    const pr = profOf(p.identity);
    let c = cursors.get(key);
    if (!c) {
      const el = document.createElement('div');
      el.className = 'rcursor';
      cursorLayer.appendChild(el);
      c = { el, x: p.cursorX, y: p.cursorY };
      cursors.set(key, c);
    }
    c.tx = p.cursorX;
    c.ty = p.cursorY;
    c.el.style.setProperty('--cc', pr.color);
    c.el.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1 1l5.5 13 2-5.5L14 6.5z"/></svg><span>${esc(pr.name)}</span>`;
  }
  for (const [k, c] of cursors)
    if (!live.has(k)) {
      c.el.remove();
      cursors.delete(k);
    }
}
function renderPeople() {
  const host = $('#people');
  if (!host || !conn) return;
  const seen = new Map();
  for (const p of conn.db.curPresence.iter()) {
    const h = hex(p.identity);
    if (!seen.has(h)) seen.set(h, { p, mine: myId && p.identity.isEqual(myId) });
  }
  const all = [...seen.values()].sort((a, b) => b.mine - a.mine),
    list = all.slice(0, 3),
    more = all.slice(3);
  host.innerHTML =
    list
      .map(({ p, mine }) => {
        const pr = profOf(p.identity);
        return `<button class="pav${mine ? ' me' : ''}" data-conn="${p.connectionId.toHexString()}" style="--pc:${pr.color}" title="${esc(pr.name)}${mine ? ' (você) — clique para trocar o nome' : ' — clique para ir até o cursor'}">${esc(pr.name.slice(0, 1).toUpperCase())}</button>`;
      })
      .join('') +
    `${more.length ? `<span class="pmore" title="${esc(more.map(({ p }) => profOf(p.identity).name).join(', '))}">+${more.length}</span>` : ''}`;
  host.title = all.length === 1 ? 'Só você nesta história' : `${all.length} pessoas nesta história`;
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('.pav');
  if (!b) return;
  if (b.classList.contains('me')) {
    const me = profOf(myId);
    askText({
      title: 'Seu nome',
      label: 'como as outras pessoas veem você',
      value: me.name,
      max: 40,
      ok: 'Salvar',
    }).then((n) => {
      if (n && n !== me.name)
        conn.reducers
          .setProfile({ name: n, color: me.color })
          .catch((err) => toast('Não foi possível trocar o nome: ' + errMsg(err), 'err'));
    });
    return;
  }
  const c = cursors.get(b.dataset.conn);
  if (!c) return;
  const r = canvas.getBoundingClientRect();
  view.x = r.width / 2 - c.tx * view.z;
  view.y = r.height / 2 - c.ty * view.z;
  applyView();
});
let lastCur = 0;
canvas.addEventListener('pointermove', (e) => {
  if (!connected || !storyId) return;
  const now = performance.now();
  if (now - lastCur < 50) return;
  lastCur = now;
  const p = toWorld(e.clientX, e.clientY);
  conn.reducers.updateCursor({ x: p.x, y: p.y, visible: true }).catch(() => {});
});
canvas.addEventListener('pointerleave', () => {
  if (connected && storyId)
    conn.reducers.updateCursor({ x: 0, y: 0, visible: false }).catch(() => {});
});

/* trava suave de texto */
let curLock = null;
function fieldTarget(el) {
  if (!el || !el.matches) return null;
  if (el.id === 'storyTitle') return storyId ? `story:${storyId}:title` : null;
  const n = el.closest('.node');
  if (!n) return null;
  const a = el.dataset.act;
  if (a === 'title' || a === 'text') return `scene:${n.dataset.id}:${a}`;
  if (a === 'clabel') {
    const c = scene(n.dataset.id)?.choices[+el.dataset.i];
    return c ? `choice:${c.id}:label` : null;
  }
  return null;
}
function takeFieldLock(el) {
  const t = fieldTarget(el);
  if (!t || !connected || myRole === 'viewer' || (curLock && curLock.target === t)) return;
  if (curLock) releaseLock();
  curLock = { target: t };
  conn.reducers.lockField({ target: t }).catch((err) => {
    if (!/LOCKED/.test(errMsg(err))) return;
    if (curLock && curLock.target === t) curLock = null;
    const who = lockOf(t);
    toast(`${who ? who.name : 'Outra pessoa'} está escrevendo neste campo.`, 'err');
    if (fieldTarget(document.activeElement) === t) document.activeElement.blur();
  });
}
function releaseLock() {
  if (!curLock) return;
  const t = curLock.target;
  curLock = null;
  if (connected) conn.reducers.releaseField({ target: t }).catch(() => {});
}
// Um re-render troca o elemento focado; só solta a trava se o foco saiu mesmo do campo.
function dropFieldLock(el) {
  const t = curLock && curLock.target;
  setTimeout(() => {
    if (t && fieldTarget(document.activeElement) !== t) {
      if (pendingSnap) endTyping();
      if (curLock && curLock.target === t) releaseLock();
    }
  }, 0);
}
setInterval(() => {
  if (!curLock || !connected) return;
  if (fieldTarget(document.activeElement) === curLock.target)
    conn.reducers.renewFieldLock({ target: curLock.target }).catch(() => {});
  else releaseLock();
}, 5000);

/* HUD: voltar, título, ⋯, salvamento, pessoas, compartilhar e atalhos */
$('#btnHome').onclick = () => navigate('/home');
$('#btnShare').onclick = () => shareModal();
// Popovers do topo: um por vez, logo abaixo do botão; fecham ao clicar fora, com Esc ou no mesmo botão.
function toggleHudPop(btn, html) {
  const h = $('#hudPop');
  if (h.dataset.for === btn.id) {
    closeHudPop();
    return;
  }
  h.innerHTML = html;
  h.dataset.for = btn.id;
  h.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
  const c = canvas.getBoundingClientRect(),
    r = btn.getBoundingClientRect(),
    w = h.offsetWidth;
  h.style.top = r.bottom - c.top + 8 + 'px';
  h.style.left = Math.max(16, Math.min(r.left - c.left, c.width - w - 16)) + 'px';
  return h;
}
function closeHudPop() {
  const h = $('#hudPop');
  if (h.hidden) return;
  $('#' + h.dataset.for)?.setAttribute('aria-expanded', 'false');
  h.hidden = true;
  h.innerHTML = '';
  delete h.dataset.for;
}
document.addEventListener('pointerdown', (e) => {
  if (!e.target.closest('#hudPop,[data-pop]')) closeHudPop();
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  closeHudPop();
  if (editChar && !document.querySelector('.modal')) {
    editChar = null;
    renderRail();
  }
});
// ⋯: ações raras e destrutivas, fora da barra (só o dono vê o botão).
$('#btnMore').onclick = (e) => {
  const h = toggleHudPop(
    e.currentTarget,
    '<div class="menu" role="menu"><button data-m="reset" class="danger" role="menuitem">Recriar o exemplo…</button></div>',
  );
  if (!h) return;
  h.querySelector('[data-m="reset"]').onclick = () => {
    closeHudPop();
    askConfirm({
      title: 'Recriar o exemplo',
      ok: 'Apagar e recriar',
      danger: true,
      text: 'Todas as cenas e o elenco desta história são apagados e trocados pelo exemplo, para todas as pessoas que estão nela.',
    }).then((yes) => {
      if (yes) resetExample();
    });
  };
};
const SHORTCUTS = [
  ['Clique ou arraste uma saída', 'cria uma cena ligada a ela'],
  ['<span class="kbd">Shift</span> + clicar ou arrastar', 'a IA monta a cena'],
  ['<span class="kbd">Shift</span> em “+ ação”', 'a IA sugere a ação'],
  ['<span class="kbd">Alt</span> + arrastar', 'corta fios'],
  ['<span class="kbd">Ctrl</span> <span class="kbd">Z</span>', 'desfaz'],
  [
    '<span class="kbd">Ctrl</span> <span class="kbd">Shift</span> <span class="kbd">Z</span>',
    'refaz',
  ],
];
$('#btnHelp').onclick = (e) =>
  toggleHudPop(
    e.currentTarget,
    `<div class="helppop" role="dialog" aria-label="Atalhos"><h3>Atalhos</h3><dl>${SHORTCUTS.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl></div>`,
  );
// Na primeira história aberta neste navegador, os atalhos aparecem uma vez como dica.
function firstTip() {
  let seen = true;
  try {
    seen = !!localStorage.getItem('roteiro:dica-atalhos');
    localStorage.setItem('roteiro:dica-atalhos', '1');
  } catch (_) {}
  if (!seen && !touchUI)
    setTimeout(
      () =>
        toast(
          'Dica: clique ou arraste uma saída para criar uma cena; com Shift, a IA monta. Os atalhos ficam no botão ? do topo.',
          'ai',
        ),
      900,
    );
}
document.body.insertAdjacentHTML(
  'beforeend',
  '<div class="netbanner" id="netbanner" role="status" hidden></div>',
);
let netState = 'connecting',
  retryIn = 0,
  netDownAt = 0,
  leaving = false;
// F5 ou navegação: o navegador fecha o WebSocket antes de trocar de página; não é queda de rede.
addEventListener('pagehide', () => {
  leaving = true;
});
// Status ao lado do título: salvo / salvando… / sem conexão. As medidas do spike ficam na dica e no clique.
function renderNet() {
  const el = $('#net');
  if (!el) return;
  const p50 = pct(rtt.ping, 0.5),
    p95 = pct(rtt.ping, 0.95),
    o50 = pct(rtt.op, 0.5),
    o95 = pct(rtt.op, 0.95);
  const saving = netState === 'on' && inflight.length > 0;
  el.className = 'sync ' + (saving ? 'saving' : netState);
  el.querySelector('.slabel').textContent = saving
    ? 'salvando…'
    : netState === 'on'
      ? 'salvo'
      : netState === 'connecting'
        ? 'conectando…'
        : 'sem conexão';
  el.title = `${WHERE} · ping ${p50 ?? '–'} ms (p95 ${p95 ?? '–'}) · ações ${o50 ?? '–'} ms (p95 ${o95 ?? '–'}, n=${rtt.op.length}). Clique para detalhes.`;
  // O aviso só aparece se a queda passar de 1 s: reconexões rápidas não piscam na tela.
  const down = netState === 'off' || netState === 'err';
  if (!down) netDownAt = 0;
  else if (!netDownAt) {
    netDownAt = performance.now();
    setTimeout(renderNet, 1000);
  }
  const b = $('#netbanner');
  b.hidden = !down || performance.now() - netDownAt < 950;
  b.textContent =
    netState === 'err'
      ? `Não foi possível conectar a ${STDB_URI} (banco ${STDB_DB}).`
      : `Sem conexão — reconectando${retryIn ? ` em ${Math.ceil(retryIn / 1000)} s` : ''}…`;
  appEl.classList.toggle('offline', netState !== 'on');
}
$('#net').onclick = () => {
  const all = rtt.op;
  toast(
    `${WHERE} · ações confirmadas: ${all.length} · p50 ${pct(all, 0.5) ?? '–'} ms · p95 ${pct(all, 0.95) ?? '–'} ms · máx ${all.length ? Math.round(Math.max(...all)) : '–'} ms. Meta da especificação: p95 ≤ 300 ms.`,
  );
};

/* ---------- histórias: lista, abrir e sair ---------- */
const ROLE_LABEL = { owner: 'sua', editor: 'pode editar', viewer: 'só leitura' };
const until = (fn, ms = 5000) =>
  new Promise((res, rej) => {
    const t0 = performance.now();
    (function tick() {
      if (fn()) return res();
      if (performance.now() - t0 > ms) return rej(new Error('TIMEOUT'));
      setTimeout(tick, 20);
    })();
  });
const roleIn = (id) => {
  const m = conn && [...conn.db.myMemberships.iter()].find((r) => r.storyId === id);
  return m ? m.role : '';
};
function editedAgo(ts) {
  const m = Math.round((Date.now() - Number(ts.microsSinceUnixEpoch / 1000n)) / 60000);
  return m < 1
    ? 'agora'
    : m < 60
      ? `há ${m} min`
      : m < 1440
        ? `há ${Math.round(m / 60)} h`
        : new Date(Number(ts.microsSinceUnixEpoch / 1000n)).toLocaleDateString('pt-BR');
}
function renderHome() {
  const host = $('#stories');
  if (!host || !conn || !subsReady) return;
  const list = [...conn.db.myStories.iter()].sort((a, b) =>
    Number(b.updatedAt.microsSinceUnixEpoch - a.updatedAt.microsSinceUnixEpoch),
  );
  host.innerHTML = list.length
    ? list
        .map((s) => {
          const r = roleIn(s.id);
          return `<li class="story" data-id="${esc(s.id)}"><button class="sopen" data-act="open"><h3>${esc(s.title || 'Sem título')}</h3><span class="meta">${ROLE_LABEL[r] || ''} · editada ${editedAgo(s.updatedAt)}</span></button>${r !== 'viewer' ? '<button class="btn sm" data-act="rename">Renomear</button>' : ''}${r === 'owner' ? '<button class="btn sm danger" data-act="delete">Excluir</button>' : '<button class="btn sm" data-act="leave">Sair</button>'}</li>`;
        })
        .join('')
    : '<li class="empty">Nenhuma história ainda. Crie a primeira ou comece pelo exemplo.</li>';
  const a = [...conn.db.myAccount.iter()][0];
  $('#who').innerHTML = a
    ? `${a.picture ? `<img src="${esc(a.picture)}" alt="" referrerpolicy="no-referrer">` : ''}<span>${esc(a.name || a.email)}</span>`
    : '';
}
$('#stories').onclick = (e) => {
  const b = e.target.closest('[data-act]');
  const li = e.target.closest('.story');
  if (!b || !li) return;
  const id = li.dataset.id;
  const st = conn.db.myStories.id.find(id);
  if (!st) return;
  if (b.dataset.act === 'open') navigate('/s/' + id);
  else if (b.dataset.act === 'rename') {
    askText({ title: 'Renomear história', label: 'título', value: st.title, ok: 'Salvar' }).then(
      (t) => {
        if (t && t !== st.title)
          conn.reducers
            .renameStory({ storyId: id, title: t })
            .catch((err) => toast('Não foi possível renomear: ' + errMsg(err), 'err'));
      },
    );
  } else if (b.dataset.act === 'delete')
    askConfirm({
      title: 'Excluir história',
      ok: 'Excluir',
      danger: true,
      text: `<b>${esc(st.title || 'Sem título')}</b> some para todas as pessoas com acesso, com todas as cenas e a conversa com a IA. Não dá para desfazer.`,
    }).then((yes) => {
      if (yes)
        conn.reducers
          .deleteStory({ storyId: id })
          .catch((err) => toast('Não foi possível excluir: ' + errMsg(err), 'err'));
    });
  else if (b.dataset.act === 'leave')
    askConfirm({
      title: 'Sair da história',
      ok: 'Sair',
      danger: true,
      text: `Você perde o acesso a <b>${esc(st.title || 'Sem título')}</b> até ser convidado de novo.`,
    }).then((yes) => {
      if (yes)
        conn.reducers
          .removeMember({ storyId: id, userId: myId })
          .catch((err) => toast('Não foi possível sair: ' + errMsg(err), 'err'));
    });
};
function createStory(example) {
  if (!connected) return;
  const id = uid('st');
  let title, start, ops;
  if (example) {
    ({ ops, start } = exampleGraph());
    title = SEED.title;
  } else {
    start = uid('s');
    title = 'Nova história';
    ops = [
      {
        op: 'upsert_scene',
        scene: {
          id: start,
          title: 'Início',
          x: 0,
          y: 0,
          bg: '',
          chars: '[]',
          kind: 'narration',
          speaker: '',
          text: '',
          next: '',
          ai: '',
        },
      },
    ];
  }
  conn.reducers.createStory({ id, title, startScene: start, ops: JSON.stringify(ops) }).then(
    () => {
      navigate('/s/' + id);
    },
    (err) => toast('Não foi possível criar: ' + errMsg(err), 'err'),
  );
}
$('#btnNew').onclick = () => createStory(false);
$('#btnNewExample').onclick = () => createStory(true);
$('#btnLogout').onclick = () => logout();

function updateRole() {
  myRole = storyId ? roleIn(storyId) : '';
  const ro = myRole === 'viewer';
  appEl.classList.toggle('ro', ro);
  $('#storyTitle').readOnly = ro;
  $('#btnMore').hidden = myRole !== 'owner';
}
function resetChat() {
  clearDraft();
  log.innerHTML = '';
  chatJobs.clear();
  chatSeen.clear();
  addMsg(CHAT_HELLO, 'bot');
}
// Esquece o grafo, o desfazer e a conversa da história anterior.
function leaveStory(close = true) {
  if (!storyId) return;
  releaseLock();
  if (close && connected) conn.reducers.closeStory({}).catch(() => {});
  if (dragSub) {
    try {
      dragSub.unsubscribe();
    } catch (_) {}
    dragSub = null;
  }
  storyId = '';
  myRole = '';
  ready = false;
  base = null;
  inflight.length = 0;
  retryOps = [];
  expanded = null;
  undoS.length = 0;
  redoS.length = 0;
  gens.clear();
  lit.clear();
  remoteDrag.clear();
  for (const c of cursors.values()) c.el.remove();
  cursors.clear();
  chatLive = false;
  state.scenes = [];
  state.title = '';
  state.start = '';
  state.characters = [];
  state.backgrounds = [];
  openCards.clear();
  editChar = null;
  closeModal();
  closeHudPop();
  resetChat();
  renderAll();
}
function showHome() {
  leaveStory();
  $('#gate').hidden = true;
  $('#home').hidden = false;
  document.title = 'Roteiro VN';
  renderHome();
}
async function enterStory(id) {
  $('#gate').hidden = true;
  $('#home').hidden = true;
  if (storyId === id) return;
  leaveStory(false);
  storyId = id;
  try {
    await conn.reducers.openStory({ storyId: id });
    await until(() => storyId !== id || viewsMine());
  } catch (err) {
    if (storyId !== id) return;
    storyId = '';
    toast(
      /NOT_FOUND/.test(errMsg(err))
        ? 'História não encontrada, ou você não tem acesso a ela.'
        : 'Não foi possível abrir: ' + errMsg(err),
      'err',
    );
    navigate('/home', true);
    return;
  }
  if (storyId !== id) return; // trocou de história enquanto abria
  document.documentElement.classList.remove('boot');
  // Tabela de eventos: views não a cobrem, então o filtro vai na assinatura.
  dragSub = conn.subscriptionBuilder().subscribe([`SELECT * FROM drags WHERE story_id = '${id}'`]);
  updateRole();
  document.title = (conn.db.curStory.id.find(id)?.title || 'História') + ' · Roteiro VN';
  onReady();
  firstTip();
}
/* rotas: /login, /home, /s/<id> e /l/<código do link> (o Pages e o Vite devolvem o index.html para qualquer caminho) */
const NEXT_KEY = 'roteiro:next';
function navigate(path, replace) {
  if (location.pathname !== path) history[replace ? 'replaceState' : 'pushState'](null, '', path);
  route();
}
function route() {
  const p = location.pathname;
  // Sem login: tudo vai para /login, guardando para onde a pessoa queria ir.
  if (!DEV_ANON && !idToken) {
    if (!authChecked) {
      showLoading();
      return;
    }
    if (p !== '/login') {
      sessionStorage.setItem(NEXT_KEY, p);
      history.replaceState(null, '', '/login');
    }
    showLogin();
    return;
  }
  if (p === '/login' || p === '/') {
    const next = sessionStorage.getItem(NEXT_KEY);
    sessionStorage.removeItem(NEXT_KEY);
    history.replaceState(null, '', next && next !== '/login' && next !== '/' ? next : '/home');
    return route();
  }
  if (!conn || !subsReady) {
    showLoading();
    return;
  } // a assinatura chama route() de novo
  const l = p.match(/^\/l\/([A-Za-z0-9]{1,32})$/);
  if (l) return joinLink(l[1]);
  const m = p.match(/^\/s\/([\w-]{1,64})$/);
  if (m) enterStory(m[1]);
  else {
    if (p !== '/home') history.replaceState(null, '', '/home');
    showHome();
  }
}
addEventListener('popstate', route);
// Links antigos (#/s/<id>) viram caminhos.
{
  const m = location.hash.match(/^#\/s\/([\w-]{1,64})$/);
  if (m) history.replaceState(null, '', '/s/' + m[1]);
}
// Outra aba da mesma conta abriu outra história: esta reabre a sua quando volta a ter foco.
function reclaim() {
  if (storyId && connected && ready && !viewsMine() && roleIn(storyId))
    conn.reducers.openStory({ storyId }).catch(() => {});
}
addEventListener('focus', reclaim);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) reclaim();
});

/* link de compartilhamento: /l/<código> abre a história e dá acesso a quem ainda não tem */
let joining = '';
async function joinLink(code) {
  if (joining === code) return;
  joining = code;
  showLoading();
  try {
    await conn.reducers.joinByLink({ code });
    await until(() => conn.db.curStory.count() > 0);
    const st = [...conn.db.curStory.iter()][0];
    navigate('/s/' + st.id, true);
  } catch (err) {
    toast(
      /NOT_FOUND/.test(errMsg(err))
        ? 'Este link não funciona mais. Peça um novo a quem o enviou.'
        : 'Não foi possível abrir o link: ' + errMsg(err),
      'err',
    );
    navigate('/home', true);
  } finally {
    joining = '';
  }
}
const LINK_ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
// 10 caracteres sem viés (rejeita bytes ≥ 248): o servidor só aceita esse formato.
function linkCode() {
  let c = '';
  while (c.length < 10) {
    for (const b of crypto.getRandomValues(new Uint8Array(16)))
      if (b < 248 && c.length < 10) c += LINK_ABC[b % 62];
  }
  return c;
}
const linkUrl = (code) => location.origin + '/l/' + code;
function qrSvg(text) {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
}
async function setLinkAccess(role, fresh) {
  const cur = conn.db.curLink.storyId.find(storyId);
  for (let i = 0; i < 3; i++) {
    const code = role && (fresh || !cur) ? linkCode() : cur ? cur.code : '';
    try {
      await conn.reducers.setLinkAccess({ storyId, role, code });
      return true;
    } catch (err) {
      if (/CONFLICT/.test(errMsg(err))) continue;
      toast('Não foi possível mudar o link: ' + errMsg(err), 'err');
      return false;
    }
  }
  return false;
}
// Desligar ou trocar o link tira o acesso de quem entrou por ele: pede confirmação antes.
function confirmLinkCut(title, ok, text) {
  return askConfirm({
    title,
    ok,
    danger: true,
    text: text + ' Quem entrou pelo link sem ter sido convidado perde o acesso.',
  }).finally(() => shareModal());
}
function renderLink() {
  const l = conn.db.curLink.storyId.find(storyId);
  const v = l ? l.role : '';
  const opt = (val, label) =>
    `<option value="${val}"${v === val ? ' selected' : ''}>${label}</option>`;
  return `<section class="share-link"><h3>Acesso pelo link</h3>
    <select class="inp" id="linkRole" aria-label="Quem pode abrir pelo link">${opt('', 'Restrito: só quem foi convidado')}${opt('viewer', 'Qualquer pessoa com o link pode ver')}${opt('editor', 'Qualquer pessoa com o link pode editar')}</select>
    ${
      l
        ? `<div class="link-box"><div class="qr" role="img" aria-label="QR code do link">${qrSvg(linkUrl(l.code))}</div>
      <div class="link-side"><div class="row"><input class="inp" id="linkUrl" readonly value="${esc(linkUrl(l.code))}" aria-label="Link curto"><button class="btn primary" id="linkCopy">Copiar</button></div>
      <div class="hint">É preciso entrar com uma conta Google para abrir. Quem abrir entra na lista abaixo.</div>
      <div class="row"><button class="btn sm" id="linkQr">Baixar QR code</button><button class="btn sm danger" id="linkReset">Gerar novo link</button></div></div></div>`
        : ''
    }</section>`;
}
function wireLink() {
  const sel = $('#linkRole');
  if (!sel) return;
  const l = conn.db.curLink.storyId.find(storyId);
  sel.onchange = () => {
    const role = sel.value;
    if (!role && l) {
      sel.value = l.role;
      confirmLinkCut('Desligar o link', 'Desligar', 'O link para de funcionar.').then((yes) => {
        if (yes) setLinkAccess('');
      });
    } else setLinkAccess(role);
  };
  const copy = $('#linkCopy');
  if (copy)
    copy.onclick = () => {
      const u = $('#linkUrl');
      navigator.clipboard.writeText(u.value).then(
        () => toast('Link copiado'),
        () => {
          u.select();
          toast('Selecione e copie o link (Ctrl+C).');
        },
      );
    };
  const qr = $('#linkQr');
  if (qr)
    qr.onclick = () => {
      const svg = $('.share-link .qr svg');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([svg.outerHTML], { type: 'image/svg+xml' }));
      a.download =
        ((conn.db.curStory.id.find(storyId)?.title || 'historia')
          .replace(/[^\w\- ]+/g, '')
          .trim() || 'historia') + ' - QR.svg';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
  const rs = $('#linkReset');
  if (rs)
    rs.onclick = () =>
      confirmLinkCut('Gerar novo link', 'Gerar novo link', 'O link atual para de funcionar.').then(
        (yes) => {
          if (yes) setLinkAccess(l.role, true);
        },
      );
}

/* compartilhar */
function shareModal() {
  if (!storyId) return;
  modal(
    `<div class="modal-head"><h2>Compartilhar</h2><button class="iconbtn" data-close aria-label="Fechar">${X}</button></div><div class="modal-body" id="shareBody"></div><div class="modal-foot"><button class="btn" data-close>Fechar</button></div>`,
    'narrow',
  );
  renderShare();
}
function renderShare() {
  const host = $('#shareBody');
  if (!host || !conn) return;
  const owner = myRole === 'owner';
  const acc = (id) => conn.db.curAccount.identity.find(id);
  const members = [...conn.db.curMember.iter()].sort(
    (a, b) => (b.role === 'owner') - (a.role === 'owner'),
  );
  const roleSel = (v, attrs) =>
    `<select class="inp share-role" ${attrs}><option value="editor"${v === 'editor' ? ' selected' : ''}>pode editar</option><option value="viewer"${v === 'viewer' ? ' selected' : ''}>só leitura</option></select>`;
  host.innerHTML =
    (owner
      ? `<form class="row" id="shareForm"><input class="inp" type="email" id="shareEmail" placeholder="e-mail da pessoa" required style="flex:1;min-width:180px">${roleSel('editor', 'id="shareRole"')}<button class="btn primary" type="submit">Convidar</button></form><div class="hint">Quem ainda não entrou recebe acesso no primeiro login com esse e-mail.</div>`
      : '') +
    `<ul class="people-list">${members
      .map((m) => {
        const a = acc(m.userId);
        const me = myId && m.userId.isEqual(myId);
        const who = a ? a.name || a.email : '—';
        const right =
          m.role === 'owner'
            ? '<span class="meta">dono</span>'
            : owner && a && a.email
              ? `${roleSel(m.role, `data-email="${esc(a.email)}"`)}<button class="btn sm danger" data-remove="${hex(m.userId)}">Remover</button>`
              : `<span class="meta">${ROLE_LABEL[m.role]}</span>`;
        return `<li><span class="pinfo"><b>${esc(who)}${me ? ' (você)' : ''}</b><span class="meta">${esc(a && a.name ? a.email : '')}</span></span>${right}</li>`;
      })
      .join('')}
    ${[...conn.db.curInvite.iter()].map((v) => `<li><span class="pinfo"><b>${esc(v.email)}</b><span class="meta">convite pendente · ${ROLE_LABEL[v.role]}</span></span><button class="btn sm" data-cancel="${v.id}">Cancelar</button></li>`).join('')}</ul>` +
    (owner ? renderLink() : '') +
    (!owner
      ? `<div class="row"><button class="btn sm danger" id="shareLeave">Sair desta história</button></div>`
      : '');
  // Não redesenha o seletor do link no meio de uma escolha: renderShare roda a cada mudança de membro.
  if (owner) wireLink();
  const f = $('#shareForm');
  if (f)
    f.onsubmit = (e) => {
      e.preventDefault();
      const email = $('#shareEmail').value.trim();
      conn.reducers.shareStory({ storyId, email, role: $('#shareRole').value }).then(
        () => {
          $('#shareEmail') && ($('#shareEmail').value = '');
          toast('Acesso dado a ' + email);
        },
        (err) =>
          toast(
            /INVALID/.test(errMsg(err))
              ? 'E-mail inválido.'
              : 'Não foi possível convidar: ' + errMsg(err),
            'err',
          ),
      );
    };
  host
    .querySelectorAll('select[data-email]')
    .forEach(
      (s) =>
        (s.onchange = () =>
          conn.reducers
            .shareStory({ storyId, email: s.dataset.email, role: s.value })
            .catch((err) => toast('Não foi possível mudar o acesso: ' + errMsg(err), 'err'))),
    );
  host.querySelectorAll('[data-remove]').forEach(
    (b) =>
      (b.onclick = () => {
        const m = members.find((x) => hex(x.userId) === b.dataset.remove);
        if (m)
          conn.reducers
            .removeMember({ storyId, userId: m.userId })
            .catch((err) => toast('Não foi possível remover: ' + errMsg(err), 'err'));
      }),
  );
  host
    .querySelectorAll('[data-cancel]')
    .forEach(
      (b) =>
        (b.onclick = () =>
          conn.reducers.cancelInvite({ id: BigInt(b.dataset.cancel) }).catch(() => {})),
    );
  const lv = $('#shareLeave');
  if (lv)
    lv.onclick = () =>
      askConfirm({
        title: 'Sair da história',
        ok: 'Sair',
        danger: true,
        text: 'Você perde o acesso a esta história até ser convidado de novo.',
      }).then((yes) => {
        if (yes)
          conn.reducers
            .removeMember({ storyId, userId: myId })
            .catch((err) => toast('Não foi possível sair: ' + errMsg(err), 'err'));
      });
}

/* ---------- conta Google ----------
   O login acontece nas Pages Functions (/api/auth/*, ver client/lib/oauth.js): o refresh token
   fica num cookie HttpOnly e o navegador só recebe ID tokens de 1 h, guardados na memória.
   Um F5 pega outro em /api/auth/token; antes de reconectar, o SDK pede outro a freshToken. */
let idToken = null,
  authChecked = false;
const LOGIN_ERRS = {
  denied: 'Você cancelou a autorização no Google.',
  state: 'O login expirou ou veio de outra aba. Tente de novo.',
  exchange: 'O Google recusou o login. Tente de novo.',
  no_refresh: 'O Google não liberou o acesso contínuo. Tente de novo.',
  google: 'O Google devolveu um erro. Tente de novo.',
};
// null = sem sessão (cookie ausente, expirado ou revogado).
async function fetchToken() {
  const r = await fetch('/api/auth/token', { method: 'POST', credentials: 'same-origin' });
  if (r.status === 401) return null;
  if (!r.ok) throw new Error('AUTH_' + r.status);
  return (await r.json()).id_token || null;
}
function freshToken() {
  return fetchToken().then((t) => {
    if (!t) {
      showGate('Sua sessão terminou. Entre de novo para continuar.', location.pathname);
      throw new Error('NO_SESSION');
    }
    idToken = t;
    return t;
  });
}
// O botão vai para o Google e volta para `next` (a página onde a pessoa estava).
function showGate(msg, next) {
  $('#gate').hidden = false;
  $('#gateMsg').textContent = msg || '';
  $('#gateBtn').href =
    '/api/auth/start?next=' +
    encodeURIComponent(next || sessionStorage.getItem(NEXT_KEY) || '/home');
}
function showLogin() {
  leaveStory();
  $('#home').hidden = true;
  document.title = 'Entrar · Roteiro VN';
  const err = new URLSearchParams(location.search).get('error');
  if (location.search) history.replaceState(null, '', '/login');
  showGate(err ? LOGIN_ERRS[err] || 'Não foi possível entrar. Tente de novo.' : '');
}
function showLoading() {
  $('#gate').hidden = true;
  $('#home').hidden = false;
  $('#stories').innerHTML = '<li class="empty">Carregando…</li>';
}
async function startAuth() {
  if (DEV_ANON) {
    connect();
    route();
    return;
  }
  route(); // carregando, enquanto confere a sessão
  try {
    idToken = await fetchToken();
  } catch (_) {
    authChecked = true;
    route();
    showGate('Não foi possível falar com o servidor de login. Tente de novo em instantes.');
    return;
  }
  authChecked = true;
  if (idToken) connect();
  route();
}
async function logout() {
  if (DEV_ANON) sessionStorage.removeItem(TOKEN_KEY);
  else
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
  leaving = true;
  try {
    conn && conn.disconnect();
  } catch (_) {}
  sessionStorage.removeItem(NEXT_KEY);
  history.replaceState(null, '', '/login');
  location.reload();
}

function onReady() {
  ready = true;
  base = null;
  rebuild();
  renderPeople();
  syncCursors();
  requestAnimationFrame(fitView);
  // Conversa salva no servidor: volta ao recarregar a aba (mesma conta, mesma história).
  [...conn.db.myChatMessage.iter()]
    .sort(
      (a, b) =>
        Number(a.createdAt.microsSinceUnixEpoch - b.createdAt.microsSinceUnixEpoch) ||
        (a.role === 'user' ? -1 : 1),
    )
    .forEach(renderChatRow);
  chatLive = true;
}
function connect() {
  const b = DbConnection.builder()
    .withUri(STDB_URI)
    .withDatabaseName(STDB_DB)
    .withAutomaticReconnect();
  if (DEV_ANON) b.withToken(sessionStorage.getItem(TOKEN_KEY) || undefined);
  else b.withToken(idToken).withTokenProvider(freshToken);
  conn = b
    .onConnect((c, identity, token) => {
      if (DEV_ANON) sessionStorage.setItem(TOKEN_KEY, token);
      myId = identity;
      myConn = c.connectionId;
      connected = true;
      netState = 'on';
      renderNet();
      const re = () => scheduleRebuild();
      for (const t of [
        c.db.curStory,
        c.db.curScene,
        c.db.curChoice,
        c.db.curCharacter,
        c.db.curSprite,
        c.db.curBackground,
      ]) {
        t.onInsert(re);
        t.onUpdate(re);
        t.onDelete(re);
      }
      // Geração do elenco terminou (ou falhou) enquanto a pessoa fazia outra coisa.
      c.db.curSprite.onUpdate((_c, o, r) => {
        if (!viewsMine()) return;
        const ch = c.db.curCharacter.id.find(r.characterId);
        if (o.status === 'generating' && r.status === 'failed')
          toast(
            `A pose “${r.name}” de ${ch?.name || 'personagem'} falhou: ${aiMessage(r.error)}`,
            'err',
          );
        else if (o.status === 'generating' && !r.status && r.imageKey)
          freshSprites.set(r.id, performance.now());
      });
      c.db.curCharsheet.onInsert(() => renderRailSoon());
      c.db.curCharsheet.onUpdate(() => renderRailSoon());
      c.db.curCharacter.onUpdate((_c, o, r) => {
        if (!viewsMine()) return;
        if (o.status === 'generating' && r.status === 'failed')
          toast(`Não foi possível gerar o charsheet de ${r.name}: ${aiMessage(r.error)}`, 'err');
        else if (o.status === 'generating' && !r.status)
          toast(`Charsheet de ${r.name} pronto; gerando as poses`, 'ai');
      });
      c.db.curBackground.onUpdate((_c, o, r) => {
        if (!viewsMine()) return;
        if (o.status === 'generating' && r.status === 'failed')
          toast(`Não foi possível gerar o background “${r.name}”: ${aiMessage(r.error)}`, 'err');
        else if (o.status === 'generating' && !r.status)
          toast(`Background “${r.name}” pronto`, 'ai');
      });
      c.db.curStory.onUpdate((_ctx, _old, row) => {
        if (row.id === storyId) document.title = (row.title || 'História') + ' · Roteiro VN';
      });
      c.db.curScene.onDelete((ctx, row) => {
        const s = scene(row.id);
        if (
          viewsMine() &&
          s &&
          (expanded === row.id || nodeEl(row.id)?.contains(document.activeElement)) &&
          !inflight.some((b) => b.ops.some((o) => o.op === 'delete_scene' && o.id === row.id))
        )
          toast(
            `A cena “${row.title}” foi apagada por outra pessoa.${s.text ? ' Seu texto: “' + s.text.slice(0, 120) + '”' : ''}`,
            'err',
          );
      });
      const rl = () => renderNodes();
      c.db.curLocks.onInsert(rl);
      c.db.curLocks.onUpdate(rl);
      c.db.curLocks.onDelete(rl);
      const pp = () => {
        renderPeople();
        syncCursors();
      };
      for (const t of [c.db.curPresence, c.db.curProfile]) {
        t.onInsert(pp);
        t.onUpdate(pp);
        t.onDelete(pp);
      }
      c.db.curProfile.onUpdate(() => renderNodes());
      const rs = () => renderShare();
      for (const t of [c.db.curMember, c.db.curAccount, c.db.curInvite, c.db.curLink]) {
        t.onInsert(rs);
        t.onUpdate(rs);
        t.onDelete(rs);
      }
      const rh = () => renderHome();
      for (const t of [c.db.myStories, c.db.myAccount]) {
        t.onInsert(rh);
        t.onUpdate(rh);
        t.onDelete(rh);
      }
      // Papel novo ou acesso removido (inclusive história excluída) na história aberta.
      const mm = () => {
        renderHome();
        if (!storyId) return;
        if (!roleIn(storyId)) {
          toast('Você não tem mais acesso a esta história.', 'err');
          navigate('/home');
          return;
        }
        updateRole();
        renderShare();
      };
      c.db.myMemberships.onInsert(mm);
      c.db.myMemberships.onUpdate(mm);
      c.db.myMemberships.onDelete(mm);
      c.db.drags.onInsert((_ctx, row) => onRemoteDrag(row));
      c.db.chatChunk.onInsert((_ctx, row) => onChatChunk(row));
      c.db.myAiJob.onInsert((_ctx, row) => onJobRow(row));
      c.db.myAiJob.onUpdate((_ctx, _old, row) => onJobRow(row));
      c.db.myChatMessage.onInsert((_ctx, row) => {
        if (ready && row.storyId === storyId) renderChatRow(row);
      });
      c.subscriptionBuilder()
        .onApplied(() => {
          subsReady = true;
          route();
        })
        .onError((_ctx, err) => toast('Erro na assinatura: ' + errMsg(err), 'err'))
        .subscribe([
          'SELECT * FROM my_account',
          'SELECT * FROM my_stories',
          'SELECT * FROM my_memberships',
          'SELECT * FROM cur_story',
          'SELECT * FROM cur_scene',
          'SELECT * FROM cur_choice',
          'SELECT * FROM cur_presence',
          'SELECT * FROM cur_locks',
          'SELECT * FROM cur_character',
          'SELECT * FROM cur_charsheet',
          'SELECT * FROM cur_sprite',
          'SELECT * FROM cur_background',
          'SELECT * FROM cur_member',
          'SELECT * FROM cur_account',
          'SELECT * FROM cur_profile',
          'SELECT * FROM cur_invite',
          'SELECT * FROM cur_link',
          'SELECT * FROM my_ai_job',
          'SELECT * FROM my_chat_message',
          'SELECT * FROM chat_chunk WHERE requester = :sender',
        ]);
    })
    // A presença nova volta para a história aberta (on_connect lê active_story); a assinatura é refeita pelo SDK.
    .onAutomaticReconnect((c, identity, token) => {
      if (DEV_ANON) sessionStorage.setItem(TOKEN_KEY, token);
      myId = identity;
      myConn = c.connectionId;
      connected = true;
      netState = 'on';
      renderNet();
      curLock = null;
      reclaim();
      scheduleRebuild();
      scheduleSync();
    })
    .onDisconnect((_ctx, _err, attempt, delayMs) => {
      if (leaving) return;
      connected = false;
      netState = 'off';
      retryIn = attempt === undefined ? 0 : delayMs || 0;
      renderNet();
    })
    .onConnectError((_ctx, err) => {
      connected = false;
      netState = 'err';
      renderNet();
      console.error(err);
      // Token recusado na primeira conexão: o próximo login (onCredential) conecta de novo.
      if (!DEV_ANON) {
        conn = null;
        idToken = null;
        subsReady = false;
        route();
        showGate('O servidor recusou o login. Entre de novo.');
      }
    })
    .build();
}

/* ---------- boot ---------- */
applyView();
renderAll();
renderNet();
requestAnimationFrame(loop);
startAuth();
if (touchUI) {
  let seen = false;
  try {
    seen = !!localStorage.getItem('roteiro:dica-toque');
    localStorage.setItem('roteiro:dica-toque', '1');
  } catch (_) {}
  if (!seen)
    setTimeout(
      () =>
        toast(
          'Dica: segure uma saída ou “+ ação” para a IA criar. Arraste com um dedo para mover a tela, dois para zoom.',
          'ai',
        ),
      1200,
    );
}
// Só em desenvolvimento: acesso para testes pelo console.
if (import.meta.env.DEV)
  window.__spike = {
    get conn() {
      return conn;
    },
    get storyId() {
      return storyId;
    },
    state,
    rtt,
    scene,
    inflight,
    refresh,
    pushUndo,
    undo,
    stepRemote,
    remoteDrag,
  };
