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
// Suggested household measures (src/features/nutrition/data/taco-measures.json) come from the POF
// 2008-2009 Tabela de Medidas Referidas (IBGE), copied with its provenance to
// scripts/data/pof-medidas.csv. scripts/data/taco-pof-map.csv says which POF food and preparation
// each TACO id corresponds to (curated by hand; scripts/suggest-taco-pof-map.mjs proposes
// candidates). Output: { [taco id]: [{ label, grams }] }, see buildMeasures().
//
// Usage: node scripts/build-taco.mjs [--csv path] [--out path] [--map path] [--pof path]
//                                    [--measures-out path]
// When the CSV is missing the script exits 1 and leaves taco.json untouched.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const DEFAULT_CSV = fileURLToPath(new URL('./data/taco-4ed.csv', import.meta.url))
const DEFAULT_OUT = fileURLToPath(new URL('../src/features/nutrition/data/taco.json', import.meta.url))
const DEFAULT_MAP = fileURLToPath(new URL('./data/taco-pof-map.csv', import.meta.url))
const DEFAULT_POF = fileURLToPath(new URL('./data/pof-medidas.csv', import.meta.url))
const DEFAULT_MEASURES_OUT = fileURLToPath(new URL('../src/features/nutrition/data/taco-measures.json', import.meta.url))

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

// ---------------------------------------------------------------------------------------------
// POF household measures

/**
 * POF measure names (descricao_medida) to the pt-BR label shown in the app. Measures missing
 * here are dropped: weights (GRAMA, QUILO), volumes of packages (LATA, GARRAFA), vague servings
 * (PORCAO, PUNHADO, METADE) and plates or bowls, whose size varies too much to suggest.
 * The order is the priority: named cuts first, then generic pieces, then utensils. It picks the
 * label when two measures weigh the same and the measures kept when there are more than
 * MAX_MEASURES.
 */
export const POF_LABEL = {
  BIFE: 'bife',
  FILE: 'filé',
  POSTA: 'posta',
  PEITO: 'peito',
  COXA: 'coxa',
  SOBRECOXA: 'sobrecoxa',
  ASA: 'asa',
  ESPIGA: 'espiga',
  GOMO: 'gomo',
  FOLHA: 'folha',
  UNIDADE: 'unidade',
  'UNIDADE PEQUENA': 'unidade pequena',
  FATIA: 'fatia',
  RODELA: 'rodela',
  PEDACO: 'pedaço',
  'COLHER DE ARROZ/SERVIR': 'colher de servir',
  CONCHA: 'concha',
  ESCUMADEIRA: 'escumadeira',
  'COLHER DE SOPA': 'colher de sopa',
  'XICARA DE CHA': 'xícara',
  'COPO AMERICANO': 'copo americano',
  'COPO DE REQUEIJAO': 'copo de requeijão',
  'COLHER DE SOBREMESA': 'colher de sobremesa',
  'COLHER DE CHA': 'colher de chá'
}

export const MAX_MEASURES = 6

/**
 * POF measures that do not fit one TACO food, by TACO id. The POF pair is right but one of its
 * measures belongs to another form of the food (a glass of orange is the juice).
 */
export const MEASURE_EXCLUSIONS = {
  '45': ['unidade', 'unidade pequena'], // Milho verde enlatado: a POF copia a espiga para o milho em conserva
  '100': ['unidade'], // Brócolis cozido: a "unidade" da POF é o ramo de couve-flor
  '214': ['copo americano', 'copo de requeijão'] // Laranja pera crua: o copo é o do suco (taco 215)
}

/**
 * Plausible grams per label. POF weights outside these ranges are left out of the suggestions and
 * listed by the build, so the curator can check whether the map points to the wrong POF food or
 * preparation (a 50 g "unidade" of watermelon would land here). Spoons, ladles, cups and slices
 * follow the plan; the other ranges were set from the POF values of the mapped foods.
 */
export const PLAUSIBLE_G = {
  'colher de servir': [2, 60],
  'colher de sopa': [2, 60],
  'colher de sobremesa': [2, 60],
  'colher de chá': [2, 60],
  concha: [50, 250],
  escumadeira: [30, 250],
  xícara: [50, 300],
  'copo americano': [100, 250],
  'copo de requeijão': [150, 350],
  fatia: [5, 200],
  rodela: [2, 200],
  folha: [1, 100],
  gomo: [3, 300],
  unidade: [1, 2000],
  'unidade pequena': [5, 2000],
  espiga: [50, 500],
  pedaço: [5, 1000],
  bife: [40, 300],
  filé: [40, 400],
  posta: [40, 400],
  peito: [80, 600],
  coxa: [40, 300],
  sobrecoxa: [40, 300],
  asa: [20, 200]
}

/**
 * The POF imputes some measures from plate or bowl sizes (a "xícara" of rice with the source
 * "Arroz - prato fundo raso"); those weights describe the plate, not the measure, so they go.
 */
const PLATE_SOURCE = /\b(prato|tigela|pires|cumbuca)\b/

