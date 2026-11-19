import { describe, it, expect } from 'vitest'
import { freeSlotInBlock } from './blockSlot'

describe('fitting an item into its block', () => {
  const block = { start_time: '16:30', duration_minutes: 60 }
  it('takes the block start when the block is free', () => {
    expect(freeSlotInBlock(block, [], 'task:x', 30)).toBe('16:30')
  })
  it('skips past items already in the block', () => {
    const items = [{ key: 'task:a', scheduled_time: '16:30', planned_minutes: 30, status: 'todo' }]
    expect(freeSlotInBlock(block, items, 'task:x', 30)).toBe('17:00')
  })
  it('ignores the item itself and done items, and falls back to the start when full', () => {
    const items = [
      { key: 'task:x', scheduled_time: '16:30', planned_minutes: 60, status: 'todo' },
      { key: 'task:d', scheduled_time: '16:30', planned_minutes: 60, status: 'done' },
    ]
    expect(freeSlotInBlock(block, items, 'task:x', 30)).toBe('16:30')
    expect(freeSlotInBlock(block, [{ key: 'task:a', scheduled_time: '16:30', planned_minutes: 60, status: 'todo' }], 'task:x', 30)).toBe('16:30')
  })
})
