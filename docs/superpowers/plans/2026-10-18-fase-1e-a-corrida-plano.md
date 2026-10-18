# Fase 1e-a, Corrida: questionário, modelos, ritmos e semana híbrida. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a pessoa responde um questionário (meta, prazo, como está hoje, dias), aplica um plano de
corrida montado a partir de modelos prontos, vê cada treino em blocos por zona com a faixa de ritmo e a
semana do Plano com corrida e musculação intercaladas, sem mexer nas rotinas.

**Architecture:** só cliente, sem SQL. Regras puras em `src/features/run/` (`vdot.ts`, `models.ts`,
`fit.ts`), o plano em `S.runPlan` no estado sincronizado (`useStore`, `app_state`), o questionário num
Drawer, a tela `/plan/corrida` e um cartão de corrida por dia na semana de `/plan`.

**Tech Stack:** React 19, Vite, Zustand (`src/store/useStore.js`), TypeScript, Tailwind v4, shadcn/ui
(Drawer, ToggleGroup), lucide-react, Vitest + Testing Library. Nenhuma dependência nova.

**Spec:** `docs/superpowers/specs/2026-10-18-fase-1e-corrida-hibrido-design.md`, §1 a §6, §9 a §14 no
que toca a 1e-a (registro, XP, feed, acompanhamento e sugestões são da 1e-b). Regras: `CLAUDE.md`.

## Global Constraints

- Branch `main-f7pdmv`. Commit ao fim de cada tarefa; o controlador faz o push. Sem migration nesta subetapa.
- Pilar continua Treino (`strength`); nada muda em XP, check-in, feed ou banco.
- Metas: `start`, `5k`, `10k`, `half` (21,0975 km), `maintain`. Tipo de meta (provas): `finish` ou `time`. Prazo: data da prova de hoje + 4 semanas a hoje + 52 semanas, ou número de semanas; `maintain` é ciclo de 8 semanas.
- Referência: `race` (1 a 42,195 km, 3 min a 6 h, últimos 3 meses), `continuous` (1 a 180 min) ou `none`. `time` só com referência `race`.
- VDOT (Daniels e Gilbert, spec §4.1) com uma casa decimal; zonas `easy` 0,59 a 0,74, `moderate` 0,83 a 0,88, `hard` 0,95 a 1,00 do VDOT, `walk` sem ritmo; ritmos arredondados a 5 s, mostrados como faixa "5:40 a 5:55 /km".
- Famílias e dias: `start` 2 ou 3 dias, 8 semanas; `5k` 2 a 4, 8; `10k` 3 ou 4, 10; `half` 3 ou 4, 12; `maintain` 2 a 4, ciclo de 8.
- Progressão: volume de uma semana ≤ 110% da semana anterior que não seja de recuperação; recuperação a cada 4 semanas com 25% menos volume e sem Intervalado; polimento `5k` 1 semana, `10k` e `half` 2 (−40% e −25%); prazo maior acrescenta até 8 semanas de base; prazo menor oferece o prazo mínimo ou a meta de completar (tirando base, nunca específica nem polimento); abaixo de 6 semanas em `10k` e 8 em `half`, só o prazo mínimo.
- Meta de tempo aceita quando o VDOT necessário ≤ VDOT atual + semanas / 4, com teto de +6; senão o app oferece o tempo possível.
- Treino: até 12 itens; item é `{ zone, min }` (1 a 300) ou `{ repeat: 2..20, blocks: [{ zone, min }] }` com até 4 blocos.
- Encaixe (spec §6.2): longão no dia preferido; Ritmo e Intervalado nunca no dia seguinte a dia de perna; nunca dois dias fortes seguidos (Ritmo, Intervalado, dia de perna); dias sem musculação têm preferência; em dia com musculação só Leve ou Corre e caminha; sem encaixe possível, o mais perto e um aviso.
- Dia de perna: mais da metade das séries efetivas da rotina do dia em `quadriceps`, `hamstring` ou `gluteal` (por `loadOfRoutine` de `src/lib/muscles.js`).
- Texto público (CLAUDE.md): sem travessão nem hífen como pausa; humanizer (`anthropic-skills:humanizer` em pt-BR); toda chave nova nos 16 packs de `src/locales/` (pt-BR em `PT_BR_OVERRIDES`) na tarefa que a cria, no fim de cada pack; contagens com `tn()`; os dois scripts de locale passam.
- UX: mobile-first, alvos ≥ 44 px, Drawer, números em Geist Mono tabular, `prefers-reduced-motion`, nada só por cor.
- Código novo em TypeScript em `src/features/run/`; legado JS (`Plan.jsx`, `useStore.js`, `App.jsx`) só onde a tarefa manda, com teste.
- TDD com RED registrado no relatório. Gate: `npm run typecheck && npm test && npm run build` (e os dois scripts de locale quando houver texto).
- Commits `type: summary` em inglês, terminando com o trailer:

```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MXwnuXUfK4Tkf7d2QS2Nx6
```

## Review Focus

1. **Semana do app começa no domingo ou na segunda:** `S.week` usa `getDay()` (0 = domingo) e `S.weekStart` pode ser 0 ou 1; o encaixe, o dia preferido do longão e o cartão do dia batem com a ordem que a pessoa vê (Task 3 e Task 6).
2. **Referência fora do esperado:** 5 km em 15:00 (rápido), 10 km em 1:30:00 (lento), 1 km, maratona inteira, ou "corro 3 min"; VDOT e ritmos continuam números válidos, sem `NaN` nem ritmo negativo, e o modelo não começa acima do que a pessoa aguenta (Task 1 e Task 2).
3. **Semana de musculação lotada:** 6 dias de musculação com 3 corridas; o encaixe não perde treino, põe Leve nos dias com musculação e mostra o aviso (Task 3).
4. **Plano aplicado no meio da semana:** aplicado numa quinta, a primeira semana não marca treino em dia que já passou (Task 4).
5. **Estado antigo ou de outro aparelho:** `S` sem `runPlan` (cliente antigo, outro aparelho) carrega sem erro; um `runPlan` de versão desconhecida não quebra o Plano (Task 4).

## Decisões do plano

Pontos que a spec deixa em aberto, fechados aqui.

1. **Dia da semana.** O plano usa a mesma convenção de `S.week`: `0` = domingo a `6` = sábado
   (`getDay()`). A spec §6.1 dizia "0 = segunda"; este plano corrige para a convenção do app e a spec
   ganha essa nota na Task 6. As semanas do plano começam em `S.weekStart` (via `weekStartOf(S)` de
   `src/lib/format.js`).
2. **Início do plano.** A semana 1 é a semana corrente se, contando de hoje, ainda restam dias suficientes
   para todos os treinos dela; senão é a próxima. Na semana corrente, treinos só em hoje ou depois.
3. **Encaixe guardado.** O encaixe de todas as semanas é feito ao aplicar e guardado em `day`. Mover um
   treino muda só aquela semana. "Reencaixar semanas seguintes" refaz o encaixe das semanas futuras com
   a musculação de agora. Os avisos das regras 2 e 3 são recalculados ao vivo contra o `S.week` atual.
4. **Volume inicial.** Minutos do treino Leve na semana 1 (`E1`): `continuous` → `clamp(X × 0,8, 20, 40)`;
   `race` → 30 (`5k`, `maintain`), 35 (`10k`), 40 (`half`); `none` → só `start`. Longão `L = round(1,3 × E)`.
   Cada semana sem recuperação sobe 8% (arredondado ao minuto), com teto de Leve 50/55/60 e de Longão
   60/80/120 min (`5k`/`10k`/`half`; `maintain` usa os de `5k`).
5. **Fases.** Polimento no fim (provas); do resto, 30% base, 35% construção e o restante específica
   (arredondamentos para a base). Base: só Leve e Longão. Construção: Ritmo `2 × 8` a `3 × 10` moderado com
   2 leve entre; Intervalado `5 × 2` a `6 × 3` forte com 2 leve entre. Específica: `5k` Intervalado
   `5 × 3` a `5 × 4` forte com 3 leve entre; `10k` Ritmo `2 × 12` até `20` contínuo; `half` Ritmo `2 × 15`
   até `30` contínuo. Ritmo e Intervalado: 10 leve antes e 5 a 10 leve depois.
6. **Composição por dias.** 2 dias: Longão e um de qualidade (na base, Longão e Leve). 3 dias: Longão,
   qualidade e Leve. 4 dias: Longão, qualidade e dois Leves. Qualidade alterna Ritmo e Intervalado na
   construção; na específica, o da família.
