# performance-app — Roadmap

App pessoal de performance: treino, nutrição, sono, hábitos e foco, amarrados por uma camada de
gamificação de consistência com amigos.

- Spec da fundação e gamificação:
  [docs/superpowers/specs/2026-10-04-performance-app-foundation-design.md](superpowers/specs/2026-10-04-performance-app-foundation-design.md)
- Cada fase tem **spec própria → plano de implementação → execução**, nessa ordem. Fases 0 e 1 já
  estão especificadas; as demais estão descritas aqui em alto nível e serão detalhadas quando
  chegar a vez.

## Visão geral

```
Fase 0  Fundação ──► Fase 1a  Gamificação individual ──► Fase 1b  Social ──► Fase 1c  Check-in com foto
                                   │                                              │
                                   │                                              └──► Fase 1d  Plano com evidência
                                   │
                                   ├──► Fase 2  Nutrição ─┐
                                   ├──► Fase 3  Sono ─────┼──► Fase 5  Painel de performance
                                   └──► Fase 4  Hábitos + trackers ┘          │
                                                                              └──► Fase 6  Foco
```

Fases 2, 3 e 4 dependem só da 1a e podem ser feitas em qualquer ordem. Ordem de execução
combinada a partir de outubro de 2026: **1c → 1d → 3 → 4 → 5 → 6** (a 2 está concluída).

| Fase | Nome | Tamanho | Depende de | Status |
|---|---|---|---|---|
| 0 | Fundação | G | — | concluída |
| 1a | Gamificação individual | M | 0 | concluída |
| 1b | Social | M | 1a | concluída |
| 1c | Check-in com foto e social | M | 1b | especificada ([spec](superpowers/specs/2026-10-06-checkin-social-design.md)) |
| 1d | Plano com evidência | M | 1c | a especificar |
| 2 | Nutrição | G | 1a | concluída (2a e 2b) |
| 3 | Sono | P | 1a | especificada, execução adiada ([spec](superpowers/specs/2026-10-06-fase-3-sono-design.md)) |
| 4 | Hábitos + trackers | M | 1a | a especificar |
| 5 | Painel de performance | M | 2, 3, 4 | a especificar |
| 6 | Foco (ActivityWatch) | P | 1a | a especificar |

Tamanho: P ≈ alguns dias, M ≈ 1–2 semanas, G ≈ 2–4 semanas de trabalho focado.

---

## Fase 0 — Fundação

**Objetivo:** o openGym rodando como performance-app na Vercel, com login Google, perfil e dados
no Supabase.

**Entregas**
- Repo `Guilhermcm/performance-app` público, com a base openGym limpa (sem backend próprio, mobile
  nativo, admin, coach, passkeys, push, demo, locales além de pt-BR/en).
- Supabase: `profiles`, `app_state`, `push_state`, RLS.
- Login Google, onboarding em 3 passos, sugestão de plano inicial, tela Perfil.
- Sync do estado com conflito por `rev`, offline-first.
- Fila de eventos (`activity_events`) já emitindo `workout_completed`, `pr`, `weight_logged`.
- Design system: Tailwind v4 (sem preflight), shadcn, tokens + ponte para o CSS legado, TS para
  código novo.
- Vercel + CI GitHub Actions + README com guia de configuração.

**Pronto quando:** um usuário novo entra com Google no domínio Vercel, completa o onboarding, faz
um treino no celular, abre no notebook e vê o mesmo histórico; suíte vitest verde; build verde no CI.

**Origem:** openGym.

---

## Fase 1a — Gamificação individual

**Objetivo:** consistência vira progresso visível.

**Entregas**
- `xp_ledger`, `streaks`, `user_achievements`, trigger `award_xp`, `get_my_progress`, `pg_cron`.
- Regras de XP do pilar Força normalizadas por dias/semana (máx. 960 XP/semana para qualquer meta).
- Níveis geral e por pilar, streak semanal com escudos, ~20 conquistas.
- **Home redesenhada** em shadcn: nível, barra de XP, streak, XP da semana, treino do dia.
- Resumo pós-treino com XP animado, level-up e conquistas.
- Testes SQL (Vitest + PGlite) + cenários de paridade cliente/servidor.

**Pronto quando:** concluir um treino mostra o XP correto (igual ao do servidor), o streak fecha
certo na virada da semana no fuso do usuário e todas as regras têm teste.

**Origem:** Habitica (mecânicas, como referência).

---

## Fase 1b — Social

**Objetivo:** consistência entre amigos.

**Entregas**
- Convites por link, amizade mútua, `get_friends` com visibilidade restrita.
- Ranking semanal e geral.
- Desafios por modelo (`workouts_count`, `weeks_on_target`, `volume_total`), team/solo.
- Feed opt-in de treinos e PRs (linha do tempo própria, no estilo da Timeline do ReUI).
- TabBar nova com a área social.

**Pronto quando:** duas contas reais viram amigas por link, aparecem no ranking uma da outra, sem
nenhum dado sensível exposto (testado por RLS), e completam um desafio.

