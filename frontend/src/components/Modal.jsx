import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon'

export default function Modal({ title, onClose, children, wide = false, className = '' }) {
  const ref = useRef(null)
  const titleId = useId()
  useEffect(() => {
    const dialog = ref.current
    const previous = document.activeElement
    const scroll = document.body.style.overflow
    dialog.showModal()
    document.body.style.overflow = 'hidden'
    return () => {
      dialog.close()
      document.body.style.overflow = scroll
      if (previous?.isConnected) previous.focus()
    }
  }, [])
  return createPortal(
    <dialog ref={ref} aria-labelledby={titleId} className={`basira-dialog ${wide ? 'basira-dialog-wide' : ''} ${className}`}
      onCancel={e => { e.preventDefault(); onClose() }}
      onClick={e => { if (e.target === e.currentTarget) { const r = e.currentTarget.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose() } }}>
      <header className="dialog-header"><h2 id={titleId}>{title}</h2><button type="button" onClick={onClose} className="icon-button" aria-label="Close dialog"><Icon name="close"/></button></header>
      <div className="dialog-body">{children}</div>
    </dialog>, document.body)
}
