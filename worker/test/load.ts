// Carga: 5 colaboradores (meta do MVP) editando ao mesmo tempo, primeiro sem IA e depois
// com IA em paralelo (procedures com espera de rede, chat em streaming, personagens).
// Pergunta principal: a IA atrasa as ações discretas além da meta (p95 ≤ 300 ms)?
// Precisa do worker rodando. Variáveis: USERS (5), PHASE_S (20).
import { CONTEXT, EDITOR_QUERIES, connect, pct, proc, seedStory, sleep, uid, waitFor, type Client } from './harness';

const USERS = Number(process.env.USERS ?? '5');
const PHASE_MS = Number(process.env.PHASE_S ?? '20') * 1000;
const ctxJson = JSON.stringify(CONTEXT);

type Stats = { op: number[]; remote: number[]; cursor: number[]; errors: string[] };
const fresh = (): Stats => ({ op: [], remote: [], cursor: [], errors: [] });

const users: Client[] = [];
for (let i = 0; i < USERS; i++) users.push(await connect('u' + i, [...EDITOR_QUERIES, 'SELECT * FROM presence']));
await seedStory(users[0]);
// Cada pessoa edita a própria cena, ligada ao grafo: o reducer valida o grafo inteiro a cada lote.
await users[0].conn.reducers.applyOperations({ ops: JSON.stringify(users.flatMap((_, i) => [
  { op: 'upsert_scene', scene: { id: 'load' + i, title: 'Carga ' + i, x: 800, y: i * 300, bg: '', chars: '[]', kind: 'narration', speaker: '', text: '', next: '', ai: '' } },
  { op: 'upsert_choice', choice: { id: 'lc' + i, sceneId: 't2', label: 'Ir ' + i, target: 'load' + i, position: i } },
])) });
await Promise.all(users.map(u => waitFor('cenas de carga', () => u.conn.db.scene.id.find('load' + (USERS - 1)))));

// Propagação: quando u0 grava um texto marcado, quanto tempo até os outros verem.
const sentAt = new Map<string, number>();
let stats = fresh();
for (const u of users.slice(1)) {
  u.conn.db.scene.onUpdate((_c, _old, row) => {
    const t = sentAt.get(row.text);
    if (t !== undefined) stats.remote.push(performance.now() - t);
  });
}

async function editor(u: Client, i: number, until: number) {
  let n = 0;
  while (performance.now() < until) {
    const text = `u${i}-${n++}-${uid('')}`;
    const t0 = performance.now();
    if (i === 0) sentAt.set(text, t0);
    try {
      await u.conn.reducers.applyOperations({ ops: JSON.stringify([{ op: 'upsert_scene', scene: { id: 'load' + i, text, x: 800 + (n % 40), y: i * 300 } }]) });
      stats.op.push(performance.now() - t0);
    } catch (e) { stats.errors.push('op: ' + String((e as Error)?.message ?? e).slice(0, 80)); }
    await sleep(300 + Math.random() * 200);
  }
}

// Cursor a 20 Hz (teto da especificação); mede a ida e volta de update_cursor.
async function cursor(u: Client, until: number) {
  while (performance.now() < until) {
    const t0 = performance.now();
    u.conn.reducers.updateCursor({ x: Math.random() * 1000, y: Math.random() * 800, visible: true })
      .then(() => stats.cursor.push(performance.now() - t0), () => {});
    await sleep(50);
  }
}

type Ai = { suggest: number[]; complete: number[]; ttft: number[]; chunkGap: number[]; chatTotal: number[]; character: number[]; errors: string[] };
const ai: Ai = { suggest: [], complete: [], ttft: [], chunkGap: [], chatTotal: [], character: [], errors: [] };

