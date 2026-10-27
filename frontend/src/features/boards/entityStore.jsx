import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { getBoardEntities } from '../../api'

export const PLURAL = { ticket: 'tickets', task: 'tasks', goal: 'goals', milestone: 'milestones' }
const KEYS = ['tickets', 'tasks', 'goals', 'milestones']
const empty = () => ({ tickets: new Set(), tasks: new Set(), goals: new Set(), milestones: new Set() })

const EntityContext = createContext(null)
export const EntityProvider = EntityContext.Provider

// One store per open board. Card shapes ask for their entity by id; requests made in the same tick
// are batched into one GET /boards/entities and merged into `data`. Ids the server no longer knows
// come back as { missing: true } so the card can say so instead of spinning forever.
export function useEntityStore() {
  const [data, setData] = useState({ tickets: {}, tasks: {}, goals: {}, milestones: {} })
  const known = useRef(empty())     // every id any card has asked for
  const pending = useRef(empty())   // ids waiting for the next fetch
  const timer = useRef(null)

  const flush = useCallback(async () => {
    timer.current = null
    const batch = Object.fromEntries(KEYS.map(k => [k, [...pending.current[k]]]))
    pending.current = empty()
    if (!KEYS.some(k => batch[k].length)) return
    try {
      const res = await getBoardEntities(batch)
      setData(prev => {
        const next = { ...prev }
        for (const k of KEYS) {
          next[k] = { ...prev[k] }
          for (const id of batch[k]) next[k][id] = res[k]?.[id] || { missing: true }
        }
        return next
      })
    } catch { /* cards keep their last state; the next refresh retries */ }
  }, [])

  const schedule = useCallback(() => { if (!timer.current) timer.current = setTimeout(flush, 40) }, [flush])

  const request = useCallback((entity, id) => {
    const k = PLURAL[entity]
    if (!k || !id || known.current[k].has(id)) return
    known.current[k].add(id)
    pending.current[k].add(id)
    schedule()
  }, [schedule])

  // Re-fetch everything this board has shown so far (after a drawer edit, a focus return, …).
  const refresh = useCallback(() => {
    for (const k of KEYS) for (const id of known.current[k]) pending.current[k].add(id)
    schedule()
  }, [schedule])

  useEffect(() => {
    const events = ['basira:task-updated', 'basira:ticket-updated', 'basira:milestone-updated', 'basira:schedule-updated']
    events.forEach(e => window.addEventListener(e, refresh))
    window.addEventListener('focus', refresh)
    return () => {
      events.forEach(e => window.removeEventListener(e, refresh))
      window.removeEventListener('focus', refresh)
      clearTimeout(timer.current)
    }
  }, [refresh])

  return useMemo(() => ({ data, request, refresh }), [data, request, refresh])
}

export function useEntity(entity, id) {
  const store = useContext(EntityContext)
  useEffect(() => { store?.request(entity, id) }, [store, entity, id])
  return store?.data[PLURAL[entity]]?.[id]
}
