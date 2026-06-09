# ROLE MATRIX
Date: 2026-06-06 | Phase 35 — Product Freeze & Surface Certification
Purpose: Define which screens each user role can access, with permission level and rationale

---

## ROLES DEFINED

| Role | Code | Description | Auth source |
|---|---|---|---|
| **Operator** | OP | Business owner / power user — full access to all operational capabilities | Local JWT account |
| **Developer** | DEV | Technical user — engineering, DevOps, automation building | Local JWT account |
| **Business User** | BIZ | Sales / marketing / support — CRM, pipeline, growth tools | Local JWT account |
| **Enterprise Admin** | ENT | Multi-org administrator — all screens + enterprise management | Local JWT account |
| **Anonymous** | ANON | Unauthenticated — marketing and legal screens only | None |

**Permission levels:**
- `FULL` — create, read, update, delete; all actions enabled
- `READ` — view data only; no write or execute actions
- `HIDDEN` — screen not shown in navigation for this role
- `BILLING-ONLY` — only Billing tab within Settings suite visible

---

## SCREEN ACCESS MATRIX

### TOP-LEVEL TABS (always visible)

| Screen | OP | DEV | BIZ | ENT | Notes |
|---|---|---|---|---|---|
| S01 Control Center | FULL | FULL | FULL | FULL | Task dispatch available to all |
| S02 Execution | FULL | FULL | READ | FULL | Emergency controls: OP/ENT only |
| S03 Intelligence (Chat) | FULL | FULL | FULL | FULL | All users can chat with Jarvis |
| S04 Pipeline | FULL | READ | FULL | FULL | BIZ: view + navigate only |
| S05 Contacts | FULL | HIDDEN | FULL | FULL | DEV has no CRM need |

---

### WORKFLOW SUITE

| Screen | OP | DEV | BIZ | ENT | Notes |
|---|---|---|---|---|---|
| S06 Agents | FULL | FULL | READ | FULL | BIZ: view agent status, cannot execute or configure |
| S07 Action Queue | FULL | FULL | HIDDEN | FULL | Approval queue: OP/ENT only |
| S08 Task Router | FULL | FULL | HIDDEN | FULL | Task routing is an ops capability |
| S09 Coordination | FULL | FULL | HIDDEN | FULL | Multi-agent coordination: technical users |
| S10 Tool Fabric | FULL | FULL | HIDDEN | FULL | Tool execution: OP/DEV/ENT only |
| S11 Workflows | FULL | FULL | READ | FULL | BIZ: view cycle status, cannot launch |
| S12 Memory OS | FULL | FULL | FULL | FULL | All users can add/view business memory |
| S13 Learning Engine | FULL | FULL | HIDDEN | FULL | Learning analytics: operator-level |
| S14 Knowledge Base | FULL | FULL | FULL | FULL | All users can browse knowledge base |
| S15 Autonomy Dashboard | FULL | READ | HIDDEN | FULL | Autonomy scoring: OP/ENT only |
| S16 Brain View | READ | READ | HIDDEN | READ | Visualization only — no write actions |

---

### ENGINEERING SUITE

| Screen | OP | DEV | BIZ | ENT | Notes |
|---|---|---|---|---|---|
| S17 Developer Copilot | HIDDEN | FULL | HIDDEN | FULL | Engineering screens: DEV/ENT only |
| S18 Engineering Center | HIDDEN | FULL | HIDDEN | FULL | Autopilot missions: DEV/ENT only |
| S19 Agent Factory | FULL | FULL | HIDDEN | FULL | OP needs factory to create business agents |

---

### INFRASTRUCTURE SUITE

