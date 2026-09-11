# ERA-1 — FOUNDER DECISION REGISTER (EXECUTION-READY)

**Date:** 2026-09-09 (decisions locked 2026-09-09)
**Branch:** `security/reality-completion`, HEAD `77f1cc0b421269134a2126d90caa4e2f078736dd` (unchanged)
**Scope:** Documentation update only. No source code, `.env`, credential, or production data was
touched. No implementation, deployment, commit, or push performed as part of recording these
decisions.

**Predecessors used as source of truth (not re-audited):** `reports/MISSION-80-VPS-DECISION-CLOSURE.md`,
`reports/MISSION-77-DR-BACKUP.md`, `reports/ERA-1-MANUAL-BLOCKER-CLOSURE.md`,
`reports/ERA-1-CONNECTOR-LAUNCH-SCOPE.md`, `reports/PHASE-1-CAPABILITY-COVERAGE-PROGRESS.md`.

---

## FOUNDER-APPROVED DECISIONS (locked 2026-09-09)

All 5 decisions below have been reviewed and approved by the founder. Each is recorded here as a
**target/selection**, not as an implemented or certified outcome — implementation, live
validation, and (for RPO/RTO specifically) timed measurement remain separate, not-yet-performed
follow-on work. Nothing in this repository was changed to reflect these decisions; this update is
the decision record only.

| # | Decision | Founder-approved value | Status |
|---|---|---|---|
| 1 | Nginx topology | 3-vhost split: `ooplix.com`, `app.ooplix.com`, `api.ooplix.com` | **APPROVED — NOT YET IMPLEMENTED** |
| 2 | RPO | 12 hours maximum acceptable data-loss window | **APPROVED TARGET — NOT YET VALIDATED** |
| 3 | RTO | 4 hours maximum acceptable restoration time after VPS-loss | **APPROVED TARGET — NOT YET VALIDATED** |
| 4 | Connector launch scope | Phased launch; no blanket day-one activation of all 65 | **APPROVED — SCOPE POLICY, NOT A NAMED LIST YET** |
| 5 | Storage provider | Cloudflare R2 primary, local-disk fallback retained | **APPROVED — NOT YET PROVISIONED** |

Full rationale for each, including what implementation/validation work each one still requires
before it can be called done or certified, is recorded below (Decisions 1–5 sections, each now
updated with a "FOUNDER DECISION" subsection under its original options/trade-offs analysis).

---

## DECISION 1 — Nginx Topology

**Decision required:** Should production use the generic single-domain config
(`deploy/nginx-jarvis.conf`) or the `ooplix.com`-hardcoded 3-vhost split
(`deploy/nginx-multisite.conf`)?

**Options already supported by the repository:**

| Option | File | State |
|---|---|---|
| (a) Single-domain, generic placeholders | `nginx-jarvis.conf` | **Current default** — `deploy/setup-vps.sh:97` unconditionally installs this file |
| (b) 3-vhost split (`ooplix.com` / `app.ooplix.com` / `api.ooplix.com`) with live cert paths | `nginx-multisite.conf` | Complete, non-stale, but **unreferenced by any script** — dormant |

**Consequences/trade-offs:**
- (a) is simpler to operate, matches every deploy script's current assumption, needs zero code
  change — but does not separate marketing/app/API traffic onto distinct subdomains.
- (b) gives a cleaner API/app/marketing split (useful if a public API or a separate marketing
  site is planned) but requires: (i) `deploy/setup-vps.sh:97` changed to install
  `nginx-multisite.conf` instead, (ii) `deploy/https-setup.sh`'s certbot invocation changed from
  single `-d "$DOMAIN"` to the 4-SAN form (`-d ooplix.com -d www.ooplix.com -d app.ooplix.com -d
  api.ooplix.com`), (iii) confirmed DNS records for all 4 hostnames before certbot will succeed.

**Existing repository constraint:** `https-setup.sh` already self-checks DNS via `dig`+`ipify`
and aborts on mismatch specifically to avoid Let's Encrypt rate-limit exhaustion (Mission 95) —
this safety behavior applies to either option and is not itself blocking.

**Blocks ERA-1 production validation?** **No, not directly** — the technical default (single-domain)
is a complete, working path today. This decision only matters once a real domain is confirmed and
DNS work begins; it does not block anything closable locally right now.

