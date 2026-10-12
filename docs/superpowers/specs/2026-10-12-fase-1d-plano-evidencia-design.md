# Fase 1d: Plano com evidência

- **Status:** spec em revisão (2026-10-12)
- **Base:** [ROADMAP §Fase 1d](../../ROADMAP.md), [spec da 1c](2026-10-06-checkin-social-design.md) (check-in, detalhe
  do treino, pilar Treino) e [spec da Fundação](2026-10-04-performance-app-foundation-design.md).
- **Depende de:** 1c (no ar desde 2026-10-11).

## 1. Objetivo e critério de sucesso

O valor do app mora no Plano, não no treino ao vivo. A 1d faz do Plano o lugar onde a pessoa escolhe e
ajusta um bom plano, com base em evidência científica, sem precisar registrar séries.

**Pronto quando:**

1. alguém escolhe um programa do catálogo e ele vira o plano da semana;
2. a análise mostra volume e frequência por músculo do plano atual e pelo menos uma sugestão é
   aplicada com um toque;
3. toda recomendação com número na tela tem um ⓘ com fonte verificável.

## 2. Decisões do brainstorm

| Tema | Decisão |
|---|---|
| Objetivo da análise | o da pessoa, já guardado em `profiles.goal`; sem objetivo, hipertrofia com um convite para definir |
| Escolher um programa | adiciona as rotinas do programa e troca só a agenda da semana; rotinas antigas ficam; "Desfazer" |
| Sugestões de um toque | ajustar séries de exercícios do plano e adicionar um exercício para músculo sem séries; nunca redistribuir dias |
| Catálogo | 7 programas (seção 4) |
| Onde mora o conteúdo | no código, em `src/features/plan/` (programas, referências e regras), versionado e testado; nada novo no banco |
| Referências | catálogo único id → citação; a tela mostra só a recomendação em linguagem simples e um ⓘ |

**Fora:** gerador automático de plano, periodização em blocos e deload como recurso próprio, coach com
IA, redistribuir treinos entre dias, gráfico de volume total, comparação com amigos, metas de carga.

## 3. Objetivo da pessoa

`profiles.goal` já existe (`hypertrophy`, `strength`, `fat_loss`, `conditioning`), preenchido no
onboarding. A 1d lê esse campo e o mapeia para três perfis de recomendação:

| `profiles.goal` | Perfil da análise |
|---|---|
| `hypertrophy` ou vazio | Hipertrofia |
| `strength` | Força |
| `fat_loss`, `conditioning` | Saúde geral |

Com objetivo vazio, a análise e o catálogo mostram "Defina seu objetivo no Perfil" uma vez por tela,
com link para o campo. O Perfil já edita o objetivo; a 1d só garante o link.

## 4. Catálogo de programas

### 4.1 Dados de um programa (`src/features/plan/programs.ts`)

```ts
type ProgramId = 'full-body-beginner' | 'upper-lower' | 'ppl' | 'strength-5x5'
  | 'power-hypertrophy' | 'short-2x' | 'health-3x'
type Program = {
  id: ProgramId
  goals: Array<'hypertrophy' | 'strength' | 'health'>
  level: 'beginner' | 'intermediate' | 'advanced'
  variants: Array<{ days: number; schedule: Array<[weekday: number, routineKey: string]> }>
  minutes: number                       // tempo estimado por treino, recalculado pela análise (§5.5)
  prog: 'double' | 'linear'             // política de progressão do app (src/lib/progression.js)
  routines: Array<{ key: string; name: string; emoji: string; slots: Slot[] }>
  refs: { why: RefId[] }                // fontes do texto "por que é assim"
}
type Slot = { ex: string; sets: number; reps: number; repsMax?: number; restSec: number; alt?: string[] }
```

Os textos de cada programa (nome exibido, "para quem é", "o que esperar", "por que é assim") ficam
dentro de chamadas `t()` no componente, como já acontece com `PLAN_COPY` em `sheets.jsx`, para o
`check-source-strings` encontrá-los. Os nomes das rotinas criadas seguem o padrão atual: inglês
canônico com o prefixo do programa ("PPL · Push"), porque viram rotinas comuns da pessoa.

