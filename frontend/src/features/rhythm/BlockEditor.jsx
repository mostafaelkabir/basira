import { askConfirm } from '../../components/askConfirm'
import { useEffect, useMemo, useState } from 'react'
import Modal from '../../components/Modal'
import Icon from '../../components/Icon'
import { notify } from '../../components/Notice'
import {
  createBlock, createRhythmBlock, deleteBlock, deleteRhythmBlock, getCompanies, getGoals, getRhythm,
  moveBlock, overrideRhythmDay, updateRhythmBlock,
} from '../../api'
import { WEEKDAYS } from '../habits/RoutineEditor'
import { fmtClock, fmtMinutes } from '../today/format'
import { toHHMM, toMinutes } from './geometry'

// One editor for a block on a day. Create: "today only" (an ad-hoc day block) or a
// repeating rhythm block, or pull one of your rhythm blocks onto this day. Edit a
// rhythm block for today only (override) or change the rhythm itself; an ad-hoc
// block's times can be changed and the block removed.
const KINDS = [
  { key: 'client', label: 'Client' }, { key: 'project', label: 'Project' }, { key: 'routine', label: 'Routine (habits)' },
  { key: 'personal', label: 'Personal' }, { key: 'break', label: 'Break' }, { key: 'free', label: 'Open time' },
]
const WEEKDAY_KEYS = WEEKDAYS.map(d => d.key)
const tokenFor = iso => WEEKDAY_KEYS[(new Date(iso + 'T00:00:00').getDay() + 6) % 7]
const labelFor = iso => new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long' })

