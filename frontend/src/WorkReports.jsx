import { useEffect, useRef, useState } from 'react'
import { getWorkReport, generateWeeklyReport } from './api'
import { buildWorkReport, displayDate, formatWorkTime, localDate, periodRange, shiftPeriod, typeLabel } from './workReportUtils'

const BUTTON = 'px-3 py-2 rounded-xl border border-[#E8E3DB] bg-white text-sm text-[#1B3A2D] hover:border-[#2D7A6B] disabled:opacity-40'
const INPUT = 'px-3 py-2 rounded-xl border border-[#E8E3DB] bg-white text-sm text-[#1A1A1A] max-w-full'
const COLORS = { code: '#2D7A6B', review: '#b39a45', meeting: '#859382', research: '#84719b', planning: '#b88765', other: '#6B6B6B' }

function TimeBar({ values, max }) {
  return (
    <div className="flex h-2 rounded-full bg-[#F2EDE4] overflow-hidden" aria-hidden="true">
      {Object.entries(values).map(([type, seconds]) => (
        <div key={type} style={{ width: `${max ? seconds / max * 100 : 0}%`, background: COLORS[type] || COLORS.other }} />
      ))}
    </div>
  )
}

function ReportPreview({ data }) {
  const [detail, setDetail] = useState('summary')
  const [format, setFormat] = useState('text')
  const [drafts, setDrafts] = useState({})
  const [notice, setNotice] = useState('')
  const editor = useRef(null)
  const key = `${detail}:${format}`
  const value = drafts[key] ?? buildWorkReport(data, detail, format === 'markdown')

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setNotice('Report copied.')
    } catch {
      editor.current.focus()
      editor.current.select()
      setNotice('Report selected. Press ⌘C or Ctrl+C to copy.')
    }
  }

  return (
    <section className="bg-white border border-[#E8E3DB] rounded-2xl p-5">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
        <div>
          <h3 className="font-semibold text-[#1B3A2D]">Manager report</h3>
          <p className="text-xs text-[#6B6B6B] mt-1">Edit your draft before copying. Changes here only affect the report.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <select aria-label="Report detail" className={INPUT} value={detail} onChange={e => { setDetail(e.target.value); setNotice('') }}>
            <option value="summary">Concise update</option><option value="detailed">Detailed timesheet</option>
          </select>
          <select aria-label="Report format" className={INPUT} value={format} onChange={e => { setFormat(e.target.value); setNotice('') }}>
            <option value="text">Plain text</option><option value="markdown">Markdown</option>
          </select>
        </div>
      </div>
      <label htmlFor="work-report-draft" className="text-xs font-medium text-[#6B6B6B]">Editable preview</label>
      <textarea id="work-report-draft" ref={editor} value={value}
        onChange={e => { setDrafts(prev => ({ ...prev, [key]: e.target.value })); setNotice('') }}
        className="w-full min-h-[280px] mt-2 p-4 rounded-xl border border-[#E8E3DB] bg-[#F9F6F1] text-sm leading-relaxed text-[#1A1A1A] resize-y" />
      <div className="flex items-center justify-between flex-wrap gap-3 mt-3">
        <button className={BUTTON} disabled={drafts[key] === undefined} onClick={() => {
          setDrafts(prev => { const next = { ...prev }; delete next[key]; return next })
          setNotice('Report reset to logged work.')
        }}>Reset this draft</button>
        <button onClick={copy} className="px-4 py-2 rounded-xl bg-[#1B3A2D] text-white text-sm font-semibold">Copy report</button>
      </div>
      <p role="status" className="text-xs text-[#2D7A6B] mt-2 min-h-[16px]">{notice}</p>
    </section>
  )
}

