# OS-2 — MARKETING OS

Date: 2026-08-13 · Audit order: 3 of 8
Method: live execution, real authenticated sessions, CRUD with persistence re-reads, failure-path probes.

## Verdict: REAL + WORKING — full content lifecycle verified

### Proven by execution

| Workflow | Result |
|---|---|
| Article create `POST /content/articles` | id `art-…`, correct `orgId`, status `draft` |
| Persist check | found in `GET /content/articles` |
| Publish `POST /content/articles/:id/publish` | **status "draft" → "published", verified by re-read** |
| SEO audit | 20 checks, 8 critical issues — real analysis |
| Keywords | real search volumes (e.g. 8,100) |
| Distribution campaigns / influencers / analytics | real data |
| Content dashboard | organicScore 63, avgArticleSEO 10 |

**This is a genuine end-to-end workflow**: create → persist → state transition → verify.

### Defect found and fixed
**F-004** — `POST /content/articles/nope/publish` returned **500** for a missing entity while GET routes returned 404. Fixed in the shared `_err` helper of `contentSEO.js`.

### Gaps
- Distribution *publish* path not executed (would post to external channels).
- Calendar approve/reject untested.

---

## Scores

| Dimension | Score |
|---|---:|
| Functional Reality | 8/10 |
| Workflow Completeness | 7/10 |
| Frontend Integration | 8/10 |
| Backend Reliability | 8/10 |
| Data Integrity | 8/10 |
| Failure Honesty | 8/10 |
| Discoverability | 9/10 |
| Credential Readiness | 7/10 |
| **Total** | **63/80** |
