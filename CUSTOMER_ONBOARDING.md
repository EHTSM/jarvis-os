# Customer Onboarding — The User Journey

How a real person goes from "never heard of Ooplix" to an active, paying user. This describes the actual code path — not an aspirational flow — so you can walk it yourself before launch.

Ooplix is currently in **closed beta**: registration requires a valid invite code and is capped at 50 accounts (`BETA_MAX_USERS`, default 50). This is enforced server-side, not just a UI gate.

---

## Step 0 — You generate an invite (founder action)

Before anyone can register, you create an invite code:

```
POST /co3/invites/create      { ...options }
POST /co3/invites/bulk        { count: 10, ...options }   # generate many at once
```

Check outstanding invites:
```
GET /co3/invites               # (co3UserSuccess service — dashboard view)
GET /cbeta/invites             # (closed beta service — revocation view)
```

Revoke one if needed:
```
POST /cbeta/invites/:code/revoke
```

Send the code to your prospective customer however you communicate today — email, WhatsApp, DM. There's no public invite-request form live yet; every invite currently originates from you.

## Step 1 — Registration

Customer visits your domain and registers:

```
POST /accounts/register
{ "email": "...", "password": "...", "name": "...", "inviteCode": "..." }
```

What happens server-side, in order:
1. Rate limit: 5 registrations per 15 minutes per IP
2. **Beta gate check** — invite code must be valid and unused; the 50-user cap is enforced here (`betaReadiness.cjs` → `checkBetaGate`). If the cap is hit or the code is invalid/already used, registration is rejected with a 403.
3. Account created (`accountService.createAccount`) — password is hashed, never stored plain
4. Invite code marked as used, tied to the new account ID
5. Verification email sent automatically via Resend (`RESEND_API_KEY` must be configured — see [CONNECTOR_SETUP_GUIDE.md](CONNECTOR_SETUP_GUIDE.md#email--resend))
6. Response: `{ success: true, account: {...}, message: "Account created. Check your email to verify your address." }`

**If `RESEND_API_KEY` isn't set**, the account still gets created (verification send failures are non-fatal) but the customer never receives the email — they'll be stuck unable to verify. Confirm email is working before your first real invite goes out.

## Step 2 — Email verification

Customer clicks the link in the verification email, which hits:
```
GET /auth/verify-email?token=...
POST /auth/verify-email      (form-based alternative)
```

## Step 3 — Login

```
POST /auth/login    { "email": "...", "password": "..." }
```

On success, Ooplix sets an `httpOnly`, `secure` (in production), `sameSite: strict` session cookie — the customer stays logged in across visits without re-entering credentials, and the cookie can't be read or exfiltrated by client-side JS (XSS-resistant by design).

Session length is governed by `TOKEN_EXPIRY` in `middleware/authMiddleware.js`.

## Step 4 — First-run experience

Once logged in, the customer lands on the main Ooplix console. What they see depends on what you've configured:

- **Dashboard** — system health, recent activity
- **Mission Control** — where they describe a goal in plain language and Ooplix plans/executes it
- **CRM** (if they're using Ooplix for their own business) — lead pipeline, WhatsApp/Telegram automation status
- **Settings → Integrations** — where they'd connect their own OAuth accounts (Google, GitHub, Slack, etc.) if your product surfaces that to end users

There's no scripted product tour in the code today — the first thing a new user does is whatever they came to do. If you want a guided first-run, that's a gap worth noting for a future release (see [RELEASE_PLAYBOOK.md](RELEASE_PLAYBOOK.md) for how to propose it), not something to fake in this doc.

## Step 5 — Forgot password (if needed)

```
POST /auth/forgot-password    { "email": "..." }
POST /auth/reset-password     { "token": "...", "newPassword": "..." }
```
Requires `RESEND_API_KEY` configured — same dependency as verification email.

## Step 6 — Payment (if your plan requires it)

If the customer needs to pay:
```
POST /payment/link    { "amount": 999, "name": "...", "phone": "...", "description": "..." }
```
Returns a Razorpay payment link. If a phone number was provided, Ooplix also sends the link via WhatsApp automatically.

When Razorpay confirms the payment (webhook fires `payment.captured`), Ooplix:
1. Verifies the webhook HMAC signature
2. Marks the associated CRM lead `status: "paid"`
3. Sends a WhatsApp onboarding message to the customer, if a phone number is on file

This entire chain silently does nothing if `RAZORPAY_WEBHOOK_SECRET` isn't set — see [CONNECTOR_SETUP_GUIDE.md](CONNECTOR_SETUP_GUIDE.md#razorpay) before accepting real payments.

## Step 7 — Mobile app (optional)

If the customer uses the Capacitor/Firebase-backed mobile app instead of the web console, login works differently:
```
POST /auth/firebase-session    { "email": "...", "idToken": "..." (Firebase-verified) }
```
If no account exists for that email yet, one is **auto-created** on first mobile login (synthetic password, real email) — no invite code required for this path. This means mobile sign-in currently bypasses the closed-beta invite gate; be aware of that if you're distributing the mobile build during beta.

---

## Walking the journey yourself before launch

1. Generate an invite code for yourself: `POST /co3/invites/create`
2. Register with a real email you can check: `POST /accounts/register`
3. Confirm you receive the verification email — if you don't, stop and fix Resend configuration before inviting real customers
4. Verify, then log in
5. Confirm the session cookie persists across a page reload
6. If you charge for access, send yourself a real ₹1 test payment link and confirm the CRM updates and the WhatsApp message arrives
7. Log out, then try "forgot password" end to end

If every step above works for you, it will work for your first customer.
