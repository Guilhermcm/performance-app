import { describe, it, expect } from 'vitest'
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
