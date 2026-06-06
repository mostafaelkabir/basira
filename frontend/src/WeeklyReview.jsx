import { useEffect, useState } from 'react'
import { getWeeklyReview } from './api'
import Modal from './components/Modal'

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

function freqLabel(freq) {
  if (!freq || freq === 'daily') return 'daily'
  const wm = freq.match(/^(\d+)x_week$/)
  if (wm) return wm[1] === '1' ? 'weekly' : `${wm[1]}× / week`
  const dm = freq.match(/^(\d+)x_day$/)
  if (dm) return `${dm[1]}× / day`
  return freq
}

function HabitRow({ habit, weekDates }) {
  const isOnTrack = habit.on_track
  const pct = habit.pct

  const barColor = isOnTrack ? 'bg-sage-400' : pct >= 50 ? 'bg-gold-400' : 'bg-terra-400'
  const textColor = isOnTrack ? 'text-sage-600' : pct >= 50 ? 'text-gold-600' : 'text-terra-500'
  const fractionColor = isOnTrack ? 'text-sage-600' : 'text-sand-500'

  return (
    <div className={`rounded-xl border px-3 py-3 ${isOnTrack ? 'border-sage-100 bg-sage-50/40' : 'border-sand-200 bg-white'}`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-sand-800">{habit.title}</span>
          <span className="text-[11px] text-sand-400 ml-1.5">{habit.goal_title}</span>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {habit.streak > 0 && (
            <span className="text-[10px] font-semibold text-gold-500">✦{habit.streak}</span>
          )}
          <span className={`text-xs font-bold ${fractionColor}`}>
            {habit.days_checked}/{habit.weekly_target}
          </span>
          {isOnTrack && <span className="text-sage-500 text-xs">✓</span>}
        </div>
      </div>

      {/* Day dots */}
      <div className="flex gap-1 mb-2">
        {weekDates.map((d) => {
          const checked = habit.checkins.includes(d)
          const dayLabel = DAY_LABELS[new Date(d + 'T00:00:00').getDay()]
          return (
            <div key={d} className="flex flex-col items-center gap-0.5 flex-1">
              <span className="text-[9px] text-sand-400">{dayLabel}</span>
              <span className={`w-full max-w-[28px] h-5 rounded-md text-[9px] flex items-center justify-center transition-colors ${
                checked ? `${barColor} text-white` : 'bg-sand-100 text-sand-300'
              }`}>
                {checked ? '✓' : ''}
              </span>
            </div>
          )
        })}
      </div>

      {/* Progress bar */}
      <div className="w-full bg-sand-100 rounded-full h-1">
        <div className={`h-1 rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
      </div>

      {!isOnTrack && (
        <p className="text-[10px] text-sand-400 mt-1.5">
          {habit.weekly_target - habit.days_checked} more to hit your {freqLabel(habit.habit_frequency)} goal
        </p>
      )}
    </div>
  )
}

export default function WeeklyReview({ onClose }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getWeeklyReview()
      .then(setData)
      .catch(err => alert(err.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading || !data) {
    return (
      <Modal title="Weekly Review" onClose={onClose}>
        <p className="text-sand-400 text-sm py-4">Loading…</p>
      </Modal>
    )
  }

  const onTrack = data.habits.filter(h => h.on_track)
  const needsWork = data.habits.filter(h => !h.on_track)

  // Group completed tasks by goal
  const tasksByGoal = data.tasks_completed.reduce((acc, t) => {
    if (!acc[t.goal_title]) acc[t.goal_title] = []
    acc[t.goal_title].push(t)
    return acc
  }, {})

  const pct = data.overall_habit_pct
  const gradeColor = pct >= 70 ? 'text-sage-600' : pct >= 40 ? 'text-gold-600' : 'text-terra-500'
  const barColor   = pct >= 70 ? 'bg-sage-400'  : pct >= 40 ? 'bg-gold-400'  : 'bg-terra-400'

  return (
    <Modal title="Weekly Review" onClose={onClose}>
      <div className="space-y-5 max-h-[75vh] overflow-y-auto pr-1 -mr-1">

        {/* ── Score banner ── */}
        <div className="bg-white border border-sand-200 rounded-2xl px-4 py-4 shadow-sm">
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-[11px] font-semibold text-sand-400 uppercase tracking-widest mb-0.5">Week of {data.week_start}</p>
              <p className={`text-3xl font-bold ${gradeColor}`}>{pct}%</p>
              <p className="text-sm text-sand-500 mt-0.5">{data.grade}</p>
            </div>
            <div className="text-right">
              {data.habits.length > 0 && (
                <>
                  <p className={`text-lg font-bold ${gradeColor}`}>{data.habits_on_track}/{data.habits.length}</p>
                  <p className="text-[11px] text-sand-400">habits on track</p>
                </>
              )}
              {data.tasks_completed.length > 0 && (
                <p className="text-[11px] text-sand-400 mt-1">{data.tasks_completed.length} tasks done</p>
              )}
            </div>
          </div>
          <div className="w-full bg-sand-100 rounded-full h-2">
            <div className={`h-2 rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
          </div>
        </div>

        {/* ── What went well ── */}
        {onTrack.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2.5">
              <span className="text-sage-500 text-xs">✦</span>
              <h3 className="text-[11px] font-semibold text-sand-400 uppercase tracking-widest">What went well</h3>
              <span className="flex-1 border-t border-sand-100" />
            </div>
            <div className="space-y-2">
              {onTrack.map(h => <HabitRow key={h.id} habit={h} weekDates={data.week_dates} />)}
            </div>
          </div>
        )}

        {/* ── Needs attention ── */}
        {needsWork.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2.5">
              <span className="text-gold-400 text-xs">◆</span>
              <h3 className="text-[11px] font-semibold text-sand-400 uppercase tracking-widest">To work on</h3>
              <span className="flex-1 border-t border-sand-100" />
            </div>
            <div className="space-y-2">
              {needsWork
                .sort((a, b) => b.pct - a.pct)
                .map(h => <HabitRow key={h.id} habit={h} weekDates={data.week_dates} />)}
            </div>
          </div>
        )}

        {data.habits.length === 0 && (
          <p className="text-sm text-sand-400 italic text-center py-4">
            No habits tracked yet — set up a Resolution goal to get started.
          </p>
        )}

        {/* ── Tasks completed ── */}
        {data.tasks_completed.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2.5">
              <span className="text-teal-400 text-xs">◈</span>
              <h3 className="text-[11px] font-semibold text-sand-400 uppercase tracking-widest">
                Tasks shipped ({data.tasks_completed.length})
              </h3>
              <span className="flex-1 border-t border-sand-100" />
            </div>
            <div className="space-y-3">
              {Object.entries(tasksByGoal).map(([goalTitle, tasks]) => (
                <div key={goalTitle}>
                  <p className="text-[11px] font-semibold text-sand-500 mb-1">{goalTitle}</p>
                  <div className="space-y-1">
                    {tasks.map((t, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-sage-300 flex-shrink-0" />
                        <span className="text-sm text-sand-700 flex-1">{t.title}</span>
                        <span className="text-[10px] text-sand-400 flex-shrink-0">{t.completed_at}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {data.tasks_completed.length === 0 && data.habits.length > 0 && (
          <p className="text-sm text-sand-400 italic text-center py-2">No tasks completed this week.</p>
        )}
      </div>
    </Modal>
  )
}
