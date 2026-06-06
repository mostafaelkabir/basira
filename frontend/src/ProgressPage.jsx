import { useEffect, useState } from 'react'
import { checkinHabit, getOverview, getToday, uncheckinHabit } from './api'
import { GoalIcon } from './GoalsPage'

const MONTHS    = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const DAY_LABELS = ['S','M','T','W','T','F','S']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseFreq(f = 'daily') {
  if (!f || f === 'daily') return { perDay: 1, label: null }
  const dm = f.match(/^(\d+)x_day$/)
  if (dm) return { perDay: parseInt(dm[1]), label: `${dm[1]}× day` }
  const wm = f.match(/^(\d+)x_week$/)
  if (wm) return { perDay: 1, label: wm[1] === '1' ? 'Weekly' : `${wm[1]}× week` }
  return { perDay: 1, label: null }
}

function weeklyTarget(freq) {
  if (!freq || freq === 'daily') return 7
  const wm = freq.match(/^(\d+)x_week$/)
  if (wm) return parseInt(wm[1])
  return 7
}

function getWeekRange() {
  const today = new Date()
  const start = new Date(today)
  start.setDate(today.getDate() - 6)
  const fmt = (d) => `${MONTHS[d.getMonth()]} ${d.getDate()}`
  return `${fmt(start)} – ${fmt(today)}`
}

function getLast7() {
  return Array.from({ length: 7 }).map((_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i))
    return { iso: d.toISOString().split('T')[0], isToday: i === 6 }
  })
}

function getMonthGrid() {
  const today = new Date(); today.setHours(0,0,0,0)
  const grid = []
  for (let week = 3; week >= 0; week--) {
    const row = []
    for (let dow = 6; dow >= 0; dow--) {
      const d = new Date(today)
      d.setDate(d.getDate() - (week * 7 + dow))
      row.unshift({ iso: d.toISOString().split('T')[0], isToday: week === 0 && dow === 0 })
    }
    grid.push(row)
  }
  return grid
}

function momentumMeta(days) {
  if (days === null) return { label: 'Not started', dot: 'bg-sand-200', border: 'border-l-sand-200', text: 'text-sand-400' }
  if (days <= 2)     return { label: days === 0 ? 'Active today' : `${days}d ago`, dot: 'bg-sage-400', border: 'border-l-sage-300', text: 'text-sage-500' }
  if (days <= 7)     return { label: `${days}d ago`, dot: 'bg-gold-400', border: 'border-l-gold-300', text: 'text-gold-500' }
  if (days <= 21)    return { label: `${days}d ago`, dot: 'bg-terra-300', border: 'border-l-terra-300', text: 'text-terra-400' }
  return { label: `${days}d ago`, dot: 'bg-terra-400', border: 'border-l-terra-400', text: 'text-terra-400' }
}

function isImageUrl(v) { return v && (v.startsWith('/') || v.startsWith('http')) }

