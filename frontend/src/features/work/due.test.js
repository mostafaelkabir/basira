import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addDays, countdown, dueMeta, endOfWeek, shortDate, startOfWeek, todayIso } from './due'

// Wed Oct 21 2026, local time.
const NOW = new Date(2026, 9, 21, 10, 0, 0)

describe('due dates', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW) })
  afterEach(() => vi.useRealTimers())

  it('knows today and simple arithmetic', () => {
    expect(todayIso()).toBe('2026-10-21')
    expect(addDays('2026-10-21', 10)).toBe('2026-10-31')
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(shortDate('2026-11-04')).toBe('Nov 4')
  })

  it('weeks start on Monday', () => {
    expect(startOfWeek('2026-10-21')).toBe('2026-10-19')
    expect(endOfWeek('2026-10-21')).toBe('2026-10-25')
    expect(startOfWeek('2026-10-25')).toBe('2026-10-19')   // Sunday still belongs to the week
    expect(startOfWeek('2026-10-26')).toBe('2026-10-26')   // next Monday
  })

  it('classifies due dates by urgency', () => {
    expect(dueMeta(null)).toBeNull()
    expect(dueMeta('2026-10-19')).toMatchObject({ tone: 'overdue', label: '2d overdue · Oct 19' })
    expect(dueMeta('2026-10-21')).toMatchObject({ tone: 'today', label: 'Due today' })
    expect(dueMeta('2026-10-22')).toMatchObject({ tone: 'soon', label: 'Due tomorrow' })
    expect(dueMeta('2026-10-28')).toMatchObject({ tone: 'soon' })
    expect(dueMeta('2026-10-29')).toMatchObject({ tone: 'later', label: 'Due Oct 29' })
    expect(dueMeta('2026-10-19', { done: true })).toMatchObject({ tone: 'done' })   // finished work is never overdue
  })

  it('counts down to milestones', () => {
    expect(countdown('2026-10-21')).toBe('Today')
    expect(countdown('2026-10-22')).toBe('Tomorrow')
    expect(countdown('2026-10-26')).toBe('In 5 days')
    expect(countdown('2026-10-20')).toBe('1 day late')
    expect(countdown('2026-10-18')).toBe('3 days late')
    expect(countdown(null)).toBe('No date')
    expect(countdown('2026-10-18', { done: true })).toBe('Reached')
  })
})
