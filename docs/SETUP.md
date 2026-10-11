# Configuração

## 1. Supabase

1. Crie um projeto em https://supabase.com/dashboard (região: São Paulo, South America).
2. SQL Editor → em um projeto novo, cole e rode, em ordem, cada arquivo de `supabase/migrations/`,
   de `0001_init.sql` a `0020_checkin_feed.sql`, um por consulta. Antes de rodar a `0013`, ative
   o `pg_cron` (veja a seção 7). Em um projeto que já tem `0001` a `0006`, siga o roteiro abaixo; em
   um que já tem até a `0016`, siga o roteiro do check-in.
   A `0006` cria a exclusão de conta pelo próprio app (Perfil > Excluir minha conta) e precisa rodar
   como `postgres`, o usuário padrão do SQL Editor, porque apaga a linha da conta em `auth.users`.
   As `0007` a `0020` também rodam como `postgres`: as funções que fecham os dias e pagam o XP
   escrevem como dono das tabelas.
3. Project Settings → API: copie `Project URL` e a chave `anon public`.

### Roteiro: banco de produção que já tem a 0001 a 0006

Use este roteiro para levar um banco existente até a `0016`. Faça tudo antes de publicar o
cliente novo. Sem as migrations, a aba Nutrição mostra "Não foi possível carregar seu diário
alimentar" (em inglês, "Could not load your food diary"). O cliente antigo, ainda no ar durante o
roteiro, continua funcionando: ele chama as funções por parâmetros nomeados e os parâmetros novos
têm valor padrão.

1. Ative o `pg_cron` antes de tudo, se ainda não estiver ativo: Supabase → Database → Extensions →
   `pg_cron` → Enable. A `0013` agenda um job e depende dele.
2. No SQL Editor, rode cada arquivo inteiro, em ordem, da `0007` à `0016`, um por consulta (uma
   consulta nova para cada arquivo). Pare no primeiro erro e não siga para o próximo arquivo:
   anote a mensagem e resolva a causa antes de continuar. A ordem é `0007_nutrition_base.sql`, `0008_weekly_targets_pillar.sql`,
   `0009_nutrition_diary.sql`, `0010_nutrition_close.sql`, `0011_nutrition_week.sql`,
   `0012_nutrition_progress.sql`, `0013_nutrition_cron.sql`, `0014_food_measures.sql`,
   `0015_nutrition_challenge.sql` e `0016_nutrition_history.sql`. A `0015` apaga as versões antigas
   de `create_challenge` e `join_challenge` e cria as novas com o parâmetro
   `p_share_nutrition boolean default false`.
3. Confira o resultado com três consultas:
   - `select proname, pg_get_function_identity_arguments(oid) from pg_proc where proname in ('create_challenge','join_challenge');`
     deve devolver exatamente uma linha para cada função, e as duas mostram o parâmetro
     `p_share_nutrition`. Mais de uma linha por função indica uma migration pela metade.
   - `select relrowsecurity from pg_class where relname = 'food_measures';` deve devolver `true`.
   - `select jobname from cron.job order by jobname;` deve listar `close-nutrition-days` entre os
     jobs (o conjunto completo está na seção 7).
4. Se o app disser que não achou a função logo depois ("Could not find the function"), recarregue o
   cache da API: `notify pgrst, 'reload schema';`.
5. Só então faça o merge e o deploy do cliente novo.

Atalho: o arquivo único `supabase/release/0007-0016_nutrition.sql` pode ser colado no SQL Editor no
lugar dos dez arquivos do passo 2. Ele é gerado por concatenação das migrations, então não edite
à mão: se algo precisar mudar, mude a migration e gere o arquivo de novo com
`node scripts/build-release-sql.mjs` (um teste confere que ele está em dia). O `pg_cron` precisa estar
ativo antes de rodá-lo. As conferências do passo 3 valem do mesmo jeito.

### Roteiro: banco de produção que já tem a 0001 a 0016 (check-in com foto)

Use este roteiro para levar um banco que já roda a Nutrição (`0001` a `0016`) até a `0020`, a
migration do check-in com foto, do feed social e do pilar Treino (fase 1c). A ordem do lançamento
importa:

