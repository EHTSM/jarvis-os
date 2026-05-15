"use strict";
/**
 * configValidator — validate runtime configuration objects.
 *
 * validate(config)    → { valid, errors[], warnings[] }
 * defaults()          → default config object
 * merge(partial)      → defaults + partial overrides
 */

const REQUIRED_FIELDS = [
    { key: "maxConcurrent",  type: "number",  min: 1,   max: 100 },
    { key: "maxRetries",     type: "number",  min: 0,   max: 20  },
    { key: "timeoutMs",      type: "number",  min: 100           },
    { key: "checkpointDir",  type: "string"                      },
    { key: "trustPersist",   type: "boolean"                     },
];

const OPTIONAL_FIELDS = [
    { key: "logLevel",        type: "string",  values: ["debug", "info", "warn", "error"] },
    { key: "metricsInterval", type: "number",  min: 1_000  },
    { key: "auditEnabled",    type: "boolean"              },
    { key: "chaosMode",       type: "boolean"              },
    { key: "sandboxAll",      type: "boolean"              },
    { key: "maxQueueDepth",   type: "number",  min: 1, max: 10_000 },
];

const DEFAULTS = {
    maxConcurrent:   4,
    maxRetries:      3,
    timeoutMs:       30_000,
    checkpointDir:   "data/workflow-checkpoints",
    trustPersist:    true,
    logLevel:        "info",
    metricsInterval: 60_000,
    auditEnabled:    true,
    chaosMode:       false,
    sandboxAll:      false,
    maxQueueDepth:   500,
};

function validate(config) {
    if (!config || typeof config !== "object" || Array.isArray(config)) {
        return { valid: false, errors: ["config must be a non-null object"], warnings: [] };
    }

    const errors   = [];
    const warnings = [];

    for (const f of REQUIRED_FIELDS) {
        const val = config[f.key];
        if (val === undefined || val === null) {
            errors.push(`Missing required field: ${f.key}`);
            continue;
        }
        if (typeof val !== f.type) {
            errors.push(`${f.key} must be ${f.type}, got ${typeof val}`);
            continue;
        }
        if (f.type === "number") {
            if (f.min !== undefined && val < f.min) errors.push(`${f.key} must be >= ${f.min}`);
            if (f.max !== undefined && val > f.max) errors.push(`${f.key} must be <= ${f.max}`);
        }
    }

    for (const f of OPTIONAL_FIELDS) {
        const val = config[f.key];
        if (val === undefined) continue;
        if (typeof val !== f.type) {
            warnings.push(`${f.key} should be ${f.type}, got ${typeof val}`);
            continue;
        }
        if (f.values && !f.values.includes(val)) {
            warnings.push(`${f.key} should be one of: ${f.values.join(", ")}`);
        }
        if (f.type === "number") {
            if (f.min !== undefined && val < f.min) warnings.push(`${f.key} below recommended min ${f.min}`);
            if (f.max !== undefined && val > f.max) warnings.push(`${f.key} above recommended max ${f.max}`);
        }
    }

    return { valid: errors.length === 0, errors, warnings };
}

function defaults() { return { ...DEFAULTS }; }

function merge(partial) { return { ...DEFAULTS, ...(partial || {}) }; }

module.exports = { validate, defaults, merge, REQUIRED_FIELDS, OPTIONAL_FIELDS };
