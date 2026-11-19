import { useEffect, useState } from 'react'
import Icon from '../../components/Icon'
import { dayLong, fmtClock, fmtDuration, fmtMinutes } from './format'
import { POSTPONE_REASONS } from './PostponeDialog'
import { routineLabel } from '../habits/RoutineEditor'
import { chronoEntries } from './listOrder'

// One chronological Today agenda: scheduled Tasks, tickets and habit occurrences in
// time order, an "Anytime today" group for selected items without a time, and a
// collapsed "Completed" section. The active item owns its running timer inline —
// it is never copied into a separate hero. Read-only rendering; all mutations go
// through the handlers passed by TodayPage.

const SOURCE_DOT = {
  task: 'rgb(var(--accent))',
  ticket: 'rgb(96 165 250)',
  worklog: 'rgb(167 139 250)',
  habit: 'rgb(var(--gold))',
}
const SOURCE_LABEL = { task: 'Task', ticket: 'Ticket', worklog: 'Log', habit: 'Habit' }
const REASON_LABEL = Object.fromEntries(POSTPONE_REASONS.map(r => [r.value, r.label]))

function Elapsed({ startedAt, priorSeconds = 0 }) {
  const [, force] = useState(0)
  useEffect(() => { const id = setInterval(() => force(n => n + 1), 1000); return () => clearInterval(id) }, [])
  const base = startedAt ? Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000) : 0
  return <span className="font-mono tabular-nums">{fmtDuration(priorSeconds + Math.max(0, base))}</span>
}

