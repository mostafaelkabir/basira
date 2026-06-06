import { useState } from 'react'
import Modal from './Modal'

const TIME_PRESETS = [
  { label: '15m',  value: 15 },
  { label: '30m',  value: 30 },
  { label: '45m',  value: 45 },
  { label: '1h',   value: 60 },
  { label: '1.5h', value: 90 },
  { label: '2h',   value: 120 },
  { label: '3h',   value: 180 },
]

function fmtMins(m) {
  if (!m) return ''
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`
}

export default function TimeLogModal({ task, onConfirm, onClose }) {
  const [selected, setSelected] = useState(null)
  const [custom, setCustom]     = useState('')

  const minutes = selected ?? (custom ? parseInt(custom) || null : null)

  return (
    <Modal title="Time spent?" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-sand-500">
          No timer was logged for{' '}
          <span className="font-medium text-sand-700">"{task.title}"</span>.
          How long did it take?
        </p>

        {/* Preset chips */}
        <div className="flex flex-wrap gap-2">
          {TIME_PRESETS.map(p => (
            <button
              key={p.value}
              type="button"
              onClick={() => { setSelected(selected === p.value ? null : p.value); setCustom('') }}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors ${
                selected === p.value
                  ? 'bg-teal-600 text-white border-teal-600'
                  : 'border-sand-200 text-sand-600 hover:border-teal-300 hover:text-teal-600'
              }`}>
              {p.label}
            </button>
          ))}
          <input
            type="number"
            min="1"
            max="720"
            placeholder="custom min"
            value={custom}
            onChange={e => { setCustom(e.target.value); setSelected(null) }}
            className="w-24 px-2 py-1.5 rounded-xl text-xs border border-sand-200 focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white placeholder:text-sand-300"
          />
        </div>

        {minutes && (
          <p className="text-xs text-teal-600">⏱ {fmtMins(minutes)} will be logged</p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={() => onConfirm(null)}
            className="px-4 py-2 text-sm text-sand-400 hover:text-sand-600 transition-colors">
            Skip
          </button>
          <button
            onClick={() => onConfirm(minutes)}
            disabled={!minutes}
            className="bg-teal-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-teal-700 disabled:opacity-40 transition-colors">
            Log &amp; Complete
          </button>
        </div>
      </div>
    </Modal>
  )
}
