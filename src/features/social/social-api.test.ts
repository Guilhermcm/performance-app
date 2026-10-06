import { readFileSync, readdirSync } from 'node:fs'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: h.rpc, from: h.from } }))

import * as api from './social-api'

// A stand-in for supabase.from(...): each call is recorded and returns the chain; awaiting the
// chain gives `result`.
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

describe('social api', () => {
  it('calls each RPC with its arguments', async () => {
    h.rpc.mockResolvedValue({ data: { friend: { id: 'a', name: 'Ana', avatar_url: null } }, error: null })
    await expect(api.acceptInvite('AbCdEfGh12')).resolves.toEqual({ id: 'a', name: 'Ana', avatar_url: null })
    expect(h.rpc).toHaveBeenLastCalledWith('accept_invite', { p_code: 'AbCdEfGh12' })

    h.rpc.mockResolvedValue({ data: { id: 'c9' }, error: null })
    await expect(api.createChallenge({
      template: 'volume_total', title: 'Toneladas', mode: 'team', target: 20,
      starts_on: '2026-10-05', ends_on: '2026-11-03', invitees: ['b'], share_volume: true, share_nutrition: false
    })).resolves.toBe('c9')
    expect(h.rpc).toHaveBeenLastCalledWith('create_challenge', {
      p_template: 'volume_total', p_title: 'Toneladas', p_mode: 'team', p_target: 20,
      p_starts_on: '2026-10-05', p_ends_on: '2026-11-03', p_invitees: ['b'], p_share_volume: true,
      p_share_nutrition: false
    })
    await api.createChallenge({
      template: 'nutrition_days_on_target', title: 'No alvo', mode: 'solo', target: 20,
      starts_on: '2026-10-05', ends_on: '2026-11-03', invitees: ['b'], share_volume: false, share_nutrition: true
    })
    expect(h.rpc).toHaveBeenLastCalledWith('create_challenge', expect.objectContaining({
      p_template: 'nutrition_days_on_target', p_share_volume: false, p_share_nutrition: true
    }))

    h.rpc.mockResolvedValue({ data: null, error: null })
    await api.joinChallenge('c9', { shareVolume: true })
    expect(h.rpc).toHaveBeenLastCalledWith('join_challenge', { p_id: 'c9', p_share_volume: true, p_share_nutrition: false })
    await api.joinChallenge('c9', { shareNutrition: true })
    expect(h.rpc).toHaveBeenLastCalledWith('join_challenge', { p_id: 'c9', p_share_volume: false, p_share_nutrition: true })
    await api.joinChallenge('c9')
    expect(h.rpc).toHaveBeenLastCalledWith('join_challenge', { p_id: 'c9', p_share_volume: false, p_share_nutrition: false })
    await api.leaveChallenge('c9')
    expect(h.rpc).toHaveBeenLastCalledWith('leave_challenge', { p_id: 'c9' })

    h.rpc.mockResolvedValue({ data: { items: [], next: null }, error: null })
    await api.getFeed()
    expect(h.rpc).toHaveBeenLastCalledWith('get_feed', {})
    await api.getFeed({ before: '2026-10-07T18:30:00+00:00', before_id: 41 })
    expect(h.rpc).toHaveBeenLastCalledWith('get_feed', { p_before: '2026-10-07T18:30:00+00:00', p_before_id: 41 })

    for (const [fn, name] of [[api.getFriends, 'get_friends'], [api.getWeeklyLeaderboard, 'get_weekly_leaderboard'],
      [api.getAlltimeLeaderboard, 'get_alltime_leaderboard'], [api.getChallenges, 'get_challenges'], [api.createInvite, 'create_invite']] as const) {
      await fn()
      expect(h.rpc).toHaveBeenLastCalledWith(name, {})
    }
    await api.getInvite('AbCdEfGh12')
    expect(h.rpc).toHaveBeenLastCalledWith('get_invite', { p_code: 'AbCdEfGh12' })
  })

  it('turns server errors into typed codes and the rest into network', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'invite_expired' } })
    await expect(api.acceptInvite('AbCdEfGh12')).rejects.toMatchObject({ name: 'SocialError', code: 'invite_expired' })
    h.rpc.mockResolvedValue({ data: null, error: { message: 'nutrition_opt_in_required' } })
    await expect(api.joinChallenge('c9', { shareNutrition: false })).rejects.toMatchObject({ code: 'nutrition_opt_in_required' })
    h.rpc.mockResolvedValue({ data: null, error: { message: 'nutrition_off' } })
    await expect(api.joinChallenge('c9', { shareNutrition: true })).rejects.toMatchObject({ code: 'nutrition_off' })
    h.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    await expect(api.getFriends()).rejects.toMatchObject({ code: 'network' })
    h.rpc.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(api.getFriends()).rejects.toMatchObject({ code: 'network' })
  })

  it('lists my open invites, newest first', async () => {
    const c = chain({ data: [{ code: 'AbCdEfGh12', created_at: 'x', expires_at: 'y' }], error: null })
    h.from.mockReturnValue(c.proxy)
    const now = new Date('2026-10-07T12:00:00Z')
    await expect(api.listMyInvites(now)).resolves.toEqual([{ code: 'AbCdEfGh12', created_at: 'x', expires_at: 'y' }])
    expect(h.from).toHaveBeenCalledWith('friend_invites')
    expect(c.calls).toEqual([
      ['select', ['code, created_at, expires_at']],
      ['is', ['used_at', null]],
      ['gt', ['expires_at', '2026-10-07T12:00:00.000Z']],
      ['order', ['created_at', { ascending: false }]]
    ])
  })

  it('cancels an invite and removes a friendship by its ordered pair', async () => {
    const a = chain({ error: null })
    h.from.mockReturnValue(a.proxy)
    await api.cancelInvite('AbCdEfGh12')
    expect(a.calls).toEqual([['delete', []], ['eq', ['code', 'AbCdEfGh12']]])
    const b = chain({ error: null })
    h.from.mockReturnValue(b.proxy)
    await api.removeFriend('0000000b-0000-0000-0000-000000000000', '0000000a-0000-0000-0000-000000000000')
    expect(h.from).toHaveBeenLastCalledWith('friendships')
    expect(b.calls).toEqual([
      ['delete', []],
      ['eq', ['user_a', '0000000a-0000-0000-0000-000000000000']],
      ['eq', ['user_b', '0000000b-0000-0000-0000-000000000000']]
    ])
  })
})

