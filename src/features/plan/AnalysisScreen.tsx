// /plan/analise (spec §5.8): what the week of routines asks of each muscle group, against the range
// of the person's goal. The goal on top; the sets per group as bars (or a table); frequency;
// balance; time per routine; then the alerts, each with what to change and, when the app can make
// the change itself, "Apply" with a preview and an Undo.
//
// The chart follows the dataviz skill: one series, so one colour (--chart-bar, validated in both
// themes against the card and the band); thin bars with a rounded data end; the recommended range
// as a neutral band; every value in text beside its bar, in text colours; a table view.
import { Fragment, useEffect, useId, useMemo, useRef, useState, type ReactNode, type Ref } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { InfoSource } from '@/components/ui/info-source'
import { cn } from '@/lib/utils'
import { dateLocale, exerciseNameClass, exerciseNameFor, t } from '../../lib/i18n.js'
import { EXIDX, exOr } from '../../lib/exercises.js'
import { useStore } from '../../store/useStore.js'
import type { Alert, PlanAnalysis } from './analysis'
import {
  GROUPS, alertHint, alertPhrase, balancedText, capitalize, daysText, frequencyNote, goalText, groupLabel,
  pushPullText, quadHamText, statusLabel, unknownText,
} from './analysis-copy'
import { useAnalysisProfile, usePlanAnalysis, usePlanStart } from './use-plan-analysis'
import { RANGES, type AnalysisProfile } from './goal'
import { RULE_OF_THUMB, type SourceId } from './references'
import { applySuggestion, restoreRoutines, suggestionsFor, type Change, type Suggestion, type SuggestionState } from './suggestions'

type NamedRoutine = { id: string; name?: string; ex: { id: string; sets: number; [k: string]: unknown }[]; [k: string]: unknown }
type PlanS = SuggestionState & { routines: NamedRoutine[] }
type AppStore = { S: PlanS; update(fn: (s: PlanS) => void): void }

const FREQUENCY_REFS: Record<AnalysisProfile, SourceId[]> = {
  hypertrophy: ['schoenfeld2016'],
  strength: ['grgic2018freq'],
  health: ['who2020'],
}

// Marks where a name goes in a translated sentence, so the name can carry its own casing class.
const SLOT = '\u0001'
function withName(text: string, name: ReactNode): ReactNode {
  const [before, after = ''] = text.split(SLOT)
  return <>{before}{name}{after}</>
}

const fmt = (n: number) => new Intl.NumberFormat(dateLocale(), { maximumFractionDigits: 1 }).format(n)

// A custom exercise keeps the exact name the person gave it; a catalogue one is translated.
const customName = (S: PlanS, id: string): string | undefined =>
  ((S.customEx ?? []) as { id?: string; n?: string }[]).find(e => e?.id === id)?.n
const exText = (S: PlanS, id: string): string => customName(S, id) || exerciseNameFor(exOr(id))

function ExName({ S, id }: { S: PlanS; id: string }) {
  const custom = customName(S, id)
  if (custom) return <span>{custom}</span>
  return <span className={exerciseNameClass((EXIDX as Record<string, unknown>)[id])}>{exerciseNameFor(exOr(id))}</span>
}

const routineName = (S: PlanS, id: string): string => String(S.routines.find(r => r.id === id)?.name ?? '')

// An alert's title as text (for the Apply label and the preview) and as a node (the heading).
function alertTitle(S: PlanS, alert: Alert, analysis: PlanAnalysis): { text: string; node: ReactNode } {
  if (alert.kind === 'long') {
    const minutes = analysis.minutes.find(m => m.routineId === alert.routineId)?.minutes ?? 0
    const text = t('{0} takes about {1} min', routineName(S, alert.routineId ?? ''), minutes)
    return { text, node: text }
  }
  if (alert.kind === 'repeated') {
    const id = alert.exId ?? ''
    return {
      text: t('{0} is on 3 or more days of the week', exText(S, id)),
      node: withName(t('{0} is on 3 or more days of the week', SLOT), <ExName S={S} id={id} />),
    }
  }
  const text = capitalize(alertPhrase(alert, analysis))
  return { text, node: text }
}

