import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { RELEASES, buildReleaseSql, releaseFiles } from './build-release-sql.mjs'

const byName = name => RELEASES.find(r => r.name === name)

describe('release SQL bundles', () => {
  it('has the named ranges, in order', () => {
    expect(RELEASES.map(r => r.name)).toEqual(
      ['0007-0016_nutrition', '0017-0020_checkin', '0021-0025_sleep', '0026-0030_habits', '0031_trackers'])
  })

  it('0031_trackers holds only migration 0031', () => {
    expect(releaseFiles(byName('0031_trackers'))).toEqual(['0031_trackers.sql'])
  })

  it('the trackers header says it is for a database that already has 0001 to 0030', () => {
    const sql = buildReleaseSql(byName('0031_trackers'))
    expect(sql.split('\n').slice(0, 5).join('\n')).toContain('already has 0001 to 0030')
  })

  it('0026-0030_habits holds migrations 0026 to 0030, in order', () => {
    expect(releaseFiles(byName('0026-0030_habits'))).toEqual([
      '0026_habits_base.sql', '0027_habits_close.sql', '0028_habits_progress.sql',
      '0029_habits_challenge.sql', '0030_habits_cron.sql'])
  })

  it('the habits header says it is for a database that already has 0001 to 0025', () => {
    const sql = buildReleaseSql(byName('0026-0030_habits'))
    expect(sql.split('\n').slice(0, 5).join('\n')).toContain('already has 0001 to 0025')
  })

  it('0021-0025_sleep holds migrations 0021 to 0025, in order', () => {
    expect(releaseFiles(byName('0021-0025_sleep'))).toEqual([
      '0021_sleep_base.sql', '0022_sleep_close.sql', '0023_sleep_progress.sql',
      '0024_sleep_challenge.sql', '0025_sleep_cron.sql'])
  })

  it('the sleep header says it is for a database that already has 0001 to 0020', () => {
    const sql = buildReleaseSql(byName('0021-0025_sleep'))
    expect(sql.split('\n').slice(0, 5).join('\n')).toContain('already has 0001 to 0020')
  })

  it('0007-0016_nutrition holds migrations 0007 to 0016, in order', () => {
    expect(releaseFiles(byName('0007-0016_nutrition')).map(f => f.slice(0, 4))).toEqual(
      ['0007', '0008', '0009', '0010', '0011', '0012', '0013', '0014', '0015', '0016'])
  })

  it('0017-0020_checkin holds migrations 0017 to 0020, in order', () => {
    expect(releaseFiles(byName('0017-0020_checkin')).map(f => f.slice(0, 4))).toEqual(
      ['0017', '0018', '0019', '0020'])
  })

  it('the check-in header says it is for a database that already has 0001 to 0016', () => {
    const sql = buildReleaseSql(byName('0017-0020_checkin'))
    expect(sql.split('\n').slice(0, 5).join('\n')).toContain('already has 0001 to 0016')
  })

  it('the nutrition header keeps saying 0001 to 0006', () => {
    expect(buildReleaseSql(byName('0007-0016_nutrition')))
      .toContain('on a database that already has 0001 to 0006.')
  })

  for (const release of RELEASES) {
    it(`${release.name}: the committed file matches the migrations (run node scripts/build-release-sql.mjs)`, () => {
      expect(readFileSync(release.out, 'utf8')).toBe(buildReleaseSql(release))
    })
  }
})
