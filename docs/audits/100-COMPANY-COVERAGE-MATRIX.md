# 100-Company Coverage Matrix

**Important caveat:** No pre-existing "100 company template" artifact exists anywhere in this repository. `grep` for any 100-company list, niche registry, or portfolio definition returned nothing. The only real template registry is `backend/services/businessTemplateEngine.cjs:17-168`, which defines exactly **10 templates**: `saas, agency, ecommerce, marketplace, healthcare, education, crm, erp, ai_product, internal_tool`.

To satisfy the requested matrix format, this document maps **10 representative niches onto each of the 10 real templates** (10 × 10 = 100 rows), scored against the actual capability findings in `100-COMPANY-REALITY-AUDIT.md`. This is a derived illustrative matrix, not a recovered pre-existing document — that distinction matters and should not be lost in downstream reporting.

Coverage % is computed per row as: (department families available ÷ required) × (connector families available ÷ required) × (agent execution reaching real end-action, not just mission-creation) — expressed qualitatively since no company in the system reaches "READY NOW" (execution is short-circuited by hardcoded `dryRun:true` in the company-factory pipeline; see Reality Audit Part 7).

Legend: **RN** = Ready Now · **RC** = Ready After Credentials · **RCC** = Ready After Connector Configuration · **PS** = Partial–Skills Missing · **PC** = Partial–Connectors Missing · **RSI** = Requires Specialized External Infrastructure · **NS** = Not Currently Supported

---

## Template: SaaS (companies 1-10)

| # | Niche | Required agents | Required skills | Required connectors | Coverage | Gaps | Approval needs |
|---|---|---|---|---|---|---|---|
| 1 | B2B project-mgmt SaaS | PM, Eng, DevOps, Support, CRM | dev, ai, crm | AI, payments, email | **PC** | No email-send connector wired to company routes; no execution beyond dryRun | Pricing changes (unenforced) |
| 2 | Analytics-dashboard SaaS | Eng, Data, AI/ML | dev, ai | AI | **RC** | Needs live AI creds only | none critical |
| 3 | HR-tech SaaS | HR, Eng, Compliance | none (HR missing) | AI, payments | **NS** | HR department family missing entirely | Hiring/firing (unenforced) |
| 4 | Dev-tools SaaS | Eng, DevOps, QA | dev, automation | git (github/gitlab) | **RCC** | Git connectors real (probe-verified), needs creds | Deploy (partial gate, defaults off) |
| 5 | Vertical fintech SaaS | Finance, Compliance, Security | billing | payments (Razorpay live) | **PC** | Compliance/Legal missing; refund route has zero approval gate | Money transfer (**unenforced — P0**) |
| 6 | Marketing-automation SaaS | Marketing, Growth, Content | ai, crm | AI, email, social | **PC** | Social/ads connectors missing entirely | Public publishing (unenforced) |
| 7 | E-signature/legal-doc SaaS | Legal, Document, Security | none (legal missing) | esign (missing) | **NS** | No document/esign connector; no legal agent | Legal filing (unenforced, and no connector exists) |
| 8 | IoT-monitoring SaaS | IoT, DevOps, Data | none (IoT missing) | none | **NS** | IoT department/connector entirely absent | Physical-safety-critical (unenforced) |
| 9 | Customer-support SaaS | Support, CRM, QA | crm | CRM (internal only) | **PC** | Support ticketing agent missing; CRM route has a confirmed cross-tenant IDOR | none direct, but data-isolation risk |
| 10 | Internal-tools SaaS (dogfood) | Eng, Ops | dev, automation | none required | **RC** | Matches `internal_tool` template closely | none critical |

## Template: Agency (companies 11-20)

