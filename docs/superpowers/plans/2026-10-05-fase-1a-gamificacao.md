# Fase 1a — Gamificação individual: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** consistência vira progresso visível: o Postgres calcula XP, níveis, streak semanal com
escudos e conquistas a partir de `activity_events`; o app mostra isso numa Home nova em shadcn, num
resumo pós-treino com XP contando e celebrações, e numa galeria de conquistas.

**Architecture:** o servidor é a autoridade. Um trigger `after insert` em `activity_events`
(`award_xp`) escreve no `xp_ledger` com as regras do pilar Força, usando a meta semanal congelada em
`weekly_targets`; semanas fecham de forma preguiçosa em `get_my_progress` e por um job `pg_cron`
diário; conquistas são avaliadas em SQL a partir de um catálogo em tabela espelhado em TS. O cliente
tem uma store `useProgress` (cache offline) e uma prévia otimista (`xp.ts` + `preview.ts`) que é
reconciliada com a resposta do servidor. Um arquivo JSON de cenários roda contra o TS e contra o SQL.

**Tech Stack:** Postgres (Supabase) com PL/pgSQL, `pg_cron`; `@electric-sql/pglite` + Vitest para os
testes SQL; React 19, Zustand 5, TypeScript, Tailwind v4, shadcn/ui, `motion` (`motion/react`),
`lucide-react`, `@testing-library/react`.

**Spec:** `docs/superpowers/specs/2026-10-04-performance-app-foundation-design.md` (ler §4.2, §4.4
linha `get_my_progress`, §5 inteiro, §7.4, §7.5, §10). Roadmap: `docs/ROADMAP.md`, Fase 1a. Regras
do projeto: `CLAUDE.md`. Plano anterior (modelo de estilo e do que já existe):
`docs/superpowers/plans/2026-10-04-fase-0-fundacao.md`.

## Global Constraints

- Trabalhar no branch `main` (já contém a Fase 0). Commits locais; **não fazer push**.
- Regras de XP do pilar Força (spec §5.2), com `T = days_per_week` congelado na semana: sessão planejada até a T-ésima `round(600 / T)` (T por semana); sessão além de T `25` (2 por semana); meta semanal batida `+150` (1 por semana); `pr` `30` (3 por semana); `weight_logged` `10` (1 por dia). Máximo semanal do pilar **960 XP para qualquer T**.
- Mudar `days_per_week` vale a partir da semana seguinte.
- Níveis: XP do nível n para n+1 = `100 + 50·(n−1)`. Nível geral (todo o XP, inclusive bônus) e por pilar.
- Streak `training_week`: semanas seguidas com a meta batida; escudo +1 a cada 4 semanas de streak, máximo 2; semana falhada com escudo consome 1 e o streak continua; sem escudo `current = 0`; a semana em curso nunca quebra o streak.
- Semana começa na segunda 00:00 no fuso do perfil (`profiles.timezone`, padrão `America/Sao_Paulo`).
- Catálogo de conquistas v1 (spec §5.5), XP como bônus geral (`pillar = null`): `first_workout` 50; `workouts_10/50/100/250/500` 100/200/300/500/800; `first_pr` 50; `prs_10/50` 150/400; `week_target_1` 75; `streak_4/12/26/52` 150/400/800/1500; `weigh_in_7` 100; `level_10/25/50` 0; `first_friend` 50; `challenge_first/won_5` 200/500; `early_bird` 100 (5 treinos antes das 7h).
- RLS ligada em toda tabela nova. Funções `security definer` com `set search_path = public`. O Supabase (e o shim dos testes em `supabase/tests/helpers/db.ts`) concede tudo em `public` a `anon` e `authenticated` por padrão: toda função interna leva `revoke all ... from public, anon, authenticated`; as RPCs de cliente levam `revoke all ... from public, anon` + `grant execute ... to authenticated`; tabelas novas levam `revoke insert, update, delete, truncate ... from anon, authenticated`.
- Fechamento de semana: preguiçoso em `get_my_progress` + `pg_cron` diário às 06:00 UTC.
- Código novo em TypeScript em `src/features/`, `src/lib/*.ts`; legado JS só onde a tarefa manda.
- Texto público (CLAUDE.md): sem travessão nem hífen como pausa (`—`, `–`, ` - `); passar pelo humanizer (`anthropic-skills:humanizer` em pt-BR, `humanizer` em inglês); toda chave nova nos 16 packs de `src/locales/` (pt-BR em `PT_BR_OVERRIDES`); `node scripts/check-locales.mjs` e `node scripts/check-source-strings.mjs --strict` passando.
- Motion: transições 150–300 ms com curva de saída (`--ease-out`); `prefers-reduced-motion` desliga deslocamento e mantém só fade. Alvos de toque ≥ 44 px; safe areas; pilar sempre com ícone + nome.
- Commits pequenos, mensagem em inglês `type: summary`, terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Depois de cada tarefa: `npm run typecheck && npm test && npm run build` verdes.

## Decisões

Pontos que a spec deixa em aberto, fechados aqui ao ler o código da Fase 0.

1. **Onde a meta T fica congelada.** Tabela `weekly_targets(user_id, week_start, target)`. A função
   `week_target_for(user, week)` devolve a linha da semana; se não existe, cria com o valor em vigor
   naquela semana: o da próxima semana já congelada depois dela ou, se não houver, o
   `profiles.days_per_week` atual. Três caminhos congelam a semana corrente: o primeiro evento da
   semana (trigger de XP), a primeira chamada de `get_my_progress` na semana e o job diário. Para
   que uma mudança feita antes de qualquer um deles não vaze para a semana em curso, um trigger
   `before update of days_per_week` em `profiles` congela a semana corrente com o valor **antigo**.
2. **Fronteira de semana.** `occurred_on` já é a data local do evento; `week_start_of(d)` devolve a
   segunda-feira ISO dessa data. "Hoje" de um usuário é `local_today(user)` =
   `(app_now() at time zone profiles.timezone)::date`. `app_now()` é `now()`, exceto numa sessão de
   superusuário com `app.now` setado (só os testes SQL fazem isso); o PostgREST conecta como
   `authenticator`, que não é superusuário, então nenhum cliente consegue mover o relógio.
3. **Arredondamento de T = 7.** `round(600/7) = 86` daria 602 por semana e quebraria o teto de 960.
   As sessões planejadas pagam `round(600/T)` e a T-ésima paga o resto (`600 − round(600/T)·(T−1)`,
   84 para T = 7). A soma é sempre 600 e o máximo semanal é exatamente 960 para todo T. A spec é
   atualizada na Task 14.
4. **XP idempotente e eventos retroativos.** A unicidade `(user_id, kind, source_ref)` de
   `activity_events` já barra o reenvio antes de o trigger rodar. O trigger `award_xp` trava por
   usuário (`pg_advisory_xact_lock(hashtextextended('xp:' || user_id, 0))`), conta o que o ledger já
   pagou **na semana do próprio evento** (`week_start_of(occurred_on)`) e decide o valor. Peso paga
   uma vez por `occurred_on` mesmo com `source_ref` diferente. Bônus sem evento (conquistas, desafios
   da 1b) são únicos por `(user_id, reason)` via índice parcial. Um treino retroativo que bate a meta
   de uma semana já fechada reconstrói o streak do zero (`close_weeks(user, true)`).
5. **Fechamento de semana.** `close_weeks(user)` avalia as semanas fechadas desde `streaks.last_period`
   (ou desde a primeira semana com atividade/cadastro) até a semana anterior à corrente.
   `get_my_progress` chama antes de responder. A migration `0003_gamification_cron.sql` agenda
   `close_all_weeks()` às 06:00 UTC só se `pg_cron` existir em `pg_available_extensions`; no PGlite
   ela não faz nada. O passo de habilitar o `pg_cron` no Supabase vai para `docs/SETUP.md`.
6. **Conquistas em SQL com catálogo espelhado.** Tabela `achievement_catalog(code, metric,
   threshold, xp, sort)` com as 22 conquistas; `achievements_for_stats(stats jsonb, unlocked text[])`
   é a avaliação pura, espelhada por `evaluateAchievements` em `src/features/gamification/achievements.ts`.
   `achievement_stats(user)` calcula as métricas (`workouts`, `prs`, `week_targets`, `best_streak`,
   `weigh_in_run`, `early_workouts`); `level` entra depois dos bônus. `friends` e `challenges_won`
   nunca são calculados na 1a: as conquistas sociais existem no catálogo e só a 1b as libera, via
   `award_achievement`. XP de conquista entra como `pillar = null`, `reason = 'achievement:<code>'`,
   na semana local corrente do desbloqueio.
7. **`early_bird`.** O app passa a mandar `hour` (hora local de início, 0–23) no payload de
   `workout_completed` de sessões ao vivo. Sessões retroativas não mandam e não contam.
8. **Paridade.** `supabase/tests/fixtures/xp-scenarios.json` (níveis, semanas, streaks) e
   `supabase/tests/fixtures/achievement-scenarios.json` rodam em `src/features/gamification/*.test.ts`
   e em `supabase/tests/gamification-parity.test.ts` / `gamification-catalog.test.ts`. O teste SQL
   desliga só a validação de janela de 14 dias (`activity_events_validate`) para usar datas fixas de
   setembro de 2026; o trigger de XP continua ligado.
9. **Espelho no cliente.** A spec cita `lib/xp.ts`; pela estrutura de pastas da §3.2 ele mora em
   `src/features/gamification/xp.ts` (regras puras) e `preview.ts` (prévia a partir do progresso).
10. **Reconciliação.** Ao concluir um treino, o resumo mostra a prévia na hora. Em paralelo,
    `syncProgress()` esvazia a fila de eventos e chama `get_my_progress`. Se a fila esvaziou, o
    resumo troca a prévia pelas linhas derivadas da diferença entre o progresso de antes e o de
    depois (`linesFromProgress`), e o contador anima até o valor do servidor. Se não esvaziou
    (offline), a prévia fica marcada como estimativa.
11. **Celebrações.** Um marcador por usuário em `localStorage` (`perf_celebrated_v1`: nível e códigos
    já celebrados) define o que é novo. `CelebrationHost`, montado no `App`, mostra level-up e
    conquistas em sequência numa camada própria (z-index acima do `#modal-root` legado, que é 100).
    O resumo pós-treino segura o host (`hold(true)`) até o XP terminar de contar, então as cartas
    aparecem por cima dele, na ordem certa. Na primeira carga de um usuário o marcador nasce com o
    estado atual, sem celebrar o passado.
12. **Home.** `src/views/Home.jsx` vira um reexport de `src/features/home/HomeScreen.tsx`, para
    `App.jsx` e os testes existentes continuarem importando o mesmo caminho. O cartão legado de
    streak (calculado no cliente por `streakWeeks`) sai da Home: o streak do servidor fica no
    cartão de progresso, o calendário ganha um botão no cartão "Hoje" e o total de treinos fica
    abaixo da faixa da semana. `Stats` continua mostrando o streak legado até ser migrada (Fase 2+).
    O número de streak exibido soma 1 quando a meta da semana corrente já foi batida, porque essa
    semana já está garantida (`displayStreak`).
13. **Peso.** O toast legado "Peso salvo" vira "Peso salvo. +10 XP" quando a pesagem é a primeira
    do dia, sem um segundo toast.
14. **Contagem de XP.** A contagem dura 700 ms (é a celebração em si, não uma transição de tela). Com
    `prefers-reduced-motion` o número aparece direto no valor final.
15. **Galeria.** `get_my_progress` devolve também `stats` (as métricas do usuário) para a galeria
    mostrar "7 de 10" nas conquistas bloqueadas. É dado do próprio usuário; o cartão público para a
    1b (`progress_card`) não inclui `stats` nem `weighed_today`.

### Inventário da Home legada (tudo continua funcionando)

| Recurso em `Home.jsx` | Onde fica | Teste que protege |
|---|---|---|
| Saudação `Hi {0}` com nome do perfil, data longa | `HomeScreen` cabeçalho | `Home.avatar.test.jsx` |
| Botão Configurações (`/settings`) e avatar (`/perfil`, só com conta) | `HomeScreen` cabeçalho | `Home.avatar.test.jsx` |
| Navegação de semanas (anterior/próxima), rótulo "This week" ou intervalo | `TodayCard` | `TodayCard.test.tsx` |
| Faixa de 7 dias com estado (feito, planejado, remarcado), toque abre `dayOverrideSheet` | `TodayCard` | `TodayCard.test.tsx` |
| Linha "Hoje": retomar, editar, concluído, iniciar plano, descanso + próxima sessão, remarcado | `TodayCard` (`data-testid="today-row"`) | `Home.startdoor.test.jsx` |
| "Choose a different workout" (vai para `/workout` sem iniciar nada) | `TodayCard` | `Home.startdoor.test.jsx` |
| Cartão de check-in (`/checkin`) quando `S.checkIn !== false` | `CheckInCard` | `HomeScreen.test.tsx` |
| Boas-vindas sem rotinas: "Load starter plan" (`starterPlanSheet()`), "Build my own plan" (`/plan`) | `WelcomeCard` | `starter-entry.test.jsx` |
| Cartão de peso (`S.showWeightCard !== false`): meta (`goalSheet`), registrar (`bwSheet`), variação, meta restante, gráfico, "All weigh-ins" | `BodyWeightCard` | `Home.weight-card.test.jsx`, `HomeScreen.test.tsx` |
| Streak semanal, treinos na semana, total de treinos, toque abre `calendarSheet` | streak/semana no `ProgressHero`; calendário e total no `TodayCard` | `ProgressHero.test.tsx`, `TodayCard.test.tsx` |

Funções de `sheets.jsx` são chamadas só dentro de handlers (`() => bwSheet()`), nunca lidas durante
o render. Os testes legados mockam `../sheets.jsx` com listas diferentes de exports, e o mock do
Vitest lança erro quando um export ausente é acessado.

## File Structure

```
supabase/
├─ migrations/
│  ├─ 0002_gamification.sql         relógio, semana, nível, weekly_targets, xp_ledger, streaks,
│  │                                award_xp, close_weeks, catálogo e conquistas, progress_card,
│  │                                get_my_progress, close_all_weeks
│  └─ 0003_gamification_cron.sql    agenda close_all_weeks no pg_cron (no-op sem a extensão)
└─ tests/
   ├─ helpers/game.ts               relógio, usuários, eventos e ledger para os testes
   ├─ fixtures/xp-scenarios.json    níveis, semanas e streaks (paridade)
   ├─ fixtures/achievement-scenarios.json
   ├─ gamification-base.test.ts     semana, nível, metas congeladas, RLS
   ├─ gamification-xp.test.ts       regras de XP
   ├─ gamification-streak.test.ts   streak, escudos, fuso, retroativo
   ├─ gamification-achievements.test.ts
   ├─ gamification-progress.test.ts get_my_progress, close_all_weeks, cron
   ├─ gamification-parity.test.ts   fixture de XP no SQL
   └─ gamification-catalog.test.ts  catálogo TS = SQL; fixture de conquistas no SQL
src/
├─ lib/database.types.ts            + tabelas e RPC da 1a
├─ lib/use-online.ts                hook useOnline (saído do SyncIndicator)
├─ features/gamification/
│  ├─ xp.ts                         regras puras (sessão, nível, semana, replay, streak)
│  ├─ achievements.ts               catálogo + evaluateAchievements (puro)
│  ├─ achievement-labels.ts         títulos e descrições via t()
│  ├─ types.ts                      Progress, XpLine, Celebration, SyncResult
│  ├─ progress-api.ts               fetchProgress (RPC)
│  ├─ preview.ts                    previewWorkout, linesFromProgress, displayStreak
│  ├─ celebrations.ts               marcador e diferença de celebrações
│  ├─ useProgress.ts                store + startProgressSync
│  ├─ after-event.ts                syncProgress, weighInXp
│  ├─ format.ts                     fmtInt
│  ├─ useCountUp.ts                 contador animado
│  ├─ components/LevelBar.tsx
│  ├─ components/StreakBadge.tsx
│  ├─ components/AchievementIcon.tsx
│  ├─ components/CelebrationOverlay.tsx
│  ├─ CelebrationHost.tsx
│  ├─ WorkoutXpSummary.tsx          bloco de XP do resumo pós-treino
│  └─ AchievementsScreen.tsx        /conquistas
├─ features/home/
│  ├─ HomeScreen.tsx                composição da Home
│  ├─ ProgressHero.tsx              nível, XP, streak, semana, conquistas
│  ├─ TodayCard.tsx                 semana, dias, linha Hoje, calendário
│  ├─ BodyWeightCard.tsx
│  └─ HomeCards.tsx                 WelcomeCard, CheckInCard
├─ features/profile/ProfileScreen.tsx   + ProfileProgress
├─ features/sync/SyncIndicator.tsx      usa lib/use-online.ts
├─ views/Home.jsx                   reexporta HomeScreen
├─ sheets.jsx                       payload hour, prévia, WorkoutXpSummary, XP da pesagem
├─ App.jsx                          carga do progresso, CelebrationHost, rota /conquistas
└─ locales/*.js                     chaves novas nos 16 packs
docs/SETUP.md, docs/ROADMAP.md, spec   atualizados
```

---

### Task 1: Banco: relógio, semana, nível e meta congelada

**Files:**
- Create: `supabase/migrations/0002_gamification.sql`
- Create: `supabase/tests/helpers/game.ts`
- Test: `supabase/tests/gamification-base.test.ts`

**Interfaces:**
- Consumes: `public.profiles`, `public.activity_events`, `auth.uid()` de `0001_init.sql`; `freshDb`, `addUser`, `asUser` de `supabase/tests/helpers/db.ts`.
- Produces (SQL): `app_now() → timestamptz`; `week_start_of(date) → date`; `local_today(uuid) → date`; `local_week_start(uuid) → date`; `level_for(bigint, out level int, out into_level int, out need int)`; `level_json(bigint) → jsonb {level, into, need}`; `session_xp(target int, index int) → int`; `week_target_for(uuid, date) → smallint`; tabelas `weekly_targets`, `xp_ledger` (índice parcial `xp_ledger_bonus_once`), `streaks`; trigger `profiles_freeze_target`.
- Produces (TS, `supabase/tests/helpers/game.ts`): `A`, `B` (uuids), `setClock(db, iso | null)`, `withoutEventWindow(db)`, `makeUser(db, uid, over?)`, `event(db, uid, kind, on, ref, payload?)`, `ledger(db, uid) → LedgerRow[]`, `sql<T>(db, q, params?) → T[]`.

- [ ] **Step 1: Helper dos testes**

Criar `supabase/tests/helpers/game.ts`:

```ts
import type { PGlite } from '@electric-sql/pglite'
import { addUser } from './db'

export const A = '00000000-0000-0000-0000-00000000000a'
export const B = '00000000-0000-0000-0000-00000000000b'

export async function sql<T = Record<string, any>>(db: PGlite, q: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(q, params)).rows
}

// Pins the clock app_now() reads (superuser sessions only, which the tests are). null unpins it.
export async function setClock(db: PGlite, at: string | null) {
  await db.query(`select set_config('app.now', $1, false)`, [at ?? ''])
}

// validate_activity_event checks the 14-day window against the real clock. Tests that live on
// fixed dates switch that one check off; the XP trigger stays on.
export async function withoutEventWindow(db: PGlite) {
  await db.exec('alter table public.activity_events disable trigger activity_events_validate')
}

export async function makeUser(db: PGlite, uid: string, over: Record<string, unknown> = {}) {
  await addUser(db, uid)
  const row = { id: uid, display_name: 'Ana', days_per_week: 3, ...over }
  const cols = Object.keys(row)
  await db.query(
    `insert into public.profiles (${cols.join(',')}) values (${cols.map((_, i) => '$' + (i + 1)).join(',')})`,
    Object.values(row)
  )
}

// Inserted as the database owner with user_id set, which is what the triggers see from a client.
export async function event(db: PGlite, uid: string, kind: string, on: string, ref: string, payload: Record<string, unknown> = {}) {
  await db.query(
    `insert into public.activity_events (user_id, pillar, kind, occurred_on, payload, source_ref)
     values ($1, 'strength', $2, $3, $4::jsonb, $5)`,
    [uid, kind, on, JSON.stringify(payload), ref]
  )
}

export type LedgerRow = { reason: string; amount: number; week_start: string; pillar: string | null }

export async function ledger(db: PGlite, uid: string): Promise<LedgerRow[]> {
  return sql<LedgerRow>(db,
    `select reason, amount, to_char(week_start, 'YYYY-MM-DD') as week_start, pillar::text as pillar
       from public.xp_ledger where user_id = $1 order by id`, [uid])
}
```

- [ ] **Step 2: Teste que falha**

Criar `supabase/tests/gamification-base.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, asUser } from './helpers/db'
import { A, B, makeUser, setClock, sql } from './helpers/game'

let db: PGlite

beforeEach(async () => {
  db = await freshDb()
  await makeUser(db, A)
  await makeUser(db, B, { days_per_week: 4, timezone: 'Asia/Tokyo' })
})

describe('levels', () => {
  it.each([
    [0, 1, 0, 100], [99, 1, 99, 100], [100, 2, 0, 150], [250, 3, 0, 200], [2700, 10, 0, 550]
  ])('level_for(%i)', async (xp, level, into, need) => {
    const [r] = await sql(db, 'select level, into_level, need from public.level_for($1)', [xp])
    expect(r).toEqual({ level, into_level: into, need })
  })

  it('level_json uses the keys the app reads', async () => {
    const [r] = await sql(db, 'select public.level_json(260) as j')
    expect(r.j).toEqual({ level: 3, into: 10, need: 200 })
  })
})

describe('planned sessions', () => {
  it('add up to exactly 600 for every weekly target', async () => {
    for (let t = 1; t <= 7; t++) {
      const [r] = await sql<{ total: number }>(db, 'select sum(public.session_xp($1, k))::int as total from generate_series(1, $1) k', [t])
      expect(r.total, `T=${t}`).toBe(600)
    }
    const [seven] = await sql(db, 'select public.session_xp(7, 1) as first, public.session_xp(7, 7) as last')
    expect(seven).toEqual({ first: 86, last: 84 })
  })
})

describe('weeks', () => {
  it('start on Monday', async () => {
    const rows = await sql<{ w: string }>(db,
      `select to_char(public.week_start_of(d::date), 'YYYY-MM-DD') as w
         from unnest(array['2026-10-05', '2026-10-11', '2026-10-12']) d`)
    expect(rows.map(r => r.w)).toEqual(['2026-10-05', '2026-10-05', '2026-10-12'])
  })

  it('follow the profile time zone', async () => {
    // Sunday 23:30 UTC: still Sunday in São Paulo, already Monday in Tokyo.
    await setClock(db, '2026-10-04T23:30:00Z')
    const [r] = await sql(db,
      `select to_char(public.local_week_start($1), 'YYYY-MM-DD') as a, to_char(public.local_week_start($2), 'YYYY-MM-DD') as b`, [A, B])
    expect(r).toEqual({ a: '2026-09-28', b: '2026-10-05' })
  })

  it('ignore the test clock outside a superuser session', async () => {
    await setClock(db, '2000-01-01T00:00:00Z')
    await db.exec('set session authorization authenticated')
    try {
      const [r] = await sql<{ y: number }>(db, 'select extract(year from public.app_now())::int as y')
      expect(r.y).toBeGreaterThan(2000)
    } finally {
      await db.exec('reset session authorization')
      await setClock(db, null)
    }
  })
})

describe('weekly targets', () => {
  beforeEach(() => setClock(db, '2026-10-07T15:00:00Z'))

  it('freeze the profile value for the week; a change applies next week', async () => {
    const [r] = await sql(db, `select public.week_target_for($1, '2026-10-05') as t`, [A])
    expect(r.t).toBe(3)
    await asUser(db, A, () => db.query('update public.profiles set days_per_week = 5'))
    const [again] = await sql(db, `select public.week_target_for($1, '2026-10-05') as t`, [A])
    expect(again.t).toBe(3)
    const [next] = await sql(db, `select public.week_target_for($1, '2026-10-12') as t`, [A])
    expect(next.t).toBe(5)
  })

  it('keep the old value when the profile changes before anything touched the week', async () => {
    await asUser(db, B, () => db.query('update public.profiles set days_per_week = 2'))
    const rows = await sql(db,
      `select to_char(week_start, 'YYYY-MM-DD') as w, target from public.weekly_targets where user_id = $1`, [B])
    expect(rows).toEqual([{ w: '2026-10-05', target: 4 }])
  })

  it('give an untouched past week the value frozen after it', async () => {
    await sql(db, `select public.week_target_for($1, '2026-10-05')`, [A])
    await asUser(db, A, () => db.query('update public.profiles set days_per_week = 6'))
    const [r] = await sql(db, `select public.week_target_for($1, '2026-09-28') as t`, [A])
    expect(r.t).toBe(3)
  })
})

describe('privacy', () => {
  it('lets users read only their own rows and write none', async () => {
    await sql(db, `insert into public.xp_ledger (user_id, pillar, amount, reason, week_start) values ($1, 'strength', 10, 'seed', '2026-10-05')`, [A])
    expect((await asUser(db, A, () => db.query('select amount from public.xp_ledger'))).rows).toEqual([{ amount: 10 }])
    expect((await asUser(db, B, () => db.query('select * from public.xp_ledger'))).rows).toEqual([])
    await expect(asUser(db, A, () => db.query(`insert into public.xp_ledger (user_id, amount, reason, week_start) values ($1, 999, 'cheat', '2026-10-05')`, [A]))).rejects.toThrow(/permission denied/)
    await expect(asUser(db, A, () => db.query(`insert into public.weekly_targets values ($1, '2026-10-05', 1)`, [A]))).rejects.toThrow(/permission denied/)
    await expect(asUser(db, A, () => db.query(`insert into public.streaks (user_id, kind, current) values ($1, 'training_week', 99)`, [A]))).rejects.toThrow(/permission denied/)
    await expect(asUser(db, A, () => db.query(`select public.week_target_for($1, '2026-10-05')`, [A]))).rejects.toThrow(/permission denied/)
  })
})
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run supabase/tests/gamification-base.test.ts`
Expected: FAIL com `function public.level_for(...) does not exist`.

- [ ] **Step 4: Migration, parte 1**

Criar `supabase/migrations/0002_gamification.sql`:

```sql
-- Phase 1a: XP ledger, weekly targets, streaks and achievements. The server is the authority:
-- clients only insert activity_events; everything below is written by security definer functions.

-- Clock and calendar ----------------------------------------------------------------------------

-- now(), except in the SQL tests: a superuser session may pin it with
-- set_config('app.now', '<timestamptz>', false). PostgREST connects as a role that is not a
-- superuser, so no client can move it.
create or replace function public.app_now() returns timestamptz
language sql stable as $$
  select case
    when coalesce(current_setting('app.now', true), '') <> ''
     and coalesce((select rolsuper from pg_roles where rolname = session_user), false)
    then current_setting('app.now', true)::timestamptz
    else now()
  end
$$;

-- Monday of the week a local date belongs to.
create or replace function public.week_start_of(d date) returns date
language sql immutable as $$
  select d - (extract(isodow from d)::int - 1)
$$;

create or replace function public.local_today(p_user uuid) returns date
language sql stable security definer set search_path = public as $$
  select (public.app_now() at time zone coalesce(
    (select timezone from public.profiles where id = p_user), 'America/Sao_Paulo'))::date
$$;

create or replace function public.local_week_start(p_user uuid) returns date
language sql stable security definer set search_path = public as $$
  select public.week_start_of(public.local_today(p_user))
$$;

-- Levels: level n needs 100 + 50·(n − 1) XP to reach n + 1 ------------------------------------

create or replace function public.level_for(p_xp bigint, out level integer, out into_level integer, out need integer)
language plpgsql immutable as $$
declare
  v_left bigint := greatest(coalesce(p_xp, 0), 0);
begin
  level := 1;
  need := 100;
  while v_left >= need loop
    v_left := v_left - need;
    level := level + 1;
    need := 100 + 50 * (level - 1);
  end loop;
  into_level := v_left;
end $$;

create or replace function public.level_json(p_xp bigint) returns jsonb
language sql immutable as $$
  select jsonb_build_object('level', l.level, 'into', l.into_level, 'need', l.need)
  from public.level_for(p_xp) l
$$;

-- What the index-th planned session of a week with target T pays. The T-th takes the remainder,
-- so the planned sessions of any week add up to exactly 600 (T = 7: six of 86 and one of 84).
create or replace function public.session_xp(p_target integer, p_index integer) returns integer
language sql immutable as $$
  select case when p_index < p_target then round(600.0 / p_target)::int
              else 600 - round(600.0 / p_target)::int * (p_target - 1) end
$$;

-- Tables -----------------------------------------------------------------------------------------

-- days_per_week as it stood when each week began; a change made mid-week applies next week.
create table public.weekly_targets (
  user_id    uuid not null references auth.users on delete cascade,
  week_start date not null check (extract(isodow from week_start) = 1),
  target     smallint not null check (target between 1 and 7),
  primary key (user_id, week_start)
);

create table public.xp_ledger (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users on delete cascade,
  pillar     public.pillar,              -- null = general bonus (achievement, challenge)
  amount     integer not null check (amount > 0),
  reason     text not null check (char_length(reason) between 1 and 80),
  event_id   bigint references public.activity_events on delete cascade,
  week_start date not null check (extract(isodow from week_start) = 1),
  created_at timestamptz not null default now()
);
create index xp_ledger_user_week on public.xp_ledger (user_id, week_start);
create index xp_ledger_event on public.xp_ledger (event_id);
-- A bonus without an event (an achievement, a challenge won) is paid once per reason.
create unique index xp_ledger_bonus_once on public.xp_ledger (user_id, reason) where event_id is null;

create table public.streaks (
  user_id     uuid not null references auth.users on delete cascade,
  kind        text not null,
  current     integer not null default 0,
  best        integer not null default 0,
  shields     smallint not null default 0 check (shields between 0 and 2),
  last_period date,
  primary key (user_id, kind)
);

alter table public.weekly_targets enable row level security;
alter table public.xp_ledger enable row level security;
alter table public.streaks enable row level security;
create policy weekly_targets_select_own on public.weekly_targets for select to authenticated using (user_id = auth.uid());
create policy xp_ledger_select_own on public.xp_ledger for select to authenticated using (user_id = auth.uid());
create policy streaks_select_own on public.streaks for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete, truncate on public.weekly_targets, public.xp_ledger, public.streaks from anon, authenticated;
grant select on public.weekly_targets, public.xp_ledger, public.streaks to authenticated;

-- Weekly target -----------------------------------------------------------------------------------

create or replace function public.week_target_for(p_user uuid, p_week date) returns smallint
language plpgsql security definer set search_path = public as $$
declare
  v smallint;
begin
  select target into v from public.weekly_targets where user_id = p_user and week_start = p_week;
  if found then return v; end if;
  -- A week nothing touched while it ran: the value in force then is the one frozen for the next
  -- touched week after it or, failing that, the profile's.
  select target into v from public.weekly_targets
   where user_id = p_user and week_start > p_week order by week_start limit 1;
  if v is null then select days_per_week into v from public.profiles where id = p_user; end if;
  insert into public.weekly_targets (user_id, week_start, target)
  values (p_user, p_week, coalesce(v, 3))
  on conflict do nothing;
  select target into v from public.weekly_targets where user_id = p_user and week_start = p_week;
  return v;
end $$;

-- Changing days_per_week freezes the running week with the old value first.
create or replace function public.freeze_week_target() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.days_per_week is distinct from old.days_per_week then
    insert into public.weekly_targets (user_id, week_start, target)
    values (old.id, public.local_week_start(old.id), old.days_per_week)
    on conflict do nothing;
  end if;
  return new;
end $$;

create trigger profiles_freeze_target before update of days_per_week on public.profiles
  for each row execute function public.freeze_week_target();

revoke all on function public.local_today(uuid), public.local_week_start(uuid),
  public.week_target_for(uuid, date), public.freeze_week_target() from public, anon, authenticated;
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run supabase/tests/gamification-base.test.ts`
Expected: PASS (todos). Se `set session authorization authenticated` falhar no PGlite com erro de
permissão, trocar o teste "ignore the test clock" por `select rolsuper from pg_roles where rolname = 'authenticated'` esperando `false` e manter o resto.

