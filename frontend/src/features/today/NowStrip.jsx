import { useEffect, useRef, useState } from 'react'
import Icon from '../../components/Icon'
import { fmtDuration, fmtMinutes, fmtClock } from './format'

const SOURCE_BADGE = { task: 'Task', ticket: 'Ticket', worklog: 'Log' }

function nowMinutes() {
  const d = new Date()
  return d.getHours() * 60 + d.getMinutes()
}
function toMin(hhmm) {
  if (!hhmm) return null
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

// Sticky Now / Next strip (mockup zone B): what is running, or what is next, or a
// prompt to plan. One primary timer presentation for the active session.
export default function NowStrip({ workspace, timer, onPause, onResume, onDone, onStart, onOpenPlanner, onOpenTicket, onSwitch }) {
  const [, force] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)
  useEffect(() => {
    const id = setInterval(() => force(n => n + 1), 1000)
    return () => clearInterval(id)
  }, [])
  useEffect(() => {
    function onDoc(e) { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  if (!workspace) return null
  const active = (workspace.active_timers || [])[0] || null
  const schedule = [...(workspace.agenda || [])].sort((a, b) => (a.scheduled_time || '').localeCompare(b.scheduled_time || ''))
  const unfinished = [...(workspace.agenda || []), ...(workspace.unscheduled || [])]
    .filter(i => i.status !== 'done' && (!active || i.key !== active.key))

  // Next = first scheduled item later than now that isn't the active one.
  const now = nowMinutes()
  const next = schedule.find(i => {
    const m = toMin(i.scheduled_time)
    return m != null && m >= now && i.status !== 'done' && (!active || i.key !== active.key)
  })
  const nextIn = next ? Math.max(0, toMin(next.scheduled_time) - now) : null

  // ── (a) Running ──
  if (active) {
    const taskRunning = active.source === 'task' && timer?.taskId === active.item_id
    const paused = active.source === 'task' && timer?.taskId === active.item_id && !timer.running
    const elapsed = paused
      ? (timer.priorSeconds || 0)
      : Math.max(0, Math.floor((Date.now() - new Date(active.started_at).getTime()) / 1000)) + (timer?.priorSeconds && taskRunning ? 0 : 0)
    const plannedMin = active.planned_minutes || 0
    const pct = plannedMin > 0 ? Math.min(100, Math.round((elapsed / 60 / plannedMin) * 100)) : 0
    return (
      <div className="now-strip">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <span className={`status-dot ${paused ? '' : 'live'} flex-shrink-0`} />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-ink truncate">
              <span className="text-[10px] font-mono uppercase text-accent mr-2">{paused ? 'Paused' : 'Now'}</span>{active.title}
            </p>
            <p className="text-[11px] text-muted truncate">
              {active.project_title}{active.company_name && active.company_name !== 'Personal' ? ` · ${active.company_name}` : ''}
              {plannedMin > 0 && <> · {fmtDuration(elapsed)} of {fmtMinutes(plannedMin)}</>}
            </p>
            {plannedMin > 0 && <div className="now-bar mt-1"><div className="now-bar-fill" style={{ width: `${pct}%` }} /></div>}
          </div>
          <span className="font-mono tabular-nums text-ink text-sm flex-shrink-0">{fmtDuration(elapsed)}</span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {paused
            ? <button className="agenda-btn text-accent" onClick={onResume}><Icon name="play" size={13}/>Resume</button>
            : <button className="agenda-btn" onClick={() => onPause(active)}><Icon name="pause" size={13}/>Pause</button>}
          {active.source === 'task'
            ? <button className="agenda-btn" onClick={() => onDone(active)}><Icon name="check" size={13}/>Done</button>
            : <button className="agenda-btn" onClick={() => onOpenTicket(active)}>Open</button>}
          <div className="relative" ref={menuRef}>
            <button className="agenda-btn" onClick={() => setMenuOpen(v => !v)} aria-haspopup="menu" aria-expanded={menuOpen}>Switch ▾</button>
            {menuOpen && (
              <div className="now-menu" role="menu">
                {unfinished.length === 0 && <p className="px-3 py-2 text-xs text-muted">No other work today</p>}
                {unfinished.slice(0, 8).map(i => (
                  <button key={i.key} role="menuitem" className="now-menu-item" onClick={() => { setMenuOpen(false); onSwitch(i) }}>
                    <span className="text-[9px] font-mono uppercase text-faint mr-1.5">{SOURCE_BADGE[i.source] || i.source}</span>{i.title}
                  </button>
                ))}
                <button role="menuitem" className="now-menu-item text-accent" onClick={() => { setMenuOpen(false); onOpenPlanner() }}>Find…</button>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ── (b) Idle with a plan ──
  if (next) {
    return (
      <div className="now-strip">
        <p className="text-sm text-muted min-w-0 flex-1 truncate">
          <span className="text-[10px] font-mono uppercase text-muted mr-2">Next</span>
          <span className="text-ink">{next.title}</span>
          {next.scheduled_time && <> at <span className="font-mono tabular-nums">{fmtClock(next.scheduled_time)}</span></>}
          {nextIn != null && nextIn > 0 && <span className="text-faint"> · in {fmtMinutes(nextIn)}</span>}
        </p>
        {next.source === 'task'
          ? <button className="agenda-btn text-accent flex-shrink-0" onClick={() => onStart(next)}><Icon name="play" size={13}/>Start now</button>
          : <button className="agenda-btn flex-shrink-0" onClick={() => onOpenTicket(next)}>Open</button>}
      </div>
    )
  }

  // ── (c) No plan ──
  return (
    <div className="now-strip">
      <p className="text-sm text-muted min-w-0 flex-1">Nothing scheduled yet.</p>
      <button className="primary-button flex-shrink-0" onClick={onOpenPlanner}><Icon name="goals" size={14}/>Plan your day</button>
    </div>
  )
}
