import subprocess
import threading
import time
from datetime import date

from app.database import SessionLocal
from app.models.goal import Goal
from app.models.habit_log import HabitLog
from app.routes.settings_route import get_all_settings


def send_mac_notification(title: str, message: str) -> None:
    script = f'display notification "{message}" with title "{title}" sound name "default"'
    try:
        subprocess.run(["osascript", "-e", script], timeout=5, capture_output=True)
    except Exception:
        pass


def check_habits_and_notify() -> None:
    db = SessionLocal()
    try:
        settings = get_all_settings(db)
        if settings.get("reminder_enabled", "true") != "true":
            return

        today = date.today().isoformat()
        resolution_goals = db.query(Goal).filter(
            Goal.type == "resolution",
            Goal.archived_at.is_(None),
        ).all()

        total_habits = sum(
            1 for g in resolution_goals for t in g.tasks if t.status != "done"
        )
        if total_habits == 0:
            return

        checked_today = (
            db.query(HabitLog)
            .filter(HabitLog.date == today)
            .count()
        )
        remaining = total_habits - checked_today

        if remaining > 0:
            msg = (
                f"You have {remaining} habit{'s' if remaining > 1 else ''} left to check in on today."
                if remaining < total_habits
                else "You haven't checked in on any habits today."
            )
            send_mac_notification("SysGo", msg)
    finally:
        db.close()


_notified_today: set[str] = set()


def _scheduler_loop() -> None:
    global _notified_today
    while True:
        try:
            db = SessionLocal()
            settings = get_all_settings(db)
            db.close()

            reminder_time = settings.get("reminder_time", "21:00")
            from datetime import datetime
            now = datetime.now()
            current_hhmm = now.strftime("%H:%M")
            today = date.today().isoformat()

            # Fire once per day when the clock matches reminder_time
            key = f"{today}_{reminder_time}"
            if current_hhmm == reminder_time and key not in _notified_today:
                _notified_today = {k for k in _notified_today if k.startswith(today)}
                _notified_today.add(key)
                check_habits_and_notify()
        except Exception:
            pass
        time.sleep(30)  # check every 30 seconds


def start_scheduler() -> None:
    thread = threading.Thread(target=_scheduler_loop, daemon=True)
    thread.start()
