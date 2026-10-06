import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { t } from '../../lib/i18n.js'
import { useNutrition } from './useNutrition'
import { Field, amountText, parseAmount } from './form'
import type { Measure } from './types'

// Spec 3.1, the same limits the server checks.
export const MEASURE_NAME_MAX = 30
export const MEASURE_MIN_G = 1
export const MEASURE_MAX_G = 2000
export const MEASURES_PER_FOOD = 10

type Props = {
  foodKey: string
  // The measure to edit; without it the sheet creates one.
  measure?: Measure
  // The current portion, the starting grams of a new measure.
  defaultGrams: number
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: (measure: Measure) => void
}

const clampGrams = (g: number) => Math.min(MEASURE_MAX_G, Math.max(MEASURE_MIN_G, Math.round(g * 10) / 10))

// A personal household measure of one food: a name and its grams. Creates a new one (the portion
// in use comes filled in), or edits and deletes `measure`. The store does not check the limits,
// so they are checked here; the server checks them again.
export default function MeasureSheet({ foodKey, measure, defaultGrams, open, onOpenChange, onSaved }: Props) {
  const [name, setName] = useState('')
  const [text, setText] = useState('')
  const all = useNutrition(s => s.measures)
  const count = useMemo(() => all.filter(m => m.food_key === foodKey).length, [all, foodKey])

  useEffect(() => {
    if (!open) return
    setName(measure?.label ?? '')
    setText(amountText(measure ? measure.grams : clampGrams(defaultGrams)))
  }, [open, measure, defaultGrams])

  const label = name.trim()
  const nameError = label.length > MEASURE_NAME_MAX ? t('Use 1 to 30 characters.') : null
  const grams = parseAmount(text)
  const gramsOk = grams != null && Number.isFinite(grams) && grams >= MEASURE_MIN_G && grams <= MEASURE_MAX_G
  const gramsError = !gramsOk && text.trim() !== '' ? t('Use between 1 and 2000 g.') : null
  const full = !measure && count >= MEASURES_PER_FOOD
  const valid = label.length >= 1 && !nameError && gramsOk && !full

  const submit = () => {
    if (!valid) return
    const g = Math.round(grams * 10) / 10
    const s = useNutrition.getState()
    if (measure) {
      s.updateMeasure(measure.id, { label, grams: g })
      onSaved?.({ ...measure, label, grams: g })
    } else {
      // Not inside onSaved?.(…): an optional call skips its arguments when there is no callback.
      const created = s.addMeasure({ food_key: foodKey, label, grams: g })
      onSaved?.(created)
    }
    onOpenChange(false)
  }

  const remove = () => {
    if (!measure) return
    useNutrition.getState().removeMeasure(measure.id)
    onOpenChange(false)
    const { food_key, label: was, grams: g } = measure
    toast(t('{0} removed', was), { action: { label: t('Undo'), onClick: () => useNutrition.getState().addMeasure({ food_key, label: was, grams: g }) } })
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader className="text-left group-data-[vaul-drawer-direction=bottom]/drawer-content:text-left">
          <DrawerTitle className="text-xl">{measure ? t('Edit measure') : t('New measure')}</DrawerTitle>
          <DrawerDescription>{t('A household measure of this food, like a ladle or a slice.')}</DrawerDescription>
        </DrawerHeader>

        <form className="flex flex-col gap-4 overflow-y-auto px-4 pb-4" onSubmit={e => { e.preventDefault(); submit() }}>
          {full && <p role="status" className="rounded-2xl bg-card p-4 text-sm text-muted-foreground">{t('This food already has 10 measures. Delete one to add another.')}</p>}
          <Field id="measure-name" label={t('Name')} value={name} onChange={setName} error={nameError} placeholder={t('ladle')} />
          <Field id="measure-grams" label={t('Grams')} value={text} onChange={setText} error={gramsError} numeric
            trailing={<span aria-hidden className="text-sm text-muted-foreground">g</span>} />
        </form>

        <DrawerFooter className="border-t border-border pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <Button className="h-12 rounded-xl text-[15px]" disabled={!valid} onClick={submit}>
            {measure ? t('Save') : t('Create measure')}
          </Button>
          {measure && (
            <Button variant="ghost" className="h-12 gap-2 rounded-xl text-[15px] text-destructive" onClick={remove}>
              <Trash2 aria-hidden className="size-4" />{t('Delete')}
            </Button>
          )}
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
