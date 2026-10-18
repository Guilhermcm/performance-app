# Fase 1e: Corrida e treino híbrido

- **Data:** 2026-10-18
- **Status:** design aprovado por seções e spec aprovada em 2026-10-18; plano da 1e-a em
  [2026-10-18-fase-1e-a-corrida-plano.md](../plans/2026-10-18-fase-1e-a-corrida-plano.md).
  1e-a concluída no código em 2026-10-18 (sem SQL; falta a revisão final e o merge). A 1e-b ainda
  não tem plano.
- **Subetapas:** **1e-a** (questionário, modelos, ritmos, semana híbrida e cartão do dia; só cliente) e
  **1e-b** (check-in de corrida, bônus de detalhado, feed, acompanhamento e sugestões; com uma
  migration). Cada uma com plano e PR próprios. A 1e-b começa depois do merge da 1e-a.
- **Base:** [spec da 1d](2026-10-12-fase-1d-plano-evidencia-design.md) (programas, `S.week`, Plano) e
  [spec da 1c](2026-10-06-checkin-social-design.md) (check-in, `checkins.detail`, `training_days`).
- **Roadmap:** [docs/ROADMAP.md](../../ROADMAP.md), Fase 1e.

## 1. Entendimento e objetivo

Hoje o Treino é quase só musculação. Uma corrida já conta como dia de treino pelo check-in (atividade
"Corrida", com duração e foto), mas não há plano de corrida, distância, ritmo nem zonas, e a semana do
Plano só conhece rotinas de musculação.

A 1e faz da corrida parte do Treino: a pessoa responde um questionário (meta, prazo, como está hoje),
recebe um plano de corrida a partir de modelos prontos, vê a semana híbrida com corrida e musculação
intercaladas, registra cada corrida ligada ao plano e acompanha a evolução, com sugestões de ajuste que
ela aprova.

**Pronto quando:**

1. alguém responde o questionário e aplica um plano de corrida que encaixa os treinos na semana sem
   mexer nas rotinas de musculação;
2. cada treino de corrida mostra os blocos em minutos por zona, com descrição da sensação e, havendo
   referência, a faixa de ritmo;
3. o check-in de corrida registra distância e esforço ligados ao treino do dia e conta como treino
   detalhado;
4. `/plan/corrida` mostra a semana feita contra a planejada, a evolução do volume e pelo menos uma
   sugestão das regras da §8, aplicada com um toque.

## 2. Decisões do brainstorm

| Tema | Decisão |
|---|---|
| Origem do plano | modelos prontos, como os programas da 1d, ajustados pelo questionário (prazo, dias, ponto de partida), com cada treino detalhado em blocos |
| Intensidade | sensação é a regra; ritmo-alvo por zona calculado da referência do questionário (VDOT de Jack Daniels) |
| Registro | check-in de corrida ligado ao plano: "Fiz como planejado" com um toque; duração, distância (opcional) e esforço 1 a 10; blocos abrem só para ajustar |
| Semana | uma semana só; o app encaixa as corridas em volta da musculação por regras e avisa quando uma troca as quebra |
| Metas | começar a correr, 5 km, 10 km, meia maratona e manter a forma; provas com meta de completar ou de tempo |
| XP | corrida com distância ou esforço conta como treino detalhado, com ou sem plano; mesmo limite de 3 por semana somando musculação e corrida; teto de 960 sem mudança |
| Desvios do plano | o app sugere (repetir semana, voltar semana, atualizar ritmos, registrar a prova) e a pessoa decide |
| Social | o cartão do feed ganha tipo de treino e distância, na visibilidade do check-in; o resto fica só com a pessoa |
| Arquitetura | plano em `S.runPlan` no estado sincronizado (`app_state`), modelos no código, registro no `checkins.detail`; sem tabela nova |
| Pilar | continua Treino (`strength`); sem eixo novo no radar |

## 3. Questionário

Abre na primeira vez que a pessoa toca em "Montar plano de corrida" e pode ser refeito em
`/plan/corrida` ("Refazer questionário", que substitui o plano depois de uma confirmação). Cinco passos
num Drawer, com voltar e avançar:

1. **Meta:** `start` (começar a correr), `5k`, `10k`, `half` (meia maratona, 21,0975 km) ou `maintain`
   (manter a forma).
2. **Tipo de meta** (só `5k`, `10k`, `half`): `finish` (completar) ou `time` (bater um tempo, em
   `h:mm:ss`). `time` só aparece quando o passo 4 deu uma referência de prova (§4.1); sem ela, o
   passo explica que o tempo-alvo fica disponível depois de registrar uma corrida com distância.
