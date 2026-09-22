import { useState } from 'react'
import { updateSettings } from '../../api'
import { notify } from '../../components/Notice'
import { fmtDuration, fmtMinutes } from './format'

// One capacity-aware line (mockup zone C): planned of available, a thin bar that
// turns amber when over, the buffer, and worked (+live). Click opens the time
// detail; the day window is editable inline and saves through the settings API.
export default function CapacityLine({ workspace, onOpenDetail, onSettingsChanged }) {
  const t = workspace?.totals || {}
  const planned = t.planned_minutes || 0
  const available = t.available_minutes || 0
  const over = t.over_minutes || 0
  const recorded = t.recorded_seconds || 0
  const live = t.live_seconds || 0
  const pct = available > 0 ? Math.min(100, Math.round((planned / available) * 100)) : (planned > 0 ? 100 : 0)
  const [editing, setEditing] = useState(false)

  async function saveWindow(key, value) {
    try { await updateSettings({ [key]: value }); onSettingsChanged?.() }
    catch (e) { notify(e.message) }
  }

  return (
    <div className="capacity-line">
      <div className="flex items-center gap-2 flex-wrap">
        <button className="flex-1 min-w-0 text-left flex items-baseline gap-1.5" onClick={onOpenDetail} aria-label="Open time detail">
          <span className="font-mono tabular-nums text-ink">{fmtMinutes(planned)}</span>
          <span className="text-muted">planned of</span>
          <span className="font-mono tabular-nums text-ink">{fmtMinutes(available)}</span>
          <span className="text-muted">available</span>
          {over > 0 && <span className="text-amber-600 font-medium">· Over by {fmtMinutes(over)}</span>}
        </button>
        <button onClick={() => setEditing(v => !v)} className="text-[11px] text-muted hover:text-ink flex-shrink-0">
          buffer {t.buffer_pct ?? 15}%
        </button>
        <span className="text-[11px] text-muted flex-shrink-0">
          Worked <span className="font-mono tabular-nums text-ink">{fmtDuration(recorded)}</span>
          {live > 0 && <span className="text-accent"> +{fmtDuration(live)}</span>}
        </span>
      </div>

      <div className="capacity-bar mt-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className={`capacity-fill ${over > 0 ? 'over' : ''}`} style={{ width: `${pct}%` }} />
      </div>

      {editing && (
        <div className="flex items-center gap-3 mt-2 text-[11px] text-muted flex-wrap">
          <label className="flex items-center gap-1">Start
            <input type="time" defaultValue={t.day_start || '09:00'} onBlur={e => saveWindow('day_start', e.target.value)}
              className="bg-surface border border-border rounded-md px-1 py-0.5 text-ink" /></label>
          <label className="flex items-center gap-1">End
            <input type="time" defaultValue={t.day_end || '18:00'} onBlur={e => saveWindow('day_end', e.target.value)}
              className="bg-surface border border-border rounded-md px-1 py-0.5 text-ink" /></label>
          <label className="flex items-center gap-1">Buffer
            <input type="number" min="0" max="90" defaultValue={t.buffer_pct ?? 15}
              onBlur={e => saveWindow('buffer_pct', parseInt(e.target.value) || 0)}
              className="w-14 bg-surface border border-border rounded-md px-1 py-0.5 text-ink" />%</label>
          <span className="text-faint">More in Settings › Your day</span>
        </div>
      )}
    </div>
  )
}
