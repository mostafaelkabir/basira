import { useCallback, useEffect, useRef, useState } from 'react'
import { getDayWorkspace } from '../../api'

// Fetches the read-only day model for `date` (defaults to today in the browser's
// timezone) and refreshes it on demand and whenever timers/tasks/schedule change
// elsewhere in the app. The endpoint never writes, so refreshing is always safe.
export function useDayWorkspace(date) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  // Refreshes overlap (an event and an explicit call can fire for one change);
  // only the latest request may set state, or a slow stale answer wins.
  const seq = useRef(0)

  const refresh = useCallback(() => {
    const mine = ++seq.current
    return getDayWorkspace(date)
      .then(d => { if (mine === seq.current) { setData(d); setError(null) } return d })
      .catch(err => { if (mine === seq.current) setError(err); return null })
      .finally(() => { if (mine === seq.current) setLoading(false) })
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
