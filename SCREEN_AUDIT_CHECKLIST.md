# SCREEN AUDIT CHECKLIST
**Product:** Ooplix / Jarvis-OS
**Phase:** 35 — Product Freeze & Surface Certification
**Date:** 2026-06-06
**Scope:** All 75 certified surfaces — Web (48) + Electron (11) + Flutter (8) + Capacitor (8)

**How to use:** Each row is a surface. Work through columns left-to-right per surface before shipping.
`✓` = confirmed done · `✗` = confirmed missing · `—` = not applicable by design

---

## LEGEND

| Column | Meaning |
|---|---|
| Purpose Documented | Surface purpose is written in SCREEN_INVENTORY_FINAL.md |
| Role Assigned | User role(s) defined in ROLE_MATRIX.md |
| Backend Wired | At least one real API call (not seed/localStorage) |
| API Deps Listed | All endpoint dependencies listed in inventory |
| User Actions Defined | Expected user actions documented |
| Status Assessed | WIRED / PARTIAL / STATIC / NEEDS-BACKEND / DEAD |
| Missing Items Noted | Any gaps captured explicitly |
| Nav Reachable | Can a user actually navigate to this screen |

---

## PLATFORM 1: WEB APP (S01–S48)

### GROUP A: TOP-LEVEL TABS

| ID | Surface | Purpose | Role | Backend | APIs | Actions | Status | Missing | Nav |
|---|---|---|---|---|---|---|---|---|---|
| S01 | Control Center | ✓ | ✓ | ✓ | ✓ | ✓ | WIRED | ✓ | ✓ |
| S02 | Execution | ✓ | ✓ | ✓ | ✓ | ✓ | WIRED | ✓ | ✓ |
| S03 | Intelligence (Chat) | ✓ | ✓ | ✓ | ✓ | ✓ | WIRED | ✓ | ✓ |
| S04 | Pipeline | ✓ | ✓ | ✓ | ✓ | ✓ | WIRED | ✓ | ✓ |
| S05 | Contacts | ✓ | ✓ | ✓ | ✓ | ✓ | WIRED | ✓ Razorpay keys | ✓ |

### GROUP B: WORKFLOW SUITE

| ID | Surface | Purpose | Role | Backend | APIs | Actions | Status | Missing | Nav |
|---|---|---|---|---|---|---|---|---|---|
| S06 | Agents | ✓ | ✓ | ✓ | ✓ | ✓ | WIRED | ✓ Toggle UI-only | ✓ |
| S07 | Action Queue | ✓ | ✓ | ✓ | ✓ | ✓ | WIRED | ✓ Approve UI-only | ✓ |
| S08 | Task Router | ✓ | ✓ | ✓ | ✓ | ✓ | WIRED | ✓ Reassign UI-only | ✓ |
| S09 | Coordination | ✓ | ✓ | ✓ | ✓ | ✓ | WIRED | ✓ Feed seed data | ✓ |
| S10 | Tool Fabric | ✓ | ✓ | ✓ | ✓ | ✓ | WIRED | ✓ Keys not configured | ✓ |
| S11 | Workflows | ✓ | ✓ | ✓ | ✓ | ✓ | WIRED | ✓ Groq key dependent | ✓ |
| S12 | Memory OS | ✓ | ✓ | ✓ | ✓ | ✓ | WIRED | ✓ None | ✓ |
| S13 | Learning Engine | ✓ | ✓ | ✓ | ✓ | ✓ | WIRED | ✓ Apply UI-only | ✓ |
| S14 | Knowledge Base | ✓ | ✓ | ✗ | ✗ | ✓ | NEEDS-BACKEND | ✗ Engine missing | ✓ |
| S15 | Autonomy Dashboard | ✓ | ✓ | ✓ | ✓ | ✓ | WIRED | ✓ Domain feed seed | ✓ |
| S16 | Brain View | ✓ | ✓ | ✓ | ✓ | ✓ | WIRED | ✓ Goal list seed | ✓ |

### GROUP C: ENGINEERING SUITE

| ID | Surface | Purpose | Role | Backend | APIs | Actions | Status | Missing | Nav |
|---|---|---|---|---|---|---|---|---|---|
| S17 | Developer Copilot | ✓ | ✓ | ✓ | ✓ | ✓ | WIRED | ✓ No GITHUB_TOKEN | ✓ |
| S18 | Engineering Center | ✓ | ✓ | ✓ | ✓ | ✓ | WIRED | ✓ No GITHUB_TOKEN | ✓ |
| S19 | Agent Factory | ✓ | ✓ | ✓ | ✓ | ✓ | WIRED | ✓ Train UI-only | ✓ |

