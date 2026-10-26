// Roteiro VN — spike do módulo SpacetimeDB.
// Cobre: grafo de cenas com validação no servidor (ciclo, 6 personagens, falante,
// ações x saída única, cena inicial), presença com cursores, arrasto ao vivo por
// tabela de eventos e trava suave de campos de texto. Personagens e backgrounds
// ficam no cliente neste spike (ids fixos), então não são validados aqui.
// IA (seção 2.6): procedures suggest_scene/complete_text e fila ai_job para o worker.
// Com AI_PROVIDER=mock tudo responde com conteúdo simulado; sem AI_PROVIDER, AI_DISABLED.
import { schema, table, t, SenderError, ScheduleAt, type ReducerCtx, type ProcedureCtx, type InferSchema } from 'spacetimedb/server';
import { Timestamp, TimeDuration } from 'spacetimedb';

const story = table(
  { public: true },
  {
    id: t.string().primaryKey(),
    title: t.string(),
    startScene: t.string(),
  }
);

const scene = table(
  { public: true },
  {
    id: t.string().primaryKey(),
    title: t.string(),
    x: t.f64(),
    y: t.f64(),
    bg: t.string(), // '' = sem background
    chars: t.string(), // JSON [{c, s}] — personagem e sprite, em ordem de slot
    kind: t.string(), // 'narration' | 'dialogue'
    speaker: t.string(),
    text: t.string(),
    next: t.string(), // saída única; '' = nenhuma
    ai: t.string(), // '' | 'generating' | 'failed'
    updatedBy: t.identity(),
  }
);

const choice = table(
  { public: true },
  {
    id: t.string().primaryKey(),
    sceneId: t.string().index('btree'),
    label: t.string(),
    target: t.string(), // '' = ação sem destino (rascunho)
    position: t.u32(),
  }
);

const profile = table(
  { public: true },
  {
    identity: t.identity().primaryKey(),
    name: t.string(),
    color: t.string(),
  }
);

const presence = table(
  { public: true },
  {
    connectionId: t.connectionId().primaryKey(),
    identity: t.identity(),
    cursorX: t.f64(),
    cursorY: t.f64(),
    hasCursor: t.bool(),
    updatedAt: t.timestamp(),
  }
);

// Tabela de eventos: as linhas chegam aos assinantes e não ficam salvas.
const drags = table(
  { public: true, event: true },
  {
    connectionId: t.connectionId(),
    identity: t.identity(),
    moves: t.string(), // JSON [[sceneId, x, y], ...]
    done: t.bool(),
  }
);

const locks = table(
  { public: true },
  {
    target: t.string().primaryKey(), // ex.: scene:<id>:text, choice:<id>:label
    connectionId: t.connectionId(),
    identity: t.identity(),
    expiresAt: t.timestamp(),
  }
);

const sweep = table(
  {},
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
  }
);

// ---------- IA ----------
// Pedidos ao worker (chat, personagem, background). Privada: o cliente lê pela view my_ai_job.
const aiJob = table(
  {},
  {
    id: t.string().primaryKey(), // gerado no cliente: repetir o pedido não duplica
    requester: t.identity().index('btree'),
    kind: t.string(), // 'chat' | 'character' | 'background'
    input: t.string(), // JSON
    status: t.string().index('btree'), // 'pending' | 'running' | 'done' | 'failed'
    result: t.string(), // JSON
    error: t.string(),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
  }
);

// Conversa e propostas; cada pessoa vê só a própria (view my_chat_message).
const chatMessage = table(
  {},
  {
    id: t.string().primaryKey(),
    user: t.identity().index('btree'),
    jobId: t.string(),
    role: t.string(), // 'user' | 'assistant'
    content: t.string(),
    proposals: t.string(), // JSON [{summary, ops}]
    createdAt: t.timestamp(),
  }
);

// Streaming do chat: tabela de eventos, não é salva. O cliente assina só os seus
// pedaços (WHERE requester = :sender); views não cobrem tabelas de eventos.
const chatChunk = table(
  { public: true, event: true },
  {
    jobId: t.string(),
    requester: t.identity(),
    seq: t.u32(),
    text: t.string(),
  }
);

