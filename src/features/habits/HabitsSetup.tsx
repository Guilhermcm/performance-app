import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { t } from '../../lib/i18n.js'
import { useProfile } from '../profile/useProfile'
import { useHabits } from './useHabits'
import HabitSheet from './HabitSheet'

type Props = { open: boolean; onOpenChange: (open: boolean) => void }

// Turning the Habits pillar on (spec 3.1), from the Profile card, the radar's lock or a challenge.
// With an active habit it turns the pillar on and closes. With none it opens the sheet for the first
// habit and only turns the pillar on once that habit is saved: closing the sheet changes nothing, so
// the next tap offers the setup again instead of leaving a lit pillar that measures nothing.
export default function HabitsSetup({ open, onOpenChange }: Props) {
  const profile = useProfile(s => s.profile)
  const save = useProfile(s => s.save)
  const [creating, setCreating] = useState(false)
  // The latest props for the work started when the setup opened.
  const latest = useRef({ profile, save, onOpenChange })
  latest.current = { profile, save, onOpenChange }
  // One run per opening, also under StrictMode's second effect; a run from an earlier opening that
  // ends after the setup closed does nothing.
  const run = useRef({ open: false, id: 0 })

  useEffect(() => {
    const r = run.current
    if (!open) {
      if (r.open) { r.open = false; r.id++ }
      setCreating(false)
      return
    }
    if (r.open) return
    r.open = true
    const id = r.id
    const current = () => run.current.open && run.current.id === id
    void (async () => {
      if (!latest.current.profile) return
      // Whether a habit is active only counts once the habits have loaded. Nothing waits on the
      // store being ready: a pull that fails leaves the creation open, and the server has the last
      // word on the limit.
      const store = useHabits.getState()
      if (store.status !== 'ready') await store.refresh()
      if (!current()) return
      if (useHabits.getState().active().length === 0) {
        setCreating(true)
        return
      }
      if (!latest.current.profile?.habits_enabled) {
        try {
          await turnOn(latest.current.save)
        } catch {
          if (!current()) return
          toast(t('Could not save. Your previous values were kept.'))
          latest.current.onOpenChange(false)
          return
        }
        if (!current()) return
      }
      toast(t('The Habits pillar is on.'))
      latest.current.onOpenChange(false)
    })()
  }, [open])

  // The first habit is in the queue: now the pillar goes on. The setup reports closed only once
  // that is settled, so a caller that reads habits_enabled on close (the new challenge sheet) sees it.
  const turningOn = useRef<Promise<void> | null>(null)
  const saved = () => {
    const { profile, save } = latest.current
    if (!profile || profile.habits_enabled) return
    turningOn.current = turnOn(save)
      .catch(() => { toast(t('The habit was saved, but Habits is still off. Tap again to turn it on.')) })
      .finally(() => { turningOn.current = null })
  }
  const close = () => {
    setCreating(false)
    const pending = turningOn.current
    if (pending) void pending.then(() => latest.current.onOpenChange(false))
    else onOpenChange(false)
  }

  return (
    <HabitSheet open={open && creating} onSaved={saved} onOpenChange={o => { if (!o) close() }} />
  )
}

// Saves the pillar on, then pulls: the periods the store holds must know the new one began today,
// so yesterday is not offered for a check.
async function turnOn(save: ReturnType<typeof useProfile.getState>['save']) {
  await save({ habits_enabled: true })
  await useHabits.getState().refresh()
}
