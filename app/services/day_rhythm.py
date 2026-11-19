"""Day rhythm: the repeating shape of a day and how a given day is built from it.

A ``RhythmBlock`` is a weekday template ("Mon–Fri 09:00, 2h, HaramBlur"). A day's
blocks are the template blocks for that weekday, with any ``DayBlock`` row that
carries the same ``rhythm_id`` and date standing in for one block (moved, resized
or skipped), plus ad-hoc blocks made for that date alone. Items planned for the
day file themselves into blocks by target: tickets by client (or linked project),
tasks by project (or its parent project), habits into the routine block whose
window holds their time. Recorded time reaches blocks through the same targets.

Reading is side-effect free; ``ensure_override`` and ``shift_day`` write.
"""

from datetime import UTC, date, datetime
from uuid import uuid4

from sqlalchemy.orm import Session

from app.models.company import Company
from app.models.day_block import DayBlock
from app.models.goal import Goal
from app.models.rhythm_block import RHYTHM_KINDS, WORK_KINDS, RhythmBlock
from app.models.setting import Setting
from app.models.task import Task, is_habit
from app.models.work_ticket import WorkTicket
from app.services.habit_routine import WEEKDAYS, parse_routine_days, weekday_token

DAY_MINUTES = 24 * 60
MIN_BLOCK = 5
MAX_BLOCK = 12 * 60

# Research-backed shape used by the suggested rhythm: deep work in ~2h blocks with a
# short break between (most people sustain 75–120 min of focus), at most three deep
# blocks a day, a real lunch, and protected personal time in the evening.
DEEP_BLOCK_MINUTES = 120
BREAK_MINUTES = 15
LUNCH_MINUTES = 60
MAX_DEEP_BLOCKS = 3


def to_minutes(hhmm: str | None) -> int | None:
    if not hhmm:
        return None
    try:
        h, m = hhmm.split(":")
        v = int(h) * 60 + int(m)
    except (ValueError, AttributeError):
        raise ValueError(f"time must be HH:MM, got {hhmm!r}")
    if not 0 <= v < DAY_MINUTES:
        raise ValueError(f"time must be within the day, got {hhmm!r}")
    return v


def to_hhmm(minutes: int) -> str:
    minutes = max(0, min(DAY_MINUTES - 1, int(minutes)))
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def parse_days(value) -> list[str]:
    return parse_routine_days(value)


def validate_kind_and_target(db: Session, kind: str, target_ref: str | None) -> None:
    if kind not in RHYTHM_KINDS:
        raise ValueError(f"Unknown block kind: {kind}")
    if kind in WORK_KINDS:
        if not target_ref or ":" not in target_ref:
            raise ValueError(f"A {kind} block needs a target like goal:<id> or company:<id>")
        prefix, ident = target_ref.split(":", 1)
        expected = "goal" if kind == "project" else "company"
        if prefix != expected:
            raise ValueError(f"A {kind} block must target {expected}:<id>")
        model = Goal if prefix == "goal" else Company
        if not db.query(model.id).filter(model.id == ident).first():
            raise ValueError(f"Referenced {prefix} '{ident}' does not exist")
    elif target_ref:
        raise ValueError(f"A {kind} block does not take a target")


def _targets(db: Session, refs: set[str]) -> dict[str, dict]:
    """{target_ref: {title, color}} for every goal/company referenced."""
    out: dict[str, dict] = {}
    goal_ids = [r.split(":", 1)[1] for r in refs if r.startswith("goal:")]
    co_ids = [r.split(":", 1)[1] for r in refs if r.startswith("company:")]
    if goal_ids:
        for g in db.query(Goal).filter(Goal.id.in_(goal_ids)).all():
            out[f"goal:{g.id}"] = {"title": g.title, "color": None}
    if co_ids:
        for c in db.query(Company).filter(Company.id.in_(co_ids)).all():
            out[f"company:{c.id}"] = {"title": c.name, "color": c.color}
    return out


