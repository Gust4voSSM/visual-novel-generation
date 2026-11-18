// Validação das propostas do agente: converte a saída da ferramenta em operações e confere as regras do grafo.
import type { AiContext, NewBackground, NewCharacter, Op, Proposal, StoryChoice, StoryScene, StorySnapshot } from './providers/types';
import { clip, newId, norm } from './util';

const MAX_POSES = 12; // igual ao generate_character do módulo
type CharacterArgs = { ref: string; name: string; desc: string; poses: { ref: string; name: string; desc: string }[] };
type BgArgs = { ref: string; nome?: string; descricao?: string; prompt?: string; time?: string; mood?: string };
type SceneArgs = { title?: string; bg?: string; cast?: { character: string; sprite: string }[]; kind?: string; speaker?: string; text?: string };
export type ProposeArgs = {
  resposta: string; summary?: string[];
  personagens?: CharacterArgs[];
  continuar?: string;
  novos_backgrounds?: BgArgs[];
  criar?: (SceneArgs & { ref: string })[];
  alterar?: (SceneArgs & { id: string })[];
  remover?: string[];
  ligar?: { from: string; choice: string; label: string; to: string }[];
  remover_acoes?: string[];
};

// Aspas ou travessão em volta da fala inteira: só tira os sinais.
export function cleanSpeech(text: string): string {
  let t = text.trim();
  const m = /^[“"«]([^”"»]*)[”"»]$/.exec(t);
  if (m) t = m[1].trim();
  return t.replace(/^[—–-]\s+/, '');
}

