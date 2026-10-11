# Fase 1c, check-in com foto e social. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** trocar o "começar treino" pelo check-in com foto obrigatória (qualquer atividade), com
feed de amigos, reações, comentários, avisos, desafio "Dias de treino" e o pilar Força virando
Treino, alimentado pelos check-ins.

**Architecture:** quatro migrations (`0017` check-ins e Storage, `0018` reações, comentários e
avisos, `0019` dias de treino e XP, `0020` feed e desafios) no estilo da 2a: RLS, funções
`security definer` com `search_path`, triggers `security invoker` só para o cliente, eventos
`server_only`. No cliente, `src/features/checkin/` com a foto (reaproveitando
`src/lib/media-ingest.js`), fila offline em IndexedDB com Blob e o fluxo de check-in aberto pelo
botão central; o Social é refeito em torno do feed.

**Tech Stack:** Postgres/PGlite, Supabase Storage, React 19, Zustand, TypeScript, Tailwind v4,
shadcn/ui. Nenhuma dependência nova.

**Spec:** `docs/superpowers/specs/2026-10-06-checkin-social-design.md` (ler inteira). Contexto:
gamificação em `0002`, `0008`, `0010` a `0012`; social em `0004`, `0006`, `0015`; regra de
assinaturas na spec da Fase 2 §5.7. Regras: `CLAUDE.md`.

## Global Constraints

- Branch `main-f7pdmv`. Commit ao fim de cada tarefa; o controlador faz o push.
- Check-in: foto obrigatória; atividades `strength, run, bike, swim, walk, sport, class, other`; dia hoje ou ontem no fuso do perfil (`day_closed` fora disso); até 10 por dia; título 1 a 60; legenda e observação até 500; duração 1 a 600 min; visibilidade `friends` | `private`; dia, atividade e foto imutáveis; apagar a qualquer momento (a contagem só sai com o dia aberto, até D+2).
- Foto: lado maior 1280 px, alvo ~400 KB, teto 600 KB, JPEG ou WebP, sem metadados; caminho `<user_id>/<checkin_id>.jpg|webp` no balde privado `checkins`; links temporários de 1 hora.
- Privacidade: `note` e `detail` nunca saem para outra conta; "Só eu" nunca mostra foto a outra conta (no desafio aparece como "Check-in privado" e conta no placar); desfazer amizade corta o acesso na hora.
- Reações: qualquer emoji (1 a 16 bytes), até 10 diferentes por pessoa por post, sem repetir o mesmo. Comentários 1 a 500, apaga o autor ou o dono do post.
- Pilar Treino (banco: `strength`): meta T = `days_per_week` (1 a 7, padrão 3); XP por dia com check-in `round(600/T)` até o T-ésimo (o T-ésimo paga o resto), extra 25 (2/semana), meta +150, detalhado 30 (3/semana), dia com check-in 10; fechamento em D+2; dias anteriores à data de corte com `workout_completed` contam (streak, desafios, métricas) sem pagar XP de novo.
- Desafio `checkin_days`: equipe ou solo, 7 a 92 dias, 2 a 20 pessoas, fecha em `ends_on + 2`; `workouts_count` passa a contar dias de treino e sai da lista de criação; `volume_total` sai da lista padrão.
- Toda função nova ou com assinatura nova: `drop` da antiga se mudar; `security definer set search_path = public` (ou `security invoker` em trigger de regra do cliente); internas com `revoke all ... from public, anon, authenticated`; RPC com `revoke ... from public, anon` + `grant execute ... to authenticated`.
- Texto público (CLAUDE.md): sem travessão nem hífen como pausa; humanizer; toda chave nova nos 16 packs (pt-BR em `PT_BR_OVERRIDES`) na tarefa que a cria; plurais com `tn()`; `node scripts/check-locales.mjs` e `node scripts/check-source-strings.mjs --strict` passando.
- UX: mobile-first, alvos ≥ 44 px, Drawer, skeleton com a forma do conteúdo, estados vazio/erro/offline, `prefers-reduced-motion`, nada só por cor, "hoje" por `todayIn(profile.timezone)`.
- TDD com RED registrado no relatório. Commits `type: summary` em inglês, terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Depois de cada tarefa: `npm run typecheck && npm test && npm run build` verdes (e os scripts de locale quando houver texto).

