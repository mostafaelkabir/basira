import { useCallback, useEffect, useRef, useState } from 'react'
import { getTimerToday, updateTask, getDailySchedule } from './api'
import { formatDuration } from './components/EstimatedTimePicker'
import { useTimer } from './TimerContext'

// ── Constants ─────────────────────────────────────────────────────────────────
const HOUR_H    = 72        // px per hour
const DAY_START = 7         // 7 AM
const DAY_END   = 22        // 10 PM
const SNAP      = 15        // snap to nearest 15 min
const MIN_DUR   = 15        // minimum task duration in minutes
const TOTAL_H   = (DAY_END - DAY_START) * HOUR_H   // 1080px

// ── Math helpers ──────────────────────────────────────────────────────────────
const minToPx  = m  => (m  / 60) * HOUR_H
const pxToMin  = px => (px / HOUR_H) * 60
const snap     = m  => Math.round(m / SNAP) * SNAP
const clamp    = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

function fmtAbs(absMin) {           // absolute minutes from midnight → "9:30 AM"
  const h = Math.floor(absMin / 60)
  const m = absMin % 60
  const p = h >= 12 ? 'PM' : 'AM'
  const dh = h % 12 || 12
  return `${dh}:${String(m).padStart(2, '0')} ${p}`
}

// ── LocalStorage helpers ──────────────────────────────────────────────────────
function loadCal(date)        { try { return JSON.parse(localStorage.getItem(`basira_cal_${date}`) || '{}') } catch { return {} } }
function saveCal(date, sched) { localStorage.setItem(`basira_cal_${date}`, JSON.stringify(sched)) }

// Work items (tickets/logs) get a per-day session duration stored locally —
// never the ticket's overall estimated_minutes, which reflects total project
// scope and shouldn't be overwritten just because today's session was 20 min.
const WORK_DEFAULT_MIN = 30
function loadWorkDurs(date)        { try { return JSON.parse(localStorage.getItem(`basira_cal_workdurs_${date}`) || '{}') } catch { return {} } }
function saveWorkDurs(date, durs)  { localStorage.setItem(`basira_cal_workdurs_${date}`, JSON.stringify(durs)) }

function durationFor(item, workDurs) {
  if (item._kind === 'ticket' || item._kind === 'worklog') {
    return workDurs[item.id] ?? WORK_DEFAULT_MIN
  }
  return item.estimated_minutes || 30
}

function buildInitialSchedule(items, existing, workDurs) {
  const out = { ...existing }
  let cursor = DAY_START * 60
  for (const t of items) {
    if (!(t.id in out)) {
      out[t.id] = cursor
      cursor += durationFor(t, workDurs)
    }
  }
  return out
}

// ── Current-time red line ─────────────────────────────────────────────────────
function NowLine() {
  const [pos, setPos] = useState(null)
  useEffect(() => {
    function update() {
      const now = new Date()
      const h = now.getHours(), m = now.getMinutes()
      if (h < DAY_START || h >= DAY_END) { setPos(null); return }
      setPos(minToPx((h - DAY_START) * 60 + m))
    }
    update()
    const id = setInterval(update, 60_000)
    return () => clearInterval(id)
  }, [])
  if (pos === null) return null
  return (
    <div className="absolute left-0 right-0 z-20 pointer-events-none flex items-center" style={{ top: pos }}>
      <div className="w-2.5 h-2.5 rounded-full bg-terra-500 flex-shrink-0 -ml-1.5" />
      <div className="flex-1 h-px bg-terra-500 opacity-70" />
    </div>
  )
}

