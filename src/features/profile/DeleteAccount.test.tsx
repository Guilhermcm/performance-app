// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

const h = vi.hoisted(() => {
  class DeleteAccountFailed extends Error {
    code: string
    constructor(code: string) { super(code); this.code = code }
  }
  return { del: vi.fn(async () => {}), toast: vi.fn(), DeleteAccountFailed }
})
vi.mock('./account', () => ({ deleteMyAccount: h.del, DeleteAccountFailed: h.DeleteAccountFailed }))
vi.mock('sonner', () => ({ toast: h.toast }))
vi.mock('@/components/ui/drawer', () => import('../social/test-drawer'))

import DeleteAccount from './DeleteAccount'

const online = (on: boolean) => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => on })
const open = () => {
  render(<DeleteAccount />)
  fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }))
  return screen.getByRole('dialog')
}
const confirmButton = () => screen.getByRole('button', { name: /Delete for good|Try again/ }) as HTMLButtonElement

beforeEach(() => { h.del.mockReset(); h.del.mockResolvedValue(undefined); h.toast.mockClear(); online(true) })
afterEach(cleanup)

describe('DeleteAccount', () => {
  it('explains what goes and keeps the delete button off until the box is ticked', () => {
    const dialog = open()
    expect(dialog.textContent).toContain('profile, workouts, XP, badges, friendships and your place in challenges')
    expect(dialog.textContent).toContain("It can't be undone.")
    expect(confirmButton().disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: "I understand this can't be undone" }))
    expect(confirmButton().disabled).toBe(false)
  })

  it('deletes, shows busy meanwhile, and confirms with a toast', async () => {
    let finish!: () => void
    h.del.mockImplementation(() => new Promise<void>(r => { finish = r }))
    open()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(confirmButton())
    const busy = await screen.findByRole('button', { name: /Deleting/ }) as HTMLButtonElement
    expect(busy.disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true)
    finish()
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith('Account deleted'))
    expect(h.del).toHaveBeenCalledTimes(1)
  })

  it('says it needs a connection when offline, without calling the server', () => {
    online(false)
    open()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(confirmButton())
    expect(screen.getByRole('alert').textContent).toBe("You're offline. Connect to the internet to delete your account.")
    expect(h.del).not.toHaveBeenCalled()
  })

  it('reports a failure and lets the person try again', async () => {
    h.del.mockRejectedValueOnce(new h.DeleteAccountFailed('failed'))
    open()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(confirmButton())
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe("Couldn't delete your account. Nothing was removed."))
    expect(confirmButton().textContent).toBe('Try again')
    fireEvent.click(confirmButton())
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith('Account deleted'))
    expect(h.del).toHaveBeenCalledTimes(2)
  })

  it('treats a request that never arrived as offline', async () => {
    h.del.mockRejectedValueOnce(new h.DeleteAccountFailed('network'))
    open()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(confirmButton())
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain("You're offline"))
  })

  it('forgets the tick when closed', () => {
    open()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }))
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false)
  })
})
