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
Fase 0  Fundação ──► Fase 1a  Gamificação individual ──► Fase 1b  Social
                                   │
                                   ├──► Fase 2  Nutrição ─┐
                                   ├──► Fase 3  Sono ─────┼──► Fase 5  Painel de performance
                                   └──► Fase 4  Hábitos + trackers ┘          │
                                                                              └──► Fase 6  Foco
```

Fases 2, 3 e 4 dependem só da 1a e podem ser feitas em qualquer ordem. A ordem abaixo é a
recomendada (impacto em performance física primeiro).

| Fase | Nome | Tamanho | Depende de | Status |
|---|---|---|---|---|
| 0 | Fundação | G | — | especificada |
| 1a | Gamificação individual | M | 0 | concluída |
| 1b | Social | M | 1a | especificada |
| 2 | Nutrição | G | 1a | a especificar |
| 3 | Sono | P | 1a | a especificar |
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
- Feed opt-in de treinos e PRs (ReUI Timeline).
- TabBar nova com a área social.

**Pronto quando:** duas contas reais viram amigas por link, aparecem no ranking uma da outra, sem
nenhum dado sensível exposto (testado por RLS), e completam um desafio.

---

## Fase 2 — Nutrição

**Objetivo:** meta calórica e de macros derivada do perfil, diário alimentar rápido, pilar Nutrição
na gamificação.

**Escopo previsto**
- Perfil ganha nível de atividade (PAL); meta calórica por Mifflin-St Jeor × PAL ajustada pelo
  objetivo (déficit/superávit), divisão de macros configurável.
- Diário por refeição (café, almoço, jantar, lanches), copiar refeição de outro dia, favoritos,
  receitas simples.
- Busca de alimentos: **Open Food Facts** (código de barras e texto, inclui produtos brasileiros) e
  **USDA FoodData Central**; **TACO** (tabela brasileira) como base local de alimentos in natura;
  API do **wger** como fonte complementar de ingredientes.
- Tabelas normalizadas (`foods`, `food_logs`, `nutrition_targets`), cache dos alimentos usados.
- Eventos: `meal_logged`, `day_on_target` (calorias ±10% e proteína ≥ meta).
- XP: 600 de consistência (dias no alvo) + 150 meta semanal + extras.
- Desafio: `nutrition_days_on_target`.
- UI: Dice UI Combobox na busca, ReUI Data Grid/Calendar no histórico, leitor de código de barras
  pela câmera (BarcodeDetector com fallback em JS).

**Origem:** OpenNutriTracker (fórmulas, diário, integração OFF/FDC), wger (API e modelo de plano).

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
- Fora: rastreio por sensores/sonar (exige app nativo).

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

**Origem:** Habitica (hábitos/dailies), Track & Graph (modelo de tracker e gráficos).

---

## Fase 5 — Painel de performance

**Objetivo:** uma visão única de como você está, e o que mais influencia seu desempenho.

**Escopo previsto**
- **Performance Score** diário (0–100) combinando os pilares ativos.
- Correlações: sono × carga/volume, déficit calórico × força, hábitos × consistência.
- **Missões semanais** geradas pelo perfil e pelos pontos fracos da semana anterior.
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

**Origem:** ActivityWatch (via API, sem portar código).

---

## Fora do roadmap por enquanto

App nativo (Capacitor/loja), push notifications, AI Coach, integrações com Google Fit/Apple
Health/Strava/Garmin, monetização. Reavaliar depois da Fase 5.
