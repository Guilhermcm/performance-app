// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import { PENDING_KEY, clearPendingInvite, inviteCodeFromPath, inviteUrl, readPendingInvite, savePendingInvite } from './pending-invite'

beforeEach(() => localStorage.clear())

describe('pending invite', () => {
  it('reads the code from the invite route only', () => {
    expect(inviteCodeFromPath('/convite/AbCdEfGh12')).toBe('AbCdEfGh12')
    expect(inviteCodeFromPath('/convite/AbCdEfGh12/')).toBe('AbCdEfGh12')
    expect(inviteCodeFromPath('/convite/short')).toBeNull()
    expect(inviteCodeFromPath('/home')).toBeNull()
  })

  it('builds the link the hash router opens', () => {
    expect(inviteUrl('AbCdEfGh12', { origin: 'https://perf.app', pathname: '/' })).toBe('https://perf.app/#/convite/AbCdEfGh12')
  })

  it('keeps the code for a day across the sign-in', () => {
    savePendingInvite('AbCdEfGh12', 1_000)
    expect(readPendingInvite(1_000 + 60_000)).toBe('AbCdEfGh12')
    expect(readPendingInvite(1_000 + 24 * 3600_000)).toBeNull()
    clearPendingInvite()
    expect(readPendingInvite(1_000)).toBeNull()
  })

  it('ignores bad codes and garbage', () => {
    savePendingInvite('nope')
    expect(localStorage.getItem(PENDING_KEY)).toBeNull()
    localStorage.setItem(PENDING_KEY, '{oops')
    expect(readPendingInvite()).toBeNull()
  })
})
