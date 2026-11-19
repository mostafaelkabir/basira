import { useEffect } from 'react'
import { notifyAction } from './components/Notice'

// Keep long-lived windows (the Basira desktop app, a tab left open for days) on the
// latest build. Remember the build this page started with; when the server reports
// a different one, reload the moment the window is shown again, or offer a Reload
// button if it is already in front.
export function useBuildWatcher() {
  useEffect(() => {
    let started = null, offered = false
    const check = async () => {
      try {
        const res = await fetch('/app-version', { cache: 'no-store' })
        if (!res.ok) return null
        return (await res.json()).version
      } catch { return null }
    }
    const busy = () => !!document.querySelector('dialog[open], .basira-dialog[open]') || !!document.querySelector('.cal[class*="is-dragging"]')
    const onChange = async (shownAgain) => {
      const v = await check()
      if (!v || !started || v === started) return
      if (shownAgain && !busy()) { window.location.reload(); return }
      if (!offered) { offered = true; notifyAction('Basira was updated.', 'Reload', () => window.location.reload()) }
    }
    check().then(v => { started = v })
    const onVisible = () => { if (document.visibilityState === 'visible') onChange(true) }
    const onFocus = () => onChange(true)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onFocus)
    const id = setInterval(() => onChange(false), 60000)
    return () => { document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('focus', onFocus); clearInterval(id) }
  }, [])
}