function AISummary({ dateFrom, dateTo, companyId }) {
  const [aiData, setAiData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  async function generate() {
    setLoading(true); setError(''); setAiData(null)
    try {
      const result = await generateWeeklyReport(companyId, dateFrom, dateTo)
      setAiData(result)
    } catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }

  async function copy() {
    if (!aiData?.ai_narrative) return
    const lines = [
      `Weekly Work Report — ${aiData.company_name}`,
      `${dateFrom} to ${dateTo}`,
      `Total: ${formatWorkTime(aiData.total_seconds)} · ${aiData.tickets_completed} completed · ${aiData.tickets_in_progress} in progress`,
      '', aiData.ai_narrative,
    ]
    if (aiData.blocked_tickets?.length) lines.push('', `Blocked: ${aiData.blocked_tickets.map(t => t.title).join(', ')}`)
    await navigator.clipboard.writeText(lines.join('\n'))
    setCopied(true); setTimeout(() => setCopied(false), 2500)
  }

  return (
    <section className="bg-white border border-violet-100 rounded-2xl p-5">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
        <div>
          <h3 className="font-semibold text-violet-800">AI Weekly Summary</h3>
          <p className="text-xs text-[#6B6B6B] mt-1">Generate an AI narrative from your logged tickets and time.</p>
        </div>
        <button onClick={generate} disabled={loading}
          className="px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-50 transition-colors">
          {loading ? 'Generating…' : aiData ? 'Regenerate' : '✨ Generate AI Summary'}
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-red-700 mb-3">{error}</p>}
      {aiData && (
        <div className="space-y-3">
          <div className="flex items-center gap-4 flex-wrap text-sm">
            <span className="font-semibold text-[#2D7A6B]">{formatWorkTime(aiData.total_seconds)}</span>
            <span className="text-[#6B6B6B]">{aiData.tickets_completed} completed · {aiData.tickets_in_progress} in progress{aiData.tickets_blocked > 0 ? ` · ${aiData.tickets_blocked} blocked` : ''}</span>
          </div>
          {aiData.ai_narrative ? (
            <div className="bg-violet-50 border border-violet-100 rounded-xl p-4 text-sm text-[#1A1A1A] whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto">
              {aiData.ai_narrative}
            </div>
          ) : (
            <p className="text-xs text-[#6B6B6B] italic">AI narrative unavailable — check your Groq API key in .env</p>
          )}
          <button onClick={copy}
            className={`${BUTTON} ${copied ? 'text-[#2D7A6B]' : ''}`}>
            {copied ? '✓ Copied!' : 'Copy AI summary'}
          </button>
        </div>
      )}
    </section>
  )
}

function DayEntries({ day, entries }) {
  const rows = entries.filter(entry => entry.date === day.date)
  return (
    <details className="border-t border-[#E8E3DB] py-3">
      <summary className="cursor-pointer text-sm text-[#1A1A1A]">
        <span className="ml-2">{displayDate(day.date)}</span>
        <span className="float-right font-medium tabular-nums">{formatWorkTime(day.seconds)}</span>
      </summary>
      {rows.length === 0 ? <p className="text-xs text-[#6B6B6B] mt-3">No time entries recorded.</p> : (
        <div className="mt-3 space-y-3">
          {rows.map(entry => (
            <div key={`${entry.source}:${entry.id}`} className="flex justify-between items-start gap-3 pl-4">
              <div className="min-w-0">
                <p className="text-sm text-[#1A1A1A] break-words">{entry.title}{entry.ticket_ref && <span className="text-[#2D7A6B]"> [{entry.ticket_ref}]</span>}</p>
                <p className="text-xs text-[#6B6B6B] mt-0.5">{entry.company_name} · {typeLabel(entry.type)} · {entry.source === 'ticket' ? 'Ticket session' : 'Work log'}</p>
                {entry.note && <p className="text-xs text-[#6B6B6B] mt-1 whitespace-pre-wrap break-words">{entry.note}</p>}
              </div>
              <span className="text-sm text-[#1B3A2D] font-medium tabular-nums whitespace-nowrap">{formatWorkTime(entry.seconds)}</span>
            </div>
          ))}
        </div>
      )}
    </details>
  )
}

export default function WorkReports({ companyId }) {
  const today = localDate()
  const [mode, setMode] = useState('month')
  const [anchor, setAnchor] = useState(today)
  const [customStart, setCustomStart] = useState(today.slice(0, 7) + '-01')
  const [customEnd, setCustomEnd] = useState(today)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const range = periodRange(mode, anchor, customStart, customEnd, today)
  const requestKey = `${companyId || 'all'}:${range.start}:${range.end}:${revision}`
  const data = result?.key === requestKey ? result.data : null
  const invalid = !range.start || !range.end || range.end < range.start

  useEffect(() => {
    let active = true
    setError('')
    if (invalid) return
    getWorkReport(range.start, range.end, companyId)
      .then(data => { if (active) setResult({ key: requestKey, data }) })
      .catch(err => { if (active) setError(err.message) })
    return () => { active = false }
  }, [requestKey, invalid, companyId, range.start, range.end])

  function chooseWeek(week) {
    setCustomStart(week.date_from)
    setCustomEnd(week.date_to)
    setMode('custom')
  }

  const currentPeriod = mode !== 'custom' && range.end === today
  const max = data ? Math.max(1, ...data.by_week.map(w => w.seconds)) : 1
  return (
    <div className="space-y-5">
      <section className="bg-white border border-[#E8E3DB] rounded-2xl p-5">
        <div className="flex justify-between items-start gap-3 flex-wrap">
          <div><h2 className="text-xl font-semibold text-[#1B3A2D]">Time &amp; Reports</h2>
            <p className="text-sm text-[#6B6B6B] mt-1">Review your hours, then copy an update for your manager.</p></div>
          <button className={BUTTON} onClick={() => setRevision(r => r + 1)}>Refresh totals</button>
        </div>
        <div className="flex items-end gap-3 flex-wrap my-5">
          <div className="flex gap-1 bg-[#F2EDE4] rounded-xl p-1" aria-label="Reporting period">
            {['month', 'week', 'custom'].map(v => (
              <button key={v} aria-pressed={mode === v} onClick={() => setMode(v)}
                className={`px-3 py-2 rounded-lg text-sm ${mode === v ? 'bg-[#1B3A2D] text-white' : 'text-[#6B6B6B]'}`}>{v.charAt(0).toUpperCase() + v.slice(1)}</button>
            ))}
          </div>
          {mode !== 'custom' ? (
            <div className="flex items-center gap-2 flex-wrap">
              <button aria-label={`Previous ${mode}`} className={BUTTON} onClick={() => setAnchor(shiftPeriod(anchor, mode, -1))}>←</button>
              <input aria-label={mode === 'month' ? 'Report month' : 'Date in report week'} className={INPUT}
                type={mode === 'month' ? 'month' : 'date'} max={mode === 'month' ? today.slice(0, 7) : today}
                value={mode === 'month' ? anchor.slice(0, 7) : anchor}
                onChange={e => { if (e.target.value) setAnchor(mode === 'month' ? e.target.value + '-01' : e.target.value) }} />
              <button aria-label={`Next ${mode}`} className={BUTTON} disabled={currentPeriod} onClick={() => setAnchor(shiftPeriod(anchor, mode, 1))}>→</button>
              <button className={BUTTON} onClick={() => setAnchor(today)}>This {mode}</button>
            </div>
          ) : (
            <div className="flex gap-3 flex-wrap">
              <label className="text-xs text-[#6B6B6B]">From<input aria-label="Report start date" type="date" className={`${INPUT} block mt-1`} value={customStart} onChange={e => setCustomStart(e.target.value)} /></label>
              <label className="text-xs text-[#6B6B6B]">To<input aria-label="Report end date" type="date" className={`${INPUT} block mt-1`} value={customEnd} onChange={e => setCustomEnd(e.target.value)} /></label>
            </div>
          )}
        </div>
        {invalid ? <p role="alert" className="text-sm text-red-700">Choose a start and end date, with the end on or after the start.</p>
          : error ? <p role="alert" className="text-sm text-red-700">{error}</p>
          : !data ? <p role="status" className="text-sm text-[#6B6B6B]">Loading logged time…</p>
          : <>
            <div aria-live="polite">
              <p className="text-xs text-[#6B6B6B]">{data.company_name} · {range.start} — {range.end}{currentPeriod ? ` · ${mode === 'month' ? 'Month' : 'Week'} to date` : ''}</p>
              <p className="text-4xl font-semibold tracking-tight text-[#1B3A2D] tabular-nums mt-2">{formatWorkTime(data.total_seconds)}</p>
              <p className="text-sm text-[#6B6B6B] mt-1">Logged work time</p>
            </div>
            <p className="text-xs text-[#6B6B6B] mt-4">Weeks run Monday–Sunday. Standalone logs use their saved date. Running timers count once stopped.</p>
          </>}
      </section>

      {data && !invalid && !error && <>
        <section className="bg-white border border-[#E8E3DB] rounded-2xl p-5">
          <h3 className="font-semibold text-[#1B3A2D] mb-4">{mode === 'week' ? 'Daily breakdown' : 'Weekly breakdown'}</h3>
          {data.entries.length === 0 && <p className="text-sm text-[#6B6B6B] mb-4">No work time entries recorded for this period.</p>}
          {mode === 'week'
            ? data.by_day.map(day => <DayEntries key={day.date} day={day} entries={data.entries} />)
            : data.by_week.map(week => (
              <details key={week.date_from} className="border-t border-[#E8E3DB] py-4">
                <summary className="cursor-pointer text-sm text-[#1A1A1A]">
                  <span className="ml-2">{displayDate(week.date_from)} – {displayDate(week.date_to)}</span>
                  <span className="float-right font-medium tabular-nums">{formatWorkTime(week.seconds)}</span>
                  <div className="mt-3"><TimeBar values={week.by_type} max={max} /></div>
                </summary>
                <div className="mt-4 sm:pl-4">
                  {data.by_day.filter(d => d.date >= week.date_from && d.date <= week.date_to).map(day => <DayEntries key={day.date} day={day} entries={data.entries} />)}
                  <button className={`${BUTTON} mt-2`} onClick={() => chooseWeek(week)}>Report this date range</button>
                </div>
              </details>
            ))}
          <div className="flex flex-wrap gap-x-5 gap-y-2 mt-3 text-xs text-[#6B6B6B]">
            {Object.entries(data.by_type).sort((a, b) => b[1] - a[1]).map(([type, seconds]) => (
              <span key={type} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: COLORS[type] || COLORS.other }} />{typeLabel(type)} · {formatWorkTime(seconds)}</span>
            ))}
          </div>
        </section>
        {!companyId && data.by_company.length > 0 && <section className="bg-white border border-[#E8E3DB] rounded-2xl p-5">
          <h3 className="font-semibold text-[#1B3A2D] mb-3">By company</h3>
          {data.by_company.map(c => <div key={c.company_id} className="flex justify-between gap-3 py-2 text-sm"><span className="text-[#6B6B6B]">{c.company_name}</span><span className="text-[#1B3A2D] font-medium tabular-nums">{formatWorkTime(c.seconds)}</span></div>)}
        </section>}
        <ReportPreview key={requestKey} data={data} />
        <AISummary dateFrom={range.start} dateTo={range.end} companyId={companyId} />
      </>}
    </div>
  )
}
