import { useEffect, useState } from 'react'
import { getInsightsProfile, getProfileNarrative, getReflections } from './api'

// ── Radar chart (hand-drawn SVG, 6 axes) ────────────────────────────────────

const RADAR_DIMS = [
  { key: 'execution',   label: 'Execution'   },
  { key: 'consistency', label: 'Consistency' },
  { key: 'focus',       label: 'Focus'       },
  { key: 'planning',    label: 'Planning'    },
  { key: 'balance',     label: 'Balance'     },
  { key: 'growth',      label: 'Growth'      },
]

function RadarChart({ scores }) {
  const size = 220
  const cx = size / 2, cy = size / 2, r = 85
  const n = RADAR_DIMS.length

  function polarToXY(angle, radius) {
    return {
      x: cx + radius * Math.sin(angle),
      y: cy - radius * Math.cos(angle),
    }
  }

  const axes = RADAR_DIMS.map((_, i) => {
    const angle = (2 * Math.PI * i) / n
    const outer = polarToXY(angle, r)
    const label = polarToXY(angle, r + 20)
    return { angle, outer, label, dim: RADAR_DIMS[i] }
  })

  // Grid rings at 25%, 50%, 75%, 100%
  const rings = [0.25, 0.5, 0.75, 1].map(pct => {
    const pts = RADAR_DIMS.map((_, i) => {
      const angle = (2 * Math.PI * i) / n
      const { x, y } = polarToXY(angle, r * pct)
      return `${x},${y}`
    }).join(' ')
    return pts
  })

  // Data polygon
  const dataPoints = RADAR_DIMS.map((d, i) => {
    const score = scores[d.key]
    const pct = score != null ? Math.min(score, 100) / 100 : 0
    const angle = (2 * Math.PI * i) / n
    return polarToXY(angle, r * pct)
  })
  const dataPath = dataPoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + 'Z'

  return (
    <svg width={size} height={size} className="overflow-visible">
      {/* Grid rings */}
      {rings.map((pts, i) => (
        <polygon key={i} points={pts} fill="none" stroke="#E8E3DB" strokeWidth="1" />
      ))}
      {/* Axis lines */}
      {axes.map((ax, i) => (
        <line key={i} x1={cx} y1={cy} x2={ax.outer.x} y2={ax.outer.y}
          stroke="#E8E3DB" strokeWidth="1" />
      ))}
      {/* Data polygon */}
      <path d={dataPath} fill="#1B3A2D" fillOpacity="0.25" stroke="#2D7A6B" strokeWidth="2" />
      {/* Data dots */}
      {dataPoints.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="4" fill="#2D7A6B" />
      ))}
      {/* Labels */}
      {axes.map((ax, i) => {
        const score = scores[RADAR_DIMS[i].key]
        return (
          <text key={i} x={ax.label.x} y={ax.label.y}
            textAnchor="middle" dominantBaseline="middle"
            fontSize="9" fontWeight="600" fill="#1A1A1A"
            className="select-none">
            {RADAR_DIMS[i].label}
            {score != null ? ` ${score}` : ' —'}
          </text>
        )
      })}
    </svg>
  )
}

// ── Hour heatmap ─────────────────────────────────────────────────────────────

