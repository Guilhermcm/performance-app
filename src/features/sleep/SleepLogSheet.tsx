import { useEffect, useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { t } from '../../lib/i18n.js'
import { useProfile } from '../profile/useProfile'
import { shiftDay } from '../nutrition/days'
import { useLocalNow } from './use-local-now'
import { useSleep } from './useSleep'
import { SleepLogForm } from './SleepLogForm'
import { nightDate } from './labels'

type Props = { night: string; open: boolean; onOpenChange: (open: boolean) => void }


// One night in a sheet (spec 4.4): today's and yesterday's can be logged, changed or deleted;
// an older night has closed on the server and only says so.
export function SleepLogSheet({ night, open, onOpenChange }: Props) {
  // A fresh form each time the sheet opens; the closing animation keeps the last one. The session
  // moves in the render where `open` turns true (not in an effect), so the body mounts once.
  const [session, setSession] = useState(0)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setSession(n => n + 1)
  }
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
  // Focus goes to Cancel when the question opens, and back to the delete button when it is cancelled.
  const cancelRef = useRef<HTMLButtonElement>(null)
  const deleteRef = useRef<HTMLButtonElement>(null)
  const backToDelete = useRef(false)
  useEffect(() => {
    if (asking) cancelRef.current?.focus()
    else if (backToDelete.current) { backToDelete.current = false; deleteRef.current?.focus() }
  }, [asking])
  const cancel = () => { backToDelete.current = true; setAsking(false) }

  const remove = () => {
    useSleep.getState().removeNight(night)
    toast(t('Night deleted'))
    onClose()
  }

  if (!editable) {
    return (
      <>
        <DrawerHeader className="text-left group-data-[vaul-drawer-direction=bottom]/drawer-content:text-left">
          <DrawerTitle className="text-xl first-letter:uppercase">{nightDate(night)}</DrawerTitle>
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
        <DrawerDescription className="first-letter:uppercase">{nightDate(night)}</DrawerDescription>
      </DrawerHeader>
      <div className="flex flex-col gap-4 overflow-y-auto px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <SleepLogForm night={night} initial={log} onSaved={() => { toast(t('Night saved')); onClose() }} />
        {log && (asking ? (
          <div role="alertdialog" aria-labelledby="sleep-delete-question" className="flex flex-col gap-3 rounded-2xl bg-secondary/70 p-4">
            <p id="sleep-delete-question" className="text-[15px] font-semibold leading-snug">{t('Delete this night?')}</p>
            <div className="grid grid-cols-2 gap-2">
              <Button ref={cancelRef} variant="outline" className="h-12 rounded-xl" onClick={cancel}>{t('Cancel')}</Button>
              <Button variant="destructive" className="h-12 rounded-xl" onClick={remove}>{t('Delete')}</Button>
            </div>
          </div>
        ) : (
          <Button ref={deleteRef} variant="ghost" className="h-11 gap-2 self-center rounded-xl text-destructive hover:text-destructive" onClick={() => setAsking(true)}>
            <Trash2 aria-hidden className="size-4" />{t('Delete this night')}
          </Button>
        ))}
      </div>
    </>
  )
}
