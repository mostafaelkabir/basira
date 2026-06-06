import { useEffect, useRef, useState } from 'react'
import { archiveGoal, createGoal, deleteGoal, getGoals, unarchiveGoal, updateGoal, uploadGoalIcon } from './api'
import Modal from './components/Modal'

const TYPE_META = {
  resolution: { label: 'Resolution', icon: '✦', desc: 'Yearly goals & habits' },
  project:    { label: 'Project',    icon: '◈', desc: 'Finite goals with tasks' },
  daily:      { label: 'Daily',      icon: '◇', desc: 'Your daily to-do list' },
}
const TYPE_BADGE = {
  resolution: 'bg-gold-50 text-gold-600 border border-gold-200',
  project:    'bg-teal-50 text-[#1B3A2D] border border-teal-100',
  daily:      'bg-sage-50 text-sage-600 border border-sage-100',
}
const EMPTY_FORM = { title: '', description: '', type: null, icon: '', cover: false, parent_id: null }

const EMOJI_PRESETS = [
  '🎯','🚀','⭐','🔥','💡','🏆','💎','🌱','📚','💻',
  '🎨','🎵','💪','🧘','🏃','❤️','🤝','🏠','✈️','🌍',
  '💰','📈','🔬','🎓','🛠️','📋','✅','🧠','🌊','🦋',
]

function isImageUrl(icon) {
  return icon && (icon.startsWith('/') || icon.startsWith('http'))
}

// Renders either an uploaded image or an emoji — used everywhere a goal icon appears
export function GoalIcon({ icon, size = 'md', className = '' }) {
  const sizes = {
    sm:  { wrap: 'w-7 h-7',   img: 'w-7 h-7',   emoji: 'text-xl' },
    md:  { wrap: 'w-9 h-9',   img: 'w-9 h-9',   emoji: 'text-2xl' },
    lg:  { wrap: 'w-11 h-11', img: 'w-11 h-11', emoji: 'text-3xl' },
    xl:  { wrap: 'w-14 h-14', img: 'w-14 h-14', emoji: 'text-4xl' },
  }
  const s = sizes[size] || sizes.md
  if (!icon) return null
  if (isImageUrl(icon)) {
    return (
      <img src={icon} alt=""
        className={`${s.img} rounded-xl object-cover flex-shrink-0 ${className}`} />
    )
  }
  return <span className={`${s.emoji} leading-none flex-shrink-0 ${className}`}>{icon}</span>
}

