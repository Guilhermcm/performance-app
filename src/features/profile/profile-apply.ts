import { MONDAY } from '@/lib/format.js'
import type { Profile } from './types'

// The equipment profile the app's library filter uses (lib/equipment.js: { id, name, equipment })
// — one, owned by the performance profile, found again by this fixed id on later applies.
// lib/equipment.js newProfile ids start with 'eq' + base36, so they never collide with it.
const EQUIP_ID = 'eq-profile'
const KG_TO_LB = 2.2046226218

type AppState = Record<string, any>

// Pure: returns a new state with what the profile decides — language, Monday week start, unit
// label (a fresh account has no numbers to convert; a later unit change goes through Settings'
// switchUnit, which offers to convert), the equipment filter, and optionally today's weigh-in.
//
// `langAuto: false` marks the language as chosen (as picking one in Settings does): a fresh copy
// carries `langAuto: true`, and while it does, lib/default-lang.js effectiveLang ignores `lang`
// and follows the instance default / browser instead.
export function applyProfileToState(S: AppState, profile: Profile, opts: { today: string; withWeight: boolean }): AppState {
  const next: AppState = { ...S, lang: profile.locale, langAuto: false, weekStart: MONDAY, unit: profile.unit }

  const others = (S.equipProfiles || []).filter((p: { id: string }) => p.id !== EQUIP_ID)
  const mine = { id: EQUIP_ID, name: 'Perfil', equipment: [...profile.equipment] }
  next.equipProfiles = [...others, mine]
  next.activeEquipId = EQUIP_ID
  next.equipFilterOn = profile.equipment.length > 0

  // Weigh-ins are stored in the display unit (sheets.jsx BwSheet: { d, w, t }), one per day.
  if (opts.withWeight && profile.weight_kg) {
    const w = profile.unit === 'lb' ? Math.round(profile.weight_kg * KG_TO_LB * 10) / 10 : Number(profile.weight_kg)
    const rest = (S.bodyweight || []).filter((b: { d: string }) => b.d !== opts.today)
    next.bodyweight = [...rest, { d: opts.today, w, t: Date.now() }].sort((a, b) => (a.d < b.d ? -1 : 1))
  }
  return next
}
