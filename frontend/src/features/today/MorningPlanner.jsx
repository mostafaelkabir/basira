import { useEffect, useState } from 'react'
import Modal from '../../components/Modal'
import Icon from '../../components/Icon'
import { notify } from '../../components/Notice'
import { getMorningSuggestions, getDayWorkspace, addToSchedule } from '../../api'
import { fmtMinutes, fmtDuration } from './format'
import FindOrCreateComposer from '../composer/FindOrCreateComposer'
import { useTimer } from '../../TimerContext'

const SOURCE_BADGE = { ticket: 'Ticket', task: 'Task', worklog: 'Log' }

// One morning surface: day availability, suggested work (each with a reason),
// find-or-create, and a live "planned today" preview — plan an item and begin
// work without leaving the page. Read-only until the user adds something.
export default function MorningPlanner({ date, onClose, onPlanned }) {
  const { startTimer } = useTimer()
  const [sugg, setSugg] = useState(null)
  const [ws, setWs] = useState(null)
  const [busyKey, setBusyKey] = useState(null)

  function refresh() {
    return Promise.all([
      getMorningSuggestions(date).then(setSugg).catch(() => {}),
      getDayWorkspace(date).then(setWs).catch(() => {}),
    ])
  }
  useEffect(() => { refresh() }, [date])

  async function add(s, start = false) {
    setBusyKey(s.key)
    try {
      await addToSchedule(s.source, s.item_id)   // reference the existing item; never a copy
      if (start && s.source === 'task') {
        startTimer(s.item_id, s.title, s.project_title || '')
        window.dispatchEvent(new CustomEvent('basira:timer-changed'))
      }
      notify(start ? `Planned & started “${s.title}”` : `Planned “${s.title}”`)
      onPlanned?.()
      await refresh()
    } catch (e) { notify(e.message) }
    finally { setBusyKey(null) }
  }

  const suggestions = sugg?.suggestions || []
  const plannedMin = ws?.totals?.planned_minutes || 0
  const recorded = ws?.totals?.recorded_seconds || 0
  const agendaCount = (ws?.agenda?.length || 0) + (ws?.unscheduled?.length || 0)

  return (
    <Modal title="Plan my day" onClose={onClose} wide>
      <div className="space-y-4">
        {/* Availability summary */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted bg-raised rounded-xl px-4 py-2.5">
          <span><span className="font-mono tabular-nums text-ink">{fmtMinutes(plannedMin)}</span> planned today</span>
          <span><span className="font-mono tabular-nums text-ink">{agendaCount}</span> item{agendaCount === 1 ? '' : 's'} on today’s plan</span>
          {recorded > 0 && <span><span className="font-mono tabular-nums text-ink">{fmtDuration(recorded)}</span> already recorded</span>}
        </div>

        {/* Find or create (existing composer) */}
        <div>
          <p className="eyebrow mb-2">Add anything</p>
          <FindOrCreateComposer
            placeholder="Find an existing ticket/task/habit/goal, or type a new title…"
            onDone={(r) => { if (r) { onPlanned?.(); refresh() } }}
          />
        </div>

        {/* Suggested work, each with a reason */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="eyebrow">Suggested for today</p>
            {sugg && (
              <span className="text-[11px] text-muted">
                {sugg.counts.due} due · {sugg.counts.in_progress} in progress · {sugg.counts.carried_over} carried over
              </span>
            )}
          </div>
          {!sugg && <p className="text-sm text-muted">Loading suggestions…</p>}
          {sugg && suggestions.length === 0 && (
            <p className="text-sm text-muted italic">Nothing outstanding — your plan is clear. Add work above.</p>
          )}
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {suggestions.map(s => (
              <div key={s.key} className="flex items-center gap-2 bg-surface border border-border rounded-xl px-3 py-2">
                <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-raised text-muted flex-shrink-0">
                  {SOURCE_BADGE[s.source] || s.source}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-ink truncate">{s.title}</p>
                  <p className="text-[11px] text-muted truncate">
                    {s.project_title}
                    <span className="text-faint"> · </span>
                    {s.reasons.join(' · ')}
                  </p>
                </div>
                <button onClick={() => add(s)} disabled={busyKey === s.key}
                  className="text-xs text-accent px-2 py-1 rounded-lg hover:bg-raised transition-colors flex-shrink-0 disabled:opacity-50">
                  Plan
                </button>
                {s.source === 'task' && (
                  <button onClick={() => add(s, true)} disabled={busyKey === s.key}
                    className="text-xs text-white bg-forest px-2 py-1 rounded-lg hover:bg-forest-hover transition-colors flex-shrink-0 disabled:opacity-50 flex items-center gap-1">
                    <Icon name="play" size={12} />Start
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end pt-1">
          <button onClick={onClose} className="secondary-button">Done</button>
        </div>
      </div>
    </Modal>
  )
}
