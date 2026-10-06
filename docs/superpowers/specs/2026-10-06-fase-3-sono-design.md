# performance-app: Design da Fase 3, Sono

- **Data:** 2026-10-06
- **Status:** aguardando revisão
- **Roadmap:** [docs/ROADMAP.md](../../ROADMAP.md), Fase 3
- **Base:** [spec da Fase 2](2026-10-05-fase-2-nutricao-design.md) (molde do pilar: períodos, fechamento
  em D+2, XP, streak, conquistas privadas, radar), [spec da 2b](2026-10-06-fase-2b-nutricao-design.md)
  (calendário e desafio de pilar) e [spec da Fundação](2026-10-04-performance-app-foundation-design.md)
- **Ordem:** executada logo depois da 2b, no mesmo branch, antes da publicação em produção.

## 1. Entendimento e objetivo

**O que foi dito.** O grupo hoje não registra o sono e quer começar. O que importa medir é
**duração e regularidade**. O registro é feito **só de manhã**, sem botão "dormir/acordei". A spec
deve ser detalhada e entrar logo depois da 2b; no fim da Fase 3 tudo vai para produção.

**O que se supõe.** O grupo é o mesmo da Nutrição. O app é um PWA, sem Apple Health nem Google Fit,
então todo registro é feito pela pessoa. A importação de CSV (Plees) sai, como saiu na Nutrição.

**Critério de sucesso.** Registrar a noite em um toque ao abrir o app de manhã; ver em segundos se
a semana está regular e se falta sono; ganhar XP e streak por consistência; desafiar os amigos em
noites no alvo sem mostrar horários a ninguém.

## 2. Decisões tomadas

| Tema | Decisão |
|---|---|
| Quem registra | a própria pessoa, de manhã, na Home ou em `/sono` |
| De quem é a noite | da data em que a pessoa acordou |
| Noite no alvo | duração ≥ meta − 15 min **e** horário de deitar a até 45 min do alvo (circular) |
| Meta | horas de 6 a 10 (passos de 15 min, padrão 8), horário-alvo de deitar (padrão 23:00), T de 3 a 7 (padrão 5) |
| Janela de edição | hoje e ontem; a noite D fecha no começo de D+2, no fuso do perfil |
| Gamificação | molde da Nutrição: 960 XP por semana, streak `sleep_week`, conquistas privadas |
| Navegação | sem aba nova: cartão da Home, tela `/sono`, Perfil > Sono, eixo do radar |
| Estatísticas | calculadas no cliente, sem XP |
| Social | amigos veem nível e XP do pilar; desafio `sleep_nights_on_target` com opt-in |
| Fora | botão "dormir/acordei", importação CSV, sonecas, sensores, apps de saúde, lembretes push |

## 3. Ativação, meta e períodos

### 3.1 Ativação

- Opt-in em **Perfil > Sono**, no mesmo formato da ativação da Nutrição. Um passo só, com três
  campos e um botão "Ligar o Sono":
  - **Meta de horas:** stepper de 6h a 10h em passos de 15 min, padrão 8h.
  - **Horário-alvo para deitar:** seletor de hora em passos de 15 min, padrão 23:00.
  - **Noites no alvo por semana (T):** 3 a 7, padrão 5.
- Ligar grava `profiles.sleep_enabled = true`, `sleep_nights_per_week` e a primeira meta em
  `sleep_targets` com `valid_from = hoje`. Como na Nutrição (pendência 2 da 2b), o botão final só
  decide "vale hoje" depois que o store das metas estiver pronto.
- Desligar fica no mesmo lugar, com confirmação. Os dados ficam guardados.

### 3.2 Vigência da meta

- A primeira meta vale **hoje**; qualquer mudança depois vale **a partir de amanhã**.
- A noite D é avaliada contra a meta em vigor em D (`valid_from ≤ D`, a mais recente).
- Uma noite em período sem meta em vigor (a gravação da primeira meta falhou) não é avaliada.
- Mudar T segue o congelamento semanal de `weekly_targets` (pilar `sleep`): vale na semana
  seguinte.

### 3.3 Períodos ativos e semana neutra

