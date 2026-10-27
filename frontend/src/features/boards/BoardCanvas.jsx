import 'tldraw/tldraw.css'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Box, DefaultContextMenu, DefaultContextMenuContent, DefaultStylePanel, Tldraw, TldrawUiMenuGroup, TldrawUiMenuItem,
  createShapeId, getSnapshot, renderPlaintextFromRichText, useEditor, useRelevantStyles, useValue,
} from 'tldraw'
import { getAssetUrlsByImport } from '@tldraw/assets/imports.vite'
import { saveBoardDocument } from '../../api'
import { EntityProvider, PLURAL } from './entityStore'
import { laneWrites } from './laneState'
import { CARD_SIZE, CARD_TYPE, SysgoCardUtil, cardBridge } from './SysgoCardShape'

export const ENTITY_MIME = 'application/x-basira-entity'
const SAVE_DELAY_MS = 900
const TEXT_SHAPES = ['note', 'text', 'geo']
const GAP = 24            // page units between cards when the board places them
const EDGE = 40           // screen pixels kept clear of the viewport edge

// Icons and fonts ship with the build rather than loading from tldraw's CDN, so boards work offline.
const assetUrls = getAssetUrlsByImport()
// Optional: a tldraw license key (hobby keys are free for non-commercial use) removes the watermark.
const LICENSE_KEY = import.meta.env.VITE_TLDRAW_LICENSE_KEY || undefined
const shapeUtils = [SysgoCardUtil]

// ─── Placement helpers (used by the palette, drops and the toolbar) ─────────────

function cardKey(s) { return `${s.props.entity}:${s.props.entityId}` }
function pageCards(editor) { return editor.getCurrentPageShapes().filter(s => s.type === CARD_TYPE) }
function padded(x, y, size) { return new Box(x - GAP / 2, y - GAP / 2, size.w + GAP, size.h + GAP) }

/** First free cell for a card of `size`, scanning what the user can see row by row; below everything when the view is full. */
export function findFreeSpot(editor, size) {
  const view = editor.getViewportPageBounds()
  const taken = editor.getCurrentPageShapes().map(s => editor.getShapePageBounds(s)).filter(Boolean)
  const edge = EDGE / editor.getZoomLevel()
  const stepX = size.w + GAP, stepY = size.h + GAP
  let tries = 0
  for (let y = view.y + edge; y + size.h <= view.maxY - edge && tries < 400; y += stepY) {
    for (let x = view.x + edge; x + size.w <= view.maxX - edge && tries < 400; x += stepX) {
      tries++
      const cell = padded(x, y, size)
      if (!taken.some(b => Box.Collides(cell, b))) return { x, y }
    }
  }
  const all = editor.getCurrentPageBounds()
  return all ? { x: all.x, y: all.maxY + GAP * 2 } : { x: view.x + edge, y: view.y + edge }
}

/** Zoom to show the whole board, but never closer than 100% (a lone card should not fill the screen). */
export function fitBoard(editor, animate = true) {
  const bounds = editor.getCurrentPageBounds()
  if (!bounds) return
  editor.zoomToBounds(bounds, { inset: 64, targetZoom: 1, animation: { duration: animate ? 220 : 0 } })
}

/**
 * Place a linked card. With a `point` (a drop) it goes exactly there; without one it takes the first
 * free spot in view. If the entity is already on the board, the existing card is selected and shown.
 */
export function placeCard(editor, entity, entityId, point = null) {
  const existing = pageCards(editor).find(s => s.props.entity === entity && s.props.entityId === entityId)
  if (existing) {
    editor.select(existing.id)
    const bounds = editor.getShapePageBounds(existing.id)
    if (bounds) editor.centerOnPoint(bounds.center, { animation: { duration: 220 } })
    return existing.id
  }
  const size = CARD_SIZE[entity] || CARD_SIZE.ticket
  const at = point ? { x: point.x - size.w / 2, y: point.y - size.h / 2 } : findFreeSpot(editor, size)
  const id = createShapeId()
  editor.markHistoryStoppingPoint('place card')
  editor.createShape({ id, type: CARD_TYPE, x: at.x, y: at.y, props: { ...size, entity, entityId } })
  editor.select(id)
  return id
}

