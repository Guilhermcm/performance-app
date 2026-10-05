# Fase 2a, Nutrição: trocar de app. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o grupo larga o app de dieta antigo. A pessoa liga o pilar Nutrição, recebe uma meta de
calorias e macros, registra o dia por busca (TACO, Open Food Facts, recentes, favoritos), código
de barras, cópia ou registro rápido, e ganha XP pelos dias no alvo, que o servidor decide ao
fechar cada dia. A Home ganha o radar de pilares e a barra de XP por pilar.

**Architecture:** o Postgres continua sendo a autoridade. Migrations novas, uma por tarefa de
banco (`0007` a `0013`), criam períodos do pilar, diário, metas, resumos diários e o fechamento do
dia, que emite eventos `server_only` para o `award_xp` de sempre. Nada da Força muda de
comportamento: a Nutrição tem `reason` próprios, streak próprio e função de semana própria. No
cliente, `src/features/nutrition/` tem regras puras espelhadas do SQL, uma fila offline para o
diário, a busca local (TACO) e online (Open Food Facts), o leitor de código de barras sobre o
esqueleto de câmera que já existe, e as telas em shadcn. O radar usa shadcn/ui Charts (Recharts),
carregado sob demanda.

**Tech Stack:** Postgres (Supabase) com PL/pgSQL e `pg_cron`; `@electric-sql/pglite` + Vitest;
React 19, React Router 7 (`HashRouter`), Zustand 5, TypeScript, Tailwind v4 sem preflight,
shadcn/ui (Drawer/vaul, ToggleGroup, Switch, Skeleton, Progress, Chart), `motion`,
`lucide-react`, `sonner`, `@testing-library/react`; novos: `recharts`, `@zxing/library`.

**Spec:** `docs/superpowers/specs/2026-10-05-fase-2-nutricao-design.md` (revisão 3; ler inteira,
menos §12). Base: `docs/superpowers/specs/2026-10-04-performance-app-foundation-design.md` §4.2,
§5, §7.4. Regras do projeto: `CLAUDE.md`. Modelo de estilo dos testes SQL e de UI: plano da 1b
(`docs/superpowers/plans/2026-10-05-fase-1b-social.md`), Task 1 e Task 8.

## Global Constraints

- Branch `main-f7pdmv` (já existe, com a spec). Commit ao fim de cada tarefa; o controlador faz o push.
- Pilar `nutrition` já existe no enum `public.pillar`. Eventos novos: `day_logged`, `day_on_target`, `macros_balanced`, todos `server_only`, `source_ref = 'nutrition:<AAAA-MM-DD>'`.
- XP da Nutrição (spec §6.3): dia no alvo até o T-ésimo = `session_xp(T, i)`; além de T = 25 (máx. 2/semana); meta semanal = +150; `macros_balanced` = 30 (máx. 3/semana); `day_logged` = 10. Teto 960. `reason`: `nutrition_day`, `nutrition_day_extra`, `nutrition_week_target`, `nutrition_balanced`, `nutrition_logged`.
- Classificação (spec §6.2): `logged` = ≥ 2 refeições com item e kcal ≥ 50% da meta; `on_target` = `logged` e |kcal − meta| ≤ 10% e proteína ≥ meta; `balanced` = `on_target` e carboidrato e gordura a ±20% das metas.
- T da Nutrição: `nutrition_days_per_week` 3 a 7, padrão 5, congelado por semana em `weekly_targets` com `pillar = 'nutrition'`.
- Janela do diário: só hoje e ontem (fuso do perfil). Dia D fecha no começo de D+2.
- Toda função nova ou com assinatura nova: `drop` da antiga se mudar, `security definer set search_path = public`, `revoke all ... from public, anon, authenticated` (internas e de trigger) ou `revoke ... from public, anon` + `grant execute ... to authenticated` (RPC). Tabelas novas: RLS ligada; `revoke ... from anon`; escrita do cliente só onde a spec §5.3 permite.
- Toda escrita de XP de um usuário trava `pg_advisory_xact_lock(hashtextextended('xp:' || user_id::text, 0))` antes (contrato da 1a).
- Privacidade: amigos nunca recebem `food_logs`, `user_foods`, `nutrition_targets`, `nutrition_days`, `nutrition_periods`, conquistas `private`, bloco `nutrition` nem `radar`.
- Código novo em TypeScript em `src/features/nutrition/`, `src/components/ui/`; JS legado só onde a tarefa manda.
- Texto público (CLAUDE.md): sem travessão nem hífen como pausa; passar pelo humanizer (`anthropic-skills:humanizer` em pt-BR, `humanizer` em inglês); **toda chave nova nos 16 packs** de `src/locales/` (pt-BR em `PT_BR_OVERRIDES`) na mesma tarefa que a cria; `node scripts/check-locales.mjs` e `node scripts/check-source-strings.mjs --strict` passando.
- UX (spec base §7.4): mobile-first, alvos ≥ 44 px, Drawer no lugar de modal, safe areas, skeleton com a forma do conteúdo, vazio com próxima ação, erro com tentar de novo, offline sem bloquear, motion 150–300 ms, `prefers-reduced-motion` só fade, números em Geist Mono tabular, nada só por cor.
- Commits `type: summary` em inglês, terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Depois de cada tarefa: `npm run typecheck && npm test && npm run build` verdes.

## Review Focus

1. **Virada de dia no fuso**: item lançado às 23:59 e às 00:01 locais, pessoa fora de São Paulo; o dia certo recebe o item e fecha em D+2 local (Task 3 e Task 4 testam com `timezone = 'Asia/Tokyo'`).
2. **Fila offline velha**: aparelho volta depois de 3 dias com itens de anteontem na fila; o servidor recusa com `day_closed`, a fila descarta só esses e avisa uma vez (Task 8).
3. **Open Food Facts com dados sujos**: `nutriments` com strings, só kJ, campos ausentes, nome vazio; nada quebra e o produto sem kcal some (Task 9).
4. **Câmera negada ou sem `BarcodeDetector`** (Safari no iPhone): o leitor cai para ZXing e, sem permissão, oferece "Digitar código" (Task 11).
5. **Perfil extremo ou incompleto**: 400 kg, 14 anos, sem objetivo, unidade em lb; a meta sai dentro dos limites do banco e a ativação pede o que falta (Task 7 e Task 12).

## Decisões

Pontos que a spec deixa para o plano.

1. **Migrations por tarefa.** A spec fala em `0007`/`0008`; o plano usa uma migration por tarefa de
   banco para cada revisão ver só o seu pedaço: `0007_nutrition_base.sql` (Task 1),
   `0008_weekly_targets_pillar.sql` (Task 2), `0009_nutrition_diary.sql` (Task 3),
   `0010_nutrition_close.sql` (Task 4), `0011_nutrition_week.sql` (Task 5),
   `0012_nutrition_progress.sql` (Task 6), `0013_nutrition_cron.sql` (Task 5). Nada foi aplicado em
   produção ainda, então a ordem é livre.
2. **Escrita do servidor sem marca** (spec §5.4, revisão 3). O cliente escreve como
   `authenticated`; funções `security definer` escrevem como o dono e não passam por RLS. Tipos
   `server_only` são barrados pela política de insert de `activity_events`; o trigger de
   `food_logs` é `security invoker` e só aplica as regras quando `current_user` é `authenticated`
   ou `anon`. Nos testes, inserir como superusuário (`sql(db, ...)`) já é "o servidor".
3. **Hora nos testes.** `app_now()` e `setClock` como na 1a. `validate_activity_event` continua com
   `now()` para os tipos da Força; os tipos `server_only` não passam pela janela, então os testes de
   fechamento não precisam desligar o trigger.
