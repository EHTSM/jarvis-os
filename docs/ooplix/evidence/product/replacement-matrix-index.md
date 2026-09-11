# Evidence Index — Product Replacement Matrix (Phase 2 & 8)

Key files read directly this mission for the product-replacement audit:
- `backend/services/integrationConnectors.cjs` (full connector function list
  enumerated: 44 `connect*` functions across phases A-M)
- `backend/services/dockerController.cjs` (full read — real execFileSync,
  allowlist, path-escape guard)
- `backend/services/crmService.js`, `backend/routes/crm.js`
- `backend/services/designSystemAI.cjs`, `aiDesignPlanner.cjs`,
  `liveDesignEditor.cjs`, `liveDesignInspector.cjs`, `continuousDesignObserver.cjs`
  (16 design-named services total, function-level grep)
- `backend/services/postmanGenerator.cjs` (63 lines, full read)
- `backend/routes/codingAssistant.js`, `apiDocs.js`
- `frontend/src/components/KnowledgeCenter.jsx` (header comment, C10-009 mission)
- `frontend/src/components/ElectronWorkspace.jsx`, `frontend/src/App.jsx`
  (lines 77-78, 158-162 — `isElectron()` gate)
- `frontend/src/components/Chat.jsx`, `TeamWorkspace.jsx`
- `reports/OS-SALES-FINAL-CERTIFICATION.md`, `OS-SUPPORT-FINAL.md`
- `docs/audits/ENTERPRISE-CAPABILITY-MATRIX.md` (connector count discrepancy
  source: "62" vs. this session's direct count of 44)
- `WORKFLOW_OS_V2.md` (2026-06-07 spec — visual workflow builder "Coming Soon,"
  confirmed still not built as of this session's search)

No .env/credential values read. No live external API calls made — all
"connector is probe-only" conclusions are from reading the connector functions'
own source code (each function's HTTP call target and payload shape), not from
executing them.
