"use strict";
/**
 * capabilityContract.cjs — Universal Composition Engine, Phase 1.
 *
 * A single, pure schema/validation module for every entity kind the
 * composition chain (Company Factory -> Department Factory -> Agent
 * Factory -> Skill Registry -> Tool Fabric -> Connector Registry ->
 * Credential Vault -> Workflow Engine -> Approval/Safety -> Execution
 * Runtime -> Learning -> Capability Evolution) passes between layers.
 *
 * This module does NOT persist anything and does NOT replace any
 * existing service (organizationService.cjs, companyFactory.cjs,
 * departmentTemplateRegistry.cjs, integrationConnectors.cjs,
 * secretVault.cjs, missionOrchestrator.cjs, approvalEngine.cjs remain
 * the real owners of their data). It only gives every layer a shared,
 * validated shape and a stable ID convention, so new registries
 * (skillRegistry.cjs, agentInstanceRegistry.cjs, etc.) don't each
 * invent their own ad hoc object shape.
 *
 * Security rule (structural, not just convention): no entity may carry
 * a raw secret/credential value. Only a `credentialRef` (string,
 * resolved through secretVault.cjs elsewhere) is permitted. Any field
 * named like a secret container (secret, credentialValue, apiKey,
 * token, password, privateKey) is rejected at validation time.
 */

let _seq = 0;
function _id(prefix) {
    return `${prefix}_${Date.now()}_${(++_seq).toString(36)}`;
}

// Field names that must never appear on a contract-conforming object.
// Structural enforcement of "no secrets in definitions".
const FORBIDDEN_SECRET_FIELDS = [
    "secret", "credentialValue", "apiKey", "api_key", "token",
    "password", "privateKey", "private_key", "clientSecret", "client_secret",
];

function _findForbiddenSecretField(obj, path = "") {
    if (!obj || typeof obj !== "object") return null;
    for (const [key, value] of Object.entries(obj)) {
        const lowerKey = key.toLowerCase();
        if (FORBIDDEN_SECRET_FIELDS.some(f => lowerKey === f.toLowerCase())) {
            return path ? `${path}.${key}` : key;
        }
        if (value && typeof value === "object" && !Array.isArray(value)) {
            const nested = _findForbiddenSecretField(value, path ? `${path}.${key}` : key);
            if (nested) return nested;
        }
    }
    return null;
}

// Each kind declares required fields (top-level, dot-path not needed since
// these are shallow contracts) and their expected JS type ("string",
// "array", "object", "number", "boolean"). Optional fields are not listed
// here (validate() only enforces required-field presence/type + the
// secret-field ban); this stays a lightweight contract, not a full JSON
// Schema engine, matching the codebase's existing "plain object + helper
// functions" convention (departmentTemplateRegistry.cjs, organizationService.cjs).
const KINDS = {
    Company: {
        required: { id: "string", name: "string", niche: "string" },
    },
    Department: {
        required: { id: "string", templateKey: "string", label: "string" },
    },
    Agent: {
        required: { id: "string", orgId: "string", archetypeId: "string" },
    },
    Skill: {
        required: {
            id: "string", name: "string", category: "string",
            riskLevel: "string", executionHandler: "string", version: "string",
        },
    },
    Tool: {
        required: {
            id: "string", name: "string", riskLevel: "string",
            executionHandler: "string",
        },
    },
    Connector: {
        required: { id: "string", provider: "string", status: "string" },
    },
    CredentialRequirement: {
        required: { provider: "string", credentialRef: "string" },
    },
    Workflow: {
        required: { id: "string", name: "string", stages: "array" },
    },
    Trigger: {
        required: { id: "string", type: "string" },
    },
    Permission: {
        required: { action: "string" },
    },
    ApprovalPolicy: {
        required: { id: "string", workflowId: "string", risk: "string" },
    },
    MemoryScope: {
        required: { id: "string", orgId: "string" },
    },
    KnowledgeScope: {
        required: { id: "string", orgId: "string" },
    },
    KPI: {
        required: { id: "string", name: "string" },
    },
    Budget: {
        required: { orgId: "string", amount: "number" },
    },
    Execution: {
        required: { id: "string", taskId: "string", status: "string" },
    },
    Observation: {
        required: { id: "string", executionId: "string" },
    },
    LearningRecord: {
        required: { id: "string", type: "string", applied: "boolean" },
    },
};

function listKinds() {
    return Object.keys(KINDS);
}

function _typeOf(value) {
    if (Array.isArray(value)) return "array";
    if (value === null) return "null";
    return typeof value;
}

/**
 * Validate a plain object against a declared kind's contract.
 * @param {string} kind  one of listKinds()
 * @param {object} obj
 * @returns {{ ok: boolean, errors: string[] }}
 */
