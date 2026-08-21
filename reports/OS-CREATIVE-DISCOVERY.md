# OS-CREATIVE — DISCOVERY REPORT

**Track:** OOPLIX OS #13 — Creative Studio
**Date:** 2026-08-15 · **Branch:** `security/reality-completion`
**Method:** Repository inspection BEFORE any change. **No new creative platform was built.**
**Isolation:** Verification server on **port 5177**. The Audit Track's own concurrent server
(port 5050, PID confirmed via `lsof`) was checked before and after every process action this pass —
confirmed untouched throughout.

---

## 1. Method

Traced the actual route mount (`backend/routes/creativeStudio.js`, 808 lines) and every service it
calls. No feature was classified as missing from a guessed URL — every capability below was either
found directly in the route file or proven absent by grep across the whole repository.

---

## 2. What Creative Studio actually is

One real, coherent system — 10 modules, all mounted under `/creative/*`, all behind a single
`requireAuth` + rate-limiter (30 req/60s) gate:

| Module | Prefix | Service |
|---|---|---|
| 1. Creative Registry | `/creative/registry/*` | `creativeRegistry.cjs` — static catalog of 15 capabilities × providers, no tenant data |
| 2. Unified Creative Router | `/creative/route/*` | `creativeRouter.cjs` — intent detection, provider selection, credit reservation |
| 3. Image Studio | `/creative/image/*` | real DALL-E 3 (`imageGeneratorAgent.cjs`), real sharp pixel processing (`imageProcessorAgent.cjs`) |
| 4. Video Studio | `/creative/video/*` | real OpenAI Sora (`videoGeneratorAgent.cjs`) |
| 5. Voice Studio | `/creative/voice/*` | real ElevenLabs/OpenAI TTS (`voiceCloningAgent.cjs`) |
| 6. Brand Studio | `/creative/brand/*` | `brandStudio.cjs` — brand kits, identity briefs |
| 7. Social Content Engine | `/creative/social/*` | `socialContentEngine.cjs` + real X/Twitter posting (`socialPostingService.cjs`) |
| 8. Creative Workspace | `/creative/workspace/*` | dashboard composition over jobs/assets/kits |
| 9. Asset Library | `/creative/assets/*` | `creativeAssetLibrary.cjs` — unified store for every studio's output |
| 10. Commercial Benchmark | `/creative/benchmark` | `creativeBenchmark.cjs` — internal capability self-test |

## 3. Backend inventory

