"use strict";
/**
 * Phase B.9 regression: the /jarvis AI fallback must not report false success.
 *
 * aiService.callAI() does NOT throw when every provider fails — it RESOLVES to
 * the sentinel string "AI backend unavailable. Check provider API keys in your
 * .env file." (aiService.js:650). jarvisController's intelligence fallback
 * returned that sentinel straight into _ok(), producing
 *
 *     HTTP 200  { "success": true, "reply": "AI backend unavailable..." }
 *
 * Reproduced 3/3 live against real failing providers (groq 429 → openai 401 →
 * ollama 404 → lmstudio unreachable). The prose was honest but the
 * machine-readable envelope claimed success, so any client trusting `success`
 * treated a failed request as answered — and usageMetering recorded
 * success:true, counting the outage as a satisfied request.
 *
 * Fixed with the same sentinel guard codingAssistant.js / creativeStudio.js /
 * ai.js already use (A.7/A.10): throw, so the caller's existing catch returns
 * an honest 500 with the real cause. Verified after the fix: success=false,
 * HTTP 500, error carries the real message — while non-AI execution paths
 * ("get leads", "set timer") still return success=true with real data.
 *
 * These tests pin the sentinel contract itself, which is what regressed and
 * what all four call sites share.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs     = require("node:fs");
const path   = require("node:path");

const ROOT = path.join(__dirname, "../..");

/** The exact guard used at every honest call site. */
function isFailureSentinel(reply) {
    return typeof reply !== "string" || !reply.trim() ||
           reply.startsWith("AI backend unavailable");
}

describe("AI failure sentinel handling (Phase B.9)", () => {
    it("aiService still returns the sentinel rather than throwing", () => {
        // The guard only works if this remains the failure contract. If
        // aiService is ever changed to throw, these call-site guards become
        // dead code and this test should be revisited deliberately.
        const src = fs.readFileSync(path.join(ROOT, "backend/services/aiService.js"), "utf8");
        assert.ok(src.includes('return "AI backend unavailable. Check provider API keys in your .env file.";'),
            "callAI must still resolve to the sentinel string on total provider failure");
    });

    it("classifies the real sentinel as a failure", () => {
        assert.equal(isFailureSentinel("AI backend unavailable. Check provider API keys in your .env file."), true);
    });

    it("classifies empty and non-string replies as failures", () => {
        for (const bad of ["", "   ", null, undefined, 0, {}, []]) {
            assert.equal(isFailureSentinel(bad), true, `${JSON.stringify(bad)} must count as failure`);
        }
    });

    it("does not misclassify a genuine answer as failure", () => {
        for (const good of ["PONG", "Your revenue is 12,000.", "The AI backend is a service that..."]) {
            assert.equal(isFailureSentinel(good), false, `${good!== undefined ? good : ""} must count as success`);
        }
    });

    it("jarvisController guards the fallback and records the real outcome", () => {
        const src = fs.readFileSync(path.join(ROOT, "backend/controllers/jarvisController.js"), "utf8");
        assert.ok(src.includes('reply.startsWith("AI backend unavailable")'),
            "the intelligence fallback must check the sentinel before returning");
        assert.ok(/success:\s*!failed/.test(src),
            "usageMetering must record the real outcome, not an unconditional success:true");
        assert.ok(/if \(failed\)[\s\S]{0,200}throw new Error/.test(src),
            "a sentinel reply must throw so the caller returns an honest error");
    });

    it("keeps the guard at every other honest AI call site", () => {
        // These were fixed in A.7/A.10; a regression in any of them would
        // reintroduce fake success on that surface.
        for (const f of ["backend/routes/ai.js",
                         "backend/routes/codingAssistant.js",
                         "backend/routes/creativeStudio.js"]) {
            const src = fs.readFileSync(path.join(ROOT, f), "utf8");
            assert.ok(src.includes("AI backend unavailable"),
                `${f} must keep its sentinel guard`);
        }
    });

    it("does not leave the sentinel reachable as a 200 success envelope", () => {
        // The specific shape that made the bug invisible: the sentinel handed
        // to the success builder.
        const src = fs.readFileSync(path.join(ROOT, "backend/controllers/jarvisController.js"), "utf8");
        const fallback = src.slice(src.indexOf("aiOrchestrator failed"));
        const returnIdx = fallback.indexOf('return { reply, action: "ai_reply"');
        const throwIdx  = fallback.indexOf("throw new Error");
        assert.ok(throwIdx !== -1 && throwIdx < returnIdx,
            "the failure throw must precede the success return in the fallback path");
    });
});
