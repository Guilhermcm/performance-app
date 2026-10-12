import * as React from 'react'
import { Info, X } from 'lucide-react'
import { Popover as PopoverPrimitive } from 'radix-ui'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer'
import { REFS, RULE_OF_THUMB, refFinding, type SourceId } from '@/features/plan/references'
import { t } from '../../lib/i18n.js'

const NARROW = 480
const isNarrow = () => typeof window !== 'undefined' && window.innerWidth < NARROW

function useNarrow() {
  const [narrow, setNarrow] = React.useState(isNarrow)
  React.useEffect(() => {
    const onResize = () => setNarrow(isNarrow())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return narrow
}

function Sources({ refs }: { refs: SourceId[] }) {
  return (
    <ul className="flex flex-col gap-4">
      {refs.map(id => {
        if (id === RULE_OF_THUMB) return <li key={id} className="text-sm">{refFinding(id)}</li>
        const ref = REFS[id]
        const url = `https://doi.org/${ref.doi}`
        return (
          <li key={id} className="flex flex-col gap-1 text-sm">
            <p className="text-foreground">{refFinding(id)}</p>
            <p className="text-xs text-muted-foreground">{ref.authors} ({ref.year}). {ref.title}. {ref.journal}</p>
            <a href={url} target="_blank" rel="noopener noreferrer"
              className="break-all text-xs text-primary underline underline-offset-4">{url}</a>
          </li>
        )
      })}
    </ul>
  )
}

// The ⓘ that opens the source of a recommendation: a balloon above the icon, or a sheet from the bottom
// on a narrow screen. Tap-only, no hover.
export function InfoSource({ refs, label }: { refs: SourceId[]; label?: string }) {
  const narrow = useNarrow()
  const [open, setOpen] = React.useState(false)
  const name = label ?? t('See source')
  const trigger = (
    <Button type="button" variant="ghost" size="icon" aria-label={name} className="size-11 shrink-0 rounded-full text-muted-foreground">
      <Info aria-hidden className="size-5" />
    </Button>
  )

  if (narrow) {
    return (
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerTrigger asChild>{trigger}</DrawerTrigger>
        <DrawerContent className="pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <div className="flex items-start justify-between gap-2 px-4 pt-2">
            <DrawerTitle className="text-base">{name}</DrawerTitle>
            <Button type="button" variant="ghost" size="icon" aria-label={t('Close')} className="size-11 shrink-0" onClick={() => setOpen(false)}>
              <X aria-hidden className="size-5" />
            </Button>
          </div>
          <DrawerDescription className="sr-only">{name}</DrawerDescription>
          <div className="max-h-[60vh] overflow-y-auto px-4 pb-2"><Sources refs={refs} /></div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          data-slot="popover-content"
          side="top"
          sideOffset={6}
          collisionPadding={12}
          aria-label={name}
          className={cn(
            'z-50 w-80 max-w-[calc(100vw-1.5rem)] rounded-lg border bg-popover p-4 text-popover-foreground shadow-md outline-none',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
          )}
        >
          <PopoverPrimitive.Close asChild>
            <Button type="button" variant="ghost" size="icon" aria-label={t('Close')} className="absolute right-1 top-1 size-11">
              <X aria-hidden className="size-5" />
            </Button>
          </PopoverPrimitive.Close>
          <div className="max-h-[60vh] overflow-y-auto pr-10"><Sources refs={refs} /></div>
          <PopoverPrimitive.Arrow className="fill-popover" />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
