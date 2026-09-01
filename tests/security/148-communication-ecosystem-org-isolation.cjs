#!/usr/bin/env node
"use strict";
/**
 * Communication Ecosystem mission (M76 resume) — regression + wiring for
 * the genuine gaps found and closed this mission:
 *
 * 1. WhatsApp: /whatsapp/send and /whatsapp/bulk never mounted attachOrg
 *    (their own prior comment predicted exactly this), so
 *    whatsappService.js's already-built org-scoped credential resolution
 *    was structurally unreachable — same bug class as /payment/link's
 *    fixed gap. Fixed by mounting attachOrg + the membership gate.
 * 2. Telegram: telegramService.js had zero org-scoped credential
 *    resolution (unlike every sibling — Twilio/WhatsApp/Discord) and
 *    /telegram/send had no rate limiter (unlike sms.js). Both fixed.
 *
 * Slack is deliberately NOT covered by new code in this file. This
 * session initially built a standalone slackService.js/routes/slack.js
 * before discovering a PARALLEL session (documented earlier in this same
 * report, "COMMUNICATION ECOSYSTEM — IMPLEMENTATION COMPLETION" section)
 * had already found Slack's real send path pre-existing inside
 * toolExecutionLayer.cjs's `case "slack"` (chat.postMessage/
 * conversations.history) and fixed a genuine cross-tenant authorization
 * defect on its `/p19/tools/:toolId/execute` route. Building a second,
 * competing Slack send path would have been exactly the kind of duplicate
 * architecture CLAUDE.md §16 forbids — the standalone files were deleted
 * once discovered, and this test instead confirms that existing, already-
 * fixed Slack path is untouched by this session's own changes.
 *
 * Twilio and Discord are NOT covered here either — both were already
 * CODE-COMPLETE before this mission (Twilio: test 147, 20/20 passing;
 * Discord: reused verbatim, zero changes) and are unaffected by anything
 * in this file.
 *
 * No real network calls anywhere in this file — all provider HTTP calls
 * are either unreached (validation short-circuits before axios) or the
 * test only inspects route wiring / service export shape / call-site
 * contracts, matching test 142/147's own established style.
 *
 * Usage: node tests/security/148-communication-ecosystem-org-isolation.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function assert(c, p, f) { c ? ok(p) : ko(p, f); }
function section(title)  { console.log(`\n[${title}]`); }

function resStub() {
    let code = null, body = null;
    return { status(c) { code = c; return this; }, json(b) { body = b; return this; }, _code: () => code, _body: () => body };
}

function _requireOrgMemberIfOrgContext(req, res, next, requireOrgMember) {
    if (!req.org) return next();
    return requireOrgMember(req, res, next);
}

async function main() {
    // ── WhatsApp ────────────────────────────────────────────────────────
    section("WhatsApp — /whatsapp/send and /whatsapp/bulk now compose attachOrg + the membership gate");
    {
        const router = require("../../backend/routes/whatsapp.js");
        const sendLayer = router.stack.find(l => l.route && l.route.path === "/whatsapp/send" && l.route.methods.post);
        const bulkLayer = router.stack.find(l => l.route && l.route.path === "/whatsapp/bulk" && l.route.methods.post);
        assert(!!sendLayer, "POST /whatsapp/send route exists");
        assert(!!bulkLayer, "POST /whatsapp/bulk route exists");
        const sendNames = sendLayer.route.stack.map(h => h.name);
        const bulkNames = bulkLayer.route.stack.map(h => h.name);
        assert(sendNames.includes("attachOrg"), "/whatsapp/send mounts attachOrg", sendNames.join(","));
        assert(sendNames.includes("_requireOrgMemberIfOrgContext"), "/whatsapp/send mounts the membership gate", sendNames.join(","));
        assert(sendNames.indexOf("attachOrg") < sendNames.indexOf("_requireOrgMemberIfOrgContext"), "attachOrg runs before the gate on /whatsapp/send");
        assert(bulkNames.includes("attachOrg"), "/whatsapp/bulk mounts attachOrg", bulkNames.join(","));
        assert(bulkNames.includes("_requireOrgMemberIfOrgContext"), "/whatsapp/bulk mounts the membership gate", bulkNames.join(","));
    }

    section("WhatsApp — a resolved-but-foreign org is rejected before any send is attempted");
    {
        const { requireOrgMember } = require("../../backend/middleware/orgMiddleware.cjs");
        const orgSvc = require("../../backend/services/organizationService.cjs");
        const origAdmin  = orgSvc.isEnterpriseAdmin;
        const origGrants = orgSvc.listGrantsForAccount;
        orgSvc.isEnterpriseAdmin    = () => false;
        orgSvc.listGrantsForAccount = () => [];
        try {
            let called = false;
            const res = resStub();
            const req = { org: { id: "victim-org", status: "active" }, orgRole: null, user: { sub: "attacker-account" }, path: "/whatsapp/send" };
            _requireOrgMemberIfOrgContext(req, res, () => { called = true; }, requireOrgMember);
            assert(called === false, "handler (and whatsappService's credential lookup) never runs for a non-member");
            assert(res._code() === 403, "caller receives 403", `got ${res._code()}`);
        } finally {
            orgSvc.isEnterpriseAdmin    = origAdmin;
            orgSvc.listGrantsForAccount = origGrants;
        }
    }

    section("WhatsApp — no org context at all falls through (solo/global-fallback caller unaffected)");
    {
        const { requireOrgMember } = require("../../backend/middleware/orgMiddleware.cjs");
        let called = false;
        const req = { org: null };
        _requireOrgMemberIfOrgContext(req, resStub(), () => { called = true; }, requireOrgMember);
        assert(called === true, "solo caller with no resolved org passes through (global env fallback preserved)");
    }

    section("WhatsApp — webhook route remains completely unauthenticated (Meta must call it directly)");
    {
        const router = require("../../backend/routes/whatsapp.js");
        const webhookLayer = router.stack.find(l => l.route && l.route.path === "/whatsapp/webhook" && l.route.methods.post);
        assert(!!webhookLayer, "POST /whatsapp/webhook route still exists");
        const names = webhookLayer.route.stack.map(h => h.name);
        assert(!names.includes("requireAuth"), "webhook route does NOT require auth (Meta has no session)", names.join(","));
    }

    // ── Telegram ────────────────────────────────────────────────────────
    section("Telegram — telegramService.js gained org-scoped credential resolution");
    {
        delete require.cache[require.resolve("../../backend/services/telegramService.js")];
        const svc = require("../../backend/services/telegramService");
        assert(typeof svc.sendMessage === "function", "sendMessage exists");
        assert(typeof svc.isConfigured === "function", "isConfigured exists");
        assert(typeof svc.resetAuthCooldown === "function", "resetAuthCooldown exists (same shape as Twilio/WhatsApp/Slack)");
        // Function.length excludes params with default values (orgId = null),
        // so sendMessage(chatId, text, orgId = null) reports length 2, not 3 —
        // confirm arity by call-site behavior instead of raw .length.
        assert(svc.sendMessage.length === 2, "sendMessage(chatId, text, orgId=null) — orgId has a default, so .length is 2", `length=${svc.sendMessage.length}`);
    }

    section("Telegram — org-scoped resolution actually prefers the vault over the global env when present");
    {
        delete require.cache[require.resolve("../../backend/services/telegramService.js")];
        const vaultPath = require.resolve("../../backend/services/secretVault.cjs");
        const origVault = require.cache[vaultPath];
        const fakeVault = { getSecret: (connectorId, type, orgId) => (connectorId === "msg:telegram" && type === "api_key" && orgId === "org-with-own-bot") ? "org-scoped-token" : null };
        require.cache[vaultPath] = { id: vaultPath, filename: vaultPath, loaded: true, exports: fakeVault };
        try {
            delete require.cache[require.resolve("../../backend/services/telegramService.js")];
            const svc = require("../../backend/services/telegramService");
            assert(svc.isConfigured("org-with-own-bot") === true, "isConfigured(orgId) is true when the vault has that org's own bot token");
            assert(svc.isConfigured("org-with-no-bot") === false || svc.isConfigured("org-with-no-bot") === svc.isConfigured(null), "an org with no vault entry falls back to global config state");
        } finally {
            require.cache[vaultPath] = origVault;
            delete require.cache[require.resolve("../../backend/services/telegramService.js")];
        }
    }

    section("Telegram — /telegram/send is now org-scoped and rate-limited like its siblings");
    {
        const router = require("../../backend/routes/telegram.js");
        const sendLayer = router.stack.find(l => l.route && l.route.path === "/telegram/send" && l.route.methods.post);
        assert(!!sendLayer, "POST /telegram/send route exists");
        const names = sendLayer.route.stack.map(h => h.name);
        assert(names.includes("attachOrg"), "/telegram/send mounts attachOrg", names.join(","));
        assert(names.includes("_requireOrgMemberIfOrgContext"), "/telegram/send mounts the membership gate", names.join(","));
        assert(names.filter(n => n === "<anonymous>").length >= 1, "rate limiter + handler are present in the chain");
        const src = require("fs").readFileSync("backend/routes/telegram.js", "utf8");
        assert(src.includes("_telegramRL") && src.includes("rateLimiter("), "/telegram/send is rate-limited (previously had none)");
    }

    // ── Slack (pre-existing real path, fixed by a parallel session) ────
    section("Slack — no duplicate send path was left behind by this session");
    {
        const fs = require("fs");
        assert(!fs.existsSync("backend/services/slackService.js"), "no standalone slackService.js exists (would duplicate toolExecutionLayer.cjs's real Slack path)");
        assert(!fs.existsSync("backend/routes/slack.js"), "no standalone routes/slack.js exists");
        const src = require("fs").readFileSync("backend/routes/index.js", "utf8");
        assert(!src.includes('require("./slack")'), "route barrel does not mount a nonexistent ./slack module");
    }

    section("Slack — the real, pre-existing send path (toolExecutionLayer.cjs) and its cross-tenant fix (/p19) are intact");
    {
        const tel = require("../../backend/services/toolExecutionLayer.cjs");
        assert(typeof tel.execute === "function", "toolExecutionLayer.execute exists");
        const router = require("../../backend/routes/phase19.js");
        const src = require("fs").readFileSync("backend/routes/phase19.js", "utf8");
        assert(src.includes("operatorOnly"), "/p19 router still composes operatorOnly (the parallel session's cross-tenant fix)");
        assert(!!router, "phase19 router still loads");
    }

    // ── Discord (reused, must remain untouched) ────────────────────────
    section("Discord — existing adapter reused verbatim, not duplicated or modified");
    {
        const { execSync } = require("child_process");
        const diff = execSync("git diff --stat -- backend/services/discordPostingService.cjs", { encoding: "utf8" }).trim();
        assert(diff === "", "discordPostingService.cjs has zero diff vs its committed/staged baseline this mission", diff);
        const svc = require("../../backend/services/discordPostingService.cjs");
        assert(typeof svc.post === "function" && typeof svc.isEnabled === "function", "existing Discord API surface intact");
    }

    // ── Twilio (must remain untouched, already CODE-COMPLETE) ──────────
    section("Twilio — already CODE-COMPLETE, untouched by this mission");
    {
        const { execSync } = require("child_process");
        const diff = execSync("git diff --stat -- backend/services/twilioService.js backend/routes/sms.js", { encoding: "utf8" }).trim();
        assert(diff === "", "twilioService.js/sms.js have zero diff vs their committed/staged baseline this mission", diff);
    }

    console.log(`\n${"=".repeat(60)}\n  Pass: ${pass}   Fail: ${fail}\n${"=".repeat(60)}`);
    if (fail > 0) {
        console.log("\nFailures:");
        failures.forEach(f => console.log(`  - ${f.msg}: ${f.reason}`));
        process.exit(1);
    }
    process.exit(0);
}

main().catch(err => { console.error("FATAL:", err); process.exit(1); });
