import { useEffect, useRef, useState } from 'react'
import Modal from '../../components/Modal'
import { notify } from '../../components/Notice'
import { postponeItem } from '../../api'
import { addDays, dayLong, dayShort } from './format'

// Postpone a planned task/ticket to a later day and say why ("It's raining
// today"). The reason is kept as a note on the item and shown when it comes back.
// `item` needs { source: 'task'|'ticket', item_id, title }.
export const POSTPONE_REASONS = [
  { value: 'weather',          label: 'Weather' },
  { value: 'low_energy',       label: 'Low energy' },
  { value: 'out_of_time',      label: 'Out of time' },
  { value: 'blocked',          label: 'Blocked / waiting' },
  { value: 'wrong_timing',     label: 'Wrong timing' },
  { value: 'changed_priority', label: 'Changed priority' },
]

function nextMonday(iso) {
  const d = new Date(iso + 'T00:00:00')
  return addDays(iso, ((8 - d.getDay()) % 7) || 7)
}

export default function PostponeDialog({ item, today, onClose, onDone }) {
  const quick = [...new Set([addDays(today, 1), addDays(today, 2), nextMonday(today)])]
  const [toDate, setToDate] = useState(quick[0])
  const [reason, setReason] = useState('')
  const [category, setCategory] = useState(null)
  const [saving, setSaving] = useState(false)
  const reasonRef = useRef(null)
  // The dialog takes focus as it opens (after React's autoFocus), so focus the reason after it.
  useEffect(() => { const t = setTimeout(() => reasonRef.current?.focus(), 0); return () => clearTimeout(t) }, [])
  const valid = toDate > today && (reason.trim() || category)

  async function submit(e) {
    e.preventDefault()
    if (!valid || saving) return
    setSaving(true)
    try {
      await postponeItem({ kind: item.source, id: item.item_id, from_date: today, to_date: toDate,
                           reason: reason.trim() || null, category })
      window.dispatchEvent(new CustomEvent('basira:schedule-updated'))
      notify(`“${item.title}” moved to ${dayShort(toDate, today) === 'Tomorrow' ? 'tomorrow' : dayLong(toDate)}.`, { title: 'Postponed' })
      onDone()
    } catch (err) { notify(err.message); setSaving(false) }
  }

  return (
    <Modal title="Postpone" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-ink -mt-1 truncate" title={item.title}>{item.title}</p>

        <fieldset>
          <legend className="text-[11px] font-mono uppercase tracking-wide text-muted mb-1.5">Move to</legend>
          <div className="flex flex-wrap gap-1.5">
            {quick.map(d => (
              <button key={d} type="button" onClick={() => setToDate(d)} aria-pressed={toDate === d}
                className={`px-3 py-1.5 rounded-xl text-xs border transition-colors ${toDate === d
                  ? 'bg-accent-soft border-accent text-accent' : 'border-border text-ink hover:border-accent/50'}`}>
                <span className="font-medium">{dayShort(d, today)}</span>
                <span className="text-muted ml-1">{dayLong(d).replace(/^\w+, /, '')}</span>
              </button>
            ))}
            <input type="date" min={addDays(today, 1)} value={quick.includes(toDate) ? '' : toDate}
              onChange={e => e.target.value && setToDate(e.target.value)} aria-label="Pick another day"
              className={`px-2.5 py-1.5 rounded-xl text-xs bg-raised border text-ink focus:outline-none focus:border-accent ${
                quick.includes(toDate) ? 'border-border' : 'border-accent'}`} />
          </div>
        </fieldset>

        <div>
          <label htmlFor="postpone-reason" className="text-[11px] font-mono uppercase tracking-wide text-muted">Why?</label>
          <textarea id="postpone-reason" ref={reasonRef} rows={2} value={reason} onChange={e => setReason(e.target.value)}
            maxLength={500} placeholder="e.g. It's raining today"
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e) }}
            className="mt-1.5 w-full bg-raised border border-border rounded-xl px-3 py-2 text-sm text-ink placeholder:text-faint focus:outline-none focus:border-accent resize-none" />
          <div className="flex flex-wrap gap-1.5 mt-2">
            {POSTPONE_REASONS.map(r => (
              <button key={r.value} type="button" onClick={() => setCategory(c => c === r.value ? null : r.value)}
                aria-pressed={category === r.value}
                className={`px-2.5 py-1 rounded-lg text-[11px] transition-colors ${category === r.value
                  ? 'bg-amber-100 text-amber-700 border border-amber-300' : 'bg-raised text-muted border border-transparent hover:text-ink'}`}>
                {r.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="secondary-button">Cancel</button>
          <button type="submit" disabled={!valid || saving} className="primary-button disabled:opacity-50">
            {saving ? 'Moving…' : `Postpone to ${dayShort(toDate, today)}`}
          </button>
        </div>
        {!valid && toDate > today && <p className="text-[11px] text-faint text-right -mt-2">Add a reason or pick one above.</p>}
      </form>
    </Modal>
  )
}
