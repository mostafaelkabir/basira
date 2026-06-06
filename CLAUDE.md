# SysGo — Life OS · Complete Project Context

> Personal productivity app built by Mostafa El-Kabir. Tracks goals, daily tasks, habits, people relationships, and work/client tickets. Runs locally on macOS as a background service.

---

## Quick Start (after clone)

```bash
# 1. Python virtualenv
python3 -m venv venv
venv/bin/pip install -r requirements.txt

# 2. Frontend dependencies
cd frontend && npm install && npm run build && cd ..

# 3. Environment
cp .env.example .env   # or create .env manually — see "Environment" below

# 4. Run backend (serves built frontend at http://localhost:8001)
venv/bin/uvicorn app.main:app --port 8001
```

The backend auto-runs DB migrations on every start — no manual Alembic needed.

---

## Always-Running Background Service (macOS launchd)

The backend runs as a launchd service so it stays alive regardless of terminal state.

**Plist location:** `~/Library/LaunchAgents/com.sysgo.backend.plist`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>             <string>com.sysgo.backend</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/mostafaelkabir/Desktop/projects/sysgo-langgraph/venv/bin/uvicorn</string>
    <string>app.main:app</string>
    <string>--port</string>
    <string>8001</string>
  </array>
  <key>WorkingDirectory</key>  <string>/Users/mostafaelkabir/Desktop/projects/sysgo-langgraph</string>
  <key>RunAtLoad</key>         <true/>
  <key>KeepAlive</key>         <true/>
  <key>StandardOutPath</key>   <string>/tmp/sysgo-backend.log</string>
  <key>StandardErrorPath</key> <string>/tmp/sysgo-backend.log</string>
</dict>
</plist>
```

```bash
# Load / reload
launchctl load   ~/Library/LaunchAgents/com.sysgo.backend.plist
launchctl unload ~/Library/LaunchAgents/com.sysgo.backend.plist

# Logs
tail -f /tmp/sysgo-backend.log
```

**No separate frontend server** — the Vite app is built to `frontend/dist/` and served statically by FastAPI. After any frontend change, run `npm run build` from `frontend/`.

---

## Environment Variables

File: `.env` in project root (loaded by `python-dotenv` on startup)

```
GROQ_API_KEY=gsk_...   # Free Groq API key — used for all AI features via OpenAI-compatible endpoint
```

Groq model used: `llama-3.3-70b-versatile`  
Endpoint: `https://api.groq.com/openai/v1` (via `openai` Python package)

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Backend | Python 3.12 · FastAPI · SQLAlchemy (ORM) · SQLite (`sysgo.db`) |
| Frontend | React 18 · Vite · Tailwind CSS v3 · @dnd-kit (drag-and-drop) |
| AI | Groq API (llama-3.3-70b-versatile) via openai Python package |
| Scheduler | Python `threading` loop — fires macOS notifications via `osascript` |
| Uploads | Files saved to `uploads/` dir, served at `/uploads/{filename}` |

---

## Project Structure

