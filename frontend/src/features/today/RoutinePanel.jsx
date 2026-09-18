import { BUCKET_LABELS, BUCKET_ORDER, fmtClock } from './format'

// Habits grouped by time of day, with today's occurrence progress. Read-only
// mirror of the routine checklist — check-ins still happen through the habit flow.
export default function RoutinePanel({ workspace, onToggle }) {
  if (!workspace) return null
  const routines = workspace.routines || {}
  const buckets = BUCKET_ORDER
    .map(key => ({ key, items: routines[key] || [] }))
    .filter(b => b.items.length > 0)

  if (buckets.length === 0) {
    return (
      <div className="bg-surface border border-border rounded-2xl shadow-card p-5">
        <p className="eyebrow mb-3">Routines</p>
        <p className="text-sm text-muted italic">No habits set up yet.</p>
      </div>
    )
  }

  return (
    <div className="bg-surface border border-border rounded-2xl shadow-card p-5">
      <p className="eyebrow mb-3">Routines</p>
      <div className="space-y-4">
        {buckets.map(({ key, items }) => {
          const done = items.filter(h => h.done).length
          return (
            <div key={key}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-mono uppercase tracking-wide text-muted">
                  {BUCKET_LABELS[key]}
                </span>
                <span className="text-[11px] font-mono tabular-nums text-muted">
                  {done} / {items.length}
                </span>
              </div>
              <div className="space-y-0.5">
                {items.map(h => (
                  <button key={h.id} onClick={() => onToggle?.(h)}
                    disabled={!onToggle}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-left transition-colors ${
                      onToggle ? 'hover:bg-raised' : ''} ${h.done ? 'text-muted' : 'text-ink'}`}>
                    <span className={`w-4 h-4 rounded-md border flex items-center justify-center flex-shrink-0 text-[10px] ${
                      h.done ? 'bg-accent border-accent text-on-accent' : 'border-border-strong'}`}>
                      {h.done ? '✓' : ''}
                    </span>
                    <span className={`flex-1 truncate ${h.done ? 'line-through' : ''}`}>{h.title}</span>
                    {h.target > 1 && (
                      <span className="text-[10px] font-mono text-faint">{h.count}/{h.target}</span>
                    )}
                    {h.scheduled_time && (
                      <span className="text-[10px] text-faint">{fmtClock(h.scheduled_time)}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
