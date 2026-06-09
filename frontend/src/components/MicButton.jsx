import { useCallback, useRef, useState } from 'react'
import { useSpeechInput } from '../hooks/useSpeechInput'

/**
 * MicButton — drop-in voice input button for any text field.
 *
 * Props:
 *   value      current string value of the field
 *   onChange   setter (string) => void
 *   className  extra classes for positioning (default: inline)
 *   lang       BCP-47 locale string (default 'en-US')
 *
 * While recording: appends live interim transcript in [brackets] after the
 * current text so the user can see transcription in real time.
 * On each final chunk: strips the interim placeholder and appends the real text.
 */
export default function MicButton({ value, onChange, className = '', lang = 'en-US' }) {
  const [interim, setInterim] = useState('')
  const baseRef = useRef('')   // value at the moment recording started

  const handleResult = useCallback((finalChunk) => {
    // Append final chunk (add a space separator if needed)
    const base = baseRef.current
    const sep = base && !base.endsWith(' ') && !base.endsWith('\n') ? ' ' : ''
    const next = base + sep + finalChunk
    baseRef.current = next
    setInterim('')
    onChange(next)
  }, [onChange])

  const handleInterim = useCallback((text) => {
    setInterim(text)
    // Show interim inline so user sees real-time transcription
    const base = baseRef.current
    const sep = base && !base.endsWith(' ') && !base.endsWith('\n') ? ' ' : ''
    onChange(base + sep + text)
  }, [onChange])

  const { listening, toggle, supported } = useSpeechInput({
    onResult: handleResult,
    onInterim: handleInterim,
    lang,
  })

  if (!supported) return null

  function handleClick(e) {
    e.preventDefault()
    e.stopPropagation()
    if (!listening) {
      // Snapshot the current value as the base before we start appending
      baseRef.current = value || ''
      setInterim('')
    } else {
      // Stopping — clear any dangling interim text
      setInterim('')
      onChange(baseRef.current)
    }
    toggle()
  }

  return (
    <button
      type="button"
      onMouseDown={e => e.preventDefault()} // prevent textarea blur
      onClick={handleClick}
      title={listening ? 'Stop recording' : 'Voice input'}
      className={`flex items-center justify-center rounded-xl transition-all flex-shrink-0 ${
        listening
          ? 'bg-red-50 text-red-500 border border-red-200 animate-pulse shadow-sm'
          : 'text-[#b5a08a] hover:text-[#2D7A6B] hover:bg-[#F2EDE4] border border-transparent'
      } ${className}`}
    >
      {listening ? (
        <span className="flex items-center gap-1 px-2 py-1 text-xs font-semibold">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
          Stop
        </span>
      ) : (
        <span className="text-base px-1.5 py-1">🎤</span>
      )}
    </button>
  )
}