/**
 * How the POF source text (descricao_fonte) names each measure. The IBGE filled measures it had
 * no weight for by copying another one: a "xícara" of beans is the "concha média cheia", a fish
 * "bife" is the "filé médio". The source name is used twice:
 * - a utensil row (UTENSILS) is kept only when its source names that utensil or scales another
 *   one explicitly ("1/4 colher de sopa cheia", "2 colheres de sopa"), since a copied utensil
 *   would show the weight of a different one;
 * - when two measures weigh the same, the one its source names anywhere wins (fish "filé" from
 *   "Peixe cozido - filé médio", beef "bife" from "Bife bovino - unidade média"), then the first
 *   in POF_LABEL.
 */
const SOURCE_NAME = {
  BIFE: /\bbifes?\b/,
  FILE: /\bfiles?\b/,
  POSTA: /\bpostas?\b/,
  PEITO: /\bpeitos?\b/,
  COXA: /\bcoxas?\b/,
  SOBRECOXA: /\bsobrecoxas?\b/,
  ASA: /\basas?\b/,
  ESPIGA: /\bespigas?\b/,
  GOMO: /\bgomos?\b/,
  FOLHA: /\bfolhas?\b/,
  UNIDADE: /\bunid/,
  'UNIDADE PEQUENA': /\bpequen/,
  FATIA: /\bfatias?\b/,
  RODELA: /\brodelas?\b/,
  PEDACO: /\bpedacos?\b/,
  'COLHER DE ARROZ/SERVIR': /\bcolher(es)? (de )?(arroz|servir)\b/,
  CONCHA: /\bconchas?\b/,
  ESCUMADEIRA: /\bescumade?i?ras?\b/,
  'COLHER DE SOPA': /\bcolher(es)? (de )?sopa\b/,
  'XICARA DE CHA': /\bxicaras?\b/,
  'COPO AMERICANO': /\bcopos? americanos?\b/,
  'COPO DE REQUEIJAO': /\bcopos? de requeijao\b/,
  'COLHER DE SOBREMESA': /\bcolher(es)? de sobremesa\b/,
  'COLHER DE CHA': /\bcolher(es)? de cha\b/
}
const UTENSILS = new Set(['COLHER DE ARROZ/SERVIR', 'CONCHA', 'ESCUMADEIRA', 'COLHER DE SOPA', 'XICARA DE CHA', 'COPO AMERICANO', 'COPO DE REQUEIJAO', 'COLHER DE SOBREMESA', 'COLHER DE CHA'])
const SCALED_SOURCE = /^\d+(\/\d+|%)? (colher|concha|escumad|xicara|copo)/
/** "Diluição para o preparo de 1 copo": the powder that makes a drink, not the measure itself. */
const DRINK_POWDER_SOURCE = /\bdiluicao\b/

const plain = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
/** "Queijo prato - fatia média" -> "fatia media": the source names the food, then the measure. */
const sourceMeasure = (fonte) => plain(fonte).split(' - ').pop().trim()

/** Whether a POF row's weight describes its own measure (see PLATE_SOURCE and SOURCE_NAME). */
export function usablePofRow(r) {
  if (!POF_LABEL[r.descricao_medida]) return false
  const src = sourceMeasure(r.descricao_fonte)
  if (PLATE_SOURCE.test(src) || DRINK_POWDER_SOURCE.test(src)) return false
  return !UTENSILS.has(r.descricao_medida) || SOURCE_NAME[r.descricao_medida].test(src) || SCALED_SOURCE.test(src)
}

const plausible = ({ label, grams }) => grams >= PLAUSIBLE_G[label][0] && grams <= PLAUSIBLE_G[label][1]

/**
 * The suggested measures of one POF (food, preparation) pair: usable rows within PLAUSIBLE_G, one
 * label per weight (the one its source names, else the first in POF_LABEL), at most
 * MAX_MEASURES by POF_LABEL priority, smallest first. `dropped` lists the usable rows left out
 * for being implausible.
 */
export function selectMeasures(pofRows) {
  const priority = Object.keys(POF_LABEL)
  const usable = pofRows
    .filter(usablePofRow)
    .map((r) => ({
      label: POF_LABEL[r.descricao_medida],
      grams: Math.round(Number(r.quantidade_g) * 10) / 10,
      rank: priority.indexOf(r.descricao_medida),
      named: SOURCE_NAME[r.descricao_medida].test(plain(r.descricao_fonte))
    }))
  const seen = new Set()
  const kept = usable
    .filter(plausible)
    .sort((a, b) => Number(b.named) - Number(a.named) || a.rank - b.rank)
    .filter((m) => !seen.has(m.grams) && seen.add(m.grams))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, MAX_MEASURES)
    .sort((a, b) => a.grams - b.grams || a.rank - b.rank)
    .map(({ label, grams }) => ({ label, grams }))
  const dropped = usable.filter((m) => !plausible(m)).map(({ label, grams }) => ({ label, grams }))
  return { kept, dropped }
}

