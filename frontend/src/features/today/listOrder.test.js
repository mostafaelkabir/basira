import { describe, it, expect } from 'vitest'
import { chronoEntries } from './listOrder'

describe('list view in time order', () => {
  it('merges blocks and timed items by start time and marks items inside a block', () => {
    const blocks = [
      { id: 'hb', title: 'HaramBlur', start_time: '09:00', start_minutes: 540, duration_minutes: 120 },
      { id: 'am', title: 'Morning', start_time: '07:00', start_minutes: 420, duration_minutes: 90 },
    ]
    const items = [
      { key: 'task:b', title: 'Label data', scheduled_time: '09:30' },
      { key: 'habit:q', title: 'Quran', scheduled_time: '07:00' },
      { key: 'task:c', title: 'Call', scheduled_time: '08:45' },
      { key: 'task:a', title: 'Apply', scheduled_time: '09:30' },
      { key: 'task:x', title: 'Starts with block', scheduled_time: '09:00' },
    ]
    const e = chronoEntries(blocks, items)
    expect(e.map(x => x.key)).toEqual(['block:am', 'habit:q', 'task:c', 'block:hb', 'task:x', 'task:a', 'task:b'])
    const inBlock = Object.fromEntries(e.filter(x => x.type === 'item').map(x => [x.key, x.inBlock]))
    expect(inBlock).toEqual({ 'habit:q': 'am', 'task:c': null, 'task:x': 'hb', 'task:a': 'hb', 'task:b': 'hb' })
  })
  it('works without a rhythm', () => {
    expect(chronoEntries([], [{ key: 'k', title: 'T', scheduled_time: '10:00' }]).map(x => x.key)).toEqual(['k'])
  })
})
