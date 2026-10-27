import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { createShapeId, useValue } from 'tldraw'
import { completeTask, deleteBoard, getBoard, getCompanies, getMilestones, getTask, getWorkTicket, updateBoard, updateTask, updateWorkTicket } from '../../api'
import { notify } from '../../components/Notice'
import { countdown, todayIso } from '../work/due'
import BoardCanvas, { fitBoard, placeCard, placeCards, tidyCards } from './BoardCanvas'
import BoardPalette from './BoardPalette'
import CardInspector from './CardInspector'
import PromoteDialog from './PromoteDialog'
import { PLURAL, useEntityStore } from './entityStore'
import { applyTemplate, clearLanes, createLanes, templateKey } from './lanes'
import { CARD_SIZE, CARD_TYPE, cardBridge } from './SysgoCardShape'

// Loaded on demand so opening a board does not pull in the whole Work page until a ticket is opened.
const TicketDrawer = lazy(() => import('../../WorkPage').then(m => ({ default: m.TicketDrawer })))
const TicketModal = lazy(() => import('../../WorkPage').then(m => ({ default: m.TicketModal })))

const SCOPE_LABEL = { global: 'Global', work: 'Work', goal: 'Goal', company: 'Client' }
const SAVE_LABEL = { saved: 'Saved', dirty: 'Unsaved', saving: 'Saving…', error: 'Save failed' }
const UPDATED_EVENT = { ticket: 'basira:ticket-updated', task: 'basira:task-updated', goal: 'basira:task-updated', milestone: 'basira:milestone-updated' }

function useResolvedTheme() {
  const read = () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')
  const [theme, setTheme] = useState(read)
  useEffect(() => {
    const obs = new MutationObserver(() => setTheme(read()))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])
  return theme
}

// Live totals for what is on the board: tickets, overdue work, the next milestone.
function BoardSummary({ editor, store }) {
  const keys = useValue('summary-cards', () => editor
    ? editor.getCurrentPageShapes().filter(s => s.type === CARD_TYPE).map(s => `${s.props.entity}|${s.props.entityId}`)
    : [], [editor])
  if (keys.length === 0) return null
  const today = todayIso()
  let tickets = 0, ticketsDone = 0, active = 0, overdue = 0, tasks = 0, tasksDone = 0, next = null
  for (const key of keys) {
    const [entity, id] = key.split('|')
    const d = store.data[PLURAL[entity]]?.[id]
    if (!d || d.missing) continue
    if (entity === 'ticket') {
      tickets++
      if (d.status === 'done') ticketsDone++
      else { if (d.status === 'in_progress') active++; if (d.due_date && d.due_date < today) overdue++ }
    } else if (entity === 'task') {
      tasks++
      if (d.status === 'done') tasksDone++
      else if (d.due_date && d.due_date < today) overdue++
    } else if (entity === 'milestone' && d.status !== 'done' && d.due_date && (!next || d.due_date < next.due_date)) next = d
  }
  return (
    <div className="board-summary" aria-label="Board summary">
      {next && <span className="chip" data-tone="gold">◆ Next: {next.title} · {countdown(next.due_date).toLowerCase()}</span>}
      {tickets > 0 && <span className="chip">{tickets} tickets · {ticketsDone} done{active ? ` · ${active} in progress` : ''}</span>}
      {tasks > 0 && <span className="chip">{tasks} tasks · {tasksDone} done</span>}
      {overdue > 0 && <span className="chip" data-tone="danger">{overdue} overdue</span>}
    </div>
  )
}

