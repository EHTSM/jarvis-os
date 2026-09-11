# OOPLIX 380-ITEM STRATEGIC BUILD ORDER

TAXONOMY SOURCE: Founder-authoritative 1–380 taxonomy, verified exact count (380 items) and continuous
numbering before use (anchors checked: 1=Identity, 55=Sales, 56=CRM, 319=Command, 351=Task Discovery,
380=Civilization-Scale — all confirmed). Item names used verbatim, unmodified, unreordered.

**STATUS:** AUDIT-ONLY companion to `reports/OOPLIX-380-MASTER-COVERAGE-MATRIX.md`. This is a
commercial-leverage prioritization document, not a sequential 1–380 build plan. No production code was
modified to produce this document.

**SCORE:** N/A (strategy/prioritization document, not a certification).

**CONFIDENCE:** High for "what already exists" claims (cited directly from the companion matrix and
underlying reports). Medium for commercial-leverage ranking itself, since that judgment is inherently
founder-context-dependent (target customer segment, current revenue mix) which this audit does not have
direct visibility into beyond what the repo's own missions (CO1-CO3, Launch Platform, Alpha/Beta/RC
programs) document about the intended solo-founder SaaS audience.

---

## HOW "COMMERCIAL LEVERAGE" WAS JUDGED

Not sequential item number. Ranking criteria, in order:
1. **Closes a real production blocker** for launching the core SaaS product itself (billing, auth,
   deployment) — these unlock revenue directly, independent of any specific vertical.
2. **Strengthens a capability that many other items already depend on** (registries, execution chain,
   connector metadata) — leverage multiplies because dozens of domain items in the matrix cite it as a
   dependency.
3. **Closes a disclosed, already-identified gap** with a small, well-scoped fix (per the six PHASE
   progress reports' own "genuine gap closed" lists) rather than requiring a new subsystem.
4. **Matches the product's actual identity** (AI agent OS, execution/automation platform) rather than a
   generic vertical feature that any competitor could build.

Items graded G (FUTURE SPECIALIZATION) or F (MISSING) in niche physical-goods verticals were
deliberately excluded from the TOP 50 — building e.g. a native inventory/warehouse engine has real
engineering cost and no evidence of founder-stated demand; see DO NOT BUILD YET below.

---

## TOP 10 NEXT (highest commercial leverage)

1. **Close the 54/62 undeclared-connector-capability metadata gap** (items 19/340/345, Integration/
   Connector Registry) — this single fix unblocks real (non-mocked) cross-app execution for
   `universalExecutionGateway.cjs`, which is the mechanism nearly every domain item in the matrix
   ultimately routes through. Highest leverage-per-effort item in the entire audit: it is documentation/
   metadata work (author capability declarations for existing, already-built connectors), not new code.
2. **Execute a real deployment rehearsal against a real VPS** (items 4/115/116, Deployment/
   Infrastructure) — everything else in the ERA-1 certification is code-side DONE; this is the single
   step that converts "READY FOR MANUAL PRODUCTION VALIDATION" into an actual live launch.
3. **Set real production credential values** (`JWT_SECRET`/`OPERATOR_PASSWORD_HASH`/`BASE_URL`, live
   payment/email provider keys) — item 41/43 (Billing/Payment) and item 1 (Identity) are all blocked on
   this single manual step, per `docs/audits/CREDENTIAL-CANONICAL-MAP.md`.
4. **Make the 5 founder DECISION REQUIRED calls** (nginx topology, RPO, RTO, launch connector scope,
   storage choice) — these are pure decisions, zero engineering cost, and they are the literal blocking
   dependency for items 4, 19, 22/133, 116, and 185.
5. **Land and verify the in-progress Phase 2/3/4/5 fixes** (credential redaction in `missionMemory.cjs`,
   `rolledback`-state reachability + approval-resume bridge in `missionOrchestrator.cjs`, marketplace
   review-route IDOR fix, `/p20/improve/apply` gate) — these are already-written, already-tested fixes
   sitting uncommitted on the current branch; committing them (once the founder/owning session is ready)
   closes 4 real, already-proven defects at near-zero incremental cost.
6. **Execute the queued test-isolation fix** for the platform test suites (`civ-v9`/`eco-v8`/`ent-v7`/
   `auto-v10`/`eos-v6`/`post-omega-p*.test.cjs`) that mutate the real `data/missions.json` — prevents
   recreating the exact 176-record pollution Mission 98 just surgically repaired, and unblocks safely
   running the full regression corpus again with confidence.
7. **Install `pm2-logrotate` and cron-wire `monitor.sh`/`validate-production.sh`** — small, well-scoped,
   prevents an unbounded-log-growth incident on a freshly-launched real host (item 22/135).
8. **Live-verify billing (Razorpay/Stripe) end-to-end once credentials exist** — item 41/43's remaining
   gap after item 3 above; this is the difference between "FUNCTIONAL" and actually collecting real
   revenue.
9. **Live-verify the 9 social-platform posting connectors** (item 72) once OAuth credentials/approvals
   exist — high leverage for the Marketing/Growth category's actual go-to-market motion (G1-G3 missions
   already built the orchestration; only live credentials are missing).
