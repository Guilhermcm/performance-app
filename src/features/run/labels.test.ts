// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { setLang } from '../../lib/i18n.js'
import { blocksInline, fitWarningText, goalName, itemText, phaseName, sessionName, zoneFeel, zoneName } from './labels'

afterEach(async () => { await setLang('en') })

describe('labels in pt-BR', () => {
  it('names the zones and how they feel', async () => {
    await setLang('pt-BR')
    expect(['easy', 'moderate', 'hard', 'walk'].map(z => zoneName(z as never))).toEqual(['Leve', 'Moderado', 'Forte', 'Caminhada'])
    expect(zoneFeel('easy')).toBe('dá para conversar')
    expect(zoneFeel('moderate')).toBe('só frases curtas')
    expect(zoneFeel('hard')).toBe('só poucas palavras')
    expect(zoneFeel('walk')).toBe('caminhar firme, recuperando')
  })

  it('names the sessions and the goals', async () => {
    await setLang('pt-BR')
    expect(['runwalk', 'easy', 'long', 'tempo', 'intervals'].map(s => sessionName(s as never)))
      .toEqual(['Corre e caminha', 'Leve', 'Longão', 'Ritmo', 'Intervalado'])
    expect(['start', '5k', '10k', 'half', 'maintain'].map(g => goalName(g as never)))
      .toEqual(['Começar a correr', '5 km', '10 km', 'Meia maratona', 'Manter a forma'])
  })

  it('writes an item as text', async () => {
    await setLang('pt-BR')
    expect(itemText({ repeat: 4, blocks: [{ zone: 'hard', min: 4 }, { zone: 'easy', min: 2 }] })).toBe('4 × 4 min forte, 2 min leve')
    expect(itemText({ zone: 'easy', min: 10 })).toBe('10 min leve')
    expect(itemText({ repeat: 8, blocks: [{ zone: 'easy', min: 1 }, { zone: 'walk', min: 2 }] })).toBe('8 × 1 min leve, 2 min caminhando')
    expect(itemText({ zone: 'moderate', min: 20 })).toBe('20 min moderado')
  })
})

describe('labels in English', () => {
  it('reads without dashes as pauses', () => {
    expect(zoneName('hard')).toBe('Hard')
    expect(sessionName('long')).toBe('Long run')
    expect(goalName('half')).toBe('Half marathon')
    expect(itemText({ repeat: 4, blocks: [{ zone: 'hard', min: 4 }, { zone: 'easy', min: 2 }] })).toBe('4 × 4 min hard, 2 min easy')
    for (const z of ['easy', 'moderate', 'hard', 'walk'] as const) expect(zoneFeel(z)).not.toMatch(/[—–]| - /)
  })
})

describe('session lines and fit warnings (Task 6)', () => {
  it('writes the blocks in one line, joined by +', async () => {
    const tempo = [{ zone: 'easy', min: 10 }, { repeat: 4, blocks: [{ zone: 'hard', min: 4 }] }, { zone: 'easy', min: 10 }] as const
    expect(blocksInline(tempo as never)).toBe('10 easy + 4 × 4 hard + 10 easy')
    await setLang('pt-BR')
    expect(blocksInline(tempo as never)).toBe('10 leve + 4 × 4 forte + 10 leve')
    // A repeat of several blocks keeps them together in parentheses.
    expect(blocksInline([{ repeat: 8, blocks: [{ zone: 'easy', min: 1 }, { zone: 'walk', min: 2 }] }])).toBe('8 × (1 leve, 2 caminhando)')
    expect(blocksInline([{ zone: 'moderate', min: 20 }])).toBe('20 moderado')
  })

  it('names the phases', async () => {
    await setLang('pt-BR')
    expect(['base', 'build', 'specific', 'taper'].map(p => phaseName(p as never))).toEqual(['Base', 'Construção', 'Específica', 'Polimento'])
  })

  it('says which fit rule a session breaks, in words', async () => {
    expect(fitWarningText('after_leg_day', 'intervals')).toBe('Interval run the day after leg day')
    await setLang('pt-BR')
    expect(fitWarningText('after_leg_day', 'intervals')).toBe('Intervalado no dia depois de perna')
    expect(fitWarningText('hard_in_a_row', 'tempo')).toBe('Dois dias fortes seguidos')
    expect(fitWarningText('shared_with_strength_hard', 'long')).toBe('Longão em dia de musculação')
  })
})
