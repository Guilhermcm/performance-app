import { useState } from 'react'
import { toast } from 'sonner'
import { LoaderCircle, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { t } from '../../lib/i18n.js'
import { createInvite, toSocialError } from './social-api'
import { inviteUrl } from './pending-invite'
import { shareLink } from './share'
import { socialErrorText } from './labels'
import { useSocial } from './useSocial'
import { LinkDrawer } from './components/LinkDrawer'

// Hands an invite link over: the share sheet, else the clipboard (with a toast), else a drawer
// with the link to copy by hand (Decision 16).
export function useOfferLink() {
  const [manual, setManual] = useState<string | null>(null)
  const offer = async (code: string) => {
    const url = inviteUrl(code)
    const outcome = await shareLink(url, t('Train with me on Performance. Open the link to become friends:'))
    if (outcome === 'copied') toast.success(t('Invite link copied'))
    else if (outcome === 'failed') setManual(url)
  }
  return { offer, drawer: <LinkDrawer url={manual} onClose={() => setManual(null)} /> }
}

export function InviteButton({ className, variant = 'default' }: { className?: string; variant?: 'default' | 'outline' }) {
  const [busy, setBusy] = useState(false)
  const { offer, drawer } = useOfferLink()
  const run = async () => {
    setBusy(true)
    try {
      const { code } = await createInvite()
      void useSocial.getState().load('invites')
      await offer(code)
    } catch (e) {
      toast.error(socialErrorText(toSocialError(e).code))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Button variant={variant} onClick={run} disabled={busy} aria-busy={busy}
        className={cn('h-12 w-full gap-2 rounded-2xl text-[15px] font-semibold active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100', className)}>
        {busy ? <LoaderCircle aria-hidden className="size-5 animate-spin motion-reduce:animate-none" /> : <UserPlus aria-hidden className="size-5" />}
        {t('Invite a friend')}
      </Button>
      {drawer}
    </>
  )
}
