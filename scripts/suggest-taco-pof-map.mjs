// Proposes TACO x POF matches to help curate scripts/data/taco-pof-map.csv. Not used by the build.
//
// For each TACO food it ranks POF (food, preparation) pairs by normalized name overlap: the words
// of the TACO name (accents stripped, lower case) against the POF food description, plus a bonus
// when the TACO preparation word (cozido, cru, frito, assado, grelhado, refogado, à milanesa)
// matches the POF preparation. POF "NAO SE APLICA" (99) is kept as a fallback, since the POF
// records many foods as eaten (cooked rice and beans are 99).
//
// Every suggestion must be reviewed by hand before it goes into the map: the ranking only narrows
// the 1,969 POF pairs down to a few candidates.
//
// Usage: node scripts/suggest-taco-pof-map.mjs [--ids 3,561,...] [--top 3] [--taco path] [--pof path]
// Output: CSV on stdout (taco_id,taco_nome,score,pof_codigo_alimento,pof_descricao,
//         pof_codigo_preparacao,pof_preparacao,medidas).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseCsv, parsePofCsv, POF_LABEL, usablePofRow } from './build-taco.mjs'

const TACO_CSV = fileURLToPath(new URL('./data/taco-4ed.csv', import.meta.url))
const POF_CSV = fileURLToPath(new URL('./data/pof-medidas.csv', import.meta.url))

/** Lower case, no accents, only letters, digits and spaces. */
export function normalize(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim()
}

const STOP = new Set(['de', 'da', 'do', 'com', 'sem', 'em', 'e', 'a', 'o', 'tipo', 'n', 'ao'])

/** TACO preparation words mapped to POF codigo_preparacao. */
const PREP = [
  [/\bcozid/, '2'], [/\bcru(a|s|as)?\b/, '1'], [/\bfrit/, '5'], [/\bassad/, '4'],
  [/\bgrelhad/, '3'], [/\brefogad/, '7'], [/\bmilanesa\b/, '6']
]

export function tacoPrep(name) {
  const n = normalize(name)
  for (const [re, code] of PREP) if (re.test(n)) return code
  return null
}

const stem = (w) => w.slice(0, 5)
const words = (s) => normalize(s).split(' ').filter((w) => w.length > 1 && !STOP.has(w))

export function score(tacoName, pofDesc, pofPrep) {
  const t = words(tacoName).filter((w) => !PREP.some(([re]) => re.test(w)))
  const p = new Set(words(pofDesc).map(stem))
  if (!t.length || !p.has(stem(t[0]))) return 0
  let s = 0
  t.forEach((w, i) => { if (p.has(stem(w))) s += i === 0 ? 3 : 1 })
  const want = tacoPrep(tacoName)
  if (want && pofPrep === want) s += 2
  else if (pofPrep === '99') s += 1
  return s
}

export function suggest(tacoRows, pofRows, { top = 3 } = {}) {
  const pairs = new Map()
  for (const r of pofRows) {
    const k = `${r.codigo_alimento}|${r.codigo_preparacao}`
    const e = pairs.get(k) ?? { ...r, medidas: new Set() }
    if (usablePofRow(r)) e.medidas.add(POF_LABEL[r.descricao_medida])
    pairs.set(k, e)
  }
  const out = []
  for (const t of tacoRows) {
    const ranked = [...pairs.values()]
      .map((p) => ({ p, s: score(t.nome, p.descricao_alimento, p.codigo_preparacao) }))
      .filter((x) => x.s > 0 && x.p.medidas.size > 0)
      .sort((a, b) => b.s - a.s || b.p.medidas.size - a.p.medidas.size)
      .slice(0, top)
    for (const { p, s } of ranked) {
      out.push({ taco_id: t.id, taco_nome: t.nome, score: s, pof_codigo_alimento: p.codigo_alimento,
        pof_descricao: p.descricao_alimento, pof_codigo_preparacao: p.codigo_preparacao,
        pof_preparacao: p.descricao_preparacao, medidas: [...p.medidas].join('/') })
    }
  }
  return out
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined }
  const ids = arg('--ids') ? new Set(arg('--ids').split(',')) : null
  const taco = parseCsv(readFileSync(arg('--taco') ?? TACO_CSV, 'utf8')).filter((r) => !ids || ids.has(r.id))
  const pof = parsePofCsv(readFileSync(arg('--pof') ?? POF_CSV, 'utf8'))
  const q = (v) => (/[",]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
  const cols = ['taco_id', 'taco_nome', 'score', 'pof_codigo_alimento', 'pof_descricao', 'pof_codigo_preparacao', 'pof_preparacao', 'medidas']
  console.log(cols.join(','))
  for (const r of suggest(taco, pof, { top: Number(arg('--top') ?? 3) })) console.log(cols.map((c) => q(r[c])).join(','))
}
