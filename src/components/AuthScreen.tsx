import { useState, type FormEvent } from 'react'
import { ArrowRight, KeyRound, Lock, Mail } from 'lucide-react'
import { appUrl, supabase } from '../lib/supabase'
import { Button, Logo } from './ui/primitives'

type Mode = 'signin' | 'forgot'

export function AuthScreen({ linkError }: { linkError?: string }) {
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(linkError ?? null)
  const [notice, setNotice] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)
    if (mode === 'signin') {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (error) setError(error.message === 'Invalid login credentials' ? 'Incorrect email or password.' : error.message)
    } else {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: appUrl() })
      if (error) setError(error.message)
      else setNotice('If that email belongs to a team member, a reset link is on its way.')
    }
    setBusy(false)
  }

  return (
    <AuthLayout>
      <h1 className="font-display text-2xl font-bold text-ink">
        {mode === 'signin' ? 'Welcome back' : 'Reset your password'}
      </h1>
      <p className="mt-1 text-sm text-ash">
        {mode === 'signin'
          ? 'Sign in to plan, track and share your team’s work.'
          : 'We’ll email you a link to choose a new password.'}
      </p>
      <form onSubmit={submit} className="mt-7 space-y-4">
        <div>
          <label htmlFor="email" className="label">
            Work email
          </label>
          <div className="relative">
            <Mail size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-stone" />
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              className="field h-11 pl-9"
              placeholder="name@polestaranalytics.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
        </div>
        {mode === 'signin' ? (
          <div>
            <div className="flex items-center justify-between">
              <label htmlFor="password" className="label">
                Password
              </label>
              <button
                type="button"
                className="mb-1 text-xs font-medium text-ember hover:underline"
                onClick={() => {
                  setMode('forgot')
                  setError(null)
                }}
              >
                Forgot password?
              </button>
            </div>
            <div className="relative">
              <Lock size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-stone" />
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                className="field h-11 pl-9"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="rounded-xl bg-st-pending/8 px-3 py-2 text-sm text-st-pending">
            {error}
          </p>
        ) : null}
        {notice ? <p className="rounded-xl bg-peach-50 px-3 py-2 text-sm text-maroon">{notice}</p> : null}
        <Button type="submit" variant="primary" className="h-11 w-full justify-center" loading={busy}>
          {mode === 'signin' ? 'Sign in' : 'Send reset link'}
          {!busy ? <ArrowRight size={16} /> : null}
        </Button>
        {mode === 'forgot' ? (
          <button type="button" className="w-full text-center text-sm text-ash hover:text-ink" onClick={() => setMode('signin')}>
            Back to sign in
          </button>
        ) : null}
      </form>
      <p className="mt-8 text-xs text-stone">
        Access is by invitation only. Ask your coordinator for an invite if you don’t have an account.
      </p>
    </AuthLayout>
  )
}

/**
 * Finish an invite or password reset. For token-hash links the one-time token is
 * only redeemed when the person submits — email security scanners that open the
 * link first can't use it up.
 */