4. **TACO.** Fonte: planilha oficial da 4ª edição (NEPA/Unicamp). A Task 9 baixa a planilha, confirma
   os termos de uso e versiona a conversão em CSV em `scripts/data/taco-4ed.csv` com o cabeçalho
   de origem; o script gera `src/features/nutrition/data/taco.json`
   (`{ id, name, kcal, protein, carbs, fat, fiber }` por 100 g, ~600 itens). Se a planilha não
   puder ser baixada nesta sessão ou os termos não permitirem, a tarefa para e o controlador
   pergunta à pessoa.
5. **Open Food Facts.** Busca por texto em
   `https://world.openfoodfacts.org/cgi/search.pl?search_terms=<q>&search_simple=1&json=1&page_size=20&cc=br&lc=pt&fields=code,product_name,product_name_pt,brands,nutriments,serving_quantity,serving_size`;
   produto em `https://world.openfoodfacts.org/api/v2/product/<code>.json?fields=...`. A Task 9
   compara com `https://search.openfoodfacts.org/search` usando 5 termos reais ("arroz", "whey",
   "iogurte natural", "pão de forma", "feijão") e troca o endpoint de texto só se o novo der
   resultados melhores nos 5; registra a escolha no commit.
6. **ZXing.** `@zxing/library` (Apache-2.0), `MultiFormatReader` com `EAN_13`, `EAN_8`, `UPC_A`,
   `UPC_E`, alimentado pelo canvas de `lib/scan-web.js`; import dinâmico. Entra em `NOTICE.md`.
7. **Recharts.** `recharts@^3` e o `chart.tsx` do shadcn para Recharts 3 (copiado do registro do
   shadcn, sem o CLI se não houver rede), só com `ChartContainer`, `ChartTooltip`,
   `ChartTooltipContent` e `ChartConfig`.
8. **Última escrita vence.** O cliente manda `updated_at = new Date().toISOString()` em todo upsert.
9. **Peso.** Pesar-se no sheet de peso (`src/sheets.jsx`) chama `onWeighIn(kg)` de
   `features/nutrition/weigh-in.ts`, que atualiza `profiles.weight_kg` (convertendo lb) e, com o
   pilar ligado em modo automático, grava a meta nova para amanhã.
10. **Stats.** Sai da TabBar e vira botão `BarChart3` no cabeçalho da Home e do Plano;
    `TAB_OF` passa `stats`, `history` e `structural-balance` para `plan`.
11. **Rota.** `/nutricao` (dia) e `/nutricao/:day` não existem separadas: o dia é estado da tela
    (`today` | `yesterday`). Sheets são Drawers dentro da tela.

## File Structure

```
supabase/
├─ migrations/
│  ├─ 0007_nutrition_base.sql        perfil, nutrition_periods, server_only (RLS e janela)
│  ├─ 0008_weekly_targets_pillar.sql weekly_targets por pilar e seus leitores
│  ├─ 0009_nutrition_diary.sql       nutrition_targets, food_logs, user_foods, triggers, RLS
│  ├─ 0010_nutrition_close.sql       nutrition_days, classificação, fechamento, ramo do award_xp
│  ├─ 0011_nutrition_week.sql        close_nutrition_weeks, catálogo e métricas, get_nutrition_days
│  ├─ 0012_nutrition_progress.sql    progress_card, my_progress_extras, get_my_progress, radar
│  └─ 0013_nutrition_cron.sql        close-nutrition-days às 06:30 UTC
└─ tests/
   ├─ helpers/nutrition.ts           N (uuid), enableNutrition, logItem, setTarget, closeAs
   ├─ fixtures/nutrition-scenarios.json  classificação e XP (paridade)
   ├─ nutrition-base.test.ts         períodos, server_only, exclusão de conta
   ├─ nutrition-weekly-targets.test.ts
   ├─ nutrition-diary.test.ts        janela, RLS, limites, última escrita vence, metas
   ├─ nutrition-close.test.ts        fechamento, classes, XP, fuso
   ├─ nutrition-parity.test.ts
   ├─ nutrition-week.test.ts         streak, semana neutra, conquistas, get_nutrition_days, cron
   └─ nutrition-progress.test.ts     cartão, extras, radar, privacidade para amigos
src/
├─ lib/database.types.ts             tabelas e colunas novas
├─ App.jsx                           rota /nutricao, bind/reset de useNutrition
├─ sheets.jsx                        onWeighIn no sheet de peso
├─ views/Plan.jsx                    botão Stats no cabeçalho
├─ components/ui/chart.tsx           shadcn/ui Charts
├─ features/nav/TabBar.tsx           Início, Plano, Treinar, Nutrição, Social
├─ features/home/HomeScreen.tsx      botão Stats, radar, cartão de nutrição
├─ features/home/ProgressHero.tsx    barra da semana segmentada
├─ features/home/PillarRadar.tsx     radar (lazy)
├─ features/gamification/           types, achievements(+labels), celebrations, xp (pilar), CelebrationHost
├─ features/social/FriendsPanel.tsx  denominador sem conquistas privadas
├─ features/profile/ProfileScreen.tsx  seção Nutrição
└─ features/nutrition/
   ├─ types.ts                       Macros, FoodLog, UserFood, FoodItem, NutritionDay, Meal…
   ├─ targets.ts                     fórmulas e clamp (spec §3.2)
   ├─ classify.ts                    classificação do dia (espelho do SQL)
   ├─ portion.ts                     totais da porção
   ├─ search.ts                      normalização e ranking local
   ├─ taco.ts                        carregamento do JSON
   ├─ off-api.ts                     Open Food Facts (texto e código)
   ├─ barcode.ts                     leitura (BarcodeDetector, ZXing) e busca pelo código
   ├─ nutrition-api.ts               Supabase (logs, metas, alimentos, dias)
   ├─ outbox.ts                      fila offline
   ├─ weigh-in.ts                    peso → perfil → meta
   ├─ useNutrition.ts                store
   ├─ labels.ts                      nomes de refeição, níveis de atividade, formatação
   ├─ NutritionScreen.tsx, NutritionInvite.tsx, MealCard.tsx
   ├─ FoodSearchSheet.tsx, PortionSheet.tsx, QuickAddSheet.tsx, CustomFoodSheet.tsx,
   │  CopyFromSheet.tsx, BarcodeScanner.tsx
   ├─ NutritionSetup.tsx             ativação e edição da meta
   ├─ HomeNutritionCard.tsx
   ├─ data/taco.json
   └─ test-nutrition.ts              fábricas para testes
scripts/build-taco.mjs, scripts/data/taco-4ed.csv
public/privacidade.html, NOTICE.md, docs/SETUP.md, docs/ROADMAP.md
```

---

### Task 1: Banco: períodos do pilar e eventos `server_only`

**Files:**
- Create: `supabase/migrations/0007_nutrition_base.sql`
- Create: `supabase/tests/helpers/nutrition.ts`
- Modify: `src/lib/database.types.ts` (colunas novas de `profiles`, `nutrition_periods`, `event_kinds.server_only`)
- Test: `supabase/tests/nutrition-base.test.ts`, `supabase/tests/delete-account.test.ts` (sem mudança; precisa continuar verde)

**Interfaces:**
- Consumes: `local_today(uuid)`, `app_now()` (0002); `validate_activity_event` e a política `activity_events_insert_own` (0001:161-190). Helpers `freshDb`, `addUser`, `asUser`, `A`, `B`, `sql`, `setClock`, `makeUser`, `ledger`.
- Produces (SQL): colunas `profiles.activity_level`, `nutrition_pace`, `nutrition_enabled`, `nutrition_days_per_week` (spec §5.1); tabela `nutrition_periods(user_id, started_on, ended_on)`; `event_kinds.server_only`; linhas `('nutrition','day_logged',true)`, `('nutrition','day_on_target',true)`, `('nutrition','macros_balanced',true)`; `nutrition_active_on(p_user uuid, p_day date) → boolean` (interna, `stable`).
- Produces (TS, `helpers/nutrition.ts`): `N` (uuid `…0e`), `enableNutrition(db, uid, on = true)` (update de `nutrition_enabled` como o dono).

