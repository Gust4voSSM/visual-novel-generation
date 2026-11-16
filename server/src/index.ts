// Roteiro VN — spike do módulo SpacetimeDB.
// Cobre: grafo de cenas com validação no servidor (ciclo, 6 personagens, falante,
// ações x saída única, cena inicial), presença com cursores, arrasto ao vivo por
// tabela de eventos e trava suave de campos de texto. Elenco (personagens, sprites,
// backgrounds e charsheets) em tabelas por história, com as imagens só como links.
// IA (seção 2.6): procedures suggest_scene/complete_text e fila ai_job para o worker.
// Com AI_PROVIDER=mock tudo responde com conteúdo simulado; sem AI_PROVIDER, AI_DISABLED.
// Contas: login Google (o ID token é o token da conexão; o módulo confere iss e aud).
// Cada história tem dono e membros; as tabelas do grafo são privadas e o cliente lê pelas
// views cur_* (história aberta por ele em open_story) e my_* (as dele).
import { schema, table, t, SenderError, ScheduleAt, type ReducerCtx, type ProcedureCtx, type InferSchema } from 'spacetimedb/server';
import { Identity, Timestamp, TimeDuration } from 'spacetimedb';

// Quem entrou com Google. Privada: membros de uma mesma história se veem por cur_account.
const account = table(
  {},
  {
    identity: t.identity().primaryKey(),
    email: t.string().index('btree'), // '' se o Google não confirmou o e-mail
    name: t.string(),
    picture: t.string(),
    createdAt: t.timestamp(),
    lastSeenAt: t.timestamp(),
  }
);

const story = table(
  {},
  {
    id: t.string().primaryKey(), // gerado no cliente: repetir create_story não duplica
    ownerId: t.identity().index('btree'),
    title: t.string(),
    startScene: t.string(),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
  }
);

// Um par (storyId, userId) por linha; o dono também é membro, com role 'owner'.
const storyMember = table(
  {},
  {
    id: t.u64().primaryKey().autoInc(),
    storyId: t.string().index('btree'),
    userId: t.identity().index('btree'),
    role: t.string(), // 'owner' | 'editor' | 'viewer'
  }
);

// Convite para um e-mail que ainda não entrou; vira membro no primeiro login.
const storyInvite = table(
  {},
  {
    id: t.u64().primaryKey().autoInc(),
    storyId: t.string().index('btree'),
    email: t.string().index('btree'),
    role: t.string(),
    createdAt: t.timestamp(),
  }
);

// "Qualquer pessoa com o link": sem linha, a história é restrita a membros e convites.
// O código vem do cliente (crypto.getRandomValues): o RNG dos reducers é determinístico.
const storyLink = table(
  {},
  {
    storyId: t.string().primaryKey(),
    code: t.string().unique(),
    role: t.string(), // 'editor' | 'viewer'
    createdAt: t.timestamp(),
  }
);

// Membros que entraram pelo link: perdem o acesso quando o link é desligado ou trocado.
const linkJoin = table(
  {},
  {
    id: t.u64().primaryKey().autoInc(),
    storyId: t.string().index('btree'),
    userId: t.identity().index('btree'),
  }
);

// História aberta por cada pessoa; define o que as views cur_* devolvem.
const activeStory = table(
  {},
  {
    identity: t.identity().primaryKey(),
    storyId: t.string().index('btree'),
  }
);

