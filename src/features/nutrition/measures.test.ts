import { describe, it, expect } from 'vitest'
import { foodKey, mergeMeasures, loadSuggested, measureKey, pluralPt, countedMeasure } from './measures'
import { foodOf, itemOf, logOf, measureOf } from './test-nutrition'

describe('foodKey', () => {
  it('uses the TACO id and the OFF barcode', () => {
    expect(foodKey(itemOf({ source: 'taco', source_id: '123' }))).toBe('taco:123')
    expect(foodKey(itemOf({ source: 'off', source_id: '7891000100103' }))).toBe('off:7891000100103')
  })

  it('uses the user_foods id for a custom food, never its name', () => {
    expect(foodKey(foodOf({ id: 'a1b2-c3', source: 'custom', source_id: null }))).toBe('custom:a1b2-c3')
    expect(foodKey(itemOf({ source: 'custom', source_id: null }))).toBeNull()
  })

  it('keys a saved TACO or OFF food by the source id, not by the row id', () => {
    expect(foodKey(foodOf({ id: 'row-1', source: 'taco', source_id: '9' }))).toBe('taco:9')
    expect(foodKey(foodOf({ id: 'row-2', source: 'off', source_id: '789' }))).toBe('off:789')
  })

  it('keys a log by its source id, and never by the log id', () => {
    expect(foodKey(logOf({ id: 'log-x', source: 'taco', source_id: '5' }))).toBe('taco:5')
    expect(foodKey(logOf({ id: 'log-x', source: 'custom', source_id: null }))).toBeNull()
  })

  it('is null for quick entries, imports and items without a stable id', () => {
    expect(foodKey(logOf({ source: 'quick', source_id: null }))).toBeNull()
    expect(foodKey(logOf({ source: 'quick', source_id: '3' }))).toBeNull()
    expect(foodKey(logOf({ source: 'import', source_id: '3' }))).toBeNull()
    expect(foodKey(itemOf({ source: 'taco', source_id: null }))).toBeNull()
    expect(foodKey(itemOf({ source: 'off', source_id: '' }))).toBeNull()
  })

  it('is null when the id would not pass the server check', () => {
    expect(foodKey(itemOf({ source: 'off', source_id: 'a b' }))).toBeNull()
    expect(foodKey(itemOf({ source: 'off', source_id: 'x'.repeat(65) }))).toBeNull()
    expect(foodKey(itemOf({ source: 'taco', source_id: 'a:b' }))).toBeNull()
    expect(foodKey(foodOf({ id: 'bad id', source: 'custom', source_id: null }))).toBeNull()
  })
})

describe('mergeMeasures', () => {
  const sug = [{ label: 'colher de sopa', grams: 20 }, { label: 'concha', grams: 117 }]

  it('orders personal, suggested, label serving, last time', () => {
    const personal = [measureOf({ id: 'p1', label: 'prato', grams: 300 })]
    const item = itemOf({ serving_g: 50, serving_label: '1 fatia' })
    const out = mergeMeasures(personal, sug, item)
    expect(out.map(o => [o.kind, o.label, o.grams])).toEqual([
      ['personal', 'prato', 300], ['suggested', 'colher de sopa', 20], ['suggested', 'concha', 117], ['serving', '1 fatia', 50]
    ])
    expect(out[0].id).toBe('p1')
  })

  it('puts the last amount after the label serving', () => {
    const last = mergeMeasures([], sug, itemOf({ serving_g: 180, recent: true }))
    expect(last.map(o => o.kind)).toEqual(['suggested', 'suggested', 'last'])
    expect(last[2].grams).toBe(180)
    const both = mergeMeasures([measureOf({ id: 'p' })], [], itemOf({ serving_g: 180, serving_label: 'x', recent: true }))
    // a recent's serving_g is the amount logged, not the label serving
    expect(both.map(o => o.kind)).toEqual(['personal', 'last'])
  })

  it('hides a suggested measure whose label a personal one repeats', () => {
    const personal = [measureOf({ id: 'p', label: ' Concha ', grams: 90 })]
    const out = mergeMeasures(personal, sug, itemOf())
    expect(out.map(o => [o.kind, o.label])).toEqual([['personal', ' Concha '], ['suggested', 'colher de sopa']])
  })

  it('offers nothing it has no grams for', () => {
    expect(mergeMeasures([], [], itemOf())).toEqual([])
    expect(mergeMeasures([], [], itemOf({ serving_g: 0, serving_label: 'x' }))).toEqual([])
    expect(mergeMeasures([], [], itemOf({ serving_g: 50, serving_label: null }))).toEqual([])
  })
})