- [ ] **Step 1: Teste que falha.** `supabase/tests/nutrition-base.test.ts`, com `setClock(db, '2026-10-07T15:00:00Z')` (quarta) e `makeUser(db, A)`:
  - `it('opens a period on the day the pillar is turned on')`: `enableNutrition(A)` → `select started_on, ended_on from nutrition_periods` = `[{ started_on: '2026-10-07', ended_on: null }]`.
  - `it('closes it the day before it is turned off')`: liga na quarta, `setClock` sexta, desliga → `ended_on = '2026-10-08'`; `nutrition_active_on(A, '2026-10-08')` true, `'2026-10-09'` false.
  - `it('reopens the same period when turned back on the day it was turned off')`: liga, desliga e religa no mesmo dia → uma linha só, `ended_on` nulo.
  - `it('covers no day when turned on and off on the same day')`: liga quarta, desliga quarta → `ended_on = '2026-10-06'`, `nutrition_active_on(A, '2026-10-07')` false.
  - `it('opens a period for a profile created with the pillar on')`: `makeUser(db, B, { nutrition_enabled: true })` → uma linha para B.
  - `it('starts a new period after a gap')`: liga dia 1, desliga dia 3, religa dia 10 → duas linhas.
  - `it('refuses server-only kinds from clients, whatever they set')`: insert como A de `('nutrition','day_logged', hoje)` → erro de RLS (`row-level security`); o mesmo numa transação com `set_config('perf.server_write','on',true)` antes → também recusado.
  - `it('accepts server-only kinds from the server outside the window')`: insert como dono (`sql`) com `occurred_on = '2026-09-01'` → aceito e o `award_xp` roda.
  - `it('still accepts strength events from clients')`: `workout_completed` de hoje como A → aceito.
  - `it('lets clients read but not write periods')`: insert/update/delete em `nutrition_periods` como A → `permission denied`; select como B das linhas de A → `[]`.
  - `it('checks the new profile columns')`: `nutrition_days_per_week = 2` e `activity_level = 'x'` → erro de check.
- [ ] **Step 2:** `npx vitest run supabase/tests/nutrition-base.test.ts` → FAIL (colunas e funções não existem).
- [ ] **Step 3: Migration `0007_nutrition_base.sql`.**
  - `alter table profiles` com as quatro colunas da spec §5.1 (sem `nutrition_enabled_on`).
  - `nutrition_periods` com RLS `select` do próprio; `revoke insert, update, delete, truncate ... from anon, authenticated`.
  - Trigger `profiles_nutrition_period` `after insert or update of nutrition_enabled`, `security definer`: ligar → se existe período com `ended_on = local_today − 1`, zera `ended_on`; senão insere `(id, local_today)` com `on conflict (user_id, started_on) do update set ended_on = null`. Desligar → `update ... set ended_on = local_today − 1 where ended_on is null`.
  - `nutrition_active_on`: `exists (... started_on <= p_day and (ended_on is null or ended_on >= p_day))`.
  - `event_kinds.server_only boolean not null default false` + as três linhas.
  - `drop policy activity_events_insert_own` e recriar com `with check (user_id = auth.uid() and not exists (select 1 from public.event_kinds k where k.pillar = activity_events.pillar and k.kind = activity_events.kind and k.server_only))`.
  - `validate_activity_event` (`create or replace`, mesma assinatura): se o tipo é `server_only`, pula a janela de 14 dias; o resto igual.
  - Revokes da regra geral.
- [ ] **Step 4:** `npx vitest run supabase/tests/nutrition-base.test.ts supabase/tests/delete-account.test.ts supabase/tests/activity-events.test.ts` → PASS.
- [ ] **Step 5:** `database.types.ts` com as colunas e a tabela; `npm run typecheck && npm test && npm run build`.
- [ ] **Step 6: Commit** `feat(nutrition): pillar periods and server-only events`.

### Task 2: Banco: metas semanais por pilar

**Files:**
- Create: `supabase/migrations/0008_weekly_targets_pillar.sql`
- Test: `supabase/tests/nutrition-weekly-targets.test.ts`; continuam verdes: `gamification-*.test.ts`, `social-*.test.ts`

**Interfaces:**
- Consumes: 0002 `weekly_targets`, `week_target_for(uuid, date)`, `freeze_week_target`, `award_xp`, `progress_card`, `get_my_progress`, `close_all_weeks`.
- Produces: `weekly_targets.pillar public.pillar not null default 'strength'`, PK `(user_id, pillar, week_start)`; `week_target_for(p_user uuid, p_week date, p_pillar public.pillar default 'strength') → smallint` (fallback `days_per_week`/3 para Força, `nutrition_days_per_week`/5 para Nutrição); trigger `profiles_freeze_target` `before update of days_per_week, nutrition_days_per_week`.

- [ ] **Step 1: Teste que falha** (`nutrition-weekly-targets.test.ts`):
  - `it('freezes each pillar on its own')`: `week_target_for(A, w, 'nutrition')` = 5 e `week_target_for(A, w)` = 3; depois `update profiles set nutrition_days_per_week = 7` → a semana corrente continua 5, a próxima é 7; a Força continua 3.
  - `it('falls back to the profile column of the pillar')`: sem linha nenhuma, semana passada → Nutrição devolve `nutrition_days_per_week`.
  - `it('keeps progress_card and get_friends working with two rows in a week')`: com linhas das duas, `select public.progress_card(A)` não dá erro e `week.target` é o da Força; `get_friends` de um amigo funciona (`befriend` de `helpers/social.ts`).
  - `it('leaves a single week_target_for')`: `select count(*) from pg_proc where proname = 'week_target_for'` = 1; como `authenticated`, chamar → `permission denied`.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3: Migration.** `alter table` + troca da PK; `drop function week_target_for(uuid, date)`; nova função; `create or replace` de `freeze_week_target` (congela cada pilar cuja coluna mudou), do trigger com as duas colunas, de `award_xp` (passa `'strength'`; o resto igual), de `progress_card` (subconsulta com `pillar = 'strength'`), de `get_my_progress` e `close_all_weeks` (congelam os dois pilares). Copiar os corpos de 0002 e mudar só essas linhas.
- [ ] **Step 4:** `npx vitest run supabase/tests` → PASS (todas as suítes SQL).
- [ ] **Step 5:** `npm run typecheck && npm test && npm run build`.
- [ ] **Step 6: Commit** `feat(nutrition): weekly targets per pillar`.

### Task 3: Banco: diário, metas e alimentos salvos

**Files:**
- Create: `supabase/migrations/0009_nutrition_diary.sql`
- Modify: `supabase/tests/helpers/nutrition.ts` (+ `logItem`, `setTarget`)
- Modify: `src/lib/database.types.ts`
- Test: `supabase/tests/nutrition-diary.test.ts`

**Interfaces:**
- Consumes: Task 1; `local_today` (0002, `security definer`).
- Produces (SQL): tabelas `nutrition_targets`, `food_logs`, `user_foods` exatamente como na spec §5.2; `target_on(p_user uuid, p_day date) → nutrition_targets` (interna, `stable`: linha com maior `valid_from <= p_day`).
- Produces (TS helpers): `logItem(db, uid, day, meal, kcal, protein = 0, carbs = 0, fat = 0, id = randomUUID())` (insert como o usuário), `setTarget(db, uid, validFrom, { kcal, protein_g, carbs_g, fat_g }, mode = 'auto')` (insert como dono).

