import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { t } from '../../lib/i18n.js'
import { labelDescription, periodTitle, type LabelRow } from './chart-data'
import { BAR_LIST, BAR_ROW, TRACKER_CHART_CARD } from './TrackerChartSkeleton'

// Spec 8.5 for label trackers: one horizontal bar per option, in the options order and zeros
// included, one colour (--chart-bar), the option and its count in text on every bar so the colour
// never carries anything alone. `days` is the period, for the words when it is empty.
export default function TrackerBars({ rows, days }: { rows: LabelRow[]; days: number }) {
  const [table, setTable] = useState(false)
  const id = useId()
  const top = Math.max(0, ...rows.map(r => r.count))

  return (
    <section data-slot="tracker-bars" aria-labelledby={id}
      className={cn(TRACKER_CHART_CARD, 'animate-in fade-in-0 duration-200 motion-reduce:animate-none')}>
      <h2 id={id} className="flex h-7 items-center text-[15px] font-semibold">{periodTitle(days)}</h2>
      <p className="min-h-8 text-xs leading-4 text-muted-foreground">{labelDescription(rows, days)}</p>

      {table ? <BarsTable rows={rows} /> : (
        <ul className={BAR_LIST}>
          {rows.map(({ option, count }) => (
            <li key={option.id} data-slot="label-bar" data-option={option.id} className={BAR_ROW}>
              <span data-testid="bar-option" className="truncate text-sm leading-4">{option.text}</span>
              <span className="flex h-4 items-center gap-2">
                <span aria-hidden className="flex h-4 flex-1 items-center">
                  {count > 0 && (
                    <span data-slot="bar-fill" className="h-4 rounded-e-[4px] bg-[var(--chart-bar)] transition-[width] duration-300 motion-reduce:transition-none"
                      style={{ width: `${(count / top) * 100}%` }} />
                  )}
                </span>
                <span data-testid="bar-count" className="min-w-6 text-end font-mono text-xs tabular-nums text-foreground">{count}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      <Button variant="outline" className="h-11 self-start rounded-xl" onClick={() => setTable(v => !v)}>
        {table ? t('Show as chart') : t('Show as table')}
      </Button>
    </section>
  )
}

function BarsTable({ rows }: { rows: LabelRow[] }) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="text-xs text-muted-foreground">
          <th scope="col" className="py-2 text-start font-normal">{t('Option')}</th>
          <th scope="col" className="py-2 text-end font-normal">{t('Entries')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ option, count }) => (
          <tr key={option.id} className="border-t border-border">
            <th scope="row" className="py-2 text-start font-normal">{option.text}</th>
            <td className="py-2 text-end font-mono tabular-nums">{count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
