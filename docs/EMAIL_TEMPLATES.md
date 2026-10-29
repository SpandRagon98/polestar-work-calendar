# Invite & password-reset emails

Supabase's default emails link to a one-time URL. Company mail systems
(Microsoft 365 Safe Links, Mimecast, etc.) often **open links before the person
does**, which uses up that one-time token — the person then lands on the app with
an expired link.

These templates send people to the app with a `token_hash` instead. The app only
redeems it when they click **Activate account** / **Save password**, so scanners
can't use it up. They also look like Polestar, not like a raw GitHub address.

## Set it up (2 minutes)

Supabase dashboard → **Authentication → Emails** (or *Email Templates*).

1. Check **Authentication → URL Configuration → Site URL** is exactly
   `https://spandragon98.github.io/polestar-work-calendar/` (with the trailing slash).
2. Open the **Invite user** template, set the subject and paste the body below. Save.
3. Open the **Reset password** template, set the subject and paste the body below. Save.

Use the **Source** / HTML view of the editor when pasting.

---

### Invite user

**Subject:** `You're invited to Polestar Work Calendar`

```html
<div style="font-family:Inter,Segoe UI,Arial,sans-serif;background:#f7f4f2;padding:32px 16px">
  <div style="max-width:520px;margin:0 auto;background:#fdfdfd;border:1px solid #ece6e2;border-radius:20px;padding:32px">
    <img src="{{ .SiteURL }}polestar-logo.png" alt="Polestar Analytics" height="36" style="display:block;margin-bottom:28px">
    <h1 style="margin:0 0 8px;font-size:22px;color:#250b0b">You're invited to the team calendar</h1>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#615e5e">
      You've been added to <strong>Polestar Work Calendar</strong> — where the team plans work,
      tracks progress and raises tickets. Choose a password to activate your account.
    </p>
    <a href="{{ .SiteURL }}?token_hash={{ .TokenHash }}&type=invite"
       style="display:inline-block;background:#5c0605;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:12px">
      Activate account
    </a>
    <p style="margin:24px 0 0;font-size:12px;line-height:1.6;color:#898989">
      This invitation is for {{ .Email }}. If you weren't expecting it, you can ignore this email.
    </p>
  </div>
</div>
```

### Reset password

**Subject:** `Reset your Polestar Work Calendar password`

```html
<div style="font-family:Inter,Segoe UI,Arial,sans-serif;background:#f7f4f2;padding:32px 16px">
  <div style="max-width:520px;margin:0 auto;background:#fdfdfd;border:1px solid #ece6e2;border-radius:20px;padding:32px">
    <img src="{{ .SiteURL }}polestar-logo.png" alt="Polestar Analytics" height="36" style="display:block;margin-bottom:28px">
    <h1 style="margin:0 0 8px;font-size:22px;color:#250b0b">Reset your password</h1>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#615e5e">
      Someone asked to reset the password for {{ .Email }}. Click below to choose a new one.
    </p>
    <a href="{{ .SiteURL }}?token_hash={{ .TokenHash }}&type=recovery"
       style="display:inline-block;background:#5c0605;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:12px">
      Choose a new password
    </a>
    <p style="margin:24px 0 0;font-size:12px;line-height:1.6;color:#898989">
      If you didn't ask for this, you can ignore this email — your password won't change.
    </p>
  </div>
</div>
```

---

**If someone already has a dead link:** they open the app, click **Forgot
password?** and enter their email — the reset email lets them set a password and
sign in. (Re-inviting an email that already has an account is refused by
Supabase.) Expired links now show a clear message instead of a bare sign-in page.
