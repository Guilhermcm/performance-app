# performance-app: Design da Fase 2, Nutrição

- **Data:** 2026-10-05
- **Status:** aguardando revisão
- **Roadmap:** [docs/ROADMAP.md](../../ROADMAP.md), Fase 2
- **Base:** [spec da Fundação + Gamificação](2026-10-04-performance-app-foundation-design.md)
  (contrato de eventos, XP, níveis, streaks, social)

## 1. Visão

A Nutrição é o segundo pilar. A pessoa liga o pilar no perfil, recebe uma meta de calorias e
macros calculada a partir do que o app já sabe dela e registra o que come em poucos toques. Cada
dia que fecha dentro da meta vira XP, do mesmo jeito que um treino planejado vira XP no pilar
Força. Amigos veem o nível de Nutrição e o XP da semana, nunca o que a pessoa comeu.

A fase é dividida em duas, como a 1a/1b:

- **2a, núcleo**: meta, diário, busca (TACO local + Open Food Facts por texto), alimentos próprios,
  registro rápido de calorias, pilar Nutrição na gamificação, cartão na Home. Esta spec detalha a
  2a por inteiro.
- **2b, conforto e social**: código de barras pela câmera, favoritos, copiar refeição de outro dia,
  receitas simples, medidas caseiras, USDA, histórico em grade/calendário, desafio
  `nutrition_days_on_target`. Descrita no §12 no nível de escopo; ganha plano próprio depois que a
  2a estiver em uso.

## 2. Decisões tomadas

| Tema | Decisão |
|---|---|
| Divisão | 2a (núcleo) + 2b (conforto e social), cada uma com plano próprio |
| Ativação | pilar **opt-in** no perfil (`nutrition_enabled`); quem só treina não vê nada novo além de um convite discreto |
| Ranking | **soma simples** do XP da semana, como hoje. Quem cuida de mais pilares sobe mais; o pilar é opcional |
| Dia no alvo | decidido pelo **servidor** ao fechar o dia, a partir de `food_logs`. O cliente só mostra prévia |
| Meta semanal | **T_n configurável de 3 a 7 dias no alvo, padrão 5**, congelada por semana como o T da Força |
| Dados | tabelas normalizadas (`food_logs`, `user_foods`, `nutrition_targets`, `nutrition_days`), fora do `app_state` |
| Catálogo de alimentos | TACO empacotada no cliente (JSON estático); Open Food Facts consultado direto do navegador; sem catálogo compartilhado no banco |
| Registro | cada item guarda um **retrato** dos nutrientes da porção; o fechamento do dia não depende de catálogo nenhum |
| Navegação | sem aba nova na 2a: entrada pelo cartão da Home e por `/nutricao`. A TabBar é revista na Fase 5 |
| Privacidade | dieta é dado de saúde (LGPD, art. 5º, II). Só a própria pessoa lê; amigos veem nível e XP |

## 3. Meta calórica e de macros

### 3.1 Dados de entrada

Do perfil, que já existe: `birth_date`, `sex`, `height_cm`, `weight_kg`, `goal`. Campos novos em
`profiles` (§5.1): `activity_level` e `nutrition_pace`. Se algum dado de entrada estiver vazio, o
fluxo de ativação pede antes de mostrar a meta.

### 3.2 Fórmulas (`features/nutrition/targets.ts`, função pura, com teste)

**TMB, Mifflin-St Jeor** (peso em kg, altura em cm, idade em anos completos no dia do cálculo):

```
masculino: 10·peso + 6,25·altura − 5·idade + 5
feminino:  10·peso + 6,25·altura − 5·idade − 161
outro:     média das duas (− 78)
```

**Gasto diário** = TMB × PAL:

| `activity_level` | PAL | Descrição na tela |
|---|---|---|
| `sedentary` | 1,2 | trabalho sentado, pouco movimento fora do treino |
| `light` | 1,375 | anda um pouco no dia a dia |
| `moderate` | 1,55 | em pé boa parte do dia ou anda bastante |
| `active` | 1,725 | trabalho físico ou muito movimento |
| `very_active` | 1,9 | trabalho pesado ou dois treinos por dia |

O PAL descreve o dia fora da academia. Os treinos já estão embutidos na escala e não somam à parte.

**Ajuste pelo objetivo** (`goal` do perfil e `nutrition_pace`):

| `goal` | `gentle` | `standard` (padrão) |
|---|---|---|
| `fat_loss` | −10% | −20% |
| `hypertrophy` | +5% | +10% |
| `strength` | +5% | +5% |
| `conditioning` | 0 | 0 |

