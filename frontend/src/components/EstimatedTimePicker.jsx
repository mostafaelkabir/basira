const PRESETS = [
  { label: '15m', value: 15 },
  { label: '30m', value: 30 },
  { label: '45m', value: 45 },
  { label: '1h',  value: 60 },
  { label: '1.5h', value: 90 },
  { label: '2h',  value: 120 },
  { label: '3h',  value: 180 },
]

export function formatDuration(minutes) {
  if (!minutes) return null
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

export default function EstimatedTimePicker({ value, onChange }) {
  return (
    <div>
      <label className="text-sm font-medium text-sand-700">
        Estimated time <span className="text-sand-400 font-normal">(optional)</span>
      </label>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {PRESETS.map(p => (
          <button
            key={p.value}
            type="button"
            onClick={() => onChange(value === p.value ? null : p.value)}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors ${
              value === p.value
                ? 'bg-teal-600 text-white border-teal-600'
                : 'border-sand-200 text-sand-600 hover:border-teal-300 hover:text-teal-600'
            }`}
          >
            {p.label}
          </button>
        ))}
        <input
          type="number"
          min="1"
          max="480"
          placeholder="custom min"
          value={value && !PRESETS.find(p => p.value === value) ? value : ''}
          onChange={e => {
            const v = parseInt(e.target.value)
            onChange(isNaN(v) || v <= 0 ? null : v)
          }}
          className="w-24 px-2 py-1.5 rounded-xl text-xs border border-sand-200 focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white text-sand-700 placeholder:text-sand-300"
        />
      </div>
      {value && (
        <p className="text-xs text-teal-600 mt-1">
          ⏱ {formatDuration(value)} estimated
        </p>
      )}
    </div>
  )
}
