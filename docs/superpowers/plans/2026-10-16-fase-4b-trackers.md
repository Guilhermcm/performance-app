# Fase 4b, Trackers. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a pessoa cria trackers de número, duração ou rótulo, registra valores em qualquer dia até
hoje (um toque para "agora", ou a folha completa com dia, hora e nota), e entende cada tracker em
`/trackers/:id` por um gráfico de 30 ou 90 dias, estatísticas e a lista de registros, tudo offline e
só para ela.

**Architecture:** uma migration (`0031_trackers.sql`) que só cria `trackers` e `tracker_entries`,
com RLS e dois triggers `security invoker` que validam cada escrita (tipo, opções, teto de 30, dia
futuro, arquivado, última escrita vence), no molde do `habits_guard`. Nada é redefinido: trackers
não tocam XP, progresso, feed nem desafios. No cliente, `src/features/trackers/` com regras puras
(`stats.ts`, `format.ts`), fila offline sobre `src/lib/local-outbox.ts`, store por conta com janela
de 90 dias em cache, tela `/trackers`, detalhe `/trackers/:id` e dois gráficos Recharts em chunk sob
demanda, como os do Sono.

**Tech Stack:** Postgres/PGlite, React 19, Vite, Zustand 5, TypeScript, Tailwind v4, shadcn/ui
(Drawer, Skeleton, ToggleGroup se já existir, senão botões), lucide-react, Recharts (já usado pelo
Sono), Vitest + Testing Library. Nenhuma dependência nova.

**Spec:** `docs/superpowers/specs/2026-10-15-fase-4-habitos-trackers-design.md`, **Partes B e C**
(§8, §9, §10 a §15 no que toca a 4b). Molde: o código da 4a (`supabase/migrations/0026_habits_base.sql`,
`src/features/habits/`) e os gráficos do Sono (`src/features/sleep/SleepDurationChart.tsx`,
`chart-data.ts`, `SleepChartSkeleton.tsx`). Regras: `CLAUDE.md`.

## Global Constraints

- Branch `main-f7pdmv`. Commit ao fim de cada tarefa; o controlador faz o push.
- Uma migration, `supabase/migrations/0031_trackers.sql`, publicada em `supabase/release/0031_trackers.sql` sobre um banco com `0001` a `0030`. Nenhuma função existente é redefinida.
- Tracker: `name` de 1 a 40 caracteres sem espaço nas pontas; `icon` da lista fixa dos hábitos (`src/features/habits/icons.ts`); `kind` `number`, `duration` ou `label`, imutável; `unit` (só `number`) de 0 a 12 caracteres; `decimals` (só `number`) de 0 a 2; `aggregate` `sum` ou `avg` (`number` e `duration`), nulo em `label`; `options` (só `label`) de 2 a 8 `{ id, text }` com texto de 1 a 24 caracteres, em ordem; `sort` e `archived_at` como nos hábitos. Teto de **30 ativos** (`too_many_trackers`).
- Registro: `day` (data local), `at` (`HH:MM`, segundos zero), um valor só: `value` (número com as casas do tracker), `minutes` (1 a 1440) ou `option` (id existente). `note` opcional de até 140 caracteres. Qualquer dia até hoje no fuso do perfil (`future_day`); tracker arquivado recusa registro novo (`tracker_archived`) mas aceita editar e apagar os existentes; última escrita vence.
- Opções: renomear, reordenar e acrescentar são livres; remover uma opção com registros é recusado (`option_in_use`).
- Resumo do dia: `sum` ou `avg` dos registros do dia; dia sem registro fica fora da média móvel e das estatísticas. `label`: cada registro conta uma vez para a sua opção. Média móvel de 7 dias = média dos resumos dos dias com registro em `[d − 6, d]`, nula sem registro na janela.
- Privacidade: trackers e registros só da pessoa (RLS por `user_id = auth.uid()`); nada em progresso, feed, cartão de amigo ou desafio. Apagar a conta remove tudo pela cascata e a fila `perf_trackers_outbox_v1` daquela pessoa no aparelho.
- Acesso: sem aba nova; linha **Trackers** no Perfil e atalho "Trackers" no topo de `/habitos`; sem cartão na Home.
- Gráficos pela skill `dataviz` com o validador de cores: um eixo só, pontos ≥ 8 px, dias sem registro em branco (a linha não atravessa o vazio), legenda e rótulo direto, tooltip, descrição em texto, "Ver como tabela", texto nas cores de texto do tema, cor nunca sozinha, `prefers-reduced-motion` sem animação, chunk sob demanda listado em `scripts/sw-on-demand.mjs`, skeleton do mesmo tamanho.
- Toda função ou trigger novo: `security invoker set search_path = public` para regra de cliente; nada de RPC nova (o cliente lê as tabelas por PostgREST com RLS).
- Código novo em TypeScript em `src/features/trackers/`; legado JS só onde a tarefa manda (`App.jsx`, `main.jsx`), com teste ao lado quando houver lógica.
- Texto público (CLAUDE.md): sem travessão nem hífen como pausa; humanizer (`anthropic-skills:humanizer` em pt-BR, `humanizer` em inglês); toda chave nova nos 16 packs de `src/locales/` (pt-BR em `PT_BR_OVERRIDES`) na tarefa que a cria, no fim de cada pack; contagens com `tn()`; nomes de trackers, unidades e opções são da pessoa e não se traduzem; `node scripts/check-locales.mjs` e `node scripts/check-source-strings.mjs --strict` passando.
- UX: mobile-first, alvos ≥ 44 px, Drawer, skeleton com a forma do conteúdo, estados vazio/erro/offline, números em Geist Mono tabular, "hoje" sempre por `todayIn(profile.timezone)`.
- TDD com RED registrado no relatório. Gate de cada tarefa: `npm run typecheck && npm test && npm run build` (e os dois scripts de locale quando houver texto).
- Commits `type: summary` em inglês; toda mensagem termina com as duas linhas abaixo (no plano, "com o trailer"):