**Piso**: a meta nunca fica abaixo de `max(TMB, 1200)`. Arredondamento para múltiplo de 10 kcal.

**Macros** (padrão; a pessoa pode trocar para manual, §3.3):

| Macro | Regra |
|---|---|
| Proteína | g/kg por objetivo: hipertrofia 2,0 · força 1,8 · emagrecimento 2,2 · condicionamento 1,6 |
| Gordura | 25% das kcal, com mínimo de 0,6 g/kg |
| Carboidrato | o restante das kcal ÷ 4, mínimo 0 |

Exemplo: homem, 30 anos, 80 kg, 178 cm, `moderate`, hipertrofia `standard`.
TMB = 800 + 1112,5 − 150 + 5 = 1767,5 → × 1,55 = 2740 → +10% = **3010 kcal**; proteína 160 g
(640 kcal), gordura 84 g (753 kcal), carboidrato 404 g. Este caso e outros (feminino, outro,
piso acionado, gordura no mínimo) viram cenários de teste.

### 3.3 Meta automática e manual

- **Automática** (padrão): recalculada pelo cliente sempre que um dado de entrada muda (peso
  registrado, perfil editado). O servidor só valida.
- **Manual**: a pessoa edita kcal e os três macros. O app avisa (sem bloquear) se
  `4·P + 4·C + 9·G` diferir mais de 5% das kcal e oferece "ajustar carboidrato".
- **Vigência**: toda meta nova vale **a partir de amanhã**. A exceção é a primeira meta, criada
  na ativação, que vale já para hoje. Assim ninguém ajusta a meta às 23h para caber no que comeu.
- Histórico em `nutrition_targets`; o dia é avaliado contra a meta em vigor naquele dia.

## 4. Diário

### 4.1 Modelo

- Quatro refeições fixas: café da manhã, almoço, jantar, lanches (`breakfast`, `lunch`, `dinner`,
  `snack`).
- Cada item tem nome, marca (opcional), origem (`taco`, `off`, `custom`, `quick`), id na origem,
  gramas e os totais da porção: kcal, proteína, carboidrato, gordura. Fibra entra se a origem
  tiver; não conta para nada na 2a.
- **Registro rápido** (`quick`): só kcal, com macros opcionais, para quando não dá para achar o
  alimento.
- Só dá para registrar, editar ou apagar itens de **hoje e de ontem** (fuso do perfil). Ontem
  continua aberto porque é comum lançar o jantar na manhã seguinte. Dias anteriores ficam só para
  leitura.

### 4.2 Fechamento do dia

O dia D fecha quando D+1 termina no fuso do perfil (o fechamento de D acontece no começo de D+2).
Fechar significa:

1. somar os itens de D e gravar o resumo em `nutrition_days`, com a meta em vigor;
2. classificar o dia (§6.2);
3. emitir, pelo próprio servidor, os eventos do pilar (`day_logged`, `day_on_target`,
   `macros_balanced`), que pagam XP pelo `award_xp` de sempre;
4. avaliar conquistas.

Avaliação **preguiçosa** (em `get_my_progress` e `get_nutrition_days`) e job `pg_cron`
`close-nutrition-days` diário às 06:30 UTC como rede de segurança, no molde de `close-weeks`.
Um dia fechado não reabre e o XP pago não volta (princípio "recompensa sem punição").

Dias anteriores à ativação do pilar, ou em que o pilar estava desligado, não são avaliados.

### 4.3 Consequência na semana

O domingo só fecha na terça às 00:00. Por isso:

- a semana do pilar Nutrição (meta semanal, streak `nutrition_week`) só é avaliada depois que os
  sete dias dela fecharam;
- o XP do domingo entra na semana do domingo (`week_start` pelo `occurred_on`), mesmo chegando na
  terça. O ranking da semana passada pode mudar até terça de manhã. É aceito: o ranking padrão
  mostra a semana corrente.

## 5. Banco de dados

Migração `0007_nutrition.sql` (+ `0008_nutrition_cron.sql`, no molde de 0003/0005). RLS ligada em
tudo; `delete_my_account` já apaga por `on delete cascade` em `auth.users`, e o teste de exclusão
ganha as tabelas novas.

### 5.1 Perfil