- [ ] **Step 6: Suíte e commit**

```bash
npm run typecheck && npm test
git add supabase/migrations/0002_gamification.sql supabase/tests/helpers/game.ts supabase/tests/gamification-base.test.ts
git commit -m "feat(db): weekly targets, local weeks and levels for gamification

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Banco: XP por evento (trigger `award_xp`)

**Files:**
- Modify: `supabase/migrations/0002_gamification.sql` (acrescentar ao fim)
- Test: `supabase/tests/gamification-xp.test.ts`

**Interfaces:**
- Consumes: `week_start_of`, `week_target_for`, `session_xp`, `xp_ledger` (Task 1); helpers de `game.ts`.
- Produces: função `award_xp()` e trigger `activity_events_award` (`after insert ... for each row`). Razões no ledger: `'workout'`, `'workout_extra'`, `'week_target'`, `'pr'`, `'weight'`. Chave do advisory lock: `hashtextextended('xp:' || user_id::text, 0)`.

- [ ] **Step 1: Teste que falha**

Criar `supabase/tests/gamification-xp.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, asUser } from './helpers/db'
import { A, makeUser, setClock, withoutEventWindow, event, ledger, sql } from './helpers/game'

let db: PGlite
const pinned = async () => {
  await withoutEventWindow(db)
  await setClock(db, '2026-09-16T15:00:00Z')
}
// Achievement bonuses (Task 4) land in the same ledger; these tests look at the event rules only.
const paid = async (uid = A) => (await ledger(db, uid)).filter(r => !r.reason.startsWith('achievement:'))
const pairs = async (uid = A) => (await paid(uid)).map(r => [r.reason, r.amount])
const week = (i: number) => `2026-09-${String(7 + i).padStart(2, '0')}`   // 0 = Monday 07 … 6 = Sunday 13

beforeEach(async () => {
  db = await freshDb()
  await makeUser(db, A)
})

describe('award_xp', () => {
  it('pays a client insert in the week of its own day', async () => {
    const [{ d }] = await sql<{ d: string }>(db, `select to_char((now() at time zone 'America/Sao_Paulo')::date, 'YYYY-MM-DD') as d`)
    await asUser(db, A, () => db.query(
      `insert into public.activity_events (pillar, kind, occurred_on, source_ref) values ('strength', 'workout_completed', $1, 's1')`, [d]))
    const rows = await paid()
    const [{ w }] = await sql<{ w: string }>(db, `select to_char(public.week_start_of($1::date), 'YYYY-MM-DD') as w`, [d])
    expect(rows).toEqual([{ reason: 'workout', amount: 200, week_start: w, pillar: 'strength' }])
  })

  it('pays round(600/T) per planned session and 150 when the T-th lands', async () => {
    await pinned()
    for (const i of [0, 2, 4]) await event(db, A, 'workout_completed', week(i), 'w' + i)
    expect(await pairs()).toEqual([['workout', 200], ['workout', 200], ['workout', 200], ['week_target', 150]])
  })

  it('lets the last planned session take the remainder', async () => {
    await pinned()
    // Frozen directly: changing the profile now would freeze the running week, and an untouched
    // past week takes the value frozen after it (Task 1).
    await sql(db, `insert into public.weekly_targets values ($1, '2026-09-07', 7)`, [A])
    for (let i = 0; i < 7; i++) await event(db, A, 'workout_completed', week(i), 'w' + i)
    expect(await pairs()).toEqual([...Array(6).fill(['workout', 86]), ['workout', 84], ['week_target', 150]])
  })

  it('pays 25 for at most two sessions beyond the target', async () => {
    await pinned()
    for (let i = 0; i < 6; i++) await event(db, A, 'workout_completed', week(i), 'w' + i)
    expect((await pairs()).slice(4)).toEqual([['workout_extra', 25], ['workout_extra', 25]])
  })

  it('pays 30 for at most three PRs a week', async () => {
    await pinned()
    for (let i = 0; i < 4; i++) await event(db, A, 'pr', week(i), 'p' + i)
    await event(db, A, 'pr', '2026-09-14', 'next-week')
    expect(await pairs()).toEqual([['pr', 30], ['pr', 30], ['pr', 30], ['pr', 30]])
    expect((await paid()).map(r => r.week_start)).toEqual(['2026-09-07', '2026-09-07', '2026-09-07', '2026-09-14'])
  })

  it('pays 10 for the first weigh-in of a day, whatever its reference', async () => {
    await pinned()
    await event(db, A, 'weight_logged', week(0), week(0))
    await event(db, A, 'weight_logged', week(0), week(0) + '-again')
    await event(db, A, 'weight_logged', week(1), week(1))
    expect(await pairs()).toEqual([['weight', 10], ['weight', 10]])
  })

  it('never pays more than 960 in a week, for any target', async () => {
    await pinned()
    for (let t = 1; t <= 7; t++) {
      const uid = `00000000-0000-0000-0000-0000000001${String(t).padStart(2, '0')}`
      await makeUser(db, uid, { days_per_week: t })
      for (let i = 0; i < t + 3; i++) await event(db, uid, 'workout_completed', week(i % 7), 'w' + i)
      for (let i = 0; i < 4; i++) await event(db, uid, 'pr', week(i), 'p' + i)
      for (let i = 0; i < 7; i++) await event(db, uid, 'weight_logged', week(i), week(i))
      await event(db, uid, 'weight_logged', week(0), 'twice')
      const total = (await paid(uid)).reduce((n, r) => n + r.amount, 0)
      expect(total, `T=${t}`).toBe(960)
    }
  })

  it('uses the target frozen for the event week, not the profile', async () => {
    await pinned()
    await sql(db, `insert into public.weekly_targets values ($1, '2026-09-07', 2)`, [A])
    for (let i = 0; i < 3; i++) await event(db, A, 'workout_completed', week(i), 'w' + i)
    expect(await pairs()).toEqual([['workout', 300], ['workout', 300], ['week_target', 150], ['workout_extra', 25]])
  })

  it('counts a session logged into the past in its own week', async () => {
    await pinned()
    await event(db, A, 'workout_completed', '2026-09-15', 'now')
    await event(db, A, 'workout_completed', '2026-09-08', 'backfill')
    expect((await paid()).map(r => r.week_start)).toEqual(['2026-09-14', '2026-09-07'])
  })

  it('pays a repeated event once', async () => {
    await pinned()
    await event(db, A, 'workout_completed', week(0), 'w1')
    await expect(event(db, A, 'workout_completed', week(0), 'w1')).rejects.toThrow(/duplicate key/)
    expect(await pairs()).toEqual([['workout', 200]])
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run supabase/tests/gamification-xp.test.ts`
Expected: FAIL (ledger vazio: `expected [] to equal [...]`).

- [ ] **Step 3: Implementar**

Acrescentar ao fim de `supabase/migrations/0002_gamification.sql`:

```sql
-- XP per event (strength pillar) ------------------------------------------------------------------

create or replace function public.award_xp() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_week   date := public.week_start_of(new.occurred_on);
  v_target smallint;
  v_count  integer;
begin
  -- One award at a time per user: the counts below decide the amount.
  perform pg_advisory_xact_lock(hashtextextended('xp:' || new.user_id::text, 0));
  if new.pillar <> 'strength' then return null; end if;

  if new.kind = 'workout_completed' then
    v_target := public.week_target_for(new.user_id, v_week);
    select count(*) into v_count from public.xp_ledger
     where user_id = new.user_id and week_start = v_week and reason = 'workout';
    if v_count < v_target then
      insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start)
      values (new.user_id, 'strength', public.session_xp(v_target, v_count + 1), 'workout', new.id, v_week);
      if v_count + 1 = v_target then
        insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start)
        values (new.user_id, 'strength', 150, 'week_target', new.id, v_week);
      end if;
    else
      select count(*) into v_count from public.xp_ledger
       where user_id = new.user_id and week_start = v_week and reason = 'workout_extra';
      if v_count < 2 then
        insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start)
        values (new.user_id, 'strength', 25, 'workout_extra', new.id, v_week);
      end if;
    end if;
  elsif new.kind = 'pr' then
    select count(*) into v_count from public.xp_ledger
     where user_id = new.user_id and week_start = v_week and reason = 'pr';
    if v_count < 3 then
      insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start)
      values (new.user_id, 'strength', 30, 'pr', new.id, v_week);
    end if;
  elsif new.kind = 'weight_logged' then
    if not exists (
      select 1 from public.xp_ledger l join public.activity_events e on e.id = l.event_id
       where l.user_id = new.user_id and l.reason = 'weight' and e.occurred_on = new.occurred_on
    ) then
      insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start)
      values (new.user_id, 'strength', 10, 'weight', new.id, v_week);
    end if;
  end if;
  return null;
end $$;

create trigger activity_events_award after insert on public.activity_events
  for each row execute function public.award_xp();

revoke all on function public.award_xp() from public, anon, authenticated;
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run supabase/tests/gamification-xp.test.ts supabase/tests/activity-events.test.ts`
Expected: PASS (o teste da Fase 0 continua verde: o trigger não muda o que o cliente vê de `activity_events`).

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npm test
git add supabase/migrations/0002_gamification.sql supabase/tests/gamification-xp.test.ts
git commit -m "feat(db): award strength XP from activity events

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Banco: streak semanal com escudos

**Files:**
- Modify: `supabase/migrations/0002_gamification.sql` (acrescentar `close_weeks`; substituir `award_xp`)
- Test: `supabase/tests/gamification-streak.test.ts`

**Interfaces:**
- Consumes: `local_week_start`, `week_start_of`, `streaks`, `xp_ledger` (`reason = 'week_target'`).
- Produces: `close_weeks(p_user uuid, p_rebuild boolean default false) → void`. Com `p_rebuild` zera `current`, `shields` e `last_period` (mantém `best`) e reavalia todas as semanas fechadas. `award_xp` passa a chamar `close_weeks(user, true)` quando um `week_target` cai numa semana já avaliada.

- [ ] **Step 1: Teste que falha**

Criar `supabase/tests/gamification-streak.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb } from './helpers/db'
import { A, B, makeUser, setClock, withoutEventWindow, event, sql } from './helpers/game'

let db: PGlite
const BASE = Date.UTC(2026, 5, 1)   // Monday 2026-06-01
const monday = (i: number) => new Date(BASE + i * 7 * 86400000).toISOString().slice(0, 10)
const streak = async (uid = A) =>
  (await sql(db, `select current, best, shields from public.streaks where user_id = $1 and kind = 'training_week'`, [uid]))[0]
const close = (uid = A) => sql(db, 'select public.close_weeks($1)', [uid])
// T = 1, so one session meets a week's goal.
const train = async (weeks: number[], uid = A) => { for (const i of weeks) await event(db, uid, 'workout_completed', monday(i), 'w' + i) }
const clockAfter = (weeks: number) => setClock(db, monday(weeks) + 'T15:00:00Z')

beforeEach(async () => {
  db = await freshDb()
  await withoutEventWindow(db)
  await setClock(db, '2026-06-02T15:00:00Z')
  await makeUser(db, A, { days_per_week: 1 })
  await sql(db, `update public.profiles set created_at = '2026-06-01T15:00:00Z' where id = $1`, [A])
})