3. **Prazo:** data da prova (de hoje + 4 semanas a hoje + 52 semanas) ou número de semanas. `maintain`
   não pede prazo: é um ciclo de 8 semanas que recomeça ao terminar.
4. **Como está hoje**, uma opção:
   - `race`: um tempo recente numa distância (1 a 42,195 km, tempo de 3 min a 6 h, "recente" é nos
     últimos 3 meses; mais antigo, o app pede outra referência ou segue sem ritmo);
   - `continuous`: "consigo correr X minutos sem parar" (1 a 180);
   - `none`: "não corro hoje".
5. **Dias de corrida por semana** (dentro do intervalo da meta, §5.1) e **dia preferido do longão**
   (um dia da semana).

O questionário guarda as respostas em `S.runPlan.answers` para refazer com os valores preenchidos.

## 4. Ritmos

### 4.1 VDOT

Com uma referência `race` (distância `d` em metros, tempo `t` em minutos), o VDOT vem das fórmulas de
Daniels e Gilbert:

```
v      = d / t                                   (m/min)
VO2    = -4.60 + 0.182258·v + 0.000104·v²
%max   = 0.8 + 0.1894393·e^(-0.012778·t) + 0.2989558·e^(-0.1932605·t)
VDOT   = VO2 / %max
```

O VDOT é guardado com uma casa decimal. Referências `continuous` e `none` não têm VDOT: o plano segue
só pela sensação até a pessoa registrar uma corrida com distância e aceitar a sugestão de atualizar os
ritmos (§8).

### 4.2 Zonas

Velocidade por fração do VDOT: resolver `VO2 = f·VDOT` para `v` na equação acima (raiz positiva) e
converter para ritmo em min/km.

| Zona | Nome na tela | Fração do VDOT | Sensação (texto da tela) |
|---|---|---|---|
| `easy` | Leve | 0,59 a 0,74 | dá para conversar |
| `moderate` | Moderado | 0,83 a 0,88 | só frases curtas |
| `hard` | Forte | 0,95 a 1,00 | só poucas palavras |
| `walk` | Caminhada | sem ritmo | caminhar firme, recuperando |

Os ritmos são arredondados a 5 s e mostrados como faixa ("5:40 a 5:55 /km"). A tabela de Daniels é o
fixture dos testes: VDOT 30, 40, 50 e 60 devem dar as faixas da tabela com tolerância de 5 s/km.

### 4.3 Previsão de prova

Tempo previsto numa distância `D` para um VDOT: resolver `VDOT = VO2(D/t) / %max(t)` em `t` por
bisseção (1 a 600 min, tolerância de 1 s). Usado para validar a meta de tempo (§5.3) e para mostrar
"seu ritmo de hoje dá cerca de 55:30 nos 10 km".

## 5. Modelos

### 5.1 Famílias

Um modelo é código em `src/features/run/models.ts`, versionado e testado. Cada família tem variantes por
dias por semana e uma duração mínima.

| Meta | Dias | Semanas (mínimo) | Treinos usados |
|---|---|---|---|
| `start` | 2 ou 3 | 8 | Corre e caminha, Leve |
| `5k` | 2, 3 ou 4 | 8 | Leve, Longão, Ritmo, Intervalado |
| `10k` | 3 ou 4 | 10 | Leve, Longão, Ritmo, Intervalado |
| `half` | 3 ou 4 | 12 | Leve, Longão, Ritmo, Intervalado |
| `maintain` | 2, 3 ou 4 | ciclo de 8 | Leve, Longão, Ritmo |

`start` com referência `continuous` de 20 min ou mais pula as primeiras semanas do modelo (começa na
semana em que o bloco contínuo mais longo é maior ou igual a 60% dos minutos informados).

### 5.2 Treinos

| Tipo | Nome | Blocos |
|---|---|---|
| `runwalk` | Corre e caminha | repetições de corrida leve e caminhada |
| `easy` | Leve | aquecimento opcional e um bloco leve contínuo |
| `long` | Longão | um bloco leve longo |
| `tempo` | Ritmo | 10 min leve, blocos moderados, 5 a 10 min leve |
| `intervals` | Intervalado | 10 min leve, repetições fortes com recuperação leve ou caminhada, 5 a 10 min leve |