Iguais aos da Nutrição (§3.4 da spec da Fase 2), com `sleep_periods`:

- Ligar abre um período (`started_on = hoje`); desligar fecha (`ended_on = ontem`). Religar no mesmo
  dia reabre o mesmo período.
- Só noites dentro de um período são avaliadas. A noite de hoje (a que acabou de terminar) já conta
  no dia da ativação.
- Semana com alguma noite fora de período é **neutra**: meta batida soma ao streak e paga o bônus;
  meta não batida não quebra o streak nem gasta escudo.

## 4. A noite

### 4.1 Dados de uma noite

| Campo | Regra |
|---|---|
| `night` | data em que a pessoa acordou, no fuso do perfil |
| `bed_time` | hora local em que deitou para dormir (`time`, minutos inteiros) |
| `wake_time` | hora local em que acordou (`time`, minutos inteiros) |
| `duration_min` | calculada pelo servidor: `(wake_time − bed_time) mod 24h`, em minutos |
| `quality` | 1 a 5, opcional |
| `note` | até 140 caracteres, opcional |

- **Uma noite por data.** A chave é `(user_id, night)`; registrar de novo a mesma noite edita.
- **Duração:** de 60 a 960 minutos (1h a 16h). Fora disso, o registro é recusado
  (`invalid_duration`). Duração zero (mesmo horário nos dois campos) também é recusada.
- **Data em que deitou:** `night` se `bed_time < wake_time`, senão `night − 1`. Com a duração
  limitada a 16h, essa regra nunca é ambígua.
- **Futuro:** o cliente não deixa registrar a noite de hoje com `wake_time` depois da hora atual. O
  servidor não checa: os horários são declarados pela pessoa de qualquer forma.

### 4.2 Classificação

Com a meta M em vigor na noite (`goal_min`, `bed_target`):

- **`bed_diff_min`** = distância circular entre `bed_time` e `M.bed_target`, de 0 a 720:
  `d = |bed − alvo| em minutos`, `bed_diff = min(d, 1440 − d)`. Exemplo: 23:30 e 00:10 estão a
  40 minutos.

| Classe | Condição |
|---|---|
| `logged` | existe registro da noite |
| `on_target` | `logged`, `duration_min ≥ M.goal_min − 15` e `bed_diff_min ≤ 45` |
| `rested` | `on_target` e `quality ≥ 4` |

Limites exatos são inclusivos: com meta de 8h, 7h45 conta; com alvo 23:00, deitar 23:45 ou 22:15
conta.

`classify.ts` em `src/features/sleep/` espelha a regra para a prévia, com a mesma fixture de
paridade do servidor (§10).

### 4.3 Registro de manhã (cartão da Home)

- **Quando aparece:** com o pilar ligado, entre **04:00 e 13:59** no fuso do perfil, se a noite de
  hoje ainda não foi registrada. Fora dessa faixa, o cartão não pede registro; a noite pode ser
  registrada em `/sono`.
- **Título:** "Como foi a noite?".
- **Pré-preenchido:** os horários da última noite registrada (das últimas 14); sem nenhuma, deitar
  no horário-alvo e acordar no horário-alvo + meta.
- **Confirmar:** um toque grava. Cada horário abre um ajuste rápido (roda de hora em passos de
  5 min, com "−15" e "+15" ao lado).
- **Extras opcionais:** cinco botões de qualidade (1 a 5, com rótulo em texto, nunca só ícone) e
  "Adicionar nota".
- **Validação no cliente:** duração de 1h a 16h; mensagem curta abaixo dos horários quando falha
  ("A noite precisa ter entre 1 e 16 horas").
- **Depois de gravar:** o cartão vira o resumo da noite: "7h 40 · no alvo" (ou "registrada" /
  "fora do alvo: deitou 1h10 depois do alvo"), com a prévia "Confirma na <dia de `confirms_on`>" e
  "Editar". Tocar no cartão abre `/sono`.
- **Pilar desligado:** a Home não mostra cartão de Sono; o radar mostra o eixo desligado.

### 4.4 Edição e fechamento

