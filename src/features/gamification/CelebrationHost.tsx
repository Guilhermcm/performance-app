import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useProgress } from './useProgress'
import { CelebrationOverlay } from './components/CelebrationOverlay'
import { dayResultToast } from './celebrations'
import { DAY_SEEN_KEY } from '../nutrition/storage-keys'
import type { Celebration } from './types'

// The last closed nutrition day already told, for the account signed in on this device.
const DAY_SEEN = DAY_SEEN_KEY

const readDaySeen = (userId: string): string | null | undefined => {
  try {
    const c = JSON.parse(localStorage.getItem(DAY_SEEN) || 'null')
    return c && c.userId === userId ? (c.day as string | null) : undefined
  } catch { return undefined }
}
const writeDaySeen = (userId: string, day: string | null) => {
  try { localStorage.setItem(DAY_SEEN, JSON.stringify({ userId, day })) } catch { /* storage full or blocked */ }
}

// Shows level-ups and badges the moment the store has some and nothing holds them (the
// post-workout summary does, until its XP has counted). Taking them marks them as seen.
// The result of a closed nutrition day is a toast instead, once per day, from the server's answer.
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
    const closed = progress.nutrition?.last_closed?.day ?? null
    const seen = readDaySeen(userId)
    // The first answer on this device only records where things stand.
    if (seen === undefined) { writeDaySeen(userId, closed); return }
    if (!closed || (seen && closed <= seen)) return
    const r = dayResultToast(progress, seen)
    if (r) toast(r.text)
    writeDaySeen(userId, closed)
  }, [progress, stale, userId])

  if (!items?.length) return null
  return <CelebrationOverlay items={items} onDone={() => setItems(null)} />
}