def _block_dict(src, day_iso: str, *, rhythm: RhythmBlock | None, override: DayBlock | None,
                targets: dict[str, dict]) -> dict:
    start = override.start_time if override else src.start_time
    dur = override.duration_minutes if override else src.duration_minutes
    kind = rhythm.kind if rhythm else src.kind
    target_ref = rhythm.target_ref if rhythm else (src.source_ref if src.kind in WORK_KINDS else None)
    title = (rhythm.title if rhythm else src.title) or (targets.get(target_ref) or {}).get("title") or kind.title()
    s = to_minutes(start) or 0
    return {
        "id": override.id if override else (f"rhythm:{rhythm.id}:{day_iso}" if rhythm else src.id),
        "rhythm_id": rhythm.id if rhythm else None,
        "date": day_iso,
        "kind": kind,
        "target_ref": target_ref,
        "target_title": (targets.get(target_ref) or {}).get("title"),
        "color": (rhythm.color if rhythm else None) or (targets.get(target_ref) or {}).get("color"),
        "title": title,
        "start_time": start,
        "end_time": to_hhmm(s + dur),
        "start_minutes": s,
        "duration_minutes": dur,
        "virtual": override is None and rhythm is not None,   # straight from the template
        "added": False,                                        # set when this day is not one of the block's weekdays
        "revision": override.revision if override else 0,
        "note": override.note if override else "",
        "items": [],
        "recorded_seconds": 0,
        "live_seconds": 0,
    }


def template_blocks(db: Session) -> list[RhythmBlock]:
    return sorted(db.query(RhythmBlock).all(), key=lambda b: (b.start_time, b.sort_order, b.title))


def resolve_day(db: Session, day: date) -> dict:
    """The day's blocks (sorted by start) and the template blocks skipped that day."""
    day_iso = day.isoformat()
    token = weekday_token(day)
    all_template = template_blocks(db)
    rhythm = [b for b in all_template if token in parse_days(b.days)]
    rows = db.query(DayBlock).filter(DayBlock.date == day_iso).all()
    overrides = {r.rhythm_id: r for r in rows if r.rhythm_id}
    adhoc = [r for r in rows if not r.rhythm_id and not r.skipped and r.start_time]
    # A template block pulled onto a day that is not one of its weekdays: its override
    # row (not skipped) is the only trace, so it is "added" here and "removed" by restore.
    on_weekday = {b.id for b in rhythm}
    added = [b for b in all_template if b.id in overrides and b.id not in on_weekday and not overrides[b.id].skipped]
    refs = ({b.target_ref for b in rhythm + added if b.target_ref}
            | {r.source_ref for r in adhoc if r.source_ref})
    targets = _targets(db, refs)

    blocks: list[dict] = []
    skipped: list[dict] = []
    for b in rhythm:
        o = overrides.get(b.id)
        d = _block_dict(b, day_iso, rhythm=b, override=o, targets=targets)
        (skipped if (o and o.skipped) else blocks).append(d)
    for b in added:
        d = _block_dict(b, day_iso, rhythm=b, override=overrides[b.id], targets=targets)
        d["added"] = True
        blocks.append(d)
    for r in adhoc:
        blocks.append(_block_dict(r, day_iso, rhythm=None, override=r, targets=targets))
    blocks.sort(key=lambda d: (d["start_minutes"], d["title"]))
    return {"date": day_iso, "blocks": blocks, "skipped": skipped}


# ── Per-day changes ───────────────────────────────────────────────────────────

def ensure_override(db: Session, rhythm: RhythmBlock, day_iso: str) -> DayBlock:
    row = db.query(DayBlock).filter(DayBlock.rhythm_id == rhythm.id, DayBlock.date == day_iso).first()
    if row:
        return row
    row = DayBlock(
        id=str(uuid4()), date=day_iso, kind=rhythm.kind, source_ref=rhythm.target_ref,
        start_time=rhythm.start_time, duration_minutes=rhythm.duration_minutes,
        title=rhythm.title, note="", rhythm_id=rhythm.id, skipped=False,
    )
    db.add(row)
    db.flush()
    return row


