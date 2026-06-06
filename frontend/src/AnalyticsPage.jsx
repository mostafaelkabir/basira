import { useEffect, useState } from 'react'
import { getAnalytics } from './api'

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(iso) {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function grade(pct) {
  if (pct >= 90) return { label: 'A+', color: 'text-teal-600' }
  if (pct >= 75) return { label: 'A',  color: 'text-teal-500' }
  if (pct >= 60) return { label: 'B',  color: 'text-gold-500' }
  if (pct >= 40) return { label: 'C',  color: 'text-gold-400' }
  return { label: 'D', color: 'text-terra-400' }
}

function scoreColor(pct) {
  if (pct >= 90) return 'bg-teal-500'
  if (pct >= 70) return 'bg-teal-400'
  if (pct >= 50) return 'bg-gold-400'
  if (pct >= 25) return 'bg-gold-300'
  if (pct > 0)   return 'bg-terra-300'
  return 'bg-sand-100'
}

function scoreDotColor(pct) {
  if (pct >= 90) return 'bg-teal-500 ring-teal-200'
  if (pct >= 70) return 'bg-teal-400 ring-teal-100'
  if (pct >= 50) return 'bg-gold-400 ring-gold-100'
  if (pct >= 25) return 'bg-gold-300 ring-gold-100'
  if (pct > 0)   return 'bg-terra-300 ring-terra-100'
  return 'bg-sand-200 ring-sand-100'
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, accent = false }) {
  return (
    <div className={`rounded-2xl p-4 ${accent ? 'bg-teal-600 text-white' : 'bg-white border border-sand-200'}`}>
      <p className={`text-xs font-medium uppercase tracking-wide mb-1 ${accent ? 'text-teal-100' : 'text-sand-400'}`}>{label}</p>
      <p className={`text-3xl font-bold leading-none ${accent ? 'text-white' : 'text-sand-800'}`}>{value}</p>
      {sub && <p className={`text-xs mt-1.5 ${accent ? 'text-teal-100' : 'text-sand-400'}`}>{sub}</p>}
    </div>
  )
}

function InsightCard({ icon, title, body, tone = 'neutral' }) {
  const tones = {
    good:    'border-l-[3px] border-l-teal-400 bg-teal-50/50',
    warn:    'border-l-[3px] border-l-gold-400 bg-gold-50/50',
    bad:     'border-l-[3px] border-l-terra-400 bg-terra-50/50',
    neutral: 'border-l-[3px] border-l-sand-200 bg-white',
  }
  return (
    <div className={`rounded-2xl border border-sand-200 px-4 py-3.5 ${tones[tone]}`}>
      <div className="flex items-start gap-3">
        <span className="text-xl mt-0.5 flex-shrink-0">{icon}</span>
        <div>
          <p className="text-sm font-semibold text-sand-800">{title}</p>
          <p className="text-xs text-sand-500 mt-0.5 leading-relaxed">{body}</p>
        </div>
      </div>
    </div>
  )
}

function WeeklyBar({ label, completed, added, maxVal }) {
  const compH = maxVal > 0 ? Math.round((completed / maxVal) * 80) : 0
  const addH  = maxVal > 0 ? Math.round((added    / maxVal) * 80) : 0
  return (
    <div className="flex flex-col items-center gap-1 flex-1">
      <div className="w-full flex flex-col justify-end gap-0.5" style={{ height: 80 }}>
        <div
          className="w-full rounded-t-md bg-teal-400 transition-all"
          style={{ height: compH }}
          title={`${completed} completed`}
        />
      </div>
      <div className="text-[10px] text-sand-400 leading-none text-center">{label}</div>
      <div className="text-[10px] font-semibold text-sand-600">{completed}</div>
    </div>
  )
}

// ── Heatmap (last 60 days) ─────────────────────────────────────────────────────
function HeatmapGrid({ snapshots }) {
  const today = new Date().toISOString().split('T')[0]
  // Build a map of date → snapshot
  const snapMap = {}
  for (const s of snapshots) snapMap[s.date] = s

  // Build 60-day grid
  const days = []
  for (let i = 59; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const iso = d.toISOString().split('T')[0]
    const snap = snapMap[iso] || null
    days.push({ iso, snap })
  }

  // Group into rows of 7 (weeks)
  const weeks = []
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7))
  }

  return (
    <div>
      <div className="flex gap-1 flex-wrap">
        {days.map(({ iso, snap }) => {
          const pct = snap?.score_pct ?? -1
          const isToday = iso === today
          const colorCls = pct < 0 ? 'bg-sand-100' : scoreColor(pct)
          return (
            <div
              key={iso}
              className={`w-6 h-6 rounded-md ${colorCls} ${isToday ? 'ring-2 ring-offset-1 ring-teal-400' : ''} cursor-default transition-opacity hover:opacity-80`}
              title={pct >= 0 ? `${fmt(iso)}: ${pct}% overall · tasks ${snap.task_score ?? pct}% · habits ${snap.habit_score ?? 0}% (${snap.tasks_done}/${snap.tasks_total} tasks, ${snap.habits_done}/${snap.habits_total} habits)` : `${fmt(iso)}: no data`}
            />
          )
        })}
      </div>
      <div className="flex items-center gap-2 mt-3 text-[10px] text-sand-400">
        <span>Less</span>
        {[0, 25, 50, 75, 100].map(p => (
          <div key={p} className={`w-4 h-4 rounded ${scoreColor(p)}`} title={`${p}%`} />
        ))}
        <span>More</span>
      </div>
    </div>
  )
}

