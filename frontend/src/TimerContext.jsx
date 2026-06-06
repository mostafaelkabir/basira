import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { getActiveTimer, pauseTimer as apiPause, startTimer as apiStart } from './api'

const TimerContext = createContext(null)

const LS_KEY = 'basira_timer'

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function saveToStorage(state) {
  if (state) localStorage.setItem(LS_KEY, JSON.stringify(state))
  else localStorage.removeItem(LS_KEY)
}

export function TimerProvider({ children }) {
  // timer: { taskId, taskTitle, goalTitle, sessionId, startedAt (ISO), priorSeconds, running }
  const [timer, setTimer] = useState(null)
  const [restoring, setRestoring] = useState(true)

  // On mount: try to restore from backend, fall back to localStorage
  useEffect(() => {
    async function restore() {
      try {
        const active = await getActiveTimer()
        if (active && active.session_id) {
          const state = {
            taskId: active.task_id,
            taskTitle: active.task_title,
            goalTitle: active.goal_title,
            sessionId: active.session_id,
            startedAt: active.started_at,
            priorSeconds: active.prior_seconds ?? 0,
            running: true,
          }
          setTimer(state)
          saveToStorage(state)
        } else {
          // No active session on backend — clear storage
          saveToStorage(null)
        }
      } catch {
        // Backend unreachable, try localStorage
        const stored = loadFromStorage()
        if (stored) setTimer(stored)
      } finally {
        setRestoring(false)
      }
    }
    restore()
  }, [])

  const startTimerFn = useCallback(async (taskId, taskTitle, goalTitle) => {
    try {
      const res = await apiStart(taskId)
      const state = {
        taskId: res.task_id,
        taskTitle: res.task_title,
        goalTitle: res.goal_title,
        sessionId: res.session_id,
        startedAt: res.started_at,
        priorSeconds: res.prior_seconds ?? 0,
        running: true,
      }
      setTimer(state)
      saveToStorage(state)
    } catch (err) {
      alert('Could not start timer: ' + err.message)
    }
  }, [])

  const pauseTimerFn = useCallback(async () => {
    if (!timer) return
    try {
      const res = await apiPause()
      setTimer(prev => {
        if (!prev) return null
        const updated = {
          ...prev,
          priorSeconds: prev.priorSeconds + (res?.duration_seconds ?? 0),
          running: false,
          sessionId: null,
          startedAt: null,
        }
        saveToStorage(updated)
        return updated
      })
    } catch (err) {
      alert('Could not pause timer: ' + err.message)
    }
  }, [timer])

  const resumeTimerFn = useCallback(async () => {
    if (!timer) return
    try {
      const res = await apiStart(timer.taskId)
      setTimer(prev => {
        if (!prev) return null
        const updated = {
          ...prev,
          sessionId: res.session_id,
          startedAt: res.started_at,
          running: true,
        }
        saveToStorage(updated)
        return updated
      })
    } catch (err) {
      alert('Could not resume timer: ' + err.message)
    }
  }, [timer])

  const stopTimerFn = useCallback(async () => {
    if (!timer) return
    try {
      if (timer.running) await apiPause()
    } catch { /* ignore */ }
    setTimer(null)
    saveToStorage(null)
  }, [timer])

  return (
    <TimerContext.Provider value={{ timer, restoring, startTimer: startTimerFn, pauseTimer: pauseTimerFn, resumeTimer: resumeTimerFn, stopTimer: stopTimerFn }}>
      {children}
    </TimerContext.Provider>
  )
}

export function useTimer() {
  const ctx = useContext(TimerContext)
  if (!ctx) throw new Error('useTimer must be used inside TimerProvider')
  return ctx
}
