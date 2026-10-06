# Fase 2b, Nutrição: medidas, histórico e desafio. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** registrar em colheres e conchas (medidas pessoais e da POF), ver a consistência do mês
num calendário e desafiar amigos em dias no alvo sem expor o que cada um comeu; fechar as
pendências deixadas pela 2a.

**Architecture:** três migrations novas (`0014` medidas, `0015` desafio, `0016` histórico) no
mesmo estilo da 2a: RLS, funções `security definer` com `search_path` fixo, triggers `security
invoker` para regras do cliente. No cliente, medidas pessoais entram na fila offline do diário
(`kind: 'measure'`); as sugeridas saem de um JSON gerado da POF junto com a TACO. Calendário e
desafio reaproveitam `get_nutrition_days` e o fluxo de desafios da 1b.

**Tech Stack:** o mesmo da 2a (Postgres/PGlite, React 19, Zustand, TypeScript, Tailwind v4,
shadcn/ui). Nenhuma dependência nova.

**Spec:** `docs/superpowers/specs/2026-10-06-fase-2b-nutricao-design.md` (ler inteira). Contexto:
`docs/superpowers/specs/2026-10-05-fase-2-nutricao-design.md` §5 e §16, plano da 2a
(`docs/superpowers/plans/2026-10-05-fase-2a-nutricao.md`, seção "Registro de execução"), desafios
da 1b em `supabase/migrations/0004_social.sql` e `0006_delete_account.sql`. Regras: `CLAUDE.md`.

## Global Constraints

- Branch `main-f7pdmv`. Commit ao fim de cada tarefa; o controlador faz o push.
- Pré-requisito: o commit `feat(nutrition): ship the TACO table` (dados reais da TACO em `src/features/nutrition/data/taco.json` e `scripts/data/taco-4ed.csv`) já está no branch antes da Task 4.
- Fontes: TACO 4ª ed. (NEPA/Unicamp) e POF 2008-2009 Tabela de Medidas Referidas (IBGE), cópias oficiais em `/home/user/brolesi/taco` (`data/raw/`, `data/processed/pof/pof_medidas_caseiras.csv`). Citações: "Fonte: TACO, NEPA/Unicamp" e "Medidas: POF 2008-2009, IBGE".
- Medidas pessoais: `food_key` `taco:<id>` | `off:<código>` | `custom:<id>`; nome 1 a 30 caracteres; 1 a 2000 g; 10 por alimento, 500 por pessoa; pessoais antes das sugeridas.
- Desafio `nutrition_days_on_target`: team (soma) e solo; 7 a 92 dias; 2 a 20 pessoas; solo meta 1 até a duração; equipe 1 até duração × (1 + convidados); opt-in `share_nutrition` obrigatório (`nutrition_opt_in_required`); pilar ligado para criar ou entrar (`nutrition_off`); fecha quando `challenge_today > ends_on + 2`; +300 XP e conquistas de desafio de sempre.
- Toda função nova ou com assinatura nova: `drop` da antiga se mudar, `security definer set search_path = public` (ou `security invoker` em trigger de regra do cliente), `revoke all ... from public, anon, authenticated` (internas) ou `revoke ... from public, anon` + `grant execute ... to authenticated` (RPC).
- Privacidade: participantes de desafio veem só a contagem de dias no alvo; nada de `food_logs`, metas, kcal ou medidas sai para outra conta.
- Texto público (CLAUDE.md): sem travessão nem hífen como pausa; humanizer; toda chave nova nos 16 packs (pt-BR em `PT_BR_OVERRIDES`) na tarefa que a cria; `node scripts/check-locales.mjs` e `node scripts/check-source-strings.mjs --strict` passando. Nomes de alimentos e de medidas sugeridas não são traduzidos.
- UX (spec base §7.4): mobile-first, alvos ≥ 44 px, Drawer, skeleton com a forma do conteúdo, estados vazio/erro/offline, `prefers-reduced-motion`, números em Geist Mono tabular, nada só por cor. "Hoje" sempre por `todayIn(profile.timezone)`.
- TDD com RED registrado no relatório. Commits `type: summary` em inglês, terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Depois de cada tarefa: `npm run typecheck && npm test && npm run build` verdes (e os dois scripts de locale quando houver texto).

## Review Focus