def shift_day(db: Session, day: date, from_time: str, minutes: int) -> dict:
    """Push every block starting at or after ``from_time`` later by ``minutes`` (or
    earlier when negative), keeping each inside the day. Template blocks get an
    override row; ad-hoc blocks move in place."""
    day_iso = day.isoformat()
    cut = to_minutes(from_time) or 0
    resolved = resolve_day(db, day)
    by_rhythm = {b.id: b for b in template_blocks(db)}
    for d in resolved["blocks"]:
        if d["start_minutes"] < cut:
            continue
        new_start = max(0, min(DAY_MINUTES - d["duration_minutes"], d["start_minutes"] + minutes))
        if d["rhythm_id"]:
            row = ensure_override(db, by_rhythm[d["rhythm_id"]], day_iso)
        else:
            row = db.get(DayBlock, d["id"])
        if row is None:
            continue
        row.start_time = to_hhmm(new_start)
        row.revision = (row.revision or 0) + 1
        row.updated_at = datetime.now(UTC)
    db.commit()
    return resolve_day(db, day)


# ── Filing items and time into blocks ─────────────────────────────────────────

def goal_parents(db: Session, goal_ids: set[str]) -> dict[str, str | None]:
    if not goal_ids:
        return {}
    return dict(db.query(Goal.id, Goal.parent_id).filter(Goal.id.in_(list(goal_ids))).all())


def _name_key(name: str | None) -> str | None:
    """A project and a client with the same name are the same thing to a block
    ("HaramBlur" the goal and "HaramBlur" the company)."""
    key = "".join(ch for ch in (name or "").lower() if ch.isalnum())
    return f"name:{key}" if key else None


def _candidates(item: dict, parents: dict[str, str | None]) -> list[str]:
    refs: list[str] = []
    src = item.get("source")
    if src == "ticket":
        if item.get("company_id"):
            refs.append(f"company:{item['company_id']}")
        if item.get("goal_id"):
            refs.append(f"goal:{item['goal_id']}")
        refs.append(_name_key(item.get("company_name")))
    elif src == "worklog":
        if item.get("company_id"):
            refs.append(f"company:{item['company_id']}")
        refs.append(_name_key(item.get("company_name")))
    elif src in ("task", "habit"):
        gid = item.get("goal_id")
        seen = set()
        while gid and gid not in seen:
            refs.append(f"goal:{gid}")
            seen.add(gid)
            gid = parents.get(gid)
        refs.append(_name_key(item.get("project_title")))
    return [r for r in refs if r]


