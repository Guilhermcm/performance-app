# Fase 1e-b, Corrida: registro, XP, feed, acompanhamento e sugestões. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a pessoa registra cada corrida no check-in ligada ao treino do dia ("Fiz como planejado" ou
"Ajustar", distância e esforço), a corrida com distância ou esforço conta como treino detalhado, o feed
mostra tipo e distância, e `/plan/corrida` mostra a semana feita contra a planejada, a evolução do volume,
marcos e uma sugestão de ajuste por vez, aplicada com um toque.

**Architecture:** uma migration (`0032_run.sql`) redefine, a partir dos corpos mais recentes,
`checkins_guard` (valida `detail.run`), `close_training_days` (detalhado com corrida), `checkin_feed_item`
e `get_checkin` (tipo e distância, nunca esforço nem blocos). No cliente, `detail.run` entra no check-in
existente (`RunCheckinForm`), o histórico de corridas da pessoa vem do próprio `checkins` (RLS), e as
regras de acompanhamento e sugestões são puras em `src/features/run/` (`progress.ts`, `suggestions.ts`,
`run-adjust.ts`). Sem tabela nova; o plano continua em `S.runPlan`.

**Tech Stack:** Postgres (Supabase) com testes em PGlite (`supabase/tests`), React 19, Zustand,
TypeScript, Tailwind v4, shadcn/ui (Drawer, ToggleGroup), recharts (chunk sob demanda), Vitest + Testing
Library. Nenhuma dependência nova.

**Spec:** `docs/superpowers/specs/2026-10-18-fase-1e-corrida-hibrido-design.md`, §7, §8, §9 a §14 no que
toca a 1e-b. Base: 1e-a no `main` (`src/features/run/`). Regras: `CLAUDE.md`.

## Global Constraints

- Branch `main-f7pdmv`. Commit ao fim de cada tarefa; o controlador faz o push.
- Migration nova `supabase/migrations/0032_run.sql`; release `supabase/release/0032_run.sql` gerado por `node scripts/build-release-sql.mjs`; ela roda em produção **antes** do merge (spec §14). Nenhuma migration antiga muda.
- Funções redefinidas partem do corpo mais recente: `checkins_guard` e `checkin_feed_item` de `0020_checkin_feed.sql`, `close_training_days` de `0019_training_days.sql`, `get_checkin` de `0018_checkin_social.sql`; cada uma com linha em `supabase/tests/function-bodies.test.ts`. `revoke`/`grant` iguais aos originais.
- `detail.run` (spec §7.1, com a Decisão 1): `{ planned?: { week, session, type, blocks }, distance_km?, rpe?, blocks?, status }`; `distance_km` número de 0,1 a 100 com no máximo duas casas; `rpe` inteiro de 1 a 10; `blocks` e `planned.blocks` com até 12 itens no formato de treino da spec §5.2; `status` `as_planned` | `adjusted` | `unplanned`; `run` só com `activity = 'run'`. Recusa: `invalid_run_detail` (P0001).
- Detalhado (spec §7.2): check-in do dia com `detail.entries` não vazio **ou** `detail.run` com `distance_km` ou `rpe`. `award_xp` não muda: `training_detailed` 30 XP, no máximo 3 por semana somando musculação e corrida; teto semanal 960.
- Para outras pessoas, um check-in de corrida mostra só `run_type` (o `planned.type`, ou nulo) e `distance_km`; nunca `rpe`, blocos nem o plano (spec §7.2, §10). A dona vê o `detail` inteiro em `get_checkin`, como hoje.
- Feito (spec §8.1): um treino planejado conta como feito com um check-in de corrida ligado a ele (`planned.session` e `planned.week`) ou, sem ligação, um check-in de corrida no mesmo dia.
- Sugestões (spec §8.2), nesta prioridade: prova passou; semana fraca (menos da metade feita na semana anterior); esforço alto (duas semanas seguidas com 2 ou mais Leve ou Longão com `rpe ≥ 8`); mais rápido (corrida com `distance_km ≥ 3`, `rpe ≥ 8` e VDOT maior que o do plano). "Agora não" grava a chave em `dismissed` com a data. Sem sugestão de avançar semana.
- Texto público (CLAUDE.md): sem travessão nem hífen como pausa; humanizer (`anthropic-skills:humanizer` em pt-BR); toda chave nova nos 16 packs de `src/locales/` (pt-BR em `PT_BR_OVERRIDES`) na tarefa que a cria; contagens com `tn()`; os dois scripts de locale passam.
- UX: mobile-first, alvos ≥ 44 px, Drawer, números em Geist Mono tabular, `prefers-reduced-motion`, nada só por cor; números decimais com vírgula pelo `dateLocale()`.
- Gráfico (spec §8.1): pela skill `dataviz`, cores validadas com o validador dela em claro e escuro, descrição em texto e "Ver como tabela"; recharts em chunk sob demanda, como `src/features/sleep/SleepDurationChart.tsx`.
- Código novo em TypeScript; legado JS só onde a tarefa manda, com teste. TDD com RED registrado no relatório. Gate: `npm run typecheck && npm test && npm run build && node scripts/check-locales.mjs && node scripts/check-source-strings.mjs --strict`.
- Commits `type: summary` em inglês, terminando com o trailer:

```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MXwnuXUfK4Tkf7d2QS2Nx6
```

## Review Focus

1. **Cliente antigo e outras atividades:** um check-in sem `detail`, de musculação com `entries`, ou de outra atividade continua aceito e contado como hoje; `detail.run` num check-in de musculação é recusado; o cliente atual nunca quebra ao ler um check-in de corrida sem `entries` (Task 1 e Task 3).
2. **Distância digitada:** "6,25", "6.2", "0,05", "100,5", "6,255", "abc" e vazio; o formulário aceita os válidos, mostra o motivo nos outros e nunca envia algo que o banco recusa (Task 4).
3. **Ontem e treino já registrado:** com "Foi ontem?" ligado, o check-in liga ao treino de ontem; dois check-ins de corrida no mesmo dia contam um treino só; um check-in feito offline conta quando sobe (Task 4 e Task 5).
4. **Nada privado vaza:** feed, feed de desafio e `get_checkin` de amigo nunca trazem `rpe`, blocos nem `planned` (Task 1).
5. **Plano sem histórico:** plano novo, plano `maintain`, semana 1 ou semanas de manutenção antes da prova: acompanhamento com zeros, gráfico vazio com texto, nenhuma sugestão falsa (Task 5, Task 6 e Task 7).

## Decisões do plano

1. **Blocos no formato do treino.** `detail.run.blocks` e `planned.blocks` usam o mesmo formato dos treinos
   do plano (spec §5.2: até 12 itens; item `{ zone, min }` ou `{ repeat: 2..20, blocks: [{ zone, min }] }` com
   até 4 blocos). A spec §7.1 dizia `[{ zone, min }]`, mas um Intervalado `6 × 3` aberto passaria de 12.
   "Ajustar" muda zona, minutos e o número de repetições; não acrescenta nem tira itens. A spec ganha essa
   nota na Task 7.
2. **Consistência do `status`.** `unplanned` sem `planned`; `as_planned` com `planned` e sem `blocks`;
   `adjusted` com `planned` e `blocks`. `planned.week` inteiro de 1 a 64; `planned.session` no formato
   `w{n}-s{k}` (até 16 caracteres); `planned.type` um dos tipos de treino. Chaves desconhecidas recusam.
3. **Quando o cliente manda `run`.** Só com treino ligado, distância ou esforço. Uma corrida fora do plano
   sem distância nem esforço vai com `detail` nulo, como hoje.
4. **Onde a regra vale no banco.** A validação de `detail.run` roda para os papéis de cliente, no insert e no
   update, no mesmo lugar das outras regras do `checkins_guard`; o dono do banco passa, como hoje. Duas
   funções auxiliares imutáveis, `valid_run_items(jsonb)` e `valid_run_detail(jsonb, text)`, sem acesso para
   `public`, `anon` e `authenticated`.
5. **Feed.** O item do feed vem de `checkin_feed_item` (usado pelo feed e pelo feed de desafio): ele ganha
   `run_type` e `distance_km`, nulos fora de corrida. `get_checkin` ganha as mesmas duas chaves. O cartão
   mostra "Intervalado · 6,2 km · 38 min" (tipo, distância e duração, cada um quando houver) no lugar da
   linha de duração de um check-in de corrida.
6. **Fixture compartilhada.** `supabase/tests/fixtures/run-details.json` lista casos de `detail.run`
   (válidos e inválidos, com a atividade). O teste SQL e o validador do cliente (`checkRunDetail`) passam
   pelos mesmos casos, como `training-scenarios.json` faz com o XP.
7. **Histórico de corridas.** O cliente lê os próprios check-ins de corrida desde o início do plano direto
   da tabela (RLS: só os da pessoa), uma vez por abertura de `/plan/corrida` e de `/plan`, e junta com os do
   aparelho que ainda não subiram (`useCheckins.mine`). Sem conexão, usa só os do aparelho.
8. **Semana do treino feito.** Cada check-in conta só na semana do calendário em que caiu (pelo
   `weekStart` do plano). Primeiro casam os ligados (mesma semana do plano e mesmo `session`), depois os sem
   ligação pelo dia; cada check-in casa com um treino no máximo. Num plano `maintain`, as semanas repetem os
   ids e o casamento pela data resolve.
