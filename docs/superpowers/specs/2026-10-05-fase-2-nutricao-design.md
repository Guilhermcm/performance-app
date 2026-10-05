# performance-app: Design da Fase 2, Nutrição

- **Data:** 2026-10-05 (revisão 2, depois do brainstorming com a skill superpowers)
- **Status:** aguardando revisão
- **Roadmap:** [docs/ROADMAP.md](../../ROADMAP.md), Fase 2
- **Base:** [spec da Fundação + Gamificação](2026-10-04-performance-app-foundation-design.md)
  (contrato de eventos, XP, níveis, streaks, social) e as migrations `0001` a `0006`

## 1. Entendimento e objetivo

**O que foi dito.** Nutrição é o segundo pilar. O dono do app e o grupo de amigos já registram o
que comem em outros apps (MyFitnessPal, FatSecret, Cronometer, Tecnonutri e outros) e querem
trocar por este. O grupo vai usar o pilar de verdade, e o app está sendo modelado por eles para
depois abrir ao público geral. A 2a e a 2b são executadas em sequência, na mesma sessão.

**Critério de sucesso.** No fim da 2a, cada pessoa do grupo consegue largar o app antigo: registra
o dia inteiro com rapidez (busca em português, código de barras, recentes, favoritos, copiar
refeição), ganha XP pela consistência e vê o pilar no radar da Home. No fim da 2b, traz o
histórico do app antigo e tem receitas, medidas caseiras, calendário e desafio.

**Restrições.** Supabase free, sem servidor próprio; offline-first; AGPL; dieta é dado de saúde
(LGPD, art. 5º, II), então o padrão é privado; regras de texto público do `CLAUDE.md`.

## 2. Decisões tomadas

| Tema | Decisão |
|---|---|
| Divisão | **2a "trocar de app"** (§3 a §11) e **2b "trazer o passado e refinar"** (§12). O plano da 2a vai do servidor e dos cenários de paridade para as telas |
| Ativação | pilar **opt-in** no perfil, com **períodos ativos** gravados; dia fora de período não é avaliado; semana com dia desligado é **neutra** |
| Ranking | **soma simples** do XP da semana, como hoje |
| Dia no alvo | decidido pelo **servidor** ao fechar o dia, a partir de `food_logs` |
| Meta semanal | **T de 3 a 7 dias no alvo, padrão 5**, congelada por semana |
| XP | mesma forma da Força, teto de **960 por semana**; `reason` próprios no ledger |
| Privacidade | amigos veem nível e XP do pilar; **conquistas de nutrição são privadas** |
| Fontes de alimento | TACO empacotada + Open Food Facts direto do navegador + alimentos da própria pessoa. **USDA fora** |
| Código de barras | na 2a. `BarcodeDetector` nativo com fallback ZXing obrigatório (Safari no iPhone não tem o nativo) |
| Navegação | **aba Nutrição** na TabBar (Início, Plano, Treinar, Nutrição, Social); Stats vira botão no cabeçalho do Plano e da Home |
| Home | **radar de pilares** (shadcn/ui Charts sobre Recharts, carregado sob demanda) + barra de XP da semana segmentada por pilar |
| Importação | 2b: CSV com mapeamento de colunas + perfis prontos (MyFitnessPal, Cronometer, FatSecret); histórico **sem XP** |

## 3. Ativação e meta

### 3.1 Ativação

Perfil > Nutrição (e a tela de convite da aba Nutrição) → interruptor → sheet:

1. Dados que faltarem no perfil (nascimento, sexo, altura, peso).
2. Nível de atividade, com as descrições de §3.2, e ritmo quando o objetivo tiver.
3. Meta calculada, com a conta em uma linha ("gasto estimado 2.740 kcal, +10% para hipertrofia"),
   "Ajustar manualmente" e dias no alvo por semana (3 a 7).

### 3.2 Fórmulas (`features/nutrition/targets.ts`, puro, com teste)

**TMB, Mifflin-St Jeor** (kg, cm, idade em anos completos no dia do cálculo):

```
masculino: 10·peso + 6,25·altura − 5·idade + 5
feminino:  10·peso + 6,25·altura − 5·idade − 161
outro:     média das duas (− 78)
```

**Gasto diário** = TMB × PAL. O PAL descreve o dia fora da academia; os treinos já estão na escala.

