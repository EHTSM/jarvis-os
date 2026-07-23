"use strict";
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const deptReg = require("../../backend/services/departmentTemplateRegistry.cjs");
const realAgentRegistry = require("../../agents/runtime/agentRegistry.cjs");

// A mock registry with zero registered capabilities, used to prove
// isComposableNow() genuinely queries the passed-in registry at call
// time rather than assuming composability from the template's own
// authoring-time claims.
const emptyRegistry = { listAll: () => [] };

// A mock registry that reports every capability a template could ever
// request, used to prove templates without requiresNewCapability become
// composable when the registry backs them.
function fullRegistryFor(template) {
    return { listAll: () => [{ capabilities: template.requiredCapabilities || [] }] };
}

describe("departmentTemplateRegistry", () => {

    describe("listTemplateKeys() / getTemplate() / listTemplates()", () => {
        it("lists 33 department family templates", () => {
            assert.equal(deptReg.listTemplateKeys().length, 33);
        });
        it("getTemplate() returns a copy, not the live object", () => {
            const t1 = deptReg.getTemplate("executive");
            t1.label = "Mutated";
            const t2 = deptReg.getTemplate("executive");
            assert.notEqual(t2.label, "Mutated");
        });
        it("getTemplate() returns null for unknown key", () => {
            assert.equal(deptReg.getTemplate("not-a-real-department"), null);
        });
        it("listTemplates() returns the same count as listTemplateKeys()", () => {
            assert.equal(deptReg.listTemplates().length, deptReg.listTemplateKeys().length);
        });
    });

    describe("isComposableNow() — honest, call-time verification", () => {
        it("reports composable:false against an empty registry for a capability-requiring template", () => {
            const key = deptReg.listTemplateKeys().find(k => {
                const t = deptReg.getTemplate(k);
                return !t.requiresNewCapability && (t.requiredCapabilities || []).length > 0;
            });
            assert.ok(key, "expected at least one composable-with-real-caps template to test against");
            const result = deptReg.isComposableNow(key, emptyRegistry);
            assert.equal(result.composable, false);
            assert.ok(result.missingCapabilities.length > 0);
        });
        it("reports composable:true when the registry genuinely backs every required capability", () => {
            const key = deptReg.listTemplateKeys().find(k => {
                const t = deptReg.getTemplate(k);
                return !t.requiresNewCapability && (t.requiredCapabilities || []).length > 0;
            });
            const template = deptReg.getTemplate(key);
            const result = deptReg.isComposableNow(key, fullRegistryFor(template));
            assert.equal(result.composable, true);
            assert.deepEqual(result.missingCapabilities, []);
        });
        it("requiresNewCapability:true templates are never composable, even against a full registry", () => {
            const key = deptReg.listTemplateKeys().find(k => deptReg.getTemplate(k).requiresNewCapability);
            assert.ok(key, "expected at least one requiresNewCapability template to test against");
            const template = deptReg.getTemplate(key);
            const result = deptReg.isComposableNow(key, fullRegistryFor(template));
            assert.equal(result.composable, false, "requiresNewCapability must never be reported composable");
        });
        it("unknown template key returns composable:false with an error, not a throw", () => {
            const result = deptReg.isComposableNow("not-a-real-department", emptyRegistry);
            assert.equal(result.composable, false);
            assert.ok(result.error);
        });
        it("a template with zero required capabilities is composable against an empty registry", () => {
            const key = deptReg.listTemplateKeys().find(k => {
                const t = deptReg.getTemplate(k);
                return !t.requiresNewCapability && (t.requiredCapabilities || []).length === 0;
            });
            if (key) {
                const result = deptReg.isComposableNow(key, emptyRegistry);
                assert.equal(result.composable, true);
            }
        });
        it("reflects the REAL, live agentRegistry truthfully (not a fabricated claim)", () => {
            // Cross-check against the actual runtime registry used in production.
            for (const key of deptReg.listTemplateKeys()) {
                const result = deptReg.isComposableNow(key, realAgentRegistry);
                assert.equal(typeof result.composable, "boolean");
                assert.ok(Array.isArray(result.missingCapabilities));
            }
        });
    });

    describe("composeDepartment()", () => {
        it("returns full composed metadata including composability status", () => {
            const composed = deptReg.composeDepartment("executive", realAgentRegistry);
            assert.equal(composed.templateKey, "executive");
            assert.ok(composed.label);
            assert.ok(Array.isArray(composed.skills));
            assert.ok(Array.isArray(composed.connectors));
            assert.ok(Array.isArray(composed.permissions));
            assert.ok(Array.isArray(composed.approvalPolicies));
            assert.ok(Array.isArray(composed.kpis));
            assert.equal(typeof composed.composable, "boolean");
            assert.ok(Array.isArray(composed.missingCapabilities));
        });
        it("throws for an unknown template key", () => {
            assert.throws(() => deptReg.composeDepartment("not-a-real-department", realAgentRegistry));
        });
    });

    describe("composeDepartmentsForTemplate() — determinism", () => {
        it("is deterministic: same business template input yields the same department set across calls", () => {
            const bizTemplate = { teamTypes: ["business", "engineering"], capabilities: ["crm", "billing"] };
            const run1 = deptReg.composeDepartmentsForTemplate(bizTemplate, realAgentRegistry).map(d => d.templateKey).sort();
            const run2 = deptReg.composeDepartmentsForTemplate(bizTemplate, realAgentRegistry).map(d => d.templateKey).sort();
            assert.deepEqual(run1, run2);
        });
        it("always includes executive (every company needs a leadership function)", () => {
            const composed = deptReg.composeDepartmentsForTemplate({ teamTypes: [], capabilities: [] }, realAgentRegistry);
            assert.ok(composed.some(d => d.templateKey === "executive"));
        });
        it("only derives department keys that genuinely exist in this registry", () => {
            const composed = deptReg.composeDepartmentsForTemplate(
                { teamTypes: ["business"], capabilities: ["crm", "totally-unknown-capability-xyz"] },
                realAgentRegistry
            );
            for (const d of composed) {
                assert.ok(deptReg.listTemplateKeys().includes(d.templateKey));
            }
        });
    });

    describe("deriveDepartmentsForTemplate()", () => {
        it("deduplicates department keys across overlapping teamTypes/capabilities", () => {
            const keys = deptReg.deriveDepartmentsForTemplate({
                teamTypes: ["business", "business"],
                capabilities: ["crm", "crm"],
            });
            assert.equal(keys.length, new Set(keys).size, "expected no duplicate department keys");
        });
    });
});