- [ ] **Step 1: Teste que falha** (`nutrition-diary.test.ts`, relógio em quarta 2026-10-07 15:00 UTC, perfil em São Paulo):
  - `it('accepts items for today and yesterday only')`: `'2026-10-07'` e `'2026-10-06'` ok; `'2026-10-05'` e `'2026-10-08'` → `day_closed`; update e delete de item de `'2026-10-05'` (inserido como dono) → `day_closed`.
  - `it('uses the profile time zone')`: perfil `Asia/Tokyo`, relógio `2026-10-07T16:00:00Z` (já 08/10 em Tóquio) → `'2026-10-08'` ok, `'2026-10-06'` → `day_closed`.
  - `it('refuses moving an item to another day or person')`: update de `day` ou `user_id` → erro.
  - `it('refuses import items from clients')`: `source = 'import'` como A → erro.
  - `it('caps a day at 200 items without blocking edits')`: 200 inserts ok, o 201º → `too_many_items`; upsert (`insert ... on conflict (id) do update`) de um item existente no dia cheio → ok.
  - `it('keeps the newest write')`: update com `updated_at` mais antigo que o gravado → a linha não muda; com mais novo → muda; `updated_at` no futuro é gravado como `now()`.
  - `it('keeps people apart')`: B não lê, não altera e não apaga itens, metas ou alimentos de A.
  - `it('lets the first target start today and later ones tomorrow')`: primeira meta com `valid_from = hoje` ok; segunda com hoje → erro; com amanhã ok; update de meta com `valid_from <= hoje` → nenhuma linha afetada.
  - `it('checks target ranges')`: `kcal = 999` → erro de check.
  - `it('caps saved foods at 500')`.
  - `it('lets account deletion remove old items')`: item de 10 dias atrás inserido como dono, `delete_my_account()` como A → ok; outro usuário com item antigo, `delete from auth.users` como dono (painel) → ok.
  - `it('lets server functions write any day')`: uma função `security definer` de teste criada no próprio teste (como dono) insere item de 10 dias atrás para A → ok.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3: Migration.** Tabelas, índices, RLS e políticas da spec §5.3. Trigger `food_logs_guard` `before insert or update or delete`, **`security invoker`** (`set search_path = public`), nesta ordem: se `current_user not in ('authenticated', 'anon')` → passa (e devolve `coalesce(new, old)`); checa janela com `local_today(coalesce(new.user_id, old.user_id))`; recusa `import`; update não muda `user_id`/`day`; insert conta itens do dia com `id <> new.id`; `new.updated_at := least(new.updated_at, now())`; update com `new.updated_at < old.updated_at` → `return null`. Trigger de limite de `user_foods` (500) igual em estilo, também `security invoker`. `target_on`.
- [ ] **Step 4:** `npx vitest run supabase/tests/nutrition-diary.test.ts supabase/tests/delete-account.test.ts` → PASS.
- [ ] **Step 5:** tipos em `database.types.ts`; `npm run typecheck && npm test && npm run build`.
- [ ] **Step 6: Commit** `feat(nutrition): food diary, targets and saved foods`.

> **Revisão (controlador):** depois da Task 3, revisor de código sobre as Tasks 1 a 3.

### Task 4: Banco: fechamento do dia e XP do pilar

**Files:**
- Create: `supabase/migrations/0010_nutrition_close.sql`
- Create: `supabase/tests/fixtures/nutrition-scenarios.json`
- Modify: `supabase/tests/helpers/nutrition.ts` (+ `closeAs(db, uid)` que chama `close_nutrition_days` como dono)
- Test: `supabase/tests/nutrition-close.test.ts`, `supabase/tests/nutrition-parity.test.ts`

**Interfaces:**
- Consumes: Tasks 1 a 3; `session_xp`, `week_start_of`, `evaluate_achievements`.
- Produces (SQL): tabela `nutrition_days` (spec §5.2, `numeric(9,1)`); `classify_nutrition_day(p_kcal numeric, p_protein numeric, p_carbs numeric, p_fat numeric, p_meals int, p_target jsonb) → jsonb {logged, on_target, balanced}` (`immutable`); `close_nutrition_days(p_user uuid) → integer` (dias fechados); ramo `pillar = 'nutrition'` em `award_xp`.
- Produces (fixture): `nutrition-scenarios.json` com `days: [{ name, totals: {kcal, protein, carbs, fat, meals}, target: {kcal, protein_g, carbs_g, fat_g}, expect: {logged, on_target, balanced} }]` e `weeks: [{ name, target, days: [{ on, classes }], awards: [{ reason, amount, week }], total }]`.

- [ ] **Step 1: Fixture.** Pelo menos: limites exatos (kcal 90% e 110% contam, 89,9% não; proteína igual à meta conta; carboidrato a 120% conta, 120,1% não); 1 refeição com tudo não é `logged`; meta de exemplo 3010/160/404/84. Semanas: T = 3, 5 e 7 com 7 dias no alvo (awards e total 910/960 conforme T), extras limitados a 2, `macros_balanced` limitado a 3, `day_logged` 7×10.
- [ ] **Step 2: Testes que falham.**
  - `nutrition-parity.test.ts`: `it.each(days)` contra `classify_nutrition_day`; `it.each(weeks)` inserindo eventos do pilar como dono (o mesmo papel do fechamento) e comparando o ledger sem `achievement:`.
  - `nutrition-close.test.ts` (relógio quarta 2026-10-07; pilar ligado segunda 05/10; meta 2000/150/200/60 desde 05/10):
    - `it('closes a day at the start of D+2')`: itens em 05/10 → `closeAs` fecha 05/10; 06/10 não.
    - `it('stores the totals and the target in force')`.
    - `it('pays the day once')`: `closeAs` duas vezes → ledger igual; `source_ref = 'nutrition:2026-10-05'`.
    - `it('skips days outside a period and days without a target')`.
    - `it('skips days before the pillar was ever on')`.
    - `it('closes days in the profile time zone')` (`Asia/Tokyo`).
    - `it('pays the Sunday in its own week')`: domingo 11/10 fechado na terça 13/10 → `week_start = '2026-10-05'`.
    - `it('survives the largest day')`: 200 itens de 5000 kcal → fecha sem estouro.
    - `it('never touches strength reasons')`: depois de uma semana cheia de Nutrição, `achievement_stats(A)->'week_targets'` = 0 e `training_week` inalterado.
- [ ] **Step 3:** rodar → FAIL.
- [ ] **Step 4: Migration.** `nutrition_days` (select do próprio, sem escrita do cliente). `classify_nutrition_day` segundo a spec §6.2. `close_nutrition_days` (`security definer`): trava `xp:<user>`; para cada dia de `min(started_on)` até `local_today − 2` sem linha em `nutrition_days` e com `nutrition_active_on` e `target_on` não nulos: soma `food_logs`, conta refeições, grava a linha, insere os eventos que a classe der (`day_logged` se `logged`, `day_on_target` se `on_target`, `macros_balanced` se `balanced`), nessa ordem. `award_xp` ramo Nutrição com os limites de §6.3 usando `week_target_for(user, week, 'nutrition')` e os `reason` próprios; a meta semanal paga +150 no T-ésimo `nutrition_day`.
- [ ] **Step 5:** `npx vitest run supabase/tests` → PASS.
- [ ] **Step 6: Commit** `feat(nutrition): close days on the server and pay pillar XP`.

### Task 5: Banco: semana, conquistas, leitura de dias e cron

**Files:**
- Create: `supabase/migrations/0011_nutrition_week.sql`, `supabase/migrations/0013_nutrition_cron.sql`
- Modify: `src/features/gamification/achievements.ts` (métricas, códigos, `private`)
- Test: `supabase/tests/nutrition-week.test.ts`; `supabase/tests/gamification-catalog.test.ts` (compara com `private`)