export function SetPasswordScreen({
  kind,
  tokenHash,
  onDone,
  onCancel,
}: {
  kind: 'invite' | 'recovery'
  tokenHash?: string
  onDone: () => void
  onCancel: () => void
}) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expired, setExpired] = useState(false)
  const isInvite = kind === 'invite'

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 8) return setError('Use at least 8 characters.')
    if (password !== confirm) return setError('Passwords do not match.')
    setBusy(true)
    try {
      if (tokenHash) {
        const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: kind })
        if (error) {
          setExpired(true)
          return setError('This link has expired or was already used.')
        }
      }
      const { error } = await supabase.auth.updateUser({ password })
      if (error) return setError(error.message)
      onDone()
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout>
      <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-2xl bg-peach-50 text-maroon">
        <KeyRound size={20} />
      </div>
      <h1 className="font-display text-2xl font-bold text-ink">{isInvite ? 'Welcome to the team' : 'Choose a new password'}</h1>
      <p className="mt-1.5 text-sm leading-relaxed text-ash">
        {isInvite
          ? 'You’ve been invited to Polestar Work Calendar. Choose a password to activate your account.'
          : 'Enter a new password for your account.'}
      </p>
      {expired ? (
        <div className="mt-7 space-y-4">
          <p role="alert" className="rounded-xl bg-st-pending/8 px-3.5 py-3 text-sm leading-relaxed text-st-pending">
            This link has expired or was already used. {isInvite ? 'Ask your admin to send a new invite.' : 'Request a new reset link.'}
          </p>
          <Button variant="primary" className="h-11 w-full justify-center" onClick={onCancel}>
            Go to sign in
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-7 space-y-4">
          <div>
            <label htmlFor="new-password" className="label">
              New password
            </label>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              autoFocus
              className="field h-11"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <p className="mt-1.5 text-xs text-stone">At least 8 characters.</p>
          </div>
          <div>
            <label htmlFor="confirm-password" className="label">
              Confirm password
            </label>
            <input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              className="field h-11"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
          {error ? (
            <p role="alert" className="rounded-xl bg-st-pending/8 px-3.5 py-2.5 text-sm text-st-pending">
              {error}
            </p>
          ) : null}
          <Button type="submit" variant="primary" className="h-11 w-full justify-center" loading={busy}>
            {isInvite ? 'Activate account' : 'Save password'}
          </Button>
          <button type="button" className="w-full text-center text-sm text-ash hover:text-ink" onClick={onCancel}>
            Back to sign in
          </button>
        </form>
      )}
    </AuthLayout>
  )
}

export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full bg-ivory">
      <div className="flex flex-1 flex-col px-6 py-8 sm:px-12 lg:max-w-[560px]">
        <Logo className="h-11 self-start" />
        <div className="flex flex-1 items-center">
          <div className="w-full max-w-sm py-10">{children}</div>
        </div>
        <p className="text-xs text-stone">© {new Date().getFullYear()} Polestar Analytics · Work Calendar</p>
      </div>
      <BrandPanel />
    </div>
  )
}

/** Decorative right panel: an abstract week of work, drawn with plain blocks. */
function BrandPanel() {
  const cols = [
    [{ top: 8, h: 18, c: 'bg-st-completed' }, { top: 34, h: 14, c: 'bg-apricot' }],
    [{ top: 14, h: 24, c: 'bg-peach' }, { top: 48, h: 12, c: 'bg-st-awaiting/70' }],
    [{ top: 4, h: 12, c: 'bg-apricot' }, { top: 22, h: 30, c: 'bg-white/80' }],
    [{ top: 18, h: 16, c: 'bg-st-completed' }, { top: 44, h: 18, c: 'bg-peach' }],
    [{ top: 10, h: 22, c: 'bg-white/80' }],
  ]
  return (
    <div className="relative hidden flex-1 overflow-hidden bg-ink p-12 lg:flex lg:flex-col lg:justify-between">
      <div className="absolute -top-32 -right-32 h-96 w-96 rounded-full bg-maroon/60 blur-3xl" />
      <div className="relative">
        <p className="section-title text-peach/80!">Polestar Work Calendar</p>
        <h2 className="mt-3 max-w-md font-display text-4xl leading-tight font-bold text-white">
          Plan it. Own it. <span className="text-apricot">Ship it.</span>
        </h2>
        <p className="mt-4 max-w-md text-sm leading-relaxed text-white/60">
          Every task lives on the calendar — owners, progress, notes and approvals, in one place your whole team shares.
        </p>
      </div>
      <div className="relative rounded-3xl border border-white/10 bg-white/[0.04] p-5">
        <div className="mb-3 grid grid-cols-5 gap-3 text-[11px] font-medium text-white/50">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
        <div className="grid h-56 grid-cols-5 gap-3">
          {cols.map((col, i) => (
            <div key={i} className="relative rounded-xl bg-white/[0.03]">
              {col.map((b, j) => (
                <div
                  key={j}
                  className={`absolute inset-x-1.5 rounded-lg ${b.c}`}
                  style={{ top: `${b.top * 1.4}%`, height: `${b.h * 1.4}%`, opacity: 0.9 }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
