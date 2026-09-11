"use strict";
/**
 * Phase B.16 regression: customer operations must be reachable, consistent,
 * honest, ownership-stable, and attributable.
 *
 * Reproduced live against the running product with TWO real organizations
 * (org A / org B) and three customer records:
 *
 * D1 — /customer-org/{journey,health,automation}/stats were registered AFTER
 *      their /:customerId siblings, so Express matched "stats" as a customer id
 *      and all three answered 404 ("journey not found" / "health record not
 *      found" / "automation not found"). The statistics existed and held real
 *      data (59 journeys, 59 health records with atRisk=27, 501 automations) —
 *      they were simply unreachable over HTTP. /journey/stages was already
 *      ordered correctly, which is what exposed the pattern.
 *
 * D2 — customerJourneyEngine.getStats() spread the STORED d.stats, whose
 *      byStage was computed by syncJourneys() from the pre-merge lead list.
 *      Because customerId prefers lead.userId, multiple leads collapse into one
 *      journey (7 customerIds were shared by 2–5 leads each). Result: total=60
 *      while byStage summed to 71, and the two customer-reporting surfaces gave
 *      different answers to the same question — getStats said lead=17,
 *      qualification=43; getStageDistribution said 12 and 37 from the same store.
 *
 * D3 — customerAutomationEngine.trigger() with skipExecute:true set
 *      status="executed" and stamped executedAt (commented "test mode"). The
 *      guard correctly skipped the real work, but the record claimed it had run:
 *      skipExecute true and false were indistinguishable. getStats() counted
 *      these toward `executed` and `minutesSaved` (12,230 min ≈ 204 hours).
 *
 * D4 — PATCH /crm/lead/:phone passed req.body straight through, so orgId and
 *      userId were client-editable. Reproduced: a caller moved its OWN lead to
 *      {"orgId":"org_HIJACK"} with 200 and the lead vanished from its owner's
 *      list (3 visible → 2), stranded with no transfer/merge/archive/restore
 *      route to recover it (all 404). Stealing ANOTHER org's lead was already
 *      correctly blocked with 403 — this is the reverse direction.
 *
 * D5 — operatorAudit recorded only request metadata (method/path/status/ip).
 *      516 CRM audit entries existed with no way to tell who made any change.
 *
 * All five recover capability that already existed. No new CRM entity, no new
 * Customer Success engine, no new storage.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs     = require("node:fs");
const path   = require("node:path");

const ROOT   = path.join(__dirname, "../..");
const CORG   = path.join(ROOT, "backend/routes/customerOrg.js");
const CRM_RT = path.join(ROOT, "backend/routes/crm.js");
const AUDIT  = path.join(ROOT, "backend/middleware/operatorAudit.js");

const journey = require("../../backend/services/customerJourneyEngine.cjs");
const autoEng = require("../../backend/services/customerAutomationEngine.cjs");
const crm     = require("../../backend/services/crmService.js");

const read = p => fs.readFileSync(p, "utf8");

/** Index of the first registration of `pathLiteral` in the route file. */
function routeIdx(src, pathLiteral) {
    return src.indexOf(`"${pathLiteral}"`);
}

