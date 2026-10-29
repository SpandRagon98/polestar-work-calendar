// Local sandbox (vite --mode sandbox only): the real migration running in the
// browser via PGlite, so the UI can be exercised without a Supabase project.
// Never part of the production build.
import { PGlite } from '@electric-sql/pglite'
import { DateTime } from 'luxon'
import migration from '../../supabase/migrations/20261029000000_init.sql?raw'

const STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}'::jsonb);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
`

export const SANDBOX_USERS = [
  { id: '10000000-0000-4000-8000-000000000001', name: 'Coordinator', email: 'admin@polestar.test', role: 'admin' },
  { id: '10000000-0000-4000-8000-000000000002', name: 'Spandan', email: 'spandan@polestar.test', role: 'contributor' },
  { id: '10000000-0000-4000-8000-000000000003', name: 'Mandya', email: 'mandya@polestar.test', role: 'contributor' },
  { id: '10000000-0000-4000-8000-000000000004', name: 'Rupam', email: 'rupam@polestar.test', role: 'requester' },
  { id: '10000000-0000-4000-8000-000000000005', name: 'Priya Nair', email: 'priya@polestar.test', role: 'contributor' },
] as const

let ready: Promise<PGlite> | null = null

export function getDb(): Promise<PGlite> {
  if (!ready) ready = init()
  return ready
}

async function init(): Promise<PGlite> {
  const db = new PGlite()
  await db.exec(STUB)
  await db.exec(migration)
  for (const u of SANDBOX_USERS) {
    await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, jsonb_build_object('name', $3::text))`, [
      u.id,
      u.email,
      u.name,
    ])
    await db.query(`update public.profiles set role = $2, timezone = 'Asia/Kolkata' where user_id = $1`, [u.id, u.role])
  }
  await seed(db)
  return db
}

/** Run a statement as a signed-in user, with RLS applied exactly as in Supabase. */
export async function asUser<T>(userId: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  const db = await getDb()
  return db.transaction(async (tx) => {
    await tx.exec('set local role authenticated')
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId ?? ''])
    return (await tx.query<T>(sql, params)).rows
  })
}

async function seed(db: PGlite) {
  const [admin, spandan, mandya, rupam, priya] = SANDBOX_USERS.map((u) => u.id)
  const zone = 'Asia/Kolkata'
  const week = DateTime.now().setZone(zone).startOf('week')
  const today = DateTime.now().setZone(zone).startOf('day')
  const at = (base: DateTime, day: number, h: number, m = 0) => base.plus({ days: day }).set({ hour: h, minute: m }).toUTC().toISO()!

  const run = async <T>(user: string, sql: string, params: unknown[]) => {
    return db.transaction(async (tx) => {
      await tx.exec('set local role authenticated')
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user])
      return (await tx.query<T>(sql, params)).rows
    })
  }
  const create = async (user: string, p: Record<string, unknown>) =>
    (await run<{ id: string }>(user, `select public.create_task($1) as id`, [p]))[0].id
  const update = (user: string, id: string, v: number, p: Record<string, unknown>) =>
    run(user, `select public.update_task($1, $2, $3)`, [id, v, p])
  const respond = (user: string, id: string, r: string, note: string | null = null) =>
    run(user, `select public.respond_assignment($1, $2, $3, null, null)`, [id, r, note])
  const note = (user: string, id: string, text: string) => run(user, `select public.add_bookmark($1, $2)`, [id, text])

  // Brightspeed validation: Spandan + Mandya, 2–4 PM today
  const bright = await create(spandan, {
    title: 'Brightspeed Data Validation',
    start_at: at(today, 0, 14),
    end_at: at(today, 0, 16),
    owner_ids: [spandan, mandya],
    priority: 'high',
    category: 'Brightspeed',
    custom_fields: [
      { id: 'cf-blocked', label: 'Blocked By', type: 'text', value: 'Awaiting FCC mapping', pinned: true },
      { id: 'cf-eta', label: 'Expected Resolution', type: 'date', value: today.plus({ days: 4 }).toISODate(), pinned: true },
      { id: 'cf-rev', label: 'Reviewer', type: 'person', value: mandya },
    ],
  })
  await respond(mandya, bright, 'accept')
  await update(spandan, bright, 1, { progress_percent: 60 })
  await note(spandan, bright, 'Initial validation started')
  await note(spandan, bright, '60% completed — waiting for upstream data')

  // Morning standup-style tasks
  const recon = await create(spandan, { title: 'Revenue reconciliation', start_at: at(today, 0, 10), end_at: at(today, 0, 12, 30), owner_ids: [spandan], category: 'Finance ops' })
  await update(spandan, recon, 1, { progress_percent: 40 }) // ends before now → Needs update

  const done = await create(spandan, { title: 'Client KPI deck review', start_at: at(today, -1, 11), end_at: at(today, -1, 12), owner_ids: [spandan], category: 'Brightspeed' })
  await update(spandan, done, 1, { work_status: 'completed' })

  const blocked = await create(mandya, { title: 'Pipeline refresh — Q4 model', start_at: at(today, -1, 15), end_at: at(today, -1, 17, 30), owner_ids: [mandya], priority: 'high', category: 'Data platform' })
  await update(mandya, blocked, 1, { progress_percent: 30 })
  await update(mandya, blocked, 2, { work_status: 'pending', pending_reason: 'External dependency — Source system migration pending' })

  // Rupam requests time from Spandan and Mandya (tentative)
  await create(rupam, {
    title: 'Ad-hoc churn analysis for leadership',
    description: 'Quick cut of churn by region for the Monday leadership review.',
    start_at: at(today, 1, 11),
    end_at: at(today, 1, 13),
    owner_ids: [spandan, mandya],
    priority: 'high',
    category: 'Leadership asks',
  })
  // A request Mandya already accepted, still waiting on Spandan
  const workshop = await create(rupam, { title: 'Dashboard walkthrough with sales', start_at: at(today, 2, 15), end_at: at(today, 2, 16), owner_ids: [spandan, mandya], category: 'Enablement' })
  await respond(mandya, workshop, 'accept')

  // Team calendar background
  await create(priya, { title: 'Forecast model tuning', start_at: at(today, 0, 9, 30), end_at: at(today, 0, 13), owner_ids: [priya], category: 'Data science' })
  await create(priya, { title: 'Data quality checks', start_at: at(week, 0, 10), end_at: at(week, 0, 12), owner_ids: [priya] })
  await create(admin, { title: 'Sprint planning', start_at: at(today, 1, 9, 30), end_at: at(today, 1, 10, 30), owner_ids: [admin] })
  const deep = await create(spandan, { title: 'SQL optimisation sprint', start_at: at(today, 2, 10), end_at: at(today, 2, 13), owner_ids: [spandan], category: 'Data platform' })
  await update(spandan, deep, 1, { progress_percent: 10 })
}