| File | Lines | Role |
|---|---:|---|
| `backend/routes/creativeStudio.js` | 808 (+76 this pass's fix) | All 10 modules' routes |
| `backend/services/creativeAssetLibrary.cjs` | 252 | Asset store — `data/creative-assets.ndjson` + `data/creative-asset-index.json` |
| `backend/services/creativeJobQueue.cjs` | 138 (+12 this pass's fix) | Job lifecycle — `data/creative-jobs.json` |
| `backend/services/brandStudio.cjs` | 176 | Brand kits — `data/brand-kits.json` |
| `backend/services/creativeRouter.cjs` | 171 | Intent → capability → provider → credits |
| `backend/services/creativeRegistry.cjs` | 231 | Static capability/provider catalog |
| `backend/services/creativeBenchmark.cjs` | 199 | Self-test harness |
| `backend/services/socialContentEngine.cjs` | ~200 | Social caption generation + history |
| `frontend/src/components/CreativeStudio.jsx` | 766 | 7 tabs: Workspace, Image, Video, Voice, Brand, Social, Assets, Benchmark |

Prior hardening already documented in the file's own comments and confirmed live: real DALL-E 3 /
Sora / ElevenLabs / sharp wiring (Enterprise Import/Export Validation + Capability Expansion
missions — previously every capability went through a text-LLM stub that never produced real
media); TOCTOU credit-reservation race fix (25 concurrent requests against a balance of 20 all
proceeding pre-fix, now correctly capped); Phase A.11.3 fix scoping `assets.getStats()`/
`getFolders()`/`getTags()` by `accountId` (previously global counts leaked next to an
account-scoped asset list).

## 4. Tenant model — Creative Studio has no org/workspace scoping at all

Unlike every other OS audited this session, `creativeStudio.js` never calls `attachOrg`,
`requireOrgMember`, `attachWorkspace`, or `requireWorkspaceMember` on its main router (only the two
social-publish routes optionally use `attachOrg`, non-blocking). Every route identifies the caller
purely by `accountId` (`req.user.sub`). This is confirmed by direct code inspection of every route
handler in the file — there is no `:orgId` or `:workspaceId` path segment anywhere in this router.
**This is Creative Studio's actual, intended tenant model: per-account, not per-org.** Its
underlying data model (`creativeAssetLibrary.cjs`, `brandStudio.cjs`) does carry an optional
`orgId` field used correctly by *other* OSs that integrate with it (Company Factory, GDPR export,
Knowledge Graph — see §7), but Creative Studio's own routes never set or filter by it.

## 5. Real generation vs. honest fallback — measured, not assumed

| Capability class | Real generator | Evidence |
|---|---|---|
| `image_generate`, `logo_generate`, `banner_generate` | Real DALL-E 3 call via `imageGeneratorAgent.cjs` | Live-tested: honest `401` from OpenAI (no credential configured in this environment), `generated:false`, real error text surfaced — not fabricated |
| `text_to_speech` | Real ElevenLabs/OpenAI TTS | Same credential-blocked pattern, wired for real MP3 output when configured |
| `text_to_video` | Real OpenAI Sora | Same pattern, wired for real MP4 output when configured |
| `image_upscale`, `image_edit` (with a real source image) | Real `sharp` pixel processing — no AI credential needed | Not independently exercised this pass (no test image supplied); code path confirmed present |
| Every other capability (`image_to_video`, `background_remove`, `speech_to_text`, `music_generate`, `animation_generate`, `voice_clone`, ad/presentation generation) | No real byte-producing generator | Falls back to a text-only AI description with `generated:false` and an explicit `note` field — never claims a real asset was produced |

## 6. Genuine gaps found by discovery (not built)

1. **No "project" concept at all.** No `/creative/project*` routes, no project entity anywhere in
   the data model. Creative Studio is asset/job-centric, not project-centric — confirmed absent,
   not a guessed omission.
2. **No template catalog/listing/apply workflow.** The only "template" surface is
   `POST /creative/brand/:id/template` — appending a free-form object to a brand kit's `templates`
   array. No `GET /creative/templates`, no built-in template set, no "apply template" action exists.
3. **No export/download capability for creative assets.** A real, well-built export system exists
   (`exportFileService.cjs` + `GET /exports/:orgScope/:filename`, org-scoped, real file-serving) but
   **`creativeStudio.js` never calls it** — confirmed via repo-wide grep. Assets are only ever
   fetched via their generation `url` (the `/creative/image|video|audio/file/:filename` static
   routes), never bundled/exported as a download.
4. **No sharing or collaboration functionality anywhere** — confirmed absent by grep across both
   the route file and the frontend component; not a UI mock, genuinely does not exist.
5. **Two of the module-1 registry's real generators exist but were previously unwired**
   (documented as already fixed prior to this pass — see §3).

## 7. Real cross-OS integration found (verified, not re-audited)

| Boundary | Mechanism | Isolation |
|---|---|---|
| Company Factory → Brand Studio | `companyFactory.js` calls `brandStudio.getKitForOrg(company.orgId)`/`createKit({orgId})` | Correctly org-scoped, gated by `_requireCompanyOrgPermission` |
| GDPR Export → Asset Library | `gdprExportService.cjs` calls `creativeAssetLibrary.listAssets({accountId})` | Correctly account-scoped — a person's data export contains only their own assets |
| Org Knowledge Graph → Asset Library | `orgKnowledgeGraph.cjs` calls `listAssets({orgId})`, indexes as graph nodes | Correctly org-scoped |
| CRM Service | Cites `creativeAssetLibrary.cjs`'s `orgId: opts.orgId || null` convention as the model it copied to fix its own org-isolation bug | Confirms the asset library's `orgId` field is real and filterable, even though Creative Studio's own routes never use it |

All four integrations are genuinely functional and correctly isolated by the integrating system —
none of them route through Creative Studio's own (unscoped) endpoints.

## 8. The genuine defect found (see Security report for full detail)

**Every id-addressed record in Creative Studio (assets, brand kits, jobs) had no ownership check.**
`creativeAssetLibrary.cjs`, `brandStudio.cjs`, and `creativeJobQueue.cjs` all key their
getters/mutators purely by the record's own generated id, with no `accountId` parameter in their
API at all. Combined with the route file performing no ownership check of its own, any
authenticated account that knew or guessed another account's asset/brand-kit/job id could read,
mutate, and — for assets and brand kits — permanently delete or overwrite it. Live-reproduced with
two real accounts before fixing. **Fixed** — see Security report.

---

**Outcome:** Creative Studio is a real, substantial, mostly account-correctly-scoped system with
genuine AI generation wiring and genuine (if narrower than the mission's checklist) feature
coverage. One critical, real, destructive cross-account defect found and fixed. Several features
the mission asked about (projects, templates, export, sharing) are genuinely absent, not
mis-implemented — documented as gaps, not built. **0 systems built.**
