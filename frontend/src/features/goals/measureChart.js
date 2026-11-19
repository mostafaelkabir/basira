// Pure helpers for the goal measure: number/date formatting, the pace label and the
// chart geometry (actual line, straight line to the target, projection).

const DAY = 86400000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export const dayNum = iso => Math.round(Date.parse(iso + 'T00:00:00Z') / DAY)

export function fmtNum(v) {
  if (v == null || Number.isNaN(Number(v))) return '—'
  return Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })
}

export function withUnit(v, unit) {
  return unit ? `${fmtNum(v)} ${unit}` : fmtNum(v)
}

/** "Dec 16", with the year when it is not `today`'s year. */
export function fmtDay(iso, today) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  const sameYear = today && Number(today.slice(0, 4)) === y
  return `${MONTHS[m - 1]} ${d}${sameYear ? '' : `, ${y}`}`
}

/** Short status for the chip: label + tone (good | warn | bad). null when the goal has no target date. */
export function paceChip(m) {
  const p = m?.pace
  if (!p) return m?.progress_pct >= 100 ? { label: 'Reached', tone: 'good' } : null
  const wk = `${fmtNum(p.weeks)} wk`
  switch (p.status) {
    case 'reached': return { label: 'Reached', tone: 'good' }
    case 'overdue': return { label: 'Past the date', tone: 'bad' }
    case 'on_pace': return { label: 'On pace', tone: 'good' }
    case 'ahead': return { label: `${wk} ahead`, tone: 'good' }
    default: return { label: `${wk} behind`, tone: p.weeks >= 4 ? 'bad' : 'warn' }
  }
}

/** Colour bucket for one week of the system: none | kept | part | missed. */
export function weekTone(pct) {
  if (pct == null) return 'none'
  return pct >= 70 ? 'kept' : pct >= 40 ? 'part' : 'missed'
}

/**
 * Geometry for the chart in a width×height box with `pad` = {l, r, t, b}.
 * Returns pixel coordinates: actual (points), ideal + projection (two-point lines or null),
 * targetY, todayX and the x/y scale functions.
 */
export function chartGeometry(m, width, height, pad = { l: 8, r: 8, t: 12, b: 8 }) {
  const x0 = dayNum(m.start_date)
  const today = dayNum(m.today)
  const xTarget = m.target_date ? dayNum(m.target_date) : null
  const last = m.points[m.points.length - 1]
  const xLast = dayNum(last.date)
  const xProj = m.projection?.date ? dayNum(m.projection.date) : null
  // The window ends at the target date; a later projection may stretch it by half again, no more.
  const base = Math.max(xTarget ?? today, today, x0 + 7)
  const x1 = xProj ? Math.min(Math.max(base, xProj), x0 + Math.round((base - x0) * 1.5)) : base

  const values = [m.start, m.target, ...m.points.map(p => p.value)]
  let lo = Math.min(...values), hi = Math.max(...values)
  const margin = (hi - lo || 1) * 0.08
  lo -= margin; hi += margin

  const sx = d => pad.l + ((d - x0) / (x1 - x0)) * (width - pad.l - pad.r)
  const sy = v => pad.t + (1 - (v - lo) / (hi - lo)) * (height - pad.t - pad.b)

  const actual = m.points.map(p => ({ x: sx(dayNum(p.date)), y: sy(p.value), ...p }))
  const ideal = xTarget ? [{ x: sx(x0), y: sy(m.start) }, { x: sx(xTarget), y: sy(m.target) }] : null
  let projection = null
  if (xProj && xProj > xLast) {
    const end = Math.min(xProj, x1)   // clipped at the window edge, on the same slope
    const value = last.value + (m.target - last.value) * ((end - xLast) / (xProj - xLast))
    projection = [{ x: sx(xLast), y: sy(last.value) }, { x: sx(end), y: sy(value) }]
  }
  return { actual, ideal, projection, targetY: sy(m.target), todayX: sx(Math.min(today, x1)), sx, sy, x0, x1 }
}
