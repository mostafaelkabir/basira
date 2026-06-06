import { useEffect, useRef, useState } from 'react'
import { addComment, deleteComment, taskAiQuery, uploadProofFile, uploadProofImage } from '../api'

const FILE_EXT_ICONS = { pdf: '📄', doc: '📝', docx: '📝', txt: '📃', md: '📃', pages: '📝', rtf: '📃', csv: '📊', xlsx: '📊', xls: '📊' }
function extIcon(name) { const ext = (name || '').split('.').pop().toLowerCase(); return FILE_EXT_ICONS[ext] || '📎' }

function formatTime(iso) {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// Renders a single comment based on its type
export function CommentBubble({ comment, onDelete }) {
  const isImage = comment.type === 'image'
  const isFile  = comment.type === 'file'
  const isAI    = comment.type === 'ai'

  let fileUrl = comment.content, fileName = comment.content.split('/').pop()
  if (isFile) {
    try { const p = JSON.parse(comment.content); fileUrl = p.url; fileName = p.name } catch {}
  }

  return (
    <div className="flex items-start gap-2 group">
      <div className="flex-1 min-w-0">
        {isAI ? (
          <div className="bg-violet-50 border border-violet-100 rounded-xl px-3 py-2">
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="text-xs">✨</span>
              <span className="text-[10px] font-semibold text-violet-500 uppercase tracking-wide">AI</span>
            </div>
            <p className="text-sm text-sand-700 leading-relaxed whitespace-pre-wrap">{comment.content}</p>
            <p className="text-[10px] text-sand-400 mt-1.5">{formatTime(comment.created_at)}</p>
          </div>
        ) : isImage ? (
          <div className="bg-sand-50 rounded-xl p-2">
            <img src={comment.content} alt="Comment" className="max-h-48 rounded-lg object-contain w-full" />
            <p className="text-[10px] text-sand-400 mt-1.5 px-1">{formatTime(comment.created_at)}</p>
          </div>
        ) : isFile ? (
          <div className="bg-sand-50 rounded-xl px-3 py-2">
            <a href={fileUrl} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 hover:text-teal-600 transition-colors group/file">
              <span className="text-xl flex-shrink-0">{extIcon(fileName)}</span>
              <span className="text-sm text-teal-600 group-hover/file:underline truncate flex-1">{fileName}</span>
              <span className="text-sand-400 text-xs flex-shrink-0">↗</span>
            </a>
            <p className="text-[10px] text-sand-400 mt-1">{formatTime(comment.created_at)}</p>
          </div>
        ) : (
          <div className="bg-sand-50 rounded-xl px-3 py-2">
            <p className="text-sm text-sand-700 leading-relaxed whitespace-pre-wrap">{comment.content}</p>
            <p className="text-[10px] text-sand-400 mt-1">{formatTime(comment.created_at)}</p>
          </div>
        )}
      </div>
      <button onClick={() => onDelete(comment.id)}
        className="opacity-0 group-hover:opacity-100 text-sand-300 hover:text-terra-400 transition-all text-xs mt-2 flex-shrink-0">✕</button>
    </div>
  )
}

// Full comment section: list + composer
export function ActivityComments({ task, onRefresh }) {
  const [text, setText]           = useState('')
  const [attachment, setAttachment] = useState(null) // { type, file, preview, name }
  const [submitting, setSubmitting] = useState(false)
  const [aiMode, setAiMode]       = useState(false)
  const fileRef  = useRef(null)
  const imageRef = useRef(null)
  const inputRef = useRef(null)

  // Paste listener — captures images from clipboard
  useEffect(() => {
    function onPaste(e) {
      const item = Array.from(e.clipboardData?.items || []).find(i => i.type.startsWith('image/'))
      if (!item) return
      e.preventDefault()
      const file = item.getAsFile()
      setAttachment({ type: 'image', file, preview: URL.createObjectURL(file) })
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])

  function pickImage(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setAttachment({ type: 'image', file, preview: URL.createObjectURL(file) })
    e.target.value = ''
  }

  function pickFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setAttachment({ type: 'file', file, name: file.name })
    e.target.value = ''
  }

  function clearAttachment() { setAttachment(null) }

  async function handleSubmit(e) {
    e?.preventDefault()
    if (!attachment && !text.trim()) return
    setSubmitting(true)
    try {
      if (aiMode) {
        await taskAiQuery(task.id, text.trim())
        setText('')
        onRefresh()
      } else if (attachment?.type === 'image') {
        const { url } = await uploadProofImage(attachment.file)
        await addComment(task.id, { type: 'image', content: url })
        setText('')
        setAttachment(null)
        onRefresh()
      } else if (attachment?.type === 'file') {
        const { url, name } = await uploadProofFile(attachment.file)
        await addComment(task.id, { type: 'file', content: JSON.stringify({ url, name }) })
        setText('')
        setAttachment(null)
        onRefresh()
      } else {
        await addComment(task.id, { type: 'text', content: text.trim() })
        setText('')
        setAttachment(null)
        onRefresh()
      }
    } catch (err) { alert(err.message) }
    finally { setSubmitting(false) }
  }

  async function handleDelete(commentId) {
    try { await deleteComment(commentId); onRefresh() }
    catch (err) { alert(err.message) }
  }

  const canSubmit = !submitting && (attachment !== null || text.trim().length > 0)

  return (
    <div className="space-y-2">
      {task.comments?.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-semibold text-sand-400 uppercase tracking-widest">Comments</p>
          {task.comments.map(c => (
            <CommentBubble key={c.id} comment={c} onDelete={handleDelete} />
          ))}
        </div>
      )}

      {/* Attachment preview */}
      {attachment && (
        <div className="relative">
          {attachment.type === 'image' ? (
            <div className="relative rounded-xl overflow-hidden border border-sand-200">
              <img src={attachment.preview} alt="" className="max-h-40 w-full object-contain bg-sand-50" />
              <button onClick={clearAttachment}
                className="absolute top-1.5 right-1.5 bg-white/90 rounded-full w-5 h-5 flex items-center justify-center text-xs shadow hover:text-terra-400 transition-colors">✕</button>
            </div>
          ) : (
            <div className="flex items-center gap-2 bg-sand-50 border border-sand-200 rounded-xl px-3 py-2">
              <span className="text-lg">{extIcon(attachment.name)}</span>
              <span className="text-sm text-sand-700 flex-1 truncate">{attachment.name}</span>
              <button onClick={clearAttachment} className="text-sand-300 hover:text-terra-400 text-xs">✕</button>
            </div>
          )}
        </div>
      )}

      {/* Mode toggle */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => { setAiMode(false); setAttachment(null); setTimeout(() => inputRef.current?.focus(), 0) }}
          className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${!aiMode ? 'bg-sand-100 text-sand-700' : 'text-sand-400 hover:text-sand-600'}`}>
          Note
        </button>
        <button
          type="button"
          onClick={() => { setAiMode(true); setAttachment(null); setTimeout(() => inputRef.current?.focus(), 0) }}
          className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors flex items-center gap-1 ${aiMode ? 'bg-violet-100 text-violet-700' : 'text-sand-400 hover:text-sand-600'}`}>
          <span>✨</span> Ask AI
        </button>
      </div>

      {/* Compose bar */}
      <div className="flex items-end gap-1.5">
        <input ref={inputRef} value={text} onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit() } }}
          placeholder={
            aiMode
              ? 'Ask AI — e.g. "extract action items" or "summarise my notes"…'
              : attachment ? 'Add a caption…' : 'Comment · paste an image · attach a file…'
          }
          disabled={submitting}
          className={`flex-1 text-sm border rounded-xl px-3 py-1.5 focus:outline-none focus:ring-2 bg-white placeholder:text-sand-300 disabled:opacity-50 ${
            aiMode
              ? 'border-violet-200 focus:ring-violet-300'
              : 'border-sand-200 focus:ring-teal-400'
          }`} />

        {/* Image + file attach — hidden in AI mode */}
        {!aiMode && (
          <>
            <button type="button" onClick={() => imageRef.current?.click()}
              title="Attach image"
              className="w-7 h-7 flex items-center justify-center text-sand-400 hover:text-teal-500 hover:bg-teal-50 rounded-lg transition-colors text-sm flex-shrink-0">
              🖼
            </button>
            <input ref={imageRef} type="file" accept="image/*" className="hidden" onChange={pickImage} />

            <button type="button" onClick={() => fileRef.current?.click()}
              title="Attach file"
              className="w-7 h-7 flex items-center justify-center text-sand-400 hover:text-teal-500 hover:bg-teal-50 rounded-lg transition-colors text-sm flex-shrink-0">
              📎
            </button>
            <input ref={fileRef} type="file"
              accept=".pdf,.doc,.docx,.txt,.md,.pages,.rtf,.csv,.xlsx,.xls"
              className="hidden" onChange={pickFile} />
          </>
        )}

        {/* Send */}
        <button onClick={handleSubmit} disabled={!canSubmit}
          className={`w-7 h-7 flex items-center justify-center text-white rounded-xl disabled:opacity-30 transition-colors text-sm flex-shrink-0 ${
            aiMode ? 'bg-violet-600 hover:bg-violet-700' : 'bg-teal-600 hover:bg-teal-700'
          }`}>
          {submitting ? '…' : aiMode ? '✨' : '→'}
        </button>
      </div>
      {!aiMode && <p className="text-[10px] text-sand-300">⌘V to paste a screenshot</p>}
      {aiMode && <p className="text-[10px] text-violet-300">AI can read all your notes and comments on this task</p>}
    </div>
  )
}