## Review Focus

1. **Observação privada vazando:** toda função que outra conta chama (`get_feed`, `get_checkin`, `get_challenge_feed`, `get_friends`, ranking) nunca devolve `note` nem `detail` (Tasks 1, 2, 4).
2. **Caminho de foto forjado:** `can_see_checkin_path` com caminho de outra pessoa, de check-in "Só eu", de check-in apagado, com `..` ou extensão errada nega acesso (Task 1).
3. **Foto com GPS saindo do aparelho:** imagem de teste com EXIF de GPS sai sem EXIF depois de `preparePhoto` (Task 5).
4. **Check-in offline e troca de conta:** a fila em IndexedDB é por conta; sair e entrar com outra conta não envia a foto da primeira (Task 6).
5. **Cliente antigo entre o SQL e o deploy:** `get_feed`, `join_challenge` e o envio de `workout_completed` continuam funcionando; o SETUP pede para rodar o SQL e fazer o merge em seguida, porque `workout_completed` depois do corte não paga XP de dia (Tasks 3, 4 e 11).
6. **Dia contado duas vezes:** treino ao vivo que termina em check-in e o `workout_completed` do mesmo dia rendem um só dia de treino e um só pagamento (Tasks 3 e 7).

## Decisões

1. **Migrations.** `0017_checkins.sql` (Task 1), `0018_checkin_social.sql` (Task 2),
   `0019_training_days.sql` (Task 3, com o cron guardado como na `0013`), `0020_checkin_feed.sql`
   (Task 4). As da spec do Sono são renumeradas quando aquela fase for executada.
2. **Storage nos testes.** `supabase/tests/helpers/db.ts` ganha no `SHIM` um esqueleto do Storage
   (`storage.buckets(id, name, public, file_size_limit, allowed_mime_types)`,
   `storage.objects(id, bucket_id, name, owner)` com RLS ligado e
   `storage.foldername(name) returns text[]`), suficiente para a migration criar o balde e as
   políticas e para os testes exercitarem as políticas. Em produção esses objetos já existem.
3. **Nomes.** O check-in corporal herdado (`/checkin`, `src/views/CheckIn.jsx`, `CheckInCard`) não
   muda. O novo fluxo é um painel em tela cheia sem rota própria; "Meus treinos" fica em
   `/plan/treinos`. O cartão Hoje da Home evolui o `src/features/home/TodayCard.tsx` existente.
4. **Data de corte.** `app_settings(key text primary key, value jsonb)`, só leitura para o cliente;
   a `0019` grava `training_checkin_since` = data local do dia em que a migration roda
   (`current_date`). A partir dela, `workout_completed` não paga XP de dia (continua pagando PR).
5. **Fila offline.** `src/features/checkin/outbox.ts` com IndexedDB próprio
   (`perf-checkin-outbox`, store `ops`, chave `[userId, id]`), mesmo contrato da fila da Nutrição
   (ordem, recusa definitiva separada de rede, para sem sessão, mantida ao sair). Classificação de
   erro reaproveita `classify` de `src/features/nutrition/nutrition-api.ts` (extraída para
   `src/lib/supabase-errors.ts` com o mesmo comportamento e `day_closed`, `too_many_checkins`,
   `item_immutable`).
6. **Foto.** `preparePhoto(file)` usa `decodeImage` e `encodeImage` de `src/lib/media-ingest.js`
   com lado 1280 e qualidade 0,8; se passar de 600 KB, repete com 0,7 e 0,6; se ainda passar,
   `photo_too_large`.