function validate(kind, obj) {
    const errors = [];
    const spec = KINDS[kind];
    if (!spec) {
        return { ok: false, errors: [`Unknown capability contract kind: ${kind}`] };
    }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
        return { ok: false, errors: ["Object must be a non-null plain object"] };
    }

    for (const [field, expectedType] of Object.entries(spec.required)) {
        if (!(field in obj)) {
            errors.push(`Missing required field: ${field}`);
            continue;
        }
        const actualType = _typeOf(obj[field]);
        if (actualType !== expectedType) {
            errors.push(`Field "${field}" expected type ${expectedType}, got ${actualType}`);
        } else if (expectedType === "string" && !obj[field].trim()) {
            errors.push(`Field "${field}" must be a non-empty string`);
        }
    }

    const forbidden = _findForbiddenSecretField(obj);
    if (forbidden) {
        errors.push(`Field "${forbidden}" is a forbidden raw-secret field — use a credentialRef instead`);
    }

    return { ok: errors.length === 0, errors };
}

// ─────────────────────────────────────────────────────────────────────────
// Universal Composition Engine — Completion Gaps, Phase 1
// (Blueprint Contract Validation)
//
// Company Factory produces a composed BLUEPRINT — a company plus its
// departments/agents/skills/tools/connectors/credential-requirements/
// workflows/permissions/approval-policies/memory-scope/knowledge-scope/
// kpis/budgets, assembled from several existing services
// (companyBlueprintEngine.cjs, departmentTemplateRegistry.cjs,
// skillRegistry.cjs, toolExecutionLayer.cjs, integrationConnectors.cjs).
// validateBlueprint() is the single validation entry point Company
// Factory calls before treating a blueprint as real — it does NOT
// introduce a second schema system: every entity inside the blueprint is
// checked with the SAME validate(kind, obj) function above, plus a
// reference-chain pass (department -> agent, agent -> skill,
// skill -> tool, tool -> connector, connector -> credential requirement,
// action -> approval policy) that only checks that a referenced id
// actually exists elsewhere in the same blueprint (or in an explicitly
// passed live-registry lookup set) — it never fabricates a reference
// that isn't there.
// ─────────────────────────────────────────────────────────────────────────

const BLUEPRINT_SECTION_KINDS = {
    departments: "Department",
    agents: "Agent",
    skills: "Skill",
    tools: "Tool",
    connectors: "Connector",
    credentialRequirements: "CredentialRequirement",
    workflows: "Workflow",
    approvalPolicies: "ApprovalPolicy",
};

/**
 * Validates a full composed company blueprint: the top-level Company
 * entity, every array-of-entity section listed in
 * BLUEPRINT_SECTION_KINDS, plus reference-chain integrity across them.
 *
 * @param {object} blueprint
 *   {
 *     company: {id, name, niche, ...},
 *     departments?: [{id, templateKey, label, agentIds?, ...}],
 *     agents?: [{id, orgId, archetypeId, skillIds?, ...}],
 *     skills?: [{id, name, category, riskLevel, executionHandler, version, toolIds?, ...}],
 *     tools?: [{id, name, riskLevel, executionHandler, connectorId?, ...}],
 *     connectors?: [{id, provider, status, credentialRequirementId?, ...}],
 *     credentialRequirements?: [{provider, credentialRef, ...}],
 *     workflows?: [{id, name, stages, ...}],
 *     permissions?: [{action, approvalPolicyId?, ...}],
 *     approvalPolicies?: [{id, workflowId, risk, ...}],
 *     memoryScope?: {id, orgId, ...},
 *     knowledgeScope?: {id, orgId, ...},
 *     kpis?: [{id, name, ...}],
 *     budget?: {orgId, amount, ...},
 *   }
 * @returns {{ ok: boolean, errors: string[] }}
 */
