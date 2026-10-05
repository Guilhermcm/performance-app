// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { StreakBadge } from './StreakBadge'

afterEach(cleanup)

describe('StreakBadge', () => {
  it('says the streak and the shields, and toggles the explanation', () => {
    const onToggle = vi.fn()
    const { container } = render(<StreakBadge current={5} shields={1} expanded={false} onToggle={onToggle} />)
    const button = screen.getByRole('button', { name: '5 week streak. Shields: 1 of 2' })
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelectorAll('[data-shield="on"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-shield="off"]')).toHaveLength(1)
    fireEvent.click(button)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })
})