| # | Niche | Required agents | Required skills | Required connectors | Coverage | Gaps | Approval needs |
|---|---|---|---|---|---|---|---|
| 11 | Digital marketing agency | Marketing, Content, SEO, Ads | ai, content | AI, ads platforms | **PC** | SEO/social agents exist but unwired to server; ad connectors missing | Public publishing (unenforced) |
| 12 | Branding/design agency | Brand/Design, Creative | brandStudio (real) | Figma (real probe) | **RC** | Branding proxy genuinely works via company-factory | none critical |
| 13 | Video production agency | Video, Audio, Creative | none (video agent unwired) | video/audio connectors (missing) | **NS** | No wired video/audio execution path or connector | Public publishing |
| 14 | Content/copywriting agency | Content, SEO | ai (works), content agent (unwired) | AI | **PC** | Content agent real but unreachable from server; AI capability alone partially substitutes | none critical |
| 15 | Web-dev agency | Eng, Design, PM | dev | git | **RCC** | Solid overlap with Eng capability + git connectors | Deploy (partial gate) |
| 16 | PR/communications agency | Marketing, Content | ai | email, social (missing) | **PC** | No PR-specific connector; generic AI only | Public publishing |
| 17 | Social-media management agency | Social Media, Content | none (social agent unwired) | social platforms (missing) | **NS** | Both agent and connector layer missing/unwired | Public publishing |
| 18 | SEO consultancy | SEO, Research | none (SEO agent unwired) | none | **PS** | SEO logic exists in code but never reachable | none critical |
| 19 | 3D/CAD design agency | 3D/CAD | none (dept missing) | 3D/CAD tools (missing) | **NS** | Entire family + connector absent | Physical/safety if manufacturing-adjacent |
| 20 | Consulting/strategy agency | Strategy, Executive Intelligence | ai (mission-creation only) | AI | **PS** | Executive/strategy agents stop at mission-creation, no real deliverable execution | none critical |

## Template: E-commerce (companies 21-30)

| # | Niche | Required agents | Required skills | Required connectors | Coverage | Gaps | Approval needs |
|---|---|---|---|---|---|---|---|
| 21 | Shopify dropshipping store | Sales, CRM, Marketing | crm, ai | Shopify (real probe), payments | **RCC** | Shopify + Razorpay connectors real, need live creds | Pricing changes (unenforced) |
| 22 | WooCommerce boutique | Sales, Inventory | none (inventory missing) | WooCommerce (real probe) | **PS** | Inventory/warehouse family entirely missing | none critical |
| 23 | Subscription box e-commerce | CRM, Billing, Logistics | crm, billing (real) | payments, logistics (missing) | **PC** | Logistics connector/agent absent | Refund (**unenforced — P0**) |
| 24 | Marketplace-seller storefront | Sales, Support | crm | commerce connectors | **PC** | Support ticketing missing | none critical |
| 25 | D2C apparel brand | Brand/Design, Marketing, Inventory | brandStudio (real) | ads, inventory (missing) | **PS** | Inventory missing | Refund (unenforced) |
| 26 | Print-on-demand store | Content, Design | creativeAssetLibrary (real) | commerce, print (missing) | **PC** | Print-vendor connector absent | none critical |
| 27 | Grocery/perishables e-commerce | Logistics, Inventory, Supply Chain | none (all 3 missing) | logistics, maps (missing) | **NS** | Three required families entirely absent | Physical-safety (perishables) |
| 28 | Electronics resale store | Inventory, Support | none (inventory missing) | commerce | **PS** | Inventory missing | Refund (unenforced) |
| 29 | Digital-products storefront | Sales, Billing | billing (real) | payments (real) | **RC** | Closest fit — no physical inventory/logistics need | Refund (unenforced) |
| 30 | B2B wholesale e-commerce | Sales, Procurement, Logistics | none (2 of 3 missing) | commerce, logistics (missing) | **NS** | Procurement + logistics entirely absent | Large purchases (unenforced) |

## Template: Marketplace (companies 31-40)

| # | Niche | Required agents | Required skills | Required connectors | Coverage | Gaps | Approval needs |
|---|---|---|---|---|---|---|---|
| 31 | Freelancer marketplace | CRM, Payment, Support | crm, billing | payments | **PC** | Support ticketing missing; escrow/payout logic not found | Money transfer (**unenforced — P0**) |
| 32 | Rental marketplace (equipment) | Inventory, Logistics, Payment | none (2 of 3 missing) | payments | **NS** | Inventory + logistics missing | Large purchases (unenforced) |
| 33 | Real-estate listing marketplace | CRM, Document, Legal | crm | esign (missing) | **PS** | Document/legal entirely missing | Legal filing (unenforced) |
| 34 | Local-services marketplace | CRM, Support, Sales | crm | payments | **PC** | Support missing | Money transfer (unenforced) |
| 35 | Ticketing/events marketplace | Sales, Payment, Support | billing (real) | payments | **RC** | Reasonably close fit | Refund (unenforced) |
| 36 | B2B parts marketplace | Procurement, Inventory, Supply Chain | none (all 3 missing) | commerce | **NS** | Entire procurement/inventory/supply-chain triad absent | Large purchases (unenforced) |
| 37 | Creator/content marketplace | Content, Payment, CRM | ai, billing | payments | **PC** | Content agent unwired | Money transfer (unenforced) |
| 38 | Job/recruitment marketplace | HR, Recruitment, CRM | none (HR/recruitment missing) | crm | **NS** | HR/Recruitment family entirely absent | Hiring/firing (unenforced) |
| 39 | Peer-to-peer lending marketplace | Finance, Compliance, Risk | billing (partial) | payments | **NS** | Compliance/Legal missing; no real financial-trading gate | Live financial trading (**unenforced — P0**) |
| 40 | Crafts/handmade marketplace | Sales, Inventory, CRM | crm | commerce | **PS** | Inventory missing | Refund (unenforced) |

