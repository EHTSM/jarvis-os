# 15 — Billing & Payments (Phase 7 detail)

## Real webhook security

`backend/services/paymentService.js` implements real HMAC-SHA256 signature
verification (`createHmac`) for Razorpay webhooks. Both webhook aliases
(`POST /webhook/razorpay` and the legacy `POST /razorpay-webhook`) are rate
limited (`rateLimiter(30, 60_000, "payment-webhook")`) specifically to protect
signature-check capacity from being exhausted before verification runs —
confirmed by direct code comment.

## Real billing lifecycle (per OS-layer reconciliation, `03_OOPLIX_OS_MAP.md` #4)

Finance OS's canonical `/revenue/finance/*` surface: MRR independently
recomputed from `data/billing.json` (₹108,891, exact match across 895
accounts in the cited live-verification pass), refunds approval-gated and
idempotent (no double-refund), paid plans refused without verified payment
proof (402), invoice/credit-note/billing state confirmed to survive a real
restart.

## Open, unresolved P0/HIGH finding

**`/cbeta/billing/*`'s invoices/credits are NOT account-scoped** — any
authenticated member can read all accounts' invoices and mint credits on
unowned accounts. This was demonstrated and reverted in the OS-layer
reconciliation's source report, and explicitly marked "not fixed — out of
scope for that mission." This is one of the master report's top 3 open
cross-tenant security findings (alongside Mission OS's MSN-1 and Memory OS's
M-4) — see `09_TENANT_ISOLATION.md`.

## Cross-OS reconciliation failure (not a security issue, a data-integrity one)

Executive OS reads a different, uncertified MRR figure (₹54,051) from the
same underlying business data via a different aggregation path
(`businessOrgState`'s 20-department tick feed) than Finance OS's
independently-recomputed ₹108,891. This is documented, not fixed by design
(would require touching shared infrastructure many other OS layers also
read from). Any dashboard or report citing "the" MRR figure should state
which OS's number it means.

## Known gaps (per Finance OS's own certification)

No expense tracking, no double-entry ledger, no org-level billing entity, no
invoice export. A duplicate tax-free invoice engine makes
`/revenue/finance/report` incomplete. `approveAndResume()` was found to return
`ok:false` after a genuinely recorded approval (correctness bug, not a
security issue). `/plan/*` hardcodes `status:"active"` rather than deriving it.

## Verdict

The canonical billing surface (`/revenue/finance/*`) is real, live-verified,
and reasonably mature. The secondary `/cbeta/billing/*` surface carries a real
unresolved P0-class cross-tenant defect. Do not treat "billing is certified"
as a blanket statement — it is true for one surface and false for a sibling
one serving the same data domain.
