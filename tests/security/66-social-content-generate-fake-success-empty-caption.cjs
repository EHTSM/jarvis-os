#!/usr/bin/env node
"use strict";
/**
 * Social content AI generation reported fake success with an empty caption
 * — Phase A.7 (Marketing Agency Certification, Creative Studio section).
 *
 * CONFIRMED finding (reproduced live: real agency account, Creative Studio
 * -> Social -> Instagram, real topic, "Generate"): the response was
 * {"ok":true, "result":{"caption":"","hashtags":[],"hook":"","cta":""}} —
 * a "successful" 200 response with genuinely nothing generated, no error
 * shown anywhere in the UI (the empty-caption branch simply rendered
 * empty), and the empty result was still saved into generation history.
 *
 * Root cause: backend/routes/creativeStudio.js's POST
 * /creative/social/generate destructured the AI response as
 * `raw?.content || raw?.text || ""`, but aiService.js's callAI() always
 * resolves to a plain STRING — every real provider branch (groq, openai,
 * claude, gemini, etc.) returns `res.data.choices[0].message.content`
 * directly, never `{content}`/`{text}`. So raw.content and raw.text were
 * always undefined on a string primitive, and the destructuring silently
 * produced "" regardless of whether the AI call actually succeeded or
 * failed. Confirmed live even with real OPENAI_API_KEY/GROQ_API_KEY
 * present in .env: after this fix restored the real error, the honest
 * result was "AI backend unavailable. Check provider API keys in your
 * .env file." — a genuine CREDENTIAL/infrastructure failure that had been
 * completely invisible to the founder before this fix.
 *
 * A second, related issue in the same route: when aiService failed to
 * load entirely, the code fell back to hardcoded placeholder content
 * ("Compelling {platform} content for: {brief}", "You won't believe
 * this...", "Alternative 1", "Alternative 2") — fabricated fake content
 * presented as a real AI generation. Removed entirely; an unavailable AI
 * service now returns a real 503 error instead.
 *
 * Fix: use callAI()'s return value directly as the raw string (no
 * .content/.text destructuring). If it's empty, non-string, or matches the
 * known "AI backend unavailable" sentinel, return a real error response
 * instead of a fabricated ok:true result with empty fields.
 *
 * Verified live: after backend restart to pick up the fix, the same
 * Generate action now surfaces "AI backend unavailable. Check provider
 * API keys in your .env file." directly in the UI instead of a blank
 * "successful" caption. 144/144 regression passing.
 *
 * Usage: node tests/security/66-social-content-generate-fake-success-empty-caption.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

const assert = require("assert");
const fs     = require("fs");

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function section(title)  { console.log(`\n[${title}]`); }

async function main() {
  const src = fs.readFileSync(require.resolve("../../backend/routes/creativeStudio.js"), "utf8");

  section("The old raw?.content || raw?.text destructuring is gone");
  {
    assert.ok(!/const text = raw\?\.content \|\| raw\?\.text \|\| ""/.test(src),
      "the old broken destructuring (raw is always a string, never {content}/{text}) must be removed");
    ok("no longer destructures callAI's string return value as an object");
  }

  section("A non-string / empty / sentinel AI response returns a real error, not a fake success");
  {
    const routeMatch = src.match(/router\.post\("\/creative\/social\/generate"[\s\S]*?\n\}\);/);
    assert.ok(routeMatch, "could not find the /creative/social/generate route handler");
    assert.ok(/typeof raw !== "string" \|\| !raw\.trim\(\) \|\| raw\.startsWith\("AI backend unavailable"\)/.test(routeMatch[0]),
      "must detect an empty/non-string/unavailable-sentinel AI response");
    assert.ok(/res\.status\(502\)\.json\(\{ error:/.test(routeMatch[0]),
      "must return a real error status+body instead of a fabricated ok:true result");
    ok("empty/failed AI generation now returns a real error response");
  }

  section("The fabricated placeholder-content fallback is removed");
  {
    assert.ok(!/Compelling \$\{platform\} content for/.test(src),
      "the hardcoded fake caption placeholder must be removed");
    assert.ok(!/You won't believe this\.\.\./.test(src), "the hardcoded fake hook placeholder must be removed");
    assert.ok(/if \(!ai\?\.callAI\) \{\s*\n\s*return res\.status\(503\)\.json\(\{ error: "AI service is unavailable/.test(src),
      "an unavailable aiService module must return a real 503 error, not fabricated content");
    ok("no fabricated placeholder content remains; unavailable AI returns a real error instead");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f.msg}: ${f.reason}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch(err => {
  console.error("FATAL:", err);
  process.exit(1);
});