// The newest definition of a function in supabase/migrations, as its parameter names. A client that
// names every parameter keeps working while the old and the new signature coexist during a deploy
// (Review Focus 5), and a renamed parameter fails here instead of in production.
const MIGRATIONS = new URL('../../../supabase/migrations/', import.meta.url)
function sqlParams(fn: string): string[] {
  const head = new RegExp(`create (?:or replace )?function public\\.${fn}\\(([^)]*)\\)`, 'g')
  let params: string[] | null = null
  for (const file of readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort()) {
    for (const m of readFileSync(new URL(file, MIGRATIONS), 'utf8').matchAll(head)) {
      params = m[1].split(',').map(p => p.trim().split(/\s+/)[0]).filter(Boolean)
    }
  }
  if (!params) throw new Error('no definition of ' + fn)
  return params
}

describe('challenge RPCs against the migrations', () => {
  it('names every parameter of create_challenge and join_challenge', async () => {
    h.rpc.mockResolvedValue({ data: { id: 'c9' }, error: null })
    await api.createChallenge({
      template: 'nutrition_days_on_target', title: 'No alvo', mode: 'team', target: 5,
      starts_on: '2026-10-05', ends_on: '2026-10-11', invitees: ['b'], share_volume: false, share_nutrition: true
    })
    expect(Object.keys(h.rpc.mock.lastCall![1]).sort()).toEqual(sqlParams('create_challenge').sort())
    h.rpc.mockResolvedValue({ data: null, error: null })
    await api.joinChallenge('c9', { shareNutrition: true })
    expect(Object.keys(h.rpc.mock.lastCall![1]).sort()).toEqual(sqlParams('join_challenge').sort())
  })

  it('leaves the feed and the friend card without nutrition', () => {
    // 0015 brings the nutrition challenge and nothing else to what friends see of each other.
    const nutrition = readFileSync(new URL('0015_nutrition_challenge.sql', MIGRATIONS), 'utf8')
    for (const fn of ['get_feed', 'get_friends', 'progress_card']) expect(nutrition).not.toContain('public.' + fn)
    for (const file of ['FeedPanel.tsx', 'FriendsPanel.tsx']) {
      expect(readFileSync(new URL('./' + file, import.meta.url), 'utf8'), file).not.toMatch(/nutrition/i)
    }
  })
})
