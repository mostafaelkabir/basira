import { askConfirm } from '../../components/askConfirm'
import { useEffect, useMemo, useState } from 'react'
import Modal from '../../components/Modal'
import Icon from '../../components/Icon'
import { notify } from '../../components/Notice'
import { createRhythmBlock, createRhythmBlocks, deleteRhythmBlock, getCompanies, getGoals, getRhythm, getSettings, suggestRhythm, updateRhythmBlock, updateSettings } from '../../api'
import { WEEKDAYS } from '../habits/RoutineEditor'
import { fmtClock, fmtMinutes } from '../today/format'
import { toMinutes } from './geometry'

// The weekly template behind every day: a week preview, the list of blocks with
// inline editing, and a research-backed suggested rhythm for first-time setup.
const KINDS = [
  { key: 'client', label: 'Client' }, { key: 'project', label: 'Project' }, { key: 'routine', label: 'Routine (habits)' },
  { key: 'personal', label: 'Personal' }, { key: 'break', label: 'Break' }, { key: 'free', label: 'Open time' },
]
const DURATIONS = [15, 30, 45, 60, 75, 90, 105, 120, 150, 180, 240]
const EMPTY = { title: '', kind: 'client', target_ref: '', days: ['mon', 'tue', 'wed', 'thu', 'fri'], start_time: '09:00', duration_minutes: 120 }

function daysLabel(days) {
  const set = new Set(days)
  if (set.size === 7) return 'Every day'
  if (set.size === 5 && ['mon', 'tue', 'wed', 'thu', 'fri'].every(d => set.has(d))) return 'Weekdays'
  return WEEKDAYS.filter(d => set.has(d.key)).map(d => d.label).join(' · ')
}

