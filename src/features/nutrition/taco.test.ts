import { describe, it, expect } from 'vitest'
import { loadTaco } from './taco'

describe('loadTaco', () => {
  it('resolves to an array and is memoized', async () => {
    const a = await loadTaco()
    expect(Array.isArray(a)).toBe(true)
    expect(await loadTaco()).toBe(a)
  })
})
