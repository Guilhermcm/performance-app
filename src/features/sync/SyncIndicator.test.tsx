// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, cleanup, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({
  sync: {} as Record<string, unknown>,
  pullState: vi.fn(async () => {}),
  signOut: vi.fn(async (_o?: unknown): Promise<any> => ({ owed: false })),
  toast: vi.fn()
}))
vi.mock('../../store/useStore.js', () => ({
  useStore: (sel: (s: unknown) => unknown) => sel({ sync: h.sync, pullState: h.pullState, signOut: h.signOut })
}))
vi.mock('sonner', () => ({ toast: h.toast }))

import SyncIndicator, { syncView, ERROR_GRACE_MS } from './SyncIndicator'

const OK = { offline: false, pending: false, auth: false, lastError: null, status: 'ok' }
const setOnline = (on: boolean) => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => on })

beforeEach(() => {
  h.sync = { ...OK }
  h.pullState.mockClear()
  h.signOut.mockClear()
  h.toast.mockClear()
  setOnline(true)
})
afterEach(() => { cleanup(); vi.useRealTimers(); document.documentElement.style.removeProperty('--conn') })

describe('syncView', () => {
  it('says nothing when all is well', () => {
    expect(syncView(OK, true)).toBeNull()
    expect(syncView(null, true)).toBeNull()
  })
  it('says nothing offline when nothing is waiting', () => {
    expect(syncView({ ...OK, offline: true, lastError: { status: 0, code: 'network' } }, true)).toBeNull()
    expect(syncView(OK, false)).toBeNull()
  })
  it('offline with changes waiting', () => {
    expect(syncView({ ...OK, offline: true, pending: true }, true)).toBe('offline')
    expect(syncView({ ...OK, pending: true }, false)).toBe('offline')
  })
  it('an error answer', () => {
    expect(syncView({ ...OK, lastError: { status: 500, code: 'http' }, pending: true }, true)).toBe('error')
  })
  it('a session the server ended wins over everything', () => {
    expect(syncView({ ...OK, auth: true, offline: true, pending: true }, false)).toBe('auth')
  })
})

describe('SyncIndicator', () => {
  it('is hidden when all is good', () => {
    render(<SyncIndicator />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByRole('status').textContent).toBe('')
  })

  it('offline with pending changes: says they are kept here, nothing to tap', () => {
    h.sync = { ...OK, offline: true, pending: true, status: 'offline' }
    render(<SyncIndicator />)
    expect(screen.getByText(/Offline — your changes are saved on this device/)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('follows the device going offline before any request fails', () => {
    h.sync = { ...OK, pending: true, status: 'pending' }
    setOnline(false)
    render(<SyncIndicator />)
    expect(screen.getByText(/Offline — your changes are saved on this device/)).toBeTruthy()
  })

  it('a sync error that persists offers a retry, which pulls', async () => {
    vi.useFakeTimers()
    h.sync = { ...OK, lastError: { status: 503, code: 'http' }, pending: true, status: 'error' }
    render(<SyncIndicator />)
    expect(screen.queryByRole('button')).toBeNull()   // not for a blip
    act(() => { vi.advanceTimersByTime(ERROR_GRACE_MS) })
    vi.useRealTimers()
    fireEvent.click(screen.getByRole('button', { name: /Not synced yet — tap to retry/ }))
    await waitFor(() => expect(h.pullState).toHaveBeenCalledTimes(1))
  })

  it('a session that ended signs out to the sign-in screen, keeping the changes aside', async () => {
    h.sync = { ...OK, auth: true, pending: true, status: 'auth', lastError: { status: 401, code: 'auth' } }
    render(<SyncIndicator />)
    fireEvent.click(screen.getByRole('button', { name: /Session ended — sign in again/ }))
    await waitFor(() => expect(h.signOut).toHaveBeenCalledWith({ force: true }))
    expect(h.toast).not.toHaveBeenCalled()
  })

  it('says so when the changes could not be kept aside', async () => {
    h.signOut.mockImplementationOnce(async () => ({ owed: true, count: 1, stashed: false }))
    h.sync = { ...OK, auth: true, status: 'auth' }
    render(<SyncIndicator />)
    fireEvent.click(screen.getByRole('button', { name: /Session ended/ }))
    await waitFor(() => expect(h.toast).toHaveBeenCalled())
  })

  it('leaves room for itself under the status bar (--conn)', () => {
    h.sync = { ...OK, offline: true, pending: true }
    render(<SyncIndicator />)
    expect(document.documentElement.style.getPropertyValue('--conn')).not.toBe('')
    cleanup()
    expect(document.documentElement.style.getPropertyValue('--conn')).toBe('')
  })
})
