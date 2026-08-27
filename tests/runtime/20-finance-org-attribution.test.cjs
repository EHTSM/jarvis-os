"use strict";
/**
 * Phase B.14 regression: AI spend must be attributed to the paying organization.
 *
 * usageMetering.record() has always accepted an orgId (usageMetering.cjs:87) and
 * jarvisController already passes req.org?.id (jarvisController.js:357). But the
 * /ai routes never mounted attachOrg, so req.org was undefined and all five
 * record() call sites in backend/routes/ai.js wrote orgId:null.
 *
 * Reproduced live: data/usage-ledger.ndjson held 636 events, 252 for the test
 * account, and **0** tagged with its orgId — while
 * GET /enterprise/monitoring/:orgId/ai-usage reported requestsLast1000=0 and
 * totalCostUsdSampled=0 against $8.24 of real recorded spend across 30,182
 * metered tokens. Confirmed deliberately: an /ai/chat call sent WITH X-Org-Id
 * from an account that still had quota produced a ledger row with orgId=None.
 *
 * That is a finance-grade defect: per-org AI cost, budget caps and the 80%
 * alert threshold all read from that field, so org spend reporting was
 * structurally zero regardless of actual usage.
 *
 * After mounting the existing middleware and forwarding the existing field:
 * ledger rows carry the real orgId and the org AI-usage view moved 0 → 2
 * requests. No new service, no new model, no new storage.
 *
 * These tests pin the wiring at every metering site plus the invariant that
 * makes org cost reporting possible at all.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs     = require("node:fs");
const path   = require("node:path");

const ROOT   = path.join(__dirname, "../..");
const AI_SRC = path.join(ROOT, "backend/routes/ai.js");
const metering = require("../../backend/services/usageMetering.cjs");

/** Every usageMetering.record({...}) literal in the AI routes. */
function recordBlocks() {
    const src = fs.readFileSync(AI_SRC, "utf8");
    return src.match(/usageMetering\.record\(\{[^}]*\}/g) || [];
}

describe("finance org attribution (Phase B.14)", () => {
    it("usageMetering still accepts orgId (the capability being wired)", () => {
        const src = fs.readFileSync(path.join(ROOT, "backend/services/usageMetering.cjs"), "utf8");
        assert.ok(/orgId:\s*opts\.orgId\s*\|\|\s*null/.test(src),
            "record() must persist orgId or per-org cost reporting is impossible");
    });

    it("mounts attachOrg on the AI routes that meter spend", () => {
        const src = fs.readFileSync(AI_SRC, "utf8");
        assert.ok(/require\("\.\.\/middleware\/orgMiddleware\.cjs"\)/.test(src),
            "the existing org-resolution middleware must be imported");
        assert.ok(/router\.post\("\/ai\/chat",\s*requireAuth,\s*attachOrg,/.test(src),
            "/ai/chat must resolve req.org before metering");
        assert.ok(/router\.post\("\/ai\/chat-with-tools",\s*requireAuth,\s*attachOrg,/.test(src),
            "/ai/chat-with-tools must resolve req.org before metering");
    });

    it("EVERY metering call site records orgId", () => {
        const blocks = recordBlocks();
        assert.ok(blocks.length >= 5, `expected the known 5 metering sites, found ${blocks.length}`);
        const missing = blocks.filter(b => !/orgId/.test(b));
        assert.deepEqual(missing, [],
            `every record() must carry orgId — ${missing.length} site(s) would report org spend as zero`);
    });

    it("reads orgId from the resolved org, not the raw client header", () => {
        // Trusting a raw X-Org-Id would let a caller bill another tenant.
        const src = fs.readFileSync(AI_SRC, "utf8");
        assert.ok(/orgId:\s*req\.org\?\.id/.test(src),
            "orgId must come from req.org (membership-verified by attachOrg)");
        assert.ok(!/orgId:\s*req\.headers\[/.test(src),
            "orgId must never be taken straight from a client header");
    });

    it("falls back to null rather than inventing an org", () => {
        const src = fs.readFileSync(AI_SRC, "utf8");
        assert.ok(/orgId:\s*req\.org\?\.id\s*\|\|\s*null/.test(src),
            "an unresolved org must record null, not a guessed or default org");
    });

    it("records a supplied orgId end-to-end through the metering service", () => {
        const org = `b14-org-${Date.now().toString(36)}`;
        const acct = `b14-acct-${Date.now().toString(36)}`;
        metering.record({
            accountId: acct, orgId: org, provider: "b14-test",
            model: "b14", requestType: "chat", latencyMs: 1, success: true,
        });
        const rows = fs.readFileSync(path.join(ROOT, "data/usage-ledger.ndjson"), "utf8")
            .trim().split("\n").slice(-25)
            .map(l => { try { return JSON.parse(l); } catch { return null; } })
            .filter(Boolean);
        const mine = rows.find(r => r.accountId === acct);
        assert.ok(mine, "the metered event must be persisted to the ledger");
        assert.equal(mine.orgId, org, "the ledger row must carry the supplied orgId");
    });

    it("keeps cost and token fields on the ledger (finance depends on them)", () => {
        const src = fs.readFileSync(path.join(ROOT, "backend/services/usageMetering.cjs"), "utf8");
        for (const field of ["estimatedCostUsd", "totalTokens", "inputTokens", "outputTokens"]) {
            assert.ok(src.includes(field), `${field} must remain on the ledger record`);
        }
    });
    it("propagates a denied billing status as a real HTTP 403", () => {
        // Phase B.14 second defect: the billing dashboard returned HTTP 200
        // carrying { ok:false, status:403 }. Reproduced 3/3 with a genuine
        // non-member; no data leaked, but a finance client reading HTTP status
        // would treat a permission denial as a successful empty response.
        // Every sibling route (overview/users/analytics) already returned 403.
        const src = require("node:fs").readFileSync(
            require("node:path").join(ROOT, "backend/routes/enterpriseDashboard.js"), "utf8");
        const handler = src.slice(src.indexOf('"/enterprise/dashboard/:orgId/billing"'));
        const body = handler.slice(0, handler.indexOf("});"));
        assert.ok(/res\.status\(result\.status\)/.test(body),
            "the billing route must apply the status the service returns");
        assert.ok(/result\.ok === false/.test(body),
            "only error results may be re-statused — success must stay 200");
        assert.ok(/Number\.isInteger\(result\.status\)/.test(body),
            "a non-numeric status must not be passed to res.status()");
    });
});
