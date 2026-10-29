# Polestar Work Calendar

A calendar-first task manager for the Polestar Analytics team. Every task is a
calendar event: create it by dragging across the calendar, assign owners, track
progress and notes, request a teammate's time, and export it all to Excel —
without leaving the calendar.

**Stack:** React + TypeScript + Vite · Tailwind CSS · FullCalendar (free plugins)
· Supabase (Postgres, Auth, Realtime) · GitHub Pages. No custom server.

```
GitHub Pages (static app) ──► Supabase Auth · Postgres (RLS + SQL functions) · Realtime
```

→ **Setting up Supabase and deploying: [docs/SETUP.md](docs/SETUP.md)**

---

## What it does

| Area | How |
|---|---|
| **Calendar** | Day / Week views (Week on desktop, Day on phones); *My calendar* vs *Team*; filter by owner, status, priority, project. Drag to create, drag to move, drag the edge to resize. Current-time line, overlap layout, owner initials, progress bar, note count and up to two pinned fields on every event. |
| **Tasks** | Title, time, owners, optional description / priority / project. Progress 0–100% by slider, typed value or one-tap steps. Status: Scheduled · In progress · Pending (with reason) · Completed · Cancelled. Completion always sets 100% + timestamp explicitly; time passing never completes a task — it shows **Needs update** instead. *Create follow-up* links a new task without touching the original. |
| **Custom fields** | *+ Add field* on any task: short/long text, number, date, dropdown, checkbox, URL, person. Rename, reorder, remove, pin two to the calendar. Stored as JSONB; validated in the browser and by a database CHECK. A *person* field never assigns that person. |
| **Notes & history** | Short progress notes (bookmarks) per task, plus an automatic, tamper-proof audit trail of reschedules, status, progress, owners, approvals and field changes. |
| **Tickets** | A dedicated Tickets page and *New ticket* page. Tickets stay **off calendars until the assignee accepts**; they appear under *To respond* with one-click Accept. Requesters only see Tickets. |
| **Requests & approvals** | Add someone else as owner and the task becomes a request: tentative (purple, striped) on their calendar with an in-app notification. Each owner can Accept, Decline or Suggest another time. Confirmed only when every requested owner accepts; a decline/suggestion sends it back for revision; changing the proposal re-asks everyone. Owners added later are pending individually. |
| **Utilization** | Each accepted owner gets the full duration of confirmed work. Planned ÷ available (default 8h, Mon–Fri, per-person adjustable), per local day in each person's time zone. Overlaps are never merged — they're flagged as conflicts. Over-capacity days are highlighted. |
| **Live updates** | Supabase Realtime: moves, progress, status, owners, approvals and notes appear for other users without refreshing. Stale edits are rejected with a version check and the latest data is shown. |
| **Excel export** | `.xlsx` generated in the browser with three sheets — Tasks (custom fields as columns), Utilization (per user/day with daily totals), Bookmarks and History. Frozen headers, number/date formats, formula-injection safe. |
| **Navigation** | Collapsible sidebar (Ctrl/⌘ + B), hash routes `#/calendar`, `#/tickets`, `#/tickets/new` that work on GitHub Pages. |
| **Accounts** | Email + password, invite-only; scanner-safe invite links (see [docs/EMAIL_TEMPLATES.md](docs/EMAIL_TEMPLATES.md)). Roles: Admin, Contributor, Requester — enforced by Postgres RLS and security-definer functions, not by the UI. |

## Run it locally

```bash
npm install
```

**Try it with no Supabase at all** — a sandbox that runs the real migration in
an in-browser Postgres (PGlite) with demo data for Spandan, Mandya and Rupam:

```bash
npm run sandbox
```

Open the printed URL and sign in as `spandan@polestar.test`,
`mandya@polestar.test`, `rupam@polestar.test` (requester) or
`admin@polestar.test` with any password. Data resets on reload. The sandbox is
development-only and is never part of the production build.

**Against your Supabase project:** copy `.env.example` to `.env.local`, fill in
the URL and publishable key, then:

```bash
npm run dev
```

## Checks

```bash
npm run typecheck
```

```bash
npm test
```

```bash
npm run build
```

`npm test` runs ~60 tests: unit tests (time zones, utilization, status, custom
fields, permissions), Excel export round-trips, React component tests, and
**database tests that apply the real migration in PGlite** and exercise RLS and
every write function as different users (create, approvals, conflicts, audit
trail, role restrictions).

## Project layout

```
supabase/migrations/…_init.sql   schema, RLS, write functions, trigger, realtime
supabase/functions/invite-user   admin-only invite Edge Function
src/lib/                         api, time/utilization math, status, custom fields, export
src/hooks/                       auth, live task range, notifications
src/components/                  calendar, event, drawer, create dialog, controls, dialogs
src/sandbox/                     dev-only in-browser backend (npm run sandbox)
src/test/                        tests (incl. PGlite DB harness)
.github/workflows/deploy.yml     test → build → GitHub Pages
```

## Data model (four tables)

- **profiles** — `user_id, name, email, role, active, capacity_minutes (480), work_days (Mon–Fri), timezone, created_at`
- **tasks** — `id, title, description, start_at, end_at, work_status, approval_state, progress_percent, priority, category, requester_id, created_by, pending_reason, custom_fields (jsonb), parent_task_id, version, completed_at, created_at, updated_at`
- **task_assignments** — `id, task_id, user_id, approval_status, responded_at, created_at` (unique per task+user)
- **task_activities** — `id, task_id, actor_id, activity_type, note, metadata (jsonb), is_bookmark, created_at`

Two small additions beyond the brief, each to keep a rule enforceable in the
database: `tasks.approval_state` (an initial request is confirmed only when all
owners accept, while owners added later are pending individually — this can't
be derived from assignments alone) and `profiles.work_days` (custom working
weeks for capacity).

Clients can only `SELECT`; every write goes through a `SECURITY DEFINER`
function (`create_task`, `update_task`, `set_task_owners`, `respond_assignment`,
`add_bookmark`, `delete_task`, `update_my_profile`, `admin_update_profile`) that
checks the caller, validates input, bumps `version`, and writes the audit entry
in the same transaction. Timestamps are stored in UTC.

## Branding

`public/polestar-logo.png` and `public/polestar-mark.png` (the star, used when
collapsed and as the favicon) are cropped from the supplied Polestar Analytics
logo without recolouring or distortion; the original download is kept as
`public/polestar-logo-original.jpg`. To swap in an official high-resolution
file, replace `polestar-logo.png` (wide wordmark on a white or transparent
background) and `polestar-mark.png` (square).

Visual direction follows the supplied palette: ivory surfaces, deep burgundy
ink, a maroon primary, warm orange/peach accents, with separate semantic colours
for task states.
