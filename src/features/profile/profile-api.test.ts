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
    expect(h.calls).toContainEqual(['from', 'profiles'])
    expect(h.calls).toContainEqual(['eq', 'id', 'u1'])
  })

  it('returns the row when present', async () => {
    h.result = { data: { id: 'u1', display_name: 'Ana' }, error: null }
    await expect(fetchProfile('u1')).resolves.toEqual({ id: 'u1', display_name: 'Ana' })
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
    expect(h.calls).toContainEqual(['eq', 'id', 'u1'])
  })

  it('throws Supabase errors', async () => {
    h.result = { data: null, error: { message: 'nope' } }
    await expect(updateProfile('u1', { days_per_week: 4 })).rejects.toThrow('nope')
    await expect(fetchProfile('u1')).rejects.toThrow('nope')
    await expect(createProfile('u1', { display_name: 'Ana' })).rejects.toThrow('nope')
  })
})

describe('validateProfileInput', () => {
  it('accepts a complete, in-range profile', () => {
    expect(validateProfileInput({ display_name: 'Ana', height_cm: 165, weight_kg: 62, days_per_week: 3, birth_date: '1990-05-01' })).toEqual({})
  })

  it('accepts the range edges', () => {
    expect(validateProfileInput({ display_name: 'x'.repeat(60), height_cm: 50, weight_kg: 400, days_per_week: 1 })).toEqual({})
    expect(validateProfileInput({ height_cm: 260, weight_kg: 20, days_per_week: 7 })).toEqual({})
  })

  it.each([
    [{ display_name: '  ' }, 'display_name'],
    [{ display_name: 'x'.repeat(61) }, 'display_name'],
    [{ height_cm: 40 }, 'height_cm'],
    [{ weight_kg: 401 }, 'weight_kg'],
    [{ days_per_week: 8 }, 'days_per_week'],
    [{ birth_date: '2030-01-01' }, 'birth_date'],
    [{ birth_date: 'not-a-date' }, 'birth_date']
  ])('flags %j on %s', (input, field) => {
    expect(Object.keys(validateProfileInput(input))).toContain(field)
  })

  it('refuses a number that did not parse', () => {
    expect(Object.keys(validateProfileInput({ height_cm: NaN, weight_kg: NaN }))).toEqual(['height_cm', 'weight_kg'])
  })
})
