import { useEffect, useState } from 'react'
import Modal from '../../components/Modal'
import Icon from '../../components/Icon'
import { addProof, completeTask, getTask, uploadProofImage } from '../../api'

export default function CompleteTaskDialog({ task, onClose, onComplete }) {
  const [proofs, setProofs] = useState([])
  const [loading, setLoading] = useState(true)
  const [type, setType] = useState('text')
  const [content, setContent] = useState('')
  const [file, setFile] = useState(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [proofSaved, setProofSaved] = useState(false)
  useEffect(() => {
    let alive = true
    getTask(task.id).then(t => { if (alive) setProofs(t.proofs || []) }).catch(e => { if (alive) setError(e.message) }).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [task.id])
  async function submit(e) {
    e.preventDefault()
    setSaving(true); setError('')
    try {
      if (!proofs.length && !proofSaved) {
        let value = content.trim()
        if (type === 'image') {
          if (!file) throw new Error('Choose an image first.')
          value = (await uploadProofImage(file)).url
        }
        if (!value) throw new Error('Add a short note, link, or image showing what you finished.')
        if (type === 'link') {
          let url
          try { url = new URL(value) } catch { throw new Error('Enter a full link beginning with https:// or http://.') }
          if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Use an https:// or http:// link.')
        }
        await addProof(task.id, { type, content: value })
        setProofSaved(true)
      }
      await completeTask(task.id)
      window.dispatchEvent(new CustomEvent('basira:task-updated'))
      window.dispatchEvent(new CustomEvent('basira:schedule-updated'))
      onComplete?.()
    } catch (err) { setError(err.message) }
    finally { setSaving(false) }
  }
  return <Modal title="Make your progress visible" onClose={() => { if (!saving) onClose() }}>
    <form onSubmit={submit} className="space-y-5">
      <div className="flex items-start gap-3"><span className="p-2 rounded-xl bg-raised text-accent"><Icon name="proof"/></span><div><p className="font-semibold text-ink">{task.title}</p><p className="text-xs text-muted mt-1">What shows this is done?</p></div></div>
      {loading ? <p role="status" className="text-sm text-muted">Checking existing evidence…</p> : proofs.length || proofSaved ? <div className="p-4 rounded-xl bg-raised text-sm"><p className="font-medium text-accent">Evidence is saved.</p><p className="text-muted mt-1">{proofSaved ? 'Your proof is ready. Retry completion without uploading again.' : `${proofs.length} proof ${proofs.length === 1 ? 'entry is' : 'entries are'} attached to this task.`}</p>{proofs.slice(0, 3).map(p => <p className="text-muted mt-2 break-words line-clamp-3" key={p.id}>{p.type === 'text' ? p.content : `${p.type === 'image' ? 'Image' : 'Attachment'} · ${p.content}`}</p>)}</div> : <>
        <div className="flex gap-2" role="group" aria-label="Proof type">{[['text', 'A note'], ['link', 'A link'], ['image', 'An image']].map(([value, label]) => <button type="button" key={value} aria-pressed={type === value} disabled={saving} onClick={() => setType(value)} className={`secondary-button ${type === value ? 'border-accent text-accent bg-raised' : ''}`}>{label}</button>)}</div>
        {type === 'image' ? <label className="block text-sm text-muted">Image evidence<input className="field-input mt-2" type="file" accept="image/*" disabled={saving} onChange={e => setFile(e.target.files?.[0] || null)}/><span className="block mt-2 text-xs">Choose a screenshot or photo of the result.</span></label> : <label className="block text-sm text-muted">{type === 'text' ? 'What did you finish?' : 'Evidence link'}{type === 'text' ? <textarea autoFocus className="field-input mt-2" rows={4} disabled={saving} value={content} onChange={e => setContent(e.target.value)} placeholder="Describe the result in a sentence…"/> : <input autoFocus className="field-input mt-2" type="url" disabled={saving} value={content} onChange={e => setContent(e.target.value)} placeholder="https://…"/>}</label>}
      </>}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end gap-3"><button type="button" className="secondary-button" disabled={saving} onClick={onClose}>Keep working</button><button type="submit" disabled={loading || saving || (!proofs.length && !proofSaved && (type === 'image' ? !file : !content.trim()))} className="bg-forest text-white text-sm px-4 py-2.5 rounded-xl disabled:opacity-40">{saving ? 'Saving…' : 'Complete with evidence'}</button></div>
    </form>
  </Modal>
}