describe('close_weeks', () => {
  it('counts closed weeks with the goal met', async () => {
    await train([0, 1, 2])
    await clockAfter(3)
    await close()
    expect(await streak()).toEqual({ current: 3, best: 3, shields: 0 })
  })

  it('never judges the week in progress', async () => {
    await train([0, 1])
    await setClock(db, monday(2) + 'T15:00:00Z')   // week 2 running, nothing trained yet
    await close()
    expect(await streak()).toEqual({ current: 2, best: 2, shields: 0 })
  })

  it('resets on a missed week without a shield', async () => {
    await train([0, 1, 3])
    await clockAfter(4)
    await close()
    expect(await streak()).toEqual({ current: 1, best: 2, shields: 0 })
  })

  it('earns a shield every 4 weeks, two at most', async () => {
    await train([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    await clockAfter(12)
    await close()
    expect(await streak()).toEqual({ current: 12, best: 12, shields: 2 })
  })

  it('spends a shield on a missed week and keeps the streak', async () => {
    await train([0, 1, 2, 3, 5])
    await clockAfter(6)
    await close()
    expect(await streak()).toEqual({ current: 5, best: 5, shields: 0 })
  })

  it('is incremental: a second call changes nothing', async () => {
    await train([0, 1])
    await clockAfter(2)
    await close()
    await close()
    expect(await streak()).toEqual({ current: 2, best: 2, shields: 0 })
  })

  it('closes the week at Monday 00:00 in the profile time zone', async () => {
    await makeUser(db, B, { days_per_week: 1, timezone: 'Asia/Tokyo' })
    await event(db, A, 'workout_completed', '2026-09-28', 'sp')
    await event(db, B, 'workout_completed', '2026-09-28', 'tk')
    await sql(db, `update public.profiles set created_at = '2026-09-28T03:00:00Z'`)
    // Sunday 13:00 in São Paulo, Monday 01:00 in Tokyo.
    await setClock(db, '2026-10-04T16:00:00Z')
    await close(A)
    await close(B)
    expect(await streak(A)).toEqual({ current: 0, best: 0, shields: 0 })
    expect(await streak(B)).toEqual({ current: 1, best: 1, shields: 0 })
  })

  it('replays the streak when a past week meets its goal late', async () => {
    await train([0, 2])
    await clockAfter(3)
    await close()
    expect(await streak()).toEqual({ current: 1, best: 1, shields: 0 })
    await event(db, A, 'workout_completed', monday(1), 'late')
    expect(await streak()).toEqual({ current: 3, best: 3, shields: 0 })
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run supabase/tests/gamification-streak.test.ts`
Expected: FAIL com `function public.close_weeks(uuid) does not exist`.

- [ ] **Step 3: Implementar `close_weeks`**

Acrescentar ao fim de `0002_gamification.sql`:

```sql
-- Weekly streak --------------------------------------------------------------------------------

-- Judges every closed week not judged yet: goal met → +1 (and a shield every 4, at most 2);
-- missed with a streak and a shield → the shield goes, the streak stays; otherwise → 0.
-- The week in progress is never judged. p_rebuild replays from the first week (best is kept).
create or replace function public.close_weeks(p_user uuid, p_rebuild boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_now  date := public.local_week_start(p_user);
  v_s    public.streaks%rowtype;
  v_week date;
begin
  if not exists (select 1 from public.profiles where id = p_user) then return; end if;
  insert into public.streaks (user_id, kind) values (p_user, 'training_week') on conflict do nothing;
  select * into v_s from public.streaks where user_id = p_user and kind = 'training_week' for update;
  if p_rebuild then
    v_s.current := 0;
    v_s.shields := 0;
    v_s.last_period := null;
  end if;

  if v_s.last_period is null then
    select least(
      (select public.week_start_of(min(occurred_on)) from public.activity_events where user_id = p_user),
      (select public.week_start_of((created_at at time zone timezone)::date) from public.profiles where id = p_user)
    ) into v_week;
  else
    v_week := v_s.last_period + 7;
  end if;

  while v_week is not null and v_week < v_now loop
    if exists (select 1 from public.xp_ledger
                where user_id = p_user and reason = 'week_target' and week_start = v_week) then
      v_s.current := v_s.current + 1;
      v_s.best := greatest(v_s.best, v_s.current);
      if v_s.current % 4 = 0 then v_s.shields := least(2, v_s.shields + 1); end if;
    elsif v_s.current > 0 and v_s.shields > 0 then
      v_s.shields := v_s.shields - 1;
    else
      v_s.current := 0;
    end if;
    v_s.last_period := v_week;
    v_week := v_week + 7;
  end loop;

  update public.streaks
     set current = v_s.current, best = v_s.best, shields = v_s.shields, last_period = v_s.last_period
   where user_id = p_user and kind = 'training_week';
end $$;

revoke all on function public.close_weeks(uuid, boolean) from public, anon, authenticated;
```

- [ ] **Step 4: Ligar o replay no `award_xp`**

Em `0002_gamification.sql`, substituir o bloco do bônus de meta dentro de `award_xp`:

```sql
      if v_count + 1 = v_target then
        insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start)
        values (new.user_id, 'strength', 150, 'week_target', new.id, v_week);
      end if;
```

por:

```sql
      if v_count + 1 = v_target then
        insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start)
        values (new.user_id, 'strength', 150, 'week_target', new.id, v_week);
        -- A goal met in a week already judged (a session logged into the past) changes that
        -- week's verdict: replay the streak from the start.
        if exists (select 1 from public.streaks
                    where user_id = new.user_id and kind = 'training_week' and last_period >= v_week) then
          perform public.close_weeks(new.user_id, true);
        end if;
      end if;
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run supabase/tests/gamification-streak.test.ts supabase/tests/gamification-xp.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
npm run typecheck && npm test
git add supabase/migrations/0002_gamification.sql supabase/tests/gamification-streak.test.ts
git commit -m "feat(db): weekly training streak with shields

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 4: Banco: conquistas e bônus

**Files:**
- Modify: `supabase/migrations/0002_gamification.sql` (acrescentar catálogo e funções; substituir `award_xp`)
- Test: `supabase/tests/gamification-achievements.test.ts`

**Interfaces:**
- Consumes: `xp_ledger`, `streaks`, `activity_events`, `level_for`, `local_week_start` (Tasks 1–3).
- Produces:
  - tabela `achievement_catalog(code text pk, metric text, threshold int, xp int, sort smallint unique)` com as 22 linhas; tabela `user_achievements(user_id, code → achievement_catalog, unlocked_at)`;
  - `achievement_stats(p_user uuid) → jsonb` com as chaves `workouts`, `prs`, `week_targets`, `best_streak`, `weigh_in_run`, `early_workouts`;
  - `achievements_for_stats(p_stats jsonb, p_unlocked text[]) → text[]` (ordem de `sort`; métrica ausente em `p_stats` não libera nada);
  - `award_bonus_xp(p_user uuid, p_amount integer, p_reason text, p_week date default null) → boolean` (true se pagou agora);
  - `award_achievement(p_user uuid, p_code text) → boolean` (true se desbloqueou agora; paga o XP do catálogo com `reason = 'achievement:' || code`);
  - `evaluate_achievements(p_user uuid) → text[]` (códigos desbloqueados nesta chamada);
  - `award_xp` chama `evaluate_achievements(new.user_id)` no fim.

- [ ] **Step 1: Teste que falha**

Criar `supabase/tests/gamification-achievements.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, asUser } from './helpers/db'
import { A, B, makeUser, setClock, withoutEventWindow, event, ledger, sql } from './helpers/game'

let db: PGlite
const codes = async (uid = A) =>
  (await sql<{ code: string }>(db, 'select code from public.user_achievements where user_id = $1 order by code', [uid])).map(r => r.code)
const evaluate = async (uid = A) =>
  (await sql<{ c: string[] }>(db, 'select to_jsonb(public.evaluate_achievements($1)) as c', [uid]))[0].c
const day = (d: number) => `2026-09-${String(d).padStart(2, '0')}`

beforeEach(async () => {
  db = await freshDb()
  await withoutEventWindow(db)
  await setClock(db, '2026-09-16T15:00:00Z')   // week of Monday 2026-09-14
  await makeUser(db, A)
  await makeUser(db, B)
})

describe('achievements', () => {
  it('has the 22 badges of the v1 catalogue, readable by clients', async () => {
    const rows = await asUser(db, A, () => db.query('select code from public.achievement_catalog'))
    expect(rows.rows).toHaveLength(22)
  })

  it('unlocks first_workout and pays its 50 XP as a general bonus this week', async () => {
    await event(db, A, 'workout_completed', day(8), 'w1')
    expect(await codes()).toEqual(['first_workout'])
    expect((await ledger(db, A)).find(r => r.reason === 'achievement:first_workout'))
      .toEqual({ reason: 'achievement:first_workout', amount: 50, week_start: '2026-09-14', pillar: null })
  })

  it('pays each badge once', async () => {
    await event(db, A, 'workout_completed', day(8), 'w1')
    expect(await evaluate()).toEqual([])
    expect((await ledger(db, A)).filter(r => r.reason === 'achievement:first_workout')).toHaveLength(1)
  })

  it('needs seven weigh-in days in a row for weigh_in_7', async () => {
    for (const d of [1, 2, 3, 4, 5, 6, 8]) await event(db, A, 'weight_logged', day(d), day(d))
    expect(await codes()).not.toContain('weigh_in_7')
    await event(db, A, 'weight_logged', day(7), day(7))
    expect(await codes()).toContain('weigh_in_7')
  })

  it('counts five live sessions started before 7 for early_bird', async () => {
    for (const [i, hour] of [6, 6, 5, 6, 7].entries()) await event(db, A, 'workout_completed', day(8), 'e' + i, { hour })
    await event(db, A, 'workout_completed', day(9), 'backfilled', { past: true })
    expect(await codes()).not.toContain('early_bird')
    await event(db, A, 'workout_completed', day(10), 'e5', { hour: 4 })
    expect(await codes()).toContain('early_bird')
  })

  it('unlocks streak badges once the weeks are closed', async () => {
    // A user created with T = 1 (changing A's target now would freeze the running week with 3,
    // and past weeks nobody touched take the value frozen after them).
    const C = '00000000-0000-0000-0000-00000000000c'
    await makeUser(db, C, { days_per_week: 1 })
    await sql(db, `update public.profiles set created_at = '2026-08-17T15:00:00Z' where id = $1`, [C])
    for (const d of ['2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07']) await event(db, C, 'workout_completed', d, d)
    await sql(db, 'select public.close_weeks($1)', [C])
    expect(await evaluate(C)).toEqual(['streak_4'])
    // 4 × 750 + 50 + 75 = 3125 XP already reached level 10 during the fourth session.
    expect(await codes(C)).toEqual(['first_workout', 'level_10', 'streak_4', 'week_target_1'])
  })

  it('gives level badges from all XP, bonuses included, without paying XP', async () => {
    expect(await sql(db, `select public.award_bonus_xp($1, 2700, 'test:seed') as ok`, [A])).toEqual([{ ok: true }])
    expect(await evaluate()).toEqual(['level_10'])
    expect((await ledger(db, A)).some(r => r.reason === 'achievement:level_10')).toBe(false)
  })

  it('leaves social badges to award_achievement', async () => {
    for (let i = 0; i < 3; i++) await event(db, A, 'workout_completed', day(8 + i), 'w' + i)
    expect(await codes()).not.toContain('first_friend')
    expect(await sql(db, `select public.award_achievement($1, 'first_friend') as ok`, [A])).toEqual([{ ok: true }])
    expect(await sql(db, `select public.award_achievement($1, 'first_friend') as ok`, [A])).toEqual([{ ok: false }])
    expect((await ledger(db, A)).filter(r => r.reason === 'achievement:first_friend').map(r => r.amount)).toEqual([50])
    await expect(sql(db, `select public.award_achievement($1, 'nope')`, [A])).rejects.toThrow('unknown_achievement')
  })

  it('pays a bonus reason once and refuses odd amounts', async () => {
    expect(await sql(db, `select public.award_bonus_xp($1, 300, 'challenge:x') as ok`, [A])).toEqual([{ ok: true }])
    expect(await sql(db, `select public.award_bonus_xp($1, 300, 'challenge:x') as ok`, [A])).toEqual([{ ok: false }])
    await expect(sql(db, `select public.award_bonus_xp($1, 0, 'zero')`, [A])).rejects.toThrow('invalid_amount')
    await expect(sql(db, `select public.award_bonus_xp($1, 5001, 'huge')`, [A])).rejects.toThrow('invalid_amount')
  })

  it('keeps the award functions away from clients', async () => {
    for (const q of [
      `select public.award_bonus_xp('${A}', 100, 'cheat')`,
      `select public.award_achievement('${A}', 'first_friend')`,
      `select public.evaluate_achievements('${A}')`,
      `select public.achievement_stats('${A}')`
    ]) await expect(asUser(db, A, () => db.query(q))).rejects.toThrow(/permission denied/)
  })

  it('shows each user only their own badges', async () => {
    await event(db, A, 'workout_completed', day(8), 'w1')
    expect((await asUser(db, A, () => db.query('select code from public.user_achievements'))).rows).toEqual([{ code: 'first_workout' }])
    expect((await asUser(db, B, () => db.query('select * from public.user_achievements'))).rows).toEqual([])
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run supabase/tests/gamification-achievements.test.ts`
Expected: FAIL com `relation "public.achievement_catalog" does not exist`.

- [ ] **Step 3: Implementar catálogo e funções**

Acrescentar ao fim de `0002_gamification.sql`:

```sql
-- Achievements ----------------------------------------------------------------------------------

-- Mirrored by src/features/gamification/achievements.ts (gamification-catalog.test.ts compares
-- them). friends and challenges_won are never computed here: Phase 1b unlocks those badges with
-- award_achievement.
create table public.achievement_catalog (
  code      text primary key,
  metric    text not null check (metric in ('workouts', 'prs', 'week_targets', 'best_streak', 'weigh_in_run',
                                            'level', 'early_workouts', 'friends', 'challenges_won')),
  threshold integer not null check (threshold > 0),
  xp        integer not null check (xp >= 0),
  sort      smallint not null unique
);

insert into public.achievement_catalog (code, metric, threshold, xp, sort) values
  ('first_workout',   'workouts',        1,   50,  10),
  ('workouts_10',     'workouts',       10,  100,  20),
  ('workouts_50',     'workouts',       50,  200,  30),
  ('workouts_100',    'workouts',      100,  300,  40),
  ('workouts_250',    'workouts',      250,  500,  50),
  ('workouts_500',    'workouts',      500,  800,  60),
  ('first_pr',        'prs',             1,   50,  70),
  ('prs_10',          'prs',            10,  150,  80),
  ('prs_50',          'prs',            50,  400,  90),
  ('week_target_1',   'week_targets',    1,   75, 100),
  ('streak_4',        'best_streak',     4,  150, 110),
  ('streak_12',       'best_streak',    12,  400, 120),
  ('streak_26',       'best_streak',    26,  800, 130),
  ('streak_52',       'best_streak',    52, 1500, 140),
  ('weigh_in_7',      'weigh_in_run',    7,  100, 150),
  ('level_10',        'level',          10,    0, 160),
  ('level_25',        'level',          25,    0, 170),
  ('level_50',        'level',          50,    0, 180),
  ('first_friend',    'friends',         1,   50, 190),
  ('challenge_first', 'challenges_won',  1,  200, 200),
  ('challenge_won_5', 'challenges_won',  5,  500, 210),
  ('early_bird',      'early_workouts',  5,  100, 220);

create table public.user_achievements (
  user_id     uuid not null references auth.users on delete cascade,
  code        text not null references public.achievement_catalog,
  unlocked_at timestamptz not null default now(),
  primary key (user_id, code)
);

alter table public.achievement_catalog enable row level security;
alter table public.user_achievements enable row level security;
create policy achievement_catalog_select on public.achievement_catalog for select to authenticated using (true);
create policy user_achievements_select_own on public.user_achievements for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete, truncate on public.achievement_catalog, public.user_achievements from anon, authenticated;
grant select on public.achievement_catalog, public.user_achievements to authenticated;

create or replace function public.achievement_stats(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'workouts', (select count(*) from public.activity_events where user_id = p_user and kind = 'workout_completed'),
    'prs', (select count(*) from public.activity_events where user_id = p_user and kind = 'pr'),
    'week_targets', (select count(*) from public.xp_ledger where user_id = p_user and reason = 'week_target'),
    'best_streak', coalesce((select best from public.streaks where user_id = p_user and kind = 'training_week'), 0),
    -- Longest run of consecutive weigh-in days (gaps and islands).
    'weigh_in_run', coalesce((
      select max(n) from (
        select count(*) as n from (
          select d - (row_number() over (order by d))::int as grp
            from (select distinct occurred_on as d from public.activity_events
                   where user_id = p_user and kind = 'weight_logged') days
        ) runs group by grp
      ) lengths), 0),
    -- Live sessions only: the app sends the local start hour for those, never for backfills.
    'early_workouts', (select count(*) from public.activity_events
                        where user_id = p_user and kind = 'workout_completed'
                          and jsonb_typeof(payload -> 'hour') = 'number' and (payload ->> 'hour')::numeric < 7)
  )
$$;

-- Pure: which catalogue codes the stats reach that are not unlocked yet, in catalogue order.
-- Mirrored by evaluateAchievements in src/features/gamification/achievements.ts.
create or replace function public.achievements_for_stats(p_stats jsonb, p_unlocked text[]) returns text[]
language sql stable set search_path = public as $$
  select coalesce(array_agg(code order by sort), '{}')
    from public.achievement_catalog
   where not (code = any (coalesce(p_unlocked, '{}')))
     and jsonb_typeof(p_stats -> metric) = 'number'
     and (p_stats ->> metric)::numeric >= threshold
$$;

-- General bonus (pillar null), paid once per (user, reason). Week: the user's current one unless given.
create or replace function public.award_bonus_xp(p_user uuid, p_amount integer, p_reason text, p_week date default null)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if p_amount is null or p_amount <= 0 or p_amount > 5000 then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;
  insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start)
  values (p_user, null, p_amount, p_reason, null, coalesce(p_week, public.local_week_start(p_user)))
  on conflict (user_id, reason) where event_id is null do nothing;
  return found;
end $$;

create or replace function public.award_achievement(p_user uuid, p_code text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_xp integer;
begin
  select xp into v_xp from public.achievement_catalog where code = p_code;
  if not found then raise exception 'unknown_achievement' using errcode = '22023'; end if;
  insert into public.user_achievements (user_id, code) values (p_user, p_code) on conflict do nothing;
  if not found then return false; end if;
  if v_xp > 0 then perform public.award_bonus_xp(p_user, v_xp, 'achievement:' || p_code); end if;
  return true;
end $$;

create or replace function public.evaluate_achievements(p_user uuid) returns text[]
language plpgsql security definer set search_path = public as $$
declare
  v_new   text[];
  v_more  text[];
  v_code  text;
  v_total bigint;
begin
  v_new := public.achievements_for_stats(public.achievement_stats(p_user),
             array(select code from public.user_achievements where user_id = p_user));
  foreach v_code in array v_new loop perform public.award_achievement(p_user, v_code); end loop;
  -- Level badges last: the XP of the badges above may be what reaches the level.
  select coalesce(sum(amount), 0) into v_total from public.xp_ledger where user_id = p_user;
  v_more := public.achievements_for_stats(
              jsonb_build_object('level', (select level from public.level_for(v_total))),
              array(select code from public.user_achievements where user_id = p_user));
  foreach v_code in array v_more loop perform public.award_achievement(p_user, v_code); end loop;
  return v_new || v_more;
end $$;

revoke all on function public.achievement_stats(uuid), public.award_bonus_xp(uuid, integer, text, date),
  public.award_achievement(uuid, text), public.evaluate_achievements(uuid) from public, anon, authenticated;
```

- [ ] **Step 4: `award_xp` avalia conquistas**

Em `award_xp`, substituir o fim da função:

```sql
    end if;
  end if;
  return null;
end $$;

create trigger activity_events_award after insert on public.activity_events
```

por:

```sql
    end if;
  end if;
  perform public.evaluate_achievements(new.user_id);
  return null;
end $$;

create trigger activity_events_award after insert on public.activity_events
```

(O trigger é criado antes de `evaluate_achievements` existir no arquivo; o PL/pgSQL resolve a chamada na execução, então a ordem no arquivo não importa.)

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run supabase/tests/gamification-achievements.test.ts supabase/tests/gamification-xp.test.ts supabase/tests/gamification-streak.test.ts`
Expected: PASS. Os testes das Tasks 2 e 3 já filtram as linhas `achievement:*`.

- [ ] **Step 6: Commit**

```bash
npm run typecheck && npm test
git add supabase/migrations/0002_gamification.sql supabase/tests/gamification-achievements.test.ts
git commit -m "feat(db): achievement catalogue, evaluation and bonus XP

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Banco: `get_my_progress`, cartão público e cron

**Files:**
- Modify: `supabase/migrations/0002_gamification.sql` (acrescentar ao fim)
- Create: `supabase/migrations/0003_gamification_cron.sql`
- Modify: `docs/SETUP.md`
- Test: `supabase/tests/gamification-progress.test.ts`

**Interfaces:**
- Consumes: tudo das Tasks 1–4.
- Produces:
  - `total_xp(p_user uuid) → bigint`; `week_xp(p_user uuid, p_week date) → integer` (soma do ledger na semana, todos os pilares e bônus);
  - `progress_card(p_user uuid) → jsonb` (interno; cartão sem dados privados) no formato:
    `{ total_xp, level: {level, into, need}, pillars: { strength: {level, into, need, xp}, ...só pilares com XP }, week: { start, xp, max: 960, target, workouts, extras, prs, target_hit }, streak: { current, best, shields }, achievements: [{ code, unlocked_at }] }`;
  - `get_my_progress() → jsonb` (RPC de cliente): `progress_card` + `today` (data local) + `stats` (`achievement_stats` + `level`) + `week.weighed_today`. Antes de responder congela a meta da semana, fecha semanas e avalia conquistas. Erros: `not_signed_in` (28000), `no_profile` (P0002);
  - `close_all_weeks() → integer` (interno; usado pelo cron);
  - job `pg_cron` `close-weeks`, `0 6 * * *`.

- [ ] **Step 1: Teste que falha**

Criar `supabase/tests/gamification-progress.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, asUser } from './helpers/db'
import { A, B, makeUser, setClock, withoutEventWindow, event, sql } from './helpers/game'

let db: PGlite
const progress = async (uid = A) => (await asUser(db, uid, () => db.query<{ p: any }>('select public.get_my_progress() as p'))).rows[0].p

beforeEach(async () => {
  db = await freshDb()
  await withoutEventWindow(db)
  await setClock(db, '2026-09-16T15:00:00Z')   // Wednesday, week of 2026-09-14
  await makeUser(db, A)
  await makeUser(db, B)
})

describe('get_my_progress', () => {
  it('refuses callers without a session', async () => {
    await expect(asUser(db, null, () => db.query('select public.get_my_progress()'))).rejects.toThrow(/permission denied/)
  })

  it('answers with the shape the app reads', async () => {
    await event(db, A, 'workout_completed', '2026-09-14', 'w1', { hour: 18 })
    await event(db, A, 'pr', '2026-09-14', 'w1:0025')
    await event(db, A, 'weight_logged', '2026-09-16', '2026-09-16')
    const { achievements, ...rest } = await progress()
    // Ledger: 200 workout + 30 PR + 10 weigh-in + 50 first_workout + 50 first_pr = 340 (level 3, 90/200).
    // Strength pillar: 240 (level 2, 140/150); the badges are general bonuses.
    expect(rest).toEqual({
      today: '2026-09-16',
      total_xp: 340,
      level: { level: 3, into: 90, need: 200 },
      pillars: { strength: { level: 2, into: 140, need: 150, xp: 240 } },
      week: { start: '2026-09-14', xp: 340, max: 960, target: 3, workouts: 1, extras: 0, prs: 1, target_hit: false, weighed_today: true },
      streak: { current: 0, best: 0, shields: 0 },
      stats: { workouts: 1, prs: 1, week_targets: 0, best_streak: 0, weigh_in_run: 1, early_workouts: 0, level: 3 }
    })
    expect(achievements.map((a: { code: string }) => a.code).sort()).toEqual(['first_pr', 'first_workout'])
    expect(achievements.every((a: { unlocked_at: unknown }) => typeof a.unlocked_at === 'string')).toBe(true)
  })

  it('freezes the running week target on the first read', async () => {
    await progress()
    await sql(db, 'update public.profiles set days_per_week = 5 where id = $1', [A])
    expect((await progress()).week.target).toBe(3)
  })

  it('closes finished weeks before answering', async () => {
    const C = '00000000-0000-0000-0000-00000000000c'
    await makeUser(db, C, { days_per_week: 1 })
    await sql(db, `update public.profiles set created_at = '2026-08-31T15:00:00Z' where id = $1`, [C])
    await event(db, C, 'workout_completed', '2026-08-31', 'a')
    await event(db, C, 'workout_completed', '2026-09-07', 'b')
    const p = await progress(C)
    expect(p.streak).toEqual({ current: 2, best: 2, shields: 0 })
    expect(p.stats.best_streak).toBe(2)
  })

  it('shows only the caller', async () => {
    await event(db, B, 'workout_completed', '2026-09-14', 'b1')
    expect((await progress(A)).total_xp).toBe(0)
  })
})

describe('internal progress functions', () => {
  it('stay away from clients', async () => {
    for (const q of [`select public.progress_card('${B}')`, `select public.close_all_weeks()`, `select public.week_xp('${B}', '2026-09-14')`])
      await expect(asUser(db, A, () => db.query(q))).rejects.toThrow(/permission denied/)
  })

  it('progress_card leaves out private fields', async () => {
    const [{ c }] = await sql(db, 'select public.progress_card($1) as c', [A])
    expect(Object.keys(c).sort()).toEqual(['achievements', 'level', 'pillars', 'streak', 'total_xp', 'week'])
    expect(c.week.weighed_today).toBeUndefined()
  })

  it('close_all_weeks closes every profile', async () => {
    await sql(db, `update public.profiles set created_at = '2026-09-07T15:00:00Z'`)
    for (const uid of [A, B]) for (const d of ['2026-09-07', '2026-09-08', '2026-09-09']) await event(db, uid, 'workout_completed', d, d)
    expect(await sql(db, 'select public.close_all_weeks() as n')).toEqual([{ n: 2 }])
    expect(await sql(db, `select current from public.streaks order by user_id`)).toEqual([{ current: 1 }, { current: 1 }])
  })

  it('skips pg_cron where the extension does not exist', async () => {
    expect(await sql(db, `select count(*)::int as n from pg_extension where extname = 'pg_cron'`)).toEqual([{ n: 0 }])
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run supabase/tests/gamification-progress.test.ts`
Expected: FAIL com `function public.get_my_progress() does not exist`.

- [ ] **Step 3: Implementar as funções**

Acrescentar ao fim de `0002_gamification.sql`:

```sql
-- Progress ------------------------------------------------------------------------------------------

create or replace function public.total_xp(p_user uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0)::bigint from public.xp_ledger where user_id = p_user
$$;

create or replace function public.week_xp(p_user uuid, p_week date) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0)::int from public.xp_ledger where user_id = p_user and week_start = p_week
$$;

-- What anyone allowed to see this user may see: levels, XP, streak, badges. No weights, no stats.
-- Phase 1b shows it to friends; the caller checks the friendship.
create or replace function public.progress_card(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_week   date := public.local_week_start(p_user);
  v_total  bigint := public.total_xp(p_user);
  v_target smallint;
  v_streak public.streaks%rowtype;
  v_count  jsonb;
begin
  v_target := coalesce(
    (select target from public.weekly_targets where user_id = p_user and week_start = v_week),
    (select days_per_week from public.profiles where id = p_user), 3);
  select * into v_streak from public.streaks where user_id = p_user and kind = 'training_week';
  select jsonb_build_object(
           'workouts', count(*) filter (where reason = 'workout'),
           'extras', count(*) filter (where reason = 'workout_extra'),
           'prs', count(*) filter (where reason = 'pr'),
           'target_hit', count(*) filter (where reason = 'week_target') > 0)
    into v_count
    from public.xp_ledger where user_id = p_user and week_start = v_week;
  return jsonb_build_object(
    'total_xp', v_total,
    'level', public.level_json(v_total),
    'pillars', (
      select coalesce(jsonb_object_agg(p.name, public.level_json(p.xp) || jsonb_build_object('xp', p.xp)), '{}'::jsonb)
        from (select e::text as name,
                     coalesce((select sum(amount) from public.xp_ledger where user_id = p_user and pillar = e), 0)::bigint as xp
                from unnest(enum_range(null::public.pillar)) e) p
       where p.name = 'strength' or p.xp > 0),
    'week', jsonb_build_object('start', v_week, 'xp', public.week_xp(p_user, v_week), 'max', 960, 'target', v_target) || v_count,
    'streak', jsonb_build_object('current', coalesce(v_streak.current, 0), 'best', coalesce(v_streak.best, 0),
                                 'shields', coalesce(v_streak.shields, 0)),
    'achievements', coalesce((
      select jsonb_agg(jsonb_build_object('code', code, 'unlocked_at', unlocked_at) order by unlocked_at, code)
        from public.user_achievements where user_id = p_user), '[]'::jsonb)
  );
end $$;

create or replace function public.get_my_progress() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_today date;
  v_card  jsonb;
begin
  if v_uid is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  if not exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'no_profile' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('xp:' || v_uid::text, 0));
  v_today := public.local_today(v_uid);
  perform public.week_target_for(v_uid, public.week_start_of(v_today));
  perform public.close_weeks(v_uid);
  perform public.evaluate_achievements(v_uid);
  v_card := public.progress_card(v_uid);
  return v_card || jsonb_build_object(
    'today', v_today,
    'stats', public.achievement_stats(v_uid) || jsonb_build_object('level', (v_card -> 'level' ->> 'level')::int),
    'week', (v_card -> 'week') || jsonb_build_object('weighed_today', exists (
      select 1 from public.xp_ledger l join public.activity_events e on e.id = l.event_id
       where l.user_id = v_uid and l.reason = 'weight' and e.occurred_on = v_today)));
end $$;

-- Daily safety net (0003 schedules it): freezes the new week's target, closes weeks and hands out
-- streak badges for people who did not open the app.
create or replace function public.close_all_weeks() returns integer
language plpgsql security definer set search_path = public as $$
declare
  r record;
  n integer := 0;
begin
  for r in select id from public.profiles loop
    perform public.week_target_for(r.id, public.local_week_start(r.id));
    perform public.close_weeks(r.id);
    perform public.evaluate_achievements(r.id);
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function public.total_xp(uuid), public.week_xp(uuid, date), public.progress_card(uuid),
  public.close_all_weeks() from public, anon, authenticated;
revoke all on function public.get_my_progress() from public, anon;
grant execute on function public.get_my_progress() to authenticated;
```

- [ ] **Step 4: Migration do cron**

Criar `supabase/migrations/0003_gamification_cron.sql`:

```sql
-- Phase 1a: daily safety net for closing weeks. get_my_progress already closes them whenever the
-- app opens; this keeps streaks and badges current for people who stay away for days. It only does
-- something where pg_cron exists (Supabase, once the extension is enabled; see docs/SETUP.md §7).
-- Elsewhere, the PGlite tests included, it is a no-op.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    -- Same job name again updates the schedule instead of adding a second job.
    execute $cron$ select cron.schedule('close-weeks', '0 6 * * *', 'select public.close_all_weeks()') $cron$;
  end if;
exception when others then
  raise notice 'close-weeks not scheduled: %', sqlerrm;
end $$;
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run supabase/tests/gamification-progress.test.ts`
Expected: PASS.

- [ ] **Step 6: `docs/SETUP.md`**

Em §1, trocar o passo 2:

```markdown
2. SQL Editor → cole e rode, em ordem, cada arquivo de `supabase/migrations/` (`0001_init.sql`,
   `0002_gamification.sql`, `0003_gamification_cron.sql`). Em um projeto que já tem a 0001, rode só
   as que faltam.
```

Acrescentar ao fim do arquivo:

```markdown
## 7. Fechamento diário das semanas (pg_cron)

O app fecha as semanas sempre que abre (`get_my_progress`). Um job diário mantém streaks e
conquistas em dia para quem passa dias sem abrir.

1. Supabase → Database → Extensions → procure `pg_cron` → Enable.
2. SQL Editor → rode de novo `supabase/migrations/0003_gamification_cron.sql`.
3. Confira com `select jobname, schedule, command from cron.job;`. O resultado esperado é
   `close-weeks | 0 6 * * * | select public.close_all_weeks()` (06:00 UTC, 03:00 em Brasília).

Sem o `pg_cron` tudo continua correto; só demora até a próxima abertura do app para o streak de
quem sumiu ser atualizado.
```

- [ ] **Step 7: Commit**

```bash
npm run typecheck && npm test
git add supabase/migrations/0002_gamification.sql supabase/migrations/0003_gamification_cron.sql supabase/tests/gamification-progress.test.ts docs/SETUP.md
git commit -m "feat(db): get_my_progress, public progress card and daily week closing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Regras de XP no cliente e cenários de paridade

**Files:**
- Create: `src/features/gamification/xp.ts`
- Create: `supabase/tests/fixtures/xp-scenarios.json`
- Test: `src/features/gamification/xp.test.ts`
- Test: `supabase/tests/gamification-parity.test.ts`

**Interfaces:**
- Consumes: SQL das Tasks 1–5; helpers de `game.ts`.
- Produces (`src/features/gamification/xp.ts`):
  - constantes `WEEK_SESSIONS_XP = 600`, `WEEK_TARGET_BONUS = 150`, `EXTRA_XP = 25`, `EXTRA_LIMIT = 2`, `PR_XP = 30`, `PR_LIMIT = 3`, `WEIGHT_XP = 10`, `WEEK_MAX = 960`, `SHIELD_EVERY = 4`, `SHIELD_MAX = 2`;
  - tipos `XpReason = 'workout' | 'workout_extra' | 'week_target' | 'pr' | 'weight'`, `XpEvent = { kind: 'workout_completed' | 'pr' | 'weight_logged'; on: string; ref: string }`, `XpAward = { reason: XpReason; amount: number; week: string }`, `LevelInfo = { level: number; into: number; need: number }`, `WeekCounts = { workouts: number; extras: number; prs: number }`, `StreakState = { current: number; best: number; shields: number }`;
  - `sessionXp(target, index): number`, `weekStartOf(iso): string`, `levelFor(totalXp): LevelInfo`, `workoutAwards(c: WeekCounts, target): { reason: XpReason; amount: number }[]`, `prAwards(c: WeekCounts)`, `replay(events: XpEvent[], targetFor: (week: string) => number): XpAward[]`, `streakAfter(hits: boolean[], start?: StreakState): StreakState`.
- Fixture `xp-scenarios.json`: `{ levels: {xp, level, into, need}[], weeks: { name, targets: Record<week, T>, events: XpEvent[], awards: XpAward[], total }[], streaks: { name, hits: boolean[], current, best, shields }[] }`.

- [ ] **Step 1: Fixture compartilhada**

Criar `supabase/tests/fixtures/xp-scenarios.json` (datas de setembro de 2026; segundas: 07, 14):

```json
{
  "levels": [
    { "xp": 0, "level": 1, "into": 0, "need": 100 },
    { "xp": 99, "level": 1, "into": 99, "need": 100 },
    { "xp": 100, "level": 2, "into": 0, "need": 150 },
    { "xp": 249, "level": 2, "into": 149, "need": 150 },
    { "xp": 250, "level": 3, "into": 0, "need": 200 },
    { "xp": 2699, "level": 9, "into": 499, "need": 500 },
    { "xp": 2700, "level": 10, "into": 0, "need": 550 },
    { "xp": 16200, "level": 25, "into": 0, "need": 1300 },
    { "xp": 63700, "level": 50, "into": 0, "need": 2550 }
  ],
  "weeks": [
    {
      "name": "T=3: three sessions meet the goal",
      "targets": { "2026-09-07": 3 },
      "events": [
        { "kind": "workout_completed", "on": "2026-09-07", "ref": "w1" },
        { "kind": "workout_completed", "on": "2026-09-09", "ref": "w2" },
        { "kind": "workout_completed", "on": "2026-09-11", "ref": "w3" }
      ],
      "awards": [
        { "reason": "workout", "amount": 200, "week": "2026-09-07" },
        { "reason": "workout", "amount": 200, "week": "2026-09-07" },
        { "reason": "workout", "amount": 200, "week": "2026-09-07" },
        { "reason": "week_target", "amount": 150, "week": "2026-09-07" }
      ],
      "total": 750
    },
    {
      "name": "T=3: extras pay 25, two a week",
      "targets": { "2026-09-07": 3 },
      "events": [
        { "kind": "workout_completed", "on": "2026-09-07", "ref": "w1" },
        { "kind": "workout_completed", "on": "2026-09-08", "ref": "w2" },
        { "kind": "workout_completed", "on": "2026-09-09", "ref": "w3" },
        { "kind": "workout_completed", "on": "2026-09-10", "ref": "w4" },
        { "kind": "workout_completed", "on": "2026-09-11", "ref": "w5" },
        { "kind": "workout_completed", "on": "2026-09-12", "ref": "w6" }
      ],
      "awards": [
        { "reason": "workout", "amount": 200, "week": "2026-09-07" },
        { "reason": "workout", "amount": 200, "week": "2026-09-07" },
        { "reason": "workout", "amount": 200, "week": "2026-09-07" },
        { "reason": "week_target", "amount": 150, "week": "2026-09-07" },
        { "reason": "workout_extra", "amount": 25, "week": "2026-09-07" },
        { "reason": "workout_extra", "amount": 25, "week": "2026-09-07" }
      ],
      "total": 800
    },
    {
      "name": "T=7: the last planned session takes the remainder",
      "targets": { "2026-09-07": 7 },
      "events": [
        { "kind": "workout_completed", "on": "2026-09-07", "ref": "w1" },
        { "kind": "workout_completed", "on": "2026-09-08", "ref": "w2" },
        { "kind": "workout_completed", "on": "2026-09-09", "ref": "w3" },
        { "kind": "workout_completed", "on": "2026-09-10", "ref": "w4" },
        { "kind": "workout_completed", "on": "2026-09-11", "ref": "w5" },
        { "kind": "workout_completed", "on": "2026-09-12", "ref": "w6" },
        { "kind": "workout_completed", "on": "2026-09-13", "ref": "w7" }
      ],
      "awards": [
        { "reason": "workout", "amount": 86, "week": "2026-09-07" },
        { "reason": "workout", "amount": 86, "week": "2026-09-07" },
        { "reason": "workout", "amount": 86, "week": "2026-09-07" },
        { "reason": "workout", "amount": 86, "week": "2026-09-07" },
        { "reason": "workout", "amount": 86, "week": "2026-09-07" },
        { "reason": "workout", "amount": 86, "week": "2026-09-07" },
        { "reason": "workout", "amount": 84, "week": "2026-09-07" },
        { "reason": "week_target", "amount": 150, "week": "2026-09-07" }
      ],
      "total": 750
    },
    {
      "name": "T=5: three PRs a week are paid",
      "targets": { "2026-09-07": 5 },
      "events": [
        { "kind": "workout_completed", "on": "2026-09-07", "ref": "w1" },
        { "kind": "pr", "on": "2026-09-07", "ref": "w1:a" },
        { "kind": "pr", "on": "2026-09-08", "ref": "p2" },
        { "kind": "pr", "on": "2026-09-09", "ref": "p3" },
        { "kind": "pr", "on": "2026-09-10", "ref": "p4" },
        { "kind": "pr", "on": "2026-09-14", "ref": "p5" }
      ],
      "awards": [
        { "reason": "workout", "amount": 120, "week": "2026-09-07" },
        { "reason": "pr", "amount": 30, "week": "2026-09-07" },
        { "reason": "pr", "amount": 30, "week": "2026-09-07" },
        { "reason": "pr", "amount": 30, "week": "2026-09-07" },
        { "reason": "pr", "amount": 30, "week": "2026-09-14" }
      ],
      "total": 240
    },
    {
      "name": "Weigh-ins pay once a day",
      "targets": { "2026-09-07": 3 },
      "events": [
        { "kind": "weight_logged", "on": "2026-09-07", "ref": "2026-09-07" },
        { "kind": "weight_logged", "on": "2026-09-07", "ref": "2026-09-07b" },
        { "kind": "weight_logged", "on": "2026-09-08", "ref": "2026-09-08" }
      ],
      "awards": [
        { "reason": "weight", "amount": 10, "week": "2026-09-07" },
        { "reason": "weight", "amount": 10, "week": "2026-09-07" }
      ],
      "total": 20
    },
    {
      "name": "T=2: a full week reaches exactly 960",
      "targets": { "2026-09-07": 2 },
      "events": [
        { "kind": "workout_completed", "on": "2026-09-07", "ref": "w1" },
        { "kind": "workout_completed", "on": "2026-09-08", "ref": "w2" },
        { "kind": "workout_completed", "on": "2026-09-09", "ref": "w3" },
        { "kind": "workout_completed", "on": "2026-09-10", "ref": "w4" },
        { "kind": "workout_completed", "on": "2026-09-11", "ref": "w5" },
        { "kind": "pr", "on": "2026-09-07", "ref": "p1" },
        { "kind": "pr", "on": "2026-09-08", "ref": "p2" },
        { "kind": "pr", "on": "2026-09-09", "ref": "p3" },
        { "kind": "pr", "on": "2026-09-10", "ref": "p4" },
        { "kind": "weight_logged", "on": "2026-09-07", "ref": "2026-09-07" },
        { "kind": "weight_logged", "on": "2026-09-08", "ref": "2026-09-08" },
        { "kind": "weight_logged", "on": "2026-09-09", "ref": "2026-09-09" },
        { "kind": "weight_logged", "on": "2026-09-10", "ref": "2026-09-10" },
        { "kind": "weight_logged", "on": "2026-09-11", "ref": "2026-09-11" },
        { "kind": "weight_logged", "on": "2026-09-12", "ref": "2026-09-12" },
        { "kind": "weight_logged", "on": "2026-09-13", "ref": "2026-09-13" }
      ],
      "awards": [
        { "reason": "workout", "amount": 300, "week": "2026-09-07" },
        { "reason": "workout", "amount": 300, "week": "2026-09-07" },
        { "reason": "week_target", "amount": 150, "week": "2026-09-07" },
        { "reason": "workout_extra", "amount": 25, "week": "2026-09-07" },
        { "reason": "workout_extra", "amount": 25, "week": "2026-09-07" },
        { "reason": "pr", "amount": 30, "week": "2026-09-07" },
        { "reason": "pr", "amount": 30, "week": "2026-09-07" },
        { "reason": "pr", "amount": 30, "week": "2026-09-07" },
        { "reason": "weight", "amount": 10, "week": "2026-09-07" },
        { "reason": "weight", "amount": 10, "week": "2026-09-07" },
        { "reason": "weight", "amount": 10, "week": "2026-09-07" },
        { "reason": "weight", "amount": 10, "week": "2026-09-07" },
        { "reason": "weight", "amount": 10, "week": "2026-09-07" },
        { "reason": "weight", "amount": 10, "week": "2026-09-07" },
        { "reason": "weight", "amount": 10, "week": "2026-09-07" }
      ],
      "total": 960
    },
    {
      "name": "Each week keeps the target frozen for it",
      "targets": { "2026-09-07": 3, "2026-09-14": 5 },
      "events": [
        { "kind": "workout_completed", "on": "2026-09-07", "ref": "a1" },
        { "kind": "workout_completed", "on": "2026-09-08", "ref": "a2" },
        { "kind": "workout_completed", "on": "2026-09-09", "ref": "a3" },
        { "kind": "workout_completed", "on": "2026-09-14", "ref": "b1" },
        { "kind": "workout_completed", "on": "2026-09-15", "ref": "b2" },
        { "kind": "workout_completed", "on": "2026-09-16", "ref": "b3" }
      ],
      "awards": [
        { "reason": "workout", "amount": 200, "week": "2026-09-07" },
        { "reason": "workout", "amount": 200, "week": "2026-09-07" },
        { "reason": "workout", "amount": 200, "week": "2026-09-07" },
        { "reason": "week_target", "amount": 150, "week": "2026-09-07" },
        { "reason": "workout", "amount": 120, "week": "2026-09-14" },
        { "reason": "workout", "amount": 120, "week": "2026-09-14" },
        { "reason": "workout", "amount": 120, "week": "2026-09-14" }
      ],
      "total": 1110
    },
    {
      "name": "A session logged into the past counts in its own week",
      "targets": { "2026-09-07": 2, "2026-09-14": 2 },
      "events": [
        { "kind": "workout_completed", "on": "2026-09-15", "ref": "b1" },
        { "kind": "workout_completed", "on": "2026-09-08", "ref": "a1" },
        { "kind": "workout_completed", "on": "2026-09-16", "ref": "b2" }
      ],
      "awards": [
        { "reason": "workout", "amount": 300, "week": "2026-09-14" },
        { "reason": "workout", "amount": 300, "week": "2026-09-07" },
        { "reason": "workout", "amount": 300, "week": "2026-09-14" },
        { "reason": "week_target", "amount": 150, "week": "2026-09-14" }
      ],
      "total": 1050
    },
    {
      "name": "A repeated event pays once",
      "targets": { "2026-09-07": 3 },
      "events": [
        { "kind": "workout_completed", "on": "2026-09-07", "ref": "w1" },
        { "kind": "workout_completed", "on": "2026-09-07", "ref": "w1" },
        { "kind": "workout_completed", "on": "2026-09-08", "ref": "w2" }
      ],
      "awards": [
        { "reason": "workout", "amount": 200, "week": "2026-09-07" },
        { "reason": "workout", "amount": 200, "week": "2026-09-07" }
      ],
      "total": 400
    }
  ],
  "streaks": [
    { "name": "a missed week without a shield resets", "hits": [true, true, false, true], "current": 1, "best": 2, "shields": 0 },
    { "name": "a shield every four weeks, two at most", "hits": [true, true, true, true, true, true, true, true, true, true, true, true], "current": 12, "best": 12, "shields": 2 },
    { "name": "a shield carries the streak through one miss", "hits": [true, true, true, true, false, true], "current": 5, "best": 5, "shields": 0 },
    { "name": "two misses with one shield end it", "hits": [true, true, true, true, false, false, true], "current": 1, "best": 4, "shields": 0 },
    { "name": "misses before any streak change nothing", "hits": [false, false, true], "current": 1, "best": 1, "shields": 0 }
  ]
}
```

- [ ] **Step 2: Testes que falham (cliente e servidor)**

Criar `src/features/gamification/xp.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import fixture from '../../../supabase/tests/fixtures/xp-scenarios.json'
import { levelFor, replay, sessionXp, streakAfter, weekStartOf, WEEK_MAX, type XpEvent } from './xp'

describe('xp rules (client mirror)', () => {
  it.each(fixture.levels)('levelFor($xp)', l => {
    expect(levelFor(l.xp)).toEqual({ level: l.level, into: l.into, need: l.need })
  })

  it.each(fixture.weeks)('$name', s => {
    const targets = s.targets as Record<string, number>
    const awards = replay(s.events as XpEvent[], week => targets[week])
    expect(awards).toEqual(s.awards)
    expect(awards.reduce((n, a) => n + a.amount, 0)).toBe(s.total)
  })

  it.each(fixture.streaks)('streak: $name', s => {
    expect(streakAfter(s.hits)).toEqual({ current: s.current, best: s.best, shields: s.shields })
  })

  it('planned sessions add up to 600 and the weekly max is 960 for every T', () => {
    for (let t = 1; t <= 7; t++) {
      let sum = 0
      for (let k = 1; k <= t; k++) sum += sessionXp(t, k)
      expect(sum, `T=${t}`).toBe(600)
    }
    expect(WEEK_MAX).toBe(960)
  })

  it('weeks start on Monday', () => {
    expect(['2026-10-05', '2026-10-11', '2026-10-12'].map(weekStartOf)).toEqual(['2026-10-05', '2026-10-05', '2026-10-12'])
  })
})
```

Criar `supabase/tests/gamification-parity.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb } from './helpers/db'
import { A, makeUser, setClock, withoutEventWindow, event, ledger, sql } from './helpers/game'
import fixture from './fixtures/xp-scenarios.json'

let db: PGlite
const DAY = 86400000
const monday = (i: number) => new Date(Date.UTC(2026, 5, 1) + i * 7 * DAY).toISOString().slice(0, 10)

beforeEach(async () => {
  db = await freshDb()
  await withoutEventWindow(db)
  await setClock(db, '2026-10-05T15:00:00Z')
})

describe('xp rules (server, same scenarios as xp.test.ts)', () => {
  it.each(fixture.levels)('level_for($xp)', async l => {
    const [r] = await sql(db, 'select level, into_level, need from public.level_for($1)', [l.xp])
    expect(r).toEqual({ level: l.level, into_level: l.into, need: l.need })
  })

  it.each(fixture.weeks)('$name', async s => {
    const targets = Object.entries(s.targets as Record<string, number>)
    await makeUser(db, A, { days_per_week: targets[0][1] })
    for (const [week, target] of targets)
      await sql(db, 'insert into public.weekly_targets (user_id, week_start, target) values ($1, $2, $3)', [A, week, target])
    for (const e of s.events) {
      try { await event(db, A, e.kind, e.on, e.ref) }
      catch (err) { if (!/duplicate key/.test(String(err))) throw err }
    }
    const rows = (await ledger(db, A))
      .filter(r => !r.reason.startsWith('achievement:'))
      .map(r => ({ reason: r.reason, amount: r.amount, week: r.week_start }))
    expect(rows).toEqual(s.awards)
    expect(rows.reduce((n, r) => n + r.amount, 0)).toBe(s.total)
  })

  it.each(fixture.streaks)('streak: $name', async s => {
    await makeUser(db, A, { days_per_week: 1 })
    await sql(db, `update public.profiles set created_at = '2026-06-01T15:00:00Z' where id = $1`, [A])
    for (const [i, hit] of s.hits.entries()) if (hit) await event(db, A, 'workout_completed', monday(i), 'w' + i)
    await setClock(db, monday(s.hits.length) + 'T15:00:00Z')
    await sql(db, 'select public.close_weeks($1)', [A])
    const [st] = await sql(db, `select current, best, shields from public.streaks where user_id = $1 and kind = 'training_week'`, [A])
    expect(st).toEqual({ current: s.current, best: s.best, shields: s.shields })
  })
})
```

Run: `npx vitest run src/features/gamification/xp.test.ts supabase/tests/gamification-parity.test.ts`
Expected: o teste do cliente FAIL (`Cannot find module './xp'`); o do servidor já PASS (o SQL é das Tasks 1–5). Se algum cenário do servidor falhar, o erro está na fixture ou no SQL: conferir à mão antes de seguir.

- [ ] **Step 3: Implementar `xp.ts`**

Criar `src/features/gamification/xp.ts`:

```ts
// The XP rules of the strength pillar, mirrored from supabase/migrations/0002_gamification.sql
// (session_xp, level_for, award_xp, close_weeks). The server is the authority; this file drives the
// preview shown before it answers. supabase/tests/fixtures/xp-scenarios.json runs against both
// sides, so a rule changed on one side only fails a test.

export const WEEK_SESSIONS_XP = 600
export const WEEK_TARGET_BONUS = 150
export const EXTRA_XP = 25
export const EXTRA_LIMIT = 2
export const PR_XP = 30
export const PR_LIMIT = 3
export const WEIGHT_XP = 10
export const WEEK_MAX = WEEK_SESSIONS_XP + WEEK_TARGET_BONUS + EXTRA_XP * EXTRA_LIMIT + PR_XP * PR_LIMIT + WEIGHT_XP * 7
export const SHIELD_EVERY = 4
export const SHIELD_MAX = 2

export type XpReason = 'workout' | 'workout_extra' | 'week_target' | 'pr' | 'weight'
export type XpEvent = { kind: 'workout_completed' | 'pr' | 'weight_logged'; on: string; ref: string }
export type XpAward = { reason: XpReason; amount: number; week: string }
export type LevelInfo = { level: number; into: number; need: number }
export type WeekCounts = { workouts: number; extras: number; prs: number }
export type StreakState = { current: number; best: number; shields: number }
type Pay = { reason: XpReason; amount: number }

// The index-th planned session of a week (1-based). The T-th takes the remainder, so a week's
// planned sessions always add up to 600 (T = 7: six of 86 and one of 84).
export function sessionXp(target: number, index: number): number {
  const each = Math.round(WEEK_SESSIONS_XP / target)
  return index < target ? each : WEEK_SESSIONS_XP - each * (target - 1)
}

// Monday of the week a local YYYY-MM-DD belongs to.
export function weekStartOf(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

// Level n needs 100 + 50·(n − 1) XP to reach n + 1.
export function levelFor(totalXp: number): LevelInfo {
  let left = Math.max(0, Math.floor(totalXp))
  let level = 1
  let need = 100
  while (left >= need) {
    left -= need
    level++
    need = 100 + 50 * (level - 1)
  }
  return { level, into: left, need }
}

// What one more workout pays, given what the week already paid.
export function workoutAwards(c: WeekCounts, target: number): Pay[] {
  if (c.workouts < target) {
    const out: Pay[] = [{ reason: 'workout', amount: sessionXp(target, c.workouts + 1) }]
    if (c.workouts + 1 === target) out.push({ reason: 'week_target', amount: WEEK_TARGET_BONUS })
    return out
  }
  return c.extras < EXTRA_LIMIT ? [{ reason: 'workout_extra', amount: EXTRA_XP }] : []
}

export function prAwards(c: WeekCounts): Pay[] {
  return c.prs < PR_LIMIT ? [{ reason: 'pr', amount: PR_XP }] : []
}

// Replays events in arrival order, the way award_xp sees them. A repeated (kind, ref) pays once,
// as the unique key on activity_events does; a weigh-in pays once per day.
export function replay(events: XpEvent[], targetFor: (week: string) => number): XpAward[] {
  const seen = new Set<string>()
  const weighed = new Set<string>()
  const weeks = new Map<string, WeekCounts>()
  const out: XpAward[] = []
  for (const ev of events) {
    const key = ev.kind + '|' + ev.ref
    if (seen.has(key)) continue
    seen.add(key)
    const week = weekStartOf(ev.on)
    const c = weeks.get(week) ?? { workouts: 0, extras: 0, prs: 0 }
    weeks.set(week, c)
    let pays: Pay[] = []
    if (ev.kind === 'workout_completed') pays = workoutAwards(c, targetFor(week))
    else if (ev.kind === 'pr') pays = prAwards(c)
    else if (!weighed.has(ev.on)) { weighed.add(ev.on); pays = [{ reason: 'weight', amount: WEIGHT_XP }] }
    for (const p of pays) {
      if (p.reason === 'workout') c.workouts++
      else if (p.reason === 'workout_extra') c.extras++
      else if (p.reason === 'pr') c.prs++
      out.push({ ...p, week })
    }
  }
  return out
}

// Judges closed weeks in order, as close_weeks does.
export function streakAfter(hits: boolean[], start: StreakState = { current: 0, best: 0, shields: 0 }): StreakState {
  let { current, best, shields } = start
  for (const hit of hits) {
    if (hit) {
      current++
      best = Math.max(best, current)
      if (current % SHIELD_EVERY === 0) shields = Math.min(SHIELD_MAX, shields + 1)
    } else if (current > 0 && shields > 0) {
      shields--
    } else {
      current = 0
    }
  }
  return { current, best, shields }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/features/gamification/xp.test.ts supabase/tests/gamification-parity.test.ts`
Expected: PASS nos dois.

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npm test
git add src/features/gamification/xp.ts src/features/gamification/xp.test.ts supabase/tests/fixtures/xp-scenarios.json supabase/tests/gamification-parity.test.ts
git commit -m "feat(gamification): client XP rules with shared parity scenarios

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Catálogo de conquistas no cliente e paridade

**Files:**
- Create: `src/features/gamification/achievements.ts`
- Create: `supabase/tests/fixtures/achievement-scenarios.json`
- Test: `src/features/gamification/achievements.test.ts`
- Test: `supabase/tests/gamification-catalog.test.ts`

**Interfaces:**
- Consumes: `achievement_catalog`, `achievements_for_stats` (Task 4).
- Produces (`achievements.ts`, sem dependências de i18n nem Supabase, importável pelos testes SQL):
  - `type Metric = 'workouts' | 'prs' | 'week_targets' | 'best_streak' | 'weigh_in_run' | 'level' | 'early_workouts' | 'friends' | 'challenges_won'`;
  - `type AchievementCode` (união dos 22 códigos); `type Achievement = { code: AchievementCode; metric: Metric; threshold: number; xp: number; sort: number }`; `type AchievementStats = Partial<Record<Metric, number>>`;
  - `ACHIEVEMENTS: readonly Achievement[]` (ordem de `sort`), `SOCIAL_METRICS: readonly Metric[] = ['friends', 'challenges_won']`;
  - `achievementByCode(code: string): Achievement | undefined`;
  - `evaluateAchievements(stats: AchievementStats, unlocked: Iterable<string>): AchievementCode[]`.

- [ ] **Step 1: Fixture**

Criar `supabase/tests/fixtures/achievement-scenarios.json`:

```json
[
  { "name": "first workout", "stats": { "workouts": 1 }, "unlocked": [], "expect": ["first_workout"] },
  { "name": "ten workouts and a first PR", "stats": { "workouts": 10, "prs": 1 }, "unlocked": ["first_workout"], "expect": ["workouts_10", "first_pr"] },
  { "name": "a long streak unlocks every step up to it", "stats": { "week_targets": 12, "best_streak": 12 }, "unlocked": [], "expect": ["week_target_1", "streak_4", "streak_12"] },
  { "name": "six weigh-ins in a row are not seven", "stats": { "weigh_in_run": 6 }, "unlocked": [], "expect": [] },
  { "name": "level badges skip the ones already held", "stats": { "level": 25 }, "unlocked": ["level_10"], "expect": ["level_25"] },
  { "name": "early bird", "stats": { "early_workouts": 5 }, "unlocked": [], "expect": ["early_bird"] },
  { "name": "nothing reached", "stats": { "workouts": 0 }, "unlocked": [], "expect": [] },
  { "name": "social badges for the friends phase", "stats": { "friends": 1, "challenges_won": 5 }, "unlocked": [], "expect": ["first_friend", "challenge_first", "challenge_won_5"] }
]
```

- [ ] **Step 2: Testes que falham**

Criar `src/features/gamification/achievements.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import cases from '../../../supabase/tests/fixtures/achievement-scenarios.json'
import { ACHIEVEMENTS, achievementByCode, evaluateAchievements, type AchievementStats } from './achievements'

describe('achievement catalogue (client mirror)', () => {
  it.each(cases)('$name', c => {
    expect(evaluateAchievements(c.stats as AchievementStats, c.unlocked)).toEqual(c.expect)
  })

  it('has 22 badges in sort order with unique codes', () => {
    expect(ACHIEVEMENTS).toHaveLength(22)
    expect(new Set(ACHIEVEMENTS.map(a => a.code)).size).toBe(22)
    expect(ACHIEVEMENTS.map(a => a.sort)).toEqual([...ACHIEVEMENTS.map(a => a.sort)].sort((a, b) => a - b))
  })

  it('looks codes up', () => {
    expect(achievementByCode('streak_52')).toMatchObject({ metric: 'best_streak', threshold: 52, xp: 1500 })
    expect(achievementByCode('nope')).toBeUndefined()
  })
})
```

Criar `supabase/tests/gamification-catalog.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb } from './helpers/db'
import { sql } from './helpers/game'
import { ACHIEVEMENTS } from '../../src/features/gamification/achievements'
import cases from './fixtures/achievement-scenarios.json'

let db: PGlite
beforeEach(async () => { db = await freshDb() })

describe('achievement catalogue (server)', () => {
  it('is the same as the client catalogue', async () => {
    const rows = await sql(db, 'select code, metric, threshold, xp, sort from public.achievement_catalog order by sort')
    expect(rows).toEqual(ACHIEVEMENTS.map(({ code, metric, threshold, xp, sort }) => ({ code, metric, threshold, xp, sort })))
  })

  it.each(cases)('$name', async c => {
    const [r] = await sql<{ codes: string[] }>(db,
      'select to_jsonb(public.achievements_for_stats($1::jsonb, $2::text[])) as codes',
      [JSON.stringify(c.stats), '{' + c.unlocked.join(',') + '}'])
    expect(r.codes).toEqual(c.expect)
  })
})
```

Run: `npx vitest run src/features/gamification/achievements.test.ts supabase/tests/gamification-catalog.test.ts`
Expected: FAIL (`Cannot find module './achievements'`).

- [ ] **Step 3: Implementar**

Criar `src/features/gamification/achievements.ts`:

```ts
// The achievement catalogue v1 (spec §5.5), mirrored from public.achievement_catalog in
// supabase/migrations/0002_gamification.sql; gamification-catalog.test.ts keeps the two equal.
// Pure on purpose: the SQL tests import it. Titles and descriptions live in achievement-labels.ts.

export type Metric =
  | 'workouts' | 'prs' | 'week_targets' | 'best_streak' | 'weigh_in_run'
  | 'level' | 'early_workouts' | 'friends' | 'challenges_won'

export type AchievementCode =
  | 'first_workout' | 'workouts_10' | 'workouts_50' | 'workouts_100' | 'workouts_250' | 'workouts_500'
  | 'first_pr' | 'prs_10' | 'prs_50' | 'week_target_1'
  | 'streak_4' | 'streak_12' | 'streak_26' | 'streak_52' | 'weigh_in_7'
  | 'level_10' | 'level_25' | 'level_50'
  | 'first_friend' | 'challenge_first' | 'challenge_won_5' | 'early_bird'

export type Achievement = { code: AchievementCode; metric: Metric; threshold: number; xp: number; sort: number }
export type AchievementStats = Partial<Record<Metric, number>>

const a = (code: AchievementCode, metric: Metric, threshold: number, xp: number, sort: number): Achievement =>
  ({ code, metric, threshold, xp, sort })

export const ACHIEVEMENTS: readonly Achievement[] = [
  a('first_workout', 'workouts', 1, 50, 10),
  a('workouts_10', 'workouts', 10, 100, 20),
  a('workouts_50', 'workouts', 50, 200, 30),
  a('workouts_100', 'workouts', 100, 300, 40),
  a('workouts_250', 'workouts', 250, 500, 50),
  a('workouts_500', 'workouts', 500, 800, 60),
  a('first_pr', 'prs', 1, 50, 70),
  a('prs_10', 'prs', 10, 150, 80),
  a('prs_50', 'prs', 50, 400, 90),
  a('week_target_1', 'week_targets', 1, 75, 100),
  a('streak_4', 'best_streak', 4, 150, 110),
  a('streak_12', 'best_streak', 12, 400, 120),
  a('streak_26', 'best_streak', 26, 800, 130),
  a('streak_52', 'best_streak', 52, 1500, 140),
  a('weigh_in_7', 'weigh_in_run', 7, 100, 150),
  a('level_10', 'level', 10, 0, 160),
  a('level_25', 'level', 25, 0, 170),
  a('level_50', 'level', 50, 0, 180),
  a('first_friend', 'friends', 1, 50, 190),
  a('challenge_first', 'challenges_won', 1, 200, 200),
  a('challenge_won_5', 'challenges_won', 5, 500, 210),
  a('early_bird', 'early_workouts', 5, 100, 220)
]

// Unlocked only by Phase 1b (friends, challenges); Phase 1a never computes these metrics.
export const SOCIAL_METRICS: readonly Metric[] = ['friends', 'challenges_won']

const BY_CODE = new Map<string, Achievement>(ACHIEVEMENTS.map(x => [x.code, x]))
export const achievementByCode = (code: string): Achievement | undefined => BY_CODE.get(code)

// Mirror of public.achievements_for_stats: the codes the stats reach that are not unlocked yet,
// in catalogue order. A metric missing from the stats unlocks nothing.
export function evaluateAchievements(stats: AchievementStats, unlocked: Iterable<string>): AchievementCode[] {
  const held = new Set(unlocked)
  return ACHIEVEMENTS
    .filter(x => !held.has(x.code) && typeof stats[x.metric] === 'number' && (stats[x.metric] as number) >= x.threshold)
    .map(x => x.code)
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/features/gamification/achievements.test.ts supabase/tests/gamification-catalog.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npm test
git add src/features/gamification/achievements.ts src/features/gamification/achievements.test.ts supabase/tests/fixtures/achievement-scenarios.json supabase/tests/gamification-catalog.test.ts
git commit -m "feat(gamification): client achievement catalogue kept equal to the database

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 8: Dados de progresso no app (tipos, API, store, prévia, sync)

**Files:**
- Modify: `src/lib/database.types.ts`
- Create: `src/features/gamification/types.ts`
- Create: `src/features/gamification/progress-api.ts`
- Create: `src/features/gamification/preview.ts`
- Create: `src/features/gamification/celebrations.ts`
- Create: `src/features/gamification/useProgress.ts`
- Create: `src/features/gamification/after-event.ts`
- Modify: `src/App.jsx`
- Test: `src/features/gamification/progress-api.test.ts`, `preview.test.ts`, `celebrations.test.ts`, `useProgress.test.ts`, `after-event.test.ts`

**Interfaces:**
- Consumes: RPC `get_my_progress` (Task 5); `xp.ts` (Task 6); `achievements.ts` (Task 7); `flush(): Promise<{ sent: number; left: number }>` de `src/features/gamification/events.ts` (Fase 0).
- Produces:
  - `types.ts`: `LevelInfo` (reexport), `PillarProgress = LevelInfo & { xp: number }`, `WeekProgress = { start; xp; max; target; workouts; extras; prs; target_hit; weighed_today }`, `Progress = { today; total_xp; level: LevelInfo; pillars: Partial<Record<Pillar, PillarProgress>>; week: WeekProgress; streak: { current; best; shields }; achievements: { code; unlocked_at }[]; stats: AchievementStats }`, `XpLine` (união por `kind`: `'workout' {index, of}`, `'extra'`, `'goal'`, `'pr' {count}`, `'weight'`, `'achievement' {code}`, `'other'`, todos com `amount`), `XpPreview = { lines: XpLine[]; total: number }`, `Celebration = { kind: 'level'; level: number } | { kind: 'achievement'; code: string }`, `SyncResult = { progress: Progress | null; confirmed: boolean }`;
  - `progress-api.ts`: `fetchProgress(): Promise<Progress>`;
  - `preview.ts`: `previewWorkout(p: Progress | null, input: { occurredOn: string; prs: number }): XpPreview | null`, `linesFromProgress(before: Progress, after: Progress): XpLine[]`, `displayStreak(p: Progress): number`;
  - `celebrations.ts`: `SeenMarker = { level: number; codes: string[] }`, `markerOf(p)`, `celebrationsSince(seen, p): Celebration[]`;
  - `useProgress.ts`: store `useProgress` com `status: 'idle' | 'loading' | 'ready' | 'error'`, `progress`, `userId`, `stale`, `pending: Celebration[]`, `held: boolean`, `load(userId)`, `refresh(): Promise<Progress | null>`, `takePending(): Celebration[]`, `hold(on: boolean)`, `reset()`; e `startProgressSync(): () => void`;
  - `after-event.ts`: `syncProgress(): Promise<SyncResult>`, `weighInXp(day: string): number`.

- [ ] **Step 1: Tipos do banco**

Em `src/lib/database.types.ts`, dentro de `Tables`, depois de `activity_events`, acrescentar:

```ts
      weekly_targets: {
        Row: { user_id: string; week_start: string; target: number }
        Insert: never
        Update: never
        Relationships: []
      }
      xp_ledger: {
        Row: { id: number; user_id: string; pillar: Pillar | null; amount: number; reason: string; event_id: number | null; week_start: string; created_at: string }
        Insert: never
        Update: never
        Relationships: []
      }
      streaks: {
        Row: { user_id: string; kind: string; current: number; best: number; shields: number; last_period: string | null }
        Insert: never
        Update: never
        Relationships: []
      }
      achievement_catalog: {
        Row: { code: string; metric: string; threshold: number; xp: number; sort: number }
        Insert: never
        Update: never
        Relationships: []
      }
      user_achievements: {
        Row: { user_id: string; code: string; unlocked_at: string }
        Insert: never
        Update: never
        Relationships: []
      }
```

e em `Functions`, depois de `push_state`:

```ts
      get_my_progress: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
```

- [ ] **Step 2: `types.ts`**

Criar `src/features/gamification/types.ts`:

```ts
import type { Pillar } from '@/lib/database.types'
import type { AchievementStats } from './achievements'
import type { LevelInfo } from './xp'

export type { LevelInfo }

export type PillarProgress = LevelInfo & { xp: number }

export type WeekProgress = {
  start: string
  xp: number
  max: number
  target: number
  workouts: number
  extras: number
  prs: number
  target_hit: boolean
  weighed_today: boolean
}

// The answer of get_my_progress (supabase/migrations/0002_gamification.sql).
export type Progress = {
  today: string
  total_xp: number
  level: LevelInfo
  pillars: Partial<Record<Pillar, PillarProgress>>
  week: WeekProgress
  streak: { current: number; best: number; shields: number }
  achievements: { code: string; unlocked_at: string }[]
  stats: AchievementStats
}

export type XpLine =
  | { kind: 'workout'; amount: number; index: number; of: number }
  | { kind: 'extra'; amount: number }
  | { kind: 'goal'; amount: number }
  | { kind: 'pr'; amount: number; count: number }
  | { kind: 'weight'; amount: number }
  | { kind: 'achievement'; amount: number; code: string }
  | { kind: 'other'; amount: number }

export type XpPreview = { lines: XpLine[]; total: number }

export type Celebration = { kind: 'level'; level: number } | { kind: 'achievement'; code: string }

// confirmed: the event queue was empty when the progress was read, so it already counts them.
export type SyncResult = { progress: Progress | null; confirmed: boolean }
```

- [ ] **Step 3: Testes que falham**

Criar `src/features/gamification/test-progress.ts` (fábrica usada pelos testes desta e das próximas tasks; não é teste, não termina em `.test.ts`):

```ts
import { levelFor } from './xp'
import type { Progress, WeekProgress } from './types'

// A Progress as get_my_progress would answer it, in the week of Monday 2026-10-05.
export function progressOf(total: number, week: Partial<WeekProgress> = {}, over: Partial<Progress> = {}): Progress {
  return {
    today: '2026-10-07',
    total_xp: total,
    level: levelFor(total),
    pillars: { strength: { ...levelFor(total), xp: total } },
    week: { start: '2026-10-05', xp: 0, max: 960, target: 3, workouts: 1, extras: 0, prs: 0, target_hit: false, weighed_today: false, ...week },
    streak: { current: 0, best: 0, shields: 0 },
    achievements: [],
    stats: {},
    ...over
  }
}
```

Criar `src/features/gamification/progress-api.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: h.rpc } }))

import { fetchProgress } from './progress-api'
import { progressOf } from './test-progress'

beforeEach(() => h.rpc.mockReset())

describe('fetchProgress', () => {
  it('returns the RPC answer', async () => {
    const p = progressOf(400)
    h.rpc.mockResolvedValue({ data: p, error: null })
    await expect(fetchProgress()).resolves.toEqual(p)
    expect(h.rpc).toHaveBeenCalledWith('get_my_progress')
  })

  it('throws the RPC error', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'no_profile' } })
    await expect(fetchProgress()).rejects.toThrow('no_profile')
  })

  it('refuses an answer without the expected shape', async () => {
    h.rpc.mockResolvedValue({ data: { hello: 1 }, error: null })
    await expect(fetchProgress()).rejects.toThrow('bad_progress')
  })
})
```

Criar `src/features/gamification/preview.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { displayStreak, linesFromProgress, previewWorkout } from './preview'
import { progressOf } from './test-progress'

const today = '2026-10-07'

describe('previewWorkout', () => {
  it('pays the next planned session', () => {
    expect(previewWorkout(progressOf(400), { occurredOn: today, prs: 0 }))
      .toEqual({ lines: [{ kind: 'workout', amount: 200, index: 2, of: 3 }], total: 200 })
  })

  it('adds the weekly goal on the T-th session', () => {
    const p = previewWorkout(progressOf(400, { workouts: 2 }), { occurredOn: today, prs: 0 })
    expect(p).toEqual({ lines: [{ kind: 'workout', amount: 200, index: 3, of: 3 }, { kind: 'goal', amount: 150 }], total: 350 })
  })

  it('pays extras until two and then nothing', () => {
    expect(previewWorkout(progressOf(400, { workouts: 3, extras: 1, target_hit: true }), { occurredOn: today, prs: 0 })?.lines)
      .toEqual([{ kind: 'extra', amount: 25 }])
    expect(previewWorkout(progressOf(400, { workouts: 3, extras: 2, target_hit: true }), { occurredOn: today, prs: 0 }))
      .toEqual({ lines: [], total: 0 })
  })

  it('pays only the PRs left in the weekly limit', () => {
    expect(previewWorkout(progressOf(400, { prs: 2 }), { occurredOn: today, prs: 3 })?.lines)
      .toContainEqual({ kind: 'pr', amount: 30, count: 1 })
  })

  it('gives up on another week or without progress', () => {
    expect(previewWorkout(progressOf(400), { occurredOn: '2026-10-02', prs: 0 })).toBeNull()
    expect(previewWorkout(null, { occurredOn: today, prs: 0 })).toBeNull()
  })
})

describe('linesFromProgress', () => {
  it('explains the server difference line by line', () => {
    const before = progressOf(400)
    const after = progressOf(400 + 200 + 200 + 150 + 30 + 75, { workouts: 3, prs: 1, target_hit: true },
      { achievements: [{ code: 'week_target_1', unlocked_at: '2026-10-07T20:00:00Z' }] })
    expect(linesFromProgress(before, after)).toEqual([
      { kind: 'workout', amount: 200, index: 2, of: 3 },
      { kind: 'workout', amount: 200, index: 3, of: 3 },
      { kind: 'goal', amount: 150 },
      { kind: 'pr', amount: 30, count: 1 },
      { kind: 'achievement', amount: 75, code: 'week_target_1' }
    ])
  })

  it('puts what it cannot name under other gains', () => {
    const before = progressOf(400)
    const after = progressOf(700, {}, { week: { ...progressOf(0).week, start: '2026-10-12' } })
    expect(linesFromProgress(before, after)).toEqual([{ kind: 'other', amount: 300 }])
  })
})

describe('displayStreak', () => {
  it('counts the running week once its goal is met', () => {
    expect(displayStreak(progressOf(0, {}, { streak: { current: 2, best: 4, shields: 0 } }))).toBe(2)
    expect(displayStreak(progressOf(0, { target_hit: true }, { streak: { current: 2, best: 4, shields: 0 } }))).toBe(3)
  })
})
```

Criar `src/features/gamification/celebrations.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { celebrationsSince, markerOf } from './celebrations'
import { progressOf } from './test-progress'

const badge = (code: string) => ({ code, unlocked_at: '2026-10-07T20:00:00Z' })

describe('celebrations', () => {
  it('celebrates a level-up first, then new badges in catalogue order', () => {
    const seen = markerOf(progressOf(90, {}, { achievements: [badge('first_workout')] }))
    const now = progressOf(700, {}, { achievements: [badge('first_workout'), badge('early_bird'), badge('first_pr')] })
    expect(celebrationsSince(seen, now)).toEqual([
      { kind: 'level', level: 5 },
      { kind: 'achievement', code: 'first_pr' },
      { kind: 'achievement', code: 'early_bird' }
    ])
  })

  it('has nothing to say when nothing changed', () => {
    const p = progressOf(700, {}, { achievements: [badge('first_workout')] })
    expect(celebrationsSince(markerOf(p), p)).toEqual([])
  })
})
```

Criar `src/features/gamification/useProgress.test.ts`:

```ts
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'

const api = vi.hoisted(() => ({ fetchProgress: vi.fn() }))
vi.mock('./progress-api', () => api)

import { useProgress } from './useProgress'
import { progressOf } from './test-progress'

const badge = (code: string) => ({ code, unlocked_at: '2026-10-07T20:00:00Z' })
const P1 = progressOf(400)
const P2 = progressOf(800, { workouts: 3, target_hit: true }, { achievements: [badge('week_target_1')] })

beforeEach(() => {
  localStorage.clear()
  useProgress.getState().reset()
  api.fetchProgress.mockReset()
})

describe('useProgress', () => {
  it('loads, caches and gets ready', async () => {
    api.fetchProgress.mockResolvedValue(P1)
    const loading = useProgress.getState().load('u1')
    expect(useProgress.getState().status).toBe('loading')
    await loading
    expect(useProgress.getState()).toMatchObject({ status: 'ready', progress: P1, stale: false, pending: [] })
    expect(JSON.parse(localStorage.getItem('perf_progress_v1')!)).toEqual({ userId: 'u1', value: P1 })
  })

  it('shows the cached copy at once and marks it stale until the server answers', async () => {
    localStorage.setItem('perf_progress_v1', JSON.stringify({ userId: 'u1', value: P1 }))
    let answer!: (p: unknown) => void
    api.fetchProgress.mockReturnValue(new Promise(r => { answer = r }))
    const loading = useProgress.getState().load('u1')
    expect(useProgress.getState()).toMatchObject({ status: 'ready', progress: P1, stale: true })
    answer(P2)
    await loading
    expect(useProgress.getState()).toMatchObject({ progress: P2, stale: false })
  })

  it('keeps the cache when offline and errors without one', async () => {
    api.fetchProgress.mockRejectedValue(new Error('offline'))
    await useProgress.getState().load('u1')
    expect(useProgress.getState()).toMatchObject({ status: 'error', progress: null })
    localStorage.setItem('perf_progress_v1', JSON.stringify({ userId: 'u1', value: P1 }))
    await useProgress.getState().load('u1')
    expect(useProgress.getState()).toMatchObject({ status: 'ready', progress: P1, stale: true })
  })

  it('celebrates only what is new since the first load, once', async () => {
    api.fetchProgress.mockResolvedValue(P1)
    await useProgress.getState().load('u1')
    expect(useProgress.getState().pending).toEqual([])
    api.fetchProgress.mockResolvedValue(P2)
    await useProgress.getState().refresh()
    expect(useProgress.getState().pending).toEqual([{ kind: 'level', level: 5 }, { kind: 'achievement', code: 'week_target_1' }])
    expect(useProgress.getState().takePending()).toHaveLength(2)
    expect(useProgress.getState().pending).toEqual([])
    await useProgress.getState().refresh()
    expect(useProgress.getState().pending).toEqual([])
  })

  it('runs one follow-up when asked during a refresh', async () => {
    api.fetchProgress.mockResolvedValue(P1)
    useProgress.setState({ userId: 'u1' })
    await Promise.all([useProgress.getState().refresh(), useProgress.getState().refresh(), useProgress.getState().refresh()])
    expect(api.fetchProgress).toHaveBeenCalledTimes(2)
  })

  it('drops an answer that arrives after a sign-out', async () => {
    let answer!: (p: unknown) => void
    api.fetchProgress.mockReturnValue(new Promise(r => { answer = r }))
    const loading = useProgress.getState().load('u1')
    useProgress.getState().reset()
    answer(P1)
    await loading
    expect(useProgress.getState()).toMatchObject({ status: 'idle', progress: null, userId: null })
    expect(localStorage.getItem('perf_progress_v1')).toBeNull()
  })

  it('holds celebrations on request', () => {
    useProgress.getState().hold(true)
    expect(useProgress.getState().held).toBe(true)
    useProgress.getState().hold(false)
    expect(useProgress.getState().held).toBe(false)
  })
})
```

`levelFor(800)`: 100 + 150 + 200 + 250 = 700 → nível 5; `levelFor(400)` = nível 3. Daí o `{ kind: 'level', level: 5 }`.

Criar `src/features/gamification/after-event.test.ts`:

```ts
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ flush: vi.fn(), fetchProgress: vi.fn() }))
vi.mock('./events', () => ({ flush: h.flush }))
vi.mock('./progress-api', () => ({ fetchProgress: h.fetchProgress }))

import { syncProgress, weighInXp } from './after-event'
import { useProgress } from './useProgress'
import { progressOf } from './test-progress'

beforeEach(() => {
  localStorage.clear()
  useProgress.getState().reset()
  useProgress.setState({ userId: 'u1' })
  h.flush.mockReset()
  h.fetchProgress.mockReset()
})

describe('syncProgress', () => {
  it('is confirmed when the queue emptied and the server answered', async () => {
    h.flush.mockResolvedValue({ sent: 2, left: 0 })
    h.fetchProgress.mockResolvedValue(progressOf(600))
    await expect(syncProgress()).resolves.toEqual({ progress: progressOf(600), confirmed: true })
  })

  it('is not confirmed while events wait in the queue', async () => {
    h.flush.mockResolvedValue({ sent: 0, left: 2 })
    h.fetchProgress.mockResolvedValue(progressOf(400))
    expect((await syncProgress()).confirmed).toBe(false)
  })

  it('is not confirmed when the server does not answer', async () => {
    h.flush.mockResolvedValue({ sent: 0, left: 0 })
    h.fetchProgress.mockRejectedValue(new Error('offline'))
    await expect(syncProgress()).resolves.toEqual({ progress: null, confirmed: false })
  })
})

describe('weighInXp', () => {
  it('is 10 for the first weigh-in of today and 0 otherwise', () => {
    useProgress.setState({ progress: progressOf(400) })
    expect(weighInXp('2026-10-07')).toBe(10)
    expect(weighInXp('2026-10-06')).toBe(0)
    useProgress.setState({ progress: progressOf(400, { weighed_today: true }) })
    expect(weighInXp('2026-10-07')).toBe(0)
    useProgress.setState({ progress: null })
    expect(weighInXp('2026-10-07')).toBe(0)
  })
})
```

Run: `npx vitest run src/features/gamification`
Expected: FAIL (`Cannot find module './progress-api'`, `'./preview'`, `'./celebrations'`, `'./useProgress'`, `'./after-event'`).

- [ ] **Step 4: Implementar**

Criar `src/features/gamification/progress-api.ts`:

```ts
import { supabase } from '@/lib/supabase'
import type { Progress } from './types'

export async function fetchProgress(): Promise<Progress> {
  const { data, error } = await supabase.rpc('get_my_progress')
  if (error) throw new Error(error.message)
  const p = data as unknown as Progress | null
  if (!p || typeof p.total_xp !== 'number' || !p.level || !p.week) throw new Error('bad_progress')
  return p
}
```

(Se o `tsc` recusar `supabase.rpc('get_my_progress')` por causa do tipo de `Args`, trocar `Args: Record<PropertyKey, never>` por `Args: never` em `database.types.ts`, que é o que o gerador do Supabase escreve para funções sem argumentos.)

Criar `src/features/gamification/preview.ts`:

```ts
import { achievementByCode } from './achievements'
import { EXTRA_XP, PR_LIMIT, PR_XP, WEEK_TARGET_BONUS, WEIGHT_XP, sessionXp, weekStartOf, workoutAwards } from './xp'
import type { Progress, XpLine, XpPreview } from './types'

const sum = (lines: XpLine[]) => lines.reduce((n, l) => n + l.amount, 0)

// What finishing a workout on `occurredOn` with `prs` new records is about to pay, from the
// progress the app already holds. Null when it cannot be known here: no progress yet, or a
// session logged into another week (that week's counts are not on the phone).
export function previewWorkout(p: Progress | null, input: { occurredOn: string; prs: number }): XpPreview | null {
  if (!p || weekStartOf(input.occurredOn) !== p.week.start) return null
  const w = p.week
  const lines: XpLine[] = []
  for (const a of workoutAwards({ workouts: w.workouts, extras: w.extras, prs: w.prs }, w.target)) {
    if (a.reason === 'workout') lines.push({ kind: 'workout', amount: a.amount, index: w.workouts + 1, of: w.target })
    else if (a.reason === 'week_target') lines.push({ kind: 'goal', amount: a.amount })
    else lines.push({ kind: 'extra', amount: a.amount })
  }
  const prs = Math.max(0, Math.min(input.prs, PR_LIMIT - w.prs))
  if (prs > 0) lines.push({ kind: 'pr', amount: prs * PR_XP, count: prs })
  return { lines, total: sum(lines) }
}

// The server's answer told line by line: the week's counters before and after, the new badges,
// and whatever is left (a session in a past week, say) as one last line.
export function linesFromProgress(before: Progress, after: Progress): XpLine[] {
  const lines: XpLine[] = []
  const b = before.week
  const a = after.week
  if (b.start === a.start) {
    for (let k = b.workouts + 1; k <= a.workouts; k++) lines.push({ kind: 'workout', amount: sessionXp(a.target, k), index: k, of: a.target })
    if (!b.target_hit && a.target_hit) lines.push({ kind: 'goal', amount: WEEK_TARGET_BONUS })
    for (let k = b.extras; k < a.extras; k++) lines.push({ kind: 'extra', amount: EXTRA_XP })
    if (a.prs > b.prs) lines.push({ kind: 'pr', amount: (a.prs - b.prs) * PR_XP, count: a.prs - b.prs })
    if (before.today === after.today && !b.weighed_today && a.weighed_today) lines.push({ kind: 'weight', amount: WEIGHT_XP })
  }
  const had = new Set(before.achievements.map(x => x.code))
  for (const x of after.achievements) {
    const xp = had.has(x.code) ? 0 : achievementByCode(x.code)?.xp ?? 0
    if (xp > 0) lines.push({ kind: 'achievement', amount: xp, code: x.code })
  }
  const rest = after.total_xp - before.total_xp - sum(lines)
  if (rest > 0) lines.push({ kind: 'other', amount: rest })
  return lines
}

// The running week never breaks a streak, and once its goal is met it is already in.
export const displayStreak = (p: Progress): number => p.streak.current + (p.week.target_hit ? 1 : 0)
```

Criar `src/features/gamification/celebrations.ts`:

```ts
import { ACHIEVEMENTS } from './achievements'
import type { Celebration, Progress } from './types'

// What the person has already been shown: their level and badges at that moment.
export type SeenMarker = { level: number; codes: string[] }

export const markerOf = (p: Progress): SeenMarker => ({ level: p.level.level, codes: p.achievements.map(a => a.code) })

// A level-up (one card, the level reached) and then each new badge, in catalogue order.
export function celebrationsSince(seen: SeenMarker, p: Progress): Celebration[] {
  const out: Celebration[] = []
  if (p.level.level > seen.level) out.push({ kind: 'level', level: p.level.level })
  const had = new Set(seen.codes)
  const now = new Set(p.achievements.map(a => a.code))
  for (const a of ACHIEVEMENTS) if (now.has(a.code) && !had.has(a.code)) out.push({ kind: 'achievement', code: a.code })
  return out
}
```

Criar `src/features/gamification/useProgress.ts`:

```ts
import { create } from 'zustand'
import { fetchProgress } from './progress-api'
import { celebrationsSince, markerOf, type SeenMarker } from './celebrations'
import type { Celebration, Progress } from './types'

const CACHE = 'perf_progress_v1'
const SEEN = 'perf_celebrated_v1'

type Status = 'idle' | 'loading' | 'ready' | 'error'

interface ProgressStore {
  status: Status
  progress: Progress | null
  userId: string | null
  // Showing the cached copy: the server has not answered since this screen opened.
  stale: boolean
  // Level-ups and badges not shown yet (CelebrationHost shows them).
  pending: Celebration[]
  // The post-workout summary holds the celebrations until its XP has finished counting.
  held: boolean
  load(userId: string): Promise<void>
  refresh(): Promise<Progress | null>
  takePending(): Celebration[]
  hold(on: boolean): void
  reset(): void
}

const read = <T>(key: string, userId: string): T | null => {
  try {
    const c = JSON.parse(localStorage.getItem(key) || 'null')
    return c && c.userId === userId ? (c.value as T) : null
  } catch { return null }
}
const write = (key: string, userId: string, value: unknown) => {
  try { localStorage.setItem(key, JSON.stringify({ userId, value })) } catch { /* storage full or blocked */ }
}
const drop = (key: string) => { try { localStorage.removeItem(key) } catch { /* ignore */ } }

let running: Promise<Progress | null> | null = null
let again: Promise<Progress | null> | null = null

export const useProgress = create<ProgressStore>((set, get) => {
  const fetchOnce = async (): Promise<Progress | null> => {
    const userId = get().userId
    if (!userId) return null
    try {
      const progress = await fetchProgress()
      if (get().userId !== userId) return null
      write(CACHE, userId, progress)
      // The first answer for this person on this device sets what counts as already seen.
      let seen = read<SeenMarker>(SEEN, userId)
      if (!seen) { seen = markerOf(progress); write(SEEN, userId, seen) }
      set({ progress, status: 'ready', stale: false, pending: celebrationsSince(seen, progress) })
      return progress
    } catch {
      if (get().userId !== userId) return null
      set(s => ({ status: s.progress ? 'ready' : 'error', stale: !!s.progress }))
      return null
    }
  }

  return {
    status: 'idle',
    progress: null,
    userId: null,
    stale: false,
    pending: [],
    held: false,

    async load(userId) {
      const cached = read<Progress>(CACHE, userId)
      set({ userId, progress: cached, status: cached ? 'ready' : 'loading', stale: !!cached, pending: [] })
      await get().refresh()
    },

    // One request at a time. A call made while one runs (an event sent mid-request) gets a single
    // follow-up, so the answer it waits for includes what it just sent.
    refresh() {
      if (!running) {
        running = fetchOnce().finally(() => { running = null })
        return running
      }
      if (!again) again = running.then(() => { again = null; return get().refresh() })
      return again
    },

    takePending() {
      const { pending, progress, userId } = get()
      if (userId && progress) write(SEEN, userId, markerOf(progress))
      set({ pending: [] })
      return pending
    },

    hold(on) {
      set({ held: on })
    },

    reset() {
      drop(CACHE)
      drop(SEEN)
      set({ status: 'idle', progress: null, userId: null, stale: false, pending: [], held: false })
    }
  }
})

// Fresh numbers whenever the app comes back to the foreground or online.
export function startProgressSync(): () => void {
  const run = () => { if (document.visibilityState === 'visible') void useProgress.getState().refresh() }
  window.addEventListener('online', run)
  document.addEventListener('visibilitychange', run)
  return () => {
    window.removeEventListener('online', run)
    document.removeEventListener('visibilitychange', run)
  }
}
```

Criar `src/features/gamification/after-event.ts`:

```ts
import { flush } from './events'
import { useProgress } from './useProgress'
import { WEIGHT_XP } from './xp'
import type { SyncResult } from './types'

// Sends the queued events, then reads the progress. Confirmed only when nothing was left in the
// queue: otherwise the answer does not include what was just done yet.
export async function syncProgress(): Promise<SyncResult> {
  const { left } = await flush()
  const progress = await useProgress.getState().refresh()
  return { progress, confirmed: !!progress && left === 0 }
}

// XP a weigh-in on `day` is about to earn: the first one of today pays, later ones do not.
export function weighInXp(day: string): number {
  const p = useProgress.getState().progress
  return p && p.today === day && !p.week.weighed_today ? WEIGHT_XP : 0
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run src/features/gamification`
Expected: PASS.

- [ ] **Step 6: Carregar o progresso no `App`**

Em `src/App.jsx`, acrescentar o import:

```jsx
import { useProgress, startProgressSync } from './features/gamification/useProgress.ts'
```

Trocar a linha

```jsx
  useEffect(() => { if (!user) useProfile.getState().reset() }, [user?.id])
```

por

```jsx
  useEffect(() => { if (!user) { useProfile.getState().reset(); useProgress.getState().reset() } }, [user?.id])
```

e, logo depois da linha `const profileReady = useProfile(s => s.status === 'ready' && !s.onboarding) || !user`, acrescentar:

```jsx
  // Gamification numbers for a signed-in account with a profile (get_my_progress needs one): the
  // cached copy at once, the server's right after, and again whenever the app comes back.
  useEffect(() => {
    if (!user || !profileReady) return
    void useProgress.getState().load(user.id)
    return startProgressSync()
  }, [user?.id, profileReady])
```

(Os dois `useEffect` ficam antes do primeiro `return` condicional de `Shell`, como os demais hooks.)

- [ ] **Step 7: Verificar e commitar**

```bash
npm run typecheck && npm test && npm run build
git add src/lib/database.types.ts src/features/gamification src/App.jsx
git commit -m "feat(gamification): progress store, preview and server reconciliation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Textos da 1a nos 16 idiomas e rótulos das conquistas

**Files:**
- Modify: `src/locales/pt-BR.js` (`PT_BR_OVERRIDES`), `src/locales/pt.js` e os outros 14 packs: `ar.js`, `de.js`, `es.js`, `fr.js`, `hi.js`, `hu.js`, `it.js`, `ko.js`, `pl.js`, `ru.js`, `th.js`, `tr.js`, `uk.js`, `zh.js`
- Create: `src/features/gamification/achievement-labels.ts`
- Test: `src/features/gamification/achievement-labels.test.ts`

**Interfaces:**
- Consumes: `ACHIEVEMENTS`, `AchievementCode` (Task 7); `t` de `src/lib/i18n.js`.
- Produces: todas as chaves abaixo presentes nos 16 packs (as tasks 10–13 usam exatamente estas chaves inglesas); `ACHIEVEMENT_TEXT: Record<AchievementCode, { title: () => string; detail: () => string }>`.

Chaves já existentes que as próximas tasks reutilizam sem mexer nos packs: `'{0} week streak'`,
`'Week streak'`, `'Strength'`, `'{0} workouts'`, `'This week'`, `'Try again'`, `'Back'`, `'Today'`,
`'Settings'`, `'Profile'`, `'Hi {0}'`, `'Previous week'`, `'Next week'`, `'Body weight'`, `'Goal'`,
`'Log'`, `'All weigh-ins'`, `'Weight saved'`, `'{0} workout total'`, `'{0} workouts total'` e as
demais strings da Home legada.

- [ ] **Step 1: Chaves novas**

| # | Chave (inglês, é o texto em inglês) | pt-BR |
|---|---|---|
| 1 | `Level {0}` | `Nível {0}` |
| 2 | `{0} XP to level {1}` | `Faltam {0} XP para o nível {1}` |
| 3 | `{0} of {1} XP` | `{0} de {1} XP` |
| 4 | `Weekly goal met` | `Meta da semana cumprida` |
| 5 | `{0} of {1} workouts` | `{0} de {1} treinos` |
| 6 | `Achievements` | `Conquistas` |
| 7 | `{0} of {1} unlocked` | `{0} de {1} desbloqueadas` |
| 8 | `Offline. Showing your last saved progress.` | `Sem conexão. Este é o último progresso salvo.` |
| 9 | `Finish a workout to earn your first XP.` | `Termine um treino para ganhar seus primeiros XP.` |
| 10 | `Could not load your progress.` | `Não deu para carregar seu progresso.` |
| 11 | `A shield keeps your streak going when you miss a week. You get one every 4 weeks in a row, and can hold 2.` | `O escudo segura sua sequência quando você perde uma semana. Você ganha um a cada 4 semanas seguidas e pode guardar até 2.` |
| 12 | `Best: {0}` | `Recorde: {0}` |
| 13 | `Streak shields` | `Escudos da sequência` |
| 14 | `Shields: {0} of {1}` | `Escudos: {0} de {1}` |
| 15 | `Calendar` | `Calendário` |
| 16 | `XP earned` | `XP ganho` |
| 17 | `Workout {0} of {1}` | `Treino {0} de {1}` |
| 18 | `Extra workout` | `Treino extra` |
| 19 | `Weekly goal bonus` | `Bônus da meta semanal` |
| 20 | `Personal records ×{0}` | `Recordes pessoais ×{0}` |
| 21 | `Weigh-in` | `Pesagem` |
| 22 | `Achievement: {0}` | `Conquista: {0}` |
| 23 | `Other gains` | `Outros ganhos` |
| 24 | `Counting your XP…` | `Contando seu XP…` |
| 25 | `This workout counts toward a past week. Its XP shows up once it syncs.` | `Este treino conta para uma semana que já passou. O XP aparece quando ele sincronizar.` |
| 26 | `No XP this time. You already got the two extra workouts this week.` | `Desta vez não rendeu XP. Os dois treinos extras da semana já foram contados.` |
| 27 | `+{0} XP` | `+{0} XP` |
| 28 | `Estimate. It is confirmed when you are back online.` | `Estimativa. A confirmação chega quando a conexão voltar.` |
| 29 | `Level up!` | `Subiu de nível!` |
| 30 | `You reached level {0}.` | `Você chegou ao nível {0}.` |
| 31 | `Achievement unlocked` | `Conquista desbloqueada` |
| 32 | `Tap to continue` | `Toque para continuar` |
| 33 | `Weight saved. +{0} XP` | `Peso salvo. +{0} XP` |
| 34 | `Unlocked on {0}` | `Desbloqueada em {0}` |
| 35 | `Locked` | `Bloqueada` |
| 36 | `Unlocks once friends arrive in the app.` | `Libera quando a área de amigos chegar ao app.` |
| 37 | `{0} of {1}` | `{0} de {1}` |
| 38 | `Badge only` | `Só a medalha` |
| 39 | `Overall level` | `Nível geral` |
| 40 | `Total XP` | `XP total` |
| 41 | `First workout` | `Primeiro treino` |
| 42 | `Finish your first workout.` | `Termine seu primeiro treino.` |
| 43 | `Finish {0} workouts.` | `Termine {0} treinos.` |
| 44 | `First PR` | `Primeiro recorde` |
| 45 | `Beat your best weight on an exercise.` | `Supere seu melhor peso em um exercício.` |
| 46 | `{0} PRs` | `{0} recordes` |
| 47 | `Set {0} personal records.` | `Bata {0} recordes pessoais.` |
| 48 | `Goal met` | `Meta cumprida` |
| 49 | `Meet your weekly workout goal for the first time.` | `Cumpra sua meta semanal de treinos pela primeira vez.` |
| 50 | `{0} weeks in a row` | `{0} semanas seguidas` |
| 51 | `Meet your weekly goal {0} weeks in a row.` | `Cumpra a meta semanal {0} semanas seguidas.` |
| 52 | `Steady scale` | `Balança em dia` |
| 53 | `Log your weight 7 days in a row.` | `Registre seu peso 7 dias seguidos.` |
| 54 | `Reach level {0}.` | `Chegue ao nível {0}.` |
| 55 | `First friend` | `Primeira amizade` |
| 56 | `Add your first friend.` | `Adicione seu primeiro amigo.` |
| 57 | `First challenge` | `Primeiro desafio` |
| 58 | `Complete a challenge with friends.` | `Conclua um desafio com amigos.` |
| 59 | `{0} challenges` | `{0} desafios` |
| 60 | `Complete {0} challenges with friends.` | `Conclua {0} desafios com amigos.` |
| 61 | `Early bird` | `Madrugador` |
| 62 | `Finish 5 workouts started before 7 a.m.` | `Termine 5 treinos começados antes das 7h.` |

- [ ] **Step 2: Humanizer**

Rodar a skill `anthropic-skills:humanizer` sobre a coluna pt-BR e a skill `humanizer` sobre a coluna
inglesa. Ajustar a redação em pt-BR livremente. Uma mudança de chave inglesa vale a partir daqui e
precisa ser propagada para todos os usos nas Tasks 10–13 (buscar a chave antiga neste plano); por
isso, mexer numa chave inglesa só se ela tiver vício de texto de IA. Nenhum valor pode ter `—`, `–`
ou ` - `.

- [ ] **Step 3: Escrever nos packs**

- `src/locales/pt-BR.js`: acrescentar as 62 linhas ao fim de `PT_BR_OVERRIDES`, depois de um comentário `// Phase 1a: gamification`, no formato `'Level {0}': 'Nível {0}',` (aspas simples; escapar `'` como `\'`).
- `src/locales/pt.js`: acrescentar as mesmas 62 chaves ao fim do objeto exportado com o texto em português europeu (a maior parte igual ao pt-BR; trocar "você" por construções sem pronome, "Registre" por "Regista", "Toque" por "Toca", "Supere" por "Supera", "Termine" por "Termina", "Cumpra" por "Cumpre", "Chegue" por "Chega", "Adicione" por "Adiciona", "Conclua" por "Conclui", "Bata" por "Bate"). O teste `src/lib/pt-br-locale.test.js` exige que `pt.js` e `pt-BR.js` tenham o mesmo conjunto de chaves; como todas estão em `PT_BR_OVERRIDES`, o fingerprint de herança não muda.
- Os outros 14 packs: acrescentar as 62 chaves ao fim de cada objeto exportado com tradução real para o idioma do arquivo, preservando `{0}`/`{1}`, `×` e `+` exatamente. Sem travessão como pausa também nesses idiomas.

- [ ] **Step 4: Rótulos das conquistas, teste que falha**

Criar `src/features/gamification/achievement-labels.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { ACHIEVEMENTS } from './achievements'
import { ACHIEVEMENT_TEXT } from './achievement-labels'

describe('achievement labels', () => {
  it('names and describes every badge of the catalogue', () => {
    for (const a of ACHIEVEMENTS) {
      const text = ACHIEVEMENT_TEXT[a.code]
      expect(text, a.code).toBeTruthy()
      expect(text.title().trim(), a.code).not.toBe('')
      expect(text.detail().trim(), a.code).not.toBe('')
    }
  })

  it('puts the threshold in the counted badges', () => {
    expect(ACHIEVEMENT_TEXT.workouts_50.title()).toBe('50 workouts')
    expect(ACHIEVEMENT_TEXT.streak_12.detail()).toBe('Meet your weekly goal 12 weeks in a row.')
    expect(ACHIEVEMENT_TEXT.level_25.title()).toBe('Level 25')
  })
})
```

Run: `npx vitest run src/features/gamification/achievement-labels.test.ts`
Expected: FAIL (`Cannot find module './achievement-labels'`).

- [ ] **Step 5: Implementar**

Criar `src/features/gamification/achievement-labels.ts`:

```ts
import { t } from '../../lib/i18n.js'
import type { AchievementCode } from './achievements'

type Text = { title: () => string; detail: () => string }

// Functions, so each t() call stays a literal that scripts/check-source-strings.mjs can see and the
// text follows the language chosen at render time.
export const ACHIEVEMENT_TEXT: Record<AchievementCode, Text> = {
  first_workout: { title: () => t('First workout'), detail: () => t('Finish your first workout.') },
  workouts_10: { title: () => t('{0} workouts', 10), detail: () => t('Finish {0} workouts.', 10) },
  workouts_50: { title: () => t('{0} workouts', 50), detail: () => t('Finish {0} workouts.', 50) },
  workouts_100: { title: () => t('{0} workouts', 100), detail: () => t('Finish {0} workouts.', 100) },
  workouts_250: { title: () => t('{0} workouts', 250), detail: () => t('Finish {0} workouts.', 250) },
  workouts_500: { title: () => t('{0} workouts', 500), detail: () => t('Finish {0} workouts.', 500) },
  first_pr: { title: () => t('First PR'), detail: () => t('Beat your best weight on an exercise.') },
  prs_10: { title: () => t('{0} PRs', 10), detail: () => t('Set {0} personal records.', 10) },
  prs_50: { title: () => t('{0} PRs', 50), detail: () => t('Set {0} personal records.', 50) },
  week_target_1: { title: () => t('Goal met'), detail: () => t('Meet your weekly workout goal for the first time.') },
  streak_4: { title: () => t('{0} weeks in a row', 4), detail: () => t('Meet your weekly goal {0} weeks in a row.', 4) },
  streak_12: { title: () => t('{0} weeks in a row', 12), detail: () => t('Meet your weekly goal {0} weeks in a row.', 12) },
  streak_26: { title: () => t('{0} weeks in a row', 26), detail: () => t('Meet your weekly goal {0} weeks in a row.', 26) },
  streak_52: { title: () => t('{0} weeks in a row', 52), detail: () => t('Meet your weekly goal {0} weeks in a row.', 52) },
  weigh_in_7: { title: () => t('Steady scale'), detail: () => t('Log your weight 7 days in a row.') },
  level_10: { title: () => t('Level {0}', 10), detail: () => t('Reach level {0}.', 10) },
  level_25: { title: () => t('Level {0}', 25), detail: () => t('Reach level {0}.', 25) },
  level_50: { title: () => t('Level {0}', 50), detail: () => t('Reach level {0}.', 50) },
  first_friend: { title: () => t('First friend'), detail: () => t('Add your first friend.') },
  challenge_first: { title: () => t('First challenge'), detail: () => t('Complete a challenge with friends.') },
  challenge_won_5: { title: () => t('{0} challenges', 5), detail: () => t('Complete {0} challenges with friends.', 5) },
  early_bird: { title: () => t('Early bird'), detail: () => t('Finish 5 workouts started before 7 a.m.') }
}
```

- [ ] **Step 6: Verificar e commitar**

```bash
npx vitest run src/features/gamification/achievement-labels.test.ts src/lib/pt-br-locale.test.js src/lib/public-copy.test.js src/lib/locale-coverage.test.js
node scripts/check-locales.mjs
node scripts/check-source-strings.mjs --strict
npm run typecheck && npm test && npm run build
git add src/locales src/features/gamification/achievement-labels.ts src/features/gamification/achievement-labels.test.ts
git commit -m "feat(i18n): gamification copy in all locale packs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: tudo verde; `check-source-strings` informa que todas as strings de `src/` estão nos packs.

---

### Task 10: Peças visuais e celebrações

**Files:**
- Create: `src/features/gamification/format.ts`
- Create: `src/features/gamification/useCountUp.ts`
- Create: `src/features/gamification/components/LevelBar.tsx`
- Create: `src/features/gamification/components/StreakBadge.tsx`
- Create: `src/features/gamification/components/AchievementIcon.tsx`
- Create: `src/features/gamification/components/CelebrationOverlay.tsx`
- Create: `src/features/gamification/CelebrationHost.tsx`
- Modify: `src/App.jsx`
- Test: `src/features/gamification/useCountUp.test.tsx`, `components/LevelBar.test.tsx`, `components/StreakBadge.test.tsx`, `components/CelebrationOverlay.test.tsx`, `CelebrationHost.test.tsx`

**Interfaces:**
- Consumes: `useProgress` (`pending`, `held`, `takePending`) da Task 8; `ACHIEVEMENT_TEXT` da Task 9; `achievementByCode`, `Metric` da Task 7; `SHIELD_MAX`, `LevelInfo` da Task 6.
- Produces:
  - `fmtInt(n: number): string`, `fmtDay(iso: string): string` (`format.ts`);
  - `useCountUp(to: number, opts?: { from?: number; ms?: number; instant?: boolean; onDone?: () => void }): number`;
  - `<LevelBar to: LevelInfo; from?: LevelInfo | null; instant?: boolean; label: string; className?: string; fillClassName?: string />` (`role="progressbar"`, `data-slot="level-fill"` no preenchimento);
  - `<StreakBadge current: number; shields: number; expanded: boolean; onToggle: () => void; controls?: string />`;
  - `<AchievementIcon code: string; unlocked: boolean; className?: string />`;
  - `<CelebrationOverlay items: Celebration[]; onDone: () => void />` (portal em `document.body`, `z-[150]`);
  - `CelebrationHost` (default export), montado no `App`.

- [ ] **Step 1: Testes que falham**

Criar `src/features/gamification/useCountUp.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCountUp } from './useCountUp'

afterEach(() => vi.unstubAllGlobals())

describe('useCountUp', () => {
  it('lands on the target at once when instant', () => {
    const onDone = vi.fn()
    const { result } = renderHook(() => useCountUp(750, { instant: true, onDone }))
    expect(result.current).toBe(750)
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('counts to the target and then to a new one from where it is', () => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(performance.now() + 10_000); return 1 })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    const onDone = vi.fn()
    const { result, rerender } = renderHook(({ to }) => useCountUp(to, { onDone }), { initialProps: { to: 200 } })
    expect(result.current).toBe(200)
    act(() => rerender({ to: 280 }))
    expect(result.current).toBe(280)
    expect(onDone).toHaveBeenCalledTimes(2)
  })
})
```

Criar `src/features/gamification/components/LevelBar.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'
import { LevelBar } from './LevelBar'

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })
const fill = (c: HTMLElement) => (c.querySelector('[data-slot="level-fill"]') as HTMLElement).style.width

describe('LevelBar', () => {
  it('shows the share of the level reached', () => {
    const { container, getByRole } = render(<LevelBar to={{ level: 3, into: 50, need: 200 }} instant label="Level 3" />)
    expect(fill(container)).toBe('25%')
    expect(getByRole('progressbar', { name: 'Level 3' }).getAttribute('aria-valuenow')).toBe('50')
  })

  it('runs to the end, empties and refills across a level-up', () => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number)
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
    const { container } = render(<LevelBar from={{ level: 3, into: 150, need: 200 }} to={{ level: 4, into: 50, need: 250 }} label="Level 4" />)
    expect(fill(container)).toBe('75%')
    act(() => { vi.advanceTimersByTime(1) })
    expect(fill(container)).toBe('100%')
    act(() => { vi.advanceTimersByTime(700) })
    expect(fill(container)).toBe('20%')
  })
})
```

Criar `src/features/gamification/components/StreakBadge.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { StreakBadge } from './StreakBadge'

