# Configuração

## 1. Supabase

1. Crie um projeto em https://supabase.com/dashboard (região: São Paulo, South America).
2. SQL Editor → cole e rode, em ordem, cada arquivo de `supabase/migrations/` (`0001_init.sql`,
   `0002_gamification.sql`, `0003_gamification_cron.sql`, `0004_social.sql`,
   `0005_social_cron.sql`, `0006_delete_account.sql`, e as do pilar Nutrição: `0007_nutrition_base.sql`,
   `0008_weekly_targets_pillar.sql`, `0009_nutrition_diary.sql`, `0010_nutrition_close.sql`,
   `0011_nutrition_week.sql`, `0012_nutrition_progress.sql`, `0013_nutrition_cron.sql`, e as da
   Fase 2b: `0014_food_measures.sql`, `0015_nutrition_challenge.sql`,
   `0016_nutrition_history.sql`). Em um projeto que já tem as anteriores, rode só as que faltam. A `0006` cria a exclusão de conta pelo
   próprio app (Perfil > Excluir minha conta) e precisa rodar como `postgres`, o usuário padrão do
   SQL Editor, porque apaga a linha da conta em `auth.users`. Rode a `0007` a `0016` também como
   `postgres`: as funções que fecham os dias e pagam o XP escrevem como dono das tabelas.
   Rode a `0007` a `0016` no Supabase antes de publicar o cliente novo. Sem elas, a aba Nutrição
   mostra "Não foi possível carregar seu diário alimentar" (em inglês, "Could not load your food diary").
   A `0015` troca as assinaturas de `create_challenge` e `join_challenge`: as versões antigas são
   apagadas e entram versões com o parâmetro novo `p_share_nutrition boolean default false`. Por isso
   as migrations precisam rodar ANTES de publicar o cliente novo, que chama as duas funções com
   todos os parâmetros nomeados. O cliente antigo, ainda em produção durante o deploy, continua
   funcionando: ele chama as funções por parâmetros nomeados e os parâmetros novos têm valor padrão.
3. Project Settings → API: copie `Project URL` e a chave `anon public`.

## 2. Google OAuth

1. https://console.cloud.google.com → crie um projeto → APIs & Services → OAuth consent screen:
   tipo External, nome "Performance", seu e-mail de suporte; publique em "In production" quando
   quiser liberar para amigos (em "Testing" só os e-mails cadastrados como testers entram).
2. Credentials → Create credentials → OAuth client ID → Web application.
   - Authorized JavaScript origins: `https://SEU-DOMINIO.vercel.app` e `http://localhost:5173`
   - Authorized redirect URIs: `https://SEU-PROJETO.supabase.co/auth/v1/callback`
3. Supabase → Authentication → Sign In / Providers → Google: ative e cole Client ID e Client Secret.

## 3. URLs de retorno

Supabase → Authentication → URL Configuration:
- Site URL: `https://SEU-DOMINIO.vercel.app`
- Redirect URLs: `https://SEU-DOMINIO.vercel.app/**` e `http://localhost:5173/**`

## 4. Vercel

1. https://vercel.com/new → importe `Guilhermcm/performance-app`.
2. Environment Variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_IMG_BASE`,
   `VITE_GIF_BASE` (valores em `.env.example`).
3. Deploy. Depois, volte aos passos 2 e 3 e troque `SEU-DOMINIO` pelo domínio gerado.

## 5. Conferência de segurança (RLS)

No SQL Editor, com dois usuários já cadastrados (A e B):

```sql
set local role authenticated;
select set_config('request.jwt.claim.sub', '<uuid-de-A>', true);
select count(*) from profiles;         -- 1 (só o de A)
select count(*) from app_state;        -- 0 ou 1 (só o de A)
select count(*) from activity_events;  -- só os de A
```

## 6. Supabase free: pausa por inatividade

Projetos gratuitos pausam depois de 7 dias sem requisições. Para reativar, vá em Dashboard → projeto →
Restore. O uso diário do app evita a pausa.

## 7. Fechamento diário das semanas (pg_cron)

O app fecha as semanas sempre que abre (`get_my_progress`). Um job diário mantém streaks e
conquistas em dia para quem passa dias sem abrir.

1. Supabase → Database → Extensions → procure `pg_cron` → Enable.
2. SQL Editor → rode de novo `supabase/migrations/0003_gamification_cron.sql`,
   `supabase/migrations/0005_social_cron.sql` e `supabase/migrations/0013_nutrition_cron.sql`.
3. Confira com `select jobname, schedule, command from cron.job order by jobname;`. O resultado
   esperado tem três linhas: `close-challenges | 15 6 * * * | select public.close_all_challenges()`,
   `close-nutrition-days | 30 6 * * * | select public.close_all_nutrition_days()` e
   `close-weeks | 0 6 * * * | select public.close_all_weeks()` (06:15, 06:30 e 06:00 UTC).

Sem o `pg_cron` nada quebra. O streak de quem sumiu só é atualizado quando a pessoa abre o app de
novo.

Os desafios também fecham sozinhos quando alguém abre o app, a aba de desafios ou o ranking. O job
só garante os +300 XP de quem passa dias sem abrir.

Com a Nutrição é igual: o app fecha os dias e as semanas pendentes quando abre. O job
`close-nutrition-days` fecha os dias de quem está com o pilar ligado e não abriu o app, paga o XP
desses dias, a meta da semana e as conquistas, e mantém o streak de nutrição em dia.

## 8. Tabela TACO (busca local de alimentos)

A busca de alimentos usa a TACO (Tabela Brasileira de Composição de Alimentos, 4ª edição,
NEPA/Unicamp) no próprio aparelho. Os 597 alimentos já estão em
`src/features/nutrition/data/taco.json`; a origem, os termos e a citação estão em
`scripts/data/README.md` e `NOTICE.md`.

Para regenerar a tabela a partir do CSV:

1. Baixe a planilha oficial da TACO 4ª edição em https://www.nepa.unicamp.br/taco/.
2. Converta para CSV com o cabeçalho
   `id,nome,energia_kcal,proteina_g,carboidrato_g,lipideos_g,fibra_g` (valores por 100 g, com
   ponto ou vírgula decimal) e salve em `scripts/data/taco-4ed.csv`.
3. Rode `node scripts/build-taco.mjs`. O script gera `src/features/nutrition/data/taco.json` e
   `taco-measures.json` (medidas caseiras da POF, a partir de `scripts/data/taco-pof-map.csv` e
   `scripts/data/pof-medidas.csv`) e para com erro se as calorias de algum item não baterem com
   os macros (a regra está no topo do script).
4. Confira com `npm test` e faça o commit do CSV e dos JSON.