9. **Repetir e voltar semana.** "Repetir a semana" (semana fraca) e "Voltar uma semana" (esforço alto) fazem
   a mesma coisa: a semana atual passa a ter os treinos da semana anterior, reencaixados nos dias que
   restam. Com `raceDate`, a semana anterior entra como semana nova na posição atual e a primeira semana de
   base à frente sai, para a prova continuar na última semana; sem base à frente, o cartão avisa que o prazo
   ficou apertado e "Aplicar" troca a semana atual pela anterior sem inserir e passa a meta para completar
   (`goalType: 'finish'`, sem `targetTime`). Sem `raceDate`, a semana entra e o plano fica uma semana maior,
   até 64 semanas (na 64ª, troca sem inserir). As semanas seguintes ganham índice e ids novos; as
   anteriores não mudam. Planos `maintain` e semanas de manutenção (fase `maintain`) não recebem as regras 2
   e 3.
10. **Prova passou.** O cartão pede o tempo da prova (`h:mm:ss`, com `parseClock` de `clock.ts`); com ele, o
    plano guarda `raceResult: { minutes }`, atualiza o VDOT (`vdotSource: 'race'`, `vdotDate` = dia da prova)
    e oferece "Escolher a próxima meta", que abre o questionário.
11. **Chaves das sugestões.** `race:{raceDate}`, `weak:{índice da semana}`, `effort:{índice da semana}`,
    `faster:{id do check-in}`. A chave muda com a condição, então uma chave guardada em `dismissed` não volta.

## Estrutura de arquivos

```
supabase/migrations/0032_run.sql        validações, close_training_days, checkin_feed_item, get_checkin
supabase/tests/run-checkins.test.ts     detail.run, detalhado, limite, teto, feed e get_checkin
supabase/tests/fixtures/run-details.json casos de detail.run (SQL e cliente)
supabase/release/0032_run.sql           gerado
src/features/run/
  run-detail.ts       RunDetail, checkRunDetail, plannedOn, plannedMinutes, formatKm, parseKm, runLine
  run-log.ts          RunLog, fetch dos próprios check-ins de corrida, useRunLogs
  progress.ts         doneSessions, weekSummary, volumeSeries, milestones (puro)
  suggestions.ts      Suggestion, nextSuggestion (puro)
  run-adjust.ts       repeatPreviousWeek, updateVdot, recordRaceResult, dismissSuggestion
  RunCheckinForm.tsx  parte de corrida do check-in
  BlocksEditor.tsx    "Ajustar": zona, minutos e repetições
  RunTracking.tsx     semana feita, marcos e o gráfico em /plan/corrida
  RunProgress.tsx     gráfico de minutos por semana (chunk sob demanda) e tabela
  RunSuggestionCard.tsx  a sugestão do momento
src/features/checkin/  types.ts, CheckinFlow.tsx, EditCheckinSheet.tsx, ingest.ts, MyTrainings.tsx,
                       open-checkin.ts, useCheckins.ts, checkin-api.ts
src/features/social/   types.ts, PostCard.tsx
src/views/Plan.jsx, src/features/run/RunPlanScreen.tsx, RunDayCard.tsx, types.ts
public/privacidade.html, docs/SETUP.md, docs/ROADMAP.md, spec da 1e
```

---

### Task 1: Migration 0032 (validação, detalhado, feed)

**Files:**
- Create: `supabase/migrations/0032_run.sql`, `supabase/tests/run-checkins.test.ts`, `supabase/tests/fixtures/run-details.json`
- Modify: `supabase/tests/function-bodies.test.ts`, `supabase/tests/helpers/checkin.ts` (se precisar de `duration_min`)

**Interfaces:**
- Consumes: `addCheckin(db, uid, { activity, detail, day })` de `supabase/tests/helpers/checkin.ts`; `freshDb`, `asUser`, `makeUser`, `setClock`, `ledger` dos helpers.
- Produces: `public.valid_run_items(jsonb) returns boolean`, `public.valid_run_detail(p_run jsonb, p_activity text) returns boolean`; `checkin_feed_item` e `get_checkin` com `run_type` (texto ou nulo) e `distance_km` (número ou nulo); fixture `run-details.json` no formato `{ "cases": [{ "name", "activity", "run", "valid" }] }`.

