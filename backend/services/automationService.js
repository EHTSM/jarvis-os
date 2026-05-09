"use strict";
/**
 * Automation Service — single cron-based engine.
 * Handles: lead follow-ups, onboarding drip, retries.
 * Replaces all root-level setInterval loops.
 */

const cron = require("node-cron");
const logger = require("../utils/logger");

// Lazy imports to avoid circular deps at startup
const _crm = () => require("./crmService");
const _wa  = () => require("./whatsappService");

let _started = false;
const _cronHandles = [];   // all scheduled jobs, for clean stop()

// ── Per-tier success/failure counters ─────────────────────────────
// Keys: tier labels ("10min","6hr","24hr","3day") + "onboarding" + "upsell"
const _autoStats = {};

function _stat(key) {
    if (!_autoStats[key]) _autoStats[key] = { attempts: 0, sent: 0, failed: 0, lastRun: null };
    return _autoStats[key];
}

function getStats() {
    const out = {};
    for (const [key, s] of Object.entries(_autoStats)) {
        out[key] = {
            ...s,
            success_rate: s.attempts > 0
                ? +((s.sent / s.attempts) * 100).toFixed(1)
                : null
        };
    }
    return out;
}

// ── Follow-up message templates ────────────────────────────────────
// cooldownMs: minimum time between sends of THIS tier per lead.
const FOLLOW_UP_SEQUENCES = [
    {
        delay: "*/10 * * * *",      // every 10 min (first touch)
        label: "10min",
        cooldownMs: 8 * 60 * 60 * 1000,    // max once per 8 hours
        message: (lead) =>
            `Hi ${lead.name || "there"}! JARVIS AI can fully automate your business.\n\nReply YES to see how.`
    },
    {
        delay: "0 */6 * * *",       // every 6 hours
        label: "6hr",
        cooldownMs: 6 * 60 * 60 * 1000,
        message: (lead) =>
            `${lead.name || "Hey"}! Still thinking about automating your workflow?\n\nMost users save 3+ hours/day with JARVIS. Want to try?`
    },
    {
        delay: "0 9 * * *",         // daily 9am
        label: "24hr",
        cooldownMs: 22 * 60 * 60 * 1000,
        message: (lead) =>
            `Good morning${lead.name ? " " + lead.name : ""}!\n\nYour spot for JARVIS AI is still open. Act now before it's full.`
    },
    {
        delay: "0 10 */3 * *",      // every 3 days at 10am
        label: "3day",
        cooldownMs: 2 * 24 * 60 * 60 * 1000,
        message: (lead) =>
            `Last chance, ${lead.name || "friend"}! JARVIS AI is closing registrations.\n\nReply NOW to secure your access.`
    }
];

/**
 * Run a follow-up sweep for a given tier.
 */
async function _runFollowUpTier(tier) {
    const crm = _crm();
    const wa  = _wa();
    const leads = crm.getLeads().filter(l =>
        l.status !== "paid" &&
        l.status !== "onboarded" &&
        l.phone
    );

    if (leads.length === 0) return;

    // Rate limit: max 5 per sweep to stay within WA limits
    const now   = Date.now();
    const batch = leads.slice(0, 5);
    let sent = 0;
    const st = _stat(tier.label);
    st.lastRun = new Date().toISOString();

    for (const lead of batch) {
        // Per-lead per-tier cooldown — prevents resending the same follow-up
        // message within cooldownMs even if the cron fires multiple times.
        const sentAt = lead.followUpSentAt?.[tier.label];
        if (sentAt && (now - new Date(sentAt).getTime()) < tier.cooldownMs) continue;

        st.attempts++;
        const result = await wa.sendMessage(lead.phone, tier.message(lead));
        if (result.success) {
            crm.updateLead(lead.phone, {
                lastInteraction: new Date().toISOString(),
                lastMessage:     tier.label,
                followUpSentAt:  { ...(lead.followUpSentAt || {}), [tier.label]: new Date().toISOString() }
            });
            st.sent++;
            sent++;
        } else {
            st.failed++;
        }
    }

    if (sent > 0) logger.info(`[Automation] Follow-up [${tier.label}]: ${sent} messages sent`);
}

/**
 * Onboarding drip for newly paid leads.
 */
