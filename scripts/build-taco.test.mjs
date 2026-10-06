import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  parseCsv, parseCell, buildItems, kcalDeviation, build,
  POF_LABEL, MEASURE_EXCLUSIONS, parsePofCsv, buildMeasures, selectMeasures
} from './build-taco.mjs'

const FIX = new URL('./data/__fixtures__/taco-sample.csv', import.meta.url).pathname
const REAL_CSV = new URL('./data/taco-4ed.csv', import.meta.url).pathname
const OUT = new URL('../src/features/nutrition/data/taco.json', import.meta.url).pathname
const MAP = new URL('./data/taco-pof-map.csv', import.meta.url).pathname
const POF = new URL('./data/pof-medidas.csv', import.meta.url).pathname
const MEASURES_OUT = new URL('../src/features/nutrition/data/taco-measures.json', import.meta.url).pathname

describe('build-taco', () => {
  it('parses quoted fields with commas', () => {
    const rows = parseCsv(readFileSync(FIX, 'utf8'))
    expect(rows).toHaveLength(6)
    expect(rows[0].nome).toBe('Arroz, tipo 1, cozido')
  })

  it('maps Tr to 0 and NA, * and empty to null', () => {
    expect(parseCell('Tr')).toBe(0)
    expect(parseCell('NA')).toBeNull()
    expect(parseCell('*')).toBeNull()
    expect(parseCell('')).toBeNull()
    expect(parseCell('12,5')).toBe(12.5)
  })

  it('builds FoodItem rows with 0 macros and null fiber for missing values', () => {
    const items = buildItems(parseCsv(readFileSync(FIX, 'utf8')))
    expect(items[0]).toEqual({
      source: 'taco', source_id: '1', name: 'Arroz, tipo 1, cozido', brand: null,
      per100: { kcal: 128, protein: 2.5, carbs: 28.1, fat: 0.2, fiber: 1.6 },
      serving_g: null, serving_label: null, barcode: null
    })
    const cafe = items[2]
    expect(cafe.per100.fat).toBe(0)
    expect(cafe.per100.fiber).toBeNull()
    expect(items[4].per100.fiber).toBeNull()
  })

  it('checks kcal against 4P + 4C + 9F with 15% or 15 kcal tolerance', () => {
    const items = buildItems(parseCsv(readFileSync(FIX, 'utf8')))
    const bad = items.filter((i) => !kcalDeviation(i.per100).ok).map((i) => i.name)
    expect(bad).toEqual(['Item com kcal fora'])
    expect(kcalDeviation({ kcal: 9, protein: 0.7, carbs: 1.5, fat: 0, fiber: null }).ok).toBe(true)
  })

  it('build() writes json and throws on kcal outliers not in the exceptions list', () => {
    const dir = mkdtempSync(join(tmpdir(), 'taco-'))
    const out = join(dir, 'taco.json')
    expect(() => build({ csvPath: FIX, outPath: out })).toThrow(/Item com kcal fora/)
    expect(existsSync(out)).toBe(false)
    const ok = join(dir, 'ok.csv')
    writeFileSync(ok, readFileSync(FIX, 'utf8').split('\n').filter((l) => !l.includes('fora')).join('\n'))
    build({ csvPath: ok, outPath: out })
    expect(JSON.parse(readFileSync(out, 'utf8'))).toHaveLength(5)
  })

  it('exits non-zero naming the CSV when it is missing, without touching taco.json', () => {
    const before = readFileSync(OUT, 'utf8')
    const r = spawnSync('node', ['scripts/build-taco.mjs', '--csv', '/nonexistent/taco-4ed.csv'], { encoding: 'utf8', cwd: new URL('..', import.meta.url).pathname })
    expect(r.status).not.toBe(0)
    expect(r.stderr).toMatch(/taco-4ed\.csv/)
    expect(r.stderr).toMatch(/NEPA/)
    expect(readFileSync(OUT, 'utf8')).toBe(before)
  })

  it.skipIf(!existsSync(REAL_CSV))('generates between 550 and 650 items from the real CSV', () => {
    const dir = mkdtempSync(join(tmpdir(), 'taco-'))
    const out = join(dir, 'taco.json')
    build({ csvPath: REAL_CSV, outPath: out })
    const n = JSON.parse(readFileSync(out, 'utf8')).length
    expect(n).toBeGreaterThanOrEqual(550)
    expect(n).toBeLessThanOrEqual(650)
  })

  it.skipIf(!existsSync(REAL_CSV))('regenerates taco.json byte for byte from the real CSV', () => {
    const dir = mkdtempSync(join(tmpdir(), 'taco-'))
    const out = join(dir, 'taco.json')
    build({ csvPath: REAL_CSV, outPath: out })
    expect(readFileSync(out, 'utf8')).toBe(readFileSync(OUT, 'utf8'))
  })
})