7. **Detalhe do treino.** `detail` guarda `{ entries: [{ id, sets: [{ w, r, done: true }] }] }`
   e o cliente grava também uma sessão em `S.workouts` no formato de `buildCompletedWorkout`
   (`src/lib/finish-workout.js`) com `id` = id do check-in, para Stats e progressão.

## File Structure

```
supabase/migrations/0017_checkins.sql, 0018_checkin_social.sql, 0019_training_days.sql, 0020_checkin_feed.sql
supabase/tests/checkins.test.ts, checkin-social.test.ts, training-days.test.ts, checkin-feed.test.ts
supabase/tests/helpers/db.ts (Storage), helpers/checkin.ts
src/lib/supabase-errors.ts
src/features/checkin/
  photo.ts           preparePhoto
  outbox.ts          fila IndexedDB
  checkin-api.ts     tabelas, Storage, RPCs
  useCheckins.ts     store por conta
  CheckinFlow.tsx    painel do check-in
  DetailSheet.tsx    detalhar treino
  MyTrainings.tsx    /plan/treinos
  activities.ts      lista e rótulos
src/features/social/ PostCard.tsx, Reactions.tsx, EmojiPicker.tsx, Comments.tsx, NoticesList.tsx,
  ChallengeFeed.tsx, FeedPanel.tsx (refeito), SocialScreen.tsx, templates.ts, labels.ts
src/features/nav/TabBar.tsx, src/features/home/TodayCard.tsx, src/views/Plan.jsx, src/sheets.jsx
src/features/profile/account.ts, ProfileScreen.tsx
scripts/build-release-sql.mjs (faixas), supabase/release/0017-0020_checkin.sql
public/privacidade.html, docs/SETUP.md, docs/ROADMAP.md
```

---

### Task 1: Check-ins e Storage no banco

**Files:** Create `supabase/migrations/0017_checkins.sql`, `supabase/tests/checkins.test.ts`, `supabase/tests/helpers/checkin.ts`; Modify `supabase/tests/helpers/db.ts` (Decisão 2).

**Interfaces:**
- Produces: tabelas `checkins`, `hidden_checkins`, `app_settings` (spec §6.1); `can_see_checkin(p_checkin uuid) returns boolean`, `can_see_checkin_path(p_path text) returns boolean` (internas, `stable`, `security definer`, executáveis por `authenticated` porque as políticas do Storage as chamam); trigger `checkins_guard`; balde `checkins` e políticas em `storage.objects` (spec §6.3); erros `day_closed`, `too_many_checkins`, `item_immutable`.
- Helper de teste: `addCheckin(db, uid, { day?, visibility?, activity?, note?, detail? }) => Promise<string /* id */>`.

- [ ] **Step 1: Testes que falham** (`checkins.test.ts`): insert como cliente em hoje e ontem passa, anteontem `day_closed`; 11º do dia `too_many_checkins`; update de `day`, `activity`, `photo_path` ou `user_id` `item_immutable`; update de título, legenda, nota, visibilidade e detalhe passa; última escrita vence (update com `updated_at` antigo é descartado); B não lê linhas de A em `checkins`; `can_see_checkin` verdadeiro para o dono e para amigo em `friends`, falso para amigo em `private`, para não amigo e depois de desfazer a amizade; `can_see_checkin_path` falso para caminho forjado (pasta de outra pessoa com id inexistente, `..`, extensão `.png`); política do Storage: A insere objeto em `A/<id>.jpg`, falha em `B/<id>.jpg`; B (amigo) faz select do objeto de post `friends` e não do `private`; títulos vazios ou com 61 caracteres recusados; exclusão de conta apaga os check-ins.
- [ ] **Step 2:** rodar `npx vitest run supabase/tests/checkins.test.ts`; FAIL.
- [ ] **Step 3:** implementar a migration e o esqueleto do Storage no `SHIM`.
- [ ] **Step 4:** PASS; gate completo.
- [ ] **Step 5: Commit** `feat(checkin): check-ins table and private photo storage`.