**STATUS: DECISION REQUIRED** (business half only — which domain architecture is wanted).

**FOUNDER DECISION (2026-09-09): APPROVED — Option (b), the 3-vhost split** (`ooplix.com` /
`app.ooplix.com` / `api.ooplix.com`). This confirms `ooplix.com` as the launch domain and confirms
a split API subdomain is wanted. **Not yet implemented** — per this task's explicit instruction,
no code was changed. Implementation still requires exactly the 3 steps already identified above:
(i) `deploy/setup-vps.sh:97` changed to install `nginx-multisite.conf` instead of
`nginx-jarvis.conf`, (ii) `deploy/https-setup.sh`'s certbot invocation changed to the 4-SAN form
(`-d ooplix.com -d www.ooplix.com -d app.ooplix.com -d api.ooplix.com`), (iii) DNS records for all
4 hostnames confirmed and propagated before certbot is run. None of these 3 steps were performed
by this update.

---

## DECISION 2 — RPO (Recovery Point Objective)

**Decision required:** Maximum acceptable data-loss window if the VPS/disk is lost.

**Options already supported by the repository:**

| Option | Mechanism | Implied RPO |
|---|---|---|
| (a) Accept current cadence as-is | PM2 `cron_restart: "0 2 * * *"` on `ooplix-backup` → `scripts/safe-backup.cjs`, once daily | ~24h (observed, not committed-to as an SLA) |
| (b) Tighten the interval | Change the cron expression | Whatever interval is chosen (no code beyond the cron string needs to change) |
| (c) Add a secondary intra-day mechanism | Not built today | Sub-24h, but requires new work |

**Consequences/trade-offs:** (a) costs nothing further but accepts up to ~24h of data loss in the
worst case. (b) is a one-line config change but increases backup frequency/storage/CPU load
proportionally. (c) gives the tightest RPO but is new engineering work, not a config change.

**Existing repository constraint:** No numeric RPO target exists anywhere in the repository
(`reports/MISSION-77-DR-BACKUP.md` reached the same conclusion independently). Choosing a number
tighter than ~24h obligates either (b) or (c) to actually be built — the number alone changes
nothing without one of those.