1. Rode o SQL em produção (passos abaixo).
2. Faça o merge do PR #4 logo em seguida, para o cliente novo ir ao ar.

Não deixe um intervalo longo entre os dois. Depois do corte, `workout_completed`, `pr` e
`weight_logged` deixam de pagar XP, e só os motivos do check-in pagam. Um cliente antigo não sabe
fazer check-in. Depois do corte, um treino ao vivo que ele mande não conta como dia nenhum: não rende
XP e não entra na sequência, nos desafios nem nas métricas. Quem treinar com o app antigo nessa
janela só salva o dia postando, no app novo, um check-in para "ontem" no dia seguinte. Se o deploy
não puder sair no mesmo dia, não rode o SQL. O `get_feed` e o `join_challenge` seguem funcionando
para o cliente antigo.

O que muda no banco quando a `0017` a `0020` rodam:

- A data de corte é o dia em que o SQL roda, em UTC (`current_date` do servidor, gravado em
  `app_settings.training_checkin_since`). Rodando depois das 21h no horário de Brasília, ela já é a
  data de amanhã, e está certo assim: o dia de hoje ainda conta como treino legado. Os dias
  anteriores ao corte contam como treino legado (streak, desafios e métricas) sem pagar XP de novo.
- Os desafios `workouts_count` e `weeks_on_target` que já existem passam a contar dias de treino e a
  fechar 2 dias depois de `ends_on` (carência de 2 dias).

Passo a passo:

1. Confira que o `pg_cron` está ativo (Supabase → Database → Extensions → `pg_cron`). A `0019`
   agenda o job `close-training-days`. Sem a extensão, a migration segue e só avisa
   (`close-training-days not scheduled`); nada quebra, mas os dias de quem some só fecham quando a
   pessoa abre o app.
2. No SQL Editor, rode cada arquivo inteiro, em ordem, um por consulta: `0017_checkins.sql`,
   `0018_checkin_social.sql`, `0019_training_days.sql` e `0020_checkin_feed.sql`. Pare no primeiro
   erro e resolva a causa antes de seguir. O arquivo único `supabase/release/0017-0020_checkin.sql`
   faz o mesmo numa consulta só; ele é gerado por `node scripts/build-release-sql.mjs`, então não
   edite à mão (um teste confere que está em dia).
3. O balde de fotos é criado pela própria `0017`. Confira em Storage que existe o balde `checkins`,
   privado (sem o selo "Public"), com limite de 600 KB e só `image/jpeg` e `image/webp`. Não crie o
   balde pelo painel antes: a migration o cria ou ajusta.
4. Políticas do Storage. A `0017` cria três políticas em `storage.objects` (inserir e apagar só na
   própria pasta; ler a própria pasta ou o que `can_see_checkin_path` libera). O SQL Editor roda como
   `postgres`, e em projetos atuais do Supabase isso basta. Se aparecer `must be owner of table
   objects` (ou parecido), nada da `0017` ficou gravado: o SQL Editor roda cada consulta numa
   transação só, e o erro desfaz a consulta inteira (com o arquivo único, desfaz a `0017` a `0020`).
   Nesse caso:
   1. Rode a `0017` sem o último bloco: na cópia que você cola no SQL Editor, apague do
      `drop policy if exists checkins_photos_insert_own on storage.objects;` até o fim do arquivo
      (os três `drop policy` e os três `create policy` em `storage.objects`).
   2. Rode a `0018`, a `0019` e a `0020`, uma por consulta. O arquivo único não serve aqui, porque
      traz a `0017` inteira.
   3. Crie as três políticas em Storage → Policies, no balde `checkins`, para o papel
      `authenticated`, com as expressões do bloco que você tirou da `0017`:
      - `checkins_photos_insert_own`, INSERT, WITH CHECK: `bucket_id = 'checkins' and
        (storage.foldername(name))[1] = auth.uid()::text and name ~ ('^' || auth.uid()::text ||
        '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|webp)$')`
      - `checkins_photos_delete_own`, DELETE, USING: `bucket_id = 'checkins' and
        (storage.foldername(name))[1] = auth.uid()::text`
      - `checkins_photos_select`, SELECT, USING: `bucket_id = 'checkins' and
        ((storage.foldername(name))[1] = auth.uid()::text or public.can_see_checkin_path(name))`

   Depois confira com a consulta do passo 5. Sem as políticas, os check-ins ficam presos em
   "Enviando…".
