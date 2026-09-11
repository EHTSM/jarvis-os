"use strict";
/**
 * Phase 1 — Capability Coverage (Missions 101-120).
 *
 * Covers the new composition layers built this mission:
 *   - capabilityDiscovery.cjs (NL intent -> skillRegistry capability)
 *   - capabilityRouting.cjs   (capability -> agent/connector/approval)
 *   - skillRegistry.cjs's new syncFromSeed() backfill
 *
 * Isolated from real data/skills.json via JARVIS_TEST_DATA_SUFFIX (same
 * pattern as skill-registry.test.cjs) — must be set before skillRegistry
 * is first required by ANY module in this process, including transitively
 * via capabilityDiscovery/capabilityRouting.
 */
process.env.JARVIS_TEST_DATA_SUFFIX = `test-${process.pid}-${Date.now()}`;

const { describe, it, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, `../../data/skills.${process.env.JARVIS_TEST_DATA_SUFFIX}.json`);
after(() => { try { fs.unlinkSync(DATA_FILE); } catch {} });

const skillRegistry = require("../../backend/services/skillRegistry.cjs");
const discovery = require("../../backend/services/capabilityDiscovery.cjs");
const routing = require("../../backend/services/capabilityRouting.cjs");

describe("capabilityDiscovery", () => {

    describe("discoverySelfCheck() — no fabricated references", () => {
        it("every KEYWORD_HINTS and DOMAIN_ALIASES target resolves to a real skillRegistry entry", () => {
            const check = discovery.discoverySelfCheck();
            assert.deepEqual(check.danglingHints, []);
            assert.deepEqual(check.danglingAliases, []);
            assert.equal(check.ok, true);
        });
    });

    describe("discover() — exact and keyword matching", () => {
        it("exact skill id match scores highest and is returned first", () => {
            const { matches } = discovery.discover("crm");
            assert.ok(matches.length > 0);
            assert.equal(matches[0].skillId, "crm");
            assert.ok(matches[0].reason.includes("exact_id_match"));
        });
        it("keyword hint resolves a natural-language phrase to a real capability", () => {
            const { matches } = discovery.discover("I need to qualify a new lead");
            assert.ok(matches.length > 0);
            assert.equal(matches[0].skillId, "crm");
        });
        it("an intent with no plausible match still returns a shaped result, not a crash", () => {
            const result = discovery.discover("zzz_totally_unmatched_gibberish_query_xyz");
            assert.ok(Array.isArray(result.matches));
        });
    });

    describe("discover() — domain filtering", () => {
        it("domain alias resolves to the real category and filters matches", () => {
            const { matches, domain } = discovery.discover("", { domain: "hr" });
            assert.equal(domain, "hr_recruitment");
            assert.ok(matches.length > 0);
            for (const m of matches) assert.equal(m.category, "hr_recruitment");
        });
        it("domain filter combined with text only returns matches in that domain", () => {
            const { matches } = discovery.discover("generate", { domain: "legal" });
            for (const m of matches) assert.equal(m.category, "legal_compliance");
        });
    });

    describe("listDomains() — real, live-computed coverage", () => {
        it("every domain entry's skillCount matches its skills array length", () => {
            for (const d of discovery.listDomains()) {
                assert.equal(d.skillCount, d.skills.length);
            }
        });
        it("covers every category actually present in skillRegistry", () => {
            const liveCategories = new Set(skillRegistry.listSkills().map(s => s.category));
            const domainNames = new Set(discovery.listDomains().map(d => d.domain));
            assert.deepEqual(domainNames, liveCategories);
        });
    });
});

describe("capabilityRouting", () => {

    describe("routeCapability() — unknown capability", () => {
        it("returns ok:false with unknown_capability reason, never throws", () => {
            const result = routing.routeCapability("totally-fake-capability-xyz");
            assert.equal(result.ok, false);
            assert.ok(result.blockedReasons.includes("unknown_capability"));
            assert.deepEqual(result.eligibleAgents, []);
        });
    });

    describe("routeCapability() — risk-based approval gating", () => {
        it("a high-riskLevel capability requires approval by default", () => {
            const result = routing.routeCapability("employment_action_review");
            assert.equal(result.riskLevel, "high");
            assert.equal(result.approvalRequired, true);
        });
        it("a low-riskLevel capability does not require approval by default", () => {
            const result = routing.routeCapability("crm");
            assert.equal(result.riskLevel, "low");
            assert.equal(result.approvalRequired, false);
        });
        it("requireApprovalAbove option can tighten the threshold", () => {
            const result = routing.routeCapability("crm", { requireApprovalAbove: "low" });
            assert.equal(result.approvalRequired, true);
        });
    });

    describe("routeCapability() — composability reflects skillRegistry state", () => {
        it("a real, active, non-orphaned skill is composable", () => {
            const result = routing.routeCapability("git_commit");
            assert.equal(result.composable, true);
        });
    });

    describe("routeIntent() — discovery+routing chain", () => {
        it("routes an intent through discovery to a real capability decision", () => {
            // No agentRegistry bootstrap in this isolated test process, so
            // eligibleAgents is honestly empty here (no_eligible_agent) —
            // this asserts the discovery->capability chain resolved
            // correctly, not full end-to-end agent availability (covered
            // live in the manual verification against a bootstrapped
            // runtime; see the mission report).
            const result = routing.routeIntent("I need to qualify a new lead");
            assert.equal(result.capabilityId, "crm");
            assert.equal(result.riskLevel, "low");
            assert.ok(Array.isArray(result.alternatives));
        });
        it("an intent with zero discoverable matches is reported, not fabricated", () => {
            // No agent/domain hints at all and empty text -> discovery returns [].
            const result = routing.routeIntent("");
            assert.equal(result.ok, false);
            assert.ok(result.blockedReasons.includes("no_capability_match"));
        });
    });
});

describe("skillRegistry.syncFromSeed() — additive backfill, no mutation", () => {
    it("is idempotent: a second run adds nothing once the store matches the seed", () => {
        const first = skillRegistry.syncFromSeed();
        const second = skillRegistry.syncFromSeed();
        assert.equal(second.addedCount, 0);
        assert.equal(second.skippedCount, first.totalSeed);
    });

    it("never mutates an already-registered skill's fields", () => {
        const before = skillRegistry.getSkill("crm");
        skillRegistry.syncFromSeed();
        const after = skillRegistry.getSkill("crm");
        assert.deepEqual(before, after);
    });

    it("registered skills resolve with zero orphans against skillRegistry's own check", () => {
        // Isolated test process has no agentRegistry bootstrapped, so
        // agentRegistry-sourced skills are expected to orphan here — this
        // assertion only checks engineeringCapabilities-sourced skills,
        // which resolve against engineeringCapabilities.cjs directly
        // (no runtime bootstrap required).
        const { orphans } = skillRegistry.verifyNoOrphans();
        const engOrphans = orphans.filter(id => {
            const s = skillRegistry.getSkill(id);
            return s && s.source === "engineeringCapabilities";
        });
        assert.deepEqual(engOrphans, [], `engineeringCapabilities-sourced skills should never orphan: ${engOrphans}`);
    });
});