- Criar, editar e apagar só as noites de **hoje e ontem** (fuso do perfil). Antes disso, só leitura.
- A noite D fecha no começo de **D+2**. Fechar uma noite avaliável:
  1. grava o resumo em `sleep_nights` com o retrato da meta em vigor;
  2. classifica a noite (§4.2);
  3. emite, como o dono das tabelas, os eventos do pilar com `source_ref = 'sleep:<AAAA-MM-DD>'`,
     que pagam XP pelo `award_xp`;
  4. avalia conquistas.
- Avaliação preguiçosa (em `get_my_progress` e `get_sleep_nights`) e cron diário
  `close-sleep-nights`. Noite fechada não reabre; XP pago não volta.
- Uma noite de período sem registro também fecha (`logged = false`), para o calendário e o streak.

## 5. Gamificação

### 5.1 XP

Seja `T = sleep_nights_per_week`, congelado na semana. Mesmo molde da Nutrição:

| Evento | XP | Limite |
|---|---|---|
| `night_on_target` até a T-ésima | `round(600 / T)`; a T-ésima paga o resto | T por semana |
| `night_on_target` além de T | 25 | 2 por semana |
| Meta semanal (T-ésima noite no alvo) | +150 | 1 por semana |
| `night_rested` | 30 | 3 por semana |
| `night_logged` | 10 | 1 por noite |

Máximo semanal 600 + 150 + 50 + 90 + 70 = **960**. A noite entra na semana de `night`.

### 5.2 Eventos e motivos

- `event_kinds` ganha `('sleep','night_logged',true)`, `('sleep','night_on_target',true)` e
  `('sleep','night_rested',true)`, todos `server_only`. O RLS já barra o cliente.
- `reason` próprios no `xp_ledger`, sem somar em nada de Força ou Nutrição:

| `reason` | Evento |
|---|---|
| `sleep_night` | noite no alvo, até a T-ésima |
| `sleep_night_extra` | noite no alvo além de T |
| `sleep_week_target` | meta semanal batida |
| `sleep_rested` | noite descansada |
| `sleep_logged` | noite registrada |

### 5.3 Streak

`sleep_week`: semanas seguidas com a meta semanal batida; escudos como `training_week` (+1 a cada 4
semanas, máximo 2); semanas neutras segundo §3.3. A semana só é avaliada depois que as sete noites
fecharam (terça de manhã). Função própria `close_sleep_weeks`, no molde de
`close_nutrition_weeks`.

### 5.4 Conquistas

Todas `private = true`, `sort` a partir de 400. O `check` de `achievement_catalog.metric` ganha
cinco métricas; `achievements.ts` e `gamification-catalog.test.ts` acompanham.

| Métrica | Definição |
|---|---|
| `sleep_logged_nights` | noites fechadas com `logged` |
| `sleep_on_target_nights` | noites fechadas com `on_target` |
| `sleep_week_targets` | semanas com `sleep_week_target` pago |
| `sleep_best_streak` | melhor `sleep_week` |
| `sleep_clock_best_run` | maior sequência de noites fechadas consecutivas, todas registradas, com `bed_diff_min ≤ 30` |

| Código | Métrica ≥ | XP |
|---|---|---|
| `sleep_first_night` | `sleep_logged_nights` 1 | 50 |
| `sleep_nights_10/50/100/250` | `sleep_on_target_nights` | 100/200/300/500 |
| `sleep_week_target_1` | `sleep_week_targets` 1 | 75 |
| `sleep_streak_4/12/26` | `sleep_best_streak` | 150/400/800 |
| `sleep_clock_7` ("Relógio em dia") | `sleep_clock_best_run` 7 | 100 |

Noite sem registro ou fora de período quebra a sequência do "Relógio em dia".

### 5.5 O que o cliente recebe

- **`progress_card(p_user)`** (público): `week.pillars` ganha `sleep`; `week.max` soma 960 se a
  semana tocou um período de Sono. Nível do pilar Sono como os outros. Nada de horário, duração ou
  qualidade.
