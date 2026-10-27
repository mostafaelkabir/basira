export const NAV_ITEMS = [
  { id: 'today', label: 'Today', group: 'Do' },
  { id: 'goals', label: 'Goals', group: 'Do' },
  { id: 'work', label: 'Work', group: 'Do' },
  { id: 'boards', label: 'Boards', group: 'Do' },
  { id: 'journal', label: 'Journal', group: 'Reflect' },
  { id: 'progress', label: 'Progress', group: 'Reflect' },
  { id: 'connections', label: 'People', group: 'Reflect' },
  { id: 'profile', label: 'Profile', group: 'You' },
]
export function readRoute(hash) {
  const [page, id] = hash.replace(/^#\/?/, '').split('/')
  const tab = [...NAV_ITEMS.map(n => n.id), 'insights'].includes(page) ? page : 'today'
  try {
    const param = id ? decodeURIComponent(id) : null
    return { tab, goalId: tab === 'goals' ? param : null, boardId: tab === 'boards' ? param : null }
  }
  catch { return { tab, goalId: null, boardId: null } }
}
export function routeHref(tab, id) { return `#/${tab}${id ? `/${encodeURIComponent(id)}` : ''}` }
