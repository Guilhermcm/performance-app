import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ChevronRight, Flame, Link2, Share2, Users, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { useStore } from '../../store/useStore.js'
import { t } from '../../lib/i18n.js'
import { ACHIEVEMENTS, type AchievementCode } from '../gamification/achievements'
import { ACHIEVEMENT_TEXT } from '../gamification/achievement-labels'
import { AchievementIcon } from '../gamification/components/AchievementIcon'
import { LevelBar } from '../gamification/components/LevelBar'
import { fmtDay, fmtInt } from '../gamification/format'
import { cancelInvite, removeFriend, toSocialError } from './social-api'
import { socialErrorText } from './labels'
import { useSocial } from './useSocial'
import { InviteButton, useOfferLink } from './InviteButton'
import { PersonAvatar } from './components/PersonAvatar'
import { EmptyState, ErrorState, ListSkeleton, StaleNote } from './components/states'
import type { Friend, MyInvite } from './types'

type AppStore = { user: { id: string } | null }

// Friends: invite button, open invites (share again, cancel), the list and each friend's card.
export default function FriendsPanel() {
  const friends = useSocial(s => s.friends)
  const invites = useSocial(s => s.invites)
  const [open, setOpen] = useState<Friend | null>(null)
  useEffect(() => {
    void useSocial.getState().load('friends')
    void useSocial.getState().load('invites')
  }, [])
  const list = friends.data

  return (
    <section aria-labelledby="friends-title" className="flex flex-col gap-4">
      <h2 id="friends-title" className="sr-only">{t('Friends')}</h2>
      {list && list.length > 0 && <InviteButton />}
      {invites.data && invites.data.length > 0 && <OpenInvites items={invites.data} />}
      <StaleNote stale={friends.stale} />
      {!list ? (
        friends.status === 'error' && friends.error
          ? <ErrorState code={friends.error} onRetry={() => void useSocial.getState().load('friends')} />
          : <ListSkeleton />
      ) : list.length === 0 ? (
        <EmptyState icon={Users} title={t('Training together pays off')}
          body={t('Invite a friend with a link. Once they join, you both show up in the ranking.')}>
          <InviteButton />
        </EmptyState>
      ) : (
        <ul className="flex list-none flex-col gap-2 p-0">
          {list.map(f => <li key={f.id}><FriendRow friend={f} onOpen={() => setOpen(f)} /></li>)}
        </ul>
      )}
      <FriendSheet friend={open} onClose={() => setOpen(null)} />
    </section>
  )
}

function FriendRow({ friend, onOpen }: { friend: Friend; onOpen: () => void }) {
  const c = friend.card
  return (
    <button type="button" onClick={onOpen}
      className="flex min-h-16 w-full items-center gap-3 rounded-2xl bg-card px-3 py-2 text-left outline-none transition-colors duration-150 hover:bg-secondary/60 focus-visible:ring-[3px] focus-visible:ring-ring/50">
      <PersonAvatar name={friend.name} src={friend.avatar_url} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium">{friend.name}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <span className="whitespace-nowrap">{t('Level {0}', c.level.level)}</span>
          <span className="flex items-center gap-1 whitespace-nowrap">
            <Flame aria-hidden className="size-3.5 text-[var(--pillar-strength)]" />{t('{0} week streak', c.streak.current)}
          </span>
          <span className="whitespace-nowrap font-mono tabular-nums text-foreground/80">{t('{0} XP this week', fmtInt(c.week.xp))}</span>
        </span>
      </span>
      <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
    </button>
  )
}

function OpenInvites({ items }: { items: MyInvite[] }) {
  const { offer, drawer } = useOfferLink()
  const cancel = async (code: string) => {
    useSocial.setState(s => ({ invites: { ...s.invites, data: (s.invites.data ?? []).filter(i => i.code !== code) } }))
    try { await cancelInvite(code) } catch (e) { toast.error(socialErrorText(toSocialError(e).code)) }
    void useSocial.getState().load('invites')
  }
  return (
    <section aria-labelledby="open-invites" className="flex flex-col gap-2">
      <h3 id="open-invites" className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t('Open invites')}</h3>
      <ul className="flex list-none flex-col gap-2 p-0">
        {items.map(i => (
          <li key={i.code} className="flex min-h-14 items-center gap-2 rounded-2xl border border-dashed border-border pl-3 pr-1">
            <Link2 aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex-1 text-sm text-muted-foreground">{t('Expires {0}', fmtDay(i.expires_at))}</span>
            <Button variant="ghost" size="icon" className="size-11 rounded-full" aria-label={t('Share again')} onClick={() => void offer(i.code)}>
              <Share2 className="size-4" />
            </Button>
            <Button variant="ghost" size="icon" className="size-11 rounded-full" aria-label={t('Cancel invite')} onClick={() => void cancel(i.code)}>
              <X className="size-4" />
            </Button>
          </li>
        ))}
      </ul>
      {drawer}
    </section>
  )
}