```sql
alter table public.profiles
  add column activity_level text check (activity_level in
    ('sedentary','light','moderate','active','very_active')),
  add column nutrition_pace text not null default 'standard'
    check (nutrition_pace in ('gentle','standard')),
  add column nutrition_enabled boolean not null default false,
  add column nutrition_enabled_on date,              -- primeiro dia avaliável
  add column nutrition_days_per_week smallint not null default 5
    check (nutrition_days_per_week between 3 and 7);
```

Ligar o pilar grava `nutrition_enabled_on = local_today` se estiver vazio. Desligar mantém tudo
gravado e só para a avaliação; religar não reavalia os dias em que esteve desligado.

### 5.2 Tabelas novas

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
  id         uuid primary key,                 -- gerado no cliente (offline)
  user_id    uuid not null references auth.users on delete cascade default auth.uid(),
  day        date not null,
  meal       text not null check (meal in ('breakfast','lunch','dinner','snack')),
  name       text not null check (char_length(name) between 1 and 120),
  brand      text check (char_length(brand) <= 80),
  source     text not null check (source in ('taco','off','custom','quick')),
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

create table public.nutrition_days (
  user_id     uuid not null references auth.users on delete cascade,
  day         date not null,
  kcal        numeric(7,1) not null,
  protein_g   numeric(6,1) not null,
  carbs_g     numeric(6,1) not null,
  fat_g       numeric(6,1) not null,
  meals       smallint not null,              -- refeições com ao menos um item
  target      jsonb not null,                 -- retrato da meta em vigor
  logged      boolean not null,
  on_target   boolean not null,
  balanced    boolean not null,
  closed_at   timestamptz not null default now(),
  primary key (user_id, day)
);
```

### 5.3 Regras de acesso

- `nutrition_targets`: select do próprio; insert/update do próprio com `valid_from > local_today`,
  exceto a primeira linha da pessoa, que pode ser `valid_from = local_today`. Sem delete.
- `food_logs`: select/insert/update/delete do próprio. Trigger `before insert or update or delete`
  recusa `day` fora de `{local_today − 1, local_today}` (`day_closed`), mudança de `user_id` ou de
  `day` num update, e mais de 200 itens no dia (`too_many_items`).
- `user_foods`: CRUD do próprio, até 500 por pessoa.
- `nutrition_days`: só select do próprio; escrita só pelas funções de fechamento.
- **Eventos só do servidor**: `event_kinds` ganha a coluna `server_only boolean default false`. Os
  três tipos do pilar Nutrição entram com `server_only = true`, e `validate_activity_event` recusa
  esses tipos quando quem insere é o papel `authenticated` (`server_only_kind`). Sem isso, a
  política de insert atual deixaria o cliente forjar um dia no alvo.
- `weekly_targets` ganha `pillar` (padrão `strength`; a chave passa a ser
  `(user_id, pillar, week_start)`), e `week_target_for` passa a receber o pilar. O congelamento ao
  mudar `nutrition_days_per_week` segue o mesmo trigger de `days_per_week`.

### 5.4 Funções

| Função | Papel |
|---|---|
| `close_nutrition_days(p_user)` | fecha todos os dias pendentes entre `nutrition_enabled_on` e `local_today − 2`, depois as semanas completas do pilar |
| `close_all_nutrition_days()` | chamada pelo cron para todo mundo com o pilar ligado |
| `get_nutrition_days(p_from date, p_to date)` | resumos fechados do intervalo (máx. 62 dias) + a meta em vigor; fecha pendentes antes |
| `award_xp` (estendida) | trata `pillar = 'nutrition'` com as regras de §6 |
| `close_weeks` (estendida) | streak `nutrition_week` com escudos, avaliado só para semanas cujos sete dias já fecharam |
| `achievement_stats` (estendida) | métricas de nutrição para o catálogo de §6.4 |
| `get_my_progress` | já devolve níveis por pilar; passa a fechar dias pendentes e incluir o streak `nutrition_week` |

Os itens do dia corrente são lidos direto de `food_logs` pelo cliente; não precisam de RPC.

## 6. Gamificação do pilar Nutrição

### 6.1 Princípios

Os mesmos da Fase 1: consistência acima de volume, sem punição, servidor como autoridade, prévia
no cliente (`features/gamification/xp.ts` ganha as regras do pilar) com cenários de paridade.

### 6.2 Classificação do dia

Com a meta M em vigor no dia:

| Classe | Condição |
|---|---|
| `logged` | ao menos 2 refeições com item e kcal ≥ 50% de M.kcal |
| `on_target` | `logged`, `|kcal − M.kcal| ≤ 10% de M.kcal` e proteína ≥ M.protein_g |
| `balanced` | `on_target`, e carboidrato e gordura a até ±20% das metas deles |

### 6.3 Regras de XP

Seja `T = nutrition_days_per_week`, congelado na semana.

| Evento (emitido no fechamento) | XP | Limite |
|---|---|---|
| `day_on_target`, até o T-ésimo da semana | `round(600 / T)` (o T-ésimo paga o resto, como na Força) | T por semana |
| `day_on_target` além de T | 25 | 2 por semana |
| Meta semanal batida (T-ésimo dia no alvo) | +150 | 1 por semana |
| `macros_balanced` | 30 | 3 por semana |
| `day_logged` | 10 | 1 por dia |

Máximo semanal = 600 + 150 + 50 + 90 + 70 = **960 XP**, igual à Força para qualquer T. A tabela
espelha a da Força de propósito (`macros_balanced` no lugar de `pr`, `day_logged` no lugar de
`weight_logged`), o que deixa `award_xp` com um ramo parecido e a prévia simples.

Com T = 7 não existe "além de T", e o teto prático fica em 910. É a mesma propriedade que a Força
já tem com 7 dias por semana.

### 6.4 Streak e conquistas

- Streak `nutrition_week`: semanas seguidas com a meta semanal da Nutrição batida, escudos iguais
  aos de `training_week` (+1 a cada 4 semanas, máx. 2).
- Conquistas novas (XP como bônus geral, `pillar = null`), no catálogo SQL e em `achievements.ts`:

| Código | Condição | XP |
|---|---|---|
| `nutrition_first_day` | 1º dia `logged` | 50 |
| `nutrition_days_10/50/100/250` | total de dias no alvo | 100/200/300/500 |
| `nutrition_week_target_1` | 1ª meta semanal da Nutrição batida | 75 |
| `nutrition_streak_4/12/26` | streak `nutrition_week` | 150/400/800 |
| `protein_7` | 7 dias fechados seguidos com proteína ≥ meta | 100 |

### 6.5 Social

Nada muda na 1b além do que já vem de graça: `progress_card` soma todos os pilares, então o nível
de Nutrição aparece no cartão do amigo e o XP entra no ranking. O feed continua só com
`workout_completed` e `pr`. `get_friends`, `get_feed` e o ranking ganham testes provando que
nenhum dado de `food_logs`, `nutrition_days`, `nutrition_targets` ou `user_foods` sai para outra
conta.

## 7. Busca de alimentos

### 7.1 Fontes na 2a

| Fonte | Como | Quando |
|---|---|---|
| **Recentes** | últimos 50 itens distintos da própria pessoa (cache local + `food_logs`) | primeiro, sempre |
| **Meus alimentos** | `user_foods` | junto com recentes |
| **TACO** (4ª ed., NEPA/Unicamp, ~600 alimentos in natura e preparações) | JSON estático gerado por script a partir da planilha oficial, carregado sob demanda (chunk próprio, ~100 KB gzip), busca local | instantâneo, offline |
| **Open Food Facts** | `GET world.openfoodfacts.org/cgi/search.pl?search_terms=…&json=1&page_size=20&fields=…` direto do navegador, com `cc=br` e `lc=pt` | online, ≥ 3 letras, depois de 600 ms sem digitar |

- Busca local sem acento e sem caixa, por prefixo de palavra, com prioridade: recentes → meus
  alimentos → TACO. O nome da TACO ("Arroz, tipo 1, cozido") é exibido como vem.
- Open Food Facts limita buscas por IP (cerca de 10 por minuto). O cliente guarda as respostas por
  termo na sessão, não repete busca igual e, ao tomar 429, mostra "Busca online indisponível agora,
  tente em instantes" sem esconder os resultados locais.
- Produto do OFF sem kcal por 100 g é descartado. Valores em kJ são convertidos (÷ 4,184).
- Nada do OFF é gravado num catálogo compartilhado. O item registrado guarda o retrato dos
  nutrientes e o código de barras em `source_id`; isso basta para "recentes".

### 7.2 Porção

- Gramas com stepper e atalhos (50, 100, 150, 200 g) e, se a origem tiver, a porção do rótulo
  ("1 unidade (30 g)"). Os totais aparecem ao vivo enquanto ajusta.
- Medidas caseiras (concha, colher, xícara) ficam para a 2b, porque exigem uma tabela própria
  para os alimentos da TACO.

## 8. Cliente

### 8.1 Estrutura

```
src/features/nutrition/
  targets.ts            # fórmulas de §3 (puro)
  classify.ts           # classificação do dia de §6.2 (puro, espelho do SQL)
  search.ts             # normalização e ranking da busca local
  taco.ts               # carregamento do JSON da TACO
  off-api.ts            # cliente do Open Food Facts
  nutrition-api.ts      # Supabase: logs, metas, alimentos próprios, dias fechados
  outbox.ts             # fila offline de escritas
  useNutrition.ts       # store Zustand, ligado à conta logada (como o de social)
  NutritionScreen.tsx   # /nutricao
  FoodSearchSheet.tsx   # bottom sheet de busca e porção
  QuickAddSheet.tsx
  CustomFoodSheet.tsx
  NutritionSetup.tsx    # ativação e edição da meta (perfil)
  HomeNutritionCard.tsx
