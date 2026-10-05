// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'

vi.mock('@/components/ui/drawer', () => import('./test-drawer'))

import RankingPanel from './RankingPanel'
import { useSocial } from './useSocial'
import { BIA, CAIO, ME, rowOf } from './test-social'
import type { LeaderboardRow } from './types'

const realLoad = useSocial.getState().load
const load = vi.fn(async () => null)
const board = (rows: LeaderboardRow[]) => ({ status: 'ready' as const, data: { week_start: '2026-10-05', rows }, stale: false, error: null })

beforeEach(() => {
  localStorage.clear()
  useSocial.getState().reset()
  useSocial.setState({ userId: ME, load })
  load.mockClear()
})
afterEach(() => { cleanup(); useSocial.setState({ load: realLoad }) })

describe('RankingPanel', () => {
  it('ranks me and my friends this week, with movement and the gap to the next one', () => {
    useSocial.setState({ weekly: board([
      rowOf(BIA, 'Bia', { xp: 500, level: 4, pos: 1, prev_pos: 2 }),
      rowOf(ME, 'Ana', { xp: 300, level: 6, pos: 2, prev_pos: 1, gap: 200 }),
      rowOf(CAIO, 'Caio', { xp: 300, level: 3, pos: 2, prev_pos: 2, gap: 200 })
    ]) })
    render(<RankingPanel />)
    expect(load).toHaveBeenCalledWith('weekly')
    const items = screen.getAllByRole('listitem')
    expect(items.map(li => li.getAttribute('aria-current'))).toEqual([null, 'true', null])
    expect(within(items[0]).getByText('Position 1')).toBeTruthy()
    expect(within(items[0]).getByText('Up 1 since last week')).toBeTruthy()
    expect(within(items[1]).getByText('Down 1 since last week')).toBeTruthy()
    expect(within(items[1]).getByText('You')).toBeTruthy()
    expect(within(items[1]).getByText('300 XP')).toBeTruthy()
    expect(within(items[2]).queryByText(/since last week/)).toBeNull()
    expect(screen.getByText('200 XP to pass Bia')).toBeTruthy()
  })

  it('switches to the all-time board', () => {
    useSocial.setState({ weekly: board([rowOf(ME, 'Ana')]) })
    const { container } = render(<RankingPanel />)
    fireEvent.click(screen.getByRole('radio', { name: 'All time' }))
    expect(load).toHaveBeenCalledWith('alltime')
    expect(screen.getByText('By total XP since the start.')).toBeTruthy()
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy()
  })

  it('says when I lead', () => {
    useSocial.setState({ weekly: board([rowOf(ME, 'Ana', { xp: 900 }), rowOf(BIA, 'Bia', { xp: 100, pos: 2, gap: 800 })]) })
    render(<RankingPanel />)
    expect(screen.getByText('You are in the lead.')).toBeTruthy()
  })

  it('invites friends when I am alone', () => {
    useSocial.setState({ weekly: board([rowOf(ME, 'Ana', { xp: 120 })]) })
    render(<RankingPanel />)
    expect(screen.getByText('Rankings are better with company')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Invite a friend' })).toBeTruthy()
  })

  it('offers a retry when the board could not load', () => {
    useSocial.setState({ weekly: { status: 'error', data: null, stale: false, error: 'network' } })
    render(<RankingPanel />)
    load.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(load).toHaveBeenCalledWith('weekly')
  })
})
