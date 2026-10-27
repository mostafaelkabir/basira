import { useEffect, useState } from 'react'
import { createBoard, deleteBoard, getBoards, getCompanies, getGoals } from '../../api'
import Modal from '../../components/Modal'
import { notify } from '../../components/Notice'
import { TEMPLATE_OPTIONS, templateKey } from './templates'

const SCOPE_LABEL = { global: 'Global', work: 'Work', goal: 'Goal', company: 'Client' }

function relative(iso) {
  const t = new Date(iso.replace(' ', 'T') + (iso.endsWith('Z') || iso.includes('+') ? '' : 'Z')).getTime()
  if (Number.isNaN(t)) return ''
  const mins = Math.round((Date.now() - t) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  return days === 1 ? 'yesterday' : `${days}d ago`
}

/** All boards, newest edit first, plus the dialog to start a new one at any scope. */
export default function BoardsPage({ onOpen }) {
  const [boards, setBoards] = useState(null)
  const [showNew, setShowNew] = useState(false)

  async function load() {
    try { setBoards(await getBoards()) } catch (e) { notify(e.message); setBoards([]) }
  }
  useEffect(() => { load() }, [])

  async function remove(e, b) {
    e.stopPropagation()
    if (!confirm(`Delete “${b.title}”? The drawing is lost; tickets, tasks and goals on it are untouched.`)) return
    try { await deleteBoard(b.id); load() } catch (err) { notify(err.message) }
  }

  return (
    <div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Plan visually</p>
          <h1>Boards</h1>
          <p className="page-subtitle">Whiteboards for sketching plans. Drop tickets, tasks and goals on them as live cards, and turn sticky notes into real work.</p>
        </div>
        <button className="primary-button" onClick={() => setShowNew(true)}>+ New board</button>
      </div>

      {boards === null ? <div className="py-10 text-muted" role="status">Loading boards…</div>
        : boards.length === 0 ? (
          <div className="text-center py-16 text-muted">
            <div className="text-3xl mb-3 text-highlight">▦</div>
            <p className="font-medium text-ink">No boards yet</p>
            <p className="text-sm mt-1">Start one here, or open the Board tab on any goal or the Whiteboard tab on Work.</p>
          </div>
        ) : (
          <div className="board-grid">
            {boards.map(b => (
              <button key={b.id} type="button" className="board-tile" onClick={() => onOpen(b.id)}>
                <div className="tile-preview" />
                <div className="tile-title">{b.title}</div>
                <div className="tile-meta">
                  <span className="scope-chip" data-scope={b.scope_type}>{SCOPE_LABEL[b.scope_type] || b.scope_type}{b.scope_title ? ` · ${b.scope_title}` : ''}</span>
                  <span>{b.shape_count} {b.shape_count === 1 ? 'item' : 'items'}</span>
                  <span>· {relative(b.updated_at)}</span>
                </div>
                <span role="button" tabIndex={0} aria-label={`Delete ${b.title}`} onClick={e => remove(e, b)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') remove(e, b) }}
                  className="absolute top-3 right-3 text-xs px-2 py-1 rounded-lg border border-border text-muted hover:text-red-500 hover:border-red-300 bg-surface/80">✕</span>
              </button>
            ))}
          </div>
        )}

      {showNew && <NewBoardDialog onClose={() => setShowNew(false)} onCreated={b => { setShowNew(false); onOpen(b.id) }} />}
    </div>
  )
}

function NewBoardDialog({ onClose, onCreated }) {
  const [title, setTitle] = useState('')
  const [scopeType, setScopeType] = useState('global')
  const [scopeId, setScopeId] = useState('')
  const [template, setTemplate] = useState('blank')
  const [goals, setGoals] = useState([])
  const [companies, setCompanies] = useState([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getGoals().then(g => setGoals(g.filter(x => !x.archived_at))).catch(() => {})
    getCompanies().then(setCompanies).catch(() => {})
  }, [])
  useEffect(() => {
    if (scopeType === 'goal') setScopeId(goals[0]?.id || '')
    else if (scopeType === 'company') setScopeId(companies[0]?.id || '')
    else setScopeId('')
  }, [scopeType, goals, companies])

  const needsTarget = scopeType === 'goal' || scopeType === 'company'
  async function submit(e) {
    e.preventDefault()
    if (needsTarget && !scopeId) return
    setSaving(true)
    try {
      const b = await createBoard({ title: title.trim(), scope_type: scopeType, scope_id: needsTarget ? scopeId : null })
      if (template !== 'blank') { try { sessionStorage.setItem(templateKey(b.id), template) } catch { /* opens blank then */ } }
      onCreated(b)
    }
    catch (err) { notify(err.message) }
    finally { setSaving(false) }
  }

  return (
    <Modal title="New board" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="text-sm font-medium text-ink" htmlFor="board-title">Title</label>
          <input id="board-title" autoFocus className="field-input mt-1" placeholder="e.g. Q4 roadmap" value={title} onChange={e => setTitle(e.target.value)} />
          <p className="text-xs text-muted mt-1">Leave empty to name it after its scope.</p>
        </div>
        <div>
          <span className="text-sm font-medium text-ink">Start from</span>
          <div className="template-grid mt-1">
            {TEMPLATE_OPTIONS.map(([v, label, hint]) => (
              <button key={v} type="button" onClick={() => setTemplate(v)} aria-pressed={template === v}><b>{label}</b>{hint}</button>
            ))}
          </div>
        </div>
        <div>
          <span className="text-sm font-medium text-ink">Scope</span>
          <div className="grid grid-cols-2 gap-2 mt-1">
            {[['global', 'Global', 'Anything goes'], ['work', 'Work', 'All client tickets'], ['goal', 'Goal', 'One goal’s tasks'], ['company', 'Client', 'One client’s tickets']].map(([v, label, hint]) => (
              <button key={v} type="button" onClick={() => setScopeType(v)} aria-pressed={scopeType === v}
                className={`text-left px-3 py-2 rounded-xl border text-sm transition-colors ${scopeType === v ? 'border-accent bg-accent-soft text-ink' : 'border-border text-muted hover:border-accent/40'}`}>
                <span className="font-medium block">{label}</span><span className="text-[11px]">{hint}</span>
              </button>
            ))}
          </div>
        </div>
        {scopeType === 'goal' && (
          <div>
            <label className="text-sm font-medium text-ink" htmlFor="board-goal">Goal</label>
            {goals.length === 0 ? <p className="text-xs text-muted mt-1">No goals yet.</p>
              : <select id="board-goal" className="field-input mt-1" value={scopeId} onChange={e => setScopeId(e.target.value)}>{goals.map(g => <option key={g.id} value={g.id}>{g.title}</option>)}</select>}
          </div>
        )}
        {scopeType === 'company' && (
          <div>
            <label className="text-sm font-medium text-ink" htmlFor="board-company">Client</label>
            {companies.length === 0 ? <p className="text-xs text-muted mt-1">No clients yet. Add one on the Work page.</p>
              : <select id="board-company" className="field-input mt-1" value={scopeId} onChange={e => setScopeId(e.target.value)}>{companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary-button" disabled={saving || (needsTarget && !scopeId)}>{saving ? 'Creating…' : 'Create board'}</button>
        </div>
      </form>
    </Modal>
  )
}