`alt` lista até duas alternativas por exercício. Ao aplicar, se o perfil de equipamento ativo
(`src/lib/equipment.js`, `exAvailable`) não tiver o equipamento do exercício principal, entra a
primeira alternativa disponível; sem nenhuma disponível, fica o principal e o detalhe do programa
avisa "Usa equipamento que você não marcou".

### 4.2 Os 7 programas

Ids de exercício do catálogo do app (`src/lib/exercises-data.js`). Séries × repetições; `a` é a
faixa da progressão dupla (ex.: 8 a 12). Descanso: 90 s nos isoladores, 120 s nos multiarticulares de
hipertrofia, 180 s nos de força. O plano de implementação confere em teste que todo id existe e tem
mapa de músculos.

**1. Corpo inteiro iniciante** (`full-body-beginner`). Objetivos: saúde, hipertrofia. Nível
iniciante. 3x (seg, qua, sex). Progressão dupla. Evolui o "Full Body" atual.
- A: agachamento livre 0043 3×8a12 (alt 1760 goblet), supino reto 0025 3×8a12 (alt 0289 halteres,
  0577 máquina), puxada 2330 3×10a12 (alt 0499 remada invertida), flexora 0586 2×10a15, elevação lateral
  0334 2×12a15, rosca 0031 2×10a12 (alt 0294).
- B: stiff 0085 3×8a12 (alt 1459 halteres), supino inclinado 0047 3×8a12 (alt 0314), remada sentada
  1323 3×10a12 (alt 0861, 1350), extensora 0585 2×12a15, tríceps na polia 0241 2×10a15, panturrilha 0605
  3×12a15 (alt 0594).
- C: leg press 0739 3×10a12, desenvolvimento 0426 3×8a12 (alt 0091), remada curvada 0027 3×8a12 (alt
  0293), afundo 0336 2×10a12, rosca martelo 0313 2×10a12, abdominal na polia 0175 2×10a15 (alt 0276).

**2. Superior / Inferior** (`upper-lower`). Hipertrofia. Intermediário. 4x (seg, ter, qui, sex).
Progressão dupla. Mantém as rotinas atuais "Upper A/B, Lower A/B" com faixas de repetição e descanso.

**3. Push / Pull / Legs** (`ppl`). Hipertrofia. Intermediário a avançado. Duas variantes: 3x (seg, qua,
sex) e 6x (seg a sáb, cada rotina duas vezes). Progressão dupla. Mantém as rotinas atuais com faixas.
Na variante 3x, cada músculo é treinado uma vez por semana; o detalhe do programa diz isso e aponta a
variante 6x ou o Superior / Inferior para quem quer frequência 2.

**4. Força 5×5** (`strength-5x5`). Força. Iniciante a intermediário. 3x (seg, qua, sex). Progressão
linear. Mantém as rotinas "5×5 A/B/C" atuais, com descanso de 180 s.

**5. Força e hipertrofia** (`power-hypertrophy`, estilo PHUL). Força e hipertrofia. Intermediário. 4x
(seg, ter, qui, sex). Força com progressão linear nos básicos; hipertrofia com dupla.
- Superior força: supino 0025 4×5, remada curvada 0027 4×5, desenvolvimento sentado 0091 3×6, puxada
  2330 3×8, rosca 0031 2×8a10, tríceps 0241 2×8a10.
- Inferior força: agachamento 0043 4×5, stiff 0085 3×6, leg press 0739 3×8, flexora 0586 3×8a10,
  panturrilha 0605 4×8a10.
- Superior hipertrofia: supino inclinado com halteres 0314 3×8a12, remada sentada 1323 3×10a12, elevação
  lateral 0334 3×12a15, puxada 2330 3×10a12, rosca martelo 0313 3×10a12, tríceps 0241 3×10a15.
- Inferior hipertrofia: leg press 0739 3×10a15, stiff com halteres 1459 3×10a12, extensora 0585 3×12a15,
  flexora 0586 3×12a15, panturrilha sentado 0594 4×12a15.

**6. Treino curto** (`short-2x`). Saúde geral. Iniciante. 2x (ter, sex), cerca de 40 min. Progressão
dupla. Só multiarticulares, como recomenda a revisão de treino eficiente no tempo [iversen2021].
- A: leg press 0739 3×8a12, supino 0025 3×8a12 (alt 0577), puxada 2330 3×8a12, stiff 0085 2×8a12.
- B: agachamento goblet 1760 3×8a12, desenvolvimento 0426 3×8a12, remada sentada 1323 3×8a12, ponte de
  glúteo 1409 2×10a12.