// ── Day-of-week bars ───────────────────────────────────────────────────────────
function DowChart({ completions_by_dow, best_day }) {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const fullDays = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']
  const maxVal = Math.max(1, ...Object.values(completions_by_dow))
  return (
    <div className="flex items-end gap-1.5 h-20 w-full">
      {days.map((short, i) => {
        const full  = fullDays[i]
        const count = completions_by_dow[full] ?? 0
        const h     = Math.max(2, Math.round((count / maxVal) * 64))
        const isBest = full === best_day
        return (
          <div key={short} className="flex-1 flex flex-col items-center gap-1">
            <div
              className={`w-full rounded-t-md transition-all ${isBest ? 'bg-teal-500' : 'bg-teal-300'}`}
              style={{ height: h }}
              title={`${full}: ${count}`}
            />
            <span className={`text-[9px] ${isBest ? 'text-teal-600 font-bold' : 'text-sand-400'}`}>{short}</span>
          </div>
        )
      })}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AnalyticsPage({ onGoToGoal }) {
  const [data, setData]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [range, setRange]   = useState('30d')

  useEffect(() => {
    getAnalytics().then(d => { setData(d); setLoading(false) }).catch(() => setLoading(false))
  }, [])

  if (loading) return <p className="text-sand-400 text-sm">Loading analytics…</p>
  if (!data)   return <p className="text-terra-400 text-sm">Failed to load analytics.</p>

  const { summary: s, snapshots, weekly_breakdown, top_deferred_tasks, stale_tasks } = data
  const is7d = range === '7d'

  const completedN      = is7d ? s.tasks_completed_7d     : s.tasks_completed_30d
  const addedN          = is7d ? s.tasks_added_7d          : s.tasks_added_30d
  const perfectN        = is7d ? s.perfect_days_7d         : s.perfect_days_30d
  const avgScore        = is7d ? s.avg_score_7d            : s.avg_score_30d
  const avgTaskScore    = is7d ? s.avg_task_score_7d       : s.avg_task_score_30d
  const avgHabitScore   = is7d ? s.avg_habit_score_7d      : s.avg_habit_score_30d
  const avgPerDay       = is7d ? s.avg_per_active_day_7d   : s.avg_per_active_day_30d
  const deferralsN      = is7d ? s.deferrals_7d            : s.deferrals_30d
  const rangeDays       = is7d ? 7 : 30
  const rangeLabel      = is7d ? 'this week' : 'this month'

  const { label: gradeLabel, color: gradeColor } = grade(avgTaskScore ?? avgScore)

  // Build behavior insights
  const insights = []

  if (s.best_day_of_week) {
    insights.push({
      icon: '📅', tone: 'good',
      title: `Most productive on ${s.best_day_of_week}s`,
      body: `You complete the most tasks on ${s.best_day_of_week}s. Consider scheduling your hardest work then.`,
    })
  }
  if (s.completion_ratio_30d < 40) {
    insights.push({
      icon: '⚠️', tone: 'warn',
      title: `Only ${s.completion_ratio_30d}% of added tasks completed`,
      body: `In the last 30 days, ${s.tasks_added_30d} tasks were added but only ${s.tasks_completed_30d} were completed. Try adding fewer, more focused tasks.`,
    })
  } else if (s.completion_ratio_30d >= 70) {
    insights.push({
      icon: '🎯', tone: 'good',
      title: `${s.completion_ratio_30d}% completion rate`,
      body: `Great job — most tasks you add actually get done. You're setting realistic goals.`,
    })
  }
  if (s.stale_14d_plus > 0) {
    insights.push({
      icon: '🕰️', tone: 'warn',
      title: `${s.stale_14d_plus} task${s.stale_14d_plus > 1 ? 's' : ''} sitting for 14+ days`,
      body: `These are tasks you added but haven't touched in over 2 weeks. Either commit to them or delete them to keep your list honest.`,
    })
  }
  if (s.deferrals_30d > 5) {
    insights.push({
      icon: '⏭️', tone: 'warn',
      title: `${s.deferrals_30d} deferrals in the last 30 days`,
      body: top_deferred_tasks.length > 0
        ? `"${top_deferred_tasks[0].title}" has been deferred ${top_deferred_tasks[0].defer_count} times. Recurring deferrals often signal a task that needs breaking down or removing.`
        : 'Frequent deferrals can signal overloaded plans. Try planning fewer items per day.',
    })
  }
  if (perfectN > 0) {
    insights.push({
      icon: '✦', tone: 'good',
      title: `${perfectN} perfect day${perfectN > 1 ? 's' : ''} ${rangeLabel}`,
      body: `On those days you completed everything you set out to do. What made them different?`,
    })
  }
  if (s.habit_active_days_30d < 15) {
    insights.push({
      icon: '🔄', tone: is7d ? 'neutral' : 'warn',
      title: `Habits active ${s.habit_active_days_30d}/30 days`,
      body: `You have ${s.active_habits} active habit${s.active_habits !== 1 ? 's' : ''} but only checked in on ${s.habit_active_days_30d} days last month. Consistency is the key to habits sticking.`,
    })
  } else if (s.habit_active_days_30d >= 25) {
    insights.push({
      icon: '🔥', tone: 'good',
      title: `Habits on ${s.habit_active_days_30d}/30 days — strong consistency`,
      body: `You've been checking in on your habits almost every day. Keep it up.`,
    })
  }

  const maxWeekly = Math.max(1, ...weekly_breakdown.map(w => Math.max(w.completed, w.added)))

  return (
    <div className="space-y-8 pb-10">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-sand-800">Insights</h1>
          <p className="text-sm text-sand-400 mt-0.5">Your productivity patterns & behaviours</p>
        </div>
        <div className="flex gap-1 bg-sand-100 rounded-xl p-1">
          {['7d', '30d'].map(r => (
            <button key={r} onClick={() => setRange(r)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${range === r ? 'bg-white text-sand-800 shadow-sm' : 'text-sand-500 hover:text-sand-700'}`}>
              {r === '7d' ? '7 days' : '30 days'}
            </button>
          ))}
        </div>
      </div>

      {/* Top stats */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Tasks completed" value={completedN} sub={`+${addedN} added ${rangeLabel}`} accent />
        <StatCard label="Perfect days" value={perfectN} sub={`out of ${rangeDays} days`} />
        <StatCard label="Avg per active day" value={avgPerDay} sub="tasks completed" />
        <StatCard label="Deferrals" value={deferralsN} sub={rangeLabel} />
      </div>

      {/* Score breakdown */}
      <div className="bg-white border border-sand-200 rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-sand-700">Daily score</h2>
            <p className="text-xs text-sand-400 mt-0.5">Tasks: 70% weight · Habits: 30% weight</p>
          </div>
          <div className="text-right">
            <span className={`text-3xl font-bold ${gradeColor}`}>{gradeLabel}</span>
            <p className="text-xs text-sand-400">{avgScore}% avg</p>
          </div>
        </div>
        <div className="space-y-3">
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-sand-600 font-medium">Task completion</span>
              <span className="font-semibold text-sand-700">{avgTaskScore ?? avgScore}%</span>
            </div>
            <div className="h-2.5 bg-sand-100 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all ${avgTaskScore >= 70 ? 'bg-teal-500' : avgTaskScore >= 40 ? 'bg-gold-400' : 'bg-terra-400'}`}
                style={{ width: `${avgTaskScore ?? avgScore}%` }} />
            </div>
            <p className="text-[10px] text-sand-400 mt-1">Tasks you had on your daily list that you completed</p>
          </div>
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-sand-600 font-medium">Habit consistency</span>
              <span className="font-semibold text-sand-700">{avgHabitScore ?? 0}%</span>
            </div>
            <div className="h-2.5 bg-sand-100 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all ${avgHabitScore >= 70 ? 'bg-teal-500' : avgHabitScore >= 40 ? 'bg-gold-400' : 'bg-terra-400'}`}
                style={{ width: `${avgHabitScore ?? 0}%` }} />
            </div>
            <p className="text-[10px] text-sand-400 mt-1">How many of your {s.active_habits} active habits you checked in on</p>
          </div>
        </div>
      </div>

      {/* Completion heatmap */}
      <div className="bg-white border border-sand-200 rounded-2xl p-5">
        <h2 className="text-sm font-semibold text-sand-700 mb-4">Daily completion — last 60 days</h2>
        <HeatmapGrid snapshots={snapshots} />
      </div>

      {/* Behavior insights */}
      {insights.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-sand-500 uppercase tracking-wide mb-3">Behaviour insights</h2>
          <div className="space-y-2.5">
            {insights.map((ins, i) => (
              <InsightCard key={i} {...ins} />
            ))}
          </div>
        </div>
      )}

      {/* Two-column: weekly bars + day-of-week */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white border border-sand-200 rounded-2xl p-4">
          <h2 className="text-xs font-semibold text-sand-500 uppercase tracking-wide mb-4">Weekly output</h2>
          <div className="flex items-end gap-1">
            {weekly_breakdown.slice(-8).map((w, i) => (
              <WeeklyBar key={i} label={w.label} completed={w.completed} added={w.added} maxVal={maxWeekly} />
            ))}
          </div>
          <p className="text-[10px] text-sand-400 mt-2">Tasks completed per week</p>
        </div>
        <div className="bg-white border border-sand-200 rounded-2xl p-4">
          <h2 className="text-xs font-semibold text-sand-500 uppercase tracking-wide mb-4">Best days</h2>
          <DowChart completions_by_dow={s.completions_by_dow} best_day={s.best_day_of_week} />
          {s.best_day_of_week && (
            <p className="text-[10px] text-teal-600 font-medium mt-2">✦ {s.best_day_of_week} is your peak day</p>
          )}
        </div>
      </div>

      {/* Deferrals */}
      <div className="bg-white border border-sand-200 rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-sand-700">Deferrals</h2>
          <span className="text-xs text-sand-400">{deferralsN} {rangeLabel}</span>
        </div>
        {top_deferred_tasks.length === 0 ? (
          <p className="text-sm text-sand-400 italic">No deferrals recorded yet — they'll appear here when you push tasks to later.</p>
        ) : (
          <div className="space-y-2">
            {top_deferred_tasks.map((t, i) => (
              <div key={t.id} className="flex items-center justify-between py-1.5 border-b border-sand-100 last:border-0">
                <span className="text-sm text-sand-700 flex-1 min-w-0 truncate">{t.title}</span>
                <span className="text-xs px-2 py-0.5 rounded-lg bg-gold-50 text-gold-600 border border-gold-200 flex-shrink-0 ml-3">
                  deferred {t.defer_count}×
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Stale tasks */}
      {stale_tasks.length > 0 && (
        <div className="bg-white border border-sand-200 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-sm font-semibold text-sand-700">Stale tasks</h2>
            <span className="text-xs text-sand-400">{s.stale_7d_plus} older than 7d</span>
          </div>
          <p className="text-xs text-sand-400 mb-4">Tasks added but not completed — consider committing or removing them</p>
          <div className="space-y-2">
            {stale_tasks.map(t => (
              <div key={t.id} className="flex items-center justify-between py-1.5 border-b border-sand-100 last:border-0">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-terra-300 flex-shrink-0" />
                  <span
                    className="text-sm text-sand-700 truncate cursor-pointer hover:text-teal-600"
                    onClick={() => onGoToGoal && onGoToGoal(t.goal_id)}
                  >{t.title}</span>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-lg flex-shrink-0 ml-3 ${
                  t.days_old >= 30 ? 'bg-terra-50 text-terra-500 border border-terra-200'
                  : t.days_old >= 14 ? 'bg-gold-50 text-gold-600 border border-gold-200'
                  : 'bg-sand-50 text-sand-500 border border-sand-200'
                }`}>
                  {t.days_old}d old
                </span>
              </div>
            ))}
          </div>
          {s.stale_7d_plus > stale_tasks.length && (
            <p className="text-xs text-sand-400 mt-3">+{s.stale_7d_plus - stale_tasks.length} more stale tasks</p>
          )}
        </div>
      )}

      {/* Task health summary */}
      <div className="bg-white border border-sand-200 rounded-2xl p-5">
        <h2 className="text-sm font-semibold text-sand-700 mb-4">Task health</h2>
        <div className="space-y-3">
          {[
            { label: 'Added last 30d',       value: s.tasks_added_30d,       color: 'bg-teal-400' },
            { label: 'Completed last 30d',   value: s.tasks_completed_30d,   color: 'bg-teal-600' },
            { label: 'Stale 7+ days',        value: s.stale_7d_plus,         color: 'bg-gold-400' },
            { label: 'Stale 14+ days',       value: s.stale_14d_plus,        color: 'bg-terra-400' },
            { label: 'Deferred last 30d',    value: s.deferrals_30d,         color: 'bg-gold-300' },
          ].map(row => {
            const max = Math.max(1, s.tasks_added_30d)
            return (
              <div key={row.label} className="flex items-center gap-3">
                <span className="text-xs text-sand-500 w-36 flex-shrink-0">{row.label}</span>
                <div className="flex-1 h-2 bg-sand-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${row.color} transition-all`}
                    style={{ width: `${Math.min(100, Math.round((row.value / max) * 100))}%` }}
                  />
                </div>
                <span className="text-xs font-semibold text-sand-700 w-6 text-right">{row.value}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
