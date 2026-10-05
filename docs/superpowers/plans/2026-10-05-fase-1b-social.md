# Fase 1b — Social: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** consistência entre amigos: convite por link vira amizade mútua, amigos aparecem no
ranking da semana e no geral, encaram desafios por modelo (equipe ou individual, +300 XP para quem
cumpre) e acompanham um feed opcional de treinos, sem que peso, dieta ou cargas saiam da conta de
ninguém.

**Architecture:** o Postgres continua sendo a autoridade. Uma migration nova (`0004_social.sql`)
cria convites, amizades e desafios com RLS de "só o próprio" e expõe tudo por RPCs `security
definer` que checam `auth.uid()` e a amizade antes de montar a resposta com as funções internas da
1a (`progress_card`, `week_xp`, `total_xp`, `award_bonus_xp`, `evaluate_achievements`). Desafios
fecham de forma preguiçosa (ao abrir desafios ou ranking) e por um job `pg_cron` diário
(`0005_social_cron.sql`, no-op sem a extensão). No cliente, `src/features/social/` tem a camada de
API com erros tipados, regras puras espelhadas do SQL, uma store `useSocial` com cache offline e as
telas novas em shadcn (Ranking, Desafios, Feed, Amigos, convite), mais a TabBar com a aba Social.

**Tech Stack:** Postgres (Supabase) com PL/pgSQL, `pg_cron`; `@electric-sql/pglite` + Vitest para os
testes SQL; React 19, React Router 7 (`HashRouter`), Zustand 5, TypeScript, Tailwind v4, shadcn/ui
(Drawer/vaul, ToggleGroup, Avatar, Switch, Skeleton), `motion` (`motion/react`), `lucide-react`,
`sonner`, `@testing-library/react`.

**Spec:** `docs/superpowers/specs/2026-10-04-performance-app-foundation-design.md` (ler §3.3 rotas
públicas, §4.3 inteiro, §4.4 linhas de `create_invite` até `get_feed` e o parágrafo de fechamento,
§5.5 conquistas sociais, §6 inteiro, §7.4, §7.5 linha 1b, §9, §10). Roadmap: `docs/ROADMAP.md`, Fase
1b. Regras do projeto: `CLAUDE.md`. Dependência direta: `docs/superpowers/plans/2026-10-05-fase-1a-gamificacao.md`
(seções "Decisões" e "Interfaces para a 1b"; este plano só usa o que está lá). Modelo de estilo:
`docs/superpowers/plans/2026-10-04-fase-0-fundacao.md`.

## Global Constraints

- Trabalhar num branch `fase-1b` criado a partir da ponta do `fase-1a` depois da Task 14 da 1a (ou do `main`, se a 1a já tiver sido mesclada). Commits locais; **não fazer push**.
- Convite: link `/convite/<code>`, `code` com 10 caracteres base62 aleatórios, validade de 7 dias, uso único, **no máximo 5 convites ativos por pessoa**. `accept_invite` valida expiração, uso e auto-convite e cria `friendships` com o par ordenado (`user_a < user_b`).
- Erros tipados das RPCs (spec §9): `invite_expired`, `invite_used`, `self_invite`, `already_friends`, mais os desta fase listados na Decisão 4. Mapeados para mensagens em `t()`.
- Visibilidade para amigos (spec §6): nome, foto, níveis geral e por pilar, XP semanal, streak, conquistas, progresso em desafios compartilhados. Feed de treinos e PRs só de quem tem `share_activity = true`. **Nunca**: peso, medidas, dieta, sono detalhado, cargas.
- Ranking: aba "Semana" (padrão, zera segunda 00:00 no fuso de cada pessoa) e aba "Geral" (nível/XP total), com posição, variação contra a semana passada e distância para o próximo colocado. Só eu + amigos.
- Desafios por modelo, sem editor livre: `workouts_count` (team soma / solo cada um atinge N), `weeks_on_target` (solo), `volume_total` (team/solo, opt-in explícito ao entrar). Duração de 7 a 92 dias, 2 a 20 participantes. Sucesso no fim do período: **+300 XP** por membro (team) ou para quem atingiu (solo), uma única vez, mais as conquistas `challenge_first` (200) e `challenge_won_5` (500). `first_friend` (50) na primeira amizade.
- Fechamento de desafios: preguiçoso (`get_challenges`, ranking) + `pg_cron` diário, no mesmo padrão "no-op sem `pg_cron`" da `0003_gamification_cron.sql`.
- Toda escrita de XP de um usuário trava `pg_advisory_xact_lock(hashtextextended('xp:' || user_id::text, 0))` antes de `award_bonus_xp`/`award_achievement`/`evaluate_achievements` (contrato da 1a).
- RLS ligada em toda tabela nova. Funções `security definer` com `set search_path = public`. Funções internas: `revoke all ... from public, anon, authenticated`. RPCs de cliente: `revoke all ... from public, anon` + `grant execute ... to authenticated`; **exceção única** `get_invite`, que também vai para `anon`. Tabelas novas: `revoke insert, update, truncate ... from anon, authenticated` e `revoke all ... from anon` (o shim dos testes e o Supabase concedem tudo por padrão).
- Código novo em TypeScript em `src/features/`; legado JS só onde a tarefa manda (`App.jsx`, `main.jsx`, `components/TabBar.jsx`, `views/Plan.jsx`).
- Texto público (CLAUDE.md): sem travessão nem hífen como pausa (`—`, `–`, ` - `); passar pelo humanizer (`anthropic-skills:humanizer` em pt-BR, `humanizer` em inglês); toda chave nova nos 16 packs de `src/locales/` (pt-BR em `PT_BR_OVERRIDES`); `node scripts/check-locales.mjs` e `node scripts/check-source-strings.mjs --strict` passando.
- UX (spec §7.4): mobile-first, alvos ≥ 44 px, ações primárias ao alcance do polegar, bottom sheets (Drawer) no lugar de modais, safe areas; estados desenhados para vazio (com próxima ação), carregando (skeleton com a forma do conteúdo), erro (mensagem humana + tentar de novo) e offline (linha discreta, nada bloqueia); motion 150–300 ms com curva de saída, `prefers-reduced-motion` mantém só fade; foco visível, ARIA em ícones, nada só por cor; números em Geist Mono tabular.
- Commits pequenos, mensagem em inglês `type: summary`, terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Depois de cada tarefa: `npm run typecheck && npm test && npm run build` verdes.

## Decisões

Pontos que a spec deixa em aberto, fechados aqui a partir do código do `main` e do plano da 1a.

1. **Numeração.** A 1a termina em `0003_gamification_cron.sql`. A 1b cria `0004_social.sql` (todo o
   esquema social) e `0005_social_cron.sql` (job diário de desafios). `freshDb()` aplica os arquivos
   em ordem alfabética, então nada muda no harness.
2. **Link de convite com `HashRouter`.** O link é `origin + pathname + '#/convite/<code>'`
   (`inviteUrl`). Sem sessão, `Shell` hoje devolve `<SignIn />` para qualquer rota; passa a devolver
   `<InviteScreen code signedIn={false} />` quando o hash é `/convite/<code>`. O OAuth do Google
   volta para `origin + pathname` (Fase 0, `signInWithGoogle`), então **o hash se perde na volta**.
   Por isso o código fica em `localStorage` (`perf_pending_invite_v1 = { code, at }`, validade de
   24 h): é gravado quando a página do convite carrega um convite aberto e de novo no toque em
   "Continuar com Google". Depois do login, `ProfileGate` carrega o perfil e, para conta nova, roda
   o onboarding; só quando o perfil fica pronto (`profileReady`) o `PendingInviteHost` montado no
   `Shell` leva para `/convite/<code>`, e a `InviteScreen` aceita **sozinha, uma vez**, porque a
   pessoa já disse sim ao tocar em "Continuar com Google" naquele convite. Quem já está logado e
   abre o link vê o convidante e toca em "Aceitar convite". O marcador sai no sucesso, em qualquer
   erro definitivo (expirado, usado, auto-convite, já amigos, inexistente) e no `SIGNED_OUT`.
   `accept_invite` exige perfil (`no_profile`), o que garante que ele só roda depois do onboarding.
3. **`get_invite` público e abuso.** É a única RPC liberada para `anon`. Devolve só
   `{ status, expires_at, inviter: { name, avatar_url } }`, sem id de usuário, e-mail ou qualquer
   dado do convidado. Código malformado e código inexistente dão o mesmo erro (`invite_not_found`)
   e o formato é checado antes de tocar na tabela. O código sai de `gen_random_uuid()` (gerador forte
   do Postgres) com amostragem por rejeição para base62 sem viés: 62^10 ≈ 8,4·10^17 (~59,5 bits).
   Com no máximo 5 convites ativos por pessoa e validade de 7 dias, adivinhar um código é inviável
   mesmo sem limite de taxa; o Supabase não oferece rate limit por função no plano gratuito e o
   risco residual (descobrir nome e foto de quem convidou) é aceito e documentado.
4. **Erros tipados.** Toda RPC levanta `raise exception '<code>'`; o PostgREST devolve a mensagem
   igual ao código e `toSocialError` casa por igualdade exata. Códigos: `not_signed_in` (28000),
   `no_profile` (P0002), `invite_not_found` (P0002), `invite_expired`, `invite_used`, `self_invite`,
   `already_friends`, `invite_limit`, `not_friends`, `invalid_challenge`, `challenge_limit`,
   `challenge_not_found`, `challenge_closed`, `volume_opt_in_required` (P0001). Qualquer outra
   falha (rede, sessão vencida, erro inesperado) vira `network` no cliente: "tente de novo".
5. **Amizade.** Par ordenado em `friendships`. Criação só por `accept_invite`. Desfazer é um
   `delete` pelo cliente, liberado por RLS para qualquer um dos dois (spec §4.3); o cliente ordena os
   ids (`removeFriend`). Desfazer não mexe em desafios já em andamento.
6. **Travas.** `lock_users(uuid[])` pega a trava de XP da 1a de várias pessoas sempre em ordem
   crescente de uuid. O fechamento de desafios pega antes uma trava global
   (`hashtextextended('challenge-close', 0)`); nenhuma função pega trava de usuário e depois a de
   fechamento, então não há ciclo. `get_my_progress` (1a) não muda: segura só a trava do próprio
   usuário e não fecha desafios.
7. **`stats.friends` e `stats.challenges_won`.** A 0004 substitui `achievement_stats(p_user)` pelo
   mesmo corpo da 1a mais `friends` (amizades do usuário) e `challenges_won` (participações com
   `won = true`). Daí: `get_my_progress().stats` já traz as duas métricas, e
   `evaluate_achievements` libera `first_friend`, `challenge_first` e `challenge_won_5` sozinho (ele
   chama `award_achievement`, que paga o XP do catálogo uma vez). `accept_invite` avalia os dois
   amigos; o fechamento avalia quem venceu. O teste da 1a que compara `stats` por igualdade
   (`gamification-progress.test.ts`) ganha as duas chaves. Na galeria, a condição `social` de
   `AchievementsScreen.tsx` sai (como o plano da 1a previu): métrica ausente mostra "Bloqueada" e a
   chave "Unlocks once friends arrive in the app." sai dos 16 packs.
8. **O que amigos veem.** `get_friends` usa `progress_card` (sem peso, `stats` nem
   `weighed_today`). O feed lista só `workout_completed` de amigos com `share_activity = true`
   **no momento da leitura**, com os PRs da mesma sessão agrupados no item (pelo `source_ref`
   `<sessão>:<exercício>`): sai o número de séries e os ids de exercício dos PRs, nunca `vol`,
   `hour` nem `w`. O payload de `pr` nunca carregou o valor da carga, então "valor do PR no feed
   (opt-in)" da spec fica para depois; nenhum valor de carga sai nesta fase. Quem divide um desafio
   sem ser amigo (dois convidados do mesmo criador) vê nome, foto e progresso **só dentro daquele
   desafio**.
9. **Ranking.** Semana: cada pessoa na própria semana local (`week_xp(u, local_week_start(u))`),
   então alguém em Tóquio zera antes de quem está em São Paulo, como a spec pede. Variação: posição
   na semana anterior (`week_xp(u, semana − 7)`). Geral: `total_xp`, variação contra o total antes
   da semana corrente. Empates dividem a posição (`rank()`); `gap` é o XP que falta para alcançar o
   menor valor acima do meu (nulo para quem lidera).
10. **Modelo dos desafios.** `challenge_members.joined_at` vira **anulável**: linha com `joined_at`
    nulo é convite pendente (a spec previa `not null default now()`; o convite do criador precisa
    de um estado "convidado" para `join_challenge` fazer sentido). Colunas a mais: `invited_by`,
    `share_volume`, `final`, `won` em `challenge_members`; `closed_at` em `challenges`. Regras
    (iguais no SQL e em `templates.ts`): título com 1 a 60 caracteres; período de 7 a 92 dias
    contando os dois extremos (`ends_on - starts_on between 6 and 91`, mais estrito que o `<= 92`
    da spec); início entre hoje e hoje + 30 no fuso do criador; metas inteiras (`workouts_count`
    1–500 treinos, `weeks_on_target` 1 até o número de semanas que o período toca,
    `volume_total` 1–5000 toneladas); criador + 1 a 19 convidados, **todos amigos do criador**;
    no máximo 10 desafios ativos criados por pessoa; `volume_total` exige o aceite do criador ao
    criar e de cada convidado ao entrar.
11. **De onde vem o progresso.** `workouts_count`: eventos `workout_completed` com `occurred_on`
    no período. `weeks_on_target`: linhas `reason = 'week_target'` do `xp_ledger` (contrato da 1a)
    com `week_start` entre a segunda da data de início e o fim. `volume_total`: soma de
    `payload.vol` dos treinos do período (cada treino limitado a 100 000 para barrar payload
    forjado), convertida de lb para kg pela unidade do perfil (o openGym guarda cargas na unidade
    escolhida; `lib/format.js` não converte) e dividida por 1000, com uma casa. Só membros que
    entraram contam.
12. **Fechamento.** Um desafio fecha quando `local_today(created_by) > ends_on`. Fechar apaga
    convites sem resposta; com menos de 2 participantes vira `cancelled`; equipe vence se a soma
    atinge a meta (todos ganham); individual marca `won` por pessoa e o desafio é `won` se alguém
    venceu. +300 vai por `award_bonus_xp(user, 300, 'challenge:<id>')` (único por razão, índice da
    1a), seguido de `evaluate_achievements`. Treino lançado no passado depois do fechamento não
    conta mais. Fechamento preguiçoso em `get_challenges` e nos dois rankings; o app chama
    `get_challenges` ao abrir (para o badge da aba), então quem abre o app recebe o bônus no mesmo
    dia; o job `close-challenges` às 06:15 UTC cobre quem não abre.
13. **Sair.** Convidado que sai recusa (a linha some). Participante que sai some do desafio; se não
    sobra nenhum participante, o desafio é apagado. O criador também pode sair.
14. **Navegação.** A TabBar vira TSX em `src/features/nav/TabBar.tsx` e
    `src/components/TabBar.jsx` passa a reexportar (como `views/Home.jsx` na 1a), mantendo o
    `#tabbar` e as classes do CSS legado (vidro, safe area, botão central). Abas: Início, Plano,
    Treinar, **Social**, Stats. Exercícios sai da barra e ganha um botão no cabeçalho do Plano;
    `/library` e `/muscles` acendem a aba Plano. A aba Social mostra um contador de convites de
    desafio pendentes. Rotas: `/social` → `/social/ranking`; `/social/:section` com `ranking`,
    `desafios`, `feed`, `amigos` (a troca de seção usa `replace`, então o voltar sai da área
    social em vez de passear pelas abas); `/social/desafios/:id`; `/convite/:code`.
15. **Dados no cliente.** Store `useSocial` com um recurso por lista (`friends`, `invites`,
    `weekly`, `alltime`, `challenges`) e o feed paginado. Cache em `localStorage`
    (`perf_social_v1`, por usuário, sem convites): a tela abre com o que foi salvo e marca `stale`
    até o servidor responder; offline mostra o cache com uma linha discreta. Depois de aceitar
    convite, criar/entrar/sair de desafio ou ver um desafio fechado com vitória, o app chama
    `useProgress.getState().refresh()` e o `CelebrationHost` da 1a mostra nível e conquistas
    novas sem código extra.
16. **Compartilhar.** `shareLink` usa a Web Share API quando existe; cancelar o sheet (`AbortError`)
    não faz nada; outro erro ou ausência cai para `navigator.clipboard.writeText` + toast "Link do
    convite copiado"; se nem a área de transferência funcionar, um Drawer mostra o link num campo
    selecionável com botão de copiar.
17. **Timeline do feed.** O roadmap cita a Timeline do ReUI; ela é um componente de copiar e
    colar. Para não trazer dependência nem registro novo, o feed desenha uma linha do tempo
    vertical simples com Tailwind, agrupada por dia.

## File Structure

```
supabase/
├─ migrations/
│  ├─ 0004_social.sql              friend_invites, friendships, challenges, challenge_members;
│  │                                helpers, create/get/accept_invite, get_friends, get_feed,
│  │                                desafios (criar, entrar, sair, progresso, fechar), rankings,
│  │                                achievement_stats com friends e challenges_won
│  └─ 0005_social_cron.sql         agenda close_all_challenges no pg_cron (no-op sem a extensão)
└─ tests/
   ├─ helpers/social.ts            C, D, rows, one, befriend, xp, createChallenge
   ├─ social-invites.test.ts       convites, amizade, first_friend, RLS
   ├─ social-friends.test.ts       cartões de amigos e privacidade
   ├─ social-feed.test.ts          feed, share_activity, paginação
   ├─ social-challenges.test.ts    criar, validar, entrar, sair, progresso, RLS
   ├─ social-close.test.ts         fechamento, +300, conquistas, cron
   ├─ social-leaderboard.test.ts   semana, geral, fuso, variação
   └─ gamification-progress.test.ts  (1a) stats com friends e challenges_won
src/
├─ lib/database.types.ts           + friend_invites, friendships
├─ main.jsx                        limpa o convite pendente no SIGNED_OUT
├─ App.jsx                         store social, rotas, convite sem sessão, PendingInviteHost
├─ components/TabBar.jsx           reexporta features/nav/TabBar.tsx
├─ views/Plan.jsx                  botão Exercícios no cabeçalho
├─ features/nav/TabBar.tsx         Início, Plano, Treinar, Social, Stats
├─ features/gamification/AchievementsScreen.tsx   métrica ausente = Bloqueada
└─ features/social/
   ├─ types.ts                     Person, Friend, InviteInfo, Leaderboard, Challenge, FeedPage…
   ├─ social-api.ts                RPCs, SocialError, toSocialError
   ├─ pending-invite.ts            marcador do convite, inviteUrl, inviteCodeFromPath
   ├─ share.ts                     shareLink (Web Share, área de transferência)
   ├─ templates.ts                 regras puras dos desafios (espelho do SQL)
   ├─ useSocial.ts                 store + cache
   ├─ format.ts                    fmtShortDay, fmtTime, fmtDecimal
   ├─ labels.ts                    socialErrorText, TEMPLATE_TEXT, MODE_TEXT, amountText, autoTitle
   ├─ components/PersonAvatar.tsx
   ├─ components/states.tsx        ListSkeleton, ErrorState, EmptyState, StaleNote
   ├─ components/LinkDrawer.tsx    link para copiar à mão
   ├─ InviteButton.tsx             criar convite + compartilhar
   ├─ FriendsPanel.tsx             amigos, convites abertos, FriendSheet
   ├─ RankingPanel.tsx             Semana / Geral
   ├─ ChallengesPanel.tsx          lista por seção
   ├─ NewChallengeSheet.tsx        criar desafio por modelo
   ├─ ChallengeDetail.tsx          /social/desafios/:id
   ├─ FeedPanel.tsx                timeline paginada
   ├─ SocialScreen.tsx             /social/:section
   ├─ InviteScreen.tsx             /convite/:code (com e sem sessão) + InviteRoute
   ├─ PendingInviteHost.tsx
   ├─ test-social.ts               fábricas para testes (friendOf, rowOf, challengeOf, feedItemOf)
   ├─ test-drawer.tsx              Drawer simples para os testes (vaul precisa de layout real)
   └─ *.test.ts(x)                 um por módulo/tela
src/locales/*.js                   chaves novas nos 16 packs
docs/SETUP.md, docs/ROADMAP.md, spec   atualizados
```

---

### Task 1: Banco: convites, amizades e `first_friend`

**Files:**
- Create: `supabase/migrations/0004_social.sql`
- Create: `supabase/tests/helpers/social.ts`
- Modify: `supabase/tests/gamification-progress.test.ts` (1a: `stats` ganha `friends`)
- Test: `supabase/tests/social-invites.test.ts`

**Interfaces:**
- Consumes (1a, `0002_gamification.sql`): `app_now()`, `evaluate_achievements(uuid)`, corpo de `achievement_stats(uuid)`, trava `hashtextextended('xp:' || uid, 0)`; `get_my_progress()`. Helpers de teste: `freshDb`, `addUser`, `asUser` (`helpers/db.ts`); `A`, `B`, `sql`, `setClock`, `makeUser`, `ledger` (`helpers/game.ts`).
- Produces (SQL): tabelas `friend_invites(code, inviter_id, created_at, expires_at, used_by, used_at)` e `friendships(user_a, user_b, created_at)`; internas `are_friends(uuid, uuid) → boolean`, `friend_ids(uuid) → setof uuid`, `lock_users(uuid[]) → void`, `new_invite_code() → text`; RPCs `create_invite() → jsonb {code, expires_at}`, `get_invite(p_code text) → jsonb {status: 'open'|'expired'|'used'|'self'|'already_friends', expires_at, inviter: {name, avatar_url}}` (anon e authenticated), `accept_invite(p_code text) → jsonb {friend: {id, name, avatar_url}}`; `achievement_stats` com a chave `friends`.
- Produces (TS, `supabase/tests/helpers/social.ts`): `C`, `D` (uuids), `rows<T>(db, uid | null, text, params?) → T[]`, `one<T>(db, uid | null, text, params?) → T` (lê a coluna `v`), `befriend(db, a, b, at?)`, `xp(db, uid, amount, week, reason)`.

- [ ] **Step 1: Conferir a base da 1a**

```bash
git log --oneline -1
ls supabase/migrations
grep -c "create or replace function public.award_achievement" supabase/migrations/0002_gamification.sql
grep -n "create or replace function public.achievement_stats" supabase/migrations/0002_gamification.sql
```

Expected: `0001_init.sql`, `0002_gamification.sql`, `0003_gamification_cron.sql` e nenhuma `0004`;
o `grep -c` dá `1`. Abrir `achievement_stats` em `0002_gamification.sql` e comparar com o bloco
`select jsonb_build_object(...)` do Step 5 abaixo, chave por chave (`workouts`, `prs`,
`week_targets`, `best_streak`, `weigh_in_run`, `early_workouts`). Se o executor da 1a mudou alguma
dessas expressões, copiar a versão de `0002` para o Step 5 (e para a Task 4, Step 3) e só
acrescentar as chaves sociais.

- [ ] **Step 2: Helper dos testes sociais**

Criar `supabase/tests/helpers/social.ts`:

```ts
import type { PGlite } from '@electric-sql/pglite'
import { asUser } from './db'
import { sql } from './game'

export const C = '00000000-0000-0000-0000-00000000000c'
export const D = '00000000-0000-0000-0000-00000000000d'

// Runs a statement as a signed-in user (or anon with null), the way PostgREST would.
export async function rows<T = any>(db: PGlite, uid: string | null, text: string, params: unknown[] = []): Promise<T[]> {
  return (await asUser(db, uid, () => db.query<T>(text, params))).rows
}

// The value of a `select ... as v` run as that user.
export async function one<T = any>(db: PGlite, uid: string | null, text: string, params: unknown[] = []): Promise<T> {
  const [r] = await rows<{ v: T }>(db, uid, text, params)
  return r.v
}

// A friendship straight into the table (as the owner), for tests that are not about invites.
export async function befriend(db: PGlite, a: string, b: string, at = '2026-10-01T12:00:00Z') {
  const [x, y] = a < b ? [a, b] : [b, a]
  await sql(db, 'insert into public.friendships (user_a, user_b, created_at) values ($1, $2, $3)', [x, y, at])
}

// A general XP row in a given week, for ranking tests that need exact numbers.
export async function xp(db: PGlite, uid: string, amount: number, week: string, reason: string) {
  await sql(db,
    `insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start) values ($1, null, $2, $3, null, $4)`,
    [uid, amount, reason, week])
}
```

- [ ] **Step 3: Teste que falha**

Criar `supabase/tests/social-invites.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, addUser } from './helpers/db'
import { A, B, makeUser, setClock, ledger, sql } from './helpers/game'
import { C, D, befriend, one, rows } from './helpers/social'

let db: PGlite
type Invite = { code: string; expires_at: string }
const invite = (uid: string) => one<Invite>(db, uid, 'select public.create_invite() as v')
const accept = (uid: string | null, code: string) => one(db, uid, 'select public.accept_invite($1) as v', [code])
const info = (uid: string | null, code: string) => one(db, uid, 'select public.get_invite($1) as v', [code])
const pairs = (uid: string) =>
  sql<{ a: string; b: string }>(db, 'select user_a as a, user_b as b from public.friendships where $1 in (user_a, user_b) order by 1, 2', [uid])

beforeEach(async () => {
  db = await freshDb()
  await setClock(db, '2026-10-05T15:00:00Z')
  await makeUser(db, A, { display_name: 'Ana', avatar_url: 'https://img.test/ana.png', weight_kg: 61.5 })
  await makeUser(db, B, { display_name: 'Bia' })
  await makeUser(db, C, { display_name: 'Caio' })
})

describe('create_invite', () => {
  it('gives a 10-character base62 code that expires in 7 days', async () => {
    const r = await invite(A)
    expect(r.code).toMatch(/^[0-9A-Za-z]{10}$/)
    expect(new Date(r.expires_at).toISOString()).toBe('2026-10-12T15:00:00.000Z')
  })

  it('never repeats a code', async () => {
    const codes = new Set<string>()
    for (let i = 0; i < 5; i++) codes.add((await invite(A)).code)
    expect(codes.size).toBe(5)
  })

  it('allows five open invites at a time', async () => {
    for (let i = 0; i < 5; i++) await invite(A)
    await expect(invite(A)).rejects.toThrow('invite_limit')
    await setClock(db, '2026-10-12T15:00:01Z')   // all five expired
    await expect(invite(A)).resolves.toMatchObject({ code: expect.any(String) })
  })

  it('does not count used invites', async () => {
    const first = await invite(A)
    for (let i = 0; i < 4; i++) await invite(A)
    await accept(B, first.code)
    await expect(invite(A)).resolves.toMatchObject({ code: expect.any(String) })
  })

  it('needs a session and a profile', async () => {
    await expect(rows(db, null, 'select public.create_invite()')).rejects.toThrow(/permission denied/)
    await addUser(db, D)
    await expect(invite(D)).rejects.toThrow('no_profile')
  })
})

describe('get_invite', () => {
  it('shows anyone, even without a session, only who invited', async () => {
    const { code, expires_at } = await invite(A)
    expect(await info(null, code)).toEqual({
      status: 'open',
      expires_at,
      inviter: { name: 'Ana', avatar_url: 'https://img.test/ana.png' }
    })
  })

  it('tells the person opening it what state it is in', async () => {
    const { code } = await invite(A)
    expect((await info(A, code)).status).toBe('self')
    expect((await info(B, code)).status).toBe('open')
    await accept(B, code)
    expect((await info(B, code)).status).toBe('already_friends')
    expect((await info(C, code)).status).toBe('used')
    const other = await invite(A)
    await setClock(db, '2026-10-12T15:00:00Z')
    expect((await info(C, other.code)).status).toBe('expired')
  })

  it('answers the same for a malformed and an unknown code', async () => {
    await expect(info(null, 'abc')).rejects.toThrow('invite_not_found')
    await expect(info(null, 'ZZZZZZZZZZ')).rejects.toThrow('invite_not_found')
    await expect(info(null, "x' or '1'='1")).rejects.toThrow('invite_not_found')
  })
})

describe('accept_invite', () => {
  it('makes both people friends and uses the invite', async () => {
    const { code } = await invite(A)
    expect(await accept(B, code)).toEqual({ friend: { id: A, name: 'Ana', avatar_url: 'https://img.test/ana.png' } })
    expect(await pairs(A)).toEqual([{ a: A, b: B }])
    const [row] = await sql(db, 'select used_by, used_at is not null as used from public.friend_invites where code = $1', [code])
    expect(row).toEqual({ used_by: B, used: true })
  })

  it('pays first_friend once to each side and counts friends in the stats', async () => {
    await accept(B, (await invite(A)).code)
    await accept(C, (await invite(A)).code)
    for (const uid of [A, B, C]) {
      expect((await ledger(db, uid)).filter(r => r.reason === 'achievement:first_friend').map(r => r.amount), uid).toEqual([50])
    }
    const p = await one(db, A, 'select public.get_my_progress() as v')
    expect(p.stats.friends).toBe(2)
    expect(p.achievements.map((a: { code: string }) => a.code)).toContain('first_friend')
  })

  it('refuses your own invite', async () => {
    const { code } = await invite(A)
    await expect(accept(A, code)).rejects.toThrow('self_invite')
  })

  it('refuses people who are already friends', async () => {
    await befriend(db, A, B)
    const { code } = await invite(A)
    await expect(accept(B, code)).rejects.toThrow('already_friends')
  })

  it('refuses an invite someone already used', async () => {
    const { code } = await invite(A)
    await accept(B, code)
    await expect(accept(C, code)).rejects.toThrow('invite_used')
  })

  it('refuses an expired invite', async () => {
    const { code } = await invite(A)
    await setClock(db, '2026-10-12T15:00:00Z')
    await expect(accept(B, code)).rejects.toThrow('invite_expired')
  })

  it('refuses an unknown code', async () => {
    await expect(accept(B, 'ZZZZZZZZZZ')).rejects.toThrow('invite_not_found')
  })

  it('needs a session and a profile', async () => {
    const { code } = await invite(A)
    await expect(accept(null, code)).rejects.toThrow(/permission denied/)
    await addUser(db, D)
    await expect(accept(D, code)).rejects.toThrow('no_profile')
  })
})

describe('privacy of invites and friendships', () => {
  it('lets people see and cancel only their own open invites', async () => {
    const open = await invite(A)
    const used = await invite(A)
    await accept(B, used.code)
    expect(await rows(db, A, 'select code from public.friend_invites')).toHaveLength(2)
    expect(await rows(db, B, 'select code from public.friend_invites')).toEqual([])
    await rows(db, B, 'delete from public.friend_invites')
    await rows(db, A, 'delete from public.friend_invites where code = $1', [used.code])
    await rows(db, A, 'delete from public.friend_invites where code = $1', [open.code])
    expect((await sql<{ code: string }>(db, 'select code from public.friend_invites')).map(r => r.code)).toEqual([used.code])
  })

  it('never lets clients write invites or friendships directly', async () => {
    for (const q of [
      `insert into public.friend_invites (code) values ('AAAAAAAAAA')`,
      `update public.friend_invites set used_at = now()`,
      `insert into public.friendships (user_a, user_b) values ('${A}', '${B}')`,
      `update public.friendships set created_at = now()`
    ]) await expect(rows(db, A, q), q).rejects.toThrow(/permission denied/)
  })

  it('lets either friend end the friendship, and nobody else', async () => {
    await befriend(db, A, B)
    expect(await rows(db, B, 'select user_a from public.friendships')).toHaveLength(1)
    expect(await rows(db, C, 'select user_a from public.friendships')).toEqual([])
    await rows(db, C, 'delete from public.friendships')
    expect(await pairs(A)).toHaveLength(1)
    await rows(db, B, 'delete from public.friendships where user_a = $1 and user_b = $2', [A, B])
    expect(await pairs(A)).toEqual([])
  })

  it('keeps the helpers away from clients', async () => {
    for (const q of [
      `select public.are_friends('${A}', '${B}')`,
      `select public.friend_ids('${A}')`,
      `select public.lock_users(array['${A}'::uuid])`,
      `select public.new_invite_code()`,
      `select public.achievement_stats('${A}')`
    ]) await expect(rows(db, A, q), q).rejects.toThrow(/permission denied/)
  })
})
```

- [ ] **Step 4: Rodar e ver falhar**

Run: `npx vitest run supabase/tests/social-invites.test.ts`
Expected: FAIL com `function public.create_invite() does not exist`.

- [ ] **Step 5: Migration, parte 1**

Criar `supabase/migrations/0004_social.sql`:

