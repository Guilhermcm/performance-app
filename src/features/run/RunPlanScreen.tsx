// /plan/corrida (spec §6.4): the goal and the deadline, the phases, the weeks with this one marked
// (its runs open, with their blocks), the paces by zone with the date of the reference, the race
// prediction from today's pace, and "Refit next weeks", "Redo questionnaire" and "End plan" (with a
// confirmation; the strength week and the check-ins stay). A plan this build cannot read (another
// version) offers only to redo the questionnaire; a plan waiting for its race says when it starts.
import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { cn } from '@/lib/utils'
import { t, tn } from '../../lib/i18n.js'
import { DAYN, todayISO, weekOrder, weekStartOf } from '../../lib/format.js'
import { useStore } from '../../store/useStore.js'
import { goalName, phaseName, sessionName, zoneFeel, zoneName } from './labels'
import { weekMinutes } from './models'
import { currentWeek, endRunPlan, isReadable, refitFuture, type RunState } from './run-actions'
import { DaysGoalOffer, dayText } from './RunPlanEntry'
import RunQuestionnaire, { formatClock } from './RunQuestionnaire'
import SessionBlocks, { zonesOf } from './SessionBlocks'
import { formatPaceRange, predictMinutes, zonePaces } from './vdot'
import type { Phase, RunPlan, Week } from './types'

type AppStore = { S: RunState; update: (mut: (S: RunState) => void) => void }

const weeksText = (n: number) => (n === 1 ? t('1 week') : tn(n, '{0} weeks', n))
const RACES = ['5k', '10k', 'half']

// Consecutive weeks of the same phase, in order.
function phaseRuns(weeks: Week[]): { phase: Phase; count: number }[] {
  const out: { phase: Phase; count: number }[] = []
  for (const w of weeks) {
    const last = out[out.length - 1]
    if (last && last.phase === w.phase) last.count++
    else out.push({ phase: w.phase, count: 1 })
  }
  return out
}

// "Your pace today gives about 55:30 for 10 km": the goal's race, or 5 and 10 km for maintain.
function predictions(plan: RunPlan): string[] {
  const v = plan.vdot
  if (v == null || plan.goal === 'start') return []
  const clock = (m: number) => formatClock(predictMinutes(v, m))
  const five = t('Your pace today gives about {0} for 5 km.', clock(5000))
  const ten = t('Your pace today gives about {0} for 10 km.', clock(10000))
  if (plan.goal === '5k') return [five]
  if (plan.goal === '10k') return [ten]
  if (plan.goal === 'half') return [t('Your pace today gives about {0} for the half marathon.', clock(21097.5))]
  return [five, ten]
}

export default function RunPlanScreen() {
  const navigate = useNavigate()
  const S = useStore((s: AppStore) => s.S)
  const update = useStore((s: AppStore) => s.update)
  const [asking, setAsking] = useState(false)
  const [ending, setEnding] = useState(false)
  const [offer, setOffer] = useState(false)
  const today = todayISO()
  const plan = S.runPlan
  const readable = isReadable(plan)
  const forecast = readable ? predictions(plan) : []

  const end = () => {
    update(draft => { endRunPlan(draft) })
    setEnding(false)
    navigate('/plan')
  }
  const refit = () => {
    update(draft => { refitFuture(draft, today) })
    toast(t('Coming weeks refitted.'))
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5 pb-6 font-sans text-foreground">
      <header className="flex flex-col">
        <div className="-ml-2 flex h-11 items-center">
          <Button variant="ghost" size="icon" className="size-11 rounded-full" aria-label={t('Back')} onClick={() => navigate('/plan')}>
            <ArrowLeft aria-hidden className="size-5 rtl:rotate-180" />
          </Button>
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{t('Running plan')}</h1>
        {readable && <Tags plan={plan} today={today} ws={weekStartOf(S)} />}
      </header>

      {offer && <DaysGoalOffer onClose={() => setOffer(false)} />}

      {!plan && <>
        <p className="text-[15px] text-muted-foreground">{t('No running plan yet.')} {t('The app fits your runs around your strength training.')}</p>
        <Button size="lg" className="h-12 w-full rounded-xl text-base font-semibold" onClick={() => setAsking(true)}>{t('Build a running plan')}</Button>
      </>}

      {plan && !readable && <>
        <p className="text-[15px] text-muted-foreground">{t('This plan can’t be read in this version of the app.')}</p>
        <Button size="lg" className="h-12 w-full rounded-xl text-base font-semibold" onClick={() => setAsking(true)}>{t('Redo questionnaire')}</Button>
      </>}

      {readable && <>
        <Part id="phases" title={t('Phases')}>
          <ol className="flex list-none flex-wrap gap-2">
            {phaseRuns(plan.weeks).map((r, i) => (
              <li key={i} className="flex flex-col rounded-xl bg-muted px-3 py-1.5">
                <span className="text-sm font-medium">{phaseName(r.phase)}</span>
                <span className="font-mono text-xs text-muted-foreground tabular-nums">{weeksText(r.count)}</span>
              </li>
            ))}
          </ol>
        </Part>

        <WeekList plan={plan} today={today} ws={weekStartOf(S)} />

        <Part id="paces" title={t('Paces')}>
          <Paces plan={plan} today={today} />
        </Part>

        {forecast.length > 0 && (
          <Part id="prediction" title={t('Race prediction')}>
            {forecast.map(line => <p key={line} className="text-[15px]">{line}</p>)}
          </Part>
        )}

        <div className="flex flex-col gap-2">
          <Button variant="outline" size="lg" className="h-12 rounded-xl text-base" onClick={refit}>{t('Refit next weeks')}</Button>
          <p className="text-sm text-muted-foreground">{t('Fits the coming weeks around your strength week as it is now. This week stays as it is.')}</p>
          <Button variant="outline" size="lg" className="h-12 rounded-xl text-base" onClick={() => setAsking(true)}>{t('Redo questionnaire')}</Button>
          <Button variant="ghost" size="lg" className="h-12 rounded-xl text-base text-destructive" onClick={() => setEnding(true)}>{t('End plan')}</Button>
        </div>
      </>}

      <RunQuestionnaire open={asking} onOpenChange={setAsking} initial={readable ? plan.answers : undefined} onCreated={() => setOffer(true)} />

      <Drawer open={ending} onOpenChange={setEnding}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{t('End your running plan?')}</DrawerTitle>
            <DrawerDescription>{t('Your strength week and your check-ins stay.')}</DrawerDescription>
          </DrawerHeader>
          <DrawerFooter className="pb-[max(1rem,env(safe-area-inset-bottom))]">
            <Button size="lg" variant="destructive" className="h-12 rounded-xl text-base font-semibold" onClick={end}>{t('End plan')}</Button>
            <Button size="lg" variant="ghost" className="h-12 rounded-xl text-base" onClick={() => setEnding(false)}>{t('Cancel')}</Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  )
}