**Blocks ERA-1 production validation?** **Yes, indirectly** — any future certification report
that states an RPO figure without this decision would be fabricating a commitment (per this
mission's own governing rule: "do not invent RPO/RTO"). It does not block *code* readiness, but
it blocks a *complete* certification claim.

**STATUS: DECISION REQUIRED.**

**FOUNDER DECISION (2026-09-09): APPROVED TARGET — 12 hours maximum acceptable data-loss window.**
This is a founder-set target, **not a measured or certified result**. The current observed backup
cadence (once-daily, `0 2 * * *`) implies an ~24h ceiling — **wider than the newly approved 12h
target** — so this target is **not yet met by the existing mechanism** and is not being retroactively
declared satisfied. Closing this gap requires implementing option (b) (tighten the cron interval to
12h or better) or option (c) (add a secondary intra-day mechanism) from the options table above —
neither was implemented by this update, per explicit instruction. **Do not claim RPO certification
until the backup cadence is actually changed to meet this target and that cadence is verified in
practice** — this update records the target only.

---

## DECISION 3 — RTO (Recovery Time Objective)

**Decision required:** Maximum acceptable downtime to restore service after a VPS failure.

**Options already supported by the repository:**

| Option | Mechanism | Implied RTO |
|---|---|---|
| (a) Same-host rollback only | `deploy/rollback.sh`, health-check poll capped at 15s | Fast, but **never timed end-to-end**, and does not cover total VPS loss |
| (b) From-scratch VPS bootstrap + restore | `deploy/setup-vps.sh` + restore from `scripts/safe-backup.cjs` archive | Materially slower than (a); **never drilled at all** |

**Consequences/trade-offs:** Neither option currently has a measured duration. Adopting an RTO
target requires actually running a timed drill of whichever scenario the number is meant to
cover — a same-host rollback drill is cheap and fast to run; a from-scratch bootstrap drill is
more representative of a real disaster but requires provisioning a throwaway VPS to time it
honestly.

**Existing repository constraint:** `rollback.sh` is functionally certified (Mission 77) but
duration was never measured; `test-portable-restore.cjs`-style tests prove correctness, not
timing.

**Blocks ERA-1 production validation?** **Yes, indirectly**, same reasoning as RPO — stating an
RTO figure without a timed drill would be an assumption presented as a measurement.

**STATUS: DECISION REQUIRED.**

**FOUNDER DECISION (2026-09-09): APPROVED TARGET — 4 hours maximum acceptable restoration time
after a VPS-loss scenario.** This is a founder-set target, **not a measured or certified result**.
Per this task's explicit instruction, **do not claim RTO certification until a timed recovery
drill actually validates this target.** No drill has been run as part of this update — the
existing repository state is unchanged: `deploy/rollback.sh` is functionally certified (Mission
77) but has never been timed, and a from-scratch VPS bootstrap (the scenario this 4h target most
plausibly refers to, given it says "VPS-loss") has never been drilled at all. Validating this
target requires actually provisioning a throwaway VPS and timing a real bootstrap-plus-restore
end-to-end — not performed by this update.

---

## DECISION 4 — ERA-1 Connector Launch Scope

**Decision required:** Of the connectors in `backend/services/integrationConnectors.cjs`, which
are enabled at initial launch vs. deferred?

**Corrected connector inventory (see "Connector count reconciliation" below for full working):**

| Figure | Value | Source |
|---|---|---|
| Phase 1's own reporting denominator | ~62 (explicitly an approximation, never claimed as machine-counted) | `reports/PHASE-1-CAPABILITY-COVERAGE-PROGRESS.md` |
| Connectors registered by `integrationConnectors.cjs`'s own scanner functions (git+infra+pay+msg+auth+prod+commerce+creative+auto+monitor+issue = 42, + AI's 14, + email's 7) | **63** | Direct source count, this mission |
| Live `data/integration-connectors.json` key count | **65** | Direct count, this and the prior mission |
| Declared capability/scope metadata (`CONNECTOR_CAPABILITIES`) | **8** | `git:github`, `pay:razorpay`, `pay:stripe`, `msg:whatsapp`, `msg:telegram`, `msg:slack`, `auth:github`, `auth:google` — unchanged, preserved exactly |
| Undeclared capability metadata | **54** (against Phase 1's ~62) / **57** (against the live 65) | Both reported — not forced to agree, since they use different denominators |

**Reconciling the "3 unaccounted" between Phase 1's ~62 and the live 65:**

Two of the three are identified with certainty: **`ai:stability` and `ai:elevenlabs`** exist as
keys in the live `data/integration-connectors.json` state file but are **not** part of
`integrationConnectors.cjs`'s own `AI_PROVIDERS` object (verified by direct enumeration — that
object has exactly 14 keys: `groq, openai, anthropic, gemini, openrouter, deepseek, together,
fireworks, cohere, nvidia, ollama, lmstudio, grok, qwen`, none named `stability` or `elevenlabs`).
Instead, Stability AI and ElevenLabs are tracked exclusively by `backend/services/pipReport.cjs`'s
separate "Creative Studio" readiness checks (`creative_image`/`creative_tts`, checking
`STABILITY_API_KEY`/`ELEVENLABS_API_KEY` directly) — a different, narrower registration surface
than the unified connector scanner Phase 1 counted against. This accounts for exactly 2 of the 3.

**The third is not a discoverable missing connector — it is Phase 1's own approximation.**
Direct summation of every category's source-registered connector count (git 3 + infra 6 + pay 4 +
msg 6 + auth 6 + prod 4 + commerce 3 + creative 2 + auto 3 + monitor 3 + issue 2 + AI 14 + email 7)
= **63**, not 62 — one more than Phase 1's own stated denominator, independent of the
stability/elevenlabs question entirely. Phase 1's reports consistently frame this number with a
tilde ("~62") and never claim to have machine-counted it; this mission's direct count (63
source-registered + 2 pipReport-only = 65 live) is the more precise figure. **Reported honestly
as: 2 of the 3 are identified by name (stability, elevenlabs); the 3rd is Phase 1's own rounding,
not a hidden connector this mission failed to find.** No connector identity was fabricated to
force the arithmetic to close.

**Full inventory, categorized A–E, is in `reports/ERA-1-CONNECTOR-LAUNCH-SCOPE.md`** (unchanged,
not re-litigated here). Key facts preserved from that report:
- **No launch scope is declared anywhere in the repository.** This mission does not select one.
- Only 2 credentials are hard-required regardless of connector choice: `JWT_SECRET`,
  `OPERATOR_PASSWORD_HASH` (plus near-hard-required `BASE_URL`) — none are connector credentials.
