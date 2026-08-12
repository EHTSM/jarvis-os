# OOPLIX V1 — Master Audit Deck

**Document ID:** OPX-DECK-001 · **Slides:** 62 · **Format:** 16:9 · **Runtime:** ~45 min + Q&A
**Audience tracks:** Investor (1–20, 55–62) · Enterprise customer (1–10, 21–40, 55–62) · Technical due diligence (all)

**Rendering note.** Every slide carries a `LAYOUT`, on-slide `CONTENT`, and `SPEAKER NOTES`. Build via `scripts/build-deck.js` (PPTX) or present the Markdown directly. Design tokens come from `data/brand.json`; all figures come from `data/audit-register.json`.

---

## SECTION 1 — OPENING (Slides 1–6)

### Slide 1 · Title
**LAYOUT:** Full-bleed. Centered display type, deep navy `#1F4E79` field, white text. No logo lockup beyond wordmark.

**CONTENT:**
> # Ooplix V1
> ## Master Audit & Certification Record
> 33 audits executed · 127 findings recovered · 3 critical gaps recorded, not hidden
>
> v1.0.0-rc1 · 2026-08-09 · Confidential

**SPEAKER NOTES:** Open on the third line, not the first. "The number I want you to hold onto is not 31 or 116 — it's 3. Three critical gaps that we found, reproduced, measured, and then deliberately did not fix, because fixing them properly means building something new rather than patching something broken. Every audit programme produces a clean number. This one also produces the uncomfortable one, and that's the part you should test me on." Do not apologise for the 3. It is the credibility of the whole deck.

---

### Slide 2 · The one-sentence thesis
**LAYOUT:** Single centered statement, 40pt. Nothing else on the slide.

**CONTENT:**
> We audited by operating the product, not by reading its source.
> Every number in this deck is a measurement.

**SPEAKER NOTES:** Pause after reading it. This is the methodological claim the entire deck rests on. Most audit decks are code review dressed as evidence — someone read a file and formed an opinion. We inverted it: reproduce the defect from outside first, quantify it against live data, and only then open the source to find the cause. That ordering is why we found things like a knowledge graph that had never been indexed — you cannot see that in code, because the code is correct. It only shows up when you look at the running system.

---

### Slide 3 · What Ooplix is
**LAYOUT:** Left: three-line product definition. Right: architecture thumbnail (`diagrams/svg/` or `06-platform-architecture.mmd`).

**CONTENT:**
> Autonomous business operating system.
> 210 live agents · 300 API routes · 14 AI providers · multi-tenant
> Web, desktop (Electron), and mobile (Capacitor) clients on one backend.

**SPEAKER NOTES:** Keep to 45 seconds. The audience needs enough shape to interpret the findings, not a product tour. Emphasise multi-tenancy and the agent runtime, because those two are where the most consequential findings live. If asked about scale: single-process, `instances: 1`, fork mode — documented and deliberate, and B.20 is the audit that would change it.

---

### Slide 4 · Why this record exists
**LAYOUT:** Three stacked statements, generous leading.

**CONTENT:**
> **For investors** — evidence that the platform's claims survive contact with measurement.
> **For enterprise customers** — a named, dated liability list rather than a marketing assertion.
> **For technical due diligence** — reproduction steps for every finding, including the open ones.

**SPEAKER NOTES:** Different rooms want different things from the same document. Say which one you're in. For an investor room, the operative word is *survive* — plenty of platforms make claims that evaporate under a stopwatch. For an enterprise room, the operative phrase is *named liability list*: procurement has been burned by vendors who present only green.

---

### Slide 5 · Evidence integrity statement
**LAYOUT:** Two columns, hard visual split. Left column solid; right column greyed and dashed.

**CONTENT:**
> **EXECUTED — 31 register rows**
> A.1–A.13, B.1–B.19
> Traceable to committed certification documents and git history.
>
> **PLANNED — 7 audits**
> B.20–B.25, Phase C
> Not executed. No score. No findings. No evidence.

**SPEAKER NOTES:** This slide is why the deck can be trusted. State it flatly: "Seven of the thirty-four register rows have not been run. They appear in the register with an em-dash where the score would be. We could have put projected numbers there and the deck would look better. We didn't, because the first person to check would find them, and then nothing else in here would count." Expect a nod from anyone who has run diligence before.

---

### Slide 6 · Agenda
**LAYOUT:** Six-item numbered list with slide ranges.