function Row({ item, timer, onStartTask, onPauseTask, onResumeTask, onCompleteTask, onOpenTicket, onOpenNotes, onCheckHabit, onEditTime, onPostpone, onUndo, onDelete, onFixTime, onMoveIntoBlock, onAddBlockHere }) {
  const [editing, setEditing] = useState(false)
  const isTask = item.source === 'task'
  const isTicket = item.source === 'ticket'
  const isHabit = item.source === 'habit'
  const taskActive = isTask && timer?.taskId === item.item_id
  const running = taskActive && timer.running
  const recorded = item.recorded_seconds + (item.live_seconds || 0)

  return (
    <div className={`agenda-row ${item.active || running ? 'agenda-row-active' : ''}`}>
      <div className="w-14 flex-shrink-0 text-right pt-0.5">
        {editing ? (
          <input type="time" defaultValue={item.scheduled_time || ''} autoFocus
            onBlur={e => { setEditing(false); if (e.target.value !== (item.scheduled_time || '')) onEditTime?.(item, e.target.value) }}
            className="w-[74px] text-xs bg-surface border border-accent rounded-md px-1 py-0.5 focus:outline-none" />
        ) : item.scheduled_time ? (
          <button onClick={() => onEditTime && setEditing(true)} className="text-xs font-mono text-ink tabular-nums hover:text-accent">{fmtClock(item.scheduled_time)}</button>
        ) : (
          <button onClick={() => onEditTime && setEditing(true)} className="text-[10px] text-accent uppercase hover:underline" aria-label={`Set time for ${item.title}`}>Set time</button>
        )}
      </div>

      {isHabit ? (
        <button onClick={() => onCheckHabit?.(item)} aria-label={`Check ${item.title}`}
          className={`w-4 h-4 mt-1 rounded-md border flex items-center justify-center flex-shrink-0 text-[10px] ${
            item.done ? 'bg-accent border-accent text-on-accent' : 'border-border-strong hover:border-accent'}`}>
          {item.done ? '✓' : ''}
        </button>
      ) : (
        <span className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ background: SOURCE_DOT[item.source] }} />
      )}

      <div className="flex-1 min-w-0">
        {isTicket
          ? <button onClick={() => onOpenTicket(item)} className="text-sm text-ink truncate text-left hover:text-accent">{item.title}</button>
          : (isTask || isHabit) && onOpenNotes
            ? <button onClick={() => onOpenNotes(item)} title="Open notes"
                className={`block max-w-full text-sm truncate text-left hover:text-accent ${item.done ? 'text-muted line-through' : 'text-ink'}`}>{item.title}</button>
            : <p className={`text-sm truncate ${item.done ? 'text-muted line-through' : 'text-ink'}`}>{item.title}</p>}
        <p className="text-[11px] text-muted mt-0.5 flex items-center gap-1.5 flex-wrap">
          <span>{item.project_title}</span>
          {item.company_name && item.company_name !== 'Personal' && <><span className="text-faint">·</span><span>{item.company_name}</span></>}
          {isHabit && item.habitTarget > 1 && <><span className="text-faint">·</span><span>{item.habitCount}/{item.habitTarget}</span></>}
          {isHabit && item.routine && <><span className="text-faint">·</span><span title="On your planner by routine">↻ {routineLabel(item.routine_days)}</span></>}
          {!isHabit && item.planned_minutes > 0 && <><span className="text-faint">·</span><span>{fmtMinutes(item.planned_minutes)} planned</span></>}
          {running && <><span className="text-faint">·</span><span className="text-accent flex items-center gap-1"><span className="status-dot live" /><Elapsed startedAt={timer.startedAt} priorSeconds={timer.priorSeconds} /></span></>}
          {!running && recorded > 0 && !isHabit && <><span className="text-faint">·</span><span className="text-accent">{fmtDuration(recorded)} recorded</span></>}
        </p>
        {item.off_block && !item.done && (onMoveIntoBlock || onAddBlockHere) && (
          <p className="off-block" data-testid="off-block">
            <span>Outside your {item.off_block.title} block ({fmtClock(item.off_block.start_time)} – {fmtClock(item.off_block.end_time)})</span>
            {onMoveIntoBlock && <button onClick={() => onMoveIntoBlock(item)}>Move into block</button>}
            {onAddBlockHere && <button onClick={() => onAddBlockHere(item)}>Add {item.off_block.title} block here</button>}
          </p>
        )}
        {item.postponed && !item.done && (
          <p className="text-[11px] text-amber-700 mt-0.5 truncate" title={item.postponed.reason || undefined}>
            ↷ Postponed from {dayLong(item.postponed.from_date)}
            {(item.postponed.reason || item.postponed.category) && <> · {item.postponed.reason || REASON_LABEL[item.postponed.category] || item.postponed.category}</>}
          </p>
        )}
      </div>

      {/* Actions — a completed row can still be opened, and put back with one click */}
      {item.done && (
        <div className="agenda-actions flex items-center gap-1 flex-shrink-0">
          {(isTask || isHabit) && onOpenNotes && (
            <button onClick={() => onOpenNotes(item)} className="agenda-btn" title="Notes and evidence" aria-label={`Notes for ${item.title}`}><Icon name="note" size={13} /></button>
          )}
          {isTicket && (
            <button onClick={() => onOpenTicket(item)} className="agenda-btn">Open</button>
          )}
          {onUndo && (
            <button onClick={() => onUndo(item)} className="agenda-btn" title={isHabit ? 'Uncheck for today' : 'Not done after all — put it back'} aria-label={`Undo completing ${item.title}`}>
              <Icon name="undo" size={13} />Undo
            </button>
          )}
          {(isTask || isTicket) && onFixTime && (recorded > 0 || running) && (
            <button onClick={() => onFixTime(item)} className="agenda-btn" title="Fix time — undo the last session or take minutes off" aria-label={`Fix time for ${item.title}`}><Icon name="clock" size={13} /></button>
          )}
          {(isTask || isTicket) && onDelete && (
            <button onClick={() => onDelete(item)} className="agenda-btn hover:text-red-500" title={isTask ? 'Move to trash' : 'Delete ticket'} aria-label={`Delete ${item.title}`}><Icon name="trash" size={13} /></button>
          )}
        </div>
      )}
      {!item.done && (
        <div className="agenda-actions flex items-center gap-1 flex-shrink-0">
          {isTask && running && (
            <button onClick={onPauseTask} className="agenda-btn"><Icon name="pause" size={13} />Pause</button>
          )}
          {isTask && taskActive && !running && (
            <button onClick={onResumeTask} className="agenda-btn text-accent"><Icon name="play" size={13} />Resume</button>
          )}
          {isTask && !taskActive && (
            <button onClick={() => onStartTask(item)} className="agenda-btn text-accent"><Icon name="play" size={13} />Start</button>
          )}
          {(isTask || isHabit) && onOpenNotes && (
            <button onClick={() => onOpenNotes(item)} className="agenda-btn agenda-btn-notes" title="Notes" aria-label={`Notes for ${item.title}`}><Icon name="note" size={13} /></button>
          )}
          {(isTask || isTicket) && onPostpone && (
            <button onClick={() => onPostpone(item)} className="agenda-btn" title="Postpone to another day" aria-label={`Postpone ${item.title}`}>
              <Icon name="arrow" size={13} /><span className="hidden sm:inline">Later</span>
            </button>
          )}
          {isTask && (
            <button onClick={() => onCompleteTask(item)} className="agenda-btn"><Icon name="check" size={13} />Done</button>
          )}
          {isTicket && (
            <button onClick={() => onOpenTicket(item)} className="agenda-btn">Open</button>
          )}
          {(isTask || isTicket) && onFixTime && (recorded > 0 || running) && (
            <button onClick={() => onFixTime(item)} className="agenda-btn" title="Fix time — undo the last session or take minutes off" aria-label={`Fix time for ${item.title}`}><Icon name="clock" size={13} /></button>
          )}
          {(isTask || isTicket) && onDelete && (
            <button onClick={() => onDelete(item)} className="agenda-btn hover:text-red-500" title={isTask ? 'Move to trash' : 'Delete ticket'} aria-label={`Delete ${item.title}`}><Icon name="trash" size={13} /></button>
          )}
        </div>
      )}
    </div>
  )
}

