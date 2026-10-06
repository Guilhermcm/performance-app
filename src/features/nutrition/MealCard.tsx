import { useId } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { t } from '../../lib/i18n.js'
import { MEAL_LABEL, fmtGrams, fmtKcal } from './labels'
import type { FoodLog, Meal } from './types'

type Props = {
  meal: Meal
  logs: FoodLog[]
  editable: boolean
  onAdd: (meal: Meal) => void
  onEdit: (log: FoodLog) => void
  onDelete: (log: FoodLog) => void
}

// One meal of the day: its total, its items (tap to edit, the bin to delete) and "+".
export default function MealCard({ meal, logs, editable, onAdd, onEdit, onDelete }: Props) {
  const id = useId()
  const total = logs.reduce((n, l) => n + l.kcal, 0)
  const name = MEAL_LABEL[meal]()

  return (
    <section aria-labelledby={id} className="rounded-2xl bg-card">
      <header className="flex min-h-14 items-center gap-2 py-1 pl-4 pr-1.5">
        <h2 id={id} className="flex-1 text-[15px] font-semibold">{name}</h2>
        <span data-testid="meal-total" className="font-mono text-sm tabular-nums text-muted-foreground">{fmtKcal(total)}</span>
        {editable && (
          <Button variant="ghost" size="icon" className="size-11 rounded-full" aria-label={t('Add to {0}', name)} onClick={() => onAdd(meal)}>
            <Plus aria-hidden className="size-5" />
          </Button>
        )}
      </header>

      {logs.length > 0 ? (
        <ul className="flex list-none flex-col border-t border-border p-0">
          {logs.map(l => {
            const detail = [l.brand, l.grams ? fmtGrams(l.grams) : null].filter(Boolean).join(', ')
            return (
              <li key={l.id} className="flex items-center gap-1 pr-1.5 animate-in fade-in-0 duration-150 motion-reduce:animate-none">
                <button type="button" disabled={!editable} onClick={() => onEdit(l)}
                  className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-xl py-2 pl-4 text-left outline-none transition-colors duration-150 hover:bg-secondary/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-default disabled:hover:bg-transparent">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px]">{l.name}</span>
                    {detail && <span className="block truncate text-xs text-muted-foreground">{detail}</span>}
                  </span>
                  <span className="font-mono text-sm tabular-nums">{fmtKcal(l.kcal)}</span>
                </button>
                {editable && (
                  <Button variant="ghost" size="icon" className="size-11 shrink-0 rounded-full text-muted-foreground"
                    aria-label={t('Delete {0}', l.name)} onClick={() => onDelete(l)}>
                    <Trash2 aria-hidden className="size-4" />
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      ) : (
        <div className="flex items-center justify-between gap-3 border-t border-border py-2 pl-4 pr-2">
          <p className="text-sm text-muted-foreground">{t('Nothing logged yet.')}</p>
          {editable && <Button variant="secondary" className="h-11 rounded-xl" onClick={() => onAdd(meal)}>{t('Add')}</Button>}
        </div>
      )}
    </section>
  )
}
