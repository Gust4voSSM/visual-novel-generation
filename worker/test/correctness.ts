// Testes de correção do caminho de IA com o provedor mock. Precisa do módulo publicado
// com AI_PROVIDER=mock e do worker rodando (npm start). NOAI_DB opcional: um banco
// publicado sem AI_PROVIDER, para conferir AI_DISABLED.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CONTEXT, EDITOR_QUERIES, connect, errCode, proc, seedStory, sleep, uid, waitFor, type Client } from './harness';

const PLACEHOLDERS = fileURLToPath(new URL('../../client/public/', import.meta.url));
let pass = 0, fail = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FALHA ' + name + '\n        ' + errCode(e)); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }
async function rejects(p: Promise<unknown>, code: string) {
  try { await p; } catch (e) { assert(errCode(e).includes(code), `esperava ${code}, veio ${errCode(e)}`); return; }
  throw new Error(`esperava erro ${code}, mas deu certo`);
}
const ctxJson = JSON.stringify(CONTEXT);
const jobOf = (c: Client, id: string) => [...c.conn.db.myAiJob.iter()].find(j => j.id === id);
const doneJob = (c: Client, id: string, ms = 20_000) =>
  waitFor(`job ${id}`, () => { const j = jobOf(c, id); return j && (j.status === 'done' || j.status === 'failed') ? j : null; }, ms);

const A = await connect('A', EDITOR_QUERIES);
const B = await connect('B', EDITOR_QUERIES);
await seedStory(A);
await waitFor('seed', () => A.conn.db.scene.id.find('t2'));

console.log('\nprocedures (suggest_scene, complete_text)');
await test('suggest_scene devolve cena válida contra o contexto (20 sorteios)', async () => {
  const P = await connect('P', EDITOR_QUERIES);
  const sprites = new Map(CONTEXT.characters.flatMap(c => c.sprites.map(s => [s.id, c.id])));
  for (let i = 0; i < 18; i++) {
    const out = (await proc(P.conn.procedures.suggestScene({ sourceSceneId: 't1', choiceId: 'tc2', instruction: '', newSceneId: uid('s'), context: ctxJson }))).scene;
    assert(['narration', 'dialogue'].includes(out.text_kind), 'text_kind inválido');
    assert(out.characters.length <= 6, 'mais de 6 personagens');
    assert(new Set(out.characters.map((c: any) => c.character_id)).size === out.characters.length, 'personagem repetido');
    for (const c of out.characters) assert(sprites.get(c.sprite_id) === c.character_id, 'sprite de outro personagem');
    assert(!out.characters.some((c: any) => c.character_id === 'cSem'), 'personagem sem sprite na cena');
    if (out.text_kind === 'dialogue') assert(out.characters.some((c: any) => c.character_id === out.speaker_character_id), 'falante fora da cena');
    assert(out.background_id === '' || CONTEXT.backgrounds.some(b => b.id === out.background_id), 'background fora do contexto');
    assert(out.title === 'Olhar o mar', 'título deveria vir do rótulo da ação: ' + out.title);
    assert(out.body.length > 0, 'texto vazio');
  }
});
await test('cena sugerida é aceita pelo apply_operations (fluxo do Shift)', async () => {
  const id = uid('s');
  await A.conn.reducers.applyOperations({ ops: JSON.stringify([
    { op: 'upsert_scene', scene: { id, title: 'Gerando…', x: 760, y: 120, bg: '', chars: '[]', kind: 'narration', speaker: '', text: '', next: '', ai: 'generating' } },
    { op: 'upsert_choice', choice: { id: 'tc2', target: id } },
  ]) });
  await waitFor('cena gerando visível para B', () => B.conn.db.scene.id.find(id)?.ai === 'generating');
  const out = (await proc(A.conn.procedures.suggestScene({ sourceSceneId: 't1', choiceId: 'tc2', instruction: '', newSceneId: id, context: ctxJson }))).scene;
  await A.conn.reducers.applyOperations({ ops: JSON.stringify([{ op: 'upsert_scene', scene: {
    id, title: out.title, bg: out.background_id, kind: out.text_kind, speaker: out.speaker_character_id, text: out.body, ai: '',
    chars: JSON.stringify(out.characters.map((c: any) => ({ c: c.character_id, s: c.sprite_id }))),
  } }]) });
  const seen = await waitFor('cena pronta em B', () => { const s = B.conn.db.scene.id.find(id); return s && s.ai === '' ? s : null; });
  assert(seen.text === out.body, 'B não viu o texto gerado');
});
await test('suggest_scene com cena de origem inexistente → NOT_FOUND', () =>
  rejects(proc(A.conn.procedures.suggestScene({ sourceSceneId: 'nao-existe', choiceId: '', instruction: '', newSceneId: 'x', context: ctxJson })), 'NOT_FOUND'));
await test('falha do provedor (#falha) → AI_PROVIDER_ERROR', () =>
  rejects(proc(A.conn.procedures.suggestScene({ sourceSceneId: 't1', choiceId: '', instruction: '#falha', newSceneId: 'x', context: ctxJson })), 'AI_PROVIDER_ERROR'));
