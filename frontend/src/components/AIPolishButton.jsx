import { useEffect, useRef, useState } from 'react'
import { polishText } from '../api'

/**
 * AIPolishButton — drop-in AI writing assistant for any text field.
 *
 * Props:
 *   value      current string value of the field
 *   onChange   setter (string) => void
 *   context    hint for the AI prompt: 'journal' | 'comment' | 'intention' |
 *              'reflection' | 'wins' | 'improve' | 'gratitude' | 'default'
 *   className  extra classes
 *
 * Behaviour:
 *   - Hidden when the field is empty
 *   - ✨ Polish: sends text to AI, replaces field value with polished version
 *   - ↩ Original: one-click revert to the raw text before polishing
 *   - If the user edits the polished text, the revert button stays until they
 *     manually dismiss it or empty the field
 */
export default function AIPolishButton({ value, onChange, context = 'default', className = '' }) {
  const [polishing, setPolishing] = useState(false)
  const [original, setOriginal]   = useState(null)   // null = not yet polished
  const [error, setError]         = useState(null)

  // If value is cleared externally, reset state
  useEffect(() => {
    if (!value) { setOriginal(null); setError(null) }
  }, [value])

  const isPolished = original !== null
  const hasText    = value && value.trim().length > 3

  if (!hasText && !isPolished) return null

  async function handlePolish(e) {
    e.preventDefault()
    e.stopPropagation()
    if (!value.trim()) return
    setPolishing(true)
    setError(null)
    try {
      setOriginal(value)           // snapshot before we overwrite
      const { polished, error: err } = await polishText(value, context)
      if (err) { setError(err); setOriginal(null); return }
      onChange(polished)
    } catch {
      setError('AI unavailable')
      setOriginal(null)
    } finally {
      setPolishing(false)
    }
  }

  function handleRevert(e) {
    e.preventDefault()
    e.stopPropagation()
    onChange(original)
    setOriginal(null)
    setError(null)
  }

  return (
    <div className={`flex items-center gap-1 ${className}`}>
      {error && (
        <span className="text-[10px] text-red-400 px-1">{error}</span>
      )}

      {/* Revert button — visible after polishing */}
      {isPolished && (
        <button
          type="button"
          onMouseDown={e => e.preventDefault()}
          onClick={handleRevert}
          title="Revert to original text"
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium text-amber-600 bg-amber-50 border border-amber-200 hover:bg-amber-100 transition-colors flex-shrink-0"
        >
          ↩ Original
        </button>
      )}

      {/* Polish button */}
      <button
        type="button"
        onMouseDown={e => e.preventDefault()}
        onClick={handlePolish}
        disabled={polishing || !hasText}
        title={isPolished ? 'Re-polish with AI' : 'Polish with AI'}
        className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium transition-colors flex-shrink-0 border ${
          polishing
            ? 'bg-violet-50 text-violet-400 border-violet-200 cursor-wait'
            : isPolished
            ? 'bg-violet-100 text-violet-700 border-violet-200 hover:bg-violet-200'
            : 'bg-violet-50 text-violet-600 border-violet-200 hover:bg-violet-100'
        } disabled:opacity-40`}
      >
        {polishing ? (
          <><span className="animate-spin inline-block">✦</span><span>Polishing…</span></>
        ) : (
          <><span>✨</span><span>{isPolished ? 'Re-polish' : 'Polish'}</span></>
        )}
      </button>
    </div>
  )
}
