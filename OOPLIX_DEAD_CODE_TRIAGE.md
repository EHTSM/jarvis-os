# OOPLIX DEAD CODE TRIAGE
**Phase C.1 Part 7 — 29 unreferenced frontend components**

Date: 2026-08-13
**No deletion performed. Recommendations only, as instructed.**

---

## Method

For each unreferenced component: extract API module imports and endpoint strings, execute those endpoints against the live authenticated server, and compare against live navigable surfaces for supersession.

---

## Category 1 — API-BOUND, BACKEND NEVER BUILT (3 components, 3,052 LOC)

The headline case. These import real API modules and call real-looking endpoints. **None of those endpoints exist.**

| Component | LOC | API module | Endpoints | Verified |
|---|---:|---|---:|---|
| `EnterpriseOS.jsx` | 1,384 | `enterpriseApi.js` (35 fns) | `/enterprise/orgs\|depts\|teams\|roles\|permissions\|policies\|stats\|dashboard\|audit` | **0/9 exist** |
| `DeveloperOS.jsx` | 953 | `developerApi.js` (29 fns) | `/dev/projects\|repos\|builds\|deployments\|issues\|dashboard\|stats` | **0/7 exist** |
| `PersonalOS.jsx` | 715 | `personalApi.js` (19 fns) | `/personal/tasks\|notes\|reminders\|knowledge\|dashboard\|stats` | **0/6 exist** |

All 22 endpoints return **200 with SPA HTML** — the catch-all, not a real route.

### Why these are dangerous rather than merely dead

They are named after three of the eight target OSes. Their existence, plus a superficial check that their endpoints "return 200", could easily be read as evidence that Enterprise OS, Developer OS and Personal OS already exist. **They do not.** What genuinely exists lives at entirely different URLs:

- Enterprise → `/enterprise/sso|scim|audit|policy|monitoring|dashboard` + `/orgs/*` + `/org-*` (100 endpoints probed, 34 working)
- Developer → `/engineering/*` + `/coding/*` + `/engorg/*` (107 probed, 56 working)
- Personal → `/planning/*` + `/assistant/*` + `/twin/*` (live, navigable)

They are also **still being maintained**: the a11y token migration edited `EnterpriseOS.jsx` on 2026-08-12, and overlay fixes touched `DeveloperOS.jsx` on 2026-08-13. Sweeping refactors pay a tax on 3,052 lines of code that can never run.

**Recommendation: ARCHIVE** (move to `_archive/`, which already exists at repo root). Not DELETE — the API client modules encode a considered contract for org/dept/team/role CRUD that may inform a future Enterprise build. Not KEEP — they cannot function.

**Explicitly NOT recommended: building `/dev/*` or `/enterprise/orgs` to make these render.** The brief forbids it and the evidence supports the prohibition — `/engineering/*` and `/orgs/*` already serve these domains.

---

## Category 2 — STATIC MOCKUPS, NO BACKEND CONTRACT (11 components, ~3,100 LOC)

Zero API imports, zero fetch calls, hardcoded constant arrays as their only data source.

| Component | LOC | Evidence |
|---|---:|---|
| `EmailMarketingOS.jsx` | 533 | `const SEGMENTS = [...]`, `const EMAIL_TEMPLATES = [...]` |
| `SeoCommandCenter.jsx` | 360 | `const INDEXED_PAGES = [...]`, `const SEO_CHECKS = [...]` |
| `EnterpriseCRM.jsx` | 353 | `const STAGES = [...]`, `const SEED_OPPS = [...]` |
| `DataOwnershipCenter.jsx` | 254 | `const DATA_INVENTORY = [...]`, `const RETENTION_POLICIES = [...]` |
| `SocialHub.jsx` | 288 | no network calls |
| `DisasterRecoveryCenter.jsx` | 265 | no network calls |
| `AutonomousCompanyCenter.jsx` | 254 | no network calls |
| `AutonomousRevenueCenter.jsx` | 246 | no network calls |
| `AutonomousMarketingCenter.jsx` | 240 | no network calls |
| `CommunityCenter.jsx` | 206 | no network calls |
| `ActivityStream.jsx` | 213 | no network calls |

Several have live functional equivalents: `EmailMarketingOS` → `/growth/email` (live); `SeoCommandCenter` → `contentseo` tab (live); `EnterpriseCRM` → `business` tab (live).

**Recommendation: ARCHIVE.** These are design prototypes from earlier phases. Wiring them would mean building backends that already exist under other names.

---

## Category 3 — SUPERSEDED DUPLICATES (12 components, ~4,200 LOC)

Live successor is already navigable.

| Orphan | LOC | Superseded by (live) |
|---|---:|---|
| `WorkspaceSettingsK2.jsx` | 436 | `WorkspaceSettings` |
| `WorkspaceSettingsK3.jsx` | 402 | `WorkspaceSettings` |
| `WorkspaceSettingsK4.jsx` | 483 | `WorkspaceSettings` |
| `WorkspaceSettingsL1.jsx` | 245 | `WorkspaceSettings` |
| `WorkspaceSettingsL2.jsx` | 357 | `WorkspaceSettings` |
| `WorkspaceSettingsDesktop.jsx` | 366 | `WorkspaceSettings` |
| `AgentCenter.jsx` | 525 | `AgentRegistryCenter` / `AutonomousAgentDashboard` |
| `MemoryCenter.jsx` | 316 | `MemoryOSV2` / `SharedMemoryCenter` |
| `ExecutiveReports.jsx` | 405 | `ReportsV2` |
| `PaymentPanel.jsx` | 308 | `PaymentsV2` |
| `ContentEngine.jsx` | 326 | `ContentSEO` |
| `TrustEngine.jsx` | 246 | `TrustComplianceCenter` |
| `LaunchCommandCenter.jsx` | 270 | `LaunchPlatform` |
| `AutonomousSupportCenter.jsx` | 228 | `SupportCenter` |
| `Landing.jsx` | 377 | `LandingPage` |

**Six `WorkspaceSettings*` variants (2,289 LOC) is iteration debris** — K2, K3, K4, L1, L2, Desktop kept alongside the live version.

**Recommendation: DELETE** (after confirming `_archive/` retains history via git). These are strictly superseded; git history preserves them.

---

## Category 4 — REQUIRES INVESTIGATION (1 component)

| Component | LOC | Note |
|---|---:|---|
| `operator/widgets/EmergencyModeBanner.jsx` | 51 | Small, but "emergency mode" suggests a safety surface. Phase L notes reference an emergency banner as a delivered feature. **Do not archive without checking whether it should be wired.** |

**Recommendation: KEEP pending investigation.**

---

## Summary

| Recommendation | Components | LOC |
|---|---:|---:|
| ARCHIVE (API-bound, no backend) | 3 | 3,052 |
| ARCHIVE (static mockups) | 11 | ~3,100 |
| DELETE (superseded duplicates) | 15 | ~4,200 |
| KEEP pending investigation | 1 | 51 |
| **Total** | **30** | **~10,400** |

**No action taken this phase.** Every recommendation requires explicit authorization.

The maintenance cost is real and ongoing: two sweeping refactors in the last two days edited components in Category 1, which cannot execute.