```sql
-- Phase 1b: invites, friendships, leaderboards, challenges and the friends feed. Tables only let
-- people see (and delete) their own rows; everything friends may see goes through security definer
-- functions that check auth.uid() and the friendship first, and build the answer from the Phase 1a
-- public card (progress_card), never from profiles or app_state.

-- Invites and friendships -----------------------------------------------------------------------

create table public.friend_invites (
  code       text primary key check (code ~ '^[0-9A-Za-z]{10}$'),
  inviter_id uuid not null default auth.uid() references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  used_by    uuid references auth.users on delete set null,
  used_at    timestamptz
);
create index friend_invites_inviter on public.friend_invites (inviter_id);

create table public.friendships (
  user_a     uuid not null references auth.users on delete cascade,
  user_b     uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_a, user_b),
  check (user_a < user_b)
);
create index friendships_b on public.friendships (user_b);

alter table public.friend_invites enable row level security;
alter table public.friendships enable row level security;
create policy friend_invites_select_own on public.friend_invites for select to authenticated
  using (inviter_id = auth.uid());
create policy friend_invites_delete_open on public.friend_invites for delete to authenticated
  using (inviter_id = auth.uid() and used_at is null);
create policy friendships_select_own on public.friendships for select to authenticated
  using (auth.uid() in (user_a, user_b));
create policy friendships_delete_own on public.friendships for delete to authenticated
  using (auth.uid() in (user_a, user_b));
revoke all on public.friend_invites, public.friendships from anon;
revoke insert, update, truncate on public.friend_invites, public.friendships from authenticated;
grant select, delete on public.friend_invites, public.friendships to authenticated;

-- Helpers ----------------------------------------------------------------------------------------

create or replace function public.are_friends(p_a uuid, p_b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.friendships
                  where user_a = least(p_a, p_b) and user_b = greatest(p_a, p_b))
$$;

create or replace function public.friend_ids(p_user uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select case when user_a = p_user then user_b else user_a end
    from public.friendships where p_user in (user_a, user_b)
$$;

-- The Phase 1a XP lock of several people, always taken in uuid order, so two transactions that
-- need the same people never wait on each other in a circle.
create or replace function public.lock_users(p_users uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare
  v uuid;
begin
  for v in select distinct u from unnest(p_users) u where u is not null order by u loop
    perform pg_advisory_xact_lock(hashtextextended('xp:' || v::text, 0));
  end loop;
end $$;

-- 10 base62 characters from the server's strong random source (gen_random_uuid), ~59.5 bits.
-- Bytes 6 and 8 carry the uuid version and variant bits and are skipped; bytes from 248 up are
-- dropped so every character is equally likely.
create or replace function public.new_invite_code() returns text
language plpgsql volatile security definer set search_path = public as $$
declare
  v_alpha constant text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  v_out   text := '';
  v_bytes bytea;
  v_byte  integer;
begin
  while char_length(v_out) < 10 loop
    v_bytes := uuid_send(gen_random_uuid());
    for i in 0..15 loop
      continue when i in (6, 8);
      v_byte := get_byte(v_bytes, i);
      if v_byte < 248 and char_length(v_out) < 10 then
        v_out := v_out || substr(v_alpha, v_byte % 62 + 1, 1);
      end if;
    end loop;
  end loop;
  return v_out;
end $$;

-- Invites ------------------------------------------------------------------------------------------

create or replace function public.create_invite() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_now  timestamptz := public.app_now();
  v_code text;
begin
  if v_uid is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  if not exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'no_profile' using errcode = 'P0002';
  end if;
  -- One at a time per person, so two quick taps cannot both pass the count.
  perform pg_advisory_xact_lock(hashtextextended('invite:' || v_uid::text, 0));
  if (select count(*) from public.friend_invites
       where inviter_id = v_uid and used_at is null and expires_at > v_now) >= 5 then
    raise exception 'invite_limit' using errcode = 'P0001';
  end if;
  loop
    v_code := public.new_invite_code();
    begin
      insert into public.friend_invites (code, inviter_id, created_at, expires_at)
      values (v_code, v_uid, v_now, v_now + interval '7 days');
      exit;
    exception when unique_violation then
      -- A clash among 62^10 codes is astronomically rare; draw again rather than fail.
    end;
  end loop;
  return jsonb_build_object('code', v_code, 'expires_at', v_now + interval '7 days');
end $$;

-- Public: the invite page calls it before anyone signs in. It tells who invited and in what state
-- the invite is, nothing else. A malformed and an unknown code get the same answer.
create or replace function public.get_invite(p_code text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_me  uuid := auth.uid();
  v_inv public.friend_invites%rowtype;
begin
  if p_code is null or p_code !~ '^[0-9A-Za-z]{10}$' then
    raise exception 'invite_not_found' using errcode = 'P0002';
  end if;
  select * into v_inv from public.friend_invites where code = p_code;
  if not found then raise exception 'invite_not_found' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'status', case
      when v_me = v_inv.inviter_id then 'self'
      when v_me is not null and public.are_friends(v_me, v_inv.inviter_id) then 'already_friends'
      when v_inv.used_at is not null then 'used'
      when v_inv.expires_at <= public.app_now() then 'expired'
      else 'open' end,
    'expires_at', v_inv.expires_at,
    'inviter', (select jsonb_build_object('name', display_name, 'avatar_url', avatar_url)
                  from public.profiles where id = v_inv.inviter_id));
end $$;

create or replace function public.accept_invite(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me  uuid := auth.uid();
  v_inv public.friend_invites%rowtype;
begin
  if v_me is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  if not exists (select 1 from public.profiles where id = v_me) then
    raise exception 'no_profile' using errcode = 'P0002';
  end if;
  if p_code is null or p_code !~ '^[0-9A-Za-z]{10}$' then
    raise exception 'invite_not_found' using errcode = 'P0002';
  end if;
  select * into v_inv from public.friend_invites where code = p_code for update;
  if not found then raise exception 'invite_not_found' using errcode = 'P0002'; end if;
  if v_inv.inviter_id = v_me then raise exception 'self_invite' using errcode = 'P0001'; end if;
  if public.are_friends(v_me, v_inv.inviter_id) then raise exception 'already_friends' using errcode = 'P0001'; end if;
  if v_inv.used_at is not null then raise exception 'invite_used' using errcode = 'P0001'; end if;
  if v_inv.expires_at <= public.app_now() then raise exception 'invite_expired' using errcode = 'P0001'; end if;

  perform public.lock_users(array[v_me, v_inv.inviter_id]);
  begin
    insert into public.friendships (user_a, user_b, created_at)
    values (least(v_me, v_inv.inviter_id), greatest(v_me, v_inv.inviter_id), public.app_now());
  exception when unique_violation then
    -- Two invites between the same people accepted at the same moment.
    raise exception 'already_friends' using errcode = 'P0001';
  end;
  update public.friend_invites set used_by = v_me, used_at = public.app_now() where code = p_code;
  -- friends is an achievement metric now (achievement_stats below): first_friend for both.
  perform public.evaluate_achievements(v_me);
  perform public.evaluate_achievements(v_inv.inviter_id);
  return jsonb_build_object('friend', (
    select jsonb_build_object('id', id, 'name', display_name, 'avatar_url', avatar_url)
      from public.profiles where id = v_inv.inviter_id));
end $$;

-- Achievement metrics: Phase 1a's, plus the social ones it left for this phase -------------------

create or replace function public.achievement_stats(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'workouts', (select count(*) from public.activity_events where user_id = p_user and kind = 'workout_completed'),
    'prs', (select count(*) from public.activity_events where user_id = p_user and kind = 'pr'),
    'week_targets', (select count(*) from public.xp_ledger where user_id = p_user and reason = 'week_target'),
    'best_streak', coalesce((select best from public.streaks where user_id = p_user and kind = 'training_week'), 0),
    'weigh_in_run', coalesce((
      select max(n) from (
        select count(*) as n from (
          select d - (row_number() over (order by d))::int as grp
            from (select distinct occurred_on as d from public.activity_events
                   where user_id = p_user and kind = 'weight_logged') days
        ) runs group by grp
      ) lengths), 0),
    'early_workouts', (select count(*) from public.activity_events
                        where user_id = p_user and kind = 'workout_completed'
                          and jsonb_typeof(payload -> 'hour') = 'number' and (payload ->> 'hour')::numeric < 7),
    'friends', (select count(*) from public.friendships where p_user in (user_a, user_b))
  )
$$;

revoke all on function public.are_friends(uuid, uuid), public.friend_ids(uuid), public.lock_users(uuid[]),
  public.new_invite_code(), public.achievement_stats(uuid) from public, anon, authenticated;
revoke all on function public.create_invite(), public.accept_invite(text) from public, anon;
grant execute on function public.create_invite(), public.accept_invite(text) to authenticated;
revoke all on function public.get_invite(text) from public;
grant execute on function public.get_invite(text) to anon, authenticated;
```

- [ ] **Step 6: Teste da 1a com a métrica nova**

Em `supabase/tests/gamification-progress.test.ts`, no teste "answers with the shape the app
reads", trocar a linha de `stats` por:

```ts
      stats: { workouts: 1, prs: 1, week_targets: 0, best_streak: 0, weigh_in_run: 1, early_workouts: 0, friends: 0, level: 3 }
```

- [ ] **Step 7: Rodar e ver passar**

Run: `npx vitest run supabase/tests`
Expected: PASS em tudo, inclusive os testes da 1a (`gamification-achievements.test.ts` continua
verde: sem amizades, `friends = 0` não libera `first_friend`, e `award_achievement` manual segue
pagando uma vez).

- [ ] **Step 8: Commit**

```bash
npm run typecheck && npm test
git add supabase/migrations/0004_social.sql supabase/tests/helpers/social.ts supabase/tests/social-invites.test.ts supabase/tests/gamification-progress.test.ts
git commit -m "feat(db): friend invites, friendships and the first_friend badge

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Banco: cartões de amigos e feed

**Files:**
- Modify: `supabase/migrations/0004_social.sql` (acrescentar ao fim)
- Test: `supabase/tests/social-friends.test.ts`, `supabase/tests/social-feed.test.ts`

**Interfaces:**
- Consumes: `friend_ids`, `friendships` (Task 1); `progress_card(uuid)` (1a); `event(db, uid, kind, on, ref, payload?)`, `withoutEventWindow` (`helpers/game.ts`).
- Produces: `get_friends() → jsonb` (lista de `{ id, name, avatar_url, since, shares_activity, card }`, `card` = `progress_card`, em ordem de nome); `get_feed(p_before timestamptz default null, p_before_id bigint default null) → jsonb { items: [{ id, at, day, user: {id, name, avatar_url}, sets: int | null, prs: text[] }], next: { before, before_id } | null }`, 20 por página.

- [ ] **Step 1: Testes que falham**

Criar `supabase/tests/social-friends.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb } from './helpers/db'
import { A, B, makeUser, setClock, withoutEventWindow, event, sql } from './helpers/game'
import { C, D, befriend, one, rows } from './helpers/social'

let db: PGlite
const friends = (uid: string) => one<any[]>(db, uid, 'select public.get_friends() as v')

beforeEach(async () => {
  db = await freshDb()
  await withoutEventWindow(db)
  await setClock(db, '2026-10-07T15:00:00Z')   // Wednesday, week of 2026-10-05
  await makeUser(db, A, { display_name: 'Ana' })
  await makeUser(db, B, {
    display_name: 'Bia', avatar_url: 'https://img.test/bia.png', weight_kg: 83.4, height_cm: 181.5,
    birth_date: '1990-04-12', sex: 'female', share_activity: true
  })
  await makeUser(db, C, { display_name: 'Caio' })
  await makeUser(db, D, { display_name: 'Duda' })
  await befriend(db, A, B)
  await befriend(db, A, C)
  await event(db, B, 'workout_completed', '2026-10-05', 'b1', { sets: 18, vol: 12345.5, hour: 6 })
  await event(db, B, 'pr', '2026-10-05', 'b1:0025', { ex: '0025' })
  await event(db, B, 'weight_logged', '2026-10-06', '2026-10-06', { w: 83.4 })
  await sql(db, `insert into public.app_state (user_id, data) values ($1, '{"bodyweight":[{"w":83.4}]}')`, [B])
})

describe('get_friends', () => {
  it('lists friends by name with the public card', async () => {
    const list = await friends(A)
    expect(list.map(f => f.name)).toEqual(['Bia', 'Caio'])
    const bia = list[0]
    expect(Object.keys(bia).sort()).toEqual(['avatar_url', 'card', 'id', 'name', 'shares_activity', 'since'])
    expect(bia).toMatchObject({ id: B, avatar_url: 'https://img.test/bia.png', shares_activity: true })
    expect(Object.keys(bia.card).sort()).toEqual(['achievements', 'level', 'pillars', 'streak', 'total_xp', 'week'])
    expect(bia.card.week).toMatchObject({ start: '2026-10-05', workouts: 1, prs: 1, target: 3 })
    expect(bia.card.achievements.map((a: { code: string }) => a.code).sort()).toEqual(['first_pr', 'first_workout'])
  })

  it('never carries weight, body, diet or loads', async () => {
    const text = JSON.stringify(await friends(A))
    for (const leak of ['83.4', '181.5', '1990', 'female', '12345', 'weight', 'height', 'birth', 'vol', 'payload', 'bodyweight', 'weighed_today', 'stats']) {
      expect(text, leak).not.toContain(leak)
    }
  })

  it('shows nothing to someone who is not a friend', async () => {
    expect(await friends(D)).toEqual([])
  })

  it('keeps every private table closed between friends', async () => {
    for (const table of ['profiles', 'app_state', 'activity_events', 'xp_ledger', 'user_achievements', 'streaks', 'weekly_targets']) {
      const col = table === 'profiles' ? 'id' : 'user_id'
      expect(await rows(db, A, `select * from public.${table} where ${col} = $1`, [B]), table).toEqual([])
    }
  })

  it('needs a session', async () => {
    await expect(rows(db, null, 'select public.get_friends()')).rejects.toThrow(/permission denied/)
  })
})
```

Criar `supabase/tests/social-feed.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb } from './helpers/db'
import { A, B, makeUser, setClock, withoutEventWindow, event, sql } from './helpers/game'
import { C, D, befriend, one, rows } from './helpers/social'

let db: PGlite
type Feed = { items: any[]; next: { before: string; before_id: number } | null }
const feed = (uid: string, next: Feed['next'] = null) => next
  ? one<Feed>(db, uid, 'select public.get_feed($1::timestamptz, $2::bigint) as v', [next.before, next.before_id])
  : one<Feed>(db, uid, 'select public.get_feed() as v')

beforeEach(async () => {
  db = await freshDb()
  await withoutEventWindow(db)
  await setClock(db, '2026-10-07T15:00:00Z')
  await makeUser(db, A, { display_name: 'Ana' })
  await makeUser(db, B, { display_name: 'Bia', share_activity: true })
  await makeUser(db, C, { display_name: 'Caio', share_activity: false })
  await makeUser(db, D, { display_name: 'Duda', share_activity: true })
  await befriend(db, A, B)
  await befriend(db, A, C)
})

describe('get_feed', () => {
  it('shows workouts of friends who share, with the PRs of that session', async () => {
    await event(db, B, 'workout_completed', '2026-10-06', 'b1', { sets: 18, vol: 12345.5, hour: 6 })
    await event(db, B, 'pr', '2026-10-06', 'b1:0025', { ex: '0025' })
    await event(db, B, 'pr', '2026-10-06', 'b1:0032', { ex: '0032' })
    await event(db, B, 'weight_logged', '2026-10-06', '2026-10-06', { w: 83.4 })
    await event(db, C, 'workout_completed', '2026-10-06', 'c1', { sets: 10 })
    await event(db, D, 'workout_completed', '2026-10-06', 'd1', { sets: 12 })
    const { items, next } = await feed(A)
    expect(next).toBeNull()
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ day: '2026-10-06', user: { id: B, name: 'Bia', avatar_url: null }, sets: 18, prs: ['0025', '0032'] })
    expect(Object.keys(items[0]).sort()).toEqual(['at', 'day', 'id', 'prs', 'sets', 'user'])
  })

  it('never carries volume, hour or weight', async () => {
    await event(db, B, 'workout_completed', '2026-10-06', 'b1', { sets: 18, vol: 12345.5, hour: 6 })
    await event(db, B, 'weight_logged', '2026-10-06', '2026-10-06', { w: 83.4 })
    const text = JSON.stringify(await feed(A))
    for (const leak of ['12345', 'vol', 'hour', '83.4', '"w"']) expect(text, leak).not.toContain(leak)
  })

  it('follows the sharing switch at read time', async () => {
    await event(db, B, 'workout_completed', '2026-10-06', 'b1', { sets: 18 })
    expect((await feed(A)).items).toHaveLength(1)
    await sql(db, 'update public.profiles set share_activity = false where id = $1', [B])
    expect((await feed(A)).items).toEqual([])
  })

  it('shows nothing from people who are not friends', async () => {
    await event(db, B, 'workout_completed', '2026-10-06', 'b1', { sets: 18 })
    expect((await feed(D)).items).toEqual([])
  })

  it('pages by 20, newest first, without repeats', async () => {
    for (let i = 0; i < 25; i++) await event(db, B, 'workout_completed', '2026-10-06', 'w' + i, { sets: i })
    const first = await feed(A)
    expect(first.items).toHaveLength(20)
    expect(first.items[0].sets).toBe(24)
    expect(first.next).not.toBeNull()
    const second = await feed(A, first.next)
    expect(second.items.map((x: { sets: number }) => x.sets)).toEqual([4, 3, 2, 1, 0])
    expect(second.next).toBeNull()
  })

  it('needs a session', async () => {
    await expect(rows(db, null, 'select public.get_feed()')).rejects.toThrow(/permission denied/)
  })
})
```

Run: `npx vitest run supabase/tests/social-friends.test.ts supabase/tests/social-feed.test.ts`
Expected: FAIL com `function public.get_friends() does not exist` e `function public.get_feed() does not exist`.

- [ ] **Step 2: Implementar**

Acrescentar ao fim de `0004_social.sql`:

```sql
-- Friends ------------------------------------------------------------------------------------------

-- Friend cards: who they are and the Phase 1a public card (levels, week XP, streak, badges).
create or replace function public.get_friends() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', p.id, 'name', p.display_name, 'avatar_url', p.avatar_url,
             'since', f.created_at, 'shares_activity', p.share_activity,
             'card', public.progress_card(p.id))
           order by lower(p.display_name), p.id)
      from public.friendships f
      join public.profiles p on p.id = case when f.user_a = v_me then f.user_b else f.user_a end
     where v_me in (f.user_a, f.user_b)), '[]'::jsonb);
end $$;

-- Feed ---------------------------------------------------------------------------------------------

-- Finished workouts of friends who share (checked now, not when the workout happened), newest
-- first, 20 at a time. The PRs of a session ride along by source_ref (<session>:<exercise>):
-- only the exercise ids. The set count is the one number shown; volume, start hour and weights
-- never leave the server.
create or replace function public.get_feed(p_before timestamptz default null, p_before_id bigint default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_me    uuid := auth.uid();
  v_items jsonb;
  v_n     integer;
begin
  if v_me is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  select coalesce(jsonb_agg(x.item order by x.created_at desc, x.id desc), '[]'::jsonb), count(*)
    into v_items, v_n
    from (
      select e.id, e.created_at, jsonb_build_object(
               'id', e.id, 'at', e.created_at, 'day', e.occurred_on,
               'user', jsonb_build_object('id', p.id, 'name', p.display_name, 'avatar_url', p.avatar_url),
               'sets', case when jsonb_typeof(e.payload -> 'sets') = 'number'
                            then least(greatest((e.payload ->> 'sets')::numeric, 0), 999)::int end,
               'prs', coalesce((
                 select jsonb_agg(left(pr.payload ->> 'ex', 40) order by pr.id)
                   from public.activity_events pr
                  where pr.user_id = e.user_id and pr.kind = 'pr'
                    and jsonb_typeof(pr.payload -> 'ex') = 'string'
                    and left(pr.source_ref, char_length(e.source_ref) + 1) = e.source_ref || ':'), '[]'::jsonb)
             ) as item
        from public.activity_events e
        join public.profiles p on p.id = e.user_id
       where e.kind = 'workout_completed'
         and p.share_activity
         and e.user_id in (select public.friend_ids(v_me))
         and (p_before is null
              or (e.created_at, e.id) < (p_before, coalesce(p_before_id, 9223372036854775807)))
       order by e.created_at desc, e.id desc
       limit 20
    ) x;
  return jsonb_build_object(
    'items', v_items,
    'next', case when v_n = 20 then
      jsonb_build_object('before', v_items -> 19 -> 'at', 'before_id', v_items -> 19 -> 'id') end);
end $$;

revoke all on function public.get_friends(), public.get_feed(timestamptz, bigint) from public, anon;
grant execute on function public.get_friends(), public.get_feed(timestamptz, bigint) to authenticated;
```

- [ ] **Step 3: Rodar e ver passar**

Run: `npx vitest run supabase/tests/social-friends.test.ts supabase/tests/social-feed.test.ts`
Expected: PASS. Se a paginação repetir ou pular itens, conferir que o cursor compara o par
`(created_at, id)` (o desempate por `id` segue a ordem de inserção).

- [ ] **Step 4: Commit**

```bash
npm run typecheck && npm test
git add supabase/migrations/0004_social.sql supabase/tests/social-friends.test.ts supabase/tests/social-feed.test.ts
git commit -m "feat(db): friend cards and the opt-in workout feed

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Banco: desafios (criar, entrar, sair, progresso)

**Files:**
- Modify: `supabase/migrations/0004_social.sql` (acrescentar ao fim)
- Modify: `supabase/tests/helpers/social.ts` (acrescentar `challengeArgs`, `createChallenge`)
- Test: `supabase/tests/social-challenges.test.ts`

**Interfaces:**
- Consumes: `are_friends` (Task 1); `local_today`, `week_start_of`, `app_now` (1a); `event`, `withoutEventWindow`, `makeUser`, `setClock`, `sql` (`helpers/game.ts`).
- Produces:
  - tabelas `challenges(id, template, title, mode, target, starts_on, ends_on, created_by, status, created_at, closed_at)` e `challenge_members(challenge_id, user_id, invited_by, joined_at (null = convidado), share_volume, final, won)`;
  - `is_challenge_member(uuid) → boolean` (usado pelas policies; executável por `authenticated`);
  - internas `challenge_progress(p_challenge uuid, p_user uuid) → numeric`, `challenge_json(p_challenge uuid, p_me uuid) → jsonb`;
  - RPCs `create_challenge(p_template text, p_title text, p_mode text, p_target numeric, p_starts_on date, p_ends_on date, p_invitees uuid[], p_share_volume boolean default false) → jsonb {id}`, `join_challenge(p_id uuid, p_share_volume boolean default false) → void`, `leave_challenge(p_id uuid) → void`, `get_challenges() → jsonb`;
  - formato de cada desafio em `get_challenges`: `{ id, template, title, mode, target, starts_on, ends_on, status, created_by, invited_by (nome de quem me convidou ou null), total, me: {joined, won}, members: [{ id, name, avatar_url, me, joined, progress (null para convidado), won }] }`, membros em ordem: quem entrou, maior progresso, nome.
- Produces (TS, testes): `challengeArgs(over?)`, `createChallenge(db, uid, over?) → Promise<string>`.

- [ ] **Step 1: Helper de criação**

Acrescentar ao fim de `supabase/tests/helpers/social.ts`:

```ts
export type ChallengeArgs = {
  template: string; title: string; mode: string; target: number
  starts_on: string; ends_on: string; invitees: string[]; share_volume: boolean
}

// Two weeks from Monday 2026-10-05, team, 6 workouts, Bia invited.
export const challengeArgs = (over: Partial<ChallengeArgs> = {}): ChallengeArgs => ({
  template: 'workouts_count', title: 'Outubro forte', mode: 'team', target: 6,
  starts_on: '2026-10-05', ends_on: '2026-10-18', invitees: ['00000000-0000-0000-0000-00000000000b'],
  share_volume: false, ...over
})

export async function createChallenge(db: PGlite, uid: string, over: Partial<ChallengeArgs> = {}): Promise<string> {
  const a = challengeArgs(over)
  const r = await one<{ id: string }>(db, uid,
    'select public.create_challenge($1, $2, $3, $4::numeric, $5::date, $6::date, $7::uuid[], $8) as v',
    [a.template, a.title, a.mode, a.target, a.starts_on, a.ends_on, '{' + a.invitees.join(',') + '}', a.share_volume])
  return r.id
}
```

- [ ] **Step 2: Teste que falha**

Criar `supabase/tests/social-challenges.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb } from './helpers/db'
import { A, B, makeUser, setClock, withoutEventWindow, event, sql } from './helpers/game'
import { C, D, befriend, createChallenge, one, rows } from './helpers/social'

let db: PGlite
const list = (uid: string) => one<any[]>(db, uid, 'select public.get_challenges() as v')
const join = (uid: string, id: string, share = false) => rows(db, uid, 'select public.join_challenge($1, $2)', [id, share])
const leave = (uid: string, id: string) => rows(db, uid, 'select public.leave_challenge($1)', [id])
const progressByName = (c: { members: { name: string; progress: number | null }[] }) =>
  Object.fromEntries(c.members.map(m => [m.name, m.progress]))

beforeEach(async () => {
  db = await freshDb()
  await withoutEventWindow(db)
  await setClock(db, '2026-10-05T15:00:00Z')   // Monday
  await makeUser(db, A, { display_name: 'Ana' })
  await makeUser(db, B, { display_name: 'Bia' })
  await makeUser(db, C, { display_name: 'Caio' })
  await makeUser(db, D, { display_name: 'Duda' })
  await befriend(db, A, B)
  await befriend(db, A, C)
})

describe('create_challenge', () => {
  it('puts the creator in, invites the friends and shows it to members only', async () => {
    const id = await createChallenge(db, A, { invitees: [B, C] })
    const [mine] = await list(A)
    expect(mine).toMatchObject({
      id, template: 'workouts_count', title: 'Outubro forte', mode: 'team', target: 6,
      starts_on: '2026-10-05', ends_on: '2026-10-18', status: 'active', created_by: A,
      invited_by: null, total: 0, me: { joined: true, won: null }
    })
    expect(mine.members.map((m: any) => [m.name, m.me, m.joined, m.progress]))
      .toEqual([['Ana', true, true, 0], ['Bia', false, false, null], ['Caio', false, false, null]])
    const [theirs] = await list(B)
    expect(theirs).toMatchObject({ id, invited_by: 'Ana', me: { joined: false, won: null } })
    expect(await list(D)).toEqual([])
    expect(await rows(db, D, 'select id from public.challenges')).toEqual([])
    expect(await rows(db, D, 'select user_id from public.challenge_members')).toEqual([])
    expect(await rows(db, B, 'select id from public.challenges')).toHaveLength(1)
    expect(await rows(db, B, 'select user_id from public.challenge_members')).toHaveLength(3)
  })

  it('invites only friends of the creator', async () => {
    await expect(createChallenge(db, A, { invitees: [B, D] })).rejects.toThrow('not_friends')
    await expect(createChallenge(db, B, { invitees: [C] })).rejects.toThrow('not_friends')
  })

  it.each([
    { template: 'weeks_on_target', mode: 'team', target: 1 },
    { template: 'chess' },
    { mode: 'duo' },
    { title: '   ' },
    { title: 'x'.repeat(61) },
    { ends_on: '2026-10-10' },                              // 6 days
    { ends_on: '2027-01-05' },                              // 93 days
    { starts_on: '2026-10-04', ends_on: '2026-10-17' },     // yesterday
    { starts_on: '2026-11-05', ends_on: '2026-11-18' },     // 31 days ahead
    { target: 0 },
    { target: 2.5 },
    { target: 501 },
    { template: 'volume_total', target: 5001, share_volume: true },
    { template: 'weeks_on_target', mode: 'solo', target: 3 }, // the period touches 2 weeks
    { invitees: [] },
    { invitees: [A] }
  ])('refuses %j', async over => {
    await expect(createChallenge(db, A, over)).rejects.toThrow('invalid_challenge')
  })

  it('accepts the edges: 7 and 92 days, starting in 30 days, 19 friends', async () => {
    await createChallenge(db, A, { ends_on: '2026-10-11' })
    await createChallenge(db, A, { ends_on: '2027-01-04' })
    await createChallenge(db, A, { starts_on: '2026-11-04', ends_on: '2026-11-10' })
    await createChallenge(db, A, { template: 'weeks_on_target', mode: 'solo', target: 2 })
    const many: string[] = []
    for (let i = 0; i < 20; i++) {
      const id = `00000000-0000-0000-0000-0000000002${String(i).padStart(2, '0')}`
      await makeUser(db, id, { display_name: 'P' + i })
      await befriend(db, A, id)
      many.push(id)
    }
    await createChallenge(db, A, { invitees: many.slice(0, 19) })
    await expect(createChallenge(db, A, { invitees: many })).rejects.toThrow('invalid_challenge')
  })

  it('asks the creator to agree to share volume', async () => {
    await expect(createChallenge(db, A, { template: 'volume_total', target: 10 })).rejects.toThrow('volume_opt_in_required')
    const id = await createChallenge(db, A, { template: 'volume_total', target: 10, share_volume: true })
    const [m] = await sql(db, 'select share_volume from public.challenge_members where challenge_id = $1 and user_id = $2', [id, A])
    expect(m.share_volume).toBe(true)
  })

  it('keeps ten active challenges per creator', async () => {
    for (let i = 0; i < 10; i++) await createChallenge(db, A, { title: 'D' + i })
    await expect(createChallenge(db, A)).rejects.toThrow('challenge_limit')
  })

  it('needs a session', async () => {
    await expect(rows(db, null, 'select public.get_challenges()')).rejects.toThrow(/permission denied/)
    await expect(rows(db, null, `select public.create_challenge('workouts_count', 'x', 'team', 6, '2026-10-05', '2026-10-18', array['${B}'::uuid])`))
      .rejects.toThrow(/permission denied/)
  })
})

describe('join and leave', () => {
  it('lets an invited friend join, once', async () => {
    const id = await createChallenge(db, A)
    await join(B, id)
    await join(B, id)
    expect((await list(B))[0].me).toEqual({ joined: true, won: null })
  })

  it('asks for the volume opt-in when joining a volume challenge', async () => {
    const id = await createChallenge(db, A, { template: 'volume_total', target: 10, share_volume: true })
    await expect(join(B, id)).rejects.toThrow('volume_opt_in_required')
    await join(B, id, true)
    const [m] = await sql(db, 'select share_volume from public.challenge_members where challenge_id = $1 and user_id = $2', [id, B])
    expect(m.share_volume).toBe(true)
  })

  it('is invisible to whoever was not invited', async () => {
    const id = await createChallenge(db, A)
    await expect(join(D, id)).rejects.toThrow('challenge_not_found')
    await expect(join(C, id)).rejects.toThrow('challenge_not_found')
    await expect(leave(D, id)).rejects.toThrow('challenge_not_found')
  })

  it('lets an invited person decline', async () => {
    const id = await createChallenge(db, A, { invitees: [B, C] })
    await leave(C, id)
    expect(await list(C)).toEqual([])
    expect((await list(A))[0].members.map((m: any) => m.name)).toEqual(['Ana', 'Bia'])
  })

  it('deletes the challenge when the last participant leaves', async () => {
    const id = await createChallenge(db, A)
    await join(B, id)
    await leave(A, id)
    expect(await list(A)).toEqual([])
    expect((await list(B))[0].members.map((m: any) => m.name)).toEqual(['Bia'])
    await leave(B, id)
    expect(await sql(db, 'select count(*)::int as n from public.challenges')).toEqual([{ n: 0 }])
  })

  it('refuses to join or leave after the end', async () => {
    const id = await createChallenge(db, A)
    await setClock(db, '2026-10-19T15:00:00Z')
    await expect(join(B, id)).rejects.toThrow('challenge_closed')
    await expect(leave(A, id)).rejects.toThrow('challenge_closed')
  })
})

describe('progress', () => {
  it('counts the workouts of people who joined, inside the period', async () => {
    const id = await createChallenge(db, A, { invitees: [B, C] })
    await join(B, id)
    await event(db, A, 'workout_completed', '2026-10-05', 'a1')
    await event(db, A, 'workout_completed', '2026-10-06', 'a2')
    await event(db, B, 'workout_completed', '2026-10-07', 'b1')
    await event(db, B, 'workout_completed', '2026-10-04', 'before')
    await event(db, B, 'workout_completed', '2026-10-19', 'after')
    await event(db, C, 'workout_completed', '2026-10-06', 'c1')
    const [c] = await list(A)
    expect(progressByName(c)).toEqual({ Ana: 2, Bia: 1, Caio: null })
    expect(c.total).toBe(3)
  })

  it('counts weeks with the goal met for weeks_on_target', async () => {
    const id = await createChallenge(db, A, { template: 'weeks_on_target', mode: 'solo', target: 2 })
    await join(B, id)
    for (const d of ['2026-09-28', '2026-09-29', '2026-09-30']) await event(db, A, 'workout_completed', d, 'old' + d)
    for (const d of ['2026-10-05', '2026-10-06', '2026-10-07']) await event(db, A, 'workout_completed', d, d)
    await event(db, B, 'workout_completed', '2026-10-05', 'b1')
    expect(progressByName((await list(A))[0])).toEqual({ Ana: 1, Bia: 0 })
  })

  it('adds volume in tonnes, converting pounds and capping forged numbers', async () => {
    await sql(db, `update public.profiles set unit = 'lb' where id = $1`, [B])
    const id = await createChallenge(db, A, { template: 'volume_total', target: 10, share_volume: true })
    await join(B, id, true)
    await event(db, A, 'workout_completed', '2026-10-05', 'a1', { vol: 1500 })
    await event(db, A, 'workout_completed', '2026-10-06', 'a2', { vol: 999999 })
    await event(db, B, 'workout_completed', '2026-10-05', 'b1', { vol: 2204.6 })
    await event(db, B, 'workout_completed', '2026-10-06', 'b2', { vol: 'lots' })
    const [c] = await list(A)
    expect(progressByName(c)).toEqual({ Ana: 101.5, Bia: 1 })
    expect(c.total).toBe(102.5)
  })

  it('keeps the internal challenge functions away from clients', async () => {
    const id = await createChallenge(db, A)
    for (const q of [`select public.challenge_progress('${id}', '${A}')`, `select public.challenge_json('${id}', '${A}')`]) {
      await expect(rows(db, A, q), q).rejects.toThrow(/permission denied/)
    }
  })
})
```

Run: `npx vitest run supabase/tests/social-challenges.test.ts`
Expected: FAIL com `function public.create_challenge(...) does not exist`.

- [ ] **Step 3: Implementar**

Acrescentar ao fim de `0004_social.sql`:

```sql
-- Challenges ---------------------------------------------------------------------------------------

create table public.challenges (
  id         uuid primary key default gen_random_uuid(),
  template   text not null check (template in ('workouts_count', 'weeks_on_target', 'volume_total')),
  title      text not null check (char_length(title) between 1 and 60),
  mode       text not null check (mode in ('team', 'solo')),
  target     numeric not null check (target > 0),
  starts_on  date not null,
  -- 7 to 92 days, both ends included.
  ends_on    date not null check (ends_on - starts_on between 6 and 91),
  created_by uuid not null default auth.uid() references auth.users on delete cascade,
  status     text not null default 'active' check (status in ('active', 'won', 'lost', 'cancelled')),
  created_at timestamptz not null default now(),
  closed_at  timestamptz,
  check (template <> 'weeks_on_target' or mode = 'solo')
);
create index challenges_active on public.challenges (ends_on) where status = 'active';

create table public.challenge_members (
  challenge_id uuid not null references public.challenges on delete cascade,
  user_id      uuid not null references auth.users on delete cascade,
  invited_by   uuid references auth.users on delete set null,
  joined_at    timestamptz,              -- null: invited, has not answered yet
  share_volume boolean not null default false,
  final        numeric,                  -- progress frozen when the challenge closed
  won          boolean,
  primary key (challenge_id, user_id)
);
create index challenge_members_user on public.challenge_members (user_id);

-- Used by the policies below; security definer so the policy on challenge_members does not
-- recurse into itself.
create or replace function public.is_challenge_member(p_challenge uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.challenge_members
                  where challenge_id = p_challenge and user_id = auth.uid())
$$;

alter table public.challenges enable row level security;
alter table public.challenge_members enable row level security;
create policy challenges_select_members on public.challenges for select to authenticated
  using (public.is_challenge_member(id));
create policy challenge_members_select on public.challenge_members for select to authenticated
  using (public.is_challenge_member(challenge_id));
revoke all on public.challenges, public.challenge_members from anon;
revoke insert, update, delete, truncate on public.challenges, public.challenge_members from authenticated;
grant select on public.challenges, public.challenge_members to authenticated;

-- Where each template's numbers come from (Decision 11): workouts_count counts finished workouts
-- in the period; weeks_on_target counts the weeks touching the period whose goal was met (Phase 1a
-- writes one 'week_target' ledger row per such week); volume_total adds up the volume of the
-- workouts (each capped at 100 000, in the member's unit, pounds converted) in tonnes.
create or replace function public.challenge_progress(p_challenge uuid, p_user uuid) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare
  c public.challenges%rowtype;
  v numeric;
begin
  select * into c from public.challenges where id = p_challenge;
  if not found then return null; end if;
  if c.template = 'workouts_count' then
    select count(*) into v from public.activity_events
     where user_id = p_user and kind = 'workout_completed' and occurred_on between c.starts_on and c.ends_on;
  elsif c.template = 'weeks_on_target' then
    select count(*) into v from public.xp_ledger
     where user_id = p_user and reason = 'week_target'
       and week_start between public.week_start_of(c.starts_on) and c.ends_on;
  else
    select coalesce(sum(least(greatest((payload ->> 'vol')::numeric, 0), 100000)), 0) into v
      from public.activity_events
     where user_id = p_user and kind = 'workout_completed' and occurred_on between c.starts_on and c.ends_on
       and jsonb_typeof(payload -> 'vol') = 'number';
    v := round(v * (case when (select unit from public.profiles where id = p_user) = 'lb'
                         then 0.45359237 else 1 end) / 1000, 1);
  end if;
  return v;
end $$;

-- One challenge as its members see it: live progress while active, the frozen one after.
create or replace function public.challenge_json(p_challenge uuid, p_me uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with c as (select * from public.challenges where id = p_challenge),
  m as (
    select cm.user_id, cm.joined_at is not null as joined, cm.won, cm.invited_by, p.display_name, p.avatar_url,
           case when cm.joined_at is null then null
                when (select status from c) = 'active' then public.challenge_progress(p_challenge, cm.user_id)
                else cm.final end as progress
      from public.challenge_members cm
      join public.profiles p on p.id = cm.user_id
     where cm.challenge_id = p_challenge)
  select jsonb_build_object(
    'id', c.id, 'template', c.template, 'title', c.title, 'mode', c.mode, 'target', c.target,
    'starts_on', c.starts_on, 'ends_on', c.ends_on, 'status', c.status, 'created_by', c.created_by,
    'invited_by', (select pr.display_name from m join public.profiles pr on pr.id = m.invited_by where m.user_id = p_me),
    'total', coalesce((select sum(progress) from m where joined), 0),
    'me', (select jsonb_build_object('joined', joined, 'won', won) from m where user_id = p_me),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', user_id, 'name', display_name, 'avatar_url', avatar_url, 'me', user_id = p_me,
               'joined', joined, 'progress', progress, 'won', won)
             order by joined desc, progress desc nulls last, lower(display_name), user_id)
        from m), '[]'::jsonb))
  from c
$$;

create or replace function public.create_challenge(
  p_template text, p_title text, p_mode text, p_target numeric, p_starts_on date, p_ends_on date,
  p_invitees uuid[], p_share_volume boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me     uuid := auth.uid();
  v_title  text := btrim(coalesce(p_title, ''));
  v_today  date;
  v_people uuid[];
  v_id     uuid;
begin
  if v_me is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  if not exists (select 1 from public.profiles where id = v_me) then
    raise exception 'no_profile' using errcode = 'P0002';
  end if;
  v_today := public.local_today(v_me);
  select coalesce(array_agg(distinct u), '{}') into v_people
    from unnest(coalesce(p_invitees, '{}'::uuid[])) u where u is not null and u <> v_me;

  -- Same rules as checkChallenge in src/features/social/templates.ts.
  if p_template is null or p_template not in ('workouts_count', 'weeks_on_target', 'volume_total')
     or p_mode is null or p_mode not in ('team', 'solo')
     or (p_template = 'weeks_on_target' and p_mode <> 'solo')
     or char_length(v_title) not between 1 and 60
     or p_starts_on is null or p_ends_on is null
     or p_ends_on - p_starts_on not between 6 and 91
     or p_starts_on < v_today or p_starts_on > v_today + 30
     or p_target is null or p_target <> trunc(p_target) or p_target < 1
     or (p_template = 'workouts_count' and p_target > 500)
     or (p_template = 'volume_total' and p_target > 5000)
     or (p_template = 'weeks_on_target'
         and p_target > (public.week_start_of(p_ends_on) - public.week_start_of(p_starts_on)) / 7 + 1)
     or cardinality(v_people) not between 1 and 19 then
    raise exception 'invalid_challenge' using errcode = 'P0001';
  end if;
  if exists (select 1 from unnest(v_people) u where not public.are_friends(v_me, u)) then
    raise exception 'not_friends' using errcode = 'P0001';
  end if;
  if p_template = 'volume_total' and not coalesce(p_share_volume, false) then
    raise exception 'volume_opt_in_required' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('challenge-create:' || v_me::text, 0));
  if (select count(*) from public.challenges where created_by = v_me and status = 'active') >= 10 then
    raise exception 'challenge_limit' using errcode = 'P0001';
  end if;

  insert into public.challenges (template, title, mode, target, starts_on, ends_on, created_by)
  values (p_template, v_title, p_mode, p_target, p_starts_on, p_ends_on, v_me)
  returning id into v_id;
  insert into public.challenge_members (challenge_id, user_id, invited_by, joined_at, share_volume)
  values (v_id, v_me, null, public.app_now(), p_template = 'volume_total');
  insert into public.challenge_members (challenge_id, user_id, invited_by)
  select v_id, u, v_me from unnest(v_people) u;
  return jsonb_build_object('id', v_id);
end $$;

create or replace function public.join_challenge(p_id uuid, p_share_volume boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_c  public.challenges%rowtype;
  v_m  public.challenge_members%rowtype;
begin
  if v_me is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  select * into v_m from public.challenge_members where challenge_id = p_id and user_id = v_me for update;
  if not found then raise exception 'challenge_not_found' using errcode = 'P0002'; end if;
  select * into v_c from public.challenges where id = p_id;
  if v_c.status <> 'active' or public.local_today(v_c.created_by) > v_c.ends_on then
    raise exception 'challenge_closed' using errcode = 'P0001';
  end if;
  if v_m.joined_at is not null then return; end if;
  if v_c.template = 'volume_total' and not coalesce(p_share_volume, false) then
    raise exception 'volume_opt_in_required' using errcode = 'P0001';
  end if;
  update public.challenge_members
     set joined_at = public.app_now(), share_volume = (v_c.template = 'volume_total')
   where challenge_id = p_id and user_id = v_me;
end $$;

-- An invited person who leaves declines; a participant who leaves is out. A challenge nobody is
-- in any more goes away.
create or replace function public.leave_challenge(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_c  public.challenges%rowtype;
begin
  if v_me is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  if not exists (select 1 from public.challenge_members where challenge_id = p_id and user_id = v_me) then
    raise exception 'challenge_not_found' using errcode = 'P0002';
  end if;
  select * into v_c from public.challenges where id = p_id for update;
  if v_c.status <> 'active' or public.local_today(v_c.created_by) > v_c.ends_on then
    raise exception 'challenge_closed' using errcode = 'P0001';
  end if;
  delete from public.challenge_members where challenge_id = p_id and user_id = v_me;
  if not exists (select 1 from public.challenge_members where challenge_id = p_id and joined_at is not null) then
    delete from public.challenges where id = p_id;
  end if;
end $$;

-- Active first (invitations on top, then by end date), then the ones closed in the last 60 days.
create or replace function public.get_challenges() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  if not exists (select 1 from public.profiles where id = v_me) then
    raise exception 'no_profile' using errcode = 'P0002';
  end if;
  return coalesce((
    select jsonb_agg(public.challenge_json(c.id, v_me)
             order by (c.status = 'active') desc, (m.joined_at is null) desc,
                      case when c.status = 'active' then c.ends_on end, c.closed_at desc nulls last, c.id)
      from public.challenges c
      join public.challenge_members m on m.challenge_id = c.id and m.user_id = v_me
     where c.status = 'active' or c.closed_at > public.app_now() - interval '60 days'), '[]'::jsonb);
end $$;

revoke all on function public.challenge_progress(uuid, uuid), public.challenge_json(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.is_challenge_member(uuid),
  public.create_challenge(text, text, text, numeric, date, date, uuid[], boolean),
  public.join_challenge(uuid, boolean), public.leave_challenge(uuid), public.get_challenges()
  from public, anon;
grant execute on function public.is_challenge_member(uuid),
  public.create_challenge(text, text, text, numeric, date, date, uuid[], boolean),
  public.join_challenge(uuid, boolean), public.leave_challenge(uuid), public.get_challenges()
  to authenticated;
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run supabase/tests/social-challenges.test.ts`
Expected: PASS. Se o PGlite devolver `target`/`progress` como string dentro do `jsonb` (não deve:
`numeric` vira número JSON), parar e revisar o `jsonb_build_object` em vez de mudar o teste.

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npm test
git add supabase/migrations/0004_social.sql supabase/tests/helpers/social.ts supabase/tests/social-challenges.test.ts
git commit -m "feat(db): challenges by template with invitations among friends

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Banco: fechamento, +300, rankings e cron

**Files:**
- Modify: `supabase/migrations/0004_social.sql` (substituir `achievement_stats` e `get_challenges`; acrescentar ao fim)
- Create: `supabase/migrations/0005_social_cron.sql`
- Modify: `supabase/tests/gamification-progress.test.ts` (1a: `stats` ganha `challenges_won`)
- Modify: `docs/SETUP.md`
- Test: `supabase/tests/social-close.test.ts`, `supabase/tests/social-leaderboard.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3; `award_bonus_xp`, `evaluate_achievements`, `week_xp`, `total_xp`, `local_week_start`, `level_for` (1a); `ledger` (`helpers/game.ts`); `xp` (`helpers/social.ts`).
- Produces:
  - internas `close_challenge(uuid) → boolean`, `close_due_challenges(p_user uuid) → integer`, `close_all_challenges() → integer`, `leaderboard_json(p_me uuid, p_kind text) → jsonb`;
  - `achievement_stats` com `challenges_won`;
  - `get_challenges` fecha os desafios vencidos do usuário antes de responder;
  - RPCs `get_weekly_leaderboard() → jsonb` e `get_alltime_leaderboard() → jsonb`, ambas `{ week_start, rows: [{ id, name, avatar_url, me, xp, level, pos, prev_pos, gap }] }` (`xp` = XP da semana local de cada um na semanal, XP total na geral);
  - razão de ledger `'challenge:<uuid>'` (+300); job `pg_cron` `close-challenges`, `15 6 * * *`.

- [ ] **Step 1: Testes que falham**

Criar `supabase/tests/social-close.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb } from './helpers/db'
import { A, B, makeUser, setClock, withoutEventWindow, event, ledger, sql } from './helpers/game'
import { C, D, befriend, createChallenge, one, rows } from './helpers/social'

