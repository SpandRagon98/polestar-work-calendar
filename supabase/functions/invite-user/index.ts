// Supabase Edge Function: admin-only user invitation.
//
// Verifies the caller's JWT, checks they are an active admin in public.profiles,
// then uses the service-role key (available only inside Supabase's function
// runtime, never in the browser) to send an invite email and set the new
// person's role.
//
// Deploy: npx supabase functions deploy invite-user --project-ref <ref>
import { createClient } from 'npm:@supabase/supabase-js@2'

const ROLES = ['admin', 'contributor', 'requester'] as const

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)

  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    // 1. Who is calling?
    const caller = createClient(url, anonKey, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
      auth: { persistSession: false },
    })
    const { data: auth } = await caller.auth.getUser()
    if (!auth.user) return json({ error: 'Please sign in again.' }, 401)

    // 2. Are they an active admin?
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } })
    const { data: me } = await admin.from('profiles').select('role, active').eq('user_id', auth.user.id).maybeSingle()
    if (!me || !me.active || me.role !== 'admin') return json({ error: 'Only admins can invite people.' }, 403)

    // 3. Validate input.
    const body = await req.json().catch(() => ({}))
    const email = String(body.email ?? '').trim().toLowerCase()
    const name = String(body.name ?? '').trim().slice(0, 120)
    const role = ROLES.includes(body.role) ? body.role : 'contributor'
    const redirectTo = typeof body.redirectTo === 'string' ? body.redirectTo : undefined
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Enter a valid email address.' }, 400)
    if (!name) return json({ error: 'Enter the person’s name.' }, 400)

    // 4. Invite. Supabase only honours redirect URLs on the project's allow list.
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { data: { name }, redirectTo })
    if (error) return json({ error: error.message }, 400)

    // 5. The signup trigger created a contributor profile; apply the chosen role.
    const { error: upd } = await admin.from('profiles').update({ role, name }).eq('user_id', data.user.id)
    if (upd) return json({ error: `Invited, but setting the role failed: ${upd.message}` }, 500)

    return json({ ok: true, user_id: data.user.id })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unexpected error.' }, 500)
  }
})
