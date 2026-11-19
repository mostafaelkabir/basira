// The list view as the day goes: blocks and timed items merged by start time (a
// block comes before an item that starts with it), each item marked with the block
// whose window holds its time so it can be shown under it. Untimed items are not
// here; they wait at the end until they get a time.
const mins = hhmm => { if (!hhmm) return null; const [h, m] = hhmm.split(':').map(Number); return h * 60 + m }

export function chronoEntries(blocks = [], timedItems = []) {
  const entries = [
    ...blocks.map(b => ({ type: 'block', key: `block:${b.id}`, start: b.start_minutes ?? mins(b.start_time), block: b })),
    ...timedItems.map(i => ({ type: 'item', key: i.key, start: mins(i.scheduled_time), item: i })),
  ].filter(e => e.start != null)
  entries.sort((a, b) => a.start - b.start || (a.type === b.type ? 0 : a.type === 'block' ? -1 : 1) ||
    (a.type === 'item' ? a.item.title.localeCompare(b.item.title) : 0))
  for (const e of entries) {
    if (e.type !== 'item') continue
    const holder = blocks.find(b => {
      const s = b.start_minutes ?? mins(b.start_time)
      return s <= e.start && e.start < s + b.duration_minutes
    })
    e.inBlock = holder ? holder.id : null
  }
  return entries
}
