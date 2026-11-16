// Worker de IA (seção 2.6): cliente de serviço do módulo. Assina a fila (view worker_queue),
// assume pedidos com claim_job, faz streaming do chat por push_chat_chunk e gera imagens.
import { DbConnection } from './module_bindings';
import { createProvider, type AiContext, type ChatInput, type StorySnapshot } from './providers';
import { createStore, sheets } from './storage';
import type { KeyChoice } from './imaging/postprocess';
import type { Unit } from './imaging/pipeline';

const URI = process.env.STDB_URI ?? 'ws://127.0.0.1:3000';
const DB = process.env.STDB_DB ?? 'roteiro-spike-ai';
const SECRET = process.env.WORKER_SECRET ?? '';
const FLUSH_MS = Number(process.env.CHUNK_FLUSH_MS ?? '80'); // especificação: 50–100 ms
// Filas separadas: um personagem com vários sprites não pode atrasar o primeiro pedaço do chat.
const LANES = { chat: Number(process.env.WORKER_CHAT_PARALLEL ?? '8'), image: Number(process.env.WORKER_IMAGE_PARALLEL ?? '4') };
// Com imagens reais (charsheet + poses com novas tentativas), personagem e background demoram mais.
const REAL_IMAGES = process.env.AI_PROVIDER === 'openai' && process.env.AI_IMAGE_PROVIDER === 'openai';
const TIMEOUT = {
  chat: 180_000, text: 30_000, image: 90_000,
  background: Number(process.env.WORKER_BACKGROUND_TIMEOUT_MS ?? (REAL_IMAGES ? 600_000 : 90_000)),
  character: Number(process.env.WORKER_CHARACTER_TIMEOUT_MS ?? (REAL_IMAGES ? 1_800_000 : 180_000)),
  sheet: Number(process.env.WORKER_SHEET_TIMEOUT_MS ?? (REAL_IMAGES ? 600_000 : 90_000)),
  pose: Number(process.env.WORKER_POSE_TIMEOUT_MS ?? (REAL_IMAGES ? 900_000 : 90_000)),
} as const;
const COMPARE_ALL = process.env.AI_IMAGE_COMPARE_PATHS === '1';
const TEXT_KINDS = new Set(['chat', 'scene', 'complete', 'option']); // fila de texto; o resto é imagem

const provider = createProvider(process.env.AI_PROVIDER);
const store = createStore();
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 23), ...a);

if (!SECRET) { console.error('WORKER_SECRET ausente (veja worker/.env).'); process.exit(1); }
try {
  await provider?.verify?.();
} catch {
  console.error('chave da OpenAI recusada (HTTP 401). Em produção: gcloud secrets versions add openai-api-key (veja o README).');
  process.exit(1);
}

let conn: DbConnection;
const seen = new Set<string>(); // pedidos já tratados por este processo
const queues = { chat: [] as string[], image: [] as string[] };
const active = { chat: 0, image: 0 };

// Elenco da história pelas tabelas (views worker_*). Histórias antigas, sem elenco nas tabelas,
// e os testes mandam o elenco no input do pedido: aí vale o do pedido.
function castContext(storyId: string, sent?: AiContext): AiContext {
  const characters = [...conn.db.workerCharacter.iter()].filter(c => c.storyId === storyId);
  const backgrounds = [...conn.db.workerBackground.iter()].filter(b => b.storyId === storyId && b.imageKey);
  if (!characters.length && !backgrounds.length && sent) return sent;
  // Poses ainda gerando entram: o agente já pode pôr um personagem recém-aceito nas cenas.
  const sprites = [...conn.db.workerSprite.iter()]
    .filter(s => s.storyId === storyId && (s.imageKey || s.status === 'pending' || s.status === 'generating'))
    .sort((a, b) => a.position - b.position);
  return {
    characters: characters.map(c => ({
      id: c.id, name: c.name, desc: c.desc,
      sprites: sprites.filter(s => s.characterId === c.id).map(s => ({ id: s.id, name: s.name, desc: s.desc })),
    })),
    backgrounds: backgrounds.map(b => ({ id: b.id, name: b.name, desc: b.desc })),
  };
}

