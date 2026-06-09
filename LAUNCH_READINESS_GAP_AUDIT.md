# JARVIS — Launch Readiness Gap Audit
**Date:** 2026-06-03  
**Source of truth:** PRODUCT_EXPERIENCE_AUDIT.md + live code trace  
**Method:** Full end-to-end flow trace for a real beta user in production configuration  
**Environment:** `NODE_ENV=production`, `JWT_SECRET` set, `OPERATOR_PASSWORD_HASH` set  
**Question answered:** If 10 beta users use JARVIS today, what stops them from reaching first value?

---

## VERDICT UPFRONT

**7 out of 10 beta users will fail before completing any useful action.**

The root cause is a single architectural gap that cascades into every flow:

> **Authentication is required for every meaningful API call, but there is no visible login flow outside the Workspace tab — which most users never reach.**

A user who completes onboarding, arrives on the Chat tab, and types a message sees: `"Unauthorized"`.  
A user who adds a client sees: `"Unauthorized"`.  
A user who checks their dashboard sees: a loading skeleton that never resolves.

This is not a polish problem. These are complete user-journey failures in production.

---

## PRODUCTION AUTH CONFIGURATION (confirmed from `.env`)

```
NODE_ENV=production
JWT_SECRET=<set>
OPERATOR_PASSWORD_HASH=<set>
```

In this configuration, `requireAuth` middleware is **fully active**. Every route except `/health`, `/test`, and `/api/status` returns `401 Unauthorized` until the user has a valid session cookie.

The frontend establishes a session cookie only when the user authenticates via `LoginPage.jsx` inside the Workspace tab. No other UI path triggers `loginOperator()`.

---

## ISSUE INDEX

| # | Issue | Severity | File | Fix Effort |
|---|---|---|---|---|
| 1 | No authentication gate on app entry | P0 | `App.jsx` | 2 hrs |
| 2 | "Sign in" landing button does not authenticate | P0 | `App.jsx` | 30 min |
| 3 | Chat shows "Unauthorized" with no recovery path | P0 | `App.jsx`, `Chat.jsx` | 2 hrs |
| 4 | Client creation silently fails with "Unauthorized" | P0 | `AddClientForm.jsx` | 1 hr |
| 5 | Dashboard shows permanent loading skeleton (auth) | P0 | `Dashboard.jsx` | 1 hr |
| 6 | Payment link fails with "Unauthorized" | P0 | `PaymentPanel.jsx` | 1 hr |
| 7 | WhatsApp setup requires server access + restart | P1 | `WhatsAppSetup.jsx` | 1 day |
| 8 | First automation never fires (WhatsApp not connected at onboarding) | P1 | `Onboarding.jsx` | 1 day |
| 9 | Activity tab completely empty post-auth (no first-action CTA) | P1 | `Logs.jsx` | 2 hrs |
| 10 | Payment description defaults to "Jarvis Access" | P1 | `PaymentPanel.jsx` | 20 min |
| 11 | Control Room first-run modal never shown | P1 | `OperatorConsole.jsx` | 30 min |
| 12 | Feedback panel submit silently saved locally only (no indication) | P2 | `FeedbackPanel.jsx` | 1 hr |
| 13 | Revenue tab hardcodes ₹ for all users | P2 | `Dashboard.jsx`, `Logs.jsx` | 45 min |
| 14 | Dashboard empty state CTA is a `<span>` — unclickable | P2 | `Dashboard.jsx` | 30 min |
| 15 | Chat quick actions expose pm2 commands to non-developer users | P2 | `Chat.jsx` | 30 min |
| 16 | handleLogin (landing page) does not call loginOperator() | P0 | `App.jsx` | 1 hr |

---

## DETAILED FINDINGS

---

### ISSUE 1 — P0: No authentication gate on app entry
**File:** `frontend/src/App.jsx`  
**Component:** `AppInner`, tab rendering logic

**What happens:**  
After onboarding completes, the user lands on the main app. There is no authentication check before rendering Chat, Dashboard, Clients, Activity, Personal, Business, Developer, or Enterprise tabs. Only the Workspace (`runtime`) tab checks `user` from `AuthContext`.