**7. Saúde geral** (`health-3x`). Saúde geral. Iniciante. 3x (seg, qua, sex), cerca de 35 min. Progressão
dupla. Um exercício por grupo grande, 2 séries de 8 a 12, alternando A e B (A, B, A numa semana).
- A: leg press 0739, supino com halteres 0289, puxada 2330, flexora 0586, dead bug 0276.
- B: agachamento goblet 1760, remada sentada 1323, desenvolvimento 0426, ponte de glúteo 1409,
  panturrilha 0605.

O conteúdo acima é proposta: os números e as escolhas de exercício passam pela revisão do grupo
(§7.3) antes do código.

### 4.3 Sugerido para você

Substitui `suggestStarterPlan` por `suggestProgram({ goal, level, days })`:

| Perfil | Dias | Iniciante | Intermediário ou avançado |
|---|---|---|---|
| Saúde geral | 2 | Treino curto | Treino curto |
| Saúde geral | 3 ou mais | Saúde geral | Corpo inteiro iniciante |
| Hipertrofia | 2 ou 3 | Corpo inteiro iniciante | PPL 3x |
| Hipertrofia | 4 ou 5 | Superior / Inferior | Superior / Inferior |
| Hipertrofia | 6 ou mais | Superior / Inferior | PPL 6x |
| Força | 3 ou menos | Força 5×5 | Força 5×5 |
| Força | 4 ou mais | Força 5×5 | Força e hipertrofia |

`days` é `profiles.days_per_week`. O onboarding passa a sugerir pelo mesmo `suggestProgram`.

### 4.4 Tela

O Plano ganha a entrada **"Programas"** (substitui "Carregar plano inicial", e `starterPlanSheet` sai).

- Topo: "Sugerido para você" (§4.3), com o motivo em uma linha ("Para hipertrofia, 4 dias").
- Lista com filtro por objetivo (Todos, Hipertrofia, Força, Saúde) e por dias.
- Cartão: nome, objetivo, nível, dias, tempo estimado.
- Detalhe: "Para quem é", "O que esperar", "Por que é assim" (com ⓘ), as rotinas com exercícios e
  séries, a variante (quando houver) e o botão **"Usar este programa"**.

### 4.5 Usar um programa

1. Prévia: "Adiciona 3 rotinas e troca sua agenda: seg PPL · Push, qua PPL · Pull, sex PPL · Legs.
   Suas rotinas atuais continuam na lista."
2. Confirmar aplica numa única mudança de estado:
   - cria as rotinas (ids novos, `weight: 0`, `prog` do programa, `restSec`, `reps`/`repsMax`);
   - troca `S.week` pela agenda do programa;
   - **não** mexe em `S.dayPlan` (mudanças de dias específicos que a pessoa marcou continuam);
   - grava `S.program = { id, variant, appliedAt, routineIds, prevWeek }`.
3. Aviso "Programa aplicado" com **"Desfazer"**, e uma faixa no topo do Plano com o nome do programa e
   "Desfazer", que some quando a pessoa fecha a faixa ou edita o plano.
4. "Desfazer": volta `S.week` para `prevWeek`, remove as rotinas de `routineIds` que ainda não têm treino
   registrado (`S.workouts` com `routineIds` contendo o id) e limpa `S.program`. Rotinas com treino
   ficam, sem dia na agenda.

`S.program` sincroniza junto do estado, com a regra de `week` em `src/lib/sync-merge.js` (vence o
`_ts` mais novo). O plano de implementação confere que a fusão trata a chave nova e que a união de
rotinas não ressuscita uma rotina removida pelo "Desfazer" (se ressuscitar, o "Desfazer" só desmarca a
agenda e deixa a rotina, e a faixa diz isso).

## 5. Análise do plano

### 5.1 Entrada

Só as rotinas da agenda da semana (`S.week`, dia 0 a 6, cada dia pode ter mais de uma rotina). Uma
rotina em dois dias conta duas vezes. Funciona sem histórico. Função pura:

```ts
analyzePlan(S, profile: 'hypertrophy' | 'strength' | 'health'): PlanAnalysis
```

### 5.2 Volume por grupo muscular