**Interfaces:**
- Consumes: Task 4.
- Produces (SQL): `close_nutrition_weeks(p_user uuid) → void` (streak `nutrition_week`, escudos, semana neutra); `close_all_nutrition_days() → integer`; `get_nutrition_days(p_from date, p_to date) → jsonb {target, days: [...]}` (RPC, `volatile`, máx. 62 dias, `invalid_range`); `achievement_catalog.private boolean`, métricas `nutrition_logged_days`, `nutrition_on_target_days`, `nutrition_week_targets`, `nutrition_best_streak`, `protein_best_run`; as 10 conquistas da spec §6.4 com `sort` 300 a 390; `achievement_stats` (a partir da versão de 0004:645) com as métricas novas, sem dias `imported`. `close_nutrition_days` chama `close_nutrition_weeks` no fim.
- Produces (TS): `Metric` e `AchievementCode` com os novos; `Achievement.private?: boolean`; `ACHIEVEMENTS` com as 10 novas `private: true`; `NUTRITION_METRICS`.

- [ ] **Step 1: Testes que falham** (`nutrition-week.test.ts`):
  - `it('counts a week once all seven days are closed')`: a semana 05–11/10 só entra no streak na terça 13/10.
  - `it('builds the streak and gives shields every 4 weeks')`.
  - `it('makes a week with a day off neutral')`: semana com pilar desligado um dia e meta batida → +1; sem meta → streak e escudos iguais.
  - `it('treats the activation week as neutral')`.
  - `it('unlocks private nutrition badges')`: 10 dias no alvo → `nutrition_days_10`; 7 dias seguidos com proteína → `protein_7`; `achievement_catalog.private` true para todas as 10.
  - `it('returns closed days and the target in force')`: `get_nutrition_days('2026-10-01','2026-10-10')` como A; intervalo > 62 → `invalid_range`; B não vê dias de A.
  - `it('closes everyone with an open period in the safety net')`: `close_all_nutrition_days()` = número de pessoas com período.
  - `gamification-catalog.test.ts`: o espelho TS agora compara também `private`.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** migration `0011` (o `check` de `metric` é recriado com as métricas antigas e novas). `0013` no molde de `0005_social_cron.sql`, job `close-nutrition-days` `'30 6 * * *'`.
- [ ] **Step 4:** `achievements.ts`; `npx vitest run supabase/tests src/features/gamification` → PASS.
- [ ] **Step 5:** `npm run typecheck && npm test && npm run build`.
- [ ] **Step 6: Commit** `feat(nutrition): weekly streak, badges and day history`.

### Task 6: Banco: progresso, radar e privacidade para amigos

**Files:**
- Create: `supabase/migrations/0012_nutrition_progress.sql`
- Modify: `src/features/gamification/types.ts` (`WeekProgress.pillars`, `Progress.nutrition`, `Progress.radar`), `src/features/social/FriendsPanel.tsx:162` (denominador sem `private`)
- Test: `supabase/tests/nutrition-progress.test.ts`; `supabase/tests/gamification-progress.test.ts` (continua verde); `src/features/social/FriendsPanel.test.tsx`

**Interfaces:**
- Consumes: Tasks 1 a 5.
- Produces (SQL): `progress_card(uuid)` (mesma assinatura; `week.max`, `week.pillars {strength, nutrition, bonus}`, conquistas sem `private`); `my_progress_extras(p_user uuid) → jsonb {achievements, nutrition, radar}` (interna, `stable`); `get_my_progress()` fecha dias (`close_nutrition_days`) depois de congelar os dois T e devolve `progress_card || my_progress_extras || {today, stats, week+weighed_today}`; `pillar_consistency(p_user uuid, p_pillar pillar, p_offset int) → numeric` (interna; 0 = últimas 4 fechadas, 1 = as 4 anteriores; nulo sem semana ativa).
- Produces (TS):
  ```ts
  type PillarKey = 'strength' | 'nutrition' | 'sleep' | 'habits'
  type WeekProgress = { ...; pillars: { strength: number; nutrition: number; bonus: number } }
  type NutritionProgress = {
    target: number; on_target: number; logged: number
    streak: { current: number; best: number; shields: number }
    confirms_on: string
    last_closed: { day: string; logged: boolean; on_target: boolean; balanced: boolean; xp: number } | null
    last_week: { start: string; target_hit: boolean } | null
  }
  type RadarPoint = { current: number | null; previous: number | null }
  type Progress = { ...; nutrition?: NutritionProgress; radar: Partial<Record<PillarKey, RadarPoint>> }
  ```

- [ ] **Step 1: Testes que falham** (`nutrition-progress.test.ts`):
  - `it('sets the week max by active pillars')`: só Força → 960; com período tocando a semana → 1920.
  - `it('splits the week XP by pillar and bonus')`.
  - `it('hides private badges and nutrition from friends')`: A com `nutrition_days_10`; B amigo; `get_friends()` como B → o cartão de A não tem o código, nem `nutrition`, nem `radar`; `progress_card(A)` idem; `get_my_progress()` de A tem os três.
  - `it('reports the last closed day and week')`.
  - `it('computes the radar over closed weeks')`: Força com 2 semanas desde a criação e 960 + 480 → `current = 0.75`; Nutrição com uma semana parcialmente ativa e 480 → 0.5; sem semana ativa → `null`; `previous` na janela anterior.
  - `it('keeps a single progress_card closed to clients')`: `count(*) from pg_proc where proname = 'progress_card'` = 1; `asUser(A, select progress_card(B))` → `permission denied`.
  - `gamification-progress.test.ts` continua passando sem edição (as chaves de topo de `progress_card` não mudam).
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** migration, tipos TS, `FriendsPanel` (`ACHIEVEMENTS.filter(a => !a.private).length`, com teste).
- [ ] **Step 4:** `npx vitest run supabase/tests src/features/social src/features/gamification` → PASS; `npm run typecheck && npm test && npm run build`.
- [ ] **Step 5: Commit** `feat(nutrition): progress card, radar and friend privacy`.

> **Revisão (controlador):** depois da Task 6, revisor de código sobre as Tasks 4 a 6.

### Task 7: Cliente: regras puras (meta, classificação, porção, XP)

**Files:**
- Create: `src/features/nutrition/types.ts`, `targets.ts`, `classify.ts`, `portion.ts` e os `*.test.ts`
- Modify: `src/features/gamification/xp.ts` (+ regras do pilar), `src/features/gamification/xp.test.ts`
- Test: `src/features/nutrition/nutrition-parity.test.ts` (lê `supabase/tests/fixtures/nutrition-scenarios.json`)

