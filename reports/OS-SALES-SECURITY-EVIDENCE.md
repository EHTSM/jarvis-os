# Sales OS — Security Evidence

Two real authenticated tenants. No forged JWTs, no middleware bypass.

---

## Unauthenticated access — 8/8 denied

| Route | Status |
|---|---|
| `/business/leads` | **401** |
| `/business/opportunities` | **401** |
| `/business/pipeline` | **401** |
| `/business/revenue` | **401** |
| `/business/revenue/stats` | **401** |
| `/business/contacts` | **401** |
| `/business/dashboard` | **401** |
| `/business/stats` | **401** |

**0 unauthenticated exposure.**

---

## Cross-tenant attack — B against A's real records, direct IDs

| Attack | Status | Outcome |
|---|---|---|
| B reads A's lead | **404** | denied |
| B updates A's lead | **404** | denied |
| B deletes A's lead | **404** | denied |
| B reads A's opportunity | **404** | denied |
| B updates A's opportunity | **404** | denied |
| B advances A's opportunity | **404** (was 400) | denied |
| B close-wons A's opportunity | **404** (was 400) | denied |

**7/7 denied. A's data verified intact after the attack** — stage and value
unchanged.

### A flagged "leak" that was not one — corrected by measurement

Two attacks initially returned **400**, which my check counted as leaks. Reading
the bodies showed `"Opportunity not found"` — the ownership check *had* fired;
only the status code was imprecise. **A's data was confirmed unmutated**, so the
finding was withdrawn rather than reported.

The root cause was still real and was fixed (S-002 below).

---

## Tenant isolation on aggregates

| View | Tenant A | Tenant B |
|---|---|---|
| Revenue stats | total 151000, count 3 | **total 0, count 0** |
| Leads | 4 | **0** |
| Pipeline | closed-won 1 | **all stages 0** |

No platform total ever appeared as a tenant total.