### Task 2: Reações, comentários e avisos no banco

**Files:** Create `supabase/migrations/0018_checkin_social.sql`, `supabase/tests/checkin-social.test.ts`.

**Interfaces:**
- Consumes: `can_see_checkin` (Task 1).
- Produces: tabelas `checkin_reactions`, `checkin_comments`, `social_notices` (spec §6.1); RPCs `react_checkin(p_id uuid, p_emoji text, p_on boolean) returns void`, `comment_checkin(p_id uuid, p_body text) returns bigint`, `delete_comment(p_id bigint) returns void`, `get_checkin(p_id uuid) returns jsonb` (`{id, user{id,name,avatar_url}, day, activity, routine_name, title, caption, duration_min, visibility, photo_path|null, created_at, reactions:[{emoji,count,mine}], comments:[{id,user,body,created_at,can_delete}], note?, detail?}`, com `note` e `detail` só para o dono), `get_notices(p_limit int default 30) returns jsonb`, `mark_notices_read(p_upto bigint) returns void`; triggers que criam avisos de reação, comentário e convite de desafio (`challenge_members` com `status = 'invited'`), nunca para si mesmo.

- [ ] **Step 1: Testes que falham:** reagir e comentar em post visível passa; em post `private` de outro ou de não amigo, recusado; mesmo emoji duas vezes não duplica; 11º emoji diferente recusado; emoji com 17 bytes recusado; remover a própria reação; comentário vazio ou com 501 recusado; autor e dono do post apagam, terceiro não; `get_checkin` como amigo não tem `note` nem `detail` e como dono tem; `get_checkin` de `private` por amigo devolve erro `not_found`; avisos criados para o dono do post (não para quem reage no próprio post); convite de desafio gera aviso; `mark_notices_read` só marca os próprios.
- [ ] **Step 2–4:** FAIL, implementar, PASS; gate.
- [ ] **Step 5: Commit** `feat(social): reactions, comments and notices on check-ins`.

### Task 3: Dias de treino e XP do pilar

**Files:** Create `supabase/migrations/0019_training_days.sql`, `supabase/tests/training-days.test.ts`; Modify `supabase/tests/helpers/game.ts` se precisar de helper de semana.

**Interfaces:**
- Consumes: `checkins` (Task 1); `award_xp` (latest em `0010`), `close_weeks` (`0002`), `achievement_stats` (`0011`), `progress_card` e `my_progress_extras` e `get_my_progress` (`0012`), `session_xp` (`0002`).
- Produces: tabela `training_days` (spec §6.1); `event_kinds` `('strength','training_day',true)`, `('strength','training_detailed',true)`; `close_training_days(p_user uuid) returns integer`; `close_all_training_days() returns integer`; reasons `training_day`, `training_day_extra`, `training_week_target`, `training_detailed`, `training_logged`; `app_settings.training_checkin_since` (Decisão 4); `award_xp` sem pagar dia para `workout_completed` com `occurred_on >= corte`; `close_weeks` passa a reconhecer `training_week_target` além de `week_target`; `achievement_stats.workouts` e `progress_card.week` contando dias de treino; cron `close-training-days` guardado como na `0013`.