Um treino é uma lista de até 12 itens; cada item é um bloco `{ zone, min }` (min de 1 a 300) ou uma
repetição `{ repeat: 2..20, blocks: [{ zone, min }, ...] }` com até 4 blocos. O volume da semana é a
soma dos minutos.

### 5.3 Montagem pelo prazo e pela meta

- **Fases:** base, construção, específica e, nas provas, polimento (1 semana em `5k`, 2 em `10k` e
  `half`, com 40% e 25% menos volume).
- **Recuperação:** a cada 4 semanas, uma semana com 25% menos volume e sem Intervalado.
- **Progressão:** o volume planejado de uma semana nunca passa de 110% do da semana anterior que não
  seja de recuperação.
- **Prazo maior que o mínimo:** acrescenta semanas de base no início (no máximo 8). Além disso, o plano
  começa mais tarde e, até lá, o app oferece `maintain`.
- **Prazo menor que o mínimo:** o app avisa e oferece duas saídas: o prazo mínimo (nova data) ou a meta
  de completar com o plano encurtado (tira semanas de base, nunca a específica nem o polimento). Abaixo
  de 6 semanas para `10k` e de 8 para `half`, só o prazo mínimo.
- **Meta de tempo:** aceita quando o VDOT necessário para o tempo-alvo (§4.3, inverso) é menor ou igual
  a `VDOT atual + semanas / 4`, com teto de `+6`. Fora disso, o app mostra o tempo possível no prazo e
  oferece usá-lo.
- **Notas da implementação (1e-a):** `start` segue a sua tabela fixa de corre e caminha e fica fora
  da regra dos 110%. Nas semanas de recuperação, cada tipo de treino usa o seu degrau mais leve. A
  fase específica sempre chega ao treino mais forte dela. Semanas muito pequenas, de planos que
  começam com 20 minutos de Leve, podem ficar abaixo das proporções de polimento e de recuperação,
  porque os treinos já estão no tamanho mínimo. Quando o plano da prova começa mais tarde, o
  questionário mostra a data de início antes de "Criar plano" e oferece, já ligado, seguir um ciclo
  de `maintain` até lá. Essas semanas vêm primeiro no plano, com a fase `maintain`, e partem do
  mesmo Leve e do mesmo Longão da primeira semana da prova, para a passagem respeitar os 110%.
- **Ritmos do plano:** os treinos guardam zonas, não ritmos; a faixa de ritmo é calculada na hora com o
  VDOT atual do plano, então atualizar a referência muda os ritmos de todos os treinos seguintes.

## 6. Semana híbrida

### 6.1 Plano no estado

`S.runPlan` (no `app_state`, sincronizado como o resto do Plano):

```
{ version: 1, goal, goalType, targetTime?, raceDate?, startDate, answers,
  vdot?, vdotSource: 'race' | 'run' | null, vdotDate?,
  weeks: [{ index, phase, recovery, sessions: [{ id, type, blocks, day }] }],
  dismissed: { [suggestionKey]: string } }
```

`S.week` (rotinas de musculação por dia) não muda. `day` é o dia da semana em que a corrida foi
encaixada naquela semana. O dia da semana segue `getDay()`, 0 = domingo a 6 = sábado, a mesma
convenção de `S.week` (Decisão 1 do plano da 1e-a; a versão aprovada desta spec dizia 0 = segunda).
As semanas do plano começam no primeiro dia da semana da pessoa no momento em que o plano foi criado,
guardado em `weekStart` (planos salvos antes disso usam `S.weekStart`), então mudar o início da semana
depois não muda os treinos de dia. Num plano `maintain` que começou no meio da semana, `openingDays`
guarda os dias da primeira semana do calendário; os ciclos seguintes usam a semana inteira.

### 6.2 Encaixe

Ao aplicar o plano e a cada semana nova, as corridas da semana vão para os dias por estas regras, em
ordem:

1. O Longão vai no dia preferido.
2. Ritmo e Intervalado nunca no dia seguinte a um **dia de perna**: dia cuja rotina de musculação tem
   mais da metade das séries planejadas em quadríceps, posteriores ou glúteos (pelo `bp` dos
   exercícios).
3. Nunca dois **dias fortes** seguidos: Ritmo, Intervalado e dia de perna são fortes.
4. Dias sem musculação têm preferência. Sem dia livre, só um treino Leve ou Corre e caminha pode ficar
   no mesmo dia de uma rotina de musculação.
5. Se não houver encaixe que cumpra 2 e 3, o app encaixa o mais perto possível e mostra o aviso da
   regra quebrada no cartão do treino.

