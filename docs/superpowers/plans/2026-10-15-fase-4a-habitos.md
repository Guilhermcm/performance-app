# Fase 4a, Hábitos. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a pessoa liga o pilar Hábitos, cria seus hábitos com meta de N vezes por semana, marca o
do dia num toque pela Home, entende a semana pelo C de Q em `/habitos`, ganha XP, streak e
conquistas privadas pelos checks que o servidor fecha em D+2, e desafia amigos em checks sem mostrar
nomes de hábitos a ninguém.

**Architecture:** cinco migrations (`0026` a `0030`) no molde do Sono: períodos do pilar, hábitos
com id do cliente, metas congeladas por hábito e semana (`habit_targets`, sem `weekly_targets`),
checks com janela hoje/ontem num trigger `security invoker`, dias fechados pelo servidor que marcam
os checks válidos e emitem eventos `server_only` pagos pelo `award_xp`, streak e conquistas próprios.
Toda função que o Sono redefiniu e os Hábitos redefinem parte do corpo mais recente, provado pelo
teste de corpo e por testes de paridade com Treino, Nutrição e Sono. No cliente,
`src/features/habits/` com regras puras espelhadas do SQL (fixture compartilhado), fila offline
sobre `src/lib/local-outbox.ts`, store por conta, cartão "Hábitos de hoje" abaixo do cartão da manhã
do Sono, tela `/habitos` com lista ordenável e o calendário da 2b.

**Tech Stack:** Postgres/PGlite + `pg_cron`, React 19, Vite, Zustand 5, TypeScript, Tailwind v4,
shadcn/ui (Drawer, Switch, Skeleton), lucide-react (já instalado), Vitest + Testing Library.
Nenhuma dependência nova.

**Spec:** `docs/superpowers/specs/2026-10-15-fase-4-habitos-trackers-design.md`, **Partes A e C**
(a Parte B, trackers, é a 4b e fica fora deste plano). Molde: plano do Sono
(`2026-10-12-fase-3-sono.md`) e o código dele (`supabase/migrations/0021` a `0025`,
`src/features/sleep/`). Regras: `CLAUDE.md`.

## Global Constraints

- Branch `main-f7pdmv`. Commit ao fim de cada tarefa; o controlador faz o push. Execução por subagentes com revisão do controlador a cada duas tarefas.
- Migrations `0026_habits_base.sql`, `0027_habits_close.sql`, `0028_habits_progress.sql`, `0029_habits_challenge.sql`, `0030_habits_cron.sql`, nessa ordem; publicação em `supabase/release/0026-0030_habits.sql`, sobre um banco com `0001` a `0025`.
- Funções redefinidas partem do corpo mais recente (conferido por grep nas migrations): `0022_sleep_close.sql` para `award_xp` e `achievement_stats`; `0023_sleep_progress.sql` para `pillar_consistency`, `progress_card`, `my_progress_extras` e `get_my_progress`; `0024_sleep_challenge.sql` para `challenge_progress`, `challenge_grace`, `close_challenge`, `create_challenge` e `join_challenge`. Cada uma ganha uma linha em `function-bodies.test.ts` e um teste de paridade de Treino, Nutrição e Sono.
- O pilar de força se chama **Treino** em todo texto e teste (chave `strength`); o pilar novo é `habits` (já existe no enum `public.pillar` desde a `0001`).
- Hábito: `name` de 1 a 40 caracteres sem espaço nas pontas; `icon` da lista fixa; `per_week` N de 1 a 7; teto de **20 ativos** (`too_many_habits`); nomes repetidos permitidos.
- Check: um por hábito por dia; criar e apagar só em hoje e ontem no fuso do perfil (`day_closed`); hábito arquivado ou de outra pessoa → `habit_archived`; dia fora de período → `pillar_off`. O dia D fecha no começo de D+2.
- Semana: Q = soma dos `target` congelados; C = soma de `min(checks, target)` por hábito; válidos são os primeiros `target` checks do hábito por dia; no alvo quando Q > 0 e C = Q.
- XP (spec §5.1), P = max(Q, 7): `habit_check` = `round(600 / P)`, e com Q ≥ 7 o Q-ésimo válido paga `600 − (Q − 1) × round(600 / Q)`; `habit_week_target` = 150 se Q ≥ 7, senão `round(150 × Q / 7)`; `habit_day` = 30 por dia com check válido. Máximo semanal **960**. Ordem dos válidos no dia: `habits.sort`, depois `habit_id`.
- `source_ref`: `habit:<habit_id>:<AAAA-MM-DD>`, `habits:<AAAA-MM-DD>`, `habits-week:<week_start>`; `reason` igual ao `kind`, com `pillar = 'habits'`.
- Privacidade: nomes, ícones, checks e metas por hábito nunca saem para outra conta (`progress_card`, `get_friends`, ranking, feed, payload de desafio). Amigos veem nível e XP do pilar e, pelo `week.max`, se ele estava ligado. Conquistas `private = true`, `sort` 500 a 590. No desafio, só a contagem de checks válidos de quem deu opt-in.
- Cron `close-habit-days` às 06:50 UTC (`'50 6 * * *'`) chamando `close_all_habit_days()`.
- Toda função nova ou com assinatura nova: `drop` da antiga se mudar; `security definer set search_path = public` (ou `security invoker` em trigger de regra do cliente); internas com `revoke all ... from public, anon, authenticated`; RPC com `revoke ... from public, anon` + `grant execute ... to authenticated`. `progress_card` continua `stable` e sem escrita. Escrita de XP trava `pg_advisory_xact_lock(hashtextextended('xp:' || user_id::text, 0))`.
- Código novo em TypeScript em `src/features/habits/`, `src/components/`, `src/lib/*.ts`; legado JS só onde a tarefa manda, com teste ao lado.
- Texto público (CLAUDE.md): sem travessão nem hífen como pausa; humanizer (`anthropic-skills:humanizer` em pt-BR, `humanizer` em inglês); toda chave nova nos 16 packs de `src/locales/` (pt-BR em `PT_BR_OVERRIDES`) na tarefa que a cria; contagens com `tn()`; nomes de hábitos são da pessoa e não se traduzem; `node scripts/check-locales.mjs` e `node scripts/check-source-strings.mjs --strict` passando.
- UX: mobile-first, alvos ≥ 44 px, Drawer, skeleton com a forma do conteúdo, estados vazio/erro/offline, `prefers-reduced-motion`, números em Geist Mono tabular, nada só por cor, "hoje" sempre por `todayIn(profile.timezone)`.
- TDD com RED registrado no relatório. Gate de cada tarefa: `npm run typecheck && npm test && npm run build` (e os dois scripts de locale quando houver texto).
- Commits `type: summary` em inglês; toda mensagem termina com as duas linhas abaixo (no plano, "com o trailer"):

```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MXwnuXUfK4Tkf7d2QS2Nx6
```

## Review Focus

1. **Fuso e D+2:** pessoa em `Asia/Tokyo` às 08:30 de segunda local (ainda domingo em UTC) marca o check de segunda, na semana nova; o domingo fecha na terça local com a `week_start` da sua semana, e o check de anteontem é recusado com `day_closed` (Task 1 e Task 2 testam com `Asia/Tokyo`; Task 7 testa a virada do dia no fuso).
2. **Hábito criado, arquivado ou com N mudado no meio da semana:** criado na quarta entra com `min(N, 5)`; arquivado na quinta com 2 checks fica com target 2 e não trava o C = Q; N mudado na quarta só vale na segunda seguinte; reativado na mesma semana não fica abaixo dos checks já contados; o XP dos checks nunca passa de 600 quando Q sobe no meio da semana (Task 1, Task 2 e Task 6).
3. **Pilar desligado e religado:** desligar e religar no mesmo dia mantém um período só; semana com dia fora de período é neutra (no alvo soma, fora não quebra nem gasta escudo); check em dia fora de período dá `pillar_off`; religar com zero hábitos ativos abre a criação (Task 1, Task 3 e Task 8).
4. **Cliente antigo e progresso em cache durante o deploy:** o cliente do Sono chama `create_challenge` e `join_challenge` com parâmetros nomeados sem `p_share_habits` e continua funcionando; um `Progress` em cache sem `habits`, sem `week.pillars.habits` e sem `radar.habits` não quebra a barra, o radar, as celebrações nem o cartão da Home (Task 5, Task 9 e Task 12).
5. **Fila velha e troca de conta:** aparelho que volta depois de 3 dias com o check de anteontem na fila recebe `day_closed`, descarta só ele e avisa uma vez; hábito criado offline, marcado e depois renomeado chega ao servidor antes do check; trocar de conta não envia checks da conta anterior (Task 7).

## Decisões do plano

Pontos que a spec deixa em aberto, fechados aqui.

1. **Migrations por tarefa.** `0026` (Task 1); `0027` (Task 2, completada pela Task 3 no mesmo
   arquivo, como no Sono); `0028` (Task 4); `0029` e `0030` (Task 5).
2. **`week_target_for` e `freeze_week_target` não são redefinidas.** A spec §6 as lista com base
   `0021`, mas §6.1 diz que `weekly_targets` não é usado para hábitos: Q vem de `habit_targets`.
   Nenhuma das duas muda, então não há linha delas em `function-bodies.test.ts`. `close_weeks`,
   `close_due_challenges` e `close_all_challenges` também ficam (já leem `challenge_grace`).
3. **Quatro métricas.** §5.4 diz "cinco métricas novas" e a tabela lista quatro; as conquistas usam
   só essas quatro (`habits_checks`, `habits_week_targets`, `habits_best_streak`,
   `habits_iron_best_run`). Fica com quatro.
