// Pure geometry for the day calendar: minutes <-> pixels, snapping, the visible
// window, overlap lanes. No DOM, no dates beyond "HH:MM" strings — unit tested.

export const SNAP = 15          // drag/resize snap, minutes
export const MIN_DURATION = 15

export function toMinutes(hhmm) {
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return null
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}
export function toHHMM(minutes) {
  const v = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutes)))
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`
}
export function snap(minutes, step = SNAP) { return Math.round(minutes / step) * step }
export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }

// The hours the calendar shows: the configured day window, widened to hold every
// block and the current time, rounded outwards to whole hours.
export function visibleWindow({ dayStart = '09:00', dayEnd = '18:00', blocks = [], nowMinutes = null }) {
  let lo = toMinutes(dayStart) ?? 540
  let hi = toMinutes(dayEnd) ?? 1080
  for (const b of blocks) {
    lo = Math.min(lo, b.start_minutes)
    hi = Math.max(hi, b.start_minutes + b.duration_minutes)
  }
  if (nowMinutes != null) { lo = Math.min(lo, nowMinutes); hi = Math.max(hi, nowMinutes + 1) }
  lo = Math.floor(lo / 60) * 60
  hi = Math.min(24 * 60, Math.ceil(hi / 60) * 60)
  if (hi - lo < 60) hi = Math.min(24 * 60, lo + 60)
  return { start: lo, end: hi }
}

export function hourTicks(window) {
  const out = []
  for (let m = window.start; m < window.end; m += 60) out.push(m)
  return out
}

// Overlapping blocks share the column: each gets a lane and the lane count of its
// cluster, so they can be drawn side by side like a calendar does.
export function assignLanes(blocks) {
  const sorted = [...blocks].sort((a, b) => a.start_minutes - b.start_minutes || b.duration_minutes - a.duration_minutes)
  const placed = []
  let cluster = [], clusterEnd = -1
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map(c => c.lane + 1))
    for (const c of cluster) c.lanes = lanes
    cluster = []; clusterEnd = -1
  }
  for (const b of sorted) {
    if (cluster.length && b.start_minutes >= clusterEnd) flush()
    const ends = cluster.map(c => c.block.start_minutes + c.block.duration_minutes)
    let lane = 0
    const taken = new Set(cluster.filter(c => ends[cluster.indexOf(c)] > b.start_minutes).map(c => c.lane))
    while (taken.has(lane)) lane++
    const entry = { block: b, lane, lanes: 1 }
    cluster.push(entry); placed.push(entry)
    clusterEnd = Math.max(clusterEnd, b.start_minutes + b.duration_minutes)
  }
  if (cluster.length) flush()
  return placed
}

// Where a drag lands: new start from a pixel delta, snapped and kept in the day.
export function dragStart(block, deltaPx, pxPerMinute, window) {
  const raw = block.start_minutes + deltaPx / pxPerMinute
  const snapped = snap(raw)
  return clamp(snapped, window.start, Math.max(window.start, 24 * 60 - block.duration_minutes))
}
export function dragDuration(block, deltaPx, pxPerMinute) {
  const raw = block.duration_minutes + deltaPx / pxPerMinute
  return Math.max(MIN_DURATION, Math.min(24 * 60 - block.start_minutes, snap(raw)))
}

// ── Items on the grid ─────────────────────────────────────────────────────────
export const ZOOMS = [0.8, 1, 1.25, 1.6, 2]     // px per minute: 48 … 120 px per hour
export const EVENT_MIN = 30                      // an item with no estimate still gets a visible card

// One time-based day: every item with a time is a card at that time (in a block or
// not, done or not); an untimed item sits inside its block, or in the Anytime lane
// when no block holds it. Untimed done items only appear in Completed.
export function layoutItems(items, blocks) {
  const blockOf = new Map()
  for (const b of blocks || []) for (const k of b.items || []) blockOf.set(k, b.id)
  const events = [], anytime = [], inBlock = {}
  for (const i of items || []) {
    const start = toMinutes(i.scheduled_time)
    if (start != null) {
      events.push({ id: `event:${i.key}`, kind: 'event', item: i, title: i.title,
        start_minutes: start, duration_minutes: Math.max(EVENT_MIN, i.planned_minutes || 0) })
    } else if (blockOf.has(i.key)) {
      (inBlock[blockOf.get(i.key)] ||= []).push(i)
    } else if (i.status !== 'done') {
      anytime.push(i)
    }
  }
  return { events, anytime, inBlock }
}

// Does [start, start+dur) overlap any block? Cards over a block sit to its right.
export function overlapsAny(ev, blocks) {
  return (blocks || []).some(b => ev.start_minutes < b.start_minutes + b.duration_minutes && b.start_minutes < ev.start_minutes + ev.duration_minutes)
}

// Minutes under a pointer, snapped, kept inside the visible window.
export function minutesAtY(clientY, gridTop, pxPerMinute, window) {
  const raw = window.start + (clientY - gridTop) / pxPerMinute
  return clamp(snap(raw), window.start, window.end)
}

// Resizing from the top edge moves the start and keeps the end where it was.
export function dragStartEdge(block, deltaPx, pxPerMinute, window) {
  const end = block.start_minutes + block.duration_minutes
  const start = clamp(snap(block.start_minutes + deltaPx / pxPerMinute), window.start, end - MIN_DURATION)
  return { start_minutes: start, duration_minutes: end - start }
}
