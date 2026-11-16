// Offline: backgrounds novos pedidos pelo agente na proposta (novos_backgrounds) — npx tsx test/agent-backgrounds.ts
import assert from 'node:assert/strict';
import { buildProposal, type AiContext, type StorySnapshot } from '../src/providers';

const ctx: AiContext = { characters: [], backgrounds: [{ id: 'b_old', name: 'Praia' }] };
const story: StorySnapshot = {
  title: 't', startScene: 's1',
  scenes: [{ id: 's1', title: 'Início', x: 0, y: 0, text: 'Começo.', next: '', bg: 'b_old', chars: '[]', kind: 'narration', speaker: '' }],
  choices: [],
};
const prompt = 'A Japanese high school classroom with rows of wooden desks, green chalkboard on the far wall, tall windows on the left letting in warm afternoon light, beige walls, a wall clock without markings, open floor in the lower centre.';
const bg = { ref: 'b1', nome: 'Sala de aula', descricao: 'Sala de aula japonesa.', prompt, time: 'day', mood: 'calm' };
const scene = { ref: 'n1', title: 'Aula', bg: 'b1', cast: [], kind: 'narration', speaker: '', text: 'A aula começa.' };
const link = [{ from: 's1', choice: 'next', label: '', to: 'n1' }];

// 1. ref do background no bg da cena vira o id gerado; a proposta leva o prompt.
const ok = buildProposal({ resposta: '', novos_backgrounds: [bg], criar: [scene], ligar: link }, ctx, story);
assert.ok(typeof ok !== 'string', String(ok));
assert.equal(ok.backgrounds?.length, 1);
const nb = ok.backgrounds![0];
assert.equal(nb.prompt, prompt);
assert.equal(nb.time, 'day');
const up = ok.ops.find(o => o.op === 'upsert_scene' && ok.created.includes(o.scene.id));
assert.equal((up as any).scene.bg, nb.id);
assert.match(ok.summary[0], /Gerar background “Sala de aula”/);

// 2. background que nenhuma cena usa é recusado.
const unused = buildProposal({ resposta: '', novos_backgrounds: [bg], criar: [{ ...scene, bg: 'b_old' }], ligar: link }, ctx, story);
assert.ok(typeof unused === 'string' && /nenhuma cena usa/.test(unused), String(unused));

// 3. prompt curto demais é recusado.
const short = buildProposal({ resposta: '', novos_backgrounds: [{ ...bg, prompt: 'a classroom' }], criar: [scene], ligar: link }, ctx, story);
assert.ok(typeof short === 'string' && /prompt/.test(short), String(short));

// 4. ref inexistente no bg continua sendo erro; sem novos_backgrounds, nada muda.
const bad = buildProposal({ resposta: '', criar: [{ ...scene, bg: 'b9' }], ligar: link }, ctx, story);
assert.ok(typeof bad === 'string' && /"b9" não existe/.test(bad), String(bad));
const plain = buildProposal({ resposta: '', criar: [{ ...scene, bg: 'b_old' }], ligar: link }, ctx, story);
assert.ok(typeof plain !== 'string' && !plain.backgrounds);

// 5. alterar uma cena existente para um background novo.
const alt = buildProposal({ resposta: '', novos_backgrounds: [bg], alterar: [{ id: 's1', bg: 'b1' }] }, ctx, story);
assert.ok(typeof alt !== 'string', String(alt));
assert.equal((alt.ops[0] as any).scene.bg, alt.backgrounds![0].id);

console.log('agent-backgrounds: ok');