- [ ] **Step 1: Testes que falham:** dia com check-in fecha em D+2 com `checked = true`, `detailed` conforme `detail`; XP por T de 1 a 7 (soma de 7 dias com T=3: 200+200+200+150 meta+25+25 extras+10×7 = 870 sem detalhe); detalhado paga 30 até 3 por semana; apagar check-in com o dia aberto tira a contagem; apagar depois do fechamento mantém; dois check-ins no mesmo dia contam um; treino ao vivo com check-in no mesmo dia rende um dia e um pagamento; `workout_completed` antes do corte vira dia `legacy` sem XP novo e conta para o streak; depois do corte, `workout_completed` sozinho não paga dia (PR continua pagando); streak `training_week` com meta paga por `training_week_target`; `progress_card` e `get_friends` sem campo novo de check-in além de contagens; idempotência do fechamento.
- [ ] **Step 2–4:** FAIL, implementar, PASS; gate.
- [ ] **Step 5: Commit** `feat(training): training days from check-ins pay the strength pillar`.

> **Revisão (controlador):** Tasks 1 a 3.

### Task 4: Feed e desafios no banco

**Files:** Create `supabase/migrations/0020_checkin_feed.sql`, `supabase/tests/checkin-feed.test.ts`; Modify `supabase/tests/challenge-rules-parity.test.ts` (novo modelo).

**Interfaces:**
- Consumes: Tasks 1 a 3; `challenge_progress`, `create_challenge`, `challenge_grace`, `close_challenge` (latest em `0015`).
- Produces: `get_checkin_feed(p_before timestamptz default null, p_before_key text default null) returns jsonb` (função nova; `get_feed` antiga fica intacta para o cliente em produção durante o deploy) com itens `{type: 'checkin', key, at, day, user, activity, title, caption, duration_min, visibility, photo_path|null, context, reactions, comments_count}` e `{type: 'workout', key, at, day, user, sets, prs}` para `workout_completed` anteriores ao corte; `next: {before, before_key}`; `context` = `{week_count, streak}`; `get_challenge_feed(p_id uuid, p_before timestamptz default null, p_before_key text default null) returns jsonb`; template `checkin_days` (check constraint, `create_challenge`, `challenge_grace = 2`, `challenge_progress` contando dias de `training_days` com `checked` no período, fechando dias pendentes antes como na nutrição); `workouts_count` contando dias de treino.

- [ ] **Step 1: Testes que falham:** feed de B mostra posts `friends` de A e não `private`; posts próprios `private` aparecem para o dono; nenhum item tem `note` nem `detail`; post escondido (`hidden_checkins`) some só para quem escondeu; paginação estável com chave composta; treino antigo aparece como `type = 'workout'`; desfazer amizade tira os posts; `get_challenge_feed` mostra posts dos membros no período, `private` como `{type:'checkin', private: true}` sem foto, legenda nem título; criação de `checkin_days` válida e inválida (mesmos limites do `workouts_count`); progresso conta dias e não posts; fechamento em `ends_on + 2`; `workouts_count` conta dias.
- [ ] **Step 2–4:** FAIL, implementar, PASS; atualizar a paridade de regras de desafio; gate.
- [ ] **Step 5: Commit** `feat(social): check-in feed and training days challenge`.

### Task 5: Foto e fila offline no cliente

**Files:** Create `src/features/checkin/photo.ts` + teste, `src/features/checkin/outbox.ts` + teste, `src/lib/supabase-errors.ts` + teste; Modify `src/features/nutrition/nutrition-api.ts` (passa a importar `classify` de `supabase-errors`, mesmo comportamento).

**Interfaces:**
- Produces: `preparePhoto(file: File | Blob): Promise<{ blob: Blob; ext: 'jpg' | 'webp'; width: number; height: number }>` (Decisão 6; erros `photo_unreadable`, `photo_too_large`); `classify(e): { refused: boolean; reason?: string }`; fila: `enqueueCheckin(userId, op: CheckinOp)`, `pendingCheckins(userId): Promise<CheckinOp[]>`, `flushCheckins(userId, send: (op) => Promise<void>): Promise<{ sent: number; refused: { id: string; reason: string }[] }>`, `clearCheckinOutbox(userId)`, com `CheckinOp = { kind: 'checkin' | 'checkin_delete'; id: string; row?: CheckinRow; photo?: Blob; ext?: 'jpg' | 'webp' }`.

