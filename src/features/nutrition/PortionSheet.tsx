import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, EllipsisVertical, Minus, Plus, Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { t } from '../../lib/i18n.js'
import { portion } from './portion'
import { keyOf, useNutrition } from './useNutrition'
import { MacroLine } from './MacroLine'
import { amountText, parseAmount } from './form'
import { fmtDecimal, fmtGrams, fmtNumber } from './labels'
import { countedMeasure, loadSuggested, measureKey, mergeMeasures } from './measures'
import MeasureSheet from './MeasureSheet'
import type { FoodItem, FoodLog, Meal, Measure, MeasureOption } from './types'

const SHORTCUTS = [50, 100, 150, 200] as const
const STEP = 10
const MIN_G = 1
const MAX_G = 5000
// Spec 3.3: a measure is multiplied from 0.5 to 20, in halves.
const QTY_STEP = 0.5
const QTY_MAX = 20
const LONG_PRESS_MS = 500
const NO_SUGGESTED: { label: string; grams: number }[] = []

// A chip that is a measure (multiplied by the quantity), by kind and name. The "last time" amount
// and the gram shortcuts only set grams.
type Chosen = { kind: MeasureOption['kind']; id?: string; label: string }
const sameOption = (o: MeasureOption, c: Chosen) => o.kind === c.kind && (o.id ?? o.label) === (c.id ?? c.label)
const timesGrams = (g: number, qty: number) => Math.round(g * qty * 10) / 10

type Props = {
  item: FoodItem; meal: Meal; day: string; log?: FoodLog; open: boolean; onOpenChange: (open: boolean) => void
  // Called when the portion is added or saved, before the sheet closes.
  onSaved?: () => void
}

