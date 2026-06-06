import { useEffect, useRef, useState } from 'react'
import { createContact, deleteCall, deleteContact, getContacts, logCall, updateContact, uploadContactPhoto } from './api'
import Modal from './components/Modal'

function daysSince(days) {
  if (days === null) return { label: 'Never called', dot: 'bg-sand-300', badge: 'bg-sand-100 text-sand-500', urgent: false }
  if (days === 0)    return { label: 'Called today',   dot: 'bg-sage-400',  badge: 'bg-sage-50 text-sage-600',   urgent: false }
  if (days <= 7)     return { label: `${days}d ago`,   dot: 'bg-sage-400',  badge: 'bg-sage-50 text-sage-600',   urgent: false }
  if (days <= 30)    return { label: `${days}d ago`,   dot: 'bg-gold-400',  badge: 'bg-gold-50 text-gold-600',   urgent: false }
  if (days <= 90)    return { label: `${days}d ago`,   dot: 'bg-terra-300', badge: 'bg-terra-100 text-terra-400', urgent: true }
  return { label: `${days}d ago`, dot: 'bg-terra-400', badge: 'bg-terra-100 text-terra-400', urgent: true }
}

function Avatar({ contact, size = 'md' }) {
  const sizes = {
    sm: 'w-9 h-9 text-sm',
    md: 'w-12 h-12 text-base',
    lg: 'w-16 h-16 text-xl',
  }
  const initials = contact.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
  const colors = [
    'bg-teal-100 text-teal-700', 'bg-gold-50 text-gold-600',
    'bg-sage-50 text-sage-600',  'bg-terra-100 text-terra-400',
    'bg-sand-200 text-sand-600',
  ]
  const color = colors[contact.name.charCodeAt(0) % colors.length]

  if (contact.photo) {
    return (
      <img src={contact.photo} alt={contact.name}
        className={`${sizes[size]} rounded-full object-cover flex-shrink-0`} />
    )
  }
  return (
    <div className={`${sizes[size]} ${color} rounded-full flex items-center justify-center font-semibold flex-shrink-0`}>
      {initials}
    </div>
  )
}