Mover um treino para outro dia é livre; se a mudança quebrar a regra 2 ou 3, o cartão mostra o aviso em
texto ("Intervalado no dia depois de perna"). O encaixe é uma função pura, testada com semanas de
exemplo.

### 6.3 Meta de dias

Ao aplicar o plano, o app mostra quantos dias diferentes a semana tem (musculação, corrida ou os dois)
e, se for diferente de `profiles.days_per_week`, oferece atualizar. A mudança vale a partir da semana
seguinte pelo congelamento que já existe (`freeze_week_target`).

### 6.4 Telas

- **`/plan`:** cada dia da semana atual mostra a rotina de musculação e o cartão da corrida (tipo,
  blocos em linha, faixas de ritmo e o aviso de encaixe, se houver). Sem plano, a seção mostra "Montar
  plano de corrida".
- **`/plan/corrida`:** meta e prazo, linha das fases, lista de semanas (atual em destaque), ritmos por
  zona com a data da referência, previsão de prova, "Refazer questionário" e "Encerrar plano" (com
  confirmação; o histórico de check-ins fica). Na 1e-b, ganha o acompanhamento e as sugestões (§8).

## 7. Registro, XP e feed (1e-b)

### 7.1 Check-in de corrida

O check-in continua o mesmo (atividade "Corrida", foto, legenda, visibilidade). Num dia com corrida no
plano, ele abre ligado ao treino do dia, mostra os blocos e oferece "Fiz como planejado"; "Ajustar"
abre os blocos para mudar zonas e minutos. Sem treino no dia, a corrida é "fora do plano".

`checkins.detail` ganha a parte `run`:

```
run: { planned?: { week, session, type, blocks },   -- cópia do treino no momento do registro
       distance_km?: number,                         -- 0,1 a 100, duas casas
       rpe?: integer,                                -- 1 a 10
       blocks?: [{ zone, min }],                     -- até 12; ausente quando "como planejado"
       status: 'as_planned' | 'adjusted' | 'unplanned' }
```

O ritmo médio é calculado no app (`duration_min / distance_km`).

### 7.2 Banco (migration da 1e-b)

- `checkins_guard` valida `detail.run`: tipos, `distance_km` de 0,1 a 100 com no máximo duas casas,
  `rpe` inteiro de 1 a 10, no máximo 12 blocos com `zone` em `easy|moderate|hard|walk` e `min` de 1 a
  300, `status` válido, `run` só com `activity = 'run'`. Recusa: `invalid_run_detail`.
- `close_training_days` passa a marcar o dia como **detalhado** quando um check-in do dia tem
  `detail.entries` não vazio (como hoje) **ou** `detail.run` com `distance_km` ou `rpe`. O `award_xp`
  não muda: `training_detailed` paga 30, no máximo 3 por semana, somando musculação e corrida; teto
  semanal de 960.
- `get_checkin_feed` devolve, para um check-in de corrida, só `run_type` (o `planned.type`, ou nulo) e
  `distance_km`; nunca `rpe`, blocos nem o plano.
- Funções redefinidas partem do corpo mais recente (`0020_checkin_feed.sql` para `checkins_guard` e
  `get_checkin_feed`; `0019_training_days.sql` ou o mais recente para `close_training_days`), com linha
  em `function-bodies.test.ts` e teste de paridade de Treino.

### 7.3 Feed

O cartão do check-in de corrida mostra "Intervalado · 6,2 km · 38 min" (tipo quando houver, distância
quando houver, duração), na visibilidade do check-in.

## 8. Acompanhamento e sugestões (1e-b)

### 8.1 Acompanhamento em `/plan/corrida`

- **Semana atual:** treinos feitos contra planejados ("2 de 3"), minutos e quilômetros.
- **Evolução:** barras de minutos de corrida por semana com o volume planejado como referência, pela
  skill `dataviz` e o validador de cores, com descrição em texto e "Ver como tabela".
- **Marcos:** longão mais longo, maior distância e ritmo médio dos treinos leves nas últimas 4 semanas.
- Um treino planejado conta como **feito** quando há check-in de corrida ligado a ele (`planned.session`)
  ou, sem ligação, um check-in de corrida no mesmo dia.

### 8.2 Sugestões

Uma de cada vez, num cartão em `/plan/corrida` e no topo de `/plan`, com "Aplicar" e "Agora não". "Agora
não" grava a chave da sugestão em `dismissed` com a data; ela volta só quando a condição muda (outra
semana, outra corrida). Prioridade:

