# performance-app — Design: Fundação + Gamificação

- **Data:** 2026-10-04
- **Status:** aguardando revisão
- **Roadmap completo:** [docs/ROADMAP.md](../../ROADMAP.md)
- **Base:** [openGym](https://github.com/DuarteSantos8/openGym) (AGPL-3.0), importado como código-base sem histórico

## 1. Visão

App pessoal de performance, multiusuário, que começa como um tracker de treino (herdado do openGym)
e cresce para cobrir nutrição, sono, hábitos e foco, amarrados por uma camada de gamificação de
consistência com amigos. Web (PWA) hospedado na Vercel, dados no Supabase (plano gratuito).

Esta spec cobre:

- **Fase 0 — Fundação**: importação da base, limpeza, login Google, perfil, sync com Supabase,
  design system, deploy.
- **Fase 1 — Gamificação** (1a individual, 1b social): desenhada aqui por inteiro porque define o
  contrato de eventos que todas as fases seguintes emitem.

As Fases 2–6 estão no roadmap e recebem spec própria quando chegar a vez.

## 2. Decisões tomadas

| Tema | Decisão |
|---|---|
| Repositório | `performance-app`, público, novo (sem histórico/vínculo com o openGym), conta `Guilhermcm` |
| Estrutura | conteúdo de `frontend/` vai para a raiz do repo |
| Backend | Supabase free: Auth (Google), Postgres com RLS, RPCs. Sem servidor Node próprio |
| Usuários | multiusuário, cada um com sua conta Google |
| Dados do treino | estado inteiro do app como `jsonb` por usuário (espelha o `/api/data` original) |
| Dados novos | tabelas normalizadas (gamificação, social e pilares futuros) |
| Perfil | nível "básico de treino" + tela própria de edição |
| Gamificação | progressão de atleta, XP por **consistência**, ranking semanal + desafios em grupo |
| Amizade | link de convite, amizade mútua, sem busca pública |
| UI | shadcn/ui + Motion Primitives, peças pontuais de ReUI e Dice UI; migração progressiva das telas herdadas |
| Linguagem | TypeScript para código novo (`allowJs`), legado continua JS |
| Idiomas | pt-BR (padrão) e en |
| Deploy | Vercel (estático), repo linkado pelo usuário |

## 3. Fase 0 — Fundação

### 3.1 Importação e limpeza da base

Copiar o openGym (último `main`) sem `.git`. Mover `frontend/*` para a raiz.

**Remover:**

- `api/`, `mcp/`, `web/`, `website/`, `kubernetes/`, `scripts/` (raiz), `docker-compose.yml`,
  `.dockerignore`, `.env.example` original
- `frontend/android/`, `frontend/ios/`, `capacitor.config.json`, dependências `@capacitor*`,
  `@aparajita/*`, `@capacitor-mlkit/*`, `lib/mobile.js` (o flag `MOBILE` vira constante `false` e
  os ramos mortos são removidos)
- `.gitlab/`, `.gitlab-ci.yml`, `.gitea/`, `.github/` original, `renovate.json`
- Views e componentes que dependem do backend próprio: `Admin*`, `AdminCoach*`, `Coach*`,
  `CheckIn` (se só servir ao coach), `Passkeys`, `ServerSync`, fluxos de senha, device-link, QR
  (`jsqr`, `lean-qr`), push (rest-timer remoto, lembretes), upload de mídia própria para o servidor
  (mídia própria passa a ficar só no IndexedDB do dispositivo, como já acontece para guests)
- Modo demo (`lib/demo.js`, `VITE_DEMO`)
- Locales exceto `pt-BR.js` e `en` (en é o embutido); idem para `instr/` e `exercise-names/`
- Testes das peças removidas

**Manter:** `LICENSE`, `NOTICE.md` (créditos de mídia de exercícios), toda a lógica em `lib/`
(progressão, 1RM, recovery, workout-model, exercícios), store, views de treino.

`README.md` novo: descreve o performance-app, declara a derivação do openGym com link e mantém a
AGPL-3.0. Como o app é usado pela rede, o rodapé de Settings/Sobre linka o repositório público
(AGPL §13).

**Mídia de exercícios:** sem container de download. Build usa `VITE_IMG_BASE`/`VITE_GIF_BASE`
apontando para o jsDelivr (mesmo commit fixado no `build:mobile` original). Imagens e GIFs são
© Gym visual, usados sob os termos do dataset; `NOTICE.md` explica.

### 3.2 Estrutura de pastas resultante

```
/
├─ src/
│  ├─ views/            legado (JSX) + novas (TSX)
│  ├─ components/       legado
│  ├─ components/ui/    shadcn e derivados (TSX)
│  ├─ features/         código novo por domínio (TSX/TS)
│  │  ├─ auth/          login Google, guarda de rota
│  │  ├─ profile/       onboarding, tela de perfil
│  │  ├─ sync/          cliente de sync com Supabase
│  │  ├─ gamification/  XP, níveis, streaks, conquistas
│  │  └─ social/        amigos, convites, ranking, desafios, feed
│  ├─ lib/              legado (lógica pura + testes) + supabase.ts, database.types.ts
│  ├─ store/            Zustand (legado)
│  ├─ styles/           tokens.css, legacy-bridge.css, tailwind.css
│  └─ locales/          pt-BR.js (+ en embutido)
├─ supabase/
│  ├─ migrations/       SQL versionado
│  └─ tests/            pgTAP
├─ docs/
├─ vercel.json
├─ components.json      config shadcn
└─ tsconfig.json        allowJs, strict para TS
```

### 3.3 Autenticação

- `@supabase/supabase-js` em `src/lib/supabase.ts`, com `VITE_SUPABASE_URL` e
  `VITE_SUPABASE_ANON_KEY`.
- Provider Google via `signInWithOAuth({ provider: 'google', options: { redirectTo } })`.
- `features/auth/AuthGate.tsx` envolve o roteamento:
  1. sem sessão → tela **Entrar** (marca, proposta em uma frase, botão "Continuar com Google");
  2. sessão sem linha em `profiles` → **Onboarding**;
  3. sessão com perfil → app.
- Rotas públicas: `/entrar`, `/convite/:code` (mostra quem convidou, depois pede login).
- `isGuest`/modo convidado do openGym é removido: todo uso exige conta.
- Logout limpa `localStorage` do estado (`gym_state_v1`) e a fila de eventos.

### 3.4 Onboarding e perfil

Onboarding em 3 passos, em Drawer/tela cheia mobile, com progresso visível e voltar sem perder dados:

1. **Você**: nome (pré-preenchido do Google), foto (do Google, trocável depois), data de
   nascimento, sexo, altura, peso atual, unidade (kg/lb).
2. **Objetivo**: objetivo (hipertrofia, força, emagrecimento, condicionamento), nível
   (iniciante, intermediário, avançado), dias por semana (1–7).
3. **Equipamento**: multi-seleção com chips (Dice UI Tags/Checkbox group) a partir da lista de
   equipamentos que o openGym já usa para filtrar exercícios.

Ao concluir:

- grava `profiles`;
- aplica ao store: unidade, idioma, equipamentos, início da semana (segunda);
- registra o peso no histórico do app (mesma ação da Home) e emite `weight_logged`;
- mostra **sugestão de plano inicial** (`features/profile/starter-suggest.ts`, função pura):

| dias/semana | iniciante | intermediário/avançado |
|---|---|---|
| 1–3 | Full Body | Full Body (força: 5×5) |
| 4 | Upper/Lower | Upper/Lower |
| 5–7 | Upper/Lower | Push/Pull/Legs |

  Objetivo `strength` com nível iniciante/intermediário e 3 dias → 5×5. O usuário aceita, troca ou
  pula; aceitar carrega o plano pelo mesmo caminho dos "starter plans" do openGym.

**Tela Perfil** (`/perfil`, acessível pelo avatar no topo da Home e por Settings): cabeçalho com
avatar, nome, nível geral e barras por pilar; seções editáveis com os mesmos campos do onboarding;
toggle "Compartilhar treinos e PRs com amigos" (`share_activity`); fuso horário; botão sair.
Edição salva por seção, com feedback otimista e rollback em erro.

### 3.5 Sync do estado do app

`features/sync/` substitui as chamadas `/api/data` de `lib/api.js`, preservando a interface que o
store espera (`pullState`, `pushState`), para que `useStore.js` mude o mínimo possível.

- **Pull** no login e ao voltar o foco/conexão: `select data, rev from app_state`. Se `rev` remoto >
  `rev` local conhecido, substitui o local (mesmo comportamento do original).
- **Push** com debounce (o mesmo do original) via RPC `push_state(p_data, p_base_rev)`:
  - `rev` igual → grava, incrementa, devolve `{ ok: true, rev }`;
  - `rev` divergente → devolve `{ ok: false, rev, data }` e o cliente aplica o merge/reconciliação
    que o openGym já faz para conflitos.
- Primeiro login sem linha → `push_state` com `p_base_rev = 0` cria a linha.
- Offline: tudo segue em `localStorage`; ao reconectar, pull + push.
- Tamanho: o estado é limitado a 2 MB na RPC (erro claro se exceder); acima do que o openGym
  costuma gerar por anos de uso.

### 3.6 Fila de eventos (contrato com a gamificação)

`features/gamification/events.ts`:

- `emit(kind, payload, sourceRef, occurredOn)` grava numa fila em `localStorage`
  (`perf_event_queue_v1`) e tenta enviar imediatamente (`insert` em `activity_events`).
- Reenvio em lote no próximo sync; conflito de unicidade (`source_ref` repetido) conta como sucesso.
- Ganchos na Fase 0/1: conclusão de treino (`finish-workout.js` → `workout_completed`, um evento
  por sessão, `source_ref` = id da sessão; PRs detectados → `pr`, `source_ref` = sessão+exercício),
  registro de peso (`weight_logged`, `source_ref` = data).

### 3.7 Deploy

- `vercel.json`: framework Vite, `outputDirectory: dist`, rewrite `/(.*)` → `/index.html`.
- Service worker/PWA do openGym mantido; `start_url`, nome e ícones novos no manifest.
- Variáveis na Vercel: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_IMG_BASE`,
  `VITE_GIF_BASE`.
- CI GitHub Actions: `npm ci && npm test && npm run build` em PR e push no `main`.

### 3.8 Passos manuais do usuário (com guia passo a passo no README)

1. Criar projeto no Supabase (região São Paulo) e rodar as migrations (SQL Editor ou
   `supabase db push`).
2. Criar OAuth Client no Google Cloud (tipo Web), autorizar o callback do Supabase, colar Client
   ID/Secret em Supabase → Auth → Providers → Google.
3. Em Supabase → Auth → URL Configuration: `Site URL` = domínio Vercel; redirect URLs com o
   domínio Vercel e `http://localhost:5173`.
4. Importar o repo na Vercel e preencher as variáveis.

## 4. Banco de dados

Todas as tabelas com RLS ligada. Datas de "dia" e "semana" sempre no fuso do perfil.

### 4.1 Núcleo

```sql
create table public.profiles (
  id             uuid primary key references auth.users on delete cascade,
  display_name   text not null check (char_length(display_name) between 1 and 60),
  avatar_url     text,
  birth_date     date,
  sex            text check (sex in ('male','female','other')),
  height_cm      numeric(5,1) check (height_cm between 50 and 260),
  weight_kg      numeric(5,1) check (weight_kg between 20 and 400),
  goal           text check (goal in ('hypertrophy','strength','fat_loss','conditioning')),
  level          text check (level in ('beginner','intermediate','advanced')),
  days_per_week  smallint not null default 3 check (days_per_week between 1 and 7),
  equipment      text[] not null default '{}',
  unit           text not null default 'kg' check (unit in ('kg','lb')),
  locale         text not null default 'pt-BR' check (locale in ('pt-BR','en')),
  timezone       text not null default 'America/Sao_Paulo',
  share_activity boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table public.app_state (
  user_id    uuid primary key references auth.users on delete cascade,
  data       jsonb not null,
  rev        integer not null default 1,
  updated_at timestamptz not null default now()
);
```

- `profiles`: select/insert/update só do próprio (`id = auth.uid()`).
- `app_state`: select do próprio; escrita **só** via `push_state` (security definer).

### 4.2 Gamificação

```sql
create type pillar as enum ('strength','nutrition','sleep','habits');

create table public.activity_events (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users on delete cascade default auth.uid(),
  pillar      pillar not null,
  kind        text not null,
  occurred_on date not null,
  payload     jsonb not null default '{}',
  source_ref  text not null,
  created_at  timestamptz not null default now(),
  unique (user_id, kind, source_ref)
);

create table public.xp_ledger (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users on delete cascade,
  pillar      pillar,               -- null = bônus geral (desafio, conquista)
  amount      integer not null,
  reason      text not null,
  event_id    bigint references activity_events on delete cascade,
  week_start  date not null,        -- segunda-feira local
  created_at  timestamptz not null default now()
);

create table public.user_achievements (
  user_id     uuid not null references auth.users on delete cascade,
  code        text not null,
  unlocked_at timestamptz not null default now(),
  primary key (user_id, code)
);

create table public.streaks (
  user_id     uuid not null references auth.users on delete cascade,
  kind        text not null,        -- 'training_week' na Fase 1
  current     integer not null default 0,
  best        integer not null default 0,
  shields     smallint not null default 0 check (shields between 0 and 2),
  last_period date,                 -- última semana avaliada
  primary key (user_id, kind)
);
```

- `activity_events`: insert/select do próprio. Validação no trigger `before insert`: `kind`
  pertence ao catálogo do pilar, `occurred_on` entre hoje−14 dias e hoje (fuso do perfil),
  `payload` ≤ 4 KB.
- `xp_ledger`, `user_achievements`, `streaks`: só select do próprio; escrita apenas por funções
  security definer.

### 4.3 Social

```sql
create table public.friend_invites (
  code        text primary key,     -- 10 chars base62, aleatório
  inviter_id  uuid not null references auth.users on delete cascade default auth.uid(),
  expires_at  timestamptz not null default now() + interval '7 days',
  used_by     uuid references auth.users,
  used_at     timestamptz
);

create table public.friendships (
  user_a     uuid not null references auth.users on delete cascade,
  user_b     uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_a, user_b),
  check (user_a < user_b)
);

create table public.challenges (
  id         uuid primary key default gen_random_uuid(),
  template   text not null,         -- 'workouts_count' | 'weeks_on_target' | 'volume_total'
  title      text not null,
  mode       text not null check (mode in ('team','solo')),
  target     numeric not null check (target > 0),
  starts_on  date not null,
  ends_on    date not null check (ends_on > starts_on and ends_on - starts_on <= 92),
  created_by uuid not null references auth.users on delete cascade default auth.uid(),
  status     text not null default 'active' check (status in ('active','won','lost','cancelled')),
  created_at timestamptz not null default now()
);

create table public.challenge_members (
  challenge_id uuid not null references challenges on delete cascade,
  user_id      uuid not null references auth.users on delete cascade,
  joined_at    timestamptz not null default now(),
  primary key (challenge_id, user_id)
);
```

- Convite: cada usuário tem no máximo 5 convites ativos. `accept_invite(code)` valida
  expiração/uso/auto-convite, cria `friendships` com par ordenado e marca uso.
- `friendships`: select onde o usuário é `user_a` ou `user_b`; delete idem (desfazer amizade);
  insert só via `accept_invite`.
- `challenges`: select para membros; criação só pelo criador, que convida amigos (só amigos podem
  ser adicionados); entrada/saída via RPC.

### 4.4 RPCs (todas `security definer`, `search_path` fixo, checam `auth.uid()`)

| Função | Retorno |
|---|---|
| `push_state(p_data jsonb, p_base_rev int)` | `{ok, rev, data?}` |
| `get_my_progress()` | níveis geral e por pilar, XP total/semana, streaks, conquistas; fecha semanas pendentes antes de responder |
| `create_invite()` | `{code, expires_at}` |
| `get_invite(code)` | nome/foto de quem convidou (público, sem login) |
| `accept_invite(code)` | amizade criada ou erro tipado |
| `get_friends()` | cartões de amigos: id, nome, foto, níveis, XP da semana, streak, conquistas — nunca peso, dieta, sono detalhado ou cargas |
| `get_weekly_leaderboard()` | eu + amigos ordenados por XP da semana corrente |
| `get_alltime_leaderboard()` | eu + amigos por nível geral/XP total |
| `create_challenge(...)`, `join_challenge(id)`, `leave_challenge(id)` | desafio |
| `get_challenges()` | desafios ativos/encerrados com progresso por membro e total |
| `get_feed(before timestamptz)` | eventos `workout_completed`/`pr` de amigos com `share_activity = true`, paginado (20) |

Fechamento de semana e de desafios: avaliação **preguiçosa** (em `get_my_progress`,
`get_challenges`, leaderboard) + job `pg_cron` diário 06:00 UTC como rede de segurança.

## 5. Gamificação

### 5.1 Princípios

- **Consistência acima de força bruta**: cumprir o próprio plano vale o mesmo para todos.
- **Recompensa sem punição**: não há perda de XP nem de nível.
- **Servidor é a autoridade**: o cliente só emite eventos; XP é calculado no Postgres. O cliente
  mostra uma prévia otimista (`lib/xp.ts`, espelho das regras) que é substituída pela resposta do
  servidor.

### 5.2 Regras de XP — pilar Força (Fases 0/1)

Seja `T = profiles.days_per_week`.

| Evento | XP | Limite |
|---|---|---|
| `workout_completed`, até a T-ésima sessão da semana | `round(600 / T)` | T por semana |
| `workout_completed` além de T | 25 | 2 por semana |
| Meta semanal batida (T-ésima sessão) | +150 bônus | 1 por semana |
| `pr` | 30 | 3 por semana |
| `weight_logged` | 10 | 1 por dia |

Máximo semanal do pilar = 600 + 150 + 50 + 90 + 70 = **960 XP para qualquer T**. Esse é o
mecanismo de justiça do ranking. Mudar `days_per_week` vale a partir da semana seguinte (o valor é
congelado no início da semana em `streaks`/ledger).

Pilares futuros seguem o mesmo molde: **600 de consistência + 150 de meta semanal + até ~210 de
extras**, para que cada pilar ativo pese igual no ranking.

### 5.3 Níveis

- XP do nível n para n+1: `100 + 50·(n−1)`. Nível 1→2 = 100 XP, 10→11 = 550 XP.
- Nível por pilar (XP do pilar) e nível geral (todo o XP, incluindo bônus).
- Com um pilar e 100% de consistência (~960 XP/semana): nível 10 em ~3 semanas, nível 20 em
  ~11 semanas, nível 30 em ~24 semanas. A curva achata o suficiente para durar anos.

### 5.4 Streaks

- `training_week`: semanas seguidas com a meta semanal batida.
- **Escudo**: +1 a cada 4 semanas de streak (máx. 2). Semana falhada com escudo → consome 1 e o
  streak continua; sem escudo → `current = 0`.
- A semana em curso nunca quebra o streak; só semanas fechadas são avaliadas.

### 5.5 Conquistas (catálogo v1, em código: `features/gamification/achievements.ts` + espelho SQL)

| Código | Condição | XP |
|---|---|---|
| `first_workout` | 1º treino | 50 |
| `workouts_10/50/100/250/500` | total de treinos | 100/200/300/500/800 |
| `first_pr` | 1º PR | 50 |
| `prs_10/50` | total de PRs | 150/400 |
| `week_target_1` | 1ª meta semanal batida | 75 |
| `streak_4/12/26/52` | streak semanal | 150/400/800/1500 |
| `weigh_in_7` | peso registrado 7 dias seguidos | 100 |
| `level_10/25/50` | nível geral | 0 (só badge) |
| `first_friend` | 1ª amizade | 50 |
| `challenge_first/won_5` | desafios concluídos com sucesso | 200/500 |
| `early_bird` | 5 treinos concluídos antes das 7h | 100 |

O XP das conquistas entra como bônus geral (`pillar = null`) e conta no ranking semanal.

### 5.6 Missões semanais

Fora do escopo da Fase 1 (Fase 5). O modelo de eventos já as suporta.

## 6. Social

- **Convite**: o perfil tem "Convidar amigo", que gera um link `/convite/<code>` e abre o share
  sheet nativo (Web Share API; fallback: copiar). Quem abre vê o convidante, entra com Google,
  passa pelo onboarding se for novo e cai na confirmação "Agora vocês são amigos".
- **Visibilidade para amigos**: nome, foto, níveis geral e por pilar, XP semanal, streak,
  conquistas, progresso em desafios compartilhados. Feed de treinos e PRs só com `share_activity`
  ligado. Nunca: peso, medidas, dieta, sono detalhado, cargas (exceto o valor do PR no feed, que é
  opt-in).
- **Ranking**: aba "Semana" (padrão, zera segunda 00:00 no fuso do usuário) e aba "Geral" (nível).
  Mostra posição, variação vs. semana passada e distância para o próximo colocado.
- **Desafios** (modelos com parâmetros, sem editor livre):

| Modelo | Métrica | Modos |
|---|---|---|
| `workouts_count` | treinos concluídos no período | team (soma) / solo (cada um atinge N) |
| `weeks_on_target` | semanas com meta batida | solo |
| `volume_total` | toneladas levantadas (opt-in explícito ao entrar) | team / solo |

  Duração de 7 a 92 dias, 2 a 20 membros. Sucesso no `ends_on` → +300 XP por membro (team) ou
  para quem atingiu (solo), mais as conquistas. Modelos de sono, nutrição e hábitos entram com os
  respectivos pilares.

## 7. UI/UX

### 7.1 Stack

| Peça | Uso |
|---|---|
| **Tailwind CSS v4** | sem preflight (`@import "tailwindcss/theme"` + `utilities`), para não quebrar o CSS legado |
| **shadcn/ui** (TSX) | fundação: Button, Drawer (bottom sheet), Dialog, Form, Tabs, Avatar, Progress, Toast (Sonner), Chart |
| **Motion Primitives** + `motion` | transições de tela, contadores animados (XP), morph de cartões, efeitos de texto em celebrações |
| **ReUI** (seletivo) | Timeline (feed, histórico), Calendar, Filters; Data Grid quando houver tabelas (Fase 2) |
| **Dice UI** (seletivo) | Tags Input/Checkbox group (equipamentos), Combobox (busca), Sortable |
| Motiq | só referência de padrões; nada importado |
| React Bits | **não importar**: licença MIT + Commons Clause incompatível com redistribuição AGPL. Efeitos inspirados nele são recriados com `motion` |

### 7.2 Direção visual

- **Dark-first** (o público treina em academia, à noite, com o celular na mão), tema claro completo.
- Base grafite neutra; acento primário **volt** (verde-limão elétrico, herdado da identidade do
  openGym) para ações e XP.
- Uma cor por pilar, usada em barras, chips e gráficos: Força (laranja), Nutrição (verde), Sono
  (índigo), Hábitos (âmbar). Validadas para contraste AA nos dois temas.
- Tipografia: Geist Sans para texto, **Geist Mono com números tabulares** para cargas, XP,
  timers e rankings.
- Raio 14–20px em cartões, sombras sutis em camadas, superfícies elevadas por luminância (dark).
- Ícones: Lucide (padrão shadcn).
- Antes de implementar as telas novas, a direção é validada em mockup (Home com gamificação,
  onboarding, perfil, ranking) e ajustada com o usuário.

### 7.3 Tokens e ponte com o legado

- `styles/tokens.css` define os tokens semânticos (`--background`, `--foreground`, `--primary`,
  `--card`, `--muted`, `--pillar-*`, `--radius`, durações e curvas de motion) nos dois temas.
- `styles/legacy-bridge.css` reescreve as variáveis do openGym (`--bg`, `--bg-el`, `--label`,
  `--acc`, `--on-acc`…) a partir desses tokens. O app herdado ganha a nova identidade sem mexer nos
  componentes.
- O seletor de acento do openGym (`data-accent`) é removido; o tema (claro/escuro/sistema) continua.

### 7.4 Padrões de UX obrigatórios

- **Mobile-first**: alvos ≥ 44px, ações primárias ao alcance do polegar, bottom sheets no lugar de
  modais, safe areas (`env(safe-area-inset-*)`).
- **Motion com propósito**: 150–300ms, curvas de saída; `prefers-reduced-motion` desliga
  deslocamentos e mantém só fades. Nada anima em loop sem motivo.
- **Feedback de gamificação**: ao concluir treino, tela de resumo com XP contando, barra de nível
  enchendo e, se houver, level-up/conquista em sequência (cada um dispensável com toque). Ganhos
  menores (peso) viram toast discreto.
- **Estados desenhados**: vazio (com próxima ação clara), carregando (skeletons com a forma do
  conteúdo), erro (mensagem humana + tentar de novo), offline (faixa discreta, nada bloqueia).
- **Otimismo**: escrita local imediata, sincronização em segundo plano, rollback visível em falha.
- **Acessibilidade**: componentes Radix/Base UI, foco visível, rótulos ARIA em ícones, contraste
  AA, sem informação só por cor (pilar sempre com ícone + nome).
- **Densidade**: a tela de treino continua silenciosa (princípio do openGym); gamificação aparece
  antes e depois do treino, nunca durante as séries.

### 7.5 Migração das telas herdadas

Telas novas nascem em shadcn. Herdadas migram uma por fase:

| Fase | Tela |
|---|---|
| 0 | Entrar, Onboarding, Perfil (novas); tokens aplicados ao legado |
| 1a | **Home** (vitrine: nível, streak, XP da semana, treino do dia), resumo pós-treino |
| 1b | Amigos, Ranking, Desafios, Feed (novas); TabBar |
| 2+ | Stats, History, Plan, Settings, RoutineEdit, Library; **Workout por último** (mais crítica) |

## 8. Internacionalização

- `lib/i18n.js` do openGym continua: chave = string em inglês, `pt-BR.js` traduz.
- Código novo usa o mesmo `t()`. Strings novas entram nos dois idiomas no mesmo commit; o teste de
  locale do openGym (chaves faltando) é mantido e passa a cobrir `features/`.
- Idioma inicial vem do perfil; fallback `navigator.language` → pt-BR.

## 9. Erros e offline

- Falha de rede no sync ou na fila de eventos: retry com backoff exponencial (1s → 60s), sem
  bloquear a UI.
- Sessão expirada: `supabase-js` renova; se falhar, volta para Entrar mantendo o estado local, que
  sobe no próximo login da mesma conta. Login de **outra** conta no mesmo navegador descarta o
  estado local da anterior após confirmação.
- Erros das RPCs são tipados (`invite_expired`, `invite_used`, `self_invite`, `already_friends`,
  `state_too_large`, `rev_conflict`) e mapeados para mensagens em `t()`.

## 10. Testes

- **Vitest** (existentes): toda a suíte de `lib/` herdada continua passando; testes de peças
  removidas saem junto.
- **Vitest** (novos): `starter-suggest`, aplicação do perfil ao store, cliente de sync (Supabase
  mockado: pull, push, conflito, offline), fila de eventos (idempotência, retry), `lib/xp.ts`
  (mesmos casos que o SQL), componentes de onboarding e perfil (validação, navegação entre passos).
- **pgTAP** (`supabase/tests`, rodando no Postgres local do `supabase` CLI): regras de XP por T,
  limites semanais/diários, bônus de meta, streak com e sem escudo, fechamento de semana no fuso,
  conquistas, convites (expirado, usado, auto-convite), RLS (usuário A não lê peso nem estado de B,
  não insere em `xp_ledger`, não vê feed de quem não compartilha), desafios (team/solo, sucesso e
  falha).
- **Casos de paridade**: um arquivo JSON de cenários de XP consumido pelos testes vitest e pgTAP,
  garantindo que prévia e servidor concordam.
- **Smoke manual pós-deploy**: login Google, onboarding, treino concluído → XP, convite entre duas
  contas, ranking.

## 11. Licenças

- O projeto inteiro é AGPL-3.0-or-later (herdado). `LICENSE` e `NOTICE.md` mantidos; README
  declara a origem openGym.
- shadcn/ui, ReUI, Dice UI, Motion Primitives, Motiq, Tailwind, Supabase JS: MIT (compatíveis).
- React Bits: não importado (Commons Clause).
- Repositórios de domínio do roadmap (wger AGPL, OpenNutriTracker/Track & Graph/Somn GPL-3.0,
  Plees MIT, ActivityWatch MPL-2.0, Habitica GPL-3.0): usados como referência de modelo e
  fórmulas; código portado, quando houver, mantém atribuição.
- Mídia de exercícios: © Gym visual, servida do jsDelivr sob os termos do dataset (`NOTICE.md`).

## 12. Fora de escopo (Fases 0/1)

Passkeys, login por senha, vínculo de dispositivo/QR, push notifications, painel de admin e
convites de instância, AI Coach, upload de mídia própria para o servidor, apps nativos (Capacitor),
missões semanais, pilares nutrição/sono/hábitos/foco, painel de performance integrado.

## 13. Riscos

| Risco | Mitigação |
|---|---|
| Tailwind sem preflight ainda conflitar com classes do legado | prefixo nas utilities se necessário (`tw:`); auditoria visual tela a tela na Fase 0 |
| Estado JSONB crescer e o sync ficar lento | limite de 2 MB + medição; normalizar histórico de treino é candidato da Fase 5 |
| Supabase free pausa projeto após 7 dias sem uso | uso diário evita; documentar como reativar; `pg_cron` não impede pausa |
| Trapaça (eventos falsos) | janela de 14 dias, limites semanais, idempotência; ranking só entre amigos reduz o incentivo |
| Divergência entre prévia de XP e servidor | cenários de paridade compartilhados nos dois testes |
| Remoção de peças do openGym quebrar imports ocultos | remover em passos, com build + suíte completa após cada um |