- [ ] **Step 1: Testes que falham:** `preparePhoto` reduz 4000×3000 para 1280×960; imagem com EXIF de GPS sai sem o marcador EXIF (`0xFFE1`); imagem que não decodifica dá `photo_unreadable`; tentativa de qualidade cai até caber em 600 KB ou dá `photo_too_large`; fila em IndexedDB (`fake-indexeddb` se já houver no projeto; senão um backend em memória injetável, como `media-store-idb.js` faz) guarda Blob, mantém ordem, é por conta, para no primeiro erro de rede, descarta recusa definitiva com o motivo, e repetir é idempotente; `classify` reproduz os casos da Nutrição (teste existente continua passando).
- [ ] **Step 2–4:** FAIL, implementar, PASS; gate.
- [ ] **Step 5: Commit** `feat(checkin): photo preparation and offline queue`.

### Task 6: API e store de check-ins

**Files:** Create `src/features/checkin/checkin-api.ts` + teste, `src/features/checkin/useCheckins.ts` + teste, `src/features/checkin/activities.ts`; Modify `src/features/profile/account.ts` (apagar a pasta antes da RPC), `src/main.jsx` (nada a limpar no SIGNED_OUT: a fila fica; só o cache de links), `src/lib/database.types.ts`, `src/features/social/types.ts`.

**Interfaces:**
- Consumes: Tasks 1, 2, 4, 5.
- Produces: `checkin-api`: `uploadPhoto(userId, id, blob, ext)`, `removePhoto(path)`, `removeAllPhotos(userId)`, `signedUrls(paths: string[]): Promise<Record<string,string>>` (cache em memória até 55 min), `upsertCheckin(row)`, `deleteCheckin(id)`, `fetchMyCheckins(from, to)`, `fetchFeed(cursor?)` (chama `get_checkin_feed`), `fetchCheckin(id)`, `react(id, emoji, on)`, `comment(id, body)`, `deleteComment(id)`, `fetchNotices()`, `markNoticesRead(upto)`, `hideCheckin(id)`, `fetchChallengeFeed(id, cursor?)`. Store `useCheckins`: `mine`, `today`, `feed`, `notices`, `unread`, `post(input: CheckinInput): Promise<string>` (prepara a foto, enfileira, otimista com `pending: true`), `edit(id, patch)`, `remove(id)`, `flush()`, `loadFeed(more?)`, `loadNotices()`, `reset()`; `CheckinInput = { day; activity; routineId?; routineName?; title; caption?; note?; durationMin?; visibility; photo: File | Blob; detail? }`.

- [ ] **Step 1: Testes que falham:** `post` grava otimista e envia foto antes da linha; offline fica `pending` e sobe ao reconectar; `day_closed` descarta e avisa uma vez; editar não troca a foto; apagar remove objeto e linha; troca de conta não mistura filas nem feed; `deleteMyAccount` chama `removeAllPhotos` antes da RPC e falha nele não bloqueia a exclusão; `signedUrls` pede só os caminhos sem cache válido; `unread` soma avisos não lidos e convites pendentes.
- [ ] **Step 2–4:** FAIL, implementar, PASS; gate.
- [ ] **Step 5: Commit** `feat(checkin): check-in api and store`.

> **Revisão (controlador):** Tasks 4 a 6.

### Task 7: Fluxo do check-in, botão central e treino ao vivo

**Files:** Create `src/features/checkin/CheckinFlow.tsx` + teste, `src/features/checkin/DetailSheet.tsx` + teste; Modify `src/features/nav/TabBar.tsx` + teste, `src/sheets.jsx` (fim do treino ao vivo abre o check-in), `src/App.jsx` (monta o painel), `src/locales/*.js`.

