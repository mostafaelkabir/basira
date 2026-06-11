async function request(url, options = {}) {
  const res = await fetch(url, options)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail || `Request failed: ${res.status}`)
  }
  if (res.status === 204) return null
  return res.json()
}

export const getGoals = (archived = false) => request(`/goals${archived ? '?archived=true' : ''}`)
export const getGoal = (id) => request(`/goals/${id}`)
export const createGoal = (data) =>
  request('/goals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
export const updateGoal = (id, data) =>
  request(`/goals/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
export const archiveGoal = (id) => request(`/goals/${id}/archive`, { method: 'POST' })
export const unarchiveGoal = (id) => request(`/goals/${id}/unarchive`, { method: 'POST' })
export const deleteGoal = (id) => request(`/goals/${id}`, { method: 'DELETE' })

export const getTask = (id) => request(`/tasks/${id}`)
export const taskAiQuery = (taskId, prompt) =>
  request(`/tasks/${taskId}/ai`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }) })
export const createTask = (data) =>
  request('/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
export const updateTask = (id, data) =>
  request(`/tasks/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
export const completeTask = (taskId) => request(`/tasks/${taskId}/complete`, { method: 'POST' })
export const deleteTask = (taskId) => request(`/tasks/${taskId}`, { method: 'DELETE' })
export const reorderTasks = (items) =>
  request('/tasks/reorder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(items) })

export const addProof = (taskId, data) =>
  request(`/tasks/${taskId}/proof`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })

export const uploadProofImage = (file) => {
  const form = new FormData()
  form.append('file', file)
  return request('/proofs/upload-image', { method: 'POST', body: form })
}

export const uploadGoalIcon = (file) => {
  const form = new FormData()
  form.append('file', file)
  return request('/proofs/upload-image', { method: 'POST', body: form })
}

export const uploadProofFile = (file) => {
  const form = new FormData()
  form.append('file', file)
  return request('/proofs/upload-file', { method: 'POST', body: form })
}

export const getToday = () => request('/today')
export const getOverview = () => request('/today/overview')
export const addDailyTask = (title) =>
  request('/today/daily-task', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) })

export const deferTask = (taskId, until) =>
  request(`/tasks/${taskId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deferred_until: until }) })

export const planTask = (taskId, date) =>
  request(`/tasks/${taskId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan_date: date }) })
export const unplanTask = (taskId) =>
  request(`/tasks/${taskId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan_date: null }) })

export const pinTask = (taskId, date) =>
  request(`/tasks/${taskId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pinned_date: date }) })
export const unpinTask = (taskId) =>
  request(`/tasks/${taskId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pinned_date: null }) })

export const addComment = (taskId, data) =>
  request(`/tasks/${taskId}/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(typeof data === 'string' ? { content: data } : data) })
