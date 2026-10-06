import { describe, it, expect, vi } from 'vitest'
import { loadTaco, loadTacoMeasures } from './taco'

describe('loadTaco', () => {
  it('resolves to an array and is memoized', async () => {
    const a = await loadTaco()
    expect(Array.isArray(a)).toBe(true)
    expect(await loadTaco()).toBe(a)
  })
})

describe('loadTacoMeasures', () => {
  it('resolves to the suggested measures by taco id and is memoized', async () => {
    const m = await loadTacoMeasures()
    const ids = new Set((await loadTaco()).map(f => f.source_id))
    expect(Object.keys(m).length).toBeGreaterThan(0)
    for (const id of Object.keys(m)) expect(ids.has(id)).toBe(true)
    expect(await loadTacoMeasures()).toBe(m)
  })
})

describe('a failed load', () => {
  it('is not remembered: the next call tries again', async () => {
    vi.resetModules()
    let fail = true
    vi.doMock('./data/taco-measures.json', () => {
      if (fail) throw new Error('chunk failed to load')
      return { default: { '3': [{ label: 'concha', grams: 100 }] } }
    })
    try {
      const fresh = await import('./taco')
      await expect(fresh.loadTacoMeasures()).rejects.toThrow()
      fail = false
      expect(await fresh.loadTacoMeasures()).toEqual({ '3': [{ label: 'concha', grams: 100 }] })
    } finally {
      vi.doUnmock('./data/taco-measures.json')
      vi.resetModules()
    }
  })
})
