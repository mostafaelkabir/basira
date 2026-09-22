# Basira product brief: plan the day, do the work, see the time

Updated September 18, 2026. This is the current product-priority brief. Where earlier UI and Today plans conflict with its ordering, follow this brief. Earlier documents remain useful technical references.

Scope of this update: organize the product direction and acceptance criteria. No application or user-data changes.

## 1. The product you are asking for

**Basira should help me start my morning with a realistic plan, bring forward the right work without digging through lists, and show exactly where my working time went.**

The primary loop is:

**Choose → schedule → work → record → review.**

The app should reduce the effort of remembering, finding, entering, and organizing work. Its main daily surface should allow both existing-item selection and new-item creation without leaving the plan.

Priority order:

1. Daily planning and quick capture.
2. Work ticketing and reliable time tracking.
3. Basic habit selection and scheduling inside the day.
4. Deeper habit building and resolution management after the first three are useful.

Basic goals and habits can be created now as part of capture. Advanced goal dashboards, coaching, streak systems, and resolution reviews do not need to be finished first.

## 2. Why the previous implementation still feels incomplete

The current code includes a day-workspace read model, agenda, project/client time panel, routine panel, and backend day-block routes. These are useful foundations and should be reused.

However:

- `DayPlanner.jsx` still turns typed lines into new task drafts. It loads goals but does not match typed intent against existing tickets, tasks, or habits.
- `TodayPage.jsx` displays the new agenda and the older scheduling/planning sections, leaving multiple representations of the day.
- `DayAgenda.jsx` offers Start only for task items, so a work ticket is not equally actionable there.
- `RoutinePanel.jsx` mainly displays and checks habits. It does not provide the requested morning selection and time assignment flow.
- Durable block routes and API helpers exist, but the morning capture flow shown in `DayPlanner.jsx` still calls batch schedule creation rather than offering one integrated block editor.

**The missing deliverable is a complete morning-to-work interaction, not another collection of cards.** Validate each existing backend capability before using it; presence in the code is not proof of correct behavior.

## 3. App inspiration, with a specific purpose

Use widely adopted apps for familiar interactions and specialist tools for particularly relevant workflows. This is not a verified global popularity ranking or a claim that any method is universally best.

