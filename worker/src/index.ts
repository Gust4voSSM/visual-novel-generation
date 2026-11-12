// Worker de IA (seção 2.6): cliente de serviço do módulo. Assina a fila (view worker_queue),
// assume pedidos com claim_job, faz streaming do chat por push_chat_chunk e gera imagens.
import { DbConnection } from './module_bindings';
import { createProvider, type AiContext, type ChatInput, type StorySnapshot } from './providers';
import { createStore } from './storage';

const URI = process.env.STDB_URI ?? 'ws://127.0.0.1:3000';
const DB = process.env.STDB_DB ?? 'roteiro-spike-ai';
const SECRET = process.env.WORKER_SECRET ?? '';
const FLUSH_MS = Number(process.env.CHUNK_FLUSH_MS ?? '80'); // especificação: 50–100 ms
// Filas separadas: um personagem com vários sprites não pode atrasar o primeiro pedaço do chat.
const LANES = { chat: Number(process.env.WORKER_CHAT_PARALLEL ?? '8'), image: Number(process.env.WORKER_IMAGE_PARALLEL ?? '4') };
const TIMEOUT = { chat: 180_000, text: 30_000, background: 90_000, image: 90_000, character: 180_000 } as const;
const TEXT_KINDS = new Set(['chat', 'scene', 'complete', 'option']); // fila de texto; o resto é imagem

const provider = createProvider(process.env.AI_PROVIDER);
const store = createStore();
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 23), ...a);

if (!SECRET) { console.error('WORKER_SECRET ausente (veja worker/.env).'); process.exit(1); }

let conn: DbConnection;
const seen = new Set<string>(); // pedidos já tratados por este processo
const queues = { chat: [] as string[], image: [] as string[] };
const active = { chat: 0, image: 0 };

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
  return /TIMEOUT/.test(m) ? 'TIMEOUT' : /AI_PROVIDER_ERROR/.test(m) ? 'AI_PROVIDER_ERROR' : m.slice(0, 120);
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

async function runCharacter(input: { name: string; desc: string; emotions: { name: string; desc: string }[] }) {
  if (!input.emotions?.length || input.emotions.length > 12) throw new Error('INVALID_INPUT');
  return withTimeout(TIMEOUT.character, async sig => {
    // Até 3 sprites ao mesmo tempo, na ordem pedida.
    const sprites: { name: string; description: string; image_key: string }[] = new Array(input.emotions.length);
    let next = 0;
    const lane = async () => {
      while (next < input.emotions.length) {
        const i = next++, e = input.emotions[i];
        const prompt = `${input.name}: ${input.desc}. Emoção: ${e.name} (${e.desc})`;
        const img = await provider!.image({ kind: 'sprite', prompt, hint: e.name + ' ' + e.desc }, sig);
        sprites[i] = { name: e.name, description: e.desc, image_key: await store.put(img) };
      }
    };
    await Promise.all([lane(), lane(), lane()]);
    return { sprites };
  });
}

async function runBackground(input: { name: string; desc: string }) {
  return withTimeout(TIMEOUT.background, async sig => {
    const img = await provider!.image({ kind: 'background', prompt: `${input.name}: ${input.desc}`, hint: input.name + ' ' + input.desc }, sig);
    return { image_key: await store.put(img) };
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
        context: (input.context ?? { characters: [], backgrounds: [] }) as AiContext,
        history: Array.isArray(input.history) ? input.history : [],
      });
      result = r.result;
      extra = `${r.chunks} pedaços`;
    } else if (job.kind === 'character') result = await runCharacter(input);
    else if (job.kind === 'background') result = await runBackground(input);
    else if (job.kind === 'scene') result = await withTimeout(TIMEOUT.text, sig => provider!.scene(input, snapshot(job.storyId), sig));
    else if (job.kind === 'complete') result = await withTimeout(TIMEOUT.text, sig => provider!.complete(input, snapshot(job.storyId), sig));
    else if (job.kind === 'option') result = await withTimeout(TIMEOUT.text, sig => provider!.option(input, snapshot(job.storyId), sig));
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
      .onError((_ctx, err) => console.error('erro na assinatura', err))
      .subscribe(['SELECT * FROM worker_queue', 'SELECT * FROM worker_story', 'SELECT * FROM worker_scene', 'SELECT * FROM worker_choice']);
  })
  .onDisconnect(() => log('desconectado; reconectando…'))
  .onConnectError((_ctx, err) => { console.error('falha ao conectar', err); })
  .build();
