import { useEffect, useRef, useState } from 'react'
import {
  getDailySchedule, addToSchedule, removeFromSchedule, createScheduleItem,
  completeScheduleItem, reorderSchedule, setScheduleTime, addDailyTask, pinTask,
  getGoals, getGoal, getCompanies, getWorkTickets, getToday,
} from './api'
import Modal from './components/Modal'
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core'
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

const TYPE_BADGE = {
  task:    { label: 'TASK',  color: '#1B3A2D' },
  habit:   { label: 'HABIT', color: '#E8C334' },
  ticket:  { label: 'WORK',  color: '#2D7A6B' },
  worklog: { label: 'LOG',   color: '#6B6B6B' },
}

function itemKey(item) { return `${item.kind}:${item.id}` }

function fmtTime12(hhmm) {
  if (!hhmm) return null
  const [h, m] = hhmm.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const dh = h % 12 || 12
  return `${dh}:${String(m).padStart(2, '0')} ${period}`
}

function SortableRow({ item, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: itemKey(item) })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    position: 'relative',
    zIndex: isDragging ? 50 : 'auto',
  }
  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      {children(listeners)}
    </div>
  )
}

function TimeChip({ item, onSetTime }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(item.scheduled_time || '')
  const inputRef = useRef(null)

  useEffect(() => {
    if (editing) setTimeout(() => inputRef.current?.focus(), 30)
  }, [editing])

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="time"
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={() => { setEditing(false); onSetTime(item, value || null) }}
        onKeyDown={e => { if (e.key === 'Enter') { setEditing(false); onSetTime(item, value || null) } }}
        className="text-[11px] border border-[#2D7A6B] rounded-lg px-1.5 py-0.5 w-[88px] flex-shrink-0 focus:outline-none"
        onClick={e => e.stopPropagation()}
      />
    )
  }

  return (
    <button
      onClick={(e) => { e.stopPropagation(); setEditing(true) }}
      className={`text-[10px] font-semibold rounded-lg px-1.5 py-0.5 flex-shrink-0 tabular-nums transition-colors ${
        item.scheduled_time
          ? 'bg-[#1B3A2D] text-white'
          : 'text-[#b5a08a] hover:bg-[#F2EDE4] hover:text-[#6B6B6B] border border-dashed border-[#E8E3DB]'
      }`}>
      {item.scheduled_time ? fmtTime12(item.scheduled_time) : '+ time'}
    </button>
  )
}

