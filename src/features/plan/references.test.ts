import { describe, expect, it } from 'vitest'
import { REFS, RULE_OF_THUMB, refFinding, type RefId } from './references'

// Spec §7.1: the DOIs, exactly as the table has them.
const DOIS: Record<RefId, string> = {
  schoenfeld2017: '10.1080/02640414.2016.1210197',
  schoenfeld2016: '10.1007/s40279-016-0543-8',
  pelland2025: '10.1007/s40279-025-02344-w',
  acsm2009: '10.1249/MSS.0b013e3181915670',
  who2020: '10.1136/bjsports-2020-102955',
  ralston2017: '10.1007/s40279-017-0762-7',
  schoenfeld2016rest: '10.1519/JSC.0000000000001272',
  schoenfeld2021: '10.3390/sports9020032',
  grgic2018freq: '10.1007/s40279-018-0872-x',
  plotkin2022: '10.7717/peerj.14142',
  iversen2021: '10.1007/s40279-021-01490-1',
  grgic2018rest: '10.1007/s40279-017-0788-x',
}
const IDS = Object.keys(DOIS) as RefId[]
const DASH_PAUSE = /[—–]|\s-\s|\s-$|^-\s/

describe('reference catalog', () => {
  it('has the 12 entries of the spec table', () => {
    expect(Object.keys(REFS).sort()).toEqual([...IDS].sort())
  })

  it('keeps the DOI of the spec table for every entry', () => {
    for (const id of IDS) expect(REFS[id].doi, id).toBe(DOIS[id])
  })

  it('has well formed fields, and the id matches its key', () => {
    for (const id of IDS) {
      const r = REFS[id]
      expect(r.id).toBe(id)
      expect(r.doi, id).toMatch(/^10\.\d{4,9}\/\S+$/)
      expect(r.authors.trim(), id).not.toBe('')
      expect(r.title.trim(), id).not.toBe('')
      expect(r.journal.trim(), id).not.toBe('')
      expect(Number.isInteger(r.year), id).toBe(true)
    }
  })

  it('splits authors, year, title and journal as the spec cites them', () => {
    expect(REFS.schoenfeld2017).toMatchObject({
      authors: 'Schoenfeld BJ, Ogborn D, Krieger JW',
      year: 2017,
      title: 'Dose-response relationship between weekly resistance training volume and increases in muscle mass: a systematic review and meta-analysis',
    })
    expect(REFS.pelland2025.year).toBe(2025)
    expect(REFS.plotkin2022.journal).toBe('PeerJ 10:e14142')
    expect(REFS.schoenfeld2017.journal).toBe('J Sports Sci 35(11):1073-1082')
  })
})

describe('refFinding', () => {
  it('says something for every reference and for the rule of thumb', () => {
    for (const id of [...IDS, RULE_OF_THUMB] as const) expect(refFinding(id).trim(), id).not.toBe('')
  })

  it('never uses a dash as a pause', () => {
    for (const id of [...IDS, RULE_OF_THUMB] as const) expect(refFinding(id), id).not.toMatch(DASH_PAUSE)
  })

  it('carries no figure of its own', () => {
    for (const id of [...IDS, RULE_OF_THUMB] as const) expect(refFinding(id), id).not.toMatch(/\d/)
  })

  it('states a conclusion for acsm2009, not a description of the paper (review M7)', () => {
    expect(refFinding('acsm2009')).toBe('Healthy adults should keep progressing by adding load or volume a little at a time.')
  })

  it('names the rule of thumb as such', () => {
    expect(RULE_OF_THUMB).toBe('rule-of-thumb')
    expect(refFinding(RULE_OF_THUMB)).toMatch(/rule of thumb/i)
  })
})

describe('citation fields (review M6)', () => {
  it('keeps the year out of journal, so the citation line names it once', () => {
    for (const id of IDS) expect(REFS[id].journal, id).not.toContain(String(REFS[id].year))
  })

  it('has no date written in one language', () => {
    for (const id of IDS) expect(REFS[id].journal, id).not.toMatch(/online|dez\.|\d{1,2} [a-z]{3}\./i)
  })
})