```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MXwnuXUfK4Tkf7d2QS2Nx6
```

## Review Focus

1. **Vírgula decimal e casas:** em pt-BR a pessoa digita "1,8" num tracker de 1 casa e o valor salvo é 1.8; com 0 casas, "72,6" vira 73 antes de enviar; "1.234,5" e "abc" são recusados na folha, nunca enviados (Task 2 e Task 5).
2. **Fuso e dia futuro:** em `Asia/Tokyo` às 00:30 local o registro rápido grava o dia local novo; a folha não oferece dia depois de hoje e o servidor recusa `future_day` (Task 1 e Task 5).
3. **Offline e ordem da fila:** tracker criado offline e registrado duas vezes chega ao servidor antes dos registros; registro num tracker que outro aparelho arquivou é recusado (`tracker_archived`), sai da fila e avisa uma vez; trocar de conta não envia a fila da outra conta (Task 3).
4. **Opções de rótulo:** renomear muda o texto em registros antigos (eles guardam o id); reordenar muda a ordem das barras; remover opção sem registro funciona e com registro mostra o aviso de `option_in_use` sem perder a edição do resto (Task 1 e Task 4).
5. **Gráfico com pouco dado:** período só com um registro, só dias vazios, ou média de duração passando de 24 h na soma; a linha não liga dois pontos através de um dia vazio, e a descrição em texto continua certa (Task 7).

## Decisões do plano

Pontos que a spec deixa em aberto, fechados aqui.

1. **Ids do aparelho.** `trackers.id` e `tracker_entries.id` vêm de `crypto.randomUUID()`; criar e
   editar são o mesmo upsert por `id`, como nos hábitos. Id de opção: 8 caracteres `[a-z0-9]`
   (`crypto.randomUUID().replace(/-/g, '').slice(0, 8)`); o servidor checa `^[a-z0-9]{1,16}$` e
   unicidade dentro do tracker.
2. **Valor numérico.** `value numeric(12, 2)` aceita negativo (temperatura, saldo); o trigger recusa
   valor com mais casas que `decimals` (`round(value, decimals) <> value` → `invalid_value`). O
   cliente arredonda para `decimals` antes de enviar.
3. **Última escrita vence** como no `habits_guard`: `updated_at` do cliente limitado a `now()`;
   update mais velho que o atual retorna `null` em silêncio. `created_at` não muda no update.
4. **Delete.** Registro: delete do próprio por RLS (sem guarda de dia). Tracker: sem delete
   (`revoke delete`); arquivar é update.
5. **Janela do cliente.** O store guarda os registros dos **últimos 90 dias** de todos os trackers
   (`day >= hoje − 89`), lidos numa consulta só e salvos em cache; a lista e o detalhe saem dessa
   janela. Último valor mais velho que 90 dias aparece como "Nada nos últimos 90 dias". Registro
   editado em dia anterior à janela não acontece pelo app (a folha não oferece dia antes de
   `hoje − 89`).
6. **Hora do registro rápido.** `at` = hora e minuto locais do momento, por `todayIn` e
   `minutesIn` do fuso do perfil (os mesmos de `src/features/sleep/use-local-now.ts`).
