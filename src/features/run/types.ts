// Running plan types (spec §5.2 and §6.1). Training data only: the plan stores zones, never
// paces, so the pace range is computed from the plan's current VDOT when it is shown.
export type RunGoal = 'start' | '5k' | '10k' | 'half' | 'maintain'
export type GoalType = 'finish' | 'time'

// What the person can do today (questionnaire step 4). Only `race` yields a VDOT.
export type Reference =
  | { kind: 'race'; distanceM: number; minutes: number; date: string }
  | { kind: 'continuous'; minutes: number }
  | { kind: 'none' }

export type Zone = 'easy' | 'moderate' | 'hard' | 'walk'

export type Block = { zone: Zone; min: number }
// A workout item: one block (1 to 300 min) or a repeat (2 to 20) of up to 4 blocks. A workout has
// up to 12 items.
export type Item = Block | { repeat: number; blocks: Block[] }

export type SessionType = 'runwalk' | 'easy' | 'long' | 'tempo' | 'intervals'

// `day` is the weekday the session was fitted to, in the app's S.week convention: 0 = Sunday to
// 6 = Saturday (getDay()).
export type Session = { id: string; type: SessionType; blocks: Item[]; day: number }

// `maintain`: the weeks of a maintain cycle run before a race plan that starts later (spec §5.3).
export type Phase = 'base' | 'build' | 'specific' | 'taper' | 'maintain'

export type Week = { index: number; phase: Phase; recovery: boolean; sessions: Session[] }

// Questionnaire answers (spec §3). `targetMinutes` only with goalType `time`; the deadline is
// `raceDate` (ISO) or `weeks`; `longDay` follows S.week (0 = Sunday to 6 = Saturday).
export type Answers = {
  goal: RunGoal
  goalType?: GoalType
  targetMinutes?: number
  raceDate?: string
  weeks?: number
  reference: Reference
  days: 2 | 3 | 4
  longDay: number
  // Race goals: run a maintain cycle until a race plan that starts later begins (spec §5.3).
  bridge?: boolean
}

export type RunPlan = {
  version: 1
  goal: RunGoal
  goalType: GoalType
  targetTime?: number
  raceDate?: string
  startDate: string
  answers: Answers
  vdot?: number
  vdotSource: 'race' | 'run' | null
  vdotDate?: string
  // The person's week start when the plan was made; dates map to plan weeks with it, so changing
  // S.weekStart later does not move sessions. Missing in plans saved before it: S.weekStart.
  weekStart?: 0 | 1
  // Maintain plans whose week 1 started mid-week: the days of week 1's sessions in that first
  // calendar week only (Decision 2). Later cycles use the sessions' own days.
  openingDays?: Record<string, number>
  weeks: Week[]
  dismissed: Record<string, string>
}