**Interfaces:**
- Consumes: `useCheckins.post` (Task 6), `effectiveRoutines` e `effectiveRoutineIds` (`src/lib/…`, já usados pela TabBar), `buildCompletedWorkout` (`src/lib/finish-workout.js`), `ingest` da Decisão 7.
- Produces: `openCheckin(opts?: { routineId?: string; detail?: CheckinDetail; fromWorkout?: string })` (store de UI ou evento) usado pela TabBar, Home, Plano e fim do treino ao vivo; `CheckinDetail = { entries: { id: string; sets: { w: number; r: number; done: true }[] }[] }`.

- [ ] **Step 1: Testes que falham:** botão central com ícone de câmera e rótulo "Check-in" abre o painel; escolher foto (input de arquivo simulado) avança; Musculação e a rotina de hoje vêm marcadas em dia com rotina, a primeira entre várias; título sugerido "Musculação · Push" e editável até 60; "Foi ontem?" muda o dia; visibilidade começa no padrão do perfil (`share_activity`); postar sem foto não é possível; limites de texto com contador; Detalhar abre exercícios da rotina com a última carga e repetições e grava sessão em `S.workouts` com `id` do check-in; fim do treino ao vivo abre o painel com rotina e detalhe preenchidos; sair sem foto não cria check-in; `S.active` em andamento continua acessível pelo Plano (a barra não mostra mais "Retomar").
- [ ] **Step 2–4:** FAIL, implementar, strings nos 16 packs, scripts de locale, PASS; gate.
- [ ] **Step 5: Commit** `feat(checkin): photo check-in from the center button`.

### Task 8: Feed, reações, comentários e avisos no cliente

**Files:** Create `src/features/social/PostCard.tsx`, `Reactions.tsx`, `EmojiPicker.tsx`, `Comments.tsx`, `NoticesList.tsx` + testes; Modify `src/features/social/FeedPanel.tsx` + teste, `SocialScreen.tsx` + teste, `src/App.jsx` (`/social` abre o feed), `src/features/nav/TabBar.tsx` (contador = `unread`), `src/locales/*.js`.

**Interfaces:**
- Consumes: Task 6 (`useCheckins` feed, notices; `checkin-api` react, comment, hide).
- Produces: `PostCard({ item, onOpen })`; `EmojiPicker({ onPick })` com atalhos 💪 🔥 👏 😂 😮, categorias comuns e campo para colar qualquer emoji (validado como um grafema por `Intl.Segmenter`).

- [ ] **Step 1: Testes que falham:** feed mostra foto (link assinado), título, legenda, contexto, reações agrupadas e contagem de comentários; item antigo `workout` como antes; post `private` próprio com cadeado; toque duplo na foto alterna 💪; seletor aceita emoji colado e recusa texto; mais de 10 emojis bloqueado na interface; comentários: enviar, apagar o próprio e no próprio post; esconder post; avisos listados e marcados como lidos; contador da aba Social; paginação "Carregar mais"; skeleton com a forma do post; vazio com "Faça seu primeiro check-in"; abas do Social com Feed primeiro.
- [ ] **Step 2–4:** FAIL, implementar, strings, PASS; gate.
- [ ] **Step 5: Commit** `feat(social): photo feed with reactions, comments and notices`.

### Task 9: Desafio "Dias de treino" no cliente

**Files:** Modify `src/features/social/templates.ts` + teste, `types.ts`, `labels.ts`, `NewChallengeSheet.tsx` + teste, `ChallengeDetail.tsx` + teste; Create `src/features/social/ChallengeFeed.tsx` + teste; `src/locales/*.js`.

**Interfaces:**
- Consumes: Task 4 (`checkin_days`, `get_challenge_feed`), Task 6 (`fetchChallengeFeed`).
- Produces: `TEMPLATES` com `checkin_days` e sem `workouts_count` e `volume_total` na lista de criação (continuam nos tipos e no detalhe); `GRACE.checkin_days = 2`.

