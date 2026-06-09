# V5 Phase 4 — Updated Capability Matrix

**Date:** 2026-06-02

---

## V5 Phases — Cumulative Capability

| Phase | Module | Status | Assertions |
|---|---|---|---|
| Phase 1 | Unified Memory Engine | COMPLETE | 85/85 |
| Phase 2 | Goal Engine | COMPLETE | 85/85 |
| Phase 3 | Personal AI OS | COMPLETE | 85/85 |
| Phase 4 | Business AI OS | COMPLETE | 146/146 |

**Total V5 assertions passing: 401/401**

---

## Phase 4 — businessOS.cjs Capability Matrix

### Lead Management

| Capability | Entry Point | Verified |
|---|---|---|
| Capture lead with score, source, tags, assignee | `createLead(opts)` | ✓ |
| Update any lead field | `updateLead(leadId, patch)` | ✓ |
| Qualify lead (sets qualifiedAt) | `qualifyLead(leadId, opts)` | ✓ |
| Disqualify lead with reason | `disqualifyLead(leadId, reason)` | ✓ |
| Soft-delete lead | `deleteLead(leadId)` | ✓ |
| List with filters: status, source, assignee, minScore | `listLeads(opts)` | ✓ |
| Retrieve by ID | `getLead(leadId)` | ✓ |

### Contact Management (CRM)

| Capability | Entry Point | Verified |
|---|---|---|
| Create contact with title, tags, leadId | `createContact(opts)` | ✓ |
| Update contact fields | `updateContact(contactId, patch)` | ✓ |
| Soft-delete contact | `deleteContact(contactId)` | ✓ |
| Keyword search across name, email, company, title | `searchContacts(query)` | ✓ |
| List with filters: company, tags | `listContacts(opts)` | ✓ |
| Retrieve by ID | `getContact(contactId)` | ✓ |

### Sales Pipeline (Opportunities)

| Capability | Entry Point | Verified |
|---|---|---|
| Create deal with value, stage, probability, contact link | `createOpportunity(opts)` | ✓ |
| Auto-link opportunity to contact.opportunityIds | `createOpportunity(opts)` | ✓ |
| Update opportunity fields | `updateOpportunity(oppId, patch)` | ✓ |
| Advance pipeline stage (probability auto-updates) | `advanceStage(oppId, stage)` | ✓ |
| Close won (auto-records revenue) | `closeWon(oppId, opts)` | ✓ |
| Close lost with reason | `closeLost(oppId, reason)` | ✓ |
| List with filters: stage, assignee, minValue | `listOpportunities(opts)` | ✓ |
| Pipeline summary: stage counts, pipeline value, weighted value | `getPipelineSummary()` | ✓ |

### Campaign Tracking

| Capability | Entry Point | Verified |
|---|---|---|
| Create campaign with channel, budget, goals | `createCampaign(opts)` | ✓ |
| Update campaign status and fields | `updateCampaign(campaignId, patch)` | ✓ |
| Record events: impression, click, open, lead, conversion, spend, revenue | `recordCampaignEvent(campaignId, event)` | ✓ |
| Spend accumulates into campaign.spent | `recordCampaignEvent` | ✓ |
| Complete campaign | `completeCampaign(campaignId)` | ✓ |
| List with filters: status, channel | `listCampaigns(opts)` | ✓ |

### Revenue Tracking

| Capability | Entry Point | Verified |
|---|---|---|
| Record revenue event with type, source, contact/opp/campaign links | `recordRevenue(opts)` | ✓ |
| Auto-record on closeWon | `closeWon → recordRevenue` | ✓ |
| List with filters: type, dateFrom, dateTo, oppId | `listRevenue(opts)` | ✓ |
| Stats: total (refunds excluded), byType, MRR (subscription last 30d), count | `getRevenueStats(opts)` | ✓ |

### Summaries & Dashboard