**CONTENT:**
> 1. Method — how the audits were run · 7–12
> 2. Programme structure — six layers · 13–20
> 3. Layer findings — Foundation through Operations · 21–40
> 4. The three critical gaps · 41–48
> 5. Scorecards and maturity position · 49–54
> 6. Roadmap to GA certification · 55–62

**SPEAKER NOTES:** Flag section 4 explicitly: "Section four is the one I'd skip to if I were you." Signals confidence and buys goodwill.

---

## SECTION 2 — METHOD (Slides 7–12)

### Slide 7 · The six-step protocol
**LAYOUT:** Horizontal six-step flow, arrows between. Render from `05-audit-method-flow.mmd`.

**CONTENT:**
> **Reproduce → Measure → Root Cause → Recover → Regression → Reverify**
> Applied identically to all 33 executed audits.

**SPEAKER NOTES:** Walk the chain once, fast. The two steps people skip are the first and the fifth. Skipping *reproduce* means auditing your mental model instead of the system. Skipping the negative test in *regression* means shipping a test that would pass even against the broken code — which is worse than no test, because it manufactures false confidence.

---

### Slide 8 · Constraint 1 — Measure before reading source
**LAYOUT:** Statement plus one worked example.

**CONTENT:**
> Findings originate in observed behaviour, not code inspection.
>
> **B.12 — the knowledge graph held 5 edges and `lastIndexed: null`.**
> The indexing code was correct. It had simply never been run.
> Running the existing endpoint: **1,526 edges / 2,321 nodes in 2.7 seconds.**

**SPEAKER NOTES:** This is the strongest single argument for the method, so give it time. A code reviewer reads `indexAll()`, sees correct logic, and moves on — there is no bug to find. The defect is *dormancy*, and dormancy is invisible from inside the file. Then the payoff: once indexed, the graph independently surfaced a recommendation reading "Fix: memory_pressure" — rediscovering the B.11 agent defect from its own data. That is the clearest evidence available that it is reasoning over real data rather than echoing inputs.

---

### Slide 9 · Constraint 2 — Recover, don't construct
**LAYOUT:** Decision diamond: capability exists → recover; doesn't exist → record as gap.

**CONTENT:**
> If the capability exists and is dormant, miswired, or misconfigured → **recover it.**
> If closing the gap requires new capability → **record it**, with reproduction and reason.
>
> This rule is the sole origin of all 92 recorded gaps.

**SPEAKER NOTES:** Anticipate the obvious challenge — "why not just fix them?" Answer directly: because a critical tenant-isolation gap fixed under audit-day time pressure, without design review, is how you introduce a worse defect than the one you closed. Recording it with full reproduction steps means it gets fixed properly, on a schedule, with tests. The gap register is a commitment device, not an excuse.

---

### Slide 10 · Constraint 3 — Real tenants, real failures
**LAYOUT:** Two panels — isolation testing, failure induction.

**CONTENT:**
> **Isolation proven, never inferred.** Two or more genuinely separate organizations, unique leak markers (`B15SECRETALPHA`, `ORGA_SECRET_*`) so leakage was provable.
>
> **Failures induced, never simulated.** 1× SIGTERM, 3× consecutive SIGKILL, operator emergency stop, DLQ drain, total AI-provider outage.

**SPEAKER NOTES:** The marker technique matters — planting a unique string in Org A's data means that when it appears in Org B's response you have proof rather than suspicion. On failure induction: three *consecutive* SIGKILLs, not one. A single kill proves restart works; three consecutive prove there is no crashloop backoff lockout hiding behind the first recovery.

---

### Slide 11 · Constraint 4 — Negative-tested regressions
**LAYOUT:** Before/after test-result pair.

**CONTENT:**
> Every new test was verified to **fail** against the un-fixed code.
>
> B.19 accessibility suite: **5 of 9 tests fail** when the CSS fix is reverted.
> Regression baseline: **144/144** runtime + **142/142** phase-specific.

**SPEAKER NOTES:** A test that passes before and after your fix is measuring nothing. Reverting the fix and confirming the failure is the only way to know the assertion has teeth. Mention that this caught a real mistake in B.16 — an early assertion compared absolute counts that drifted because the store is a 500-record ring buffer. The test was wrong, not the code, and it got rewritten to assert the structural invariant instead.

---

### Slide 12 · What the method cannot tell you
**LAYOUT:** Plain list, no styling flourish.

**CONTENT:**
> **Not covered by this record:**
> · No screen-reader runtime testing — no NVDA or VoiceOver available
> · No Safari or Firefox testing — Blink only
> · No axe-core or Lighthouse scan — dependency declined
> · Live payment capture — credential-blocked upstream (Razorpay 401)
> · Sustained-load capacity — B.24, not executed

