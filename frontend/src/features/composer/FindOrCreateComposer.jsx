import { useEffect, useRef, useState } from 'react'
import Icon from '../../components/Icon'
import { notify } from '../../components/Notice'
import {
  getWorkSuggestions, addToSchedule, createTask, createGoal,
  createWorkTicket, getGoals, getCompanies,
} from '../../api'

// One composer for Today and Work: find an existing ticket/task/habit/goal and
// reuse its ID (no duplicate), or explicitly create a new item of any type — all
// without leaving the page. Keyboard-navigable and mobile-friendly.
const NEW_TYPES = [
  { key: 'ticket', label: 'Ticket' },
  { key: 'task', label: 'Task' },
  { key: 'habit', label: 'Habit' },
  { key: 'goal', label: 'Goal' },
]

const SOURCE_BADGE = { ticket: 'Ticket', task: 'Task', worklog: 'Log' }

// Lightweight ticket templates — each sets a ticket type, a sensible priority and
// a starter tag. Every inferred default stays visible and editable before save.
const TICKET_TEMPLATES = [
  { key: 'bug', label: 'Bug', type: 'code', priority: 'high', tags: ['bug'] },
  { key: 'feature', label: 'Feature', type: 'code', priority: 'medium', tags: ['feature'] },
  { key: 'research', label: 'Research', type: 'research', priority: 'medium', tags: [] },
  { key: 'meeting', label: 'Meeting', type: 'meeting', priority: 'low', tags: [] },
]

