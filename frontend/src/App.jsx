import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import Modal from './components/Modal'
import Icon, { BasiraMark } from './components/Icon'
import Notice, { notify } from './components/Notice'
import { TimerProvider, useTimer } from './TimerContext'
import { applyTheme, setThemePreference, watchSystemTheme } from './theme'
import TimerWidget from './TimerWidget'
import EstimatedTimePicker from './components/EstimatedTimePicker'
import { createTask, getGoal, getGoals } from './api'
import { NAV_ITEMS, readRoute, routeHref } from './navigation'

const TodayPage = lazy(() => import('./TodayPage'))
const GoalsPage = lazy(() => import('./GoalsPage'))
const GoalPage = lazy(() => import('./GoalPage'))
const WorkPage = lazy(() => import('./WorkPage'))
const JournalPage = lazy(() => import('./JournalPage'))
const ProgressPage = lazy(() => import('./ProgressPage'))
const ProfilePage = lazy(() => import('./ProfilePage'))
const AnalyticsPage = lazy(() => import('./AnalyticsPage'))
const ContactsPage = lazy(() => import('./ContactsPage'))
const WeeklyReview = lazy(() => import('./WeeklyReview'))
const SettingsModal = lazy(() => import('./SettingsModal'))
const TrashModal = lazy(() => import('./components/TrashModal'))