const aiRate = table(
  {},
  {
    user: t.identity().primaryKey(),
    windowStart: t.timestamp(),
    count: t.u32(),
  }
);

const config = table(
  {},
  {
    key: t.string().primaryKey(),
    value: t.string(),
  }
);

const spacetimedb = schema(
  { story, scene, choice, profile, presence, drags, locks, sweep, aiJob, chatMessage, chatChunk, aiRate, config },
  {
    // Definidos na publicação (variáveis de ambiente do shell). Sem AI_PROVIDER, a IA fica desabilitada.
    env: {
      AI_PROVIDER: t.option(t.string()), // 'mock' | 'openai' | 'google'
      AI_MOCK_LATENCY_URL: t.option(t.string()), // modo mock: endpoint lento que simula a latência do provedor
      AI_RATE_PER_MIN: t.option(t.string()),
      WORKER_SECRET: t.option(t.string()), // o worker se registra com ele em register_worker
    },
  }
);
export default spacetimedb;

const STORY_ID = 'main';
const MAX_CHARS = 6;
const LOCK_MICROS = 15_000_000n;

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;
type PCtx = ProcedureCtx<InferSchema<typeof spacetimedb>>;

// ---------- operações ----------
// Cada operação grava valores finais, então repetir o mesmo lote é seguro.
type Op =
  | { op: 'upsert_scene'; scene: Record<string, unknown> & { id: string } }
  | { op: 'delete_scene'; id: string }
  | { op: 'upsert_choice'; choice: Record<string, unknown> & { id: string } }
  | { op: 'delete_choice'; id: string }
  | { op: 'set_start'; id: string }
  | { op: 'set_title'; title: string };

const SCENE_FIELDS = ['title', 'x', 'y', 'bg', 'chars', 'kind', 'speaker', 'text', 'next', 'ai'] as const;
const TEXT_FIELDS = new Set(['title', 'text']);

function fail(code: string, i: number, detail = ''): never {
  throw new SenderError(`${code}:${i}${detail ? ':' + detail : ''}`);
}

function lockedByOther(ctx: Ctx, target: string): boolean {
  const l = ctx.db.locks.target.find(target);
  if (!l) return false;
  if (l.expiresAt.microsSinceUnixEpoch < ctx.timestamp.microsSinceUnixEpoch) return false;
  return !ctx.connectionId || !l.connectionId.isEqual(ctx.connectionId);
}