**SPEAKER NOTES:** Volunteering limitations before being asked is the single highest-trust move available. Note the axe-core decision specifically: adding a dependency to the user's project to make an audit look more thorough is the wrong trade, so the checks were implemented directly against the live DOM instead — stronger evidence per check, narrower coverage. Say which it is.

---

## SECTION 3 — PROGRAMME STRUCTURE (Slides 13–20)

### Slide 13 · Six layers
**LAYOUT:** Horizontal layer bar. Render from `02-strategic-roadmap.mmd`.

**CONTENT:**
> **Foundation → Engineering → Intelligence → Operations → Vision → Perfection**
> L1–L4 executed · L5–L6 planned

**SPEAKER NOTES:** The layers are dependency-ordered, not chronological. You cannot certify Intelligence honestly if Foundation is lying to you about whether an action succeeded — which is exactly what A.5 through A.7 found. Fix truthfulness first, then correctness, then capability.

---

### Slide 14 · Layer 1 — Foundation
**CONTENT:** 4 audits · 20 findings · 4 critical · **CERTIFIED**
> Theme: does the product tell the truth about what it just did?

**SPEAKER NOTES:** Foundation is not "basic features work." It is "the product does not lie." Ten of these twenty findings were truthfulness defects: an invite that reported "sent" when no email left the building, a Reports page showing ₹0 for a founder with real revenue.

---

### Slide 15 · Layer 2 — Engineering
**CONTENT:** 7 audits · 36 findings · 4 critical · **CERTIFIED**
> Theme: do the actions actually reach the backend, and does the runtime stay responsive?

**SPEAKER NOTES:** Largest recovery load in the programme. The dominant pattern was systematic rather than random: id-field mismatches (`id` vs `leadId` vs `campaignId`) silently broke update and convert actions across seven modules. One naming inconsistency, seven broken surfaces.

---

### Slide 16 · Layer 3 — Intelligence
**CONTENT:** 4 audits · 7 findings · 3 critical · mean **8.67 / 10**
> Theme: is the AI honest, does memory persist, do agents actually run?

**SPEAKER NOTES:** Highest-scoring layer and the fewest findings — but three of the seven were critical, which is the highest critical density in the programme. Intelligence failures are rare and severe rather than frequent and cosmetic.

---

### Slide 17 · Layer 4 — Operations
**CONTENT:** 12 audits · 25 findings · 6 critical · mean **8.13 / 10**
> Theme: can a real business be run on this — security, DR, finance, support, continuity?

**SPEAKER NOTES:** Broadest layer, and where all three residual critical gaps live. Not a coincidence: these are the domains where the product grew business capability faster than it grew the tenancy model underneath it.

---

### Slide 18 · Layers 5 and 6 — Planned
**LAYOUT:** Deliberately greyed, dashed borders.

**CONTENT:**
> **L5 Vision** — B.20 Scalability · B.21 Compliance · B.22 Integrations · B.23 Data Governance
> **L6 Perfection** — B.24 Performance · B.25 Readiness Gate · Phase C GA
>
> Not executed. Entry criteria defined. No scores exist.

**SPEAKER NOTES:** Present entry criteria as the value here, not the audit names. B.20 cannot run until B.6's missing migration framework exists — we know that because B.6 measured its absence. The plan is derived from findings, not from a template.

---

### Slide 19 · Programme timeline
**LAYOUT:** Full-width Gantt from `03-gantt-programme.mmd`.

**SPEAKER NOTES:** Expect the "why is 9 August so dense?" question. Answer plainly: B.4–B.19 were executed as one continuous platform-certification block against a single running instance, each producing its own document with its own measurements. The density is real, and the artifacts are individually inspectable.

---

### Slide 20 · Cumulative progress
**LAYOUT:** `diagrams/svg/progress-chart.svg` full-bleed.

**SPEAKER NOTES:** Note the dashed segment explicitly — it never crosses into the solid line's territory. The chart is drawn so a screenshot taken out of context still distinguishes done from planned.

---

## SECTION 4 — LAYER FINDINGS (Slides 21–40)

### Slide 21 · Section divider — Findings
**CONTENT:** *"Nineteen of these findings would have been visible to a customer before they were visible to us."*

**SPEAKER NOTES:** Sets stakes for the section. These are not theoretical code smells.

---

