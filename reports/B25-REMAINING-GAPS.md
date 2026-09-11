# B.25 — REMAINING GAPS

Date: 2026-08-14 · Branch: `security/reality-completion`

What Ooplix V1 **genuinely cannot do**, separated from what is merely unprovisioned.
Nothing here is presented as working. Each gap states its real-world consequence.

---

## Gap taxonomy

| Type | Meaning | Count |
|---|---|---:|
| **GENUINE GAP** | Capability absent or non-functional in code | 2 |
| **UNPROVISIONED** | Code complete; a credential or config value is missing | 5 |
| **NOT MEASURED** | Neither proven working nor proven broken | 7 |
| **ARCHITECTURAL LIMITATION** | Works as designed; the design has a known ceiling | 2 |

---

## GENUINE GAPS

### GG-1 — IP allowlist is not enforced

**Severity: HIGH for enterprise. LOW for V1's actual scope.**

A per-organization IP allowlist can be configured, persists, and reads back. **Nothing enforces it.** `requireIpAllowed` exists and is correct, but is mounted on zero routes.

```
allowlist = ["203.0.113.9"]   request from 127.0.0.1  ->  200 (allowed)
```

**As of B.25 the product discloses this** — the compliance check cannot pass, the security surface reports `enforced:false`, and configuring one returns a warning. The dishonesty is fixed; the capability is still absent.

**Consequence:** an organization cannot restrict access by network origin. Any enterprise buyer with a network-policy requirement is unserved.

**To close:** compose `requireIpAllowed` after `requireAuth` + `attachOrg` on org-scoped routers, then prove denial with a live non-allowlisted request. Deliberately **not** done in B.25 — mounting middleware platform-wide is a build action, out of audit scope, and unsafe to land without a dedicated verification pass. Suite 98 will need updating when it is, which is intentional.

---

### GG-2 — 415 form controls have no accessible name

**Severity: HIGH for accessibility. Blocks any accessibility claim.**

```
834 form controls · 415 with no name signal · 414 placeholder-only · 4 properly labelled
```

Placeholder text is not an accessible name under WCAG 3.3.2 — it vanishes on input and is inconsistently announced.

**Consequence:** the product is **not usable by screen-reader users**, and B.19.3's NOT CERTIFIED verdict stands. Marketing Ooplix as accessible would be a false claim.

**To close:** a design pass across ten product families adding visible labels (not `aria-label` alone — the controls also fail 1.3.1). Estimated at hundreds of individual copy decisions; not automatable safely.

---

## UNPROVISIONED — code complete, value missing

These are **not code gaps**. Each is honestly reported by the product at runtime.

| # | Item | Missing | Consequence |
|---|---|---|---|
| UP-1 | **Crash reporting** | `SENTRY_DSN` | **Production is blind to crashes.** Highest-priority pre-launch item. |
| UP-2 | AI providers | valid key / quota | AI features return `502` naming the cause; no fabrication |
| UP-3 | Email / SMS / Push | transport vars | Outbound notification unavailable |
| UP-4 | SSO / SCIM | an IdP | No identity federation; blocks enterprise sale |
| UP-5 | Payment test mode | test-mode env | Billing not exercisable end-to-end |

`.env` was not modified during this audit, per standing instruction. All five are configuration actions, not engineering.

---

## NOT MEASURED — honestly unknown

Neither proven working nor proven broken. **None counted as a pass.**

| # | Item | Why not measured |
|---|---|---|
| NM-1 | Restore execution | Destructive. *Partially upgraded:* archive integrity is now VALID (18 entries, listable) — but a restore was not performed |
| NM-2 | Load / scale behaviour | No load harness. **No scalability claim is made anywhere in this programme** |
| NM-3 | Org deletion / archival | Destructive |
| NM-4 | Member invitation flow | Not completed end-to-end |
| NM-5 | Admin / Developer / Viewer roles | No accounts with those roles exist — RBAC proven only at the owner boundary |
| NM-6 | Operator-tier surfaces | Credential-blocked since OS-4; 12 UNKNOWNs remain UNKNOWN |
| NM-7 | Automation status (enterprise surface) | Not exercised |

---

## ARCHITECTURAL LIMITATIONS

### AL-1 — Logout cannot revoke a token

Stateless JWT with no denylist. A captured token stays valid up to 8 hours (`TOKEN_EXPIRY`).

**Consequence:** logout does not protect against a token already copied. Fine for single-operator V1; a finding in any enterprise security review. Closing it requires a revocation store — a V2 change.

### AL-2 — No active-session / device inventory

Auth is stateless, so there is no session store to enumerate. `enterpriseDashboard.cjs` deliberately reports *how each member last authenticated* instead of fabricating a device list.

**This is the right call** — inventing a device inventory would be dashboard theatre over data that does not exist. Recorded as a limitation, not a defect.

---

## Priority for launch

| Priority | Item | Effort |
|---|---|---|
| **1** | Provision `SENTRY_DSN` (UP-1) | minutes — **do not launch without it** |
| **2** | Decide: enforce GG-1 or remove it from the UI | hours vs. minutes |
| 3 | Provision AI credentials (UP-2) | minutes |
| 4 | Exercise Admin/Developer/Viewer roles (NM-5) | hours |
| 5 | Perform a real restore drill (NM-1) | hours, needs a scratch environment |
| 6 | Accessibility labelling pass (GG-2) | **weeks — V2 scope** |
| 7 | JWT revocation (AL-1) | days — V2 scope |

**Items 1 and 2 are the only ones that should block an external launch.** The rest are scope decisions, and GG-2 and AL-1 are honest V2 work.
