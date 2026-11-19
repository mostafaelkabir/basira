import { describe, expect, it } from 'vitest'
import { chartGeometry, fmtDay, fmtNum, paceChip, weekTone, withUnit } from './measureChart'

const weight = {
  start: 92, target: 82, start_date: '2026-08-01', target_date: '2026-12-19', today: '2026-10-10',
  points: [{ date: '2026-08-01', value: 92 }, { date: '2026-09-05', value: 91 }, { date: '2026-10-09', value: 88 }],
  projection: { date: '2026-12-16', toward: true, weekly_rate: -0.62 },
  pace: { status: 'behind', weeks: 2, days_left: 70 }, progress_pct: 40,
}

describe('formatting', () => {
  it('trims numbers and adds the unit', () => {
    expect(fmtNum(88)).toBe('88')
    expect(fmtNum(87.256)).toBe('87.26')
    expect(fmtNum(12500)).toBe('12,500')
    expect(withUnit(88, 'kg')).toBe('88 kg')
    expect(withUnit(7, '')).toBe('7')
  })
  it('shows the year only when it differs', () => {
    expect(fmtDay('2026-12-16', '2026-10-10')).toBe('Dec 16')
    expect(fmtDay('2027-01-21', '2026-10-10')).toBe('Jan 21, 2027')
  })
})

describe('paceChip', () => {
  it('labels each status', () => {
    expect(paceChip(weight)).toEqual({ label: '2 wk behind', tone: 'warn' })
    expect(paceChip({ pace: { status: 'behind', weeks: 5.5 } })).toEqual({ label: '5.5 wk behind', tone: 'bad' })
    expect(paceChip({ pace: { status: 'ahead', weeks: 1.5 } })).toEqual({ label: '1.5 wk ahead', tone: 'good' })
    expect(paceChip({ pace: { status: 'on_pace', weeks: 0.2 } }).label).toBe('On pace')
    expect(paceChip({ pace: { status: 'overdue', weeks: 3 } }).tone).toBe('bad')
  })
  it('has no chip without a target date, unless the target is reached', () => {
    expect(paceChip({ pace: null, progress_pct: 40 })).toBeNull()
    expect(paceChip({ pace: null, progress_pct: 100 }).label).toBe('Reached')
  })
})

describe('weekTone', () => {
  it('buckets a week', () => {
    expect([null, 100, 70, 69, 40, 39, 0].map(weekTone)).toEqual(['none', 'kept', 'kept', 'part', 'part', 'missed', 'missed'])
  })
})

describe('chartGeometry', () => {
  const g = chartGeometry(weight, 600, 200, { l: 0, r: 0, t: 0, b: 0 })
  it('spans start date to target date', () => {
    expect(g.actual[0].x).toBe(0)
    expect(g.ideal[1].x).toBe(600)
    expect(g.todayX).toBeCloseTo(300, 0)   // half the time gone
  })
  it('puts a falling target below the start', () => {
    expect(g.ideal[0].y).toBeLessThan(g.ideal[1].y)
    expect(g.targetY).toBe(g.ideal[1].y)
  })
  it('draws the projection from the last point to the target line', () => {
    expect(g.projection[0].x).toBe(g.actual[2].x)
    expect(g.projection[1].y).toBeCloseTo(g.targetY, 5)
    expect(g.projection[1].x).toBeLessThan(600)   // arrives three days early
  })
  it('clips a late projection at half again the window', () => {
    const late = chartGeometry({ ...weight, projection: { date: '2028-06-01' } }, 600, 200, { l: 0, r: 0, t: 0, b: 0 })
    expect(late.x1 - late.x0).toBe(210)           // 140 days × 1.5
    expect(late.projection[1].x).toBe(600)
    expect(late.projection[1].y).toBeLessThan(late.targetY)   // still above the target at the edge
  })
  it('works without a target date or a projection', () => {
    const open = chartGeometry({ ...weight, target_date: null, projection: null }, 600, 200)
    expect(open.ideal).toBeNull()
    expect(open.projection).toBeNull()
    expect(open.actual).toHaveLength(3)
  })
})
