import { useEffect, useRef, useState } from 'react'
import { getTask } from './api'
import { ActivityComments } from './components/ActivityComposer'
import { useTimer } from './TimerContext'

function formatElapsed(seconds) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function useElapsed(timer) {
  const [elapsed, setElapsed] = useState(0)
  const intervalRef = useRef(null)

  useEffect(() => {
    clearInterval(intervalRef.current)
    if (!timer) { setElapsed(0); return }

    function compute() {
      let total = timer.priorSeconds ?? 0
      if (timer.running && timer.startedAt) {
        const started = new Date(timer.startedAt).getTime()
        total += Math.max(0, Math.floor((Date.now() - started) / 1000))
      }
      setElapsed(total)
    }

    compute()
    if (timer.running) intervalRef.current = setInterval(compute, 1000)
    return () => clearInterval(intervalRef.current)
  }, [timer])

  return elapsed
}

export default function TimerWidget() {
  const { timer, pauseTimer, resumeTimer, stopTimer } = useTimer()
  const elapsed = useElapsed(timer)

  const [expanded, setExpanded] = useState(false)
  const [taskData, setTaskData] = useState(null)
  const [loadingTask, setLoadingTask] = useState(false)
  const prevTaskId = useRef(null)

  // Auto-expand when a new task starts
  useEffect(() => {
    if (timer && timer.taskId !== prevTaskId.current) {
      setExpanded(true)
      prevTaskId.current = timer.taskId
      setTaskData(null)
    }
    if (!timer) {
      prevTaskId.current = null
      setExpanded(false)
      setTaskData(null)
    }
  }, [timer])

  // Fetch full task whenever we expand
  useEffect(() => {
    if (!expanded || !timer?.taskId) return
    setLoadingTask(true)
    getTask(timer.taskId)
      .then(t => setTaskData(t))
      .catch(() => {})
      .finally(() => setLoadingTask(false))
  }, [expanded, timer?.taskId])

  function refreshTask() {
    if (!timer?.taskId) return
    getTask(timer.taskId).then(t => setTaskData(t)).catch(() => {})
    window.dispatchEvent(new CustomEvent('basira:task-updated', { detail: { taskId: timer.taskId } }))
  }

  if (!timer) return null

  const isRunning = timer.running

  /* ── Minimized pill (bottom-center) ── */
  if (!expanded) {
    return (
      <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
        <div className="pointer-events-auto bg-[#1B3A2D] text-white rounded-full shadow-2xl px-5 py-3 flex items-center gap-3 min-w-[300px] max-w-[90vw]">
          {/* Pulse indicator */}
          <div className="relative flex-shrink-0 w-2.5 h-2.5">
            <span className={`absolute inset-0 rounded-full ${isRunning ? 'bg-[#E8C334]' : 'bg-white/40'}`} />
            {isRunning && <span className="absolute inset-0 rounded-full bg-[#E8C334] animate-ping opacity-50" />}
          </div>

          {/* ACTIVE TIMER label + task name */}
          <div className="flex-1 min-w-0">
            <div className="text-[9px] font-bold uppercase tracking-widest text-white/50 leading-none mb-0.5">
              {isRunning ? 'ACTIVE TIMER' : 'PAUSED'}
            </div>
            <div className="text-sm font-semibold truncate leading-tight">{timer.taskTitle}</div>
          </div>

          {/* Elapsed */}
          <span className="font-mono font-bold text-[#E8C334] text-base tabular-nums flex-shrink-0">
            {formatElapsed(elapsed)}
          </span>

          {/* Expand arrow */}
          <button onClick={() => setExpanded(true)} title="Expand"
            className="w-8 h-8 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/20 transition-colors text-sm flex-shrink-0">
            →
          </button>

          {/* Pause/Resume */}
          <button onClick={isRunning ? pauseTimer : resumeTimer} title={isRunning ? 'Pause' : 'Resume'}
            className="w-8 h-8 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/20 transition-colors text-sm flex-shrink-0">
            {isRunning ? '⏸' : '▶'}
          </button>

          {/* Stop */}
          <button onClick={stopTimer} title="Stop"
            className="w-8 h-8 rounded-full flex items-center justify-center bg-white/10 hover:bg-red-500/80 transition-colors text-sm flex-shrink-0">
            ⏹
          </button>
        </div>
      </div>
    )
  }

  /* ── Expanded overlay (keeps the pill + shows panel above) ── */
  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" onClick={() => setExpanded(false)} />

      {/* Card panel — centered */}
      <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none px-4 py-8">
        <div className="pointer-events-auto w-full max-w-sm flex flex-col rounded-2xl shadow-2xl overflow-hidden max-h-[88vh]">

          {/* Dark header */}
          <div className={`flex-shrink-0 transition-colors duration-500 ${isRunning ? 'bg-[#1B3A2D]' : 'bg-[#2c2018]'}`}>

            {/* Top bar */}
            <div className="flex items-center justify-between px-5 pt-4 pb-1">
              <div className="flex items-center gap-2">
                <div className="relative w-2 h-2 flex-shrink-0">
                  <span className={`absolute inset-0 rounded-full ${isRunning ? 'bg-[#E8C334]' : 'bg-white/40'}`} />
                  {isRunning && <span className="absolute inset-0 rounded-full bg-[#E8C334] animate-ping opacity-50" />}
                </div>
                <span className={`text-[11px] font-bold uppercase tracking-widest ${isRunning ? 'text-[#E8C334]' : 'text-white/40'}`}>
                  {isRunning ? 'In Focus' : 'Paused'}
                </span>
              </div>
              <button onClick={() => setExpanded(false)}
                className="text-white/30 hover:text-white/70 transition-colors w-7 h-7 flex items-center justify-center rounded-xl hover:bg-white/10 text-sm"
                title="Minimize">↓</button>
            </div>

            {/* Task name */}
            <div className="px-5 pt-3 pb-1">
              {timer.goalTitle && (
                <p className="text-xs font-medium mb-0.5 truncate text-[#E8C334]/70">{timer.goalTitle}</p>
              )}
              <p className="text-white text-lg font-bold leading-snug">{timer.taskTitle}</p>
            </div>

            {/* Clock */}
            <div className="px-5 py-4 text-center">
              <span className={`text-5xl font-mono font-bold tabular-nums tracking-tight ${isRunning ? 'text-white' : 'text-white/40'}`}>
                {formatElapsed(elapsed)}
              </span>
            </div>

            {/* Pause / Stop */}
            <div className="px-5 pb-5 flex gap-3">
              <button onClick={isRunning ? pauseTimer : resumeTimer}
                className={`flex-1 py-2.5 rounded-xl font-semibold text-sm transition-all ${
                  isRunning
                    ? 'bg-white/10 text-white hover:bg-white/20 border border-white/10'
                    : 'bg-[#E8C334] text-[#1A1A1A] hover:bg-yellow-300'
                }`}>
                {isRunning ? '⏸  Pause' : '▶  Resume'}
              </button>
              <button onClick={stopTimer}
                className="py-2.5 px-5 rounded-xl font-semibold text-sm bg-white/5 text-white/50 hover:bg-red-500/80 hover:text-white transition-all border border-white/5">
                ⏹ Stop
              </button>
            </div>
          </div>

          {/* Light panel: notes & comments */}
          <div className="flex-1 bg-white overflow-y-auto min-h-0">
            <div className="px-5 py-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-sand-400 mb-3">
                Notes &amp; Comments
              </p>
              {loadingTask ? (
                <p className="text-sm text-sand-400 text-center py-4">Loading…</p>
              ) : taskData ? (
                <ActivityComments task={taskData} onRefresh={refreshTask} />
              ) : (
                <p className="text-sm text-sand-400 italic text-center py-4">Could not load task</p>
              )}
            </div>
          </div>

        </div>
      </div>
    </>
  )
}
