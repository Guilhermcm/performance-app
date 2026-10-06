# performance-app: Design do check-in com foto e do Social no estilo GymRats

- **Data:** 2026-10-06
- **Status:** aguardando revisão
- **Roadmap:** [docs/ROADMAP.md](../../ROADMAP.md), nova Fase 1c (antes do Sono)
- **Base:** [spec da Fundação](2026-10-04-performance-app-foundation-design.md) (gamificação 1a e
  social 1b), [spec da Fase 2](2026-10-05-fase-2-nutricao-design.md) (molde de pilar: fechamento em
  D+2, eventos só do servidor, conquistas privadas, radar) e [spec da 2b](2026-10-06-fase-2b-nutricao-design.md)
  (calendário genérico, desafios com carência)
- **Subprojeto 1 de 2.** O subprojeto 2 (o Plano como produto: catálogo de programas com base em
  evidência, análise do plano e progresso dos exercícios) tem spec própria depois desta.

## 1. Entendimento e objetivo

**O que foi dito.** O botão do meio "Começar treino" não serve: o grupo não registra o treino na
academia, segue o plano de cabeça e quer saber se cumpriu a semana. O treino ao vivo continua
existindo, mas não é prioridade. O registro passa a ser um **check-in com foto obrigatória**, como no
GymRats; **qualquer atividade conta igual**; a foto é vista pelos **amigos por padrão**, com a opção
"só eu" por check-in. Quem quiser detalha carga e repetições; o padrão é só "feito". O Social segue
o GymRats: feed de check-ins, reações e comentários, desafios por dias de treino. Título e legenda do
post são personalizáveis, e há uma observação privada.

**Critério de sucesso.** Fazer o check-in em três toques ao chegar na academia; ver no feed quem
treinou hoje e reagir; disputar desafios por dias de treino; ver a semana cumprida no pilar Treino,
sem precisar registrar séries.

## 2. Decisões tomadas

| Tema | Decisão |
|---|---|
| Barra de navegação | Início · Plano · **◉ Check-in** (centro, abre a câmera) · Nutrição · Social |
| Foto | obrigatória; câmera ou galeria; comprimida e sem metadados no aparelho |
| Atividades | qualquer uma conta igual (Musculação, Corrida, Bike, Natação, Caminhada, Esporte, Aula, Outro) |
| Contagem | dia com check-in (no máximo 1 por dia para meta, streak e desafios); vários posts por dia permitidos |
| Visibilidade | "Amigos" (padrão do perfil) ou "Só eu", por check-in |
| Detalhe do treino | opcional; padrão é só "feito" |
| Treino ao vivo | sai do centro; fica no Plano ("Treinar com o app") e termina no check-in |
| Pilar | Força passa a se chamar **Treino** (no banco continua `strength`) |
| Social | feed único de amigos, reações com qualquer emoji, comentários sem respostas em cadeia, avisos no app |
| Desafios | modelo principal "Dias de treino"; placar e feed do desafio |
| Fora | notificação push, denúncia e moderação, validar se a foto é "de academia", vídeo, gerador de plano |

## 3. O check-in

### 3.1 Fluxo

1. **Foto.** O botão central abre a câmera traseira (`<input type="file" accept="image/*"
   capture="environment">`, que funciona no PWA do iPhone e do Android), com "Escolher da galeria".
2. **Atividade.** Chips na ordem da §2. Em dia com rotina no Plano, vem marcado **Musculação** com a
   rotina de hoje; dá para trocar a rotina ou a atividade. Com várias rotinas no dia, vem a primeira e
   as outras ficam como opção.
3. **Título.** Sugerido a partir da atividade ("Musculação · Push · 55 min"); editável, até 60
   caracteres.
4. **Opcionais.** Duração (1 a 600 min), **legenda pública** (até 500), **observação privada** (até
   500, só a pessoa vê), "Detalhar treino" (§3.4).
5. **Visibilidade.** "Amigos" ou "Só eu", começando no padrão do perfil.
6. **Postar.**

Botão "Foi ontem?" muda o dia para ontem antes de postar.

### 3.2 Regras

- **Dia:** hoje ou ontem, no fuso do perfil (`my_local_today()`); fora disso, recusado (`day_closed`).
- **Quantidade:** sem limite prático de posts por dia (até 10, contra abuso); para meta semanal,
  streak e desafios conta o **dia** com ao menos um check-in.