function applyOp(ctx: Ctx, o: Op, i: number) {
  switch (o.op) {
    case 'upsert_scene': {
      const cur = ctx.db.scene.id.find(o.scene.id);
      for (const f of TEXT_FIELDS)
        if (f in o.scene && cur && (cur as any)[f] !== o.scene[f] && lockedByOther(ctx, `scene:${o.scene.id}:${f}`))
          fail('LOCKED', i, o.scene.id);
      const base = cur ?? {
        id: o.scene.id, title: 'Nova cena', x: 0, y: 0, bg: '', chars: '[]', kind: 'narration',
        speaker: '', text: '', next: '', ai: '', updatedBy: ctx.sender,
      };
      const row: any = { ...base, updatedBy: ctx.sender };
      for (const f of SCENE_FIELDS) if (f in o.scene) row[f] = o.scene[f] ?? (f === 'x' || f === 'y' ? 0 : '');
      if (typeof row.x !== 'number' || typeof row.y !== 'number') fail('INVALID', i);
      if (cur) ctx.db.scene.id.update(row);
      else ctx.db.scene.insert(row);
      break;
    }
    case 'delete_scene': {
      const st = ctx.db.story.id.find(STORY_ID);
      if (st && st.startScene === o.id) fail('START', i);
      if (!ctx.db.scene.id.find(o.id)) break; // já apagada: nada a fazer
      ctx.db.scene.id.delete(o.id);
      for (const c of [...ctx.db.choice.sceneId.filter(o.id)]) ctx.db.choice.id.delete(c.id);
      // Excluir uma cena zera os destinos que apontam para ela.
      for (const s of [...ctx.db.scene.iter()]) if (s.next === o.id) ctx.db.scene.id.update({ ...s, next: '' });
      for (const c of [...ctx.db.choice.iter()]) if (c.target === o.id) ctx.db.choice.id.update({ ...c, target: '' });
      break;
    }
    case 'upsert_choice': {
      const cur = ctx.db.choice.id.find(o.choice.id);
      if ('label' in o.choice && cur && cur.label !== o.choice.label && lockedByOther(ctx, `choice:${o.choice.id}:label`))
        fail('LOCKED', i, o.choice.id);
      const row: any = { ...(cur ?? { id: o.choice.id, sceneId: '', label: '', target: '', position: 0 }) };
      for (const f of ['sceneId', 'label', 'target', 'position']) if (f in o.choice) row[f] = o.choice[f] ?? (f === 'position' ? 0 : '');
      if (cur) ctx.db.choice.id.update(row);
      else ctx.db.choice.insert(row);
      break;
    }
    case 'delete_choice':
      ctx.db.choice.id.delete(o.id);
      break;
    case 'set_start': {
      const st = ctx.db.story.id.find(STORY_ID);
      if (st) ctx.db.story.id.update({ ...st, startScene: o.id });
      break;
    }
    case 'set_title': {
      if (lockedByOther(ctx, 'story:title')) fail('LOCKED', i, 'story');
      const st = ctx.db.story.id.find(STORY_ID);
      if (st) ctx.db.story.id.update({ ...st, title: o.title });
      break;
    }
    default:
      fail('INVALID', i);
  }
}

// Regras do grafo e da cena, contra o estado já com o lote aplicado.
function validate(ctx: Ctx) {
  const st = ctx.db.story.id.find(STORY_ID);
  if (!st || !ctx.db.scene.id.find(st.startScene)) fail('NO_START', 0);
  const outs = new Map<string, string[]>();
  for (const s of ctx.db.scene.iter()) outs.set(s.id, []);
  for (const s of ctx.db.scene.iter()) {
    const ch = [...ctx.db.choice.sceneId.filter(s.id)];
    if (ch.length && s.next) fail('BOTH', 0, s.id);
    if (s.next) {
      if (!outs.has(s.next)) fail('NOT_FOUND', 0, s.id);
      outs.get(s.id)!.push(s.next);
    }
    for (const c of ch) {
      if (c.target) {
        if (!outs.has(c.target)) fail('NOT_FOUND', 0, s.id);
        outs.get(s.id)!.push(c.target);
      }
    }
    let cast: { c: string; s: string }[];
    try { cast = JSON.parse(s.chars); } catch { fail('INVALID', 0, s.id); }
    if (!Array.isArray(cast)) fail('INVALID', 0, s.id);
    if (cast.length > MAX_CHARS) fail('TOO_MANY', 0, s.id);
    if (new Set(cast.map(x => x.c)).size !== cast.length) fail('DUP_CHAR', 0, s.id);
    if (s.kind !== 'narration' && s.kind !== 'dialogue') fail('INVALID', 0, s.id);
    if (s.kind === 'dialogue' && !cast.some(x => x.c === s.speaker)) fail('SPEAKER', 0, s.id);
  }
  for (const c of ctx.db.choice.iter()) if (!outs.has(c.sceneId)) fail('NOT_FOUND', 0, c.id);
  // Grafo acíclico: DFS com cores.
  const color = new Map<string, number>();
  const visit = (id: string): void => {
    color.set(id, 1);
    for (const n of outs.get(id) ?? []) {
      const k = color.get(n) ?? 0;
      if (k === 1) fail('CYCLE', 0, n);
      if (k === 0) visit(n);
    }
    color.set(id, 2);
  };
  for (const id of outs.keys()) if (!color.get(id)) visit(id);
}