- **`my_progress_extras(p_user)`** (só o próprio) ganha o bloco `sleep`, presente se o pilar já foi
  ligado alguma vez:
  - `target`: T da semana corrente;
  - `on_target` e `logged`: noites fechadas da semana corrente nessas classes;
  - `streak`: `sleep_week` (atual, melhor, escudos);
  - `confirms_on`: data em que a noite de hoje fecha (hoje + 2);
  - `last_closed`: `{night, logged, on_target, rested, xp}` da última noite fechada;
  - `last_week`: `{start, target_hit}` da última semana com as sete noites fechadas.
- **`radar`**: o eixo `sleep` passa a ter valor (§7.4).

### 5.6 Celebrações e avisos

- `week_target` passa a aceitar `pillar: 'sleep'`; `pillar_level` já cobre qualquer pilar.
- **Resultado da noite:** toast com o dia da semana de `sleep.last_closed.night`: "Sábado no alvo,
  +130 XP", "Sábado registrado, +10 XP". Marcador por conta `perf_sleep_seen_v1`; primeiro
  carregamento no aparelho só grava.
- **Prévia:** o resumo da Home mostra "No alvo, confirma na <dia>" (pela `classify.ts` local).
- Marcador antigo sem o pilar Sono é completado com o progresso atual sem celebrar nada.

## 6. Banco de dados

Migrations depois das da 2b (a última é `0016`), uma por tarefa de banco, em ordem:
`0017_sleep_base.sql` (perfil, períodos, metas, registros, eventos), `0018_sleep_close.sql`
(noites, fechamento, XP, streak, conquistas), `0019_sleep_progress.sql` (cartão, extras, radar,
histórico), `0020_sleep_challenge.sql` e `0021_sleep_cron.sql`. O plano pode juntar ou separar,
mantendo a ordem.

### 6.1 Perfil, períodos e metas

```sql
alter table public.profiles
  add column sleep_enabled boolean not null default false,
  add column sleep_nights_per_week smallint not null default 5
    check (sleep_nights_per_week between 3 and 7);

create table public.sleep_periods (
  user_id    uuid not null references auth.users on delete cascade,
  started_on date not null,
  ended_on   date check (ended_on is null or ended_on >= started_on - 1),
  primary key (user_id, started_on)
);

create table public.sleep_targets (
  user_id    uuid not null references auth.users on delete cascade default auth.uid(),
  valid_from date not null,
  goal_min   smallint not null check (goal_min between 360 and 600 and goal_min % 15 = 0),
  bed_target time not null check (extract(second from bed_target) = 0),
  created_at timestamptz not null default now(),
  primary key (user_id, valid_from)
);
```

- `sleep_periods` é mantida por trigger `after insert or update of sleep_enabled` em `profiles`,
  `security definer`, no molde de `profiles_nutrition_period`; o cliente só lê.
  `sleep_active_on(p_user, p_day)` no molde de `nutrition_active_on`.
- `freeze_week_target` passa a ser `before update of days_per_week, nutrition_days_per_week,
  sleep_nights_per_week` e congela o T do pilar cuja coluna mudou.
- `week_target_for(..., 'sleep')`: fallback `sleep_nights_per_week` e 5.
- `sleep_targets`: mesmas políticas de `nutrition_targets` (insert do próprio com
  `valid_from > my_local_today()`, exceto a primeira linha, que pode ser hoje; update só de linhas
  futuras; sem delete).

### 6.2 Registros

```sql
create table public.sleep_logs (
  user_id      uuid not null references auth.users on delete cascade default auth.uid(),
  night        date not null,
  bed_time     time not null check (extract(second from bed_time) = 0),
  wake_time    time not null check (extract(second from wake_time) = 0),
  duration_min smallint generated always as (
    ((extract(epoch from (wake_time - bed_time))::int / 60) + 1440) % 1440
  ) stored,
  quality      smallint check (quality between 1 and 5),
  note         text check (char_length(note) <= 140),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (user_id, night),
  check (duration_min between 60 and 960)
);
```

- CRUD do próprio. Trigger `before insert or update or delete`, `security invoker`, aplicado só
  quando `current_user` é `authenticated` ou `anon` (o mesmo critério de `food_logs`):
  - recusa `night` fora de `{my_local_today() − 1, my_local_today()}` (`night_closed`);
  - recusa mudar `user_id` ou `night` num update;
  - **última escrita vence**: `updated_at` vem do cliente, limitado a `now()`; um update com
    `updated_at` menor que o gravado é descartado em silêncio.
