import { useEffect, useState } from 'react'
import {
  getJournalEntries, saveJournalEntry, updateJournalEntry, deleteJournalEntry, getJournalAI,
} from './api'
import MicButton from './components/MicButton'
import AIPolishButton from './components/AIPolishButton'

const MOOD_OPTS = [
  { val: 1, emoji: '😔', label: 'Rough' },
  { val: 2, emoji: '😐', label: 'Okay' },
  { val: 3, emoji: '🙂', label: 'Good' },
  { val: 4, emoji: '😊', label: 'Great' },
  { val: 5, emoji: '🌟', label: 'Amazing' },
]
const ENERGY_OPTS = [
  { val: 1, label: 'Low', color: 'bg-red-100 text-red-600 border-red-200' },
  { val: 2, label: 'Medium', color: 'bg-amber-100 text-amber-600 border-amber-200' },
  { val: 3, label: 'High', color: 'bg-emerald-100 text-emerald-600 border-emerald-200' },
]

const DAYS   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

function todayStr() { return new Date().toISOString().split('T')[0] }

function formatEntryDate(iso) {
  const d = new Date(iso + 'T00:00:00')
  const today = todayStr()
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayStr = yesterday.toISOString().split('T')[0]
  if (iso === today) return 'Today'
  if (iso === yesterdayStr) return 'Yesterday'
  return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`
}

function moodEmoji(val) { return MOOD_OPTS.find(o => o.val === val)?.emoji || '—' }
function energyLabel(val) { return ENERGY_OPTS.find(o => o.val === val)?.label || '—' }
function energyColor(val) { return ENERGY_OPTS.find(o => o.val === val)?.color || 'bg-[#F2EDE4] text-[#6B6B6B] border-[#E8E3DB]' }

// ─── Entry Form ───────────────────────────────────────────────────────────────

function EntryForm({ initial, onSave, onCancel }) {
  const isEdit = !!initial?.id
  const [form, setForm] = useState({
    date: initial?.date || todayStr(),
    mood: initial?.mood || null,
    energy: initial?.energy || null,
    body: initial?.body || '',
    wins: initial?.wins || '',
    improve: initial?.improve || '',
    gratitude: initial?.gratitude || '',
    tags: (initial?.tags || []).join(', '),
  })
  const [saving, setSaving] = useState(false)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const payload = {
        date: form.date,
        mood: form.mood,
        energy: form.energy,
        body: form.body || null,
        wins: form.wins || null,
        improve: form.improve || null,
        gratitude: form.gratitude || null,
        tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
      }
      let result
      if (isEdit) {
        result = await updateJournalEntry(initial.id, payload)
      } else {
        result = await saveJournalEntry(payload)
      }
      onSave(result)
    } catch (err) { alert(err.message) }
    finally { setSaving(false) }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Date */}
      <div className="flex items-center gap-3">
        <input type="date" value={form.date} onChange={e => set('date', e.target.value)}
          className="px-3 py-1.5 rounded-xl border border-[#E8E3DB] text-sm bg-[#F9F6F1] focus:outline-none focus:ring-2 focus:ring-[#2D7A6B]/30" />
        <span className="text-sm text-[#6B6B6B] font-medium">{formatEntryDate(form.date)}</span>
      </div>

      {/* Mood + Energy row */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs font-semibold text-[#6B6B6B] mb-2 uppercase tracking-wide">Mood</p>
          <div className="flex gap-1.5">
            {MOOD_OPTS.map(o => (
              <button key={o.val} type="button" onClick={() => set('mood', form.mood === o.val ? null : o.val)}
                className={`flex-1 flex flex-col items-center py-1.5 rounded-xl border transition-all ${
                  form.mood === o.val
                    ? 'bg-[#1B3A2D] border-[#1B3A2D]'
                    : 'bg-[#F9F6F1] border-[#E8E3DB] hover:border-[#2D7A6B]/40'
                }`}>
                <span className="text-base">{o.emoji}</span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold text-[#6B6B6B] mb-2 uppercase tracking-wide">Energy</p>
          <div className="flex gap-1.5">
            {ENERGY_OPTS.map(o => (
              <button key={o.val} type="button" onClick={() => set('energy', form.energy === o.val ? null : o.val)}
                className={`flex-1 py-2 rounded-xl border text-xs font-semibold transition-all ${
                  form.energy === o.val ? o.color + ' shadow-sm' : 'bg-[#F9F6F1] border-[#E8E3DB] text-[#6B6B6B] hover:border-[#2D7A6B]/40'
                }`}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main entry */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-[#6B6B6B] uppercase tracking-wide">Entry</p>
          <div className="flex items-center gap-1">
            <AIPolishButton value={form.body || ''} onChange={v => set('body', v)} context="journal" />
            <MicButton value={form.body || ''} onChange={v => set('body', v)} />
          </div>
        </div>
        <textarea
          value={form.body}
          onChange={e => set('body', e.target.value)}
          placeholder="What happened today? How did it feel? What are you thinking about?"
          rows={5}
          className="w-full px-3 py-2.5 rounded-xl border border-[#E8E3DB] text-sm bg-[#F9F6F1] focus:outline-none focus:ring-2 focus:ring-[#2D7A6B]/30 resize-none leading-relaxed placeholder:text-[#b5a08a]"
        />
      </div>

      {/* Wins / Improve / Gratitude */}
      <div className="grid grid-cols-1 gap-3">
        <div className="flex items-start gap-3">
          <span className="text-lg mt-2">✦</span>
          <div className="flex-1">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-semibold text-[#6B6B6B] uppercase tracking-wide">Wins</p>
              <div className="flex items-center gap-1">
                <AIPolishButton value={form.wins || ''} onChange={v => set('wins', v)} context="wins" />
                <MicButton value={form.wins || ''} onChange={v => set('wins', v)} />
              </div>
            </div>
            <input value={form.wins} onChange={e => set('wins', e.target.value)}
              placeholder="What went well today?"
              className="w-full px-3 py-2 rounded-xl border border-[#E8E3DB] text-sm bg-[#F9F6F1] focus:outline-none focus:ring-2 focus:ring-[#2D7A6B]/30 placeholder:text-[#b5a08a]" />
          </div>
        </div>
        <div className="flex items-start gap-3">
          <span className="text-lg mt-2">↺</span>
          <div className="flex-1">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-semibold text-[#6B6B6B] uppercase tracking-wide">Improve</p>
              <div className="flex items-center gap-1">
                <AIPolishButton value={form.improve || ''} onChange={v => set('improve', v)} context="improve" />
                <MicButton value={form.improve || ''} onChange={v => set('improve', v)} />
              </div>
            </div>
            <input value={form.improve} onChange={e => set('improve', e.target.value)}
              placeholder="What would you do differently?"
              className="w-full px-3 py-2 rounded-xl border border-[#E8E3DB] text-sm bg-[#F9F6F1] focus:outline-none focus:ring-2 focus:ring-[#2D7A6B]/30 placeholder:text-[#b5a08a]" />
          </div>
        </div>
        <div className="flex items-start gap-3">
          <span className="text-lg mt-2">🤲</span>
          <div className="flex-1">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-semibold text-[#6B6B6B] uppercase tracking-wide">Gratitude</p>
              <div className="flex items-center gap-1">
                <AIPolishButton value={form.gratitude || ''} onChange={v => set('gratitude', v)} context="gratitude" />
                <MicButton value={form.gratitude || ''} onChange={v => set('gratitude', v)} />
              </div>
            </div>
            <input value={form.gratitude} onChange={e => set('gratitude', e.target.value)}
              placeholder="One thing you're grateful for"
              className="w-full px-3 py-2 rounded-xl border border-[#E8E3DB] text-sm bg-[#F9F6F1] focus:outline-none focus:ring-2 focus:ring-[#2D7A6B]/30 placeholder:text-[#b5a08a]" />
          </div>
        </div>
      </div>

      {/* Tags */}
      <div>
        <p className="text-xs font-semibold text-[#6B6B6B] mb-1 uppercase tracking-wide">Tags</p>
        <input value={form.tags} onChange={e => set('tags', e.target.value)}
          placeholder="work, family, health, growth  (comma separated)"
          className="w-full px-3 py-2 rounded-xl border border-[#E8E3DB] text-sm bg-[#F9F6F1] focus:outline-none focus:ring-2 focus:ring-[#2D7A6B]/30 placeholder:text-[#b5a08a]" />
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-1">
        {onCancel && (
          <button type="button" onClick={onCancel}
            className="px-4 py-2 rounded-xl text-sm text-[#6B6B6B] hover:text-[#1A1A1A] border border-[#E8E3DB] hover:border-[#2D7A6B]/30 transition-colors">
            Cancel
          </button>
        )}
        <button type="submit" disabled={saving}
          className="px-5 py-2 rounded-xl text-sm font-semibold bg-[#1B3A2D] text-white hover:bg-[#2a5240] transition-colors disabled:opacity-50">
          {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Save Entry'}
        </button>
      </div>
    </form>
  )
}

// ─── Entry Card ───────────────────────────────────────────────────────────────

function EntryCard({ entry, onEdit, onDelete }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="bg-white border border-[#E8E3DB] rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.06)] overflow-hidden">
      {/* Header row */}
      <div
        className="flex items-center gap-3 px-5 py-4 cursor-pointer hover:bg-[#F9F6F1] transition-colors"
        onClick={() => setExpanded(v => !v)}>
        {/* Date */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-[#1A1A1A]">{formatEntryDate(entry.date)}</span>
            <span className="text-[11px] text-[#b5a08a] font-mono">{entry.date}</span>
          </div>
          {entry.body && (
            <p className="text-xs text-[#6B6B6B] mt-0.5 truncate leading-relaxed">{entry.body}</p>
          )}
        </div>

        {/* Mood + Energy badges */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {entry.mood && (
            <span className="text-xl" title={MOOD_OPTS.find(o => o.val === entry.mood)?.label}>
              {moodEmoji(entry.mood)}
            </span>
          )}
          {entry.energy && (
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg border ${energyColor(entry.energy)}`}>
              {energyLabel(entry.energy)}
            </span>
          )}
          <span className={`text-[#b5a08a] text-sm transition-transform ${expanded ? 'rotate-180' : ''}`}>▾</span>
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="px-5 pb-5 border-t border-[#F2EDE4] space-y-4 pt-4">
          {entry.body && (
            <p className="text-sm text-[#1A1A1A] leading-relaxed whitespace-pre-wrap">{entry.body}</p>
          )}

          <div className="grid grid-cols-1 gap-2">
            {entry.wins && (
              <div className="flex gap-2">
                <span className="text-base flex-shrink-0 mt-0.5">✦</span>
                <div>
                  <p className="text-[10px] font-bold text-[#b5a08a] uppercase tracking-wide">Win</p>
                  <p className="text-sm text-[#1A1A1A]">{entry.wins}</p>
                </div>
              </div>
            )}
            {entry.improve && (
              <div className="flex gap-2">
                <span className="text-base flex-shrink-0 mt-0.5">↺</span>
                <div>
                  <p className="text-[10px] font-bold text-[#b5a08a] uppercase tracking-wide">Improve</p>
                  <p className="text-sm text-[#1A1A1A]">{entry.improve}</p>
                </div>
              </div>
            )}
            {entry.gratitude && (
              <div className="flex gap-2">
                <span className="text-base flex-shrink-0 mt-0.5">🤲</span>
                <div>
                  <p className="text-[10px] font-bold text-[#b5a08a] uppercase tracking-wide">Gratitude</p>
                  <p className="text-sm text-[#1A1A1A]">{entry.gratitude}</p>
                </div>
              </div>
            )}
          </div>

          {entry.tags?.length > 0 && (
            <div className="flex gap-1.5 flex-wrap">
              {entry.tags.map((t, i) => (
                <span key={i} className="text-[11px] px-2 py-0.5 bg-[#F2EDE4] text-[#6B6B6B] rounded-lg">#{t}</span>
              ))}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button onClick={() => onEdit(entry)}
              className="text-xs px-3 py-1.5 rounded-lg border border-[#E8E3DB] text-[#6B6B6B] hover:border-[#2D7A6B]/40 hover:text-[#2D7A6B] transition-colors">
              Edit
            </button>
            <button onClick={() => { if (confirm('Delete this entry?')) onDelete(entry.id) }}
              className="text-xs px-3 py-1.5 rounded-lg border border-[#E8E3DB] text-[#6B6B6B] hover:border-red-300 hover:text-red-500 transition-colors">
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main Journal Page ────────────────────────────────────────────────────────

export default function JournalPage() {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editEntry, setEditEntry] = useState(null)
  const [aiInsight, setAiInsight] = useState(null)
  const [aiLoading, setAiLoading] = useState(false)

  async function load() {
    try {
      const data = await getJournalEntries(60)
      setEntries(data)
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  function handleSaved(entry) {
    setEntries(prev => {
      const idx = prev.findIndex(e => e.id === entry.id)
      if (idx >= 0) {
        const next = [...prev]; next[idx] = entry; return next
      }
      return [entry, ...prev]
    })
    setShowForm(false)
    setEditEntry(null)
  }

  async function handleDelete(id) {
    await deleteJournalEntry(id)
    setEntries(prev => prev.filter(e => e.id !== id))
  }

  async function handleAI() {
    setAiLoading(true)
    try {
      const data = await getJournalAI()
      setAiInsight(data.insight)
    } catch (err) { alert(err.message) }
    finally { setAiLoading(false) }
  }

  const todayEntry = entries.find(e => e.date === todayStr())
  const pastEntries = entries.filter(e => e.date !== todayStr())

  if (loading) return <div className="flex items-center justify-center h-64 text-[#6B6B6B]">Loading…</div>

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[11px] font-bold text-[#6B6B6B] uppercase tracking-widest mb-1">بَصِيرَة</p>
          <h1 className="text-3xl font-bold text-[#1A1A1A]">Journal</h1>
          <p className="text-sm text-[#6B6B6B] mt-0.5">{entries.length} {entries.length === 1 ? 'entry' : 'entries'}</p>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <button onClick={handleAI} disabled={aiLoading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-violet-200 text-violet-700 bg-violet-50 text-sm font-medium hover:bg-violet-100 transition-colors disabled:opacity-50">
            {aiLoading ? '…' : '✨ Reflect'}
          </button>
          <button onClick={() => { setEditEntry(null); setShowForm(true) }}
            className="bg-[#1B3A2D] text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-[#2a5240] transition-colors shadow-sm">
            + New Entry
          </button>
        </div>
      </div>

      {/* AI Insight */}
      {aiInsight && (
        <div className="bg-violet-50 border border-violet-100 rounded-2xl p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex gap-3">
              <span className="text-xl flex-shrink-0">✨</span>
              <div>
                <p className="text-xs font-bold text-violet-700 uppercase tracking-wide mb-1">AI Reflection · Last 14 days</p>
                <p className="text-sm text-violet-900 leading-relaxed">{aiInsight}</p>
              </div>
            </div>
            <button onClick={() => setAiInsight(null)} className="text-violet-300 hover:text-violet-500 flex-shrink-0">✕</button>
          </div>
        </div>
      )}

      {/* New / Edit form */}
      {(showForm || editEntry) && (
        <div className="bg-white border border-[#E8E3DB] rounded-2xl p-6 shadow-[0_1px_3px_rgba(0,0,0,0.07)]">
          <p className="text-[11px] font-bold text-[#6B6B6B] uppercase tracking-widest mb-4">
            {editEntry ? 'Edit Entry' : "Today's Entry"}
          </p>
          <EntryForm
            initial={editEntry}
            onSave={handleSaved}
            onCancel={() => { setShowForm(false); setEditEntry(null) }}
          />
        </div>
      )}

      {/* Today's entry card (if exists and not editing) */}
      {todayEntry && !editEntry && (
        <div>
          <div className="flex items-center gap-3 mb-3">
            <p className="text-[11px] font-bold text-[#1A1A1A] uppercase tracking-widest whitespace-nowrap">Today</p>
            <span className="flex-1 border-t border-[#E8E3DB]" />
          </div>
          <EntryCard
            entry={todayEntry}
            onEdit={e => { setEditEntry(e); setShowForm(false) }}
            onDelete={handleDelete}
          />
        </div>
      )}

      {/* Past entries */}
      {pastEntries.length > 0 && (
        <div>
          <div className="flex items-center gap-3 mb-3">
            <p className="text-[11px] font-bold text-[#1A1A1A] uppercase tracking-widest whitespace-nowrap">Past Entries</p>
            <span className="flex-1 border-t border-[#E8E3DB]" />
          </div>
          <div className="space-y-2">
            {pastEntries.map(e => (
              <EntryCard
                key={e.id}
                entry={e}
                onEdit={entry => { setEditEntry(entry); setShowForm(false) }}
                onDelete={handleDelete}
              />
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {entries.length === 0 && !showForm && (
        <div className="text-center py-20">
          <p className="text-5xl mb-4">📖</p>
          <h2 className="text-xl font-bold text-[#1A1A1A] mb-2">Your journal is empty</h2>
          <p className="text-sm text-[#6B6B6B] mb-6 max-w-sm mx-auto leading-relaxed">
            Start writing. Even one sentence a day creates a powerful record of who you are and who you're becoming.
          </p>
          <button onClick={() => setShowForm(true)}
            className="bg-[#1B3A2D] text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#2a5240] transition-colors">
            Write First Entry
          </button>
        </div>
      )}
    </div>
  )
}
