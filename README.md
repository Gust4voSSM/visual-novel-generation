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

Abra http://localhost:5173. Sem login configurado, rode com `VITE_AUTH_DEV_ANON=1` e publique
o módulo com `AUTH_DEV_ANON=1` (veja abaixo): cada aba vira uma pessoa anônima.

## Contas e histórias

Cada pessoa entra com Google e vê só as próprias histórias e as compartilhadas com ela
(`/home`); uma história abre em `/s/<id>`. O dono compartilha por e-mail como editor ou leitor;
quem ainda não entrou recebe o acesso no primeiro login.

- **Módulo:** o ID token do Google é o token da conexão. O módulo confere `iss` e `aud`
  (`GOOGLE_CLIENT_ID`), guarda a conta em `account` e checa o papel (`story_member`) em todo
  reducer. As tabelas do grafo são privadas; o cliente lê pelas views `cur_*` (a história aberta
  com `open_story`) e `my_*`.
- **Login (Pages Functions, `client/functions/api/auth`):** fluxo authorization code + PKCE.
  O refresh token fica num cookie HttpOnly cifrado com `SESSION_KEY`; o navegador só recebe ID
  tokens de 1 h por `POST /api/auth/token` e os guarda na memória.
- **Google Cloud:** cliente OAuth "Web application", com o redirect URI
  `<origem>/api/auth/callback` de cada ambiente (local: `http://localhost:5173/api/auth/callback`).
  Prévias do Pages com hash aleatório não conseguem entrar (o Google não aceita curinga).

### Local com login

`client/.env.local` (não versionar). O wrangler lê esse arquivo para as Functions; o Vite também,
mas só põe no bundle o que começa com `VITE_`, então o segredo não vai para o navegador:

```
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
SESSION_KEY=<32 bytes em base64: head -c 32 /dev/urandom | base64>
APP_ORIGIN=http://localhost:5173
```

```bash
GOOGLE_CLIENT_ID=... spacetime publish -s local -p server -y roteiro-google
```

```bash
npm --prefix client run build && npm --prefix client run dev:api
```

```bash
VITE_STDB_DB=roteiro-google npm --prefix client run dev
```

O Vite repassa `/api` para as Functions (porta 8788). A IA precisa de um worker ligado ao mesmo
banco (cada banco local tem o seu):

```bash
STDB_DB=roteiro-google npm --prefix worker start
```

### Local sem login

```bash
AUTH_DEV_ANON=1 spacetime publish -s local -p server -y roteiro-auth
```

```bash
VITE_AUTH_DEV_ANON=1 VITE_STDB_DB=roteiro-auth npm --prefix client run dev
```

`AUTH_DEV_ANON` nunca vai para produção: com ele, qualquer conexão anônima vira conta.

### Testes

```bash
STDB_DB=roteiro-auth PROD_DB=roteiro-google npm --prefix worker run test:stories
```

`PROD_DB` (opcional) é um banco sem `AUTH_DEV_ANON`, para conferir que anônimos são recusados.
Os testes de IA (`npm test`) também precisam de um banco com `AUTH_DEV_ANON=1`.

### Produção

- GitHub (Variables): `GOOGLE_CLIENT_ID`, além das já existentes.
- Cloudflare Pages (Settings → Variables and Secrets): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
  (secreto) e `SESSION_KEY` (secreto). Trocar a `SESSION_KEY` desloga todo mundo.
- O CI publica com `--delete-data=on-conflict`: uma mudança de esquema que não dá para migrar
  apaga os dados do banco de produção (a de histórias por pessoa é uma delas). Mudanças
  compatíveis mantêm os dados.

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
`OPENAI_CHAT_MODEL` (padrão `gpt-6-luna`), `OPENAI_REASONING_EFFORT` (padrão `low` nos gpt-5/gpt-6),
`OPENAI_IMAGE_MODEL` (padrão `gpt-image-2.6-flare`) e `OPENAI_IMAGE_QUALITY` (padrão `medium`). As imagens geradas
vão para o KV pelas Pages Functions quando o worker tem `IMAGE_API_URL` (veja "Elenco e imagens");
sem ela, para `client/public/generated/` (ou `IMAGE_DIR`). Os modelos de imagem
exigem organização verificada na OpenAI. Sprites (charsheet, cor-chave, caminho nativo) e backgrounds:
veja [worker/IMAGENS-EXPERIMENTO.md](worker/IMAGENS-EXPERIMENTO.md).

