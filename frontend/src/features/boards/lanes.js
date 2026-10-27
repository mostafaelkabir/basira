import { Box, createShapeId } from 'tldraw'
import { addDays, dayLabel, endOfWeek, shortDate, startOfWeek, todayIso } from '../work/due'
import { laneWrites } from './laneState'
import { PLURAL } from './entityStore'
import { CARD_SIZE, CARD_TYPE, STATUS_ORDER } from './SysgoCardShape'

export { TEMPLATE_OPTIONS, templateKey } from './templates'

const STATUS_LABEL = { backlog: 'Backlog', todo: 'To do', in_progress: 'In progress', review: 'Review', blocked: 'Blocked', done: 'Done' }
const LANE_W = 360
const LANE_GAP = 28
const PAD = 16
const HEAD = 52          // room for the frame title inside the lane
const CARD_GAP = 14

/**
 * Lane definitions for a kind. Each lane knows what a dropped card should become
 * (`kind` + `value`, stored on the frame's meta) and which cards start in it (`match`).
 */
export function laneDefs(kind, { milestones = [] } = {}) {
  if (kind === 'status') {
    return STATUS_ORDER.map(s => ({ kind, value: s, label: STATUS_LABEL[s], match: d => (d.status || 'todo') === s }))
  }
  if (kind === 'milestone') {
    const open = milestones.filter(m => m.status !== 'done')
    return [
      ...open.map(m => ({ kind, value: m.id, label: `◆ ${m.title}${m.due_date ? ` · ${shortDate(m.due_date)}` : ''}`, match: d => d.milestone_id === m.id })),
      { kind, value: '', label: 'No milestone', match: d => !open.some(m => m.id === d.milestone_id) },
    ]
  }
  if (kind === 'due') {
    const today = todayIso(), eow = endOfWeek(today), eonw = addDays(eow, 7), later = addDays(today, 21)
    return [
      { kind, value: today, label: `Today · ${shortDate(today)}`, match: d => !!d.due_date && d.due_date <= today },   // overdue lands here too
      { kind, value: eow, label: `This week · by ${shortDate(eow)}`, match: d => !!d.due_date && d.due_date > today && d.due_date <= eow },
      { kind, value: eonw, label: `Next week · by ${shortDate(eonw)}`, match: d => !!d.due_date && d.due_date > eow && d.due_date <= eonw },
      { kind, value: later, label: `Later · ${shortDate(later)} +`, match: d => !!d.due_date && d.due_date > eonw },
      { kind, value: '', label: 'No date', match: d => !d.due_date },
    ]
  }
  if (kind === 'week') {
    const mon = startOfWeek(todayIso())
    return Array.from({ length: 7 }, (_, i) => {
      const iso = addDays(mon, i)
      return { kind: 'due', value: iso, label: dayLabel(iso), match: d => d.due_date === iso }
    })
  }
  if (kind === 'roadmap') {
    const today = todayIso(), eow = endOfWeek(today)
    return [
      { kind: 'due', value: eow, label: `Now · this week`, match: d => !!d.due_date && d.due_date <= eow },
      { kind: 'due', value: addDays(eow, 7), label: `Next · next week`, match: d => !!d.due_date && d.due_date > eow && d.due_date <= addDays(eow, 7) },
      { kind: 'due', value: addDays(today, 28), label: `Later · in a month`, match: d => !d.due_date || d.due_date > addDays(eow, 7) },
    ]
  }
  return []
}

const PLAIN = {
  brainstorm: ['💡 Ideas', '👍 Keep', '⏳ Later', '🅿️ Parking lot'],
  retro: ['🌱 Went well', '🌧 Didn’t go well', '🎯 Actions', '🙏 Kudos'],
}

function cardData(store, shape) { return store?.data?.[PLURAL[shape.props.entity]]?.[shape.props.entityId] || {} }
function unsuppressSoon() { setTimeout(() => { laneWrites.suppressed = false }, 160) }   // store listeners run on the next frame

function bucketCards(editor, defs, cards, store) {
  const buckets = defs.map(() => [])
  for (const s of cards) {
    const i = defs.findIndex(def => def.match && def.match(cardData(store, s)))
    buckets[i >= 0 ? i : defs.length - 1].push(s)
  }
  for (const b of buckets) b.sort((a, c) => (editor.getShapePageBounds(a)?.y ?? 0) - (editor.getShapePageBounds(c)?.y ?? 0))
  return buckets
}

/**
 * File `cards` into lanes. When the board already has lanes for every one of these definitions
 * (same kind and value), the cards go into those frames, below whatever is there; otherwise a new
 * row of lane frames is built to the right of the existing content.
 */
