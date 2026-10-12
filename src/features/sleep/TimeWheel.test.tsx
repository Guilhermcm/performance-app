// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, cleanup, within, act } from '@testing-library/react'
import { TimeWheel } from './TimeWheel'

afterEach(() => { cleanup(); vi.useRealTimers() })

// A wheel that keeps its own value, so a test reads what a person would see after each step.
function Harness({ start }: { start: string }) {
  const [value, setValue] = useState(start)
  return <><TimeWheel value={value} onChange={setValue} label="Went to bed" /><output data-testid="value">{value}</output></>
}
const value = () => screen.getByTestId('value').textContent
const hours = () => screen.getByRole('listbox', { name: 'Hours' })
const minutes = () => screen.getByRole('listbox', { name: 'Minutes' })

describe('TimeWheel', () => {
  it('lists the 24 hours and the minutes in steps of 5, with the value selected', () => {
    render(<Harness start="07:35" />)
    expect(screen.getByRole('group', { name: 'Went to bed' })).toBeTruthy()
    expect(within(hours()).getAllByRole('option')).toHaveLength(24)
    const mins = within(minutes()).getAllByRole('option').map(o => o.textContent)
    expect(mins).toEqual(['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55'])
    expect(within(hours()).getByRole('option', { selected: true }).textContent).toBe('07')
    expect(within(minutes()).getByRole('option', { selected: true }).textContent).toBe('35')
  })

  it('picks an hour or a minute with a tap', () => {
    render(<Harness start="07:35" />)
    fireEvent.click(within(hours()).getByRole('option', { name: '23' }))
    expect(value()).toBe('23:35')
    fireEvent.click(within(minutes()).getByRole('option', { name: '05' }))
    expect(value()).toBe('23:05')
  })

  it('moves 15 minutes with the buttons, across midnight', () => {
    render(<Harness start="00:05" />)
    fireEvent.click(screen.getByRole('button', { name: '15 minutes earlier' }))
    expect(value()).toBe('23:50')
    fireEvent.click(screen.getByRole('button', { name: '15 minutes later' }))
    fireEvent.click(screen.getByRole('button', { name: '15 minutes later' }))
    expect(value()).toBe('00:20')
  })

  it('changes the value with the arrow keys: an hour or 5 minutes at a time', () => {
    render(<Harness start="23:55" />)
    fireEvent.keyDown(hours(), { key: 'ArrowDown' })
    expect(value()).toBe('00:55')
    fireEvent.keyDown(hours(), { key: 'ArrowUp' })
    fireEvent.keyDown(hours(), { key: 'ArrowUp' })
    expect(value()).toBe('22:55')
    fireEvent.keyDown(minutes(), { key: 'ArrowDown' })
    expect(value()).toBe('22:00')
    fireEvent.keyDown(minutes(), { key: 'ArrowUp' })
    expect(value()).toBe('22:55')
    fireEvent.keyDown(minutes(), { key: 'Home' })
    expect(value()).toBe('22:00')
    fireEvent.keyDown(hours(), { key: 'End' })
    expect(value()).toBe('23:00')
  })

  it('points the listbox at the selected option for a screen reader', () => {
    render(<Harness start="07:35" />)
    const active = hours().getAttribute('aria-activedescendant')
    expect(active && document.getElementById(active)?.textContent).toBe('07')
  })

  it('leaves a value off the 5 minute grid alone until the person scrolls', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    render(<Harness start="23:07" />)
    const col = minutes()
    expect(within(col).queryByRole('option', { selected: true })).toBeNull()
    // The column's own scroll (to the row nearest the value) settles without picking anything.
    col.scrollTop = 44
    fireEvent.scroll(col)
    act(() => { vi.advanceTimersByTime(500) })
    expect(value()).toBe('23:07')
    // A finger scroll that comes to rest on a row picks it.
    fireEvent.touchStart(col)
    col.scrollTop = 88
    fireEvent.scroll(col)
    act(() => { vi.advanceTimersByTime(500) })
    expect(value()).toBe('23:10')
  })
})
