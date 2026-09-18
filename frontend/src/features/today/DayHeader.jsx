import { fmtDuration, fmtMinutes } from './format'

// A one-line honest summary of the day: recorded vs live vs planned time.
export default function DayHeader({ workspace }) {
  if (!workspace) return null
  const { recorded_seconds, live_seconds, planned_minutes } = workspace.totals
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted">
      <span><span className="font-mono tabular-nums text-ink">{fmtDuration(recorded_seconds)}</span> recorded</span>
      {live_seconds > 0 && (
        <span className="text-accent flex items-center gap-1">
          <span className="status-dot live" />
          +<span className="font-mono tabular-nums">{fmtDuration(live_seconds)}</span> live
        </span>
      )}
      {planned_minutes > 0 && (
        <span><span className="font-mono tabular-nums text-ink">{fmtMinutes(planned_minutes)}</span> planned</span>
      )}
    </div>
  )
}