- **Duração** não pontua.
- **Editar:** título, legenda, observação, visibilidade e detalhe podem ser editados a qualquer
  momento; dia, atividade e foto não (para trocar, apaga e posta de novo).
- **Apagar:** a qualquer momento; some do feed e a foto é apagada. Enquanto o dia está aberto (até o
  fechamento em D+2), a contagem sai junto; depois do fechamento, o dia continua contado e o XP pago
  fica, como na Nutrição.

### 3.3 Foto

- No aparelho: lado maior até 1280 px, JPEG qualidade ~0,8 (WebP onde houver), alvo de até ~400 KB,
  teto de 600 KB; o redesenho em canvas descarta EXIF (GPS, modelo), e um teste confirma com uma
  imagem que tem GPS. Fotos HEIC são convertidas pelo próprio navegador ao desenhar; se o navegador
  não decodificar, mensagem "Não deu para abrir essa foto. Tente pela câmera."
- No Storage: §6.3.
- Sem validação de conteúdo; vale a confiança do grupo.

### 3.4 Detalhar treino

Abre os exercícios da rotina escolhida com carga e repetições da última vez preenchidas; a pessoa
ajusta só o que mudou e confirma. Fica guardado no check-in (`detail`), visível só para ela, e
alimenta o histórico de exercícios do app (as mesmas estruturas que o treino ao vivo grava hoje em
`app_state`, para Stats e progressão continuarem funcionando). Sem rotina (outra atividade), o
detalhe não aparece.

### 3.5 Offline

Fila própria `perf_checkin_outbox_v1` em IndexedDB (a foto é um Blob), por conta, mantida ao sair da
conta, no mesmo motor de recusa e repetição da fila da Nutrição. Ordem de envio: foto, depois a
linha do check-in. No feed, o post próprio aparece como "enviando". Recusa definitiva (`day_closed`)
descarta e avisa uma vez.

### 3.6 Treino ao vivo

Sai do centro da barra. No Plano, cada rotina tem "Fazer check-in" e "Treinar com o app". Ao terminar
o treino ao vivo, o app abre o fluxo de check-in com a rotina e o detalhe já preenchidos, pedindo a
foto. O evento `workout_completed` continua sendo gravado para o histórico, mas a contagem do dia vem
do check-in (§5.2), então nada conta duas vezes. Treino ao vivo encerrado sem foto não gera check-in
e aparece no histórico como antes; o dia só conta com o check-in.

## 4. Social

### 4.1 Feed

- Aba Social abre no feed: check-ins "Amigos" de amigos e todos os check-ins próprios (os "Só eu" com
  cadeado), do mais novo para o mais antigo, 20 por página, fotos sob demanda com skeleton do tamanho
  da foto.
- Post: avatar, nome, tempo relativo; foto; título; legenda; linha de contexto calculada no servidor
  ("3º treino da semana", "streak de 6 semanas"); reações agrupadas; contagem de comentários. Carga,
  séries, detalhe e observação nunca aparecem para outra pessoa.
- Itens antigos (`workout_completed` anteriores a esta fase) continuam como hoje, sem foto.
- Esconder um post só para mim (menu do post).

### 4.2 Reações

- Atalhos 💪 🔥 👏 😂 😮 e seletor com qualquer emoji (um único grafema, até 16 bytes).
- Cada pessoa pode deixar emojis diferentes no mesmo post (até 10); o mesmo emoji duas vezes não.
- Toque duplo na foto alterna 💪.
- Tocar no grupo de reações mostra quem reagiu.

### 4.3 Comentários

- Texto de 1 a 500 caracteres, lista simples por ordem de envio.
- Apaga quem escreveu ou o dono do post. Sem edição, sem respostas em cadeia.

### 4.4 Avisos no app

Reação, comentário no meu post e convite de desafio geram um aviso. O contador da aba Social soma
avisos não lidos e convites pendentes; a lista de avisos fica no topo do Social; abrir marca como
lido. Sem push nesta fase.

### 4.5 Desafios

- **"Dias de treino"** (`checkin_days`): equipe (soma) ou solo (cada um chega a N), 7 a 92 dias, 2 a
  20 pessoas, +300 XP e as conquistas de desafio de sempre. Fecha em `ends_on + 2` (carência de
  fechamento, como o de nutrição).
- O modelo `workouts_count` existente passa a contar dias de treino (dias fechados com check-in ou,
  antes desta fase, com treino concluído) e some da lista de criação, substituído pelo novo.
  `weeks_on_target` e `nutrition_days_on_target` não mudam. `volume_total` sai da lista padrão e
  conta só treinos detalhados.
