"use strict";
/**
 * isolationPolicy — manages isolated execution zones and quarantine.
 *
 * getPolicy(classification, context)           → IsolationRequirements
 * shouldEscalateToSandbox(fingerprint, entries) → boolean
 * quarantine(fingerprint, reason)
 * isQuarantined(fingerprint)                   → boolean
 * liftQuarantine(fingerprint)
 * getQuarantined()                             → QuarantineEntry[]
 * elevatePrivilege(fingerprint, opts)          → ElevationResult
 * reset()
 */

const ISOLATION_LEVELS = {
    none:      0,
    monitored: 1,
    sandboxed: 2,
    isolated:  3,
    quarantine: 4,
};

const CLASSIFICATION_DEFAULTS = {
    safe:        { level: "none",      sandboxRequired: false, monitoringRequired: false },
    elevated:    { level: "monitored", sandboxRequired: false, monitoringRequired: true  },
    dangerous:   { level: "sandboxed", sandboxRequired: true,  monitoringRequired: true  },
    destructive: { level: "isolated",  sandboxRequired: true,  monitoringRequired: true  },
};

let _quarantine = new Map();   // fingerprint → { reason, ts }
let _elevated   = new Map();   // fingerprint → { privilegeLevel, grantedAt }

// ── getPolicy ─────────────────────────────────────────────────────────

function getPolicy(classification, context = {}) {
    const base = CLASSIFICATION_DEFAULTS[classification] ?? CLASSIFICATION_DEFAULTS.safe;
    const fp   = context.fingerprint;

    // Bump to quarantine if flagged
    if (fp && _quarantine.has(fp)) {
        return { ...base, level: "quarantine", sandboxRequired: true, quarantined: true };
    }
    return { ...base, quarantined: false };
}

// ── escalation check ──────────────────────────────────────────────────

function shouldEscalateToSandbox(fingerprint, entries = []) {
    const fpEntries   = entries.filter(e => e.fingerprint === fingerprint);
    if (fpEntries.length < 2) return false;
    const failRate    = fpEntries.filter(e => !e.success).length / fpEntries.length;
    const rollbackRate = fpEntries.filter(e => e.rollbackTriggered).length / fpEntries.length;
    return failRate > 0.5 || rollbackRate > 0.4;
}

// ── quarantine ────────────────────────────────────────────────────────

function quarantine(fingerprint, reason) {
    _quarantine.set(fingerprint, { reason, ts: new Date().toISOString() });
}

function isQuarantined(fingerprint) {
    return _quarantine.has(fingerprint);
}

function liftQuarantine(fingerprint) {
    _quarantine.delete(fingerprint);
}

function getQuarantined() {
    return [..._quarantine.entries()].map(([fp, meta]) => ({ fingerprint: fp, ...meta }));
}

// ── privilege elevation ───────────────────────────────────────────────

function elevatePrivilege(fingerprint, opts = {}) {
    const currentLevel = _elevated.get(fingerprint)?.privilegeLevel ?? "none";
    const levels       = ["none", "monitored", "sandboxed", "isolated"];
    const currentIdx   = levels.indexOf(currentLevel);
    const nextLevel    = opts.targetLevel ?? levels[Math.min(levels.length - 1, currentIdx + 1)];

    if (ISOLATION_LEVELS[nextLevel] <= ISOLATION_LEVELS[currentLevel]) {
        return { fingerprint, privilegeLevel: currentLevel, elevated: false, reason: "already_at_level" };
    }

    _elevated.set(fingerprint, { privilegeLevel: nextLevel, grantedAt: new Date().toISOString() });
    return { fingerprint, privilegeLevel: nextLevel, from: currentLevel, elevated: true };
}

function getPrivilegeLevel(fingerprint) {
    return _elevated.get(fingerprint)?.privilegeLevel ?? "none";
}

function reset() {
    _quarantine = new Map();
    _elevated   = new Map();
}

module.exports = {
    ISOLATION_LEVELS, CLASSIFICATION_DEFAULTS,
    getPolicy, shouldEscalateToSandbox,
    quarantine, isQuarantined, liftQuarantine, getQuarantined,
    elevatePrivilege, getPrivilegeLevel,
    reset,
};
