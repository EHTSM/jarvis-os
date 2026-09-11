# Enterprise Capability Matrix — Enterprise Capability Expansion Mission

Generated 2026-08-02. Covers every capability evaluated in this mission, with commit references and real verification evidence. No merge, no push — all commits are on `security/reality-completion`.

## A. Implemented (real, verified, committed)

| Capability | Status | Implementation | Verification | Commit |
|---|---|---|---|---|
| DOCX export | **Wired real** | `documentExportRenderer.cjs` (docx lib) + `GET /fop/report/export?format=docx` | Real .docx bytes, valid OOXML zip, CRC-clean, PK magic bytes | `dc170ad` |
| PPTX export | **Wired real** | `documentExportRenderer.cjs` (pptxgenjs) + `GET /fop/report/export?format=pptx` | Real .pptx bytes, valid OOXML zip, CRC-clean | `dc170ad` |
| GDPR data export | **Implemented real** | `gdprExportService.cjs` aggregates real accountService/billing/organizationService/crmService/creativeAssetLibrary records by JWT-verified accountId | Real seeded account exported over HTTP, real profile/email in output JSON | `b67684f` |
| Bulk CRM import | **Implemented real** | `POST /crm/leads/import`, shared `csvParse.cjs`, reuses existing single-lead validation/dedup | Real CSV import: valid rows created, duplicate phone skipped, malformed phone rejected | `d3e0bb4` |
| Bulk Marketing import | **Implemented real** | `POST /growth/audiences/:id/import`, composes CRM bulk import + existing `addToAudience()` | Real audience created, 2 valid contacts imported and added to memberIds | `b1cbe08` |
| Knowledge Graph export | **Wired real** | `GET /graph/export`, uncapped `getEdges()` + existing `getStats()`/schema | Real edge/node-type data exported and served | `11c174c` |
| Blueprint export/import | **Implemented real** | `companyBlueprintEngine.importBlueprint()` + `GET/POST .../blueprints/:id/export` and `/import` | Full round trip: generated → exported → re-imported with new id, verified in store | `8bf4459` |
| ZIP project export | **Implemented real** | `GET /coding/patch-history/:histId/export`, archiver v7.0.1 | Real ZIP with MANIFEST.json + patched file bytes, CRC-clean, PK magic | `067d8a6` |
| OpenAPI generation | **Implemented real** | `openApiGenerator.cjs` introspects the live Express router tree (not hand-written JSDoc) | 4461 real routes / 4119 unique paths documented, valid OpenAPI 3.0.3 | `fdec531` |
| Postman generation | **Implemented real** | `postmanGenerator.cjs` derives Collection v2.1 from the same generated spec (no duplicate route walk) | Valid Postman v2.1 schema, 144 real tag folders | `fdec531` |
| Video generation | **Implemented real (credential-gated)** | `videoGeneratorAgent.generateRealVideo()` — real OpenAI Sora integration (create/poll/download) | With no key: honest `generated:false`. With an invalid key in this env: real Sora 401 surfaced end-to-end, `outputUrl` stayed null — no fabricated video | `235512c` |
| Image processing | **Implemented real** | `imageProcessorAgent.cjs` — sharp-backed resize/format-convert/rotate/grayscale | Real 100×100 PNG generated in-memory, upscaled to genuine 200×200 output (verified via `sharp.metadata()` on served bytes), grayscale JPEG conversion verified | `e407232` |
| Android packaging | **Completed real** | Ran `npx cap add android` for real (previously only documented, never executed); fixed 2 real environment bugs (drifted `typescript` transitive dep, unreachable Gradle 8.2.1 distribution URL) | Real 5.1MB signed-debug APK + real 3.9MB release AAB (502 entries, CRC-clean) built via `./gradlew` | `2fd0fca` |
| Flutter artifact generation | **Verified real** (already-existing project) | `flutter/` project already existed; ran `flutter pub get` + `flutter build apk --debug` + `flutter build appbundle --debug` | Real 156MB debug APK (compiled DEX) and real 73.5MB AAB (614 entries, CRC-clean) both built successfully, no code changes needed | — (no changes; verification only) |

## B. Declined — genuinely absent, no safe minimal implementation path

| Capability | Reason |
|---|---|
| ODT export | No viable, actively-maintained pure-JS ODT library found on npm; `officegen` exists but is effectively unmaintained. Building a compliant ODF writer from scratch is out of scope for a "wire existing code" mission. |
| GraphQL | Zero GraphQL infrastructure exists anywhere in this 4400+-route REST-only backend. Adding a GraphQL layer would be new parallel architecture, not a wire-up — explicitly excluded by the mission's "ONLY if it replaces nothing" condition, since nothing here needs replacing. |
| 3D rendering | No existing foundation (no glTF, WebGL, or renderer code anywhere in the repo). `three.js` is on npm but not installed. Building a 3D pipeline from zero has no reuse target and is a new capability domain, not a completion of a partial one. |
| Photography workflow | Would duplicate the real image processing capability just implemented (sharp-backed resize/convert). No existing shoot-planning/EXIF/batch-culling domain logic exists to wire up; building one from scratch has no clear enterprise-value justification distinct from image processing. |
| iOS packaging readiness | Confirmed via `flutter doctor` and `xcode-select -p`: only Xcode Command Line Tools are installed in this environment, not the full Xcode.app. No iOS SDK, no Simulator, no code-signing infrastructure. A real iOS build is not achievable here — reported honestly rather than faked. |

## C. Verification methodology

Every "Implemented real" row above was verified with actual generated bytes over real HTTP requests (isolated Express app, stubbed auth middleware, real `http.request` calls), not assumptions:
- Office documents: magic-byte checks (`PK` for OOXML zips), `unzip -l` structure inspection, Python `zipfile.testzip()` CRC validation.
- Images: `sharp.metadata()` re-read on served output bytes to confirm actual pixel dimensions changed.
- Mobile artifacts: `file` command, `unzip -l` (APK) and `zipfile` CRC checks (AAB), real Gradle build logs.
- Credential-gated video: tested both the no-key path and the invalid-key path (real Sora API 401), confirming the honest-failure contract holds under an actual provider error, not just absence of configuration.

All test data (seeded accounts, CRM leads, audiences, blueprints, exported files, creative-asset-library records) was cleaned from the real (gitignored) data files after each verification pass.

## D. Reuse discipline

No new parallel storage, auth, or job-queue systems were introduced. Every capability above reuses:
- `exportFileService.cjs` (new shared infrastructure, built first, then reused by DOCX/PPTX/GDPR/Knowledge Graph/Blueprint/ZIP/OpenAPI/Postman exports) — itself wrapping the pre-existing `storageService.cjs` and `creativeAssetLibrary.cjs`.
- Existing auth (`authMiddleware.js`) and org middleware (`orgMiddleware.cjs`) throughout.
- Existing `crmService`, `growthOS.cjs`, `companyBlueprintEngine.cjs`, `knowledgeGraph.cjs`, `codingAssistant.js`'s patch-history store — extended, not duplicated.
- `csvParse.cjs` — one shared parser for both bulk CRM and bulk marketing import.
- `openApiGenerator.cjs`'s output — one generation pass reused by both OpenAPI and Postman routes.
