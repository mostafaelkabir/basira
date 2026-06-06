import { useEffect, useState } from 'react'
import { addProof, completeTask, createTask, deleteTask, getGoal, getGoals, getTimerToday, logManualTime, pinTask, reorderTasks, updateTask, uploadProofFile, uploadProofImage } from './api'
import { useTimer } from './TimerContext'
import EstimatedTimePicker, { formatDuration } from './components/EstimatedTimePicker'
import { ActivityComments } from './components/ActivityComposer'
import { GoalIcon } from './GoalsPage'
import Modal from './components/Modal'
import TimeLogModal from './components/TimeLogModal'
import { getDueDateMeta, sortByDueDate } from './utils'
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core'
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

function SortableTaskItem({ id, children }) {
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

const FREQ_OPTIONS = [
  { value: 'daily',   label: 'Daily',    desc: 'Every day' },
  { value: '2x_day',  label: '2× day',   desc: 'Twice daily' },
  { value: '3x_day',  label: '3× day',   desc: '3 times daily' },
  { value: '5x_week', label: '5× week',  desc: '5 days a week' },
  { value: '3x_week', label: '3× week',  desc: '3 days a week' },
  { value: '2x_week', label: '2× week',  desc: '2 days a week' },
  { value: '1x_week', label: 'Weekly',   desc: 'Once a week' },
]

function freqLabel(f) {
  return FREQ_OPTIONS.find(o => o.value === f)?.label ?? 'Daily'
}

export default function GoalPage({ goalId, onBack, onGoToGoal }) {
  const { startTimer } = useTimer()
  const [goal, setGoal] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showNewTask, setShowNewTask] = useState(false)
  const [taskForm, setTaskForm] = useState({ title: '', requires_proof: true, due_date: '', habit_frequency: 'daily', is_urgent: false, is_important: false, estimated_minutes: null })
  const [addingSubtaskFor, setAddingSubtaskFor] = useState(null) // parent task id
  const [subtaskTitle, setSubtaskTitle] = useState('')
  const [editingTask, setEditingTask] = useState(null)
  const [editForm, setEditForm] = useState({ title: '', goal_id: '', due_date: '', habit_frequency: 'daily', requires_proof: false, is_urgent: false, is_important: false, estimated_minutes: null })
  const [allGoals, setAllGoals] = useState([])
  const [todaySeconds, setTodaySeconds] = useState({})
  const [timeLogFor, setTimeLogFor]     = useState(null)
  const [proofFor, setProofFor] = useState(null)
  const [proofForm, setProofForm] = useState({ type: 'text', content: '', imageFile: null, imagePreview: null })
  const [submitting, setSubmitting] = useState(false)
  const [localTaskOrder, setLocalTaskOrder] = useState(null)
  const taskSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  async function load() {
    try {
      const [g, timerData] = await Promise.all([getGoal(goalId), getTimerToday().catch(() => ({ tasks: [] }))])
      setGoal(g)
      setLocalTaskOrder(null)
      const secs = {}
      for (const e of (timerData.tasks || [])) secs[e.task_id] = e.seconds
      setTodaySeconds(secs)
    }
    catch (err) { alert(err.message) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [goalId])

  // Refresh when the timer overlay adds a comment/proof to any task
  useEffect(() => {
    function onTaskUpdated() { load() }
    window.addEventListener('basira:task-updated', onTaskUpdated)
    return () => window.removeEventListener('basira:task-updated', onTaskUpdated)
  }, [])

  async function handleCreateTask(e) {
    e.preventDefault()
    if (!taskForm.title.trim()) return
    setSubmitting(true)
    try {
      await createTask({
        title: taskForm.title,
        goal_id: goalId,
        requires_proof: taskForm.requires_proof,
        due_date: taskForm.due_date || null,
        habit_frequency: taskForm.habit_frequency,
        is_urgent: taskForm.is_urgent,
        is_important: taskForm.is_important,
        estimated_minutes: taskForm.estimated_minutes,
      })
      setTaskForm({ title: '', requires_proof: true, due_date: '', habit_frequency: 'daily', is_urgent: false, is_important: false, estimated_minutes: null })
      setShowNewTask(false)
      load()
    } catch (err) { alert(err.message) }
    finally { setSubmitting(false) }
  }

  async function handleCreateSubtask(e, parentTaskId) {
    e.preventDefault()
    if (!subtaskTitle.trim()) return
    setSubmitting(true)
    try {
      await createTask({ title: subtaskTitle.trim(), goal_id: goalId, requires_proof: false, parent_task_id: parentTaskId })
      setAddingSubtaskFor(null); setSubtaskTitle(''); load()
    } catch (err) { alert(err.message) }
    finally { setSubmitting(false) }
  }

  async function handleEditTask(e) {
    e.preventDefault()
    if (!editForm.title.trim()) return
    setSubmitting(true)
    try {
      await updateTask(editingTask.id, {
        title: editForm.title,
        goal_id: editForm.goal_id || null,
        due_date: editForm.due_date || null,
        habit_frequency: editForm.habit_frequency,
        requires_proof: editForm.requires_proof,
        is_urgent: editForm.is_urgent,
        is_important: editForm.is_important,
        estimated_minutes: editForm.estimated_minutes,
      })
      setEditingTask(null)
      load()
    } catch (err) { alert(err.message) }
    finally { setSubmitting(false) }
  }

  async function handleComplete(taskId) {
    // Search top-level tasks and their subtasks
    const allTasks = (goal?.tasks ?? [])
    const task = allTasks.find(t => t.id === taskId)
      ?? allTasks.flatMap(t => t.sub_tasks ?? []).find(s => s.id === taskId)
    // Ask for time if no timer was logged today for this task
    if (task && !todaySeconds[taskId]) { setTimeLogFor(task); return }
    try { await completeTask(taskId); load() }
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

  async function handlePinSubtask(subtaskId) {
    const today = new Date().toISOString().split('T')[0]
    try { await pinTask(subtaskId, today); load() }
    catch (err) { alert(err.message) }
  }

  async function handleDeleteTask(taskId) {
    if (!confirm('Delete this task?')) return
    try { await deleteTask(taskId); load() }
    catch (err) { alert(err.message) }
  }

  async function handleAddProof(e) {
    e.preventDefault()
    setSubmitting(true)
    try {
      let content = proofForm.content.trim()
      if (proofForm.type === 'image') {
        if (!proofForm.imageFile) return
        const { url } = await uploadProofImage(proofForm.imageFile)
        content = url
      } else if (proofForm.type === 'file') {
        if (!proofForm.imageFile) return
        const { url, name } = await uploadProofFile(proofForm.imageFile)
        content = JSON.stringify({ url, name })
      } else if (!content) return
      await addProof(proofFor, { type: proofForm.type, content })
      setProofFor(null)
      setProofForm({ type: 'text', content: '', imageFile: null, imagePreview: null })
      load()
    } catch (err) { alert(err.message) }
    finally { setSubmitting(false) }
  }

  function handleImageSelect(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setProofForm(p => ({ ...p, imageFile: file, imagePreview: URL.createObjectURL(file) }))
  }

  function handleFileSelect(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setProofForm(p => ({ ...p, imageFile: file }))
  }

  if (loading) return <p className="text-[#6B6B6B] text-sm">Loading…</p>
  if (!goal) return <p className="text-terra-400 text-sm">Goal not found.</p>

  const isResolution = goal.type === 'resolution'
  const isUmbrella   = (goal.sub_goals?.length ?? 0) > 0
  const rawTodoTasks = goal.tasks
    .filter((t) => t.status === 'todo')
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  const todoTasks = localTaskOrder
    ? localTaskOrder.map(id => rawTodoTasks.find(t => t.id === id)).filter(Boolean)
    : rawTodoTasks
  const doneTasks = goal.tasks.filter((t) => t.status === 'done')

  async function handleTaskDragEnd(event) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIdx = todoTasks.findIndex(t => t.id === active.id)
    const newIdx = todoTasks.findIndex(t => t.id === over.id)
    const reordered = arrayMove(todoTasks, oldIdx, newIdx)
    setLocalTaskOrder(reordered.map(t => t.id))
    try {
      await reorderTasks(reordered.map((t, i) => ({ id: t.id, sort_order: i * 10 })))
    } catch { /* silently fail */ }
  }

  // For umbrella projects, aggregate task counts across sub-goals too
  const allTaskCount = goal.tasks.length + (isUmbrella
    ? goal.sub_goals.reduce((s, sg) => s + sg.task_count, 0) : 0)
  const allDoneCount = doneTasks.length + (isUmbrella
    ? goal.sub_goals.reduce((s, sg) => s + sg.done_count, 0) : 0)
  const pct = allTaskCount > 0 ? Math.round((allDoneCount / allTaskCount) * 100) : 0

  return (
    <div>
      <button onClick={onBack} className="text-sm text-[#2D7A6B] hover:text-[#1B3A2D] mb-5 flex items-center gap-1 font-medium">
        ← Back to Goals
      </button>

      {/* Parent breadcrumb */}
      {goal.parent_id && goal.parent_title && onGoToGoal && (
        <button onClick={() => onGoToGoal(goal.parent_id)}
          className="flex items-center gap-1.5 text-xs text-[#6B6B6B] hover:text-[#2D7A6B] transition-colors mb-3 -mt-2">
          <span className="text-[10px]">◈</span>
          <span>{goal.parent_title}</span>
          <span>→</span>
        </button>
      )}

      <div className="mb-6">
        <div className="flex items-start gap-4 mb-2">
          {goal.icon && (
            <div className="w-14 h-14 rounded-2xl bg-[#1B3A2D] flex items-center justify-center flex-shrink-0">
              <GoalIcon icon={goal.icon} size="xl" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-[#1A1A1A]">{goal.title}</h1>
            {goal.description && <p className="text-[#6B6B6B] mt-1 text-sm">{goal.description}</p>}
          </div>
        </div>
        {allTaskCount > 0 && (
          <div className="mt-3">
            <div className="flex justify-between text-xs text-[#6B6B6B] mb-1.5">
              <span>{allDoneCount}/{allTaskCount} {isResolution ? 'habits' : 'tasks'}{isUmbrella ? ' total' : ''}</span>
              <span className="font-medium text-[#1A1A1A]">{pct}%</span>
            </div>
            <div className="w-full bg-[#E8E3DB] rounded-full h-1.5">
              <div className={`h-1.5 rounded-full transition-all ${pct === 100 ? 'bg-sage-400' : 'bg-[#2D7A6B]'}`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}
      </div>

      {/* Sub-projects section */}
      {isUmbrella && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold text-[#1A1A1A]">Sub-projects</h2>
          </div>
          <div className="space-y-2">
            {goal.sub_goals.map(sg => {
              const sgPct = sg.task_count > 0 ? Math.round((sg.done_count / sg.task_count) * 100) : 0
              return (
                <button key={sg.id} onClick={() => onGoToGoal?.(sg.id)}
                  className="w-full bg-white border border-[#E8E3DB] rounded-2xl p-4 text-left hover:shadow-md hover:border-[#2D7A6B]/30 transition-all group shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
                  <div className="flex items-center gap-3">
                    <GoalIcon icon={sg.icon} size="sm" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[#1A1A1A] group-hover:text-[#1B3A2D] transition-colors">{sg.title}</p>
                      {sg.task_count > 0 && (
                        <p className="text-xs text-[#6B6B6B] mt-0.5">{sg.done_count}/{sg.task_count} tasks · {sgPct}%</p>
                      )}
                    </div>
                    {sg.task_count > 0 && (
                      <div className="w-20 flex-shrink-0">
                        <div className="w-full bg-[#E8E3DB] rounded-full h-1">
                          <div className={`h-1 rounded-full ${sgPct === 100 ? 'bg-sage-400' : 'bg-[#2D7A6B]'}`}
                            style={{ width: `${sgPct}%` }} />
                        </div>
                      </div>
                    )}
                    <span className="text-[#b5a08a] group-hover:text-[#2D7A6B] text-sm transition-colors flex-shrink-0">→</span>
                  </div>
                </button>
              )
            })}
          </div>
          {goal.tasks.length > 0 && (
            <div className="flex items-center gap-3 mt-5 mb-2">
              <span className="flex-1 border-t border-[#E8E3DB]" />
              <span className="text-[10px] font-bold text-[#6B6B6B] uppercase tracking-widest whitespace-nowrap">Tasks on this project</span>
              <span className="flex-1 border-t border-[#E8E3DB]" />
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between mb-2">
        <h2 className="font-bold text-[#1A1A1A] uppercase tracking-wide text-sm">{isResolution ? 'Habits' : 'Tasks'}</h2>
        <button onClick={() => setShowNewTask(true)}
          className="bg-[#1B3A2D] text-white px-3 py-1.5 rounded-xl text-sm font-medium hover:bg-[#2a5240] transition-colors shadow-sm">
          + {isResolution ? 'Add Habit' : 'Add Task'}
        </button>
      </div>

      {isResolution && (
        <p className="text-xs text-[#6B6B6B] mb-4">Check in on habits daily from the <strong>Today</strong> tab.</p>
      )}

      {goal.tasks.length === 0 ? (
        <div className="text-center py-16 text-[#6B6B6B]">
          <div className="text-3xl mb-3 text-[#E8C334]">{isResolution ? '✦' : '◈'}</div>
          <p className="font-medium">No {isResolution ? 'habits' : 'tasks'} yet</p>
        </div>
      ) : (
        <DndContext sensors={taskSensors} collisionDetection={closestCenter} onDragEnd={handleTaskDragEnd}>
        <SortableContext items={todoTasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
        <div className="space-y-2">
          {todoTasks.map((task) => (
            <SortableTaskItem key={task.id} id={task.id}>
              {(dragListeners) => (
            <TaskCard task={task} isHabit={isResolution}
              dragListeners={dragListeners}
              onStartTimer={isResolution ? null : () => startTimer(task.id, task.title, goal?.title || '')}
              onComplete={isResolution ? null : () => handleComplete(task.id)}
              onDelete={() => handleDeleteTask(task.id)}
              onAddProof={isResolution ? null : () => setProofFor(task.id)}
              onEdit={async () => {
                setEditingTask(task)
                setEditForm({ title: task.title, goal_id: task.goal_id, due_date: task.due_date || '', habit_frequency: task.habit_frequency || 'daily', requires_proof: task.requires_proof, is_urgent: task.is_urgent || false, is_important: task.is_important || false, estimated_minutes: task.estimated_minutes || null })
                if (allGoals.length === 0) setAllGoals(await getGoals())
              }}
              onCommentAdded={load}
              onAddSubtask={isResolution ? null : () => { setAddingSubtaskFor(task.id); setSubtaskTitle('') }}
              addingSubtask={addingSubtaskFor === task.id}
              subtaskTitle={subtaskTitle}
              onSubtaskTitleChange={setSubtaskTitle}
              onSubtaskSubmit={(e) => handleCreateSubtask(e, task.id)}
              onSubtaskCancel={() => { setAddingSubtaskFor(null); setSubtaskTitle('') }}
              onCompleteSubtask={(id) => handleComplete(id)}
              onDeleteSubtask={(id) => handleDeleteTask(id)}
              onPinSubtask={handlePinSubtask}
              submitting={submitting}
            />
              )}
            </SortableTaskItem>
          ))}
          {doneTasks.length > 0 && (
            <div className="pt-2">
              {todoTasks.length > 0 && (
                <p className="text-xs font-medium text-sand-400 uppercase tracking-wider mb-2 pt-2">Completed</p>
              )}
              {doneTasks.map((task) => (
                <TaskCard key={task.id} task={task} onDelete={() => handleDeleteTask(task.id)} onCommentAdded={load} />
              ))}
            </div>
          )}
        </div>
        </SortableContext>
        </DndContext>
      )}

      {/* New task modal */}
      {showNewTask && (
        <Modal title={isResolution ? 'Add Habit' : 'Add Task'}
          onClose={() => { setShowNewTask(false); setTaskForm({ title: '', requires_proof: true, due_date: '' }) }}>
          <form onSubmit={handleCreateTask} className="space-y-4">
            <div>
              <label className="text-sm font-medium text-[#1A1A1A]">Title</label>
              <input autoFocus value={taskForm.title} onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })}
                placeholder={isResolution ? 'e.g. Study 20 min' : 'e.g. Complete application'}
                className="mt-1.5 w-full border border-[#E8E3DB] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2D7A6B] focus:border-transparent bg-white placeholder:text-[#b5a08a]" />
            </div>
            {isResolution && (
              <>
                <div>
                  <label className="text-sm font-medium text-[#1A1A1A]">Frequency</label>
                  <div className="mt-1.5 grid grid-cols-4 gap-1.5">
                    {FREQ_OPTIONS.map(o => (
                      <button key={o.value} type="button"
                        onClick={() => setTaskForm({ ...taskForm, habit_frequency: o.value })}
                        className={`px-2 py-2 rounded-xl border text-xs font-medium transition-colors text-center ${taskForm.habit_frequency === o.value ? 'bg-[#1B3A2D] text-white border-[#1B3A2D]' : 'border-[#E8E3DB] text-[#6B6B6B] hover:border-[#2D7A6B]'}`}>
                        {o.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-[#6B6B6B] mt-1">{FREQ_OPTIONS.find(o => o.value === taskForm.habit_frequency)?.desc}</p>
                </div>
                <label className="flex items-center gap-2.5 text-sm text-[#1A1A1A] cursor-pointer select-none">
                  <input type="checkbox" checked={taskForm.requires_proof}
                    onChange={(e) => setTaskForm({ ...taskForm, requires_proof: e.target.checked })}
                    className="w-4 h-4 rounded accent-[#2D7A6B]" />
                  Requires proof to check in
                </label>
              </>
            )}
            {!isResolution && (
              <>
                <div>
                  <label className="text-sm font-medium text-[#1A1A1A]">Due date <span className="text-[#6B6B6B] font-normal">(optional)</span></label>
                  <input type="date" value={taskForm.due_date} onChange={(e) => setTaskForm({ ...taskForm, due_date: e.target.value })}
                    className="mt-1.5 w-full border border-[#E8E3DB] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2D7A6B] focus:border-transparent bg-white" />
                </div>
                <label className="flex items-center gap-2.5 text-sm text-[#1A1A1A] cursor-pointer select-none">
                  <input type="checkbox" checked={taskForm.requires_proof}
                    onChange={(e) => setTaskForm({ ...taskForm, requires_proof: e.target.checked })}
                    className="w-4 h-4 rounded accent-[#2D7A6B]" />
                  Requires proof to complete
                </label>
              </>
            )}
            {!isResolution && (
              <div>
                <label className="text-sm font-medium text-[#1A1A1A] block mb-1.5">Tags</label>
                <TagToggles urgent={taskForm.is_urgent} important={taskForm.is_important}
                  onToggleUrgent={() => setTaskForm(f => ({ ...f, is_urgent: !f.is_urgent }))}
                  onToggleImportant={() => setTaskForm(f => ({ ...f, is_important: !f.is_important }))} />
              </div>
            )}
            {!isResolution && (
              <EstimatedTimePicker
                value={taskForm.estimated_minutes}
                onChange={v => setTaskForm(f => ({ ...f, estimated_minutes: v }))}
              />
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => { setShowNewTask(false); setTaskForm({ title: '', requires_proof: true, due_date: '', is_urgent: false, is_important: false, estimated_minutes: null }) }}
                className="px-4 py-2 text-sm text-[#6B6B6B] hover:text-[#1A1A1A]">Cancel</button>
              <button type="submit" disabled={submitting || !taskForm.title.trim()}
                className="bg-[#1B3A2D] text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-[#2a5240] disabled:opacity-40">
                {isResolution ? 'Add Habit' : 'Add Task'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Edit task modal */}
      {editingTask && (
        <Modal title={isResolution ? 'Edit Habit' : 'Edit Task'} onClose={() => setEditingTask(null)}>
          <form onSubmit={handleEditTask} className="space-y-4">
            <div>
              <label className="text-sm font-medium text-[#1A1A1A]">Title</label>
              <input autoFocus value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                className="mt-1.5 w-full border border-[#E8E3DB] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2D7A6B] focus:border-transparent bg-white" />
            </div>
            {allGoals.length > 1 && (
              <div>
                <label className="text-sm font-medium text-[#1A1A1A]">Project</label>
                <select value={editForm.goal_id}
                  onChange={e => setEditForm({ ...editForm, goal_id: e.target.value })}
                  className="mt-1.5 w-full border border-[#E8E3DB] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2D7A6B] bg-white text-[#1A1A1A]">
                  {allGoals.map(g => (
                    <option key={g.id} value={g.id}>{g.title}</option>
                  ))}
                </select>
              </div>
            )}
            {isResolution ? (
              <div>
                <label className="text-sm font-medium text-[#1A1A1A]">Frequency</label>
                <div className="mt-1.5 grid grid-cols-4 gap-1.5">
                  {FREQ_OPTIONS.map(o => (
                    <button key={o.value} type="button"
                      onClick={() => setEditForm({ ...editForm, habit_frequency: o.value })}
                      className={`px-2 py-2 rounded-xl border text-xs font-medium transition-colors text-center ${editForm.habit_frequency === o.value ? 'bg-[#1B3A2D] text-white border-[#1B3A2D]' : 'border-[#E8E3DB] text-[#6B6B6B] hover:border-[#2D7A6B]'}`}>
                      {o.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-[#6B6B6B] mt-1">{FREQ_OPTIONS.find(o => o.value === editForm.habit_frequency)?.desc}</p>
              </div>
            ) : (
              <div>
                <label className="text-sm font-medium text-[#1A1A1A]">Due date <span className="text-[#6B6B6B] font-normal">(optional)</span></label>
                <input type="date" value={editForm.due_date} onChange={(e) => setEditForm({ ...editForm, due_date: e.target.value })}
                  className="mt-1.5 w-full border border-[#E8E3DB] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2D7A6B] focus:border-transparent bg-white" />
                {editForm.due_date && (
                  <button type="button" onClick={() => setEditForm({ ...editForm, due_date: '' })}
                    className="text-xs text-[#6B6B6B] hover:text-[#1A1A1A] mt-1">Clear date</button>
                )}
              </div>
            )}
            <label className="flex items-center gap-2.5 text-sm text-[#1A1A1A] cursor-pointer select-none">
              <input type="checkbox" checked={editForm.requires_proof}
                onChange={(e) => setEditForm({ ...editForm, requires_proof: e.target.checked })}
                className="w-4 h-4 rounded accent-[#2D7A6B]" />
              Requires proof to {isResolution ? 'check in' : 'complete'}
            </label>
            {!isResolution && (
              <div>
                <label className="text-sm font-medium text-[#1A1A1A] block mb-1.5">Tags</label>
                <TagToggles urgent={editForm.is_urgent} important={editForm.is_important}
                  onToggleUrgent={() => setEditForm(f => ({ ...f, is_urgent: !f.is_urgent }))}
                  onToggleImportant={() => setEditForm(f => ({ ...f, is_important: !f.is_important }))} />
              </div>
            )}
            {!isResolution && (
              <EstimatedTimePicker
                value={editForm.estimated_minutes}
                onChange={v => setEditForm(f => ({ ...f, estimated_minutes: v }))}
              />
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setEditingTask(null)} className="px-4 py-2 text-sm text-[#6B6B6B] hover:text-[#1A1A1A]">Cancel</button>
              <button type="submit" disabled={submitting || !editForm.title.trim()}
                className="bg-[#1B3A2D] text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-[#2a5240] disabled:opacity-40">
                Save
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Time-log modal */}
      {timeLogFor && (
        <TimeLogModal
          task={timeLogFor}
          onConfirm={(minutes) => handleCompleteWithTime(timeLogFor, minutes)}
          onClose={() => setTimeLogFor(null)}
        />
      )}

      {/* Proof modal */}
      {proofFor && (
        <Modal title="Add Proof" onClose={() => { setProofFor(null); setProofForm({ type: 'text', content: '', imageFile: null, imagePreview: null }) }}>
          <ProofForm proofForm={proofForm} setProofForm={setProofForm} onSubmit={handleAddProof} submitting={submitting}
            onCancel={() => { setProofFor(null); setProofForm({ type: 'text', content: '', imageFile: null, imagePreview: null }) }}
            onImageSelect={handleImageSelect} onFileSelect={handleFileSelect} submitLabel="Submit Proof" />
        </Modal>
      )}
    </div>
  )
}

// ─── Urgency / Importance ─────────────────────────────────────────────────────

export function TaskTags({ urgent, important, small = false }) {
  if (!urgent && !important) return null
  const sz = small ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-0.5'
  return (
    <div className="flex items-center gap-1 flex-shrink-0">
      {urgent && (
        <span className={`${sz} rounded-md font-medium border bg-terra-50 text-terra-500 border-terra-200`}>↑ Urgent</span>
      )}
      {important && (
        <span className={`${sz} rounded-md font-medium border bg-gold-50 text-gold-600 border-gold-200`}>★ Important</span>
      )}
    </div>
  )
}

export function TagToggles({ urgent, important, onToggleUrgent, onToggleImportant }) {
  return (
    <div className="flex gap-2">
      <button type="button" onClick={onToggleUrgent}
        className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors ${urgent ? 'bg-terra-400 text-white border-terra-400' : 'border-[#E8E3DB] text-[#6B6B6B] hover:border-terra-400 hover:text-terra-400'}`}>
        ↑ Urgent
      </button>
      <button type="button" onClick={onToggleImportant}
        className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors ${important ? 'bg-[#E8C334] text-[#1A1A1A] border-[#E8C334]' : 'border-[#E8E3DB] text-[#6B6B6B] hover:border-[#E8C334] hover:text-[#E8C334]'}`}>
        ★ Important
      </button>
    </div>
  )
}

const FILE_ICONS = { pdf: '📄', doc: '📝', docx: '📝', txt: '📃', md: '📃', pages: '📝', rtf: '📃', csv: '📊', xlsx: '📊', xls: '📊' }

function fileIcon(url) {
  const ext = (url || '').split('.').pop().toLowerCase()
  return FILE_ICONS[ext] || '📎'
}

function fileName(url) {
  return decodeURIComponent((url || '').split('/').pop())
}

export function ProofForm({ proofForm, setProofForm, onSubmit, submitting, onCancel, onImageSelect, onFileSelect, submitLabel = 'Submit Proof' }) {
  const isImage = proofForm.type === 'image'
  const isFile = proofForm.type === 'file'
  const canSubmit = (isImage || isFile) ? !!proofForm.imageFile : !!proofForm.content.trim()

  useEffect(() => {
    function onPaste(e) {
      const item = Array.from(e.clipboardData?.items || []).find(i => i.type.startsWith('image/'))
      if (!item) return
      e.preventDefault()
      const file = item.getAsFile()
      setProofForm(p => ({ ...p, type: 'image', imageFile: file, imagePreview: URL.createObjectURL(file), content: '' }))
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [setProofForm])

  const TYPES = [
    { key: 'text',  label: 'Text' },
    { key: 'link',  label: 'Link' },
    { key: 'image', label: '🖼 Image' },
    { key: 'file',  label: '📎 File' },
  ]

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="text-sm font-medium text-[#1A1A1A]">Type</label>
        <div className="mt-1.5 flex gap-2 flex-wrap">
          {TYPES.map(({ key, label }) => (
            <button key={key} type="button"
              onClick={() => setProofForm({ ...proofForm, type: key, content: '', imageFile: null, imagePreview: null })}
              className={`px-3 py-1.5 rounded-xl text-sm font-medium border transition-colors ${proofForm.type === key ? 'bg-[#1B3A2D] text-white border-[#1B3A2D]' : 'border-[#E8E3DB] text-[#6B6B6B] hover:border-[#2D7A6B]'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {isImage && (
        <div>
          {proofForm.imagePreview ? (
            <div className="relative">
              <img src={proofForm.imagePreview} alt="Preview" className="max-h-48 w-full rounded-xl object-cover" />
              <button type="button"
                onClick={() => setProofForm(p => ({ ...p, imageFile: null, imagePreview: null }))}
                className="absolute top-1.5 right-1.5 bg-white rounded-full w-6 h-6 flex items-center justify-center text-xs shadow hover:text-terra-400 transition-colors">✕</button>
            </div>
          ) : (
            <label className="block border-2 border-dashed border-[#E8E3DB] rounded-xl px-4 py-8 text-center cursor-pointer hover:border-[#2D7A6B] transition-colors">
              <p className="text-sm text-[#6B6B6B] mb-1">Click to browse or paste a screenshot</p>
              <p className="text-xs text-[#b5a08a]">⌘V to paste · JPG, PNG, GIF, WebP</p>
              <input type="file" accept="image/*" className="hidden" onChange={onImageSelect} />
            </label>
          )}
        </div>
      )}

      {isFile && (
        <div>
          {proofForm.imageFile ? (
            <div className="flex items-center gap-3 border border-[#E8E3DB] rounded-xl px-4 py-3 bg-[#F2EDE4]">
              <span className="text-2xl">{fileIcon(proofForm.imageFile.name)}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[#1A1A1A] truncate">{proofForm.imageFile.name}</p>
                <p className="text-xs text-[#6B6B6B]">{(proofForm.imageFile.size / 1024).toFixed(0)} KB</p>
              </div>
              <button type="button"
                onClick={() => setProofForm(p => ({ ...p, imageFile: null, imagePreview: null }))}
                className="text-[#b5a08a] hover:text-terra-400 transition-colors text-sm">✕</button>
            </div>
          ) : (
            <label className="block border-2 border-dashed border-[#E8E3DB] rounded-xl px-4 py-8 text-center cursor-pointer hover:border-[#2D7A6B] transition-colors">
              <p className="text-2xl mb-2">📎</p>
              <p className="text-sm text-[#6B6B6B] mb-1">Click to attach a document</p>
              <p className="text-xs text-[#b5a08a]">PDF, DOC, DOCX, TXT, MD, Pages, CSV, XLSX</p>
              <input type="file"
                accept=".pdf,.doc,.docx,.txt,.md,.pages,.rtf,.csv,.xlsx,.xls"
                className="hidden" onChange={onFileSelect} />
            </label>
          )}
        </div>
      )}

      {!isImage && !isFile && (
        <div>
          <label className="text-sm font-medium text-[#1A1A1A]">{proofForm.type === 'link' ? 'URL' : 'What did you do?'}</label>
          <textarea autoFocus value={proofForm.content} onChange={(e) => setProofForm({ ...proofForm, content: e.target.value })}
            placeholder={proofForm.type === 'link' ? 'https://…' : 'Describe what you completed…'} rows={3}
            className="mt-1.5 w-full border border-[#E8E3DB] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2D7A6B] resize-none bg-white placeholder:text-[#b5a08a]" />
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className="px-4 py-2 text-sm text-[#6B6B6B] hover:text-[#1A1A1A]">Cancel</button>
        <button type="submit" disabled={submitting || !canSubmit}
          className="bg-[#1B3A2D] text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-[#2a5240] disabled:opacity-40">
          {submitLabel}
        </button>
      </div>
    </form>
  )
}

const FILE_EXT_ICONS = { pdf: '📄', doc: '📝', docx: '📝', txt: '📃', md: '📃', pages: '📝', rtf: '📃', csv: '📊', xlsx: '📊', xls: '📊' }

function extIcon(name) {
  const ext = (name || '').split('.').pop().toLowerCase()
  return FILE_EXT_ICONS[ext] || '📎'
}

function ProofDisplay({ proof }) {
  if (proof.type === 'image') {
    return (
      <div className="flex items-start gap-2 text-xs bg-[#F2EDE4] rounded-xl px-3 py-2">
        <img src={proof.content} alt="Proof" className="max-h-32 rounded-lg object-cover" />
      </div>
    )
  }
  if (proof.type === 'file') {
    let url = proof.content, name = proof.content.split('/').pop()
    try { const p = JSON.parse(proof.content); url = p.url; name = p.name } catch {}
    return (
      <a href={url} target="_blank" rel="noopener noreferrer"
        className="flex items-center gap-2 text-xs bg-[#F2EDE4] rounded-xl px-3 py-2 hover:bg-[#2D7A6B]/10 transition-colors group">
        <span className="text-base">{extIcon(name)}</span>
        <span className="text-[#2D7A6B] group-hover:underline truncate flex-1">{name}</span>
        <span className="text-[#6B6B6B] flex-shrink-0">↗</span>
      </a>
    )
  }
  if (proof.type === 'link') {
    return (
      <div className="flex items-start gap-2 text-xs bg-[#F2EDE4] rounded-xl px-3 py-2">
        <span className="font-semibold text-[#6B6B6B] uppercase tracking-wide flex-shrink-0 pt-px">link</span>
        <a href={proof.content} target="_blank" rel="noopener noreferrer" className="text-[#2D7A6B] hover:underline truncate">{proof.content}</a>
      </div>
    )
  }
  return (
    <div className="flex items-start gap-2 text-xs bg-[#F2EDE4] rounded-xl px-3 py-2">
      <span className="font-semibold text-[#6B6B6B] uppercase tracking-wide flex-shrink-0 pt-px">note</span>
      <span className="text-[#1A1A1A]">{proof.content}</span>
    </div>
  )
}

function TaskCard({ task, onComplete, onDelete, onAddProof, onEdit, isHabit, onCommentAdded,
  onAddSubtask, addingSubtask, subtaskTitle, onSubtaskTitleChange, onSubtaskSubmit, onSubtaskCancel,
  onCompleteSubtask, onDeleteSubtask, onPinSubtask, submitting: parentSubmitting, dragListeners, onStartTimer }) {
  const isDone = task.status === 'done'
  const hasProof = task.proofs && task.proofs.length > 0
  const canComplete = !task.requires_proof || hasProof
  const needsProof = task.requires_proof && !hasProof && !isDone
  const dueMeta = getDueDateMeta(task.due_date)
  const activityCount = (task.proofs?.length ?? 0) + (task.comments?.length ?? 0)
  const [expanded, setExpanded] = useState(false)

  const accentBorder = !isDone && (task.is_urgent || task.is_important)
    ? task.is_urgent && task.is_important
      ? 'border-l-[3px] border-l-terra-400'
      : task.is_urgent
        ? 'border-l-[3px] border-l-terra-400'
        : 'border-l-[3px] border-l-gold-400'
    : ''

  return (
    <div className={`bg-white border rounded-2xl transition-all shadow-[0_1px_3px_rgba(0,0,0,0.08)] overflow-hidden ${isDone ? 'border-sage-100' : `border-[#E8E3DB] ${accentBorder}`}`}>
      <div className="flex items-start justify-between gap-3 p-4">
        {dragListeners && !isDone && (
          <button
            {...dragListeners}
            type="button"
            className="cursor-grab active:cursor-grabbing text-[#E8E3DB] hover:text-[#b5a08a] flex-shrink-0 mt-0.5 touch-none select-none text-base leading-none"
            title="Drag to reorder"
          >⠿</button>
        )}
        <div className="flex items-start gap-2.5 flex-1 min-w-0">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 mt-1.5 ${isDone ? 'bg-sage-400' : 'bg-[#E8E3DB]'}`} />
          <div className="flex-1 min-w-0">
            <span className={`text-sm font-medium leading-snug ${isDone ? 'text-[#b5a08a] line-through' : 'text-[#1A1A1A]'}`}>
              {task.title}
            </span>
            {dueMeta && !isDone && (
              <span className={`ml-2 text-xs px-1.5 py-0.5 rounded-md font-medium ${dueMeta.cls}`}>
                {dueMeta.label}
              </span>
            )}
            {!isDone && (task.is_urgent || task.is_important) && (
              <div className="mt-1.5">
                <TaskTags urgent={task.is_urgent} important={task.is_important} />
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          {!isDone && !isHabit && task.estimated_minutes && (
            <span className="text-xs text-[#6B6B6B] font-medium flex-shrink-0">
              ⏱ {formatDuration(task.estimated_minutes)}
            </span>
          )}
          {isHabit && !isDone && (
            <span className="text-xs text-[#2D7A6B] font-medium bg-[#2D7A6B]/10 px-2 py-0.5 rounded-full border border-[#2D7A6B]/20">
              {freqLabel(task.habit_frequency)}
            </span>
          )}
          {needsProof && !isHabit && (
            <button onClick={onAddProof}
              className="text-xs text-[#2D7A6B] border border-[#2D7A6B]/30 px-2.5 py-1 rounded-lg hover:bg-[#2D7A6B]/10 transition-colors font-medium">
              + Proof
            </button>
          )}
          {!isDone && !isHabit && onStartTimer && (
            <button onClick={onStartTimer} title="Start timer"
              className="text-xs px-2.5 py-1 rounded-lg border border-[#2D7A6B]/30 text-[#2D7A6B] hover:bg-[#2D7A6B]/10 transition-colors font-medium">
              ▶
            </button>
          )}
          {!isDone && onComplete && (
            <button onClick={onComplete} disabled={!canComplete}
              title={!canComplete ? 'Add proof first' : 'Mark as done'}
              className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-colors ${canComplete ? 'bg-[#1B3A2D] text-white hover:bg-[#2a5240]' : 'border border-[#E8E3DB] text-[#b5a08a] cursor-not-allowed'}`}>
              ✓ Done
            </button>
          )}
          {isDone && <span className="text-xs text-sage-500 font-medium">✓</span>}
          {!isDone && onEdit && (
            <button onClick={onEdit} className="text-[#b5a08a] hover:text-[#2D7A6B] transition-colors text-sm w-6 h-6 flex items-center justify-center" title="Edit">✎</button>
          )}
          <button onClick={onDelete} className="text-[#E8E3DB] hover:text-terra-400 transition-colors text-sm w-6 h-6 flex items-center justify-center" title="Delete">✕</button>
          <button onClick={() => setExpanded(v => !v)}
            className={`text-xs w-6 h-6 flex items-center justify-center rounded-lg transition-colors ${expanded ? 'text-[#2D7A6B] bg-[#2D7A6B]/10' : 'text-[#b5a08a] hover:text-[#6B6B6B] hover:bg-[#F2EDE4]'}`}
            title="Comments & proof">
            {activityCount > 0 && !expanded
              ? <span className="font-semibold text-[10px] text-[#2D7A6B]">{activityCount}</span>
              : <span>{expanded ? '▴' : '▾'}</span>}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-[#F2EDE4] px-4 pt-3 pb-4 space-y-3">
          {task.proofs?.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-widest">Proof</p>
              {task.proofs.map(proof => <ProofDisplay key={proof.id} proof={proof} />)}
            </div>
          )}
          {!isDone && !isHabit && onAddProof && (
            <button onClick={onAddProof}
              className="text-xs text-[#2D7A6B] border border-dashed border-[#2D7A6B]/30 px-3 py-1.5 rounded-xl hover:bg-[#2D7A6B]/10 transition-colors w-full text-center">
              + Attach Proof
            </button>
          )}
          <ActivityComments task={task} onRefresh={onCommentAdded} />
        </div>
      )}

      {/* Sub-tasks */}
      {!isHabit && (task.sub_tasks?.length > 0 || addingSubtask) && (
        <div className="border-t border-[#F2EDE4] px-4 py-2 space-y-0.5">
          {task.sub_tasks?.map(st => {
            const today = new Date().toISOString().split('T')[0]
            const isInFocus = st.pinned_date === today
            return (
              <div key={st.id} className={`flex items-start gap-2 py-1.5 group rounded-lg px-1 -mx-1 transition-colors
                ${st.status === 'done' ? 'opacity-50' : isInFocus ? 'bg-[#E8C334]/10' : 'hover:bg-[#F2EDE4]'}`}>
                {onCompleteSubtask && st.status !== 'done' ? (
                  <button onClick={() => onCompleteSubtask(st.id)}
                    className="w-4 h-4 rounded-full border border-[#E8E3DB] hover:border-[#2D7A6B] hover:bg-[#2D7A6B]/10 flex items-center justify-center flex-shrink-0 transition-all mt-0.5">
                  </button>
                ) : (
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ml-0.5 mt-1 ${st.status === 'done' ? 'bg-sage-400' : 'bg-[#E8E3DB]'}`} />
                )}
                <div className="flex-1 min-w-0">
                  <span className={`text-sm ${st.status === 'done' ? 'line-through text-[#b5a08a]' : 'text-[#1A1A1A]'}`}>{st.title}</span>
                  {st.status !== 'done' && (st.is_urgent || st.is_important) && (
                    <div className="mt-1"><TaskTags urgent={st.is_urgent} important={st.is_important} small /></div>
                  )}
                </div>
                {isInFocus && (
                  <span className="text-[10px] font-semibold text-[#E8C334] bg-[#E8C334]/10 border border-[#E8C334]/30 px-1.5 py-0.5 rounded-md flex-shrink-0 flex items-center gap-0.5">
                    ✦ Focus
                  </span>
                )}
                {st.status !== 'done' && !isInFocus && onPinSubtask && (
                  <button onClick={() => onPinSubtask(st.id)}
                    title="Pin to today's focus"
                    className="opacity-0 group-hover:opacity-100 transition-all text-xs w-5 h-5 flex items-center justify-center flex-shrink-0 rounded text-[#b5a08a] hover:text-[#E8C334]">
                    ✦
                  </button>
                )}
                {onDeleteSubtask && (
                  <button onClick={() => onDeleteSubtask(st.id)}
                    className="opacity-0 group-hover:opacity-100 text-[#b5a08a] hover:text-terra-400 transition-all text-xs w-5 h-5 flex items-center justify-center flex-shrink-0">✕</button>
                )}
              </div>
            )
          })}
          {addingSubtask && (
            <form onSubmit={onSubtaskSubmit} className="flex items-center gap-2 pt-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[#E8E3DB] flex-shrink-0" />
              <input autoFocus value={subtaskTitle} onChange={e => onSubtaskTitleChange(e.target.value)}
                placeholder="Subtask title…"
                className="flex-1 text-sm border-b border-[#E8E3DB] focus:border-[#2D7A6B] focus:outline-none bg-transparent py-0.5 placeholder:text-[#b5a08a]" />
              <button type="submit" disabled={!subtaskTitle.trim() || parentSubmitting}
                className="text-xs text-[#2D7A6B] font-medium disabled:opacity-40">Add</button>
              <button type="button" onClick={onSubtaskCancel} className="text-xs text-[#6B6B6B]">✕</button>
            </form>
          )}
        </div>
      )}
      {!isHabit && !isDone && onAddSubtask && !addingSubtask && (
        <div className="px-4 pb-2">
          <button onClick={onAddSubtask}
            className="text-xs text-[#6B6B6B] hover:text-[#2D7A6B] transition-colors flex items-center gap-1">
            <span>+</span> Add subtask
          </button>
        </div>
      )}
    </div>
  )
}
