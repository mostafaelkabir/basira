import { useEffect, useState } from 'react'
import Modal from '../../components/Modal'
import { notify } from '../../components/Notice'
import { getItemTime, logDayTime, stopDayTimer, undoLastSession } from '../../api'
import { fmtDuration } from './format'

function clock(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

// Correct the time on one task / ticket / work log: a timer that was left running
// (stop it keeping only the real minutes, or discard it), or a recorded session that
// ran too long (undo it, or take minutes off).
export default function FixTimeDialog({ item, onClose, onChanged }) {
  const { source, item_id, title } = item
  const [info, setInfo] = useState(null)
  const [error, setError] = useState('')
  const [minutes, setMinutes] = useState('')
  const [busy, setBusy] = useState(false)
  const [, tick] = useState(0)

  useEffect(() => {
    getItemTime(source, item_id).then(setInfo).catch(e => setError(e.message))
  }, [source, item_id])
  useEffect(() => {
    const id = setInterval(() => tick(n => n + 1), 1000)
    return () => clearInterval(id)
  }, [])

  async function run(action, message) {
    setBusy(true); setError('')
    try {
      await action()
      window.dispatchEvent(new CustomEvent('basira:time-fixed', { detail: { source, item_id } }))
      window.dispatchEvent(new CustomEvent('basira:timer-changed'))
      notify(message, { title: 'Time corrected' })
      onChanged?.()
      onClose()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const mins = parseInt(minutes, 10)
  const valid = Number.isFinite(mins) && mins >= 0
  const running = info?.running
  const elapsed = running ? Math.max(0, Math.floor((Date.now() - new Date(running.started_at).getTime()) / 1000)) : 0
  const last = info?.last
  const input = 'w-20 text-sm bg-canvas border border-border rounded-lg px-2 py-1.5 text-ink font-mono tabular-nums focus:outline-none focus:ring-1 focus:ring-accent'
  const primary = 'px-3 py-1.5 rounded-xl bg-forest text-white text-sm font-semibold hover:bg-forest-hover disabled:opacity-50'
  const danger = 'px-3 py-1.5 rounded-xl border border-red-200 text-red-600 text-sm font-semibold hover:bg-red-50 disabled:opacity-50'

  return (
    <Modal title="Fix time" onClose={onClose}>
      <div className="space-y-4" data-testid="fix-time">
        <p className="text-sm text-ink font-medium truncate">{title}</p>
        {!info && !error && <p className="text-sm text-muted">Loading…</p>}

        {running && (
          <>
            <p className="text-sm text-muted">
              Timer running since <span className="text-ink">{clock(running.started_at)}</span> —{' '}
              <span className="font-mono tabular-nums text-ink">{fmtDuration(elapsed)}</span> so far.
            </p>
            <form className="bg-surface border border-border rounded-2xl p-3 flex flex-wrap items-center gap-2"
              onSubmit={e => { e.preventDefault(); if (valid) run(() => stopDayTimer({ source, item_id, keep_minutes: mins }), mins ? `Stopped — kept ${fmtDuration(Math.min(mins * 60, elapsed))}` : 'Session discarded') }}>
              <label htmlFor="fix-keep" className="text-sm text-ink">Stop and keep only</label>
              <input id="fix-keep" type="number" min="0" max={Math.max(1, Math.floor(elapsed / 60))} autoFocus value={minutes}
                onChange={e => setMinutes(e.target.value)} placeholder="45" className={input} />
              <span className="text-sm text-muted">min</span>
              <button type="submit" disabled={busy || !valid} className={`${primary} ml-auto`}>Stop & save</button>
            </form>
            <button type="button" disabled={busy} className={danger}
              onClick={() => run(() => undoLastSession(source, item_id), 'Session discarded — nothing recorded')}>
              Discard this session
            </button>
          </>
        )}

        {info && !running && last && (
          <>
            <p className="text-sm text-muted">
              Last session: <span className="font-mono tabular-nums text-ink">{fmtDuration(last.seconds)}</span>
              {last.ended_at ? <> · ended {clock(last.ended_at)}</> : last.date ? <> · {last.date}</> : null}
              <span className="text-faint"> · {fmtDuration(info.total_seconds)} recorded in all</span>
            </p>
            <form className="bg-surface border border-border rounded-2xl p-3 flex flex-wrap items-center gap-2"
              onSubmit={e => { e.preventDefault(); if (valid && mins > 0) run(() => logDayTime({ source, item_id, minutes: -mins }), `${fmtDuration(mins * 60)} taken off`) }}>
              <label htmlFor="fix-off" className="text-sm text-ink">Take off</label>
              <input id="fix-off" type="number" min="1" max={Math.floor(info.total_seconds / 60)} autoFocus value={minutes}
                onChange={e => setMinutes(e.target.value)} placeholder="30" className={input} />
              <span className="text-sm text-muted">min</span>
              <button type="submit" disabled={busy || !valid || mins < 1} className={`${primary} ml-auto`}>Take off</button>
            </form>
            <button type="button" disabled={busy} className={danger}
              onClick={() => run(() => undoLastSession(source, item_id), `Last session removed (${fmtDuration(last.seconds)})`)}>
              Undo last session ({fmtDuration(last.seconds)})
            </button>
          </>
        )}

        {info && !running && !last && (
          <p className="text-sm text-muted">
            {info.total_seconds > 0 ? `${fmtDuration(info.total_seconds)} recorded, with no timer session to undo.` : 'No time is recorded on this yet.'}
          </p>
        )}
        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      </div>
    </Modal>
  )
}