export const apply_operations = spacetimedb.reducer({ ops: t.string() }, (ctx, { ops }) => {
  let list: Op[];
  try { list = JSON.parse(ops); } catch { fail('INVALID', 0); }
  if (!Array.isArray(list)) fail('INVALID', 0);
  list.forEach((o, i) => applyOp(ctx, o, i));
  validate(ctx);
});

// Apaga tudo e recria a história de exemplo enviada pelo cliente.
export const reset_story = spacetimedb.reducer(
  { title: t.string(), startScene: t.string(), ops: t.string() },
  (ctx, { title, startScene, ops }) => {
    for (const c of [...ctx.db.choice.iter()]) ctx.db.choice.id.delete(c.id);
    for (const s of [...ctx.db.scene.iter()]) ctx.db.scene.id.delete(s.id);
    for (const l of [...ctx.db.locks.iter()]) ctx.db.locks.target.delete(l.target);
    const st = ctx.db.story.id.find(STORY_ID);
    if (st) ctx.db.story.id.update({ id: STORY_ID, title, startScene });
    else ctx.db.story.insert({ id: STORY_ID, title, startScene });
    const list: Op[] = JSON.parse(ops);
    list.forEach((o, i) => applyOp(ctx, o, i));
    validate(ctx);
  }
);

// ---------- presença ----------
export const set_profile = spacetimedb.reducer({ name: t.string(), color: t.string() }, (ctx, { name, color }) => {
  const row = { identity: ctx.sender, name: name.slice(0, 40) || 'Anônimo', color };
  if (ctx.db.profile.identity.find(ctx.sender)) ctx.db.profile.identity.update(row);
  else ctx.db.profile.insert(row);
});

export const update_cursor = spacetimedb.reducer({ x: t.f64(), y: t.f64(), visible: t.bool() }, (ctx, { x, y, visible }) => {
  if (!ctx.connectionId) return;
  const p = ctx.db.presence.connectionId.find(ctx.connectionId);
  if (p) ctx.db.presence.connectionId.update({ ...p, cursorX: x, cursorY: y, hasCursor: visible, updatedAt: ctx.timestamp });
});

export const send_drag = spacetimedb.reducer({ moves: t.string(), done: t.bool() }, (ctx, { moves, done }) => {
  if (!ctx.connectionId) return;
  ctx.db.drags.insert({ connectionId: ctx.connectionId, identity: ctx.sender, moves, done });
});

// ---------- trava suave ----------
function takeLock(ctx: Ctx, target: string) {
  if (!ctx.connectionId) throw new SenderError('UNAUTHENTICATED');
  if (lockedByOther(ctx, target)) throw new SenderError('LOCKED');
  const row = {
    target, connectionId: ctx.connectionId, identity: ctx.sender,
    expiresAt: new Timestamp(ctx.timestamp.microsSinceUnixEpoch + LOCK_MICROS),
  };
  if (ctx.db.locks.target.find(target)) ctx.db.locks.target.update(row);
  else ctx.db.locks.insert(row);
}
export const lock_field = spacetimedb.reducer({ target: t.string() }, (ctx, { target }) => takeLock(ctx, target));
export const renew_field_lock = spacetimedb.reducer({ target: t.string() }, (ctx, { target }) => takeLock(ctx, target));
export const release_field = spacetimedb.reducer({ target: t.string() }, (ctx, { target }) => {
  const l = ctx.db.locks.target.find(target);
  if (l && ctx.connectionId && l.connectionId.isEqual(ctx.connectionId)) ctx.db.locks.target.delete(target);
});

export const sweep_locks = spacetimedb.reducer({ onSchedule: sweep }, { arg: sweep.rowType }, ctx => {
  for (const l of [...ctx.db.locks.iter()])
    if (l.expiresAt.microsSinceUnixEpoch < ctx.timestamp.microsSinceUnixEpoch) ctx.db.locks.target.delete(l.target);
});