| Reference | Verified interaction | What Basira should borrow |
| --- | --- | --- |
| [Todoist Quick Add](https://www.todoist.com/help/todoist/features/use-task-quick-add-in-todoist-va4Lhpzz) | Type dates and select project/label details during capture | One fast input with editable date, duration, and parent chips |
| [TickTick](https://ticktick.com/features) | Calendar, task, focus, and habit features in one product | Habits fit into the actual day alongside work |
| [Sunsama timeboxing](https://help.sunsama.com/docs/usage-guides/timeboxing/) and [daily workflow](https://www.sunsama.com/) | Deliberate daily planning and task timeboxing | Choose a realistic amount of work and assign it time |
| [Linear issue creation](https://linear.app/docs/creating-issues) and [templates](https://linear.app/docs/issue-templates) | Fast issue creation, drafts, and reusable defaults | A lightweight ticket composer with useful context already filled |
| [Structured](https://structured.app/) | One visual daily timeline | Clearly visible order, Now/Next, breaks, and open time |
| [Akiflow Time Slots](https://product.akiflow.com/help/articles/3089241-time-slots) | Reserve activity time and place tasks into those slots | Plan “90 minutes on Project Alpha” before picking every individual ticket |

Todoist describes adoption by tens of millions on its [About page](https://www.todoist.com/about-us); TickTick describes millions of users on its [security page](https://ticktick.com/security). These are vendor claims, not independently comparable active-user counts. Linear and Sunsama are selected for workflow fit, not claimed mass-market rank.

## 4. The recommended planning methods

Use a small combination rather than introducing several competing productivity systems:

- **Capture first:** write what is on your mind in one place; organize it with suggested matches and editable chips.
- **Timeboxing:** give chosen work a duration and place in the day. Keep deadlines separate from when you intend to work.
- **One main outcome, a few supporting priorities:** help the user make a choice without an arbitrary hard limit on tasks.
- **Capacity-aware planning:** compare the plan with available time. Offer a configurable buffer; treat 15–20% as a starting preference, not a scientific optimum.
- **Context batching:** suggest adjacent blocks for the same client/project to reduce unnecessary switching. Suggestions are editable.
- **Daily closeout:** review recorded time and explicitly move unfinished work.

Later, add habit cues and repeatable routines. For now, “I will do this habit at 7:30” is more important than complex streak analytics.

## 5. Morning planning: the actual experience

### Entry

Today opens with a compact current-day summary and **Plan my day**. It also offers a fast **Continue yesterday's unfinished work** suggestion, which previews items instead of silently carrying them forward.

Planning happens in one editable surface, with three sections rather than a long wizard:

1. **My day:** available start/end time, fixed commitments, and breaks.
2. **What I want to do:** recommended work, selected habits, and the universal input.
3. **When it fits:** timeline or time fields, total planned time, overlaps, and open space.

Sections update together. The user can plan one item and start working immediately, or build the full day and save it.

### Before typing

Show a short list of explainable suggestions:

- Resume in-progress tickets.
- Unfinished items from the last plan, excluding completed/deferred items.
- Work due soon, where due-date data exists.
- Items in the selected client/project.
- Habits due today with their usual times, where preferences exist.

Each suggestion has a reason such as “In progress” or “Planned yesterday,” a parent label, and a duration field. Do not dump the entire backlog into Today.

### While typing

Example: `model export tomorrow 10am 45m`

Show, in order:

1. Matching existing ticket: `ALPHA-24 · Export model · Project Alpha`.
2. Other plausible existing items, with enough context to distinguish them.
3. Explicit creation actions: **New ticket**, **New task**, **New habit**, **New goal**.

If the user chooses the existing ticket, reference that ticket and prefill its client/project. Extracted scheduling chips become `Tomorrow · 10:00 · 45m`. Choosing it must not overwrite the ticket title, deadline, or lifetime estimate.

If the user chooses New ticket, prefill relevant context and show a compact draft. Additional description, status, and priority fields are expandable. A possible duplicate stays visible as a suggestion, never an automatic merge.

An ambiguous name gets several matches; no match gets a clear creation path. Enter activates the selected result or explicit draft action—it must not silently create a duplicate when a matching ticket exists.

### Examples

| User types | Proposed behavior |
| --- | --- |
| `continue api bug 9am 1h` | Suggest matching open tickets; schedule selected ticket for an hour |
| `walk 7:30 20m` | Suggest the existing Walk habit; schedule today's occurrence |
| `new ticket investigate login failure #Alpha` | Open a new-ticket draft with Project Alpha selected |
| `new habit read 20m every evening` | Draft a habit; ask for a precise time only if a scheduled block is requested |
| `new goal launch portfolio` | Create a goal draft inline; allow an optional first task |
| `Alpha 2h` | Suggest the existing project and open tickets; allow a project reservation |

These are proposed Basira examples, not syntax promised by the reference products.

## 6. What “smart” means in release one

Do not make the core flow depend on an AI provider.

- Find existing records by ticket reference, normalized title, client, project, and tags. Support partial and modest typo-tolerant matching.
- Rank exact reference/title matches first, then contextual matches, in-progress status, recent use, and planned-but-unfinished work. A distant deadline must not outrank an exact text match.
- Limit the initial result list to about five useful matches; offer Show all.
- Exclude archived/completed records by default; expose them deliberately when needed. Flag blocked work rather than recommending it as immediately actionable.
- Debounce queries, cancel or ignore stale responses, and support keyboard selection with accessible combobox semantics.
- Parse a bounded set of dates, times, durations, and recurrence phrases. Show editable chips and allow restoring a parsed phrase to plain title text.
- Interpret dates in the user's timezone. Ask inline when a phrase has multiple meanings.
- Prefill from selected context or a template. Mark inferred fields and let the user change them before saving.
- An existing match is a reference to an ID. A new ticket/task/habit/goal is an explicit create action.
- Optional AI can later improve vague-language matching or draft descriptions; it must not fabricate ticket IDs, change priorities, or create records without a reviewed save.

## 7. Work tracking and ticketing

Tickets are persistent work. A day block is a temporary reservation to work on a ticket. One ticket can have several blocks without becoming several tickets.

From Today, the user must be able to create or open a ticket, add a note, change its status, schedule it, and track time without navigating through a chain of pages.

Keep the existing Work workflow and make its main fields easy to scan: title/reference, client, project, status, priority, estimate, recorded time, and evidence. Support lightweight templates for bug, feature, research, and meeting work. Avoid adding team-scale workflow complexity before daily individual use works well.

One session control should work consistently for Tasks, WorkTickets, and WorkLogs. Switching work saves the previous interval and starts the selected item; failed saves keep a recoverable state. Time tracking must work even when a ticket was not planned earlier.

Project/client time must show:

- Planned today.
- Recorded today.
- Live, displayed separately.
- This week on demand.
- Drill-down into the source sessions/entries.

Do not double-count ticket entries and the timer sessions from which they were produced. Project and client are alternate groupings of the same underlying time. Historical missing links remain explicit; do not guess them. A planned hour never becomes a recorded hour automatically.

## 8. One Today surface

```text
Today · date                Plan my day       + Capture
Available 7h  |  Planned 5h 30m  |  Recorded 2h 10m + live

DAY PLAN                                  TIME BY PROJECT
Now: API fix · Alpha                      Alpha    1h 30m
09:00  Alpha ticket · 60m                  Basira      40m
10:00  Break · 15m                         [Today / Week]
10:15  Basira design · 90m
                                          TODAY'S HABITS
Unscheduled                               Read      07:30
[Type to find existing work or create…]    Walk      18:00

Active session: Alpha / API fix      Pause · Switch
```

The plan, agenda, and timeline are views of the same saved blocks. Keep the older planner only as a temporary compatibility path during development; remove competing controls from the final Today screen. A chosen task's details open in a drawer. Mobile uses a single agenda column with expandable time/routine sections.

## 9. Delivery order

| Slice | Build | Definition of done |
| --- | --- | --- |
| 1. Find or create | Universal composer, local matching, ticket/task creation, minimal habit/goal drafts | Type a few words, reuse a matching ticket, or explicitly create an item without leaving Today |
| 2. Plan the morning | Recommended work, habit selection/time assignment, editable day capacity, shared DayBlock editor | Choose work and habits, assign times, save, reload, and see one consistent agenda |
| 3. Execute work | Actionable ticket drawer, templates, consistent timer controls, manual time entry, project/client totals | Start from a ticket on Today; saved time appears once in the right project/client |
| 4. Replan and close | Move blocks, conflict previews, explicit carry-forward, short day review | Adjust an interrupted day and prepare tomorrow without rewriting actual time |
| 5. Build habits | Routine templates, habit cues, weekly consistency, easier recurrence editing | Repeated routines become easier to maintain after planning and work tracking are proven |
| 6. Manage resolutions | Milestones, periodic reviews, goal-to-habit relationships | Longer-term direction informs daily suggestions without overwhelming Today |

Slices 1–3 are the next release goal. Habit scheduling is in slice 2; sophisticated habit/resolution management is deliberately later. This is a delivery sequence, not an instruction to remove existing features.

## 10. Engineering handoff

Reuse `useDayWorkspace`, `ProjectTimePanel`, and the existing day-block model/routes. Avoid rebuilding their equivalents.

- Replace `DayPlanner.jsx`'s create-only input with a shared composer used in Today and Work.
- Add one read-only suggestions service across existing entity types. Return source-qualified IDs, display labels, matching reasons, and field defaults. Never create records while searching.
- Connect the planning editor to the current day-block API; validate save/retry and conflict behavior before relying on it.
- Keep draft entity creation separate from saving its block, with retry-safe handling: if creation succeeds and block save fails, retry using the created ID.
- Make `DayAgenda` actions dispatch by source type, not only Task.
- Use one refresh/invalidation path so a saved block, timer change, or ticket edit updates all relevant panels.
- Add duration, recurrence, reference-validation, and ranking tests around the risky boundaries; test complete user journeys with synthetic fixtures.
- Keep Tasks goal-linked and proof-backed. A planning reservation is not a Task. Preserve Work entities' current identity while explicitly validating the completion contract before expanding it.
- Do not migrate, backfill, recategorize, or edit existing user data as part of planning or preview. Any required new schema should be tested in isolation before separately applying it to the live database.

## 11. Release acceptance: the test the next implementation must pass

Using fixture data, start on Today and do the following without visiting another page:

1. See suggested unfinished work and select two existing tickets.
2. Type part of another ticket title and reuse it; no duplicate is created.
3. Create one new ticket with its client/project prefilled and editable.
4. Select two existing habits and give today's occurrences different times.
5. Create a new habit and a basic goal inline, returning to the same draft plan.
6. See an over-capacity warning, adjust a duration, and save.
7. Reload: agenda and timeline show the same items and times.
8. Start, pause, and switch between a task and a work ticket; verify saved time is attributed once.
9. Add manual time and find it in the correct project/client breakdown.
10. Reschedule a block: recorded time and underlying ticket estimate remain unchanged.
11. Recover from a failed save without losing draft text or creating duplicate records.
12. Carry unfinished work into tomorrow only after an explicit action.

Proposed usability targets: build a typical day in under three minutes; reuse a matching ticket in a few keystrokes; schedule a habit with one selection and one time edit. Measure these with realistic data before claiming success.

The next release is complete when this journey works smoothly—not merely when its components or endpoints exist.
