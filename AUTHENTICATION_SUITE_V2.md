# AUTHENTICATION SUITE V2
**Phase:** 39 — Frontend Rebuild Strategy
**Date:** 2026-06-07
**Status:** Specification — No code written
**Scope:** Auth UI redesign only. Backend routes unchanged.

---

## 1. AUTH SURFACE INVENTORY

### Existing screens (to rebuild)

| Screen | File | Purpose |
|---|---|---|
| Landing | `Landing.jsx` | Public homepage → starts signup flow |
| Onboarding | `Onboarding.jsx` | 3-step wizard (biz type, product, price) |
| Signup | `auth/SignupPage.jsx` | Creates account via POST /accounts/register |
| Login | `auth/LoginPage.jsx` | Per-user email+password OR legacy operator password |

### Preserved auth mechanics (backend, no changes)
- `POST /accounts/register` — creates account, auto-creates 7-day trial
- `POST /auth/login` — returns session cookie (httpOnly, 8h)
- `GET /auth/me` — returns current user
- `POST /auth/logout` — clears cookie
- `GET /billing/status` — trial/subscription state

### Auth context (unchanged)
- `AuthContext.jsx` — user, loading, login, logout, sessionExpiring, silentCheck
- BroadcastChannel multi-tab sync
- 401 interceptor via `setOn401()`
- 5-minute session silent check
- 5-minute warning before 8h expiry

---

## 2. SCREEN ARCHITECTURE

### 2.1 Landing V2

**Purpose:** First impression for a stranger. Converts to signup in under 10 seconds.

**Layout:**

```
┌─────────────────────────────────────────────────────────┐
│  Ooplix                              Sign in  →         │
│─────────────────────────────────────────────────────────│
│                                                         │
│  AI Operating System                                    │
│  for Your Business.                                     │
│                                                         │
│  Follow up with leads. Collect payments. Execute        │
│  workflows — while you sleep.                           │
│                                                         │
│  [ Start Free — 7 days, no card  ↗ ]                    │
│  [ See how it works ↓ ]                                 │
│                                                         │
│  ────────────────────────────────────────────────       │
│  Live runtime feed (animated ASCII / data cards)        │
│  ────────────────────────────────────────────────       │
│                                                         │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐         │
│  │ Auto │ │ CRM  │ │Pay   │ │Agent │ │DevOS │         │
│  │ WA   │ │ Lead │ │Links │ │Exec  │ │Suite │         │
│  └──────┘ └──────┘ └──────┘ └──────┘ └──────┘         │
│                                                         │
│  [Objection handling strip]                             │
│  [Social proof: company count / testimonial]            │
│  [CTA again: Start Free]                                │
│  ────────────────────────────────────────────────       │
│  [Footer: Legal | Company | Contact | Privacy]          │
└─────────────────────────────────────────────────────────┘
```

**Design Notes:**
- Dark background (`--canvas`). No hero image — animated data feed as visual proof.
- Hero font: `--text-display-xl` (56px), `--weight-extrabold`, `--tracking-tight`
- Primary CTA: `--btn-height-xl` (48px), filled violet, rounded pill
- Secondary CTA: ghost button, `--text-secondary`
- Capability cards: 5 cards horizontal scroll on mobile, grid on desktop
- Each capability card: icon + 3-word label + 1-line benefit
- Trust strip below hero: "✓ 7-day free trial · ✓ No credit card · ✓ Cancel anytime" — `--text-tertiary`, 13px

**Animation:**
- Hero text: `fade-in` 400ms on mount
- Capability cards: stagger `slide-up-enter` 100ms apart
- Live feed: real data from `GET /ops` polled every 10s, or simulated if not authenticated

---

### 2.2 Onboarding V2

**Purpose:** Collect 3 data points to personalize the experience.

**Layout:**

```
┌─────────────────────────────────────────────────────────┐
│  ← Back     [○ ● ○]  Step 2 of 3         [Skip →]      │
│─────────────────────────────────────────────────────────│
│                                                         │
│  What does your business sell?                          │
│  ─────────────────────────────                          │
│                                                         │
│  ┌──────────────────┐  ┌──────────────────┐            │
│  │ ✓ Services       │  │ ○ Products       │            │
│  └──────────────────┘  └──────────────────┘            │
│  ┌──────────────────┐  ┌──────────────────┐            │
│  │ ○ Coaching       │  │ ○ SaaS           │            │
│  └──────────────────┘  └──────────────────┘            │
│                                                         │
│  Or describe it:                                        │
│  [ ─────────────────────────── ]                        │
│                                                         │
│  [ Continue → ]                                         │
│─────────────────────────────────────────────────────────│
│  Your data stays on your server. No third party sharing.│
└─────────────────────────────────────────────────────────┘
```

