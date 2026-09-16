import { useEffect, useRef, useState } from 'react'
import { getGoals, batchCreateSchedule } from './api'

const TIME_CHIPS = [
  { label: '15m', value: 15 },
  { label: '30m', value: 30 },
  { label: '1h',  value: 60 },
  { label: '1.5h', value: 90 },
  { label: '2h',  value: 120 },
]

let tempId = 0

export default function DayPlanner({ onItemsAdded }) {
  const [expanded, setExpanded] = useState(false)
  const [goals, setGoals] = useState([])
  const [items, setItems] = useState([])
  const [inputValue, setInputValue] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => {
    if (expanded && goals.length === 0) {
      getGoals().then(setGoals).catch(() => {})
    }
  }, [expanded])

  useEffect(() => {
    if (expanded) setTimeout(() => inputRef.current?.focus(), 60)
  }, [expanded])

  function handleKeyDown(e) {
    if (e.key === 'Enter' && inputValue.trim()) {
      e.preventDefault()
      const dailyGoal = goals.find(g => g.type === 'daily')
      setItems(prev => [...prev, {
        _id: ++tempId,
        title: inputValue.trim(),
        goalId: dailyGoal?.id || '',
        estimatedMinutes: null,
        scheduledTime: '',
      }])
      setInputValue('')
      setTimeout(() => inputRef.current?.focus(), 20)
    }
  }

  function updateItem(id, updates) {
    setItems(prev => prev.map(item => item._id === id ? { ...item, ...updates } : item))
  }

  function removeItem(id) {
    setItems(prev => prev.filter(item => item._id !== id))
  }

  async function handleSubmit() {
    if (items.length === 0) return
    setSubmitting(true)
    try {
      await batchCreateSchedule(items.map(item => ({
        title: item.title,
        goal_id: item.goalId || null,
        estimated_minutes: item.estimatedMinutes || null,
        scheduled_time: item.scheduledTime || null,
      })))
      setItems([])
      setExpanded(false)
      onItemsAdded?.()
    } catch (err) { alert(err.message) }
    finally { setSubmitting(false) }
  }

  const goalGroups = goals.reduce((acc, g) => {
    const type = g.type || 'other'
    if (!acc[type]) acc[type] = []
    acc[type].push(g)
    return acc
  }, {})

  const totalMinutes = items.reduce((sum, item) => sum + (item.estimatedMinutes || 0), 0)
  const hours = Math.floor(totalMinutes / 60)
  const mins = totalMinutes % 60
  const timeLabel = totalMinutes > 0
    ? (hours > 0 ? `${hours}h${mins > 0 ? ` ${mins}m` : ''}` : `${mins}m`)
    : null

  if (!expanded) {
    return (
      <button onClick={() => setExpanded(true)}
        className="w-full text-left bg-white border-2 border-dashed border-[#E8E3DB] rounded-2xl px-5 py-4 hover:border-[#2D7A6B] hover:bg-[#F9F6F1] transition-all group">
        <div className="flex items-center gap-3">
          <span className="w-8 h-8 rounded-xl bg-[#1B3A2D] text-white flex items-center justify-center text-sm font-bold group-hover:bg-[#2D7A6B] transition-colors">+</span>
          <div>
            <p className="text-sm font-semibold text-[#1A1A1A]">Plan your day</p>
            <p className="text-xs text-[#b5a08a]">Write what you'll work on today</p>
          </div>
        </div>
      </button>
    )
  }

  return (
    <div className="bg-white border border-[#E8E3DB] rounded-2xl shadow-[0_2px_12px_rgba(0,0,0,0.06)] overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-[#1B3A2D] to-[#2D7A6B] px-5 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="text-white/80 text-sm">✦</span>
          <h3 className="text-white font-bold text-sm">Plan Your Day</h3>
          {items.length > 0 && (
            <span className="bg-white/20 text-white/90 text-[10px] font-semibold px-2 py-0.5 rounded-full">
              {items.length} item{items.length !== 1 ? 's' : ''}
              {timeLabel && ` · ${timeLabel}`}
            </span>
          )}
        </div>
        <button onClick={() => { setExpanded(false); setItems([]); setInputValue('') }}
          className="text-white/50 hover:text-white transition-colors text-sm">✕</button>
      </div>

      <div className="p-5 space-y-4">
        {/* Input */}
        <div>
          <input
            ref={inputRef}
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a task and press Enter…"
            className="w-full text-sm border border-[#E8E3DB] rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#2D7A6B] bg-[#F9F6F1] placeholder:text-[#b5a08a] transition-shadow"
          />
          <p className="text-[10px] text-[#b5a08a] mt-1.5 ml-1">Press Enter to add each task. Tag goals and set times below.</p>
        </div>

        {/* Staged Items */}
        {items.length > 0 && (
          <div className="space-y-2">
            {items.map((item, idx) => (
              <PlanItem
                key={item._id}
                item={item}
                index={idx}
                goals={goals}
                goalGroups={goalGroups}
                onUpdate={(updates) => updateItem(item._id, updates)}
                onRemove={() => removeItem(item._id)}
              />
            ))}
          </div>
        )}

        {/* Empty state */}
        {items.length === 0 && (
          <div className="text-center py-6">
            <p className="text-[#b5a08a] text-sm">Start typing above to build your plan</p>
          </div>
        )}

        {/* Submit */}
        {items.length > 0 && (
          <button onClick={handleSubmit} disabled={submitting}
            className="w-full py-3 rounded-xl bg-[#1B3A2D] text-white text-sm font-bold hover:bg-[#2a5240] disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
            {submitting ? (
              'Adding…'
            ) : (
              <>
                Add {items.length} item{items.length !== 1 ? 's' : ''} to today
                {timeLabel && <span className="text-white/60 font-normal">· {timeLabel} planned</span>}
              </>
            )}
          </button>
        )}
      </div>
    </div>
  )
}