7. **Formato do valor** (`format.ts`): número com `Intl.NumberFormat` do idioma do app e as casas do
   tracker, mais a unidade separada por espaço quando houver ("1,8 L", "72,4 kg", "8.000 passos");
   duração "45 min", "1 h", "1 h 25 min" (horas acima de 24 continuam em horas: "26 h 10 min");
   média de duração arredondada ao minuto; rótulo é o texto da opção. Quando: "hoje", "ontem",
   "há {0} dias" (`tn`). Linha da lista: "{valor} {quando}".
8. **Remover opção no editor.** O botão de remover fica desligado para opção com registro na janela
   de 90 dias (com o motivo em texto); o servidor tem a palavra final (`option_in_use` vira aviso e a
   folha continua aberta com o que foi digitado).
9. **Rotas.** `/trackers` (lista) e `/trackers/:id` (detalhe). Id desconhecido mostra o vazio "Esse
   tracker não existe mais" com link para a lista.
10. **Gráfico de linha.** Série 1: resumo do dia (pontos e segmentos só entre dias consecutivos com
    registro). Série 2: média móvel de 7 dias (linha contínua onde não é nula). Cores: a série 1 usa o
    token de gráfico já validado do Sono; a série 2 é um passo novo `--chart-trend` em `tokens.css`,
    validado claro e escuro contra a série 1 pelo validador. Eixo Y na unidade do tracker (minutos
    formatados em "h min" para duração).
11. **Barras de rótulo.** Uma barra horizontal por opção, na ordem das opções, cor única
    (`--chart-bar`), contagem em texto ao lado; opção sem registro aparece com 0.
12. **Estatísticas** (`stats.ts`): `average`, `min`, `max` dos resumos diários, `daysWithEntries`,
    `daysSinceLast` (0 hoje, 1 ontem, `null` sem registro na janela). Para `label`: contagem por
    opção e a mais frequente.

## Estrutura de arquivos

```
supabase/migrations/0031_trackers.sql                 tabelas, RLS, triggers
supabase/tests/trackers.test.ts                       SQL (PGlite)
supabase/release/0031_trackers.sql                    gerado
src/features/trackers/
  types.ts           Tracker, TrackerKind, TrackerOption, TrackerEntry, Aggregate
  stats.ts           daySummaries, movingAverage, periodStats, labelCounts (puro)
  format.ts          parseNumberInput, formatValue, formatDuration, whenText (puro)
  trackers-api.ts    fetchTrackers, fetchEntries, upsertTracker, updateTrackerSort, upsertEntry, deleteEntry
  storage-keys.ts    TRACKERS_OUTBOX_KEY, TRACKERS_CACHE_KEY
  outbox.ts          trackersOutbox
  sign-out.ts        clearTrackersLocal
  useTrackers.ts     store por conta + startTrackersSync
  TrackerSheet.tsx   criar, editar, arquivar, reativar
  EntrySheet.tsx     registro rápido e folha completa; editar e apagar
  TrackersScreen.tsx lista, arquivados, estados
  TrackerDetail.tsx  período, gráfico, estatísticas, registros, tabela
  TrackerLineChart.tsx, TrackerBars.tsx, TrackerChartSkeleton.tsx (chunks sob demanda)
```

---

### Task 1: Banco: `0031_trackers.sql`

**Files:**
- Create: `supabase/migrations/0031_trackers.sql`, `supabase/tests/trackers.test.ts`
- Modify: `src/lib/database.types.ts` (as duas tabelas)

**Interfaces:**
- Produces: tabelas `public.trackers` e `public.tracker_entries` exatamente como a spec §9.1, mais a
  checagem de `options` e `id` de opção da Decisão 1; erros `P0001` com mensagem `too_many_trackers`,
  `option_in_use`, `item_immutable`, `invalid_options`, `invalid_value`, `future_day`,
  `tracker_archived`, `tracker_not_found`.

- [ ] **Step 1: Testes que falham** em `supabase/tests/trackers.test.ts`, no molde de `supabase/tests/habits-base.test.ts` (duas contas, `my_local_today` com fuso):
  - cria tracker de cada tipo; recusa `label` sem `options`, `number` com `aggregate` nulo, `duration` com `unit`, `decimals` 3, nome com espaço na ponta, ícone `"Bad"`;
  - `options`: 1 opção e 9 opções → `invalid_options`; ids repetidos → `invalid_options`; texto de 25 caracteres → `invalid_options`; id `"A!"` → `invalid_options`;
  - o 31º ativo → `too_many_trackers`; reenviar (upsert) o 30º já ativo não conta como 31º; reativar um arquivado com 30 ativos → `too_many_trackers`;
  - mudar `kind` ou `user_id` → `item_immutable`;
  - remover opção com registro → `option_in_use`; renomear e reordenar com registro funcionam; remover opção sem registro funciona;
  - update com `updated_at` mais velho não muda a linha; `created_at` não muda no update;
  - `delete` em `trackers` negado para `authenticated`;
  - registro: `value` em tracker `duration` → `invalid_value`; dois valores preenchidos → check; `option` inexistente → `invalid_value`; `value` 1.25 com `decimals` 1 → `invalid_value`; `minutes` 0 e 1441 → check;
  - `day` amanhã no fuso do perfil → `future_day`; em `Asia/Tokyo` com relógio às 15:30 UTC o dia local seguinte ao UTC é aceito;
  - tracker de outra conta → `tracker_not_found`; tracker arquivado: registro novo → `tracker_archived`, editar e apagar o existente funcionam;
  - mudar `tracker_id` ou `user_id` do registro → `item_immutable`;
  - RLS: a conta B não lê nem altera trackers e registros da A;
  - apagar o usuário A remove trackers e registros dele (cascata).
