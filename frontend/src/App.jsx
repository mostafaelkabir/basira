import { useEffect, useRef, useState } from 'react'
import AnalyticsPage from './AnalyticsPage'
import ContactsPage from './ContactsPage'
import GoalPage from './GoalPage'
import GoalsPage from './GoalsPage'
import ProgressPage from './ProgressPage'
import SettingsModal from './SettingsModal'
import TodayPage from './TodayPage'
import WeeklyReview from './WeeklyReview'
import WorkPage from './WorkPage'
import Modal from './components/Modal'
import { TimerProvider } from './TimerContext'
import TimerWidget from './TimerWidget'
import EstimatedTimePicker from './components/EstimatedTimePicker'
import { createTask, getGoal, getGoals } from './api'

const NAV_ITEMS = [
  { id: 'today',       label: 'Today',    icon: '📅' },
  { id: 'goals',       label: 'Goals',    icon: '◎' },
  { id: 'work',        label: 'Work',     icon: '⌨️' },
  { id: 'progress',    label: 'Progress', icon: '📊' },
  { id: 'insights',    label: 'Insights', icon: '💡' },
  { id: 'connections', label: 'People',   icon: '👥' },
]

export default function App() {
  const [tab, setTab] = useState('today')
  const [goalId, setGoalId] = useState(null)
  const [showReview, setShowReview] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showAddTask, setShowAddTask] = useState(false)

  function openGoal(id) { setGoalId(id); setTab('goals') }

  return (
    <TimerProvider>
      <div className="min-h-screen bg-[#F2EDE4] flex">

        {/* ── Fixed Left Sidebar ── */}
        <aside className="w-40 flex-shrink-0 fixed top-0 left-0 h-screen bg-white flex flex-col z-20 border-r border-[#E8E3DB]">
          {/* Logo */}
          <div className="px-5 pt-6 pb-4">
            <div className="font-bold text-2xl text-[#1A1A1A] tracking-tight leading-none">SysGo</div>
            <div className="text-[11px] text-[#6B6B6B] mt-0.5 uppercase tracking-wide">Life OS</div>
          </div>

          {/* Add Task button */}
          <div className="px-3 pb-4">
            <button
              onClick={() => setShowAddTask(true)}
              className="w-full bg-[#1B3A2D] text-white text-sm font-semibold py-2.5 rounded-xl hover:bg-[#2a5240] transition-colors flex items-center justify-center gap-1.5">
              <span className="text-base leading-none">+</span> Add Task
            </button>
          </div>

          {/* Nav */}
          <nav className="flex-1 px-2 space-y-1">
            {NAV_ITEMS.map(({ id, label, icon }) => {
              const isActive = tab === id
              return (
                <button
                  key={id}
                  onClick={() => { setTab(id); if (id !== 'goals') setGoalId(null) }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-left ${
                    isActive
                      ? 'bg-[#E8C334] text-[#1A1A1A]'
                      : 'text-[#6B6B6B] hover:bg-[#F2EDE4] hover:text-[#1A1A1A]'
                  }`}>
                  <span className="text-base leading-none flex-shrink-0">{icon}</span>
                  <span>{label}</span>
                </button>
              )
            })}
          </nav>

          {/* Bottom */}
          <div className="px-2 pb-4 space-y-1">
            <button
              onClick={() => setShowReview(true)}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium text-[#6B6B6B] hover:bg-[#F2EDE4] hover:text-[#1A1A1A] transition-all text-left">
              <span className="text-base leading-none">⏱</span>
              <span>Review</span>
            </button>
            <button
              onClick={() => setShowSettings(true)}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium text-[#6B6B6B] hover:bg-[#F2EDE4] hover:text-[#1A1A1A] transition-all text-left">
              <span className="text-base leading-none">⚙️</span>
              <span>Settings</span>
            </button>
          </div>
        </aside>

        {/* ── Main Content ── */}
        <main className="ml-40 flex-1 min-h-screen">
          <div className="max-w-[780px] mx-auto px-8 py-8">
            {tab === 'today' && (
              <TodayPage
                onGoToGoal={openGoal}
                onOpenReview={() => setShowReview(true)}
              />
            )}
            {tab === 'goals' && (
              goalId === null
                ? <GoalsPage onSelectGoal={setGoalId} />
                : <GoalPage goalId={goalId} onBack={() => setGoalId(null)} onGoToGoal={setGoalId} />
            )}
            {tab === 'work' && <WorkPage />}
            {tab === 'progress' && <ProgressPage onGoToGoal={openGoal} />}
            {tab === 'insights' && <AnalyticsPage onGoToGoal={openGoal} />}
            {tab === 'connections' && <ContactsPage />}
          </div>
        </main>

        {showReview && <WeeklyReview onClose={() => setShowReview(false)} />}
        {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
        {showAddTask && <AddTaskModal onClose={() => setShowAddTask(false)} />}
        <TimerWidget />
      </div>
    </TimerProvider>
  )
}

function AddTaskModal({ onClose }) {
  const [goals, setGoals] = useState([])
  const [title, setTitle] = useState('')
  const [goalId, setGoalId] = useState('')
  const [parentTaskId, setParentTaskId] = useState('')
  const [estimatedMinutes, setEstimatedMinutes] = useState(null)
  const [goalTasks, setGoalTasks] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => {
    getGoals().then(gs => {
      setGoals(gs)
      if (gs.length > 0) setGoalId(gs[0].id)
    })
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const selected = goals.find(g => g.id === goalId)
    if (selected?.type === 'project') {
      getGoal(goalId).then(g => {
        setGoalTasks(g.tasks.filter(t => t.status === 'todo' && !t.parent_task_id))
      }).catch(() => setGoalTasks([]))
    } else {
      setGoalTasks([])
    }
    setParentTaskId('')
  }, [goalId, goals])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!title.trim() || !goalId) return
    setSubmitting(true)
    try {
      await createTask({
        title: title.trim(),
        goal_id: goalId,
        requires_proof: false,
        parent_task_id: parentTaskId || null,
        estimated_minutes: estimatedMinutes,
      })
      window.dispatchEvent(new CustomEvent('sysgo:task-updated'))
      onClose()
    } catch (err) { alert(err.message) }
    finally { setSubmitting(false) }
  }

  const TYPE_LABEL = { resolution: 'Resolutions', project: 'Projects', daily: 'Daily', null: 'Other' }
  const grouped = goals.reduce((acc, g) => {
    const key = g.type || 'null'
    if (!acc[key]) acc[key] = []
    acc[key].push(g)
    return acc
  }, {})

  return (
    <Modal title="Add Task" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="text-sm font-medium text-sand-700">Task</label>
          <input ref={inputRef} value={title} onChange={e => setTitle(e.target.value)}
            placeholder="What needs to be done?"
            className="mt-1.5 w-full border border-sand-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white placeholder:text-sand-300" />
        </div>
        <div>
          <label className="text-sm font-medium text-sand-700">Add to</label>
          <select value={goalId} onChange={e => setGoalId(e.target.value)}
            className="mt-1.5 w-full border border-sand-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white text-sand-700">
            {Object.entries(grouped).map(([type, list]) => (
              <optgroup key={type} label={TYPE_LABEL[type] || type}>
                {list.map(g => (
                  <option key={g.id} value={g.id}>{g.title}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        {goalTasks.length > 0 && (
          <div>
            <label className="text-sm font-medium text-sand-700">
              Sub-task of <span className="text-sand-400 font-normal">(optional)</span>
            </label>
            <select value={parentTaskId} onChange={e => setParentTaskId(e.target.value)}
              className="mt-1.5 w-full border border-sand-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white text-sand-700">
              <option value="">— None (top-level task) —</option>
              {goalTasks.map(t => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
            </select>
          </div>
        )}
        <EstimatedTimePicker value={estimatedMinutes} onChange={setEstimatedMinutes} />
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-sand-600 hover:text-sand-800">Cancel</button>
          <button type="submit" disabled={submitting || !title.trim() || !goalId}
            className="bg-[#1B3A2D] text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-[#2a5240] disabled:opacity-40 transition-colors">
            Add Task
          </button>
        </div>
      </form>
    </Modal>
  )
}
