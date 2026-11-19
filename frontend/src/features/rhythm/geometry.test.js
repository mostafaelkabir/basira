import { describe, it, expect } from 'vitest'
import { assignLanes, dragDuration, dragStart, dragStartEdge, hourTicks, layoutItems, minutesAtY, overlapsAny, snap, toHHMM, toMinutes, visibleWindow } from './geometry'

const blk = (start, dur, id = `${start}`) => ({ id, start_minutes: toMinutes(start), duration_minutes: dur })

describe('time helpers', () => {
  it('round-trips HH:MM and snaps to the quarter hour', () => {
    expect(toMinutes('09:30')).toBe(570)
    expect(toHHMM(570)).toBe('09:30')
    expect(toHHMM(-5)).toBe('00:00')
    expect(toHHMM(2000)).toBe('23:59')
    expect(snap(563)).toBe(570)
    expect(snap(552)).toBe(555)
    expect(toMinutes('nope')).toBeNull()
  })
})

describe('visible window', () => {
  it('shows the day window, widened to hold early blocks and now, in whole hours', () => {
    expect(visibleWindow({})).toEqual({ start: 540, end: 1080 })
    expect(visibleWindow({ blocks: [blk('07:15', 90)] })).toEqual({ start: 420, end: 1080 })
    expect(visibleWindow({ blocks: [blk('20:30', 120)] })).toEqual({ start: 540, end: 1380 })
    expect(visibleWindow({ nowMinutes: 23 * 60 + 50 })).toEqual({ start: 540, end: 1440 })
    expect(hourTicks({ start: 420, end: 600 })).toEqual([420, 480, 540])
  })
})

describe('lanes', () => {
  it('gives non-overlapping blocks one lane each and splits overlaps side by side', () => {
    const [a, b] = assignLanes([blk('09:00', 60, 'a'), blk('10:00', 60, 'b')])
    expect([a.lane, a.lanes, b.lane, b.lanes]).toEqual([0, 1, 0, 1])
    const placed = assignLanes([blk('09:00', 120, 'x'), blk('09:30', 60, 'y'), blk('12:00', 30, 'z')])
    const by = Object.fromEntries(placed.map(p => [p.block.id, p]))
    expect([by.x.lane, by.x.lanes, by.y.lane, by.y.lanes]).toEqual([0, 2, 1, 2])
    expect([by.z.lane, by.z.lanes]).toEqual([0, 1])
  })
})

describe('drag maths', () => {
  const window = { start: 420, end: 1080 }
  it('moves in snapped steps and never leaves the day', () => {
    const b = blk('09:00', 120)
    expect(dragStart(b, 37, 1, window)).toBe(570)        // 37 min -> snapped to 30
    expect(dragStart(b, -10000, 1, window)).toBe(420)    // not before the window
    expect(dragStart(b, 100000, 1, window)).toBe(24 * 60 - 120)
  })
  it('resizes in snapped steps with a floor and a ceiling at midnight', () => {
    const b = blk('22:00', 60)
    expect(dragDuration(b, 22, 1)).toBe(75)
    expect(dragDuration(b, -1000, 1)).toBe(15)
    expect(dragDuration(b, 1000, 1)).toBe(120)
  })
})

describe('one time-based day', () => {
  it('puts every timed item at its time, untimed ones in their block or the anytime lane', () => {
    const blocks = [{ id: 'b', items: ['task:inblock', 'task:timed-in-block', 'task:done-in-block'] }]
    const items = [
      { key: 'task:inblock', title: 'Filed', scheduled_time: null, status: 'todo' },
      { key: 'task:timed-in-block', title: 'Timed in block', scheduled_time: '09:30', status: 'todo' },
      { key: 'task:done-in-block', title: 'Done in block', scheduled_time: null, status: 'done' },
      { key: 'ticket:t', title: 'Timed', scheduled_time: '10:30', planned_minutes: 45, status: 'todo' },
      { key: 'task:a', title: 'Loose', scheduled_time: null, status: 'todo' },
      { key: 'task:d', title: 'Done loose', scheduled_time: null, status: 'done' },
      { key: 'task:dt', title: 'Done timed', scheduled_time: '11:00', status: 'done' },
      { key: 'habit:h', title: 'Tiny', scheduled_time: '12:00', planned_minutes: 5, status: 'todo' },
    ]
    const { events, anytime, inBlock } = layoutItems(items, blocks)
    expect(events.map(e => [e.item.key, e.start_minutes, e.duration_minutes]))
      .toEqual([['task:timed-in-block', 570, 30], ['ticket:t', 630, 45], ['task:dt', 660, 30], ['habit:h', 720, 30]])
    expect(anytime.map(i => i.key)).toEqual(['task:a'])
    expect(inBlock.b.map(i => i.key)).toEqual(['task:inblock', 'task:done-in-block'])
    expect(overlapsAny({ start_minutes: 570, duration_minutes: 30 }, [{ start_minutes: 540, duration_minutes: 60 }])).toBe(true)
    expect(overlapsAny({ start_minutes: 600, duration_minutes: 30 }, [{ start_minutes: 540, duration_minutes: 60 }])).toBe(false)
  })
  it('maps a pointer to a snapped time inside the window and resizes from the top edge', () => {
    const window = { start: 420, end: 1080 }
    expect(minutesAtY(100, 0, 1, window)).toBe(525)      // 420 + 100 → 520 → snapped 525
    expect(minutesAtY(-500, 0, 1, window)).toBe(420)
    expect(dragStartEdge({ start_minutes: 540, duration_minutes: 120 }, 40, 1, window)).toEqual({ start_minutes: 585, duration_minutes: 75 })
    expect(dragStartEdge({ start_minutes: 540, duration_minutes: 120 }, 1000, 1, window)).toEqual({ start_minutes: 645, duration_minutes: 15 })
  })
})