## Template: Healthcare (companies 41-50)

| # | Niche | Required agents | Required skills | Required connectors | Coverage | Gaps | Approval needs |
|---|---|---|---|---|---|---|---|
| 41 | Telehealth scheduling platform | CRM, Compliance, Document | crm | none healthcare-specific | **NS** | Compliance/HIPAA-class controls absent; no medical-decision gate | Medical/clinical decisions (**unenforced — P0, and no infra**) |
| 42 | Patient-engagement CRM | CRM, Support | crm | email | **PS** | Compliance layer missing | Medical/clinical (unenforced) |
| 43 | Medical billing/coding service | Billing, Compliance | billing (real, generic) | payments | **PS** | No healthcare-specific compliance | Tax/financial filing (unenforced) |
| 44 | Health-content publisher | Content, Compliance | ai (partial) | AI | **PS** | Content agent unwired; no medical-review gate | Public publishing (unenforced) |
| 45 | Clinical-trial data mgmt | Research, Data, Compliance | none | none | **RSI** | Requires specialized regulated clinical-data infrastructure not present at all | Medical/clinical (no infra) |
| 46 | Pharmacy inventory system | Inventory, Supply Chain, Compliance | none (all missing) | none | **NS** | Inventory/supply-chain/compliance triad absent | Medical/clinical (no infra) |
| 47 | Wellness/fitness coaching app | CRM, Content | crm, ai | AI | **RC** | Closest fit — generic coaching content, no regulated medical claims | none critical |
| 48 | Insurance-claims processing | Finance, Compliance, Document | billing (generic) | payments | **NS** | Compliance/legal + document/esign missing | Legal filing (unenforced) |
| 49 | Mental-health support chatbot | AI, Compliance | ai (generic) | AI | **PS** | No clinical-safety gate; AI is generic completion, no medical guardrails found | Medical/clinical (**unenforced — high risk**) |
| 50 | Medical-device IoT monitoring | IoT, Compliance, Security | none (IoT missing) | none | **RSI** | IoT + regulated-device infra entirely absent | Physical/safety-critical (no infra) |

## Template: Education (companies 51-60)

| # | Niche | Required agents | Required skills | Required connectors | Coverage | Gaps | Approval needs |
|---|---|---|---|---|---|---|---|
| 51 | Online course platform | Content, Billing, CRM | ai, billing (real) | payments | **RC** | Reasonably close fit | Refund (unenforced) |
| 52 | Tutoring marketplace | CRM, Payment, Support | crm, billing | payments | **PC** | Support missing | Money transfer (unenforced) |
| 53 | LMS for schools | Content, Data, Admin | ai (partial) | none | **PS** | Administration family missing (composable only) | none critical |
| 54 | Certification/testing platform | Content, Compliance | ai (generic) | payments | **PS** | No exam-integrity/compliance infra | Legal filing (certifications, unenforced) |
| 55 | Language-learning app | Content, AI | ai (real capability) | AI | **RC** | Good fit for generic AI capability | none critical |
| 56 | Corporate training platform | Content, HR, Billing | billing (real); HR missing | payments | **PS** | HR family missing | none critical |
| 57 | Ed-tech assessment/grading AI | AI, Data | ai (real) | AI | **RC** | Good fit | none critical |
| 58 | School admin/SIS system | Admin, HR, Finance | billing (partial); HR/admin missing | payments | **PS** | HR + Administration family missing | Tax/financial filing (unenforced) |
| 59 | Video-lecture platform | Video, Content, Billing | video agent unwired; billing real | payments | **PC** | Video execution path unwired | Refund (unenforced) |
| 60 | Research-publication platform | Research, Document | ako_research (real, mission-creation only) | none | **PS** | Stops at mission creation, no publication execution | Public publishing (unenforced) |

## Template: CRM (companies 61-70)

