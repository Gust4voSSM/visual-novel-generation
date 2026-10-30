// Testes de histórias por pessoa: CRUD, compartilhamento e isolamento entre histórias.
// Não precisa do worker. Módulo publicado com AUTH_DEV_ANON=1 em STDB_DB; PROD_DB opcional:
// um banco publicado sem AUTH_DEV_ANON, para conferir que conexões anônimas são recusadas.
import { EDITOR_QUERIES, connect, emailOf, errCode, openAs, sleep, uid, waitFor, type Client } from './harness';

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

const QUERIES = [...EDITOR_QUERIES, 'SELECT * FROM cur_member', 'SELECT * FROM cur_invite', 'SELECT * FROM cur_presence', 'SELECT * FROM cur_locks'];
const sceneOp = (id: string, extra: Record<string, unknown> = {}) =>
  ({ op: 'upsert_scene', scene: { id, title: 'Cena', x: 0, y: 0, bg: '', chars: '[]', kind: 'narration', speaker: '', text: '', next: '', ai: '', ...extra } });

async function newStory(c: Client, title = 'História') {
  const id = uid('st'), start = uid('s');
  await c.conn.reducers.createStory({ id, title, startScene: start, ops: JSON.stringify([sceneOp(start)]) });
  return { id, start };
}
const ops = (c: Client, storyId: string, list: unknown[]) => c.conn.reducers.applyOperations({ storyId, ops: JSON.stringify(list) });
const mine = (c: Client) => [...c.conn.db.myStories.iter()].map(s => s.id);

const A = await connect('A', QUERIES);
const B = await connect('B', QUERIES);
const C = await connect('C', QUERIES);
await Promise.all([A, B, C].map(c => waitFor('conta', () => emailOf(c))));

console.log('\nCRUD');
const a1 = await newStory(A, 'De A');
const b1 = await newStory(B, 'De B');
await test('cada pessoa vê só as próprias histórias em my_stories', async () => {
  await waitFor('história de A', () => mine(A).includes(a1.id));
  await waitFor('história de B', () => mine(B).includes(b1.id));
  assert(!mine(A).includes(b1.id) && !mine(B).includes(a1.id), 'vazou história de outra pessoa');
  const m = [...A.conn.db.myMemberships.iter()].find(r => r.storyId === a1.id);
  assert(m?.role === 'owner', 'dono não é owner: ' + m?.role);
});
await test('create_story repetido pelo dono não duplica; por outra pessoa → INVALID', async () => {
  await A.conn.reducers.createStory({ id: a1.id, title: 'x', startScene: a1.start, ops: '[]' });
  assert(mine(A).filter(id => id === a1.id).length === 1, 'duplicou');
  await rejects(B.conn.reducers.createStory({ id: a1.id, title: 'x', startScene: 's', ops: '[]' }), 'INVALID');
});
await test('create_story sem cena inicial → NO_START', () =>
  rejects(A.conn.reducers.createStory({ id: uid('st'), title: 'x', startScene: 'nada', ops: '[]' }), 'NO_START'));
await test('rename_story muda o título para quem lista', async () => {
  await A.conn.reducers.renameStory({ storyId: a1.id, title: 'Renomeada' });
  await waitFor('título novo', () => A.conn.db.myStories.id.find(a1.id)?.title === 'Renomeada');
});

