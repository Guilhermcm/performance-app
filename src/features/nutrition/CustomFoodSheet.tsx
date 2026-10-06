import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { t } from '../../lib/i18n.js'
import { useNutrition } from './useNutrition'
import { Field, parseAmount } from './form'
import type { UserFood } from './types'

// What user_foods accepts (0009 migration), per 100 g.
const MAX_KCAL_100 = 900
const MAX_MACRO_100 = 100
const MAX_SERVING = 2000
const BARCODE = /^[0-9]{8,14}$/

type Props = { barcode?: string; open: boolean; onOpenChange: (open: boolean) => void; onSaved: (food: UserFood) => void }

// A food that is in no table: name, brand, nutrients per 100 g as on the label, an optional
// serving and barcode. Saved among "My foods" and handed back so it can be logged right away.
export default function CustomFoodSheet({ barcode, open, onOpenChange, onSaved }: Props) {
  const [name, setName] = useState('')
  const [brand, setBrand] = useState('')
  const [kcal, setKcal] = useState('')
  const [protein, setProtein] = useState('')
  const [carbs, setCarbs] = useState('')
  const [fat, setFat] = useState('')
  const [serving, setServing] = useState('')
  const [servingLabel, setServingLabel] = useState('')
  const [code, setCode] = useState('')

  useEffect(() => {
    if (!open) return
    setName(''); setBrand(''); setKcal(''); setProtein(''); setCarbs(''); setFat('')
    setServing(''); setServingLabel(''); setCode(barcode ?? '')
  }, [open, barcode])

  const k = parseAmount(kcal)
  const kcalError = k != null && !(Number.isFinite(k) && k <= MAX_KCAL_100) ? t('Up to 900 kcal per 100 g.') : null
  const macro = (s: string) => {
    const v = parseAmount(s)
    return { value: v ?? 0, error: v != null && !(Number.isFinite(v) && v <= MAX_MACRO_100) ? t('Up to 100 g per 100 g.') : null }
  }
  const p = macro(protein), c = macro(carbs), f = macro(fat)
  const sv = parseAmount(serving)
  const servingError = sv != null && !(Number.isFinite(sv) && sv > 0 && sv <= MAX_SERVING) ? t('Use between 1 and 2000 g.') : null
  const digits = code.trim()
  const codeError = digits && !BARCODE.test(digits) ? t('Barcodes have 8 to 14 digits.') : null
  const valid = name.trim().length > 0 && k != null && !kcalError && !p.error && !c.error && !f.error && !servingError && !codeError

  const submit = () => {
    if (!valid) return
    const food = useNutrition.getState().saveFood({
      source: 'custom', source_id: null, name: name.trim(), brand: brand.trim() || null, favorite: false,
      barcode: digits || null,
      per100: { kcal: k, protein: p.value, carbs: c.value, fat: f.value, fiber: null },
      serving_g: sv, serving_label: sv != null ? servingLabel.trim() || null : null
    })
    onSaved(food)
    onOpenChange(false)
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[92dvh]">
        <DrawerHeader className="text-left group-data-[vaul-drawer-direction=bottom]/drawer-content:text-left">
          <DrawerTitle className="text-xl">{t('Create food')}</DrawerTitle>
          <DrawerDescription>{t('Copy the values per 100 g from the label.')}</DrawerDescription>
        </DrawerHeader>
        <form id="custom-food" className="flex flex-col gap-4 overflow-y-auto px-4 pb-4" onSubmit={e => { e.preventDefault(); submit() }}>
          <Field id="food-name" label={t('Name')} value={name} onChange={setName} maxLength={120} />
          <Field id="food-brand" label={t('Brand')} value={brand} onChange={setBrand} maxLength={80} placeholder={t('Optional')} />
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 text-sm font-medium">{t('Per 100 g')}</legend>
            <Field id="food-kcal" label={t('Calories (kcal)')} value={kcal} onChange={setKcal} error={kcalError} numeric />
            <div className="grid grid-cols-3 gap-2">
              <Field id="food-protein" label={t('Protein (g)')} value={protein} onChange={setProtein} error={p.error} numeric placeholder="0" />
              <Field id="food-carbs" label={t('Carbs (g)')} value={carbs} onChange={setCarbs} error={c.error} numeric placeholder="0" />
              <Field id="food-fat" label={t('Fat (g)')} value={fat} onChange={setFat} error={f.error} numeric placeholder="0" />
            </div>
          </fieldset>
          <div className="grid grid-cols-2 gap-2">
            <Field id="food-serving" label={t('Serving (g)')} value={serving} onChange={setServing} error={servingError} numeric placeholder={t('Optional')} />
            <Field id="food-serving-label" label={t('Serving name')} value={servingLabel} onChange={setServingLabel} maxLength={40} placeholder={t('1 slice')} />
          </div>
          <Field id="food-barcode" label={t('Barcode')} value={code} onChange={v => setCode(v.replace(/\D/g, ''))} error={codeError}
            numeric placeholder={t('Optional')} maxLength={14} />
        </form>
        <DrawerFooter className="border-t border-border pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <Button type="submit" form="custom-food" className="h-12 rounded-xl text-[15px]" disabled={!valid}>{t('Save food')}</Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
