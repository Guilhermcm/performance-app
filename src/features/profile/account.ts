import { supabase } from '@/lib/supabase'
import { toBackendError } from '@/lib/backend'
import { useStore } from '../../store/useStore.js'
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
// sync marks, the profile, progress and social caches, the event queue and a pending invite.
// The session ends with it, so the app falls back to the sign-in screen. Nothing local is touched
// when the server call fails: the account still exists and the person can try again.
export async function deleteMyAccount(): Promise<void> {
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
}
