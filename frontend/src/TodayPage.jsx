import Icon from './components/Icon'
import CompleteTaskDialog from './features/tasks/CompleteTaskDialog'
import { notify } from './components/Notice'
import { useEffect, useRef, useState } from 'react'
import {
  addProof, checkinHabit, completeTask, createTask,
  deleteTask, deferTask, getToday, getTimerToday, logManualTime,
  pinTask, planTask, reorderTasks, uncheckinHabit, unpinTask, unplanTask,
  uploadProofFile, uploadProofImage, updateTask,
  getTodayCheckin, saveMorningCheckin, saveEveningCheckin,
  completeTaskWithFeeling, deferTaskWithReason,
  saveAfternoonCheckin, getAfternoonCheckin,
} from './api'
import MicButton from './components/MicButton'
import AIPolishButton from './components/AIPolishButton'
import PostTaskFeedback from './components/PostTaskFeedback'
import { ProofForm, TaskTags } from './GoalPage'
import { useTimer } from './TimerContext'
import Modal from './components/Modal'
import { ActivityComments } from './components/ActivityComposer'
import TimeLogModal from './components/TimeLogModal'
import { useDayWorkspace } from './features/today/useDayWorkspace'
import DayAgenda from './features/today/DayAgenda'
import MorningPlanner from './features/today/MorningPlanner'
import TimeDetailDrawer from './features/today/TimeDetailDrawer'
import FindOrCreateComposer from './features/composer/FindOrCreateComposer'
import { fmtDuration, fmtMinutes } from './features/today/format'
import { TicketDrawer } from './WorkPage'
import { getWorkTicket, setScheduleTime } from './api'
import { getDueDateMeta, sortByDueDate } from './utils'
import { PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'

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

const DEFER_REASONS = [
  { value: 'too_vague',         label: 'Too vague'         },
  { value: 'low_energy',        label: 'Low energy'        },
  { value: 'wrong_timing',      label: 'Wrong timing'      },
  { value: 'blocked',           label: 'Blocked'           },
  { value: 'changed_priority',  label: 'Changed priority'  },
]

function DeferReasonPicker({ onSelect, onDismiss }) {
  return (
    <div className="bg-surface border border-border rounded-2xl shadow-float p-3">
      <p className="text-[11px] text-muted font-medium mb-2 text-center">Why are you deferring?</p>
      <div className="flex flex-wrap gap-1.5 justify-center">
        {DEFER_REASONS.map(r => (
          <button key={r.value} onClick={() => onSelect(r.value)}
            className="px-3 py-1.5 text-xs font-medium rounded-xl bg-raised text-ink hover:bg-highlight transition-colors">
            {r.label}
          </button>
        ))}
        <button onClick={() => onSelect(null)}
          className="px-3 py-1.5 text-xs font-medium rounded-xl text-muted hover:text-ink transition-colors">
          skip
        </button>
      </div>
    </div>
  )
}

function getSuggestions(planItems, today, focusIds) {
  const candidates = []
  for (const task of planItems) {
    if (focusIds.has(task.id)) continue
    if (task._type === 'habit') continue   // habits aren't focusable tasks
    const source = task._type === 'daily' ? 'Todos' : (task._goalTitle || task.goal_title || 'Project')
    const score = task.due_date && task.due_date < today ? 100 : task.due_date === today ? 50 : (task._type === 'daily' ? 10 : 5)
    candidates.push({ task, score, source })
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

export function DailyCheckinCard({ onCheckinSaved }) {
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
    } catch (err) { notify(err.message) }
    finally { setSaving(false) }
  }

  async function handleEvening(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const updated = await saveEveningCheckin({ mood, rating, reflection })
      setCheckin(updated)
      onCheckinSaved?.(updated)
    } catch (err) { notify(err.message) }
    finally { setSaving(false) }
  }

  if (!isEvening) {
    // ── Morning check-in ──
    return (
      <div className="bg-gradient-to-br from-forest to-brand rounded-2xl p-5 text-white shadow-md">
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
                      ? 'bg-surface text-accent border-white shadow-sm'
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
              <div className="flex items-center gap-1">
                <AIPolishButton value={intention} onChange={setIntention} context="intention"
                  className="[&_button]:!bg-white/10 [&_button]:!border-white/20 [&_button]:!text-white/70 [&_button:hover]:!bg-white/20" />
                <MicButton value={intention} onChange={setIntention}
                  className="!text-white/60 hover:!text-white hover:!bg-white/10 !border-transparent" />
              </div>
            </div>
            <input
              value={intention}
              onChange={e => setIntention(e.target.value)}
              placeholder="What would make today great?"
              className="w-full bg-white/10 border border-white/20 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-white/40 focus:outline-none focus:bg-white/20 transition-colors"
            />
          </div>

          <button type="submit" disabled={saving}
            className="w-full bg-surface text-accent font-bold py-2.5 rounded-xl text-sm hover:bg-white/90 transition-colors disabled:opacity-60">
            {saving ? 'Saving…' : 'Start My Day →'}
          </button>
        </form>
      </div>
    )
  }

  // ── Evening check-in ──
  return (
    <div className="bg-gradient-to-br from-forest to-forest rounded-2xl p-5 text-white shadow-md">
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
                    ? 'bg-surface border-white shadow-sm'
                    : 'bg-white/10 border-white/20 hover:bg-white/20'
                }`}>
                <span className="text-lg">{o.emoji}</span>
                <span className={`text-[9px] font-semibold mt-0.5 ${mood === o.val ? 'text-accent' : 'text-white/50'}`}>{o.label}</span>
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
                    ? 'bg-highlight text-on-gold border-highlight shadow-sm'
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
            <div className="flex items-center gap-1">
              <AIPolishButton value={reflection} onChange={setReflection} context="reflection"
                className="[&_button]:!bg-white/10 [&_button]:!border-white/20 [&_button]:!text-white/70 [&_button:hover]:!bg-white/20" />
              <MicButton value={reflection} onChange={setReflection}
                className="!text-white/60 hover:!text-white hover:!bg-white/10 !border-transparent" />
            </div>
          </div>
          <input
            value={reflection}
            onChange={e => setReflection(e.target.value)}
            placeholder="What stood out today?"
            className="w-full bg-white/10 border border-white/20 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-white/40 focus:outline-none focus:bg-white/20 transition-colors"
          />
        </div>

        <button type="submit" disabled={saving}
          className="w-full bg-highlight text-on-gold font-bold py-2.5 rounded-xl text-sm hover:bg-gold-300 transition-colors disabled:opacity-60">
          {saving ? 'Saving…' : 'Close the Day ✦'}
        </button>
      </form>
    </div>
  )
}

export default function TodayPage({ onGoToGoal, onOpenReview }) {
  const { startTimer, timer, resumeTimer, pauseTimer } = useTimer()
  const [data, setData]   = useState(null)
  const [loading, setLoading] = useState(true)
  const focusOrderRef = useRef([])
  const [todaySeconds, setTodaySeconds]     = useState({})   // taskId → seconds logged today
  const [timeLogFor, setTimeLogFor]         = useState(null) // task waiting for manual time entry
  const [proofFor, setProofFor]             = useState(null) // task needing proof to complete
  const [habitProofFor, setHabitProofFor]   = useState(null) // habit needing proof to check in
  const [proofForm, setProofForm]           = useState({ type: 'text', content: '', imageFile: null, imagePreview: null })
  const [submitting, setSubmitting]         = useState(false)
  const [planItems, setPlanItems]           = useState(null) // null = derive from data
  const [viewMode, setViewMode]             = useState('list') // 'list' | 'planner'
  const [feedbackTask, setFeedbackTask]     = useState(null)  // task awaiting feeling feedback
  const [deferPending, setDeferPending]     = useState(null)  // { taskId } awaiting reason selection
  const [afternoonCheckin, setAfternoonCheckin] = useState(null)
  const [afternoonForm, setAfternoonForm]   = useState({ energy: null, working_on: '' })
  const [afternoonSaving, setAfternoonSaving] = useState(false)
  // Read-only unified day model (recorded/live time by project & client, agenda,
  // routines, active timers). Refreshed after any Today reload; never writes.
  const { data: workspace, refresh: refreshWorkspace } = useDayWorkspace(data?.date)
  const [showPlanner, setShowPlanner] = useState(false)
  const [showQuickAdd, setShowQuickAdd] = useState(false)
  const [showTimeDetail, setShowTimeDetail] = useState(false)
  const [openTicket, setOpenTicket] = useState(null)   // full ticket shown in the drawer

  async function handleOpenTicket(item) {
    try { setOpenTicket(await getWorkTicket(item.item_id)) }
    catch (err) { notify(err.message) }
  }

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
      const todayStr = new Date().toISOString().split('T')[0]
      const [d, timerData, afternoonData] = await Promise.all([
        getToday(),
        getTimerToday().catch(() => ({ tasks: [] })),
        getAfternoonCheckin(todayStr).catch(() => null),
      ])
      if (afternoonData?.energy) setAfternoonCheckin(afternoonData)
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
    } catch (err) { notify(err.message) }
    finally { setLoading(false); refreshWorkspace?.() }
  }
  useEffect(() => { load() }, [])

  // Refresh when the timer overlay adds a comment/proof to any task
  useEffect(() => {
    function onTaskUpdated() { load() }
    window.addEventListener('basira:task-updated', onTaskUpdated)
    return () => window.removeEventListener('basira:task-updated', onTaskUpdated)
  }, [])

  async function handleToggleHabit(habit) {
    if (!habit.checked_today && habit.requires_proof && !habit.has_proof_today) {
      setHabitProofFor(habit); return
    }
    try {
      habit.checked_today ? await uncheckinHabit(habit.id) : await checkinHabit(habit.id)
      load()
    } catch (err) { notify(err.message) }
  }
  function handleComplete(task) { setProofFor(task) }

  async function legacyHandleComplete(task) {
    if (task.requires_proof && (!task.proofs || task.proofs.length === 0)) { setProofFor(task); return }
    // If no timer was logged for this task today, ask for time spent
    if (!todaySeconds[task.id]) { setTimeLogFor(task); return }
    try {
      await completeTask(task.id)
      setFeedbackTask(task)   // show feeling popover
      load()
    } catch (err) { notify(err.message) }
  }

  async function handleFeelingSelect(feeling) {
    if (feedbackTask) {
      // Send feeling to backend (fire-and-forget, non-blocking)
      completeTaskWithFeeling(feedbackTask.id, feeling).catch(() => {})
    }
    setFeedbackTask(null)
  }

  async function handleCompleteWithTime(task, minutes) {
    try {
      if (minutes) await logManualTime(task.id, minutes)
      await completeTask(task.id)
      setFeedbackTask(task)   // show feeling popover
      setTimeLogFor(null)
      load()
    } catch (err) { notify(err.message) }
  }
  async function handleDelete(taskId) {
    if (!confirm('Delete this task?')) return
    try { await deleteTask(taskId); load() }
    catch (err) { notify(err.message) }
  }
  function handleDefer(taskId) {
    setDeferPending({ taskId })
  }

  async function handleDeferWithReason(reason) {
    if (!deferPending) return
    const { taskId } = deferPending
    setDeferPending(null)
    try { await deferTaskWithReason(taskId, tomorrow(), reason); load() }
    catch (err) { notify(err.message) }
  }
  async function handleAfternoonSubmit() {
    if (!afternoonForm.energy) return
    setAfternoonSaving(true)
    try {
      const saved = await saveAfternoonCheckin({ energy: afternoonForm.energy, working_on: afternoonForm.working_on })
      setAfternoonCheckin(saved)
    } catch (err) { notify(err.message) }
    finally { setAfternoonSaving(false) }
  }
  async function handlePlan(taskId) {
    try { await planTask(taskId, data.date); load() }
    catch (err) { notify(err.message) }
  }
  async function handleUnplan(taskId) {
    try { await unplanTask(taskId); load() }
    catch (err) { notify(err.message) }
  }
  async function handlePin(taskId) {
    try { await pinTask(taskId, data.date); load() }
    catch (err) { notify(err.message) }
  }
  async function handleUnpin(taskId) {
    try { await unpinTask(taskId); load() }
    catch (err) { notify(err.message) }
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
    } catch (err) { notify(err.message) }
    finally { setSubmitting(false) }
  }
  async function handleAddHabitProof(e) {
    e.preventDefault(); setSubmitting(true)
    try {
      const content = await uploadProofContent()
      await addProof(habitProofFor.id, { type: proofForm.type, content, date: data.date })
      await checkinHabit(habitProofFor.id)
      setHabitProofFor(null); resetProofForm(); load()
    } catch (err) { notify(err.message) }
    finally { setSubmitting(false) }
  }

  if (loading) return <p className="text-muted text-sm" role="status">Preparing your day…</p>
  if (!data) return <div className="p-8 bg-surface rounded-2xl border border-border"><h1>Your day is still here.</h1><p className="page-subtitle">We couldn't load it. Check the connection and try again.</p><button className="secondary-button mt-4" onClick={load}>Try again</button></div>

  const { habits } = data

  // ── One chronological agenda from the day workspace + habits + completed ──
  const activeKeys = new Set((workspace?.active_timers || []).map(t => t.key))
  const workItems = [...(workspace?.agenda || []), ...(workspace?.unscheduled || [])]
    .map(i => ({ ...i, done: i.status === 'done', active: activeKeys.has(i.key) }))
  const habitById = new Map(habits.map(h => [h.id, h]))
  const routines = workspace?.routines || {}
  const habitItems = ['morning', 'afternoon', 'evening', 'anytime'].flatMap(b =>
    (routines[b] || []).map(h => ({
      key: `habit:${h.id}`, source: 'habit', item_id: h.id, title: h.title,
      scheduled_time: h.scheduled_time, project_title: h.goal_title,
      habitCount: h.count, habitTarget: h.target, done: h.done, active: false,
    }))
  )
  const all = [...workItems, ...habitItems]
  // Active work that isn't on the plan still shows one truthful entry.
  const present = new Set(all.map(i => i.key))
  for (const t of (workspace?.active_timers || [])) {
    if (!present.has(t.key)) all.push({
      key: t.key, source: t.source, item_id: t.item_id, title: t.title,
      scheduled_time: null, project_title: t.project_title, company_name: t.company_name,
      recorded_seconds: 0, live_seconds: t.elapsed_seconds, done: false, active: true,
    })
  }
  const scheduled = all.filter(i => i.scheduled_time && !i.done)
    .sort((a, b) => a.scheduled_time.localeCompare(b.scheduled_time))
  const anytimeItems = all.filter(i => !i.scheduled_time && !i.done)
  const completedItems = all.filter(i => i.done)

  const planExists = workItems.length > 0 || habitItems.some(h => h.scheduled_time)
  const planned = workspace?.totals?.planned_minutes || 0
  const recorded = workspace?.totals?.recorded_seconds || 0
  const live = workspace?.totals?.live_seconds || 0

  function findTask(id) {
    const pools = [...data.focus, ...data.daily, ...data.projects.flatMap(p => p.tasks)]
    return pools.find(t => t.id === id) || { id, title: '', requires_proof: false, proofs: [] }
  }
  async function handleEditTime(item, time) {
    try { await setScheduleTime(item.source, item.item_id, time || null); refreshWorkspace?.() }
    catch (err) { notify(err.message) }
  }

  return (
    <div className="space-y-4">
      {/* Compact Today header (BAS-022) */}
      <div className="today-head">
        <div>
          <p className="eyebrow">Today</p>
          <h1 className="today-title">{formatDate(data.date)}</h1>
        </div>
        <div className="today-head-actions">
          <button onClick={onOpenReview} className="ghost-link"><Icon name="review" size={15}/><span>Review</span></button>
          <button onClick={() => setShowQuickAdd(true)} className="secondary-button"><Icon name="plus" size={15}/><span>Add</span></button>
          <button onClick={() => setShowPlanner(true)} className="primary-button"><Icon name="goals" size={15}/><span>{planExists ? 'Edit day' : 'Plan my day'}</span></button>
        </div>
      </div>

      {/* One compact planned / worked time line (BAS-026) */}
      <button className="time-line" onClick={() => setShowTimeDetail(true)} aria-label="Open time detail">
        <span><span className="font-mono tabular-nums text-ink">{fmtMinutes(planned)}</span> planned</span>
        <span className="text-faint">·</span>
        <span><span className="font-mono tabular-nums text-ink">{fmtDuration(recorded)}</span> worked</span>
        {live > 0 && <><span className="text-faint">·</span><span className="text-accent inline-flex items-center gap-1"><span className="status-dot live"/>+{fmtDuration(live)} live</span></>}
        <span className="ml-auto text-[11px] text-muted">Details →</span>
      </button>

      {/* One chronological agenda (BAS-023) */}
      <DayAgenda
        scheduled={scheduled} anytime={anytimeItems} completed={completedItems}
        timer={timer}
        onStartTask={item => { startTimer(item.item_id, item.title, item.project_title || ''); window.dispatchEvent(new CustomEvent('basira:timer-changed')); setTimeout(() => refreshWorkspace?.(), 400) }}
        onPauseTask={() => { pauseTimer(); setTimeout(() => refreshWorkspace?.(), 300) }}
        onResumeTask={() => { resumeTimer(); setTimeout(() => refreshWorkspace?.(), 300) }}
        onCompleteTask={item => handleComplete(findTask(item.item_id))}
        onOpenTicket={handleOpenTicket}
        onCheckHabit={item => { const full = habitById.get(item.item_id); if (full) handleToggleHabit(full) }}
        onEditTime={handleEditTime}
      />

      {/* ── Post-task feeling popover ── */}
      {feedbackTask && (
        <div className="flex justify-center">
          <PostTaskFeedback
            taskTitle={feedbackTask.title}
            onSelect={handleFeelingSelect}
            onDismiss={() => setFeedbackTask(null)}
          />
        </div>
      )}

      {/* ── Defer reason chips ── */}
      {deferPending && (
        <DeferReasonPicker
          onSelect={handleDeferWithReason}
          onDismiss={() => setDeferPending(null)}
        />
      )}

      {/* Quick capture — opens the shared find-or-create composer (BAS-024) */}
      {showQuickAdd && (
        <Modal title="Add to today" onClose={() => setShowQuickAdd(false)}>
          <FindOrCreateComposer
            placeholder="Find an existing ticket/task/habit/goal, or type a new title…"
            onDone={(r) => { setShowQuickAdd(false); if (r) { load(); refreshWorkspace?.() } }}
          />
        </Modal>
      )}

      {/* Time detail (BAS-026) */}
      {showTimeDetail && workspace && (
        <TimeDetailDrawer workspace={workspace}
          onClose={() => setShowTimeDetail(false)}
          onLogged={() => { refreshWorkspace?.() }} />
      )}

      {/* Time-log modal */}
      {timeLogFor && (
        <TimeLogModal
          task={timeLogFor}
          onConfirm={(minutes) => handleCompleteWithTime(timeLogFor, minutes)}
          onClose={() => setTimeLogFor(null)}
        />
      )}

      {/* Single morning planning workspace */}
      {showPlanner && (
        <MorningPlanner
          date={data.date}
          onClose={() => setShowPlanner(false)}
          onPlanned={() => { load(); refreshWorkspace?.(); window.dispatchEvent(new CustomEvent('basira:schedule-updated')) }}
        />
      )}

      {/* Ticket drawer — reuse Work's drawer so tickets are actionable from Today */}
      {openTicket && (
        <TicketDrawer
          ticket={openTicket}
          onClose={() => { setOpenTicket(null); refreshWorkspace?.() }}
          onUpdate={updated => { setOpenTicket(updated); refreshWorkspace?.(); window.dispatchEvent(new CustomEvent('basira:schedule-updated')) }}
        />
      )}

      {/* Proof modals */}
      {proofFor && <CompleteTaskDialog task={proofFor} onClose={() => setProofFor(null)} onComplete={() => { setFeedbackTask(proofFor); setProofFor(null); load() }}/>}
      {habitProofFor && (
        <Modal title={`Proof — ${habitProofFor.title}`} onClose={() => { setHabitProofFor(null); resetProofForm() }}>
          <ProofForm proofForm={proofForm} setProofForm={setProofForm} onSubmit={handleAddHabitProof}
            submitting={submitting} onCancel={() => { setHabitProofFor(null); resetProofForm() }}
            onImageSelect={handleImageSelect} onFileSelect={handleFileSelect} submitLabel="Submit & Check In" />
        </Modal>
      )}


    </div>
  )
}

// ─── Focus Section ────────────────────────────────────────────────────────────

function FocusSection({ focus, planItems, today, onComplete, onUnpin, onPinTask, onRefresh, onStartTimer, timer }) {
  const [showPicker, setShowPicker] = useState(false)
  const focusIds = new Set(focus.map(t => t.id))
  const pending = focus.filter(t => t.status !== 'done')
  const primary = pending[0]
  // True only when a timer is running for the current focus task. Guards against
  // timer/primary both being null (undefined === undefined) reading timer.running.
  const isActive = Boolean(timer?.taskId && primary && timer.taskId === primary.id)
  return <>
    <div className="focus-layout">
      <div className={`focus-primary ${isActive && timer.running ? 'live' : ''}`}>
        <p className="eyebrow"><span className={`status-dot ${isActive && timer.running ? 'live' : ''}`}/>{isActive ? 'Your active focus' : 'In your line of sight'}</p>
        <h3>{primary?.title || 'What deserves your attention?'}</h3>
        <p className="focus-goal">{primary?.goal_title || (primary ? 'Connected to your daily goals' : 'Choose one meaningful step. The rest can wait.')}</p>
        <div className="focus-actions">{primary ? <><button className="focus-start" onClick={() => onStartTimer(primary)} disabled={isActive && timer.running}><Icon name="play" size={15}/>{isActive ? timer.running ? 'Focus in progress' : 'Resume focus' : 'Begin focus'}</button><button className="focus-proof" onClick={() => onComplete(primary)}><Icon name="check" size={15}/>Complete</button><button className="text-xs text-white/70 ml-auto p-2" aria-label={`Remove ${primary.title} from focus`} onClick={() => onUnpin(primary.id)}>Unpin</button></> : <button className="focus-start" onClick={() => setShowPicker(true)}><Icon name="plus" size={16}/>Choose your focus</button>}</div>
      </div>
      <div className="focus-next"><p className="eyebrow">Up next</p>{pending.slice(1).map((task, i) => <div key={task.id} className="focus-next-row"><span className="focus-number">0{i + 2}</span><div className="flex-1 min-w-0"><p className="focus-next-title">{task.title}</p><p className="text-xs text-muted mt-1">{task.goal_title || 'Daily goal'}</p><div className="flex gap-3 mt-2"><button className="text-xs text-accent py-1" onClick={() => onStartTimer(task)}>Start</button><button className="text-xs text-muted py-1" onClick={() => onComplete(task)}>Complete</button><button className="text-xs text-muted py-1" aria-label={`Remove ${task.title} from focus`} onClick={() => onUnpin(task.id)}>Unpin</button></div></div></div>)}{pending.length < 2 && <p className="text-sm text-muted leading-relaxed">A little space is a good thing. Keep your priorities intentional.</p>}{focus.length < 3 && <button className="focus-empty mt-auto" onClick={() => setShowPicker(true)}><Icon name="plus" size={14}/>Add a priority</button>}{focus.some(t => t.status === 'done') && <div className="text-xs text-accent">{focus.filter(t => t.status === 'done').map(t => <div key={t.id} className="flex justify-between gap-2 py-2"><span>✓ {t.title}</span><button className="text-muted" onClick={() => onUnpin(t.id)} aria-label={`Clear completed focus ${t.title}`}>Clear</button></div>)}</div>}</div>
    </div>
      {showPicker && (
        <FocusPicker
          planItems={planItems} focusIds={focusIds} today={today}
          onSelect={async (id) => { await onPinTask(id); setShowPicker(false) }}
          onCreateAndPin={async (title, goalId) => {
            const task = await createTask({ title, goal_id: goalId, requires_proof: true })
            await planTask(task.id, today)
            await onPinTask(task.id)
            onRefresh()
          }}
          onClose={() => setShowPicker(false)} />
      )}
    </>
}

function FocusPicker({ planItems, focusIds, today, onSelect, onCreateAndPin, onClose }) {
  // Only today's already-planned tasks are choosable — habits aren't focusable tasks
  const available = planItems.filter(t => t._type !== 'habit' && !focusIds.has(t.id))
  const suggestions = getSuggestions(planItems, today, focusIds)
  const suggestedIds = new Set(suggestions.map(s => s.task.id))

  const dailyAvail = available.filter(t => t._type === 'daily' && !suggestedIds.has(t.id))
  const projectGroups = Object.values(
    available
      .filter(t => t._type === 'project' && !suggestedIds.has(t.id))
      .reduce((acc, t) => {
        const label = t._goalTitle || t.goal_title || 'Project'
        if (!acc[label]) acc[label] = { label, tasks: [] }
        acc[label].tasks.push(t)
        return acc
      }, {})
  )

  // Build goal options for the create-new-task form from today's plan (no extra fetch needed)
  const goalOptions = Object.values(
    planItems.reduce((acc, t) => {
      const goalId = t.goal_id
      if (goalId && !acc[goalId]) acc[goalId] = { id: goalId, title: t._goalTitle || t.goal_title || 'Daily' }
      return acc
    }, {})
  )

  const [showCreate, setShowCreate] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newGoalId, setNewGoalId] = useState(goalOptions[0]?.id || '')
  const [creating, setCreating] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => {
    if (showCreate) setTimeout(() => inputRef.current?.focus(), 50)
  }, [showCreate])

  async function handleCreate(e) {
    e.preventDefault()
    if (!newTitle.trim() || !newGoalId) return
    setCreating(true)
    try {
      await onCreateAndPin(newTitle.trim(), newGoalId)
      onClose()
    } catch (err) { notify(err.message) }
    finally { setCreating(false) }
  }

  const hasExisting = suggestions.length > 0 || dailyAvail.length > 0 || projectGroups.length > 0

  return (
    <Modal title="Add to Focus" onClose={onClose}>
      <div className="space-y-3">

        {/* ── Create new task form ── */}
        {showCreate ? (
          <form onSubmit={handleCreate} className="space-y-3 bg-canvas rounded-2xl p-4 border border-border">
            <p className="text-xs font-semibold text-accent uppercase tracking-wide">New task</p>
            <input
              ref={inputRef}
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              placeholder="What needs to be done?"
              className="w-full border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent bg-surface placeholder:text-muted"
            />
            {goalOptions.length > 1 && (
              <select
                value={newGoalId}
                onChange={e => setNewGoalId(e.target.value)}
                className="w-full border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent bg-surface text-ink">
                {goalOptions.map(g => (
                  <option key={g.id} value={g.id}>{g.title}</option>
                ))}
              </select>
            )}
            <div className="flex gap-2">
              <button type="button" onClick={() => setShowCreate(false)}
                className="flex-1 py-2 rounded-xl border border-border text-sm text-muted hover:bg-surface transition-colors">
                Back
              </button>
              <button type="submit" disabled={creating || !newTitle.trim() || !newGoalId}
                className="flex-1 py-2 rounded-xl bg-forest text-white text-sm font-semibold hover:bg-forest-hover disabled:opacity-40 transition-colors">
                {creating ? 'Adding…' : 'Add to Focus'}
              </button>
            </div>
          </form>
        ) : (
          <button
            onClick={() => setShowCreate(true)}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-forest text-white text-sm font-semibold hover:bg-forest-hover transition-colors">
            <span className="text-base leading-none">+</span>
            Create new task
          </button>
        )}

        {/* ── Pick from existing ── */}
        {!showCreate && hasExisting && (
          <div className="space-y-4 max-h-72 overflow-y-auto -mx-1 px-1">
            {suggestions.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-highlight uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
                  <span>✦</span> Suggested
                </p>
                <div className="space-y-0.5">
                  {suggestions.map(({ task, source }) => (
                    <button key={task.id} onClick={() => onSelect(task.id)}
                      className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-highlight/10 text-sm text-ink transition-colors flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-highlight flex-shrink-0" />
                      <span className="flex-1">{task.title}</span>
                      <span className="text-[10px] text-muted flex-shrink-0">{source}</span>
                    </button>
                  ))}
                </div>
                {(dailyAvail.length > 0 || projectGroups.length > 0) && <div className="border-t border-border mt-2 pt-1" />}
              </div>
            )}
            {dailyAvail.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Todos</p>
                <div className="space-y-0.5">
                  {dailyAvail.map(task => (
                    <button key={task.id} onClick={() => onSelect(task.id)}
                      className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-brand/10 text-sm text-ink hover:text-accent transition-colors flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-border flex-shrink-0" />
                      {task.title}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {projectGroups.map(group => (
              <div key={group.label}>
                <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">{group.label}</p>
                <div className="space-y-0.5">
                  {group.tasks.map(task => (
                    <button key={task.id} onClick={() => onSelect(task.id)}
                      className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-brand/10 text-sm text-ink hover:text-accent transition-colors flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-border flex-shrink-0" />
                      {task.title}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {!showCreate && !hasExisting && (
          <p className="text-sm text-muted italic py-2 text-center">No existing tasks available — create one above.</p>
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