- Mapa de músculos do app (`src/lib/muscles.js`, 18 músculos). Para a análise, o músculo principal do
  exercício conta **1** série e cada secundário conta **0,5**, a contagem fracionada que a meta-análise
  de dose-resposta usou nos modelos principais [pelland2025]. A função `musclesOf` atual (peso 0,4) não
  muda; a análise aplica o próprio peso.
- 10 grupos exibidos: peito (chest), costas (upper-back), ombros (deltoids), bíceps, tríceps, quadríceps,
  posterior de coxa (hamstring), glúteos (gluteal), panturrilha (calves) e abdômen (abs, obliques). Os
  demais músculos (trapézio, antebraço, lombar, adutores etc.) não aparecem como barra.
- Exercício sem mapa de músculos (personalizado ou fora das listas de músculo) não entra na conta;
  a análise diz "N exercícios sem músculo conhecido" e lista quais.

**Faixas semanais por grupo** (séries fracionadas), com ⓘ:

| Perfil | Mínimo | Topo | Fontes |
|---|---|---|---|
| Hipertrofia | 10 | 20 | [schoenfeld2017], [pelland2025] |
| Força | 6 | 12 | [ralston2017], [pelland2025] |
| Saúde geral | 4 | 10 | [who2020], [acsm2009] |

Os três pares de números são proposta e entram na lista de conferência (§7.3). Abaixo do mínimo, a
barra mostra "abaixo do ideal"; acima do topo, "ganho extra pequeno" (retorno decrescente
[pelland2025]), nunca "errado".

### 5.3 Frequência

Dias da semana em que o grupo recebe pelo menos 2 séries fracionadas. Recomendação: **2 vezes por
semana ou mais** para hipertrofia [schoenfeld2016]. Para força, a frequência ajuda sobretudo como
forma de somar volume [grgic2018freq]; para saúde geral, a recomendação é treinar força em 2 dias ou
mais na semana, não cada músculo [who2020]. Nesses dois perfis a tela mostra a frequência sem alerta.

### 5.4 Equilíbrio

- Empurrar (peito, ombros, tríceps) contra puxar (costas, bíceps).
- Quadríceps contra posterior de coxa.

Alerta quando o lado menor tem menos de 2/3 do maior. A tela não mostra o número da regra; diz
"Você faz bem mais séries de empurrar do que de puxar". O ⓘ explica que é uma regra prática de
montagem de treino. Se a conferência (§7.3) achar uma fonte que sustente a recomendação de equilíbrio,
ela entra no ⓘ; sem fonte confirmada, o ⓘ diz "regra prática, sem número de estudo" e o alerta segue
sem número.

### 5.5 Tempo estimado por treino

Por rotina: soma de séries × (descanso + 40 s de execução) + 5 min de aquecimento. Descanso: `restSec`
do exercício, senão 90 s. A tela diz "cerca de 55 min" e um ⓘ explica a conta (sem fonte, é estimativa
do app). Descansos recomendados aparecem no detalhe dos programas com fonte [schoenfeld2016rest],
[grgic2018rest].

### 5.6 Alertas

| Alerta | Regra |
|---|---|
| Músculo grande esquecido | peito, costas, ombros, quadríceps, posterior ou glúteos com 0 séries |
| Abaixo do ideal | grupo abaixo do mínimo do perfil |
| Ganho extra pequeno | grupo acima do topo |
| Frequência baixa | grupo com séries em 1 dia só (só no perfil hipertrofia) |
| Desequilíbrio | §5.4 |
| Treino longo | rotina com tempo estimado acima de 75 min |
| Exercício repetido | o mesmo exercício em 3 dias ou mais da semana |

### 5.7 Sugestões de um toque

Cada sugestão é uma mudança pequena, mostrada como antes e depois ("Supino: 3 → 4 séries"):

- **Abaixo do ideal:** soma séries aos exercícios em que o grupo é o principal, até 2 séries por
  exercício e até chegar ao mínimo; se não houver exercício principal do grupo, vira a sugestão de
  adicionar.
- **Ganho extra pequeno:** tira séries primeiro dos exercícios em que o grupo é secundário, sem deixar
  nenhum exercício com menos de 2 séries.
- **Músculo esquecido:** adiciona o exercício padrão do grupo (lista curada abaixo, filtrada pelo
  equipamento) com 3 séries e a faixa do perfil, na rotina da agenda que mais trabalha grupos vizinhos
  (mesma metade do corpo: superior ou inferior); empate vai para a rotina com menor tempo estimado.