function PlanItem({ item, index, goals, goalGroups, onUpdate, onRemove }) {
  const [showGoalPicker, setShowGoalPicker] = useState(false)
  const [showTimePicker, setShowTimePicker] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(item.title)
  const titleRef = useRef(null)
  const goalPickerRef = useRef(null)

  const goal = goals.find(g => g.id === item.goalId)
  const goalLabel = goal?.title || 'Untagged'

  useEffect(() => {
    if (editingTitle) setTimeout(() => titleRef.current?.focus(), 30)
  }, [editingTitle])

  useEffect(() => {
    if (!showGoalPicker) return
    function handleClickOutside(e) {
      if (goalPickerRef.current && !goalPickerRef.current.contains(e.target)) {
        setShowGoalPicker(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showGoalPicker])

  function commitTitle() {
    setEditingTitle(false)
    if (titleDraft.trim() && titleDraft.trim() !== item.title) {
      onUpdate({ title: titleDraft.trim() })
    } else {
      setTitleDraft(item.title)
    }
  }

  return (
    <div className="group bg-[#F9F6F1] rounded-xl border border-[#E8E3DB] px-4 py-3 hover:border-[#2D7A6B]/30 transition-colors">
      <div className="flex items-start gap-3">
        {/* Number */}
        <span className="text-[10px] font-bold text-[#b5a08a] mt-1.5 w-4 text-right flex-shrink-0">
          {index + 1}
        </span>

        <div className="flex-1 min-w-0">
          {/* Title */}
          {editingTitle ? (
            <input
              ref={titleRef}
              value={titleDraft}
              onChange={e => setTitleDraft(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={e => { if (e.key === 'Enter') commitTitle(); if (e.key === 'Escape') { setTitleDraft(item.title); setEditingTitle(false) } }}
              className="w-full text-sm font-medium text-[#1A1A1A] bg-white border border-[#2D7A6B] rounded-lg px-2 py-1 focus:outline-none"
            />
          ) : (
            <p className="text-sm font-medium text-[#1A1A1A] cursor-text leading-snug"
              onClick={() => setEditingTitle(true)}>
              {item.title}
            </p>
          )}

          {/* Controls row */}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {/* Goal tag */}
            <div className="relative" ref={goalPickerRef}>
              <button onClick={() => setShowGoalPicker(!showGoalPicker)}
                className={`text-[11px] font-medium px-2.5 py-1 rounded-lg transition-colors flex items-center gap-1 ${
                  goal
                    ? 'bg-[#2D7A6B]/10 text-[#2D7A6B] hover:bg-[#2D7A6B]/20'
                    : 'bg-[#E8E3DB] text-[#6B6B6B] hover:bg-[#E8E3DB]/80'
                }`}>
                {goalLabel}
                <span className="text-[8px]">▾</span>
              </button>

              {showGoalPicker && (
                <div className="absolute left-0 top-full mt-1 z-20 bg-white border border-[#E8E3DB] rounded-xl shadow-lg py-1.5 w-56 max-h-48 overflow-y-auto">
                  {['project', 'daily', 'resolution'].map(type => {
                    const group = goalGroups[type]
                    if (!group?.length) return null
                    return (
                      <div key={type}>
                        <p className="text-[9px] font-bold text-[#b5a08a] uppercase tracking-wider px-3 py-1">
                          {type === 'project' ? 'Projects' : type === 'daily' ? 'Daily' : 'Resolutions'}
                        </p>
                        {group.map(g => (
                          <button key={g.id}
                            onClick={() => { onUpdate({ goalId: g.id }); setShowGoalPicker(false) }}
                            className={`w-full text-left px-3 py-1.5 text-xs hover:bg-[#F2EDE4] transition-colors ${
                              item.goalId === g.id ? 'text-[#2D7A6B] font-semibold bg-[#2D7A6B]/5' : 'text-[#1A1A1A]'
                            }`}>
                            {g.title}
                          </button>
                        ))}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Time estimate chips */}
            <div className="flex items-center gap-1">
              {TIME_CHIPS.map(chip => (
                <button key={chip.value}
                  onClick={() => onUpdate({ estimatedMinutes: item.estimatedMinutes === chip.value ? null : chip.value })}
                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-lg transition-colors ${
                    item.estimatedMinutes === chip.value
                      ? 'bg-[#E8C334] text-[#1A1A1A]'
                      : 'bg-white text-[#b5a08a] hover:text-[#6B6B6B] hover:bg-[#E8E3DB] border border-[#E8E3DB]'
                  }`}>
                  {chip.label}
                </button>
              ))}
            </div>

            {/* Scheduled time */}
            {showTimePicker ? (
              <input
                type="time"
                value={item.scheduledTime}
                onChange={e => onUpdate({ scheduledTime: e.target.value })}
                onBlur={() => { if (!item.scheduledTime) setShowTimePicker(false) }}
                autoFocus
                className="text-[11px] border border-[#2D7A6B] rounded-lg px-1.5 py-0.5 w-[88px] focus:outline-none"
              />
            ) : item.scheduledTime ? (
              <button onClick={() => setShowTimePicker(true)}
                className="text-[10px] font-semibold bg-[#1B3A2D] text-white rounded-lg px-2 py-0.5">
                {formatTime12(item.scheduledTime)}
              </button>
            ) : (
              <button onClick={() => setShowTimePicker(true)}
                className="text-[10px] text-[#b5a08a] hover:text-[#6B6B6B] hover:bg-[#E8E3DB] rounded-lg px-2 py-0.5 border border-dashed border-[#E8E3DB] transition-colors">
                + time
              </button>
            )}
          </div>
        </div>

        {/* Remove */}
        <button onClick={onRemove}
          className="text-[#b5a08a] hover:text-red-400 transition-colors mt-0.5 opacity-0 group-hover:opacity-100 flex-shrink-0">
          <span className="text-sm">✕</span>
        </button>
      </div>
    </div>
  )
}

function formatTime12(hhmm) {
  if (!hhmm) return ''
  const [h, m] = hhmm.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const dh = h % 12 || 12
  return `${dh}:${String(m).padStart(2, '0')} ${period}`
}
