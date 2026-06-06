const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

export function sortByDueDate(tasks) {
  return [...tasks].sort((a, b) => {
    if (!a.due_date && !b.due_date) return 0
    if (!a.due_date) return 1
    if (!b.due_date) return -1
    return a.due_date.localeCompare(b.due_date)
  })
}

export function formatShortDate(iso) {
  const d = new Date(iso + 'T00:00:00')
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`
}

export function getDueDateMeta(due) {
  if (!due) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const dueDate = new Date(due + 'T00:00:00')
  const diff = Math.round((dueDate - today) / (1000 * 60 * 60 * 24))

  if (diff < 0) return { label: `Overdue · ${formatShortDate(due)}`, cls: 'text-terra-400 bg-terra-100' }
  if (diff === 0) return { label: 'Due today', cls: 'text-gold-500 bg-gold-50' }
  if (diff === 1) return { label: 'Due tomorrow', cls: 'text-gold-400 bg-gold-50' }
  if (diff <= 7) return { label: `Due ${formatShortDate(due)}`, cls: 'text-sand-500 bg-sand-100' }
  return { label: `Due ${formatShortDate(due)}`, cls: 'text-sand-400 bg-sand-50' }
}
