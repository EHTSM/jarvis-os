#!/usr/bin/env node
"use strict";
/**
 * Credit local-mode billing bypass — regression tests.
 *
 * Confirmed revenue leak: POST /commercial/credits/local let any authenticated
 * account flip local.enabled=true with no plan/feature gate. creditEngine's
 * checkCredit/consume then unconditionally trusted rec.local.enabled and
 * returned { canProceed:true, cost:0 } — but provider selection in
 * creativeRouter/capabilityRouter was entirely independent of that flag, so
 * it could still pick a real paid provider (DALL-E 3 via "stability"/"openai",
 * Sora-class video via "openrouter", any cloud LLM for "reasoning", etc.),
 * executing real paid API calls while billing $0.
 *
 * Fix: local.enabled now only waives cost when the caller confirms (via
 * creditEngine's opts.localProviderAvailable) that a real local/free provider
 * was actually selected for the requested capability. creativeRouter and
 * capabilityRouter now force-select the local provider (creativeRegistry's
 * "local" entry / aiRegistry's type:"local" "ollama" entry) when local mode
 * is requested AND available for that capability; otherwise they fall
 * through to normal paid routing AND normal billing.
 *
 * Usage: node tests/security/10-credit-local-mode-bypass.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));
require("dotenv").config({ path: require("path").join(__dirname, "../../.env") });

const creditEngine      = require("../../backend/services/creditEngine.cjs");
const creativeRouter    = require("../../backend/services/creativeRouter.cjs");
const capabilityRouter  = require("../../backend/services/capabilityRouter.cjs");

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function assert(c, p, f) { c ? ok(p) : ko(p, f); }
function section(title)  { console.log(`\n[${title}]`); }

function main() {
  const suffix = Date.now();

  section("Setup — account with local.enabled=true");
  const localAcct = `test-local-bypass-${suffix}`;
  creditEngine.setLocal(localAcct, true);
  ok("local.enabled set to true for test account");

  section("creativeRouter — capability WITH a real local provider routes free");
  const imgDecision = creativeRouter.route({ capability: "image_generate", accountId: localAcct, plan: "trial" });
  assert(imgDecision.provider === "local", "image_generate selects the real local provider when local mode is on", `got provider=${imgDecision.provider}`);
  assert(imgDecision.creditCheck.cost === 0 && imgDecision.creditCheck.source === "local", "image_generate is genuinely free when routed to the local provider", JSON.stringify(imgDecision.creditCheck));

  section("creativeRouter — capability WITHOUT a local provider still bills (exploit closed)");
  const vidDecision = creativeRouter.route({ capability: "text_to_video", accountId: localAcct, plan: "trial" });
  assert(vidDecision.provider !== "local", "text_to_video (no local option exists) does not claim to use 'local'", `got provider=${vidDecision.provider}`);
  assert(vidDecision.creditCheck.cost > 0, "text_to_video is billed at real cost despite local.enabled=true", JSON.stringify(vidDecision.creditCheck));

  section("creativeRouter — logo_generate (image-adjacent, but no local provider) still bills");
  const logoDecision = creativeRouter.route({ capability: "logo_generate", accountId: localAcct, plan: "trial" });
  assert(logoDecision.creditCheck.cost > 0, "logo_generate is billed at real cost despite local.enabled=true", JSON.stringify(logoDecision.creditCheck));

  section("capabilityRouter — capability WITH a local (ollama) provider routes free");
  const chatDecision = capabilityRouter.route({ intent: "chat", accountId: localAcct, plan: "trial" });
  assert(chatDecision.primary === "ollama", "chat capability selects ollama when local mode is on", `got primary=${chatDecision.primary}`);
  assert(chatDecision.creditCheck.cost === 0 && chatDecision.creditCheck.source === "local", "chat is genuinely free when routed to ollama", JSON.stringify(chatDecision.creditCheck));

  section("capabilityRouter — capability WITHOUT a local provider still bills (exploit closed)");
  const reasonDecision = capabilityRouter.route({ intent: "analyze and reason through this business plan", accountId: localAcct, plan: "trial" });
  assert(reasonDecision.primary !== "ollama", "reasoning capability (ollama has no reasoning entry) does not claim ollama", `got primary=${reasonDecision.primary}`);
  assert(reasonDecision.creditCheck.cost > 0, "reasoning is billed at real cost despite local.enabled=true", JSON.stringify(reasonDecision.creditCheck));

  section("creditEngine — checkCredit ignores local.enabled without explicit confirmation");
  const rawCheck = creditEngine.checkCredit(localAcct, "default", "trial"); // no opts — as the generic /commercial/credits/consume route calls it
  assert(rawCheck.cost > 0 && rawCheck.source !== "local", "checkCredit without localProviderAvailable does not grant a free pass", JSON.stringify(rawCheck));

  section("Regression — normal (non-local) accounts unaffected");
  const normalAcct = `test-normal-billing-${suffix}`;
  const normalDecision = creativeRouter.route({ capability: "image_generate", accountId: normalAcct, plan: "trial" });
  assert(normalDecision.provider !== "local", "non-local account is not routed to the local provider", `got provider=${normalDecision.provider}`);
  assert(normalDecision.creditCheck.cost > 0, "non-local account is billed normally", JSON.stringify(normalDecision.creditCheck));

  console.log(`\n${"═".repeat(52)}`);
  console.log(`  Pass: ${pass}   Fail: ${fail}`);
  console.log(`${"═".repeat(52)}`);
  if (failures.length > 0) {
    console.log("\n  Failures:");
    failures.forEach(f => console.log(`    ✗ ${f.msg}: ${f.reason}`));
  }

  try {
    require("fs").writeFileSync(
      require("path").join(process.cwd(), "data/credit-local-mode-bypass-test-report.json"),
      JSON.stringify({ generated: new Date().toISOString(), pass, fail, failures }, null, 2)
    );
    console.log("\n  Report: data/credit-local-mode-bypass-test-report.json\n");
  } catch { /* non-critical */ }

  process.exit(fail > 0 ? 1 : 0);
}

main();