let db: PGlite
const list = (uid: string) => one<any[]>(db, uid, 'select public.get_challenges() as v')
const join = (uid: string, id: string) => rows(db, uid, 'select public.join_challenge($1, false)', [id])
const bonus = async (uid: string) => (await ledger(db, uid)).filter(r => r.reason.startsWith('challenge:')).map(r => r.amount)
const statusOf = async (id: string) => (await sql<{ status: string }>(db, 'select status from public.challenges where id = $1', [id]))[0].status
const afterEnd = () => setClock(db, '2026-10-19T15:00:00Z')   // ends_on 2026-10-18

// Ana 2 workouts, Bia 1, inside the period.
async function trainBoth() {
  await event(db, A, 'workout_completed', '2026-10-05', 'a1')
  await event(db, A, 'workout_completed', '2026-10-06', 'a2')
  await event(db, B, 'workout_completed', '2026-10-07', 'b1')
}

beforeEach(async () => {
  db = await freshDb()
  await withoutEventWindow(db)
  await setClock(db, '2026-10-05T15:00:00Z')
  await makeUser(db, A, { display_name: 'Ana' })
  await makeUser(db, B, { display_name: 'Bia' })
  await makeUser(db, C, { display_name: 'Caio' })
  await makeUser(db, D, { display_name: 'Duda' })
  await befriend(db, A, B)
  await befriend(db, A, C)
})

describe('closing a challenge', () => {
  it('pays 300 to every member when the team reaches the goal, once', async () => {
    const id = await createChallenge(db, A, { invitees: [B, C], target: 3 })
    await join(B, id)
    await trainBoth()
    await afterEnd()
    const [c] = await list(A)
    expect(c).toMatchObject({ status: 'won', total: 3, me: { joined: true, won: true } })
    expect(c.members.map((m: any) => [m.name, m.progress, m.won])).toEqual([['Ana', 2, true], ['Bia', 1, true]])
    expect(await bonus(A)).toEqual([300])
    expect(await bonus(B)).toEqual([300])
    expect(await bonus(C)).toEqual([])
    expect((await ledger(db, A)).find(r => r.reason.startsWith('challenge:'))).toMatchObject({ reason: 'challenge:' + id, week_start: '2026-10-19', pillar: null })
    await list(B)
    await sql(db, 'select public.close_all_challenges()')
    expect(await bonus(A)).toEqual([300])
  })

  it('unlocks challenge_first and counts challenges_won', async () => {
    const id = await createChallenge(db, A, { target: 3 })
    await join(B, id)
    await trainBoth()
    await afterEnd()
    await list(A)
    expect((await ledger(db, A)).filter(r => r.reason === 'achievement:challenge_first').map(r => r.amount)).toEqual([200])
    const p = await one(db, A, 'select public.get_my_progress() as v')
    expect(p.stats.challenges_won).toBe(1)
    expect(p.achievements.map((a: { code: string }) => a.code)).toContain('challenge_first')
  })

  it('pays nothing when the team misses the goal', async () => {
    const id = await createChallenge(db, A, { target: 10 })
    await join(B, id)
    await trainBoth()
    await afterEnd()
    expect((await list(A))[0]).toMatchObject({ status: 'lost', me: { won: false } })
    expect(await bonus(A)).toEqual([])
    expect(await bonus(B)).toEqual([])
  })

  it('pays only who reached the goal in solo', async () => {
    const id = await createChallenge(db, A, { mode: 'solo', target: 2 })
    await join(B, id)
    await trainBoth()
    await afterEnd()
    const [c] = await list(B)
    expect(c).toMatchObject({ status: 'won', me: { joined: true, won: false } })
    expect(c.members.map((m: any) => [m.name, m.won])).toEqual([['Ana', true], ['Bia', false]])
    expect(await bonus(A)).toEqual([300])
    expect(await bonus(B)).toEqual([])
  })

  it('is lost in solo when nobody reached the goal', async () => {
    const id = await createChallenge(db, A, { mode: 'solo', target: 5 })
    await join(B, id)
    await trainBoth()
    await afterEnd()
    expect(await statusOf(id)).toBe('active')
    await list(A)
    expect(await statusOf(id)).toBe('lost')
  })

  it('is cancelled when fewer than two people joined', async () => {
    const id = await createChallenge(db, A, { invitees: [B, C], target: 1 })
    await trainBoth()
    await afterEnd()
    const [c] = await list(A)
    expect(c).toMatchObject({ status: 'cancelled' })
    expect(c.members.map((m: any) => m.name)).toEqual(['Ana'])
    expect(await bonus(A)).toEqual([])
  })

  it('waits for the day after the end in the creator time zone', async () => {
    const id = await createChallenge(db, A, { target: 1 })
    await join(B, id)
    await trainBoth()
    await setClock(db, '2026-10-19T02:30:00Z')   // still Sunday 18 in São Paulo
    await list(A)
    expect(await statusOf(id)).toBe('active')
    await setClock(db, '2026-10-19T03:30:00Z')   // Monday 19, 00:30 in São Paulo
    await list(A)
    expect(await statusOf(id)).toBe('won')
  })

  it('is closed by either ranking too', async () => {
    const id = await createChallenge(db, A, { target: 3 })
    await join(B, id)
    await trainBoth()
    await afterEnd()
    await one(db, B, 'select public.get_weekly_leaderboard() as v')
    expect(await statusOf(id)).toBe('won')
  })

  it('close_all_challenges closes every due challenge and only those', async () => {
    const due = await createChallenge(db, A, { target: 1 })
    const later = await createChallenge(db, A, { target: 1, ends_on: '2026-10-25' })
    await join(B, due)
    await join(B, later)
    await afterEnd()
    expect(await sql(db, 'select public.close_all_challenges() as n')).toEqual([{ n: 1 }])
    // Bia joined both and nobody trained: the due one is lost, the other one keeps going.
    expect([await statusOf(due), await statusOf(later)]).toEqual(['lost', 'active'])
  })

  it('gives challenge_won_5 after five wins', async () => {
    for (let i = 0; i < 5; i++) {
      const id = await createChallenge(db, A, { title: 'D' + i, target: 1, ends_on: '2026-10-11' })
      await join(B, id)
    }
    await event(db, A, 'workout_completed', '2026-10-05', 'a1')
    await setClock(db, '2026-10-12T15:00:00Z')
    await list(A)
    const reasons = (await ledger(db, A)).map(r => r.reason)
    expect(reasons.filter(r => r.startsWith('challenge:'))).toHaveLength(5)
    expect(reasons.filter(r => r === 'achievement:challenge_first')).toHaveLength(1)
    expect(reasons.filter(r => r === 'achievement:challenge_won_5')).toHaveLength(1)
  })

  it('keeps the closing functions away from clients', async () => {
    const id = await createChallenge(db, A)
    for (const q of [
      `select public.close_challenge('${id}')`,
      `select public.close_due_challenges('${A}')`,
      `select public.close_all_challenges()`,
      `select public.leaderboard_json('${A}', 'week')`
    ]) await expect(rows(db, A, q), q).rejects.toThrow(/permission denied/)
  })

  it('skips pg_cron where the extension does not exist', async () => {
    expect(await sql(db, `select count(*)::int as n from pg_extension where extname = 'pg_cron'`)).toEqual([{ n: 0 }])
  })
})
```

Criar `supabase/tests/social-leaderboard.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb } from './helpers/db'
import { A, B, makeUser, setClock } from './helpers/game'
import { C, D, befriend, one, rows, xp } from './helpers/social'

let db: PGlite
const weekly = (uid: string) => one<any>(db, uid, 'select public.get_weekly_leaderboard() as v')
const alltime = (uid: string) => one<any>(db, uid, 'select public.get_alltime_leaderboard() as v')

beforeEach(async () => {
  db = await freshDb()
  await setClock(db, '2026-10-07T15:00:00Z')   // Wednesday, week of 2026-10-05 everywhere below
  await makeUser(db, A, { display_name: 'Ana' })
  await makeUser(db, B, { display_name: 'Bia' })
  await makeUser(db, C, { display_name: 'Caio', timezone: 'Asia/Tokyo' })
  await makeUser(db, D, { display_name: 'Duda' })
  await befriend(db, A, B)
  await befriend(db, A, C)
  await xp(db, A, 300, '2026-10-05', 't:a1')
  await xp(db, A, 900, '2026-09-28', 't:a0')
  await xp(db, B, 500, '2026-10-05', 't:b1')
  await xp(db, B, 100, '2026-09-28', 't:b0')
  await xp(db, C, 300, '2026-10-05', 't:c1')
  await xp(db, D, 4999, '2026-10-05', 't:d1')
})

describe('weekly leaderboard', () => {
  it('ranks me and my friends by this week, with last week and the gap', async () => {
    expect(await weekly(A)).toEqual({
      week_start: '2026-10-05',
      rows: [
        { id: B, name: 'Bia', avatar_url: null, me: false, xp: 500, level: 4, pos: 1, prev_pos: 2, gap: null },
        { id: A, name: 'Ana', avatar_url: null, me: true, xp: 300, level: 6, pos: 2, prev_pos: 1, gap: 200 },
        { id: C, name: 'Caio', avatar_url: null, me: false, xp: 300, level: 3, pos: 2, prev_pos: 3, gap: 200 }
      ]
    })
  })

  it('resets each person at Monday 00:00 in their own time zone', async () => {
    await setClock(db, '2026-10-11T16:00:00Z')   // Sunday in São Paulo, Monday 01:00 in Tokyo
    const caio = (await weekly(A)).rows.find((r: { id: string }) => r.id === C)
    expect(caio).toMatchObject({ xp: 0, prev_pos: 2 })
  })

  it('shows only friends, never their friends', async () => {
    expect((await weekly(B)).rows.map((r: { name: string }) => r.name)).toEqual(['Bia', 'Ana'])
    expect((await weekly(D)).rows.map((r: { name: string }) => r.name)).toEqual(['Duda'])
  })

  it('needs a session', async () => {
    await expect(rows(db, null, 'select public.get_weekly_leaderboard()')).rejects.toThrow(/permission denied/)
  })
})

describe('all-time leaderboard', () => {
  it('ranks by total XP, compared with the total before this week', async () => {
    expect((await alltime(A)).rows).toEqual([
      { id: A, name: 'Ana', avatar_url: null, me: true, xp: 1200, level: 6, pos: 1, prev_pos: 1, gap: null },
      { id: B, name: 'Bia', avatar_url: null, me: false, xp: 600, level: 4, pos: 2, prev_pos: 2, gap: 600 },
      { id: C, name: 'Caio', avatar_url: null, me: false, xp: 300, level: 3, pos: 3, prev_pos: 3, gap: 300 }
    ])
  })

  it('needs a session', async () => {
    await expect(rows(db, null, 'select public.get_alltime_leaderboard()')).rejects.toThrow(/permission denied/)
  })
})
```

Run: `npx vitest run supabase/tests/social-close.test.ts supabase/tests/social-leaderboard.test.ts`
Expected: FAIL (`close_all_challenges`, `get_weekly_leaderboard` inexistentes; desafios não fecham).

- [ ] **Step 2: `achievement_stats` com `challenges_won`**

`achievement_stats` é `language sql`, então o corpo é validado na criação e não pode citar
`challenge_members` antes de a tabela existir. Em `0004_social.sql`, **apagar** o bloco da Task 1
que vai do comentário `-- Achievement metrics: Phase 1a's, plus the social ones it left for this phase`
até o `$$;` que fecha `achievement_stats` (o `revoke` da Task 1 que cita `achievement_stats(uuid)`
fica onde está: a função já existe pela 0002 nesse ponto). Acrescentar o bloco novo ao fim do
arquivo (depois do que o Step 3 acrescenta):

```sql
-- Achievement metrics: Phase 1a's, plus the social ones it left for this phase -------------------

create or replace function public.achievement_stats(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'workouts', (select count(*) from public.activity_events where user_id = p_user and kind = 'workout_completed'),
    'prs', (select count(*) from public.activity_events where user_id = p_user and kind = 'pr'),
    'week_targets', (select count(*) from public.xp_ledger where user_id = p_user and reason = 'week_target'),
    'best_streak', coalesce((select best from public.streaks where user_id = p_user and kind = 'training_week'), 0),
    'weigh_in_run', coalesce((
      select max(n) from (
        select count(*) as n from (
          select d - (row_number() over (order by d))::int as grp
            from (select distinct occurred_on as d from public.activity_events
                   where user_id = p_user and kind = 'weight_logged') days
        ) runs group by grp
      ) lengths), 0),
    'early_workouts', (select count(*) from public.activity_events
                        where user_id = p_user and kind = 'workout_completed'
                          and jsonb_typeof(payload -> 'hour') = 'number' and (payload ->> 'hour')::numeric < 7),
    'friends', (select count(*) from public.friendships where p_user in (user_a, user_b)),
    'challenges_won', (select count(*) from public.challenge_members where user_id = p_user and won)
  )
$$;

revoke all on function public.achievement_stats(uuid) from public, anon, authenticated;
```

Em `supabase/tests/gamification-progress.test.ts`, a linha de `stats` fica:

```ts
      stats: { workouts: 1, prs: 1, week_targets: 0, best_streak: 0, weigh_in_run: 1, early_workouts: 0, friends: 0, challenges_won: 0, level: 3 }
```

- [ ] **Step 3: Fechamento, ranking e `get_challenges` preguiçoso**

Em `get_challenges` (Task 3), logo depois do bloco `if not exists (... profiles ...) then ... end if;`,
acrescentar:

```sql
  perform public.close_due_challenges(v_me);
```

Acrescentar ao fim de `0004_social.sql`:

```sql
-- Closing ------------------------------------------------------------------------------------------

-- Closes one challenge once the creator's local day is past ends_on (Decision 12). Unanswered
-- invitations go; fewer than two participants cancel it; otherwise progress is frozen, team wins
-- together and solo wins one by one, and each winner gets +300 once ('challenge:<id>') plus the
-- badges that unlocks. The global closing lock comes before any per-user lock (Decision 6).
create or replace function public.close_challenge(p_challenge uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  c         public.challenges%rowtype;
  v_members uuid[];
  v_won     boolean;
  r         record;
begin
  perform pg_advisory_xact_lock(hashtextextended('challenge-close', 0));
  select * into c from public.challenges where id = p_challenge for update;
  if not found or c.status <> 'active' or public.local_today(c.created_by) <= c.ends_on then
    return false;
  end if;
  delete from public.challenge_members where challenge_id = p_challenge and joined_at is null;
  select coalesce(array_agg(user_id order by user_id), '{}') into v_members
    from public.challenge_members where challenge_id = p_challenge;
  if cardinality(v_members) < 2 then
    update public.challenges set status = 'cancelled', closed_at = public.app_now() where id = p_challenge;
    return true;
  end if;
  perform public.lock_users(v_members);
  update public.challenge_members
     set final = coalesce(public.challenge_progress(p_challenge, user_id), 0)
   where challenge_id = p_challenge;
  if c.mode = 'team' then
    select sum(final) >= c.target into v_won from public.challenge_members where challenge_id = p_challenge;
    update public.challenge_members set won = v_won where challenge_id = p_challenge;
  else
    update public.challenge_members set won = (final >= c.target) where challenge_id = p_challenge;
    select bool_or(won) into v_won from public.challenge_members where challenge_id = p_challenge;
  end if;
  update public.challenges
     set status = case when v_won then 'won' else 'lost' end, closed_at = public.app_now()
   where id = p_challenge;
  for r in select user_id from public.challenge_members
            where challenge_id = p_challenge and won order by user_id loop
    perform public.award_bonus_xp(r.user_id, 300, 'challenge:' || p_challenge::text);
    perform public.evaluate_achievements(r.user_id);
  end loop;
  return true;
end $$;

-- The lazy path: what one person is in. Takes no lock when nothing is due.
create or replace function public.close_due_challenges(p_user uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select c.id from public.challenges c
      join public.challenge_members m on m.challenge_id = c.id and m.user_id = p_user
     where c.status = 'active' and c.ends_on < public.local_today(c.created_by)
     order by c.id
  loop
    if public.close_challenge(r.id) then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- The daily safety net (0005 schedules it).
create or replace function public.close_all_challenges() returns integer
language plpgsql security definer set search_path = public as $$
declare
  r record;
  n integer := 0;
begin
  for r in select id from public.challenges
            where status = 'active' and ends_on < public.local_today(created_by) order by id loop
    if public.close_challenge(r.id) then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- Leaderboards -------------------------------------------------------------------------------------

-- Me and my friends. 'week': XP of each person's own current local week, compared with their
-- previous week. 'all': total XP, compared with the total before the current week. Ties share a
-- position; gap is what is missing to reach the next score above (null for the leader).
create or replace function public.leaderboard_json(p_me uuid, p_kind text) returns jsonb
language sql stable security definer set search_path = public as $$
  with people as (
    select p.id, p.display_name, p.avatar_url,
           public.local_week_start(p.id) as wk, public.total_xp(p.id) as total
      from public.profiles p
     where p.id = p_me or p.id in (select public.friend_ids(p_me))),
  scored as (
    select x.*,
           case when p_kind = 'week' then public.week_xp(x.id, x.wk)::bigint else x.total end as score,
           case when p_kind = 'week' then public.week_xp(x.id, x.wk - 7)::bigint
                else x.total - public.week_xp(x.id, x.wk) end as before
      from people x),
  ranked as (
    select s.*, rank() over (order by s.score desc) as pos, rank() over (order by s.before desc) as prev_pos
      from scored s)
  select jsonb_build_object(
    'week_start', public.local_week_start(p_me),
    'rows', coalesce(jsonb_agg(jsonb_build_object(
              'id', r.id, 'name', r.display_name, 'avatar_url', r.avatar_url, 'me', r.id = p_me,
              'xp', r.score, 'level', (public.level_for(r.total)).level,
              'pos', r.pos, 'prev_pos', r.prev_pos,
              'gap', (select min(o.score) from ranked o where o.score > r.score) - r.score)
            order by r.pos, lower(r.display_name), r.id), '[]'::jsonb))
  from ranked r
$$;

create or replace function public.get_weekly_leaderboard() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  if not exists (select 1 from public.profiles where id = v_me) then
    raise exception 'no_profile' using errcode = 'P0002';
  end if;
  perform public.close_due_challenges(v_me);
  return public.leaderboard_json(v_me, 'week');
end $$;

create or replace function public.get_alltime_leaderboard() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  if not exists (select 1 from public.profiles where id = v_me) then
    raise exception 'no_profile' using errcode = 'P0002';
  end if;
  perform public.close_due_challenges(v_me);
  return public.leaderboard_json(v_me, 'all');
end $$;

revoke all on function public.close_challenge(uuid), public.close_due_challenges(uuid),
  public.close_all_challenges(), public.leaderboard_json(uuid, text) from public, anon, authenticated;
revoke all on function public.get_weekly_leaderboard(), public.get_alltime_leaderboard() from public, anon;
grant execute on function public.get_weekly_leaderboard(), public.get_alltime_leaderboard() to authenticated;
```

- [ ] **Step 4: Migration do cron**

Criar `supabase/migrations/0005_social_cron.sql`:

```sql
-- Phase 1b: daily safety net for challenges. get_challenges and the rankings close due challenges
-- whenever someone opens them; this pays the +300 to people who stay away. It only does something
-- where pg_cron exists (Supabase, once the extension is enabled; see docs/SETUP.md §7). Elsewhere,
-- the PGlite tests included, it is a no-op.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    -- Same job name again updates the schedule instead of adding a second job.
    execute $cron$ select cron.schedule('close-challenges', '15 6 * * *', 'select public.close_all_challenges()') $cron$;
  end if;
exception when others then
  raise notice 'close-challenges not scheduled: %', sqlerrm;
end $$;
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run supabase/tests`
Expected: PASS em todos os arquivos (1a e 1b).

- [ ] **Step 6: `docs/SETUP.md`**

Em §1, o passo 2 fica:

```markdown
2. SQL Editor → cole e rode, em ordem, cada arquivo de `supabase/migrations/` (`0001_init.sql`,
   `0002_gamification.sql`, `0003_gamification_cron.sql`, `0004_social.sql`,
   `0005_social_cron.sql`). Em um projeto que já tem as anteriores, rode só as que faltam.
```

Em §7, trocar o passo 2 e o 3 por:

```markdown
2. SQL Editor → rode de novo `supabase/migrations/0003_gamification_cron.sql` e
   `supabase/migrations/0005_social_cron.sql`.
3. Confira com `select jobname, schedule, command from cron.job order by jobname;`. O resultado
   esperado tem duas linhas: `close-challenges | 15 6 * * * | select public.close_all_challenges()`
   e `close-weeks | 0 6 * * * | select public.close_all_weeks()` (06:00 e 06:15 UTC).
```

e, ao fim da seção, acrescentar:

```markdown
Os desafios também fecham sozinhos quando alguém abre o app, a aba de desafios ou o ranking. O job
só garante os +300 XP de quem passa dias sem abrir.
```

- [ ] **Step 7: Commit**

```bash
npm run typecheck && npm test
git add supabase/migrations/0004_social.sql supabase/migrations/0005_social_cron.sql supabase/tests/social-close.test.ts supabase/tests/social-leaderboard.test.ts supabase/tests/gamification-progress.test.ts docs/SETUP.md
git commit -m "feat(db): close challenges with the +300 bonus, leaderboards and daily job

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Cliente: tipos, API e regras puras

**Files:**
- Modify: `src/lib/database.types.ts`
- Create: `src/features/social/types.ts`, `social-api.ts`, `pending-invite.ts`, `share.ts`, `templates.ts`, `test-social.ts`
- Test: `src/features/social/social-api.test.ts`, `pending-invite.test.ts`, `share.test.ts`, `templates.test.ts`

**Interfaces:**
- Consumes: RPCs e tabelas das Tasks 1–4; `Progress`, `WeekProgress` (`src/features/gamification/types.ts`, 1a); `progressOf` (`test-progress.ts`, 1a).
- Produces:
  - `types.ts`: `Person`, `FriendCard`, `Friend`, `MyInvite`, `InviteStatus`, `InviteInfo`, `LeaderboardRow`, `Leaderboard`, `ChallengeTemplate`, `ChallengeMode`, `ChallengeStatus`, `ChallengeMember`, `Challenge`, `NewChallenge`, `FeedItem`, `FeedCursor`, `FeedPage`, `SocialErrorCode`;
  - `social-api.ts`: `class SocialError extends Error { code }`, `toSocialError(e: unknown): SocialError`, `createInvite()`, `getInvite(code)`, `acceptInvite(code): Promise<Person>`, `listMyInvites(now?)`, `cancelInvite(code)`, `removeFriend(me, friend)`, `getFriends()`, `getWeeklyLeaderboard()`, `getAlltimeLeaderboard()`, `getChallenges()`, `createChallenge(c): Promise<string>`, `joinChallenge(id, shareVolume?)`, `leaveChallenge(id)`, `getFeed(cursor?)`;
  - `pending-invite.ts`: `PENDING_KEY`, `INVITE_CODE`, `inviteCodeFromPath(pathname)`, `inviteUrl(code, loc?)`, `savePendingInvite(code, now?)`, `readPendingInvite(now?)`, `clearPendingInvite()`;
  - `share.ts`: `type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed'`, `shareLink(url, text, nav?)`;
  - `templates.ts`: `MIN_DAYS`, `MAX_DAYS`, `MAX_INVITEES`, `DURATIONS`, `TEMPLATES`, `MODES`, `TARGET_STEP`, `addDays`, `daysInclusive`, `mondayOf`, `nextMonday`, `weeksTouched`, `targetRange`, `clampTarget`, `suggestedTarget`, `checkChallenge` (`ChallengeProblem`), `challengeShare`, `pendingInvites`, `daysLeft`;
  - `test-social.ts` (fábricas para testes): `ME`, `BIA`, `CAIO`, `friendOf`, `rowOf`, `challengeOf`, `feedItemOf`.

- [ ] **Step 1: Tipos do banco**

Em `src/lib/database.types.ts`, dentro de `Tables`, depois de `user_achievements` (1a), acrescentar:

```ts
      friend_invites: {
        Row: { code: string; inviter_id: string; created_at: string; expires_at: string; used_by: string | null; used_at: string | null }
        Insert: never
        Update: never
        Relationships: []
      }
      friendships: {
        Row: { user_a: string; user_b: string; created_at: string }
        Insert: never
        Update: never
        Relationships: []
      }
```

- [ ] **Step 2: `types.ts`**

Criar `src/features/social/types.ts`:

```ts
import type { Progress, WeekProgress } from '../gamification/types'

export type Person = { id: string; name: string; avatar_url: string | null }

// progress_card (supabase/migrations/0002_gamification.sql): what friends may see of a Progress.
export type FriendCard = Omit<Progress, 'today' | 'stats' | 'week'> & { week: Omit<WeekProgress, 'weighed_today'> }

export type Friend = Person & { since: string; shares_activity: boolean; card: FriendCard }

export type MyInvite = { code: string; created_at: string; expires_at: string }
export type InviteStatus = 'open' | 'expired' | 'used' | 'self' | 'already_friends'
export type InviteInfo = { status: InviteStatus; expires_at: string; inviter: { name: string; avatar_url: string | null } }

export type LeaderboardRow = Person & {
  me: boolean
  xp: number
  level: number
  pos: number
  prev_pos: number
  gap: number | null
}
export type Leaderboard = { week_start: string; rows: LeaderboardRow[] }

export type ChallengeTemplate = 'workouts_count' | 'weeks_on_target' | 'volume_total'
export type ChallengeMode = 'team' | 'solo'
export type ChallengeStatus = 'active' | 'won' | 'lost' | 'cancelled'
export type ChallengeMember = Person & { me: boolean; joined: boolean; progress: number | null; won: boolean | null }

// One entry of get_challenges (supabase/migrations/0004_social.sql, challenge_json).
export type Challenge = {
  id: string
  template: ChallengeTemplate
  title: string
  mode: ChallengeMode
  target: number
  starts_on: string
  ends_on: string
  status: ChallengeStatus
  created_by: string
  invited_by: string | null
  total: number
  me: { joined: boolean; won: boolean | null }
  members: ChallengeMember[]
}

export type NewChallenge = {
  template: ChallengeTemplate
  title: string
  mode: ChallengeMode
  target: number
  starts_on: string
  ends_on: string
  invitees: string[]
  share_volume: boolean
}

export type FeedItem = { id: number; at: string; day: string; user: Person; sets: number | null; prs: string[] }
export type FeedCursor = { before: string; before_id: number }
export type FeedPage = { items: FeedItem[]; next: FeedCursor | null }

export type SocialErrorCode =
  | 'not_signed_in' | 'no_profile'
  | 'invite_not_found' | 'invite_expired' | 'invite_used' | 'self_invite' | 'already_friends' | 'invite_limit'
  | 'not_friends' | 'invalid_challenge' | 'challenge_limit' | 'challenge_not_found' | 'challenge_closed'
  | 'volume_opt_in_required'
  | 'network'
```

- [ ] **Step 3: Testes que falham**

Criar `src/features/social/test-social.ts` (fábricas, não é teste):

```ts
import { progressOf } from '../gamification/test-progress'
import type { Challenge, FeedItem, Friend, FriendCard, LeaderboardRow } from './types'

export const ME = '00000000-0000-0000-0000-00000000000a'
export const BIA = '00000000-0000-0000-0000-00000000000b'
export const CAIO = '00000000-0000-0000-0000-00000000000c'

export function friendOf(id: string, name: string, over: Partial<Friend> = {}): Friend {
  const p = progressOf(400, { xp: 250, workouts: 2 }, { streak: { current: 3, best: 5, shields: 1 } })
  const w = p.week
  const card: FriendCard = {
    total_xp: p.total_xp, level: p.level, pillars: p.pillars, streak: p.streak, achievements: p.achievements,
    week: { start: w.start, xp: w.xp, max: w.max, target: w.target, workouts: w.workouts, extras: w.extras, prs: w.prs, target_hit: w.target_hit }
  }
  return { id, name, avatar_url: null, since: '2026-10-01T12:00:00Z', shares_activity: true, card, ...over }
}

export const rowOf = (id: string, name: string, over: Partial<LeaderboardRow> = {}): LeaderboardRow =>
  ({ id, name, avatar_url: null, me: id === ME, xp: 0, level: 1, pos: 1, prev_pos: 1, gap: null, ...over })

// Ana (me) and Bia in a two-week team challenge for 6 workouts, 3 done.
export function challengeOf(over: Partial<Challenge> = {}): Challenge {
  return {
    id: 'c1', template: 'workouts_count', title: 'Outubro forte', mode: 'team', target: 6,
    starts_on: '2026-10-05', ends_on: '2026-10-18', status: 'active', created_by: ME, invited_by: null,
    total: 3, me: { joined: true, won: null },
    members: [
      { id: ME, name: 'Ana', avatar_url: null, me: true, joined: true, progress: 2, won: null },
      { id: BIA, name: 'Bia', avatar_url: null, me: false, joined: true, progress: 1, won: null }
    ],
    ...over
  }
}

export const feedItemOf = (id: number, over: Partial<FeedItem> = {}): FeedItem =>
  ({ id, at: '2026-10-07T18:30:00Z', day: '2026-10-07', user: { id: BIA, name: 'Bia', avatar_url: null }, sets: 18, prs: [], ...over })
```

