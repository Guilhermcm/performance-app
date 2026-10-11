import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Check, Plus, SmilePlus } from 'lucide-react'
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { cn } from '@/lib/utils'
import { t, tn } from '../../lib/i18n.js'
import * as api from '../checkin/checkin-api'
import { toSocialError } from './social-api'
import { socialErrorText } from './labels'
import { EmojiPicker } from './EmojiPicker'
import { ErrorState, ListSkeleton } from './components/states'
import { useCheckins } from '../checkin/useCheckins'
import { MAX_REACTIONS, QUICK_REACTION, checkinIdOf, mineCount, patchPost, postView, toggleReaction, usePostView } from './post-state'
import type { CheckinFeedItem, Person, SocialErrorCode } from './types'

// "💪: 3 reactions": the emoji and how many, so a screen reader says both.
export const reactionName = (emoji: string, count: number): string =>
  count === 1 ? t('{0}: 1 reaction', emoji) : tn(count, '{0}: {1} reactions', emoji, count)

// Turns my reaction with this emoji on or off, on screen at once. An 11th different emoji is stopped
// here, before the server would refuse it; a refusal puts the reaction back as it was.
export async function reactTo(item: CheckinFeedItem, emoji: string): Promise<boolean> {
  const { reactions } = postView(item)
  const on = !reactions.find(g => g.emoji === emoji)?.mine
  if (on && mineCount(reactions) >= MAX_REACTIONS) {
    toast.error(socialErrorText('too_many_reactions'))
    return false
  }
  patchPost(item, { reactions: toggleReaction(reactions, emoji) })
  try {
    await api.react(checkinIdOf(item), emoji, on)
    return true
  } catch (e) {
    patchPost(item, { reactions: toggleReaction(postView(item).reactions, emoji) })
    toast.error(socialErrorText(toSocialError(e).code))
    return false
  }
}

const CHIP = 'flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-full px-3 text-[15px] outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none'

// The grouped reactions of a post. A group opens who reacted (spec 4.2), where my reaction with
// each emoji goes on and off; 💪 always has a button (the double tap's alternative); any other emoji
// comes from the picker.
export function Reactions({ item }: { item: CheckinFeedItem }) {
  const { reactions } = usePostView(item)
  const [picking, setPicking] = useState(false)
  const [who, setWho] = useState(false)
  const chosen = reactions.filter(g => g.mine).map(g => g.emoji)
  return (
    <div role="group" aria-label={t('Reactions')} className="flex flex-wrap items-center gap-1.5">
      {reactions.map(g => (
        <button key={g.emoji} type="button" aria-haspopup="dialog" aria-label={t('{0}. See who reacted', reactionName(g.emoji, g.count))}
          onClick={() => setWho(true)}
          className={cn(CHIP, g.mine ? 'bg-primary/20 ring-1 ring-primary' : 'bg-secondary/70 hover:bg-secondary')}>
          <span aria-hidden>{g.emoji}</span>
          <span aria-hidden className="font-mono text-xs font-medium tabular-nums">{g.count}</span>
        </button>
      ))}
      {!reactions.some(g => g.emoji === QUICK_REACTION) && (
        <button type="button" aria-label={t('React with {0}', QUICK_REACTION)} onClick={() => void reactTo(item, QUICK_REACTION)}
          className={cn(CHIP, 'border border-dashed border-border hover:bg-secondary')}>
          <span aria-hidden>{QUICK_REACTION}</span>
        </button>
      )}
      <button type="button" aria-label={t('Add reaction')} onClick={() => setPicking(true)}
        className={cn(CHIP, 'text-muted-foreground hover:bg-secondary')}>
        <SmilePlus aria-hidden className="size-5" />
      </button>
      <Drawer open={picking} onOpenChange={setPicking}>
        <DrawerContent className="pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <DrawerHeader className="text-left group-data-[vaul-drawer-direction=bottom]/drawer-content:text-left">
            <DrawerTitle className="text-lg">{t('Pick a reaction')}</DrawerTitle>
            <DrawerDescription className="sr-only">{item.title}</DrawerDescription>
          </DrawerHeader>
          <div className="overflow-y-auto px-4">
            <EmojiPicker chosen={chosen} full={chosen.length >= MAX_REACTIONS}
              onPick={e => { setPicking(false); void reactTo(item, e) }} />
          </div>
        </DrawerContent>
      </Drawer>
      <WhoReactedSheet item={item} open={who} onOpenChange={setWho} />
    </div>
  )
}

// Who reacted with each emoji (get_checkin users[]), with a toggle of mine per emoji. Counts and
// my part follow the card; the names of the others come from the server, mine is "You".
export function WhoReactedSheet({ item, open, onOpenChange }: { item: CheckinFeedItem; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[85dvh] pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <DrawerHeader className="text-left group-data-[vaul-drawer-direction=bottom]/drawer-content:text-left">
          <DrawerTitle className="text-lg">{t('Who reacted')}</DrawerTitle>
          <DrawerDescription className="truncate">{item.title}</DrawerDescription>
        </DrawerHeader>
        {open && <WhoReacted item={item} />}
      </DrawerContent>
    </Drawer>
  )
}

function WhoReacted({ item }: { item: CheckinFeedItem }) {
  const me = useCheckins(s => s.userId)
  const { reactions } = usePostView(item)
  const [users, setUsers] = useState<Record<string, Person[]> | null>(null)
  const [error, setError] = useState<SocialErrorCode | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let live = true
    api.fetchCheckin(checkinIdOf(item)).then(v => {
      if (!live) return
      setUsers(Object.fromEntries(v.reactions.map(g => [g.emoji, g.users])))
      // The server's groups are fresher than the card's.
      patchPost(item, { reactions: v.reactions.map(({ emoji, count, mine }) => ({ emoji, count, mine })) })
    }, e => { if (live) setError(toSocialError(e).code) })
    return () => { live = false }
    // `item` only says which card to update; a new copy of it is no reason to load again.
  }, [item.key, attempt])

  if (error) return <div className="px-4"><ErrorState code={error} onRetry={() => { setError(null); setAttempt(a => a + 1) }} /></div>
  if (!users) return <div className="px-4"><ListSkeleton rows={2} /></div>
  if (!reactions.length) return <p className="px-4 text-sm text-muted-foreground">{t('Nothing here yet')}</p>
  return (
    <ul aria-label={t('Who reacted')} className="flex list-none flex-col gap-1 overflow-y-auto px-4 pb-2">
      {reactions.map(g => {
        const others = (users[g.emoji] ?? []).filter(u => u.id !== me).map(u => u.name)
        const names = (g.mine ? [t('You'), ...others] : others).join(', ')
        return (
          <li key={g.emoji} className="flex min-h-14 items-center gap-3">
            <span className="w-8 shrink-0 text-center text-2xl">{g.emoji}</span>
            <span data-slot="who" className="min-w-0 flex-1 text-[15px] leading-snug break-words">{names}</span>
            <button type="button" aria-pressed={g.mine} aria-label={t('React with {0}', g.emoji)} onClick={() => void reactTo(item, g.emoji)}
              className={cn(CHIP, 'shrink-0', g.mine ? 'bg-primary/20 ring-1 ring-primary' : 'border border-dashed border-border hover:bg-secondary')}>
              <span aria-hidden>{g.emoji}</span>
              {g.mine ? <Check aria-hidden className="size-4" /> : <Plus aria-hidden className="size-4" />}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