| `activity_level` | PAL | Descrição na tela |
|---|---|---|
| `sedentary` | 1,2 | trabalho sentado, pouco movimento fora do treino |
| `light` | 1,375 | anda um pouco no dia a dia |
| `moderate` | 1,55 | em pé boa parte do dia ou anda bastante |
| `active` | 1,725 | trabalho físico ou muito movimento |
| `very_active` | 1,9 | trabalho pesado ou dois treinos por dia |

**Ajuste pelo objetivo** (`goal` e `nutrition_pace`):

| `goal` | `gentle` | `standard` (padrão) |
|---|---|---|
| `fat_loss` | −10% | −20% |
| `hypertrophy` | +5% | +10% |
| `strength` | +5% | +5% |
| `conditioning` | 0 | 0 |

**Piso** `max(TMB, 1200)`; arredondamento para múltiplo de 10 kcal.

**Macros:** proteína em g/kg por objetivo (hipertrofia 2,0, força 1,8, emagrecimento 2,2,
condicionamento 1,6); gordura 25% das kcal com mínimo de 0,6 g/kg; carboidrato com o resto ÷ 4,
mínimo 0.

**Limites.** Depois do cálculo, cada valor é limitado (clamp) aos intervalos aceitos pelo banco
(§5.2): kcal 1000 a 6000, proteína 20 a 400 g, carboidrato 0 a 900 g, gordura 20 a 300 g. Se o
clamp mexer em algum macro, o carboidrato é recalculado com o que sobrar e limitado de novo.

Exemplo: homem, 30 anos, 80 kg, 178 cm, `moderate`, hipertrofia `standard`. TMB = 1767,5 →
× 1,55 = 2740 → +10% = **3010 kcal**; proteína 160 g, gordura 84 g, carboidrato 404 g.

### 3.3 Automática, manual e vigência

- **Automática** (padrão): o cliente recalcula quando um dado de entrada muda (peso registrado,
  perfil editado) e grava a nova meta. O servidor só valida.
- **Manual**: kcal e os três macros editáveis; aviso sem bloqueio quando `4·P + 4·C + 9·G` difere
  mais de 5% das kcal, com "ajustar carboidrato".
- **Vigência**: meta nova vale **a partir de amanhã**; a primeira, criada na ativação, vale hoje.
  O dia é avaliado contra a meta em vigor nele.

### 3.4 Períodos ativos e semana neutra

- Ligar o pilar abre um período (`started_on = hoje`); desligar fecha (`ended_on = ontem`, então
  o dia em que se desligou não é avaliado). Religar no mesmo dia em que desligou reabre o mesmo
  período.
- Um dia só é avaliado se estiver dentro de um período.
- Uma **semana com algum dia fora de período é neutra**: se a meta semanal for batida nela, soma
  ao streak e paga o bônus; se não for, o streak não quebra e nenhum escudo é gasto. A semana da
  ativação cai nessa regra.

## 4. Diário e fechamento do dia

### 4.1 Diário

- Quatro refeições fixas: `breakfast`, `lunch`, `dinner`, `snack`.
- Cada item: nome, marca, origem (`taco`, `off`, `custom`, `quick`, `import`), id na origem,
  gramas e totais da porção (kcal, proteína, carboidrato, gordura; fibra quando houver, sem uso na
  2a). O item não depende de catálogo.
- **Registro rápido** (`quick`): só kcal, macros opcionais.
- Criar, editar e apagar só em **hoje e ontem** (fuso do perfil). Dias anteriores: só leitura.

### 4.2 Fechamento

O dia D fecha no começo de D+2, no fuso do perfil. Fechar um dia avaliável:

1. soma os itens e grava o resumo em `nutrition_days` com o retrato da meta em vigor;
2. classifica o dia (§6.2);
3. emite, com a marca de escrita do servidor (§5.4), os eventos do pilar com
   `source_ref = 'nutrition:<AAAA-MM-DD>'`, que pagam XP pelo `award_xp`;
4. avalia conquistas.

Avaliação preguiçosa (em `get_my_progress` e `get_nutrition_days`) e job `pg_cron`
`close-nutrition-days` diário às 06:30 UTC. Dia fechado não reabre; XP pago não volta.

### 4.3 Semana

- O XP de um dia entra na semana dele (`week_start` pelo `occurred_on`), mesmo chegando dois dias
  depois. O ranking da semana anterior pode mudar até terça de manhã.
- O streak `nutrition_week` de uma semana só é avaliado depois que os sete dias dela fecharam.

## 5. Banco de dados

Migrations `0007_nutrition.sql` e `0008_nutrition_cron.sql` (no molde de 0003/0005). RLS em tudo.