| Screen | OP | DEV | BIZ | ENT | Notes |
|---|---|---|---|---|---|
| S20 DevOps Runtime | FULL | FULL | HIDDEN | FULL | Deployment controls: technical users |
| S21 Self-Healing | FULL | FULL | HIDDEN | FULL | Health/healing: ops and technical users |
| S22 Disaster Recovery | FULL | FULL | HIDDEN | FULL | Recovery: ops and technical users |
| S23 Operations Center | FULL | FULL | HIDDEN | FULL | Throughput and readiness: ops only |
| S24 AI Costs | FULL | READ | HIDDEN | FULL | Cost viewing: DEV read-only; OP/ENT can set budgets |
| S25 History | FULL | FULL | HIDDEN | FULL | Execution history: ops level |

---

### BUSINESS SUITE

| Screen | OP | DEV | BIZ | ENT | Notes |
|---|---|---|---|---|---|
| S26 Business OS | FULL | HIDDEN | FULL | FULL | Business management: OP/BIZ/ENT |
| S27 Personal OS | FULL | FULL | FULL | FULL | Personal productivity: all users (own data only) |
| S28 Support OS | FULL | HIDDEN | FULL | FULL | Support ticketing: customer-facing roles |

---

### GROWTH SUITE

| Screen | OP | DEV | BIZ | ENT | Notes |
|---|---|---|---|---|---|
| S29 SEO | FULL | HIDDEN | FULL | FULL | Growth: business roles |
| S30 Content Engine | FULL | HIDDEN | FULL | FULL | Content: business roles |
| S31 Email Marketing OS | FULL | HIDDEN | FULL | FULL | Email: business roles |

---

### SETTINGS SUITE

| Screen | OP | DEV | BIZ | ENT | Notes |
|---|---|---|---|---|---|
| S32 Getting Started | FULL | FULL | FULL | FULL | Onboarding: all users |
| S33 Billing | FULL | READ | BILLING-ONLY | FULL | BIZ: view billing status only; OP/ENT: upgrade |
| S34 Settings | FULL | READ | HIDDEN | FULL | DEV: read-only; settings changes: OP/ENT only |
| S35 Integrations | FULL | FULL | HIDDEN | FULL | OAuth connections: technical + operator |
| S36 Enterprise OS | HIDDEN | HIDDEN | HIDDEN | FULL | ENT only — multi-org management |
| S37 Compliance | READ | HIDDEN | HIDDEN | FULL | OP: view only; ENT: full management |
| S38 Help | FULL | FULL | FULL | FULL | Documentation: all users |

---

### ELECTRON-EXCLUSIVE PANELS

| Panel | OP | DEV | BIZ | ENT | Notes |
|---|---|---|---|---|---|
| E01 ExecLog Panel | FULL | FULL | HIDDEN | FULL | Execution log |
| E02 Governor Panel | FULL | READ | HIDDEN | FULL | Reboot: OP/ENT only |
| E03 Workflow Panel | FULL | FULL | HIDDEN | FULL | Workflow triggers |
| E04 Browser Automation | FULL | FULL | HIDDEN | FULL | Desktop-only automation |
| E05 AI Console Panel | FULL | FULL | HIDDEN | FULL | Command dispatch |
| E06 Task Queue Panel | FULL | FULL | READ | FULL | BIZ: view queue only |
| E07 Telemetry Panel | FULL | FULL | HIDDEN | FULL | Service metrics |
| E08 Adapter Panel | FULL | READ | HIDDEN | FULL | Connectivity status |
| E09 Plugin Manager | READ | FULL | HIDDEN | FULL | DEV: full plugin access |
| E10 Floating Window | FULL | FULL | READ | FULL | All roles (with limitations) |
| E11 IPC Bridge | FULL | FULL | HIDDEN | FULL | IPC command routing |

---

### FLUTTER SCREENS

