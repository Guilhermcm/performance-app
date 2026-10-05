# Configuração

## 1. Supabase

1. Crie um projeto em https://supabase.com/dashboard (região: São Paulo, South America).
2. SQL Editor → cole e rode, em ordem, cada arquivo de `supabase/migrations/` (`0001_init.sql`,
   `0002_gamification.sql`, `0003_gamification_cron.sql`, `0004_social.sql`,
   `0005_social_cron.sql`). Em um projeto que já tem as anteriores, rode só as que faltam.
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
2. SQL Editor → rode de novo `supabase/migrations/0003_gamification_cron.sql` e
   `supabase/migrations/0005_social_cron.sql`.
3. Confira com `select jobname, schedule, command from cron.job order by jobname;`. O resultado
   esperado tem duas linhas: `close-challenges | 15 6 * * * | select public.close_all_challenges()`
   e `close-weeks | 0 6 * * * | select public.close_all_weeks()` (06:15 e 06:00 UTC).

Sem o `pg_cron` nada quebra. O streak de quem sumiu só é atualizado quando a pessoa abre o app de
novo.

Os desafios também fecham sozinhos quando alguém abre o app, a aba de desafios ou o ranking. O job
só garante os +300 XP de quem passa dias sem abrir.
