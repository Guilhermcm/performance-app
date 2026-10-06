import { Apple } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { t } from '../../lib/i18n.js'

// The Nutrition tab with the pillar off: what it does and the one step to turn it on.
export default function NutritionInvite({ onActivate }: { onActivate: () => void }) {
  return (
    <section className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-border px-6 py-10 text-center animate-in fade-in-0 duration-200 motion-reduce:animate-none">
      <span className="grid size-14 place-items-center rounded-2xl bg-pillar-nutrition/15 text-pillar-nutrition">
        <Apple aria-hidden className="size-7" strokeWidth={1.75} />
      </span>
      <h2 className="text-lg font-semibold tracking-tight text-balance">{t('Track what you eat')}</h2>
      <p className="max-w-xs text-sm leading-relaxed text-muted-foreground text-pretty">
        {t('Get a daily calorie and protein target based on your profile. Days on target earn XP, like workouts do.')}
      </p>
      <Button className="mt-2 h-12 w-full max-w-xs rounded-xl text-[15px]" onClick={onActivate}>{t('Turn on Nutrition')}</Button>
    </section>
  )
}