1. **Desafio fechando antes dos dias de nutrição:** o fechamento precisa fechar os dias pendentes de cada participante (`close_nutrition_days`) antes de calcular o progresso (Task 2).
2. **Medida pessoal de alimento sem `source_id`** (registro rápido, alimento próprio recém criado offline): a tela não oferece "Criar medida" sem `food_key` válido (Task 6).
3. **Mapa TACO × POF com gramas absurdas** (ex.: "unidade" de melancia com 50 g): teste de faixa plausível por grupo de alimento (Task 4).
4. **Calendário em mês sem nenhum dia ativo ou antes da ativação:** estado vazio com explicação, sem chamadas inúteis ao servidor (Task 7).
5. **Cliente antigo chamando `join_challenge` com a assinatura velha durante o deploy:** documentado no SETUP; o cliente novo usa parâmetros nomeados (Task 8 e 10).

## Decisões

1. **Migrations.** `0014_food_measures.sql` (Task 1), `0015_nutrition_challenge.sql` (Task 2),
   `0016_nutrition_history.sql` (Task 3).
2. **Assinaturas de desafio.** `create_challenge` ganha `p_share_nutrition boolean default false` e
   `join_challenge` ganha `p_share_nutrition boolean default false`; as antigas são removidas com
   `drop function` e os grants refeitos. O cliente chama ambas com todos os parâmetros nomeados.
3. **Fechamento.** `close_challenge` chama `close_nutrition_days(member)` para cada participante
   antes de calcular `final` quando o modelo é de nutrição; `close_due_challenges` e
   `close_all_challenges` usam `ends_on + 2` para esse modelo.
4. **Medidas sugeridas.** Arquivo curado `scripts/data/taco-pof-map.csv`
   (`taco_id,pof_codigo_alimento,pof_codigo_preparacao,nota`), gerado por um script auxiliar de
   casamento de nomes (`scripts/suggest-taco-pof-map.mjs`, não usado no build) e revisado à mão.
   `build-taco.mjs` lê o mapa e `scripts/data/pof-medidas.csv` (cópia de
   `pof_medidas_caseiras.csv` com cabeçalho de procedência) e gera `taco-measures.json`.
5. **Rótulos da POF.** Tabela `POF_LABEL` no script: "COLHER DE ARROZ/SERVIR" → "colher de servir",
   "CONCHA" → "concha", "XICARA DE CHA" → "xícara", "UNIDADE" → "unidade", "FATIA" → "fatia",
   "COLHER DE SOPA" → "colher de sopa", "COLHER DE CHA" → "colher de chá", "ESCUMADEIRA" →
   "escumadeira", "COPO AMERICANO" → "copo americano", "PEDACO" → "pedaço", demais em minúsculas
   sem abreviação; medidas sem tradução na tabela são descartadas.
6. **Plurais.** `lib/i18n.js` ganha `tn(n, key, ...args)`: procura `key + '|' + categoria`
   (`Intl.PluralRules(lang).select(n)`), cai para `key` com `{0}`. Só pl, ru e uk recebem chaves
   `|few` e `|many`; os demais packs continuam com a forma singular/plural atual.

## File Structure

```
supabase/migrations/0014_food_measures.sql, 0015_nutrition_challenge.sql, 0016_nutrition_history.sql
supabase/tests/nutrition-measures.test.ts, nutrition-challenge.test.ts, nutrition-history.test.ts
scripts/suggest-taco-pof-map.mjs, scripts/build-taco.mjs (+ medidas), scripts/data/taco-pof-map.csv,
scripts/data/pof-medidas.csv
src/features/nutrition/
  measures.ts            foodKey(item), mergeMeasures(personal, suggested), loadSuggested()
  data/taco-measures.json
  MeasureSheet.tsx       criar/editar/apagar medida
  PortionSheet.tsx       chips e multiplicador
  HistoryScreen.tsx      /nutricao/historico
  DaySheet.tsx           detalhe do dia
  history.ts             montagem do mês (puro)
  nutrition-api.ts, outbox.ts, useNutrition.ts   medidas
src/features/social/templates.ts, social-api.ts, NewChallengeSheet.tsx, ChallengeDetail.tsx, labels.ts
src/lib/i18n.js (tn), src/locales/*.js
public/privacidade.html, NOTICE.md, docs/SETUP.md, docs/ROADMAP.md
```

---

### Task 1: Banco: medidas pessoais

**Files:** Create `supabase/migrations/0014_food_measures.sql`, `supabase/tests/nutrition-measures.test.ts`; Modify `src/lib/database.types.ts`, `supabase/tests/delete-account.test.ts` (cascata).

