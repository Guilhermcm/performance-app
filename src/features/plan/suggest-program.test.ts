import { describe, expect, it } from 'vitest'
import { suggestProgram } from './suggest-program'
import { RANGES, profileOf } from './goal'
import { REFS } from './references'
import type { Goal, Level } from '@/features/profile/types'

type Row = [goal: Goal | null, days: number, level: Level | null, id: string, variant: number]

// Spec §4.3, line by line, for every level. A null level reads as beginner.
const ROWS: Row[] = [
  // Saúde geral, 2 dias: Treino curto
  ['fat_loss', 2, 'beginner', 'short-2x', 0],
  ['fat_loss', 2, 'intermediate', 'short-2x', 0],
  ['conditioning', 2, 'advanced', 'short-2x', 0],
  // Saúde geral, 3 ou mais: Saúde geral / Corpo inteiro iniciante
  ['fat_loss', 3, 'beginner', 'health-3x', 0],
  ['conditioning', 5, null, 'health-3x', 0],
  ['fat_loss', 3, 'intermediate', 'full-body-beginner', 0],
  ['conditioning', 6, 'advanced', 'full-body-beginner', 0],
  // Hipertrofia, 2 ou 3: Corpo inteiro iniciante / PPL 3x
  ['hypertrophy', 2, 'beginner', 'full-body-beginner', 0],
  ['hypertrophy', 3, 'beginner', 'full-body-beginner', 0],
  ['hypertrophy', 2, 'intermediate', 'ppl', 0],
  ['hypertrophy', 3, 'advanced', 'ppl', 0],
  // Hipertrofia, 4 ou 5: Superior / Inferior
  ['hypertrophy', 4, 'beginner', 'upper-lower', 0],
  ['hypertrophy', 5, 'beginner', 'upper-lower', 0],
  ['hypertrophy', 4, 'intermediate', 'upper-lower', 0],
  ['hypertrophy', 5, 'advanced', 'upper-lower', 0],
  // Hipertrofia, 6 ou mais: Superior / Inferior / PPL 6x
  ['hypertrophy', 6, 'beginner', 'upper-lower', 0],
  ['hypertrophy', 7, 'beginner', 'upper-lower', 0],
  ['hypertrophy', 6, 'intermediate', 'ppl', 1],
  ['hypertrophy', 7, 'advanced', 'ppl', 1],
  // Força, 3 ou menos: Força 5×5
  ['strength', 2, 'beginner', 'strength-5x5', 0],
  ['strength', 3, 'beginner', 'strength-5x5', 0],
  ['strength', 3, 'intermediate', 'strength-5x5', 0],
  ['strength', 2, 'advanced', 'strength-5x5', 0],
  // Força, 4 ou mais: Força 5×5 / Força e hipertrofia
  ['strength', 4, 'beginner', 'strength-5x5', 0],
  ['strength', 6, null, 'strength-5x5', 0],
  ['strength', 4, 'intermediate', 'power-hypertrophy', 0],
  ['strength', 5, 'advanced', 'power-hypertrophy', 0],
  // Objetivo vazio: hipertrofia
  [null, 3, 'beginner', 'full-body-beginner', 0],
  [null, 4, 'intermediate', 'upper-lower', 0],
  [null, 6, 'advanced', 'ppl', 1],
  [null, 3, 'advanced', 'ppl', 0],
]

describe('suggestProgram', () => {
  it.each(ROWS)('%s, %i days, %s → %s (variant %i)', (goal, days, level, id, variant) => {
    expect(suggestProgram({ goal, level, days })).toEqual({ id, variant })
  })
})

describe('profileOf and RANGES', () => {
  it('maps profiles.goal to the analysis profile', () => {
    expect(profileOf('hypertrophy')).toBe('hypertrophy')
    expect(profileOf(null)).toBe('hypertrophy')
    expect(profileOf('strength')).toBe('strength')
    expect(profileOf('fat_loss')).toBe('health')
    expect(profileOf('conditioning')).toBe('health')
  })

  it('keeps the weekly ranges of the plan, each with sources that exist', () => {
    expect(RANGES).toEqual({
      hypertrophy: { min: 10, max: 20, refs: ['schoenfeld2017', 'pelland2025'] },
      strength: { min: 6, max: 12, refs: ['ralston2017', 'pelland2025'] },
      health: { min: 4, max: 10, refs: ['who2020', 'acsm2009'] },
    })
    for (const r of Object.values(RANGES)) for (const id of r.refs) expect(REFS).toHaveProperty(id)
  })
})