| Capability | Entry Point | Verified |
|---|---|---|
| Live business dashboard: leads, pipeline, revenue, campaigns, goals | `getBusinessDashboard()` | ✓ |
| Daily business summary for any date | `getDailySummary(date?)` | ✓ |
| Weekly summary: leads, deals won/lost, win rate, revenue by type | `getWeeklySummary(weekStart?)` | ✓ |
| Pipeline summary: per-stage counts + value + weighted value | `getPipelineSummary()` | ✓ |
| Row counts across all stores | `getStats()` | ✓ |

### Memory Integration

| Capability | Entry Point | Verified |
|---|---|---|
| Cross-store search: leads + contacts + opps + campaigns | `searchBusiness(query)` | ✓ |
| Cross-namespace via unifiedMemoryEngine | `searchBusiness` (UME fallback) | ✓ |
| Business goal data in dashboard/summaries | via `goalEngine.listGoals({ type: "business" })` | ✓ |

### Error Handling

| Scenario | Behaviour | Verified |
|---|---|---|
| createLead with no name | `{ ok: false, error: "name required" }` | ✓ |
| createContact with no name | `{ ok: false, error: "name required" }` | ✓ |
| createOpportunity with no title | `{ ok: false, error: "title required" }` | ✓ |
| createCampaign with no name | `{ ok: false, error: "name required" }` | ✓ |
| updateLead unknown ID | `{ ok: false, error: "lead_not_found" }` | ✓ |
| advanceStage invalid stage name | `{ ok: false, error: "invalid_stage" }` | ✓ |
| advanceStage unknown opp ID | `{ ok: false, error: "opportunity_not_found" }` | ✓ |
| recordRevenue zero/NaN amount | `{ ok: false, error: "amount required" }` | ✓ |
| recordCampaignEvent unknown type | `{ ok: false, error: "unknown_event_type" }` | ✓ |
| searchBusiness empty query | `[]` | ✓ |

---

## Storage Summary

| File | Purpose | Cap |
|---|---|---|
| `data/business-leads.json` | Lead list | 1000 |
| `data/business-contacts.json` | CRM contacts | 2000 |
| `data/business-opportunities.json` | Sales pipeline | 500 |
| `data/business-campaigns.json` | Marketing campaigns | 200 |
| `data/business-revenue.json` | Revenue records | 5000 |

All files use atomic write (`filename.tmp` → rename), same as V1–V4.

---

## HTTP Routes Added (30 routes total)

| Prefix | Count | Auth |
|---|---|---|
| `/business/leads*` | 7 | requireAuth + operatorAudit |
| `/business/contacts*` | 5 | requireAuth + operatorAudit |
| `/business/opportunities*` | 7 | requireAuth + operatorAudit |
| `/business/campaigns*` | 6 | requireAuth + operatorAudit |
| `/business/revenue*` | 3 | requireAuth + operatorAudit |
| `/business/dashboard` | 1 | requireAuth + operatorAudit |
| `/business/summary/*` | 2 | requireAuth + operatorAudit |
| `/business/pipeline` | 1 | requireAuth + operatorAudit |
| `/business/search` | 1 | requireAuth + operatorAudit |
| `/business/stats` | 1 | requireAuth + operatorAudit |

---

## Cumulative Jarvis V5 Capability Summary

| Domain | Module | Capability |
|---|---|---|
| Memory | `unifiedMemoryEngine.cjs` | Cross-namespace indexing, search, lookup — project/workflow/incident/decision/knowledge |
| Goals | `goalEngine.cjs` | Create + milestone generation, task advancement, health scoring (0–100), velocity |
| Personal OS | `personalOS.cjs` | Tasks, notes, reminders, personal KB, daily/weekly summaries, cross-store search |
| Business OS | `businessOS.cjs` | CRM contacts, leads, pipeline, campaigns, revenue tracking, business summaries |
| Lifecycle | `productLifecycleEngine.cjs` | Product maturity scoring, debt tracking, lifecycle reports |
| Learning | `learningMemoryEngine.cjs` | Incident/RCA pattern learning, repeat detection, fix recommendations |