afterEach(cleanup)

describe('StreakBadge', () => {
  it('says the streak and the shields, and toggles the explanation', () => {
    const onToggle = vi.fn()
    const { container } = render(<StreakBadge current={5} shields={1} expanded={false} onToggle={onToggle} />)
    const button = screen.getByRole('button', { name: '5 week streak. Shields: 1 of 2' })
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelectorAll('[data-shield="on"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-shield="off"]')).toHaveLength(1)
    fireEvent.click(button)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })
})
```

Criar `src/features/gamification/components/CelebrationOverlay.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { CelebrationOverlay } from './CelebrationOverlay'

afterEach(cleanup)

describe('CelebrationOverlay', () => {
  it('shows one card at a time and finishes after the last', () => {
    const onDone = vi.fn()
    render(<CelebrationOverlay items={[{ kind: 'level', level: 5 }, { kind: 'achievement', code: 'first_workout' }]} onDone={onDone} />)
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText('Level up!')).toBeTruthy()
    expect(screen.getByText('Level 5')).toBeTruthy()
    fireEvent.click(screen.getByText('Tap to continue'))
    expect(screen.getByText('Achievement unlocked')).toBeTruthy()
    expect(screen.getByText('First workout')).toBeTruthy()
    expect(screen.getByText('+50 XP')).toBeTruthy()
    expect(onDone).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Tap to continue'))
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('skips the rest on Escape', () => {
    const onDone = vi.fn()
    render(<CelebrationOverlay items={[{ kind: 'level', level: 5 }, { kind: 'level', level: 6 }]} onDone={onDone} />)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onDone).toHaveBeenCalledTimes(1)
  })
})
```

Criar `src/features/gamification/CelebrationHost.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import CelebrationHost from './CelebrationHost'
import { useProgress } from './useProgress'

