import test from 'node:test'
import assert from 'node:assert/strict'
import { buildWorkReport, localDate, periodRange, shiftPeriod, formatWorkTime } from './workReportUtils.js'

test('month boundaries, leap day, and current partial month', () => {
  assert.deepEqual(periodRange('month', '2024-02-20', '', '', '2026-09-15'), { start: '2024-02-01', end: '2024-02-29' })
  assert.deepEqual(periodRange('month', '2026-09-15', '', '', '2026-09-15'), { start: '2026-09-01', end: '2026-09-15' })
  assert.equal(shiftPeriod('2026-03-31', 'month', -1), '2026-02-01')
})

test('weeks start Monday and cross year boundaries', () => {
  assert.deepEqual(periodRange('week', '2026-01-01', '', '', '2026-09-15'), { start: '2025-12-29', end: '2026-01-04' })
  assert.deepEqual(periodRange('week', '2026-09-15', '', '', '2026-09-15'), { start: '2026-09-14', end: '2026-09-15' })
  assert.equal(localDate(new Date(2026, 8, 15, 23, 59)), '2026-09-15')
})

test('custom range is preserved and seconds are not rounded into hours', () => {
  assert.deepEqual(periodRange('custom', '', '2026-09-01', '2026-09-06'), { start: '2026-09-01', end: '2026-09-06' })
  assert.equal(formatWorkTime(3661), '1h 1m 1s')
  assert.equal(formatWorkTime(0), '0m')
})

const entry = { source: 'ticket', item_id: 't', date: '2026-09-01', title: 'Feature', ticket_ref: 'DEV-1', company_name: 'Alpha', type: 'code', note: 'Reviewed API', seconds: 3601 }
const data = { company_name: 'Alpha', date_from: '2026-09-01', date_to: '2026-09-30', total_seconds: 3661,
  entries: [entry, { ...entry, seconds: 60 }], by_day: [{ date: '2026-09-01', seconds: 3661 }], by_type: { code: 3661 } }

test('summary groups sessions and all report formats preserve exact total', () => {
  for (const detail of ['summary', 'detailed']) for (const markdown of [false, true]) {
    const report = buildWorkReport(data, detail, markdown)
    assert.ok(report.includes('Total logged time: 1h 1m 1s'))
    assert.ok(report.includes('2026-09-01 to 2026-09-30'))
    assert.ok(report.includes('[DEV-1]'))
    assert.equal(report.startsWith('# '), markdown)
  }
  assert.equal(buildWorkReport(data).match(/Feature/g).length, 1)
  assert.ok(buildWorkReport(data, 'detailed').includes('Reviewed API'))
})

test('empty report does not invent accomplishments', () => {
  assert.ok(buildWorkReport({ ...data, total_seconds: 0, entries: [] }).includes('No work time entries recorded'))
})
