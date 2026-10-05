export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed'
type Nav = { share?: (data: ShareData) => Promise<void>; clipboard?: { writeText(text: string): Promise<void> } }

// The phone's share sheet when there is one. Closing the sheet is a choice, not an error. Without
// a sheet (most desktops) or when it fails, the link goes to the clipboard; 'failed' means the
// caller has to show the link for copying by hand.
export async function shareLink(url: string, text: string, nav: Nav = navigator): Promise<ShareOutcome> {
  if (typeof nav.share === 'function') {
    try {
      await nav.share({ text, url })
      return 'shared'
    } catch (e) {
      if ((e as { name?: string } | null)?.name === 'AbortError') return 'cancelled'
    }
  }
  try {
    if (!nav.clipboard) return 'failed'
    await nav.clipboard.writeText(url)
    return 'copied'
  } catch {
    return 'failed'
  }
}