4. **"Hábito de ferro" sem estado guardado.** `habits_iron_best_run` é calculado em
   `achievement_stats`: por hábito, semanas julgadas (`week_start <= local_today − 8`) com linha em
   `habit_targets`, `target > 0` e checks `counted` ≥ `target`; maior sequência de `week_start`
   consecutivos (ilhas por `week_start − 7 × row_number`). Semana sem linha (hábito inexistente ou
   arquivado) quebra; a semana do arquivamento conta se bateu o target reduzido. `close_habit_weeks`
   faz só o streak `habits_week` e chama `evaluate_achievements`.
5. **Triggers de `habits`.** `habits_guard` (`before insert or update`, `security invoker`):
   `too_many_habits` ao inserir ativo ou reativar com 20 ativos; mudar `user_id` → `item_immutable`;
   última escrita vence (`updated_at := least(updated_at, now())`, update mais velho → `return null`).
   `habits_targets_sync` (`after insert or update`, `security definer`; a FK de `habit_targets` exige
   a linha do hábito) aplica §3.3 na semana corrente: criar → `min(per_week, dias restantes)`; mudar N
   → insere a semana corrente com `old.per_week` se faltar; arquivar → congela a semana se faltar e
   baixa para `min(target, checks do hábito de segunda até hoje)`; reativar →
   `greatest(target existente, min(per_week, dias restantes))`, para não ficar abaixo de checks já
   contados na mesma semana. Dias restantes = `8 − isodow(local_today)`.
6. **`freeze_habit_targets(p_user, p_week)`** cria `target = per_week` para hábitos com
   `archived_at is null` e data local de `created_at` ≤ `p_week`; não toca linhas existentes.
   Hábito criado depois da segunda já ganhou a linha pelo trigger.
7. **Q que muda no meio da semana.** O check paga `least(round(600 / P), 600 − já pago em
   habit_check na semana)` e, com Q ≥ 7, o Q-ésimo paga `600 − já pago`. Com Q constante é a regra
   da spec; com Q que sobe ou desce, a soma dos checks fecha em 600 e nunca passa. O bônus usa o Q
   da hora do pagamento; pago, não volta. Valor 0 não grava linha (`xp_ledger.amount > 0`). O
   cliente espelha a regra com os targets atuais da semana e mostra o valor como previsto.
8. **Erros dos checks.** Insert: `day_closed`, depois `habit_archived` (hábito arquivado ou que o
   cliente não enxerga), depois `pillar_off`. Delete: `day_closed` e `habit_archived` (desmarcar um
   check do dia em que o pilar foi desligado continua possível). O guard zera `counted` em insert de
   cliente; o cliente não tem `update` em `habit_checks`.
9. **Fila.** Uma instância do motor, chave `perf_habits_outbox_v1`, com
   `HabitOp = { op: 'habit'; row: Habit } | { op: 'check' | 'uncheck'; habit_id: string; day: string }`.
   Checks colapsam por `(habit_id, day)`; upserts de hábito **nunca** colapsam, porque o motor move
   o op colapsado para o fim e mandaria o check antes da criação do hábito; a regra "última escrita
   vence" do servidor resolve edições repetidas. `habit_archived`, `pillar_off` e `too_many_habits`
   entram em `P0001_REFUSALS` (descartados como `refused`); `day_closed` já existe.
10. **Store.** `useHabits` lê todos os hábitos (ativos e arquivados), os checks de
    `min(segunda da semana, ontem)` até hoje, os targets da semana corrente e o histórico por
    `get_habit_history` em cache. Sem linha de target (hábito criado offline), usa `newTarget`.
11. **Atrasado no cartão.** Dias disponíveis = dias até domingo contando hoje se o hábito ainda não
    foi marcado hoje, sem hoje se já foi; atrasado quando faltam > 0 e faltam ≥ dias disponíveis
    (a regra "passam dos dias restantes menos um"); texto "faltam 2 em 2 dias". Ordem: os que faltam,
    por `sort`; depois os completos, por `sort`. Atrasado não muda de posição, só ganha o texto.
12. **C mostrado.** `habits.week.c` do servidor conta só dias fechados; o cliente mostra C e o XP
    previsto pela `weekSummary` e `habitWeekAwards` sobre todos os checks da semana (fechados e
    abertos).
13. **Lista ordenável.** Setas acessíveis "Mover para cima" e "Mover para baixo", sem arrastar (não
    há biblioteca de arrastar e a spec aceita setas). Cada movimento troca o `sort` de dois hábitos
    pela fila.
14. **Calendário.** Estados `all` (checks do dia ≥ hábitos com `target > 0` na semana do dia),
    `partial` (algum check, menos que isso), `none` (sem check), `inactive` (fora de período),
    `open` (hoje e ontem), `future`. O número da célula é `valid`. Na segunda, o domingo (ontem) se
    marca pela folha do dia aberta no calendário, porque os 7 pontos são da semana corrente.
15. **Bônus na celebração.** `habits.last_week` ganha `bonus` (XP pago pelo `habit_week_target`
    daquela semana, 0 sem ele), campo a mais na forma da §5.5. Texto: "Semana de hábitos completa,
    +{0} XP".
16. **Ícones.** `icons.ts` com 24 chaves fixas ligadas a ícones do lucide: `check`, `book`,
    `dumbbell`, `footprints`, `bike`, `droplet`, `pill`, `apple`, `salad`, `coffee`, `bed`, `sun`,
    `moon`, `brain`, `heart`, `smile`, `music`, `pen`, `languages`, `code`, `piggy-bank`, `leaf`,
    `dog`, `phone-off`. Padrão `check`. Chave desconhecida (de outra versão) mostra `check`.
17. **Marcadores locais.** `perf_habits_v1` (cópia do store) e `perf_habits_history_v1` (meses do
    calendário) são por conta e saem no logout (`clearHabitsLocal`); a fila fica. Apagar a conta
    chama `habitsOutbox.forget(userId)` em `account.ts`.
18. **Radar.** Eixo Hábitos ligado com rótulo como link para `/habitos`; desligado, o cadeado abre o
    `HabitsSetup`; o detalhe do radar ganha "Abrir Hábitos".
19. **Desafio.** O criador entra com `share_habits = (p_template = 'habit_checks')`, como no Sono.
    Meta sugerida: `round(Q × dias / 7)`, com Q de `habits.week.q` ou, se for 0, a soma de
    `per_week` dos ativos; mínimo 1.
20. **Conquistas.** `sort` 500 a 590 de 10 em 10, na ordem da tabela §5.4. Títulos em inglês na fonte
    (pt-BR em `PT_BR_OVERRIDES`): "First check", "50/200/500/1000 checks", "Habit week done",
    "4/12/26 weeks of habits", "Iron habit" ("Hábito de ferro"); descrições pelo humanizer.

## File Structure

```
supabase/migrations/0026_habits_base.sql      perfil, habit_periods, habits, habit_targets, habit_checks, eventos
supabase/migrations/0027_habits_close.sql     habit_days, fechamento, award_xp, streak, conquistas, rede de segurança
supabase/migrations/0028_habits_progress.sql  habits_week_active, radar, cartão, extras, get_my_progress, get_habit_history
supabase/migrations/0029_habits_challenge.sql desafio habit_checks
supabase/migrations/0030_habits_cron.sql      close-habit-days às 06:50 UTC
supabase/tests/helpers/habits.ts              H, enableHabits, addHabit, setHabitTarget, checkHabit, closeHabitsAs
supabase/tests/fixtures/habits-scenarios.json XP por semana (paridade SQL e week.ts)
supabase/tests/habits-base.test.ts, habits-checks.test.ts, habits-close.test.ts, habits-parity.test.ts,
  habits-week.test.ts, habits-progress.test.ts, habits-challenge.test.ts, habits-sleep-parity.test.ts
supabase/tests/function-bodies.test.ts, release-bundle.test.ts, helpers/social.ts
src/lib/supabase-errors.ts                    habit_archived, pillar_off, too_many_habits
src/features/habits/
  types.ts         Habit, HabitCheck, HabitTarget, HabitDay, HabitPeriod, HabitHistory
  week.ts          dias restantes, metas, válidos, C de Q, atraso, XP previsto
  icons.ts         HABIT_ICONS, iconFor
  habits-api.ts    habits, habit_checks, habit_targets, get_habit_history
  outbox.ts        perf_habits_outbox_v1
  useHabits.ts     store por conta + startHabitsSync
  storage-keys.ts, sign-out.ts, labels.ts
  history.ts       buildHabitsMonth
  HabitsSetup.tsx  Perfil > Hábitos e ativação
  HabitSheet.tsx   criar e editar
  HomeHabitsCard.tsx
  HabitsScreen.tsx /habitos
  HabitRow.tsx, HabitsHistory.tsx, HabitDaySheet.tsx
src/features/gamification/ types.ts, achievements.ts, achievement-labels.ts, celebrations.ts, CelebrationHost.tsx
src/features/home/ HomeScreen.tsx, PillarRadar.tsx, ProgressHero.tsx
src/features/profile/ ProfileScreen.tsx, types.ts, account.ts
src/features/social/ templates.ts, types.ts, social-api.ts, labels.ts, NewChallengeSheet.tsx, ChallengeDetail.tsx
src/App.jsx, src/main.jsx, src/lib/database.types.ts, src/locales/*.js
scripts/build-release-sql.mjs, supabase/release/0026-0030_habits.sql
public/privacidade.html, docs/SETUP.md, docs/ROADMAP.md
```

---

### Task 1: Banco: perfil, períodos, hábitos, metas e checks

**Files:**
- Create: `supabase/migrations/0026_habits_base.sql`, `supabase/tests/helpers/habits.ts`, `supabase/tests/habits-base.test.ts`, `supabase/tests/habits-checks.test.ts`
- Modify: `src/lib/database.types.ts` (`profiles.habits_enabled`, `habit_periods`, `habits`, `habit_targets`, `habit_checks`)
- Test: continuam verdes `sleep-base.test.ts`, `sleep-logs.test.ts`, `delete-account.test.ts`

