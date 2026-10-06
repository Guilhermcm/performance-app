import type { ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { dateLocale, t } from '../../lib/i18n.js'

// One day of the grid. `state` is the caller's key (styled through stateClassName and exposed as
// data-state); `label` names that state and `icon` draws it, so a state never rests on colour alone;
// `accessibleText` is the whole thing read out ("Thursday 1 October: On target").
export type CalendarCell = {
  day: string // YYYY-MM-DD
  state: string
  label: string
  icon: ReactNode
  accessibleText: string
  // false: shown and named, not a button (a day outside the record, a day to come). Default true.
  selectable?: boolean
  // Today: aria-current="date".
  current?: boolean
}

// A Monday-to-Sunday row; a null cell is a day of another month, left blank. The summary sits
// under the row ("4/5 on target" and a badge, for nutrition).
export type CalendarWeek = { start: string; cells: (CalendarCell | null)[]; summary?: ReactNode }

export type CalendarLegendItem = { state: string; label: string; icon: ReactNode }

export type MonthCalendarProps = {
  month: string // YYYY-MM
  weeks: CalendarWeek[]
  onSelectDay: (day: string) => void
  onPrevMonth: () => void
  onNextMonth: () => void
  // The first and last months navigation reaches (YYYY-MM); null or absent leaves that side open.
  minMonth?: string | null
  maxMonth?: string | null
  // Classes per state key, laid on the day's button or tile.
  stateClassName?: Record<string, string>
  legend?: CalendarLegendItem[]
  // Shown instead of the grid: a month with nothing to show, offline, an error.
  empty?: ReactNode
  // The grid's shape in skeleton while the month is read.
  loading?: boolean
}

const noon = (iso: string) => new Date(iso + 'T12:00:00')
const capitalize = (s: string) => s.charAt(0).toLocaleUpperCase(dateLocale()) + s.slice(1)

// Monday first: 2024-01-01 was a Monday.
const weekdays = () => Array.from({ length: 7 }, (_, i) => {
  const d = noon(`2024-01-0${i + 1}`)
  return { long: d.toLocaleDateString(dateLocale(), { weekday: 'long' }), short: d.toLocaleDateString(dateLocale(), { weekday: 'narrow' }) }
})

// Rows the month takes in a Monday-first grid, for the skeleton.
function rowsOf(month: string): number {
  const [y, m] = month.split('-').map(Number)
  const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7
  const days = new Date(y, m, 0).getDate()
  return Math.ceil((lead + days) / 7)
}

// A month as a Monday-first grid, presentational only: the caller maps its records to cells (the
// nutrition history now, sleep nights later). Every day keeps a 44 px target; the day number is in
// tabular mono so the columns line up.
export default function MonthCalendar({
  month, weeks, onSelectDay, onPrevMonth, onNextMonth, minMonth, maxMonth, stateClassName = {}, legend, empty, loading
}: MonthCalendarProps) {
  const title = capitalize(noon(`${month}-01`).toLocaleDateString(dateLocale(), { month: 'long', year: 'numeric' }))
  const canPrev = !minMonth || month > minMonth
  const canNext = !maxMonth || month < maxMonth
  const heads = weekdays()
  const titleId = `calendar-${month}`

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3">
      <header className="flex items-center gap-1">
        <Button variant="ghost" size="icon" className="size-11 rounded-full" aria-label={t('Previous month')} disabled={!canPrev} onClick={onPrevMonth}>
          <ChevronLeft aria-hidden className="size-5 rtl:rotate-180" />
        </Button>
        <h2 id={titleId} aria-live="polite" className="flex-1 text-center text-[15px] font-semibold">{title}</h2>
        <Button variant="ghost" size="icon" className="size-11 rounded-full" aria-label={t('Next month')} disabled={!canNext} onClick={onNextMonth}>
          <ChevronRight aria-hidden className="size-5 rtl:rotate-180" />
        </Button>
      </header>

      {empty ? empty : loading ? (
        <div role="status" aria-busy="true" aria-label={t('Loading…')} className="flex flex-col gap-1">
          {Array.from({ length: rowsOf(month) }, (_, r) => (
            <div key={r} className="flex flex-col gap-1">
              <div className="grid grid-cols-7 gap-0.5">
                {Array.from({ length: 7 }, (_, c) => <Skeleton key={c} data-testid="calendar-skeleton-day" className="h-12 rounded-xl" />)}
              </div>
              <Skeleton className="ml-auto h-4 w-24" />
            </div>
          ))}
        </div>
      ) : (
        <table aria-labelledby={titleId} className="w-full table-fixed border-separate border-spacing-x-0.5 border-spacing-y-0">
          <thead>
            <tr>
              {heads.map(d => (
                <th key={d.long} scope="col" className="pb-1 text-center text-xs font-medium text-muted-foreground">
                  <abbr title={d.long} className="no-underline">{d.short}</abbr>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map(w => [
              <tr key={w.start}>
                {w.cells.map((c, i) => (
                  <td key={c?.day ?? `${w.start}-${i}`} className="p-0 pt-1 align-top">
                    {c && <Day cell={c} className={stateClassName[c.state]} onSelect={onSelectDay} />}
                  </td>
                ))}
              </tr>,
              w.summary ? (
                <tr key={w.start + '-summary'}>
                  <td colSpan={7} className="p-0 pt-0.5 text-right text-xs text-muted-foreground">{w.summary}</td>
                </tr>
              ) : null
            ])}
          </tbody>
        </table>
      )}

      {legend && legend.length > 0 && (
        <ul aria-label={t('Legend')} className="flex list-none flex-wrap gap-x-4 gap-y-2 p-0 text-xs text-muted-foreground">
          {legend.map(l => (
            <li key={l.state} className="flex items-center gap-1.5">
              <span aria-hidden data-state={l.state} className={cn('grid size-5 place-items-center rounded-md', stateClassName[l.state])}>{l.icon}</span>
              {l.label}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Day({ cell, className, onSelect }: { cell: CalendarCell; className?: string; onSelect: (day: string) => void }) {
  const number = Number(cell.day.slice(8))
  const body = (
    <>
      <span className="font-mono text-sm leading-none tabular-nums">{number}</span>
      <span aria-hidden className="grid h-4 place-items-center">{cell.icon}</span>
    </>
  )
  const shape = cn(
    'flex min-h-12 w-full flex-col items-center justify-center gap-1 rounded-xl py-1',
    cell.current && 'font-semibold',
    className
  )
  if (cell.selectable === false) {
    return <div role="img" aria-label={cell.accessibleText} data-state={cell.state} className={shape}>{body}</div>
  }
  return (
    <button type="button" aria-label={cell.accessibleText} aria-current={cell.current ? 'date' : undefined} data-state={cell.state}
      onClick={() => onSelect(cell.day)}
      className={cn(shape, 'outline-none transition-colors duration-150 hover:bg-secondary/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none')}>
      {body}
    </button>
  )
}