### GROUP D: INFRASTRUCTURE SUITE

| ID | Surface | Purpose | Role | Backend | APIs | Actions | Status | Missing | Nav |
|---|---|---|---|---|---|---|---|---|---|
| S20 | DevOps Runtime | ✓ | ✓ | ✓ | ✓ | ✓ | WIRED | ✓ No rollback UI | ✓ |
| S21 | Self-Healing | ✓ | ✓ | ✓ | ✓ | ✓ | WIRED | ✓ Rule toggles UI-only | ✓ |
| S22 | Disaster Recovery | ✓ | ✓ | ✗ | ✗ | ✓ | NEEDS-BACKEND | ✗ Engine missing | ✓ |
| S23 | Operations Center | ✓ | ✓ | ✓ | ✓ | ✓ | WIRED | ✓ Throughput seed | ✓ |
| S24 | AI Costs | ✓ | ✓ | ✗ | ✗ | ✓ | NEEDS-BACKEND | ✗ Engine missing | ✓ |
| S25 | History | ✓ | ✓ | ✓ | ✓ | ✓ | PARTIAL | ✓ No direct API call | ✓ |

### GROUP E: BUSINESS SUITE

| ID | Surface | Purpose | Role | Backend | APIs | Actions | Status | Missing | Nav |
|---|---|---|---|---|---|---|---|---|---|
| S26 | Business OS | ✓ | ✓ | ✓ | ✓ | ✓ | STATIC | ✓ No direct CRM calls | ✓ |
| S27 | Personal OS | ✓ | ✓ | — | — | ✓ | STATIC | — localStorage correct | ✓ |
| S28 | Support OS | ✓ | ✓ | ✗ | ✗ | ✓ | NEEDS-BACKEND | ✗ Engine missing | ✓ |

### GROUP F: GROWTH SUITE

| ID | Surface | Purpose | Role | Backend | APIs | Actions | Status | Missing | Nav |
|---|---|---|---|---|---|---|---|---|---|
| S29 | SEO Command Center | ✓ | ✓ | ✗ | ✗ | ✓ | NEEDS-BACKEND | ✗ Engine missing | ✓ |
| S30 | Content Engine | ✓ | ✓ | ✗ | ✗ | ✓ | NEEDS-BACKEND | ✗ Engine missing | ✓ |
| S31 | Email Marketing OS | ✓ | ✓ | ✗ | ✗ | ✓ | NEEDS-BACKEND | ✗ Engine missing | ✓ |

### GROUP G: SETTINGS SUITE

| ID | Surface | Purpose | Role | Backend | APIs | Actions | Status | Missing | Nav |
|---|---|---|---|---|---|---|---|---|---|
| S32 | Getting Started | ✓ | ✓ | ✓ | ✓ | ✓ | PARTIAL | ✓ Some steps static | ✓ |
| S33 | Billing | ✓ | ✓ | ✓ | ✓ | ✓ | WIRED | ✓ Razorpay plan IDs | ✓ |
| S34 | Settings | ✓ | ✓ | ✓ | ✓ | ✓ | PARTIAL | ✓ Most fields static | ✓ |
| S35 | Integrations | ✓ | ✓ | ✓ | ✓ | ✓ | STATIC | ✓ OAuth keys not set | ✓ |
| S36 | Enterprise OS | ✓ | ✓ | ✓ | ✓ | ✓ | WIRED | ✓ None | ✓ |
| S37 | Compliance | ✓ | ✓ | ✗ | ✗ | ✓ | STATIC | ✓ No audit endpoint | ✓ |
| S38 | Help & Guides | ✓ | ✓ | — | — | ✓ | STATIC | — Correct by design | ✓ |

### GROUP H: PRE-APP SCREENS

| ID | Surface | Purpose | Role | Backend | APIs | Actions | Status | Missing | Nav |
|---|---|---|---|---|---|---|---|---|---|
| S39 | Landing Page | ✓ | ✓ | — | — | ✓ | STATIC | — Marketing screen | ✓ |
| S40 | Onboarding | ✓ | ✓ | — | — | ✓ | STATIC | — localStorage OK | ✓ |
| S41 | Login | ✓ | ✓ | ✓ | ✓ | ✓ | WIRED | ✓ None | ✓ |
| S42 | Pricing | ✓ | ✓ | — | — | ✓ | STATIC | — Correct by design | ✓ |

### GROUP I: LEGAL SCREENS

