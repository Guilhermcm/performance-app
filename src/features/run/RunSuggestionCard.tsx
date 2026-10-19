// The running plan's suggestion card (spec §8.2, plan Decisions 9 to 11), at the top of
// /plan/corrida and of /plan: the first suggestion of nextSuggestion, one at a time, with "Apply"
// and "Not now". "Not now" puts its key away in `dismissed`, and the next rule that holds shows.
//
// - Race passed: asks for the race time (h:mm:ss or m:ss). Saving records it, which updates the
//   paces; the card then shows the new paces and "Choose your next goal", which opens the
//   questionnaire, and after a new plan the weekly days goal offer (spec §6.3).
// - Weak week and high effort: this week gets last week's workouts again, on the days left. When
//   the race date leaves no room (`tight`) the card says so, and that the goal becomes finishing.
// - Faster: a run points to a higher VDOT; applying updates the paces from it.
// `logs` come from the screen's useRunLogs; the card reads none itself.
import { useId, useState, type ReactNode } from 'react'
import { Lightbulb } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { t, tn } from '../../lib/i18n.js'
import { todayISO, weekStartOf } from '../../lib/format.js'
import { useStore } from '../../store/useStore.js'
import { parseClock } from './clock'
import DaysGoalOffer from './DaysGoalOffer'
import { dayText, zoneName } from './labels'
import { weekOffsetOf, weekSummary } from './progress'
import { dismissSuggestion, recordRaceResult, repeatPreviousWeek, updateVdot } from './run-adjust'
import type { RunState } from './run-actions'
import type { RunLog } from './run-log'
import RunQuestionnaire from './RunQuestionnaire'
import { nextSuggestion, type Suggestion } from './suggestions'
import type { RunPlan } from './types'
import { formatPaceRange, zonePaces } from './vdot'

type AppStore = { S: RunState; update: (mut: (S: RunState) => void) => void }

/** "Last week you did 1 of 3 workouts." */
const lastWeekText = (done: number, planned: number) =>
  planned === 1 ? t('Last week you did {0} of 1 workout.', done) : tn(planned, 'Last week you did {0} of {1} workouts.', done, planned)

export default function RunSuggestionCard({ plan, logs }: { plan: RunPlan | null; logs: RunLog[] }) {
  const update = useStore((s: AppStore) => s.update)
  const ws = useStore((s: AppStore) => weekStartOf(s.S)) as 0 | 1
  const today = todayISO()
  // The race time was saved: the card stays on the new paces until it is closed.
  const [saved, setSaved] = useState(false)
  const [asking, setAsking] = useState(false)
  const [offer, setOffer] = useState(false)
  const s = saved ? null : nextSuggestion(plan, logs, today, ws)

  const notNow = (key: string) => update(S => { dismissSuggestion(S, key, today) })
  const questionnaire = (
    <RunQuestionnaire open={asking} onOpenChange={setAsking}
      onCreated={() => { setSaved(false); setOffer(true) }} />
  )

  if (offer) return <DaysGoalOffer onClose={() => setOffer(false)} />
  if (saved && plan) {
    const paces = plan.vdot != null ? zonePaces(plan.vdot) : null
    return <>
      <Card title={t('Your new paces')}>
        {paces && (
          <ul className="flex list-none flex-col gap-1">
            {(['easy', 'moderate', 'hard'] as const).map(z => (
              <li key={z} className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium text-foreground">{zoneName(z)}</span>
                <span className="font-mono text-sm text-foreground tabular-nums">{formatPaceRange(paces[z])}</span>
              </li>
            ))}
          </ul>
        )}
        <Actions>
          <Button className="h-11 rounded-xl" onClick={() => setAsking(true)}>{t('Choose your next goal')}</Button>
          <Button variant="ghost" className="h-11 rounded-xl" onClick={() => setSaved(false)}>{t('Close')}</Button>
        </Actions>
      </Card>
      {questionnaire}
    </>
  }
  if (!plan || !s) return null

  if (s.kind === 'race_result') {
    return <RaceResult key={s.key} onSave={minutes => { update(S => { recordRaceResult(S, minutes) }); setSaved(true) }}
      onNotNow={() => notNow(s.key)} />
  }

  const apply = (S: RunState) => {
    if (s.kind === 'faster') updateVdot(S, s.vdot, 'run', s.day)
    else repeatPreviousWeek(S, today)
  }
  const onApply = () => {
    update(apply)
    toast(s.kind === 'faster' ? t('Paces updated.') : t('Week updated.'))
  }
  return (
    <Card title={titleOf(s)}>
      {bodyOf(s, plan, logs, today, ws).map(line => <p key={line} className="text-sm text-muted-foreground">{line}</p>)}
      <Actions>
        <Button className="h-11 rounded-xl" onClick={onApply}>{t('Apply')}</Button>
        <Button variant="ghost" className="h-11 rounded-xl" onClick={() => notNow(s.key)}>{t('Not now')}</Button>
      </Actions>
    </Card>
  )
}

