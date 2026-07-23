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

module.exports = {
    KINDS,
    listKinds,
    validate,
    _id,
    FORBIDDEN_SECRET_FIELDS,
};