export default function FindOrCreateComposer({ onDone, defaultCompanyId, defaultGoalId, placeholder }) {
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(-1)            // keyboard-highlighted suggestion
  const [createType, setCreateType] = useState(null)  // null | ticket|task|habit|goal
  const [goals, setGoals] = useState([])
  const [companies, setCompanies] = useState([])
  const [busy, setBusy] = useState(false)
  const inputRef = useRef(null)
  const reqIdRef = useRef(0)

  // create-draft fields (kept while typing so failures never lose work)
  const [companyId, setCompanyId] = useState(defaultCompanyId || '')
  const [goalId, setGoalId] = useState(defaultGoalId || '')
  const [priority, setPriority] = useState('medium')
  const [frequency, setFrequency] = useState('daily')
  const [goalType, setGoalType] = useState('project')
  // Ticket template: sets contextual, still-editable defaults (type/priority/tags).
  const [template, setTemplate] = useState('feature')
  const [ticketType, setTicketType] = useState('code')
  const [ticketTags, setTicketTags] = useState(['feature'])

  function applyTemplate(t) {
    setTemplate(t.key)
    setTicketType(t.type)
    setPriority(t.priority)
    setTicketTags(t.tags)
  }

  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => {
    getGoals().then(setGoals).catch(() => {})
    getCompanies().then(setCompanies).catch(() => {})
  }, [])

  // Debounced suggestions with stale-response cancellation.
  useEffect(() => {
    const q = query.trim()
    if (!q) { setSuggestions([]); setActive(-1); setLoading(false); return }
    setLoading(true)
    const myReq = ++reqIdRef.current
    const t = setTimeout(() => {
      getWorkSuggestions(q, { limit: 6 })
        .then(d => { if (myReq === reqIdRef.current) { setSuggestions(d.suggestions); setActive(-1) } })
        .catch(() => {})
        .finally(() => { if (myReq === reqIdRef.current) setLoading(false) })
    }, 180)
    return () => clearTimeout(t)
  }, [query])

  async function selectExisting(s) {
    setBusy(true)
    try {
      await addToSchedule(s.source, s.item_id)   // reuse its ID; sets plan_date=today
      notify(`Added “${s.title}” to today`)
      onDone?.({ reused: true, ...s })
    } catch (err) { notify(err.message) }          // draft preserved on failure
    finally { setBusy(false) }
  }

  async function createNew() {
    const title = query.trim()
    if (!title) { notify('Type a title first'); return }
    setBusy(true)
    try {
      let created, kind
      if (createType === 'ticket') {
        if (!companyId) throw new Error('Choose a client for the ticket')
        created = await createWorkTicket({
          company_id: companyId, title, priority, linked_goal_id: goalId || null,
          type: ticketType, tags: ticketTags,
        })
        kind = 'ticket'
      } else if (createType === 'task') {
        if (!goalId) throw new Error('Choose a project/goal for the task')
        created = await createTask({ title, goal_id: goalId, requires_proof: false })
        kind = 'task'
      } else if (createType === 'habit') {
        const g = goalId || goals.find(x => x.type === 'resolution')?.id
        if (!g) throw new Error('Create a resolution goal first, then add habits to it')
        created = await createTask({ title, goal_id: g, habit_frequency: frequency, requires_proof: false })
        kind = 'habit'
      } else if (createType === 'goal') {
        created = await createGoal({ title, type: goalType })
        kind = 'goal'
      }
      // Add work items to today; goals aren't scheduled. If this add fails, a retry
      // references created.id rather than creating a second entity.
      if (kind && kind !== 'goal') {
        try { await addToSchedule(kind, created.id) } catch { /* entity exists; schedule retryable */ }
      }
      notify(`Created ${createType} “${title}”`)
      onDone?.({ created: true, type: createType, id: created.id })
    } catch (err) { notify(err.message) }           // query (draft) preserved
    finally { setBusy(false) }
  }

  function onKeyDown(e) {
    if (createType) return   // create form manages its own keys
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, suggestions.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, -1)) }
    else if (e.key === 'Enter' && active >= 0 && suggestions[active]) { e.preventDefault(); selectExisting(suggestions[active]) }
    else if (e.key === 'Escape') { e.preventDefault(); onDone?.(null) }
  }

  const goalOpts = goals.filter(g => !g.archived_at)

  return (
    <div className="bg-surface border border-border rounded-2xl shadow-card p-4">
      {/* Search / draft input */}
      <div className="flex items-center gap-2 bg-canvas border border-border rounded-xl px-3 py-2">
        <Icon name="search" size={15} />
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder || 'Find existing work or type a new title…'}
          className="flex-1 bg-transparent text-sm text-ink placeholder:text-muted focus:outline-none"
          role="combobox" aria-expanded={suggestions.length > 0}
          aria-controls="foc-suggestions" aria-autocomplete="list"
        />
        {loading && <span className="text-[10px] text-muted">…</span>}
        <button onClick={() => onDone?.(null)} aria-label="Close" className="text-muted hover:text-ink p-1">✕</button>
      </div>

      {/* Existing matches (reuse an ID instead of duplicating) */}
      {!createType && suggestions.length > 0 && (
        <ul id="foc-suggestions" role="listbox" className="mt-2 space-y-0.5 max-h-60 overflow-y-auto">
          {suggestions.map((s, i) => (
            <li key={s.key} role="option" aria-selected={active === i}>
              <button
                onClick={() => selectExisting(s)}
                onMouseEnter={() => setActive(i)}
                disabled={busy}
                className={`w-full text-left px-2.5 py-2 rounded-lg flex items-center gap-2 transition-colors ${
                  active === i ? 'bg-accent-soft' : 'hover:bg-raised'}`}>
                <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-raised text-muted flex-shrink-0">
                  {SOURCE_BADGE[s.source] || s.source}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="text-sm text-ink truncate block">{s.title}</span>
                  <span className="text-[11px] text-muted truncate block">{s.reasons.join(' · ')}</span>
                </span>
                {s.blocked && <span className="text-[10px] text-amber-600 flex-shrink-0">blocked</span>}
                <span className="text-[10px] text-accent flex-shrink-0">Add →</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!createType && query.trim() && !loading && suggestions.length === 0 && (
        <p className="text-xs text-muted mt-2 px-1">No existing matches — create one below.</p>
      )}

      {/* New-item type tabs (switch type without leaving the page) */}
      <div className="flex items-center gap-1 mt-3 flex-wrap">
        <span className="text-[10px] font-mono uppercase text-muted mr-1">New:</span>
        {NEW_TYPES.map(t => (
          <button key={t.key}
            onClick={() => setCreateType(createType === t.key ? null : t.key)}
            aria-pressed={createType === t.key}
            className={`px-2.5 py-1 text-xs rounded-lg transition-colors ${
              createType === t.key ? 'bg-forest text-white' : 'bg-raised text-muted hover:text-ink'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Create draft (type-specific fields; defaults visible and editable) */}
      {createType && (
        <div className="mt-3 space-y-2 bg-canvas border border-border rounded-xl p-3">
          <p className="text-[11px] text-muted">
            New {createType}: <span className="text-ink font-medium">{query.trim() || '(type a title above)'}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {createType === 'ticket' && (
              <>
                <div className="w-full flex items-center gap-1 flex-wrap">
                  <span className="text-[10px] font-mono uppercase text-muted mr-1">Template:</span>
                  {TICKET_TEMPLATES.map(t => (
                    <button key={t.key} type="button" onClick={() => applyTemplate(t)}
                      aria-pressed={template === t.key}
                      className={`px-2 py-0.5 text-[11px] rounded-lg transition-colors ${
                        template === t.key ? 'bg-accent-soft text-accent' : 'bg-raised text-muted hover:text-ink'}`}>
                      {t.label}
                    </button>
                  ))}
                </div>
                <Select label="Client" value={companyId} onChange={setCompanyId}
                  options={[{ v: '', l: 'Select client…' }, ...companies.map(c => ({ v: c.id, l: c.name }))]} />
                <Select label="Project" value={goalId} onChange={setGoalId}
                  options={[{ v: '', l: 'No project' }, ...goalOpts.map(g => ({ v: g.id, l: g.title }))]} />
                <Select label="Type" value={ticketType} onChange={setTicketType}
                  options={['code', 'research', 'planning', 'review', 'meeting'].map(t => ({ v: t, l: t }))} />
                <Select label="Priority" value={priority} onChange={setPriority}
                  options={['low', 'medium', 'high', 'urgent'].map(p => ({ v: p, l: p }))} />
              </>
            )}
            {createType === 'task' && (
              <Select label="Project / goal" value={goalId} onChange={setGoalId}
                options={[{ v: '', l: 'Select goal…' }, ...goalOpts.map(g => ({ v: g.id, l: g.title }))]} />
            )}
            {createType === 'habit' && (
              <>
                <Select label="Resolution" value={goalId} onChange={setGoalId}
                  options={[{ v: '', l: 'First resolution' }, ...goalOpts.filter(g => g.type === 'resolution').map(g => ({ v: g.id, l: g.title }))]} />
                <Select label="Frequency" value={frequency} onChange={setFrequency}
                  options={['daily', '2x_day', '3x_week', '1x_week'].map(f => ({ v: f, l: f }))} />
              </>
            )}
            {createType === 'goal' && (
              <Select label="Type" value={goalType} onChange={setGoalType}
                options={['resolution', 'project', 'daily'].map(t => ({ v: t, l: t }))} />
            )}
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={createNew} disabled={busy || !query.trim()}
              className="px-3 py-1.5 rounded-lg bg-forest text-white text-xs font-semibold hover:bg-forest-hover disabled:opacity-50 flex items-center gap-1">
              <Icon name="plus" size={13} />Create {createType}
            </button>
            <button onClick={() => setCreateType(null)}
              className="px-3 py-1.5 rounded-lg text-xs text-muted hover:text-ink">Back to search</button>
          </div>
        </div>
      )}
    </div>
  )
}

function Select({ label, value, onChange, options }) {
  return (
    <label className="text-[11px] text-muted flex flex-col gap-0.5">
      {label}
      <select value={value} onChange={e => onChange(e.target.value)}
        className="text-xs bg-surface border border-border rounded-lg px-2 py-1 text-ink capitalize focus:outline-none focus:ring-1 focus:ring-accent">
        {options.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    </label>
  )
}
