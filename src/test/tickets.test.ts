import { describe, expect, it } from 'vitest'
import { MANDYA, RUPAM, SPANDAN, makeTask } from './fixtures'
import { onCalendar } from '../lib/permissions'
import { acceptedCount, isTicket, ticketStatus } from '../lib/tickets'
import { parseRoute, routeHash } from '../lib/router'
import { parseAuthLink } from '../lib/supabase'

describe('tickets stay off calendars until accepted', () => {
  const ticket = makeTask({
    approval_state: 'awaiting_approval',
    requester_id: RUPAM,
    created_by: RUPAM,
    owners: [[SPANDAN, 'pending'], [MANDYA, 'pending']],
  })

  it('hides an unanswered ticket from everyone’s calendar', () => {
    expect(onCalendar(ticket, SPANDAN, 'mine')).toBe(false)
    expect(onCalendar(ticket, SPANDAN, 'team')).toBe(false)
  })

  it('shows it on my calendar once I accept, but not on a colleague’s who hasn’t', () => {
    const partly = { ...ticket, assignments: [{ user_id: SPANDAN, approval_status: 'accepted' as const, responded_at: null }, { user_id: MANDYA, approval_status: 'pending' as const, responded_at: null }] }
    expect(onCalendar(partly, SPANDAN, 'mine')).toBe(true)
    expect(onCalendar(partly, MANDYA, 'mine')).toBe(false)
    expect(onCalendar(partly, MANDYA, 'team')).toBe(true)
  })

  it('keeps my own tasks on my calendar', () => {
    expect(onCalendar(makeTask(), SPANDAN, 'mine')).toBe(true)
  })
})

describe('ticket status', () => {
  it('combines approval and work state', () => {
    const base = { requester_id: RUPAM, created_by: RUPAM }
    expect(ticketStatus(makeTask({ ...base, approval_state: 'awaiting_approval' }))).toBe('awaiting')
    expect(ticketStatus(makeTask({ ...base, approval_state: 'needs_revision' }))).toBe('needs_revision')
    expect(ticketStatus(makeTask(base))).toBe('accepted')
    expect(ticketStatus(makeTask({ ...base, work_status: 'in_progress' }))).toBe('in_progress')
    expect(ticketStatus(makeTask({ ...base, work_status: 'pending' }))).toBe('on_hold')
    expect(ticketStatus(makeTask({ ...base, work_status: 'completed', completed_at: '2026-11-02T10:00:00Z' }))).toBe('completed')
    expect(ticketStatus(makeTask({ ...base, approval_state: 'awaiting_approval', work_status: 'cancelled' }))).toBe('cancelled')
    expect(isTicket(makeTask(base))).toBe(true)
    expect(isTicket(makeTask())).toBe(false)
    expect(acceptedCount(makeTask({ owners: [[SPANDAN, 'accepted'], [MANDYA, 'pending']] }))).toEqual({ accepted: 1, total: 2 })
  })
})

describe('routes', () => {
  it('parses hash routes and leaves auth hashes alone', () => {
    expect(parseRoute('#/calendar').name).toBe('calendar')
    expect(parseRoute('#/tickets/new').name).toBe('new-ticket')
    const r = parseRoute('#/tickets?open=abc&tab=raised')
    expect([r.name, r.params.get('open'), r.params.get('tab')]).toEqual(['tickets', 'abc', 'raised'])
    expect(parseRoute('#access_token=x&type=invite').name).toBeNull()
    expect(parseRoute('').name).toBeNull()
    expect(routeHash('tickets', { open: 'abc' })).toBe('#/tickets?open=abc')
  })
})

describe('invite and reset links', () => {
  const base = 'https://spandragon98.github.io/polestar-work-calendar/'
  it('recognises scanner-safe token-hash links', () => {
    expect(parseAuthLink(`${base}?token_hash=abc&type=invite`)).toEqual({ kind: 'invite', tokenHash: 'abc' })
    expect(parseAuthLink(`${base}?token_hash=abc&type=recovery`)).toEqual({ kind: 'recovery', tokenHash: 'abc' })
  })
  it('recognises default Supabase links', () => {
    expect(parseAuthLink(`${base}#access_token=t&refresh_token=r&type=invite`)).toEqual({ kind: 'invite' })
  })
  it('explains expired or already-used links', () => {
    const link = parseAuthLink(`${base}#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`)
    expect(link?.kind).toBe('error')
    expect(link && 'message' in link ? link.message : '').toMatch(/expired or was already used/)
  })
  it('ignores normal visits and app routes', () => {
    expect(parseAuthLink(base)).toBeNull()
    expect(parseAuthLink(`${base}#/tickets`)).toBeNull()
  })
})