Criar `src/features/social/social-api.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: h.rpc, from: h.from } }))

import * as api from './social-api'

// A stand-in for supabase.from(...): each call is recorded and returns the chain; awaiting the
// chain gives `result`.
function chain(result: { data?: unknown; error: unknown }) {
  const calls: [string, unknown[]][] = []
  const proxy: any = new Proxy({}, {
    get(_, prop) {
      if (prop === 'then') return (resolve: (v: unknown) => void) => resolve(result)
      return (...args: unknown[]) => { calls.push([String(prop), args]); return proxy }
    }
  })
  return { proxy, calls }
}

beforeEach(() => { h.rpc.mockReset(); h.from.mockReset() })

describe('social api', () => {
  it('calls each RPC with its arguments', async () => {
    h.rpc.mockResolvedValue({ data: { friend: { id: 'a', name: 'Ana', avatar_url: null } }, error: null })
    await expect(api.acceptInvite('AbCdEfGh12')).resolves.toEqual({ id: 'a', name: 'Ana', avatar_url: null })
    expect(h.rpc).toHaveBeenLastCalledWith('accept_invite', { p_code: 'AbCdEfGh12' })

    h.rpc.mockResolvedValue({ data: { id: 'c9' }, error: null })
    await expect(api.createChallenge({
      template: 'volume_total', title: 'Toneladas', mode: 'team', target: 20,
      starts_on: '2026-10-05', ends_on: '2026-11-03', invitees: ['b'], share_volume: true
    })).resolves.toBe('c9')
    expect(h.rpc).toHaveBeenLastCalledWith('create_challenge', {
      p_template: 'volume_total', p_title: 'Toneladas', p_mode: 'team', p_target: 20,
      p_starts_on: '2026-10-05', p_ends_on: '2026-11-03', p_invitees: ['b'], p_share_volume: true
    })

    h.rpc.mockResolvedValue({ data: null, error: null })
    await api.joinChallenge('c9', true)
    expect(h.rpc).toHaveBeenLastCalledWith('join_challenge', { p_id: 'c9', p_share_volume: true })
    await api.leaveChallenge('c9')
    expect(h.rpc).toHaveBeenLastCalledWith('leave_challenge', { p_id: 'c9' })

    h.rpc.mockResolvedValue({ data: { items: [], next: null }, error: null })
    await api.getFeed()
    expect(h.rpc).toHaveBeenLastCalledWith('get_feed', {})
    await api.getFeed({ before: '2026-10-07T18:30:00+00:00', before_id: 41 })
    expect(h.rpc).toHaveBeenLastCalledWith('get_feed', { p_before: '2026-10-07T18:30:00+00:00', p_before_id: 41 })

    for (const [fn, name] of [[api.getFriends, 'get_friends'], [api.getWeeklyLeaderboard, 'get_weekly_leaderboard'],
      [api.getAlltimeLeaderboard, 'get_alltime_leaderboard'], [api.getChallenges, 'get_challenges'], [api.createInvite, 'create_invite']] as const) {
      await fn()
      expect(h.rpc).toHaveBeenLastCalledWith(name, {})
    }
    await api.getInvite('AbCdEfGh12')
    expect(h.rpc).toHaveBeenLastCalledWith('get_invite', { p_code: 'AbCdEfGh12' })
  })

  it('turns server errors into typed codes and the rest into network', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'invite_expired' } })
    await expect(api.acceptInvite('AbCdEfGh12')).rejects.toMatchObject({ name: 'SocialError', code: 'invite_expired' })
    h.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    await expect(api.getFriends()).rejects.toMatchObject({ code: 'network' })
    h.rpc.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(api.getFriends()).rejects.toMatchObject({ code: 'network' })
  })

  it('lists my open invites, newest first', async () => {
    const c = chain({ data: [{ code: 'AbCdEfGh12', created_at: 'x', expires_at: 'y' }], error: null })
    h.from.mockReturnValue(c.proxy)
    const now = new Date('2026-10-07T12:00:00Z')
    await expect(api.listMyInvites(now)).resolves.toEqual([{ code: 'AbCdEfGh12', created_at: 'x', expires_at: 'y' }])
    expect(h.from).toHaveBeenCalledWith('friend_invites')
    expect(c.calls).toEqual([
      ['select', ['code, created_at, expires_at']],
      ['is', ['used_at', null]],
      ['gt', ['expires_at', '2026-10-07T12:00:00.000Z']],
      ['order', ['created_at', { ascending: false }]]
    ])
  })

  it('cancels an invite and removes a friendship by its ordered pair', async () => {
    const a = chain({ error: null })
    h.from.mockReturnValue(a.proxy)
    await api.cancelInvite('AbCdEfGh12')
    expect(a.calls).toEqual([['delete', []], ['eq', ['code', 'AbCdEfGh12']]])
    const b = chain({ error: null })
    h.from.mockReturnValue(b.proxy)
    await api.removeFriend('0000000b-0000-0000-0000-000000000000', '0000000a-0000-0000-0000-000000000000')
    expect(h.from).toHaveBeenLastCalledWith('friendships')
    expect(b.calls).toEqual([
      ['delete', []],
      ['eq', ['user_a', '0000000a-0000-0000-0000-000000000000']],
      ['eq', ['user_b', '0000000b-0000-0000-0000-000000000000']]
    ])
  })
})
```

Criar `src/features/social/pending-invite.test.ts`:

```ts
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import { PENDING_KEY, clearPendingInvite, inviteCodeFromPath, inviteUrl, readPendingInvite, savePendingInvite } from './pending-invite'

beforeEach(() => localStorage.clear())

describe('pending invite', () => {
  it('reads the code from the invite route only', () => {
    expect(inviteCodeFromPath('/convite/AbCdEfGh12')).toBe('AbCdEfGh12')
    expect(inviteCodeFromPath('/convite/AbCdEfGh12/')).toBe('AbCdEfGh12')
    expect(inviteCodeFromPath('/convite/short')).toBeNull()
    expect(inviteCodeFromPath('/home')).toBeNull()
  })

  it('builds the link the hash router opens', () => {
    expect(inviteUrl('AbCdEfGh12', { origin: 'https://perf.app', pathname: '/' })).toBe('https://perf.app/#/convite/AbCdEfGh12')
  })

  it('keeps the code for a day across the sign-in', () => {
    savePendingInvite('AbCdEfGh12', 1_000)
    expect(readPendingInvite(1_000 + 60_000)).toBe('AbCdEfGh12')
    expect(readPendingInvite(1_000 + 24 * 3600_000)).toBeNull()
    clearPendingInvite()
    expect(readPendingInvite(1_000)).toBeNull()
  })

  it('ignores bad codes and garbage', () => {
    savePendingInvite('nope')
    expect(localStorage.getItem(PENDING_KEY)).toBeNull()
    localStorage.setItem(PENDING_KEY, '{oops')
    expect(readPendingInvite()).toBeNull()
  })
})
```

Criar `src/features/social/share.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { shareLink } from './share'

const URL_ = 'https://perf.app/#/convite/AbCdEfGh12'
const abort = () => Object.assign(new Error('cancelled'), { name: 'AbortError' })

describe('shareLink', () => {
  it('uses the share sheet when there is one', async () => {
    const share = vi.fn(async () => {})
    await expect(shareLink(URL_, 'Bora', { share })).resolves.toBe('shared')
    expect(share).toHaveBeenCalledWith({ text: 'Bora', url: URL_ })
  })

  it('does nothing else when the person closes the sheet', async () => {
    const writeText = vi.fn(async () => {})
    await expect(shareLink(URL_, 'Bora', { share: vi.fn(async () => { throw abort() }), clipboard: { writeText } })).resolves.toBe('cancelled')
    expect(writeText).not.toHaveBeenCalled()
  })

  it('copies the link when sharing is missing or fails', async () => {
    const writeText = vi.fn(async () => {})
    await expect(shareLink(URL_, 'Bora', { clipboard: { writeText } })).resolves.toBe('copied')
    await expect(shareLink(URL_, 'Bora', { share: vi.fn(async () => { throw new Error('NotAllowedError') }), clipboard: { writeText } })).resolves.toBe('copied')
    expect(writeText).toHaveBeenCalledWith(URL_)
  })

  it('says so when nothing worked', async () => {
    await expect(shareLink(URL_, 'Bora', {})).resolves.toBe('failed')
    await expect(shareLink(URL_, 'Bora', { clipboard: { writeText: vi.fn(async () => { throw new Error('denied') }) } })).resolves.toBe('failed')
  })
})
```

Criar `src/features/social/templates.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  addDays, challengeShare, checkChallenge, daysInclusive, daysLeft, mondayOf, nextMonday,
  pendingInvites, suggestedTarget, targetRange, weeksTouched
} from './templates'
import { challengeOf } from './test-social'
import type { NewChallenge } from './types'

const today = '2026-10-05'
const draft = (over: Partial<NewChallenge> = {}): NewChallenge => ({
  template: 'workouts_count', title: 'Outubro forte', mode: 'team', target: 6,
  starts_on: '2026-10-05', ends_on: '2026-10-18', invitees: ['b'], share_volume: false, ...over
})

describe('calendar helpers', () => {
  it('count days and weeks like the database', () => {
    expect(addDays('2026-10-05', 13)).toBe('2026-10-18')
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(daysInclusive('2026-10-05', '2026-10-18')).toBe(14)
    expect(mondayOf('2026-10-11')).toBe('2026-10-05')
    expect(mondayOf('2026-10-05')).toBe('2026-10-05')
    expect(nextMonday('2026-10-07')).toBe('2026-10-12')
    expect(nextMonday('2026-10-05')).toBe('2026-10-12')
    expect(weeksTouched('2026-10-05', '2026-10-18')).toBe(2)
    expect(weeksTouched('2026-10-07', '2026-10-13')).toBe(2)
  })
})

describe('checkChallenge (mirror of create_challenge)', () => {
  it('accepts a valid challenge and the edges', () => {
    expect(checkChallenge(draft(), today)).toBeNull()
    expect(checkChallenge(draft({ ends_on: '2026-10-11' }), today)).toBeNull()
    expect(checkChallenge(draft({ ends_on: '2027-01-04' }), today)).toBeNull()
    expect(checkChallenge(draft({ starts_on: '2026-11-04', ends_on: '2026-11-10' }), today)).toBeNull()
    expect(checkChallenge(draft({ invitees: Array.from({ length: 19 }, (_, i) => 'p' + i) }), today)).toBeNull()
  })

  it.each([
    [{ title: '   ' }, 'title'],
    [{ title: 'x'.repeat(61) }, 'title'],
    [{ template: 'weeks_on_target', mode: 'team', target: 1 }, 'mode'],
    [{ ends_on: '2026-10-10' }, 'dates'],
    [{ ends_on: '2027-01-05' }, 'dates'],
    [{ starts_on: '2026-10-04', ends_on: '2026-10-17' }, 'dates'],
    [{ starts_on: '2026-11-05', ends_on: '2026-11-18' }, 'dates'],
    [{ target: 0 }, 'target'],
    [{ target: 2.5 }, 'target'],
    [{ target: 501 }, 'target'],
    [{ template: 'weeks_on_target', mode: 'solo', target: 3 }, 'target'],
    [{ invitees: [] }, 'invitees'],
    [{ invitees: Array.from({ length: 20 }, (_, i) => 'p' + i) }, 'invitees'],
    [{ template: 'volume_total', target: 20 }, 'volume']
  ] as [Partial<NewChallenge>, string][])('refuses %j as %s', (over, problem) => {
    expect(checkChallenge(draft(over), today)).toBe(problem)
  })
})

describe('targets', () => {
  it('bounds weeks_on_target by the weeks the period touches', () => {
    expect(targetRange('weeks_on_target', '2026-10-05', '2026-11-03')).toEqual({ min: 1, max: 5 })
    expect(targetRange('workouts_count', '2026-10-05', '2026-11-03')).toEqual({ min: 1, max: 500 })
    expect(targetRange('volume_total', '2026-10-05', '2026-11-03')).toEqual({ min: 1, max: 5000 })
  })

  it('suggests a goal from the weekly target, the period and the team', () => {
    expect(suggestedTarget('workouts_count', 'team', '2026-10-05', '2026-11-03', 3, 2)).toBe(24)
    expect(suggestedTarget('workouts_count', 'solo', '2026-10-05', '2026-11-03', 3, 2)).toBe(12)
    expect(suggestedTarget('weeks_on_target', 'solo', '2026-10-05', '2026-11-03', 3, 2)).toBe(4)
    expect(suggestedTarget('volume_total', 'team', '2026-10-05', '2026-11-03', 3, 2)).toBe(40)
  })
})

describe('progress helpers', () => {
  it('measures the team total or my own progress', () => {
    expect(challengeShare(challengeOf())).toBe(0.5)
    expect(challengeShare(challengeOf({ mode: 'solo', target: 2 }))).toBe(1)
    expect(challengeShare(challengeOf({ total: 60 }))).toBe(1)
  })

  it('counts invitations waiting for an answer', () => {
    expect(pendingInvites(null)).toBe(0)
    expect(pendingInvites([challengeOf(), challengeOf({ id: 'c2', me: { joined: false, won: null } }),
      challengeOf({ id: 'c3', status: 'won', me: { joined: false, won: null } })])).toBe(1)
  })

  it('counts the last day as one day left', () => {
    expect(daysLeft(challengeOf(), '2026-10-18')).toBe(1)
    expect(daysLeft(challengeOf(), '2026-10-05')).toBe(14)
  })
})
```

Run: `npx vitest run src/features/social`
Expected: FAIL (módulos `./social-api`, `./pending-invite`, `./share`, `./templates` inexistentes).

- [ ] **Step 4: Implementar**

Criar `src/features/social/social-api.ts`:

```ts
import { supabase } from '@/lib/supabase'
import type {
  Challenge, FeedCursor, FeedPage, Friend, InviteInfo, Leaderboard, MyInvite, NewChallenge, Person, SocialErrorCode
} from './types'

const CODES: readonly SocialErrorCode[] = [
  'not_signed_in', 'no_profile', 'invite_not_found', 'invite_expired', 'invite_used', 'self_invite',
  'already_friends', 'invite_limit', 'not_friends', 'invalid_challenge', 'challenge_limit',
  'challenge_not_found', 'challenge_closed', 'volume_opt_in_required'
]

export class SocialError extends Error {
  readonly code: SocialErrorCode
  constructor(code: SocialErrorCode) {
    super(code)
    this.name = 'SocialError'
    this.code = code
  }
}

// The database raises its typed errors with the code as the message (0004_social.sql). Anything
// else (no network, an expired session, a server we cannot explain) is "try again".
export function toSocialError(e: unknown): SocialError {
  if (e instanceof SocialError) return e
  const msg = (e as { message?: unknown } | null)?.message
  return new SocialError(typeof msg === 'string' && (CODES as readonly string[]).includes(msg) ? (msg as SocialErrorCode) : 'network')
}

type RpcAnswer = { data: unknown; error: { message: string } | null }
// The social RPCs are not in database.types.ts; their shapes live in ./types.
const callRpc = (fn: string, args: Record<string, unknown>) =>
  (supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<RpcAnswer>)(fn, args)

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  let res: RpcAnswer
  try { res = await callRpc(fn, args) } catch (e) { throw toSocialError(e) }
  if (res.error) throw toSocialError(res.error)
  return res.data as T
}

export const createInvite = () => rpc<{ code: string; expires_at: string }>('create_invite')
export const getInvite = (code: string) => rpc<InviteInfo>('get_invite', { p_code: code })
export const acceptInvite = async (code: string): Promise<Person> =>
  (await rpc<{ friend: Person }>('accept_invite', { p_code: code })).friend

export async function listMyInvites(now: Date = new Date()): Promise<MyInvite[]> {
  const { data, error } = await supabase.from('friend_invites').select('code, created_at, expires_at')
    .is('used_at', null).gt('expires_at', now.toISOString()).order('created_at', { ascending: false })
  if (error) throw toSocialError(error)
  return (data ?? []) as MyInvite[]
}

export async function cancelInvite(code: string): Promise<void> {
  const { error } = await supabase.from('friend_invites').delete().eq('code', code)
  if (error) throw toSocialError(error)
}

// friendships keeps the pair ordered (user_a < user_b); lowercase uuid strings sort like uuids.
export async function removeFriend(me: string, friend: string): Promise<void> {
  const [a, b] = me < friend ? [me, friend] : [friend, me]
  const { error } = await supabase.from('friendships').delete().eq('user_a', a).eq('user_b', b)
  if (error) throw toSocialError(error)
}

export const getFriends = () => rpc<Friend[]>('get_friends')
export const getWeeklyLeaderboard = () => rpc<Leaderboard>('get_weekly_leaderboard')
export const getAlltimeLeaderboard = () => rpc<Leaderboard>('get_alltime_leaderboard')
export const getChallenges = () => rpc<Challenge[]>('get_challenges')

export const createChallenge = async (c: NewChallenge): Promise<string> =>
  (await rpc<{ id: string }>('create_challenge', {
    p_template: c.template, p_title: c.title, p_mode: c.mode, p_target: c.target,
    p_starts_on: c.starts_on, p_ends_on: c.ends_on, p_invitees: c.invitees, p_share_volume: c.share_volume
  })).id

export const joinChallenge = async (id: string, shareVolume = false): Promise<void> => {
  await rpc<null>('join_challenge', { p_id: id, p_share_volume: shareVolume })
}
export const leaveChallenge = async (id: string): Promise<void> => {
  await rpc<null>('leave_challenge', { p_id: id })
}

export const getFeed = (cursor: FeedCursor | null = null) =>
  rpc<FeedPage>('get_feed', cursor ? { p_before: cursor.before, p_before_id: cursor.before_id } : {})
```

Criar `src/features/social/pending-invite.ts`:

```ts
// An invite opened before signing in has to survive the Google round trip, which comes back to
// origin + pathname and drops the hash route (features/auth/auth.ts). The code waits here for a
// day; PendingInviteHost picks it up once the profile is ready (Decision 2).

export const PENDING_KEY = 'perf_pending_invite_v1'
export const INVITE_CODE = /^[0-9A-Za-z]{10}$/
const TTL = 24 * 3600_000

export function inviteCodeFromPath(pathname: string): string | null {
  const m = /^\/convite\/([0-9A-Za-z]{10})\/?$/.exec(pathname)
  return m ? m[1] : null
}

export function inviteUrl(code: string, loc: Pick<Location, 'origin' | 'pathname'> = window.location): string {
  return `${loc.origin}${loc.pathname}#/convite/${code}`
}

export function savePendingInvite(code: string, now = Date.now()): void {
  if (!INVITE_CODE.test(code)) return
  try { localStorage.setItem(PENDING_KEY, JSON.stringify({ code, at: now })) } catch { /* storage blocked */ }
}

export function readPendingInvite(now = Date.now()): string | null {
  try {
    const v = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null')
    if (v && typeof v.code === 'string' && INVITE_CODE.test(v.code) && typeof v.at === 'number' && now - v.at < TTL) return v.code
  } catch { /* garbage */ }
  return null
}

export function clearPendingInvite(): void {
  try { localStorage.removeItem(PENDING_KEY) } catch { /* ignore */ }
}
```

Criar `src/features/social/share.ts`:

```ts
export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed'
type Nav = { share?: (data: ShareData) => Promise<void>; clipboard?: { writeText(text: string): Promise<void> } }

// The phone's share sheet when there is one. Closing the sheet is a choice, not an error. Without
// a sheet (most desktops) or when it fails, the link goes to the clipboard; 'failed' means the
// caller has to show the link for copying by hand.
export async function shareLink(url: string, text: string, nav: Nav = navigator): Promise<ShareOutcome> {
  if (typeof nav.share === 'function') {
    try {
      await nav.share({ text, url })
      return 'shared'
    } catch (e) {
      if ((e as { name?: string } | null)?.name === 'AbortError') return 'cancelled'
    }
  }
  try {
    if (!nav.clipboard) return 'failed'
    await nav.clipboard.writeText(url)
    return 'copied'
  } catch {
    return 'failed'
  }
}
```

Criar `src/features/social/templates.ts`:

```ts
import type { Challenge, ChallengeMode, ChallengeTemplate, NewChallenge } from './types'

// Challenge rules, the same ones public.create_challenge enforces (0004_social.sql), so the form
// explains a problem before the server refuses it. Dates are local YYYY-MM-DD strings.

export const MIN_DAYS = 7
export const MAX_DAYS = 92
export const MAX_INVITEES = 19
export const DURATIONS = [7, 14, 30, 60, 90] as const
export const TEMPLATES: readonly ChallengeTemplate[] = ['workouts_count', 'weeks_on_target', 'volume_total']
export const MODES: Record<ChallengeTemplate, readonly ChallengeMode[]> = {
  workouts_count: ['team', 'solo'],
  weeks_on_target: ['solo'],
  volume_total: ['team', 'solo']
}
export const TARGET_STEP: Record<ChallengeTemplate, number> = { workouts_count: 1, weeks_on_target: 1, volume_total: 5 }
const MAX_TARGET = { workouts_count: 500, volume_total: 5000 } as const

const DAY = 86_400_000
const utc = (iso: string) => Date.parse(iso + 'T00:00:00Z')
export const addDays = (iso: string, n: number): string => new Date(utc(iso) + n * DAY).toISOString().slice(0, 10)
export const daysInclusive = (from: string, to: string): number => Math.round((utc(to) - utc(from)) / DAY) + 1
export const mondayOf = (iso: string): string => addDays(iso, -((new Date(utc(iso)).getUTCDay() + 6) % 7))
export const nextMonday = (iso: string): string => addDays(mondayOf(iso), 7)
export const weeksTouched = (from: string, to: string): number => Math.round((utc(mondayOf(to)) - utc(mondayOf(from))) / (7 * DAY)) + 1

export function targetRange(template: ChallengeTemplate, startsOn: string, endsOn: string): { min: number; max: number } {
  return { min: 1, max: template === 'weeks_on_target' ? weeksTouched(startsOn, endsOn) : MAX_TARGET[template] }
}

export const clampTarget = (n: number, r: { min: number; max: number }): number => Math.min(r.max, Math.max(r.min, Math.round(n)))

// A starting goal for the form: the weekly workout target over the period (times the people in a
// team), all but one of the weeks for weeks_on_target, and about 5 t per person a week of volume.
export function suggestedTarget(template: ChallengeTemplate, mode: ChallengeMode, startsOn: string, endsOn: string,
  weekly: number, people: number): number {
  const weeks = Math.max(1, Math.round(daysInclusive(startsOn, endsOn) / 7))
  const heads = mode === 'team' ? Math.max(1, people) : 1
  const raw = template === 'workouts_count' ? weekly * weeks * heads
    : template === 'weeks_on_target' ? weeksTouched(startsOn, endsOn) - 1
    : 5 * weeks * heads
  return clampTarget(raw, targetRange(template, startsOn, endsOn))
}

export type ChallengeProblem = 'title' | 'mode' | 'dates' | 'target' | 'invitees' | 'volume'

export function checkChallenge(c: NewChallenge, today: string): ChallengeProblem | null {
  const title = c.title.trim()
  if (title.length < 1 || title.length > 60) return 'title'
  if (!MODES[c.template].includes(c.mode)) return 'mode'
  const days = daysInclusive(c.starts_on, c.ends_on)
  if (days < MIN_DAYS || days > MAX_DAYS || c.starts_on < today || c.starts_on > addDays(today, 30)) return 'dates'
  const r = targetRange(c.template, c.starts_on, c.ends_on)
  if (!Number.isInteger(c.target) || c.target < r.min || c.target > r.max) return 'target'
  const people = new Set(c.invitees)
  if (people.size < 1 || people.size > MAX_INVITEES) return 'invitees'
  if (c.template === 'volume_total' && !c.share_volume) return 'volume'
  return null
}

// How far along, 0 to 1: the team's total, or my own progress in solo.
export function challengeShare(c: Challenge): number {
  const value = c.mode === 'team' ? c.total : (c.members.find(m => m.me)?.progress ?? 0)
  return Math.max(0, Math.min(1, value / c.target))
}

export const pendingInvites = (list: readonly Challenge[] | null): number =>
  (list ?? []).filter(c => c.status === 'active' && !c.me.joined).length

// The last day counts as one day left.
export const daysLeft = (c: Challenge, today: string): number => daysInclusive(today, c.ends_on)
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run src/features/social`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
npm run typecheck && npm test
git add src/lib/database.types.ts src/features/social
git commit -m "feat(social): typed API, invite link helpers and challenge rules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Cliente: store `useSocial` e ligação com a sessão

**Files:**
- Create: `src/features/social/useSocial.ts`
- Modify: `src/App.jsx`, `src/main.jsx`
- Test: `src/features/social/useSocial.test.ts`

**Interfaces:**
- Consumes: `social-api.ts` (Task 5); `useProgress` (`refresh()`, 1a); `clearPendingInvite` (Task 5).
- Produces: `useSocial` com `userId`, `friends`, `invites`, `weekly`, `alltime`, `challenges` (cada um `Resource<T> = { status: 'idle' | 'loading' | 'ready' | 'error'; data: T | null; stale: boolean; error: SocialErrorCode | null }`), `feed: FeedState = { status, items, next, stale, error, busy }`, `bind(userId)`, `load(key: ListKey): Promise<data | null>`, `loadFeed(more?: boolean): Promise<void>`, `reset()`; `type ListKey = 'friends' | 'invites' | 'weekly' | 'alltime' | 'challenges'`. Cache `perf_social_v1`.

- [ ] **Step 1: Teste que falha**

Criar `src/features/social/useSocial.test.ts`:

```ts
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))
const api = vi.hoisted(() => ({
  getFriends: vi.fn(), listMyInvites: vi.fn(), getWeeklyLeaderboard: vi.fn(), getAlltimeLeaderboard: vi.fn(),
  getChallenges: vi.fn(), getFeed: vi.fn()
}))
vi.mock('./social-api', async orig => ({ ...(await orig<typeof import('./social-api')>()), ...api }))
const progress = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock('../gamification/useProgress', () => ({ useProgress: { getState: () => progress } }))

import { useSocial } from './useSocial'
import { SocialError } from './social-api'
import { BIA, challengeOf, feedItemOf, friendOf } from './test-social'

const cache = () => JSON.parse(localStorage.getItem('perf_social_v1') || 'null')
const flush = () => new Promise(r => setTimeout(r, 0))

beforeEach(() => {
  localStorage.clear()
  useSocial.getState().reset()
  Object.values(api).forEach(f => f.mockReset())
  progress.refresh.mockReset()
  api.getChallenges.mockResolvedValue([])
})

describe('useSocial', () => {
  it('loads a list and keeps a copy per person', async () => {
    const list = [friendOf(BIA, 'Bia')]
    api.getFriends.mockResolvedValue(list)
    useSocial.getState().bind('u1')
    const loading = useSocial.getState().load('friends')
    expect(useSocial.getState().friends.status).toBe('loading')
    await expect(loading).resolves.toEqual(list)
    expect(useSocial.getState().friends).toEqual({ status: 'ready', data: list, stale: false, error: null })
    expect(cache()).toMatchObject({ userId: 'u1', friends: list })
  })

  it('opens with the saved copy, stale until the server answers', async () => {
    const old = [friendOf(BIA, 'Bia')]
    localStorage.setItem('perf_social_v1', JSON.stringify({ userId: 'u1', friends: old }))
    let answer!: (v: unknown) => void
    api.getFriends.mockReturnValue(new Promise(r => { answer = r }))
    useSocial.getState().bind('u1')
    const loading = useSocial.getState().load('friends')
    expect(useSocial.getState().friends).toMatchObject({ status: 'ready', data: old, stale: true })
    answer([])
    await loading
    expect(useSocial.getState().friends).toMatchObject({ data: [], stale: false })
  })

  it('keeps the saved copy offline and says why; errors without one', async () => {
    api.getFriends.mockRejectedValue(new SocialError('network'))
    useSocial.getState().bind('u1')
    await useSocial.getState().load('friends')
    expect(useSocial.getState().friends).toEqual({ status: 'error', data: null, stale: false, error: 'network' })
    useSocial.getState().reset()
    localStorage.setItem('perf_social_v1', JSON.stringify({ userId: 'u1', friends: [friendOf(BIA, 'Bia')] }))
    useSocial.getState().bind('u1')
    await useSocial.getState().load('friends')
    expect(useSocial.getState().friends).toMatchObject({ status: 'ready', stale: true, error: 'network' })
  })

  it('ignores a saved copy that belongs to someone else', () => {
    localStorage.setItem('perf_social_v1', JSON.stringify({ userId: 'u2', friends: [friendOf(BIA, 'Bia')] }))
    useSocial.getState().bind('u1')
    expect(useSocial.getState().friends.data).toBeNull()
  })

  it('shares one request between callers', async () => {
    api.getWeeklyLeaderboard.mockResolvedValue({ week_start: '2026-10-05', rows: [] })
    useSocial.getState().bind('u1')
    await Promise.all([useSocial.getState().load('weekly'), useSocial.getState().load('weekly')])
    expect(api.getWeeklyLeaderboard).toHaveBeenCalledTimes(1)
  })

  it('never saves open invites', async () => {
    api.listMyInvites.mockResolvedValue([{ code: 'AbCdEfGh12', created_at: 'x', expires_at: 'y' }])
    useSocial.getState().bind('u1')
    await useSocial.getState().load('invites')
    expect(useSocial.getState().invites.data).toHaveLength(1)
    expect(cache()?.invites).toBeUndefined()
  })

  it('drops an answer that arrives after a sign-out', async () => {
    let answer!: (v: unknown) => void
    api.getFriends.mockReturnValue(new Promise(r => { answer = r }))
    useSocial.getState().bind('u1')
    const loading = useSocial.getState().load('friends')
    useSocial.getState().reset()
    answer([friendOf(BIA, 'Bia')])
    await loading
    expect(useSocial.getState()).toMatchObject({ userId: null, friends: { status: 'idle', data: null } })
    expect(localStorage.getItem('perf_social_v1')).toBeNull()
  })

  it('pages the feed', async () => {
    api.getFeed
      .mockResolvedValueOnce({ items: [feedItemOf(3), feedItemOf(2)], next: { before: 't2', before_id: 2 } })
      .mockResolvedValueOnce({ items: [feedItemOf(1)], next: null })
    useSocial.getState().bind('u1')
    await useSocial.getState().loadFeed()
    await useSocial.getState().loadFeed(true)
    expect(api.getFeed).toHaveBeenNthCalledWith(1, null)
    expect(api.getFeed).toHaveBeenNthCalledWith(2, { before: 't2', before_id: 2 })
    expect(useSocial.getState().feed).toMatchObject({ status: 'ready', next: null, busy: false })
    expect(useSocial.getState().feed.items.map(i => i.id)).toEqual([3, 2, 1])
    await useSocial.getState().loadFeed(true)
    expect(api.getFeed).toHaveBeenCalledTimes(2)
  })

  it('loads challenges on bind and refreshes progress after a win closed since last time', async () => {
    localStorage.setItem('perf_social_v1', JSON.stringify({ userId: 'u1', challenges: [challengeOf()] }))
    api.getChallenges.mockResolvedValue([challengeOf({ status: 'won', me: { joined: true, won: true } })])
    useSocial.getState().bind('u1')
    await flush()
    expect(api.getChallenges).toHaveBeenCalledTimes(1)
    expect(progress.refresh).toHaveBeenCalledTimes(1)
    useSocial.getState().reset()
    localStorage.setItem('perf_social_v1', JSON.stringify({ userId: 'u1', challenges: [challengeOf({ status: 'won', me: { joined: true, won: true } })] }))
    useSocial.getState().bind('u1')
    await flush()
    expect(progress.refresh).toHaveBeenCalledTimes(1)
  })
})
```

Run: `npx vitest run src/features/social/useSocial.test.ts`
Expected: FAIL (`Cannot find module './useSocial'`).

- [ ] **Step 2: Implementar**

Criar `src/features/social/useSocial.ts`:

```ts
import { create } from 'zustand'
import * as api from './social-api'
import { toSocialError } from './social-api'
import { useProgress } from '../gamification/useProgress'
import type { Challenge, FeedCursor, FeedItem, Friend, Leaderboard, MyInvite, SocialErrorCode } from './types'

export type ListKey = 'friends' | 'invites' | 'weekly' | 'alltime' | 'challenges'
type Lists = { friends: Friend[]; invites: MyInvite[]; weekly: Leaderboard; alltime: Leaderboard; challenges: Challenge[] }

export type Resource<T> = { status: 'idle' | 'loading' | 'ready' | 'error'; data: T | null; stale: boolean; error: SocialErrorCode | null }
export type FeedState = {
  status: Resource<unknown>['status']
  items: FeedItem[]
  next: FeedCursor | null
  stale: boolean
  error: SocialErrorCode | null
  busy: boolean
}

const CACHE = 'perf_social_v1'
// Open invites are not kept: they are only useful fresh, and the list is short.
const CACHED: readonly ListKey[] = ['friends', 'weekly', 'alltime', 'challenges']
const FETCH: { [K in ListKey]: () => Promise<Lists[K]> } = {
  friends: api.getFriends,
  invites: () => api.listMyInvites(),
  weekly: api.getWeeklyLeaderboard,
  alltime: api.getAlltimeLeaderboard,
  challenges: api.getChallenges
}

type Saved = { userId: string; feed?: FeedItem[] } & Partial<Omit<Lists, 'invites'>>
const readSaved = (userId: string): Saved | null => {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE) || 'null')
    return c && c.userId === userId ? (c as Saved) : null
  } catch { return null }
}
const save = (userId: string, patch: Omit<Partial<Saved>, 'userId'>) => {
  try { localStorage.setItem(CACHE, JSON.stringify({ ...(readSaved(userId) ?? {}), ...patch, userId })) } catch { /* full or blocked */ }
}
const drop = () => { try { localStorage.removeItem(CACHE) } catch { /* ignore */ } }

const idle = <T>(): Resource<T> => ({ status: 'idle', data: null, stale: false, error: null })
const fromSaved = <T>(v: T | undefined): Resource<T> => (v ? { status: 'ready', data: v, stale: true, error: null } : idle<T>())
const idleFeed = (): FeedState => ({ status: 'idle', items: [], next: null, stale: false, error: null, busy: false })

interface SocialStore {
  userId: string | null
  friends: Resource<Friend[]>
  invites: Resource<MyInvite[]>
  weekly: Resource<Leaderboard>
  alltime: Resource<Leaderboard>
  challenges: Resource<Challenge[]>
  feed: FeedState
  bind(userId: string): void
  load<K extends ListKey>(key: K): Promise<Lists[K] | null>
  loadFeed(more?: boolean): Promise<void>
  reset(): void
}

const running = new Map<ListKey, Promise<unknown>>()

