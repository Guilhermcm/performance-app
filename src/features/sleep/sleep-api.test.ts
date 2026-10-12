import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: h.rpc, from: h.from } }))

import * as api from './sleep-api'
import { logOf, nightOf, targetOf } from './test-sleep'

function chain(result: { data?: unknown; error: unknown }) {
  const calls: [string, unknown[]][] = []
  const proxy: any = new Proxy({}, {
    get(_, prop) {
      if (prop === 'then') return (resolve: (v: unknown) => void) => resolve(result)
      return (...args: unknown[]) => { calls.push([String(prop), args]); return proxy }
    }
  })
  return { proxy, calls }
}

beforeEach(() => { h.rpc.mockReset(); h.from.mockReset() })

describe('sleep api', () => {
  it("reads the logs of a range and turns the database's '23:30:00' into '23:30'", async () => {
    const c = chain({ data: [{ user_id: 'u', night: '2026-10-05', bed_time: '23:30:00', wake_time: '07:10:00', duration_min: '460', quality: 4, note: 'ok', created_at: 'x', updated_at: 'y' }], error: null })
    h.from.mockReturnValue(c.proxy)
    await expect(api.fetchLogs('2026-10-04', '2026-10-05')).resolves.toEqual([
      { night: '2026-10-05', bed_time: '23:30', wake_time: '07:10', duration_min: 460, quality: 4, note: 'ok', updated_at: 'y' }
    ])
    expect(h.from).toHaveBeenCalledWith('sleep_logs')
    expect(c.calls).toContainEqual(['gte', ['night', '2026-10-04']])
    expect(c.calls).toContainEqual(['lte', ['night', '2026-10-05']])
  })

  it('upserts a log on (user_id, night) without the user id or the generated duration', async () => {
    const c = chain({ error: null }); h.from.mockReturnValue(c.proxy)
    const l = logOf({ quality: 3, note: 'n' })
    await api.upsertLog(l)
    const [row, opts] = c.calls.find(x => x[0] === 'upsert')![1] as [Record<string, unknown>, unknown]
    expect(row).toEqual({ night: l.night, bed_time: '23:30', wake_time: '07:10', quality: 3, note: 'n', updated_at: l.updated_at })
    expect(opts).toEqual({ onConflict: 'user_id,night' })
  })

  it('deletes by night', async () => {
    const c = chain({ error: null }); h.from.mockReturnValue(c.proxy)
    await api.deleteLog('2026-10-05')
    expect(h.from).toHaveBeenCalledWith('sleep_logs')
    expect(c.calls).toContainEqual(['eq', ['night', '2026-10-05']])
  })

  it('reads targets oldest first with the clock as HH:MM, and writes one on (user_id, valid_from)', async () => {
    const c = chain({ data: [{ user_id: 'u', valid_from: '2026-10-01', goal_min: '480', bed_target: '23:00:00', created_at: 'x' }], error: null })
    h.from.mockReturnValue(c.proxy)
    await expect(api.fetchTargets()).resolves.toEqual([targetOf()])
    expect(h.from).toHaveBeenCalledWith('sleep_targets')
    expect(c.calls).toContainEqual(['order', ['valid_from', { ascending: true }]])

    const w = chain({ error: null }); h.from.mockReturnValue(w.proxy)
    await api.insertTarget(targetOf({ valid_from: '2026-10-06', goal_min: 465, bed_target: '22:45' }))
    expect(w.calls.find(x => x[0] === 'upsert')![1]).toEqual([{ valid_from: '2026-10-06', goal_min: 465, bed_target: '22:45' }, { onConflict: 'user_id,valid_from' }])
  })

  it('calls get_sleep_nights with the range and fills what is missing', async () => {
    const n = nightOf()
    h.rpc.mockResolvedValue({ data: { nights: [n], weeks: [{ start: '2026-09-28', target_hit: true }], periods: null }, error: null })
    await expect(api.fetchNights('2026-09-01', '2026-10-05')).resolves.toEqual({ nights: [n], weeks: [{ start: '2026-09-28', target_hit: true }], periods: [] })
    expect(h.rpc).toHaveBeenCalledWith('get_sleep_nights', { p_from: '2026-09-01', p_to: '2026-10-05' })
  })

  it('reads every period oldest first, for the calendar to go back to the first one', async () => {
    const c = chain({ data: [{ started_on: '2026-05-10', ended_on: '2026-06-01' }, { started_on: '2026-09-20', ended_on: null }], error: null })
    h.from.mockReturnValue(c.proxy)
    await expect(api.fetchPeriods()).resolves.toEqual([{ started_on: '2026-05-10', ended_on: '2026-06-01' }, { started_on: '2026-09-20', ended_on: null }])
    expect(h.from).toHaveBeenCalledWith('sleep_periods')
    expect(c.calls).toContainEqual(['select', ['started_on, ended_on']])
    expect(c.calls).toContainEqual(['order', ['started_on', { ascending: true }]])
  })

  it('throws classified errors', async () => {
    const c = chain({ error: { code: 'P0001', message: 'night_closed' } }); h.from.mockReturnValue(c.proxy)
    await expect(api.upsertLog(logOf())).rejects.toMatchObject({ code: 'night_closed', refused: true, reason: 'night_closed' })
    h.rpc.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(api.fetchNights('2026-10-01', '2026-10-05')).rejects.toMatchObject({ code: 'network', refused: false })
  })

  it('maps errors to the codes the screens show', () => {
    expect(api.toSleepError({ code: '23514', message: 'new row violates check constraint "sleep_logs_check"' })).toBe('invalid_duration')
    expect(api.toSleepError({ code: 'P0001', message: 'night_closed' })).toBe('night_closed')
    expect(api.toSleepError({ code: 'P0001', message: 'item_immutable' })).toBe('refused')
    expect(api.toSleepError({ code: '22P02', message: 'bad date' })).toBe('refused')
    expect(api.toSleepError(new TypeError('Failed to fetch'))).toBe('network')
    expect(api.toSleepError({ code: '42501', message: 'permission denied' })).toBe('network')
  })
})
