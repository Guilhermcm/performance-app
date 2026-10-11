import { create } from 'zustand'
import type { CheckinFeedItem, ReactionGroup } from './types'

// Up to 10 different emojis per person on one post (0018_checkin_social.sql, checkin_reactions_guard).
export const MAX_REACTIONS = 10
// What a double tap on the photo toggles (spec 4.2).
export const QUICK_REACTION = '💪'

type Post = Pick<CheckinFeedItem, 'key' | 'reactions' | 'comments_count'>
export type PostCounts = { reactions: ReactionGroup[]; comments_count: number }

export const checkinIdOf = (item: { key: string }): string => item.key.slice(item.key.indexOf(':') + 1)

// What I did on a post since the server last sent it: my reactions and the comments I added or
// removed, kept apart from the feed so the main feed and a challenge feed share them. An entry holds
// only while the post is the copy it was made on; a fresher copy from the server already has it.
type Over = PostCounts & { from: string }
const sig = (p: Post) => JSON.stringify([p.reactions, p.comments_count])

export const usePostOverlay = create<{ by: Record<string, Over> }>(() => ({ by: {} }))

export function postView(p: Post, by: Record<string, Over> = usePostOverlay.getState().by): PostCounts {
  const o = by[p.key]
  return o && o.from === sig(p) ? { reactions: o.reactions, comments_count: o.comments_count } : { reactions: p.reactions, comments_count: p.comments_count }
}

export function usePostView(p: Post): PostCounts {
  const o = usePostOverlay(s => s.by[p.key])
  return postView(p, o ? { [p.key]: o } : {})
}

export function patchPost(p: Post, patch: Partial<PostCounts>): void {
  usePostOverlay.setState(s => ({ by: { ...s.by, [p.key]: { ...postView(p, s.by), ...patch, from: sig(p) } } }))
}

export const mineCount = (groups: ReactionGroup[]): number => groups.filter(g => g.mine).length

// My reaction with this emoji goes on or off; a group no one is left in goes away.
export function toggleReaction(groups: ReactionGroup[], emoji: string): ReactionGroup[] {
  const g = groups.find(x => x.emoji === emoji)
  if (!g) return [...groups, { emoji, count: 1, mine: true }]
  if (g.mine) return g.count <= 1 ? groups.filter(x => x !== g) : groups.map(x => (x === g ? { ...x, count: x.count - 1, mine: false } : x))
  return groups.map(x => (x === g ? { ...x, count: x.count + 1, mine: true } : x))
}
