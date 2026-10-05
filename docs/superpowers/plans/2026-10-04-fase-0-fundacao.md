# Fase 0 — Fundação: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o openGym rodando como `performance-app` na Vercel, com login Google, onboarding de perfil,
tela de Perfil, sync do estado via Supabase, fila de eventos para a gamificação e o design system
novo (Tailwind v4 + shadcn + tokens) aplicado também ao CSS herdado.

**Architecture:** o store Zustand herdado fala com o backend só por `api(path, opts)` em
`src/lib/api.js`, com contrato `/api/data`, `/api/me`, `/api/config`… Em vez de reescrever o store
(1.500 linhas, com sync, merge e conflito muito testados), instalamos um **transport** em `api()`
que atende essas rotas com o Supabase (`src/lib/backend.ts`), preservando formatos de resposta e
erros (409 com `{state, rev}`, 401, status `undefined` para falha de rede). Telas e domínios novos
(auth, perfil, eventos) ficam em `src/features/*` em TypeScript.

**Tech Stack:** React 19, Vite 8, Zustand 5, Vitest 4, TypeScript 5 (`allowJs`), Tailwind CSS v4
(`@tailwindcss/vite`), shadcn/ui (TSX), `motion`, `@supabase/supabase-js` v2, Supabase Postgres,
`@electric-sql/pglite` (testes SQL sem Docker), Geist (`@fontsource-variable/geist`,
`@fontsource-variable/geist-mono`), Vercel, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-04-performance-app-foundation-design.md` (ler §3, §4.1,
§4.2 `activity_events`, §7, §8, §9, §10). Roadmap: `docs/ROADMAP.md`.

## Global Constraints

- Repo: `Guilhermcm/performance-app`, público, sem histórico do openGym. Licença AGPL-3.0-or-later mantida (`LICENSE`, `NOTICE.md`).
- Node 22 no CI (mesma versão do upstream). Localmente Node ≥ 22.
- Código novo em TypeScript (`.ts/.tsx`) em `src/features/`, `src/components/ui/`, `src/lib/*.ts`; legado continua `.js/.jsx` e só é editado onde a tarefa manda.
- Idiomas selecionáveis: `en` e `pt-BR`; padrão `pt-BR`. Toda string nova passa por `t('English key')` e ganha tradução em `src/locales/pt-BR.js` (`PT_BR_OVERRIDES`) no mesmo commit.
- Variáveis de ambiente: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_IMG_BASE`, `VITE_GIF_BASE`.
- Mídia de exercícios: `https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@7455efae41b330c265e7cd4b78dfa848e7ce5ebd/images/` e `.../videos/`.
- Auth: Supabase, provider Google, `flowType: 'pkce'` (o app usa `HashRouter`; o fluxo implícito colocaria tokens no hash e colidiria com as rotas).
- RLS ligada em todas as tabelas. Funções `security definer` com `set search_path = public`.
- Ranges do perfil (copiados da spec): `display_name` 1–60 chars; `height_cm` 50–260; `weight_kg` 20–400; `days_per_week` 1–7; `goal` ∈ hypertrophy|strength|fat_loss|conditioning; `level` ∈ beginner|intermediate|advanced; `sex` ∈ male|female|other; `unit` ∈ kg|lb; `locale` ∈ pt-BR|en; `timezone` padrão `America/Sao_Paulo`.
- `push_state`: limite 2 MB; `activity_events.payload` ≤ 4 KB; `occurred_on` entre hoje−14 e hoje no fuso do perfil.
- Motion: 150–300 ms; respeitar `prefers-reduced-motion`. Alvos de toque ≥ 44 px.
- Commits pequenos, mensagem em inglês no formato `type: summary`, terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Depois de cada tarefa: `npm test` e `npm run build` verdes.

## Ajustes em relação à spec (decididos ao ler o código)

1. **Peças dormentes ficam até a fase de limpeza.** Removemos as *entradas* de UI e rotas que dependem do servidor próprio (admin, coach, passkeys, senha, device-link, push, pareamento). Os módulos internos `lib/mobile.js`, `lib/demo.js`, `lib/coach*.js`, `lib/remote.js` e as dependências `@capacitor/*` ficam (com `MOBILE`/`DEMO` sempre `false` no build web), porque são importados dinamicamente por ~60 arquivos e apagá-los agora arrisca a lógica de treino. A remoção completa entra como item da Fase 5. Pastas `android/` e `ios/` saem já.
2. **Packs de idioma ficam no disco**; só o seletor passa a oferecer `en` e `pt-BR`. Os packs são lazy-loaded, então não pesam no bundle. `pt-BR.js` herda de `pt.js`, que precisa ficar de qualquer forma.
3. **Testes SQL com PGlite** (Postgres em WASM rodando no Vitest) em vez de pgTAP, porque não há Docker na máquina. Mesma cobertura; um shim cria `auth.users`, `auth.uid()` e os papéis `anon`/`authenticated`.

A spec e o roadmap são atualizados com esses três pontos na Task 1.

## File Structure

```
/                                   (raiz = antigo frontend/)
├─ index.html                       modificado: título, idioma, meta
├─ vite.config.ts                   substitui vite.config.js: plugins react + tailwind, alias @
├─ tsconfig.json                    novo: allowJs, strict, paths @/*
├─ components.json                  novo: config shadcn
├─ vercel.json                      novo
├─ .env.example                     novo
├─ .github/workflows/ci.yml         novo
├─ public/manifest.json             modificado
├─ public/sw.js                     modificado: nome do cache
├─ supabase/
│  ├─ migrations/0001_init.sql      profiles, app_state, push_state, event_kinds, activity_events
│  └─ tests/
│     ├─ helpers/db.ts              PGlite + shim de auth
│     ├─ push-state.test.ts
│     ├─ profiles.test.ts
│     └─ activity-events.test.ts
├─ src/
│  ├─ main.jsx                      modificado: importa styles/app.css, instala transport
│  ├─ App.jsx                       modificado: rotas removidas, SignIn, ProfileGate, /perfil
│  ├─ lib/api.js                    modificado: setTransport()
│  ├─ lib/i18n-core.js              modificado: SELECTABLE_LANGS
│  ├─ lib/supabase.ts               novo: cliente
│  ├─ lib/database.types.ts         novo: tipos do banco
│  ├─ lib/backend.ts                novo: rotas /api/* → Supabase
│  ├─ lib/backend.test.ts
│  ├─ lib/utils.ts                  novo: cn() do shadcn
│  ├─ store/useStore.js             modificado: DEF.lang = 'pt-BR'
│  ├─ sheets.jsx                    modificado: emite eventos em finishWorkout e BwSheet
│  ├─ views/Settings.jsx            modificado: seções de servidor removidas, link Perfil e código-fonte
│  ├─ views/Home.jsx                modificado: avatar → /perfil
│  ├─ styles/
│  │  ├─ app.css                    ordem de camadas, imports
│  │  ├─ tokens.css                 tokens semânticos claro/escuro
│  │  └─ legacy-bridge.css          variáveis do openGym a partir dos tokens
│  ├─ components/ui/                shadcn: button, input, label, card, avatar, progress, drawer, toggle-group, select, sonner, skeleton, switch
│  └─ features/
│     ├─ auth/SignIn.tsx            tela Entrar
│     ├─ auth/auth.ts               signInWithGoogle, limpeza da URL
│     ├─ profile/types.ts           Profile, ProfileInput, enums
│     ├─ profile/profile-api.ts     fetchProfile, createProfile, updateProfile
│     ├─ profile/useProfile.ts      store do perfil (status, cache offline)
│     ├─ profile/profile-apply.ts   aplica perfil ao estado do app (puro)
│     ├─ profile/starter-suggest.ts sugestão de plano inicial (puro)
│     ├─ profile/ProfileGate.tsx    loading / onboarding / app
│     ├─ profile/Onboarding.tsx     3 passos
│     ├─ profile/ProfileFields.tsx  campos reutilizados por Onboarding e Perfil
│     ├─ profile/ProfileScreen.tsx  /perfil
│     ├─ gamification/events.ts     fila de eventos
│     └─ (testes *.test.ts(x) ao lado de cada arquivo)
├─ docs/ (specs, plans, ROADMAP.md, SETUP.md)
├─ README.md, LICENSE, NOTICE.md
```

---

### Task 1: Importar a base e deixar build + testes verdes

**Files:**
- Create: toda a árvore a partir de `openGym/frontend/` na raiz; `README.md` provisório
- Delete: tudo do openGym fora de `frontend/` exceto `LICENSE` e `NOTICE.md`; `android/`, `ios/`, `capacitor.config.json`, `resources/`
- Modify: `package.json`, `vite.config.js`, `docs/superpowers/specs/2026-10-04-performance-app-foundation-design.md`, `docs/ROADMAP.md`

**Interfaces:**
- Produces: repo com `npm test` e `npm run build` verdes; scripts `dev`, `build`, `preview`, `test`, `test:watch`.

- [ ] **Step 1: Copiar a base sem histórico**

Rodar no Git Bash, na raiz `C:\Users\guilh\Desktop\App Performance` (já é um repo git com `docs/`):

```bash
TMP="$(mktemp -d)"
git clone --depth 1 https://github.com/DuarteSantos8/openGym "$TMP/og"
git -C "$TMP/og" rev-parse HEAD > "$TMP/og-commit.txt"
rm -rf "$TMP/og/.git"
cp -r "$TMP/og/frontend/." .
cp "$TMP/og/LICENSE" "$TMP/og/NOTICE.md" .
cat "$TMP/og-commit.txt"
rm -rf android ios capacitor.config.json resources
```

Anotar o hash impresso; ele vai para o README (Task 11).

- [ ] **Step 2: Ajustar `package.json`**

Trocar `name`, `version` e scripts; manter dependências (Capacitor fica dormente, ver "Ajustes"):

```json
{
  "name": "performance-app",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "license": "AGPL-3.0-or-later",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

(Preservar os blocos `dependencies` e `devDependencies` como vieram; remover `build:mobile` e `test:fatigue-probe`.)

- [ ] **Step 3: Limpar `vite.config.js`**

Remover o plugin `umami`, o `server.fs.allow` e o `server.proxy`. Resultado:

```js
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const swStamp = {
  name: 'perf-sw-stamp',
  apply: 'build',
  closeBundle() {
    const dir = new URL('./dist/', import.meta.url)
    const html = new URL('index.html', dir), sw = new URL('sw.js', dir)
    if (!existsSync(html) || !existsSync(sw)) return
    const stamp = createHash('sha256').update(readFileSync(html)).digest('hex').slice(0, 10)
    writeFileSync(sw, readFileSync(sw, 'utf8').replace('__BUILD__', stamp))
  }
}

const appVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  plugins: [react(), swStamp],
  base: './',
  build: { chunkSizeWarningLimit: 1500 }
})
```

- [ ] **Step 4: Instalar e rodar a linha de base**

```bash
npm install
npm test
npm run build
```

Expected: build OK. Se algum teste falhar por depender de arquivos fora de `frontend/` (ex.: `../api/coach/core`), rodar `npx vitest run --reporter=dot 2>&1 | grep FAIL` e, para cada arquivo que importa `../api/` ou `../../api/`, **deletar o teste** se ele testa coach/servidor (fora de escopo) — listar os deletados na mensagem de commit. Repetir até verde.

- [ ] **Step 5: Atualizar spec e roadmap com os ajustes**

Na spec, §3.1, substituir o item que remove `lib/mobile.js` e as dependências `@capacitor*` por:

```markdown
- `frontend/android/`, `frontend/ios/`, `capacitor.config.json`. Os módulos `lib/mobile.js`,
  `lib/demo.js`, `lib/coach*.js`, `lib/remote.js` e as dependências `@capacitor/*` ficam
  dormentes (`MOBILE`/`DEMO` são `false` no build web) e saem na limpeza da Fase 5.
```

e o item de locales por:

```markdown
- Locales: o seletor oferece só `en` e `pt-BR`; os demais packs ficam no disco (lazy-loaded) e
  saem na limpeza da Fase 5. `pt.js` é base do `pt-BR.js` e fica.
```

Em §10, trocar "**pgTAP** (`supabase/tests`, rodando no Postgres local do `supabase` CLI)" por "**Vitest + PGlite** (`supabase/tests`, Postgres em WASM, sem Docker)". No `docs/ROADMAP.md`, Fase 5, acrescentar o item:

```markdown
- Limpeza da base: remover `lib/mobile.js`, `lib/demo.js`, `lib/coach*.js`, `lib/remote.js`,
  dependências `@capacitor/*`, packs de idioma fora de en/pt-BR e os ramos mortos que dependem deles.
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: import openGym frontend as project base

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Remover entradas que dependem do servidor próprio e limitar idiomas

**Files:**
- Delete: `src/views/Admin*.jsx`, `src/views/AdminCoach*.jsx`, `src/views/Coach*.jsx`, `src/views/CoachIntake*.jsx`, `src/views/CoachSetup*.jsx`, `src/views/MobileOnboarding.jsx`, `src/components/Passkeys.jsx`, `src/components/PasswordAuth.jsx`, `src/components/ServerSync.jsx` e os testes `*.test.jsx` desses arquivos
- Modify: `src/App.jsx`, `src/views/Settings.jsx`, `src/lib/i18n-core.js`, `src/store/useStore.js`, `src/views/Login.jsx` (temporário)
- Test: `src/lib/i18n-core.test.js` (acrescentar caso)

**Interfaces:**
- Produces: `SELECTABLE_LANGS` exportado de `src/lib/i18n-core.js` = `['en', 'pt-BR']`; `DEF.lang === 'pt-BR'`.

- [ ] **Step 1: Teste que falha para `SELECTABLE_LANGS`**

Acrescentar ao fim de `src/lib/i18n-core.test.js`:

```js
import { SELECTABLE_LANGS } from './i18n-core.js'

describe('SELECTABLE_LANGS', () => {
  it('offers only English and Brazilian Portuguese', () => {
    expect(SELECTABLE_LANGS).toEqual(['en', 'pt-BR'])
  })
})
```

(Se `describe/it/expect` não estiverem importados no topo do arquivo, adicionar `import { describe, it, expect } from 'vitest'`.)

Run: `npx vitest run src/lib/i18n-core.test.js` — Expected: FAIL (`SELECTABLE_LANGS` undefined).

- [ ] **Step 2: Implementar**

Em `src/lib/i18n-core.js`, logo após o objeto `LANGS`:

```js
// Languages the app offers in its pickers. The other packs stay on disk (lazy-loaded) until the
// Phase 5 clean-up; pt-BR inherits from pt.js, so that file stays regardless.
export const SELECTABLE_LANGS = ['en', 'pt-BR']
```

Em `src/views/Settings.jsx`, no seletor de idioma, trocar a fonte das opções de `Object.keys(LANGS)` / `Object.entries(LANGS)` (localizar com `grep -n "LANGS" src/views/Settings.jsx`) para `SELECTABLE_LANGS.map(l => [l, LANGS[l]])`, importando `SELECTABLE_LANGS` de `../lib/i18n-core.js`.

Em `src/store/useStore.js`, no objeto `DEF`, trocar `lang: 'en'` por `lang: 'pt-BR'`.

Run: `npx vitest run src/lib/i18n-core.test.js` — Expected: PASS.

- [ ] **Step 3: Remover rotas e views do servidor próprio em `App.jsx`**

- Apagar os imports de `Admin`, `CoachChat`, `CoachIntake`, `CoachSetup`, `MobileOnboarding`, `openDeviceLinkRedeem` e `syncPushSubscription`.
- Apagar as `<Route>` de `/coach`, `/coach/intake`, `/coach/proposal`, `/coach/setup`, `/admin`.
- Apagar o `useEffect` que chama `syncPushSubscription` e o bloco `linkCode`/`linkOffered`.
- Trocar `{!authed ? <Login /> : needsMobileOnboarding ? <MobileOnboarding /> : (` por `{!authed ? <Login /> : (` e apagar a variável `needsMobileOnboarding`.
- Trocar `{loc.pathname !== '/coach' && <TabBar onStart={startFlow} />}` por `<TabBar onStart={startFlow} />`.

- [ ] **Step 4: Remover seções de servidor em `Settings.jsx`**

Apagar os imports das linhas que trazem `ServerSync.jsx`, `PasswordAuth.jsx`, `Passkeys.jsx`, `push.js`, `coach-api.js`, `update.js`, e `webauthnOK, passkeyRegister` de `api.js`. Depois rodar:

```bash
npx vite build 2>&1 | grep -E "is not defined|not exported|Could not resolve" | head -40
grep -nE "ServerSyncSection|KeptChangesRows|leaveServer|connectServer|passkeySignIn|passwordOn|PasswordRow|openPassword|usePasskeys|PasskeysRow|DeviceLinkRow|pushSupported|enablePush|disablePush|sendTestPush|syncPushSubscription|forgetCoach|checkForUpdate|downloadAndInstall|webauthnOK|passkeyRegister|/api/pair|/api/config|/api/media/sweep" src/views/Settings.jsx
```

Para cada linha listada: apagar o elemento JSX inteiro (a `<Section>`/`<Row>` que o usa) ou o handler, e os `useState`/`useEffect` que só existiam para ele. Regra: se a seção inteira só faz sentido com servidor próprio (conta, passkeys, senha, push, pareamento, atualização do app, mídia no servidor, coach), sai inteira. Repetir os dois comandos até não haver saída.

- [ ] **Step 5: Deletar arquivos e testes órfãos**

```bash
git rm -q src/views/Admin*.jsx src/views/AdminCoach*.jsx src/views/Coach*.jsx src/views/MobileOnboarding.jsx src/components/Passkeys.jsx src/components/PasswordAuth.jsx src/components/ServerSync.jsx
grep -rlnE "from '\.\./components/(Passkeys|PasswordAuth|ServerSync)\.jsx'|from '\./components/(Passkeys|PasswordAuth|ServerSync)\.jsx'|views/(Admin|Coach)" src | sort -u
```

Para cada arquivo listado pelo `grep`: se for teste (`*.test.*`), `git rm` nele; se for código, remover o import e o uso (mesma regra do Step 4). `src/views/Login.jsx` importa `PasswordAuth` e `Passkeys`: até a Task 6 substituí-lo, reduzir `Login.jsx` a:

```jsx
export default function Login() {
  return <div style={{ padding: 24 }}>Sign-in coming soon</div>
}
```

e `git rm src/views/Login*.test.jsx`.

- [ ] **Step 6: Verificar**

```bash
npm test
npm run build
```

Expected: ambos verdes. Falhas restantes só podem vir de testes de peças removidas: deletar esses testes; nunca deletar testes de `src/lib/` de treino (progression, onerm, finish-workout, recovery, workout-model, supersetFlow, exercises, sync-merge).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: drop self-hosted server entry points and limit languages to en/pt-BR

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: TypeScript, Tailwind v4, shadcn, tokens e ponte com o CSS legado

**Files:**
- Create: `tsconfig.json`, `vite.config.ts`, `components.json`, `src/lib/utils.ts`, `src/styles/app.css`, `src/styles/tokens.css`, `src/styles/legacy-bridge.css`, `src/components/ui/*.tsx` (gerados), `src/styles/tokens.test.ts`
- Delete: `vite.config.js`
- Modify: `src/main.jsx`, `src/App.jsx` (`applyPrefs`), `index.html`

**Interfaces:**
- Produces: alias `@/` → `src/`; `cn(...classes)` em `@/lib/utils`; componentes `@/components/ui/{button,input,label,card,avatar,progress,drawer,toggle-group,select,sonner,skeleton,switch}`; tokens CSS `--background --foreground --card --card-foreground --primary --primary-foreground --muted --muted-foreground --border --input --ring --destructive --pillar-strength --pillar-nutrition --pillar-sleep --pillar-habits --radius --ease-out --dur-1 --dur-2 --dur-3`.

- [ ] **Step 1: Dependências**

```bash
npm i -D typescript @types/react @types/react-dom @types/node tailwindcss @tailwindcss/vite
npm i clsx tailwind-merge class-variance-authority lucide-react motion @fontsource-variable/geist @fontsource-variable/geist-mono
```

- [ ] **Step 2: `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "allowJs": true,
    "checkJs": false,
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "types": ["vite/client", "node"],
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] }
  },
  "include": ["src", "supabase/tests", "vite.config.ts"]
}
```

Adicionar script em `package.json`: `"typecheck": "tsc --noEmit"`.

- [ ] **Step 3: `vite.config.ts` (substitui o `.js`)**

```ts
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const swStamp: Plugin = {
  name: 'perf-sw-stamp',
  apply: 'build',
  closeBundle() {
    const dir = new URL('./dist/', import.meta.url)
    const html = new URL('index.html', dir), sw = new URL('sw.js', dir)
    if (!existsSync(html) || !existsSync(sw)) return
    const stamp = createHash('sha256').update(readFileSync(html)).digest('hex').slice(0, 10)
    writeFileSync(sw, readFileSync(sw, 'utf8').replace('__BUILD__', stamp))
  }
}

const appVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  plugins: [react(), tailwindcss(), swStamp],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  base: './',
  build: { chunkSizeWarningLimit: 1500 }
})
```

```bash
git rm -q vite.config.js
```

- [ ] **Step 4: Teste que falha para os tokens**

`src/styles/tokens.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8')
const REQUIRED = ['--background', '--foreground', '--card', '--card-foreground', '--primary',
  '--primary-foreground', '--muted', '--muted-foreground', '--border', '--input', '--ring',
  '--destructive', '--pillar-strength', '--pillar-nutrition', '--pillar-sleep', '--pillar-habits',
  '--radius', '--ease-out', '--dur-1', '--dur-2', '--dur-3']

const block = (selector: string) => {
  const i = css.indexOf(selector + ' {')
  if (i < 0) return ''
  return css.slice(i, css.indexOf('}', i))
}

describe('tokens.css', () => {
  it.each(REQUIRED)('defines %s for the dark theme', token => {
    expect(block(':root')).toContain(token + ':')
  })
  it('redefines every colour token for the light theme', () => {
    const light = block(':root[data-theme="light"]')
    for (const t of REQUIRED.filter(t => !['--radius', '--ease-out', '--dur-1', '--dur-2', '--dur-3'].includes(t))) {
      expect(light).toContain(t + ':')
    }
  })
})
```

Run: `npx vitest run src/styles/tokens.test.ts` — Expected: FAIL (arquivo não existe).

- [ ] **Step 5: `src/styles/tokens.css`**

Dark é o padrão (`:root`); light via `data-theme="light"` (o `applyPrefs` do App já põe esse atributo).

```css
:root {
  color-scheme: dark;
  --background: oklch(0.16 0.006 260);
  --foreground: oklch(0.97 0.004 260);
  --card: oklch(0.205 0.007 260);
  --card-foreground: oklch(0.97 0.004 260);
  --popover: oklch(0.225 0.008 260);
  --popover-foreground: oklch(0.97 0.004 260);
  --primary: oklch(0.89 0.2 128);            /* volt */
  --primary-foreground: oklch(0.2 0.03 128);
  --secondary: oklch(0.26 0.008 260);
  --secondary-foreground: oklch(0.95 0.004 260);
  --muted: oklch(0.25 0.007 260);
  --muted-foreground: oklch(0.72 0.01 260);
  --accent: oklch(0.28 0.01 260);
  --accent-foreground: oklch(0.97 0.004 260);
  --border: oklch(1 0 0 / 0.09);
  --input: oklch(1 0 0 / 0.14);
  --ring: oklch(0.89 0.2 128 / 0.6);
  --destructive: oklch(0.68 0.21 25);
  --pillar-strength: oklch(0.74 0.17 50);
  --pillar-nutrition: oklch(0.76 0.16 150);
  --pillar-sleep: oklch(0.7 0.14 275);
  --pillar-habits: oklch(0.82 0.15 85);
  --radius: 16px;
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  --dur-1: 150ms;
  --dur-2: 220ms;
  --dur-3: 300ms;
  --font-sans: 'Geist Variable', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --font-mono: 'Geist Mono Variable', ui-monospace, 'SF Mono', monospace;
}