- O `check` de duração devolve o erro `23514`; o cliente o mapeia para `invalid_duration`.
- Sem tombstone: um upsert atrasado de outro aparelho pode recriar uma noite apagada. Aceito.

### 6.3 Noites fechadas

```sql
create table public.sleep_nights (
  user_id      uuid not null references auth.users on delete cascade,
  night        date not null,
  target       jsonb,              -- {goal_min, bed_target}; nulo sem meta em vigor
  logged       boolean not null,
  duration_min smallint,           -- retrato do registro, nulo sem registro
  bed_diff_min smallint,
  quality      smallint,
  on_target    boolean not null,
  rested       boolean not null,
  closed_at    timestamptz not null default now(),
  primary key (user_id, night)
);
```

Só select do próprio. O retrato evita depender de `sleep_logs` para métricas e histórico.

### 6.4 Funções

| Função | Papel |
|---|---|
| `classify_sleep_night(...)` | `immutable`: §4.2 a partir de registro e meta; usada no fechamento e nos testes |
| `close_sleep_nights(p_user)` | fecha as noites avaliáveis pendentes até `local_today − 2`, depois chama `close_sleep_weeks` |
| `close_sleep_weeks(p_user)` | streak `sleep_week` com escudos e semana neutra |
| `close_all_sleep_nights()` | chamada pelo cron para quem tem período aberto ou noite pendente |
| `award_xp` | ramo `pillar = 'sleep'` com §5.1 e os reasons de §5.2 |
| `achievement_stats` | métricas de §5.4 |
| `sleep_week_active(p_user, p_week)` | semana que toca algum período, para radar e `week.max` |
| `pillar_consistency` | ramo `sleep`, igual ao da Nutrição (semana fechada: `week_start + 6 ≤ local_today − 2`) |
| `progress_card`, `my_progress_extras`, `get_my_progress` | §5.5; `get_my_progress` congela o T de Sono e fecha noites pendentes |
| `get_sleep_nights(p_from, p_to)` | §6.5 |

Valem a regra de assinaturas e privilégios e a de volatilidade da spec da Fase 2 (§5.7):
assinatura nova com `drop` da antiga, internas com `revoke all`, RPC de cliente com `grant` só para
`authenticated`, `progress_card` continua `stable` e sem escrita.

### 6.5 Histórico

`get_sleep_nights(p_from date, p_to date) returns jsonb`, `volatile` (fecha pendentes antes), no
máximo 62 dias:

- `nights`: para cada noite fechada no intervalo, `night`, `logged`, `on_target`, `rested`,
  `duration_min`, `bed_diff_min`, `quality`, `target`, `xp` (soma do ledger do pilar com os eventos
  daquela noite) e, juntando `sleep_logs`, `bed_time`, `wake_time` e `note`;
- `weeks`: `{start, target_hit}` para cada semana tocada;
- `periods`: os períodos que tocam o intervalo, para o calendário pintar "fora do período".

Hoje e ontem vêm de `sleep_logs`, lidos direto pelo cliente.

### 6.6 Desafio

- `challenges.template` aceita `sleep_nights_on_target`; `create_challenge` valida: modos `team` e
  `solo`, período de 7 a 92 dias, 2 a 20 pessoas, metas como as da Nutrição (solo de 1 até a
  duração; equipe de 1 até duração × (1 + convidados)), opt-in e pilar ligado.
- `challenge_members.share_sleep boolean not null default false`.
- `join_challenge(p_id, p_share_volume, p_share_nutrition default false, p_share_sleep default
  false)`: assinatura nova, `drop` da antiga, `revoke`/`grant` refeitos; o cliente já chama com
  parâmetros nomeados (2b).
- Erros tipados: `sleep_opt_in_required`, `sleep_off`.
- `challenge_progress`: noites de `sleep_nights` com `on_target` no período, de cada participante
  que entrou; noites fora de período não existem e não contam.
