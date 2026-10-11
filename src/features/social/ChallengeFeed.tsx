import { useCallback, useEffect, useRef, useState } from 'react'
import { Images, LoaderCircle, Lock } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { t } from '../../lib/i18n.js'
import { fetchChallengeFeed } from '../checkin/checkin-api'
import { useCheckins } from '../checkin/useCheckins'
import { CommentsSheet } from './Comments'
import { fmtAgo } from './format'
import { socialErrorText } from './labels'
import { PostCard, PostSkeleton } from './PostCard'
import { checkinIdOf } from './post-state'
import { toSocialError } from './social-api'
import { PersonAvatar } from './components/PersonAvatar'
import { EmptyState, ErrorState } from './components/states'
import type { ChallengeFeedEntry, CheckinFeedCursor, CheckinFeedItem, PrivateCheckinItem, SocialErrorCode } from './types'

type State = { items: ChallengeFeedEntry[]; next: CheckinFeedCursor | null; status: 'loading' | 'ready' | 'error'; error: SocialErrorCode }

// The check-ins of one challenge (get_challenge_feed), newest first, 20 at a time. A post the
// person may see is the same card as in the main feed. Any other one (a "Só eu" post, or a member
// who is not a friend) is a compact row without a photo: it still counts on the scoreboard.
export default function ChallengeFeed({ id }: { id: string }) {
  const [s, setS] = useState<State>({ items: [], next: null, status: 'loading', error: 'network' })
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<CheckinFeedItem | null>(null)
  // Only the answer to the challenge on screen is kept.
  const current = useRef(id)
  current.current = id

  const first = useCallback(async () => {
    setS({ items: [], next: null, status: 'loading', error: 'network' })
    try {
      const page = await fetchChallengeFeed(id, null)
      if (current.current !== id) return
      setS({ items: page.items, next: page.next, status: 'ready', error: 'network' })
    } catch (e) {
      if (current.current !== id) return
      setS({ items: [], next: null, status: 'error', error: toSocialError(e).code })
    }
  }, [id])
  useEffect(() => { void first() }, [first])

  const more = async () => {
    if (!s.next) return
    setBusy(true)
    try {
      const page = await fetchChallengeFeed(id, s.next)
      if (current.current !== id) return
      // The cursor should not repeat a post, but one that arrives twice shows once.
      setS(p => ({ ...p, items: [...p.items, ...page.items.filter(i => !p.items.some(x => x.key === i.key))], next: page.next }))
    } catch (e) {
      if (current.current === id) toast.error(socialErrorText(toSocialError(e).code))
    } finally {
      setBusy(false)
    }
  }

  // Hiding a post is for me only: the main feed forgets it too, and so does this list.
  const hide = async (item: CheckinFeedItem) => {
    await useCheckins.getState().hide(checkinIdOf(item))
    setS(p => ({ ...p, items: p.items.filter(i => i.key !== item.key) }))
  }

  if (s.status === 'error') return <ErrorState code={s.error} onRetry={() => void first()} />
  if (s.status === 'loading') return <div className="flex flex-col gap-4"><PostSkeleton /><PostSkeleton /></div>
  if (s.items.length === 0) {
    return <EmptyState icon={Images} title={t('No check-ins yet')} body={t('Check-ins from people in this challenge show up here.')} />
  }
  return (
    <div className="flex flex-col gap-4">
      <ol className="flex list-none flex-col gap-4 p-0">
        {s.items.map(i => (
          <li key={i.key}>
            {i.private ? <PrivateRow item={i} /> : <PostCard item={i} onOpen={setOpen} onHide={hide} />}
          </li>
        ))}
      </ol>
      {s.next && (
        <Button variant="outline" className="h-12 gap-2 rounded-2xl" disabled={busy} aria-busy={busy} onClick={() => void more()}>
          {busy && <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />}
          {busy ? t('Loading…') : t('Load more')}
        </Button>
      )}
      <CommentsSheet id={open ? checkinIdOf(open) : null} item={open ?? undefined} onClose={() => setOpen(null)} />
    </div>
  )
}

// A check-in the person cannot see: who and when, in words and a lock (not color alone).
function PrivateRow({ item }: { item: PrivateCheckinItem }) {
  return (
    <div className="flex min-h-14 items-center gap-3 rounded-2xl bg-card px-3 py-2">
      <PersonAvatar name={item.user.name} src={item.user.avatar_url} className="size-9" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-medium leading-snug">{item.user.name}</p>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock aria-hidden className="size-3.5 shrink-0" />{t('Private check-in')}
          <span aria-hidden>·</span>
          <time dateTime={item.at}>{fmtAgo(item.at)}</time>
        </p>
      </div>
    </div>
  )
}