describe('loadSuggested', () => {
  it('loads the bundled map by TACO id and is memoized', async () => {
    const a = await loadSuggested()
    expect(a['1'].length).toBeGreaterThan(0)
    expect(a['1'][0]).toEqual({ label: expect.any(String), grams: expect.any(Number) })
    expect(await loadSuggested()).toBe(a)
  })
})

describe('measureKey', () => {
  it('is the foodKey when the item has one', () => {
    expect(measureKey(itemOf({ source: 'taco', source_id: '3' }), [])).toBe('taco:3')
    expect(measureKey(foodOf({ id: 'f-1', source: 'custom', source_id: null }), [])).toBe('custom:f-1')
  })

  it('finds the saved custom food behind a recent or a logged item', () => {
    const saved = foodOf({ id: 'f-9', source: 'custom', source_id: null, name: 'Bolo da vó', brand: null })
    const other = foodOf({ id: 'f-8', source: 'custom', source_id: null, name: 'Bolo', brand: 'Padaria' })
    const recent = itemOf({ source: 'custom', source_id: null, name: ' bolo da Vó ', brand: null, recent: true })
    expect(measureKey(recent, [other, saved])).toBe('custom:f-9')
  })

  it('is null for a custom food that is not saved, and never borrows a TACO or OFF row', () => {
    const custom = itemOf({ source: 'custom', source_id: null, name: 'Bolo da vó' })
    expect(measureKey(custom, [])).toBeNull()
    expect(measureKey(custom, [foodOf({ id: 'f-1', source: 'taco', source_id: null, name: 'Bolo da vó' })])).toBeNull()
    expect(measureKey(itemOf({ source: 'taco', source_id: null }), [foodOf({ id: 'f-2', source: 'taco', source_id: null })])).toBeNull()
  })
})

describe('pluralPt', () => {
  it('pluralizes the words before the first preposition, the way the POF labels need', () => {
    const cases: [string, string][] = [
      ['colher de servir', 'colheres de servir'], ['colher de chá', 'colheres de chá'], ['concha', 'conchas'],
      ['escumadeira', 'escumadeiras'], ['xícara', 'xícaras'], ['unidade pequena', 'unidades pequenas'],
      ['copo americano', 'copos americanos'], ['copo de requeijão', 'copos de requeijão'], ['filé', 'filés'],
      ['pedaço', 'pedaços'], ['pão', 'pães'], ['porção', 'porções'], ['pote', 'potes'], ['potinho', 'potinhos'],
      ['bombom', 'bombons'], ['pastel', 'pastéis'], ['barril', 'barris'], ['lápis', 'lápis'], ['200 ml', '200 ml'],
    ]
    for (const [one, many] of cases) expect(pluralPt(one), one).toBe(many)
  })
})

describe('countedMeasure', () => {
  it('reads in Portuguese, singular below 2', () => {
    expect(countedMeasure(2, 'colher de servir', true)).toBe('2 colheres de servir')
    expect(countedMeasure(1, 'concha', true)).toBe('1 concha')
    expect(countedMeasure(1.5, 'concha', true)).toBe('1.5 concha')
    expect(countedMeasure(0.5, 'concha', true)).toBe('0.5 concha')
  })

  it('multiplies a label it cannot inflect', () => {
    expect(countedMeasure(2, 'scoop', false)).toBe('2 × scoop')
  })
})
