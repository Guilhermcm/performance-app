import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CloudOff, LoaderCircle, LogIn, RefreshCw, type LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useStore } from '../../store/useStore.js'
import { t } from '../../lib/i18n.js'

type Sync = { offline?: boolean; pending?: boolean; auth?: boolean; lastError?: { status: number; code: string } | null } | null | undefined
type AppStore = {
  sync: Sync
  pullState(): Promise<unknown>
  signOut(o?: { force?: boolean }): Promise<{ owed: boolean; stashed?: boolean }>
}
export type SyncView = 'auth' | 'offline' | 'error' | null

// A failed request is often followed by a good one a moment later (the poll, the 'online' event):
// an error is only worth a word once it has lasted this long.
export const ERROR_GRACE_MS = 4000

// What the store's `sync` (useStore.js, statusOf) is worth saying, in order of what matters:
// a session the server ended (nothing syncs until the person signs in again), changes waiting while
// offline (they are safe here), and an error answer that keeps the server from getting them.
// Offline with nothing waiting says nothing: the copy on screen is the latest one there is.
export function syncView(sync: Sync, online: boolean): SyncView {
  if (!sync) return null
  if (sync.auth) return 'auth'
  if (sync.offline || !online) return sync.pending ? 'offline' : null
  if (sync.lastError) return 'error'
  return null
}

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false
function useOnline() {
  const [online, setOnline] = useState(isOnline)
  useEffect(() => {
    const on = () => setOnline(isOnline())
    window.addEventListener('online', on)
    window.addEventListener('offline', on)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', on) }
  }, [])
  return online
}

const LOOK: Record<Exclude<SyncView, null>, { icon: LucideIcon; tone: string }> = {
  offline: { icon: CloudOff, tone: 'bg-[color-mix(in_oklab,var(--muted)_92%,transparent)] text-foreground [&_svg]:text-muted-foreground' },
  error: { icon: RefreshCw, tone: 'bg-[color-mix(in_oklab,var(--orange)_18%,var(--card))] text-foreground [&_svg]:text-[var(--orange)]' },
  auth: { icon: LogIn, tone: 'bg-[color-mix(in_oklab,var(--destructive)_16%,var(--card))] text-foreground [&_svg]:text-destructive' }
}

/* The connection, said only when there is something to say: pinned under the status bar, above the
   page, below the tab bar and every sheet. It never blocks anything and cannot be dismissed — it
   goes when the condition does. Its height goes into --conn on the root, which #app's top padding
   and the pinned headers already add in (index.css), so it takes its own room instead of covering
   a control. Mounted by App.jsx only for a signed-in user past the profile gate. */
export default function SyncIndicator() {
  const sync = useStore((s: AppStore) => s.sync)
  const pullState = useStore((s: AppStore) => s.pullState)
  const signOut = useStore((s: AppStore) => s.signOut)
  const online = useOnline()
  const view = syncView(sync, online)
  const [waited, setWaited] = useState(false)
  const [busy, setBusy] = useState(false)
  const row = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setWaited(false)
    if (view !== 'error') return
    const tm = setTimeout(() => setWaited(true), ERROR_GRACE_MS)
    return () => clearTimeout(tm)
  }, [view])

  const shown = view === 'error' ? (waited ? view : null) : view

  useLayoutEffect(() => {
    const root = document.documentElement
    const el = row.current
    if (!shown || !el) { root.style.removeProperty('--conn'); return }
    const fit = () => root.style.setProperty('--conn', el.offsetHeight + 'px')
    fit()
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null
    ro?.observe(el)
    return () => { ro?.disconnect(); root.style.removeProperty('--conn') }
  }, [shown])

  const retry = async () => {
    setBusy(true)
    try { await pullState() } finally { setBusy(false) }
  }
  // The server no longer takes this session: back to the sign-in screen. Changes it has not seen
  // are kept aside on this device and come back when this account signs in here again.
  const signInAgain = async () => {
    setBusy(true)
    try {
      const r = await signOut({ force: true })
      if (r.owed && r.stashed === false) toast(t('Could not keep a copy of the changes on this device — nothing was removed.'))
    } finally { setBusy(false) }
  }

  const text = shown === 'offline'
    ? t('Offline — your changes are saved on this device and sync when you are back online.')
    : shown === 'error'
      ? (busy ? t('Syncing…') : t('Not synced yet — tap to retry.'))
      : shown === 'auth' ? t('Session ended — sign in again.') : ''
  const look = shown ? LOOK[shown] : null
  const Icon = busy ? LoaderCircle : look?.icon
  const pill = cn(
    'relative flex w-full items-center gap-2.5 rounded-2xl px-3.5 py-2 text-left text-[13px] font-medium leading-snug',
    'shadow-[0_6px_20px_-8px_rgb(0_0_0/0.45)] backdrop-blur-xl backdrop-saturate-150',
    'animate-in fade-in-0 slide-in-from-top-2 duration-200 motion-reduce:animate-none',
    look?.tone
  )
  const inner = <>
    {Icon && <Icon aria-hidden className={cn('size-4 shrink-0', busy && 'animate-spin motion-reduce:animate-none')} />}
    <span className="min-w-0 flex-1 text-pretty">{text}</span>
  </>

  return (
    <div role="status" aria-live="polite" data-slot="sync-indicator"
      className="pointer-events-none fixed inset-x-0 top-0 z-[45] px-4 pt-[var(--sat,0px)]">
      {shown && (
        <div ref={row} className="pointer-events-auto mx-auto max-w-md py-1.5">
          {shown === 'offline'
            ? <div data-slot="sync-pill" className={pill}>{inner}</div>
            : (
              <button type="button" data-slot="sync-pill" disabled={busy} onClick={shown === 'error' ? retry : signInAgain}
                className={cn(pill, 'min-h-11 cursor-pointer outline-none transition-transform duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.98] disabled:cursor-default motion-reduce:transition-none motion-reduce:active:scale-100')}>
                {inner}
              </button>
            )}
        </div>
      )}
    </div>
  )
}
