import { useEffect, useReducer, useState } from 'react'
import { useValue } from 'tldraw'
import { getBoardCandidates } from '../../api'
import Icon from '../../components/Icon'
import { ENTITY_MIME } from './BoardCanvas'
import { CARD_TYPE } from './SysgoCardShape'

const TABS = [['tickets', 'Tickets', 'ticket'], ['milestones', 'Milestones', 'milestone'], ['tasks', 'Tasks', 'task'], ['goals', 'Goals', 'goal']]
const isImageUrl = icon => icon && (icon.startsWith('/') || icon.startsWith('http'))

/** Side panel of things that can go on this board: drag a row onto the canvas, or press + to drop it at the centre. */
const ADD_ALL_LIMIT = 40

export default function BoardPalette({ board, editor, onAdd, onAddMany, onClose }) {
  const [q, setQ] = useState('')
  const [data, setData] = useState({ tickets: [], tasks: [], goals: [], milestones: [] })
  const [loading, setLoading] = useState(true)
  const [hideDone, setHideDone] = useState(true)
  const [tab, setTab] = useState(board.scope_type === 'goal' ? 'tasks' : 'tickets')
  const [refreshKey, bump] = useReducer(x => x + 1, 0)

  useEffect(() => {
    let alive = true
    const t = setTimeout(() => {
      getBoardCandidates(board.id, q)
        .then(d => { if (alive) { setData(d); setLoading(false) } })
        .catch(() => { if (alive) setLoading(false) })
    }, q ? 220 : 0)
    return () => { alive = false; clearTimeout(t) }
  }, [board.id, q, refreshKey])

  useEffect(() => {
    const events = ['basira:task-updated', 'basira:ticket-updated', 'basira:milestone-updated']
    events.forEach(e => window.addEventListener(e, bump))
    return () => events.forEach(e => window.removeEventListener(e, bump))
  }, [])

  // Which entities already have a card on the page (reactive to the tldraw store).
  const placed = useValue('placed-cards', () => {
    if (!editor) return new Set()
    return new Set(editor.getCurrentPageShapes().filter(s => s.type === CARD_TYPE).map(s => `${s.props.entity}:${s.props.entityId}`))
  }, [editor])

  const entity = TABS.find(t => t[0] === tab)[2]
  const items = (data[tab] || []).filter(it => !hideDone || !(it.status === 'done' || it.archived))
  const unplaced = items.filter(it => !placed.has(`${entity}:${it.id}`))

  return (
    <aside className="board-palette" aria-label="Add items to the board">
      <div className="board-palette-head">
        <div className="flex items-center gap-2">
          <span className="eyebrow">Add to board</span>
          <span className="flex-1" />
          <button type="button" className="icon-button !w-7 !h-7" onClick={onClose} aria-label="Hide the item palette"><Icon name="close" size={14} /></button>
        </div>
        <input className="field-input !py-2 !text-xs" placeholder="Search…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search items" />
        <div className="board-palette-tabs" role="tablist">
          {TABS.map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>
              {label}{(data[key] || []).length ? <span className="opacity-60"> {(data[key] || []).length}</span> : null}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-[11px] text-muted cursor-pointer">
          <input type="checkbox" checked={hideDone} onChange={e => setHideDone(e.target.checked)} /> Hide finished
        </label>
      </div>
      <div className="board-palette-list">
        {loading ? <p className="text-xs text-muted px-2 py-3" role="status">Loading…</p>
          : items.length === 0 ? <p className="text-xs text-faint px-2 py-3">Nothing to add here{q ? ` for “${q}”` : ''}.</p>
          : items.map(item => (
            <PaletteRow key={item.id} entity={entity} item={item} placed={placed.has(`${entity}:${item.id}`)} onAdd={() => onAdd(entity, item)} />
          ))}
      </div>
      <div className="board-palette-foot">
        {unplaced.length > 1 && onAddMany && (
          <button type="button" className="secondary-button w-full !py-2 !text-[11px]" onClick={() => onAddMany(entity, unplaced.slice(0, ADD_ALL_LIMIT))}
            title="Lay them out as a grid next to what is already on the board">
            + Add {unplaced.length > ADD_ALL_LIMIT ? `first ${ADD_ALL_LIMIT} of ${unplaced.length}` : `all ${unplaced.length}`} shown
          </button>
        )}
        <p className="text-[10.5px] text-faint leading-relaxed">
          Drag onto the canvas, or press + to add in the first free spot. Double-click a card to open it.
        </p>
      </div>
    </aside>
  )
}

function PaletteRow({ entity, item, placed, onAdd }) {
  const meta = entity === 'ticket' ? (item.ticket_ref || item.company_name) : entity === 'task' ? item.goal_title : entity === 'milestone' ? (item.due_date || 'no date') : item.type
  const done = item.status === 'done' || item.archived
  const dot = entity === 'ticket' ? item.company_color : entity === 'task' ? 'rgb(var(--accent))' : 'rgb(var(--gold))'
  const prefix = entity === 'goal' && item.icon && !isImageUrl(item.icon) ? `${item.icon} ` : ''
  return (
    <div className="board-palette-row" draggable data-placed={placed}
      onDragStart={e => { e.dataTransfer.setData(ENTITY_MIME, JSON.stringify({ entity, id: item.id })); e.dataTransfer.effectAllowed = 'copy' }}>
      <span style={{ width: 7, height: 7, borderRadius: 999, flexShrink: 0, background: dot }} />
      <span className={`row-title ${done ? 'line-through text-muted' : ''}`} title={item.title}>{entity === 'milestone' ? '◆ ' : ''}{prefix}{item.title}</span>
      {meta && <span className="row-meta">{meta}</span>}
      <button type="button" className="row-add" onClick={onAdd}
        aria-label={placed ? 'Show on board' : 'Add to board'} title={placed ? 'Already on the board. Click to find it.' : 'Add to board'}>
        {placed ? '◎' : '+'}
      </button>
    </div>
  )
}
