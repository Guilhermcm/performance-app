import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { t } from '../../lib/i18n.js'
import { useProfile } from '../profile/useProfile'
import { useHabits } from './useHabits'
import HabitSheet from './HabitSheet'

type Props = { open: boolean; onOpenChange: (open: boolean) => void }

// Turning the Habits pillar on (spec 3.1), from the Profile card or the radar's lock. Opening it
// turns the pillar on; with no active habit it goes straight to creating the first one, since a
// pillar with no habits measures nothing. With active habits it only turns the pillar on and closes.
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
      const { profile, save } = latest.current
      if (!profile) return
      const turningOn = !profile.habits_enabled
      if (turningOn) {
        try {
          await save({ habits_enabled: true })
        } catch {
          if (!current()) return
          toast(t('Could not save. Your previous values were kept.'))
          latest.current.onOpenChange(false)
          return
        }
      }
      // Whether a habit is active only counts once the habits have loaded. Nothing waits on the
      // store being ready: a pull that fails leaves the creation open, and the server has the last
      // word on the limit. Just turned on, it pulls anyway: the periods it holds must know the new
      // one began today, so yesterday is not offered for a check.
      const store = useHabits.getState()
      if (turningOn || store.status !== 'ready') await store.refresh()
      if (!current()) return
      if (useHabits.getState().active().length === 0) {
        setCreating(true)
      } else {
        toast(t('The Habits pillar is on.'))
        latest.current.onOpenChange(false)
      }
    })()
  }, [open])

  return (
    <HabitSheet open={open && creating}
      onOpenChange={o => { if (!o) { setCreating(false); onOpenChange(false) } }} />
  )
}
