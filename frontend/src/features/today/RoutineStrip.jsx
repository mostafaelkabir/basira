import { useState } from 'react'
import Icon from '../../components/Icon'
import { fmtClock } from './format'

// Habits as daily check marks (mockup zone D) — never rows on the schedule, never
// timed. One horizontally scrollable strip of pill chips, ordered by time then
// title; tapping toggles the check-in through the handler TodayPage provides.
// Habits the user put on today's schedule (BAS-050) live there instead, so they
// are not repeated as chips — but still count toward the Routine total.
export default function RoutineStrip({ routines, onToggle, onOpenNotes, onAddToDay }) {
  const [expanded, setExpanded] = useState(false)
  const items = ['morning', 'afternoon', 'evening', 'anytime']
    .flatMap(b => routines?.[b] || [])
    .sort((a, b) => (a.scheduled_time || '99:99').localeCompare(b.scheduled_time || '99:99') || a.title.localeCompare(b.title))

  if (items.length === 0) return null
  const done = items.filter(h => h.done).length
  const chips = items.filter(h => !h.planned)
  const shown = expanded ? chips : chips.slice(0, 6)
  const hidden = chips.length - shown.length

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <p className="eyebrow">Routine {done}/{items.length}</p>
        {onAddToDay && chips.length > 0 && (
          <button onClick={onAddToDay} className="text-[11px] text-accent hover:underline">Add to schedule →</button>
        )}
      </div>
      {chips.length === 0 && <p className="text-xs text-muted">All your habits are on today’s schedule.</p>}
      {/* Collapsed: one scrollable row. Expanded: wrap to multiple rows, all in view. */}
      <div className={`flex items-center gap-1.5 pb-1 -mb-1 ${expanded ? 'flex-wrap' : 'overflow-x-auto'}`}>
        {shown.map(h => (
          <div key={h.id} className={`flex items-center rounded-full border flex-shrink-0 transition-colors ${
            h.done ? 'bg-accent-soft border-accent/40 text-accent' : 'bg-surface border-border text-ink hover:border-accent/40'}`}>
          <button onClick={() => onToggle?.(h)} className={`flex items-center gap-1.5 py-1.5 ${onOpenNotes ? 'pl-2.5 pr-1' : 'px-2.5'}`}>
            <span className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center text-[9px] flex-shrink-0 ${
              h.done ? 'bg-accent border-accent text-on-accent' : 'border-border-strong'}`}>{h.done ? '✓' : ''}</span>
            <span className={`text-xs whitespace-nowrap ${h.done ? 'line-through opacity-80' : ''}`}>{h.title}</span>
            {h.target > 1 && <span className="text-[10px] font-mono text-faint">{h.count}/{h.target}</span>}
            {h.scheduled_time && <span className="text-[10px] font-mono text-faint">{fmtClock(h.scheduled_time)}</span>}
          </button>
          {onOpenNotes && (
            <button onClick={() => onOpenNotes(h)} title="Notes" aria-label={`Notes for ${h.title}`}
              className="pl-1 pr-2 py-1.5 text-faint hover:text-accent">
              <Icon name="note" size={12} />
            </button>
          )}
          </div>
        ))}
        {hidden > 0 && (
          <button onClick={() => setExpanded(true)}
            className="text-[11px] text-muted hover:text-ink px-2 py-1.5 flex-shrink-0">▾ {hidden} more</button>
        )}
        {expanded && chips.length > 6 && (
          <button onClick={() => setExpanded(false)}
            className="text-[11px] text-muted hover:text-ink px-2 py-1.5 flex-shrink-0">▴ less</button>
        )}
      </div>
    </div>
  )
}