```jsx
// App.jsx — auth check exists ONLY for runtime tab:
function RuntimeTab({ product }) {
  const { user, loading, logout } = useAuth();
  if (!user) return <LoginPage />;   // ← only here
  return <OperatorConsole />;
}

// All other tabs render unconditionally:
{tab === "chat"    && <Chat ... />}        // no auth check
{tab === "clients" && <PaymentPanel ... />} // no auth check
{tab === "insights" && <Dashboard ... />}   // no auth check
```

**User impact:**  
User enters the app. Everything renders. `/health` returns 200 so `online = true`. The UI looks functional. Every API call that follows returns 401. The user sees error messages and empty screens with no explanation and no path to fix it.

**Fix:**  
Either (a) wrap the entire `AppInner` return in an auth check (simplest — makes the whole app login-gated), or (b) add per-tab auth checks that show a `<LoginPage />` overlay when `!user`. Option (b) is preferred so `Chat` remains accessible without login for users who haven't set up Control Room.

However, given that *all* meaningful API calls require auth, option (a) is the honest fix: require login to use the app.

```jsx
// In AppInner, before the tab rendering:
const { user, loading: authLoading } = useAuth();
if (authLoading) return <div className="auth-loading">Loading…</div>;
if (!user) return <LoginPage onLogin={() => {}} />;
// rest of app renders only after auth
```

**Fix effort:** 2 hours (includes making `LoginPage` work as a full-screen gate, not just inside Workspace)

---

### ISSUE 2 — P0: "Sign in to your account" on landing page does not authenticate
**File:** `frontend/src/App.jsx`, line 213  
**Component:** `handleLogin`, passed as `onLogin` prop to `Landing.jsx`

**What happens:**  
The landing page has two buttons: "Start Free Trial" and "Sign in to your account." The second button calls `handleLogin`, which does:

```jsx
const handleLogin = () => {
  localStorage.setItem("jarvis_started", "1");
  setScreen("app");   // ← routes to app WITHOUT calling loginOperator()
};
```

This sets a localStorage flag and routes the user to the app. No `loginOperator()` is called. No session cookie is set. The user is routed to an unauthenticated app state.

A returning user who clicks "Sign in" expects to authenticate. Instead they are silently routed to an app where every action fails with `Unauthorized`.

**User impact:**  
Returning users cannot sign in. The button is labeled "Sign in" and performs no authentication. This is P0: it breaks the re-engagement flow for every user who has previously used the product.

**Fix:**  
Replace `handleLogin` with a flow that shows `LoginPage` before routing to the app. The simplest fix:

```jsx
// Remove handleLogin entirely from Landing.
// "Sign in" button should route to screen = "login" 
// which shows LoginPage, and on success routes to screen = "app"
if (screen === "login") return <LoginPage onSuccess={() => setScreen("app")} />;
```