// ---------- IA: fila do worker ----------
const AI_KINDS = new Set(['chat', 'character', 'background']);
const MINUTE = 60_000_000n;
const PROVIDER_TIMEOUT_MS = 30_000; // seção 2.6: cena sugerida e completar texto

function aiProvider(env: Ctx['env'] | PCtx['env']): string {
  const p = env.AI_PROVIDER;
  if (!p) throw new SenderError('AI_DISABLED');
  return p;
}

function checkRate(ctx: Ctx) {
  const limit = Number(ctx.env.AI_RATE_PER_MIN ?? '20') || 20;
  const now = ctx.timestamp;
  const r = ctx.db.aiRate.user.find(ctx.sender);
  if (!r || now.microsSinceUnixEpoch - r.windowStart.microsSinceUnixEpoch >= MINUTE) {
    const row = { user: ctx.sender, windowStart: now, count: 1 };
    if (r) ctx.db.aiRate.user.update(row);
    else ctx.db.aiRate.insert(row);
    return;
  }
  if (r.count >= limit) throw new SenderError('RATE_LIMITED');
  ctx.db.aiRate.user.update({ ...r, count: r.count + 1 });
}

function isWorker(ctx: { sender: Ctx['sender']; db: Ctx['db'] }): boolean {
  const w = ctx.db.config.key.find('worker_identity');
  return !!w && w.value === ctx.sender.toHexString();
}

function workerOnly(ctx: Ctx) {
  if (!isWorker(ctx)) throw new SenderError('FORBIDDEN');
}

function jobFor(ctx: Ctx, id: string) {
  const j = ctx.db.aiJob.id.find(id);
  if (!j) throw new SenderError('NOT_FOUND');
  return j;
}

export const request_ai = spacetimedb.reducer(
  { id: t.string(), kind: t.string(), input: t.string() },
  (ctx, { id, kind, input }) => {
    if (!AI_KINDS.has(kind)) throw new SenderError('INVALID');
    aiProvider(ctx.env);
    const cur = ctx.db.aiJob.id.find(id);
    if (cur) {
      // Reenvio após queda de conexão: mesmo pedido, nada a fazer.
      if (cur.requester.isEqual(ctx.sender) && cur.kind === kind) return;
      throw new SenderError('INVALID');
    }
    if (id.length > 64 || input.length > 200_000) throw new SenderError('INVALID');
    checkRate(ctx);
    ctx.db.aiJob.insert({
      id, requester: ctx.sender, kind, input, status: 'pending', result: '', error: '',
      createdAt: ctx.timestamp, updatedAt: ctx.timestamp,
    });
    if (kind === 'chat') {
      let text = '';
      try { text = String(JSON.parse(input).message ?? ''); } catch { throw new SenderError('INVALID'); }
      ctx.db.chatMessage.insert({
        id: id + ':u', user: ctx.sender, jobId: id, role: 'user', content: text, proposals: '[]', createdAt: ctx.timestamp,
      });
    }
  }
);

// O worker prova quem é com WORKER_SECRET; a identidade dele fica em config.
export const register_worker = spacetimedb.reducer({ secret: t.string() }, (ctx, { secret }) => {
  const expected = ctx.env.WORKER_SECRET;
  if (!expected || secret !== expected) throw new SenderError('FORBIDDEN');
  const row = { key: 'worker_identity', value: ctx.sender.toHexString() };
  if (ctx.db.config.key.find(row.key)) ctx.db.config.key.update(row);
  else ctx.db.config.insert(row);
});

export const claim_job = spacetimedb.reducer({ id: t.string() }, (ctx, { id }) => {
  workerOnly(ctx);
  const j = jobFor(ctx, id);
  if (j.status !== 'pending') throw new SenderError('CLAIMED');
  ctx.db.aiJob.id.update({ ...j, status: 'running', updatedAt: ctx.timestamp });
});

export const push_chat_chunk = spacetimedb.reducer(
  { jobId: t.string(), seq: t.u32(), text: t.string() },
  (ctx, { jobId, seq, text }) => {
    workerOnly(ctx);
    const j = jobFor(ctx, jobId);
    if (j.kind !== 'chat' || j.status !== 'running') throw new SenderError('INVALID');
    ctx.db.chatChunk.insert({ jobId, requester: j.requester, seq, text });
  }
);

