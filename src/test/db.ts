// Test harness: runs the real Supabase migrations inside PGlite (Postgres in WASM)
// with a minimal stand-in for Supabase's auth schema and API roles.
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'supabase', 'migrations')

const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (
    id uuid primary key,
    email text,
    raw_user_meta_data jsonb not null default '{}'::jsonb
  );
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  -- Supabase grants these by default; the migration must revoke what it doesn't want.
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
`

export interface TestDb {
  db: PGlite
  addUser(name: string, role?: 'admin' | 'contributor' | 'requester'): Promise<string>
  as<T = Record<string, unknown>>(userId: string | null, sql: string, params?: unknown[]): Promise<T[]>
  asAnon<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
}

let userCounter = 0

export async function createTestDb(): Promise<TestDb> {
  const db = new PGlite()
  await db.exec(SUPABASE_STUB)
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'))
  }

  async function run<T>(role: string, userId: string | null, sql: string, params: unknown[] = []) {
    return db.transaction(async (tx) => {
      await tx.exec(`set local role ${role}`)
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId ?? ''])
      const res = await tx.query<T>(sql, params)
      return res.rows
    })
  }

  return {
    db,
    async addUser(name, role = 'contributor') {
      userCounter += 1
      const id = `00000000-0000-4000-8000-${String(userCounter).padStart(12, '0')}`
      await db.query(
        `insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, jsonb_build_object('name', $3::text))`,
        [id, `${name.toLowerCase()}@polestar.test`, name],
      )
      await db.query(`update public.profiles set role = $2, timezone = 'Asia/Kolkata' where user_id = $1`, [id, role])
      return id
    },
    as: (userId, sql, params) => run('authenticated', userId, sql, params),
    asAnon: (sql, params) => run('anon', null, sql, params),
  }
}