/** Lay a batch of cards out as a grid to the right of everything on the board (top-left of the view when empty). */
export function placeCards(editor, entity, ids) {
  const size = CARD_SIZE[entity] || CARD_SIZE.ticket
  const already = new Set(pageCards(editor).map(cardKey))
  const fresh = ids.filter(id => !already.has(`${entity}:${id}`))
  if (fresh.length === 0) return 0
  const all = editor.getCurrentPageBounds()
  const view = editor.getViewportPageBounds()
  const edge = EDGE / editor.getZoomLevel()
  const origin = all ? { x: all.maxX + GAP * 3, y: all.y } : { x: view.x + edge, y: view.y + edge }
  const cols = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(fresh.length))))
  const shapes = fresh.map((entityId, i) => ({
    id: createShapeId(), type: CARD_TYPE,
    x: origin.x + (i % cols) * (size.w + GAP), y: origin.y + Math.floor(i / cols) * (size.h + GAP),
    props: { ...size, entity, entityId },
  }))
  editor.run(() => {
    editor.markHistoryStoppingPoint('add cards')
    editor.createShapes(shapes)
    editor.select(...shapes.map(s => s.id))
  })
  const sel = editor.getSelectionPageBounds()
  if (sel) editor.zoomToBounds(sel, { inset: 80, targetZoom: 1, animation: { duration: 250 } })
  return shapes.length
}

const STATUS_RANK = Object.fromEntries(['in_progress', 'review', 'blocked', 'todo', 'backlog', 'done'].map((s, i) => [s, i]))
const ENTITY_RANK = { milestone: 0, ticket: 1, task: 2, goal: 3 }

/** Arrange cards (the selected ones, or all of them) into a neat grid where they are: tickets, then tasks, then goals, by status. */
export function tidyCards(editor, store) {
  const onPage = s => s.parentId === editor.getCurrentPageId()
  const selected = editor.getSelectedShapes().filter(s => s.type === CARD_TYPE && onPage(s))
  const cards = selected.length > 1 ? selected : pageCards(editor).filter(onPage)
  if (cards.length < 2) return 0
  const info = s => store?.data?.[PLURAL[s.props.entity]]?.[s.props.entityId] || {}
  const sorted = [...cards].sort((a, b) =>
    (ENTITY_RANK[a.props.entity] - ENTITY_RANK[b.props.entity])
    || ((STATUS_RANK[info(a).status] ?? 9) - (STATUS_RANK[info(b).status] ?? 9))
    || String(info(a).title || '').localeCompare(String(info(b).title || '')))
  const bounds = Box.Common(sorted.map(s => editor.getShapePageBounds(s)).filter(Boolean))
  const cellW = Math.max(...sorted.map(s => s.props.w)) + GAP
  const cellH = Math.max(...sorted.map(s => s.props.h)) + GAP
  const cols = Math.max(1, Math.min(sorted.length, Math.round(Math.sqrt(sorted.length * 1.6))))
  editor.run(() => {
    editor.markHistoryStoppingPoint('tidy cards')
    editor.updateShapes(sorted.map((s, i) => ({ id: s.id, type: s.type, x: bounds.x + (i % cols) * cellW, y: bounds.y + Math.floor(i / cols) * cellH })))
    editor.select(...sorted.map(s => s.id))
  })
  const sel = editor.getSelectionPageBounds()
  if (sel) editor.zoomToBounds(sel, { inset: 64, targetZoom: 1, animation: { duration: 250 } })
  return sorted.length
}

// ─── Canvas overlays and UI overrides ───────────────────────────────────────────

// Floating action over the canvas: turn the selected sticky note / text into a real ticket or task.
function PromoteOverlay() {
  const editor = useEditor()
  const shape = useValue('promote-candidate', () => {
    const sel = editor.getSelectedShapes()
    if (sel.length !== 1 || !TEXT_SHAPES.includes(sel[0].type) || editor.getEditingShapeId()) return null
    return sel[0]
  }, [editor])
  if (!shape?.props?.richText) return null
  const text = renderPlaintextFromRichText(editor, shape.props.richText).trim()
  if (!text) return null
  return (
    <div className="board-promote" onPointerDown={e => e.stopPropagation()}>
      <span className="promote-text" title={text}>“{text}”</span>
      <button type="button" className="is-primary" onClick={() => cardBridge.onPromote?.('ticket', shape.id, text)}>Make ticket</button>
      <button type="button" onClick={() => cardBridge.onPromote?.('task', shape.id, text)}>Make task</button>
      <button type="button" onClick={() => cardBridge.onPromote?.('milestone', shape.id, text)}>Make milestone</button>
    </div>
  )
}

