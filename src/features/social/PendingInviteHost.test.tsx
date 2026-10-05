// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'

const h = vi.hoisted(() => ({ nav: vi.fn(), path: '/home' }))
vi.mock('react-router-dom', () => ({ useNavigate: () => h.nav, useLocation: () => ({ pathname: h.path }) }))

import PendingInviteHost from './PendingInviteHost'
import { savePendingInvite } from './pending-invite'

beforeEach(() => { localStorage.clear(); h.nav.mockClear(); h.path = '/home' })
afterEach(cleanup)

describe('PendingInviteHost', () => {
  it('takes a pending invite to its screen once the account is ready', () => {
    savePendingInvite('AbCdEfGh12')
    render(<PendingInviteHost />)
    expect(h.nav).toHaveBeenCalledWith('/convite/AbCdEfGh12', { replace: true })
  })

  it('stays put without one, or when already there', () => {
    render(<PendingInviteHost />)
    cleanup()
    savePendingInvite('AbCdEfGh12')
    h.path = '/convite/AbCdEfGh12'
    render(<PendingInviteHost />)
    expect(h.nav).not.toHaveBeenCalled()
  })
})
