import { useEffect, useState } from 'react'
import ConfirmDialog from './ConfirmDialog'

// Promise-based replacement for window.confirm(). The Basira desktop app is a
// WKWebView without a UI delegate, where window.confirm() silently returns false,
// so a native confirm made every delete a no-op there. This renders the app's own
// dialog instead and works the same in the desktop app and any browser.
//   if (!(await askConfirm('Delete this log?'))) return
let seq = 0
export function askConfirm(message, { title = 'Are you sure?', confirmLabel = 'Delete', danger = true } = {}) {
  return new Promise(resolve => {
    window.dispatchEvent(new CustomEvent('basira:confirm', { detail: { id: ++seq, message, title, confirmLabel, danger, resolve } }))
  })
}

export function ConfirmHost() {
  const [req, setReq] = useState(null)
  useEffect(() => {
    const on = e => setReq(prev => { prev?.resolve(false); return e.detail })
    window.addEventListener('basira:confirm', on)
    return () => window.removeEventListener('basira:confirm', on)
  }, [])
  if (!req) return null
  const done = ok => { req.resolve(ok); setReq(null) }
  return <ConfirmDialog key={req.id} title={req.title} message={req.message} confirmLabel={req.confirmLabel}
    danger={req.danger} onConfirm={() => done(true)} onClose={() => done(false)} />
}
