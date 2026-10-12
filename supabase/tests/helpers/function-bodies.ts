import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MIGRATIONS = fileURLToPath(new URL('../../migrations/', import.meta.url))

// Every `create [or replace] function public.<name>(` in the migrations, in the order they run,
// with the body between its opening $$ and the $$ that closes it.
export function definitions(name: string): { file: string; body: string }[] {
  const head = new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${name}\\s*\\(`, 'gi')
  const out: { file: string; body: string }[] = []
  for (const file of readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort()) {
    const text = readFileSync(join(MIGRATIONS, file), 'utf8')
    for (const m of text.matchAll(head)) {
      const open = text.indexOf('$$', m.index)
      const close = text.indexOf('$$', open + 2)
      if (open < 0 || close < 0) throw new Error(`${file}: no $$ body for ${name}`)
      out.push({ file, body: text.slice(open + 2, close) })
    }
  }
  return out
}

// The lines of a body that carry code: trimmed, without blank lines and without comment lines.
export function bodyLines(body: string): string[] {
  return body.split('\n').map(l => l.trim()).filter(l => l !== '' && !l.startsWith('--'))
}
