# Basira UI/UX identity and implementation plan

Prepared September 16, 2026. Scope: project review and implementation proposal; this document does not change the application.

## 1. Recommended direction

**Basira — See yourself clearly.**

Build a calm, precise personal workspace around three ideas: intention, focused action, and evidence. The futuristic quality should come from excellent information hierarchy, responsive interactions, luminous accents, and useful context. Basira's distinctive identity should come from its meaning: inner sight and clarity.

The current forest green and Arabic name are valuable starting points. Evolve them into an identity with deep ink surfaces, emerald accents, warm ivory, and a restrained lens/aperture symbol. Give the product a recognizable visual language and an equally recognizable interaction: every completed task leaves evidence.

Suggested product sentence: **“Turn intention into visible progress.”**

The first release should deliver a complete daily loop: choose a goal → choose today's focus → work → attach proof → complete → reflect.

## 2. What the project review found

I inspected the React/Tailwind frontend, relevant FastAPI routes and schemas, project rules, and the running Today and Work interfaces at localhost:8001. Other screen recommendations below are based on source review. This was not a full usability study, mobile browser test, or accessibility conformance audit.

| Finding | Evidence in this project | Design or implementation consequence |
| --- | --- | --- |
| The brand has a meaningful foundation | README describes Basira as inner sight, clarity, and evidence; the shell already includes بَصِيرَة | Develop the existing identity rather than inventing an unrelated theme |
| Styling has multiple competing systems | `tailwind.config.js` retains legacy sand/teal tokens alongside newer tokens; page JSX repeats hex values; `index.css` defines another background | Introduce semantic tokens before changing individual screens |
| The shell restricts usable space | `App.jsx` has a fixed 160px sidebar, permanent `ml-40`, and a 780px content maximum | Support different page widths and a genuinely responsive navigation shell |
| Today has overlapping planning surfaces | `TodayPage.jsx` combines focus cards, `PlannerView`, `DayPlanner`, and `DailySchedule`; the live screen shows several planning entry points | Use one planning action and two views of the same daily plan |
| Work needs more scanning space | Live Work uses two-column cards within the narrow shell, with multiple filter rows and competing badges | Use a wider workspace, consolidated toolbar, list default, and detail drawer |
| Navigation is transient | `App.jsx` switches pages with React state; Analytics renders only for an `insights` state absent from navigation | Introduce addressable pages and predictable back/forward behavior |
| Some interface promises are misleading | `ProgressPage.jsx` labels conditional template text “AI SMART INSIGHT”; its “View Analytics” button has no handler | Distinguish calculated observations from generated suggestions and connect all actions |
| Shared overlay behavior is incomplete | `components/Modal.jsx` handles Escape but lacks dialog semantics, contained focus, and focus restoration | Fix shared interaction primitives before spreading a redesign |
| Errors often interrupt or disappear | Many pages use `alert()`/`confirm()`; some handlers silently catch failures | Standardize inline validation, persistent recoverable errors, and accessible notifications |
| Pages are expensive to change consistently | `WorkPage.jsx` is 1,783 lines, `TodayPage.jsx` 960, and `GoalPage.jsx` 934 at review time | Extract by feature while redesigning, retaining current behavior |
| Proof is not consistently enforced | Global task creation and several Today paths set `requires_proof: false`; task completion conditionally checks proof; schedule completion bypasses the check | Make the evidence flow consistent in both API and UI |
| Completion history can be duplicated | The task completion route inserts an ExecutionLog on every call; Today can call completion again to save a feeling | Make completion retries safe and update feedback separately |
| A second creation bypass exists | `TaskCreate` accepts `status: done`, which `create_task` stores directly | New tasks must begin incomplete; completed imports need a validated evidence/log path |

Work tickets, work logs, and recurring habit check-ins currently have distinct models and completion paths. Do not silently relabel these as equivalent to proof-backed Task completion. Define and document their relationship to the Goal → Task → Proof → ExecutionLog model before migrating them.

## 3. Identity system

### Brand character and copy

Use **clear, reflective, precise, and humane** as the design criteria. Explain what happened and what the user can do next. Keep Islamic and Arabic roots present in the name and thoughtful editorial moments; avoid using sacred text as decorative interface texture.