**Interfaces:** Produces tabela `food_measures` (spec §6.1); trigger `food_measures_guard` `security invoker` (limites 10 por `food_key` e 500 por pessoa contando ids diferentes do que chega; `updated_at` limitado a `now()`; update mais velho → `return null`; mensagens `too_many_measures`).

- [ ] **Step 1: Testes que falham:** RLS (B não lê/escreve de A); checks (`food_key` inválido, nome vazio ou com 31 caracteres, 0 g, 2001 g); 10 por alimento (o 11º → `too_many_measures`, upsert do existente no cheio passa); 500 por pessoa; última escrita vence; exclusão de conta apaga.
- [ ] **Step 2:** rodar → FAIL. **Step 3:** migration. **Step 4:** `npx vitest run supabase/tests` → PASS; tipos; gate.
- [ ] **Step 5: Commit** `feat(nutrition): personal food measures`.

### Task 2: Banco: desafio de nutrição

**Files:** Create `supabase/migrations/0015_nutrition_challenge.sql`, `supabase/tests/nutrition-challenge.test.ts`; Modify `src/lib/database.types.ts`; continuam verdes `supabase/tests/social-*.test.ts`.

**Interfaces:** Consumes `close_nutrition_days(uuid)` (0011), `nutrition_days`, desafios (0004/0006). Produces: `challenges.template` com `nutrition_days_on_target`; `challenge_members.share_nutrition`; `create_challenge(..., p_share_volume, p_share_nutrition boolean default false)` e `join_challenge(p_id uuid, p_share_volume boolean default false, p_share_nutrition boolean default false)` (Decisão 2); ramo em `challenge_progress`; `close_challenge`, `close_due_challenges`, `close_all_challenges` com `ends_on + 2` e fechamento de dias antes (Decisão 3); erros `nutrition_opt_in_required`, `nutrition_off`.

- [ ] **Step 1: Testes que falham:** criação válida team e solo; metas fora da faixa (solo > duração; team > duração × (1 + convidados)) → `invalid_challenge`; sem opt-in → `nutrition_opt_in_required`; pilar desligado (criador ou quem entra) → `nutrition_off`; progresso conta só `on_target` não importados no período e só de quem entrou; dias com pilar desligado não contam; não fecha em `ends_on + 1`, fecha em `ends_on + 3` (fuso do criador) com os dias pendentes fechados antes; +300 para equipe vencedora e para quem atingiu no solo; `challenge_json` não traz nada além da contagem; os modelos antigos continuam fechando em `ends_on + 1`; `count(*) from pg_proc` = 1 para `create_challenge` e `join_challenge`.
- [ ] **Step 2:** FAIL. **Step 3:** migration (copiar os corpos atuais de 0004/0006 e mudar só o necessário). **Step 4:** `npx vitest run supabase/tests` → PASS; gate.
- [ ] **Step 5: Commit** `feat(social): nutrition days challenge`.

### Task 3: Banco: XP por dia e meta semanal no histórico

**Files:** Create `supabase/migrations/0016_nutrition_history.sql`, `supabase/tests/nutrition-history.test.ts`.

**Interfaces:** `get_nutrition_days(p_from, p_to)` (mesma assinatura) passa a devolver em cada dia `xp` (soma do ledger do pilar ligado aos eventos `nutrition:<dia>`, incluindo o +150 do dia que bateu a meta) e um array `weeks: [{ start, target, on_target, target_hit }]` para as semanas tocadas pelo intervalo.

- [ ] **Step 1: Testes que falham:** dia no alvo com 120 + 10; dia que bateu a meta inclui +150; semana com meta batida e semana neutra; B não vê nada de A; limite de 62 dias mantido.
- [ ] **Step 2:** FAIL. **Step 3:** migration (`create or replace`). **Step 4:** PASS; gate.
- [ ] **Step 5: Commit** `feat(nutrition): day XP and weekly goals in day history`.

> **Revisão (controlador):** Tasks 1 a 3.

### Task 4: Medidas sugeridas da POF

**Files:** Create `scripts/suggest-taco-pof-map.mjs`, `scripts/data/taco-pof-map.csv`, `scripts/data/pof-medidas.csv`, `src/features/nutrition/data/taco-measures.json`; Modify `scripts/build-taco.mjs` e seu teste, `NOTICE.md` (POF/IBGE).

