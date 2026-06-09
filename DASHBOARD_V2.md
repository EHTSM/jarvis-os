# DASHBOARD V2 — CONTROL CENTER
**Phase:** 39 — Frontend Rebuild Strategy
**Date:** 2026-06-07
**Status:** Specification — No code written
**Scope:** ControlCenter, Dashboard (Pipeline), Logs (Activity). Backend unchanged.

---

## 1. OVERVIEW

The Dashboard V2 covers three screens under the **Home** and **Work** navigation groups:

| New Screen | Old Tab | Component | Section |
|---|---|---|---|
| Control Center | `home` | `ControlCenter.jsx` | Home |
| Pipeline | `insights` | `Dashboard.jsx` | Work |
| Activity | `activity` | `Logs.jsx` | Work |

These three screens are the "command bridge" — they must always answer:
- **What is running right now?**
- **What needs my attention?**
- **What happened recently?**

---

## 2. CONTROL CENTER V2

### 2.1 Purpose

The Control Center is the app's home screen. It is the first thing the operator sees after login. It replaces the current `ControlCenter.jsx` with a more structured, real-time-first layout.

### 2.2 Screen Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  HEADER: [System Status Strip — always visible at top]          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  [PAGE HEADER]                                                  │
│  Control Center                      [● 3 active] [⚡ Command]  │
│  Today's operations · Fri 6 Jun                                 │
│                                                                 │
├──────────────────────┬──────────────────┬───────────────────────┤
│                      │                  │                       │
│  AI ENGINE           │  QUEUE           │  COMMUNICATIONS       │
│  ● Online            │  4 tasks running │  ● WhatsApp active    │
│  Model: Groq/Mixtral │  2 queued        │  12 leads followed up │
│  Avg: 320ms          │  0 failed        │  Last: 2m ago         │
│                      │                  │                       │
├──────────────────────┴──────────────────┴───────────────────────┤
│                                                                 │
│  TODAY'S METRICS                                                │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐   │
│  │  Leads    │  │  Revenue  │  │  Messages │  │  Tasks    │   │
│  │  124      │  │  ₹32,400  │  │  847      │  │  36       │   │
│  │ +12 today │  │ +₹8,200   │  │ +124/hr   │  │ 4 pending │   │
│  └───────────┘  └───────────┘  └───────────┘  └───────────┘   │
│                                                                 │
├─────────────────────────────────────┬───────────────────────────┤
│                                     │                           │
│  RECENT ACTIVITY                    │  QUICK ACTIONS            │
│  ─────────────────────────────────  │  ─────────────────────    │
│  ● Task dispatched — 30s ago        │  [ ⚡ Ask Jarvis ]        │
│  ● WhatsApp sent — Raj Kumar        │  [ + New Contact ]        │
│  ● Lead qualified — ₹15k deal       │  [ ₹ Payment Link ]       │
│  ● Agent completed — 2m ago         │  [ ⏹ Emergency Stop ]     │
│  [ See all activity → ]             │                           │
│                                     │  GETTING STARTED          │
│                                     │  ─────────────────────    │
│                                     │  [▓▓▓▓▓░] 5/6 done        │
│                                     │  ✓ Connected WhatsApp     │
│                                     │  ✓ Added first contact    │
│                                     │  ○ Set up payment...      │
│                                     │  [ View checklist ]       │
│                                     │                           │
└─────────────────────────────────────┴───────────────────────────┘
```

### 2.3 System Status Strip

Fixed top strip immediately below the app header. Shows 4 service status dots:

```
  ● AI   ● Queue  ● WhatsApp  ● Payments  |  Uptime: 36h  |  Memory: 312MB
```

- Each dot: live color from `GET /health` + `GET /ops`
- Uptime: from `opsData.uptime_seconds`
- Memory: from `opsData.memory_mb`
- Click on any service dot → opens service detail popover
- On emergency stop: strip turns red, shows "EMERGENCY STOP ACTIVE — [Resume]"

### 2.4 Service Health Tiles (3 tiles, top row)

**AI Engine Tile:**
- Status dot + "Online" / "Degraded" / "Error"
- Model name from `opsData.services.ai` (or "Groq/Mixtral")
- Average response time from `getMetrics()`
- Click → navigates to Build › DevOps for detailed AI metrics

**Queue Tile:**
- Running task count from `opsData.queue.running`
- Queued count from `opsData.queue.queued`
- Failed count from `opsData.queue.failed` (shown in red if > 0)
- Click → navigates to Work › Activity

**Communications Tile:**
- WhatsApp status from `opsData.services.whatsapp`
- Message count from `getStats().messages_today`
- Last message timestamp
- Click → navigates to Work › Contacts

### 2.5 Metric Cards (4 cards, second row)

| Metric | Source | Display |
|---|---|---|
| Leads | `GET /stats` → `stats.total_leads` | Count + delta today |
| Revenue | `GET /stats` → `stats.revenue_today` | INR formatted + delta |
| Messages | `GET /stats` → `stats.messages_today` | Count + rate/hr |
| Tasks | `GET /ops` → `queue.running + queue.queued` | Count + "N pending" |

Card design: `--card-bg`, `--card-border`, `--radius-lg`, padding 20px.
Value: `--text-h1`, bold. Delta: `--text-label`, colored green/red by sign.
Sparkline: 7-day trend line (SVG path, 48×24px), color matches delta.

Polling: every 15s (same as current).

### 2.6 Recent Activity Feed

Left-bottom panel. Shows last 5 events from `GET /runtime/history?n=20`.

Each row:
```
  ● [icon]  Event description — relative time
