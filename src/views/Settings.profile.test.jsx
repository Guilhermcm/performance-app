// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useProfile } from '../features/profile/useProfile.ts'
import Settings from './Settings.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// Settings opens with the Profile row for a signed-in account, and a unit switch keeps the
// profile's unit in step. (The footer's source link: Settings.reset.test.jsx.)
const mocks = vi.hoisted(() => {
  const state = { S: null, user: null }
  state.nav = vi.fn()
  state.menuSheet = vi.fn()
  state.setUnit = vi.fn()
  state.snapshot = () => ({
    S: state.S, user: state.user, update: vi.fn(), setUnit: state.setUnit, importConflict: vi.fn(),
    importBackup: vi.fn(), resetEverything: vi.fn(), config: null,
  })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector ? selector(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  return { useStore, DEF: { reminder: { time: '17:30' }, workouts: [] }, hasData: () => false }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: vi.fn(), openSheet: vi.fn() })
  const useUI = selector => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.nav }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(), IS_ANDROID: false }))
vi.mock('../lib/wakelock.js', () => ({ wakeLockSupported: () => false }))
vi.mock('../lib/mobile.js', () => ({ MOBILE: false, shareExport: vi.fn(), shareExportBlob: vi.fn() }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), confirmSheet: vi.fn(), importFromApp: vi.fn(), importFromHevy: vi.fn(),
  equipmentProfileSheet: vi.fn(), plateInventorySheet: vi.fn(), menuSheet: (...a) => mocks.menuSheet(...a),
}))

globalThis.__APP_VERSION__ ??= 'test'

const save = vi.fn(async p => p)
let host, root
beforeEach(() => {
  mocks.S = { unit: 'kg', restSec: 90, restPauseSec: 15, sound: false, effort: 'none', gifSize: 'full', workouts: [], routines: [], exWeights: {} }
  mocks.user = { id: 'u1', name: 'Ana' }
  mocks.nav.mockClear(); mocks.menuSheet.mockClear(); mocks.setUnit.mockClear(); save.mockClear()
  useProfile.setState({ profile: { id: 'u1', display_name: 'Ana', unit: 'kg' }, save })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  useProfile.setState({ profile: null })
})

const mount = () => act(() => root.render(<Settings />))
const rows = () => [...host.querySelectorAll('.lrow')]

describe('Settings — profile', () => {
  it('opens with the Profile row, which goes to /perfil', () => {
    mount()
    const row = rows()[0]
    expect(row.textContent).toContain('Profile')
    expect(row.textContent).toContain('Ana')
    act(() => { row.click() })
    expect(mocks.nav).toHaveBeenCalledWith('/perfil')
  })

  it('has no Profile row without a profile', () => {
    useProfile.setState({ profile: null })
    mount()
    expect(rows().some(r => r.textContent.startsWith('Profile'))).toBe(false)
  })

  it('a unit switch also updates the profile', () => {
    mount()
    const unitRow = [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'lb')
    act(() => { unitRow.click() })
    const { items } = mocks.menuSheet.mock.calls[0][0]
    act(() => { items[0].onClick() })
    expect(mocks.setUnit).toHaveBeenCalledWith('lb')
    expect(save).toHaveBeenCalledWith({ unit: 'lb' })
  })
})