await test('contexto malformado → INVALID', () =>
  rejects(proc(A.conn.procedures.suggestScene({ sourceSceneId: 't1', choiceId: '', instruction: '', newSceneId: 'x', context: '{nope' })), 'INVALID'));
await test('complete_text continua o texto original', async () => {
  const out = (await proc(A.conn.procedures.completeText({ sceneId: 't1', text: 'Começo.', textKind: 'narration', speakerName: '', instruction: '' }))).text;
  assert(out.startsWith('Começo.') && out.length > 'Começo.'.length, 'texto não continua o original: ' + out);
});

console.log('\nfila do worker: chat com streaming');
await test('chat: pedaços em ordem, sem buracos, iguais à mensagem final', async () => {
  const id = uid('j');
  const chunks: { seq: number; text: string; at: number }[] = [];
  const onChunk = (_c: unknown, r: { jobId: string; seq: number; text: string }) => { if (r.jobId === id) chunks.push({ seq: r.seq, text: r.text, at: performance.now() }); };
  A.conn.db.chatChunk.onInsert(onChunk);
  const t0 = performance.now();
  await A.conn.reducers.requestAi({ id, kind: 'chat', input: JSON.stringify({ message: 'crie a cena da ação sem destino', context: CONTEXT }) });
  const job = await doneJob(A, id);
  A.conn.db.chatChunk.removeOnInsert(onChunk);
  assert(job.status === 'done', 'job terminou como ' + job.status + ' ' + job.error);
  const final = await waitFor('mensagem final', () => [...A.conn.db.myChatMessage.iter()].find(m => m.id === id + ':a'));
  assert([...A.conn.db.myChatMessage.iter()].some(m => m.id === id + ':u' && m.role === 'user'), 'mensagem do usuário ausente');
  assert(chunks.length >= 3, 'poucos pedaços: ' + chunks.length);
  chunks.forEach((c, i) => assert(c.seq === i, `pedaço fora de ordem: posição ${i} tem seq ${c.seq}`));
  assert(chunks.map(c => c.text).join('') === final.content, 'texto dos pedaços difere da mensagem final');
  const gaps = chunks.slice(1).map((c, i) => c.at - chunks[i].at);
  console.log(`        ${chunks.length} pedaços · 1º em ${Math.round(chunks[0].at - t0)} ms · intervalo médio ${Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length)} ms`);
});
await test('chat: proposta é aplicável e mantém o grafo válido', async () => {
  const id = uid('j');
  await A.conn.reducers.requestAi({ id, kind: 'chat', input: JSON.stringify({ message: 'continue a história', context: CONTEXT }) });
  await doneJob(A, id);
  const msg = await waitFor('resposta', () => [...A.conn.db.myChatMessage.iter()].find(m => m.id === id + ':a'));
  const proposals = JSON.parse(msg.proposals);
  assert(proposals.length === 1 && proposals[0].ops.length >= 2, 'sem proposta');
  await A.conn.reducers.applyOperations({ ops: JSON.stringify(proposals[0].ops) });
  const sceneOp = proposals[0].ops.find((o: any) => o.op === 'upsert_scene');
  await waitFor('cena da proposta em B', () => B.conn.db.scene.id.find(sceneOp.scene.id));
});
await test('chat: pedaços, pedidos e conversa de A não chegam a B', async () => {
  const id = uid('j');
  let leaked = 0;
  const spy = (_c: unknown, r: { jobId: string }) => { if (r.jobId === id) leaked++; };
  B.conn.db.chatChunk.onInsert(spy);
  await A.conn.reducers.requestAi({ id, kind: 'chat', input: JSON.stringify({ message: 'oi', context: CONTEXT }) });
  await doneJob(A, id);
  await sleep(200);
  B.conn.db.chatChunk.removeOnInsert(spy);
  assert(leaked === 0, `B recebeu ${leaked} pedaços de A`);
  assert(![...B.conn.db.myAiJob.iter()].some(j => j.id === id), 'B vê o ai_job de A');
  assert(![...B.conn.db.myChatMessage.iter()].some(m => m.jobId === id), 'B vê a conversa de A');
});
await test('chat: falha no meio do streaming → failed, sem mensagem final', async () => {
  const id = uid('j');
  await A.conn.reducers.requestAi({ id, kind: 'chat', input: JSON.stringify({ message: 'teste #falha', context: CONTEXT }) });
  const job = await doneJob(A, id);
  assert(job.status === 'failed' && job.error === 'AI_PROVIDER_ERROR', `status ${job.status} / ${job.error}`);
  await sleep(150);
  assert(![...A.conn.db.myChatMessage.iter()].some(m => m.id === id + ':a'), 'mensagem final não deveria existir');
});

