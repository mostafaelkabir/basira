import Icon from './components/Icon'
import CompleteTaskDialog from './features/tasks/CompleteTaskDialog'
import { notify } from './components/Notice'
import { useEffect, useState } from 'react'
import {
  addProof, checkinHabit, completeTask, getToday, logManualTime,
  uncheckinHabit, uploadProofFile, uploadProofImage,
  completeTaskWithFeeling, deferTaskWithReason,
  getWorkTicket, setScheduleTime,
} from './api'
import PostTaskFeedback from './components/PostTaskFeedback'
import { ProofForm } from './GoalPage'
import { useTimer } from './TimerContext'
import Modal from './components/Modal'
import TimeLogModal from './components/TimeLogModal'
import { useDayWorkspace } from './features/today/useDayWorkspace'
import DayAgenda from './features/today/DayAgenda'
import MorningPlanner from './features/today/MorningPlanner'
import TimeDetailDrawer from './features/today/TimeDetailDrawer'
import CapacityLine from './features/today/CapacityLine'
import RoutineStrip from './features/today/RoutineStrip'
import NowStrip from './features/today/NowStrip'
import FindOrCreateComposer from './features/composer/FindOrCreateComposer'
import { TicketDrawer } from './WorkPage'

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

const DEFER_REASONS = [
  { value: 'too_vague',        label: 'Too vague'        },
  { value: 'low_energy',       label: 'Low energy'       },
  { value: 'wrong_timing',     label: 'Wrong timing'     },
  { value: 'blocked',          label: 'Blocked'          },
  { value: 'changed_priority', label: 'Changed priority' },
]

function DeferReasonPicker({ onSelect }) {
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
          className="px-3 py-1.5 text-xs font-medium rounded-xl text-muted hover:text-ink transition-colors">skip</button>
      </div>
    </div>
  )
}

export default function TodayPage({ onGoToGoal, onOpenReview }) {
  const { startTimer, timer, resumeTimer, pauseTimer } = useTimer()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [timeLogFor, setTimeLogFor] = useState(null)
  const [proofFor, setProofFor] = useState(null)
  const [habitProofFor, setHabitProofFor] = useState(null)
  const [proofForm, setProofForm] = useState({ type: 'text', content: '', imageFile: null, imagePreview: null })
  const [submitting, setSubmitting] = useState(false)
  const [feedbackTask, setFeedbackTask] = useState(null)
  const [deferPending, setDeferPending] = useState(null)
  const { data: workspace, refresh: refreshWorkspace } = useDayWorkspace(data?.date)
  const [showPlanner, setShowPlanner] = useState(false)
  const [showQuickAdd, setShowQuickAdd] = useState(false)
  const [showTimeDetail, setShowTimeDetail] = useState(false)
  const [openTicket, setOpenTicket] = useState(null)

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
    try { setData(await getToday()) }
    catch (err) { notify(err.message) }
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

  async function handleFeelingSelect(feeling) {
    if (feedbackTask) completeTaskWithFeeling(feedbackTask.id, feeling).catch(() => {})
    setFeedbackTask(null)
  }

  async function handleCompleteWithTime(task, minutes) {
    try {
      if (minutes) await logManualTime(task.id, minutes)
      await completeTask(task.id)
      setFeedbackTask(task)
      setTimeLogFor(null)
      load()
    } catch (err) { notify(err.message) }
  }

  async function handleDeferWithReason(reason) {
    if (!deferPending) return
    const { taskId } = deferPending
    setDeferPending(null)
    try { await deferTaskWithReason(taskId, tomorrow(), reason); load() }
    catch (err) { notify(err.message) }
  }

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
  // Habits are daily check marks in the RoutineStrip only — never schedule rows.
  const habitById = new Map(habits.map(h => [h.id, h]))
  const routines = workspace?.routines || {}
  const all = [...workItems]
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

  const planExists = workItems.length > 0

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
      {/* Compact Today header */}
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

      {/* Now / Next strip (BAS-032) */}
      <NowStrip workspace={workspace} timer={timer}
        onPause={() => { pauseTimer(); setTimeout(() => refreshWorkspace?.(), 300) }}
        onResume={() => { resumeTimer(); setTimeout(() => refreshWorkspace?.(), 300) }}
        onStart={item => { startTimer(item.item_id, item.title, item.project_title || ''); window.dispatchEvent(new CustomEvent('basira:timer-changed')); setTimeout(() => refreshWorkspace?.(), 400) }}
        onSwitch={item => { if (item.source === 'task') { startTimer(item.item_id, item.title, item.project_title || ''); window.dispatchEvent(new CustomEvent('basira:timer-changed')); setTimeout(() => refreshWorkspace?.(), 400) } else handleOpenTicket(item) }}
        onDone={item => handleComplete(findTask(item.item_id))}
        onOpenTicket={handleOpenTicket}
        onOpenPlanner={() => setShowPlanner(true)} />

      {/* One capacity-aware planned / worked line (BAS-031) */}
      <CapacityLine workspace={workspace}
        onOpenDetail={() => setShowTimeDetail(true)}
        onSettingsChanged={() => refreshWorkspace?.()} />

      {/* Habits as daily check marks — off the schedule (BAS-038) */}
      <RoutineStrip routines={routines}
        onToggle={h => { const full = habitById.get(h.id); if (full) handleToggleHabit(full) }} />

      {/* One chronological agenda */}
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

      {/* Post-task feeling popover */}
      {feedbackTask && (
        <div className="flex justify-center">
          <PostTaskFeedback taskTitle={feedbackTask.title} onSelect={handleFeelingSelect} onDismiss={() => setFeedbackTask(null)} />
        </div>
      )}

      {/* Defer reason chips */}
      {deferPending && <DeferReasonPicker onSelect={handleDeferWithReason} />}

      {/* Quick capture */}
      {showQuickAdd && (
        <Modal title="Add to today" onClose={() => setShowQuickAdd(false)}>
          <FindOrCreateComposer
            placeholder="Find an existing ticket/task/habit/goal, or type a new title…"
            onDone={(r) => { setShowQuickAdd(false); if (r) { load(); refreshWorkspace?.() } }}
          />
        </Modal>
      )}

      {/* Time detail */}
      {showTimeDetail && workspace && (
        <TimeDetailDrawer workspace={workspace} onClose={() => setShowTimeDetail(false)} onLogged={() => refreshWorkspace?.()} />
      )}

      {/* Time-log modal */}
      {timeLogFor && (
        <TimeLogModal task={timeLogFor} onConfirm={(minutes) => handleCompleteWithTime(timeLogFor, minutes)} onClose={() => setTimeLogFor(null)} />
      )}

      {/* Morning planning workspace */}
      {showPlanner && (
        <MorningPlanner date={data.date}
          onClose={() => setShowPlanner(false)}
          onPlanned={() => { load(); refreshWorkspace?.(); window.dispatchEvent(new CustomEvent('basira:schedule-updated')) }} />
      )}

      {/* Ticket drawer */}
      {openTicket && (
        <TicketDrawer ticket={openTicket}
          onClose={() => { setOpenTicket(null); refreshWorkspace?.() }}
          onUpdate={updated => { setOpenTicket(updated); refreshWorkspace?.(); window.dispatchEvent(new CustomEvent('basira:schedule-updated')) }} />
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
