import { useEffect, useState } from 'react'
import Icon from '../../components/Icon'
import { fmtDuration } from './format'

// A compact, persistent "Now" strip for any running timers. Elapsed ticks live on
// the client from each session's started_at, so it stays smooth between refreshes.
export default function ActiveSessionBar({ workspace, onPause }) {
  const [, force] = useState(0)
  const timers = workspace?.active_timers || []

  useEffect(() => {
    if (timers.length === 0) return
    const id = setInterval(() => force(n => n + 1), 1000)
    return () => clearInterval(id)
  }, [timers.length])

  if (timers.length === 0) return null

  const now = Date.now()
  return (
    <div className="space-y-2">
      {timers.map(t => {
        const started = new Date(t.started_at).getTime()
        const elapsed = Math.max(0, Math.floor((now - started) / 1000))
        return (
          <div key={t.session_id}
            className="flex items-center gap-3 bg-surface border border-border rounded-xl px-4 py-2.5 shadow-card">
            <span className="status-dot live flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-ink truncate">
                <span className="text-[10px] font-mono uppercase text-accent mr-2">Now</span>
                {t.title}
              </p>
              <p className="text-[11px] text-muted truncate">
                {t.project_title}{t.company_name && t.company_name !== 'Personal' ? ` · ${t.company_name}` : ''}
                {t.crosses_midnight ? ' · started yesterday' : ''}
              </p>
            </div>
            <span className="font-mono tabular-nums text-ink text-sm flex-shrink-0">{fmtDuration(elapsed)}</span>
            {onPause && (
              <button onClick={() => onPause(t)} aria-label={`Pause ${t.title}`}
                className="text-muted hover:text-ink p-1 flex-shrink-0">
                <Icon name="pause" size={16} />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
