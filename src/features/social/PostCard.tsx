import { useEffect, useId, useRef, useState } from 'react'
import { toast } from 'sonner'
import { CloudUpload, EyeOff, ImageOff, Lock, MessageCircle, MoreHorizontal, Pencil, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { t, tn } from '../../lib/i18n.js'
import { useCheckinPhoto } from '../checkin/photo-src'
import EditCheckinSheet from '../checkin/EditCheckinSheet'
import { useCheckins } from '../checkin/useCheckins'
import { runLine } from '../run/run-detail'
import { toSocialError } from './social-api'
import { socialErrorText } from './labels'
import { fmtAgo } from './format'
import { PersonAvatar } from './components/PersonAvatar'
import { Reactions, reactTo } from './Reactions'
import { QUICK_REACTION, checkinIdOf, postView, usePostView } from './post-state'
import type { CheckinFeedItem } from './types'

// The photo of a post: from this phone while it waits to go up, else through a signed link.
const usePhotoSrc = (item: CheckinFeedItem) => useCheckinPhoto(item.photo, item.photo_path)

// "Workout 3 this week · 6-week streak", worked out on the server (spec 4.1).
function contextText(c: CheckinFeedItem['context']): string | null {
  if (!c) return null
  const parts: string[] = []
  if (c.week_count > 0) parts.push(t('Workout {0} this week', c.week_count))
  if (c.streak > 0) parts.push(c.streak === 1 ? t('1-week streak') : tn(c.streak, '{0}-week streak', c.streak))
  return parts.length ? parts.join(' · ') : null
}

const commentsText = (n: number): string =>
  n === 0 ? t('Comment') : n === 1 ? t('1 comment') : tn(n, '{0} comments', n)

// Two taps on the photo within this many milliseconds toggle 💪.
const DOUBLE_TAP_MS = 350

function Photo({ item, onDoubleTap }: { item: CheckinFeedItem; onDoubleTap?: () => void }) {
  const { url, failed, fail, retry } = usePhotoSrc(item)
  const last = useRef(0)
  const [burst, setBurst] = useState(0)
  useEffect(() => {
    if (!burst) return
    const id = window.setTimeout(() => setBurst(0), 800)
    return () => window.clearTimeout(id)
  }, [burst])
  const tap = () => {
    if (!onDoubleTap) return
    const now = Date.now()
    if (last.current && now - last.current < DOUBLE_TAP_MS) {
      last.current = 0
      const on = !postView(item).reactions.find(g => g.emoji === QUICK_REACTION)?.mine
      onDoubleTap()
      if (on) setBurst(b => b + 1)
    } else last.current = now
  }
  return (
    <div data-testid="post-photo" onClick={tap}
      className="relative aspect-[4/5] w-full touch-manipulation select-none overflow-hidden bg-secondary">
      {!url && !failed && <Skeleton className="absolute inset-0 rounded-none" />}
      {url && (
        <img src={url} alt={t('Photo by {0}: {1}', item.user.name, item.title)} loading="lazy" decoding="async" draggable={false}
          onError={fail} className="absolute inset-0 size-full object-cover" />
      )}
      {failed && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-muted-foreground">
          <ImageOff aria-hidden className="size-8" strokeWidth={1.5} />
          <p className="text-sm">{t('Couldn’t load the photo.')}</p>
          <Button variant="outline" className="h-11 gap-2 rounded-xl" onClick={e => { e.stopPropagation(); retry() }}>
            <RefreshCw aria-hidden className="size-4" />{t('Try again')}
          </Button>
        </div>
      )}
      {burst > 0 && (
        <span key={burst} aria-hidden
          className="pointer-events-none absolute inset-0 grid place-items-center text-7xl drop-shadow-lg animate-in zoom-in-50 fade-in-0 duration-300 motion-reduce:hidden">
          {QUICK_REACTION}
        </span>
      )}
    </div>
  )
}