**Interfaces:** Produces `taco-measures.json`: `Record<string /* taco id */, { label: string; grams: number }[]>`, até 6 por alimento, ordem crescente de gramas, sem rótulo repetido.

- [ ] **Step 1:** copiar `pof_medidas_caseiras.csv` para `scripts/data/pof-medidas.csv` com cabeçalho de procedência (fonte IBGE, URL do ftp original, commit de `brolesi/taco`).
- [ ] **Step 2:** `suggest-taco-pof-map.mjs` propõe a correspondência por nomes normalizados (base e preparo da TACO contra descrição e preparo da POF); revisar à mão e gravar `taco-pof-map.csv` com cerca de 100 alimentos comuns (arroz, feijões, carnes bovinas, frango, peixes, ovos, pães, massas, batata, mandioca, legumes, verduras, frutas, leite, iogurte, queijos, oleaginosas, açúcar, óleos). Cada linha com `nota` quando o casamento não for óbvio.
- [ ] **Step 3: Testes que falham** (no teste do script): todo `taco_id` do mapa existe na TACO e aparece uma vez; gramas > 0; faixas plausíveis por grupo (colheres 2 a 60 g, conchas 50 a 250 g, xícara 50 a 300 g, unidade de fruta 20 a 2000 g, fatia 5 a 200 g); no máximo 6 por alimento; rótulos traduzidos pela `POF_LABEL` (Decisão 5); arroz cozido tem "colher de servir"; feijão cozido tem "concha".
- [ ] **Step 4:** implementar; regenerar; PASS; gate (o chunk da TACO cresce pouco; anotar o tamanho).
- [ ] **Step 5: Commit** `feat(nutrition): suggested household measures from POF`.

### Task 5: Cliente: dados das medidas

**Files:** Create `src/features/nutrition/measures.ts` + teste; Modify `types.ts`, `nutrition-api.ts`, `outbox.ts` (`kind: 'measure'`), `useNutrition.ts` + testes, `taco.ts` (carrega `taco-measures.json` junto).

**Interfaces:**
```ts
type Measure = { id: string; food_key: string; label: string; grams: number; updated_at: string }
type MeasureOption = { label: string; grams: number; kind: 'personal' | 'suggested' | 'serving' | 'last'; id?: string }
function foodKey(item: FoodItem | UserFood | FoodLog): string | null   // null para quick e para item sem id estável
function mergeMeasures(personal: Measure[], suggested: { label: string; grams: number }[], item: FoodItem): MeasureOption[]
function loadSuggested(): Promise<Record<string, { label: string; grams: number }[]>>
// useNutrition: measures: Measure[]; addMeasure(m: Omit<Measure, 'id' | 'updated_at'>): Measure;
//   updateMeasure(id: string, patch: Partial<Measure>): void; removeMeasure(id: string): void; measuresFor(key: string): Measure[]
```
- [ ] **Step 1: Testes que falham:** `foodKey` por origem; ordem pessoal → sugerida → rótulo → última vez; rótulo pessoal igual a sugerido esconde o sugerido; offline cria e sobe na volta; outro usuário não vê; refused dropa com o aviso existente.
- [ ] **Step 2–4:** FAIL, implementar, PASS; gate.
- [ ] **Step 5: Commit** `feat(nutrition): measures in the diary store`.

### Task 6: Tela de porção com medidas

**Files:** Create `MeasureSheet.tsx` + teste; Modify `PortionSheet.tsx` + teste, `src/locales/*.js`.

**Interfaces:** Consumes Task 5. `MeasureSheet({ foodKey, measure?, defaultGrams, open, onOpenChange })`.

- [ ] **Step 1: Testes que falham:** chips na ordem da Task 5 com "Fonte" da POF quando houver sugerida; tocar num chip define 1 × medida; stepper 0,5 a 20 em passos de 0,5 multiplica; totais mostram "2 colheres de servir · 90 g"; "Criar medida" preenche gramas atuais e valida nome e faixa; editar e apagar pelo menu do chip; sem `foodKey` não há "Criar medida"; quick add sem medidas.
- [ ] **Step 2–4:** FAIL, implementar, strings nos 16 packs, scripts de locale, PASS; gate.
- [ ] **Step 5: Commit** `feat(nutrition): household measures on the portion sheet`.

> **Revisão (controlador):** Tasks 4 a 6.

### Task 7: Histórico em calendário

