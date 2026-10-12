import type { ReactNode } from 'react'
import { Check, Circle, Dot, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { cn } from '@/lib/utils'
import { dateLocale, t } from '../../lib/i18n.js'
import { fmtNumber } from '../nutrition/labels'
import { QUALITY_LABEL, nightStatus } from './labels'
import { fmtClock, fmtDuration } from './time'
import type { SleepNight } from './types'

type Props = { night: SleepNight; open: boolean; onOpenChange: (open: boolean) => void }

const longDate = (iso: string) =>
  new Date(iso + 'T12:00:00').toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })

// A closed night of the calendar, read only (spec 7.2): when the person went to bed and woke up,
// how long they slept, the quality and the note they gave, the goal in force that night and the
// XP it paid.
export function NightSheet({ night, open, onOpenChange }: Props) {
  const status = nightStatus(night, night.target ? { valid_from: night.night, ...night.target } : null)
  const StatusIcon = night.on_target ? Check : night.logged ? Dot : Circle
  const rows: [string, ReactNode][] = []
  if (night.logged) {
    if (night.bed_time) rows.push([t('Went to bed'), <span className="font-mono tabular-nums">{fmtClock(night.bed_time)}</span>])
    if (night.wake_time) rows.push([t('Woke up'), <span className="font-mono tabular-nums">{fmtClock(night.wake_time)}</span>])
    if (night.duration_min != null) rows.push([t('Duration'), <span className="font-mono tabular-nums">{fmtDuration(night.duration_min)}</span>])
    if (night.quality != null) rows.push([t('Sleep quality'), QUALITY_LABEL[night.quality as 1 | 2 | 3 | 4 | 5]?.() ?? String(night.quality)])
  }
  rows.push([t('Goal that night'), night.target
    ? <span className="font-mono tabular-nums">{`${fmtDuration(night.target.goal_min)} · ${fmtClock(night.target.bed_target)}`}</span>
    : t('No goal')])
  if (night.logged && night.note) rows.push([t('Note'), night.note])

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[92dvh]">
        <DrawerHeader className="text-left group-data-[vaul-drawer-direction=bottom]/drawer-content:text-left">
          <DrawerTitle className="text-xl first-letter:uppercase">{longDate(night.night)}</DrawerTitle>
          <DrawerDescription className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className={cn('flex items-center gap-1.5', status.on ? 'text-pillar-sleep' : 'text-muted-foreground')}>
              <StatusIcon aria-hidden className="size-4" /><span>{status.text}</span>
            </span>
            {night.logged && (
              <span className="flex items-center gap-1.5 text-foreground">
                <Sparkles aria-hidden className="size-4 text-pillar-sleep" />
                <span className="font-mono tabular-nums">{t('+{0} XP', fmtNumber(night.xp))}</span>
              </span>
            )}
          </DrawerDescription>
        </DrawerHeader>

        <div className="overflow-y-auto px-4">
          <dl className="divide-y divide-border rounded-2xl bg-card px-4">
            {rows.map(([label, value]) => (
              <div key={label} className="flex min-h-12 items-center justify-between gap-4 py-2">
                <dt className="text-sm text-muted-foreground">{label}</dt>
                <dd className="min-w-0 text-right text-[15px] font-medium [overflow-wrap:anywhere]">{value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <DrawerFooter className="pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <Button variant="outline" className="h-12 rounded-xl text-[15px]" onClick={() => onOpenChange(false)}>{t('Close')}</Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