```

- Dot color matches event severity (green = success, amber = warning, red = error)
- Icon per event type: Zap (task), MessageSquare (WA), Users (lead), Bot (agent)
- Relative time: "30s ago" / "2m ago" / "1h ago"
- "See all activity →" → navigates to Work › Activity
- Max 5 rows, auto-refreshed every 10s

### 2.7 Quick Actions Panel

Right-bottom. Static action list, always visible:

```
⚡  Ask Jarvis          → opens Chat inline or Chat section
+   New Contact          → opens AddContactModal
₹   Generate Payment Link → opens PaymentLinkModal
⏹   Emergency Stop       → confirm dialog → POST /runtime/emergency/stop
```

Button style: full-width, `--btn-height-md`, ghost variant, left-aligned with icon.
Emergency Stop: ghost with red text, confirm required.

### 2.8 Getting Started Checklist

Only visible if `localStorage.jarvis_just_onboarded` OR checklist completion < 100%.
Shows progress bar + 6 milestone items. Dismissible ("Hide" link).
Same 6 items as current SuccessCenter.jsx.

---

## 3. PIPELINE V2

### 3.1 Purpose

Business metrics at a glance. Replaces `Dashboard.jsx` tab. Accessible via Work → Pipeline.

### 3.2 Screen Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  PAGE HEADER                                                     │
│  Pipeline                                      [ Export ] [↻]   │
│  Business performance · Last 7 days                              │
│──────────────────────────────────────────────────────────────────│
│                                                                  │
│  [ Today ] [ 7 days ] [ 30 days ] [ Custom ]                     │
│              ──────                                              │
│                                                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │ Total    │ │ New      │ │ Revenue  │ │ Conv.    │           │
│  │ Leads    │ │ This Week│ │ This Wk  │ │ Rate     │           │
│  │ 1,247    │ │ +48      │ │ ₹1.4L    │ │ 12.4%    │           │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘           │
│                                                                  │
│  LEADS BY STATUS                                                 │
│  ┌─────────────────────────────────────────────────┐            │
│  │  New (324) ██████████████████                   │            │
│  │  Qualified (198) ████████████                   │            │
│  │  Proposal (87) ██████                           │            │
│  │  Won (143) █████████                            │            │
│  │  Lost (32) ██                                   │            │
│  └─────────────────────────────────────────────────┘            │
│                                                                  │
│  SERVICE HEALTH                   │  TOP PERFORMERS              │
│  ─────────────────────────────    │  ──────────────────────      │
│  ● AI Engine      — 99.1% uptime  │  Source: WhatsApp  324 leads │
│  ● WhatsApp       — Active        │  Source: Referral  187 leads │
│  ● Payments       — Active        │  Tag: Hot          89 leads  │
│  ● Telegram       — Active        │                              │
│                                   │                              │
└───────────────────────────────────┴──────────────────────────────┘
```

### 3.3 Data Sources

| Widget | API | Field |
|---|---|---|
| Total Leads | `GET /stats` | `stats.total_leads` |
| New This Week | `GET /stats` | `stats.leads_this_week` |
| Revenue This Week | `GET /stats` | `stats.revenue_this_week` |
| Conversion Rate | `GET /stats` | `stats.conversion_rate` |
| Leads by Status | `GET /crm` | group by `status` |
| Service Health | `GET /ops` | `services.*` |

### 3.4 Time Filter

Controlled by period state (`today` / `7d` / `30d` / `custom`).
The API doesn't yet support time-filtered stats — display what's available, disable unused filters with "Coming soon" tooltip.

### 3.5 Leads by Status Bar Chart