- `challenge_grace('sleep_nights_on_target') = 2`: fecha em `ends_on + 2`, como o de nutrição, e
  fecha as noites pendentes de cada participante antes do resultado.
- O payload do desafio mostra só a contagem de noites no alvo de quem optou.

### 6.7 Cron

`0021_sleep_cron.sql`: job `close-sleep-nights` diário às 06:40 UTC chamando
`close_all_sleep_nights()`, no molde de `0013_nutrition_cron.sql`. O cron de desafios já existente
fecha os de sono pela `challenge_grace`.

## 7. Cliente

### 7.1 Estrutura

```
src/features/sleep/
  classify.ts      # §4.2, puro, com fixture de paridade
  time.ts          # minutos, diferença circular, data em que deitou, formatação "7h 40"
  stats.ts         # §7.3, puro
  sleep-api.ts     # sleep_logs, sleep_targets, get_sleep_nights, perfil
  outbox.ts        # fila perf_sleep_outbox_v1 (§7.5)
  useSleep.ts      # store Zustand por conta
  SleepSetup.tsx   # Perfil > Sono (ativação e meta)
  HomeSleepCard.tsx
  SleepLogSheet.tsx
  SleepScreen.tsx  # /sono
  SleepDurationChart.tsx  SleepBedtimeBand.tsx   # sob demanda
```

O calendário da 2b é reaproveitado. Se a 2b o deixar dentro de `features/nutrition`, o plano da
Fase 3 o move para `src/components/calendar/` com uma interface de estado por dia, sem mudar o
visual da Nutrição.

### 7.2 Tela `/sono`

Abre pelo cartão da Home, pelo eixo Sono do radar e por Perfil > Sono. Com o pilar desligado,
mostra o convite de ativação.

- **Topo:** a última noite registrada: duração, "deitou 23:20 · acordou 07:00", qualidade em texto,
  estado (no alvo, fora do alvo, a confirmar) e "Editar" (se for hoje ou ontem). Se a noite de hoje
  ainda não foi registrada, o topo é o mesmo formulário do cartão da Home.
- **Quatro números**, em Geist Mono tabular, cada um com rótulo e unidade:
  - **Duração média:** últimos 7 dias, com os últimos 30 abaixo;
  - **Regularidade:** "± 25 min · estável";
  - **Débito da semana:** "1h 20";
  - **Noites no alvo:** "4/5", com "+1 a confirmar" quando houver noite aberta com prévia no alvo.
- **Gráfico dos últimos 30 dias** (§7.4).
- **Faixa do horário de deitar** dos últimos 14 dias (§7.4).
- **Histórico em calendário:** o componente da 2b com os estados de cada noite (no alvo, registrada
  fora do alvo, sem registro, fora do período, aberta). Tocar numa noite abre um sheet com horários,
  duração, qualidade, nota, meta da noite e XP. Navegação mês a mês até o primeiro período.
- **Estados:** skeleton com a forma da tela; vazio com "Registre sua primeira noite"; offline mostra
  o que está em cache, sem bloquear o registro.

### 7.3 Estatísticas (`stats.ts`)

Todas a partir de noites registradas (fechadas ou abertas), no fuso do perfil:

| Número | Conta | Sem dados |
|---|---|---|
| Duração média 7 / 30 | média de `duration_min` das noites registradas em `[hoje − 6, hoje]` e `[hoje − 29, hoje]` | "–" com "Sem noites registradas" |
| Regularidade | desvio-padrão populacional do horário de deitar das noites registradas nos últimos 14 dias, medido como desvio assinado em relação ao horário-alvo (−720 a 720 min) para atravessar a meia-noite | menos de 3 noites: "Poucas noites para medir" |
| Rótulo | ≤ 30 min "estável"; ≤ 60 min "ok"; acima "irregular" | |
| Débito da semana | soma de `max(0, meta da noite − duration_min)` nas noites registradas da semana corrente (segunda até hoje); noites acima da meta não compensam; noites sem registro não entram | "0" |
| Noites no alvo | noites fechadas no alvo da semana corrente sobre T, mais a prévia das abertas | |

Estatísticas não dão XP nem vão ao servidor.

### 7.4 Gráficos