const withCast = <T extends { context?: AiContext }>(input: T, storyId: string): T => ({ ...input, context: castContext(storyId, input.context) });

// Grafo da história do pedido, pelas views worker_* (as tabelas são privadas).
function snapshot(storyId: string): StorySnapshot {
  const st = conn.db.workerStory.id.find(storyId);
  return {
    title: st?.title ?? '', startScene: st?.startScene ?? '',
    scenes: [...conn.db.workerScene.iter()].filter(s => s.storyId === storyId)
      .map(s => ({ id: s.id, title: s.title, x: s.x, y: s.y, text: s.text, next: s.next, bg: s.bg, chars: s.chars, kind: s.kind, speaker: s.speaker })),
    choices: [...conn.db.workerChoice.iter()].filter(c => c.storyId === storyId)
      .map(c => ({ id: c.id, sceneId: c.sceneId, label: c.label, target: c.target, position: c.position })),
  };
}

function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  return run(ac.signal).finally(() => clearTimeout(t));
}

const shortError = (e: unknown) => {
  const m = String((e as Error)?.message ?? e);
  return /TIMEOUT/.test(m) ? 'TIMEOUT' : /AI_KEY_INVALID/.test(m) ? 'AI_KEY_INVALID' : /AI_PROVIDER_ERROR/.test(m) ? 'AI_PROVIDER_ERROR' : m.slice(0, 120);
};

// Pedaços do raciocínio do modelo e o andamento da proposta vão pela mesma tabela de pedaços, em
// faixas de seq separadas: assim não muda o esquema do módulo. O cliente separa pelos números.
const THOUGHT_SEQ = 0x8000_0000; // texto do raciocínio, acumulado
const PROGRESS_SEQ = 0xC000_0000; // JSON com o andamento da proposta; vale o último

async function runChat(id: string, storyId: string, input: ChatInput) {
  let seq = 0, tseq = 0, pseq = 0, buf = '', tbuf = '', progress = '', sentProgress = '', chain = Promise.resolve();
  // Junta os tokens e envia um pedaço a cada FLUSH_MS, em ordem.
  const flush = () => {
    if (tbuf) {
      const text = tbuf, s = THOUGHT_SEQ + tseq++;
      tbuf = '';
      chain = chain.then(() => conn.reducers.pushChatChunk({ jobId: id, seq: s, text }));
    }
    if (progress !== sentProgress) {
      const text = sentProgress = progress, s = PROGRESS_SEQ + pseq++;
      chain = chain.then(() => conn.reducers.pushChatChunk({ jobId: id, seq: s, text }));
    }
    if (!buf) return;
    const text = buf, s = seq++;
    buf = '';
    chain = chain.then(() => conn.reducers.pushChatChunk({ jobId: id, seq: s, text }));
  };
  const timer = setInterval(flush, FLUSH_MS);
  try {
    const out = await withTimeout(TIMEOUT.chat, sig => provider!.chat(input, snapshot(storyId), t => { buf += t; }, sig, t => { tbuf += t; }, p => { progress = JSON.stringify(p); }));
    flush();
    await chain;
    return { result: out, chunks: seq };
  } finally {
    clearInterval(timer);
    await chain.catch(() => {});
  }
}

type CharacterInput = {
  name: string; desc: string; emotions: { name: string; desc: string }[];
  design?: string; // descrição fixa do personagem, repetida em todo prompt; sem ela, "nome: desc"
  sheet_id?: string; // reusa front/side/cor-chave de um charsheet já gerado
  compare?: boolean; // modo comparação: cada pose nos dois caminhos (keyed e nativo)
};