scripts/build-taco.mjs  # planilha TACO → src/features/nutrition/data/taco.json
```

### 8.2 Offline e sync

- Itens e alimentos próprios usam `uuid` gerado no cliente, então criar offline não depende do
  servidor.
- Escritas vão para `perf_food_outbox_v1` (upsert/delete por id) e são enviadas na ordem, com o
  mesmo backoff da fila de eventos. Upsert repetido é idempotente; delete de id inexistente conta
  como sucesso.
- Conflito entre aparelhos: última escrita vence por item (`updated_at`). É uma pessoa só, com
  poucos itens por dia; não justifica merge.
- `day_closed` vindo do servidor (item de anteontem que ficou preso offline) descarta a escrita e
  mostra um aviso único: "Alguns itens de dias já fechados não foram salvos".
- Cópia local: hoje, ontem e os resumos fechados dos últimos 14 dias. Pull no login, ao voltar o
  foco e ao reconectar.
- O chunk da TACO precisa entrar no cache do service worker para a busca funcionar offline; o
  plano confere como o `sw.js` trata chunks carregados sob demanda.

### 8.3 Telas

- **`/nutricao`, o dia**: seletor Hoje/Ontem (dias anteriores aparecem só como resumo), anel de
  kcal (consumido, meta, quanto falta), três barras de macros com cor do pilar e rótulo, e as
  quatro refeições com seus itens e total. "+" em cada refeição abre a busca já apontando para ela.
  Tocar num item abre a porção para editar; deslizar ou o menu do item apaga com "desfazer".
- **Busca** (`FoodSearchSheet`, Dice UI Combobox dentro de um Drawer): um campo só, seções
  Recentes / Meus alimentos / TACO / Open Food Facts, estado de carregando só na seção online.
  Atalhos no rodapé: "Registro rápido" e "Criar alimento".
- **Ativação** (Perfil > Nutrição): interruptor do pilar → sheet em 2 passos: (1) nível de
  atividade, com as descrições de §3.2, e ritmo, quando o objetivo tiver; (2) meta calculada, com
  a conta explicada em uma linha ("gasto estimado 2.740 kcal, +10% para hipertrofia") e
  "Ajustar manualmente". Dados de entrada faltando aparecem antes do passo 1. A mesma seção edita
  dias no alvo por semana (3 a 7).
- **Home**: com o pilar ligado, cartão "Nutrição hoje" com anel compacto, kcal restantes e botão
  de registrar. Desligado, um convite discreto que some ao ser dispensado e não volta.
- **Resultado do dia**: no primeiro carregamento depois de um fechamento, o resultado de ontem
  aparece pelo mecanismo de celebrações da 1a: toast para dia registrado ou no alvo; tela de
  celebração só para meta semanal, level-up de pilar e conquista.
- **Perfil**: a barra do pilar Nutrição aparece quando ele tem XP; o resto não muda.

Padrões de §7.4 da spec base valem integralmente (mobile-first, alvos ≥ 44 px, estados vazios,
skeletons, offline sem bloqueio, `prefers-reduced-motion`). Valores numéricos em Geist Mono
tabular. A cor do pilar Nutrição (verde) já existe nos tokens.

## 9. Internacionalização

Todas as strings novas entram nos 16 packs de `src/locales/` (pt-BR via `PT_BR_OVERRIDES`),
seguindo as regras de texto público do `CLAUDE.md`, e `check-locales` e `check-source-strings
--strict` precisam passar. Nomes da TACO não são traduzidos (são dados, não interface). Nomes das
refeições e dos níveis de atividade são traduzidos.

## 10. Privacidade

- `public/privacidade.html` ganha uma seção sobre o pilar: o que é guardado (itens do diário,
  metas, alimentos próprios, resumos diários), que é opcional, que ninguém além da pessoa vê, e
  que as buscas online vão para o Open Food Facts (que recebe o termo buscado e o IP). Data de
  atualização e o teste `privacy-page.test.js` acompanham.
- Excluir a conta apaga tudo por cascata; o teste de exclusão cobre as tabelas novas.

## 11. Testes

- **Vitest (cliente)**: `targets.ts` (sexos, PAL, objetivos, ritmo, piso, mínimo de gordura,
  idade no dia), `classify.ts`, `search.ts` (acentos, prefixo, prioridade), `off-api.ts` (kJ,
  descarte sem kcal, 429, cache por termo), `outbox.ts` (idempotência, ordem, `day_closed`),
  store, telas (busca, porção, registro rápido, ativação, cartão da Home).
- **Vitest + PGlite (`supabase/tests/nutrition-*.test.ts`)**: janela hoje/ontem nos logs, limite de
  itens, vigência das metas (primeira hoje, demais amanhã), fechamento de dia (classes, retrato da
  meta, idempotência, dias antes da ativação e com pilar desligado), XP por T de 3 a 7, limites,
  bônus semanal, domingo fechando na terça, streak `nutrition_week` com escudo, conquistas,
  `server_only` (cliente não insere `day_on_target`), RLS (A não lê nada de nutrição de B; amigos
  não recebem nada disso em `get_friends`, ranking e feed), exclusão de conta.
- **Paridade**: cenários JSON de classificação e de XP do pilar consumidos pelos dois lados, como
  os da Força.
- **Script da TACO**: teste que valida o JSON gerado (contagem, campos, kcal coerente com macros
  dentro de uma tolerância).
- **Smoke manual pós-deploy**: ligar o pilar, registrar um dia, ver o XP no dia seguinte, abrir em
  outro aparelho.

## 12. Fase 2b (escopo, sem detalhe)

- Leitor de código de barras pela câmera (BarcodeDetector com fallback em JS) + `GET
  /api/v2/product/{code}` do OFF.
- Favoritos, copiar refeição de outro dia, receitas simples (soma de itens com rendimento).
- Medidas caseiras para os alimentos mais comuns da TACO.
- USDA FoodData Central (exige chave de API: entra por Edge Function do Supabase ou fica fora).
- Histórico de dias em calendário/grade (ReUI Calendar/Data Grid).
- Desafio `nutrition_days_on_target` (team/solo) no molde dos da 1b.
- wger como fonte complementar, se a cobertura de TACO + OFF se mostrar insuficiente.

## 13. Fora de escopo

Micronutrientes, água, jejum, foto do prato com IA, plano alimentar/cardápio, integração com
balanças e apps de saúde, compartilhamento de refeições com amigos.

## 14. Licenças

- **TACO**: publicação do NEPA/Unicamp de distribuição livre. O plano confirma os termos antes de
  empacotar o JSON e registra a citação em `NOTICE.md` e na tela de busca ("Fonte: TACO,
  NEPA/Unicamp").
- **Open Food Facts**: dados sob ODbL, imagens CC BY-SA. Como nada é guardado em base própria
  compartilhada, só há consulta; a atribuição ("Dados: Open Food Facts") aparece junto dos
  resultados online e em `NOTICE.md`.
- **OpenNutriTracker** (GPL-3.0): referência para fórmulas e fluxo; nenhum código portado nesta
  fase.

## 15. Riscos

| Risco | Mitigação |
|---|---|
| Termos da TACO não permitirem redistribuição em JSON | confirmar no início do plano; alternativa: baixar a planilha no build sem versionar o JSON |
| Limite de buscas do OFF degradar a experiência | busca local primeiro, debounce, cache por termo, mensagem clara no 429 |
| Dados do OFF incompletos ou errados | descartar sem kcal; mostrar marca e porção; alimento próprio como saída |
| Fechamento em D+2 parecer lento ("cadê meu XP?") | prévia no cliente com "a confirmar amanhã" e toast no fechamento |
| Ranking da semana passada mudar até terça | aceito e documentado; o ranking padrão é a semana corrente |
| Cliente forjar eventos do pilar | `server_only` em `event_kinds`, com teste |
| Dado de saúde vazar para amigos | nenhuma RPC social lê tabelas de nutrição; testes de RLS e de payload |
| Meta automática irreal para extremos (muito alto/baixo peso, idade) | piso, limites nas colunas, modo manual |