- [ ] **Step 1: Fixture.** Pelo menos estes casos em `run-details.json`: válidos `{ status: 'unplanned', distance_km: 5 }`, `{ status: 'unplanned', rpe: 7 }`, `as_planned` com `planned` `{ week: 3, session: 'w3-s2', type: 'intervals', blocks: [{zone:'easy',min:10},{repeat:5,blocks:[{zone:'hard',min:2},{zone:'easy',min:2}]},{zone:'easy',min:5}] }` e `distance_km: 6.2`, `adjusted` com `planned` e `blocks`, `distance_km` 0.1 e 100 e 12.34; inválidos: `distance_km` 0.05, 100.01, 6.255, "6,2", `rpe` 0, 11, 7.5, "8", `status` ausente ou `'done'`, chave extra `pace`, `blocks` com 13 itens, bloco `min` 0 ou 301, zona `fast`, `repeat` 1 ou 21, repetição com 5 blocos, `as_planned` sem `planned`, `as_planned` com `blocks`, `adjusted` sem `blocks`, `unplanned` com `planned`, `planned.week` 0 ou 65, `planned.session` `'x'`, `planned.type` `'race'`, `run` não objeto, e `run` válido com `activity: 'strength'`.
- [ ] **Step 2: Testes que falham** em `run-checkins.test.ts`:
  - `it.each(cases)` posta cada caso como cliente (`addCheckin` com `detail: { run }`): válido entra, inválido recusa com `invalid_run_detail`; o mesmo no update de um check-in existente;
  - check-in sem `detail`, com `{ entries: [...] }` e de `activity: 'bike'` sem `run` continuam aceitos;
  - `close_training_days`: dia com corrida `{ status: 'unplanned', distance_km: 5 }` → `detailed: true`; com `{ status: 'unplanned' }` só → `detailed: false`; corrida só com `rpe` → `detailed: true`;
  - limite: numa semana, 2 dias detalhados de musculação e 2 de corrida → 3 linhas `training_detailed` de 30 no `ledger`; teto: a semana não passa de 960 (cenário com os eventos de Treino da semana cheia mais as corridas);
  - feed de um amigo (`get_checkin_feed`) e feed de desafio (`get_challenge_feed`): o item de corrida tem `run_type: 'intervals'` e `distance_km: 6.2` e não tem as chaves `rpe`, `blocks`, `planned` nem `detail` em nenhum nível; check-in de musculação tem `run_type` e `distance_km` nulos;
  - `get_checkin` de amigo: `run_type` e `distance_km`, sem `detail`; da dona: `detail.run` inteiro;
  - `function-bodies.test.ts`: linhas para `checkins_guard` (base 0020, in 0032), `close_training_days` (base 0019), `checkin_feed_item` (base 0020), `get_checkin` (base 0018), com `changed` listando literalmente as linhas da base que mudaram.
- [ ] **Step 3:** `npx vitest run supabase/tests/run-checkins.test.ts supabase/tests/function-bodies.test.ts` falha (funções ausentes, chaves ausentes).
- [ ] **Step 4: Implementar `0032_run.sql`.** Cabeçalho como o de `0031_trackers.sql`, dizendo o que redefine e de qual migration. `valid_run_items` e `valid_run_detail` com `language sql immutable` (ou plpgsql), cobrindo as regras da Decisão 2 e das Global Constraints; no `checkins_guard`, depois do retorno antecipado dos papéis que não são de cliente, `if new.detail ? 'run' and not public.valid_run_detail(new.detail -> 'run', new.activity) then raise exception 'invalid_run_detail' using errcode = 'P0001'; end if;` antes do bloco de insert/update. Em `close_training_days`, o `bool_or` do detalhado passa a aceitar também `jsonb_typeof(detail -> 'run' -> 'distance_km') = 'number' or jsonb_typeof(detail -> 'run' -> 'rpe') = 'number'`. Em `checkin_feed_item` e `get_checkin`: `'run_type', case when c.activity = 'run' then c.detail -> 'run' -> 'planned' ->> 'type' end` e `'distance_km', case when c.activity = 'run' then c.detail -> 'run' -> 'distance_km' end`.
- [ ] **Step 5:** os testes da Step 2 passam; `npm test` inteiro passa (paridades de Treino, `training-days`, `checkin-feed`, `release-bundle` inalterados).
- [ ] **Step 6: Commit** `feat(db): validate run check-ins, count them as detailed, show type and distance` com o trailer.

### Task 2: Release, SETUP e privacidade

**Files:**
- Modify: `scripts/build-release-sql.mjs` + `scripts/build-release-sql.test.mjs`, `supabase/tests/release-bundle.test.ts`, `docs/SETUP.md`, `public/privacidade.html` + `src/lib/privacy-page.test.js`
- Create (gerado): `supabase/release/0032_run.sql`

