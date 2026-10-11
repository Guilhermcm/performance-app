import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { LoaderCircle, Send, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { t } from '../../lib/i18n.js'
import * as api from '../checkin/checkin-api'
import { useCheckins } from '../checkin/useCheckins'
import { useProfile } from '../profile/useProfile'
import { toSocialError } from './social-api'
import { socialErrorText } from './labels'
import { fmtAgo } from './format'
import { PersonAvatar } from './components/PersonAvatar'
import { ErrorState, ListSkeleton } from './components/states'
import { patchPost } from './post-state'
import type { CheckinComment, CheckinFeedItem, CheckinView, SocialErrorCode } from './types'

// The comments' limit on the server (checkin_comments.body).
export const COMMENT_MAX = 500

// A post's comments and who reacted (get_checkin). `item`: the card it was opened from, so its
// counts follow; opened from a notice, the card is looked up in the feed.
export function CommentsSheet({ id, item, onClose }: { id: string | null; item?: CheckinFeedItem; onClose: () => void }) {
  return (
    <Drawer open={id !== null} onOpenChange={open => { if (!open) onClose() }}>
      <DrawerContent className="h-[85dvh] max-h-[85dvh] pb-[env(safe-area-inset-bottom)]">
        {id !== null && <Body key={id} id={id} item={item ?? feedItem(id)} />}
      </DrawerContent>
    </Drawer>
  )
}

const feedItem = (id: string): CheckinFeedItem | undefined => {
  const found = useCheckins.getState().feed.find(i => i.key === `checkin:${id}`)
  return found?.type === 'checkin' ? found : undefined
}

function Body({ id, item }: { id: string; item?: CheckinFeedItem }) {
  const [view, setView] = useState<CheckinView | null>(null)
  const [error, setError] = useState<SocialErrorCode | null>(null)
  const [comments, setComments] = useState<CheckinComment[]>([])
  const [attempt, setAttempt] = useState(0)
  // The list as it is now, for a change that lands after an await: two quick deletes would each
  // filter the list they saw when they started, and the second would bring the first one back.
  const latest = useRef<CheckinComment[]>([])
  const show = (next: CheckinComment[]) => { latest.current = next; setComments(next) }

  useEffect(() => {
    let live = true
    api.fetchCheckin(id).then(v => {
      if (!live) return
      setView(v)
      show(v.comments)
      if (item) patchPost(item, { comments_count: v.comments.length, reactions: v.reactions.map(({ emoji, count, mine }) => ({ emoji, count, mine })) })
    }, e => { if (live) setError(toSocialError(e).code) })
    return () => { live = false }
    // `item` only says which card to update; a new copy of it is no reason to load again.
  }, [id, attempt])

  const changed = (next: CheckinComment[]) => {
    show(next)
    if (item) patchPost(item, { comments_count: next.length })
  }

  const remove = async (c: CheckinComment) => {
    try {
      await api.deleteComment(c.id)
      changed(latest.current.filter(x => x.id !== c.id))
    } catch (e) {
      toast.error(socialErrorText(toSocialError(e).code))
    }
  }

  return (
    <>
      <DrawerHeader className="text-left group-data-[vaul-drawer-direction=bottom]/drawer-content:text-left">
        <DrawerTitle className="text-lg">{t('Comments')}</DrawerTitle>
        <DrawerDescription className="truncate">{view?.title ?? item?.title ?? ''}</DrawerDescription>
      </DrawerHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-4">
        {error ? (
          <ErrorState code={error} onRetry={() => { setError(null); setAttempt(a => a + 1) }} />
        ) : !view ? (
          <ListSkeleton rows={3} />
        ) : (
          <>
            {view.reactions.length > 0 && (
              <section className="flex flex-col gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t('Who reacted')}</h3>
                <ul aria-label={t('Who reacted')} className="flex list-none flex-col gap-1.5 p-0">
                  {view.reactions.map(g => (
                    <li key={g.emoji} className="flex items-start gap-2.5 text-sm leading-snug">
                      <span className="w-6 shrink-0 text-center text-lg leading-tight">{g.emoji}</span>
                      <span className="min-w-0 pt-0.5 break-words">{g.users.map(u => u.name).join(', ')}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <section className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t('Comments')}</h3>
              {comments.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('No comments yet.')}</p>
              ) : (
                <ol aria-label={t('Comments')} className="flex list-none flex-col gap-3 p-0">
                  {comments.map(c => (
                    <li key={c.id} className="flex items-start gap-3">
                      <PersonAvatar name={c.user.name} src={c.user.avatar_url} className="size-9" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm">
                          <span className="font-medium">{c.user.name}</span>
                          <span className="text-muted-foreground"> · <time dateTime={c.created_at}>{fmtAgo(c.created_at)}</time></span>
                        </p>
                        <p className="whitespace-pre-line text-[15px] leading-relaxed break-words">{c.body}</p>
                      </div>
                      {c.can_delete && (
                        <Button variant="ghost" size="icon" className="size-11 shrink-0 rounded-full text-muted-foreground"
                          aria-label={t('Delete comment')} onClick={() => void remove(c)}>
                          <Trash2 aria-hidden className="size-4" />
                        </Button>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </>
        )}
      </div>
      {view && !error && <Composer id={id} onSent={c => changed([...latest.current, c])} />}
    </>
  )
}

function Composer({ id, onSent }: { id: string; onSent: (c: CheckinComment) => void }) {
  const fieldId = useId()
  const countId = useId()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const body = text.trim()

  const send = async (ev: FormEvent) => {
    ev.preventDefault()
    if (!body || busy) return
    setBusy(true)
    try {
      const cid = await api.comment(id, body)
      const p = useProfile.getState().profile
      const me = { id: useCheckins.getState().userId ?? '', name: p?.display_name ?? '', avatar_url: p?.avatar_url ?? null }
      onSent({ id: cid, user: me, body, created_at: new Date().toISOString(), can_delete: true })
      setText('')
    } catch (e) {
      toast.error(socialErrorText(toSocialError(e).code))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={send} className="flex flex-col gap-1.5 border-t border-border px-4 pb-4 pt-3">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={fieldId} className="text-sm font-semibold">{t('Write a comment')}</label>
        <span id={countId} className="font-mono text-xs tabular-nums text-muted-foreground">{`${text.length}/${COMMENT_MAX}`}</span>
      </div>
      <div className="flex items-end gap-2">
        <textarea id={fieldId} value={text} maxLength={COMMENT_MAX} rows={2} aria-describedby={countId}
          onChange={e => setText(e.target.value.slice(0, COMMENT_MAX))}
          className="min-h-12 w-full flex-1 resize-none rounded-md border border-input bg-transparent px-3 py-2 text-[15px] shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30" />
        <Button type="submit" className="h-12 gap-2 rounded-xl" disabled={!body || busy} aria-busy={busy}>
          {busy ? <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" /> : <Send aria-hidden className="size-4" />}
          {t('Send')}
        </Button>
      </div>
    </form>
  )
}