**Steps:**
1. What does your business sell? (selection chips + free text fallback)
2. What's your primary product/offer? (free text, 60 char max)
3. Typical deal value? (₹1k–10k / ₹10k–1L / ₹1L+ / Custom)

**Design Notes:**
- Centered narrow layout (max-width: 480px)
- Progress dots at top: 3 dots, filled up to current step
- Selection chips: full-width on mobile, 2-column grid on desktop
- Selected chip: violet border + subtle violet fill
- "Back" link top-left — arrow icon + text
- "Skip" link top-right — ghost, --text-tertiary
- "Continue" button: full-width, filled violet, disabled until selection made
- Smooth forward/back animation: step entering from right, exiting left

**LocalStorage writes (unchanged):**
- `jarvis_biz_profile` → `{ bizType, product, priceRange }`
- `jarvis_started` → `"1"`

---

### 2.3 Signup V2

**Purpose:** Create account. Must feel trustworthy, fast, and low-friction.

**Layout:**

```
┌──────────────────────────────────┐
│                                  │
│   ⬡ Ooplix                       │
│                                  │
│   Create your account            │
│   Free 7-day trial · No card     │
│                                  │
│   Full name                      │
│   [ ─────────────────────────── ]│
│                                  │
│   Work email                     │
│   [ ─────────────────────────── ]│
│                                  │
│   Password (8+ characters)       │
│   [ ─────────────────────────── ]│
│   [▓▓▓▓░░░░] Strength: Good      │
│                                  │
│   [ Create Account → ]           │
│                                  │
│   ✓ 7-day free trial             │
│   ✓ No credit card required      │
│   ✓ Cancel anytime               │
│                                  │
│   Already have an account?       │
│   [ Sign in → ]                  │
│                                  │
│   By signing up you agree to our │
│   Terms of Service and Privacy   │
│   Policy.                        │
└──────────────────────────────────┘
```

**Design Notes:**
- Card on dark background: 480px max-width, `--radius-2xl`, `--surface-1`
- Logo mark at top: "⬡" (hex) or SVG in violet
- Title: "Create your account" — `--text-h2`, `--weight-bold`
- Subtitle: "Free 7-day trial · No card" — `--text-secondary`, 13px
- Three fields: Name → Email → Password
- Password field: show/hide toggle (Eye icon, Lucide)
- Strength bar: 4-segment fill, color coded (red → amber → teal → green)
- Strength label: "Too short" / "Weak" / "Good" / "Strong"
- Submit button: `--btn-height-lg`, full width, filled violet
- Loading state: spinner inside button, disabled, text "Creating account…"
- Trust strip: 3 checkmarks, centered, `--text-tertiary`
- Sign in link: `--text-link`, opens LoginPage
- Legal consent: 12px, `--text-tertiary`, links to Terms + Privacy overlays

**Error States:**
- Field-level errors: red border + error text below field (slide-down 120ms)
- Global error (409 duplicate, 500 server): error banner above submit button
- Specific error messages mirror backend:
  - 409 → "An account with this email already exists. Sign in instead?"
  - 400 password → "Password must be at least 8 characters"
  - 400 email → "Please enter a valid email address"

**Flow (unchanged):**
```
registerAccount() → POST /accounts/register → 201
loginWithEmail()  → POST /auth/login → session cookie
login()           → AuthContext.user updated
→ onSuccess() → App (screen="app", tab="home")
```

---

### 2.4 Login V2

**Purpose:** Returning user re-entry. Fast, zero friction.

**Layout:**