// What to do with an empty board, shown until the first shape lands.
function EmptyHint() {
  const editor = useEditor()
  const empty = useValue('board-empty', () => editor.getCurrentPageShapeIds().size === 0, [editor])
  if (!empty) return null
  return (
    <div className="board-empty-hint" aria-hidden="true">
      <p className="hint-title">An empty board</p>
      <ul>
        <li><b>Drag</b> tickets, tasks or goals in from the panel, or press their <b>+</b>. They stay live.</li>
        <li><kbd>N</kbd> drops a sticky note. Select it and press <b>Make ticket</b> to turn it into real work.</li>
        <li><kbd>A</kbd> draws arrows that stay attached to cards. <kbd>F</kbd> frames a group. <kbd>D</kbd> is the pen.</li>
        <li><b>Lanes ▾</b> lays cards out by status, milestone or due date. Drop a card into a lane and the ticket updates.</li>
        <li>Double-click a card to open it. Scroll to pan, pinch or <kbd>⌘</kbd> scroll to zoom.</li>
      </ul>
    </div>
  )
}

// Below ~30% zoom tldraw's frame headings shrink away; draw them at screen size instead (Miro-style).
function FrameTitles() {
  const editor = useEditor()
  const labels = useValue('frame-titles', () => {
    const zoom = editor.getZoomLevel()
    if (zoom >= 0.3) return null
    const sb = editor.getViewportScreenBounds()
    const labels = editor.getCurrentPageShapes().filter(s => s.type === 'frame').map(f => {
      const b = editor.getShapePageBounds(f)
      if (!b) return null
      const p = editor.pageToScreen({ x: b.x, y: b.y })
      const name = f.props.name || 'Frame'
      const maxWidth = Math.max(110, b.w * zoom)
      return { id: f.id, name, x: p.x - sb.x, y: p.y - sb.y, maxWidth, est: Math.min(maxWidth, name.length * 6.6 + 18), row: 0 }
    }).filter(Boolean).sort((a, b) => a.y - b.y || a.x - b.x)
    // Neighbouring frames sit closer than their titles are wide: zig-zag onto a second row when needed.
    const rowEnd = [-Infinity, -Infinity]
    for (const l of labels) {
      const row = l.x >= rowEnd[0] - 4 ? 0 : l.x >= rowEnd[1] - 4 ? 1 : 0
      l.row = row
      rowEnd[row] = l.x + l.est
    }
    return labels
  }, [editor])
  useEffect(() => {
    const el = editor.getContainer()
    if (labels) el.dataset.frameTitles = 'overlay'
    else delete el.dataset.frameTitles
    return () => { delete el.dataset.frameTitles }
  }, [editor, labels])
  if (!labels) return null
  return (
    <div className="frame-titles" aria-hidden="true">
      {labels.map(l => <span key={l.id} className="frame-title" data-row={l.row} style={{ left: l.x, top: l.y - l.row * 22, maxWidth: l.maxWidth }}>{l.name}</span>)}
    </div>
  )
}

function Overlays() { return <><FrameTitles /><EmptyHint /><PromoteOverlay /></> }

// The style palette only when it is useful: while drawing, or with a drawn shape selected. Cards have no styles.
function ContextualStylePanel(props) {
  const editor = useEditor()
  const styles = useRelevantStyles()
  const show = useValue('show-style-panel', () => {
    if (editor.getCurrentToolId() !== 'select') return true
    const sel = editor.getSelectedShapes()
    return sel.length > 0 && !sel.every(s => s.type === CARD_TYPE)
  }, [editor])
  if (!show) return null
  return <DefaultStylePanel {...props} styles={styles} />
}

// Right-click on a card: open it, or take it off the board (the ticket/task/goal itself is untouched).
function BoardContextMenu(props) {
  const editor = useEditor()
  const cards = useValue('selected-cards', () => editor.getSelectedShapes().filter(s => s.type === CARD_TYPE), [editor])
  const one = cards.length === 1 ? cards[0] : null
  return (
    <DefaultContextMenu {...props}>
      {cards.length > 0 && (
        <TldrawUiMenuGroup id="sysgo-cards">
          {one && (
            <TldrawUiMenuItem id="sysgo-open" icon="external-link" readonlyOk label={`Open ${one.props.entity}`}
              onSelect={() => cardBridge.onOpen?.(one.props.entity, one.props.entityId)} />
          )}
          <TldrawUiMenuItem id="sysgo-remove" icon="trash"
            label={cards.length > 1 ? `Remove ${cards.length} cards from board` : 'Remove from board'}
            onSelect={() => { editor.markHistoryStoppingPoint('remove cards'); editor.deleteShapes(cards.map(c => c.id)) }} />
        </TldrawUiMenuGroup>
      )}
      <DefaultContextMenuContent />
    </DefaultContextMenu>
  )
}

