import { useEffect, useState } from 'react'
import { useValue } from 'tldraw'
import { completeTask, updateGoal, updateMilestone, updateTask, updateWorkTicket } from '../../api'
import { notify } from '../../components/Notice'
import { addDays, countdown, dueMeta, shortDate, startOfWeek, todayIso } from '../work/due'
import { PLURAL } from './entityStore'
import { CARD_TYPE, STATUS_ORDER } from './SysgoCardShape'

const STATUS_LABEL = { backlog: 'Backlog', todo: 'To do', in_progress: 'In progress', review: 'Review', blocked: 'Blocked', done: 'Done' }
const PRIORITIES = ['low', 'medium', 'high', 'urgent']
const TYPES = ['code', 'research', 'planning', 'review', 'meeting']
const ENTITY_LABEL = { ticket: 'Ticket', task: 'Task', goal: 'Goal', milestone: 'Milestone' }

function Field({ label, children }) {
  return <label className="insp-field"><span className="insp-label">{label}</span>{children}</label>
}

// One-tap dates under a date field. `onPick('')` clears.
function QuickDates({ onPick, allowClear = true }) {
  const today = todayIso()
  const fri = addDays(startOfWeek(today), 4)
  const options = [['Today', today], ['Tomorrow', addDays(today, 1)], [fri > today ? 'Fri' : 'Next Fri', fri > today ? fri : addDays(fri, 7)], ['+1 week', addDays(today, 7)]]
  return (
    <div className="quick-dates">
      {options.map(([label, iso]) => <button key={label} type="button" onClick={() => onPick(iso)} title={iso}>{label}</button>)}
      {allowClear && <button type="button" onClick={() => onPick('')}>Clear</button>}
    </div>
  )
}

// Text that saves when you leave the field or press Enter; Escape puts the old value back.
function TextField({ value, onCommit, placeholder, multiline = false }) {
  const [v, setV] = useState(value ?? '')
  useEffect(() => { setV(value ?? '') }, [value])
  const commit = () => { if ((v ?? '').trim() !== (value ?? '')) onCommit(v.trim()) }
  const props = {
    className: 'insp-input', value: v, placeholder,
    onChange: e => setV(e.target.value), onBlur: commit,
    onKeyDown: e => {
      if (e.key === 'Enter' && !multiline) e.currentTarget.blur()
      if (e.key === 'Escape') { setV(value ?? ''); e.currentTarget.blur() }
    },
  }
  return multiline ? <textarea rows={3} {...props} /> : <input {...props} />
}

/**
 * Properties of the one selected card, editable in place (Figma-style). Changes go straight to
 * the ticket / task / goal / milestone and every card showing it refreshes.
 */