### Slide 22 · A.4 — Navigation was 94% inert
**CONTENT:**
> The "More" dropdown was completely non-functional.
> **74 of ~79 product surfaces were unreachable.**

**SPEAKER NOTES:** Most of the product existed and worked; users just could not get to it. A useful reframe for investors worried about build cost — the capability was already paid for.

---

### Slide 23 · A.5 — The event loop was blocked
**CONTENT:**
> Unbounded mission-fanout loops blocked the Node event loop under load.
> Later quantified in B.1: **483 ms of blocking**, removed by a retention cap.

**SPEAKER NOTES:** 483ms of event-loop block on a single-threaded runtime means every concurrent request waits. This is the difference between a demo that works and a product that survives ten simultaneous users.

---

### Slide 24 · A.6 — Ten truthfulness defects
**CONTENT:**
> · Team invite reported "sent" — no email was sent
> · Reports showed ₹0 and "Backend unavailable" for real founder data
> · Trial start date always rendered "—"
> · Razorpay badge contradicted its own "API key configured" text

**SPEAKER NOTES:** Group these deliberately. Individually they read as small UI bugs. Together they describe a product that could not be trusted to report its own state — which is disqualifying for a business operating system, whatever the feature list says.

---

### Slide 25 · A.7 — AI reported success with empty output
**CONTENT:**
> Social content generation returned **success** with an **empty caption**.

**SPEAKER NOTES:** First appearance of the deck's recurring villain: fake success. It reappears in A.5, A.10, B.9, B.13, and B.16. Flag it now so the pattern lands later.

---

### Slide 26 · A.10 — One naming inconsistency, seven broken modules
**CONTENT:**
> `id` vs `leadId` vs `campaignId` mismatches silently broke update and convert actions across **7 modules**.

**SPEAKER NOTES:** Systematic, not random. Worth noting for engineering-quality questions: the fix was mechanical once the pattern was identified, which is why A.10 closed eight findings in a single day.

---

### Slide 27 · B.4 — Security validation
**CONTENT:**
> Production auth mode confirmed · JWT secret 128 chars
> **Dev bypass fails closed** · validated across 2 real orgs
> **Zero findings. Zero code changes.**

**SPEAKER NOTES:** The only audit with zero findings. Say so plainly and move on quickly — dwelling on the clean one undercuts the credibility built by the rest.

---

### Slide 28 · B.5 — The backups were worthless
**CONTENT:**
> Backups **omitted** `leads.json`, `organizations.json`, `billing.json`, `memory-store.json`.
> The archive ran nightly. It could not have restored the business.

**SPEAKER NOTES:** The worst class of defect: a control that appears to be working. Green cron job, growing archive files, complete confidence — and no customer data inside. B.18 later verified the fix held in production by unpacking a real archive.

---

### Slide 29 · B.6 — Persistence reality
**CONTENT:**
> **0 corrupted / 0 zero-byte across 3,438 JSON stores** (282.9 MB)
> SQLite is a passive mirror — 1 table, never read back for correctness
> **No migration framework exists.** `migration_log` table: 0 rows.

**SPEAKER NOTES:** Present the architecture honestly: whole-file JSON stores, synchronous reads and writes, single-process. It works and it is measurably uncorrupted. It is also the reason B.20 scalability cannot run yet.

---

### Slide 30 · B.7 — The confused deputy
**CONTENT:**
> `attachOrg()` gave the `X-Org-Id` header precedence over the `:orgId` path parameter.
> Permission checked the **header's** org. Handler served the **path's** org.
> **Reproduced 3/3. Cross-tenant read. Now fixed.**

**SPEAKER NOTES:** Textbook confused-deputy vulnerability and worth explaining slowly for a technical room — the authorization check and the data fetch disagreed about which tenant was being addressed. Both halves were individually reasonable. The bug lived in the gap between them.

---

### Slide 31 · B.8 — Two months of OOM restarts
**CONTENT:**
> Bringing the app under PM2 supervision immediately exposed:
> `FATAL ERROR: Reached heap limit — JavaScript heap out of memory`
> An unbounded restart loop had been running for **~2 months**, unobserved.

**SPEAKER NOTES:** Observability finding as much as a memory finding. The loop was not new; the ability to *see* it was. Good setup for B.11, because raising the heap cap from 400 MB to 1024 MB is what exposed the next defect.

---

