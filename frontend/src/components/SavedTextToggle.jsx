import { useState } from 'react'

/**
 * SavedTextToggle — wraps any saved text with AI Polish + Original toggle.
 *
 * Props:
 *   text          current display text
 *   original      original text (null if not yet polished)
 *   onPolish      async () => updatedRecord  — calls backend to polish + save
 *   onRestore     async () => updatedRecord  — calls backend to restore original
 *   children      render prop: (displayText) => ReactNode
 *   className     wrapper class
 *
 * Usage:
 *   <SavedTextToggle text={c.body} original={c.body_original}
 *     onPolish={() => polishTicketComment(c.id).then(onUpdate)}
 *     onRestore={() => restoreTicketComment(c.id).then(onUpdate)}>
 *     {(text) => <p>{text}</p>}
 *   </SavedTextToggle>
 */
export default function SavedTextToggle({ text, original, onPolish, onRestore, children, className = '' }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  // viewingOriginal: user is temporarily viewing the original while polished is saved
  const [viewingOriginal, setViewingOriginal] = useState(false)

  const isPolished = !!original          // has been polished before (original stored)
  const displayText = viewingOriginal ? original : text

  async function handlePolish(e) {
    e.stopPropagation()
    setBusy(true); setError(null)
    try {
      await onPolish()
      setViewingOriginal(false)
    } catch (err) { setError('AI unavailable') }
    finally { setBusy(false) }
  }

  async function handleRestore(e) {
    e.stopPropagation()
    setBusy(true); setError(null)
    try {
      await onRestore()
      setViewingOriginal(false)
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  return (
    <div className={`group relative ${className}`}>
      {/* Text content */}
      {children(displayText)}

      {/* Action bar — appears on hover */}
      <div className="flex items-center gap-1.5 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
        {error && <span className="text-[10px] text-red-400">{error}</span>}

        {/* Toggle: Original ↔ AI */}
        {isPolished && (
          <button
            onClick={e => { e.stopPropagation(); setViewingOriginal(v => !v) }}
            className={`text-[10px] px-2 py-0.5 rounded-md border font-medium transition-colors ${
              viewingOriginal
                ? 'bg-amber-50 border-amber-200 text-amber-600 hover:bg-amber-100'
                : 'bg-violet-50 border-violet-200 text-violet-600 hover:bg-violet-100'
            }`}>
            {viewingOriginal ? '✨ Show AI' : '↩ Original'}
          </button>
        )}

        {/* Restore original permanently */}
        {isPolished && !viewingOriginal && (
          <button
            onClick={handleRestore}
            disabled={busy}
            className="text-[10px] px-2 py-0.5 rounded-md border border-[#E8E3DB] text-[#b5a08a] hover:text-red-400 hover:border-red-200 transition-colors disabled:opacity-40"
            title="Restore original and discard polish">
            {busy ? '…' : 'Discard polish'}
          </button>
        )}

        {/* Polish / Re-polish */}
        <button
          onClick={handlePolish}
          disabled={busy || !text?.trim()}
          className={`text-[10px] px-2 py-0.5 rounded-md border font-medium transition-colors disabled:opacity-40 ${
            busy
              ? 'bg-violet-50 border-violet-200 text-violet-400'
              : 'bg-violet-50 border-violet-200 text-violet-600 hover:bg-violet-100'
          }`}>
          {busy ? <><span className="inline-block animate-spin">✦</span> Refining…</> : isPolished ? '✨ Re-refine' : '✨ Refine with AI'}
        </button>
      </div>
    </div>
  )
}