**Files:** Create `history.ts` + teste, `HistoryScreen.tsx` + teste, `DaySheet.tsx` + teste; Modify `App.jsx` (rota), `NutritionScreen.tsx` (botão "Histórico"), `nutrition-api.ts` (tipos de `fetchDays`), `src/locales/*.js`.

**Interfaces:** `buildMonth(month: string /* AAAA-MM */, days: NutritionDay[], weeks: WeekSummary[], periods info, today: string): MonthCell[][]` com estados `on_target | logged | none | inactive | open`.

- [ ] **Step 1: Testes que falham:** estados por dia com ícone e rótulo; linha da semana "4/5 no alvo" e selo; navegação até o primeiro período, sem ir além; mês sem dia ativo mostra estado vazio sem chamar o servidor; sheet do dia online com itens buscados, offline com o aviso; streak atual e melhor no topo; cache por conta.
- [ ] **Step 2–4:** FAIL, implementar, strings, PASS; gate.
- [ ] **Step 5: Commit** `feat(nutrition): monthly history calendar`.

### Task 8: Desafio de nutrição no cliente

**Files:** Modify `src/features/social/templates.ts` + teste, `types.ts`, `social-api.ts` + teste, `labels.ts`, `NewChallengeSheet.tsx` + teste, `ChallengeDetail.tsx` + teste, `src/locales/*.js`.

**Interfaces:** `TEMPLATES` inclui `nutrition_days_on_target`; `MODES` team/solo; `targetRange` (Global Constraints); `checkChallenge` com problema `'nutrition'` (opt-in) e `'nutrition_off'`; `createChallenge` e `joinChallenge(id, { shareVolume, shareNutrition })` com parâmetros nomeados; `resultOn(c) = ends_on + 2` para o modelo.

- [ ] **Step 1: Testes que falham:** modelo desabilitado com explicação e atalho para a ativação quando o pilar está desligado; opt-in obrigatório na criação e ao entrar; metas sugeridas e faixas iguais às do SQL; detalhe com "Contando até anteontem" e "Resultado sai em <data>"; erros `nutrition_opt_in_required` e `nutrition_off` com texto; o feed e o cartão de amigo não mudam.
- [ ] **Step 2–4:** FAIL, implementar, strings, PASS; gate.
- [ ] **Step 5: Commit** `feat(social): nutrition challenge in the app`.

### Task 9: Pendências da 2a

**Files:** Modify `NutritionSetup.tsx` + teste, `NutritionScreen.tsx` e `HomeNutritionCard.tsx` (hoje reativo), `CopyFromSheet.tsx` + teste, `src/lib/i18n.js` + teste, packs `pl.js`, `ru.js`, `uk.js` e chamadas com contagem (`TodayCard.tsx`, `CopyFromSheet.tsx`, demais encontradas por `grep "=== 1 ?"`).

- [ ] **Step 1: Testes que falham:** botão final da ativação desabilitado com "Carregando suas metas" enquanto o store não está `ready`; virada de meia-noite com relógio falso troca o dia ao voltar o foco e no tick de 1 minuto; falha do fetch dos dias antigos mostra a linha de aviso; `tn` escolhe `few`/`many` em pl/ru/uk (ex.: 2, 5, 22 itens) e cai para a forma atual nos demais.
- [ ] **Step 2–4:** FAIL, implementar, strings, PASS; gate.
- [ ] **Step 5: Commit** `fix(nutrition): close the loose ends from phase 2a`.

> **Revisão (controlador):** Tasks 7 a 9.

### Task 10: Privacidade, avisos e documentação

**Files:** Modify `public/privacidade.html` + `src/lib/privacy-page.test.js`, `NOTICE.md`, `docs/SETUP.md` (migrations 0014 a 0016 antes do cliente; mudança de assinatura de `join_challenge`), `docs/ROADMAP.md` (2b concluída), spec da 2b (decisões que o plano fechou).

- [ ] **Step 1: Teste que falha:** a página cita medidas pessoais e o opt-in do desafio de nutrição em pt-BR e en.
- [ ] **Step 2:** atualizar textos (humanizer) e docs.
- [ ] **Step 3:** `node scripts/check-locales.mjs && node scripts/check-source-strings.mjs --strict && npm run typecheck && npm test && npm run build`.
- [ ] **Step 4: Commit** `docs: privacy, notices and setup for phase 2b`.

> **Revisão final (controlador):** revisor do branch da 2b inteira contra a spec, cobrindo também a Task 10.
