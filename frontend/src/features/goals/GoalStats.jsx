import { useEffect, useRef, useState } from 'react'
import { getGoalStats } from '../../api'
import { fmtDuration } from '../today/format'

// Streaks + consistency for one goal (GoalPage). Read-only; refetches whenever
// the goal reloads (`refreshKey`) or a task changes elsewhere.
// Resolutions: habit-based consistency and per-habit streaks. Projects: days
// with completed work. A streak stays alive until today (or this week) is over.

const HEAT = ['--heat-0', '--heat-1', '--heat-2', '--heat-3', '--heat-4']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function shortDate(iso) {
  if (!iso) return ''
  const [, m, d] = iso.split('-').map(Number)
  return `${MONTHS[m - 1]} ${d}`
}

function range(a, b) {
  if (!a) return ''
  return a === b ? shortDate(a) : `${shortDate(a)} – ${shortDate(b)}`
}

function plural(n, unit) {
  return `${n} ${unit}${n === 1 ? '' : 's'}`
}

function freqLabel(f) {
  const d = (f || '').match(/^(\d+)x_day$/)
  if (d) return `${d[1]}× a day`
  const w = (f || '').match(/^(\d+)x_week$/)
  if (w) return w[1] === '1' ? 'Weekly' : `${w[1]}× a week`
  return 'Daily'
}

function Tile({ label, value, sub, tone }) {
  return (
    <div className="bg-surface border border-border rounded-2xl px-3.5 sm:px-4 py-3 shadow-card min-w-0">
      <p className="text-[10px] font-mono uppercase tracking-widest text-muted">{label}</p>
      <p className={`stat-value text-xl sm:text-2xl font-semibold mt-1 ${tone || 'text-ink'}`}>{value}</p>
      {sub && <p className="text-[11px] text-muted mt-0.5 truncate" title={typeof sub === 'string' ? sub : undefined}>{sub}</p>}
    </div>
  )
}