### 5.1 Perfil e períodos

```sql
alter table public.profiles
  add column activity_level text check (activity_level in
    ('sedentary','light','moderate','active','very_active')),
  add column nutrition_pace text not null default 'standard'
    check (nutrition_pace in ('gentle','standard')),
  add column nutrition_enabled boolean not null default false,
  add column nutrition_days_per_week smallint not null default 5
    check (nutrition_days_per_week between 3 and 7);

create table public.nutrition_periods (
  user_id    uuid not null references auth.users on delete cascade,
  started_on date not null,
  ended_on   date check (ended_on is null or ended_on >= started_on - 1),
  primary key (user_id, started_on)
);
```

- `nutrition_periods` é mantida por trigger em `profiles` (mudança de `nutrition_enabled`); o
  cliente só lê. Um período com `ended_on = started_on − 1` (ligou e desligou no mesmo dia) não
  cobre dia nenhum.
- O congelamento de T (`freeze_week_target`) passa a disparar também em
  `nutrition_days_per_week`.

### 5.2 Tabelas do pilar

```sql
create table public.nutrition_targets (
  user_id    uuid not null references auth.users on delete cascade default auth.uid(),
  valid_from date not null,
  kcal       integer not null check (kcal between 1000 and 6000),
  protein_g  integer not null check (protein_g between 20 and 400),
  carbs_g    integer not null check (carbs_g between 0 and 900),
  fat_g      integer not null check (fat_g between 20 and 300),
  mode       text not null check (mode in ('auto','manual')),
  created_at timestamptz not null default now(),
  primary key (user_id, valid_from)
);

create table public.food_logs (
  id         uuid primary key,                 -- gerado no cliente
  user_id    uuid not null references auth.users on delete cascade default auth.uid(),
  day        date not null,
  meal       text not null check (meal in ('breakfast','lunch','dinner','snack')),
  name       text not null check (char_length(name) between 1 and 120),
  brand      text check (char_length(brand) <= 80),
  source     text not null check (source in ('taco','off','custom','quick','import')),
  source_id  text check (char_length(source_id) <= 64),
  grams      numeric(6,1) check (grams > 0 and grams <= 5000),
  kcal       numeric(6,1) not null check (kcal between 0 and 5000),
  protein_g  numeric(5,1) not null default 0 check (protein_g between 0 and 500),
  carbs_g    numeric(5,1) not null default 0 check (carbs_g between 0 and 500),
  fat_g      numeric(5,1) not null default 0 check (fat_g between 0 and 500),
  fiber_g    numeric(5,1) check (fiber_g between 0 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index food_logs_user_day on public.food_logs (user_id, day);

create table public.user_foods (
  id            uuid primary key,              -- gerado no cliente
  user_id       uuid not null references auth.users on delete cascade default auth.uid(),
  source        text not null check (source in ('taco','off','custom')),
  source_id     text check (char_length(source_id) <= 64),
  barcode       text check (barcode ~ '^[0-9]{8,14}$'),
  favorite      boolean not null default false,
  name          text not null check (char_length(name) between 1 and 120),
  brand         text check (char_length(brand) <= 80),
  kcal_100g     numeric(6,1) not null check (kcal_100g between 0 and 900),
  protein_100g  numeric(5,1) not null default 0 check (protein_100g between 0 and 100),
  carbs_100g    numeric(5,1) not null default 0 check (carbs_100g between 0 and 100),
  fat_100g      numeric(5,1) not null default 0 check (fat_100g between 0 and 100),
  serving_g     numeric(6,1) check (serving_g > 0 and serving_g <= 2000),
  serving_label text check (char_length(serving_label) <= 40),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index user_foods_barcode on public.user_foods (user_id, barcode) where barcode is not null;

create table public.nutrition_days (
  user_id    uuid not null references auth.users on delete cascade,
  day        date not null,
  kcal       numeric(7,1) not null,
  protein_g  numeric(6,1) not null,
  carbs_g    numeric(6,1) not null,
  fat_g      numeric(6,1) not null,
  meals      smallint not null,              -- refeições com ao menos um item
  target     jsonb,                          -- retrato da meta; nulo em dia importado sem meta
  logged     boolean not null,
  on_target  boolean not null,
  balanced   boolean not null,
  imported   boolean not null default false, -- 2b; nunca gera XP nem conta em métricas
  closed_at  timestamptz not null default now(),
  primary key (user_id, day)
);
```

