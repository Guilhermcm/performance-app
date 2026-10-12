import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { dateLocale, t } from '../../lib/i18n.js'
import { useProfile } from '../profile/useProfile'
import { shiftDay } from '../nutrition/days'
import { useLocalNow } from './use-local-now'
import { useSleep } from './useSleep'
import { SleepLogForm } from './SleepLogForm'

type Props = { night: string; open: boolean; onOpenChange: (open: boolean) => void }

const longDate = (iso: string) =>
  new Date(iso + 'T12:00:00').toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })

// One night in a sheet (spec 4.4): today's and yesterday's can be logged, changed or deleted;
// an older night has closed on the server and only says so.
export function SleepLogSheet({ night, open, onOpenChange }: Props) {
  // A fresh form each time the sheet opens; the closing animation keeps the last one.
  const [session, setSession] = useState(0)
  useEffect(() => { if (open) setSession(n => n + 1) }, [open])
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[92dvh]">
        <SheetBody key={session} night={night} onClose={() => onOpenChange(false)} />
      </DrawerContent>
    </Drawer>
  )
}

function SheetBody({ night, onClose }: { night: string; onClose: () => void }) {
  const timezone = useProfile(s => s.profile?.timezone)
  const today = useLocalNow(timezone).today
  const editable = night === today || night === shiftDay(today, -1)
  const log = useSleep(s => s.logs[night])
  const [asking, setAsking] = useState(false)

  const remove = () => {
    useSleep.getState().removeNight(night)
    toast(t('Night deleted'))
    onClose()
  }

  if (!editable) {
    return (
      <>
        <DrawerHeader className="text-left group-data-[vaul-drawer-direction=bottom]/drawer-content:text-left">
          <DrawerTitle className="text-xl first-letter:uppercase">{longDate(night)}</DrawerTitle>
          <DrawerDescription>{t('This night has closed. Only today’s and yesterday’s nights can still change.')}</DrawerDescription>
        </DrawerHeader>
        <DrawerFooter className="border-t border-border pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <Button variant="outline" className="h-12 rounded-xl text-[15px]" onClick={onClose}>{t('Close')}</Button>
        </DrawerFooter>
      </>
    )
  }

  return (
    <>
      <DrawerHeader className="text-left group-data-[vaul-drawer-direction=bottom]/drawer-content:text-left">
        <DrawerTitle className="text-xl">{log ? t('Edit night') : t('Log night')}</DrawerTitle>
        <DrawerDescription className="first-letter:uppercase">{longDate(night)}</DrawerDescription>
      </DrawerHeader>
      <div className="flex flex-col gap-4 overflow-y-auto px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <SleepLogForm night={night} initial={log} onSaved={() => { toast(t('Night saved')); onClose() }} />
        {log && (asking ? (
          <div role="alertdialog" aria-labelledby="sleep-delete-question" className="flex flex-col gap-3 rounded-2xl bg-secondary/70 p-4">
            <p id="sleep-delete-question" className="text-[15px] font-semibold leading-snug">{t('Delete this night?')}</p>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" className="h-12 rounded-xl" onClick={() => setAsking(false)}>{t('Cancel')}</Button>
              <Button variant="destructive" className="h-12 rounded-xl" onClick={remove}>{t('Delete')}</Button>
            </div>
          </div>
        ) : (
          <Button variant="ghost" className="h-11 gap-2 self-center rounded-xl text-destructive hover:text-destructive" onClick={() => setAsking(true)}>
            <Trash2 aria-hidden className="size-4" />{t('Delete this night')}
          </Button>
        ))}
      </div>
    </>
  )
}
