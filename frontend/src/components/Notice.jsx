import { useEffect, useState } from 'react'
import Icon from './Icon'

export function notify(message) {
  window.dispatchEvent(new CustomEvent('basira:notice', { detail: { message: String(message) } }))
}

// A toast with an action button (e.g. "Undo" after moving something to the trash).
export function notifyAction(message, label, onAction) {
  window.dispatchEvent(new CustomEvent('basira:notice', { detail: { message: String(message), label, onAction } }))
}

export default function Notice() {
  const [notice, setNotice] = useState(null)
  useEffect(() => {
    const handle = e => setNotice(typeof e.detail === 'string' ? { message: e.detail } : e.detail)
    window.addEventListener('basira:notice', handle)
    return () => window.removeEventListener('basira:notice', handle)
  }, [])
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), notice.onAction ? 8000 : 5000)
    return () => clearTimeout(t)
  }, [notice])
  if (!notice) return null
  return (
    <div className="notice" role="alert">
      <div>
        {!notice.onAction && <strong>Something needs your attention</strong>}
        <p>{notice.message}</p>
      </div>
      {notice.onAction && (
        <button className="notice-action" onClick={() => { notice.onAction(); setNotice(null) }}>
          {notice.label || 'Undo'}
        </button>
      )}
      <button className="icon-button" aria-label="Dismiss message" onClick={() => setNotice(null)}><Icon name="close"/></button>
    </div>
  )
}