// Charsheet (PLANO-SPRITES-BACKGROUNDS.md, seção 2): front no fundo sólido, side como edit do front.
async function makeSheet(design: string, sig: AbortSignal) {
  const front = await provider!.image({ kind: 'reference', reference: 'front', design, hint: 'neutro' }, sig);
  const frontKey = await store.put(front);
  const side = await provider!.image({ kind: 'reference', reference: 'side', design, front: { id: frontKey, bytes: front.bytes }, hint: 'neutro' }, sig);
  const keyChoice = front.meta?.keyChoice as KeyChoice | undefined;
  return {
    id: 'cs' + crypto.randomUUID().replace(/-/g, '').slice(0, 12), design, front: frontKey, side: await store.put(side),
    keyColor: keyChoice?.color ?? null, keyScores: keyChoice?.scores ?? null, unit: (front.meta?.unit as Unit) ?? null, createdAt: new Date().toISOString(),
  };
}

type SheetInput = { id: string; front: string; side: string; keyColor: KeyChoice['color'] | null; unit: Unit | null };

async function sheetRefs(sheet: SheetInput) {
  const ref = async (id: string) => ({ id, bytes: (await store.get(id)) ?? undefined });
  return { sheetId: sheet.id, front: await ref(sheet.front), side: await ref(sheet.side), keyColor: sheet.keyColor ?? null, unit: sheet.unit ?? undefined };
}

async function makePose(design: string, name: string, desc: string, refs: Awaited<ReturnType<typeof sheetRefs>>, sig: AbortSignal, compare?: boolean) {
  const pose = desc ? `${name}: ${desc}` : name;
  const img = await provider!.image({ kind: 'pose', design, pose, hint: name + ' ' + desc, refs, compare }, sig);
  return { image_key: await store.put(img), ...(img.meta ? { path: img.meta.path, accepted: img.meta.accepted } : {}) };
}

// Pedido 'charsheet' (editor: generate_character / retry_generation): só front + side. O módulo
// grava o charsheet e põe cada pose pendente na fila como um pedido 'pose'.
async function runCharsheet(input: { characterId: string; design: string }) {
  if (!input.design?.trim()) throw new Error('INVALID_INPUT');
  const sheet = await withTimeout(TIMEOUT.sheet, sig => makeSheet(input.design.trim(), sig));
  return { sheet: { id: sheet.id, front: sheet.front, side: sheet.side, keyColor: sheet.keyColor, keyScores: sheet.keyScores, unit: sheet.unit } };
}

// Pedido 'pose': uma pose a partir do charsheet que o módulo manda no input.
async function runPose(input: { spriteId: string; design: string; pose: string; hint: string; sheet: SheetInput }) {
  if (!input.sheet?.front || !input.sheet?.side || !input.design) throw new Error('INVALID_INPUT');
  return withTimeout(TIMEOUT.pose, async sig => {
    const refs = await sheetRefs(input.sheet);
    const pose = input.pose || input.hint;
    const img = await provider!.image({ kind: 'pose', design: input.design, pose, hint: input.hint || pose, refs, compare: COMPARE_ALL }, sig);
    return { image_key: await store.put(img), ...(img.meta ? { path: img.meta.path, accepted: img.meta.accepted } : {}) };
  });
}

// Pedido 'character' (antigo, usado pelos testes): charsheet e todas as poses num pedido só.
async function runCharacter(input: CharacterInput) {
  if (!input.emotions?.length || input.emotions.length > 12) throw new Error('INVALID_INPUT');
  return withTimeout(TIMEOUT.character, async sig => {
    const design = input.design?.trim() || `${input.name}: ${input.desc}`;
    let sheet = input.sheet_id ? await sheets.get(input.sheet_id) : null;
    if (input.sheet_id && !sheet) throw new Error('INVALID_INPUT');
    if (!sheet) {
      sheet = await makeSheet(design, sig);
      await sheets.save(sheet);
    }
    const refs = await sheetRefs(sheet);
    // Até 3 sprites ao mesmo tempo, na ordem pedida.
    const sprites: { name: string; description: string; image_key: string; path?: unknown; accepted?: unknown }[] = new Array(input.emotions.length);
    let next = 0;
    const lane = async () => {
      while (next < input.emotions.length) {
        const i = next++, e = input.emotions[i];
        sprites[i] = { name: e.name, description: e.desc, ...(await makePose(design, e.name, e.desc, refs, sig, input.compare)) };
      }
    };
    await Promise.all([lane(), lane(), lane()]);
    return { sprites, sheet: { id: sheet.id, front: sheet.front, side: sheet.side, key_color: sheet.keyColor } };
  });
}