Exercício padrão por grupo (primeiro disponível no equipamento): peito 0025, 0289, 0577; costas 2330,
1323, 0499; ombros 0426, 0091; bíceps 0031, 0294; tríceps 0241; quadríceps 0739, 1760, 0043; posterior
0586, 1459, 0085; glúteos 1409, 0739; panturrilha 0605, 0594; abdômen 0175, 0276.

Aplicar grava um instantâneo das rotinas tocadas e mostra "Desfazer" no aviso; desfazer volta o
instantâneo. Alertas sem sugestão automática (treino longo, desequilíbrio, exercício repetido) explicam
o que mudar à mão.

### 5.8 Tela

- Cartão **"Análise"** no Plano: uma linha de resumo ("2 alertas · peito abaixo do ideal") ou "Plano
  equilibrado para hipertrofia".
- Tela da análise (`/plan/analise`): perfil e objetivo no topo; barras por grupo contra a faixa (com
  alternativa em tabela); frequência; equilíbrio; tempo por rotina; alertas com "Aplicar". O gráfico
  segue a skill `dataviz` do projeto (marcas finas, faixa recomendada como banda neutra, texto nas cores
  de texto, validação da paleta em claro e escuro).
- Plano vazio: "Escolha um programa para começar" com link para Programas.

## 6. Progresso dos exercícios

Só para quem tem carga registrada (detalhe do check-in ou treino ao vivo). Sem dados, nada aparece.

- **Progresso de um exercício:** tocar num exercício de uma rotina no Plano abre "Progresso" com o
  gráfico de maior carga e de 1RM estimado por sessão, as últimas sessões e o recorde
  (`exerciseHistory`, `e1rmSeries` já existentes).
- **"Suba a carga":** na lista da rotina, selo quando a última sessão bateu o topo da faixa em todas as
  séries, com o valor de `nextPrescription` ("Próximo treino: 62,5 kg") e ⓘ sobre progressão dupla e
  sobrecarga progressiva [plotkin2022].
- **Detalhar treino (check-in):** os campos continuam pré-preenchidos com a última carga e mostram a
  carga sugerida ao lado quando houver.

**Unidade do detalhe.** O `detail` do check-in passa a guardar `unit: 'kg' | 'lb'` junto das séries. Ao
ingerir um detalhe em `S.workouts` (`src/features/checkin/ingest.ts`), o peso é convertido para
`S.unit` quando a unidade do detalhe for diferente. Detalhe antigo sem `unit` conta como `S.unit`
(comportamento atual). Nada muda no banco: `detail` já é jsonb.

## 7. Referências

### 7.1 Catálogo (`src/features/plan/references.ts`)

```ts
type Ref = { id: RefId; authors: string; year: number; title: string; journal: string; doi: string }
```

A linha "o que o estudo achou" fica numa chamada `t()` no componente, por id, para entrar nos 16 idiomas.
Autores, título e revista não são traduzidos.