- [ ] **Step 2:** `npx vitest run supabase/tests/trackers.test.ts` → FAIL (tabela não existe).
- [ ] **Step 3: Implementar a migration.** Tabelas da spec §9.1; `alter table ... enable row level security`; policies select/insert/update do próprio nas duas e delete do próprio em `tracker_entries`; `revoke delete on public.trackers from authenticated`; `revoke ... from anon`. Triggers `before insert or update`:
  - `trackers_guard()`: imutáveis (`id`, `user_id`, `kind`), `created_at` como no `habits_guard`, última escrita vence, valida `options` (array de 2 a 8 objetos com `id ~ '^[a-z0-9]{1,16}$'` únicos e `text` de 1 a 24 sem espaço nas pontas), teto de 30 com `pg_advisory_xact_lock(hashtextextended('trackers:' || new.user_id::text, 0))` excluindo o próprio id, e `option_in_use` quando um id de `old.options` some de `new.options` e existe registro com ele.
  - `tracker_entries_guard()`: imutáveis (`id`, `tracker_id`, `user_id`), tracker do próprio dono (`tracker_not_found`), `day <= public.my_local_today()` (`future_day`), tracker arquivado só em `INSERT` (`tracker_archived`), valor bate com o `kind` (`number` → `value` com `round(value, decimals) = value`; `duration` → `minutes`; `label` → `option` presente em `options`) senão `invalid_value`, última escrita vence.
- [ ] **Step 4:** teste do Step 1 passa; `npm test` inteiro passa.
- [ ] **Step 5:** acrescentar `trackers` e `tracker_entries` em `src/lib/database.types.ts` no formato das tabelas de hábitos; `npm run typecheck`.
- [ ] **Step 6: Commit** `feat(trackers): trackers and entries tables with RLS and guards` com o trailer.

### Task 2: Regras puras: tipos, estatísticas e formato

**Files:**
- Create: `src/features/trackers/types.ts`, `stats.ts` + `stats.test.ts`, `format.ts` + `format.test.ts`

**Interfaces:**
- Produces:
  - `type TrackerKind = 'number' | 'duration' | 'label'`; `type Aggregate = 'sum' | 'avg'`; `type TrackerOption = { id: string; text: string }`;
  - `type Tracker = { id: string; name: string; icon: string; kind: TrackerKind; unit: string | null; decimals: number | null; aggregate: Aggregate | null; options: TrackerOption[] | null; sort: number; archived_at: string | null; created_at: string; updated_at: string }`;
  - `type TrackerEntry = { id: string; tracker_id: string; day: string; at: string; value: number | null; minutes: number | null; option: string | null; note: string | null; updated_at: string }` (`at` em `HH:MM`);
  - `daySummaries(t: Tracker, entries: TrackerEntry[]): Map<string, { value: number; count: number }>` (só `number`/`duration`; minutos para duração);
  - `movingAverage(summaries: Map<string, { value: number }>, days: string[]): (number | null)[]`;
  - `periodStats(t: Tracker, entries: TrackerEntry[], from: string, to: string, today: string): { average: number | null; min: number | null; max: number | null; daysWithEntries: number; daysSinceLast: number | null }`;
  - `labelCounts(t: Tracker, entries: TrackerEntry[]): { option: TrackerOption; count: number }[]` (na ordem das opções, zeros incluídos);
  - `parseNumberInput(text: string, locale: string, decimals: number): number | null`;
  - `formatValue(t: Tracker, n: number, locale: string): string` (número com unidade, ou duração);
  - `formatDuration(minutes: number): string`;
  - `whenText(day: string, today: string): string` ("hoje", "ontem", "há {0} dias").

