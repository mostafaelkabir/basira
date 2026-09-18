import { useCallback, useEffect, useState } from 'react'
import { getDayWorkspace } from '../../api'

// Fetches the read-only day model for `date` (defaults to today in the browser's
// timezone) and refreshes it on demand and whenever timers/tasks/schedule change
// elsewhere in the app. The endpoint never writes, so refreshing is always safe.
export function useDayWorkspace(date) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(() => {
    return getDayWorkspace(date)
      .then(d => { setData(d); setError(null); return d })
      .catch(err => { setError(err); return null })
      .finally(() => setLoading(false))
  }, [date])

  useEffect(() => { refresh() }, [refresh])

  // Keep the ledger honest as the user works: a live timer ticks, so re-poll on a
  // gentle interval, and refresh immediately on explicit cross-component events.
  useEffect(() => {
    const events = ['basira:task-updated', 'basira:schedule-updated', 'basira:timer-changed']
    const onEvent = () => refresh()
    events.forEach(e => window.addEventListener(e, onEvent))
    const tick = setInterval(refresh, 60000)
    return () => {
      events.forEach(e => window.removeEventListener(e, onEvent))
      clearInterval(tick)
    }
  }, [refresh])

  return { data, error, loading, refresh }
}