### Slide 32 · B.9 — AI honesty under total failure
**CONTENT:**
> Test conditions: groq rate-limited (429), openai invalid (401), local unreachable.
> **Every call exercised full failover and terminated in genuine total failure.**
> `/jarvis` had reported **false success**. After fix: 0 fake successes in 20 concurrent calls.
> AI honesty dimension: **9.5 / 10**

**SPEAKER NOTES:** The credential situation was accidental and ideal — you cannot properly test failure honesty with working credentials. The sentinel string returned by `callAI()` was being passed through as though it were content.

---

### Slide 33 · B.10 — Memory destroyed by its own save
**CONTENT:**
> Store capped at 2,000 nodes, evicted by **importance alone**.
> Live store: 2000/2000 full · minimum importance present **95**
> `saveTypedMemory()` default importance: **60**
>
> Every new memory was the lowest-ranked node and was deleted **inside the same `_persist()` call that saved it** — while `save()` returned `{ saved: true }`.

**SPEAKER NOTES:** The most elegant defect in the programme, so let it land. Recall went 0/3 → 3/3 after the fix. And note the API returned `saved: true` throughout — fake success again, in a different costume.

---

### Slide 34 · B.11 — The gate rejecting 68.6% of all work
**CONTENT:**
> Resource governor rejected dispatches above a hardcoded **450 MB** heap threshold — chosen against the *old* 400 MB envelope. B.8 raised the real cap to 1024 MB. The gate was never updated.
>
> **1,371 of 2,000 runs failed `memory_pressure` — 68.6%. One distinct error cause.**
> After fix: **0.0%**

**SPEAKER NOTES:** The single most quantitatively dramatic finding. Emphasise the causal chain: B.8's fix created B.11's exposure. Two-thirds of the agent platform's work was being refused by a stale constant.

---

### Slide 35 · B.12 — A graph that had never been indexed
**CONTENT:**
> `lastIndexed: null` · **5 edges** (3 test fixtures + 2 leads)
> 1,623 missions and 11,162 knowledge items sat unlinked.
> Existing `POST /graph/index`: **1,526 edges / 2,321 nodes in 2.7 s**
>
> Switched on executive risk scoring and 7 recommendations that had returned nothing.

**SPEAKER NOTES:** Callback to slide 8. Add the detail that one generated recommendation read "Fix: memory_pressure" — the graph rediscovered B.11 from its own data.

---

### Slide 36 · B.13 — Every preview executed for real
**CONTENT:**
> `dryRun` was implemented correctly in the service — and **dropped by two wrapper layers**.
> Route read `context` only. Service called `fireRule()` with 4 args, not 5.
> **Reproduced 3/3:** each "preview" queued a real task.

**SPEAKER NOTES:** Parameter lost in transit, not absent. Relevant to how a customer would experience it: an operator testing an automation believed they were previewing, and were dispatching.

---

### Slide 37 · B.14 — Budget caps that could never fire
**CONTENT:**
> Usage ledger: **636 fully-costed events, $8.24, 30,182 tokens** — good instrumentation.
> Events carrying an `orgId`: **0**
> `monthlyCapUsd`, request caps, and the 80% alert all read that field.
> **Cost could not be allocated to a paying customer.**

**SPEAKER NOTES:** Pure revenue impact, so pitch it commercially. Metering worked; attribution did not. `/ai` routes never mounted `attachOrg`. The fix reads `orgId` from membership-verified `req.org` rather than the raw header — so a caller cannot bill another tenant.

---

### Slide 38 · B.15 — Support tickets had no owner
**CONTENT:**
> Any account could read and close another tenant's tickets.
> Org B saw Org A's subject line, full thread, and an **`INTERNAL:` note**.
> `PATCH` succeeded — **200** — reassigning and closing A's ticket.

**SPEAKER NOTES:** Most viscerally alarming finding in the deck, and it is the one that stays partly open as G1-B15. Do not soften it. The routes now forward ownership; the legacy store of 190 tickets does not have an ownership dimension to forward into.

---

### Slide 39 · B.17 — The company that could strand itself
**CONTENT:**
> `removeMember()` always refused to delete the org owner.
> `updateMemberRole()` had **no equivalent guard**.
> The sole owner PATCHed themselves to `viewer` → **HTTP 200**.
> `org_owner count: 0` — the organization became permanently unmanageable.

**SPEAKER NOTES:** A guard that exists on one path and not its twin. The protection was bypassable by demotion instead of removal. Note that no recovery path existed — every route was measured.

---

### Slide 40 · B.19 — Not certified, stated plainly
**LAYOUT:** Red-bordered. Deliberately unflattering.