- [ ] **Step 1: Testes que falham.**
  - `stats.test.ts`: `sum` de 3 registros no mesmo dia; `avg` de 2 registros; dia sem registro ausente do mapa; média móvel de 7 dias com buraco no meio (só dias com registro entram) e `null` quando a janela está vazia; `periodStats` de 30 dias com 4 dias registrados (`average`, `min`, `max`, `daysWithEntries: 4`); `daysSinceLast` 0, 1, 5 e `null`; `labelCounts` na ordem das opções com uma opção em 0 e um registro de opção renomeada contando no id certo.
  - `format.test.ts`: `parseNumberInput('1,8', 'pt-BR', 1) === 1.8`; `parseNumberInput('72,6', 'pt-BR', 0) === 73`; `parseNumberInput('1.8', 'en', 1) === 1.8`; `parseNumberInput('1.234,5', 'pt-BR', 1) === null`; `parseNumberInput('abc', 'pt-BR', 1) === null`; `parseNumberInput('-3,5', 'pt-BR', 1) === -3.5`; `formatValue` "1,8 L" (pt-BR, 1 casa, unidade L), "8.000 passos", "72,4 kg"; `formatDuration(45) === '45 min'`, `(60) === '1 h'`, `(85) === '1 h 25 min'`, `(1570) === '26 h 10 min'`; `whenText` hoje, ontem, há 3 dias.
- [ ] **Step 2:** `npx vitest run src/features/trackers` → FAIL.
- [ ] **Step 3: Implementar.** Datas em `AAAA-MM-DD` com os helpers de `src/features/nutrition/days` (já usados por hábitos e sono); `parseNumberInput` aceita só um separador decimal do idioma (vírgula em pt-BR, pt e nos packs que usam vírgula, ponto nos demais, pelo `Intl.NumberFormat(locale).formatToParts(1.1)`), sem separador de milhar, arredonda a `decimals`. Textos de `formatDuration` e `whenText` por `t`/`tn` (chaves novas nos 16 packs).
- [ ] **Step 4:** testes passam; locale scripts; gate.
- [ ] **Step 5: Commit** `feat(trackers): pure stats and value formatting` com o trailer.

### Task 3: Dados: API, fila offline e store

**Files:**
- Create: `src/features/trackers/trackers-api.ts` + teste, `storage-keys.ts`, `outbox.ts` + teste, `sign-out.ts` + teste, `useTrackers.ts` + teste
- Modify: `src/App.jsx` (bind e sync como os hábitos), `src/main.jsx` (`clearTrackersLocal` no `SIGNED_OUT`), `src/features/profile/account.ts` (`trackersOutbox.forget(userId)` ao apagar a conta) + teste

**Interfaces:**
- Consumes: tipos da Task 2; `createLocalOutbox` de `src/lib/local-outbox.ts` (com `onRefused`).
- Produces:
  - `trackers-api.ts`: `fetchTrackers(): Promise<Tracker[]>` (ativos e arquivados, por `sort`, `id`); `fetchEntries(from: string): Promise<TrackerEntry[]>` (todos os trackers, `day >= from`); `upsertTracker(t: Tracker)`; `updateTrackerSort(id, sort, updatedAt)`; `upsertEntry(e: TrackerEntry)`; `deleteEntry(id: string)`; `toTrackerError(e: unknown): 'too_many_trackers' | 'option_in_use' | 'tracker_archived' | 'future_day' | 'invalid_value' | 'invalid_options' | null` (no molde de `toHabitError`), usado pelas folhas das Tasks 4 e 5 para o aviso de cada recusa.
  - `storage-keys.ts`: `TRACKERS_OUTBOX_KEY = 'perf_trackers_outbox_v1'`, `TRACKERS_CACHE_KEY = 'perf_trackers_v1'`.
  - `outbox.ts`: `type TrackerOp = { op: 'tracker'; row: Tracker } | { op: 'sort'; id: string; sort: number; updated_at: string } | { op: 'entry'; row: TrackerEntry } | { op: 'delete'; id: string }`; `trackersOutbox`. Um `entry` e um `delete` do mesmo id se substituem (`same`); `tracker` e `sort` nunca colapsam (mesma razão da fila de hábitos).
  - `useTrackers`: estado `{ status: 'idle' | 'loading' | 'ready' | 'error'; trackers: Tracker[]; entries: TrackerEntry[]; from: string; droppedNotice: string | null }`; ações `bind(userId)`, `reset()`, `refresh()`, `active()`, `archived()`, `saveTracker(input: Partial<Tracker> & Pick<Tracker, 'name' | 'icon' | 'kind'>): Tracker`, `archiveTracker(id)`, `reactivateTracker(id)`, `move(id, delta: -1 | 1)`, `saveEntry(input: Omit<TrackerEntry, 'id' | 'updated_at'> & { id?: string }): TrackerEntry`, `deleteEntry(id)`, `entriesOf(trackerId): TrackerEntry[]`, `lastEntryOf(trackerId): TrackerEntry | null`, `dismissDropped()`; `startTrackersSync(): () => void` (puxa no foco, ao reconectar e na virada do dia).

