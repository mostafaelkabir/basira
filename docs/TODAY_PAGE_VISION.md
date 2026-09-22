# Today page: product vision and improvement plan

Updated September 20, 2026. Written from a product-management review of the live Today page (branch `feat/basira-futuristic-ui`, commit 3ef8aba) plus the code behind it. It refines, and does not replace, `BASIRA_PRODUCT_PRIORITIES.md`. Where the two disagree, this document is the more specific one for Today.

Companion mockup of the future page: `docs/today-vision-mockup.html` (published at https://claude.ai/artifact/PndyX3knPuiMsP1urdhzco). Tickets BAS-029 to BAS-040 on the Basira Improvements board (tag `today-vision`) implement this document.

---

## 1. What Today is for

Today is the only page the user must open every day. It has one job: **make the day feel handled**. That decomposes into six ordered goals. Everything on the page should serve one of them, and anything that serves none of them belongs on another page.

| # | Goal | The question it answers | Success looks like |
|---|------|-------------------------|--------------------|
| 1 | **Know what now** | "What am I on, and what's next?" | The answer is visible without scrolling, at any hour. |
| 2 | **Keep the plan realistic** | "Does today fit?" | Planned time is always shown against available time, with a buffer. |
| 3 | **Plan in one place, inline** | "What will I do today?" | Choosing work, giving it time, and seeing the day happen on the same screen. |
| 4 | **Track without thinking** | "Where did my time go?" | Any work item (task or ticket) starts from its row with one tap; switching saves the previous one. |
| 5 | **Close the day deliberately** | "What's unfinished, and what carries?" | Unfinished work is carried or dropped by an explicit choice, never silently. |
| 6 | **Keep habits light** | "Did I do my routine?" | Habits are a one-row strip of daily check marks. They never appear on the schedule and are never timed. |

Non-goals for Today: browsing the backlog, managing goals, analytics, reflection journaling. Those live on Goals, Work, Progress, Journal, and Weekly review.

---

## 2. How a user actually sets up a day

The page should be designed around four moments, not around entity types.

**Morning, about 3 minutes.** Open Today. See fixed commitments (timed habits, meetings). Look at a short, explainable list of suggestions and pick one main outcome plus two to four supporting items. Give each a duration. See "planned 5h of 7h available" turn from empty to full. Start the first item. Nothing else.

**Working, dozens of times a day.** Glance at the top: what's running, elapsed vs planned, what's next and when. Tap Done, and the next item is offered. Tap Switch to move to a ticket that came up. Never scroll to find the active row.

**Interruptions, a few times a day.** Type three words into one composer to capture or find something. Drag a row to a new time. Push something to tomorrow with a reason. All without leaving the page or opening a modal.

**Evening, about 2 minutes.** A close-the-day card lists unfinished items with carry, drop, or reschedule. Recorded time by project and client is shown. One optional line of reflection. Tomorrow already has a seed.

---

## 3. What the current page gets right

- One chronological agenda instead of four competing sections. Good call, keep it.
- The compact header and the single planned/worked time line are the right shape.
- Find-or-create composer reuses existing IDs instead of duplicating. This is the single most important interaction and it works.
- The read-only day-workspace model, live overlay, and source-qualified keys are a solid foundation.
- Mobile single column already works.

---

## 4. Where it creates stress today

Observed on the live page and in the code.

1. **The suggestions list punishes you every morning.** Plan my day surfaces 47 items. The top seven are tasks overdue since May 2026, four months old, because the ranking weights overdue above everything. There is no cap, no grouping, and no "not today" action. The first thing the user sees each morning is their oldest failures. (`app/services/morning_planner.py`, weights `W_OVERDUE=4`.)
2. **"0m planned" has no denominator.** Planned time is the sum of lifetime estimates, so items without an estimate add nothing, and there is no available-hours setting. The page cannot say whether the day is realistic.
3. **Habits crowd out work.** With 11 habits and no work items, the agenda is 4 timed habit rows plus 7 "Anytime" habit rows. A work item scheduled at 10:00 would sit between "Memorize" and "Soccer" with nothing marking it as the day's point. Habits have no duration and are not timeable.
4. **There is no "now" at the top.** The active row is highlighted in place. If it is the sixth row, the user scrolls to see it. `ActiveSessionBar.jsx` exists for exactly this and is not mounted. A separate floating `TimerWidget` shows the same timer.
5. **Only tasks can be started from the agenda.** Tickets need the drawer, habits cannot be timed at all. The unified `/day-timer/switch` endpoint that handles all three sources exists and the UI never calls it; `TimerContext` still uses the task-only legacy timer.
6. **The agenda is a list wearing a timeline's clothes.** Rows show a start time but no end, no duration bar, no now-marker, no gaps, no overlap warning. Backend conflict preview exists (`/day-plan/preview`) and is unused.
7. **Planning happens in a modal that hides the day.** Plan my day opens over the page, so the user builds a plan while unable to see the plan. Escape does not close it (confirmed live). Suggestion titles truncate at roughly 20 characters in the half-width column.
8. **Three ways to add, one way to plan.** Sidebar "Quick add", header "Add", and the composer inside Plan my day all do the same thing.
9. **Nothing closes the day.** Evening reflection moved to Weekly review. Unfinished items keep their old `plan_date` forever, which is why "Carried over from 2026-05-19" appears in September. Carry-forward is the silent default, the opposite of the brief's intent.
10. **Two plan stores, one used.** The durable `day_blocks` table with per-day durations, breaks, and conflict detection is built and tested but the UI writes `plan_date` + `scheduled_time` on the entity instead. That is why "planned" reuses the lifetime estimate rather than today's intended duration, which the brief explicitly says it should not.
11. **Dead weight.** `TodayPage.jsx` is 850 lines; roughly 550 are unreachable (FocusSection, FocusPicker, ActivityToggle, pin/plan handlers, afternoon check-in state, dnd-kit imports). It makes every change slower and riskier.

---

## 5. The future Today page

Desktop layout, top to bottom. Each zone maps to a goal in section 1.

```
Sunday, Sep 20                                   ⌘K Find or add   [Plan day]
════════════════════════════════════════════════════════════════════════════
NOW  ● Export model · ALPHA-24 · Alpha        42:10 / 60m ▮▮▮▮▮▮▯▯▯
     [Pause] [Done] [Switch ▾]              NEXT 10:15 Basira design · 90m
────────────────────────────────────────────────────────────────────────────
Planned 5h 30m of 7h available (buffer 15%)  ▮▮▮▮▮▮▮▮▮▮▮▮▯▯▯▯   Worked 2h 10m +42m live   Details →
────────────────────────────────────────────────────────────────────────────
ROUTINE 4/11   ● Memorize 7:55   ○ Read 5 pages   ○ Pushups   ○ Soccer 5:53p   ○ Reflect 9:37p   ▾ 6 more
────────────────────────────────────────────────────────────────────────────
TODAY'S PLAN
 ★ MAIN OUTCOME
   09:00 – 10:00   Export model  ALPHA-24 · Alpha           60m   ● 42m   [Pause] [Done]
 SUPPORTING
   10:15 – 11:45   Basira design · Basira Improvements       90m          [Start] [Done]
   ····· 45m open ·····
   12:30 – 13:00   Track job applications · Get a job        30m          [Start] [Done]
   13:00 – 13:15   Break
 ANYTIME (2)
   Reply to Shehab · Libya trip                              15m          [Start] [Done]
   [ Type to find existing work or add… ]
 Completed (3) ▾
────────────────────────────────────────────────────────────────────────────
(from 17:00, or when the plan is done)
CLOSE THE DAY   3 unfinished · Worked 5h 02m · Alpha 3h 10m · Basira 1h 52m
   Track job applications      [Carry to tomorrow] [Drop] [Reschedule]
   ...
   One line about today: [_____________________________]   [Close day]
```

### Zone A: Header
Date, one composer entry point (⌘K and the "Find or add" button open the same thing), and a Plan day toggle. The sidebar Quick add opens this same composer. Review moves to the close-the-day card and the sidebar.

### Zone B: Now / Next strip (goal 1)
Sticky under the header. Three states:
- **Running**: item, parent, elapsed vs planned as a bar, Pause, Done, Switch (a menu of today's other items plus "find…"). Next item with its start time.
- **Idle with a plan**: "Next: Basira design at 10:15, in 25m" with Start now.
- **No plan**: "Plan your day" with the two best suggestions inline.
This replaces the floating TimerWidget on Today (BAS-025) and is built from `workspace.active_timers`.

### Zone C: Capacity line (goal 2)
"Planned X of Y available" with a bar, then worked and live. Y comes from new settings: day start, day end, buffer percent (default 15%). Over-capacity turns the bar amber and shows "Over by 40m". Clicking opens the existing time-detail drawer.

### Zone D: Routine strip (goal 6)
One row of chips, one per habit, ordered by usual time then anytime, check mark on tap, count "4/11", overflow collapsed. A habit's usual time shows on its chip as a hint only. Habits never appear on the schedule and are never timed. The schedule (zone E) is the one and only timeline and holds work only.

### Zone E: The plan (goals 3, 4)
The one agenda, now with:
- **Main outcome** slot at the top, exactly one, starred. Reuses `pinned_date`; the three-card focus set is gone.
- Start and end times, planned duration, recorded time, and a thin progress bar on each row.
- A **now marker** line, **open gaps** labeled with their length, and **overlap** warnings from `/day-plan/preview`.
- Identical actions for every source: Start, Done, Open (drawer), drag to reorder or retime, "Tomorrow" in the row menu.
- The inline composer lives at the bottom of Anytime, so adding never leaves the page.
- Completed collapsed at the bottom, as now.

### Plan mode (goal 3)
Plan day is not a modal. It expands a right-hand panel beside the plan on desktop (a sheet on mobile), and the plan itself becomes a drop target with editable durations:
- **Suggestions grouped by reason**, in this order: Resume (in progress), Yesterday's plan, Due this week, then "Older (N)" collapsed for anything overdue more than 14 days.
- At most 8 visible per group. Each has a reason, a parent, a duration field, Plan, Start, and **Not today** (snoozes it out of suggestions).
- Capacity line updates as items are added. A "Batch by project" hint suggests adjacent blocks.
- Done closes the panel; Escape closes everything.

### Zone F: Close the day (goal 5)
Appears after 17:00 or when nothing is left. Lists unfinished items with Carry (sets tomorrow's plan_date), Drop (clears plan_date, keeps the entity), or Reschedule (picks a date). Shows recorded time by project and client. One optional reflection line, reusing the existing evening check-in. "Close day" writes the snapshot. Yesterday's carry list becomes the first suggestion group next morning.

### Mobile
Same zones in one column. Now strip and capacity are sticky. Routine strip scrolls horizontally. Plan mode is a bottom sheet. Row actions live in a swipe or a long-press menu.

---

## 6. Improvement plan, in order

Each phase is shippable alone and removes a specific stress source.

### Phase 1: Stop the morning punishment (about 2 days)
- Suggestions: group by reason, cap per group, collapse overdue > 14 days under "Older", add **Not today** (writes `deferred_until` for tasks, clears stale `plan_date`). Re-rank: in progress and yesterday's plan above stale overdue.
- Capacity: settings `day_start`, `day_end`, `buffer_pct`; capacity line with the bar; over-capacity warning.
- Now/Next strip at the top from `workspace.active_timers`; hide the floating widget on Today.
- Fix Escape-to-close and body scroll on the planner and drawers.
- Delete the unreachable code in `TodayPage.jsx`.

### Phase 2: Plan inline, plan realistically (about 3 days)
- Plan mode as a side panel, not a modal; plan rows get editable duration and time; drag from suggestions still works.
- Adopt `day_blocks` as the plan store so today's duration is separate from the lifetime estimate. Keep `plan_date` as a derived compatibility field during migration. Breaks and "free" blocks become possible.
- One composer: ⌘K, header button, and sidebar all open it. Remove the duplicate.
- Main outcome slot on `pinned_date`, max one.
- Timeline rows: end time, progress bar, now marker, gaps, conflict warnings.

### Phase 3: Track anything from its row (about 2 days)
- Switch `TimerContext` to `/day-timer/switch` and `/day-timer/stop`, so tickets and habits start from the agenda and switching saves correctly.
- Switch menu in the Now strip.

### Phase 4: Close the day (about 2 days)
- Close-the-day card with carry / drop / reschedule and recorded-by-project summary.
- Explicit carry becomes the source of the next morning's "Yesterday's plan" group; the "carried over from May" problem disappears once old items are dropped or carried.
- Optional reflection line reusing the evening check-in.

### Phase 5: Routine strip and polish (about 1 day)
- Habits move from agenda rows to the strip of daily check marks; no habit rows on the schedule.
- Keyboard: J/K move, S start, D done, T tomorrow, Escape closes.

---

## 7. How we know it worked

Measure on real usage for two weeks after each phase.

| Metric | Now | Target |
|--------|-----|--------|
| Suggestions shown on first open | 47 | ≤ 10 visible, rest collapsed |
| Time from opening Today to first timer start | not measured | under 3 minutes |
| Days with a main outcome set | 0 (feature unused) | 5 of 7 |
| Days closed explicitly | 0 (no feature) | 5 of 7 |
| Planned time within capacity + buffer | unknown | 80% of planned days |
| Ticket timers started from Today rather than Work | 0 | majority |
| `TodayPage.jsx` size | 850 lines | under 350 |

---

## 8. Decisions this document makes

- Habits are a strip of daily check marks, never rows on the schedule and never timed.
- There is exactly one schedule. Plan mode edits it in place; there is no separate planner view.
- One main outcome, not three focus cards.
- `day_blocks` becomes the plan store. If that is rejected, delete the table and its routes rather than keeping a second unused model.
- Planning is inline. The modal planner is a compatibility path to remove in Phase 2.
- Carry-forward is a decision made in the close-the-day card, never a default.
- Stale overdue work is hidden by default and retrievable, not deleted.