export const complete_job = spacetimedb.reducer({ id: t.string(), result: t.string() }, (ctx, { id, result }) => {
  workerOnly(ctx);
  const j = jobFor(ctx, id);
  if (j.status !== 'running') throw new SenderError('INVALID');
  ctx.db.aiJob.id.update({ ...j, status: 'done', result, updatedAt: ctx.timestamp });
  if (j.kind === 'chat') {
    let r: { content?: string; proposals?: unknown[] };
    try { r = JSON.parse(result); } catch { throw new SenderError('INVALID'); }
    ctx.db.chatMessage.insert({
      id: id + ':a', user: j.requester, jobId: id, role: 'assistant', content: String(r.content ?? ''),
      proposals: JSON.stringify(r.proposals ?? []), createdAt: ctx.timestamp,
    });
  }
});

export const fail_job = spacetimedb.reducer({ id: t.string(), error: t.string() }, (ctx, { id, error }) => {
  workerOnly(ctx);
  const j = jobFor(ctx, id);
  if (j.status === 'done' || j.status === 'failed') return;
  ctx.db.aiJob.id.update({ ...j, status: 'failed', error: error.slice(0, 200), updatedAt: ctx.timestamp });
});

// Cada pessoa vê só os próprios pedidos e conversas; o worker vê a fila inteira.
export const my_ai_job = spacetimedb.view({ public: true }, t.array(aiJob.rowType), ctx => [
  ...ctx.db.aiJob.requester.filter(ctx.sender),
]);
export const my_chat_message = spacetimedb.view({ public: true }, t.array(chatMessage.rowType), ctx => [
  ...ctx.db.chatMessage.user.filter(ctx.sender),
]);
export const worker_queue = spacetimedb.view({ public: true }, t.array(aiJob.rowType), ctx =>
  isWorker(ctx as any) ? [...ctx.db.aiJob.status.filter('pending'), ...ctx.db.aiJob.status.filter('running')] : []
);

// ---------- IA: procedures de texto ----------
// Contexto que o cliente envia (no spike, elenco e backgrounds ficam no cliente).
type AiContext = {
  characters: { id: string; name: string; desc?: string; sprites: { id: string; name: string; desc?: string }[] }[];
  backgrounds: { id: string; name: string; desc?: string }[];
};

function parseContext(raw: string): AiContext {
  try {
    const c = JSON.parse(raw);
    return { characters: Array.isArray(c.characters) ? c.characters : [], backgrounds: Array.isArray(c.backgrounds) ? c.backgrounds : [] };
  } catch { throw new SenderError('INVALID'); }
}

// Latência do provedor: no modo mock, uma ida real pela rede (ctx.http.fetch) a um endpoint
// lento, como faria a chamada ao provedor. ctx.sleep não existe neste runtime.
function mockLatency(ctx: PCtx) {
  const url = ctx.env.AI_MOCK_LATENCY_URL;
  if (!url) return;
  try {
    ctx.http.fetch(url, { timeout: TimeDuration.fromMillis(PROVIDER_TIMEOUT_MS) });
  } catch (e) {
    // Inclui o motivo (ex.: endereço privado recusado, tempo esgotado) para diagnóstico.
    throw new SenderError('AI_PROVIDER_ERROR:' + String((e as Error)?.message ?? e).slice(0, 120));
  }
}

