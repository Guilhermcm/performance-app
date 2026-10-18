// The plan keeps the VDOT buildPlan settles on: a race reference too slow for a usable VDOT makes
// buildPlan return null, and the plan is then by feel only.
import { describe, expect, it, vi } from 'vitest'
import { applyRunPlan } from './run-actions'

vi.mock('./models', async importOriginal => {
  const real = await importOriginal<typeof import('./models')>()
  return { ...real, buildPlan: (...args: Parameters<typeof real.buildPlan>) => ({ ...real.buildPlan(...args), vdot: null }) }
})

describe('applyRunPlan and the VDOT from buildPlan', () => {
  it('stores no VDOT when buildPlan has none for a race reference', () => {
    const S = { week: {}, routines: [], weekStart: 1, runPlan: null }
    const plan = applyRunPlan(S, { goal: '5k', goalType: 'finish', weeks: 8, reference: { kind: 'race', distanceM: 5000, minutes: 70, date: '2026-10-01' }, days: 3, longDay: 0 }, '2026-10-19')
    expect(plan.vdot).toBeUndefined()
    expect(plan.vdotDate).toBeUndefined()
    expect(plan.vdotSource).toBeNull()
  })
})
