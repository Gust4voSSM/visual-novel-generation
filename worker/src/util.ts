// Funções pequenas usadas pelos provedores, prompts e propostas.
export const norm = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
export const newId = (p: string) => p + crypto.randomUUID().replace(/-/g, '').slice(0, 12);

export const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s);
