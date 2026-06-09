# BUSINESS OS V2
**Phase:** 39 — Frontend Rebuild Strategy
**Date:** 2026-06-07
**Status:** Specification — No code written
**Scope:** Work section screens — Contacts, Payments, Pipeline sub-screens. Backend unchanged.

---

## 1. OVERVIEW

The Business OS covers all customer-facing operational screens under the **Work** navigation group. These are the highest-value screens for daily operator use.

| New Screen | Old Component | Section |
|---|---|---|
| Contacts | `PaymentPanel.jsx` (CRM tab) | Work |
| Payments | `PaymentPanel.jsx` (payment tab) | Work |
| Pipeline | `Dashboard.jsx` | Work |
| Activity | `Logs.jsx` | Work |
| Reports | `ExecutiveReports.jsx` | Work |

The current `PaymentPanel.jsx` conflates CRM and payment link generation. V2 splits these into two focused screens that share the same underlying APIs.

---

## 2. CONTACTS SCREEN V2

### 2.1 Purpose

Full CRM contact list. Create, view, follow up, send payment links. Primary daily-use screen.

### 2.2 APIs Used (unchanged)

```javascript
getLeads()                              // GET /crm
createLead({ name, phone, service, dealValue, notes }) // POST /crm/lead
sendFollowUp(phone, message)            // POST /send-followup
testWhatsAppSend(phone, message)        // POST /whatsapp/send
generatePaymentLink({ amount, name, phone, description }) // POST /payment/link
```

### 2.3 Screen Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  Work › Contacts                                                 │
│                                                                  │
│  Contacts                          [ ⌥ Filter ] [ + New ]       │
│  1,247 leads · Last synced 2m ago                                │
│──────────────────────────────────────────────────────────────────│
│                                                                  │
│  [ 🔍 Search by name, phone, service… ]  [ Status ▾ ] [ Tag ▾ ] │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │  Name            Phone          Service     Value  Status│     │
│  │──────────────────────────────────────────────────────────│     │
│  │  Raj Kumar       +91-98XXXXXX  Website      ₹15k  ● New │     │
│  │    [ WhatsApp ] [ Payment Link ] [ View ]               │     │
│  │──────────────────────────────────────────────────────────│     │
│  │  Priya Sharma    +91-90XXXXXX  SEO Audit    ₹8k   ● Hot │     │
│  │  Arjun Singh     +91-87XXXXXX  App Dev      ₹45k  ● Won │     │
│  │  ...                                                     │     │
│  └─────────────────────────────────────────────────────────┘     │
│                                                                  │
│  [ Load more ]                                                   │
└──────────────────────────────────────────────────────────────────┘
```

### 2.4 Contact Row Design

Each row is a card-styled row (not a table — better for mobile):

```
┌─────────────────────────────────────────────────────────┐
│ [Avatar initials]  Name             ● STATUS CHIP       │
│                    +91-XXXXXXXXXX   Service · ₹Value    │
│                    Note preview (if any)                │
│                                                         │
│  [ WhatsApp ↗ ]  [ ₹ Payment Link ]  [ View → ]        │
└─────────────────────────────────────────────────────────┘
```

- Avatar: 2-letter initials, randomized accent color per name hash
- Status chip colors: New=violet, Hot=amber, Qualified=teal, Won=green, Lost=dim
- "WhatsApp ↗" button: opens WhatsApp web in new tab with pre-filled message
- "Payment Link" button: opens PaymentLinkModal (inline, see 2.6)
- "View →" button: opens ContactDetailDrawer (side panel, see 2.7)
- Actions only visible on hover (desktop) or always visible (mobile)

### 2.5 Add New Contact Modal

Triggered by "+ New" button. Inline modal:

```
┌──────────────────────────────────┐
│  New Contact                 [✕] │
│                                  │
│  Full Name *                     │
│  [ ─────────────────────────── ] │
│                                  │
│  Phone *  (+91 prefix shown)     │
│  [ ─────────────────────────── ] │
│                                  │
│  Service / Product               │
│  [ ─────────────────────────── ] │
│                                  │
│  Deal Value (₹)                  │
│  [ ─────────────────────────── ] │
│                                  │
│  Notes                           │
│  [ ─────────────────── ↕ ]       │
│                                  │
│  [ Cancel ]  [ Add Contact → ]   │
└──────────────────────────────────┘
```

Fields mirror `POST /crm/lead` body: `{ name, phone, service, dealValue, notes }`.
Validation: name required, phone required (numeric 10 digits for IN).
Success: row appears at top of list with `slide-up-enter` animation.

### 2.6 Payment Link Modal

Triggered from contact row OR standalone from Quick Actions.
Pre-fills name/phone if triggered from contact row.

```
┌──────────────────────────────────┐
│  Generate Payment Link       [✕] │
│                                  │
│  Customer Name                   │
│  [ Raj Kumar                   ] │
│                                  │
│  Phone                           │
│  [ +91-9876543210              ] │
│                                  │
│  Amount (₹)                      │
│  [ 15000                       ] │
│                                  │
│  Description                     │
│  [ Website redesign — 50%      ] │
│                                  │
│  [ Generate Link → ]             │
│                                  │
│  ── Result ──────────────────── │
│  ✓  Link created:               │
│  https://rzp.io/l/XXXXXXXX      │
│  [ Copy ] [ WhatsApp ]           │
└──────────────────────────────────┘
```

Success state shows link with Copy and WhatsApp share buttons.
Error state (Razorpay 401): same rich error block as UpgradeModal — "Payment processing unavailable. Email billing@ooplix.com."

### 2.7 Contact Detail Drawer

Opens as a right-side panel (400px wide on desktop, full-screen on mobile) without navigating away.

```
┌────────────────────────────────────────────┐
│  [←]  Raj Kumar                       [✕] │
│────────────────────────────────────────────│
│                                            │
│  [Avatar large]                            │
│  Raj Kumar                                 │
│  +91-9876543210                            │
│  Status: ● New → [ Update Status ▾ ]       │
│                                            │
│  ── Details ─────────────────────────────  │
│  Service      Website Redesign             │
│  Deal Value   ₹15,000                      │
│  Added        3 days ago                   │
│  Notes        "Looking for mobile-first..."│
│                                            │
│  ── Actions ─────────────────────────────  │
│  [ WhatsApp ↗ ]                            │
│  [ Generate Payment Link ]                 │
│  [ Send Follow-up ]                        │
│                                            │
│  ── Follow-up History ───────────────────  │
│  Jun 4 — "Sent intro message"              │
│  Jun 3 — "Added to pipeline"               │
└────────────────────────────────────────────┘
```

Follow-up History: sourced from `GET /runtime/history?n=100` filtered by phone match.
"Send Follow-up" opens a pre-filled WA message modal.

### 2.8 Search & Filter

- Search: client-side on loaded leads (name, phone, service)
- Status filter: dropdown with chip-style options (All / New / Hot / Qualified / Won / Lost)
- Filter state managed in URL hash: `/#/work/contacts?status=hot&q=raj`

