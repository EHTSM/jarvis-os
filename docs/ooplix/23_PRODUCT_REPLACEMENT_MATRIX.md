# 23 — Product Replacement Matrix (Phase 2 & 8)

## Cross-cutting structural facts

- **Connector layer is probe-only, not sync.** `backend/services/integrationConnectors.cjs`
  (1,676 lines) has 44 real `connect*` functions (direct count this session) across
  phases A-M. Every one checks a credential and does a live HTTP reachability
  probe (`_probe()`, HEAD/GET/POST, 6s timeout) — none performs bidirectional
  create/read/update/delete against the external product's actual resources (no
  `createPage`, `createTicket`, `createBoard`, `uploadDesign`, etc. found for any
  connector). This single fact governs every "hybrid, not replace" recommendation
  below. Count discrepancy flagged, not silently resolved: prior mission memory
  says "57+ connectors," `docs/audits/ENTERPRISE-CAPABILITY-MATRIX.md` says "62,"
  direct grep today returns 44 — could be drift or a difference in what was
  counted (e.g., per-AI-provider sub-entries counted separately elsewhere).
- **No real-time/WebSocket layer exists anywhere in the codebase** (confirmed by
  grep across `backend/services/*.cjs` and `backend/server.js`). This alone caps
  Slack, Notion, Figma, and Jira/Linear-style board collaboration at RED
  regardless of any other capability.
- **`ElectronWorkspace.jsx` is a pure passthrough in web mode**
  (`if (!isElectron()) return children`, confirmed in `frontend/src/App.jsx`).
  The entire code-editor stack (CodeEditorPane, FileExplorer, TerminalPanel,
  VisualGit, AIPairProgramming, RuntimeDebugger) — and, separately, `RevenueOS.jsx`
  — exist ONLY inside the packaged Electron desktop app, never in a browser tab.
  This single gate caps both the Cursor/VS Code story and the HubSpot/Salesforce
  revenue-reporting story.

## Per-product summary

| Product | Ooplix module | Coverage | Missing | Confidence | Status |
|---|---|---|---|---|---|
| Cursor | ElectronWorkspace + `codingAssistant.js` (ACP-1..12) | Real AI ask/explain/refactor/patch generate→apply→undo loop | LSP-grade intelligence, multi-file Composer-class edits, web availability | 35% | YELLOW |
| VS Code | Same stack | CodeMirror 6, allowlisted terminal, file explorer | Extension API, DAP debugger, unrestricted terminal, web availability | 25% | RED |
| Notion | `KnowledgeCenter.jsx` / `orgKnowledgeGraph.cjs` | CRM-entity relationship graph browsing | Everything core to Notion — page/doc editor, databases, blocks, templates | 3% | RED |
| Slack | none | none | Channels, DMs, threads, real-time delivery | 2% | RED |
| Jira | `missionOrchestrator.cjs` / `MissionControlV1.jsx` | AI-agent mission lifecycle tracking, approvals, timeline | Boards, backlogs, sprints, epics, JQL — no Kanban component exists anywhere | 12% | RED |
| Linear | Same mission system | Same as Jira | Cycles, roadmap, keyboard-first UX | 10% | RED |
| n8n | `automationService.cjs` / `orgAutomationScheduler.cjs` | Real `node-cron`-backed scheduled execution | Visual node-based builder (confirmed still absent since a 2026-06 "Coming Soon" spec) | 30% | YELLOW |
| Zapier | Same automation stack | Outbound webhook trigger only | No-code app catalog, Zap authoring | 8% | RED |
| Docker Desktop | `dockerController.cjs` | Real `execFileSync`-backed container/compose ops, path-escape guarded, allowlisted | Native GUI parity (unconfirmed), Kubernetes | 45% | YELLOW |
| Canva | ODI design suite (`designSystemAI.cjs` etc.) | Token/color/spacing/typography **analysis** of Ooplix's own UI | Canvas, templates, asset export — everything | 3% | RED |
| HubSpot | Business/Sales OS (`/business/*`, `crmService.js`) | Real lead→pipeline→close→revenue lifecycle, live-tested with 2 tenants | Marketing automation, landing pages, lead scoring, real data portability | 40% | YELLOW |
| Salesforce | Same Sales OS | Same, at solo-founder scale | Custom objects, enterprise Flow builder, AppExchange, forecasting; 10-hardcoded-template model, not enterprise-customizable | 20% | RED |
| Postman | `postmanGenerator.cjs` / `apiDocs.js` | One-way OpenAPI→Postman Collection JSON export | Request sending, test scripts, mocks, collection runner — entire module is export-only, correctly not overclaimed in its own code | 2% | RED |
| Figma | ODI design suite (`liveDesignEditor.cjs` etc.) | Meta-audit of Ooplix's own running UI | Vector canvas, components, prototyping, real-time collaboration | 3% | RED |

**Summary: 0 GREEN, 4 YELLOW (Cursor, n8n, Docker Desktop, HubSpot), 10 RED.**

## Strongest and weakest findings

- **Strongest evidence (backend, live-verifiable):** `dockerController.cjs` — real
  `execFileSync("docker", ...)` calls, no shell interpolation, argument allowlist,
  compose-file path-escape guard. And the Sales OS `/business/*` pipeline —
  live-tested with two real tenants, a real defect found and fixed
  (`closeWon()` never called `recordRevenue()`), then a second self-inflicted
  double-count bug found and fixed.
- **Most disqualifying findings, from the code's own comments:**
  `KnowledgeCenter.jsx`'s header comment explicitly documents that its
  *predecessor* version was **entirely fabricated** (hardcoded seed documents,
  fake chunk counts, fake semantic-search results, persisted only to
  localStorage, zero network calls) before being rewritten as a real (but
  Notion-unrelated) knowledge graph. `designSystemAI.cjs`'s complete function
  list (`_analyzeColors`, `_analyzeSpacing`, `_analyzeTypography`, etc.) is
  100% analysis — it renders nothing, exports nothing, matching neither Canva
  nor Figma's core value proposition despite superficially adjacent naming.

## Hybrid-integration-only candidates (should NOT attempt full replacement)

1. **Slack** — `connectSlack()` exists specifically to let Ooplix *post into* a
   real Slack; no internal messaging product should be built (no chat/WebSocket
   infrastructure exists to build one on).
2. **Zapier** — its own connector code comment acknowledges Zapier's design is
   fundamentally an outbound trigger target, not something to internally rebuild.
3. **n8n / Make** — real outbound-reachability connectors exist; Ooplix's own
   scheduler is real but narrower in integration breadth. Hybrid (Ooplix
   schedules/triggers, n8n/Make handles the long tail) is the sounder path.
4. **Figma / Canva** — the ODI suite's actual job (self-auditing Ooplix's own UI)
   is valuable but orthogonal to general design tooling; probes exist to pull in
   externally-designed assets, which is the correct integration shape.
5. **Jira / Linear** — real, working auth probes against live instances exist;
   given zero board/sprint UI and the architectural cost of building one (against
   CLAUDE.md §16's caution on duplicate architecture), syncing with a team's real
   Jira/Linear is more realistic than an internal board product.
6. **Salesforce / HubSpot** (partially) — internal Sales OS is strong at
   solo-founder scale, but zero connector exists to either product; larger
   customers needing real Salesforce/HubSpot data require a hybrid sync, not a
   replacement claim.

See `evidence/product/` for the full per-product narrative (15-point breakdown
per product) and file citations.