- Provider-approval-blocked candidates (external platform policy, not repository fact):
  `msg:whatsapp` (Meta business verification), `auth:google`/`auth:microsoft`/`auth:linkedin`/
  `auth:discord`/`auth:apple` (OAuth app verification for sensitive scopes), `pay:razorpay`/
  `pay:stripe` (KYC/business verification for live transactions).

**Consequences/trade-offs of launch-scope choices:**
- Choosing fewer connectors at launch = faster time-to-launch, less provider-approval lead time
  to absorb, but a narrower day-one feature set.
- Choosing a connector from the "54/57 undeclared metadata" set means it will work at the raw
  connector level (send/receive/auth calls) but will NOT be capability-routable through
  `capabilityRouting.cjs` until its `CONNECTOR_CAPABILITIES` entry is authored — a real, scoped,
  separate engineering task (already queued as "Mission 121" in Phase 1's own report), not a
  blocker to using the connector directly via its own API.
- Choosing `msg:whatsapp`, any OAuth provider requesting sensitive scopes, or either payment
  processor means absorbing that provider's own external verification lead time — this can be
  weeks, and is fully outside this repository's or this mission's control.

**Blocks ERA-1 production validation?** **Yes, directly for any connector-dependent feature** —
until a launch scope is chosen, no specific connector can be certified "production verified"
(there is nothing to point live-credential verification at). Does not block the connector-agnostic
core (auth, workflow engine, capability routing itself).

**STATUS: DECISION REQUIRED.**

**FOUNDER DECISION (2026-09-09): APPROVED — phased connector launch policy.** All 65 connectors
are explicitly **not** activated or certified on day one. The approved policy is:
1. Prioritize the verified/declared-core connectors first — i.e. the 8 with existing
   `CONNECTOR_CAPABILITIES` metadata (`git:github`, `pay:razorpay`, `pay:stripe`,
   `msg:whatsapp`, `msg:telegram`, `msg:slack`, `auth:github`, `auth:google`) as the natural
   first wave, since they already have declared capability/scope metadata and are therefore
   capability-routable today.
2. A connector may only be certified "production verified" after **all four** of: (i) real
   credentials configured, (ii) any provider-side approval/verification requirement satisfied
   (per the provider-approval-blocked list in `reports/ERA-1-CONNECTOR-LAUNCH-SCOPE.md` §E —
   `msg:whatsapp`, OAuth providers requesting sensitive scopes, `pay:razorpay`/`pay:stripe`),
   (iii) `CONNECTOR_CAPABILITIES` metadata is declared for it, (iv) live runtime behavior is
   validated against the real provider.
**This is a policy decision, not a named launch list** — the founder has not yet specified exactly
which connectors beyond the 8-declared-core set will be included in the first phased wave; that
remains a follow-on decision, not fabricated here. No connector was activated, certified, or
contacted as part of recording this policy.

---

## DECISION 5 — Production Storage Provider

**Decision required:** Provision Cloudflare R2 or AWS S3 before launch, or rely on the local-disk
fallback?

**Options already supported by the repository:**

| Option | Mechanism | Requires |
|---|---|---|
| (a) Cloudflare R2 | `storageService.cjs`, checked first | `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_ACCOUNT_ID` (or `CLOUDFLARE_*` aliases) |
| (b) AWS S3 | `storageService.cjs`, checked second | `S3_ACCESS_KEY`/`AWS_ACCESS_KEY_ID`, `S3_SECRET_KEY`/`AWS_SECRET_ACCESS_KEY`, `S3_BUCKET` |
| (c) Local disk | `exportFileService.cjs`'s fallback (NOT inside `storageService.cjs` itself — a correction to Mission 80's original description, confirmed this mission's predecessor) — writes to `data/exports/<orgScope>/`, served via `GET /exports/:orgScope/:filename` | No credentials; org-scoped path isolation already real (`_safeScope()` + `resolveLocal()` path-containment check) |

**Consequences/trade-offs:**
- (a)/(b) require provisioning + credentials before launch but give durable, non-host-bound
  storage with presumably existing provider-side backup/redundancy.
- (c) requires zero setup and works today, but has a **real, newly-found gap**: `scripts/safe-backup.cjs`
  (the DR-authoritative, scheduled, hash-verified, offsite-capable backup path) does **not**
  include `data/exports/` in any of its three named-file lists (`M6_STATE_FILES`,
  `CORE_BUSINESS_FILES`, `BUSINESS_OS_FILES` — confirmed by direct read, all three enumerated by
  literal filename, none reference `data/exports/`). **If (c) is chosen for production, exported
  files (DOCX/PPTX/ZIP bundles) would not be covered by the nightly offsite backup** — they would
  only incidentally survive via `backup.sh` (a separate, same-host, unverified, non-offsite
  safety-net script that does a whole-`data/` tar), which is not equivalent DR coverage.

**Existing repository constraint:** Detection order (R2 before S3) and the local-disk fallback
mechanism are both already correct and working — this decision is purely which credentials to
provision, not a code change.

**Required follow-up if local-disk storage is selected:** `scripts/safe-backup.cjs`'s file lists
should be extended to include `data/exports/` (a directory, so likely a glob/directory-copy
addition rather than another named-file entry — the exact implementation is a follow-on task, not
performed by this mission, which is read-only by explicit instruction). Until that follow-up
lands, choosing local-disk storage means knowingly accepting an uncovered DR gap for exported
files specifically (all other production data remains covered).

**Blocks ERA-1 production validation?** **Yes, indirectly** — the choice itself doesn't block
code readiness, but if (c) is chosen, the backup-coverage gap above should be closed (or
knowingly accepted and documented as a residual risk) before treating DR posture as complete.

**STATUS: DECISION REQUIRED.**

**FOUNDER DECISION (2026-09-09): APPROVED — Option (a), Cloudflare R2 as primary, with local-disk
fallback retained** (i.e. R2 provisioned as the primary provider; `exportFileService.cjs`'s
existing local-disk fallback path is kept as-is for whenever R2 is unavailable/unconfigured — not
removed or replaced). **Not yet provisioned** — no `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`/
`R2_BUCKET`/`R2_ACCOUNT_ID` credential was set, checked, or invented by this update. Because R2 is
now the intended *primary* (not merely a fallback-of-last-resort), the `data/exports/` /
`safe-backup.cjs` coverage gap identified above becomes **lower urgency but not zero** — if R2 is
successfully provisioned and genuinely used for all exports going forward, cloud-side redundancy
covers most of the gap; the local-disk fallback path (and therefore the backup-coverage gap) still
applies for any period R2 is unconfigured/unreachable and the app degrades to local disk. The
required follow-up (extending `safe-backup.cjs`'s file lists to cover `data/exports/`) remains
unimplemented and is still recommended regardless of R2 provisioning, since the fallback path
itself was retained by this decision, not removed.

---

## Summary table

| # | Decision | Founder-approved value | Blocks production validation? | Implementation status |
|---|---|---|---|---|
| 1 | Nginx topology | 3-vhost (`ooplix.com`/`app.`/`api.`) | No (default currently works) | **Not yet implemented** — 3 steps outstanding |
| 2 | RPO | 12h target | Yes, until validated | **Not yet validated** — current cadence (~24h) does not yet meet this target |
| 3 | RTO | 4h target | Yes, until validated | **Not yet validated** — no timed drill performed |
| 4 | Connector launch scope | Phased; declared-core-first policy | Yes, for connector-specific certification | **Policy approved, no named list yet** |
| 5 | Storage provider | Cloudflare R2 primary + local-disk fallback retained | Yes, indirectly (DR coverage) | **Not yet provisioned**; backup-coverage follow-up still recommended |

**All 5 decisions are now FOUNDER APPROVED as targets/selections.** None has been implemented,
provisioned, deployed, or certified as part of this update — per explicit instruction, this update
recorded the decisions only. Each section above states precisely what implementation or
validation work remains before the corresponding item can be called done, certified, or complete.

---

## Git / Deploy

- HEAD: `77f1cc0b421269134a2126d90caa4e2f078736dd` (unchanged)
- Branch: `security/reality-completion` (unchanged)
- No commit, push, merge, reset, rebase, stash, or amend performed.
- No `.env`, credential, or production data file was read, modified, or printed.
- No connector was contacted. No deployment script was executed.
- `.git/index.lock` — present, stale, unheld (per predecessor mission) — **not touched**, still
  requires explicit authorization before removal.

**Deploy: NOT PERFORMED.**
