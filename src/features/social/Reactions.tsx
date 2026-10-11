import { useState } from 'react'
import { toast } from 'sonner'
import { SmilePlus } from 'lucide-react'
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { cn } from '@/lib/utils'
import { t, tn } from '../../lib/i18n.js'
import * as api from '../checkin/checkin-api'
import { toSocialError } from './social-api'
import { socialErrorText } from './labels'
import { EmojiPicker } from './EmojiPicker'
import { MAX_REACTIONS, QUICK_REACTION, checkinIdOf, mineCount, patchPost, postView, toggleReaction, usePostView } from './post-state'
import type { CheckinFeedItem } from './types'

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

// The grouped reactions of a post, each a toggle of mine; 💪 always has a button (the double tap's
// alternative); any other emoji comes from the picker.
export function Reactions({ item }: { item: CheckinFeedItem }) {
  const { reactions } = usePostView(item)
  const [picking, setPicking] = useState(false)
  const chosen = reactions.filter(g => g.mine).map(g => g.emoji)
  return (
    <div role="group" aria-label={t('Reactions')} className="flex flex-wrap items-center gap-1.5">
      {reactions.map(g => (
        <button key={g.emoji} type="button" aria-pressed={g.mine} aria-label={reactionName(g.emoji, g.count)}
          onClick={() => void reactTo(item, g.emoji)}
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
    </div>
  )
}