5. Confira o resultado:
   - `select count(*) from pg_proc where proname = 'get_checkin_feed';` deve devolver `1`.
   - `select relrowsecurity from pg_class where relname = 'checkins';` deve devolver `true`.
   - `select jobname, schedule from cron.job order by jobname;` deve listar `close-training-days`
     (`45 5 * * *`) entre os jobs (o conjunto completo está na seção 7).
   - `select id, public, file_size_limit from storage.buckets where id = 'checkins';` deve devolver
     uma linha com `public = false`.
   - `select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'checkins_photos%';`
     deve listar as três políticas do balde.
   - `select value from app_settings where key = 'training_checkin_since';` deve mostrar a data de
     hoje em UTC (depois das 21h no horário de Brasília, a de amanhã).
   - `select column_default from information_schema.columns where table_name = 'profiles' and column_name = 'checkin_visibility';`
     deve devolver `'friends'::text`.
6. Feche os dias de treino de todo mundo uma vez: `select public.close_all_training_days();`. Sem
   isso, os desafios `workouts_count` em andamento mostram 0 para quem ainda não abriu o app depois
   do SQL, até o job das 05:45 UTC rodar. A função pode rodar de novo sem problema.
7. Se o app disser que não achou a função logo depois ("Could not find the function"), recarregue o
   cache da API: `notify pgrst, 'reload schema';`.
8. Faça o merge do PR #4 e o deploy do cliente novo. Depois do deploy, peça ao grupo para fechar e
   abrir o app. Um app instalado que ficou aberto durante o deploy ainda roda o cliente antigo, e a
   lista de desafios dele quebra ao receber um convite para um desafio "Dias de treino".

Fotos órfãs. Excluir a conta pelo app apaga a pasta de fotos antes de remover a conta. Contas
apagadas pelo painel do Supabase (Authentication → Users) deixam as fotos para trás, e uma foto cujo
envio terminou sem a linha do check-in também pode sobrar. Para achar as fotos do balde sem linha em
`checkins`:

```sql
select o.name, o.created_at
from storage.objects o
where o.bucket_id = 'checkins'
  and not exists (
    select 1 from public.checkins c where c.photo_path = o.name
  )
order by o.created_at;
```

Revise a lista e apague as fotos pelo painel (Storage → `checkins` → selecione os arquivos →
Delete). Não apague com `delete from storage.objects`: isso remove só a linha de índice e deixa o
arquivo no armazenamento.

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
   `supabase/migrations/0005_social_cron.sql`, `supabase/migrations/0013_nutrition_cron.sql` e o bloco
   de cron no fim de `supabase/migrations/0019_training_days.sql`.
3. Confira com `select jobname, schedule, command from cron.job order by jobname;`. O resultado
   esperado tem quatro linhas: `close-challenges | 15 6 * * * | select public.close_all_challenges()`,
   `close-nutrition-days | 30 6 * * * | select public.close_all_nutrition_days()`,
   `close-training-days | 45 5 * * * | select public.close_all_training_days()` e
   `close-weeks | 0 6 * * * | select public.close_all_weeks()` (06:15, 06:30, 05:45 e 06:00 UTC).

Sem o `pg_cron` nada quebra. O streak de quem sumiu só é atualizado quando a pessoa abre o app de
novo.

Os desafios também fecham sozinhos quando alguém abre o app, a aba de desafios ou o ranking. O job
só garante os +300 XP de quem passa dias sem abrir.

O job `close-training-days` fecha os dias de treino com check-in de quem não abriu o app (D+2), paga
o XP desses dias e roda antes do `close-weeks`, para a semana ser julgada com os dias já fechados.

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