`user_foods` guarda as duas coisas: alimentos criados pela pessoa (`custom`) e retratos de
alimentos da TACO ou do OFF salvos como favoritos. Limite de 500 por pessoa.

### 5.3 Acesso

- `nutrition_periods`, `nutrition_days`: só select do próprio.
- `nutrition_targets`: select do próprio; insert do próprio com `valid_from > local_today`, exceto
  a primeira linha da pessoa (`valid_from = local_today`); update só de linhas com
  `valid_from > local_today` (checado no `using` e no `with check`); sem delete.
- `food_logs`: CRUD do próprio. Trigger `before insert or update or delete`, ignorado sob a marca
  de escrita do servidor:
  - recusa `day` fora de `{local_today − 1, local_today}` (`day_closed`) e `source = 'import'`;
  - recusa mudar `user_id` ou `day` num update;
  - limite de 200 itens por dia (`too_many_items`);
  - **última escrita vence**: `updated_at` vem do cliente, limitado a `now()`; um update com
    `updated_at` menor que o gravado é descartado em silêncio (o trigger devolve a linha antiga).
- `user_foods`: CRUD do próprio, até 500.
- `profiles`: o cliente continua escrevendo as colunas do perfil; `nutrition_periods` é derivado
  por trigger.

### 5.4 Marca de escrita do servidor

- `public.begin_server_write()` faz `set_config('perf.server_write', 'on', true)` (vale só na
  transação). `public.is_server_write()` lê a marca. As duas têm `execute` revogado de `public`,
  `anon` e `authenticated`, então não ficam expostas pela API.
- Chamam `begin_server_write()`: as funções de fechamento de dia, `delete_my_account` e, na 2b, a
  RPC de importação.
- `event_kinds` ganha `server_only boolean not null default false`. Entram
  `('nutrition','day_logged',true)`, `('nutrition','day_on_target',true)`,
  `('nutrition','macros_balanced',true)`.
- `validate_activity_event`: tipo `server_only` sem a marca → `server_only_kind`; tipo
  `server_only` com a marca dispensa a janela de 14 dias (fechamento atrasado não quebra).

### 5.5 Metas semanais por pilar

`weekly_targets` ganha `pillar public.pillar not null default 'strength'`; a chave passa a ser
`(user_id, pillar, week_start)`. Tudo o que lê a tabela muda junto:

| Ponto | Mudança |
|---|---|
| `week_target_for(p_user, p_week)` | vira `week_target_for(p_user, p_week, p_pillar default 'strength')`; fallback `days_per_week` e 3 para Força, `nutrition_days_per_week` e 5 para Nutrição. A assinatura antiga é removida (`drop function`) e os `revoke` refeitos |
| `award_xp`, `get_my_progress`, `close_all_weeks` | passam o pilar |
| `freeze_week_target` | congela o T de cada pilar cuja coluna mudou |
| `progress_card` | a subconsulta de T filtra `pillar = 'strength'` (hoje daria "more than one row" com duas linhas) |

### 5.6 XP no ledger

`reason` próprios, para não somar em nada da Força (`close_weeks` de `training_week`,
`achievement_stats.week_targets`, desafio `weeks_on_target`, `progress_card.target_hit`, que
contam `reason = 'week_target'`):

| `reason` | Evento |
|---|---|
| `nutrition_day` | dia no alvo, até o T-ésimo |
| `nutrition_day_extra` | dia no alvo além de T |
| `nutrition_week_target` | meta semanal batida |
| `nutrition_balanced` | macros equilibrados |
| `nutrition_logged` | dia registrado |

### 5.7 Funções

| Função | Papel |
|---|---|
| `close_nutrition_days(p_user)` | fecha os dias avaliáveis pendentes até `local_today − 2`, depois o streak das semanas completas |
| `close_all_nutrition_days()` | chamada pelo cron para quem tem período aberto ou dia pendente |
| `get_nutrition_days(p_from, p_to)` | resumos fechados (máx. 62 dias) + meta em vigor; fecha pendentes antes |
| `award_xp` | ramo `pillar = 'nutrition'` com §6.3 |
| `close_weeks` | streak `nutrition_week` com escudos e semana neutra |
| `achievement_stats` | parte da versão de `0004_social.sql`; métricas de §6.4 (sem dias importados) |
| `progress_card(p_user, p_for_friend boolean default false)` | ver §6.5; com `p_for_friend` omite conquistas `private`. `get_friends` passa `true` |
| `get_my_progress` | fecha dias pendentes e devolve os blocos novos de §6.5 |
| `delete_my_account` | chama `begin_server_write()` antes de apagar |

