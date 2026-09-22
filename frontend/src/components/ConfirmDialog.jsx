import { useState } from 'react'
import Modal from './Modal'

// A styled "Are you sure?" dialog. onConfirm may be async; the confirm button
// shows a busy state and the dialog stays open until it resolves (or throws).
export default function ConfirmDialog({
  title = 'Are you sure?', message, confirmLabel = 'Confirm', cancelLabel = 'Cancel',
  danger = false, onConfirm, onClose,
}) {
  const [busy, setBusy] = useState(false)
  async function confirm() {
    setBusy(true)
    try { await onConfirm() } finally { setBusy(false) }
  }
  return (
    <Modal title={title} onClose={onClose}>
      <div className="space-y-4">
        {message && <p className="text-sm text-muted leading-relaxed">{message}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} disabled={busy}
            className="px-4 py-2 rounded-xl border border-border text-sm text-muted hover:text-ink hover:bg-raised transition-colors disabled:opacity-50">
            {cancelLabel}
          </button>
          <button onClick={confirm} disabled={busy}
            className={`px-4 py-2 rounded-xl text-sm font-semibold text-white transition-colors disabled:opacity-50 ${
              danger ? 'bg-red-500 hover:bg-red-600' : 'bg-forest hover:bg-forest-hover'}`}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  )
}