- Detalhe: placar (dias de treino e posição) e feed do desafio (check-ins dos membros no período;
  "Só eu" aparece como "Check-in privado", sem foto, e conta no placar).

### 4.6 Privacidade

- Perfil: "Visibilidade padrão dos check-ins" (Amigos | Só eu). A coluna `share_activity` vira esse
  padrão (`true` = Amigos).
- Desfazer amizade corta na hora o acesso às fotos e aos posts.
- Denúncia e moderação ficam fora (grupo de amigos); reavaliar ao abrir ao público.

## 5. Pilar Treino e gamificação

### 5.1 Meta e XP

- Meta semanal T = dias com check-in por semana (1 a 7, padrão 3), a coluna `days_per_week` atual.
- XP, no molde de 960 por semana:

| Evento | XP | Limite |
|---|---|---|
| Dia com check-in, até o T-ésimo | `round(600 / T)`, o T-ésimo paga o resto | T por semana |
| Dia com check-in além de T | 25 | 2 por semana |
| Meta semanal batida | +150 | 1 por semana |
| Dia com treino detalhado | 30 | 3 por semana |
| Dia com check-in (foto) | 10 | 1 por dia |

- Eventos novos `server_only`: `training_day`, `training_detailed`; `reason` próprios
  (`training_day`, `training_day_extra`, `training_week_target`, `training_detailed`,
  `training_logged`). O ramo antigo do `award_xp` para `workout_completed` deixa de pagar XP a partir
  da data de corte desta fase (eventos anteriores mantêm o que já pagaram).
- Streak `training_week` e escudos continuam; a semana é avaliada depois de fechar os sete dias.
- Conquistas: as de treinos concluídos passam a contar dias de treino; as de PR continuam e só
  acontecem para quem detalha ou usa o treino ao vivo.
- Radar: o eixo Força passa a se chamar Treino; o valor continua sendo o XP do pilar nas 4 semanas
  fechadas.

### 5.2 Fechamento do dia

`close_training_days(p_user)` fecha os dias pendentes até `local_today − 2`: grava `training_days`
(houve check-in, houve detalhe, houve foto) e emite os eventos. Um dia anterior à data de corte com
`workout_completed` conta como dia com check-in para streak, desafios e métricas, mas não paga XP de
novo. Avaliação preguiçosa em `get_my_progress` e no feed, e cron diário `close-training-days`.

### 5.3 Home e Plano