type BackgroundInput = {
  name: string; desc: string; time?: string; mood?: string;
  variants?: string[]; // ex.: ['night']: edits da base, mesma composição
  base_key?: string; // base já gerada (image 1536×1024): só as variantes
};

// Background (seção 3): base 1536×1024 opaca, variantes como edits da base, recorte 16:9 para o palco.
async function runBackground(input: BackgroundInput) {
  const variants = Array.isArray(input.variants) ? input.variants.slice(0, 4).map(String) : [];
  return withTimeout(TIMEOUT.background, async sig => {
    const hint = input.name + ' ' + input.desc;
    let image_key = '', base_key = input.base_key ?? '', baseBytes: Uint8Array | undefined, prompt: { scene: string; time: string; mood: string } | null = null;
    if (base_key) {
      baseBytes = (await store.get(base_key)) ?? undefined;
      if (!baseBytes && !base_key.startsWith('placeholders/')) throw new Error('INVALID_INPUT');
    } else {
      // Fluxo manual: a descrição do autor vira um prompt concreto antes da imagem; se falhar, vai a descrição crua.
      let brief = { scene: `${input.name}: ${input.desc}`, time: input.time ?? '', mood: input.mood ?? '' };
      try {
        const b = await provider!.enhanceBackground({ name: input.name, desc: input.desc }, sig);
        brief = { scene: b.scene, time: input.time || b.time, mood: input.mood || b.mood };
        log('background: prompt melhorado', JSON.stringify(brief));
      } catch (e) {
        if (sig.aborted) throw e;
        log('background: melhoria do prompt falhou, usando a descrição', shortError(e));
      }
      prompt = brief;
      const img = await provider!.image({ kind: 'background', prompt: brief.scene, hint, time: brief.time, mood: brief.mood }, sig);
      image_key = await store.put(img);
      base_key = img.base ? await store.put({ bytes: img.base, contentType: 'image/png' }) : image_key;
      baseBytes = img.base;
    }
    const out = [];
    for (const v of variants) {
      const img = await provider!.image({ kind: 'background-variant', base: { id: base_key, bytes: baseBytes }, variant: v, hint: v }, sig);
      out.push({ name: v, image_key: await store.put(img) });
    }
    return { image_key: image_key || out[0]?.image_key || '', base_key, ...(prompt ? { prompt } : {}), ...(variants.length ? { variants: out } : {}) };
  });
}

async function handle(id: string) {
  const job = [...conn.db.workerQueue.iter()].find(j => j.id === id);
  if (!job || job.status !== 'pending') return;
  const t0 = performance.now();
  const waited = Date.now() - Number(job.createdAt.microsSinceUnixEpoch / 1000n);
  try {
    await conn.reducers.claimJob({ id });
  } catch (e) {
    log('claim recusado', id, shortError(e));
    return;
  }
  try {
    if (!provider) throw new Error('AI_DISABLED');
    const input = JSON.parse(job.input);
    let result: unknown, extra = '';
    if (job.kind === 'chat') {
      const r = await runChat(id, job.storyId, {
        message: String(input.message ?? ''),
        context: castContext(job.storyId, input.context as AiContext | undefined),
        history: Array.isArray(input.history) ? input.history : [],
      });
      result = r.result;
      extra = `${r.chunks} pedaços`;
    } else if (job.kind === 'charsheet') result = await runCharsheet(input);
    else if (job.kind === 'pose') result = await runPose(input);
    else if (job.kind === 'character') result = await runCharacter(input);
    else if (job.kind === 'background') result = await runBackground(input);
    else if (job.kind === 'scene') result = await withTimeout(TIMEOUT.text, sig => provider!.scene(withCast(input, job.storyId), snapshot(job.storyId), sig));
    else if (job.kind === 'complete') result = await withTimeout(TIMEOUT.text, sig => provider!.complete(input, snapshot(job.storyId), sig));
    else if (job.kind === 'option') result = await withTimeout(TIMEOUT.text, sig => provider!.option(withCast(input, job.storyId), snapshot(job.storyId), sig));
    else throw new Error('INVALID_KIND');
    await conn.reducers.completeJob({ id, result: JSON.stringify(result) });
    log(`ok   ${job.kind.padEnd(10)} ${id} fila ${waited} ms · execução ${Math.round(performance.now() - t0)} ms ${extra}`);
  } catch (e) {
    const err = shortError(e);
    log(`erro ${job.kind.padEnd(10)} ${id} ${err}`);
    await conn.reducers.failJob({ id, error: err }).catch(() => {});
  }
}

