# Basira Today — next phase

Prepared September 18, 2026. Planning only: no application changes, database queries, migrations, or user-data edits were performed for this phase.

## Product decision

Make Today the place to **choose what gets your time, structure the day, and see where that time actually went**.

It should answer four questions immediately:

1. What am I working on today?
2. When will I work on it?
3. How much time did each project or client receive?
4. What is next, and what needs to move?

Retain Basira's emerald/ivory/ink identity and evidence-backed completion. The next improvement is primarily the daily workflow and trustworthy time accounting.

## Inspiration and how to use it

These are established products with relevant patterns, not a verified worldwide usage ranking. Official pages were reviewed for features; adoption claims are not used to rank products.

| Product | Observed pattern | Basira adaptation |
| --- | --- | --- |
| [Sunsama](https://www.sunsama.com/) | Guided daily planning, realistic workload, calendar timeboxing, actual/planned time, and daily shutdown | A short Plan day flow; an explicit time budget; a project time breakdown that stays visible while working |
| [Structured](https://structured.app/) | A single visual timeline for tasks and daily activities | A readable agenda that combines work, personal projects, habits, and breaks, with a prominent Now/Next state |
| [TickTick](https://ticktick.com/public/changelog/en.html) | Calendar visibility for habits with reminders and habit completion statistics | Compact routines grouped by time of day, optionally scheduled, with occurrence-based check-ins |
| [Todoist](https://www.todoist.com/de/help/todoist/get-started/time-blocking-in-todoist-d6Pf1uTpc) | Today/calendar time blocking | Quick task selection, explicit time/duration controls, and easy rescheduling |
| [Akiflow](https://product.akiflow.com/help/articles/3089241-time-slots) | Time slots that contain tasks for an activity | Reserve a project work block first, then pick the specific task/ticket to work on inside it |

Design synthesis: Sunsama's deliberate planning, Structured's visible day, Akiflow's project blocks, and TickTick's routines. These adaptations are design proposals, not claims about those products' internal implementations.

## Current project findings

- `TodayPage.jsx` emphasizes one focus card and supporting priorities, but its summary uses `getTimerToday()` task sessions. It does not provide one combined task/client/project ledger.
- `DayPlanner.jsx`, `DailySchedule.jsx`, and `PlannerView.jsx` maintain different planning representations.
- `PlannerView.jsx` persists start times and work-block durations in local storage and initializes a schedule when mounted. That can make a generated layout appear like a committed plan.
- `Task.scheduled_time`, `plan_date`, and `estimated_minutes` are useful starting fields, but one task-level time cannot represent several blocks across dates. A ticket's total estimate is not today's allocation.
- `WorkSession` represents task sessions and work sessions, while `WorkTimeEntry` stores dated ticket time. The reporting service already avoids counting their duplicated representation twice.
- Work tickets and logs can link to goals; a company is a client grouping, not automatically a project. Titles must never be used as join keys.
- Task timer start can stop another active session; ticket timer start checks its own ticket namespace. A unified UI must account for these different semantics before offering one Start button everywhere.
- Task daily summaries use a UTC boundary built from the server date and filter by session start. Sessions spanning local midnight need a clearer day-allocation policy.
- `GET /today` can commit daily snapshots. Backend startup also contains migrations. Testing against the live app is not a safe read-only assumption.
- An existing uncommitted Today change was present during review; implementation must preserve it.

## Proposed desktop layout

```text
TODAY                 Fri, Sep 18       ‹ date ›   Plan day

Work: 3h 20m recorded + 18m live   Planned: 6h   Free: 1h
──────────────────────────────────────────────────────────
YOUR DAY                                  TIME BY PROJECT
09:00–10:30  Client Alpha / Model work     Work            3h 20m
             90m planned · 65m recorded    Client Alpha    2h 10m
10:30–10:45  Break                         Client Beta     1h 10m
10:45–12:00  Basira / Today redesign       Personal        45m
             [Start] [Move]                Basira          45m
12:00–13:00  Lunch                         Today | This week
13:00–14:30  Client Beta / Research         [View sessions]
14:30–15:00  Open time
                                          ROUTINES
UNSCHEDULED TODAY                         Morning   2 / 3
• Goal-linked tasks / tickets             Afternoon 0 / 2
[Add from projects or work]                Evening   0 / 2
──────────────────────────────────────────────────────────
Now: Client Alpha / Model work · 18:24     Pause | Switch
Completed & evidence                      Wrap up day
```

Numbers and names above are synthetic examples. The main agenda owns about two-thirds of desktop width; the time/routine panel owns one-third. The active timer is compact and persistent. Use project labels and modest color accents; do not place every item inside a large decorative card.

On mobile, show Now/Next, a compact time summary, the agenda, and collapsible project/routine sections. Keep Start, Add, Move, and time controls available without dragging. Both agenda and timeline use the same day model; no independent schedule is generated when changing views.

## Daily workflow

### Morning: Plan day in a few minutes

1. Set a day window and optional work budget. Breaks and personal commitments occupy the day but do not count as work hours.
2. Select active projects and clients from existing Goals and Work. Show recent items first, with search and an All items fallback.
3. Reserve blocks: “Client Alpha, 90 minutes” or “Basira, 60 minutes.” Choose a task immediately or leave the block as a project reservation.
4. Pull specific tasks/tickets into blocks. Existing items are referenced, never copied into new Tasks merely to appear on Today.
5. Add routine occurrences and breaks, leaving visible free space. Flag overlaps and over-capacity without preventing intentional edits.
6. Confirm the draft. Opening Today or previewing suggestions never writes a plan.

A project reservation is a planning object, not an orphan Task. Starting its timer requires selecting or creating an appropriate goal-linked Task or existing Work item. Work items keep their current entity type.

### During the day: Work and adjust

- Every task/ticket row shows its parent, today's allocation, today's recorded time, and clear Start/Resume/Move actions.
- Starting another item offers an explicit switch; the current session is saved before the new one starts. If saving fails, keep the current session and display recovery controls.
- Pausing ends the current interval; resuming creates a new interval. Never infer worked time from a planned block.
- Moving a block changes its schedule only. It does not move saved time or change a project's total estimate.
- A long task can have multiple blocks in the same day and across days.
- “Log time” supports missed sessions with date, duration, source item, and optional note. Show saved time and live elapsed time separately.
- When behind schedule, offer “Move remaining blocks” with a preview. Keep fixed commitments in place and require explicit confirmation of the schedule edits.
- Complete a Task through the existing proof workflow; ending a timer alone does not complete it.

### Evening: Wrap up

Show planned versus recorded time by project/client, completed tasks with evidence, and unfinished blocks. Offer move to tomorrow or leave unscheduled. Carry forward requires an explicit action; no automatic data edits at midnight. Reflection remains optional.

## Time breakdown rules

The time panel is the central new feature, not a link to a separate analytics page.

| Display | Meaning |
| --- | --- |
| Planned today | Sum of that date's block allocations; a project container and its tasks are not added twice |
| Recorded today | Saved durations allocated to the selected date under the rules below |
| Live | Unsaved elapsed time for active sessions, calculated at one shared as-of timestamp |
| This week | Recorded totals for the local Monday–Sunday week; live remains separate |
| Project total | Optional lifetime recorded total, clearly labeled; never substituted for today's hours |
| Completed | Evidence-backed task state; independent of hours or percentage of estimate consumed |

Canonical accounting:

- Task time: saved task `WorkSession` durations, joined through Task → Goal.
- Ticket time: `WorkTimeEntry` records. Do not add ended `WorkSession` representations of those same ticket entries again.
- Standalone work-log time: its recorded duration/date under the existing reporting contract. Do not also add duplicated work sessions.
- Ticket/work-log sessions still running: live overlay only; exclude from saved report totals.
- Time spent on unscheduled items still appears in actual totals.
- Manual records with only duration/date remain date-based records; do not fabricate precise historical start/end times.
- Timestamped task intervals can be clipped to the selected local-day boundary on read. Preserve saved durations: if duration differs from wall-clock span, flag it and use a documented proportional allocation for the clipped interval rather than silently replacing recorded time.
- Preserve existing work-report saved dates. Do not redistribute historical ticket or standalone-log hours to make new charts look more precise.
- Missing links appear under an explicit Unassigned or Client only bucket. Do not silently create goals or guess projects from titles.
- Use source-qualified IDs, such as `task:<id>` and `ticket:<id>`, to avoid collisions.
- Within the Work view, show client parents with project children and a Client only child where needed. Children sum to the parent. Personal projects use a separate group. A cross-cutting Goals view may show linked work too, but must not add that alternate grouping to the global total.
- If legacy timers overlap, show a warning and source-recorded totals; label them tracked time rather than unique working hours. Do not repair historical overlaps automatically.
- Use exact seconds internally and round only for display. Refreshing, reordering, or changing grouping never changes totals.

## Habits and routines

Habits should be visible alongside the day without taking over the work planner.

Group occurrences into Morning / Afternoon / Evening / Anytime. Show progress such as 1 of 2 daily repetitions. Weekly habits display their weekly target without implying they are mandatory every day. Selecting a habit can add a planned occurrence to the agenda; that agenda item and the routine checklist update the same occurrence.

Keep routine duration optional and actual time opt-in. A checked habit does not invent minutes. Time on a routine belongs to Personal/routine totals unless explicitly categorized otherwise. Keep check-ins distinct from one-off Task completion and preserve required date-scoped evidence where applicable.

## Technical implementation plan

### A. Trustworthy read model — first

Add a dedicated read-only day-summary service and endpoint, for example `GET /day-workspace?date=YYYY-MM-DD&timezone=America/Chicago`. Do not repurpose `/today` until its snapshot-writing side effects are addressed.

Return agenda references, available items, totals, project/client groupings, routines, all active timer references, warnings, and an `as_of` value. Reuse existing report source-selection rules and add goal attribution through ID joins. Read operations must not commit, migrate, create snapshots, or populate missing goals.

Build in-memory tests for task/ticket/work-log mixtures, unlinked items, live sessions, legacy overlaps, local midnight/DST, durations differing from wall time, and double-count prevention. Verify that queries cannot issue INSERT/UPDATE/DELETE.

### B. Today redesign with existing data

Extract `TodayPage` into `DayHeader`, `DayAgenda`, `TodayItemPicker`, `ProjectTimePanel`, `RoutinePanel`, and `ActiveSessionBar`. Fetch one day model and refresh it after successful explicit mutations. Keep Today date selection separate from due dates.

Initially show today's existing schedule and accurate time groups. Use explicit time/duration inputs and keyboard actions. Replace the overlapping planner entry points with one Plan day button. Remove calendar initialization writes on view mount; legacy local storage can be read without overwriting it.

This first usable slice can be implemented without schema changes. Clearly disclose the limits of existing single-block scheduling.

### C. Durable blocks — additive follow-up

Introduce a small DayPlan/DayBlock model only when multi-block planning is connected. Each block has date, start, daily duration, kind, source reference when applicable, and revision/version. Project reservations reference an existing goal; client-only work reservations reference an existing company. Validate references and allowed kinds.

Tasks remain linked to Goals. Planning blocks are not Tasks or ExecutionLogs. Existing task and work estimates stay intact. Import old schedules only on explicit user action; never automatically backfill or rewrite historical data.

Add preview/save/move operations with conflict detection. Store confirmed plans on the server; local storage holds only recoverable drafts. Draft saves do not persist silently to the live database.

### D. Consistent timers and closeout

Provide one adapter for task, ticket, and work-log timers, with server-enforced switching semantics and retry-safe saves. Preserve the existing report ledger for each source type. Enumerate legacy multiple-active states before enabling the new single-active workflow; do not stop sessions just by visiting Today.

Connect proof-backed Task completion, manual logging, plan carry-forward, and wrap-up. Verify transitions against an isolated fixture database before allowing live use.

## Ordered backlog and estimates

| Step | Result | Primary code areas | Rough engineering days |
| --- | --- | --- | --- |
| 1 | Read-only unified daily totals and attribution | New `app/services/day_workspace.py`, route/schema; reuse `work_reports.py` | 2–3 |
| 2 | Today layout, agenda, project/client breakdown, routines | `TodayPage.jsx`, new `features/today/*`, `api.js`, styles | 2–3 |
| 3 | One planning flow and shared schedule views using current fields | `DayPlanner.jsx`, `DailySchedule.jsx`, `PlannerView.jsx` | 2–3 |
| 4 | Additive blocks and explicit durable save | New DayPlan/DayBlock model, routes, isolated migration checks | 2–4 |
| 5 | Unified timer switch, manual entries, day closeout | `TimerContext.jsx`, timer routes, Work timer paths, completion dialog | 2–4 |
| 6 | Mobile, keyboard, failure recovery, totals verification | Fixture/browser checks and report regressions | 1–2 |

First milestone: steps 1–3, approximately 6–9 engineering days. Full phase: approximately 11–19 engineering days including multi-block persistence and timer harmonization. Estimates exclude external calendar integrations, AI autoscheduling, and a broad Work data-model migration.

## Data preservation and release checks

- Planning and review use source code and synthetic examples; avoid live `/today` calls because they may write snapshots.
- Implement and test in-memory or temporary fixture databases. Do not import/start `app.main` against the live database during QA.
- No live schema migration, legacy backfill, automatic recategorization, timer stopping, or local-storage overwrite is part of the preview.
- If durable blocks need a new table, test its additive migration in isolation and document it. Applying it to the live database is a separate explicit action, even though existing records would be retained.
- Existing reporting checks must pass with exactly the same totals and saved-date interpretation.
- Two representations of a saved ticket session count once. Client/project alternate groupings never inflate totals.
- Agenda and timeline reflect the same data. Opening either view cannot save a schedule.
- A session that crosses midnight, a missing project link, a failed save, and multiple legacy active timers all have honest visible states.
- The user can select a project, add a block, start work, pause, log missing time, and inspect its daily total without leaving Today.
- Confirm readable desktop and 390px mobile layouts with keyboard and touch controls. Dragging is optional.
- Day planning should be achievable in under three minutes with existing projects; treat this as a usability target to measure, not a promised result.

## Recommended next action

Implement the read-only day-summary and the Today layout first. The earliest deliverable should already answer **“What did I work on, and how many hours went to each project/client today?”** Then add richer time-block persistence and the unified timer workflow once the totals and attribution are proven.
