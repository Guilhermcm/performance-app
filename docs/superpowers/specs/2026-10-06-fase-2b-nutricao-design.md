# performance-app: Design da Fase 2b, Nutrição (medidas, histórico e desafio)

- **Data:** 2026-10-06
- **Status:** aguardando revisão
- **Roadmap:** [docs/ROADMAP.md](../../ROADMAP.md), Fase 2
- **Base:** [spec da Fase 2](2026-10-05-fase-2-nutricao-design.md) (2a implementada, ver §16 dela) e
  [spec da Fundação](2026-10-04-performance-app-foundation-design.md) (desafios da 1b em §6)

## 1. Entendimento e objetivo

**O que foi dito.** A 2a está pronta. O grupo não vai usar importação de outros apps e receitas
não fazem diferença no dia a dia; os dois saem da fase. Ficam três coisas: medidas caseiras,
histórico em calendário e desafio de nutrição. Medidas caseiras em dois níveis juntos: medidas
pessoais (a pessoa define) e medidas sugeridas (tabela da POF/IBGE). As pendências da 2a entram
onde fizer sentido.

**Critério de sucesso.** Registrar arroz, feijão e carne em colheres e conchas sem pensar em
gramas; olhar o mês e ver a consistência; desafiar os amigos em dias no alvo sem expor o que
cada um comeu.

**Fora da 2b.** Importação de histórico e receitas (anotadas no roadmap para reavaliar ao abrir ao
público), comparação de endpoints do Open Food Facts (rede bloqueada neste ambiente), USDA.

## 2. Decisões tomadas

