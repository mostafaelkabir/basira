# SysGo — Personal Life OS

> A self-hosted productivity platform for people who want full control over their goals, habits, work, and relationships — with no subscriptions, no data sharing, and AI built in.

![SysGo Work Tracker](https://img.shields.io/badge/stack-FastAPI%20%2B%20React-1B3A2D?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-2D7A6B?style=flat-square)
![Python](https://img.shields.io/badge/python-3.12-blue?style=flat-square)

---

## What is SysGo?

SysGo is a local-first life operating system. It runs entirely on your machine — no cloud accounts, no SaaS fees. You own your data.

It covers five areas of life in one unified app:

| Module | What it does |
|--------|-------------|
| **Today** | Daily focus view — pinned tasks, a live timer, and a drag-and-drop planner |
| **Goals** | Resolutions, projects, and daily goals with progress tracking |
| **Work** | Client/company work tracker — tickets, time entries, and proof of work |
| **People** | Lightweight CRM — contacts, interaction logs, and overdue-check alerts |
| **Progress** | Analytics — weekly velocity, consistency heatmap, and AI smart insights |

---

## Features

- **Task management** with subtasks, urgency/importance flags, due dates, and habit tracking
- **Work tickets** (Jira-style) with a built-in timer, time logging, and status workflow
- **Screenshot paste** — paste any image directly into a ticket to attach it as proof
- **Time tracking** per client — today vs. this week breakdown, including ticket time
- **People CRM** with call logs and automated overdue-contact alerts
- **AI assistant** powered by Groq (free tier) — standups, weekly summaries, task coaching
- **Weekly review** mode with structured reflection prompts
- **macOS notifications** for habit reminders via a background scheduler
- **Fully local** — SQLite database, file uploads stored on disk, no external services required (except the optional AI key)

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.12 · FastAPI · SQLAlchemy · SQLite |
| Frontend | React 18 · Vite · Tailwind CSS v3 · @dnd-kit |
| AI | [Groq API](https://console.groq.com) (free) via OpenAI-compatible client |
| Scheduler | Python threading — macOS notifications via `osascript` |

---

## Quick Start

### Prerequisites

- Python 3.12+
- Node.js 18+
- macOS (notifications use `osascript`; everything else works cross-platform)

### 1. Clone & install

```bash
git clone https://github.com/YOUR_USERNAME/sysgo.git
cd sysgo

# Python backend
python3 -m venv venv
venv/bin/pip install -r requirements.txt

# React frontend
cd frontend && npm install && npm run build && cd ..
```

### 2. Configure environment

```bash
cp .env.example .env
```

Open `.env` and add your Groq API key (free at [console.groq.com](https://console.groq.com)):

```
GROQ_API_KEY=gsk_...
```

> The app works fully without a key — AI features will simply be unavailable.

### 3. Run

```bash
venv/bin/uvicorn app.main:app --port 8001
```

Open **http://localhost:8001** in your browser. The database is created automatically on first run.

---

## Running as a Background Service (macOS)

To keep SysGo running automatically at login, set it up as a launchd service:

```bash
# Copy the example plist
cp com.sysgo.backend.plist.example ~/Library/LaunchAgents/com.sysgo.backend.plist

# Edit the plist to match your absolute path
nano ~/Library/LaunchAgents/com.sysgo.backend.plist

# Load it
launchctl load ~/Library/LaunchAgents/com.sysgo.backend.plist
```

Logs stream to `/tmp/sysgo-backend.log`:

```bash
tail -f /tmp/sysgo-backend.log
```

---

## Project Structure

```
sysgo/
├── app/
│   ├── main.py          # FastAPI app, auto-migrations, static serving
│   ├── database.py      # SQLAlchemy engine (SQLite)
│   ├── scheduler.py     # Background habit reminder thread
│   ├── models/          # SQLAlchemy ORM models
│   └── routes/          # FastAPI route handlers
├── frontend/
│   ├── src/
│   │   ├── App.jsx      # Root: sidebar nav + page routing
│   │   ├── api.js       # All API calls (single source of truth)
│   │   ├── TodayPage.jsx
│   │   ├── GoalsPage.jsx
│   │   ├── WorkPage.jsx
│   │   ├── ContactsPage.jsx
│   │   ├── ProgressPage.jsx
│   │   └── components/
│   └── vite.config.js
├── requirements.txt
├── .env.example
└── README.md
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GROQ_API_KEY` | Optional | Enables AI features. Get a free key at [console.groq.com](https://console.groq.com) |

---

## Development

```bash
# Backend (with hot-reload)
venv/bin/uvicorn app.main:app --port 8001 --reload

# Frontend (in a separate terminal, for hot module replacement)
cd frontend && npm run dev
# Frontend dev server proxies API calls to localhost:8001
```

After editing frontend files for production, rebuild:

```bash
cd frontend && npm run build
```

---

## Adding a New Page

1. Create `frontend/src/NewPage.jsx`
2. Add a nav item and route in `App.jsx`
3. Add API functions to `api.js`
4. Create a FastAPI router in `app/routes/newpage.py`
5. Register it in `app/main.py`
6. Run `npm run build`

---

## Contributing

Contributions are welcome! Some ideas:

- [ ] Cross-platform notifications (Linux / Windows)
- [ ] Mobile-friendly responsive layout
- [ ] Export to PDF (weekly report, payment report)
- [ ] Google Calendar / Notion sync
- [ ] Multi-user support

Please open an issue first to discuss larger changes.

---

## License

MIT — do whatever you want with it. Attribution appreciated but not required.

---

*Built by [Mostafa El-Kabir](https://github.com/mostafaelkabir)*
