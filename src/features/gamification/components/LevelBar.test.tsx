// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'
import { LevelBar } from './LevelBar'

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })
const fill = (c: HTMLElement) => (c.querySelector('[data-slot="level-fill"]') as HTMLElement).style.width

describe('LevelBar', () => {
  it('shows the share of the level reached', () => {
    const { container, getByRole } = render(<LevelBar to={{ level: 3, into: 50, need: 200 }} instant label="Level 3" />)
    expect(fill(container)).toBe('25%')
    expect(getByRole('progressbar', { name: 'Level 3' }).getAttribute('aria-valuenow')).toBe('50')
  })

  it('runs to the end, empties and refills across a level-up', () => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number)
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
    const { container } = render(<LevelBar from={{ level: 3, into: 150, need: 200 }} to={{ level: 4, into: 50, need: 250 }} label="Level 4" />)
    expect(fill(container)).toBe('75%')
    act(() => { vi.advanceTimersByTime(1) })
    expect(fill(container)).toBe('100%')
    act(() => { vi.advanceTimersByTime(700) })
    expect(fill(container)).toBe('20%')
  })
})