def file_items(blocks: list[dict], items: list[dict], parents: dict[str, str | None]) -> None:
    """Set item["block_id"] and block["items"] in place. First match wins, in this
    order: a block of the item's target whose window holds the item's time, then the
    earliest block of that target. A habit goes to the routine block holding its time;
    an untimed habit joins the first routine block; a habit timed outside every
    routine block stays unfiled rather than being shown under the wrong hour. A
    timed item that matches no block by target lands in an "open time" (free) block
    whose window holds its time — that is what open time is for."""
    for b in blocks:
        b["items"] = []
    by_ref: dict[str, list[dict]] = {}
    routine = [b for b in blocks if b["kind"] == "routine"]
    open_time = [b for b in blocks if b["kind"] == "free"]
    for b in blocks:
        if b["target_ref"]:
            by_ref.setdefault(b["target_ref"], []).append(b)
            alias = _name_key(b.get("target_title"))
            if alias:
                by_ref.setdefault(alias, []).append(b)

    def holds(b: dict, hhmm: str | None) -> bool:
        if not hhmm:
            return False
        m = to_minutes(hhmm) or 0
        return b["start_minutes"] <= m < b["start_minutes"] + b["duration_minutes"]

    for item in items:
        item["block_id"] = None
        chosen = None
        if item.get("source") == "habit":
            if item.get("scheduled_time"):
                chosen = next((b for b in routine if holds(b, item["scheduled_time"])), None)
            else:
                chosen = routine[0] if routine else None
        item["off_block"] = None
        if chosen is None:
            for ref in _candidates(item, parents):
                cands = by_ref.get(ref) or []
                if not cands:
                    continue
                inside = next((b for b in cands if holds(b, item.get("scheduled_time"))), None)
                chosen = inside or cands[0]
                if inside is None and item.get("scheduled_time"):
                    # Timed outside every block of its own client/project: a conflict the
                    # user resolves by moving it in, or by adding a block for it here.
                    item["off_block"] = {
                        "block_id": chosen["id"], "title": chosen["title"], "kind": chosen["kind"],
                        "target_ref": chosen["target_ref"], "start_time": chosen["start_time"],
                        "end_time": chosen["end_time"],
                    }
                break
        if chosen is None and item.get("source") != "habit" and item.get("scheduled_time"):
            chosen = next((b for b in open_time if holds(b, item["scheduled_time"])), None)
        if chosen is not None:
            item["block_id"] = chosen["id"]
            chosen["items"].append(item["key"])


def apply_recorded(blocks: list[dict], by_project: list[dict], by_client: list[dict]) -> None:
    """Spread each target's recorded and live seconds over its blocks in start
    order, filling each up to its length; whatever is left lands on the last."""
    totals: dict[str, tuple[int, int]] = {}
    for row in by_project:
        if row.get("project_id"):
            totals[f"goal:{row['project_id']}"] = (row["seconds"], row["live_seconds"])
    for row in by_client:
        if row.get("company_id"):
            totals[f"company:{row['company_id']}"] = (row["seconds"], row["live_seconds"])
    groups: dict[str, list[dict]] = {}
    for b in blocks:
        if b["target_ref"]:
            groups.setdefault(b["target_ref"], []).append(b)
    for ref, group in groups.items():
        rec, live = totals.get(ref, (0, 0))
        for i, b in enumerate(group):
            cap = b["duration_minutes"] * 60
            last = i == len(group) - 1
            take = rec if last else min(rec, cap)
            b["recorded_seconds"] = take
            rec -= take
            take_live = live if last else min(live, max(0, cap - b["recorded_seconds"]))
            b["live_seconds"] = take_live
            live -= take_live


def rhythm_totals(blocks: list[dict]) -> dict:
    out = {"work_minutes": 0, "routine_minutes": 0, "personal_minutes": 0, "break_minutes": 0}
    for b in blocks:
        k = b["kind"]
        if k in WORK_KINDS:
            out["work_minutes"] += b["duration_minutes"]
        elif k == "routine":
            out["routine_minutes"] += b["duration_minutes"]
        elif k == "break":
            out["break_minutes"] += b["duration_minutes"]
        else:
            out["personal_minutes"] += b["duration_minutes"]
    return out


def current_and_next(blocks: list[dict], now_minutes: int) -> tuple[dict | None, dict | None]:
    current = next((b for b in blocks if b["start_minutes"] <= now_minutes < b["start_minutes"] + b["duration_minutes"]), None)
    upcoming = next((b for b in blocks if b["start_minutes"] > now_minutes), None)
    return current, upcoming


# ── A suggested rhythm from what the user already has ─────────────────────────