// Arrange cards into lanes that write back when a card is dropped in.
function LanesMenu({ editor, store, milestones }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const close = e => { if (!ref.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])
  function run(kind) {
    setOpen(false)
    const r = createLanes(editor, kind, { milestones, store })
    if (!r) { notify('Nothing to arrange.', { title: 'Lanes' }); return }
    notify(r.reused
      ? `${r.cards} ${r.cards === 1 ? 'card' : 'cards'} filed into the existing lanes. ⌘Z undoes.`
      : `${r.cards} ${r.cards === 1 ? 'card' : 'cards'} filed into ${r.lanes} lanes. Drop a card into a lane to update it. ⌘Z undoes.`, { title: 'Lanes' })
  }
  function clear() {
    setOpen(false)
    const n = clearLanes(editor)
    notify(n ? `${n} lanes removed. The cards stay where they were.` : 'No lanes on this board.', { title: 'Lanes' })
  }
  const selected = open && editor ? editor.getSelectedShapes().filter(s => s.type === CARD_TYPE && s.props.entity !== 'milestone' && s.props.entity !== 'goal').length : 0
  const openMilestones = milestones.filter(m => m.status !== 'done').length
  return (
    <div className="lanes-menu" ref={ref}>
      <button type="button" className="secondary-button" aria-haspopup="menu" aria-expanded={open} disabled={!editor} onClick={() => setOpen(o => !o)}
        title="Arrange cards into lanes. Dropping a card into a lane updates the ticket.">Lanes ▾</button>
      {open && (
        <div className="lanes-pop" role="menu">
          <p className="lanes-hint">{selected ? `Arrange the ${selected} selected ${selected === 1 ? 'card' : 'cards'}` : 'Arrange every card on the board'}. Dropping a card into a lane updates the real item.</p>
          <button type="button" role="menuitem" onClick={() => run('status')}>By status<span>Backlog → Done</span></button>
          <button type="button" role="menuitem" onClick={() => run('milestone')} disabled={!openMilestones}>By milestone<span>{openMilestones ? 'One lane per open milestone' : 'No open milestones yet'}</span></button>
          <button type="button" role="menuitem" onClick={() => run('due')}>By due date<span>Today · this week · next week · later</span></button>
          <button type="button" role="menuitem" onClick={() => run('week')}>By day this week<span>Mon → Sun, sets the due date</span></button>
          <div className="lanes-sep" />
          <button type="button" role="menuitem" onClick={clear}>Clear lanes<span>Frames go, cards stay</span></button>
        </div>
      )}
    </div>
  )
}

/**
 * One board: title and save state, the tldraw canvas, the item palette and the inspector for the
 * selected card, plus the hooks that make cards live: double-click opens the ticket drawer or
 * jumps to the goal, notes become tickets/tasks/milestones, and cards dropped into lanes update
 * the item behind them. `embedded` is the compact form used inside the Goal page and the Work tab.
 */
