// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { programCopy, suggestionReason, programDays, programMinutes } from './program-copy'
import { PROGRAMS, type ProgramId } from './programs'
import { estimateMinutes } from './time'
import { setLang } from '../../lib/i18n.js'

const IDS = Object.keys(PROGRAMS) as ProgramId[]
const DASH_PAUSE = /[—–]|\s-\s|\s-$|^-\s/

afterEach(async () => { await setLang('en') })

describe('programCopy', () => {
  it('gives every program a name, who it is for, what to expect and why, with no dash as a pause', () => {
    for (const id of IDS) {
      const copy = programCopy(id)
      for (const key of ['name', 'forWho', 'expect', 'why'] as const) {
        expect(copy[key].trim(), `${id}.${key}`).not.toBe('')
        expect(copy[key], `${id}.${key}`).not.toMatch(DASH_PAUSE)
      }
    }
    expect(new Set(IDS.map(id => programCopy(id).name)).size).toBe(IDS.length)
  })

  it('says, in "why", the rest and the reps of each program', () => {
    for (const id of IDS) expect(programCopy(id).why, id).toMatch(/\d+ min/)
    for (const id of IDS) expect(programCopy(id).why + programCopy(id).expect, id).toMatch(/\d+ to \d+|5 sets of 5|5 to 8/)
  })

  it('is translated in pt-BR', async () => {
    await setLang('pt-BR')
    expect(programCopy('full-body-beginner').name).toBe('Corpo inteiro iniciante')
    expect(programCopy('upper-lower').name).toBe('Superior / Inferior')
    expect(programCopy('strength-5x5').name).toBe('Força 5×5')
    expect(programCopy('health-3x').name).toBe('Saúde geral')
    for (const id of IDS) {
      const copy = programCopy(id)
      for (const key of ['forWho', 'expect', 'why'] as const) expect(copy[key], `${id}.${key}`).not.toMatch(/ the | you /)
    }
  })
})

describe('suggestionReason', () => {
  it('names the profile and the days', async () => {
    expect(suggestionReason('hypertrophy', 4)).toBe('For hypertrophy, 4 days')
    expect(suggestionReason('strength', 3)).toBe('For strength, 3 days')
    expect(suggestionReason('health', 2)).toBe('For general health, 2 days')
    await setLang('pt-BR')
    expect(suggestionReason('hypertrophy', 4)).toBe('Para hipertrofia, 4 dias')
  })
})

describe('programDays and programMinutes', () => {
  it('lists the days of every variant', () => {
    expect(programDays('upper-lower')).toBe('4 days a week')
    expect(programDays('ppl')).toBe('3 or 6 days a week')
  })

  it('is the estimate of the longest routine of the variant', () => {
    for (const id of IDS) {
      const longest = Math.max(...PROGRAMS[id].routines.map(r => estimateMinutes({ ex: r.slots })))
      expect(programMinutes(id, 0), id).toBe(longest)
    }
    // health-3x alternates A, B, A: both routines are in the week.
    expect(programMinutes('health-3x')).toBeGreaterThan(0)
  })
})