const POF_HEAD = 'codigo_alimento,descricao_alimento,codigo_preparacao,descricao_preparacao,codigo_medida,descricao_medida,codigo_medida_referencia,descricao_medida_referencia,quantidade_g,codigo_fonte,descricao_fonte'
const pofRow = (food, prep, medida, g, fonte = `X - ${medida.toLowerCase()} cheia`) =>
  `${food},"ALIMENTO ${food}",${prep},PREP,1,${medida},1.0,${medida},${g},1.0,${fonte}`
const items = (...ids) => ids.map((id) => ({ source_id: String(id), name: `Item ${id}` }))

describe('POF household measures', () => {
  it('translates the POF labels named in the plan and nothing else implicitly', () => {
    expect(POF_LABEL['COLHER DE ARROZ/SERVIR']).toBe('colher de servir')
    expect(POF_LABEL.CONCHA).toBe('concha')
    expect(POF_LABEL['XICARA DE CHA']).toBe('xícara')
    expect(POF_LABEL.UNIDADE).toBe('unidade')
    expect(POF_LABEL.FATIA).toBe('fatia')
    expect(POF_LABEL['COLHER DE SOPA']).toBe('colher de sopa')
    expect(POF_LABEL['COLHER DE CHA']).toBe('colher de chá')
    expect(POF_LABEL.ESCUMADEIRA).toBe('escumadeira')
    expect(POF_LABEL['COPO AMERICANO']).toBe('copo americano')
    expect(POF_LABEL.PEDACO).toBe('pedaço')
    for (const k of ['GRAMA', 'QUILO', 'PORCAO', 'PRATO FUNDO', 'LATA (350 ML)', 'GARRAFA (N. E.)']) {
      expect(POF_LABEL[k]).toBeUndefined()
    }
    for (const label of Object.values(POF_LABEL)) {
      expect(label).toBe(label.toLowerCase())
      expect(label).not.toMatch(/\./)
    }
  })

  it('skips the provenance header of the POF copy', () => {
    const rows = parsePofCsv(`# Fonte: IBGE\n# Cópia: x\n${POF_HEAD}\n${pofRow(10, 99, 'CONCHA', 100)}\n`)
    expect(rows).toHaveLength(1)
    expect(rows[0].descricao_medida).toBe('CONCHA')
    expect(rows[0].quantidade_g).toBe('100')
  })

  it('keeps translated measures, at most 6, smallest first, without plate-based imputations', () => {
    const pof = parsePofCsv([POF_HEAD,
      pofRow(10, 99, 'GRAMA', 1),
      pofRow(10, 99, 'COLHER DE SOPA', 25),
      pofRow(10, 99, 'COLHER DE ARROZ/SERVIR', 45),
      pofRow(10, 99, 'CONCHA', 100),
      pofRow(10, 99, 'ESCUMADEIRA', 85),
      pofRow(10, 99, 'XICARA DE CHA', 100, 'Arroz - prato fundo raso'),
      pofRow(10, 99, 'COLHER DE SOBREMESA', 12.5),
      pofRow(10, 99, 'COLHER DE CHA', 6.3),
      pofRow(10, 99, 'COLHER DE CAFE', 3.1),
      pofRow(10, 99, 'COPO AMERICANO', 160),
      pofRow(10, 2, 'UNIDADE', 50)
    ].join('\n'))
    const { measures: out } = buildMeasures(items(3), [{ taco_id: '3', pof_codigo_alimento: '10', pof_codigo_preparacao: '99', nota: '' }], pof)
    expect(Object.keys(out)).toEqual(['3'])
    const labels = out['3'].map((m) => m.label)
    expect(out['3']).toHaveLength(6)
    expect(labels).not.toContain('xícara')
    expect(labels).not.toContain('unidade')
    expect(labels).toContain('colher de servir')
    expect(labels).not.toContain('colher de chá') // lowest priority, beyond the 6 kept
    expect(new Set(labels).size).toBe(labels.length)
    const grams = out['3'].map((m) => m.grams)
    expect(grams).toEqual([...grams].sort((a, b) => a - b))
    expect(out['3'][0]).toEqual({ label: 'colher de sobremesa', grams: 12.5 })
  })

  it('drops utensil weights the POF copied from another utensil, keeps explicit fractions', () => {
    const pof = parsePofCsv([POF_HEAD,
      pofRow(10, 99, 'CONCHA', 140, 'Feijão branco cozido - concha média cheia'),
      pofRow(10, 99, 'XICARA DE CHA', 140, 'Feijão branco cozido - concha média cheia'),
      pofRow(10, 99, 'ESCUMADEIRA', 35, 'Feijão branco cozido - colher de arroz cheia'),
      pofRow(10, 99, 'COLHER DE ARROZ/SERVIR', 35, 'Feijão branco cozido - colher de arroz cheia'),
      pofRow(10, 99, 'COLHER DE CHA', 4.3, 'Feijão branco cozido - 1/4 colher de sopa cheia'),
      pofRow(10, 99, 'UNIDADE', 30, 'Bolo - fatia média')
    ].join('\n'))
    expect(selectMeasures(pof).kept).toEqual([
      { label: 'colher de chá', grams: 4.3 },
      { label: 'unidade', grams: 30 },
      { label: 'colher de servir', grams: 35 },
      { label: 'concha', grams: 140 }
    ])
  })

  it('drops utensils scaled from a non-utensil and powder amounts for a drink', () => {
    const pof = parsePofCsv([POF_HEAD,
      pofRow(10, 99, 'COLHER DE ARROZ/SERVIR', 44, 'Manga hadden - 2 fatias'),
      pofRow(10, 99, 'COLHER DE SOPA', 22, 'Manga hadden - fatia'),
      pofRow(10, 99, 'CONCHA', 140, 'Mamão papaya - 2 colheres de arroz cheia'),
      pofRow(10, 99, 'COPO AMERICANO', 150, 'Diluição para o preparo de 1 copo americano'),
      pofRow(10, 99, 'FATIA', 22, 'Manga hadden - fatia')
    ].join('\n'))
    expect(selectMeasures(pof).kept).toEqual([{ label: 'fatia', grams: 22 }, { label: 'concha', grams: 140 }])
  })

  it('leaves out the measures listed in MEASURE_EXCLUSIONS for a TACO id', () => {
    const pof = parsePofCsv([POF_HEAD,
      pofRow(10, 99, 'UNIDADE', 180, 'Laranja - unidade média'),
      pofRow(10, 99, 'COPO AMERICANO', 150, 'Copo americano')
    ].join('\n'))
    const map = [{ taco_id: '214', pof_codigo_alimento: '10', pof_codigo_preparacao: '99', nota: '' }]
    expect(buildMeasures(items(214), map, pof, {}).measures['214']).toHaveLength(2)
    expect(buildMeasures(items(214), map, pof, { 214: ['copo americano'] }).measures['214']).toEqual([{ label: 'unidade', grams: 180 }])
    for (const [id, labels] of Object.entries(MEASURE_EXCLUSIONS)) {
      for (const l of labels) expect(Object.values(POF_LABEL), `${id} ${l}`).toContain(l)
    }
  })

  it('reads only the measure part of the POF source, after the food name', () => {
    const pof = parsePofCsv([POF_HEAD,
      pofRow(10, 99, 'FATIA', 20, 'Queijo prato - fatia média'),
      pofRow(10, 99, 'COLHER DE SOPA', 15, 'Queijo prato derretido - colher de sopa cheia'),
      pofRow(10, 99, 'XICARA DE CHA', 100, 'Colher de chá de queijo - prato fundo raso')
    ].join('\n'))
    expect(selectMeasures(pof).kept).toEqual([{ label: 'colher de sopa', grams: 15 }, { label: 'fatia', grams: 20 }])
  })

  it('keeps one label per weight, preferring the one its POF source names, then the named cut', () => {
    const pof = parsePofCsv([POF_HEAD,
      pofRow(10, 3, 'UNIDADE', 180, 'Frango - peito médio'),
      pofRow(10, 3, 'FATIA', 180, 'Frango - peito médio'),
      pofRow(10, 3, 'PEDACO', 180, 'Frango - peito médio'),
      pofRow(10, 3, 'PEITO', 180, 'Frango - peito médio'),
      pofRow(10, 3, 'FILE', 100, 'Frango - filé médio'),
      pofRow(10, 3, 'BIFE', 100, 'Frango - filé médio')
    ].join('\n'))
    expect(selectMeasures(pof).kept).toEqual([{ label: 'filé', grams: 100 }, { label: 'peito', grams: 180 }])
    const fish = parsePofCsv([POF_HEAD,
      pofRow(10, 3, 'BIFE', 120, 'Peixe cozido - filé médio'),
      pofRow(10, 3, 'FILE', 120, 'Peixe cozido - filé médio'),
      pofRow(11, 3, 'BIFE', 100, 'Carne - bife médio'),
      pofRow(11, 3, 'FILE', 100, 'Carne - unidade média')
    ].join('\n'))
    expect(selectMeasures(fish.filter((r) => r.codigo_alimento === '10')).kept).toEqual([{ label: 'filé', grams: 120 }])
    expect(selectMeasures(fish.filter((r) => r.codigo_alimento === '11')).kept).toEqual([{ label: 'bife', grams: 100 }])
  })

  it('leaves implausible weights out and reports them', () => {
    const pof = parsePofCsv([POF_HEAD,
      pofRow(10, 99, 'UNIDADE', 50), pofRow(10, 99, 'FATIA', 900), pofRow(10, 99, 'COLHER DE SOPA', 1)
    ].join('\n'))
    const { measures, dropped } = buildMeasures(items(235), [{ taco_id: '235', pof_codigo_alimento: '10', pof_codigo_preparacao: '99', nota: '' }], pof)
    expect(measures['235']).toEqual([{ label: 'unidade', grams: 50 }])
    expect(dropped).toEqual([
      { taco_id: '235', label: 'fatia', grams: 900 },
      { taco_id: '235', label: 'colher de sopa', grams: 1 }
    ])
  })

  it('fails on unknown or repeated TACO ids, missing POF pairs and pairs left without measures', () => {
    const pof = parsePofCsv([POF_HEAD, pofRow(10, 99, 'CONCHA', 100), pofRow(11, 99, 'CONCHA', 5)].join('\n'))
    const row = (taco_id, food = '10') => ({ taco_id, pof_codigo_alimento: food, pof_codigo_preparacao: '99', nota: '' })
    expect(() => buildMeasures(items(1), [row('2')], pof)).toThrow(/2/)
    expect(() => buildMeasures(items(1, 2), [row('1'), row('1')], pof)).toThrow(/1/)
    expect(() => buildMeasures(items(1), [row('1', '12')], pof)).toThrow(/12/)
    expect(() => buildMeasures(items(1), [row('1', '11')], pof)).toThrow(/concha/)
  })
})