**Interfaces:**
- Consumes: `local_today(uuid)`, `local_week_start(uuid)`, `week_start_of(date)`, `my_local_today()`, `app_now()`; `profiles_sleep_period` e `sleep_logs_guard` (0021) como molde; `event_kinds.server_only`.
- Produces (SQL): `profiles.habits_enabled boolean not null default false`; tabelas `habit_periods`, `habits`, `habit_targets`, `habit_checks` exatamente como na spec §6.1 e §6.2 (sem `counted`, que vem na Task 2); trigger `profiles_habits_period` (`after insert or update of habits_enabled`, molde de `profiles_sleep_period` sem o bloco de `weekly_targets`); `habits_active_on(p_user uuid, p_day date) returns boolean` (interna, `stable`); `habit_days_left(p_user uuid) returns smallint` (interna: `8 − isodow(local_today)`); `freeze_habit_targets(p_user uuid, p_week date) returns void` (interna, Decisão 6); triggers `habits_guard` e `habits_targets_sync` (Decisão 5); trigger `habit_checks_guard` (Decisão 8); `event_kinds` `('habits','habit_check',true)`, `('habits','habit_day',true)`, `('habits','habit_week_target',true)`.
- Produces (TS, `helpers/habits.ts`): `H` (uuid `…10`); `enableHabits(db, uid, on = true)` (update como dono do perfil); `addHabit(db, uid, over: { id?: string; name?: string; icon?: string; perWeek?: number; sort?: number; asOwner?: boolean; createdAt?: string } = {}): Promise<string>` (insert como o usuário, devolve o id); `archiveHabit(db, uid, id, archived = true)`; `setHabitTarget(db, habitId, uid, week, target)` (como dono); `checkHabit(db, uid, habitId, day, over: { asOwner?: boolean } = {})`; `uncheckHabit(db, uid, habitId, day)`; `targetOf(db, habitId, week): Promise<number | null>`.

- [ ] **Step 1: Testes que falham.** Relógio em quarta `2026-10-07T15:00:00Z`, perfil em São Paulo.
  - `habits-base.test.ts`:
    - `it('opens, closes and reopens periods like sleep')`: liga quarta → `[{ started_on: '2026-10-07', ended_on: null }]`; desliga sexta → `ended_on = '2026-10-08'`; religar no mesmo dia mantém uma linha com `ended_on` nulo; ligar e desligar no mesmo dia → `ended_on = '2026-10-06'` e `habits_active_on(A,'2026-10-07')` false.
    - `it('lets clients read but not write periods and targets')`: insert/update/delete em `habit_periods` e `habit_targets` como A → `permission denied`; B não lê as de A.
    - `it('checks the habit columns')`: nome `' Ler'`, `''` e com 41 caracteres → erro; ícone `'Book'` → erro; `per_week` 0 e 8 → erro; nome repetido aceito.
    - `it('refuses the 21st active habit')`: 20 ativos ok, o 21º → `too_many_habits`; arquivar um e criar outro ok; reativar com 20 ativos → `too_many_habits`.
    - `it('never deletes a habit and never moves it to another person')`: delete como A apaga 0 linhas; update de `user_id` → `item_immutable`; B não lê nem altera os de A.
    - `it('keeps the newest write')`: upsert com `updated_at` mais velho não muda o nome; mais novo muda; `updated_at` no futuro gravado como `now()`.
    - `it('gives a habit created mid-week the days left')`: criado na quarta com N = 7 → `targetOf(semana)` = 5; com N = 3 → 3; criado no domingo com N = 5 → 1.
    - `it('applies a new N from next week')`: hábito N = 3 criado em 28/09; na quarta muda para 5 → semana de 05/10 fica 3 (congelada com o valor antigo); `freeze_habit_targets(A,'2026-10-12')` → 5.
    - `it('lowers the target when archived mid-week')`: N = 5, checks segunda e terça (como dono), arquivado na quarta → target 2; arquivado sem checks → 0; a semana seguinte não ganha linha no `freeze_habit_targets`.
    - `it('treats reactivation as creation and never lowers a target')`: arquivado na quarta com 2 checks (target 2), reativado na quinta com N = 5 → `greatest(2, min(5, 4))` = 4; arquivado no sábado com 1 check e reativado no domingo com N = 7 → 1.
    - `it('freezes only missing targets for habits active on Monday')`: `freeze_habit_targets` cria `per_week` para os ativos criados até a segunda, não toca linha existente, ignora arquivados.
    - `it('refuses habit server-only kinds from clients')`: insert como A de `habit_check`, `habit_day` e `habit_week_target` → erro de RLS, também com `set_config('perf.server_write','on',true)`.
  - `habits-checks.test.ts`:
    - `it('accepts today and yesterday only')`: `'2026-10-07'` e `'2026-10-06'` ok; `'2026-10-05'` e `'2026-10-08'` → `day_closed`; delete de um check de `'2026-10-05'` (inserido como dono) → `day_closed`.
    - `it('uses the profile time zone')`: perfil `Asia/Tokyo`, relógio `2026-10-11T23:30:00Z` (segunda 12/10 às 08:30 em Tóquio, domingo em UTC) → `'2026-10-12'` e `'2026-10-11'` ok, `'2026-10-10'` → `day_closed`; um hábito criado nesse momento com N = 7 tem target 7 na semana de 12/10 (Review Focus 1).
    - `it('refuses archived and foreign habits')`: hábito arquivado → `habit_archived` no insert e no delete; check de B no hábito de A → `habit_archived`.
    - `it('refuses days outside a period')`: pilar desligado na quarta → check de quarta como A → `pillar_off`; desmarcar o check de terça (ainda em período) ok (Decisão 8).
    - `it('is idempotent and has no update')`: `insert ... on conflict (habit_id, day) do nothing` duas vezes → uma linha; update como A → `permission denied`.
    - `it('lets account deletion remove everything')`: hábitos, metas, checks antigos (como dono) e `delete_my_account()` como A → nada de A sobra nas quatro tabelas.
- [ ] **Step 2:** `npx vitest run supabase/tests/habits-base.test.ts supabase/tests/habits-checks.test.ts` → FAIL (tabelas não existem).
- [ ] **Step 3: Migration `0026_habits_base.sql`.** SQL da spec §6.1 e §6.2 literal. RLS: `habit_periods` e `habit_targets` com select do próprio e `revoke insert, update, delete, truncate ... from anon, authenticated`; `habits` com select, insert e update do próprio e `revoke delete, truncate`; `habit_checks` com select, insert e delete do próprio e `revoke update, truncate`. `habit_checks_guard` `before insert or delete`, `security invoker`, `set search_path = public`: passa se `current_user not in ('authenticated','anon')`; senão as regras da Decisão 8 e `new.counted := null`. Triggers de `habits` pela Decisão 5.
- [ ] **Step 4:** `npx vitest run supabase/tests` → PASS; tipos em `database.types.ts`; gate.
- [ ] **Step 5: Commit** `feat(habits): habit profile, periods, habits, weekly targets and checks` com o trailer.

### Task 2: Banco: dias fechados, checks válidos e XP

**Files:**
- Create: `supabase/migrations/0027_habits_close.sql`, `supabase/tests/fixtures/habits-scenarios.json`, `supabase/tests/habits-close.test.ts`, `supabase/tests/habits-parity.test.ts`, `supabase/tests/habits-sleep-parity.test.ts`
- Modify: `supabase/tests/helpers/habits.ts` (+ `closeHabitsAs(db, uid): Promise<number>`, que chama `close_habit_days` como dono), `supabase/tests/function-bodies.test.ts`, `src/lib/database.types.ts` (`habit_days`, `habit_checks.counted`)

**Interfaces:**
- Consumes: Task 1; `award_xp` **base `0022_sleep_close.sql`**; `close_sleep_nights` (0022) como molde.
- Produces (SQL): tabela `habit_days` e `habit_checks.counted boolean` (spec §6.3; só select do próprio); `habit_week_q(p_user uuid, p_week date) returns integer` (interna: soma dos targets); `close_habit_days(p_user uuid) returns integer` (dias fechados); ramo `pillar = 'habits'` em `award_xp` (Decisão 7).
- Fixture: `{ weeks: [{ name, week_start, habits: [{ id, sort, target }], checks: [{ habit, day }], awards: [{ reason, amount, ref }], total }] }`, com ids uuid literais e `awards` na ordem de emissão (por dia: checks válidos pela ordem de `sort` e `id`, depois `habit_day`, depois `habit_week_target` no dia em que C chega a Q).

- [ ] **Step 1: Fixture.** Semanas a partir de 05/10:
  - "Q = 1 pays the floor": um hábito target 1, checks segunda e terça → um `habit_check` 86, `habit_day` 30, `habit_week_target` 21; terça não paga; total 137.
  - "Q = 3 is proportional": target 3, checks segunda, quarta e sexta → 3 × 86 + 3 × 30 + 64 = 412.
  - "Q = 7 pays the remainder to the 7th by sort": A (sort 0, target 4) segunda a quinta, B (sort 1, target 3) terça a quinta → o 7º válido é o de B na quinta e paga 84; total 600 + 4 × 30 + 150 = 870.
  - "Q = 7 full week": target 7, todos os dias → 960.
  - "Q = 10": dois hábitos target 5, segunda a sexta → 10 × 60, 5 × 30, 150 → 900.
  - "Q = 11 remainder": round(600/11) = 55, o 11º paga 50.
  - "Q = 20 caps at 960": targets 7, 7 e 6, todos os dias (o terceiro sem o domingo) → 20 × 30, 7 × 30, 150 → 960.
  - "beyond the target pays nothing": target 2, checks segunda a quinta → 2 × 86, 2 × 30, `round(150 × 2 / 7)` = 43 → 275; quarta e quinta sem `habit_day`.
  - "missed week": target 5, 3 checks → 3 × 86 + 3 × 30 = 348, sem bônus.
