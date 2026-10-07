import { useEffect, useState } from 'react'
import {
  DndContext, PointerSensor, useSensor, useSensors, useDraggable, useDroppable,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import Modal from '../../components/Modal'
import Icon from '../../components/Icon'
import { notify } from '../../components/Notice'
import {
  getMorningSuggestions, getDayWorkspace, getUpcomingDays, addToSchedule, removeFromSchedule,
  setScheduleTime, snoozeSuggestion,
} from '../../api'
import { fmtMinutes, fmtDuration, fmtClock, addDays, dayShort, dayLong } from './format'
import FindOrCreateComposer from '../composer/FindOrCreateComposer'
import { useTimer } from '../../TimerContext'

const SOURCE_BADGE = { ticket: 'Ticket', task: 'Task', worklog: 'Log' }
const DROP_ID = 'today-plan'

// One planning surface for today and the next six days (BAS-046): a day strip
// with each day's load, suggested work (each with a reason), find-or-create, and
// the selected day's plan. Add work by clicking Plan/Start OR by dragging a
// suggestion into the plan. Read-only until the user adds something.
// `date` is today; `initialDay` opens the planner on an upcoming day.
export default function MorningPlanner({ date, initialDay, onClose, onPlanned }) {
  const { startTimer } = useTimer()
  const [day, setDay] = useState(initialDay || date)
  const [week, setWeek] = useState(null)
  const [sugg, setSugg] = useState(null)
  const [ws, setWs] = useState(null)
  const [busyKey, setBusyKey] = useState(null)
  const [dragging, setDragging] = useState(null)
  const [includeOlder, setIncludeOlder] = useState(false)

  // A click and a drag must not be confused: require a small movement to start a drag.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const isToday = day === date
  const dayName = isToday ? 'today' : day === addDays(date, 1) ? 'tomorrow' : dayLong(day)

  function refresh() {
    return Promise.all([
      getMorningSuggestions(day, { includeOlder }).then(setSugg).catch(() => {}),
      getDayWorkspace(day).then(setWs).catch(() => {}),
      getUpcomingDays(date, 7).then(setWeek).catch(() => {}),
    ])
  }
  useEffect(() => { setSugg(null); setWs(null); refresh() }, [day, includeOlder])

  async function snooze(s) {
    setBusyKey(s.key)
    try {
      // Hide until the day after the one being planned (default: tomorrow).
      await snoozeSuggestion(s.source, s.item_id, isToday ? undefined : addDays(day, 1))
      notify(`“${s.title}” — not ${dayName}`); await refresh()
    }
    catch (e) { notify(e.message) }
    finally { setBusyKey(null) }
  }

  async function add(s, start = false) {
    setBusyKey(s.key)
    try {
      await addToSchedule(s.source, s.item_id, day)   // reference the existing item; never a copy
      if (start && isToday && s.source === 'task') {
        startTimer(s.item_id, s.title, s.project_title || '')
        window.dispatchEvent(new CustomEvent('basira:timer-changed'))
      }
      notify(start ? `Planned & started “${s.title}”` : `Planned “${s.title}” for ${dayName}`)
      onPlanned?.()
      await refresh()
    } catch (e) { notify(e.message) }
    finally { setBusyKey(null) }
  }

  async function unplan(i) {
    setBusyKey(i.key)
    try { await removeFromSchedule(i.source, i.item_id); notify(`Removed “${i.title}” from ${dayName}`); onPlanned?.(); await refresh() }
    catch (e) { notify(e.message) }
    finally { setBusyKey(null) }
  }

  async function setTime(i, time) {
    try { await setScheduleTime(i.source, i.item_id, time || null); onPlanned?.(); await refresh() }
    catch (e) { notify(e.message) }
  }

  function onDragEnd({ active, over }) {
    setDragging(null)
    if (over?.id === DROP_ID && active?.data?.current) add(active.data.current)
  }

  const plannedMin = ws?.totals?.planned_minutes || 0
  const recorded = ws?.totals?.recorded_seconds || 0
  const available = ws?.totals?.available_minutes || 0
  const planItems = [...(ws?.agenda || []), ...(ws?.unscheduled || [])]

  return (
    <Modal title={isToday ? 'Plan my day' : 'Plan ahead'} onClose={onClose} wide>
      <DndContext sensors={sensors}
        onDragStart={e => setDragging(e.active?.data?.current || null)}
        onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
        <div className="space-y-4">
          <DayStrip week={week} today={date} selected={day} onSelect={d => { setDay(d); setIncludeOlder(false) }} />

          {/* Availability summary */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted bg-raised rounded-xl px-4 py-2.5">
            <span><span className="font-mono tabular-nums text-ink">{fmtMinutes(plannedMin)}</span> planned {isToday ? 'today' : `for ${dayName}`}
              {available > 0 && <> of <span className="font-mono tabular-nums text-ink">{fmtMinutes(available)}</span> available</>}</span>
            {available > 0 && plannedMin > available && <span className="text-amber-600">{fmtMinutes(plannedMin - available)} over</span>}
            <span><span className="font-mono tabular-nums text-ink">{planItems.length}</span> item{planItems.length === 1 ? '' : 's'} planned</span>
            {isToday && recorded > 0 && <span><span className="font-mono tabular-nums text-ink">{fmtDuration(recorded)}</span> already recorded</span>}
          </div>

          <div className="grid sm:grid-cols-2 gap-4 items-start">
            {/* ── Left: add + suggestions (drag sources) ── */}
            <div className="space-y-4 min-w-0">
              <div>
                <p className="eyebrow mb-2">Add anything</p>
                <FindOrCreateComposer key={day}
                  placeholder="Find or type a new title…"
                  planDate={day} planLabel={dayName}
                  onDone={(r) => { if (r) { onPlanned?.(); refresh() } }}
                />
              </div>
              <div className="space-y-3 max-h-[26rem] overflow-y-auto pr-0.5">
                {!sugg && <p className="text-sm text-muted">Loading…</p>}
                {sugg && sugg.groups.every(g => g.total === 0) && (
                  <p className="text-sm text-muted italic">Nothing outstanding — add work above.</p>
                )}
                {sugg?.groups.filter(g => g.total > 0).map(group => (
                  <div key={group.key}>
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="eyebrow">{group.label}</p>
                      <span className="text-[11px] text-muted">{group.total}</span>
                    </div>
                    <div className="space-y-1.5">
                      {group.items.map(s => (
                        <SuggestionCard key={s.key} s={s} busy={busyKey === s.key} canStart={isToday} dayName={dayName}
                          onPlan={() => add(s)} onStart={() => add(s, true)} onSnooze={() => snooze(s)} />
                      ))}
                    </div>
                    {group.key === 'older' && group.collapsed && (
                      <button onClick={() => setIncludeOlder(true)}
                        className="text-[11px] text-accent mt-1 hover:underline">Show all {group.total} →</button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* ── Right: the selected day's plan (drop target) ── */}
            <DayPlan items={planItems} dragging={dragging} busyKey={busyKey}
              label={isToday ? 'Today’s plan' : `Plan · ${dayLong(day)}`} dayName={dayName}
              onRemove={unplan} onSetTime={setTime} />
          </div>

          <div className="flex justify-end pt-1">
            <button onClick={onClose} className="secondary-button">Done</button>
          </div>
        </div>
      </DndContext>
    </Modal>
  )
}

// Today + the next six days, each with its planned load against capacity.
function DayStrip({ week, today, selected, onSelect }) {
  const days = week?.days || Array.from({ length: 7 }, (_, n) => ({ date: addDays(today, n) }))
  return (
    <div className="grid grid-cols-7 gap-1.5" role="tablist" aria-label="Day to plan">
      {days.map(d => {
        const on = d.date === selected
        const pct = d.available_minutes ? Math.min(100, Math.round((d.planned_minutes / d.available_minutes) * 100)) : 0
        const over = d.over_minutes > 0
        return (
          <button key={d.date} role="tab" aria-selected={on} onClick={() => onSelect(d.date)}
            title={d.item_count != null ? `${dayLong(d.date)} · ${d.item_count} planned · ${fmtMinutes(d.planned_minutes)}` : dayLong(d.date)}
            className={`min-w-0 rounded-xl border px-1.5 py-2 text-left transition-colors ${
              on ? 'border-accent bg-accent-soft' : 'border-border bg-surface hover:border-accent/40'}`}>
            <p className={`text-[10px] font-mono uppercase truncate ${on ? 'text-accent' : 'text-muted'}`}>
              <span className="sm:hidden">{dayLong(d.date).slice(0, 3)}</span>
              <span className="hidden sm:inline">{dayShort(d.date, today)}</span>
            </p>
            <p className="text-sm text-ink tabular-nums">{Number(d.date.slice(8))}</p>
            <div className="h-1 rounded-full bg-raised mt-1 overflow-hidden">
              <div className={`h-full rounded-full ${over ? 'bg-amber-500' : 'bg-accent'}`} style={{ width: `${pct}%` }} />
            </div>
            <p className="text-[10px] text-faint mt-1 truncate">
              {d.item_count ? <>{d.item_count}<span className="hidden sm:inline"> item{d.item_count === 1 ? '' : 's'}</span></> : '—'}
            </p>
          </button>
        )
      })}
    </div>
  )
}

function SuggestionCard({ s, busy, canStart, dayName, onPlan, onStart, onSnooze }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: s.key, data: s })
  const style = {
    transform: CSS.Translate.toString(transform),
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.9 : 1,
  }
  return (
    <div ref={setNodeRef} style={style}
      className={`flex items-center gap-2 bg-surface border rounded-xl px-2.5 py-2 ${
        isDragging ? 'border-accent shadow-float cursor-grabbing' : 'border-border'}`}>
      <button {...listeners} {...attributes} aria-label={`Drag ${s.title} to the plan for ${dayName}`}
        className="text-faint hover:text-muted cursor-grab active:cursor-grabbing px-0.5 touch-none flex-shrink-0">⠿</button>
      <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-raised text-muted flex-shrink-0">
        {SOURCE_BADGE[s.source] || s.source}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-ink truncate">{s.title}</p>
        <p className="text-[11px] text-muted truncate">
          {s.project_title}{s.company_name ? ` · ${s.company_name}` : ''}<span className="text-faint"> · </span>{s.reasons.join(' · ')}
        </p>
      </div>
      <span className="text-[10px] font-mono text-faint tabular-nums flex-shrink-0">{s.suggested_minutes}m</span>
      <button onClick={onPlan} disabled={busy}
        className="text-xs text-accent px-2 py-1 rounded-lg hover:bg-raised transition-colors flex-shrink-0 disabled:opacity-50">Plan</button>
      {canStart && s.source === 'task' && (
        <button onClick={onStart} disabled={busy}
          className="text-xs text-white bg-forest px-2 py-1 rounded-lg hover:bg-forest-hover transition-colors flex-shrink-0 disabled:opacity-50 flex items-center gap-1">
          <Icon name="play" size={12} />Start</button>
      )}
      <button onClick={onSnooze} disabled={busy} title={`Not ${dayName}`}
        className="text-faint hover:text-amber-600 px-1 flex-shrink-0 disabled:opacity-50" aria-label={`Not ${dayName}: ${s.title}`}>✕</button>
    </div>
  )
}

function DayPlan({ items, dragging, busyKey, label, dayName, onRemove, onSetTime }) {
  const { setNodeRef, isOver } = useDroppable({ id: DROP_ID })
  return (
    <div ref={setNodeRef}
      className={`min-w-0 rounded-2xl border-2 border-dashed p-3 min-h-[180px] transition-colors ${
        isOver ? 'border-accent bg-accent-soft' : dragging ? 'border-accent/50 bg-raised/40' : 'border-border bg-raised/20'}`}>
      <div className="flex items-center justify-between mb-2">
        <p className="eyebrow">{label}</p>
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
          <PlanRow key={i.key} i={i} busy={busyKey === i.key} dayName={dayName} onRemove={onRemove} onSetTime={onSetTime} />
        ))}
      </div>
    </div>
  )
}

function PlanRow({ i, busy, dayName, onRemove, onSetTime }) {
  const [editing, setEditing] = useState(false)
  return (
    <div className="flex items-center gap-2 bg-surface border border-border rounded-lg px-2.5 py-1.5">
      <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-raised text-muted flex-shrink-0">
        {SOURCE_BADGE[i.source] || i.source}
      </span>
      <span className={`text-sm truncate flex-1 ${i.status === 'done' ? 'text-muted line-through' : 'text-ink'}`}>{i.title}</span>
      {editing ? (
        <input type="time" defaultValue={i.scheduled_time || ''} autoFocus aria-label={`Time for ${i.title}`}
          onBlur={e => { setEditing(false); if (e.target.value !== (i.scheduled_time || '')) onSetTime(i, e.target.value) }}
          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEditing(false) } }}
          className="w-[84px] text-xs bg-surface border border-accent rounded-md px-1 py-0.5 focus:outline-none flex-shrink-0" />
      ) : (
        <button onClick={() => setEditing(true)} title="Set a time"
          className="text-[10px] font-mono text-faint hover:text-accent flex-shrink-0 tabular-nums">
          {i.scheduled_time ? fmtClock(i.scheduled_time) : 'Anytime'}
        </button>
      )}
      <button onClick={() => onRemove(i)} disabled={busy} title={`Remove from ${dayName}`}
        aria-label={`Remove ${i.title} from ${dayName}`}
        className="text-faint hover:text-red-500 px-0.5 flex-shrink-0 disabled:opacity-50">✕</button>
    </div>
  )
}