// Falha simulada: uma instrução com "#falha" faz o provedor falso falhar, para testar o caminho de erro.
function mockMaybeFail(instruction: string) {
  if (/#falha/i.test(instruction)) throw new SenderError('AI_PROVIDER_ERROR');
}

const pickOf = <T>(ctx: PCtx, a: T[]): T => a[Math.floor(ctx.random() * a.length)];
const norm = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function mockSprite(ctx: PCtx, sprites: { id: string; name: string; desc?: string }[], mood: string) {
  const want = mood === 'tense' ? ['surpre', 'brav', 'trist', 'pensat'] : ['feliz', 'sorri', 'neutro'];
  return (sprites.find(s => want.some(w => norm(s.name + ' ' + (s.desc ?? '')).includes(w))) ?? pickOf(ctx, sprites)).id;
}

function mockScene(ctx: PCtx, src: { title: string; text: string; bg: string } | undefined, label: string, instruction: string, cx: AiContext) {
  const pool = cx.characters.filter(c => c.sprites.length);
  const mood = /tens|medo|susp|briga/.test(norm(instruction)) ? 'tense' : ctx.random() < 0.5 ? 'tense' : 'warm';
  const cast = ctx.random.shuffle([...pool]).slice(0, Math.min(pool.length, 1 + Math.floor(ctx.random() * 3)));
  const bgIds = new Set(cx.backgrounds.map(b => b.id));
  const bg = src && src.bg && bgIds.has(src.bg) && ctx.random() < 0.5 ? src.bg : cx.backgrounds.length ? pickOf(ctx, cx.backgrounds).id : '';
  const bgName = cx.backgrounds.find(b => b.id === bg)?.name ?? '';
  const dialogue = cast.length > 0 && ctx.random() < 0.7;
  const speaker = dialogue ? pickOf(ctx, cast) : null;
  const lines = mood === 'tense'
    ? ['Você também ouviu isso? Veio de perto do farol.', 'Não era pra ninguém saber disso… quem te contou?', 'Espera. Tem alguma coisa errada aqui.']
    : ['Que bom que você veio. Eu estava te esperando.', 'Vamos, antes que escureça de vez.', 'Lembra quando a gente vinha aqui todo fim de tarde?'];
  const narr = [
    `${bgName ? bgName + '.' : 'O lugar está quieto.'} O vento traz cheiro de sal e algo que ninguém sabe nomear.`,
    `Por um instante, tudo fica em silêncio. ${label ? `A decisão de “${label}” pesa no ar.` : ''}`.trim(),
  ];
  return {
    title: label || (speaker ? 'Conversa com ' + speaker.name : 'Silêncio'),
    background_id: bg,
    characters: cast.map(c => ({ character_id: c.id, sprite_id: mockSprite(ctx, c.sprites, mood) })),
    text_kind: dialogue ? 'dialogue' : 'narration',
    speaker_character_id: speaker ? speaker.id : '',
    body: dialogue ? pickOf(ctx, lines) : pickOf(ctx, narr),
    // Rótulo para a ação que leva a esta cena, usado quando a ação ainda não tem texto (Shift em "+ ação").
    action_label: pickOf(ctx, ['Seguir o barulho', 'Ficar e conversar', 'Voltar para a vila', 'Investigar sozinha']),
  };
}

// Mesmas regras da cena que o reducer aplica: ids do contexto, até 6, falante na cena.
function checkSuggested(s: ReturnType<typeof mockScene>, cx: AiContext) {
  const chars = new Map(cx.characters.map(c => [c.id, c]));
  if (s.background_id && !cx.backgrounds.some(b => b.id === s.background_id)) throw new SenderError('AI_INVALID_OUTPUT');
  if (s.characters.length > MAX_CHARS) throw new SenderError('AI_INVALID_OUTPUT');
  if (new Set(s.characters.map(c => c.character_id)).size !== s.characters.length) throw new SenderError('AI_INVALID_OUTPUT');
  for (const c of s.characters) {
    const ch = chars.get(c.character_id);
    if (!ch || !ch.sprites.some(sp => sp.id === c.sprite_id)) throw new SenderError('AI_INVALID_OUTPUT');
  }
  if (s.text_kind === 'dialogue' && !s.characters.some(c => c.character_id === s.speaker_character_id)) throw new SenderError('AI_INVALID_OUTPUT');
}

function rateFromProcedure(ctx: PCtx) {
  ctx.withTx(tx => checkRate(tx as unknown as Ctx));
}

// Procedures devolvem {"ok": ...} ou {"error": "CÓDIGO"} em vez de lançar: um erro lançado numa
// procedure aparece como "fatal error" da instância do módulo, e um provedor fora do ar é rotina.
function envelope(run: () => Record<string, unknown>): string {
  try {
    return JSON.stringify({ ok: true, ...run() });
  } catch (e) {
    const m = String((e as Error)?.message ?? e);
    return JSON.stringify({ error: e instanceof SenderError ? m : 'INTERNAL', detail: e instanceof SenderError ? undefined : m.slice(0, 200) });
  }
}

// Monta a cena inteira para uma saída. Não grava nada: o cliente aplica com apply_operations.
export const suggest_scene = spacetimedb.procedure(
  { sourceSceneId: t.string(), choiceId: t.string(), instruction: t.string(), newSceneId: t.string(), context: t.string() },
  t.string(),
  (ctx, { sourceSceneId, choiceId, instruction, context }) => envelope(() => {
    const provider = aiProvider(ctx.env);
    const cx = parseContext(context);
    rateFromProcedure(ctx);
    const { src, label } = ctx.withTx(tx => {
      const s = tx.db.scene.id.find(sourceSceneId);
      const c = choiceId ? tx.db.choice.id.find(choiceId) : undefined;
      return { src: s ? { title: s.title, text: s.text, bg: s.bg } : undefined, label: c ? c.label : '' };
    });
    if (!src) throw new SenderError('NOT_FOUND');
    if (provider !== 'mock') throw new SenderError('AI_DISABLED'); // provedores reais: integração pendente
    mockLatency(ctx);
    mockMaybeFail(instruction);
    const out = mockScene(ctx, src, label, instruction, cx);
    checkSuggested(out, cx);
    return { scene: out };
  })
);

// Continua (ou reescreve) o texto de uma cena. Não grava nada: só após o autor aceitar.
export const complete_text = spacetimedb.procedure(
  { sceneId: t.string(), text: t.string(), textKind: t.string(), speakerName: t.string(), instruction: t.string() },
  t.string(),
  (ctx, { text, textKind, speakerName, instruction }) => envelope(() => {
    const provider = aiProvider(ctx.env);
    rateFromProcedure(ctx);
    if (provider !== 'mock') throw new SenderError('AI_DISABLED');
    mockLatency(ctx);
    mockMaybeFail(instruction);
    const tense = /tens|medo|susp/.test(norm(instruction));
    const add = textKind === 'dialogue'
      ? pickOf(ctx, tense ? [' …Não olha agora, mas tem alguém atrás de você.', ' Fala baixo. As paredes daqui escutam.'] : [' …E dessa vez eu não vou fugir.', ` Confia em mim${speakerName ? ', é a ' + speakerName + ' falando' : ''}.`])
      : pickOf(ctx, tense ? [' Um estalo seco ecoa nas pedras, e a luz treme.', ' Algo se move na água escura, rápido demais.'] : [' Uma gaivota corta o céu e some atrás das pedras.', ' O cheiro de café fresco chega da vila.']);
    return { text: (text.trimEnd() + add).trimStart() };
  })
);

// ---------- ciclo de vida ----------
export const init = spacetimedb.init(ctx => {
  ctx.db.sweep.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(10_000_000n) });
});

export const ping = spacetimedb.reducer(_ctx => {});

export const on_connect = spacetimedb.clientConnected(ctx => {
  if (!ctx.connectionId) return;
  ctx.db.presence.insert({
    connectionId: ctx.connectionId, identity: ctx.sender, cursorX: 0, cursorY: 0, hasCursor: false, updatedAt: ctx.timestamp,
  });
});

export const on_disconnect = spacetimedb.clientDisconnected(ctx => {
  if (!ctx.connectionId) return;
  ctx.db.presence.connectionId.delete(ctx.connectionId);
  for (const l of [...ctx.db.locks.iter()]) if (l.connectionId.isEqual(ctx.connectionId)) ctx.db.locks.target.delete(l.target);
});
