export function localDate(value = new Date()) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

export function shiftPeriod(anchor, mode, direction) {
  const d = new Date(`${anchor}T12:00:00`)
  if (mode === 'month') {
    d.setDate(1)
    d.setMonth(d.getMonth() + direction)
  } else d.setDate(d.getDate() + direction * 7)
  return localDate(d)
}

export function periodRange(mode, anchor, start, end, today = localDate()) {
  if (mode === 'custom') return { start, end }
  const first = new Date(`${anchor}T12:00:00`)
  const last = new Date(first)
  if (mode === 'month') {
    first.setDate(1)
    last.setMonth(last.getMonth() + 1, 0)
  } else {
    first.setDate(first.getDate() - (first.getDay() + 6) % 7)
    last.setTime(first.getTime())
    last.setDate(last.getDate() + 6)
  }
  return { start: localDate(first), end: localDate(last) > today ? today : localDate(last) }
}

export function formatWorkTime(seconds) {
  const total = Math.max(0, Math.round(seconds || 0))
  const h = Math.floor(total / 3600), m = Math.floor(total % 3600 / 60), s = total % 60
  return [h && `${h}h`, m && `${m}m`, s && `${s}s`].filter(Boolean).join(' ') || '0m'
}

export function displayDate(date) {
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function typeLabel(type) {
  return type === 'code' ? 'Code' : type.charAt(0).toUpperCase() + type.slice(1)
}

export function buildWorkReport(data, detail = 'summary', markdown = false) {
  const heading = (text, level = 2) => markdown ? `${'#'.repeat(level)} ${text}` : text
  const line = text => String(text || '').replace(/[\r\n]+/g, ' ').trim()
  const lines = [heading(`Work report — ${line(data.company_name)}`, 1),
    `${data.date_from} to ${data.date_to}`, `Total logged time: ${formatWorkTime(data.total_seconds)}`, '']
  if (!data.entries.length) {
    lines.push('No work time entries recorded for this period.')
    return lines.join('\n')
  }
  if (detail === 'detailed') {
    lines.push(heading('Daily timesheet'))
    for (const day of data.by_day) {
      const entries = data.entries.filter(e => e.date === day.date)
      if (!entries.length) continue
      lines.push(`${day.date} — ${formatWorkTime(day.seconds)}`)
      for (const entry of entries) {
        const ref = entry.ticket_ref ? ` [${line(entry.ticket_ref)}]` : ''
        lines.push(`- ${line(entry.company_name)} · ${line(entry.title)}${ref} — ${formatWorkTime(entry.seconds)}${entry.note ? ` · ${line(entry.note)}` : ''}`)
      }
      lines.push('')
    }
  } else {
    lines.push(heading('Work logged'))
    const items = new Map()
    for (const entry of data.entries) {
      const key = `${entry.source}:${entry.item_id}`
      if (!items.has(key)) items.set(key, { ...entry, seconds: 0 })
      items.get(key).seconds += entry.seconds
    }
    for (const entry of items.values()) {
      const ref = entry.ticket_ref ? ` [${line(entry.ticket_ref)}]` : ''
      lines.push(`- ${line(entry.company_name)} · ${line(entry.title)}${ref} — ${formatWorkTime(entry.seconds)}`)
    }
    lines.push('')
  }
  lines.push(heading('Time by activity'))
  for (const [type, seconds] of Object.entries(data.by_type).sort((a, b) => b[1] - a[1])) {
    lines.push(`- ${typeLabel(type)}: ${formatWorkTime(seconds)}`)
  }
  lines.push('', 'Based on saved work dates. Running timers are included after they are stopped.')
  return lines.join('\n')
}
