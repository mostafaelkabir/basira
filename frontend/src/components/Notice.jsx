import { useEffect, useState } from 'react'
import Icon from './Icon'
export function notify(message) {
  window.dispatchEvent(new CustomEvent('basira:notice', { detail: String(message) }))
}
export default function Notice() {
  const [message, setMessage] = useState('')
  useEffect(() => {
    const handle = e => setMessage(e.detail)
    window.addEventListener('basira:notice', handle)
    return () => window.removeEventListener('basira:notice', handle)
  }, [])
  return message ? <div className="notice" role="alert"><div><strong>Something needs your attention</strong><p>{message}</p></div><button className="icon-button" aria-label="Dismiss message" onClick={() => setMessage('')}><Icon name="close"/></button></div> : null
}
