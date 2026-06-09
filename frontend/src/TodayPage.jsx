import { useEffect, useRef, useState } from 'react'
import {
  addDailyTask, addProof, checkinHabit, completeTask, createTask,
  deleteTask, deferTask, getToday, getTimerToday, logManualTime,
  pinTask, planTask, reorderTasks, uncheckinHabit, unpinTask, unplanTask,
  uploadProofFile, uploadProofImage, updateTask,
  getTodayCheckin, saveMorningCheckin, saveEveningCheckin,
} from './api'
import MicButton from './components/MicButton'
import { ProofForm, TaskTags } from './GoalPage'
import { useTimer } from './TimerContext'
import PlannerView from './PlannerView'
import Modal from './components/Modal'
import { ActivityComments } from './components/ActivityComposer'
import TimeLogModal from './components/TimeLogModal'
import { getDueDateMeta, sortByDueDate } from './utils'
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core'
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

function SortableItem({ id, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
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

function DragHandle({ listeners }) {
  return (
    <button
      {...listeners}
      type="button"
      className="cursor-grab active:cursor-grabbing text-sand-200 hover:text-sand-400 flex-shrink-0 px-1 touch-none select-none"
      title="Drag to reorder"
    >
      ⠿
    </button>
  )
}

const DAYS   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function formatDate(iso) {
  const d = new Date(iso + 'T00:00:00')
  return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`
}
function tomorrow() {
  const d = new Date(); d.setDate(d.getDate() + 1)
  return d.toISOString().split('T')[0]
}
function parseFreq(f = 'daily') {
  if (!f || f === 'daily') return { perDay: 1, label: null }
  const dm = f.match(/^(\d+)x_day$/)
  if (dm) return { perDay: parseInt(dm[1]), label: `${dm[1]}× day` }
  const wm = f.match(/^(\d+)x_week$/)
  if (wm) return { perDay: 1, label: wm[1] === '1' ? 'Weekly' : `${wm[1]}× week` }
  return { perDay: 1, label: null }
}
function SectionLabel({ children, right }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <p className="text-[11px] font-bold text-[#1A1A1A] uppercase tracking-widest whitespace-nowrap">{children}</p>
      <span className="flex-1 border-t border-[#E8E3DB]" />
      {right && <span className="text-[11px] text-[#6B6B6B] flex-shrink-0">{right}</span>}
    </div>
  )
}

function getSuggestions(daily, projects, today, focusIds) {
  const candidates = []
  for (const task of daily) {
    if (focusIds.has(task.id)) continue
    const score = task.due_date && task.due_date < today ? 100 : task.due_date === today ? 50 : 10
    candidates.push({ task, score, source: 'Todos' })
  }
  for (const p of projects) {
    for (const task of p.tasks) {
      if (focusIds.has(task.id)) continue
      const score = task.due_date && task.due_date < today ? 100 : task.due_date === today ? 50 : 5
      candidates.push({ task, score, source: p.goal_title })
    }
  }
  return candidates.sort((a, b) => b.score - a.score).slice(0, 3)
}

const MOOD_OPTS = [
  { val: 1, emoji: '😔', label: 'Rough' },
  { val: 2, emoji: '😐', label: 'Okay' },
  { val: 3, emoji: '🙂', label: 'Good' },
  { val: 4, emoji: '😊', label: 'Great' },
  { val: 5, emoji: '🌟', label: 'Amazing' },
]

function DailyCheckinCard({ onCheckinSaved }) {
  const hour = new Date().getHours()
  const isEvening = hour >= 17
  const [checkin, setCheckin] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  // Morning form state
  const [energy, setEnergy] = useState(3)
  const [intention, setIntention] = useState('')

  // Evening form state
  const [mood, setMood] = useState(3)
  const [rating, setRating] = useState(3)
  const [reflection, setReflection] = useState('')

  useEffect(() => {
    getTodayCheckin().then(c => { setCheckin(c); setLoading(false) }).catch(() => setLoading(false))
  }, [])

  if (loading) return null

  const morningDone = checkin?.morning_energy != null
  const eveningDone = checkin?.evening_mood != null

  // Don't show if today's relevant check-in is already done, or dismissed
  if (dismissed) return null
  if (!isEvening && morningDone) return null
  if (isEvening && eveningDone) return null

  async function handleMorning(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const updated = await saveMorningCheckin({ energy, intention })
      setCheckin(updated)
      onCheckinSaved?.(updated)
    } catch (err) { alert(err.message) }
    finally { setSaving(false) }
  }

  async function handleEvening(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const updated = await saveEveningCheckin({ mood, rating, reflection })
      setCheckin(updated)
      onCheckinSaved?.(updated)
    } catch (err) { alert(err.message) }
    finally { setSaving(false) }
  }

  if (!isEvening) {
    // ── Morning check-in ──
    return (
      <div className="bg-gradient-to-br from-[#1B3A2D] to-[#2D7A6B] rounded-2xl p-5 text-white shadow-md">
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-0.5">Morning Check-in ☀️</p>
            <h3 className="text-lg font-bold">What kind of day do you want?</h3>
          </div>
          <button onClick={() => setDismissed(true)} className="text-white/40 hover:text-white/70 text-lg leading-none mt-0.5">✕</button>
        </div>

        <form onSubmit={handleMorning} className="space-y-4">
          {/* Energy */}
          <div>
            <p className="text-xs font-semibold text-white/70 mb-2">Energy level</p>
            <div className="flex gap-2">
              {[1,2,3,4,5].map(v => (
                <button key={v} type="button" onClick={() => setEnergy(v)}
                  className={`flex-1 py-2 rounded-xl text-sm font-bold transition-all border ${
                    energy === v
                      ? 'bg-white text-[#1B3A2D] border-white shadow-sm'
                      : 'bg-white/10 border-white/20 text-white/70 hover:bg-white/20'
                  }`}>
                  {v}
                </button>
              ))}
            </div>
            <div className="flex justify-between text-[10px] text-white/40 mt-1 px-1">
              <span>Low</span><span>High</span>
            </div>
          </div>

          {/* Intention */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-white/70">Intention</p>
              <MicButton value={intention} onChange={setIntention}
                className="!text-white/60 hover:!text-white hover:!bg-white/10 !border-transparent" />
            </div>
            <input
              value={intention}
              onChange={e => setIntention(e.target.value)}
              placeholder="What would make today great?"
              className="w-full bg-white/10 border border-white/20 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-white/40 focus:outline-none focus:bg-white/20 transition-colors"
            />
          </div>

          <button type="submit" disabled={saving}
            className="w-full bg-white text-[#1B3A2D] font-bold py-2.5 rounded-xl text-sm hover:bg-white/90 transition-colors disabled:opacity-60">
            {saving ? 'Saving…' : 'Start My Day →'}
          </button>
        </form>
      </div>
    )
  }

  // ── Evening check-in ──
  return (
    <div className="bg-gradient-to-br from-[#1A1A2E] to-[#1B3A2D] rounded-2xl p-5 text-white shadow-md">
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-0.5">Evening Reflection 🌙</p>
          <h3 className="text-lg font-bold">How was today?</h3>
        </div>
        <button onClick={() => setDismissed(true)} className="text-white/40 hover:text-white/70 text-lg leading-none mt-0.5">✕</button>
      </div>

      <form onSubmit={handleEvening} className="space-y-4">
        {/* Mood */}
        <div>
          <p className="text-xs font-semibold text-white/70 mb-2">How do you feel?</p>
          <div className="flex gap-2">
            {MOOD_OPTS.map(o => (
              <button key={o.val} type="button" onClick={() => setMood(o.val)}
                className={`flex-1 flex flex-col items-center py-2 rounded-xl transition-all border ${
                  mood === o.val
                    ? 'bg-white border-white shadow-sm'
                    : 'bg-white/10 border-white/20 hover:bg-white/20'
                }`}>
                <span className="text-lg">{o.emoji}</span>
                <span className={`text-[9px] font-semibold mt-0.5 ${mood === o.val ? 'text-[#1B3A2D]' : 'text-white/50'}`}>{o.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Day rating */}
        <div>
          <p className="text-xs font-semibold text-white/70 mb-2">Rate the day</p>
          <div className="flex gap-2">
            {[1,2,3,4,5].map(v => (
              <button key={v} type="button" onClick={() => setRating(v)}
                className={`flex-1 py-2 rounded-xl text-sm font-bold transition-all border ${
                  rating === v
                    ? 'bg-[#E8C334] text-[#1A1A1A] border-[#E8C334] shadow-sm'
                    : 'bg-white/10 border-white/20 text-white/70 hover:bg-white/20'
                }`}>
                {v}
              </button>
            ))}
          </div>
          <div className="flex justify-between text-[10px] text-white/40 mt-1 px-1">
            <span>Tough</span><span>Excellent</span>
          </div>
        </div>

        {/* Reflection */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-white/70">One-line reflection</p>
            <MicButton value={reflection} onChange={setReflection}
              className="!text-white/60 hover:!text-white hover:!bg-white/10 !border-transparent" />
          </div>
          <input
            value={reflection}
            onChange={e => setReflection(e.target.value)}
            placeholder="What stood out today?"
            className="w-full bg-white/10 border border-white/20 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-white/40 focus:outline-none focus:bg-white/20 transition-colors"
          />
        </div>

        <button type="submit" disabled={saving}
          className="w-full bg-[#E8C334] text-[#1A1A1A] font-bold py-2.5 rounded-xl text-sm hover:bg-[#d4b02e] transition-colors disabled:opacity-60">
          {saving ? 'Saving…' : 'Close the Day ✦'}
        </button>
      </form>
    </div>
  )
}

export default function TodayPage({ onGoToGoal, onOpenReview }) {
  const { startTimer } = useTimer()
  const [data, setData]   = useState(null)
  const [loading, setLoading] = useState(true)
  const focusOrderRef = useRef([])
  const [quickAdd, setQuickAdd] = useState('')
  const [addingSubtaskFor, setAddingSubtaskFor] = useState(null) // parent task id
  const [subtaskTitle, setSubtaskTitle] = useState('')
  const [todaySeconds, setTodaySeconds]     = useState({})   // taskId → seconds logged today
  const [timeLogFor, setTimeLogFor]         = useState(null) // task waiting for manual time entry
  const [proofFor, setProofFor]             = useState(null) // task needing proof to complete
  const [habitProofFor, setHabitProofFor]   = useState(null) // habit needing proof to check in
  const [proofForm, setProofForm]           = useState({ type: 'text', content: '', imageFile: null, imagePreview: null })
  const [submitting, setSubmitting]         = useState(false)
  const quickAddRef = useRef(null)
  const [planItems, setPlanItems]           = useState(null) // null = derive from data
  const [viewMode, setViewMode]             = useState('list') // 'list' | 'planner'
  const planSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  function resetProofForm() { setProofForm({ type: 'text', content: '', imageFile: null, imagePreview: null }) }
  function handleImageSelect(e) {
    const file = e.target.files?.[0]; if (!file) return
    setProofForm(p => ({ ...p, imageFile: file, imagePreview: URL.createObjectURL(file) }))
  }
  function handleFileSelect(e) {
    const file = e.target.files?.[0]; if (!file) return
    setProofForm(p => ({ ...p, imageFile: file }))
  }

  async function load() {
    try {
      const [d, timerData] = await Promise.all([getToday(), getTimerToday().catch(() => ({ tasks: [] }))])
      // Preserve focus order across refreshes — only reorder when pins change
      const prevOrder = focusOrderRef.current
      const incomingIds = new Set(d.focus.map(t => t.id))
      const prevIds = prevOrder.map(t => t.id)
      const sameSet = prevIds.length === d.focus.length && prevIds.every(id => incomingIds.has(id))
      if (sameSet) {
        d.focus = prevIds.map(id => d.focus.find(t => t.id === id))
      }
      focusOrderRef.current = d.focus
      setData(d)
      const secs = {}
      for (const e of (timerData.tasks || [])) secs[e.task_id] = e.seconds
      setTodaySeconds(secs)
    } catch (err) { alert(err.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  // Refresh when the timer overlay adds a comment/proof to any task
  useEffect(() => {
    function onTaskUpdated() { load() }
    window.addEventListener('basira:task-updated', onTaskUpdated)
    return () => window.removeEventListener('basira:task-updated', onTaskUpdated)
  }, [])

  async function handlePlanDragEnd(event, currentItems) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIdx = currentItems.findIndex(t => t.id === active.id)
    const newIdx = currentItems.findIndex(t => t.id === over.id)
    const reordered = arrayMove(currentItems, oldIdx, newIdx)
    setPlanItems(reordered)
    try {
      await reorderTasks(reordered.map((item, i) => ({ id: item.id, sort_order: i * 10 })))
    } catch { /* silently fail — local order already applied */ }
  }

  async function handleQuickAdd(e) {
    e.preventDefault()
    if (!quickAdd.trim()) return
    try { await addDailyTask(quickAdd.trim()); setQuickAdd(''); load() }
    catch (err) { alert(err.message) }
  }
  async function handleToggleHabit(habit) {
    if (!habit.checked_today && habit.requires_proof && !habit.has_proof_today) {
      setHabitProofFor(habit); return
    }
    try {
      habit.checked_today ? await uncheckinHabit(habit.id) : await checkinHabit(habit.id)
      load()
    } catch (err) { alert(err.message) }
  }
  async function handleComplete(task) {
    if (task.requires_proof && (!task.proofs || task.proofs.length === 0)) { setProofFor(task); return }
    // If no timer was logged for this task today, ask for time spent
    if (!todaySeconds[task.id]) { setTimeLogFor(task); return }
    try { await completeTask(task.id); load() }
    catch (err) { alert(err.message) }
  }

  async function handleCompleteWithTime(task, minutes) {
    try {
      if (minutes) await logManualTime(task.id, minutes)
      await completeTask(task.id)
      setTimeLogFor(null)
      load()
    } catch (err) { alert(err.message) }
  }
  async function handleDelete(taskId) {
    if (!confirm('Delete this task?')) return
    try { await deleteTask(taskId); load() }
    catch (err) { alert(err.message) }
  }
  async function handleDefer(taskId) {
    try { await deferTask(taskId, tomorrow()); load() }
    catch (err) { alert(err.message) }
  }
  async function handlePlan(taskId) {
    try { await planTask(taskId, data.date); load() }
    catch (err) { alert(err.message) }
  }
  async function handleUnplan(taskId) {
    try { await unplanTask(taskId); load() }
    catch (err) { alert(err.message) }
  }
  async function handlePin(taskId) {
    try { await pinTask(taskId, data.date); load() }
    catch (err) { alert(err.message) }
  }
  async function handleUnpin(taskId) {
    try { await unpinTask(taskId); load() }
    catch (err) { alert(err.message) }
  }
  async function handleCreateSubtask(e, parentTask) {
    e.preventDefault()
    if (!subtaskTitle.trim()) return
    try {
      await createTask({ title: subtaskTitle.trim(), goal_id: parentTask.goal_id, requires_proof: false, parent_task_id: parentTask.id })
      setAddingSubtaskFor(null); setSubtaskTitle(''); load()
    } catch (err) { alert(err.message) }
  }
  async function handleCompleteSubtask(taskId) {
    try { await completeTask(taskId); load() }
    catch (err) { alert(err.message) }
  }
  // Note: FocusSection manages its own subtask state internally
  async function uploadProofContent() {
    if (proofForm.type === 'image') {
      if (!proofForm.imageFile) throw new Error('No image selected')
      const { url } = await uploadProofImage(proofForm.imageFile); return url
    }
    if (proofForm.type === 'file') {
      if (!proofForm.imageFile) throw new Error('No file selected')
      const { url, name } = await uploadProofFile(proofForm.imageFile)
      return JSON.stringify({ url, name })
    }
    const content = proofForm.content.trim()
    if (!content) throw new Error('Content required')
    return content
  }
  async function handleAddProof(e) {
    e.preventDefault(); setSubmitting(true)
    try {
      const content = await uploadProofContent()
      await addProof(proofFor.id, { type: proofForm.type, content })
      await completeTask(proofFor.id)
      setProofFor(null); resetProofForm(); load()
    } catch (err) { alert(err.message) }
    finally { setSubmitting(false) }
  }
  async function handleAddHabitProof(e) {
    e.preventDefault(); setSubmitting(true)
    try {
      const content = await uploadProofContent()
      await addProof(habitProofFor.id, { type: proofForm.type, content, date: data.date })
      await checkinHabit(habitProofFor.id)
      setHabitProofFor(null); resetProofForm(); load()
    } catch (err) { alert(err.message) }
    finally { setSubmitting(false) }
  }

  if (loading) return <p className="text-[#6B6B6B] text-sm">Loading…</p>

  const { focus, daily, habits, projects } = data
  const focusIds = new Set(focus.map(t => t.id))

  // Plan = all daily todos + habits/project-tasks explicitly planned for today (merged + sorted)
  const plannedHabits = habits.filter(h => h.plan_date === data.date)
  const plannedProjectTasks = projects.flatMap(p =>
    p.tasks.filter(t => t.plan_date === data.date).map(t => ({ ...t, _goalTitle: p.goal_title, _type: 'project' }))
  )
  const dailyPlanItems = sortByDueDate(daily).map(t => ({ ...t, _type: 'daily' }))

  // Merge all plan items into a single sortable list, ordered by sort_order
  const rawPlanItems = [
    ...dailyPlanItems,
    ...plannedHabits.map(h => ({ ...h, _type: 'habit' })),
    ...plannedProjectTasks,
  ].sort((a, b) => (a.sort_order ?? 9999) - (b.sort_order ?? 9999))

  // planItems: use local state if user has dragged, otherwise server-sorted order
  const allPlanItems = planItems
    ? planItems.map(item => rawPlanItems.find(r => r.id === item.id) ?? item).filter(Boolean)
    : rawPlanItems

  const pendingPlanCount = allPlanItems.filter(item =>
    item._type === 'habit' ? !item.checked_today : item.status !== 'done'
  ).length

  // Progress bar calculation
  const totalItems = focus.length + allPlanItems.length
  const doneItems =
    focus.filter(t => t.status === 'done').length +
    allPlanItems.filter(item => item._type === 'habit' ? item.checked_today : item.status === 'done').length
  const pct = totalItems > 0 ? Math.round((doneItems / totalItems) * 100) : 0

  // Items available to add to Plan (not already planned)
  const unplandHabits = habits.filter(h => h.plan_date !== data.date)
  const unplannedProjects = projects
    .map(p => ({ ...p, tasks: p.tasks.filter(t => t.plan_date !== data.date) }))
    .filter(p => p.tasks.length > 0)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[#1A1A1A]">Today</h1>
          <p className="text-sm text-[#6B6B6B] mt-0.5">{formatDate(data.date)}</p>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <div className="flex rounded-xl border border-[#E8E3DB] overflow-hidden text-xs">
            <button onClick={() => setViewMode('list')}
              className={`px-3 py-1.5 font-medium transition-colors ${viewMode === 'list' ? 'bg-[#1B3A2D] text-white' : 'text-[#6B6B6B] hover:text-[#1A1A1A] hover:bg-[#F2EDE4]'}`}>
              List
            </button>
            <button onClick={() => setViewMode('planner')}
              className={`px-3 py-1.5 font-medium transition-colors ${viewMode === 'planner' ? 'bg-[#1B3A2D] text-white' : 'text-[#6B6B6B] hover:text-[#1A1A1A] hover:bg-[#F2EDE4]'}`}>
              Planner
            </button>
          </div>
          <button onClick={onOpenReview}
            className="text-sm text-[#6B6B6B] hover:text-[#1B3A2D] px-2 py-1.5 transition-colors font-medium">
            Review →
          </button>
        </div>
      </div>

      {/* ── Daily Check-in ── */}
      <DailyCheckinCard />

      {/* ── Progress Bar ── */}
      {totalItems > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[#6B6B6B] font-medium">
              {doneItems === totalItems
                ? '✦ All done for today!'
                : `${doneItems} of ${totalItems} done`}
            </span>
            <span className={`text-xs font-semibold ${pct === 100 ? 'text-[#2D7A6B]' : pct >= 50 ? 'text-[#E8C334]' : 'text-[#6B6B6B]'}`}>
              {pct}%
            </span>
          </div>
          <div className="h-2 bg-[#E8E3DB] rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${pct === 100 ? 'bg-[#2D7A6B]' : pct >= 50 ? 'bg-[#E8C334]' : 'bg-[#2D7A6B]'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {/* ── Planner view ── */}
      {viewMode === 'planner' && (
        <PlannerView
          items={allPlanItems}
          focusItems={focus}
          date={data.date}
          onItemsReordered={setPlanItems}
        />
      )}

      {/* ── List view ── */}
      {viewMode === 'list' && <>

      {/* ── Focus ── */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-[#1A1A1A]">In Focus Today</h2>
          <span className="text-sm text-[#6B6B6B]">{focus.length} Tasks</span>
        </div>
        <FocusSection
          focus={focus} daily={daily} projects={projects} today={data.date}
          onComplete={handleComplete} onUnpin={handleUnpin} onPinTask={handlePin}
          onRefresh={load}
          onStartTimer={(task) => startTimer(task.id, task.title, task.goal_title || '')}
        />
      </section>

      {/* ── Plan ── */}
      <section>
        <SectionLabel right={pendingPlanCount > 0 ? `${pendingPlanCount} to do` : '✦ All done'}>
          Plan
        </SectionLabel>

        <DndContext
          sensors={planSensors}
          collisionDetection={closestCenter}
          onDragEnd={e => handlePlanDragEnd(e, allPlanItems)}
        >
          <SortableContext items={allPlanItems.map(t => t.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-1.5">
              {allPlanItems.map(item => (
                <SortableItem key={item.id} id={item.id}>
                  {(listeners) => (
                    <PlanRow
                      task={item}
                      planType={item._type}
                      today={data.date}
                      canPin={focus.length < 3}
                      dragListeners={listeners}
                      onComplete={() => item._type === 'habit' ? handleToggleHabit(item) : handleComplete(item)}
                      onDelete={item._type === 'daily' ? () => handleDelete(item.id) : undefined}
                      onDefer={item._type !== 'habit' ? () => handleDefer(item.id) : undefined}
                      onPin={item._type !== 'habit' ? () => handlePin(item.id) : undefined}
                      onUnplan={item._type !== 'daily' ? () => handleUnplan(item.id) : undefined}
                      onRefresh={load}
                      addingSubtask={addingSubtaskFor === item.id}
                      subtaskTitle={subtaskTitle}
                      onAddSubtask={item._type !== 'habit' ? () => { setAddingSubtaskFor(item.id); setSubtaskTitle('') } : undefined}
                      onSubtaskTitleChange={setSubtaskTitle}
                      onSubtaskSubmit={e => handleCreateSubtask(e, item)}
                      onSubtaskCancel={() => { setAddingSubtaskFor(null); setSubtaskTitle('') }}
                      onCompleteSubtask={handleCompleteSubtask}
                      onStartTimer={() => startTimer(item.id, item.title, item._goalTitle || item.goal_title || '')}
                    />
                  )}
                </SortableItem>
              ))}
              {allPlanItems.length === 0 && (
                <p className="text-sm text-sand-400 italic py-1">Nothing planned yet — add a todo or pick from habits &amp; projects below</p>
              )}
            </div>
          </SortableContext>
        </DndContext>

        {/* Quick-add + Plan picker */}
        <div className="mt-3 space-y-2">
          <form onSubmit={handleQuickAdd} className="flex items-center gap-2">
            <input ref={quickAddRef} value={quickAdd} onChange={e => setQuickAdd(e.target.value)}
              placeholder="Add a todo…"
              className="flex-1 text-sm border border-[#E8E3DB] rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#2D7A6B] bg-white placeholder:text-[#b5a08a]" />
            <button type="submit" disabled={!quickAdd.trim()}
              className="text-sm bg-[#1B3A2D] text-white px-3 py-2 rounded-xl hover:bg-[#2a5240] disabled:opacity-30 transition-colors">
              Add
            </button>
          </form>

          {(unplandHabits.length > 0 || unplannedProjects.length > 0) && (
            <PlanPicker
              habits={unplandHabits} projects={unplannedProjects} today={data.date}
              onAdd={handlePlan} />
          )}
        </div>
      </section>

      {/* Time-log modal */}
      {timeLogFor && (
        <TimeLogModal
          task={timeLogFor}
          onConfirm={(minutes) => handleCompleteWithTime(timeLogFor, minutes)}
          onClose={() => setTimeLogFor(null)}
        />
      )}

      {/* Proof modals */}
      {proofFor && (
        <Modal title={`Proof — ${proofFor.title}`} onClose={() => { setProofFor(null); resetProofForm() }}>
          <ProofForm proofForm={proofForm} setProofForm={setProofForm} onSubmit={handleAddProof}
            submitting={submitting} onCancel={() => { setProofFor(null); resetProofForm() }}
            onImageSelect={handleImageSelect} onFileSelect={handleFileSelect} submitLabel="Submit & Complete" />
        </Modal>
      )}
      {habitProofFor && (
        <Modal title={`Proof — ${habitProofFor.title}`} onClose={() => { setHabitProofFor(null); resetProofForm() }}>
          <ProofForm proofForm={proofForm} setProofForm={setProofForm} onSubmit={handleAddHabitProof}
            submitting={submitting} onCancel={() => { setHabitProofFor(null); resetProofForm() }}
            onImageSelect={handleImageSelect} onFileSelect={handleFileSelect} submitLabel="Submit & Check In" />
        </Modal>
      )}

      </> /* end list view */}
    </div>
  )
}

// ─── Plan Row ─────────────────────────────────────────────────────────────────
// planType: 'daily' | 'habit' | 'project'

function PlanRow({ task, planType, today, canPin, onComplete, onDelete, onDefer, onPin, onUnplan, onRefresh,
  addingSubtask, subtaskTitle, onAddSubtask, onSubtaskTitleChange, onSubtaskSubmit, onSubtaskCancel, onCompleteSubtask,
  dragListeners, onStartTimer }) {
  const [expanded, setExpanded] = useState(false)
  const isDone = planType === 'habit' ? task.checked_today : task.status === 'done'
  const hasSubtasks = planType !== 'habit' && (task.sub_tasks?.length > 0 || addingSubtask)
  const subDone = task.sub_tasks?.filter(s => s.status === 'done').length ?? 0
  const subTotal = task.sub_tasks?.length ?? 0
  const dueMeta = getDueDateMeta(task.due_date)
  const activityCount = (task.proofs?.length ?? 0) + (task.comments?.length ?? 0)

  const sourceLabel = planType === 'habit'
    ? task.goal_title
    : planType === 'project'
    ? task._goalTitle
    : null

  const accentBorder = !isDone && planType !== 'habit' && (task.is_urgent || task.is_important)
    ? task.is_urgent ? 'border-l-[3px] border-l-terra-400' : 'border-l-[3px] border-l-gold-400'
    : ''

  return (
    <div className={`bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.08)] overflow-hidden transition-all ${isDone ? 'border border-sage-100 opacity-60' : `border border-[#E8E3DB] ${accentBorder}`}`}>
      <div className="flex items-center gap-3 px-3 py-2.5 group">
        {/* Drag handle */}
        {dragListeners && <DragHandle listeners={dragListeners} />}
        {/* Check circle */}
        {planType === 'habit' ? (
          <button onClick={onComplete}
            className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all ${
              task.checked_today ? 'bg-[#2D7A6B] border-[#2D7A6B] text-white' : 'border-[#E8E3DB] hover:border-[#2D7A6B]'
            }`}>
            {task.checked_today && <span className="text-[10px] leading-none">✓</span>}
          </button>
        ) : (
          <button onClick={onComplete}
            className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all ${
              isDone ? 'bg-sage-400 border-sage-400 text-white' : 'border-[#E8E3DB] hover:border-[#2D7A6B] hover:bg-[#2D7A6B]/10'
            }`}>
            {isDone && <span className="text-[10px] leading-none">✓</span>}
          </button>
        )}

        {/* Title + label */}
        <div className="flex-1 min-w-0">
          <span className={`text-sm ${isDone ? 'line-through text-[#b5a08a]' : 'text-[#1A1A1A]'}`}>{task.title}</span>
          {sourceLabel && <span className="ml-2 text-[10px] text-[#6B6B6B]">{sourceLabel}</span>}
        </div>

        {/* Tags */}
        {!isDone && planType !== 'habit' && <TaskTags urgent={task.is_urgent} important={task.is_important} />}

        {/* Due date badge */}
        {dueMeta && !isDone && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-medium flex-shrink-0 ${dueMeta.cls}`}>{dueMeta.label}</span>
        )}

        {/* Habit freq */}
        {planType === 'habit' && task.habit_frequency && task.habit_frequency !== 'daily' && (
          <span className="text-[10px] text-[#2D7A6B] font-medium flex-shrink-0">{parseFreq(task.habit_frequency).label}</span>
        )}

        {/* Streak */}
        {planType === 'habit' && task.streak > 0 && !isDone && (
          <span className="text-[10px] text-[#E8C334] font-semibold flex-shrink-0">✦{task.streak}</span>
        )}

        {/* Activity toggle */}
        {(task.proofs || task.comments) && (
          <button onClick={() => setExpanded(v => !v)}
            className={`text-xs w-5 h-5 flex items-center justify-center rounded-lg transition-colors flex-shrink-0 ${expanded ? 'text-[#2D7A6B] bg-[#2D7A6B]/10' : 'text-[#b5a08a] hover:text-[#6B6B6B]'}`}>
            {activityCount > 0 && !expanded
              ? <span className="font-semibold text-[10px] text-[#2D7A6B]">{activityCount}</span>
              : <span className="text-[9px]">{expanded ? '▴' : '▾'}</span>}
          </button>
        )}

        {/* Hover actions */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {!isDone && onStartTimer && (
            <button onClick={onStartTimer} title="Start timer"
              className="text-[#b5a08a] hover:text-[#2D7A6B] transition-colors text-xs px-1 py-0.5 rounded hover:bg-[#2D7A6B]/10">▶</button>
          )}
          {canPin && planType !== 'habit' && (
            <button onClick={onPin} title="Add to focus"
              className="text-[#b5a08a] hover:text-[#E8C334] transition-colors text-xs px-1 py-0.5 rounded hover:bg-[#E8C334]/10">✦</button>
          )}
          {planType !== 'habit' && onDefer && (
            <button onClick={onDefer} title="Defer to tomorrow"
              className="text-[#b5a08a] hover:text-[#2D7A6B] transition-colors text-xs px-1 py-0.5 rounded hover:bg-[#2D7A6B]/10">→tmr</button>
          )}
          {onUnplan && (
            <button onClick={onUnplan} title="Remove from plan"
              className="text-[#b5a08a] hover:text-terra-400 transition-colors text-xs px-1 py-0.5 rounded">✕</button>
          )}
          {onDelete && planType === 'daily' && (
            <button onClick={onDelete} title="Delete task"
              className="text-[#b5a08a] hover:text-terra-400 transition-colors text-xs px-1 py-0.5 rounded">✕</button>
          )}
        </div>
      </div>
      {expanded && task.id && (
        <div className="border-t border-sand-100 px-3 pt-2 pb-3">
          <ActivityComments task={task} onRefresh={onRefresh} />
        </div>
      )}

      {/* Sub-tasks */}
      {hasSubtasks && (
        <div className="border-t border-sand-100 px-3 py-2 space-y-0.5">
          {task.sub_tasks?.map(st => (
            <div key={st.id} className={`flex items-center gap-2 py-0.5 group rounded-lg hover:bg-sand-50 px-1 -mx-1 ${st.status === 'done' ? 'opacity-50' : ''}`}>
              {st.status !== 'done' && onCompleteSubtask ? (
                <button onClick={() => onCompleteSubtask(st.id)}
                  className="w-4 h-4 rounded-full border border-sand-300 hover:border-teal-500 hover:bg-teal-50 flex-shrink-0 transition-all" />
              ) : (
                <span className="w-1.5 h-1.5 rounded-full bg-sage-400 flex-shrink-0 ml-0.5" />
              )}
              <span className={`text-xs flex-1 ${st.status === 'done' ? 'line-through text-sand-400' : 'text-sand-700'}`}>{st.title}</span>
              {st.status !== 'done' && (
                <button
                  onClick={async () => { await pinTask(st.id, new Date().toISOString().split('T')[0]); onRefresh() }}
                  title="Pin to focus"
                  className={`opacity-0 group-hover:opacity-100 text-xs w-5 h-5 flex items-center justify-center rounded transition-all flex-shrink-0 ${st.pinned_date ? 'text-gold-400' : 'text-sand-300 hover:text-gold-400'}`}>
                  ✦
                </button>
              )}
            </div>
          ))}
          {addingSubtask && (
            <form onSubmit={onSubtaskSubmit} className="flex items-center gap-2 pt-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-sand-200 flex-shrink-0 ml-0.5" />
              <input autoFocus value={subtaskTitle} onChange={e => onSubtaskTitleChange(e.target.value)}
                placeholder="Subtask title…"
                className="flex-1 text-xs border-b border-sand-200 focus:border-teal-400 focus:outline-none bg-transparent py-0.5 placeholder:text-sand-300" />
              <button type="submit" disabled={!subtaskTitle?.trim()}
                className="text-xs text-teal-600 font-medium disabled:opacity-40 flex-shrink-0">Add</button>
              <button type="button" onClick={onSubtaskCancel} className="text-xs text-sand-400 flex-shrink-0">✕</button>
            </form>
          )}
        </div>
      )}
      {planType !== 'habit' && !isDone && onAddSubtask && !addingSubtask && (
        <div className="px-3 pb-2">
          <button onClick={onAddSubtask}
            className="text-[11px] text-sand-400 hover:text-teal-600 transition-colors flex items-center gap-1">
            <span>+</span> subtask
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Plan Picker ──────────────────────────────────────────────────────────────

function PlanPicker({ habits, projects, today, onAdd }) {
  const [open, setOpen] = useState(false)
  const total = habits.length + projects.reduce((s, p) => s + p.tasks.length, 0)
  if (total === 0) return null

  return (
    <div>
      <button onClick={() => setOpen(v => !v)}
        className="text-sm text-[#6B6B6B] hover:text-[#1B3A2D] transition-colors flex items-center gap-1.5">
        <span className="text-xs">+</span> Add from habits & projects
        <span className="text-[10px]">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className="mt-2 bg-white border border-[#E8E3DB] rounded-2xl overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
          {habits.length > 0 && (
            <div className="border-b border-[#E8E3DB]">
              <p className="text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-widest px-4 pt-3 pb-1">Habits</p>
              {habits.map(h => (
                <button key={h.id} onClick={() => { onAdd(h.id); }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-[#2D7A6B]/10 transition-colors text-left group">
                  <span className="text-xs text-[#b5a08a] group-hover:text-[#2D7A6B] transition-colors">+</span>
                  <span className="flex-1 text-sm text-[#1A1A1A]">{h.title}</span>
                  <span className="text-[10px] text-[#6B6B6B]">{h.goal_title}</span>
                </button>
              ))}
            </div>
          )}
          {projects.map(p => (
            <div key={p.goal_id} className="border-b border-[#E8E3DB] last:border-b-0">
              <p className="text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-widest px-4 pt-3 pb-1">{p.goal_title}</p>
              {sortByDueDate(p.tasks).map(task => (
                <button key={task.id} onClick={() => { onAdd(task.id); }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-[#2D7A6B]/10 transition-colors text-left group">
                  <span className="text-xs text-[#b5a08a] group-hover:text-[#2D7A6B] transition-colors">+</span>
                  <span className="flex-1 text-sm text-[#1A1A1A]">{task.title}</span>
                  {task.due_date && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-medium ${getDueDateMeta(task.due_date)?.cls || 'text-[#6B6B6B]'}`}>
                      {getDueDateMeta(task.due_date)?.label}
                    </span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Focus Section ────────────────────────────────────────────────────────────

function FocusSection({ focus, daily, projects, today, onComplete, onUnpin, onPinTask, onRefresh, onStartTimer }) {
  const [showPicker, setShowPicker] = useState(false)
  const [expandedIds, setExpandedIds] = useState(new Set())
  const [addingSubtaskFor, setAddingSubtaskFor] = useState(null)
  const [subtaskTitle, setSubtaskTitle] = useState('')
  const [localFocus, setLocalFocus] = useState(null)
  const focusSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))
  const focusIds = new Set(focus.map(t => t.id))
  const slots = 3

  const displayFocus = localFocus
    ? localFocus.map(item => focus.find(t => t.id === item.id) ?? item).filter(Boolean)
    : focus

  function toggleExpand(id) {
    setExpandedIds(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  }

  async function handleFocusDragEnd(event) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIdx = displayFocus.findIndex(t => t.id === active.id)
    const newIdx = displayFocus.findIndex(t => t.id === over.id)
    const reordered = arrayMove(displayFocus, oldIdx, newIdx)
    setLocalFocus(reordered)
    try {
      await reorderTasks(reordered.map((item, i) => ({ id: item.id, sort_order: i * 10 })))
    } catch { /* silently fail */ }
  }

  async function handleAddSubtask(e, task) {
    e.preventDefault()
    if (!subtaskTitle.trim()) return
    try {
      await createTask({ title: subtaskTitle.trim(), goal_id: task.goal_id, requires_proof: false, parent_task_id: task.id })
      setAddingSubtaskFor(null)
      setSubtaskTitle('')
      onRefresh()
    } catch (err) { alert(err.message) }
  }

  async function handleCompleteSubtask(subtaskId) {
    try { await completeTask(subtaskId); onRefresh() }
    catch (err) { alert(err.message) }
  }

  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {displayFocus.map((task) => {
        const isDone = task.status === 'done'
        const expanded = expandedIds.has(task.id)
        const isAddingHere = addingSubtaskFor === task.id
        return (
          <div key={task.id}
            className={`bg-white rounded-2xl border shadow-sm flex flex-col overflow-hidden transition-all ${
              isDone ? 'border-[#E8E3DB] opacity-70' : 'border-[#E8E3DB]'
            }`}>
            {/* Top: tags */}
            <div className="px-4 pt-4 pb-2 flex flex-wrap gap-1.5">
              {task.is_urgent && (
                <span className="bg-red-100 text-red-600 text-[10px] font-semibold px-2 py-0.5 rounded-full">URGENT</span>
              )}
              {task.is_important && (
                <span className="bg-amber-100 text-amber-600 text-[10px] font-semibold px-2 py-0.5 rounded-full">IMPORTANT</span>
              )}
              {task.goal_title && (
                <span className="bg-[#E8E3DB] text-[#6B6B6B] text-[10px] font-medium px-2 py-0.5 rounded-full">{task.goal_title}</span>
              )}
            </div>

            {/* Middle: title */}
            <div className="px-4 flex-1">
              <p className={`text-base font-bold leading-snug ${isDone ? 'line-through text-[#b5a08a]' : 'text-[#1A1A1A]'}`}>
                {task.title}
              </p>
              {task.parent_task_title && (
                <p className="text-xs text-[#6B6B6B] mt-1">Goal: {task.parent_task_title}</p>
              )}
            </div>

            {/* Bottom: action buttons */}
            <div className="px-4 pb-4 pt-3 flex items-center gap-2 mt-auto">
              {!isDone && onStartTimer && (
                <button onClick={() => onStartTimer(task)}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-[#1B3A2D] text-white text-sm font-medium rounded-xl px-4 py-2 hover:bg-[#2a5240] transition-colors">
                  <span>▶</span> Start
                </button>
              )}
              {!isDone && (
                <button onClick={() => onComplete(task)}
                  className="w-10 h-10 flex items-center justify-center rounded-xl border border-[#E8E3DB] text-[#2D7A6B] hover:bg-[#2D7A6B]/10 transition-colors text-base font-bold flex-shrink-0">
                  ✓
                </button>
              )}
              {isDone && (
                <span className="text-sm text-[#2D7A6B] font-semibold">Done ✓</span>
              )}
              <button onClick={() => onUnpin(task.id)}
                className="w-8 h-8 flex items-center justify-center text-[#b5a08a] hover:text-red-400 transition-colors text-sm flex-shrink-0">✕</button>
            </div>
          </div>
        )
      })}

      {Array.from({ length: slots - displayFocus.length }).map((_, i) => (
        <button key={`empty-${i}`} onClick={() => setShowPicker(true)}
          className="flex items-center justify-center gap-2 border-2 border-dashed border-[#E8E3DB] rounded-2xl px-4 py-8 hover:border-[#E8C334] hover:bg-[#E8C334]/5 transition-all group min-h-[120px]">
          <span className="text-sm text-[#6B6B6B] group-hover:text-[#1A1A1A] transition-colors">+ Pick a focus item</span>
        </button>
      ))}

      </div>

      {showPicker && (
        <FocusPicker
          daily={daily} projects={projects} focusIds={focusIds} today={today}
          onSelect={async (id) => { await onPinTask(id); setShowPicker(false) }}
          onClose={() => setShowPicker(false)} />
      )}
    </div>
  )
}

function FocusPicker({ daily, projects, focusIds, today, onSelect, onClose }) {
  const suggestions = getSuggestions(daily, projects, today, focusIds)
  const dailyAvail  = daily.filter(t => !focusIds.has(t.id))
  const projectGroups = projects.map(p => ({
    label: p.goal_title,
    tasks: p.tasks.filter(t => !focusIds.has(t.id))
  })).filter(g => g.tasks.length > 0)

  return (
    <Modal title="What to focus on?" onClose={onClose}>
      <div className="space-y-4 max-h-80 overflow-y-auto -mx-1 px-1">
        {suggestions.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-[#E8C334] uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
              <span>✦</span> Suggested
            </p>
            <div className="space-y-0.5">
              {suggestions.map(({ task, source }) => (
                <button key={task.id} onClick={() => onSelect(task.id)}
                  className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-[#E8C334]/10 text-sm text-[#1A1A1A] hover:text-[#1A1A1A] transition-colors flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#E8C334] flex-shrink-0" />
                  <span className="flex-1">{task.title}</span>
                  <span className="text-[10px] text-[#6B6B6B] flex-shrink-0">{source}</span>
                </button>
              ))}
            </div>
            {(dailyAvail.length > 0 || projectGroups.length > 0) && <div className="border-t border-[#E8E3DB] mt-2 pt-1" />}
          </div>
        )}
        {dailyAvail.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-[#6B6B6B] uppercase tracking-wide mb-1.5">Todos</p>
            <div className="space-y-0.5">
              {dailyAvail.map(task => (
                <button key={task.id} onClick={() => onSelect(task.id)}
                  className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-[#2D7A6B]/10 text-sm text-[#1A1A1A] hover:text-[#1B3A2D] transition-colors flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#E8E3DB] flex-shrink-0" />
                  {task.title}
                </button>
              ))}
            </div>
          </div>
        )}
        {projectGroups.map(group => (
          <div key={group.label}>
            <p className="text-xs font-semibold text-[#6B6B6B] uppercase tracking-wide mb-1.5">{group.label}</p>
            <div className="space-y-0.5">
              {group.tasks.map(task => (
                <button key={task.id} onClick={() => onSelect(task.id)}
                  className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-[#2D7A6B]/10 text-sm text-[#1A1A1A] hover:text-[#1B3A2D] transition-colors flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#E8E3DB] flex-shrink-0" />
                  {task.title}
                </button>
              ))}
            </div>
          </div>
        ))}
        {suggestions.length === 0 && dailyAvail.length === 0 && projectGroups.length === 0 && (
          <p className="text-sm text-[#6B6B6B] italic py-4 text-center">No tasks available</p>
        )}
      </div>
    </Modal>
  )
}

// ─── Activity helpers ─────────────────────────────────────────────────────────

function ActivityToggle({ task, expanded, onToggle }) {
  const count = (task.proofs?.length ?? 0) + (task.comments?.length ?? 0)
  return (
    <button onClick={onToggle}
      className={`text-xs w-6 h-6 flex items-center justify-center rounded-lg transition-colors flex-shrink-0 ${expanded ? 'text-teal-500 bg-teal-50' : 'text-sand-300 hover:text-sand-500 hover:bg-sand-50'}`}>
      {count > 0 && !expanded
        ? <span className="font-semibold text-[10px] text-teal-500">{count}</span>
        : <span className="text-[10px]">{expanded ? '▴' : '▾'}</span>}
    </button>
  )
}

