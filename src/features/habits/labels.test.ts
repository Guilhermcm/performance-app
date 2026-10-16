// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest'
import { setLang } from '../../lib/i18n.js'
import { iconLabel, perWeekLabel, weekCountLabel } from './labels'
import { HABIT_ICONS } from './icons'

describe('perWeekLabel', () => {
  it('says every day for 7 and counts the others', () => {
    expect(perWeekLabel(7)).toBe('Every day')
    expect(perWeekLabel(3)).toBe('3 times a week')
    expect(perWeekLabel(1)).toBe('Once a week')
  })
})

describe('weekCountLabel', () => {
  it('reads the checks against the target', () => {
    expect(weekCountLabel(2, 3)).toBe('2 of 3 this week')
  })
})

describe('iconLabel', () => {
  it('names every icon, each one differently, and falls back to the default', () => {
    const names = HABIT_ICONS.map(iconLabel)
    expect(names.every(n => n.length > 0)).toBe(true)
    expect(new Set(names).size).toBe(HABIT_ICONS.length)
    expect(iconLabel('rocket')).toBe(iconLabel('check'))
  })
})

describe('in pt-BR', () => {
  afterEach(async () => { await setLang('en') })

  it('reads as the spec says', async () => {
    await setLang('pt-BR')
    expect(perWeekLabel(7)).toBe('Todo dia')
    expect(perWeekLabel(3)).toBe('3 por semana')
    expect(perWeekLabel(1)).toBe('1 por semana')
    expect(weekCountLabel(2, 3)).toBe('2 de 3 na semana')
  })
})