Itens de hoje e ontem são lidos direto de `food_logs` pelo cliente.

## 6. Gamificação

### 6.1 Princípios

Os da Fase 1: consistência acima de volume, sem punição, servidor como autoridade, prévia no
cliente (`features/gamification/xp.ts` ganha o pilar) com cenários de paridade.

### 6.2 Classificação do dia

Com a meta M em vigor:

| Classe | Condição |
|---|---|
| `logged` | ao menos 2 refeições com item e kcal ≥ 50% de M.kcal |
| `on_target` | `logged`, `|kcal − M.kcal| ≤ 10% de M.kcal` e proteína ≥ M.protein_g |
| `balanced` | `on_target`, carboidrato e gordura a até ±20% das metas deles |

### 6.3 XP

Seja `T = nutrition_days_per_week`, congelado na semana.

| Evento | XP | Limite |
|---|---|---|
| `day_on_target` até o T-ésimo | `round(600 / T)`; o T-ésimo paga o resto | T por semana |
| `day_on_target` além de T | 25 | 2 por semana |
| Meta semanal (T-ésimo dia no alvo) | +150 | 1 por semana |
| `macros_balanced` | 30 | 3 por semana |
| `day_logged` | 10 | 1 por dia |

Máximo semanal 600 + 150 + 50 + 90 + 70 = **960**. Com T = 7 o teto prático é 910, a mesma
propriedade da Força.

### 6.4 Streak e conquistas

- `nutrition_week`: semanas seguidas com a meta semanal batida; escudos como `training_week`
  (+1 a cada 4 semanas, máx. 2); semanas neutras segundo §3.4.
- `achievement_catalog` ganha `private boolean not null default false`, e o `check` de `metric`
  ganha cinco métricas: `nutrition_logged_days`, `nutrition_on_target_days`,
  `nutrition_week_targets`, `nutrition_best_streak`, `protein_best_run` (maior sequência de dias
  fechados com proteína ≥ meta). Todas as conquistas abaixo são `private = true`, com `sort` a
  partir de 300. `achievements.ts` e `gamification-catalog.test.ts` acompanham.

| Código | Métrica ≥ | XP |
|---|---|---|
| `nutrition_first_day` | `nutrition_logged_days` 1 | 50 |
| `nutrition_days_10/50/100/250` | `nutrition_on_target_days` | 100/200/300/500 |
| `nutrition_week_target_1` | `nutrition_week_targets` 1 | 75 |
| `nutrition_streak_4/12/26` | `nutrition_best_streak` | 150/400/800 |
| `protein_7` | `protein_best_run` 7 | 100 |

### 6.5 O que o cliente recebe

`progress_card` (e portanto `get_my_progress`) passa a devolver:

- `week.max = 960 × pilares ativos na semana` (Força sempre; Nutrição se a semana tocou um
  período) e `week.pillars`: XP da semana por pilar, para a barra segmentada;
- `nutrition` (só no próprio): T da semana, dias no alvo e dias registrados na semana, streak
  `nutrition_week`, e `last_closed`: `{day, logged, on_target, balanced, xp}` do último dia
  fechado;
- `radar` (§8.4): para cada pilar, `current` e `previous` (0 a 1, ou nulo sem semana ativa).

Para amigos (`p_for_friend = true`): níveis por pilar, XP da semana e segmentos continuam; somem
as conquistas `private` e o bloco `nutrition`. O radar de amigos fica para a Fase 5.

### 6.6 Celebrações

`Celebration` (hoje `level | achievement`) ganha `pillar_level` e `week_target` (com pilar). O
resultado do dia vira toast: "Ontem no alvo, +120 XP" ou "Ontem registrado, +10 XP". O cliente
guarda o último `last_closed.day` mostrado por conta (`perf_nutrition_seen_v1`) e não repete.

## 7. Busca, código de barras, favoritos e cópia

### 7.1 Busca

Um campo, seções nesta ordem:

| Seção | Fonte | Offline |
|---|---|---|
| Recentes | últimos 50 alimentos distintos registrados (local + `food_logs`) | sim |
| Favoritos | `user_foods` com `favorite` | sim |
| Meus alimentos | `user_foods` com `source = 'custom'` | sim |
| TACO | JSON estático (4ª ed., NEPA/Unicamp, ~600 itens), chunk sob demanda | sim |
| Open Food Facts | busca por texto direto do navegador, `cc=br`, `lc=pt` | não |