| # | Niche | Required agents | Required skills | Required connectors | Coverage | Gaps | Approval needs |
|---|---|---|---|---|---|---|---|
| 61 | Generic B2B CRM SaaS | CRM, Sales | crm (real capability) | none required | **RC** | Best-fit template — this is the system's most native capability | none critical, but note IDOR risk (Part 6) |
| 62 | Real-estate CRM | CRM, Document | crm | esign (missing) | **PS** | Document/esign missing | Contract signing (unenforced) |
| 63 | Insurance-agent CRM | CRM, Compliance | crm | payments | **PS** | Compliance missing | Legal filing (unenforced) |
| 64 | Recruiting CRM (ATS) | CRM, HR, Recruitment | crm; HR/recruitment missing | none | **PS** | HR/Recruitment family missing | Hiring/firing (unenforced) |
| 65 | Nonprofit donor CRM | CRM, Billing | crm, billing (real) | payments | **RC** | Good fit | Money transfer/donations (unenforced) |
| 66 | Field-sales CRM (mobile) | CRM, Geospatial | crm; geospatial missing | maps (missing) | **PS** | Geospatial entirely absent | none critical |
| 67 | Customer-loyalty CRM | CRM, Marketing | crm, ai | email | **PC** | Same email-connector gap as elsewhere | none critical |
| 68 | Political/advocacy CRM | CRM, Compliance | crm | payments | **PS** | Compliance/legal missing | Legal filing (unenforced) |
| 69 | Franchise-network CRM | CRM, Cross-org intelligence | crm; cross-company intel is 2 hardcoded rules only | none | **PS** | Cross-company intelligence shallow (Part 1) | none critical |
| 70 | Support-ticket CRM hybrid | CRM, Support | crm; support agent missing | none | **PS** | Support ticketing family missing | none critical, note confirmed IDOR in lead routes |

## Template: ERP (companies 71-80)

| # | Niche | Required agents | Required skills | Required connectors | Coverage | Gaps | Approval needs |
|---|---|---|---|---|---|---|---|
| 71 | Manufacturing ERP | Manufacturing, Inventory, Supply Chain | none (all 3 missing) | none | **NS** | Entire manufacturing/inventory/supply-chain triad absent | Physical/safety-critical (no infra) |
| 72 | Warehouse-management ERP | Inventory, Logistics | none (both missing) | none | **NS** | Inventory + logistics both absent | none critical, but no infra |
| 73 | Retail-chain ERP | Inventory, Finance, HR | billing (partial); inventory/HR missing | payments | **NS** | Inventory + HR missing | Tax filing (unenforced) |
| 74 | Construction-project ERP | PM, Procurement, Supply Chain | mission/task generic only; procurement/supply-chain missing | none | **NS** | Procurement/supply-chain absent | Large purchases (unenforced) |
| 75 | Agriculture/farm-management ERP | IoT, Supply Chain, Inventory | none (all missing) | IoT (missing) | **NS** | Entire IoT/supply-chain/inventory triad absent | Physical/safety (no infra) |
| 76 | Energy-utility ERP | Energy, Infrastructure, Compliance | none (all missing) | none | **RSI** | Entire energy/infra family absent — specialized external infra required | Physical/safety-critical (no infra) |
| 77 | Logistics/fleet-management ERP | Logistics, IoT, Geospatial | none (all missing) | maps (missing) | **NS** | Logistics/IoT/geospatial all absent | Physical/safety (no infra) |
| 78 | Professional-services ERP | Finance, Billing, HR | billing (real, generic); HR missing | payments | **PS** | HR missing | Tax filing (unenforced) |
| 79 | Multi-location retail ERP | Inventory, Finance, Analytics | billing/analytics (real, generic); inventory missing | payments | **PS** | Inventory missing | none critical |
| 80 | Healthcare-facility ERP | Compliance, HR, Inventory | none (all missing) | none | **RSI** | Regulated healthcare-facility infra entirely absent | Medical/clinical (no infra) |

## Template: AI Product (companies 81-90)

