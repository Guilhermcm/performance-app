import { describe, it, expect } from 'vitest'
import { Check, Dumbbell } from 'lucide-react'
import { HABIT_ICONS, iconFor } from './icons'

describe('habit icons', () => {
  it('has 24 unique keys in the allowed shape', () => {
    expect(HABIT_ICONS).toHaveLength(24)
    expect(new Set(HABIT_ICONS).size).toBe(24)
    for (const k of HABIT_ICONS) expect(k).toMatch(/^[a-z][a-z0-9-]{0,31}$/)
  })
  it('starts with check, the default', () => {
    expect(HABIT_ICONS[0]).toBe('check')
  })
  it('maps every key to an icon', () => {
    for (const k of HABIT_ICONS) expect(iconFor(k)).toBeTruthy()
    expect(iconFor('dumbbell')).toBe(Dumbbell)
  })
  it('falls back to check for an unknown key', () => {
    expect(iconFor('nao-existe')).toBe(Check)
  })
})
