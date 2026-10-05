# Configuração

## 1. Supabase

1. Crie um projeto em https://supabase.com/dashboard (região: São Paulo, South America).
2. SQL Editor → cole o conteúdo de `supabase/migrations/0001_init.sql` → Run.
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