const scene = table(
  {},
  {
    id: t.string().primaryKey(),
    storyId: t.string().index('btree'),
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
  {},
  {
    id: t.string().primaryKey(),
    storyId: t.string().index('btree'),
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
  {},
  {
    connectionId: t.connectionId().primaryKey(),
    identity: t.identity().index('btree'),
    storyId: t.string().index('btree'), // '' = fora de qualquer história
    cursorX: t.f64(),
    cursorY: t.f64(),
    hasCursor: t.bool(),
    updatedAt: t.timestamp(),
  }
);

// Tabela de eventos: as linhas chegam aos assinantes e não ficam salvas. Views não cobrem
// tabelas de eventos, então é pública e o cliente assina WHERE story_id = '<id>'.
const drags = table(
  { public: true, event: true },
  {
    storyId: t.string(),
    connectionId: t.connectionId(),
    identity: t.identity(),
    moves: t.string(), // JSON [[sceneId, x, y], ...]
    done: t.bool(),
  }
);

const locks = table(
  {},
  {
    target: t.string().primaryKey(), // ex.: scene:<id>:text, choice:<id>:label, story:<id>:title
    storyId: t.string().index('btree'),
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
    storyId: t.string().index('btree'),
    kind: t.string(), // 'chat' | 'character' | 'background'
    input: t.string(), // JSON
    status: t.string().index('btree'), // 'pending' | 'running' | 'done' | 'failed'
    result: t.string(), // JSON
    error: t.string(),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
  }
);

// Conversa e propostas; cada pessoa vê só a própria, da história aberta (view my_chat_message).
const chatMessage = table(
  {},
  {
    id: t.string().primaryKey(),
    user: t.identity().index('btree'),
    storyId: t.string().index('btree'),
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

// ---------- elenco ----------
// Personagens, sprites e backgrounds de cada história. As imagens são só links (image_key: caminho
// relativo à base pública de imagens, ex. img/<hex>.png no KV das Pages Functions), nunca bytes.
// O autor edita os campos de texto e envia imagens por apply_operations; status, error e sheetId
// só mudam pelos reducers de geração e pelo worker (complete_job/fail_job).
const character = table(
  {},
  {
    id: t.string().primaryKey(),
    storyId: t.string().index('btree'),
    name: t.string(),
    desc: t.string(),
    color: t.string(),
    source: t.string(), // 'upload' | 'ai' | 'marketplace' | 'example'
    sheetId: t.string(), // charsheet gerado (front + side); '' = sem charsheet
    status: t.string(), // '' | 'generating' | 'failed'
    error: t.string(),
    createdAt: t.timestamp(),
  }
);

const sprite = table(
  {},
  {
    id: t.string().primaryKey(),
    storyId: t.string().index('btree'),
    characterId: t.string().index('btree'),
    name: t.string(),
    desc: t.string(),
    imageKey: t.string(), // '' enquanto a pose não fica pronta
    position: t.u32(),
    status: t.string(), // '' | 'pending' (espera o charsheet) | 'generating' | 'failed'
    error: t.string(),
    meta: t.string(), // JSON do worker: caminho (keyed/native) e se passou nas verificações
  }
);

const background = table(
  {},
  {
    id: t.string().primaryKey(),
    storyId: t.string().index('btree'),
    name: t.string(),
    desc: t.string(),
    imageKey: t.string(),
    baseKey: t.string(), // base 1536×1024 gerada, para variantes
    source: t.string(),
    status: t.string(), // '' | 'generating' | 'failed'
    error: t.string(),
    createdAt: t.timestamp(),
    // Prompt da imagem gerada, JSON {scene, time, mood}: o do agente do chat, ou o que a melhoria escreveu.
    // '' em upload, marketplace, ou depois que o autor muda a descrição ou a imagem. Regenerar reaproveita.
    prompt: t.string().default(''),
  }
);

// Referências de um personagem gerado (PLANO-SPRITES-BACKGROUNDS.md, seção 2). Só o worker grava.
const charsheet = table(
  {},
  {
    id: t.string().primaryKey(),
    storyId: t.string().index('btree'),
    characterId: t.string().index('btree'),
    design: t.string(),
    front: t.string(),
    side: t.string(),
    keyColor: t.string(), // '' = só o caminho nativo
    keyScores: t.string(), // JSON
    unit: t.string(), // JSON: altura e linha dos pés do front
    createdAt: t.timestamp(),
  }
);

const spacetimedb = schema(
  {
    account, story, storyMember, storyInvite, storyLink, linkJoin, activeStory, scene, choice, profile, presence, drags, locks, sweep,
    aiJob, chatMessage, chatChunk, aiRate, config, character, sprite, background, charsheet,
  },
  {
    // Definidos na publicação (variáveis de ambiente do shell). Sem AI_PROVIDER, a IA fica desabilitada.
    env: {
      GOOGLE_CLIENT_ID: t.option(t.string()), // aud esperado no ID token do Google
      AUTH_DEV_ANON: t.option(t.string()), // '1': aceita conexões anônimas (só local e testes, nunca em produção)
      AI_PROVIDER: t.option(t.string()), // 'mock' | 'openai' | 'google'
      AI_MOCK_LATENCY_URL: t.option(t.string()), // modo mock: endpoint lento que simula a latência do provedor
      AI_RATE_PER_MIN: t.option(t.string()),
      WORKER_SECRET: t.option(t.string()), // o worker se registra com ele em register_worker
    },
  }
);
export default spacetimedb;

const MAX_CHARS = 6;
const LOCK_MICROS = 15_000_000n;

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;
type PCtx = ProcedureCtx<InferSchema<typeof spacetimedb>>;
type Db = Ctx['db'];
// Só o que as views (somente leitura) e os reducers usam em comum.
type MemberRow = { id: bigint; storyId: string; userId: Identity; role: string };
type MemberDb = { storyMember: { userId: { filter(u: Identity): Iterable<MemberRow> } } };

// ---------- contas ----------
const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
const ROLE_RANK: Record<string, number> = { viewer: 0, editor: 1, owner: 2 };
type Role = 'viewer' | 'editor' | 'owner';

// Dados da conta se a conexão veio com um ID token do Google para este app; null caso contrário.
// Sem conferir aud, um ID token emitido para qualquer outro app do Google seria aceito.
function accountClaims(ctx: Ctx): { email: string; name: string; picture: string } | null {
  const jwt = ctx.senderAuth.jwt;
  if (jwt && GOOGLE_ISSUERS.has(jwt.issuer)) {
    const aud = ctx.env.GOOGLE_CLIENT_ID;
    if (!aud || !jwt.audience.includes(aud)) return null;
    const p = jwt.fullPayload as Record<string, unknown>;
    return {
      email: p.email_verified === true ? String(p.email ?? '').toLowerCase() : '',
      name: String(p.name ?? '').slice(0, 80),
      picture: String(p.picture ?? '').slice(0, 500),
    };
  }
  // Desenvolvimento e testes: identidade anônima com um e-mail fictício, para poder compartilhar.
  if (ctx.env.AUTH_DEV_ANON === '1') return { email: `anon-${ctx.sender.toHexString().slice(0, 12)}@dev.local`, name: '', picture: '' };
  return null;
}

function requireUser(ctx: Ctx) {
  if (!accountClaims(ctx) || !ctx.db.account.identity.find(ctx.sender)) throw new SenderError('UNAUTHENTICATED');
}

function memberOf(db: MemberDb, storyId: string, user: Identity): MemberRow | undefined {
  for (const m of db.storyMember.userId.filter(user)) if (m.storyId === storyId) return m;
  return undefined;
}

const hasRole = (db: MemberDb, storyId: string, user: Identity, min: Role) => {
  const m = memberOf(db, storyId, user);
  return !!m && ROLE_RANK[m.role] >= ROLE_RANK[min];
};

// NOT_FOUND também para quem não é membro: não revela se a história existe.
function requireRole(ctx: Ctx, storyId: string, min: Role) {
  requireUser(ctx);
  const st = ctx.db.story.id.find(storyId);
  const m = st && memberOf(ctx.db, storyId, ctx.sender);
  if (!st || !m) throw new SenderError('NOT_FOUND');
  if (ROLE_RANK[m.role] < ROLE_RANK[min]) throw new SenderError('FORBIDDEN');
  return st;
}

// ---------- operações ----------
// Cada operação grava valores finais, então repetir o mesmo lote é seguro.
type Op =
  | { op: 'upsert_scene'; scene: Record<string, unknown> & { id: string } }
  | { op: 'delete_scene'; id: string }
  | { op: 'upsert_choice'; choice: Record<string, unknown> & { id: string } }
  | { op: 'delete_choice'; id: string }
  | { op: 'set_start'; id: string }
  | { op: 'set_title'; title: string }
  | { op: 'upsert_character'; character: Record<string, unknown> & { id: string } }
  | { op: 'delete_character'; id: string }
  | { op: 'upsert_sprite'; sprite: Record<string, unknown> & { id: string } }
  | { op: 'delete_sprite'; id: string }
  | { op: 'upsert_background'; background: Record<string, unknown> & { id: string } }
  | { op: 'delete_background'; id: string };

// Só links para imagens servidas pelo próprio app: nada de data: nem URLs de outros sites.
//   img/<hex>         KV das Pages Functions (uploads e imagens geradas)
//   generated/<hex>   disco local do worker (experimentos antigos)
//   placeholders/…    imagens do modo mock
//   example/…         elenco da história de exemplo e do marketplace (client/public/example)
const IMAGE_KEY_RE = /^(?:img\/[0-9a-f]{32}\.(?:png|jpg|webp)|generated\/[0-9a-f]{32}\.(?:png|jpg|webp)|placeholders\/[\w-]{1,40}\.svg|example\/[\w-]{1,60}\.svg)$/;
const imageKeyOk = (k: unknown) => k === '' || (typeof k === 'string' && IMAGE_KEY_RE.test(k));
const CAST_SOURCES = new Set(['upload', 'ai', 'marketplace', 'example']);
const str = (v: unknown, max: number) => String(v ?? '').slice(0, max);

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

// Ids de cena e ação são globais: um lote só mexe em linhas da própria história.
function ownScene(ctx: Ctx, storyId: string, id: string, i: number) {
  const cur = ctx.db.scene.id.find(id);
  if (cur && cur.storyId !== storyId) fail('FORBIDDEN', i, id);
  return cur;
}

function ownChoice(ctx: Ctx, storyId: string, id: string, i: number) {
  const cur = ctx.db.choice.id.find(id);
  if (cur && cur.storyId !== storyId) fail('FORBIDDEN', i, id);
  return cur;
}

const validId = (id: unknown): id is string => typeof id === 'string' && !!id && id.length <= 64;

function castOf(s: { chars: string }): { c: string; s: string }[] {
  try { const a = JSON.parse(s.chars); return Array.isArray(a) ? a : []; } catch { return []; }
}

// Não se apaga do elenco o que uma cena da história usa (o cliente avisa antes).
function sceneUsing(ctx: Ctx, storyId: string, uses: (s: { bg: string; chars: string }) => boolean) {
  for (const s of ctx.db.scene.storyId.filter(storyId)) if (uses(s)) return true;
  return false;
}

function deleteCharacter(ctx: Ctx, id: string) {
  for (const sp of [...ctx.db.sprite.characterId.filter(id)]) ctx.db.sprite.id.delete(sp.id);
  for (const cs of [...ctx.db.charsheet.characterId.filter(id)]) ctx.db.charsheet.id.delete(cs.id);
  ctx.db.character.id.delete(id);
}

function applyOp(ctx: Ctx, storyId: string, o: Op, i: number) {
  switch (o.op) {
    case 'upsert_scene': {
      if (typeof o.scene?.id !== 'string' || !o.scene.id || o.scene.id.length > 64) fail('INVALID', i);
      const cur = ownScene(ctx, storyId, o.scene.id, i);
      for (const f of TEXT_FIELDS)
        if (f in o.scene && cur && (cur as any)[f] !== o.scene[f] && lockedByOther(ctx, `scene:${o.scene.id}:${f}`))
          fail('LOCKED', i, o.scene.id);
      const base = cur ?? {
        id: o.scene.id, storyId, title: 'Nova cena', x: 0, y: 0, bg: '', chars: '[]', kind: 'narration',
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
      const st = ctx.db.story.id.find(storyId);
      if (st && st.startScene === o.id) fail('START', i);
      if (!ownScene(ctx, storyId, o.id, i)) break; // já apagada: nada a fazer
      ctx.db.scene.id.delete(o.id);
      for (const c of [...ctx.db.choice.sceneId.filter(o.id)]) ctx.db.choice.id.delete(c.id);
      // Excluir uma cena zera os destinos que apontam para ela.
      for (const s of [...ctx.db.scene.storyId.filter(storyId)]) if (s.next === o.id) ctx.db.scene.id.update({ ...s, next: '' });
      for (const c of [...ctx.db.choice.storyId.filter(storyId)]) if (c.target === o.id) ctx.db.choice.id.update({ ...c, target: '' });
      break;
    }
    case 'upsert_choice': {
      if (typeof o.choice?.id !== 'string' || !o.choice.id || o.choice.id.length > 64) fail('INVALID', i);
      const cur = ownChoice(ctx, storyId, o.choice.id, i);
      if ('label' in o.choice && cur && cur.label !== o.choice.label && lockedByOther(ctx, `choice:${o.choice.id}:label`))
        fail('LOCKED', i, o.choice.id);
      const row: any = { ...(cur ?? { id: o.choice.id, storyId, sceneId: '', label: '', target: '', position: 0 }) };
      for (const f of ['sceneId', 'label', 'target', 'position']) if (f in o.choice) row[f] = o.choice[f] ?? (f === 'position' ? 0 : '');
      if (cur) ctx.db.choice.id.update(row);
      else ctx.db.choice.insert(row);
      break;
    }
    case 'delete_choice':
      if (ownChoice(ctx, storyId, o.id, i)) ctx.db.choice.id.delete(o.id);
      break;
    case 'set_start': {
      const st = ctx.db.story.id.find(storyId);
      if (st) ctx.db.story.id.update({ ...st, startScene: o.id });
      break;
    }
    case 'set_title': {
      if (lockedByOther(ctx, `story:${storyId}:title`)) fail('LOCKED', i, 'story');
      const st = ctx.db.story.id.find(storyId);
      if (st) ctx.db.story.id.update({ ...st, title: String(o.title ?? '').slice(0, 200) });
      break;
    }
    case 'upsert_character': {
      const v = o.character;
      if (!validId(v?.id)) fail('INVALID', i);
      const cur = ctx.db.character.id.find(v.id);
      if (cur && cur.storyId !== storyId) fail('FORBIDDEN', i, v.id);
      if ('source' in v && !CAST_SOURCES.has(String(v.source))) fail('INVALID', i, v.id);
      const row = cur ? { ...cur } : {
        id: v.id, storyId, name: 'Novo personagem', desc: '', color: '', source: 'upload', sheetId: '', status: '', error: '', createdAt: ctx.timestamp,
      };
      if ('name' in v) row.name = str(v.name, 80);
      if ('desc' in v) row.desc = str(v.desc, 2000);
      if ('color' in v) row.color = str(v.color, 20);
      if ('source' in v) row.source = String(v.source);
      if (cur) ctx.db.character.id.update(row);
      else ctx.db.character.insert(row);
      break;
    }
    case 'delete_character': {
      const cur = ctx.db.character.id.find(o.id);
      if (!cur) break;
      if (cur.storyId !== storyId) fail('FORBIDDEN', i, o.id);
      if (sceneUsing(ctx, storyId, s => castOf(s).some(x => x.c === o.id))) fail('USED', i, o.id);
      deleteCharacter(ctx, o.id);
      break;
    }
    case 'upsert_sprite': {
      const v = o.sprite;
      if (!validId(v?.id)) fail('INVALID', i);
      const cur = ctx.db.sprite.id.find(v.id);
      if (cur && cur.storyId !== storyId) fail('FORBIDDEN', i, v.id);
      const characterId = 'characterId' in v ? String(v.characterId) : cur?.characterId ?? '';
      const ch = ctx.db.character.id.find(characterId);
      if (!ch || ch.storyId !== storyId) fail('NOT_FOUND', i, v.id);
      if ('imageKey' in v && !imageKeyOk(v.imageKey)) fail('INVALID', i, v.id);
      const row = cur ? { ...cur } : {
        id: v.id, storyId, characterId, name: 'Nova emoção', desc: '', imageKey: '', position: 0, status: '', error: '', meta: '',
      };
      row.characterId = characterId;
      if ('name' in v) row.name = str(v.name, 80);
      if ('desc' in v) row.desc = str(v.desc, 1000);
      if ('position' in v) row.position = Math.max(0, Math.min(10_000, Math.floor(Number(v.position) || 0)));
      // Imagem enviada pelo autor: a pose fica pronta, mesmo que estivesse gerando ou falhada.
      if ('imageKey' in v && v.imageKey !== row.imageKey) Object.assign(row, { imageKey: String(v.imageKey), status: '', error: '', meta: '' });
      if (cur) ctx.db.sprite.id.update(row);
      else ctx.db.sprite.insert(row);
      break;
    }
    case 'delete_sprite': {
      const cur = ctx.db.sprite.id.find(o.id);
      if (!cur) break;
      if (cur.storyId !== storyId) fail('FORBIDDEN', i, o.id);
      if (sceneUsing(ctx, storyId, s => castOf(s).some(x => x.s === o.id))) fail('USED', i, o.id);
      ctx.db.sprite.id.delete(o.id);
      break;
    }
    case 'upsert_background': {
      const v = o.background;
      if (!validId(v?.id)) fail('INVALID', i);
      const cur = ctx.db.background.id.find(v.id);
      if (cur && cur.storyId !== storyId) fail('FORBIDDEN', i, v.id);
      if ('imageKey' in v && !imageKeyOk(v.imageKey)) fail('INVALID', i, v.id);
      if ('source' in v && !CAST_SOURCES.has(String(v.source))) fail('INVALID', i, v.id);
      const row = cur ? { ...cur } : {
        id: v.id, storyId, name: 'Background', desc: '', imageKey: '', baseKey: '', source: 'upload', status: '', error: '', createdAt: ctx.timestamp, prompt: '',
      };
      if ('name' in v) row.name = str(v.name, 80);
      if ('desc' in v && str(v.desc, 2000) !== row.desc) Object.assign(row, { desc: str(v.desc, 2000), prompt: '' });
      if ('source' in v) row.source = String(v.source);
      if ('imageKey' in v && v.imageKey !== row.imageKey) Object.assign(row, { imageKey: String(v.imageKey), baseKey: '', status: '', error: '', prompt: '' });
      if (cur) ctx.db.background.id.update(row);
      else ctx.db.background.insert(row);
      break;
    }
    case 'delete_background': {
      const cur = ctx.db.background.id.find(o.id);
      if (!cur) break;
      if (cur.storyId !== storyId) fail('FORBIDDEN', i, o.id);
      if (sceneUsing(ctx, storyId, s => s.bg === o.id)) fail('USED', i, o.id);
      ctx.db.background.id.delete(o.id);
      break;
    }
    default:
      fail('INVALID', i);
  }
}

// Regras do grafo e da cena, contra o estado já com o lote aplicado.
// Só a história do lote: as outras não mudaram e não pesam no custo.
function validate(ctx: Ctx, storyId: string) {
  const st = ctx.db.story.id.find(storyId);
  const start = st && ctx.db.scene.id.find(st.startScene);
  if (!start || start.storyId !== storyId) fail('NO_START', 0);
  const scenes = [...ctx.db.scene.storyId.filter(storyId)];
  const outs = new Map<string, string[]>();
  for (const s of scenes) outs.set(s.id, []);
  for (const s of scenes) {
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
  for (const c of ctx.db.choice.storyId.filter(storyId)) if (!outs.has(c.sceneId)) fail('NOT_FOUND', 0, c.id);
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

function parseOps(ops: string): Op[] {
  let list: Op[];
  try { list = JSON.parse(ops); } catch { fail('INVALID', 0); }
  if (!Array.isArray(list)) fail('INVALID', 0);
  return list;
}

function touchStory(ctx: Ctx, storyId: string) {
  const st = ctx.db.story.id.find(storyId);
  if (st) ctx.db.story.id.update({ ...st, updatedAt: ctx.timestamp });
}

export const apply_operations = spacetimedb.reducer({ storyId: t.string(), ops: t.string() }, (ctx, { storyId, ops }) => {
  requireRole(ctx, storyId, 'editor');
  parseOps(ops).forEach((o, i) => applyOp(ctx, storyId, o, i));
  validate(ctx, storyId);
  touchStory(ctx, storyId);
});

// ---------- histórias ----------
function clearGraph(ctx: Ctx, storyId: string) {
  for (const c of [...ctx.db.choice.storyId.filter(storyId)]) ctx.db.choice.id.delete(c.id);
  for (const s of [...ctx.db.scene.storyId.filter(storyId)]) ctx.db.scene.id.delete(s.id);
  for (const l of [...ctx.db.locks.storyId.filter(storyId)]) ctx.db.locks.target.delete(l.target);
}

function clearCast(ctx: Ctx, storyId: string) {
  for (const r of [...ctx.db.sprite.storyId.filter(storyId)]) ctx.db.sprite.id.delete(r.id);
  for (const r of [...ctx.db.charsheet.storyId.filter(storyId)]) ctx.db.charsheet.id.delete(r.id);
  for (const r of [...ctx.db.character.storyId.filter(storyId)]) ctx.db.character.id.delete(r.id);
  for (const r of [...ctx.db.background.storyId.filter(storyId)]) ctx.db.background.id.delete(r.id);
}

// Cria a história com o grafo inicial (o cliente manda uma cena vazia ou o exemplo).
export const create_story = spacetimedb.reducer(
  { id: t.string(), title: t.string(), startScene: t.string(), ops: t.string() },
  (ctx, { id, title, startScene, ops }) => {
    requireUser(ctx);
    if (!id || id.length > 64) throw new SenderError('INVALID');
    const cur = ctx.db.story.id.find(id);
    if (cur) {
      if (cur.ownerId.isEqual(ctx.sender)) return; // reenvio após queda de conexão
      throw new SenderError('INVALID');
    }
    ctx.db.story.insert({
      id, ownerId: ctx.sender, title: title.slice(0, 200) || 'Sem título', startScene,
      createdAt: ctx.timestamp, updatedAt: ctx.timestamp,
    });
    ctx.db.storyMember.insert({ id: 0n, storyId: id, userId: ctx.sender, role: 'owner' });
    parseOps(ops).forEach((o, i) => applyOp(ctx, id, o, i));
    validate(ctx, id);
  }
);

export const rename_story = spacetimedb.reducer({ storyId: t.string(), title: t.string() }, (ctx, { storyId, title }) => {
  const st = requireRole(ctx, storyId, 'editor');
  if (lockedByOther(ctx, `story:${storyId}:title`)) throw new SenderError('LOCKED');
  ctx.db.story.id.update({ ...st, title: title.slice(0, 200), updatedAt: ctx.timestamp });
});

// Apaga o grafo da história e recria a partir do lote enviado (o exemplo do cliente).
export const reset_story = spacetimedb.reducer(
  { storyId: t.string(), title: t.string(), startScene: t.string(), ops: t.string() },
  (ctx, { storyId, title, startScene, ops }) => {
    const st = requireRole(ctx, storyId, 'owner');
    clearGraph(ctx, storyId);
    clearCast(ctx, storyId); // o lote do exemplo traz o elenco dele
    ctx.db.story.id.update({ ...st, title: title.slice(0, 200), startScene, updatedAt: ctx.timestamp });
    parseOps(ops).forEach((o, i) => applyOp(ctx, storyId, o, i));
    validate(ctx, storyId);
  }
);

export const delete_story = spacetimedb.reducer({ storyId: t.string() }, (ctx, { storyId }) => {
  requireRole(ctx, storyId, 'owner');
  clearGraph(ctx, storyId);
  for (const m of [...ctx.db.storyMember.storyId.filter(storyId)]) ctx.db.storyMember.id.delete(m.id);
  for (const v of [...ctx.db.storyInvite.storyId.filter(storyId)]) ctx.db.storyInvite.id.delete(v.id);
  for (const j of [...ctx.db.linkJoin.storyId.filter(storyId)]) ctx.db.linkJoin.id.delete(j.id);
  ctx.db.storyLink.storyId.delete(storyId);
  for (const o of [...ctx.db.activeStory.storyId.filter(storyId)]) ctx.db.activeStory.identity.delete(o.identity);
  for (const p of [...ctx.db.presence.storyId.filter(storyId)]) ctx.db.presence.connectionId.update({ ...p, storyId: '' });
  // Pedidos em andamento somem também: complete_job/fail_job do worker caem em NOT_FOUND.
  for (const j of [...ctx.db.aiJob.storyId.filter(storyId)]) ctx.db.aiJob.id.delete(j.id);
  for (const m of [...ctx.db.chatMessage.storyId.filter(storyId)]) ctx.db.chatMessage.id.delete(m.id);
  clearCast(ctx, storyId);
  ctx.db.story.id.delete(storyId);
});

// ---------- compartilhamento ----------
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const LINK_CODE_RE = /^[A-Za-z0-9]{10}$/; // 62^10 ≈ 2^59 combinações

function forgetLinkJoin(ctx: Ctx, storyId: string, userId: Identity) {
  for (const j of [...ctx.db.linkJoin.userId.filter(userId)]) if (j.storyId === storyId) ctx.db.linkJoin.id.delete(j.id);
}

function revokeMember(ctx: Ctx, storyId: string, m: MemberRow) {
  ctx.db.storyMember.id.delete(m.id);
  forgetLinkJoin(ctx, storyId, m.userId);
  const o = ctx.db.activeStory.identity.find(m.userId);
  if (o && o.storyId === storyId) ctx.db.activeStory.identity.delete(m.userId);
  for (const p of [...ctx.db.presence.identity.filter(m.userId)])
    if (p.storyId === storyId) ctx.db.presence.connectionId.update({ ...p, storyId: '' });
}

// Quem entrou pelo link perde o acesso (ou passa a ter o novo papel do link).
function syncLinkMembers(ctx: Ctx, storyId: string, role: string) {
  for (const j of [...ctx.db.linkJoin.storyId.filter(storyId)]) {
    const m = memberOf(ctx.db, storyId, j.userId);
    if (!m || m.role === 'owner') ctx.db.linkJoin.id.delete(j.id);
    else if (!role) revokeMember(ctx, storyId, m);
    else if (m.role !== role) ctx.db.storyMember.id.update({ ...m, role });
  }
}

// role '' desliga o link. Um code diferente do atual troca o link: o antigo para de funcionar
// e quem entrou por ele perde o acesso. Mesmo code só muda o papel.
export const set_link_access = spacetimedb.reducer(
  { storyId: t.string(), role: t.string(), code: t.string() },
  (ctx, { storyId, role, code }) => {
    requireRole(ctx, storyId, 'owner');
    const cur = ctx.db.storyLink.storyId.find(storyId);
    if (!role) {
      syncLinkMembers(ctx, storyId, '');
      if (cur) ctx.db.storyLink.storyId.delete(storyId);
      return;
    }
    if (role !== 'editor' && role !== 'viewer') throw new SenderError('INVALID');
    if (cur && cur.code === code) {
      if (cur.role !== role) ctx.db.storyLink.storyId.update({ ...cur, role });
      syncLinkMembers(ctx, storyId, role);
      return;
    }
    if (!LINK_CODE_RE.test(code)) throw new SenderError('INVALID');
    if (ctx.db.storyLink.code.find(code)) throw new SenderError('CONFLICT'); // o cliente sorteia outro
    syncLinkMembers(ctx, storyId, '');
    const row = { storyId, code, role, createdAt: ctx.timestamp };
    if (cur) ctx.db.storyLink.storyId.update(row);
    else ctx.db.storyLink.insert(row);
  }
);

// Abre a história do link (como open_story); quem ainda não é membro entra com o papel do link.
// Membros já existentes mantêm o papel que têm. Link desligado ou inexistente: NOT_FOUND.
export const join_by_link = spacetimedb.reducer({ code: t.string() }, (ctx, { code }) => {
  requireUser(ctx);
  const link = LINK_CODE_RE.test(code) ? ctx.db.storyLink.code.find(code) : undefined;
  if (!link || !ctx.db.story.id.find(link.storyId)) throw new SenderError('NOT_FOUND');
  if (!memberOf(ctx.db, link.storyId, ctx.sender)) {
    ctx.db.storyMember.insert({ id: 0n, storyId: link.storyId, userId: ctx.sender, role: link.role });
    ctx.db.linkJoin.insert({ id: 0n, storyId: link.storyId, userId: ctx.sender });
  }
  openFor(ctx, link.storyId);
});

function addMember(ctx: Ctx, storyId: string, userId: Identity, role: string) {
  const m = memberOf(ctx.db, storyId, userId);
  if (m?.role === 'owner') return; // o dono não perde a posse por um convite
  if (m) ctx.db.storyMember.id.update({ ...m, role });
  else ctx.db.storyMember.insert({ id: 0n, storyId, userId, role });
}

// Quem já entrou vira membro na hora; os demais recebem um convite pelo e-mail.
export const share_story = spacetimedb.reducer(
  { storyId: t.string(), email: t.string(), role: t.string() },
  (ctx, { storyId, email, role }) => {
    requireRole(ctx, storyId, 'owner');
    if (role !== 'editor' && role !== 'viewer') throw new SenderError('INVALID');
    const e = email.trim().toLowerCase();
    if (!EMAIL_RE.test(e) || e.length > 200) throw new SenderError('INVALID');
    const acc = [...ctx.db.account.email.filter(e)][0];
    if (acc) {
      forgetLinkJoin(ctx, storyId, acc.identity); // convidado pelo dono: o acesso não depende mais do link
      return addMember(ctx, storyId, acc.identity, role);
    }
    const inv = [...ctx.db.storyInvite.email.filter(e)].find(v => v.storyId === storyId);
    if (inv) ctx.db.storyInvite.id.update({ ...inv, role });
    else ctx.db.storyInvite.insert({ id: 0n, storyId, email: e, role, createdAt: ctx.timestamp });
  }
);

// O dono remove qualquer membro; um membro pode sair sozinho. O dono não sai.
export const remove_member = spacetimedb.reducer({ storyId: t.string(), userId: t.identity() }, (ctx, { storyId, userId }) => {
  requireRole(ctx, storyId, userId.isEqual(ctx.sender) ? 'viewer' : 'owner');
  const m = memberOf(ctx.db, storyId, userId);
  if (!m) return;
  if (m.role === 'owner') throw new SenderError('INVALID');
  revokeMember(ctx, storyId, m);
});

export const cancel_invite = spacetimedb.reducer({ id: t.u64() }, (ctx, { id }) => {
  const v = ctx.db.storyInvite.id.find(id);
  if (!v) return;
  requireRole(ctx, v.storyId, 'owner');
  ctx.db.storyInvite.id.delete(id);
});

// A história aberta decide o que as views cur_* devolvem e onde fica a presença desta aba.
// Uma conta tem uma só história aberta: outra aba que abrir outra história troca para todas.
export const open_story = spacetimedb.reducer({ storyId: t.string() }, (ctx, { storyId }) => {
  requireRole(ctx, storyId, 'viewer');
  openFor(ctx, storyId);
});

function openFor(ctx: Ctx, storyId: string) {
  const row = { identity: ctx.sender, storyId };
  if (ctx.db.activeStory.identity.find(ctx.sender)) ctx.db.activeStory.identity.update(row);
  else ctx.db.activeStory.insert(row);
  const p = ctx.connectionId && ctx.db.presence.connectionId.find(ctx.connectionId);
  if (p && p.storyId !== storyId) ctx.db.presence.connectionId.update({ ...p, storyId, hasCursor: false });
}

export const close_story = spacetimedb.reducer(ctx => {
  ctx.db.activeStory.identity.delete(ctx.sender);
  const p = ctx.connectionId && ctx.db.presence.connectionId.find(ctx.connectionId);
  if (p) ctx.db.presence.connectionId.update({ ...p, storyId: '', hasCursor: false });
});

// ---------- views ----------
// História aberta, se a pessoa ainda for membro dela; '' caso contrário.
function curStoryId(ctx: { sender: Identity; db: any }): string {
  const o = ctx.db.activeStory.identity.find(ctx.sender);
  return o && memberOf(ctx.db, o.storyId, ctx.sender) ? o.storyId : '';
}

export const my_stories = spacetimedb.view({ public: true }, t.array(story.rowType), ctx =>
  [...ctx.db.storyMember.userId.filter(ctx.sender)].map(m => ctx.db.story.id.find(m.storyId)!).filter(Boolean)
);
export const my_memberships = spacetimedb.view({ public: true }, t.array(storyMember.rowType), ctx => [
  ...ctx.db.storyMember.userId.filter(ctx.sender),
]);
export const my_account = spacetimedb.view({ public: true }, t.array(account.rowType), ctx => {
  const a = ctx.db.account.identity.find(ctx.sender);
  return a ? [a] : [];
});
export const cur_story = spacetimedb.view({ public: true }, t.array(story.rowType), ctx => {
  const id = curStoryId(ctx);
  const st = id ? ctx.db.story.id.find(id) : undefined;
  return st ? [st] : [];
});
export const cur_scene = spacetimedb.view({ public: true }, t.array(scene.rowType), ctx => {
  const id = curStoryId(ctx);
  return id ? [...ctx.db.scene.storyId.filter(id)] : [];
});
export const cur_choice = spacetimedb.view({ public: true }, t.array(choice.rowType), ctx => {
  const id = curStoryId(ctx);
  return id ? [...ctx.db.choice.storyId.filter(id)] : [];
});
export const cur_presence = spacetimedb.view({ public: true }, t.array(presence.rowType), ctx => {
  const id = curStoryId(ctx);
  return id ? [...ctx.db.presence.storyId.filter(id)] : [];
});
export const cur_locks = spacetimedb.view({ public: true }, t.array(locks.rowType), ctx => {
  const id = curStoryId(ctx);
  return id ? [...ctx.db.locks.storyId.filter(id)] : [];
});
export const cur_member = spacetimedb.view({ public: true }, t.array(storyMember.rowType), ctx => {
  const id = curStoryId(ctx);
  return id ? [...ctx.db.storyMember.storyId.filter(id)] : [];
});
// Nome, e-mail e foto de quem divide a história aberta com a pessoa.
export const cur_account = spacetimedb.view({ public: true }, t.array(account.rowType), ctx => {
  const id = curStoryId(ctx);
  if (!id) return [];
  return [...ctx.db.storyMember.storyId.filter(id)].map(m => ctx.db.account.identity.find(m.userId)!).filter(Boolean);
});
// Nome e cor nos cursores e travas: a própria pessoa e os membros da história aberta.
export const cur_profile = spacetimedb.view({ public: true }, t.array(profile.rowType), ctx => {
  const id = curStoryId(ctx);
  const ids = id ? [...ctx.db.storyMember.storyId.filter(id)].map(m => m.userId) : [ctx.sender];
  return ids.map(u => ctx.db.profile.identity.find(u)!).filter(Boolean);
});
export const cur_invite = spacetimedb.view({ public: true }, t.array(storyInvite.rowType), ctx => {
  const id = curStoryId(ctx);
  return id && hasRole(ctx.db, id, ctx.sender, 'owner') ? [...ctx.db.storyInvite.storyId.filter(id)] : [];
});

export const cur_character = spacetimedb.view({ public: true }, t.array(character.rowType), ctx => {
  const id = curStoryId(ctx);
  return id ? [...ctx.db.character.storyId.filter(id)] : [];
});
export const cur_sprite = spacetimedb.view({ public: true }, t.array(sprite.rowType), ctx => {
  const id = curStoryId(ctx);
  return id ? [...ctx.db.sprite.storyId.filter(id)] : [];
});
export const cur_background = spacetimedb.view({ public: true }, t.array(background.rowType), ctx => {
  const id = curStoryId(ctx);
  return id ? [...ctx.db.background.storyId.filter(id)] : [];
});
export const cur_charsheet = spacetimedb.view({ public: true }, t.array(charsheet.rowType), ctx => {
  const id = curStoryId(ctx);
  return id ? [...ctx.db.charsheet.storyId.filter(id)] : [];
});

// Link da história aberta: só o dono vê o código (os outros membros já estão dentro).
export const cur_link = spacetimedb.view({ public: true }, t.array(storyLink.rowType), ctx => {
  const id = curStoryId(ctx);
  const l = id && hasRole(ctx.db, id, ctx.sender, 'owner') ? ctx.db.storyLink.storyId.find(id) : undefined;
  return l ? [l] : [];
});

// ---------- presença ----------
export const set_profile = spacetimedb.reducer({ name: t.string(), color: t.string() }, (ctx, { name, color }) => {
  requireUser(ctx);
  const row = { identity: ctx.sender, name: name.slice(0, 40) || 'Anônimo', color: color.slice(0, 20) };
  if (ctx.db.profile.identity.find(ctx.sender)) ctx.db.profile.identity.update(row);
  else ctx.db.profile.insert(row);
});

export const update_cursor = spacetimedb.reducer({ x: t.f64(), y: t.f64(), visible: t.bool() }, (ctx, { x, y, visible }) => {
  if (!ctx.connectionId) return;
  const p = ctx.db.presence.connectionId.find(ctx.connectionId);
  if (p && p.storyId) ctx.db.presence.connectionId.update({ ...p, cursorX: x, cursorY: y, hasCursor: visible, updatedAt: ctx.timestamp });
});

// O arrasto vai para a história aberta nesta aba (open_story já conferiu o acesso).
export const send_drag = spacetimedb.reducer({ moves: t.string(), done: t.bool() }, (ctx, { moves, done }) => {
  if (!ctx.connectionId) return;
  const p = ctx.db.presence.connectionId.find(ctx.connectionId);
  if (!p || !p.storyId || !hasRole(ctx.db, p.storyId, ctx.sender, 'editor')) return;
  ctx.db.drags.insert({ storyId: p.storyId, connectionId: ctx.connectionId, identity: ctx.sender, moves, done });
});

// ---------- trava suave ----------
// A história vem do alvo: scene:<id>:campo, choice:<id>:label ou story:<id>:title.
function lockStoryId(ctx: Ctx, target: string): string {
  const [kind, id, field] = target.split(':');
  if (kind === 'story' && field === 'title') return id;
  if (kind === 'scene' && TEXT_FIELDS.has(field)) return ctx.db.scene.id.find(id)?.storyId ?? '';
  if (kind === 'choice' && field === 'label') return ctx.db.choice.id.find(id)?.storyId ?? '';
  throw new SenderError('INVALID');
}

function takeLock(ctx: Ctx, target: string) {
  if (!ctx.connectionId) throw new SenderError('UNAUTHENTICATED');
  const storyId = lockStoryId(ctx, target);
  requireRole(ctx, storyId, 'editor');
  if (lockedByOther(ctx, target)) throw new SenderError('LOCKED');
  const row = {
    target, storyId, connectionId: ctx.connectionId, identity: ctx.sender,
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
// scene, complete e option: cena sugerida, completar texto e rótulo de ação, pelo provedor real do worker.
const AI_KINDS = new Set(['chat', 'character', 'background', 'scene', 'complete', 'option']);
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
  { id: t.string(), storyId: t.string(), kind: t.string(), input: t.string() },
  (ctx, { id, storyId, kind, input }) => {
    if (!AI_KINDS.has(kind)) throw new SenderError('INVALID');
    aiProvider(ctx.env);
    requireRole(ctx, storyId, 'editor');
    const cur = ctx.db.aiJob.id.find(id);
    if (cur) {
      // Reenvio após queda de conexão: mesmo pedido, nada a fazer.
      if (cur.requester.isEqual(ctx.sender) && cur.kind === kind) return;
      throw new SenderError('INVALID');
    }
    if (id.length > 64 || input.length > 200_000) throw new SenderError('INVALID');
    checkRate(ctx);
    ctx.db.aiJob.insert({
      id, requester: ctx.sender, storyId, kind, input, status: 'pending', result: '', error: '',
      createdAt: ctx.timestamp, updatedAt: ctx.timestamp,
    });
    if (kind === 'chat') {
      let text = '';
      try { text = String(JSON.parse(input).message ?? ''); } catch { throw new SenderError('INVALID'); }
      ctx.db.chatMessage.insert({
        id: id + ':u', user: ctx.sender, storyId, jobId: id, role: 'user', content: text, proposals: '[]', createdAt: ctx.timestamp,
      });
    }
  }
);

// Apaga a conversa de quem chama na história aberta; os pedidos em ai_job ficam (o worker pode estar usando).
export const clear_chat = spacetimedb.reducer(ctx => {
  const storyId = curStoryId(ctx);
  if (!storyId) throw new SenderError('NOT_FOUND');
  for (const m of [...ctx.db.chatMessage.user.filter(ctx.sender)]) if (m.storyId === storyId) ctx.db.chatMessage.id.delete(m.id);
});

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
  onCastJob(ctx, j, result, '');
  // Conversa limpa enquanto a IA respondia: a resposta não volta para o chat.
  if (j.kind === 'chat' && ctx.db.chatMessage.id.find(id + ':u')) {
    let r: { content?: string; proposals?: unknown[] };
    try { r = JSON.parse(result); } catch { throw new SenderError('INVALID'); }
    ctx.db.chatMessage.insert({
      id: id + ':a', user: j.requester, storyId: j.storyId, jobId: id, role: 'assistant', content: String(r.content ?? ''),
      proposals: JSON.stringify(r.proposals ?? []), createdAt: ctx.timestamp,
    });
  }
});

export const fail_job = spacetimedb.reducer({ id: t.string(), error: t.string() }, (ctx, { id, error }) => {
  workerOnly(ctx);
  const j = jobFor(ctx, id);
  if (j.status === 'done' || j.status === 'failed') return;
  ctx.db.aiJob.id.update({ ...j, status: 'failed', error: error.slice(0, 200), updatedAt: ctx.timestamp });
  onCastJob(ctx, j, null, error.slice(0, 200));
});

// Cada pessoa vê só os próprios pedidos e a conversa da história aberta; o worker vê a fila inteira.
export const my_ai_job = spacetimedb.view({ public: true }, t.array(aiJob.rowType), ctx => [
  ...ctx.db.aiJob.requester.filter(ctx.sender),
]);
export const my_chat_message = spacetimedb.view({ public: true }, t.array(chatMessage.rowType), ctx => {
  const id = curStoryId(ctx);
  return id ? [...ctx.db.chatMessage.user.filter(ctx.sender)].filter(m => m.storyId === id) : [];
});
export const worker_queue = spacetimedb.view({ public: true }, t.array(aiJob.rowType), ctx =>
  isWorker(ctx as any) ? [...ctx.db.aiJob.status.filter('pending'), ...ctx.db.aiJob.status.filter('running')] : []
);
// O grafo para o contexto da IA. O worker filtra pela história do pedido (ai_job.storyId).
export const worker_story = spacetimedb.view({ public: true }, t.array(story.rowType), ctx =>
  isWorker(ctx as any) ? [...ctx.db.story.iter()] : []
);
export const worker_scene = spacetimedb.view({ public: true }, t.array(scene.rowType), ctx =>
  isWorker(ctx as any) ? [...ctx.db.scene.iter()] : []
);
export const worker_choice = spacetimedb.view({ public: true }, t.array(choice.rowType), ctx =>
  isWorker(ctx as any) ? [...ctx.db.choice.iter()] : []
);
// Elenco para o contexto da IA (nomes, descrições e ids; as imagens não vão para o modelo de texto).
export const worker_character = spacetimedb.view({ public: true }, t.array(character.rowType), ctx =>
  isWorker(ctx as any) ? [...ctx.db.character.iter()] : []
);
export const worker_sprite = spacetimedb.view({ public: true }, t.array(sprite.rowType), ctx =>
  isWorker(ctx as any) ? [...ctx.db.sprite.iter()] : []
);
export const worker_background = spacetimedb.view({ public: true }, t.array(background.rowType), ctx =>
  isWorker(ctx as any) ? [...ctx.db.background.iter()] : []
);

// ---------- IA: geração do elenco ----------
// Cada pedido cria as linhas na hora (status generating/pending) e entra na fila; o resultado chega
// pelo complete_job/fail_job do worker (onCastJob). Fecha a aba, recarrega: o estado fica na tabela.
//   charsheet  front + side de um personagem; ao terminar, as poses pendentes viram pedidos 'pose'
//   pose       uma pose (sprite) a partir do charsheet
//   background um background (base 1536×1024 recortada para 16:9)
const MAX_POSES = 12;

function insertJob(ctx: Ctx, id: string, requester: Identity, storyId: string, kind: string, input: unknown) {
  if (ctx.db.aiJob.id.find(id)) throw new SenderError('INVALID');
  ctx.db.aiJob.insert({
    id, requester, storyId, kind, input: JSON.stringify(input), status: 'pending', result: '', error: '',
    createdAt: ctx.timestamp, updatedAt: ctx.timestamp,
  });
}

const designOf = (c: { name: string; desc: string }) => (c.desc.trim() ? `${c.name}: ${c.desc.trim()}` : c.name);

function queueSheet(ctx: Ctx, jobId: string, c: { id: string; storyId: string; name: string; desc: string }) {
  insertJob(ctx, jobId, ctx.sender, c.storyId, 'charsheet', { characterId: c.id, design: designOf(c) });
}

function sheetInput(cs: { id: string; front: string; side: string; keyColor: string; unit: string }) {
  let unit: unknown = null;
  try { unit = cs.unit ? JSON.parse(cs.unit) : null; } catch { /* sem unidade: o worker não alinha */ }
  return { id: cs.id, front: cs.front, side: cs.side, keyColor: cs.keyColor || null, unit };
}

function queuePose(ctx: Ctx, jobId: string, requester: Identity, sp: { id: string; storyId: string; characterId: string; name: string; desc: string }) {
  const c = ctx.db.character.id.find(sp.characterId);
  const cs = c && c.sheetId ? ctx.db.charsheet.id.find(c.sheetId) : undefined;
  if (!c || !cs) throw new SenderError('NO_SHEET');
  insertJob(ctx, jobId, requester, sp.storyId, 'pose', {
    spriteId: sp.id, characterId: c.id, design: cs.design, pose: sp.desc ? `${sp.name}: ${sp.desc}` : sp.name,
    hint: `${sp.name} ${sp.desc}`, sheet: sheetInput(cs),
  });
}

function editorFor(ctx: Ctx, storyId: string) {
  aiProvider(ctx.env);
  requireRole(ctx, storyId, 'editor');
}

// Personagem novo com IA: o personagem e as poses aparecem já, gerando; o charsheet entra na fila.
export const generate_character = spacetimedb.reducer(
  { storyId: t.string(), characterId: t.string(), jobId: t.string(), name: t.string(), desc: t.string(), color: t.string(), poses: t.string() },
  (ctx, { storyId, characterId, jobId, name, desc, color, poses }) => {
    editorFor(ctx, storyId);
    if (!validId(characterId) || !validId(jobId) || !name.trim()) throw new SenderError('INVALID');
    const cur = ctx.db.character.id.find(characterId);
    if (cur) {
      if (cur.storyId === storyId && ctx.db.aiJob.id.find(jobId)) return; // reenvio
      throw new SenderError('INVALID');
    }
    let list: { id: string; name: string; desc?: string }[];
    try { list = JSON.parse(poses); } catch { throw new SenderError('INVALID'); }
    if (!Array.isArray(list) || list.length > MAX_POSES || list.some(p => !validId(p?.id) || ctx.db.sprite.id.find(p.id))) throw new SenderError('INVALID');
    checkRate(ctx);
    const c = {
      id: characterId, storyId, name: str(name, 80), desc: str(desc, 2000), color: str(color, 20), source: 'ai', sheetId: '',
      status: 'generating', error: '', createdAt: ctx.timestamp,
    };
    ctx.db.character.insert(c);
    list.forEach((p, i) => ctx.db.sprite.insert({
      id: p.id, storyId, characterId, name: str(p.name, 80) || 'Pose', desc: str(p.desc, 1000), imageKey: '', position: i,
      status: 'pending', error: '', meta: '',
    }));
    queueSheet(ctx, jobId, c);
  }
);

// Pose nova com IA. Personagem ainda gerando o charsheet: a pose espera (pending) e entra na fila depois.
export const add_pose = spacetimedb.reducer(
  { storyId: t.string(), characterId: t.string(), spriteId: t.string(), jobId: t.string(), name: t.string(), desc: t.string() },
  (ctx, { storyId, characterId, spriteId, jobId, name, desc }) => {
    editorFor(ctx, storyId);
    if (!validId(spriteId) || !validId(jobId)) throw new SenderError('INVALID');
    const c = ctx.db.character.id.find(characterId);
    if (!c || c.storyId !== storyId) throw new SenderError('NOT_FOUND');
    if (ctx.db.sprite.id.find(spriteId)) {
      if (ctx.db.sprite.id.find(spriteId)!.storyId === storyId) return; // reenvio
      throw new SenderError('INVALID');
    }
    if (!c.sheetId && c.status !== 'generating') throw new SenderError('NO_SHEET');
    const n = [...ctx.db.sprite.characterId.filter(characterId)].length;
    if (n >= 40) throw new SenderError('INVALID');
    checkRate(ctx);
    const sp = {
      id: spriteId, storyId, characterId, name: str(name, 80) || 'Pose', desc: str(desc, 1000), imageKey: '', position: n,
      status: c.sheetId ? 'generating' : 'pending', error: '', meta: '',
    };
    ctx.db.sprite.insert(sp);
    if (c.sheetId) queuePose(ctx, jobId, ctx.sender, sp);
  }
);

// Charsheet enviado pelo autor (frente + perfil), no lugar de gerar com IA. Sem cor-chave nem
// unidade: as poses com IA usam o caminho nativo. Poses que esperavam o charsheet entram na fila.
export const upload_charsheet = spacetimedb.reducer(
  { storyId: t.string(), characterId: t.string(), sheetId: t.string(), front: t.string(), side: t.string() },
  (ctx, { storyId, characterId, sheetId, front, side }) => {
    requireRole(ctx, storyId, 'editor');
    if (!validId(sheetId) || !front || !side || !imageKeyOk(front) || !imageKeyOk(side)) throw new SenderError('INVALID');
    const c = ctx.db.character.id.find(characterId);
    if (!c || c.storyId !== storyId) throw new SenderError('NOT_FOUND');
    if (c.sheetId === sheetId) return; // reenvio
    if (ctx.db.charsheet.id.find(sheetId)) throw new SenderError('INVALID');
    if (c.status === 'generating') throw new SenderError('BUSY');
    if (c.sheetId) ctx.db.charsheet.id.delete(c.sheetId);
    ctx.db.charsheet.insert({
      id: sheetId, storyId, characterId, design: designOf(c), front, side, keyColor: '', keyScores: 'null', unit: '', createdAt: ctx.timestamp,
    });
    ctx.db.character.id.update({ ...c, sheetId, status: '', error: '' });
    for (const sp of [...ctx.db.sprite.characterId.filter(characterId)]) {
      if (sp.status !== 'pending') continue;
      if (!ctx.env.AI_PROVIDER) break; // sem IA no servidor: as poses seguem esperando
      queuePose(ctx, `${sheetId}:${sp.id}`.slice(0, 64), ctx.sender, sp);
      ctx.db.sprite.id.update({ ...sp, status: 'generating', error: '' });
    }
  }
);

// Remove o charsheet: o personagem volta a "sem charsheet". As poses já enviadas ou geradas ficam;
// as que esperavam pelo charsheet falham com NO_SHEET (dá para tentar de novo depois).
export const remove_charsheet = spacetimedb.reducer(
  { storyId: t.string(), characterId: t.string() },
  (ctx, { storyId, characterId }) => {
    requireRole(ctx, storyId, 'editor');
    const c = ctx.db.character.id.find(characterId);
    if (!c || c.storyId !== storyId) throw new SenderError('NOT_FOUND');
    if (c.status === 'generating') throw new SenderError('BUSY');
    for (const cs of [...ctx.db.charsheet.characterId.filter(characterId)]) ctx.db.charsheet.id.delete(cs.id);
    ctx.db.character.id.update({ ...c, sheetId: '', status: '', error: '' });
    for (const sp of [...ctx.db.sprite.characterId.filter(characterId)])
      if (sp.status === 'pending') ctx.db.sprite.id.update({ ...sp, status: 'failed', error: 'NO_SHEET' });
  }
);

export const generate_background = spacetimedb.reducer(
  { storyId: t.string(), backgroundId: t.string(), jobId: t.string(), name: t.string(), desc: t.string() },
  (ctx, { storyId, backgroundId, jobId, name, desc }) => {
    editorFor(ctx, storyId);
    if (!validId(backgroundId) || !validId(jobId) || !name.trim()) throw new SenderError('INVALID');
    const cur = ctx.db.background.id.find(backgroundId);
    if (cur) {
      if (cur.storyId === storyId && ctx.db.aiJob.id.find(jobId)) return;
      throw new SenderError('INVALID');
    }
    checkRate(ctx);
    const b = {
      id: backgroundId, storyId, name: str(name, 80), desc: str(desc, 2000), imageKey: '', baseKey: '', source: 'ai',
      status: 'generating', error: '', createdAt: ctx.timestamp, prompt: '',
    };
    ctx.db.background.insert(b);
    insertJob(ctx, jobId, ctx.sender, storyId, 'background', { backgroundId, name: b.name, desc: b.desc });
  }
);

// Background pedido pelo agente do chat (proposta aceita): o prompt já vem escrito, o worker não o melhora.
export const generate_background_prompted = spacetimedb.reducer(
  { storyId: t.string(), backgroundId: t.string(), jobId: t.string(), name: t.string(), desc: t.string(), prompt: t.string(), time: t.string(), mood: t.string() },
  (ctx, { storyId, backgroundId, jobId, name, desc, prompt, time, mood }) => {
    editorFor(ctx, storyId);
    if (!validId(backgroundId) || !validId(jobId) || !name.trim() || !prompt.trim()) throw new SenderError('INVALID');
    const cur = ctx.db.background.id.find(backgroundId);
    if (cur) {
      if (cur.storyId === storyId && ctx.db.aiJob.id.find(jobId)) return;
      throw new SenderError('INVALID');
    }
    checkRate(ctx);
    const brief = { scene: str(prompt, 1200), time: str(time, 20), mood: str(mood, 120) };
    const b = {
      id: backgroundId, storyId, name: str(name, 80), desc: str(desc, 2000), imageKey: '', baseKey: '', source: 'ai',
      status: 'generating', error: '', createdAt: ctx.timestamp, prompt: JSON.stringify(brief),
    };
    ctx.db.background.insert(b);
    insertJob(ctx, jobId, ctx.sender, storyId, 'background', { backgroundId, name: b.name, desc: b.desc, prompt: brief.scene, time: brief.time, mood: brief.mood });
  }
);

type Brief = { scene: string; time: string; mood: string };
function briefOf(json: string): Brief | null {
  try {
    const v = JSON.parse(json || 'null');
    const scene = str(String(v?.scene ?? ''), 1200).trim();
    return scene ? { scene, time: str(String(v.time ?? ''), 20), mood: str(String(v.mood ?? ''), 120) } : null;
  } catch { return null; }
}

// Gera de novo: um charsheet (personagem falhado, ou enviado sem charsheet), uma pose ou um background.
export const retry_generation = spacetimedb.reducer(
  { storyId: t.string(), target: t.string(), id: t.string(), jobId: t.string() },
  (ctx, { storyId, target, id, jobId }) => {
    editorFor(ctx, storyId);
    if (!validId(jobId)) throw new SenderError('INVALID');
    if (ctx.db.aiJob.id.find(jobId)) return; // reenvio
    if (target === 'character') {
      const c = ctx.db.character.id.find(id);
      if (!c || c.storyId !== storyId) throw new SenderError('NOT_FOUND');
      if (c.status === 'generating') throw new SenderError('BUSY');
      checkRate(ctx);
      ctx.db.character.id.update({ ...c, status: 'generating', error: '' });
      // As poses que falharam por falta do charsheet esperam o novo.
      for (const sp of [...ctx.db.sprite.characterId.filter(id)])
        if (sp.status === 'failed' && !sp.imageKey) ctx.db.sprite.id.update({ ...sp, status: 'pending', error: '' });
      queueSheet(ctx, jobId, c);
    } else if (target === 'sprite') {
      const sp = ctx.db.sprite.id.find(id);
      if (!sp || sp.storyId !== storyId) throw new SenderError('NOT_FOUND');
      if (sp.status === 'generating' || sp.status === 'pending') throw new SenderError('BUSY');
      const c = ctx.db.character.id.find(sp.characterId);
      if (c && !c.sheetId && c.status === 'generating') { ctx.db.sprite.id.update({ ...sp, status: 'pending', error: '' }); return; }
      checkRate(ctx);
      queuePose(ctx, jobId, ctx.sender, sp);
      ctx.db.sprite.id.update({ ...sp, status: 'generating', error: '' });
    } else if (target === 'background') {
      const b = ctx.db.background.id.find(id);
      if (!b || b.storyId !== storyId) throw new SenderError('NOT_FOUND');
      if (b.status === 'generating') throw new SenderError('BUSY');
      checkRate(ctx);
      ctx.db.background.id.update({ ...b, status: 'generating', error: '' });
      // Com prompt guardado, a imagem nova sai do mesmo prompt (sem passar de novo pela melhoria).
      const brief = briefOf(b.prompt);
      insertJob(ctx, jobId, ctx.sender, storyId, 'background', {
        backgroundId: id, name: b.name, desc: b.desc, ...(brief ? { prompt: brief.scene, time: brief.time, mood: brief.mood } : {}),
      });
    } else throw new SenderError('INVALID');
  }
);

// Resultado de um pedido do elenco nas linhas da história. Linha apagada no meio: nada a fazer.
function onCastJob(ctx: Ctx, j: { id: string; kind: string; input: string; requester: Identity }, result: string | null, error: string) {
  let input: Record<string, unknown>;
  try { input = JSON.parse(j.input); } catch { return; }
  let r: Record<string, any> = {};
  if (result !== null) { try { r = JSON.parse(result); } catch { throw new SenderError('INVALID'); } }
  if (j.kind === 'charsheet') {
    const c = ctx.db.character.id.find(String(input.characterId));
    if (!c) return;
    const sh = r.sheet;
    if (result === null || !sh || !validId(sh.id) || !imageKeyOk(sh.front) || !imageKeyOk(sh.side)) {
      ctx.db.character.id.update({ ...c, status: 'failed', error: error || 'AI_INVALID_OUTPUT' });
      for (const sp of [...ctx.db.sprite.characterId.filter(c.id)])
        if (sp.status === 'pending') ctx.db.sprite.id.update({ ...sp, status: 'failed', error: 'NO_SHEET' });
      return;
    }
    const row = {
      id: sh.id, storyId: c.storyId, characterId: c.id, design: String(input.design ?? designOf(c)), front: sh.front, side: sh.side,
      keyColor: String(sh.keyColor ?? ''), keyScores: JSON.stringify(sh.keyScores ?? null), unit: sh.unit ? JSON.stringify(sh.unit) : '', createdAt: ctx.timestamp,
    };
    if (ctx.db.charsheet.id.find(row.id)) ctx.db.charsheet.id.update(row);
    else ctx.db.charsheet.insert(row);
    ctx.db.character.id.update({ ...c, sheetId: row.id, status: '', error: '' });
    // Cada pose pendente vira um pedido próprio: uma falha só marca aquela pose.
    for (const sp of [...ctx.db.sprite.characterId.filter(c.id)]) {
      if (sp.status !== 'pending') continue;
      queuePose(ctx, `${j.id}:${sp.id}`.slice(0, 64), j.requester, sp);
      ctx.db.sprite.id.update({ ...sp, status: 'generating', error: '' });
    }
  } else if (j.kind === 'pose') {
    const sp = ctx.db.sprite.id.find(String(input.spriteId));
    if (!sp || sp.imageKey && sp.status === '') return; // o autor já enviou uma imagem
    if (result === null || !r.image_key || !imageKeyOk(r.image_key)) {
      ctx.db.sprite.id.update({ ...sp, status: 'failed', error: error || 'AI_INVALID_OUTPUT' });
      return;
    }
    ctx.db.sprite.id.update({ ...sp, imageKey: r.image_key, status: '', error: '', meta: JSON.stringify({ path: r.path ?? null, accepted: r.accepted ?? null }) });
  } else if (j.kind === 'background' && input.backgroundId) {
    const b = ctx.db.background.id.find(String(input.backgroundId));
    if (!b || b.status !== 'generating') return;
    if (result === null || !r.image_key || !imageKeyOk(r.image_key)) {
      ctx.db.background.id.update({ ...b, status: 'failed', error: error || 'AI_INVALID_OUTPUT' });
      return;
    }
    // O worker devolve o prompt usado (o do agente ou o melhorado); fica guardado para regenerar e para o chat.
    const used = r.prompt && typeof r.prompt === 'object' ? briefOf(JSON.stringify(r.prompt)) : null;
    ctx.db.background.id.update({
      ...b, imageKey: r.image_key, baseKey: imageKeyOk(r.base_key) ? String(r.base_key ?? '') : '', status: '', error: '',
      ...(used ? { prompt: JSON.stringify(used) } : {}),
    });
  }
}

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
      // Quem não edita a história da cena recebe NOT_FOUND, como se ela não existisse.
      if (!s || !hasRole(tx.db, s.storyId, ctx.sender, 'editor')) return { src: undefined, label: '' };
      const c = choiceId ? tx.db.choice.id.find(choiceId) : undefined;
      return { src: { title: s.title, text: s.text, bg: s.bg }, label: c && c.sceneId === s.id ? c.label : '' };
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
  (ctx, { sceneId, text, textKind, speakerName, instruction }) => envelope(() => {
    const provider = aiProvider(ctx.env);
    const ok = ctx.withTx(tx => {
      const s = tx.db.scene.id.find(sceneId);
      return !!s && hasRole(tx.db, s.storyId, ctx.sender, 'editor');
    });
    if (!ok) throw new SenderError('NOT_FOUND');
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

const PROFILE_COLORS = ['#f2a541', '#5eead4', '#a78bfa', '#f472b6', '#60a5fa', '#4ade80', '#fb7185', '#facc15'];

// Conexões sem conta aceita (o worker, por exemplo) entram, mas nenhum reducer de usuário as atende.
export const on_connect = spacetimedb.clientConnected(ctx => {
  if (!ctx.connectionId) return;
  const claims = accountClaims(ctx);
  let storyId = '';
  if (claims) {
    const cur = ctx.db.account.identity.find(ctx.sender);
    // E-mail sem verificação não substitui um já confirmado.
    const email = claims.email || cur?.email || '';
    const row = {
      identity: ctx.sender, email, name: claims.name || cur?.name || '', picture: claims.picture || cur?.picture || '',
      createdAt: cur?.createdAt ?? ctx.timestamp, lastSeenAt: ctx.timestamp,
    };
    if (cur) ctx.db.account.identity.update(row);
    else ctx.db.account.insert(row);
    // Convites para este e-mail viram participação.
    if (email) for (const v of [...ctx.db.storyInvite.email.filter(email)]) {
      if (ctx.db.story.id.find(v.storyId)) addMember(ctx, v.storyId, ctx.sender, v.role);
      ctx.db.storyInvite.id.delete(v.id);
    }
    if (!ctx.db.profile.identity.find(ctx.sender))
      ctx.db.profile.insert({ identity: ctx.sender, name: (row.name.split(' ')[0] || 'Anônimo').slice(0, 40), color: PROFILE_COLORS[Math.floor(ctx.random() * PROFILE_COLORS.length)] });
    // Reconexão: a presença volta para a história que estava aberta.
    const o = ctx.db.activeStory.identity.find(ctx.sender);
    if (o && memberOf(ctx.db, o.storyId, ctx.sender)) storyId = o.storyId;
  }
  ctx.db.presence.insert({
    connectionId: ctx.connectionId, identity: ctx.sender, storyId, cursorX: 0, cursorY: 0, hasCursor: false, updatedAt: ctx.timestamp,
  });
});

export const on_disconnect = spacetimedb.clientDisconnected(ctx => {
  if (!ctx.connectionId) return;
  ctx.db.presence.connectionId.delete(ctx.connectionId);
  for (const l of [...ctx.db.locks.iter()]) if (l.connectionId.isEqual(ctx.connectionId)) ctx.db.locks.target.delete(l.target);
});
