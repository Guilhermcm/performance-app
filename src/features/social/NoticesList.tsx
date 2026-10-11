import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell } from 'lucide-react'
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { cn } from '@/lib/utils'
import { t } from '../../lib/i18n.js'
import { useCheckins } from '../checkin/useCheckins'
import { fmtAgo } from './format'
import { PersonAvatar } from './components/PersonAvatar'
import { EmptyState } from './components/states'
import { CommentsSheet } from './Comments'
import type { SocialNotice } from './types'

// What a notice says. The titles are null once the post or the challenge is gone.
function noticeText(n: SocialNotice): string {
  const who = n.actor.name
  if (n.kind === 'reaction') return n.checkin_title !== null ? t('{0} reacted to “{1}”', who, n.checkin_title) : t('{0} reacted to your check-in', who)
  if (n.kind === 'comment') return n.checkin_title !== null ? t('{0} commented on “{1}”', who, n.checkin_title) : t('{0} commented on your check-in', who)
  return n.challenge_title !== null ? t('{0} invited you to “{1}”', who, n.challenge_title) : t('{0} invited you to a challenge', who)
}

// Reactions, comments on my posts and challenge invites, newest first (spec 4.4). `fresh`: the ones
// that were unread when the list was opened; they keep their mark while it is on screen.
export function NoticesList({ fresh, onOpenPost, onOpenChallenge }: {
  fresh: ReadonlySet<number>
  onOpenPost: (checkinId: string) => void
  onOpenChallenge: (challengeId: string) => void
}) {
  const notices = useCheckins(s => s.notices)
  if (!notices.length) {
    return <EmptyState icon={Bell} title={t('No notices yet')} body={t('Reactions, comments and challenge invites show up here.')} />
  }
  return (
    <ul className="flex list-none flex-col gap-1 p-0">
      {notices.map(n => {
        const isNew = fresh.has(n.id) || !n.read
        const open = n.kind === 'challenge_invite'
          ? (n.challenge_id && n.challenge_title !== null ? () => onOpenChallenge(n.challenge_id!) : null)
          : (n.checkin_id && n.checkin_title !== null ? () => onOpenPost(n.checkin_id!) : null)
        const body: ReactNode = (
          <>
            <PersonAvatar name={n.actor.name} src={n.actor.avatar_url} className="size-10" />
            <span className="min-w-0 flex-1">
              <span data-slot="notice-text" className={cn('block text-[15px] leading-snug break-words', isNew && 'font-semibold')}>{noticeText(n)}</span>
              <span className="block text-xs text-muted-foreground"><time dateTime={n.created_at}>{fmtAgo(n.created_at)}</time></span>
            </span>
            {isNew && <><span aria-hidden className="size-2.5 shrink-0 rounded-full bg-primary" /><span className="sr-only">{t('Unread')}</span></>}
          </>
        )
        const row = 'flex min-h-14 w-full items-center gap-3 rounded-2xl px-2 py-2 text-left'
        return (
          <li key={n.id}>
            {open ? (
              <button type="button" onClick={open}
                className={cn(row, 'outline-none transition-colors hover:bg-secondary/70 focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none')}>
                {body}
              </button>
            ) : <div className={row}>{body}</div>}
          </li>
        )
      })}
    </ul>
  )
}

// The bell at the top of Social: how many notices are unread, and the list. Opening it marks them read.
export function NoticesButton() {
  const navigate = useNavigate()
  const notices = useCheckins(s => s.notices)
  const unread = notices.filter(n => !n.read).length
  const [open, setOpen] = useState(false)
  const [fresh, setFresh] = useState<ReadonlySet<number>>(new Set())
  const [post, setPost] = useState<string | null>(null)

  const show = () => {
    setFresh(new Set(notices.filter(n => !n.read).map(n => n.id)))
    setOpen(true)
    void useCheckins.getState().readNotices().catch(() => { /* they stay unread and count again next time */ })
  }

  return (
    <>
      <button type="button" onClick={show} aria-haspopup="dialog"
        aria-label={unread > 0 ? t('Notices. Unread: {0}', unread) : t('Notices')}
        className="relative grid size-11 place-items-center rounded-full outline-none transition-colors hover:bg-secondary focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none">
        <Bell aria-hidden className="size-[22px]" strokeWidth={1.75} />
        {unread > 0 && (
          <span aria-hidden className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 font-mono text-[10px] font-semibold leading-none text-primary-foreground tabular-nums">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent className="max-h-[85dvh] pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <DrawerHeader className="text-left group-data-[vaul-drawer-direction=bottom]/drawer-content:text-left">
            <DrawerTitle className="text-lg">{t('Notices')}</DrawerTitle>
            <DrawerDescription className="sr-only">{t('Reactions, comments and challenge invites show up here.')}</DrawerDescription>
          </DrawerHeader>
          <div className="overflow-y-auto px-2">
            <NoticesList fresh={fresh}
              onOpenPost={id => { setOpen(false); setPost(id) }}
              onOpenChallenge={id => { setOpen(false); navigate(`/social/desafios/${id}`) }} />
          </div>
        </DrawerContent>
      </Drawer>
      <CommentsSheet id={post} onClose={() => setPost(null)} />
    </>
  )
}