- [ ] **Step 2: Testes que falham.**
  - `habits-parity.test.ts`: `it.each(weeks)` criando os hábitos, os targets e os checks como dono, pilar ligado antes da semana, relógio na quarta seguinte, `closeHabitsAs` e comparando o ledger de `pillar = 'habits'` (com o `source_ref` do evento) com `awards` e `total`.
  - `habits-close.test.ts` (relógio quarta 07/10; pilar ligado segunda 05/10; hábito N = 5):
    - `it('closes a day at the start of D+2')`: checks de 05/10 e 06/10 → fecha 05/10 e não 06/10.
    - `it('marks the valid checks and stores the day')`: `habit_days` com `checks`, `valid` e `xp` (soma do ledger dos eventos do dia); `counted` true nos válidos, false além do target, nulo nos dias abertos.
    - `it('closes an in-period day without checks')`: linha com zeros e nenhum evento.
    - `it('skips days outside a period')` e `it('skips days before the pillar was ever on')`.
    - `it('pays a day once')`: `closeHabitsAs` duas vezes → ledger igual; `source_ref` `habit:<id>:2026-10-05` e `habits:2026-10-05`.
    - `it('pays the week bonus when C reaches Q')`: `habits-week:2026-10-05` uma vez, no dia do Q-ésimo válido.
    - `it('never pays more than 600 for checks when Q grows mid-week')` (Decisão 7): Q = 7 com 4 checks pagos (86 cada), hábito novo N = 3 na quinta sobe Q para 10 → depois de C = 10, a soma dos `habit_check` da semana é 600 (o 9º paga 16, o 10º não grava linha) e o bônus é 150.
    - `it('closes days in the profile time zone')`: perfil `Asia/Tokyo`, relógio `2026-10-12T16:00:00Z` (terça 01:00 em Tóquio) fecha o domingo 11/10 com `week_start = '2026-10-05'` (Review Focus 1).
    - `it('never touches other pillars')`: depois de uma semana cheia, nenhum `reason` com `pillar = 'habits'` fora dos três de §5.2; ledgers de Treino, Nutrição e Sono intactos.
    - `it('lets clients read but not write closed days')`: insert/update/delete em `habit_days` como A → `permission denied`; update de `counted` como A → `permission denied`.
  - `habits-sleep-parity.test.ts`, `describe('award_xp (0027)')`: `it('still pays a check-in day')`, `it('still pays a nutrition day')`, `it('still pays a sleep night')` (noite no alvo fechada por `closeSleepAs` → `sleep_logged` 10 e `sleep_night` 120 com T = 5).
  - `function-bodies.test.ts`: `award_xp` (base `0022_sleep_close.sql`, em `0027_habits_close.sql`, `changed: []`; o ramo `habits` entra antes de `if new.pillar <> 'strength' then return null; end if;`).
- [ ] **Step 3:** rodar → FAIL.
- [ ] **Step 4: Migration.** `close_habit_days` (`security definer`): trava `xp:<user>`; dias de `greatest(min(started_on), max(day) + 1)` até `local_today − 2` sem linha e com `habits_active_on`; para cada dia, em ordem: `freeze_habit_targets` da semana; marca `counted` nos checks do dia (ordem `sort`, `habit_id`) enquanto os contados do hábito na semana < target (sem linha de target → false); emite `habit_check` por válido, `habit_day` se houver algum, e `habit_week_target` quando Q > 0 e contados da semana ≥ Q, todos com `on conflict do nothing`; grava `habit_days`. `award_xp`: corpo da `0022` com o ramo `habits` (Decisão 7; `habit_day` uma vez por dia, como `sleep_logged`).
- [ ] **Step 5:** `npx vitest run supabase/tests` → PASS; tipos; gate.
- [ ] **Step 6: Commit** `feat(habits): close habit days on the server and pay pillar XP` com o trailer.

> **Revisão (controlador):** Tasks 1 e 2.

### Task 3: Banco: streak, conquistas e rede de segurança

**Files:**
- Modify: `supabase/migrations/0027_habits_close.sql` (Decisão 1), `src/features/gamification/achievements.ts`, `src/features/gamification/achievement-labels.ts`, `src/locales/*.js`, `supabase/tests/function-bodies.test.ts`, `supabase/tests/habits-sleep-parity.test.ts`
- Create: `supabase/tests/habits-week.test.ts`
- Test: `supabase/tests/gamification-catalog.test.ts`, `src/features/gamification/achievement-labels.test.ts`, `achievements.test.ts`

**Interfaces:**
- Consumes: Task 2; `close_sleep_weeks` e `close_all_sleep_nights` (0022) como molde; `achievement_stats` **base `0022_sleep_close.sql`**; `check` de `achievement_catalog.metric` (último em 0022).
- Produces (SQL): `close_habit_weeks(p_user uuid) returns void` (interna; streak `habits_week`); `close_habit_days` passa a chamar `close_habit_weeks` no fim; `close_all_habit_days() returns integer` (interna; molde de `close_all_sleep_nights`); métricas `habits_checks`, `habits_week_targets`, `habits_best_streak`, `habits_iron_best_run` (Decisões 3 e 4); 10 conquistas `private = true` com `sort` 500 a 590.
- Produces (TS): `Metric` e `AchievementCode` com as novas; `ACHIEVEMENTS` com as 10 (`private: true`); `HABITS_METRICS`; textos em `achievement-labels.ts` (Decisão 20).

Copiado da spec §5.3 e §5.4. Streak `habits_week`: semanas seguidas no alvo; escudos como `training_week` (+1 a cada 4, máximo 2); semana com dia fora de período é neutra (no alvo soma, fora não quebra nem gasta escudo); semana com Q = 0 dentro de período também é neutra; julgada só com `week_start <= local_today − 8`.

| Código | Métrica ≥ | XP | `sort` |
|---|---|---|---|
| `habits_first_check` | `habits_checks` 1 | 50 | 500 |
| `habits_checks_50/200/500/1000` | `habits_checks` | 100/200/300/500 | 510/520/530/540 |
| `habits_week_target_1` | `habits_week_targets` 1 | 75 | 550 |
| `habits_streak_4/12/26` | `habits_best_streak` | 150/400/800 | 560/570/580 |
| `habits_iron_8` | `habits_iron_best_run` 8 | 200 | 590 |

- [ ] **Step 1: Testes que falham** (`habits-week.test.ts`, pilar ligado segunda 28/09, um hábito N = 3):
  - `it('judges a week only once its seven days closed')`: semana de 05/10 entra na terça 13/10, não na segunda 12/10.
  - `it('builds the streak and gives a shield every 4 weeks, at most 2')`; `it('spends a shield on a missed week')`.
  - `it('makes a week with a day off neutral')`: desligado numa quarta e religado na quinta (Review Focus 3); no alvo soma 1; fora, `current` e `shields` iguais.
  - `it('treats the activation week as neutral')`: pilar ligado numa quinta, semana fora do alvo não quebra nem gasta escudo.
  - `it('makes an in-period week with Q = 0 neutral')`: todos os hábitos arquivados antes da segunda.
  - `it('unlocks private habit badges')`: 1 check válido → `habits_first_check`; semana no alvo → `habits_week_target_1`; check além do target não conta em `habits_checks`; `achievement_catalog.private` true para as 10.
  - `it('counts the iron run per habit and breaks it on archive')`: 8 semanas seguidas batendo o target → `habits_iron_8`; 7 + semana arquivada + 1 → `habits_iron_best_run = 7`; dois hábitos alternando semanas não somam.
  - `it('closes everyone due in the safety net')`: `close_all_habit_days()` = pessoas com dia pendente; repetir → 0.
  - `gamification-catalog.test.ts`: o espelho TS bate com o catálogo, incluindo `private`.
  - `habits-sleep-parity.test.ts`, `describe('achievement_stats (0027)')`: `it('still counts training, nutrition and sleep metrics')` (`workouts` 1, `nutrition_on_target_days` 1, `sleep_on_target_nights` 1, `sleep_clock_best_run` igual).
  - `function-bodies.test.ts`: `achievement_stats` (base `0022_sleep_close.sql`, em `0027_habits_close.sql`, `changed: [') lengths), 0)']`, a última linha de `sleep_clock_best_run`, que ganha vírgula).
  - `achievement-labels.test.ts`: as 10 têm título e descrição; nenhuma com travessão.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** completar a `0027`: `close_habit_weeks` no molde de `close_sleep_weeks` com `habits_active_on`, `habit_week_q` e `habit_week_target`; chamada no fim de `close_habit_days`; `close_all_habit_days`; `check` recriado com as métricas da `0022` e as quatro novas; catálogo; `achievement_stats` copiada da `0022` com as quatro chaves. `achievements.ts`, rótulos nos 16 packs (humanizer).
- [ ] **Step 4:** `npx vitest run supabase/tests src/features/gamification` → PASS; locale scripts; gate.
- [ ] **Step 5: Commit** `feat(habits): weekly habit streak, private badges and safety net` com o trailer.

### Task 4: Banco: progresso, radar e histórico

**Files:**
- Create: `supabase/migrations/0028_habits_progress.sql`, `supabase/tests/habits-progress.test.ts`
- Modify: `src/features/gamification/types.ts`, `supabase/tests/function-bodies.test.ts`, `supabase/tests/habits-sleep-parity.test.ts`
- Test: continuam verdes `gamification-progress.test.ts`, `nutrition-progress.test.ts`, `sleep-progress.test.ts`, `training-radar.test.ts`, `social-friends.test.ts`

