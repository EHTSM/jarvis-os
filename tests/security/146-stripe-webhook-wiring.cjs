#!/usr/bin/env node
"use strict";
/**
 * Stripe webhook wiring — signature verification correctness + honest,
 * log-only event handling.
 *
 * ERA-2 Mission 76 (12_ROADMAP.md P10). Stripe has zero checkout/
 * subscription code in this repo (confirmed by the Payments Ecosystem
 * mission's discovery pass) — only the webhook receiving/verification
 * path was built, deliberately not wired to billing/CRM side effects
 * (would be a "fake success" claim per CLAUDE.md §17/§18 with no real
 * Stripe checkout flow to have produced the event in the first place).
 * This test covers: route wiring, signature verification (valid/invalid/
 * tampered/stale/missing), dev-mode vs prod-mode pass-through behavior,
 * event parsing, and that Razorpay's existing webhook path is untouched.
 *
 * Usage: node tests/security/146-stripe-webhook-wiring.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));
const crypto = require("crypto");

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function assert(c, p, f) { c ? ok(p) : ko(p, f); }
function section(title)  { console.log(`\n[${title}]`); }

function sign(secret, body, ts) {
    const signed = `${ts}.${body}`;
    const sig = crypto.createHmac("sha256", secret).update(signed).digest("hex");
    return `t=${ts},v1=${sig}`;
}

async function main() {
    section("Existing Razorpay webhook path is untouched by this mission");
    {
        // paymentService.js already carried prior (uncommitted, pre-existing)
        // Payments Ecosystem mission changes before this ERA-2 mission
        // started — this asserts its exported API is still exactly what
        // the Razorpay webhook controller expects, not that the file has
        // zero diff (it doesn't, from earlier work).
        const svc = require("../../backend/services/paymentService.js");
        const exported = Object.keys(svc).sort();
        assert(
            ["createPaymentLink", "isEnabled", "parseWebhookEvent", "refundPayment", "verifyWebhookSignature"].every(k => exported.includes(k)),
            "paymentService.js still exports its full pre-existing Razorpay API",
            JSON.stringify(exported)
        );
    }

    section("Route wiring — Stripe webhook routes exist");
    {
        const router = require("../../backend/routes/payment.js");
        const stripeWebhook  = router.stack.find(l => l.route && l.route.path === "/webhook/stripe" && l.route.methods.post);
        const stripeWebhook2 = router.stack.find(l => l.route && l.route.path === "/stripe-webhook" && l.route.methods.post);
        assert(!!stripeWebhook, "POST /webhook/stripe route exists");
        assert(!!stripeWebhook2, "POST /stripe-webhook route exists");
        // Razorpay routes still present, untouched
        const rzWebhook = router.stack.find(l => l.route && l.route.path === "/webhook/razorpay" && l.route.methods.post);
        assert(!!rzWebhook, "POST /webhook/razorpay route still exists (unaffected)");
    }

    section("stripeService.js exports exactly its documented API");
    {
        // P10 continuation (Checkout Session creation) added
        // createCheckoutSession() to this file's real, documented scope —
        // this assertion's own required-keys list is updated accordingly,
        // not silently: see tests/security/147-stripe-checkout-session.cjs
        // for full coverage of the new function.
        delete require.cache[require.resolve("../../backend/services/stripeService.js")];
        const svc = require("../../backend/services/stripeService.js");
        assert(typeof svc.isEnabled === "function", "isEnabled exists");
        assert(typeof svc.verifyWebhookSignature === "function", "verifyWebhookSignature exists");
        assert(typeof svc.parseWebhookEvent === "function", "parseWebhookEvent exists");
        assert(typeof svc.createCheckoutSession === "function", "createCheckoutSession exists (P10 continuation)");
        assert(Object.keys(svc).length === 4, "no unexpected exports", JSON.stringify(Object.keys(svc)));
    }

    section("Signature verification — configured secret");
    {
        const oldSecret = process.env.STRIPE_WEBHOOK_SECRET;
        const oldKey    = process.env.STRIPE_SECRET_KEY;
        const oldEnv    = process.env.NODE_ENV;
        process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret_value";
        process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
        process.env.NODE_ENV = "development";
        delete require.cache[require.resolve("../../backend/services/stripeService.js")];
        const svc = require("../../backend/services/stripeService.js");

        const body = JSON.stringify({ type: "payment_intent.succeeded", data: { object: { id: "pi_test_1" } } });
        const ts = Math.floor(Date.now() / 1000);
        const validHeader = sign("whsec_test_secret_value", body, ts);

        assert(svc.verifyWebhookSignature(body, validHeader) === true, "valid signature accepted");
        assert(svc.verifyWebhookSignature(body + "tampered", validHeader) === false, "tampered body rejected");
        assert(svc.verifyWebhookSignature(body, sign("wrong_secret", body, ts)) === false, "wrong-secret signature rejected");
        assert(svc.verifyWebhookSignature(body, "") === false, "missing header rejected");
        assert(svc.verifyWebhookSignature(body, "garbage") === false, "malformed header rejected");

        const staleTs = ts - 999999;
        const staleHeader = sign("whsec_test_secret_value", body, staleTs);
        assert(svc.verifyWebhookSignature(body, staleHeader) === false, "stale timestamp (replay window) rejected");

        assert(svc.isEnabled() === true, "isEnabled true when both secret + key set");

        process.env.STRIPE_WEBHOOK_SECRET = oldSecret;
        process.env.STRIPE_SECRET_KEY = oldKey;
        process.env.NODE_ENV = oldEnv;
    }

    section("Unconfigured behavior — dev passes through, prod hard-rejects");
    {
        const oldSecret = process.env.STRIPE_WEBHOOK_SECRET;
        const oldKey    = process.env.STRIPE_SECRET_KEY;
        const oldEnv    = process.env.NODE_ENV;
        delete process.env.STRIPE_WEBHOOK_SECRET;
        delete process.env.STRIPE_SECRET_KEY;

        process.env.NODE_ENV = "development";
        delete require.cache[require.resolve("../../backend/services/stripeService.js")];
        let svc = require("../../backend/services/stripeService.js");
        assert(svc.verifyWebhookSignature("{}", "anything") === true, "dev mode: unconfigured secret passes through");
        assert(svc.isEnabled() === false, "isEnabled false when unconfigured");

        process.env.NODE_ENV = "production";
        delete require.cache[require.resolve("../../backend/services/stripeService.js")];
        svc = require("../../backend/services/stripeService.js");
        assert(svc.verifyWebhookSignature("{}", "anything") === false, "prod mode: unconfigured secret hard-rejects");

        process.env.STRIPE_WEBHOOK_SECRET = oldSecret;
        process.env.STRIPE_SECRET_KEY = oldKey;
        process.env.NODE_ENV = oldEnv;
        delete require.cache[require.resolve("../../backend/services/stripeService.js")];
    }

    section("Event parsing");
    {
        const svc = require("../../backend/services/stripeService.js");
        const parsed = svc.parseWebhookEvent(JSON.stringify({ type: "charge.succeeded", data: { object: { id: "ch_1" } } }));
        assert(parsed.event === "charge.succeeded", "event type parsed");
        assert(parsed.data.id === "ch_1", "event data.object parsed");
        assert(svc.parseWebhookEvent("not json{{{") === null, "malformed JSON returns null");
        assert(svc.parseWebhookEvent(JSON.stringify({})).event === null, "missing type field returns null event, not a throw");
    }

    section("Controller — handleStripeWebhook rejects invalid signature without side effects");
    {
        const { handleStripeWebhook } = require("../../backend/controllers/webhookController.js");
        assert(typeof handleStripeWebhook === "function", "handleStripeWebhook exported");

        const oldSecret = process.env.STRIPE_WEBHOOK_SECRET;
        process.env.STRIPE_WEBHOOK_SECRET = "whsec_ctrl_test";
        delete require.cache[require.resolve("../../backend/services/stripeService.js")];
        delete require.cache[require.resolve("../../backend/controllers/webhookController.js")];
        const { handleStripeWebhook: handler2 } = require("../../backend/controllers/webhookController.js");

        let statusCode = null, body = null;
        const req = { rawBody: JSON.stringify({ type: "payment_intent.succeeded", data: { object: { id: "pi_x" } } }), headers: { "stripe-signature": "t=1,v1=deadbeef" } };
        const res = { status(c) { statusCode = c; return this; }, json(b) { body = b; return this; }, sendStatus(c) { statusCode = c; } };
        await handler2(req, res);
        assert(statusCode === 400, "invalid signature → HTTP 400", `got ${statusCode}`);
        assert(body && /invalid signature/i.test(body.error || ""), "error message present");

        process.env.STRIPE_WEBHOOK_SECRET = oldSecret;
    }

    section("Rate limiting — webhook routes share the existing payment-webhook limiter");
    {
        const src = require("fs").readFileSync("backend/routes/payment.js", "utf8");
        const stripeLine = src.split("\n").find(l => l.includes('"/webhook/stripe"'));
        assert(!!stripeLine && stripeLine.includes("_webhookRL"), "/webhook/stripe uses the existing _webhookRL limiter (no new limiter invented)");
    }

    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail > 0) {
        console.log("\nFailures:");
        failures.forEach(f => console.log(`  - ${f.msg}: ${f.reason}`));
        process.exit(1);
    }
}

main().catch(err => { console.error(err); process.exit(1); });