export const updateComment = (commentId, content) =>
  request(`/comments/${commentId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) })
export const deleteComment = (commentId) => request(`/comments/${commentId}`, { method: 'DELETE' })

export const checkinHabit = (taskId) => request(`/tasks/${taskId}/checkin`, { method: 'POST' })
export const uncheckinHabit = (taskId) => request(`/tasks/${taskId}/checkin`, { method: 'DELETE' })

export const getContacts = () => request('/contacts')
export const createContact = (data) =>
  request('/contacts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
export const updateContact = (id, data) =>
  request(`/contacts/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
export const deleteContact = (id) => request(`/contacts/${id}`, { method: 'DELETE' })
export const logCall = (contactId, data) =>
  request(`/contacts/${contactId}/calls`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
export const deleteCall = (callId) => request(`/contacts/calls/${callId}`, { method: 'DELETE' })

export const uploadContactPhoto = (file) => {
  const form = new FormData()
  form.append('file', file)
  return request('/proofs/upload-image', { method: 'POST', body: form })
}

export const getWeeklyReview = () => request('/review/weekly')
export const getAnalytics = () => request('/analytics')

export const getActiveTimer = () => request('/timer/active')
export const startTimer = (taskId) =>
  request('/timer/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task_id: taskId }) })
export const pauseTimer = () => request('/timer/pause', { method: 'POST' })
export const getTaskTime = (taskId) => request(`/timer/task/${taskId}`)
export const getTimerToday = () => request('/timer/summary/today')
export const logManualTime = (taskId, durationMinutes) =>
  request('/timer/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task_id: taskId, duration_minutes: durationMinutes }) })

export const getSettings = () => request('/settings')
export const updateSettings = (data) =>
  request('/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })

// ── Work Tracker ──────────────────────────────────────────────────────────────
export const getCompanies = () => request('/companies')
export const createCompany = (data) =>
  request('/companies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
export const updateCompany = (id, data) =>
  request(`/companies/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
export const deleteCompany = (id) => request(`/companies/${id}`, { method: 'DELETE' })

export const getWorkLogs = (params = {}) => {
  const q = new URLSearchParams()
  if (params.company_id) q.set('company_id', params.company_id)
  if (params.date_from)  q.set('date_from',  params.date_from)
  if (params.date_to)    q.set('date_to',    params.date_to)
  if (params.status)     q.set('status',     params.status)
  return request(`/work-logs?${q}`)
}
export const createWorkLog = (data) =>
  request('/work-logs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
export const updateWorkLog = (id, data) =>
  request(`/work-logs/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
export const deleteWorkLog = (id) => request(`/work-logs/${id}`, { method: 'DELETE' })
export const startWorkTimer = (logId) => request(`/work-logs/${logId}/timer/start`, { method: 'POST' })
export const stopWorkTimer  = (logId) => request(`/work-logs/${logId}/timer/stop`,  { method: 'POST' })
export const getWeeklyWorkStats = (params = {}) => {
  const q = new URLSearchParams()
  if (params.date_from) q.set('date_from', params.date_from)
  if (params.date_to)   q.set('date_to',   params.date_to)
  return request(`/work-logs/stats/weekly?${q}`)
}
export const generateWorkAI = (mode, dateFrom, dateTo) =>
  request('/work-logs/ai/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, date_from: dateFrom, date_to: dateTo }),
  })

// ── Work Tickets ───────────────────────────────────────────────────────────────
export const getWorkTickets = (params = {}) => {
  const q = new URLSearchParams()
  if (params.company_id) q.set('company_id', params.company_id)
  if (params.status)     q.set('status',     params.status)
  return request(`/work-tickets?${q}`)
}
export const getWorkTicket = (id) => request(`/work-tickets/${id}`)
export const createWorkTicket = (data) =>
  request('/work-tickets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
export const updateWorkTicket = (id, data) =>
  request(`/work-tickets/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
export const deleteWorkTicket = (id) => request(`/work-tickets/${id}`, { method: 'DELETE' })
export const logTimeToTicket = (ticketId, data) =>
  request(`/work-tickets/${ticketId}/log`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
export const deleteTimeEntry = (ticketId, entryId) =>
  request(`/work-tickets/${ticketId}/log/${entryId}`, { method: 'DELETE' })
export const startTicketTimer = (ticketId) =>
  request(`/work-tickets/${ticketId}/timer/start`, { method: 'POST' })
export const stopTicketTimer  = (ticketId) =>
  request(`/work-tickets/${ticketId}/timer/stop`,  { method: 'POST' })
export const addTicketComment = (ticketId, data) =>
  request(`/work-tickets/${ticketId}/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
export const updateTicketComment = (ticketId, commentId, body) =>
  request(`/work-tickets/${ticketId}/comments/${commentId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }) })
export const deleteTicketComment = (ticketId, commentId) =>
  request(`/work-tickets/${ticketId}/comments/${commentId}`, { method: 'DELETE' })

// ── Check-ins ──────────────────────────────────────────────────────────────
export const getTodayCheckin   = () => request('/checkins/today')
export const saveMorningCheckin = (data) =>
  request('/checkins/morning', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
export const saveEveningCheckin = (data) =>
  request('/checkins/evening', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })

// ── Journal ────────────────────────────────────────────────────────────────
export const getJournalEntries  = (limit = 30) => request(`/journal?limit=${limit}`)
export const getJournalByDate   = (date) => request(`/journal/date/${date}`)
export const saveJournalEntry   = (data) =>
  request('/journal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
export const updateJournalEntry = (id, data) =>
  request(`/journal/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
export const deleteJournalEntry = (id) => request(`/journal/${id}`, { method: 'DELETE' })
export const getJournalAI       = () => request('/journal/ai/reflect', { method: 'POST' })

// ── AI Tools ───────────────────────────────────────────────────────────────
export const polishText = (text, context = 'default') =>
  request('/ai/polish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, context }) })

// Polish / restore saved records
export const polishTicketComment  = (commentId) => request(`/ai/polish/ticket-comment/${commentId}`, { method: 'POST' })
export const restoreTicketComment = (commentId) => request(`/ai/restore/ticket-comment/${commentId}`, { method: 'POST' })
export const polishTaskComment    = (commentId) => request(`/ai/polish/task-comment/${commentId}`, { method: 'POST' })
export const restoreTaskComment   = (commentId) => request(`/ai/restore/task-comment/${commentId}`, { method: 'POST' })
export const polishJournalField   = (entryId, field) =>
  request(`/ai/polish/journal/${entryId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ field }) })
export const restoreJournalField  = (entryId, field) =>
  request(`/ai/restore/journal/${entryId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ field }) })

// ── Self-Knowledge Engine ─────────────────────────────────────────────────────
export const completeTaskWithFeeling = (taskId, feeling) =>
  request(`/tasks/${taskId}/complete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ feeling }) })
export const deferTaskWithReason = (taskId, deferredUntil, deferReason) =>
  request(`/tasks/${taskId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deferred_until: deferredUntil, defer_reason: deferReason }) })
export const stopTimerWithFocus = (focusQuality) =>
  request('/timer/pause', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ focus_quality: focusQuality }) })
export const saveAfternoonCheckin = (data) =>
  request('/checkins/afternoon', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
export const getAfternoonCheckin = (date) => request(`/checkins/afternoon/${date}`)
export const saveReflection = (data) =>
  request('/reflections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
export const getReflections = (limit = 20) => request(`/reflections?limit=${limit}`)
export const getReflection = (periodType, periodStart) => request(`/reflections/${periodType}/${periodStart}`)
export const getInsightsProfile = () => request('/insights/profile')
export const getProfileNarrative = (profile) =>
  request('/ai/profile-narrative', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profile }) })
export const generateWeekPlan = (weekStart) =>
  request('/plans/generate-week', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ week_start: weekStart }) })
export const saveWeekPlan = (weekStart, plan, aiRationale) =>
  request(`/plans/week/${weekStart}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan, ai_rationale: aiRationale }) })
export const getWeekPlan = (weekStart) => request(`/plans/week/${weekStart}`)

export const generateWeeklyReport = (companyId, dateFrom, dateTo) =>
  request('/work-tickets/report/weekly', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ company_id: companyId || null, date_from: dateFrom, date_to: dateTo }),
  })