**CONTENT:**
> **WCAG 2.2 Level AA was not achieved.**
> Colour contrast **3/10** · Forms **2/10** · Screen-reader semantics **3/10** · Screen-reader runtime **0/10 — not performed**
>
> 330 hardcoded white rules · 360 placeholder-only inputs · 179 unnamed · 25 of 73 contrast failures remain

**SPEAKER NOTES:** Do not rush this slide, and do not add mitigating context until asked. The audit established a real measured baseline and recovered one defect class on the highest-traffic surface, with a negative-tested regression. It did not achieve AA and says so. In an enterprise room, expect a procurement follow-up — the honest answer is that remediation is scoped as R2 and B.25 gates on it.

---

## SECTION 5 — THE THREE CRITICAL GAPS (Slides 41–48)

### Slide 41 · Section divider
**CONTENT:** *"Three gaps. One root cause. Recorded, not hidden."*

**SPEAKER NOTES:** The section that earns or loses the room.

---

### Slide 42 · The root cause
**LAYOUT:** Single statement, large.

**CONTENT:**
> Three storage models were built **before multi-tenancy existed.**
> None carries an ownership dimension.
> They are not three bugs. They are one architectural debt with three symptoms.

**SPEAKER NOTES:** Reframing three critical gaps as one remediation programme is both more honest and more reassuring — three unrelated critical isolation bugs would suggest a systemic quality problem; one dated architectural debt with three known surfaces is a tractable engineering project.

---

### Slide 43 · G1-B15 — Support ticket ownership
**CONTENT:**
> `customerSupportEngine.cjs` contains **zero** `orgId` occurrences.
> `createTicket()` has no ownership parameter. **190 tickets affected.**
> **Why open:** adding ownership to a model that has none is new capability, not recovery.
> **Closes in:** B.21

**SPEAKER NOTES:** Same structure for all three gap slides: measurement, reason open, closure audit. Consistency signals a controlled process.

---

### Slide 44 · G1-B16 — Customer engines discard scoping
**CONTENT:**
> CRM lead isolation is genuinely good — Org B saw **0** of Org A's leads, forged headers blocked.
> That scoping is **discarded at the engine boundary.**
> Org B read Org A's health score, journey record, **customer name and phone number**.
> All 5 engines: **zero** `orgId`. **0 of 123** records carry an owner.
> **Closes in:** B.23

**SPEAKER NOTES:** The most instructive of the three. The route layer is correct; the engine layer beneath it never learned about tenants. Perimeter security with an unscoped interior.

---

### Slide 45 · G1-B17 — No ownership transfer exists
**CONTENT:**
> Both member guards refuse to proceed and instruct: *"transfer ownership first."*
> **That operation was never built.**
> **Closes in:** B.25

**SPEAKER NOTES:** Almost funny, and worth delivering lightly — the system demands a prerequisite operation that does not exist. Two guards referencing a capability nobody implemented.

---

### Slide 46 · Remediation programme
**LAYOUT:** Render `08-recovery-roadmap.mmd`.

**CONTENT:**
> **R1.1** Define the ownership contract once — sourced from membership-verified `req.org`, never the raw header
> **R1.2** Backfill ownership into 3 stores — reversible migration, dry-run mode
> **R1.3** Thread `orgId` through 5 engines + 2 services — filter at the engine boundary
> **R1.4** Build `transferOwnership()`

**SPEAKER NOTES:** Sequencing is the point: contract first, then backfill, then threading. Doing it in any other order produces a second migration. R1.4 is independent and can run in parallel.

---

### Slide 47 · Verification gate
**CONTENT:**
> Two real organizations · unique leak markers
> Every cross-tenant probe returns **403 with 0 rows leaked**
> Negative-tested — the suite **must fail** against un-fixed code

**SPEAKER NOTES:** Same standard that found the gaps will verify their closure. Continuity of method is what makes the closure claim believable when it comes.

---

### Slide 48 · The other 89 gaps
**CONTENT:**
> 92 gaps recorded across executed audits · 3 critical · 3 high · 2 medium escalated to the register
> Remainder documented in-phase: B.12 (12) · B.13 (9) · B.14 (12) · B.15 (15) · B.16 (16) · B.17 (13) · B.18 (15)
> Each carries reproduction steps.

**SPEAKER NOTES:** Pre-empt "what else is in there?" The answer is: all of it, written down, in the source certifications. Offer the documents.

---

## SECTION 6 — SCORECARDS & MATURITY (Slides 49–54)