function Tags({ plan, today, ws }: { plan: RunPlan; today: string; ws: 0 | 1 }) {
  const race = RACES.includes(plan.goal)
  const tags = [goalName(plan.goal)]
  if (race) tags.push(plan.goalType === 'time' && plan.targetTime ? t('Target {0}', formatClock(plan.targetTime)) : t('Finish the race'))
  if (plan.raceDate) tags.push(t('Race on {0}', dayText(plan.raceDate, today)))
  else if (race && plan.answers?.weeks) tags.push(weeksText(plan.answers.weeks))
  else if (plan.goal === 'maintain') tags.push(t('8-week cycle that starts over'))
  else tags.push(weeksText(plan.weeks.length))
  if (today < plan.startDate) tags.push(t('Starts on {0}', dayText(plan.startDate, today)))
  else if (!currentWeek(plan, today, ws)) tags.push(t('Plan finished'))
  return (
    <ul className="mt-3 flex list-none flex-wrap items-center gap-2">
      {tags.map(tag => <li key={tag} className="rounded-full bg-muted px-3 py-1.5 text-sm font-medium tabular-nums">{tag}</li>)}
    </ul>
  )
}

function WeekList({ plan, today, ws }: { plan: RunPlan; today: string; ws: 0 | 1 }) {
  const current = currentWeek(plan, today, ws)
  const order = weekOrder(ws)
  return (
    <Part id="weeks" title={t('Weeks')}>
      <ol className="flex list-none flex-col gap-2">
        {plan.weeks.map(w => {
          const now = w === current
          const sessions = [...w.sessions].sort((a, b) => order.indexOf(a.day) - order.indexOf(b.day))
          return (
            <li key={w.index} data-week={w.index} aria-current={now ? 'true' : undefined}
              className={cn('rounded-2xl border bg-card px-4 py-3', now ? 'border-2 border-primary' : 'border-border')}>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-[15px] font-semibold">{t('Week {0}', w.index)}</span>
                <span className="text-sm text-muted-foreground">{phaseName(w.phase)}</span>
                {w.recovery && <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">{t('Recovery')}</span>}
                {now && <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">{t('This week')}</span>}
                <span className="ms-auto font-mono text-sm text-muted-foreground tabular-nums">{t('{0} min', weekMinutes(w))}</span>
              </div>
              {now
                ? <ul className="mt-2 flex list-none flex-col gap-3">
                  {sessions.map(s => (
                    <li key={s.id} className="flex flex-col gap-1">
                      <span className="text-sm font-medium">{t(DAYN[s.day])} · {sessionName(s.type)}</span>
                      <SessionBlocks session={s} vdot={plan.vdot} />
                    </li>
                  ))}
                </ul>
                : <p className="mt-1 text-sm text-muted-foreground">{sessions.map(s => sessionName(s.type)).join(', ')}</p>}
            </li>
          )
        })}
      </ol>
    </Part>
  )
}

function Paces({ plan, today }: { plan: RunPlan; today: string }) {
  const zones = zonesOf(plan.weeks.flatMap(w => w.sessions.flatMap(s => s.blocks)))
  const paces = plan.vdot != null ? zonePaces(plan.vdot) : null
  return <>
    {!paces && <p className="text-[15px]">{t('No pace: the plan goes by feel.')}</p>}
    <ul className="flex list-none flex-col gap-2">
      {zones.map(z => (
        <li key={z} className="flex flex-col">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[15px] font-medium text-foreground">{zoneName(z)}</span>
            {paces && z !== 'walk' && <span className="font-mono text-[15px] text-foreground tabular-nums">{formatPaceRange(paces[z])}</span>}
          </div>
          <span className="text-sm">{zoneFeel(z)}</span>
        </li>
      ))}
    </ul>
    {paces && plan.vdotDate && <p className="text-sm">{t('From your race on {0}.', dayText(plan.vdotDate, today))}</p>}
  </>
}

function Part({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`run-plan-${id}`} className="flex flex-col gap-2">
      <h2 id={`run-plan-${id}`} className="text-lg font-semibold tracking-tight">{title}</h2>
      <div className="flex flex-col gap-2 text-muted-foreground">{children}</div>
    </section>
  )
}