function formatCallDate(iso) {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function ContactsPage() {
  const [contacts, setContacts] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(null)
  const [showNew, setShowNew] = useState(false)
  const [editing, setEditing] = useState(null)
  const [logFor, setLogFor] = useState(null)
  const [form, setForm] = useState({ name: '', notes: '', photo: '' })
  const [logForm, setLogForm] = useState({ called_at: today(), summary: '' })
  const [submitting, setSubmitting] = useState(false)
  const [photoUploading, setPhotoUploading] = useState(false)
  const [photoPreview, setPhotoPreview] = useState(null)
  const fileRef = useRef(null)

  function today() { return new Date().toISOString().split('T')[0] }

  async function load() {
    try { setContacts(await getContacts()) }
    catch (err) { alert(err.message) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  function openNew() {
    setForm({ name: '', notes: '', photo: '' })
    setPhotoPreview(null)
    setShowNew(true)
  }

  function openEdit(e, contact) {
    e.stopPropagation()
    setForm({ name: contact.name, notes: contact.notes || '', photo: contact.photo || '' })
    setPhotoPreview(contact.photo || null)
    setEditing(contact)
  }

  function closeModal() { setShowNew(false); setEditing(null); setLogFor(null); setPhotoPreview(null) }

  async function handlePhotoFile(file) {
    if (!file) return
    setPhotoUploading(true)
    try {
      setPhotoPreview(URL.createObjectURL(file))
      const { url } = await uploadContactPhoto(file)
      setForm(f => ({ ...f, photo: url }))
      setPhotoPreview(url)
    } catch (err) { alert(err.message); setPhotoPreview(null) }
    finally { setPhotoUploading(false) }
  }

  async function handleSubmitContact(e) {
    e.preventDefault()
    if (!form.name.trim()) return
    setSubmitting(true)
    try {
      if (editing) {
        await updateContact(editing.id, { name: form.name.trim(), notes: form.notes || null, photo: form.photo || null })
      } else {
        await createContact({ name: form.name.trim(), notes: form.notes || null, photo: form.photo || null })
      }
      closeModal()
      load()
    } catch (err) { alert(err.message) }
    finally { setSubmitting(false) }
  }

  async function handleDelete(e, id) {
    e.stopPropagation()
    if (!confirm('Remove this person?')) return
    try { await deleteContact(id); load() }
    catch (err) { alert(err.message) }
  }

  async function handleLogCall(e) {
    e.preventDefault()
    if (!logForm.summary.trim()) return
    setSubmitting(true)
    try {
      await logCall(logFor.id, { called_at: logForm.called_at, summary: logForm.summary.trim() })
      closeModal()
      load()
    } catch (err) { alert(err.message) }
    finally { setSubmitting(false) }
  }

  async function handleDeleteCall(contactId, callId) {
    if (!confirm('Delete this call log?')) return
    try { await deleteCall(callId); load() }
    catch (err) { alert(err.message) }
  }

  if (loading) return <p className="text-[#6B6B6B] text-sm">Loading…</p>

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-[11px] font-bold text-[#6B6B6B] uppercase tracking-widest mb-1">Relationship Tracker</p>
          <h1 className="text-3xl font-bold text-[#1A1A1A]">Connections</h1>
          <p className="text-sm text-[#6B6B6B] mt-0.5">Stay in touch with the people who matter</p>
        </div>
        <button onClick={openNew}
          className="bg-[#1B3A2D] text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-[#2a5240] transition-colors shadow-sm">
          + Log Interaction
        </button>
      </div>

      {/* AI Insight Banner */}
      <div className="bg-violet-50 border border-violet-100 rounded-2xl p-4 mb-6 flex items-start gap-3">
        <span className="text-violet-500 text-lg">⚡</span>
        <div>
          <p className="text-[10px] font-bold text-violet-500 uppercase tracking-widest mb-1">AI INSIGHT</p>
          <p className="text-sm text-[#1A1A1A]">Stay connected — check in with people you haven't spoken to in over 2 weeks.</p>
        </div>
      </div>

      {/* Stats row */}
      {contacts.length > 0 && (() => {
        const overdueCount = contacts.filter(c => c.days_since_call === null || c.days_since_call > 14).length
        const touchpointsCount = contacts.filter(c => c.days_since_call !== null && c.days_since_call <= 7).length
        return (
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-white border border-[#E8E3DB] rounded-2xl p-4 text-center">
              <p className="text-[10px] font-bold text-[#6B6B6B] uppercase tracking-widest mb-1">ACTIVE LINKS</p>
              <p className="text-3xl font-bold text-[#1A1A1A]">{contacts.length}</p>
            </div>
            <div className="bg-white border border-[#E8E3DB] rounded-2xl p-4 text-center">
              <p className="text-[10px] font-bold text-[#6B6B6B] uppercase tracking-widest mb-1">TOUCHPOINTS</p>
              <p className="text-3xl font-bold text-[#1A1A1A]">{touchpointsCount}</p>
            </div>
            <div className="bg-white border border-[#E8E3DB] rounded-2xl p-4 text-center">
              <p className="text-[10px] font-bold text-[#6B6B6B] uppercase tracking-widest mb-1">DUE CATCH-UP</p>
              <p className="text-3xl font-bold text-[#1A1A1A]">{overdueCount}</p>
            </div>
          </div>
        )
      })()}

      {contacts.length === 0 ? (
        <div className="text-center py-24 text-[#6B6B6B]">
          <div className="text-4xl mb-3">📞</div>
          <p className="font-medium">No contacts yet</p>
          <p className="text-sm mt-1">Add people you want to stay connected with.</p>
        </div>
      ) : (
        <>
        <div className="grid gap-3 sm:grid-cols-2">
          {contacts.map(contact => {
            const ds = daysSince(contact.days_since_call)
            const isOpen = expanded === contact.id
            // Status badge
            let statusBadge = null
            if (contact.days_since_call === null || contact.days_since_call > 14) {
              statusBadge = <span className="bg-red-100 text-red-600 text-[10px] font-bold px-2 py-0.5 rounded-full">OVERDUE</span>
            } else if (contact.days_since_call <= 7) {
              statusBadge = <span className="bg-green-100 text-green-700 text-[10px] font-bold px-2 py-0.5 rounded-full">HEALTHY</span>
            } else {
              statusBadge = <span className="bg-amber-100 text-amber-700 text-[10px] font-bold px-2 py-0.5 rounded-full">UPCOMING</span>
            }

            return (
              <div key={contact.id}
                className={`relative bg-white border rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.08)] overflow-hidden transition-all ${
                  ds.urgent ? 'border-l-[3px] border-terra-400 border-t-[#E8E3DB] border-r-[#E8E3DB] border-b-[#E8E3DB]'
                            : 'border-[#E8E3DB]'
                }`}>

                {/* Status badge — absolute top-right */}
                <div className="absolute top-3 right-3 z-10">{statusBadge}</div>

                {/* Row */}
                <div className="flex items-center gap-3 px-4 py-3.5 cursor-pointer group"
                  onClick={() => setExpanded(isOpen ? null : contact.id)}>
                  <Avatar contact={contact} size="md" />

                  <div className="flex-1 min-w-0 pr-16">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-[#1A1A1A] text-sm">{contact.name}</span>
                    </div>
                    {contact.notes && (
                      <p className="text-xs text-[#6B6B6B] mt-0.5 truncate">{contact.notes}</p>
                    )}
                  </div>

                  {/* Last called badge */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${ds.badge}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${ds.dot} flex-shrink-0`} />
                      {ds.label}
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); setLogFor(contact); setLogForm({ called_at: today(), summary: '' }) }}
                      className="text-xs px-2.5 py-1 rounded-lg border border-[#2D7A6B]/30 text-[#2D7A6B] hover:bg-[#2D7A6B]/10 transition-colors font-medium flex-shrink-0">
                      📞 Log
                    </button>
                    <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={(e) => openEdit(e, contact)}
                        className="w-6 h-6 flex items-center justify-center text-[#6B6B6B] hover:text-[#2D7A6B] transition-colors">✎</button>
                      <button onClick={(e) => handleDelete(e, contact.id)}
                        className="w-6 h-6 flex items-center justify-center text-[#b5a08a] hover:text-terra-400 transition-colors text-sm">✕</button>
                    </div>
                  </div>
                </div>

                {/* Expanded call history */}
                {isOpen && (
                  <div className="border-t border-[#F2EDE4] px-4 pt-3 pb-4">
                    {contact.calls.length === 0 ? (
                      <p className="text-sm text-[#6B6B6B] italic py-2">No calls logged yet — click 📞 Log to add the first one.</p>
                    ) : (
                      <div className="space-y-3">
                        <p className="text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-widest">
                          Call history · {contact.call_count} {contact.call_count === 1 ? 'call' : 'calls'}
                        </p>
                        {contact.calls.map((call, idx) => (
                          <div key={call.id} className="flex gap-3 group/call">
                            {/* Timeline dot */}
                            <div className="flex flex-col items-center flex-shrink-0 pt-1">
                              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${idx === 0 ? 'bg-[#2D7A6B]' : 'bg-[#E8E3DB]'}`} />
                              {idx < contact.calls.length - 1 && <div className="w-px flex-1 bg-[#E8E3DB] mt-1 min-h-[1rem]" />}
                            </div>
                            <div className="flex-1 min-w-0 pb-1">
                              <div className="flex items-center justify-between gap-2 mb-1">
                                <span className={`text-xs font-semibold ${idx === 0 ? 'text-[#2D7A6B]' : 'text-[#6B6B6B]'}`}>
                                  {formatCallDate(call.called_at)}
                                </span>
                                <button onClick={() => handleDeleteCall(contact.id, call.id)}
                                  className="opacity-0 group-hover/call:opacity-100 text-[#b5a08a] hover:text-terra-400 transition-all text-xs flex-shrink-0">✕</button>
                              </div>
                              <p className="text-sm text-[#1A1A1A] leading-relaxed whitespace-pre-wrap">{call.summary}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Recent Activity */}
        {(() => {
          const recentLogs = contacts
            .flatMap(c => (c.calls || []).map(call => ({ ...call, contactName: c.name })))
            .sort((a, b) => new Date(b.called_at) - new Date(a.called_at))
            .slice(0, 5)
          if (recentLogs.length === 0) return null
          return (
            <div className="mt-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-[#1A1A1A]">Recent Activity</h3>
                <button className="text-sm text-[#2D7A6B]">View All Log</button>
              </div>
              <div className="bg-white border border-[#E8E3DB] rounded-2xl px-4 shadow-sm">
                {recentLogs.map((log, i) => (
                  <div key={log.id || i} className="flex items-start gap-3 py-3 border-b border-[#E8E3DB] last:border-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#2D7A6B] flex-shrink-0 mt-2" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-[#1A1A1A]">{log.contactName}: {log.summary}</p>
                      <p className="text-xs text-[#6B6B6B]">{formatCallDate(log.called_at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })()}
        </>
      )}

      {/* Add/Edit contact modal */}
      {(showNew || editing) && (
        <Modal title={editing ? 'Edit Contact' : 'Add Person'} onClose={closeModal}>
          <form onSubmit={handleSubmitContact} className="space-y-4">
            {/* Photo upload */}
            <div className="flex items-center gap-4">
              <div className="relative flex-shrink-0">
                {photoPreview ? (
                  <img src={photoPreview} alt="" className="w-16 h-16 rounded-full object-cover" />
                ) : (
                  <div className="w-16 h-16 rounded-full bg-[#F2EDE4] border-2 border-dashed border-[#E8E3DB] flex items-center justify-center text-[#6B6B6B] text-xl">
                    👤
                  </div>
                )}
                <button type="button" onClick={() => fileRef.current?.click()}
                  disabled={photoUploading}
                  className="absolute -bottom-1 -right-1 w-6 h-6 bg-[#1B3A2D] text-white rounded-full text-xs flex items-center justify-center hover:bg-[#2a5240] transition-colors shadow-sm">
                  {photoUploading ? '…' : '+'}
                </button>
                <input ref={fileRef} type="file" accept="image/*" className="hidden"
                  onChange={e => handlePhotoFile(e.target.files?.[0])} />
              </div>
              <div className="flex-1">
                <label className="text-sm font-medium text-[#1A1A1A]">Name</label>
                <input autoFocus value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Grandma Fatima"
                  className="mt-1 w-full border border-[#E8E3DB] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2D7A6B] bg-white placeholder:text-[#b5a08a]" />
              </div>
            </div>

            {/* Notes / context */}
            <div>
              <label className="text-sm font-medium text-[#1A1A1A]">
                Context <span className="text-[#6B6B6B] font-normal">(optional)</span>
              </label>
              <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Who are they? Things to remember…" rows={2}
                className="mt-1.5 w-full border border-[#E8E3DB] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2D7A6B] resize-none bg-white placeholder:text-[#b5a08a]" />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={closeModal} className="px-4 py-2 text-sm text-[#6B6B6B] hover:text-[#1A1A1A]">Cancel</button>
              <button type="submit" disabled={submitting || !form.name.trim() || photoUploading}
                className="bg-[#1B3A2D] text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-[#2a5240] disabled:opacity-40 transition-colors">
                {editing ? 'Save' : 'Add Person'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Log call modal */}
      {logFor && (
        <Modal title={`Log call — ${logFor.name}`} onClose={closeModal}>
          <form onSubmit={handleLogCall} className="space-y-4">
            <div className="flex items-center gap-3 mb-2">
              <Avatar contact={logFor} size="sm" />
              <div>
                <p className="font-semibold text-[#1A1A1A] text-sm">{logFor.name}</p>
                {logFor.last_called && (
                  <p className="text-xs text-[#6B6B6B]">Last call: {formatCallDate(logFor.last_called)}</p>
                )}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-[#1A1A1A]">Date of call</label>
              <input type="date" value={logForm.called_at}
                onChange={e => setLogForm(f => ({ ...f, called_at: e.target.value }))}
                className="mt-1.5 w-full border border-[#E8E3DB] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2D7A6B] bg-white" />
            </div>

            <div>
              <label className="text-sm font-medium text-[#1A1A1A]">What did you talk about?</label>
              <textarea autoFocus value={logForm.summary}
                onChange={e => setLogForm(f => ({ ...f, summary: e.target.value }))}
                placeholder="Updates from their life, what was new, topics to follow up on next time…"
                rows={5}
                className="mt-1.5 w-full border border-[#E8E3DB] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2D7A6B] resize-none bg-white placeholder:text-[#b5a08a]" />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={closeModal} className="px-4 py-2 text-sm text-[#6B6B6B] hover:text-[#1A1A1A]">Cancel</button>
              <button type="submit" disabled={submitting || !logForm.summary.trim()}
                className="bg-[#1B3A2D] text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-[#2a5240] disabled:opacity-40 transition-colors">
                Save Log
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}