---

## Fase 1c — Check-in com foto e social

**Objetivo:** trocar o "começar treino" pelo check-in com foto, no estilo GymRats. O grupo segue o
plano de cabeça e quer saber se cumpriu a semana; a foto dá vida ao feed e credibilidade aos
desafios.

**Spec:** [2026-10-06-checkin-social-design.md](superpowers/specs/2026-10-06-checkin-social-design.md).

**Entregas**
- Barra: Início · Plano · **◉ Check-in** · Nutrição · Social; o botão do meio abre a câmera.
- Check-in com foto obrigatória (câmera ou galeria, sem metadados), qualquer atividade conta igual,
  título e legenda personalizáveis, observação privada, "Amigos" ou "Só eu", hoje ou ontem,
  "Detalhar treino" opcional (carga e repetições), fila offline com a foto.
- Feed de check-ins dos amigos com reações (qualquer emoji) e comentários; avisos no app.
- Desafio "Dias de treino"; placar e feed do desafio.
- Pilar Força vira **Treino**: meta de dias com check-in por semana, XP no molde de 960, fechamento
  em D+2; histórico antigo conta como dias de treino.
- Treino ao vivo sai do centro e fica no Plano ("Treinar com o app"), terminando no check-in.
- Home com o cartão "Hoje"; Plano com "Meus treinos" (calendário com fotos).
- Fotos no Supabase Storage em balde privado, links temporários, exclusão junto com o check-in e a
  conta.

**Pronto quando:** duas contas reais fazem check-in pelo celular (iPhone e Android, inclusive
offline), veem e reagem aos posts uma da outra, completam um desafio de dias de treino, e a
observação privada e a foto "Só eu" nunca aparecem para a outra conta (testado por RLS).

---

## Fase 1d — Plano com evidência

**Objetivo:** fazer do Plano o lugar onde mora o valor do treino: escolher e ajustar um bom plano,
com base em evidência científica, sem precisar registrar séries.

**Escopo previsto**
- **Catálogo curado de programas** (6 a 10 na primeira versão: hipertrofia 3x, 4x e 5x, força,
  iniciante, halteres, em casa, treino curto). Cada programa diz para quem é, o que esperar e por
  que é montado assim (volume por músculo, frequência, faixas de repetição, descanso). Escolher
  vira o seu plano, já distribuído na semana, e depois é ajustável.
- **Análise do plano da pessoa:** séries por músculo por semana contra a faixa recomendada,
  frequência de cada músculo, equilíbrio (empurrar e puxar, quadríceps e posterior), tempo estimado
  por treino, alertas (músculo esquecido, exercício repetido demais) e sugestões aplicáveis com um
  toque. Funciona sem histórico: lê o plano.
- **Progresso dos exercícios** para quem usa "Detalhar treino": evolução de carga e "suba a carga"
  ao bater as repetições. Quem não detalha não vê essa parte.
- **Referências em ⓘ, nunca no texto.** O texto da tela diz a recomendação em linguagem simples
  ("10 a 20 séries por semana"); um ícone ⓘ ao lado abre, por toque (não por passar o mouse, que
  não existe no celular), um balão pequeno ancorado acima do ícone com a fonte: autores, ano,
  título curto, uma linha do que o estudo achou e o link (DOI). Em tela estreita o balão vira uma
  folha que sobe de baixo. O botão tem rótulo acessível ("Ver fonte") e alvo de 44 px; o balão
  fecha ao tocar fora ou no X e devolve o foco ao ícone. As referências ficam num catálogo único
  no código (id → citação), e cada recomendação aponta para ids, para não repetir citação nem
  deixar texto solto sem fonte.
- **Revisão do conteúdo:** os programas e as citações são propostos no brainstorm e conferidos por
  alguém do grupo antes de entrar.

**Fora:** gerador automático de plano, periodização em blocos e deload como recurso próprio (podem
aparecer como característica de um programa do catálogo), coach com IA.

**Pronto quando:** alguém escolhe um programa do catálogo e ele vira o plano da semana; a análise
mostra volume e frequência por músculo do plano atual com pelo menos uma sugestão aplicada; toda
recomendação com número tem um ⓘ com fonte verificável.

---

## Fase 2 — Nutrição

**Objetivo:** trocar o app de dieta que o grupo já usa: meta de calorias e macros derivada do
perfil, diário rápido, pilar Nutrição na gamificação.

**Spec:** [2026-10-05-fase-2-nutricao-design.md](superpowers/specs/2026-10-05-fase-2-nutricao-design.md).

**2a, trocar de app**
- Meta por Mifflin-St Jeor × nível de atividade, ajustada pelo objetivo; modo automático ou manual.
- Pilar opt-in com períodos ativos; semana com dia desligado é neutra para o streak.
- Diário por refeição (café, almoço, jantar, lanches), registro rápido, hoje e ontem editáveis.
- Busca: recentes, favoritos, alimentos próprios, **TACO** local e **Open Food Facts**; código de
  barras pela câmera (BarcodeDetector com fallback ZXing); copiar refeição ou dia.
