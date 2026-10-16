import { Navigate } from 'react-router-dom'

// Placeholder until the detail screen lands: /trackers/:id sends back to the list.
export default function TrackerDetail() {
  return <Navigate to="/trackers" replace />
}