7. **`start` em 8 semanas** (corre e caminha, em minutos de corrida leve / caminhada):
   S1 `8 × (1 / 2)`, S2 `6 × (2 / 2)`, S3 `5 × (3 / 2)`, S4 `4 × (5 / 2)` (recuperação: `4 × (3 / 2)`),
   S5 `3 × (8 / 2)`, S6 `2 × (12 / 2)`, S7 `20` contínuo + `2 × (5 / 1)`, S8 `30` contínuo. Com 3 dias,
   o terceiro treino repete o do dia com 80% dos minutos.
8. **`maintain`:** 8 semanas, Leve e Longão com `E1` sem subir, Ritmo `2 × 10` moderado uma vez por semana
   a partir da semana 3 (com 3 ou 4 dias), recuperação nas semanas 4 e 8. Ao terminar, recomeça.
9. **Ids.** Treino `id` = `w{semana}-s{posição}`; o plano guarda `version: 1`. Plano de versão
   desconhecida é ignorado com um aviso "Refazer questionário".

## Estrutura de arquivos

```
src/features/run/
  types.ts            RunGoal, GoalType, Reference, Zone, Block, Item, SessionType, Session, Week, RunPlan
  vdot.ts             vdotFrom, velocityAt, zonePaces, predictMinutes, requiredVdot, formatPace (puro)
  models.ts           FAMILIES, buildPlan, checkAnswers (puro)
  fit.ts              legDays, fitWeek, moveWarnings (puro)
  run-actions.ts      applyRunPlan, moveSession, refitFuture, endRunPlan (mutações de S)
  labels.ts           nomes e textos das zonas, treinos e metas
  RunQuestionnaire.tsx, RunPlanScreen.tsx, RunDayCard.tsx, SessionBlocks.tsx
```

---

### Task 1: Ritmos (VDOT)

**Files:**
- Create: `src/features/run/types.ts`, `src/features/run/vdot.ts` + `vdot.test.ts`

**Interfaces:**
- Produces:
  - `type Zone = 'easy' | 'moderate' | 'hard' | 'walk'`;
  - `vdotFrom(distanceM: number, minutes: number): number` (uma casa);
  - `velocityAt(vdot: number, fraction: number): number` (m/min, raiz positiva de `-4.60 + 0.182258·v + 0.000104·v² = fraction·vdot`);
  - `zonePaces(vdot: number): Record<'easy' | 'moderate' | 'hard', { fast: number; slow: number }>` (segundos por km, arredondados a 5 s; `fast` = fração maior);
  - `predictMinutes(vdot: number, distanceM: number): number` (bisseção em 1 a 600 min, tolerância de 1 s);
  - `requiredVdot(distanceM: number, minutes: number): number` (= `vdotFrom`);
  - `formatPace(secPerKm: number): string` ("5:40") e `formatPaceRange(r): string` ("5:40 a 5:55 /km", texto por `t`).

- [ ] **Step 1: Testes que falham** (`vdot.test.ts`):
  - `vdotFrom(5000, 20) ≈ 49.8`, `vdotFrom(5000, 25) ≈ 38.3`, `vdotFrom(5000, 30) ≈ 30.8` (± 0,2);
  - `predictMinutes(50, 5000)` em 19:57 ± 3 s; `predictMinutes(40, 10000)` em 50:03 ± 10 s; `predictMinutes(60, 5000)` em 17:03 ± 3 s;
  - `zonePaces(50).easy` com `slow` entre 5:25 e 5:40 e `fast` entre 4:55 e 5:10; `zonePaces(50).hard.fast` entre 3:55 e 4:05; valores múltiplos de 5 s;
  - limites (Review Focus 2): `vdotFrom(1000, 3)`, `vdotFrom(42195, 360)` e `vdotFrom(5000, 15)` dão números finitos e positivos; `zonePaces` de cada um sem `NaN` e com `fast < slow`;
  - `formatPace(340) === '5:40'`; `formatPaceRange({ fast: 340, slow: 355 })` em pt-BR `'5:40 a 5:55 /km'`.
- [ ] **Step 2:** `npx vitest run src/features/run/vdot.test.ts` → FAIL.
- [ ] **Step 3: Implementar.** Fórmulas da spec §4.1 a §4.3; tipos do plano em `types.ts` (os de `Item`, `Session`, `Week` e `RunPlan` conforme spec §5.2 e §6.1, com `day` de 0 = domingo). Chave nova "{0} a {1} /km" nos 16 packs.
- [ ] **Step 4:** testes passam; locale scripts; gate.
- [ ] **Step 5: Commit** `feat(run): vdot paces and race prediction` com o trailer.

