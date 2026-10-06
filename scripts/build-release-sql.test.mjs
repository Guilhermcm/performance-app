import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { OUT, buildReleaseSql, releaseFiles } from './build-release-sql.mjs'

describe('release SQL bundle', () => {
  it('holds migrations 0007 to 0016, in order', () => {
    expect(releaseFiles().map(f => f.slice(0, 4))).toEqual(
      ['0007', '0008', '0009', '0010', '0011', '0012', '0013', '0014', '0015', '0016'])
  })

  it('the committed file matches the migrations (run node scripts/build-release-sql.mjs)', () => {
    expect(readFileSync(OUT, 'utf8')).toBe(buildReleaseSql())
  })
})