export const useSocial = create<SocialStore>((set, get) => {
  const put = (key: ListKey, value: Resource<unknown>) => set({ [key]: value } as unknown as Partial<SocialStore>)

  return {
    userId: null,
    friends: idle(),
    invites: idle(),
    weekly: idle(),
    alltime: idle(),
    challenges: idle(),
    feed: idleFeed(),

    // Called once a signed-in account has a ready profile (App.jsx): the saved copy at once, then
    // the challenges from the server. get_challenges closes due ones (Decision 12), so a win that
    // closed since the last visit is followed by a progress refresh, which celebrates it.
    bind(userId) {
      if (get().userId === userId) return
      const saved = readSaved(userId)
      set({
        userId,
        friends: fromSaved(saved?.friends),
        invites: idle(),
        weekly: fromSaved(saved?.weekly),
        alltime: fromSaved(saved?.alltime),
        challenges: fromSaved(saved?.challenges),
        feed: saved?.feed?.length ? { ...idleFeed(), status: 'ready', items: saved.feed, stale: true } : idleFeed()
      })
      const closedBefore = new Set((saved?.challenges ?? []).filter(c => c.status !== 'active').map(c => c.id))
      void get().load('challenges').then(list => {
        if (list?.some(c => c.status !== 'active' && c.me.won && !closedBefore.has(c.id))) void useProgress.getState().refresh()
      })
    },

    // One request per list at a time; callers that arrive meanwhile share it.
    load<K extends ListKey>(key: K): Promise<Lists[K] | null> {
      const inFlight = running.get(key)
      if (inFlight) return inFlight as Promise<Lists[K] | null>
      const userId = get().userId
      if (!userId) return Promise.resolve(null)
      const job = (async (): Promise<Lists[K] | null> => {
        const cur = get()[key] as Resource<Lists[K]>
        if (!cur.data) put(key, { ...cur, status: 'loading', error: null })
        try {
          const data = await FETCH[key]()
          if (get().userId !== userId) return null
          put(key, { status: 'ready', data, stale: false, error: null })
          if (CACHED.includes(key)) save(userId, { [key]: data } as Omit<Partial<Saved>, 'userId'>)
          return data
        } catch (e) {
          if (get().userId !== userId) return null
          const error = toSocialError(e).code
          const now = get()[key] as Resource<Lists[K]>
          put(key, now.data ? { ...now, status: 'ready', stale: true, error } : { status: 'error', data: null, stale: false, error })
          return null
        } finally {
          running.delete(key)
        }
      })()
      running.set(key, job)
      return job
    },

    // First page, or the next one after what is on screen.
    async loadFeed(more = false) {
      const { userId, feed } = get()
      if (!userId || feed.busy || (more && !feed.next)) return
      set({ feed: { ...feed, status: feed.items.length ? feed.status : 'loading', busy: true, error: null } })
      try {
        const page = await api.getFeed(more ? feed.next : null)
        if (get().userId !== userId) return
        const items = more ? [...get().feed.items, ...page.items] : page.items
        set({ feed: { status: 'ready', items, next: page.next, stale: false, error: null, busy: false } })
        if (!more) save(userId, { feed: page.items })
      } catch (e) {
        if (get().userId !== userId) return
        const error = toSocialError(e).code
        set(s => ({
          feed: s.feed.items.length
            ? { ...s.feed, status: 'ready', stale: s.feed.stale || !more, error, busy: false }
            : { ...idleFeed(), status: 'error', error }
        }))
      }
    },

    reset() {
      running.clear()
      drop()
      set({ userId: null, friends: idle(), invites: idle(), weekly: idle(), alltime: idle(), challenges: idle(), feed: idleFeed() })
    }
  }
})
```

- [ ] **Step 3: Rodar e ver passar**

Run: `npx vitest run src/features/social/useSocial.test.ts`
Expected: PASS.

- [ ] **Step 4: Ligar ao `App` e ao logout**

Em `src/App.jsx`, acrescentar o import:

```jsx
import { useSocial } from './features/social/useSocial.ts'
```

Trocar a linha (deixada assim pela 1a, Task 8)

```jsx
  useEffect(() => { if (!user) { useProfile.getState().reset(); useProgress.getState().reset() } }, [user?.id])
```

por

```jsx
  useEffect(() => {
    if (!user) { useProfile.getState().reset(); useProgress.getState().reset(); useSocial.getState().reset() }
  }, [user?.id])
```

e, logo depois do `useEffect` que carrega o progresso (1a, Task 8, Step 6), acrescentar:

```jsx
  // Friends, rankings, challenges and feed for this account: the saved copy at once; the
  // challenges right away (tab badge, and due ones close on the server).
  useEffect(() => {
    if (user && profileReady) useSocial.getState().bind(user.id)
  }, [user?.id, profileReady])
```

Em `src/main.jsx`, acrescentar o import

```jsx
import { clearPendingInvite } from './features/social/pending-invite.ts'
```

e trocar a linha

```jsx
supabase.auth.onAuthStateChange(event => { if (event === 'SIGNED_OUT') clearEventQueue() })
```

por

```jsx
supabase.auth.onAuthStateChange(event => { if (event === 'SIGNED_OUT') { clearEventQueue(); clearPendingInvite() } })
```

- [ ] **Step 5: Verificar e commitar**

```bash
npm run typecheck && npm test && npm run build
git add src/features/social/useSocial.ts src/features/social/useSocial.test.ts src/App.jsx src/main.jsx
git commit -m "feat(social): social store with offline copy, bound to the signed-in account

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Textos da 1b nos 16 idiomas, rótulos e galeria

**Files:**
- Modify: `src/locales/pt-BR.js` (`PT_BR_OVERRIDES`), `src/locales/pt.js` e os outros 14 packs: `ar.js`, `de.js`, `es.js`, `fr.js`, `hi.js`, `hu.js`, `it.js`, `ko.js`, `pl.js`, `ru.js`, `th.js`, `tr.js`, `uk.js`, `zh.js`
- Create: `src/features/social/format.ts`, `src/features/social/labels.ts`
- Modify: `src/features/gamification/AchievementsScreen.tsx`, `src/features/gamification/AchievementsScreen.test.tsx` (1a)
- Test: `src/features/social/labels.test.ts`

**Interfaces:**
- Consumes: `SocialErrorCode`, `ChallengeTemplate`, `ChallengeMode` (Task 5); `t`, `dateLocale` de `src/lib/i18n.js`.
- Produces: todas as chaves abaixo nos 16 packs (as Tasks 8–13 usam exatamente estas chaves inglesas); `fmtShortDay(iso)`, `fmtTime(iso)`, `fmtDecimal(n)` (`format.ts`); `socialErrorText(code)`, `TEMPLATE_TEXT`, `MODE_TEXT`, `amountText(template, n)`, `autoTitle(template, target, days)` (`labels.ts`).

Chaves que já existem e são reutilizadas sem mexer nos packs: `'Back'`, `'Cancel'`, `'Remove'`,
`'Continue with Google'`, `'Opening Google…'`, `'Could not start sign-in. Try again.'`, `'Sign in'`,
`'Copy link'`, `'Duration'`, `'Goal'`, `'Less'`, `'More'`, `'Today'`, `'This week'`, `'Try again'`,
`'Loading…'`, `'You'`, `'Workouts'`, `'Week streak'`, `'{0} week streak'`, `'{0} workouts'`,
`'{0} sets'`, `'Exercises'`, `'Home'`, `'Plan'`, `'Start'`, `'Stats'`, `'Resume'`, `'Workout'`,
`'Edit workout'` (legado) e `'Level {0}'`, `'{0} XP to level {1}'`, `'{0} of {1}'`,
`'{0} of {1} unlocked'`, `'Achievements'`, `'Locked'` (1a, Task 9).

- [ ] **Step 1: Chaves novas**

| # | Chave (inglês, é o texto em inglês) | pt-BR |
|---|---|---|
| 1 | `Social` | `Social` |
| 2 | `Social. Challenge invitations: {0}` | `Social. Convites de desafio: {0}` |
| 3 | `Ranking` | `Ranking` |
| 4 | `Challenges` | `Desafios` |
| 5 | `Feed` | `Feed` |
| 6 | `Friends` | `Amigos` |
| 7 | `Offline. Showing what was saved last.` | `Sem conexão. Mostrando o que foi salvo por último.` |
| 8 | `This invite link does not work. Check that it was copied in full.` | `Este link de convite não funciona. Confira se ele foi copiado inteiro.` |
| 9 | `This invite has expired. Ask for a new link.` | `Este convite expirou. Peça um link novo.` |
| 10 | `Someone already used this invite. Ask for a new link.` | `Alguém já usou este convite. Peça um link novo.` |
| 11 | `This is your own invite. Send it to a friend.` | `Este convite é seu. Mande para um amigo.` |
| 12 | `You are already friends.` | `Vocês já são amigos.` |
| 13 | `You have 5 open invites. Cancel one or wait for one to expire.` | `Você tem 5 convites abertos. Cancele um ou espere algum expirar.` |
| 14 | `You can only invite friends to a challenge.` | `Só dá para chamar amigos para um desafio.` |
| 15 | `Check the challenge settings and try again.` | `Confira os dados do desafio e tente de novo.` |
| 16 | `You already have 10 challenges in progress.` | `Você já tem 10 desafios em andamento.` |
| 17 | `This challenge is no longer available.` | `Este desafio não está mais disponível.` |
| 18 | `This challenge has already ended.` | `Este desafio já terminou.` |
| 19 | `To join, agree to share your volume.` | `Para entrar, aceite compartilhar seu volume.` |
| 20 | `Sign in again to continue.` | `Entre de novo para continuar.` |
| 21 | `Could not reach the server. Check your connection and try again.` | `Não deu para falar com o servidor. Confira a conexão e tente de novo.` |
| 22 | `Invite a friend` | `Convidar amigo` |
| 23 | `Train with me on Performance. Open the link to become friends:` | `Bora treinar junto no Performance? Abra o link para a gente virar amigos:` |
| 24 | `Invite link copied` | `Link do convite copiado` |
| 25 | `Invite link` | `Link do convite` |
| 26 | `Copy the link and send it to your friend.` | `Copie o link e mande para seu amigo.` |
| 27 | `Open invites` | `Convites abertos` |
| 28 | `Expires {0}` | `Expira em {0}` |
| 29 | `Share again` | `Compartilhar de novo` |
| 30 | `Cancel invite` | `Cancelar convite` |
| 31 | `Training together pays off` | `Treinar junto rende mais` |
| 32 | `Invite a friend with a link. Once they join, you both show up in the ranking.` | `Convide um amigo com um link. Quando ele entrar, vocês dois aparecem no ranking.` |
| 33 | `{0} XP this week` | `{0} XP na semana` |
| 34 | `{0} XP` | `{0} XP` |
| 35 | `Friends since {0}` | `Amigos desde {0}` |
| 36 | `Remove friend` | `Desfazer amizade` |
| 37 | `Remove {0} as a friend? You will no longer see each other in the ranking or the feed.` | `Desfazer a amizade com {0}? Vocês deixam de se ver no ranking e no feed.` |
| 38 | `{0} removed from your friends` | `{0} saiu da sua lista de amigos` |
| 39 | `{0} invited you to train together` | `{0} chamou você para treinar junto` |
| 40 | `See how consistent you both are, compete in the weekly ranking and take on challenges together.` | `Vocês acompanham a consistência um do outro, disputam o ranking da semana e encaram desafios juntos.` |
| 41 | `Your weight, diet and loads stay private.` | `Seu peso, sua dieta e suas cargas continuam só seus.` |
| 42 | `Accept invite` | `Aceitar convite` |
| 43 | `Becoming friends…` | `Criando a amizade…` |
| 44 | `You are friends now` | `Agora vocês são amigos` |
| 45 | `{0} is in your ranking now.` | `{0} já aparece no seu ranking.` |
| 46 | `See ranking` | `Ver ranking` |
| 47 | `Create a challenge` | `Criar um desafio` |
| 48 | `Go to Home` | `Ir para o início` |
| 49 | `All time` | `Geral` |
| 50 | `Resets every Monday. Any plan pays up to 960 XP a week, so it is fair for everyone.` | `Zera toda segunda. Qualquer plano rende até 960 XP por semana, então a disputa é justa.` |
| 51 | `By total XP since the start.` | `Pelo XP total desde o começo.` |
| 52 | `Position {0}` | `Posição {0}` |
| 53 | `Up {0} since last week` | `Subiu {0} desde a semana passada` |
| 54 | `Down {0} since last week` | `Caiu {0} desde a semana passada` |
| 55 | `{0} XP to pass {1}` | `Faltam {0} XP para passar {1}` |
| 56 | `You are in the lead.` | `Você está na frente.` |
| 57 | `Rankings are better with company` | `Ranking bom tem companhia` |
| 58 | `Invite friends to compete for the week. Only friends see where you stand.` | `Convide amigos para disputar a semana. Só eles veem a sua posição.` |
| 59 | `New challenge` | `Novo desafio` |
| 60 | `Add a friend to create challenges.` | `Adicione um amigo para criar desafios.` |
| 61 | `Invitations` | `Convites` |
| 62 | `In progress` | `Em andamento` |
| 63 | `Finished` | `Encerrados` |
| 64 | `No challenges yet` | `Nenhum desafio ainda` |
| 65 | `Bring friends together around a goal with a deadline. Everyone who completes it earns 300 XP.` | `Junte amigos em torno de uma meta com prazo. Quem cumprir ganha 300 XP.` |
| 66 | `{0} invited you` | `{0} chamou você` |
| 67 | `{0} days left` | `Faltam {0} dias` |
| 68 | `Ends today` | `Termina hoje` |
| 69 | `Starts {0}` | `Começa em {0}` |
| 70 | `Completed` | `Cumprido` |
| 71 | `Not this time` | `Não foi dessa vez` |
| 72 | `Cancelled` | `Cancelado` |
| 73 | `Workouts in the period` | `Treinos no período` |
| 74 | `Every workout finished in the period counts.` | `Conta cada treino concluído no período.` |
| 75 | `Weeks on target` | `Semanas na meta` |
| 76 | `Weeks in the period in which each person meets their own weekly goal.` | `Semanas do período em que cada pessoa cumpre a própria meta semanal.` |
| 77 | `Total volume` | `Volume total` |
| 78 | `Weight lifted in the period, in tonnes. Only people who agree share their volume.` | `Peso levantado no período, em toneladas. Só conta o volume de quem aceitar compartilhar.` |
| 79 | `Team` | `Equipe` |
| 80 | `Everyone adds up toward one goal.` | `Todo mundo soma para uma meta só.` |
| 81 | `Solo` | `Individual` |
| 82 | `Each person has to reach the goal.` | `Cada pessoa precisa bater a meta.` |
| 83 | `1 workout` | `1 treino` |
| 84 | `1 week` | `1 semana` |
| 85 | `{0} weeks` | `{0} semanas` |
| 86 | `{0} t` | `{0} t` |
| 87 | `{0} workouts in {1} days` | `{0} treinos em {1} dias` |
| 88 | `{0} weeks on target` | `{0} semanas na meta` |
| 89 | `{0} t in {1} days` | `{0} t em {1} dias` |
| 90 | `What counts` | `O que conta` |
| 91 | `Format` | `Formato` |
| 92 | `Only solo for this goal: each person has their own weekly goal.` | `Esta meta é só individual: cada pessoa tem a própria meta semanal.` |
| 93 | `{0} days` | `{0} dias` |
| 94 | `Starts` | `Começa` |
| 95 | `Next Monday` | `Na segunda` |
| 96 | `{0} to {1}` | `{0} a {1}` |
| 97 | `Who joins` | `Quem participa` |
| 98 | `Up to {0} friends.` | `Até {0} amigos.` |
| 99 | `Share my volume in this challenge` | `Compartilhar meu volume neste desafio` |
| 100 | `People in this challenge see how many tonnes you lift. Never the load of each exercise.` | `Quem está no desafio vê quantas toneladas você levantou. Nunca a carga de cada exercício.` |
| 101 | `Challenge name` | `Nome do desafio` |
| 102 | `Pick at least one friend.` | `Escolha pelo menos um amigo.` |
| 103 | `Agree to share your volume to create this challenge.` | `Aceite compartilhar seu volume para criar este desafio.` |
| 104 | `Create challenge` | `Criar desafio` |
| 105 | `Challenge created. Your friends got the invite.` | `Desafio criado. Seus amigos já receberam o convite.` |
| 106 | `Team total` | `Total da equipe` |
| 107 | `Your progress` | `Seu progresso` |
| 108 | `Goal: {0}` | `Meta: {0}` |
| 109 | `Members` | `Participantes` |
| 110 | `Invited` | `Convidado` |
| 111 | `Reached the goal` | `Bateu a meta` |
| 112 | `Join challenge` | `Entrar no desafio` |
| 113 | `Decline` | `Recusar` |
| 114 | `Invitation declined` | `Convite recusado` |
| 115 | `You joined the challenge` | `Você entrou no desafio` |
| 116 | `Leave challenge` | `Sair do desafio` |
| 117 | `Leave this challenge? Your progress stops counting for it.` | `Sair deste desafio? Seu progresso deixa de contar para ele.` |
| 118 | `Leave` | `Sair` |
| 119 | `You left the challenge` | `Você saiu do desafio` |
| 120 | `Challenge completed! +300 XP` | `Desafio cumprido! +300 XP` |
| 121 | `You did not reach the goal this time.` | `Desta vez você não bateu a meta.` |
| 122 | `The goal was not reached this time.` | `Desta vez a meta não foi batida.` |
| 123 | `Cancelled: fewer than 2 people joined.` | `Cancelado: menos de 2 pessoas entraram.` |
| 124 | `Your workouts are hidden from friends.` | `Seus treinos não aparecem para os amigos.` |
| 125 | `Turn on sharing` | `Ligar compartilhamento` |
| 126 | `Nothing here yet` | `Nada por aqui ainda` |
| 127 | `Friends who turn on sharing in their profile show up here after each workout.` | `Amigos que ligam o compartilhamento no perfil aparecem aqui depois de cada treino.` |
| 128 | `{0} finished a workout` | `{0} concluiu um treino` |
| 129 | `PR: {0}` | `Recorde: {0}` |
| 130 | `New personal record` | `Novo recorde pessoal` |
| 131 | `Yesterday` | `Ontem` |
| 132 | `Load more` | `Carregar mais` |
| 133 | `You are all caught up.` | `Você já viu tudo.` |

- [ ] **Step 2: Humanizer**

Rodar a skill `anthropic-skills:humanizer` sobre a coluna pt-BR e a skill `humanizer` sobre a coluna
inglesa. Ajustar a redação em pt-BR livremente. Uma mudança de chave inglesa vale a partir daqui e
precisa ser propagada para todos os usos nas Tasks 8–13 e nos testes delas (buscar a chave antiga
neste plano); por isso, mexer numa chave inglesa só se ela tiver vício de texto de IA. Nenhum valor
pode ter `—`, `–` ou ` - `.

- [ ] **Step 3: Escrever nos packs**

Antes, para cada chave da tabela, conferir que ela ainda não existe:
`grep -n "^  'Yesterday':" src/locales/pt.js` (e assim por diante). Se alguma já existir no pack
(texto herdado do openGym), não duplicar: só acrescentar em `PT_BR_OVERRIDES` se a tradução
pt-BR existente for pior que a da tabela.

- `src/locales/pt-BR.js`: acrescentar as linhas ao fim de `PT_BR_OVERRIDES`, depois de um comentário `// Phase 1b: social`, no formato `'Invite a friend': 'Convidar amigo',` (aspas simples; escapar `'` como `\'`).
- `src/locales/pt.js`: as mesmas chaves ao fim do objeto exportado, em português europeu (a maior parte igual ao pt-BR; trocar "você"/"vocês" por construções sem pronome ou "tu"/"vocês" conforme o pack já faz, "Bora treinar junto" por "Vamos treinar juntos", "Compartilhar" por "Partilhar", "Confira" por "Confirma", "Peça" por "Pede", "Mande" por "Envia", "Cancele" por "Cancela", "Copie" por "Copia", "Escolha" por "Escolhe", "Aceite" por "Aceita", "Convide" por "Convida", "Adicione" por "Adiciona", "Junte" por "Junta", "Entre" por "Entra"). O teste `src/lib/pt-br-locale.test.js` exige o mesmo conjunto de chaves em `pt.js` e `pt-BR.js`.
- Os outros 14 packs: as chaves ao fim de cada objeto exportado, com tradução real para o idioma do arquivo, preservando `{0}`/`{1}`, `+300 XP`, `960 XP`, `t` (tonelada) e `…` exatamente. Sem travessão como pausa também nesses idiomas.

- [ ] **Step 4: `format.ts` e `labels.ts`, teste que falha**

Criar `src/features/social/labels.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { amountText, autoTitle, socialErrorText, MODE_TEXT, TEMPLATE_TEXT } from './labels'
import type { SocialErrorCode } from './types'

const CODES: SocialErrorCode[] = [
  'not_signed_in', 'no_profile', 'invite_not_found', 'invite_expired', 'invite_used', 'self_invite',
  'already_friends', 'invite_limit', 'not_friends', 'invalid_challenge', 'challenge_limit',
  'challenge_not_found', 'challenge_closed', 'volume_opt_in_required', 'network'
]

describe('social labels', () => {
  it('has a human message for every error code', () => {
    for (const code of CODES) expect(socialErrorText(code).trim(), code).not.toBe('')
    expect(socialErrorText('invite_expired')).toBe('This invite has expired. Ask for a new link.')
    expect(socialErrorText('network')).toBe('Could not reach the server. Check your connection and try again.')
  })

  it('names templates and modes', () => {
    expect(TEMPLATE_TEXT.volume_total.name()).toBe('Total volume')
    expect(MODE_TEXT.solo.name()).toBe('Solo')
  })

  it('writes amounts in the unit of each template', () => {
    expect(amountText('workouts_count', 1)).toBe('1 workout')
    expect(amountText('workouts_count', 12)).toBe('12 workouts')
    expect(amountText('weeks_on_target', 1)).toBe('1 week')
    expect(amountText('weeks_on_target', 3)).toBe('3 weeks')
    expect(amountText('volume_total', 12.5)).toBe('12.5 t')
  })

  it('names a challenge from its shape', () => {
    expect(autoTitle('workouts_count', 12, 30)).toBe('12 workouts in 30 days')
    expect(autoTitle('weeks_on_target', 4, 30)).toBe('4 weeks on target')
    expect(autoTitle('volume_total', 40, 30)).toBe('40 t in 30 days')
  })
})
```

Run: `npx vitest run src/features/social/labels.test.ts`
Expected: FAIL (`Cannot find module './labels'`).

Criar `src/features/social/format.ts`:

```ts
import { dateLocale } from '../../lib/i18n.js'

// Local calendar days (YYYY-MM-DD) are read at noon, so no time zone moves them a day.
const asDate = (iso: string) => new Date(iso.length === 10 ? iso + 'T12:00:00' : iso)

export const fmtShortDay = (iso: string): string => asDate(iso).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short' })
export const fmtTime = (iso: string): string => new Date(iso).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' })
export const fmtDecimal = (n: number): string => n.toLocaleString(dateLocale(), { maximumFractionDigits: 1 })
```

Criar `src/features/social/labels.ts`:

```ts
import { Dumbbell, Target, Weight, type LucideIcon } from 'lucide-react'
import { t } from '../../lib/i18n.js'
import { fmtDecimal } from './format'
import type { ChallengeMode, ChallengeTemplate, SocialErrorCode } from './types'

// Every typed error of the social RPCs (Decision 4) as a sentence a person can act on.
export function socialErrorText(code: SocialErrorCode): string {
  switch (code) {
    case 'invite_not_found': return t('This invite link does not work. Check that it was copied in full.')
    case 'invite_expired': return t('This invite has expired. Ask for a new link.')
    case 'invite_used': return t('Someone already used this invite. Ask for a new link.')
    case 'self_invite': return t('This is your own invite. Send it to a friend.')
    case 'already_friends': return t('You are already friends.')
    case 'invite_limit': return t('You have 5 open invites. Cancel one or wait for one to expire.')
    case 'not_friends': return t('You can only invite friends to a challenge.')
    case 'invalid_challenge': return t('Check the challenge settings and try again.')
    case 'challenge_limit': return t('You already have 10 challenges in progress.')
    case 'challenge_not_found': return t('This challenge is no longer available.')
    case 'challenge_closed': return t('This challenge has already ended.')
    case 'volume_opt_in_required': return t('To join, agree to share your volume.')
    case 'not_signed_in':
    case 'no_profile': return t('Sign in again to continue.')
    default: return t('Could not reach the server. Check your connection and try again.')
  }
}

// Functions, so each t() stays a literal scripts/check-source-strings.mjs can see and the text
// follows the language picked at render time.
export const TEMPLATE_TEXT: Record<ChallengeTemplate, { name: () => string; rule: () => string; icon: LucideIcon }> = {
  workouts_count: { name: () => t('Workouts in the period'), rule: () => t('Every workout finished in the period counts.'), icon: Dumbbell },
  weeks_on_target: { name: () => t('Weeks on target'), rule: () => t('Weeks in the period in which each person meets their own weekly goal.'), icon: Target },
  volume_total: { name: () => t('Total volume'), rule: () => t('Weight lifted in the period, in tonnes. Only people who agree share their volume.'), icon: Weight }
}

export const MODE_TEXT: Record<ChallengeMode, { name: () => string; detail: () => string }> = {
  team: { name: () => t('Team'), detail: () => t('Everyone adds up toward one goal.') },
  solo: { name: () => t('Solo'), detail: () => t('Each person has to reach the goal.') }
}

// "1 workout", "12 workouts", "3 weeks", "12.5 t".
export function amountText(template: ChallengeTemplate, n: number): string {
  if (template === 'workouts_count') return n === 1 ? t('1 workout') : t('{0} workouts', n)
  if (template === 'weeks_on_target') return n === 1 ? t('1 week') : t('{0} weeks', n)
  return t('{0} t', fmtDecimal(n))
}

// The name a new challenge gets until the person writes their own.
export function autoTitle(template: ChallengeTemplate, target: number, days: number): string {
  if (template === 'workouts_count') return t('{0} workouts in {1} days', target, days)
  if (template === 'weeks_on_target') return t('{0} weeks on target', target)
  return t('{0} t in {1} days', fmtDecimal(target), days)
}
```

(Se `Weight` não existir na versão instalada do `lucide-react`, usar `Dumbbell` para `workouts_count` e `Layers` para `volume_total`; conferir com `node -e "console.log(!!require('lucide-react').Weight)"`.)

- [ ] **Step 5: Galeria de conquistas da 1a**

Em `src/features/gamification/AchievementsScreen.tsx` (1a, Task 13):

1. No import de `./achievements`, tirar `SOCIAL_METRICS`: `import { ACHIEVEMENTS, type Achievement } from './achievements'`.
2. Em `Tile`, apagar a linha `const social = SOCIAL_METRICS.includes(a.metric)`.
3. No rodapé do `Tile`, apagar o ramo

```tsx
        ) : social ? (
          <span>{t('Unlocks once friends arrive in the app.')}</span>
```

deixando a sequência `at !== null ? (...) : typeof value === 'number' ? (...) : (<span>{t('Locked')}</span>)`.

Em `src/features/gamification/AchievementsScreen.test.tsx`, trocar

```ts
    expect(within(card('first_friend')).getByText('Unlocks once friends arrive in the app.')).toBeTruthy()
```

por

```ts
    expect(within(card('first_friend')).getByText('Locked')).toBeTruthy()
```

e acrescentar ao fim do `describe`:

```ts
  it('shows how far along the social badges are once the server counts them', () => {
    useProgress.setState({ status: 'ready', progress: progressOf(0, {}, { stats: { friends: 0, challenges_won: 3 } }) })
    render(<AchievementsScreen />)
    expect(within(card('first_friend')).getByText('0 of 1')).toBeTruthy()
    expect(within(card('challenge_won_5')).getByText('3 of 5')).toBeTruthy()
  })
```

Tirar a chave `'Unlocks once friends arrive in the app.'` dos 16 packs (ela deixa de ser usada).

- [ ] **Step 6: Rodar e ver passar**

```bash
npx vitest run src/features/social/labels.test.ts src/features/gamification/AchievementsScreen.test.tsx src/lib/pt-br-locale.test.js src/lib/public-copy.test.js src/lib/locale-coverage.test.js
node scripts/check-locales.mjs
node scripts/check-source-strings.mjs --strict
```

Expected: tudo verde. `check-source-strings` ainda não vê as chaves das telas (elas chegam nas
Tasks 8–13), mas todas já estão nos packs, então nada falta nem sobra de forma que quebre os scripts.

- [ ] **Step 7: Commit**

```bash
npm run typecheck && npm test && npm run build
git add src/locales src/features/social/labels.ts src/features/social/labels.test.ts src/features/social/format.ts src/features/gamification/AchievementsScreen.tsx src/features/gamification/AchievementsScreen.test.tsx
git commit -m "feat(i18n): social copy in all locale packs and social badge progress

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Peças compartilhadas e tela Amigos

**Files:**
- Create: `src/features/social/components/PersonAvatar.tsx`, `components/states.tsx`, `components/LinkDrawer.tsx`
- Create: `src/features/social/InviteButton.tsx`, `src/features/social/FriendsPanel.tsx`
- Create: `src/features/social/test-drawer.tsx` (substituto do Drawer nos testes)
- Test: `src/features/social/FriendsPanel.test.tsx`

**Interfaces:**
- Consumes: `useSocial` (Task 6); `createInvite`, `cancelInvite`, `removeFriend`, `toSocialError` (Task 5); `inviteUrl` (Task 5); `shareLink` (Task 5); `socialErrorText` (Task 7); `LevelBar`, `AchievementIcon`, `ACHIEVEMENTS`, `ACHIEVEMENT_TEXT`, `fmtInt`, `fmtDay` (1a); `useOnline` (1a, `src/lib/use-online.ts`); `useStore` (`user.id`).
- Produces:
  - `<PersonAvatar name src className? />` (foto com iniciais de reserva);
  - `<ListSkeleton rows? />`, `<ErrorState code onRetry />`, `<EmptyState icon title body? children? />`, `<StaleNote stale />`;
  - `<LinkDrawer url onClose />`;
  - `useOfferLink(): { offer(code: string): Promise<void>; drawer: ReactNode }`, `<InviteButton className? variant? />`;
  - `FriendsPanel` (default export), com `FriendSheet` interno (cartão do amigo e desfazer amizade).

- [ ] **Step 1: Teste que falha**

Criar `src/features/social/test-drawer.tsx`:

```tsx
import type { ReactNode } from 'react'

// Stand-in for components/ui/drawer in tests: vaul measures layout and pointer movement, which
// happy-dom does not have. An open drawer renders in place as a dialog.
type P = { children?: ReactNode; className?: string }
export function Drawer({ open, children }: { open?: boolean; onOpenChange?: (open: boolean) => void; children?: ReactNode }) {
  return open ? <div role="dialog">{children}</div> : null
}
export const DrawerContent = ({ children }: P) => <>{children}</>
export const DrawerHeader = ({ children }: P) => <div>{children}</div>
export const DrawerFooter = ({ children }: P) => <div>{children}</div>
export const DrawerTitle = ({ children }: P) => <h2>{children}</h2>
export const DrawerDescription = ({ children }: P) => <p>{children}</p>
```

Criar `src/features/social/FriendsPanel.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'

const h = vi.hoisted(() => ({
  createInvite: vi.fn(), cancelInvite: vi.fn(), removeFriend: vi.fn(), shareLink: vi.fn(),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() })
}))
vi.mock('./social-api', async orig => ({
  ...(await orig<typeof import('./social-api')>()),
  createInvite: h.createInvite, cancelInvite: h.cancelInvite, removeFriend: h.removeFriend
}))
vi.mock('./share', () => ({ shareLink: h.shareLink }))
vi.mock('sonner', () => ({ toast: h.toast }))
vi.mock('@/components/ui/drawer', () => import('./test-drawer'))

import FriendsPanel from './FriendsPanel'
import { useSocial } from './useSocial'
import { SocialError } from './social-api'
import { useStore } from '../../store/useStore.js'
import { BIA, ME, friendOf } from './test-social'

const realLoad = useSocial.getState().load
const load = vi.fn(async () => null)
const ready = <T,>(data: T) => ({ status: 'ready' as const, data, stale: false, error: null })

beforeEach(() => {
  localStorage.clear()
  useSocial.getState().reset()
  useSocial.setState({ userId: ME, load, invites: ready([]) })
  useStore.setState({ user: { id: ME } })
  load.mockClear()
  ;[h.createInvite, h.cancelInvite, h.removeFriend, h.shareLink, h.toast, h.toast.success, h.toast.error].forEach(f => f.mockReset())
})
afterEach(() => { cleanup(); useSocial.setState({ load: realLoad }); useStore.setState({ user: null }) })

describe('FriendsPanel', () => {
  it('asks for both lists and shows the shape of the list while loading', () => {
    const { container } = render(<FriendsPanel />)
    expect(load).toHaveBeenCalledWith('friends')
    expect(load).toHaveBeenCalledWith('invites')
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy()
  })

  it('offers a retry when the list could not load', () => {
    useSocial.setState({ friends: { status: 'error', data: null, stale: false, error: 'network' } })
    render(<FriendsPanel />)
    expect(screen.getByText('Could not reach the server. Check your connection and try again.')).toBeTruthy()
    load.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(load).toHaveBeenCalledWith('friends')
  })

  it('invites the first friend and copies the link where there is no share sheet', async () => {
    useSocial.setState({ friends: ready([]) })
    h.createInvite.mockResolvedValue({ code: 'AbCdEfGh12', expires_at: '2026-10-12T15:00:00Z' })
    h.shareLink.mockResolvedValue('copied')
    render(<FriendsPanel />)
    expect(screen.getByText('Training together pays off')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Invite a friend' }))
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Invite link copied'))
    expect(h.shareLink.mock.calls[0][0]).toMatch(/#\/convite\/AbCdEfGh12$/)
    expect(load).toHaveBeenCalledWith('invites')
  })

  it('shows the link to copy by hand when nothing else worked', async () => {
    useSocial.setState({ friends: ready([]) })
    h.createInvite.mockResolvedValue({ code: 'AbCdEfGh12', expires_at: '2026-10-12T15:00:00Z' })
    h.shareLink.mockResolvedValue('failed')
    render(<FriendsPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Invite a friend' }))
    expect(await screen.findByDisplayValue(/#\/convite\/AbCdEfGh12$/)).toBeTruthy()
  })

  it('explains why an invite was refused', async () => {
    useSocial.setState({ friends: ready([]) })
    h.createInvite.mockRejectedValue(new SocialError('invite_limit'))
    render(<FriendsPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Invite a friend' }))
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('You have 5 open invites. Cancel one or wait for one to expire.'))
  })

  it('lists friends with level, streak and week XP', () => {
    useSocial.setState({ friends: ready([friendOf(BIA, 'Bia')]) })
    render(<FriendsPanel />)
    const row = screen.getByRole('button', { name: /Bia/ })
    expect(within(row).getByText('Level 3')).toBeTruthy()
    expect(within(row).getByText('3 week streak')).toBeTruthy()
    expect(within(row).getByText('250 XP this week')).toBeTruthy()
  })

  it('opens a friend and removes them after a confirmation', async () => {
    useSocial.setState({ friends: ready([friendOf(BIA, 'Bia')]) })
    h.removeFriend.mockResolvedValue(undefined)
    render(<FriendsPanel />)
    fireEvent.click(screen.getByRole('button', { name: /Bia/ }))
    const sheet = screen.getByRole('dialog')
    expect(within(sheet).getByText(/^Friends since /)).toBeTruthy()
    expect(within(sheet).getByRole('progressbar', { name: 'Level 3' })).toBeTruthy()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Remove friend' }))
    expect(within(sheet).getByText('Remove Bia as a friend? You will no longer see each other in the ranking or the feed.')).toBeTruthy()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(h.removeFriend).toHaveBeenCalledWith(ME, BIA))
    expect(h.toast).toHaveBeenCalledWith('Bia removed from your friends')
  })

  it('cancels an open invite', async () => {
    useSocial.setState({
      friends: ready([friendOf(BIA, 'Bia')]),
      invites: ready([{ code: 'AbCdEfGh12', created_at: '2026-10-05T12:00:00Z', expires_at: '2026-10-12T12:00:00Z' }])
    })
    h.cancelInvite.mockResolvedValue(undefined)
    render(<FriendsPanel />)
    expect(screen.getByText(/^Expires /)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel invite' }))
    await waitFor(() => expect(h.cancelInvite).toHaveBeenCalledWith('AbCdEfGh12'))
    expect(screen.queryByText(/^Expires /)).toBeNull()
  })
})
```

Run: `npx vitest run src/features/social/FriendsPanel.test.tsx`
Expected: FAIL (`Cannot find module './FriendsPanel'`).

- [ ] **Step 2: Peças compartilhadas**

Criar `src/features/social/components/PersonAvatar.tsx`:

```tsx
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'

const initials = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('') || '?'

// Decorative: the name is always written next to it. Google photos refuse some referrers.
export function PersonAvatar({ name, src, className }: { name: string; src: string | null; className?: string }) {
  return (
    <Avatar aria-hidden className={cn('size-11', className)}>
      {src && <AvatarImage src={src} alt="" referrerPolicy="no-referrer" />}
      <AvatarFallback className="bg-secondary font-medium text-foreground">{initials(name)}</AvatarFallback>
    </Avatar>
  )
}
```

Criar `src/features/social/components/states.tsx`:

```tsx
import type { ReactNode } from 'react'
import { CloudOff, RefreshCw, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useOnline } from '@/lib/use-online'
import { t } from '../../../lib/i18n.js'
import { socialErrorText } from '../labels'
import type { SocialErrorCode } from '../types'

// Rows in the shape of the list they stand for: photo, two lines, a number.
export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label={t('Loading…')} className="flex flex-col gap-2">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex min-h-16 items-center gap-3 rounded-2xl bg-card px-3">
          <Skeleton className="size-11 rounded-full" />
          <div className="flex flex-1 flex-col gap-2"><Skeleton className="h-4 w-32" /><Skeleton className="h-3 w-20" /></div>
          <Skeleton className="h-4 w-14" />
        </div>
      ))}
    </div>
  )
}