1. **Prova passou:** depois de `raceDate`, pede o tempo da prova; com ele, oferece atualizar os ritmos
   e escolher a próxima meta (abre o questionário).
2. **Semana fraca:** na semana anterior, menos da metade dos treinos planejados foram feitos → "Repetir
   a semana". Com `raceDate`, a repetição tira uma semana de base à frente; sem semana de base, avisa
   que o prazo ficou apertado e oferece a meta de completar.
3. **Esforço alto:** em duas semanas seguidas, dois ou mais treinos Leve ou Longão com `rpe ≥ 8` →
   "Voltar uma semana".
4. **Mais rápido:** uma corrida com `distance_km ≥ 3`, `rpe ≥ 8` e VDOT (§4.1, pela distância e duração)
   maior que o do plano → "Atualizar seus ritmos".

Não há sugestão de avançar semana.

## 9. Cliente

`src/features/run/`: `vdot.ts` (VDOT, zonas, previsão; puro), `models.ts` (famílias e montagem; puro),
`fit.ts` (encaixe na semana; puro), `suggestions.ts` (regras da §8.2; puro, 1e-b), `types.ts`,
`labels.ts`, `RunQuestionnaire.tsx`, `RunPlanScreen.tsx` (`/plan/corrida`), `RunDayCard.tsx` (cartão do
dia em `/plan`), `RunCheckinForm.tsx` (parte de corrida do check-in, 1e-b) e `RunProgress.tsx`
(1e-b, gráfico em chunk sob demanda).

## 10. Texto público e privacidade

- Toda string nova nos 16 packs (pt-BR por `PT_BR_OVERRIDES`), sem travessão nem hífen como pausa,
  pelo humanizer; os dois scripts de locale passam.
- **Só a pessoa vê:** o plano, a meta, o prazo, os ritmos, o esforço e os blocos.
- **Pode ir para amigos:** tipo de treino e distância, dentro do check-in que a pessoa escolheu
  compartilhar.
- A página de privacidade ganha esse trecho em pt-BR e en na 1e-b.

## 11. Testes

- `vdot.ts`: VDOT de 5 km em 20:00, 25:00 e 30:00 contra a tabela de Daniels; faixas de zona para VDOT
  30, 40, 50 e 60; previsão de 10 km a partir de 5 km.
- `models.ts`: cada família e variante monta sem passar de 110%; recuperação a cada 4 semanas;
  polimento; prazo maior acrescenta base; prazo menor oferece as saídas; meta de tempo impossível vira
  tempo possível; `start` com 25 min contínuos pula semanas.
- `fit.ts`: longão no dia preferido; nada forte depois de perna; nunca dois fortes seguidos; dia de
  musculação recebe só Leve; aviso quando não há encaixe.
- `suggestions.ts`: as quatro regras, a prioridade e o "Agora não".
- **SQL (1e-b):** `detail.run` válido e inválido; detalhado com corrida; limite de 3 somando musculação
  e corrida; teto de 960; feed sem `rpe`; corpos redefinidos e paridade.
- **Telas:** questionário (cada caminho), `/plan/corrida`, cartão do dia, check-in de corrida.

## 12. Fora de escopo

Maratona; frequência cardíaca; integração com relógio, Strava ou saúde do celular; GPS no app; desafio de
quilômetros; sugestão de avançar semana; ritmo por bloco; plano com mais de uma prova ao mesmo tempo.

## 13. Riscos

| Risco | Mitigação |
|---|---|
| Plano agressivo junto com musculação | progressão de 10%, recuperação a cada 4 semanas, regras de encaixe, sem avançar semana |
| VDOT de uma referência ruim | referência só dos últimos 3 meses; atualizar ritmos só por sugestão aceita |
| `S.runPlan` grande no `app_state` | semanas guardam só tipo, blocos e dia (≤ 64 semanas); teste de tamanho |
| Cliente antigo lendo check-in com `run` | `detail.run` é campo novo e opcional; o cliente atual ignora |
| Funções redefinidas quebrarem Treino | teste de corpo e de paridade como nas fases 3 e 4 |

## 14. Publicação

- **1e-a:** só cliente, sem SQL; merge direto depois da revisão.
- **1e-b:** `supabase/release/0032_run.sql` (ou o número livre na hora) roda em produção antes do merge,
  pelo roteiro em `docs/SETUP.md`, porque o cliente novo envia `detail.run`.
