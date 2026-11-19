import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from '../../components/Icon'
import { notify } from '../../components/Notice'
import { askConfirm } from '../../components/askConfirm'
import { deleteBlock, moveBlock, overrideRhythmDay, restoreRhythmDay, shiftRhythmDay } from '../../api'
import { fmtClock, fmtDuration, fmtMinutes } from '../today/format'
import {
  EVENT_MIN, ZOOMS, assignLanes, dragDuration, dragStart, dragStartEdge, hourTicks, layoutItems, minutesAtY,
  overlapsAny, toHHMM, visibleWindow,
} from './geometry'

// Today as ONE time-based day. Rhythm blocks are the background bands that give the
// day its shape; every task, ticket and habit with a time is a card at that time on
// top of them; untimed work sits inside its block, or in the Anytime lane when no
// block holds it. Every item carries its actions (⋯): start, done, notes, time,
// later, delete. Drag cards and blocks to restructure the day; drag empty space to
// draw a new block. Changes to blocks here are for this day only.
const SOURCE_COLOR = { task: 'rgb(var(--accent))', ticket: 'rgb(96 165 250)', worklog: 'rgb(var(--chart-5))', habit: 'rgb(var(--gold))' }
const SOURCE_LABEL = { task: 'Task', ticket: 'Ticket', worklog: 'Log', habit: 'Habit' }
const CARD_INSET = '42%'    // cards over a block start here so the block's own content stays readable

function nowMinutes() { const d = new Date(); return d.getHours() * 60 + d.getMinutes() }
function storage(key, fallback) { try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v) } catch { return fallback } }
function remember(key, value) { try { localStorage.setItem(key, JSON.stringify(value)) } catch {} }
const isControl = el => !!el.closest?.('button, a, input, select, textarea, [data-no-drag]')

// ── The per-item action menu ──────────────────────────────────────────────────
function ItemMenu({ menu, timer, actions, onClose }) {
  const ref = useRef(null)
  const i = menu.item
  useEffect(() => {
    const away = e => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    const key = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('pointerdown', away, true); window.addEventListener('keydown', key)
    return () => { document.removeEventListener('pointerdown', away, true); window.removeEventListener('keydown', key) }
  }, [onClose])
  const done = i.status === 'done'
  const isTask = i.source === 'task', isTicket = i.source === 'ticket', isHabit = i.source === 'habit'
  const running = isTask && timer?.taskId === i.item_id && timer.running
  const paused = isTask && timer?.taskId === i.item_id && !timer.running
  const run = fn => () => { onClose(); fn() }
  const left = Math.min(menu.rect.right - 210, window.innerWidth - 222)
  const top = Math.min(menu.rect.bottom + 4, window.innerHeight - 330)
  return createPortal(
    <div ref={ref} className="item-menu" role="menu" aria-label={`Actions for ${i.title}`} style={{ left: Math.max(8, left), top: Math.max(8, top) }}>
      <p className="item-menu-title">{i.title}</p>
      {!done && isTask && (running
        ? <button role="menuitem" onClick={run(actions.pause)}><Icon name="pause" size={13} />Pause</button>
        : paused ? <button role="menuitem" onClick={run(actions.resume)}><Icon name="play" size={13} />Resume</button>
        : <button role="menuitem" onClick={run(() => actions.start(i))}><Icon name="play" size={13} />Start</button>)}
      {!done && isTask && <button role="menuitem" onClick={run(() => actions.complete(i))}><Icon name="check" size={13} />Done</button>}
      {isHabit && <button role="menuitem" onClick={run(() => actions.toggleHabit(i))}><Icon name="check" size={13} />{done ? 'Uncheck' : 'Check off'}</button>}
      {isTicket
        ? <button role="menuitem" onClick={run(() => actions.openTicket(i))}><Icon name="arrow" size={13} />Open</button>
        : <button role="menuitem" onClick={run(() => actions.notes(i))}><Icon name="note" size={13} />Notes</button>}
      {!done && (
        <label className="item-menu-time" onClick={e => e.stopPropagation()}>
          <Icon name="clock" size={13} /><span>Time</span>
          <input type="time" step="900" defaultValue={i.scheduled_time || ''} aria-label={`Time for ${i.title}`}
            onKeyDown={e => { if (e.key === 'Enter') { onClose(); actions.setTime(i, e.currentTarget.value || null) } }}
            onBlur={e => { if ((e.target.value || '') !== (i.scheduled_time || '')) { onClose(); actions.setTime(i, e.target.value || null) } }} />
          {i.scheduled_time && <button type="button" className="item-menu-clear" onClick={run(() => actions.setTime(i, null))}>Clear</button>}
        </label>
      )}
      {!done && i.off_block && <><span className="item-menu-sep" /><p className="item-menu-note">Outside your {i.off_block.title} block</p>
        <button role="menuitem" onClick={run(() => actions.moveIntoBlock(i))}><Icon name="arrow" size={13} />Move into block</button>
        <button role="menuitem" onClick={run(() => actions.addBlockHere(i))}><Icon name="plus" size={13} />Add {i.off_block.title} block here</button>
        <span className="item-menu-sep" /></>}
      {!done && (isTask || isTicket) && <button role="menuitem" onClick={run(() => actions.postpone(i))}><Icon name="arrow" size={13} />Later…</button>}
      {(isTask || isTicket) && actions.fixTime && ((i.recorded_seconds || 0) + (i.live_seconds || 0) > 0 || running) && <button role="menuitem" onClick={run(() => actions.fixTime(i))}><Icon name="clock" size={13} />Fix time…</button>}
      {done && !isHabit && <button role="menuitem" onClick={run(() => actions.undo(i))}><Icon name="undo" size={13} />Undo done</button>}
      {(isTask || isTicket) && <><span className="item-menu-sep" /><button role="menuitem" className="is-danger" onClick={run(() => actions.remove(i))}><Icon name="trash" size={13} />Delete</button></>}
    </div>, document.body)
}