export function ErrorState({ code, onRetry }: { code: SocialErrorCode; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl border border-border bg-card p-5">
      <p className="text-[15px] font-medium leading-snug">{socialErrorText(code)}</p>
      <Button variant="outline" className="h-11 gap-2 rounded-xl" onClick={onRetry}>
        <RefreshCw aria-hidden className="size-4" />{t('Try again')}
      </Button>
    </div>
  )
}

// An empty list is a starting point: what this place is for and the next step.
export function EmptyState({ icon: Icon, title, body, children }: { icon: LucideIcon; title: string; body?: string; children?: ReactNode }) {
  return (
    <section className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-border px-6 py-8 text-center animate-in fade-in-0 duration-200 motion-reduce:animate-none">
      <span className="grid size-14 place-items-center rounded-2xl bg-primary/15 text-primary">
        <Icon aria-hidden className="size-7" strokeWidth={1.75} />
      </span>
      <h3 className="text-lg font-semibold tracking-tight text-balance">{title}</h3>
      {body && <p className="max-w-xs text-sm leading-relaxed text-muted-foreground text-pretty">{body}</p>}
      {children && <div className="mt-2 w-full">{children}</div>}
    </section>
  )
}

// The saved copy is on screen and the phone is offline: one quiet line, nothing blocks.
export function StaleNote({ stale }: { stale: boolean }) {
  const online = useOnline()
  if (!stale || online) return null
  return (
    <p className="flex items-center gap-2 text-xs text-muted-foreground">
      <CloudOff aria-hidden className="size-3.5" />{t('Offline. Showing what was saved last.')}
    </p>
  )
}
```

Criar `src/features/social/components/LinkDrawer.tsx`:

```tsx
import { useRef } from 'react'
import { toast } from 'sonner'
import { Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { t } from '../../../lib/i18n.js'

// Last resort when neither the share sheet nor the clipboard worked: the link in a field that
// selects itself, ready for a long press and copy.
export function LinkDrawer({ url, onClose }: { url: string | null; onClose: () => void }) {
  const field = useRef<HTMLInputElement>(null)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url ?? '')
      toast.success(t('Invite link copied'))
      onClose()
    } catch {
      field.current?.select()
    }
  }
  return (
    <Drawer open={url !== null} onOpenChange={open => { if (!open) onClose() }}>
      <DrawerContent className="pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <DrawerHeader className="text-left">
          <DrawerTitle>{t('Invite link')}</DrawerTitle>
          <DrawerDescription>{t('Copy the link and send it to your friend.')}</DrawerDescription>
        </DrawerHeader>
        <div className="flex flex-col gap-3 px-4">
          <Input ref={field} readOnly value={url ?? ''} aria-label={t('Invite link')}
            onFocus={e => e.currentTarget.select()} className="h-12 font-mono text-sm" />
          <Button className="h-12 gap-2 rounded-xl" onClick={copy}><Copy aria-hidden className="size-4" />{t('Copy link')}</Button>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
```

Criar `src/features/social/InviteButton.tsx`:

```tsx
import { useState } from 'react'
import { toast } from 'sonner'
import { LoaderCircle, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { t } from '../../lib/i18n.js'
import { createInvite, toSocialError } from './social-api'
import { inviteUrl } from './pending-invite'
import { shareLink } from './share'
import { socialErrorText } from './labels'
import { useSocial } from './useSocial'
import { LinkDrawer } from './components/LinkDrawer'

// Hands an invite link over: the share sheet, else the clipboard (with a toast), else a drawer
// with the link to copy by hand (Decision 16).
export function useOfferLink() {
  const [manual, setManual] = useState<string | null>(null)
  const offer = async (code: string) => {
    const url = inviteUrl(code)
    const outcome = await shareLink(url, t('Train with me on Performance. Open the link to become friends:'))
    if (outcome === 'copied') toast.success(t('Invite link copied'))
    else if (outcome === 'failed') setManual(url)
  }
  return { offer, drawer: <LinkDrawer url={manual} onClose={() => setManual(null)} /> }
}

export function InviteButton({ className, variant = 'default' }: { className?: string; variant?: 'default' | 'outline' }) {
  const [busy, setBusy] = useState(false)
  const { offer, drawer } = useOfferLink()
  const run = async () => {
    setBusy(true)
    try {
      const { code } = await createInvite()
      void useSocial.getState().load('invites')
      await offer(code)
    } catch (e) {
      toast.error(socialErrorText(toSocialError(e).code))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Button variant={variant} onClick={run} disabled={busy} aria-busy={busy}
        className={cn('h-12 w-full gap-2 rounded-2xl text-[15px] font-semibold active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100', className)}>
        {busy ? <LoaderCircle aria-hidden className="size-5 animate-spin motion-reduce:animate-none" /> : <UserPlus aria-hidden className="size-5" />}
        {t('Invite a friend')}
      </Button>
      {drawer}
    </>
  )
}
```

- [ ] **Step 3: `FriendsPanel`**

Criar `src/features/social/FriendsPanel.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ChevronRight, Flame, Link2, Share2, Users, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { useStore } from '../../store/useStore.js'
import { t } from '../../lib/i18n.js'
import { ACHIEVEMENTS, type AchievementCode } from '../gamification/achievements'
import { ACHIEVEMENT_TEXT } from '../gamification/achievement-labels'
import { AchievementIcon } from '../gamification/components/AchievementIcon'
import { LevelBar } from '../gamification/components/LevelBar'
import { fmtDay, fmtInt } from '../gamification/format'
import { cancelInvite, removeFriend, toSocialError } from './social-api'
import { socialErrorText } from './labels'
import { useSocial } from './useSocial'
import { InviteButton, useOfferLink } from './InviteButton'
import { PersonAvatar } from './components/PersonAvatar'
import { EmptyState, ErrorState, ListSkeleton, StaleNote } from './components/states'
import type { Friend, MyInvite } from './types'

type AppStore = { user: { id: string } | null }

// Friends: invite button, open invites (share again, cancel), the list and each friend's card.
export default function FriendsPanel() {
  const friends = useSocial(s => s.friends)
  const invites = useSocial(s => s.invites)
  const [open, setOpen] = useState<Friend | null>(null)
  useEffect(() => {
    void useSocial.getState().load('friends')
    void useSocial.getState().load('invites')
  }, [])
  const list = friends.data

  return (
    <section aria-labelledby="friends-title" className="flex flex-col gap-4">
      <h2 id="friends-title" className="sr-only">{t('Friends')}</h2>
      {list && list.length > 0 && <InviteButton />}
      {invites.data && invites.data.length > 0 && <OpenInvites items={invites.data} />}
      <StaleNote stale={friends.stale} />
      {!list ? (
        friends.status === 'error' && friends.error
          ? <ErrorState code={friends.error} onRetry={() => void useSocial.getState().load('friends')} />
          : <ListSkeleton />
      ) : list.length === 0 ? (
        <EmptyState icon={Users} title={t('Training together pays off')}
          body={t('Invite a friend with a link. Once they join, you both show up in the ranking.')}>
          <InviteButton />
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map(f => <li key={f.id}><FriendRow friend={f} onOpen={() => setOpen(f)} /></li>)}
        </ul>
      )}
      <FriendSheet friend={open} onClose={() => setOpen(null)} />
    </section>
  )
}

function FriendRow({ friend, onOpen }: { friend: Friend; onOpen: () => void }) {
  const c = friend.card
  return (
    <button type="button" onClick={onOpen}
      className="flex min-h-16 w-full items-center gap-3 rounded-2xl bg-card px-3 py-2 text-left outline-none transition-colors duration-150 hover:bg-secondary/60 focus-visible:ring-[3px] focus-visible:ring-ring/50">
      <PersonAvatar name={friend.name} src={friend.avatar_url} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium">{friend.name}</span>
        <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <span>{t('Level {0}', c.level.level)}</span>
          <span className="flex items-center gap-1">
            <Flame aria-hidden className="size-3.5 text-[var(--pillar-strength)]" />{t('{0} week streak', c.streak.current)}
          </span>
        </span>
      </span>
      <span className="shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">{t('{0} XP this week', fmtInt(c.week.xp))}</span>
      <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
    </button>
  )
}

function OpenInvites({ items }: { items: MyInvite[] }) {
  const { offer, drawer } = useOfferLink()
  const cancel = async (code: string) => {
    useSocial.setState(s => ({ invites: { ...s.invites, data: (s.invites.data ?? []).filter(i => i.code !== code) } }))
    try { await cancelInvite(code) } catch (e) { toast.error(socialErrorText(toSocialError(e).code)) }
    void useSocial.getState().load('invites')
  }
  return (
    <section aria-labelledby="open-invites" className="flex flex-col gap-2">
      <h3 id="open-invites" className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t('Open invites')}</h3>
      <ul className="flex flex-col gap-2">
        {items.map(i => (
          <li key={i.code} className="flex min-h-14 items-center gap-2 rounded-2xl border border-dashed border-border pl-3 pr-1">
            <Link2 aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex-1 text-sm text-muted-foreground">{t('Expires {0}', fmtDay(i.expires_at))}</span>
            <Button variant="ghost" size="icon" className="size-11 rounded-full" aria-label={t('Share again')} onClick={() => void offer(i.code)}>
              <Share2 className="size-4" />
            </Button>
            <Button variant="ghost" size="icon" className="size-11 rounded-full" aria-label={t('Cancel invite')} onClick={() => void cancel(i.code)}>
              <X className="size-4" />
            </Button>
          </li>
        ))}
      </ul>
      {drawer}
    </section>
  )
}

// A friend's public card (levels, week, streak, badges) and, behind a confirmation, unfriending.
function FriendSheet({ friend, onClose }: { friend: Friend | null; onClose: () => void }) {
  const me = useStore((s: AppStore) => s.user?.id ?? null)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => { setConfirm(false) }, [friend?.id])
  const c = friend?.card
  const recent = c ? [...c.achievements].sort((a, b) => b.unlocked_at.localeCompare(a.unlocked_at)).slice(0, 6) : []

  const remove = async () => {
    if (!friend || !me) return
    setBusy(true)
    try {
      await removeFriend(me, friend.id)
      toast(t('{0} removed from your friends', friend.name))
      onClose()
      const s = useSocial.getState()
      void s.load('friends'); void s.load('weekly'); void s.load('alltime')
    } catch (e) {
      toast.error(socialErrorText(toSocialError(e).code))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer open={friend !== null} onOpenChange={o => { if (!o) onClose() }}>
      <DrawerContent className="pb-[env(safe-area-inset-bottom)]">
        {friend && c && (
          <>
            <DrawerHeader className="flex-row items-center gap-3 text-left">
              <PersonAvatar name={friend.name} src={friend.avatar_url} className="size-14" />
              <div className="min-w-0">
                <DrawerTitle className="truncate text-lg">{friend.name}</DrawerTitle>
                <DrawerDescription>{t('Friends since {0}', fmtDay(friend.since))}</DrawerDescription>
              </div>
            </DrawerHeader>
            <div className="flex flex-col gap-5 overflow-y-auto px-4 pb-2">
              <div>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="font-medium">{t('Level {0}', c.level.level)}</span>
                  <span className="font-mono tabular-nums text-muted-foreground">{t('{0} XP to level {1}', fmtInt(c.level.need - c.level.into), c.level.level + 1)}</span>
                </div>
                <LevelBar className="mt-2" to={c.level} instant label={t('Level {0}', c.level.level)} />
              </div>
              <dl className="grid grid-cols-3 gap-2">
                <Stat label={t('This week')} value={t('{0} XP', fmtInt(c.week.xp))} />
                <Stat label={t('Workouts')} value={t('{0} of {1}', c.week.workouts, c.week.target)} />
                <Stat label={t('Week streak')} value={String(c.streak.current)} />
              </dl>
              <div>
                <p className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="font-medium">{t('Achievements')}</span>
                  <span className="text-muted-foreground">{t('{0} of {1} unlocked', c.achievements.length, ACHIEVEMENTS.length)}</span>
                </p>
                {recent.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {recent.map(a => (
                      <li key={a.code} className="flex items-center gap-2 rounded-full bg-secondary/70 py-1 pl-1 pr-3 text-xs font-medium">
                        <AchievementIcon code={a.code} unlocked className="size-7 rounded-full" />
                        {ACHIEVEMENT_TEXT[a.code as AchievementCode]?.title() ?? a.code}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <DrawerFooter>
              {confirm ? (
                <div role="alertdialog" aria-labelledby="unfriend-question" className="flex flex-col gap-3">
                  <p id="unfriend-question" className="text-sm leading-snug">
                    {t('Remove {0} as a friend? You will no longer see each other in the ranking or the feed.', friend.name)}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" className="h-12 rounded-xl" onClick={() => setConfirm(false)}>{t('Cancel')}</Button>
                    <Button variant="destructive" className="h-12 rounded-xl" disabled={busy} aria-busy={busy} onClick={remove}>{t('Remove')}</Button>
                  </div>
                </div>
              ) : (
                <Button variant="ghost" className="h-12 rounded-xl text-destructive" onClick={() => setConfirm(true)}>{t('Remove friend')}</Button>
              )}
            </DrawerFooter>
          </>
        )}
      </DrawerContent>
    </Drawer>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-secondary/60 px-3 py-2.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-mono text-[15px] font-semibold tabular-nums">{value}</dd>
    </div>
  )
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/features/social/FriendsPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
node scripts/check-source-strings.mjs --strict
npm run typecheck && npm test && npm run build
git add src/features/social
git commit -m "feat(social): friends list, invite sharing and friend card

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Ranking (Semana e Geral)

**Files:**
- Create: `src/features/social/RankingPanel.tsx`
- Test: `src/features/social/RankingPanel.test.tsx`

**Interfaces:**
- Consumes: `useSocial` (`weekly`, `alltime`, `load`); `InviteButton`, `PersonAvatar`, `ListSkeleton`, `ErrorState`, `EmptyState`, `StaleNote` (Task 8); `fmtInt` (1a); `ToggleGroup`.
- Produces: `RankingPanel` (default export). Cada linha é um `<li>` com `aria-current="true"` na minha.

- [ ] **Step 1: Teste que falha**

Criar `src/features/social/RankingPanel.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'

vi.mock('@/components/ui/drawer', () => import('./test-drawer'))

import RankingPanel from './RankingPanel'
import { useSocial } from './useSocial'
import { BIA, CAIO, ME, rowOf } from './test-social'
import type { LeaderboardRow } from './types'

const realLoad = useSocial.getState().load
const load = vi.fn(async () => null)
const board = (rows: LeaderboardRow[]) => ({ status: 'ready' as const, data: { week_start: '2026-10-05', rows }, stale: false, error: null })

beforeEach(() => {
  localStorage.clear()
  useSocial.getState().reset()
  useSocial.setState({ userId: ME, load })
  load.mockClear()
})
afterEach(() => { cleanup(); useSocial.setState({ load: realLoad }) })

describe('RankingPanel', () => {
  it('ranks me and my friends this week, with movement and the gap to the next one', () => {
    useSocial.setState({ weekly: board([
      rowOf(BIA, 'Bia', { xp: 500, level: 4, pos: 1, prev_pos: 2 }),
      rowOf(ME, 'Ana', { xp: 300, level: 6, pos: 2, prev_pos: 1, gap: 200 }),
      rowOf(CAIO, 'Caio', { xp: 300, level: 3, pos: 2, prev_pos: 2, gap: 200 })
    ]) })
    render(<RankingPanel />)
    expect(load).toHaveBeenCalledWith('weekly')
    const items = screen.getAllByRole('listitem')
    expect(items.map(li => li.getAttribute('aria-current'))).toEqual([null, 'true', null])
    expect(within(items[0]).getByText('Position 1')).toBeTruthy()
    expect(within(items[0]).getByText('Up 1 since last week')).toBeTruthy()
    expect(within(items[1]).getByText('Down 1 since last week')).toBeTruthy()
    expect(within(items[1]).getByText('You')).toBeTruthy()
    expect(within(items[1]).getByText('300 XP')).toBeTruthy()
    expect(within(items[2]).queryByText(/since last week/)).toBeNull()
    expect(screen.getByText('200 XP to pass Bia')).toBeTruthy()
  })

  it('switches to the all-time board', () => {
    useSocial.setState({ weekly: board([rowOf(ME, 'Ana')]) })
    const { container } = render(<RankingPanel />)
    fireEvent.click(screen.getByRole('radio', { name: 'All time' }))
    expect(load).toHaveBeenCalledWith('alltime')
    expect(screen.getByText('By total XP since the start.')).toBeTruthy()
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy()
  })

  it('says when I lead', () => {
    useSocial.setState({ weekly: board([rowOf(ME, 'Ana', { xp: 900 }), rowOf(BIA, 'Bia', { xp: 100, pos: 2, gap: 800 })]) })
    render(<RankingPanel />)
    expect(screen.getByText('You are in the lead.')).toBeTruthy()
  })

  it('invites friends when I am alone', () => {
    useSocial.setState({ weekly: board([rowOf(ME, 'Ana', { xp: 120 })]) })
    render(<RankingPanel />)
    expect(screen.getByText('Rankings are better with company')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Invite a friend' })).toBeTruthy()
  })

  it('offers a retry when the board could not load', () => {
    useSocial.setState({ weekly: { status: 'error', data: null, stale: false, error: 'network' } })
    render(<RankingPanel />)
    load.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(load).toHaveBeenCalledWith('weekly')
  })
})
```

Run: `npx vitest run src/features/social/RankingPanel.test.tsx`
Expected: FAIL (`Cannot find module './RankingPanel'`).

- [ ] **Step 2: Implementar**

Criar `src/features/social/RankingPanel.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Trophy } from 'lucide-react'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import { t } from '../../lib/i18n.js'
import { fmtInt } from '../gamification/format'
import { useSocial } from './useSocial'
import { InviteButton } from './InviteButton'
import { PersonAvatar } from './components/PersonAvatar'
import { EmptyState, ErrorState, ListSkeleton, StaleNote } from './components/states'
import type { LeaderboardRow } from './types'

type Board = 'weekly' | 'alltime'

// This week (default) or all time: position, photo, name, level, movement since last week and
// XP. My row is highlighted and the gap to the next person above is spelled out under the list.
export default function RankingPanel() {
  const [board, setBoard] = useState<Board>('weekly')
  const res = useSocial(s => s[board])
  useEffect(() => { void useSocial.getState().load(board) }, [board])
  const rows = res.data?.rows ?? null
  const me = rows?.find(r => r.me) ?? null
  const above = me && rows ? rows.filter(r => r.xp > me.xp).sort((a, b) => a.xp - b.xp)[0] ?? null : null

  return (
    <section aria-labelledby="ranking-title" className="flex flex-col gap-4">
      <h2 id="ranking-title" className="sr-only">{t('Ranking')}</h2>
      <ToggleGroup type="single" value={board} onValueChange={v => { if (v) setBoard(v as Board) }} aria-label={t('Ranking')}
        className="grid w-full grid-cols-2 gap-1 rounded-2xl bg-secondary/60 p-1">
        <ToggleGroupItem value="weekly" className="h-11 rounded-xl text-sm font-medium data-[state=on]:bg-card data-[state=on]:shadow-sm">{t('This week')}</ToggleGroupItem>
        <ToggleGroupItem value="alltime" className="h-11 rounded-xl text-sm font-medium data-[state=on]:bg-card data-[state=on]:shadow-sm">{t('All time')}</ToggleGroupItem>
      </ToggleGroup>
      <p className="-mt-1 text-xs leading-snug text-muted-foreground text-pretty">
        {board === 'weekly'
          ? t('Resets every Monday. Any plan pays up to 960 XP a week, so it is fair for everyone.')
          : t('By total XP since the start.')}
      </p>
      <StaleNote stale={res.stale} />
      {!rows ? (
        res.status === 'error' && res.error
          ? <ErrorState code={res.error} onRetry={() => void useSocial.getState().load(board)} />
          : <ListSkeleton rows={3} />
      ) : (
        <>
          <ol className="flex flex-col gap-2 animate-in fade-in-0 duration-200 motion-reduce:animate-none">
            {rows.map(r => <RankRow key={r.id} row={r} />)}
          </ol>
          {me && rows.length > 1 && (
            <p className="text-center text-sm tabular-nums text-muted-foreground">
              {above && me.gap !== null ? t('{0} XP to pass {1}', fmtInt(me.gap), above.name) : t('You are in the lead.')}
            </p>
          )}
          {rows.length <= 1 && (
            <EmptyState icon={Trophy} title={t('Rankings are better with company')}
              body={t('Invite friends to compete for the week. Only friends see where you stand.')}>
              <InviteButton />
            </EmptyState>
          )}
        </>
      )}
    </section>
  )
}

function RankRow({ row }: { row: LeaderboardRow }) {
  return (
    <li aria-current={row.me ? 'true' : undefined}
      className={cn('flex min-h-16 items-center gap-3 rounded-2xl px-3 py-2', row.me ? 'bg-primary/10 ring-1 ring-primary/40' : 'bg-card')}>
      <span className={cn('w-7 shrink-0 text-center font-mono text-lg font-semibold tabular-nums', row.pos === 1 && 'text-primary')}>
        <span className="sr-only">{t('Position {0}', row.pos)}</span>
        <span aria-hidden>{row.pos}</span>
      </span>
      <PersonAvatar name={row.name} src={row.avatar_url} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-[15px] font-medium">{row.name}</span>
          {row.me && <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">{t('You')}</span>}
        </span>
        <span className="block text-xs text-muted-foreground">{t('Level {0}', row.level)}</span>
      </span>
      <Movement moved={row.prev_pos - row.pos} />
      <span className="w-20 shrink-0 text-right font-mono text-sm font-semibold tabular-nums">{t('{0} XP', fmtInt(row.xp))}</span>
    </li>
  )
}

// Places gained or lost since last week: an arrow and a number, never colour alone.
function Movement({ moved }: { moved: number }) {
  if (moved === 0) return <span className="w-8 shrink-0" />
  const up = moved > 0
  const Icon = up ? ArrowUp : ArrowDown
  return (
    <span className={cn('flex w-8 shrink-0 items-center justify-end gap-0.5 font-mono text-xs tabular-nums', up ? 'text-primary' : 'text-muted-foreground')}>
      <Icon aria-hidden className="size-3.5" />
      <span aria-hidden>{Math.abs(moved)}</span>
      <span className="sr-only">{up ? t('Up {0} since last week', moved) : t('Down {0} since last week', -moved)}</span>
    </span>
  )
}
```

- [ ] **Step 3: Rodar e ver passar**

Run: `npx vitest run src/features/social/RankingPanel.test.tsx`
Expected: PASS. Se o Radix renderizar os itens do `ToggleGroup` com `role="button"` e `aria-pressed`
em vez de `role="radio"` (depende da versão), trocar no teste `getByRole('radio', ...)` por
`getByRole('button', { name: 'All time' })`.

- [ ] **Step 4: Commit**

```bash
node scripts/check-source-strings.mjs --strict
npm run typecheck && npm test && npm run build
git add src/features/social/RankingPanel.tsx src/features/social/RankingPanel.test.tsx
git commit -m "feat(social): weekly and all-time ranking among friends

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Desafios: lista e criação por modelo

**Files:**
- Create: `src/features/social/ChallengesPanel.tsx`, `src/features/social/NewChallengeSheet.tsx`
- Test: `src/features/social/ChallengesPanel.test.tsx`, `src/features/social/NewChallengeSheet.test.tsx`

**Interfaces:**
- Consumes: `useSocial` (`challenges`, `friends`, `load`); `createChallenge`, `toSocialError` (Task 5); `templates.ts` (Task 5); `TEMPLATE_TEXT`, `MODE_TEXT`, `amountText`, `autoTitle`, `socialErrorText` (Task 7); `fmtShortDay` (Task 7); `useProgress` (`progress.week.target`, 1a); `todayISO` (`src/lib/format.js`); peças da Task 8.
- Produces: `ChallengesPanel` (default export; `?novo=1` abre o formulário, usado pela tela de convite); `statusLine(c: Challenge, today: string): string` (named, usado pela Task 11); `NewChallengeSheet` (default export, `{ open: boolean; onClose: () => void }`).

- [ ] **Step 1: Testes que falham**

Criar `src/features/social/ChallengesPanel.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'

const h = vi.hoisted(() => ({ nav: vi.fn(), params: new URLSearchParams(), setParams: vi.fn() }))
vi.mock('react-router-dom', () => ({ useNavigate: () => h.nav, useSearchParams: () => [h.params, h.setParams] }))
vi.mock('@/components/ui/drawer', () => import('./test-drawer'))

import ChallengesPanel from './ChallengesPanel'
import { useSocial } from './useSocial'
import { BIA, ME, challengeOf, friendOf } from './test-social'

const realLoad = useSocial.getState().load
const load = vi.fn(async () => null)
const ready = <T,>(data: T) => ({ status: 'ready' as const, data, stale: false, error: null })

beforeEach(() => {
  localStorage.clear()
  useSocial.getState().reset()
  useSocial.setState({ userId: ME, load, friends: ready([friendOf(BIA, 'Bia')]) })
  load.mockClear()
  h.nav.mockClear()
  h.setParams.mockClear()
  h.params = new URLSearchParams()
})
afterEach(() => { cleanup(); useSocial.setState({ load: realLoad }) })

describe('ChallengesPanel', () => {
  it('groups invitations, ongoing and finished challenges', () => {
    useSocial.setState({ challenges: ready([
      challengeOf({ id: 'i1', title: 'Convite da Bia', invited_by: 'Bia', me: { joined: false, won: null } }),
      challengeOf({ id: 'a1', title: 'Outubro forte' }),
      challengeOf({ id: 'f1', title: 'Setembro', status: 'won', me: { joined: true, won: true } })
    ]) })
    render(<ChallengesPanel />)
    expect(load).toHaveBeenCalledWith('challenges')
    expect(within(screen.getByRole('region', { name: 'Invitations' })).getByText('Bia invited you')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'In progress' })).getByText('Outubro forte')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'Finished' })).getByText(/Completed/)).toBeTruthy()
  })

  it('opens a challenge', () => {
    useSocial.setState({ challenges: ready([challengeOf({ id: 'a1' })]) })
    render(<ChallengesPanel />)
    fireEvent.click(screen.getByRole('button', { name: /Outubro forte/ }))
    expect(h.nav).toHaveBeenCalledWith('/social/desafios/a1')
  })

  it('needs a friend before creating one', () => {
    useSocial.setState({ friends: ready([]), challenges: ready([]) })
    render(<ChallengesPanel />)
    expect(screen.getByRole('button', { name: 'New challenge' })).toHaveProperty('disabled', true)
    expect(screen.getByText('Add a friend to create challenges.')).toBeTruthy()
    expect(screen.getByText('No challenges yet')).toBeTruthy()
  })

  it('opens the form at once when asked by the link', () => {
    h.params = new URLSearchParams('novo=1')
    useSocial.setState({ challenges: ready([]) })
    render(<ChallengesPanel />)
    expect(within(screen.getByRole('dialog')).getByRole('heading', { name: 'New challenge' })).toBeTruthy()
    expect(h.setParams).toHaveBeenCalledWith({}, { replace: true })
  })
})
```

Criar `src/features/social/NewChallengeSheet.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ nav: vi.fn(), createChallenge: vi.fn(), toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }))
vi.mock('react-router-dom', () => ({ useNavigate: () => h.nav }))
vi.mock('./social-api', async orig => ({ ...(await orig<typeof import('./social-api')>()), createChallenge: h.createChallenge }))
vi.mock('sonner', () => ({ toast: h.toast }))
vi.mock('@/components/ui/drawer', () => import('./test-drawer'))

import NewChallengeSheet from './NewChallengeSheet'
import { useSocial } from './useSocial'
import { useProgress } from '../gamification/useProgress'
import { SocialError } from './social-api'
import { addDays } from './templates'
import { todayISO } from '../../lib/format.js'
import { BIA, CAIO, ME, friendOf } from './test-social'

const realLoad = useSocial.getState().load
const load = vi.fn(async () => null)
const onClose = vi.fn()
const ready = <T,>(data: T) => ({ status: 'ready' as const, data, stale: false, error: null })
const create = () => screen.getByRole('button', { name: 'Create challenge' }) as HTMLButtonElement

beforeEach(() => {
  localStorage.clear()
  useProgress.getState().reset()
  useSocial.getState().reset()
  useSocial.setState({ userId: ME, load, friends: ready([friendOf(BIA, 'Bia'), friendOf(CAIO, 'Caio')]) })
  ;[load, onClose, h.nav, h.createChallenge, h.toast.success, h.toast.error].forEach(f => f.mockReset())
})
afterEach(() => { cleanup(); useSocial.setState({ load: realLoad }) })