**Interfaces:**
- Produces:
  ```ts
  // types.ts
  type Meal = 'breakfast' | 'lunch' | 'dinner' | 'snack'
  type Source = 'taco' | 'off' | 'custom' | 'quick' | 'import'
  type Macros = { kcal: number; protein_g: number; carbs_g: number; fat_g: number }
  type DayTotals = Macros & { meals: number }
  type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active'
  type Pace = 'gentle' | 'standard'
  type FoodLog = Macros & { id: string; day: string; meal: Meal; name: string; brand: string | null;
    source: Source; source_id: string | null; grams: number | null; fiber_g: number | null; updated_at: string }
  type Per100 = { kcal: number; protein: number; carbs: number; fat: number; fiber?: number | null }
  type FoodItem = { source: 'taco' | 'off' | 'custom'; source_id: string | null; name: string; brand: string | null;
    per100: Per100; serving_g: number | null; serving_label: string | null; barcode: string | null }
  type UserFood = FoodItem & { id: string; favorite: boolean; updated_at: string }
  type NutritionTarget = Macros & { valid_from: string; mode: 'auto' | 'manual' }
  type NutritionDay = DayTotals & { day: string; target: Macros | null; logged: boolean; on_target: boolean; balanced: boolean; imported: boolean }
  type DayClass = { logged: boolean; on_target: boolean; balanced: boolean }
  // targets.ts
  type TargetInput = { birth_date: string; sex: 'male' | 'female' | 'other'; height_cm: number; weight_kg: number;
    goal: 'hypertrophy' | 'strength' | 'fat_loss' | 'conditioning'; activity_level: ActivityLevel; pace: Pace }
  const PAL: Record<ActivityLevel, number>
  const LIMITS: { kcal: [1000, 6000]; protein_g: [20, 400]; carbs_g: [0, 900]; fat_g: [20, 300] }
  function missingTargetInput(p: Partial<Profile>): (keyof TargetInput)[]
  function bmr(i: TargetInput, today: string): number
  function computeTarget(i: TargetInput, today: string): Macros & { bmr: number; tdee: number; adjust: number }
  function macroGap(m: Macros): number            // |4P + 4C + 9G − kcal| / kcal
  function fitCarbs(m: Macros): Macros            // "ajustar carboidrato"
  // classify.ts
  function classifyDay(t: DayTotals, target: Macros): DayClass
  function dayTotals(logs: FoodLog[]): DayTotals
  // portion.ts
  function portion(per100: Per100, grams: number): Macros & { fiber_g: number | null }   // 1 casa
  // gamification/xp.ts
  type NutritionReason = 'nutrition_day' | 'nutrition_day_extra' | 'nutrition_week_target' | 'nutrition_balanced' | 'nutrition_logged'
  function nutritionWeekAwards(days: { on: string; classes: DayClass }[], target: number): { reason: NutritionReason; amount: number; week: string }[]
  ```
- [ ] **Step 1: Testes que falham.** `targets.test.ts`: o exemplo da spec (3010/160/404/84, `bmr` 1767,5, `tdee` 2740); feminino, `other` (−78); piso `max(TMB, 1200)`; gordura no mínimo 0,6 g/kg; 400 kg → proteína 400, kcal ≤ 6000, carboidrato recalculado; idade calculada no dia (aniversário amanhã conta um ano a menos); `missingTargetInput` lista `goal` nulo. `classify.test.ts` e `nutrition-parity.test.ts` com `it.each` da fixture. `portion.test.ts`: 150 g de 130 kcal/100 g = 195. `xp.test.ts`: casos `weeks` da fixture.
- [ ] **Step 2:** `npx vitest run src/features/nutrition src/features/gamification/xp.test.ts` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** PASS; `npm run typecheck && npm test && npm run build`.
- [ ] **Step 5: Commit** `feat(nutrition): client rules for targets, days and XP`.

### Task 8: Cliente: API, fila offline, store e peso

**Files:**
- Create: `src/features/nutrition/nutrition-api.ts`, `outbox.ts`, `useNutrition.ts`, `weigh-in.ts`, `test-nutrition.ts` e testes
- Modify: `src/App.jsx` (bind/reset como `useSocial`, linhas 150 e 164), `src/sheets.jsx:250` (`void onWeighIn(n)` depois do `emit`), `src/main.jsx` se o `SIGNED_OUT` limpa filas lá (conferir `clearEventQueue`)
- Test: `nutrition-api.test.ts`, `outbox.test.ts`, `useNutrition.test.ts`, `weigh-in.test.ts`

**Interfaces:**
- Consumes: Task 7 tipos; `supabase` de `@/lib/supabase`; `useProfile` (`save`); `useProgress.getState().refresh()`; `todayISO` de `lib/format.js`.
- Produces:
  ```ts
  // nutrition-api.ts
  function fetchLogs(from: string, to: string): Promise<FoodLog[]>
  function upsertLog(log: FoodLog): Promise<void>; function deleteLog(id: string): Promise<void>
  function fetchFoods(): Promise<UserFood[]>; function upsertFood(f: UserFood): Promise<void>; function deleteFood(id: string): Promise<void>
  function fetchTargets(): Promise<NutritionTarget[]>; function insertTarget(t: NutritionTarget): Promise<void>
  function fetchDays(from: string, to: string): Promise<{ target: NutritionTarget | null; days: NutritionDay[] }>
  type NutritionErrorCode = 'day_closed' | 'too_many_items' | 'network'
  function toNutritionError(e: unknown): NutritionErrorCode
  // outbox.ts  (localStorage 'perf_food_outbox_v1', por usuário)
  type OutboxOp = { kind: 'log' | 'food'; op: 'upsert' | 'delete'; id: string; row?: FoodLog | UserFood }
  function enqueue(userId: string, op: OutboxOp): void          // substitui op anterior do mesmo id
  function flushOutbox(userId: string): Promise<{ sent: number; left: number; dropped: number }>
  function clearOutbox(): void
  // useNutrition.ts
  type NutritionStore = {
    userId: string | null; status: 'idle' | 'loading' | 'ready' | 'error'; stale: boolean
    logs: Record<string, FoodLog[]>            // por dia, hoje e os últimos 14
    foods: UserFood[]; targets: NutritionTarget[]; closed: NutritionDay[]
    droppedNotice: boolean
    bind(userId: string): Promise<void>; refresh(): Promise<void>; reset(): void
    addLog(l: Omit<FoodLog, 'id' | 'updated_at'>): FoodLog
    updateLog(id: string, patch: Partial<FoodLog>): void; removeLog(id: string): FoodLog | undefined; restoreLog(l: FoodLog): void
    copyMeal(fromDay: string, fromMeal: Meal, toDay: string, toMeal: Meal): number
    copyDay(fromDay: string, toDay: string): number
    saveFood(f: Omit<UserFood, 'id' | 'updated_at'>): UserFood; toggleFavorite(item: FoodItem): void
    setTarget(t: Omit<NutritionTarget, 'valid_from'>, validFrom: string): Promise<void>
    targetOn(day: string): NutritionTarget | null
    recents(): FoodItem[]                       // 50 distintos, mais recentes primeiro
  }
  // weigh-in.ts
  function onWeighIn(weight: number, unit: 'kg' | 'lb'): Promise<void>
  ```
- [ ] **Step 1: Testes que falham** (Supabase mockado como `social-api.test.ts`):
  - `outbox.test.ts`: `it('sends in order and drops what the server refuses as closed')` (3 ops, a do meio `day_closed` → `dropped: 1`, as outras enviadas); `it('keeps ops on network errors and retries later')`; `it('collapses ops on the same id')`; `it('keeps queues apart by account')`.
  - `useNutrition.test.ts`: `it('shows the saved copy at once and marks it stale')`; `it('adds items locally before the server answers')`; `it('copies a meal as new items keeping origin and nutrients')`; `it('copies a whole day')`; `it('lists 50 distinct recents, newest first')`; `it('raises the dropped notice once')`; `it('drops everything on reset')`.
  - `weigh-in.test.ts`: `it('converts lb and saves the profile weight')`; `it('writes tomorrow's automatic target when the pillar is on')`; `it('leaves a manual target alone')`.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** implementar; `App.jsx` chama `useNutrition.getState().bind(user.id)` junto do `useSocial` e `reset()` no logout; a fila tenta enviar no `bind`, no `online` e a cada `refresh`, com o backoff de `events.ts`.
- [ ] **Step 4:** PASS; `npm run typecheck && npm test && npm run build`.
- [ ] **Step 5: Commit** `feat(nutrition): diary store with offline queue`.

### Task 9: Cliente: TACO, busca local e Open Food Facts

**Files:**
- Create: `scripts/build-taco.mjs`, `scripts/data/taco-4ed.csv`, `scripts/build-taco.test.mjs` (ou `src/lib/taco-data.test.js` se o vitest não pegar `scripts/`), `src/features/nutrition/data/taco.json`, `taco.ts`, `search.ts`, `off-api.ts` e testes
- Modify: `NOTICE.md` (TACO, Open Food Facts)

