// Builds src/features/nutrition/data/taco.json from scripts/data/taco-4ed.csv.
//
// Source: TACO, Tabela Brasileira de Composição de Alimentos, 4ª edição (NEPA/Unicamp).
// Get the official spreadsheet at https://www.nepa.unicamp.br/taco/ and convert it to CSV with the
// header: id,nome,energia_kcal,proteina_g,carboidrato_g,lipideos_g,fibra_g (values per 100 g,
// decimal point or comma). Provenance and terms: scripts/data/README.md and NOTICE.md.
//
// TACO legend handling:
//   "Tr" (traço)      -> 0
//   "NA" / "*" / ""   -> null for fiber, 0 for kcal and the macros
//
// Output rows are FoodItem objects (src/features/nutrition/types.ts) with per-100 g values.
// Sanity check: kcal must be within 15% or 15 kcal of 4P + 4C + 9F, otherwise the build fails,
// except for the ids listed in KCAL_EXCEPTIONS (document why next to each id).
//
// Usage: node scripts/build-taco.mjs [--csv path] [--out path]
// When the CSV is missing the script exits 1 and leaves taco.json untouched.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const DEFAULT_CSV = fileURLToPath(new URL('./data/taco-4ed.csv', import.meta.url))
const DEFAULT_OUT = fileURLToPath(new URL('../src/features/nutrition/data/taco.json', import.meta.url))

/** ids whose official kcal diverges from 4P + 4C + 9F (e.g. alcohol, polyols). */
export const KCAL_EXCEPTIONS = new Set([
  '114', // Coentro, folhas desidratadas: 37 g de fibra, que a TACO não conta como energia cheia
  '220', // Limão, tahiti, cru: carboidrato inclui 1,2 g de fibra e muito açúcar-ácido, kcal oficial menor
  '472', // Cana, aguardente 1: energia vem só do álcool, sem macros na tabela
  '474', // Cerveja, pilsen 2: parte da energia vem do álcool (7 kcal/g), que não está nas colunas
  '513', // Fermento em pó, químico: carboidrato é de sais e amido não digerível, kcal oficial metade do 4P+4C+9F
  '514', // Fermento biológico: 4,2 g de fibra e carboidrato de baixa digestibilidade
  '539', // Feijão tropeiro mineiro: preparação composta, kcal calculada por receita
  '540' // Feijoada: preparação composta, kcal calculada por receita (desvio de 16%)
])

export function parseCsv(text) {
  const rows = []
  let row = [], cell = '', q = false
  const s = text.replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (q) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') q = false
      else cell += c
    } else if (c === '"') q = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some((x) => x.trim() !== '')) rows.push(row)
      row = []
    } else cell += c
  }
  row.push(cell)
  if (row.some((x) => x.trim() !== '')) rows.push(row)
  const [head, ...body] = rows
  const keys = head.map((h) => h.trim())
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])))
}

/** number | 0 for "Tr" | null for NA, *, empty or unparsable. */
export function parseCell(v) {
  const s = String(v ?? '').trim()
  if (/^tr$/i.test(s)) return 0
  if (s === '' || s === '*' || /^na$/i.test(s)) return null
  const n = Number(s.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

export function buildItems(rows) {
  return rows.map((r) => ({
    source: 'taco',
    source_id: String(r.id),
    name: r.nome,
    brand: null,
    per100: {
      kcal: parseCell(r.energia_kcal) ?? 0,
      protein: parseCell(r.proteina_g) ?? 0,
      carbs: parseCell(r.carboidrato_g) ?? 0,
      fat: parseCell(r.lipideos_g) ?? 0,
      fiber: parseCell(r.fibra_g)
    },
    serving_g: null,
    serving_label: null,
    barcode: null
  }))
}

export function kcalDeviation(p) {
  const expected = 4 * p.protein + 4 * p.carbs + 9 * p.fat
  const diff = Math.abs(p.kcal - expected)
  return { expected, diff, ok: diff <= 15 || diff <= 0.15 * Math.max(expected, p.kcal) }
}

export function build({ csvPath = DEFAULT_CSV, outPath = DEFAULT_OUT } = {}) {
  if (!existsSync(csvPath)) {
    throw new Error(`Missing ${csvPath}. Get the official TACO 4ª edição spreadsheet (NEPA/Unicamp, https://www.nepa.unicamp.br/taco/), convert it to CSV with the columns id,nome,energia_kcal,proteina_g,carboidrato_g,lipideos_g,fibra_g.`)
  }
  const items = buildItems(parseCsv(readFileSync(csvPath, 'utf8')))
  const bad = items.filter((i) => !KCAL_EXCEPTIONS.has(i.source_id) && !kcalDeviation(i.per100).ok)
  if (bad.length) {
    throw new Error(`kcal does not match 4P + 4C + 9F for: ${bad.map((i) => `${i.source_id} ${i.name}`).join('; ')}`)
  }
  writeFileSync(outPath, JSON.stringify(items) + '\n')
  return items
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined }
  try {
    const items = build({ csvPath: arg('--csv'), outPath: arg('--out') })
    console.log(`taco.json: ${items.length} items`)
  } catch (e) {
    console.error(e.message)
    process.exit(1)
  }
}
