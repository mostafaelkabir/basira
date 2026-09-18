import { useEffect, useState } from 'react'
import {
  DndContext, PointerSensor, useSensor, useSensors, useDraggable, useDroppable,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import Modal from '../../components/Modal'
import Icon from '../../components/Icon'
import { notify } from '../../components/Notice'
import { getMorningSuggestions, getDayWorkspace, addToSchedule } from '../../api'
import { fmtMinutes, fmtDuration } from './format'
import FindOrCreateComposer from '../composer/FindOrCreateComposer'
import { useTimer } from '../../TimerContext'

const SOURCE_BADGE = { ticket: 'Ticket', task: 'Task', worklog: 'Log' }
const DROP_ID = 'today-plan'

// One morning surface: day availability, suggested work (each with a reason),
// find-or-create, and a live plan. Add work by clicking Plan/Start OR by dragging
// a suggestion into "Today's plan". Read-only until the user adds something.
export default function MorningPlanner({ date, onClose, onPlanned }) {
  const { startTimer } = useTimer()
  const [sugg, setSugg] = useState(null)
  const [ws, setWs] = useState(null)
  const [busyKey, setBusyKey] = useState(null)
  const [dragging, setDragging] = useState(null)

  // A click and a drag must not be confused: require a small movement to start a drag.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

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

  function onDragEnd({ active, over }) {
    setDragging(null)
    if (over?.id === DROP_ID && active?.data?.current) add(active.data.current)
  }

  const suggestions = sugg?.suggestions || []
  const plannedMin = ws?.totals?.planned_minutes || 0
  const recorded = ws?.totals?.recorded_seconds || 0
  const planItems = [...(ws?.agenda || []), ...(ws?.unscheduled || [])]

  return (
    <Modal title="Plan my day" onClose={onClose} wide>
      <DndContext sensors={sensors}
        onDragStart={e => setDragging(e.active?.data?.current || null)}
        onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
        <div className="space-y-4">
          {/* Availability summary */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted bg-raised rounded-xl px-4 py-2.5">
            <span><span className="font-mono tabular-nums text-ink">{fmtMinutes(plannedMin)}</span> planned today</span>
            <span><span className="font-mono tabular-nums text-ink">{planItems.length}</span> item{planItems.length === 1 ? '' : 's'} on today’s plan</span>
            {recorded > 0 && <span><span className="font-mono tabular-nums text-ink">{fmtDuration(recorded)}</span> already recorded</span>}
          </div>

          <div className="grid sm:grid-cols-2 gap-4 items-start">
            {/* ── Left: add + suggestions (drag sources) ── */}
            <div className="space-y-4">
              <div>
                <p className="eyebrow mb-2">Add anything</p>
                <FindOrCreateComposer
                  placeholder="Find or type a new title…"
                  onDone={(r) => { if (r) { onPlanned?.(); refresh() } }}
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="eyebrow">Suggested for today</p>
                  {sugg && (
                    <span className="text-[11px] text-muted">
                      {sugg.counts.due} due · {sugg.counts.in_progress} in progress · {sugg.counts.carried_over} carried
                    </span>
                  )}
                </div>
                {!sugg && <p className="text-sm text-muted">Loading…</p>}
                {sugg && suggestions.length === 0 && (
                  <p className="text-sm text-muted italic">Nothing outstanding — add work above.</p>
                )}
                <div className="space-y-1.5 max-h-64 overflow-y-auto pr-0.5">
                  {suggestions.map(s => (
                    <SuggestionCard key={s.key} s={s} busy={busyKey === s.key}
                      onPlan={() => add(s)} onStart={() => add(s, true)} />
                  ))}
                </div>
              </div>
            </div>

            {/* ── Right: today's plan (drop target) ── */}
            <TodayPlan items={planItems} dragging={dragging} />
          </div>

          <div className="flex justify-end pt-1">
            <button onClick={onClose} className="secondary-button">Done</button>
          </div>
        </div>
      </DndContext>
    </Modal>
  )
}

function SuggestionCard({ s, busy, onPlan, onStart }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: s.key, data: s,
  })
  const style = {
    transform: CSS.Translate.toString(transform),
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.9 : 1,
  }
  return (
    <div ref={setNodeRef} style={style}
      className={`flex items-center gap-2 bg-surface border rounded-xl px-2.5 py-2 ${
        isDragging ? 'border-accent shadow-float cursor-grabbing' : 'border-border'}`}>
      <button {...listeners} {...attributes} aria-label={`Drag ${s.title} to today’s plan`}
        className="text-faint hover:text-muted cursor-grab active:cursor-grabbing px-0.5 touch-none flex-shrink-0">⠿</button>
      <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-raised text-muted flex-shrink-0">
        {SOURCE_BADGE[s.source] || s.source}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-ink truncate">{s.title}</p>
        <p className="text-[11px] text-muted truncate">{s.project_title}<span className="text-faint"> · </span>{s.reasons.join(' · ')}</p>
      </div>
      <button onClick={onPlan} disabled={busy}
        className="text-xs text-accent px-2 py-1 rounded-lg hover:bg-raised transition-colors flex-shrink-0 disabled:opacity-50">Plan</button>
      {s.source === 'task' && (
        <button onClick={onStart} disabled={busy}
          className="text-xs text-white bg-forest px-2 py-1 rounded-lg hover:bg-forest-hover transition-colors flex-shrink-0 disabled:opacity-50 flex items-center gap-1">
          <Icon name="play" size={12} />Start</button>
      )}
    </div>
  )
}

function TodayPlan({ items, dragging }) {
  const { setNodeRef, isOver } = useDroppable({ id: DROP_ID })
  return (
    <div ref={setNodeRef}
      className={`rounded-2xl border-2 border-dashed p-3 min-h-[180px] transition-colors ${
        isOver ? 'border-accent bg-accent-soft' : dragging ? 'border-accent/50 bg-raised/40' : 'border-border bg-raised/20'}`}>
      <div className="flex items-center justify-between mb-2">
        <p className="eyebrow">Today’s plan</p>
        <span className="text-[11px] text-muted">{items.length} item{items.length === 1 ? '' : 's'}</span>
      </div>
      {dragging && (
        <p className="text-xs text-accent mb-2">Drop “{dragging.title}” here to plan it →</p>
      )}
      {items.length === 0 && !dragging && (
        <p className="text-sm text-muted italic">Drag suggestions here, or use Plan / Start.</p>
      )}
      <div className="space-y-1">
        {items.map(i => (
          <div key={i.key} className="flex items-center gap-2 bg-surface border border-border rounded-lg px-2.5 py-1.5">
            <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-raised text-muted flex-shrink-0">
              {SOURCE_BADGE[i.source] || i.source}
            </span>
            <span className="text-sm text-ink truncate flex-1">{i.title}</span>
            {i.scheduled_time && <span className="text-[10px] text-faint flex-shrink-0">{i.scheduled_time}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}
