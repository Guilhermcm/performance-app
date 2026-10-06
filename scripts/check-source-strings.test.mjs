/* check-source-strings.mjs, run the way CI runs it: a copy of the script in a throwaway tree
 * (scripts/ beside src/) with a one-file app and one pack, so the real src/ does not matter. */
import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const script = join(dirname(fileURLToPath(import.meta.url)), 'check-source-strings.mjs')

const run = (source, pack) => {
  const dir = mkdtempSync(join(tmpdir(), 'check-source-strings-'))
  try {
    mkdirSync(join(dir, 'scripts'))
    mkdirSync(join(dir, 'src', 'locales'), { recursive: true })
    copyFileSync(script, join(dir, 'scripts', 'check-source-strings.mjs'))
    writeFileSync(join(dir, 'src', 'a.js'), source)
    writeFileSync(join(dir, 'src', 'locales', 'de.js'), `export default ${JSON.stringify(pack)}\n`)
    const r = spawnSync(process.execPath, [join(dir, 'scripts', 'check-source-strings.mjs'), '--strict'], { encoding: 'utf8' })
    return { code: r.status, out: r.stdout + r.stderr }
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

describe('check-source-strings.mjs', () => {
  it('passes a t() literal the packs define', () => {
    expect(run("t('Save')", { Save: 'Speichern' }).code).toBe(0)
  })

  it('fails a t() literal no pack defines', () => {
    const r = run("t('Save')", {})
    expect(r.code).toBe(1)
    expect(r.out).toContain('Save')
  })

  it('reads the key of a tn() call, whatever the count expression looks like', () => {
    expect(run("tn(n, '{0} items', n)", { '{0} items': '{0} Einträge' }).code).toBe(0)
    expect(run("tn(list.length, '{0} items', list.length)", { '{0} items': '{0} Einträge' }).code).toBe(0)
    expect(run("tn(Math.max(a, b), '{0} items', 2)", { '{0} items': '{0} Einträge' }).code).toBe(0)
    const r = run("tn(n, '{0} items', n)", { Save: 'Speichern' })
    expect(r.code).toBe(1)
    expect(r.out).toContain('{0} items')
  })
})