describe('NewChallengeSheet', () => {
  it('suggests a goal and a name from what is picked', () => {
    render(<NewChallengeSheet open onClose={onClose} />)
    // 3 workouts a week (no progress yet) × 4 weeks, only me so far.
    expect(screen.getByText('12 workouts')).toBeTruthy()
    expect((screen.getByLabelText('Challenge name') as HTMLInputElement).value).toBe('12 workouts in 30 days')
    expect(screen.getByText('Pick at least one friend.')).toBeTruthy()
    expect(create().disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: /Bia/ }))
    expect(screen.getByText('24 workouts')).toBeTruthy()
    expect(create().disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    expect(screen.getByText('25 workouts')).toBeTruthy()
    expect((screen.getByLabelText('Challenge name') as HTMLInputElement).value).toBe('25 workouts in 30 days')
  })

  it('keeps weeks on target solo', () => {
    render(<NewChallengeSheet open onClose={onClose} />)
    fireEvent.click(screen.getByRole('radio', { name: /Weeks on target/ }))
    expect((screen.getByRole('radio', { name: 'Team' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Only solo for this goal: each person has their own weekly goal.')).toBeTruthy()
  })

  it('asks for the volume opt-in before creating a volume challenge', () => {
    render(<NewChallengeSheet open onClose={onClose} />)
    fireEvent.click(screen.getByRole('radio', { name: /Total volume/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Bia/ }))
    expect(screen.getByText('Agree to share your volume to create this challenge.')).toBeTruthy()
    expect(create().disabled).toBe(true)
    fireEvent.click(screen.getByRole('switch'))
    expect(screen.queryByText('Agree to share your volume to create this challenge.')).toBeNull()
    expect(create().disabled).toBe(false)
  })

  it('creates the challenge, closes and opens it', async () => {
    h.createChallenge.mockResolvedValue('c9')
    render(<NewChallengeSheet open onClose={onClose} />)
    fireEvent.click(screen.getByRole('checkbox', { name: /Bia/ }))
    fireEvent.click(create())
    await waitFor(() => expect(h.nav).toHaveBeenCalledWith('/social/desafios/c9'))
    const today = todayISO()
    expect(h.createChallenge).toHaveBeenCalledWith({
      template: 'workouts_count', title: '24 workouts in 30 days', mode: 'team', target: 24,
      starts_on: today, ends_on: addDays(today, 29), invitees: [BIA], share_volume: false
    })
    expect(onClose).toHaveBeenCalled()
    expect(load).toHaveBeenCalledWith('challenges')
    expect(h.toast.success).toHaveBeenCalledWith('Challenge created. Your friends got the invite.')
  })

  it('says why the server refused', async () => {
    h.createChallenge.mockRejectedValue(new SocialError('challenge_limit'))
    render(<NewChallengeSheet open onClose={onClose} />)
    fireEvent.click(screen.getByRole('checkbox', { name: /Bia/ }))
    fireEvent.click(create())
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('You already have 10 challenges in progress.'))
    expect(onClose).not.toHaveBeenCalled()
  })
})
```

Run: `npx vitest run src/features/social/ChallengesPanel.test.tsx src/features/social/NewChallengeSheet.test.tsx`
Expected: FAIL (módulos inexistentes).

- [ ] **Step 2: `ChallengesPanel`**

Criar `src/features/social/ChallengesPanel.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronRight, Plus, Swords } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { t } from '../../lib/i18n.js'
import { todayISO } from '../../lib/format.js'
import { useSocial } from './useSocial'
import { MODE_TEXT, TEMPLATE_TEXT } from './labels'
import { challengeShare, daysLeft } from './templates'
import { fmtShortDay } from './format'
import { PersonAvatar } from './components/PersonAvatar'
import { EmptyState, ErrorState, ListSkeleton, StaleNote } from './components/states'
import NewChallengeSheet from './NewChallengeSheet'
import type { Challenge } from './types'

// Where a challenge stands, in a few words.
export function statusLine(c: Challenge, today: string): string {
  if (c.status === 'won') return c.me.won === false ? t('Not this time') : t('Completed')
  if (c.status === 'lost') return t('Not this time')
  if (c.status === 'cancelled') return t('Cancelled')
  if (c.starts_on > today) return t('Starts {0}', fmtShortDay(c.starts_on))
  return daysLeft(c, today) <= 1 ? t('Ends today') : t('{0} days left', daysLeft(c, today))
}

// Invitations first (they wait for an answer), then what is running, then what ended.
export default function ChallengesPanel() {
  const res = useSocial(s => s.challenges)
  const friends = useSocial(s => s.friends)
  const [params, setParams] = useSearchParams()
  const [creating, setCreating] = useState(params.get('novo') === '1')
  useEffect(() => {
    void useSocial.getState().load('challenges')
    void useSocial.getState().load('friends')
    if (params.get('novo')) setParams({}, { replace: true })
  }, [])
  const today = todayISO()
  const list = res.data
  const hasFriends = (friends.data?.length ?? 0) > 0
  const groups: [string, Challenge[]][] = list ? [
    [t('Invitations'), list.filter(c => c.status === 'active' && !c.me.joined)],
    [t('In progress'), list.filter(c => c.status === 'active' && c.me.joined)],
    [t('Finished'), list.filter(c => c.status !== 'active')]
  ] : []

  return (
    <section aria-labelledby="challenges-title" className="flex flex-col gap-5">
      <h2 id="challenges-title" className="sr-only">{t('Challenges')}</h2>
      <div className="flex flex-col gap-2">
        <Button className="h-12 w-full gap-2 rounded-2xl text-[15px] font-semibold active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100"
          disabled={!hasFriends} onClick={() => setCreating(true)}>
          <Plus aria-hidden className="size-5" />{t('New challenge')}
        </Button>
        {friends.data && !hasFriends && <p className="text-center text-sm text-muted-foreground">{t('Add a friend to create challenges.')}</p>}
      </div>
      <StaleNote stale={res.stale} />
      {!list ? (
        res.status === 'error' && res.error
          ? <ErrorState code={res.error} onRetry={() => void useSocial.getState().load('challenges')} />
          : <ListSkeleton rows={3} />
      ) : list.length === 0 ? (
        <EmptyState icon={Swords} title={t('No challenges yet')}
          body={t('Bring friends together around a goal with a deadline. Everyone who completes it earns 300 XP.')} />
      ) : (
        groups.filter(([, items]) => items.length > 0).map(([title, items]) => (
          <section key={title} aria-label={title} className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{title}</h3>
            <ul className="flex flex-col gap-2">
              {items.map(c => <li key={c.id}><ChallengeCard c={c} today={today} /></li>)}
            </ul>
          </section>
        ))
      )}
      <NewChallengeSheet open={creating} onClose={() => setCreating(false)} />
    </section>
  )
}

function ChallengeCard({ c, today }: { c: Challenge; today: string }) {
  const navigate = useNavigate()
  const Icon = TEMPLATE_TEXT[c.template].icon
  const invited = c.status === 'active' && !c.me.joined
  return (
    <button type="button" onClick={() => navigate('/social/desafios/' + c.id)}
      className={cn('flex w-full flex-col gap-3 rounded-2xl border bg-card p-4 text-left outline-none transition-colors duration-150 hover:bg-secondary/40 focus-visible:ring-[3px] focus-visible:ring-ring/50',
        invited ? 'border-primary/40' : 'border-border')}>
      <span className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary"><Icon aria-hidden className="size-5" /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold">{c.title}</span>
          <span className="block text-xs text-muted-foreground">{MODE_TEXT[c.mode].name()} · {statusLine(c, today)}</span>
        </span>
        <span aria-hidden className="flex -space-x-2">
          {c.members.filter(m => m.joined).slice(0, 3).map(m => (
            <PersonAvatar key={m.id} name={m.name} src={m.avatar_url} className="size-7 ring-2 ring-card" />
          ))}
        </span>
        <ChevronRight aria-hidden className="mt-1.5 size-4 shrink-0 text-muted-foreground" />
      </span>
      {invited ? (
        <span className="text-sm font-medium text-primary">{t('{0} invited you', c.invited_by ?? '')}</span>
      ) : c.status === 'active' ? (
        <span aria-hidden className="block h-1.5 overflow-hidden rounded-full bg-primary/15">
          <span className="block h-full rounded-full bg-primary transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
            style={{ width: `${challengeShare(c) * 100}%` }} />
        </span>
      ) : null}
    </button>
  )
}
```

- [ ] **Step 3: `NewChallengeSheet`**

Criar `src/features/social/NewChallengeSheet.tsx`:

```tsx
import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Check, LoaderCircle, Minus, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import { t } from '../../lib/i18n.js'
import { todayISO } from '../../lib/format.js'
import { useProgress } from '../gamification/useProgress'
import { createChallenge, toSocialError } from './social-api'
import { useSocial } from './useSocial'
import { MODE_TEXT, TEMPLATE_TEXT, amountText, autoTitle, socialErrorText } from './labels'
import { fmtShortDay } from './format'
import {
  DURATIONS, MAX_INVITEES, MODES, TARGET_STEP, TEMPLATES, addDays, checkChallenge, clampTarget, nextMonday,
  suggestedTarget, targetRange
} from './templates'
import { PersonAvatar } from './components/PersonAvatar'
import type { ChallengeMode, ChallengeTemplate, NewChallenge } from './types'

type Start = 'today' | 'monday'

// A challenge from a template with parameters, in one bottom sheet: what counts, format,
// duration and start, goal (suggested until touched), who joins, the volume opt-in and a name
// that writes itself until edited. The same rules as the server decide whether it can be sent.
export default function NewChallengeSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const friends = useSocial(s => s.friends.data) ?? []
  const weekly = useProgress(s => s.progress?.week.target ?? 3)
  const today = todayISO()
  const [template, setTemplate] = useState<ChallengeTemplate>('workouts_count')
  const [mode, setMode] = useState<ChallengeMode>('team')
  const [days, setDays] = useState<number>(30)
  const [start, setStart] = useState<Start>('today')
  const [picked, setPicked] = useState<string[]>([])
  const [target, setTarget] = useState<number | null>(null)
  const [title, setTitle] = useState<string | null>(null)
  const [shareVolume, setShareVolume] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setTemplate('workouts_count'); setMode('team'); setDays(30); setStart('today')
    setPicked([]); setTarget(null); setTitle(null); setShareVolume(false)
  }, [open])

  const effMode: ChallengeMode = MODES[template].includes(mode) ? mode : 'solo'
  const startsOn = start === 'today' ? today : nextMonday(today)
  const endsOn = addDays(startsOn, days - 1)
  const range = targetRange(template, startsOn, endsOn)
  const goal = target === null
    ? suggestedTarget(template, effMode, startsOn, endsOn, weekly, picked.length + 1)
    : clampTarget(target, range)
  const name = title ?? autoTitle(template, goal, days)
  const draft: NewChallenge = {
    template, title: name, mode: effMode, target: goal, starts_on: startsOn, ends_on: endsOn,
    invitees: picked, share_volume: shareVolume
  }
  const problem = checkChallenge(draft, today)

  // A new shape gets a new suggested goal.
  const reshape = (change: () => void) => { change(); setTarget(null) }
  const toggle = (id: string) => setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : p.length >= MAX_INVITEES ? p : [...p, id]))
  const step = (dir: 1 | -1) => setTarget(clampTarget(goal + dir * TARGET_STEP[template], range))

  const submit = async () => {
    if (problem) return
    setBusy(true)
    try {
      const id = await createChallenge(draft)
      toast.success(t('Challenge created. Your friends got the invite.'))
      onClose()
      await useSocial.getState().load('challenges')
      navigate('/social/desafios/' + id)
    } catch (e) {
      toast.error(socialErrorText(toSocialError(e).code))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer open={open} onOpenChange={o => { if (!o) onClose() }}>
      <DrawerContent className="max-h-[92dvh]">
        <DrawerHeader className="text-left">
          <DrawerTitle className="text-xl">{t('New challenge')}</DrawerTitle>
          <DrawerDescription>{t('Bring friends together around a goal with a deadline. Everyone who completes it earns 300 XP.')}</DrawerDescription>
        </DrawerHeader>

        <div className="flex flex-col gap-6 overflow-y-auto px-4 pb-4">
          <Field label={t('What counts')}>
            <div role="radiogroup" aria-label={t('What counts')} className="flex flex-col gap-2">
              {TEMPLATES.map(k => {
                const tx = TEMPLATE_TEXT[k]
                const Icon = tx.icon
                const on = k === template
                return (
                  <button key={k} type="button" role="radio" aria-checked={on} onClick={() => reshape(() => setTemplate(k))}
                    className={cn('flex min-h-16 items-start gap-3 rounded-2xl border p-3 text-left outline-none transition-colors duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/50',
                      on ? 'border-primary bg-primary/10' : 'border-border bg-card')}>
                    <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl', on ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground')}>
                      <Icon aria-hidden className="size-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-medium">{tx.name()}</span>
                      <span className="block text-xs leading-snug text-muted-foreground">{tx.rule()}</span>
                    </span>
                    {on && <Check aria-hidden className="mt-1 size-4 shrink-0 text-primary" />}
                  </button>
                )
              })}
            </div>
          </Field>

          <Field label={t('Format')}>
            <ToggleGroup type="single" value={effMode} aria-label={t('Format')}
              onValueChange={v => { if (v) reshape(() => setMode(v as ChallengeMode)) }}
              className="grid w-full grid-cols-2 gap-1 rounded-2xl bg-secondary/60 p-1">
              {(['team', 'solo'] as const).map(m => (
                <ToggleGroupItem key={m} value={m} disabled={!MODES[template].includes(m)}
                  className="h-11 rounded-xl text-sm font-medium data-[state=on]:bg-card data-[state=on]:shadow-sm">{MODE_TEXT[m].name()}</ToggleGroupItem>
              ))}
            </ToggleGroup>
            <p className="text-xs leading-snug text-muted-foreground">
              {template === 'weeks_on_target' ? t('Only solo for this goal: each person has their own weekly goal.') : MODE_TEXT[effMode].detail()}
            </p>
          </Field>

          <Field label={t('Duration')}>
            <div className="flex flex-wrap gap-2">
              {DURATIONS.map(d => <Chip key={d} on={d === days} onClick={() => reshape(() => setDays(d))}>{t('{0} days', d)}</Chip>)}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">{t('Starts')}</span>
              <Chip on={start === 'today'} onClick={() => reshape(() => setStart('today'))}>{t('Today')}</Chip>
              <Chip on={start === 'monday'} onClick={() => reshape(() => setStart('monday'))}>{t('Next Monday')}</Chip>
            </div>
            <p className="text-xs tabular-nums text-muted-foreground">{t('{0} to {1}', fmtShortDay(startsOn), fmtShortDay(endsOn))}</p>
          </Field>

          <Field label={t('Goal')}>
            <div className="flex items-center justify-between gap-3 rounded-2xl bg-card p-2">
              <Button variant="secondary" size="icon" className="size-12 rounded-xl" aria-label={t('Less')}
                disabled={goal <= range.min} onClick={() => step(-1)}><Minus className="size-5" /></Button>
              <output aria-live="polite" className="font-mono text-xl font-semibold tabular-nums">{amountText(template, goal)}</output>
              <Button variant="secondary" size="icon" className="size-12 rounded-xl" aria-label={t('More')}
                disabled={goal >= range.max} onClick={() => step(1)}><Plus className="size-5" /></Button>
            </div>
          </Field>

          <Field label={t('Who joins')} hint={t('Up to {0} friends.', MAX_INVITEES)}>
            <ul className="flex flex-col gap-1">
              {friends.map(f => {
                const on = picked.includes(f.id)
                return (
                  <li key={f.id}>
                    <button type="button" role="checkbox" aria-checked={on} onClick={() => toggle(f.id)}
                      className="flex min-h-14 w-full items-center gap-3 rounded-xl px-2 text-left outline-none transition-colors duration-150 hover:bg-secondary/60 focus-visible:ring-[3px] focus-visible:ring-ring/50">
                      <PersonAvatar name={f.name} src={f.avatar_url} className="size-9" />
                      <span className="flex-1 truncate text-[15px]">{f.name}</span>
                      <span aria-hidden className={cn('grid size-6 place-items-center rounded-md border', on ? 'border-primary bg-primary text-primary-foreground' : 'border-border')}>
                        {on && <Check className="size-4" />}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </Field>

          {template === 'volume_total' && (
            <div className="flex items-start gap-3 rounded-2xl border border-border p-3">
              <label htmlFor="share-volume" className="flex-1 cursor-pointer">
                <span className="block text-[15px] font-medium">{t('Share my volume in this challenge')}</span>
                <span className="block text-xs leading-snug text-muted-foreground">{t('People in this challenge see how many tonnes you lift. Never the load of each exercise.')}</span>
              </label>
              <Switch id="share-volume" checked={shareVolume} onCheckedChange={setShareVolume} />
            </div>
          )}

          <Field label={t('Challenge name')}>
            <Input value={name} maxLength={60} aria-label={t('Challenge name')} onChange={e => setTitle(e.target.value)} className="h-12 text-[15px]" />
          </Field>
        </div>

        <DrawerFooter className="border-t border-border pb-[calc(1rem+env(safe-area-inset-bottom))]">
          {problem === 'invitees' && <p className="text-center text-sm text-muted-foreground">{t('Pick at least one friend.')}</p>}
          {problem === 'volume' && <p className="text-center text-sm text-muted-foreground">{t('Agree to share your volume to create this challenge.')}</p>}
          <Button className="h-12 gap-2 rounded-2xl text-[15px] font-semibold" disabled={!!problem || busy} aria-busy={busy} onClick={submit}>
            {busy && <LoaderCircle aria-hidden className="size-5 animate-spin motion-reduce:animate-none" />}{t('Create challenge')}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 flex w-full items-baseline justify-between gap-3 text-sm font-semibold">
        {label}{hint && <span className="text-xs font-normal text-muted-foreground">{hint}</span>}
      </legend>
      {children}
    </fieldset>
  )
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={cn('min-h-11 rounded-full border px-4 text-sm font-medium outline-none transition-colors duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/50',
        on ? 'border-primary bg-primary/15 text-foreground' : 'border-border bg-card text-muted-foreground')}>
      {children}
    </button>
  )
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/features/social/ChallengesPanel.test.tsx src/features/social/NewChallengeSheet.test.tsx`
Expected: PASS. Mesma ressalva da Task 9 sobre `role="radio"` dos itens do `ToggleGroup` (só o
"Team"/"Solo"; os modelos são botões próprios com `role="radio"`).

- [ ] **Step 5: Commit**

```bash
node scripts/check-source-strings.mjs --strict
npm run typecheck && npm test && npm run build
git add src/features/social/ChallengesPanel.tsx src/features/social/ChallengesPanel.test.tsx src/features/social/NewChallengeSheet.tsx src/features/social/NewChallengeSheet.test.tsx
git commit -m "feat(social): challenge list and creation from templates

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Detalhe do desafio

**Files:**
- Create: `src/features/social/ChallengeDetail.tsx`
- Test: `src/features/social/ChallengeDetail.test.tsx`

**Interfaces:**
- Consumes: `useSocial` (`challenges`, `load`); `joinChallenge`, `leaveChallenge`, `toSocialError` (Task 5); `challengeShare` (Task 5); `statusLine` (Task 10); `TEMPLATE_TEXT`, `MODE_TEXT`, `amountText`, `socialErrorText`, `fmtShortDay` (Task 7); `useProgress.refresh` (1a); peças da Task 8.
- Produces: `ChallengeDetail` (default export), rota `/social/desafios/:id` (ligada na Task 13).

- [ ] **Step 1: Teste que falha**

Criar `src/features/social/ChallengeDetail.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'

const h = vi.hoisted(() => ({
  nav: vi.fn(), id: 'c1', join: vi.fn(), leave: vi.fn(), refresh: vi.fn(),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() })
}))
vi.mock('react-router-dom', () => ({ useNavigate: () => h.nav, useParams: () => ({ id: h.id }) }))
vi.mock('./social-api', async orig => ({ ...(await orig<typeof import('./social-api')>()), joinChallenge: h.join, leaveChallenge: h.leave }))
vi.mock('../gamification/useProgress', () => ({ useProgress: { getState: () => ({ refresh: h.refresh }) } }))
vi.mock('sonner', () => ({ toast: h.toast }))

import ChallengeDetail from './ChallengeDetail'
import { useSocial } from './useSocial'
import { BIA, CAIO, ME, challengeOf } from './test-social'
import type { Challenge } from './types'

const realLoad = useSocial.getState().load
const load = vi.fn(async () => null)
const show = (c: Challenge[]) => useSocial.setState({ challenges: { status: 'ready', data: c, stale: false, error: null } })
const invited = (over: Partial<Challenge> = {}) => challengeOf({
  invited_by: 'Bia', me: { joined: false, won: null },
  members: [
    { id: BIA, name: 'Bia', avatar_url: null, me: false, joined: true, progress: 1, won: null },
    { id: ME, name: 'Ana', avatar_url: null, me: true, joined: false, progress: null, won: null }
  ],
  ...over
})

beforeEach(() => {
  localStorage.clear()
  useSocial.getState().reset()
  useSocial.setState({ userId: ME, load })
  ;[load, h.nav, h.join, h.leave, h.refresh, h.toast.success, h.toast.error].forEach(f => f.mockReset())
  h.join.mockResolvedValue(undefined)
  h.leave.mockResolvedValue(undefined)
})
afterEach(() => { cleanup(); useSocial.setState({ load: realLoad }) })

describe('ChallengeDetail', () => {
  it('shows the team total against the goal and every member', () => {
    show([challengeOf({
      members: [
        ...challengeOf().members,
        { id: CAIO, name: 'Caio', avatar_url: null, me: false, joined: false, progress: null, won: null }
      ]
    })])
    render(<ChallengeDetail />)
    expect(screen.getByRole('heading', { level: 1, name: 'Outubro forte' })).toBeTruthy()
    expect(screen.getByText('Team total')).toBeTruthy()
    expect(screen.getByText('3 workouts')).toBeTruthy()
    expect(screen.getByText('Goal: 6 workouts')).toBeTruthy()
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('3')
    const members = within(screen.getByRole('region', { name: 'Members' })).getAllByRole('listitem')
    expect(members.map(m => m.textContent)).toEqual([expect.stringContaining('Ana'), expect.stringContaining('Bia'), expect.stringContaining('Invited')])
  })

  it('lets an invited person join', async () => {
    show([invited()])
    render(<ChallengeDetail />)
    expect(screen.queryByText('Team total')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Join challenge' }))
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('You joined the challenge'))
    expect(h.join).toHaveBeenCalledWith('c1', false)
    expect(load).toHaveBeenCalledWith('challenges')
    expect(h.refresh).toHaveBeenCalled()
  })

  it('lets an invited person decline', async () => {
    show([invited()])
    render(<ChallengeDetail />)
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }))
    await waitFor(() => expect(h.nav).toHaveBeenCalledWith('/social/desafios', { replace: true }))
    expect(h.leave).toHaveBeenCalledWith('c1')
  })

  it('asks for the volume opt-in before joining a volume challenge', () => {
    show([invited({ template: 'volume_total', target: 20 })])
    render(<ChallengeDetail />)
    const join = screen.getByRole('button', { name: 'Join challenge' }) as HTMLButtonElement
    expect(join.disabled).toBe(true)
    fireEvent.click(screen.getByRole('switch'))
    expect(join.disabled).toBe(false)
    fireEvent.click(join)
    expect(h.join).toHaveBeenCalledWith('c1', true)
  })

  it('confirms before leaving', async () => {
    show([challengeOf()])
    render(<ChallengeDetail />)
    fireEvent.click(screen.getByRole('button', { name: 'Leave challenge' }))
    expect(screen.getByText('Leave this challenge? Your progress stops counting for it.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }))
    await waitFor(() => expect(h.leave).toHaveBeenCalledWith('c1'))
    expect(h.nav).toHaveBeenCalledWith('/social/desafios', { replace: true })
  })

  it.each([
    [{ status: 'won', me: { joined: true, won: true } }, 'Challenge completed! +300 XP'],
    [{ status: 'won', mode: 'solo', me: { joined: true, won: false } }, 'You did not reach the goal this time.'],
    [{ status: 'lost', me: { joined: true, won: false } }, 'The goal was not reached this time.'],
    [{ status: 'cancelled', me: { joined: true, won: null } }, 'Cancelled: fewer than 2 people joined.']
  ] as [Partial<Challenge>, string][])('tells how %j ended', (over, text) => {
    show([challengeOf(over)])
    render(<ChallengeDetail />)
    expect(screen.getByRole('status').textContent).toBe(text)
    expect(screen.queryByRole('button', { name: 'Leave challenge' })).toBeNull()
  })

  it('says when the challenge is gone', () => {
    show([])
    render(<ChallengeDetail />)
    expect(screen.getByText('This challenge is no longer available.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(h.nav).toHaveBeenCalledWith(-1)
  })
})
```

Run: `npx vitest run src/features/social/ChallengeDetail.test.tsx`
Expected: FAIL (`Cannot find module './ChallengeDetail'`).

- [ ] **Step 2: Implementar**

Criar `src/features/social/ChallengeDetail.tsx`:

```tsx
import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowLeft, CircleCheck, LoaderCircle, Swords, Trophy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { t } from '../../lib/i18n.js'
import { todayISO } from '../../lib/format.js'
import { useProgress } from '../gamification/useProgress'
import { joinChallenge, leaveChallenge, toSocialError } from './social-api'
import { useSocial } from './useSocial'
import { MODE_TEXT, TEMPLATE_TEXT, amountText, socialErrorText } from './labels'
import { challengeShare } from './templates'
import { fmtShortDay } from './format'
import { statusLine } from './ChallengesPanel'
import { PersonAvatar } from './components/PersonAvatar'
import { EmptyState, ErrorState } from './components/states'
import type { Challenge } from './types'

// /social/desafios/:id: the rule, where the team (or I) stand against the goal, each member, and
// the one action that fits: join or decline an invitation, leave (after a confirmation), or the
// result once it ended.
export default function ChallengeDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const res = useSocial(s => s.challenges)
  const [busy, setBusy] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [shareVolume, setShareVolume] = useState(false)
  useEffect(() => { void useSocial.getState().load('challenges') }, [])
  const c = res.data?.find(x => x.id === id) ?? null
  const today = todayISO()

  const act = async (run: () => Promise<void>, done: string, after?: () => void) => {
    setBusy(true)
    try {
      await run()
      toast.success(done)
      await useSocial.getState().load('challenges')
      void useProgress.getState().refresh()
      after?.()
    } catch (e) {
      toast.error(socialErrorText(toSocialError(e).code))
      void useSocial.getState().load('challenges')
    } finally {
      setBusy(false)
    }
  }
  const toList = () => navigate('/social/desafios', { replace: true })

  const header = (
    <header className="-ml-2 flex h-11 items-center">
      <Button variant="ghost" size="icon" className="size-11 rounded-full" aria-label={t('Back')} onClick={() => navigate(-1)}>
        <ArrowLeft className="size-5" />
      </Button>
    </header>
  )
  const page = (children: ReactNode) => <div className="mx-auto flex w-full max-w-md flex-col pb-6 font-sans text-foreground">{header}{children}</div>

  if (!c) {
    if (res.data) return page(<div className="mt-4"><EmptyState icon={Swords} title={socialErrorText('challenge_not_found')} /></div>)
    if (res.status === 'error' && res.error) return page(<div className="mt-4"><ErrorState code={res.error} onRetry={() => void useSocial.getState().load('challenges')} /></div>)
    return page(
      <div aria-busy="true" aria-label={t('Loading…')} className="mt-2 flex flex-col gap-3">
        <Skeleton className="h-4 w-40" /><Skeleton className="h-8 w-64" /><Skeleton className="h-32 w-full rounded-3xl" />
        <Skeleton className="h-14 w-full rounded-2xl" /><Skeleton className="h-14 w-full rounded-2xl" />
      </div>
    )
  }

  const tx = TEMPLATE_TEXT[c.template]
  const Icon = tx.icon
  const mine = c.members.find(m => m.me)
  const value = c.mode === 'team' ? c.total : (mine?.progress ?? 0)
  const invited = c.status === 'active' && !c.me.joined
  const needsOptIn = invited && c.template === 'volume_total'

  return page(
    <>
      <p className="mt-1 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
        <Icon aria-hidden className="size-4 text-primary" />{tx.name()} · {MODE_TEXT[c.mode].name()}
      </p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight text-balance">{c.title}</h1>
      <p className="mt-1 text-sm tabular-nums text-muted-foreground">
        {t('{0} to {1}', fmtShortDay(c.starts_on), fmtShortDay(c.ends_on))} · {statusLine(c, today)}
      </p>
      <p className="mt-3 text-sm leading-snug text-muted-foreground text-pretty">{tx.rule()} {MODE_TEXT[c.mode].detail()}</p>

      {c.status !== 'active' && <Result c={c} />}

      {!invited && (
        <section aria-labelledby="challenge-progress" className="mt-5 rounded-3xl border border-border bg-card p-5">
          <h2 id="challenge-progress" className="text-sm font-medium text-muted-foreground">{c.mode === 'team' ? t('Team total') : t('Your progress')}</h2>
          <p className="mt-1 font-mono text-3xl font-semibold tabular-nums">{amountText(c.template, value)}</p>
          <p className="text-sm tabular-nums text-muted-foreground">{t('Goal: {0}', amountText(c.template, c.target))}</p>
          <div role="progressbar" aria-label={c.mode === 'team' ? t('Team total') : t('Your progress')}
            aria-valuemin={0} aria-valuemax={c.target} aria-valuenow={value}
            className="mt-3 h-2.5 overflow-hidden rounded-full bg-primary/15">
            <div className="h-full rounded-full bg-primary transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
              style={{ width: `${challengeShare(c) * 100}%` }} />
          </div>
        </section>
      )}

      <section aria-label={t('Members')} className="mt-6">
        <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t('Members')}</h2>
        <ul className="mt-2 flex flex-col gap-2">
          {c.members.map(m => (
            <li key={m.id} className={cn('flex min-h-14 items-center gap-3 rounded-2xl px-3 py-2', m.me ? 'bg-primary/10' : 'bg-card')}>
              <PersonAvatar name={m.name} src={m.avatar_url} className="size-9" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-[15px] font-medium">
                  <span className="truncate">{m.name}</span>
                  {m.me && <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">{t('You')}</span>}
                </span>
                {m.joined && c.mode === 'solo' && (
                  <span aria-hidden className="mt-1 block h-1 overflow-hidden rounded-full bg-primary/15">
                    <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.min(1, (m.progress ?? 0) / c.target) * 100}%` }} />
                  </span>
                )}
              </span>
              {m.joined
                ? <span className="font-mono text-sm tabular-nums">{amountText(c.template, m.progress ?? 0)}</span>
                : <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">{t('Invited')}</span>}
              {m.won && <CircleCheck role="img" aria-label={t('Reached the goal')} className="size-5 shrink-0 text-primary" />}
            </li>
          ))}
        </ul>
      </section>

      {c.status === 'active' && (
        <div className="mt-6 flex flex-col gap-2">
          {invited ? (
            <>
              {needsOptIn && (
                <div className="flex items-start gap-3 rounded-2xl border border-border p-3">
                  <label htmlFor="join-volume" className="flex-1 cursor-pointer">
                    <span className="block text-[15px] font-medium">{t('Share my volume in this challenge')}</span>
                    <span className="block text-xs leading-snug text-muted-foreground">{t('People in this challenge see how many tonnes you lift. Never the load of each exercise.')}</span>
                  </label>
                  <Switch id="join-volume" checked={shareVolume} onCheckedChange={setShareVolume} />
                </div>
              )}
              <Button className="h-12 gap-2 rounded-2xl text-[15px] font-semibold" disabled={busy || (needsOptIn && !shareVolume)} aria-busy={busy}
                onClick={() => act(() => joinChallenge(c.id, needsOptIn && shareVolume), t('You joined the challenge'))}>
                {busy && <LoaderCircle aria-hidden className="size-5 animate-spin motion-reduce:animate-none" />}{t('Join challenge')}
              </Button>
              <Button variant="ghost" className="h-12 rounded-2xl" disabled={busy}
                onClick={() => act(() => leaveChallenge(c.id), t('Invitation declined'), toList)}>{t('Decline')}</Button>
            </>
          ) : leaving ? (
            <div role="alertdialog" aria-labelledby="leave-question" className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
              <p id="leave-question" className="text-sm leading-snug">{t('Leave this challenge? Your progress stops counting for it.')}</p>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" className="h-12 rounded-xl" onClick={() => setLeaving(false)}>{t('Cancel')}</Button>
                <Button variant="destructive" className="h-12 rounded-xl" disabled={busy} aria-busy={busy}
                  onClick={() => act(() => leaveChallenge(c.id), t('You left the challenge'), toList)}>{t('Leave')}</Button>
              </div>
            </div>
          ) : (
            <Button variant="ghost" className="h-12 rounded-2xl text-muted-foreground" onClick={() => setLeaving(true)}>{t('Leave challenge')}</Button>
          )}
        </div>
      )}
    </>
  )
}

function Result({ c }: { c: Challenge }) {
  const good = c.me.won === true
  const text = c.status === 'cancelled' ? t('Cancelled: fewer than 2 people joined.')
    : good ? t('Challenge completed! +300 XP')
    : c.status === 'won' ? t('You did not reach the goal this time.')
    : t('The goal was not reached this time.')
  return (
    <div className={cn('mt-4 flex items-center gap-3 rounded-2xl p-4 animate-in fade-in-0 duration-200 motion-reduce:animate-none', good ? 'bg-primary/15' : 'bg-secondary/70')}>
      {good ? <Trophy aria-hidden className="size-6 shrink-0 text-primary" /> : <Swords aria-hidden className="size-5 shrink-0 text-muted-foreground" />}
      <p role="status" className={cn('text-[15px] font-medium', !good && 'text-muted-foreground')}>{text}</p>
    </div>
  )
}
```

- [ ] **Step 3: Rodar e ver passar**

Run: `npx vitest run src/features/social/ChallengeDetail.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
node scripts/check-source-strings.mjs --strict
npm run typecheck && npm test && npm run build
git add src/features/social/ChallengeDetail.tsx src/features/social/ChallengeDetail.test.tsx
git commit -m "feat(social): challenge detail with progress per member, join and leave

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Feed

**Files:**
- Create: `src/features/social/FeedPanel.tsx`
- Test: `src/features/social/FeedPanel.test.tsx`

**Interfaces:**
- Consumes: `useSocial` (`feed`, `friends`, `loadFeed`, `load`); `useProfile` (`profile.share_activity`, Fase 0); `EXIDX` (`src/lib/exercises.js`) e `exerciseNameFor` (`src/lib/i18n.js`); `addDays` (Task 5); `fmtShortDay`, `fmtTime` (Task 7); peças da Task 8.
- Produces: `FeedPanel` (default export).

- [ ] **Step 1: Teste que falha**

Criar `src/features/social/FeedPanel.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

const h = vi.hoisted(() => ({ nav: vi.fn() }))
vi.mock('react-router-dom', () => ({ useNavigate: () => h.nav }))
vi.mock('@/components/ui/drawer', () => import('./test-drawer'))

import FeedPanel from './FeedPanel'
import { useSocial, type FeedState } from './useSocial'
import { useProfile } from '../profile/useProfile'
import { BIA, ME, feedItemOf, friendOf } from './test-social'

const real = { load: useSocial.getState().load, loadFeed: useSocial.getState().loadFeed }
const load = vi.fn(async () => null)
const loadFeed = vi.fn(async () => {})
const feed = (over: Partial<FeedState>) => useSocial.setState({ feed: { status: 'ready', items: [], next: null, stale: false, error: null, busy: false, ...over } })
const friends = (n: number) => useSocial.setState({ friends: { status: 'ready', data: n ? [friendOf(BIA, 'Bia')] : [], stale: false, error: null } })

beforeEach(() => {
  localStorage.clear()
  useSocial.getState().reset()
  useSocial.setState({ userId: ME, load, loadFeed })
  useProfile.setState({ profile: { share_activity: true } as never })
  ;[load, loadFeed, h.nav].forEach(f => f.mockReset())
})
afterEach(() => { cleanup(); useSocial.setState(real); useProfile.setState({ profile: null }) })

describe('FeedPanel', () => {
  it('asks for the first page and the friends', () => {
    render(<FeedPanel />)
    expect(loadFeed).toHaveBeenCalledWith()
    expect(load).toHaveBeenCalledWith('friends')
  })

  it('shows finished workouts by day, with sets and records', () => {
    friends(1)
    feed({ items: [
      feedItemOf(2, { prs: ['zz-custom'] }),
      feedItemOf(1, { day: '2026-10-06', at: '2026-10-06T19:00:00Z', sets: null })
    ] })
    render(<FeedPanel />)
    expect(screen.getAllByText('Bia finished a workout')).toHaveLength(2)
    expect(screen.getByText(/18 sets/)).toBeTruthy()
    expect(screen.getByText('New personal record')).toBeTruthy()
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(2)
  })

  it('loads more and says when everything was seen', () => {
    friends(1)
    feed({ items: [feedItemOf(2)], next: { before: '2026-10-07T18:30:00Z', before_id: 2 } })
    const { unmount } = render(<FeedPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(loadFeed).toHaveBeenCalledWith(true)
    unmount()
    feed({ items: [feedItemOf(2)] })
    render(<FeedPanel />)
    expect(screen.getByText('You are all caught up.')).toBeTruthy()
  })

  it('asks to turn sharing on when mine is off', () => {
    useProfile.setState({ profile: { share_activity: false } as never })
    friends(1)
    feed({})
    render(<FeedPanel />)
    expect(screen.getByText('Your workouts are hidden from friends.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Turn on sharing' }))
    expect(h.nav).toHaveBeenCalledWith('/perfil')
  })

  it('explains an empty feed with and without friends', () => {
    friends(1)
    feed({})
    const { unmount } = render(<FeedPanel />)
    expect(screen.getByText('Nothing here yet')).toBeTruthy()
    unmount()
    friends(0)
    render(<FeedPanel />)
    expect(screen.getByText('Training together pays off')).toBeTruthy()
  })

  it('offers a retry when the feed could not load', () => {
    feed({ status: 'error', error: 'network' })
    render(<FeedPanel />)
    loadFeed.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(loadFeed).toHaveBeenCalledWith()
  })
})
```

Run: `npx vitest run src/features/social/FeedPanel.test.tsx`
Expected: FAIL (`Cannot find module './FeedPanel'`).

- [ ] **Step 2: Implementar**

Criar `src/features/social/FeedPanel.tsx`:

```tsx
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Activity, EyeOff, LoaderCircle, Trophy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { t, exerciseNameFor } from '../../lib/i18n.js'
import { EXIDX } from '../../lib/exercises.js'
import { todayISO } from '../../lib/format.js'
import { useProfile } from '../profile/useProfile'
import { useSocial } from './useSocial'
import { addDays } from './templates'
import { fmtShortDay, fmtTime } from './format'
import { InviteButton } from './InviteButton'
import { PersonAvatar } from './components/PersonAvatar'
import { EmptyState, ErrorState, ListSkeleton, StaleNote } from './components/states'
import type { FeedItem } from './types'

// A friend's custom exercise is not in this phone's catalogue (and its name is theirs): the
// record then shows without a name.
const exerciseName = (id: string): string | null => {
  const ex = (EXIDX as Record<string, unknown>)[id]
  return ex ? exerciseNameFor(ex) || null : null
}

const dayLabel = (day: string, today: string): string =>
  day === today ? t('Today') : day === addDays(today, -1) ? t('Yesterday') : fmtShortDay(day)

// Consecutive items of the same day under one heading (items come newest first).
function byDay(items: FeedItem[]): [string, FeedItem[]][] {
  const out: [string, FeedItem[]][] = []
  for (const i of items) {
    const last = out[out.length - 1]
    if (last && last[0] === i.day) last[1].push(i)
    else out.push([i.day, [i]])
  }
  return out
}

// Workouts of friends who share them, newest first, 20 at a time, as a timeline by day.
export default function FeedPanel() {
  const navigate = useNavigate()
  const feed = useSocial(s => s.feed)
  const friends = useSocial(s => s.friends)
  const sharing = useProfile(s => s.profile?.share_activity ?? true)
  useEffect(() => {
    void useSocial.getState().loadFeed()
    void useSocial.getState().load('friends')
  }, [])
  const today = todayISO()
  const empty = feed.items.length === 0

  return (
    <section aria-labelledby="feed-title" className="flex flex-col gap-4">
      <h2 id="feed-title" className="sr-only">{t('Feed')}</h2>
      {!sharing && (
        <div className="flex items-center gap-3 rounded-2xl bg-secondary/70 p-3">
          <EyeOff aria-hidden className="size-5 shrink-0 text-muted-foreground" />
          <p className="flex-1 text-sm leading-snug">{t('Your workouts are hidden from friends.')}</p>
          <Button variant="outline" className="h-11 shrink-0 rounded-xl" onClick={() => navigate('/perfil')}>{t('Turn on sharing')}</Button>
        </div>
      )}
      <StaleNote stale={feed.stale} />
      {empty && feed.status === 'error' ? (
        <ErrorState code={feed.error ?? 'network'} onRetry={() => void useSocial.getState().loadFeed()} />
      ) : empty && feed.status !== 'ready' ? (
        <ListSkeleton />
      ) : empty ? (
        friends.data && friends.data.length === 0 ? (
          <EmptyState icon={Activity} title={t('Training together pays off')}
            body={t('Invite a friend with a link. Once they join, you both show up in the ranking.')}>
            <InviteButton />
          </EmptyState>
        ) : (
          <EmptyState icon={Activity} title={t('Nothing here yet')}
            body={t('Friends who turn on sharing in their profile show up here after each workout.')} />
        )
      ) : (
        <ol className="flex flex-col gap-5">
          {byDay(feed.items).map(([day, items], k) => (
            <li key={day + ':' + k}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{dayLabel(day, today)}</h3>
              <ol className="ml-2 flex flex-col gap-3 border-l border-border pl-5">
                {items.map(i => <FeedRow key={i.id} item={i} />)}
              </ol>
            </li>
          ))}
        </ol>
      )}
      {feed.next && (
        <Button variant="outline" className="h-12 gap-2 rounded-2xl" disabled={feed.busy} aria-busy={feed.busy}
          onClick={() => void useSocial.getState().loadFeed(true)}>
          {feed.busy && <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />}
          {feed.busy ? t('Loading…') : t('Load more')}
        </Button>
      )}
      {!feed.next && !empty && <p className="text-center text-xs text-muted-foreground">{t('You are all caught up.')}</p>}
    </section>
  )
}

function FeedRow({ item }: { item: FeedItem }) {
  return (
    <li className="relative animate-in fade-in-0 duration-200 motion-reduce:animate-none">
      <span aria-hidden className="absolute -left-[1.6rem] top-4 size-2.5 rounded-full bg-primary ring-4 ring-background" />
      <article className="flex gap-3 rounded-2xl bg-card p-3">
        <PersonAvatar name={item.user.name} src={item.user.avatar_url} className="size-10" />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-medium leading-snug">{t('{0} finished a workout', item.user.name)}</p>
          <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
            <time dateTime={item.at}>{fmtTime(item.at)}</time>
            {item.sets !== null && <> · {t('{0} sets', item.sets)}</>}
          </p>
          {item.prs.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {item.prs.map(ex => {
                const name = exerciseName(ex)
                return (
                  <li key={ex} className="flex items-center gap-1 rounded-full bg-primary/15 px-2.5 py-1 text-xs font-medium text-primary">
                    <Trophy aria-hidden className="size-3.5" />{name ? t('PR: {0}', name) : t('New personal record')}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </article>
    </li>
  )
}
```

