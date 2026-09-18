import { useState } from 'react'
import { fmtDuration } from './format'

// Time by project or client for the selected day. Recorded (saved) and live
// (running) seconds are shown separately so the ledger never conflates them.
export default function ProjectTimePanel({ workspace }) {
  const [group, setGroup] = useState('project') // 'project' | 'client'
  if (!workspace) return null

  const rows = group === 'project' ? workspace.by_project : workspace.by_client
  const nameKey = group === 'project' ? 'project_title' : 'company_name'
  const recorded = workspace.totals.recorded_seconds
  const live = workspace.totals.live_seconds
  const maxRow = Math.max(1, ...rows.map(r => r.seconds + r.live_seconds))

  return (
    <div className="bg-surface border border-border rounded-2xl shadow-card p-5">
      <div className="flex items-center justify-between mb-4">
        <p className="eyebrow">Time by {group}</p>
        <div className="flex gap-1 bg-raised p-0.5 rounded-lg" role="group" aria-label="Group time by">
          {['project', 'client'].map(g => (
            <button key={g} onClick={() => setGroup(g)} aria-pressed={group === g}
              className={`px-2.5 py-1 text-[11px] rounded-md capitalize transition-colors ${
                group === g ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}>
              {g}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-baseline gap-3 mb-4">
        <span className="today-stat-value !text-2xl !mt-0">{fmtDuration(recorded)}</span>
        <span className="text-xs text-muted">recorded</span>
        {live > 0 && (
          <span className="text-xs text-accent flex items-center gap-1">
            <span className="status-dot live" /> +{fmtDuration(live)} live
          </span>
        )}
      </div>

      {rows.length === 0 && (
        <p className="text-sm text-muted italic py-2">No time recorded yet today.</p>
      )}
      <div className="space-y-2.5">
        {rows.map((r, i) => {
          const total = r.seconds + r.live_seconds
          const pct = Math.round((total / maxRow) * 100)
          return (
            <div key={r[nameKey] + i}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-ink truncate pr-2">{r[nameKey]}</span>
                <span className="font-mono text-muted tabular-nums flex-shrink-0">
                  {fmtDuration(total)}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-raised overflow-hidden flex">
                <div className="h-full rounded-full" style={{
                  width: `${Math.round((r.seconds / maxRow) * 100)}%`,
                  background: 'rgb(var(--accent))',
                }} />
                {r.live_seconds > 0 && (
                  <div className="h-full rounded-full opacity-60" style={{
                    width: `${Math.max(0, pct - Math.round((r.seconds / maxRow) * 100))}%`,
                    background: 'rgb(var(--glow))',
                  }} />
                )}
              </div>
            </div>
          )
        })}
      </div>

      {workspace.warnings?.length > 0 && (
        <div className="mt-4 space-y-1.5">
          {workspace.warnings.map(w => (
            <p key={w.code} className="text-[11px] text-amber-600 flex items-start gap-1.5">
              <span aria-hidden>⚠</span><span>{w.message}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
