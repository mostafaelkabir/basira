"""
Insights profile endpoint — aggregates 90 days of behavioral data into
a unified self-knowledge profile with 7 pattern analyses + 6 dimension scores.
"""
import math
import statistics
from datetime import UTC, date, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.daily_checkin import DailyCheckin
from app.models.daily_snapshot import DailySnapshot
from app.models.defer_log import DeferLog
from app.models.execution_log import ExecutionLog
from app.models.goal import Goal
from app.models.habit_log import HabitLog
from app.models.task import Task
from app.models.work_session import WorkSession
from app.models.work_ticket import WorkTicket

router = APIRouter(prefix="/insights", tags=["insights"])

DAYS_BACK = 90
DAYS_BACK_30 = 30
DAYS_BACK_14 = 14


def _since(days: int) -> str:
    return (date.today() - timedelta(days=days)).isoformat()


@router.get("/profile")
def get_profile(db: Session = Depends(get_db)):
    since90 = _since(DAYS_BACK)
    since30 = _since(DAYS_BACK_30)
    since14 = _since(DAYS_BACK_14)

    # ── 1. Productivity Peak Hours ─────────────────────────────────────────────
    # Group execution_logs by hour-of-day (SQLite strftime)
    hour_rows = db.execute(text(
        "SELECT CAST(strftime('%H', completed_at) AS INTEGER) as hr, COUNT(*) as cnt "
        "FROM execution_logs WHERE completed_at >= :since GROUP BY hr"
    ), {"since": since90}).fetchall()
    hour_completions = [0] * 24
    for row in hour_rows:
        if row[0] is not None:
            hour_completions[int(row[0])] = row[1]

    # Focus seconds per hour from work_sessions
    focus_rows = db.execute(text(
        "SELECT CAST(strftime('%H', started_at) AS INTEGER) as hr, "
        "SUM(duration_seconds) as secs "
        "FROM work_sessions WHERE started_at >= :since AND ended_at IS NOT NULL "
        "GROUP BY hr"
    ), {"since": since90}).fetchall()
    hour_focus = [0] * 24
    for row in focus_rows:
        if row[0] is not None:
            hour_focus[int(row[0])] = int(row[1] or 0)

    peak_hours = [{"hour": i, "completions": hour_completions[i], "focus_seconds": hour_focus[i]} for i in range(24)]

    # Best hour (most completions)
    best_hour = max(range(24), key=lambda i: hour_completions[i])

    # Day-of-week breakdown (0=Mon in Python, but SQLite strftime %w = 0=Sun)
    dow_rows = db.execute(text(
        "SELECT CAST(strftime('%w', completed_at) AS INTEGER) as dow, COUNT(*) as cnt "
        "FROM execution_logs WHERE completed_at >= :since GROUP BY dow"
    ), {"since": since90}).fetchall()
    dow_map = {0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0}
    for row in dow_rows:
        if row[0] is not None:
            dow_map[int(row[0])] = row[1]
    # Convert SQLite Sunday=0 to Mon=0 label order
    day_names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    peak_days = [{"day": day_names[i], "completions": dow_map[i]} for i in range(7)]
    best_day = max(range(7), key=lambda i: dow_map[i])
    best_day_name = day_names[best_day]

    # ── 2. Task Type Affinity ──────────────────────────────────────────────────
    # Goal types: resolution, project, daily
    affinity_rows = db.execute(text(
        """
        SELECT g.type, COUNT(el.id) as done_count,
               AVG(CASE el.task_feeling
                   WHEN 'loved' THEN 3
                   WHEN 'flow'  THEN 2
                   WHEN 'grind' THEN 1
                   ELSE NULL END) as avg_feeling
        FROM execution_logs el
        JOIN tasks t ON el.task_id = t.id
        JOIN goals g ON t.goal_id = g.id
        WHERE el.completed_at >= :since
        GROUP BY g.type
        """
    ), {"since": since30}).fetchall()

    task_type_affinity = []
    for row in affinity_rows:
        task_type_affinity.append({
            "goal_type": row[0] or "unknown",
            "completions": row[1],
            "avg_feeling_score": round(row[2], 2) if row[2] is not None else None,
            "feeling_label": (
                "loved" if row[2] and row[2] >= 2.5 else
                "flow" if row[2] and row[2] >= 1.8 else
                "grind" if row[2] else "unrated"
            ),
        })
    task_type_affinity.sort(key=lambda x: (x["completions"]), reverse=True)

    # ── 3. Procrastination Signature ──────────────────────────────────────────
    reason_rows = db.execute(text(
        "SELECT defer_reason, COUNT(*) as cnt FROM defer_logs "
        "WHERE deferred_on >= :since AND defer_reason IS NOT NULL "
        "GROUP BY defer_reason ORDER BY cnt DESC"
    ), {"since": since90}).fetchall()
    total_defers = sum(r[1] for r in reason_rows) or 1
    reason_distribution = [
        {"reason": r[0], "count": r[1], "pct": round(r[1] / total_defers * 100)}
        for r in reason_rows
    ]

    # Top 5 most-deferred tasks
    top_deferred = db.execute(text(
        "SELECT t.id, t.title, COUNT(dl.id) as defer_count "
        "FROM defer_logs dl JOIN tasks t ON dl.task_id = t.id "
        "WHERE dl.deferred_on >= :since "
        "GROUP BY t.id, t.title ORDER BY defer_count DESC LIMIT 5"
    ), {"since": since90}).fetchall()
    most_deferred_tasks = [{"id": r[0], "title": r[1], "defer_count": r[2]} for r in top_deferred]

    # ── 4. Energy-Output Correlation ──────────────────────────────────────────
    energy_rows = db.execute(text(
        "SELECT dc.morning_energy, ds.tasks_done "
        "FROM daily_checkins dc JOIN daily_snapshots ds ON dc.date = ds.date "
        "WHERE dc.date >= :since AND dc.morning_energy IS NOT NULL"
    ), {"since": since30}).fetchall()

    bins = {"low": [], "medium": [], "high": []}
    for row in energy_rows:
        e, done = row[0], row[1] or 0
        if e <= 2:
            bins["low"].append(done)
        elif e == 3:
            bins["medium"].append(done)
        else:
            bins["high"].append(done)

    energy_output = {
        level: {
            "sample_days": len(vals),
            "avg_tasks_done": round(sum(vals) / len(vals), 1) if vals else 0,
        }
        for level, vals in bins.items()
    }
    # Simple correlation direction
    low_avg = energy_output["low"]["avg_tasks_done"]
    high_avg = energy_output["high"]["avg_tasks_done"]
    correlation_direction = "positive" if high_avg > low_avg else "flat"

    # ── 5. Time Estimate Accuracy ─────────────────────────────────────────────
    ticket_rows = db.execute(text(
        "SELECT type, estimated_minutes, logged_minutes FROM work_tickets "
        "WHERE estimated_minutes > 0 AND completed_at IS NOT NULL "
        "AND completed_at >= :since"
    ), {"since": since90}).fetchall()

    accuracy_buckets = {"under": 0, "accurate": 0, "over": 0}
    accuracy_by_type = {}
    for row in ticket_rows:
        ttype, est, logged = row[0], row[1], row[2] or 0
        if est > 0:
            ratio = logged / est
            bucket = "under" if ratio < 0.8 else "over" if ratio > 1.3 else "accurate"
            accuracy_buckets[bucket] += 1
            if ttype not in accuracy_by_type:
                accuracy_by_type[ttype] = {"under": 0, "accurate": 0, "over": 0, "total": 0}
            accuracy_by_type[ttype][bucket] += 1
            accuracy_by_type[ttype]["total"] += 1

    total_tickets = sum(accuracy_buckets.values()) or 1
    time_estimate_accuracy = {
        "distribution": {k: {"count": v, "pct": round(v / total_tickets * 100)} for k, v in accuracy_buckets.items()},
        "by_type": accuracy_by_type,
        "total_tickets_analyzed": total_tickets,
    }

    # ── 6. Eisenhower Distribution ────────────────────────────────────────────
    eis_rows = db.execute(text(
        "SELECT t.is_urgent, t.is_important, COUNT(el.id) as cnt "
        "FROM execution_logs el JOIN tasks t ON el.task_id = t.id "
        "WHERE el.completed_at >= :since "
        "GROUP BY t.is_urgent, t.is_important"
    ), {"since": since30}).fetchall()

    quadrants = {"q1": 0, "q2": 0, "q3": 0, "q4": 0}  # Q1=urgent+imp, Q2=!urg+imp, Q3=urg+!imp, Q4=!urg+!imp
    for row in eis_rows:
        urgent, important, cnt = bool(row[0]), bool(row[1]), row[2]
        if urgent and important:
            quadrants["q1"] += cnt
        elif not urgent and important:
            quadrants["q2"] += cnt
        elif urgent and not important:
            quadrants["q3"] += cnt
        else:
            quadrants["q4"] += cnt

    total_eis = sum(quadrants.values()) or 1
    eisenhower = {
        k: {"count": v, "pct": round(v / total_eis * 100)}
        for k, v in quadrants.items()
    }
    eisenhower["labels"] = {
        "q1": "Urgent + Important (Do Now)",
        "q2": "Important, Not Urgent (Deep Work)",
        "q3": "Urgent, Not Important (Delegate)",
        "q4": "Neither (Eliminate)",
    }

    # ── 7. Habit Resilience ───────────────────────────────────────────────────
    habit_resilience_rows = db.execute(text(
        """
        SELECT t.id, t.title,
               SUM(CASE WHEN dc.morning_energy <= 2 THEN 1 ELSE 0 END) as low_energy_days,
               SUM(CASE WHEN dc.morning_energy <= 2 AND hl.id IS NOT NULL THEN 1 ELSE 0 END) as low_energy_completed,
               SUM(CASE WHEN dc.morning_energy >= 4 THEN 1 ELSE 0 END) as high_energy_days,
               SUM(CASE WHEN dc.morning_energy >= 4 AND hl.id IS NOT NULL THEN 1 ELSE 0 END) as high_energy_completed
        FROM tasks t
        JOIN daily_checkins dc ON 1=1
        LEFT JOIN habit_logs hl ON hl.task_id = t.id AND hl.date = dc.date
        WHERE t.habit_frequency IS NOT NULL AND dc.date >= :since
          AND dc.morning_energy IS NOT NULL
        GROUP BY t.id, t.title
        HAVING low_energy_days > 0
        """
    ), {"since": since30}).fetchall()

    habit_resilience = []
    for row in habit_resilience_rows:
        task_id, title, low_days, low_done, high_days, high_done = row
        low_rate = round(low_done / low_days * 100) if low_days else 0
        high_rate = round(high_done / high_days * 100) if high_days else 0
        habit_resilience.append({
            "task_id": task_id,
            "title": title,
            "low_energy_completion_pct": low_rate,
            "high_energy_completion_pct": high_rate,
            "resilient": low_rate >= 60,
        })
    habit_resilience.sort(key=lambda x: x["low_energy_completion_pct"], reverse=True)

    # ── Dimension Scores (0–100) ───────────────────────────────────────────────

    # Execution: 30-day avg tasks_done / tasks_total
    exec_rows = db.execute(text(
        "SELECT tasks_total, tasks_done FROM daily_snapshots WHERE date >= :since AND tasks_total > 0"
    ), {"since": since30}).fetchall()
    exec_score = 0
    if exec_rows:
        ratios = [r[1] / r[0] for r in exec_rows if r[0] > 0]
        exec_score = round(sum(ratios) / len(ratios) * 100) if ratios else 0

    # Consistency: average habit completion rate
    habit_rows_30 = db.execute(text(
        "SELECT habits_total, habits_done FROM daily_snapshots WHERE date >= :since AND habits_total > 0"
    ), {"since": since30}).fetchall()
    consistency_score = 0
    if habit_rows_30:
        ratios = [r[1] / r[0] for r in habit_rows_30 if r[0] > 0]
        consistency_score = round(sum(ratios) / len(ratios) * 100) if ratios else 0

    # Focus: avg focus_quality from work_sessions (if enough data)
    fq_rows = db.execute(text(
        "SELECT AVG(focus_quality) FROM work_sessions "
        "WHERE focus_quality IS NOT NULL AND started_at >= :since"
    ), {"since": since30}).fetchone()
    focus_raw = fq_rows[0] if fq_rows and fq_rows[0] else None
    focus_score = round(focus_raw * 20) if focus_raw else None  # None = not enough data yet

    # Planning: Q2 pct × 1.5 capped at 100
    planning_score = min(100, round(eisenhower["q2"]["pct"] * 1.5))

    # Balance: 100 - (std_dev of 14-day daily scores × 10)
    balance_rows = db.execute(text(
        "SELECT score_pct FROM daily_snapshots WHERE date >= :since AND score_pct IS NOT NULL"
    ), {"since": since14}).fetchall()
    balance_score = 50  # default
    if len(balance_rows) >= 4:
        scores = [r[0] for r in balance_rows]
        try:
            std = statistics.stdev(scores)
            balance_score = max(0, min(100, round(100 - std * 10)))
        except statistics.StatisticsError:
            pass

    # Growth: avg goal completion % for active (non-archived) goals
    # Compute dynamically via tasks table
    growth_rows = db.execute(text(
        """
        SELECT
            COUNT(CASE WHEN t.status = 'done' THEN 1 END) as done_count,
            COUNT(t.id) as total_count
        FROM goals g
        LEFT JOIN tasks t ON t.goal_id = g.id AND t.habit_frequency IS NULL
        WHERE g.archived_at IS NULL
        GROUP BY g.id
        HAVING total_count > 0
        """
    )).fetchall()
    growth_score = 0
    if growth_rows:
        ratios = [r[0] / r[1] for r in growth_rows if r[1] > 0]
        growth_score = round(sum(ratios) / len(ratios) * 100) if ratios else 0

    dimension_scores = {
        "execution": exec_score,
        "consistency": consistency_score,
        "focus": focus_score,          # None = not rated yet
        "planning": planning_score,
        "balance": balance_score,
        "growth": growth_score,
    }

    return {
        "generated_at": date.today().isoformat(),
        "data_window_days": DAYS_BACK,
        "peak_hours": peak_hours,
        "best_hour": best_hour,
        "peak_days": peak_days,
        "best_day": best_day_name,
        "task_type_affinity": task_type_affinity,
        "procrastination": {
            "reason_distribution": reason_distribution,
            "most_deferred_tasks": most_deferred_tasks,
        },
        "energy_output_correlation": {
            "bins": energy_output,
            "direction": correlation_direction,
        },
        "time_estimate_accuracy": time_estimate_accuracy,
        "eisenhower": eisenhower,
        "habit_resilience": habit_resilience,
        "dimension_scores": dimension_scores,
    }