**Interfaces:**
- Consumes: `0032_run.sql` da Task 1.
- Produces: entrada `{ name: '0032_run', first: 32, last: 32, title: 'migration 0032 (running check-ins, phase 1e-b)', needs: '0001 to 0031' }` em `RELEASES`.

- [ ] **Step 1: Testes que falham:** `build-release-sql.test.mjs` espera o bundle `0032_run`; `release-bundle.test.ts` (no molde do `describe('release bundle 0031')`) aplica o bundle sobre um banco em 0031 e confere que as quatro funções têm os corpos novos e que um check-in de corrida inválido é recusado; `privacy-page.test.js` espera, em pt e en, o trecho de corrida: o que fica só com a pessoa (plano, meta, prazo, ritmos, esforço, blocos) e o que amigos veem (tipo de treino e distância, no check-in compartilhado).
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementar.** `node scripts/build-release-sql.mjs` gera o bundle. `SETUP.md`: roteiro "da 0031 até a 0032" no molde do da 0031 (o que muda no banco, rodar o arquivo único numa consulta, as conferências: `select proname from pg_proc where proname in ('valid_run_items','valid_run_detail')` com 2 linhas, um insert de teste recusado com `invalid_run_detail` dentro de `begin … rollback`), dizendo que roda **antes** do merge porque o cliente novo envia `detail.run`. `privacidade.html`: seção "Corrida" em pt e en, mais "o plano de corrida, o esforço e os blocos" na frase de "Ninguém vê" (pt e en), pelas regras de texto público e o humanizer.
- [ ] **Step 4:** os testes passam; gate.
- [ ] **Step 5: Commit** `docs: release bundle, setup steps and privacy notes for phase 1e-b` com o trailer.

### Task 3: `detail.run` no cliente e no feed

**Files:**
- Create: `src/features/run/run-detail.ts` + `run-detail.test.ts`
- Modify: `src/features/checkin/types.ts`, `ingest.ts`, `MyTrainings.tsx`, `EditCheckinSheet.tsx`, `CheckinFlow.tsx` (só o tipo), `useCheckins.ts` (`ownItem`, `withRow`), `src/features/social/types.ts`, `PostCard.tsx`, `src/locales/*.js`, testes ao lado

**Interfaces:**
- Consumes: `Item`, `SessionType`, `RunPlan`, `Session`, `Week` de `types.ts`; `sessionsOn`, `currentWeek`, `planWeekStart` de `run-actions.ts`; `sessionName` de `labels.ts`; `weekMinutes` de `models.ts`; `dateLocale()`.
- Produces:
  - `type RunStatus = 'as_planned' | 'adjusted' | 'unplanned'`;
  - `type RunPlanned = { week: number; session: string; type: SessionType; blocks: Item[] }`;
  - `type RunDetail = { planned?: RunPlanned; distance_km?: number; rpe?: number; blocks?: Item[]; status: RunStatus }`;
  - em `checkin/types.ts`: `type StrengthDetail = { entries: …; unit?: 'kg' | 'lb' }` (o atual), `type RunCheckinDetail = { run: RunDetail }`, `type CheckinDetail = StrengthDetail | RunCheckinDetail`, `isRunDetail(d): d is RunCheckinDetail`, `entriesOf(d: CheckinDetail | null): StrengthDetail['entries']` (vazio para corrida);
  - `checkRunDetail(run: unknown, activity: string): boolean` (as mesmas regras do banco);
  - `plannedOn(plan: RunPlan | null, iso: string, weekStart: 0 | 1): RunPlanned | null` (cópia do primeiro treino do dia, com `week` = índice da semana);
  - `plannedMinutes(items: Item[]): number`;
  - `parseKm(text: string): number | null` (aceita vírgula ou ponto, 0,1 a 100, até 2 casas; senão `null`) e `formatKm(km: number): string` ("6,2" em pt-BR);
  - `runLine(p: { run_type?: SessionType | null; distance_km?: number | null; duration_min: number | null }): string` ("Intervalado · 6,2 km · 38 min");
  - `CheckinFeedItem` e `CheckinView` com `run_type?: SessionType | null` e `distance_km?: number | null`.

