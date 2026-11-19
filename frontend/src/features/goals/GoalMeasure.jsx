import { useEffect, useState } from 'react'
import { checkInGoal, clearGoalMeasure, deleteGoalCheckin, getGoalMeasure, getGoalMeasures, setGoalMeasure } from '../../api'
import Modal from '../../components/Modal'
import { askConfirm } from '../../components/askConfirm'
import { notify } from '../../components/Notice'
import { chartGeometry, fmtDay, fmtNum, paceChip, weekTone, withUnit } from './measureChart'

// The goal's measure: one number from a start to a target, read weekly, next to how well
// the goal's habits (its system) were kept. The read-out comes from /goals/{id}/measure.
//   GoalMeasurePanel  — goal page: number, pace, chart, system, diagnosis, check-ins
//   MeasureMini       — goal card: number, pace chip, 12 system dots
//   ResolutionCheckins — Weekly Review: one input per measured goal

const TONE = {
  good: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  warn: 'bg-amber-50 text-amber-700 border-amber-200',
  bad: 'bg-red-50 text-red-700 border-red-200',
}
const WEEK_BG = { none: 'bg-border', kept: 'bg-accent', part: 'bg-amber-400', missed: 'bg-red-400' }
const DIAGNOSIS_TONE = {
  reached: 'good', keep_going: 'good', change_system: 'warn', execution: 'bad',
  easy_or_luck: 'warn', moving_no_system: 'warn', no_system: 'bad', need_data: null, system_new: null,
}
const SOURCES = [
  { key: 'manual', label: 'I enter it weekly', hint: 'Weight, savings, pages memorised, a 1–10 score' },
  { key: 'checkins', label: 'Count habit check-ins', hint: 'Every check-in on this goal’s habits adds one', unit: 'check-ins' },
  { key: 'tasks', label: 'Count completed tasks', hint: 'Every task finished under this goal adds one', unit: 'tasks' },
  { key: 'hours', label: 'Count hours logged', hint: 'Timer and logged time on this goal’s tasks and tickets', unit: 'h' },
]

export function PaceChip({ m, small = false }) {
  const chip = paceChip(m)
  if (!chip) return null
  return <span className={`inline-flex items-center border rounded-full font-medium whitespace-nowrap ${small ? 'text-[10px] px-1.5 py-px' : 'text-xs px-2.5 py-0.5'} ${TONE[chip.tone]}`}>{chip.label}</span>
}

export function SystemDots({ weeks, size = 9 }) {
  return (
    <span className="inline-flex items-center gap-[3px]" role="img" aria-label="System kept per week, last 12 weeks">
      {weeks.map(w => (
        <span key={w.week_start} className={`rounded-[3px] ${WEEK_BG[weekTone(w.pct)]}`}
          style={{ width: size, height: size, opacity: w.partial ? 0.55 : 1 }}
          title={`Week of ${fmtDay(w.week_start)}: ${w.planned ? `${w.done}/${w.planned} check-ins (${w.pct}%)` : 'nothing planned'}${w.partial ? ' · this week so far' : ''}`} />
      ))}
    </span>
  )
}