- [ ] **Step 1: Testes que falham**, no molde de `src/features/habits/useHabits.test.ts` e `outbox.test.ts`:
  - `saveTracker` cria com id novo, `sort` no fim, entra na fila e aparece na hora; `saveEntry` arredonda nada (recebe o valor pronto), grava `updated_at` e aparece em `entriesOf`;
  - fila: tracker criado offline, depois dois registros, depois renomeado: a ordem de envio é tracker, registro, registro, tracker; `entry` seguido de `delete` do mesmo id vira só o `delete`;
  - recusa `tracker_archived` ou `future_day` tira o op da fila, a linha some do estado e `droppedNotice` aparece uma vez;
  - pull que chega depois de uma escrita local não a apaga (contador `writes` e sobreposição da fila, como `useHabits`);
  - `bind` de outra conta zera o estado e não envia a fila da conta anterior; `reset` limpa; cache salvo e lido por conta;
  - `refresh` pede `fetchEntries(hoje − 89)` no fuso do perfil;
  - `move` renumera 0..n−1 e envia só `sort` (op `sort`);
  - `clearTrackersLocal` apaga o cache e mantém a fila; apagar a conta chama `trackersOutbox.forget(userId)`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementar** espelhando `src/features/habits/useHabits.ts`, `outbox.ts`, `sign-out.ts` e `habits-api.ts` (mesmos nomes de padrões: `generation`, `writes`, `pullAgain`, `onRefused`).
- [ ] **Step 4:** testes passam; gate.
- [ ] **Step 5: Commit** `feat(trackers): api, offline queue and store` com o trailer.

### Task 4: Folha do tracker (criar, editar, arquivar)

**Files:**
- Create: `src/features/trackers/TrackerSheet.tsx` + teste
- Modify: `src/locales/*.js`

**Interfaces:**
- Consumes: `useTrackers.saveTracker`, `archiveTracker`, `reactivateTracker`, `entriesOf`; `HABIT_ICONS`, `iconOf` de `src/features/habits/icons.ts`.
- Produces: `TrackerSheet({ tracker?: Tracker; open: boolean; onOpenChange(open: boolean): void; onSaved?(t: Tracker): void })`.

- [ ] **Step 1: Testes que falham** (`TrackerSheet.test.tsx`, Drawer mockado como em `HabitSheet.test.tsx`):
  - criar `number`: nome, ícone, unidade "L", 1 casa, "Soma"; salva `{ kind: 'number', unit: 'L', decimals: 1, aggregate: 'sum', options: null }`;
  - criar `duration`: sem unidade e casas; "Média" grava `aggregate: 'avg'`;
  - criar `label`: começa com 2 opções vazias; "Salvar" desligado até as duas terem texto; acrescenta até 8 (o botão some na 8ª); reordena com setas "Mover para cima/baixo"; texto de 24 caracteres no máximo;
  - editar: tipo mostrado e não editável; remover opção com registro na janela fica desligado com o motivo em texto; `option_in_use` do servidor mostra aviso e mantém a folha aberta com o texto digitado;
  - 30 ativos: criar mostra o aviso do teto e não salva;
  - arquivar pede confirmação; arquivado mostra "Reativar".
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementar** no molde de `src/features/habits/HabitSheet.tsx` (mesma grade de ícones, contagem 40/40 no nome, alvos ≥ 44 px). Strings nos 16 packs (humanizer).
- [ ] **Step 4:** locale scripts; gate.
- [ ] **Step 5: Commit** `feat(trackers): create, edit and archive sheet` com o trailer.

### Task 5: Registro rápido e folha do registro

**Files:**
- Create: `src/features/trackers/EntrySheet.tsx` + teste
- Modify: `src/locales/*.js`

**Interfaces:**
- Consumes: `useTrackers.saveEntry`, `deleteEntry`, `lastEntryOf`; `parseNumberInput`, `formatValue`, `formatDuration` (Task 2); `useLocalNow` de `src/features/sleep/use-local-now.ts`.
- Produces: `EntrySheet({ tracker: Tracker; entry?: TrackerEntry; mode: 'quick' | 'full'; open: boolean; onOpenChange(open: boolean): void })`.

