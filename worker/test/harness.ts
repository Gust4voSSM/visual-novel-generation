// Clientes de teste: cada um é uma identidade anônima nova, como uma pessoa diferente.
// O módulo precisa estar publicado com AUTH_DEV_ANON=1 para aceitar identidades anônimas.
import { DbConnection } from '../src/module_bindings';

export const URI = process.env.STDB_URI ?? 'ws://127.0.0.1:3000';
export const DB = process.env.STDB_DB ?? 'roteiro-spike-ai';

export type Client = { conn: DbConnection; name: string };

export function connect(name: string, queries: string[], db = DB): Promise<Client> {
  return new Promise((resolve, reject) => {
    const conn = DbConnection.builder()
      .withUri(URI)
      .withDatabaseName(db)
      .onConnect(c => {
        c.subscriptionBuilder()
          .onApplied(() => resolve({ conn: c, name }))
          .onError((_ctx, err) => reject(err))
          .subscribe(queries);
      })
      .onConnectError((_ctx, err) => reject(err))
      .build();
  });
}

export const EDITOR_QUERIES = [
  'SELECT * FROM my_account', 'SELECT * FROM my_stories', 'SELECT * FROM my_memberships',
  'SELECT * FROM cur_story', 'SELECT * FROM cur_scene', 'SELECT * FROM cur_choice',
  'SELECT * FROM my_ai_job', 'SELECT * FROM my_chat_message', 'SELECT * FROM chat_chunk WHERE requester = :sender',
];

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
export const uid = (p: string) => p + crypto.randomUUID().replace(/-/g, '').slice(0, 12);

// Ids de cena e ação são globais no banco: cada execução usa os seus.
export const T = { story: uid('st'), s1: uid('t1'), s2: uid('t2'), c1: uid('tc1'), c2: uid('tc2') };

export const emailOf = (c: Client) => [...c.conn.db.myAccount.iter()][0]?.email ?? '';
export const errCode = (e: unknown) => String((e as Error)?.message ?? e);

export async function waitFor<T>(what: string, fn: () => T | undefined | null | false, timeoutMs = 15_000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error('tempo esgotado esperando: ' + what);
    await sleep(10);
  }
}

export function pct(a: number[], p: number) {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]);
}

// História mínima com elenco fixo (no spike o elenco fica no cliente e vai no contexto).
export const CONTEXT = {
  characters: [
    { id: 'cLia', name: 'Lia', desc: 'ruiva', sprites: [{ id: 'spL1', name: 'Neutro', desc: 'calma' }, { id: 'spL2', name: 'Feliz', desc: 'sorriso' }] },
    { id: 'cDavi', name: 'Davi', desc: 'pescador', sprites: [{ id: 'spD1', name: 'Bravo', desc: 'franzido' }] },
    { id: 'cCida', name: 'Cida', desc: 'grisalha', sprites: [{ id: 'spC1', name: 'Feliz', desc: 'acolhedor' }] },
    { id: 'cSem', name: 'Sem sprite', desc: '', sprites: [] },
  ],
  backgrounds: [{ id: 'bPraia', name: 'Praia' }, { id: 'bFarol', name: 'Farol à noite' }],
};

// A cria a história T.story e a compartilha como editora com os demais; todos a abrem.
export async function seedStory(c: Client, editors: Client[] = []) {
  const ops = [
    { op: 'upsert_scene', scene: { id: T.s1, title: 'Início', x: 0, y: 0, bg: 'bPraia', chars: '[]', kind: 'narration', speaker: '', text: 'Começo.', next: '', ai: '' } },
    { op: 'upsert_scene', scene: { id: T.s2, title: 'Meio', x: 380, y: 0, bg: '', chars: '[]', kind: 'narration', speaker: '', text: 'Meio.', next: '', ai: '' } },
    { op: 'upsert_choice', choice: { id: T.c1, sceneId: T.s1, label: 'Ir em frente', target: T.s2, position: 0 } },
    { op: 'upsert_choice', choice: { id: T.c2, sceneId: T.s1, label: 'Olhar o mar', target: '', position: 1 } },
  ];
  await c.conn.reducers.createStory({ id: T.story, title: 'Teste IA', startScene: T.s1, ops: JSON.stringify(ops) });
  await openAs(c, T.story);
  for (const e of editors) await addEditor(c, e);
}

export async function addEditor(owner: Client, e: Client, storyId = T.story) {
  await owner.conn.reducers.shareStory({ storyId, email: await waitFor('conta', () => emailOf(e)), role: 'editor' });
  await openAs(e, storyId);
}

export async function openAs(c: Client, storyId: string) {
  await c.conn.reducers.openStory({ storyId });
  await waitFor('história aberta', () => c.conn.db.curStory.id.find(storyId));
}

// Procedures devolvem {"ok": true, ...} ou {"error": "CÓDIGO"}.
export async function proc<T = any>(p: Promise<string>): Promise<T> {
  const r = JSON.parse(await p);
  if (r.error) throw new Error(r.error + (r.detail ? ' ' + r.detail : ''));
  return r;
}
