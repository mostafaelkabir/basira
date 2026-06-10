import { useEffect, useState } from 'react'

const OPTIONS = [
  { value: 'grind', emoji: '😤', label: 'Grind' },
  { value: 'flow',  emoji: '🙂', label: 'Flow'  },
  { value: 'loved', emoji: '✦',  label: 'Loved it' },
]

/**
 * PostTaskFeedback — a small 2.5s popover after a task is marked done.
 * Props:
 *   taskTitle   string
 *   onSelect    (feeling: string) => void
 *   onDismiss   () => void   — auto-called after timeout or selection
 */
export default function PostTaskFeedback({ taskTitle, onSelect, onDismiss }) {
  const [hovering, setHovering] = useState(false)

  useEffect(() => {
    if (hovering) return  // pause auto-dismiss while hovering
    const t = setTimeout(onDismiss, 2500)
    return () => clearTimeout(t)
  }, [hovering, onDismiss])

  function pick(value) {
    onSelect(value)
    onDismiss()
  }

  return (
    <div
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      className="flex items-center gap-2 px-3 py-2 bg-white border border-[#E8E3DB] rounded-2xl shadow-[0_2px_12px_rgba(0,0,0,0.10)] animate-in fade-in slide-in-from-bottom-1 duration-200">
      <span className="text-[11px] text-[#6B6B6B] font-medium whitespace-nowrap">How did that feel?</span>
      <div className="flex gap-1">
        {OPTIONS.map(o => (
          <button key={o.value} onClick={() => pick(o.value)}
            className="flex flex-col items-center px-2 py-1 rounded-xl hover:bg-[#F2EDE4] transition-colors group">
            <span className="text-base">{o.emoji}</span>
            <span className="text-[9px] text-[#b5a08a] group-hover:text-[#1A1A1A] transition-colors">{o.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
