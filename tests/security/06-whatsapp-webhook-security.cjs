#!/usr/bin/env node
"use strict";

const { spawn } = require("child_process");
const http = require("http");
const crypto = require("crypto");
const path = require("path");

const PORT = 5060;
const SECRET = "whatsapp-test-secret";
const BASE_URL = `http://localhost:${PORT}`;
// The real webhook route (backend/routes/whatsapp.js _verifyWhatsAppSignature)
// reads process.env.WHATSAPP_APP_SECRET — Meta's own "App Secret" naming
// from the App Dashboard, distinct from WA_TOKEN/WA_VERIFY_TOKEN used
// elsewhere. This test previously set a WA_WEBHOOK_SECRET env var that the
// route never read, so `secret` was always undefined and the route's dev-only
// bypass (NODE_ENV !== "production" -> skip verification) silently
// swallowed every signature check this test intended to exercise.

let pass = 0;
let fail = 0;
const failures = [];
let serverProcess = null;

function ok(msg) {
    pass++;
    console.log(`  ✓  ${msg}`);
}

function ko(msg, reason) {
    fail++;
    failures.push({ msg, reason });
    console.log(`  ✗  ${msg} — ${reason}`);
}

function assert(condition, msg, reason) {
    condition ? ok(msg) : ko(msg, reason);
}

function _req(method, reqPath, body = null, headers = {}, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : null;
        const opts = {
            hostname: "localhost",
            port: PORT,
            path: reqPath,
            method,
            headers: { "Content-Type": "application/json", ...headers },
            timeout: timeoutMs,
        };
        const req = http.request(opts, (res) => {
            let data = "";
            res.on("data", c => data += c);
            res.on("end", () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(data), headers: res.headers }); }
                catch { resolve({ status: res.statusCode, body: data, headers: res.headers }); }
            });
        });
        req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
        req.on("error", e => reject(e));
        if (payload) req.write(payload);
        req.end();
    });
}

function computeSignature(payload) {
    const raw = JSON.stringify(payload);
    const hash = crypto.createHmac("sha256", SECRET).update(raw).digest("hex");
    return `sha256=${hash}`;
}

function webhookPayload(id = "msg-123", text = "Hello") {
    return {
        object: "whatsapp_business_account",
        entry: [
            {
                id: "12345",
                changes: [
                    {
                        value: {
                            messages: [
                                {
                                    from: "919999999999",
                                    id,
                                    timestamp: "1700000000",
                                    text: { body: text },
                                    type: "text"
                                }
                            ],
                            metadata: { phone_number_id: "98765" }
                        }
                    }
                ]
            }
        ]
    };
}

async function waitForServer() {
    const start = Date.now();
    // Mission 38 (2026-08-23): directly measured — a fresh backend/server.js
    // boot now takes ~30-60s to become HTTP-responsive (heavy synchronous
    // autonomous-agent bootstrap: RCA analysis, mission creation, learning-
    // engine full analysis, multiple 5s+ git subprocess calls — all before
    // the listener stabilizes), driven up further by data/missions.json's
    // current real size. 10s was correct when this test was written; raised
    // with real margin above the measured ~61s worst case observed live.
    while (Date.now() - start < 75000) {
        try {
            const res = await _req("GET", "/test", null, {}, 2000);
            if (res.status === 200) return;
        } catch (_) {
            await new Promise(r => setTimeout(r, 200));
        }
    }
    throw new Error("server did not become ready");
}

function startServer() {
    return new Promise((resolve, reject) => {
        serverProcess = spawn(process.execPath, [path.join(__dirname, "../../backend/server.js")], {
            env: {
                ...process.env,
                PORT: String(PORT),
                NODE_ENV: "development",
                WHATSAPP_APP_SECRET: SECRET,
                WA_VERIFY_TOKEN: "test_verify_token",
            },
            stdio: ["ignore", "pipe", "pipe"],
        });

        serverProcess.on("error", reject);
        // Give the process a chance to start before polling the HTTP endpoint.
        setTimeout(resolve, 500);
    });
}

function stopServer() {
    if (!serverProcess) return;
    serverProcess.kill("SIGTERM");
}

async function runTests() {
    console.log("\n[WhatsApp Webhook Security Tests]");

    // Challenge verification still works
    const challengeResponse = await _req("GET", "/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=test_verify_token&hub.challenge=abc123");
    assert(challengeResponse.status === 200 && challengeResponse.body === "abc123", "Webhook challenge verification works", `expected 200 and challenge text, got ${challengeResponse.status} ${JSON.stringify(challengeResponse.body)}`);

    // Valid signature accepted
    const payload = webhookPayload("msg-valid", "hi there");
    const validResponse = await _req("POST", "/whatsapp/webhook", payload, { "x-hub-signature-256": computeSignature(payload) });
    assert(validResponse.status === 200, "Valid WhatsApp signature accepted", `expected 200, got ${validResponse.status}`);

    // Invalid signature rejected
    const invalidResponse = await _req("POST", "/whatsapp/webhook", payload, { "x-hub-signature-256": "sha256=deadbeef" });
    assert(invalidResponse.status === 401 && invalidResponse.body?.error === "Invalid webhook signature", "Invalid signature rejected", `expected 401 invalid signature, got ${invalidResponse.status} ${JSON.stringify(invalidResponse.body)}`);

    // Tampered payload rejected
    const legitimateSignature = computeSignature(payload);
    const tamperedPayload = webhookPayload("msg-tampered", "goodbye");
    const tamperedResponse = await _req("POST", "/whatsapp/webhook", tamperedPayload, { "x-hub-signature-256": legitimateSignature });
    assert(tamperedResponse.status === 401, "Tampered payload rejected", `expected 401, got ${tamperedResponse.status}`);

    // Replay rejected
    const replayPayload = webhookPayload("msg-replay", "replay test");
    const replaySig = computeSignature(replayPayload);
    const firstReplay = await _req("POST", "/whatsapp/webhook", replayPayload, { "x-hub-signature-256": replaySig });
    const secondReplay = await _req("POST", "/whatsapp/webhook", replayPayload, { "x-hub-signature-256": replaySig });
    assert(firstReplay.status === 200, "First webhook delivery accepted", `expected 200, got ${firstReplay.status}`);
    assert(secondReplay.status === 400 && secondReplay.body?.error === "Replay detected", "Replay attack rejected", `expected 400 replay detected, got ${secondReplay.status} ${JSON.stringify(secondReplay.body)}`);
}

(async () => {
    try {
        console.log("Starting temporary backend server for webhook tests...");
        await startServer();
        await waitForServer();
        await runTests();
    } catch (err) {
        ko("Test harness failure", err.message);
    } finally {
        stopServer();
        console.log(`\nSummary: ${pass} passed, ${fail} failed`);
        if (fail > 0) {
            process.exit(1);
        }
    }
})();