/** Parses scripts/data/pof-medidas.csv, skipping the "#" provenance lines at the top. */
export function parsePofCsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/)
  let i = 0
  while (i < lines.length && lines[i].startsWith('#')) i++
  return parseCsv(lines.slice(i).join('\n'))
}

/**
 * items: FoodItem[] from buildItems; mapRows: taco-pof-map.csv rows; pofRows: parsePofCsv rows.
 * Returns { measures, dropped }: measures is { [taco id]: [{ label, grams }] } with 1 to
 * MAX_MEASURES measures per mapped food, no repeated label, smallest first; dropped lists the
 * implausible POF weights left out ({ taco_id, label, grams }). Throws on unknown or repeated TACO
 * ids and on POF pairs that do not exist or yield no measure. `exclusions` removes measures per
 * TACO id (MEASURE_EXCLUSIONS).
 */
export function buildMeasures(items, mapRows, pofRows, exclusions = MEASURE_EXCLUSIONS) {
  const taco = new Set(items.map((i) => i.source_id))
  const byPair = new Map()
  for (const r of pofRows) {
    const k = `${Number(r.codigo_alimento)}|${Number(r.codigo_preparacao)}`
    if (!byPair.has(k)) byPair.set(k, [])
    byPair.get(k).push(r)
  }
  const measures = {}
  const dropped = []
  const errors = []
  for (const m of mapRows) {
    const id = String(m.taco_id).trim()
    const pair = `${Number(m.pof_codigo_alimento)}|${Number(m.pof_codigo_preparacao)}`
    if (!taco.has(id)) { errors.push(`taco_id ${id} is not in TACO`); continue }
    if (id in measures) { errors.push(`taco_id ${id} appears more than once`); continue }
    const rows = byPair.get(pair)
    if (!rows) { errors.push(`taco_id ${id}: POF food ${m.pof_codigo_alimento} with preparation ${m.pof_codigo_preparacao} does not exist`); continue }
    const excluded = new Set(exclusions[id] ?? [])
    const { kept, dropped: implausible } = selectMeasures(rows.filter((r) => !excluded.has(POF_LABEL[r.descricao_medida])))
    dropped.push(...implausible.map((m) => ({ taco_id: id, ...m })))
    if (!kept.length) {
      const why = implausible.length ? ` (implausible: ${implausible.map((m) => `${m.label} ${m.grams} g`).join(', ')})` : ''
      errors.push(`taco_id ${id}: POF pair ${pair} has no usable measure${why}`)
      continue
    }
    measures[id] = kept
  }
  if (errors.length) throw new Error(`taco-pof-map.csv: ${errors.join('; ')}`)
  return { measures, dropped }
}

/**
 * Writes taco.json, and taco-measures.json when measuresOutPath is given. Everything is checked
 * before anything is written, so a failing map leaves both files untouched.
 */
export function build({ csvPath = DEFAULT_CSV, outPath = DEFAULT_OUT, mapPath = DEFAULT_MAP, pofPath = DEFAULT_POF, measuresOutPath } = {}) {
  if (!existsSync(csvPath)) {
    throw new Error(`Missing ${csvPath}. Get the official TACO 4ª edição spreadsheet (NEPA/Unicamp, https://www.nepa.unicamp.br/taco/), convert it to CSV with the columns id,nome,energia_kcal,proteina_g,carboidrato_g,lipideos_g,fibra_g.`)
  }
  const items = buildItems(parseCsv(readFileSync(csvPath, 'utf8')))
  const bad = items.filter((i) => !KCAL_EXCEPTIONS.has(i.source_id) && !kcalDeviation(i.per100).ok)
  if (bad.length) {
    throw new Error(`kcal does not match 4P + 4C + 9F for: ${bad.map((i) => `${i.source_id} ${i.name}`).join('; ')}`)
  }
  let pof = null
  if (measuresOutPath) {
    for (const p of [mapPath, pofPath]) if (!existsSync(p)) throw new Error(`Missing ${p}. See scripts/data/README.md.`)
    pof = buildMeasures(items, parseCsv(readFileSync(mapPath, 'utf8')), parsePofCsv(readFileSync(pofPath, 'utf8')))
  }
  writeFileSync(outPath, JSON.stringify(items) + '\n')
  if (pof) writeFileSync(measuresOutPath, JSON.stringify(pof.measures) + '\n')
  return { items, measures: pof?.measures ?? null, dropped: pof?.dropped ?? [] }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined }
  try {
    const { items, measures, dropped } = build({
      csvPath: arg('--csv'), outPath: arg('--out'), mapPath: arg('--map'), pofPath: arg('--pof'),
      measuresOutPath: arg('--measures-out') ?? DEFAULT_MEASURES_OUT
    })
    const n = Object.values(measures).reduce((a, l) => a + l.length, 0)
    console.log(`taco.json: ${items.length} items; taco-measures.json: ${Object.keys(measures).length} foods, ${n} measures`)
    for (const d of dropped) console.log(`  left out (outside PLAUSIBLE_G): taco ${d.taco_id} ${d.label} ${d.grams} g`)
  } catch (e) {
    console.error(e.message)
    process.exit(1)
  }
}
