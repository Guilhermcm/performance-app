import { useRef } from 'react'
import { toast } from 'sonner'
import { Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { t } from '../../../lib/i18n.js'

// Last resort when neither the share sheet nor the clipboard worked: the link in a field that
// selects itself, ready for a long press and copy.
export function LinkDrawer({ url, onClose }: { url: string | null; onClose: () => void }) {
  const field = useRef<HTMLInputElement>(null)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url ?? '')
      toast.success(t('Invite link copied'))
      onClose()
    } catch {
      field.current?.select()
    }
  }
  return (
    <Drawer open={url !== null} onOpenChange={open => { if (!open) onClose() }}>
      <DrawerContent className="pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <DrawerHeader className="text-left group-data-[vaul-drawer-direction=bottom]/drawer-content:text-left">
          <DrawerTitle className="text-lg">{t('Invite link')}</DrawerTitle>
          <DrawerDescription>{t('Copy the link and send it to your friend.')}</DrawerDescription>
        </DrawerHeader>
        <div className="flex flex-col gap-3 px-4">
          <Input ref={field} readOnly value={url ?? ''} aria-label={t('Invite link')}
            onFocus={e => e.currentTarget.select()} className="h-12 font-mono text-sm" />
          <Button className="h-12 gap-2 rounded-xl" onClick={copy}><Copy aria-hidden className="size-4" />{t('Copy link')}</Button>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