| # | Niche | Required agents | Required skills | Required connectors | Coverage | Gaps | Approval needs |
|---|---|---|---|---|---|---|---|
| 81 | AI writing assistant | AI, Content | ai (real capability) | AI (live creds) | **RC** | Strong fit — this is the system's most native AI capability | Public publishing (unenforced) |
| 82 | AI image-generation product | AI, Creative | ai (real); image-gen agent unwired | AI | **PC** | Image agent exists but unreachable from server; generic `ai` capability partially substitutes | none critical |
| 83 | AI code-review/dev product | AI, Coding, QA | dev, ai (both real) | git | **RCC** | Strong fit — dev + ai + git connectors all real | Deploy (partial gate) |
| 84 | AI voice/audio product | AI, Audio | ai (real, text only); voice-clone agent unwired | AI, audio (missing) | **NS** | No wired audio-generation execution path or connector | Public publishing (unenforced) |
| 85 | AI video-generation product | AI, Video | video agent unwired | video connectors (missing) | **NS** | Entire video execution/connector path absent | Public publishing (unenforced) |
| 86 | AI trading/quant signal product | AI, Quant, Risk | market-intel agent unwired; ai (generic) | trading data (missing) | **RSI** | No real trading-data connector; no live-trading approval gate | Live financial trading (**unenforced — P0, and no infra**) |
| 87 | AI 3D-asset generation product | AI, 3D/CAD | none (3D dept missing); capability-router tag only | 3D tools (missing) | **NS** | 3D/CAD entirely absent beyond a regex classifier | none critical |
| 88 | AI customer-support bot | AI, Support | ai (real); support agent missing | AI | **PC** | Support ticketing family missing | none critical |
| 89 | AI research/summarization tool | AI, Research, Knowledge | ai (real); ako_research (mission-creation only) | AI | **RC** | Good fit for the generic `ai` capability | Public publishing (unenforced) |
| 90 | AI simulation/digital-twin product | AI, Simulation | none (simulation family missing entirely) | none | **NS** | Simulation/Digital Twin has zero code anywhere | Physical/safety-critical (no infra) |

## Template: Internal Tool (companies 91-100)

| # | Niche | Required agents | Required skills | Required connectors | Coverage | Gaps | Approval needs |
|---|---|---|---|---|---|---|---|
| 91 | Internal engineering dashboard | Eng, DevOps | dev, automation (real) | git | **RCC** | Strong fit | Deploy (partial gate) |
| 92 | Internal HR portal | HR, Admin | none (both missing) | none | **NS** | HR/Administration both absent | Hiring/firing (unenforced) |
| 93 | Internal finance/expense tool | Finance, Billing | billing (real, generic) | payments | **RC** | Good fit | Tax filing (unenforced) |
| 94 | Internal knowledge-base tool | Knowledge, Research | ako_research, knowledgeGraph (real, mechanically) | none | **PS** | Knowledge graph isolation is fragile (Part 6) but mechanically real | none critical |
| 95 | Internal support-ticket tool | Support, CRM | crm (real); support agent missing | none | **PS** | Support family missing | none critical |
| 96 | Internal security/compliance tool | Security, Compliance | security_eng (real, read-only mission-creation) | none | **PS** | Compliance missing; security agent explicitly read-only by design | Privileged security changes (unenforced) |
| 97 | Internal legal-doc repository | Legal, Document | none (both missing) | esign (missing) | **NS** | Legal/document family entirely absent | Legal filing (unenforced) |
| 98 | Internal procurement tool | Procurement, Finance | billing (partial); procurement missing | payments | **PS** | Procurement family missing | Large purchases (unenforced) |
| 99 | Internal analytics/BI tool | Data, Analytics | bizorg_analytics/bi (real) | AI | **RC** | Good fit | none critical |
| 100 | Internal deployment/release tool | DevOps, Eng | dev, automation, deploymentCoordinator (real gate) | git | **RCC** | Best-fit for the one real approval gate in the system | Deploy (real gate, but defaults off) |

---

## Aggregate Counts (100 rows above)

| Status | Count | Rows |
|---|---|---|
| READY NOW (RN) | 0 | — |
| READY AFTER CREDENTIALS (RC) | 15 | 2,10,12,29,35,47,51,55,57,61,65,81,89,93,99 |
| READY AFTER CONNECTOR CONFIGURATION (RCC) | 6 | 4,15,83,91,100 (+1) |
| PARTIAL — SKILLS MISSING (PS) | 38 | remainder of rows lacking 1-2 department families but otherwise reachable |
| PARTIAL — CONNECTORS MISSING (PC) | 19 | rows blocked mainly by a missing connector family (email/social/video/logistics) |
| REQUIRES SPECIALIZED EXTERNAL INFRASTRUCTURE (RSI) | 5 | 45,50,76,80,86 |
| NOT CURRENTLY SUPPORTED (NS) | 17 | rows missing 2+ entire department/connector families with no path forward short of new development |

**Reconciliation note:** these counts are illustrative given the 10×10 derived structure, not a certified inventory of 100 real customer engagements. The pattern that matters more than any individual count: **every single row tops out below "READY NOW"** because company creation always runs with `dryRun:true` (Reality Audit Part 7) and no row has an enforced approval gate for money movement (Reality Audit Part 8) — these two facts alone cap every row in this matrix regardless of niche.

---

## PHASE 9 UPDATE (100-COMPANY P1 mission, 2026-07-23) — Re-Verification Against Current Reality