// How much of a food: grams with a stepper, the household measures of the food (personal,
// suggested by the POF, the label serving) times a quantity, the last amount and gram shortcuts,
// the totals as they change, and a star that keeps the food among the favourites. Adds to the
// meal, or edits `log`; the item keeps only grams and totals, never the measure. A personal
// measure is created here, and edited or deleted from its chip's menu or a long press.
export default function PortionSheet({ item, meal, day, log, open, onOpenChange, onSaved }: Props) {
  const [text, setText] = useState('')
  const [chosen, setChosen] = useState<Chosen | null>(null)
  const [qty, setQty] = useState(1)
  const [suggestedBy, setSuggestedBy] = useState<Record<string, { label: string; grams: number }[]> | null>(null)
  const [sheet, setSheet] = useState<{ measure?: Measure; grams: number } | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const favorite = useNutrition(s => s.foods.some(f => f.favorite && keyOf(f) === keyOf(item)))
  const foods = useNutrition(s => s.foods)
  const measures = useNutrition(s => s.measures)
  const key = useMemo(() => measureKey(item, foods), [item, foods])
  const personal = useMemo(() => (key ? useNutrition.getState().measuresFor(key) : []), [key, measures])

  useEffect(() => {
    if (!open) return
    setText(amountText(log?.grams ?? item.serving_g ?? 100))
    setChosen(null)
    setQty(1)
  }, [open, log, item])

  // The POF measures come with the TACO chunk, on demand.
  const tacoId = item.source === 'taco' ? item.source_id : null
  useEffect(() => {
    if (!open || !tacoId || suggestedBy) return
    let live = true
    loadSuggested().then(m => { if (live) setSuggestedBy(m) }, () => {})
    return () => { live = false }
  }, [open, tacoId, suggestedBy])
  const suggested = (tacoId && suggestedBy?.[tacoId]) || NO_SUGGESTED

  const serving = item.serving_g && item.serving_g > 0 ? item.serving_g : null
  const options = useMemo(() => {
    const out = mergeMeasures(personal, suggested, item)
    // A label serving without a name is still a serving; mergeMeasures leaves it out.
    if (serving && !item.recent && !item.serving_label) out.push({ label: '', grams: serving, kind: 'serving' })
    return out
  }, [personal, suggested, item, serving])

  const current = chosen ? options.find(o => sameOption(o, chosen)) ?? null : null
  const grams = current ? timesGrams(current.grams, qty) : parseAmount(text)
  const valid = grams != null && Number.isFinite(grams) && grams >= MIN_G && grams <= MAX_G
  const totals = portion(item.per100, valid ? grams : 0)

  // A measure deleted (or gone) while in use leaves its grams in the field.
  const lastGrams = useRef(0)
  if (current) lastGrams.current = timesGrams(current.grams, qty)
  useEffect(() => {
    if (chosen && !current) { setText(amountText(lastGrams.current)); setChosen(null); setQty(1) }
  }, [chosen, current])

  const setGrams = (g: number) => { setChosen(null); setQty(1); setText(String(Math.round(g * 10) / 10)) }
  const step = (dir: 1 | -1) => setGrams(Math.min(MAX_G, Math.max(STEP, (valid ? grams : 0) + dir * STEP)))
  const pick = (o: MeasureOption) => {
    if (o.kind === 'last') { setGrams(o.grams); return }
    setChosen({ kind: o.kind, id: o.id, label: o.label })
    setQty(1)
    setText(amountText(o.grams))
    lastGrams.current = o.grams
  }
  const changeQty = (dir: 1 | -1) => {
    if (!current) return
    const q = Math.min(QTY_MAX, Math.max(QTY_STEP, qty + dir * QTY_STEP))
    setQty(q)
    setText(amountText(timesGrams(current.grams, q)))
  }
  const canMore = !!current && qty < QTY_MAX && timesGrams(current.grams, qty + QTY_STEP) <= MAX_G

  const openSheet = (measure?: Measure) => { setSheet({ measure, grams: valid ? grams : 100 }); setSheetOpen(true) }
  const editMeasure = (id: string) => openSheet(personal.find(m => m.id === id))

  const submit = () => {
    if (!valid) return
    const s = useNutrition.getState()
    if (log) s.updateLog(log.id, { grams, ...totals })
    else s.addLog({ day, meal, name: item.name, brand: item.brand, source: item.source, source_id: item.source_id, grams, ...totals })
    onSaved?.()
    onOpenChange(false)
  }

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
              <Input value={current && valid ? amountText(grams) : text} inputMode="decimal" autoComplete="off" aria-label={t('Grams')} aria-invalid={!valid || undefined}
                onChange={e => { setChosen(null); setQty(1); setText(e.target.value) }}
                className="h-12 w-24 border-0 bg-transparent text-center font-mono text-2xl font-semibold tabular-nums shadow-none focus-visible:ring-0 dark:bg-transparent" />
              <span aria-hidden className="text-sm text-muted-foreground">g</span>
            </div>
            <Button variant="secondary" size="icon" className="size-12 rounded-xl" aria-label={t('More')}
              disabled={valid && grams >= MAX_G} onClick={() => step(1)}><Plus className="size-5" /></Button>
          </div>
          {!valid && text.trim() !== '' && <p className="-mt-2 text-xs text-destructive">{t('Use between 1 and 5000 g.')}</p>}

          <div className="flex flex-col gap-2">
            <div role="group" aria-label={t('Portion shortcuts')} className="flex flex-wrap gap-2">
              {options.map(o => {
                const on = !!current && sameOption(o, current)
                const name = o.kind === 'last' ? t('Last time ({0})', fmtGrams(o.grams))
                  : o.kind === 'serving' && !o.label ? t('Label serving ({0})', fmtGrams(o.grams))
                  : `${o.label} (${fmtGrams(o.grams)})`
                const chipOn = o.kind === 'last' ? !current && valid && grams === o.grams : on
                if (o.kind === 'personal' && o.id) {
                  const id = o.id
                  return <PersonalChip key={'p:' + id} on={on} label={o.label} onPick={() => pick(o)} onMenu={() => editMeasure(id)}>{name}</PersonalChip>
                }
                return <Chip key={o.kind + ':' + o.label} on={chipOn} onClick={() => pick(o)}>{name}</Chip>
              })}
              {SHORTCUTS.map(g => <Chip key={g} on={!current && valid && grams === g} onClick={() => setGrams(g)}>{fmtGrams(g)}</Chip>)}
              {key && (
                <button type="button" onClick={() => openSheet()}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-dashed border-border px-4 text-sm text-muted-foreground outline-none transition-colors duration-150 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50">
                  <Plus aria-hidden className="size-4" />{t('Create measure')}
                </button>
              )}
            </div>
            {options.some(o => o.kind === 'suggested') && <p className="text-[11px] text-muted-foreground">{t('Measures: POF 2008-2009, IBGE')}</p>}
          </div>

          {current && (
            <div className="flex items-center justify-between gap-3 rounded-2xl bg-card p-2">
              <Button variant="secondary" size="icon" className="size-12 rounded-xl" aria-label={t('Half a measure less')}
                disabled={qty <= QTY_STEP} onClick={() => changeQty(-1)}><Minus className="size-5" /></Button>
              <div className="flex flex-col items-center">
                <span className="text-xs text-muted-foreground">{t('Quantity')}</span>
                <span className="font-mono text-xl font-semibold tabular-nums">{fmtDecimal(qty)} ×</span>
              </div>
              <Button variant="secondary" size="icon" className="size-12 rounded-xl" aria-label={t('Half a measure more')}
                disabled={!canMore} onClick={() => changeQty(1)}><Plus className="size-5" /></Button>
            </div>
          )}

          <div className="flex flex-col gap-2 rounded-2xl border border-border p-4">
            {current && (
              <p data-testid="portion-measure" aria-live="polite" className="font-mono text-sm tabular-nums text-muted-foreground">
                {measureAmount(current, qty)} · {fmtGrams(timesGrams(current.grams, qty))}
              </p>
            )}
            <div className="flex items-end justify-between gap-3">
            <div>
              <span data-testid="portion-kcal" aria-live="polite" className="font-mono text-3xl font-semibold tabular-nums">{fmtNumber(totals.kcal)}</span>
              <span className="ml-1 text-sm text-muted-foreground">kcal</span>
            </div>
            <MacroLine protein={totals.protein_g} carbs={totals.carbs_g} fat={totals.fat_g} />
            </div>
          </div>
        </div>

        <DrawerFooter className="border-t border-border pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <Button className="h-12 rounded-xl text-[15px]" disabled={!valid} onClick={submit}>{log ? t('Save') : t('Add')}</Button>
        </DrawerFooter>
      </DrawerContent>
      {key && sheet && (
        <MeasureSheet foodKey={key} measure={sheet.measure} defaultGrams={sheet.grams} open={sheetOpen} onOpenChange={setSheetOpen}
          onSaved={m => { if (!sheet.measure) pick({ kind: 'personal', id: m.id, label: m.label, grams: m.grams }) }} />
      )}
    </Drawer>
  )
}

