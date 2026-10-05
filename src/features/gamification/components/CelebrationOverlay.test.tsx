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
})
