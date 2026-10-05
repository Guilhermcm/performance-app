import { useEffect, useState } from 'react'
import { useProgress } from './useProgress'
import { CelebrationOverlay } from './components/CelebrationOverlay'
import type { Celebration } from './types'

// Shows level-ups and badges the moment the store has some and nothing holds them (the
// post-workout summary does, until its XP has counted). Taking them marks them as seen.
export default function CelebrationHost() {
  const pending = useProgress(s => s.pending)
  const held = useProgress(s => s.held)
  const [items, setItems] = useState<Celebration[] | null>(null)

  useEffect(() => {
    if (items || held || !pending.length) return
    setItems(useProgress.getState().takePending())
  }, [pending, held, items])

  if (!items?.length) return null
  return <CelebrationOverlay items={items} onDone={() => setItems(null)} />
}
