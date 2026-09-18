import { useState } from 'react'
import Modal from '../../components/Modal'
import { notify } from '../../components/Notice'
import { logDayTime } from '../../api'
import { fmtDuration } from './format'
import ProjectTimePanel from './ProjectTimePanel'

// The detail behind Today's one compact time line: project/client totals (recorded
// vs live shown separately), a drill-down of the recorded entries to their original
// Task/ticket/work-log, and manual Log time. Opened on demand, never permanent.
export default function TimeDetailDrawer({ workspace, onClose, onLogged }) {
  const [logItem, setLogItem] = useState('')      // "source:item_id"
  const [minutes, setMinutes] = useState('')
  const [date, setDate] = useState(workspace?.date || '')
  const [saving, setSaving] = useState(false)

  // Items the user can log against: everything on today's plan or already recorded.
  const items = []
  const seen = new Set()
  for (const list of [workspace?.agenda || [], workspace?.unscheduled || [], workspace?.recorded || []]) {
    for (const i of list) {
      if (i.source === 'worklog' || seen.has(i.key)) continue
      seen.add(i.key)
      items.push({ value: `${i.source}:${i.item_id}`, label: `${i.title}` , source: i.source })
    }
  }

  async function submit(e) {
    e.preventDefault()
    if (!logItem || !minutes) return
    const [source, item_id] = logItem.split(/:(.+)/)
    setSaving(true)
    try {
      await logDayTime({ source, item_id, minutes: parseInt(minutes) || 0, date })
      notify('Time logged')
      setMinutes('')
      onLogged?.()
    } catch (err) { notify(err.message) }   // entered fields preserved on failure
    finally { setSaving(false) }
  }

  const recorded = workspace?.recorded || []

  return (
    <Modal title="Time today" onClose={onClose} wide>
      <div className="space-y-4">
        <ProjectTimePanel workspace={workspace} />

        {/* Drill-down: each total traces to its original entries */}
        <div className="bg-surface border border-border rounded-2xl p-4">
          <p className="eyebrow mb-2">Recorded entries</p>
          {recorded.length === 0 && <p className="text-sm text-muted italic">No time recorded today.</p>}
          <div className="divide-y divide-border">
            {recorded.map(e => (
              <div key={e.key} className="flex items-center gap-2 py-2">
                <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-raised text-muted flex-shrink-0">{e.source}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-ink truncate">{e.title}</p>
                  <p className="text-[11px] text-muted truncate">{e.project_title}{e.company_name && e.company_name !== 'Personal' ? ` · ${e.company_name}` : ''}</p>
                </div>
                <span className="font-mono tabular-nums text-sm text-ink flex-shrink-0">{fmtDuration(e.seconds)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Manual log */}
        <form onSubmit={submit} className="bg-surface border border-border rounded-2xl p-4 space-y-2">
          <p className="eyebrow mb-1">Log time manually</p>
          <div className="flex flex-wrap gap-2 items-end">
            <label className="text-[11px] text-muted flex flex-col gap-0.5 flex-1 min-w-[160px]">
              Item
              <select value={logItem} onChange={e => setLogItem(e.target.value)}
                className="text-sm bg-canvas border border-border rounded-lg px-2 py-1.5 text-ink focus:outline-none focus:ring-1 focus:ring-accent">
                <option value="">Select…</option>
                {items.map(i => <option key={i.value} value={i.value}>{i.label}</option>)}
              </select>
            </label>
            <label className="text-[11px] text-muted flex flex-col gap-0.5">
              Minutes
              <input type="number" min="1" value={minutes} onChange={e => setMinutes(e.target.value)} placeholder="30"
                className="w-24 text-sm bg-canvas border border-border rounded-lg px-2 py-1.5 text-ink focus:outline-none focus:ring-1 focus:ring-accent" />
            </label>
            <label className="text-[11px] text-muted flex flex-col gap-0.5">
              Date
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="text-sm bg-canvas border border-border rounded-lg px-2 py-1.5 text-ink focus:outline-none focus:ring-1 focus:ring-accent" />
            </label>
            <button type="submit" disabled={saving || !logItem || !minutes}
              className="px-3 py-2 rounded-lg bg-forest text-white text-sm font-semibold hover:bg-forest-hover disabled:opacity-50">
              {saving ? 'Logging…' : 'Log time'}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  )
}