- Busca local sem acento e sem caixa, por prefixo de palavra.
- OFF: ≥ 3 letras, 600 ms sem digitar, cache por termo na sessão, sem repetir termo. 429 →
  "Busca online indisponível agora, tente em instantes", com os locais na tela. Sem kcal →
  descartado; kJ ÷ 4,184. Atribuição "Dados: Open Food Facts" junto da seção. O plano compara os
  endpoints de busca do OFF com termos reais em português e escolhe o melhor.

### 7.2 Código de barras

- Leitura: `BarcodeDetector` quando existe; fallback ZXing (pacote decidido no plano, licença
  compatível com AGPL), carregado sob demanda. Também "Digitar código".
- Ordem: `user_foods` por `barcode` → OFF `GET /api/v2/product/{code}`. Não achou → "Criar
  alimento" com o código preenchido, salvo em `user_foods`.

### 7.3 Favoritos e alimentos próprios

Estrela na porção salva o retrato em `user_foods` (`favorite = true`). Criar alimento: nome,
marca, nutrientes por 100 g, porção opcional, código de barras opcional.

### 7.4 Cópia

- "Copiar de…" em cada refeição: dias dos últimos 30 com itens, total por dia; copia os itens
  daquela refeição para a refeição atual (hoje ou ontem).
- "Copiar dia inteiro": as quatro refeições.
- "Repetir hoje" em cada item.
- Cópia sempre cria itens novos com origem e retrato preservados.

### 7.5 Porção

Gramas com stepper, atalhos 50/100/150/200 g e a porção do rótulo quando houver; totais ao vivo.

## 8. Cliente

### 8.1 Estrutura

```
src/features/nutrition/
  targets.ts  classify.ts  search.ts  taco.ts  off-api.ts  barcode.ts
  nutrition-api.ts  outbox.ts  useNutrition.ts
  NutritionScreen.tsx  NutritionInvite.tsx  FoodSearchSheet.tsx  PortionSheet.tsx
  BarcodeScanner.tsx  QuickAddSheet.tsx  CustomFoodSheet.tsx  CopyFromSheet.tsx
  NutritionSetup.tsx  HomeNutritionCard.tsx
src/features/home/PillarRadar.tsx      # §8.4
src/components/ui/chart.tsx            # shadcn/ui Charts
scripts/build-taco.mjs                 # planilha TACO → src/features/nutrition/data/taco.json
```

### 8.2 Offline e sync

- `uuid` gerado no cliente para itens e alimentos salvos.
- Fila `perf_food_outbox_v1` (upsert/delete por id), em ordem, com o backoff da fila de eventos;
  repetir é idempotente; delete de id inexistente é sucesso.
- `day_closed` do servidor → descarta e mostra uma vez "Alguns itens de dias já fechados não
  foram salvos".
- Cópia local: itens de hoje, ontem e dos últimos 14 dias, resumos fechados, alimentos salvos,
  recentes. Pull no login, ao voltar o foco e ao reconectar. Presa à conta logada (como o store
  social).
- Offline: OFF mostra "Busca online indisponível sem conexão"; o leitor procura só em
  `user_foods`.
- O plano confirma que o `sw.js` guarda os chunks sob demanda (TACO, ZXing, radar) para uso
  offline.

### 8.3 Telas

- **TabBar**: Início, Plano, Treinar, Nutrição, Social. Stats vira botão no cabeçalho do Plano e da
  Home (como Exercícios na 1b). Com o pilar desligado, a aba mostra `NutritionInvite`.
- **`/nutricao`**: Hoje/Ontem, anel de kcal (consumido, meta, restante), três barras de macros
  com rótulo e valor em Geist Mono tabular, as quatro refeições com total, itens, "+" e "Copiar
  de…". Tocar no item edita; deslizar ou menu apaga com desfazer. Dias anteriores: resumo.
- **Sheets**: busca (campo, ícone de código de barras, seções, rodapé com "Registro rápido" e
  "Criar alimento"), porção (stepper, atalhos, estrela), leitor (câmera cheia, moldura, lanterna
  quando houver, "Digitar código"), "Copiar de…".
- **Perfil > Nutrição**: ativação (§3.1), meta, dias no alvo por semana.
- **Home**: cartão de nível, **radar** (§8.4), barra de XP da semana segmentada por pilar, cartão
  "Nutrição hoje" (anel compacto, kcal restantes, registrar) com o pilar ligado.