:root[data-theme="light"] {
  color-scheme: light;
  --background: oklch(0.975 0.003 260);
  --foreground: oklch(0.2 0.01 260);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.2 0.01 260);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.2 0.01 260);
  --primary: oklch(0.62 0.17 132);
  --primary-foreground: oklch(0.99 0.01 128);
  --secondary: oklch(0.94 0.004 260);
  --secondary-foreground: oklch(0.25 0.01 260);
  --muted: oklch(0.94 0.004 260);
  --muted-foreground: oklch(0.48 0.012 260);
  --accent: oklch(0.93 0.006 260);
  --accent-foreground: oklch(0.2 0.01 260);
  --border: oklch(0 0 0 / 0.09);
  --input: oklch(0 0 0 / 0.14);
  --ring: oklch(0.62 0.17 132 / 0.5);
  --destructive: oklch(0.56 0.2 25);
  --pillar-strength: oklch(0.6 0.17 45);
  --pillar-nutrition: oklch(0.58 0.15 150);
  --pillar-sleep: oklch(0.52 0.16 275);
  --pillar-habits: oklch(0.65 0.15 75);
}

@media (prefers-reduced-motion: reduce) {
  :root { --dur-1: 0ms; --dur-2: 0ms; --dur-3: 0ms; }
}
```

Run: `npx vitest run src/styles/tokens.test.ts` — Expected: PASS.

- [ ] **Step 6: `src/styles/legacy-bridge.css`**

Mapear as variáveis do openGym para os tokens. Primeiro listar as variáveis usadas pelo legado:

```bash
grep -oE "^\s*--[a-z0-9-]+:" src/index.css | sort -u
```

Escrever a ponte cobrindo, no mínimo, as variáveis abaixo (os nomes à esquerda existem em `src/index.css` linhas 20–115); qualquer outra variável de **cor de superfície, texto ou acento** listada pelo grep ganha mapeamento equivalente; variáveis de layout (`--sab`, tamanhos) não são tocadas:

```css
/* The inherited openGym stylesheet reads these names. They now come from tokens.css, so the
   legacy screens take the new identity without touching their components. Loaded after
   index.css inside the legacy layer, so these win over index.css's own definitions. */
:root, :root[data-theme="light"] {
  --bg: var(--background);
  --bg-el: var(--card);
  --label: var(--foreground);
  --acc: var(--primary);
  --on-acc: var(--primary-foreground);
}
body { font-family: var(--font-sans); }
```

- [ ] **Step 7: `src/styles/app.css` e camadas**

```css
@layer legacy, theme, base, components, utilities;

@import '@fontsource-variable/geist';
@import '@fontsource-variable/geist-mono';
@import '../index.css' layer(legacy);
@import './legacy-bridge.css' layer(legacy);
@import 'tailwindcss/theme.css' layer(theme);
@import 'tailwindcss/utilities.css' layer(utilities);
@import './tokens.css';

/* No Tailwind preflight: it would restyle every inherited screen. The reset shadcn relies on is
   scoped to its own components, which all carry data-slot. */
