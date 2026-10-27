import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// lanes.js reaches tldraw only for Box and ids; the shape util module needs a few more names.
vi.mock('tldraw', () => ({
  Box: class { static Common() { return null } },
  createShapeId: () => `shape:${Math.random().toString(36).slice(2)}`,
  BaseBoxShapeUtil: class {},
  HTMLContainer: () => null,
  T: { number: 'number', string: 'string' },
  useEditor: () => null,
  useValue: (_name, fn) => fn(),
}))

const { laneDefs } = await import('./lanes')

const NOW = new Date(2026, 9, 21, 10, 0, 0)   // Wed Oct 21 2026

describe('lane definitions', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW) })
  afterEach(() => vi.useRealTimers())

  it('status lanes cover every status and file by status', () => {
    const defs = laneDefs('status')
    expect(defs.map(d => d.value)).toEqual(['backlog', 'todo', 'in_progress', 'review', 'blocked', 'done'])
    expect(defs.find(d => d.value === 'in_progress').match({ status: 'in_progress' })).toBe(true)
    expect(defs.find(d => d.value === 'todo').match({})).toBe(true)   // unknown status reads as to-do
    expect(defs.every(d => d.kind === 'status')).toBe(true)
  })

  it('milestone lanes list open milestones plus a catch-all', () => {
    const milestones = [
      { id: 'm1', title: 'Demo', due_date: '2026-10-26', status: 'open' },
      { id: 'm2', title: 'Old', due_date: '2026-09-01', status: 'done' },
    ]
    const defs = laneDefs('milestone', { milestones })
    expect(defs.map(d => d.value)).toEqual(['m1', ''])
    expect(defs[0].label).toBe('◆ Demo · Oct 26')
    expect(defs[0].match({ milestone_id: 'm1' })).toBe(true)
    expect(defs[1].match({ milestone_id: 'm2' })).toBe(true)    // a finished milestone counts as none
    expect(defs[1].match({})).toBe(true)
  })

  it('due lanes bucket by this week, next week, later, none; overdue lands in today', () => {
    const defs = laneDefs('due')
    expect(defs.map(d => d.label)).toEqual(['Today · Oct 21', 'This week · by Oct 25', 'Next week · by Nov 1', 'Later · Nov 11 +', 'No date'])
    expect(defs.map(d => d.value)).toEqual(['2026-10-21', '2026-10-25', '2026-11-01', '2026-11-11', ''])
    const bucket = d => defs.find(def => def.match(d))?.label
    expect(bucket({ due_date: '2026-10-19' })).toBe('Today · Oct 21')
    expect(bucket({ due_date: '2026-10-23' })).toBe('This week · by Oct 25')
    expect(bucket({ due_date: '2026-10-26' })).toBe('Next week · by Nov 1')
    expect(bucket({ due_date: '2026-12-01' })).toBe('Later · Nov 11 +')
    expect(bucket({})).toBe('No date')
  })

  it('week lanes are the seven days of this week and write a due date', () => {
    const defs = laneDefs('week')
    expect(defs).toHaveLength(7)
    expect(defs[0]).toMatchObject({ kind: 'due', value: '2026-10-19', label: 'Mon Oct 19' })
    expect(defs[6]).toMatchObject({ kind: 'due', value: '2026-10-25', label: 'Sun Oct 25' })
    expect(defs[2].match({ due_date: '2026-10-21' })).toBe(true)
  })

  it('roadmap lanes are now / next / later', () => {
    const defs = laneDefs('roadmap')
    expect(defs.map(d => d.value)).toEqual(['2026-10-25', '2026-11-01', '2026-11-18'])
    expect(defs[2].match({})).toBe(true)   // undated work is "later"
    expect(laneDefs('nonsense')).toEqual([])
  })
})