Example copy:

- Empty Today: “Choose one thing that would move you forward.”
- Completion: “What shows this is done?”
- Proof helper: “Add a note, link, or image.”
- Confirmation: “Completed. Your evidence is saved.”
- Deferral: “Move this to a better time.”
- Sparse analytics: “A few more days of activity will reveal a pattern.”

Keep data statements factual. Avoid guilt-driven prompts, unsupported personality judgments, or invented composite “clarity scores.”

### Visual signature

1. Create a simple vector mark: two open concentric arcs around a focal point. Test it at favicon, sidebar, and onboarding sizes. Avoid an eye shape that implies surveillance.
2. Pair the English wordmark with a properly typeset Arabic secondary wordmark. Set Arabic language/direction explicitly and verify diacritic rendering.
3. Reuse the arc motif sparingly in the active focus timer and empty states. Ordinary progress bars remain linear and clearly labeled.
4. Use a small emerald light or edge accent for the active focus session. Keep ordinary cards opaque and quiet.
5. Replace navigation emoji with one consistent SVG icon family. User-selected goal icons and mood emoji may remain as personal content.

### Proposed palette

These are starting design values, not a claim that every combination passes contrast checks. Validate actual text, icon, focus, and surface combinations before release.

| Semantic role | Light theme | Dark theme |
| --- | --- | --- |
| Canvas | `#F5F4EF` warm ivory | `#0B1514` deep ink |
| Surface | `#FFFFFF` | `#12211E` |
| Raised surface | `#ECEFE9` | `#1A2D28` |
| Primary text | `#172B25` | `#EFF5EF` |
| Secondary text | `#52635B` | `#A7BBB0` |
| Border | `#D9E1DA` | `#30473D` |
| Interactive accent | `#17664E` | `#80D8AF` |
| Accent foreground | `#FFFFFF` | `#10251B` |
| Highlight | `#B38B2B` | `#E4C776` |

Use highlight for selected editorial details, not as the universal active-nav background. Define separate success, warning, error, focus-ring, and chart tokens. Status always has a label or icon as well as color.

Implement both themes through CSS variables, with System / Light / Dark preferences. Preserve the user's existing light experience until they choose another theme; use dark mode prominently in the design concept. Theme choice is a preference, not a separate set of components.

### Typography, spacing, and motion

- Use one readable variable sans-serif for English UI and a compatible Arabic family; evaluate candidates such as Inter and Noto Sans Arabic with real bilingual strings. Bundle chosen fonts locally after checking their licenses.
- Body: 14–16px; supporting metadata: 12–13px; page titles: 28–32px. Avoid 9–10px text for actionable or important information.
- Use tabular numerals for timers and reporting columns.
- Spacing scale: 4, 8, 12, 16, 24, 32, 48px. Card radii: 16px; controls: 10px; pills only for tags and compact state labels.
- Use 120–180ms hover/focus transitions and approximately 200–240ms drawer transitions. Honor reduced-motion preferences. No continuously animated page backgrounds.
- Reserve subtle glow for focus state; readable content uses solid surfaces and measured contrast.

## 4. Navigation and page structure

Keep recognizable names. Group the desktop navigation by purpose:

- **Do:** Today, Goals, Work.
- **Reflect:** Journal, Progress, People.
- **Utilities:** Weekly review, Profile, Settings.

Keep Profile reachable while reducing its competition with daily actions. Put detailed Analytics inside Progress, with Weekly Review reachable from Progress and the utility area.

Desktop uses a roughly 224px sidebar and a content area appropriate to the page: 1,200–1,360px for Work/Progress, around 1,120px for Today, and 720–800px for long-form Journal entries. Tablet uses a compact navigation rail. Mobile uses Today / Goals / Work / More bottom navigation, with all remaining destinations in More.

Start with hash-based application routes such as `/#/today` and `/#/goals/:id`. Existing `/goals`, `/tasks`, and `/today` URLs are API routes; introducing identical browser paths would collide with them. A later move to clean URLs should first namespace APIs and define explicit frontend fallback behavior.