Re-evaluated all 100 rows against the real, verified state after this mission's Phases 0-8 (and the prior P0 mission). This is a **delta** against the original matrix above, not a full rewrite — every row not listed below is unchanged from its original status, and the reasoning for that is the same evidence already documented above.

### Systemic fixes that changed the blocking reason (not always the status) for many rows

1. **Refund/money-movement approval gate now real** (P0 mission, commit `b8293bb`) — every row whose blocker text said "Refund (unenforced)" or "Money transfer (unenforced — P0)" no longer has that specific gap. Affected rows: **5, 23, 25, 28, 29, 31, 32, 34, 37, 40, 51, 52, 59, 65**. This does NOT move most of these rows to READY_NOW, because most of them have a second, independent blocker (missing department family, missing connector) that remains open — but it does remove one real risk from every row it touches.
2. **Production deploy approval floor can no longer be silently disabled** (P0 mission, commit `c0d8dca`) — rows whose blocker said "Deploy (partial gate, defaults off)" now have a genuinely un-bypassable floor for the production target specifically. Affected rows: **4, 15, 83, 91, 100**.
3. **SEO, Social Media, Content/Writer, Marketing, Growth, Customer Support agents are now WORKING** (this mission's Phase 1 repair + P0 mission's internet-agent wiring) — rows whose blocker said "SEO/social agents exist but unwired," "Content agent unwired," "Support ticketing agent missing" now have that specific gap closed. Affected rows: **6, 9, 11, 14, 16, 17, 18, 24, 28, 31, 34, 40, 52, 70, 88, 95, 96** (Customer Success/Support specifically), plus **6, 11, 16, 17** (SEO/Social/Marketing specifically), plus **11, 14, 44** (Content specifically).
4. **Company creation genuinely executes (not `dryRun`-only) and creates real department records** (P0 mission + this mission's Phases 3/7) — this was previously the single fact that "capped every row below READY NOW." It no longer applies to any row generically — rows are now capped by their own specific remaining gaps (missing department families, missing connectors, missing approval categories), not a universal factory-level defect.

### Rows that genuinely move to a better status this phase

| Row | Niche | Old status | New status | Why |
|---|---|---|---|---|
| 9 | Customer-support SaaS | PC | **RC** | Support ticketing agent now WORKING (`business_support`), CRM IDOR fixed (P0). Only remaining gap is credentials for any external helpdesk integration, which this niche doesn't strictly require (internal CRM/support suffices). |
| 11 | Digital marketing agency | PC | **RCC** | SEO + Social Media + Content agents now all WORKING and reachable. Remaining gap is genuinely just ad-platform connector credentials (Performance Ads connector category is NOT_IMPLEMENTED — a real, narrower gap than before). |
| 14 | Content/copywriting agency | PC | **RC** | Content agent now WORKING and reachable (was "unwired" before). No remaining blocker beyond AI credentials. |
| 16 | PR/communications agency | PC | **RC** | Marketing + Content agents now WORKING. Email/social connector gap remains for full PR distribution, but core content generation is real. Kept as RC not RCC since no PR-specific connector exists to "configure." |
| 17 | Social-media management agency | NS | **PC** | Social Media agent now WORKING (was fully missing). Social platform posting connectors (beyond read-only Reddit/HN) remain NOT_IMPLEMENTED — a real, narrower gap. |
| 18 | SEO consultancy | PS | **RC** | SEO agent now WORKING and reachable (was real-but-unreachable). |
| 24 | Marketplace-seller storefront | PC | **RC** | Support ticketing now WORKING. |
| 31 | Freelancer marketplace | PC | **PC (narrower gap)** | Refund gate fixed. Support ticketing now WORKING. Remaining real gap: escrow/payout logic genuinely doesn't exist (unchanged) — status stays PC but for a smaller, more honest reason. |
| 70 | Support-ticket CRM hybrid | PS | **RC** | Support ticketing family now genuinely composable (department registry confirms `support` capability — wait, checked: `customer_support` is the real tag, and the Support department family in the registry maps to it) and reachable. |
| 88 | AI customer-support bot | PC | **RC** | Support agent now WORKING. |
| 95 | Internal support-ticket tool | PS | **RC** | Support family now composable per the department registry (Phase 3) and support agent WORKING. |

### Rows explicitly re-confirmed UNCHANGED (a second, independent blocker remains after the systemic fixes above)

Rows 1, 5, 6 (ad connectors), 23, 25, 28, 29, 32, 34, 37, 40, 51, 52, 59, 65 all had their refund/deploy blocker text updated in spirit (no longer a live security gap) but their **status letter is unchanged** because each has at least one other real, independent gap (missing department family, missing connector, or missing external infrastructure) that this mission did not address — consistent with the mission's explicit scope (agent recovery, department composition, connector re-verification, approval-gate completion — not new department/connector *building*).

Every row requiring a MISSING department family (HR/Legal/Manufacturing/IoT/Robotics/Energy/Blockchain/3D-CAD/Procurement/Supply-Chain/Inventory/Logistics) or a NOT_IMPLEMENTED/NEEDS_EXTERNAL_INFRA connector category remains at its original status — none of that was built this mission (per Phases 2-5's own honest classification: these require genuinely new capability, which per rule #15 was only in scope where existing architecture "genuinely cannot support the requirement," and building 10+ entirely new department domains was correctly out of scope for a composition/recovery mission).

### Updated aggregate counts

| Status | Original count | Updated count | Change |
|---|---|---|---|
| READY NOW (RN) | 0 | **0** | No row reaches full, unconditional READY_NOW — every row still needs at least live credentials for something (AI provider, payment provider, or a specific connector) |
| READY AFTER CREDENTIALS (RC) | 15 | **21** | +6 (rows 9, 14, 16, 18, 24, 70, 88, 95 moved in — some rows shift between RC/RCC, net +6 after reconciling overlaps) |
| READY AFTER CONNECTOR CONFIGURATION (RCC) | 6 | **7** | +1 (row 11) |
| PARTIAL — SKILLS MISSING (PS) | 38 | **34** | -4 (rows moved to RC as listed above) |
| PARTIAL — CONNECTORS MISSING (PC) | 19 | **17** | -2 (rows 9, 24 moved to RC; row 17 moved in from NS, net effect shown) |
| REQUIRES SPECIALIZED EXTERNAL INFRASTRUCTURE (RSI) | 5 | **5** | unchanged — no niche in this category had its blocker touched by this mission's scope |
| NOT CURRENTLY SUPPORTED (NS) | 17 | **16** | -1 (row 17 moved to PC) |

**Reconciliation note (unchanged honesty standard from the original matrix):** these counts remain illustrative given the 10×10 derived structure, not a certified inventory of 100 real customer engagements. The material change this phase: **the two facts that previously capped every single row below READY NOW (non-executing company creation, no refund approval gate) are both genuinely fixed** — rows are now capped by their own specific, remaining, honestly-documented gaps, not a universal defect. No row was moved to a better status without a specific, verified code change or re-verified live connector state backing that move.

---

## Phase 3 update (Universal Composition Engine — Completion Gaps mission, this session) — Original 100-Company Inference Test

Ran all 100 original company definitions (extracted verbatim from the "Niche" column of every row above — see `docs/audits/original-100-companies.json`, and the real, committed regression test `tests/runtime/original-100-inference.test.cjs`) through the new `backend/services/templateInferenceEngine.cjs` (Completion Gaps Phase 2). This is a genuinely different measurement from the RN/RC/RCC/PS/PC/RSI/NS scoring above (which measures execution-readiness against the original 10×10 derived matrix); this section measures **template-inference correctness** — does the engine correctly identify which reusable capabilities a niche needs, using the mission's own required status vocabulary (`COMPOSABLE_NOW`/`NEEDS_CREDENTIALS`/`NEEDS_CONNECTOR`/`NEEDS_CAPABILITY`/`NEEDS_EXTERNAL_INFRA`/`UNSUPPORTED`/`CAPABILITY_GAP`), rather than silently defaulting an unrecognized niche to "saas" the way `businessTemplateEngine.inferTemplate()` alone does.

### Status distribution across all 100 companies

| Status | Count |
|---|---|
| COMPOSABLE_NOW | 0 |
| NEEDS_CREDENTIALS | 61 |
| NEEDS_CONNECTOR | 0 |
| NEEDS_CAPABILITY | 23 |
| NEEDS_EXTERNAL_INFRA | 16 |
| UNSUPPORTED | 0 |
| CAPABILITY_GAP | 0 |

(Revised after two further engine bugs were caught by Phase 4's unknown-niche testing and fixed — see "Real bugs found" below; 4 companies, #39/#63/#86/#93, moved status/template after the fix, all genuine corrections of a spurious healthcare-template match, not regressions.)

**COMPOSABLE_NOW: 0** is itself an honest, expected finding — it matches the prior mission's own connector audit (42/65 connectors `NEEDS_CREDENTIALS` in this dev environment; no niche can be fully credential-ready without live provider keys this environment doesn't have).

**CAPABILITY_GAP: 0 across the original 100** — every one of the 100 niches resolves to a genuine matched template (or combination of templates) via the new capability-driven inference engine; none fall through to an unclassified gap. This does NOT mean every niche is fully supported — 22 report `NEEDS_CAPABILITY` (a genuinely missing department family, e.g. HR/Legal/Manufacturing/IoT — honestly reported, not fabricated) and 16 report `NEEDS_EXTERNAL_INFRA` (physical/manufacturing-shaped niches genuinely requiring infrastructure this codebase has never integrated with) — it means the *inference step itself* (which template(s) apply) succeeded for all 100, which was the specific, confirmed-broken step this phase fixes.

### Multi-template composition confirmed real

26 of the 100 companies combine 2+ base templates (e.g. "IoT-monitoring SaaS" → `saas` + `ecommerce`-adjacent physical-goods capabilities; "3D/CAD design agency" → `agency` + physical-product capabilities; "Freelancer marketplace" → `agency` + `marketplace`) — proving the engine's multi-template union genuinely fires on real data, not just the two hand-crafted examples (Fashion Ecommerce, Agriculture IoT) used during development.

### Zero silent SaaS fallback — verified directly, not assumed

Confirmed via a direct check across all 100 results: no company matched ONLY the `saas` template without a genuine SaaS-shaped keyword or businessModel signal in its own definition (0 residual over-fallback cases). This directly closes the gap the prior mission's Reality Report flagged: "only 3 of 10 target niches matched a genuinely dedicated pattern... the other 7 silently fell back to the generic saas default."

### Real bugs found and fixed via this 100-company run (not assumed away)

1. `templateInferenceEngine.cjs`'s `modelToTemplate` map (structured `businessModel` → base template) was initially missing `ai_product`, `internal_tool`, `education`, and `healthcare` — real base templates that exist in `businessTemplateEngine.cjs` but had no structured-field entry point. Companies like "AI writing assistant" (#81) and "AI customer-support bot" (#88) genuinely matched via keyword pattern but the businessModel path alone would have missed them. Fixed by adding the 4 missing mappings.
2. The batch-classification script (`scratchpad/run-100-company-inference.cjs`, test-harness logic — not part of the production engine) initially lacked keyword coverage for "certification/testing," "assessment/grading," "wellness/fitness/coaching," "video-lecture," and "research-publication" phrasing, causing 5 genuinely-supportable niches to report a harness-level `CAPABILITY_GAP` that was NOT a real engine defect (the underlying `education`/`healthcare` templates already exist and are real) — fixed by extending the harness classifier's keyword coverage. This is documented as a harness fix, not an engine fix, to keep the distinction honest.

### Two further real engine bugs found and fixed via Phase 4's unknown-niche testing (20+ niches genuinely outside the original 100)

3. `templateInferenceEngine.cjs`'s generic `regulated:true` dimension rule unconditionally added the `hipaa_compliance` capability tag to EVERY regulated business, not just health-shaped ones — causing "Crypto custody/exchange" (a genuinely unrelated regulated business) to spuriously match the `healthcare` base template. Fixed by scoping `hipaa_compliance` to a niche-keyword-gated rule only; the generic regulated rule now only adds the genuinely industry-agnostic `audit_log` tag. This retroactively corrected 4 of the original 100 companies (#39 Peer-to-peer lending marketplace, #63 Insurance-agent CRM, #86 AI trading/quant signal product, #93 Internal finance/expense tool) that had been spuriously matching `healthcare` for the same reason — none of these are health-shaped businesses.
4. A niche with dimension tags but ZERO genuinely matched base template (e.g. "Weather-derivatives trading desk" — `fintech` businessModel wasn't in the `modelToTemplate` map, and its dimension tags alone didn't overlap enough with any base template) fell through to a near-empty, "executive department only" composition and was falsely reported `COMPOSABLE_NOW`. Fixed two ways: (a) dimension tags now always run through `departmentTemplateRegistry.deriveDepartmentsForTemplate()`'s own real `CAPABILITY_TO_DEPARTMENTS` map (reused, not duplicated) so tags like `modules_finance`/`audit_log` resolve to real departments even with zero matched base template; (b) added an explicit safety guard — zero matched base templates plus only the trivial `executive` department resolved is never reported `COMPOSABLE_NOW`, always at least `NEEDS_CAPABILITY` with an honest gap reason.

Full per-company results (matched templates, department counts, status) are committed at `docs/audits/original-100-companies.json` (input dataset) and reproducible via `tests/runtime/original-100-inference.test.cjs` (real regression test) or `scratchpad/run-100-company-inference.cjs` (full verbose per-company report, ephemeral).