const components = { InFrontOfTheCanvas: Overlays, StylePanel: ContextualStylePanel, ContextMenu: BoardContextMenu }

function hasEntity(e) { return Array.from(e.dataTransfer?.types || []).includes(ENTITY_MIME) }

/**
 * The tldraw surface for one board. Loads the saved document once, autosaves user edits to the
 * server (debounced, flushed on unmount / tab hide), follows the app theme, and accepts palette
 * drops as linked cards. Opening cards and promoting notes go through `cardBridge` to the host.
 */
export default function BoardCanvas({ board, store, theme, onSaveState, editorRef }) {
  const [snapshot] = useState(() => (board.document?.store ? board.document : undefined))
  const [dropping, setDropping] = useState(false)
  const editorHandle = useRef(null)
  const dirty = useRef(false)
  const saveTimer = useRef(null)
  const report = useRef(onSaveState)
  report.current = onSaveState

  const persist = useCallback(async ({ keepalive = false } = {}) => {
    const editor = editorHandle.current
    if (!editor || !dirty.current) return
    dirty.current = false
    report.current?.('saving')
    try {
      await saveBoardDocument(board.id, getSnapshot(editor.store).document, { keepalive })
      if (!dirty.current) report.current?.('saved')
    } catch {
      dirty.current = true
      report.current?.('error')
    }
  }, [board.id])

  const handleMount = useCallback((editor) => {
    editorHandle.current = editor
    editorRef?.(editor)
    // Snap guides while dragging and a faint grid make lining cards up effortless.
    editor.user.updateUserPreferences({ colorScheme: theme, isSnapMode: true })
    editor.updateInstanceState({ isGridMode: true })
    fitBoard(editor, false)
    const unlisten = editor.store.listen(({ changes }) => {
      // A card dragged into a lane frame (status / milestone / due week) updates the real item.
      if (!laneWrites.suppressed) {
        for (const [from, to] of Object.values(changes.updated)) {
          if (to.typeName !== 'shape' || to.type !== CARD_TYPE || from.parentId === to.parentId) continue
          const lane = editor.getShape(to.parentId)?.meta?.lane
          if (lane) cardBridge.onLaneDrop?.(to.props.entity, to.props.entityId, lane)
        }
      }
      dirty.current = true
      report.current?.('dirty')
      clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => persist(), SAVE_DELAY_MS)
    }, { scope: 'document', source: 'user' })
    return () => { unlisten(); editorRef?.(null) }
  }, [persist, editorRef, theme])

  // Theme is applied through tldraw's user preferences rather than its `colorScheme` prop, which
  // re-creates the editor (and resets the camera) on every switch.
  useEffect(() => { editorHandle.current?.user.updateUserPreferences({ colorScheme: theme }) }, [theme])

  // Never lose the last edits: flush when the tab hides and when the board unmounts.
  useEffect(() => {
    const flush = () => { clearTimeout(saveTimer.current); persist({ keepalive: true }) }
    window.addEventListener('pagehide', flush)
    return () => { window.removeEventListener('pagehide', flush); flush() }
  }, [persist])

  function onDragOver(e) {
    if (!hasEntity(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    if (!dropping) setDropping(true)
  }
  function onDragLeave(e) { if (!e.currentTarget.contains(e.relatedTarget)) setDropping(false) }
  function onDrop(e) {
    if (!hasEntity(e)) return
    e.preventDefault()
    e.stopPropagation()
    setDropping(false)
    let payload
    try { payload = JSON.parse(e.dataTransfer.getData(ENTITY_MIME)) } catch { return }
    const editor = editorHandle.current
    if (!editor || !payload?.entity || !payload?.id) return
    placeCard(editor, payload.entity, payload.id, editor.screenToPage({ x: e.clientX, y: e.clientY }))
  }

  return (
    <div className="board-canvas" data-dropping={dropping} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <EntityProvider value={store}>
        <Tldraw
          snapshot={snapshot}
          shapeUtils={shapeUtils}
          components={components}
          onMount={handleMount}
          licenseKey={LICENSE_KEY}
          assetUrls={assetUrls}
          options={{ maxPages: 1 }}
        />
      </EntityProvider>
    </div>
  )
}