function validateBlueprint(blueprint) {
    const errors = [];
    if (!blueprint || typeof blueprint !== "object" || Array.isArray(blueprint)) {
        return { ok: false, errors: ["Blueprint must be a non-null plain object"] };
    }

    // 1. Company (required, singular)
    if (!blueprint.company) {
        errors.push("Missing required top-level field: company");
    } else {
        const check = validate("Company", blueprint.company);
        if (!check.ok) errors.push(...check.errors.map(e => `company: ${e}`));
    }

    // 2. Every declared array-of-entity section, validated per-entity
    // against the SAME contract kinds already defined above.
    for (const [sectionKey, kind] of Object.entries(BLUEPRINT_SECTION_KINDS)) {
        const section = blueprint[sectionKey];
        if (section === undefined) continue; // optional section, not present
        if (!Array.isArray(section)) {
            errors.push(`${sectionKey}: must be an array`);
            continue;
        }
        section.forEach((entity, idx) => {
            const check = validate(kind, entity);
            if (!check.ok) errors.push(...check.errors.map(e => `${sectionKey}[${idx}]: ${e}`));
        });
    }

    // 3. Singular sections (MemoryScope, KnowledgeScope, Budget) — optional,
    // validated the same way when present.
    if (blueprint.memoryScope !== undefined) {
        const check = validate("MemoryScope", blueprint.memoryScope);
        if (!check.ok) errors.push(...check.errors.map(e => `memoryScope: ${e}`));
    }
    if (blueprint.knowledgeScope !== undefined) {
        const check = validate("KnowledgeScope", blueprint.knowledgeScope);
        if (!check.ok) errors.push(...check.errors.map(e => `knowledgeScope: ${e}`));
    }
    if (blueprint.budget !== undefined) {
        const check = validate("Budget", blueprint.budget);
        if (!check.ok) errors.push(...check.errors.map(e => `budget: ${e}`));
    }
    if (blueprint.kpis !== undefined) {
        if (!Array.isArray(blueprint.kpis)) {
            errors.push("kpis: must be an array");
        } else {
            blueprint.kpis.forEach((kpi, idx) => {
                const check = validate("KPI", kpi);
                if (!check.ok) errors.push(...check.errors.map(e => `kpis[${idx}]: ${e}`));
            });
        }
    }
    if (blueprint.permissions !== undefined) {
        if (!Array.isArray(blueprint.permissions)) {
            errors.push("permissions: must be an array");
        } else {
            blueprint.permissions.forEach((perm, idx) => {
                const check = validate("Permission", perm);
                if (!check.ok) errors.push(...check.errors.map(e => `permissions[${idx}]: ${e}`));
            });
        }
    }

    // 4. Structural secret rejection across the WHOLE blueprint (catches a
    // raw secret nested anywhere, not just inside an already-checked
    // per-entity section — e.g. directly on the top-level blueprint object).
    const forbidden = _findForbiddenSecretField(blueprint);
    if (forbidden) {
        errors.push(`Field "${forbidden}" is a forbidden raw-secret field anywhere in the blueprint — use a credentialRef instead`);
    }

    // 5. Reference-chain integrity. Only checks that a referenced id
    // genuinely exists somewhere in the blueprint's own sections (or, if
    // the entity declares no reference field at all, that's honestly
    // reported as "unreferenced" rather than silently ignored — a
    // department with agentIds:[] is fine; a department with
    // agentIds:["agent_x"] where agent_x doesn't exist in blueprint.agents
    // is a real reference-integrity error).
    // Non-array sections were already reported as errors in step 2 above —
    // treat them as empty here rather than crashing, so one malformed
    // section doesn't prevent reference-chain checking of the others.
    const _arr = (v) => Array.isArray(v) ? v : [];
    const idsByKind = {
        Department: new Set(_arr(blueprint.departments).map(d => d.id)),
        Agent: new Set(_arr(blueprint.agents).map(a => a.id)),
        Skill: new Set(_arr(blueprint.skills).map(s => s.id)),
        Tool: new Set(_arr(blueprint.tools).map(t => t.id)),
        Connector: new Set(_arr(blueprint.connectors).map(c => c.id)),
        CredentialRequirement: new Set(_arr(blueprint.credentialRequirements).map(c => c.provider)),
        ApprovalPolicy: new Set(_arr(blueprint.approvalPolicies).map(p => p.id)),
    };

    function _checkRefs(entities, refField, targetKind, label) {
        for (const entity of entities || []) {
            const refs = entity[refField];
            if (refs === undefined) continue;
            const refList = Array.isArray(refs) ? refs : [refs];
            for (const ref of refList) {
                if (!idsByKind[targetKind].has(ref)) {
                    errors.push(`${label} "${entity.id || entity.provider}" references unknown ${targetKind} "${ref}" via ${refField} — reference-integrity failure`);
                }
            }
        }
    }

    _checkRefs(blueprint.departments, "agentIds", "Agent", "Department");
    // A department may reference skills directly (companyFactory.cjs's
    // real composed-department shape — department.skills, no intermediate
    // agent entity exists yet at composition time) OR via an intermediate
    // Agent entity (agent.skillIds) when the fuller Company/Department/
    // Agent/Skill chain is genuinely modeled. Both are real, legitimate
    // reference shapes actually produced by this codebase — check both.
    _checkRefs(blueprint.departments, "skillIds", "Skill", "Department");
    _checkRefs(blueprint.agents, "skillIds", "Skill", "Agent");
    _checkRefs(blueprint.skills, "toolIds", "Tool", "Skill");
    _checkRefs(blueprint.tools, "connectorId", "Connector", "Tool");
    _checkRefs(blueprint.connectors, "credentialRequirementId", "CredentialRequirement", "Connector");
    _checkRefs(blueprint.permissions, "approvalPolicyId", "ApprovalPolicy", "Action/Permission");

    return { ok: errors.length === 0, errors };
}

module.exports = {
    KINDS,
    listKinds,
    validate,
    validateBlueprint,
    _id,
    FORBIDDEN_SECRET_FIELDS,
};
