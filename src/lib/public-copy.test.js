// @vitest-environment happy-dom
// Public-copy rule from CLAUDE.md: no em dash, en dash or spaced hyphen used as a pause in any
// sentence a user reads. This checks the effective text of both languages the app offers, for
// every source key: English (the key itself, or its display override) and pt-BR (override or
// inherited pt-PT value), plus the pt-BR instructions and exercise names.
import { afterEach, describe, expect, it } from 'vitest'
import pt from '../locales/pt.js'
import ptBR from '../locales/pt-BR.js'
import ptBRInstr from '../instr/pt-BR.js'
import ptBRNames from '../exercise-names/pt-BR.js'
import { EN_OVERRIDES } from './en-overrides.js'
import { _setLangState, t } from './i18n-core.js'
import { setLang } from './i18n.js'

// "—" and "–" anywhere, or a hyphen with a space on at least one side between words. Hyphens
// inside words (e-mail, pt-BR, plate-loaded) and the minus sign "−" do not match.
const DASH_PAUSE = /[—–]|\s-\s|\s-$|^-\s/
const placeholders = s => [...String(s).matchAll(/\{\d+\}/g)].map(m => m[0]).sort()
const offenders = entries => entries.filter(([, v]) => DASH_PAUSE.test(v)).map(([k, v]) => `${k} => ${v}`)

describe('English display overrides', () => {
  afterEach(() => _setLangState('en', {}, null, null))

  it('only overrides existing source strings, keeping their placeholders', () => {
    const stray = Object.keys(EN_OVERRIDES).filter(k => !(k in pt))
    expect(stray, 'override keys that are not source strings').toEqual([])
    for (const [key, value] of Object.entries(EN_OVERRIDES)) {
      expect(value.trim(), key).not.toBe('')
      expect(value, key).not.toBe(key)
      expect(placeholders(value), key).toEqual(placeholders(key))
    }
  })

  it('is what t() returns in English, with arguments substituted', async () => {
    await setLang('en')
    expect(t('Session ended — sign in again.')).toBe('Session ended. Sign in again.')
    expect(t('Too many attempts — try again {0}.', 'in 5 minutes')).toBe('Too many attempts. Try again in 5 minutes.')
    // A key without an override still renders as itself.
    expect(t('Save')).toBe('Save')
  })

  it('does not leak into other languages', async () => {
    await setLang('pt-BR')
    expect(t('Session ended — sign in again.')).toBe(ptBR['Session ended — sign in again.'])
    await setLang('en')
  })
})

describe('no dash used as a pause in public copy', () => {
  it('English, for every source string', () => {
    const effective = Object.keys(pt).map(k => [k, EN_OVERRIDES[k] ?? k])
    expect(offenders(effective)).toEqual([])
  })

  it('Brazilian Portuguese, for every source string', () => {
    expect(offenders(Object.entries(ptBR))).toEqual([])
  })

  it('Brazilian Portuguese exercise instructions and names', () => {
    const steps = Object.entries(ptBRInstr).flatMap(([id, list]) => list.map((s, i) => [`${id}#${i}`, s]))
    expect(offenders(steps)).toEqual([])
    expect(offenders(Object.entries(ptBRNames))).toEqual([])
  })
})