// ── Task block ────────────────────────────────────────────────────────────────
function TaskBlock({ task, startMin, duration, isDragging, isTop, actualMin, onMouseDownMove, onMouseDownResize, onStartTimer }) {
  const isDone   = task.status === 'done' || task.checked_today || task.done
  const isFocus  = task._section === 'focus'
  const isWork   = task._kind === 'ticket' || task._kind === 'worklog'
  const top      = minToPx(startMin - DAY_START * 60)
  const height   = Math.max(minToPx(duration), minToPx(MIN_DUR))
  const pct      = duration > 0 ? Math.min(100, Math.round((actualMin / duration) * 100)) : 0
  const endMin   = startMin + duration

  const accentColor = isDone ? 'rgb(var(--faint))' : isFocus ? 'rgb(var(--gold))' : isWork ? 'rgb(var(--info))' : 'rgb(var(--accent))'
  const zIndex   = isDragging ? 200 : isTop ? 10 : 2

  return (
    <div
      style={{ position: 'absolute', top, left: 6, right: 6, height, zIndex }}
      className="group cursor-grab active:cursor-grabbing"
      onMouseDown={onMouseDownMove}
    >
      <div
        className={`h-full rounded-xl border overflow-hidden transition-shadow select-none ${
          isDragging ? 'shadow-2xl ring-2 ring-teal-400/60' : 'shadow-sm hover:shadow-md'
        } ${
          isDone
            ? 'bg-sage-50 border-sage-200'
            : isFocus
            ? 'bg-gold-50 border-gold-200'
            : isWork
            ? 'bg-brand/5 border-accent/20'
            : 'bg-surface border-sand-200'
        }`}
        style={{ borderLeft: `3px solid ${accentColor}` }}
      >
        {/* Actual-time progress bar */}
        {!isDone && actualMin > 0 && (
          <div className="h-0.5 bg-sand-100 flex-shrink-0">
            <div className={`h-full transition-all ${pct >= 100 ? 'bg-terra-400' : 'bg-teal-400'}`} style={{ width: `${pct}%` }} />
          </div>
        )}

        <div className="px-2 py-1.5 flex flex-col gap-0.5 overflow-hidden h-full">
          <div className="flex items-center gap-1">
            {isWork && (
              <span className="text-[8px] font-bold px-1 py-0.5 rounded bg-brand text-white flex-shrink-0 leading-none">
                WORK
              </span>
            )}
            <p className={`text-[11px] font-semibold leading-tight truncate ${isDone ? 'line-through text-sand-400' : 'text-sand-800'}`}>
              {task.title}
            </p>
          </div>
          {height >= minToPx(24) && (
            <p className="text-[10px] text-sand-400 leading-none truncate">
              {fmtAbs(startMin)}–{fmtAbs(endMin)}
              {duration ? ` · ${formatDuration(duration)}` : ''}
              {isWork && task.company_name ? ` · ${task.company_name}` : ''}
            </p>
          )}
          {height >= minToPx(40) && actualMin > 0 && (
            <p className={`text-[10px] font-medium leading-none ${pct >= 100 ? 'text-terra-500' : 'text-teal-500'}`}>
              {formatDuration(actualMin)} spent
            </p>
          )}
          {!isDone && !isWork && height >= minToPx(45) && (
            <button
              onMouseDown={e => e.stopPropagation()}
              onClick={e => { e.stopPropagation(); onStartTimer() }}
              className="self-start mt-auto text-[10px] px-1.5 py-0.5 rounded border border-teal-200 text-teal-500 hover:bg-teal-50 leading-none">
              ▶
            </button>
          )}
        </div>

        {/* Resize handle — hidden for completed tasks */}
        {!isDone && (
          <div
            style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 8, cursor: 'ns-resize' }}
            className="opacity-0 group-hover:opacity-100 bg-gradient-to-b from-transparent to-teal-100/60 flex items-end justify-center pb-0.5 transition-opacity"
            onMouseDown={e => { e.stopPropagation(); e.preventDefault(); onMouseDownResize(e) }}
          >
            <div className="w-8 h-0.5 rounded-full bg-teal-400/50" />
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function PlannerView({ items: rawItems, focusItems, date }) {
  const { startTimer } = useTimer()
  const [items, setItems]             = useState([])
  const [schedule, setSchedule]       = useState({})   // taskId → startMin (absolute)
  const [durations, setDurations]     = useState({})   // taskId → minutes
  const [todaySeconds, setTodaySeconds] = useState({})
  const [draggingId, setDraggingId]   = useState(null)
  const [topId, setTopId]             = useState(null)   // last-moved task stays on top

  // Live values while dragging (avoid setState lag)
  const scheduleRef  = useRef({})
  const durationsRef = useRef({})
  const dragRef      = useRef(null) // { taskId, mode, startY, origMin, origDur }

  const [workItems, setWorkItems] = useState([])

  // ── Fetch Daily Schedule work items (tickets/logs) ──
  useEffect(() => {
    getDailySchedule()
      .then(scheduled => {
        setWorkItems(
          scheduled
            .filter(i => i.kind === 'ticket' || i.kind === 'worklog')
            .map(i => ({ ...i, _kind: i.kind, _section: 'work', status: i.done ? 'done' : 'todo' }))
        )
      })
      .catch(() => {})
  }, [date])

  // ── Merge focus + plan + work ──
  useEffect(() => {
    const focusIds = new Set((focusItems || []).map(t => t.id))
    setItems([
      ...(focusItems || []).map(t => ({ ...t, _kind: 'task', _section: 'focus' })),
      ...rawItems.filter(t => !focusIds.has(t.id)).map(t => ({ ...t, _kind: 'task', _section: 'plan' })),
      ...workItems,
    ])
  }, [rawItems, focusItems, workItems])

  // ── Initialize schedule (render-only; never writes on mount) ──
  // Auto-laid-out start times are held in memory for display. We deliberately do
  // NOT persist them here — a generated layout must not masquerade as a committed
  // plan. Legacy saved positions are read back, and storage is written only when
  // the user actually drags a block (see onMouseUp).
  useEffect(() => {
    if (!items.length) return
    const existing = loadCal(date)
    const existingWorkDurs = loadWorkDurs(date)
    const init = buildInitialSchedule(items, existing, existingWorkDurs)
    const durs = Object.fromEntries(items.map(t => [t.id, durationFor(t, existingWorkDurs)]))
    setSchedule(init)
    setDurations(durs)
    scheduleRef.current  = init
    durationsRef.current = durs
  }, [items, date])

  // ── Timer data ──
  useEffect(() => {
    getTimerToday()
      .then(d => {
        const m = {}
        for (const e of (d.tasks || [])) m[e.task_id] = e.seconds
        setTodaySeconds(m)
      }).catch(() => {})
  }, [])

  // ── Mouse move ──
  const onMouseMove = useCallback(e => {
    const drag = dragRef.current
    if (!drag) return
    const dy   = e.clientY - drag.startY
    const dmin = pxToMin(dy)

    if (drag.mode === 'move') {
      const newStart = snap(clamp(
        drag.origMin + dmin,
        DAY_START * 60,
        DAY_END   * 60 - (durationsRef.current[drag.taskId] || MIN_DUR)
      ))
      scheduleRef.current = { ...scheduleRef.current, [drag.taskId]: newStart }
      setSchedule({ ...scheduleRef.current })

    } else {
      const newDur = snap(Math.max(MIN_DUR, drag.origDur + dmin))
      durationsRef.current = { ...durationsRef.current, [drag.taskId]: newDur }
      setDurations({ ...durationsRef.current })
    }
  }, [])

  // ── Mouse up ──
  const onMouseUp = useCallback(async () => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    setDraggingId(null)

    if (drag.mode === 'move') {
      saveCal(date, scheduleRef.current)
    } else {
      const newDur = durationsRef.current[drag.taskId]
      const target = items.find(t => t.id === drag.taskId)
      const isWorkItem = target?._kind === 'ticket' || target?._kind === 'worklog'

      if (isWorkItem) {
        // Work items: today's planned session length is local-only and never
        // touches the ticket's overall estimated_minutes (total project scope).
        const workDurs = { ...loadWorkDurs(date), [drag.taskId]: newDur }
        saveWorkDurs(date, workDurs)
      } else {
        setItems(prev => prev.map(t => t.id === drag.taskId ? { ...t, estimated_minutes: newDur } : t))
        try { await updateTask(drag.taskId, { estimated_minutes: newDur }) } catch {}
      }
    }
  }, [date, items])

  useEffect(() => {
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup',   onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup',   onMouseUp)
    }
  }, [onMouseMove, onMouseUp])

  function startDrag(e, taskId, mode) {
    e.preventDefault()
    e.stopPropagation()
    dragRef.current = {
      taskId,
      mode,
      startY:   e.clientY,
      origMin:  scheduleRef.current[taskId]  ?? DAY_START * 60,
      origDur:  durationsRef.current[taskId] ?? 30,
    }
    setDraggingId(taskId)
    setTopId(taskId)
  }

  const todoCount = items.filter(t => t.status !== 'done' && !t.checked_today).length

  return (
    <div className="space-y-3">
      {/* Hint bar */}
      <div className="flex items-center justify-between text-xs text-sand-400">
        <span>Drag to move · drag bottom edge to resize</span>
        <span>{todoCount} tasks · {fmtAbs(DAY_START * 60)} – {fmtAbs(DAY_END * 60)}</span>
      </div>

      {/* Scrollable calendar */}
      <div className="rounded-2xl border border-sand-200 overflow-hidden">
        <div className="overflow-y-auto" style={{ maxHeight: '72vh' }}>
          <div className="flex">

            {/* ── Time labels ── */}
            <div className="flex-shrink-0 w-14 relative bg-surface border-r border-sand-100" style={{ height: TOTAL_H }}>
              {Array.from({ length: DAY_END - DAY_START + 1 }, (_, i) => {
                const absH = DAY_START + i
                return (
                  <div key={absH} className="absolute right-2" style={{ top: i * HOUR_H - 7 }}>
                    <span className="text-[10px] text-sand-400 font-medium whitespace-nowrap">
                      {absH < 12 ? `${absH} AM` : absH === 12 ? '12 PM' : `${absH - 12} PM`}
                    </span>
                  </div>
                )
              })}
            </div>

            {/* ── Grid + tasks ── */}
            <div
              className="flex-1 relative bg-surface"
              style={{ height: TOTAL_H, userSelect: draggingId ? 'none' : undefined }}
            >
              {/* Hour lines */}
              {Array.from({ length: DAY_END - DAY_START + 1 }, (_, i) => (
                <div key={i} className="absolute left-0 right-0 border-t border-sand-100" style={{ top: i * HOUR_H }} />
              ))}
              {/* Half-hour lines */}
              {Array.from({ length: DAY_END - DAY_START }, (_, i) => (
                <div key={`hh-${i}`} className="absolute left-0 right-0 border-t border-sand-50" style={{ top: i * HOUR_H + HOUR_H / 2 }} />
              ))}

              {/* Current time */}
              <NowLine />

              {/* Tasks */}
              {items.map(task => (
                <TaskBlock
                  key={task.id}
                  task={task}
                  startMin={schedule[task.id] ?? DAY_START * 60}
                  duration={durations[task.id] ?? (task.estimated_minutes || 30)}
                  isDragging={draggingId === task.id}
                  isTop={topId === task.id}
                  actualMin={Math.floor((todaySeconds[task.id] || 0) / 60)}
                  onMouseDownMove={e => startDrag(e, task.id, 'move')}
                  onMouseDownResize={e => startDrag(e, task.id, 'resize')}
                  onStartTimer={() => startTimer(task.id, task.title, task.goal_title || task._goalTitle || '')}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {items.length === 0 && (
        <p className="text-sm text-sand-400 text-center py-8 italic">
          No tasks planned today — add them from the List view
        </p>
      )}
    </div>
  )
}
