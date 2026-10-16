import { supabase } from '@/lib/supabase'
import { toBackendError } from '@/lib/backend'
import { useStore } from '../../store/useStore.js'
import { clearSignedUrls, removeAllPhotos } from '../checkin/checkin-api'
import { clearCheckinOutbox } from '../checkin/outbox'
import { useCheckins } from '../checkin/useCheckins'
import { forgetOutbox as forgetDiaryOutbox } from '../nutrition/outbox'
import { sleepOutbox } from '../sleep/outbox'
import { habitsOutbox } from '../habits/outbox'
import { clearEventQueue } from '../gamification/events'
import { useProgress } from '../gamification/useProgress'
import { clearPendingInvite } from '../social/pending-invite'
import { useSocial } from '../social/useSocial'
import { useProfile } from './useProfile'

export type DeleteAccountError = 'network' | 'failed'

export class DeleteAccountFailed extends Error {
  code: DeleteAccountError
  constructor(code: DeleteAccountError, message: string) {
    super(message)
    this.name = 'DeleteAccountFailed'
    this.code = code
  }
}

type ForgetStore = { forgetAccount(): Promise<void> }

// Deletes the account and everything the server keeps about it (delete_my_account, migration
// 0006), then everything this device keeps about it: the app copy, its stashes and media, the
// sync marks, the profile, progress and social caches, the event queue, a pending invite and the
// check-in, food diary, sleep and habits queues of that account.
// The session ends with it, so the app falls back to the sign-in screen. Nothing local is touched
// when the server call fails: the account still exists and the person can try again.
// The check-in photos go first, while the session can still reach its folder (spec 6.3). A failure
// there does not stop the deletion; the SETUP has the query that finds photos left behind.
export async function deleteMyAccount(): Promise<void> {
  let userId: string | null = null
  try { userId = (await supabase.auth.getSession()).data.session?.user.id ?? null } catch { /* no session */ }
  if (userId) {
    try { await removeAllPhotos(userId) } catch { /* left for the SETUP clean-up */ }
  }
  const { error, status } = await supabase.rpc('delete_my_account')
  if (error) {
    const e = toBackendError(error, status)
    throw new DeleteAccountFailed(e.code === 'network' ? 'network' : 'failed', e.message)
  }
  await (useStore.getState() as ForgetStore).forgetAccount()
  clearEventQueue()
  clearPendingInvite()
  useProfile.getState().reset()
  useProgress.getState().reset()
  useSocial.getState().reset()
  // The check-ins, diary entries, nights, habits and checks waiting on this phone belong to an account that no longer exists.
  if (userId) {
    await clearCheckinOutbox(userId).catch(() => {})
    forgetDiaryOutbox(userId)
    sleepOutbox.forget(userId)
    habitsOutbox.forget(userId)
  }
  useCheckins.getState().reset()
  clearSignedUrls()
}
