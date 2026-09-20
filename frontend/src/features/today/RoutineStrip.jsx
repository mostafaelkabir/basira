import { useState } from 'react'
import { fmtClock } from './format'

// Habits as daily check marks (mockup zone D) — never rows on the schedule, never
// timed. One horizontally scrollable strip of pill chips, ordered by time then
// title; tapping toggles the check-in through the handler TodayPage provides.
export default function RoutineStrip({ routines, onToggle }) {
  const [expanded, setExpanded] = useState(false)
  const items = ['morning', 'afternoon', 'evening', 'anytime']
    .flatMap(b => routines?.[b] || [])
    .sort((a, b) => (a.scheduled_time || '99:99').localeCompare(b.scheduled_time || '99:99') || a.title.localeCompare(b.title))

  if (items.length === 0) return null
  const done = items.filter(h => h.done).length
  const shown = expanded ? items : items.slice(0, 6)
  const hidden = items.length - shown.length

  return (
    <div>
      <p className="eyebrow mb-1.5">Routine {done}/{items.length}</p>
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 -mb-1">
        {shown.map(h => (
          <button key={h.id} onClick={() => onToggle?.(h)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border flex-shrink-0 transition-colors ${
              h.done ? 'bg-accent-soft border-accent/40 text-accent' : 'bg-surface border-border text-ink hover:border-accent/40'}`}>
            <span className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center text-[9px] flex-shrink-0 ${
              h.done ? 'bg-accent border-accent text-on-accent' : 'border-border-strong'}`}>{h.done ? '✓' : ''}</span>
            <span className={`text-xs whitespace-nowrap ${h.done ? 'line-through opacity-80' : ''}`}>{h.title}</span>
            {h.target > 1 && <span className="text-[10px] font-mono text-faint">{h.count}/{h.target}</span>}
            {h.scheduled_time && <span className="text-[10px] font-mono text-faint">{fmtClock(h.scheduled_time)}</span>}
          </button>
        ))}
        {hidden > 0 && (
          <button onClick={() => setExpanded(true)}
            className="text-[11px] text-muted hover:text-ink px-2 py-1.5 flex-shrink-0">▾ {hidden} more</button>
        )}
      </div>
    </div>
  )
}