const read = (p) => readFileSync(p, 'utf8')
const between = (g, [min, max]) => g >= min && g <= max
const RANGES = [
  [/^colher de servir$/, [10, 120]],
  [/^colher (?!de servir$)/, [2, 60]],
  [/^concha$/, [50, 250]],
  [/^escumadeira$/, [30, 250]],
  [/^xícara$/, [50, 300]],
  [/^copo americano$/, [100, 250]],
  [/^fatia$/, [5, 200]]
]
const FRUIT = (id) => Number(id) >= 163 && Number(id) <= 258 // TACO "Frutas e derivados"

describe.skipIf(!existsSync(REAL_CSV))('taco-measures.json from the curated map', () => {
  const tacoById = new Map(JSON.parse(read(OUT)).map((i) => [i.source_id, i]))
  const map = existsSync(MAP) ? parseCsv(read(MAP)) : []
  const measures = existsSync(MEASURES_OUT) ? JSON.parse(read(MEASURES_OUT)) : {}

  it('maps around 100 foods, each TACO id once and existing in TACO', () => {
    expect(map.length).toBeGreaterThanOrEqual(80)
    expect(map.length).toBeLessThanOrEqual(130)
    const ids = map.map((r) => r.taco_id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(tacoById.has(id), `taco_id ${id}`).toBe(true)
    for (const r of map) expect(Object.keys(r)).toEqual(['taco_id', 'pof_codigo_alimento', 'pof_codigo_preparacao', 'nota'])
  })

  it('is what build-taco generates from the map (committed file is fresh)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'taco-'))
    const out = join(dir, 'm.json')
    build({ csvPath: REAL_CSV, outPath: join(dir, 't.json'), mapPath: MAP, pofPath: POF, measuresOutPath: out })
    expect(read(out)).toBe(read(MEASURES_OUT))
  })

  it('has 1 to 6 measures per mapped food, smallest first, labels unique and from POF_LABEL', () => {
    const labels = new Set(Object.values(POF_LABEL))
    expect(Object.keys(measures).sort()).toEqual(map.map((r) => r.taco_id).sort())
    for (const [id, list] of Object.entries(measures)) {
      expect(list.length, id).toBeGreaterThanOrEqual(1)
      expect(list.length, id).toBeLessThanOrEqual(6)
      const names = list.map((m) => m.label)
      expect(new Set(names).size, id).toBe(names.length)
      for (const m of list) expect(labels.has(m.label), `${id} ${m.label}`).toBe(true)
      const grams = list.map((m) => m.grams)
      expect(grams, id).toEqual([...grams].sort((a, b) => a - b))
    }
  })

  it('keeps grams within plausible ranges per kind of measure', () => {
    expect(Object.keys(measures).length).toBeGreaterThan(0)
    const bad = []
    for (const [id, list] of Object.entries(measures)) {
      for (const { label, grams } of list) {
        const name = `${id} ${tacoById.get(id)?.name}: ${label} ${grams} g`
        if (!(grams > 0 && grams <= 2000)) bad.push(name)
        for (const [re, range] of RANGES) if (re.test(label) && !between(grams, range)) bad.push(name)
        if (label === 'unidade' && FRUIT(id) && !between(grams, [5, 2000])) bad.push(name)
      }
    }
    expect(bad).toEqual([])
  })

  it('offers a serving spoon for cooked rice and a ladle for cooked beans', () => {
    expect(measures['3']?.map((m) => m.label)).toContain('colher de servir') // Arroz, tipo 1, cozido
    expect(measures['561']?.map((m) => m.label)).toContain('concha') // Feijão, carioca, cozido
    expect(measures['567']?.map((m) => m.label)).toContain('concha') // Feijão, preto, cozido
  })
})