export default function GoalsPage({ onSelectGoal }) {
  const [goals, setGoals] = useState([])
  const [archived, setArchived] = useState([])
  const [showArchived, setShowArchived] = useState(false)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [showNew, setShowNew] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [iconTab, setIconTab] = useState('emoji') // 'emoji' | 'image'
  const [iconUploading, setIconUploading] = useState(false)
  const [iconPreview, setIconPreview] = useState(null)
  const fileInputRef = useRef(null)

  async function load() {
    try {
      const [active, arch] = await Promise.all([getGoals(false), getGoals(true)])
      setGoals(active)
      setArchived(arch)
    } catch (err) { alert(err.message) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  function openCreate() { setForm(EMPTY_FORM); setIconPreview(null); setIconTab('emoji'); setShowNew(true) }
  function openEdit(e, goal) {
    e.stopPropagation()
    setForm({ title: goal.title, description: goal.description, type: goal.type, icon: goal.icon || '', cover: goal.cover || false, parent_id: goal.parent_id || null })
    setIconPreview(isImageUrl(goal.icon) ? goal.icon : null)
    setIconTab(isImageUrl(goal.icon) ? 'image' : 'emoji')
    setEditing(goal)
  }
  function closeModal() { setShowNew(false); setEditing(null); setIconPreview(null) }

  async function handleIconFile(file) {
    if (!file) return
    setIconUploading(true)
    try {
      setIconPreview(URL.createObjectURL(file))
      const { url } = await uploadGoalIcon(file)
      setForm(f => ({ ...f, icon: url }))
      setIconPreview(url)
    } catch (err) { alert(err.message); setIconPreview(null) }
    finally { setIconUploading(false) }
  }

  function handleIconFileInput(e) {
    handleIconFile(e.target.files?.[0])
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.title.trim()) return
    setSubmitting(true)
    try {
      editing ? await updateGoal(editing.id, { ...form, icon: form.icon || null, parent_id: form.parent_id || null })
              : await createGoal({ ...form, icon: form.icon || null, parent_id: form.parent_id || null })
      closeModal()
      load()
    } catch (err) { alert(err.message) }
    finally { setSubmitting(false) }
  }

  async function handleArchive(e, goalId) {
    e.stopPropagation()
    if (!confirm('Archive this goal? You can unarchive it anytime.')) return
    try { await archiveGoal(goalId); load() }
    catch (err) { alert(err.message) }
  }

  async function handleUnarchive(goalId) {
    try { await unarchiveGoal(goalId); load() }
    catch (err) { alert(err.message) }
  }

  async function handleDelete(e, goalId) {
    e.stopPropagation()
    if (!confirm('Permanently delete this goal and all its tasks?')) return
    try { await deleteGoal(goalId); load() }
    catch (err) { alert(err.message) }
  }

  if (loading) return <p className="text-[#6B6B6B] text-sm">Loading…</p>

  // Build project hierarchy: top-level projects + sub-projects grouped by parent
  const topLevelProjects = goals.filter(g => g.type === 'project' && !g.parent_id)
  const subProjectsByParent = {}
  for (const g of goals.filter(g => g.type === 'project' && g.parent_id)) {
    if (!subProjectsByParent[g.parent_id]) subProjectsByParent[g.parent_id] = []
    subProjectsByParent[g.parent_id].push(g)
  }

  const grouped = {
    resolution: goals.filter(g => g.type === 'resolution'),
    project:    topLevelProjects,
    daily:      goals.filter(g => g.type === 'daily'),
    untyped:    goals.filter(g => !g.type),
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-[11px] font-bold text-[#6B6B6B] uppercase tracking-widest mb-1">Progress Overview</p>
          <h1 className="text-3xl font-bold text-[#1A1A1A]">Your Goals</h1>
          <p className="text-sm text-[#6B6B6B] mt-0.5">{goals.length} active</p>
        </div>
        <button onClick={openCreate} className="bg-[#1B3A2D] text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-[#2a5240] transition-colors shadow-sm">
          + New Goal
        </button>
      </div>

      {goals.length === 0 && archived.length === 0 ? (
        <div className="text-center py-24 text-[#6B6B6B]">
          <div className="text-4xl mb-3 text-[#E8C334]">✦</div>
          <p className="font-medium">No goals yet</p>
          <p className="text-sm mt-1">Create your first goal to get started.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {(['resolution', 'project', 'daily', 'untyped']).map((type) => {
            const list = grouped[type]
            if (list.length === 0) return null
            const meta = TYPE_META[type]
            return (
              <div key={type}>
                <div className="flex items-center gap-3 mb-3">
                  {meta
                    ? <h2 className="text-[11px] font-bold text-[#1A1A1A] uppercase tracking-widest">{meta.label}s</h2>
                    : <h2 className="text-[11px] font-bold text-[#1A1A1A] uppercase tracking-widest">Unclassified</h2>
                  }
                  <span className="flex-1 border-t border-[#E8E3DB]" />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {list.map(goal => (
                    <div key={goal.id} className="contents">
                      <GoalCard goal={goal}
                        onClick={() => onSelectGoal(goal.id)}
                        onEdit={(e) => openEdit(e, goal)}
                        onArchive={(e) => handleArchive(e, goal.id)}
                        onDelete={(e) => handleDelete(e, goal.id)} />
                      {/* Sub-projects nested under this goal */}
                      {(subProjectsByParent[goal.id] || []).map(sg => (
                        <div key={sg.id} className="relative">
                          <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-sand-200 ml-4 rounded-full" />
                          <div className="ml-6">
                            <GoalCard goal={sg}
                              onClick={() => onSelectGoal(sg.id)}
                              onEdit={(e) => openEdit(e, sg)}
                              onArchive={(e) => handleArchive(e, sg.id)}
                              onDelete={(e) => handleDelete(e, sg.id)}
                              isSub />
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}

          {archived.length > 0 && (
            <div>
              <button onClick={() => setShowArchived(v => !v)}
                className="text-sm text-[#6B6B6B] hover:text-[#1A1A1A] flex items-center gap-1.5 transition-colors">
                <span>{showArchived ? '▾' : '▸'}</span>
                {showArchived ? 'Hide' : 'Show'} archived ({archived.length})
              </button>
              {showArchived && (
                <div className="grid gap-3 sm:grid-cols-2 mt-3">
                  {archived.map(goal => (
                    <div key={goal.id} className="bg-[#F2EDE4] border border-[#E8E3DB] rounded-2xl p-5 opacity-60">
                      <div className="flex justify-between items-start">
                        <div className="flex items-center gap-2.5">
                          <GoalIcon icon={goal.icon} size="sm" />
                          <div>
                            {TYPE_META[goal.type] && (
                              <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full mb-1.5 ${TYPE_BADGE[goal.type]}`}>
                                {TYPE_META[goal.type].icon} {TYPE_META[goal.type].label}
                              </span>
                            )}
                            <p className="font-medium text-[#6B6B6B] text-sm">{goal.title}</p>
                            <p className="text-xs text-sand-400 mt-0.5">{goal.done_count}/{goal.task_count} tasks done</p>
                          </div>
                        </div>
                        <div className="flex gap-1">
                          <button onClick={() => handleUnarchive(goal.id)}
                            className="text-xs text-teal-600 border border-[#2D7A6B]/30 px-2 py-1 rounded-lg hover:bg-[#2D7A6B]/10 transition-colors">
                            Unarchive
                          </button>
                          <button onClick={(e) => handleDelete(e, goal.id)}
                            className="text-xs text-[#b5a08a] hover:text-terra-400 px-2 py-1 rounded-lg transition-colors">
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {(showNew || editing) && (
        <Modal title={editing ? 'Edit Goal' : 'New Goal'} onClose={closeModal}>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Type picker */}
            <div>
              <label className="text-sm font-medium text-[#1A1A1A]">Type</label>
              <div className="grid grid-cols-3 gap-2 mt-1.5">
                {Object.entries(TYPE_META).map(([key, meta]) => (
                  <button key={key} type="button" onClick={() => setForm({ ...form, type: key })}
                    className={`p-3 rounded-xl border text-left transition-all ${form.type === key ? 'border-[#2D7A6B] bg-[#2D7A6B]/10' : 'border-[#E8E3DB] hover:border-[#E8E3DB]'}`}>
                    <div className="text-lg text-[#6B6B6B]">{meta.icon}</div>
                    <div className={`text-xs font-semibold mt-1 ${form.type === key ? 'text-[#1B3A2D]' : 'text-[#1A1A1A]'}`}>{meta.label}</div>
                    <div className="text-xs text-sand-400 mt-0.5 leading-tight">{meta.desc}</div>
                  </button>
                ))}
              </div>
              {form.type && (
                <button type="button" onClick={() => setForm({ ...form, type: null, parent_id: null })}
                  className="text-xs text-[#6B6B6B] hover:text-[#1A1A1A] mt-1.5">Clear type</button>
              )}
            </div>

            {/* Parent project picker — only for project type */}
            {form.type === 'project' && topLevelProjects.filter(p => !editing || p.id !== editing.id).length > 0 && (
              <div>
                <label className="text-sm font-medium text-[#1A1A1A]">
                  Part of a project <span className="text-[#6B6B6B] font-normal">(optional)</span>
                </label>
                <select
                  value={form.parent_id || ''}
                  onChange={e => setForm({ ...form, parent_id: e.target.value || null })}
                  className="mt-1.5 w-full border border-[#E8E3DB] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2D7A6B] bg-white text-[#1A1A1A]">
                  <option value="">None — standalone project</option>
                  {topLevelProjects
                    .filter(p => !editing || p.id !== editing.id)
                    .map(p => (
                      <option key={p.id} value={p.id}>{p.title}</option>
                    ))}
                </select>
              </div>
            )}

            {/* Icon picker */}
            <div>
              <label className="text-sm font-medium text-[#1A1A1A]">Icon / Logo <span className="text-[#6B6B6B] font-normal">(optional)</span></label>

              {/* Tab switcher */}
              <div className="flex gap-1 mt-1.5 bg-sand-50 rounded-xl p-1 w-fit border border-sand-200">
                {['emoji', 'image'].map(tab => (
                  <button key={tab} type="button" onClick={() => setIconTab(tab)}
                    className={`px-3 py-1 rounded-lg text-xs font-medium transition-all capitalize ${iconTab === tab ? 'bg-white text-sand-800 shadow-sm' : 'text-[#6B6B6B] hover:text-[#1A1A1A]'}`}>
                    {tab === 'emoji' ? '😊 Emoji' : '🖼 Image'}
                  </button>
                ))}
              </div>

              {/* Current preview */}
              {form.icon && (
                <div className="flex items-center gap-2 mt-2">
                  <GoalIcon icon={form.icon} size="lg" />
                  <button type="button" onClick={() => { setForm(f => ({ ...f, icon: '' })); setIconPreview(null) }}
                    className="text-xs text-[#b5a08a] hover:text-terra-400 transition-colors">
                    Remove
                  </button>
                </div>
              )}

              {iconTab === 'emoji' && (
                <div className="mt-2 space-y-2">
                  <input value={isImageUrl(form.icon) ? '' : form.icon}
                    onChange={e => setForm({ ...form, icon: e.target.value })}
                    placeholder="Paste or type any emoji…"
                    className="w-full border border-sand-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2D7A6B] bg-white placeholder:text-[#b5a08a]" />
                  <div className="flex flex-wrap gap-1.5">
                    {EMOJI_PRESETS.map(e => (
                      <button key={e} type="button" onClick={() => setForm(f => ({ ...f, icon: e }))}
                        className={`w-8 h-8 rounded-lg text-lg hover:bg-sand-100 transition-colors flex items-center justify-center ${form.icon === e ? 'bg-teal-50 ring-2 ring-[#2D7A6B]' : ''}`}>
                        {e}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {iconTab === 'image' && (
                <div className="mt-2 space-y-3">
                  <input ref={fileInputRef} type="file" accept="image/*" onChange={handleIconFileInput} className="hidden" />
                  <button type="button" onClick={() => fileInputRef.current?.click()}
                    disabled={iconUploading}
                    className="w-full border-2 border-dashed border-sand-200 rounded-xl py-6 flex flex-col items-center gap-2 hover:border-[#2D7A6B] hover:bg-[#2D7A6B]/10 transition-all text-sand-400 hover:text-[#2D7A6B] disabled:opacity-50">
                    {iconUploading ? (
                      <span className="text-sm">Uploading…</span>
                    ) : iconPreview ? (
                      <>
                        <img src={iconPreview} alt="" className="w-16 h-16 rounded-xl object-cover" />
                        <span className="text-xs">Click to replace</span>
                      </>
                    ) : (
                      <>
                        <span className="text-2xl">🖼</span>
                        <span className="text-sm font-medium">Click to upload a logo or image</span>
                        <span className="text-xs">PNG, JPG, WebP — recommended 256×256 or larger</span>
                      </>
                    )}
                  </button>

                  {isImageUrl(form.icon) && (
                    <div className="flex items-center gap-3 bg-sand-50 rounded-xl px-3 py-2.5 border border-sand-200">
                      <span className="text-sm text-[#6B6B6B] flex-1">Display as</span>
                      <div className="flex gap-1 bg-white rounded-lg p-0.5 border border-sand-200">
                        <button type="button" onClick={() => setForm(f => ({ ...f, cover: false }))}
                          className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${!form.cover ? 'bg-teal-600 text-white shadow-sm' : 'text-[#6B6B6B] hover:text-[#1A1A1A]'}`}>
                          Logo
                        </button>
                        <button type="button" onClick={() => setForm(f => ({ ...f, cover: true }))}
                          className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${form.cover ? 'bg-teal-600 text-white shadow-sm' : 'text-[#6B6B6B] hover:text-[#1A1A1A]'}`}>
                          Background
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Title */}
            <div>
              <label className="text-sm font-medium text-[#1A1A1A]">Title</label>
              <input autoFocus value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
                placeholder="e.g. Learn Spanish"
                className="mt-1.5 w-full border border-sand-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2D7A6B] focus:border-transparent bg-white placeholder:text-[#b5a08a]" />
            </div>

            {/* Description */}
            <div>
              <label className="text-sm font-medium text-[#1A1A1A]">Description <span className="text-[#6B6B6B] font-normal">(optional)</span></label>
              <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                placeholder="What does success look like?" rows={2}
                className="mt-1.5 w-full border border-sand-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent resize-none bg-white placeholder:text-sand-300" />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={closeModal} className="px-4 py-2 text-sm text-[#6B6B6B] hover:text-[#1A1A1A]">Cancel</button>
              <button type="submit" disabled={submitting || !form.title.trim() || iconUploading}
                className="bg-teal-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-teal-700 disabled:opacity-40 transition-colors">
                {editing ? 'Save Changes' : 'Create Goal'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}

function GoalCard({ goal, onClick, onEdit, onArchive, onDelete, isSub = false }) {
  const pct = goal.task_count > 0 ? Math.round((goal.done_count / goal.task_count) * 100) : 0
  const allDone = goal.task_count > 0 && goal.done_count === goal.task_count
  const meta = TYPE_META[goal.type]
  const isCover = goal.cover && isImageUrl(goal.icon)

  if (isCover) {
    return (
      <div onClick={onClick}
        className="relative rounded-2xl overflow-hidden cursor-pointer hover:shadow-lg transition-all group shadow-sm min-h-[140px]"
        style={{ backgroundImage: `url(${goal.icon})`, backgroundSize: 'cover', backgroundPosition: 'center' }}>
        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/30 to-black/10" />

        {/* Action buttons — z-20 so they sit above the content layer (z-10) */}
        <div className="absolute top-3 right-3 flex items-center gap-1 z-20">
          <button onClick={onEdit} className="text-white/80 hover:text-white w-6 h-6 flex items-center justify-center transition-colors bg-black/30 rounded-lg backdrop-blur-sm" title="Edit">✎</button>
          <button onClick={onArchive} className="text-white/60 hover:text-gold-300 w-6 h-6 flex items-center justify-center text-sm transition-colors bg-black/30 rounded-lg backdrop-blur-sm" title="Archive">◫</button>
          <button onClick={onDelete} className="text-white/60 hover:text-terra-300 w-6 h-6 flex items-center justify-center text-sm transition-colors bg-black/30 rounded-lg backdrop-blur-sm" title="Delete">✕</button>
        </div>

        {/* Content */}
        <div className="relative z-10 p-5 flex flex-col justify-end h-full min-h-[140px]">
          <div className="mt-auto">
            {meta && (
              <span className="inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full mb-2 bg-white/20 text-white/90 backdrop-blur-sm border border-white/20">
                {meta.icon} {meta.label}
              </span>
            )}
            <h2 className="font-bold text-white leading-snug text-base drop-shadow">{goal.title}</h2>
            {goal.description && <p className="text-sm text-white/70 mt-1 line-clamp-1">{goal.description}</p>}
            {goal.task_count > 0 && goal.type !== 'resolution' && (
              <div className="mt-3">
                <div className="flex justify-between text-xs text-white/70 mb-1">
                  <span>{goal.done_count}/{goal.task_count} tasks</span>
                  <span className={allDone ? 'text-sage-300 font-medium' : ''}>{allDone ? '✓ Done' : `${pct}%`}</span>
                </div>
                <div className="w-full bg-white/20 rounded-full h-1.5 backdrop-blur-sm">
                  <div className={`h-1.5 rounded-full transition-all ${allDone ? 'bg-sage-400' : 'bg-white/80'}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div onClick={onClick} className={`bg-white border border-[#E8E3DB] rounded-2xl cursor-pointer hover:shadow-md hover:border-[#2D7A6B]/30 transition-all group shadow-[0_1px_3px_rgba(0,0,0,0.08)] ${isSub ? 'p-4' : 'p-5'}`}>
      <div className="flex justify-between items-start gap-2 mb-1">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          {goal.icon
            ? <GoalIcon icon={goal.icon} size={isSub ? 'sm' : 'md'} className="mt-0.5" />
            : <div className={`${isSub ? 'w-7 h-7' : 'w-10 h-10'} rounded-xl bg-[#1B3A2D] flex items-center justify-center flex-shrink-0 mt-0.5`}>
                <span className={`${isSub ? 'text-base' : 'text-xl'} leading-none`}>{meta?.icon || '◈'}</span>
              </div>
          }
          <div className="flex-1 min-w-0">
            {meta && !isSub && (
              <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full mb-2 ${TYPE_BADGE[goal.type]}`}>
                {meta.icon} {meta.label}
              </span>
            )}
            <h2 className="font-semibold text-[#1A1A1A] group-hover:text-[#1B3A2D] transition-colors leading-snug">{goal.title}</h2>
            {goal.description && <p className="text-sm text-[#6B6B6B] mt-1 line-clamp-1">{goal.description}</p>}
          </div>
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          <button onClick={onEdit} className="text-[#6B6B6B] hover:text-[#2D7A6B] w-6 h-6 flex items-center justify-center transition-colors" title="Edit">✎</button>
          <button onClick={onArchive} className="text-[#b5a08a] hover:text-[#E8C334] w-6 h-6 flex items-center justify-center text-sm transition-colors" title="Archive">◫</button>
          <button onClick={onDelete} className="text-[#b5a08a] hover:text-terra-400 w-6 h-6 flex items-center justify-center text-sm transition-colors" title="Delete">✕</button>
        </div>
      </div>
      {goal.task_count > 0 && (
        <div className="mt-4">
          <div className="flex justify-between text-xs text-[#6B6B6B] mb-1.5">
            <span>Completion</span>
            <span className={allDone ? 'text-sage-500 font-medium' : 'font-medium text-[#1A1A1A]'}>{allDone ? '✓ Done' : `${pct}%`}</span>
          </div>
          <div className="w-full bg-[#E8E3DB] rounded-full h-1.5">
            <div className={`h-1.5 rounded-full transition-all ${allDone ? 'bg-sage-400' : 'bg-[#2D7A6B]'}`} style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
    </div>
  )
}