**Interfaces:**
- Produces:
  ```ts
  // taco.ts
  function loadTaco(): Promise<FoodItem[]>                // import dinâmico de data/taco.json, memoizado
  // search.ts
  function normalize(s: string): string                   // sem acento, minúsculas, espaços simples
  function matches(query: string, name: string): boolean  // toda palavra da busca é prefixo de alguma palavra do nome
  type SearchSection = { key: 'recent' | 'favorite' | 'mine' | 'taco'; items: FoodItem[] }
  function searchLocal(q: string, src: { recents: FoodItem[]; foods: UserFood[]; taco: FoodItem[] }, limit = 30): SearchSection[]
  // off-api.ts
  type OffResult = { items: FoodItem[] } | { error: 'rate_limited' | 'offline' | 'failed' }
  function searchOff(q: string, signal?: AbortSignal): Promise<OffResult>   // cache por termo na sessão
  function productByCode(code: string, signal?: AbortSignal): Promise<FoodItem | null | { error: 'offline' | 'failed' }>
  function offToItem(p: unknown): FoodItem | null          // null sem kcal; kJ ÷ 4,184; strings numéricas aceitas
  ```
- [ ] **Step 1: TACO.** Baixar a planilha oficial da 4ª edição, ler os termos (Decisão 4) e registrar o resultado no commit. Converter para `scripts/data/taco-4ed.csv` (colunas: id, nome, energia kcal, proteína, carboidrato, lipídeos, fibra; "NA"/"Tr"/"*" viram vazio ou 0 conforme a legenda da tabela).
- [ ] **Step 2: Testes que falham.** Script: `it('builds ~600 items with kcal and macros')`, `it('keeps kcal close to 4P + 4C + 9F')` (tolerância de 15% ou 15 kcal, com lista de exceções documentada no script se a tabela oficial divergir). `search.test.ts`: `"feijao"` acha "Feijão, carioca, cozido"; `"arroz coz"` acha "Arroz, tipo 1, cozido"; ordem recentes → favoritos → meus → TACO; item duplicado aparece só na primeira seção. `off-api.test.ts` (fetch mockado): kJ only → kcal convertido; `nutriments` com strings `"12,5"` → 12,5; sem kcal → descartado; nome vazio → usa `product_name_pt` ou descarta; 429 → `rate_limited`; `navigator.onLine = false` → `offline` sem fetch; mesmo termo duas vezes → um fetch.
- [ ] **Step 3:** comparar endpoints (Decisão 5) e implementar.
- [ ] **Step 4:** PASS; `npm run typecheck && npm test && npm run build` (o build mostra o chunk da TACO separado).
- [ ] **Step 5: Commit** `feat(nutrition): TACO table, local search and Open Food Facts`.

> **Revisão (controlador):** depois da Task 9, revisor de código sobre as Tasks 7 a 9.

### Task 10: Telas: aba Nutrição, dia, porção, registro rápido e alimento próprio

**Files:**
- Create: `src/features/nutrition/NutritionScreen.tsx`, `NutritionInvite.tsx`, `MealCard.tsx`, `PortionSheet.tsx`, `QuickAddSheet.tsx`, `CustomFoodSheet.tsx`, `labels.ts` e testes
- Modify: `src/features/nav/TabBar.tsx` + teste, `src/App.jsx` (rota `/nutricao`), `src/features/home/HomeScreen.tsx` e `src/views/Plan.jsx` (botão Stats), `src/locales/*.js`
- Test: `NutritionScreen.test.tsx`, `PortionSheet.test.tsx`, `QuickAddSheet.test.tsx`, `CustomFoodSheet.test.tsx`, `TabBar.test.tsx`

**Interfaces:**
- Consumes: `useNutrition` (Task 8), `portion`, `classifyDay`, `dayTotals` (Task 7), `useProfile`, `useProgress`.
- Produces: `NutritionScreen` (default export, rota `/nutricao`); `PortionSheet({ item, meal, day, log?, open, onOpenChange })`; `QuickAddSheet({ meal, day, open, onOpenChange })`; `CustomFoodSheet({ barcode?, open, onOpenChange, onSaved(food: UserFood) })`; `labels.ts`: `MEAL_LABEL`, `ACTIVITY_LABEL`, `fmtKcal`, `fmtGrams`, `weekdayName(iso)`.
- Nota: `FoodSearchSheet` chega na Task 11; aqui o "+" da refeição abre um placeholder controlado por prop (`onAdd(meal)`), que a Task 11 liga.

- [ ] **Step 1: Testes que falham.**
  - `TabBar.test.tsx`: botões `['Home', 'Plan', 'Start', 'Nutrition', 'Social']`; `/stats` acende Plano; `/nutricao` acende Nutrição.
  - `NutritionScreen.test.tsx`: pilar desligado → `NutritionInvite` com "Ativar"; ligado → anel com consumido/meta/restante, três barras com rótulo e valor, quatro refeições com total; Hoje/Ontem troca o dia; apagar item mostra toast com Desfazer que restaura; offline mostra a linha discreta; estado vazio da refeição com "Adicionar".
  - `PortionSheet.test.tsx`: atalhos 50/100/150/200 g; porção do rótulo quando existe; totais ao vivo; estrela chama `toggleFavorite`; editar item existente salva por `updateLog`.
  - `QuickAddSheet.test.tsx`: só kcal obrigatório; macros opcionais; `source = 'quick'`.
  - `CustomFoodSheet.test.tsx`: valida limites por 100 g (kcal ≤ 900, macros ≤ 100); código de barras opcional (8 a 14 dígitos).
  - HomeScreen e Plan: botão Stats leva a `/stats`.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** implementar; strings novas nos 16 packs e humanizer.
- [ ] **Step 4:** `node scripts/check-locales.mjs && node scripts/check-source-strings.mjs --strict`; `npm run typecheck && npm test && npm run build`.
- [ ] **Step 5: Commit** `feat(nutrition): nutrition tab with the day, portions and quick add`.

### Task 11: Telas: busca, código de barras, favoritos e cópia

**Files:**
- Create: `src/features/nutrition/FoodSearchSheet.tsx`, `BarcodeScanner.tsx`, `barcode.ts`, `CopyFromSheet.tsx` e testes
- Modify: `src/lib/scan-web.js` (decodificador de código de barras além do QR, sem mudar o check-in), `NutritionScreen.tsx` (liga busca e cópia), `MealCard.tsx` ("Copiar de…", "Repetir hoje"), `package.json` (`@zxing/library`), `NOTICE.md`, `src/locales/*.js`

**Interfaces:**
- Consumes: Tasks 8 a 10; `CameraScan.jsx` como base visual; ML Kit via `lib/scan.js` no app nativo.
- Produces:
  ```ts
  // barcode.ts
  const BARCODE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'] as const
  function decodeBarcode(source: CanvasImageSource): Promise<string | null>   // BarcodeDetector → ZXing
  function lookupBarcode(code: string, foods: UserFood[]): Promise<{ item: FoodItem } | { notFound: true } | { error: 'offline' | 'failed' }>
  function isBarcode(s: string): boolean                                       // 8 a 14 dígitos
  ```
  `FoodSearchSheet({ day, meal, open, onOpenChange })`, `BarcodeScanner({ open, onOpenChange, onCode(code: string) })`, `CopyFromSheet({ day, meal | 'all', open, onOpenChange })`.