| ID | Surface | Purpose | Role | Backend | APIs | Actions | Status | Missing | Nav |
|---|---|---|---|---|---|---|---|---|---|
| S43 | Company | ✓ | ✓ | — | — | — | STATIC | — Footer link | ✓ |
| S44 | Privacy Policy | ✓ | ✓ | — | — | — | STATIC | — Footer link | ✓ |
| S45 | Terms of Service | ✓ | ✓ | — | — | — | STATIC | — Footer link | ✓ |
| S46 | Refund Policy | ✓ | ✓ | — | — | — | STATIC | — Footer link | ✓ |
| S47 | Contact | ✓ | ✓ | — | — | — | STATIC | — Footer link | ✓ |
| S48 | Trust & Security | ✓ | ✓ | — | — | — | STATIC | — Footer link | ✓ |

---

## PLATFORM 2: ELECTRON-EXCLUSIVE PANELS (E01–E11)

| ID | Surface | Purpose | Role | Backend | APIs | Actions | Status | Missing | Nav |
|---|---|---|---|---|---|---|---|---|---|
| E01 | ExecLog Panel | ✓ | ✓ | ✓ | ✓ | ✓ | WIRED | ✓ None | ✓ |
| E02 | Governor Panel | ✓ | ✓ | ✓ | ✓ | ✓ | WIRED | ✓ None | ✓ |
| E03 | Workflow Panel | ✓ | ✓ | ✓ | ✓ | ✓ | WIRED | ✓ None | ✓ |
| E04 | Browser Automation | ✓ | ✓ | ✓ | ✓ | ✓ | WIRED | ✓ Desktop-only OK | ✓ |
| E05 | AI Console Panel | ✓ | ✓ | ✓ | ✓ | ✓ | WIRED | ✓ None | ✓ |
| E06 | Task Queue Panel | ✓ | ✓ | ✓ | ✓ | ✓ | WIRED | ✓ None | ✓ |
| E07 | Telemetry Panel | ✓ | ✓ | ✓ | ✓ | ✓ | WIRED | ✓ None | ✓ |
| E08 | Adapter Panel | ✓ | ✓ | ✓ | ✓ | ✓ | PARTIAL | ✓ Uses App state | ✓ |
| E09 | Plugin Manager | ✓ | ✓ | — | — | ✓ | STATIC | ✓ No registry API | ✓ |
| E10 | Floating Window | ✓ | ✓ | ✓ | ✓ | ✓ | WIRED | ✓ Same bundle | ✓ |
| E11 | IPC Bridge | ✓ | ✓ | ✓ | ✓ | ✓ | WIRED | ✓ None | ✓ |

---

## PLATFORM 3: FLUTTER APP (F01–F08)

| ID | Surface | Purpose | Role | Backend | APIs | Actions | Status | Missing | Nav |
|---|---|---|---|---|---|---|---|---|---|
| F01 | Splash | ✓ | ✓ | ✓ | ✓ | — | PARTIAL | ✓ Firebase auth state | ✓ |
| F02 | Login | ✓ | ✓ | ✓ | ✓ | ✓ | WIRED | ✓ None | ✓ |
| F03 | Sign Up | ✓ | ✓ | ✓ | ✓ | ✓ | WIRED | ✓ None | ✓ |
| F04 | Dashboard | ✓ | ✓ | ✓ | ✓ | ✓ | WIRED | ✓ 4 tiles → dead routes | ✓ |
| F05 | AI Chat | ✓ | ✓ | ✓ | ✓ | ✓ | DEAD | ✗ GoRoute missing | ✗ |
| F06 | Tasks | ✓ | ✓ | ✓ | ✓ | ✓ | DEAD | ✗ GoRoute missing | ✗ |
| F07 | Metrics | ✓ | ✓ | ✓ | ✓ | ✓ | DEAD | ✗ GoRoute missing | ✗ |
| F08 | Settings | ✓ | ✓ | ✓ | ✓ | ✓ | DEAD | ✗ GoRoute missing | ✗ |

---

## PLATFORM 4: CAPACITOR MOBILE (M01–M08)