- [ ] **Step 3: Rodar e ver passar**

Run: `npx vitest run src/features/social/FeedPanel.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
node scripts/check-source-strings.mjs --strict
npm run typecheck && npm test && npm run build
git add src/features/social/FeedPanel.tsx src/features/social/FeedPanel.test.tsx
git commit -m "feat(social): opt-in workout feed as a timeline by day

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Área social, convite por link e TabBar

**Files:**
- Create: `src/features/social/SocialScreen.tsx`, `src/features/social/InviteScreen.tsx`, `src/features/social/PendingInviteHost.tsx`
- Create: `src/features/nav/TabBar.tsx`
- Modify: `src/components/TabBar.jsx` (vira reexport), `src/App.jsx`, `src/views/Plan.jsx`
- Test: `src/features/social/SocialScreen.test.tsx`, `InviteScreen.test.tsx`, `PendingInviteHost.test.tsx`, `src/features/nav/TabBar.test.tsx`; continua valendo `src/components/TabBar.test.jsx`

**Interfaces:**
- Consumes: os painéis das Tasks 8–12; `ChallengeDetail` (Task 11); `getInvite`, `acceptInvite`, `toSocialError` (Task 5); `readPendingInvite`, `savePendingInvite`, `clearPendingInvite`, `inviteCodeFromPath` (Task 5); `pendingInvites` (Task 5); `signInWithGoogle` (Fase 0, `src/features/auth/auth.ts`); `useProgress.refresh` (1a); legado `Icon`, `effectiveRoutines`, `effectiveRoutineIds`, `todayISO`.
- Produces: `SocialScreen` (default; `/social/:section`), `InviteScreen` (default; `{ code: string; signedIn: boolean }`) e `InviteRoute` (named; `/convite/:code`), `PendingInviteHost` (default), `TabBar` (default em `src/features/nav/TabBar.tsx`, mesma prop `onStart` do legado). Rotas: `/social`, `/social/:section`, `/social/desafios/:id`, `/convite/:code`.

- [ ] **Step 1: Testes que falham**

Criar `src/features/social/SocialScreen.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

const h = vi.hoisted(() => ({ nav: vi.fn(), section: 'ranking' as string | undefined }))
vi.mock('react-router-dom', () => ({
  useNavigate: () => h.nav,
  useParams: () => ({ section: h.section }),
  Navigate: ({ to }: { to: string }) => <p>redirect {to}</p>
}))
vi.mock('./RankingPanel', () => ({ default: () => <p>ranking panel</p> }))
vi.mock('./ChallengesPanel', () => ({ default: () => <p>challenges panel</p> }))
vi.mock('./FeedPanel', () => ({ default: () => <p>feed panel</p> }))
vi.mock('./FriendsPanel', () => ({ default: () => <p>friends panel</p> }))

import SocialScreen from './SocialScreen'
import { useSocial } from './useSocial'
import { challengeOf } from './test-social'

beforeEach(() => { useSocial.getState().reset(); h.nav.mockClear(); h.section = 'ranking' })
afterEach(cleanup)

describe('SocialScreen', () => {
  it('shows the section from the route and switches without piling up history', () => {
    render(<SocialScreen />)
    expect(screen.getByText('ranking panel')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Ranking' }).getAttribute('aria-current')).toBe('page')
    fireEvent.click(screen.getByRole('button', { name: 'Friends' }))
    expect(h.nav).toHaveBeenCalledWith('/social/amigos', { replace: true })
  })

  it('sends an unknown section to the ranking', () => {
    h.section = 'nope'
    render(<SocialScreen />)
    expect(screen.getByText('redirect /social/ranking')).toBeTruthy()
  })

  it('marks challenge invitations waiting for an answer', () => {
    useSocial.setState({ challenges: { status: 'ready', data: [challengeOf({ me: { joined: false, won: null } })], stale: false, error: null } })
    const { container } = render(<SocialScreen />)
    expect(container.querySelector('[data-slot="invite-dot"]')).toBeTruthy()
  })
})
```

Criar `src/features/social/InviteScreen.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ nav: vi.fn(), getInvite: vi.fn(), acceptInvite: vi.fn(), signIn: vi.fn(), refresh: vi.fn() }))
vi.mock('react-router-dom', () => ({ useNavigate: () => h.nav, useParams: () => ({ code: 'AbCdEfGh12' }) }))
vi.mock('./social-api', async orig => ({ ...(await orig<typeof import('./social-api')>()), getInvite: h.getInvite, acceptInvite: h.acceptInvite }))
vi.mock('../auth/auth', () => ({ signInWithGoogle: h.signIn }))
vi.mock('../gamification/useProgress', () => ({ useProgress: { getState: () => ({ refresh: h.refresh }) } }))
vi.mock('motion/react', async orig => ({ ...(await orig<typeof import('motion/react')>()), useReducedMotion: () => true }))

import InviteScreen from './InviteScreen'
import { useSocial } from './useSocial'
import { SocialError } from './social-api'
import { readPendingInvite, savePendingInvite } from './pending-invite'
import type { InviteInfo } from './types'

const CODE = 'AbCdEfGh12'
const open: InviteInfo = { status: 'open', expires_at: '2026-10-12T15:00:00Z', inviter: { name: 'Ana', avatar_url: null } }
const realLoad = useSocial.getState().load
const load = vi.fn(async () => null)

beforeEach(() => {
  localStorage.clear()
  useSocial.getState().reset()
  useSocial.setState({ userId: 'u2', load })
  Object.values(h).forEach(f => f.mockReset())
  load.mockClear()
})
afterEach(() => { cleanup(); useSocial.setState({ load: realLoad }) })

describe('InviteScreen', () => {
  it('shows who invited before sign-in and keeps the code for after Google', async () => {
    h.getInvite.mockResolvedValue(open)
    render(<InviteScreen code={CODE} signedIn={false} />)
    expect(await screen.findByText('Ana invited you to train together')).toBeTruthy()
    expect(screen.getByText('Your weight, diet and loads stay private.')).toBeTruthy()
    expect(readPendingInvite()).toBe(CODE)
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }))
    expect(h.signIn).toHaveBeenCalledTimes(1)
  })

  it('accepts by itself when coming back from Google with this invite', async () => {
    savePendingInvite(CODE)
    h.getInvite.mockResolvedValue(open)
    h.acceptInvite.mockResolvedValue({ id: 'a', name: 'Ana', avatar_url: null })
    render(<InviteScreen code={CODE} signedIn />)
    expect(await screen.findByText('You are friends now')).toBeTruthy()
    expect(screen.getByText('Ana is in your ranking now.')).toBeTruthy()
    expect(h.acceptInvite).toHaveBeenCalledWith(CODE)
    expect(readPendingInvite()).toBeNull()
    expect(load).toHaveBeenCalledWith('friends')
    expect(h.refresh).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Create a challenge' }))
    expect(h.nav).toHaveBeenCalledWith('/social/desafios?novo=1', { replace: true })
  })

  it('asks a signed-in person who just opened the link to accept', async () => {
    h.getInvite.mockResolvedValue(open)
    h.acceptInvite.mockResolvedValue({ id: 'a', name: 'Ana', avatar_url: null })
    render(<InviteScreen code={CODE} signedIn />)
    fireEvent.click(await screen.findByRole('button', { name: 'Accept invite' }))
    expect(await screen.findByText('You are friends now')).toBeTruthy()
  })

  it.each([
    ['expired', 'This invite has expired. Ask for a new link.'],
    ['used', 'Someone already used this invite. Ask for a new link.'],
    ['self', 'This is your own invite. Send it to a friend.'],
    ['already_friends', 'You are already friends.']
  ] as const)('explains an invite that is %s and forgets it', async (status, text) => {
    savePendingInvite(CODE)
    h.getInvite.mockResolvedValue({ ...open, status })
    render(<InviteScreen code={CODE} signedIn />)
    expect(await screen.findByText(text)).toBeTruthy()
    expect(readPendingInvite()).toBeNull()
    expect(h.acceptInvite).not.toHaveBeenCalled()
  })

  it('keeps the code and offers a retry when offline', async () => {
    savePendingInvite(CODE)
    h.getInvite.mockRejectedValue(new SocialError('network'))
    render(<InviteScreen code={CODE} signedIn />)
    expect(await screen.findByText('Could not reach the server. Check your connection and try again.')).toBeTruthy()
    expect(readPendingInvite()).toBe(CODE)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(h.getInvite).toHaveBeenCalledTimes(2))
  })
})
```

Criar `src/features/social/PendingInviteHost.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'

const h = vi.hoisted(() => ({ nav: vi.fn(), path: '/home' }))
vi.mock('react-router-dom', () => ({ useNavigate: () => h.nav, useLocation: () => ({ pathname: h.path }) }))

import PendingInviteHost from './PendingInviteHost'
import { savePendingInvite } from './pending-invite'

beforeEach(() => { localStorage.clear(); h.nav.mockClear(); h.path = '/home' })
afterEach(cleanup)

describe('PendingInviteHost', () => {
  it('takes a pending invite to its screen once the account is ready', () => {
    savePendingInvite('AbCdEfGh12')
    render(<PendingInviteHost />)
    expect(h.nav).toHaveBeenCalledWith('/convite/AbCdEfGh12', { replace: true })
  })

  it('stays put without one, or when already there', () => {
    render(<PendingInviteHost />)
    cleanup()
    savePendingInvite('AbCdEfGh12')
    h.path = '/convite/AbCdEfGh12'
    render(<PendingInviteHost />)
    expect(h.nav).not.toHaveBeenCalled()
  })
})
```

Criar `src/features/nav/TabBar.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

const h = vi.hoisted(() => ({ nav: vi.fn(), path: '/social/ranking' }))
vi.mock('react-router-dom', () => ({ useNavigate: () => h.nav, useLocation: () => ({ pathname: h.path }) }))

import TabBar from './TabBar'
import { DEF, useStore } from '../../store/useStore.js'
import { useSocial } from '../social/useSocial'
import { challengeOf } from '../social/test-social'

beforeEach(() => {
  useStore.setState({ S: JSON.parse(JSON.stringify(DEF)), user: { id: 'u1' } })
  useSocial.getState().reset()
  h.nav.mockClear()
})
afterEach(() => { cleanup(); useStore.setState({ user: null }) })

const tab = (name: RegExp) => screen.getByRole('button', { name })

describe('TabBar', () => {
  it('has Home, Plan, Start, Social and Stats, and opens the social area', () => {
    render(<TabBar onStart={() => {}} />)
    expect(screen.getAllByRole('button').map(b => b.textContent)).toEqual(['Home', 'Plan', 'Start', 'Social', 'Stats'])
    expect(tab(/Social/).className).toBe('on')
    fireEvent.click(tab(/Social/))
    expect(h.nav).toHaveBeenCalledWith('/social')
  })

  it('lights Plan on the exercise library, and Social on an invite', () => {
    h.path = '/library'
    const { unmount } = render(<TabBar onStart={() => {}} />)
    expect(tab(/Plan/).className).toBe('on')
    unmount()
    h.path = '/convite/AbCdEfGh12'
    render(<TabBar onStart={() => {}} />)
    expect(tab(/Social/).className).toBe('on')
  })

  it('counts challenge invitations on the social tab', () => {
    useSocial.setState({ challenges: { status: 'ready', data: [challengeOf({ me: { joined: false, won: null } })], stale: false, error: null } })
    render(<TabBar onStart={() => {}} />)
    expect(screen.getByRole('button', { name: 'Social. Challenge invitations: 1' })).toBeTruthy()
  })
})
```

Run: `npx vitest run src/features/social/SocialScreen.test.tsx src/features/social/InviteScreen.test.tsx src/features/social/PendingInviteHost.test.tsx src/features/nav/TabBar.test.tsx`
Expected: FAIL (módulos inexistentes).

- [ ] **Step 2: `SocialScreen`**

Criar `src/features/social/SocialScreen.tsx`:

```tsx
import type { ComponentType } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { Activity, Swords, Trophy, Users, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { t } from '../../lib/i18n.js'
import { useSocial } from './useSocial'
import { pendingInvites } from './templates'
import RankingPanel from './RankingPanel'
import ChallengesPanel from './ChallengesPanel'
import FeedPanel from './FeedPanel'
import FriendsPanel from './FriendsPanel'

type Section = 'ranking' | 'desafios' | 'feed' | 'amigos'
const SECTIONS: { key: Section; label: () => string; icon: LucideIcon }[] = [
  { key: 'ranking', label: () => t('Ranking'), icon: Trophy },
  { key: 'desafios', label: () => t('Challenges'), icon: Swords },
  { key: 'feed', label: () => t('Feed'), icon: Activity },
  { key: 'amigos', label: () => t('Friends'), icon: Users }
]
const PANELS: Record<Section, ComponentType> = { ranking: RankingPanel, desafios: ChallengesPanel, feed: FeedPanel, amigos: FriendsPanel }

// The social tab: one header, four sections. Switching sections replaces the history entry, so
// Back leaves the social area instead of walking through its sections.
export default function SocialScreen() {
  const { section } = useParams()
  const navigate = useNavigate()
  const waiting = useSocial(s => pendingInvites(s.challenges.data))
  if (!section || !(section in PANELS)) return <Navigate to="/social/ranking" replace />
  const Panel = PANELS[section as Section]

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 pb-6 font-sans text-foreground">
      <h1 className="text-2xl font-semibold tracking-tight">{t('Social')}</h1>
      <nav aria-label={t('Social')} className="grid grid-cols-4 gap-1 rounded-2xl bg-secondary/60 p-1">
        {SECTIONS.map(s => {
          const on = s.key === section
          const Icon = s.icon
          return (
            <button key={s.key} type="button" aria-current={on ? 'page' : undefined}
              onClick={() => { if (!on) navigate('/social/' + s.key, { replace: true }) }}
              className={cn('relative flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-medium outline-none transition-colors duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/50',
                on ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground')}>
              <Icon aria-hidden className="size-[18px]" />
              {s.label()}
              {s.key === 'desafios' && waiting > 0 && (
                <span data-slot="invite-dot" aria-hidden className="absolute right-2 top-1.5 size-2 rounded-full bg-primary" />
              )}
            </button>
          )
        })}
      </nav>
      <Panel />
    </div>
  )
}
```

- [ ] **Step 3: `InviteScreen` e `PendingInviteHost`**

Criar `src/features/social/InviteScreen.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { motion, useReducedMotion } from 'motion/react'
import { toast } from 'sonner'
import { LoaderCircle, Lock, RefreshCw, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { t } from '../../lib/i18n.js'
import { signInWithGoogle } from '../auth/auth'
import { useProgress } from '../gamification/useProgress'
import { acceptInvite, getInvite, toSocialError } from './social-api'
import { clearPendingInvite, readPendingInvite, savePendingInvite } from './pending-invite'
import { socialErrorText } from './labels'
import { useSocial } from './useSocial'
import { PersonAvatar } from './components/PersonAvatar'
import type { InviteInfo, Person, SocialErrorCode } from './types'

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; code: SocialErrorCode }
  | { kind: 'open'; info: InviteInfo }
  | { kind: 'accepting'; info: InviteInfo }
  | { kind: 'friends'; friend: Person }

const STATUS_ERROR: Record<Exclude<InviteInfo['status'], 'open'>, SocialErrorCode> = {
  expired: 'invite_expired', used: 'invite_used', self: 'self_invite', already_friends: 'already_friends'
}
const EASE_OUT = [0.22, 1, 0.36, 1] as const

// /convite/:code, with or without a session (Decision 2). Signed out: who invited, a promise of
// privacy and "Continue with Google", keeping the code for after the round trip. Signed in: one
// tap to accept, or no tap at all when this is the invite that sent the person to Google.
export default function InviteScreen({ code, signedIn }: { code: string; signedIn: boolean }) {
  const navigate = useNavigate()
  const reduce = useReducedMotion() ?? false
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [opening, setOpening] = useState(false)
  const auto = useRef(signedIn && readPendingInvite() === code)
  // Only the latest lookup may move the screen on (StrictMode runs the first effect twice in dev).
  const seq = useRef(0)

  const accept = useCallback(async (info: InviteInfo) => {
    setPhase({ kind: 'accepting', info })
    try {
      const friend = await acceptInvite(code)
      clearPendingInvite()
      setPhase({ kind: 'friends', friend })
      const s = useSocial.getState()
      void s.load('friends'); void s.load('weekly'); void s.load('alltime')
      // first_friend and any level it reaches show up as celebrations (CelebrationHost, 1a).
      void useProgress.getState().refresh()
    } catch (e) {
      const err = toSocialError(e).code
      if (err !== 'network') clearPendingInvite()
      setPhase({ kind: 'error', code: err })
    }
  }, [code])

  const fetchInfo = useCallback(async () => {
    const mine = ++seq.current
    setPhase({ kind: 'loading' })
    try {
      const info = await getInvite(code)
      if (mine !== seq.current) return
      if (info.status !== 'open') {
        clearPendingInvite()
        setPhase({ kind: 'error', code: STATUS_ERROR[info.status] })
        return
      }
      if (!signedIn) savePendingInvite(code)
      if (auto.current) { auto.current = false; await accept(info); return }
      setPhase({ kind: 'open', info })
    } catch (e) {
      if (mine !== seq.current) return
      const err = toSocialError(e).code
      if (err !== 'network') clearPendingInvite()
      setPhase({ kind: 'error', code: err })
    }
  }, [code, signedIn, accept])

  useEffect(() => { void fetchInfo() }, [fetchInfo])

  const signIn = async () => {
    savePendingInvite(code)
    setOpening(true)
    try {
      await signInWithGoogle()
    } catch {
      setOpening(false)
      toast.error(t('Could not start sign-in. Try again.'))
    }
  }

  const enter = {
    initial: reduce ? { opacity: 0 } : { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: reduce ? 0.15 : 0.3, ease: EASE_OUT }
  }

  let body: ReactNode
  if (phase.kind === 'loading') {
    body = (
      <div aria-busy="true" aria-label={t('Loading…')} className="flex flex-col items-center gap-4">
        <Skeleton className="size-24 rounded-full" /><Skeleton className="h-7 w-56" /><Skeleton className="h-4 w-64" />
      </div>
    )
  } else if (phase.kind === 'error') {
    const home = () => navigate('/home', { replace: true })
    body = (
      <motion.div {...enter} role="alert" className="flex flex-col items-center gap-4 text-center">
        <span className="grid size-16 place-items-center rounded-2xl bg-muted text-muted-foreground"><Users aria-hidden className="size-7" /></span>
        <p className="max-w-xs text-lg font-semibold leading-snug text-balance">{socialErrorText(phase.code)}</p>
        <div className="mt-2 flex w-full flex-col gap-2">
          {phase.code === 'network' && (
            <Button className="h-12 gap-2 rounded-2xl" onClick={() => void fetchInfo()}><RefreshCw aria-hidden className="size-4" />{t('Try again')}</Button>
          )}
          {!signedIn ? (
            <Button variant={phase.code === 'network' ? 'ghost' : 'default'} className="h-12 rounded-2xl" onClick={home}>{t('Sign in')}</Button>
          ) : phase.code === 'already_friends' ? (
            <Button className="h-12 rounded-2xl" onClick={() => navigate('/social/ranking', { replace: true })}>{t('See ranking')}</Button>
          ) : (
            <Button variant={phase.code === 'network' ? 'ghost' : 'default'} className="h-12 rounded-2xl" onClick={home}>{t('Go to Home')}</Button>
          )}
        </div>
      </motion.div>
    )
  } else if (phase.kind === 'friends') {
    const f = phase.friend
    body = (
      <motion.div initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.26, ease: EASE_OUT }} className="flex flex-col items-center gap-4 text-center">
        <PersonAvatar name={f.name} src={f.avatar_url} className="size-24 text-2xl ring-4 ring-primary" />
        <h1 role="status" className="text-2xl font-semibold tracking-tight">{t('You are friends now')}</h1>
        <p className="text-base text-muted-foreground">{t('{0} is in your ranking now.', f.name)}</p>
        <div className="mt-4 flex w-full flex-col gap-2">
          <Button className="h-12 rounded-2xl text-[15px] font-semibold" onClick={() => navigate('/social/ranking', { replace: true })}>{t('See ranking')}</Button>
          <Button variant="outline" className="h-12 rounded-2xl" onClick={() => navigate('/social/desafios?novo=1', { replace: true })}>{t('Create a challenge')}</Button>
        </div>
      </motion.div>
    )
  } else {
    const { info } = phase
    const busy = phase.kind === 'accepting'
    body = (
      <motion.div {...enter} className="flex flex-col items-center gap-4 text-center">
        <PersonAvatar name={info.inviter.name} src={info.inviter.avatar_url} className="size-24 text-2xl ring-4 ring-primary/30" />
        <h1 className="text-2xl font-semibold leading-tight tracking-tight text-balance">{t('{0} invited you to train together', info.inviter.name)}</h1>
        <p className="max-w-sm text-base leading-relaxed text-muted-foreground text-pretty">
          {t('See how consistent you both are, compete in the weekly ranking and take on challenges together.')}
        </p>
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><Lock aria-hidden className="size-4" />{t('Your weight, diet and loads stay private.')}</p>
        <div className="mt-4 w-full">
          {signedIn ? (
            <Button size="lg" className="h-14 w-full gap-2 rounded-2xl text-base font-semibold" disabled={busy} aria-busy={busy} onClick={() => void accept(info)}>
              {busy && <LoaderCircle aria-hidden className="size-5 animate-spin motion-reduce:animate-none" />}
              {busy ? t('Becoming friends…') : t('Accept invite')}
            </Button>
          ) : (
            <Button size="lg" className="h-14 w-full gap-3 rounded-2xl text-base font-semibold" disabled={opening} aria-busy={opening} onClick={signIn}>
              {opening && <LoaderCircle aria-hidden className="size-5 animate-spin motion-reduce:animate-none" />}
              {opening ? t('Opening Google…') : t('Continue with Google')}
            </Button>
          )}
        </div>
      </motion.div>
    )
  }

  if (!signedIn) {
    return (
      <main className="relative isolate flex min-h-dvh flex-col overflow-hidden bg-background font-sans text-foreground">
        <div aria-hidden className="pointer-events-none absolute -top-48 left-1/2 -z-10 size-[36rem] -translate-x-1/2 rounded-full bg-primary/15 blur-3xl" />
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-[calc(3rem+env(safe-area-inset-top))]">
          <p className="mb-8 text-center font-mono text-xs font-medium uppercase tracking-[0.2em] text-primary">Performance</p>
          {body}
        </div>
      </main>
    )
  }
  return <div className="mx-auto flex w-full max-w-md flex-col justify-center py-10 font-sans text-foreground">{body}</div>
}

// The route inside the signed-in app.
export function InviteRoute() {
  const { code } = useParams()
  return <InviteScreen code={code ?? ''} signedIn />
}
```

Criar `src/features/social/PendingInviteHost.tsx`:

```tsx
import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { readPendingInvite } from './pending-invite'

// Mounted once the signed-in account has a ready profile (after the onboarding for a new one):
// an invite opened before signing in now gets its screen, which accepts it (Decision 2). Runs
// once per mount; where the person goes afterwards is up to them.
export default function PendingInviteHost() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  useEffect(() => {
    const code = readPendingInvite()
    if (code && pathname !== '/convite/' + code) navigate('/convite/' + code, { replace: true })
  }, [])
  return null
}
```

- [ ] **Step 4: TabBar**

Criar `src/features/nav/TabBar.tsx`:

```tsx
import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Users } from 'lucide-react'
import { useStore } from '../../store/useStore.js'
import { effectiveRoutineIds, effectiveRoutines } from '../../lib/history.js'
import { todayISO } from '../../lib/format.js'
import { t } from '../../lib/i18n.js'
import Icon from '../../components/Icon.jsx'
import { useSocial } from '../social/useSocial'
import { pendingInvites } from '../social/templates'

type TabKey = 'home' | 'plan' | 'social' | 'stats'
// The tab a route lights: screens reached from a tab keep it lit.
const TAB_OF: Record<string, TabKey> = {
  home: 'home', settings: 'home', perfil: 'home', conquistas: 'home',
  plan: 'plan', library: 'plan', muscles: 'plan',
  social: 'social', convite: 'social',
  stats: 'stats', history: 'stats', 'structural-balance': 'stats'
}

type AppStore = { S: any; user: unknown; isGuest: () => boolean }

// Module scope, not inside TabBar: a component declared in the render body is a new type on every
// render, and the bar re-renders once a second during a rest (see components/TabBar.test.jsx).
function Tab({ active, glyph, label, count = 0, onClick }: { active: boolean; glyph: ReactNode; label: string; count?: number; onClick: () => void }) {
  return (
    <button className={active ? 'on' : ''} aria-current={active ? 'page' : undefined}
      aria-label={count > 0 ? t('Social. Challenge invitations: {0}', count) : undefined} onClick={onClick}>
      <span className="relative">
        {glyph}
        {count > 0 && (
          <span aria-hidden className="absolute -right-2 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 font-mono text-[10px] font-semibold leading-none text-primary-foreground tabular-nums">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </span>
      <span>{label}</span>
    </button>
  )
}

// Home, Plan, Start, Social and Stats (Decision 14). Keeps the legacy #tabbar markup and classes,
// so the glass, safe area and the raised Start button stay as they are.
export default function TabBar({ onStart }: { onStart: (ids: unknown[]) => void }) {
  const nav = useNavigate()
  const loc = useLocation()
  const S = useStore((s: AppStore) => s.S)
  const user = useStore((s: AppStore) => s.user)
  const isGuest = useStore((s: AppStore) => s.isGuest())
  const waiting = useSocial(s => pendingInvites(s.challenges.data))
  if (!user && !isGuest) return null
  const cur = loc.pathname.split('/')[1] || 'home'
  const on = (k: TabKey) => TAB_OF[cur] === k

  const startWorkout = () => {
    if (!S.active) {
      // A weekday can hold several routines; start the combined session if any of them has
      // exercises, otherwise fall through to the picker.
      if (effectiveRoutines(S, todayISO()).some((r: { ex: unknown[] }) => r.ex.length)) { onStart(effectiveRoutineIds(S, todayISO())); return }
    }
    nav('/workout')
  }

  return (
    <nav id="tabbar">
      <Tab active={on('home')} glyph={<Icon name="house" />} label={t('Home')} onClick={() => nav('/home')} />
      <Tab active={on('plan')} glyph={<Icon name="calendar" />} label={t('Plan')} onClick={() => nav('/plan')} />
      {/* On the workout screen itself there is nothing to resume, so the button reads as the tab
          it is and stays lit; anywhere else it brings you back to the exercise you were on. */}
      <button className={'start' + (S.active ? ' rec' : '') + (S.active && cur === 'workout' ? ' on' : '')} onClick={startWorkout}>
        <span className="cir"><Icon name={S.active ? (cur === 'workout' ? 'dumbbell' : 'play') : 'dumbbell'} /></span>
        <span>{S.active ? (cur === 'workout' ? t('Workout') : S.active.editingWorkoutId ? t('Edit workout') : t('Resume')) : t('Start')}</span>
      </button>
      <Tab active={on('social')} label={t('Social')} count={waiting} onClick={() => nav('/social')}
        glyph={<Users className="icn" width="1em" height="1em" strokeWidth={on('social') ? 2 : 1.65} aria-hidden />} />
      <Tab active={on('stats')} glyph={<Icon name="chart" />} label={t('Stats')} onClick={() => nav('/stats')} />
    </nav>
  )
}
```

Substituir todo o conteúdo de `src/components/TabBar.jsx` por:

```jsx
// The tab bar moved to TypeScript (features/nav/TabBar.tsx, Phase 1b); this path stays so App.jsx
// and TabBar.test.jsx keep importing it.
export { default } from '../features/nav/TabBar.tsx'
```

`src/components/TabBar.test.jsx` continua verde sem mudança (cinco botões, classes `on`, `''`,
`start`, `start rec`, botões preservados entre renders).

Em `src/views/Plan.jsx`, no cabeçalho (`<div className="hdr">`), imediatamente antes da linha do
botão com `onClick={planToolsSheet}`, acrescentar:

```jsx
      <button className="iconbtn" onClick={() => nav('/library')} aria-label={t('Exercises')} title={t('Exercises')}><Icon name="list" /></button>
```

(`nav`, `t` e `Icon` já estão importados em `Plan.jsx`; conferir com `grep -n "const nav\|import Icon\|import { t" src/views/Plan.jsx` antes.)

- [ ] **Step 5: Rotas, convite sem sessão e convite pendente no `App`**

Em `src/App.jsx`, acrescentar os imports:

```jsx
import SocialScreen from './features/social/SocialScreen.tsx'
import ChallengeDetail from './features/social/ChallengeDetail.tsx'
import InviteScreen, { InviteRoute } from './features/social/InviteScreen.tsx'
import PendingInviteHost from './features/social/PendingInviteHost.tsx'
import { inviteCodeFromPath } from './features/social/pending-invite.ts'
```

Trocar

```jsx
  if (!authed) return <ErrorBoundary><SignIn /></ErrorBoundary>
```

por

```jsx
  // An invite link opened without a session shows who invited before asking to sign in.
  if (!authed) {
    const invite = inviteCodeFromPath(loc.pathname)
    return <ErrorBoundary>{invite ? <InviteScreen code={invite} signedIn={false} /> : <SignIn />}</ErrorBoundary>
  }
```

Logo depois da rota `/conquistas` (1a), acrescentar:

```jsx
                <Route path="/social" element={<Navigate to="/social/ranking" replace />} />
                <Route path="/social/desafios/:id" element={<ChallengeDetail />} />
                <Route path="/social/:section" element={<SocialScreen />} />
                <Route path="/convite/:code" element={<InviteRoute />} />
```

e, logo depois de `{user && profileReady && <CelebrationHost />}` (1a), acrescentar:

```jsx
      {user && profileReady && <PendingInviteHost />}
```

- [ ] **Step 6: Rodar e ver passar**

Run: `npx vitest run src/features/social src/features/nav src/components/TabBar.test.jsx`
Expected: PASS.

- [ ] **Step 7: Verificar e commitar**

```bash
node scripts/check-source-strings.mjs --strict
npm run typecheck && npm test && npm run build
git add src/features/social src/features/nav src/components/TabBar.jsx src/App.jsx src/views/Plan.jsx
git commit -m "feat(social): social area, invite link flow and the new tab bar

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

- [ ] **Step 2: Smoke manual com duas contas**

Com `.env.local` preenchido e as migrations `0004` e `0005` aplicadas (docs/SETUP.md §1 e §7),
`npm run dev`, viewport 375×812. Conta A num navegador normal, conta B numa janela anônima.

1. A: aba Social → Amigos vazio com "Treinar junto rende mais"; "Convidar amigo" abre o share sheet (no desktop, toast "Link do convite copiado"). O convite aparece em "Convites abertos" com "Expira em".
2. B (sem sessão) abre o link: vê a foto e o nome de A, "Seu peso, sua dieta e suas cargas continuam só seus.", toca "Continuar com Google", entra, faz o onboarding e cai em "Agora vocês são amigos" sem tocar em mais nada. A carta "Primeira amizade" aparece.
3. B abre o mesmo link de novo: "Vocês já são amigos." com "Ver ranking". Uma conta C usando o link já usado: "Alguém já usou este convite. Peça um link novo."
4. Ranking: os dois aparecem em "Semana" e "Geral"; a linha própria fica destacada com "Você"; abaixo, "Faltam N XP para passar …" ou "Você está na frente.".
5. A cria um desafio "Treinos no período", equipe, 7 dias, meta 2, convidando B. B vê o ponto na aba Social e em Desafios, abre, toca "Entrar no desafio". Cada um conclui um treino: o detalhe mostra "Total da equipe 2 treinos". Para fechar sem esperar 7 dias, no SQL Editor: `update challenges set starts_on = current_date - 7, ends_on = current_date - 1 where id = '<id>';` e reabrir Desafios: "Desafio cumprido! +300 XP" e a carta "Primeiro desafio".
6. Feed: com B em `share_activity = false`, A vê "Nada por aqui ainda"; B liga em Perfil, conclui um treino com recorde; A vê "Bia concluiu um treino · N séries" e o chip "Recorde: …". Com A sem compartilhar, a faixa "Seus treinos não aparecem para os amigos." leva ao Perfil.
7. DevTools → Network → Offline: Ranking, Amigos e Feed mostram o último conteúdo com "Sem conexão. Mostrando o que foi salvo por último."; nada bloqueia.
8. Repetir 1, 4 e 5 com `prefers-reduced-motion: reduce` e no tema claro; navegar só pelo teclado (Tab/Enter/Espaço) pelos segmentos da área social e pelo formulário de desafio.
9. Plano → botão Exercícios abre a biblioteca com a aba Plano acesa.
10. SQL Editor, como conferência de privacidade: `select public.get_friends();` não funciona sem sessão; nenhum JSON do app (aba Network) traz `weight_kg`, `vol` ou `w`.

- [ ] **Step 3: Spec e roadmap**

Na spec, §4.3, depois do bloco de `challenge_members`, acrescentar:

```markdown
Na 1b, `challenge_members.joined_at` ficou anulável (nulo = convidado, ainda sem resposta) e a
tabela ganhou `invited_by`, `share_volume`, `final` e `won`; `challenges` ganhou `closed_at`. O
período vale de 7 a 92 dias contando os dois extremos (`ends_on - starts_on between 6 and 91`).
```

Em §6, depois da tabela de modelos, acrescentar:

```markdown
O valor da carga de um PR não sai no feed nesta fase: o evento `pr` só carrega o exercício, e o
feed mostra "Recorde: <exercício>". Se um dia o valor entrar, será com um opt-in próprio no perfil.
O link de convite sobrevive ao login com Google guardado no aparelho (`perf_pending_invite_v1`,
24 h) e é aceito sozinho quando o perfil fica pronto.
```

No `docs/ROADMAP.md`, Fase 1b: trocar "Feed opt-in de treinos e PRs (ReUI Timeline)." por "Feed
opt-in de treinos e PRs (linha do tempo própria, no estilo da Timeline do ReUI)." e, na tabela de
fases, o status da 1b de `especificada` para `concluída`.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-10-04-performance-app-foundation-design.md docs/ROADMAP.md
git commit -m "docs: record phase 1b decisions and mark it done

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## O que a 1a não cobria e como este plano resolve

| Lacuna nas "Interfaces para a 1b" | Tratamento |
|---|---|
| `achievement_stats` não calcula `friends` nem `challenges_won`; a 1a só sugeria chamar `award_achievement` à mão | A 0004 substitui `achievement_stats` (mesmo corpo + as duas chaves). `evaluate_achievements` passa a liberar as conquistas sociais sozinho e `get_my_progress().stats` já traz as métricas, sem mexer em `get_my_progress`. O teste da 1a que compara `stats` ganha as chaves (Tasks 1 e 4). |
| A trava por usuário cobre uma pessoa; aceitar convite e fechar desafio mexem em várias | `lock_users(uuid[])` em ordem de uuid e a trava global de fechamento sempre antes das de usuário (Decisão 6). |
| `progress_card` não tem nome nem foto | `get_friends` junta `profiles.display_name`/`avatar_url` ao cartão. |
| `week_xp` da semana anterior e "XP total antes desta semana" não existem prontos | `leaderboard_json` calcula com `week_xp(u, semana − 7)` e `total_xp − week_xp(semana corrente)`. |
| Não há relógio de "dia local do criador" para fechar desafios | `local_today(created_by)` da 1a, usado em `close_challenge`, `join_challenge` e `leave_challenge`. |
| A galeria da 1a mostra "Libera quando a área de amigos chegar ao app." para as conquistas sociais | Task 7 troca a condição por "métrica ausente → Bloqueada" e tira a chave dos 16 packs. |
| `CelebrationHost` só reage a `refresh()` | Toda ação social que pode render XP chama `useProgress.getState().refresh()` (Decisão 15). |