**Interfaces:**
- Consumes: Tasks 1 a 3; **bases** `pillar_consistency`, `progress_card`, `my_progress_extras`, `get_my_progress` em `0023_sleep_progress.sql`.
- Produces (SQL): `habits_week_active(p_user uuid, p_week date) returns boolean` (interna, molde de `sleep_week_active`); `pillar_consistency` com ramo `habits` (semana fechada como a do Sono; ativas por `habits_week_active`); `progress_card`: `week.pillars.habits` e `week.max = 960 × (1 + nutrição + sono + habits_week_active)`; `my_progress_extras`: `radar.habits` e o bloco `habits`; `get_my_progress`: `freeze_habit_targets(v_uid, semana)` e `close_habit_days(v_uid)` junto dos outros; `get_habit_history(p_from date, p_to date) returns jsonb` (RPC, `volatile`, fecha pendentes, no máximo 62 dias, senão `invalid_range`), com a forma da spec §6.4.
- Bloco `habits` (presente se existe linha em `habit_periods`): `{ week: { q, c, xp }, streak: { current, best, shields }, last_week: { start, target_hit, bonus } | null }`; `q` = `habit_week_q` da semana corrente; `c` = checks `counted` da semana corrente (Decisão 12); `xp` = ledger `habits` da semana; `last_week` = semana `week_start_of(local_today − 8)`, nulo se anterior ao primeiro período, `bonus` pela Decisão 15.
- Produces (TS, `gamification/types.ts`): `HabitsProgress`; `Progress.habits?: HabitsProgress`; `WeekProgress.pillars.habits?: number`; `Celebration` `week_target` com `pillar: 'nutrition' | 'sleep' | 'habits'` e `xp?: number`.

- [ ] **Step 1: Testes que falham** (`habits-progress.test.ts`):
  - `it('raises the week max by active pillars')`: Treino + Hábitos → 1920; os quatro → 3840; ligar e desligar no mesmo dia não toca a semana.
  - `it('splits the week XP with habits')`: `week.pillars` = `{strength, nutrition, sleep, habits, bonus}` com os valores do ledger.
  - `it('hides habits from friends')`: A com hábitos ("Ler"), checks e `habits_first_check`; B amigo; `get_friends()` como B e `progress_card(A)` não têm `habits` como bloco, nem o nome "Ler", nem ícone, `habit_id` ou checks, nem o código privado; `pillars.habits` tem nível e `xp`.
  - `it('reports the habits block to the owner')`: `week.q`, `week.c` (só fechados), `week.xp`; `last_week` nulo antes do primeiro período e `{ start, target_hit: true, bonus: 64 }` numa semana Q = 3 no alvo.
  - `it('leaves the habits block out until the pillar was ever on')`.
  - `it('freezes the targets and closes pending days when the owner reads progress')`.
  - `it('computes the habits radar over closed weeks')`: 2 semanas ativas com 960 e 480 → `current = 0.75`; sem semana ativa → `null`; na segunda a semana anterior ainda não entra.
  - `it('returns history for the owner only')`: `get_habit_history('2026-10-01','2026-10-10')` com `days`, `checks` (`counted` nulo nos abertos), `targets`, `periods`; 63 dias → `invalid_range`; B recebe só as próprias.
  - `it('keeps single progress functions closed to clients')`: `count(*) from pg_proc` = 1 para `progress_card` e `get_habit_history`; `asUser(A, select progress_card(B))` → `permission denied`.
  - `habits-sleep-parity.test.ts`, `describe('progress (0028)')`: `it('still closes training days, nutrition days and sleep nights')` (`get_my_progress` fecha os três e devolve `training.last_closed`, `nutrition.last_closed` e `sleep.last_closed`); `it('still computes the Treino, Nutrition and Sleep radar')`.
  - `function-bodies.test.ts`, base `0023_sleep_progress.sql`, em `0028_habits_progress.sql`: `pillar_consistency` (`changed: ['else public.sleep_week_active(p_user, w::date) end;']`; o Sono ganha o próprio `when` e o `else` passa a `habits_week_active`), `progress_card` (`changed: ['+ public.sleep_week_active(p_user, v_week)::int),']`; a linha `'habits'` do split entra depois da de `'sleep'`), `my_progress_extras` (`changed: ["'previous', public.pillar_consistency(p_user, 'sleep', 1))))"]`), `get_my_progress` (`changed: []`).
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** migration copiando os corpos da `0023` e mudando só o que a tarefa diz; tipos TS.
- [ ] **Step 4:** `npx vitest run supabase/tests src/features/gamification src/features/social` → PASS; gate.
- [ ] **Step 5: Commit** `feat(habits): progress card, owner block, radar and habit history` com o trailer.

> **Revisão (controlador):** Tasks 3 e 4.

### Task 5: Banco: desafio de hábitos e cron

**Files:**
- Create: `supabase/migrations/0029_habits_challenge.sql`, `supabase/migrations/0030_habits_cron.sql`, `supabase/tests/habits-challenge.test.ts`
- Modify: `supabase/tests/helpers/social.ts` (`challengeArgs` com `share_habits`; `createChallenge` passa `p_share_habits` nomeado), `supabase/tests/function-bodies.test.ts`, `supabase/tests/habits-sleep-parity.test.ts`, `src/lib/database.types.ts`
- Test: continuam verdes `social-*.test.ts`, `nutrition-challenge.test.ts`, `sleep-challenge.test.ts`, `checkin-feed.test.ts`, `challenge-rules-parity.test.ts`

**Interfaces:**
- Consumes: `close_habit_days` (Task 2); **bases** `challenge_progress`, `challenge_grace`, `close_challenge`, `create_challenge`, `join_challenge` em `0024_sleep_challenge.sql`.
- Produces: `challenges.template` aceita `habit_checks` (constraint recriada com os seis atuais + o novo); `challenge_members.share_habits boolean not null default false`; `create_challenge(p_template, p_title, p_mode, p_target, p_starts_on, p_ends_on, p_invitees, p_share_volume boolean default false, p_share_nutrition boolean default false, p_share_sleep boolean default false, p_share_habits boolean default false) returns jsonb`; `join_challenge(p_id uuid, p_share_volume boolean default false, p_share_nutrition boolean default false, p_share_sleep boolean default false, p_share_habits boolean default false) returns void`; `drop` das assinaturas da `0024` e `revoke`/`grant` refeitos; erros `habits_opt_in_required`, `habits_off`; `challenge_progress`: checks com `counted` entre `starts_on` e `ends_on`; `challenge_grace('habit_checks') = 2`; `close_challenge` chama `close_habit_days(member)` de cada participante antes de `final`; cron `close-habit-days`.

Regras da spec §6.5: modos `team` e `solo`, período de 7 a 92 dias, 2 a 20 pessoas, meta solo de 1 até 10 × dias do período e de equipe de 1 até isso × (1 + convidados), opt-in e pilar ligado para criar e para entrar. Cron §6.6: `'50 6 * * *'` chamando `close_all_habit_days()`, no molde de `0025_sleep_cron.sql`.

- [ ] **Step 1: Testes que falham** (`habits-challenge.test.ts`, Ana cria na segunda 05/10, Bia e Caio amigos, pilar ligado para os três):
  - `it('creates valid team and solo challenges')`; `it('refuses targets out of range')` (solo 141 em 14 dias, equipe acima de 140 × 3, 6 e 93 dias → `invalid_challenge`).
  - `it('requires the opt-in to create and to join')` → `habits_opt_in_required`; `it('requires the pillar on to create and to join')` → `habits_off`.
  - `it('counts only valid checks of joined members')`: check além do target não conta; quem não entrou não conta.
  - `it('closes at ends_on + 3 after closing pending days')`: não fecha em `ends_on + 2`, fecha em `ends_on + 3` com os checks dos dois últimos dias contados; +300 para quem venceu.
  - `it('shows only the count in the payload')`: `get_challenges` como Bia não traz nome, ícone, `habit_id` nem dia.
  - `it('leaves one create_challenge and one join_challenge')`: `count(*) from pg_proc` = 1 cada; chamada com os parâmetros nomeados do Sono (sem `p_share_habits`) a um desafio `sleep_nights_on_target` funciona (Review Focus 4).
  - `it('schedules nothing without pg_cron')`: a `0030` roda no PGlite sem erro.
  - `habits-sleep-parity.test.ts`, `describe('challenges (0029)')`: `it('still counts training days in checkin_days')`; `it('still closes a nutrition challenge')`; `it('still closes a sleep challenge after closing pending nights')`.
  - `function-bodies.test.ts`, base `0024_sleep_challenge.sql`, em `0029_habits_challenge.sql`: `challenge_progress` e `close_challenge` (`changed: []`), `challenge_grace` (`changed: ["'sleep_nights_on_target')"]`), `create_challenge` (`changed: ["'checkin_days', 'sleep_nights_on_target')", '(challenge_id, user_id, invited_by, joined_at, share_volume, share_nutrition, share_sleep)', "p_template = 'sleep_nights_on_target');"]`), `join_challenge` (`changed: ["share_sleep = (v_c.template = 'sleep_nights_on_target')"]`).
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** migrations (corpos da `0024`, mudando só o necessário; criador e quem entra gravam `share_habits = (template = 'habit_checks')`, Decisão 19).
- [ ] **Step 4:** `npx vitest run supabase/tests` → PASS; tipos; gate.
- [ ] **Step 5: Commit** `feat(social): habit checks challenge and daily close job` com o trailer.

### Task 6: Cliente: regras puras da semana e XP previsto

**Files:**
- Create: `src/features/habits/types.ts`, `week.ts` + `week.test.ts`, `icons.ts` + `icons.test.ts`, `src/features/habits/habits-parity.test.ts` (lê `supabase/tests/fixtures/habits-scenarios.json`)

