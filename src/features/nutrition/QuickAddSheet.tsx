import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { t } from '../../lib/i18n.js'
import { useNutrition } from './useNutrition'
import { Field, amountText, parseAmount } from './form'
import { MEAL_LABEL } from './labels'
import type { FoodLog, Meal } from './types'

// The diary's limits for one item (food_logs in the 0009 migration).
const MAX_KCAL = 5000
const MAX_MACRO = 500

type Props = { meal: Meal; day: string; log?: FoodLog; open: boolean; onOpenChange: (open: boolean) => void }

// A number from a label or a guess: only the calories are needed, the macros help if known.
export default function QuickAddSheet({ meal, day, log, open, onOpenChange }: Props) {
  const [kcal, setKcal] = useState('')
  const [protein, setProtein] = useState('')
  const [carbs, setCarbs] = useState('')
  const [fat, setFat] = useState('')
  const [name, setName] = useState('')

  useEffect(() => {
    if (!open) return
    setKcal(amountText(log?.kcal)); setName(log?.name ?? '')
    const macro = (n: number | undefined) => (n ? String(n) : '')
    setProtein(macro(log?.protein_g)); setCarbs(macro(log?.carbs_g)); setFat(macro(log?.fat_g))
  }, [open, log])

  const k = parseAmount(kcal)
  const kcalError = k != null && !(Number.isFinite(k) && k <= MAX_KCAL) ? t('Up to 5000 kcal per item.') : null
  const macro = (s: string) => {
    const v = parseAmount(s)
    return { value: v ?? 0, error: v != null && !(Number.isFinite(v) && v <= MAX_MACRO) ? t('Up to 500 g.') : null }
  }
  const p = macro(protein), c = macro(carbs), f = macro(fat)
  const valid = k != null && k > 0 && !kcalError && !p.error && !c.error && !f.error

  const submit = () => {
    if (!valid) return
    const values = { name: name.trim() || t('Quick add'), kcal: k, protein_g: p.value, carbs_g: c.value, fat_g: f.value }
    const s = useNutrition.getState()
    if (log) s.updateLog(log.id, values)
    else s.addLog({ day, meal, brand: null, source: 'quick', source_id: null, grams: null, fiber_g: null, ...values })
    onOpenChange(false)
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[92dvh]">
        <DrawerHeader className="text-left group-data-[vaul-drawer-direction=bottom]/drawer-content:text-left">
          <DrawerTitle className="text-xl">{t('Quick add')}</DrawerTitle>
          <DrawerDescription>{t('{0}. Calories are enough. Add macros if you know them.', MEAL_LABEL[meal]())}</DrawerDescription>
        </DrawerHeader>
        <form id="quick-add" className="flex flex-col gap-4 overflow-y-auto px-4 pb-4" onSubmit={e => { e.preventDefault(); submit() }}>
          <Field id="quick-kcal" label={t('Calories (kcal)')} value={kcal} onChange={setKcal} error={kcalError} numeric />
          <div className="grid grid-cols-3 gap-2">
            <Field id="quick-protein" label={t('Protein (g)')} value={protein} onChange={setProtein} error={p.error} numeric placeholder="0" />
            <Field id="quick-carbs" label={t('Carbs (g)')} value={carbs} onChange={setCarbs} error={c.error} numeric placeholder="0" />
            <Field id="quick-fat" label={t('Fat (g)')} value={fat} onChange={setFat} error={f.error} numeric placeholder="0" />
          </div>
          <Field id="quick-name" label={t('Name')} value={name} onChange={setName} maxLength={120} placeholder={t('Optional')} />
        </form>
        <DrawerFooter className="border-t border-border pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <Button type="submit" form="quick-add" className="h-12 rounded-xl text-[15px]" disabled={!valid}>{log ? t('Save') : t('Add')}</Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