export default function BoardView({ boardId, embedded = false, onBack }) {
  const [board, setBoard] = useState(null)
  const [error, setError] = useState(null)
  const [title, setTitle] = useState('')
  const [saveState, setSaveState] = useState('saved')
  const [editor, setEditor] = useState(null)
  const [paletteOpen, setPaletteOpen] = useState(() => window.innerWidth > 1100)
  const [openTicket, setOpenTicket] = useState(null)
  const [editTicket, setEditTicket] = useState(null)
  const [promote, setPromote] = useState(null)   // { entity, shapeId, text }
  const [milestones, setMilestones] = useState([])
  const [companies, setCompanies] = useState([])
  const theme = useResolvedTheme()
  const store = useEntityStore()
  const storeRef = useRef(store)
  storeRef.current = store

  useEffect(() => {
    setBoard(null); setError(null); setEditor(null)
    getBoard(boardId).then(b => { setBoard(b); setTitle(b.title) }).catch(e => setError(e.message))
  }, [boardId])

  // Milestones and clients for the inspector, lane layouts and the edit form.
  const loadMilestones = useCallback(() => {
    if (!board) return
    const params = board.scope_type === 'company' ? { company_id: board.scope_id } : board.scope_type === 'goal' ? { linked_goal_id: board.scope_id } : {}
    getMilestones(params).then(setMilestones).catch(() => {})
  }, [board])
  useEffect(() => { loadMilestones() }, [loadMilestones])
  useEffect(() => {
    window.addEventListener('basira:milestone-updated', loadMilestones)
    return () => window.removeEventListener('basira:milestone-updated', loadMilestones)
  }, [loadMilestones])
  useEffect(() => { getCompanies().then(setCompanies).catch(() => {}) }, [])

  const openEntity = useCallback(async (entity, id) => {
    try {
      if (entity === 'ticket') setOpenTicket(await getWorkTicket(id))
      else if (entity === 'goal') window.location.hash = `#/goals/${encodeURIComponent(id)}`
      else if (entity === 'task') { const t = await getTask(id); window.location.hash = `#/goals/${encodeURIComponent(t.goal_id)}` }
      else if (editor) { /* milestone: select its card so the inspector shows it */
        const card = editor.getCurrentPageShapes().find(s => s.type === CARD_TYPE && s.props.entityId === id)
        if (card) editor.select(card.id)
      }
    } catch (e) { notify(e.message) }
  }, [editor])

  // A card dropped into a lane frame: make the item match the lane (only when it differs).
  const onLaneDrop = useCallback(async (entity, id, lane) => {
    const d = storeRef.current.data[PLURAL[entity]]?.[id] || {}
    try {
      let changed = false
      if (lane.kind === 'status') {
        if (entity === 'ticket' && d.status !== lane.value) { await updateWorkTicket(id, { status: lane.value }); changed = true }
        else if (entity === 'task' && lane.value === 'done' && d.status !== 'done' && !d.is_habit) { await completeTask(id); changed = true }
      } else if (lane.kind === 'milestone' && entity === 'ticket') {
        if ((d.milestone_id || '') !== lane.value) { await updateWorkTicket(id, { milestone_id: lane.value }); changed = true }
      } else if (lane.kind === 'due') {
        if ((d.due_date || '') !== lane.value) {
          if (entity === 'ticket') { await updateWorkTicket(id, { due_date: lane.value }); changed = true }
          else if (entity === 'task' && lane.value) { await updateTask(id, { due_date: lane.value }); changed = true }
        }
      }
      if (changed) {
        storeRef.current.refresh()
        window.dispatchEvent(new CustomEvent(UPDATED_EVENT[entity] || 'basira:ticket-updated'))
        notify(`${d.title ? `“${d.title.slice(0, 48)}${d.title.length > 48 ? '…' : ''}”` : 'Card'} → ${lane.label}`, { title: 'Updated' })
      }
    } catch (e) { notify(e.message) }
  }, [])

  useEffect(() => {
    cardBridge.onOpen = openEntity
    cardBridge.onPromote = (entity, shapeId, text) => setPromote({ entity, shapeId, text })
    cardBridge.onLaneDrop = onLaneDrop
    return () => { cardBridge.onOpen = null; cardBridge.onPromote = null; cardBridge.onLaneDrop = null }
  }, [openEntity, onLaneDrop])

  // A board created from a template gets its lanes the first time its editor is ready.
  useEffect(() => {
    if (!editor || !board) return
    let template = null
    try { template = sessionStorage.getItem(templateKey(board.id)); if (template) sessionStorage.removeItem(templateKey(board.id)) } catch { /* no template then */ }
    if (template) applyTemplate(editor, template, { store: storeRef.current })
  }, [editor, board])

  async function commitTitle() {
    const next = title.trim()
    if (!next) { setTitle(board.title); return }
    if (next === board.title) return
    try { await updateBoard(board.id, { title: next }); setBoard(b => ({ ...b, title: next })) }
    catch (e) { notify(e.message); setTitle(board.title) }
  }

  async function remove() {
    if (!confirm('Delete this board? The drawing is lost; tickets, tasks, goals and milestones on it are untouched.')) return
    try { await deleteBoard(board.id); onBack?.() } catch (e) { notify(e.message) }
  }

  function fit() { if (editor) fitBoard(editor, true) }
  function tidy() {
    if (!editor) return
    const n = tidyCards(editor, store)
    if (!n) notify('Add at least two cards to tidy up.', { title: 'Tidy' })
  }

  async function exportPng() {
    if (!editor) return
    const ids = [...editor.getCurrentPageShapeIds()]
    if (ids.length === 0) { notify('Nothing on the board to export yet.'); return }
    try {
      const { blob } = await editor.toImage(ids, { format: 'png', background: true, scale: 2, padding: 32 })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${(board.title || 'board').replace(/[^\w\- ]+/g, '').trim() || 'board'}.png`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) { notify(e.message) }
  }

  function addFromPalette(entity, item) { if (editor) placeCard(editor, entity, item.id) }
  function addManyFromPalette(entity, items) {
    if (!editor) return
    const n = placeCards(editor, entity, items.map(i => i.id))
    notify(n ? `${n} ${n === 1 ? 'card' : 'cards'} added.` : 'All of those are already on the board.', { title: 'Board' })
  }

  // The note is swapped for a live card at the same spot, as one undoable step.
  function handlePromoted(created) {
    const { entity, shapeId } = promote
    setPromote(null)
    if (!editor) return
    const bounds = editor.getShape(shapeId) ? editor.getShapePageBounds(shapeId) : null
    const size = CARD_SIZE[entity] || CARD_SIZE.ticket
    const id = createShapeId()
    editor.run(() => {
      editor.markHistoryStoppingPoint('promote note')
      editor.createShape({ id, type: CARD_TYPE, x: bounds?.x ?? 0, y: bounds?.y ?? 0, props: { ...size, entity, entityId: created.id } })
      if (bounds) editor.deleteShapes([shapeId])
      editor.select(id)
    })
    notify(`${entity[0].toUpperCase()}${entity.slice(1)} created from your note.`, { title: 'Created' })
    window.dispatchEvent(new CustomEvent(UPDATED_EVENT[entity] || 'basira:ticket-updated'))
  }

  async function openEditTicket(ticketId) {
    try { setEditTicket(await getWorkTicket(ticketId)) } catch (e) { notify(e.message) }
  }
  async function saveEditedTicket(data) {
    try {
      const updated = await updateWorkTicket(editTicket.id, data)
      setEditTicket(null)
      setOpenTicket(o => (o && o.id === updated.id ? updated : o))
      store.refresh()
      window.dispatchEvent(new CustomEvent('basira:ticket-updated'))
    } catch (e) { notify(e.message) }
  }

  if (error) {
    return (
      <div className="py-12 text-center text-muted">
        <p className="font-medium text-ink">Couldn’t open this board</p>
        <p className="text-sm mt-1">{error}</p>
        {onBack && <button className="secondary-button mt-4" onClick={onBack}>← Back to boards</button>}
      </div>
    )
  }
  if (!board) return <div className="py-12 text-muted" role="status">Opening board…</div>

  const inspector = <CardInspector editor={editor} store={store} milestones={milestones} onOpen={openEntity} onEdit={openEditTicket} />
  return (
    <div className="board-view" style={{ '--board-h': embedded ? 'max(520px, calc(100vh - 360px))' : 'calc(100vh - 235px)' }}>
      <div className="board-toolbar">
        {!embedded && onBack && <button className="ghost-link" onClick={onBack}>← Boards</button>}
        <span className="scope-chip" data-scope={board.scope_type}>{SCOPE_LABEL[board.scope_type] || board.scope_type}{board.scope_title ? ` · ${board.scope_title}` : ''}</span>
        <input className="board-title-input" value={title} onChange={e => setTitle(e.target.value)} onBlur={commitTitle}
          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setTitle(board.title); e.currentTarget.blur() } }}
          aria-label="Board title" />
        <span className="board-save-state" data-state={saveState} title={saveState === 'error' ? 'Saving failed. Your next change retries.' : undefined}>{SAVE_LABEL[saveState]}</span>
        <span className="flex-1" />
        <button type="button" className="secondary-button" aria-pressed={paletteOpen} onClick={() => setPaletteOpen(v => !v)}>{paletteOpen ? 'Hide items' : '+ Add items'}</button>
        <LanesMenu editor={editor} store={store} milestones={milestones} />
        <button type="button" className="secondary-button" onClick={tidy} disabled={!editor} title="Arrange cards into a neat grid (the selected cards, or all of them)">Tidy</button>
        <button type="button" className="secondary-button" onClick={fit} disabled={!editor} title="Show the whole board">Fit</button>
        <button type="button" className="secondary-button" onClick={exportPng} disabled={!editor}>Export PNG</button>
        {embedded
          ? <a className="secondary-button" href={`#/boards/${encodeURIComponent(board.id)}`}>Open full board →</a>
          : <button type="button" className="secondary-button hover:!text-red-500" onClick={remove}>Delete</button>}
      </div>
      <BoardSummary editor={editor} store={store} />
      <div className="board-stage">
        <BoardCanvas key={board.id} board={board} store={store} theme={theme} onSaveState={setSaveState} editorRef={setEditor} />
        <BoardSide inspector={inspector} editor={editor}>
          {paletteOpen && <BoardPalette board={board} editor={editor} onAdd={addFromPalette} onAddMany={addManyFromPalette} onClose={() => setPaletteOpen(false)} />}
        </BoardSide>
      </div>
      {openTicket && (
        <Suspense fallback={null}>
          <TicketDrawer ticket={openTicket} onClose={() => setOpenTicket(null)}
            onUpdate={t => { setOpenTicket(t); store.refresh() }}
            onDelete={() => { setOpenTicket(null); store.refresh() }}
            onEdit={t => openEditTicket(t.id)} />
        </Suspense>
      )}
      {editTicket && (
        <Suspense fallback={null}>
          <TicketModal companies={companies} milestones={milestones} initial={editTicket} onSave={saveEditedTicket} onClose={() => setEditTicket(null)} />
        </Suspense>
      )}
      {promote && <PromoteDialog entity={promote.entity} text={promote.text} board={board} onCreated={handlePromoted} onClose={() => setPromote(null)} />}
    </div>
  )
}

// The right column: the inspector when one card is selected, the palette when it is open; nothing otherwise.
function BoardSide({ inspector, editor, children }) {
  const hasSelection = useValue('side-has-card', () => {
    if (!editor) return false
    const sel = editor.getSelectedShapes()
    return sel.length === 1 && sel[0].type === CARD_TYPE
  }, [editor])
  if (!hasSelection && !children) return null
  return <div className="board-side">{hasSelection && inspector}{children}</div>
}
