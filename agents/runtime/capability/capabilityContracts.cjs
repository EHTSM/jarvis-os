"use strict";
/**
 * capabilityContracts — execution contract definitions and validation.
 *
 * defineContract(spec)              → contract  (merged with DEFAULT_CONTRACT)
 * validateInput(contract, input)    → { valid, errors[] }
 * validateOutput(contract, output)  → { valid, errors[] }
 * DEFAULT_CONTRACT
 *
 * Schema entry shape: { required?: bool, type?: string }
 */

const DEFAULT_CONTRACT = {
    inputSchema:       {},
    outputSchema:      {},
    timeout:           30_000,
    retryPolicy:       { maxRetries: 0, backoffMs: 100, backoffMultiplier: 2, retryableExitCodes: [1] },
    rollbackSupport:   false,
    isolationRequired: false,
};

function defineContract(spec = {}) {
    return {
        ...DEFAULT_CONTRACT,
        ...spec,
        retryPolicy: { ...DEFAULT_CONTRACT.retryPolicy, ...(spec.retryPolicy ?? {}) },
    };
}

function _validate(schema, obj, prefix) {
    const errors = [];
    for (const [key, rule] of Object.entries(schema ?? {})) {
        if (rule?.required && !(key in (obj ?? {}))) {
            errors.push(`${prefix}: missing required field "${key}"`);
        }
        if (rule?.type && key in (obj ?? {}) && typeof obj[key] !== rule.type) {
            errors.push(`${prefix}: field "${key}" must be ${rule.type}, got ${typeof obj[key]}`);
        }
    }
    return errors;
}

function validateInput(contract, input = {}) {
    const errors = _validate(contract?.inputSchema, input, "input");
    return { valid: errors.length === 0, errors };
}

function validateOutput(contract, output = {}) {
    const errors = _validate(contract?.outputSchema, output, "output");
    return { valid: errors.length === 0, errors };
}

module.exports = { defineContract, validateInput, validateOutput, DEFAULT_CONTRACT };
