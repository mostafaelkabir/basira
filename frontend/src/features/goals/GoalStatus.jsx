import { useState } from 'react'
import { setGoalStatus } from '../../api'
import Modal from '../../components/Modal'
import { notify } from '../../components/Notice'

// Outcomes a goal or project can have. The last three close it; blocked keeps it open.
export const GOAL_STATUS = {
  active:    { label: 'Active',    icon: '●', hint: 'Open and being worked on' },
  blocked:   { label: 'Blocked',   icon: '⛔', hint: 'Stays open, flagged until it is unblocked', needsReason: true, ask: 'What is it waiting on?' },
  achieved:  { label: 'Achieved',  icon: '✓', hint: 'Closed as a success', closes: true, ask: 'What did it achieve? (optional)' },
  moved_out: { label: 'Moved out', icon: '↷', hint: 'Closed for now, priorities shifted', closes: true, needsReason: true, ask: 'Why is it moving out, and when might it come back?' },
  cancelled: { label: 'Cancelled', icon: '✕', hint: 'Closed, not going to happen', closes: true, needsReason: true, ask: 'Why is it cancelled?' },
}
const ORDER = ['achieved', 'blocked', 'moved_out', 'cancelled']

export function GoalStatusBadge({ status, className = '' }) {
  const meta = GOAL_STATUS[status]
  if (!meta || status === 'active') return null
  return <span className={`goal-status ${className}`} data-status={status}>{meta.icon} {meta.label}</span>
}

export function fmtStatusDate(iso) {
  if (!iso) return ''
  const d = new Date(String(iso).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? '' : 'Z'))
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Close a goal as achieved, or mark it blocked / moved out / cancelled with the reason; or reopen it. */
export function GoalStatusDialog({ goal, onDone, onClose }) {
  const current = goal.status || 'active'
  const [status, setStatus] = useState(current === 'active' ? 'achieved' : current)
  const [reason, setReason] = useState(current === 'active' ? '' : (goal.status_reason || ''))
  const [saving, setSaving] = useState(false)
  const meta = GOAL_STATUS[status]
  const missing = meta.needsReason && !reason.trim()

  async function save(next = status, why = reason) {
    setSaving(true)
    try {
      const updated = await setGoalStatus(goal.id, next, why.trim())
      notify(next === 'active' ? 'Goal is active again.' : `Marked ${GOAL_STATUS[next].label.toLowerCase()}.`, { title: goal.title })
      onDone(updated)
    } catch (err) { notify(err.message) }
    finally { setSaving(false) }
  }

  return (
    <Modal title="Update status" onClose={onClose}>
      <form onSubmit={e => { e.preventDefault(); if (!missing) save() }} className="space-y-4">
        <p className="text-sm text-muted"><b className="text-ink">{goal.title}</b> is currently {GOAL_STATUS[current]?.label.toLowerCase() || current}.</p>
        <div className="goal-status-grid" role="radiogroup" aria-label="New status">
          {ORDER.map(key => (
            <button key={key} type="button" role="radio" aria-checked={status === key} data-status={key} onClick={() => setStatus(key)}>
              <b>{GOAL_STATUS[key].icon} {GOAL_STATUS[key].label}</b>{GOAL_STATUS[key].hint}
            </button>
          ))}
        </div>
        <div>
          <label className="text-sm font-medium text-ink" htmlFor="goal-status-reason">
            {meta.ask} {meta.needsReason && <span className="text-red-500">*</span>}
          </label>
          <textarea id="goal-status-reason" rows={3} className="field-input mt-1" value={reason} onChange={e => setReason(e.target.value)}
            placeholder={meta.needsReason ? 'Logged on the goal so you can see later why this changed' : 'A line for the record'} />
        </div>
        <p className="text-xs text-muted">
          {meta.closes
            ? 'The goal leaves your active lists and Today. Its tasks and history are kept, and you can reopen it anytime.'
            : 'The goal stays in your lists with a Blocked flag.'}
        </p>
        <div className="flex items-center gap-2 pt-1">
          {current !== 'active' && (
            <button type="button" className="secondary-button" disabled={saving} onClick={() => save('active', '')}>
              {GOAL_STATUS[current]?.closes ? 'Reopen goal' : 'Mark unblocked'}
            </button>
          )}
          <span className="flex-1" />
          <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary-button" disabled={saving || missing}>{saving ? 'Saving…' : `Mark ${meta.label.toLowerCase()}`}</button>
        </div>
      </form>
    </Modal>
  )
}

/** Banner + change log for the goal page. */
export function GoalStatusPanel({ goal, onChange }) {
  const [open, setOpen] = useState(false)
  const status = goal.status || 'active'
  const history = goal.status_history || []
  if (status === 'active' && history.length === 0) return null
  return (
    <div className="goal-status-panel" data-status={status}>
      {status !== 'active' && (
        <div className="flex items-start gap-3">
          <GoalStatusBadge status={status} />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-ink whitespace-pre-wrap">{goal.status_reason || (status === 'achieved' ? 'Closed as a success.' : '')}</p>
            <p className="text-[11px] text-muted mt-0.5">Since {fmtStatusDate(goal.status_changed_at)}</p>
          </div>
          <button type="button" className="secondary-button" onClick={onChange}>Change</button>
        </div>
      )}
      {history.length > 0 && (
        <div>
          <button type="button" className="text-xs text-muted hover:text-ink" aria-expanded={open} onClick={() => setOpen(o => !o)}>
            {open ? '▾' : '▸'} Status history ({history.length})
          </button>
          {open && (
            <ul className="goal-status-log">
              {history.map(h => (
                <li key={h.id}>
                  <span className="when">{fmtStatusDate(h.created_at)}</span>
                  <span>{GOAL_STATUS[h.from_status]?.label || h.from_status} → <b>{GOAL_STATUS[h.to_status]?.label || h.to_status}</b>{h.reason ? `: ${h.reason}` : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