- [ ] **Step 1: Testes que falham:**
  - `checkRunDetail` com todos os casos de `supabase/tests/fixtures/run-details.json` (importado no teste) bate com `valid`;
  - `parseKm`: "6,25" → 6.25, "6.2" → 6.2, "0,1" → 0.1, "100" → 100; "0,05", "100,5", "6,255", "abc", "" → `null`;
  - `formatKm(6.2)` em pt-BR "6,2"; `runLine({ run_type: 'intervals', distance_km: 6.2, duration_min: 38 })` → "Intervalado · 6,2 km · 38 min"; sem tipo "6,2 km · 38 min"; só duração "38 min";
  - `plannedOn` acha o treino do dia com `weekStart` 0 e 1 e devolve `null` em dia sem treino, antes do início e com plano ilegível; `plannedMinutes` de uma repetição;
  - `entriesOf({ run: { status: 'unplanned', rpe: 5 } })` → `[]`; `MyTrainings`, `EditCheckinSheet` e `ingest` não quebram com um check-in de corrida (renderizam sem séries);
  - `PostCard` de corrida com `run_type` e `distance_km` mostra "Intervalado · 6,2 km · 38 min"; sem eles, o que mostra hoje; o post pendente (`ownItem`) já mostra a linha a partir do `detail.run` local.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementar.** Tipos e funções acima; cada `detail.entries` direto vira `entriesOf(detail)`; `DetailSheet` e `ingestCheckin` recebem `StrengthDetail`. `ownItem`/`withRow` tiram `run_type` e `distance_km` do `detail.run` da linha. Strings nos 16 packs.
- [ ] **Step 4:** gate.
- [ ] **Step 5: Commit** `feat(run): run detail type, validator and the feed line` com o trailer.

### Task 4: Parte de corrida do check-in

**Files:**
- Create: `src/features/run/RunCheckinForm.tsx` + teste, `src/features/run/BlocksEditor.tsx` + teste
- Modify: `src/features/checkin/CheckinFlow.tsx` + teste, `open-checkin.ts`, `EditCheckinSheet.tsx` + teste, `src/features/run/RunDayCard.tsx` + teste, `src/locales/*.js`

**Interfaces:**
- Consumes: Task 3 (`RunDetail`, `checkRunDetail`, `plannedOn`, `plannedMinutes`, `parseKm`, `formatKm`); `blocksInline`, `sessionName`, `zoneName` de `labels.ts`; `useStore`, `weekStartOf`.
- Produces:
  - `RunCheckinForm({ planned: RunPlanned | null; value: RunDetail | null; onChange(v: RunDetail | null): void; onPlannedMinutes?(min: number): void })` (no check-in novo, `planned` vem de `plannedOn`; na edição, do `detail.run.planned` guardado);
  - `BlocksEditor({ items: Item[]; onChange(items: Item[]): void })`;
  - `OpenCheckinOptions.activity?: CheckinActivity`.

- [ ] **Step 1: Testes que falham:**
  - check-in com atividade "Corrida" num dia com treino no plano mostra o tipo e os blocos em linha, "Fiz como planejado" e "Ajustar"; "Fiz como planejado" gera `status: 'as_planned'` com `planned` (cópia do treino, `week` = índice da semana) e preenche a duração vazia com `plannedMinutes` (sem passar de 600);
  - "Ajustar" abre o `BlocksEditor` com os blocos do treino; mudar a zona de um bloco e os minutos gera `status: 'adjusted'` com `blocks`; minutos fora de 1 a 300 e repetições fora de 2 a 20 mostram o motivo e travam "Postar";
  - sem treino no dia: o texto "Fora do plano"; com distância "5" envia `{ status: 'unplanned', distance_km: 5 }`; sem distância nem esforço envia `detail: null` (Decisão 3);
  - distância (Review Focus 2): os casos de `parseKm` no campo; inválido mostra "Distância de 0,1 a 100 km, até duas casas." e trava "Postar"; esforço 1 a 10 num `ToggleGroup` com o nome acessível "Esforço";
  - "Foi ontem?" ligado troca o treino ligado para o de ontem (Review Focus 3);
  - musculação e outras atividades continuam iguais (testes atuais de `CheckinFlow` passam sem mudança);
  - `RunDayCard` do dia de hoje tem "Registrar corrida", que chama `openCheckin({ activity: 'run' })`;
  - `EditCheckinSheet` de um check-in de corrida edita distância e esforço, mantém `planned` e `status` e salva `detail.run` válido.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementar.** `CheckinFlow` guarda `run: RunDetail | null`; com `activity === 'run'` mostra `RunCheckinForm` no lugar de "Detalhar treino" e manda `detail: { run }` só quando a Decisão 3 pede, depois de `checkRunDetail`. A atividade inicial vem de `opts.activity` quando houver. Strings nos 16 packs.
- [ ] **Step 4:** gate.
- [ ] **Step 5: Commit** `feat(run): log runs against the plan in the check-in` com o trailer.

### Task 5: Histórico de corridas e acompanhamento (puro)

**Files:**
- Create: `src/features/run/run-log.ts` + teste, `src/features/run/progress.ts` + teste
- Modify: `src/features/checkin/checkin-api.ts` + teste

