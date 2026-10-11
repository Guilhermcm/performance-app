import { useEffect, useState } from 'react'
import * as api from './checkin-api'

// Photo links for what is on screen, asked for together: the cards (or calendar days) that mount in
// the same pass get one request for all their photos (checkin-api keeps each link for 55 minutes).
let wanted = new Map<string, { ok: (url: string | null) => void; fail: (e: unknown) => void }[]>()
let scheduled = false
export function linkFor(path: string): Promise<string | null> {
  return new Promise((ok, fail) => {
    wanted.set(path, [...(wanted.get(path) ?? []), { ok, fail }])
    if (scheduled) return
    scheduled = true
    queueMicrotask(async () => {
      const batch = wanted
      wanted = new Map()
      scheduled = false
      try {
        const urls = await api.signedUrls([...batch.keys()])
        for (const [p, ws] of batch) ws.forEach(w => w.ok(urls[p] ?? null))
      } catch (e) {
        for (const ws of batch.values()) ws.forEach(w => w.fail(e))
      }
    })
  })
}

// A check-in's photo: from this phone while it waits to go up (`photo`), else through a signed link.
// A link the server does not give (the friendship ended) counts as a failure, like a network error.
export function useCheckinPhoto(photo: Blob | null | undefined, path: string | null | undefined) {
  const [state, setState] = useState<{ url: string | null; failed: boolean }>({ url: null, failed: false })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (photo && typeof URL.createObjectURL === 'function') {
      const url = URL.createObjectURL(photo)
      setState({ url, failed: false })
      return () => URL.revokeObjectURL(url)
    }
    if (!path) { setState({ url: null, failed: true }); return }
    let live = true
    setState({ url: null, failed: false })
    linkFor(path).then(url => { if (live) setState({ url, failed: !url }) }, () => { if (live) setState({ url: null, failed: true }) })
    return () => { live = false }
  }, [photo, path, attempt])
  return {
    ...state,
    fail: () => setState({ url: null, failed: true }),
    retry: () => { if (path) api.forgetSignedUrl(path); setAttempt(a => a + 1) }
  }
}