- Tabelas `food_logs`, `user_foods`, `nutrition_targets`, `nutrition_days`, `nutrition_periods`.
- Dia fechado pelo servidor em D+2; eventos `day_logged`, `day_on_target`, `macros_balanced`;
  960 XP/semana no molde da Força; streak `nutrition_week`; conquistas privadas.
- Aba Nutrição na TabBar; **radar de pilares** na Home (shadcn/ui Charts) e barra de XP por pilar.

**2b, medidas, histórico e desafio, concluída** ([spec](superpowers/specs/2026-10-06-fase-2b-nutricao-design.md))
- Medidas caseiras pessoais e da POF/IBGE (113 alimentos da TACO com medidas sugeridas), criadas
  e usadas offline na tela da porção.
- Histórico em calendário do mês, com o detalhe de cada dia.
- Desafio `nutrition_days_on_target` (equipe e solo), com opt-in; os participantes veem só a
  contagem de dias no alvo.
- Pendências da 2a resolvidas: dados reais da TACO, ativação sem metas carregadas, diário depois
  da meia-noite, "Copiar de" com falha online e plurais em pl, ru e uk.

**Fora:** USDA, importação de histórico e receitas (reavaliar ao abrir ao público), wger.

**Origem:** OpenNutriTracker (fórmulas, diário, integração OFF), como referência.

---

## Fase 3 — Sono

**Objetivo:** registrar e melhorar regularidade e duração do sono.

**Escopo previsto**
- Sessão de sono: botão "dormir/acordei" ou registro manual, nota de qualidade (1–5), observação.
- Estatísticas: duração média, regularidade (desvio do horário de dormir/acordar), débito de sono
  na semana, tendência.
- Meta de sono no perfil (horas e horário-alvo).
- Import CSV (formato Plees e genérico).
- Eventos: `sleep_logged`, `night_on_target`. XP no molde padrão. Desafio: `sleep_nights_on_target`.
- Acende o eixo Sono no radar de pilares da Home.
- Fora: rastreio por sensores/sonar (exige app nativo). Na spec, saíram também o botão
  "dormir/acordei" (registro só de manhã) e o import CSV.

**Origem:** Plees Tracker (modelo e estatísticas). Somn descartado (imaturo e dependente de sensores
nativos).

---

## Fase 4 — Hábitos + trackers

**Objetivo:** medir qualquer coisa e transformar hábitos em consistência.

**Escopo previsto**
- **Hábitos**: diários ou N vezes por semana, check rápido, lembretes no app.
- **Trackers genéricos**: métricas definidas pelo usuário dos tipos numérico, duração e rótulo
  (ex.: água, humor, passos, meditação, leitura), agrupadas, com gráficos de linha, pizza, "tempo
  desde o último" e médias móveis.
- Tabelas `habits`, `habit_checks`, `trackers`, `tracker_entries`.
- Eventos: `habit_checked`, `habit_week_on_target`, `tracker_logged`. XP no molde padrão.
- Acende o eixo Hábitos no radar de pilares da Home.

**Origem:** Habitica (hábitos/dailies), Track & Graph (modelo de tracker e gráficos).

---

## Fase 5 — Painel de performance

**Objetivo:** uma visão única de como você está, e o que mais influencia seu desempenho.

**Escopo previsto**
- **Performance Score** diário (0–100) combinando os pilares ativos.
- Correlações: sono × carga/volume, déficit calórico × força, hábitos × consistência.
- **Missões semanais** geradas pelo perfil e pelos pontos fracos da semana anterior.
- Radar de pilares detalhado e comparação com amigos no radar.
- Tabelas analíticas derivadas do JSONB de treino (sessões, séries, 1RM por exercício) via função de
  extração, para consultas e gráficos rápidos.
- Migração das telas herdadas restantes (Stats, History, Plan, Settings, RoutineEdit, Library;
  Workout por último).
- Limpeza da base: remover `lib/mobile.js`, `lib/demo.js`, `lib/coach*.js`, `lib/remote.js`,
  dependências `@capacitor/*`, packs de idioma fora de en/pt-BR e os ramos mortos que dependem deles.

---

## Fase 6 — Foco

**Objetivo:** trazer tempo de foco/produtividade para o quadro de performance.

**Escopo previsto**
- Script local (Node ou Python) que lê a API do ActivityWatch (`localhost:5600`), resume o dia por
  categoria (produtivo, neutro, distração) e envia ao Supabase com um token pessoal.
- Tabela `focus_days`; eventos `focus_day_logged`, `focus_day_on_target`; pilar `focus` adicionado
  ao enum.
- Correlação foco × sono no painel.
- Quinto eixo (Foco) no radar de pilares.

**Origem:** ActivityWatch (via API, sem portar código).

---

## Fora do roadmap por enquanto

App nativo (Capacitor/loja), push notifications, AI Coach, integrações com Google Fit/Apple
Health/Strava/Garmin, monetização. Reavaliar depois da Fase 5.