Valem os padrões da spec base (§7.4): dark-first, alvos ≥ 44 px, skeletons, estados vazios com
próxima ação, offline sem bloqueio, `prefers-reduced-motion`.

### 8.4 Radar de pilares

- **Componente**: shadcn/ui Charts (`chart.tsx`, Recharts, MIT), variante de radar com grade
  circular e pontos. `PillarRadar` é carregado sob demanda, com skeleton do mesmo tamanho. O mesmo
  `chart.tsx` serve depois para o Stats e a Fase 5.
- **Eixos**: um por pilar do roadmap: Força, Nutrição, Sono, Hábitos (Foco entra na Fase 6).
  Estados: **ativo** (vértice na cor do pilar, rótulo com ícone, nome e percentual), **desligado**
  (eixo tracejado, cadeado, toque abre a ativação), **em breve** (pilar ainda não lançado,
  tracejado). Rótulos por `tick` customizado.
- **Valor**: consistência de 0 a 100% = XP do pilar nas últimas 4 semanas fechadas ÷ (960 ×
  semanas em que o pilar esteve ativo nessa janela). Só pilares com ao menos uma semana ativa têm
  valor; os outros ficam no centro. Bônus gerais (`pillar = null`) não entram. Semana fechada:
  Força até a semana anterior; Nutrição até a última semana com os sete dias fechados.