export default function App() {
  const [route, setRoute] = useState(() => readRoute(window.location.hash))
  const { tab, goalId } = route
  const [showReview, setShowReview] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showAddTask, setShowAddTask] = useState(false)
  const [showCommand, setShowCommand] = useState(false)
  const [showMore, setShowMore] = useState(false)
  const [showTrash, setShowTrash] = useState(false)
  const [theme, setTheme] = useState(() => applyTheme())
  useEffect(() => {
    const update = () => setRoute(readRoute(window.location.hash))
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  useEffect(() => {
    const sync = () => setTheme(applyTheme())
    window.addEventListener('basira:theme', sync)
    const stop = watchSystemTheme(setTheme)
    return () => { window.removeEventListener('basira:theme', sync); stop() }
  }, [])
  useEffect(() => {
    const handler = e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setShowCommand(v => !v) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])
  const label = tab === 'insights' ? 'Analytics' : NAV_ITEMS.find(n => n.id === tab)?.label || 'Today'
  useEffect(() => { document.title = `${label} · Basira — بَصِيرَة` }, [label])
  function navigate(page, id) { window.location.hash = routeHref(page, id); setShowMore(false); setShowCommand(false) }
  function openGoal(id) { navigate('goals', id) }
  function toggleTheme() { setThemePreference(theme === 'light' ? 'dark' : 'light') }
  const navLink = item => <a key={item.id} href={routeHref(item.id)} className={`nav-link ${tab === item.id || (tab === 'insights' && item.id === 'progress') ? 'active' : ''}`} aria-current={tab === item.id ? 'page' : undefined}><Icon name={item.id}/><span>{item.label}</span></a>

  return <TimerProvider><div className="app-shell">
    <a href="#main-content" className="skip-link" onClick={e => { e.preventDefault(); document.getElementById('main-content')?.focus() }}>Skip to content</a>
    <aside className="sidebar">
      <a className="brand" href="#/today" aria-label="Basira home"><BasiraMark className="brand-mark"/><div><div className="brand-name">basira<span>.</span></div><div className="brand-arabic" lang="ar" dir="rtl">بَصِيرَة</div></div></a>
      <p className="brand-caption">See yourself clearly.</p>
      <button className="quick-add" onClick={() => setShowAddTask(true)}><Icon name="plus" size={17}/> Quick add <kbd>＋</kbd></button>
      <nav aria-label="Main navigation">{['Do', 'Reflect'].map(group => <div className="nav-section" key={group}><p className="nav-caption">{group}</p>{NAV_ITEMS.filter(n => n.group === group).map(navLink)}</div>)}</nav>
      <div className="sidebar-bottom">
        <button className="nav-link" onClick={() => setShowReview(true)}><Icon name="review"/>Weekly review</button>
        <button className="nav-link" onClick={() => setShowTrash(true)}><Icon name="trash"/>Trash</button>
        <button className="nav-link" onClick={() => setShowSettings(true)}><Icon name="settings"/>Settings</button>
        <div className="sidebar-foot"><BasiraMark className="w-5 h-5"/><span>A little more clarity, every day.</span></div>
      </div>
    </aside>
    <div className="app-main">
      <header className="topbar"><div className="breadcrumb"><span>Your workspace</span><span className="sep">/</span><strong>{label}</strong>{goalId && <><span className="sep">/</span><strong>Goal</strong></>}</div><div className="topbar-tools">
        <TopbarClock/>
        <button className="search-trigger" onClick={() => setShowCommand(true)} aria-label="Search pages and actions"><Icon name="search" size={17}/><span>Jump to…</span><kbd>⌘ K</kbd></button>
        <button className="icon-button" onClick={toggleTheme} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`} title={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}><Icon name={theme === 'light' ? 'moon' : 'sun'} size={18}/></button>
        <button className="icon-button md:hidden" onClick={() => setShowAddTask(true)} aria-label="Quick add task"><Icon name="plus"/></button>
        <a className="profile-trigger" href="#/profile" aria-label="Your profile"><Icon name="profile" size={17}/></a>
      </div></header>
      <main id="main-content" tabIndex={-1} className={`page-content ${['journal', 'profile'].includes(tab) ? 'reading-width' : ''}`}>
        <Suspense fallback={<div className="py-16 text-muted" role="status">Opening your workspace…</div>}>
          {tab === 'today' && <TodayPage onGoToGoal={openGoal} onOpenReview={() => setShowReview(true)} />}
          {tab === 'goals' && (goalId ? <GoalPage key={goalId} goalId={goalId} onBack={() => navigate('goals')} onGoToGoal={openGoal}/> : <GoalsPage onSelectGoal={openGoal}/>)}
          {tab === 'journal' && <JournalPage/>}
          {tab === 'work' && <WorkPage/>}
          {tab === 'progress' && <ProgressPage onGoToGoal={openGoal} onOpenAnalytics={() => navigate('insights')}/>}
          {tab === 'profile' && <ProfilePage/>}
          {tab === 'insights' && <><button className="secondary-button mb-6" onClick={() => navigate('progress')}>← Progress overview</button><AnalyticsPage onGoToGoal={openGoal}/></>}
          {tab === 'connections' && <ContactsPage/>}
        </Suspense>
      </main>
    </div>
    <nav className="mobile-nav" aria-label="Mobile navigation">{NAV_ITEMS.filter(n => ['today', 'goals', 'work'].includes(n.id)).map(n => <a key={n.id} href={routeHref(n.id)} className={tab === n.id ? 'active' : ''} aria-current={tab === n.id ? 'page' : undefined}><Icon name={n.id}/>{n.label}</a>)}<button onClick={() => setShowMore(true)} aria-label="More pages" className={!['today', 'goals', 'work'].includes(tab) ? 'active' : ''}><Icon name="more"/>More</button></nav>
    <Suspense fallback={null}>
      {showReview && <WeeklyReview onClose={() => setShowReview(false)}/>}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} onOpenTrash={() => { setShowSettings(false); setShowTrash(true) }}/>}
      {showTrash && <TrashModal onClose={() => setShowTrash(false)} onChange={() => { window.dispatchEvent(new CustomEvent('basira:task-updated')); window.dispatchEvent(new CustomEvent('basira:schedule-updated')) }}/>}
    </Suspense>
    {showAddTask && <AddTaskModal initialGoalId={goalId} onClose={() => setShowAddTask(false)} onCreateGoal={() => { setShowAddTask(false); navigate('goals') }}/>}
    {showCommand && <CommandMenu onClose={() => setShowCommand(false)} onNavigate={navigate} onAdd={() => { setShowCommand(false); setShowAddTask(true) }} onReview={() => { setShowCommand(false); setShowReview(true) }} onSettings={() => { setShowCommand(false); setShowSettings(true) }} onTheme={() => { setShowCommand(false); toggleTheme() }} theme={theme}/>}
    {showMore && <Modal title="Your workspace" onClose={() => setShowMore(false)}><div className="command-list">{NAV_ITEMS.filter(n => !['today', 'goals', 'work'].includes(n.id)).map(n => <button key={n.id} onClick={() => navigate(n.id)}><Icon name={n.id}/>{n.label}</button>)}<button onClick={() => { setShowMore(false); setShowReview(true) }}><Icon name="review"/>Weekly review</button><button onClick={() => { setShowMore(false); setShowTrash(true) }}><Icon name="trash"/>Trash</button><button onClick={() => { setShowMore(false); setShowSettings(true) }}><Icon name="settings"/>Settings</button></div></Modal>}
    {tab !== 'today' && <TimerWidget/>}
    <Notice/>
  </div></TimerProvider>
}

function TopbarClock() {
  const { timer } = useTimer()
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 15000); return () => clearInterval(id) }, [])
  const live = Boolean(timer?.running)
  const date = now.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
  const time = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return <div className={`topbar-clock ${live ? 'live' : ''}`} aria-live="off" title={live ? `Focusing on ${timer.taskTitle}` : 'Current date and time'}>
    <span className={`status-dot ${live ? 'live' : ''}`}/><span>{live ? 'In focus' : date}</span><span className="sep">·</span><time>{time}</time>
  </div>
}

function CommandMenu({ onClose, onNavigate, onAdd, onReview, onSettings, onTheme, theme }) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const q = query.trim().toLowerCase()
  const actions = [
    { id: 'add', label: 'Add a task', hint: 'Quick add', icon: 'plus', run: onAdd, keywords: 'new create task' },
    { id: 'review', label: 'Open weekly review', hint: 'Reflect', icon: 'review', run: onReview, keywords: 'week reflect' },
    { id: 'theme', label: `Switch to ${theme === 'light' ? 'dark' : 'light'} theme`, hint: 'Appearance', icon: theme === 'light' ? 'moon' : 'sun', run: onTheme, keywords: 'theme dark light appearance' },
    { id: 'settings', label: 'Settings', hint: 'Preferences', icon: 'settings', run: onSettings, keywords: 'reminder preferences' },
  ]
  const pages = NAV_ITEMS.map(n => ({ id: n.id, label: n.label, hint: n.group, icon: n.id, run: () => onNavigate(n.id), keywords: n.label.toLowerCase() }))
  const match = item => !q || item.label.toLowerCase().includes(q) || item.keywords.includes(q)
  const groups = [['Pages', pages.filter(match)], ['Actions', actions.filter(match)]].filter(([, items]) => items.length)
  const flat = groups.flatMap(([, items]) => items)
  const current = flat[Math.min(active, flat.length - 1)]
  useEffect(() => { setActive(0) }, [q])
  function onKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => (a + 1) % Math.max(flat.length, 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => (a - 1 + flat.length) % Math.max(flat.length, 1)) }
    else if (e.key === 'Enter' && current) { e.preventDefault(); current.run() }
  }
  return <Modal title="Jump to" onClose={onClose} className="command-dialog">
    <div className="command-input"><Icon name="search" size={18}/><input autoFocus value={query} onChange={e => setQuery(e.target.value)} onKeyDown={onKey} placeholder="Where to, or what next?" aria-label="Find a page or action" role="combobox" aria-expanded="true" aria-controls="command-results"/><kbd>esc</kbd></div>
    <div className="command-list" id="command-results" role="listbox">
      {groups.map(([caption, items]) => <div key={caption}><p className="command-caption">{caption}</p>{items.map(item => <button key={item.id} role="option" aria-selected={current === item} className={current === item ? 'is-active' : ''} onMouseEnter={() => setActive(flat.indexOf(item))} onClick={item.run}><Icon name={item.icon}/>{item.label}<kbd>{item.hint}</kbd></button>)}</div>)}
      {flat.length === 0 && <p className="text-sm text-muted p-3">Nothing matches. Try Today, Goals, Work, or "add".</p>}
    </div>
    <div className="command-footer"><span>↑↓ move</span><span>↵ open</span><span>⌘K toggle</span></div>
  </Modal>
}

function AddTaskModal({ onClose, initialGoalId, onCreateGoal }) {
  const [goals, setGoals] = useState([])
  const [title, setTitle] = useState('')
  const [goalId, setGoalId] = useState('')
  const [parentTaskId, setParentTaskId] = useState('')
  const [estimatedMinutes, setEstimatedMinutes] = useState(null)
  const [goalTasks, setGoalTasks] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const inputRef = useRef(null)

  useEffect(() => {
    getGoals().then(gs => {
      setGoals(gs)
      if (gs.length > 0) setGoalId(gs.some(g => g.id === initialGoalId) ? initialGoalId : gs[0].id)
    }).catch(err => setError(err.message)).finally(() => setLoading(false))
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
        requires_proof: true,
        parent_task_id: parentTaskId || null,
        estimated_minutes: estimatedMinutes,
      })
      window.dispatchEvent(new CustomEvent('basira:task-updated'))
      onClose()
    } catch (err) { setError(err.message) }
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
        <p className="text-sm text-muted">A clear next step, connected to what matters.</p>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        {loading && <p role="status" className="text-sm text-muted">Loading goals…</p>}
        {!loading && goals.length === 0 && <div className="p-4 bg-raised rounded-xl"><p className="text-sm mb-3">Every task starts with a goal. Create your first goal to begin.</p><button type="button" className="secondary-button" onClick={onCreateGoal}>Create a goal <Icon name="arrow" size={15}/></button></div>}
        <div>
          <label htmlFor="quick-task-title" className="text-sm font-medium text-sand-700">Task</label>
          <input id="quick-task-title" ref={inputRef} value={title} onChange={e => setTitle(e.target.value)}
            placeholder="What needs to be done?"
            className="mt-1.5 w-full border border-sand-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 bg-surface placeholder:text-sand-300" />
        </div>
        <div>
          <label htmlFor="quick-task-goal" className="text-sm font-medium text-sand-700">Goal</label>
          <select id="quick-task-goal" value={goalId} onChange={e => setGoalId(e.target.value)}
            className="mt-1.5 w-full border border-sand-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 bg-surface text-sand-700">
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
              className="mt-1.5 w-full border border-sand-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 bg-surface text-sand-700">
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
            className="bg-forest text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-forest-hover disabled:opacity-40 transition-colors">
            Add Task
          </button>
        </div>
      </form>
    </Modal>
  )
}
