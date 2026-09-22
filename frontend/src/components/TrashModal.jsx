import { useEffect, useState } from 'react'
import Modal from './Modal'
import ConfirmDialog from './ConfirmDialog'
import { notify } from './Notice'
import { getTrash, restoreTrashItem, deleteTrashItem } from '../api'

// The trash: goals and tasks soft-deleted within the last 30 days. Restore brings
// an item back; Delete forever removes it permanently (with a confirm).
export default function TrashModal({ onClose, onChange }) {
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(null)
  const [purgeItem, setPurgeItem] = useState(null)  // { kind, id, title }

  function load() { getTrash().then(setData).catch(err => notify(err.message)) }
  useEffect(() => { load() }, [])

  async function restore(kind, id) {
    setBusy(`${kind}:${id}`)
    try { await restoreTrashItem(kind, id); load(); onChange?.() }
    catch (err) { notify(err.message) }
    finally { setBusy(null) }
  }

  const goals = data?.goals || []
  const tasks = data?.tasks || []
  const empty = goals.length === 0 && tasks.length === 0

  function Row({ item, kind, subtitle }) {
    const id = item.id
    return (
      <div className="flex items-center gap-3 py-2.5">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-ink break-words">{item.title || 'Untitled'}</p>
          <p className="text-[11px] text-muted">{subtitle} · auto-removes in {item.days_left} day{item.days_left === 1 ? '' : 's'}</p>
        </div>
        <button onClick={() => restore(kind, id)} disabled={busy === `${kind}:${id}`}
          className="text-xs text-accent px-2 py-1 rounded-lg hover:bg-raised transition-colors flex-shrink-0 disabled:opacity-50">Restore</button>
        <button onClick={() => setPurgeItem({ kind, id, title: item.title })}
          className="text-xs text-red-500 px-2 py-1 rounded-lg hover:bg-red-50 transition-colors flex-shrink-0">Delete forever</button>
      </div>
    )
  }

  return (
    <Modal title="Trash" onClose={onClose} wide>
      <div className="space-y-2">
        <p className="text-xs text-muted">Deleted goals and tasks are kept for {data?.retention_days ?? 30} days, then removed automatically. Restore anything before then.</p>
        {!data && <p className="text-sm text-muted py-4">Loading…</p>}
        {data && empty && <p className="text-sm text-muted italic py-6 text-center">Trash is empty.</p>}

        {goals.length > 0 && (
          <div>
            <p className="eyebrow mt-3 mb-1">Goals</p>
            <div className="divide-y divide-border">
              {goals.map(g => <Row key={g.id} item={g} kind="goal" subtitle={`${g.kind}${g.task_count ? ` · ${g.task_count} task${g.task_count === 1 ? '' : 's'}` : ''}`} />)}
            </div>
          </div>
        )}
        {tasks.length > 0 && (
          <div>
            <p className="eyebrow mt-3 mb-1">Tasks & habits</p>
            <div className="divide-y divide-border">
              {tasks.map(t => <Row key={t.id} item={t} kind="task" subtitle={t.goal_title || 'Task'} />)}
            </div>
          </div>
        )}
      </div>

      {purgeItem && (
        <ConfirmDialog
          title="Delete forever?"
          message={`“${purgeItem.title || 'This item'}” will be permanently removed. This can't be undone.`}
          confirmLabel="Delete forever" danger
          onConfirm={async () => {
            try { await deleteTrashItem(purgeItem.kind, purgeItem.id); setPurgeItem(null); load(); onChange?.() }
            catch (err) { notify(err.message); setPurgeItem(null) }
          }}
          onClose={() => setPurgeItem(null)} />
      )}
    </Modal>
  )
}
