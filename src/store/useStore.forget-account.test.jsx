// @vitest-environment happy-dom

/* After the account is deleted on the server, forgetAccount leaves nothing of it on this device:
   no copy, no stash, no sync marks, no photos or videos, and no session. Unlike a sign-out it
   pushes nothing and keeps nothing aside, even with changes still owed. A stash another account
   left here stays, with its files. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn(), setRemoteAuth: vi.fn() }))
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast }) } }))

import { api } from '../lib/api.js'
import { createMediaStore, memoryBackend, _setMediaStore } from '../lib/media-store.js'
import { _resetMediaOwed } from '../lib/media-owed.js'
import { DEF, useStore } from './useStore.js'

const clone = value => JSON.parse(JSON.stringify(value))
const USER = { id: 'user-1', name: 'One' }
const fresh = { offline: false, pending: false, auth: false, lastError: null, lastSynced: 0, server: null }
const MINE = 'a'.repeat(64)
const THEIRS = 'b'.repeat(64)
const photo = hash => ({ kind: 'image', hash, mime: 'image/webp', size: 3, width: 8, height: 6, at: 1 })
const stateWith = (hash, workouts = []) => ({ ...clone(DEF), _ts: 100, workouts, customEx: [{ id: 'c-' + hash[0], n: 'carry', bp: 'back', custom: true, media: photo(hash) }] })
const paths = () => api.mock.calls.map(([p, o]) => (o?.method || 'GET') + ' ' + p)

let media
beforeEach(async () => {
  localStorage.clear()
  api.mockReset(); toast.mockReset()
  _resetMediaOwed()
  media = createMediaStore(memoryBackend())
  _setMediaStore(media)
  useStore.setState({ S: clone(DEF), user: null, ready: false, sync: { ...fresh }, config: null })
})
afterEach(() => {
  localStorage.clear()
  _setMediaStore(null)
  _resetMediaOwed()
  useStore.setState({ S: clone(DEF), user: null, ready: false, sync: { ...fresh }, config: null })
})

describe('forgetAccount', () => {
  it('wipes the account from this device without pushing or stashing, and signs out', async () => {
    await media.put(MINE, new Blob(['abc']), { mime: 'image/webp', pending: true })
    await media.put(THEIRS, new Blob(['abc']), { mime: 'image/webp', pending: false })
    await new Promise(r => setTimeout(r, 5))   // put before the wipe starts (retainOnly keeps later puts)
    localStorage.setItem('gym_stash', JSON.stringify({
      [location.origin + '|' + USER.id]: { server: location.origin, uid: USER.id, name: 'One', at: 1, state: stateWith(MINE) },
      ['|' + USER.id]: { server: null, uid: USER.id, name: 'One', at: 1, state: stateWith(MINE) },
      [location.origin + '|user-2']: { server: location.origin, uid: 'user-2', name: 'Two', at: 1, state: stateWith(THEIRS) }
    }))
    localStorage.setItem('gym_owner', USER.id)
    localStorage.setItem('gym_owner_name', 'One')
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 1, ts: 100 }))
    localStorage.setItem('gym_synced_at', '123')
    localStorage.setItem('gym_synced_fp', '{}')
    localStorage.setItem('gym_dirty', '1')   // owes the server a change: still nothing is pushed
    useStore.setState({ S: stateWith(MINE, [{ id: 'w1', d: '2026-09-01', start: 1, entries: [] }]), user: USER, ready: true, sync: { ...fresh } })
    api.mockResolvedValue({ ok: true })

    await useStore.getState().forgetAccount()

    expect(paths()).toEqual(['POST /api/logout'])
    expect(useStore.getState().user).toBeNull()
    expect(useStore.getState().S.workouts).toEqual([])
    expect(useStore.getState().S.customEx).toEqual([])
    expect(JSON.parse(localStorage.getItem('gym_state_v1')).workouts).toEqual([])
    expect(Object.values(JSON.parse(localStorage.getItem('gym_stash'))).map(e => e.uid)).toEqual(['user-2'])
    for (const k of ['gym_sync', 'gym_dirty', 'gym_synced_at', 'gym_synced_fp', 'gym_owner', 'gym_owner_name', 'gym_user', 'gym_logout_owed']) {
      expect(localStorage.getItem(k)).toBeNull()
    }
    await vi.waitFor(async () => expect(await media.has(MINE)).toBe(false), { timeout: 3000 })
    expect(await media.has(THEIRS)).toBe(true)
  })

  it('removes the stash entirely when only this account had one', async () => {
    localStorage.setItem('gym_stash', JSON.stringify({
      [location.origin + '|' + USER.id]: { server: location.origin, uid: USER.id, name: 'One', at: 1, state: clone(DEF) }
    }))
    useStore.setState({ S: clone(DEF), user: USER, ready: true, sync: { ...fresh } })
    api.mockResolvedValue({ ok: true })
    await useStore.getState().forgetAccount()
    expect(localStorage.getItem('gym_stash')).toBeNull()
    expect(await useStore.getState().keptChanges()).toEqual([])
  })

  it('still wipes the device when the local sign-out call fails', async () => {
    localStorage.setItem('gym_owner', USER.id)
    useStore.setState({ S: { ...clone(DEF), workouts: [{ id: 'w1', d: '2026-09-01', start: 1, entries: [] }] }, user: USER, ready: true, sync: { ...fresh } })
    api.mockRejectedValue(new TypeError('Failed to fetch'))
    await useStore.getState().forgetAccount()
    expect(useStore.getState().user).toBeNull()
    expect(useStore.getState().S.workouts).toEqual([])
    expect(localStorage.getItem('gym_logout_owed')).toBeNull()
  })
})