// "2 colheres de servir", "2 × pote". Only the suggested names (a closed set of Brazilian data, always
// Portuguese) are inflected. A personal name is the user's own words, in any language ("mão",
// "1/2 xícara"), and a label serving is text from the package: both are multiplied as written.
function measureAmount(o: MeasureOption, qty: number): string {
  if (o.kind === 'serving') return o.label ? countedMeasure(qty, o.label, false) : t('{0} × label serving', fmtDecimal(qty))
  return countedMeasure(qty, o.label, o.kind === 'suggested')
}

const chipTone = (on: boolean) => (on ? 'border-primary bg-primary/10 text-foreground' : 'border-border bg-card text-muted-foreground')

// The check mark says "selected" without relying on the colour.
function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={cn('inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 font-mono text-sm tabular-nums outline-none transition-colors duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/50', chipTone(on))}>
      {on && <Check aria-hidden className="size-4 shrink-0" />}
      {children}
    </button>
  )
}

// A personal measure: picked with a tap; its menu button, a long press or the context menu open
// it for editing or deleting. A long press does not also pick it.
function PersonalChip({ on, label, onPick, onMenu, children }: { on: boolean; label: string; onPick: () => void; onMenu: () => void; children: ReactNode }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pressed = useRef(false)
  const cancel = () => { if (timer.current) clearTimeout(timer.current); timer.current = null }
  useEffect(() => cancel, [])
  return (
    <span className={cn('inline-flex min-h-11 items-stretch rounded-full border transition-colors duration-150', chipTone(on))}>
      <button type="button" aria-pressed={on}
        onPointerDown={() => { pressed.current = false; cancel(); timer.current = setTimeout(() => { pressed.current = true; onMenu() }, LONG_PRESS_MS) }}
        onPointerUp={cancel} onPointerLeave={cancel} onPointerCancel={cancel}
        onContextMenu={e => { e.preventDefault(); cancel(); pressed.current = true; onMenu() }}
        onClick={() => { if (pressed.current) { pressed.current = false; return } onPick() }}
        className="inline-flex select-none items-center gap-1.5 rounded-l-full pl-4 pr-1 font-mono text-sm tabular-nums outline-none [-webkit-touch-callout:none] focus-visible:ring-[3px] focus-visible:ring-ring/50">
        {on && <Check aria-hidden className="size-4 shrink-0" />}
        {children}
      </button>
      <button type="button" aria-label={t('Options for {0}', label)} onClick={onMenu}
        className="inline-flex w-11 items-center justify-center rounded-r-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
        <EllipsisVertical aria-hidden className="size-4" />
      </button>
    </span>
  )
}
