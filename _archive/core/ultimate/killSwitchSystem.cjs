"use strict";
const { isKillSwitchActive, setKillSwitch, getAdminState, ultimateLog, uid, NOW, ok, fail, blocked, killed, load, flush } = require("./_ultimateStore.cjs");

const AGENT = "killSwitchSystem";

// ── Activate: only callable by registered admins ──────────────────
function activate({ adminId, reason, adminSecret }) {
    if (!adminId || !reason) return fail(AGENT, "adminId and reason are required to activate kill switch");

    const state = getAdminState();
    const admin = state.admins.find(a => a.id === adminId && a.secret === adminSecret);
    if (!admin) return blocked(AGENT, "Only registered admins can activate the kill switch");

    const result = setKillSwitch(true, reason, adminId);
    ultimateLog(AGENT, "KILL_SWITCH_ACTIVATED", { adminId, reason }, "CRITICAL");
    return ok(AGENT, { ...result, message: "🛑 Kill switch ACTIVATED — all autonomous operations halted" }, "kill_switch_active");
}

// ── Deactivate: requires admin + reason ──────────────────────────
function deactivate({ adminId, reason, adminSecret }) {
    if (!adminId || !reason) return fail(AGENT, "adminId and reason are required to deactivate kill switch");

    const state = getAdminState();
    const admin = state.admins.find(a => a.id === adminId && a.secret === adminSecret);
    if (!admin) return blocked(AGENT, "Only registered admins can deactivate the kill switch");

    if (!isKillSwitchActive()) return ok(AGENT, { message: "Kill switch is already inactive", deactivatedAt: NOW() });

    const result = setKillSwitch(false, reason, adminId);
    ultimateLog(AGENT, "KILL_SWITCH_DEACTIVATED", { adminId, reason }, "WARN");
    return ok(AGENT, { ...result, message: "✅ Kill switch DEACTIVATED — system resuming normal operation" });
}

// ── Status check ─────────────────────────────────────────────────
function getStatus() {
    const active = isKillSwitchActive();
    const log    = load("kill_switch_log", []);
    return ok(AGENT, {
        active,
        message:        active ? "🛑 SYSTEM HALTED — Kill switch is active" : "✅ System operational — Kill switch is inactive",
        recentEvents:   log.slice(-10),
        checkedAt:      NOW()
    });
}

// ── Guard: call this at the top of any sensitive operation ────────
function guard(callingAgent) {
    if (isKillSwitchActive()) return killed(callingAgent || AGENT);
    return null; // null = clear to proceed
}

module.exports = { activate, deactivate, getStatus, guard };