function Chart({ m }) {
  const W = 640, H = 210, pad = { l: 46, r: 14, t: 14, b: 26 }
  const g = chartGeometry(m, W, H, pad)
  const line = pts => pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const endLabel = m.target_date || m.projection?.date
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img"
      aria-label={`${m.name}: ${withUnit(m.current, m.unit)} now, target ${withUnit(m.target, m.unit)}`}>
      {/* target level */}
      <line x1={pad.l} x2={W - pad.r} y1={g.targetY} y2={g.targetY} stroke="rgb(var(--accent))" strokeOpacity=".45" strokeWidth="1" />
      <text x={pad.l - 6} y={g.targetY + 3.5} textAnchor="end" fontSize="10" fill="rgb(var(--accent))" className="font-mono">{fmtNum(m.target)}</text>
      <text x={pad.l - 6} y={g.sy(m.start) + 3.5} textAnchor="end" fontSize="10" fill="rgb(var(--muted))" className="font-mono">{fmtNum(m.start)}</text>
      {/* today */}
      <line x1={g.todayX} x2={g.todayX} y1={pad.t} y2={H - pad.b} stroke="rgb(var(--border-strong))" strokeDasharray="2 3" />
      <text x={g.todayX} y={H - 8} textAnchor="middle" fontSize="10" fill="rgb(var(--muted))">Today</text>
      <text x={pad.l} y={H - 8} fontSize="10" fill="rgb(var(--faint))">{fmtDay(m.start_date, m.today)}</text>
      {endLabel && g.todayX < W - pad.r - 90 && (
        <text x={W - pad.r} y={H - 8} textAnchor="end" fontSize="10" fill="rgb(var(--faint))">
          {m.target_date ? fmtDay(m.target_date, m.today) : ''}
        </text>
      )}
      {/* the straight line to the target date */}
      {g.ideal && <polyline points={line(g.ideal)} fill="none" stroke="rgb(var(--faint))" strokeWidth="1.5" strokeDasharray="5 5" />}
      {/* where the recent rate leads */}
      {g.projection && <polyline points={line(g.projection)} fill="none" stroke="rgb(var(--chart-3))" strokeWidth="2" strokeDasharray="2 4" strokeLinecap="round" />}
      {/* what happened */}
      <polyline points={line(g.actual)} fill="none" stroke="rgb(var(--chart-1))" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {g.actual.map((p, i) => (
        <circle key={p.date + i} cx={p.x} cy={p.y} r={i === g.actual.length - 1 ? 4.5 : 3}
          fill={i === g.actual.length - 1 ? 'rgb(var(--chart-1))' : 'rgb(var(--surface))'} stroke="rgb(var(--chart-1))" strokeWidth="2">
          <title>{`${fmtDay(p.date, m.today)}: ${withUnit(p.value, m.unit)}${p.note ? ` — ${p.note}` : ''}`}</title>
        </circle>
      ))}
    </svg>
  )
}

function Legend({ m }) {
  const Item = ({ color, dash, children }) => (
    <span className="inline-flex items-center gap-1.5">
      <svg width="18" height="6" aria-hidden="true"><line x1="0" x2="18" y1="3" y2="3" stroke={color} strokeWidth="2" strokeDasharray={dash} /></svg>{children}
    </span>
  )
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
      <Item color="rgb(var(--chart-1))">Actual</Item>
      {m.target_date && <Item color="rgb(var(--faint))" dash="4 3">Steady pace</Item>}
      {m.projection?.date && <Item color="rgb(var(--chart-3))" dash="2 3">At your recent rate</Item>}
    </div>
  )
}

function Fact({ label, value, sub }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-mono uppercase tracking-widest text-muted">{label}</p>
      <p className="text-sm font-semibold text-ink mt-0.5 font-mono tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-muted">{sub}</p>}
    </div>
  )
}

function Diagnosis({ d, compact = false }) {
  if (!d) return null
  const tone = DIAGNOSIS_TONE[d.key]
  return (
    <div className={`border rounded-xl ${compact ? 'px-3 py-2' : 'px-4 py-3'} ${tone ? TONE[tone] : 'bg-raised border-border text-muted'}`} data-diagnosis={d.key}>
      <p className="text-sm font-semibold">{d.title}</p>
      <p className="text-xs mt-0.5 opacity-90">{d.text}</p>
    </div>
  )
}

