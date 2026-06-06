import { useEffect } from 'react'

export default function Modal({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 bg-sand-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#fffef9] rounded-2xl shadow-xl border border-sand-200 w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-sand-100">
          <h2 className="font-semibold text-sand-800">{title}</h2>
          <button
            onClick={onClose}
            className="text-sand-400 hover:text-sand-600 w-7 h-7 flex items-center justify-center rounded-full hover:bg-sand-100 transition-colors"
          >
            ✕
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  )
}
