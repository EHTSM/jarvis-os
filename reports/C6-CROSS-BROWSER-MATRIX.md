# C.6 — CROSS-BROWSER MATRIX

Date: 2026-08-14 · Branch: `security/reality-completion`

Every cell traces to a live measurement or an explicit NOT MEASURED / ENVIRONMENT BLOCKED.

---

## Browser availability

| Browser | Engine | Installed | Launchable | Version measured |
|---|---|---|---|---|
| Chrome/Chromium | Chromium | yes (pre-existing) | ✔ | 149.0.7827.55 |
| Firefox | Gecko | installed this session | ✔ | 151.0 |
| Safari/WebKit | WebKit | installed this session | ✔ | 26.5 |
| Edge | Chromium (msedge channel) | **no** | **NOT LAUNCHABLE** | **NOT MEASURED** |

---

## Journey × Browser matrix

`PASS` = measured live, worked correctly · `FAIL` = measured live, defect found · `ENV BLOCKED` = correct behavior meeting a local-environment limit · `NOT MEASURED` = never executed

| Journey | Chromium | Firefox | WebKit | Edge |
|---|---|---|---|---|
| Auth: login returns 200 | PASS | PASS | PASS | NOT MEASURED |
| Auth: session cookie stored | PASS | PASS | **ENV BLOCKED** | NOT MEASURED |
| Auth: authenticated DOM present | PASS | PASS | ENV BLOCKED (downstream of cookie) | NOT MEASURED |
| A. Dashboard load | PASS | PASS | ENV BLOCKED | NOT MEASURED |
| B. Org switcher dropdown | PASS (clickable) | PASS (clickable) | ENV BLOCKED | NOT MEASURED |
| C. CRM (Contacts) | PASS | PASS | ENV BLOCKED | NOT MEASURED |
| D. Sales (Pipeline) | PASS | PASS | ENV BLOCKED | NOT MEASURED |
| E. Finance (Payments) | PASS | PASS | ENV BLOCKED | NOT MEASURED |
| G. AI/mission surface | PASS | PASS | ENV BLOCKED | NOT MEASURED |
| I. Command palette open | PASS | PASS | ENV BLOCKED | NOT MEASURED |
| I. Command palette search | PASS (2 results for "payments") | PASS (2 results) | ENV BLOCKED | NOT MEASURED |
| I. Command palette Escape closes | PASS | PASS | ENV BLOCKED | NOT MEASURED |
| J. Settings navigation | PASS | PASS | ENV BLOCKED | NOT MEASURED |
| Form validation (empty submit) | PASS ("Enter a valid amount.") | PASS (same message) | ENV BLOCKED | NOT MEASURED |
| CSS: flex | PASS | PASS | **PASS** (measured on public shell) | NOT MEASURED |
| CSS: grid | PASS | PASS | **PASS** | NOT MEASURED |
| CSS: sticky | PASS | PASS | **PASS** | NOT MEASURED |
| CSS: backdrop-filter | PASS | PASS | **PASS** | NOT MEASURED |
| CSS: custom properties | PASS | PASS | **PASS** | NOT MEASURED |
| CSS: gap | PASS | PASS | **PASS** | NOT MEASURED |
| JS runtime errors | 0 | 0 | 0 | NOT MEASURED |
| Console errors (functional) | 0 (3 known pre-existing 401/404) | 0 | 0 (1 expected pre-auth 401) | NOT MEASURED |
| Unauthenticated route rejection | PASS (401) | PASS (401) | PASS (401) | NOT MEASURED |
| Build artifact loads, 0 failed requests | PASS | PASS | PASS (public shell) | NOT MEASURED |
| C.5 mobile overflow (390px) | 123px | 124px | NOT MEASURED (needs auth) | NOT MEASURED |

**WebKit's CSS/JS/security rows are measured on the public (unauthenticated) shell, which required no cookie** — proving the engine itself works correctly. The authenticated-journey rows are ENV BLOCKED, not FAIL, because the cause is a local HTTPS gap, not a code or engine defect.

---

## Score inputs (see Certification for full derivation)

| Dimension | Chromium | Firefox | WebKit | Edge |
|---|---:|---:|---:|---:|
| Authenticated journeys | 10/10 | 10/10 | N/A (blocked) | N/A |
| CSS/JS engine compatibility | 10/10 | 10/10 | 10/10 | N/A |
| Security (unauth rejection) | 10/10 | 10/10 | 10/10 | N/A |
