# Setup & deployment guide

End to end: Supabase project → database → first admin → invites → GitHub Pages.
Everything runs on the **Supabase Free tier** and **GitHub Pages**; no server of
your own. Allow about 20 minutes.

You will need:

- A Supabase account (free): <https://supabase.com>
- A GitHub account and this project pushed to a repository
- Node.js 20.19+ or 22.12+ locally (only for local development / CLI commands)

---

## 1. Create the Supabase project

1. In the Supabase dashboard choose **New project**. Pick a region near the team
   (e.g. *Mumbai* for India) and save the database password somewhere safe.
2. When it is ready, open **Project Settings → API keys** (or **Settings → API**)
   and note:
   - **Project URL** — `https://<project-ref>.supabase.co`
   - **Publishable key** (`sb_publishable_…`). On older projects use the
     **anon public** key instead — either works.

   These two values are public by design: they go into the browser bundle and
   all data access is still enforced by Row Level Security.
   **Never** copy the `service_role` / secret key into the app or GitHub.

## 2. Create the database

Pick one:

**A. SQL editor (no tools needed)**
Open **SQL Editor → New query**, paste the whole of
[`supabase/migrations/20261029000000_init.sql`](../supabase/migrations/20261029000000_init.sql)
and press **Run**. It should finish with “Success. No rows returned”.

**B. Supabase CLI (keeps migrations in sync later)**

```bash
npx supabase login
```

```bash
npx supabase link --project-ref <project-ref>
```

```bash
npx supabase db push
```

The migration creates the four tables, RLS policies, the write functions, the
sign-up trigger, and adds the tables to the `supabase_realtime` publication.

Check: **Database → Publications → supabase_realtime** should list `tasks`,
`task_assignments` and `task_activities`. If your project has no such publication,
enable Realtime for those three tables under **Database → Replication**.

## 3. Configure authentication

**Authentication → Sign In / Providers** (labels vary slightly by dashboard version):

1. **Email** provider: enabled.
2. **Allow new users to sign up: OFF.** Accounts are created only by invitation.
3. *Confirm email* can stay on — invited users confirm by accepting the invite.

**Authentication → URL Configuration**:

| Setting | Value |
|---|---|
| Site URL | `https://<github-user>.github.io/<repo>/` |
| Redirect URLs | `https://<github-user>.github.io/<repo>/**` and `http://localhost:5173/**` |

Invite and password-reset emails link back to these URLs.

> **Use the Polestar email templates.** Paste the invite and reset templates from
> [EMAIL_TEMPLATES.md](EMAIL_TEMPLATES.md) under **Authentication → Emails**. They
> keep corporate link scanners from using up invite links, and look like Polestar.

> **Email limits.** The built-in Supabase email sender is rate-limited (a few
> emails per hour) — fine for inviting a small team over a day. For more, add your
> own SMTP under **Authentication → Emails → SMTP settings**.

## 4. Create the first admin

1. **Authentication → Users → Add user → Create new user**: enter your email and
   a password, tick **Auto confirm user**.
2. In **SQL Editor**, run (with your email):

   ```sql
   update public.profiles set role = 'admin' where email = 'you@polestaranalytics.com';
   ```

That is the only manual SQL. Roles can't be changed from the app except by an
admin (the `profiles` table is read-only to users; `admin_update_profile` checks
the caller is an admin).

## 5. Invite the team

**Option A — from the app (recommended).** Deploy the included Edge Function once:

```bash
npx supabase functions deploy invite-user --project-ref <project-ref>
```

Then, signed in as admin: avatar menu → **Manage team → Invite teammate**. The
person gets an email, clicks the link, lands on the app and sets a password.
The function verifies the caller is an active admin before using the
service-role key, which only exists inside Supabase's function runtime.

**Option B — from the dashboard.** **Authentication → Users → Invite user** (or
*Create new user* with *Auto confirm* and share the password privately). New
people start as **Contributor**; change roles in **Manage team**.

Roles:

| Role | Can |
|---|---|
| **Admin** | Everything: view/edit all tasks, manage people, roles, capacity, working days |
| **Contributor** | See the team calendar; create own tasks; edit tasks they own (accepted) or requested; accept/decline/suggest; request others’ time |
| **Requester** | Only the **Tickets** page: raise tickets, follow their status, adjust them if sent back for revision |

## 6. Deploy to GitHub Pages

1. Push this project to a GitHub repository (e.g. `polestar-work-calendar`).
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. **Settings → Secrets and variables → Actions → Variables → New repository variable**:

   | Name | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | your publishable (or anon) key |

4. Push to `main` (or **Actions → Deploy to GitHub Pages → Run workflow**).
   The workflow installs, type-checks, runs all tests, builds with the correct
   `/<repo>/` base path, and publishes `dist/`.
5. The app is live at `https://<github-user>.github.io/<repo>/`. Make sure this
   exact URL is the **Site URL** from step 3.

## 7. Verify with two accounts

Use two browsers (or one normal + one private window), signed in as two
different contributors — say Spandan (A) and Mandya (B).

1. **A:** drag across 2–4 PM today → title “Brightspeed Data Validation” →
   owners: A and B → **Send request**. A sees a purple, striped tentative event.
2. **B:** without refreshing, the request appears on B’s calendar and the bell
   shows a badge. Open it → **Accept**.
3. **A:** the event turns from tentative to scheduled (grey), and the bell’s
   *My requests* tab shows “Confirmed”.
4. **A:** drag the event to 3–5 PM. **B** sees it move within a second or two.
5. **B:** open it → progress +25% → add a progress note. **A** sees the progress
   bar and bookmark count update.
6. Concurrency: both open the same task; **A** saves a progress change first,
   then **B** tries a change → B gets “Someone else just updated this task” and
   sees the latest values (nothing is silently overwritten).
7. **B:** Mark completed → green on both calendars; utilization updates.
8. Either: **Export → Visible → Export to Excel** → open the file; check the
   three sheets.
9. Sign in as a **Requester**: only their own requests are visible.

## Free-tier notes

- The app fetches only the visible date range (± 1 day) and subscribes to one
  Realtime channel for tasks plus small per-user / per-open-task channels; RLS
  filters what each person receives.
- History lists load 40 entries at a time; exports are capped at 92 days.
- Supabase pauses free projects after a week of no activity — open the
  dashboard and click **Restore** if that happens. Data is kept.

## Troubleshooting

| Symptom | Fix |
|---|---|
| App says “Connect Supabase” | The build had no `VITE_SUPABASE_*` values — set the Actions variables and re-run the workflow. |
| Blank page / 404 for assets on Pages | Pages source must be **GitHub Actions**; don’t override `VITE_BASE`. |
| Invite link opens localhost | Fix **Site URL** / **Redirect URLs** (step 3) and re-send the invite. |
| “Your account isn’t active” | An admin unticked *Active* in Manage team, or the profile row is missing — re-run step 4’s update for that email. |
| Changes don’t appear live | Check the publication in step 2; a reload always shows current data. |
| “Only admins can invite people” | Your profile’s role isn’t `admin` (step 4). |
| Invite fails with “Failed to send a request to the Edge Function” | The function isn't deployed at `/functions/v1/invite-user`. The dashboard editor gives new functions a random URL name (e.g. `smooth-worker`) and renaming later only changes the label. Either deploy with the CLI command in step 5, or add an Actions variable `VITE_INVITE_FUNCTION` set to the name in the function's URL and re-run the workflow. |
