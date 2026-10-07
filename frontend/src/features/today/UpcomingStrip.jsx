import { useEffect, useState } from 'react'
import { getUpcomingDays } from '../../api'
import { fmtMinutes, addDays, dayShort, dayLong } from './format'

// "Coming up" on Today (BAS-046): the next six days' plans at a glance — item
// count and planned vs available time — each opening the planner on that day.
// Read-only; refreshes whenever the schedule changes elsewhere.
export default function UpcomingStrip({ today, onPlanDay }) {
  const [week, setWeek] = useState(null)

  useEffect(() => {
    if (!today) return
    const load = () => getUpcomingDays(addDays(today, 1), 6).then(setWeek).catch(() => {})
    load()
    window.addEventListener('basira:schedule-updated', load)
    return () => window.removeEventListener('basira:schedule-updated', load)
  }, [today])

  if (!week) return null
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <p className="eyebrow">Coming up</p>
        <button onClick={() => onPlanDay(addDays(today, 1))} className="text-[11px] text-accent hover:underline">Plan tomorrow →</button>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
        {week.days.map(d => {
          const over = d.over_minutes > 0
          const pct = d.available_minutes ? Math.min(100, Math.round((d.planned_minutes / d.available_minutes) * 100)) : 0
          return (
            <button key={d.date} onClick={() => onPlanDay(d.date)}
              aria-label={`Plan ${dayLong(d.date)}: ${d.item_count} planned`}
              className="min-w-0 text-left bg-surface border border-border rounded-xl px-2.5 py-2 hover:border-accent/40 transition-colors">
              <div className="flex items-baseline justify-between gap-1">
                <span className="text-[10px] font-mono uppercase text-muted truncate">{dayShort(d.date, today)}</span>
                <span className="text-[10px] text-faint tabular-nums">{Number(d.date.slice(8))}</span>
              </div>
              <p className="text-xs text-ink mt-0.5 truncate">
                {d.item_count ? `${d.item_count} item${d.item_count === 1 ? '' : 's'}` : <span className="text-faint">Open</span>}
              </p>
              <div className="h-1 rounded-full bg-raised mt-1.5 overflow-hidden">
                <div className={`h-full rounded-full ${over ? 'bg-amber-500' : 'bg-accent'}`} style={{ width: `${pct}%` }} />
              </div>
              <p className={`text-[10px] mt-1 font-mono tabular-nums truncate ${over ? 'text-amber-600' : 'text-faint'}`}>
                {d.planned_minutes ? fmtMinutes(d.planned_minutes) : '—'}
              </p>
            </button>
          )
        })}
      </div>
    </div>
  )
}