export default function BlockEditor({ mode = 'create', date, block = null, defaults = {}, existingRhythmIds = [], onClose, onSaved, onSkipDay }) {
  const isRhythm = !!block?.rhythm_id
  const [goals, setGoals] = useState([])
  const [companies, setCompanies] = useState([])
  const [rhythm, setRhythm] = useState([])
  const [busy, setBusy] = useState(false)
  const [scope, setScope] = useState(mode === 'create' ? 'today' : 'today')   // 'today' | 'rhythm'
  const [form, setForm] = useState(() => ({
    title: block?.rhythm_id ? '' : (block?.title || ''),
    kind: block?.kind || 'personal',
    target_ref: block?.target_ref || '',
    start: toHHMM(block?.start_minutes ?? defaults.start_minutes ?? 540),
    end: toHHMM((block?.start_minutes ?? defaults.start_minutes ?? 540) + (block?.duration_minutes ?? defaults.duration_minutes ?? 60)),
    days: block?.days || [tokenFor(date)],
  }))
  useEffect(() => {
    getGoals().then(g => setGoals(g.filter(x => !x.archived_at))).catch(() => {})
    getCompanies().then(setCompanies).catch(() => {})
    getRhythm().then(r => {
      setRhythm(r.blocks)
      if (isRhythm) { const t = r.blocks.find(b => b.id === block.rhythm_id); if (t) setForm(f => ({ ...f, title: t.title, days: t.days })) }
    }).catch(() => {})
  }, [])

  const needsTarget = form.kind === 'client' || form.kind === 'project'
  const startMin = toMinutes(form.start), endMin = toMinutes(form.end)
  const duration = startMin != null && endMin != null ? endMin - startMin : null
  const valid = duration != null && duration >= 15 && (!needsTarget || form.target_ref) && (needsTarget || form.title.trim() || isRhythm)
  const notToday = useMemo(() => rhythm.filter(b => !existingRhythmIds.includes(b.id)), [rhythm, existingRhythmIds])
  const targetName = useMemo(() => {
    const m = {}; goals.forEach(g => { m[`goal:${g.id}`] = g.title }); companies.forEach(c => { m[`company:${c.id}`] = c.name }); return m
  }, [goals, companies])

  async function run(fn, done) {
    setBusy(true)
    try { await fn(); onSaved?.(); notify(done, { title: 'Saved' }); onClose() }
    catch (err) { notify(err.detail?.message || err.message) }
    finally { setBusy(false) }
  }
  function save() {
    if (!valid) return
    const title = form.title.trim()
    const common = { start_time: form.start, duration_minutes: duration }
    if (mode === 'create') {
      if (scope === 'rhythm') {
        return run(() => createRhythmBlock({ title, kind: form.kind, target_ref: needsTarget ? form.target_ref : null, days: form.days, ...common }),
          `“${title || targetName[form.target_ref] || form.kind}” added to your rhythm`)
      }
      return run(() => createBlock({ date, kind: form.kind, source_ref: needsTarget ? form.target_ref : null, title: title || targetName[form.target_ref] || '', ...common }),
        `“${title || targetName[form.target_ref] || form.kind}” added to ${labelFor(date)} only`)
    }
    if (isRhythm && scope === 'rhythm') {
      return run(() => updateRhythmBlock(block.rhythm_id, { title, days: form.days, ...common }), 'Your rhythm is updated')
    }
    if (isRhythm) return run(() => overrideRhythmDay({ rhythm_id: block.rhythm_id, date, ...common }), `“${block.title}” changed for ${labelFor(date)} only`)
    return run(() => moveBlock(block.id, { ...common, revision: block.revision }), `“${block.title}” changed`)
  }
  async function remove() {
    if (isRhythm) {
      if (!(await askConfirm(`Remove “${block.title}” from your rhythm on every day? Use “Skip today” on the calendar for a single day.`, { title: 'Remove from rhythm', confirmLabel: 'Remove' }))) return
      return run(() => deleteRhythmBlock(block.rhythm_id), `“${block.title}” removed from your rhythm`)
    }
    if (!(await askConfirm(`Remove “${block.title}” from ${labelFor(date)}?`, { title: 'Remove block', confirmLabel: 'Remove' }))) return
    return run(() => deleteBlock(block.id), `“${block.title}” removed`)
  }
  function addFromRhythm(b) { run(() => overrideRhythmDay({ rhythm_id: b.id, date }), `“${b.title}” added to ${labelFor(date)}`) }
  const toggleDay = k => setForm(f => ({ ...f, days: WEEKDAY_KEYS.filter(d => (f.days.includes(d)) !== (d === k)) }))

  const title = mode === 'create' ? 'New block' : `Edit “${block.title}”`
  return (
    <Modal title={title} onClose={() => { if (!busy) onClose() }}>
      <div className="space-y-4" data-testid="block-editor">
        {mode === 'create' && notToday.length > 0 && (
          <section aria-label="From your rhythm">
            <p className="text-[11px] font-mono uppercase tracking-wide text-muted mb-1.5">From your rhythm · not on {labelFor(date)}</p>
            <div className="flex flex-wrap gap-1.5">
              {notToday.map(b => (
                <button key={b.id} type="button" disabled={busy} onClick={() => addFromRhythm(b)}
                  className="cal-chip is-draggable" style={{ '--chip-color': b.color || undefined }} title={`Add “${b.title}” to ${labelFor(date)} at its usual time`}>
                  <span className={`cal-swatch cal-block-${b.kind}`} style={b.color ? { '--block-color': b.color } : undefined} />
                  + {b.title} <span className="text-faint font-mono text-[10px]">{fmtClock(b.start_time)} · {fmtMinutes(b.duration_minutes)}</span>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-faint mt-2">Or make a new block below.</p>
          </section>
        )}

        <form onSubmit={e => { e.preventDefault(); save() }} className="space-y-3">
          {(mode === 'create' || !isRhythm || scope === 'rhythm') && (
            <div className="grid sm:grid-cols-2 gap-2">
              {mode === 'create' && (
                <label className="text-xs text-muted">Kind
                  <select value={form.kind} onChange={e => setForm(f => ({ ...f, kind: e.target.value, target_ref: '' }))} className="field-input mt-1">
                    {KINDS.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}
                  </select>
                </label>
              )}
              {mode === 'create' && needsTarget ? (
                <label className="text-xs text-muted">{form.kind === 'client' ? 'Client' : 'Project'}
                  <select value={form.target_ref} onChange={e => setForm(f => ({ ...f, target_ref: e.target.value }))} className="field-input mt-1" required>
                    <option value="">Choose…</option>
                    {(form.kind === 'client' ? companies.map(c => ({ v: `company:${c.id}`, l: c.name })) : goals.map(g => ({ v: `goal:${g.id}`, l: g.title })))
                      .map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                  </select>
                </label>
              ) : (mode === 'create' || scope === 'rhythm') && (
                <label className="text-xs text-muted">{needsTarget ? 'Label (optional)' : 'Title'}
                  <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className="field-input mt-1"
                    placeholder={form.kind === 'routine' ? 'Morning routine' : form.kind === 'break' ? 'Break' : 'Deep clean, gym, family…'} autoFocus={mode === 'create' && notToday.length === 0} />
                </label>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-muted">Starts
              <input type="time" value={form.start} step="900" onChange={e => setForm(f => ({ ...f, start: e.target.value }))} className="field-input mt-1" required aria-label="Starts" />
            </label>
            <label className="text-xs text-muted">Ends
              <input type="time" value={form.end} step="900" onChange={e => setForm(f => ({ ...f, end: e.target.value }))} className="field-input mt-1" required aria-label="Ends" />
            </label>
          </div>
          <p className="text-[11px] text-muted -mt-1">{duration != null && duration >= 15 ? fmtMinutes(duration) : 'Ends must be at least 15 minutes after it starts'}</p>

          {(mode === 'create' || isRhythm) && (
            <div className="rhythm-scope" role="radiogroup" aria-label="Apply to">
              <label className={`rhythm-scope-opt ${scope === 'today' ? 'is-on' : ''}`}>
                <input type="radio" name="scope" checked={scope === 'today'} onChange={() => setScope('today')} />
                <span><strong>{labelFor(date)} only</strong><br /><span className="text-muted">{mode === 'create' ? 'A one-off block for this day.' : 'The rhythm stays as it is.'}</span></span>
              </label>
              <label className={`rhythm-scope-opt ${scope === 'rhythm' ? 'is-on' : ''}`}>
                <input type="radio" name="scope" checked={scope === 'rhythm'} onChange={() => setScope('rhythm')} />
                <span><strong>{mode === 'create' ? 'Repeat in my rhythm' : 'Change my rhythm'}</strong><br /><span className="text-muted">{mode === 'create' ? 'Every week on the days below.' : 'Every day this block runs on.'}</span></span>
              </label>
            </div>
          )}
          {scope === 'rhythm' && (
            <div className="flex items-center gap-1 flex-wrap" role="group" aria-label="Days">
              {WEEKDAYS.map(d => (
                <button key={d.key} type="button" onClick={() => toggleDay(d.key)} aria-pressed={form.days.includes(d.key)}
                  className={`w-10 py-1.5 rounded-lg border text-xs font-medium ${form.days.includes(d.key) ? 'bg-forest text-white border-forest' : 'border-border text-muted hover:border-accent'}`}>{d.label}</button>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between gap-2 pt-1">
            <div>
              {mode === 'edit' && isRhythm && !block.added && onSkipDay && <button type="button" onClick={() => onSkipDay(block)} disabled={busy} className="agenda-btn"><Icon name="close" size={13} />Skip {labelFor(date)} only</button>}
              {mode === 'edit' && <button type="button" onClick={remove} disabled={busy} className="agenda-btn hover:text-red-500"><Icon name="trash" size={13} />{isRhythm ? 'Remove from rhythm' : 'Remove'}</button>}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} disabled={busy} className="px-3 py-2 text-sm text-muted hover:text-ink">Cancel</button>
              <button type="submit" disabled={busy || !valid || (scope === 'rhythm' && form.days.length === 0)} className="bg-forest text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-forest-hover disabled:opacity-40">
                {mode === 'create' ? (scope === 'rhythm' ? 'Add to rhythm' : 'Add block') : 'Save'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </Modal>
  )
}