### Task 2: Modelos e montagem do plano

**Files:**
- Create: `src/features/run/models.ts` + `models.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `type Answers = { goal; goalType?; targetMinutes?; raceDate?; weeks?; reference: { kind: 'race'; distanceM; minutes; date } | { kind: 'continuous'; minutes } | { kind: 'none' }; days: 2 | 3 | 4; longDay: 0..6 }`;
  - `checkAnswers(a: Answers, today: string): { ok: true; weeks: number } | { ok: false; reason: 'too_short' | 'time_out_of_reach' | 'days_not_allowed' | 'reference_too_old'; minWeeks?: number; possibleMinutes?: number; finishWeeks?: number }`;
  - `buildPlan(a: Answers, today: string, vdot: number | null): { weeks: Week[] }` (sem `day`; o encaixe é da Task 3), cada `Week` com `index`, `phase: 'base' | 'build' | 'specific' | 'taper'`, `recovery: boolean` e `sessions: { id, type, blocks }[]`;
  - `weekMinutes(w: Week): number`.

- [ ] **Step 1: Testes que falham** (`models.test.ts`), para cada família e cada variante de dias:
  - número de treinos por semana igual a `days`; Longão presente (menos `start`); ids `w{n}-s{k}`;
  - progressão: `weekMinutes(semana) ≤ 1,10 × weekMinutes(última semana sem recuperação anterior)`;
  - recuperação a cada 4 semanas com ≈ 75% do volume da anterior e sem Intervalado;
  - polimento: 1 semana em `5k`, 2 em `10k`/`half`, com −40% e −25%;
  - prazo 4 semanas acima do mínimo → 4 semanas de base a mais; prazo 20 semanas acima → 8 a mais e o resto adiado (a montagem retorna só as semanas do plano);
  - `checkAnswers`: `10k` com 5 semanas → `too_short` sem `finishWeeks`; `half` com 10 semanas → `too_short` com `finishWeeks: 10`; meta `10k` em 40:00 com VDOT 38 e 10 semanas → `time_out_of_reach` com `possibleMinutes` coerente com `VDOT + 2,5`; referência de 4 meses atrás → `reference_too_old`; `10k` com 2 dias → `days_not_allowed`;
  - `start`: as 8 semanas da Decisão 7; com `continuous` de 25 min, começa na semana em que o bloco contínuo mais longo ≥ 15 min (semana 6);
  - `maintain`: 8 semanas, recuperação em 4 e 8, Ritmo a partir da 3;
  - limites (Review Focus 2): `continuous` de 3 min em `5k` → Leve de 20 min na semana 1; nenhum bloco fora de 1 a 300 min; nenhum treino com mais de 12 itens.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementar** pelas Decisões 4 a 8 e a spec §5.
- [ ] **Step 4:** testes passam; gate.
- [ ] **Step 5: Commit** `feat(run): running plan models and builder` com o trailer.

### Task 3: Encaixe na semana híbrida

**Files:**
- Create: `src/features/run/fit.ts` + `fit.test.ts`

**Interfaces:**
- Consumes: Task 2 (`Session`, `SessionType`); `loadOfRoutine` de `src/lib/muscles.js`; rotinas `{ id, ex: [{ id, sets }] }` e `S.week: Record<number, string[]>`.
- Produces:
  - `legDays(week: Record<number, string[]>, routines: Routine[]): Set<number>`;
  - `fitWeek(sessions: { id; type }[], ctx: { week; routines; longDay: number; allowedDays?: number[] }): { placement: Record<string, number>; warnings: Record<string, FitWarning[]> }`;
  - `type FitWarning = 'after_leg_day' | 'hard_in_a_row' | 'shared_with_strength_hard'`;
  - `moveWarnings(sessionId, day, placement, sessions, ctx): FitWarning[]`.

- [ ] **Step 1: Testes que falham** (`fit.test.ts`), com rotinas de exemplo (perna, superiores, full body):
  - `legDays`: rotina com 60% das séries em quadríceps/posterior/glúteo é dia de perna; 50% não é; dia com duas rotinas soma as séries;
  - semana com perna na segunda, superiores na quarta e sexta, 3 corridas (Longão, Intervalado, Leve), longão no domingo: Longão no domingo, Intervalado nunca na terça, nenhum par de fortes seguidos, Leve preferindo dia livre;
  - 6 dias de musculação e 3 corridas (Review Focus 3): os 3 treinos encaixados, os de qualidade convertidos em aviso `shared_with_strength_hard` quando inevitável, nenhum treino perdido;
  - `allowedDays` (semana corrente a partir de quinta): nenhum treino antes de hoje;
  - semana em que `S.weekStart` é 0 e outra em que é 1: o mesmo resultado em dias (o encaixe trabalha em dias da semana, não em posições);
  - `moveWarnings`: mover o Intervalado para o dia depois de perna → `['after_leg_day']`; para um dia livre longe de fortes → `[]`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementar** com as regras da spec §6.2 em ordem; empate resolvido pelo dia mais distante do forte mais próximo, depois pelo menor dia na ordem da semana.
- [ ] **Step 4:** testes passam; gate.
- [ ] **Step 5: Commit** `feat(run): fit running sessions around strength days` com o trailer.

### Task 4: Plano no estado e ações

**Files:**
- Create: `src/features/run/run-actions.ts` + `run-actions.test.ts`, `src/features/run/labels.ts` + teste
- Modify: `src/store/useStore.js` (`DEF.runPlan = null`) + teste do carregamento, `src/locales/*.js`

**Interfaces:**
- Consumes: Tasks 1 a 3; `useStore` (`update(S => ...)`), `weekStartOf(S)`/`weekOrder` de `src/lib/format.js`.
- Produces:
  - `applyRunPlan(S, answers: Answers, today: string): RunPlan` (calcula VDOT da referência `race`, monta, encaixa todas as semanas, grava `S.runPlan`);
  - `moveSession(S, weekIndex: number, sessionId: string, day: number): void`;
  - `refitFuture(S, today: string): void`;
  - `endRunPlan(S): void`;
  - `currentWeek(plan: RunPlan, today: string, weekStart: 0 | 1): Week | null`;
  - `sessionsOn(plan, isoDay: string, weekStart): Session[]`;
  - `labels.ts`: `zoneName(z)`, `zoneFeel(z)`, `sessionName(type)`, `goalName(goal)`, `itemText(item)` ("4 × 4 min forte, 2 min leve").

- [ ] **Step 1: Testes que falham:**
  - `applyRunPlan` numa segunda: semana 1 = semana corrente; numa quinta com 3 treinos e só 3 dias restantes (quinta, sexta, sábado em semana começando no domingo): semana 1 começa hoje e nada antes de hoje; numa sexta sem dias suficientes: semana 1 = próxima (Review Focus 4);
  - `S.week` e `S.routines` iguais antes e depois de `applyRunPlan` (spec §1, "sem mexer nas rotinas");
  - `moveSession` muda só aquela semana; `refitFuture` refaz as semanas depois de hoje e mantém as passadas;
  - `endRunPlan` apaga `S.runPlan` e não mexe em `S.week`;
  - `loadState` com um `S` salvo sem `runPlan` dá `runPlan: null`; com `runPlan.version = 99` o app não quebra e `currentWeek` devolve `null` (Review Focus 5);
  - `sessionsOn` acha o treino do dia pela data e pelo `weekStart`;
  - `labels`: pt-BR "Leve", "Moderado", "Forte", "Caminhada", "dá para conversar", "só frases curtas", "só poucas palavras"; `itemText` de uma repetição.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementar.** Mutações usadas dentro de `update(S => ...)`. Strings nos 16 packs (humanizer).
- [ ] **Step 4:** locale scripts; gate.
- [ ] **Step 5: Commit** `feat(run): running plan state and actions` com o trailer.

### Task 5: Questionário

**Files:**
- Create: `src/features/run/RunQuestionnaire.tsx` + teste
- Modify: `src/locales/*.js`

**Interfaces:**
- Consumes: `checkAnswers`, `buildPlan` (prévia), `applyRunPlan`, `predictMinutes`, `vdotFrom`, `labels`.
- Produces: `RunQuestionnaire({ open: boolean; onOpenChange(open: boolean): void; initial?: Answers })`.

- [ ] **Step 1: Testes que falham** (Drawer mockado como em `src/features/habits/HabitSheet.test.tsx`):
  - os cinco passos com voltar e avançar; `maintain` pula tipo de meta e prazo; `start` pula tipo de meta;
  - `time` só aparece com referência `race`; sem ela, o texto explica que o tempo-alvo fica disponível depois de uma corrida com distância;
  - prazo: data abaixo de hoje + 4 semanas ou acima de + 52 desliga "Avançar" com o motivo;
  - `too_short`: mostra as duas saídas (prazo mínimo com a nova data, meta de completar) ou só o prazo mínimo; escolher uma aplica a resposta;
  - `time_out_of_reach`: mostra "Seu ritmo de hoje dá cerca de {tempo}" e oferece usar o tempo possível;
  - `reference_too_old`: pede outra referência ou seguir sem ritmo;
  - dias: só os permitidos pela meta (`10k` sem o 2);
  - "Criar plano" chama `applyRunPlan` dentro de `update` e fecha; com `initial`, os campos vêm preenchidos e "Refazer" pede confirmação antes de substituir.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementar** com `Drawer`, `ToggleGroup` e o estilo de `src/features/profile/Onboarding.tsx` (passos, `Progress`, `useReducedMotion`). Tempo em `h:mm:ss` com validação; distância com vírgula pelo `dateLocale()`. Strings nos 16 packs (humanizer).
- [ ] **Step 4:** locale scripts; gate.
- [ ] **Step 5: Commit** `feat(run): running plan questionnaire` com o trailer.

### Task 6: Tela do plano, cartão do dia e documentação

**Files:**
- Create: `src/features/run/RunPlanScreen.tsx` + teste, `src/features/run/RunDayCard.tsx` + teste, `src/features/run/SessionBlocks.tsx`
- Modify: `src/App.jsx` (rota `/plan/corrida`), `src/views/Plan.jsx` (cartão por dia na "Week schedule" e "Montar plano de corrida") + teste, `src/locales/*.js`, `docs/ROADMAP.md` (1e-a concluída no código), spec da 1e (status e nota da Decisão 1)

**Interfaces:**
- Consumes: Tasks 1 a 5; `useProfile(s => s.profile?.days_per_week)` e `useProfile.getState().save({ days_per_week })`.
- Produces: `RunPlanScreen()`, `RunDayCard({ day: number; iso: string })`, `SessionBlocks({ session; vdot })`.

- [ ] **Step 1: Testes que falham:**
  - `/plan` sem plano mostra "Montar plano de corrida", que abre o questionário;
  - com plano, cada dia da semana corrente mostra a rotina de musculação (como hoje) e o cartão do treino: nome do tipo, blocos em linha ("10 leve + 4 × 4 forte + 10 leve") e faixas de ritmo quando há VDOT; sem VDOT, só a sensação;
  - aviso de encaixe em texto no cartão quando a regra 2 ou 3 é quebrada pelo `S.week` atual;
  - mover: o cartão tem "Mudar de dia", com os dias da semana e o aviso prévio de `moveWarnings`;
  - `/plan/corrida`: meta e prazo, fases, lista de semanas com a atual em destaque, ritmos por zona com a data da referência, previsão de prova ("seu ritmo de hoje dá cerca de 55:30 nos 10 km"), "Reencaixar semanas seguintes", "Refazer questionário" e "Encerrar plano" (com confirmação);
  - ao aplicar, se o número de dias diferentes da semana ≠ `days_per_week`, o app oferece atualizar a meta e chama `save({ days_per_week })` só com o toque;
  - semana começando no domingo e na segunda (Review Focus 1): o cartão aparece no dia certo;
  - plano de versão desconhecida: `/plan/corrida` mostra "Refazer questionário".
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementar.** Extrair um `DayRow` em `Plan.jsx` só se for preciso para o teste; manter o resto da tela igual. Strings nos 16 packs (humanizer). ROADMAP: 1e-a concluída no código; spec: status e "dia da semana segue `getDay()`, 0 = domingo".
- [ ] **Step 4:** locale scripts; gate.
- [ ] **Step 5: Commit** `feat(run): running plan screen and day cards` com o trailer.

---

## Ordem e paralelismo

- Task 1 → Task 2 (consome `vdot`); Task 3 só consome tipos e pode correr junto com a 2 depois da 1.
- Task 4 depende de 1, 2 e 3. Task 5 depende da 4. Task 6 depende da 5 (abre o questionário).