| id | Citação | DOI |
|---|---|---|
| schoenfeld2017 | Schoenfeld BJ, Ogborn D, Krieger JW. Dose-response relationship between weekly resistance training volume and increases in muscle mass: a systematic review and meta-analysis. J Sports Sci 2017;35(11):1073-1082 | 10.1080/02640414.2016.1210197 |
| schoenfeld2016 | Schoenfeld BJ, Ogborn D, Krieger JW. Effects of resistance training frequency on measures of muscle hypertrophy: a systematic review and meta-analysis. Sports Med 2016;46(11):1689-1697 | 10.1007/s40279-016-0543-8 |
| pelland2025 | Pelland JC, Remmert JF, Robinson ZP, et al. The resistance training dose response: meta-regressions exploring the effects of weekly volume and frequency on muscle hypertrophy and strength gains. Sports Med 2025 (online 4 dez. 2025) | 10.1007/s40279-025-02344-w |
| acsm2009 | American College of Sports Medicine (Ratamess NA et al.). Progression models in resistance training for healthy adults. Med Sci Sports Exerc 2009;41(3):687-708 | 10.1249/MSS.0b013e3181915670 |
| who2020 | Bull FC, Al-Ansari SS, Biddle S, et al. World Health Organization 2020 guidelines on physical activity and sedentary behaviour. Br J Sports Med 2020;54(24):1451-1462 | 10.1136/bjsports-2020-102955 |
| ralston2017 | Ralston GW, Kilgore L, Wyatt FB, Baker JS. The effect of weekly set volume on strength gain: a meta-analysis. Sports Med 2017;47(12):2585-2601 | 10.1007/s40279-017-0762-7 |
| schoenfeld2016rest | Schoenfeld BJ, Pope ZK, Benik FM, et al. Longer interset rest periods enhance muscle strength and hypertrophy in resistance-trained men. J Strength Cond Res 2016;30(7):1805-1812 | 10.1519/JSC.0000000000001272 |
| schoenfeld2021 | Schoenfeld BJ, Grgic J, Van Every DW, Plotkin DL. Loading recommendations for muscle strength, hypertrophy, and local endurance: a re-examination of the repetition continuum. Sports 2021;9(2):32 | 10.3390/sports9020032 |
| grgic2018freq | Grgic J, Schoenfeld BJ, Davies TB, et al. Effect of resistance training frequency on gains in muscular strength: a systematic review and meta-analysis. Sports Med 2018;48(5):1207-1220 | 10.1007/s40279-018-0872-x |
| plotkin2022 | Plotkin D, Coleman M, Van Every D, et al. Progressive overload without progressing load? The effects of load or repetition progression on muscular adaptations. PeerJ 2022;10:e14142 | 10.7717/peerj.14142 |
| iversen2021 | Iversen VM, Norum M, Schoenfeld BJ, Fimland MS. No time to lift? Designing time-efficient training programs for strength and hypertrophy: a narrative review. Sports Med 2021;51(10):2079-2095 | 10.1007/s40279-021-01490-1 |
| grgic2018rest | Grgic J, Schoenfeld BJ, Skrepnik M, et al. Effects of rest interval duration in resistance training on measures of muscular strength: a systematic review. Sports Med 2018;48(1):137-151 | 10.1007/s40279-017-0788-x |

`schoenfeld2021` sustenta as faixas de repetição dos programas (ganhos em uma faixa ampla de cargas).

### 7.2 O ⓘ (`src/components/ui/info-source.tsx`)

- Botão de 44 px com rótulo acessível "Ver fonte", ícone ⓘ.
- Toque abre um balão ancorado acima do ícone (Radix Popover, já instalado via `radix-ui`); em tela
  estreita (menos de 480 px) vira uma folha que sobe de baixo (o `Drawer` existente).
- Conteúdo: para cada id, autores, ano, título curto, a linha do que o estudo achou e o link
  `https://doi.org/<doi>` (abre fora do app).
- Fecha ao tocar fora, no X ou com Esc; devolve o foco ao ícone. Sem hover.
- Uso: `<InfoSource refs={['schoenfeld2017', 'pelland2025']} />`.

### 7.3 Conferência do conteúdo antes do código

As citações acima foram conferidas em 2026-10-12 por busca na web (registros do PubMed, PMC, editoras
e repositórios). Não foi possível abrir as páginas nem resolver os DOIs a partir do ambiente de
desenvolvimento. Por isso, antes de o conteúdo entrar no código, alguém do grupo confere:

1. cada DOI abre o artigo certo em doi.org;
2. Pelland 2025: volume, edição e páginas impressos e a lista de autores;
3. as linhas "o que o estudo achou" (escritas no plano a partir dos resumos, sem números que não
   estejam no resumo);
4. as três faixas de §5.2 e a recomendação de frequência;
5. a recomendação de saúde geral da OMS para fortalecimento muscular (texto exato);
6. se o ACSM 2009 recomenda equilíbrio entre grupos opostos (§5.4); se não, o ⓘ do equilíbrio fica como
   "regra prática";
7. se o ACSM 2026 (Currier et al., 10.1249/MSS.0000000000003897, encontrado na busca, não conferido)
   deve substituir o de 2009.

Uma referência que não se confirmar sai do catálogo; a recomendação que dependia só dela sai ou perde o
número. A primeira tarefa do plano é aplicar o resultado dessa conferência.

**Regras em teste:** todo id citado existe no catálogo; toda referência tem DOI; toda recomendação com
número na tela (faixas, frequência, descanso, repetições dos programas) aponta para pelo menos um id.

