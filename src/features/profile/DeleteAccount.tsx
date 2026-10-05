import { useId, useRef, useState } from 'react'
import { LoaderCircle, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { t } from '../../lib/i18n.js'
import { deleteMyAccount, DeleteAccountFailed } from './account'

type Problem = 'offline' | 'failed' | null

// The danger zone at the bottom of the profile: a button that opens a drawer saying what goes,
// with a checkbox the person has to tick before the delete button wakes up. On success the
// session ends and the app falls back to the sign-in screen by itself (App.jsx follows the user).
export default function DeleteAccount() {
  const [open, setOpen] = useState(false)
  const [sure, setSure] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<Problem>(null)
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const box = useRef<HTMLInputElement>(null)

  const show = (on: boolean) => {
    if (busy) return
    setOpen(on)
    if (!on) { setSure(false); setProblem(null) }
  }

  const confirm = async () => {
    if (!sure || busy) return
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { setProblem('offline'); return }
    setBusy(true)
    setProblem(null)
    try {
      await deleteMyAccount()
      toast(t('Account deleted'))
    } catch (e) {
      setProblem(e instanceof DeleteAccountFailed && e.code === 'network' ? 'offline' : 'failed')
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby={id + '-zone'} className="mt-6 flex flex-col gap-3 rounded-2xl border border-destructive/40 p-5">
      <div className="flex flex-col gap-1">
        <h2 id={id + '-zone'} className="text-[15px] font-semibold text-destructive">{t('Danger zone')}</h2>
        <p className="text-sm leading-snug text-muted-foreground">{t('Removes your account and everything in it for good.')}</p>
      </div>
      <Button ref={trigger} variant="outline" onClick={() => show(true)}
        className="h-12 gap-2 rounded-xl border-destructive/60 text-base text-destructive hover:bg-destructive/10 hover:text-destructive focus-visible:ring-destructive/30 dark:border-destructive/60 dark:hover:bg-destructive/15">
        <Trash2 aria-hidden className="size-4" />{t('Delete my account')}
      </Button>

      <Drawer open={open} onOpenChange={show} dismissible={!busy}>
        {/* Focus starts on the checkbox, the first thing to answer, and goes back to the button. */}
        <DrawerContent className="max-h-[92dvh]"
          onOpenAutoFocus={e => { e.preventDefault(); box.current?.focus() }}
          onCloseAutoFocus={e => { e.preventDefault(); trigger.current?.focus() }}>
          <DrawerHeader className="text-left group-data-[vaul-drawer-direction=bottom]/drawer-content:text-left">
            <DrawerTitle className="text-xl">{t('Delete your account?')}</DrawerTitle>
            <DrawerDescription className="text-[15px] leading-snug">
              {t("This erases your profile, workouts, XP, badges, friendships and your place in challenges. It can't be undone.")}
            </DrawerDescription>
          </DrawerHeader>
          <div className="flex flex-col gap-4 overflow-y-auto px-4">
            <p className="text-sm leading-snug text-muted-foreground">
              {t("Challenges you created stay open for the friends still in them. Anything on this device that hasn't synced is lost too.")}
            </p>
            <label htmlFor={id + '-sure'} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-border px-3 py-2 text-[15px] leading-snug has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50">
              <input ref={box} id={id + '-sure'} type="checkbox" checked={sure} disabled={busy}
                onChange={e => { setSure(e.target.checked); setProblem(null) }}
                className="size-5 shrink-0 cursor-pointer accent-destructive outline-none" />
              {t("I understand this can't be undone")}
            </label>
            <p role="alert" className="text-sm leading-snug text-destructive empty:hidden">
              {problem === 'offline' ? t("You're offline. Connect to the internet to delete your account.")
                : problem === 'failed' ? t("Couldn't delete your account. Nothing was removed.") : ''}
            </p>
          </div>
          <DrawerFooter className="pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <Button variant="destructive" className="h-12 gap-2 rounded-xl text-base font-semibold"
              disabled={!sure || busy} aria-busy={busy} onClick={confirm}>
              {busy && <LoaderCircle aria-hidden className="size-5 animate-spin motion-reduce:animate-none" />}
              {busy ? t('Deleting…') : problem ? t('Try again') : t('Delete for good')}
            </Button>
            <Button variant="ghost" className="h-12 rounded-xl text-base" disabled={busy} onClick={() => show(false)}>{t('Cancel')}</Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </section>
  )
}
