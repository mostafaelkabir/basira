import os

from dotenv import load_dotenv
load_dotenv()  # picks up OPENAI_API_KEY and any other vars from .env in project root

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

import app.models  # noqa: F401 — registers all ORM models before create_all
from app.database import Base, engine
from app.routes.comments import router as comments_router
from app.routes.contacts import router as contacts_router
from app.routes.goals import router as goals_router
from app.routes.habits import router as habits_router
from app.routes.proofs import router as proofs_router
from app.routes.review import router as review_router
from app.routes.analytics import router as analytics_router
from app.routes.timer import router as timer_router
from app.routes.settings_route import router as settings_router
from app.routes.tasks import router as tasks_router
from app.routes.today import router as today_router
from app.routes.upload import router as upload_router
from app.routes.companies import router as companies_router
from app.routes.work_logs import router as work_logs_router
from app.routes.work_tickets import router as work_tickets_router
from app.routes.checkins import router as checkins_router
from app.routes.journal import router as journal_router
from app.scheduler import start_scheduler


def run_migrations():
    migrations = [
        "ALTER TABLE goals ADD COLUMN type VARCHAR",
        "ALTER TABLE goals ADD COLUMN archived_at DATETIME",
        "ALTER TABLE tasks ADD COLUMN due_date VARCHAR",
        "ALTER TABLE tasks ADD COLUMN habit_frequency VARCHAR DEFAULT 'daily'",
        "ALTER TABLE habit_logs ADD COLUMN count INTEGER DEFAULT 1",
        "ALTER TABLE proofs ADD COLUMN date VARCHAR",
        "ALTER TABLE tasks ADD COLUMN pinned_date VARCHAR",
        "CREATE TABLE IF NOT EXISTS comments (id VARCHAR PRIMARY KEY, task_id VARCHAR NOT NULL REFERENCES tasks(id), content TEXT NOT NULL, created_at VARCHAR NOT NULL)",
        "ALTER TABLE tasks ADD COLUMN deferred_until VARCHAR",
        "ALTER TABLE comments ADD COLUMN type VARCHAR DEFAULT 'text'",
        "ALTER TABLE tasks ADD COLUMN plan_date VARCHAR",
        "ALTER TABLE goals ADD COLUMN icon VARCHAR",
        "ALTER TABLE goals ADD COLUMN cover BOOLEAN DEFAULT 0",
        """CREATE TABLE IF NOT EXISTS contacts (
            id VARCHAR PRIMARY KEY,
            name VARCHAR NOT NULL,
            photo VARCHAR,
            notes TEXT,
            created_at VARCHAR NOT NULL
        )""",
        """CREATE TABLE IF NOT EXISTS call_logs (
            id VARCHAR PRIMARY KEY,
            contact_id VARCHAR NOT NULL REFERENCES contacts(id),
            called_at VARCHAR NOT NULL,
            summary TEXT NOT NULL,
            created_at VARCHAR NOT NULL
        )""",
        "ALTER TABLE goals ADD COLUMN parent_id VARCHAR REFERENCES goals(id)",
        "ALTER TABLE tasks ADD COLUMN parent_task_id VARCHAR REFERENCES tasks(id)",
        "ALTER TABLE tasks ADD COLUMN is_urgent BOOLEAN DEFAULT 0",
        "ALTER TABLE tasks ADD COLUMN is_important BOOLEAN DEFAULT 0",
        "ALTER TABLE tasks ADD COLUMN sort_order INTEGER DEFAULT 0",
        "UPDATE tasks SET sort_order = rowid WHERE sort_order = 0 OR sort_order IS NULL",
        "ALTER TABLE tasks ADD COLUMN created_at VARCHAR",
        "UPDATE tasks SET created_at = date('now') WHERE created_at IS NULL",
        """CREATE TABLE IF NOT EXISTS daily_snapshots (
            date VARCHAR PRIMARY KEY,
            tasks_total INTEGER DEFAULT 0,
            tasks_done INTEGER DEFAULT 0,
            habits_total INTEGER DEFAULT 0,
            habits_done INTEGER DEFAULT 0,
            score_pct REAL DEFAULT 0.0
        )""",
        """CREATE TABLE IF NOT EXISTS work_sessions (
            id VARCHAR PRIMARY KEY,
            task_id VARCHAR NOT NULL REFERENCES tasks(id),
            started_at DATETIME NOT NULL,
            ended_at DATETIME,
            duration_seconds INTEGER DEFAULT 0
        )""",
        "ALTER TABLE tasks ADD COLUMN estimated_minutes INTEGER",
        "ALTER TABLE daily_snapshots ADD COLUMN task_score REAL DEFAULT 0.0",
        "ALTER TABLE daily_snapshots ADD COLUMN habit_score REAL DEFAULT 0.0",
        """CREATE TABLE IF NOT EXISTS defer_logs (
            id VARCHAR PRIMARY KEY,
            task_id VARCHAR NOT NULL REFERENCES tasks(id),
            deferred_on VARCHAR NOT NULL,
            deferred_until VARCHAR
        )""",
        # Work tracker
        """CREATE TABLE IF NOT EXISTS companies (
            id VARCHAR PRIMARY KEY,
            name VARCHAR NOT NULL,
            color VARCHAR DEFAULT '#2D7A6B',
            role VARCHAR DEFAULT '',
            created_at DATETIME NOT NULL
        )""",
        """CREATE TABLE IF NOT EXISTS work_logs (
            id VARCHAR PRIMARY KEY,
            company_id VARCHAR NOT NULL REFERENCES companies(id),
            linked_goal_id VARCHAR REFERENCES goals(id),
            title VARCHAR NOT NULL,
            type VARCHAR DEFAULT 'code',
            status VARCHAR DEFAULT 'todo',
            notes TEXT DEFAULT '',
            tags TEXT DEFAULT '[]',
            proofs TEXT DEFAULT '[]',
            duration_minutes INTEGER DEFAULT 0,
            logged_at VARCHAR NOT NULL,
            created_at DATETIME NOT NULL
        )""",
        "ALTER TABLE work_sessions ADD COLUMN work_log_id VARCHAR",
        # Make task_id nullable (SQLite workaround — it already allows NULL via ORM)
        """CREATE TABLE IF NOT EXISTS work_tickets (
            id VARCHAR PRIMARY KEY,
            company_id VARCHAR NOT NULL REFERENCES companies(id),
            linked_goal_id VARCHAR REFERENCES goals(id),
            title VARCHAR NOT NULL,
            description TEXT DEFAULT '',
            type VARCHAR DEFAULT 'code',
            status VARCHAR DEFAULT 'todo',
            priority VARCHAR DEFAULT 'medium',
            estimated_minutes INTEGER DEFAULT 0,
            logged_minutes INTEGER DEFAULT 0,
            ticket_ref VARCHAR DEFAULT '',
            tags TEXT DEFAULT '[]',
            proofs TEXT DEFAULT '[]',
            notes TEXT DEFAULT '',
            created_at DATETIME NOT NULL,
            started_at DATETIME,
            completed_at DATETIME
        )""",
        """CREATE TABLE IF NOT EXISTS work_time_entries (
            id VARCHAR PRIMARY KEY,
            ticket_id VARCHAR NOT NULL REFERENCES work_tickets(id),
            duration_minutes INTEGER NOT NULL,
            logged_at VARCHAR NOT NULL,
            note VARCHAR DEFAULT '',
            created_at DATETIME NOT NULL
        )""",
        """CREATE TABLE IF NOT EXISTS work_ticket_comments (
            id VARCHAR PRIMARY KEY,
            ticket_id VARCHAR NOT NULL REFERENCES work_tickets(id),
            body TEXT NOT NULL,
            type VARCHAR DEFAULT 'note',
            created_at DATETIME NOT NULL
        )""",
        # Make work_sessions.task_id nullable (SQLite requires table rebuild)
        """CREATE TABLE IF NOT EXISTS work_sessions_new (
            id VARCHAR PRIMARY KEY,
            task_id VARCHAR REFERENCES tasks(id),
            work_log_id VARCHAR,
            started_at DATETIME NOT NULL,
            ended_at DATETIME,
            duration_seconds INTEGER DEFAULT 0
        )""",
        "INSERT OR IGNORE INTO work_sessions_new SELECT id, task_id, work_log_id, started_at, ended_at, duration_seconds FROM work_sessions",
        "DROP TABLE IF EXISTS work_sessions_old",
        "ALTER TABLE work_sessions RENAME TO work_sessions_old",
        "ALTER TABLE work_sessions_new RENAME TO work_sessions",
        "DROP TABLE IF EXISTS work_sessions_old",
        "ALTER TABLE work_tickets ADD COLUMN logged_seconds INTEGER DEFAULT 0",
        "UPDATE work_tickets SET logged_seconds = logged_minutes * 60 WHERE logged_seconds = 0",
        "ALTER TABLE work_time_entries ADD COLUMN duration_seconds INTEGER DEFAULT 0",
        "UPDATE work_time_entries SET duration_seconds = duration_minutes * 60 WHERE duration_seconds = 0",
        # Daily check-ins
        """CREATE TABLE IF NOT EXISTS daily_checkins (
            id VARCHAR PRIMARY KEY,
            date VARCHAR NOT NULL UNIQUE,
            morning_energy INTEGER,
            morning_intention TEXT,
            evening_mood INTEGER,
            evening_rating INTEGER,
            evening_reflection TEXT,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL
        )""",
        # Journal entries
        """CREATE TABLE IF NOT EXISTS journal_entries (
            id VARCHAR PRIMARY KEY,
            date VARCHAR NOT NULL,
            mood INTEGER,
            energy INTEGER,
            body TEXT,
            wins TEXT,
            improve TEXT,
            gratitude TEXT,
            tags TEXT DEFAULT '[]',
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL
        )""",
    ]
    with engine.connect() as conn:
        for sql in migrations:
            try:
                conn.execute(text(sql))
                conn.commit()
            except Exception:
                pass


run_migrations()
Base.metadata.create_all(bind=engine)
start_scheduler()

app = FastAPI(title="Basira API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(today_router)
app.include_router(contacts_router)
app.include_router(goals_router)
app.include_router(comments_router)
app.include_router(tasks_router)
app.include_router(proofs_router)
app.include_router(habits_router)
app.include_router(review_router)
app.include_router(settings_router)
app.include_router(analytics_router)
app.include_router(timer_router)
app.include_router(upload_router)
app.include_router(companies_router)
app.include_router(work_logs_router)
app.include_router(work_tickets_router)
app.include_router(checkins_router)
app.include_router(journal_router)

os.makedirs("uploads", exist_ok=True)
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

# Serve the built frontend — must be mounted AFTER all API routes
_frontend_dist = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
if os.path.isdir(_frontend_dist):
    app.mount("/assets", StaticFiles(directory=os.path.join(_frontend_dist, "assets")), name="assets")

    @app.get("/health")
    def health_check() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/{full_path:path}")
    def serve_spa(full_path: str):
        return FileResponse(os.path.join(_frontend_dist, "index.html"))
else:
    @app.get("/health")
    def health_check() -> dict[str, str]:
        return {"status": "ok"}