def suggest(db: Session) -> list[dict]:
    """A starting template built from the user's own projects, clients and habits.
    Nothing is saved; the user edits and confirms it."""
    settings = {s.key: s.value for s in db.query(Setting).all()}
    day_start = to_minutes(settings.get("day_start", "09:00")) or 540
    day_end = to_minutes(settings.get("day_end", "18:00")) or 1080
    all_days = list(WEEKDAYS)
    weekdays = all_days[:5]
    out: list[dict] = []

    def add(title, kind, start, dur, days=None, target_ref=None, reason=""):
        out.append({"title": title, "kind": kind, "target_ref": target_ref, "days": days or weekdays,
                    "start_time": to_hhmm(start), "duration_minutes": dur, "reason": reason})

    # Morning routine: before the work window when habits already sit there.
    habit_times = []
    for g in db.query(Goal).filter(Goal.type == "resolution", Goal.archived_at.is_(None), Goal.trashed_at.is_(None)).all():
        for t in g.tasks:
            if t.status != "done" and t.trashed_at is None and is_habit(t, g.type) and t.scheduled_time:
                habit_times.append(to_minutes(t.scheduled_time) or 0)
    early = [m for m in habit_times if m < day_start]
    routine_start = min(early) if early else max(0, day_start - 90)
    routine_len = max(60, min(120, day_start - routine_start)) if routine_start < day_start else 60
    add("Morning routine", "routine", routine_start, routine_len, all_days,
        reason="Your habits with a morning time land here; the day starts with them, not with mail.")

    # Deep work: the clients and projects with the most open work, 2h each with a break.
    targets: list[tuple[str, str, int]] = []
    for c in db.query(Company).all():
        n = db.query(WorkTicket).filter(WorkTicket.company_id == c.id, WorkTicket.status.notin_(["done"])).count()
        if n:
            targets.append((f"company:{c.id}", c.name, n))
    for g in db.query(Goal).filter(Goal.type == "project", Goal.archived_at.is_(None), Goal.trashed_at.is_(None), Goal.parent_id.is_(None)).all():
        n = db.query(Task).filter(Task.goal_id == g.id, Task.status == "todo", Task.trashed_at.is_(None)).count()
        if n and not any(name.lower() == g.title.lower() for _, name, _ in targets):
            targets.append((f"goal:{g.id}", g.title, n))
    targets.sort(key=lambda t: -t[2])
    job_goal = next((g for g in db.query(Goal).filter(Goal.archived_at.is_(None), Goal.trashed_at.is_(None)).all()
                     if "job" in g.title.lower()), None)
    deep = [t for t in targets if not (job_goal and t[0] == f"goal:{job_goal.id}")][:MAX_DEEP_BLOCKS]

    cursor = day_start
    for i, (ref, name, n) in enumerate(deep):
        if i == 2:   # lunch before the third deep block
            add("Lunch & reset", "personal", cursor, LUNCH_MINUTES, reason="A real break keeps the afternoon block honest.")
            cursor += LUNCH_MINUTES
        add(name, "client" if ref.startswith("company:") else "project", cursor, DEEP_BLOCK_MINUTES, target_ref=ref,
            reason=f"{n} open item{'s' if n != 1 else ''}. Two hours of deep work; most people sustain 75–120 min, so the break after it is part of the block.")
        cursor += DEEP_BLOCK_MINUTES
        if i < len(deep) - 1 and i != 1:
            add("Break", "break", cursor, BREAK_MINUTES, reason="Short, low-stimulation rest between deep blocks.")
            cursor += BREAK_MINUTES
    if len(deep) < 2:
        add("Lunch & reset", "personal", cursor, LUNCH_MINUTES, reason="A real break keeps the afternoon honest.")
        cursor += LUNCH_MINUTES
    if job_goal:
        add("Job search", "project", cursor, 60, target_ref=f"goal:{job_goal.id}",
            reason="One focused hour; applications are shallow work, so they come after the deep blocks.")
        cursor += 60
    if cursor < day_end:
        add("Open time", "free", cursor, day_end - cursor, reason="Slack for what the day brings; planned work spills here before it spills into your evening.")
    add("Evening (yours)", "personal", max(day_end, cursor) + 60, 120, all_days,
        reason="Protected recovery time. Rest is what makes tomorrow's deep work possible.")
    return out