function HourlyHeatmap({ peakHours, bestHour }) {
  const maxVal = Math.max(...peakHours.map(h => h.completions + h.focus_seconds / 1800), 1)

  function color(h) {
    const val = (h.completions + h.focus_seconds / 1800) / maxVal
    if (val < 0.1) return '#F2EDE4'
    if (val < 0.3) return '#c8dcd6'
    if (val < 0.55) return '#8bbdb4'
    if (val < 0.8) return '#4d9e93'
    return '#1B3A2D'
  }

  return (
    <div>
      <div className="flex items-end gap-0.5">
        {peakHours.map(h => (
          <div key={h.hour} className="flex flex-col items-center gap-0.5 flex-1">
            <div
              className="w-full rounded-sm transition-all"
              style={{
                backgroundColor: color(h),
                height: `${Math.max(6, ((h.completions + h.focus_seconds / 1800) / maxVal) * 48)}px`,
                outline: h.hour === bestHour ? '2px solid #E8C334' : 'none',
              }}
              title={`${h.hour}:00 — ${h.completions} completions, ${Math.round(h.focus_seconds / 60)}min focus`}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-between mt-1">
        {[0, 6, 12, 18, 23].map(h => (
          <span key={h} className="text-[9px] text-[#b5a08a]">{h}:00</span>
        ))}
      </div>
      <p className="text-[11px] text-[#6B6B6B] mt-1">
        Peak: <span className="font-bold text-[#1B3A2D]">{bestHour}:00</span>
      </p>
    </div>
  )
}

// ── Day-of-week bars ──────────────────────────────────────────────────────────

function DayBars({ peakDays, bestDay }) {
  const maxVal = Math.max(...peakDays.map(d => d.completions), 1)
  return (
    <div className="flex items-end gap-1.5">
      {peakDays.map(d => (
        <div key={d.day} className="flex flex-col items-center gap-1 flex-1">
          <div
            className="w-full rounded-sm transition-all"
            style={{
              backgroundColor: d.day === bestDay ? '#1B3A2D' : '#c8dcd6',
              height: `${Math.max(4, (d.completions / maxVal) * 40)}px`,
            }}
            title={`${d.day}: ${d.completions} completions`}
          />
          <span className={`text-[9px] font-medium ${d.day === bestDay ? 'text-[#1B3A2D]' : 'text-[#b5a08a]'}`}>
            {d.day}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Reflection history strip ──────────────────────────────────────────────────

function ReflectionStrip({ reflections }) {
  if (!reflections.length) return null
  const ENERGY_DOT = ['', 'bg-red-300', 'bg-amber-300', 'bg-amber-400', 'bg-emerald-400', 'bg-emerald-500']
  return (
    <div className="space-y-2">
      {reflections.slice(0, 4).map(r => (
        <div key={r.id} className="flex items-start gap-3 py-2.5 px-3 bg-[#F9F6F1] rounded-xl border border-[#E8E3DB]">
          <div className="flex flex-col items-center gap-1 flex-shrink-0">
            <span className={`w-2.5 h-2.5 rounded-full ${r.energy_rating ? ENERGY_DOT[r.energy_rating] : 'bg-[#E8E3DB]'}`} title={`Energy: ${r.energy_rating}/5`} />
            <span className={`w-2.5 h-2.5 rounded-full ${r.values_alignment ? ENERGY_DOT[r.values_alignment] : 'bg-[#E8E3DB]'}`} title={`Values: ${r.values_alignment}/5`} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-[#b5a08a] font-medium mb-0.5">{r.period_start} · {r.period_type}</p>
            {r.do_differently && (
              <p className="text-xs text-[#1A1A1A] truncate">"{r.do_differently}"</p>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Main Profile Page ────────────────────────────────────────────────────────

export default function ProfilePage() {
  const [profile, setProfile] = useState(null)
  const [reflections, setReflections] = useState([])
  const [narrative, setNarrative] = useState(null)
  const [narrativeLoading, setNarrativeLoading] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([getInsightsProfile(), getReflections(8)])
      .then(([p, r]) => { setProfile(p); setReflections(r) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  async function handleNarrative() {
    if (!profile) return
    setNarrativeLoading(true)
    try {
      const { narrative: n } = await getProfileNarrative(profile)
      setNarrative(n)
    } catch (err) { alert(err.message) }
    finally { setNarrativeLoading(false) }
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-[#6B6B6B]">Analyzing your patterns…</div>

  const scores = profile?.dimension_scores || {}
  const peakHours = profile?.peak_hours || []
  const peakDays = profile?.peak_days || []
  const bestHour = profile?.best_hour ?? 9
  const bestDay = profile?.best_day ?? ''
  const affinity = profile?.task_type_affinity || []
  const procrastination = profile?.procrastination || {}
  const eisenhower = profile?.eisenhower || {}

  const QUAD_COLORS = {
    q1: 'bg-amber-50 border-amber-200 text-amber-700',
    q2: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    q3: 'bg-red-50 border-red-200 text-red-600',
    q4: 'bg-[#F9F6F1] border-[#E8E3DB] text-[#6B6B6B]',
  }
  const QUAD_LABELS = {
    q1: 'Urgent + Important',
    q2: 'Deep Work ✦',
    q3: 'Urgent, Low Value',
    q4: 'Low Priority',
  }

  const FEELING_COLOR = { loved: '#E8C334', flow: '#2D7A6B', grind: '#b5a08a', unrated: '#E8E3DB' }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[11px] font-bold text-[#6B6B6B] uppercase tracking-widest mb-1">بَصِيرَة</p>
          <h1 className="text-3xl font-bold text-[#1A1A1A]">Your Profile</h1>
          <p className="text-sm text-[#6B6B6B] mt-0.5">Based on {profile?.data_window_days || 90} days of behavior</p>
        </div>
        <button onClick={handleNarrative} disabled={narrativeLoading}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-violet-200 text-violet-700 bg-violet-50 text-sm font-medium hover:bg-violet-100 transition-colors disabled:opacity-50">
          {narrativeLoading ? '…' : '✨ AI Narrative'}
        </button>
      </div>

      {/* AI Narrative */}
      {narrative && (
        <div className="bg-violet-50 border border-violet-100 rounded-2xl p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex gap-3">
              <span className="text-2xl flex-shrink-0">✨</span>
              <div>
                <p className="text-xs font-bold text-violet-700 uppercase tracking-wide mb-2">Basira's Reflection</p>
                <p className="text-sm text-violet-900 leading-relaxed">{narrative}</p>
              </div>
            </div>
            <button onClick={() => setNarrative(null)} className="text-violet-300 hover:text-violet-500 flex-shrink-0">✕</button>
          </div>
        </div>
      )}

      {/* Row 1: Radar + Performance Window */}
      <div className="grid grid-cols-2 gap-4">
        {/* Radar */}
        <div className="bg-white border border-[#E8E3DB] rounded-2xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
          <p className="text-[11px] font-bold text-[#6B6B6B] uppercase tracking-widest mb-4">Performance Signature</p>
          <div className="flex justify-center">
            <RadarChart scores={scores} />
          </div>
          <div className="grid grid-cols-3 gap-1.5 mt-3">
            {RADAR_DIMS.map(d => (
              <div key={d.key} className="text-center">
                <p className="text-[9px] text-[#b5a08a] uppercase tracking-wide">{d.label}</p>
                <p className="text-sm font-bold text-[#1A1A1A]">
                  {scores[d.key] != null ? `${scores[d.key]}%` : '—'}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Performance Window */}
        <div className="bg-white border border-[#E8E3DB] rounded-2xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.06)] space-y-5">
          <div>
            <p className="text-[11px] font-bold text-[#6B6B6B] uppercase tracking-widest mb-3">Peak Hours</p>
            {peakHours.length > 0
              ? <HourlyHeatmap peakHours={peakHours} bestHour={bestHour} />
              : <p className="text-xs text-[#b5a08a]">Complete tasks to unlock your peak hour map.</p>
            }
          </div>
          <div>
            <p className="text-[11px] font-bold text-[#6B6B6B] uppercase tracking-widest mb-3">Best Day of Week</p>
            {peakDays.length > 0
              ? <DayBars peakDays={peakDays} bestDay={bestDay} />
              : <p className="text-xs text-[#b5a08a]">More data needed.</p>
            }
          </div>
        </div>
      </div>

      {/* Row 2: Strength Signals + Friction Zones */}
      <div className="grid grid-cols-2 gap-4">
        {/* Strength Signals */}
        <div className="bg-white border border-[#E8E3DB] rounded-2xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
          <p className="text-[11px] font-bold text-[#6B6B6B] uppercase tracking-widest mb-3">Strength Signals</p>
          {affinity.length > 0 ? (
            <div className="space-y-2">
              {affinity.slice(0, 3).map((a, i) => (
                <div key={i} className="flex items-center gap-3 py-2 px-3 rounded-xl"
                  style={{ backgroundColor: a.feeling_label === 'loved' ? '#FFFBEB' : a.feeling_label === 'flow' ? '#f0faf8' : '#F9F6F1' }}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[#1A1A1A] capitalize">{a.goal_type || 'Tasks'}</p>
                    <p className="text-[11px] text-[#6B6B6B]">{a.completions} completions</p>
                  </div>
                  <span
                    className="text-[10px] px-2 py-0.5 rounded-lg font-bold uppercase tracking-wide border"
                    style={{ color: FEELING_COLOR[a.feeling_label] || '#b5a08a', borderColor: FEELING_COLOR[a.feeling_label] || '#E8E3DB', backgroundColor: 'transparent' }}>
                    {a.feeling_label}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-[#b5a08a]">Complete tasks and rate your feelings to see strength signals.</p>
          )}
        </div>

        {/* Friction Zones */}
        <div className="bg-white border border-[#E8E3DB] rounded-2xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
          <p className="text-[11px] font-bold text-[#6B6B6B] uppercase tracking-widest mb-3">Friction Zones</p>
          {procrastination.reason_distribution?.length > 0 ? (
            <div className="space-y-2">
              {procrastination.reason_distribution.slice(0, 3).map((r, i) => (
                <div key={i} className="space-y-0.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-[#1A1A1A] capitalize">{r.reason?.replace(/_/g, ' ')}</span>
                    <span className="text-[11px] text-[#6B6B6B]">{r.pct}%</span>
                  </div>
                  <div className="h-1.5 bg-[#F2EDE4] rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-amber-400 transition-all" style={{ width: `${r.pct}%` }} />
                  </div>
                </div>
              ))}
              {procrastination.most_deferred_tasks?.length > 0 && (
                <div className="mt-3 pt-3 border-t border-[#F2EDE4]">
                  <p className="text-[10px] font-bold text-[#b5a08a] uppercase tracking-wide mb-1.5">Most Deferred</p>
                  {procrastination.most_deferred_tasks.slice(0, 3).map((t, i) => (
                    <div key={i} className="flex items-center justify-between py-0.5">
                      <span className="text-xs text-[#1A1A1A] truncate flex-1 mr-2">{t.title}</span>
                      <span className="text-[10px] text-amber-500 font-bold flex-shrink-0">{t.defer_count}×</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-[#b5a08a]">Defer tasks and give a reason to unlock your procrastination pattern.</p>
          )}
        </div>
      </div>

      {/* Eisenhower Quadrant */}
      <div className="bg-white border border-[#E8E3DB] rounded-2xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
        <p className="text-[11px] font-bold text-[#6B6B6B] uppercase tracking-widest mb-4">How You Spend Your Energy (Last 30 Days)</p>
        {Object.keys(eisenhower).filter(k => k !== 'labels').length > 0 ? (
          <div className="grid grid-cols-2 gap-2 max-w-sm mx-auto">
            {['q1', 'q2', 'q3', 'q4'].map(q => (
              <div key={q} className={`rounded-xl border p-3 ${QUAD_COLORS[q]}`}>
                <p className="text-[10px] font-bold uppercase tracking-wide mb-1">{QUAD_LABELS[q]}</p>
                <p className="text-2xl font-bold">{eisenhower[q]?.count || 0}</p>
                <p className="text-[11px] opacity-70">{eisenhower[q]?.pct || 0}% of tasks</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-[#b5a08a] text-center py-4">Tag tasks as urgent/important to see your Eisenhower breakdown.</p>
        )}
        <p className="text-[11px] text-[#6B6B6B] text-center mt-3">
          ✦ Deep Work (Q2) is the most valuable quadrant — important but not urgent.
        </p>
      </div>

      {/* Recent Reflections */}
      {reflections.length > 0 && (
        <div>
          <div className="flex items-center gap-3 mb-3">
            <p className="text-[11px] font-bold text-[#1A1A1A] uppercase tracking-widest whitespace-nowrap">Recent Reflections</p>
            <span className="flex-1 border-t border-[#E8E3DB]" />
          </div>
          <ReflectionStrip reflections={reflections} />
        </div>
      )}
    </div>
  )
}