async function aiUser(u: Client, i: number, until: number) {
  const tasks: Promise<void>[] = [];
  // Shift em série: cada chamada espera o "provedor" (~1,5 s de rede).
  tasks.push((async () => {
    while (performance.now() < until) {
      const t0 = performance.now();
      try {
        if (i % 2) await proc(u.conn.procedures.suggestScene({ sourceSceneId: 't1', choiceId: 'tc2', instruction: '', newSceneId: uid('s'), context: ctxJson }));
        else await proc(u.conn.procedures.completeText({ sceneId: 't1', text: 'Era uma vez.', textKind: 'narration', speakerName: '', instruction: '' }));
        (i % 2 ? ai.suggest : ai.complete).push(performance.now() - t0);
      } catch (e) { ai.errors.push('proc: ' + String((e as Error)?.message ?? e).slice(0, 80)); }
      await sleep(1000);
    }
  })());
  // Chat em streaming, um pedido por vez.
  tasks.push((async () => {
    await sleep(i * 300);
    while (performance.now() < until - 3000) {
      const id = uid('j');
      const arrivals: number[] = [];
      const on = (_c: unknown, r: { jobId: string }) => { if (r.jobId === id) arrivals.push(performance.now()); };
      u.conn.db.chatChunk.onInsert(on);
      const t0 = performance.now();
      try {
        await u.conn.reducers.requestAi({ id, kind: 'chat', input: JSON.stringify({ message: 'continue a história a partir do final', context: CONTEXT }) });
        const j = await waitFor('chat', () => { const r = u.conn.db.myAiJob.id.find(id); return r && (r.status === 'done' || r.status === 'failed') ? r : null; }, 30_000);
        if (j.status !== 'done') ai.errors.push('chat: ' + j.error);
        else {
          ai.chatTotal.push(performance.now() - t0);
          if (arrivals.length) ai.ttft.push(arrivals[0] - t0);
          for (let k = 1; k < arrivals.length; k++) ai.chunkGap.push(arrivals[k] - arrivals[k - 1]);
        }
      } catch (e) { ai.errors.push('chat: ' + String((e as Error)?.message ?? e).slice(0, 80)); }
      u.conn.db.chatChunk.removeOnInsert(on);
      await sleep(1500);
    }
  })());
  // Um personagem com 4 sprites por pessoa.
  tasks.push((async () => {
    const id = uid('j'), t0 = performance.now();
    await u.conn.reducers.requestAi({ id, kind: 'character', input: JSON.stringify({ name: 'C' + i, desc: '', emotions: ['Neutro', 'Feliz', 'Triste', 'Bravo'].map(n => ({ name: n, desc: '' })) }) });
    const j = await waitFor('personagem', () => { const r = u.conn.db.myAiJob.id.find(id); return r && (r.status === 'done' || r.status === 'failed') ? r : null; }, 60_000);
    if (j.status === 'done') ai.character.push(performance.now() - t0); else ai.errors.push('personagem: ' + j.error);
  })());
  await Promise.all(tasks);
}

const fmt = (a: number[]) => a.length ? `p50 ${pct(a, 0.5)} · p95 ${pct(a, 0.95)} · máx ${Math.round(Math.max(...a))} ms (n=${a.length})` : '—';
function report(title: string, s: Stats) {
  console.log(`\n${title}`);
  console.log(`  ação discreta (apply_operations)  ${fmt(s.op)}`);
  console.log(`  propagação a outra pessoa         ${fmt(s.remote)}`);
  console.log(`  cursor (update_cursor, 20 Hz)     ${fmt(s.cursor)}`);
  if (s.errors.length) console.log(`  erros: ${s.errors.length} — ${[...new Set(s.errors)].slice(0, 3).join(' | ')}`);
  return { op95: pct(s.op, 0.95), remote95: pct(s.remote, 0.95) };
}

console.log(`${USERS} pessoas · fases de ${PHASE_MS / 1000} s · ${process.env.STDB_URI ?? 'local'} / ${process.env.STDB_DB}`);

let until = performance.now() + PHASE_MS;
await Promise.all(users.flatMap((u, i) => [editor(u, i, until), cursor(u, until)]));
const base = report('fase 1 — só edição', stats);

stats = fresh();
await sleep(500);
until = performance.now() + PHASE_MS;
await Promise.all(users.flatMap((u, i) => [editor(u, i, until), cursor(u, until), aiUser(u, i, until)]));
const withAi = report('fase 2 — edição + IA ao mesmo tempo', stats);
console.log(`  suggest_scene (procedure)         ${fmt(ai.suggest)}`);
console.log(`  complete_text (procedure)         ${fmt(ai.complete)}`);
console.log(`  chat: 1º pedaço                   ${fmt(ai.ttft)}`);
console.log(`  chat: intervalo entre pedaços     ${fmt(ai.chunkGap)}`);
console.log(`  chat: resposta completa           ${fmt(ai.chatTotal)}`);
console.log(`  personagem (4 sprites)            ${fmt(ai.character)}`);
if (ai.errors.length) console.log(`  erros de IA: ${ai.errors.length} — ${[...new Set(ai.errors)].slice(0, 4).join(' | ')}`);

const META = 300;
console.log(`\nmeta p95 ≤ ${META} ms: sem IA ${base.op95 <= META ? 'OK' : 'ACIMA'} (${base.op95}) · com IA ${withAi.op95 <= META ? 'OK' : 'ACIMA'} (${withAi.op95})`);
process.exit(0);
