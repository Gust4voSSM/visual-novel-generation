# Sprites e backgrounds: pipeline e testes T0–T4

Implementação de [PLANO-SPRITES-BACKGROUNDS.md](../../PLANO-SPRITES-BACKGROUNDS.md), seções 2 a 5. Tudo roda no worker (Node + `sharp`), contra a API da OpenAI. Nada de Modal ou Qwen.

## O que está onde

| Arquivo | Conteúdo |
| --- | --- |
| `src/imaging/keyer.ts` | Porte do `key_magenta.py` e do keyer por distância do `macaw-green-key-study/analyze.py`. Amostra os cantos (32×32, rejeita acima de 20), calcula o alfa pelo eixo de excesso de cada cor-chave e recupera a cor nas bordas. Sem despill. |
| `src/imaging/postprocess.ts` | Limpeza do alfa nativo, garbage matte (com log do que saiu), anel de contorno, verificações (cantos, área, buracos, contorno), alinhamento das poses e escolha da cor-chave pelo front. |
| `src/imaging/pipeline.ts` | Prompts, charsheet (front → side → poses), política de tentativas e troca de caminho, backgrounds (base, variantes, recorte 16:9). |
| `src/imaging/experiment.ts` | Modo experimento: grava cada pedido em uma pasta. |
| `src/providers.ts` | `ImageRequest` (`reference`, `pose`, `background-variant`) e `OpenAiImageApi` (`/images/generations` e `/images/edits` multipart). |
| `src/index.ts` | Pedidos do editor: `charsheet` (front + side), `pose` (uma pose a partir do charsheet) e `background` (base e variantes). O pedido `character`, com charsheet e todas as poses de uma vez, continua para os testes T1–T3. |
| `src/storage.ts` | Onde ficam as imagens: KV pelas Pages Functions com `IMAGE_API_URL`, ou disco. Os charsheets do pedido `character` ficam em JSON (`AI_SHEET_DIR`, padrão `./charsheets`); os do editor, na tabela `charsheet`. |

## Fluxo de um personagem

Pelo editor, cada etapa é um pedido próprio e o resultado vai para as tabelas do elenco (veja "Elenco e imagens" no README):
- `charsheet` faz os passos 1 a 3;
- o módulo grava o charsheet e põe cada pose pendente num pedido `pose` (passo 4, uma pose por pedido).

O pedido `character` faz tudo de uma vez.

1. **Front**: `generations`, só texto, fundo sólido `AI_CHARSHEET_BACKGROUND` (padrão `black`). Daqui saem a altura do personagem (a unidade das poses) e a cor-chave. A cor é a candidata (magenta, verde, azul, ciano) com menos pixels do personagem acima de excesso 32. Se todas passam de `AI_KEY_COLLISION_LIMIT` (padrão 2%), o personagem fica só no caminho nativo.
2. **Side**: `edits` com o front, mesmo fundo. O charsheet nunca passa pelo keyer.
3. O charsheet (`{id, front, side, keyColor, keyScores, unit}`) é gravado. O resultado do pedido traz `sheet`, e um pedido novo com `sheet_id` reaproveita o charsheet.
4. **Poses**: `edits` com front + side, três de cada vez.
   - Caminho principal (`AI_SPRITE_PATH`, padrão `keyed`): até 2 tentativas.
   - Se as duas falharem, o outro caminho, também com até 2.
   - Se nenhuma passar, fica a tentativa com menos falhas, com `accepted: false` no meta e no resultado.
   - Depois, alinhamento na tela do front: mesma linha dos pés e escala para a altura do front.

O meta de cada pose traz `path`, `accepted`, `fellBack`, as novas tentativas por caminho, o alinhamento, o tempo e o custo.

## Variáveis