export default function DayCalendar({
  workspace, isToday, timer, actions,
  onAddToBlock, onEditRhythm, onChanged, onCreateBlock, onEditBlock,
}) {
  const [, tick] = useState(0)
  useEffect(() => { const id = setInterval(() => tick(n => n + 1), 30000); return () => clearInterval(id) }, [])
  const [zoomIdx, setZoomIdx] = useState(() => Math.min(ZOOMS.length - 1, Math.max(0, storage('basira_cal_zoom', 2))))
  const [height, setHeight] = useState(() => storage('basira_cal_height', null))
  const [selected, setSelected] = useState(null)
  const [menu, setMenu] = useState(null)       // { item, rect }
  const [drag, setDrag] = useState(null)
  const [busy, setBusy] = useState(null)
  const rootRef = useRef(null), scrollRef = useRef(null), gridRef = useRef(null)
  const px = ZOOMS[zoomIdx]

  const blocks = workspace?.blocks || []
  const allItems = useMemo(() => [...(workspace?.agenda || []), ...(workspace?.unscheduled || [])], [workspace])
  const { events, anytime, inBlock } = useMemo(() => layoutItems(allItems, blocks), [allItems, blocks])
  const now = isToday ? nowMinutes() : null
  const win = visibleWindow({ dayStart: workspace?.totals?.day_start, dayEnd: workspace?.totals?.day_end, blocks: [...blocks, ...events], nowMinutes: now })
  const gridHeight = (win.end - win.start) * px
  const blockLanes = useMemo(() => assignLanes(blocks), [blocks])
  const eventLanes = useMemo(() => assignLanes(events), [events])
  const date = workspace?.date
  const current = now != null ? blocks.find(b => b.start_minutes <= now && now < b.start_minutes + b.duration_minutes) : null
  const skipped = workspace?.skipped_blocks || []
  const openMenu = (e, item) => { e.stopPropagation(); setSelected(null); setMenu({ item, rect: e.currentTarget.getBoundingClientRect() }) }
  const primary = i => (i.source === 'ticket' ? actions.openTicket(i) : actions.notes(i))

  // Open with "now" a third of the way down.
  const scrolledRef = useRef(false)
  useLayoutEffect(() => {
    if (scrolledRef.current || !scrollRef.current || now == null || !workspace) return
    scrolledRef.current = true
    scrollRef.current.scrollTop = Math.max(0, (now - win.start) * px - scrollRef.current.clientHeight / 3)
  })
  function scrollToNow() { if (scrollRef.current && now != null) scrollRef.current.scrollTo({ top: Math.max(0, (now - win.start) * px - scrollRef.current.clientHeight / 3), behavior: 'smooth' }) }
  function zoom(delta) { setZoomIdx(i => { const n = Math.min(ZOOMS.length - 1, Math.max(0, i + delta)); remember('basira_cal_zoom', n); return n }) }
  useEffect(() => {
    const el = scrollRef.current; if (!el) return
    const onWheel = e => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoom(e.deltaY < 0 ? 1 : -1) } }
    const onScroll = () => setMenu(null)
    el.addEventListener('wheel', onWheel, { passive: false }); el.addEventListener('scroll', onScroll)
    return () => { el.removeEventListener('wheel', onWheel); el.removeEventListener('scroll', onScroll) }
  }, [])
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') { setSelected(null); setDrag(null) } }
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ── Dragging: blocks (move / both edges), cards (move), anytime chips (onto the grid), drawing a block, the grip ──
  function begin(e, target) {
    if (e.button !== 0 || isControl(e.target)) return
    e.preventDefault(); e.stopPropagation()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    setMenu(null)
    setDrag({ ...target, startY: e.clientY, moved: false, cur: { start_minutes: target.obj?.start_minutes, duration_minutes: target.obj?.duration_minutes } })
  }
  function onPointerMove(e) {
    if (!drag) return
    const dy = e.clientY - drag.startY
    if (!drag.moved && Math.abs(dy) < 3) return
    const gridTop = gridRef.current?.getBoundingClientRect().top ?? 0
    setDrag(d => {
      const o = d.obj
      if (d.type === 'grip') return { ...d, moved: true, cur: { height: Math.max(320, d.base + dy) } }
      if (d.type === 'create') { const m = minutesAtY(e.clientY, gridTop, px, win); return { ...d, moved: true, cur: { start_minutes: Math.min(d.anchor, m), duration_minutes: Math.max(15, Math.abs(m - d.anchor)) } } }
      if (d.type === 'chip') return { ...d, moved: true, cur: { start_minutes: minutesAtY(e.clientY, gridTop, px, win), inside: e.clientY >= gridTop && e.clientY <= gridTop + gridHeight } }
      if (d.mode === 'move') return { ...d, moved: true, cur: { ...d.cur, start_minutes: dragStart(o, dy, px, win) } }
      if (d.mode === 'resize-end') return { ...d, moved: true, cur: { ...d.cur, duration_minutes: dragDuration(o, dy, px) } }
      return { ...d, moved: true, cur: dragStartEdge(o, dy, px, win) }
    })
  }
  async function onPointerUp() {
    if (!drag) return
    const d = drag; setDrag(null)
    if (d.type === 'grip') { if (d.moved) { setHeight(d.cur.height); remember('basira_cal_height', d.cur.height) } return }
    if (d.type === 'create') { if (d.moved) onCreateBlock?.({ start_minutes: d.cur.start_minutes, duration_minutes: d.cur.duration_minutes }); else setSelected(null); return }
    if (!d.moved) { if (d.type === 'block') setSelected(s => (s === d.obj.id ? null : d.obj.id)); return }
    if (d.type === 'chip') { if (d.cur.inside) await setTime(d.obj, d.cur.start_minutes); return }
    if (d.type === 'event') { if (d.cur.start_minutes !== d.obj.start_minutes) await setTime(d.obj.item, d.cur.start_minutes); return }
    const o = d.obj, c = d.cur
    if (c.start_minutes === o.start_minutes && c.duration_minutes === o.duration_minutes) return
    const patch = {}
    if (c.start_minutes !== o.start_minutes) patch.start_time = toHHMM(c.start_minutes)
    if (c.duration_minutes !== o.duration_minutes) patch.duration_minutes = c.duration_minutes
    await saveBlock(o, patch)
  }
  async function setTime(item, minutes) {
    try { await actions.setTime(item, toHHMM(minutes)); onChanged?.() } catch (err) { notify(err.message) }
  }
  async function saveBlock(b, patch) {
    setBusy(b.id)
    try {
      if (b.rhythm_id) await overrideRhythmDay({ rhythm_id: b.rhythm_id, date, ...patch })
      else await moveBlock(b.id, { ...patch, revision: b.revision })
      onChanged?.()
    } catch (err) { notify(err.message) } finally { setBusy(null) }
  }
  async function skip(b) {
    setBusy(b.id); setSelected(null)
    try { await overrideRhythmDay({ rhythm_id: b.rhythm_id, date, skipped: true }); notify(`“${b.title}” skipped for today`, { title: 'Skipped' }); onChanged?.() }
    catch (err) { notify(err.message) } finally { setBusy(null) }
  }
  async function restore(b) { try { await restoreRhythmDay(b.rhythm_id, date); onChanged?.() } catch (err) { notify(err.message) } }
  async function removeAdhoc(b) {
    if (!(await askConfirm(`Remove “${b.title}” from today?`, { title: 'Remove block', confirmLabel: 'Remove' }))) return
    try { await deleteBlock(b.id); setSelected(null); onChanged?.() } catch (err) { notify(err.message) }
  }
  async function runLate(minutes) {
    const from = toHHMM(now ?? win.start)
    try { await shiftRhythmDay(date, from, minutes); notify(`Everything from ${fmtClock(from)} moved ${minutes} min later`, { title: 'Replanned' }); onChanged?.() }
    catch (err) { notify(err.message) }
  }

  const live = b => (drag && drag.type === 'block' && drag.obj.id === b.id) ? { ...b, ...drag.cur } : b
  const liveEvent = ev => (drag && drag.type === 'event' && drag.obj.id === ev.id) ? { ...ev, start_minutes: drag.cur.start_minutes } : ev
  const tooltip = drag?.moved && !['grip', 'create'].includes(drag.type) && (drag.type === 'chip' ? drag.cur.inside : true)
    ? { top: (drag.cur.start_minutes - win.start) * px, text: drag.type === 'chip' ? `${fmtClock(toHHMM(drag.cur.start_minutes))} · ${drag.obj.title}` : `${fmtClock(toHHMM(drag.cur.start_minutes))} – ${fmtClock(toHHMM(drag.cur.start_minutes + (drag.cur.duration_minutes ?? drag.obj.duration_minutes)))}` }
    : null
  const selectedBlock = blocks.find(b => b.id === selected) || null

  const control = i => {
    const done = i.status === 'done'
    if (i.source === 'habit') return <button onClick={() => actions.toggleHabit(i)} className={`cal-check ${done ? 'is-on' : ''}`} aria-label={`${done ? 'Uncheck' : 'Check'} ${i.title}`}>{done ? '✓' : ''}</button>
    if (i.source === 'task' && done) return <span className="cal-check is-on" aria-hidden="true">✓</span>
    if (i.source === 'task') {
      const mine = timer?.taskId === i.item_id
      return <button onClick={() => (mine && timer.running ? actions.pause() : mine ? actions.resume() : actions.start(i))} className="cal-play" aria-label={`${mine && timer.running ? 'Pause' : 'Start'} ${i.title}`}><Icon name={mine && timer.running ? 'pause' : 'play'} size={10} /></button>
    }
    return <span className="cal-dot" style={{ background: SOURCE_COLOR[i.source] }} />
  }
  const moreBtn = i => <button className="cal-more" onClick={e => openMenu(e, i)} aria-label={`Actions for ${i.title}`} aria-haspopup="menu">⋯</button>

  return (
    <div className={`cal ${drag ? `is-dragging-${drag.type}` : ''}`} data-testid="day-calendar" ref={rootRef} style={height ? { height } : undefined}
      onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
      <div className="cal-toolbar">
        <div className="flex items-center gap-2 min-w-0">
          <p className="eyebrow">Day</p>
          {current && <span className="cal-chip is-live"><span className="status-dot live" />{current.title} · {fmtMinutes(current.start_minutes + current.duration_minutes - now)} left</span>}
          {!blocks.length && <button onClick={onEditRhythm} className="cal-chip is-draggable" title="Give your days a repeating shape">＋ Set up your day rhythm</button>}
        </div>
        <div className="cal-tools">
          {isToday && <button onClick={scrollToNow} className="cal-tool" title="Scroll to now">Now</button>}
          <div className="cal-zoom" role="group" aria-label="Zoom">
            <button onClick={() => zoom(-1)} disabled={zoomIdx === 0} className="cal-tool" aria-label="Zoom out" title="Zoom out (⌘ + scroll)">−</button>
            <span className="cal-zoom-label">{Math.round(px * 100)}%</span>
            <button onClick={() => zoom(1)} disabled={zoomIdx === ZOOMS.length - 1} className="cal-tool" aria-label="Zoom in" title="Zoom in (⌘ + scroll)">+</button>
          </div>
          {isToday && blocks.length > 0 && <button onClick={() => runLate(30)} className="cal-tool" title="Push everything from now by 30 minutes"><Icon name="clock" size={13} />Late +30</button>}
          {onCreateBlock && <button onClick={() => onCreateBlock({ start_minutes: Math.ceil((now ?? win.start) / 15) * 15, duration_minutes: 60 })} className="cal-tool" title="Add a block to this day, or pull one from your rhythm (or drag on empty space)"><Icon name="plus" size={13} />Block</button>}
          <button onClick={onEditRhythm} className="cal-tool" title="The repeating shape of your days"><Icon name="settings" size={13} />Rhythm</button>
        </div>
      </div>

      {anytime.length > 0 && (
        <div className="cal-anytime" data-testid="cal-anytime">
          <span className="cal-anytime-label">Anytime</span>
          <div className="cal-anytime-chips">
            {anytime.map(i => (
              <div key={i.key} data-testid="day-item" data-title={i.title}
                className={`cal-chip is-draggable ${drag?.type === 'chip' && drag.obj.key === i.key ? 'is-dragging' : ''} ${i.active ? 'is-live' : ''}`}
                style={{ '--chip-color': SOURCE_COLOR[i.source] }} title="Drag onto the day to give it a time"
                onPointerDown={e => begin(e, { type: 'chip', obj: i })}>
                {control(i)}
                <button className="cal-chip-title" onClick={() => primary(i)}>{i.title}</button>
                {moreBtn(i)}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="cal-scroll" ref={scrollRef} onPointerDown={e => {
        if (e.target.classList.contains('cal-col')) {   // empty grid: drag draws a new block, a click clears the selection
          const gridTop = gridRef.current?.getBoundingClientRect().top ?? 0
          const anchor = minutesAtY(e.clientY, gridTop, px, win)
          e.preventDefault(); e.currentTarget.setPointerCapture?.(e.pointerId); setMenu(null)
          setDrag({ type: 'create', anchor, startY: e.clientY, moved: false, cur: { start_minutes: anchor, duration_minutes: 0 } })
        } else if (e.target === e.currentTarget || e.target.classList.contains('cal-gutter')) setSelected(null)
      }}>
        <div className="cal-wrap" style={{ height: gridHeight }}>
          <div className="cal-gutter">
            {hourTicks(win).map(m => (
              <div key={m} className="cal-hour" style={{ top: (m - win.start) * px }}>{fmtClock(toHHMM(m)).replace(':00', '')}</div>
            ))}
          </div>
          <div className="cal-col" ref={gridRef} style={{ backgroundSize: `100% ${60 * px}px, 100% ${30 * px}px` }}>
            {!blocks.length && !events.length && (
              <p className="cal-hint">Drag on the day to draw a block, or drag work from Anytime onto a time.</p>
            )}

            {/* Blocks: the shape of the day */}
            {blockLanes.map(({ block: raw, lane, lanes: n }) => {
              const b = live(raw)
              const top = (b.start_minutes - win.start) * px, h = Math.max(26, b.duration_minutes * px)
              const isWork = b.kind === 'project' || b.kind === 'client'
              const done = b.recorded_seconds + b.live_seconds
              const pct = b.duration_minutes ? Math.min(100, Math.round((done / 60 / b.duration_minutes) * 100)) : 0
              const its = inBlock[raw.id] || []
              const hasCards = events.some(ev => overlapsAny(ev, [b]))
              const rows = h >= 56 ? Math.max(1, Math.floor((h - 40) / 22)) : 0
              const style = { top, height: h, left: `calc(${(lane / n) * 100}% + 4px)`, width: `calc(${100 / n}% - 8px)` }
              if (b.color) style['--block-color'] = b.color
              return (
                <div key={raw.id} data-testid="cal-block" data-kind={b.kind}
                  className={`cal-block cal-block-${b.kind} ${hasCards ? 'has-cards' : ''} ${current?.id === raw.id ? 'is-live' : ''} ${b.virtual ? '' : 'is-changed'} ${selected === raw.id ? 'is-selected' : ''} ${busy === raw.id ? 'is-busy' : ''} ${drag?.obj?.id === raw.id ? 'is-dragging' : ''}`}
                  style={style} onPointerDown={e => begin(e, { type: 'block', obj: raw, mode: 'move' })}>
                  {isWork && <div className="cal-fill" style={{ height: `${pct}%` }} aria-hidden="true" />}
                  <div className="cal-handle cal-handle-top" onPointerDown={e => begin(e, { type: 'block', obj: raw, mode: 'resize-start' })} />
                  <div className="cal-block-inner">
                    <div className="cal-block-head">
                      <span className="cal-block-title">{b.title}</span>
                      <span className="cal-block-time">{fmtClock(toHHMM(b.start_minutes))} – {fmtClock(toHHMM(b.start_minutes + b.duration_minutes))}</span>
                      {isWork && h > 40 && <span className="cal-block-budget">{done > 0 ? `${fmtDuration(done)} / ` : ''}{fmtMinutes(b.duration_minutes)}</span>}
                    </div>
                    {rows > 0 && its.length > 0 && (
                      <ul className="cal-items">
                        {its.slice(0, rows).map(i => (
                          <li key={i.key} className={`cal-item ${i.status === 'done' ? 'is-done' : ''}`} data-testid="day-item" data-title={i.title}>
                            {control(i)}
                            <button className="cal-item-title" onClick={() => primary(i)}>{i.title}</button>
                            {moreBtn(i)}
                          </li>
                        ))}
                        {its.length > rows && <li className="cal-item text-faint">+{its.length - rows} more · zoom in</li>}
                      </ul>
                    )}
                  </div>
                  <div className="cal-handle cal-handle-bottom" onPointerDown={e => begin(e, { type: 'block', obj: raw, mode: 'resize-end' })} />
                </div>
              )
            })}

            {/* Cards: every task, ticket and habit with a time, at that time */}
            {eventLanes.map(({ block: raw, lane, lanes: n }) => {
              const ev = liveEvent(raw), i = ev.item
              const top = (ev.start_minutes - win.start) * px, h = Math.max(26, ev.duration_minutes * px)
              const over = overlapsAny(raw, blocks)
              const base = over ? CARD_INSET : '0%'
              const style = {
                top, height: h, '--event-color': SOURCE_COLOR[i.source],
                left: `calc(${base} + (100% - ${base}) * ${lane / n} + 4px)`,
                width: `calc((100% - ${base}) / ${n} - 8px)`,
              }
              return (
                <div key={ev.id} data-testid="cal-event" data-title={i.title}
                  className={`cal-event ${i.status === 'done' ? 'is-done' : ''} ${i.active ? 'is-live' : ''} ${drag?.obj?.id === ev.id ? 'is-dragging' : ''}`}
                  style={style} onPointerDown={e => begin(e, { type: 'event', obj: raw, mode: 'move' })} title="Drag to change its time">
                  <div className="cal-event-row">
                    {control(i)}
                    <button className="cal-event-title" onClick={() => primary(i)}>{i.title}</button>
                    {i.off_block && i.status !== 'done' && <button className="cal-off" onClick={e => openMenu(e, i)} title={`Outside your ${i.off_block.title} block (${fmtClock(i.off_block.start_time)}). Move it in, or add a block here.`} aria-label={`${i.title} is outside its ${i.off_block.title} block`}>!</button>}
                    <span className="cal-event-time">{fmtClock(toHHMM(ev.start_minutes))}</span>
                    {moreBtn(i)}
                  </div>
                  {h > 40 && <p className="cal-event-meta">{SOURCE_LABEL[i.source]}{i.project_title ? ` · ${i.project_title}` : ''}{i.planned_minutes ? ` · ${fmtMinutes(i.planned_minutes)}` : ''}</p>}
                </div>
              )
            })}

            {/* Floating toolbar for the selected block */}
            {selectedBlock && !drag && (() => {
              const b = selectedBlock
              const its = [...(inBlock[b.id] || []), ...events.filter(ev => overlapsAny(ev, [b])).map(ev => ev.item)]
              const firstTask = its.find(i => i.source === 'task' && i.status !== 'done')
              const firstTicket = its.find(i => i.source === 'ticket' && i.status !== 'done')
              const isWork = b.kind === 'project' || b.kind === 'client'
              const top = (b.start_minutes - win.start) * px
              const above = top >= 44
              return (
                <div className={`cal-float ${above ? '' : 'is-below'}`} style={{ top: above ? top : top + 6 }} data-no-drag data-testid="cal-float" role="toolbar" aria-label={`${b.title} actions`}>
                  {isWork && <button className="cal-float-btn" onClick={() => firstTask ? actions.start(firstTask) : firstTicket ? actions.openTicket(firstTicket) : onAddToBlock?.(b)}><Icon name={firstTask || firstTicket ? 'play' : 'plus'} size={12} />{firstTask || firstTicket ? 'Start' : 'Add work'}</button>}
                  {onEditBlock && <button className="cal-float-btn" onClick={() => { setSelected(null); onEditBlock(b) }}><Icon name="note" size={12} />Edit</button>}
                  {b.rhythm_id && !b.added && <button className="cal-float-btn" onClick={() => skip(b)}><Icon name="close" size={12} />Skip today</button>}
                  {b.rhythm_id && b.added && <button className="cal-float-btn" onClick={() => restore(b)}><Icon name="close" size={12} />Remove from today</button>}
                  {b.rhythm_id && !b.virtual && !b.added && <button className="cal-float-btn" onClick={() => restore(b)}><Icon name="undo" size={12} />Reset</button>}
                  {!b.rhythm_id && <button className="cal-float-btn" onClick={() => removeAdhoc(b)}><Icon name="trash" size={12} />Remove</button>}
                  <span className="cal-float-sep" />
                  <button className="cal-float-btn" onClick={() => setSelected(null)} aria-label="Close"><Icon name="close" size={12} /></button>
                </div>
              )
            })()}

            {drag?.type === 'chip' && drag.moved && drag.cur.inside && (
              <div className="cal-ghost" style={{ top: (drag.cur.start_minutes - win.start) * px, height: EVENT_MIN * px }} />
            )}
            {drag?.type === 'create' && drag.moved && (
              <div className="cal-ghost is-create" style={{ top: (drag.cur.start_minutes - win.start) * px, height: drag.cur.duration_minutes * px }}>
                <span>New block · {fmtMinutes(drag.cur.duration_minutes)}</span>
              </div>
            )}
            {tooltip && <div className="cal-tooltip" style={{ top: tooltip.top }}>{tooltip.text}</div>}
            {now != null && now >= win.start && now <= win.end && (
              <div className="cal-now" style={{ top: (now - win.start) * px }} aria-label="Now"><span className="cal-now-label">{fmtClock(toHHMM(now))}</span></div>
            )}
          </div>
        </div>
      </div>

      {skipped.length > 0 && (
        <p className="cal-skipped">
          <span>Skipped today:</span>
          {skipped.map(b => <button key={b.rhythm_id} onClick={() => restore(b)} className="underline hover:text-ink">{b.title} · restore</button>)}
        </p>
      )}
      <div className="cal-grip" title="Drag to resize" onPointerDown={e => begin(e, { type: 'grip', base: rootRef.current?.getBoundingClientRect().height || 600 })}><span /></div>
      {menu && <ItemMenu menu={menu} timer={timer} actions={actions} onClose={() => setMenu(null)} />}
    </div>
  )
}