function SectionLabel({ children, right }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <p className="text-[11px] font-bold text-[#1A1A1A] uppercase tracking-widest whitespace-nowrap">{children}</p>
      <span className="flex-1 border-t border-[#E8E3DB]" />
      {right && <span className="text-[11px] text-[#6B6B6B] flex-shrink-0">{right}</span>}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ProgressPage({ onGoToGoal }) {
  const [overview, setOverview] = useState([])
  const [habits, setHabits]     = useState([])
  const [loading, setLoading]   = useState(true)
  const [expandedHabits, setExpandedHabits] = useState(new Set())
  const monthGrid = getMonthGrid()
  const last7     = getLast7()

  async function load() {
    try {
      const [todayData, ov] = await Promise.all([getToday(), getOverview()])
      setHabits(todayData.habits)
      setOverview(ov)
    } catch (err) { alert(err.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  async function handleToggleHabit(habit) {
    try {
      habit.checked_today ? await uncheckinHabit(habit.id) : await checkinHabit(habit.id)
      load()
    } catch (err) { alert(err.message) }
  }

  function toggleExpand(id) {
    setExpandedHabits(prev => {
      const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s
    })
  }

  if (loading) return <p className="text-[#6B6B6B] text-sm">Loading…</p>

  const habitsByGoal = {}
  for (const h of habits) {
    if (!habitsByGoal[h.goal_id]) habitsByGoal[h.goal_id] = []
    habitsByGoal[h.goal_id].push(h)
  }

  const onTrackHabits  = habits.filter(h => h.weekly_checkins.length >= weeklyTarget(h.habit_frequency))
  const offTrackHabits = habits.filter(h => h.weekly_checkins.length <  weeklyTarget(h.habit_frequency))

  // Stat computations
  const totalTasksDone = overview.reduce((s, g) => s + (g.done_count || 0), 0)
  const totalTasks     = overview.reduce((s, g) => s + (g.task_count || 0), 0)
  const totalCheckins  = habits.reduce((s, h) => s + h.weekly_checkins.length, 0)
  const totalTarget    = habits.reduce((s, h) => s + weeklyTarget(h.habit_frequency), 0)
  const habitConsistencyPct = totalTarget > 0 ? Math.round((totalCheckins / totalTarget) * 100) : 0

  // Weekly velocity: tasks done per day for past 7 days using days_since_activity proxy
  // Generate approximate data since we don't have daily breakdown
  const velocityDays = last7.map((day, i) => {
    const dayLabel = ['M','T','W','T','F','S','S'][new Date(day.iso + 'T00:00:00').getDay() === 0 ? 6 : new Date(day.iso + 'T00:00:00').getDay() - 1]
    // Approximate: distribute done tasks over days based on momentum
    const count = overview.filter(g => g.days_since_activity !== null && g.days_since_activity === 6 - i).length
    return { label: dayLabel, count, iso: day.iso, isToday: day.isToday }
  })
  const maxVelocity = Math.max(...velocityDays.map(d => d.count), 1)

  // 90-day heatmap: generate grid (13 cols × 7 rows)
  const heatmapCells = (() => {
    const today = new Date(); today.setHours(0,0,0,0)
    const cells = []
    for (let col = 12; col >= 0; col--) {
      const week = []
      for (let dow = 0; dow < 7; dow++) {
        const d = new Date(today)
        d.setDate(d.getDate() - (col * 7 + (6 - dow)))
        const iso = d.toISOString().split('T')[0]
        // Activity level: check if any habit had check-in on this day
        const checkinCount = habits.filter(h => h.monthly_checkins && h.monthly_checkins.includes(iso)).length
        week.push({ iso, checkinCount, isToday: iso === today.toISOString().split('T')[0] })
      }
      cells.push(week)
    }
    return cells
  })()

  function heatmapColor(count) {
    if (count === 0) return '#E8E3DB'
    if (count === 1) return '#a8d5c8'
    if (count <= 3) return '#2D7A6B'
    return '#1B3A2D'
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <p className="text-[11px] font-bold text-[#6B6B6B] uppercase tracking-widest mb-1">PERFORMANCE</p>
        <h1 className="text-3xl font-bold text-[#1A1A1A]">Progress</h1>
        <p className="text-sm text-[#6B6B6B] mt-0.5">
          {getWeekRange()} · {overview.length} goals · {onTrackHabits.length}/{habits.length} habits on track
        </p>
      </div>

      {/* ── Row 1: Stat Cards ── */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white border border-[#E8E3DB] rounded-2xl p-4 shadow-sm">
          <p className="text-[10px] font-bold text-[#6B6B6B] uppercase tracking-widest mb-2">TOTAL OUTPUT</p>
          <p className="text-3xl font-bold text-[#1A1A1A]">{totalTasksDone}</p>
          <p className="text-xs text-[#6B6B6B] mt-1">Tasks Done</p>
          {totalTasks > 0 && <p className="text-xs text-[#2D7A6B] mt-1">{Math.round(totalTasksDone / totalTasks * 100)}% complete</p>}
        </div>
        <div className="bg-white border border-[#E8E3DB] rounded-2xl p-4 shadow-sm">
          <p className="text-[10px] font-bold text-[#6B6B6B] uppercase tracking-widest mb-2">CONSISTENCY</p>
          <p className="text-3xl font-bold text-[#1A1A1A]">{habitConsistencyPct}%</p>
          <p className="text-xs text-[#6B6B6B] mt-1">Habit Streak</p>
          <div className="w-full bg-[#E8E3DB] rounded-full h-1 mt-2">
            <div className="bg-[#2D7A6B] h-1 rounded-full" style={{ width: `${habitConsistencyPct}%` }} />
          </div>
        </div>
        <div className="bg-white border border-[#E8E3DB] rounded-2xl p-4 shadow-sm">
          <p className="text-[10px] font-bold text-[#6B6B6B] uppercase tracking-widest mb-2">DEEP WORK</p>
          <p className="text-3xl font-bold text-[#1A1A1A]">{onTrackHabits.length}</p>
          <p className="text-xs text-[#6B6B6B] mt-1">Habits On Track</p>
          <p className="text-xs text-[#2D7A6B] mt-1">{habits.length > 0 ? `${habits.length} total habits` : 'No habits yet'}</p>
        </div>
      </div>

      {/* ── Row 2: Velocity + Heatmap ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Weekly Velocity */}
        <div className="bg-white border border-[#E8E3DB] rounded-2xl p-5 shadow-sm">
          <p className="text-sm font-bold text-[#1A1A1A] mb-4">Weekly Velocity</p>
          <div className="h-20 flex items-end gap-2">
            {velocityDays.map((day, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <div
                  className={`w-full rounded-t-sm min-h-[4px] transition-all ${day.isToday ? 'bg-[#E8C334]' : 'bg-[#2D7A6B]'}`}
                  style={{ height: `${Math.max(4, Math.round((day.count / maxVelocity) * 80))}px` }}
                />
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-1">
            {velocityDays.map((day, i) => (
              <div key={i} className="flex-1 text-center">
                <span className={`text-[9px] ${day.isToday ? 'text-[#E8C334] font-bold' : 'text-[#6B6B6B]'}`}>{day.label}</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-[#6B6B6B] mt-2">Goals active per day (last 7 days)</p>
        </div>

        {/* Consistency Heatmap */}
        <div className="bg-white border border-[#E8E3DB] rounded-2xl p-5 shadow-sm">
          <p className="text-sm font-bold text-[#1A1A1A] mb-4">Consistency Map</p>
          <div className="flex gap-1">
            <div className="flex flex-col gap-0.5 mr-1">
              {['M','T','W','T','F','S','S'].map((l, i) => (
                <div key={i} className="h-3 flex items-center">
                  <span className="text-[8px] text-[#6B6B6B] w-3">{i % 2 === 0 ? l : ''}</span>
                </div>
              ))}
            </div>
            {heatmapCells.map((week, ci) => (
              <div key={ci} className="flex flex-col gap-0.5 flex-1">
                {week.map((cell, ri) => (
                  <div
                    key={ri}
                    className="h-3 rounded-[2px]"
                    style={{ backgroundColor: heatmapColor(cell.checkinCount), outline: cell.isToday ? '1px solid #2D7A6B' : 'none' }}
                    title={`${cell.iso}: ${cell.checkinCount} habits`}
                  />
                ))}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 mt-3">
            <span className="text-[9px] text-[#6B6B6B]">Less</span>
            {['#E8E3DB','#a8d5c8','#2D7A6B','#1B3A2D'].map(c => (
              <div key={c} className="w-3 h-3 rounded-[2px]" style={{ backgroundColor: c }} />
            ))}
            <span className="text-[9px] text-[#6B6B6B]">More</span>
          </div>
        </div>
      </div>

      {/* ── Row 3: Focus Areas + AI Insight ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Focus Areas */}
        <div className="bg-white border border-[#E8E3DB] rounded-2xl p-5 shadow-sm">
          <p className="text-sm font-bold text-[#1A1A1A] mb-4">Focus Areas</p>
          <div className="space-y-3">
            {overview.slice(0, 6).map(goal => {
              const pct = goal.task_count > 0 ? Math.round((goal.done_count / goal.task_count) * 100) : 0
              return (
                <button key={goal.id} onClick={() => onGoToGoal(goal.id)} className="w-full text-left group">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-base">{goal.icon && !goal.icon.startsWith('/') && !goal.icon.startsWith('http') ? goal.icon : '◈'}</span>
                    <span className="text-sm text-[#1A1A1A] group-hover:text-[#1B3A2D] flex-1 truncate font-medium">{goal.title}</span>
                    <span className="text-xs text-[#6B6B6B] flex-shrink-0">{goal.done_count}/{goal.task_count}</span>
                  </div>
                  <div className="w-full bg-[#E8E3DB] rounded-full h-1">
                    <div className="bg-[#2D7A6B] h-1 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                </button>
              )
            })}
            {overview.length === 0 && <p className="text-sm text-[#6B6B6B] italic">No goals yet</p>}
          </div>
        </div>

        {/* AI Smart Insight */}
        <div className="bg-violet-50 border border-violet-100 rounded-2xl p-5 shadow-sm flex flex-col">
          <p className="text-[10px] font-bold text-violet-500 uppercase tracking-widest mb-2">AI SMART INSIGHT</p>
          <p className="text-sm font-semibold text-[#1A1A1A] mb-2">
            {habitConsistencyPct >= 80
              ? 'Excellent consistency! You\'re hitting most of your habits this week.'
              : habitConsistencyPct >= 50
              ? 'Good progress — keep pushing to hit your weekly habit targets.'
              : habits.length === 0
              ? 'Add habits to your goals to start tracking consistency.'
              : 'Focus on consistency — try completing at least one habit each day.'}
          </p>
          <p className="text-xs text-[#6B6B6B] flex-1">
            {totalTasksDone > 0
              ? `You've completed ${totalTasksDone} task${totalTasksDone !== 1 ? 's' : ''} across ${overview.length} goal${overview.length !== 1 ? 's' : ''}. `
              : ''}
            {onTrackHabits.length > 0
              ? `${onTrackHabits.length} habit${onTrackHabits.length !== 1 ? 's are' : ' is'} on track this week.`
              : ''}
          </p>
          <button className="mt-4 text-sm text-violet-600 font-medium hover:underline self-start">View Analytics →</button>
        </div>
      </div>

      {/* ── Goals ── */}
      <section>
        <SectionLabel>Goals</SectionLabel>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {overview.map(goal => (
            <GoalProgressCard
              key={goal.id} goal={goal}
              habitsByGoal={habitsByGoal}
              onClick={() => onGoToGoal(goal.id)}
            />
          ))}
        </div>
      </section>

      {/* ── Habits ── */}
      {habits.length > 0 && (
        <section>
          <SectionLabel right={`${onTrackHabits.length}/${habits.length} on track`}>Habits this week</SectionLabel>
          <div className="bg-white border border-[#E8E3DB] rounded-2xl overflow-hidden divide-y divide-[#F2EDE4] shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
            {offTrackHabits.map(habit => (
              <HabitWeekRow
                key={habit.id} habit={habit} monthGrid={monthGrid} last7={last7}
                expanded={expandedHabits.has(habit.id)}
                onToggleExpand={() => toggleExpand(habit.id)}
                onToggle={() => handleToggleHabit(habit)}
                onGoToGoal={() => onGoToGoal(habit.goal_id)}
              />
            ))}
            {offTrackHabits.length > 0 && onTrackHabits.length > 0 && (
              <div className="px-4 py-1 bg-[#F2EDE4]">
                <span className="text-[10px] text-[#6B6B6B] font-medium tracking-widest uppercase">on track this week</span>
              </div>
            )}
            {onTrackHabits.map(habit => (
              <HabitWeekRow
                key={habit.id} habit={habit} monthGrid={monthGrid} last7={last7}
                expanded={expandedHabits.has(habit.id)}
                onToggleExpand={() => toggleExpand(habit.id)}
                onToggle={() => handleToggleHabit(habit)}
                onGoToGoal={() => onGoToGoal(habit.goal_id)}
                isOnTrack
              />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

// ─── Goal Progress Card ───────────────────────────────────────────────────────

function GoalProgressCard({ goal, habitsByGoal, onClick }) {
  const mm           = momentumMeta(goal.days_since_activity)
  const pct          = goal.task_count > 0 ? Math.round((goal.done_count / goal.task_count) * 100) : 0
  const isResolution = goal.type === 'resolution'
  const goalHabits   = habitsByGoal[goal.id] || []
  const isCover      = goal.cover && isImageUrl(goal.icon)

  // Weekly check-in progress: sum of actual check-ins vs sum of weekly targets
  const totalCheckins = goalHabits.reduce((s, h) => s + h.weekly_checkins.length, 0)
  const totalTarget   = goalHabits.reduce((s, h) => s + weeklyTarget(h.habit_frequency), 0)
  const habitPct      = totalTarget > 0 ? Math.round((totalCheckins / totalTarget) * 100) : 0

  const progressBar = isResolution
    ? goalHabits.length > 0
        ? <ProgressBarDisplay
            pct={habitPct}
            label={`${totalCheckins}/${totalTarget} check-ins this week`}
            allDone={habitPct === 100} />
        : <p className={`text-xs italic ${isCover ? 'text-white/50' : 'text-sand-300'}`}>No habits added</p>
    : goal.task_count > 0
        ? <ProgressBarDisplay
            pct={pct}
            label={`${goal.done_count}/${goal.task_count} tasks`}
            allDone={pct === 100} />
        : <p className={`text-xs italic ${isCover ? 'text-white/50' : 'text-sand-300'}`}>No tasks yet</p>

  if (isCover) {
    return (
      <button onClick={onClick}
        className="relative rounded-2xl overflow-hidden text-left hover:shadow-lg transition-all shadow-sm group min-h-[130px]"
        style={{ backgroundImage: `url(${goal.icon})`, backgroundSize: 'cover', backgroundPosition: 'center' }}>
        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/30 to-black/10" />
        <div className="relative z-10 p-4 flex flex-col justify-between h-full min-h-[130px]">
          <div className="flex justify-end">
            <div className="flex items-center gap-1.5 bg-black/30 backdrop-blur-sm rounded-full px-2 py-0.5">
              <span className={`w-1.5 h-1.5 rounded-full ${mm.dot}`} />
              <span className="text-[10px] font-medium text-white/80">{mm.label}</span>
            </div>
          </div>
          <div className="mt-auto">
            <p className="text-[10px] font-semibold text-white/60 uppercase tracking-wider mb-0.5">{goal.type || 'Goal'}</p>
            <p className="text-sm font-bold text-white leading-snug line-clamp-2 drop-shadow mb-2">{goal.title}</p>
            {progressBar}
          </div>
        </div>
      </button>
    )
  }

  return (
    <button onClick={onClick}
      className={`bg-white border border-[#E8E3DB] border-l-[3px] ${mm.border} rounded-2xl p-4 text-left hover:shadow-md transition-all shadow-[0_1px_3px_rgba(0,0,0,0.08)] group`}>
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-start gap-2.5 flex-1 min-w-0">
          {goal.icon
            ? <GoalIcon icon={goal.icon} size="md" className="mt-0.5" />
            : <span className="text-[10px] font-semibold text-[#b5a08a] uppercase mt-0.5 flex-shrink-0">
                {goal.type === 'resolution' ? '✦' : goal.type === 'project' ? '◈' : '◇'}
              </span>
          }
          <div className="flex-1 min-w-0">
            <span className="text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider">{goal.type || 'Goal'}</span>
            <p className="text-sm font-semibold text-[#1A1A1A] leading-snug group-hover:text-[#1B3A2D] transition-colors line-clamp-2 mt-0.5">
              {goal.title}
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <span className={`w-2 h-2 rounded-full ${mm.dot}`} title={mm.label} />
          <span className={`text-[10px] font-medium ${mm.text}`}>{mm.label}</span>
        </div>
      </div>
      {progressBar}
    </button>
  )
}

function ProgressBarDisplay({ pct, label, allDone, cover }) {
  return (
    <div>
      <div className={`flex justify-between text-xs mb-1 ${cover ? 'text-white/70' : 'text-[#6B6B6B]'}`}>
        <span>{label}</span>
        <span className={allDone ? (cover ? 'text-sage-300 font-medium' : 'text-sage-500 font-medium') : 'font-medium text-[#1A1A1A]'}>
          {allDone ? '✓' : `${pct}%`}
        </span>
      </div>
      <div className={`w-full rounded-full h-1.5 ${cover ? 'bg-white/20' : 'bg-[#E8E3DB]'}`}>
        <div className={`h-1.5 rounded-full transition-all ${allDone ? 'bg-sage-400' : cover ? 'bg-white/80' : 'bg-[#2D7A6B]'}`}
          style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

// ─── Habit Week Row ───────────────────────────────────────────────────────────

function HabitWeekRow({ habit, monthGrid, last7, expanded, onToggleExpand, onToggle, onGoToGoal, isOnTrack = false }) {
  const freq    = parseFreq(habit.habit_frequency)
  const checkins = new Set(habit.monthly_checkins)
  const wTarget = weeklyTarget(habit.habit_frequency)
  const wDone   = habit.weekly_checkins.length
  const weekPct = Math.min(100, Math.round((wDone / wTarget) * 100))

  return (
    <div className={isOnTrack ? 'opacity-50' : ''}>
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Today check button */}
        {freq.perDay > 1 ? (
          <button onClick={onToggle}
            className={`min-w-[38px] h-5 rounded-full border-2 px-1 flex items-center justify-center flex-shrink-0 text-[11px] font-bold transition-all ${
              habit.checked_today ? 'bg-[#2D7A6B] border-[#2D7A6B] text-white'
                : habit.today_count > 0 ? 'border-[#2D7A6B] text-[#2D7A6B]'
                : 'border-[#E8E3DB] text-[#6B6B6B] hover:border-[#2D7A6B]'}`}>
            {habit.today_count}/{habit.today_target}
          </button>
        ) : (
          <button onClick={onToggle}
            className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all ${
              habit.checked_today ? 'bg-[#2D7A6B] border-[#2D7A6B] text-white' : 'border-[#E8E3DB] hover:border-[#2D7A6B]'}`}>
            {habit.checked_today && <span className="text-[10px] leading-none">✓</span>}
          </button>
        )}

        {/* Title + goal */}
        <button onClick={onToggleExpand} className="flex-1 text-left min-w-0">
          <span className="text-sm text-[#1A1A1A]">{habit.title}</span>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] text-[#6B6B6B]">{habit.goal_title}</span>
            {freq.label && <span className="text-[10px] text-[#2D7A6B] font-medium">{freq.label}</span>}
          </div>
        </button>

        {/* Right: 7-day dots · weekly count · streak */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="flex gap-0.5">
            {last7.map(({ iso, isToday }) => (
              <div key={iso} className={`w-2 h-2 rounded-sm ${
                checkins.has(iso) ? 'bg-[#2D7A6B]' : isToday ? 'bg-[#E8E3DB] ring-1 ring-[#2D7A6B]/30' : 'bg-[#F2EDE4]'
              }`} title={iso} />
            ))}
          </div>
          <span className={`text-[11px] font-semibold tabular-nums w-8 text-right ${isOnTrack ? 'text-sage-500' : 'text-[#6B6B6B]'}`}>
            {isOnTrack ? '✓' : `${wDone}/${wTarget}`}
          </span>
          {habit.streak > 0 && (
            <span className="text-[11px] text-[#E8C334] font-bold">✦{habit.streak}</span>
          )}
          <button onClick={onToggleExpand}
            className={`text-[10px] w-5 h-5 flex items-center justify-center rounded transition-colors ${
              expanded ? 'text-[#2D7A6B]' : 'text-[#b5a08a] hover:text-[#6B6B6B]'}`}>
            {expanded ? '▴' : '▾'}
          </button>
          <button onClick={onGoToGoal} className="text-[#b5a08a] hover:text-[#2D7A6B] text-xs transition-colors">→</button>
        </div>
      </div>

      {/* 4-week heatmap */}
      {expanded && (
        <div className="px-4 pb-4 ml-8 space-y-2">
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-[#E8E3DB] rounded-full h-1.5">
              <div className="h-1.5 rounded-full bg-[#2D7A6B] transition-all" style={{ width: `${weekPct}%` }} />
            </div>
            <span className="text-[10px] text-[#6B6B6B]">{wDone}/{wTarget} this week</span>
          </div>
          <div>
            <div className="flex gap-0.5 mb-1">
              {DAY_LABELS.map((l, i) => <span key={i} className="text-[9px] text-[#6B6B6B] text-center flex-1">{l}</span>)}
            </div>
            {monthGrid.map((week, wi) => (
              <div key={wi} className="flex gap-0.5 mb-0.5">
                {week.map(day => (
                  <div key={day.iso}
                    className={`flex-1 h-4 rounded-sm transition-colors ${
                      checkins.has(day.iso) ? 'bg-[#2D7A6B]' : day.isToday ? 'bg-[#E8E3DB] ring-1 ring-[#2D7A6B]/30' : 'bg-[#F2EDE4]'
                    }`} title={day.iso} />
                ))}
              </div>
            ))}
            <div className="flex justify-between text-[9px] text-[#6B6B6B] mt-1">
              <span>4 weeks ago</span>
              <span>{habit.monthly_checkins.length}/28 days</span>
              <span>today</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
