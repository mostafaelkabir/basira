import { useState } from 'react'
import { BaseBoxShapeUtil, HTMLContainer, T, useEditor, useValue } from 'tldraw'
import { completeTask, updateWorkTicket } from '../../api'
import { countdown, dueMeta, shortDate } from '../work/due'
import { notify } from '../../components/Notice'
import { useEntity } from './entityStore'

export const CARD_TYPE = 'sysgo-card'
export const CARD_SIZE = { ticket: { w: 300, h: 148 }, task: { w: 280, h: 118 }, goal: { w: 280, h: 122 }, milestone: { w: 300, h: 128 } }
export const STATUS_ORDER = ['backlog', 'todo', 'in_progress', 'review', 'blocked', 'done']

// tldraw constructs shape utils itself, so the hosting board reaches them through this bridge.
export const cardBridge = { onOpen: null, onPromote: null, onLaneDrop: null }

const STATUS_LABEL = { backlog: 'Backlog', todo: 'To do', in_progress: 'In progress', review: 'Review', done: 'Done', blocked: 'Blocked' }
const TYPE_ICON = { code: '⌨️', research: '🔬', planning: '📋', review: '🔍', meeting: '🤝' }
const PRIORITY = {
  low: ['↓', 'rgb(var(--muted))'], medium: ['→', 'rgb(var(--warning))'],
  high: ['↑', 'rgb(var(--warning))'], urgent: ['⚡', 'rgb(var(--danger))'],
}
const fmtMins = m => !m ? '0m' : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`
const fmtDate = d => { try { return new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) } catch { return d } }
const isImageUrl = icon => icon && (icon.startsWith('/') || icon.startsWith('http'))
// Controls inside a card must not start a tldraw selection/drag or count as a card double-click.
const stop = e => e.stopPropagation()

// Level of detail: zoomed out, a card shows a big title and its status colour; zoomed in, everything.
function useLod() {
  const editor = useEditor()
  return useValue('card-lod', () => {
    const z = editor.getZoomLevel()
    return z >= 0.6 ? 'full' : z >= 0.32 ? 'compact' : 'mini'
  }, [editor])
}

/** A ticket, task or goal placed on a board. Only the link is stored; the card renders live data. */
export class SysgoCardUtil extends BaseBoxShapeUtil {
  static type = CARD_TYPE
  static props = { w: T.number, h: T.number, entity: T.string, entityId: T.string }

  getDefaultProps() { return { ...CARD_SIZE.ticket, entity: 'ticket', entityId: '' } }
  canEdit() { return false }
  canResize() { return true }
  isAspectRatioLocked() { return false }

  // Double-click opens the linked item. Returning a (no-op) partial tells tldraw's select tool the
  // double-click is handled, so it does not fall through to creating a text shape on the canvas.
  onDoubleClick(shape) {
    cardBridge.onOpen?.(shape.props.entity, shape.props.entityId)
    return { id: shape.id, type: shape.type }
  }

  component(shape) {
    return (
      <HTMLContainer style={{ pointerEvents: 'all' }}>
        <EntityCard entity={shape.props.entity} id={shape.props.entityId} />
      </HTMLContainer>
    )
  }

  // Selection/hover outline, drawn on tldraw's canvas overlay in the shape's local space.
  getIndicatorPath(shape) {
    const path = new Path2D()
    if (typeof path.roundRect === 'function') path.roundRect(0, 0, shape.props.w, shape.props.h, 14)
    else path.rect(0, 0, shape.props.w, shape.props.h)
    return path
  }
}

function EntityCard({ entity, id }) {
  const data = useEntity(entity, id)
  const lod = useLod()
  if (!data) {
    return (
      <div className="sysgo-card" data-entity={entity} data-tone="loading">
        <div className="card-eyebrow">{entity}</div>
        <div className="card-title" style={{ color: 'rgb(var(--faint))' }}>Loading…</div>
      </div>
    )
  }
  if (data.missing) {
    return (
      <div className="sysgo-card" data-entity={entity} data-tone="missing">
        <div>
          <div className="card-eyebrow" style={{ justifyContent: 'center' }}>{entity}</div>
          <div>This {entity} no longer exists</div>
        </div>
      </div>
    )
  }
  if (entity === 'ticket') return <TicketBody t={data} lod={lod} />
  if (entity === 'task') return <TaskBody t={data} lod={lod} />
  if (entity === 'milestone') return <MilestoneBody m={data} lod={lod} />
  return <GoalBody g={data} lod={lod} />
}

function DueChip({ iso, done }) {
  const m = dueMeta(iso, { done })
  if (!m) return null
  return <span className="due-chip" data-tone={m.tone} title={iso}>{m.label}</span>
}

function OpenButton({ entity, id }) {
  return (
    <button type="button" className="card-open" aria-label={`Open ${entity}`} title={`Open ${entity} (or double-click the card)`}
      onPointerDown={stop} onDoubleClick={stop} onClick={e => { e.stopPropagation(); cardBridge.onOpen?.(entity, id) }}>↗</button>
  )
}

function StatusSelect({ t }) {
  const [busy, setBusy] = useState(false)
  async function change(e) {
    const status = e.target.value
    e.target.blur()
    if (status === t.status) return
    setBusy(true)
    try {
      await updateWorkTicket(t.id, { status })
      window.dispatchEvent(new CustomEvent('basira:ticket-updated'))
    } catch (err) { notify(err.message) }
    finally { setBusy(false) }
  }
  return (
    <span className="card-pill card-status-wrap" data-status={t.status} title="Change status">
      <select className="card-status-select" value={t.status} disabled={busy} aria-label="Ticket status"
        onPointerDown={stop} onDoubleClick={stop} onChange={change}>
        {STATUS_ORDER.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
      </select>
    </span>
  )
}

function TaskCheck({ t }) {
  const done = t.status === 'done'
  const [busy, setBusy] = useState(false)
  if (done || t.is_habit) return <span className="card-check" data-done={done}>{done ? '✓' : ''}</span>
  async function finish(e) {
    e.stopPropagation()
    setBusy(true)
    try {
      await completeTask(t.id)
      window.dispatchEvent(new CustomEvent('basira:task-updated'))
    } catch (err) { notify(err.message) }
    finally { setBusy(false) }
  }
  return <button type="button" className="card-check card-check-btn" aria-label="Mark task done" title="Mark done" disabled={busy}
    onPointerDown={stop} onDoubleClick={stop} onClick={finish} />
}

function TicketBody({ t, lod }) {
  const done = t.status === 'done'
  const over = t.estimated_minutes > 0 && t.logged_minutes > t.estimated_minutes
  const pct = t.estimated_minutes ? Math.min(100, Math.round((t.logged_minutes / t.estimated_minutes) * 100)) : 0
  const [pIcon, pColor] = PRIORITY[t.priority] || PRIORITY.medium
  const time = t.estimated_minutes ? `${fmtMins(t.logged_minutes)} / ${fmtMins(t.estimated_minutes)}`
    : t.logged_minutes ? `${fmtMins(t.logged_minutes)} logged` : ''
  return (
    <div className="sysgo-card" data-entity="ticket" data-status={t.status} data-lod={lod} data-tone={done ? 'done' : undefined}>
      <div className="card-eyebrow">
        <span className="card-dot" style={{ background: t.company_color }} />
        <span className="card-company">{t.company_name}</span>
        <span>· {TYPE_ICON[t.type] || '⌨️'} {t.type}</span>
        <span className="grow" />
        <span className="card-flag" style={{ color: pColor }} title={`${t.priority} priority`}>{pIcon}</span>
        <StatusSelect t={t} />
      </div>
      <div className={`card-title ${done ? 'is-done' : ''}`}>
        {t.ticket_ref && <span className="card-ref">{t.ticket_ref}</span>}{t.title}
      </div>
      {t.estimated_minutes > 0 && <div className="card-bar" data-over={over}><span style={{ width: `${pct}%` }} /></div>}
      <div className="card-foot">
        <DueChip iso={t.due_date} done={done} />
        {t.milestone_title && <span className="card-milestone" title="Milestone">◆ {t.milestone_title}</span>}
        <span className="grow" />
        {time && <span>{time}</span>}
      </div>
      <OpenButton entity="ticket" id={t.id} />
    </div>
  )
}

function TaskBody({ t, lod }) {
  const done = t.status === 'done'
  const when = t.due_date ? `Due ${fmtDate(t.due_date)}` : t.plan_date ? `Planned ${fmtDate(t.plan_date)}` : ''
  return (
    <div className="sysgo-card" data-entity="task" data-status={t.status} data-lod={lod} data-tone={done ? 'done' : undefined}>
      <div className="card-eyebrow">
        <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {t.is_habit ? 'Habit · ' : ''}{t.goal_title || 'Task'}
        </span>
        {t.is_urgent && <span className="card-flag" style={{ color: 'rgb(var(--danger))' }} title="Urgent">!</span>}
        {t.is_important && <span className="card-flag" style={{ color: 'rgb(var(--gold))' }} title="Important">★</span>}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <TaskCheck t={t} />
        <div className={`card-title ${done ? 'is-done' : ''}`}>{t.title}</div>
      </div>
      <div className="card-foot">
        <span className="grow">{when}</span>
        {t.estimated_minutes ? <span>{fmtMins(t.estimated_minutes)}</span> : null}
      </div>
      <OpenButton entity="task" id={t.id} />
    </div>
  )
}

function MilestoneBody({ m, lod }) {
  const done = m.status === 'done'
  const pct = m.progress_pct || 0
  const tone = done ? 'done' : m.overdue ? 'overdue' : m.days_left === 0 ? 'today' : (m.days_left != null && m.days_left <= 7) ? 'soon' : 'later'
  return (
    <div className="sysgo-card" data-entity="milestone" data-lod={lod} data-tone={done ? 'done' : undefined} data-due={tone}>
      <div className="card-eyebrow">
        <span className="card-dot" style={{ background: m.company_color }} />
        <span className="card-company">{m.company_name}</span>
        <span>· milestone</span>
        <span className="grow" />
        <span className="due-chip" data-tone={tone}>{countdown(m.due_date, { done })}</span>
      </div>
      <div className={`card-title ${done ? 'is-done' : ''}`}><span className="card-diamond">◆</span>{m.title}</div>
      <div className="card-bar"><span style={{ width: `${pct}%` }} /></div>
      <div className="card-foot">
        <span className="grow">{m.ticket_count ? `${m.done_count}/${m.ticket_count} tickets · ${pct}%` : 'No tickets yet'}</span>
        {m.due_date && <span>{shortDate(m.due_date)}</span>}
      </div>
      <OpenButton entity="milestone" id={m.id} />
    </div>
  )
}

function GoalBody({ g, lod }) {
  const pct = g.task_count ? Math.round((g.done_count / g.task_count) * 100) : 0
  return (
    <div className="sysgo-card" data-entity="goal" data-lod={lod} data-tone={g.archived ? 'done' : undefined}>
      <div className="card-eyebrow">
        <span>{g.type || 'goal'}</span>
        <span className="grow" />
        {g.archived && <span>archived</span>}
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        {g.icon && <span className="card-icon">{isImageUrl(g.icon) ? <img src={g.icon} alt="" /> : g.icon}</span>}
        <div className="card-title">{g.title}</div>
      </div>
      <div className="card-bar"><span style={{ width: `${pct}%` }} /></div>
      <div className="card-foot">
        <span className="grow">{g.done_count}/{g.task_count} tasks</span>
        <span>{pct}%</span>
      </div>
      <OpenButton entity="goal" id={g.id} />
    </div>
  )
}