console.log('\nisolamento');
await test('cur_* mostra só a história aberta', async () => {
  await openAs(A, a1.id);
  await openAs(B, b1.id);
  await waitFor('cena de A', () => A.conn.db.curScene.id.find(a1.start));
  assert(!A.conn.db.curScene.id.find(b1.start), 'A vê cena de B');
  assert(!B.conn.db.curScene.id.find(a1.start), 'B vê cena de A');
});
await test('quem não é membro: open/apply/rename/delete → NOT_FOUND', async () => {
  await rejects(C.conn.reducers.openStory({ storyId: a1.id }), 'NOT_FOUND');
  await rejects(ops(C, a1.id, [sceneOp(uid('s'))]), 'NOT_FOUND');
  await rejects(C.conn.reducers.renameStory({ storyId: a1.id, title: 'x' }), 'NOT_FOUND');
  await rejects(C.conn.reducers.deleteStory({ storyId: a1.id }), 'NOT_FOUND');
  await rejects(C.conn.reducers.lockField({ target: `scene:${a1.start}:text` }), 'NOT_FOUND');
});
await test('lote na própria história com id de cena de outra → FORBIDDEN', async () => {
  await rejects(ops(A, a1.id, [sceneOp(b1.start, { text: 'sequestro' })]), 'FORBIDDEN');
  await rejects(ops(A, a1.id, [{ op: 'delete_scene', id: b1.start }]), 'FORBIDDEN');
});
await test('ligação para cena de outra história → NOT_FOUND', () =>
  rejects(ops(A, a1.id, [sceneOp(a1.start, { next: b1.start })]), 'NOT_FOUND'));
await test('a validação do grafo não olha outras histórias', async () => {
  // Um ciclo só existe dentro de uma história; criar cenas em B não afeta lotes em A.
  const x = uid('s');
  await ops(A, a1.id, [sceneOp(x), sceneOp(a1.start, { next: x })]);
  await rejects(ops(A, a1.id, [sceneOp(x, { next: a1.start })]), 'CYCLE');
});
await test('arrasto chega só a quem assina a história (WHERE story_id)', async () => {
  const got: string[] = [];
  B.conn.subscriptionBuilder().subscribe([`SELECT * FROM drags WHERE story_id = '${b1.id}'`]);
  B.conn.db.drags.onInsert((_c, r) => got.push(r.storyId));
  await sleep(200);
  await A.conn.reducers.sendDrag({ moves: '[]', done: true });
  await B.conn.reducers.sendDrag({ moves: '[]', done: true });
  await waitFor('arrasto de B', () => got.includes(b1.id));
  await sleep(200);
  assert(!got.includes(a1.id), 'B recebeu arrasto da história de A');
});

