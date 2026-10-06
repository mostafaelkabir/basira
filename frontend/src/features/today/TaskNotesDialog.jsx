import { useEffect, useState } from 'react'
import Modal from '../../components/Modal'
import { notify } from '../../components/Notice'
import { ActivityComments } from '../../components/ActivityComposer'
import { getTask } from '../../api'

// Notes for whatever Task or daily/habit task the user is on, without leaving
// Today (BAS-045). Reuses the task comments thread (text, image, file, Ask AI);
// tickets keep their own drawer. `item` needs { item_id, title, project_title? }.
export default function TaskNotesDialog({ item, onClose }) {
  const [task, setTask] = useState(null)
  const [failed, setFailed] = useState(false)

  async function load() {
    try { setTask(await getTask(item.item_id)); setFailed(false) }
    catch (err) { setFailed(true); notify(err.message) }
  }
  useEffect(() => { load() }, [item.item_id])

  return (
    <Modal title={`Notes — ${task?.title || item.title}`} onClose={onClose}>
      {item.project_title && <p className="text-[11px] text-muted -mt-1 mb-3">{item.project_title}</p>}
      {failed ? (
        <div className="text-center py-4">
          <p className="text-sm text-muted">Couldn't load notes.</p>
          <button onClick={load} className="secondary-button mt-3">Try again</button>
        </div>
      ) : task ? (
        <>
          {!task.comments?.length && <p className="text-sm text-muted italic mb-3">No notes yet — add the first one below.</p>}
          <ActivityComments task={task} onRefresh={load} autoFocus />
        </>
      ) : (
        <p className="text-sm text-muted text-center py-4" role="status">Loading…</p>
      )}
    </Modal>
  )
}