beforeEach(() => {
  localStorage.clear()
  useProgress.getState().reset()
})
afterEach(cleanup)

describe('CelebrationHost', () => {
  it('shows pending celebrations and clears them', () => {
    useProgress.setState({ pending: [{ kind: 'level', level: 3 }] })
    render(<CelebrationHost />)
    expect(screen.getByText('Level 3')).toBeTruthy()
    expect(useProgress.getState().pending).toEqual([])
    fireEvent.click(screen.getByText('Tap to continue'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('waits while held', () => {
    useProgress.setState({ pending: [{ kind: 'level', level: 3 }], held: true })
    render(<CelebrationHost />)
    expect(screen.queryByRole('dialog')).toBeNull()
    act(() => useProgress.getState().hold(false))
    expect(screen.getByText('Level 3')).toBeTruthy()
  })
})
```

Run: `npx vitest run src/features/gamification`
Expected: FAIL nos cinco arquivos novos (módulos inexistentes).

- [ ] **Step 2: `format.ts` e `useCountUp.ts`**

Criar `src/features/gamification/format.ts`:

```ts
import { dateLocale } from '../../lib/i18n.js'

// "1.110" in Portuguese, "1,110" in English.
export const fmtInt = (n: number): string => Math.round(n).toLocaleString(dateLocale())

export const fmtDay = (iso: string): string =>
  new Date(iso).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short', year: 'numeric' })
```

Criar `src/features/gamification/useCountUp.ts`:

```ts
import { useEffect, useRef, useState } from 'react'

type Options = { from?: number; ms?: number; instant?: boolean; onDone?: () => void }

// Counts to `to` with an ease-out curve, starting from wherever the number is (the preview first,
// then the server's figure). instant (reduced motion) lands on `to` at once. onDone runs each time
// a target is reached.
export function useCountUp(to: number, { from = 0, ms = 700, instant = false, onDone }: Options = {}): number {
  const [value, setValue] = useState(instant ? to : from)
  const shown = useRef(instant ? to : from)
  const done = useRef(onDone)
  done.current = onDone

  useEffect(() => {
    if (instant || typeof requestAnimationFrame !== 'function') {
      shown.current = to
      setValue(to)
      done.current?.()
      return
    }
    const start = performance.now()
    const a = shown.current
    let frame = 0
    const tick = (now: number) => {
      const k = Math.min(1, Math.max(0, (now - start) / ms))
      const v = Math.round(a + (to - a) * (1 - Math.pow(1 - k, 3)))
      shown.current = v
      setValue(v)
      if (k < 1) frame = requestAnimationFrame(tick)
      else done.current?.()
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [to, ms, instant])

  return value
}
```

- [ ] **Step 3: `LevelBar`, `StreakBadge`, `AchievementIcon`**

Criar `src/features/gamification/components/LevelBar.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import type { LevelInfo } from '../xp'

const FILL_MS = 600
const pct = (l: LevelInfo) => Math.max(0, Math.min(100, (l.into / l.need) * 100))

type Props = { to: LevelInfo; from?: LevelInfo | null; instant?: boolean; label: string; className?: string; fillClassName?: string }

// The bar to the next level. With `from` it fills from there; across a level-up it runs to the end,
// empties and fills to the new level's share. instant (reduced motion, static screens) skips that.
export function LevelBar({ to, from = null, instant = false, label, className, fillClassName }: Props) {
  const still = instant || !from
  const [width, setWidth] = useState(still || !from ? pct(to) : pct(from))
  const [moving, setMoving] = useState(false)

  useEffect(() => {
    if (still || !from) { setMoving(false); setWidth(pct(to)); return }
    const timers: number[] = []
    const frame = requestAnimationFrame(() => {
      setMoving(true)
      if (to.level > from.level) {
        setWidth(100)
        timers.push(window.setTimeout(() => {
          setMoving(false)
          setWidth(0)
          timers.push(window.setTimeout(() => { setMoving(true); setWidth(pct(to)) }, 40))
        }, FILL_MS))
      } else {
        setWidth(pct(to))
      }
    })
    return () => { cancelAnimationFrame(frame); timers.forEach(id => clearTimeout(id)) }
  }, [still, from?.level, from?.into, from?.need, to.level, to.into, to.need])

  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={to.need} aria-valuenow={to.into}
      data-slot="level-bar" className={cn('relative h-2.5 w-full overflow-hidden rounded-full bg-primary/15', className)}>
      <div data-slot="level-fill" style={{ width: `${width}%` }}
        className={cn('h-full rounded-full bg-primary', moving && 'transition-[width] duration-[600ms] ease-[cubic-bezier(0.22,1,0.36,1)]', fillClassName)} />
    </div>
  )
}
```

Criar `src/features/gamification/components/StreakBadge.tsx`:

```tsx
import { Flame, Shield, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { t } from '../../../lib/i18n.js'
import { SHIELD_MAX } from '../xp'

type Props = { current: number; shields: number; expanded: boolean; onToggle: () => void; controls?: string }

// Flame with the weeks in a row, then the shields held (filled) and free slots (outline). A tap
// opens the explanation of shields where the badge sits.
export function StreakBadge({ current, shields, expanded, onToggle, controls }: Props) {
  return (
    <button type="button" data-slot="streak-badge" onClick={onToggle} aria-expanded={expanded} aria-controls={controls}
      aria-label={t('{0} week streak', current) + '. ' + t('Shields: {0} of {1}', shields, SHIELD_MAX)}
      className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-border bg-secondary/70 py-1.5 pl-2.5 pr-3 outline-none transition-transform duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100">
      <Flame aria-hidden className={cn('size-5', current > 0 ? 'text-[var(--pillar-strength)]' : 'text-muted-foreground')} />
      <span className="font-mono text-lg font-semibold leading-none tabular-nums">{current}</span>
      <span aria-hidden className="ml-1 flex items-center gap-0.5">
        {Array.from({ length: SHIELD_MAX }, (_, i) => i < shields
          ? <ShieldCheck key={i} data-shield="on" className="size-4 text-primary" />
          : <Shield key={i} data-shield="off" className="size-4 text-muted-foreground/40" />)}
      </span>
    </button>
  )
}
```

Criar `src/features/gamification/components/AchievementIcon.tsx`:

```tsx
import { Crown, Dumbbell, Flame, Lock, Scale, Sunrise, Swords, Target, Trophy, UserPlus, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { achievementByCode, type Metric } from '../achievements'

const ICON: Record<Metric, LucideIcon> = {
  workouts: Dumbbell, prs: Trophy, week_targets: Target, best_streak: Flame, weigh_in_run: Scale,
  level: Crown, early_workouts: Sunrise, friends: UserPlus, challenges_won: Swords
}

// Decorative: the badge's name is always written next to it.
export function AchievementIcon({ code, unlocked, className }: { code: string; unlocked: boolean; className?: string }) {
  const a = achievementByCode(code)
  const Icon = a ? ICON[a.metric] : Trophy
  return (
    <span aria-hidden data-slot="achievement-icon"
      className={cn('relative grid shrink-0 place-items-center rounded-2xl', unlocked ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground/70', className)}>
      <Icon className="size-[55%]" strokeWidth={1.75} />
      {!unlocked && (
        <span className="absolute -bottom-1 -right-1 grid size-5 place-items-center rounded-full border border-border bg-card text-muted-foreground">
          <Lock className="size-3" />
        </span>
      )}
    </span>
  )
}
```

- [ ] **Step 4: `CelebrationOverlay` e `CelebrationHost`**

Criar `src/features/gamification/components/CelebrationOverlay.tsx`:

```tsx
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { motion, useReducedMotion } from 'motion/react'
import { Crown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { t } from '../../../lib/i18n.js'
import { achievementByCode, type AchievementCode } from '../achievements'
import { ACHIEVEMENT_TEXT } from '../achievement-labels'
import { AchievementIcon } from './AchievementIcon'
import { fmtInt } from '../format'
import type { Celebration } from '../types'

type View = { eyebrow: string; title: string; detail: string; xp: number; icon: ReactNode }

function viewOf(c: Celebration): View {
  if (c.kind === 'level') {
    return {
      eyebrow: t('Level up!'), title: t('Level {0}', c.level), detail: t('You reached level {0}.', c.level), xp: 0,
      icon: <span className="grid size-20 place-items-center rounded-3xl bg-primary text-primary-foreground"><Crown className="size-10" strokeWidth={1.75} /></span>
    }
  }
  const text = ACHIEVEMENT_TEXT[c.code as AchievementCode]
  return {
    eyebrow: t('Achievement unlocked'), title: text ? text.title() : c.code, detail: text ? text.detail() : '',
    xp: achievementByCode(c.code)?.xp ?? 0,
    icon: <AchievementIcon code={c.code} unlocked className="size-20" />
  }
}

// Level-ups and badges, one card at a time, above everything (the legacy #modal-root sits at
// z-index 100). A tap or Enter shows the next card; Escape skips the rest.
export function CelebrationOverlay({ items, onDone }: { items: Celebration[]; onDone: () => void }) {
  const [i, setI] = useState(0)
  const reduce = useReducedMotion() ?? false
  const card = useRef<HTMLButtonElement>(null)
  useEffect(() => { card.current?.focus() }, [i])
  const item = items[i]
  if (!item) return null
  const v = viewOf(item)
  const next = () => (i + 1 < items.length ? setI(i + 1) : onDone())

  return createPortal(
    <div role="dialog" aria-modal="true" aria-labelledby="celebration-title" aria-describedby="celebration-detail"
      data-slot="celebration" onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onDone() } }}
      className="fixed inset-0 z-[150] grid place-items-center bg-background/75 px-4 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] backdrop-blur-md">
      <motion.button key={i} ref={card} type="button" onClick={next}
        initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
        className="flex w-full max-w-sm flex-col items-center gap-3 rounded-[28px] border border-primary/30 bg-card px-6 pb-6 pt-8 text-center font-sans text-card-foreground shadow-[0_24px_60px_-20px_rgb(0_0_0/0.6)] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
        {v.icon}
        <span className="mt-2 text-xs font-semibold uppercase tracking-[0.14em] text-primary">{v.eyebrow}</span>
        <span id="celebration-title" className="text-2xl font-semibold tracking-tight text-balance">{v.title}</span>
        <span id="celebration-detail" className="text-[15px] leading-snug text-pretty text-muted-foreground">{v.detail}</span>
        {v.xp > 0 && (
          <span className="mt-1 rounded-full bg-primary/15 px-3 py-1 font-mono text-sm font-semibold tabular-nums text-primary">{t('+{0} XP', fmtInt(v.xp))}</span>
        )}
        <span className="mt-4 text-sm text-muted-foreground">{t('Tap to continue')}</span>
        {items.length > 1 && (
          <span aria-hidden className="flex gap-1.5">
            {items.map((_, k) => <span key={k} className={cn('size-1.5 rounded-full', k === i ? 'bg-primary' : 'bg-muted-foreground/30')} />)}
          </span>
        )}
      </motion.button>
    </div>,
    document.body
  )
}
```

Criar `src/features/gamification/CelebrationHost.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { useProgress } from './useProgress'
import { CelebrationOverlay } from './components/CelebrationOverlay'
import type { Celebration } from './types'

// Shows level-ups and badges the moment the store has some and nothing holds them (the
// post-workout summary does, until its XP has counted). Taking them marks them as seen.
export default function CelebrationHost() {
  const pending = useProgress(s => s.pending)
  const held = useProgress(s => s.held)
  const [items, setItems] = useState<Celebration[] | null>(null)

  useEffect(() => {
    if (items || held || !pending.length) return
    setItems(useProgress.getState().takePending())
  }, [pending, held, items])

  if (!items?.length) return null
  return <CelebrationOverlay items={items} onDone={() => setItems(null)} />
}
```

- [ ] **Step 5: Montar no `App`**

Em `src/App.jsx`, importar:

```jsx
import CelebrationHost from './features/gamification/CelebrationHost.tsx'
```

e logo depois de `{user && profileReady && <SyncIndicator />}` acrescentar:

```jsx
      {user && profileReady && <CelebrationHost />}
```

- [ ] **Step 6: Rodar e ver passar**

Run: `npx vitest run src/features/gamification`
Expected: PASS.

- [ ] **Step 7: Verificar e commitar**

```bash
npm run typecheck && npm test && npm run build
git add src/features/gamification src/App.jsx
git commit -m "feat(gamification): level bar, streak badge and celebration cards

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 11: Resumo pós-treino e XP da pesagem

**Files:**
- Create: `src/features/gamification/WorkoutXpSummary.tsx`
- Modify: `src/sheets.jsx` (`FinishSummary`, `doFinishWorkout`, `BwSheet`)
- Modify: `src/sheets.missed-day.test.jsx`, `src/sheets.plan-session.test.jsx` (mock de `events.ts` ganha `flush`)
- Test: `src/features/gamification/WorkoutXpSummary.test.tsx`
- Test: `src/sheets.finish-xp.test.jsx`

**Interfaces:**
- Consumes: `useProgress` (`progress`, `userId`, `hold`), `syncProgress`, `weighInXp` (Task 8); `previewWorkout`, `linesFromProgress` (Task 8); `levelFor` (Task 6); `useCountUp`, `LevelBar`, `fmtInt` (Task 10); `ACHIEVEMENT_TEXT` (Task 9).
- Produces: `<WorkoutXpSummary before: Progress | null; preview: XpPreview | null; settled: Promise<SyncResult> />` (default export); `FinishSummary` aceita `xp: { before, preview, settled } | null`; payload de `workout_completed` com `hour` (0–23) em sessões ao vivo.

- [ ] **Step 1: Testes que falham**

Criar `src/features/gamification/WorkoutXpSummary.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'

vi.mock('motion/react', async orig => ({ ...(await orig<typeof import('motion/react')>()), useReducedMotion: () => true }))

import WorkoutXpSummary from './WorkoutXpSummary'
import { useProgress } from './useProgress'
import { progressOf } from './test-progress'
import type { SyncResult, XpPreview } from './types'

const before = progressOf(400)
const preview: XpPreview = { lines: [{ kind: 'workout', amount: 200, index: 2, of: 3 }], total: 200 }
const never = () => new Promise<SyncResult>(() => {})
const show = async (props: { preview: XpPreview | null; settled: Promise<SyncResult>; before?: typeof before | null }) => {
  await act(async () => { render(<WorkoutXpSummary before={props.before === undefined ? before : props.before} preview={props.preview} settled={props.settled} />) })
}

beforeEach(() => { localStorage.clear(); useProgress.getState().reset() })
afterEach(cleanup)

describe('WorkoutXpSummary', () => {
  it('shows the preview at once and holds the celebrations', async () => {
    await show({ preview, settled: never() })
    expect(screen.getAllByText('+200 XP').length).toBeGreaterThan(0)
    expect(screen.getByText('Workout 2 of 3')).toBeTruthy()
    expect(screen.getByRole('progressbar', { name: 'Level 4' })).toBeTruthy()
    expect(useProgress.getState().held).toBe(true)
  })

  it('switches to the server figures and lets the celebrations through', async () => {
    const after = progressOf(680, { workouts: 2, prs: 1 }, { achievements: [{ code: 'first_pr', unlocked_at: '2026-10-07T20:00:00Z' }] })
    await show({ preview, settled: Promise.resolve({ progress: after, confirmed: true }) })
    expect(screen.getAllByText('+280 XP').length).toBeGreaterThan(0)
    expect(screen.getByText('Personal records ×1')).toBeTruthy()
    expect(screen.getByText('Achievement: First PR')).toBeTruthy()
    expect(useProgress.getState().held).toBe(false)
  })

  it('marks the preview as an estimate when offline', async () => {
    await show({ preview, settled: Promise.resolve({ progress: null, confirmed: false }) })
    expect(screen.getAllByText('+200 XP').length).toBeGreaterThan(0)
    expect(screen.getByText('Estimate. It is confirmed when you are back online.')).toBeTruthy()
  })

  it('explains a session logged into a past week', async () => {
    await show({ preview: null, settled: Promise.resolve({ progress: null, confirmed: false }) })
    expect(screen.getByText('This workout counts toward a past week. Its XP shows up once it syncs.')).toBeTruthy()
  })

  it('waits for the server when there is nothing to preview', async () => {
    await show({ preview: null, settled: never() })
    expect(screen.getByText('Counting your XP…')).toBeTruthy()
  })

  it('says why a session paid nothing', async () => {
    await show({ preview: { lines: [], total: 0 }, settled: never() })
    expect(screen.getByText('No XP this time. You already got the two extra workouts this week.')).toBeTruthy()
  })

  it('stops holding when it closes', async () => {
    await show({ preview, settled: never() })
    cleanup()
    expect(useProgress.getState().held).toBe(false)
  })
})
```

(`levelFor(400 + 200)` = nível 4 com 150/250, por isso a barra se chama "Level 4". O servidor de
`after` soma 200 do treino, 30 do PR e 50 de `first_pr`: 280.)

Criar `src/sheets.finish-xp.test.jsx`:

```jsx
// @vitest-environment happy-dom
// Finishing a workout feeds gamification: the local start hour goes with the event (early_bird),
// and the summary gets the progress from before, a preview and the pending server answer.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { beginWorkout, finishWorkout } from './sheets.jsx'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { useProgress } from './features/gamification/useProgress.ts'
import { progressOf } from './features/gamification/test-progress.ts'
import { emit } from './features/gamification/events.ts'

vi.mock('./features/gamification/events.ts', () => ({ emit: vi.fn(), flush: vi.fn(async () => ({ sent: 0, left: 0 })) }))
vi.mock('./features/gamification/progress-api.ts', () => ({ fetchProgress: vi.fn(async () => { throw new Error('offline') }) }))

const BENCH = '0025'
const clone = v => JSON.parse(JSON.stringify(v))

function train(day) {
  const st = clone(DEF)
  Object.assign(st, {
    routines: [{ id: 'A', name: 'Plan A', emoji: 'dumbbell', ex: [{ id: BENCH, sets: 1, reps: 5, weight: 50, mode: 'reps' }] }],
    week: { 1: ['A'] }, active: null, workouts: [], weighIn: false
  })
  useStore.setState({ S: st, user: null })
  vi.setSystemTime(new Date(day + 'T06:30:00'))
  act(() => beginWorkout(['A'], null))
  vi.setSystemTime(new Date(day + 'T07:10:00'))
  act(() => useStore.getState().update(s => s.active.entries.forEach(e => e.sets.forEach(x => { x.done = true }))))
  act(() => finishWorkout())
}
const summaryProps = () => useUI.getState().sheets.at(-1).render(() => {}).props

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  localStorage.clear()
  useUI.setState({ sheets: [] })
  vi.mocked(emit).mockClear()
  useProgress.getState().reset()
})
afterEach(() => { vi.useRealTimers() })

describe('finishing a workout feeds gamification', () => {
  it('sends the local start hour of a live session', () => {
    train('2026-10-07')
    expect(vi.mocked(emit).mock.calls.find(c => c[0] === 'workout_completed')[1]).toMatchObject({ hour: 6, past: false })
  })

  it('hands the summary the progress from before and a preview', () => {
    const before = progressOf(400)
    useProgress.setState({ userId: 'u1', progress: before, status: 'ready' })
    train('2026-10-07')
    const { xp } = summaryProps()
    expect(xp.before).toBe(before)
    expect(xp.preview.lines[0]).toEqual({ kind: 'workout', amount: 200, index: 2, of: 3 })
    expect(xp.settled).toBeInstanceOf(Promise)
  })

  it('has no XP block without a signed-in progress store', () => {
    train('2026-10-07')
    expect(summaryProps().xp).toBeNull()
  })
})
```

Run: `npx vitest run src/features/gamification/WorkoutXpSummary.test.tsx src/sheets.finish-xp.test.jsx`
Expected: FAIL (`Cannot find module './WorkoutXpSummary'`; no outro, `hour` ausente e `xp` indefinido).

- [ ] **Step 2: `WorkoutXpSummary`**

Criar `src/features/gamification/WorkoutXpSummary.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { useReducedMotion } from 'motion/react'
import { CloudOff, Sparkles } from 'lucide-react'
import { t } from '../../lib/i18n.js'
import { useProgress } from './useProgress'
import { linesFromProgress } from './preview'
import { levelFor } from './xp'
import { useCountUp } from './useCountUp'
import { LevelBar } from './components/LevelBar'
import { ACHIEVEMENT_TEXT } from './achievement-labels'
import { fmtInt } from './format'
import type { AchievementCode } from './achievements'
import type { Progress, SyncResult, XpLine, XpPreview } from './types'

type Props = { before: Progress | null; preview: XpPreview | null; settled: Promise<SyncResult> }

function lineLabel(l: XpLine): string {
  switch (l.kind) {
    case 'workout': return t('Workout {0} of {1}', l.index, l.of)
    case 'extra': return t('Extra workout')
    case 'goal': return t('Weekly goal bonus')
    case 'pr': return t('Personal records ×{0}', l.count)
    case 'weight': return t('Weigh-in')
    case 'achievement': return t('Achievement: {0}', ACHIEVEMENT_TEXT[l.code as AchievementCode]?.title() ?? l.code)
    default: return t('Other gains')
  }
}

// The XP block at the top of the post-workout summary. The preview shows at once; when the queue
// is through and the server answers, its figures replace the preview and the number counts on to
// them. Level-ups and badges (CelebrationHost) wait until the count is done.
export default function WorkoutXpSummary({ before, preview, settled }: Props) {
  const instant = useReducedMotion() ?? false
  const [result, setResult] = useState<SyncResult | null>(null)
  const [counted, setCounted] = useState(false)

  useEffect(() => {
    let live = true
    useProgress.getState().hold(true)
    settled.then(
      r => { if (live) setResult(r) },
      () => { if (live) setResult({ progress: null, confirmed: false }) }
    )
    return () => { live = false; useProgress.getState().hold(false) }
  }, [settled])

  const after = result?.confirmed ? result.progress : null
  const lines = after && before ? linesFromProgress(before, after) : preview?.lines ?? null
  const total = after && before ? after.total_xp - before.total_xp : preview?.total ?? null
  const value = useCountUp(total ?? 0, { instant, onDone: () => { if (total !== null) setCounted(true) } })

  useEffect(() => { if (counted && result) useProgress.getState().hold(false) }, [counted, result])

  const to = after?.level ?? (before && preview ? levelFor(before.total_xp + preview.total) : null)
  const estimate = !after && preview !== null && result !== null

  return (
    <section data-slot="xp-summary" aria-label={t('XP earned')}
      className="mx-auto my-3 w-full max-w-sm rounded-2xl border border-primary/25 bg-primary/[0.06] p-4 text-left font-sans text-foreground">
      {total === null ? (
        result === null ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Sparkles aria-hidden className="size-4 animate-pulse motion-reduce:animate-none" />{t('Counting your XP…')}
          </p>
        ) : !to ? (
          <p className="text-sm leading-snug text-muted-foreground">{t('This workout counts toward a past week. Its XP shows up once it syncs.')}</p>
        ) : null
      ) : total === 0 ? (
        <p className="text-sm leading-snug text-muted-foreground">{t('No XP this time. You already got the two extra workouts this week.')}</p>
      ) : (
        <>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-medium text-muted-foreground">{t('XP earned')}</span>
            <span aria-hidden className="font-mono text-3xl font-bold tabular-nums text-primary">{t('+{0} XP', fmtInt(value))}</span>
            <span className="sr-only" aria-live="polite">{t('+{0} XP', fmtInt(total))}</span>
          </div>
          {lines && lines.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1.5 text-sm">
              {lines.map((l, i) => (
                <li key={i} className="flex items-baseline justify-between gap-3">
                  <span>{lineLabel(l)}</span>
                  <span className="font-mono tabular-nums text-muted-foreground">{t('+{0} XP', fmtInt(l.amount))}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {to && (
        <div className="mt-4">
          <div className="mb-1.5 flex items-baseline justify-between text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{t('Level {0}', to.level)}</span>
            <span className="font-mono tabular-nums">{fmtInt(to.into)} / {fmtInt(to.need)}</span>
          </div>
          <LevelBar from={before?.level ?? null} to={to} instant={instant} label={t('Level {0}', to.level)} />
        </div>
      )}
      {estimate && (
        <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <CloudOff aria-hidden className="size-3.5" />{t('Estimate. It is confirmed when you are back online.')}
        </p>
      )}
    </section>
  )
}
```

- [ ] **Step 3: `sheets.jsx`**

Imports (junto do `import { emit } ...` existente):

```jsx
import { useProgress } from './features/gamification/useProgress.ts'
import { previewWorkout } from './features/gamification/preview.ts'
import { syncProgress, weighInXp } from './features/gamification/after-event.ts'
import WorkoutXpSummary from './features/gamification/WorkoutXpSummary.tsx'
```

Em `FinishSummary`, trocar a assinatura e acrescentar o bloco depois do `<h3>`:

```jsx
function FinishSummary({ w, prs, e1prs = [], xp = null, close }) {
  const st = useStore(s => s.S)
  return <div style={{ textAlign: 'center', padding: '8px 0' }}>
    <div style={{ fontSize: 44, display: 'flex', justifyContent: 'center', color: 'var(--acc)' }}><Icon name="trophy" /></div>
    <h3 style={{ margin: '8px 0' }}>{t('Workout complete!')}</h3>
    {xp && <WorkoutXpSummary before={xp.before} preview={xp.preview} settled={xp.settled} />}
```

(o resto de `FinishSummary` fica igual).

Em `doFinishWorkout`, substituir o bloco dos eventos:

```jsx
  const ref = String(A.backfill?.replaceId ?? shown.id ?? '')
  const day = String(shown.d || '')
  if (ref && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
    emit('workout_completed', { sets: shown.entries.reduce((n, e) => n + (e.sets?.length || 0), 0), vol: shown.vol || 0, past }, ref, day)
    ;[...new Set(prs)].forEach(exId => emit('pr', { ex: exId }, `${ref}:${exId}`, day))
  }
```

por:

```jsx
  const ref = String(A.backfill?.replaceId ?? shown.id ?? '')
  const day = String(shown.d || '')
  let xp = null
  if (ref && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
    const unique = [...new Set(prs)]
    // The preview reads the progress from before these events; the summary swaps it for the
    // server's figures once the queue is through (features/gamification/WorkoutXpSummary.tsx).
    const before = useProgress.getState().progress
    const preview = previewWorkout(before, { occurredOn: day, prs: unique.length })
    // The local start hour feeds early_bird; a session logged into the past has no real one.
    const hour = !past && Number.isFinite(A.start) ? new Date(A.start).getHours() : null
    emit('workout_completed', { sets: shown.entries.reduce((n, e) => n + (e.sets?.length || 0), 0), vol: shown.vol || 0, past, ...(hour === null ? {} : { hour }) }, ref, day)
    unique.forEach(exId => emit('pr', { ex: exId }, `${ref}:${exId}`, day))
    // Only a signed-in account has server progress (App.jsx loads it).
    if (useProgress.getState().userId) xp = { before, preview, settled: syncProgress() }
  }
```

e a linha que abre o resumo:

```jsx
  ui().openSheet(close => <FinishSummary w={shown} prs={prs} e1prs={e1prs} xp={xp} close={close} />, { kind: 'center', locked: true })
```

Em `BwSheet`, substituir:

```jsx
    // One event per day: the date is the reference, so weighing in twice gives XP once.
    emit('weight_logged', { w: n }, iso, iso)
    close()
    if (onDone) onDone(n); else toast(t('Weight saved'))
```

por:

```jsx
    // One event per day: the date is the reference, so weighing in twice gives XP once.
    const xp = weighInXp(iso)
    emit('weight_logged', { w: n }, iso, iso)
    void syncProgress()
    close()
    if (onDone) onDone(n); else toast(xp ? t('Weight saved. +{0} XP', xp) : t('Weight saved'))
```

- [ ] **Step 4: Mocks dos testes legados**

Em `src/sheets.missed-day.test.jsx` e `src/sheets.plan-session.test.jsx`, trocar

```jsx
vi.mock('./features/gamification/events.ts', () => ({ emit: vi.fn() }))
```

por

```jsx
vi.mock('./features/gamification/events.ts', () => ({ emit: vi.fn(), flush: vi.fn(async () => ({ sent: 0, left: 0 })) }))
```

(O Vitest lança erro ao acessar um export ausente de um mock; `syncProgress` lê `flush`.)

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run src/features/gamification/WorkoutXpSummary.test.tsx src/sheets.finish-xp.test.jsx src/sheets.missed-day.test.jsx src/sheets.plan-session.test.jsx src/lib/finish-workout.test.js`
Expected: PASS.

- [ ] **Step 6: Verificar e commitar**

```bash
node scripts/check-source-strings.mjs --strict
npm run typecheck && npm test && npm run build
git add src/features/gamification/WorkoutXpSummary.tsx src/features/gamification/WorkoutXpSummary.test.tsx src/sheets.jsx src/sheets.finish-xp.test.jsx src/sheets.missed-day.test.jsx src/sheets.plan-session.test.jsx
git commit -m "feat(gamification): XP count-up and level bar in the post-workout summary

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Home redesenhada

**Files:**
- Create: `src/lib/use-online.ts`
- Modify: `src/features/sync/SyncIndicator.tsx` (usa `useOnline` de `lib/use-online.ts`)
- Create: `src/features/home/HomeScreen.tsx`, `ProgressHero.tsx`, `TodayCard.tsx`, `BodyWeightCard.tsx`, `HomeCards.tsx`
- Modify: `src/views/Home.jsx` (vira reexport)
- Modify: `src/views/Home.startdoor.test.jsx` (seletores por `data-testid`)
- Test: `src/features/home/ProgressHero.test.tsx`, `TodayCard.test.tsx`, `HomeScreen.test.tsx`; continuam valendo `src/views/Home.avatar.test.jsx`, `Home.weight-card.test.jsx`, `starter-entry.test.jsx`

**Interfaces:**
- Consumes: `useProgress`, `displayStreak`, `ACHIEVEMENTS`, `LevelBar`, `StreakBadge`, `fmtInt`, `progressOf` (testes); funções legadas de `src/lib/history.js` (`effectiveRoutines`, `effectiveRoutineIds`, `nextTrainingDay`, `lastBW`), `src/lib/format.js` (`todayISO`, `isoOf`, `weekStartOf`, `weekDayOffset`, `DAYS`, `DAYN`, `fmtNum`, `fmtDate`), `src/sheets.jsx` (`dayOverrideSheet`, `calendarSheet`, `startFlow`, `starterPlanSheet`, `bwSheet`, `goalSheet`, `weighInsSheet`, `bwDeltaColor`).
- Produces: `useOnline(): boolean`; `HomeScreen` (default); `ProgressHero`, `TodayCard`, `BodyWeightCard`, `WelcomeCard`, `CheckInCard` (named). `data-testid`s: `today-row`, `today-title`, `today-tag`, `week-label`, `avatar-button`, `checkin-card`; `data-slot="progress-hero"`.

- [ ] **Step 1: Testes que falham**

Criar `src/features/home/ProgressHero.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

const h = vi.hoisted(() => ({ nav: vi.fn() }))
vi.mock('react-router-dom', () => ({ useNavigate: () => h.nav }))

import { ProgressHero } from './ProgressHero'
import { useProgress } from '../gamification/useProgress'
import { progressOf } from '../gamification/test-progress'

const realRefresh = useProgress.getState().refresh
const ready = (p = progressOf(400, { xp: 400, workouts: 2 }, { streak: { current: 3, best: 5, shields: 1 } }), over = {}) =>
  useProgress.setState({ status: 'ready', progress: p, userId: 'u1', ...over })

beforeEach(() => { localStorage.clear(); useProgress.getState().reset(); h.nav.mockClear() })
afterEach(() => { cleanup(); useProgress.setState({ refresh: realRefresh }) })

describe('ProgressHero', () => {
  it('shows a skeleton until the first answer', () => {
    useProgress.setState({ status: 'loading' })
    const { container } = render(<ProgressHero />)
    expect(container.querySelector('[data-slot="progress-hero"][aria-busy="true"]')).toBeTruthy()
  })

  it('offers a retry when the first load failed', () => {
    const refresh = vi.fn(async () => null)
    useProgress.setState({ status: 'error', refresh })
    render(<ProgressHero />)
    expect(screen.getByText('Could not load your progress.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('shows the level, what is left to the next one, the streak and the week', () => {
    ready()
    render(<ProgressHero />)
    expect(screen.getByRole('heading', { name: 'Level 3' })).toBeTruthy()
    expect(screen.getByText('50 XP to level 4')).toBeTruthy()
    expect(screen.getByText('400 of 960 XP')).toBeTruthy()
    expect(screen.getByText('2 of 3 workouts')).toBeTruthy()
    expect(screen.getByRole('button', { name: '3 week streak. Shields: 1 of 2' })).toBeTruthy()
  })

  it('counts the running week in the streak once its goal is met', () => {
    ready(progressOf(950, { xp: 750, workouts: 3, target_hit: true }, { streak: { current: 3, best: 5, shields: 1 } }))
    render(<ProgressHero />)
    expect(screen.getByText('Weekly goal met')).toBeTruthy()
    expect(screen.getByRole('button', { name: '4 week streak. Shields: 1 of 2' })).toBeTruthy()
  })

  it('explains shields on demand', () => {
    ready()
    render(<ProgressHero />)
    fireEvent.click(screen.getByRole('button', { name: /week streak/ }))
    expect(screen.getByText('Streak shields')).toBeTruthy()
    expect(screen.getByText('Best: 5')).toBeTruthy()
  })

  it('invites the first workout when there is no XP yet', () => {
    ready(progressOf(0, { workouts: 0 }))
    render(<ProgressHero />)
    expect(screen.getByText('Finish a workout to earn your first XP.')).toBeTruthy()
  })

  it('opens the achievements', () => {
    ready()
    render(<ProgressHero />)
    expect(screen.getByText('0 of 22 unlocked')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Achievements/ }))
    expect(h.nav).toHaveBeenCalledWith('/conquistas')
  })

  it('says so when it shows the saved copy offline', () => {
    // An own property shadows the prototype getter; deleting it brings the real one back.
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
    try {
      ready(undefined, { stale: true })
      render(<ProgressHero />)
      expect(screen.getByText('Offline. Showing your last saved progress.')).toBeTruthy()
    } finally {
      delete (navigator as unknown as Record<string, unknown>).onLine
    }
  })
})
```

Criar `src/features/home/TodayCard.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

const h = vi.hoisted(() => ({ nav: vi.fn(), dayOverrideSheet: vi.fn(), calendarSheet: vi.fn(), startFlow: vi.fn() }))
vi.mock('react-router-dom', () => ({ useNavigate: () => h.nav }))
vi.mock('../../sheets.jsx', () => ({ dayOverrideSheet: h.dayOverrideSheet, calendarSheet: h.calendarSheet, startFlow: h.startFlow }))

import { useStore } from '../../store/useStore.js'
import { todayISO } from '../../lib/format.js'
import { TodayCard } from './TodayCard'

const routines = [{ id: 'r1', name: 'Push', emoji: null, ex: [{ id: '0025' }] }]
const everyDay = { 0: ['r1'], 1: ['r1'], 2: ['r1'], 3: ['r1'], 4: ['r1'], 5: ['r1'], 6: ['r1'] }
const setS = (over: Record<string, unknown> = {}) =>
  useStore.setState((s: any) => ({ S: { ...s.S, routines, dayPlan: {}, workouts: [], active: null, week: {}, ...over } }))

beforeEach(() => Object.values(h).forEach(f => f.mockClear()))
afterEach(cleanup)

describe('TodayCard', () => {
  it("starts today's plan from the today row", () => {
    setS({ week: everyDay })
    render(<TodayCard />)
    expect(screen.getByTestId('today-title').textContent).toBe('Push')
    expect(screen.getByTestId('today-tag').textContent).toBe('Start')
    fireEvent.click(screen.getByTestId('today-row'))
    expect(h.startFlow).toHaveBeenCalledWith(['r1'])
  })

  it('offers to plan a rest day', () => {
    setS()
    render(<TodayCard />)
    expect(screen.getByTestId('today-title').textContent).toBe('Rest day')
    fireEvent.click(screen.getByTestId('today-row'))
    expect(h.dayOverrideSheet).toHaveBeenCalledWith(todayISO())
  })

  it('reports a finished day as done', () => {
    setS({ week: everyDay, workouts: [{ id: 'w', d: todayISO(), name: 'Push', entries: [] }] })
    render(<TodayCard />)
    expect(screen.getByTestId('today-title').textContent).toBe('Push — done')
    expect(screen.getByTestId('today-tag').textContent).toBe('Done')
  })

  it('moves between weeks and opens a day', () => {
    setS()
    render(<TodayCard />)
    expect(screen.getByTestId('week-label').textContent).toBe('This week')
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
    expect(screen.getByTestId('week-label').textContent).not.toBe('This week')
    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }))
    const today = screen.getAllByRole('button').find(b => b.getAttribute('aria-current') === 'date')!
    fireEvent.click(today)
    expect(h.dayOverrideSheet).toHaveBeenCalledWith(todayISO())
  })

  it('opens the calendar and counts every workout', () => {
    setS({ workouts: [{ id: 'a', d: '2026-01-01', entries: [] }, { id: 'b', d: '2026-01-02', entries: [] }] })
    render(<TodayCard />)
    fireEvent.click(screen.getByRole('button', { name: 'Calendar' }))
    expect(h.calendarSheet).toHaveBeenCalledTimes(1)
    expect(screen.getByText('2 workouts total')).toBeTruthy()
  })
})
```

Criar `src/features/home/HomeScreen.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

const h = vi.hoisted(() => ({ nav: vi.fn(), bwSheet: vi.fn(), weighInsSheet: vi.fn(), goalSheet: vi.fn() }))
vi.mock('react-router-dom', () => ({ useNavigate: () => h.nav }))
vi.mock('../../sheets.jsx', () => ({
  bwSheet: h.bwSheet, weighInsSheet: h.weighInsSheet, goalSheet: h.goalSheet, bwDeltaColor: () => '',
  dayOverrideSheet: vi.fn(), calendarSheet: vi.fn(), startFlow: vi.fn(), starterPlanSheet: vi.fn()
}))
vi.mock('../../components/LineChart.jsx', () => ({ default: () => null }))

import { useStore } from '../../store/useStore.js'
import HomeScreen from './HomeScreen'

const setS = (over: Record<string, unknown> = {}, user: unknown = null) =>
  useStore.setState((s: any) => ({ S: { ...s.S, routines: [], dayPlan: {}, workouts: [], bodyweight: [], active: null, week: {}, ...over }, user }))

beforeEach(() => Object.values(h).forEach(f => f.mockClear()))
afterEach(() => { cleanup(); useStore.setState({ user: null }) })

describe('HomeScreen', () => {
  it('shows the progress card only to a signed-in account', () => {
    setS()
    const { container, unmount } = render(<HomeScreen />)
    expect(container.querySelector('[data-slot="progress-hero"]')).toBeNull()
    unmount()
    setS({}, { id: 'u1', name: 'Ana' })
    const again = render(<HomeScreen />)
    expect(again.container.querySelector('[data-slot="progress-hero"]')).toBeTruthy()
  })

  it('opens the gym check-in and hides it when switched off', () => {
    setS({ checkIn: true })
    render(<HomeScreen />)
    fireEvent.click(screen.getByTestId('checkin-card'))
    expect(h.nav).toHaveBeenCalledWith('/checkin')
    cleanup()
    setS({ checkIn: false })
    render(<HomeScreen />)
    expect(screen.queryByTestId('checkin-card')).toBeNull()
  })

  it('logs a weigh-in, sets a goal and lists every weigh-in', () => {
    setS({ bodyweight: [{ d: '2026-10-01', w: 80, t: 1 }, { d: '2026-10-03', w: 79.5, t: 2 }], unit: 'kg' })
    render(<HomeScreen />)
    expect(screen.getByRole('heading', { name: 'Body weight' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Log' }))
    fireEvent.click(screen.getByRole('button', { name: 'Goal' }))
    fireEvent.click(screen.getByRole('button', { name: 'All weigh-ins' }))
    expect(h.bwSheet).toHaveBeenCalledTimes(1)
    expect(h.goalSheet).toHaveBeenCalledTimes(1)
    expect(h.weighInsSheet).toHaveBeenCalledTimes(1)
  })
})
```

Atualizar `src/views/Home.startdoor.test.jsx`: trocar `host.querySelector('.today-row')` por
`host.querySelector('[data-testid="today-row"]')`, `row.querySelector('.ttl')` por
`row.querySelector('[data-testid="today-title"]')` e `row.querySelector('.tag')` por
`row.querySelector('[data-testid="today-tag"]')` (dois testes: "reads an open editor…" e "still
reads a running session…"). As asserções de texto ficam iguais.

Run: `npx vitest run src/features/home src/views/Home.startdoor.test.jsx`
Expected: FAIL (módulos `./ProgressHero`, `./TodayCard`, `./HomeScreen` inexistentes; `today-row` não encontrado).

- [ ] **Step 2: `useOnline`**

Criar `src/lib/use-online.ts`:

```ts
import { useEffect, useState } from 'react'

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false

export function useOnline(): boolean {
  const [online, setOnline] = useState(isOnline)
  useEffect(() => {
    const on = () => setOnline(isOnline())
    window.addEventListener('online', on)
    window.addEventListener('offline', on)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', on) }
  }, [])
  return online
}
```

Em `src/features/sync/SyncIndicator.tsx`, apagar as funções locais `isOnline` e `useOnline` e
importar `import { useOnline } from '@/lib/use-online'`. `src/features/sync/SyncIndicator.test.tsx`
continua verde sem mudança.

- [ ] **Step 3: `ProgressHero`**

Criar `src/features/home/ProgressHero.tsx`:

```tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, CloudOff, RefreshCw, Trophy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useOnline } from '@/lib/use-online'
import { t } from '../../lib/i18n.js'
import { useProgress } from '../gamification/useProgress'
import { displayStreak } from '../gamification/preview'
import { ACHIEVEMENTS } from '../gamification/achievements'
import { LevelBar } from '../gamification/components/LevelBar'
import { StreakBadge } from '../gamification/components/StreakBadge'
import { fmtInt } from '../gamification/format'

const CARD = 'relative overflow-hidden rounded-3xl border border-border bg-card p-5 text-card-foreground'

// Where you stand: level and what is left to the next, the weekly streak with its shields, this
// week's XP against the most any week can pay, and the sessions toward the goal. Designed states:
// loading (skeleton in the card's shape), first load failed (retry), no XP yet (first step),
// offline with a saved copy (a quiet line, nothing blocks).
export function ProgressHero() {
  const navigate = useNavigate()
  const progress = useProgress(s => s.progress)
  const status = useProgress(s => s.status)
  const stale = useProgress(s => s.stale)
  const online = useOnline()
  const [shieldsOpen, setShieldsOpen] = useState(false)

  if (!progress) {
    if (status === 'error') {
      return (
        <section data-slot="progress-hero" className={CARD}>
          <p className="text-[15px] font-medium">{t('Could not load your progress.')}</p>
          <Button variant="outline" className="mt-3 h-11 gap-2 rounded-xl" onClick={() => void useProgress.getState().refresh()}>
            <RefreshCw aria-hidden className="size-4" />{t('Try again')}
          </Button>
        </section>
      )
    }
    return (
      <section data-slot="progress-hero" aria-busy="true" className={CARD}>
        <div className="flex items-center gap-3">
          <Skeleton className="size-14 rounded-2xl" />
          <div className="flex flex-1 flex-col gap-2"><Skeleton className="h-5 w-24" /><Skeleton className="h-4 w-36" /></div>
          <Skeleton className="h-11 w-24 rounded-full" />
        </div>
        <Skeleton className="mt-5 h-2.5 w-full rounded-full" />
        <Skeleton className="mt-6 h-4 w-full" />
        <Skeleton className="mt-4 h-12 w-full rounded-2xl" />
      </section>
    )
  }

  const lv = progress.level
  const week = progress.week
  const weekPct = Math.min(100, (week.xp / week.max) * 100)

  return (
    <section data-slot="progress-hero" aria-labelledby="hero-level"
      className={cn(CARD, 'animate-in fade-in-0 duration-200 motion-reduce:animate-none')}>
      <div aria-hidden className="pointer-events-none absolute -right-20 -top-24 size-60 rounded-full bg-primary/10 blur-3xl" />

      <div className="relative flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden className="grid size-14 shrink-0 place-items-center rounded-2xl bg-primary font-mono text-2xl font-bold tabular-nums text-primary-foreground">
            {lv.level}
          </span>
          <div className="min-w-0">
            <h2 id="hero-level" className="text-lg font-semibold leading-tight">{t('Level {0}', lv.level)}</h2>
            <p className="text-sm tabular-nums text-muted-foreground">{t('{0} XP to level {1}', fmtInt(lv.need - lv.into), lv.level + 1)}</p>
          </div>
        </div>
        <StreakBadge current={displayStreak(progress)} shields={progress.streak.shields}
          expanded={shieldsOpen} onToggle={() => setShieldsOpen(o => !o)} controls="streak-help" />
      </div>

      {shieldsOpen && (
        <div id="streak-help" className="relative mt-3 rounded-2xl bg-secondary/70 p-3 text-sm leading-snug animate-in fade-in-0 duration-200 motion-reduce:animate-none">
          <p className="font-medium">{t('Streak shields')}</p>
          <p className="mt-1 text-muted-foreground">{t('A shield keeps your streak going when you miss a week. You get one every 4 weeks in a row, and can hold 2.')}</p>
          <p className="mt-2 tabular-nums text-muted-foreground">{t('Best: {0}', progress.streak.best)}</p>
        </div>
      )}

      <LevelBar className="relative mt-4" to={lv} instant label={t('Level {0}', lv.level)} />
      {progress.total_xp === 0 && <p className="relative mt-3 text-sm text-muted-foreground">{t('Finish a workout to earn your first XP.')}</p>}

      <div className="relative mt-5 flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm font-medium">{t('This week')}</span>
          <span className="font-mono text-sm tabular-nums text-muted-foreground">{t('{0} of {1} XP', fmtInt(week.xp), fmtInt(week.max))}</span>
        </div>
        <div aria-hidden className="h-1.5 overflow-hidden rounded-full bg-primary/15">
          <div className="h-full rounded-full bg-primary transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none" style={{ width: `${weekPct}%` }} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <SessionDots target={week.target} done={week.workouts} extras={week.extras} />
          <span className={cn('text-sm', week.target_hit ? 'font-medium text-primary' : 'text-muted-foreground')}>
            {week.target_hit ? t('Weekly goal met') : t('{0} of {1} workouts', week.workouts, week.target)}
          </span>
        </div>
      </div>

      <button type="button" onClick={() => navigate('/conquistas')}
        className="relative mt-4 flex min-h-12 w-full items-center justify-between gap-3 rounded-2xl bg-secondary/60 px-3.5 text-left outline-none transition-colors duration-150 hover:bg-secondary focus-visible:ring-[3px] focus-visible:ring-ring/50">
        <span className="flex items-center gap-2 text-[15px] font-medium"><Trophy aria-hidden className="size-4 text-primary" />{t('Achievements')}</span>
        <span className="flex items-center gap-1 text-sm text-muted-foreground">
          {t('{0} of {1} unlocked', progress.achievements.length, ACHIEVEMENTS.length)}<ChevronRight aria-hidden className="size-4" />
        </span>
      </button>

      {stale && !online && (
        <p className="relative mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <CloudOff aria-hidden className="size-3.5" />{t('Offline. Showing your last saved progress.')}
        </p>
      )}
    </section>
  )
}

// One pill per planned session of the week (filled once done), then a dot per extra session.
function SessionDots({ target, done, extras }: { target: number; done: number; extras: number }) {
  return (
    <span aria-hidden className="flex items-center gap-1">
      {Array.from({ length: target }, (_, i) => <span key={i} className={cn('h-2 w-5 rounded-full', i < done ? 'bg-primary' : 'bg-primary/15')} />)}
      {Array.from({ length: extras }, (_, i) => <span key={'x' + i} className="size-2 rounded-full bg-[var(--pillar-strength)]" />)}
    </span>
  )
}
```

- [ ] **Step 4: `TodayCard`**

Criar `src/features/home/TodayCard.tsx`:

```tsx
import { useState, type CSSProperties, type ReactElement } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarDays, ChevronLeft, ChevronRight, Plus, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useStore } from '../../store/useStore.js'
import { effectiveRoutines, effectiveRoutineIds, nextTrainingDay } from '../../lib/history.js'
import { todayISO, isoOf, weekStartOf, weekDayOffset, DAYS, DAYN } from '../../lib/format.js'
import { t, dateLocale } from '../../lib/i18n.js'
import { dayOverrideSheet, calendarSheet, startFlow } from '../../sheets.jsx'
import { glyphOf } from '../../lib/glyphs.js'
import LegacyIcon from '../../components/Icon.jsx'

type HomeStore = { S: Record<string, any> }
// The routine's own glyph (chosen in the plan editor) comes from the legacy icon set.
const Icon = LegacyIcon as unknown as (p: { name: string; className?: string; style?: CSSProperties }) => ReactElement

const DOT: Record<string, string> = { done: 'bg-primary', ovr: 'bg-[var(--orange)]', plan: 'bg-muted-foreground/50', none: 'bg-transparent' }
const TAG = {
  orange: 'bg-[color-mix(in_oklab,var(--orange)_16%,transparent)] text-[var(--orange)]',
  green: 'bg-[color-mix(in_oklab,var(--green)_16%,transparent)] text-[var(--green)]',
  primary: 'bg-primary text-primary-foreground'
}

// What to do now: the week (today ringed, each day's state as a dot, a tap to reschedule), the
// today row (resume, edit, done, start the plan, or plan a rest day) and the way to the Start
// screen when a plan already owns today. Same behaviour as the legacy Home, which the tests pin.
export function TodayCard() {
  const nav = useNavigate()
  const S = useStore((s: HomeStore) => s.S)
  const [weekOffset, setWeekOffset] = useState(0)

  const today = todayISO()
  // A weekday can hold several routines: the session name joins them, the glyph is the first's.
  const todayRoutines = effectiveRoutines(S, today)
  const routine = todayRoutines[0] || null
  const todayName = todayRoutines.map((r: any) => r.name).join(' + ')
  const todayOvr = S.dayPlan[today] !== undefined
  // An open editor on a saved workout holds S.active too, but it is an edit, not a session.
  const editingSaved = !!S.active?.editingWorkoutId
  const next = !S.active && !todayRoutines.length ? nextTrainingDay(S, today) : null
  // The last session logged today, if any: the row reports it instead of asking for it again.
  const doneToday = S.workouts.filter((w: any) => w.d === today).at(-1) || null

  const now = new Date()
  const wkStart = new Date(now)
  wkStart.setDate(now.getDate() - weekDayOffset(now.getDay(), weekStartOf(S)) + weekOffset * 7)
  const wkEnd = new Date(wkStart)
  wkEnd.setDate(wkStart.getDate() + 6)
  const month = (d: Date) => d.toLocaleDateString(dateLocale(), { month: 'short' })
  const wkLabel = weekOffset === 0 ? t('This week') : `${wkStart.getDate()} ${month(wkStart)} – ${wkEnd.getDate()} ${month(wkEnd)}`
  const doneDays = new Set(S.workouts.map((w: any) => w.d))
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(wkStart)
    d.setDate(wkStart.getDate() + i)
    const iso = isoOf(d)
    const planned = effectiveRoutineIds(S, iso).length > 0
    const moved = S.dayPlan[iso] !== undefined
    return { d, iso, state: doneDays.has(iso) ? 'done' : moved && planned ? 'ovr' : planned ? 'plan' : 'none' }
  })

  const onToday = () => {
    if (S.active) nav('/workout')
    else if (todayRoutines.length) startFlow(effectiveRoutineIds(S, today))
    else dayOverrideSheet(today)
  }
  const title = S.active ? (editingSaved ? S.active.name : t('{0} — in progress', S.active.name))
    : doneToday ? (doneToday.name ? t('{0} — done', doneToday.name) : t('Workout done'))
    : routine ? todayName : t('Rest day')
  const suffix = todayOvr && routine && !doneToday ? ' · ' + t('rescheduled') : ''
  const tag = S.active ? { text: editingSaved ? t('Edit') : t('Resume'), tone: 'orange' as const }
    : doneToday ? { text: t('Done'), tone: 'green' as const }
    : routine ? { text: t('Start'), tone: 'primary' as const } : null
  const glyph = S.active ? (editingSaved ? 'pencil' : 'timer') : doneToday ? 'checkCircle' : routine ? glyphOf(routine.emoji) : 'moon'
  const tile = S.active ? 'bg-[var(--orange)] text-white' : doneToday ? 'bg-secondary text-[var(--green)]'
    : routine ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'
  const total = S.workouts.length

  return (
    <section data-slot="card" aria-label={t('Today')} className="rounded-3xl border border-border bg-card p-4 text-card-foreground">
      <div className="grid grid-cols-[auto_1fr_auto] items-center">
        <Button variant="ghost" size="icon" className="size-11 rounded-full" aria-label={t('Previous week')} onClick={() => setWeekOffset(w => w - 1)}>
          <ChevronLeft className="size-5" />
        </Button>
        <span data-testid="week-label" className="text-center text-sm font-medium text-muted-foreground">{wkLabel}</span>
        <div className="flex items-center">
          <Button variant="ghost" size="icon" className="size-11 rounded-full" aria-label={t('Next week')} onClick={() => setWeekOffset(w => w + 1)}>
            <ChevronRight className="size-5" />
          </Button>
          <Button variant="ghost" size="icon" className="size-11 rounded-full" aria-label={t('Calendar')} onClick={() => calendarSheet()}>
            <CalendarDays className="size-5" />
          </Button>
        </div>
      </div>

      <ol className="mt-1 grid grid-cols-7 gap-1">
        {days.map(day => (
          <li key={day.iso}>
            <button type="button" onClick={() => dayOverrideSheet(day.iso)}
              aria-label={`${t(DAYN[day.d.getDay()])} ${day.d.getDate()}`} aria-current={day.iso === today ? 'date' : undefined}
              className={cn('flex h-16 w-full flex-col items-center justify-center gap-1 rounded-2xl outline-none transition-colors duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/50',
                day.iso === today ? 'bg-secondary ring-1 ring-primary/60' : 'hover:bg-secondary/60')}>
              <span className="text-[11px] font-medium uppercase text-muted-foreground">{t(DAYS[day.d.getDay()])}</span>
              <span className="font-mono text-[15px] font-semibold tabular-nums">{day.d.getDate()}</span>
              <span aria-hidden className={cn('size-1.5 rounded-full', DOT[day.state])} />
            </button>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-right text-xs text-muted-foreground">{t(total === 1 ? '{0} workout total' : '{0} workouts total', total)}</p>

      <button type="button" data-testid="today-row" onClick={onToday}
        className="mt-2 flex min-h-16 w-full items-center gap-3 rounded-2xl bg-secondary/60 px-3 py-2.5 text-left outline-none transition-[background-color,transform] duration-150 hover:bg-secondary focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.99] motion-reduce:transition-none motion-reduce:active:scale-100">
        <span aria-hidden className={cn('grid size-10 shrink-0 place-items-center rounded-xl text-lg', tile)}><Icon name={glyph} /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs text-muted-foreground">{t('Today')}</span>
          <span data-testid="today-title" className="block truncate text-[15px] font-semibold">{title}{suffix}</span>
          {next && !doneToday && (
            <span className="block truncate text-xs text-muted-foreground">{t('Next session: {0}, {1}', t(DAYN[next.weekday]), next.routine.name)}</span>
          )}
        </span>
        {tag
          ? <span data-testid="today-tag" className={cn('shrink-0 rounded-full px-3 py-1 text-sm font-semibold', TAG[tag.tone])}>{tag.text}</span>
          : <Plus aria-hidden className="size-5 shrink-0 text-muted-foreground" />}
      </button>

      {/* The today row and the tab bar's Start both go straight into a planned session; this is
          the door to a freestyle session or another routine, and it starts nothing on its own. */}
      {!S.active && (
        <div className="mt-1 flex justify-center">
          <Button variant="ghost" className="h-11 gap-2 rounded-xl text-muted-foreground" onClick={() => nav('/workout')}>
            <RotateCcw aria-hidden className="size-4" />{t('Choose a different workout')}
          </Button>
        </div>
      )}
    </section>
  )
}
```

(O intervalo de datas `1 out – 7 out` usa o traço como sinal de intervalo, não como pausa, igual à Home legada.)

- [ ] **Step 5: `BodyWeightCard`, `HomeCards`, `HomeScreen` e `Home.jsx`**

Criar `src/features/home/BodyWeightCard.tsx`:

```tsx
import type { ReactElement } from 'react'
import { ArrowDown, ArrowUp, ChevronRight, Plus, Target } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useStore } from '../../store/useStore.js'
import { lastBW } from '../../lib/history.js'
import { fmtNum, fmtDate } from '../../lib/format.js'
import { t } from '../../lib/i18n.js'
import { bwSheet, goalSheet, weighInsSheet, bwDeltaColor } from '../../sheets.jsx'
import LegacyLineChart from '../../components/LineChart.jsx'

type HomeStore = { S: Record<string, any> }
type Point = { t: number; y: number; d: string }
const LineChart = LegacyLineChart as unknown as (p: { points: Point[]; h: number; unit: string; goal?: number }) => ReactElement

// Body weight at a glance: latest weigh-in, the change since the one before, the goal, the curve.
export function BodyWeightCard() {
  const S = useStore((s: HomeStore) => s.S)
  const bw = lastBW(S)
  const prev = S.bodyweight.length > 1 ? S.bodyweight[S.bodyweight.length - 2] : null
  const delta = bw && prev ? bw.w - prev.w : null
  const points: Point[] = S.bodyweight.slice(-30).map((b: any) => ({ t: b.t || new Date(b.d).getTime(), y: b.w, d: b.d }))
  const goal = S.targetW

  return (
    <section data-slot="card" aria-labelledby="bw-title" className="rounded-3xl border border-border bg-card p-4 text-card-foreground">
      <div className="flex items-center justify-between gap-2">
        <h2 id="bw-title" className="text-[17px] font-semibold">{t('Body weight')}</h2>
        <div className="flex gap-2">
          <Button variant="secondary" className="h-11 gap-1.5 rounded-xl px-3" style={goal ? { color: 'var(--yellow)' } : undefined} onClick={() => goalSheet()}>
            <Target aria-hidden className="size-4" />{goal ? fmtNum(goal) : t('Goal')}
          </Button>
          <Button variant="secondary" className="h-11 gap-1.5 rounded-xl px-3" onClick={() => bwSheet()}>
            <Plus aria-hidden className="size-4" />{t('Log')}
          </Button>
        </div>
      </div>
      {bw ? (
        <>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-3xl font-semibold tabular-nums">{fmtNum(bw.w)}</span>
            <span className="text-muted-foreground">{S.unit}</span>
            {/* only when it actually moved: an unchanged weight used to read as "− 0" */}
            {!!delta && (
              <span className="flex items-center gap-0.5 text-sm font-medium" style={{ color: bwDeltaColor(delta, bw.w) }}>
                {delta > 0 ? <ArrowUp aria-hidden className="size-3.5" /> : <ArrowDown aria-hidden className="size-3.5" />}{fmtNum(Math.abs(delta))}
              </span>
            )}
            <span className="ml-auto text-sm text-muted-foreground">{fmtDate(bw.d, true)}</span>
          </div>
          {goal && (
            <p className="mt-1 flex items-center gap-1.5 text-sm" style={{ color: 'var(--yellow)' }}>
              <Target aria-hidden className="size-3.5" />
              {t('Goal')} {fmtNum(goal)} {S.unit} · {Math.abs(goal - bw.w) < 0.05 ? t('reached!') : t(goal > bw.w ? '{0} to gain' : '{0} to lose', fmtNum(Math.abs(goal - bw.w)) + ' ' + S.unit)}
            </p>
          )}
          <div className="chart mt-2"><LineChart points={points} h={130} unit={S.unit} goal={goal} /></div>
          <div className="flex justify-end">
            <Button variant="ghost" className="h-11 gap-1 rounded-xl" onClick={() => weighInsSheet()}>
              {t('All weigh-ins')}<ChevronRight aria-hidden className="size-4" />
            </Button>
          </div>
        </>
      ) : (
        <p className="mt-2 text-sm leading-snug text-muted-foreground">
          {S.weighIn === false
            ? t('No entries yet — log your weight to start the curve.')
            : t("No entries yet — log your weight to start the curve. It's also asked before every workout.")}
        </p>
      )}
    </section>
  )
}
```

Criar `src/features/home/HomeCards.tsx`:

```tsx
import { useNavigate } from 'react-router-dom'
import { ChevronRight, QrCode, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { t } from '../../lib/i18n.js'
import { starterPlanSheet } from '../../sheets.jsx'

// No routines yet: a ready-made plan in one tap, or the plan editor.
export function WelcomeCard() {
  const nav = useNavigate()
  return (
    <section data-slot="card" aria-labelledby="welcome-title" className="rounded-3xl border border-border bg-card p-5 text-card-foreground">
      <div className="flex items-center gap-3">
        <span aria-hidden className="grid size-10 place-items-center rounded-xl bg-primary/15 text-primary"><Sparkles className="size-5" /></span>
        <h2 id="welcome-title" className="text-xl font-semibold tracking-tight">{t('Welcome!')}</h2>
      </div>
      <p className="mt-2 text-sm leading-snug text-muted-foreground">{t('Set up your weekly routine to get going — or load a ready-made starter plan.')}</p>
      <Button className="mt-4 h-12 w-full gap-2 rounded-xl text-base font-semibold" onClick={() => starterPlanSheet()}>
        <Sparkles aria-hidden className="size-4" />{t('Load starter plan')}
      </Button>
      <Button variant="outline" className="mt-2 h-12 w-full rounded-xl text-base" onClick={() => nav('/plan')}>{t('Build my own plan')}</Button>
    </section>
  )
}

// The gym membership codes, one tap away on arrival (switched off in Settings → Gym check-in).
export function CheckInCard() {
  const nav = useNavigate()
  return (
    <button type="button" data-testid="checkin-card" onClick={() => nav('/checkin')}
      className="flex min-h-16 w-full items-center gap-3 rounded-3xl border border-border bg-card px-4 py-3 text-left text-card-foreground outline-none transition-colors duration-150 hover:bg-secondary/40 focus-visible:ring-[3px] focus-visible:ring-ring/50">
      <span aria-hidden className="grid size-10 place-items-center rounded-xl bg-[var(--blue)] text-white"><QrCode className="size-5" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-muted-foreground">{t('At the gym')}</span>
        <span className="block text-[15px] font-semibold">{t('Check in')}</span>
      </span>
      <ChevronRight aria-hidden className="size-5 text-muted-foreground" />
    </button>
  )
}
```

Criar `src/features/home/HomeScreen.tsx`:

```tsx
import { useNavigate } from 'react-router-dom'
import { Settings as SettingsIcon } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { useStore } from '../../store/useStore.js'
import { t, dateLocale } from '../../lib/i18n.js'
import { useProfile } from '../profile/useProfile'
import { ProgressHero } from './ProgressHero'
import { TodayCard } from './TodayCard'
import { BodyWeightCard } from './BodyWeightCard'
import { CheckInCard, WelcomeCard } from './HomeCards'

type HomeStore = { S: Record<string, any>; user: { id: string; name?: string } | null }

// Home = where you stand and what to do now. Deep charts and history live in Stats.
export default function HomeScreen() {
  const nav = useNavigate()
  const S = useStore((s: HomeStore) => s.S)
  const user = useStore((s: HomeStore) => s.user)
  const profile = useProfile(s => s.profile)
  const name = profile?.display_name || user?.name || ''

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-3 font-sans text-foreground">
      <header className="flex items-start justify-between gap-3 pb-1">
        <div className="min-w-0">
          <h1 className="truncate text-[28px] font-semibold leading-tight tracking-tight">{user ? t('Hi {0}', name) : 'openGym'}</h1>
          <p className="text-sm text-muted-foreground first-letter:uppercase">
            {new Date().toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
        {/* Settings, then the profile at the far edge, where an account usually is. */}
        <div className="flex flex-none items-center gap-1">
          <Button variant="ghost" size="icon" className="size-11 rounded-full" aria-label={t('Settings')} onClick={() => nav('/settings')}>
            <SettingsIcon className="size-5" />
          </Button>
          {user && (
            <button type="button" data-testid="avatar-button" aria-label={t('Profile')} onClick={() => nav('/perfil')}
              className="grid size-11 place-items-center rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
              <Avatar className="size-9 ring-1 ring-border">
                {profile?.avatar_url && <AvatarImage src={profile.avatar_url} alt="" referrerPolicy="no-referrer" />}
                <AvatarFallback className="bg-secondary text-[15px] font-semibold text-secondary-foreground">
                  {(name || '?').trim().slice(0, 1).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            </button>
          )}
        </div>
      </header>

      {user && <ProgressHero />}
      <TodayCard />
      {!S.routines.length && !S.active && <WelcomeCard />}
      {S.checkIn !== false && <CheckInCard />}
      {S.showWeightCard !== false && <BodyWeightCard />}
    </div>
  )
}
```

Substituir todo o conteúdo de `src/views/Home.jsx` por:

```jsx
// The Home screen lives in features/home (Phase 1a, shadcn). This path stays because App.jsx and the
// legacy tests import it.
export { default } from '../features/home/HomeScreen.tsx'
```

- [ ] **Step 6: Rodar e ver passar**

Run: `npx vitest run src/features/home src/views/Home.avatar.test.jsx src/views/Home.startdoor.test.jsx src/views/Home.weight-card.test.jsx src/views/starter-entry.test.jsx src/features/sync`
Expected: PASS. Se `Home.weight-card.test.jsx` acusar export ausente no mock de `../sheets.jsx`, conferir que nenhuma função de `sheets.jsx` é lida fora de handler no caminho sem peso (`bwDeltaColor` só é lido com duas pesagens).

- [ ] **Step 7: Conferência visual**

```bash
npm run dev
```

No navegador, viewport 375×812, temas escuro e claro: Home com conta e sem progresso (skeleton),
com progresso (cartão completo), com escudos abertos, sem rotinas (boas-vindas), com check-in
desligado, com e sem peso. Conferir alvos ≥ 44 px no DevTools e que nada transborda na largura de
320 px. Com `prefers-reduced-motion: reduce` (DevTools → Rendering) as animações viram fade.

- [ ] **Step 8: Verificar e commitar**

```bash
node scripts/check-source-strings.mjs --strict
npm run typecheck && npm test && npm run build
git add src/lib/use-online.ts src/features/sync/SyncIndicator.tsx src/features/home src/views/Home.jsx src/views/Home.startdoor.test.jsx
git commit -m "feat(home): redesign Home in shadcn around level, streak and the week

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Galeria de conquistas e progresso no Perfil

**Files:**
- Create: `src/features/gamification/AchievementsScreen.tsx`
- Create: `src/features/gamification/ProfileProgress.tsx`
- Modify: `src/features/profile/ProfileScreen.tsx`
- Modify: `src/App.jsx` (rota `/conquistas`)
- Test: `src/features/gamification/AchievementsScreen.test.tsx`, `src/features/gamification/ProfileProgress.test.tsx`

**Interfaces:**
- Consumes: `useProgress`; `ACHIEVEMENTS`, `SOCIAL_METRICS`, `Achievement` (Task 7); `ACHIEVEMENT_TEXT` (Task 9); `AchievementIcon`, `LevelBar`, `fmtInt`, `fmtDay` (Task 10).
- Produces: rota `/conquistas` → `AchievementsScreen` (default export); `ProfileProgress` (default export) no topo das seções do Perfil. `data-testid="achievement-<code>"` com `data-unlocked="true|false"` em cada cartão.

- [ ] **Step 1: Testes que falham**

Criar `src/features/gamification/AchievementsScreen.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'

const h = vi.hoisted(() => ({ nav: vi.fn() }))
vi.mock('react-router-dom', () => ({ useNavigate: () => h.nav }))

import AchievementsScreen from './AchievementsScreen'
import { useProgress } from './useProgress'
import { progressOf } from './test-progress'

const realRefresh = useProgress.getState().refresh
const card = (code: string) => screen.getByTestId('achievement-' + code)

beforeEach(() => { localStorage.clear(); useProgress.getState().reset(); h.nav.mockClear() })
afterEach(() => { cleanup(); useProgress.setState({ refresh: realRefresh }) })

describe('AchievementsScreen', () => {
  it('lists every badge, unlocked or on its way', () => {
    useProgress.setState({
      status: 'ready',
      progress: progressOf(900, {}, {
        achievements: [{ code: 'first_workout', unlocked_at: '2026-10-01T12:00:00Z' }, { code: 'week_target_1', unlocked_at: '2026-10-03T12:00:00Z' }],
        stats: { workouts: 7, prs: 0, week_targets: 1, best_streak: 0, weigh_in_run: 2, early_workouts: 0, level: 5 }
      })
    })
    render(<AchievementsScreen />)
    expect(screen.getByText('2 of 22 unlocked')).toBeTruthy()
    expect(screen.getAllByRole('listitem')).toHaveLength(22)
    expect(card('first_workout').getAttribute('data-unlocked')).toBe('true')
    expect(within(card('first_workout')).getByText(/^Unlocked on /)).toBeTruthy()
    expect(card('workouts_10').getAttribute('data-unlocked')).toBe('false')
    expect(within(card('workouts_10')).getByText('7 of 10')).toBeTruthy()
    expect(within(card('first_friend')).getByText('Unlocks once friends arrive in the app.')).toBeTruthy()
    expect(within(card('level_10')).getByText('Badge only')).toBeTruthy()
    expect(within(card('streak_52')).getByText('+1,500 XP')).toBeTruthy()
  })

  it('goes back', () => {
    useProgress.setState({ status: 'ready', progress: progressOf(0) })
    render(<AchievementsScreen />)
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(h.nav).toHaveBeenCalledWith(-1)
  })

  it('shows placeholders while loading and a retry after a failure', () => {
    useProgress.setState({ status: 'loading' })
    const { container, unmount } = render(<AchievementsScreen />)
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy()
    unmount()
    const refresh = vi.fn(async () => null)
    useProgress.setState({ status: 'error', refresh })
    render(<AchievementsScreen />)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refresh).toHaveBeenCalledTimes(1)
  })
})
```

Criar `src/features/gamification/ProfileProgress.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

const h = vi.hoisted(() => ({ nav: vi.fn() }))
vi.mock('react-router-dom', () => ({ useNavigate: () => h.nav }))

import ProfileProgress from './ProfileProgress'
import { useProgress } from './useProgress'
import { progressOf } from './test-progress'

beforeEach(() => { localStorage.clear(); useProgress.getState().reset(); h.nav.mockClear() })
afterEach(cleanup)

describe('ProfileProgress', () => {
  it('stays out of the way until there is progress', () => {
    const { container } = render(<ProfileProgress />)
    expect(container.innerHTML).toBe('')
  })

  it('shows the overall level, the strength pillar with its icon and name, and the badges', () => {
    useProgress.setState({ status: 'ready', progress: progressOf(1110, {}, { pillars: { strength: { level: 5, into: 260, need: 300, xp: 960 } } }) })
    render(<ProfileProgress />)
    expect(screen.getByRole('heading', { name: 'Overall level' })).toBeTruthy()
    // Overall: 1110 XP is level 6 (110/350); the strength pillar is level 5.
    expect(screen.getByText('Level 6')).toBeTruthy()
    expect(screen.getByText('Level 5')).toBeTruthy()
    expect(screen.getByText('Total XP: 1,110')).toBeTruthy()
    expect(screen.getByRole('progressbar', { name: 'Strength' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Achievements/ }))
    expect(h.nav).toHaveBeenCalledWith('/conquistas')
  })
})
```

Run: `npx vitest run src/features/gamification/AchievementsScreen.test.tsx src/features/gamification/ProfileProgress.test.tsx`
Expected: FAIL (módulos inexistentes).

- [ ] **Step 2: Implementar a galeria**

Criar `src/features/gamification/AchievementsScreen.tsx`:

```tsx
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { t } from '../../lib/i18n.js'
import { useProgress } from './useProgress'
import { ACHIEVEMENTS, SOCIAL_METRICS, type Achievement } from './achievements'
import { ACHIEVEMENT_TEXT } from './achievement-labels'
import { AchievementIcon } from './components/AchievementIcon'
import { fmtDay, fmtInt } from './format'

// /conquistas: every badge of the catalogue in its order, unlocked ones with their date, locked
// ones with how far along you are (or why they cannot move yet). Reached from Home and Profile.
export default function AchievementsScreen() {
  const navigate = useNavigate()
  const progress = useProgress(s => s.progress)
  const status = useProgress(s => s.status)
  const unlocked = new Map((progress?.achievements ?? []).map(a => [a.code, a.unlocked_at]))

  return (
    <div className="mx-auto flex w-full max-w-md flex-col font-sans text-foreground">
      <header className="-ml-2 flex h-11 items-center">
        <Button variant="ghost" size="icon" className="size-11 rounded-full" aria-label={t('Back')} onClick={() => navigate(-1)}>
          <ArrowLeft className="size-5" />
        </Button>
      </header>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">{t('Achievements')}</h1>
      {progress && <p className="mt-1 text-sm text-muted-foreground">{t('{0} of {1} unlocked', unlocked.size, ACHIEVEMENTS.length)}</p>}

      {!progress && status === 'error' ? (
        <div className="mt-6 rounded-2xl border border-border bg-card p-5">
          <p className="text-[15px] font-medium">{t('Could not load your progress.')}</p>
          <Button variant="outline" className="mt-3 h-11 gap-2 rounded-xl" onClick={() => void useProgress.getState().refresh()}>
            <RefreshCw aria-hidden className="size-4" />{t('Try again')}
          </Button>
        </div>
      ) : !progress ? (
        <div aria-busy="true" className="mt-5 grid grid-cols-2 gap-3">
          {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-48 rounded-2xl" />)}
        </div>
      ) : (
        <ul className="mt-5 grid grid-cols-2 gap-3 pb-6">
          {ACHIEVEMENTS.map(a => <Tile key={a.code} a={a} at={unlocked.get(a.code) ?? null} value={progress.stats[a.metric]} />)}
        </ul>
      )}
    </div>
  )
}

function Tile({ a, at, value }: { a: Achievement; at: string | null; value: number | undefined }) {
  const text = ACHIEVEMENT_TEXT[a.code]
  const on = at !== null
  const social = SOCIAL_METRICS.includes(a.metric)
  const reached = Math.min(value ?? 0, a.threshold)
  return (
    <li data-testid={'achievement-' + a.code} data-unlocked={on ? 'true' : 'false'}
      className={cn('flex flex-col gap-3 rounded-2xl border p-4', on ? 'border-primary/30 bg-card' : 'border-border bg-card/50')}>
      <div className="flex items-start justify-between gap-2">
        <AchievementIcon code={a.code} unlocked={on} className="size-12" />
        <span className={cn('rounded-full px-2 py-0.5 font-mono text-xs font-semibold tabular-nums', on ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground')}>
          {a.xp > 0 ? t('+{0} XP', fmtInt(a.xp)) : t('Badge only')}
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <h2 className={cn('text-[15px] font-semibold leading-snug', !on && 'text-muted-foreground')}>{text.title()}</h2>
        <p className="text-sm leading-snug text-muted-foreground">{text.detail()}</p>
      </div>
      <div className="mt-auto text-xs text-muted-foreground">
        {at !== null ? (
          <span className="font-medium text-primary">{t('Unlocked on {0}', fmtDay(at))}</span>
        ) : social ? (
          <span>{t('Unlocks once friends arrive in the app.')}</span>
        ) : typeof value === 'number' ? (
          <span className="flex flex-col gap-1.5">
            <span aria-hidden className="block h-1.5 overflow-hidden rounded-full bg-muted">
              <span className="block h-full rounded-full bg-muted-foreground/60" style={{ width: `${(reached / a.threshold) * 100}%` }} />
            </span>
            <span className="tabular-nums">{t('{0} of {1}', fmtInt(reached), fmtInt(a.threshold))}</span>
          </span>
        ) : (
          <span>{t('Locked')}</span>
        )}
      </div>
    </li>
  )
}
```

Criar `src/features/gamification/ProfileProgress.tsx`:

```tsx
import { useNavigate } from 'react-router-dom'
import { ChevronRight, Dumbbell, Trophy } from 'lucide-react'
import { t } from '../../lib/i18n.js'
import { useProgress } from './useProgress'
import { ACHIEVEMENTS } from './achievements'
import { LevelBar } from './components/LevelBar'
import { fmtInt } from './format'

// The Profile's progress block (spec §3.4): overall level, one bar per pillar (icon and name, never
// colour alone) and the way into the achievements. Nothing until the first answer.
export default function ProfileProgress() {
  const navigate = useNavigate()
  const progress = useProgress(s => s.progress)
  if (!progress) return null
  const strength = progress.pillars.strength

  return (
    <section data-slot="card" aria-labelledby="sec-progress" className="rounded-2xl border border-border bg-card px-5 pb-3 pt-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="sec-progress" className="text-[15px] font-semibold">{t('Overall level')}</h2>
        <span className="font-mono text-[15px] font-semibold tabular-nums">{t('Level {0}', progress.level.level)}</span>
      </div>
      <p className="mt-0.5 text-sm tabular-nums text-muted-foreground">{t('Total XP')}: {fmtInt(progress.total_xp)}</p>
      <LevelBar className="mt-3" to={progress.level} instant label={t('Overall level')} />
      {strength && (
        <div className="mt-4">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2 font-medium"><Dumbbell aria-hidden className="size-4 text-[var(--pillar-strength)]" />{t('Strength')}</span>
            <span className="font-mono tabular-nums text-muted-foreground">{t('Level {0}', strength.level)}</span>
          </div>
          <LevelBar className="mt-2 h-2 bg-[color-mix(in_oklab,var(--pillar-strength)_18%,transparent)]" fillClassName="bg-[var(--pillar-strength)]"
            to={strength} instant label={t('Strength')} />
        </div>
      )}
      <button type="button" onClick={() => navigate('/conquistas')}
        className="-mx-2 mt-3 flex min-h-12 w-[calc(100%+1rem)] items-center justify-between gap-3 rounded-xl px-2 text-left outline-none transition-colors duration-150 hover:bg-secondary/60 focus-visible:ring-[3px] focus-visible:ring-ring/50">
        <span className="flex items-center gap-2 text-[15px] font-medium"><Trophy aria-hidden className="size-4 text-primary" />{t('Achievements')}</span>
        <span className="flex items-center gap-1 text-sm text-muted-foreground">
          {t('{0} of {1} unlocked', progress.achievements.length, ACHIEVEMENTS.length)}<ChevronRight aria-hidden className="size-4" />
        </span>
      </button>
    </section>
  )
}
```

- [ ] **Step 3: Perfil e rota**

Em `src/features/profile/ProfileScreen.tsx`, importar `import ProfileProgress from '../gamification/ProfileProgress'`
e acrescentar `<ProfileProgress />` como primeiro filho de `<div className="mt-8 flex flex-col gap-3">`
(antes de `{SECTIONS.map(...)}`). Sem progresso ele não renderiza nada, então
`ProfileScreen.test.tsx` continua igual.

Em `src/App.jsx`, importar `import AchievementsScreen from './features/gamification/AchievementsScreen.tsx'`
e acrescentar a rota logo depois de `/perfil`:

```jsx
                <Route path="/conquistas" element={<AchievementsScreen />} />
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/features/gamification src/features/profile`
Expected: PASS.

- [ ] **Step 5: Verificar e commitar**

```bash
node scripts/check-source-strings.mjs --strict
npm run typecheck && npm test && npm run build
git add src/features/gamification/AchievementsScreen.tsx src/features/gamification/AchievementsScreen.test.tsx src/features/gamification/ProfileProgress.tsx src/features/gamification/ProfileProgress.test.tsx src/features/profile/ProfileScreen.tsx src/App.jsx
git commit -m "feat(gamification): achievements gallery and progress block on Profile

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Verificação final, docs e roadmap

**Files:**
- Modify: `docs/superpowers/specs/2026-10-04-performance-app-foundation-design.md`
- Modify: `docs/ROADMAP.md`

**Interfaces:**
- Consumes: tudo das Tasks 1–13.
- Produces: suíte e scripts verdes; spec e roadmap atualizados.

- [ ] **Step 1: Suíte completa e scripts**

```bash
npm run typecheck
npm test
npm run build
node scripts/check-locales.mjs
node scripts/check-source-strings.mjs --strict
```

Expected: tudo verde. Ler a saída inteira antes de seguir (skill `superpowers:verification-before-completion`).

- [ ] **Step 2: Smoke manual com Supabase**

Com `.env.local` preenchido e as migrations `0002` e `0003` aplicadas no projeto (docs/SETUP.md §1 e §7), `npm run dev`, viewport 375×812:

1. Home: skeleton rápido, depois nível 1, "Termine um treino para ganhar seus primeiros XP.", semana 0 de 960.
2. Fazer um treino curto e concluir: resumo mostra "+200 XP" (T = 3) com a linha "Treino 1 de 3", a barra enche e, depois da contagem, a carta "Conquista desbloqueada: Primeiro treino". Tocar dispensa.
3. Voltar à Home: XP da semana, bolinhas de sessão e conquistas "1 de 22" batem com o resumo.
4. Registrar o peso pela Home: toast "Peso salvo. +10 XP"; registrar de novo no mesmo dia: só "Peso salvo".
5. DevTools → Network → Offline, concluir outro treino: o resumo mostra a estimativa com o aviso; voltar online e abrir a Home: o número confere com o servidor.
6. Perfil: bloco "Nível geral" com a barra de Força; "Conquistas" abre `/conquistas`; cartões bloqueados mostram "1 de 10".
7. Repetir 1–3 com `prefers-reduced-motion: reduce` (sem deslocamentos, números finais direto) e no tema claro.
8. Supabase → SQL Editor: `select reason, amount, week_start from xp_ledger order by id;` confere com o que o app mostrou.

- [ ] **Step 3: Spec e roadmap**

Na spec, §5.2, logo depois da tabela, acrescentar:

```markdown
A T-ésima sessão planejada paga o resto, `600 − round(600/T)·(T−1)`, para que a soma seja sempre
600 (T = 7: seis de 86 e uma de 84). A meta de cada semana fica em `weekly_targets`, congelada pelo
primeiro evento ou leitura da semana, pelo job diário ou, se o perfil mudar antes, com o valor
antigo.
```

e, em §5.5, depois da tabela:

```markdown
`early_bird` conta sessões ao vivo cujo payload traz `hour` (hora local de início) menor que 7.
`first_friend`, `challenge_first` e `challenge_won_5` estão no catálogo desde a 1a e só a 1b os
libera (`award_achievement`).
```

No `docs/ROADMAP.md`, Fase 1a: trocar "Testes pgTAP + cenários de paridade cliente/servidor." por
"Testes SQL (Vitest + PGlite) + cenários de paridade cliente/servidor." e, na tabela de fases, o
status da 1a de `especificada` para `concluída`.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-10-04-performance-app-foundation-design.md docs/ROADMAP.md
git commit -m "docs: record phase 1a decisions and mark it done

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Interfaces para a 1b

O que a Fase 1b (social) pode usar sem mudar nada da 1a. Tudo em `public`, criado por
`supabase/migrations/0002_gamification.sql`. Funções marcadas "interna" são `security definer`,
`set search_path = public` e **não** são executáveis por `anon`/`authenticated`: a 1b as chama de
dentro das próprias RPCs `security definer` (ex.: `accept_invite`, fechamento de desafios), depois
de checar `auth.uid()` e amizade.

**Tabelas (RLS: cada usuário lê só as próprias linhas; ninguém escreve pelo cliente)**

| Tabela | Colunas | Uso na 1b |
|---|---|---|
| `xp_ledger` | `id, user_id, pillar (null = bônus geral), amount (> 0), reason, event_id, week_start (segunda), created_at` | ranking semanal/geral por soma; bônus de desafio entram aqui via `award_bonus_xp` |
| `user_achievements` | `user_id, code → achievement_catalog, unlocked_at` | conquistas nos cartões de amigos |
| `achievement_catalog` | `code, metric, threshold, xp, sort` (leitura liberada a `authenticated`) | já contém `first_friend` (`friends` ≥ 1, 50 XP), `challenge_first` (`challenges_won` ≥ 1, 200 XP), `challenge_won_5` (`challenges_won` ≥ 5, 500 XP) |
| `streaks` | `user_id, kind ('training_week'), current, best, shields, last_period` | streak nos cartões e no desafio `weeks_on_target` |
| `weekly_targets` | `user_id, week_start, target` | meta congelada por semana (desafio `weeks_on_target`) |

Razões de ledger em uso: `'workout'`, `'workout_extra'`, `'week_target'`, `'pr'`, `'weight'`,
`'achievement:<code>'`. Convenção para a 1b: `'challenge:<challenge_id>'` para o bônus de +300.
Bônus sem `event_id` são únicos por `(user_id, reason)` (índice parcial `xp_ledger_bonus_once`).
"Meta da semana batida" = existe linha `reason = 'week_target'` naquele `week_start`.

**Funções**

| Assinatura | Tipo | Contrato |
|---|---|---|
| `award_bonus_xp(p_user uuid, p_amount integer, p_reason text, p_week date default null) returns boolean` | interna | Paga um bônus geral (`pillar = null`) uma única vez por `(user, reason)`; `true` se pagou agora. `p_week` padrão: semana local corrente do usuário. `p_amount` entre 1 e 5000, senão `invalid_amount` (22023). Não avalia conquistas: chamar `evaluate_achievements` depois para pegar os badges de nível. |
| `award_achievement(p_user uuid, p_code text) returns boolean` | interna | Desbloqueia `p_code` (idempotente; `true` só na primeira vez) e paga o XP do catálogo com `reason = 'achievement:' \|\| p_code`. Código fora do catálogo: `unknown_achievement` (22023). É o caminho para `first_friend`, `challenge_first`, `challenge_won_5`. |
| `evaluate_achievements(p_user uuid) returns text[]` | interna | Libera o que as métricas da 1a alcançam e, por último, os badges de nível. Devolve os códigos novos. |
| `achievements_for_stats(p_stats jsonb, p_unlocked text[]) returns text[]` | pura | Avaliação genérica: a 1b pode passar `jsonb_build_object('friends', n)` ou `('challenges_won', n)` com os códigos já desbloqueados e chamar `award_achievement` para cada código devolvido. |
| `progress_card(p_user uuid) returns jsonb` | interna | Cartão público, sem dados privados: `{ total_xp, level: {level, into, need}, pillars: { strength: {level, into, need, xp}, ... }, week: { start, xp, max, target, workouts, extras, prs, target_hit }, streak: { current, best, shields }, achievements: [{ code, unlocked_at }] }`. Não traz peso, `stats` nem `weighed_today`. Base para `get_friends`; quem chama checa a amizade. |
| `total_xp(p_user uuid) returns bigint` | interna | Soma de todo o ledger (ranking geral). |
| `week_xp(p_user uuid, p_week date) returns integer` | interna | Soma do ledger na semana (ranking semanal; inclui bônus). |
| `close_weeks(p_user uuid, p_rebuild boolean default false) returns void` | interna | Fecha as semanas pendentes (fechamento preguiçoso para ranking e desafios). |
| `local_today(p_user uuid) returns date`, `local_week_start(p_user uuid) returns date` | internas | "Hoje" e a segunda-feira corrente no fuso do perfil. |
| `week_start_of(d date) returns date`, `level_for(p_xp bigint, out level int, out into_level int, out need int)`, `level_json(p_xp bigint) returns jsonb`, `app_now() returns timestamptz` | puras | Calendário, nível e relógio (o relógio aceita `app.now` só em sessão de superusuário, para testes). |
| `get_my_progress() returns jsonb` | RPC de `authenticated` | Cartão do próprio usuário + `today`, `stats`, `week.weighed_today`; fecha semanas e avalia conquistas antes. |
| `close_all_weeks() returns integer` | interna | O que o job `pg_cron` `close-weeks` (06:00 UTC) roda. Uma rotina de desafios da 1b entra numa migration nova com o mesmo padrão "no-op sem `pg_cron`" de `0003_gamification_cron.sql`. |

Concorrência: toda escrita de XP de um usuário trava `pg_advisory_xact_lock(hashtextextended('xp:' || user_id::text, 0))`. A 1b deve pegar a mesma trava antes de `award_bonus_xp`/`award_achievement` para esse usuário.

Testes: `supabase/tests/helpers/game.ts` exporta `A`, `B`, `sql(db, q, params)`, `setClock(db, iso | null)`, `withoutEventWindow(db)`, `makeUser(db, uid, over?)`, `event(db, uid, kind, on, ref, payload?)`, `ledger(db, uid)`.

**TypeScript (`src/features/gamification/`)**

| Export | Arquivo | Uso na 1b |
|---|---|---|
| `useProgress` (`progress`, `status`, `stale`, `pending`, `held`, `load`, `refresh()`, `takePending()`, `hold(on)`, `reset()`), `startProgressSync()` | `useProgress.ts` | depois de aceitar convite ou concluir desafio, `refresh()`: o nível e as conquistas novas viram celebração sozinhos (`CelebrationHost` já está montado no `App`) |
| `syncProgress(): Promise<SyncResult>`, `weighInXp(day)` | `after-event.ts` | |
| `Progress`, `PillarProgress`, `WeekProgress`, `LevelInfo`, `XpLine`, `XpPreview`, `Celebration`, `SyncResult` | `types.ts` | o cartão de amigo pode tipar `progress_card` como `Omit<Progress, 'today' \| 'stats'>` com `week` sem `weighed_today` |
| `levelFor`, `weekStartOf`, `sessionXp`, `replay`, `streakAfter`, `WEEK_MAX`, `SHIELD_MAX` e demais constantes | `xp.ts` | |
| `ACHIEVEMENTS`, `achievementByCode`, `evaluateAchievements`, `SOCIAL_METRICS`, tipos `Achievement`, `AchievementCode`, `AchievementStats`, `Metric` | `achievements.ts` | |
| `ACHIEVEMENT_TEXT` | `achievement-labels.ts` | títulos e descrições já traduzidos nos 16 packs, inclusive das conquistas sociais |
| `LevelBar`, `StreakBadge`, `AchievementIcon`, `CelebrationOverlay` | `components/` | cartões de amigos e ranking |
| `fmtInt`, `fmtDay` | `format.ts` | |
| `progressOf(total, week?, over?)` | `test-progress.ts` | fábrica de `Progress` para testes |
| `useOnline()` | `src/lib/use-online.ts` | |

Rotas e telas: `/conquistas` (`AchievementsScreen`). Os cartões de `first_friend`, `challenge_first`
e `challenge_won_5` mostram "Libera quando a área de amigos chegar ao app." enquanto
`SOCIAL_METRICS` não têm valor em `progress.stats`; quando a 1b passar a mandar `friends` e
`challenges_won` em `get_my_progress().stats`, esses cartões mostram o progresso sem mudança de UI
além de trocar a condição `social` em `AchievementsScreen.tsx` por "métrica ausente".
