import { useEffect } from 'react'
import { toast } from 'sonner'
import { droppedNoticeText, useTrackers } from './useTrackers'

// Writes the server refused for good: said once, in the language of that moment, on whichever
// trackers screen is open (the list or a detail), then forgotten.
export function useDroppedNotice(): void {
  const dropped = useTrackers(s => s.droppedNotice)
  useEffect(() => {
    if (!dropped) return
    toast(droppedNoticeText(dropped))
    useTrackers.getState().dismissDropped()
  }, [dropped])
}
