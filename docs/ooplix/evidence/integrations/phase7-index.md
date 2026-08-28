# Evidence Index — Integrations (Phase 7)

Primary file: `backend/services/integrationConnectors.cjs` (1,676 lines, full
function-name enumeration via grep — 44 `connect*` functions counted
directly), cross-referenced against `docs/audits/ENTERPRISE-CAPABILITY-MATRIX.md`
(cites "62 connector functions") and prior mission memory (cites "57+
connectors") — discrepancy reported, not resolved, per CLAUDE.md §9's
directive.

Supporting files confirmed to exist and checked for deeper-than-probe
integration: `backend/services/paymentService.js` (real HMAC webhook
verification), `backend/services/sentryService.cjs` (real bidirectional
error-reporting wiring), `backend/routes/payment.js`, `backend/services/aiService.js`
(14 real AI provider integrations, distinct code path from the connector
probes).

No live external API calls made to verify any connector — all "probe-only"
conclusions are from reading each connector function's own source code (HTTP
call target and payload shape), not from executing them. No `.env`/credential
values read.