export default function AnalysisScreen() {
  const navigate = useNavigate()
  const { goal, profile } = useAnalysisProfile()
  const S = useStore((s: AppStore) => s.S)
  const update = useStore((s: AppStore) => s.update)
  const analysis = usePlanAnalysis(profile)
  const start = usePlanStart(analysis)
  const suggestions = useMemo(() => (analysis.empty ? [] : suggestionsFor(S, profile)), [S, profile, analysis.empty])
  const goBack = () => (window.history.state?.idx > 0 ? navigate(-1) : navigate('/plan'))

  // The last change applied here, for Undo while this screen is open (plan decision 5).
  const last = useRef<{ token: number; snapshot: { id: string }[] } | null>(null)
  const seq = useRef(0)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<{ suggestion: Suggestion; title: string } | null>(null)
  const opener = useRef<HTMLElement | null>(null)
  const confirmed = useRef(false)
  const alertsHeading = useRef<HTMLHeadingElement>(null)

  const openApply = (suggestion: Suggestion, title: string, from: HTMLElement) => {
    opener.current = from
    confirmed.current = false
    setPending({ suggestion, title })
    setOpen(true)
  }

  const undo = (token: number) => {
    const saved = last.current
    if (!alive.current || !saved || saved.token !== token) {
      toast(t('Nothing to undo'))
      return
    }
    last.current = null
    useStore.getState().update((s: PlanS) => { restoreRoutines(s, saved.snapshot) })
    toast(t('Change undone'))
  }

  const confirm = () => {
    if (!pending) return
    let snapshot: { id: string }[] = []
    update(s => { snapshot = applySuggestion(s, pending.suggestion) })
    const token = ++seq.current
    last.current = { token, snapshot }
    confirmed.current = true
    setOpen(false)
    toast(t('Change applied'), { action: { label: t('Undo'), onClick: () => undo(token) } })
  }

  // Cancel gives the focus back to the Apply that opened the preview. After applying, that alert
  // is usually gone, so the focus goes to the alerts heading.
  const onCloseAutoFocus = (e: Event) => {
    e.preventDefault()
    const back = opener.current
    if (!confirmed.current && back?.isConnected) back.focus()
    else alertsHeading.current?.focus()
  }

  const byGroup = new Map(suggestions.map(s => [s.group, s]))
  const suggestionFor = (a: Alert) => (a.group && (a.kind === 'missing' || a.kind === 'low' || a.kind === 'high') ? byGroup.get(a.group) : undefined)
  const unbalanced = (kind: Alert['kind']) => analysis.alerts.some(a => a.kind === kind)
  const balanceLines = [pushPullText(analysis.balance, unbalanced('balance-push-pull')), quadHamText(analysis.balance, unbalanced('balance-quad-ham'))]
    .filter((line): line is string => !!line)

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 pb-6 font-sans text-foreground">
      <header className="flex flex-col">
        <div className="-ml-2 flex h-11 items-center">
          <Button variant="ghost" size="icon" className="size-11 rounded-full" aria-label={t('Back')} onClick={goBack}>
            <ArrowLeft aria-hidden className="size-5 rtl:rotate-180" />
          </Button>
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{t('Plan analysis')}</h1>
        <p className="mt-1 text-[15px] text-muted-foreground">{goalText(profile)}</p>
        {!goal && (
          <Button variant="link" className="h-11 self-start px-0 text-[15px]" onClick={() => navigate('/perfil')}>{t('Set your goal in Profile')}</Button>
        )}
      </header>

      {start !== 'ready' ? (
        <div className="rounded-2xl border border-border bg-card px-4 py-3">
          {start === 'empty'
            ? <Button variant="link" className="h-11 px-0 text-[15px]" onClick={() => navigate('/plan/programas')}>{t('Pick a program to start')}</Button>
            : <Button variant="link" className="h-11 px-0 text-[15px]" onClick={() => navigate('/plan')}>{t('Put a routine on a day of the week')}</Button>}
        </div>
      ) : (
        <>
          <Part id="volume" title={t('Weekly sets per muscle')} info={<InfoSource refs={RANGES[profile].refs} />}>
            <Volume S={S} analysis={analysis} profile={profile} />
          </Part>

          <Part id="frequency" title={t('Frequency')} info={<InfoSource refs={FREQUENCY_REFS[profile]} />}>
            <p className="text-[15px]">{frequencyNote(profile)}</p>
            <p className="text-sm text-muted-foreground">{t('Days in the week each muscle gets at least 2 sets.')}</p>
            <ul className="mt-1 flex list-none flex-col">
              {GROUPS.filter(g => analysis.groups[g].sets > 0).map(g => (
                <li key={g} data-testid={`frequency-${g}`} className="flex min-h-9 items-center justify-between gap-3 border-t border-border text-sm first:border-t-0">
                  <span>{groupLabel(g)}</span>
                  <span className="tabular-nums text-muted-foreground">{daysText(analysis.groups[g].days)}</span>
                </li>
              ))}
            </ul>
          </Part>

          {balanceLines.length > 0 && (
            <Part id="balance" title={t('Balance')} info={<InfoSource refs={[RULE_OF_THUMB]} />}>
              {balanceLines.map(line => <p key={line} className="text-[15px]">{line}</p>)}
            </Part>
          )}

          <Part id="time" title={t('Time per routine')}
            info={<InfoSource refs={[]} label={t('How the time is estimated')}
              note={t('The app’s estimate: each set counts its own rest plus 40 s to do it. With no rest set, it counts 90 s. Each workout adds 5 min to warm up.')} />}>
            <ul className="flex list-none flex-col">
              {analysis.minutes.map(m => (
                <li key={m.routineId} data-testid={`minutes-${m.routineId}`} className="flex min-h-9 items-center justify-between gap-3 border-t border-border text-sm first:border-t-0">
                  <span className="min-w-0 truncate">{routineName(S, m.routineId)}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{t('About {0} min', m.minutes)}</span>
                </li>
              ))}
            </ul>
          </Part>

          <Part id="alerts" title={t('Alerts')} headingRef={alertsHeading}>
            {analysis.alerts.length === 0 ? (
              <p className="text-[15px]">{balancedText(profile)}</p>
            ) : (
              <ul className="flex list-none flex-col gap-2">
                {analysis.alerts.map((alert, i) => (
                  <li key={`${alert.kind}-${alert.group ?? alert.routineId ?? alert.exId ?? i}`}>
                    <AlertItem S={S} alert={alert} analysis={analysis} suggestion={suggestionFor(alert)} onApply={openApply} />
                  </li>
                ))}
              </ul>
            )}
          </Part>
        </>
      )}

      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent onCloseAutoFocus={onCloseAutoFocus}>
          <DrawerHeader>
            <DrawerTitle>{t('Apply this change?')}</DrawerTitle>
            <DrawerDescription>{pending?.title}</DrawerDescription>
          </DrawerHeader>
          {pending && <ChangeList S={S} changes={pending.suggestion.changes} />}
          <DrawerFooter className="pb-[max(1rem,env(safe-area-inset-bottom))]">
            <Button size="lg" className="h-12 rounded-xl text-base font-semibold" onClick={confirm}>{t('Apply')}</Button>
            <Button size="lg" variant="ghost" className="h-12 rounded-xl text-base" onClick={() => setOpen(false)}>{t('Cancel')}</Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  )
}