- [ ] **Step 1: Testes que falham:** criação abre em "Dias de treino"; faixas de meta iguais às do SQL (teste de paridade existente estendido); detalhe mostra placar (dias de treino e posição) e o feed do desafio; "Check-in privado" sem foto; "Resultado sai em" com a carência; desafio antigo `workouts_count` mostra "Dias de treino" como rótulo.
- [ ] **Step 2–4:** FAIL, implementar, strings, PASS; gate.
- [ ] **Step 5: Commit** `feat(social): training days challenge in the app`.

> **Revisão (controlador):** Tasks 7 a 9.

### Task 10: Home, Plano, "Meus treinos" e pilar Treino

**Files:** Modify `src/features/home/TodayCard.tsx` + teste, `src/views/Plan.jsx` + testes, `src/features/home/PillarRadar.tsx`, rótulos do pilar (`src/features/gamification/*`, `labels`), `src/features/profile/ProfileScreen.tsx` (rótulo de `share_activity` e de `days_per_week`), `src/features/gamification/celebrations.ts`; Create `src/features/checkin/MyTrainings.tsx` + teste, rota `/plan/treinos` em `src/App.jsx`; `src/locales/*.js`.

**Interfaces:**
- Consumes: Tasks 6 e 7 (`openCheckin`, `fetchMyCheckins`), `MonthCalendar` (2b).

- [ ] **Step 1: Testes que falham:** cartão Hoje mostra a rotina do dia ou "Descanso", miniatura e título quando já houve check-in, botão "Fazer check-in" quando não; Plano: cada rotina com "Fazer check-in" (abre com a rotina) e "Treinar com o app"; "Meus treinos" no cabeçalho do Plano abre o calendário com miniaturas, e o dia abre os check-ins com observação privada e detalhe; eixo e rótulos "Treino" no lugar de "Força" (radar, barra da semana, conquistas, perfil); perfil: "Visibilidade padrão dos check-ins" (Amigos | Só eu) e "Dias de treino por semana"; celebração "Treino de sábado confirmado, +X XP".
- [ ] **Step 2–4:** FAIL, implementar, strings, PASS; gate.
- [ ] **Step 5: Commit** `feat(training): today card, plan actions and my trainings`.

### Task 11: Privacidade, documentação e publicação

**Files:** Modify `public/privacidade.html` + `src/lib/privacy-page.test.js`, `docs/SETUP.md`, `docs/ROADMAP.md`, `scripts/build-release-sql.mjs` + teste, spec da 1c (decisões do plano); Create `supabase/release/0017-0020_checkin.sql`; Modify `supabase/tests/release-bundle.test.ts`.

**Interfaces:**
- Produces: `build-release-sql.mjs` com faixas nomeadas (`0007-0016_nutrition`, `0017-0020_checkin`); o arquivo antigo continua idêntico.

- [ ] **Step 1: Testes que falham:** página de privacidade cita fotos de check-in no Storage, visibilidade, remoção de metadados, observação privada e exclusão das fotos, em pt-BR e en; bundle `0017-0020` em dia com as migrations; bundle aplica num banco com `0001` a `0016` e linhas existentes (com o esqueleto do Storage).
- [ ] **Step 2:** SETUP: balde criado pela migration (conferir em Storage), roteiro de `0017` a `0020`, conferências (`get_checkin_feed` existe, RLS de `checkins`, `cron.job` com `close-training-days`, balde `checkins` privado), consulta para fotos órfãs (`storage.objects` do balde sem linha em `checkins`). ROADMAP: 1c concluída. Spec: seção de decisões do plano.
- [ ] **Step 3:** scripts de locale, `npm run typecheck && npm test && npm run build`.
- [ ] **Step 4: Commit** `docs: privacy, setup and release bundle for check-ins`.

> **Revisão final (controlador):** revisor do branch inteiro contra a spec, com foco em produção
> (migrations sobre a base atual, cliente antigo durante o deploy, Storage, privacidade).
