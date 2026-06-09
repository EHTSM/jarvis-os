"use strict";
/**
 * Phase 456 — Engineering Profile System
 *
 * Project profiles, runtime presets, adapter presets, deployment presets,
 * workflow collections. Fast environment switching.
 *
 * Profiles are stored in data/engineering-profiles.json
 * Max 20 profiles. Active profile is tracked in data/active-profile.json.
 */

const fs   = require("fs");
const path = require("path");

const PROFILES_PATH = path.join(__dirname, "../../data/engineering-profiles.json");
const ACTIVE_PATH   = path.join(__dirname, "../../data/active-profile.json");
const MAX_PROFILES  = 20;

// ── Built-in profiles ─────────────────────────────────────────────────────────
const BUILTIN_PROFILES = {
    "jarvis-os-dev": {
        name:        "jarvis-os-dev",
        label:       "Jarvis OS Development",
        description: "Standard local development profile for jarvis-os",
        runtimePreset: {
            port:           3001,
            pm2App:         "jarvis-backend",
            frontendPort:   5173,
            nodeEnv:        "development",
        },
        adapterPreset: {
            primary:        "terminal",
            secondary:      "vscode",
            verification:   "runtime",
        },
        deploymentPreset: {
            buildCmd:       "cd frontend && npm run build",
            startCmd:       "pm2 start ecosystem.config.cjs",
            healthEndpoint: "http://localhost:3001/api/health",
        },
        workflowCollection: ["morning-startup", "dev-health-check", "debug-backend", "debug-frontend"],
        builtin: true,
    },
    "jarvis-os-prod": {
        name:        "jarvis-os-prod",
        label:       "Jarvis OS Production",
        description: "Production deployment profile",
        runtimePreset: {
            port:           3001,
            pm2App:         "jarvis-backend",
            nodeEnv:        "production",
        },
        adapterPreset: {
            primary:        "runtime",
            secondary:      "terminal",
            verification:   "runtime",
        },
        deploymentPreset: {
            buildCmd:       "cd frontend && npm run build",
            startCmd:       "pm2 restart jarvis-backend",
            healthEndpoint: "http://localhost:3001/api/health",
        },
        workflowCollection: ["deployment-validation-chain", "health-check", "deploy-update"],
        builtin: true,
    },
};

// ── Storage ───────────────────────────────────────────────────────────────────
function _loadProfiles() {
    try { return JSON.parse(fs.readFileSync(PROFILES_PATH, "utf8")); }
    catch { return {}; }
}

function _saveProfiles(profiles) {
    try {
        fs.writeFileSync(PROFILES_PATH, JSON.stringify(profiles, null, 2));
    } catch {}
}

function _getActiveId() {
    try { return JSON.parse(fs.readFileSync(ACTIVE_PATH, "utf8")).profileId || null; }
    catch { return "jarvis-os-dev"; } // default
}

function _setActiveId(profileId) {
    try { fs.writeFileSync(ACTIVE_PATH, JSON.stringify({ profileId, switchedAt: Date.now() }, null, 2)); } catch {}
}

// ── Public API ────────────────────────────────────────────────────────────────

/** List all profiles (builtins + custom). */
function listProfiles() {
    const custom = _loadProfiles();
    const all    = { ...BUILTIN_PROFILES, ...custom };
    const activeId = _getActiveId();
    return Object.values(all).map(p => ({
        name:        p.name,
        label:       p.label,
        description: p.description,
        builtin:     !!p.builtin,
        active:      p.name === activeId,
        workflowCount: (p.workflowCollection || []).length,
    }));
}

/** Get a profile by name. */
function getProfile(name) {
    if (BUILTIN_PROFILES[name]) return BUILTIN_PROFILES[name];
    const custom = _loadProfiles();
    return custom[name] || null;
}

/** Get the currently active profile. */
function getActiveProfile() {
    return getProfile(_getActiveId()) || BUILTIN_PROFILES["jarvis-os-dev"];
}

/** Switch active profile. */
function switchProfile(name) {
    const profile = getProfile(name);
    if (!profile) return { ok: false, error: `profile not found: ${name}` };
    _setActiveId(name);
    return { ok: true, active: name, profile };
}

/**
 * Save a custom profile.
 * @param {object} profile — { name, label, description, runtimePreset, adapterPreset, deploymentPreset, workflowCollection }
 */
function saveProfile(profile) {
    if (!profile.name) return { saved: false, error: "name required" };
    if (BUILTIN_PROFILES[profile.name]) return { saved: false, error: "cannot override builtin profile" };
    const custom = _loadProfiles();
    const keys   = Object.keys(custom);
    if (keys.length >= MAX_PROFILES && !custom[profile.name]) {
        return { saved: false, error: "profile limit reached (20)" };
    }
    custom[profile.name] = { ...profile, savedAt: Date.now() };
    _saveProfiles(custom);
    return { saved: true, name: profile.name };
}

/** Delete a custom profile. */
function deleteProfile(name) {
    if (BUILTIN_PROFILES[name]) return false;
    const custom = _loadProfiles();
    if (!custom[name]) return false;
    delete custom[name];
    _saveProfiles(custom);
    if (_getActiveId() === name) _setActiveId("jarvis-os-dev");
    return true;
}

module.exports = { listProfiles, getProfile, getActiveProfile, switchProfile, saveProfile, deleteProfile };
