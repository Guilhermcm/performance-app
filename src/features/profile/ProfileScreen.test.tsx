// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'

let P: Record<string, unknown>
const BASE = { id: 'u1', display_name: 'Ana', avatar_url: null, birth_date: null, sex: null, height_cm: 165, weight_kg: 62, goal: 'strength', level: 'beginner', days_per_week: 3, equipment: [], unit: 'kg', locale: 'pt-BR', timezone: 'America/Sao_Paulo', share_activity: false, checkin_visibility: 'friends', created_at: '', updated_at: '',
  nutrition_enabled: false, activity_level: null, nutrition_pace: 'standard', nutrition_days_per_week: 5,
  sleep_enabled: false, sleep_nights_per_week: 5, habits_enabled: false }
P = BASE
const h = vi.hoisted(() => ({
  save: vi.fn(async (p: any) => ({ ...P, ...p })),
  signOut: vi.fn(async (_o?: any): Promise<any> => ({ owed: false })),
  setUnit: vi.fn(),
  update: vi.fn(),
  menuSheet: vi.fn(),
  toast: vi.fn(),
  S: { unit: 'kg' } as Record<string, unknown>,
  refreshAutoTarget: vi.fn(async (_p: unknown) => false)
}))
vi.mock('./useProfile', () => ({ useProfile: (sel?: any) => { const s = { profile: P, save: h.save }; return sel ? sel(s) : s } }))
vi.mock('../../store/useStore.js', () => {
  const state = () => ({ signOut: h.signOut, setUnit: h.setUnit, update: h.update, S: h.S })
  return { useStore: Object.assign((sel: any) => sel(state()), { getState: state }) }
})
vi.mock('../../sheets.jsx', () => ({ menuSheet: h.menuSheet }))
vi.mock('sonner', () => ({ toast: h.toast }))
vi.mock('../../lib/equipment.js', () => ({ ALL_EQUIPMENT: ['barbell', 'body weight'] }))
vi.mock('../nutrition/auto-target', () => ({ refreshAutoTarget: h.refreshAutoTarget }))
vi.mock('../nutrition/NutritionSetup', () => ({
  default: ({ open }: { open: boolean }) => (open ? <div role="dialog" aria-label="Nutrition setup" /> : null)
}))

vi.mock('../sleep/SleepSetup', () => ({
  default: ({ open }: { open: boolean }) => (open ? <div role="dialog" aria-label="Sleep setup" /> : null)
}))

vi.mock('../habits/HabitSheet', () => ({
  default: ({ open, habit }: { open: boolean; habit?: { id: string } }) =>
    (open ? <div role="dialog" aria-label="Habit sheet" data-habit={habit?.id ?? 'new'} /> : null)
}))

import ProfileScreen, { SOURCE_URL } from './ProfileScreen'
import { useNutrition } from '../nutrition/useNutrition'
import { useSleep } from '../sleep/useSleep'
import { useHabits } from '../habits/useHabits'
import { habitOf } from '../habits/test-habits'

const show = () => render(
  <MemoryRouter>
    <ProfileScreen />
    <LocationProbe />
  </MemoryRouter>
)
function LocationProbe() { return <output data-testid="path">{useLocation().pathname}</output> }