export default function CardInspector({ editor, store, milestones = [], onOpen, onEdit }) {
  const shape = useValue('inspected-card', () => {
    if (!editor) return null
    const sel = editor.getSelectedShapes()
    return sel.length === 1 && sel[0].type === CARD_TYPE ? sel[0] : null
  }, [editor])
  if (!shape) return null
  const { entity, entityId } = shape.props
  const data = store.data[PLURAL[entity]]?.[entityId]

  const done = (event) => { store.refresh(); window.dispatchEvent(new CustomEvent(event)) }
  const saver = (fn, event) => async (patch) => { try { await fn(patch); done(event) } catch (e) { notify(e.message) } }
  const remove = () => { editor.markHistoryStoppingPoint('remove card'); editor.deleteShapes([shape.id]) }

  let body = null
  if (!data) body = <p className="text-xs text-muted">Loading…</p>
  else if (data.missing) body = <p className="text-xs text-muted">This {entity} no longer exists.</p>
  else if (entity === 'ticket') {
    const put = saver(p => updateWorkTicket(entityId, p), 'basira:ticket-updated')
    const due = dueMeta(data.due_date, { done: data.status === 'done' })
    body = (
      <>
        <Field label="Title"><TextField value={data.title} onCommit={title => title && put({ title })} /></Field>
        <div className="insp-grid">
          <Field label="Status">
            <select className="insp-input" value={data.status} onChange={e => put({ status: e.target.value })}>
              {STATUS_ORDER.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </Field>
          <Field label="Priority">
            <select className="insp-input" value={data.priority} onChange={e => put({ priority: e.target.value })}>
              {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
          <Field label={due ? `Due · ${due.label.replace(/^Due /, '')}` : 'Due date'}>
            <input type="date" className="insp-input" value={data.due_date || ''} onChange={e => put({ due_date: e.target.value || '' })} />
            <QuickDates onPick={iso => put({ due_date: iso })} />
          </Field>
          <Field label="Type">
            <select className="insp-input" value={data.type} onChange={e => put({ type: e.target.value })}>
              {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Milestone">
          <select className="insp-input" value={data.milestone_id || ''} onChange={e => put({ milestone_id: e.target.value || '' })}>
            <option value="">None</option>
            {milestones.filter(m => m.company_id === data.company_id).map(m => (
              <option key={m.id} value={m.id}>◆ {m.title}{m.due_date ? ` · ${shortDate(m.due_date)}` : ''}</option>
            ))}
          </select>
        </Field>
        <div className="insp-grid">
          <Field label="Estimate (min)">
            <input type="number" min="0" className="insp-input" defaultValue={data.estimated_minutes || ''} key={`est-${data.estimated_minutes}`}
              onBlur={e => { const v = parseInt(e.target.value) || 0; if (v !== (data.estimated_minutes || 0)) put({ estimated_minutes: v }) }}
              onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} />
          </Field>
          <Field label="Ref"><TextField value={data.ticket_ref} placeholder="BV-12" onCommit={ticket_ref => put({ ticket_ref })} /></Field>
        </div>
        <div className="insp-actions">
          <button type="button" onClick={() => onOpen(entity, entityId)}>Open ticket</button>
          {onEdit && <button type="button" onClick={() => onEdit(entityId)}>Edit details…</button>}
          <button type="button" className="is-danger" onClick={remove}>Remove from board</button>
        </div>
      </>
    )
  } else if (entity === 'task') {
    const put = saver(p => updateTask(entityId, p), 'basira:task-updated')
    const isDone = data.status === 'done'
    body = (
      <>
        <Field label="Title"><TextField value={data.title} onCommit={title => title && put({ title })} /></Field>
        <div className="insp-grid">
          <Field label="Due date">
            <input type="date" className="insp-input" value={data.due_date || ''} onChange={e => put({ due_date: e.target.value || '' })} />
            <QuickDates onPick={iso => put({ due_date: iso })} />
          </Field>
          <Field label="Estimate (min)">
            <input type="number" min="0" className="insp-input" defaultValue={data.estimated_minutes || ''} key={`est-${data.estimated_minutes}`}
              onBlur={e => { const v = parseInt(e.target.value) || null; if (v !== (data.estimated_minutes || null)) put({ estimated_minutes: v }) }} />
          </Field>
        </div>
        <div className="flex gap-4">
          <label className="insp-check"><input type="checkbox" checked={!!data.is_urgent} onChange={e => put({ is_urgent: e.target.checked })} /> Urgent</label>
          <label className="insp-check"><input type="checkbox" checked={!!data.is_important} onChange={e => put({ is_important: e.target.checked })} /> Important</label>
        </div>
        <p className="text-[11px] text-muted">{data.goal_title}{data.is_habit ? ' · habit' : ''}{isDone ? ' · done' : ''}</p>
        <div className="insp-actions">
          {!isDone && !data.is_habit && <button type="button" onClick={() => saver(() => completeTask(entityId), 'basira:task-updated')()}>Mark done</button>}
          <button type="button" onClick={() => onOpen(entity, entityId)}>Open goal</button>
          <button type="button" className="is-danger" onClick={remove}>Remove from board</button>
        </div>
      </>
    )
  } else if (entity === 'milestone') {
    const put = saver(p => updateMilestone(entityId, p), 'basira:milestone-updated')
    body = (
      <>
        <Field label="Title"><TextField value={data.title} onCommit={title => title && put({ title })} /></Field>
        <div className="insp-grid">
          <Field label={`Target · ${countdown(data.due_date, { done: data.status === 'done' }).toLowerCase()}`}>
            <input type="date" className="insp-input" value={data.due_date || ''} onChange={e => put({ due_date: e.target.value || '' })} />
            <QuickDates onPick={iso => put({ due_date: iso })} />
          </Field>
          <Field label="Status">
            <select className="insp-input" value={data.status} onChange={e => put({ status: e.target.value })}>
              <option value="open">Open</option><option value="done">Reached</option>
            </select>
          </Field>
        </div>
        <Field label="What has to be true"><TextField multiline value={data.description} placeholder="Definition of done…" onCommit={description => put({ description })} /></Field>
        <p className="text-[11px] text-muted">{data.ticket_count ? `${data.done_count}/${data.ticket_count} tickets done · ${data.progress_pct}%` : 'No tickets yet. Drop tickets into a milestone lane, or set the milestone on a ticket.'}</p>
        <div className="insp-actions"><button type="button" className="is-danger" onClick={remove}>Remove from board</button></div>
      </>
    )
  } else {
    const put = saver(p => updateGoal(entityId, p), 'basira:task-updated')
    body = (
      <>
        <Field label="Title"><TextField value={data.title} onCommit={title => title && put({ title })} /></Field>
        <p className="text-[11px] text-muted">{data.type || 'goal'} · {data.done_count}/{data.task_count} tasks</p>
        <div className="insp-actions">
          <button type="button" onClick={() => onOpen(entity, entityId)}>Open goal</button>
          <button type="button" className="is-danger" onClick={remove}>Remove from board</button>
        </div>
      </>
    )
  }

  return (
    <aside className="card-inspector" aria-label={`${ENTITY_LABEL[entity]} properties`}>
      <div className="insp-head">
        <span className="eyebrow">{ENTITY_LABEL[entity]}{data?.ticket_ref ? ` · ${data.ticket_ref}` : ''}</span>
        <span className="flex-1" />
        <button type="button" className="icon-button !w-7 !h-7" aria-label="Deselect" title="Deselect (Esc)" onClick={() => editor.selectNone()}>✕</button>
      </div>
      {body}
    </aside>
  )
}
