# بَصِيرَة — Basira

> *"Rather, man will be a witness against himself, even though he may offer his excuses."*
> — Al-Qiyamah 75:14–15

> *"And within yourselves — do you not see?"*
> — Adh-Dhariyat 51:21

**Basira** (بَصِيرَة) means inner sight, clarity, and evidence. The root *b-s-r* (ب-ص-ر) means to see — not just outward, but inward. In the Quran it carries the meaning of evidence, witness, and deep self-knowledge.

This app is your *basira* — a mirror of your own life in data. The time you logged, the habits you kept or skipped, the goals you moved toward or avoided. You cannot hide from your own numbers. The data sees you even when you look away.

---

![Stack](https://img.shields.io/badge/stack-FastAPI%20%2B%20React-1B3A2D?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-2D7A6B?style=flat-square)
![Python](https://img.shields.io/badge/python-3.12-blue?style=flat-square)

---

## What is Basira?

Basira is a **self-hosted personal OS** — a single app that tracks every dimension of your life so you can see yourself clearly and act accordingly. No cloud, no subscriptions, no data shared with anyone. You own everything.

It is built on a simple idea: **the person who knows themselves best wins**. Most people drift. Basira gives you evidence — about your time, your energy, your relationships, and your progress — so you can stop guessing and start improving.

| Module | What it tracks |
|--------|---------------|
| **Today** | Daily focus — pinned tasks, live timer, drag-and-drop planner |
| **Goals** | Resolutions, projects, and daily goals with progress tracking |
| **Work** | Client work — tickets, time per company, proof of work |
| **People** | Relationships — contacts, interaction logs, overdue-check alerts |
| **Progress** | Analytics — weekly velocity, consistency heatmap, AI insights |

---

## Features

- **Task management** with subtasks, urgency/importance flags, due dates, and habit tracking
- **Work tickets** (Jira-style) with a built-in timer, time logging, and status workflow
- **Time breakdown** per client — today vs. this week, including ticket time
- **Screenshot paste** — paste any image directly into a ticket as proof
- **People CRM** with interaction logs and overdue-contact alerts
- **AI assistant** powered by Groq (free tier) — standups, weekly summaries, task coaching
- **Weekly review** mode with structured self-reflection
- **Habit reminders** via macOS notifications from a background scheduler
- **Fully local** — SQLite database, files on disk, no external services required

---

## The Philosophy

The Quran asks: *"Do you not see within yourselves?"* — وَفِي أَنْفُسِكُمْ أَفَلَا تُبْصِرُونَ

Most productivity tools help you do more. Basira helps you **see more** — about who you are, how you spend your time, what you actually finish, and who you keep in touch with. The goal is not busyness. It is *basira*: the clarity that comes from honest self-knowledge.

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
git clone https://github.com/YOUR_USERNAME/basira.git
cd basira

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

To keep Basira running automatically at login:

```bash
# Copy and edit the example plist
cp com.basira.backend.plist.example ~/Library/LaunchAgents/com.basira.backend.plist
nano ~/Library/LaunchAgents/com.basira.backend.plist

# Load it
launchctl load ~/Library/LaunchAgents/com.basira.backend.plist
```

Logs stream to `/tmp/basira-backend.log`:

```bash
tail -f /tmp/basira-backend.log
```

---

## Project Structure

```
basira/
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
| `GROQ_API_KEY` | Optional | Enables AI features. Free key at [console.groq.com](https://console.groq.com) |

---

## Development

```bash
# Backend with hot-reload
venv/bin/uvicorn app.main:app --port 8001 --reload

# Frontend dev server (separate terminal)
cd frontend && npm run dev
```

After editing frontend files for production, rebuild:

```bash
cd frontend && npm run build
```

---

## Contributing

Contributions are welcome. Some open directions:

- [ ] Cross-platform notifications (Linux / Windows)
- [ ] Mobile-friendly responsive layout
- [ ] Export to PDF (weekly report, payment summary)
- [ ] Dark mode
- [ ] Multi-user / family support

Please open an issue first to discuss larger changes.

---

## License

MIT — free to use, modify, and share. Attribution appreciated.

---

*Built by [Mostafa El-Kabir](https://github.com/mostafaelkabir)*

*"See yourself clearly."*