Add a visible “Quick add” action. Its default task mode requires a goal; preselect the current goal where there is context and visibly show that choice. For users without goals, offer inline goal creation. A later capture inbox may hold draft notes, but must not create orphan Tasks.

## 5. Screen-by-screen redesign

### Today: the first complete slice

The first screen should answer: What matters now? What happens next? What have I actually completed?

Desktop structure:

```text
Navigation | Today · date                         Quick add
           | Intention / optional compact check-in
           | --------------------------------------------
           | CURRENT FOCUS             | TODAY'S PLAN
           | Goal name                 | Now / next
           | Task and next action      | Scheduled items
           | Start / Resume            | Unscheduled items
           | Two other priorities      | Plan day
           | --------------------------------------------
           | Habits                    | Evidence today
           | Completed items, collapsed by default
```

Show one dominant focus action, with up to two supporting priorities. The existing three-focus concept is useful; improve its hierarchy. Keep check-ins optional and compact so they do not block work.

Merge daily planning entry points into “Plan day.” List and Timeline render the same selection, ordering, dates, and completion state. Provide explicit Move up/down and Schedule actions in addition to drag-and-drop.

Show progress with defined units: “3 of 5 planned tasks completed” and “4 of 6 habit check-ins,” rather than one unexplained percentage combining unlike activity.

On mobile stack focus, plan, habits, and evidence. Reserve space for the timer dock and bottom navigation so neither hides the last row.

### Task details and completion

Use a shared task detail drawer with title, goal breadcrumb, status, due date, estimate, subtasks, notes, proof, and execution history. On small screens it becomes a full-height sheet.

Selecting Complete opens a compact proof composer when no valid proof exists. Accept nonblank text, a valid link, or an image; keep existing file attachments compatible while documenting their role. Existing proof can be reviewed and reused for a one-off task. Recurring evidence must be scoped to the relevant occurrence.

Persist proof first, then commit the execution log and completed state together through one completion service. A failed upload or completion must preserve the user's draft and keep the task visibly incomplete. Existing separate proof and completion endpoints can remain initially: a retry should reuse saved proof rather than upload it again.

Completion must be idempotent for the same completion event. Store post-completion feeling against the existing event through a separate update operation. Define reopen/recomplete semantics explicitly; do not erase historical proof or inflate current completion totals with retries.

Backend enforcement is required even when a client bypasses the composer. Validate existing goals on task creation and reassignment, disallow direct creation as done, and route schedule completion through the same service.

Historical records without proof should be labeled honestly as legacy completions. Do not fabricate evidence, rewrite history, or block users from reading older data. New completion transitions must follow the rule.

### Goals

Show goal purpose, next action, due date when present, and clearly defined progress. Keep Resolutions, Projects, and Daily groupings; explain recurring targets separately from one-off task counts. Detail views should expose the path from goal to task to evidence without requiring a modal stack.

### Work

Default to a scan-friendly ticket list with title, client, status, priority, and logged/estimated time. Keep a board view as a later optional view. Consolidate client, status, sorting, and search into one toolbar. Open details in a drawer without losing filters or scroll position.

Distinguish time consumed from work completed. A ticket exceeding its estimate should say “2h over estimate,” not visually imply it is 100% complete. Preserve the established Time & Reports date attribution and totals; restyle the presentation without changing the reporting calculations.

### Progress and weekly review

Lead with three questions: Where did my time go? Which goals moved? What should I adjust?

Give every chart a date range, units, legend, missing-data treatment, and access to underlying records. Distinguish zero activity from unavailable data. Consolidate overlapping Progress/Analytics views and connect the existing inactive analytics button.

Label deterministic summaries “Observation.” Label generated content “AI suggestion,” show the period and source records used, and provide an unavailable state when AI is not configured. Reflect the real data flow: local storage does not mean AI requests remain on the device.

### Journal, People, Profile, and Settings

- Journal: a focused writing surface, subtle prompts, saved/saving/error states, and recoverable drafts. Keep AI polish secondary and preserve the original.
- People: a readable contact list, last interaction, optional next reminder, and one clear Log interaction action. Avoid moralizing relationship scores.
- Profile: organize preferences and personal observations clearly; explain what each derived measure represents.
- Settings: group Appearance, AI/data sharing, notifications, and data management. Clearly identify optional external AI processing.
- First use: create one goal, add one task, and choose a focus. Offer a small dismissible guide instead of a long onboarding wizard.