- **Comparação**: segunda série com o contorno apagado das 4 semanas anteriores.
- **Visual**: forma em linha de 2 px com preenchimento translúcido na cor de acento; anéis de grade
  discretos em 25/50/75/100%; texto nas cores de texto do tema, nunca na cor do pilar; animação
  da forma ao mudar, só fade com `prefers-reduced-motion`; descrição acessível em texto ("Força
  82%, Nutrição 64%, Sono em breve, Hábitos em breve").
- **Detalhe**: toque abre sheet com os números por pilar nas duas janelas.
- O cálculo é do servidor (`radar` em §6.5), coberto pelos cenários de paridade.

## 9. Internacionalização

Strings novas nos 16 packs de `src/locales/` (pt-BR via `PT_BR_OVERRIDES`), regras de texto
público do `CLAUDE.md`, `check-locales` e `check-source-strings --strict` passando. Nomes da TACO
não são traduzidos; refeições, níveis de atividade e estados do radar são.

## 10. Privacidade

- `public/privacidade.html`: seção do pilar (o que é guardado, que é opcional, que só a pessoa vê,
  que amigos veem só nível e XP, que buscas e códigos de barras vão ao Open Food Facts com o IP).
  Data de atualização e `privacy-page.test.js` acompanham.
- Exclusão de conta apaga tudo por cascata, com a marca de escrita do servidor (§5.4).

## 11. Testes da 2a

- **Vitest (cliente)**: `targets.ts` (sexos, PAL, objetivos, ritmo, piso, clamp, idade no dia),
  `classify.ts`, `search.ts`, `off-api.ts` (kJ, descarte, 429, cache), `barcode.ts` (ordem de
  busca, fallback), `outbox.ts` (idempotência, ordem, `day_closed`), store, telas (busca, porção,
  leitor com câmera simulada, cópia, ativação, convite, TabBar, cartão da Home, radar com estados
  de eixo e descrição acessível), celebrações novas.
- **Vitest + PGlite** (`supabase/tests/nutrition-*.test.ts`): janela hoje/ontem, última escrita
  vence, limite de itens, vigência e update de metas, períodos (ligar, desligar, religar no mesmo
  dia), fechamento (classes, retrato, idempotência, fora de período), XP por T de 3 a 7, limites,
  bônus, domingo fechando na terça, `nutrition_week` com escudo e semana neutra, reasons próprios
  sem tocar `training_week`/`week_target_1`/`weeks_on_target`, conquistas e métricas,
  `server_only` (cliente não insere; servidor insere fora da janela de 14 dias), `weekly_targets`
  por pilar com `progress_card` e `get_friends` funcionando, `week.max` e segmentos, radar (janela,
  semanas ativas, nulo), RLS (A não lê nada de nutrição de B; `get_friends`, ranking e feed sem
  dado de nutrição nem conquista `private`), exclusão de conta com itens antigos.
- **Paridade**: cenários JSON de classificação, XP do pilar e radar, nos dois lados.
- **Script da TACO**: valida o JSON gerado (contagem, campos, kcal coerente com macros).
- **Smoke manual**: ligar o pilar, registrar por busca e por código de barras no iPhone e no
  Android, copiar refeição, ver o XP e o radar no dia seguinte, outro aparelho.

## 12. Fase 2b: trazer o passado e refinar

Recebe seções detalhadas como esta antes do plano da 2b, a partir do que a 2a deixar pronto.

### 12.1 Importação de histórico

- **Mapeador genérico de CSV** (no cliente): detecta separador, decimal e formato de data
  (pergunta quando `dd/mm` e `mm/dd` forem ambíguos), sugere colunas por sinônimos (Date/Data,
  Calories/Energia, Protein/Proteína, Meal/Refeição, Food/Alimento), converte kJ, mostra prévia de
  alguns dias e só então envia.
- **Perfis prontos**: MyFitnessPal (totais por refeição e dia), Cronometer e FatSecret (itens).
  Cada perfil é escrito e testado com um export real do grupo; sem arquivo real, o perfil não
  entra. Apps sem export em arquivo (possivelmente o Tecnonutri) ficam de fora.
- **Servidor**: RPC `import_nutrition_history(p_days jsonb)` em lotes, com a marca de escrita do
  servidor; só dias anteriores ao primeiro período do pilar (ou a ontem, para quem nunca ativou);
  reimportar substitui os itens `import` do dia; limites de 3 anos e 50 itens por dia. Grava
  `food_logs` com `source = 'import'` e `nutrition_days` com `imported = true`.
- **Sem XP**: dias importados nunca passam pelo fechamento nem entram em métricas, conquistas ou
  radar. Aparecem no histórico e, na Fase 5, no painel.

### 12.2 Refinamentos

- **Receitas**: soma de itens com rendimento em porções, salva como alimento próprio.
- **Medidas caseiras**: concha, colher, xícara, unidade para os alimentos mais comuns da TACO, a
  partir da tabela de medidas referidas da POF/IBGE.
- **Histórico em calendário**: mês com o estado de cada dia (no alvo, registrado, importado, fora
  de período), a partir de `nutrition_days`.
- **Desafio `nutrition_days_on_target`** (team/solo, no molde da 1b): quem entra aceita mostrar
  aos membros quantos dias ficou no alvo no período, e nada além disso.

## 13. Fora de escopo

USDA FoodData Central (reavaliar ao abrir ao público, se a cobertura faltar), wger como fonte,
micronutrientes, água, jejum, foto do prato com IA, plano alimentar, integrações com balanças e
apps de saúde, compartilhar refeições, radar de amigos e comparação no radar (Fase 5).

## 14. Licenças

- **TACO** (NEPA/Unicamp): o plano confirma os termos de redistribuição antes de empacotar o JSON
  e registra a citação em `NOTICE.md` e na seção TACO da busca.
- **Open Food Facts**: dados ODbL, consulta sem base própria compartilhada; atribuição junto dos
  resultados e em `NOTICE.md`. Retratos em `user_foods` são da própria pessoa.
- **Recharts** (MIT) e shadcn/ui Charts (MIT); pacote ZXing escolhido com licença compatível.
- **POF/IBGE** (2b): dado público, com citação.
- **OpenNutriTracker** (GPL-3.0): referência de fórmulas e fluxo; nenhum código portado.

## 15. Riscos

| Risco | Mitigação |
|---|---|
| Termos da TACO não permitirem redistribuição em JSON | confirmar no início do plano; alternativa: baixar a planilha no build sem versionar o JSON |
| Busca do OFF fraca em português ou limitada por IP | locais primeiro, comparação de endpoints no plano, cache, mensagem no 429 |
| Leitor de código de barras ruim no iPhone | fallback ZXing obrigatório, "Digitar código", smoke em aparelho real |
| Recharts pesar na abertura da Home | radar sob demanda com skeleton |
| XP chegando dois dias depois ("cadê meu XP?") | prévia "a confirmar amanhã" e toast no fechamento |
| Ranking da semana passada mudar até terça | aceito; o ranking padrão é a semana corrente |
| Cliente forjar eventos do pilar | `server_only` + marca de servidor não exposta, com teste |
| Dado de saúde vazar para amigos | conquistas `private`, bloco `nutrition` só no próprio, testes de payload |
| Mudança em `weekly_targets` quebrar a Força | tabela de §5.5 vira tarefa explícita, com testes de `progress_card` e `get_friends` |
| Export real dos apps diferente do esperado | perfis só com arquivo real do grupo; mapeador genérico como saída |