### Slide 49 · Scored audits
**LAYOUT:** `diagrams/svg/scorecard-radar.svg`.

**CONTENT:**
> B.19.2 Visual A11y **9.0** · B.10 Memory **8.7** · B.11 Agent **8.7** · B.13 Automation **8.7** · B.9 AI **8.6** · B.19.2.1 Live A11y **8.5** · B.8 DevOps **8.1** · B.7 API **7.6**
> **Mean 8.59 / 10** across 10 formally scored audits.

**SPEAKER NOTES:** Eight of thirty-one carry a formal weighted score. The other twenty-three were pass/fail against defined criteria. Do not average them together — that would be inventing a number.

---

### Slide 49a · Accessibility — the score that went down
**LAYOUT:** Four-row chain, left to right. The 8.5 row emphasised as current.

**CONTENT:**
> **B.19** NOT CERTIFIED — baseline. Forms 2/10, contrast 3/10, semantics 3/10.
> **B.19.1** CERTIFIED — all 10 foundation gates PASS. Controls named 100%, forms labeled 100%, dialogs 42/42.
> **B.19.2** 9.0 — token pairs below AA **40/90 → 0/90**. Component-CSS **4,959 → 180**. Synthetic DOM.
> **B.19.2.1** 8.5 — **current.** Live authenticated scan, 3,035 elements, 8 tabs. 180 synthetic → 0 real, but **33 live failures remain** (31 light, 2 dark).

**SPEAKER NOTES:** This is the slide I would use to answer "how do I know your numbers aren't marketing?" The accessibility score went **down**, from 9.0 to 8.5, because B.19.2.1 built a live authenticated scanner and measured the real app instead of a synthetic DOM — and the real app had failures the synthetic scan structurally could not see. A programme that only ever revises scores upward is not measuring anything. Also note what this corrects: if you read only the B.19 baseline you would badly understate where we are, and if you read only B.19.2 you would overstate it. The chain is the answer, not any single row. The 33 remaining failures have an identified, measured root cause and are the reason B.25 gates on accessibility.

---

### Slide 50 · The two weakest dimensions
**CONTENT:**
> **Response consistency 5.0 / 10** — 5 envelope variants, no pagination metadata
> **SDK readiness 5.5 / 10** — cookie-only auth blocks non-browser integrations
>
> Both in B.7. Both gate **B.22 Integrations**.

**SPEAKER NOTES:** Directly relevant to any partnership or ecosystem question. These are the two numbers that would block a partner integration programme, and they are known, scoped, and sequenced.

---

### Slide 51 · Verdict distribution
**CONTENT:**
> **15 CERTIFIED** · **15 CERTIFIED WITH LIMITATIONS** · **1 NOT CERTIFIED**

**SPEAKER NOTES:** "Certified with limitations" is the honest majority verdict. It means criteria were met and residual gaps were named — not a soft pass.

---

### Slide 52 · Maturity model
**LAYOUT:** `09-maturity-model.mmd`.

**CONTENT:**
> 1 Ad hoc → 2 Reproduced → 3 Measured → 4 Recovered → 5 Certified → 6 Self-proving
> **L1 · 4 · L2 · 4 · L3 · 5 · L4 · 5 · L5 · 1 · L6 · 1**

**SPEAKER NOTES:** L5 and L6 at level 1 is a statement of position, not a deficiency — those audits have not run. Level 6, self-proving, is the genuine long-term goal: continuous re-certification that detects drift without a human starting it.

---

### Slide 53 · Measured highlights
**LAYOUT:** `diagrams/svg/executive-dashboard.svg`.

**SPEAKER NOTES:** Let the four before/after pairs carry it. If time is short, this slide can replace 33–37 entirely.

---

### Slide 54 · What good looks like here
**CONTENT:**
> 299 / 300 routes protected · 0 corrupted stores of 3,438 · 210 / 210 agents live
> SIGKILL recovery ~11–12 s, 3 consecutive, zero unstable restarts
> 144/144 + 142/142 regression

**SPEAKER NOTES:** Balance slide. After thirteen findings slides the room needs the other half of the picture, and every number here is measured the same way the bad ones were.

---

## SECTION 7 — ROADMAP (Slides 55–62)

### Slide 55 · Certification roadmap
**LAYOUT:** `07-certification-roadmap.mmd`.

**CONTENT:**
> **Gate 0** Runtime integrity — ACHIEVED
> **Gate 1** Boundary security — ACHIEVED
> **Gate 2** Tenant ownership — PARTIAL (3 critical)
> **Gate 3** Enterprise readiness — PARTIAL (envelope, SDK, AA)
> **Gates 4–5** — PLANNED
> **Phase C** GA certification

