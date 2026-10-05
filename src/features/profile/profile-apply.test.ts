import { describe, it, expect } from 'vitest'
import { applyProfileToState } from './profile-apply'
import { MONDAY } from '@/lib/format.js'
import { effectiveLang } from '@/lib/default-lang.js'
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
    expect(S).toMatchObject({ lang: 'pt-BR', weekStart: MONDAY, unit: 'kg' })
    expect(base.lang).toBe('en')
  })

  it('marks the language as chosen so a fresh copy stops following the browser', () => {
    const fresh = { ...base, lang: 'en', langAuto: true }
    const S = applyProfileToState(fresh, profile, { today: '2026-10-05', withWeight: false })
    expect(S.langAuto).toBe(false)
    expect(effectiveLang(S, { default_lang: 'en' }, ['en-US'])).toBe('pt-BR')
    expect(fresh.langAuto).toBe(true)
  })

  it('creates and activates an equipment profile from the chosen equipment', () => {
    const S = applyProfileToState(base, profile, { today: '2026-10-05', withWeight: false })
    expect(S.equipProfiles).toHaveLength(1)
    expect(S.equipProfiles[0]).toMatchObject({ name: 'Perfil', equipment: ['barbell', 'dumbbell'] })
    expect(S.activeEquipId).toBe(S.equipProfiles[0].id)
    expect(S.equipFilterOn).toBe(true)
  })

  it('updates the same equipment profile on a later apply and keeps the user’s others', () => {
    const own = { id: 'eqabc123', name: 'Home', equipment: ['dumbbell'] }
    const once = applyProfileToState({ ...base, equipProfiles: [own] }, profile, { today: '2026-10-05', withWeight: false })
    const twice = applyProfileToState(once, { ...profile, equipment: ['cable'] }, { today: '2026-10-05', withWeight: false })
    expect(twice.equipProfiles).toHaveLength(2)
    expect(twice.equipProfiles[0]).toEqual(own)
    expect(twice.equipProfiles[1].equipment).toEqual(['cable'])
  })

  it('leaves the filter off when no equipment was chosen', () => {
    const S = applyProfileToState(base, { ...profile, equipment: [] }, { today: '2026-10-05', withWeight: false })
    expect(S.equipFilterOn).toBe(false)
  })

  it('logs today’s weight when asked, in the profile unit', () => {
    const S = applyProfileToState(base, profile, { today: '2026-10-05', withWeight: true })
    expect(S.bodyweight).toEqual([{ d: '2026-10-05', w: 62.5, t: expect.any(Number) }])
  })

  it('does not touch the weigh-ins when not asked', () => {
    const S0 = { ...base, bodyweight: [{ d: '2026-10-01', w: 70, t: 1 }] }
    const S = applyProfileToState(S0, profile, { today: '2026-10-05', withWeight: false })
    expect(S.bodyweight).toEqual(S0.bodyweight)
  })

  it('converts the weight to lb for an lb profile', () => {
    const S = applyProfileToState({ ...base, unit: 'lb' }, { ...profile, unit: 'lb' }, { today: '2026-10-05', withWeight: true })
    expect(S.bodyweight[0].w).toBe(137.8)
  })

  it('replaces an existing entry for the same day and keeps the list sorted', () => {
    const S0 = { ...base, bodyweight: [{ d: '2026-10-07', w: 71, t: 2 }, { d: '2026-10-05', w: 70, t: 1 }] }
    const S = applyProfileToState(S0, profile, { today: '2026-10-05', withWeight: true })
    expect(S.bodyweight.map((b: { d: string }) => b.d)).toEqual(['2026-10-05', '2026-10-07'])
    expect(S.bodyweight[0].w).toBe(62.5)
  })
})
