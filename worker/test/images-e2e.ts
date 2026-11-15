// T1–T3 (PLANO-SPRITES-BACKGROUNDS.md, seção 4): pedidos reais pela fila do worker, como o editor
// faz. CUSTA DINHEIRO (gpt-image-2): só roda com --gastar. Veja worker/IMAGENS-EXPERIMENTO.md.
//   npx tsx --env-file=.env test/images-e2e.ts t1|t2|t3|all --gastar
// Depois de T1–T3 (sem custo): composites de um sprite por personagem sobre cada background.
//   npx tsx --env-file=.env test/images-e2e.ts composite <results.json>...
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { EDITOR_QUERIES, connect, seedStory, uid, waitFor, T, type Client } from './harness';

const RUN = process.argv[2] ?? '';
const OUT = resolve(process.env.AI_IMAGE_EXPERIMENT_DIR ?? './experiments');
const PUBLIC = resolve(process.env.IMAGE_DIR ?? '../client/public/generated', '..');

const GIRL = 'A young woman with long silver hair in a side ponytail, violet eyes, wearing a navy-blue sailor school uniform with a white neck scarf and gold emblems, a ribbon, pleated skirt, dark thigh-high stockings and black loafers.';
const MACAW = 'An original anthropomorphic green-winged macaw adventurer character, upright bipedal bird with natural bird anatomy and feathered wings used as arms. Scarlet-red head, neck, breast and upper wing shoulders; broad saturated leaf-green middle wing feather bands; saturated royal-blue outer flight feathers and long blue-and-red tail; white bare face patches with fine red feather lines, pale ivory hooked upper beak, dark lower beak, expressive dark eyes, gray scaled feet with claws. A small tan leather cross-body satchel, no other clothing. The green bands are broad visible parts of both wings, including exposed feather edges.';
const POSES6 = [
  { name: 'speaking', desc: 'talking to someone, one hand raised at chest height in an open explaining gesture, mouth open' },
  { name: 'listening', desc: 'listening attentively, head slightly tilted, hands loosely clasped in front' },
  { name: 'thinking', desc: 'thinking, one hand at the chin, eyes looking up and to the side' },
  { name: 'happy', desc: 'happy, big smile, both hands raised slightly in delight' },
  { name: 'surprised', desc: 'surprised, eyes wide, mouth open, both hands raised near the shoulders, palms out' },
  { name: 'sad', desc: 'sad, eyes downcast, shoulders dropped, arms hanging close to the body' },
];
const MACAW3 = [
  { name: 'speaking', desc: 'cheerful greeting, beak slightly open, one wing raised and fanned outward in a welcoming wave, other wing lowered slightly away from body' },
  { name: 'listening', desc: 'listening attentively, head tilted, wings folded loosely in front of the body' },
  { name: 'thinking', desc: 'thinking, one wingtip touching the beak, eyes looking up' },
];
// Os quatro tipos de placeholder (day, night, interior, water), base de dia + variante noturna.
const PLACES = [
  { name: 'Vila na praia', desc: 'a small coastal fishing village street with colourful houses', kind: 'day' },
  { name: 'Farol', desc: 'an old lighthouse on a rocky cliff by the sea', kind: 'night' },
  { name: 'Café', desc: 'the inside of a cosy small-town café with wooden tables', kind: 'interior' },
  { name: 'Praia', desc: 'a wide sandy beach with calm sea and a wooden pier', kind: 'water' },
];

async function job(c: Client, kind: string, input: unknown, timeoutMs: number) {
  const id = uid('j');
  const t0 = Date.now();
  await c.conn.reducers.requestAi({ storyId: T.story, id, kind, input: JSON.stringify(input) });
  const j = await waitFor(`job ${id}`, () => { const j = [...c.conn.db.myAiJob.iter()].find(x => x.id === id); return j && (j.status === 'done' || j.status === 'failed') ? j : null; }, timeoutMs);
  const ms = Date.now() - t0;
  console.log(`  ${kind} ${j.status} em ${Math.round(ms / 1000)} s${j.error ? ' · ' + j.error : ''}`);
  return { kind, input, status: j.status, error: j.error, ms, result: j.result ? JSON.parse(j.result) : null };
}

async function composite(files: string[]) {
  const all = await Promise.all(files.map(async f => JSON.parse(await readFile(f, 'utf8'))));
  const r = { characters: all.flatMap(x => x.characters), backgrounds: all.flatMap(x => x.backgrounds) };
  const sprites: string[] = r.characters.filter((c: any) => c.status === 'done').map((c: any) => c.result.sprites[0].image_key);
  const bgs: string[] = r.backgrounds.filter((b: any) => b.status === 'done').flatMap((b: any) => [b.result.image_key, ...(b.result.variants ?? []).map((v: any) => v.image_key)]);
  const dir = join(OUT, 'composites');
  await mkdir(dir, { recursive: true });
  for (const [i, bg] of bgs.entries()) {
    const base = sharp(join(PUBLIC, bg));
    const { width = 1536, height = 864 } = await base.metadata();
    // Como no player (.pchar): altura 88% do palco, presos embaixo, lado a lado.
    const layers = await Promise.all(sprites.map(async (s, k) => {
      const h = Math.round(height * 0.88);
      const buf = await sharp(join(PUBLIC, s)).resize({ height: h }).toBuffer();
      const { width: w = 0 } = await sharp(buf).metadata();
      return { input: buf, top: height - h, left: Math.round(width * (k + 1) / (sprites.length + 1) - w / 2) };
    }));
    await base.composite(layers).png().toFile(join(dir, `scene-${i + 1}.png`));
  }
  console.log(`composites em ${dir}`);
}

if (RUN === 'composite') { await composite(process.argv.slice(3)); process.exit(0); }
if (!['t1', 't2', 't3', 'all'].includes(RUN) || !process.argv.includes('--gastar')) {
  console.error('uso: tsx test/images-e2e.ts t1|t2|t3|all --gastar   (gera imagens pagas)\n     tsx test/images-e2e.ts composite <results.json>...');
  process.exit(2);
}

const A = await connect('A', EDITOR_QUERIES);
await seedStory(A);
const results: { characters: unknown[]; backgrounds: unknown[] } = { characters: [], backgrounds: [] };
const H = 60 * 60_000;
if (RUN === 't1' || RUN === 'all') {
  console.log('T1: moça de cabelo prateado, front + side + 6 poses nos dois caminhos');
  results.characters.push(await job(A, 'character', { name: 'Moça', desc: 'cabelo prateado', design: GIRL, emotions: POSES6, compare: true }, H));
}
if (RUN === 't2' || RUN === 'all') {
  console.log('T2: arara, front + side + 3 poses nos dois caminhos (caso de colisão de cor)');
  results.characters.push(await job(A, 'character', { name: 'Arara', desc: 'arara', design: MACAW, emotions: MACAW3, compare: true }, H));
}
if (RUN === 't3' || RUN === 'all') {
  console.log('T3: 4 backgrounds base + variante noturna de cada');
  for (const p of PLACES) results.backgrounds.push(await job(A, 'background', { name: p.name, desc: p.desc, time: 'day', variants: ['night'] }, H));
}
await mkdir(OUT, { recursive: true });
const file = join(OUT, `results-${RUN}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
await writeFile(file, JSON.stringify(results, null, 2));
console.log(`resultado: ${file}`);
process.exit(0);