Horizontal bar chart in pure CSS (no chart library — avoids bundle bloat).
Each bar: label + colored fill + count. Sorted by count descending.
Colors: New=violet, Qualified=teal, Proposal=amber, Won=green, Lost=dim.

### 3.6 Service Health

Live from `GET /ops → services`. Each row: dot + service name + uptime %.
Click on row → navigates to Build › DevOps for full service detail.

---

## 4. ACTIVITY V2

### 4.1 Purpose

Execution log. Replaces `Logs.jsx`. Accessible via Work → Activity.

### 4.2 Screen Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  PAGE HEADER                                                     │
│  Activity                                 [ ↻ Live ] [ Filter ] │
│  Execution log · Auto-refreshes every 15s                        │
│──────────────────────────────────────────────────────────────────│
│  [ All ] [ Tasks ] [ WhatsApp ] [ Agents ] [ Errors ]            │
│                                                                  │
│  Jun 6, 14:33:12  ● Task dispatched — "analyze leads"  SUCCESS   │
│    └─ Agent: jarvis-core   Duration: 1.2s   Tokens: 840          │
│                                                                  │
│  Jun 6, 14:31:04  ● WhatsApp sent — Raj Kumar           SUCCESS  │
│    └─ Phone: +91-98XXXXXXXX   Template: follow_up_1             │
│                                                                  │
│  Jun 6, 14:28:30  ● Lead qualified — Priya Sharma       SUCCESS  │
│    └─ Score: 87   Deal: ₹15,000   Assignee: —                   │
│                                                                  │
│  Jun 6, 14:20:11  ● Agent error — workflow_runner        ERROR   │
│    └─ Error: Timeout after 30s   Retries: 3                     │
│                                                                  │
│  [ Load more (15 remaining) ]                                    │
└──────────────────────────────────────────────────────────────────┘
```

### 4.3 Filter Tabs

- All: everything
- Tasks: `type === "task"`
- WhatsApp: `type === "whatsapp"`
- Agents: `type === "agent"`
- Errors: `status === "error" || status === "failed"`

Implemented client-side on `GET /runtime/history?n=100` response.

### 4.4 Log Row Design

Each log row:
```
[timestamp]  ● [icon]  [description] — [detail]    [STATUS CHIP]
  └─ [metadata line: key: value pairs]
```

- Timestamp: `--text-mono`, `--text-tertiary`, 13px
- Icon: 14px Lucide icon colored by type (Zap/MessageSquare/Users/Bot/AlertTriangle)
- Description: `--text-primary`, 14px
- Status chip: `SUCCESS` green / `ERROR` red / `RUNNING` amber
- Metadata line: expandable on click, `--text-secondary`, 12px
- Row border-bottom: `--border-subtle`
- Hover: subtle `--surface-1` background

### 4.5 Live Refresh

- "↻ Live" button: when active (violet), polls `GET /ops` every 8s + `GET /runtime/history?n=20` every 10s
- When inactive: manual refresh only
- Same polling behavior as current implementation
- SSE fallback via `useRuntimeStream` (preserved from V1)

---

## 5. SHARED DATA HOOKS

All three screens share:

```javascript
// Custom hook — polls every {interval}ms
function useOpsPoller(interval = 8000) {
  const [opsData, setOpsData] = useState(null);
  const [stats, setStats]     = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAll = async () => {
      const [ops, st] = await Promise.all([getOpsData(), getStats()]);
      setOpsData(ops);
      setStats(st);
      setLoading(false);
    };
    fetchAll();
    const id = setInterval(fetchAll, interval);
    return () => clearInterval(id);
  }, [interval]);

  return { opsData, stats, loading };
}
```

---

## 6. EMPTY AND ERROR STATES

### Empty State (no data yet)

```
    [Activity icon — 32px]
    No activity yet
    Your operations will appear here once
    you send a command or follow up with a contact.
    [ Send First Command → ]
```

### Error State (fetch failed)

```
    [AlertTriangle — 24px, red]
    Could not load data
    Retrying in 15 seconds.
    [ Retry now ]
```

### Skeleton (loading)

3 skeleton rows (shimmer) for the metric cards.
Full-width skeleton bar for the status strip.
No spinners anywhere in the dashboard.

---

## 7. POLLING INTERVALS

| Data | Interval | Source |
|---|---|---|
| Health check | 8s | `GET /health` |
| Ops data | 15s | `GET /ops` |
| Stats | 15s | `GET /stats` |
| Runtime history | 10s | `GET /runtime/history?n=20` |
| Billing status | 60s | `GET /billing/status` |
| Metrics | 30s | `GET /metrics` |

All intervals inherited from current implementation — no changes.