## 6. Implementation structure

Keep React 18, Vite, Tailwind, FastAPI, and the existing API module. A framework rewrite or TypeScript migration is not a prerequisite for better UI.

Proposed frontend organization, introduced incrementally:

```text
frontend/src/
  styles/tokens.css
  components/ui/         Button, IconButton, Field, Badge, Tabs,
                         Dialog, Drawer, Toast, EmptyState, Skeleton
  components/layout/     AppShell, Sidebar, MobileNav, PageHeader
  features/tasks/        TaskRow, TaskDrawer, ProofComposer
  features/today/        FocusPanel, DailyPlan, HabitList
  features/work/         TicketList, TicketDrawer, WorkToolbar
  features/progress/     Overview, EvidenceTimeline, Review
  hooks/                 focused shared behavior, extracted as needed
  api.js                 existing API boundary
```

Map Tailwind colors to semantic variables such as `--bg`, `--surface`, `--text`, `--muted`, `--accent`, and `--border`. Keep legacy aliases while screens migrate; remove them only after remaining usages are gone.

Extract shared task/proof components from `GoalPage.jsx` so Today no longer imports UI from another page. Preserve `TimerProvider` above navigation so a page change never resets the active session. Standardize refresh behavior and failed-mutation recovery; introduce a query cache only if demonstrated duplication warrants it.

Add a small backend completion service in `app/services/task_completion.py` and call it from all Task completion entry points. Do not duplicate business rules in each redesigned component.

The database currently hardcodes SQLite, although project rules require PostgreSQL support. Track configurable database URLs, PostgreSQL-compatible migrations, and database-specific tests as a separate foundation item. It is not necessary to migrate the user's database to review or ship the initial visual slice, but cross-database support must not be claimed before verification.

## 7. Ordered implementation backlog

Estimates below are rough engineering days for one developer, including focused QA. They are planning ranges, not delivery commitments; refine them after the first slice and domain-model decisions.

| Step | Deliverable and concrete work | Primary files | Completion evidence | Estimate |
| --- | --- | --- | --- | --- |
| 0. Baseline | Capture representative states with synthetic data; document daily journeys, API routes, reporting invariants, and completion bypasses | Existing screens, `api.js`, completion routes, reporting tests | Before screenshots and a reproducible fixture checklist | 1 day |
| 1. Brand and tokens | Wordmark/mark assets, semantic light/dark palette, type/spacing scales, icon rules, theme preference | `index.css`, new `styles/tokens.css`, `tailwind.config.js`, `index.html`, local assets | Theme/component preview at desktop and mobile widths with measured contrast | 1–2 days |
| 2. Primitives and shell | Accessible controls/overlays, inline errors, responsive navigation, page widths, hash routes | `App.jsx`, `components/Modal.jsx`, new `components/ui` and `components/layout` | Keyboard walkthrough; refresh/back/forward; mobile navigation screenshots | 2–3 days |
| 3. Completion integrity | Shared service, mandatory valid proof, create/update validation, schedule integration, safe retries, separate feedback update, legacy handling | `app/routes/tasks.py`, `schedule.py`, `today.py`, task/proof schemas, new completion service, Today feedback handler | Isolated API tests prove every new Task completion has valid proof and a single event per transition | 2–4 days |
| 4. Today and task flow | Shared drawer/composer, dominant focus action, unified plan views, compact check-in, persistent timer dock | `TodayPage.jsx`, `GoalPage.jsx` extractions, `DayPlanner.jsx`, `DailySchedule.jsx`, `PlannerView.jsx`, `TimerWidget.jsx` | Create → plan → time → proof → complete works in both themes and on a narrow screen | 3–5 days |
| 5. Goals and Work | Goal hierarchy and next actions; ticket list, toolbar, drawer; reporting restyle | `GoalsPage.jsx`, `GoalPage.jsx`, `WorkPage.jsx`, `WorkReports.jsx` | Long-title/high-volume fixtures; existing report totals and tests remain correct | 3–4 days |
| 6. Reflective surfaces | Progress/Analytics consolidation, source-backed observations, Journal, People, Profile, settings and first-use states | Corresponding page files, `WeeklyReview.jsx`, `SettingsModal.jsx` | All actions connected; empty/loading/failure/AI-unavailable states demonstrated | 3–4 days |
| 7. Release QA | Responsive/keyboard checks, reduced motion, visual consistency, performance measurements, documentation | Shared components, regression tests, README | Release checklist and comparison screenshots; no unexplained failing checks | 2–3 days |

