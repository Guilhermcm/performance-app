# Fase 1d: Plano com evidência Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Catálogo de 7 programas que vira o plano da semana, análise do plano por objetivo com sugestões de um toque, progresso dos exercícios e referências em ⓘ.

**Architecture:** Tudo no cliente. Conteúdo (programas, referências, exercícios padrão) e regras (análise, sugestões) são módulos TypeScript puros em `src/features/plan/`; as telas leem o estado `S` existente (sincronizado como blob) e `profiles.goal`. Nenhuma migration, nenhuma mudança no servidor.

**Tech Stack:** React 19, Vite, Zustand, TypeScript, Radix (Popover, já instalado via `radix-ui`), vaul (`Drawer`), Recharts (via `src/components/ui/chart.tsx`), vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-12-fase-1d-plano-evidencia-design.md`

## Global Constraints

- Sem migration, sem RLS, sem função SQL nova; nada novo no servidor.
- Código novo em TypeScript em `src/features/plan/` e `src/components/ui/`; legado (`src/lib/*.js`, `src/views/*.jsx`, `src/sheets.jsx`) só muda com teste ao lado.
- Toda string que a pessoa lê passa por `t('...')` com o texto literal dentro da chamada (o `check-source-strings` só acha assim) e entra nos 16 pacotes de `src/locales/` (pt-BR em `PT_BR_OVERRIDES`).
- Sem travessão nem hífen usado como pausa (`—`, `–`, ` - `) em texto público; `node scripts/check-locales.mjs` e `node scripts/check-source-strings.mjs --strict` passam.
- Nomes de rotina criados por programa: inglês canônico com prefixo do programa, separador ` · ` (ex.: `PPL · Push`), não traduzidos.
- Objetivo: `profiles.goal` → perfil `hypertrophy` (goal `hypertrophy` ou vazio), `strength` (`strength`), `health` (`fat_loss`, `conditioning`).
- Contagem de séries da análise: músculo com peso 1 em `musclesOf(ex)` conta 1; qualquer outro peso maior que 0 conta 0,5. `musclesOf` não muda.
- Faixas semanais (séries fracionadas): hypertrophy 10 a 20; strength 6 a 12; health 4 a 10.
- Frequência: dia conta para o grupo com pelo menos 2 séries fracionadas; alerta de frequência só no perfil hypertrophy (menos de 2 dias).
- Equilíbrio: alerta quando o lado menor tem menos de 2/3 do maior; a tela não mostra o número.
- Tempo por rotina: soma de séries × (descanso + 40 s) + 300 s; descanso = `restSec` do exercício ou 90 s. Alerta acima de 75 min.
- Gate antes de cada commit: `npm test`, `npm run typecheck`, `npm run build`, os dois scripts de locale.
- Commits: `type: summary` em inglês, terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` e `Claude-Session: https://claude.ai/code/session_01MXwnuXUfK4Tkf7d2QS2Nx6`.

## Review Focus

1. **Rotina em dois dias e rotina apagada:** uma rotina na agenda de seg e qui conta duas vezes no volume e na frequência; um id na agenda sem rotina correspondente é ignorado sem erro (Task 4).
2. **Perfil de equipamento sem barra:** aplicar um programa troca cada exercício de barra pela primeira alternativa disponível; sem alternativa disponível, mantém o principal e o detalhe avisa (Task 2).
3. **Desfazer depois de treinar:** rotina do programa que já tem treino em `S.workouts` fica na lista ao desfazer, só sai da agenda (Task 2).
4. **Troca de unidade e detalhe antigo:** detalhe em kg ingerido com `S.unit = 'lb'` converte uma vez; detalhe sem `unit` não converte; reingerir o mesmo detalhe não converte de novo (Task 7).
5. **Número sem fonte:** um teste percorre todo número de recomendação (faixas, frequência, descanso, repetições dos programas) e falha se algum não apontar para uma referência existente (Task 1 e Task 2).

## Decisões do plano

1. **Conferência do conteúdo (§7.3 da spec).** O plano não espera a conferência humana para começar: a Task 1 grava o checklist em `docs/fontes-1d.md` e o conteúdo entra como está na spec. As linhas "o que o estudo achou" usam só fatos sem número além dos que constam no resumo verificado: nada de tamanho de efeito. A pessoa que revisar o PR confere o checklist antes do merge.
2. **Equilíbrio sem fonte confirmada.** O ⓘ do equilíbrio usa a entrada especial `rule-of-thumb` (não é referência; texto "Regra prática de montagem de treino, sem número de estudo") até a conferência confirmar o ACSM 2009.
3. **Entrada dos programas.** Uma rota `/plan/programas` (lista e sugerido) e `/plan/programas/:id` (detalhe). `starterPlanSheet` some; quem chamava (Plan.jsx, Settings.jsx, HomeCards.tsx) navega para `/plan/programas`.
4. **Estado do programa aplicado:** `S.program = { id, variant, appliedAt, routineIds, prevWeek, dismissed }`; `dismissed: true` esconde a faixa. Editar qualquer rotina ou a agenda também esconde (o `update` do Plano marca `dismissed`).
5. **Estado da última sugestão aplicada** fica só na memória da tela (não sincroniza): `Desfazer` vale enquanto a tela está aberta.
6. **Gráfico da análise:** barras horizontais por grupo, faixa recomendada como banda neutra, valor em texto ao lado; validação da paleta com `validate_palette.js` da skill `dataviz` em claro e escuro, e uma tabela alternativa ("Ver como tabela").

## File Structure

```
src/features/plan/
  references.ts          REFS (12 entradas), RefId, RULE_OF_THUMB, refLine(id) -> string (t())
  references.test.ts
  programs.ts            PROGRAMS (7), Program, Slot, buildProgram, applyProgram, undoProgram, programRoutines
  programs.test.ts
  suggest-program.ts     suggestProgram (substitui src/features/profile/starter-suggest.ts)
  suggest-program.test.ts
  goal.ts                profileOf(goal) -> AnalysisProfile, RANGES
  time.ts                estimateMinutes(routine)
  analysis.ts            analyzePlan, GROUP_OF, BIG_GROUPS
  analysis.test.ts
  suggestions.ts         suggestionsFor, applySuggestion, DEFAULT_EXERCISES
  suggestions.test.ts
  program-copy.tsx       textos dos programas em t() (nome, para quem, o que esperar, por que)
  ProgramsScreen.tsx     /plan/programas
  ProgramDetail.tsx      /plan/programas/:id
  ProgramBanner.tsx      faixa no Plano
  AnalysisCard.tsx       cartão no Plano
  AnalysisScreen.tsx     /plan/analise
  ExerciseProgress.tsx   folha de progresso de um exercício
  LoadUpBadge.tsx        selo "Suba a carga"
  (+ .test.tsx de cada tela)
src/components/ui/info-source.tsx (+ test)
docs/fontes-1d.md        checklist da conferência
src/lib/starter.js, src/features/profile/starter-suggest.ts  saem
```

---

### Task 1: Referências e o ⓘ

**Files:**
- Create: `src/features/plan/references.ts`, `src/features/plan/references.test.ts`, `src/components/ui/info-source.tsx`, `src/components/ui/info-source.test.tsx`, `docs/fontes-1d.md`
- Modify: `src/locales/*.js`

**Interfaces:**
- Produces: `type RefId = 'schoenfeld2017' | 'schoenfeld2016' | 'pelland2025' | 'acsm2009' | 'who2020' | 'ralston2017' | 'schoenfeld2016rest' | 'schoenfeld2021' | 'grgic2018freq' | 'plotkin2022' | 'iversen2021' | 'grgic2018rest'`; `type Ref = { id: RefId; authors: string; year: number; title: string; journal: string; doi: string }`; `REFS: Record<RefId, Ref>`; `RULE_OF_THUMB = 'rule-of-thumb'`; `type SourceId = RefId | typeof RULE_OF_THUMB`; `refFinding(id: SourceId): string` (texto em `t()`); componente `<InfoSource refs={SourceId[]} label?: string />`.

- [ ] **Step 1: Testes que falham** (`references.test.ts`): as 12 entradas existem com os DOIs da tabela §7.1 da spec, exatamente; todo `doi` casa `/^10\.\d{4,9}\/\S+$/`; `refFinding` devolve texto não vazio para cada id e para `rule-of-thumb`; nenhuma linha tem travessão. (`info-source.test.tsx`): botão com nome acessível "Ver fonte"; clicar abre e mostra autores, ano, título e um link `https://doi.org/<doi>` com `target="_blank"` e `rel="noopener noreferrer"`; Esc fecha e o foco volta ao botão; clicar fora fecha; com `window.innerWidth = 375` abre como folha (Drawer) e não como popover; `rule-of-thumb` mostra o texto da regra prática sem link.
- [ ] **Step 2:** rodar `npx vitest run src/features/plan/references.test.ts src/components/ui/info-source.test.tsx`; esperado FAIL (módulos não existem).
- [ ] **Step 3: Implementar.** `REFS` com as citações da tabela §7.1 da spec, campos separados. `refFinding` com um `switch` de `t('...')` literais, uma frase cada, sem números além destes: schoenfeld2016 "Treinar cada músculo 2 vezes por semana deu mais hipertrofia que 1 vez."; grgic2018freq "Com o mesmo volume semanal, treinar mais vezes não fez diferença clara na força."; os demais dizem a conclusão sem número (volume maior, mais ganho, com retorno decrescente; faixa ampla de repetições funciona; descanso mais longo ajudou nos multiarticulares; progredir repetições ou carga funcionou; treino curto com multiarticulares; recomendação geral de fortalecimento muscular). Passar cada frase pelo humanizer (skill `anthropic-skills:humanizer`) antes de fixar. `InfoSource`: botão `size-11` (44 px) com ícone `Info` do lucide, `aria-label={label ?? t('See source')}`; Radix `Popover` com `side="top"`; abaixo de 480 px usa `Drawer`; X com `aria-label={t('Close')}`.
- [ ] **Step 4:** `docs/fontes-1d.md` com o checklist da §7.3 da spec (os 7 itens) e uma linha por referência: DOI, o que conferir, caixa `[ ]`.
- [ ] **Step 5:** PASS; strings nos 16 pacotes; gate.
- [ ] **Step 6: Commit** `feat(plan): reference catalog and info source popover`.

### Task 2: Programas, sugestão e aplicar/desfazer

**Files:**
- Create: `src/features/plan/programs.ts`, `programs.test.ts`, `suggest-program.ts`, `suggest-program.test.ts`, `goal.ts`, `time.ts` + `time.test.ts`
- Modify: `src/lib/sync-merge.js` + `src/lib/sync-merge.test.js` (se `program` não estiver coberto pela regra de escalares), `src/lib/demoSeed.js` + teste (usa `programRoutines('ppl')`)
- Delete (na Task 3, não aqui): `src/lib/starter.js`

**Interfaces:**
- Consumes: `REFS`, `RefId` (Task 1); `exAvailable(S, ex)` de `src/lib/equipment.js`; `EXIDX` de `src/lib/exercises.js`; `uid` de `src/lib/format.js`.
- Produces:
  - `type ProgramId = 'full-body-beginner' | 'upper-lower' | 'ppl' | 'strength-5x5' | 'power-hypertrophy' | 'short-2x' | 'health-3x'`
  - `type Slot = { ex: string; sets: number; reps: number; repsMax?: number; restSec: number; alt?: string[]; prog?: 'double' | 'linear' }`
  - `type Program = { id: ProgramId; prefix: string; goals: AnalysisProfile[]; level: 'beginner' | 'intermediate' | 'advanced'; variants: { days: number; schedule: [number, string][] }[]; prog: 'double' | 'linear'; routines: { key: string; name: string; emoji: string; slots: Slot[] }[]; refs: RefId[] }`
  - `PROGRAMS: Record<ProgramId, Program>`
  - `buildProgram(S, id: ProgramId, variant = 0): { routines: Routine[]; week: Record<number, string[]>; missing: string[] }` (`missing` = ids de exercício mantidos sem equipamento)
  - `applyProgram(S, id, variant = 0): void` (muta `S` dentro de `update`), `undoProgram(S): { kept: string[] }`
  - `programRoutines(id: ProgramId): Routine[]` (sem filtro de equipamento, para o demo)
  - `suggestProgram({ goal, level, days }): { id: ProgramId; variant: number }`
  - `time.ts`: `estimateMinutes(routine): number` (regra de Global Constraints, arredonda para cima ao minuto), usada pelo cartão do programa (Task 3) e pela análise (Task 4)
  - `goal.ts`: `type AnalysisProfile = 'hypertrophy' | 'strength' | 'health'`; `profileOf(goal: Goal | null): AnalysisProfile`; `RANGES: Record<AnalysisProfile, { min: number; max: number; refs: SourceId[] }>` com hypertrophy `{10, 20, ['schoenfeld2017','pelland2025']}`, strength `{6, 12, ['ralston2017','pelland2025']}`, health `{4, 10, ['who2020','acsm2009']}`.

- [ ] **Step 1: Testes que falham** (`programs.test.ts`):
  - os 7 programas, com rotinas e agenda iguais às da §4.2 da spec (ids, séries, reps, `repsMax`, `restSec`, `alt`, dias); `ppl` tem variantes `[3 dias seg/qua/sex, 6 dias seg a sáb]`;
  - todo id de exercício (principal e `alt`) existe em `EXIDX` e `musclesOf` dele não é `{}`;
  - todo programa tem `refs` não vazio e todo id existe em `REFS` (Review Focus 5);
  - `buildProgram` com perfil de equipamento ativo sem `barbell`: `0025` vira `0289`; um slot sem alternativa disponível fica com o principal e entra em `missing` (Review Focus 2);
  - `applyProgram`: rotinas novas com nome `PPL · Push`, `weight: 0`, `prog`, `restSec`; `S.week` igual à agenda do programa; `S.dayPlan` intocado; rotinas antigas intactas; `S.program` com `prevWeek` igual à agenda anterior e `routineIds` das novas;
  - `undoProgram`: agenda volta a `prevWeek`; rotinas sem treino saem; rotina com treino em `S.workouts` (`routineIds` contém o id) fica e volta em `kept` (Review Focus 3); `S.program` vira `undefined`;
  - aplicar o mesmo programa duas vezes cria um segundo conjunto (ids novos).
  (`time.test.ts`): 3 exercícios × 3 séries com `restSec` 90 → 9 × 130 + 300 = 1470 s → 25 min; exercício sem `restSec` usa 90.
  (`suggest-program.test.ts`): a tabela §4.3 da spec inteira, linha a linha, inclusive `goal` nulo → hipertrofia e `fat_loss`/`conditioning` → saúde.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementar** `programs.ts`, `suggest-program.ts`, `goal.ts`. `demoSeed.js` passa a usar `programRoutines('ppl')` (rodar o teste do demo). Conferir em `sync-merge.js` se a chave `program` segue a regra de escalares (newer `_ts`); se não seguir, adicionar e testar `program` local com `_ts` mais novo vencendo.
- [ ] **Step 4:** PASS; gate.
- [ ] **Step 5: Commit** `feat(plan): program catalog with apply and undo`.

> **Revisão (controlador):** Tasks 1 e 2.

### Task 3: Tela de Programas

**Files:**
- Create: `src/features/plan/program-copy.tsx`, `ProgramsScreen.tsx`, `ProgramDetail.tsx`, `ProgramBanner.tsx` + testes
- Modify: `src/App.jsx` (rotas `/plan/programas` e `/plan/programas/:id`), `src/views/Plan.jsx` (botão "Programas" no lugar de "Load starter plan", faixa), `src/views/Settings.jsx` e `src/features/home/HomeCards.tsx` (navegam para `/plan/programas`), `src/features/profile/Onboarding.tsx` (usa `suggestProgram` e `programCopy`), `src/sheets.jsx` (sai `starterPlanSheet`, `StarterPlanChooser`, `PLAN_COPY`, `loadStarterPlan`), `src/locales/*.js`
- Delete: `src/lib/starter.js`, `src/lib/starter.test.js`, `src/features/profile/starter-suggest.ts` + teste

**Interfaces:**
- Consumes: Task 2 inteira; `InfoSource` (Task 1); `useProfile` (perfil com `goal`, `level`, `days_per_week`).
- Produces: `programCopy(id: ProgramId): { name: string; forWho: string; expect: string; why: string }` (todos em `t()`); rotas acima; `ProgramBanner` lido pelo Plano.

- [ ] **Step 1: Testes que falham:** lista mostra "Sugerido para você" com o programa de `suggestProgram` e o motivo ("Para hipertrofia, 4 dias"); filtros por objetivo e por dias; cartão com nome, objetivo, nível, dias e tempo (`estimateMinutes` da Task 2, da maior rotina do programa); detalhe mostra os 3 textos, um `InfoSource` no "Por que é assim" com os `refs` do programa, rotinas com séries × faixa; PPL mostra seletor 3 ou 6 dias; "Usar este programa" abre a prévia com a frase da §4.5 e confirmar chama `applyProgram`; aviso com "Desfazer" chama `undoProgram` e, com `kept` não vazio, avisa "N rotinas com treino ficaram na lista"; com `S.program.id` igual ao programa, a prévia avisa "Você já usa este programa"; a faixa no Plano aparece com `S.program` e some com `dismissed` ou depois de editar uma rotina; `missing` mostra "Usa equipamento que você não marcou"; Settings, Home e Plano levam a `/plan/programas`; onboarding mostra o programa sugerido com o nome de `programCopy`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementar.** Textos dos programas: escritos a partir da §4.2 da spec, curtos, pelo humanizer; "por que é assim" cita volume, frequência, repetições e descanso do programa em linguagem simples.
- [ ] **Step 4:** remover os arquivos e chamadas antigas; `grep -rn "starter" src` sem resultado fora de testes de migração de dados; PASS; strings; gate.
- [ ] **Step 5: Commit** `feat(plan): programs screen replaces the starter plan`.

### Task 4: Motor da análise

**Files:**
- Create: `src/features/plan/analysis.ts`, `analysis.test.ts`

**Interfaces:**
- Consumes: `musclesOf`, `MUSCLES` (`src/lib/muscles.js`); `EXIDX`/`allExercises` (`src/lib/exercises.js`); `RANGES`, `AnalysisProfile`, `estimateMinutes` (Task 2).
- Produces:
  - `type Group = 'chest' | 'back' | 'shoulders' | 'biceps' | 'triceps' | 'quads' | 'hamstrings' | 'glutes' | 'calves' | 'abs'`
  - `GROUP_OF: Partial<Record<MuscleSlug, Group>>` = chest→chest, upper-back→back, deltoids→shoulders, biceps, triceps, quadriceps→quads, hamstring→hamstrings, gluteal→glutes, calves, abs→abs, obliques→abs
  - `BIG_GROUPS: Group[] = ['chest','back','shoulders','quads','hamstrings','glutes']`
  - `type Alert = { kind: 'missing' | 'low' | 'high' | 'frequency' | 'balance-push-pull' | 'balance-quad-ham' | 'long' | 'repeated'; group?: Group; routineId?: string; exId?: string }`
  - `analyzePlan(S, profile: AnalysisProfile): { empty: boolean; groups: Record<Group, { sets: number; days: number; status: 'missing' | 'low' | 'ok' | 'high' }>; unknown: string[]; minutes: { routineId: string; minutes: number }[]; balance: { push: number; pull: number; quads: number; hamstrings: number }; alerts: Alert[] }`

- [ ] **Step 1: Testes que falham** (com rotinas montadas no teste a partir de ids conhecidos):
  - supino 0025 3 séries numa rotina em seg: peito 3 (principal), tríceps e ombros 1,5 se forem secundários em `musclesOf` (o teste lê `musclesOf` para montar o esperado);
  - a mesma rotina em seg e qui: séries dobram e `days` = 2 (Review Focus 1);
  - id na agenda sem rotina: ignorado (Review Focus 1);
  - frequência: grupo com 1,5 série no dia não conta o dia;
  - status por perfil nas bordas: hypertrophy 9,5 → low, 10 → ok, 20 → ok, 20,5 → high; strength 6/12; health 4/10; 0 → missing só para `BIG_GROUPS` (para bíceps 0 → low);
  - alerta `frequency` só em hypertrophy;
  - equilíbrio: push 9 e pull 6 não alerta (6 ≥ 2/3 de 9), push 9 e pull 5,5 alerta;
  - alerta `long` acima de 75 min; `repeated` com o mesmo exercício em 3 dias;
  - exercício personalizado sem músculo (`musclesOf` vazio) vai para `unknown` e não soma;
  - plano vazio → `empty: true` e sem alertas.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS; gate.
- [ ] **Step 5: Commit** `feat(plan): plan analysis engine`.

> **Revisão (controlador):** Tasks 3 e 4.

### Task 5: Sugestões de um toque

**Files:**
- Create: `src/features/plan/suggestions.ts`, `suggestions.test.ts`

**Interfaces:**
- Consumes: `analyzePlan`, `Group`, `GROUP_OF`, `BIG_GROUPS` (Task 4); `exAvailable` (`src/lib/equipment.js`).
- Produces:
  - `DEFAULT_EXERCISES: Record<Group, string[]>` = a lista da §5.7 da spec, na ordem dada
  - `type Change = { routineId: string; exId: string; from: number | null; to: number }` (`from: null` = exercício novo)
  - `type Suggestion = { kind: 'add-sets' | 'remove-sets' | 'add-exercise'; group: Group; changes: Change[] }`
  - `suggestionsFor(S, profile): Suggestion[]`
  - `applySuggestion(S, s: Suggestion): Routine[]` (muta `S.routines` e devolve o instantâneo das rotinas tocadas, antes da mudança)
  - `restoreRoutines(S, snapshot: Routine[]): void`

- [ ] **Step 1: Testes que falham:**
  - peito em 6 séries (hypertrophy) com supino 3 e crucifixo 3 como principais: `add-sets` soma até 2 por exercício até chegar a 10 (3→5, 3→5);
  - grupo baixo sem exercício principal na agenda: vira `add-exercise`;
  - `high`: tira primeiro de exercícios em que o grupo é secundário, nunca deixa exercício com menos de 2 séries;
  - `missing` posterior: adiciona `0586` 3 séries com a faixa do perfil (hypertrophy 8 a 12; strength 4 a 6; health 8 a 12) na rotina da agenda que mais trabalha grupos da mesma metade (inferior: quads, hamstrings, glutes, calves); empate vai para a de menor `estimateMinutes`;
  - perfil de equipamento sem `leverage machine`: escolhe o próximo da lista (`1459`);
  - aplicar e restaurar devolve `S.routines` igual ao de antes (`toEqual`);
  - nenhuma sugestão para alertas `long`, `repeated` e de equilíbrio.
- [ ] **Step 2–4:** FAIL, implementar, PASS; gate.
- [ ] **Step 5: Commit** `feat(plan): one-tap plan suggestions`.

### Task 6: Telas da análise

**Files:**
- Create: `src/features/plan/AnalysisCard.tsx`, `AnalysisScreen.tsx` + testes
- Modify: `src/views/Plan.jsx` (cartão), `src/App.jsx` (rota `/plan/analise`), `src/locales/*.js`

**Interfaces:**
- Consumes: Tasks 1, 2, 4, 5; `useProfile` para `goal`; skill `dataviz` (ler antes do gráfico).

- [ ] **Step 1: Testes que falham:** cartão com "2 alertas · peito abaixo do ideal" (primeiro alerta em ordem: missing, low, high, frequency, balance, long, repeated) ou "Plano equilibrado para hipertrofia"; plano vazio mostra "Escolha um programa para começar" com link para `/plan/programas`; tela mostra perfil ("Objetivo: hipertrofia") e, com `goal` nulo, "Defina seu objetivo no Perfil" com link; uma barra por grupo com o valor em texto e a faixa ("10 a 20"), com `InfoSource` dos `RANGES`; "Ver como tabela" mostra a mesma informação em `<table>`; frequência com `InfoSource` (`schoenfeld2016`); equilíbrio com `InfoSource` (`rule-of-thumb`) e texto sem número; tempo por rotina com "cerca de N min" e `InfoSource` explicando a conta (texto próprio, sem referência); cada alerta com sugestão tem "Aplicar" que mostra antes e depois ("Supino: 3 → 5 séries") e, ao confirmar, aplica e mostra aviso com "Desfazer" que restaura; `unknown` mostra "N exercícios sem músculo conhecido".
- [ ] **Step 2:** FAIL. **Step 3:** implementar; rodar `node <skill dataviz>/scripts/validate_palette.js` com as cores usadas, em `--mode light` e `--mode dark`, e registrar a saída no relatório. **Step 4:** PASS; strings; gate.
- [ ] **Step 5: Commit** `feat(plan): plan analysis screens`.

> **Revisão (controlador):** Tasks 5 e 6.

### Task 7: Progresso, "Suba a carga" e unidade do detalhe

**Files:**
- Create: `src/features/plan/ExerciseProgress.tsx`, `LoadUpBadge.tsx` + testes
- Modify: `src/views/RoutineEdit.jsx` (ou a lista de exercícios da rotina no Plano: tocar abre o progresso; selo ao lado), `src/features/checkin/DetailSheet.tsx` (carga sugerida), `src/features/checkin/types.ts` (`CheckinDetail.unit?: 'kg' | 'lb'`), `src/features/checkin/ingest.ts` + teste, quem monta o `detail` (`detailOf`, `detailOfWorkout`) grava `unit: S.unit`, `src/locales/*.js`

**Interfaces:**
- Consumes: `exerciseHistory`, `e1rmSeries`, `best1RM` (`src/lib/exercise-history.js`, `src/lib/onerm.js`); `nextPrescription(S, cfg, routine)` (`src/lib/progression.js`, `kind === 'up'` significa subir); `convertWeight(value, from, to)` (`src/lib/units.js`); `weightIncrement`, `snapWeight` (`src/lib/progression.js`).
- Produces: `loadUp(S, cfg, routine): { weight: number } | null` em `LoadUpBadge.tsx` (exportada e testada).

- [ ] **Step 1: Testes que falham:**
  - `ExerciseProgress` sem sessões não renderiza nada e a lista não mostra o atalho; com sessões mostra o gráfico de maior carga e 1RM estimado, as últimas sessões e o recorde;
  - `loadUp` devolve o peso de `nextPrescription` quando `kind === 'up'` e `null` nos outros casos; selo "Próximo treino: 62,5 kg" com `InfoSource` (`plotkin2022`);
  - `DetailSheet` mostra "sugerido 62,5 kg" ao lado do campo quando `loadUp` existe;
  - `detailOf` e `detailOfWorkout` gravam `unit: S.unit`;
  - ingestão (Review Focus 4): detalhe `unit: 'kg'` com `S.unit = 'lb'` converte cada `w` com `convertWeight` e arredonda com `snapWeight(w, weightIncrement(cfg, 'lb'))`; detalhe sem `unit` não converte; detalhe com `unit` igual não converte; ingerir duas vezes o mesmo detalhe dá o mesmo resultado.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS; strings; gate.
- [ ] **Step 5: Commit** `feat(plan): exercise progress and load up hint`.

### Task 8: Documentação e fechamento

**Files:**
- Modify: `docs/ROADMAP.md` (1d "concluída no código, sem SQL; aguarda a conferência das fontes em `docs/fontes-1d.md` e o merge"), a spec (seção "Decisões do plano" com as 6 decisões acima e as do controlador do ledger), `README.md` se ele listar funcionalidades do Plano.

- [ ] **Step 1:** atualizar os documentos; texto público pelo humanizer; sem travessão como pausa.
- [ ] **Step 2:** `node scripts/check-locales.mjs`, `node scripts/check-source-strings.mjs --strict`, `npm run typecheck`, `npm test`, `npm run build`.
- [ ] **Step 3: Commit** `docs: phase 1d status and plan decisions`.

> **Revisão (controlador):** Tasks 7 e 8; depois a revisão final do branch inteiro contra a spec.
