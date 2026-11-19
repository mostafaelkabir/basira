// Where an item fits inside a block: the first quarter-hour start where it does not
// overlap another timed item already in that window; the block's start when full.
const mins = hhmm => { if (!hhmm) return null; const [h, m] = hhmm.split(':').map(Number); return h * 60 + m }
const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

export function freeSlotInBlock(block, items, itemKey, duration = 30) {
  const start = mins(block.start_time), end = start + block.duration_minutes
  const taken = items
    .filter(i => i.key !== itemKey && i.scheduled_time && i.status !== 'done')
    .map(i => [mins(i.scheduled_time), mins(i.scheduled_time) + Math.max(15, i.planned_minutes || 30)])
    .filter(([s, e]) => s < end && start < e)
  const len = Math.min(Math.max(15, duration), block.duration_minutes)
  for (let s = start; s + len <= end; s += 15) {
    if (!taken.some(([a, b]) => s < b && a < s + len)) return hhmm(s)
  }
  return hhmm(start)
}