- [ ] **Step 1: Testes que falham.**
  - `barcode.test.ts`: sem `BarcodeDetector` usa ZXing (mockado); `lookupBarcode` acha primeiro em `user_foods`, depois OFF; não achou → `notFound`; offline sem alimento próprio → `offline`.
  - `FoodSearchSheet.test.tsx`: seções na ordem com títulos; OFF só com ≥ 3 letras e depois de 600 ms (timers falsos); 429 mostra a mensagem e mantém os locais; offline mostra "Busca online indisponível sem conexão"; atribuição "Dados: Open Food Facts" e "Fonte: TACO"; tocar num item abre a porção; rodapé com "Registro rápido" e "Criar alimento".
  - `BarcodeScanner.test.tsx`: câmera negada → mensagem e "Digitar código"; código digitado inválido é recusado; código válido chama `onCode`.
  - `CopyFromSheet.test.tsx`: lista os últimos 30 dias com itens e total; copiar refeição e dia inteiro chamam a store e fecham com toast "N itens copiados".
  - `MealCard`: "Repetir hoje" num item de ontem cria item hoje.
  - Fluxo: código não encontrado → `CustomFoodSheet` com o código preenchido.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** implementar; strings nos 16 packs.
- [ ] **Step 4:** locale scripts; `npm run typecheck && npm test && npm run build`.
- [ ] **Step 5: Commit** `feat(nutrition): food search, barcode scanner, favorites and copy`.

### Task 12: Ativação, Home e celebrações

**Files:**
- Create: `src/features/nutrition/NutritionSetup.tsx`, `HomeNutritionCard.tsx` e testes
- Modify: `src/features/profile/ProfileScreen.tsx` (seção Nutrição), `src/features/home/HomeScreen.tsx`, `src/features/home/ProgressHero.tsx` (barra segmentada), `src/features/gamification/celebrations.ts`, `types.ts` (`Celebration`), `CelebrationHost.tsx`, `achievement-labels.ts` (10 conquistas), `src/locales/*.js`
- Test: `NutritionSetup.test.tsx`, `HomeNutritionCard.test.tsx`, `ProgressHero.test.tsx`, `celebrations.test.ts`, `CelebrationHost.test.tsx`, `achievement-labels.test.ts`

**Interfaces:**
- Consumes: `computeTarget`, `missingTargetInput`, `macroGap`, `fitCarbs` (Task 7); `useNutrition.setTarget`; `useProfile.save`; `Progress.nutrition` (Task 6).
- Produces:
  ```ts
  type Celebration = { kind: 'level'; level: number } | { kind: 'achievement'; code: string }
    | { kind: 'pillar_level'; pillar: PillarKey; level: number } | { kind: 'week_target'; pillar: 'nutrition'; week_start: string }
  type SeenMarker = { level: number; codes: string[]; pillarLevels?: Partial<Record<PillarKey, number>>; weekTargets?: Partial<Record<PillarKey, string>> }
  function completeMarker(seen: SeenMarker, p: Progress): SeenMarker      // preenche o que falta sem celebrar
  function dayResultToast(p: Progress, lastShown: string | null): { text: string; day: string } | null
  ```
  `NutritionSetup({ open, onOpenChange })`, `HomeNutritionCard()`.
- [ ] **Step 1: Testes que falham.**
  - `NutritionSetup.test.tsx`: perfil sem objetivo → pede objetivo antes do passo 1; passo 1 lista os 5 níveis com descrição e mostra ritmo só para `fat_loss`/`hypertrophy`; passo 2 mostra a conta em uma linha e a meta; "Ajustar manualmente" com aviso de 5% e "Ajustar carboidrato"; concluir liga o pilar (`useProfile.save({ nutrition_enabled: true, activity_level, nutrition_pace })`) e grava a primeira meta com `valid_from = hoje`; editar depois grava para amanhã; dias no alvo 3 a 7.
  - `HomeNutritionCard.test.tsx`: anel compacto, kcal restantes, "Registrar"; prévia "No alvo até agora, confirma na <dia>"; pilar desligado → convite dispensável que não volta (`perf_nutrition_invite_dismissed_v1`).
  - `ProgressHero.test.tsx`: barra com segmentos Força, Nutrição e Bônus com rótulo; `max` de 1920 com dois pilares.
  - `celebrations.test.ts`: `pillar_level` quando o nível do pilar sobe; `week_target` quando `last_week.target_hit` e `start` novo; marcador antigo sem `pillarLevels` → completado sem celebrar.
  - `CelebrationHost.test.tsx`: toast "Sábado no alvo, +120 XP" uma vez; primeiro carregamento só grava.
  - `achievement-labels.test.ts`: as 10 novas têm título e descrição.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** implementar; strings nos 16 packs; humanizer.
- [ ] **Step 4:** locale scripts; `npm run typecheck && npm test && npm run build`.
- [ ] **Step 5: Commit** `feat(nutrition): activation, home card and nutrition celebrations`.

> **Revisão (controlador):** depois da Task 12, revisor de código sobre as Tasks 10 a 12.

### Task 13: Radar de pilares na Home

**Files:**
- Create: `src/components/ui/chart.tsx`, `src/features/home/PillarRadar.tsx`, `PillarRadar.test.tsx`
- Modify: `package.json` (`recharts@^3`), `src/features/home/HomeScreen.tsx` (radar lazy abaixo do cartão de nível), `src/locales/*.js`

**Interfaces:**
- Consumes: `Progress.radar`, `useProfile` (`nutrition_enabled`), tokens `--pillar-*`.
- Produces: `PillarRadar({ radar, enabled: Partial<Record<PillarKey, boolean>>, released: PillarKey[] })` e `radarDescription(...) → string`. `released = ['strength', 'nutrition']` nesta fase.
- [ ] **Step 1: Testes que falham** (`PillarRadar.test.tsx`; Recharts mockado para um SVG simples em happy-dom se não renderizar):
  - `it('describes the chart in text')`: "Força 82%, Nutrição 64%, Sono em breve, Hábitos em breve".
  - `it('marks a pillar that is off as locked and opens activation')`.
  - `it('shows a pillar without active weeks at the center with its state')`.
  - `it('draws the previous four weeks behind')` (duas séries).
  - `it('opens the detail sheet with both windows')`.
  - HomeScreen: skeleton do mesmo tamanho enquanto o chunk carrega.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** `chart.tsx` (Decisão 7); radar com grade circular e pontos, `tick` customizado, cores pelo `ChartConfig`, forma em 2 px com preenchimento translúcido do acento, `prefers-reduced-motion` desliga a animação; strings nos 16 packs.
- [ ] **Step 4:** locale scripts; `npm run typecheck && npm test && npm run build` (radar em chunk próprio).
- [ ] **Step 5: Commit** `feat(home): pillar radar`.

### Task 14: Privacidade, offline, documentação e verificação final

**Files:**
- Modify: `public/privacidade.html` (seção do pilar e nova data), `src/lib/privacy-page.test.js`, `public/sw.js` (se os chunks sob demanda não entrarem no cache), `NOTICE.md` (Recharts, ZXing, TACO, OFF), `docs/SETUP.md` (cron `close-nutrition-days`), `docs/ROADMAP.md` (2a concluída), spec (decisões que o plano fechou)

- [ ] **Step 1: Teste que falha.** `privacy-page.test.js`: a página cita o pilar Nutrição, Open Food Facts e a nova data de atualização, em pt-BR e en; sem travessão como pausa.
- [ ] **Step 2: Offline.** `npm run build && npx vite preview`; no navegador (Playwright com o Chromium do ambiente): abrir `/nutricao`, buscar "arroz" (carrega a TACO), abrir a Home (carrega o radar), ficar offline, recarregar, buscar "feijao" e ver resultados da TACO e o radar. Se falhar, ajustar `sw.js` para guardar os chunks em runtime (network-first já existente em `/assets/`) e repetir.
- [ ] **Step 3:** atualizar `privacidade.html` (humanizer, pt-BR e en), `NOTICE.md`, `SETUP.md`, `ROADMAP.md`, spec.
- [ ] **Step 4:** `node scripts/check-locales.mjs && node scripts/check-source-strings.mjs --strict && npm run typecheck && npm test && npm run build`.
- [ ] **Step 5: Commit** `docs: privacy, notices and setup for the nutrition pillar`.

> **Revisão final (controlador):** revisor do branch inteiro contra a spec.