**Interfaces:**
- Consumes: Task 3 (`RunDetail`); `currentWeek`, `weekDate`, `planWeekStart` de `run-actions.ts`; `weekMinutes` de `models.ts`; `addDays`, `weekdayOf` de `dates.ts`; `useCheckins` (`mine`).
- Produces:
  - `type RunLog = { id: string; day: string; duration_min: number | null; run: RunDetail | null }`;
  - `fetchMyRunCheckins(from: string): Promise<RunLog[]>` em `checkin-api.ts` (`activity = 'run'`, `day >= from`, colunas `id, day, duration_min, detail`);
  - `useRunLogs(plan: RunPlan | null): { logs: RunLog[]; status: 'idle' | 'loading' | 'ready' | 'offline' }` (Decisão 7; os do aparelho ganham dos do servidor pelo id);
  - `doneSessions(plan, weekOffset: number, logs, weekStart): Set<string>` (ids feitos naquela semana do calendário, Decisão 8; `weekOffset` conta semanas do calendário desde `startDate`, a partir de 0, e num plano que não é `maintain` vale `índice − 1`);
  - `weekSummary(plan, weekOffset, logs, weekStart): { done: number; planned: number; minutes: number; km: number }`;
  - `volumeSeries(plan, logs, weekStart, today): { index: number; planned: number; done: number }[]` (semanas até a atual);
  - `milestones(plan, logs, weekStart, today): { longestLong: number | null; maxKm: number | null; easyPace: number | null }` (`easyPace` em s/km, média dos Leve ligados com distância e duração nas últimas 4 semanas).

- [ ] **Step 1: Testes que falham:**
  - ligado conta pelo `session`; sem ligação conta pelo dia; dois check-ins no mesmo dia para um treino contam 1; um check-in de outra semana não conta (Review Focus 3);
  - plano `maintain` no segundo ciclo casa pela data; plano sem check-ins → zeros e séries com `done: 0` (Review Focus 5);
  - `weekSummary` soma minutos de `duration_min` e km de `distance_km` só dos check-ins da semana;
  - `milestones` com e sem dados; `easyPace` ignora Leve sem distância;
  - `useRunLogs` junta pendentes do aparelho e servidor por id, e sem conexão fica com os do aparelho (`status: 'offline'`).
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementar** funções puras sem React em `progress.ts`; `run-log.ts` com um store zustand pequeno e o hook.
- [ ] **Step 4:** gate.
- [ ] **Step 5: Commit** `feat(run): run history and plan progress` com o trailer.

### Task 6: Sugestões e ajustes (puro)

**Files:**
- Create: `src/features/run/suggestions.ts` + teste, `src/features/run/run-adjust.ts` + teste
- Modify: `src/features/run/types.ts` (`raceResult?: { minutes: number }` em `RunPlan`)

**Interfaces:**
- Consumes: Task 5 (`RunLog`, `weekSummary`, `doneSessions`); `vdotFrom` de `vdot.ts`; `fitWeek`, `strengthWeek`, `raceBounds` e `currentWeek` de `fit.ts`/`run-actions.ts`; distâncias das provas (`5k` 5000, `10k` 10000, `half` 21097,5).
- Produces:
  - `type Suggestion = { key: string; kind: 'race_result'; raceDate: string } | { key: string; kind: 'repeat_week'; week: number; tight: boolean } | { key: string; kind: 'step_back'; week: number; tight: boolean } | { key: string; kind: 'faster'; vdot: number; checkinId: string; day: string }`;
  - `nextSuggestion(plan: RunPlan | null, logs: RunLog[], today: string, weekStart: 0 | 1): Suggestion | null`;
  - `repeatPreviousWeek(S, today: string): void`, `updateVdot(S, vdot: number, source: 'race' | 'run', date: string): void`, `recordRaceResult(S, minutes: number): void`, `dismissSuggestion(S, key: string, today: string): void` (mutações para dentro de `update(S => …)`).