function BlockForm({ value, onChange, goals, companies, onSubmit, onCancel, submitLabel = 'Save', busy }) {
  const v = value
  const needsTarget = v.kind === 'client' || v.kind === 'project'
  const set = new Set(v.days)
  const toggleDay = k => { const n = new Set(set); n.has(k) ? n.delete(k) : n.add(k); onChange({ ...v, days: WEEKDAYS.map(d => d.key).filter(d => n.has(d)) }) }
  return (
    <form onSubmit={e => { e.preventDefault(); onSubmit() }} className="rhythm-form" data-testid="rhythm-form">
      <div className="grid sm:grid-cols-2 gap-2">
        <label className="text-xs text-muted">Kind
          <select value={v.kind} onChange={e => onChange({ ...v, kind: e.target.value, target_ref: '' })} className="field-input mt-1">
            {KINDS.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}
          </select>
        </label>
        {needsTarget ? (
          <label className="text-xs text-muted">{v.kind === 'client' ? 'Client' : 'Project'}
            <select value={v.target_ref} onChange={e => onChange({ ...v, target_ref: e.target.value })} className="field-input mt-1" required>
              <option value="">Choose…</option>
              {(v.kind === 'client' ? companies.map(c => ({ v: `company:${c.id}`, l: c.name })) : goals.map(g => ({ v: `goal:${g.id}`, l: g.title })))
                .map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
          </label>
        ) : (
          <label className="text-xs text-muted">Title
            <input value={v.title} onChange={e => onChange({ ...v, title: e.target.value })} className="field-input mt-1" placeholder={v.kind === 'routine' ? 'Morning routine' : v.kind === 'break' ? 'Break' : 'Lunch, gym, family…'} />
          </label>
        )}
        <label className="text-xs text-muted">Starts
          <input type="time" value={v.start_time} onChange={e => onChange({ ...v, start_time: e.target.value })} className="field-input mt-1" required />
        </label>
        <label className="text-xs text-muted">Length
          <select value={v.duration_minutes} onChange={e => onChange({ ...v, duration_minutes: Number(e.target.value) })} className="field-input mt-1">
            {DURATIONS.map(d => <option key={d} value={d}>{fmtMinutes(d)}</option>)}
          </select>
        </label>
      </div>
      {needsTarget && (
        <label className="text-xs text-muted block">Label <span className="text-faint">(optional)</span>
          <input value={v.title} onChange={e => onChange({ ...v, title: e.target.value })} className="field-input mt-1" placeholder="Defaults to the client or project name" />
        </label>
      )}
      <div className="flex items-center gap-1 flex-wrap" role="group" aria-label="Days">
        {WEEKDAYS.map(d => (
          <button key={d.key} type="button" onClick={() => toggleDay(d.key)} aria-pressed={set.has(d.key)}
            className={`w-10 py-1.5 rounded-lg border text-xs font-medium ${set.has(d.key) ? 'bg-forest text-white border-forest' : 'border-border text-muted hover:border-accent'}`}>{d.label}</button>
        ))}
      </div>
      {(v.kind === 'client' || v.kind === 'project') && v.duration_minutes > 120 && (
        <p className="text-[11px] text-amber-700">Most people sustain 75–120 minutes of deep work. Consider two blocks with a break between.</p>
      )}
      <div className="flex justify-end gap-2">
        {onCancel && <button type="button" onClick={onCancel} className="px-3 py-1.5 text-xs text-muted hover:text-ink">Cancel</button>}
        <button type="submit" disabled={busy || !v.days.length || (needsTarget && !v.target_ref)} className="bg-forest text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-forest-hover disabled:opacity-40">{submitLabel}</button>
      </div>
    </form>
  )
}

function WeekPreview({ blocks, dayStart, dayEnd }) {
  const lo = Math.min(toMinutes(dayStart) ?? 540, ...blocks.map(b => toMinutes(b.start_time) ?? 540))
  const hi = Math.max(toMinutes(dayEnd) ?? 1080, ...blocks.map(b => (toMinutes(b.start_time) ?? 0) + b.duration_minutes))
  const span = Math.max(60, hi - lo)
  return (
    <div className="week-preview" aria-label="Week preview">
      {WEEKDAYS.map(d => (
        <div key={d.key} className="week-col">
          <p className="text-[10px] font-mono uppercase text-muted mb-1">{d.label}</p>
          <div className="week-day">
            {blocks.filter(b => b.days.includes(d.key)).map(b => {
              const s = toMinutes(b.start_time) ?? lo
              const style = { top: `${((s - lo) / span) * 100}%`, height: `${(b.duration_minutes / span) * 100}%` }
              if (b.color) style['--block-color'] = b.color
              return <div key={b.id || b.title + b.start_time} className={`week-block cal-block-${b.kind}`} style={style} title={`${b.title} ${fmtClock(b.start_time)} · ${fmtMinutes(b.duration_minutes)}`}>{b.title}</div>
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

export default function RhythmModal({ onClose, onChanged }) {
  const [data, setData] = useState(null)
  const [goals, setGoals] = useState([])
  const [companies, setCompanies] = useState([])
  const [suggested, setSuggested] = useState(null)
  const [editing, setEditing] = useState(null)   // block id being edited
  const [draft, setDraft] = useState(EMPTY)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notify_, setNotify_] = useState(true)

  async function load() {
    try {
      const [r, g, c, s] = await Promise.all([getRhythm(), getGoals(), getCompanies(), getSettings()])
      setData(r); setGoals(g.filter(x => !x.archived_at)); setCompanies(c); setNotify_(s.rhythm_notifications !== 'false')
      if (r.blocks.length === 0 && !suggested) setSuggested((await suggestRhythm()).blocks)
    } catch (err) { notify(err.message) }
  }
  useEffect(() => { load() }, [])
  function changed() { onChanged?.(); window.dispatchEvent(new CustomEvent('basira:schedule-updated')) }

  const targetName = useMemo(() => {
    const m = {}
    goals.forEach(g => { m[`goal:${g.id}`] = g.title }); companies.forEach(c => { m[`company:${c.id}`] = c.name })
    return m
  }, [goals, companies])

  async function useSuggested() {
    setBusy(true)
    try {
      await createRhythmBlocks(suggested.map(({ reason, ...b }) => b))
      setSuggested(null); await load(); changed()
      notify('Your rhythm is set. Drag blocks on Today to adjust a single day; edit the template here.', { title: 'Rhythm created' })
    } catch (err) { notify(err.detail?.message || err.message) }
    finally { setBusy(false) }
  }
  async function submitNew() {
    setBusy(true)
    try { await createRhythmBlock(draft); setDraft(EMPTY); setAdding(false); await load(); changed() }
    catch (err) { notify(err.message) } finally { setBusy(false) }
  }
  async function submitEdit() {
    setBusy(true)
    try { await updateRhythmBlock(editing, draft); setEditing(null); await load(); changed() }
    catch (err) { notify(err.message) } finally { setBusy(false) }
  }
  async function remove(b) {
    if (!(await askConfirm(`Remove “${b.title}” from your rhythm? It leaves every day it runs on; days you adjusted by hand lose those changes.`, { title: 'Remove block', confirmLabel: 'Remove' }))) return
    try { await deleteRhythmBlock(b.id); await load(); changed() } catch (err) { notify(err.message) }
  }
  async function toggleNotify(v) {
    setNotify_(v)
    try { await updateSettings({ rhythm_notifications: v ? 'true' : 'false' }) } catch (err) { notify(err.message) }
  }

  const blocks = data?.blocks || []
  return (
    <Modal title="Day rhythm" onClose={onClose} wide>
      {!data ? <p className="text-sm text-muted" role="status">Loading…</p> : (
        <div className="space-y-5">
          <p className="text-xs text-muted">The repeating shape of your days. Each day starts from this; drag a block on Today to change only that day.</p>

          {blocks.length === 0 && suggested && (
            <section className="rhythm-suggest" aria-label="Suggested rhythm">
              <p className="font-semibold text-ink text-sm">A rhythm to start from</p>
              <p className="text-xs text-muted mt-1">Built from your habits, clients and projects: deep-work blocks of about two hours with short breaks, at most three a day, a real lunch, and a protected evening.</p>
              <WeekPreview blocks={suggested.map(b => ({ ...b, color: null }))} dayStart={data.day_start} dayEnd={data.day_end} />
              <ul className="mt-3 space-y-1.5">
                {suggested.map((b, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs">
                    <span className="font-mono tabular-nums text-ink w-28 flex-shrink-0">{fmtClock(b.start_time)} · {fmtMinutes(b.duration_minutes)}</span>
                    <span className="min-w-0"><span className="text-ink font-medium">{b.title || targetName[b.target_ref] || b.kind}</span> <span className="text-faint">· {daysLabel(b.days)}</span><br /><span className="text-muted">{b.reason}</span></span>
                    <button onClick={() => setSuggested(s => s.filter((_, j) => j !== i))} className="ml-auto text-faint hover:text-red-500 flex-shrink-0" aria-label={`Remove ${b.title || b.kind} from the suggestion`}>✕</button>
                  </li>
                ))}
              </ul>
              <div className="flex gap-2 mt-3">
                <button onClick={useSuggested} disabled={busy || !suggested.length} className="primary-button" data-testid="use-suggested">Use this rhythm</button>
                <button onClick={() => setSuggested(null)} className="secondary-button">Start from scratch</button>
              </div>
            </section>
          )}

          {blocks.length > 0 && <WeekPreview blocks={blocks} dayStart={data.day_start} dayEnd={data.day_end} />}

          <section aria-label="Blocks">
            <div className="flex items-center justify-between mb-2">
              <p className="eyebrow">Blocks</p>
              {!adding && <button onClick={() => { setAdding(true); setEditing(null); setDraft(EMPTY) }} className="text-[11px] text-accent hover:underline">+ Add block</button>}
            </div>
            {adding && <BlockForm value={draft} onChange={setDraft} goals={goals} companies={companies} onSubmit={submitNew} onCancel={() => setAdding(false)} submitLabel="Add block" busy={busy} />}
            {blocks.length === 0 && !adding && !suggested && <p className="text-xs text-muted">No blocks yet. Add one, or <button className="underline" onClick={async () => setSuggested((await suggestRhythm()).blocks)}>see a suggestion</button>.</p>}
            <ul className="divide-y divide-border">
              {blocks.map(b => (
                <li key={b.id} className="py-2">
                  {editing === b.id ? (
                    <BlockForm value={draft} onChange={setDraft} goals={goals} companies={companies} onSubmit={submitEdit} onCancel={() => setEditing(null)} busy={busy} />
                  ) : (
                    <div className="flex items-center gap-3">
                      <span className={`cal-swatch cal-block-${b.kind}`} style={b.color ? { '--block-color': b.color } : undefined} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-ink truncate">{b.title} <span className="text-faint text-xs">· {KINDS.find(k => k.key === b.kind)?.label}</span></p>
                        <p className="text-[11px] text-muted">{fmtClock(b.start_time)} – {fmtClock(b.end_time)} · {fmtMinutes(b.duration_minutes)} · {daysLabel(b.days)}</p>
                      </div>
                      <button onClick={() => { setEditing(b.id); setAdding(false); setDraft({ title: b.title, kind: b.kind, target_ref: b.target_ref || '', days: b.days, start_time: b.start_time, duration_minutes: b.duration_minutes }) }} className="agenda-btn" aria-label={`Edit ${b.title}`}>Edit</button>
                      <button onClick={() => remove(b)} className="agenda-btn hover:text-red-500" aria-label={`Remove ${b.title}`}><Icon name="trash" size={13} /></button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={notify_} onChange={e => toggleNotify(e.target.checked)} className="w-4 h-4 rounded accent-accent" />
            Notify me when a block starts and five minutes before it ends
          </label>
        </div>
      )}
    </Modal>
  )
}
