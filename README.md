# Spike: Roteiro VN + SpacetimeDB

O demo do editor (o mesmo da especificação) ligado a um módulo SpacetimeDB, para testar
edição simultânea antes de decidir entre SpacetimeDB e Supabase.

- `server/` — módulo TypeScript: tabelas `story`, `scene`, `choice`, `profile`, `presence`,
  `drags` (tabela de eventos), `locks`; reducer `apply_operations` com validação no servidor
  (ciclo, 6 personagens, falante na cena, ações x saída única, cena inicial, trava suave).
- `client/` — o demo em Vite. Edições viram lotes de operações; mudanças dos outros chegam
  pela assinatura. O chip no topo mostra ping e ida e volta das ações (p50/p95).
- `original-demo.html` — o demo original, para comparação.

## Rodar local

```bash
spacetime start
```

```bash
spacetime publish -s local -p server -y roteiro-spike
```

```bash
npm --prefix client run dev
```

Abra http://localhost:5173 em duas abas (cada aba é uma pessoa). "↺ demo" recria a história.

Depois de mudar o módulo, regenere os bindings:

```bash
spacetime generate --lang typescript -p server -o client/src/module_bindings -y
```

## Testar no Maincloud (latência do Brasil)

```bash
spacetime login
```

```bash
spacetime publish -s maincloud -p server -y roteiro-spike-SEUNOME
```

Crie `client/.env.local` com:

```
VITE_STDB_URI=wss://maincloud.spacetimedb.com
VITE_STDB_DB=roteiro-spike-SEUNOME
```

e rode o cliente de novo. O chip passa a dizer "Maincloud"; clique nele para ver p50/p95/máx
das ações. A meta da especificação é p95 ≤ 300 ms.

## IA simulada (até a chave chegar)

Todo o caminho de IA da seção 2.6 está montado; só o provedor é falso. Trocar pelo real é
mexer em `worker/src/providers.ts` e `worker/src/storage.ts` (worker) e nos `if (provider !== 'mock')`
das procedures em `server/src/index.ts`.

| Recurso | Caminho | Mock |
|---|---|---|
| Cena sugerida (Shift ao arrastar um fio) | `request_ai` (`scene`) → worker → `ai_job.result` | cena montada a partir do contexto (elenco, backgrounds) |
| Ação sugerida (Shift em "+ ação") | `request_ai` (`option`) → worker → `ai_job.result` | rótulo de uma lista fixa; só a ação, sem cena |
| Completar texto | `request_ai` (`complete`) → worker → `ai_job.result` | frase acrescentada; "tenso" na instrução muda o tom |
| Chat | `request_ai` → worker → `chat_chunk` (streaming) → `chat_message` | resposta palavra a palavra + proposta aplicável |
| Gerar personagem / background | `request_ai` → worker → `ai_job.result` | placeholders estáticos em `client/public/placeholders/` |

- `#falha` na instrução, mensagem ou descrição força uma falha do provedor (para testar o caminho de erro).
- A latência do provedor nas procedures é uma ida real pela rede (`AI_MOCK_LATENCY_URL`). O
  SpacetimeDB recusa endereços privados, então use um endpoint público (ex.: postman-echo).
- `ctx.sleep` não existe neste runtime, e `ctx.http.fetch` **aceita** `timeout` (a especificação diz o contrário).
- Procedures devolvem `{"ok": true, ...}` ou `{"error": "CÓDIGO"}` em vez de lançar erro.

### Rodar local com IA

O banco `roteiro-spike` local pertence a outra identidade; o spike de IA usa `roteiro-spike-ai`.
`worker/.env` guarda `WORKER_SECRET`, `AI_PROVIDER=mock` e `AI_MOCK_LATENCY_URL` (não versionar).
`worker/.env.openai` guarda só `OPENAI_API_KEY`; fica num arquivo à parte para que o `. ./.env` da
publicação não a exporte. Apenas os scripts do worker o carregam (não versionar).

Para usar a OpenAI, troque para `AI_PROVIDER=openai` em `worker/.env`, publique de novo e reinicie o worker.
Chat, cena sugerida, ação sugerida, completar texto, personagem e background passam a usar a OpenAI.
O editor pede tudo ao worker; as procedures `suggest_scene` e `complete_text` continuam só com o mock. Opcionais em `worker/.env.openai`:
`OPENAI_CHAT_MODEL` (padrão `gpt-5-mini`), `OPENAI_REASONING_EFFORT` (padrão `minimal` nos gpt-5),
`OPENAI_IMAGE_MODEL` (padrão `gpt-image-1`) e `OPENAI_IMAGE_QUALITY` (padrão `low`). As imagens geradas
vão para `client/public/generated/` (ou `IMAGE_DIR`); o upload ao R2 fica para o deploy. O `gpt-image-1`
exige organização verificada na OpenAI.

```bash
cd worker && set -a && . ./.env && set +a && cd .. && spacetime publish -s local -p server -y roteiro-spike-ai
```

```bash
npm --prefix worker install && npm --prefix worker start
```

```bash
npm --prefix client run dev -- --port 5174 --mode ai-local
```

Testes (com o worker rodando): `npm --prefix worker test` (correção, 19 casos) e
`npm --prefix worker run load` (5 pessoas editando, sem e com IA ao mesmo tempo). Os dois
recriam a história de teste; "↺ demo" no editor volta ao exemplo.

## Worker em produção (VM)

O worker de `vn-generation` (Maincloud) roda numa VM e2-micro do Google Cloud (projeto
`regal-oasis-512900-b3`, zona `us-east1-b`, `roteiro-worker`). Os arquivos ficam em `worker/deploy/`:

- `setup.sh` prepara uma VM Debian 12 nova (Node 22, usuário `roteiro`, código em `/opt/roteiro/app`).
- `roteiro-worker.service` roda o worker; os segredos ficam em `/etc/roteiro/worker.env`
  (`STDB_URI`, `STDB_DB`, `WORKER_SECRET`, `AI_PROVIDER`) e `/etc/roteiro/openai.env`, só root lê.
- `roteiro-update.timer` roda `update.sh` a cada 5 min: implanta o último commit da main cujo
  workflow `deploy` passou (módulo já publicado). Nenhuma credencial do Google fica no GitHub.

O `WORKER_SECRET` do GitHub (usado ao publicar o módulo) tem que ser o mesmo da VM:

```bash
gcloud compute ssh roteiro-worker --project=regal-oasis-512900-b3 --zone=us-east1-b --command "sudo sed -n 's/^WORKER_SECRET=//p' /etc/roteiro/worker.env" | gh secret set WORKER_SECRET --repo Gust4voSSM/spacetime-spike
```

Logs: `gcloud compute ssh roteiro-worker --project=regal-oasis-512900-b3 --zone=us-east1-b --command "sudo journalctl -u roteiro-worker -f"`.

## Fora deste spike

- Login com Google (precisa de um OAuth client ID) — conexões são anônimas, uma identidade por aba.
- Personagens e backgrounds ficam só no navegador (ids fixos no exemplo); só o grafo sincroniza.
- Provedores reais de IA e upload ao R2 (o caminho inteiro já roda com o mock acima).
- A interface é otimista (mostra a mudança na hora e desfaz se o servidor recusar); a
  especificação prevê esperar o servidor, salvo se a latência passar de 300 ms.