| Tema | Decisão |
|---|---|
| Escopo | medidas caseiras (pessoais + sugeridas), histórico em calendário, desafio `nutrition_days_on_target`, pendências da 2a |
| Fontes de dados | TACO 4ª ed. e Tabela de Medidas Referidas da POF 2008-2009 (IBGE), a partir das planilhas oficiais redistribuídas em [brolesi/taco](https://github.com/brolesi/taco); termos da TACO confirmados no PDF oficial: "É permitida a reprodução total ou parcial do material, desde que seja citada a fonte." |
| Medidas | pessoais por alimento de qualquer origem; sugeridas só para alimentos da TACO mapeados; pessoais aparecem antes |
| Calendário | grade feita com Tailwind, sem dependência nova |
| Desafio | novo modelo no molde da 1b, com opt-in de compartilhar dias no alvo e fechamento 2 dias depois do fim |

## 3. Medidas caseiras

### 3.1 Medidas pessoais

- Tabela `food_measures` (§6.1). `food_key` identifica o alimento em qualquer origem:
  `taco:<id>`, `off:<código de barras>`, `custom:<id de user_foods>`. Itens do registro rápido não
  têm medida.
- Criar na tela de porção: "Criar medida" abre um passo curto com nome (1 a 30 caracteres,
  ex.: "concha") e gramas (1 a 2000). A quantidade atual da porção vem preenchida.
- Editar e apagar: toque longo ou menu no chip da medida.
- Limites: 10 por alimento, 500 por pessoa. Offline pela fila do diário (`kind: 'measure'`).

### 3.2 Medidas sugeridas

- `scripts/data/taco-pof-map.csv`: correspondência curada entre alimentos da TACO e alimentos e
  preparos da POF (`taco_id, pof_codigo_alimento, pof_codigo_preparacao`), para os cerca de 100
  alimentos da TACO mais comuns no prato brasileiro (arroz, feijões, carnes, ovos, pães, frutas,
  leite e derivados, legumes, tubérculos, massas, oleaginosas). A primeira versão do arquivo é
  gerada por script com casamento de nomes e revisada linha a linha.
- `scripts/build-taco.mjs` passa a gerar também `src/features/nutrition/data/taco-measures.json`:
  `{ [taco_id]: [{ label, grams }] }`, até 6 medidas por alimento, sem duplicatas de nome, em
  ordem de tamanho. Rótulos da POF ("COLHER DE ARROZ/SERVIR") viram texto legível em pt-BR
  ("colher de servir") por uma tabela de nomes no script.
- Carregado junto da TACO (mesmo chunk sob demanda, já guardado pelo service worker).
- Citação na tela: "Medidas: POF 2008-2009, IBGE". `NOTICE.md` ganha a POF.
- Rótulos de medidas sugeridas não são traduzidos: são dados brasileiros, como os nomes da TACO.

### 3.3 Tela de porção

- Fileira de chips, nesta ordem: medidas pessoais, medidas sugeridas, porção do rótulo, "última
  vez" (recentes), atalhos em gramas.
- Tocar numa medida define "1 × medida"; um stepper de quantidade (0,5 em 0,5 até 20) multiplica.
  A linha de totais mostra "2 colheres de servir · 90 g".
- O item registrado continua guardando só gramas e totais (§4.1 da spec da 2a); a medida usada
  não é persistida no item.

## 4. Histórico em calendário

- Entrada: botão "Histórico" no cabeçalho da aba Nutrição; rota `/nutricao/historico`.
- Mês em grade segunda a domingo. Estado de cada dia com ícone e rótulo (nunca só cor):
  no alvo (check na cor do pilar), registrado fora do alvo (ponto), sem registro (anel vazio),
  fora do período ou antes da ativação (apagado), hoje e ontem abertos (contorno).
- Ao lado de cada semana: "4/5 no alvo" e selo quando a meta semanal foi batida. No topo: streak
  atual e melhor streak. Navegação mês a mês até o primeiro período do pilar.
- Toque num dia: sheet com kcal e macros contra a meta do dia, classe do dia, XP que rendeu e os
  itens por refeição. Itens de dias com mais de 14 dias são buscados online; offline o sheet mostra
  o resumo e "Os itens desse dia precisam de conexão".
- Dados: `get_nutrition_days(p_from, p_to)` por mês (até 62 dias, já existe) passa a devolver
  `xp` por dia (soma dos `xp_ledger` do pilar com `event_id` dos eventos daquele dia) e
  `week_target_hit` por semana tocada. Meses vistos ficam em cache local por conta.
- Skeleton com a forma da grade; números em Geist Mono tabular; alvos ≥ 44 px.

## 5. Desafio de nutrição

- Modelo `nutrition_days_on_target`, modos `team` (soma) e `solo` (cada pessoa atinge N),
  período de 7 a 92 dias, 2 a 20 pessoas, +300 XP e as conquistas de desafio de sempre.
- Progresso: dias de `nutrition_days` com `on_target` e `imported = false` dentro do período, de
  cada participante que entrou.
- Metas: solo de 1 até a duração do período; equipe de 1 até duração × (1 + convidados). Mesmas
  regras em `create_challenge` e `templates.ts`, com testes.
- Privacidade: criar ou entrar exige o opt-in "Mostrar aos participantes quantos dias fiquei no
  alvo" (`challenge_members.share_nutrition`). Os participantes veem só esse número. Erro tipado
  `nutrition_opt_in_required`.
- Pilar: só quem tem o pilar ligado cria ou entra (`nutrition_off`). O botão mostra "Ative o pilar
  Nutrição para participar" e abre a ativação. Dias com o pilar desligado não contam.
- Fechamento: desafio de nutrição fecha quando `challenge_today > ends_on + 2` (os dois últimos
  dias precisam fechar). O detalhe mostra "Contando até anteontem" e "Resultado sai em <data>".
  Os outros modelos fecham como antes.
- Lista de modelos na criação: o de nutrição aparece só com o pilar ligado; com ele desligado,
  aparece desabilitado com a explicação.

## 6. Banco de dados

Migration `0014_nutrition_2b.sql` (e `0015` se precisar separar o desafio). RLS em tudo, regra de
assinaturas e privilégios da spec da 2a (§5.7).

### 6.1 Medidas pessoais

```sql
create table public.food_measures (
  id         uuid primary key,              -- gerado no cliente
  user_id    uuid not null references auth.users on delete cascade default auth.uid(),
  food_key   text not null check (food_key ~ '^(taco|off|custom):[A-Za-z0-9-]{1,64}$'),
  label      text not null check (char_length(btrim(label)) between 1 and 30),
  grams      numeric(6,1) not null check (grams >= 1 and grams <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index food_measures_user_food on public.food_measures (user_id, food_key);
```

CRUD do próprio; trigger `security invoker` com os limites (10 por `food_key`, 500 por pessoa,
contando ids diferentes do que chega) e última escrita vence, como `food_logs`.

### 6.2 Desafio

- `challenges.template` aceita `nutrition_days_on_target`; `create_challenge` valida o modelo
  (modos, metas, opt-in, pilar ligado).
- `challenge_members.share_nutrition boolean not null default false`.
- `join_challenge(p_id, p_share_volume, p_share_nutrition default false)`: assinatura nova, `drop`
  da antiga, `revoke`/`grant` refeitos; o cliente passa a chamar com parâmetros nomeados.
- `challenge_progress` ganha o ramo do modelo; `close_challenge`, `close_due_challenges` e
  `close_all_challenges` usam `ends_on + 2` para esse modelo.

### 6.3 Histórico

`get_nutrition_days` ganha `xp` por dia e `week_target_hit` por semana (mesma assinatura).

## 7. Pendências da 2a

1. **Dados reais da TACO** (antes da 2b, como correção da 2a): `scripts/data/taco-4ed.csv` gerado
   da planilha oficial, `taco.json` com ~597 itens, teste de contagem ativo, `NOTICE.md` com os
   termos confirmados.
2. **Ativação sem metas carregadas:** o botão final da ativação espera o store das metas
   (`status === 'ready'`) para decidir hoje ou amanhã.
3. **Diário depois da meia-noite:** "hoje" recalculado ao voltar o foco e a cada minuto.
4. **"Copiar de…" com falha online:** linha avisando que os dias antigos não carregaram.
5. **Plurais em pl, ru e uk:** contagens usam `Intl.PluralRules` por idioma nas poucas chaves com
   número.

## 8. Internacionalização e texto público

Regras do `CLAUDE.md`: strings novas nos 16 packs (pt-BR em `PT_BR_OVERRIDES`), sem travessão como
pausa, humanizer, `check-locales` e `check-source-strings --strict`. Nomes de alimentos e de
medidas sugeridas não são traduzidos.

## 9. Privacidade

`public/privacidade.html`: medidas pessoais entram na lista do que é guardado; o desafio de
nutrição mostra aos participantes só a contagem de dias no alvo, e só com o opt-in.

## 10. Testes

- **PGlite:** `food_measures` (RLS, limites, upsert sem esbarrar no limite, última escrita vence,
  exclusão de conta); desafio (criação válida e inválida, opt-in, pilar desligado, progresso com
  dias fora do período, fechamento em `ends_on + 2`, +300, payload sem dado de nutrição além da
  contagem); `get_nutrition_days` com `xp` e `week_target_hit`.
- **Script:** `taco-measures.json` (alimentos mapeados existem na TACO, gramas positivas, até 6 por
  alimento, rótulos legíveis); correspondência sem `taco_id` repetido.
- **Cliente:** chips da porção na ordem certa, criar/editar/apagar medida offline, multiplicador;
  calendário (estados, semana, navegação, sheet do dia online/offline); desafio na criação
  (modelo desabilitado sem pilar, opt-in), no detalhe ("Contando até anteontem"); pendências da
  §7 com testes de regressão.
- **Smoke manual:** registrar arroz em colheres no celular, ver o mês, criar e concluir um desafio
  entre duas contas.

## 11. Riscos

| Risco | Mitigação |
|---|---|
| Correspondência TACO × POF errada (gramas absurdas) | revisão linha a linha, teste de faixa plausível por grupo de alimento |
| Atraso de 2 dias no resultado do desafio parecer bug | texto explícito com a data do resultado |
| Opt-in de nutrição esquecido num caminho | validação no SQL, teste de payload |
| Mudança de assinatura de `join_challenge` quebrar o cliente antigo | `drop` + parâmetros nomeados; cliente e migration no mesmo deploy (SETUP) |
