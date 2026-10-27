import { useState } from 'react'
import { DndContext, DragOverlay, PointerSensor, pointerWithin, rectIntersection, useDraggable, useDroppable, useSensor, useSensors } from '@dnd-kit/core'

// Columns differ wildly in height, so distance-based collision picks the wrong one; go by where the
// pointer is, and only fall back to overlap when the pointer is outside every column.
const collision = args => { const hit = pointerWithin(args); return hit.length ? hit : rectIntersection(args) }

/**
 * Tickets as columns by status. Drag a card to another column to change its status; the host
 * renders each card (so the list and board views share one card component) and applies the move.
 */
export default function TicketKanban({ tickets, columns, statuses, onMove, renderCard, fmtMins, groupBy = t => t.status }) {
  const [activeId, setActiveId] = useState(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const byStatus = Object.fromEntries(columns.map(c => [c, []]))
  for (const t of tickets) { const k = groupBy(t); (byStatus[k] || (byStatus[k] = [])).push(t) }
  const active = activeId ? tickets.find(t => t.id === activeId) : null

  function handleDragEnd({ active: a, over }) {
    setActiveId(null)
    if (!over) return
    const to = over.id
    if (to !== a.data.current?.group) onMove(a.id, to)
  }

  return (
    <DndContext sensors={sensors} collisionDetection={collision}
      onDragStart={e => setActiveId(e.active.id)} onDragEnd={handleDragEnd} onDragCancel={() => setActiveId(null)}>
      <div className="kanban" aria-label="Tickets by status">
        {columns.map(status => (
          <Column key={status} status={status} meta={statuses[status]} tickets={byStatus[status] || []}
            renderCard={renderCard} fmtMins={fmtMins} activeId={activeId} />
        ))}
      </div>
      <DragOverlay dropAnimation={null}>
        {active ? <div className="kanban-overlay">{renderCard(active, { overlay: true })}</div> : null}
      </DragOverlay>
    </DndContext>
  )
}

function Column({ status, meta, tickets, renderCard, fmtMins, activeId }) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  const est = tickets.reduce((s, t) => s + (t.estimated_minutes || 0), 0)
  return (
    <section ref={setNodeRef} className="kanban-col" data-over={isOver} aria-label={meta?.label || status}>
      <header className="kanban-col-head">
        <div className="kanban-col-row">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${meta?.dot || 'bg-muted'}`} />
          <span className="kanban-col-title" title={meta?.label || status}>{meta?.label || status}</span>
          <span className="kanban-count">{tickets.length}</span>
        </div>
        {(meta?.hint || est > 0) && (
          <div className="kanban-col-sub">{[meta?.hint, est > 0 ? `${fmtMins(est)} est.` : null].filter(Boolean).join(' · ')}</div>
        )}
      </header>
      {tickets.length === 0
        ? <div className="kanban-empty">Drop here</div>
        : tickets.map(t => <Card key={t.id} ticket={t} group={status} dragging={activeId === t.id}>{renderCard(t)}</Card>)}
    </section>
  )
}

function Card({ ticket, group, dragging, children }) {
  const { setNodeRef, listeners } = useDraggable({ id: ticket.id, data: { group } })
  return <div ref={setNodeRef} className="kanban-card" data-dragging={dragging} {...listeners}>{children}</div>
}