**Interfaces:**
```ts
// types.ts
type Habit = { id: string; name: string; icon: string; per_week: number; sort: number; archived_at: string | null; created_at: string; updated_at: string }
type HabitCheck = { habit_id: string; day: string; counted: boolean | null }
type HabitTarget = { habit_id: string; week_start: string; target: number }
type HabitDay = { day: string; checks: number; valid: number; xp: number }
type HabitPeriod = { started_on: string; ended_on: string | null }
type HabitHistory = { days: HabitDay[]; checks: HabitCheck[]; targets: HabitTarget[]; periods: HabitPeriod[] }
// week.ts
function daysLeft(today: string): number                                   // 8 − isodow, contando hoje
function newTarget(perWeek: number, today: string): number                 // min(perWeek, daysLeft)
function validChecks(checks: Pick<HabitCheck, 'habit_id' | 'day'>[], targets: Record<string, number>, habits: Pick<Habit, 'id' | 'sort'>[]): Pick<HabitCheck, 'habit_id' | 'day'>[]   // em ordem de emissão
function weekSummary(checks: Pick<HabitCheck, 'habit_id' | 'day'>[], targets: Record<string, number>, habits: Pick<Habit, 'id' | 'sort'>[]): { q: number; c: number; byHabit: Record<string, { target: number; done: number; valid: number }> }
type HabitReason = 'habit_check' | 'habit_day' | 'habit_week_target'
function habitWeekAwards(week: { habits: { id: string; sort: number; target: number }[]; checks: { habit: string; day: string }[] }): { reason: HabitReason; amount: number; ref: string }[]
function lateness(target: number, done: number, checkedToday: boolean, today: string): { late: boolean; missing: number; days: number }   // Decisão 11
function cardOrder<T extends { sort: number; done: number; target: number }>(rows: T[]): T[]   // faltando, depois completos
function habitRun(habitId: string, history: Pick<HabitHistory, 'targets' | 'checks'>, today: string): number   // semanas julgadas seguidas (week_start <= hoje − 8) com target > 0 e contados ≥ target, da mais recente para trás
// icons.ts
const HABIT_ICONS: readonly string[]   // as 24 chaves da Decisão 16
function iconFor(key: string): LucideIcon
```

- [ ] **Step 1: Testes que falham.**
  - `week.test.ts`: `daysLeft` segunda 7, quarta 5, domingo 1; `newTarget(7, quarta)` 5, `(3, quarta)` 3; `validChecks` pega os primeiros `target` por hábito em ordem de dia e, no mesmo dia, por `sort` e `id`; `weekSummary` com Q = 0 dá `c = 0`; `lateness(3, 1, false, sexta)` → `{ late: false, missing: 2, days: 3 }`; `lateness(3, 1, false, sábado)` → `{ late: true, missing: 2, days: 2 }`; `lateness(3, 1, true, sábado)` → `days: 1`, `late: true`; `lateness(3, 3, false, sábado)` → `late: false`; `cardOrder` põe os completos no fim mantendo `sort`; `habitRun` conta 3 semanas seguidas, para na semana sem linha de target e ignora a semana ainda não julgada.
  - `habits-parity.test.ts`: `it.each(weeks)` da fixture contra `habitWeekAwards`, comparando `awards` (com `ref`) e `total`.
  - `icons.test.ts`: 24 chaves únicas que casam com `^[a-z][a-z0-9-]{0,31}$`; `iconFor('nao-existe')` é o ícone de `check`.
- [ ] **Step 2:** `npx vitest run src/features/habits` → FAIL.
- [ ] **Step 3:** implementar; `habitWeekAwards` segue a Decisão 7 (com Q constante, a fórmula da spec).
- [ ] **Step 4:** PASS; gate.
- [ ] **Step 5: Commit** `feat(habits): client rules for weekly targets, valid checks and XP` com o trailer.

> **Revisão (controlador):** Tasks 5 e 6.

### Task 7: Cliente: API, fila e store

**Files:**
- Create: `src/features/habits/habits-api.ts` + teste, `outbox.ts` + teste, `useHabits.ts` + teste, `storage-keys.ts`, `sign-out.ts` + teste
- Modify: `src/lib/supabase-errors.ts` + teste (Decisão 9), `src/features/profile/types.ts` (`habits_enabled`), `src/features/profile/account.ts` + teste (`habitsOutbox.forget`), `src/App.jsx` (`useHabits.bind`/`reset` e `startHabitsSync`, junto de `useSleep`), `src/main.jsx` (`clearHabitsLocal` no `SIGNED_OUT`), `src/locales/*.js`

**Interfaces:**
- Consumes: Task 6; `createLocalOutbox` (`src/lib/local-outbox.ts`); `supabase`; `useProfile`; `useProgress.getState().refresh()`; `todayIn`, `shiftDay` (`nutrition/days.ts`); `weekStartOf` (`gamification/xp.ts`).
- Produces:
```ts
// habits-api.ts
function fetchHabits(): Promise<Habit[]>
function upsertHabit(h: Habit): Promise<void>                       // on conflict (id)
function fetchChecks(from: string, to: string): Promise<HabitCheck[]>
function insertCheck(habitId: string, day: string): Promise<void>   // on conflict do nothing
function deleteCheck(habitId: string, day: string): Promise<void>
function fetchTargets(week: string): Promise<HabitTarget[]>
function fetchHistory(from: string, to: string): Promise<HabitHistory>   // get_habit_history
type HabitErrorCode = 'day_closed' | 'habit_archived' | 'pillar_off' | 'too_many_habits' | 'network' | 'refused'
function toHabitError(e: unknown): HabitErrorCode
// outbox.ts  (Decisão 9)
type HabitOp = { op: 'habit'; row: Habit } | { op: 'check' | 'uncheck'; habit_id: string; day: string }
const habitsOutbox: LocalOutbox<HabitOp>
// storage-keys.ts: HABITS_OUTBOX_KEY 'perf_habits_outbox_v1', HABITS_CACHE_KEY 'perf_habits_v1', HABITS_HISTORY_KEY 'perf_habits_history_v1'
// useHabits.ts
type HabitsStore = {
  userId: string | null; status: 'idle' | 'loading' | 'ready' | 'error'; stale: boolean
  habits: Habit[]                       // ativos e arquivados, por sort
  checks: HabitCheck[]                  // de min(segunda, ontem) até hoje (Decisão 10)
  targets: Record<string, number>       // semana corrente, por habit_id
  recent: HabitHistory | null           // get_habit_history(hoje − 61, hoje), para habitRun
  droppedNotice: boolean
  bind(userId: string): Promise<void>; refresh(): Promise<void>; flushPending(): Promise<void>; reset(): void; dismissDropped(): void
  saveHabit(input: Pick<Habit, 'name' | 'icon' | 'per_week'> & { id?: string }): Habit   // id novo por crypto.randomUUID()
  archiveHabit(id: string): void; reactivateHabit(id: string): void
  move(id: string, dir: -1 | 1): void                                  // Decisão 13
  toggleCheck(habitId: string, day: string): void
  active(): Habit[]
  week(today: string): { q: number; c: number; xp: number; byHabit: Record<string, { target: number; done: number; valid: number }> }
  loadMonth(month: string): Promise<HabitHistory | null>               // cache perf_habits_history_v1
}
function startHabitsSync(): () => void      // flush e pull no foco, ao reconectar e na virada do dia
// sign-out.ts
function clearHabitsLocal(): void           // perf_habits_v1 e perf_habits_history_v1; a fila fica
```

- [ ] **Step 1: Testes que falham** (Supabase mockado como em `sleep-api.test.ts`):
  - `supabase-errors.test.ts`: `habit_archived`, `pillar_off` e `too_many_habits` são recusas (`refused`); `day_closed` continua `day_closed`.
  - `outbox.test.ts`: `it('drops a closed day and keeps the rest')`; `it('collapses a check and its undo')`; `it('sends a habit created offline before its check, even after an edit')` (criar, marcar, renomear → ordem enviada: criar, check, renomear; Review Focus 5); `it('keeps the queue on sign-out and sends it on the next sign-in of the same account')`; `it('never sends one account's checks for another')`.
  - `habits-api.test.ts`: `upsertHabit` usa `onConflict: 'id'`; `insertCheck` usa `ignoreDuplicates`; `toHabitError` de cada código.
  - `useHabits.test.ts`: `it('shows the saved copy at once and marks it stale')`; `it('checks optimistically and queues')`; `it('raises the dropped notice once for closed days')`; `it('uses the days-left target for a habit created offline')`; `it('lowers the local target on archive')`; `it('blocks the 21st active habit locally')`; `it('rereads on day change')` (relógio falso atravessa a meia-noite do fuso); `it('drops everything on reset')`.
  - `sign-out.test.ts`: limpa os dois marcadores e mantém `perf_habits_outbox_v1`.
  - `account.test.ts`: apagar a conta chama `habitsOutbox.forget(userId)`.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** implementar; aviso "Alguns checks de dias já fechados não foram salvos" nos 16 packs (humanizer).
- [ ] **Step 4:** PASS; locale scripts; gate.
- [ ] **Step 5: Commit** `feat(habits): habits store with an offline queue` com o trailer.

### Task 8: Perfil > Hábitos, ativação e folha do hábito

**Files:**
- Create: `src/features/habits/HabitsSetup.tsx` + teste, `HabitSheet.tsx` + teste, `labels.ts`
- Modify: `src/features/profile/ProfileScreen.tsx` + teste (cartão Hábitos, molde do cartão Sono), `src/locales/*.js`

