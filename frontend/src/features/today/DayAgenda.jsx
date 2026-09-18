import { useEffect, useState } from 'react'
import Icon from '../../components/Icon'
import { fmtClock, fmtDuration, fmtMinutes } from './format'

// One chronological Today agenda: scheduled Tasks, tickets and habit occurrences in
// time order, an "Anytime today" group for selected items without a time, and a
// collapsed "Completed" section. The active item owns its running timer inline —
// it is never copied into a separate hero. Read-only rendering; all mutations go
// through the handlers passed by TodayPage.

const SOURCE_DOT = {
  task: 'rgb(var(--accent))',
  ticket: 'rgb(96 165 250)',
  worklog: 'rgb(167 139 250)',
  habit: 'rgb(var(--gold))',
}
const SOURCE_LABEL = { task: 'Task', ticket: 'Ticket', worklog: 'Log', habit: 'Habit' }

function Elapsed({ startedAt, priorSeconds = 0 }) {
  const [, force] = useState(0)
  useEffect(() => { const id = setInterval(() => force(n => n + 1), 1000); return () => clearInterval(id) }, [])
  const base = startedAt ? Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000) : 0
  return <span className="font-mono tabular-nums">{fmtDuration(priorSeconds + Math.max(0, base))}</span>
}

function Row({ item, timer, onStartTask, onPauseTask, onResumeTask, onCompleteTask, onOpenTicket, onCheckHabit, onEditTime }) {
  const [editing, setEditing] = useState(false)
  const isTask = item.source === 'task'
  const isTicket = item.source === 'ticket'
  const isHabit = item.source === 'habit'
  const taskActive = isTask && timer?.taskId === item.item_id
  const running = taskActive && timer.running
  const recorded = item.recorded_seconds + (item.live_seconds || 0)

  return (
    <div className={`agenda-row ${item.active || running ? 'agenda-row-active' : ''}`}>
      <div className="w-14 flex-shrink-0 text-right pt-0.5">
        {editing ? (
          <input type="time" defaultValue={item.scheduled_time || ''} autoFocus
            onBlur={e => { setEditing(false); if (e.target.value !== (item.scheduled_time || '')) onEditTime?.(item, e.target.value) }}
            className="w-[74px] text-xs bg-surface border border-accent rounded-md px-1 py-0.5 focus:outline-none" />
        ) : item.scheduled_time ? (
          <button onClick={() => onEditTime && setEditing(true)} className="text-xs font-mono text-ink tabular-nums hover:text-accent">{fmtClock(item.scheduled_time)}</button>
        ) : (
          <button onClick={() => onEditTime && setEditing(true)} className="text-[10px] text-faint uppercase hover:text-accent">Anytime</button>
        )}
      </div>

      {isHabit ? (
        <button onClick={() => onCheckHabit?.(item)} aria-label={`Check ${item.title}`}
          className={`w-4 h-4 mt-1 rounded-md border flex items-center justify-center flex-shrink-0 text-[10px] ${
            item.done ? 'bg-accent border-accent text-on-accent' : 'border-border-strong hover:border-accent'}`}>
          {item.done ? '✓' : ''}
        </button>
      ) : (
        <span className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ background: SOURCE_DOT[item.source] }} />
      )}

      <div className="flex-1 min-w-0">
        {isTicket
          ? <button onClick={() => onOpenTicket(item)} className="text-sm text-ink truncate text-left hover:text-accent">{item.title}</button>
          : <p className={`text-sm truncate ${item.done ? 'text-muted line-through' : 'text-ink'}`}>{item.title}</p>}
        <p className="text-[11px] text-muted mt-0.5 flex items-center gap-1.5 flex-wrap">
          <span>{item.project_title}</span>
          {item.company_name && item.company_name !== 'Personal' && <><span className="text-faint">·</span><span>{item.company_name}</span></>}
          {isHabit && item.habitTarget > 1 && <><span className="text-faint">·</span><span>{item.habitCount}/{item.habitTarget}</span></>}
          {!isHabit && item.planned_minutes > 0 && <><span className="text-faint">·</span><span>{fmtMinutes(item.planned_minutes)} planned</span></>}
          {running && <><span className="text-faint">·</span><span className="text-accent flex items-center gap-1"><span className="status-dot live" /><Elapsed startedAt={timer.startedAt} priorSeconds={timer.priorSeconds} /></span></>}
          {!running && recorded > 0 && !isHabit && <><span className="text-faint">·</span><span className="text-accent">{fmtDuration(recorded)} recorded</span></>}
        </p>
      </div>

      {/* Actions */}
      {!item.done && (
        <div className="flex items-center gap-1 flex-shrink-0">
          {isTask && running && (
            <button onClick={onPauseTask} className="agenda-btn"><Icon name="pause" size={13} />Pause</button>
          )}
          {isTask && taskActive && !running && (
            <button onClick={onResumeTask} className="agenda-btn text-accent"><Icon name="play" size={13} />Resume</button>
          )}
          {isTask && !taskActive && (
            <button onClick={() => onStartTask(item)} className="agenda-btn text-accent"><Icon name="play" size={13} />Start</button>
          )}
          {isTask && (
            <button onClick={() => onCompleteTask(item)} className="agenda-btn"><Icon name="check" size={13} />Done</button>
          )}
          {isTicket && (
            <button onClick={() => onOpenTicket(item)} className="agenda-btn">Open</button>
          )}
        </div>
      )}
    </div>
  )
}

export default function DayAgenda({
  scheduled, anytime, completed, timer,
  onStartTask, onPauseTask, onResumeTask, onCompleteTask, onOpenTicket, onCheckHabit, onEditTime,
}) {
  const [showDone, setShowDone] = useState(false)
  const rowProps = { timer, onStartTask, onPauseTask, onResumeTask, onCompleteTask, onOpenTicket, onCheckHabit, onEditTime }
  const empty = scheduled.length === 0 && anytime.length === 0 && completed.length === 0

  return (
    <div className="bg-surface border border-border rounded-2xl shadow-card">
      {empty && (
        <div className="p-8 text-center">
          <p className="text-sm text-muted">Nothing planned yet.</p>
          <p className="text-xs text-faint mt-1">Use “Plan my day” to choose what to work on.</p>
        </div>
      )}

      {scheduled.length > 0 && (
        <div className="divide-y divide-border px-4">
          {scheduled.map(i => <Row key={i.key} item={i} {...rowProps} />)}
        </div>
      )}

      {anytime.length > 0 && (
        <div className="border-t border-border px-4 pt-2 pb-1">
          <p className="text-[11px] font-mono uppercase tracking-wide text-muted mb-1 pt-1">Anytime today</p>
          <div className="divide-y divide-border">
            {anytime.map(i => <Row key={i.key} item={i} {...rowProps} />)}
          </div>
        </div>
      )}

      {completed.length > 0 && (
        <div className="border-t border-border px-4 py-2">
          <button onClick={() => setShowDone(v => !v)} className="w-full flex items-center justify-between text-[11px] font-mono uppercase tracking-wide text-muted py-1">
            <span>Completed · {completed.length}</span>
            <span>{showDone ? '▴' : '▾'}</span>
          </button>
          {showDone && (
            <div className="divide-y divide-border">
              {completed.map(i => <Row key={i.key} item={i} {...rowProps} />)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