```
sysgo-langgraph/
├── app/
│   ├── main.py              # FastAPI app, migrations, static SPA serving
│   ├── database.py          # SQLAlchemy engine + session (SQLite)
│   ├── scheduler.py         # Background thread: habit reminders via osascript
│   ├── storage.py           # File upload helpers
│   ├── models/
│   │   ├── goal.py          # Goal (resolution/project/daily), parent_id hierarchy
│   │   ├── task.py          # Task + sub-tasks (parent_task_id), habits, plan/pin
│   │   ├── comment.py       # Task comments (type: text | ai)
│   │   ├── proof.py         # Task proof attachments
│   │   ├── habit_log.py     # Daily habit check-ins
│   │   ├── work_session.py  # Timer sessions (task timer OR ticket timer)
│   │   ├── contact.py       # People CRM contacts
│   │   ├── call_log.py      # Call/interaction logs per contact
│   │   ├── company.py       # Work client companies
│   │   ├── work_log.py      # Quick standalone work log entries
│   │   ├── work_ticket.py   # Work tickets (Jira-like) + WorkTimeEntry + WorkTicketComment
│   │   ├── daily_snapshot.py# Daily score snapshot for analytics
│   │   ├── defer_log.py     # Task defer history
│   │   ├── setting.py       # Key-value settings store
│   │   └── execution_log.py # AI execution trace logs
│   ├── routes/
│   │   ├── goals.py         # CRUD + archive/unarchive + icon upload
│   │   ├── tasks.py         # CRUD + sub-tasks + AI comment endpoint
│   │   ├── today.py         # Today's pinned/planned tasks feed
│   │   ├── timer.py         # Task timer start/stop + manual time log
│   │   ├── habits.py        # Habit check-in endpoints
│   │   ├── proofs.py        # Proof upload/delete
│   │   ├── comments.py      # Task comments CRUD
│   │   ├── contacts.py      # People CRM CRUD + call log
│   │   ├── companies.py     # Work company CRUD
│   │   ├── work_logs.py     # Quick work log CRUD + timer + AI
│   │   ├── work_tickets.py  # Ticket CRUD + time entries + comments + timer
│   │   ├── analytics.py     # Progress stats, heatmap, velocity
│   │   ├── review.py        # Weekly review data
│   │   ├── settings_route.py# App settings CRUD
│   │   └── upload.py        # File upload endpoint
│   └── schemas/             # Pydantic schemas for serialization
├── frontend/
│   ├── src/
│   │   ├── App.jsx           # Root: sidebar nav + page routing
│   │   ├── api.js            # All fetch calls to backend (single source of truth)
│   │   ├── TodayPage.jsx     # Today view: focus cards + task list + planner
│   │   ├── GoalsPage.jsx     # Goals list (resolution/project/daily) + GoalIcon + GoalCard
│   │   ├── GoalPage.jsx      # Single goal detail: tasks, subtasks, progress
│   │   ├── WorkPage.jsx      # Work tracker: tickets + work log tabs + AI
│   │   ├── ContactsPage.jsx  # People CRM: contacts + call logs + status badges
│   │   ├── ProgressPage.jsx  # Analytics: stats, heatmap, velocity chart
│   │   ├── PlannerView.jsx   # Drag-and-drop daily planner (Today sub-view)
│   │   ├── WeeklyReview.jsx  # Weekly review modal
│   │   ├── SettingsModal.jsx # App settings
│   │   ├── TimerContext.jsx  # Global timer state (React Context)
│   │   ├── TimerWidget.jsx   # Floating timer widget
│   │   └── components/
│   │       ├── Modal.jsx           # Base modal wrapper
│   │       ├── ActivityComposer.jsx # Task comments + AI tab
│   │       ├── TimeLogModal.jsx    # Time-spent prompt on task completion
│   │       └── EstimatedTimePicker.jsx
│   ├── tailwind.config.js    # Design tokens (see Design System below)
│   └── vite.config.js        # Dev proxy → localhost:8001
├── .env                      # GROQ_API_KEY (never commit)
├── sysgo.db                  # SQLite database (all data)
├── uploads/                  # User-uploaded files (goal icons, proofs)
└── requirements.txt          # Python deps
```

---

## Database Schema

All migrations run automatically in `app/main.py` → `run_migrations()`. Schema is additive (ALTER TABLE + CREATE TABLE IF NOT EXISTS).

### Core entities

**goals** — `id, title, description, type (resolution|project|daily), icon, cover, archived_at, parent_id, task_count, done_count`

**tasks** — `id, goal_id, title, status (todo|done), type, is_urgent, is_important, estimated_minutes, due_date, plan_date, pinned_date, deferred_until, habit_frequency, sort_order, parent_task_id, created_at`

**comments** — `id, task_id, content, type (text|ai), created_at`

**proofs** — `id, task_id, url, date`

**work_sessions** — `id, task_id (nullable), work_log_id (nullable), started_at, ended_at, duration_seconds` — used for BOTH task timers and work ticket timers. Ticket timer sessions use `work_log_id = "ticket:{ticket_id}"` as a namespace.

### Work tracker

**companies** — `id, name, color, role, created_at`

**work_logs** — `id, company_id, title, type, status, notes, tags (JSON), proofs (JSON), duration_minutes, logged_at, created_at`

**work_tickets** — `id, company_id, linked_goal_id, title, description, type (code|research|planning|review|meeting), status (backlog|todo|in_progress|review|done|blocked), priority (low|medium|high|urgent), estimated_minutes, logged_minutes, logged_seconds, ticket_ref, tags (JSON), proofs (JSON), notes, created_at, started_at, completed_at`

**work_time_entries** — `id, ticket_id, duration_seconds, duration_minutes, logged_at, note, created_at`

**work_ticket_comments** — `id, ticket_id, body, type (note|proof), created_at`

### People CRM

**contacts** — `id, name, photo, notes, created_at`