| Screen | OP | DEV | BIZ | ENT | Notes |
|---|---|---|---|---|---|
| F01 Splash | ALL | ALL | ALL | ALL | Auto-redirect |
| F02 Login | ALL | ALL | ALL | ALL | Pre-auth |
| F03 Sign Up | ALL | ALL | ALL | ALL | Pre-auth |
| F04 Dashboard | FULL | FULL | FULL | FULL | All roles |
| F05 AI Chat | FULL | FULL | FULL | FULL | All roles |
| F06 Tasks | FULL | FULL | FULL | FULL | All roles |
| F07 Metrics | FULL | READ | FULL | FULL | DEV: read-only stats |
| F08 Settings | FULL | READ | BILLING-ONLY | FULL | Scoped by role |

---

### CAPACITOR MOBILE SCREENS

| Screen | OP | DEV | BIZ | ENT | Notes |
|---|---|---|---|---|---|
| M01 Login | ALL | ALL | ALL | ALL | Pre-auth |
| M02 Signup | ALL | ALL | ALL | ALL | Pre-auth |
| M03 Home/Chat | FULL | FULL | FULL | FULL | All roles |
| M04 Dashboard | FULL | READ | FULL | FULL | DEV: read-only |
| M05 Tools | FULL | HIDDEN | FULL | FULL | Business tools: OP/BIZ/ENT |
| M06 Profile | FULL | FULL | FULL | FULL | Own account only |

---

## ROLE NAVIGATION SUMMARY

### What each role sees in More ▾

**Operator (OP) — sees all 43 items**
Full operational access. Sees all suites. Designed for the primary user: business owner running Jarvis day-to-day.

**Developer (DEV) — sees 30 items**
Hidden from nav: Contacts, Action Queue, Task Router, Coordination, Workflows (visible but read-only), Autonomy Dashboard (read-only), Business OS, Support OS, all Growth Suite screens, Enterprise OS. DEV nav emphasizes Engineering Suite, Infrastructure Suite, Tool Fabric, Memory, Learning Engine.

**Business User (BIZ) — sees 20 items**
Hidden: all Engineering Suite (except Agent Factory via OP crossover), all Infrastructure Suite, Action Queue, Task Router, Coordination, Tool Fabric, Autonomy Dashboard, Learning Engine, History. BIZ nav focuses on Core 5 tabs + Business Suite + Growth Suite + Getting Started / Billing / Help.

**Enterprise Admin (ENT) — sees all 43 items + Enterprise OS**
Full access. Identical to Operator plus Enterprise OS (org/dept/team/role management). Target: multi-org customers.

---

## BILLING GATE RULES

| Screen | Trial | Starter | Growth | Scale |
|---|---|---|---|---|
| All core tabs | ✓ | ✓ | ✓ | ✓ |
| Workflow Suite | ✓ | ✓ | ✓ | ✓ |
| Engineering Suite | ✓ | — | ✓ | ✓ |
| Infrastructure Suite | ✓ | — | ✓ | ✓ |
| Enterprise OS | — | — | — | ✓ |
| Growth Suite | ✓ | ✓ | ✓ | ✓ |
| AI Costs | — | — | ✓ | ✓ |

*Engineering and Infrastructure suites are Growth+ features. Enterprise OS is Scale-only.*
*Trial gets full access for 7 days to enable evaluation.*

---

## BACKEND ROLE ENFORCEMENT

Current backend auth state:
- `requireAuth` — all phase routes (18–25) require valid JWT session
- `operatorOnly` — CRM routes (`/crm/*`) require `role === "operator"`
- No role-based access for phase routes — all authenticated users can call all phase APIs

**Gap:** Frontend role filtering (hiding nav items) is the only access control for non-CRM routes. Phase 18–25 APIs are accessible to any authenticated user regardless of role.

**Recommendation:** Add `operatorOnly` or `roleCheck(["operator","enterprise"])` middleware to:
- `/p23/*` and `/p24/*` (engineering routes — DEV/ENT only)
- `/p25/deploy/*` (deployment routes — OP/ENT only)
- `/p19/heal/circuit-break` (destructive healing — OP/ENT only)
- `/p18/cycles` POST (cycle launch — OP/DEV/ENT, not BIZ)
