import Icon from '../../components/Icon'
import { fmtClock, fmtDuration, fmtMinutes } from './format'

const SOURCE_META = {
  task: { label: 'Task', dot: 'rgb(var(--accent))' },
  ticket: { label: 'Ticket', dot: 'rgb(var(--chart-2, 96 165 250))' },
  worklog: { label: 'Log', dot: 'rgb(var(--chart-3, 167 139 250))' },
}

function AgendaRow({ item, onStart, onOpenTicket, live }) {
  const meta = SOURCE_META[item.source] || SOURCE_META.task
  const recorded = item.recorded_seconds + (live ? item.live_seconds : 0)
  const isDone = item.status === 'done'
  const openable = item.source === 'ticket' && onOpenTicket
  return (
    <div className="flex items-start gap-3 py-2.5">
      <div className="w-14 flex-shrink-0 text-right">
        {item.scheduled_time
          ? <span className="text-xs font-mono text-ink tabular-nums">{fmtClock(item.scheduled_time)}</span>
          : <span className="text-[10px] text-faint uppercase">Anytime</span>}
      </div>
      <span className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ background: meta.dot }} />
      <div className="flex-1 min-w-0">
        {openable
          ? <button onClick={() => onOpenTicket(item)}
              className={`text-sm truncate text-left hover:text-accent transition-colors ${isDone ? 'text-muted line-through' : 'text-ink'}`}>{item.title}</button>
          : <p className={`text-sm truncate ${isDone ? 'text-muted line-through' : 'text-ink'}`}>{item.title}</p>}
        <p className="text-[11px] text-muted mt-0.5 flex items-center gap-1.5 flex-wrap">
          <span>{item.project_title}</span>
          {item.company_name && item.company_name !== 'Personal' && (
            <><span className="text-faint">·</span><span>{item.company_name}</span></>
          )}
          {item.planned_minutes > 0 && (
            <><span className="text-faint">·</span><span>{fmtMinutes(item.planned_minutes)} planned</span></>
          )}
          {recorded > 0 && (
            <><span className="text-faint">·</span>
              <span className="text-accent">{fmtDuration(recorded)} recorded{live && item.live_seconds > 0 ? ' (live)' : ''}</span>
            </>
          )}
        </p>
      </div>
      {onStart && item.source === 'task' && !isDone && (
        <button onClick={() => onStart(item)}
          className="text-xs text-accent flex items-center gap-1 py-1 px-2 rounded-lg hover:bg-raised transition-colors flex-shrink-0">
          <Icon name="play" size={13} />Start
        </button>
      )}
      {openable && (
        <button onClick={() => onOpenTicket(item)}
          className="text-xs text-muted flex items-center gap-1 py-1 px-2 rounded-lg hover:bg-raised hover:text-accent transition-colors flex-shrink-0">
          Open
        </button>
      )}
    </div>
  )
}

// The day's scheduled items (from existing plan_date/scheduled_time fields), plus
// today's items that have no time yet. Single-block scheduling only — durable
// multi-block planning arrives in a later step.
export default function DayAgenda({ workspace, onStart, onOpenTicket }) {
  if (!workspace) return null
  const { agenda = [], unscheduled = [] } = workspace

  return (
    <div className="bg-surface border border-border rounded-2xl shadow-card p-5">
      <div className="flex items-center justify-between mb-2">
        <p className="eyebrow">Your day</p>
        {workspace.totals.planned_minutes > 0 && (
          <span className="text-[11px] text-muted">{fmtMinutes(workspace.totals.planned_minutes)} planned</span>
        )}
      </div>

      {agenda.length === 0 && unscheduled.length === 0 && (
        <p className="text-sm text-muted italic py-3">
          Nothing scheduled for today yet. Plan items with a time to see them here.
        </p>
      )}

      {agenda.length > 0 && (
        <div className="divide-y divide-border">
          {agenda.map(item => (
            <AgendaRow key={item.key} item={item} onStart={onStart} onOpenTicket={onOpenTicket} live />
          ))}
        </div>
      )}

      {unscheduled.length > 0 && (
        <div className="mt-3 pt-3 border-t border-border">
          <p className="text-[11px] font-mono uppercase tracking-wide text-muted mb-1">Unscheduled today</p>
          <div className="divide-y divide-border">
            {unscheduled.map(item => (
              <AgendaRow key={item.key} item={item} onStart={onStart} onOpenTicket={onOpenTicket} live />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