10. **Decide the storage location (cloud vs. local disk) and act on it** — item 185/Mission 80
    DECISION-5; blocks nothing code-side but blocks operational confidence in backup/DR posture (items
    133/134) until resolved.

---

## TOP 25 NEXT (extends the Top 10)

11. Author a formal, founder-facing decision log resolving nginx single- vs. multi-site topology
    (technical default already set to single-domain; needs an explicit founder sign-off to close).
12. Wire `monitor.sh`/disk-alert output into a real notification channel (email/Slack) rather than
    manual invocation only.
13. Re-run the full `test:runtime`/`test:security` corpus once the test-isolation fix (Top 10 #6) lands,
    to get a fresh, trustworthy full-corpus baseline (last full run in Mission 92 was interrupted before
    its aggregate line printed).
14. Clear the two confirmed-stale lock artifacts (`.git/index.lock`, any future
    `data/missions.json.lock` recurrence) as an explicitly-authorized, trivial follow-on.
15. Formalize the RPO/RTO decision into an actual automated backup cadence (beyond the current manual
    scripts) once the founder's numbers are set.
16. Expand `frontend/src/*Api.js` coverage audit (CLAUDE.md §12) specifically for the routes touched by
    the in-progress Phase 3/4/5 fixes, to confirm the frontend contract wasn't left half-updated.
17. Live-verify the WhatsApp/Telegram/SMS messaging connectors (item 302) end-to-end with real
    credentials, since these are core to the founder's own stated communication-first product surface.
18. Close the remaining Data-Cleaning gap (item 170) with a lightweight dedup pass inside the existing
    ingest normalizers (`businessEventAdapter.cjs`) — small, contained, improves Data/AI category depth.
19. Add a dedicated human-employee HR module (items 96-107) only if/when the founder actually hires — do
    not build speculatively (see DO NOT BUILD YET).
20. Build a native Shopify/WooCommerce connector (beyond the current credential-slot + browser-
    automation pattern) if a real e-commerce customer segment materializes — currently BUILT-BY-REUSE,
    functional but shallow (items 84-85).
21. Add expense-tracking (item 53) as a lightweight extension of `orgBudgets.cjs` if founder or early
    customers request it — small scope, clear existing extension point.
22. Add time-tracking (item 285) for the Professional-Services/Agency segment if that customer type is
    pursued — currently the single clearest MISSING item with a plausible near-term customer ask.
23. Pursue formal SOC2/compliance certification (items 8/146) only once enterprise sales pipeline
    materializes — code-side controls already exist; the gap is external certification cost/timeline,
    not code.
24. Build translation/i18n support (item 192) if international customer demand is confirmed — the C.8
    Internationalization audit already found no i18n architecture exists; this is a real, scoped gap
    with existing audit evidence to build from.
25. Add OCR (item 193) only if a document-heavy customer workflow specifically requires scanned-document
    ingestion — currently zero evidence of need.

---

## TOP 50 NEXT (extends Top 25 — lower-leverage but still real, non-vertical gaps)

26. Consolidate the Trust (item 5)/Risk (item 9)/Strategy (item 27)/Resource (item 21)/Budget (item 48)/
    Performance (item 37) "internal signal, not a product surface" items into first-class dashboard
    metrics if the founder wants a unified "platform health" view — currently all D (CODE EXISTS/NOT
    VERIFIED as standalone), all real signals used internally.
27. Build a merchant product-catalog/order/inventory model (items 86/88/89) only if the E-commerce
    segment is formally pursued (currently zero evidence of near-term need).
28. Add a dedicated notes/knowledge-capture surface beyond `founderJournal.cjs` (item 191) if the
    founder wants a general-purpose notes app distinct from the journal.
29. Build a paid-ads connector (item 73) once organic Growth OS traction data justifies paid acquisition
    spend.
30. Add a reputation/review-aggregation connector (item 81) if the founder's customer base grows large
    enough for review management to matter.
31. Build a marketing-funnel-specific A/B testing surface (item 79) distinct from the existing
    self-improvement `experimentManager.cjs`, if conversion-rate optimization becomes a stated priority.
32. Add music-generation to Creative Studio (item 200) if content-creator customer segment requests it.
33. Add an interactive presentation/slide editor (item 204) beyond the existing static PPTX export.
34. Build an ATS/recruiting integration (item 97) only once the founder or a customer segment is
    actually hiring at scale.
35. Add a compensation-management module (item 104) — likely deferred indefinitely for a solo-founder
    tool; revisit only alongside item 19/106 (Payroll) if headcount grows.
36. Build a dedicated project-entity model distinct from missions (item 30) if customer feedback
    specifically asks for Gantt/kanban-shaped UX.
37. Add case-management (item 150) or IP-filing tracking (item 151) only if a legal-services customer
    segment is pursued.
38. Build a licensing/permit-tracking module (items 155-156) only for a government/regulated-industry
    customer segment, which is not currently a stated target.
39. Add a records-management/digital-archive retention-policy engine (items 188-189) beyond the current
    audit-log rotation, if compliance requirements tighten.
40. Build a real-time document co-editing surface (item 190's CRDT/concurrent-cursor gap) if multi-user
    simultaneous document editing becomes a stated product need.
41. Add a dedicated "trust score" UI surface for `operatorTrustModel.cjs`'s existing internal signal
    (item 5) if the founder wants operator-trust visibility as a first-class feature.
42. Build a supplier/vendor-relationship-management layer (items 159-160) if B2B procurement becomes a
    target customer segment.
43. Add a Substack-style newsletter-publishing platform (item 294) beyond the current Growth OS Email
    module, if content monetization becomes a stated priority.
44. Build a digital-product/membership storefront (items 291-292) beyond the existing Subscriptions
    module, for the Creator Economy segment specifically.
45. Add a dedicated conversion-rate/experimentation engine for marketing funnels (item 79), separate
    from the self-improvement `experimentManager.cjs`.
46. Build an internal IT helpdesk/ticketing system (item 136) distinct from `customerSupportEngine.cjs`,
    if the founder's own team grows large enough to need it.
47. Add corporate-endpoint/MDM device management (items 127-128) only if the founder's team uses
    company-managed devices at scale.
48. Build a formal case for pursuing the Science category (item 295) as a genuine external-customer
    vertical, distinct from its current self-improvement-research scope — requires founder validation
    that real scientific-research customers are a target before any code investment.
49. Reassess Legal (147-157) beyond document generation — case management, IP filing — only if a legal-
    services customer segment is validated.
50. Revisit Healthcare/Insurance (214-228) only with an explicit founder decision to pursue that
    vertical and fund the accompanying compliance program (HIPAA/PHI) — never build the UI ahead of the
    compliance work.

---

## DO NOT BUILD YET

These categories/items showed zero real demand signal in this repo's own evidence (no route, no
service, no mission ever attempted them) and building them speculatively would violate CLAUDE.md §16's
anti-duplication and §17's anti-fake-data principles by creating unused surface area:

- **Healthcare / Insurance / Real Estate / Travel / Manufacturing / Automotive / Energy / Telecom /
  Agriculture (items 214-279, minus the template-classification-only sliver already built)** — zero
  evidence of founder-stated customer demand; each would require a dedicated compliance/domain-data
  program before any UI is safely buildable (see Part 6 of the companion matrix's security implications
  section).
- **Procurement (158-167)** — zero evidence anywhere; a full B2B procurement suite is a large,
  multi-quarter investment with no signal it's needed for a solo-founder SaaS OS.
- **Banking/Treasury (44-45)** — open-banking integration is a heavy compliance lift (PCI/banking
  regulations) with no evidence of need beyond the existing Stripe/Razorpay billing rails.
- **Payroll/Benefits/Recruitment (97, 104-106)** — defer until the founder actually has employees;
  building an HRIS ahead of headcount is pure speculative cost.
- **POS (245)** — point-of-sale hardware/software integration has no evidence of relevance to this
  product's actual customer base.
- **A from-scratch generative agent-design capability (item 371, beyond the existing templated
  `agentFactoryAutomation.cjs`)** — the existing template-based factory already serves the "create a new
  agent instance" need; a fully generative agent-architecture-design tool is a research-grade
  investment with no current evidence it's blocking anything.

---

## MARKETPLACE-FIRST AREAS

Areas better served by pointing customers at an existing marketplace/ecosystem integration than by a
native Ooplix build:

- **Accounting/Tax (items 40, 46)** — integrate QuickBooks/Xero/Stripe Tax rather than build native
  bookkeeping or tax-filing logic; this is standard SaaS practice and the compliance risk of a native
  tax engine is disproportionate to the benefit.
- **Payroll (items 47, 106)** — integrate Gusto/Deel/Rippling rather than build a compliant payroll-run
  engine natively.
- **Banking (item 44)** — integrate Plaid or a similar open-banking aggregator rather than build direct
  bank-API integrations.
- **ATS/Recruiting (item 97)** — integrate Greenhouse/Lever rather than build a native applicant-
  tracking system.
- **Meeting/Video (item 304)** — integrate Zoom/Google Meet APIs rather than build native video
  conferencing.
- **OCR/Translation (items 192-193)** — integrate a provider (Google Cloud Vision/DeepL) rather than
  train or host native models.
- **Ad-buying (item 73)** — integrate Google Ads/Meta Ads Manager APIs rather than build a native
  ad-serving/bidding engine.

## INTERNAL-BUILD AREAS

Areas that should remain native Ooplix builds because they are the product's actual differentiation and
already have deep, tested investment:

- **JARVIS Autonomy (319-337), Universal Capability (338-350), Universal Execution (351-365)** — this
  is the product's core IP; no external platform could substitute for it.
- **Engineering/Software (108-125)** — the AI Coding Program (ACP-1..12) is a mature, differentiated,
  already-built internal capability; there is no reason to outsource it.
- **Data/AI (168-183)** — the multi-provider AI orchestration layer (`aiService.js`, 12 providers) is
  core infrastructure that every other domain depends on.
- **Creative Studio (194-204)** — already deeply built across Image/Video/Voice/Brand/Social with real
  agent-level generation; a genuine product strength worth continued internal investment.
- **Marketing/Growth (68-82)** — the G1-G4 missions represent a complete, tested, internally-owned
  growth stack; continued internal investment here compounds directly on existing work.
- **Personal OS (310-318)** — the founder-personal-assistant layer is a core identity feature of
  "JARVIS" specifically; not something to delegate to a third party.

---

## UNIVERSAL EXECUTION COVERAGE MAPPING

Per-domain mapping of the Intent→Capability→Agent→Workflow→Tool→Connector→Execution→Verification→
Evidence→Memory→Learning→Controlled-Evolution chain, citing the real component at each step where one
exists. "—" marks a step with no dedicated component for that domain (served generically or missing).

| Domain | Intent | Capability | Agent | Workflow | Tool | Connector | Execution | Verification | Evidence | Memory | Learning | Controlled Evolution |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Engineering** | `taskUnderstanding.cjs` | `engineeringCapabilities.cjs` | `agents/dev/*` | `engineeringOrgWorkflow.cjs` | `codeReviewEngine.cjs` | `gitHubEngineeringAgent.cjs` | `agentExecutionEngine.cjs` | `executionVerifier.cjs` | `executionEvidence.cjs` | `engineeringMemoryEngine.cjs` | `continuousLearningEngine.cjs` | `engineeringEvolutionEngine.cjs` |
| **Business** | `taskUnderstanding.cjs` | `skillRegistry.cjs` | `agents/business/*` | `businessOrgWorkflow.cjs` | `businessDataService.cjs` | `integrationConnectors.cjs` | `missionOrchestrator.cjs` | `executionValidator.cjs` | `businessQualityEngine.cjs` | `missionMemory.cjs` | `businessPredictionEngine.cjs` | `businessEvolutionEngine.cjs` |
| **Marketing/Growth** | `capabilityRouting.cjs` | `skillRegistry.cjs` (growth entries) | `agents/business/marketingAgent.cjs` | `growthOS.cjs` automation module | `contentSEOEngine.cjs` | 9 social-platform posting services | `socialPostingService.cjs` | — (no dedicated verification step found) | `launchMetrics.cjs` | `missionMemory.cjs` | — | — |
| **Creative** | `capabilityRouting.cjs` | `creativeRegistry.cjs` | `agents/content/*` | `creativeRouter.cjs` | `creativeJobQueue.cjs` | AI image/video/voice provider APIs | `creativeJobQueue.cjs` | `visionQA.cjs` | `creativeBenchmark.cjs` | `designMemory.cjs` | `designPredictionEngine.cjs` | `designEvolutionEngine.cjs` |
| **Knowledge** | `taskUnderstanding.cjs` | `skillRegistry.cjs` | — (no dedicated knowledge agent) | `akoWorkflow.cjs` | `knowledgeGraph.cjs` | — | `autonomousKnowledgeOrg.cjs` | `knowledgeQualityEngine.cjs` | `knowledgeDiscoveryEngine.cjs` | `knowledgeGraph.cjs` | `knowledgePredictionEngine.cjs` | `knowledgeEvolutionEngine.cjs` |
| **Evolution/Self-Improvement** | `taskUnderstanding.cjs` | `capabilityDiscovery.cjs` | `agentRuntimeSupervisor.cjs` | `aeoWorkflow.cjs` | `selfImprovementEngine.cjs` | — (internal only) | `improvementLoopEngine.cjs` | `selfReviewEngine.cjs` | `consolidationAudit.cjs` | `learningMemoryEngine.cjs` | `runtimePatternRecognition.cjs` | `evolutionEvolutionEngine.cjs` |
| **Physical World** | `taskUnderstanding.cjs` | `skillRegistry.cjs` | — | `physicalWorkflowEngine.cjs` | `deviceOrchestrationEngine.cjs` | `deviceRegistryEngine.cjs` | `physicalWorkflowEngine.cjs` | `deviceHealthEngine.cjs` | — | — | — | — |
| **Commerce/Retail (niche verticals)** | — | `businessTemplateEngine.cjs` (classification only) | — | — | browser automation only | — | `browserController.cjs` (browser-automation fallback) | — | — | — | — | — |

**Reading this table:** the chain is fully populated (every step has a real, named component) for
Engineering, Business, Creative, Knowledge, and Evolution/Self-Improvement — the domains this product
was actually built to serve. It thins out for Marketing/Growth (verification/learning steps missing —
posting succeeds but no dedicated post-hoc quality/learning loop was found distinct from the generic
`missionMemory.cjs`) and Physical World (evidence/memory/learning steps missing — P17 is younger,
less mature). It is nearly empty for niche Commerce/Retail verticals, correctly reflecting their
FUTURE SPECIALIZATION status in the companion matrix rather than a gap this document invents evidence
to fill.

---

## GIT INTEGRITY

Same state as documented in the companion report's GIT INTEGRITY section — this document adds one more
file to "FILES MODIFIED BY THIS AUDIT" and changes nothing else.

**FILES MODIFIED BY THIS AUDIT:**
- `reports/OOPLIX-380-MASTER-COVERAGE-MATRIX.md` (created)
- `reports/OOPLIX-380-STRATEGIC-BUILD-ORDER.md` (created, this file)

**COMMIT:** NONE
**PUSH:** NONE
**DEPLOY:** NONE