```
┌──────────────────────────────────┐
│                                  │
│   ⬡ Ooplix                       │
│                                  │
│   Welcome back                   │
│   Sign in to your workspace      │
│                                  │
│   Email                          │
│   [ ─────────────────────────── ]│
│                                  │
│   Password                       │
│   [ ─────────────────────────── ]│
│                                  │
│   [ Sign in → ]                  │
│                                  │
│   ─────────────────────────────  │
│                                  │
│   No account yet?                │
│   [ Create one free → ]          │
│                                  │
│   Need help? support@ooplix.com  │
│                                  │
│   ALWALIY TECHNOLOGIES PVT LTD  │
└──────────────────────────────────┘
```

**Design Notes:**
- Same card as Signup — same dimensions, same brand mark
- Title: "Welcome back"
- Subtitle: "Sign in to your workspace"
- Email field auto-focused
- Password show/hide toggle
- Submit button: full width, filled violet
- Loading: "Signing in…" with spinner, disabled
- Error: single banner below password field (no field-level, login shouldn't reveal which field is wrong)
- "Create one free →" — shown only when `onSignup` prop provided (public web flow)
- Legacy operator mode: if email blank, uses password-only path (backward compat)

---

### 2.5 Session Expiry Banner

Rendered as a fixed banner at top of app when `sessionExpiring === true` (5 min before 8h expiry):

```
┌──────────────────────────────────────────────────────┐
│ ⚠ Your session expires in 5 minutes.   [Extend] [✕] │
└──────────────────────────────────────────────────────┘
```

Color: amber fill (`--fill-warning`), amber border (`--border-warning`).
"Extend" calls a silent login refresh (re-submit cached credentials or force logout).
"✕" dismisses without action (user accepts logout risk).

---

### 2.6 Upgrade / Trial Banners (Auth-adjacent)

**TrialBanner** — shown in app header when plan is `trial`:

```
[ Trial — 6 days left ·  Upgrade ↗ ]
```

- Severity scale: info (7→4 days) → warning (3→1 days) → critical (0 days, grace)
- Color: violet → amber → red accordingly
- Clicking "Upgrade" opens UpgradeModal
- Disappears when plan is subscribed

**UpgradeModal** — no structural change from V1, only visual reskin:
- Use V2 design tokens (--surface-float, --shadow-xl, --radius-2xl)
- Same plan cards structure (Starter / Growth / Scale)
- Same Razorpay error block (rich error with billing email)

---

## 3. AUTH GATE LOGIC (unchanged)

```
App mount
  ↓
AuthContext loads → getAuthStatus() → GET /auth/me
  ↓
loading=true → render <AppSkeleton> (full-screen shimmer)
  ↓
loading=false
  ├── user exists → render <AppShell>
  └── user null
        ├── desktop=true → render <LoginPage> (skip landing/onboarding)
        ├── jarvis_biz_profile exists AND not just-onboarded → <LoginPage>
        └── else → <Landing> (new user)
```

Post-login:
```
onSuccess() called
  → track.login("email")
  → setScreen("app")
  → setSection("home")
```

Post-signup:
```
handleSignupComplete() called
  → setMessages([welcome message])
  → track.trialStarted()
  → localStorage.setItem("jarvis_just_onboarded", "1")
  → setScreen("app")
  → setSection("home")
```

---

## 4. FILE STRUCTURE

```
frontend/src/
├── components/
│   └── auth/
│       ├── Landing.jsx           ← Rebuilt V2
│       ├── Landing.css
│       ├── Onboarding.jsx        ← Rebuilt V2
│       ├── Onboarding.css
│       ├── SignupPage.jsx        ← Reskinned V2 (logic preserved)
│       ├── LoginPage.jsx         ← Reskinned V2 (logic preserved)
│       └── AuthCard.css          ← Shared card styles for Signup + Login
```

**Auth logic files — no changes:**
- `src/authApi.js`
- `src/contexts/AuthContext.jsx`
- `src/_client.js` (401 interceptor)

---

## 5. RESPONSIVE SPEC

| Breakpoint | Landing | Onboarding | Signup/Login |
|---|---|---|---|
| < 480px | Single column, stacked CTAs | Single column, full-width chips | Card = full screen, no border radius |
| 480–768px | Single column, centered | Centered card, 2-col chips | Card 440px, centered |
| > 768px | 2-col (copy + demo) | Centered 480px card | Card 480px, centered |

**Signup/Login on mobile:**
- Card takes full viewport (no margin, no border radius)
- Logo mark remains visible
- Keyboard pushes content up (no layout shift)
- Input font-size ≥ 16px (prevents iOS zoom)
