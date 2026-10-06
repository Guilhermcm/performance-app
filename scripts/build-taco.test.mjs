import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parseCsv, parseCell, buildItems, kcalDeviation, build } from './build-taco.mjs'

const FIX = new URL('./data/__fixtures__/taco-sample.csv', import.meta.url).pathname
const REAL_CSV = new URL('./data/taco-4ed.csv', import.meta.url).pathname
const OUT = new URL('../src/features/nutrition/data/taco.json', import.meta.url).pathname

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

  // Blocker in the ledger: the official TACO spreadsheet could not be downloaded in the build
  // environment, so scripts/data/taco-4ed.csv does not exist yet.
  it.skipIf(!existsSync(REAL_CSV))('generates between 550 and 650 items from the real CSV', () => {
    const dir = mkdtempSync(join(tmpdir(), 'taco-'))
    const out = join(dir, 'taco.json')
    build({ csvPath: REAL_CSV, outPath: out })
    const n = JSON.parse(readFileSync(out, 'utf8')).length
    expect(n).toBeGreaterThanOrEqual(550)
    expect(n).toBeLessThanOrEqual(650)
  })
})