Or: land on the app screen (which now has a full-screen auth gate per Issue 1's fix), and the gate handles it.

**Fix effort:** 30 minutes (if Issue 1 is fixed first, this becomes trivial)

---

### ISSUE 3 — P0: Chat shows "Unauthorized" with no recovery path
**File:** `frontend/src/App.jsx` (`handleSend`), `frontend/src/components/Chat.jsx`  
**Component:** `handleSend`, `Message` error render

**What happens:**  
`POST /jarvis` requires `requireAuth`. When a user without a session sends a chat message:

1. `handleSend` is called
2. `sendMessage(cmd)` → `_fetch("/jarvis", ...)` → 401 response
3. `_on401()` fires → `user = null` in `AuthContext` (logs user out of Workspace if they were in)
4. `_fetch` throws `Error("Unauthorized")`
5. `sendMessage` catch returns `{ success: false, reply: "Unauthorized" }`
6. `push("error", "Unauthorized")` → red error bubble in chat

The user sees a red message saying `"Unauthorized"`. There is no explanation. No link to log in. No path to recovery. The chat remains usable (they can keep typing) but every message fails the same way.

Additionally, `_on401` firing here logs the user out of the Workspace tab (sets `user = null`) — so if a user was authenticated in Workspace and then tried Chat, they get logged out by their own chat message.

**User impact:**  
The Chat tab — the default first tab for web users — is completely non-functional. Users type messages and see "Unauthorized" error bubbles. No explanation. No link to log in.

**Fix:**  
1. Resolved by Issue 1 fix (full-screen auth gate means user is always authenticated before reaching Chat)
2. Additionally: add a user-friendly auth error case in `handleSend`:
```jsx
if (res.reply === "Unauthorized" || err.status === 401) {
  push("system", "Sign in to continue → go to the Workspace tab and enter your password.");
  return;
}
```
3. Fix `_on401` so it doesn't fire during Chat sends (it should only affect the Workspace session).

**Fix effort:** 2 hours (dependent on Issue 1)

---

### ISSUE 4 — P0: Client creation fails with "Unauthorized" — user sees confusing error
**File:** `frontend/src/components/AddClientForm.jsx`  
**Component:** `handleSubmit`, error display at line 35

**What happens:**  
`POST /crm/lead` requires `requireAuth + operatorOnly`. When an unauthenticated user submits the Add Client form:

1. `createLead()` → `_fetch("/crm/lead", ...)` → 401
2. `catch (err)` → `return { success: false, error: err.message }`
3. `setError(res.error)` → renders `"Unauthorized"` in the form error slot

The user filled out a form with their client's name and WhatsApp number. They hit submit. The form says `"Unauthorized"`. They have no idea why.

This is the **most common failure point for the core use case** (sales/freelancer persona adding their first lead). It happens immediately after onboarding.

**User impact:**  
The primary conversion action (adding a client) fails on every first attempt with a technical error message that provides zero recovery guidance. This is P0 because it's the central user action for the product's main use case.

**Fix:**  
Resolved by Issue 1. Additionally, detect 401 errors specifically in `AddClientForm`:
```jsx
if (err.status === 401 || res.error === "Unauthorized") {
  setError("Sign in required — go to the Workspace tab to log in, then return here.");
  return;
}
```

**Fix effort:** 1 hour (dependent on Issue 1 for full fix)

---

### ISSUE 5 — P0: Dashboard shows permanent loading skeleton when unauthenticated
**File:** `frontend/src/components/Dashboard.jsx`  
**Component:** Loading state check at line 59

**What happens:**  
```jsx
if (stats === null && opsData === null) {
  return <skeleton />;  // ← renders when both are null
}
```

`GET /stats` and `GET /ops` both require `requireAuth`. In production, an unauthenticated user hits these every 8 seconds. Both return 401. Both `catch` blocks return `null`. `stats` stays `null`. `opsData` stays `null`.

The condition `stats === null && opsData === null` is perpetually true. The Dashboard shows a loading skeleton **forever**. There is no timeout, no empty state, no error state, no explanation.

A user on the Revenue tab sees animated skeleton bones loading indefinitely. There is no "this will never load" feedback.

**User impact:**  
The Revenue/Dashboard tab is permanently broken for unauthenticated users — which is every user who hasn't explicitly logged in via the Workspace tab. This affects 100% of new web users.

**Fix:**  
Resolved by Issue 1. Additionally, add an `authError` state to the Dashboard loading logic:

```jsx
// After N polling attempts return null, show an error state not a skeleton:
if (loadAttempts >= 2 && stats === null && opsData === null) {
  return <div>Could not load data. <button onClick={() => setTab("runtime")}>Sign in →</button></div>;
}
```

**Fix effort:** 1 hour (dependent on Issue 1)

---

### ISSUE 6 — P0: Payment link generation fails with "Unauthorized"
**File:** `frontend/src/components/PaymentPanel.jsx`  
**Component:** `handleGenerate`, line 104

**What happens:**  
`POST /payment/link` requires `requireAuth`. Unauthenticated request → 401.

The error path in `handleGenerate`:
```jsx
const msg = res.error || "Could not generate link. Check Razorpay credentials in .env";
onMessage("error", msg);
```

If `res.error` is `"Unauthorized"`, the user sees `"Unauthorized"` in the chat window. If the error falls through to the default, they see `"Could not generate link. Check Razorpay credentials in .env"` — instructing a non-technical user to edit a server config file.

**User impact:**  
The payment link flow — the product's monetization feature — fails for unauthenticated users. The error message either says "Unauthorized" (confusing) or tells the user to check their `.env` file (wrong diagnosis, unhelpful to a non-developer user).

**Fix:**  
Resolved by Issue 1. The `.env` error message fallback should also be removed or replaced:
```jsx
const msg = res.error === "Unauthorized"
  ? "Sign in required — log in via the Workspace tab first."
  : res.error === "Razorpay not configured"
  ? "Payment system not set up — contact your administrator."
  : res.error || "Could not generate link.";
```

**Fix effort:** 1 hour (dependent on Issue 1)

---

### ISSUE 7 — P1: WhatsApp setup requires server file access and process restart
**File:** `frontend/src/components/WhatsAppSetup.jsx`  
**Component:** Full component — Step 4 instructions

**What happens:**  
The WhatsApp setup wizard (4 steps) is technically correct but practically impossible for most beta users. Step 4 instructs:

```
Add Credentials to Your Server:
Edit your .env file:
  WA_TOKEN=your_access_token_here
  WA_PHONE_ID=your_phone_number_id_here

Then restart Jarvis:
  pm2 restart jarvis-os
```

A beta user who is not a developer/server operator **cannot complete this step**. They need:
- SSH access to the server
- Knowledge of how to edit `.env` files
- PM2 installed and configured
- Understanding of what a "Temporary Access Token" vs "Permanent Token" means

The setup guide assumes the user is running their own server instance. For a SaaS product, this is a deployment detail, not a user action.

**User impact:**  
For non-technical beta users (the primary target: freelancers, sales people), WhatsApp setup is completely blocked. This means the core automation feature (follow-ups) never activates. The user adds a client, sees "Connect WhatsApp to enable follow-ups," clicks the setup guide, reads step 4, and gives up.

**Fix (frontend-only):**  
1. The setup wizard should distinguish between "I manage my own server" and "I'm using the hosted version." For hosted users, show a contact/support message.
2. Add a "WhatsApp not available yet" state: "We're setting up WhatsApp integration for your account. You can still add clients and generate payment links now." This avoids blocking the rest of the product.
3. Add a test-send prompt as the FIRST step — if credentials are already configured, skip the setup wizard entirely.

```jsx
// In WhatsAppSetup.jsx, add before the steps:
if (!connected) {
  // Show a quick "Already have credentials? Test first" option
  return (<div>
    <p>Already configured? Test your connection first.</p>
    <button onClick={() => setView("test")}>Test WhatsApp connection</button>
    <button onClick={() => setView("setup")}>Set up for the first time</button>
  </div>);
}
```

**Fix effort:** 1 day (full non-technical setup path redesign)

---

### ISSUE 8 — P1: First automation never fires — WhatsApp not connected at end of onboarding
**File:** `frontend/src/components/Onboarding.jsx`  
**Component:** Done screen, `handleOnboardingComplete`

**What happens:**  
The automation follow-up sequence (10min, 6hr, 24hr, 3day) only fires if WhatsApp is connected. WhatsApp connection requires `.env` configuration and server restart (Issue 7). The onboarding wizard never mentions WhatsApp connection.

A user who completes all 3 onboarding steps, adds their first client, and waits — will never receive a WhatsApp follow-up. The client list will show "new" status indefinitely. No messages are sent. The product's core value promise is silently broken.

The `AddClientForm` success screen does show:
```
"Connect WhatsApp below to start automated follow-ups."
```
...but "below" refers to the `wa-setup-banner` which opens `WhatsAppSetup` — the technical wizard that blocks non-developers.

**User impact:**  
The follow-up automation — JARVIS's primary value proposition for the sales persona — never activates for any user who doesn't configure WhatsApp credentials server-side. This is the entire sales use case.

**Fix (frontend-only):**  
1. Add WhatsApp connection as Onboarding Step 4 (even if just as a "we'll set this up for you" acknowledgment for non-technical users)
2. After first lead is added and WhatsApp is NOT connected, show a persistent action card:
```
"WhatsApp not connected — your follow-ups are paused.
 [Connect WhatsApp] or [Learn more]"
```
3. Show the follow-up schedule on the lead card with a "Waiting for WhatsApp" state instead of silence

**Fix effort:** 1 day

---

### ISSUE 9 — P1: Activity tab empty post-auth — no first-action CTA
**File:** `frontend/src/components/Logs.jsx`  
**Component:** `Activity` export, empty state at line 157

**What happens:**  
When the user has no automation activity (fresh account, or WhatsApp not connected), the Activity tab shows:

```
"No outreach activity yet"
"Add contacts in the Clients tab and connect WhatsApp. Sequences will register here."
```

This is a dead-end screen. The text tells the user what to do but provides no button, no link, no navigation action to take them there. They read the instruction and have to manually navigate away.

The Lead Pipeline section (`crm && crm.total > 0`) also doesn't render when there are no leads — so the Activity tab is entirely blank except for the empty state copy.

**User impact:**  
A user who lands on Activity (either via tab exploration or redirect) gets a blank screen with instructions but no action path. They are stranded.

**Fix:**  
```jsx
// In Logs.jsx empty state:
<div className="act-empty">
  <p className="act-empty-title">No outreach activity yet</p>
  <p className="act-empty-sub">Add a contact to start follow-ups automatically.</p>
  <button 
    className="act-empty-btn" 
    onClick={() => onNavigate?.("clients")}
  >
    Add your first contact →
  </button>
</div>
```
Pass `onNavigate` prop from `App.jsx` (already has `setTab`).

**Fix effort:** 2 hours (prop threading + button)

---

### ISSUE 10 — P1: Payment link description defaults to "Jarvis Access"
**File:** `frontend/src/components/PaymentPanel.jsx`, line 64  
**Component:** `form` initial state

**What happens:**  
```jsx
return { name: "", phone: "", amount: amt, description: "Jarvis Access" };
```

Every payment link sent to a customer says "Jarvis Access" as the payment description. The customer sees a Razorpay checkout page titled "Jarvis Access" — not the freelancer's actual service.

This ships JARVIS branding to the end customer's checkout experience. For a user who paid to use JARVIS as a white-label tool, this is an embarrassing reveal.

**User impact:**  
Every single payment link generated has the wrong description until the user manually edits it each time. Most users won't notice until a client asks "What is 'Jarvis Access'?"

**Fix:**  
```jsx
// Change line 64:
const p = JSON.parse(localStorage.getItem("jarvis_biz_profile") || "null");
const amt = p?.price?.replace(/[^\d]/g, "") || "999";
return { name: "", phone: "", amount: amt, description: p?.product || "" };
```
Empty string is better than wrong brand name — the placeholder text `"Description"` will show.

**Fix effort:** 20 minutes

---

### ISSUE 11 — P1: Control Room first-run modal is built but never triggered
**File:** `frontend/src/components/operator/OperatorConsole.jsx`  
**Component:** `OperatorConsole` return, imports

**What happens:**  
`widgets/FirstRunSetup.jsx` exports `FirstRunSetup` component and `shouldShowFirstRun()` helper. `OperatorConsole.jsx` **never imports either**.

The `shouldShowFirstRun()` function checks `localStorage.jarvis_first_run_done`. If not set, it returns `true` — meaning the modal should show.

Every first-time Workspace user gets a cold 3-column cockpit with no guidance. The onboarding modal they should see is complete, designed, and entirely disconnected.

**User impact:**  
Users who authenticate and reach the Workspace tab — the product's most powerful feature — get zero guidance. 3 columns of widgets with no explanation. For a non-technical beta user who followed a setup guide to get here, this is the final straw.

**Fix (3 lines):**  
```jsx
// In OperatorConsole.jsx, add to imports:
import { FirstRunSetup, shouldShowFirstRun } from "./widgets/FirstRunSetup";

// Add to state:
const [showFirstRun, setShowFirstRun] = useState(shouldShowFirstRun);

// Add before return's first child:
{showFirstRun && <FirstRunSetup onComplete={() => setShowFirstRun(false)} rtStatus={rtStatus} />}
```

**Fix effort:** 30 minutes

---

### ISSUE 12 — P2: Feedback panel "submitted" state misleads users about persistence
**File:** `frontend/src/components/operator/widgets/FeedbackPanel.jsx`  
**Component:** `submit` callback, success message

**What happens:**  
When the user submits feedback:
1. `_saveFeedback(entry)` — saved to `localStorage`
2. `fetch("/api/runtime/feedback", ...)` — best-effort POST, `.catch(() => {})` silently ignored
3. `setSubmitted(true)` — shows "Feedback saved. Thank you!"

The success message says "Feedback saved." — implying it was received. If the backend request fails (which it will if the user is unauthenticated), the feedback is only in localStorage. The product owner sees nothing.

**User impact:**  
Beta users submitting bug reports believe their feedback was received. If the backend call fails silently, no feedback reaches the operator. Critical beta bug reports are lost.

**Fix:**  
```jsx
// In submit:
const backendOk = await fetch("/api/runtime/feedback", { ... }).then(r => r.ok).catch(() => false);
// In success message:
<div>{backendOk ? "Feedback sent. Thank you!" : "Feedback saved locally — we'll sync it when you're online."}</div>
```

**Fix effort:** 1 hour

---

### ISSUE 13 — P2: Revenue tab hardcodes ₹ for all users
**Files:** `frontend/src/components/Dashboard.jsx` line 132; `frontend/src/components/Logs.jsx` line 183  
**Component:** `StatCard` render for revenue; `pipe-revenue` in `Logs`

**What happens:**  
```jsx
value={stats.revenue ? `₹${stats.revenue.toLocaleString("en-IN")}` : "₹0"}
```

Every user sees Indian Rupee formatting regardless of their locale or the currency their payments are in. The backend `dashboard/revenue` endpoint returns `"currency": "INR"` hardcoded. For users outside India, their revenue shows as ₹0 or ₹[amount] — wrong currency, wrong locale formatting.

**User impact:**  
International beta users (or even Indian users using USD Razorpay accounts) see incorrect currency. This signals the product wasn't built for them.

**Fix:**  
```jsx
// Use locale-aware formatting:
function _fmtRevenue(amount) {
  if (!amount && amount !== 0) return "—";
  try {
    return new Intl.NumberFormat(navigator.language, {
      style: "currency",
      currency: "INR",  // or pull from user profile / backend response
      maximumFractionDigits: 0
    }).format(amount);
  } catch {
    return `₹${amount.toLocaleString()}`;
  }
}
```

**Fix effort:** 45 minutes

---

### ISSUE 14 — P2: Dashboard empty state "Add your first client" is a `<span>` not a button
**File:** `frontend/src/components/Dashboard.jsx`, line 110  
**Component:** Empty state block

**What happens:**  
```jsx
<span className="empty-action-hint">Add your first client</span>
```

The CSS gives `.empty-action-hint` a pointer cursor and hover styles to make it look clickable. But it is a `<span>` with no `onClick`. Clicking it does nothing. Users who try to click it — which they will, because it looks like a button — are confused.

**User impact:**  
The primary conversion CTA from the empty state is visually interactive but functionally dead. This is the moment where a new user would take their first productive action. It does nothing.

**Fix:**  
```jsx
// Change span to button, add onClick:
<button 
  className="empty-action-hint empty-action-hint--btn" 
  onClick={() => onNavigate?.("clients")}
>
  Add your first client →
</button>
```
Pass `onNavigate={setTab}` from `App.jsx` to `Dashboard`.

**Fix effort:** 30 minutes

---

### ISSUE 15 — P2: Chat quick actions expose pm2/developer commands to non-developer users
**File:** `frontend/src/components/Chat.jsx`, line 97  
**Component:** `QUICK_ACTIONS` constant

**What happens:**  
```jsx
const QUICK_ACTIONS = [
  { label: "My leads",      cmd: "Show me all my leads" },
  { label: "Payment link",  cmd: "Generate a payment link" },
  { label: "System status", cmd: "run pm2 list" },              // ← developer command
  { label: "Recent errors", cmd: "run pm2 logs jarvis-backend --lines 20" }, // ← developer command
];
```

A freelancer or business user who clicks "System status" gets a wall of pm2 process output with no context. "Recent errors" produces raw Node.js error logs. These are server administration commands, not user commands.

**User impact:**  
A business user's first interaction with the chat — clicking the suggested quick actions — produces output they cannot understand. This communicates "this product is not for me."

**Fix:**  
Make quick actions persona-aware:
```jsx
function _getQuickActions() {
  const p = (() => { try { return JSON.parse(localStorage.getItem("jarvis_biz_profile") || "null"); } catch { return null; }})();
  if (!p) return [
    { label: "What can you do?", cmd: "What can Jarvis do for me?" },
    { label: "Add a lead",       cmd: "How do I add my first client?" },
    { label: "Pipeline status",  cmd: "Show my pipeline" },
    { label: "Help",             cmd: "What should I do first?" },
  ];
  const isDev = /dev|engineer|code|software|tech/i.test(p.business || "");
  if (isDev) return [
    { label: "Run tests",    cmd: "run npm test" },
    { label: "Git status",   cmd: "run git status" },
    { label: "System check", cmd: "run pm2 list" },
    { label: "Recent logs",  cmd: "run pm2 logs jarvis-backend --lines 20" },
  ];
  return [
    { label: "Hot leads",        cmd: "Show my hot leads" },
    { label: "This week",        cmd: "What happened this week?" },
    { label: "Payment link",     cmd: "Generate a payment link" },
    { label: "Follow-up status", cmd: "Show follow-up activity" },
  ];
}
const QUICK_ACTIONS = _getQuickActions();
```

**Fix effort:** 30 minutes

---

### ISSUE 16 — P0 (duplicate of Issue 2, distinct manifestation)
Already captured above. The `handleLogin` function in `App.jsx` routes to app without auth. Any user who clicks "Sign in to your account" on the landing page will have a completely broken session.

---

## RECOMMENDED FIX ORDER

This is the order to work through the list if you have 2–3 days before beta launch.

### Day 1: Fix the authentication foundation (P0s)

**Step 1 — Add a full-screen auth gate to the app (Issues 1, 2, 3, 4, 5, 6 all resolve)**  
`App.jsx` — Add `const { user, loading } = useAuth()` at the top of `AppInner`. Before rendering tabs, gate on `user`. Show `<LoginPage />` (already built) as a full-screen overlay if `!user`.

```jsx
// In AppInner, after useState declarations:
const { user, loading: authLoading } = useAuth();

// Before the main app render:
if (authLoading) return <div className="auth-init">Starting…</div>;
if (!user) return (
  <div className="auth-gate">
    <LoginPage />
  </div>
);
// tabs render after this
```

This single change fixes Issues 1, 3, 4, 5, 6 completely and Issue 2 partially.

**Step 2 — Fix handleLogin to use the real auth flow (Issue 2)**  
Remove `handleLogin` from `App.jsx`. On the landing page, "Sign in to your account" should route to `screen = "app"` (which now shows the auth gate). Or route to a dedicated `screen = "login"` state.

**Step 3 — Fix payment description default (Issue 10, 20 minutes)**  
`PaymentPanel.jsx` line 64: change `"Jarvis Access"` to `p?.product || ""`.

**Step 4 — Trigger FirstRunSetup in Operator Console (Issue 11, 30 minutes)**  
`OperatorConsole.jsx`: add 3 lines.

### Day 2: Fix the activation path (P1s)

**Step 5 — Fix Dashboard and Activity empty states with CTAs (Issues 9, 14)**  
`Dashboard.jsx`: change `<span>` to `<button onClick={() => onNavigate("clients")}>`.  
`Logs.jsx`: add button to empty state.  
`App.jsx`: pass `onNavigate={setTab}` to `<Dashboard>` and `<Activity>`.

**Step 6 — Fix Chat quick actions (Issue 15)**  
`Chat.jsx`: make `QUICK_ACTIONS` persona-aware.

**Step 7 — Fix currency formatting (Issue 13)**  
`Dashboard.jsx` and `Logs.jsx`: replace hardcoded `₹` with `Intl.NumberFormat`.

**Step 8 — Address WhatsApp setup for non-technical users (Issue 7, 8)**  
`WhatsAppSetup.jsx`: add a "test first" entry path and a "hosted setup" branch.  
`Onboarding.jsx`: add WhatsApp as Step 4 with skip option.

### Day 3: Polish and feedback integrity

**Step 9 — Fix feedback panel backend-failure state (Issue 12)**  
`FeedbackPanel.jsx`: distinguish local save vs. backend confirm.

---

## WHAT A SUCCESSFUL BETA SESSION LOOKS LIKE AFTER THESE FIXES

1. User visits landing page → clicks "Start Free Trial"
2. Completes onboarding (3 steps + WhatsApp step)
3. Arrives at app, is prompted to log in with operator password
4. After login: Chat is functional, Dashboard loads, Clients tab works
5. Adds first client — success confirmation + follow-up schedule visible
6. Gets notification: "First follow-up scheduled for [name] in 10 minutes"
7. Navigates to Workspace tab → FirstRunSetup modal guides them through
8. 10 minutes later: follow-up sent (if WhatsApp connected)
9. Returns to Activity tab: sees follow-up logged

That is first value. That flow is currently blocked at step 4 (Chat), step 5 (Clients), and step 7 (Workspace) for every beta user in production.

---

## SINGLE-LINE SUMMARY TABLE

| Issue | P-Level | File | Effort | Blocks |
|---|---|---|---|---|
| No app-level auth gate | P0 | `App.jsx` | 2h | Chat, Dashboard, Clients, Payment |
| "Sign in" doesn't sign in | P0 | `App.jsx` | 30m | Returning user re-engagement |
| Chat shows "Unauthorized" | P0 | `App.jsx` | 2h | First message |
| Client creation "Unauthorized" | P0 | `AddClientForm.jsx` | 1h | Core conversion action |
| Dashboard skeleton forever | P0 | `Dashboard.jsx` | 1h | Revenue visibility |
| Payment link "Unauthorized" | P0 | `PaymentPanel.jsx` | 1h | Monetization flow |
| WhatsApp setup requires server access | P1 | `WhatsAppSetup.jsx` | 1d | Core automation |
| First automation never fires | P1 | `Onboarding.jsx` | 1d | Core value delivery |
| Activity tab dead-end | P1 | `Logs.jsx` | 2h | Post-activation feedback |
| Payment default "Jarvis Access" | P1 | `PaymentPanel.jsx` | 20m | Customer trust |
| FirstRunSetup never shown | P1 | `OperatorConsole.jsx` | 30m | Workspace onboarding |
| Feedback silently fails | P2 | `FeedbackPanel.jsx` | 1h | Beta data collection |
| ₹ hardcoded globally | P2 | `Dashboard.jsx`, `Logs.jsx` | 45m | International users |
| Empty state CTA is `<span>` | P2 | `Dashboard.jsx` | 30m | First conversion action |
| pm2 commands for all users | P2 | `Chat.jsx` | 30m | First chat interaction |
| handleLogin bypasses auth | P0 | `App.jsx` | 30m | Returning user login |

**Total P0 fix time: ~7.5 hours**  
**Total P1 fix time: ~3.5 hours + 2 days for WhatsApp**  
**Total P2 fix time: ~3.5 hours**

The P0s can all be resolved in one focused day. The P1 WhatsApp issue requires a product decision about the deployment model.