| ID | Surface | Purpose | Role | Backend | APIs | Actions | Status | Missing | Nav |
|---|---|---|---|---|---|---|---|---|---|
| M01 | Login | ✓ | ✓ | ✓ | ✓ | ✓ | WIRED | ✓ None | ✓ |
| M02 | Signup | ✓ | ✓ | ✓ | ✓ | ✓ | WIRED | ✓ None | ✓ |
| M03 | Home/Chat | ✓ | ✓ | ✓ | ✓ | ✓ | WIRED | ✓ None | ✓ |
| M04 | Dashboard | ✓ | ✓ | ✓ | ✓ | ✓ | WIRED | ✓ None | ✓ |
| M05 | Tools | ✓ | ✓ | ✓ | ✓ | ✓ | WIRED | ✓ None | ✓ |
| M06 | Profile | ✓ | ✓ | ✓ | ✓ | ✓ | PARTIAL | ✓ No /auth/me sync | ✓ |
| M07 | Privacy Policy | ✓ | ✓ | — | — | — | STATIC | — Correct | ✓ |
| M08 | Terms of Service | ✓ | ✓ | — | — | — | STATIC | — Correct | ✓ |

---

## CERTIFICATION SUMMARY

### Status Distribution

| Status | Count | Pct |
|---|---|---|
| WIRED | 40 | 53% |
| PARTIAL | 8 | 11% |
| STATIC (by design) | 18 | 24% |
| NEEDS-BACKEND | 5 | 7% |
| DEAD | 4 | 5% |
| **Total** | **75** | 100% |

### Open Items by Priority

**P1 — Blocks shipping (Flutter broken routes)**
| Item | Surface | Fix |
|---|---|---|
| F05 GoRoute missing | AI Chat (Flutter) | Add `/chat` GoRoute + ChatScreen widget |
| F06 GoRoute missing | Tasks (Flutter) | Add `/tasks` GoRoute + TasksScreen widget |
| F07 GoRoute missing | Metrics (Flutter) | Add `/metrics` GoRoute + MetricsScreen widget |
| F08 GoRoute missing | Settings (Flutter) | Add `/settings` GoRoute + SettingsScreen widget |

**P2 — Functional gaps (engines not built)**
| Item | Surface | Fix |
|---|---|---|
| KnowledgeBaseEngine | S14 Knowledge Base | Build engine + `/knowledge/*` routes |
| BackupRecoveryEngine | S22 Disaster Recovery | Build engine + `/recovery/*` routes |
| CostTrackingEngine | S24 AI Costs | Build engine (or wire `/p25/obs/metrics`) |
| SupportTicketEngine | S28 Support OS | Build engine + `/support/*` routes |
| SEOMonitoringEngine | S29 SEO | Build engine + `/seo/*` routes |
| ContentGenerationEngine | S30 Content Engine | Wire to `/jarvis` or build dedicated engine |
| EmailAutomationEngine | S31 Email Marketing | Build engine + `/email/*` routes |

**P3 — Config / credentials (env only — no code change)**
| Item | Surfaces Affected | Fix |
|---|---|---|
| RAZORPAY_KEY_ID / SECRET | S05 Contacts, S33 Billing | Set in .env |
| RAZORPAY_PLAN_ID_STARTER/GROWTH | S33 Billing | Set in .env |
| GITHUB_TOKEN | S17, S18, S19 | Set in .env |
| OAuth client IDs (Google/Slack/Notion) | S35 Integrations | Set in .env |

**P4 — UI-only actions (no backend endpoint)**
| Item | Surface | Fix |
|---|---|---|
| Agent toggle (pause/activate) | S06 Agents | Add PATCH /p18/agents/:id/status |
| Action approve/deny | S07 Action Queue | Add POST /p18/actions/:id/approve |
| Task reassign | S08 Task Router | Add PATCH /p18/tasks/:id/assign |
| Recommendation apply | S13 Learning Engine | Add POST /p19/learn/apply |
| Self-healing rule toggle | S21 Self-Healing | Add PUT /p19/heal/rules/:id |
| Agent training submit | S19 Agent Factory | Add POST /p20/agents/:id/train |

**P5 — Seed data (real backend exists, not piped to UI)**
| Item | Surface |
|---|---|
| Handoff event feed | S09 Coordination |
| Domain action breakdown | S15 Autonomy Dashboard |
| Active goal list | S16 Brain View |
| Agent throughput | S23 Operations Center |
| Checklist items | S32 Getting Started |

---

## FREEZE CERTIFICATION

All 75 surfaces are documented with:
- Purpose ✓
- User Role ✓
- Product Area ✓
- Backend Engines ✓
- API Dependencies ✓
- Expected User Actions ✓
- Current Status ✓
- Missing Items ✓

**Product surface is FROZEN as of 2026-06-06.**
No new surfaces may be added without updating this document, SCREEN_INVENTORY_FINAL.md, ROLE_MATRIX.md, and MASTER_SAAS_ARCHITECTURE.md.