## 8. Arquitetura e arquivos

```
src/features/plan/
  programs.ts          os 7 programas (§4.2) e applyProgram/undoProgram
  suggest-program.ts   suggestProgram (§4.3), substitui starter-suggest.ts
  references.ts        catálogo de referências (§7.1)
  analysis.ts          analyzePlan e sugestões (§5), funções puras
  ProgramsScreen.tsx   lista, sugerido e detalhe
  AnalysisCard.tsx     cartão no Plano
  AnalysisScreen.tsx   /plan/analise
  ExerciseProgress.tsx progresso de um exercício (§6)
src/components/ui/info-source.tsx  o ⓘ
src/views/Plan.jsx      entradas Programas e Análise, faixa do programa, selo "Suba a carga"
src/sheets.jsx          sai starterPlanSheet e PLAN_COPY
src/features/checkin/   unit no detalhe e conversão na ingestão
src/lib/starter.js      sai; o demo (demoSeed) passa a usar programRoutines('ppl') de programs.ts
```

Sem migration. Sem mudança em RLS. Nada novo no servidor.

## 9. Erros e casos de borda

- Programa com exercício sem equipamento e sem alternativa: aplica mesmo assim, com aviso no detalhe.
- Aplicar um programa duas vezes: cria um segundo conjunto de rotinas; a prévia avisa "Você já usa
  este programa".
- Rotina da agenda apagada: a análise ignora o id ausente.
- Exercício personalizado: entra no tempo estimado, fica fora do volume (§5.2).
- Conversão de unidade com valores fracionários: arredonda para o passo de carga do exercício
  (`weightIncrement`).
- Objetivo vazio: hipertrofia e convite (§3).

## 10. Testes

- `analysis.test.ts`: volume fracionado, grupos, faixas por perfil, frequência, equilíbrio, tempo,
  cada alerta, cada sugestão aplicada e desfeita, exercício sem músculo, plano vazio, rotina em dois
  dias.
- `programs.test.ts`: os 7 programas montam rotinas válidas; todo id existe e tem mapa de músculos;
  alternativas por equipamento; aplicar e desfazer (inclusive rotina com treino que fica); `dayPlan`
  intocado; a análise de cada programa no próprio perfil não acusa "músculo grande esquecido".
- `suggest-program.test.ts`: a tabela de §4.3 inteira.
- `references.test.ts`: as regras de §7.3.
- `info-source.test.tsx`: abre, fecha por fora, X e Esc, devolve o foco, rótulo, folha em tela estreita.
- Progresso: selo "Suba a carga" aparece e some; conversão de unidade na ingestão (kg → lb, lb → kg,
  sem unidade).
- `sync-merge`: `S.program` funde pela regra de `week`.
- Locales: textos novos nos 16 pacotes, sem travessão como pausa; scripts de locale passam.

## 11. Ordem sugerida para o plano

1. Conferência do conteúdo (§7.3) aplicada às faixas, programas e linhas das fontes.
2. Referências e o ⓘ.
3. Programas, sugestão e aplicar e desfazer.
4. Tela de Programas (substitui o plano inicial e a sugestão do onboarding).
5. Motor da análise.
6. Sugestões de um toque.
7. Telas da análise.
8. Progresso, selo e unidade do detalhe.
9. Documentação (ROADMAP) e revisão final.

## 12. Decisões do plano e do controlador

Escolhas feitas ao escrever o plano e ao executá-lo. Onde diferem do texto acima, valem estas.

### 12.1 Decisões do plano

- **Conferência das fontes.** O plano não espera a conferência humana para começar. O checklist fica
  em `docs/fontes-1d.md` e o conteúdo entra como está na spec. As linhas "o que o estudo achou" usam
  só fatos sem número além dos que constam no resumo verificado, sem tamanho de efeito. Quem revisar
  o PR confere o checklist antes do merge.
- **Equilíbrio sem fonte confirmada.** O ⓘ do equilíbrio usa a entrada especial `rule-of-thumb`.
  Ela não é uma referência: o texto diz "Regra prática de montagem de treino, sem número de estudo".
  Fica assim até a conferência confirmar o ACSM 2009.
- **Entrada dos programas.** A rota `/plan/programas` mostra a lista e o sugerido, e
  `/plan/programas/:id` mostra o detalhe. O `starterPlanSheet` sai. Plan.jsx, Settings.jsx e
  HomeCards.tsx passam a abrir `/plan/programas`.
