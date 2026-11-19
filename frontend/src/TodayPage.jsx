import { askConfirm } from './components/askConfirm'
import Icon from './components/Icon'
import CompleteTaskDialog from './features/tasks/CompleteTaskDialog'
import { notify, notifyAction } from './components/Notice'
import { useEffect, useState } from 'react'
import {
  addProof, checkinHabit, completeTask, getToday, logManualTime,
  uncheckinHabit, uploadProofFile, uploadProofImage,
  completeTaskWithFeeling,
  getWorkTicket, setScheduleTime, reopenTask, completeScheduleItem,
  deleteTask, deleteWorkTicket, restoreTrashItem,
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
import FixTimeDialog from './features/today/FixTimeDialog'
import CapacityLine from './features/today/CapacityLine'
import RoutineStrip from './features/today/RoutineStrip'
import NowStrip from './features/today/NowStrip'
import TaskNotesDialog from './features/today/TaskNotesDialog'
import PostponeDialog from './features/today/PostponeDialog'
import UpcomingStrip from './features/today/UpcomingStrip'
import FindOrCreateComposer from './features/composer/FindOrCreateComposer'
import { TicketDrawer } from './WorkPage'
import DayCalendar from './features/rhythm/DayCalendar'
import RhythmModal from './features/rhythm/RhythmModal'
import BlockEditor from './features/rhythm/BlockEditor'
import { freeSlotInBlock } from './features/today/blockSlot'
import { createBlock, overrideRhythmDay, restoreRhythmDay, deleteBlock } from './api'

const DAYS   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function formatDate(iso) {
  const d = new Date(iso + 'T00:00:00')
  return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`
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
  const [postponeFor, setPostponeFor] = useState(null)   // agenda item being postponed
  const { data: workspace, refresh: refreshWorkspace } = useDayWorkspace(data?.date)
  const [showPlanner, setShowPlanner] = useState(false)   // false | true (today) | 'YYYY-MM-DD'
  const [showQuickAdd, setShowQuickAdd] = useState(false)
  const [showTimeDetail, setShowTimeDetail] = useState(false)
  const [fixTimeFor, setFixTimeFor] = useState(null)   // { source, item_id, title }
  const [openTicket, setOpenTicket] = useState(null)
  const [notesFor, setNotesFor] = useState(null)   // { item_id, title, project_title }
  const [showRhythm, setShowRhythm] = useState(false)
  // 'calendar' (default) | 'list': two views of the same day, remembered per browser.
  const [view, setView] = useState(() => { try { return localStorage.getItem('basira_today_view') === 'list' ? 'list' : 'calendar' } catch { return 'calendar' } })
  function chooseView(v) { setView(v); try { localStorage.setItem('basira_today_view', v) } catch {} }
  const [blockEditor, setBlockEditor] = useState(null)   // { mode: 'create'|'edit', block?, defaults? }

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
    .map(i => ({ ...i, done: i.status === 'done', active: activeKeys.has(i.key), habitCount: i.habit_count, habitTarget: i.habit_target }))
  // Habits are check marks in the RoutineStrip, unless the user put one on today's
  // schedule (BAS-050) — then it is an agenda row checked off in place.
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
  // Everything an item on the day can do; the timeline's ⋯ menu and controls use these.
  const itemActions = {
    start: item => { startTimer(item.item_id, item.title, item.project_title || ''); window.dispatchEvent(new CustomEvent('basira:timer-changed')); setTimeout(() => refreshWorkspace?.(), 400) },
    pause: () => { pauseTimer(); setTimeout(() => refreshWorkspace?.(), 300) },
    resume: () => { resumeTimer(); setTimeout(() => refreshWorkspace?.(), 300) },
    complete: item => handleComplete(findTask(item.item_id)),
    toggleHabit: item => { const full = habitById.get(item.item_id); if (full) handleToggleHabit(full) },
    notes: item => setNotesFor(item),
    openTicket: item => handleOpenTicket(item),
    postpone: item => setPostponeFor(item),
    remove: item => handleDelete(item),
    undo: item => handleUndo(item),
    fixTime: item => setFixTimeFor(item),
    setTime: (item, time) => handleEditTime(item, time),
    // Timed outside its own client/project block: move it in, or give it a block here.
    moveIntoBlock: async item => {
      const b = item.off_block; if (!b) return
      const block = (workspace?.blocks || []).find(x => x.id === b.block_id) || { start_time: b.start_time, duration_minutes: 60 }
      const time = freeSlotInBlock(block, [...(workspace?.agenda || []), ...(workspace?.unscheduled || [])], item.key, item.planned_minutes || 30)
      await handleEditTime(item, time)
      notify(`“${item.title}” moved into ${b.title} at ${fmtClockShort(time)}`, { title: 'Moved' })
    },
    addBlockHere: async item => {
      const b = item.off_block; if (!b) return
      const [h, m] = item.scheduled_time.split(':').map(Number)
      const start = Math.floor((h * 60 + m) / 15) * 15
      try {
        await createBlock({ date: data.date, kind: b.kind, source_ref: b.target_ref, title: b.title,
          start_time: `${String(Math.floor(start / 60)).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}`,
          duration_minutes: Math.max(30, Math.ceil((item.planned_minutes || 60) / 15) * 15) })
        refreshWorkspace?.(); window.dispatchEvent(new CustomEvent('basira:schedule-updated'))
        notify(`A second ${b.title} block was added for today around “${item.title}”`, { title: 'Block added' })
      } catch (err) { notify(err.message) }
    },
  }
  // Take a block off this day only: a rhythm block is skipped (restorable), a block
  // pulled onto the day or made for it alone is removed. The weekly rhythm is unchanged.
  async function skipBlock(b) {
    try {
      if (b.rhythm_id && !b.added) await overrideRhythmDay({ rhythm_id: b.rhythm_id, date: data.date, skipped: true })
      else if (b.rhythm_id) await restoreRhythmDay(b.rhythm_id, data.date)
      else await deleteBlock(b.id)
      refreshWorkspace?.(); window.dispatchEvent(new CustomEvent('basira:schedule-updated'))
      notifyAction(`“${b.title}” is off today`, 'Undo', () => restoreBlock(b))
    } catch (err) { notify(err.message) }
  }
  async function restoreBlock(b) {
    try {
      if (b.rhythm_id && !b.added) await restoreRhythmDay(b.rhythm_id, data.date)
      else if (b.rhythm_id) await overrideRhythmDay({ rhythm_id: b.rhythm_id, date: data.date })
      else await createBlock({ date: data.date, kind: b.kind, source_ref: b.target_ref, title: b.title, start_time: b.start_time, duration_minutes: b.duration_minutes })
      refreshWorkspace?.(); window.dispatchEvent(new CustomEvent('basira:schedule-updated'))
    } catch (err) { notify(err.message) }
  }
  function fmtClockShort(t) { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}` }
  async function handleEditTime(item, time) {
    try { await setScheduleTime(item.source, item.item_id, time || null); refreshWorkspace?.() }
    catch (err) { notify(err.message) }
  }
  // Undo a "done" click: the task/ticket goes back on the list (evidence and notes
  // stay), a habit loses today's check mark.
  async function handleUndo(item) {
    try {
      if (item.source === 'habit') { const full = habitById.get(item.item_id); if (full) await handleToggleHabit(full); return }
      if (item.source === 'task') await reopenTask(item.item_id)
      else if (item.source === 'ticket') await completeScheduleItem('ticket', item.item_id, false)
      else return
      setFeedbackTask(f => (f?.id === item.item_id ? null : f))
      load()
      window.dispatchEvent(new CustomEvent('basira:task-updated'))
      window.dispatchEvent(new CustomEvent('basira:schedule-updated'))
    } catch (err) { notify(err.message) }
  }
  // Delete from Today: a task goes to the trash (undo in the toast, 30 days in
  // Trash); a ticket is removed for good after a confirmation.
  async function handleDelete(item) {
    try {
      if (item.source === 'task') {
        await deleteTask(item.item_id)
        load()
        notifyAction(`“${item.title}” moved to trash`, 'Undo', () => restoreTrashItem('task', item.item_id).then(load).catch(e => notify(e.message)))
      } else if (item.source === 'ticket') {
        if (!(await askConfirm(`Delete ticket “${item.title}”? This can't be undone.`, { title: 'Delete ticket' }))) return
        await deleteWorkTicket(item.item_id)
        setOpenTicket(t => (t?.id === item.item_id ? null : t))
        load()
        notify(`Ticket “${item.title}” deleted`, { title: 'Deleted' })
      }
      window.dispatchEvent(new CustomEvent('basira:schedule-updated'))
    } catch (err) { notify(err.message) }
  }
  function completedWithUndo(task) {
    setFeedbackTask(task); setProofFor(null); load()
    notifyAction(`“${task.title}” marked done.`, 'Undo', () => handleUndo({ source: 'task', item_id: task.id, title: task.title }))
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
          <div className="view-toggle" role="group" aria-label="Today view">
            <button onClick={() => chooseView('calendar')} aria-pressed={view === 'calendar'}>Calendar</button>
            <button onClick={() => chooseView('list')} aria-pressed={view === 'list'}>List</button>
          </div>
          <button onClick={() => setShowRhythm(true)} className="ghost-link" title="The repeating shape of your days"><Icon name="settings" size={15}/><span>Rhythm</span></button>
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
        onOpenNotes={setNotesFor}
        onFixTime={setFixTimeFor}
        onCheckHabit={item => { const full = habitById.get(item.item_id); if (full) handleToggleHabit(full) }}
        onOpenPlanner={() => setShowPlanner(true)} />

      {/* One capacity-aware planned / worked line (BAS-031) */}
      <CapacityLine workspace={workspace}
        onOpenDetail={() => setShowTimeDetail(true)}
        onSettingsChanged={() => refreshWorkspace?.()} />

      {/* Habits as daily check marks — off the schedule (BAS-038) */}
      <RoutineStrip routines={routines}
        onToggle={h => { const full = habitById.get(h.id); if (full) handleToggleHabit(full) }}
        onOpenNotes={h => setNotesFor({ item_id: h.id, title: h.title, project_title: 'Routine', source: 'habit' })}
        onAddToDay={() => setShowPlanner(true)} />

      {/* The day as a timeline: rhythm blocks shape it; every item sits at its time. */}
      {view === 'calendar' && <DayCalendar workspace={workspace} isToday timer={timer} actions={itemActions}
        onAddToBlock={b => setShowQuickAdd({ companyId: b.target_ref?.startsWith('company:') ? b.target_ref.slice(8) : '', goalId: b.target_ref?.startsWith('goal:') ? b.target_ref.slice(5) : '' })}
        onEditRhythm={() => setShowRhythm(true)}
        onCreateBlock={defaults => setBlockEditor({ mode: 'create', defaults })}
        onEditBlock={block => setBlockEditor({ mode: 'edit', block })}
        onChanged={() => { refreshWorkspace?.(); window.dispatchEvent(new CustomEvent('basira:schedule-updated')) }} />}

      {/* The list: the same day in reading order — each block with its work, then what is
          outside a block, then Completed. In calendar view only Completed shows here. */}
      <DayAgenda
        blocks={view === 'list' ? (workspace?.blocks || []) : []}
        onEditBlock={block => setBlockEditor({ mode: 'edit', block })}
        onSkipBlock={view === 'list' ? skipBlock : undefined}
        skippedBlocks={view === 'list' ? (workspace?.skipped_blocks || []) : []}
        onRestoreBlock={restoreBlock}
        scheduled={view === 'list' ? scheduled : []}
        anytime={view === 'list' ? anytimeItems : []}
        completed={completedItems} hideEmpty={view === 'calendar'}
        timer={timer}
        onStartTask={itemActions.start} onPauseTask={itemActions.pause} onResumeTask={itemActions.resume}
        onCompleteTask={itemActions.complete} onOpenTicket={handleOpenTicket} onOpenNotes={setNotesFor}
        onCheckHabit={itemActions.toggleHabit} onEditTime={handleEditTime}
        onPostpone={setPostponeFor} onUndo={handleUndo} onDelete={handleDelete} onFixTime={setFixTimeFor}
        onMoveIntoBlock={itemActions.moveIntoBlock} onAddBlockHere={itemActions.addBlockHere}
      />

      {/* Next six days at a glance; opens the planner on that day (BAS-046) */}
      <UpcomingStrip today={data.date} onPlanDay={d => setShowPlanner(d)} />

      {/* Post-task feeling popover */}
      {feedbackTask && (
        <div className="flex justify-center">
          <PostTaskFeedback taskTitle={feedbackTask.title} onSelect={handleFeelingSelect} onDismiss={() => setFeedbackTask(null)} />
        </div>
      )}

      {/* Postpone a task/ticket to another day, with why */}
      {postponeFor && (
        <PostponeDialog item={postponeFor} today={data.date} onClose={() => setPostponeFor(null)}
          onDone={() => { setPostponeFor(null); load() }} />
      )}

      {/* Quick capture */}
      {showQuickAdd && (
        <Modal title="Add to today" onClose={() => setShowQuickAdd(false)}>
          <FindOrCreateComposer
            placeholder="Find an existing ticket/task/habit/goal, or type a new title…"
            defaultCompanyId={showQuickAdd?.companyId} defaultGoalId={showQuickAdd?.goalId}
            onDone={(r) => { setShowQuickAdd(false); if (r) { load(); refreshWorkspace?.() } }}
          />
        </Modal>
      )}

      {/* Time detail */}
      {showTimeDetail && workspace && (
        <TimeDetailDrawer workspace={workspace} onClose={() => setShowTimeDetail(false)} onLogged={() => refreshWorkspace?.()} />
      )}

      {/* Fix time: a timer left running, or a session that ran too long */}
      {fixTimeFor && (
        <FixTimeDialog item={fixTimeFor} onClose={() => setFixTimeFor(null)} onChanged={() => { refreshWorkspace?.(); load() }} />
      )}

      {/* Time-log modal */}
      {timeLogFor && (
        <TimeLogModal task={timeLogFor} onConfirm={(minutes) => handleCompleteWithTime(timeLogFor, minutes)} onClose={() => setTimeLogFor(null)} />
      )}

      {/* Morning planning workspace */}
      {showPlanner && (
        <MorningPlanner date={data.date}
          initialDay={typeof showPlanner === 'string' ? showPlanner : undefined}
          onClose={() => setShowPlanner(false)}
          onPlanned={() => { load(); refreshWorkspace?.(); window.dispatchEvent(new CustomEvent('basira:schedule-updated')) }} />
      )}

      {/* Ticket drawer */}
      {openTicket && (
        <TicketDrawer ticket={openTicket}
          onClose={() => { setOpenTicket(null); refreshWorkspace?.() }}
          onDelete={() => { const t = openTicket; setOpenTicket(null); load(); notify(`Ticket “${t.title}” deleted`, { title: 'Deleted' }); window.dispatchEvent(new CustomEvent('basira:schedule-updated')) }}
          onUpdate={updated => { setOpenTicket(updated); refreshWorkspace?.(); window.dispatchEvent(new CustomEvent('basira:schedule-updated')) }} />
      )}

      {/* Add or change a block for this day (or the rhythm) */}
      {blockEditor && (
        <BlockEditor mode={blockEditor.mode} block={blockEditor.block} defaults={blockEditor.defaults} date={data.date}
          existingRhythmIds={[...(workspace?.blocks || []), ...(workspace?.skipped_blocks || [])].map(b => b.rhythm_id).filter(Boolean)}
          onSkipDay={b => { setBlockEditor(null); skipBlock(b) }}
          onClose={() => setBlockEditor(null)}
          onSaved={() => { refreshWorkspace?.(); window.dispatchEvent(new CustomEvent('basira:schedule-updated')) }} />
      )}

      {/* The weekly rhythm template */}
      {showRhythm && <RhythmModal onClose={() => { setShowRhythm(false); refreshWorkspace?.() }} onChanged={() => refreshWorkspace?.()} />}

      {/* Notes on a task or daily/habit task (BAS-045) */}
      {notesFor && <TaskNotesDialog item={notesFor} onClose={() => setNotesFor(null)} onChanged={load} />}

      {/* Proof modals */}
      {proofFor && <CompleteTaskDialog task={proofFor} onClose={() => setProofFor(null)} onComplete={() => completedWithUndo(proofFor)}/>}
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