describe("customer operations integrity (Phase B.16)", () => {
    // ── D1: route ordering ───────────────────────────────────────────────────
    it("registers each /stats route BEFORE its /:param sibling", () => {
        const src = read(CORG);
        const pairs = [
            ["/customer-org/journey/stats",    "/customer-org/journey/:customerId"],
            ["/customer-org/health/stats",     "/customer-org/health/:customerId"],
            ["/customer-org/automation/stats", "/customer-org/automation/:id"],
        ];
        for (const [literal, param] of pairs) {
            const a = routeIdx(src, literal), b = routeIdx(src, param);
            assert.ok(a !== -1, `${literal} must exist`);
            assert.ok(b !== -1, `${param} must exist`);
            assert.ok(a < b,
                `${literal} must be registered before ${param}, or Express matches ` +
                `"stats" as the parameter and the route 404s`);
        }
    });

    it("declares each /stats route exactly once", () => {
        const src = read(CORG);
        for (const p of ["/customer-org/journey/stats", "/customer-org/health/stats",
                         "/customer-org/automation/stats"]) {
            const n = src.split(`"${p}"`).length - 1;
            assert.equal(n, 1, `${p} must be declared once, found ${n}`);
        }
    });

    it("keeps the stats functions working (the capability being exposed)", () => {
        for (const [name, fn] of [["journey", journey.getStats], ["automation", autoEng.getStats]]) {
            const s = fn();
            assert.ok(s && typeof s.total === "number", `${name} getStats must return a total`);
        }
    });

    // ── D2: reporting consistency ────────────────────────────────────────────
    it("getStats().byStage sums to getStats().total", () => {
        const s   = journey.getStats();
        const sum = Object.values(s.byStage).reduce((a, b) => a + b, 0);
        assert.equal(sum, s.total,
            `byStage summed to ${sum} but total is ${s.total} — byStage was counting ` +
            `pre-merge leads while total counted distinct customers`);
    });

    it("getStats and getStageDistribution agree stage-by-stage", () => {
        const a = journey.getStats().byStage;
        const b = journey.getStageDistribution().stages;
        for (const stage of Object.keys(b)) {
            assert.equal(a[stage], b[stage],
                `stage "${stage}": getStats says ${a[stage]}, getStageDistribution says ` +
                `${b[stage]} — two customer-reporting surfaces must not disagree`);
        }
    });

    it("recomputes byStage from stored journeys rather than trusting saved stats", () => {
        const src = read(path.join(ROOT, "backend/services/customerJourneyEngine.cjs"));
        const fn  = src.slice(src.indexOf("function getStats"));
        const body = fn.slice(0, fn.indexOf("\nmodule.exports"));
        assert.ok(/d\.journeys\.forEach\(j => \{ byStage\[j\.stage\]/.test(body),
            "getStats must recompute byStage from d.journeys");
        assert.ok(/total: d\.journeys\.length/.test(body),
            "total must come from the stored journeys, consistent with byStage");
    });

    // ── D3: preview honesty ──────────────────────────────────────────────────
    it("reports a skipped automation as skipped, not executed", async () => {
        const r = await autoEng.trigger("b16-regression-cust", "follow_up", { skipExecute: true });
        assert.equal(r.ok, true, "the trigger itself must still succeed");
        assert.equal(r.automation.status, "skipped",
            'a preview must not claim status "executed"');
        assert.equal(r.automation.executedAt, undefined,
            "a preview must not carry an executedAt timestamp");
        assert.equal(r.automation.skipped, true, "the preview must be marked");
    });

    it("excludes skipped automations from executed count and minutesSaved", async () => {
        // The store is a 500-record ring buffer (slice(-500)), so absolute
        // counts drift as old rows are evicted. Assert the invariant instead:
        // no record marked skipped may be counted as executed or contribute
        // minutes, and skipped rows must still be reported.
        await autoEng.trigger("b16-regression-cust", "follow_up", { skipExecute: true });
        const s = autoEng.getStats();
        const d = JSON.parse(read(path.join(ROOT, "data/customer-automations.json")));
        const rows = d.automations || [];

        const skipped = rows.filter(a => a.status === "skipped");
        assert.ok(skipped.length >= 1, "the preview must be persisted as skipped");
        assert.equal(skipped.filter(a => a.executedAt).length, 0,
            "no skipped automation may carry an executedAt timestamp");
        assert.equal(rows.filter(a => a.status === "executed" && a.skipped).length, 0,
            "a preview must never also be counted as executed");
        // `executed` must exclude previews. Compare against the store's own
        // executed rows without asserting an exact equality that a concurrent
        // append (or the 500-row ring buffer) could shift by one.
        assert.ok(s.executed <= rows.filter(a => a.status === "executed").length + 1,
            "`executed` must not exceed the genuinely-executed rows in the store");
        // minutesSaved must be credited only for executed rows. Assert the
        // structural rule rather than an exact total: this is a live store that
        // other callers append to, so an arithmetic window would be flaky.
        const src = read(path.join(ROOT, "backend/services/customerAutomationEngine.cjs"));
        const stats = src.slice(src.indexOf("function _updateStats"));
        const statsBody = stats.slice(0, stats.indexOf("\n}"));
        assert.ok(/status === "executed"\)\s*\n?\s*\.reduce/.test(statsBody.replace(/\s+/g, m => m)),
            "minutesSaved must be summed only over status === \"executed\" rows");
        assert.ok(/const skipped\s+= d\.automations\.filter\(a => a\.status === "skipped"\)/.test(statsBody),
            "skipped previews must be counted separately, never as executed");
        assert.ok(s.skipped >= 1, "previews must still be reported, as `skipped`");
    });

    it("still executes for real when skipExecute is false", async () => {
        const r = await autoEng.trigger("b16-regression-cust", "follow_up", { skipExecute: false });
        assert.equal(r.automation.status, "executed", "real runs must still execute");
        assert.ok(r.automation.executedAt, "a real run must stamp executedAt");
    });

    // ── D4: ownership stability ──────────────────────────────────────────────
    it("strips orgId and userId from a non-operator PATCH body", () => {
        const src = read(CRM_RT);
        const handler = src.slice(src.indexOf('router.patch("/crm/lead/:phone"'));
        const body = handler.slice(0, handler.indexOf("\n});"));
        assert.ok(/const \{ orgId: _o, userId: _u, \.\.\.rest \} = update;/.test(body),
            "ownership fields must be stripped or a tenant can orphan its own lead");
        assert.ok(/req\.user\.role !== "operator"/.test(body),
            "operators must retain the ability to re-home a lead");
    });

    it("keeps the existing cross-org ownership check intact", () => {
        const src = read(CRM_RT);
        const handler = src.slice(src.indexOf('router.patch("/crm/lead/:phone"'));
        assert.ok(/Forbidden — not your lead/.test(handler.slice(0, 900)),
            "the 403 that blocks editing another account's lead must remain");
    });

    it("still scopes CRM leads by org (capability must survive)", () => {
        // getLeads(status, orgId) has always supported org filtering — the fix
        // must not disturb it.
        const all = crm.getLeads();
        const scoped = crm.getLeads(undefined, "b16-definitely-no-such-org");
        assert.equal(scoped.length, 0, "an unknown org must resolve to zero leads");
        assert.ok(all.length >= scoped.length, "the unscoped view must be a superset");
    });

    // ── D5: audit attribution ────────────────────────────────────────────────
    it("records the acting identity on every audited request", () => {
        const src = read(AUDIT);
        assert.ok(/actor:\s+req\.user\?\.sub \|\| req\.user\?\.id \|\| null/.test(src),
            "the audit entry must carry the actor — the field a customer audit exists for");
        assert.ok(/actorRole:\s+req\.user\?\.role \|\| null/.test(src),
            "the actor's role must be recorded");
        assert.ok(/orgId:\s+req\.org\?\.id \|\| null/.test(src),
            "the acting org must be recorded");
    });

    it("never lets audit failure break the request", () => {
        const src = read(AUDIT);
        assert.ok(/catch \{ \/\* never crash on audit failure \*\/ \}/.test(src),
            "audit must remain fire-and-forget");
    });

    // ── limit clamps (B.7 pattern, extended to customer routes) ──────────────
    it("clamps list limits on the customer routes", () => {
        const src = read(CORG);
        const clamped = (src.match(/Math\.max\(1, Math\.min\(parseInt\(/g) || []).length;
        assert.ok(clamped >= 4,
            `expected the customer list/history limits to be clamped, found ${clamped}`);
        const clamp = l => Math.max(1, Math.min(parseInt(l) || 50, 500));
        assert.equal(clamp("-1"), 1, "a negative limit must not reach slice(0, -1)");
        assert.equal(clamp("99999"), 500, "an oversized limit must be capped");
    });
});
