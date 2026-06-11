import { useEffect, useState, useRef } from 'react'
import {
  getCompanies, createCompany, updateCompany, deleteCompany,
  getWorkLogs, createWorkLog, updateWorkLog, deleteWorkLog,
  startWorkTimer, stopWorkTimer, getWeeklyWorkStats, generateWorkAI,
  getWorkTickets, getWorkTicket, createWorkTicket, updateWorkTicket, deleteWorkTicket,
  logTimeToTicket, deleteTimeEntry, startTicketTimer, stopTicketTimer,
  addTicketComment, updateTicketComment, deleteTicketComment, uploadProofImage,
  polishTicketComment, restoreTicketComment, generateWeeklyReport,
} from './api'
import Modal from './components/Modal'
import MicButton from './components/MicButton'
import AIPolishButton from './components/AIPolishButton'
import SavedTextToggle from './components/SavedTextToggle'

// ─── Constants ─────────────────────────────────────────────────────────────────

const WORK_TYPES = {
  code:     { label: 'Code',     icon: '⌨️', color: 'bg-blue-100 text-blue-700 border-blue-200' },
  research: { label: 'Research', icon: '🔬', color: 'bg-violet-100 text-violet-700 border-violet-200' },
  planning: { label: 'Planning', icon: '📋', color: 'bg-amber-100 text-amber-700 border-amber-200' },
  review:   { label: 'Review',   icon: '🔍', color: 'bg-teal-100 text-teal-700 border-teal-200' },
  meeting:  { label: 'Meeting',  icon: '🤝', color: 'bg-rose-100 text-rose-700 border-rose-200' },
}

const TICKET_STATUSES = {
  backlog:     { label: 'Backlog',     dot: 'bg-sand-300',    bg: 'bg-[#F2EDE4] text-[#6B6B6B]' },
  todo:        { label: 'To Do',       dot: 'bg-[#b5a08a]',   bg: 'bg-[#F2EDE4] text-[#6B6B6B]' },
  in_progress: { label: 'In Progress', dot: 'bg-blue-400',    bg: 'bg-blue-50 text-blue-700' },
  review:      { label: 'In Review',   dot: 'bg-violet-400',  bg: 'bg-violet-50 text-violet-700' },
  done:        { label: 'Done',        dot: 'bg-[#2D7A6B]',   bg: 'bg-[#2D7A6B]/10 text-[#2D7A6B]' },
  blocked:     { label: 'Blocked',     dot: 'bg-red-400',     bg: 'bg-red-50 text-red-600' },
}

const PRIORITIES = {
  low:    { label: 'Low',    color: 'text-[#b5a08a]', icon: '↓' },
  medium: { label: 'Medium', color: 'text-amber-500',  icon: '→' },
  high:   { label: 'High',   color: 'text-orange-500', icon: '↑' },
  urgent: { label: 'Urgent', color: 'text-red-500',    icon: '⚡' },
}

const COMPANY_COLORS = [
  '#2D7A6B','#1B3A2D','#E8C334','#3B82F6','#8B5CF6','#EC4899',
  '#F59E0B','#10B981','#6366F1','#EF4444','#14B8A6','#F97316',
]

const STATUS_ORDER = ['backlog', 'todo', 'in_progress', 'review', 'done', 'blocked']
const ACTIVE_STATUSES = ['backlog', 'todo', 'in_progress', 'review', 'blocked']

const todayStr = () => new Date().toISOString().split('T')[0]

function fmtMins(m) {
  if (!m) return '0m'
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`
}

// Formats raw seconds as  MM:SS  (or  H:MM:SS  once past an hour)
function fmtClock(secs) {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

function fmtDate(d) {
  if (!d) return ''
  const today = todayStr()
  const yest = new Date(); yest.setDate(yest.getDate() - 1)
  const yestStr = yest.toISOString().split('T')[0]
  if (d === today) return 'Today'
  if (d === yestStr) return 'Yesterday'
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function deriveProofLabel(url) {
  if (!url) return url
  try {
    if (url.includes('jira')) { const m = url.match(/[A-Z]+-\d+/); if (m) return m[0] }
    if (url.includes('github.com')) {
      const pr = url.match(/\/pull\/(\d+)/); if (pr) return `PR #${pr[1]}`
      const is = url.match(/\/issues\/(\d+)/); if (is) return `Issue #${is[1]}`
    }
    if (url.includes('linear.app')) return url.split('/').pop()
    const p = new URL(url)
    return p.pathname.split('/').filter(Boolean).pop() || p.hostname
  } catch { return url }
}

// ─── Small shared components ──────────────────────────────────────────────────

function TypeBadge({ type }) {
  const t = WORK_TYPES[type] || WORK_TYPES.code
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-lg border flex-shrink-0 ${t.color}`}>
      {t.icon} {t.label}
    </span>
  )
}

function StatusPill({ status, onChange }) {
  const s = TICKET_STATUSES[status] || TICKET_STATUSES.todo
  if (!onChange) return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full ${s.bg}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />{s.label}
    </span>
  )
  return (
    <select value={status}
      onChange={e => onChange(e.target.value)}
      onClick={e => e.stopPropagation()}
      className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border-0 outline-none cursor-pointer ${s.bg}`}>
      {STATUS_ORDER.map(k => (
        <option key={k} value={k}>{TICKET_STATUSES[k].label}</option>
      ))}
    </select>
  )
}

function PriorityDot({ priority }) {
  const p = PRIORITIES[priority] || PRIORITIES.medium
  return <span className={`text-sm font-bold ${p.color}`} title={p.label}>{p.icon}</span>
}

