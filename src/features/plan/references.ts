import { t } from '../../lib/i18n.js'

export type RefId =
  | 'schoenfeld2017' | 'schoenfeld2016' | 'pelland2025' | 'acsm2009' | 'who2020' | 'ralston2017'
  | 'schoenfeld2016rest' | 'schoenfeld2021' | 'grgic2018freq' | 'plotkin2022' | 'iversen2021' | 'grgic2018rest'

export type Ref = { id: RefId; authors: string; year: number; title: string; journal: string; doi: string }

// Spec §7.1. Authors, title and journal are not translated. `journal` is the journal name with the
// volume and pages, without the year (the citation line shows `year` once). Pelland 2025 has only
// the journal name until its print details are checked (docs/fontes-1d.md, item 2).
const list: Ref[] = [
  { id: 'schoenfeld2017', authors: 'Schoenfeld BJ, Ogborn D, Krieger JW', year: 2017,
    title: 'Dose-response relationship between weekly resistance training volume and increases in muscle mass: a systematic review and meta-analysis',
    journal: 'J Sports Sci 35(11):1073-1082', doi: '10.1080/02640414.2016.1210197' },
  { id: 'schoenfeld2016', authors: 'Schoenfeld BJ, Ogborn D, Krieger JW', year: 2016,
    title: 'Effects of resistance training frequency on measures of muscle hypertrophy: a systematic review and meta-analysis',
    journal: 'Sports Med 46(11):1689-1697', doi: '10.1007/s40279-016-0543-8' },
  { id: 'pelland2025', authors: 'Pelland JC, Remmert JF, Robinson ZP, et al.', year: 2025,
    title: 'The resistance training dose response: meta-regressions exploring the effects of weekly volume and frequency on muscle hypertrophy and strength gains',
    journal: 'Sports Med', doi: '10.1007/s40279-025-02344-w' },
  { id: 'acsm2009', authors: 'American College of Sports Medicine (Ratamess NA et al.)', year: 2009,
    title: 'Progression models in resistance training for healthy adults',
    journal: 'Med Sci Sports Exerc 41(3):687-708', doi: '10.1249/MSS.0b013e3181915670' },
  { id: 'who2020', authors: 'Bull FC, Al-Ansari SS, Biddle S, et al.', year: 2020,
    title: 'World Health Organization 2020 guidelines on physical activity and sedentary behaviour',
    journal: 'Br J Sports Med 54(24):1451-1462', doi: '10.1136/bjsports-2020-102955' },
  { id: 'ralston2017', authors: 'Ralston GW, Kilgore L, Wyatt FB, Baker JS', year: 2017,
    title: 'The effect of weekly set volume on strength gain: a meta-analysis',
    journal: 'Sports Med 47(12):2585-2601', doi: '10.1007/s40279-017-0762-7' },
  { id: 'schoenfeld2016rest', authors: 'Schoenfeld BJ, Pope ZK, Benik FM, et al.', year: 2016,
    title: 'Longer interset rest periods enhance muscle strength and hypertrophy in resistance-trained men',
    journal: 'J Strength Cond Res 30(7):1805-1812', doi: '10.1519/JSC.0000000000001272' },
  { id: 'schoenfeld2021', authors: 'Schoenfeld BJ, Grgic J, Van Every DW, Plotkin DL', year: 2021,
    title: 'Loading recommendations for muscle strength, hypertrophy, and local endurance: a re-examination of the repetition continuum',
    journal: 'Sports 9(2):32', doi: '10.3390/sports9020032' },
  { id: 'grgic2018freq', authors: 'Grgic J, Schoenfeld BJ, Davies TB, et al.', year: 2018,
    title: 'Effect of resistance training frequency on gains in muscular strength: a systematic review and meta-analysis',
    journal: 'Sports Med 48(5):1207-1220', doi: '10.1007/s40279-018-0872-x' },
  { id: 'plotkin2022', authors: 'Plotkin D, Coleman M, Van Every D, et al.', year: 2022,
    title: 'Progressive overload without progressing load? The effects of load or repetition progression on muscular adaptations',
    journal: 'PeerJ 10:e14142', doi: '10.7717/peerj.14142' },
  { id: 'iversen2021', authors: 'Iversen VM, Norum M, Schoenfeld BJ, Fimland MS', year: 2021,
    title: 'No time to lift? Designing time-efficient training programs for strength and hypertrophy: a narrative review',
    journal: 'Sports Med 51(10):2079-2095', doi: '10.1007/s40279-021-01490-1' },
  { id: 'grgic2018rest', authors: 'Grgic J, Schoenfeld BJ, Skrepnik M, et al.', year: 2018,
    title: 'Effects of rest interval duration in resistance training on measures of muscular strength: a systematic review',
    journal: 'Sports Med 48(1):137-151', doi: '10.1007/s40279-017-0788-x' },
]

export const REFS = Object.fromEntries(list.map(r => [r.id, r])) as Record<RefId, Ref>

// Not a reference: a recommendation with no study number behind it (balance between opposing groups).
export const RULE_OF_THUMB = 'rule-of-thumb'
export type SourceId = RefId | typeof RULE_OF_THUMB

// One sentence per source with what it found. No effect sizes, no numbers of its own.
export function refFinding(id: SourceId): string {
  switch (id) {
    case 'schoenfeld2017': return t('More weekly sets gave more muscle growth, with returns that shrink as volume rises.')
    case 'schoenfeld2016': return t('Training each muscle twice a week gave more hypertrophy than once.')
    case 'pelland2025': return t('More weekly volume gave more muscle and strength, with returns that shrink as volume rises.')
    case 'acsm2009': return t('Healthy adults should keep progressing by adding load or volume a little at a time.')
    case 'who2020': return t('The general recommendation for adults includes muscle-strengthening activity every week.')
    case 'ralston2017': return t('More weekly sets gave more strength, with returns that shrink as volume rises.')
    case 'schoenfeld2016rest': return t('In trained men, longer rest between sets helped strength and muscle on multi-joint exercises.')
    case 'schoenfeld2021': return t('Muscle grew across a wide range of repetitions.')
    case 'grgic2018freq': return t('With the same weekly volume, training more often made no clear difference to strength.')
    case 'plotkin2022': return t('Adding repetitions or adding load both worked for progressing.')
    case 'iversen2021': return t('Short workouts built on multi-joint exercises can build strength and muscle.')
    case 'grgic2018rest': return t('Longer rest between sets helped strength gains on multi-joint exercises.')
    case RULE_OF_THUMB: return t('Rule of thumb for building a workout, with no study number behind it.')
  }
}
