# C.8 — INTERNATIONALIZATION SECURITY

Date: 2026-08-14 · Branch: `security/reality-completion`

Tenancy/security analysis per the mission's explicit requirement, even though the underlying capability (language preference) does not exist.

---

## The question

> Language preference must not accidentally leak tenant data. If preferences are tenant/workspace scoped, verify A and B independently.

## The answer, evidenced

**There is no language preference anywhere in the product to leak.**

```
backend account schema  : no locale/language field (grep -n 'locale' accountService.js -> 0 matches)
backend org schema      : no locale/language field (grep -n 'locale' organizationService.cjs -> 0 matches)
frontend localStorage   : no language-preference key among the 31 genuinely-written keys
                          inventoried in C.7 (jarvis_biz_profile, jarvis_org_id, etc. —
                          none of them store a language/locale value)
frontend sessionStorage : same — no language key
```

This was not assumed from the absence of a selector alone. The full account/organization data-model search (the same method used to confirm C.7's `jarvis_biz_profile` finding) was re-run for `locale`/`language` fields and returned zero results at every layer: backend schema, frontend persisted storage, and any in-memory React context.

## Why this is a genuine "nothing to isolate," not an unmeasured gap

Unlike C.7's `jarvis_biz_profile` (where a real, tenant-specific value existed and needed isolation testing across two accounts), there is no analogous i18n state to construct a two-tenant test around. Running "Tenant A sets a language preference → switch to Tenant B → verify B doesn't see A's preference" is not possible when no code path exists that sets, stores, or reads a language preference in the first place.

**This is classified N/A, not NOT MEASURED** — the distinction matters. NOT MEASURED would imply a real capability exists that this audit failed to test. N/A states plainly that the capability itself does not exist, so there is nothing for a two-tenant isolation test to exercise.

## What was verified instead

The `lang="en"` document attribute — the one language-related piece of state that does exist — is static HTML, sent identically to every request regardless of authentication state or tenant. It cannot leak between tenants because it never varies per-tenant in the first place; every user, authenticated or not, on any tenant, receives the identical `<html lang="en">`.

```
curl http://localhost:5050/ (unauthenticated) -> <html lang="en"
authenticated session (tenant from C.2-C.7's test account) -> <html lang="en">, identical
```

## Constraint compliance

| Constraint | Status |
|---|---|
| `.env` not modified | **HELD** |
| Auth architecture not modified | **HELD** — no code changed in C.8 |
| Organization architecture not modified | **HELD** |
| No fabricated tenant-isolation test result | **HELD** — the honest finding is "nothing exists to isolate," not a fabricated PASS |

## Conclusion

**Tenant/workspace preference isolation: N/A (capability does not exist).** No security defect exists in this dimension because no language-preference state exists to misattribute between tenants. This is a genuine, verified absence — not an audit gap.
