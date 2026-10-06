import { useEffect, useState, type ReactNode } from 'react'
import { Minus, Plus, Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { t } from '../../lib/i18n.js'
import { portion } from './portion'
import { keyOf, useNutrition } from './useNutrition'
import { MacroLine } from './MacroLine'
import { amountText, parseAmount } from './form'
import { fmtGrams, fmtNumber } from './labels'
import type { FoodItem, FoodLog, Meal } from './types'

const SHORTCUTS = [50, 100, 150, 200] as const
const STEP = 10
const MAX_G = 5000

type Props = { item: FoodItem; meal: Meal; day: string; log?: FoodLog; open: boolean; onOpenChange: (open: boolean) => void }

// How much of a food: grams with a stepper, shortcuts and the label serving, the totals as they
// change, and a star that keeps the food among the favourites. Adds to the meal, or edits `log`.
export default function PortionSheet({ item, meal, day, log, open, onOpenChange }: Props) {
  const [text, setText] = useState('')
  const favorite = useNutrition(s => s.foods.some(f => f.favorite && keyOf(f) === keyOf(item)))

  useEffect(() => {
    if (open) setText(amountText(log?.grams ?? item.serving_g ?? 100))
  }, [open, log, item])

  const grams = parseAmount(text)
  const valid = grams != null && Number.isFinite(grams) && grams > 0 && grams <= MAX_G
  const totals = portion(item.per100, valid ? grams : 0)
  const setGrams = (g: number) => setText(String(Math.round(g * 10) / 10))
  const step = (dir: 1 | -1) => setGrams(Math.min(MAX_G, Math.max(STEP, (valid ? grams : 0) + dir * STEP)))

  const submit = () => {
    if (!valid) return
    const s = useNutrition.getState()
    if (log) s.updateLog(log.id, { grams, ...totals })
    else s.addLog({ day, meal, name: item.name, brand: item.brand, source: item.source, source_id: item.source_id, grams, ...totals })
    onOpenChange(false)
  }

  const serving = item.serving_g && item.serving_g > 0 ? item.serving_g : null

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[92dvh]">
        <DrawerHeader className="flex-row items-start gap-3 text-left group-data-[vaul-drawer-direction=bottom]/drawer-content:text-left">
          <div className="min-w-0 flex-1">
            <DrawerTitle className="text-xl text-balance">{item.name}</DrawerTitle>
            <DrawerDescription>{item.brand || t('{0} kcal per 100 g', fmtNumber(item.per100.kcal))}</DrawerDescription>
          </div>
          <Button variant="ghost" size="icon" className="size-11 shrink-0 rounded-full" aria-pressed={favorite}
            aria-label={favorite ? t('Remove from favorites') : t('Add to favorites')}
            onClick={() => useNutrition.getState().toggleFavorite(item)}>
            <Star aria-hidden className={cn('size-5 transition-colors duration-150', favorite && 'fill-current text-[var(--pillar-nutrition)]')} />
          </Button>
        </DrawerHeader>

        <div className="flex flex-col gap-4 overflow-y-auto px-4 pb-4">
          <div className="flex items-center justify-between gap-3 rounded-2xl bg-card p-2">
            <Button variant="secondary" size="icon" className="size-12 rounded-xl" aria-label={t('Less')}
              disabled={valid && grams <= STEP} onClick={() => step(-1)}><Minus className="size-5" /></Button>
            <div className="flex items-baseline gap-1">
              <Input value={text} inputMode="decimal" autoComplete="off" aria-label={t('Grams')} aria-invalid={!valid || undefined}
                onChange={e => setText(e.target.value)}
                className="h-12 w-24 border-0 bg-transparent text-center font-mono text-2xl font-semibold tabular-nums shadow-none focus-visible:ring-0 dark:bg-transparent" />
              <span aria-hidden className="text-sm text-muted-foreground">g</span>
            </div>
            <Button variant="secondary" size="icon" className="size-12 rounded-xl" aria-label={t('More')}
              disabled={valid && grams >= MAX_G} onClick={() => step(1)}><Plus className="size-5" /></Button>
          </div>
          {!valid && text.trim() !== '' && <p className="-mt-2 text-xs text-destructive">{t('Use between 1 and 5000 g.')}</p>}

          <div className="flex flex-wrap gap-2">
            {serving && (
              <Chip on={valid && grams === serving} onClick={() => setGrams(serving)}>
                {item.serving_label ? `${item.serving_label} (${fmtGrams(serving)})` : t('Label serving ({0})', fmtGrams(serving))}
              </Chip>
            )}
            {SHORTCUTS.map(g => <Chip key={g} on={valid && grams === g} onClick={() => setGrams(g)}>{fmtGrams(g)}</Chip>)}
          </div>

          <div className="flex items-end justify-between gap-3 rounded-2xl border border-border p-4">
            <div>
              <span data-testid="portion-kcal" aria-live="polite" className="font-mono text-3xl font-semibold tabular-nums">{fmtNumber(totals.kcal)}</span>
              <span className="ml-1 text-sm text-muted-foreground">kcal</span>
            </div>
            <MacroLine protein={totals.protein_g} carbs={totals.carbs_g} fat={totals.fat_g} />
          </div>
        </div>

        <DrawerFooter className="border-t border-border pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <Button className="h-12 rounded-xl text-[15px]" disabled={!valid} onClick={submit}>{log ? t('Save') : t('Add')}</Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={cn('min-h-11 rounded-full border px-4 font-mono text-sm tabular-nums outline-none transition-colors duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/50',
        on ? 'border-primary bg-primary/10 text-foreground' : 'border-border bg-card text-muted-foreground')}>
      {children}
    </button>
  )
}
