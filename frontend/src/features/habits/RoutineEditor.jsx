import { useState } from 'react'
import Icon from '../../components/Icon'
import { fmtClock } from '../today/format'

// Pick the weekdays and the time a habit goes on the day planner by itself.
// Controlled: `days` is an array of "mon".."sun", `time` is "HH:MM" or "".
// Habits with no days stay check marks in the Routine strip until added by hand.
export const WEEKDAYS = [
  { key: 'mon', label: 'Mon' }, { key: 'tue', label: 'Tue' }, { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' }, { key: 'fri', label: 'Fri' }, { key: 'sat', label: 'Sat' }, { key: 'sun', label: 'Sun' },
]
const EVERY_DAY = WEEKDAYS.map(d => d.key)
const WEEKDAYS_ONLY = EVERY_DAY.slice(0, 5)

// "Every day" / "Weekdays" / "Mon · Wed · Fri"
export function routineLabel(days, time) {
  if (!days?.length) return ''
  const set = new Set(days)
  let when = set.size === 7 ? 'Every day'
    : set.size === 5 && WEEKDAYS_ONLY.every(d => set.has(d)) ? 'Weekdays'
    : WEEKDAYS.filter(d => set.has(d.key)).map(d => d.label).join(' · ')
  return time ? `${when} at ${fmtClock(time)}` : when
}

export default function RoutineEditor({ days = [], time = '', onChange, compact = false, disabled = false }) {
  const set = new Set(days)
  function toggle(key) {
    const next = new Set(set); next.has(key) ? next.delete(key) : next.add(key)
    onChange({ days: EVERY_DAY.filter(d => next.has(d)), time })
  }
  const sameSet = (keys) => keys.length === set.size && keys.every(k => set.has(k))
  return (
    <div className={compact ? 'space-y-2' : 'space-y-2.5'} data-testid="routine-editor">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <label className={`font-medium text-ink ${compact ? 'text-xs' : 'text-sm'}`}>On my planner</label>
        <div className="flex items-center gap-1 text-[11px]">
          <button type="button" disabled={disabled} onClick={() => onChange({ days: sameSet(EVERY_DAY) ? [] : EVERY_DAY, time })}
            className={`px-2 py-0.5 rounded-md ${sameSet(EVERY_DAY) ? 'bg-accent-soft text-accent' : 'text-muted hover:text-ink'}`}>Every day</button>
          <button type="button" disabled={disabled} onClick={() => onChange({ days: sameSet(WEEKDAYS_ONLY) ? [] : WEEKDAYS_ONLY, time })}
            className={`px-2 py-0.5 rounded-md ${sameSet(WEEKDAYS_ONLY) ? 'bg-accent-soft text-accent' : 'text-muted hover:text-ink'}`}>Weekdays</button>
          {set.size > 0 && (
            <button type="button" disabled={disabled} onClick={() => onChange({ days: [], time })}
              className="px-2 py-0.5 rounded-md text-muted hover:text-ink">Clear</button>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 flex-wrap" role="group" aria-label="Repeat on">
        {WEEKDAYS.map(d => (
          <button key={d.key} type="button" disabled={disabled} onClick={() => toggle(d.key)} aria-pressed={set.has(d.key)}
            className={`w-10 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
              set.has(d.key) ? 'bg-forest text-white border-forest' : 'border-border text-muted hover:border-accent'}`}>
            {d.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <label className="text-xs text-muted flex items-center gap-1.5">
          <Icon name="clock" size={13} />
          <span>at</span>
          <input type="time" value={time || ''} disabled={disabled} aria-label="Time of day"
            onChange={e => onChange({ days: EVERY_DAY.filter(d => set.has(d)), time: e.target.value })}
            className="text-xs bg-surface border border-border rounded-lg px-2 py-1 text-ink focus:outline-none focus:ring-1 focus:ring-accent" />
        </label>
        {time && (
          <button type="button" disabled={disabled} onClick={() => onChange({ days: EVERY_DAY.filter(d => set.has(d)), time: '' })}
            className="text-[11px] text-muted hover:text-ink">any time</button>
        )}
        <p className="text-[11px] text-faint w-full">
          {set.size ? <>Shows up on {routineLabel(EVERY_DAY.filter(d => set.has(d)), time)}. Take it off a single day from the planner without changing this.</>
                    : 'Not on the planner by itself — it stays a check mark in your routine, or add it to a day from the planner.'}
        </p>
      </div>
    </div>
  )
}

// Self-saving wrapper for places that edit one habit in place (Today's notes dialog).
export function RoutineEditorLive({ task, onSave }) {
  const [draft, setDraft] = useState({ days: task.routine_days || [], time: task.scheduled_time || '' })
  const [saving, setSaving] = useState(false)
  async function change(next) {
    setDraft(next); setSaving(true)
    try { await onSave({ routine_days: next.days, scheduled_time: next.time || '' }) }
    finally { setSaving(false) }
  }
  return <RoutineEditor days={draft.days} time={draft.time} onChange={change} compact disabled={saving} />
}