// One check-in in a feed: who and when, the photo, title, caption and the server's context line,
// reactions and the comment count. `onOpen` opens the comments (and who reacted). `onHide` hides a
// friend's post for me; by default through the feed store, which also takes it off the main feed.
export function PostCard({ item, onOpen, onHide }: {
  item: CheckinFeedItem
  onOpen: (item: CheckinFeedItem) => void
  onHide?: (item: CheckinFeedItem) => Promise<void> | void
}) {
  const titleId = useId()
  const me = useCheckins(s => s.userId)
  const { comments_count } = usePostView(item)
  const [menu, setMenu] = useState(false)
  const [editing, setEditing] = useState(false)
  const mine = item.user.id === me
  const pending = !!item.pending
  const context = contextText(item.context)
  // A run with its type or distance (plan decision 5): "Intervalado · 6,2 km · 38 min".
  const run = item.activity === 'run' && (item.run_type || item.distance_km != null) ? runLine(item) : null

  const hide = async () => {
    setMenu(false)
    try {
      await (onHide ? onHide(item) : useCheckins.getState().hide(checkinIdOf(item)))
      toast.success(t('Post hidden.'))
    } catch (e) {
      toast.error(socialErrorText(toSocialError(e).code))
    }
  }

  return (
    <article aria-labelledby={titleId} className="overflow-hidden rounded-3xl bg-card animate-in fade-in-0 duration-200 motion-reduce:animate-none">
      <header className="flex items-center gap-3 px-3 py-2.5">
        <PersonAvatar name={item.user.name} src={item.user.avatar_url} className="size-10" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-medium leading-snug">{item.user.name}</p>
          <p className="text-xs text-muted-foreground"><time dateTime={item.at}>{fmtAgo(item.at)}</time></p>
        </div>
        {item.visibility === 'private' && (
          <span className="flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-muted-foreground">
            <Lock aria-hidden className="size-3.5" />{t('Only me')}
          </span>
        )}
        {!mine && !pending && (
          <Button variant="ghost" size="icon" className="size-11 rounded-full" aria-label={t('Post options')} aria-haspopup="dialog" onClick={() => setMenu(true)}>
            <MoreHorizontal aria-hidden className="size-5" />
          </Button>
        )}
        {/* My own post: edit what spec 3.2 lets change (title, caption, note, who sees it, detail). */}
        {mine && (
          <Button variant="ghost" size="icon" className="size-11 rounded-full" aria-label={t('Edit check-in')} aria-haspopup="dialog" onClick={() => setEditing(true)}>
            <Pencil aria-hidden className="size-5" />
          </Button>
        )}
      </header>
      <Photo item={item} onDoubleTap={pending ? undefined : () => void reactTo(item, QUICK_REACTION)} />
      <div className="flex flex-col gap-2 px-3 pb-3 pt-2.5">
        <h3 id={titleId} className="text-[17px] font-semibold leading-snug tracking-tight break-words">{item.title}</h3>
        {run && <p className="text-sm font-medium tabular-nums text-muted-foreground">{run}</p>}
        {item.caption && <p className="whitespace-pre-line text-[15px] leading-relaxed break-words">{item.caption}</p>}
        {context && <p className="text-xs font-medium text-muted-foreground">{context}</p>}
        {pending ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CloudUpload aria-hidden className="size-4" />{t('Sending…')}
          </p>
        ) : (
          <>
            <Reactions item={item} />
            <button type="button" onClick={() => onOpen(item)}
              className="flex h-11 items-center gap-2 self-start rounded-xl px-1 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50">
              <MessageCircle aria-hidden className="size-5" />{commentsText(comments_count)}
            </button>
          </>
        )}
      </div>
      {mine && <EditCheckinSheet open={editing} onOpenChange={setEditing} id={checkinIdOf(item)} day={item.day} />}
      <Drawer open={menu} onOpenChange={setMenu}>
        <DrawerContent className="pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <DrawerHeader className="text-left group-data-[vaul-drawer-direction=bottom]/drawer-content:text-left">
            <DrawerTitle className="text-lg">{t('Post options')}</DrawerTitle>
            <DrawerDescription>{t('It leaves your feed. Others still see it.')}</DrawerDescription>
          </DrawerHeader>
          <div className="px-4">
            <Button variant="outline" className="h-12 w-full justify-start gap-3 rounded-2xl text-[15px]" onClick={() => void hide()}>
              <EyeOff aria-hidden className="size-5" />{t('Hide this post')}
            </Button>
          </div>
        </DrawerContent>
      </Drawer>
    </article>
  )
}

// A post while the feed loads: header, photo, title, caption and the reactions row, same sizes.
export function PostSkeleton() {
  return (
    <div data-slot="post-skeleton" aria-busy="true" aria-label={t('Loading…')} className="overflow-hidden rounded-3xl bg-card">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <Skeleton className="size-10 rounded-full" />
        <div className="flex flex-1 flex-col gap-1.5"><Skeleton className="h-4 w-28" /><Skeleton className="h-3 w-14" /></div>
      </div>
      <Skeleton className="aspect-[4/5] w-full rounded-none" />
      <div className="flex flex-col gap-2 px-3 pb-3 pt-2.5">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-4 w-full" />
        <div className="flex gap-1.5"><Skeleton className="h-11 w-16 rounded-full" /><Skeleton className="h-11 w-11 rounded-full" /></div>
      </div>
    </div>
  )
}
