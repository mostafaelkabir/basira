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

// Local calendar-day helpers on "YYYY-MM-DD" strings (no UTC drift).
function parseDay(iso) { return new Date(iso + 'T00:00:00') }
function isoDay(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export function addDays(iso, n) {
  const d = parseDay(iso); d.setDate(d.getDate() + n); return isoDay(d)
}
// "Today" / "Tomorrow" / "Thu" relative to `todayIso`.
export function dayShort(iso, todayIso) {
  if (iso === todayIso) return 'Today'
  if (iso === addDays(todayIso, 1)) return 'Tomorrow'
  return parseDay(iso).toLocaleDateString(undefined, { weekday: 'short' })
}
// "Thu, Oct 8"
export function dayLong(iso) {
  return parseDay(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}