function titleOf(s: Exclude<Suggestion, { kind: 'race_result' }>): string {
  if (s.kind === 'repeat_week') return t('Repeat the week')
  if (s.kind === 'step_back') return t('Step back a week')
  return t('Update your paces')
}

function bodyOf(s: Exclude<Suggestion, { kind: 'race_result' }>, plan: RunPlan, logs: RunLog[], today: string, ws: 0 | 1): string[] {
  if (s.kind === 'faster') {
    return [
      t('Your run on {0} shows you are faster than the plan’s paces.', dayText(s.day, today)),
      t('New easy pace: {0}', formatPaceRange(zonePaces(s.vdot).easy)),
    ]
  }
  const lines = [s.kind === 'repeat_week'
    ? (() => { const last = weekSummary(plan, weekOffsetOf(plan, today, ws) - 1, logs, ws); return lastWeekText(last.done, last.planned) })()
    : t('Over the last two weeks your easy and long runs felt hard.')]
  lines.push(t('This week gets last week’s workouts again, on the days you have left.'))
  if (s.tight) lines.push(t('The time to the race got tight, so the goal becomes finishing it.'))
  return lines
}

function RaceResult({ onSave, onNotNow }: { onSave: (minutes: number) => void; onNotNow: () => void }) {
  const id = useId()
  const [text, setText] = useState('')
  const [wrong, setWrong] = useState(false)
  const save = () => {
    const minutes = parseClock(text)
    if (minutes == null || minutes <= 0) { setWrong(true); return }
    onSave(minutes)
  }
  return (
    <Card title={t('How did the race go?')}>
      <p className="text-sm text-muted-foreground">{t('Enter your race time to update your paces.')}</p>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-time`} className="text-sm font-medium text-foreground">{t('Race time')}</label>
        <Input id={`${id}-time`} value={text} placeholder="h:mm:ss" autoComplete="off" spellCheck={false}
          aria-invalid={wrong || undefined} aria-describedby={wrong ? `${id}-error` : undefined}
          className="h-11 font-mono tabular-nums"
          onChange={e => { setText(e.target.value); setWrong(false) }}
          onKeyDown={e => { if (e.key === 'Enter') save() }} />
        {wrong && <p id={`${id}-error`} role="alert" className="text-sm text-destructive">{t('Enter the time as h:mm:ss or m:ss.')}</p>}
      </div>
      <Actions>
        <Button className="h-11 rounded-xl" onClick={save}>{t('Save')}</Button>
        <Button variant="ghost" className="h-11 rounded-xl" onClick={onNotNow}>{t('Not now')}</Button>
      </Actions>
    </Card>
  )
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  const id = useId()
  return (
    <section data-slot="run-suggestion" aria-labelledby={id}
      className="flex flex-col gap-2 rounded-2xl border border-border bg-card px-4 py-3 font-sans text-card-foreground">
      <h2 id={id} className="flex items-center gap-2 text-[15px] font-semibold text-foreground">
        <Lightbulb aria-hidden className="size-4 shrink-0 text-primary" />{title}
      </h2>
      {children}
    </section>
  )
}

const Actions = ({ children }: { children: ReactNode }) => <div className="flex flex-wrap gap-2">{children}</div>
