import { useCallback, useRef, useState } from 'react'

/**
 * useSpeechInput — wraps the Web Speech API for voice-to-text input.
 *
 * Usage:
 *   const { listening, toggle, supported } = useSpeechInput({
 *     onResult: (text) => setValue(prev => prev + text),
 *   })
 *
 * @param {function} onResult   Called with the final committed transcript chunk
 * @param {function} onInterim  Called with interim (in-progress) transcript (optional)
 * @param {string}   lang       BCP-47 locale, e.g. 'en-US' or 'ar-SA'
 */
export function useSpeechInput({ onResult, onInterim, lang = 'en-US' } = {}) {
  const [listening, setListening] = useState(false)
  const recognitionRef = useRef(null)
  const interimRef = useRef('')

  const supported =
    typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)

  const stop = useCallback(() => {
    recognitionRef.current?.stop()
    recognitionRef.current = null
    setListening(false)
    interimRef.current = ''
  }, [])

  const start = useCallback(() => {
    if (!supported) return
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    const recognition = new SR()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = lang
    recognition.maxAlternatives = 1

    recognition.onresult = (e) => {
      let interim = ''
      let finalChunk = ''

      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript
        if (e.results[i].isFinal) {
          finalChunk += t
        } else {
          interim += t
        }
      }

      if (finalChunk) {
        onResult?.(finalChunk)
        interimRef.current = ''
      }
      if (interim !== interimRef.current) {
        interimRef.current = interim
        onInterim?.(interim)
      }
    }

    recognition.onerror = (e) => {
      if (e.error !== 'no-speech') console.warn('Speech error:', e.error)
      stop()
    }

    recognition.onend = () => {
      // Auto-restart if still supposed to be listening (handles Chrome's 60s limit)
      if (recognitionRef.current) {
        try { recognition.start() } catch { stop() }
      } else {
        setListening(false)
      }
    }

    recognitionRef.current = recognition
    recognition.start()
    setListening(true)
  }, [supported, lang, onResult, onInterim, stop])

  const toggle = useCallback(() => {
    listening ? stop() : start()
  }, [listening, start, stop])

  return { listening, toggle, stop, supported }
}