function Part({ id, title, info, headingRef, children }: {
  id: string; title: string; info?: ReactNode; headingRef?: Ref<HTMLHeadingElement>; children: ReactNode
}) {
  return (
    <section aria-labelledby={`analysis-${id}`} className="flex flex-col gap-2">
      <div className="flex min-h-11 items-center justify-between gap-2">
        <h2 id={`analysis-${id}`} ref={headingRef} tabIndex={headingRef ? -1 : undefined}
          className="text-lg font-semibold tracking-tight outline-none">{title}</h2>
        {info}
      </div>
      {children}
    </section>
  )
}

// One horizontal bar per group on a shared scale from 0, the range as a neutral band behind them,
// the value in text at the end of the row. Or the same numbers as a table.
function Volume({ S, analysis, profile }: { S: PlanS; analysis: PlanAnalysis; profile: AnalysisProfile }) {
  const [table, setTable] = useState(false)
  const { min, max } = RANGES[profile]
  const top = Math.max(max * 1.25, ...GROUPS.map(g => analysis.groups[g].sets))
  const at = (v: number) => `${Math.min(100, (v / top) * 100)}%`
  const range = t('{0} to {1}', min, max)

  return (
    <>
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <span aria-hidden className="h-3 w-4 shrink-0 rounded-[2px] bg-accent ring-1 ring-border" />
        {t('Recommended range: {0} to {1} sets a week', min, max)}
      </p>

      {table ? (
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{t('Weekly sets per muscle')}</caption>
          <thead>
            <tr className="text-xs text-muted-foreground">
              <th scope="col" className="py-2 text-start font-normal">{t('Muscle')}</th>
              <th scope="col" className="py-2 text-end font-normal">{t('Sets')}</th>
              <th scope="col" className="py-2 text-end font-normal">{t('Range')}</th>
              <th scope="col" className="py-2 ps-3 text-start font-normal">{t('Status')}</th>
            </tr>
          </thead>
          <tbody>
            {GROUPS.map(g => (
              <tr key={g} className="border-t border-border">
                <th scope="row" className="py-2.5 text-start font-medium">{groupLabel(g)}</th>
                <td className="py-2.5 text-end font-mono tabular-nums">{fmt(analysis.groups[g].sets)}</td>
                <td className="py-2.5 text-end tabular-nums text-muted-foreground">{range}</td>
                <td className="py-2.5 ps-3 text-muted-foreground">{statusLabel(analysis.groups[g].status)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <figure className="m-0 rounded-2xl border border-border bg-card px-4 py-3">
          <ul className="flex list-none flex-col gap-0.5">
            {GROUPS.map(g => {
              const { sets, status } = analysis.groups[g]
              return (
                <li key={g} data-testid="volume-row" data-group={g}
                  className="grid min-h-11 grid-cols-[6.5rem_minmax(0,1fr)_2.75rem] items-center gap-x-3">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">{groupLabel(g)}</span>
                    {status !== 'ok' && <span className="block truncate text-xs text-muted-foreground">{statusLabel(status)}</span>}
                  </span>
                  <span aria-hidden className="relative h-6 border-s border-border">
                    <span className="absolute inset-y-0 bg-accent" style={{ insetInlineStart: at(min), width: `calc(${at(max)} - ${at(min)})` }} />
                    {sets > 0 && (
                      <span className="absolute top-1/2 h-3 -translate-y-1/2 rounded-e-[4px] bg-[var(--chart-bar)]"
                        style={{ insetInlineStart: 0, width: at(sets) }} />
                    )}
                  </span>
                  <span data-testid="volume-value" className="text-end font-mono text-sm tabular-nums text-foreground">{fmt(sets)}</span>
                </li>
              )
            })}
          </ul>
          {/* the band's edges on the shared scale */}
          <div aria-hidden className="grid grid-cols-[6.5rem_minmax(0,1fr)_2.75rem] gap-x-3">
            <span />
            <span className="relative h-5 text-xs tabular-nums text-muted-foreground">
              {[0, min, max].map(v => (
                <span key={v} className={cn('absolute top-1', v > 0 && '-translate-x-1/2 rtl:translate-x-1/2')} style={{ insetInlineStart: at(v) }}>{fmt(v)}</span>
              ))}
            </span>
            <span />
          </div>
        </figure>
      )}

      <Button variant="outline" className="h-11 self-start rounded-xl" onClick={() => setTable(v => !v)}>
        {table ? t('Show as chart') : t('Show as table')}
      </Button>

      {analysis.unknown.length > 0 && (
        <div className="flex flex-col gap-1 rounded-2xl border border-border bg-card px-4 py-3">
          <p className="text-[15px] font-medium">{unknownText(analysis.unknown.length)}</p>
          <p className="text-sm text-muted-foreground">
            {analysis.unknown.map((id, i) => <Fragment key={id}>{i > 0 && ', '}<ExName S={S} id={id} /></Fragment>)}
          </p>
          <p className="text-sm text-muted-foreground">{t('These count toward the time, not toward the sets.')}</p>
        </div>
      )}
    </>
  )
}

function AlertItem({ S, alert, analysis, suggestion, onApply }: {
  S: PlanS; alert: Alert; analysis: PlanAnalysis; suggestion?: Suggestion
  onApply(s: Suggestion, title: string, from: HTMLElement): void
}) {
  const id = useId()
  const title = alertTitle(S, alert, analysis)
  return (
    <article aria-labelledby={id} className="flex flex-col gap-1 rounded-2xl border border-border bg-card px-4 py-3 text-card-foreground">
      <h3 id={id} className="text-[15px] font-semibold">{title.node}</h3>
      <p className="text-sm text-muted-foreground">{alertHint(alert)}</p>
      {suggestion && (
        <Button variant="outline" className="mt-2 h-11 self-start rounded-xl" aria-label={`${t('Apply')}: ${title.text}`}
          onClick={e => onApply(suggestion, title.text, e.currentTarget)}>{t('Apply')}</Button>
      )}
    </article>
  )
}

// The change before and after, per routine: "Bench press: 3 → 5 sets".
function ChangeList({ S, changes }: { S: PlanS; changes: Change[] }) {
  const routines = [...new Set(changes.map(c => c.routineId))]
  return (
    <div className="flex flex-col gap-3 px-4 pb-2">
      {routines.map(rid => (
        <section key={rid} className="flex flex-col gap-1">
          <h3 className="text-sm font-medium text-muted-foreground">{routineName(S, rid)}</h3>
          <ul className="flex list-none flex-col gap-1 text-[15px] tabular-nums">
            {changes.filter(c => c.routineId === rid).map(c => (
              <li key={c.exId}>
                {withName(c.from === null
                  ? t('{0}: added with {1} sets', SLOT, c.to)
                  : t('{0}: {1} → {2} sets', SLOT, c.from, c.to), <ExName S={S} id={c.exId} />)}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