console.log('\nfila do worker: imagens (placeholders)');
await test('personagem: um sprite por emoção, na ordem, com imagem existente', async () => {
  const id = uid('j');
  const emotions = [{ name: 'Neutro', desc: 'calma' }, { name: 'Feliz', desc: 'sorriso' }, { name: 'Brava', desc: 'franzida' }, { name: 'Surpresa', desc: 'olhos arregalados' }];
  await A.conn.reducers.requestAi({ id, kind: 'character', input: JSON.stringify({ name: 'Marta', desc: 'cabelo preto', color: '', emotions }) });
  const job = await doneJob(A, id);
  assert(job.status === 'done', job.status + ' ' + job.error);
  const r = JSON.parse(job.result);
  assert(r.sprites.length === 4, 'quantidade de sprites');
  r.sprites.forEach((s: any, i: number) => {
    assert(s.name === emotions[i].name, 'ordem dos sprites');
    assert(existsSync(PLACEHOLDERS + s.image_key), 'imagem não existe: ' + s.image_key);
  });
  assert(r.sprites[1].image_key.endsWith('sprite-happy.svg') && r.sprites[2].image_key.endsWith('sprite-angry.svg'), 'placeholder não segue a emoção');
});
await test('background: image_key existente', async () => {
  const id = uid('j');
  await A.conn.reducers.requestAi({ id, kind: 'background', input: JSON.stringify({ name: 'Farol', desc: 'noite estrelada' }) });
  const job = await doneJob(A, id);
  const r = JSON.parse(job.result);
  assert(job.status === 'done' && existsSync(PLACEHOLDERS + r.image_key) && r.image_key.endsWith('bg-night.svg'), job.result);
});
await test('background com falha do provedor → failed', async () => {
  const id = uid('j');
  await A.conn.reducers.requestAi({ id, kind: 'background', input: JSON.stringify({ name: 'X', desc: '#falha' }) });
  const job = await doneJob(A, id);
  assert(job.status === 'failed' && job.error === 'AI_PROVIDER_ERROR', job.status + ' ' + job.error);
});

console.log('\nregras da fila');
await test('request_ai repetido com o mesmo id não duplica', async () => {
  const id = uid('j');
  const input = JSON.stringify({ name: 'Bosque', desc: 'dia' });
  await A.conn.reducers.requestAi({ id, kind: 'background', input });
  await A.conn.reducers.requestAi({ id, kind: 'background', input });
  await doneJob(A, id);
  assert([...A.conn.db.myAiJob.iter()].filter(j => j.id === id).length === 1, 'duplicou');
});
await test('id de outra pessoa → INVALID', async () => {
  const id = uid('j');
  await A.conn.reducers.requestAi({ id, kind: 'background', input: JSON.stringify({ name: 'a', desc: 'b' }) });
  await rejects(B.conn.reducers.requestAi({ id, kind: 'background', input: '{}' }), 'INVALID');
});
await test('tipo desconhecido → INVALID', () => rejects(A.conn.reducers.requestAi({ id: uid('j'), kind: 'video', input: '{}' }), 'INVALID'));
await test('reducers do worker recusam outras identidades', async () => {
  await rejects(A.conn.reducers.claimJob({ id: 'x' }), 'FORBIDDEN');
  await rejects(A.conn.reducers.pushChatChunk({ jobId: 'x', seq: 0, text: 'oi' }), 'FORBIDDEN');
  await rejects(A.conn.reducers.completeJob({ id: 'x', result: '{}' }), 'FORBIDDEN');
  await rejects(A.conn.reducers.failJob({ id: 'x', error: '' }), 'FORBIDDEN');
  await rejects(A.conn.reducers.registerWorker({ secret: 'chute' }), 'FORBIDDEN');
});
await test('limite por minuto → RATE_LIMITED no 21º pedido', async () => {
  const R = await connect('R', EDITOR_QUERIES);
  for (let i = 0; i < 20; i++) await R.conn.reducers.requestAi({ id: uid('j'), kind: 'background', input: JSON.stringify({ name: 'r', desc: 'dia' }) });
  await rejects(R.conn.reducers.requestAi({ id: uid('j'), kind: 'background', input: '{}' }), 'RATE_LIMITED');
  await rejects(proc(R.conn.procedures.completeText({ sceneId: 't1', text: 'a', textKind: 'narration', speakerName: '', instruction: '' })), 'RATE_LIMITED');
});
if (process.env.NOAI_DB) {
  await test('sem AI_PROVIDER publicado → AI_DISABLED', async () => {
    const N = await connect('N', ['SELECT * FROM story'], process.env.NOAI_DB);
    await rejects(N.conn.reducers.requestAi({ id: uid('j'), kind: 'chat', input: JSON.stringify({ message: 'oi' }) }), 'AI_DISABLED');
    await rejects(proc(N.conn.procedures.completeText({ sceneId: 't1', text: 'a', textKind: 'narration', speakerName: '', instruction: '' })), 'AI_DISABLED');
  });
}

console.log(`\n${pass} ok, ${fail} falhas`);
process.exit(fail ? 1 : 0);