function layoutLanes(editor, defs, cards, store) {
  const cardH = Math.max(...Object.values(CARD_SIZE).map(s => s.h))
  const buckets = bucketCards(editor, defs, cards, store)
  const keyOf = def => (def.kind ? `${def.kind}|${def.value}` : null)
  const existing = new Map(editor.getCurrentPageShapes().filter(s => s.type === 'frame' && s.meta?.lane)
    .map(f => [`${f.meta.lane.kind}|${f.meta.lane.value}`, f]))
  if (defs.some(d => d.kind) && defs.every(def => !keyOf(def) || existing.has(keyOf(def)))) {
    const frames = defs.map(def => existing.get(keyOf(def)))
    const moved = []
    laneWrites.suppressed = true
    editor.run(() => {
      editor.markHistoryStoppingPoint('file into lanes')
      let maxH = Math.max(...frames.map(f => f.props.h))
      frames.forEach((f, i) => {
        const incoming = buckets[i].filter(s => s.parentId !== f.id)
        if (!incoming.length) return
        const already = editor.getSortedChildIdsForParent(f.id).filter(id => editor.getShape(id)?.type === CARD_TYPE).length
        editor.reparentShapes(incoming.map(s => s.id), f.id)
        editor.updateShapes(incoming.map((s, j) => ({
          id: s.id, type: s.type,
          x: PAD + Math.max(0, (f.props.w - 2 * PAD - s.props.w) / 2), y: HEAD + (already + j) * (cardH + CARD_GAP),
        })))
        maxH = Math.max(maxH, HEAD + PAD + (already + incoming.length) * (cardH + CARD_GAP) + PAD)
        moved.push(...incoming)
      })
      editor.updateShapes(frames.map(f => ({ id: f.id, type: f.type, props: { h: maxH } })))
      editor.selectNone()
    })
    unsuppressSoon()
    const bounds = Box.Common(frames.map(f => editor.getShapePageBounds(f)).filter(Boolean))
    editor.zoomToBounds(bounds, { inset: 64, targetZoom: 1, animation: { duration: 300 } })
    return { lanes: frames.length, cards: moved.length, reused: true }
  }
  const rows = Math.max(1, ...buckets.map(b => b.length))
  const laneH = Math.max(640, HEAD + PAD + rows * (cardH + CARD_GAP) + PAD)
  const all = editor.getCurrentPageBounds()
  const view = editor.getViewportPageBounds()
  const edge = 40 / editor.getZoomLevel()
  const origin = all ? { x: all.maxX + 120, y: all.y } : { x: view.x + edge, y: view.y + edge }
  const frames = defs.map((def, i) => ({
    id: createShapeId(), type: 'frame',
    x: origin.x + i * (LANE_W + LANE_GAP), y: origin.y,
    props: { w: LANE_W, h: laneH, name: def.label },
    meta: def.kind ? { lane: { kind: def.kind, value: def.value, label: def.label } } : {},
  }))
  laneWrites.suppressed = true
  editor.run(() => {
    editor.markHistoryStoppingPoint('lanes')
    editor.createShapes(frames)
    frames.forEach((f, i) => {
      const bucket = buckets[i]
      if (!bucket.length) return
      editor.reparentShapes(bucket.map(s => s.id), f.id)
      editor.updateShapes(bucket.map((s, j) => ({
        id: s.id, type: s.type,
        x: PAD + Math.max(0, (LANE_W - 2 * PAD - s.props.w) / 2), y: HEAD + j * (cardH + CARD_GAP),
      })))
    })
    editor.select(...frames.map(f => f.id))
  })
  unsuppressSoon()
  const sel = editor.getSelectionPageBounds()
  if (sel) editor.zoomToBounds(sel, { inset: 64, targetZoom: 1, animation: { duration: 300 } })
  editor.selectNone()
  return { lanes: frames.length, cards: cards.length }
}

/**
 * Arrange cards into lanes: the selected cards if any are selected, otherwise every card on the
 * page. Status and milestone lanes take tickets; due-date lanes take tickets and tasks.
 */
export function createLanes(editor, kind, { milestones = [], store } = {}) {
  const defs = laneDefs(kind, { milestones })
  if (!defs.length) return null
  const byDate = kind === 'due' || kind === 'week' || kind === 'roadmap'
  const fits = s => (byDate ? s.props.entity === 'ticket' || s.props.entity === 'task' : s.props.entity === 'ticket')
  // Arrange the selected cards when some of them fit these lanes; otherwise every fitting card on the page.
  const selected = editor.getSelectedShapes().filter(s => s.type === CARD_TYPE && fits(s))
  const pool = selected.length ? selected : editor.getCurrentPageShapes().filter(s => s.type === CARD_TYPE && fits(s))
  return layoutLanes(editor, defs, pool, store)
}

/** Remove the lane frames this board made; the cards inside stay exactly where they are. */
export function clearLanes(editor) {
  const frames = editor.getCurrentPageShapes().filter(s => s.type === 'frame' && s.meta?.lane)
  if (!frames.length) return 0
  const pageId = editor.getCurrentPageId()
  laneWrites.suppressed = true
  editor.run(() => {
    editor.markHistoryStoppingPoint('clear lanes')
    for (const f of frames) {
      const children = editor.getSortedChildIdsForParent(f.id)
      if (children.length) editor.reparentShapes(children, pageId)
    }
    editor.deleteShapes(frames.map(f => f.id))
  })
  unsuppressSoon()
  return frames.length
}

/** Seed a fresh board from a template: smart lanes, or plain named frames for free-form thinking. */
export function applyTemplate(editor, name, ctx = {}) {
  if (name === 'weekly') return layoutLanes(editor, laneDefs('week'), [], ctx.store)
  if (name === 'status') return layoutLanes(editor, laneDefs('status'), [], ctx.store)
  if (name === 'roadmap') return layoutLanes(editor, laneDefs('roadmap'), [], ctx.store)
  if (PLAIN[name]) return layoutLanes(editor, PLAIN[name].map(label => ({ label })), [], ctx.store)
  return null
}