// Narração dentro de uma fala: o nome de quem fala no texto, ou bastante texto fora das aspas.
export function speechProblem(text: string, speakerName: string): string | null {
  const esc = speakerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (speakerName && new RegExp(`(^|[^\\p{L}])${esc}([^\\p{L}]|$)`, 'iu').test(text)) return `o texto cita "${speakerName}", então narra em vez de ser só a fala`;
  const outside = text.replace(/[“"«][^”"»]*[”"»]/g, '');
  if (outside !== text && outside.replace(/[^\p{L}]/gu, '').length >= 20) return 'tem narração fora das aspas';
  return null;
}

export function parseCast(chars: string): { c: string; s: string }[] {
  try { const v = JSON.parse(chars || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}

type WScene = Omit<StoryScene, 'id'>;
type WChoice = Omit<StoryChoice, 'id'>;
const SCENE_KEYS = ['title', 'x', 'y', 'bg', 'chars', 'kind', 'speaker', 'text', 'next'] as const;
const CHOICE_KEYS = ['sceneId', 'label', 'target', 'position'] as const;

// Mesmas regras do validate do módulo; devolve o problema em palavras, ou null.
export function graphProblem(start: string, scenes: Map<string, WScene>, choices: Map<string, WChoice>): string | null {
  if (!scenes.has(start)) return 'a cena inicial seria removida';
  const outs = new Map<string, string[]>();
  for (const id of scenes.keys()) outs.set(id, []);
  for (const c of choices.values()) {
    if (!scenes.has(c.sceneId)) return 'uma ação ficaria sem cena';
    if (c.target) {
      if (!scenes.has(c.target)) return 'uma ação apontaria para uma cena que não existe';
      outs.get(c.sceneId)!.push(c.target);
    }
  }
  for (const [id, s] of scenes) {
    const title = `“${s.title}” (${id})`;
    if (s.next) {
      if ([...choices.values()].some(c => c.sceneId === id)) return `${title} teria ações e saída única ao mesmo tempo`;
      if (!scenes.has(s.next)) return `${title} seguiria para uma cena que não existe`;
      outs.get(id)!.push(s.next);
    }
    const cast = parseCast(s.chars);
    if (cast.length > 6) return `${title} teria mais de 6 personagens`;
    if (new Set(cast.map(m => m.c)).size !== cast.length) return `${title} teria um personagem repetido`;
    if (s.kind === 'dialogue' && !cast.some(m => m.c === s.speaker)) return `quem fala em ${title} não estaria na cena`;
  }
  const color = new Map<string, number>();
  const visit = (id: string): boolean => {
    color.set(id, 1);
    for (const n of outs.get(id)!) {
      const k = color.get(n) ?? 0;
      if (k === 1 || (k === 0 && visit(n))) return true;
    }
    color.set(id, 2);
    return false;
  };
  for (const id of outs.keys()) if (!color.get(id) && visit(id)) return 'as ligações formariam um ciclo';
  return null;
}

// Converte a saída da ferramenta nas operações do apply_operations: aplica as mudanças numa cópia
// do grafo, confere ids e regras e emite só a diferença. Quando a proposta não cabe no grafo,
// devolve os problemas em texto, com os ids, para o modelo corrigir (veja OpenAiProvider.chat).
export function buildProposal(a: ProposeArgs, ctx: AiContext, story: StorySnapshot): Proposal | string {
  const sprites = new Map(ctx.characters.map(c => [c.id, c.sprites.map(s => s.id)]));
  const names = new Map(ctx.characters.map(c => [c.id, c.name]));
  // Personagens novos: ids definitivos já aqui; o cliente manda gerar com eles ao aceitar.
  const charRefs = new Set<string>();
  const newChars: NewCharacter[] = [];
  const errs: string[] = [];
  for (const n of a.personagens ?? []) {
    const where = `personagens "${n.ref || n.name}"`;
    const name = clip((n.name ?? '').trim(), 80), desc = (n.desc ?? '').trim();
    if (!n.ref || charRefs.has(n.ref)) { errs.push(`${where}: ref ausente, repetido ou igual a um id existente`); continue; }
    if (!name) errs.push(`${where}: falta o nome`);
    if (name && [...names.values()].some(x => norm(x) === norm(name))) errs.push(`${where}: já existe um personagem "${name}"; use o que está no elenco`);
    if (desc.length < 40) errs.push(`${where}: desc precisa ser o design visual completo (cabelo, rosto, roupa, cores, acessórios)`);
    const poses = n.poses ?? [];
    if (!poses.length || poses.length > MAX_POSES) errs.push(`${where}: de 1 a ${MAX_POSES} poses`);
    const id = newId('c'), pm = new Set<string>();
    const list = poses.map((p, i) => {
      const pid = newId('sp');
      if (p.ref) { if (pm.has(p.ref)) errs.push(`${where}: pose ref "${p.ref}" repetido`); pm.add(p.ref); }
      if (!(p.desc ?? '').trim()) errs.push(`${where}: a pose "${p.name || i + 1}" precisa de desc`);
      return { id: pid, name: clip((p.name ?? '').trim() || 'Pose', 80), desc: clip((p.desc ?? '').trim(), 1000) };
    });
    charRefs.add(n.ref);
    names.set(id, name); // só para não repetir o nome dentro da proposta
    newChars.push({ id, name, desc: clip(desc, 2000), color: '', poses: list });
  }
  // Personagem novo é sempre uma proposta à parte: as cenas só o usam depois de aceito.
  if (newChars.length && [a.criar, a.alterar, a.remover, a.ligar, a.remover_acoes, a.novos_backgrounds].some(x => x?.length))
    errs.push('personagens vai numa chamada própria, sem mudanças de cena: chame propor_mudancas uma vez só com personagens (criar, alterar, remover, ligar, remover_acoes e novos_backgrounds vazios) e outra com as cenas, que não podem usar o personagem novo até ele ser aceito');
  const bgs = new Set(ctx.backgrounds.map(b => b.id));
  const bgRefs = new Map<string, string>();
  const newBgs: NewBackground[] = [];
  const orig = {
    scenes: new Map(story.scenes.map(({ id, ...s }) => [id, s])),
    choices: new Map(story.choices.map(({ id, ...c }) => [id, c])),
  };
  const scenes = new Map([...orig.scenes].map(([k, v]) => [k, { ...v }]));
  const choices = new Map([...orig.choices].map(([k, v]) => [k, { ...v }]));
  const refs = new Map<string, string>();
  const created: string[] = [];
  const resolve = (k: string) => refs.get(k) ?? (scenes.has(k) ? k : '');
  const castJson = (cast: SceneArgs['cast'], where: string) => {
    const seen = new Set<string>();
    const ok = (cast ?? []).filter(m => {
      if (!sprites.has(m.character)) { errs.push(`${where}: personagem "${m.character}" não existe`); return false; }
      if (!sprites.get(m.character)!.includes(m.sprite)) { errs.push(`${where}: sprite "${m.sprite}" não é do personagem "${m.character}"`); return false; }
      if (seen.has(m.character)) { errs.push(`${where}: personagem "${m.character}" repetido no elenco`); return false; }
      seen.add(m.character);
      return true;
    });
    if (ok.length > 6) errs.push(`${where}: mais de 6 personagens no elenco`);
    return JSON.stringify(ok.map(m => ({ c: m.character, s: m.sprite })));
  };
  const checkBg = (raw: string, where: string) => {
    const bg = bgRefs.get(raw) ?? raw;
    if (bg && !bgs.has(bg)) errs.push(`${where}: background "${raw}" não existe (use um id da lista, um ref de novos_backgrounds, ou "")`);
    return bgs.has(bg) ? bg : '';
  };
  for (const b of a.novos_backgrounds ?? []) {
    const where = `novos_backgrounds "${b.ref || b.nome}"`;
    const prompt = String(b.prompt ?? '').trim(), name = String(b.nome ?? '').trim();
    if (!b.ref) { errs.push(`${where}: falta o ref`); continue; }
    if (bgRefs.has(b.ref) || bgs.has(b.ref)) { errs.push(`${where}: ref "${b.ref}" repetido ou igual a um id existente`); continue; }
    if (!name) errs.push(`${where}: falta o nome`);
    if (prompt.split(/\s+/).length < 20) errs.push(`${where}: o prompt precisa descrever o lugar em inglês (60 a 120 palavras)`);
    const id = newId('b');
    bgRefs.set(b.ref, id);
    bgs.add(id);
    const time = ['day', 'sunset', 'night', 'interior', 'water'].includes(String(b.time)) ? String(b.time) : '';
    newBgs.push({ id, name: clip(name || 'Background', 80), desc: clip(String(b.descricao ?? '').trim(), 400), prompt: clip(prompt, 1200), time, mood: clip(String(b.mood ?? '').trim(), 120) });
  }
  // Fala de alguém fora do elenco: entra no elenco com o primeiro sprite, se couber.
  const fixVoice = (s: WScene, where: string) => {
    if (s.kind !== 'dialogue') { s.kind = 'narration'; s.speaker = ''; return; }
    if (!sprites.has(s.speaker)) { errs.push(`${where}: kind "dialogue" precisa de speaker com o id de um personagem (veio "${s.speaker}")`); return; }
    const cast = parseCast(s.chars);
    if (cast.some(m => m.c === s.speaker)) return;
    const first = sprites.get(s.speaker)![0];
    if (first && cast.length < 6) s.chars = JSON.stringify([...cast, { c: s.speaker, s: first }]);
    else errs.push(`${where}: quem fala ("${s.speaker}") precisa estar no elenco`);
  };
  const checkSpeech = (s: WScene, where: string) => {
    if (s.kind !== 'dialogue') return;
    s.text = cleanSpeech(s.text);
    const name = names.get(s.speaker) ?? '';
    const why = speechProblem(s.text, name);
    if (why) errs.push(`${where}: é uma fala de ${name || s.speaker} (kind "dialogue"), mas ${why}. Em fala, text é só o que ${name || 'o personagem'} diz; ponha gestos e ambiente numa cena de narração separada (antes ou depois), ou mude kind para "narration"`);
  };
  const right = Math.max(0, ...story.scenes.map(s => s.x)); // o cliente reposiciona as cenas novas

  for (const n of a.criar ?? []) {
    const where = `criar "${n.ref || n.title}"`;
    if (!n.ref) errs.push(`${where}: falta o ref`);
    else if (refs.has(n.ref) || scenes.has(n.ref)) errs.push(`${where}: ref "${n.ref}" repetido ou igual a um id existente`);
    const id = newId('s');
    if (n.ref && !refs.has(n.ref)) refs.set(n.ref, id);
    created.push(id);
    const s: WScene = {
      title: clip(n.title || 'Nova cena', 80), x: Math.round(right + 380 * created.length), y: 0,
      bg: checkBg(n.bg ?? '', where), chars: castJson(n.cast, where), kind: n.kind ?? 'narration',
      speaker: n.speaker ?? '', text: n.text ?? '', next: '',
    };
    fixVoice(s, where);
    checkSpeech(s, where);
    scenes.set(id, s);
  }
  for (const u of a.alterar ?? []) {
    const where = `alterar "${u.id}"`;
    const s = orig.scenes.has(u.id) ? scenes.get(u.id) : undefined;
    if (!s) { errs.push(`${where}: cena não existe (alterar só aceita ids de cenas existentes)`); continue; }
    if (u.title) s.title = clip(u.title, 80);
    if (u.bg !== undefined) s.bg = checkBg(u.bg, where);
    if (u.cast) s.chars = castJson(u.cast, where);
    if (u.kind === 'narration' || u.kind === 'dialogue') s.kind = u.kind;
    if (u.speaker) s.speaker = u.speaker;
    if (typeof u.text === 'string') s.text = u.text;
    fixVoice(s, where);
    checkSpeech(s, where);
  }
  for (const id of a.remover_acoes ?? []) {
    if (!choices.delete(id)) errs.push(`remover_acoes: ação "${id}" não existe`);
  }
  for (const l of a.ligar ?? []) {
    const where = `ligar ${l.from} → ${l.to || '""'}`;
    const from = resolve(l.from), to = l.to ? resolve(l.to) : '';
    const src = from ? scenes.get(from) : undefined;
    if (!src) { errs.push(`${where}: cena de origem "${l.from}" não existe`); continue; }
    if (l.to && !to) { errs.push(`${where}: cena de destino "${l.to}" não existe`); continue; }
    const own = [...choices.entries()].filter(([, c]) => c.sceneId === from);
    if (l.choice === 'next') {
      if (own.length === 1 && !l.label) own[0][1].target = to; // "próxima" de uma cena com uma ação só
      else if (!own.length) src.next = to;
      else errs.push(`${where}: a cena tem ações, então não tem saída única; use o id de uma das ações (${own.map(([cid]) => cid).join(', ')}) ou "" para criar outra`);
      continue;
    }
    if (l.choice) {
      const c = choices.get(l.choice);
      if (!c || c.sceneId !== from) { errs.push(`${where}: ação "${l.choice}" não existe em "${l.from}"`); continue; }
      c.target = to;
      if (l.label) c.label = clip(l.label, 60);
      continue;
    }
    // Ação nova, como no editor: a saída única da cena vira a primeira ação.
    let pos = Math.max(-1, ...own.map(([, c]) => c.position)) + 1;
    if (!own.length && src.next) {
      choices.set(newId('ch'), { sceneId: from, label: 'Continuar', target: src.next, position: pos++ });
      src.next = '';
    }
    choices.set(newId('ch'), { sceneId: from, label: clip(l.label || 'Continuar', 60), target: to, position: pos });
  }
  const removed = new Set<string>();
  for (const k of a.remover ?? []) {
    const id = resolve(k);
    if (!id) { errs.push(`remover: cena "${k}" não existe`); continue; }
    if (id === story.startScene) { errs.push(`remover: "${k}" é a cena [INÍCIO] e não pode ser removida`); continue; }
    scenes.delete(id);
    removed.add(id);
    for (const [cid, c] of choices) if (c.sceneId === id) choices.delete(cid); else if (c.target === id) c.target = '';
    for (const s of scenes.values()) if (s.next === id) s.next = '';
  }
  if (errs.length) return errs.join('; ');

  const problem = graphProblem(story.startScene, scenes, choices);
  if (problem) return problem;

  // Só a diferença, na ordem do cliente: cenas, ações, ações apagadas, cenas apagadas.
  const ops: Op[] = [];
  const isNew = new Set(created.filter(id => scenes.has(id)));
  for (const [id, s] of scenes) {
    const o = orig.scenes.get(id);
    if (isNew.has(id)) { ops.push({ op: 'upsert_scene', scene: { id, ...s, ai: '' } }); continue; }
    const ch: Record<string, unknown> = {};
    // delete_scene já zera os destinos que apontavam para a cena removida.
    for (const k of SCENE_KEYS) if (o && s[k] !== o[k] && !(k === 'next' && !s.next && removed.has(o.next))) ch[k] = s[k];
    if (Object.keys(ch).length) ops.push({ op: 'upsert_scene', scene: { id, ...ch } });
  }
  for (const [id, c] of choices) {
    const o = orig.choices.get(id);
    if (!o) { ops.push({ op: 'upsert_choice', choice: { id, ...c } }); continue; }
    const ch: Record<string, unknown> = {};
    for (const k of CHOICE_KEYS) if (c[k] !== o[k] && !(k === 'target' && !c.target && removed.has(o.target))) ch[k] = c[k];
    if (Object.keys(ch).length) ops.push({ op: 'upsert_choice', choice: { id, ...ch } });
  }
  for (const [id, c] of orig.choices) if (!choices.has(id) && !removed.has(c.sceneId)) ops.push({ op: 'delete_choice', id });
  for (const id of removed) if (orig.scenes.has(id)) ops.push({ op: 'delete_scene', id });
  if (!ops.length && !newChars.length) return 'a proposta não mudava nada';
  const used = new Set([...scenes.values()].map(s => s.bg));
  const unused = newBgs.filter(b => !used.has(b.id));
  if (unused.length) return unused.map(b => `novos_backgrounds "${b.name}": nenhuma cena usa este background; ponha o ref dele no bg de alguma cena ou tire-o`).join('; ');

  const title = (id: string) => `“${orig.scenes.get(id)?.title ?? scenes.get(id)?.title ?? ''}”`;
  const summary = a.summary?.length ? a.summary : [
    ...newChars.map(c => `Criar personagem ${c.name} (${c.poses.length} pose${c.poses.length > 1 ? 's' : ''})`),
    ...[...isNew].map(id => `Criar cena ${title(id)}`),
    ...(a.alterar ?? []).filter(u => orig.scenes.has(u.id) && !removed.has(u.id)).map(u => `Alterar ${title(u.id)}`),
    ...[...removed].filter(id => orig.scenes.has(id)).map(id => `Remover ${title(id)}`),
  ];
  if (!summary.length) summary.push('Religar ações');
  summary.unshift(...newBgs.map(b => `Gerar background “${b.name}”`));
  const next = newChars.length ? clip((a.continuar ?? '').trim(), 600) : '';
  return { summary, ops, created: [...isNew], ...(newChars.length ? { characters: newChars } : {}), ...(next ? { continuar: next } : {}), ...(newBgs.length ? { backgrounds: newBgs } : {}) };
}