```bash
cd worker && set -a && . ./.env && set +a && cd .. && spacetime publish -s local -p server -y roteiro-spike-ai
```

```bash
npm --prefix worker install && npm --prefix worker start
```

```bash
npm --prefix client run dev -- --port 5174 --mode ai-local
```

Testes (com o worker rodando): `npm --prefix worker test` (correção, 23 casos) e
`npm --prefix worker run load` (5 pessoas editando, sem e com IA ao mesmo tempo). Os dois
recriam a história de teste; "↺ demo" no editor volta ao exemplo.

## Elenco e imagens

Personagens, sprites, backgrounds e charsheets ficam em tabelas do módulo (`character`, `sprite`,
`background`, `charsheet`), por história, lidas pelas views `cur_*`. As imagens são só links
(`image_key`), nunca bytes:

| `image_key` | Onde está |
| --- | --- |
| `img/<32 hex>.<png\|jpg\|webp>` | KV do Pages (uploads e imagens geradas), servido por `/img/…` |
| `example/…svg` | Elenco do exemplo e do marketplace, em `client/public/example/` (`npm --prefix client run example-art`) |
| `placeholders/…svg` | Imagens do modo mock |
| `generated/…` | Disco local do worker (experimentos de antes do KV) |

O módulo recusa qualquer outro valor (URLs de fora, `data:`).

- Editar nome, descrição, cor e imagens vai por `apply_operations` (operações `upsert_/delete_`
  `character`, `sprite` e `background`), com desfazer como as cenas. Apagar algo que uma cena
  usa dá `USED`.
- Gerar não prende a tela:
  - `generate_character` cria o personagem e as poses já como "gerando" e põe o charsheet na fila.
  - Quando o charsheet fica pronto, o módulo põe cada pose num pedido próprio; uma falha marca só aquela pose.
  - `add_pose` pede uma pose nova; `generate_background` pede um background; `retry_generation` tenta de novo.
  - O andamento fica nas linhas: recarregar a página não perde nada.
- Histórias de antes das tabelas: quem edita, ao abri-las, grava o elenco de exemplo com ids
  próprios da história e as cenas passam a apontar para ele. Personagens gerados ou enviados
  naquela época ficavam só no navegador e não voltam.

**Envio de imagens.** `POST /api/upload` (Pages Function) aceita PNG, JPEG ou WebP até 8 MB e devolve `{key}`.
- Pessoas: precisam da sessão de login (o cookie) e da mesma origem.
- Worker: manda `Authorization: Bearer <WORKER_SECRET>`.
- Os bytes vão para o KV ligado como `IMAGES`. `GET /img/<chave>` lê de lá, com cache imutável na borda.

**Produção (uma vez):**
1. Criar o namespace KV: Cloudflare → Storage & Databases → KV → Create, ex. `roteiro-images`.
2. No projeto do Pages: Settings → Bindings → Add → KV namespace, nome da variável `IMAGES`, o namespace acima (Production e Preview).
3. No projeto do Pages: Settings → Variables and Secrets → `WORKER_SECRET` (secreto), o mesmo da VM.
4. Na VM, em `/etc/roteiro/worker.env`: `IMAGE_API_URL=https://<projeto>.pages.dev`, e reiniciar o worker.

Plano gratuito do KV: 1 GB, 1.000 gravações e 100.000 leituras por dia. Um personagem gerado
grava 2 + o número de poses.

**Local:** `npm --prefix client run dev:api` (com login) ou `dev:api:anon` (aceita envios sem
login, para os modos com `VITE_AUTH_DEV_ANON=1`) sobe as Pages Functions na porta 8788 com um KV
local. O Vite repassa `/api` e `/img` para elas. O worker precisa de `IMAGE_API_URL` e do mesmo
`WORKER_SECRET` que as Functions:

```bash
cd client && set -a && . ../worker/.env && set +a && npm run build && npx wrangler pages dev dist --port 8788 --compatibility-date=2026-10-01 --kv IMAGES --binding UPLOAD_DEV_ANON=1 --binding WORKER_SECRET=$WORKER_SECRET
```