- Home: cartão **Hoje** (rotina do dia ou "Descanso"; check-in feito com miniatura, ou o botão "Fazer
  check-in"), barra da semana por pilar, radar, cartões da Nutrição.
- Plano: cada rotina com "Fazer check-in" e "Treinar com o app"; **Meus treinos** no cabeçalho do
  Plano abre o calendário (componente da 2b) com fotos, detalhes e observações privadas.
- Celebrações: "Sábado no alvo" vira "Treino de sábado confirmado, +X XP" quando o dia fecha.

## 6. Banco de dados

Migrations depois da `0016`, uma por tarefa de banco. As migrations previstas na spec do Sono
(`0017` a `0021`) são renumeradas quando aquela fase for executada.

### 6.1 Tabelas

```sql
create table public.checkins (
  id           uuid primary key,                       -- gerado no cliente
  user_id      uuid not null references auth.users on delete cascade default auth.uid(),
  day          date not null,
  activity     text not null check (activity in
                 ('strength','run','bike','swim','walk','sport','class','other')),
  routine_id   text check (char_length(routine_id) <= 64),
  routine_name text check (char_length(routine_name) <= 60),
  title        text not null check (char_length(btrim(title)) between 1 and 60),
  caption      text check (char_length(caption) <= 500),
  note         text check (char_length(note) <= 500),  -- privada
  duration_min smallint check (duration_min between 1 and 600),
  visibility   text not null check (visibility in ('friends','private')),
  photo_path   text not null check (photo_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|webp)$'),
  detail       jsonb check (detail is null or octet_length(detail::text) <= 16384),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index checkins_user_day on public.checkins (user_id, day);
create index checkins_feed on public.checkins (created_at desc, id);

create table public.checkin_reactions (
  checkin_id uuid not null references public.checkins on delete cascade,
  user_id    uuid not null references auth.users on delete cascade default auth.uid(),
  emoji      text not null check (octet_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (checkin_id, user_id, emoji)
);

create table public.checkin_comments (
  id         bigint generated always as identity primary key,
  checkin_id uuid not null references public.checkins on delete cascade,
  user_id    uuid not null references auth.users on delete cascade default auth.uid(),
  body       text not null check (char_length(btrim(body)) between 1 and 500),
  created_at timestamptz not null default now()
);

create table public.social_notices (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users on delete cascade,   -- quem recebe
  actor_id   uuid not null references auth.users on delete cascade,
  kind       text not null check (kind in ('reaction','comment','challenge_invite')),
  checkin_id uuid references public.checkins on delete cascade,
  challenge_id uuid,
  created_at timestamptz not null default now(),
  read_at    timestamptz
);

create table public.training_days (
  user_id   uuid not null references auth.users on delete cascade,
  day       date not null,
  checked   boolean not null,
  detailed  boolean not null,
  legacy    boolean not null default false,  -- dia anterior ao corte, contado por workout_completed
  closed_at timestamptz not null default now(),
  primary key (user_id, day)
);

create table public.hidden_checkins (
  user_id    uuid not null references auth.users on delete cascade default auth.uid(),
  checkin_id uuid not null references public.checkins on delete cascade,
  primary key (user_id, checkin_id)
);
```

Perfil: `share_activity` passa a significar "visibilidade padrão Amigos"; a data de corte da fase
fica numa tabela nova `app_settings` (chave e valor; só leitura para o cliente), na chave
`training_checkin_since`, escrita pela migration.

### 6.2 Acesso

- `checkins`: CRUD só do próprio; trigger `security invoker` (só para `authenticated`/`anon`) com
  janela hoje/ontem no insert, dia/atividade/foto imutáveis no update, até 10 por dia, última escrita
  vence por `updated_at`.
- Amigos e membros de desafio leem posts só por funções `security definer`: `get_feed(p_before,
  p_before_id)`, `get_checkin(p_id)`, `get_challenge_feed(p_id, …)`. Nenhuma devolve `note` nem
  `detail`; devolvem `photo_path` só quando quem chama pode ver a foto.
- `can_see_checkin(p_checkin uuid)` e `can_see_checkin_path(p_path text)`: dono, ou amigo com
  visibilidade `friends`. Usadas pelas funções, pelas políticas de reações e comentários e pelo
  Storage.
- `checkin_reactions` e `checkin_comments`: inserir só em post visível; apagar a própria
  reação; apagar o próprio comentário ou qualquer comentário no próprio post. Leitura via
  `get_checkin`.
- `social_notices`: criadas por trigger nas reações, comentários e convites (não para si mesmo);
  select e update de `read_at` só do próprio.
- `training_days`: select do próprio; escrita só do servidor.
- Eventos `training_day` e `training_detailed` são `server_only`.

### 6.3 Storage

- Balde privado `checkins`, `file_size_limit` 600 KB, `allowed_mime_types` `image/jpeg`,
  `image/webp`, criado pela migration.
- Políticas em `storage.objects`: insert e delete só na própria pasta (`(storage.foldername(name))[1]
  = auth.uid()::text`); select quando `public.can_see_checkin_path(name)`.
- O cliente pede `createSignedUrls` (1 hora) só das fotos que vai mostrar e guarda os links em
  memória até expirar.
- Apagar check-in: a fila apaga o objeto e depois a linha. Apagar conta: o cliente remove a pasta
  inteira antes da RPC de exclusão. Contas apagadas pelo painel do Supabase deixam fotos órfãs; o
  SETUP traz a consulta para encontrá-las e o passo para apagá-las pelo painel.

### 6.4 Funções e cron

| Função | Papel |
|---|---|
| `close_training_days(p_user)` | §5.2; chama `close_weeks` da Força para o streak |
| `close_all_training_days()` | cron `close-training-days`, diário |
| `award_xp` | ramo `training_day` / `training_detailed` com §5.1; corte do ramo antigo |
| `get_feed`, `get_checkin`, `get_challenge_feed` | §4 e §6.2 |
| `react_checkin(p_id, p_emoji, p_on)`, `comment_checkin`, `delete_comment` | com checagem de visibilidade |
| `get_notices()`, `mark_notices_read(p_upto)` | §4.4 |
| `challenge_progress`, `create_challenge` | modelo `checkin_days`; `workouts_count` contando dias |
| `achievement_stats`, `progress_card`, `my_progress_extras` | métricas por dias de treino; contexto do post |

Regra de assinaturas e privilégios da spec da Fase 2 (§5.7) vale para todas.

## 7. Cliente

```
src/features/checkin/
  photo.ts            compressão, remoção de metadados, HEIC
  checkin-api.ts      tabelas, Storage, RPCs
  outbox.ts           fila em IndexedDB com Blob
  useCheckins.ts      store por conta
  CheckinFlow.tsx     câmera, atividade, título, opcionais, visibilidade
  DetailSheet.tsx     detalhar treino
  TodayCard.tsx       cartão Hoje da Home
  MyTrainings.tsx     calendário "Meus treinos"
src/features/social/
  FeedPanel.tsx (refeito), PostCard.tsx, Reactions.tsx, EmojiPicker.tsx, Comments.tsx,
  NoticesList.tsx, ChallengeFeed.tsx
```

- TabBar: o botão central abre `CheckinFlow`; o ícone é a câmera.
- O treino ao vivo segue como está (`/workout`), acessível pelo Plano.
- Estados: skeletons com a forma do post e da foto; vazio do feed com "Faça seu primeiro check-in" e
  "Convide amigos"; offline mostra o cache e mantém o check-in na fila.
- Seletor de emoji leve, sem dependência pesada (lista própria de emojis comuns por categoria mais
  campo para colar qualquer emoji).

## 8. Internacionalização e texto público

Regras do `CLAUDE.md`: strings novas nos 16 packs (pt-BR em `PT_BR_OVERRIDES`), sem travessão como
pausa, humanizer, `check-locales` e `check-source-strings --strict`, plurais com `tn()`. Nomes das
atividades são traduzidos; título, legenda, observação e comentários são texto da pessoa.

## 9. Privacidade

`public/privacidade.html` ganha a seção de check-ins: fotos guardadas no Supabase Storage, visíveis
para amigos ou só para a pessoa, metadados removidos antes do envio, observação e detalhe só para a
pessoa, reações e comentários visíveis para quem vê o post, exclusão da foto ao apagar o check-in ou
a conta.

## 10. Testes

- **PGlite:** RLS de todas as tabelas; `note` e `detail` ausentes em toda função que amigos chamam;
  "Só eu" invisível no feed de amigos e como "Check-in privado" no desafio; desfazer amizade corta o
  acesso; reação e comentário só em post visível; apagar comentário (autor e dono do post); janela
  hoje/ontem e campos imutáveis; até 10 por dia; fechamento do dia, XP por T de 1 a 7, limites, dia
  legado sem XP novo, corte do ramo antigo; streak; `checkin_days` e `workouts_count` contando dias;
  avisos; `can_see_checkin_path` com caminhos válidos e forjados; exclusão de conta.
- **Cliente:** `photo.ts` (tamanho, qualidade, imagem com GPS sai sem EXIF, HEIC indisponível);
  fila com Blob (ordem foto→linha, repetição, recusa, mantida ao sair); `CheckinFlow` (rotina do dia
  sugerida, "Foi ontem?", limites de texto); feed (paginação, reações com toque duplo, seletor,
  comentários, esconder); contador do Social; Home e Plano; `MyTrainings`.
- **Smoke manual:** câmera no iPhone (Safari e app instalado) e Android; foto offline que sobe
  depois; dois amigos reagindo e comentando; desafio de dias de treino entre duas contas.

## 11. Riscos

| Risco | Mitigação |
|---|---|
| Foto com localização vazar | redesenho em canvas no aparelho, teste com imagem com GPS |
| Custo e cota do Storage no plano gratuito | fotos de até ~400 KB; medir no grupo; reavaliar ao abrir ao público |
| Observação privada aparecer para amigos | nunca sai das funções `security definer`; teste por função |
| Contagem dupla com o treino ao vivo | o dia conta pelo check-in; `workout_completed` só pesa em dias legados |
| Histórico antigo perder valor | dias legados contam para streak, desafios e métricas, sem XP novo |
| HEIC ou câmera falhar em algum aparelho | galeria como alternativa, mensagem clara, smoke em aparelho real |
| Fotos órfãs ao apagar conta pelo painel | exclusão pelo app limpa a pasta; consulta de limpeza no SETUP |

## 12. Subprojeto 2 (próxima spec)

O Plano como produto: catálogo curado de programas com explicação e referências (volume por músculo,
frequência, faixas de repetição), análise do plano da pessoa contra essas regras com sugestões, e
progresso dos exercícios para quem detalha. Brainstorm próprio depois desta spec aprovada.