// The same structure as the calendar view: the day's rhythm blocks with the work
// filed into them, then whatever sits outside a block (timed, then anytime), then
// Completed. `blocks` comes from the day workspace; without a rhythm the list is
// simply time order.
export default function DayAgenda({
  scheduled, anytime, completed, timer, hideEmpty = false, blocks = [], onEditBlock, onSkipBlock, skippedBlocks = [], onRestoreBlock,
  onStartTask, onPauseTask, onResumeTask, onCompleteTask, onOpenTicket, onOpenNotes, onCheckHabit, onEditTime, onPostpone, onUndo, onDelete, onFixTime,
  onMoveIntoBlock, onAddBlockHere,
}) {
  const [showDone, setShowDone] = useState(false)
  const rowProps = { timer, onStartTask, onPauseTask, onResumeTask, onCompleteTask, onOpenTicket, onOpenNotes, onCheckHabit, onEditTime, onPostpone, onUndo, onDelete, onFixTime, onMoveIntoBlock, onAddBlockHere }
  const empty = scheduled.length === 0 && anytime.length === 0 && completed.length === 0
  if (empty && hideEmpty) return null

  // As the day goes: blocks and timed items by start time; items inside a block's
  // window sit under it. Anything without a time waits at the end until it gets one.
  const entries = chronoEntries(blocks, scheduled)
  const blockById = Object.fromEntries(blocks.map(b => [b.id, b]))

  return (
    <div className="bg-surface border border-border rounded-2xl shadow-card">
      {empty && (
        <div className="p-8 text-center">
          <p className="text-sm text-muted">Nothing planned yet.</p>
          <p className="text-xs text-faint mt-1">Use “Plan my day” to choose what to work on.</p>
        </div>
      )}

      {entries.length > 0 && (
        <div className="px-4 py-1" data-testid="agenda-timeline">
          {entries.map(e => {
            if (e.type === 'block') {
              const b = e.block
              const isWork = b.kind === 'project' || b.kind === 'client'
              const done = (b.recorded_seconds || 0) + (b.live_seconds || 0)
              return (
                <div key={e.key} className="agenda-block-head" data-testid="agenda-block" data-title={b.title}>
                  <span className={`cal-swatch cal-block-${b.kind}`} style={b.color ? { '--block-color': b.color } : undefined} />
                  <span className="text-[11px] font-mono uppercase tracking-wide text-ink">{b.title}</span>
                  {onEditBlock
                    ? <button onClick={() => onEditBlock(b)} className="text-[11px] font-mono text-muted hover:text-accent" title="Change this block" aria-label={`Edit block ${b.title}`}>{fmtClock(b.start_time)} – {fmtClock(b.end_time)}{b.added ? ' · added' : !b.virtual ? ' · today' : ''}</button>
                    : <span className="text-[11px] font-mono text-muted">{fmtClock(b.start_time)} – {fmtClock(b.end_time)}</span>}
                  {isWork && <span className="text-[11px] font-mono text-muted ml-auto">{done > 0 ? `${fmtDuration(done)} / ` : ''}{fmtMinutes(b.duration_minutes)}</span>}
                  {onSkipBlock && (
                    <button onClick={() => onSkipBlock(b)} className={`agenda-skip ${isWork ? '' : 'ml-auto'}`}
                      aria-label={`${b.rhythm_id && !b.added ? 'Skip' : 'Remove'} block ${b.title} today`}
                      title={b.rhythm_id && !b.added ? 'Not today. Your rhythm stays the same.' : 'Remove from today'}>
                      {b.rhythm_id && !b.added ? 'Skip today' : 'Remove'}
                    </button>
                  )}
                </div>
              )
            }
            const holder = e.inBlock ? blockById[e.inBlock] : null
            return (
              <div key={e.key} data-testid="agenda-entry" data-title={e.item.title}
                className={holder ? `agenda-in-block cal-block-${holder.kind}` : 'agenda-loose'}
                style={holder?.color ? { '--block-color': holder.color } : undefined}>
                <Row item={e.item} {...rowProps} />
              </div>
            )
          })}
        </div>
      )}

      {skippedBlocks.length > 0 && onRestoreBlock && (
        <p className="text-[11px] text-muted px-4 py-2 border-t border-border flex items-center gap-2 flex-wrap">
          <span>Skipped today:</span>
          {skippedBlocks.map(b => <button key={b.rhythm_id} onClick={() => onRestoreBlock(b)} className="underline hover:text-ink">{b.title} · restore</button>)}
        </p>
      )}

      {anytime.length > 0 && (
        <div className="border-t border-border px-4 pt-2 pb-1" data-testid="agenda-untimed">
          <p className="text-[11px] font-mono uppercase tracking-wide text-muted mb-1 pt-1">No time yet · set one to place it in your day</p>
          <div className="divide-y divide-border">
            {anytime.map(i => <Row key={i.key} item={i} {...rowProps} />)}
          </div>
        </div>
      )}

      {completed.length > 0 && (
        <div className="border-t border-border px-4 py-2">
          <button onClick={() => setShowDone(v => !v)} className="w-full flex items-center justify-between text-[11px] font-mono uppercase tracking-wide text-muted py-1">
            <span>Completed · {completed.length}</span>
            <span>{showDone ? '▴' : '▾'}</span>
          </button>
          {showDone && (
            <div className="divide-y divide-border">
              {completed.map(i => <Row key={i.key} item={i} {...rowProps} />)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
