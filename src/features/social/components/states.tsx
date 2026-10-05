import type { ReactNode } from 'react'
import { CloudOff, RefreshCw, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useOnline } from '@/lib/use-online'
import { ACCENT_TEXT } from '../../gamification/components/accent'
import { t } from '../../../lib/i18n.js'
import { socialErrorText } from '../labels'
import type { SocialErrorCode } from '../types'

// Rows in the shape of the list they stand for: photo, two lines, a number.
export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label={t('Loading…')} className="flex flex-col gap-2">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex min-h-16 items-center gap-3 rounded-2xl bg-card px-3">
          <Skeleton className="size-11 rounded-full" />
          <div className="flex flex-1 flex-col gap-2"><Skeleton className="h-4 w-32" /><Skeleton className="h-3 w-20" /></div>
          <Skeleton className="h-4 w-14" />
        </div>
      ))}
    </div>
  )
}

export function ErrorState({ code, onRetry }: { code: SocialErrorCode; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl border border-border bg-card p-5">
      <p className="text-[15px] font-medium leading-snug">{socialErrorText(code)}</p>
      <Button variant="outline" className="h-11 gap-2 rounded-xl" onClick={onRetry}>
        <RefreshCw aria-hidden className="size-4" />{t('Try again')}
      </Button>
    </div>
  )
}

// An empty list is a starting point: what this place is for and the next step.
export function EmptyState({ icon: Icon, title, body, children }: { icon: LucideIcon; title: string; body?: string; children?: ReactNode }) {
  return (
    <section className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-border px-6 py-8 text-center animate-in fade-in-0 duration-200 motion-reduce:animate-none">
      <span className={cn('grid size-14 place-items-center rounded-2xl bg-primary/15', ACCENT_TEXT)}>
        <Icon aria-hidden className="size-7" strokeWidth={1.75} />
      </span>
      <h3 className="text-lg font-semibold tracking-tight text-balance">{title}</h3>
      {body && <p className="max-w-xs text-sm leading-relaxed text-muted-foreground text-pretty">{body}</p>}
      {children && <div className="mt-2 w-full">{children}</div>}
    </section>
  )
}

// The saved copy is on screen and the phone is offline: one quiet line, nothing blocks.
export function StaleNote({ stale }: { stale: boolean }) {
  const online = useOnline()
  if (!stale || online) return null
  return (
    <p className="flex items-center gap-2 text-xs text-muted-foreground">
      <CloudOff aria-hidden className="size-3.5" />{t('Offline. Showing what was saved last.')}
    </p>
  )
}