async function _runOnboarding() {
    const crm = _crm();
    const wa  = _wa();
    const leads = crm.getLeads().filter(l =>
        (l.status === "paid" || l.paymentStatus === "paid") &&
        !l.onboardingDone &&
        l.phone
    );

    const st = _stat("onboarding");
    st.lastRun = new Date().toISOString();

    for (const lead of leads) {
        st.attempts++;
        const result = await wa.sendMessage(
            lead.phone,
            `Welcome${lead.name ? " " + lead.name : ""}!\n\n` +
            `Your JARVIS AI is now ACTIVE.\n\n` +
            `I'll follow up with your leads automatically and help close clients.\n\n` +
            `Reply with anything to get started.`
        );
        if (result.success) {
            st.sent++;
        } else {
            st.failed++;
        }
        crm.updateLead(lead.phone, { onboardingDone: true, status: "onboarded" });
        logger.info(`[Automation] Onboarded: ${lead.phone}`);
    }
}

/**
 * Hot-lead upsell trigger.
 * Marks leads as hot if they've interacted recently but not paid.
 */
async function _runUpsell() {
    const crm = _crm();
    const wa  = _wa();
    const now = Date.now();

    const hotLeads = crm.getLeads().filter(l => {
        if (l.status === "paid" || l.status === "onboarded" || !l.phone) return false;
        const lastSeen = l.lastInteraction ? new Date(l.lastInteraction).getTime() : 0;
        return (now - lastSeen) < 60 * 60 * 1000;  // Active in last 1hr = hot
    });

    const st = _stat("upsell");
    st.lastRun = new Date().toISOString();
    st.attempts += hotLeads.length;
    st.sent     += hotLeads.length;

    for (const lead of hotLeads) {
        crm.updateLead(lead.phone, { status: "hot" });
    }
}

/**
 * Start the automation engine. Idempotent — safe to call multiple times.
 */
function start() {
    if (_started) return;
    _started = true;

    // Register all follow-up tiers
    for (const tier of FOLLOW_UP_SEQUENCES) {
        _cronHandles.push(cron.schedule(tier.delay, async () => {
            try { await _runFollowUpTier(tier); }
            catch (err) { logger.error(`[Automation] ${tier.label} error:`, err.message); }
        }));
    }

    // Onboarding check: every 5 minutes
    _cronHandles.push(cron.schedule("*/5 * * * *", async () => {
        try { await _runOnboarding(); }
        catch (err) { logger.error("[Automation] Onboarding error:", err.message); }
    }));

    // Upsell hot-lead detection: every 15 minutes
    _cronHandles.push(cron.schedule("*/15 * * * *", async () => {
        try { await _runUpsell(); }
        catch (err) { logger.error("[Automation] Upsell error:", err.message); }
    }));

    logger.info("[Automation] Engine started — follow-ups, onboarding, upsell active");
}

/**
 * Trigger immediate fulfillment after payment capture.
 * Sends welcome + access details via WhatsApp.
 */
async function triggerFulfillment(phone, name) {
    const crm = _crm();
    const lead = crm.getLead(phone);
    if (lead?.onboardingDone) {
        logger.info(`[Automation] Fulfillment skipped (already onboarded): ${phone}`);
        return;
    }

    const wa = _wa();
    logger.info(`[Automation] Fulfillment for ${phone}`);

    await wa.sendMessage(
        phone,
        `Payment confirmed! Welcome${name ? " " + name : ""}!\n\n` +
        `JARVIS AI is now ACTIVE.\n\n` +
        `I'll automatically follow up with every lead you add, send payment links, and help close clients.\n\n` +
        `Reply with anything to get started.`
    );

    _crm().updateLead(phone, {
        status:         "onboarded",
        onboardingDone: true,
        paymentStatus:  "paid",
        onboardedAt:    new Date().toISOString()
    });
}

/**
 * Manual follow-up trigger (used by API).
 */
async function sendManualFollowUp(phone, message) {
    const wa = _wa();
    const result = await wa.sendMessage(
        phone,
        message || "Following up — are you ready to automate your business with JARVIS?"
    );
    if (result.success) {
        _crm().updateLead(phone, { lastInteraction: new Date().toISOString() });
    }
    return result;
}

/**
 * Stop all scheduled cron jobs (called on graceful shutdown).
 */
function stop() {
    if (!_started) return;
    // node-cron doesn't expose a "stopAll" but stores jobs via schedule().
    // We track them at module level so we can stop individually.
    for (const job of _cronHandles) {
        try { job.stop(); } catch { /* ignore */ }
    }
    _started = false;
    logger.info("[Automation] Engine stopped");
}

module.exports = { start, stop, triggerFulfillment, sendManualFollowUp, getStats };