function ScheduleRow({ item, listeners, onToggle, onRemove, onSetTime, onPinToFocus }) {
  const badge = TYPE_BADGE[item.kind] || TYPE_BADGE.task
  return (
    <div className={`group flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all ${
      item.done ? 'bg-[#F9F6F1] border-[#E8E3DB]' : 'bg-white border-[#E8E3DB] hover:border-[#2D7A6B]/30'
    }`}>
      <button {...listeners} type="button"
        className="cursor-grab active:cursor-grabbing text-[#E8E3DB] hover:text-[#b5a08a] flex-shrink-0 touch-none select-none text-sm">
        ⠿
      </button>

      <TimeChip item={item} onSetTime={onSetTime} />

      <button onClick={() => onToggle(item)}
        className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
          item.done ? 'bg-[#2D7A6B] border-[#2D7A6B] text-white' : 'border-[#E8E3DB] hover:border-[#2D7A6B]'
        }`}>
        {item.done && <span className="text-[10px] leading-none">✓</span>}
      </button>

      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md text-white flex-shrink-0"
        style={{ backgroundColor: badge.color, color: item.kind === 'habit' ? '#1A1A1A' : 'white' }}>
        {badge.label}
      </span>

      <span className={`flex-1 text-sm truncate ${item.done ? 'line-through text-[#b5a08a]' : 'text-[#1A1A1A]'}`}>
        {item.title}
      </span>

      {item.company_name && (
        <span className="text-[10px] px-1.5 py-0.5 rounded-md flex-shrink-0"
          style={{ backgroundColor: `${item.company_color || '#6B6B6B'}1A`, color: item.company_color || '#6B6B6B' }}>
          {item.company_name}
        </span>
      )}
      {item.goal_title && (
        <span className="text-[10px] text-[#6B6B6B] bg-[#F2EDE4] px-1.5 py-0.5 rounded-md flex-shrink-0">
          {item.goal_title}
        </span>
      )}
      {item.is_urgent && (
        <span className="text-[9px] font-semibold text-red-500 flex-shrink-0">URGENT</span>
      )}
      {item.estimated_minutes > 0 && (
        <span className="text-[10px] text-[#b5a08a] flex-shrink-0 tabular-nums">{item.estimated_minutes}m</span>
      )}

      {item.kind === 'task' && !item.done && (
        <button onClick={() => onPinToFocus(item)} title="Add to Focus"
          className="opacity-0 group-hover:opacity-100 text-[#b5a08a] hover:text-[#E8C334] transition-all text-sm flex-shrink-0 w-5 h-5 flex items-center justify-center">
          ✦
        </button>
      )}

      {!item.is_daily ? (
        <button onClick={() => onRemove(item)}
          className="opacity-0 group-hover:opacity-100 text-[#b5a08a] hover:text-red-400 transition-all text-sm flex-shrink-0 w-5 h-5 flex items-center justify-center">
          ✕
        </button>
      ) : (
        <span className="w-5 h-5 flex-shrink-0" title="Always part of today" />
      )}
    </div>
  )
}

export default function DailySchedule() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [showPicker, setShowPicker] = useState(false)
  const [quickAdd, setQuickAdd] = useState('')
  const [adding, setAdding] = useState(false)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  async function load() {
    try {
      const data = await getDailySchedule()
      setItems(data)
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  async function handleQuickAdd(e) {
    e.preventDefault()
    if (!quickAdd.trim()) return
    setAdding(true)
    try {
      await addDailyTask(quickAdd.trim())
      setQuickAdd('')
      load()
    } catch (err) { alert(err.message) }
    finally { setAdding(false) }
  }

  async function handleToggle(item) {
    setItems(prev => prev.map(i => i.id === item.id && i.kind === item.kind ? { ...i, done: !i.done } : i))
    try { await completeScheduleItem(item.kind, item.id, !item.done) }
    catch (err) { alert(err.message); load() }
  }

  async function handleRemove(item) {
    setItems(prev => prev.filter(i => !(i.id === item.id && i.kind === item.kind)))
    try { await removeFromSchedule(item.kind, item.id) }
    catch (err) { alert(err.message); load() }
  }

  async function handleSetTime(item, time) {
    setItems(prev => {
      const next = prev.map(i => i.id === item.id && i.kind === item.kind ? { ...i, scheduled_time: time } : i)
      // Re-sort: timed items first by time, then untimed by their existing order
      return [...next].sort((a, b) => {
        if (a.scheduled_time && b.scheduled_time) return a.scheduled_time.localeCompare(b.scheduled_time)
        if (a.scheduled_time) return -1
        if (b.scheduled_time) return 1
        return (a.sort_order ?? 0) - (b.sort_order ?? 0)
      })
    })
    try { await setScheduleTime(item.kind, item.id, time) }
    catch (err) { alert(err.message); load() }
  }

  async function handlePinToFocus(item) {
    const today = new Date().toISOString().split('T')[0]
    setItems(prev => prev.filter(i => !(i.id === item.id && i.kind === item.kind)))
    try {
      await pinTask(item.id, today)
      window.dispatchEvent(new CustomEvent('basira:task-updated', { detail: { taskId: item.id } }))
    } catch (err) { alert(err.message); load() }
  }

  async function handleDragEnd(event) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIdx = items.findIndex(i => itemKey(i) === active.id)
    const newIdx = items.findIndex(i => itemKey(i) === over.id)
    const reordered = arrayMove(items, oldIdx, newIdx)
    setItems(reordered)
    try {
      await reorderSchedule(reordered.map((item, i) => ({ id: item.id, kind: item.kind, sort_order: i * 10 })))
    } catch { /* silently fail — local order already applied */ }
  }

  const doneCount = items.filter(i => i.done).length
  const pct = items.length > 0 ? Math.round((doneCount / items.length) * 100) : 0

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold text-[#1A1A1A]">Daily Schedule</h2>
          <p className="text-xs text-[#6B6B6B] mt-0.5">Set a time for when you'll work on each — cross off as you go</p>
        </div>
        <button onClick={() => setShowPicker(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#1B3A2D] text-white text-sm font-semibold hover:bg-[#2a5240] transition-colors">
          <span className="text-base leading-none">+</span> Add to Schedule
        </button>
      </div>

      <form onSubmit={handleQuickAdd} className="flex items-center gap-2 mb-3">
        <input value={quickAdd} onChange={e => setQuickAdd(e.target.value)}
          placeholder="Quick add a todo…"
          className="flex-1 text-sm border border-[#E8E3DB] rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#2D7A6B] bg-white placeholder:text-[#b5a08a]" />
        <button type="submit" disabled={!quickAdd.trim() || adding}
          className="text-sm bg-white border border-[#E8E3DB] text-[#1A1A1A] px-3 py-2 rounded-xl hover:border-[#2D7A6B] disabled:opacity-30 transition-colors">
          Add
        </button>
      </form>

      {items.length > 0 && (
        <div className="flex items-center gap-2 mb-3">
          <div className="flex-1 bg-[#E8E3DB] rounded-full h-1.5 overflow-hidden">
            <div className="h-full bg-[#2D7A6B] rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-xs text-[#6B6B6B] font-medium flex-shrink-0">{doneCount}/{items.length}</span>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-[#b5a08a] py-6 text-center">Loading…</p>
      ) : items.length === 0 ? (
        <div className="border-2 border-dashed border-[#E8E3DB] rounded-2xl py-10 text-center">
          <p className="text-sm text-[#6B6B6B] mb-2">Nothing scheduled yet today</p>
          <button onClick={() => setShowPicker(true)} className="text-sm text-[#2D7A6B] font-medium hover:underline">
            Add your first item
          </button>
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={items.map(itemKey)} strategy={verticalListSortingStrategy}>
            <div className="space-y-1.5">
              {items.map(item => (
                <SortableRow key={itemKey(item)} item={item}>
                  {listeners => (
                    <ScheduleRow item={item} listeners={listeners} onToggle={handleToggle} onRemove={handleRemove} onSetTime={handleSetTime} onPinToFocus={handlePinToFocus} />
                  )}
                </SortableRow>
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {showPicker && (
        <SchedulePicker
          scheduledIds={new Set(items.map(itemKey))}
          onAdded={() => { setShowPicker(false); load() }}
          onClose={() => setShowPicker(false)}
        />
      )}
    </section>
  )
}

// ─── Picker Modal ───────────────────────────────────────────────────────────

function SchedulePicker({ scheduledIds, onAdded, onClose }) {
  const [tab, setTab] = useState('create')   // 'create' | 'tasks' | 'work'
  const [goals, setGoals] = useState([])
  const [companies, setCompanies] = useState([])
  const [tickets, setTickets] = useState([])
  const [habits, setHabits] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  // Create form state
  const [newKind, setNewKind] = useState('task')
  const [newTitle, setNewTitle] = useState('')
  const [newGoalId, setNewGoalId] = useState('')
  const [newCompanyId, setNewCompanyId] = useState('')
  const [creating, setCreating] = useState(false)
  const inputRef = useRef(null)

  // Browsable task list (per-goal tasks fetched lazily)
  const [goalTasks, setGoalTasks] = useState({})  // goalId -> tasks[]

  useEffect(() => {
    Promise.all([getGoals(), getCompanies(), getWorkTickets(), getToday()])
      .then(([gs, cs, ts, todayData]) => {
        setGoals(gs)
        setCompanies(cs)
        setTickets(ts)
        setHabits(todayData.habits || [])
        if (gs.length > 0) setNewGoalId(gs[0].id)
        if (cs.length > 0) setNewCompanyId(cs[0].id)
      })
      .catch(err => alert(err.message))
      .finally(() => setLoading(false))
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [])

  useEffect(() => {
    if (tab !== 'tasks') return
    goals.forEach(g => {
      if (!goalTasks[g.id]) {
        getGoal(g.id).then(full => {
          setGoalTasks(prev => ({ ...prev, [g.id]: full.tasks.filter(t => t.status === 'todo' && !t.parent_task_id) }))
        }).catch(() => {})
      }
    })
  }, [tab, goals])

  async function handleCreate(e) {
    e.preventDefault()
    if (!newTitle.trim()) return
    if (newKind === 'task' && !newGoalId) return
    if (newKind !== 'task' && !newCompanyId) return
    setCreating(true)
    try {
      await createScheduleItem({
        kind: newKind === 'log' ? 'worklog' : newKind,
        title: newTitle.trim(),
        goal_id: newKind === 'task' ? newGoalId : undefined,
        company_id: newKind !== 'task' ? newCompanyId : undefined,
      })
      onAdded()
    } catch (err) { alert(err.message) }
    finally { setCreating(false) }
  }

  async function handleAddExisting(kind, id) {
    try {
      await addToSchedule(kind, id)
      onAdded()
    } catch (err) { alert(err.message) }
  }

  const q = search.trim().toLowerCase()
  const filteredTickets = tickets.filter(t =>
    t.status !== 'done' && !scheduledIds.has(`ticket:${t.id}`) && (!q || t.title.toLowerCase().includes(q))
  )
  const availableHabits = habits.filter(h => !scheduledIds.has(`habit:${h.id}`) && !h.checked_today)

  return (
    <Modal title="Add to Daily Schedule" onClose={onClose}>
      <div className="space-y-3 min-w-[420px]">

        {/* Tabs */}
        <div className="flex gap-1.5 border-b border-[#E8E3DB] pb-2">
          {[
            { key: 'create', label: '+ Create New' },
            { key: 'tasks',  label: 'From Goals' },
            { key: 'work',   label: 'From Work' },
          ].map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
                tab === t.key ? 'bg-[#1B3A2D] text-white' : 'text-[#6B6B6B] hover:bg-[#F2EDE4]'
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Create New ── */}
        {tab === 'create' && (
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="flex gap-1.5">
              {[
                { key: 'task', label: 'Task' },
                { key: 'ticket', label: 'Work Ticket' },
                { key: 'log', label: 'Quick Log' },
              ].map(k => (
                <button key={k.key} type="button" onClick={() => setNewKind(k.key)}
                  className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-colors border ${
                    newKind === k.key ? 'bg-[#2D7A6B] text-white border-[#2D7A6B]' : 'border-[#E8E3DB] text-[#6B6B6B] hover:border-[#2D7A6B]/40'
                  }`}>
                  {k.label}
                </button>
              ))}
            </div>

            <input ref={inputRef} value={newTitle} onChange={e => setNewTitle(e.target.value)}
              placeholder="What needs to be done?"
              className="w-full border border-[#E8E3DB] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2D7A6B] bg-white placeholder:text-[#b5a08a]" />

            {newKind === 'task' ? (
              <select value={newGoalId} onChange={e => setNewGoalId(e.target.value)}
                className="w-full border border-[#E8E3DB] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2D7A6B] bg-white text-[#1A1A1A]">
                {goals.map(g => <option key={g.id} value={g.id}>{g.title}</option>)}
              </select>
            ) : (
              <select value={newCompanyId} onChange={e => setNewCompanyId(e.target.value)}
                className="w-full border border-[#E8E3DB] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2D7A6B] bg-white text-[#1A1A1A]"
                disabled={companies.length === 0}>
                {companies.length === 0
                  ? <option>No companies yet — add one in Work</option>
                  : companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}

            <button type="submit" disabled={creating || !newTitle.trim() || (newKind === 'task' ? !newGoalId : !newCompanyId)}
              className="w-full py-2.5 rounded-xl bg-[#1B3A2D] text-white text-sm font-semibold hover:bg-[#2a5240] disabled:opacity-40 transition-colors">
              {creating ? 'Adding…' : 'Add to Schedule'}
            </button>
          </form>
        )}

        {/* ── From Goals ── */}
        {tab === 'tasks' && (
          <div className="space-y-4 max-h-72 overflow-y-auto -mx-1 px-1">
            {loading ? (
              <p className="text-sm text-[#b5a08a] text-center py-4">Loading…</p>
            ) : (
              <>
                {availableHabits.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-[#E8C334] uppercase tracking-wide mb-1.5">Habits</p>
                    <div className="space-y-0.5">
                      {availableHabits.map(h => (
                        <button key={h.id} onClick={() => handleAddExisting('habit', h.id)}
                          className="w-full text-left px-3 py-2 rounded-xl hover:bg-[#E8C334]/10 text-sm text-[#1A1A1A] transition-colors flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#E8C334] flex-shrink-0" />
                          {h.title}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {goals.length === 0 ? (
                  <p className="text-sm text-[#6B6B6B] italic text-center py-4">No goals yet</p>
                ) : (
                  goals.map(g => {
                    const tasksForGoal = (goalTasks[g.id] || []).filter(t => !scheduledIds.has(`task:${t.id}`))
                    if (tasksForGoal.length === 0) return null
                    return (
                      <div key={g.id}>
                        <p className="text-xs font-semibold text-[#6B6B6B] uppercase tracking-wide mb-1.5">{g.title}</p>
                        <div className="space-y-0.5">
                          {tasksForGoal.map(t => (
                            <button key={t.id} onClick={() => handleAddExisting('task', t.id)}
                              className="w-full text-left px-3 py-2 rounded-xl hover:bg-[#2D7A6B]/10 text-sm text-[#1A1A1A] transition-colors flex items-center gap-2">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#E8E3DB] flex-shrink-0" />
                              {t.title}
                            </button>
                          ))}
                        </div>
                      </div>
                    )
                  })
                )}
              </>
            )}
          </div>
        )}

        {/* ── From Work ── */}
        {tab === 'work' && (
          <div className="space-y-2">
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search tickets…"
              className="w-full border border-[#E8E3DB] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2D7A6B] bg-white placeholder:text-[#b5a08a]" />
            <div className="max-h-64 overflow-y-auto space-y-0.5 -mx-1 px-1">
              {loading ? (
                <p className="text-sm text-[#b5a08a] text-center py-4">Loading…</p>
              ) : filteredTickets.length === 0 ? (
                <p className="text-sm text-[#6B6B6B] italic text-center py-4">No matching work tickets</p>
              ) : (
                filteredTickets.map(t => (
                  <button key={t.id} onClick={() => handleAddExisting('ticket', t.id)}
                    className="w-full text-left px-3 py-2 rounded-xl hover:bg-[#2D7A6B]/10 text-sm text-[#1A1A1A] transition-colors flex items-center gap-2">
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md text-white flex-shrink-0"
                      style={{ backgroundColor: t.company_color || '#2D7A6B' }}>
                      {t.company_name || 'WORK'}
                    </span>
                    <span className="flex-1 truncate">{t.title}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
