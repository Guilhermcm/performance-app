import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useProgress } from './useProgress'
import { CelebrationOverlay } from './components/CelebrationOverlay'
import { dayResultToast, sleepNightToast, trainingDayToast } from './celebrations'
import { DAY_SEEN_KEY } from '../nutrition/storage-keys'
import { SLEEP_SEEN_KEY } from '../sleep/storage-keys'
import type { Celebration } from './types'

// The last closed nutrition day, Treino day and night already told, for the account signed in on
// this device.
const DAY_SEEN = DAY_SEEN_KEY
const TRAINING_SEEN = 'perf_training_seen_v1'

const readSeen = (key: string, userId: string): string | null | undefined => {
  try {
    const c = JSON.parse(localStorage.getItem(key) || 'null')
    return c && c.userId === userId ? (c.day as string | null) : undefined
  } catch { return undefined }
}
const writeSeen = (key: string, userId: string, day: string | null) => {
  try { localStorage.setItem(key, JSON.stringify({ userId, day })) } catch { /* storage full or blocked */ }
}

// Shows level-ups and badges the moment the store has some and nothing holds them (the
// post-workout summary does, until its XP has counted). Taking them marks them as seen.
// The result of a closed nutrition day, the confirmation of a closed Treino day and the result of a
// closed night are toasts instead, once per day each, from the server's answer. A cached progress
// from before a pillar existed has no block for it and tells nothing.
export default function CelebrationHost() {
  const pending = useProgress(s => s.pending)
  const held = useProgress(s => s.held)
  const progress = useProgress(s => s.progress)
  const stale = useProgress(s => s.stale)
  const userId = useProgress(s => s.userId)
  const [items, setItems] = useState<Celebration[] | null>(null)

  useEffect(() => {
    if (items || held || !pending.length) return
    setItems(useProgress.getState().takePending())
  }, [pending, held, items])

  useEffect(() => {
    if (!progress || stale || !userId) return
    const tell = (key: string, closed: string | null, result: (seen: string | null) => { text: string } | null) => {
      const seen = readSeen(key, userId)
      // The first answer on this device only records where things stand.
      if (seen === undefined) { writeSeen(key, userId, closed); return }
      if (!closed || (seen && closed <= seen)) return
      const r = result(seen)
      if (r) toast(r.text)
      writeSeen(key, userId, closed)
    }
    tell(DAY_SEEN, progress.nutrition?.last_closed?.day ?? null, seen => dayResultToast(progress, seen))
    tell(TRAINING_SEEN, progress.training?.last_closed?.day ?? null, seen => trainingDayToast(progress, seen))
    tell(SLEEP_SEEN_KEY, progress.sleep?.last_closed?.night ?? null, seen => sleepNightToast(progress, seen))
  }, [progress, stale, userId])

  if (!items?.length) return null
  return <CelebrationOverlay items={items} onDone={() => setItems(null)} />
}
