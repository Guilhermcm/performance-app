# performance-app

App pessoal de performance (treino, progresso, consistência com amigos). React 19 + Vite + Zustand,
Supabase (Auth Google, Postgres com RLS), deploy na Vercel. Base derivada do openGym (AGPL-3.0).

- Spec: `docs/superpowers/specs/2026-10-04-performance-app-foundation-design.md`
- Roadmap: `docs/ROADMAP.md`
- Planos: `docs/superpowers/plans/`

## Comandos

```bash
npm run dev          # servidor de desenvolvimento
npm test             # vitest (app + testes SQL com PGlite em supabase/tests)
npm run typecheck    # tsc --noEmit
npm run build
node scripts/check-locales.mjs
node scripts/check-source-strings.mjs --strict
```

## Regras de texto público

Vale para todo texto que uma pessoa usuária lê: strings de interface (`t('...')` e os packs em
`src/locales/`), README, docs públicas, manifest, mensagens de erro exibidas.

1. **Sem travessão nem hífen usados como pausa** (`—`, `–`, ` - `) em frases. Parece texto de IA.
   Reescreva a frase; use vírgula, ponto ou dois-pontos quando precisar de pausa. Hífen dentro de
   palavra (`e-mail`, `pt-BR`, `Push/Pull/Legs`) continua normal.
2. **Passe o texto novo pelo humanizer** antes de commitar: skill `anthropic-skills:humanizer`
   (português) ou `humanizer` (inglês). O objetivo é soar natural e direto, sem mudar o sentido.
3. Toda string nova entra em todos os 16 packs de `src/locales/` (pt-BR como `PT_BR_OVERRIDES`),
   e os dois scripts de locale acima precisam passar.
4. Para corrigir o texto em inglês de uma chave antiga sem renomeá-la, use `EN_OVERRIDES` em
   `src/lib/en-overrides.js`. O teste `src/lib/public-copy.test.js` barra travessão como pausa no
   texto efetivo de en e pt-BR.

## Código

- Código novo em TypeScript em `src/features/`, `src/components/ui/`, `src/lib/*.ts`; legado em JS.
- Lógica de treino herdada (`src/lib/`) só muda com teste ao lado.
- Commits: `type: summary` em inglês, terminando com
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