**Interfaces:**
- Consumes: `useHabits` (`status`, `active`, `saveHabit`, `archiveHabit`, `reactivateHabit`), `useProfile.save`, `HABIT_ICONS`, `iconFor`.
- Produces: `HabitsSetup({ open, onOpenChange })` (liga o pilar e abre o `HabitSheet` de criação quando não há hábito ativo; usado pelo Perfil e pelo radar); `HabitSheet({ habit?: Habit; open; onOpenChange })` (criar e editar); `labels.ts`: `perWeekLabel(n: number): string` ("Todo dia" para 7, "3 por semana" por `tn()`), `weekCountLabel(done: number, target: number): string` ("2 de 3 na semana").

Spec §3.1 e §7.3: cartão Hábitos com chave e "Abrir Hábitos"; desligar pede confirmação e não apaga nada; ligar sem hábito ativo abre a criação (Review Focus 3). Folha: nome (1 a 40, contador), ícone em grade com nome acessível, N num seletor de 1 a 7; ao mudar o N de um existente, "A nova meta vale a partir da próxima semana"; criado no meio da semana mostra "Nesta semana conta {0} vezes" (spec §14); arquivar com confirmação.

- [ ] **Step 1: Testes que falham.**
  - `HabitSheet.test.tsx`: nome vazio ou só espaços bloqueia e o salvo vai sem espaços nas pontas; 41 caracteres corta em 40; grade com 24 ícones e `aria-pressed`; seletor de 1 a 7 com padrão 7; editar o N mostra o aviso da próxima semana; criar numa quarta com N = 7 mostra "Nesta semana conta 5 vezes"; com 20 ativos, criar fica desabilitado com explicação; arquivar pede confirmação e chama `archiveHabit`.
  - `HabitsSetup.test.tsx`: ligar grava `habits_enabled: true` e, sem hábito ativo, abre o `HabitSheet` de criação; com hábitos ativos, só liga.
  - `ProfileScreen.test.tsx`: cartão Hábitos com switch e a contagem de ativos; desligar pede confirmação e grava `habits_enabled: false` sem apagar nada; ligado, "Abrir Hábitos" leva a `/habitos`; desligar e religar no mesmo dia com hábitos ativos não abre a criação.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** implementar; strings nos 16 packs com `tn()` (humanizer).
- [ ] **Step 4:** locale scripts; gate.
- [ ] **Step 5: Commit** `feat(habits): habits activation in the profile and habit sheet` com o trailer.

> **Revisão (controlador):** Tasks 7 e 8.

### Task 9: Cartão "Hábitos de hoje" na Home

**Files:**
- Create: `src/features/habits/HomeHabitsCard.tsx` + teste
- Modify: `src/features/home/HomeScreen.tsx` + teste (o cartão entra **abaixo** do `HomeSleepCard`), `src/locales/*.js`

**Interfaces:**
- Consumes: `useHabits` (`active`, `checks`, `toggleCheck`, `week`), `lateness`, `cardOrder`, `iconFor`, `weekCountLabel`, `useLocalNow` (`src/features/sleep/use-local-now.ts`).
- Produces: `HomeHabitsCard()`.

Spec §7.2: aparece com o pilar ligado e pelo menos um hábito ativo; uma linha por hábito com ícone, nome, "2 de 3 na semana" e botão de check de 44 px com nome acessível ("Marcar Ler hoje" / "Desmarcar Ler hoje"); check otimista, desfeito no mesmo dia; ordem e atraso pela Decisão 11 ("faltam 2 em 2 dias"); completos marcados e mais discretos; rodapé "Semana: 6 de 10 · +360 XP até agora" (Decisão 12) e link para `/habitos`; com mais de 6, os 6 primeiros e "Ver todos".

- [ ] **Step 1: Testes que falham.**
  - `HomeHabitsCard.test.tsx` (relógio falso, `America/Sao_Paulo`): pilar desligado ou sem hábito ativo não renderiza; ordem faltando antes de completos; "faltam 2 em 2 dias" num sábado com 1 de 3; botão com o nome acessível e 44 px; tocar chama `toggleCheck(id, hoje)` uma vez e o rótulo vira "Desmarcar"; rodapé "Semana: 6 de 10 · +450 XP até agora" com dois hábitos de target 5 e 6 checks em 3 dias; 8 hábitos → 6 linhas e "Ver todos" para `/habitos`; virar a meia-noite troca o dia do check sem recarregar; `Progress` em cache sem `habits` e store com hábitos renderiza o cartão (Review Focus 4).
  - `HomeScreen.test.tsx`: ordem `TodayCard`, `HomeSleepCard`, `HomeHabitsCard`.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** implementar; strings nos 16 packs (humanizer).
- [ ] **Step 4:** locale scripts; gate.
- [ ] **Step 5: Commit** `feat(habits): today's habits card on home` com o trailer.

### Task 10: Tela `/habitos`: topo, lista e arquivados

**Files:**
- Create: `src/features/habits/HabitsScreen.tsx` + teste, `HabitRow.tsx` + teste
- Modify: `src/App.jsx` (rota `/habitos`), `src/locales/*.js`

**Interfaces:**
- Consumes: Tasks 6 a 8; `Progress.habits` (`streak`); `HabitsSetup`, `HabitSheet`.
- Produces: `HabitsScreen` (default export, rota `/habitos`; pilar desligado mostra o convite com "Ligar Hábitos" que abre `HabitsSetup`); `HabitRow({ habit, week: { target, done }, days: { day: string; checked: boolean; markable: boolean }[], run: number, onMove, onToggle, onEdit })`; um espaço `data-slot="habits-history"` que a Task 11 preenche.

Spec §7.3: topo "6 de 10 nesta semana" em número grande, streak e escudos; lista com ícone, nome, "N por semana", os 7 pontos da semana (hoje e ontem marcáveis, os outros só leitura, cada um com nome acessível do dia e do estado) e a sequência de semanas do hábito (`habitRun` sobre `recent`, "8+" a partir de 8); setas "Mover para cima" e "Mover para baixo" (Decisão 13); seção "Arquivados" com "Reativar"; skeleton com a forma da tela; vazio "Crie seu primeiro hábito"; offline mostra o cache e continua aceitando check; aviso único da fila.

- [ ] **Step 1: Testes que falham.**
  - `HabitsScreen.test.tsx`: desligado → convite; topo "6 de 10 nesta semana", streak e escudos do `Progress`; `Progress` sem `habits` mostra streak 0 sem quebrar; skeleton com `status = 'loading'`; vazio com "Crie seu primeiro hábito" abrindo o `HabitSheet`; arquivados no fim com "Reativar" chamando `reactivateHabit`; offline com cache e check ativo; o aviso da fila aparece uma vez e some em `dismissDropped`.
  - `HabitRow.test.tsx`: 7 pontos com hoje e ontem como botões e os outros sem botão; na segunda, só hoje é botão (Decisão 14); seta para cima desabilitada no primeiro e para baixo no último, chamando `move(id, ±1)`; "3 por semana" e "Todo dia"; sequência "8+".
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** implementar; strings nos 16 packs com `tn()` (humanizer).
- [ ] **Step 4:** locale scripts; gate.
- [ ] **Step 5: Commit** `feat(habits): habits screen with list, order and archive` com o trailer.

> **Revisão (controlador):** Tasks 9 e 10.

### Task 11: Histórico: calendário do mês e folha do dia

**Files:**
- Create: `src/features/habits/history.ts` + teste, `HabitsHistory.tsx` + teste, `HabitDaySheet.tsx` + teste
- Modify: `src/features/habits/HabitsScreen.tsx` (preenche `habits-history`), `src/locales/*.js`

**Interfaces:**
- Consumes: `MonthCalendar` (`src/components/calendar/MonthCalendar.tsx`) e os helpers de período e mês de `src/features/nutrition/history.ts` (`shiftMonth`, `firstMonth`, `monthHasActiveDay`, `monthRange`, `isSettled`); `useHabits.loadMonth`, `toggleCheck`.
- Produces: `buildHabitsMonth(month: string, history: HabitHistory, open: HabitCheck[], habits: Habit[], today: string): CalendarWeek[]` com os estados da Decisão 14; `HabitsHistory()`; `HabitDaySheet({ day: string; open; onOpenChange })` (hábitos marcados naquele dia com ícone e nome, "além da meta" nos não contados; em hoje e ontem, lista os ativos com check marcável).

- [ ] **Step 1: Testes que falham.**
  - `history.test.ts`: cada estado com rótulo e ícone; número da célula = `valid`; dia fora de período `inactive`; hoje e ontem `open`; futuros não selecionáveis; mês antes do primeiro período não navega; mês sem dia ativo não chama `fetchHistory`.
  - `HabitsHistory.test.tsx`: navegação mês a mês até o primeiro período; tocar num dia fechado abre a folha.
  - `HabitDaySheet.test.tsx`: dia fechado lista "Ler" e "Correr" e marca "além da meta" no não contado; ontem numa segunda mostra os ativos com check marcável chamando `toggleCheck(id, domingo)`; anteontem não tem botão.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** implementar; strings nos 16 packs (humanizer).
- [ ] **Step 4:** locale scripts; gate.
- [ ] **Step 5: Commit** `feat(habits): month calendar and day sheet` com o trailer.

### Task 12: Radar, barra de XP e celebrações

**Files:**
- Modify: `src/features/home/PillarRadar.tsx` + teste, `src/features/home/HomeScreen.tsx` (`RELEASED` e `enabled` com `habits`), `src/features/home/ProgressHero.tsx` + teste, `src/features/gamification/celebrations.ts` + teste, `src/features/gamification/CelebrationHost.tsx` + teste, `src/styles/tokens.css` só se o validador pedir, `src/locales/*.js`

