import { useEffect, useState } from 'react'
import { createMilestone, createTask, createWorkTicket, getCompanies, getGoals } from '../../api'
import Modal from '../../components/Modal'
import { notify } from '../../components/Notice'

const TICKET_TYPES = ['code', 'research', 'planning', 'review', 'meeting']
const PRIORITIES = ['low', 'medium', 'high', 'urgent']

const TITLES = { ticket: 'Make a ticket from this note', task: 'Make a task from this note', milestone: 'Make a milestone from this note' }

/** Turn a sticky note's text into a real ticket or milestone (under a client) or task (under a goal). */
export default function PromoteDialog({ entity, text, board, onCreated, onClose }) {
  const isTicket = entity === 'ticket' || entity === 'milestone'
  const isMilestone = entity === 'milestone'
  const [dueDate, setDueDate] = useState('')
  const [title, setTitle] = useState(text)
  const [options, setOptions] = useState(null)
  const [target, setTarget] = useState('')
  const [type, setType] = useState('code')
  const [priority, setPriority] = useState('medium')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    (isTicket ? getCompanies() : getGoals()).then(list => {
      const live = isTicket ? list : list.filter(g => !g.archived_at)
      setOptions(live)
      const scoped = (isTicket && board.scope_type === 'company') || (!isTicket && board.scope_type === 'goal') ? board.scope_id : null
      setTarget(scoped && live.some(o => o.id === scoped) ? scoped : (live[0]?.id || ''))
    }).catch(e => { notify(e.message); setOptions([]) })
  }, [isTicket, board.scope_type, board.scope_id])

  async function submit(e) {
    e.preventDefault()
    if (!title.trim() || !target) return
    setSaving(true)
    try {
      const linked_goal_id = board.scope_type === 'goal' ? board.scope_id : null
      const created = isMilestone
        ? await createMilestone({ company_id: target, title: title.trim(), due_date: dueDate || null, linked_goal_id })
        : isTicket
          ? await createWorkTicket({ company_id: target, title: title.trim(), type, priority, linked_goal_id, due_date: dueDate || null })
          : await createTask({ title: title.trim(), goal_id: target, requires_proof: false, kind: 'task', due_date: dueDate || null })
      onCreated(created)
    } catch (err) { notify(err.message) }
    finally { setSaving(false) }
  }

  return (
    <Modal title={TITLES[entity] || TITLES.ticket} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="text-sm font-medium text-ink" htmlFor="promote-title">Title</label>
          <input id="promote-title" autoFocus className="field-input mt-1" value={title} onChange={e => setTitle(e.target.value)} />
        </div>
        <div>
          <label className="text-sm font-medium text-ink" htmlFor="promote-target">{isTicket ? 'Client' : 'Goal'}</label>
          {options === null ? <p className="text-xs text-muted mt-1" role="status">Loading…</p>
            : options.length === 0 ? <p className="text-xs text-muted mt-1">{isTicket ? 'Add a client on the Work page first.' : 'Create a goal first.'}</p>
            : (
              <select id="promote-target" className="field-input mt-1" value={target} onChange={e => setTarget(e.target.value)}>
                {options.map(o => <option key={o.id} value={o.id}>{o.name || o.title}</option>)}
              </select>
            )}
        </div>
        <div>
          <label className="text-sm font-medium text-ink" htmlFor="promote-due">{isMilestone ? 'Target date' : 'Due date'} <span className="text-muted font-normal">(optional)</span></label>
          <input id="promote-due" type="date" className="field-input mt-1" value={dueDate} onChange={e => setDueDate(e.target.value)} />
        </div>
        {isTicket && !isMilestone && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-ink" htmlFor="promote-type">Type</label>
              <select id="promote-type" className="field-input mt-1" value={type} onChange={e => setType(e.target.value)}>
                {TICKET_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-ink" htmlFor="promote-priority">Priority</label>
              <select id="promote-priority" className="field-input mt-1" value={priority} onChange={e => setPriority(e.target.value)}>
                {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
        )}
        <p className="text-xs text-muted">The note is replaced by a live card linked to the new {entity}.</p>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary-button" disabled={saving || !title.trim() || !target}>{saving ? 'Creating…' : `Create ${entity}`}</button>
        </div>
      </form>
    </Modal>
  )
}