- [ ] **Step 1: Testes que falham** (`suggestions.ts`, as quatro regras, a prioridade e o "Agora não"):
  - prova passou: dia depois de `raceDate` sem `raceResult` → `race_result` com chave `race:{raceDate}`; no dia da prova, não;
  - semana fraca: semana anterior com 1 de 3 feitos → `repeat_week` (`weak:{índice}`); com 2 de 3, não; na semana 1, em semana `maintain` e em plano `maintain`, não; `tight` quando há `raceDate` e nenhuma semana `base` à frente;
  - esforço alto: duas semanas seguidas com 2 Leve ou Longão ligados com `rpe ≥ 8` → `step_back`; com uma semana só, não; Ritmo com `rpe` 9 não conta;
  - mais rápido: corrida de 5 km em 21:00 com `rpe` 8 num plano de VDOT 40 → `faster` com o VDOT dela (uma casa); com 2,9 km, `rpe` 7 ou VDOT menor, não; plano sem VDOT aceita;
  - prioridade: com prova passada e semana fraca ao mesmo tempo, vem a prova; "Agora não" (`dismissed[key]`) pula para a próxima regra; uma chave nova (outra semana) volta a aparecer;
  - `run-adjust.ts`: `repeatPreviousWeek` com `raceDate` mantém o número de semanas e a última semana com a prova, e tira a primeira base à frente; sem base, troca sem inserir e passa para `finish` sem `targetTime`; sem `raceDate`, o plano cresce uma semana, ids e índices das semanas seguintes renumerados, as anteriores iguais; com 64 semanas, troca sem inserir; a semana nova só tem treinos de hoje em diante; `S.week` e `S.routines` não mudam;
  - `recordRaceResult` guarda `raceResult` e o VDOT da prova com `vdotSource: 'race'` e `vdotDate` = `raceDate`; `updateVdot` arredonda a uma casa; `dismissSuggestion` grava `dismissed[key] = today`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementar** pela Decisão 9 a 11.
- [ ] **Step 4:** gate.
- [ ] **Step 5: Commit** `feat(run): plan suggestions and adjustments` com o trailer.

### Task 7: Telas de acompanhamento e sugestão, documentação

**Files:**
- Create: `src/features/run/RunTracking.tsx` + teste, `src/features/run/RunProgress.tsx` + teste, `src/features/run/RunSuggestionCard.tsx` + teste
- Modify: `src/features/run/RunPlanScreen.tsx` + teste, `src/views/Plan.jsx` + teste, `src/features/run/RunDayCard.tsx` + teste, `src/locales/*.js`, `docs/ROADMAP.md`, spec da 1e (status e a nota da Decisão 1)

**Interfaces:**
- Consumes: Tasks 4 a 6; `RunQuestionnaire` (abre para "Escolher a próxima meta"); `parseClock` de `clock.ts`; o padrão de `SleepDurationChart.tsx` e `SleepChartSkeleton.tsx`.
- Produces: `RunTracking({ plan; logs })`, `RunProgress({ series })` (default export, lazy), `RunSuggestionCard({ plan; logs })`.

- [ ] **Step 1: Testes que falham:**
  - `/plan/corrida` mostra "2 de 3 treinos" na semana atual, minutos e km, os marcos ("Longão mais longo", "Maior distância", "Ritmo médio nos treinos leves") e, sem dados, o texto de vazio (Review Focus 5);
  - o gráfico tem descrição em texto ("Nas últimas 6 semanas você correu 150 de 180 minutos planejados") e "Ver como tabela" mostra uma tabela com semana, planejado e feito;
  - a sugestão aparece no topo de `/plan/corrida` e de `/plan`, uma de cada vez; "Aplicar" chama a ação certa dentro de `update`; "Agora não" grava a chave e a próxima regra aparece;
  - prova passou: o campo de tempo (`h:mm:ss`) aceita "52:30" e "1:52:30", recusa "abc"; ao salvar, mostra o ritmo novo e "Escolher a próxima meta", que abre o questionário;
  - semana apertada (`tight`): o cartão diz que o prazo ficou apertado e que a meta passa a ser completar;
  - o cartão do dia em `/plan` mostra "Feito" (ícone e texto) num treino feito.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementar.** Gráfico de barras de minutos por semana com o planejado como referência, pela skill `dataviz` (carregue a skill e rode o validador de cores em claro e escuro; anote o resultado no relatório). Strings nos 16 packs. ROADMAP: 1e-b concluída no código (falta rodar a 0032 e o merge). Spec: status e a nota da Decisão 1 em §7.1 (blocos no formato da §5.2) e da Decisão 5 em §7.2 (`checkin_feed_item` e `get_checkin`).
- [ ] **Step 4:** gate.
- [ ] **Step 5: Commit** `feat(run): progress, suggestions and docs for phase 1e-b` com o trailer.

---

## Ordem e paralelismo

- Task 1 → Task 2 (o bundle sai da migration final).
- Task 3 é só cliente e pode correr junto com a Task 1 numa worktree separada (não toca em `supabase/`).
- Task 4 depende da 3. Task 5 depende da 3 e pode correr junto com a 4 (arquivos distintos; os dois mexem
  em `src/locales/`, a 5 sem texto novo). Task 6 depende da 5. Task 7 depende da 4 e da 6.
- Publicação: `supabase/release/0032_run.sql` roda em produção depois da revisão final e antes do merge.