Suggested initial milestone: steps 0–4, approximately **9–15 engineering days**. Complete redesign: approximately **17–26 days**, excluding a PostgreSQL migration, full Arabic localization, and major unification of Work/Habit data models.

Steps 1–2 establish reusable presentation. Step 3 is required before calling the new completion experience trustworthy. Step 4 validates the identity and daily workflow before the remaining pages adopt it. Ship in reviewable slices; keep schema changes additive and test against an isolated database.

## 8. Acceptance and verification

### Product integrity

- No new Task can be created or reassigned without a valid Goal.
- All routes that mark a Task complete require valid evidence and persist its ExecutionLog with the status transition.
- Repeat requests and optional feeling updates cannot create duplicate completion events.
- A failed proof upload, failed API request, or interrupted save cannot display a false success.
- Running timers survive navigation and reload according to the existing persisted timer contract.
- Work report totals, timezone/date attribution, and running-timer exclusions remain unchanged.

### Interaction and accessibility

- Verify layouts at 360, 390, 768, 1,024, and 1,440px; also inspect text zoom/reflow. Main content does not require horizontal scrolling; genuinely two-dimensional tables may have contained scrolling.
- Every icon action has a usable accessible name and visible keyboard focus. All drag actions have a non-drag equivalent.
- Dialogs receive and contain focus, expose a name and dialog semantics, and restore focus when dismissed. Follow the [W3C dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/).
- Measure normal-text contrast at 4.5:1 or higher and large-text contrast at 3:1 or higher, following [W3C contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).
- Aim for 44px touch controls as the product's comfort target. WCAG 2.2 AA's target-size criterion is 24×24 CSS pixels with specified exceptions; do not confuse the two. See [W3C target-size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).
- Respect reduced motion; communicate status without relying only on color. Keep Arabic wordmarks intact and test mixed-direction titles, while treating full RTL localization as a separate deliverable.

### Meaningful checks

- Add backend tests for the proven completion bypasses, invalid goal updates, blank evidence, retries, schedule completion, feedback, and reopen/recomplete behavior.
- Add focused frontend/browser checks for mandatory goal selection, upload failure recovery, completion from Today/Goal/Schedule, modal keyboard behavior, route history, and timer continuity.
- Retain the existing isolated work-report checks: `venv/bin/python -m unittest discover -s tests -v` and `node --test frontend/src/workReportUtils.test.js`.
- Run `npm run build` from `frontend` after implementation. Check the Vite proxy against all API prefixes used by redesigned pages before testing the dev server.
- Compare screenshots for empty, populated, long-text, loading, validation-error, and server-error states in both themes. Use synthetic examples for shareable review artifacts.
- Measure build output and browser performance before/after. Set budgets from the baseline; lazy-load secondary pages or optimize expensive lists only when measurement justifies it.

### Usability success measures

Run a short before/after walkthrough using the same tasks: find the next action, create a goal-linked task, plan it, attach proof, complete it, and find that evidence again. Record time, errors, and confusion locally with user consent. Targets: the next action is apparent within five seconds; a simple task can be added without visiting another page when a goal exists; proof-backed completion requires one coherent interaction; evidence is reachable from the completed task in one action. These are proposed targets, not measured results.

## 9. First implementation batch

Start with the tokens, responsive shell, shared accessible controls, and a Today/task-detail prototype using synthetic data. In the next slice, connect the mandatory proof composer to a corrected completion service and persistent timer. Review that complete daily loop in light and dark themes before restyling the rest of the application.

This makes the first visible result recognizably Basira: a clear intention, one next action, and progress the user can inspect.
