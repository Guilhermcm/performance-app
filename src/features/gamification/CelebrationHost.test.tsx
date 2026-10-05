// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import CelebrationHost from './CelebrationHost'
import { useProgress } from './useProgress'

beforeEach(() => {
  localStorage.clear()
  useProgress.getState().reset()
})
afterEach(cleanup)

describe('CelebrationHost', () => {
  it('shows pending celebrations and clears them', () => {
    useProgress.setState({ pending: [{ kind: 'level', level: 3 }] })
    render(<CelebrationHost />)
    expect(screen.getByText('Level 3')).toBeTruthy()
    expect(useProgress.getState().pending).toEqual([])
    fireEvent.click(screen.getByText('Tap to continue'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('waits while held', () => {
    useProgress.setState({ pending: [{ kind: 'level', level: 3 }], held: true })
    render(<CelebrationHost />)
    expect(screen.queryByRole('dialog')).toBeNull()
    act(() => useProgress.getState().hold(false))
    expect(screen.getByText('Level 3')).toBeTruthy()
  })
})