console.log('\ncompartilhamento');
await test('leitor vê e abre, mas não edita nem trava', async () => {
  await A.conn.reducers.shareStory({ storyId: a1.id, email: emailOf(C), role: 'viewer' });
  await waitFor('história compartilhada', () => mine(C).includes(a1.id));
  await openAs(C, a1.id);
  await waitFor('cena visível ao leitor', () => C.conn.db.curScene.id.find(a1.start));
  await rejects(ops(C, a1.id, [sceneOp(a1.start, { text: 'x' })]), 'FORBIDDEN');
  await rejects(C.conn.reducers.lockField({ target: `scene:${a1.start}:text` }), 'FORBIDDEN');
  await rejects(C.conn.reducers.shareStory({ storyId: a1.id, email: emailOf(B), role: 'editor' }), 'FORBIDDEN');
});
await test('editor edita, e a mudança chega aos outros membros', async () => {
  await A.conn.reducers.shareStory({ storyId: a1.id, email: emailOf(C), role: 'editor' });
  await waitFor('papel novo', () => [...C.conn.db.myMemberships.iter()].find(m => m.storyId === a1.id)?.role === 'editor');
  await ops(C, a1.id, [sceneOp(a1.start, { text: 'de C' })]);
  await waitFor('A vê o texto de C', () => A.conn.db.curScene.id.find(a1.start)?.text === 'de C');
  await rejects(C.conn.reducers.deleteStory({ storyId: a1.id }), 'FORBIDDEN');
  await rejects(C.conn.reducers.resetStory({ storyId: a1.id, title: 'x', startScene: a1.start, ops: '[]' }), 'FORBIDDEN');
});
await test('membros aparecem em cur_member', async () => {
  await waitFor('dois membros', () => [...A.conn.db.curMember.iter()].length === 2);
});
await test('convite para e-mail sem conta fica em cur_invite (só para o dono)', async () => {
  await A.conn.reducers.shareStory({ storyId: a1.id, email: 'Alguem.Novo@Example.com', role: 'viewer' });
  const inv = await waitFor('convite', () => [...A.conn.db.curInvite.iter()].find(v => v.email === 'alguem.novo@example.com'));
  assert(![...C.conn.db.curInvite.iter()].length, 'editor vê convites');
  await A.conn.reducers.cancelInvite({ id: inv.id });
  await waitFor('convite cancelado', () => ![...A.conn.db.curInvite.iter()].length);
});
await test('e-mail inválido ou papel desconhecido → INVALID', async () => {
  await rejects(A.conn.reducers.shareStory({ storyId: a1.id, email: 'nao-email', role: 'viewer' }), 'INVALID');
  await rejects(A.conn.reducers.shareStory({ storyId: a1.id, email: 'a@b.co', role: 'owner' }), 'INVALID');
});
await test('remover membro tira o acesso na hora', async () => {
  const cId = [...C.conn.db.myAccount.iter()][0].identity;
  await A.conn.reducers.removeMember({ storyId: a1.id, userId: cId });
  await waitFor('C perde a história', () => !mine(C).includes(a1.id));
  await waitFor('cur_scene de C esvazia', () => ![...C.conn.db.curScene.iter()].length);
  await rejects(ops(C, a1.id, [sceneOp(a1.start)]), 'NOT_FOUND');
});
await test('membro pode sair; o dono não', async () => {
  await A.conn.reducers.shareStory({ storyId: a1.id, email: emailOf(C), role: 'viewer' });
  await waitFor('de volta', () => mine(C).includes(a1.id));
  const cId = [...C.conn.db.myAccount.iter()][0].identity;
  await C.conn.reducers.removeMember({ storyId: a1.id, userId: cId });
  await waitFor('saiu', () => !mine(C).includes(a1.id));
  const aId = [...A.conn.db.myAccount.iter()][0].identity;
  await rejects(A.conn.reducers.removeMember({ storyId: a1.id, userId: aId }), 'INVALID');
});

console.log('\nexclusão');
await test('delete_story apaga a história para todos os membros', async () => {
  await A.conn.reducers.shareStory({ storyId: a1.id, email: emailOf(B), role: 'editor' });
  await waitFor('B vê', () => mine(B).includes(a1.id));
  await openAs(B, a1.id);
  await A.conn.reducers.deleteStory({ storyId: a1.id });
  await waitFor('some para A', () => !mine(A).includes(a1.id));
  await waitFor('some para B', () => !mine(B).includes(a1.id) && ![...B.conn.db.curScene.iter()].length);
  await rejects(A.conn.reducers.openStory({ storyId: a1.id }), 'NOT_FOUND');
});

if (process.env.PROD_DB) {
  console.log('\nprodução (sem AUTH_DEV_ANON)');
  await test('conexão anônima não usa reducers de usuário → UNAUTHENTICATED', async () => {
    const P = await connect('P', ['SELECT * FROM my_stories'], process.env.PROD_DB);
    await rejects(P.conn.reducers.createStory({ id: uid('st'), title: 'x', startScene: 's', ops: '[]' }), 'UNAUTHENTICATED');
    await rejects(P.conn.reducers.setProfile({ name: 'x', color: '#fff' }), 'UNAUTHENTICATED');
  });
  await test('token de outro emissor não vira conta', async () => {
    const P = await connect('P2', ['SELECT * FROM my_account'], process.env.PROD_DB);
    await sleep(200);
    assert(![...P.conn.db.myAccount.iter()].length, 'conta criada para identidade anônima');
  });
}

console.log(`\n${pass} ok, ${fail} falhas`);
process.exit(fail ? 1 : 0);
