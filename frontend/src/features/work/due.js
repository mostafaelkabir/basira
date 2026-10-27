// Due-date helpers shared by tickets, tasks, milestones, Kanban and board cards.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export const toIso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const todayIso = () => toIso(new Date())
export function addDays(iso, n) { const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() + n); return toIso(d) }
export function shortDate(iso) { if (!iso) return ''; const d = new Date(`${iso}T00:00:00`); return `${MONTHS[d.getMonth()]} ${d.getDate()}` }
export function dayLabel(iso) { const d = new Date(`${iso}T00:00:00`); return `${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()}` }
export function daysUntil(iso) {
  const t = new Date(`${todayIso()}T00:00:00`); const d = new Date(`${iso}T00:00:00`)
  return Math.round((d - t) / 86400000)
}
/** Monday of the week containing `iso` (weeks start on Monday). */
export function startOfWeek(iso = todayIso()) { const d = new Date(`${iso}T00:00:00`); const shift = (d.getDay() + 6) % 7; return addDays(iso, -shift) }
export function endOfWeek(iso = todayIso()) { return addDays(startOfWeek(iso), 6) }

/** Label and tone for a due date: overdue | today | soon (≤ 7 days) | later, or done. */
export function dueMeta(iso, { done = false } = {}) {
  if (!iso) return null
  const diff = daysUntil(iso)
  if (done) return { label: `Due ${shortDate(iso)}`, tone: 'done', diff }
  if (diff < 0) return { label: `${-diff}d overdue · ${shortDate(iso)}`, tone: 'overdue', diff }
  if (diff === 0) return { label: 'Due today', tone: 'today', diff }
  if (diff === 1) return { label: 'Due tomorrow', tone: 'soon', diff }
  if (diff <= 7) return { label: `Due ${shortDate(iso)}`, tone: 'soon', diff }
  return { label: `Due ${shortDate(iso)}`, tone: 'later', diff }
}

/** Countdown wording for milestones: "in 5 days", "today", "3 days late". */
export function countdown(iso, { done = false } = {}) {
  if (done) return 'Reached'
  if (!iso) return 'No date'
  const diff = daysUntil(iso)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff > 1) return `In ${diff} days`
  return diff === -1 ? '1 day late' : `${-diff} days late`
}
