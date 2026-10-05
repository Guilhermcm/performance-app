// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const P = { id: 'u1', display_name: 'Ana', avatar_url: null, birth_date: null, sex: null, height_cm: 165, weight_kg: 62, goal: 'strength', level: 'beginner', days_per_week: 3, equipment: [], unit: 'kg', locale: 'pt-BR', timezone: 'America/Sao_Paulo', share_activity: false, created_at: '', updated_at: '' }
const h = vi.hoisted(() => ({
  save: vi.fn(async (p: any) => ({ ...P, ...p })),
  signOut: vi.fn(async (_o?: any): Promise<any> => ({ owed: false })),
  setUnit: vi.fn(),
  update: vi.fn(),
  menuSheet: vi.fn(),
  toast: vi.fn(),
  S: { unit: 'kg' } as Record<string, unknown>
}))
vi.mock('./useProfile', () => ({ useProfile: (sel?: any) => { const s = { profile: P, save: h.save }; return sel ? sel(s) : s } }))
vi.mock('../../store/useStore.js', () => {
  const state = () => ({ signOut: h.signOut, setUnit: h.setUnit, update: h.update, S: h.S })
  return { useStore: Object.assign((sel: any) => sel(state()), { getState: state }) }
})
vi.mock('../../sheets.jsx', () => ({ menuSheet: h.menuSheet }))
vi.mock('sonner', () => ({ toast: h.toast }))
vi.mock('../../lib/equipment.js', () => ({ ALL_EQUIPMENT: ['barbell', 'body weight'] }))

import ProfileScreen, { SOURCE_URL } from './ProfileScreen'

const show = () => render(<MemoryRouter><ProfileScreen /></MemoryRouter>)

beforeEach(() => {
  Object.values(h).forEach(f => typeof f === 'function' && (f as any).mockClear())
  h.signOut.mockImplementation(async () => ({ owed: false }))
  h.S = { unit: 'kg' }
})
afterEach(cleanup)

describe('ProfileScreen', () => {
  it('shows the profile', () => {
    show()
    expect(screen.getByRole('heading', { name: 'Ana' })).toBeTruthy()
    expect(screen.getByText('165 cm')).toBeTruthy()
  })

  it('saves an edited section', async () => {
    show()
    fireEvent.click(screen.getAllByRole('button', { name: /edit/i })[0])
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Bia' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(h.save).toHaveBeenCalledWith(expect.objectContaining({ display_name: 'Bia' })))
    expect(h.setUnit).not.toHaveBeenCalled()
    expect(h.toast).toHaveBeenCalledWith('Profile saved')
  })

  it('keeps the editor open and shows the error when the input is invalid', async () => {
    show()
    fireEvent.click(screen.getAllByRole('button', { name: /edit/i })[0])
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(await screen.findByText('Enter a name up to 60 characters.')).toBeTruthy()
    expect(h.save).not.toHaveBeenCalled()
  })

  it('cancel drops the draft', () => {
    show()
    fireEvent.click(screen.getAllByRole('button', { name: /edit/i })[0])
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Bia' } })
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(screen.queryByLabelText(/name/i)).toBeNull()
    expect(h.save).not.toHaveBeenCalled()
  })

  it('asks convert or relabel when the unit changes, and applies the choice', async () => {
    show()
    fireEvent.click(screen.getAllByRole('button', { name: /edit/i })[0])
    fireEvent.click(screen.getByRole('radio', { name: 'lb' }))
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(h.menuSheet).toHaveBeenCalledTimes(1)
    expect(h.save).not.toHaveBeenCalled()
    const { items } = h.menuSheet.mock.calls[0][0]
    items[1].onClick()   // keep the numbers, change the label
    await waitFor(() => expect(h.setUnit).toHaveBeenCalledWith('lb', { convert: false }))
    expect(h.save).toHaveBeenCalledWith(expect.objectContaining({ unit: 'lb' }))
  })

  it('does not ask when the app already uses the new unit', async () => {
    h.S = { unit: 'lb' }
    show()
    fireEvent.click(screen.getAllByRole('button', { name: /edit/i })[0])
    fireEvent.click(screen.getByRole('radio', { name: 'lb' }))
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(h.save).toHaveBeenCalled())
    expect(h.menuSheet).not.toHaveBeenCalled()
    expect(h.setUnit).not.toHaveBeenCalled()
  })

  it('applies a saved equipment list to the app', async () => {
    show()
    fireEvent.click(screen.getAllByRole('button', { name: /edit/i })[2])
    fireEvent.click(screen.getByRole('button', { name: /barbell/i }))
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(h.update).toHaveBeenCalled())
    const s: Record<string, any> = { lang: 'en', weekStart: 0 }
    h.update.mock.calls[0][0](s)
    expect(s.equipProfiles[0].equipment).toEqual(['barbell'])
    expect(s.equipFilterOn).toBe(true)
    expect(s.lang).toBe('en')   // the language and week start chosen in Settings stay
    expect(s.weekStart).toBe(0)
  })

  it('says so when saving fails', async () => {
    h.save.mockRejectedValueOnce(new Error('offline'))
    show()
    fireEvent.click(screen.getAllByRole('button', { name: /edit/i })[1])
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith('Could not save. Your previous values were kept.'))
    expect(screen.getByRole('button', { name: /save/i })).toBeTruthy()   // still editing
  })

  it('toggles sharing with friends', async () => {
    show()
    fireEvent.click(screen.getByRole('switch', { name: /share/i }))
    await waitFor(() => expect(h.save).toHaveBeenCalledWith({ share_activity: true }))
  })

  it('focuses the sharing switch when sent there from the feed', async () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    render(<MemoryRouter initialEntries={[{ pathname: '/perfil', state: { focus: 'share_activity' } }]}><ProfileScreen /></MemoryRouter>)
    const sw = screen.getByRole('switch', { name: /share/i })
    await waitFor(() => expect(document.activeElement).toBe(sw))
    expect(scroll).toHaveBeenCalled()
  })

  it('signs out', async () => {
    show()
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }))
    await waitFor(() => expect(h.signOut).toHaveBeenCalled())
    expect(h.menuSheet).not.toHaveBeenCalled()
  })

  it('asks before signing out with changes the server has not seen', async () => {
    h.signOut.mockImplementationOnce(async () => ({ owed: true, count: 2 }))
    show()
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }))
    await waitFor(() => expect(h.menuSheet).toHaveBeenCalledTimes(1))
    const { items } = h.menuSheet.mock.calls[0][0]
    const anyway = items.find((i: any) => i.danger)
    anyway.onClick()
    await waitFor(() => expect(h.signOut).toHaveBeenLastCalledWith({ force: true }))
  })

  it('links the source code (AGPL)', () => {
    show()
    expect(screen.getByRole('link', { name: /source code/i }).getAttribute('href')).toBe('https://github.com/Guilhermcm/performance-app')
    expect(SOURCE_URL).toBe('https://github.com/Guilhermcm/performance-app')
  })
})
