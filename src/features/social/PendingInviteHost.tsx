import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { readPendingInvite } from './pending-invite'

// Mounted once the signed-in account has a ready profile (after the onboarding for a new one):
// an invite opened before signing in now gets its screen, which accepts it (Decision 2). Runs
// once per mount; where the person goes afterwards is up to them.
export default function PendingInviteHost() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  useEffect(() => {
    const code = readPendingInvite()
    if (code && pathname !== '/convite/' + code) navigate('/convite/' + code, { replace: true })
  }, [])
  return null
}