function Heatmap({ cells }) {
  // Opens scrolled to the most recent weeks when the card is narrower than the grid.
  const scroller = useRef(null)
  useEffect(() => { if (scroller.current) scroller.current.scrollLeft = scroller.current.scrollWidth }, [cells])
  const weeks = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return (
    <div ref={scroller} className="overflow-x-auto -mx-1 px-1 pb-1">
      <div className="inline-flex flex-col gap-1 pr-3">
        <div className="flex gap-[3px] h-3 text-[9px] font-mono text-faint">
          {weeks.map((w, i) => {
            const m = Number(w[0].date.slice(5, 7))
            const prev = i > 0 ? Number(weeks[i - 1][0].date.slice(5, 7)) : null
            return <span key={w[0].date} className="w-[11px] overflow-visible whitespace-nowrap">{m !== prev ? MONTHS[m - 1] : ''}</span>
          })}
        </div>
        <div className="flex gap-[3px]" role="img" aria-label="Daily activity over the last 26 weeks">
          {weeks.map(w => (
            <div key={w[0].date} className="flex flex-col gap-[3px]">
              {w.map(c => (
                <span key={c.date}
                  title={c.future ? '' : `${shortDate(c.date)}: ${c.count ? plural(c.count, 'check-in') : 'nothing'}`}
                  className="w-[11px] h-[11px] rounded-[3px]"
                  style={{ backgroundColor: c.future ? 'transparent' : `rgb(var(${HEAT[Math.min(c.count, 4)]}))` }} />
              ))}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-1 text-[10px] text-faint mt-1">
          <span className="mr-1">Less</span>
          {HEAT.map(h => <span key={h} className="w-[9px] h-[9px] rounded-[2px]" style={{ backgroundColor: `rgb(var(${h}))` }} />)}
          <span className="ml-1">More</span>
        </div>
      </div>
    </div>
  )
}

function Trend({ weeks }) {
  return (
    <div className="flex-1 flex flex-col justify-end">
      <div className="flex items-end gap-1 h-24" role="img" aria-label="Active days per week, last 12 weeks">
        {weeks.map((w, i) => {
          const current = i === weeks.length - 1
          return (
            <div key={w.week_start} className="flex-1 h-full flex flex-col justify-end"
              title={`Week of ${shortDate(w.week_start)}: ${w.active_days}/${w.elapsed_days} days`}>
              <div className={`rounded-t-[3px] ${current ? 'bg-accent/50' : 'bg-accent'}`}
                style={{ height: `${Math.max(w.active_days ? 6 : 2, (w.active_days / 7) * 100)}%`, opacity: w.active_days ? 1 : 0.25 }} />
            </div>
          )
        })}
      </div>
      <div className="flex justify-between text-[9px] font-mono text-faint mt-1">
        <span>{shortDate(weeks[0]?.week_start)}</span><span>This week</span>
      </div>
    </div>
  )
}

function HabitRow({ h }) {
  const unit = h.unit === 'week' ? 'wk' : 'day'
  const rate = h.rate_30d ?? 0
  return (
    <div className="flex items-center gap-3 py-2.5 border-t border-border first:border-t-0">
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${h.done_now ? 'bg-accent' : 'bg-border-strong'}`}
        title={h.done_now ? (h.unit === 'week' ? 'Target met this week' : 'Done today') : (h.unit === 'week' ? 'Not met this week yet' : 'Not done today yet')} />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-ink truncate" title={h.title}>{h.title}</p>
        <p className="text-[11px] text-muted">
          {freqLabel(h.habit_frequency)}
          {h.last_done && <> · last {shortDate(h.last_done)}</>}
        </p>
      </div>
      <div className="text-right flex-shrink-0 w-16">
        <p className={`text-sm font-mono tabular-nums ${h.current_streak ? 'text-accent' : 'text-faint'}`}>
          {h.current_streak ? `🔥${h.current_streak}` : '0'}<span className="text-[10px] text-muted"> {unit}{h.current_streak === 1 ? '' : 's'}</span>
        </p>
        <p className="text-[10px] text-muted" title={range(h.best_start, h.best_end)}>best {h.best_streak}</p>
      </div>
      <div className="w-20 sm:w-28 flex-shrink-0">
        <div className="flex justify-between text-[10px] text-muted mb-1"><span>30d</span><span className="font-mono tabular-nums">{h.rate_30d == null ? '—' : `${rate}%`}</span></div>
        <div className="h-1 bg-border rounded-full"><div className="h-1 rounded-full bg-accent" style={{ width: `${rate}%` }} /></div>
      </div>
    </div>
  )
}

export default function GoalStats({ goalId, refreshKey }) {
  const [stats, setStats] = useState(null)

  useEffect(() => {
    let live = true
    const load = () => getGoalStats(goalId).then(s => { if (live) setStats(s) }).catch(() => {})
    load()
    window.addEventListener('basira:task-updated', load)
    return () => { live = false; window.removeEventListener('basira:task-updated', load) }
  }, [goalId, refreshKey])

  if (!stats) return null
  const s = stats
  const isResolution = s.type === 'resolution' && s.habits.length > 0
  const streakSub = s.current_streak
    ? (s.active_today ? 'Kept today' : 'Keep it going today')
    : (s.last_active ? `Last active ${shortDate(s.last_active)}` : 'No activity yet')

  return (
    <section className="mb-7" aria-label="Goal stats">
      <p className="eyebrow mb-2">Consistency</p>
      <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] lg:grid-cols-4 gap-2.5">
        <Tile label="Current streak" value={plural(s.current_streak, 'day')} sub={streakSub}
          tone={s.current_streak ? 'text-accent' : 'text-ink'} />
        <Tile label="Best streak" value={plural(s.best_streak, 'day')}
          sub={s.best_streak ? range(s.best_start, s.best_end) : '—'} />
        <Tile label="30-day consistency" value={s.consistency_30d == null ? '—' : `${s.consistency_30d}%`}
          sub={isResolution ? 'of habit targets hit' : `${s.active_days_30d} of ${s.window_days} days active`} />
        {isResolution
          ? <Tile label="Active days" value={`${s.active_days_30d}/${s.window_days}`}
              sub={`${s.total_checkins} check-ins since ${shortDate(s.started)}`} />
          : <Tile label="Tasks done" value={`${s.tasks_done}/${s.tasks_total}`}
              sub={s.time_logged_seconds ? `${fmtDuration(s.time_logged_seconds)} logged` : `${s.active_days_total} active days total`} />}
      </div>

      <div className="flex flex-wrap gap-2.5 mt-2.5">
        <div className="flex-none max-w-full bg-surface border border-border rounded-2xl p-4 shadow-card min-w-0">
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted mb-2">Last 26 weeks</p>
          <Heatmap cells={s.heatmap} />
        </div>
        <div className="flex-1 min-w-[180px] bg-surface border border-border rounded-2xl p-4 shadow-card flex flex-col">
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted mb-2">Active days per week</p>
          <Trend weeks={s.trend} />
        </div>
      </div>

      {isResolution && (
        <div className="bg-surface border border-border rounded-2xl px-4 py-1.5 shadow-card mt-2.5">
          {s.habits.map(h => <HabitRow key={h.id} h={h} />)}
        </div>
      )}
    </section>
  )
}