---

## 3. PAYMENTS SCREEN V2

### 3.1 Purpose

Dedicated screen for payment link generation and WhatsApp follow-up dispatch. Separate from Contacts to focus operator on revenue actions.

### 3.2 APIs Used (unchanged)

```javascript
generatePaymentLink({ amount, name, phone, description }) // POST /payment/link
sendFollowUp(phone, message)                              // POST /send-followup
testWhatsAppSend(phone, message)                          // POST /whatsapp/send
getLeads()                                                // GET /crm (for quick contact select)
```

### 3.3 Screen Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  Work › Payments                                                 │
│                                                                  │
│  Payments                                   [ History ]          │
│  Generate links, send follow-ups                                 │
│──────────────────────────────────────────────────────────────────│
│                                                                  │
│  ┌──────────────────────────────────┐  ┌───────────────────────┐ │
│  │                                  │  │                       │ │
│  │  PAYMENT LINK GENERATOR          │  │  WHATSAPP FOLLOW-UP   │ │
│  │  ─────────────────────────────   │  │  ─────────────────    │ │
│  │                                  │  │                       │ │
│  │  Customer (optional)             │  │  Phone number         │ │
│  │  [ Search contacts… ]            │  │  [+91-              ] │ │
│  │                                  │  │                       │ │
│  │  Amount (₹) *                    │  │  Message              │ │
│  │  [ ────────────── ]              │  │  [ Pre-built      ▾ ] │ │
│  │                                  │  │  or type custom:      │ │
│  │  Description                     │  │  [ ────────────── ]   │ │
│  │  [ ────────────── ]              │  │                       │ │
│  │                                  │  │  [ Send WhatsApp ]    │ │
│  │  [ Generate Link → ]             │  │                       │ │
│  │                                  │  │  ─────────────────    │ │
│  │  ── Generated Links ──────────── │  │  RECENT FOLLOW-UPS    │ │
│  │  Jun 6 — Raj · ₹15k  [Copy]      │  │  ─────────────────    │ │
│  │  Jun 5 — Priya · ₹8k  [Copy]     │  │  Raj Kumar — 2h ago  │ │
│  │                                  │  │  Priya — yesterday   │ │
│  └──────────────────────────────────┘  └───────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

