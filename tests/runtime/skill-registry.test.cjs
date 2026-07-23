"use strict";
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "../../data/skills.json");
let _backup = null;

before(() => {
    try { _backup = fs.readFileSync(DATA_FILE, "utf8"); } catch { _backup = null; }
});
after(() => {
    if (_backup !== null) fs.writeFileSync(DATA_FILE, _backup);
    else { try { fs.unlinkSync(DATA_FILE); } catch {} }
});

const skillRegistry = require("../../backend/services/skillRegistry.cjs");

describe("skillRegistry", () => {

    describe("seed data — the deduplicated skill inventory", () => {
        it("seeds exactly 60 skills on first read (46 agentRegistry + 12 engineeringCapabilities + 2 department-template skill tags added in Phase 1 blueprint-validation)", () => {
            const skills = skillRegistry.listSkills();
            assert.equal(skills.length, 60);
        });
        it("every seeded skill has a non-empty executionHandler", () => {
            for (const s of skillRegistry.listSkills()) {
                assert.ok(s.executionHandler && s.executionHandler.length > 0, `skill ${s.id} missing executionHandler`);
            }
        });
        it("every seeded skill declares a riskLevel", () => {
            for (const s of skillRegistry.listSkills()) {
                assert.ok(["low", "medium", "high"].includes(s.riskLevel), `skill ${s.id} has invalid riskLevel: ${s.riskLevel}`);
            }
        });
        it("no duplicate skill ids", () => {
            const ids = skillRegistry.listSkills().map(s => s.id);
            assert.equal(ids.length, new Set(ids).size, "expected no duplicate skill ids");
        });
    });

    describe("getSkill() / findByCapability()", () => {
        it("returns a real, previously-verified skill by id", () => {
            const skill = skillRegistry.getSkill("crm");
            assert.ok(skill);
            assert.equal(skill.executionHandler, "crm");
        });
        it("returns null for an unknown skill id", () => {
            assert.equal(skillRegistry.getSkill("totally-fake-skill-xyz"), null);
        });
        it("findByCapability() is equivalent to getSkill() (capability lookup)", () => {
            assert.deepEqual(skillRegistry.findByCapability("terminal"), skillRegistry.getSkill("terminal"));
        });
        it("returns a copy, not a live reference", () => {
            const s1 = skillRegistry.getSkill("crm");
            s1.name = "MUTATED";
            const s2 = skillRegistry.getSkill("crm");
            assert.notEqual(s2.name, "MUTATED");
        });
    });

    describe("registerSkill()", () => {
        it("registers a new, valid skill", () => {
            const registered = skillRegistry.registerSkill({
                id: `test-new-skill-${Date.now()}`, name: "Test Skill", category: "test",
                riskLevel: "low", executionHandler: "ai", version: "1.0.0",
            });
            assert.ok(registered);
            assert.equal(registered.riskLevel, "low");
        });
        it("rejects a skill missing required fields", () => {
            assert.throws(() => skillRegistry.registerSkill({ id: "bad-skill" }));
        });
        it("rejects a raw secret field in a skill definition", () => {
            assert.throws(() => skillRegistry.registerSkill({
                id: `test-secret-skill-${Date.now()}`, name: "Bad Skill", category: "test",
                riskLevel: "low", executionHandler: "ai", version: "1.0.0", apiKey: "sk_should_be_rejected",
            }));
        });
        it("rejects registering a duplicate skill id", () => {
            assert.throws(() => skillRegistry.registerSkill({
                id: "crm", name: "Duplicate CRM", category: "sales",
                riskLevel: "low", executionHandler: "crm", version: "1.0.0",
            }));
        });
        it("a newly registered pending skill is queryable but distinguishable from active skills", () => {
            const id = `test-pending-skill-${Date.now()}`;
            skillRegistry.registerSkill({
                id, name: "Pending Skill", category: "test", riskLevel: "medium",
                executionHandler: "ai", version: "1.0.0", healthStatus: "pending",
            });
            const found = skillRegistry.getSkill(id);
            assert.equal(found.healthStatus, "pending");
        });
    });

    describe("verifyNoOrphans() — every registered skill resolves to a real handler", () => {
        // agentRegistry.cjs is a lazy, empty Map until bootstrapRuntime.cjs
        // runs (which happens at real server startup) — require it here so
        // verifyNoOrphans() has the real 38-agent/46-capability runtime to
        // check against, exactly as production does.
        before(() => { require("../../agents/runtime/bootstrapRuntime.cjs"); });

        it("the real seeded inventory has zero orphaned executionHandler references", () => {
            const result = skillRegistry.verifyNoOrphans();
            assert.deepEqual(result.orphans, []);
            assert.equal(result.ok, true);
        });
        it("detects an orphan when one is deliberately introduced", () => {
            skillRegistry.registerSkill({
                id: `test-orphan-${Date.now()}`, name: "Orphan Skill", category: "test",
                riskLevel: "low", executionHandler: "totally-nonexistent-handler-xyz", version: "1.0.0",
            });
            const result = skillRegistry.verifyNoOrphans();
            assert.equal(result.ok, false);
            assert.ok(result.orphans.length > 0);
        });
    });
});