**call_logs** — `id, contact_id, called_at, summary, created_at`

### Other

**habit_logs** — `id, task_id, date, count`

**daily_snapshots** — `date (PK), tasks_total, tasks_done, habits_total, habits_done, score_pct, task_score, habit_score`

**defer_logs** — `id, task_id, deferred_on, deferred_until`

**settings** — `key (PK), value`

---

## Design System (Tailwind tokens)

All UI uses hardcoded hex values matching these tokens. **Never use default Tailwind colors for UI chrome** — always use these.

| Token | Hex | Usage |
|-------|-----|-------|
| `#F2EDE4` | cream | Page background, card backgrounds |
| `#1B3A2D` | forest | Primary buttons, nav, bold accents |
| `#2D7A6B` | accent | Links, secondary buttons, active states |
| `#E8C334` | gold | Active nav item pill, highlights |
| `#1A1A1A` | text-primary | Headlines, primary text |
| `#6B6B6B` | text-secondary | Labels, meta text |
| `#E8E3DB` | border | Card borders, dividers |
| `#F9F6F1` | subtle bg | Input backgrounds, code blocks |
| `#b5a08a` | muted | Placeholder text, disabled states |
| violet | AI features | Comments AI tab, AI panels use violet-50/100/200 |

**Layout:** Fixed 160px left sidebar + content area. No top nav. Cards use `rounded-2xl`, buttons `rounded-xl`.

---

## Key Architectural Patterns

### Backend change workflow
1. Edit Python files
2. Restart uvicorn: `pkill -f "uvicorn app.main:app" && venv/bin/uvicorn app.main:app --port 8001 &`

### Frontend change workflow
1. Edit JSX/CSS files in `frontend/src/`
2. Build: `cd frontend && npm run build`
3. Backend serves the new `dist/` automatically (no restart needed for frontend-only changes)

### Adding a new DB column
Add to `run_migrations()` in `app/main.py`:
```python
"ALTER TABLE tablename ADD COLUMN colname TYPE DEFAULT value",
```
SQLite's `ALTER TABLE` only supports adding columns. For changing types/constraints, use the table-rebuild pattern (see `work_sessions_new` migration in `main.py` for example).

### AI endpoint pattern
All AI uses Groq via OpenAI-compatible client:
```python
from openai import OpenAI
client = OpenAI(api_key=os.getenv("GROQ_API_KEY"), base_url="https://api.groq.com/openai/v1")
resp = client.chat.completions.create(model="llama-3.3-70b-versatile", messages=[...])
```

### API module (`frontend/src/api.js`)
All backend calls live here. Pattern:
```js
const request = (path, opts = {}) => fetch(path, opts).then(r => r.ok ? (r.status === 204 ? null : r.json()) : r.json().then(e => Promise.reject(new Error(e.detail || 'Error'))))
export const getFoo = () => request('/foo')
export const createFoo = (data) => request('/foo', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) })
```

---

## Features Built

### Today Page (`TodayPage.jsx`)
- Daily task list (plan date pinning)
- **Focus Section**: 3-card grid of pinned tasks, Start timer + ✓ Done buttons
- **Planner** (sub-view): drag-and-drop timeline
- Progress bar (done/total)
- **TimeLogModal**: when completing a task with no timer data, prompts for time spent

### Goals Page (`GoalsPage.jsx`)
- Goals grouped by type: Resolutions · Projects · Daily
- Each goal: icon (emoji or uploaded image), progress bar, type badge
- Sub-projects nested under parent projects
- GoalIcon component: `export function GoalIcon({ icon, size })` — handles URL (img) vs emoji vs null (shows TYPE_META icon in dark circle)

### Goal Detail Page (`GoalPage.jsx`)
- Tasks list with subtasks, status, urgency/importance flags
- Activity comments + AI tab
- Timer per task
- TimeLogModal on completion

### Work Page (`WorkPage.jsx`) ← Most recently built
Two tabs:

**Tickets tab** — Jira-like persistent work items:
- Create: title, type, priority, status, estimate (minutes), external ref (JIRA-123), proof links, tags
- Card list with estimate-vs-actual progress bar, type/priority/status badges
- **TicketDrawer** (slide-in panel): full activity workspace
  - ▶ Start Timer / ⏹ Stop (live MM:SS clock, resumes from exact elapsed time)
  - + Log Time (inline form, no modal)
  - Compose bar: type notes, paste URLs (auto-detected as proof links), Enter to send
  - Unified activity feed: 💬 notes · 🔗 proofs · ⏱ time entries (in reverse-chron)
  - Status change inline via dropdown
  - Timer uses `work_sessions` with `work_log_id = "ticket:{id}"` namespace
  - `timer_started_at` returned from API so resume picks up real elapsed time
  - Time stored in exact seconds (`duration_seconds`) — no rounding to minutes
  - `logged_seconds` on ticket = sum of all entry `duration_seconds`

