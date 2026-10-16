// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { CelebrationOverlay } from './CelebrationOverlay'

afterEach(cleanup)

describe('CelebrationOverlay', () => {
  it('shows one card at a time and finishes after the last', () => {
    const onDone = vi.fn()
    render(<CelebrationOverlay items={[{ kind: 'level', level: 5 }, { kind: 'achievement', code: 'first_workout' }]} onDone={onDone} />)
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText('Level up!')).toBeTruthy()
    expect(screen.getByText('Level 5')).toBeTruthy()
    fireEvent.click(screen.getByText('Tap to continue'))
    expect(screen.getByText('Achievement unlocked')).toBeTruthy()
    expect(screen.getByText('First workout')).toBeTruthy()
    expect(screen.getByText('+50 XP')).toBeTruthy()
    expect(onDone).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Tap to continue'))
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('skips the rest on Escape', () => {
    const onDone = vi.fn()
    render(<CelebrationOverlay items={[{ kind: 'level', level: 5 }, { kind: 'level', level: 6 }]} onDone={onDone} />)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('shows a pillar level, the nutrition weekly goal and a nutrition badge', () => {
    render(<CelebrationOverlay onDone={vi.fn()} items={[
      { kind: 'pillar_level', pillar: 'nutrition', level: 2 },
      { kind: 'week_target', pillar: 'nutrition', week_start: '2026-09-28' },
      { kind: 'achievement', code: 'protein_7' }
    ]} />)
    expect(screen.getByText('Nutrition level 2')).toBeTruthy()
    fireEvent.click(screen.getByText('Tap to continue'))
    expect(screen.getByText('Nutrition goal met')).toBeTruthy()
    expect(screen.getByText('+150 XP')).toBeTruthy()
    fireEvent.click(screen.getByText('Tap to continue'))
    expect(screen.getByText('Protein week')).toBeTruthy()
    expect(screen.getByText('+100 XP')).toBeTruthy()
  })

  it('shows the sleep level and the sleep weekly goal', () => {
    render(<CelebrationOverlay onDone={vi.fn()} items={[
      { kind: 'pillar_level', pillar: 'sleep', level: 3 },
      { kind: 'week_target', pillar: 'sleep', week_start: '2026-09-28' }
    ]} />)
    expect(screen.getByText('Sleep level 3')).toBeTruthy()
    fireEvent.click(screen.getByText('Tap to continue'))
    expect(screen.getByText('Sleep goal met')).toBeTruthy()
    expect(screen.getByText('You hit your target on enough nights last week.')).toBeTruthy()
    expect(screen.getByText('+150 XP')).toBeTruthy()
  })

  it('shows the habits level and the habit week with the bonus it paid in the title', () => {
    render(<CelebrationOverlay onDone={vi.fn()} items={[
      { kind: 'pillar_level', pillar: 'habits', level: 4 },
      { kind: 'week_target', pillar: 'habits', week_start: '2026-09-28', xp: 64 }
    ]} />)
    expect(screen.getByText('Habits level 4')).toBeTruthy()
    fireEvent.click(screen.getByText('Tap to continue'))
    expect(screen.getByText('Weekly goal met')).toBeTruthy()
    expect(screen.getByText('Habit week done, +64 XP')).toBeTruthy()
    expect(screen.getByText("You hit every habit's goal last week.")).toBeTruthy()
    // The XP is in the title: no second chip, and never the fixed 150 of the other pillars.
    expect(screen.queryByText('+64 XP')).toBeNull()
    expect(screen.queryByText('+150 XP')).toBeNull()
  })

  it('shows a habit week without its XP as the plain title', () => {
    render(<CelebrationOverlay onDone={vi.fn()} items={[{ kind: 'week_target', pillar: 'habits', week_start: '2026-09-28' }]} />)
    expect(screen.getByText('Habit week done')).toBeTruthy()
    expect(screen.queryByText(/\+\d+ XP/)).toBeNull()
  })

  it('never shows a raw code for a badge it does not know', () => {
    render(<CelebrationOverlay items={[{ kind: 'achievement', code: 'from_the_future' }]} onDone={vi.fn()} />)
    expect(screen.queryByText('from_the_future')).toBeNull()
    expect(screen.getByText('New achievement')).toBeTruthy()
  })
})