### 3.4 Payment Link Generator Panel

Same fields as modal version (Contact, Amount, Description).
On success: persists link in a "Generated Links" list (localStorage or session).
Copy button: `navigator.clipboard.writeText(url)` with "Copied!" toast.
WhatsApp share: opens `https://wa.me/{phone}?text=...` in new tab.

Razorpay error: same rich error block as V1 — no change to error handling logic.

### 3.5 WhatsApp Follow-up Panel

Template dropdown: pre-built message options:
- "Follow-up — Check in (casual)"
- "Follow-up — Payment reminder"
- "Follow-up — Proposal send"
- "Custom message"

Selecting a template pre-fills textarea. Custom option = blank.

"Send WhatsApp": calls `testWhatsAppSend(phone, message)` → `POST /whatsapp/send`.
Success: green toast "Message sent to +91-XXXXXXXXXX".
Error: red toast with error detail.

Recent Follow-ups: sourced from `GET /runtime/history` filtered by type=whatsapp.

---

## 4. REPORTS SCREEN V2

### 4.1 Purpose

Executive summary view. Currently `ExecutiveReports.jsx` is partial. In V2:
- Show what data is available from existing APIs
- Mark upcoming analytics with "Coming Soon" banner
- No fake data

### 4.2 APIs Used

```javascript
getStats()              // GET /stats
getOpsData()            // GET /ops
getLeads()              // GET /crm (for summary counts)
getEnterpriseDashboard() // GET /enterprise/dashboard (if available)
```

### 4.3 Screen Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  Work › Reports                                                  │
│                                                                  │
│  Reports                           [ Export PDF ] (coming soon) │
│  Executive summary · June 2026                                   │
│──────────────────────────────────────────────────────────────────│
│                                                                  │
│  ◎ Advanced reporting — Coming Soon                              │
│  Export, scheduling, and team sharing are under development.     │
│  Current data available below.                                   │
│                                                                  │
│  ── THIS WEEK ──────────────────────────────────────────────     │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐        │
│  │ Leads Added   │  │ Revenue       │  │ Messages Sent │        │
│  │  48           │  │  ₹1,42,000   │  │  847          │        │
│  └───────────────┘  └───────────────┘  └───────────────┘        │
│                                                                  │
│  ── PIPELINE BREAKDOWN ─────────────────────────────────────     │
│  [Horizontal bar chart — same as Pipeline screen]                │
│                                                                  │
│  ── SYSTEM PERFORMANCE ─────────────────────────────────────     │
│  Uptime this week: 99.8%                                         │
│  Tasks executed: 1,240                                           │
│  Avg response time: 320ms                                        │
└──────────────────────────────────────────────────────────────────┘
```

### 4.4 Data Sources

| Widget | Source |
|---|---|
| Leads Added | `GET /stats → leads_this_week` |
| Revenue | `GET /stats → revenue_this_week` |
| Messages Sent | `GET /stats → messages_today` (display as week from localStorage) |
| Pipeline Breakdown | `GET /crm` (client-side group by status) |
| Uptime | `GET /ops → uptime_seconds` |
| Tasks Executed | `GET /ops → queue.total_completed` |
| Avg Response | `GET /metrics → avg_response_ms` |

---

## 5. RESPONSIVE DESIGN

| Screen | Mobile (< 768px) | Desktop (> 768px) |
|---|---|---|
| Contacts | Single column, full-width rows | Table-like rows, filter sidebar |
| Payments | Stack generator/follow-up vertically | 2-column side-by-side |
| Reports | Single column | 3-column metric cards |

Contact Detail Drawer:
- Mobile: full-screen overlay
- Desktop: 400px right-side panel, main list shrinks to remaining width

---

## 6. EMPTY STATES

**Contacts — empty:**
```
    [Users icon — 32px]
    No contacts yet
    Add your first lead to start tracking deals and sending follow-ups.
    [ + Add First Contact ]
```

**Payments — no links yet:**
```
    [CreditCard icon — 32px]
    No payment links generated yet
    Generate your first link to start collecting payments.
```

**Reports — insufficient data:**
```
    [BarChart2 icon — 32px]
    Not enough data yet
    Reports will populate once you've been active for 7+ days.
```