function ProofBadge({ proof }) {
  const label = proof.label || deriveProofLabel(proof.url)
  const icon = proof.url?.includes('jira') ? '🎫' : proof.url?.includes('github') ? '' : proof.url?.includes('linear') ? '◆' : '🔗'
  return (
    <a href={proof.url} target="_blank" rel="noreferrer"
      onClick={e => e.stopPropagation()}
      className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-lg border border-[#E8E3DB] bg-[#F9F6F1] text-[#1A1A1A] hover:border-[#2D7A6B] hover:bg-[#2D7A6B]/5 transition-all font-mono">
      <span>{icon}</span><span>{label}</span>
    </a>
  )
}

// Time progress bar
function TimeBar({ estimated, logged, running = 0 }) {
  if (!estimated) return null
  const total = logged + Math.floor(running / 60)
  const pct = Math.min(100, Math.round((total / estimated) * 100))
  const over = total > estimated
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[11px]">
        <span className="text-[#6B6B6B]">
          {fmtMins(total)} logged · est. {fmtMins(estimated)}
        </span>
        <span className={over ? 'text-red-500 font-semibold' : 'text-[#6B6B6B]'}>{pct}%</span>
      </div>
      <div className="w-full h-1.5 bg-[#F2EDE4] rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${over ? 'bg-red-400' : pct >= 80 ? 'bg-amber-400' : 'bg-[#2D7A6B]'}`}
          style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

// ─── Ticket Detail Drawer ─────────────────────────────────────────────────────

function isUrl(str) {
  try { return ['http://', 'https://'].some(p => str.trim().startsWith(p)) } catch { return false }
}

function isImageUrl(str) {
  return /\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(str) || str.includes('/uploads/')
}

function fmtTimestamp(iso) {
  const d = new Date(iso)
  const today = new Date(); today.setHours(0,0,0,0)
  const yest = new Date(today); yest.setDate(yest.getDate()-1)
  const base = d >= today ? 'Today' : d >= yest ? 'Yesterday'
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${base} ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
}

// Inline-editable note item in the ticket feed
function NoteItem({ item, ticketId, onUpdate }) {
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState(item.body)
  const [saving, setSaving] = useState(false)
  const ref = useRef(null)

  function startEdit() {
    setEditText(item.body)
    setEditing(true)
    setTimeout(() => { ref.current?.focus(); ref.current?.select() }, 0)
  }

  async function saveEdit() {
    const trimmed = editText.trim()
    if (!trimmed || trimmed === item.body) { setEditing(false); return }
    setSaving(true)
    try {
      const updated = await updateTicketComment(ticketId, item.id, trimmed)
      onUpdate(updated)
      setEditing(false)
    } catch (err) { alert(err.message) }
    finally { setSaving(false) }
  }

  function cancelEdit() { setEditing(false); setEditText(item.body) }

  if (editing) {
    return (
      <div>
        <textarea
          ref={ref}
          value={editText}
          onChange={e => setEditText(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit() }
            if (e.key === 'Escape') cancelEdit()
          }}
          rows={Math.max(2, editText.split('\n').length)}
          className="w-full text-sm text-[#1A1A1A] leading-relaxed bg-[#F9F6F1] border border-[#2D7A6B]/30 rounded-xl px-3 py-2 focus:outline-none resize-none"
        />
        <div className="flex items-center gap-2 mt-1.5">
          <button onClick={saveEdit} disabled={saving}
            className="text-[11px] px-2.5 py-1 rounded-lg bg-[#1B3A2D] text-white font-medium disabled:opacity-50 hover:bg-[#2a5240] transition-colors">
            {saving ? '…' : 'Save'}
          </button>
          <button onClick={cancelEdit}
            className="text-[11px] px-2.5 py-1 rounded-lg text-[#6B6B6B] hover:text-[#1A1A1A] transition-colors">
            Cancel
          </button>
          <span className="text-[10px] text-[#b5a08a] ml-auto">↵ save · Esc cancel</span>
        </div>
      </div>
    )
  }

  return (
    <div>
      <SavedTextToggle
        text={item.body}
        original={item.body_original}
        onPolish={() => polishTicketComment(item.id).then(onUpdate)}
        onRestore={() => restoreTicketComment(item.id).then(onUpdate)}>
        {(txt) => <p className="text-sm text-[#1A1A1A] leading-relaxed whitespace-pre-wrap">{txt}</p>}
      </SavedTextToggle>
      <div className="flex items-center gap-2 mt-0.5">
        <p className="text-[10px] text-[#b5a08a]">{fmtTimestamp(item.ts)}</p>
        <button onClick={startEdit}
          className="opacity-0 group-hover:opacity-100 text-[10px] text-[#b5a08a] hover:text-[#2D7A6B] transition-all">
          ✎ edit
        </button>
      </div>
    </div>
  )
}

// Merge time entries + comments into one sorted feed
function buildFeed(ticket) {
  const entries = (ticket.time_entries || []).map(e => ({
    id: e.id, kind: 'time', ts: e.created_at || e.logged_at,
    duration_seconds: e.duration_seconds || e.duration_minutes * 60,
    duration_minutes: e.duration_minutes, logged_at: e.logged_at, note: e.note,
  }))
  const comments = (ticket.comments || []).map(c => ({
    id: c.id, kind: c.type === 'proof' ? 'proof' : 'note', ts: c.created_at,
    body: c.body, body_original: c.body_original || null,
  }))
  return [...entries, ...comments].sort((a, b) => b.ts.localeCompare(a.ts))
}

function TicketDrawer({ ticket, onClose, onUpdate, onDelete, onEdit }) {
  const [compose, setCompose] = useState('')
  const [logMode, setLogMode] = useState(false)  // true = time-log sub-form
  const [logForm, setLogForm] = useState({ duration_minutes: '', logged_at: todayStr(), note: '' })
  const [sending, setSending] = useState(false)
  const [timerSecs, setTimerSecs] = useState(0)
  const timerRef = useRef(null)
  const composeRef = useRef(null)

  // When timer_running changes, sync timerSecs from the session's started_at
  // so resuming after close picks up from the real elapsed time
  useEffect(() => {
    clearInterval(timerRef.current)
    timerRef.current = null
    if (ticket.timer_running) {
      // If we have a server-side started_at, resume from real elapsed time
      // Otherwise start from 0 (just clicked Start for the first time)
      if (ticket.timer_started_at) {
        const startedMs = new Date(ticket.timer_started_at).getTime()
        const elapsed = Math.floor((Date.now() - startedMs) / 1000)
        setTimerSecs(Math.max(0, elapsed))
      } else {
        setTimerSecs(0)
      }
      timerRef.current = setInterval(() => setTimerSecs(s => s + 1), 1000)
    } else {
      setTimerSecs(0)
    }
    return () => {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [ticket.timer_running, ticket.timer_started_at])

  // Auto-detect URL in compose box
  const isProof = isUrl(compose)

  async function handleSend(e) {
    e?.preventDefault()
    const text = compose.trim()
    if (!text) return
    setSending(true)
    try {
      const updated = await addTicketComment(ticket.id, {
        body: text,
        type: isProof ? 'proof' : 'note',
      })
      onUpdate(updated)
      setCompose('')
      composeRef.current?.focus()
    } catch (err) { alert(err.message) }
    finally { setSending(false) }
  }

  async function handlePaste(e) {
    const items = Array.from(e.clipboardData?.items || [])
    const imageItem = items.find(i => i.type.startsWith('image/'))
    if (!imageItem) return
    e.preventDefault()
    setSending(true)
    try {
      const file = imageItem.getAsFile()
      const { url } = await uploadProofImage(file)
      const updated = await addTicketComment(ticket.id, { body: url, type: 'proof' })
      onUpdate(updated)
    } catch (err) { alert(err.message) }
    finally { setSending(false) }
  }

  async function handleLogTime(e) {
    e.preventDefault()
    setSending(true)
    try {
      const updated = await logTimeToTicket(ticket.id, {
        duration_minutes: parseInt(logForm.duration_minutes) || 0,
        logged_at: logForm.logged_at,
        note: logForm.note,
      })
      onUpdate(updated)
      setLogForm({ duration_minutes: '', logged_at: todayStr(), note: '' })
      setLogMode(false)
    } catch (err) { alert(err.message) }
    finally { setSending(false) }
  }

  async function handleTimerToggle() {
    try {
      if (ticket.timer_running) {
        const res = await stopTicketTimer(ticket.id)
        clearInterval(timerRef.current); setTimerSecs(0)
        // Reload full ticket so time entries refresh
        const full = await getWorkTicket(ticket.id)
        onUpdate(full)
      } else {
        const res = await startTicketTimer(ticket.id)
        // Let useEffect handle the interval — don't start one here too
        onUpdate({ ...ticket, timer_running: true, timer_started_at: res.started_at, status: ticket.status === 'todo' ? 'in_progress' : ticket.status })
      }
    } catch (err) { alert(err.message) }
  }

  async function handleDeleteFeedItem(item) {
    try {
      if (item.kind === 'time') {
        await deleteTimeEntry(ticket.id, item.id)
      } else {
        await deleteTicketComment(ticket.id, item.id)
      }
      const full = await getWorkTicket(ticket.id)
      onUpdate(full)
    } catch (err) { alert(err.message) }
  }

  const feed = buildFeed(ticket)
  // Total seconds = all previous logged seconds (exact) + current session elapsed
  const totalSecs = (ticket.logged_seconds || 0) + timerSecs
  const liveLogged = Math.floor(totalSecs / 60)  // in minutes, for TimeBar

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="w-full max-w-xl bg-white h-full shadow-2xl flex flex-col"
        onClick={e => e.stopPropagation()}>

        {/* ── Header ── */}
        <div className="px-6 pt-5 pb-4 border-b border-[#E8E3DB] flex-shrink-0">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              {/* Badges row */}
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <TypeBadge type={ticket.type} />
                <StatusPill status={ticket.status} onChange={status =>
                  updateWorkTicket(ticket.id, { status }).then(onUpdate).catch(e => alert(e.message))
                } />
                <PriorityDot priority={ticket.priority} />
                {ticket.ticket_ref && (
                  <span className="text-[11px] font-mono text-[#6B6B6B] bg-[#F2EDE4] px-2 py-0.5 rounded-lg">
                    {ticket.ticket_ref}
                  </span>
                )}
              </div>
              <h2 className="font-bold text-[#1A1A1A] text-lg leading-tight">{ticket.title}</h2>
              <div className="flex items-center gap-1.5 mt-1">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: ticket.company_color }} />
                <span className="text-xs text-[#6B6B6B]">{ticket.company_name}</span>
                {ticket.tags?.length > 0 && (
                  <>
                    <span className="text-[#E8E3DB]">·</span>
                    {ticket.tags.slice(0, 3).map((t, i) => (
                      <span key={i} className="text-[10px] px-1.5 py-0.5 bg-[#F2EDE4] text-[#6B6B6B] rounded-md">#{t}</span>
                    ))}
                  </>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button onClick={() => onEdit?.(ticket)}
                title="Edit ticket"
                className="w-7 h-7 flex items-center justify-center text-[#b5a08a] hover:text-[#2D7A6B] transition-colors text-sm">✏️</button>
              <button onClick={() => { if (confirm('Delete ticket?')) deleteWorkTicket(ticket.id).then(onDelete).catch(e => alert(e.message)) }}
                className="w-7 h-7 flex items-center justify-center text-[#b5a08a] hover:text-red-400 transition-colors text-sm">🗑</button>
              <button onClick={onClose}
                className="w-7 h-7 flex items-center justify-center text-[#b5a08a] hover:text-[#1A1A1A] transition-colors text-lg">✕</button>
            </div>
          </div>

          {/* Time bar */}
          {ticket.estimated_minutes > 0
            ? <div className="mt-3"><TimeBar estimated={ticket.estimated_minutes} logged={ticket.logged_minutes} running={timerSecs} /></div>
            : (ticket.logged_minutes > 0 || ticket.timer_running) && (
              <p className="text-xs text-[#6B6B6B] mt-2">
                {ticket.timer_running
                  ? <><span className="font-mono text-[#2D7A6B] font-semibold">{fmtClock(totalSecs)}</span><span className="ml-1.5">total · session {fmtClock(timerSecs)}</span></>
                  : <>⏱ {fmtMins(ticket.logged_minutes)} logged</>
                }
              </p>
            )
          }

          {/* Timer bar */}
          <div className="flex items-center gap-2 mt-3">
            <button onClick={handleTimerToggle}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-colors flex-1 justify-center ${
                ticket.timer_running
                  ? 'bg-[#2D7A6B] text-white hover:bg-[#1B3A2D]'
                  : 'bg-[#1B3A2D] text-white hover:bg-[#2a5240]'
              }`}>
              {ticket.timer_running ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-white animate-pulse flex-shrink-0" />
                  <span>⏹ Stop</span>
                  <span className="font-mono tracking-widest">{fmtClock(totalSecs)}</span>
                </>
              ) : <><span>▶</span><span>{ticket.logged_minutes > 0 ? `Resume · ${fmtMins(ticket.logged_minutes)}` : 'Start Timer'}</span></>}
            </button>
            <button onClick={() => setLogMode(v => !v)}
              className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-colors ${
                logMode ? 'bg-[#F2EDE4] border-[#E8E3DB] text-[#1A1A1A]' : 'border-[#E8E3DB] text-[#6B6B6B] hover:border-[#2D7A6B] hover:text-[#2D7A6B]'
              }`}>
              + Log Time
            </button>
          </div>

          {/* Log Time inline form */}
          {logMode && (
            <form onSubmit={handleLogTime} className="mt-3 bg-[#F9F6F1] rounded-xl p-3 border border-[#E8E3DB] space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-[#6B6B6B] font-medium">Duration (min)</label>
                  <input type="number" min="1" required autoFocus value={logForm.duration_minutes}
                    onChange={e => setLogForm(f => ({ ...f, duration_minutes: e.target.value }))}
                    placeholder="90"
                    className="w-full mt-0.5 px-2 py-1.5 rounded-lg border border-[#E8E3DB] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#2D7A6B]/30" />
                  {logForm.duration_minutes && (
                    <p className="text-[10px] text-[#2D7A6B] mt-0.5">{fmtMins(parseInt(logForm.duration_minutes) || 0)}</p>
                  )}
                </div>
                <div>
                  <label className="text-[10px] text-[#6B6B6B] font-medium">Date</label>
                  <input type="date" value={logForm.logged_at}
                    onChange={e => setLogForm(f => ({ ...f, logged_at: e.target.value }))}
                    className="w-full mt-0.5 px-2 py-1.5 rounded-lg border border-[#E8E3DB] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#2D7A6B]/30" />
                </div>
              </div>
              <input value={logForm.note} onChange={e => setLogForm(f => ({ ...f, note: e.target.value }))}
                placeholder="What did you do? (optional)"
                className="w-full px-2 py-1.5 rounded-lg border border-[#E8E3DB] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#2D7A6B]/30" />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setLogMode(false)}
                  className="text-xs text-[#6B6B6B] px-3 py-1.5 hover:text-[#1A1A1A]">Cancel</button>
                <button type="submit" disabled={sending || !logForm.duration_minutes}
                  className="bg-[#1B3A2D] text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-[#2a5240] disabled:opacity-40">
                  {sending ? 'Logging…' : 'Log Time'}
                </button>
              </div>
            </form>
          )}
        </div>

        {/* ── Activity Feed ── */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2 flex flex-col-reverse">
          {/* Description pinned at bottom of feed (visually at top when scrolled to top) */}
          {(ticket.description || ticket.notes) && (
            <div className="mb-4 pb-4 border-b border-[#F2EDE4]">
              {ticket.description && (
                <div className="mb-3">
                  <p className="text-[10px] font-bold text-[#b5a08a] uppercase tracking-wide mb-1">Description</p>
                  <p className="text-sm text-[#1A1A1A] leading-relaxed whitespace-pre-wrap">{ticket.description}</p>
                </div>
              )}
              {ticket.notes && (
                <div>
                  <p className="text-[10px] font-bold text-[#b5a08a] uppercase tracking-wide mb-1">Notes</p>
                  <div className="bg-[#F9F6F1] rounded-xl p-3 text-xs text-[#1A1A1A] leading-relaxed whitespace-pre-wrap border border-[#E8E3DB] font-mono">
                    {ticket.notes}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Screenshots gallery — all image proofs from comments */}
          {(() => {
            const imgs = feed.filter(item => item.kind === 'proof' && isImageUrl(item.body))
            if (!imgs.length) return null
            return (
              <div className="mb-4 pb-4 border-b border-[#F2EDE4]">
                <p className="text-[10px] font-bold text-[#b5a08a] uppercase tracking-wide mb-2">Screenshots</p>
                <div className="flex gap-2 flex-wrap">
                  {imgs.map(item => (
                    <a key={item.id} href={item.body} target="_blank" rel="noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="group relative block rounded-xl overflow-hidden border border-[#E8E3DB] hover:border-[#2D7A6B] transition-all shadow-sm">
                      <img src={item.body} alt="screenshot"
                        className="w-36 h-24 object-cover group-hover:opacity-90 transition-opacity" />
                    </a>
                  ))}
                </div>
              </div>
            )
          })()}

          {feed.length === 0 && !ticket.description && !ticket.notes && (
            <div className="flex flex-col items-center justify-center py-12 text-[#b5a08a] flex-1">
              <p className="text-3xl mb-2">📝</p>
              <p className="text-sm font-medium">Nothing here yet</p>
              <p className="text-xs mt-1">Drop a note, paste a link, or log some time below</p>
            </div>
          )}

          {feed.map(item => (
            <div key={item.id} className="group flex items-start gap-3">
              {/* Icon */}
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] flex-shrink-0 mt-0.5 ${
                item.kind === 'time'  ? 'bg-[#1B3A2D]/10 text-[#1B3A2D]' :
                item.kind === 'proof' ? 'bg-blue-50 text-blue-600' :
                'bg-[#F2EDE4] text-[#6B6B6B]'
              }`}>
                {item.kind === 'time' ? '⏱' : item.kind === 'proof' ? '🔗' : '💬'}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                {item.kind === 'time' && (
                  <div>
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-bold text-[#1B3A2D] font-mono">{fmtClock(item.duration_seconds)}</span>
                      <span className="text-[11px] text-[#6B6B6B]">logged · {fmtDate(item.logged_at)}</span>
                    </div>
                    {item.note && <p className="text-xs text-[#6B6B6B] mt-0.5 leading-relaxed">{item.note}</p>}
                  </div>
                )}
                {item.kind === 'proof' && (
                  <div>
                    {isImageUrl(item.body) ? (
                      <a href={item.body} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>
                        <img src={item.body} alt="proof screenshot"
                          className="max-w-[260px] max-h-[180px] rounded-xl border border-[#E8E3DB] object-cover hover:opacity-90 transition-opacity" />
                      </a>
                    ) : (
                      <ProofBadge proof={{ url: item.body, label: '' }} />
                    )}
                    <p className="text-[10px] text-[#b5a08a] mt-0.5">{fmtTimestamp(item.ts)}</p>
                  </div>
                )}
                {item.kind === 'note' && (
                  <NoteItem
                    item={item}
                    ticketId={ticket.id}
                    onUpdate={onUpdate}
                  />
                )}
              </div>

              {/* Delete */}
              <button onClick={() => handleDeleteFeedItem(item)}
                className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center text-[#b5a08a] hover:text-red-400 transition-all text-xs flex-shrink-0 mt-1">✕</button>
            </div>
          ))}
        </div>

        {/* ── Compose Bar ── (sticky bottom) */}
        <div className="flex-shrink-0 border-t border-[#E8E3DB] px-4 py-3 bg-white">
          {isProof && (
            <p className="text-[10px] text-blue-500 mb-1.5 px-1">🔗 Will be saved as a proof link</p>
          )}
          <div className="flex items-end gap-2">
            <textarea
              ref={composeRef}
              value={compose}
              onChange={e => setCompose(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
              onPaste={handlePaste}
              placeholder="Drop a note, paste a link, or write a finding… (Enter to send)"
              rows={compose.split('\n').length > 2 ? 4 : 2}
              className="flex-1 resize-none px-3 py-2.5 rounded-xl border border-[#E8E3DB] text-sm bg-[#F9F6F1] focus:outline-none focus:ring-2 focus:ring-[#2D7A6B]/30 focus:bg-white transition-colors placeholder:text-[#b5a08a] leading-relaxed"
            />
            <MicButton value={compose} onChange={setCompose} />
            <button onClick={handleSend} disabled={!compose.trim() || sending}
              className={`w-9 h-9 flex items-center justify-center rounded-xl text-white transition-colors flex-shrink-0 font-bold text-base ${
                isProof ? 'bg-blue-500 hover:bg-blue-600' : 'bg-[#1B3A2D] hover:bg-[#2a5240]'
              } disabled:opacity-40`}>
              {sending ? '…' : '↑'}
            </button>
          </div>
          <div className="flex items-center justify-between mt-1.5 px-1">
            <p className="text-[10px] text-[#b5a08a]">Shift+Enter for new line · paste URL or screenshot</p>
            <AIPolishButton value={compose} onChange={setCompose} context="comment" />
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Ticket Card (in list) ────────────────────────────────────────────────────

function TicketCard({ ticket, onClick, onStatusChange }) {
  const isDone = ticket.status === 'done'
  const isBlocked = ticket.status === 'blocked'

  return (
    <div onClick={onClick}
      className={`bg-white border rounded-2xl p-4 shadow-[0_1px_3px_rgba(0,0,0,0.07)] cursor-pointer transition-all ${
        isBlocked ? 'border-l-[3px] border-l-red-400 border-t-[#E8E3DB] border-r-[#E8E3DB] border-b-[#E8E3DB]'
        : isDone ? 'border-[#E8E3DB] opacity-70'
        : 'border-[#E8E3DB] hover:border-[#2D7A6B]/30 hover:shadow-md'
      }`}>
      {/* Top row */}
      <div className="flex items-start gap-2 mb-2">
        <TypeBadge type={ticket.type} />
        <div className="flex-1 min-w-0" />
        <PriorityDot priority={ticket.priority} />
        <StatusPill status={ticket.status} onChange={status => onStatusChange(ticket.id, status)} />
      </div>

      {/* Title */}
      <h3 className={`font-semibold text-sm leading-snug mb-1 ${isDone ? 'line-through text-[#6B6B6B]' : 'text-[#1A1A1A]'}`}>
        {ticket.ticket_ref && (
          <span className="font-mono text-[11px] text-[#b5a08a] mr-1.5">{ticket.ticket_ref}</span>
        )}
        {ticket.title}
      </h3>

      {/* Company */}
      <div className="flex items-center gap-1.5 mb-3">
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: ticket.company_color }} />
        <span className="text-[11px] text-[#6B6B6B]">{ticket.company_name}</span>
      </div>

      {/* Time bar */}
      <TimeBar estimated={ticket.estimated_minutes} logged={ticket.logged_minutes} running={ticket.timer_running ? 10 : 0} />

      {!ticket.estimated_minutes && ticket.logged_minutes > 0 && (
        <p className="text-[11px] text-[#6B6B6B] mt-1">⏱ {fmtMins(ticket.logged_minutes)} logged</p>
      )}

      {/* Proofs + tags */}
      {(ticket.proofs?.length > 0 || ticket.tags?.length > 0) && (
        <div className="flex flex-wrap gap-1.5 mt-2" onClick={e => e.stopPropagation()}>
          {ticket.proofs?.slice(0, 2).map((p, i) => <ProofBadge key={i} proof={p} />)}
          {ticket.tags?.slice(0, 3).map((t, i) => (
            <span key={i} className="text-[10px] px-1.5 py-0.5 bg-[#F2EDE4] text-[#6B6B6B] rounded-md">#{t}</span>
          ))}
        </div>
      )}

      {/* Timer indicator */}
      {ticket.timer_running && (
        <div className="flex items-center gap-1.5 mt-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[#2D7A6B] animate-pulse" />
          <span className="text-[11px] text-[#2D7A6B] font-medium">Timer running</span>
        </div>
      )}
    </div>
  )
}

// ─── Ticket Form Modal ─────────────────────────────────────────────────────────

const EMPTY_TICKET = {
  company_id: '', title: '', description: '', type: 'code', status: 'todo',
  priority: 'medium', estimated_minutes: '', ticket_ref: '', tags: '', proofs: '', notes: '',
}

function TicketModal({ companies, initial, onSave, onClose }) {
  const [form, setForm] = useState(initial
    ? {
        company_id: initial.company_id || '',
        title: initial.title || '',
        description: initial.description || '',
        type: initial.type || 'code',
        status: initial.status || 'todo',
        priority: initial.priority || 'medium',
        estimated_minutes: initial.estimated_minutes || '',
        ticket_ref: initial.ticket_ref || '',
        tags: (initial.tags || []).join(', '),
        proofs: (initial.proofs || []).map(p => p.url).join('\n'),
        notes: initial.notes || '',
      }
    : { ...EMPTY_TICKET, company_id: companies[0]?.id || '' })
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const proofUrls = form.proofs.split('\n').map(s => s.trim()).filter(Boolean)
      await onSave({
        company_id: form.company_id,
        title: form.title.trim(),
        description: form.description.trim(),
        type: form.type,
        status: form.status,
        priority: form.priority,
        estimated_minutes: parseInt(form.estimated_minutes) || 0,
        ticket_ref: form.ticket_ref.trim(),
        tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
        proofs: proofUrls.map(url => ({ url, label: '' })),
        notes: form.notes.trim(),
      })
    } finally { setSaving(false) }
  }

  return (
    <Modal title={initial ? 'Edit Ticket' : 'New Ticket'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Company */}
        <div>
          <label className="text-xs font-semibold text-[#6B6B6B] uppercase tracking-wide">Company</label>
          <div className="flex flex-wrap gap-2 mt-1.5">
            {companies.map(c => (
              <button key={c.id} type="button" onClick={() => setForm(f => ({ ...f, company_id: c.id }))}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all ${
                  form.company_id === c.id ? 'text-white border-transparent' : 'border-[#E8E3DB] text-[#6B6B6B]'
                }`}
                style={form.company_id === c.id ? { background: c.color } : {}}>
                {c.name}
              </button>
            ))}
          </div>
        </div>

        {/* Title */}
        <div>
          <label className="text-xs font-semibold text-[#6B6B6B] uppercase tracking-wide">Ticket Title</label>
          <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} required
            placeholder="e.g. Implement JWT authentication"
            className="w-full mt-1.5 px-3 py-2 rounded-xl border border-[#E8E3DB] text-sm focus:outline-none focus:ring-2 focus:ring-[#2D7A6B]/30 bg-white" />
        </div>

        {/* Type + Priority + Status */}
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="text-xs font-semibold text-[#6B6B6B] uppercase tracking-wide">Type</label>
            <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
              className="w-full mt-1.5 px-2 py-2 rounded-xl border border-[#E8E3DB] text-xs bg-white focus:outline-none">
              {Object.entries(WORK_TYPES).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-[#6B6B6B] uppercase tracking-wide">Priority</label>
            <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
              className="w-full mt-1.5 px-2 py-2 rounded-xl border border-[#E8E3DB] text-xs bg-white focus:outline-none">
              {Object.entries(PRIORITIES).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-[#6B6B6B] uppercase tracking-wide">Status</label>
            <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
              className="w-full mt-1.5 px-2 py-2 rounded-xl border border-[#E8E3DB] text-xs bg-white focus:outline-none">
              {STATUS_ORDER.map(k => <option key={k} value={k}>{TICKET_STATUSES[k].label}</option>)}
            </select>
          </div>
        </div>

        {/* Estimate + External ref */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-[#6B6B6B] uppercase tracking-wide">Estimate (min)</label>
            <input type="number" min="0" value={form.estimated_minutes}
              onChange={e => setForm(f => ({ ...f, estimated_minutes: e.target.value }))}
              placeholder="e.g. 240  (= 4h)"
              className="w-full mt-1.5 px-3 py-2 rounded-xl border border-[#E8E3DB] text-sm focus:outline-none focus:ring-2 focus:ring-[#2D7A6B]/30 bg-white" />
            {form.estimated_minutes && (
              <p className="text-[10px] text-[#2D7A6B] mt-0.5">= {fmtMins(parseInt(form.estimated_minutes) || 0)}</p>
            )}
          </div>
          <div>
            <label className="text-xs font-semibold text-[#6B6B6B] uppercase tracking-wide">External Ref</label>
            <input value={form.ticket_ref} onChange={e => setForm(f => ({ ...f, ticket_ref: e.target.value }))}
              placeholder="e.g. PROJ-123"
              className="w-full mt-1.5 px-3 py-2 rounded-xl border border-[#E8E3DB] text-sm focus:outline-none focus:ring-2 focus:ring-[#2D7A6B]/30 bg-white font-mono" />
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="text-xs font-semibold text-[#6B6B6B] uppercase tracking-wide">Description</label>
          <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            rows={2} placeholder="What needs to be done? Acceptance criteria..."
            className="w-full mt-1.5 px-3 py-2 rounded-xl border border-[#E8E3DB] text-sm focus:outline-none focus:ring-2 focus:ring-[#2D7A6B]/30 bg-white resize-none" />
        </div>

        {/* Proof links */}
        <div>
          <label className="text-xs font-semibold text-[#6B6B6B] uppercase tracking-wide">Proof Links (one per line)</label>
          <textarea value={form.proofs} onChange={e => setForm(f => ({ ...f, proofs: e.target.value }))}
            rows={2} placeholder="https://jira.company.com/PROJ-123&#10;https://github.com/org/repo/pull/456"
            className="w-full mt-1.5 px-3 py-2 rounded-xl border border-[#E8E3DB] text-xs focus:outline-none focus:ring-2 focus:ring-[#2D7A6B]/30 bg-white resize-none font-mono" />
        </div>

        {/* Tags */}
        <div>
          <label className="text-xs font-semibold text-[#6B6B6B] uppercase tracking-wide">Tags</label>
          <input value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))}
            placeholder="backend, auth, sprint-3"
            className="w-full mt-1.5 px-3 py-2 rounded-xl border border-[#E8E3DB] text-sm focus:outline-none focus:ring-2 focus:ring-[#2D7A6B]/30 bg-white" />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose}
            className="px-4 py-2 text-sm text-[#6B6B6B] hover:text-[#1A1A1A] transition-colors">Cancel</button>
          <button type="submit" disabled={saving || !form.title.trim() || !form.company_id}
            className="bg-[#1B3A2D] text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-[#2a5240] disabled:opacity-40 transition-colors">
            {saving ? 'Saving…' : initial ? 'Save Changes' : 'Create Ticket'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ─── Company Modal ─────────────────────────────────────────────────────────────

function CompanyModal({ initial, onSave, onClose }) {
  const [form, setForm] = useState(initial
    ? { name: initial.name, color: initial.color, role: initial.role }
    : { name: '', color: COMPANY_COLORS[0], role: '' })
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    try { await onSave(form) }
    finally { setSaving(false) }
  }

  return (
    <Modal title={initial ? 'Edit Company' : 'Add Company'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="text-xs font-semibold text-[#6B6B6B] uppercase tracking-wide">Company Name</label>
          <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required
            className="w-full mt-1.5 px-3 py-2 rounded-xl border border-[#E8E3DB] text-sm focus:outline-none focus:ring-2 focus:ring-[#2D7A6B]/30 bg-white" />
        </div>
        <div>
          <label className="text-xs font-semibold text-[#6B6B6B] uppercase tracking-wide">Your Role</label>
          <input value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
            placeholder="e.g. Backend Developer"
            className="w-full mt-1.5 px-3 py-2 rounded-xl border border-[#E8E3DB] text-sm focus:outline-none focus:ring-2 focus:ring-[#2D7A6B]/30 bg-white" />
        </div>
        <div>
          <label className="text-xs font-semibold text-[#6B6B6B] uppercase tracking-wide">Color</label>
          <div className="flex flex-wrap gap-2 mt-2">
            {COMPANY_COLORS.map(c => (
              <button key={c} type="button" onClick={() => setForm(f => ({ ...f, color: c }))}
                className={`w-7 h-7 rounded-full transition-all ${form.color === c ? 'ring-2 ring-offset-2 ring-[#1B3A2D] scale-110' : 'hover:scale-105'}`}
                style={{ background: c }} />
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose}
            className="px-4 py-2 text-sm text-[#6B6B6B] hover:text-[#1A1A1A]">Cancel</button>
          <button type="submit" disabled={saving || !form.name.trim()}
            className="bg-[#1B3A2D] text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-[#2a5240] disabled:opacity-40">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ─── Weekly Report Modal ───────────────────────────────────────────────────────

function getMondayOf(dateStr) {
  const d = dateStr ? new Date(dateStr + 'T12:00:00') : new Date()
  const day = d.getDay()                      // 0=Sun…6=Sat
  const diff = day === 0 ? -6 : 1 - day       // shift to Monday
  d.setDate(d.getDate() + diff)
  return d.toISOString().split('T')[0]
}

function addWeeks(mondayStr, n) {
  const d = new Date(mondayStr + 'T12:00:00')
  d.setDate(d.getDate() + n * 7)
  return d.toISOString().split('T')[0]
}

function getSunday(mondayStr) {
  const d = new Date(mondayStr + 'T12:00:00')
  d.setDate(d.getDate() + 6)
  return d.toISOString().split('T')[0]
}

function fmtWeekRange(mondayStr) {
  const mon = new Date(mondayStr + 'T12:00:00')
  const sun = new Date(mondayStr + 'T12:00:00')
  sun.setDate(sun.getDate() + 6)
  const opts = { month: 'short', day: 'numeric' }
  const sameMonth = mon.getMonth() === sun.getMonth()
  const sunLabel = sameMonth
    ? sun.toLocaleDateString(undefined, { day: 'numeric' })
    : sun.toLocaleDateString(undefined, opts)
  return `${mon.toLocaleDateString(undefined, opts)} – ${sunLabel}, ${sun.getFullYear()}`
}

const TYPE_COLORS = {
  code:     '#1B3A2D',
  research: '#2D7A6B',
  planning: '#E8C334',
  review:   '#b5a08a',
  meeting:  '#6B6B6B',
}

function fmtSecs(secs) {
  const h = secs / 3600
  return h >= 1 ? `${h.toFixed(1)}h` : `${Math.round(secs / 60)}m`
}

function buildMarkdown(data) {
  const lines = [
    `# Weekly Work Report — ${data.company_name}`,
    `**Week:** ${data.date_from} to ${data.date_to}`,
    `**Total time:** ${fmtSecs(data.total_seconds)} · **Completed:** ${data.tickets_completed} tickets · **In progress:** ${data.tickets_in_progress} tickets`,
    '',
    data.ai_narrative,
    '',
    '---',
    '',
    `## Completed Work (${data.completed_tickets.length})`,
    ...data.completed_tickets.map(t => `- [${t.type.toUpperCase()}] ${t.title}${t.ticket_ref ? ` [${t.ticket_ref}]` : ''} — ${fmtSecs(t.logged_seconds)}`),
    '',
    `## In Progress (${data.in_progress_tickets.length})`,
    ...data.in_progress_tickets.map(t => `- [${t.type.toUpperCase()}] ${t.title}${t.ticket_ref ? ` [${t.ticket_ref}]` : ''} — ${fmtSecs(t.logged_seconds)} logged`),
    '',
    '## Time by Type',
    ...Object.entries(data.by_type).sort((a, b) => b[1] - a[1]).map(([k, v]) => `- ${k.charAt(0).toUpperCase() + k.slice(1)}: ${fmtSecs(v)}`),
  ]
  if (data.blocked_tickets.length) {
    lines.push('', `## Blocked (${data.blocked_tickets.length})`)
    data.blocked_tickets.forEach(t => lines.push(`- ${t.title}${t.ticket_ref ? ` [${t.ticket_ref}]` : ''}`))
  }
  return lines.join('\n')
}

function WeeklyReportModal({ companies, defaultCompanyId, onClose }) {
  const [companyId, setCompanyId] = useState(defaultCompanyId || null)
  const [monday, setMonday] = useState(getMondayOf())
  const [data, setData] = useState(null)
  const [generating, setGenerating] = useState(false)
  const [copied, setCopied] = useState(false)

  async function generate() {
    setGenerating(true); setData(null)
    try {
      const result = await generateWeeklyReport(companyId, monday, getSunday(monday))
      setData(result)
    } catch (err) { alert(err.message) }
    finally { setGenerating(false) }
  }

  async function copyMarkdown() {
    if (!data) return
    await navigator.clipboard.writeText(buildMarkdown(data))
    setCopied(true); setTimeout(() => setCopied(false), 2500)
  }

  const maxTypeSecs = data ? Math.max(1, ...Object.values(data.by_type)) : 1

  return (
    <Modal title="📋 Weekly Work Report" onClose={onClose}>
      <div className="space-y-4 min-w-[480px]">

        {/* Company picker */}
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => setCompanyId(null)}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors ${!companyId ? 'bg-[#1B3A2D] text-white' : 'bg-[#F2EDE4] text-[#6B6B6B] hover:bg-[#E8E3DB]'}`}>
            All Clients
          </button>
          {companies.map(c => (
            <button key={c.id} onClick={() => setCompanyId(c.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors ${companyId === c.id ? 'text-white' : 'bg-[#F2EDE4] text-[#6B6B6B] hover:bg-[#E8E3DB]'}`}
              style={companyId === c.id ? { backgroundColor: c.color || '#1B3A2D' } : {}}>
              {c.name}
            </button>
          ))}
        </div>

        {/* Week navigator */}
        <div className="flex items-center justify-between bg-[#F9F6F1] rounded-xl px-4 py-2.5">
          <button onClick={() => setMonday(m => addWeeks(m, -1))}
            className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-[#E8E3DB] transition-colors text-[#6B6B6B] font-bold">
            ‹
          </button>
          <span className="text-sm font-semibold text-[#1A1A1A]">{fmtWeekRange(monday)}</span>
          <button onClick={() => setMonday(m => addWeeks(m, 1))}
            className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-[#E8E3DB] transition-colors text-[#6B6B6B] font-bold">
            ›
          </button>
        </div>

        {/* Generate button */}
        <button onClick={generate} disabled={generating}
          className="w-full bg-[#1B3A2D] text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-[#2a5240] disabled:opacity-60 transition-colors">
          {generating ? '⏳ Generating report…' : '📋 Generate Report'}
        </button>

        {/* Results */}
        {data && (
          <div className="space-y-4">

            {/* Stat strip */}
            <div className="flex items-center gap-3 bg-[#F9F6F1] rounded-xl px-4 py-3 flex-wrap">
              <div className="text-center">
                <div className="text-xl font-bold text-[#1B3A2D]">{fmtSecs(data.total_seconds)}</div>
                <div className="text-[10px] text-[#6B6B6B] uppercase tracking-wide">Total logged</div>
              </div>
              <div className="w-px h-8 bg-[#E8E3DB] flex-shrink-0" />
              <div className="text-center">
                <div className="text-xl font-bold text-[#2D7A6B]">{data.tickets_completed}</div>
                <div className="text-[10px] text-[#6B6B6B] uppercase tracking-wide">Done</div>
              </div>
              <div className="w-px h-8 bg-[#E8E3DB] flex-shrink-0" />
              <div className="text-center">
                <div className="text-xl font-bold text-[#E8C334]">{data.tickets_in_progress}</div>
                <div className="text-[10px] text-[#6B6B6B] uppercase tracking-wide">In progress</div>
              </div>
              {data.tickets_blocked > 0 && (
                <>
                  <div className="w-px h-8 bg-[#E8E3DB] flex-shrink-0" />
                  <div className="text-center">
                    <div className="text-xl font-bold text-amber-500">{data.tickets_blocked}</div>
                    <div className="text-[10px] text-[#6B6B6B] uppercase tracking-wide">Blocked</div>
                  </div>
                </>
              )}
            </div>

            {/* AI narrative */}
            {data.ai_narrative && (
              <div className="bg-[#1B3A2D]/5 border border-[#1B3A2D]/10 rounded-xl p-4 max-h-52 overflow-y-auto">
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#1B3A2D]/60 mb-2">AI Summary</p>
                <p className="text-sm text-[#1A1A1A] whitespace-pre-wrap leading-relaxed">{data.ai_narrative}</p>
              </div>
            )}

            {/* Completed tickets */}
            {data.completed_tickets.length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B] mb-2">
                  ✓ Completed ({data.completed_tickets.length})
                </p>
                <div className="space-y-1.5">
                  {data.completed_tickets.map((t, i) => (
                    <div key={i} className="flex items-center gap-2 py-1.5 px-2.5 bg-[#F9F6F1] rounded-xl">
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md text-white flex-shrink-0"
                        style={{ backgroundColor: TYPE_COLORS[t.type] || '#6B6B6B' }}>
                        {t.type.toUpperCase()}
                      </span>
                      <span className="flex-1 text-sm text-[#1A1A1A] truncate">{t.title}</span>
                      {t.ticket_ref && <span className="text-[10px] text-[#b5a08a] flex-shrink-0">{t.ticket_ref}</span>}
                      <span className="text-xs font-semibold text-[#2D7A6B] flex-shrink-0 tabular-nums">{fmtSecs(t.logged_seconds)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* In progress */}
            {data.in_progress_tickets.length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B] mb-2">
                  ⟳ In Progress ({data.in_progress_tickets.length})
                </p>
                <div className="space-y-1.5">
                  {data.in_progress_tickets.map((t, i) => (
                    <div key={i} className="flex items-center gap-2 py-1.5 px-2.5 bg-[#F9F6F1] rounded-xl">
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md text-white flex-shrink-0"
                        style={{ backgroundColor: TYPE_COLORS[t.type] || '#6B6B6B' }}>
                        {t.type.toUpperCase()}
                      </span>
                      <span className="flex-1 text-sm text-[#1A1A1A] truncate">{t.title}</span>
                      {t.ticket_ref && <span className="text-[10px] text-[#b5a08a] flex-shrink-0">{t.ticket_ref}</span>}
                      <span className="text-xs font-medium text-[#6B6B6B] flex-shrink-0 tabular-nums">{fmtSecs(t.logged_seconds)} logged</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Blocked */}
            {data.blocked_tickets.length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-amber-600 mb-2">
                  ⚠ Blocked ({data.blocked_tickets.length})
                </p>
                <div className="space-y-1.5">
                  {data.blocked_tickets.map((t, i) => (
                    <div key={i} className="flex items-center gap-2 py-1.5 px-2.5 bg-amber-50 border border-amber-100 rounded-xl">
                      <span className="flex-1 text-sm text-[#1A1A1A] truncate">{t.title}</span>
                      {t.ticket_ref && <span className="text-[10px] text-[#b5a08a]">{t.ticket_ref}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Time by type bars */}
            {Object.keys(data.by_type).length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B] mb-2">Time by Type</p>
                <div className="space-y-2">
                  {Object.entries(data.by_type)
                    .sort((a, b) => b[1] - a[1])
                    .map(([type, secs]) => (
                      <div key={type} className="flex items-center gap-2">
                        <span className="text-xs text-[#6B6B6B] w-16 flex-shrink-0 capitalize">{type}</span>
                        <div className="flex-1 bg-[#E8E3DB] rounded-full h-2 overflow-hidden">
                          <div className="h-full rounded-full transition-all"
                            style={{
                              width: `${Math.round((secs / maxTypeSecs) * 100)}%`,
                              backgroundColor: TYPE_COLORS[type] || '#6B6B6B',
                            }} />
                        </div>
                        <span className="text-xs font-semibold text-[#1A1A1A] w-10 text-right tabular-nums">{fmtSecs(secs)}</span>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* Copy button */}
            <button onClick={copyMarkdown}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-[#E8E3DB] text-sm font-medium text-[#6B6B6B] hover:border-[#2D7A6B] hover:text-[#2D7A6B] transition-colors">
              {copied ? '✓ Copied to clipboard!' : '📋 Copy as Markdown'}
            </button>
          </div>
        )}

        {!data && !generating && (
          <p className="text-center text-sm text-[#b5a08a] py-2">
            Select a company and week, then click Generate.
          </p>
        )}
      </div>
    </Modal>
  )
}

// ─── AI Panel ─────────────────────────────────────────────────────────────────

function AIPanel({ onClose }) {
  const [mode, setMode] = useState('standup')
  const [result, setResult] = useState('')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  const AI_MODES = [
    { key: 'standup',         label: '📢 Daily Standup',    desc: 'Yesterday / Today / Blockers' },
    { key: 'weekly_summary',  label: '📊 Weekly Summary',   desc: 'What shipped, highlights' },
    { key: 'research_digest', label: '🔬 Research Digest',  desc: 'Key findings & decisions' },
    { key: 'payment_report',  label: '💰 Payment Report',   desc: 'Hours per client for billing' },
  ]

  async function generate() {
    setLoading(true); setResult('')
    try {
      const data = await generateWorkAI(mode, null, null)
      setResult(data.result)
    } catch (err) { setResult(`Error: ${err.message}`) }
    finally { setLoading(false) }
  }

  async function copy() {
    await navigator.clipboard.writeText(result)
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Modal title="✨ AI Work Assistant" onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {AI_MODES.map(m => (
            <button key={m.key} type="button" onClick={() => setMode(m.key)}
              className={`p-3 rounded-xl border text-left transition-all ${
                mode === m.key ? 'border-[#2D7A6B] bg-[#2D7A6B]/10' : 'border-[#E8E3DB] hover:border-[#2D7A6B]/30'
              }`}>
              <div className="text-sm font-semibold text-[#1A1A1A]">{m.label}</div>
              <div className="text-xs text-[#6B6B6B] mt-0.5">{m.desc}</div>
            </button>
          ))}
        </div>
        <button onClick={generate} disabled={loading}
          className="w-full bg-[#1B3A2D] text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-[#2a5240] disabled:opacity-60">
          {loading ? '✨ Generating…' : '✨ Generate'}
        </button>
        {result && (
          <div className="relative">
            <div className="bg-[#F9F6F1] border border-[#E8E3DB] rounded-xl p-4 text-sm text-[#1A1A1A] whitespace-pre-wrap leading-relaxed max-h-80 overflow-y-auto">
              {result}
            </div>
            <button onClick={copy}
              className="absolute top-2 right-2 text-xs px-2.5 py-1 bg-white border border-[#E8E3DB] rounded-lg text-[#6B6B6B] hover:border-[#2D7A6B]">
              {copied ? '✓ Copied!' : 'Copy'}
            </button>
          </div>
        )}
      </div>
    </Modal>
  )
}

// ─── Main Work Page ───────────────────────────────────────────────────────────

export default function WorkPage() {
  const [view, setView] = useState('tickets')   // 'tickets' | 'log'
  const [companies, setCompanies] = useState([])
  const [tickets, setTickets] = useState([])
  const [logs, setLogs] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [filterCompany, setFilterCompany] = useState(null)
  const [filterStatus, setFilterStatus] = useState('active')  // 'active' | 'done' | 'all'
  const [openTicket, setOpenTicket] = useState(null)
  const [showNewTicket, setShowNewTicket] = useState(false)
  const [editTicket, setEditTicket] = useState(null)
  const [showNewLog, setShowNewLog] = useState(false)
  const [editLog, setEditLog] = useState(null)
  const [showCompany, setShowCompany] = useState(false)
  const [editCompany, setEditCompany] = useState(null)
  const [showAI, setShowAI] = useState(false)
  const [showWeeklyReport, setShowWeeklyReport] = useState(false)

  async function load() {
    try {
      const params = filterCompany ? { company_id: filterCompany } : {}
      const statusFilter = filterStatus === 'active'
        ? ACTIVE_STATUSES.join(',')
        : filterStatus === 'done' ? 'done' : undefined
      const [cos, tix, wl, st] = await Promise.all([
        getCompanies(),
        getWorkTickets({ ...params, ...(statusFilter ? { status: statusFilter } : {}) }),
        getWorkLogs(params),
        getWeeklyWorkStats(),
      ])
      setCompanies(cos)
      setTickets(tix)
      setLogs(wl)
      setStats(st)
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [filterCompany, filterStatus])

  // ── Company handlers ──
  async function handleSaveCompany(data, id) {
    id ? await updateCompany(id, data) : await createCompany(data)
    setShowCompany(false); setEditCompany(null); load()
  }
  async function handleDeleteCompany(id) {
    if (!confirm('Delete this company and all its data?')) return
    await deleteCompany(id)
    if (filterCompany === id) setFilterCompany(null)
    load()
  }

  // ── Ticket handlers ──
  async function handleSaveTicket(data) {
    if (editTicket) {
      const updated = await updateWorkTicket(editTicket.id, data)
      setOpenTicket(updated)   // refresh the open drawer instantly
    } else {
      await createWorkTicket(data)
    }
    setShowNewTicket(false); setEditTicket(null); load()
  }
  async function handleTicketStatusChange(ticketId, status) {
    await updateWorkTicket(ticketId, { status })
    load()
  }
  function handleTicketUpdate(updated) {
    setOpenTicket(updated)
    setTickets(prev => prev.map(t => t.id === updated.id ? updated : t))
  }

  // ── Work Log handlers ──
  async function handleSaveLog(data, logId) {
    logId ? await updateWorkLog(logId, data) : await createWorkLog(data)
    setShowNewLog(false); setEditLog(null); load()
  }
  async function handleDeleteLog(id) {
    if (!confirm('Delete this log?')) return
    await deleteWorkLog(id); load()
  }
  async function handleLogTimerToggle(log) {
    log.timer_running ? await stopWorkTimer(log.id) : await startWorkTimer(log.id)
    load()
  }

  // ── Grouped logs by date ──
  const groupedLogs = logs.reduce((acc, l) => {
    if (!acc[l.logged_at]) acc[l.logged_at] = []
    acc[l.logged_at].push(l)
    return acc
  }, {})
  const sortedLogDates = Object.keys(groupedLogs).sort((a, b) => b.localeCompare(a))

  const thisWeekMins = stats?.total_minutes || 0
  const todayMins = stats?.today_total_minutes || 0

  // Merge today + week per-company into unified rows
  const companyTimeRows = (() => {
    const map = {}
    for (const c of (stats?.by_company || [])) {
      map[c.company_id] = { ...c, week_minutes: c.minutes, today_minutes: 0 }
    }
    for (const c of (stats?.today_by_company || [])) {
      if (map[c.company_id]) map[c.company_id].today_minutes = c.minutes
      else map[c.company_id] = { ...c, week_minutes: c.minutes, today_minutes: c.minutes }
    }
    return Object.values(map).sort((a, b) => b.week_minutes - a.week_minutes)
  })()

  if (loading) return <div className="flex items-center justify-center h-64 text-[#6B6B6B]">Loading…</div>

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <p className="text-[11px] font-bold text-[#6B6B6B] uppercase tracking-widest mb-1">Work Tracker</p>
          <h1 className="text-3xl font-bold text-[#1A1A1A]">Work</h1>
          <p className="text-sm text-[#6B6B6B] mt-0.5">
            {companies.length} {companies.length === 1 ? 'client' : 'clients'} · {fmtMins(thisWeekMins)} this week
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowWeeklyReport(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[#E8E3DB] text-[#1A1A1A] bg-white text-sm font-medium hover:border-[#2D7A6B] hover:text-[#2D7A6B] transition-colors">
            📋 Weekly Report
          </button>
          <button onClick={() => setShowAI(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-violet-200 text-violet-700 bg-violet-50 text-sm font-medium hover:bg-violet-100 transition-colors">
            ✨ AI
          </button>
          {view === 'tickets' ? (
            <button onClick={() => setShowNewTicket(true)} disabled={companies.length === 0}
              className="bg-[#1B3A2D] text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-[#2a5240] disabled:opacity-40 transition-colors shadow-sm">
              + New Ticket
            </button>
          ) : (
            <button onClick={() => setShowNewLog(true)} disabled={companies.length === 0}
              className="bg-[#1B3A2D] text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-[#2a5240] disabled:opacity-40 transition-colors shadow-sm">
              + Log Work
            </button>
          )}
        </div>
      </div>

      {companies.length === 0 ? (
        <div className="text-center py-24">
          <div className="text-5xl mb-4">⌨️</div>
          <h2 className="text-xl font-bold text-[#1A1A1A] mb-2">Set up your first client</h2>
          <p className="text-sm text-[#6B6B6B] mb-6 max-w-sm mx-auto">
            Add a company or client to start tracking tickets, time, and proof of work.
          </p>
          <button onClick={() => setShowCompany(true)}
            className="bg-[#1B3A2D] text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#2a5240]">
            + Add Company
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Time breakdown */}
          <div className="bg-white border border-[#E8E3DB] rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.07)] overflow-hidden">
            {/* Totals header */}
            <div className="grid grid-cols-3 border-b border-[#E8E3DB]">
              <div className="px-4 py-3">
                <p className="text-[10px] font-bold text-[#b5a08a] uppercase tracking-widest">Client</p>
              </div>
              <div className="px-4 py-3 border-l border-[#E8E3DB] text-center">
                <p className="text-[10px] font-bold text-[#b5a08a] uppercase tracking-widest">Today</p>
                <p className="text-lg font-bold text-[#1A1A1A] leading-tight">{fmtMins(todayMins)}</p>
              </div>
              <div className="px-4 py-3 border-l border-[#E8E3DB] text-center">
                <p className="text-[10px] font-bold text-[#b5a08a] uppercase tracking-widest">This Week</p>
                <p className="text-lg font-bold text-[#1A1A1A] leading-tight">{fmtMins(thisWeekMins)}</p>
              </div>
            </div>
            {/* Per-company rows */}
            {companyTimeRows.map((c, i) => (
              <div key={c.company_id}
                className={`grid grid-cols-3 ${i < companyTimeRows.length - 1 ? 'border-b border-[#F2EDE4]' : ''}`}>
                <div className="px-4 py-3 flex items-center gap-2 min-w-0">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: c.company_color }} />
                  <span className="text-sm font-medium text-[#1A1A1A] truncate">{c.company_name}</span>
                </div>
                <div className="px-4 py-3 border-l border-[#F2EDE4] flex items-center justify-center">
                  <span className={`text-sm font-semibold ${c.today_minutes > 0 ? 'text-[#2D7A6B]' : 'text-[#b5a08a]'}`}>
                    {c.today_minutes > 0 ? fmtMins(c.today_minutes) : '—'}
                  </span>
                </div>
                <div className="px-4 py-3 border-l border-[#F2EDE4] flex items-center justify-center">
                  <span className="text-sm font-semibold text-[#1A1A1A]">{fmtMins(c.week_minutes)}</span>
                </div>
              </div>
            ))}
            {companyTimeRows.length === 0 && (
              <div className="px-4 py-5 text-center text-xs text-[#b5a08a]">No time logged this week</div>
            )}
          </div>

          {/* Company filters */}
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => setFilterCompany(null)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all ${
                !filterCompany ? 'bg-[#1B3A2D] text-white border-[#1B3A2D]' : 'bg-white border-[#E8E3DB] text-[#6B6B6B] hover:border-[#2D7A6B]/40'
              }`}>All</button>
            {companies.map(c => (
              <button key={c.id} onClick={() => setFilterCompany(filterCompany === c.id ? null : c.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-all ${
                  filterCompany === c.id ? 'text-white border-transparent shadow-sm' : 'bg-white border-[#E8E3DB] text-[#6B6B6B] hover:border-[#2D7A6B]/40'
                }`}
                style={filterCompany === c.id ? { background: c.color } : {}}>
                <span className="w-2 h-2 rounded-full" style={{ background: c.color }} />
                {c.name}
              </button>
            ))}
            <button onClick={() => setShowCompany(true)}
              className="px-3 py-1.5 rounded-xl text-xs font-medium border border-dashed border-[#E8E3DB] text-[#6B6B6B] hover:border-[#2D7A6B] hover:text-[#2D7A6B]">
              + Company
            </button>
            {filterCompany && (
              <div className="ml-auto flex gap-1">
                <button onClick={() => setEditCompany(companies.find(c => c.id === filterCompany))}
                  className="text-xs px-2 py-1 rounded-lg border border-[#E8E3DB] text-[#6B6B6B] hover:border-[#2D7A6B] hover:text-[#2D7A6B]">✎</button>
                <button onClick={() => handleDeleteCompany(filterCompany)}
                  className="text-xs px-2 py-1 rounded-lg border border-[#E8E3DB] text-[#b5a08a] hover:text-red-400">✕</button>
              </div>
            )}
          </div>

          {/* View tabs */}
          <div className="flex gap-1 bg-[#F2EDE4] rounded-xl p-1 w-fit">
            {[['tickets', '🎫 Tickets'], ['log', '📋 Work Log']].map(([v, label]) => (
              <button key={v} onClick={() => setView(v)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  view === v ? 'bg-white text-[#1A1A1A] shadow-sm' : 'text-[#6B6B6B] hover:text-[#1A1A1A]'
                }`}>{label}</button>
            ))}
          </div>

          {/* ── Tickets view ── */}
          {view === 'tickets' && (
            <div className="space-y-4">
              {/* Status filter */}
              <div className="flex gap-2">
                {[['active', 'Active'], ['done', 'Done'], ['all', 'All']].map(([v, label]) => (
                  <button key={v} onClick={() => setFilterStatus(v)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all ${
                      filterStatus === v ? 'bg-[#1A1A1A] text-white border-[#1A1A1A]' : 'bg-white border-[#E8E3DB] text-[#6B6B6B] hover:border-[#2D7A6B]/40'
                    }`}>{label}</button>
                ))}
              </div>

              {tickets.length === 0 ? (
                <div className="text-center py-16 text-[#6B6B6B]">
                  <div className="text-3xl mb-3">🎫</div>
                  <p className="font-medium">No tickets yet</p>
                  <p className="text-sm mt-1">Create a ticket to track a piece of work from start to finish.</p>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {tickets.map(ticket => (
                    <TicketCard key={ticket.id}
                      ticket={ticket}
                      onClick={async () => {
                        try {
                          const full = await getWorkTicket(ticket.id)
                          setOpenTicket(full)
                        } catch { setOpenTicket(ticket) }
                      }}
                      onStatusChange={handleTicketStatusChange}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Work Log view ── */}
          {view === 'log' && (
            <div className="space-y-6">
              {logs.length === 0 ? (
                <div className="text-center py-16 text-[#6B6B6B]">
                  <div className="text-3xl mb-3">📝</div>
                  <p className="font-medium">No work logs yet</p>
                  <p className="text-sm mt-1">Log a quick work session — no ticket needed.</p>
                </div>
              ) : sortedLogDates.map(date => (
                <div key={date}>
                  <div className="flex items-center gap-3 mb-3">
                    <h2 className="text-[11px] font-bold text-[#1A1A1A] uppercase tracking-widest">{fmtDate(date)}</h2>
                    <span className="flex-1 border-t border-[#E8E3DB]" />
                    <span className="text-[11px] text-[#6B6B6B] font-medium">
                      {fmtMins(groupedLogs[date].reduce((s, l) => s + (l.duration_minutes || 0), 0))}
                    </span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {groupedLogs[date].map(log => (
                      <div key={log.id} className={`bg-white border rounded-2xl p-4 shadow-[0_1px_3px_rgba(0,0,0,0.07)] ${
                        log.status === 'done' ? 'border-[#E8E3DB] opacity-80' : 'border-[#E8E3DB] hover:border-[#2D7A6B]/30'
                      }`}>
                        <div className="flex items-start gap-2 mb-2">
                          <TypeBadge type={log.type} />
                          <div className="flex-1" />
                          <span className="text-sm font-bold text-[#1A1A1A]">{fmtMins(log.duration_minutes)}</span>
                        </div>
                        <h3 className="font-semibold text-sm text-[#1A1A1A] mb-1">{log.title}</h3>
                        <div className="flex items-center gap-1.5 mb-2">
                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: log.company_color }} />
                          <span className="text-[11px] text-[#6B6B6B]">{log.company_name}</span>
                        </div>
                        {log.proofs?.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mb-2">
                            {log.proofs.map((p, i) => <ProofBadge key={i} proof={p} />)}
                          </div>
                        )}
                        <div className="flex items-center gap-1 mt-2">
                          <button onClick={() => handleLogTimerToggle(log)}
                            className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                              log.timer_running ? 'bg-[#2D7A6B] text-white border-[#2D7A6B]' : 'border-[#E8E3DB] text-[#6B6B6B] hover:border-[#2D7A6B]'
                            }`}>
                            {log.timer_running ? '⏹ Stop' : '▶'}
                          </button>
                          <button onClick={() => setEditLog(log)}
                            className="text-xs px-2 py-1 rounded-lg border border-[#E8E3DB] text-[#6B6B6B] hover:border-[#2D7A6B]">✎</button>
                          <button onClick={() => handleDeleteLog(log.id)}
                            className="text-xs px-2 py-1 rounded-lg border border-[#E8E3DB] text-[#b5a08a] hover:text-red-400">✕</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Modals ── */}
      {openTicket && (
        <TicketDrawer
          ticket={openTicket}
          onClose={() => setOpenTicket(null)}
          onUpdate={handleTicketUpdate}
          onDelete={() => { setOpenTicket(null); load() }}
          onEdit={t => { setEditTicket(t); setShowNewTicket(false) }}
        />
      )}
      {(showNewTicket || editTicket) && (
        <TicketModal
          companies={companies}
          initial={editTicket}
          onSave={handleSaveTicket}
          onClose={() => { setShowNewTicket(false); setEditTicket(null) }}
        />
      )}
      {(showNewLog || editLog) && (
        <WorkLogModal
          companies={companies}
          initial={editLog}
          onSave={data => handleSaveLog(data, editLog?.id)}
          onClose={() => { setShowNewLog(false); setEditLog(null) }}
        />
      )}
      {(showCompany || editCompany) && (
        <CompanyModal
          initial={editCompany}
          onSave={data => handleSaveCompany(data, editCompany?.id)}
          onClose={() => { setShowCompany(false); setEditCompany(null) }}
        />
      )}
      {showAI && <AIPanel onClose={() => setShowAI(false)} />}
      {showWeeklyReport && (
        <WeeklyReportModal
          companies={companies}
          defaultCompanyId={filterCompany}
          onClose={() => setShowWeeklyReport(false)}
        />
      )}
    </div>
  )
}

// ─── Work Log Form (kept for "Log" tab) ───────────────────────────────────────

function WorkLogModal({ companies, initial, onSave, onClose }) {
  const [form, setForm] = useState(initial
    ? {
        company_id: initial.company_id || '',
        title: initial.title || '',
        type: initial.type || 'code',
        status: initial.status || 'todo',
        notes: initial.notes || '',
        tags: (initial.tags || []).join(', '),
        proofs: (initial.proofs || []).map(p => p.url).join('\n'),
        duration_minutes: initial.duration_minutes || '',
        logged_at: initial.logged_at || todayStr(),
      }
    : { company_id: companies[0]?.id || '', title: '', type: 'code', status: 'todo', notes: '', tags: '', proofs: '', duration_minutes: '', logged_at: todayStr() })
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const proofUrls = form.proofs.split('\n').map(s => s.trim()).filter(Boolean)
      await onSave({
        company_id: form.company_id,
        title: form.title.trim(),
        type: form.type,
        status: form.status,
        notes: form.notes.trim(),
        tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
        proofs: proofUrls.map(url => ({ url, label: '' })),
        duration_minutes: parseInt(form.duration_minutes) || 0,
        logged_at: form.logged_at,
      })
    } finally { setSaving(false) }
  }

  return (
    <Modal title={initial ? 'Edit Work Log' : 'Log Work'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="text-xs font-semibold text-[#6B6B6B] uppercase tracking-wide">Company</label>
          <div className="flex flex-wrap gap-2 mt-1.5">
            {companies.map(c => (
              <button key={c.id} type="button" onClick={() => setForm(f => ({ ...f, company_id: c.id }))}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all ${
                  form.company_id === c.id ? 'text-white border-transparent' : 'border-[#E8E3DB] text-[#6B6B6B]'
                }`}
                style={form.company_id === c.id ? { background: c.color } : {}}>
                {c.name}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold text-[#6B6B6B] uppercase tracking-wide">What did you work on?</label>
          <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} required
            placeholder="e.g. Fixed login redirect bug"
            className="w-full mt-1.5 px-3 py-2 rounded-xl border border-[#E8E3DB] text-sm focus:outline-none focus:ring-2 focus:ring-[#2D7A6B]/30 bg-white" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-[#6B6B6B] uppercase tracking-wide">Type</label>
            <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
              className="w-full mt-1.5 px-2 py-2 rounded-xl border border-[#E8E3DB] text-xs bg-white focus:outline-none">
              {Object.entries(WORK_TYPES).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-[#6B6B6B] uppercase tracking-wide">Duration (min)</label>
            <input type="number" min="0" value={form.duration_minutes}
              onChange={e => setForm(f => ({ ...f, duration_minutes: e.target.value }))}
              placeholder="e.g. 90"
              className="w-full mt-1.5 px-3 py-2 rounded-xl border border-[#E8E3DB] text-sm focus:outline-none focus:ring-2 focus:ring-[#2D7A6B]/30 bg-white" />
            {form.duration_minutes && <p className="text-[10px] text-[#2D7A6B] mt-0.5">= {fmtMins(parseInt(form.duration_minutes) || 0)}</p>}
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold text-[#6B6B6B] uppercase tracking-wide">Date</label>
          <input type="date" value={form.logged_at} onChange={e => setForm(f => ({ ...f, logged_at: e.target.value }))}
            className="w-full mt-1.5 px-3 py-2 rounded-xl border border-[#E8E3DB] text-sm focus:outline-none focus:ring-2 focus:ring-[#2D7A6B]/30 bg-white" />
        </div>
        <div>
          <label className="text-xs font-semibold text-[#6B6B6B] uppercase tracking-wide">Notes</label>
          <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            rows={3} placeholder="Research findings, approach taken..."
            className="w-full mt-1.5 px-3 py-2 rounded-xl border border-[#E8E3DB] text-xs focus:outline-none focus:ring-2 focus:ring-[#2D7A6B]/30 bg-white resize-none font-mono" />
        </div>
        <div>
          <label className="text-xs font-semibold text-[#6B6B6B] uppercase tracking-wide">Proof Links (one per line)</label>
          <textarea value={form.proofs} onChange={e => setForm(f => ({ ...f, proofs: e.target.value }))}
            rows={2} placeholder="https://github.com/org/repo/pull/456"
            className="w-full mt-1.5 px-3 py-2 rounded-xl border border-[#E8E3DB] text-xs focus:outline-none focus:ring-2 focus:ring-[#2D7A6B]/30 bg-white resize-none font-mono" />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose}
            className="px-4 py-2 text-sm text-[#6B6B6B] hover:text-[#1A1A1A]">Cancel</button>
          <button type="submit" disabled={saving || !form.title.trim() || !form.company_id}
            className="bg-[#1B3A2D] text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-[#2a5240] disabled:opacity-40">
            {saving ? 'Saving…' : initial ? 'Save Changes' : 'Log Work'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