```bash
cd worker && IMAGE_API_URL=http://localhost:8788 npm start
```

## Worker em produção (VM)

O worker de `vn-generation` (Maincloud) roda numa VM e2-micro do Google Cloud (projeto
`regal-oasis-512900-b3`, zona `us-east1-b`, `roteiro-worker`). Os arquivos ficam em `worker/deploy/`:

- `setup.sh` prepara uma VM Debian 12 nova (Node 22, usuário `roteiro`, código em `/opt/roteiro/app`).
- `roteiro-worker.service` roda o worker com `/etc/roteiro/worker.env` (`STDB_URI`, `STDB_DB`,
  `WORKER_SECRET`, `AI_PROVIDER`, `IMAGE_API_URL`; só root lê). Antes de cada início, `openai-key.sh` (como root) busca a
  chave da OpenAI no Secret Manager para `/run/roteiro/openai.env` (memória).
- `roteiro-update.timer` roda `update.sh` a cada 5 min: segue a branch `deployed/worker`, que o
  workflow `deploy` move depois de publicar o módulo, e reinicia o worker se a chave da OpenAI mudou.
  A VM lê o repositório (privado) por uma chave de deploy só leitura em `/etc/roteiro/deploy_key`.

A VM usa a service account `roteiro-worker@regal-oasis-512900-b3.iam.gserviceaccount.com`, que só
pode ler o segredo `openai-api-key` e escrever logs/métricas. `gcp-setup.sh` cria essa conta, o
segredo e as permissões (rodar uma vez, do PC; para a VM por ~1 min ao trocar a conta).

### Onde fica cada segredo

| Segredo | Onde | Para quê |
|---|---|---|
| Chave da OpenAI | Secret Manager `openai-api-key` (produção); `worker/.env.openai` (local) | o worker chamar a OpenAI. **Não** vai para o GitHub. |
| `WORKER_SECRET` | GitHub (Actions), `/etc/roteiro/worker.env` na VM **e** segredo do projeto no Pages, iguais | senha entre o módulo e o worker (`register_worker`) e do worker para enviar imagens (`/api/upload`). **Não** é a chave da OpenAI. |
| `SPACETIMEDB_TOKEN`, `CLOUDFLARE_*` | GitHub (Actions) | publicar o módulo e o site. |
| Chave de deploy | `/etc/roteiro/deploy_key` na VM (só root) + "Deploy keys" do repositório | a VM ler o repositório. |

**Trocar a chave da OpenAI** (sem SSH; o worker pega a nova em até 5 min). Cole a chave e tecle
Enter, depois Ctrl+Z e Enter no Windows (Ctrl+D no Linux/macOS):

```bash
gcloud secrets versions add openai-api-key --data-file=- --project=regal-oasis-512900-b3
```

Para aplicar na hora: `gcloud compute ssh roteiro-worker --project=regal-oasis-512900-b3 --zone=us-east1-b --tunnel-through-iap --command "sudo systemctl restart roteiro-worker"`.
Chave recusada aparece no log como `chave da OpenAI recusada (HTTP 401)` e, no chat, como `AI_KEY_INVALID`.

O `WORKER_SECRET` do GitHub (usado ao publicar o módulo) tem que ser o mesmo da VM:

```bash
gcloud compute ssh roteiro-worker --project=regal-oasis-512900-b3 --zone=us-east1-b --tunnel-through-iap --command "sudo sed -n 's/^WORKER_SECRET=//p' /etc/roteiro/worker.env" | gh secret set WORKER_SECRET --repo Gust4voSSM/spacetime-spike
```

Logs: `gcloud compute ssh roteiro-worker --project=regal-oasis-512900-b3 --zone=us-east1-b --tunnel-through-iap --command "sudo journalctl -u roteiro-worker -f"`.
(Sem `--tunnel-through-iap` o SSH não passa.)

## Fora deste spike

- Login com Google (precisa de um OAuth client ID) — conexões são anônimas, uma identidade por aba.
- O marketplace é de mentira: os itens ficam no código do cliente (incluir copia para as tabelas da história).
- A interface é otimista (mostra a mudança na hora e desfaz se o servidor recusar); a
  especificação prevê esperar o servidor, salvo se a latência passar de 300 ms.