**Work Log tab** — Quick standalone entries (no ticket needed):
- Company, title, type, duration, date, notes, proofs
- Timer per log entry

Both tabs:
- Company filter pills
- Stats: This Week + per-company breakdown
- ✨ AI panel: standup, weekly summary, research digest, payment report

### People Page (`ContactsPage.jsx`)
- Contact cards with OVERDUE/HEALTHY/UPCOMING badges (absolute top-right)
- Days-since-call status with colored dot
- Log interaction (call/meeting) with summary
- AI Insight banner (violet)
- Recent Activity feed at bottom

### Progress Page (`ProgressPage.jsx`)
- 3 stat cards: Total Output · Consistency · Deep Work
- Weekly Velocity bar chart
- 13×7 Consistency heatmap (4-level green coloring)
- Per-goal progress bars
- AI Smart Insight (violet)

### Sidebar (`App.jsx`)
- Fixed 160px, dark cream bg
- Logo "SysGo / LIFE OS"
- "+ Add Task" dark green button
- Nav: Today · Goals · Work · Progress · Insights · People · Review · Settings
- Active item: golden yellow pill highlight

### AI in Task Comments (`ActivityComposer.jsx`)
- Note / Ask AI tab toggle
- AI mode: violet accented, calls `POST /tasks/{id}/ai`
- AI comments stored as `type="ai"`, displayed with violet bg + ✨ AI badge

### Scheduler (`scheduler.py`)
- Background thread (daemon), checks every 30 seconds
- At configured `reminder_time` (default 21:00), fires macOS notification for unchecked habits

---

## Work Ticket Timer — Implementation Detail

Timer sessions for tickets are stored in the existing `work_sessions` table using the `work_log_id` column with a `"ticket:{ticket_id}"` prefix as a namespace (no separate table needed).

```python
# Start
session = WorkSession(task_id=None, work_log_id=f"ticket:{ticket_id}", started_at=now)

# Check if running
running = db.query(WorkSession).filter(
    WorkSession.work_log_id == f"ticket:{ticket_id}",
    WorkSession.ended_at.is_(None)
).first()

# Stop
elapsed_secs = int((now - running.started_at).total_seconds())
running.ended_at = now
entry = WorkTimeEntry(duration_seconds=elapsed_secs, duration_minutes=elapsed_secs // 60, ...)
```

Frontend clock formula:
```js
const totalSecs = (ticket.logged_seconds || 0) + timerSecs  // exact seconds
const liveLogged = Math.floor(totalSecs / 60)               // for TimeBar %
```

---

## Screenshots Script

```python
# /tmp/sysgo_shot.py — takes screenshots of all pages
# Run: python3 /tmp/sysgo_shot.py
# Saves to /tmp/sysgo_today.png, /tmp/sysgo_goals.png, /tmp/sysgo_progress.png, /tmp/sysgo_people.png
```

Requires `playwright`: `venv/bin/pip install playwright && venv/bin/playwright install chromium`

---

## Common Tasks for Claude

**Add a new page:**
1. Create `frontend/src/NewPage.jsx`
2. Add nav item + route in `App.jsx`
3. Add API functions to `api.js`
4. Create FastAPI route in `app/routes/newpage.py`
5. Register in `app/main.py` (import + `app.include_router(...)`)
6. `npm run build`

**Change UI styles:**
- Use the hex values from the Design System section above
- All cards: `bg-white border border-[#E8E3DB] rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.08)]`
- All primary buttons: `bg-[#1B3A2D] text-white rounded-xl hover:bg-[#2a5240]`
- Active/accent: `bg-[#2D7A6B]` or `text-[#2D7A6B]`
- AI sections: `bg-violet-50 border-violet-100 text-violet-700`

**Debug backend errors:**
```bash
tail -50 /tmp/sysgo-backend.log
```

**Restart everything after changes:**
```bash
# Frontend
cd frontend && npm run build && cd ..
# Backend (frontend change: no restart needed; backend change: restart)
pkill -f "uvicorn app.main:app" && venv/bin/uvicorn app.main:app --port 8001 &
```