- [ ] **Step 1: Testes que falham:**
  - rápido `number`: campo numérico já com o último valor ("1,8" em pt-BR, `inputMode="decimal"`); "Salvar" grava `day` = hoje e `at` = hora local atual no fuso do perfil; "1.234,5" desliga "Salvar" com aviso;
  - rápido `duration`: horas e minutos já com o último valor; 0 h 0 min desliga; 24 h 1 min desliga (máximo 1440);
  - rápido `label`: um botão por opção na ordem; tocar salva na hora e fecha;
  - completa: dia (hoje, ontem e um seletor até `hoje − 89`, nunca depois de hoje), hora `HH:MM`, nota até 140 com contagem;
  - em `Asia/Tokyo`, com relógio em `2026-10-16T15:30:00Z`, o rápido grava `day: '2026-10-17'` e `at: '00:30'`;
  - editar registro existente preenche tudo; "Apagar" pede confirmação e chama `deleteEntry`;
  - tracker arquivado: editar e apagar funcionam; não há "+" (a tela não abre o modo rápido).
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementar.** Arredondamento a `decimals` por `parseNumberInput`; números em Geist Mono tabular. Strings nos 16 packs.
- [ ] **Step 4:** locale scripts; gate.
- [ ] **Step 5: Commit** `feat(trackers): quick entry and entry sheet` com o trailer.

### Task 6: Tela `/trackers` e acessos

**Files:**
- Create: `src/features/trackers/TrackersScreen.tsx` + teste
- Modify: `src/App.jsx` (rotas `/trackers` e `/trackers/:id`, o detalhe da Task 7 entra por `lazy` aqui com um placeholder até lá), `src/features/profile/ProfileScreen.tsx` (linha "Trackers") + teste, `src/features/habits/HabitsScreen.tsx` (atalho "Trackers" no topo) + teste, `src/locales/*.js`

**Interfaces:**
- Consumes: `useTrackers`, `TrackerSheet`, `EntrySheet`, `formatValue`, `whenText`, `iconOf`.
- Produces: `TrackersScreen()`; rota `/trackers/:id` apontando para `TrackerDetail` (default export da Task 7).

- [ ] **Step 1: Testes que falham:**
  - lista ativa em ordem com ícone, nome e "1,8 L hoje" / "72,4 kg há 2 dias" / "bom ontem"; sem registro na janela, "Nada nos últimos 90 dias";
  - "+" abre o `EntrySheet` rápido do tracker; tocar na linha navega para `/trackers/:id`;
  - setas de reordenar (≥ 44 px, sem arrastar) chamam `move`;
  - "Novo tracker" abre `TrackerSheet`; vazio mostra "Crie seu primeiro tracker" com o botão; skeleton enquanto carrega; erro com tentar de novo; offline mostra o cache e mantém "+";
  - seção "Arquivados" recolhida com a contagem; reativar pelo `TrackerSheet`;
  - aviso de registros descartados (`droppedNotice`) aparece uma vez e chama `dismissDropped`;
  - Perfil: linha "Trackers" navega para `/trackers`; `/habitos`: atalho "Trackers" no topo navega para `/trackers`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementar** no molde de `src/features/habits/HabitsScreen.tsx`. Strings nos 16 packs.
- [ ] **Step 4:** locale scripts; gate.
- [ ] **Step 5: Commit** `feat(trackers): trackers screen and entry points` com o trailer.

### Task 7: Detalhe e gráficos

**Files:**
- Create: `src/features/trackers/TrackerDetail.tsx` + teste, `TrackerLineChart.tsx` + teste, `TrackerBars.tsx` + teste, `TrackerChartSkeleton.tsx`
- Modify: `scripts/sw-on-demand.mjs` (`/\/src\/features\/trackers\/Tracker(LineChart|Bars)\.tsx$/`) + `scripts/sw-on-demand.test.mjs`, `src/styles/tokens.css` (`--chart-trend` claro e escuro), `src/App.jsx` (troca o placeholder), `src/locales/*.js`

**Interfaces:**
- Consumes: `daySummaries`, `movingAverage`, `periodStats`, `labelCounts`, `formatValue`, `formatDuration`, `whenText`; `useTrackers.entriesOf`; `EntrySheet`, `TrackerSheet`.
- Produces: `TrackerDetail()` (default export, lê `:id`); `TrackerLineChart({ tracker, days: string[], summaries: (number | null)[], trend: (number | null)[], counts: number[] })`; `TrackerBars({ rows: { option: TrackerOption; count: number }[] })`.