// A friend's public card (levels, week, streak, badges) and, behind a confirmation, unfriending.
function FriendSheet({ friend, onClose }: { friend: Friend | null; onClose: () => void }) {
  const me = useStore((s: AppStore) => s.user?.id ?? null)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => { setConfirm(false) }, [friend?.id])
  const c = friend?.card
  const recent = c ? [...c.achievements].sort((a, b) => b.unlocked_at.localeCompare(a.unlocked_at)).slice(0, 6) : []

  const remove = async () => {
    if (!friend || !me) return
    setBusy(true)
    try {
      await removeFriend(me, friend.id)
      toast(t('{0} removed from your friends', friend.name))
      onClose()
      const s = useSocial.getState()
      void s.load('friends'); void s.load('weekly'); void s.load('alltime')
    } catch (e) {
      toast.error(socialErrorText(toSocialError(e).code))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer open={friend !== null} onOpenChange={o => { if (!o) onClose() }}>
      <DrawerContent className="pb-[env(safe-area-inset-bottom)]">
        {friend && c && (
          <>
            <DrawerHeader className="flex-row items-center gap-3 text-left group-data-[vaul-drawer-direction=bottom]/drawer-content:text-left">
              <PersonAvatar name={friend.name} src={friend.avatar_url} className="size-14" />
              <div className="min-w-0">
                <DrawerTitle className="truncate text-lg">{friend.name}</DrawerTitle>
                <DrawerDescription>{t('Friends since {0}', fmtDay(friend.since))}</DrawerDescription>
              </div>
            </DrawerHeader>
            <div className="flex flex-col gap-5 overflow-y-auto px-4 pb-2">
              <div>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="font-medium">{t('Level {0}', c.level.level)}</span>
                  <span className="font-mono tabular-nums text-muted-foreground">{t('{0} XP to level {1}', fmtInt(c.level.need - c.level.into), c.level.level + 1)}</span>
                </div>
                <LevelBar className="mt-2" to={c.level} instant label={t('Level {0}', c.level.level)} />
              </div>
              <dl className="grid grid-cols-3 gap-2">
                <Stat label={t('This week')} value={t('{0} XP', fmtInt(c.week.xp))} />
                <Stat label={t('Workouts')} value={t('{0} of {1}', c.week.workouts, c.week.target)} />
                <Stat label={t('Week streak')} value={String(c.streak.current)} />
              </dl>
              <div>
                <p className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="font-medium">{t('Achievements')}</span>
                  <span className="text-muted-foreground">{t('{0} of {1} unlocked', c.achievements.length, ACHIEVEMENTS.length)}</span>
                </p>
                {recent.length > 0 && (
                  <ul className="mt-2 flex list-none flex-wrap gap-2 p-0">
                    {recent.map(a => (
                      <li key={a.code} className="flex items-center gap-2 rounded-full bg-secondary/70 py-1 pl-1 pr-3 text-xs font-medium">
                        <AchievementIcon code={a.code} unlocked className="size-7 rounded-full" />
                        {ACHIEVEMENT_TEXT[a.code as AchievementCode]?.title() ?? a.code}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <DrawerFooter>
              {confirm ? (
                <div role="alertdialog" aria-labelledby="unfriend-question" className="flex flex-col gap-3">
                  <p id="unfriend-question" className="text-sm leading-snug">
                    {t('Remove {0} as a friend? You will no longer see each other in the ranking or the feed.', friend.name)}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" className="h-12 rounded-xl" onClick={() => setConfirm(false)}>{t('Cancel')}</Button>
                    <Button variant="destructive" className="h-12 rounded-xl" disabled={busy} aria-busy={busy} onClick={remove}>{t('Remove')}</Button>
                  </div>
                </div>
              ) : (
                <Button variant="ghost" className="h-12 rounded-xl text-destructive" onClick={() => setConfirm(true)}>{t('Remove friend')}</Button>
              )}
            </DrawerFooter>
          </>
        )}
      </DrawerContent>
    </Drawer>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-secondary/60 px-3 py-2.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-mono text-[15px] font-semibold tabular-nums">{value}</dd>
    </div>
  )
}
