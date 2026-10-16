# performance-app: Design da Fase 4, Hábitos e trackers

- **Data:** 2026-10-15
- **Status:** design aprovado por seções e spec aprovada em 2026-10-15. A 4a (Hábitos) foi
  implementada e publicada em produção em 2026-10-16; o que esta spec deixava em aberto foi
  fechado nas [Decisões do plano](../plans/2026-10-15-fase-4a-habitos.md#decisões-do-plano). A 4b
  (Trackers) foi implementada em 2026-10-16 e aguarda o SQL 0031 em produção; o que a spec deixava
  em aberto foi fechado nas [Decisões do plano](../plans/2026-10-16-fase-4b-trackers.md#decisões-do-plano).
- **Publicação da 4a:** `supabase/release/0026-0030_habits.sql` e o cliente sobem no mesmo dia, pelo
  roteiro dos Hábitos em [docs/SETUP.md](../../SETUP.md).
- **Publicação da 4b:** `supabase/release/0031_trackers.sql` só cria tabelas e pode rodar antes do
  merge, sem pressa, pelo roteiro dos Trackers em [docs/SETUP.md](../../SETUP.md).
- **Roadmap:** [docs/ROADMAP.md](../../ROADMAP.md), Fase 4
- **Base:** [spec do Sono](2026-10-06-fase-3-sono-design.md) (molde mais recente do pilar: períodos,
  fechamento em D+2, XP no servidor, streak, conquistas privadas, radar, fila offline compartilhada,
  desafio com opt-in), [spec da 2b](2026-10-06-fase-2b-nutricao-design.md) (calendário) e
  [spec da Fundação](2026-10-04-performance-app-foundation-design.md)
- **Subetapas:** **4a Hábitos** e **4b Trackers**, cada uma com plano, PR, SQL e roteiro de
  publicação próprios. A 4b só começa depois do merge da 4a.

## 1. Entendimento e objetivo

A Fase 4 acende o último eixo do radar que ainda diz "em breve" e dá ao app um jeito de medir
qualquer coisa.

- **Hábitos** são o pilar `habits`: coisas que a pessoa quer fazer com frequência, criadas por ela,
  cada uma com uma meta de N vezes por semana. Rendem XP, streak, conquistas e desafio entre amigos,
  no molde dos outros pilares.
- **Trackers** são medição pura: água, peso, humor, passos, leitura. Não rendem XP e não entram no
  pilar. Servem para a pessoa ver tendência e, mais tarde, para o Painel da Fase 5.

Sucesso: a pessoa cria seus hábitos em um minuto, marca o do dia num toque pela Home, entende a
semana pelo número C de Q, e o eixo Hábitos do radar reflete isso. Nos trackers, registra em dois
toques e vê a linha ou as barras com a média.

## 2. Decisões tomadas

| # | Decisão |
|---|---|
| 1 | Uma spec com duas subetapas: 4a Hábitos, 4b Trackers |
| 2 | Só hábitos "fazer". Sem hábito "evitar" e sem hábito com quantidade |
| 3 | Hábitos personalizados: a pessoa cria nome, ícone e N (1 a 7 vezes por semana; diário é 7) |
| 4 | Semana proporcional: C de Q, cada hábito conta até o próprio N; no alvo quando C = Q |
| 5 | XP no teto semanal de 960, com piso de 7 na divisão (§5.1) |
| 6 | Privacidade como no Sono: nomes e checks só da pessoa; amigos veem nível e XP do pilar |
| 7 | Trackers não rendem XP e não entram no pilar |
| 8 | Três tipos de tracker: número com unidade, duração, rótulo |
| 9 | Vários registros por dia; número e duração resumem o dia por soma ou média, escolhida na criação |
| 10 | Gráficos: linha com média móvel de 7 dias (número e duração), barras de contagem (rótulo), "há X dias desde o último" em todos. Sem pizza e sem grupos |
| 11 | Lembrete: cartão "Hábitos de hoje" na Home. Notificação push vai para o ROADMAP |
| 12 | Desafio `habit_checks` com opt-in, cada hábito limitado ao próprio N por semana |
| 13 | Arquitetura como no Sono: o servidor fecha os dias e paga o XP; o cliente usa a fila offline compartilhada |
| 14 | Registros de tracker podem ser feitos e editados em qualquer dia passado (não há XP a proteger) |

# Parte A: Hábitos (4a)

## 3. Ativação, hábitos e períodos

### 3.1 Ativação

Perfil ganha o cartão **Hábitos**, no molde dos cartões de Nutrição e Sono: chave para ligar e
desligar, e "Abrir Hábitos". Ao ligar com nenhum hábito ativo, o app abre direto a folha de criação
do primeiro hábito, porque um pilar ligado sem hábitos não mede nada. O pilar só liga quando esse
hábito é salvo: fechar a folha sem salvar deixa tudo como estava, e o próximo toque abre a
configuração de novo. Desligar pede confirmação e não apaga nada.

`profiles.habits_enabled` liga o pilar; `habit_periods` guarda os períodos ativos, mantida por
trigger como `sleep_periods`. Uma semana com algum dia fora de período é **neutra** para o streak
(§5.3), como no Sono.

### 3.2 O hábito

| Campo | Regra |
|---|---|
| `name` | 1 a 40 caracteres, sem espaços nas pontas |
| `icon` | uma chave da lista fixa de ícones (§9.4), cerca de 24 |
| `per_week` | N, inteiro de 1 a 7 |
| `sort` | ordem na lista |
| `archived_at` | nulo enquanto ativo |

Teto técnico de **20 hábitos ativos** por pessoa; o 21º é recusado (`too_many_habits`). Nomes
repetidos são permitidos.

### 3.3 Meta da semana por hábito

O N vale por semana e **congela** em `habit_targets (habit_id, week_start, target)`:

- No começo da semana (primeira leitura ou fechamento que toca a semana), cada hábito ativo ganha
  `target = per_week`.
- **Hábito criado no meio da semana** entra na semana corrente com
  `target = min(per_week, dias restantes da semana contando hoje)`.
- **Mudar o N** vale a partir da semana seguinte; a semana corrente fica com o target congelado.
  A folha avisa "A nova meta vale a partir da próxima semana".
- **Arquivar no meio da semana** reduz o target da semana corrente para
  `min(target, checks já feitos na semana)`, para o hábito não travar os 100%. O hábito some das
  semanas seguintes; o histórico fica.
- **Reativar** um arquivado conta como criar: entra na semana corrente pelos dias restantes.

### 3.4 Check

- Um check por hábito por dia (`habit_checks`, chave `(habit_id, day)`). Desfazer apaga a linha.
- Criar e apagar só em **hoje e ontem**, no fuso do perfil (`day_closed` fora disso), como Nutrição
  e Sono. Hábito arquivado não aceita check novo (`habit_archived`).
- Dia fora de período do pilar não aceita check (`pillar_off`).

## 4. A semana

Para uma semana do pilar:

- **Q** = soma dos `target` congelados dos hábitos daquela semana.
- **C** = soma, por hábito, de `min(checks do hábito na semana, target)`.
- **Progresso** = C / Q (0 quando Q = 0).
- A semana está **no alvo** quando Q > 0 e C = Q.

Check além do target de um hábito é guardado e aparece na tela, mas não conta em C, não paga XP e
não conta no desafio. Os checks válidos de um hábito numa semana são os primeiros `target` checks
em ordem de dia.

## 5. Gamificação

### 5.1 XP

Seja `Q` o da semana e `P = max(Q, 7)`. Os eventos são emitidos ao fechar cada dia (§6.4); a
semana entra pela `week_start` do dia.

| Evento | XP | Limite |
|---|---|---|
| Check válido (`habit_check`) | `round(600 / P)`; quando Q ≥ 7, o Q-ésimo check válido da semana paga `600 − (Q − 1) × round(600 / Q)` | Q por semana |
| Semana no alvo (`habit_week_target`) | `150` se Q ≥ 7; senão `round(150 × Q / 7)` | 1 por semana |
| Dia com pelo menos um check válido (`habit_day`) | 30 | 1 por dia |

Máximo semanal: com Q ≥ 7, 600 + 150 + 210 = **960**. Com Q < 7, o teto cai na proporção
(exemplo: Q = 3 dá 3 × 86 + 64 + 3 × 30 = 412). O piso de 7 impede que um hábito único de "1 vez por
semana" pague 750 XP com um toque.

A ordem dos checks válidos dentro de um dia, para saber qual é o Q-ésimo, segue `habits.sort` e
depois `habit_id`.

### 5.2 Eventos e motivos

- `event_kinds` ganha `('habits','habit_check',true)`, `('habits','habit_day',true)` e
  `('habits','habit_week_target',true)`, todos `server_only`.
- `source_ref`: `habit:<habit_id>:<AAAA-MM-DD>` no check, `habits:<AAAA-MM-DD>` no dia,
  `habits-week:<week_start>` no bônus. Únicos, então refechar não paga duas vezes.
- `reason` no `xp_ledger`, com `pillar = 'habits'`: `habit_check`, `habit_day`, `habit_week_target`.

### 5.3 Streak

`habits_week`: semanas seguidas no alvo. Escudos como `training_week` (+1 a cada 4 semanas, máximo
2). Semana neutra (§3.1): no alvo soma, fora do alvo não quebra nem gasta escudo. Semana com Q = 0
dentro de período (todos os hábitos arquivados) também é neutra. A semana só é julgada depois que os
sete dias fecharam (terça de manhã, `week_start <= local_today − 8`). Função `close_habit_weeks`, no
molde de `close_sleep_weeks`, terminando em `evaluate_achievements`.

### 5.4 Conquistas

Todas `private = true`, `sort` a partir de 500. Cinco métricas novas no `check` de
`achievement_catalog.metric` e em `achievement_stats`:

| Métrica | Definição |
|---|---|
| `habits_checks` | checks válidos em dias fechados |
| `habits_week_targets` | semanas com `habit_week_target` pago |
| `habits_best_streak` | melhor `habits_week` |
| `habits_iron_best_run` | maior sequência de semanas julgadas seguidas em que um mesmo hábito bateu o próprio target (target > 0) |

| Código | Métrica ≥ | XP | `sort` |
|---|---|---|---|
| `habits_first_check` | `habits_checks` 1 | 50 | 500 |
| `habits_checks_50/200/500/1000` | `habits_checks` | 100/200/300/500 | 510/520/530/540 |
| `habits_week_target_1` | `habits_week_targets` 1 | 75 | 550 |
| `habits_streak_4/12/26` | `habits_best_streak` | 150/400/800 | 560/570/580 |
| `habits_iron_8` ("Hábito de ferro") | `habits_iron_best_run` 8 | 200 | 590 |

Semana em que o hábito não existia ou estava arquivado quebra a sequência dele no "Hábito de ferro".

### 5.5 O que o cliente recebe

- `progress_card`: `week.pillars.habits` e `week.max = 960 × (1 + nutrição ativa + sono ativo +
  hábitos ativos na semana)`. Amigos veem isso e o nível do pilar, nada além.
- `my_progress_extras` (só a pessoa): `radar.habits` e o bloco `habits`:
  `{ week: { q, c, xp }, streak: { current, best, shields }, last_week: { start, target_hit } | null }`.
- `get_my_progress` congela os targets da semana, chama `close_habit_days(v_uid)` e devolve o resto.

### 5.6 Radar, barra da semana e celebrações

- O eixo **Hábitos** do radar acende com a mesma conta dos outros pilares (`pillar_consistency`:
  XP da semana sobre 960, média das semanas fechadas e ativas). Pilar desligado mostra o cadeado que
  abre a ativação; ligado sem semana fechada mostra o estado no centro. O rótulo do eixo leva a
  `/habitos`.
- A barra de XP da semana ganha o segmento Hábitos.
- Celebrações: subida de nível do pilar e "Semana de hábitos completa, +150 XP" (ou o valor
  proporcional) quando `last_week.target_hit` muda para uma semana nova. Marcador antigo sem
  `habits` é completado sem celebrar. Não há aviso por dia.

## 6. Banco de dados (4a)

Migrations depois das do Sono (a última é `0025`), em ordem: `0026_habits_base.sql` (perfil,
períodos, hábitos, metas, checks, eventos), `0027_habits_close.sql` (dias, fechamento, XP, streak,
conquistas), `0028_habits_progress.sql` (cartão, extras, radar, histórico),
`0029_habits_challenge.sql` e `0030_habits_cron.sql`. Arquivo único:
`supabase/release/0026-0030_habits.sql`, gerado por `scripts/build-release-sql.mjs`.

Toda função redefinida parte do corpo mais recente: `0022` para `award_xp` e `achievement_stats`;
`0023` para `pillar_consistency`, `progress_card`, `my_progress_extras` e `get_my_progress`; `0024`
para `challenge_progress`, `challenge_grace`, `close_challenge`, `create_challenge` e
`join_challenge`; `0021` para `week_target_for` e `freeze_week_target`. O teste de corpos
(`function-bodies.test.ts`) ganha uma linha por função redefinida.

### 6.1 Perfil, períodos, hábitos e metas

```sql
alter table public.profiles add column habits_enabled boolean not null default false;

create table public.habit_periods (
  user_id    uuid not null references auth.users on delete cascade,
  started_on date not null,
  ended_on   date check (ended_on is null or ended_on >= started_on - 1),
  primary key (user_id, started_on)
);

create table public.habits (
  id          uuid primary key,
  user_id     uuid not null references auth.users on delete cascade default auth.uid(),
  name        text not null check (char_length(btrim(name)) between 1 and 40 and name = btrim(name)),
  icon        text not null check (icon ~ '^[a-z][a-z0-9-]{0,31}$'),
  per_week    smallint not null check (per_week between 1 and 7),
  sort        integer not null default 0,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.habit_targets (
  habit_id   uuid not null references public.habits on delete cascade,
  user_id    uuid not null references auth.users on delete cascade,
  week_start date not null,
  target     smallint not null check (target between 0 and 7),
  primary key (habit_id, week_start)
);
```

- `habit_periods`: trigger `after insert or update of habits_enabled` em `profiles`, no molde de
  `profiles_sleep_period`; `habits_active_on(p_user, p_day)`. Cliente só lê.
- `habits`: o `id` vem do cliente (uuid gerado no aparelho, para a fila offline ser idempotente).
  CRUD do próprio, sem delete (arquivar é update). Trigger `before insert or update`: recusa o 21º
  ativo (`too_many_habits`), recusa mudar `user_id`, mantém `updated_at` com a regra "última escrita
  vence" do Sono, e aplica §3.3 na semana corrente (criar, arquivar, reativar).
- `habit_targets`: só leitura para o cliente. Escrita só por funções `security definer`:
  `freeze_habit_targets(p_user, p_week)` cria as linhas que faltam com `target = per_week` para os
  hábitos ativos na segunda; não mexe nas existentes. Mudar `per_week` não toca a semana corrente.
- `weekly_targets` não é usado para hábitos: Q vem da soma de `habit_targets`.

### 6.2 Checks

```sql
create table public.habit_checks (
  habit_id   uuid not null references public.habits on delete cascade,
  user_id    uuid not null references auth.users on delete cascade default auth.uid(),
  day        date not null,
  created_at timestamptz not null default now(),
  primary key (habit_id, day)
);
```

- Insert e delete do próprio; sem update. Trigger `before insert or delete`, `security invoker`,
  aplicado quando `current_user` é `authenticated` ou `anon`: `day` fora de
  `{my_local_today() − 1, my_local_today()}` recusa com `day_closed`; hábito de outra pessoa ou
  arquivado recusa (`habit_archived`); dia fora de período recusa (`pillar_off`).
- Inserir de novo o mesmo check é idempotente no cliente (`on conflict do nothing`).

### 6.3 Dias fechados

```sql
create table public.habit_days (
  user_id    uuid not null references auth.users on delete cascade,
  day        date not null,
  checks     smallint not null,   -- checks feitos no dia
  valid      smallint not null,   -- checks válidos (§4)
  xp         integer not null,    -- XP pago pelo dia (checks válidos e o +30)
  closed_at  timestamptz not null default now(),
  primary key (user_id, day)
);

alter table public.habit_checks add column counted boolean;  -- null até o dia fechar
```

Só leitura do próprio. `counted` marca os checks válidos no fechamento; o desafio e as conquistas
contam por ele.

### 6.4 Funções

- `close_habit_days(p_user) returns integer` (`security definer`): trava `xp:<user>`; fecha os dias
  de `greatest(primeiro started_on, último dia fechado + 1)` até `local_today − 2` que estão em
  período. Para cada dia, em ordem: congela os targets da semana se faltar; marca `counted` nos
  checks do dia que ainda cabem no target do hábito naquela semana; grava `habit_days`; emite
  `habit_check` por check válido e `habit_day` se houver algum, com `on conflict do nothing`; quando
  o C da semana chega a Q, emite `habit_week_target`. Termina chamando `close_habit_weeks`.
- `award_xp`: ramo `pillar = 'habits'` com as regras de §5.1, lendo Q de `habit_targets`.
- `close_habit_weeks(p_user)`: streak e `habits_iron` (§5.3, §5.4), depois `evaluate_achievements`.
- `close_all_habit_days() returns integer`: rede de segurança do cron, no molde de
  `close_all_sleep_nights`.
- `get_habit_history(p_from date, p_to date) returns jsonb` (RPC, no máximo 62 dias, senão
  `invalid_range`): fecha pendentes e devolve
  `{ days: [{ day, checks, valid, xp }], checks: [{ habit_id, day, counted }],
  targets: [{ habit_id, week_start, target }], periods: [{ started_on, ended_on }] }`, só do dono.

### 6.5 Desafio

- `challenges.template` aceita `habit_checks`; `create_challenge` valida: modos `team` e `solo`,
  período de 7 a 92 dias, 2 a 20 pessoas, meta solo de 1 até 10 × dias do período e de equipe de 1
  até isso × (1 + convidados), opt-in e pilar ligado. A folha sugere a meta pelo Q da pessoa
  (Q × semanas do período, arredondado).
- `challenge_members.share_habits boolean not null default false`.
- `create_challenge` e `join_challenge` ganham `p_share_habits boolean default false` no fim, com
  `drop` das assinaturas da `0024` e `revoke`/`grant` refeitos. Chamadas com parâmetros nomeados
  sem o novo parâmetro continuam funcionando.
- Erros: `habits_opt_in_required`, `habits_off`.
- `challenge_progress`: checks com `counted` entre `starts_on` e `ends_on`, de quem entrou.
- `challenge_grace('habit_checks') = 2`; `close_challenge` fecha os dias de hábitos pendentes de cada
  participante antes do resultado.
- O payload mostra só a contagem de quem optou.

### 6.6 Cron

`0030_habits_cron.sql`: job `close-habit-days` diário às **06:50 UTC** (`'50 6 * * *'`) chamando
`close_all_habit_days()`, no molde de `0025_sleep_cron.sql` (sem `pg_cron`, segue sem agendar).

## 7. Cliente (4a)

### 7.1 Estrutura

`src/features/habits/`, em TypeScript, no molde de `src/features/sleep/`:

- `types.ts`; `week.ts` (regras puras: Q, C, checks válidos, XP previsto com o piso de 7, com
  fixture compartilhado com o SQL); `habits-api.ts`; `outbox.ts` (sobre `src/lib/local-outbox.ts`,
  chave `perf_habits_outbox_v1`); `useHabits.ts` (store com hábitos, checks de hoje e ontem, targets
  da semana, histórico em cache `perf_habits_history_v1`, sync no foco, ao reconectar e na virada do
  dia); `icons.ts` (a lista fixa de ícones).
- Telas: `HabitsScreen.tsx` (`/habitos`), `HomeHabitsCard.tsx`, `HabitSheet.tsx` (criar e editar),
  `HabitsSetup` dentro do cartão do Perfil.
- Gamificação: radar, `weekSegments`, celebrações e tipos ganham `habits` como ganharam `sleep`.
- Desafio: `templates.ts`, `NewChallengeSheet`, `ChallengeDetail` e `social-api.ts` ganham
  `habit_checks` e `p_share_habits`, no molde do Sono.

### 7.2 Cartão "Hábitos de hoje" na Home

- Aparece abaixo do cartão da manhã do Sono, com o pilar ligado e pelo menos um hábito ativo.
- Uma linha por hábito: ícone, nome, "2 de 3 na semana" e um botão de check de 44 px com nome
  acessível ("Marcar ler hoje"). O check é otimista, vai para a fila e pode ser desfeito no mesmo
  dia.
- Ordem: primeiro os que ainda faltam na semana, com destaque em texto para os atrasados
  ("faltam 2 em 3 dias") quando os checks que faltam passam dos dias restantes menos um; depois os
  completos, marcados e mais discretos.
- Rodapé: "Semana: 6 de 10 · +360 XP até agora" (XP previsto pelo cliente, confirmado no fechamento)
  e o link para `/habitos`.
- Com mais de 6 hábitos, o cartão mostra os 6 primeiros pela ordem acima e "Ver todos".

### 7.3 Tela `/habitos`

- **Topo**: "6 de 10 nesta semana" em número grande, o streak e os escudos.
- **Lista ordenável** (arrastar ou setas acessíveis): ícone, nome, "N por semana", os 7 pontos da
  semana corrente (hoje e ontem marcáveis, os outros só leitura) e a sequência de semanas do hábito.
- **Criar e editar** (`HabitSheet`): nome, ícone (grade da lista fixa), N num seletor de 1 a 7. Ao
  mudar o N de um hábito existente: "A nova meta vale a partir da próxima semana". Arquivar com
  confirmação. Seção "Arquivados" no fim da lista, com "Reativar".
- **Histórico**: calendário do mês (`MonthCalendar`), cada dia com a contagem de checks válidos e um
  estado (sem check, parcial, todos os do dia); tocar abre os hábitos marcados naquele dia.
  Navegação até o primeiro período.
- **Estados**: skeleton com a forma da tela; vazio "Crie seu primeiro hábito"; offline mostra o cache
  e continua aceitando check; aviso único quando a fila descarta checks de dia já fechado.

### 7.4 Offline e sync

Igual ao Sono: fila por conta, recusa definitiva (`day_closed`, `habit_archived`, `pillar_off`)
descarta só aquele item e mostra o aviso uma vez; erro de rede guarda e tenta de novo; troca de conta
não mistura filas; apagar a conta limpa a fila daquela pessoa.

# Parte B: Trackers (4b)

## 8. Trackers

### 8.1 O tracker

| Campo | Regra |
|---|---|
| `name` | 1 a 40 caracteres |
| `icon` | da mesma lista fixa dos hábitos |
| `kind` | `number`, `duration` ou `label`; não muda depois de criado |
| `unit` | só `number`: 0 a 12 caracteres (`ml`, `kg`, `passos`) |
| `decimals` | só `number`: 0 a 2 |
| `aggregate` | `number` e `duration`: `sum` ou `avg`; `label`: nulo |
| `options` | só `label`: 2 a 8 opções `{ id, text }`, texto de 1 a 24 caracteres, em ordem |
| `sort`, `archived_at` | como nos hábitos |

Teto técnico de **30 trackers ativos** (`too_many_trackers`). Opções de rótulo: dá para renomear,
reordenar e acrescentar; remover uma opção com registros é recusado (`option_in_use`).

### 8.2 Registro

- Cada registro guarda `day` (data local), `at` (hora local, `HH:MM`) e o valor do tipo: `value`
  (número, com as casas decimais do tracker), `minutes` (duração, 1 a 1440) ou `option` (id de uma
  opção existente). Nota opcional de até 140 caracteres.
- Sem fechamento: criar, editar e apagar em **qualquer dia até hoje** no fuso do perfil
  (`future_day` para dia futuro). Última escrita vence, como no Sono.
- Registro de tracker arquivado continua editável; registro novo em arquivado é recusado
  (`tracker_archived`).

### 8.3 Resumo do dia e estatísticas

- `number` e `duration`: o dia é a **soma** ou a **média** dos registros do dia, conforme
  `aggregate`. Dia sem registro não entra na média móvel nem nas estatísticas.
- `label`: cada registro conta uma vez para a sua opção.
- Estatísticas do período (30 ou 90 dias): média dos resumos diários, mínimo, máximo, dias com
  registro e "há X dias desde o último" (hoje é "hoje", ontem é "ontem").
- Média móvel de 7 dias: média dos resumos dos dias com registro em `[d − 6, d]`; nula sem registro
  na janela.

### 8.4 Tela `/trackers`

- **Lista**: ícone, nome, último valor formatado ("1,8 L hoje", "72,4 kg há 2 dias", "bom ontem") e
  um botão **+** de registro rápido. Número e duração abrem um teclado numérico já com o último
  valor; rótulo abre os botões das opções. Registro rápido grava para agora; a folha completa permite
  escolher dia, hora e nota.
- **Detalhe**: escolha de 30 ou 90 dias; gráfico (§8.5); estatísticas; lista de registros do período,
  editável; "Ver como tabela".
- **Criar e editar**: folha com nome, ícone, tipo (só na criação) e os campos do tipo. Arquivar com
  confirmação; seção "Arquivados".
- **Estados**: skeleton, vazio "Crie seu primeiro tracker", offline com cache e registro liberado.

### 8.5 Gráficos

Pela skill `dataviz` e com o validador de cores, no molde dos gráficos do Sono:

- `number` e `duration`: uma linha por resumo diário (pontos ≥ 8 px, dias sem registro em branco,
  sem ligar a linha por cima do vazio) e a média móvel de 7 dias como segunda série, com legenda e
  rótulo direto. Um eixo só, em unidade do tracker. Tooltip com data, resumo e quantos registros.
- `label`: barras horizontais, uma por opção, na ordem das opções, com a contagem no período e o
  rótulo em texto.
- Descrição em texto ("Média de 1,9 L nos últimos 30 dias, 24 dias com registro"), "Ver como
  tabela", texto nas cores de texto do tema, cor nunca sozinha, `prefers-reduced-motion` sem
  animação. Gráficos em chunk carregado sob demanda, com skeleton do mesmo tamanho.

### 8.6 Acesso

Sem aba nova. O Perfil ganha a linha **Trackers** (abre `/trackers`), e o topo de `/habitos` tem o
atalho "Trackers". A Home não ganha cartão de trackers nesta fase.

## 9. Banco e cliente (4b)

### 9.1 Banco

Uma migration, `0031_trackers.sql`, e o arquivo único `supabase/release/0031_trackers.sql`. Nada é
redefinido: trackers não tocam XP, progresso nem desafios.

```sql
create table public.trackers (
  id          uuid primary key,
  user_id     uuid not null references auth.users on delete cascade default auth.uid(),
  name        text not null check (char_length(btrim(name)) between 1 and 40 and name = btrim(name)),
  icon        text not null check (icon ~ '^[a-z][a-z0-9-]{0,31}$'),
  kind        text not null check (kind in ('number', 'duration', 'label')),
  unit        text check (unit is null or char_length(unit) <= 12),
  decimals    smallint check (decimals is null or decimals between 0 and 2),
  aggregate   text check (aggregate is null or aggregate in ('sum', 'avg')),
  options     jsonb,
  sort        integer not null default 0,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check ((kind = 'label') = (options is not null and aggregate is null)),
  check (kind = 'label' or aggregate is not null),
  check (kind = 'number' or (unit is null and decimals is null))
);

create table public.tracker_entries (
  id         uuid primary key,
  tracker_id uuid not null references public.trackers on delete cascade,
  user_id    uuid not null references auth.users on delete cascade default auth.uid(),
  day        date not null,
  at         time not null check (extract(second from at) = 0),
  value      numeric(12, 2),
  minutes    smallint check (minutes between 1 and 1440),
  option     text,
  note       text check (char_length(note) <= 140),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(value, minutes, option) = 1)
);
create index tracker_entries_tracker_day on public.tracker_entries (tracker_id, day);
```

- RLS: CRUD do próprio nas duas tabelas (sem delete de tracker; arquivar é update).
- Trigger em `trackers`: valida `options` (2 a 8, ids únicos, textos de 1 a 24), recusa o 31º ativo,
  recusa mudar `kind` ou `user_id`, recusa remover opção com registros (`option_in_use`), última
  escrita vence.
- Trigger em `tracker_entries`: o valor preenchido tem de bater com o `kind` do tracker (e `option`
  existir nele); `day` até `my_local_today()` (`future_day`); tracker do próprio dono; tracker
  arquivado não aceita registro novo; não muda `tracker_id` nem `user_id`; última escrita vence.
- Apagar a conta remove tudo pela cascata.

### 9.2 Cliente

`src/features/trackers/`: `types.ts`, `stats.ts` (resumo do dia, média móvel, estatísticas, puro e
testado), `trackers-api.ts`, `outbox.ts` (chave `perf_trackers_outbox_v1`, upsert por `id`),
`useTrackers.ts`, `TrackersScreen.tsx`, `TrackerDetail.tsx`, `TrackerSheet.tsx`, `EntrySheet.tsx`,
`TrackerLineChart.tsx` e `TrackerBars.tsx` (chunks sob demanda, listados em `sw-on-demand`).

# Parte C: comum às duas subetapas

## 10. Internacionalização e texto público

Toda string nova entra nos 16 packs (pt-BR por `PT_BR_OVERRIDES`), contagens por `tn()`, sem
travessão nem hífen como pausa, passando pelo humanizer; os dois scripts de locale passam. Nomes de
hábitos, trackers e opções são da pessoa e não se traduzem. Unidades de tracker são texto livre.

## 11. Privacidade

- Hábitos: nomes, ícones, checks e metas por hábito ficam só com a pessoa. Amigos veem nível e XP do
  pilar e, pelo `week.max`, se o pilar estava ligado na semana, como na Nutrição e no Sono. Conquistas
  de hábitos são privadas. No desafio, só a contagem de checks válidos de quem deu opt-in.
- Trackers: tudo só da pessoa; nada em cartão de progresso, feed ou desafio.
- A página de privacidade ganha as duas seções, em pt-BR e en, com a data nova; o parágrafo de
  consentimento cita a contagem de hábitos no desafio.
- Apagar a conta remove as linhas pela cascata e as filas `perf_habits_outbox_v1` e
  `perf_trackers_outbox_v1` daquela pessoa no aparelho.

## 12. Testes

- **SQL (PGlite)**, 4a:
  - XP: Q = 1, 3, 7, 10 e 20, com o piso de 7, o resto no Q-ésimo check, o bônus proporcional e o
    teto de 960, num fixture compartilhado com `week.ts`;
  - check além do target não paga nem conta; ordem dos válidos por dia e `sort`;
  - hábito criado na quarta (target pelos dias restantes), N mudado no meio da semana, arquivar e
    reativar no meio da semana;
  - semana neutra (pilar ligado na quinta, desligado e religado), Q = 0;
  - fechamento em D+2 no fuso de São Paulo e de Tóquio; refechar não paga duas vezes;
  - streak com escudos; conquistas, incluindo "Hábito de ferro" com quebra por arquivar;
  - privacidade: `progress_card` e `get_friends` como amigo não trazem nomes, ícones nem checks;
  - desafio `habit_checks`: opt-in, pilar desligado, contagem limitada ao target, fechamento com
    pendentes; chamadas antigas sem `p_share_habits` continuam funcionando;
  - corpos redefinidos e paridade com Treino, Nutrição e Sono;
  - bundle `0026-0030` aplicado sobre um banco com `0001` a `0025` e linhas existentes.
- **SQL**, 4b: validação por tipo, opções em uso, dia futuro, arquivado, RLS entre duas contas, teto
  de 30, cascata ao apagar a conta, bundle `0031` sobre a base com `0001` a `0030`.
- **Cliente**: regras puras (`week.ts`, `stats.ts`) com fixture; fila offline (descarte de dia
  fechado, troca de conta, mesma conta depois de sair); store (virada do dia, cache); telas (cartão
  da Home com atrasados e mais de 6, `/habitos`, `/trackers`, folhas); gráficos com descrição e
  tabela; validador de cores com a cor do pilar Hábitos nos dois temas.

## 13. Fora de escopo

- Notificação push de lembrete (entra no ROADMAP como item depois da Fase 4).
- Hábito "evitar" e hábito com quantidade ou meta numérica.
- Tracker ligado a hábito; tracker com XP.
- Grupos de trackers, gráfico de pizza, importação de CSV.
- Hábito com dias da semana fixos (só N por semana).
- Trackers no Painel de performance (Fase 5).

## 14. Riscos

| Risco | Mitigação |
|---|---|
| Regras de target no meio da semana confundem | Folha avisa o efeito; tela mostra "conta a partir de..." no hábito novo; testes de cada caso |
| Q pequeno vira farm de XP | Piso de 7 (§5.1) |
| Muitos hábitos deixam o cartão da Home longo | Teto de 6 linhas e "Ver todos" |
| Redefinir `create_challenge` e `join_challenge` de novo quebra cliente antigo | Parâmetro novo com default no fim; teste com chamada nomeada antiga; publicação no mesmo dia |
| Trackers com muitos registros pesam na tela | Leitura por período (30 ou 90 dias) com índice por `(tracker_id, day)` |
| Cores: o âmbar do pilar Hábitos falhar no validador | Ajustar só o passo do token, como foi com o Sono |

## 15. Publicação

- **4a:** `supabase/release/0026-0030_habits.sql` roda em produção e o merge do PR da 4a vem no mesmo
  dia (por causa de `create_challenge` e `join_challenge`), por um roteiro novo em
  [docs/SETUP.md](../../SETUP.md), com as conferências de funções, RLS e o job `close-habit-days`.
  Depois do deploy, o grupo fecha e abre o app antes do primeiro desafio de hábitos.
- **4b:** `supabase/release/0031_trackers.sql` só cria tabelas; pode rodar antes do merge, sem
  pressa.
- O ROADMAP marca cada subetapa quando entrar em produção e ganha o item "lembretes por notificação
  push".