@layer base {
  [data-slot], [data-slot] *, [data-slot]::before, [data-slot]::after {
    box-sizing: border-box;
    border: 0 solid var(--border);
  }
  [data-slot]:where(button, input, select, textarea) {
    font: inherit;
    color: inherit;
    background: transparent;
    margin: 0;
  }
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-destructive: var(--destructive);
  --color-pillar-strength: var(--pillar-strength);
  --color-pillar-nutrition: var(--pillar-nutrition);
  --color-pillar-sleep: var(--pillar-sleep);
  --color-pillar-habits: var(--pillar-habits);
  --radius-sm: calc(var(--radius) - 6px);
  --radius-md: calc(var(--radius) - 4px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
  --font-sans: var(--font-sans);
  --font-mono: var(--font-mono);
}
```

Em `src/main.jsx`, trocar `import './index.css'` por `import './styles/app.css'`.

- [ ] **Step 8: Remover o seletor de acento**

Em `src/App.jsx`, `applyPrefs` passa a ser:

```js
function applyPrefs(theme) {
  const de = document.documentElement
  de.dataset.theme = resolveTheme(theme)
  delete de.dataset.accent
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.content = getComputedStyle(de).getPropertyValue('--background').trim() || '#16181d'
}
```

Atualizar as duas chamadas e os arrays de dependência (`[S.theme]`). Em `src/views/Settings.jsx`, apagar a linha/seção de acento (`grep -n "ACCENT" src/views/Settings.jsx`) e os imports `ACCENTS, ACCENT_NAMES`, mantendo o import de `format.js` para os demais nomes.

- [ ] **Step 9: shadcn**

`components.json`:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": { "config": "", "css": "src/styles/app.css", "baseColor": "neutral", "cssVariables": true, "prefix": "" },
  "aliases": { "components": "@/components", "utils": "@/lib/utils", "ui": "@/components/ui", "lib": "@/lib", "hooks": "@/hooks" },
  "iconLibrary": "lucide"
}
```

`src/lib/utils.ts`:

```ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

```bash
npx shadcn@latest add button input label card avatar progress drawer toggle-group select sonner skeleton switch --yes
git diff --stat src/styles/app.css
```

Se o CLI tiver acrescentado ao `app.css` um `@import "tailwindcss";`, blocos `:root { ... }`/`.dark { ... }` com cores próprias ou `@layer base { * { ... } }` global, **remover esses acréscimos** (os tokens vêm de `tokens.css`, e o reset é o escopado). Manter `@import "tw-animate-css";` se ele tiver sido adicionado (necessário para animações do Drawer).

- [ ] **Step 10: `index.html`**

Trocar `<html lang="en">` por `<html lang="pt-BR">`; no script inline, o fallback de idioma passa a ser `'pt-BR'` (`var l = s.lang || 'pt-BR';`); `<title>` e `apple-mobile-web-app-title` → `Performance`; `meta description` → `Treino, progresso e consistência`.

- [ ] **Step 11: Verificar**

```bash
npm run typecheck
npm test
npm run build
npm run dev
```

Abrir `http://localhost:5173` no navegador: a tela provisória "Sign-in coming soon" aparece em fundo grafite com a fonte Geist. Expected: typecheck, testes e build verdes.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat: add TypeScript, Tailwind v4, shadcn and design tokens bridged to legacy CSS

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Banco — migration inicial e testes SQL com PGlite

**Files:**
- Create: `supabase/migrations/0001_init.sql`, `supabase/tests/helpers/db.ts`, `supabase/tests/push-state.test.ts`, `supabase/tests/profiles.test.ts`, `supabase/tests/activity-events.test.ts`

**Interfaces:**
- Produces (SQL): tabelas `public.profiles`, `public.app_state`, `public.event_kinds`, `public.activity_events`; tipo `public.pillar`; função `public.push_state(p_data jsonb, p_base_rev integer) returns jsonb` → `{ok:true, rev:int, ts:any}` ou `{ok:false, error:'conflict', rev:int, state:jsonb|null}`; erros levantados com mensagem exata `not_signed_in`, `state_required`, `invalid_state`, `state_too_large`, `unknown_kind`, `out_of_window`, `payload_too_large`.
- Produces (TS): `freshDb(): Promise<PGlite>`, `asUser<T>(db, uid, fn: () => Promise<T>): Promise<T>`, `addUser(db, uid, email?): Promise<void>`.

- [ ] **Step 1: Dependência**

```bash
npm i -D @electric-sql/pglite
```

- [ ] **Step 2: Harness `supabase/tests/helpers/db.ts`**

```ts
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MIGRATIONS = fileURLToPath(new URL('../../migrations/', import.meta.url))

// The minimum of Supabase that the migrations lean on: the auth schema, auth.uid() read from the
// JWT claim PostgREST sets, and the two client roles.
const SHIM = `
create schema auth;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}');
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create role anon nologin;
create role authenticated nologin;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
`

export async function freshDb(): Promise<PGlite> {
  const db = new PGlite()
  await db.exec(SHIM)
  for (const file of readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS, file), 'utf8'))
  }
  return db
}

export async function addUser(db: PGlite, uid: string, email = `${uid.slice(0, 8)}@test.dev`) {
  await db.query('insert into auth.users (id, email) values ($1, $2)', [uid, email])
}

export async function asUser<T>(db: PGlite, uid: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${uid ? 'authenticated' : 'anon'}`)
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid ?? ''])
  try {
    return await fn()
  } finally {
    await db.exec('reset role')
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`)
  }
}
```

- [ ] **Step 3: Testes que falham — `supabase/tests/push-state.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, addUser, asUser } from './helpers/db'

const A = '00000000-0000-0000-0000-00000000000a'
const B = '00000000-0000-0000-0000-00000000000b'
let db: PGlite

const push = (state: unknown, baseRev: number | null) =>
  db.query<{ r: any }>('select public.push_state($1::jsonb, $2) as r', [JSON.stringify(state), baseRev]).then(x => x.rows[0].r)

beforeEach(async () => {
  db = await freshDb()
  await addUser(db, A)
  await addUser(db, B)
})

describe('push_state', () => {
  it('creates the row on the first push from rev 0', async () => {
    const r = await asUser(db, A, () => push({ workouts: [], routines: [], _ts: 5 }, 0))
    expect(r).toEqual({ ok: true, rev: 1, ts: 5 })
    const row = await asUser(db, A, () => db.query<any>('select data, rev from app_state'))
    expect(row.rows[0].rev).toBe(1)
    expect(row.rows[0].data._rev).toBe(1)
  })

  it('refuses a stale base revision and returns the stored document', async () => {
    await asUser(db, A, () => push({ workouts: [{ id: 'w1' }], _ts: 1 }, 0))
    const r = await asUser(db, A, () => push({ workouts: [], _ts: 2 }, 0))
    expect(r.ok).toBe(false)
    expect(r.error).toBe('conflict')
    expect(r.rev).toBe(1)
    expect(r.state.workouts).toEqual([{ id: 'w1' }])
  })

  it('overwrites when no base revision is given', async () => {
    await asUser(db, A, () => push({ workouts: [{ id: 'w1' }] }, 0))
    const r = await asUser(db, A, () => push({ workouts: [] }, null))
    expect(r).toMatchObject({ ok: true, rev: 2 })
  })

  it('drops the in-progress workout and non-object entries', async () => {
    await asUser(db, A, () => push({ active: { x: 1 }, workouts: [{ id: 'a' }, 3, null, { id: 'b' }] }, 0))
    const row = await asUser(db, A, () => db.query<any>('select data from app_state'))
    expect(row.rows[0].data.active).toBeUndefined()
    expect(row.rows[0].data.workouts).toEqual([{ id: 'a' }, { id: 'b' }])
  })

  it('never moves the reset stamp backwards', async () => {
    await asUser(db, A, () => push({ routines: [], resetAt: 100, resetIds: { w: ['x'] } }, 0))
    await asUser(db, A, () => push({ routines: [], resetAt: 50 }, 1))
    const row = await asUser(db, A, () => db.query<any>('select data from app_state'))
    expect(row.rows[0].data.resetAt).toBe(100)
    expect(row.rows[0].data.resetIds).toEqual({ w: ['x'] })
  })

  it.each([
    [{}, 'state_required'],
    [{ _rev: 3, _ts: 1 }, 'state_required'],
    [[1, 2], 'invalid_state'],
    [{ workouts: 'x' }, 'invalid_state']
  ])('rejects %j with %s', async (state, message) => {
    await expect(asUser(db, A, () => push(state, 0))).rejects.toThrow(message)
  })

  it('rejects a document over 2 MB', async () => {
    const big = { routines: [], blob: 'x'.repeat(2 * 1024 * 1024) }
    await expect(asUser(db, A, () => push(big, 0))).rejects.toThrow('state_too_large')
  })

  it('refuses anonymous callers', async () => {
    await expect(asUser(db, null, () => push({ routines: [] }, 0))).rejects.toThrow()
  })

  it('keeps users apart', async () => {
    await asUser(db, A, () => push({ routines: [{ id: 'mine' }] }, 0))
    const seen = await asUser(db, B, () => db.query<any>('select * from app_state'))
    expect(seen.rows).toEqual([])
    await expect(asUser(db, B, () => db.query(`update app_state set rev = 99`))).resolves.toMatchObject({ affectedRows: 0 })
  })
})
```

`supabase/tests/profiles.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, addUser, asUser } from './helpers/db'

const A = '00000000-0000-0000-0000-00000000000a'
const B = '00000000-0000-0000-0000-00000000000b'
let db: PGlite

const insert = (id: string, over: Record<string, unknown> = {}) => {
  const row = { id, display_name: 'Ana', days_per_week: 3, ...over }
  const cols = Object.keys(row)
  return db.query(`insert into profiles (${cols.join(',')}) values (${cols.map((_, i) => '$' + (i + 1)).join(',')})`, Object.values(row))
}

beforeEach(async () => {
  db = await freshDb()
  await addUser(db, A)
  await addUser(db, B)
})

describe('profiles', () => {
  it('lets a user create and read only their own profile', async () => {
    await asUser(db, A, () => insert(A))
    const mine = await asUser(db, A, () => db.query<any>('select display_name, locale, timezone, unit from profiles'))
    expect(mine.rows).toEqual([{ display_name: 'Ana', locale: 'pt-BR', timezone: 'America/Sao_Paulo', unit: 'kg' }])
    const theirs = await asUser(db, B, () => db.query('select * from profiles'))
    expect(theirs.rows).toEqual([])
  })

  it('refuses a profile for someone else', async () => {
    await expect(asUser(db, B, () => insert(A))).rejects.toThrow()
  })

  it.each([
    [{ display_name: '' }],
    [{ height_cm: 20 }],
    [{ weight_kg: 500 }],
    [{ days_per_week: 0 }],
    [{ goal: 'bulk' }],
    [{ level: 'pro' }],
    [{ unit: 'st' }],
    [{ locale: 'de' }]
  ])('rejects out-of-range values %j', async over => {
    await expect(asUser(db, A, () => insert(A, over))).rejects.toThrow()
  })

  it('bumps updated_at on update', async () => {
    await asUser(db, A, () => insert(A))
    const before = await asUser(db, A, () => db.query<any>('select updated_at from profiles'))
    await new Promise(r => setTimeout(r, 5))
    await asUser(db, A, () => db.query(`update profiles set display_name = 'Bia'`))
    const after = await asUser(db, A, () => db.query<any>('select updated_at from profiles'))
    expect(new Date(after.rows[0].updated_at).getTime()).toBeGreaterThan(new Date(before.rows[0].updated_at).getTime())
  })
})
```

`supabase/tests/activity-events.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, addUser, asUser } from './helpers/db'

const A = '00000000-0000-0000-0000-00000000000a'
const B = '00000000-0000-0000-0000-00000000000b'
let db: PGlite

const today = async () => (await db.query<{ d: string }>(`select to_char((now() at time zone 'America/Sao_Paulo')::date, 'YYYY-MM-DD') as d`)).rows[0].d
const emit = (kind: string, occurredOn: string, ref = 'r1', payload: unknown = {}) =>
  db.query(`insert into activity_events (pillar, kind, occurred_on, payload, source_ref) values ('strength', $1, $2, $3::jsonb, $4)`,
    [kind, occurredOn, JSON.stringify(payload), ref])

beforeEach(async () => {
  db = await freshDb()
  await addUser(db, A)
  await addUser(db, B)
  await asUser(db, A, () => db.query(`insert into profiles (id, display_name) values ($1, 'Ana')`, [A]))
})

describe('activity_events', () => {
  it('accepts the Phase 0 kinds and stamps the caller as owner', async () => {
    const d = await today()
    for (const k of ['workout_completed', 'pr', 'weight_logged']) await asUser(db, A, () => emit(k, d, k))
    const rows = await asUser(db, A, () => db.query<any>('select user_id, kind from activity_events order by id'))
    expect(rows.rows.map(r => r.kind)).toEqual(['workout_completed', 'pr', 'weight_logged'])
    expect(rows.rows.every(r => r.user_id === A)).toBe(true)
  })

  it('is idempotent per (user, kind, source_ref)', async () => {
    const d = await today()
    await asUser(db, A, () => emit('workout_completed', d, 's1'))
    await expect(asUser(db, A, () => emit('workout_completed', d, 's1'))).rejects.toThrow(/duplicate key/)
  })

  it('rejects unknown kinds', async () => {
    await expect(asUser(db, A, () => emit('sleep_logged', '2026-01-01'))).rejects.toThrow('unknown_kind')
  })

  it('rejects dates in the future or older than 14 days', async () => {
    const future = (await db.query<{ d: string }>(`select to_char((now() at time zone 'America/Sao_Paulo')::date + 1, 'YYYY-MM-DD') as d`)).rows[0].d
    const old = (await db.query<{ d: string }>(`select to_char((now() at time zone 'America/Sao_Paulo')::date - 15, 'YYYY-MM-DD') as d`)).rows[0].d
    await expect(asUser(db, A, () => emit('pr', future))).rejects.toThrow('out_of_window')
    await expect(asUser(db, A, () => emit('pr', old))).rejects.toThrow('out_of_window')
  })

  it('rejects payloads over 4 KB', async () => {
    const d = await today()
    await expect(asUser(db, A, () => emit('pr', d, 'x', { s: 'x'.repeat(5000) }))).rejects.toThrow('payload_too_large')
  })

  it('hides other users events', async () => {
    const d = await today()
    await asUser(db, A, () => emit('pr', d, 'mine'))
    const seen = await asUser(db, B, () => db.query('select * from activity_events'))
    expect(seen.rows).toEqual([])
  })
})
```

Run: `npx vitest run supabase/tests` — Expected: FAIL (`0001_init.sql` não existe / relações inexistentes).

- [ ] **Step 4: Migration `supabase/migrations/0001_init.sql`**

```sql
-- Phase 0: profile, synced app state, and the activity event stream gamification reads.

create type public.pillar as enum ('strength', 'nutrition', 'sleep', 'habits');

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Profiles ------------------------------------------------------------------------------------

create table public.profiles (
  id             uuid primary key references auth.users on delete cascade,
  display_name   text not null check (char_length(display_name) between 1 and 60),
  avatar_url     text,
  birth_date     date,
  sex            text check (sex in ('male', 'female', 'other')),
  height_cm      numeric(5,1) check (height_cm between 50 and 260),
  weight_kg      numeric(5,1) check (weight_kg between 20 and 400),
  goal           text check (goal in ('hypertrophy', 'strength', 'fat_loss', 'conditioning')),
  level          text check (level in ('beginner', 'intermediate', 'advanced')),
  days_per_week  smallint not null default 3 check (days_per_week between 1 and 7),
  equipment      text[] not null default '{}',
  unit           text not null default 'kg' check (unit in ('kg', 'lb')),
  locale         text not null default 'pt-BR' check (locale in ('pt-BR', 'en')),
  timezone       text not null default 'America/Sao_Paulo',
  share_activity boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

alter table public.profiles enable row level security;
create policy profiles_select_own on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_insert_own on public.profiles for insert to authenticated with check (id = auth.uid());
create policy profiles_update_own on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
grant select, insert, update on public.profiles to authenticated;

-- App state (mirror of the openGym /api/data document) ----------------------------------------

create table public.app_state (
  user_id    uuid primary key references auth.users on delete cascade,
  data       jsonb not null,
  rev        integer not null default 1,
  updated_at timestamptz not null default now()
);

alter table public.app_state enable row level security;
create policy app_state_select_own on public.app_state for select to authenticated using (user_id = auth.uid());
grant select on public.app_state to authenticated;

-- Keeps only JSON objects in an array, in order (openGym's records()).
create or replace function public.only_objects(arr jsonb) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_agg(e order by i), '[]'::jsonb)
  from jsonb_array_elements(arr) with ordinality as t(e, i)
  where jsonb_typeof(e) = 'object'
$$;

create or replace function public.push_state(p_data jsonb, p_base_rev integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_cur     public.app_state%rowtype;
  v_has     boolean;
  v_cur_rev integer := 0;
  v_state   jsonb := p_data;
begin
  if v_uid is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'invalid_state' using errcode = '22023';
  end if;
  if not exists (select 1 from jsonb_object_keys(p_data) k where k not in ('_rev', '_ts')) then
    raise exception 'state_required' using errcode = '22023';
  end if;
  if coalesce(jsonb_typeof(p_data -> 'workouts'), 'null') not in ('array', 'null')
     or coalesce(jsonb_typeof(p_data -> 'routines'), 'null') not in ('array', 'null') then
    raise exception 'invalid_state' using errcode = '22023';
  end if;
  if octet_length(p_data::text) > 2 * 1024 * 1024 then
    raise exception 'state_too_large' using errcode = '54000';
  end if;

  select * into v_cur from public.app_state where user_id = v_uid for update;
  v_has := found;
  if v_has then v_cur_rev := v_cur.rev; end if;

  if p_base_rev is not null and p_base_rev <> v_cur_rev then
    return jsonb_build_object('ok', false, 'error', 'conflict', 'rev', v_cur_rev,
                              'state', case when v_has then v_cur.data else null end);
  end if;

  v_state := v_state - 'active';
  if jsonb_typeof(v_state -> 'workouts') = 'array' then
    v_state := jsonb_set(v_state, '{workouts}', public.only_objects(v_state -> 'workouts'));
  end if;
  if jsonb_typeof(v_state -> 'routines') = 'array' then
    v_state := jsonb_set(v_state, '{routines}', public.only_objects(v_state -> 'routines'));
  end if;

  if v_has and coalesce((v_cur.data ->> 'resetAt')::numeric, 0) > coalesce((v_state ->> 'resetAt')::numeric, 0) then
    v_state := jsonb_set(v_state, '{resetAt}', v_cur.data -> 'resetAt');
    if jsonb_typeof(v_cur.data -> 'resetIds') = 'object' then
      v_state := jsonb_set(v_state, '{resetIds}', v_cur.data -> 'resetIds');
    else
      v_state := v_state - 'resetIds';
    end if;
  end if;

  v_state := jsonb_set(v_state, '{_rev}', to_jsonb(v_cur_rev + 1));

  insert into public.app_state (user_id, data, rev, updated_at)
  values (v_uid, v_state, v_cur_rev + 1, now())
  on conflict (user_id) do update
    set data = excluded.data, rev = excluded.rev, updated_at = excluded.updated_at;

  return jsonb_build_object('ok', true, 'rev', v_cur_rev + 1, 'ts', v_state -> '_ts');
end $$;

revoke all on function public.push_state(jsonb, integer) from public;
grant execute on function public.push_state(jsonb, integer) to authenticated;

-- Activity events (contract with gamification) -------------------------------------------------

create table public.event_kinds (
  pillar public.pillar not null,
  kind   text not null,
  primary key (pillar, kind)
);
insert into public.event_kinds (pillar, kind) values
  ('strength', 'workout_completed'),
  ('strength', 'pr'),
  ('strength', 'weight_logged');
grant select on public.event_kinds to authenticated;

create table public.activity_events (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  pillar      public.pillar not null,
  kind        text not null,
  occurred_on date not null,
  payload     jsonb not null default '{}',
  source_ref  text not null check (char_length(source_ref) between 1 and 200),
  created_at  timestamptz not null default now(),
  unique (user_id, kind, source_ref)
);
create index activity_events_user_day on public.activity_events (user_id, occurred_on);

create or replace function public.validate_activity_event() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tz    text;
  v_today date;
begin
  if not exists (select 1 from public.event_kinds where pillar = new.pillar and kind = new.kind) then
    raise exception 'unknown_kind' using errcode = '22023';
  end if;
  if octet_length(new.payload::text) > 4096 then
    raise exception 'payload_too_large' using errcode = '22023';
  end if;
  select timezone into v_tz from public.profiles where id = new.user_id;
  v_today := (now() at time zone coalesce(v_tz, 'America/Sao_Paulo'))::date;
  if new.occurred_on > v_today or new.occurred_on < v_today - 14 then
    raise exception 'out_of_window' using errcode = '22023';
  end if;
  return new;
end $$;

create trigger activity_events_validate before insert on public.activity_events
  for each row execute function public.validate_activity_event();

alter table public.activity_events enable row level security;
create policy activity_events_select_own on public.activity_events for select to authenticated using (user_id = auth.uid());
create policy activity_events_insert_own on public.activity_events for insert to authenticated with check (user_id = auth.uid());
grant select, insert on public.activity_events to authenticated;
```

Run: `npx vitest run supabase/tests` — Expected: PASS.

Se o PGlite recusar `set role` ou não aplicar RLS (sintoma: testes "keeps users apart"/"hides other users events" falhando com linhas visíveis), confirmar a versão (`npm ls @electric-sql/pglite`, precisa ≥ 0.2) e atualizar; persistindo, marcar esses testes com `it.skip` + comentário `// RLS verified manually in Supabase SQL editor (docs/SETUP.md §5)` e seguir — a verificação manual entra na Task 13.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(db): add profiles, app_state with push_state, and activity events

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Cliente Supabase e adapter `/api/*`

**Files:**
- Create: `src/lib/supabase.ts`, `src/lib/database.types.ts`, `src/lib/backend.ts`, `src/lib/backend.test.ts`
- Modify: `src/lib/api.js`, `src/main.jsx`

**Interfaces:**
- Consumes: SQL da Task 4 (`app_state`, `push_state`).
- Produces:
  - `supabase` (cliente tipado) e `supabaseConfigured: boolean` em `@/lib/supabase`.
  - `backend(path: string, init?: { method?: string; body?: string }): Promise<any>` e `class BackendError extends Error { status?: number; data: Record<string, unknown>; code?: string }` em `@/lib/backend`.
  - `setTransport(fn | null)` em `src/lib/api.js`; quando definido, `api()` delega a ele e `beacon()` retorna `false`.
  - Contratos de resposta (iguais ao openGym): `GET /api/config` → `{ invite_only:false, allow_guest:false, default_lang:'pt-BR' }`; `GET /api/me` → `{ user: { id, name, admin:false } }` ou erro 401; `GET /api/data` → `{ state: object|null, rev: number }`; `GET /api/data/rev` → `{ rev }`; `PUT /api/data` → `{ ok:true, ts, rev }` ou erro 409 com `data = { state, rev }`; `POST /api/logout`, `POST /api/logout/all` → `{ ok:true }`; `POST /api/activity`, `POST /api/push/rest-timer`, `POST /api/push/rest-timer/cancel` → `{ ok:true }` (no-op); qualquer outra rota → erro 404.
  - Mapeamento de erros: falha de rede → `status` `undefined`; `not_signed_in`/JWT inválido → 401; `state_too_large` → 413; `state_required`/`invalid_state` → 400; demais → 500.

- [ ] **Step 1: Dependência e tipos**

```bash
npm i @supabase/supabase-js
```

`src/lib/database.types.ts` (escrito à mão agora; na Task 13 é regenerado com `npx supabase gen types typescript --project-id <id>`):

```ts
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]
export type Pillar = 'strength' | 'nutrition' | 'sleep' | 'habits'

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string; display_name: string; avatar_url: string | null; birth_date: string | null
          sex: 'male' | 'female' | 'other' | null; height_cm: number | null; weight_kg: number | null
          goal: 'hypertrophy' | 'strength' | 'fat_loss' | 'conditioning' | null
          level: 'beginner' | 'intermediate' | 'advanced' | null; days_per_week: number
          equipment: string[]; unit: 'kg' | 'lb'; locale: 'pt-BR' | 'en'; timezone: string
          share_activity: boolean; created_at: string; updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['profiles']['Row']> & { id: string; display_name: string }
        Update: Partial<Database['public']['Tables']['profiles']['Row']>
        Relationships: []
      }
      app_state: {
        Row: { user_id: string; data: Json; rev: number; updated_at: string }
        Insert: never
        Update: never
        Relationships: []
      }
      activity_events: {
        Row: { id: number; user_id: string; pillar: Pillar; kind: string; occurred_on: string; payload: Json; source_ref: string; created_at: string }
        Insert: { pillar: Pillar; kind: string; occurred_on: string; payload?: Json; source_ref: string; user_id?: string }
        Update: never
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: {
      push_state: {
        Args: { p_data: Json; p_base_rev: number | null }
        Returns: Json
      }
    }
    Enums: { pillar: Pillar }
    CompositeTypes: Record<string, never>
  }
}
```

- [ ] **Step 2: `src/lib/supabase.ts`**

```ts
import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const supabaseConfigured = Boolean(url && anonKey)

// PKCE, not the implicit flow: the app routes with HashRouter, and the implicit flow returns the
// tokens in the hash, where they would collide with the routes.
export const supabase = createClient<Database>(url || 'http://localhost:54321', anonKey || 'missing-anon-key', {
  auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true }
})
```

- [ ] **Step 3: Testes que falham — `src/lib/backend.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  session: null as null | { user: { id: string; email: string; user_metadata: Record<string, string> } },
  select: { data: null as unknown, error: null as unknown, status: 200 },
  rpc: { data: null as unknown, error: null as unknown, status: 200 },
  signOut: vi.fn(async () => ({ error: null }))
}))

vi.mock('./supabase', () => ({
  supabaseConfigured: true,
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: h.session }, error: null }),
      signOut: h.signOut
    },
    from: () => ({ select: () => ({ maybeSingle: async () => h.select }) }),
    rpc: async () => h.rpc
  }
}))

import { backend, BackendError } from './backend'

const user = { id: 'u1', email: 'ana@x.dev', user_metadata: { full_name: 'Ana Souza' } }

beforeEach(() => {
  h.session = { user }
  h.select = { data: null, error: null, status: 200 }
  h.rpc = { data: null, error: null, status: 200 }
  h.signOut.mockClear()
})

describe('backend adapter', () => {
  it('answers /api/config without a session', async () => {
    h.session = null
    await expect(backend('/api/config')).resolves.toEqual({ invite_only: false, allow_guest: false, default_lang: 'pt-BR' })
  })

  it('maps the session to /api/me', async () => {
    await expect(backend('/api/me')).resolves.toEqual({ user: { id: 'u1', name: 'Ana Souza', admin: false } })
  })

  it('falls back to the e-mail for the name', async () => {
    h.session = { user: { ...user, user_metadata: {} } }
    await expect(backend('/api/me')).resolves.toMatchObject({ user: { name: 'ana' } })
  })

  it('answers 401 without a session', async () => {
    h.session = null
    await expect(backend('/api/me')).rejects.toMatchObject({ status: 401 })
    await expect(backend('/api/data')).rejects.toMatchObject({ status: 401 })
  })

  it('reads the document and its revision', async () => {
    h.select = { data: { data: { routines: [], _rev: 4 }, rev: 4 }, error: null, status: 200 }
    await expect(backend('/api/data')).resolves.toEqual({ state: { routines: [], _rev: 4 }, rev: 4 })
  })

  it('reads an empty account as state null, rev 0', async () => {
    await expect(backend('/api/data')).resolves.toEqual({ state: null, rev: 0 })
    await expect(backend('/api/data/rev')).resolves.toEqual({ rev: 0 })
  })

  it('pushes and returns the new revision', async () => {
    h.rpc = { data: { ok: true, rev: 5, ts: 9 }, error: null, status: 200 }
    const r = await backend('/api/data', { method: 'PUT', body: JSON.stringify({ state: { routines: [] }, baseRev: 4 }) })
    expect(r).toEqual({ ok: true, ts: 9, rev: 5 })
  })

  it('turns a conflict into a 409 carrying the server copy', async () => {
    h.rpc = { data: { ok: false, error: 'conflict', rev: 6, state: { _rev: 6 } }, error: null, status: 200 }
    const e = await backend('/api/data', { method: 'PUT', body: JSON.stringify({ state: { routines: [] }, baseRev: 4 }) }).catch(x => x)
    expect(e).toBeInstanceOf(BackendError)
    expect(e.status).toBe(409)
    expect(e.data).toEqual({ state: { _rev: 6 }, rev: 6 })
  })

  it.each([
    [{ message: 'state_too_large', code: '54000' }, 413],
    [{ message: 'invalid_state', code: '22023' }, 400],
    [{ message: 'JWT expired', code: 'PGRST301' }, 401],
    [{ message: 'boom', code: 'XX000' }, 500]
  ])('maps %j to %i', async (error, status) => {
    h.rpc = { data: null, error, status: 400 }
    await expect(backend('/api/data', { method: 'PUT', body: JSON.stringify({ state: { routines: [] } }) })).rejects.toMatchObject({ status })
  })

  it('reports a network failure with no status', async () => {
    h.select = { data: null, error: { message: 'TypeError: Failed to fetch', code: '' }, status: 0 }
    const e = await backend('/api/data').catch(x => x)
    expect(e.status).toBeUndefined()
  })

  it('signs out locally or everywhere', async () => {
    await backend('/api/logout', { method: 'POST', body: '{}' })
    await backend('/api/logout/all', { method: 'POST', body: '{}' })
    expect(h.signOut.mock.calls).toEqual([[{ scope: 'local' }], [{ scope: 'global' }]])
  })

  it('swallows the routes that only fed the old server', async () => {
    await expect(backend('/api/activity', { method: 'POST', body: '{}' })).resolves.toEqual({ ok: true })
    await expect(backend('/api/push/rest-timer', { method: 'POST', body: '{}' })).resolves.toEqual({ ok: true })
  })

  it('answers 404 for anything else', async () => {
    await expect(backend('/api/admin/users')).rejects.toMatchObject({ status: 404 })
  })
})
```

Run: `npx vitest run src/lib/backend.test.ts` — Expected: FAIL (módulo não existe).

- [ ] **Step 4: `src/lib/backend.ts`**

```ts
import type { User } from '@supabase/supabase-js'
import { supabase } from './supabase'

// The inherited store speaks openGym's REST contract (/api/data, /api/me…). This module answers
// that contract from Supabase, keeping the shapes the store's sync and conflict code rely on:
// a 409 carries { state, rev }, a refused session is a 401, and a request that never got an
// answer has no status at all (useStore's isNetworkError).

export class BackendError extends Error {
  status?: number
  data: Record<string, unknown>
  code?: string
  constructor(message: string, status: number | undefined, data: Record<string, unknown> = {}, code?: string) {
    super(message)
    this.name = 'BackendError'
    this.status = status
    this.data = data
    this.code = code
  }
}

type Init = { method?: string; body?: string }
type PgError = { message?: string; code?: string } | null

const NOOP = new Set(['POST /api/activity', 'POST /api/push/rest-timer', 'POST /api/push/rest-timer/cancel'])

const STATUS_BY_MESSAGE: Record<string, number> = {
  not_signed_in: 401,
  state_too_large: 413,
  state_required: 400,
  invalid_state: 400
}

export function toBackendError(error: PgError, httpStatus: number): BackendError {
  const message = error?.message || 'request failed'
  if (!httpStatus && !error?.code) return new BackendError(message, undefined, {}, 'network')
  const known = Object.keys(STATUS_BY_MESSAGE).find(k => message.includes(k))
  if (known) return new BackendError(known, STATUS_BY_MESSAGE[known], { error: known }, known)
  if (error?.code === 'PGRST301' || /jwt/i.test(message)) return new BackendError(message, 401, { error: 'not signed in' })
  return new BackendError(message, 500, { error: message }, error?.code)
}

export function displayName(user: User): string {
  const meta = user.user_metadata || {}
  return (meta.full_name || meta.name || (user.email || '').split('@')[0] || 'Atleta') as string
}

async function currentUser(): Promise<User> {
  const { data } = await supabase.auth.getSession()
  const user = data.session?.user
  if (!user) throw new BackendError('not signed in', 401, { error: 'not signed in' })
  return user
}

export async function backend(path: string, init: Init = {}): Promise<any> {
  const method = (init.method || 'GET').toUpperCase()
  const route = method + ' ' + path.split('?')[0]
  if (NOOP.has(route)) return { ok: true }

  switch (route) {
    case 'GET /api/config':
      return { invite_only: false, allow_guest: false, default_lang: 'pt-BR' }

    case 'GET /api/me': {
      const user = await currentUser()
      return { user: { id: user.id, name: displayName(user), admin: false } }
    }

    case 'GET /api/data': {
      await currentUser()
      const { data, error, status } = await supabase.from('app_state').select('data, rev').maybeSingle()
      if (error) throw toBackendError(error, status)
      return { state: (data?.data as Record<string, unknown> | undefined) ?? null, rev: data?.rev ?? 0 }
    }

    case 'GET /api/data/rev': {
      await currentUser()
      const { data, error, status } = await supabase.from('app_state').select('rev').maybeSingle()
      if (error) throw toBackendError(error, status)
      return { rev: data?.rev ?? 0 }
    }

    case 'PUT /api/data': {
      await currentUser()
      const body = JSON.parse(init.body || '{}') as { state?: unknown; baseRev?: number }
      const { data, error, status } = await supabase.rpc('push_state', {
        p_data: (body.state ?? null) as never,
        p_base_rev: body.baseRev ?? null
      })
      if (error) throw toBackendError(error, status)
      const r = data as { ok: boolean; rev: number; ts?: unknown; state?: unknown }
      if (!r.ok) throw new BackendError('conflict', 409, { state: r.state ?? null, rev: r.rev })
      return { ok: true, ts: r.ts ?? null, rev: r.rev }
    }

    case 'POST /api/logout':
      await supabase.auth.signOut({ scope: 'local' })
      return { ok: true }

    case 'POST /api/logout/all':
      await supabase.auth.signOut({ scope: 'global' })
      return { ok: true }

    default:
      throw new BackendError('not available', 404, { error: 'not available' })
  }
}
```

Run: `npx vitest run src/lib/backend.test.ts` — Expected: PASS.

- [ ] **Step 5: `setTransport` em `src/lib/api.js`**

Logo após `export { appBase }`:

```js
// A transport answers api() calls in place of the HTTP server — the Supabase adapter
// (lib/backend.ts) installs itself here at start-up. Tests that exercise the fetch path leave it
// unset.
let transport = null
export function setTransport(fn) { transport = fn || null }
```

No início do corpo de `export async function api(path, opts) {`:

```js
  if (transport) {
    const { timeout, ...init } = opts || {}
    return transport(path, init)
  }
```

No início de `export function beacon(path, body) {`: `if (transport) return false`.

Em `src/main.jsx`, antes do `createRoot`:

```js
import { setTransport } from './lib/api.js'
import { backend } from './lib/backend.ts'

setTransport(backend)
```

- [ ] **Step 6: Verificar**

```bash
npm run typecheck
npm test
npm run build
```

Expected: verdes (os testes do store continuam mockando `api`; `api.test.js` continua testando o caminho `fetch`, já que não chama `setTransport`).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: answer the store's /api contract from Supabase

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Tela Entrar com Google e saída

**Files:**
- Create: `src/features/auth/auth.ts`, `src/features/auth/auth.test.ts`, `src/features/auth/SignIn.tsx`, `src/features/auth/SignIn.test.tsx`
- Delete: `src/views/Login.jsx`
- Modify: `src/App.jsx`, `src/locales/pt-BR.js`

**Interfaces:**
- Consumes: `supabase`, `supabaseConfigured` (Task 5).
- Produces: `signInWithGoogle(): Promise<void>`; `cleanAuthParams(loc?: Location, hist?: History): void` (remove `code`, `error`, `error_description` da query mantendo o hash); componente default `SignIn`.

- [ ] **Step 1: Testes que falham — `src/features/auth/auth.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const signInWithOAuth = vi.fn(async () => ({ error: null }))
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { signInWithOAuth } }, supabaseConfigured: true }))

import { signInWithGoogle, cleanAuthParams } from './auth'

beforeEach(() => signInWithOAuth.mockClear())

describe('signInWithGoogle', () => {
  it('starts the Google flow back to this page', async () => {
    await signInWithGoogle({ origin: 'https://perf.app', pathname: '/' } as Location)
    expect(signInWithOAuth).toHaveBeenCalledWith({ provider: 'google', options: { redirectTo: 'https://perf.app/' } })
  })

  it('throws what Supabase reports', async () => {
    signInWithOAuth.mockResolvedValueOnce({ error: { message: 'provider disabled' } } as never)
    await expect(signInWithGoogle({ origin: 'https://perf.app', pathname: '/' } as Location)).rejects.toThrow('provider disabled')
  })
})

describe('cleanAuthParams', () => {
  it('drops the OAuth query and keeps the route', () => {
    const replaceState = vi.fn()
    cleanAuthParams({ search: '?code=abc&x=1', pathname: '/', hash: '#/home' } as Location, { replaceState } as unknown as History)
    expect(replaceState).toHaveBeenCalledWith(null, '', '/?x=1#/home')
  })

  it('does nothing without OAuth params', () => {
    const replaceState = vi.fn()
    cleanAuthParams({ search: '', pathname: '/', hash: '#/home' } as Location, { replaceState } as unknown as History)
    expect(replaceState).not.toHaveBeenCalled()
  })
})
```

Run: `npx vitest run src/features/auth/auth.test.ts` — Expected: FAIL.

- [ ] **Step 2: `src/features/auth/auth.ts`**

```ts
import { supabase } from '@/lib/supabase'

const OAUTH_PARAMS = ['code', 'error', 'error_description', 'error_code']

export async function signInWithGoogle(loc: Location = window.location): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: loc.origin + loc.pathname }
  })
  if (error) throw new Error(error.message)
}

// After the redirect back, supabase-js has already exchanged ?code= for a session; the query is
// left in the address bar, where a reload or a shared link would carry it. The hash is the route.
export function cleanAuthParams(loc: Location = window.location, hist: History = window.history): void {
  const params = new URLSearchParams(loc.search)
  if (!OAUTH_PARAMS.some(p => params.has(p))) return
  OAUTH_PARAMS.forEach(p => params.delete(p))
  const q = params.toString()
  hist.replaceState(null, '', loc.pathname + (q ? '?' + q : '') + loc.hash)
}
```

Run: `npx vitest run src/features/auth/auth.test.ts` — Expected: PASS.

- [ ] **Step 3: Teste que falha — `src/features/auth/SignIn.test.tsx`**

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const go = vi.fn(async () => {})
vi.mock('./auth', () => ({ signInWithGoogle: () => go() }))
vi.mock('@/lib/supabase', () => ({ supabaseConfigured: true }))

import SignIn from './SignIn'

describe('SignIn', () => {
  it('starts Google sign-in from the main button', async () => {
    render(<SignIn />)
    fireEvent.click(screen.getByRole('button', { name: /google/i }))
    expect(go).toHaveBeenCalledOnce()
  })
})
```

```bash
npm i -D @testing-library/react
```

Run: `npx vitest run src/features/auth/SignIn.test.tsx` — Expected: FAIL.

- [ ] **Step 4: `src/features/auth/SignIn.tsx`**

```tsx
import { useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { Button } from '@/components/ui/button'
import { supabaseConfigured } from '@/lib/supabase'
import { t } from '../../lib/i18n.js'
import { signInWithGoogle } from './auth'

function GoogleMark() {
  return (
    <svg aria-hidden viewBox="0 0 48 48" className="size-5">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  )
}

export default function SignIn() {
  const reduce = useReducedMotion()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const start = async () => {
    setBusy(true)
    setError(null)
    try {
      await signInWithGoogle()
    } catch (e) {
      setError((e as Error).message || t('Could not start sign-in. Try again.'))
      setBusy(false)
    }
  }

  return (
    <main className="relative flex min-h-dvh flex-col justify-between overflow-hidden bg-background px-6 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-[calc(4rem+env(safe-area-inset-top))] text-foreground">
      <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 size-[36rem] -translate-x-1/2 rounded-full bg-primary/15 blur-3xl" />
      <motion.section
        initial={reduce ? false : { opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className="relative"
      >
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">Performance</p>
        <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-tight">
          {t('Train, track, keep the streak.')}
        </h1>
        <p className="mt-3 max-w-sm text-base text-muted-foreground">
          {t('Your workouts, your progress and your consistency — with your friends.')}
        </p>
      </motion.section>

      <div className="relative flex flex-col gap-3">
        {!supabaseConfigured && (
          <p role="alert" className="rounded-lg bg-destructive/15 p-3 text-sm text-destructive">
            {t('The server is not configured yet.')}
          </p>
        )}
        {error && (
          <p role="alert" className="rounded-lg bg-destructive/15 p-3 text-sm text-destructive">{error}</p>
        )}
        <Button size="lg" className="h-12 w-full gap-3 rounded-xl text-base" onClick={start} disabled={busy || !supabaseConfigured}>
          <GoogleMark />
          {busy ? t('Opening Google…') : t('Continue with Google')}
        </Button>
      </div>
    </main>
  )
}
```

Run: `npx vitest run src/features/auth/SignIn.test.tsx` — Expected: PASS.

- [ ] **Step 5: Ligar no App e limpar a URL**

Em `src/App.jsx`: trocar `import Login from './views/Login.jsx'` por `import SignIn from './features/auth/SignIn.tsx'` e `<Login />` por `<SignIn />`. Em `src/main.jsx`, após `setTransport(backend)`:

```js
import { supabase } from './lib/supabase.ts'
import { cleanAuthParams } from './features/auth/auth.ts'

supabase.auth.getSession().finally(() => cleanAuthParams())
```

```bash
git rm -q src/views/Login.jsx
```

- [ ] **Step 6: Traduções**

Em `src/locales/pt-BR.js`, dentro de `PT_BR_OVERRIDES`:

```js
  'Train, track, keep the streak.': 'Treine, registre, mantenha a sequência.',
  'Your workouts, your progress and your consistency — with your friends.': 'Seus treinos, seu progresso e sua consistência — com seus amigos.',
  'Continue with Google': 'Continuar com Google',
  'Opening Google…': 'Abrindo o Google…',
  'Could not start sign-in. Try again.': 'Não foi possível iniciar o login. Tente de novo.',
  'The server is not configured yet.': 'O servidor ainda não está configurado.',
```

Rodar o verificador de strings herdado e os testes de locale:

```bash
node scripts/check-locales.mjs
npx vitest run src/lib/pt-br-locale.test.js src/lib/locale-coverage.test.js
```

Se `check-source-strings.mjs`/`check-locales.mjs` não varrerem `.tsx`, editar o glob do script para incluir `src/features/**/*.{ts,tsx}` (localizar com `grep -n "jsx" scripts/check-*.mjs`). Se `pt-br-locale.test.js` exigir fingerprint para chaves novas (`scripts/pt-br-inheritance-fingerprint.mjs`), rodar `node scripts/pt-br-inheritance-fingerprint.mjs` e commitar a saída que ele atualiza.

- [ ] **Step 7: Verificar e commitar**

```bash
npm run typecheck && npm test && npm run build
git add -A
git commit -m "feat(auth): Google sign-in screen

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Domínio do perfil (tipos, API, store, aplicação ao app, sugestão de plano)

**Files:**
- Create: `src/features/profile/types.ts`, `profile-api.ts`, `profile-api.test.ts`, `useProfile.ts`, `useProfile.test.ts`, `profile-apply.ts`, `profile-apply.test.ts`, `starter-suggest.ts`, `starter-suggest.test.ts` (todos em `src/features/profile/`)

**Interfaces:**
- Consumes: `supabase` (Task 5); `ALL_EQUIPMENT` de `src/lib/equipment.js`; `newProfile` de `src/lib/equipment.js`; `todayISO` de `src/lib/format.js`.
- Produces:
  - `types.ts`: `Goal`, `Level`, `Sex`, `Unit`, `Locale`, `Profile` (= Row de `profiles`), `ProfileInput` (campos editáveis, sem `id/created_at/updated_at`), `GOALS`, `LEVELS`, `SEXES` (arrays `as const`).
  - `profile-api.ts`: `fetchProfile(userId): Promise<Profile | null>`; `createProfile(userId, input: ProfileInput): Promise<Profile>`; `updateProfile(userId, patch: Partial<ProfileInput>): Promise<Profile>`; `validateProfileInput(input: Partial<ProfileInput>): Record<string, string>` (chave do campo → mensagem em inglês para `t()`; vazio = válido).
  - `useProfile.ts`: hook Zustand `useProfile` com `{ status: 'idle'|'loading'|'missing'|'ready'|'error', profile: Profile|null, userId: string|null, onboarding: boolean, suggestion: StarterPlanId|null, load(userId), create(input), save(patch), setSuggestion(id), finishOnboarding(), reset() }`; `create` liga `onboarding` (o `ProfileGate` mantém o Onboarding na tela até `finishOnboarding()`); cache em `localStorage['perf_profile_v1']` = `{ userId, profile }`.
  - `profile-apply.ts`: `applyProfileToState(S, profile, opts: { today: string; withWeight: boolean }): S` (puro, retorna cópia).
  - `starter-suggest.ts`: `suggestStarterPlan({ days, level, goal }): 'full-body'|'upper-lower'|'ppl'|'5x5'`.

- [ ] **Step 1: `types.ts`**

```ts
import type { Database } from '@/lib/database.types'

export type Profile = Database['public']['Tables']['profiles']['Row']
export type Goal = NonNullable<Profile['goal']>
export type Level = NonNullable<Profile['level']>
export type Sex = NonNullable<Profile['sex']>
export type Unit = Profile['unit']
export type Locale = Profile['locale']

export type ProfileInput = Omit<Profile, 'id' | 'created_at' | 'updated_at'>

export const GOALS = ['hypertrophy', 'strength', 'fat_loss', 'conditioning'] as const satisfies readonly Goal[]
export const LEVELS = ['beginner', 'intermediate', 'advanced'] as const satisfies readonly Level[]
export const SEXES = ['male', 'female', 'other'] as const satisfies readonly Sex[]
```

- [ ] **Step 2: Testes que falham — `starter-suggest.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { suggestStarterPlan } from './starter-suggest'

describe('suggestStarterPlan', () => {
  it.each([
    [{ days: 1, level: 'beginner', goal: 'hypertrophy' }, 'full-body'],
    [{ days: 3, level: 'beginner', goal: 'hypertrophy' }, 'full-body'],
    [{ days: 3, level: 'advanced', goal: 'hypertrophy' }, 'full-body'],
    [{ days: 3, level: 'beginner', goal: 'strength' }, '5x5'],
    [{ days: 3, level: 'intermediate', goal: 'strength' }, '5x5'],
    [{ days: 3, level: 'advanced', goal: 'strength' }, 'full-body'],
    [{ days: 2, level: 'intermediate', goal: 'strength' }, '5x5'],
    [{ days: 4, level: 'beginner', goal: 'fat_loss' }, 'upper-lower'],
    [{ days: 4, level: 'advanced', goal: 'strength' }, 'upper-lower'],
    [{ days: 5, level: 'beginner', goal: 'hypertrophy' }, 'upper-lower'],
    [{ days: 5, level: 'intermediate', goal: 'hypertrophy' }, 'ppl'],
    [{ days: 7, level: 'advanced', goal: 'conditioning' }, 'ppl']
  ] as const)('%j → %s', (input, plan) => {
    expect(suggestStarterPlan(input)).toBe(plan)
  })

  it('treats a missing level as beginner and a missing goal as hypertrophy', () => {
    expect(suggestStarterPlan({ days: 5, level: null, goal: null })).toBe('upper-lower')
  })
})
```

Run: `npx vitest run src/features/profile/starter-suggest.test.ts` — Expected: FAIL.

- [ ] **Step 3: `starter-suggest.ts`**

```ts
import type { Goal, Level } from './types'

export type StarterPlanId = 'full-body' | 'upper-lower' | 'ppl' | '5x5'

// The spec's table (§3.4): days per week picks the split; a strength goal on three days or fewer
// at beginner/intermediate level gets 5×5. Ids match lib/starter.js PLANS.
export function suggestStarterPlan({ days, level, goal }: { days: number; level: Level | null; goal: Goal | null }): StarterPlanId {
  const lvl = level ?? 'beginner'
  const g = goal ?? 'hypertrophy'
  if (days <= 3) return g === 'strength' && lvl !== 'advanced' ? '5x5' : 'full-body'
  if (days === 4) return 'upper-lower'
  return lvl === 'beginner' ? 'upper-lower' : 'ppl'
}
```

Run — Expected: PASS.

- [ ] **Step 4: Testes que falham — `profile-apply.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { applyProfileToState } from './profile-apply'
import type { Profile } from './types'

const base = { unit: 'kg', lang: 'en', weekStart: 0, bodyweight: [], equipProfiles: [], activeEquipId: null, equipFilterOn: false, routines: [] }
const profile: Profile = {
  id: 'u1', display_name: 'Ana', avatar_url: null, birth_date: '1990-05-01', sex: 'female', height_cm: 165,
  weight_kg: 62.5, goal: 'hypertrophy', level: 'beginner', days_per_week: 3, equipment: ['barbell', 'dumbbell'],
  unit: 'kg', locale: 'pt-BR', timezone: 'America/Sao_Paulo', share_activity: false, created_at: '', updated_at: ''
}

describe('applyProfileToState', () => {
  it('sets language, Monday week start and the unit', () => {
    const S = applyProfileToState(base, profile, { today: '2026-10-05', withWeight: false })
    expect(S).toMatchObject({ lang: 'pt-BR', weekStart: 1, unit: 'kg' })
    expect(base.lang).toBe('en')
  })

  it('creates and activates an equipment profile from the chosen equipment', () => {
    const S = applyProfileToState(base, profile, { today: '2026-10-05', withWeight: false })
    expect(S.equipProfiles).toHaveLength(1)
    expect(S.equipProfiles[0]).toMatchObject({ name: 'Perfil', equipment: ['barbell', 'dumbbell'] })
    expect(S.activeEquipId).toBe(S.equipProfiles[0].id)
    expect(S.equipFilterOn).toBe(true)
  })

  it('updates the same equipment profile on a later apply', () => {
    const once = applyProfileToState(base, profile, { today: '2026-10-05', withWeight: false })
    const twice = applyProfileToState(once, { ...profile, equipment: ['cable'] }, { today: '2026-10-05', withWeight: false })
    expect(twice.equipProfiles).toHaveLength(1)
    expect(twice.equipProfiles[0].equipment).toEqual(['cable'])
  })

  it('leaves the filter off when no equipment was chosen', () => {
    const S = applyProfileToState(base, { ...profile, equipment: [] }, { today: '2026-10-05', withWeight: false })
    expect(S.equipFilterOn).toBe(false)
  })

  it('logs today’s weight when asked, in the profile unit', () => {
    const S = applyProfileToState(base, profile, { today: '2026-10-05', withWeight: true })
    expect(S.bodyweight).toEqual([{ d: '2026-10-05', w: 62.5, t: expect.any(Number) }])
  })

  it('converts the weight to lb for an lb profile', () => {
    const S = applyProfileToState({ ...base, unit: 'lb' }, { ...profile, unit: 'lb' }, { today: '2026-10-05', withWeight: true })
    expect(S.bodyweight[0].w).toBe(137.8)
  })

  it('replaces an existing entry for the same day', () => {
    const S0 = { ...base, bodyweight: [{ d: '2026-10-05', w: 70, t: 1 }] }
    const S = applyProfileToState(S0, profile, { today: '2026-10-05', withWeight: true })
    expect(S.bodyweight).toHaveLength(1)
    expect(S.bodyweight[0].w).toBe(62.5)
  })
})
```

Run: `npx vitest run src/features/profile/profile-apply.test.ts` — Expected: FAIL.

- [ ] **Step 5: `profile-apply.ts`**

```ts
import type { Profile } from './types'

// The equipment profile the app's library filter uses (lib/equipment.js) — one, owned by the
// performance profile, found again by this id prefix on later applies.
const EQUIP_ID = 'eq-profile'
const KG_TO_LB = 2.2046226218

type AppState = Record<string, any>

// Pure: returns a new state with what the profile decides — language, Monday week start, unit
// label (a fresh account has no numbers to convert; a later unit change goes through the store's
// setUnit), the equipment filter, and optionally today's weigh-in.
export function applyProfileToState(S: AppState, profile: Profile, opts: { today: string; withWeight: boolean }): AppState {
  const next: AppState = { ...S, lang: profile.locale, weekStart: 1, unit: profile.unit }

  const others = (S.equipProfiles || []).filter((p: { id: string }) => p.id !== EQUIP_ID)
  const mine = { id: EQUIP_ID, name: 'Perfil', equipment: [...profile.equipment] }
  next.equipProfiles = [...others, mine]
  next.activeEquipId = EQUIP_ID
  next.equipFilterOn = profile.equipment.length > 0

  if (opts.withWeight && profile.weight_kg) {
    const w = profile.unit === 'lb' ? Math.round(profile.weight_kg * KG_TO_LB * 10) / 10 : Number(profile.weight_kg)
    const rest = (S.bodyweight || []).filter((b: { d: string }) => b.d !== opts.today)
    next.bodyweight = [...rest, { d: opts.today, w, t: Date.now() }].sort((a, b) => (a.d < b.d ? -1 : 1))
  }
  return next
}
```

Run — Expected: PASS.

- [ ] **Step 6: Testes que falham — `profile-api.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ result: { data: null as unknown, error: null as unknown }, calls: [] as unknown[][] }))
vi.mock('@/lib/supabase', () => {
  const chain: Record<string, unknown> = {}
  const record = (name: string) => (...args: unknown[]) => { h.calls.push([name, ...args]); return chain }
  Object.assign(chain, {
    select: record('select'), insert: record('insert'), update: record('update'), eq: record('eq'),
    maybeSingle: async () => h.result, single: async () => h.result
  })
  return { supabase: { from: (t: string) => { h.calls.push(['from', t]); return chain } } }
})

import { fetchProfile, createProfile, updateProfile, validateProfileInput } from './profile-api'

beforeEach(() => { h.calls = []; h.result = { data: null, error: null } })

describe('profile-api', () => {
  it('fetches by id and returns null when absent', async () => {
    await expect(fetchProfile('u1')).resolves.toBeNull()
    expect(h.calls).toContainEqual(['eq', 'id', 'u1'])
  })

  it('creates with the user id', async () => {
    h.result = { data: { id: 'u1', display_name: 'Ana' }, error: null }
    await createProfile('u1', { display_name: 'Ana' } as never)
    expect(h.calls).toContainEqual(['insert', { id: 'u1', display_name: 'Ana' }])
  })

  it('updates only the patch', async () => {
    h.result = { data: { id: 'u1' }, error: null }
    await updateProfile('u1', { days_per_week: 4 })
    expect(h.calls).toContainEqual(['update', { days_per_week: 4 }])
  })

  it('throws Supabase errors', async () => {
    h.result = { data: null, error: { message: 'nope' } }
    await expect(updateProfile('u1', { days_per_week: 4 })).rejects.toThrow('nope')
  })
})

describe('validateProfileInput', () => {
  it('accepts a complete, in-range profile', () => {
    expect(validateProfileInput({ display_name: 'Ana', height_cm: 165, weight_kg: 62, days_per_week: 3, birth_date: '1990-05-01' })).toEqual({})
  })

  it.each([
    [{ display_name: '  ' }, 'display_name'],
    [{ display_name: 'x'.repeat(61) }, 'display_name'],
    [{ height_cm: 40 }, 'height_cm'],
    [{ weight_kg: 401 }, 'weight_kg'],
    [{ days_per_week: 8 }, 'days_per_week'],
    [{ birth_date: '2030-01-01' }, 'birth_date']
  ])('flags %j on %s', (input, field) => {
    expect(Object.keys(validateProfileInput(input))).toContain(field)
  })
})
```

Run — Expected: FAIL.

- [ ] **Step 7: `profile-api.ts`**

```ts
import { supabase } from '@/lib/supabase'
import type { Profile, ProfileInput } from './types'

export async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as Profile | null) ?? null
}

export async function createProfile(userId: string, input: Partial<ProfileInput>): Promise<Profile> {
  const { data, error } = await supabase.from('profiles').insert({ id: userId, ...input } as never).select('*').single()
  if (error) throw new Error(error.message)
  return data as Profile
}

export async function updateProfile(userId: string, patch: Partial<ProfileInput>): Promise<Profile> {
  const { data, error } = await supabase.from('profiles').update(patch as never).eq('id', userId).select('*').single()
  if (error) throw new Error(error.message)
  return data as Profile
}

// Field → English message (shown through t()). Mirrors the table's check constraints so the
// form says what is wrong before the server refuses it.
export function validateProfileInput(input: Partial<ProfileInput>): Record<string, string> {
  const errors: Record<string, string> = {}
  if ('display_name' in input) {
    const n = (input.display_name ?? '').trim()
    if (n.length < 1 || n.length > 60) errors.display_name = 'Enter a name up to 60 characters.'
  }
  if (input.height_cm != null && (input.height_cm < 50 || input.height_cm > 260)) errors.height_cm = 'Height must be between 50 and 260 cm.'
  if (input.weight_kg != null && (input.weight_kg < 20 || input.weight_kg > 400)) errors.weight_kg = 'Weight must be between 20 and 400 kg.'
  if (input.days_per_week != null && (input.days_per_week < 1 || input.days_per_week > 7)) errors.days_per_week = 'Choose between 1 and 7 days.'
  if (input.birth_date) {
    const d = new Date(input.birth_date + 'T00:00:00')
    if (Number.isNaN(d.getTime()) || d > new Date()) errors.birth_date = 'Enter a valid birth date.'
  }
  return errors
}
```

Run — Expected: PASS.

- [ ] **Step 8: Testes que falham — `useProfile.test.ts`**

```ts
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'

const api = vi.hoisted(() => ({ fetchProfile: vi.fn(), createProfile: vi.fn(), updateProfile: vi.fn() }))
vi.mock('./profile-api', () => api)

import { useProfile } from './useProfile'

const P = { id: 'u1', display_name: 'Ana' }

beforeEach(() => {
  localStorage.clear()
  useProfile.getState().reset()
  Object.values(api).forEach(f => f.mockReset())
})

describe('useProfile', () => {
  it('goes to missing when there is no profile', async () => {
    api.fetchProfile.mockResolvedValue(null)
    await useProfile.getState().load('u1')
    expect(useProfile.getState().status).toBe('missing')
  })

  it('goes to ready and caches the profile', async () => {
    api.fetchProfile.mockResolvedValue(P)
    await useProfile.getState().load('u1')
    expect(useProfile.getState()).toMatchObject({ status: 'ready', profile: P, userId: 'u1' })
    expect(JSON.parse(localStorage.getItem('perf_profile_v1')!)).toEqual({ userId: 'u1', profile: P })
  })

  it('uses the cached profile when offline', async () => {
    localStorage.setItem('perf_profile_v1', JSON.stringify({ userId: 'u1', profile: P }))
    api.fetchProfile.mockRejectedValue(new TypeError('Failed to fetch'))
    await useProfile.getState().load('u1')
    expect(useProfile.getState()).toMatchObject({ status: 'ready', profile: P })
  })

  it('ignores another user’s cache and reports the error', async () => {
    localStorage.setItem('perf_profile_v1', JSON.stringify({ userId: 'u2', profile: P }))
    api.fetchProfile.mockRejectedValue(new TypeError('Failed to fetch'))
    await useProfile.getState().load('u1')
    expect(useProfile.getState().status).toBe('error')
  })

  it('creates and becomes ready', async () => {
    api.fetchProfile.mockResolvedValue(null)
    api.createProfile.mockResolvedValue(P)
    await useProfile.getState().load('u1')
    await useProfile.getState().create({ display_name: 'Ana' } as never)
    expect(api.createProfile).toHaveBeenCalledWith('u1', { display_name: 'Ana' })
    expect(useProfile.getState().status).toBe('ready')
  })

  it('saves optimistically and rolls back on failure', async () => {
    api.fetchProfile.mockResolvedValue(P)
    await useProfile.getState().load('u1')
    api.updateProfile.mockRejectedValue(new Error('nope'))
    const pending = useProfile.getState().save({ display_name: 'Bia' })
    expect(useProfile.getState().profile?.display_name).toBe('Bia')
    await expect(pending).rejects.toThrow('nope')
    expect(useProfile.getState().profile?.display_name).toBe('Ana')
  })

  it('stays in onboarding after create until finishOnboarding', async () => {
    api.fetchProfile.mockResolvedValue(null)
    api.createProfile.mockResolvedValue(P)
    await useProfile.getState().load('u1')
    await useProfile.getState().create({ display_name: 'Ana' } as never)
    useProfile.getState().setSuggestion('5x5')
    expect(useProfile.getState()).toMatchObject({ onboarding: true, suggestion: '5x5' })
    useProfile.getState().finishOnboarding()
    expect(useProfile.getState()).toMatchObject({ onboarding: false, suggestion: null })
  })

  it('reset clears state and cache', async () => {
    api.fetchProfile.mockResolvedValue(P)
    await useProfile.getState().load('u1')
    useProfile.getState().reset()
    expect(useProfile.getState()).toMatchObject({ status: 'idle', profile: null, userId: null, onboarding: false, suggestion: null })
    expect(localStorage.getItem('perf_profile_v1')).toBeNull()
  })
})
```

Run — Expected: FAIL.

- [ ] **Step 9: `useProfile.ts`**

```ts
import { create } from 'zustand'
import { fetchProfile, createProfile, updateProfile } from './profile-api'
import type { StarterPlanId } from './starter-suggest'
import type { Profile, ProfileInput } from './types'

const CACHE = 'perf_profile_v1'
type Status = 'idle' | 'loading' | 'missing' | 'ready' | 'error'

interface ProfileStore {
  status: Status
  profile: Profile | null
  userId: string | null
  // True from the moment the profile is created until the user leaves the plan suggestion:
  // status is already 'ready' then, and ProfileGate must keep the onboarding on screen.
  onboarding: boolean
  suggestion: StarterPlanId | null
  load(userId: string): Promise<void>
  create(input: Partial<ProfileInput>): Promise<Profile>
  save(patch: Partial<ProfileInput>): Promise<Profile>
  setSuggestion(id: StarterPlanId): void
  finishOnboarding(): void
  reset(): void
}

const readCache = (userId: string): Profile | null => {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE) || 'null')
    return c && c.userId === userId ? (c.profile as Profile) : null
  } catch { return null }
}
const writeCache = (userId: string, profile: Profile) => {
  try { localStorage.setItem(CACHE, JSON.stringify({ userId, profile })) } catch { /* storage full or blocked */ }
}

export const useProfile = create<ProfileStore>((set, get) => ({
  status: 'idle',
  profile: null,
  userId: null,
  onboarding: false,
  suggestion: null,

  async load(userId) {
    set({ status: 'loading', userId })
    try {
      const profile = await fetchProfile(userId)
      if (get().userId !== userId) return
      if (!profile) { set({ status: 'missing', profile: null }); return }
      writeCache(userId, profile)
      set({ status: 'ready', profile })
    } catch {
      if (get().userId !== userId) return
      const cached = readCache(userId)
      set(cached ? { status: 'ready', profile: cached } : { status: 'error', profile: null })
    }
  },

  async create(input) {
    const userId = get().userId
    if (!userId) throw new Error('not signed in')
    const profile = await createProfile(userId, input)
    writeCache(userId, profile)
    set({ status: 'ready', profile, onboarding: true })
    return profile
  },

  setSuggestion(id) {
    set({ suggestion: id })
  },

  finishOnboarding() {
    set({ onboarding: false, suggestion: null })
  },

  async save(patch) {
    const { userId, profile: before } = get()
    if (!userId || !before) throw new Error('no profile')
    set({ profile: { ...before, ...patch } as Profile })
    try {
      const profile = await updateProfile(userId, patch)
      writeCache(userId, profile)
      set({ profile })
      return profile
    } catch (e) {
      set({ profile: before })
      throw e
    }
  },

  reset() {
    try { localStorage.removeItem(CACHE) } catch { /* ignore */ }
    set({ status: 'idle', profile: null, userId: null, onboarding: false, suggestion: null })
  }
}))
```

Run: `npx vitest run src/features/profile` — Expected: PASS.

- [ ] **Step 10: Traduções das mensagens de validação**

Em `src/locales/pt-BR.js` (`PT_BR_OVERRIDES`):

```js
  'Enter a name up to 60 characters.': 'Digite um nome de até 60 caracteres.',
  'Height must be between 50 and 260 cm.': 'A altura deve estar entre 50 e 260 cm.',
  'Weight must be between 20 and 400 kg.': 'O peso deve estar entre 20 e 400 kg.',
  'Choose between 1 and 7 days.': 'Escolha entre 1 e 7 dias.',
  'Enter a valid birth date.': 'Digite uma data de nascimento válida.',
```

As mensagens ficam como literais em `profile-api.ts`; o componente chama `t(errors[campo])`. Se `check-source-strings.mjs` exigir que toda chave apareça dentro de `t('...')` no código, acrescentar em `profile-api.ts` a linha `// t('Enter a name up to 60 characters.') t('Height must be between 50 and 260 cm.') t('Weight must be between 20 and 400 kg.') t('Choose between 1 and 7 days.') t('Enter a valid birth date.')` — o script lê o texto do arquivo, então o comentário basta para registrá-las.

- [ ] **Step 11: Verificar e commitar**

```bash
npm run typecheck && npm test
git add -A
git commit -m "feat(profile): profile types, API, store, state apply and starter suggestion

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Onboarding em 3 passos e `ProfileGate`

**Files:**
- Create: `src/features/profile/ProfileFields.tsx`, `src/features/profile/Onboarding.tsx`, `src/features/profile/Onboarding.test.tsx`, `src/features/profile/ProfileGate.tsx`, `src/features/profile/ProfileGate.test.tsx`
- Modify: `src/App.jsx`, `src/locales/pt-BR.js`

**Interfaces:**
- Consumes: `useProfile`, `validateProfileInput`, `applyProfileToState`, `suggestStarterPlan` (Task 7); `useStore` (`user`, `update`, `S`); `ALL_EQUIPMENT` (`src/lib/equipment.js`); `loadStarterPlan(planId)` (`src/sheets.jsx`); `todayISO` (`src/lib/format.js`); `emit` (Task 10 — a Task 8 cria um stub com a assinatura final; ver Step 5).
- Produces: `ProfileGate({ children })`; `Onboarding()`; componentes de campo reutilizáveis `NameField`, `BodyFields`, `GoalFields`, `EquipmentField` exportados de `ProfileFields.tsx`, cada um com props `{ value: Partial<ProfileInput>; onChange(patch: Partial<ProfileInput>): void; errors: Record<string, string> }`.

- [ ] **Step 1: Teste que falha — `ProfileGate.test.tsx`**

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const store = vi.hoisted(() => ({ state: { status: 'idle', profile: null, userId: null, load: vi.fn(), reset: vi.fn() } as any }))
vi.mock('./useProfile', () => ({ useProfile: (sel?: (s: unknown) => unknown) => (sel ? sel(store.state) : store.state) }))
vi.mock('./Onboarding', () => ({ default: () => <div>onboarding</div> }))
vi.mock('../../store/useStore.js', () => ({ useStore: (sel: (s: unknown) => unknown) => sel({ user: { id: 'u1' } }) }))

import ProfileGate from './ProfileGate'

beforeEach(() => { store.state = { ...store.state, load: vi.fn(), reset: vi.fn() } })

describe('ProfileGate', () => {
  it('loads the profile of the signed-in user', () => {
    store.state.status = 'idle'
    render(<ProfileGate><div>app</div></ProfileGate>)
    expect(store.state.load).toHaveBeenCalledWith('u1')
  })

  it('shows onboarding when the profile is missing', () => {
    store.state = { ...store.state, status: 'missing', userId: 'u1' }
    render(<ProfileGate><div>app</div></ProfileGate>)
    expect(screen.getByText('onboarding')).toBeTruthy()
  })

  it('shows the app when ready', () => {
    store.state = { ...store.state, status: 'ready', userId: 'u1', profile: { id: 'u1' } }
    render(<ProfileGate><div>app</div></ProfileGate>)
    expect(screen.getByText('app')).toBeTruthy()
  })

  it('offers a retry on error', () => {
    store.state = { ...store.state, status: 'error', userId: 'u1' }
    render(<ProfileGate><div>app</div></ProfileGate>)
    screen.getByRole('button', { name: /try again/i }).click()
    expect(store.state.load).toHaveBeenCalledWith('u1')
  })

  it('keeps onboarding on screen while it is finishing', () => {
    store.state = { ...store.state, status: 'ready', userId: 'u1', profile: { id: 'u1' }, onboarding: true }
    render(<ProfileGate><div>app</div></ProfileGate>)
    expect(screen.getByText('onboarding')).toBeTruthy()
  })
})
```

Run — Expected: FAIL.

- [ ] **Step 2: `ProfileGate.tsx`**

```tsx
import { useEffect, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useStore } from '../../store/useStore.js'
import { t } from '../../lib/i18n.js'
import { useProfile } from './useProfile'
import Onboarding from './Onboarding'

export default function ProfileGate({ children }: { children: ReactNode }) {
  const userId = useStore((s: { user: { id: string } | null }) => s.user?.id ?? null)
  const { status, userId: loadedFor, onboarding, load } = useProfile()

  useEffect(() => {
    if (userId && (loadedFor !== userId || status === 'idle')) load(userId)
  }, [userId, loadedFor, status, load])

  if (status === 'missing' || (status === 'ready' && onboarding)) return <Onboarding />
  if (status === 'ready') return <>{children}</>
  if (status === 'error') {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background px-6 text-center text-foreground">
        <p className="text-lg font-medium">{t('Could not load your profile.')}</p>
        <p className="text-sm text-muted-foreground">{t('Check your connection and try again.')}</p>
        <Button onClick={() => userId && load(userId)}>{t('Try again')}</Button>
      </main>
    )
  }
  return (
    <main aria-busy className="flex min-h-dvh flex-col gap-4 bg-background px-6 pt-[calc(4rem+env(safe-area-inset-top))]">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-28 w-full rounded-2xl" />
      <Skeleton className="h-28 w-full rounded-2xl" />
    </main>
  )
}
```

Run — Expected: PASS.

- [ ] **Step 3: `ProfileFields.tsx`**

```tsx
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import { t } from '../../lib/i18n.js'
import { ALL_EQUIPMENT } from '../../lib/equipment.js'
import { GOALS, LEVELS, SEXES, type ProfileInput } from './types'

export type FieldProps = {
  value: Partial<ProfileInput>
  onChange(patch: Partial<ProfileInput>): void
  errors: Record<string, string>
}

const GOAL_LABEL: Record<string, string> = { hypertrophy: 'Muscle gain', strength: 'Strength', fat_loss: 'Fat loss', conditioning: 'Conditioning' }
const LEVEL_LABEL: Record<string, string> = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' }
const SEX_LABEL: Record<string, string> = { male: 'Male', female: 'Female', other: 'Other' }

const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')))

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id} className="text-sm text-muted-foreground">{label}</Label>
      {children}
      {error && <p id={id + '-error'} className="text-sm text-destructive">{t(error)}</p>}
    </div>
  )
}

const inputCls = 'h-12 rounded-xl bg-card text-base'

export function NameField({ value, onChange, errors }: FieldProps) {
  return (
    <Field id="display_name" label={t('Name')} error={errors.display_name}>
      <Input id="display_name" className={inputCls} autoComplete="name" value={value.display_name ?? ''}
        aria-invalid={!!errors.display_name} onChange={e => onChange({ display_name: e.target.value })} />
    </Field>
  )
}

export function BodyFields({ value, onChange, errors }: FieldProps) {
  return (
    <div className="flex flex-col gap-5">
      <Field id="birth_date" label={t('Birth date')} error={errors.birth_date}>
        <Input id="birth_date" type="date" className={inputCls} value={value.birth_date ?? ''}
          onChange={e => onChange({ birth_date: e.target.value || null })} />
      </Field>
      <Field id="sex" label={t('Sex')}>
        <ToggleGroup id="sex" type="single" variant="outline" className="w-full" value={value.sex ?? ''}
          onValueChange={v => onChange({ sex: (v || null) as ProfileInput['sex'] })}>
          {SEXES.map(s => <ToggleGroupItem key={s} value={s} className="h-11 flex-1">{t(SEX_LABEL[s])}</ToggleGroupItem>)}
        </ToggleGroup>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field id="height_cm" label={t('Height (cm)')} error={errors.height_cm}>
          <Input id="height_cm" inputMode="decimal" className={cn(inputCls, 'font-mono tabular-nums')} value={value.height_cm ?? ''}
            onChange={e => onChange({ height_cm: num(e.target.value) })} />
        </Field>
        <Field id="weight_kg" label={t('Weight (kg)')} error={errors.weight_kg}>
          <Input id="weight_kg" inputMode="decimal" className={cn(inputCls, 'font-mono tabular-nums')} value={value.weight_kg ?? ''}
            onChange={e => onChange({ weight_kg: num(e.target.value) })} />
        </Field>
      </div>
      <Field id="unit" label={t('Units')}>
        <ToggleGroup id="unit" type="single" variant="outline" className="w-full" value={value.unit ?? 'kg'}
          onValueChange={v => v && onChange({ unit: v as ProfileInput['unit'] })}>
          <ToggleGroupItem value="kg" className="h-11 flex-1">kg</ToggleGroupItem>
          <ToggleGroupItem value="lb" className="h-11 flex-1">lb</ToggleGroupItem>
        </ToggleGroup>
      </Field>
    </div>
  )
}

export function GoalFields({ value, onChange, errors }: FieldProps) {
  return (
    <div className="flex flex-col gap-6">
      <Field id="goal" label={t('Main goal')}>
        <ToggleGroup id="goal" type="single" variant="outline" className="grid w-full grid-cols-2 gap-2" value={value.goal ?? ''}
          onValueChange={v => v && onChange({ goal: v as ProfileInput['goal'] })}>
          {GOALS.map(g => <ToggleGroupItem key={g} value={g} className="h-14 rounded-xl">{t(GOAL_LABEL[g])}</ToggleGroupItem>)}
        </ToggleGroup>
      </Field>
      <Field id="level" label={t('Experience')}>
        <ToggleGroup id="level" type="single" variant="outline" className="w-full" value={value.level ?? ''}
          onValueChange={v => v && onChange({ level: v as ProfileInput['level'] })}>
          {LEVELS.map(l => <ToggleGroupItem key={l} value={l} className="h-11 flex-1">{t(LEVEL_LABEL[l])}</ToggleGroupItem>)}
        </ToggleGroup>
      </Field>
      <Field id="days_per_week" label={t('Training days per week')} error={errors.days_per_week}>
        <ToggleGroup id="days_per_week" type="single" variant="outline" className="w-full" value={String(value.days_per_week ?? 3)}
          onValueChange={v => v && onChange({ days_per_week: Number(v) })}>
          {[1, 2, 3, 4, 5, 6, 7].map(d => <ToggleGroupItem key={d} value={String(d)} className="h-11 flex-1 font-mono">{d}</ToggleGroupItem>)}
        </ToggleGroup>
      </Field>
    </div>
  )
}

export function EquipmentField({ value, onChange }: FieldProps) {
  const chosen = new Set(value.equipment ?? [])
  const toggle = (eq: string) => {
    const next = new Set(chosen)
    if (next.has(eq)) next.delete(eq); else next.add(eq)
    onChange({ equipment: [...next] })
  }
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-sm text-muted-foreground">{t('Equipment you have access to')}</legend>
      <div className="flex flex-wrap gap-2">
        {(ALL_EQUIPMENT as string[]).filter(e => e !== 'body weight').map(eq => (
          <button key={eq} type="button" data-slot="chip" aria-pressed={chosen.has(eq)} onClick={() => toggle(eq)}
            className={cn('min-h-11 rounded-full border px-4 text-sm capitalize transition-colors duration-150',
              chosen.has(eq) ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-foreground')}>
            {t(eq)}
          </button>
        ))}
      </div>
    </fieldset>
  )
}
```

(`t(eq)`: os nomes de equipamento já têm tradução no pack herdado, pois o Settings do openGym os exibe com `t()`.)

- [ ] **Step 4: Teste que falha — `Onboarding.test.tsx`**

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({
  create: vi.fn(async (input: any) => ({ id: 'u1', equipment: [], unit: 'kg', locale: 'pt-BR', weight_kg: null, ...input })),
  update: vi.fn((fn: (s: any) => void) => fn({})),
  loadStarterPlan: vi.fn(),
  emit: vi.fn(),
  finishOnboarding: vi.fn(),
  suggestion: null as string | null
}))
vi.mock('./useProfile', () => ({
  useProfile: (sel?: any) => {
    const s = { create: h.create, suggestion: h.suggestion, setSuggestion: (id: string) => { h.suggestion = id }, finishOnboarding: h.finishOnboarding }
    return sel ? sel(s) : s
  }
}))
vi.mock('../../store/useStore.js', () => ({
  useStore: Object.assign((sel: any) => sel({ user: { id: 'u1', name: 'Ana Souza' }, update: h.update, S: {} }), { getState: () => ({ update: h.update, S: {} }) })
}))
vi.mock('../../sheets.jsx', () => ({ loadStarterPlan: h.loadStarterPlan }))
vi.mock('../gamification/events', () => ({ emit: h.emit }))
vi.mock('../../lib/equipment.js', () => ({ ALL_EQUIPMENT: ['barbell', 'dumbbell', 'body weight'] }))

import Onboarding from './Onboarding'

const next = () => fireEvent.click(screen.getByRole('button', { name: /continue/i }))

beforeEach(() => {
  ;[h.create, h.update, h.loadStarterPlan, h.emit, h.finishOnboarding].forEach(f => f.mockClear())
  h.suggestion = null
})

describe('Onboarding', () => {
  it('pre-fills the name from the Google account', () => {
    render(<Onboarding />)
    expect((screen.getByLabelText(/name/i) as HTMLInputElement).value).toBe('Ana Souza')
  })

  it('blocks the first step on an invalid height', () => {
    render(<Onboarding />)
    fireEvent.change(screen.getByLabelText(/height/i), { target: { value: '20' } })
    next()
    expect(screen.getByText(/between 50 and 260/i)).toBeTruthy()
  })

  it('walks the three steps, saves and stores the plan suggestion', async () => {
    render(<Onboarding />)
    fireEvent.change(screen.getByLabelText(/weight/i), { target: { value: '70' } })
    next()
    fireEvent.click(screen.getByRole('radio', { name: /strength/i }))
    fireEvent.click(screen.getByRole('radio', { name: /beginner/i }))
    fireEvent.click(screen.getByRole('radio', { name: '3' }))
    next()
    fireEvent.click(screen.getByRole('button', { name: /barbell/i }))
    fireEvent.click(screen.getByRole('button', { name: /finish/i }))
    await waitFor(() => expect(h.create).toHaveBeenCalled())
    expect(h.create.mock.calls[0][0]).toMatchObject({ display_name: 'Ana Souza', weight_kg: 70, goal: 'strength', level: 'beginner', days_per_week: 3, equipment: ['barbell'] })
    expect(h.update).toHaveBeenCalled()
    expect(h.emit).toHaveBeenCalledWith('weight_logged', expect.any(Object), expect.any(String), expect.any(String))
    await waitFor(() => expect(h.suggestion).toBe('5x5'))
  })

  it('shows the suggestion and loads the plan', () => {
    h.suggestion = '5x5'
    render(<Onboarding />)
    expect(screen.getByText('5×5')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /use this plan/i }))
    expect(h.loadStarterPlan).toHaveBeenCalledWith('5x5')
    expect(h.finishOnboarding).toHaveBeenCalled()
  })

  it('can skip the suggestion', () => {
    h.suggestion = 'ppl'
    render(<Onboarding />)
    fireEvent.click(screen.getByRole('button', { name: /skip/i }))
    expect(h.loadStarterPlan).not.toHaveBeenCalled()
    expect(h.finishOnboarding).toHaveBeenCalled()
  })
})
```

Nota: `ToggleGroupItem` do shadcn (Radix) expõe `role="radio"` em `type="single"`. Se a versão gerada expuser `role="button"` com `aria-pressed`, trocar `getByRole('radio', …)` por `getByRole('button', …)` nos três cliques.

Run — Expected: FAIL.

- [ ] **Step 5: `Onboarding.tsx`**

O evento de peso usa `emit` da Task 10. Para manter as tasks independentes, criar já agora o stub `src/features/gamification/events.ts` com a assinatura final (a Task 10 o substitui pela implementação completa):

```ts
export type EventKind = 'workout_completed' | 'pr' | 'weight_logged'
export function emit(_kind: EventKind, _payload: Record<string, unknown>, _sourceRef: string, _occurredOn: string): void {}
```

`src/features/profile/Onboarding.tsx`:

```tsx
import { useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useStore } from '../../store/useStore.js'
import { t } from '../../lib/i18n.js'
import { todayISO } from '../../lib/format.js'
import { loadStarterPlan } from '../../sheets.jsx'
import { emit } from '../gamification/events'
import { useProfile } from './useProfile'
import { validateProfileInput } from './profile-api'
import { applyProfileToState } from './profile-apply'
import { suggestStarterPlan, type StarterPlanId } from './starter-suggest'
import { NameField, BodyFields, GoalFields, EquipmentField } from './ProfileFields'
import type { ProfileInput } from './types'

const PLAN_NAME: Record<StarterPlanId, string> = { 'full-body': 'Full Body', 'upper-lower': 'Upper/Lower', ppl: 'Push/Pull/Legs', '5x5': '5×5' }
const STEP_FIELDS: (keyof ProfileInput)[][] = [
  ['display_name', 'birth_date', 'height_cm', 'weight_kg'],
  ['days_per_week'],
  []
]

export default function Onboarding() {
  const reduce = useReducedMotion()
  const user = useStore((s: { user: { id: string; name: string } }) => s.user)
  const create = useProfile(s => s.create)
  const suggestion = useProfile(s => s.suggestion)
  const setSuggestion = useProfile(s => s.setSuggestion)
  const finishOnboarding = useProfile(s => s.finishOnboarding)
  const [step, setStep] = useState(0)
  const [value, setValue] = useState<Partial<ProfileInput>>({
    display_name: user?.name ?? '', unit: 'kg', locale: 'pt-BR', days_per_week: 3, equipment: [],
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo'
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Leaving the suggestion screen ends the onboarding; ProfileGate then shows the app on Home.
  const leave = (plan: StarterPlanId | null) => {
    if (plan) loadStarterPlan(plan)
    window.location.hash = '#/home'
    finishOnboarding()
  }

  const onChange = (patch: Partial<ProfileInput>) => setValue(v => ({ ...v, ...patch }))

  const stepErrors = (i: number) => {
    const all = validateProfileInput(value)
    return Object.fromEntries(Object.entries(all).filter(([k]) => STEP_FIELDS[i].includes(k as keyof ProfileInput)))
  }

  const advance = () => {
    const e = stepErrors(step)
    setErrors(e)
    if (Object.keys(e).length === 0) setStep(s => s + 1)
  }

  const finish = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      const profile = await create({ ...value, display_name: (value.display_name ?? '').trim() })
      const today = todayISO()
      useStore.getState().update((s: Record<string, unknown>) => {
        Object.assign(s, applyProfileToState(s, profile, { today, withWeight: !!profile.weight_kg }))
      })
      if (profile.weight_kg) emit('weight_logged', { w: profile.weight_kg }, today, today)
      setSuggestion(suggestStarterPlan({ days: profile.days_per_week, level: profile.level, goal: profile.goal }))
    } catch (e) {
      setSaveError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (suggestion) {
    return (
      <main className="flex min-h-dvh flex-col justify-between bg-background px-6 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-[calc(4rem+env(safe-area-inset-top))] text-foreground">
        <section>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">{t('Your starting point')}</p>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight">{PLAN_NAME[suggestion]}</h1>
          <p className="mt-3 text-muted-foreground">{t('Based on your goal, experience and available days. You can change it any time in Plan.')}</p>
        </section>
        <div className="flex flex-col gap-3">
          <Button size="lg" className="h-12 rounded-xl text-base" onClick={() => leave(suggestion)}>{t('Use this plan')}</Button>
          <Button size="lg" variant="ghost" className="h-12 rounded-xl text-base" onClick={() => leave(null)}>{t('Skip for now')}</Button>
        </div>
      </main>
    )
  }

  const steps = [
    { title: t('About you'), body: <div className="flex flex-col gap-5"><NameField value={value} onChange={onChange} errors={errors} /><BodyFields value={value} onChange={onChange} errors={errors} /></div> },
    { title: t('Your goal'), body: <GoalFields value={value} onChange={onChange} errors={errors} /> },
    { title: t('Your equipment'), body: <EquipmentField value={value} onChange={onChange} errors={errors} /> }
  ]
  const last = step === steps.length - 1

  return (
    <main className="flex min-h-dvh flex-col bg-background px-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-[calc(1.5rem+env(safe-area-inset-top))] text-foreground">
      <header className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="size-11" aria-label={t('Back')} disabled={step === 0} onClick={() => setStep(s => s - 1)}>
          <ArrowLeft />
        </Button>
        <Progress value={((step + 1) / steps.length) * 100} className="h-1.5 flex-1" aria-label={t('Step {0} of {1}', step + 1, steps.length)} />
        <span className="w-11 text-right font-mono text-sm text-muted-foreground">{step + 1}/{steps.length}</span>
      </header>
      <AnimatePresence mode="wait" initial={false}>
        <motion.section key={step} className="mt-8 flex-1"
          initial={reduce ? { opacity: 0 } : { opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={reduce ? { opacity: 0 } : { opacity: 0, x: -24 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}>
          <h1 className="mb-6 text-2xl font-semibold tracking-tight">{steps[step].title}</h1>
          {steps[step].body}
        </motion.section>
      </AnimatePresence>
      {saveError && <p role="alert" className="mb-3 rounded-lg bg-destructive/15 p-3 text-sm text-destructive">{t('Could not save your profile. Try again.')}</p>}
      <Button size="lg" className="h-12 w-full rounded-xl text-base" disabled={saving} onClick={last ? finish : advance}>
        {last ? (saving ? t('Saving…') : t('Finish')) : t('Continue')}
      </Button>
    </main>
  )
}
```

Run: `npx vitest run src/features/profile` — Expected: PASS.

- [ ] **Step 6: Ligar no App**

Em `src/App.jsx`:

```jsx
import ProfileGate from './features/profile/ProfileGate.tsx'
```

Envolver o bloco `<Routes>…</Routes>` (o ramo `authed`) em `<ProfileGate>…</ProfileGate>`. Esconder `TabBar` enquanto o perfil não está pronto: trocar `<TabBar onStart={startFlow} />` por `{profileReady && <TabBar onStart={startFlow} />}` com `const profileReady = useProfile(s => s.status === 'ready' && !s.onboarding)` (import de `./features/profile/useProfile.ts`).

Quando o usuário sai, o perfil em memória precisa sumir: em `src/App.jsx`, dentro de `Shell`:

```jsx
  useEffect(() => { if (!user) useProfile.getState().reset() }, [user?.id])
```

- [ ] **Step 7: Traduções**

```js
  'Name': 'Nome',
  'Birth date': 'Data de nascimento',
  'Sex': 'Sexo',
  'Male': 'Masculino',
  'Female': 'Feminino',
  'Other': 'Outro',
  'Height (cm)': 'Altura (cm)',
  'Weight (kg)': 'Peso (kg)',
  'Units': 'Unidades',
  'Main goal': 'Objetivo principal',
  'Muscle gain': 'Hipertrofia',
  'Strength': 'Força',
  'Fat loss': 'Emagrecimento',
  'Conditioning': 'Condicionamento',
  'Experience': 'Experiência',
  'Beginner': 'Iniciante',
  'Intermediate': 'Intermediário',
  'Advanced': 'Avançado',
  'Training days per week': 'Dias de treino por semana',
  'Equipment you have access to': 'Equipamentos que você tem',
  'About you': 'Sobre você',
  'Your goal': 'Seu objetivo',
  'Your equipment': 'Seus equipamentos',
  'Step {0} of {1}': 'Passo {0} de {1}',
  'Continue': 'Continuar',
  'Finish': 'Concluir',
  'Saving…': 'Salvando…',
  'Could not save your profile. Try again.': 'Não foi possível salvar seu perfil. Tente de novo.',
  'Your starting point': 'Seu ponto de partida',
  'Based on your goal, experience and available days. You can change it any time in Plan.': 'Com base no seu objetivo, experiência e dias disponíveis. Você pode trocar quando quiser em Plano.',
  'Use this plan': 'Usar este plano',
  'Skip for now': 'Pular por enquanto',
  'Could not load your profile.': 'Não foi possível carregar seu perfil.',
  'Check your connection and try again.': 'Verifique sua conexão e tente de novo.',
  'Try again': 'Tentar de novo',
```

Antes de acrescentar, checar com `grep -n "'Back'\|'Strength'\|'Other'\|'Name'\|'Continue'\|'Finish'\|'Try again'" src/locales/pt-BR.js src/locales/pt.js` — chaves que já existem no pack herdado **não** são duplicadas (o teste de locale acusa duplicata).

- [ ] **Step 8: Verificar e commitar**

```bash
node scripts/check-locales.mjs
npm run typecheck && npm test && npm run build
git add -A
git commit -m "feat(profile): three-step onboarding with starter plan suggestion

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Tela de Perfil e pontos de entrada

**Files:**
- Create: `src/features/profile/ProfileScreen.tsx`, `src/features/profile/ProfileScreen.test.tsx`
- Modify: `src/App.jsx` (rota `/perfil`), `src/views/Home.jsx` (avatar), `src/views/Settings.jsx` (link Perfil + código-fonte), `src/locales/pt-BR.js`

**Interfaces:**
- Consumes: `useProfile` (`profile`, `save`), `validateProfileInput`, `applyProfileToState`, campos de `ProfileFields.tsx`; `useStore().setUnit(to, { convert })`, `useStore().signOut({ force })`, `useStore().update`.
- Produces: rota `/perfil`; componente default `ProfileScreen`; constante `SOURCE_URL = 'https://github.com/Guilhermcm/performance-app'` exportada de `ProfileScreen.tsx`.

- [ ] **Step 1: Teste que falha — `ProfileScreen.test.tsx`**

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const P = { id: 'u1', display_name: 'Ana', avatar_url: null, birth_date: null, sex: null, height_cm: 165, weight_kg: 62, goal: 'strength', level: 'beginner', days_per_week: 3, equipment: [], unit: 'kg', locale: 'pt-BR', timezone: 'America/Sao_Paulo', share_activity: false, created_at: '', updated_at: '' }
const h = vi.hoisted(() => ({
  save: vi.fn(async (p: any) => ({ ...P, ...p })),
  signOut: vi.fn(async () => ({ owed: false })),
  setUnit: vi.fn(),
  update: vi.fn()
}))
vi.mock('./useProfile', () => ({ useProfile: (sel?: any) => { const s = { profile: P, save: h.save }; return sel ? sel(s) : s } }))
vi.mock('../../store/useStore.js', () => ({
  useStore: Object.assign((sel: any) => sel({ signOut: h.signOut, setUnit: h.setUnit, update: h.update }), { getState: () => ({ signOut: h.signOut, setUnit: h.setUnit, update: h.update, S: {} }) })
}))
vi.mock('../../lib/equipment.js', () => ({ ALL_EQUIPMENT: ['barbell'] }))

import ProfileScreen from './ProfileScreen'

beforeEach(() => Object.values(h).forEach(f => f.mockClear()))

describe('ProfileScreen', () => {
  it('shows the profile', () => {
    render(<ProfileScreen />)
    expect(screen.getByRole('heading', { name: 'Ana' })).toBeTruthy()
  })

  it('saves an edited section', async () => {
    render(<ProfileScreen />)
    fireEvent.click(screen.getAllByRole('button', { name: /edit/i })[0])
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Bia' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(h.save).toHaveBeenCalledWith(expect.objectContaining({ display_name: 'Bia' })))
  })

  it('toggles sharing with friends', async () => {
    render(<ProfileScreen />)
    fireEvent.click(screen.getByRole('switch', { name: /share/i }))
    await waitFor(() => expect(h.save).toHaveBeenCalledWith({ share_activity: true }))
  })

  it('signs out', async () => {
    render(<ProfileScreen />)
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }))
    await waitFor(() => expect(h.signOut).toHaveBeenCalled())
  })

  it('links the source code (AGPL)', () => {
    render(<ProfileScreen />)
    expect(screen.getByRole('link', { name: /source code/i }).getAttribute('href')).toBe('https://github.com/Guilhermcm/performance-app')
  })
})
```

Run — Expected: FAIL.

- [ ] **Step 2: `ProfileScreen.tsx`**

```tsx
import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, LogOut, Pencil } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { useStore } from '../../store/useStore.js'
import { t } from '../../lib/i18n.js'
import { todayISO } from '../../lib/format.js'
import { useProfile } from './useProfile'
import { validateProfileInput } from './profile-api'
import { applyProfileToState } from './profile-apply'
import { NameField, BodyFields, GoalFields, EquipmentField, type FieldProps } from './ProfileFields'
import type { ProfileInput } from './types'

export const SOURCE_URL = 'https://github.com/Guilhermcm/performance-app'

type SectionKey = 'body' | 'goal' | 'equipment'
const SECTIONS: { key: SectionKey; title: string; fields: (keyof ProfileInput)[]; render: (p: FieldProps) => ReactNode }[] = [
  { key: 'body', title: 'About you', fields: ['display_name', 'birth_date', 'sex', 'height_cm', 'weight_kg', 'unit'],
    render: p => <div className="flex flex-col gap-5"><NameField {...p} /><BodyFields {...p} /></div> },
  { key: 'goal', title: 'Your goal', fields: ['goal', 'level', 'days_per_week'], render: p => <GoalFields {...p} /> },
  { key: 'equipment', title: 'Your equipment', fields: ['equipment'], render: p => <EquipmentField {...p} /> }
]

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('')

export default function ProfileScreen() {
  const navigate = useNavigate()
  const profile = useProfile(s => s.profile)
  const save = useProfile(s => s.save)
  const signOut = useStore((s: { signOut: (o?: { force?: boolean }) => Promise<{ owed: boolean }> }) => s.signOut)
  const [editing, setEditing] = useState<SectionKey | null>(null)
  const [draft, setDraft] = useState<Partial<ProfileInput>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  if (!profile) return null

  const startEdit = (key: SectionKey) => {
    const fields = SECTIONS.find(s => s.key === key)!.fields
    setDraft(Object.fromEntries(fields.map(f => [f, profile[f]])) as Partial<ProfileInput>)
    setErrors({})
    setEditing(key)
  }

  const commit = async () => {
    const e = validateProfileInput(draft)
    setErrors(e)
    if (Object.keys(e).length) return
    setBusy(true)
    try {
      const unitChanged = draft.unit && draft.unit !== profile.unit
      const saved = await save(draft)
      const store = useStore.getState()
      if (unitChanged) store.setUnit(saved.unit, { convert: true })
      store.update((s: Record<string, unknown>) => { Object.assign(s, applyProfileToState(s, saved, { today: todayISO(), withWeight: false })) })
      setEditing(null)
      toast(t('Profile saved'))
    } catch {
      toast(t('Could not save. Your previous values were kept.'))
    } finally {
      setBusy(false)
    }
  }

  const toggleShare = async (on: boolean) => {
    try { await save({ share_activity: on }) } catch { toast(t('Could not save. Your previous values were kept.')) }
  }

  const leave = async () => {
    const r = await signOut()
    if (r.owed) toast(t('Some changes have not synced yet. Connect to the internet and try again.'))
  }

  return (
    <main className="min-h-dvh bg-background px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-[calc(1rem+env(safe-area-inset-top))] text-foreground">
      <header className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="size-11" aria-label={t('Back')} onClick={() => navigate(-1)}><ArrowLeft /></Button>
      </header>

      <section className="mt-2 flex flex-col items-center gap-3 text-center">
        <Avatar className="size-24 ring-2 ring-primary/40 ring-offset-4 ring-offset-background">
          {profile.avatar_url && <AvatarImage src={profile.avatar_url} alt="" />}
          <AvatarFallback className="text-2xl">{initials(profile.display_name)}</AvatarFallback>
        </Avatar>
        <h1 className="text-2xl font-semibold tracking-tight">{profile.display_name}</h1>
      </section>

      <div className="mt-8 flex flex-col gap-4">
        {SECTIONS.map(section => (
          <Card key={section.key} className="rounded-2xl border-border bg-card p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-medium">{t(section.title)}</h2>
              {editing !== section.key && (
                <Button variant="ghost" size="sm" className="h-11 gap-2" onClick={() => startEdit(section.key)} aria-label={t('Edit') + ' ' + t(section.title)}>
                  <Pencil className="size-4" />{t('Edit')}
                </Button>
              )}
            </div>
            {editing === section.key ? (
              <div className="flex flex-col gap-5">
                {section.render({ value: draft, onChange: p => setDraft(d => ({ ...d, ...p })), errors })}
                <div className="flex gap-2">
                  <Button className="h-11 flex-1 rounded-xl" disabled={busy} onClick={commit}>{busy ? t('Saving…') : t('Save')}</Button>
                  <Button variant="ghost" className="h-11 rounded-xl" onClick={() => setEditing(null)}>{t('Cancel')}</Button>
                </div>
              </div>
            ) : (
              <Summary section={section.key} profile={profile} />
            )}
          </Card>
        ))}

        <Card className="flex flex-row items-center justify-between gap-4 rounded-2xl border-border bg-card p-5">
          <Label htmlFor="share_activity" className="flex flex-col items-start gap-1 text-left">
            <span className="text-base font-medium">{t('Share workouts and PRs with friends')}</span>
            <span className="text-sm text-muted-foreground">{t('Weight, diet and loads stay private.')}</span>
          </Label>
          <Switch id="share_activity" checked={profile.share_activity} onCheckedChange={toggleShare} />
        </Card>

        <Button variant="outline" className="h-12 gap-2 rounded-xl" onClick={leave}><LogOut className="size-4" />{t('Sign out')}</Button>
        <a className="py-2 text-center text-sm text-muted-foreground underline-offset-4 hover:underline" href={SOURCE_URL} target="_blank" rel="noreferrer">
          {t('Source code (AGPL-3.0)')}
        </a>
      </div>
    </main>
  )
}

const GOAL: Record<string, string> = { hypertrophy: 'Muscle gain', strength: 'Strength', fat_loss: 'Fat loss', conditioning: 'Conditioning' }
const LEVEL: Record<string, string> = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' }

function Summary({ section, profile }: { section: SectionKey; profile: NonNullable<ReturnType<typeof useProfile.getState>['profile']> }) {
  const row = (label: string, value: ReactNode) => (
    <div className="flex justify-between gap-4 py-1.5 text-sm"><dt className="text-muted-foreground">{label}</dt><dd className="font-mono tabular-nums">{value ?? '—'}</dd></div>
  )
  if (section === 'body') return (
    <dl>{row(t('Height (cm)'), profile.height_cm)}{row(t('Weight (kg)'), profile.weight_kg)}{row(t('Units'), profile.unit)}</dl>
  )
  if (section === 'goal') return (
    <dl>{row(t('Main goal'), profile.goal && t(GOAL[profile.goal]))}{row(t('Experience'), profile.level && t(LEVEL[profile.level]))}{row(t('Training days per week'), profile.days_per_week)}</dl>
  )
  return <p className="text-sm text-muted-foreground">{profile.equipment.length ? profile.equipment.map(e => t(e)).join(', ') : t('Nothing selected — every exercise is shown.')}</p>
}
```

Montar o `<Toaster />` do sonner uma vez: em `src/App.jsx`, junto de `<Toast />`, acrescentar `<Toaster position="top-center" />` com `import { Toaster } from './components/ui/sonner.tsx'`.

Run — Expected: PASS.

- [ ] **Step 3: Rota e entradas**

`src/App.jsx`: `import ProfileScreen from './features/profile/ProfileScreen.tsx'` e, dentro de `<Routes>`, `<Route path="/perfil" element={<ProfileScreen />} />` antes do `*`.

`src/views/Home.jsx`: no cabeçalho da Home (localizar o primeiro `<h1` ou o container do título com `grep -n "<h1\|className=\"top\|header" src/views/Home.jsx`), acrescentar à direita um botão-avatar:

```jsx
import { useProfile } from '../features/profile/useProfile.ts'
import { Avatar, AvatarFallback, AvatarImage } from '../components/ui/avatar.tsx'
// …
const profile = useProfile(s => s.profile)
// …
<button type="button" data-slot="avatar-button" aria-label={t('Profile')} onClick={() => navigate('/perfil')}
  className="ml-auto flex size-11 items-center justify-center rounded-full">
  <Avatar className="size-9">
    {profile?.avatar_url && <AvatarImage src={profile.avatar_url} alt="" />}
    <AvatarFallback>{(profile?.display_name || '?').slice(0, 1).toUpperCase()}</AvatarFallback>
  </Avatar>
</button>
```

(Se `navigate` não existir em `Home.jsx`, importar `useNavigate` de `react-router-dom` e criar `const navigate = useNavigate()`.)

`src/views/Settings.jsx`: no topo da lista de seções, uma `<Row>` herdada que navega para `/perfil` com rótulo `t('Profile')` (usar o mesmo componente `Row` já importado de `../components/ui.jsx`, com `onClick={() => navigate('/perfil')}`); no fim da página, `<a href="https://github.com/Guilhermcm/performance-app" target="_blank" rel="noreferrer">{t('Source code (AGPL-3.0)')}</a>` dentro da seção "Sobre" existente (localizar com `grep -n "About\|REPO" src/views/Settings.jsx`; se o link para `REPO` do openGym existir, mantê-lo com o rótulo `t('Based on openGym')` e acrescentar o novo).

- [ ] **Step 4: Traduções**

```js
  'Profile': 'Perfil',
  'Edit': 'Editar',
  'Save': 'Salvar',
  'Cancel': 'Cancelar',
  'Profile saved': 'Perfil salvo',
  'Could not save. Your previous values were kept.': 'Não foi possível salvar. Os valores anteriores foram mantidos.',
  'Share workouts and PRs with friends': 'Compartilhar treinos e PRs com amigos',
  'Weight, diet and loads stay private.': 'Peso, dieta e cargas continuam privados.',
  'Sign out': 'Sair',
  'Some changes have not synced yet. Connect to the internet and try again.': 'Algumas alterações ainda não sincronizaram. Conecte-se à internet e tente de novo.',
  'Source code (AGPL-3.0)': 'Código-fonte (AGPL-3.0)',
  'Based on openGym': 'Baseado no openGym',
  'Nothing selected — every exercise is shown.': 'Nada selecionado — todos os exercícios aparecem.',
```

(Mesma checagem de duplicatas da Task 8: `Save`, `Cancel`, `Edit`, `Sign out` provavelmente já existem.)

- [ ] **Step 5: Verificar e commitar**

```bash
node scripts/check-locales.mjs
npm run typecheck && npm test && npm run build
git add -A
git commit -m "feat(profile): profile screen with section editing, sharing toggle and sign-out

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Fila de eventos e ganchos no treino e no peso

**Files:**
- Modify: `src/features/gamification/events.ts` (substitui o stub da Task 8)
- Create: `src/features/gamification/events.test.ts`
- Modify: `src/sheets.jsx` (`finishWorkout` em ~2628–2688; `BwSheet.save` em ~231–245), `src/main.jsx`

**Interfaces:**
- Consumes: `supabase` (Task 5); tabela `activity_events` (Task 4).
- Produces:
  - `emit(kind: EventKind, payload: Record<string, unknown>, sourceRef: string, occurredOn: string): void` — enfileira e dispara `flush()` sem bloquear.
  - `flush(): Promise<{ sent: number; left: number }>` — envia a fila em lote; erro de duplicata (`23505`) conta como enviado; erros de validação (`22023`: `unknown_kind`, `out_of_window`, `payload_too_large`) descartam o item; erro de rede/401 mantém o item.
  - `startEventSync(): () => void` — `flush` em `online`, `visibilitychange` visível e a cada 60 s; retorna função de parada.
  - `clearEventQueue(): void`.
  - Chave de fila: `localStorage['perf_event_queue_v1']`.

- [ ] **Step 1: Testes que falham — `events.test.ts`**

```ts
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ results: [] as { error: null | { code: string; message: string } }[], inserts: [] as unknown[], session: { user: { id: 'u1' } } as unknown }))
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: h.session } }) },
    from: () => ({ insert: async (row: unknown) => { h.inserts.push(row); return h.results.shift() ?? { error: null } } })
  }
}))

import { emit, flush, clearEventQueue } from './events'

const queue = () => JSON.parse(localStorage.getItem('perf_event_queue_v1') || '[]')

beforeEach(() => {
  localStorage.clear()
  h.results = []
  h.inserts = []
  h.session = { user: { id: 'u1' } }
})

describe('event queue', () => {
  it('queues with the pillar derived from the kind', () => {
    h.session = null
    emit('workout_completed', { n: 1 }, 'w1', '2026-10-05')
    expect(queue()).toEqual([{ pillar: 'strength', kind: 'workout_completed', payload: { n: 1 }, source_ref: 'w1', occurred_on: '2026-10-05' }])
  })

  it('does not queue the same event twice', () => {
    h.session = null
    emit('pr', {}, 'w1:0025', '2026-10-05')
    emit('pr', {}, 'w1:0025', '2026-10-05')
    expect(queue()).toHaveLength(1)
  })

  it('sends everything and empties the queue', async () => {
    h.session = null
    emit('pr', {}, 'a', '2026-10-05')
    emit('weight_logged', {}, 'b', '2026-10-05')
    h.session = { user: { id: 'u1' } }
    await expect(flush()).resolves.toEqual({ sent: 2, left: 0 })
    expect(queue()).toEqual([])
  })

  it('treats a duplicate as delivered', async () => {
    h.session = null
    emit('pr', {}, 'a', '2026-10-05')
    h.session = { user: { id: 'u1' } }
    h.results = [{ error: { code: '23505', message: 'duplicate key' } }]
    await expect(flush()).resolves.toEqual({ sent: 1, left: 0 })
  })

  it('drops an event the server refuses as invalid', async () => {
    h.session = null
    emit('pr', {}, 'a', '2020-01-01')
    h.session = { user: { id: 'u1' } }
    h.results = [{ error: { code: '22023', message: 'out_of_window' } }]
    await expect(flush()).resolves.toEqual({ sent: 0, left: 0 })
  })

  it('keeps the event on a network failure', async () => {
    h.session = null
    emit('pr', {}, 'a', '2026-10-05')
    h.session = { user: { id: 'u1' } }
    h.results = [{ error: { code: '', message: 'Failed to fetch' } }]
    await expect(flush()).resolves.toEqual({ sent: 0, left: 1 })
    expect(queue()).toHaveLength(1)
  })

  it('keeps everything while signed out', async () => {
    h.session = null
    emit('pr', {}, 'a', '2026-10-05')
    await expect(flush()).resolves.toEqual({ sent: 0, left: 1 })
    expect(h.inserts).toEqual([])
  })

  it('clears the queue', () => {
    h.session = null
    emit('pr', {}, 'a', '2026-10-05')
    clearEventQueue()
    expect(queue()).toEqual([])
  })
})
```

Run: `npx vitest run src/features/gamification/events.test.ts` — Expected: FAIL.

- [ ] **Step 2: `events.ts`**

```ts
import { supabase } from '@/lib/supabase'
import type { Pillar } from '@/lib/database.types'

export type EventKind = 'workout_completed' | 'pr' | 'weight_logged'

const KEY = 'perf_event_queue_v1'
const PILLAR: Record<EventKind, Pillar> = { workout_completed: 'strength', pr: 'strength', weight_logged: 'strength' }
const INVALID = '22023'
const DUPLICATE = '23505'

type QueuedEvent = { pillar: Pillar; kind: EventKind; payload: Record<string, unknown>; source_ref: string; occurred_on: string }

const read = (): QueuedEvent[] => {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] }
}
const write = (q: QueuedEvent[]) => {
  try { localStorage.setItem(KEY, JSON.stringify(q)) } catch { /* storage full: the event is lost, XP too */ }
}
const same = (a: QueuedEvent, b: QueuedEvent) => a.kind === b.kind && a.source_ref === b.source_ref

let flushing: Promise<{ sent: number; left: number }> | null = null

// Events are written locally first and sent when possible: a workout finished in a basement gym
// still earns its XP once the phone is back online. The server is idempotent on
// (user, kind, source_ref), so a resend after a lost answer is harmless.
export function emit(kind: EventKind, payload: Record<string, unknown>, sourceRef: string, occurredOn: string): void {
  const ev: QueuedEvent = { pillar: PILLAR[kind], kind, payload, source_ref: sourceRef, occurred_on: occurredOn }
  const q = read()
  if (!q.some(x => same(x, ev))) write([...q, ev])
  void flush()
}

export function flush(): Promise<{ sent: number; left: number }> {
  if (flushing) return flushing
  flushing = (async () => {
    const { data } = await supabase.auth.getSession()
    if (!data.session) return { sent: 0, left: read().length }
    let sent = 0
    for (const ev of read()) {
      const { error } = await supabase.from('activity_events').insert(ev as never)
      const delivered = !error || error.code === DUPLICATE
      const refused = !!error && error.code === INVALID
      // Anything else (no network, expired session) stops here and keeps the rest queued.
      if (!delivered && !refused) break
      if (delivered) sent++
      write(read().filter(x => !same(x, ev)))
    }
    return { sent, left: read().length }
  })().finally(() => { flushing = null })
  return flushing
}

export function clearEventQueue(): void {
  try { localStorage.removeItem(KEY) } catch { /* ignore */ }
}

export function startEventSync(): () => void {
  const run = () => { void flush() }
  const onVisible = () => { if (document.visibilityState === 'visible') run() }
  window.addEventListener('online', run)
  document.addEventListener('visibilitychange', onVisible)
  const timer = window.setInterval(run, 60_000)
  run()
  return () => {
    window.removeEventListener('online', run)
    document.removeEventListener('visibilitychange', onVisible)
    window.clearInterval(timer)
  }
}
```

Run: `npx vitest run src/features/gamification/events.test.ts` — Expected: PASS.

- [ ] **Step 3: Gancho no fim do treino (`src/sheets.jsx`, `finishWorkout`)**

Importar no topo: `import { emit } from './features/gamification/events.ts'`. Logo depois do bloco `update(s => { … s.active = null })` e antes de `useStore.getState().autoBackupNow()`, acrescentar:

```js
  // Gamification reads these (features/gamification/events.ts). A workout logged into the past
  // carries its own date; the server refuses dates older than 14 days, and the queue drops those.
  if (shown.id != null) {
    const day = String(shown.d || '').slice(0, 10)
    emit('workout_completed', { sets: shown.entries.reduce((n, e) => n + (e.sets?.length || 0), 0), vol: shown.vol || 0, past }, String(shown.id), day)
    ;[...new Set(prs)].forEach(exId => emit('pr', { ex: exId }, `${shown.id}:${exId}`, day))
  }
```

Antes de escrever, confirmar os campos: `grep -n "d:" src/lib/finish-workout.js | head` deve mostrar que o treino concluído tem `id` e `d` (data ISO `YYYY-MM-DD` ou timestamp ISO). Se `d` não for uma string ISO, usar `todayISO()` (já importado em `sheets.jsx`; se não, importar de `./lib/format.js`) para treinos não-`past`, e `backfillEnd(A)` convertido com `new Date(...).toISOString().slice(0, 10)` para `past`.

- [ ] **Step 4: Gancho no peso (`BwSheet.save`)**

Depois do `update(s => { … })` dentro de `save`:

```js
    const iso = todayISO()
    emit('weight_logged', { w: n }, iso, iso)
```

(Reaproveitar o `iso` já calculado se o código estiver organizado para isso; o `source_ref` é a data, então pesar duas vezes no mesmo dia gera um único evento, como a regra de XP pede.)

- [ ] **Step 5: Ligar a sincronização e a limpeza**

Em `src/main.jsx`:

```js
import { startEventSync, clearEventQueue } from './features/gamification/events.ts'

startEventSync()
supabase.auth.onAuthStateChange(event => { if (event === 'SIGNED_OUT') clearEventQueue() })
```

- [ ] **Step 6: Teste de integração leve para o gancho do treino**

Os testes herdados de `finishWorkout` (`grep -ln "finishWorkout" src/*.test.jsx`) passam a importar `events.ts`; acrescentar no topo de cada um deles `vi.mock('./features/gamification/events.ts', () => ({ emit: vi.fn() }))` se algum falhar por acesso a `supabase`. Em um deles (o mais simples, ex. `src/sheets.test.jsx`), acrescentar um caso:

```js
import { emit } from './features/gamification/events.ts'
// …
it('emits workout_completed once per finished workout', async () => {
  // usar o mesmo arranjo do teste existente que conclui um treino nesse arquivo
  // e, depois de finishWorkout():
  expect(emit).toHaveBeenCalledWith('workout_completed', expect.any(Object), expect.any(String), expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/))
})
```

Para escrever o arranjo, copiar o `it(...)` existente do arquivo que chama `finishWorkout()` e apenas acrescentar a asserção acima no fim dele (em vez de um `it` novo, se for mais simples).

Run: `npm test` — Expected: PASS.

- [ ] **Step 7: Commit**

```bash
npm run typecheck && npm run build
git add -A
git commit -m "feat(gamification): offline event queue fed by finished workouts, PRs and weigh-ins

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Marca, PWA, deploy e CI

**Files:**
- Modify: `public/manifest.json`, `public/sw.js`, `index.html`
- Create: `vercel.json`, `.env.example`, `.github/workflows/ci.yml`, `README.md`, `docs/SETUP.md`
- Modify: `.gitignore`

**Interfaces:**
- Produces: build de produção servível como SPA na Vercel; CI que roda `npm ci`, `npm run typecheck`, `npm test`, `npm run build`.

- [ ] **Step 1: Manifest e service worker**

`public/manifest.json`:

```json
{
  "name": "Performance",
  "short_name": "Performance",
  "description": "Treino, progresso e consistência",
  "lang": "pt-BR",
  "start_url": "./",
  "scope": "./",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#16181d",
  "theme_color": "#16181d",
  "icons": [
    { "src": "icon-180.png", "sizes": "180x180", "type": "image/png", "purpose": "any" },
    { "src": "icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
```

Em `public/sw.js`, trocar o prefixo do nome do cache (localizar com `grep -n "opengym\|openGym" public/sw.js`) para `performance-`. Os ícones herdados ficam até a direção visual ganhar ícone próprio (registrado como pendência no README).

Em `index.html`, `meta theme-color` → `#16181d`; remover o comentário e o atributo `crossorigin="use-credentials"` do `<link rel="manifest">` (não há proxy de auth).

- [ ] **Step 2: Teste do service worker**

Rodar `npx vitest run src/lib/sw-subpath.test.js`. Se ele procurar o nome de cache antigo, atualizar a string esperada para o prefixo novo. Expected: PASS.

- [ ] **Step 3: `vercel.json`**

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "vite",
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }],
  "headers": [
    { "source": "/sw.js", "headers": [{ "key": "Cache-Control", "value": "no-cache" }] },
    { "source": "/assets/(.*)", "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }] }
  ]
}
```

- [ ] **Step 4: `.env.example` e `.gitignore`**

```bash
# Supabase → Project Settings → API
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key

# Exercise images and GIFs (© Gym visual, see NOTICE.md), pinned to a dataset commit
VITE_IMG_BASE=https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@7455efae41b330c265e7cd4b78dfa848e7ce5ebd/images/
VITE_GIF_BASE=https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@7455efae41b330c265e7cd4b78dfa848e7ce5ebd/videos/
```

Garantir em `.gitignore`: `node_modules/`, `dist/`, `.env`, `.env.local`, `.vercel/`, `coverage/`.

- [ ] **Step 5: CI `.github/workflows/ci.yml`**

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
```

- [ ] **Step 6: README e guia de setup**

`README.md`:

```markdown
# Performance

App pessoal de performance: treino, progresso e consistência com amigos. PWA em React, dados no
Supabase, hospedado na Vercel.

- Roadmap: [docs/ROADMAP.md](docs/ROADMAP.md)
- Configuração (Supabase, Google, Vercel): [docs/SETUP.md](docs/SETUP.md)

## Desenvolvimento

```bash
cp .env.example .env.local   # preencha com as chaves do Supabase
npm install
npm run dev
npm test
```

## Origem e licença

Derivado do [openGym](https://github.com/DuarteSantos8/openGym) (commit `<HASH-DA-TASK-1>`), de
Duarte Santos, sob AGPL-3.0-or-later. Este projeto mantém a mesma licença: veja [LICENSE](LICENSE).
Imagens e animações de exercícios são © Gym visual, usadas sob os termos do dataset; veja
[NOTICE.md](NOTICE.md).
```

Substituir `<HASH-DA-TASK-1>` pelo hash anotado na Task 1, Step 1.

`docs/SETUP.md`:

```markdown
# Configuração

## 1. Supabase

1. Crie um projeto em https://supabase.com/dashboard (região: South America — São Paulo).
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

Projetos gratuitos pausam após 7 dias sem requisições. Para reativar: Dashboard → projeto →
Restore. O uso diário do app evita a pausa.
```

- [ ] **Step 7: Verificar e commitar**

```bash
npm run typecheck && npm test && npm run build
npx vite preview --port 4173
```

Abrir `http://localhost:4173/#/home` — a tela Entrar aparece (sem `.env.local`, com o aviso "O servidor ainda não está configurado."). Expected: verde.

```bash
git add -A
git commit -m "chore: branding, PWA manifest, Vercel config, CI and setup guide

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Criar o repositório no GitHub e publicar

**Files:** nenhum (operação de repositório)

- [ ] **Step 1: Confirmar com o usuário** que o repositório público `Guilhermcm/performance-app` pode ser criado agora (ação externa e pública).

- [ ] **Step 2: Criar e enviar**

```bash
gh repo create Guilhermcm/performance-app --public --source . --remote origin --description "Personal performance app: training, progress and consistency with friends" --push
gh repo view Guilhermcm/performance-app --web
```

- [ ] **Step 3: Conferir o CI**

```bash
gh run list --repo Guilhermcm/performance-app --limit 1
```

Expected: o workflow `CI` aparece; quando concluir, `completed success`. Em falha, `gh run view --log-failed` e corrigir antes de seguir.

---

### Task 13: Configuração com o usuário e smoke test

**Files:**
- Modify: `src/lib/database.types.ts` (regenerado)

- [ ] **Step 1: Guiar o usuário pelo `docs/SETUP.md` §1–§4**, um passo por vez, esperando confirmação de cada um. Nunca pedir que o usuário cole o Client Secret do Google ou a `service_role` no chat; só a `Project URL` e a `anon key` (públicas por natureza) podem ser usadas, e apenas em `.env.local` local.

- [ ] **Step 2: Regenerar os tipos do banco**

```bash
npx supabase login
npx supabase gen types typescript --project-id <PROJECT_ID> --schema public > src/lib/database.types.ts
npm run typecheck
```

Se o tipo gerado mudar nomes usados no código (`Pillar` não é exportado pelo gerador), acrescentar ao fim do arquivo gerado:

```ts
export type Pillar = Database['public']['Enums']['pillar']
```

Commit: `chore: regenerate database types from Supabase`.

- [ ] **Step 3: Smoke test local** (`.env.local` preenchido, `npm run dev`)

1. Entrar com Google → volta para o app sem `?code=` na barra.
2. Onboarding: preencher, concluir, aceitar a sugestão → Home com o plano carregado.
3. Fazer um treino curto e concluir.
4. Supabase → Table Editor: `profiles` com 1 linha; `app_state` com `rev ≥ 1`; `activity_events` com `weight_logged` e `workout_completed`.
5. Abrir em outra janela anônima, entrar com a mesma conta → mesmo histórico, sem onboarding.
6. Perfil → Sair → volta para Entrar.

- [ ] **Step 4: Smoke test em produção** — repetir 1–6 no domínio da Vercel, no celular, e instalar como app (Adicionar à tela inicial).

- [ ] **Step 5: Conferência de RLS** — rodar `docs/SETUP.md` §5 com duas contas.

- [ ] **Step 6: Commit final e marcação**

```bash
git tag -a v0.1.0 -m "Phase 0 — foundation"
git push origin main --tags
```

Atualizar `docs/ROADMAP.md`, tabela de fases: Fase 0 → `concluída`. Commit `docs: mark phase 0 as done`.