beforeEach(() => {
  Object.values(h).forEach(f => typeof f === 'function' && (f as any).mockClear())
  h.signOut.mockImplementation(async () => ({ owed: false }))
  h.S = { unit: 'kg' }
  P = BASE
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

  it('sets the default visibility of check-ins: Friends or Only me', async () => {
    show()
    const group = screen.getByRole('radiogroup', { name: 'Default check-in visibility' })
    const only = within(group).getByRole('radio', { name: 'Only me' })
    const friends = within(group).getByRole('radio', { name: 'Friends' })
    // checkin_visibility friends, with share_activity off: the two are separate.
    expect(friends.getAttribute('aria-checked')).toBe('true')
    expect(only.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(only)
    await waitFor(() => expect(h.save).toHaveBeenCalledWith({ checkin_visibility: 'private' }))
    // Choosing what is already chosen saves nothing.
    h.save.mockClear()
    fireEvent.click(friends)
    expect(h.save).not.toHaveBeenCalled()
  })

  it('starts the control on Only me when the profile says private, and goes back to Friends', async () => {
    P = { ...BASE, checkin_visibility: 'private', share_activity: true }
    show()
    const group = screen.getByRole('radiogroup', { name: 'Default check-in visibility' })
    expect(within(group).getByRole('radio', { name: 'Only me' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(within(group).getByRole('radio', { name: 'Friends' }))
    await waitFor(() => expect(h.save).toHaveBeenCalledWith({ checkin_visibility: 'friends' }))
    expect(h.save).not.toHaveBeenCalledWith(expect.objectContaining({ share_activity: expect.anything() }))
  })

  it('keeps a separate switch for showing friends the workouts from before the check-ins', async () => {
    show()
    const toggle = screen.getByRole('switch', { name: /Show friends my workouts from before check-ins/ })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(toggle)
    await waitFor(() => expect(h.save).toHaveBeenCalledWith({ share_activity: true }))
    expect(h.save).not.toHaveBeenCalledWith(expect.objectContaining({ checkin_visibility: expect.anything() }))
  })

  it('shows the Treino weekly target as training days per week', () => {
    show()
    expect(screen.getByText('Training days per week')).toBeTruthy()
  })

  it('focuses the old workouts switch when sent there with focus share_activity', async () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    render(<MemoryRouter initialEntries={[{ pathname: '/perfil', state: { focus: 'share_activity' } }]}><ProfileScreen /></MemoryRouter>)
    const toggle = screen.getByRole('switch', { name: /Show friends my workouts from before check-ins/ })
    await waitFor(() => expect(document.activeElement).toBe(toggle))
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

  it('links the source code and license', () => {
    show()
    expect(screen.getByRole('link', { name: /source code and license/i }).getAttribute('href')).toBe('https://github.com/Guilhermcm/performance-app')
    expect(SOURCE_URL).toBe('https://github.com/Guilhermcm/performance-app')
  })

  it('puts the account deletion after sign out and before the links', () => {
    show()
    const order = [
      screen.getByRole('button', { name: /sign out/i }),
      screen.getByRole('button', { name: 'Delete my account' }),
      screen.getByRole('link', { name: /source code and license/i })
    ]
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
  })

  it('opens the nutrition setup from the switch while the pillar is off', () => {
    show()
    expect(screen.getByRole('heading', { name: 'Nutrition' })).toBeTruthy()
    fireEvent.click(screen.getByRole('switch', { name: /Nutrition/ }))
    expect(screen.getByRole('dialog', { name: 'Nutrition setup' })).toBeTruthy()
    expect(h.save).not.toHaveBeenCalled()
  })

  it('shows the target, the activity and the days, edits them and turns the pillar off', async () => {
    P = { ...BASE, nutrition_enabled: true, activity_level: 'moderate', nutrition_days_per_week: 4 }
    useNutrition.setState({ targets: [{ valid_from: '2026-10-01', mode: 'auto', kcal: 2400, protein_g: 160, carbs_g: 270, fat_g: 70 }] })
    show()
    expect(screen.getByText('2,400 kcal')).toBeTruthy()
    expect(screen.getByText('Moderately active')).toBeTruthy()
    expect(screen.getByText('4')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Edit: Nutrition' }))
    expect(screen.getByRole('dialog', { name: 'Nutrition setup' })).toBeTruthy()
    fireEvent.click(screen.getByRole('switch', { name: /Nutrition/ }))
    await waitFor(() => expect(h.save).toHaveBeenCalledWith({ nutrition_enabled: false }))
    useNutrition.setState({ targets: [] })
  })

  it('refreshes the automatic target after a change to the data it is based on', async () => {
    P = { ...BASE, nutrition_enabled: true, activity_level: 'moderate' }
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Edit: About you' }))
    fireEvent.change(screen.getByLabelText(/height/i), { target: { value: '170' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(h.refreshAutoTarget).toHaveBeenCalledWith(expect.objectContaining({ height_cm: 170 })))
  })

  it('leaves the target alone after a change that does not affect it', async () => {
    P = { ...BASE, nutrition_enabled: true, activity_level: 'moderate' }
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Edit: Your equipment' }))
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(h.save).toHaveBeenCalled())
    expect(h.refreshAutoTarget).not.toHaveBeenCalled()
  })
  describe('Sleep card', () => {
    const goal = { valid_from: '2026-01-01', goal_min: 480, bed_target: '23:00' }
    afterEach(() => { useSleep.setState({ targets: [] }) })

    it('opens the sleep setup from the switch while the pillar is off', () => {
      show()
      expect(screen.getByRole('heading', { name: 'Sleep' })).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Open Sleep' })).toBeNull()
      fireEvent.click(screen.getByRole('switch', { name: 'Sleep' }))
      expect(screen.getByRole('dialog', { name: 'Sleep setup' })).toBeTruthy()
      expect(h.save).not.toHaveBeenCalled()
    })

    it('shows the goal, the bedtime and the nights, and edits them through the setup', () => {
      P = { ...BASE, sleep_enabled: true, sleep_nights_per_week: 4 }
      useSleep.setState({ targets: [goal] })
      show()
      const card = within(screen.getByRole('heading', { name: 'Sleep' }).closest('section')!)
      expect(card.getByText('8h')).toBeTruthy()
      expect(card.getByText(/^23:00/)).toBeTruthy()
      expect(card.getByText('4')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Edit: Sleep' }))
      expect(screen.getByRole('dialog', { name: 'Sleep setup' })).toBeTruthy()
    })

    it('asks before turning the pillar off, and keeps it on if the person cancels', () => {
      P = { ...BASE, sleep_enabled: true }
      useSleep.setState({ targets: [goal] })
      show()
      fireEvent.click(screen.getByRole('switch', { name: 'Sleep' }))
      expect(screen.getByRole('alertdialog', { name: 'Turn off Sleep?' })).toBeTruthy()
      expect(h.save).not.toHaveBeenCalled()
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(screen.queryByRole('alertdialog')).toBeNull()
      expect(h.save).not.toHaveBeenCalled()
      expect(screen.getByRole('switch', { name: 'Sleep' }).getAttribute('aria-checked')).toBe('true')
    })

    it('turns it off on confirmation and leaves the data alone', async () => {
      P = { ...BASE, sleep_enabled: true }
      useSleep.setState({ targets: [goal] })
      const spies = ['setTarget', 'saveNight', 'removeNight', 'reset'] as const
      const before = useSleep.getState()
      const calls = spies.map(k => vi.spyOn(before, k))
      show()
      fireEvent.click(screen.getByRole('switch', { name: 'Sleep' }))
      fireEvent.click(screen.getByRole('button', { name: 'Turn off' }))
      await waitFor(() => expect(h.save).toHaveBeenCalledWith({ sleep_enabled: false }))
      expect(h.save).toHaveBeenCalledTimes(1)
      expect(screen.queryByRole('alertdialog')).toBeNull()
      calls.forEach(c => expect(c).not.toHaveBeenCalled())
      expect(useSleep.getState().targets).toEqual([goal])
    })

    it('says so when turning it off fails', async () => {
      P = { ...BASE, sleep_enabled: true }
      h.save.mockRejectedValueOnce(new Error('offline'))
      show()
      fireEvent.click(screen.getByRole('switch', { name: 'Sleep' }))
      fireEvent.click(screen.getByRole('button', { name: 'Turn off' }))
      await waitFor(() => expect(h.toast).toHaveBeenCalledWith('Could not save. Your previous values were kept.'))
    })

    it('opens the Sleep screen from the card once the pillar is on', () => {
      P = { ...BASE, sleep_enabled: true }
      show()
      fireEvent.click(screen.getByRole('button', { name: 'Open Sleep' }))
      expect(screen.getByTestId('path').textContent).toBe('/sono')
    })
  })
  describe('Habits card', () => {
    const realHabits = useHabits.getState()
    const active = [habitOf({ id: 'a' }), habitOf({ id: 'b', sort: 1 })]
    const archived = habitOf({ id: 'c', sort: 2, archived_at: '2026-10-01T00:00:00Z' })
    const card = () => within(screen.getByRole('heading', { name: 'Habits' }).closest('section')!)
    // The profile follows what was saved, as the real store does.
    const followSaves = () => h.save.mockImplementation(async (p: any) => (P = { ...P, ...p }))
    beforeEach(() => { useHabits.setState({ habits: [], status: 'ready' }) })
    afterEach(() => { useHabits.setState(realHabits); h.save.mockImplementation(async (p: any) => ({ ...P, ...p })) })

    it('offers the switch while the pillar is off, without the link', () => {
      show()
      expect(screen.getByRole('switch', { name: 'Habits' }).getAttribute('aria-checked')).toBe('false')
      expect(card().getByText('Choose your habits and how many times a week you want to do each one. Every check earns XP, like workouts do.')).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Open Habits' })).toBeNull()
    })

    it('shows how many habits are active once the pillar is on', () => {
      P = { ...BASE, habits_enabled: true }
      useHabits.setState({ habits: [...active, archived] })
      show()
      expect(screen.getByRole('switch', { name: 'Habits' }).getAttribute('aria-checked')).toBe('true')
      expect(card().getByText('Active habits')).toBeTruthy()
      expect(card().getByText('2')).toBeTruthy()
    })

    it('shows a placeholder, not 0, until the habits have loaded', () => {
      P = { ...BASE, habits_enabled: true }
      useHabits.setState({ habits: [], status: 'loading' })
      show()
      expect(card().queryByText('0')).toBeNull()
      expect(card().getByText('—')).toBeTruthy()
    })

    it('turns the pillar on and opens the creation when there is no active habit', async () => {
      useHabits.setState({ habits: [archived] })
      show()
      fireEvent.click(screen.getByRole('switch', { name: 'Habits' }))
      await waitFor(() => expect(screen.getByRole('dialog', { name: 'Habit sheet' })).toBeTruthy())
      expect(h.save).toHaveBeenCalledWith({ habits_enabled: true })
    })

    it('asks before turning the pillar off, and keeps it on if the person cancels', () => {
      P = { ...BASE, habits_enabled: true }
      useHabits.setState({ habits: active })
      show()
      fireEvent.click(screen.getByRole('switch', { name: 'Habits' }))
      expect(screen.getByRole('alertdialog', { name: 'Turn off Habits?' })).toBeTruthy()
      expect(h.save).not.toHaveBeenCalled()
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(screen.queryByRole('alertdialog')).toBeNull()
      expect(h.save).not.toHaveBeenCalled()
    })

    it('turns it off on confirmation and leaves the habits alone', async () => {
      P = { ...BASE, habits_enabled: true }
      useHabits.setState({ habits: [...active, archived] })
      const before = useHabits.getState()
      const calls = (['saveHabit', 'archiveHabit', 'reactivateHabit', 'toggleCheck', 'reset'] as const).map(k => vi.spyOn(before, k))
      show()
      fireEvent.click(screen.getByRole('switch', { name: 'Habits' }))
      expect(screen.getByText('Your habits and checks stay saved. You can turn it back on any time.')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Turn off' }))
      await waitFor(() => expect(h.save).toHaveBeenCalledWith({ habits_enabled: false }))
      expect(h.save).toHaveBeenCalledTimes(1)
      expect(screen.queryByRole('alertdialog')).toBeNull()
      calls.forEach(c => expect(c).not.toHaveBeenCalled())
      expect(useHabits.getState().habits).toEqual([...active, archived])
    })

    it('says so when turning it off fails', async () => {
      P = { ...BASE, habits_enabled: true }
      h.save.mockRejectedValueOnce(new Error('offline'))
      show()
      fireEvent.click(screen.getByRole('switch', { name: 'Habits' }))
      fireEvent.click(screen.getByRole('button', { name: 'Turn off' }))
      await waitFor(() => expect(h.toast).toHaveBeenCalledWith('Could not save. Your previous values were kept.'))
      expect(screen.getByRole('alertdialog')).toBeTruthy()
    })

    it('opens the Habits screen from the card once the pillar is on', () => {
      P = { ...BASE, habits_enabled: true }
      show()
      fireEvent.click(screen.getByRole('button', { name: 'Open Habits' }))
      expect(screen.getByTestId('path').textContent).toBe('/habitos')
    })

    it('turning it off and on again the same day with active habits does not open the creation', async () => {
      P = { ...BASE, habits_enabled: true }
      useHabits.setState({ habits: active })
      followSaves()
      const { rerender } = show()
      fireEvent.click(screen.getByRole('switch', { name: 'Habits' }))
      fireEvent.click(screen.getByRole('button', { name: 'Turn off' }))
      await waitFor(() => expect(h.save).toHaveBeenCalledWith({ habits_enabled: false }))
      rerender(<MemoryRouter><ProfileScreen /><LocationProbe /></MemoryRouter>)
      expect(screen.getByRole('switch', { name: 'Habits' }).getAttribute('aria-checked')).toBe('false')
      fireEvent.click(screen.getByRole('switch', { name: 'Habits' }))
      await waitFor(() => expect(h.save).toHaveBeenCalledWith({ habits_enabled: true }))
      await waitFor(() => expect(h.toast).toHaveBeenCalledWith('The Habits pillar is on.'))
      expect(screen.queryByRole('dialog', { name: 'Habit sheet' })).toBeNull()
    })
  })
})