**Interfaces:**
- Consumes: `Progress.habits`, `Progress.radar.habits`, `WeekProgress.pillars.habits` (Task 4); `HabitsSetup` (Task 8); `profile.habits_enabled`.
- Produces: `RELEASED = ['strength', 'nutrition', 'sleep', 'habits']`; `TURN_ON.habits = () => t('Turn on Habits')`; rótulo do eixo Hábitos ligado como link para `/habitos` e "Abrir Hábitos" no detalhe (Decisão 18); `weekSegments(week: WeekProgress, active: { nutrition: boolean; sleep: boolean; habits: boolean })` com `SegmentKey` `'strength' | 'nutrition' | 'sleep' | 'habits' | 'bonus'`; `CELEBRATED_PILLARS = ['nutrition', 'sleep', 'habits']`; `pillarLevelsOf` e `weekTargetsOf` com `habits`; `completeMarker` exige `habits` nos dois mapas.

Spec §5.6: celebração da subida de nível do pilar e "Semana de hábitos completa, +{0} XP" com `bonus` (Decisão 15) quando `last_week.target_hit` muda para uma semana nova; marcador antigo sem `habits` completado sem celebrar; sem aviso por dia.

- [ ] **Step 1: Testes que falham.**
  - `PillarRadar.test.tsx`: descrição "Treino 82%, Nutrição 64%, Sono 50%, Hábitos 40%" sem "em breve"; Hábitos desligado com cadeado que abre `HabitsSetup`; ligado sem semana ativa mostra o estado no centro; rótulo navega para `/habitos`; `radar` em cache sem `habits` não quebra.
  - `ProgressHero.test.tsx`: segmentos Treino, Nutrição, Sono, Hábitos e Bônus com rótulo; só Hábitos ligado com `max = 1920` não mostra Nutrição nem Sono; `week.pillars` sem `habits` não quebra.
  - `celebrations.test.ts`: `pillar_level` de Hábitos; `week_target` com `pillar: 'habits'` e `xp: 64`; texto "Semana de hábitos completa, +64 XP" (pt-BR) e "Habit week done, +64 XP" (en); marcador do Sono (sem `habits`) completado sem celebrar.
  - `CelebrationHost.test.tsx`: a celebração da semana de hábitos aparece uma vez.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** implementar; rodar `node <skill dataviz>/scripts/validate_palette.js` com os quatro `--pillar-*` em `--mode light` e `--mode dark`, registrar a saída no relatório e ajustar só o passo de `--pillar-habits` em `tokens.css` se falhar; strings nos 16 packs (humanizer).
- [ ] **Step 4:** locale scripts; gate.
- [ ] **Step 5: Commit** `feat(habits): radar axis, weekly bar segment and habit celebrations` com o trailer.

> **Revisão (controlador):** Tasks 11 e 12.

### Task 13: Desafio de hábitos no cliente

**Files:**
- Modify: `src/features/social/templates.ts` + teste, `types.ts`, `social-api.ts` + teste, `labels.ts`, `NewChallengeSheet.tsx` + teste, `ChallengeDetail.tsx` + teste, `supabase/tests/challenge-rules-parity.test.ts`, `src/locales/*.js`

**Interfaces:**
- Consumes: Task 5 (`habit_checks`, `p_share_habits`, erros); `profile.habits_enabled`; `Progress.habits.week.q`; `HabitsSetup`.
- Produces: `ChallengeTemplate` com `habit_checks`; `TEMPLATES` com `'habit_checks'` no fim; `MODES.habit_checks = ['team', 'solo']`; `TARGET_STEP` 1; `GRACE` 2; `targetRange` com 10 × dias (solo) e × (1 + convidados) (equipe); `suggestHabitTarget(q: number, perWeekSum: number, days: number): number` (Decisão 19); `ChallengeProblem` com `'habits_off' | 'habits'`; `checkChallenge(c, today, { nutritionOn, sleepOn, habitsOn })`; `NewChallenge.share_habits: boolean`; `createChallenge` com `p_share_habits` nomeado; `joinChallenge(id, { shareVolume, shareNutrition, shareSleep, shareHabits })`.

- [ ] **Step 1: Testes que falham.**
  - `templates.test.ts`: faixas (solo 140 em 14 dias ok, 141 não; equipe com 2 convidados até 420); `resultOn` = `ends_on + 2`; `checkChallenge` dá `habits_off` antes de `habits`; `suggestHabitTarget(10, 10, 14)` = 20, `(0, 6, 7)` = 6, `(0, 0, 7)` = 1.
  - `challenge-rules-parity.test.ts`: os casos de hábitos contra `create_challenge` com `p_share_habits`, `habits_off` → `habits_off` e `habits` → `habits_opt_in_required`.
  - `social-api.test.ts`: `create_challenge` e `join_challenge` recebem todos os parâmetros nomeados, incluindo `p_share_habits`.
  - `NewChallengeSheet.test.tsx`: modelo desabilitado com explicação e atalho para `HabitsSetup` com o pilar desligado; opt-in obrigatório com o texto de que só a contagem de checks aparece; meta sugerida pelo Q.
  - `ChallengeDetail.test.tsx`: placar em "checks", "Contando até anteontem", "Resultado sai em <data>", sem `ChallengeFeed`; entrar pede o opt-in; erros `habits_opt_in_required` e `habits_off` com texto.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** implementar; strings nos 16 packs (humanizer).
- [ ] **Step 4:** `npx vitest run supabase/tests/challenge-rules-parity.test.ts src/features/social` → PASS; locale scripts; gate.
- [ ] **Step 5: Commit** `feat(social): habit checks challenge in the app` com o trailer.

### Task 14: Privacidade, publicação e documentação

**Files:**
- Modify: `public/privacidade.html` + `src/lib/privacy-page.test.js`, `scripts/build-release-sql.mjs` + `scripts/build-release-sql.test.mjs`, `supabase/tests/release-bundle.test.ts`, `docs/SETUP.md`, `docs/ROADMAP.md`, spec da Fase 4 (status e ponteiro para as decisões deste plano)
- Create: `supabase/release/0026-0030_habits.sql` (gerado)

**Interfaces:**
- Produces: `RELEASES` com `{ name: '0026-0030_habits', first: 26, last: 30, title: 'migrations 0026 to 0030 (Habits, phase 4a)', needs: '0001 to 0025' }`; os três arquivos antigos continuam idênticos.

- [ ] **Step 1: Testes que falham.**
  - `privacy-page.test.js`: a página cita os Hábitos em pt-BR e en (o que é guardado: nomes, ícones, metas e checks; que é opcional; que só a pessoa vê; amigos veem nível e XP e se o pilar estava ligado; no desafio só a contagem de checks de quem deu opt-in); o parágrafo de consentimento lista a contagem de hábitos no desafio; data de atualização nova nas duas línguas; sem travessão como pausa.
  - `build-release-sql.test.mjs`: as quatro faixas em ordem; `0026-0030_habits` com as cinco migrations em ordem; cabeçalho "already has 0001 to 0025"; arquivo commitado igual ao gerado.
  - `release-bundle.test.ts`, `describe('release bundle 0026-0030')`: banco com `0001` a `0006` e os bundles da Nutrição, do check-in e do Sono, com linhas existentes (perfil com Sono ligado, noite registrada, desafio `sleep_nights_on_target` ativo); aplica o bundle dos Hábitos de uma vez; confere `count(*)` = 1 para `create_challenge` e `join_challenge`, RLS ligada em `habits`, `habit_checks`, `habit_targets`, `habit_periods` e `habit_days`, o perfil antigo com `habits_enabled = false`, e o desafio de sono ainda conta a noite depois de `close_all_sleep_nights()`.
- [ ] **Step 2:** rodar → FAIL; `node scripts/build-release-sql.mjs`; PASS.
- [ ] **Step 3: SETUP.** Seção nova "Roteiro: banco de produção que já tem a 0001 a 0025 (Hábitos)", no estilo da do Sono: rode o SQL e faça o merge **no mesmo dia** (spec §15, por causa de `create_challenge` e `join_challenge`; o cliente do Sono continua funcionando com os parâmetros nomeados, mas não oferece os Hábitos; o cliente novo manda `p_share_habits`, então o SQL vem antes); confira o `pg_cron`; rode `supabase/release/0026-0030_habits.sql` inteiro ou as cinco migrations em ordem; conferências: `select proname, count(*) from pg_proc where proname in ('create_challenge','join_challenge') group by 1` = 1 cada, `relrowsecurity` das cinco tabelas, `select jobname, schedule, command from cron.job where jobname = 'close-habit-days'` = `close-habit-days | 50 6 * * * | select public.close_all_habit_days()`; `notify pgrst, 'reload schema';` se o app não achar a função; merge e deploy; pedir ao grupo para fechar e abrir o app antes do primeiro desafio de hábitos; smoke (ligar o pilar e criar o primeiro hábito, marcar pela Home no celular, desfazer, ver o XP dois dias depois, ver o radar depois da semana fechar, desafio entre duas contas). §7 (cron) passa a esperar seis linhas, com `close-habit-days` às 06:50 UTC, e um parágrafo sobre o job.
- [ ] **Step 4:** ROADMAP: linha da Fase 4 com "4a em produção" (data e links da spec e do plano) e a 4b pendente; seção da Fase 4 atualizada com o que a 4a entregou; item novo "lembretes por notificação push" depois da Fase 4. Spec: status com a data e o ponteiro para "Decisões do plano" deste arquivo. Textos pelo humanizer.
- [ ] **Step 5:** `node scripts/check-locales.mjs && node scripts/check-source-strings.mjs --strict && npm run typecheck && npm test && npm run build`.
- [ ] **Step 6: Commit** `docs: privacy, setup and release bundle for habits` com o trailer.

> **Revisão (controlador):** Tasks 13 e 14.

> **Revisão final (controlador):** revisor do branch inteiro contra a spec (Partes A e C), com foco
> em produção (bundle sobre a base com o Sono, corpos redefinidos com os ramos de Treino, Nutrição e
> Sono, cliente antigo durante o deploy, metas no meio da semana, privacidade dos hábitos para amigos
> e desafios).