/** Value (+ optional note and date) → POST a check-in. Used on the goal page and in the Weekly Review. */
export function CheckinForm({ m, onSaved, onCancel, withDate = false }) {
  const [value, setValue] = useState('')
  const [note, setNote] = useState('')
  const [day, setDay] = useState(m.today)
  const [saving, setSaving] = useState(false)
  const valid = value !== '' && !Number.isNaN(Number(value))

  async function save(e) {
    e.preventDefault()
    if (!valid) return
    setSaving(true)
    try {
      const updated = await checkInGoal(m.goal_id, { value: Number(value), note, date: withDate ? day : null })
      setValue(''); setNote('')
      onSaved(updated)
    } catch (err) { notify(err.message) }
    finally { setSaving(false) }
  }

  return (
    <form onSubmit={save} className="flex flex-wrap items-center gap-2" aria-label={`Check in: ${m.name}`}>
      <label className="relative flex-none w-32">
        <span className="sr-only">{m.name} now</span>
        <input type="number" step="any" inputMode="decimal" autoFocus={!!onCancel} className="field-input !py-2 font-mono" style={{ paddingRight: m.unit ? 44 : 12 }}
          placeholder={fmtNum(m.current)} value={value} onChange={e => setValue(e.target.value)} data-testid="checkin-value" />
        {m.unit && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted pointer-events-none max-w-[40px] truncate">{m.unit}</span>}
      </label>
      <input type="text" className="field-input !py-2 flex-1 min-w-[140px]" placeholder="What moved it? (optional)" aria-label="Note"
        value={note} onChange={e => setNote(e.target.value)} />
      {withDate && <input type="date" className="field-input !py-2 flex-none !w-auto" aria-label="Measured on" min={m.start_date} max={m.today}
        value={day} onChange={e => setDay(e.target.value)} />}
      <button type="submit" className="primary-button" disabled={saving || !valid}>{saving ? 'Saving…' : 'Save'}</button>
      {onCancel && <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>}
    </form>
  )
}

/** Set or edit the goal's target number. */
export function MeasureDialog({ goalId, goalTitle, measure, onDone, onClose }) {
  const today = new Date().toLocaleDateString('en-CA')
  const editing = !!measure?.defined
  const [form, setForm] = useState(() => editing
    ? { name: measure.name, unit: measure.unit, source: measure.source, start: String(measure.start), target: String(measure.target),
        start_date: measure.start_date, target_date: measure.target_date || '' }
    : { name: '', unit: '', source: 'manual', start: '', target: '', start_date: today, target_date: '' })
  const [saving, setSaving] = useState(false)
  const set = patch => setForm(f => ({ ...f, ...patch }))
  const source = SOURCES.find(s => s.key === form.source)
  const numbers = form.start !== '' && form.target !== '' && Number(form.start) !== Number(form.target)
  const valid = form.name.trim() && numbers && (!form.target_date || form.target_date > form.start_date)

  function pickSource(key) {
    const next = SOURCES.find(s => s.key === key)
    set({ source: key, ...(next.unit ? { unit: next.unit, start: form.start === '' ? '0' : form.start } : {}) })
  }

  async function save(e) {
    e.preventDefault()
    if (!valid) return
    setSaving(true)
    try {
      const updated = await setGoalMeasure(goalId, { ...form, name: form.name.trim(), start: Number(form.start), target: Number(form.target),
        target_date: form.target_date || null })
      notify(editing ? 'Target updated.' : 'Target set. Check in once a week.', { title: goalTitle })
      onDone(updated)
    } catch (err) { notify(err.message) }
    finally { setSaving(false) }
  }

  async function remove() {
    if (!(await askConfirm('The target and every weekly check-in for it are removed. The goal, its habits and tasks stay.',
      { title: 'Remove this measure?', confirmLabel: 'Remove' }))) return
    try { onDone(await clearGoalMeasure(goalId)) } catch (err) { notify(err.message) }
  }

  return (
    <Modal title={editing ? 'Edit target' : 'Set a target'} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <p className="text-sm text-muted">Pick the one number that says how close <b className="text-ink">{goalTitle}</b> is. You read it once a week.</p>
        <div className="grid grid-cols-[1fr_110px] gap-2">
          <label className="text-sm font-medium text-ink">What you measure
            <input className="field-input mt-1" value={form.name} onChange={e => set({ name: e.target.value })} placeholder="Weight, Savings, Juz memorised…" autoFocus data-testid="measure-name" />
          </label>
          <label className="text-sm font-medium text-ink">Unit
            <input className="field-input mt-1" value={form.unit} onChange={e => set({ unit: e.target.value })} placeholder="kg" />
          </label>
        </div>
        {!editing && (
          <button type="button" className="text-xs text-accent hover:underline -mt-2"
            onClick={() => set({ name: 'Confidence', unit: '/10', source: 'manual', start: form.start || '3', target: '9' })}>
            No natural number? Use a 1–10 confidence score
          </button>
        )}
        <div className="grid grid-cols-2 gap-2">
          <label className="text-sm font-medium text-ink">Starting at
            <input type="number" step="any" className="field-input mt-1 font-mono" value={form.start} onChange={e => set({ start: e.target.value })} placeholder="92" data-testid="measure-start" />
          </label>
          <label className="text-sm font-medium text-ink">Target
            <input type="number" step="any" className="field-input mt-1 font-mono" value={form.target} onChange={e => set({ target: e.target.value })} placeholder="82" data-testid="measure-target" />
          </label>
          <label className="text-sm font-medium text-ink">From
            <input type="date" className="field-input mt-1" value={form.start_date} max={today} onChange={e => set({ start_date: e.target.value })} />
          </label>
          <label className="text-sm font-medium text-ink">Reach it by <span className="text-muted font-normal">(optional)</span>
            <input type="date" className="field-input mt-1" value={form.target_date} min={form.start_date} onChange={e => set({ target_date: e.target.value })} data-testid="measure-target-date" />
          </label>
        </div>
        <label className="block text-sm font-medium text-ink">Where the number comes from
          <select className="field-input mt-1" value={form.source} onChange={e => pickSource(e.target.value)}>
            {SOURCES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <span className="block text-xs text-muted font-normal mt-1">{source.hint}{form.source !== 'manual' && ', counted from the start date.'}</span>
        </label>
        {!form.target_date && <p className="text-xs text-muted">Without a date you get progress and a projection, but no pace.</p>}
        <div className="flex items-center gap-2 pt-1">
          {editing && <button type="button" className="secondary-button" onClick={remove}>Remove measure</button>}
          <span className="flex-1" />
          <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary-button" disabled={saving || !valid}>{saving ? 'Saving…' : editing ? 'Save' : 'Set target'}</button>
        </div>
      </form>
    </Modal>
  )
}

function History({ m, onChange }) {
  const [open, setOpen] = useState(false)
  const rows = m.points.filter(p => p.id).reverse()
  if (!rows.length) return null
  async function remove(p) {
    if (!(await askConfirm(`Remove the check-in of ${withUnit(p.value, m.unit)} on ${fmtDay(p.date, m.today)}?`, { title: 'Remove check-in?', confirmLabel: 'Remove' }))) return
    try { onChange(await deleteGoalCheckin(m.goal_id, p.id)) } catch (err) { notify(err.message) }
  }
  return (
    <div>
      <button type="button" className="text-xs text-muted hover:text-ink" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        {open ? '▾' : '▸'} Check-ins ({rows.length})
      </button>
      {open && (
        <ul className="mt-1.5 divide-y divide-border">
          {rows.map(p => (
            <li key={p.id} className="flex items-center gap-3 py-1.5 text-sm group">
              <span className="w-24 flex-none text-xs text-muted font-mono">{fmtDay(p.date, m.today)}</span>
              <span className="w-24 flex-none font-mono tabular-nums text-ink">{withUnit(p.value, m.unit)}</span>
              <span className="flex-1 min-w-0 truncate text-muted" title={p.note}>{p.note}</span>
              <button type="button" className="text-muted hover:text-red-500 text-xs opacity-0 group-hover:opacity-100 focus:opacity-100" aria-label="Remove check-in" onClick={() => remove(p)}>✕</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Goal page: the whole read-out. */
export default function GoalMeasurePanel({ goalId, goalTitle, refreshKey }) {
  const [m, setM] = useState(null)
  const [editing, setEditing] = useState(false)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    let live = true
    const load = () => getGoalMeasure(goalId).then(x => { if (live) setM(x) }).catch(() => {})
    load()
    window.addEventListener('basira:task-updated', load)
    return () => { live = false; window.removeEventListener('basira:task-updated', load) }
  }, [goalId, refreshKey])

  if (!m) return null
  const dialog = editing && <MeasureDialog goalId={goalId} goalTitle={goalTitle} measure={m} onClose={() => setEditing(false)}
    onDone={x => { setM(x); setEditing(false) }} />

  if (!m.defined) {
    return (
      <section className="mb-7" aria-label="Goal measure">
        <div className="border border-dashed border-border-strong rounded-2xl px-4 py-3.5 flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[220px]">
            <p className="text-sm font-medium text-ink">How will you know you are getting closer?</p>
            <p className="text-xs text-muted mt-0.5">Set one target number, check in once a week, and see your pace next to how well you keep the system.</p>
          </div>
          <button type="button" className="secondary-button" onClick={() => setEditing(true)}>Set a target</button>
        </div>
        {dialog}
      </section>
    )
  }

  const manual = m.source === 'manual'
  const p = m.projection
  const rateUnit = `${m.unit ? `${m.unit} ` : ''}/ wk`
  const signed = v => `${v > 0 ? '+' : ''}${fmtNum(v)}`
  return (
    <section className="mb-7" aria-label="Goal measure" data-testid="goal-measure">
      <div className="flex items-center justify-between mb-2">
        <p className="eyebrow">Measure</p>
        <button type="button" className="text-xs text-muted hover:text-accent" onClick={() => setEditing(true)}>Edit target</button>
      </div>
      <div className="bg-surface border border-border rounded-2xl shadow-card p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
          <div className="flex-1 min-w-[200px]">
            <p className="text-[10px] font-mono uppercase tracking-widest text-muted">{m.name}</p>
            <p className="mt-1 flex items-baseline gap-2 flex-wrap">
              <span className="stat-value text-3xl font-semibold text-ink" data-testid="measure-current">{fmtNum(m.current)}</span>
              {m.unit && <span className="text-sm text-muted">{m.unit}</span>}
              <PaceChip m={m} />
            </p>
            <p className="text-xs text-muted mt-1">
              {fmtNum(m.start)} → {withUnit(m.target, m.unit)}
              {m.target_date && <> by {fmtDay(m.target_date, m.today)}</>}
              {m.pace && m.pace.status !== 'reached' && m.pace.status !== 'overdue' && <> · {m.pace.days_left} days left</>}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-none">
            {manual && !checking && (
              <button type="button" className={m.checked_in_this_week ? 'secondary-button' : 'primary-button'} onClick={() => setChecking(true)}>
                {m.checked_in_this_week ? 'Update this week' : 'Check in'}
              </button>
            )}
            {!manual && <span className="text-[11px] text-muted">Counted automatically</span>}
          </div>
        </div>

        {checking && <CheckinForm m={m} withDate onCancel={() => setChecking(false)} onSaved={x => { setM(x); setChecking(false) }} />}

        <div>
          <div className="flex justify-between text-[11px] text-muted mb-1">
            <span>{m.progress_pct}% of the way</span>
            {m.expected != null && m.pace?.status !== 'reached' && <span>steady pace would be at {withUnit(m.expected, m.unit)} today</span>}
          </div>
          <div className="h-1.5 bg-border rounded-full"><div className="h-1.5 rounded-full bg-accent" style={{ width: `${m.progress_pct}%` }} /></div>
        </div>

        <div>
          <Chart m={m} />
          <Legend m={m} />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 pt-1">
          <Fact label="Recent rate" value={p ? `${signed(p.weekly_rate)} ${rateUnit}` : '—'}
            sub={p ? `since ${fmtDay(p.since, m.today)}` : 'needs a check-in'} />
          <Fact label="Rate needed" value={m.required_weekly != null ? `${signed(m.required_weekly)} ${rateUnit}` : '—'}
            sub={m.required_weekly != null ? 'from now to the date' : m.target_date ? '' : 'no target date'} />
          <Fact label="Projected arrival" value={p?.date ? fmtDay(p.date, m.today) : m.progress_pct >= 100 ? 'Reached' : '—'}
            sub={p?.date ? 'at your recent rate' : p && !p.toward ? 'moving away from the target' : p ? 'not at this rate' : ''} />
        </div>

        <div className="border-t border-border pt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted">System · 12 weeks</p>
          {m.habits_count > 0 ? (
            <>
              <SystemDots weeks={m.weeks} size={12} />
              <span className="text-xs text-muted">
                {m.system_pct == null ? 'No weeks to judge yet' : <><b className="text-ink font-mono">{m.system_pct}%</b> of habit targets kept, last 4 weeks</>}
              </span>
            </>
          ) : <span className="text-xs text-muted">No habits on this goal yet. Add the weekly habits that should move this number.</span>}
        </div>

        <Diagnosis d={m.diagnosis} />
        {manual && <History m={m} onChange={setM} />}
      </div>
      {dialog}
    </section>
  )
}

/** Goal card: number, share of the way, pace chip and the 12 system dots. */
export function MeasureMini({ m }) {
  if (!m?.defined) return null
  return (
    <div className="mt-2.5" data-testid="measure-mini">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-semibold text-ink font-mono tabular-nums">{withUnit(m.current, m.unit)}</span>
        <span className="text-[11px] text-muted">of {fmtNum(m.target)} · {m.progress_pct}%</span>
        <PaceChip m={m} small />
        {m.source === 'manual' && !m.checked_in_this_week && <span className="text-[10px] text-amber-700">check-in due</span>}
      </div>
      <div className="mt-1.5 flex items-center gap-3">
        <div className="flex-1 h-1 bg-border rounded-full"><div className="h-1 rounded-full bg-accent" style={{ width: `${m.progress_pct}%` }} /></div>
        {m.habits_count > 0 && <SystemDots weeks={m.weeks} size={7} />}
      </div>
    </div>
  )
}

/** Weekly Review: every measured goal with this week's input and what the result means. */
export function ResolutionCheckins() {
  const [list, setList] = useState(null)
  const [justSaved, setJustSaved] = useState({})
  useEffect(() => { getGoalMeasures().then(setList).catch(() => setList([])) }, [])
  if (!list) return null

  const replace = x => {
    setList(l => l.map(m => (m.goal_id === x.goal_id ? x : m)))
    setJustSaved(s => ({ ...s, [x.goal_id]: true }))
    window.dispatchEvent(new CustomEvent('basira:measure-updated'))
  }

  return (
    <div data-testid="review-checkins">
      <div className="flex items-center gap-2 mb-2.5">
        <span className="text-accent text-xs">◎</span>
        <h3 className="text-[11px] font-semibold text-muted uppercase tracking-widest">How close are you?</h3>
        <span className="flex-1 border-t border-border" />
      </div>
      {list.length === 0 ? (
        <p className="text-sm text-muted">No goal has a target number yet. Open a resolution and choose “Set a target” to track how close you are each week.</p>
      ) : (
        <div className="space-y-2">
          {list.map(m => (
            <div key={m.goal_id} className="rounded-xl border border-border bg-surface px-3 py-3 space-y-2.5">
              <div className="flex items-start gap-2 flex-wrap">
                <div className="flex-1 min-w-[160px]">
                  <p className="text-sm font-medium text-ink">{m.title}</p>
                  <p className="text-[11px] text-muted">
                    {m.name}: <b className="text-ink font-mono">{withUnit(m.current, m.unit)}</b> → {withUnit(m.target, m.unit)} · {m.progress_pct}%
                    {m.system_pct != null && <> · system {m.system_pct}%</>}
                  </p>
                </div>
                <PaceChip m={m} />
              </div>
              {m.source === 'manual'
                ? (m.checked_in_this_week && !justSaved[m.goal_id]
                    ? <details><summary className="text-xs text-muted cursor-pointer">✓ Checked in this week. Change it</summary><div className="mt-2"><CheckinForm m={m} onSaved={replace} /></div></details>
                    : m.checked_in_this_week
                      ? <p className="text-xs text-accent">✓ Saved for this week</p>
                      : <CheckinForm m={m} onSaved={replace} />)
                : <p className="text-xs text-muted">Counted automatically.</p>}
              {(m.checked_in_this_week || m.source !== 'manual') && <Diagnosis d={m.diagnosis} compact />}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