function pump() {
  for (const lane of ['chat', 'image'] as const) {
    while (active[lane] < LANES[lane] && queues[lane].length) {
      const id = queues[lane].shift()!;
      active[lane]++;
      handle(id).finally(() => { active[lane]--; pump(); });
    }
  }
}

function enqueue(id: string, status: string, kind: string) {
  if (status !== 'pending' || seen.has(id)) return;
  seen.add(id);
  queues[TEXT_KINDS.has(kind) ? 'chat' : 'image'].push(id);
  pump();
}

conn = DbConnection.builder()
  .withUri(URI)
  .withDatabaseName(DB)
  .withAutomaticReconnect()
  .onConnect(async (c, identity) => {
    log(`conectado a ${URI}/${DB} como ${identity.toHexString().slice(0, 16)}… · provedor ${provider?.name ?? 'nenhum'}`);
    try {
      await c.reducers.registerWorker({ secret: SECRET });
    } catch (e) {
      console.error('register_worker recusado — WORKER_SECRET diferente do publicado?', shortError(e));
      process.exit(1);
    }
    c.db.workerQueue.onInsert((_ctx, row) => enqueue(row.id, row.status, row.kind));
    c.subscriptionBuilder()
      .onApplied(() => {
        // Pedidos 'running' de um worker anterior que caiu não vão terminar: falham com aviso.
        for (const j of c.db.workerQueue.iter()) {
          if (j.status === 'running' && !seen.has(j.id)) {
            seen.add(j.id);
            c.reducers.failJob({ id: j.id, error: 'WORKER_RESTARTED' }).catch(() => {});
          } else enqueue(j.id, j.status, j.kind);
        }
        log('fila assinada; aguardando pedidos');
      })
      // Sem a fila assinada o worker não faz nada: sai e deixa o systemd reiniciar.
      .onError((_ctx, err) => { console.error('erro na assinatura', err); process.exit(1); })
      .subscribe([
        'SELECT * FROM worker_queue', 'SELECT * FROM worker_story', 'SELECT * FROM worker_scene', 'SELECT * FROM worker_choice',
        'SELECT * FROM worker_character', 'SELECT * FROM worker_sprite', 'SELECT * FROM worker_background',
      ]);
  })
  .onDisconnect(() => { log('desconectado; reconectando…'); armOffline(); })
  .onConnectError((_ctx, err) => { console.error('falha ao conectar', err); armOffline(); })
  .build();

// A reconexão automática pode desistir em silêncio (aconteceu num 502 do Maincloud): o processo
// seguia "active" sem atender pedidos. Se ficar desconectado por OFFLINE_EXIT_MS, sai com erro
// e o systemd (Restart=always) começa do zero.
const OFFLINE_EXIT_MS = Number(process.env.OFFLINE_EXIT_MS ?? '120000');
let offlineTimer: NodeJS.Timeout | undefined;
function armOffline() {
  if (offlineTimer) return;
  offlineTimer = setTimeout(() => {
    if (conn.isActive) { offlineTimer = undefined; return; }
    console.error(`desconectado há ${OFFLINE_EXIT_MS / 1000} s; saindo para o systemd reiniciar`);
    process.exit(1);
  }, OFFLINE_EXIT_MS);
}