- **Estado do programa aplicado.** `S.program = { id, variant, appliedAt, routineIds, prevWeek,
  dismissed }`. Com `dismissed: true` a faixa some. Editar qualquer rotina ou a agenda também esconde
  a faixa, porque o `update` do Plano marca `dismissed`.
- **Última sugestão aplicada.** O estado fica só na memória da tela e não sincroniza. O Desfazer vale
  enquanto a tela está aberta.
- **Gráfico da análise.** Barras horizontais por grupo, com a faixa recomendada como banda neutra e o
  valor em texto ao lado. A paleta foi validada com `validate_palette.js` da skill `dataviz`, no claro
  e no escuro. Há também uma tabela alternativa ("Ver como tabela").

### 12.2 Decisões do controlador

**Que mudam o comportamento do produto**

- **Faixa de repetições guardada na convenção do app.** Exercício com carga guarda
  `{ reps: topo, repsMin: base }`. Exercício de peso do corpo guarda `{ reps, repsMax }`. Exercício
  fixo guarda só `{ reps }`. Os dados do programa seguem `{ reps: base, repsMax?: topo }`, e a
  exportação para a rotina converte (`slotToCfg`). Assim o `progression.js` lê a faixa certa.
- **Faixas preenchidas em Superior/Inferior e PPL.** Os programas tinham repetições fixas e agora
  têm faixa: 8 vira 8 a 12, 10 vira 10 a 12, 12 vira 12 a 15 e panturrilha de 15 vira 12 a 15. O 5×5
  continua com 5 fixas, progressão linear e 180 s de descanso.
- **Descanso.** Exercício de isolamento descansa 90 s. Os demais compostos de hipertrofia e de saúde
  descansam 120 s. Compostos de força com repetição fixa descansam 180 s.
- **Isolamento nos programas de saúde.** Também descansa 90 s, a mesma regra de todo lugar. O
  programa de saúde de 3 dias fica em cerca de 30 a 31 min, dentro do "cerca de 35" da spec.
- **Personalizado sem músculo explícito e cardio ficam fora do volume.** Exercício criado pela pessoa
  sem músculo informado entra em "sem músculo conhecido" (§5.2 e §9). Cardio não é volume de
  resistência e fica fora do volume e da frequência, mas continua contando nos minutos.
- **"Posterior de coxa" só na análise.** O nome vale apenas nas telas da análise, com chave de texto
  própria. A biblioteca de exercícios continua dizendo "Isquiotibiais".
- **Texto da dica de frequência.** A dica diz a regra real: treinar o músculo em 2 dias da semana ou
  mais, com pelo menos 2 séries em cada dia.
- **Prefixos dos programas.** Os nomes das rotinas criadas levam o prefixo do programa: Full Body,
  Upper/Lower, PPL, 5×5, PHUL, Short e Health. O separador é ` · `, como em `PPL · Push`, e os nomes
  não são traduzidos.

**De processo e de escopo**

- A frase do usuário "plano 1d, executa" valeu como aprovação da spec e do plano. Não houve pausa
  para revisar o plano. O custo seria refazer, se a pessoa quisesse revisar antes.
- A conferência do §7.3 roda em paralelo, por uma pessoa. O código entrega o conteúdo da spec e as
  linhas das fontes evitam número não confirmado. Uma referência pode precisar de troca depois.
- Os padrões menores do implementador foram aceitos: PHUL com os slots de repetição fixa em
  progressão linear, programas de saúde em A/B/A, PPL de 6 dias na agenda e listas de referências
  por programa.
- Desfazer o programa contra a união de rotinas fica para o aviso da faixa. Os achados de menor
  gravidade das revisões foram corrigidos em lotes, e os restantes foram aceitos ou levados para a
  revisão final.
- O programa aplicado esconde a faixa em qualquer edição de rotina ou de semana no app todo. Terminar
  um treino não conta como edição.
- Máquinas assistidas recebem `{ reps, repsMax }` por `climbsReps`, e a sugestão de adicionar
  exercício não escolhe exercício assistido (ou usa o formato com carga).
- Fica anotado, sem correção: o alerta de "repetido" ainda dispara para cardio em 3 ou mais dias.