- [ ] **Step 0:** carregar a skill `dataviz`; rodar `node <dataviz>/scripts/validate_palette.js` com a cor da série do Sono e o `--chart-trend` candidato em `--mode light` e `--mode dark`; registrar a saída no relatório e ajustar só `--chart-trend` até passar.
- [ ] **Step 1: Testes que falham:**
  - detalhe: "30 dias" e "90 dias" (padrão 30); estatísticas "Média", "Mínimo", "Máximo", "Dias com registro" e "Último: hoje"; descrição em texto "Média de 1,9 L nos últimos 30 dias, 24 dias com registro" (pt-BR) para `number`/`duration` e "Mais frequente: bom, 12 de 20 registros" para `label`;
  - lista de registros do período por dia, mais recente primeiro, com hora, valor e nota; tocar abre `EntrySheet` completo de edição;
  - "Ver como tabela" mostra uma tabela com dia, resumo e quantos registros (ou opção e contagem para `label`);
  - id desconhecido: "Esse tracker não existe mais" com link para `/trackers`;
  - `TrackerLineChart`: com dias 1, 2, 4 registrados, existem dois segmentos (1→2) e nenhum segmento 2→4; média móvel como segunda série com legenda e rótulo direto; um ponto só desenha o ponto sem linha; tudo vazio mostra a descrição "Nenhum registro nos últimos 30 dias" sem gráfico; duração no eixo em "h min";
  - `TrackerBars`: uma barra por opção na ordem, com a contagem em texto, zeros incluídos;
  - `scripts/sw-on-demand.test.mjs`: os dois módulos entram em `onDemandFiles`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementar** no molde de `SleepDurationChart.tsx`, `chart-data.ts` e `SleepChartSkeleton.tsx` (Recharts, `lazy` + `Suspense` com skeleton do mesmo tamanho, sem animação com `prefers-reduced-motion`, tooltip com data, resumo e contagem). Strings nos 16 packs.
- [ ] **Step 4:** locale scripts; gate.
- [ ] **Step 5: Commit** `feat(trackers): tracker detail with line and bar charts` com o trailer.

### Task 8: Privacidade, publicação e documentação

**Files:**
- Modify: `public/privacidade.html` + `src/lib/privacy-page.test.js`, `scripts/build-release-sql.mjs` + `scripts/build-release-sql.test.mjs`, `supabase/tests/release-bundle.test.ts`, `docs/SETUP.md`, `docs/ROADMAP.md`, spec da Fase 4 (status da 4b)
- Create: `supabase/release/0031_trackers.sql` (gerado)

**Interfaces:**
- Produces: `RELEASES` com `{ name: '0031_trackers', first: 31, last: 31, title: 'migration 0031 (Trackers, phase 4b)', needs: '0001 to 0030' }`; os quatro arquivos antigos continuam idênticos.

- [ ] **Step 1: Testes que falham.**
  - `privacy-page.test.js`: a página cita os Trackers em pt-BR e en (o que é guardado: nome, ícone, tipo, unidade, opções e registros com dia, hora, valor e nota; que só a pessoa vê; que nada vai para amigos, feed ou desafios; que apagar a conta remove tudo); data de atualização nova nas duas línguas; sem travessão como pausa.
  - `build-release-sql.test.mjs`: cinco faixas em ordem; `0031_trackers` com o arquivo `0031`; cabeçalho "already has 0001 to 0030"; arquivo commitado igual ao gerado.
  - `release-bundle.test.ts`: o bundle `0031` aplicado sobre a base com `0001` a `0030` (e os bundles anteriores) cria as duas tabelas com RLS `true`, aceita um tracker e um registro de uma conta e esconde os dois de outra.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementar.** `node scripts/build-release-sql.mjs`; SETUP ganha a seção da 4b no molde da 4a: rodar `supabase/release/0031_trackers.sql` (pode ser antes do merge, sem pressa, porque só cria tabelas), conferir `select relname, relrowsecurity from pg_class where relname in ('trackers','tracker_entries');` com `true` nas duas, `notify pgrst, 'reload schema';` se o app não achar a tabela, e o smoke (criar um tracker de cada tipo, registrar pelo "+", ver o gráfico em 30 e 90 dias). ROADMAP: 4b concluída no código, aguarda o SQL; spec com o status da 4b e ponteiro para as decisões deste plano. Sem credenciais, refs de projeto nem hostnames.
- [ ] **Step 4:** gate.
- [ ] **Step 5: Commit** `docs: privacy, setup and release bundle for trackers` com o trailer.

---

## Ordem e paralelismo

- Task 1 e Task 2 não dividem arquivos: podem correr juntas.
- Task 3 depende da 2 (tipos) e, para o tipo das tabelas, da 1.
- Task 4 e Task 5 dependem da 3 e dividem só os packs de locale: podem correr juntas.
- Task 6 depende da 4 e da 5; Task 7 depende da 6 (rota e placeholder).
- Task 8 depende da 1 (bundle) e pode correr junto com a 6 ou a 7.
