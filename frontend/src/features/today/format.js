// Display-only formatting for the day workspace. Totals are kept in exact
// seconds everywhere upstream; we round only here, at render time.

export function fmtDuration(seconds) {
  const s = Math.max(0, Math.round(seconds || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h && m) return `${h}h ${m}m`
  if (h) return `${h}h`
  if (m) return `${m}m`
  return s > 0 ? '<1m' : '0m'
}

export function fmtMinutes(minutes) {
  return fmtDuration((minutes || 0) * 60)
}

// "10:45" -> "10:45 AM"; passthrough on anything unparseable.
export function fmtClock(hhmm) {
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return hhmm || ''
  const [h, m] = hhmm.split(':').map(Number)
  const period = h < 12 ? 'AM' : 'PM'
  const hour = h % 12 === 0 ? 12 : h % 12
  return `${hour}:${String(m).padStart(2, '0')} ${period}`
}

export const BUCKET_LABELS = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
  anytime: 'Anytime',
}

export const BUCKET_ORDER = ['morning', 'afternoon', 'evening', 'anytime']