| Variável | Padrão | Uso |
| --- | --- | --- |
| `AI_IMAGE_PROVIDER=openai` | (mock) | Liga as imagens reais. Sem ela, imagens continuam no mock. |
| `OPENAI_IMAGE_MODEL` | `gpt-image-2.6-flare` | |
| `OPENAI_IMAGE_QUALITY` | `low` | Tier `low`, `medium` ou `high` (questão em aberto, medir no T1). |
| `AI_SPRITE_PATH` | `keyed` | `native` depois da decisão de T1–T2. |
| `OPENAI_IMAGE_MODEL_NATIVE` | (o de `OPENAI_IMAGE_MODEL`) | Modelo só do caminho nativo. Em 2026-11-14 o `gpt-image-2` recusou `background: "transparent"` com HTTP 400 ("Transparent background is not supported for this model"). Relatos apontam a família `gpt-image-2.5` e o `gpt-image-1.5` para transparência. Um 400 no nativo conta como tentativa falha, sem repetir, e a pose sai pelo keyed. |
| `AI_IMAGE_COMPARE_PATHS=1` | off | Toda pose nos dois caminhos. Também vale por pedido: `compare: true` no input do `character`. |
| `AI_IMAGE_EXPERIMENT=1` | off | Grava cada pedido em `AI_IMAGE_EXPERIMENT_DIR` (padrão `./experiments`). |
| `AI_CHARSHEET_BACKGROUND` | `black` | Fundo dos dois charsheets. |
| `AI_KEY_COLLISION_LIMIT` | `0.02` | Limite de colisão da cor-chave. |
| `AI_ART_STYLE` | estilo anime cel | Compartilhado por sprites e backgrounds. |
| `OPENAI_IMAGE_PRICE_TEXT_IN` / `_IMAGE_IN` / `_IMAGE_OUT` | — | US$ por 1M de tokens. Sem os três, o custo fica `null` e só o `usage` é gravado. |
| `WORKER_CHARACTER_TIMEOUT_MS` / `WORKER_BACKGROUND_TIMEOUT_MS` | 30 min / 10 min com imagens reais | |

Cada pasta do modo experimento traz o bruto (`*-raw.png`), o processado (`*-processed.png`), o `final.png` alinhado e um `meta.json`. O `meta.json` registra prompt, referências, modelo, tamanho, qualidade, caminho, cor-chave e pontuação, cantos amostrados, garbage matte removido, verificações (cantos, área, buracos, camadas do contorno), tentativas, fallback, tempo e `usage`/custo.

## T0: fidelidade do keyer (sem custo)

```bash
cd spacetime-spike/worker && npm run t0
```

Roda `test/t0_ref.py` com `python -I`, depois `test/t0-keyer.ts`. As saídas vão para `worker/experiments/t0/`, e o evidence em `output/` é só lido. São 15 casos no total:

- magenta: recuperado, alfa cru e distância;
- 4 poses verdes: `key()` do gpt-green, distância do macaw-green e o keyer de produção no verde.

O teste também confere se o `sharp` e o PIL decodificam os mesmos pixels.

`npm run test:images` testa o pipeline inteiro com uma API falsa que devolve as imagens do experimento. Inclui um "nativo" sintético com alfa 253 e contorno cinza, para exercitar a nova tentativa, a troca de caminho e a comparação.

## T1–T3: geração real (custa dinheiro)

1. Banco local com IA ligada e conexões anônimas, num nome próprio para não mexer nos outros:
   ```bash
   cd spacetime-spike && set -a && . worker/.env && set +a && AI_PROVIDER=openai AUTH_DEV_ANON=1 spacetime publish -s local -p server -y roteiro-imgexp
   ```
2. Worker com imagens reais, modo experimento e comparação (em outro terminal):
   ```bash
   cd spacetime-spike/worker && STDB_DB=roteiro-imgexp AI_IMAGE_PROVIDER=openai AI_IMAGE_EXPERIMENT=1 AI_IMAGE_COMPARE_PATHS=1 npm start
   ```
3. Os pedidos, pela fila, como o editor faz (`--gastar` é obrigatório):
   ```bash
   cd spacetime-spike/worker && STDB_DB=roteiro-imgexp npm run images:e2e -- t1 --gastar
   ```
   ```bash
   cd spacetime-spike/worker && STDB_DB=roteiro-imgexp npm run images:e2e -- t2 --gastar
   ```
   ```bash
   cd spacetime-spike/worker && STDB_DB=roteiro-imgexp npm run images:e2e -- t3 --gastar
   ```

Cada rodada faz estas gerações:

| Rodada | O que gera | Gerações |
| --- | --- | --- |
| T1 | Moça de cabelo prateado: front, side, 6 poses nos dois caminhos | 2 + 12, mais as novas tentativas |
| T2 | Arara: front, side, 3 poses nos dois caminhos | 2 + 6, mais as novas tentativas. A cor-chave sai pela colisão (verde colide). |
| T3 | 4 lugares (um por tipo de placeholder: day, night, interior, water): base de dia e variante noturna | 8 |

O mesmo fluxo roda pelo editor: os botões de gerar personagem e background mandam os mesmos pedidos. Para comparar os caminhos por ali, use `AI_IMAGE_COMPARE_PATHS=1` no worker.

**Contagem para a decisão.** Em cada `experiments/*-pose-*/meta.json`, olhe `perPath.native` e `perPath.keyed`, `retries` e `accepted`. Depois, revise visualmente o `*-processed.png` de cada caminho sobre branco e sobre escuro, com recortes 2× das mãos e do cabelo. Os scores de borda são só diagnóstico.

## T4: cenas no player (sem custo)

1. Composites, um sprite por personagem sobre cada background, a 88% da altura como no player:
   ```bash
   cd spacetime-spike/worker && npm run images:e2e -- composite experiments/results-t1-*.json experiments/results-t2-*.json experiments/results-t3-*.json
   ```
2. No player:
   ```bash
   npm --prefix spacetime-spike/client run dev -- --port 5174 --mode ai-local
   ```
   Monte as cenas com os assets de T1–T3. As imagens ficam em `client/public/generated/`. Pelo editor, gere ou envie os assets e jogue.

## Suposições (onde o plano deixou margem)

**Charsheet e poses**
- Sprites são de corpo inteiro (como nos experimentos). O prompt antigo, da cintura para cima, continua só no pedido `sprite`, que não é mais usado pelo worker.
- A descrição fixa do personagem é `design` no input do `character`; sem ela, usa-se `nome: desc`. O texto da pose é `nome: desc` de cada emoção.

**Cor-chave**
- "Perto da cor" na colisão significa excesso acima de 32, onde o keyer já começaria a deixar o pixel transparente.
- O limite mínimo de excesso da tela é 100 para as quatro cores. O `key_magenta.py` usava 120, e o gpt-green, 100.

**Verificações**
- Os limites são primeiras estimativas, para ajustar com T1–T2:
  - cantos: alfa ≤ 4;
  - área: entre 4% e 70%;
  - maior buraco: até 4% da silhueta;
  - contorno: no máximo 1 camada com mais de 30% de halo claro, resto da chave ou RGB cinza escondido sob alfa 0.
- Um vão real entre braço e corpo também conta como buraco, por isso o limite é folgado.

**Alinhamento**
- A escala de cada pose vai para a altura do front, limitada a ±15%, para um braço erguido não encolher o corpo.
- O centro horizontal vem dos pés (os 15% de baixo do conteúdo).
- O que sai da tela fica registrado em `clippedPixels`.

**Backgrounds**
- Recorte central para 16:9 (1536×864). O palco do player é 16:9 em `client/index.html` (`.stage`, `.play .pic`); o `live.css` não define aspecto. O fundo usa `object-fit: cover`, e os sprites, 88% da altura, presos embaixo.
- Variantes têm um nome (`day`, `sunset`, `night`, `rain`) ou um texto livre de luz. O pedido `background` aceita `variants` e `base_key`.

**Política e custo**
- Se nenhuma tentativa passa nas verificações, a pose é entregue mesmo assim, com `accepted: false`, em vez de falhar o personagem inteiro.
- O preço do `gpt-image-2` não está no código: defina as três variáveis de preço para ter o custo em US$.

## Observações

- O deploy (`deploy/setup.sh` faz `npm ci`) passa a instalar `sharp`, que tem binário pronto para Linux x64.
- O `tsc -p .` (`npm run typecheck`) acusa 2 erros que já existiam: a assinatura do `onError` da assinatura em `src/index.ts` e em `test/harness.ts`, ambos no SDK do SpacetimeDB. O código novo não tem erros.