**SPEAKER NOTES:** Gates are ordered by dependency. Nothing downstream of Gate 2 can be honestly certified while tenant ownership is open, which is why the remediation programme is the critical path.

---

### Slide 56 · Milestone roadmap
**LAYOUT:** `10-milestone-roadmap.mmd`.

**CONTENT:**
> **Achieved:** M1 Foundation · M2 Engineering · M3 Intelligence · M4 Operations
> **Planned:** M5 Tenant ownership · M6 Accessibility AA · M7 Compliance & scale · M8 Capacity · M9 Readiness gate · M10 GA

**SPEAKER NOTES:** No dates on planned milestones, and say why: sequencing is known, duration is not, and a fabricated date would be the same error as a fabricated score.

---

### Slide 57 · Critical path
**CONTENT:**
> **R1** Tenant ownership → unblocks B.21, B.23, B.25
> **R2** Accessibility AA → gates B.25
> **R3** API envelope + SDK → unblocks B.22
> **B.6** migration framework → gates B.20 → gates B.24

**SPEAKER NOTES:** R1 and R2 are independent and parallelizable. R3 depends on R1 landing first only because both touch the same route layer and serialising avoids conflict.

---

### Slide 58 · Entry criteria for planned audits
**CONTENT:**
> **B.20** ← migration framework (B.6) + stable memory envelope (B.8)
> **B.21** ← G1-B15 and G2-B15 closed
> **B.22** ← envelope unified, token auth for non-browser clients
> **B.23** ← G1-B16 org ownership threaded
> **B.24** ← RTO/RPO published (G12-B18) + scale envelope known
> **B.25** ← all three G1s closed, AA achieved

**SPEAKER NOTES:** Every criterion traces to a measured finding. This is the strongest evidence that the roadmap is derived rather than aspirational.

---

### Slide 59 · What Phase C requires
**CONTENT:**
> B.20–B.25 all CERTIFIED · **zero residual CRITICAL gaps** · ISO-style certification package · GA release authorization

**SPEAKER NOTES:** Phase C is a gate, not a task. It cannot start while any critical gap is open — which is the whole point of maintaining the register.

---

### Slide 60 · How to verify everything in this deck
**CONTENT:**
> 16 certification documents · `PHASE_B*.md`
> Git history · branch `security/reality-completion`
> Machine-readable register · `data/audit-register.json`
> Regression suites · `npm run test:runtime`

**SPEAKER NOTES:** Invite verification explicitly. A deck that tells you how to check it is making a different kind of claim than one that doesn't.

---

### Slide 61 · The position, stated plainly
**CONTENT:**
> Strong: runtime integrity, boundary security, recovery, AI honesty.
> Weak, and named: tenant ownership in pre-multi-tenancy engines, accessibility, API surface consistency.
> **None of it was found by a customer. All of it was found by the programme.**

**SPEAKER NOTES:** The closing argument. The value is not that the platform is flawless — it is that the organization finds its own problems, quantifies them, and writes them down before anyone else has to.

---

### Slide 62 · Close
**LAYOUT:** Matches slide 1.

**CONTENT:**
> # Measured, not asserted.
> Ooplix V1 Master Audit Record · OPX-MAR-001

**SPEAKER NOTES:** Land on the tagline and stop. Do not re-summarize; the register is the artifact and it speaks for itself.

---

## Appendix — Optional deep-dive slides (A1–A8)

| Slide | Topic | Use when |
|---|---|---|
| A1 | B.7 full dimension table | Technical DD asks about API maturity |
| A2 | B.11 agent runtime detail — 210 agents, tick behaviour | Asked how "autonomous" is real |
| A3 | B.18 failure induction log — SIGTERM/SIGKILL sequence | Asked about resilience evidence |
| A4 | B.5 → B.18 backup verification chain | Asked whether fixes actually hold |
| A5 | B.19 full WCAG dimension table | Enterprise accessibility procurement |
| A6 | B.14 finance ledger detail | Asked about billing integrity |
| A7 | Method — the three self-corrections in B.16 | Asked how errors in the audit itself are handled |
| A8 | Gap register, all 92 | Asked for the complete liability list |

**Note on A7.** B.16 records three corrections the auditor made to their own measurements, each of which would otherwise have been a false finding. Presenting this slide is counter-intuitive but powerful in a skeptical room: it demonstrates the process catches its own errors.