Feitos com o `chart.tsx` (shadcn/ui Charts, Recharts 3) do radar, carregados sob demanda, com
skeleton do mesmo tamanho e entrada no precache do service worker.

- **Duração, 30 dias:** uma barra por noite, de baixo para cima, com cantos de 4 px na ponta; linha
  da meta em degrau (a meta pode mudar no meio); barras no alvo na cor do pilar Sono com ícone de
  check no topo, as outras na cor neutra; noite sem registro fica vazia, com "Sem registro" no
  tooltip. Eixo de horas à esquerda, rótulos de data a cada 7 dias. Tooltip por barra com data,
  duração e estado.
- **Horário de deitar, 14 dias:** um ponto por noite (≥ 8 px) no eixo de horas em torno do
  horário-alvo, com a faixa de ±45 min sombreada e a linha do alvo. O eixo vertical é o desvio em
  relação ao alvo, limitado a ±3h; pontos fora ficam presos na borda com um marcador de seta.
- **Acessibilidade:** cada gráfico tem descrição em texto ("Média de 7h 25 nos últimos 30 dias, 18
  noites no alvo") e um botão "Ver como tabela". Texto sempre nas cores de texto do tema; a cor do
  pilar nunca carrega informação sozinha. `prefers-reduced-motion` sem animação.
- **Radar:** o eixo Sono sai de "em breve" e passa a ativo ou desligado, como a Nutrição; tocar no
  eixo ativo abre `/sono`, no desligado abre a ativação.
- **Barra de XP da semana:** ganha o segmento do Sono.
- **Cor do pilar:** `--pillar-sleep` já existe nos tokens; o plano roda o validador de paleta da
  skill `dataviz` com Força, Nutrição e Sono juntos, em claro e escuro, e ajusta o passo se falhar.

### 7.5 Offline e sync

- Fila própria `perf_sleep_outbox_v1` com o mesmo motor da fila do diário (upsert/delete por
  `night`, em ordem, backoff, recusa permanente separada de erro de rede, checagem de sessão). Se o
  motor estiver preso ao diário, o plano extrai a parte genérica.
- `night_closed` do servidor → descarta e mostra uma vez "Algumas noites de dias já fechados não
  foram salvas".
- A fila é por conta e **não é apagada ao sair**: o que não subiu vai no próximo login da mesma
  conta (decisão da 2a).
- Cópia local por conta: noites de hoje e ontem, metas, últimas 62 noites fechadas (meses vistos em
  cache). Pull no login, ao voltar o foco e ao reconectar.
- "Hoje" recalculado ao voltar o foco e a cada minuto (pendência 3 da 2b), para o cartão da manhã
  aparecer e sumir na hora certa.

## 8. Internacionalização e texto público

Regras do `CLAUDE.md`: strings novas nos 16 packs (pt-BR em `PT_BR_OVERRIDES`), sem travessão como
pausa, humanizer, `check-locales` e `check-source-strings --strict` passando. Contagens com
`Intl.PluralRules` (`tn()` da 2b). Horas formatadas pelo idioma (`Intl.DateTimeFormat`, 24h ou
12h conforme o locale); durações como "7h 40" via chave traduzível.

## 9. Privacidade

- Horários, duração, qualidade e notas são vistos só pela própria pessoa. Nada disso entra em
  `progress_card`, `get_friends`, ranking, feed ou payload de desafio.
- Amigos veem o nível do pilar e o XP. No desafio, os participantes veem só a contagem de noites no
  alvo, e só de quem deu o opt-in.
- `public/privacidade.html` ganha a seção do Sono (o que é guardado, que é opcional, quem vê);
  data de atualização e `privacy-page.test.js` acompanham.
- Exclusão de conta apaga tudo por cascata; a cascata roda como o dono e passa pela trava de
  noites fechadas.

## 10. Testes

- **PGlite** (`supabase/tests/sleep-*.test.ts`):
  - RLS: A não lê nada de Sono de B; cliente não insere `night_logged`/`night_on_target`/
    `night_rested` (nem com `set_config`); não escreve em `sleep_nights` nem `sleep_periods`;
  - janela hoje/ontem (`night_closed`), troca de `night` recusada, última escrita vence;
  - duração: virada da meia-noite (23:30 → 07:10 = 460 min), deitar depois da meia-noite
    (01:00 → 08:00 = 420), recusas em 59 e 961 minutos e em horários iguais;
  - classificação nos limites exatos: meta − 15 conta e meta − 16 não; 45 min conta e 46 não,
    dos dois lados do alvo e atravessando a meia-noite (alvo 23:30, deitar 00:15 conta);
  - vigência da meta (primeira hoje, seguintes amanhã), períodos (ligar, desligar, religar no mesmo
    dia), noite sem meta não avaliada;
  - fechamento: idempotência, noite sem registro fecha com `logged = false`, domingo fecha na
    terça;
  - XP por T de 3 a 7, limites de extra e descansada, bônus semanal, teto de 960, reasons próprios
    sem tocar Força e Nutrição;
  - `sleep_week` com escudo e semana neutra;
  - conquistas, inclusive `sleep_clock_7` quebrado por noite sem registro;
  - `progress_card` e `get_friends` sem dado de sono além de nível e XP; `week.max` e segmento;
  - radar do eixo Sono (janela, semanas ativas, nulo);
  - desafio: criação válida e inválida, opt-in, pilar desligado, progresso, fechamento em
    `ends_on + 2`, +300, payload só com a contagem;
  - exclusão de conta com noites antigas.
- **Paridade:** cenários JSON de classificação e de XP do pilar, lidos pelos testes do cliente e do
  servidor.
- **Vitest (cliente):** `time.ts` (virada, circular, formatação), `stats.ts` (média, desvio
  atravessando a meia-noite, débito sem compensação, poucos dados), `outbox.ts` (idempotência,
  `night_closed`, mantida no logout), cartão da Home (faixa 04:00 a 13:59, pré-preenchimento,
  confirmar em um toque, resumo e prévia), `SleepLogSheet` (validação), `/sono` (estados, números,
  gráficos com descrição e tabela), calendário com estados de noite, radar com o eixo Sono aceso,
  celebrações (toast com dia da semana, sem repetir), ativação em Perfil > Sono.
- **Smoke manual:** ligar o pilar, registrar a noite pela Home no celular, editar a de ontem, ver o
  XP dois dias depois, ver o radar depois da semana fechar, desafio entre duas contas.

## 11. Fora de escopo

Botão "dormir/acordei" e cronômetro, importação de CSV (Plees e genérico), sonecas e mais de um
sono por dia, sensores, Apple Health e Google Fit, lembretes por push, tendência com regressão,
comparação com amigos (Fase 5).

## 12. Riscos

| Risco | Mitigação |
|---|---|
| Pessoa esquecer de registrar e perder a noite | cartão da manhã pré-preenchido, janela de ontem, `/sono` sempre aceita hoje e ontem |
| Dado declarado (dá para "acertar" o alvo) | aceito para o grupo; XP pequeno por noite e teto semanal; reavaliar ao abrir ao público |
| Erro na conta circular do horário | função única no SQL e em `time.ts`, fixture de paridade com casos na meia-noite |
| XP chegando dois dias depois | prévia "confirma na <dia>" e toast com o dia da semana |
| Dado de saúde vazar para amigos | conquistas `private`, bloco `sleep` só no próprio, testes de payload |
| Nova assinatura de `join_challenge` quebrar o cliente | `drop` + parâmetros nomeados; cliente e migration no mesmo deploy (SETUP) |
| Recharts pesar em `/sono` | gráficos sob demanda com skeleton, precache no service worker |

## 13. Publicação depois da Fase 3

Ao fim da Fase 3, com a revisão final limpa:

1. PR #3 sai de rascunho e vai para o `main`; a Vercel publica em produção.
2. As migrations `0007` em diante rodam no Supabase de produção, em ordem, e os jobs de cron
   (`close-nutrition-days`, `close-sleep-nights`) são conferidos. Sem acesso ao projeto Supabase
   nesta sessão, o passo a passo fica em `docs/SETUP.md` para a pessoa dona do projeto rodar.
3. `docs/ROADMAP.md` marca as Fases 2 e 3 como concluídas.
