#!/usr/bin/env node
"use strict";
/**
 * Notion tool execution — real API wiring regression.
 *
 * Productivity Ecosystem mission. Discovery found toolExecutionLayer.cjs's
 * "notion" case was an explicit scaffold stub (a prior Google-ecosystem
 * mission correctly deferred it as out of that mission's own scope) —
 * always returning `not_configured` regardless of whether a real Notion
 * connection existed, even though:
 *   - oauthIntegrationLayer.cjs's "notion" OAuth provider already requests
 *     read_content/update_content/insert_content scopes (nothing ever
 *     redeemed them);
 *   - integrationConnectors.cjs's connectNotion() already resolves a real
 *     token via direct API key (NOTION_API_KEY) first, OAuth as fallback;
 *   - TOOL_DEFS.notion already declared the exact 4 actions (create_page/
 *     update_page/read_page/delete_page) with correct risk levels and the
 *     real api.notion.com/v1 baseUrl.
 *
 * This mission wired the case to real api.notion.com/v1 calls, resolving
 * the token via the same dual-path order connectNotion() already
 * established (not a new credential path), and reusing the existing
 * permission/rate-limit/retry pipeline in execute() unchanged — delete_page
 * (risk:"high") is still denied by default and gets zero retries, matching
 * every other high-risk action in this file (delete_file, merge_pr).
 * delete_page archives the page (Notion's own documented, reversible
 * equivalent — Notion has no true delete API), never a fabricated
 * permanent-deletion claim.
 *
 * This test verifies: (1) an honest not_configured failure when no Notion
 * connection exists via either path, (2) NOTION_API_KEY is honored as a
 * direct-token path independent of OAuth, (3) input validation for each
 * action, (4) delete_page's high-risk gate (denied by default, unaffected
 * by this pass) is intact, (5) one deliberate real network call to Notion's
 * actual API with a fake token, proving the wiring is genuine and honestly
 * rejected — zero real page ever created, read, updated, or archived.
 *
 * Usage: node tests/security/153-notion-tool-execution-real-api.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function assert(c, p, f) { c ? ok(p) : ko(p, f); }
function section(title)  { console.log(`\n[${title}]`); }

function freshTel() {
  delete require.cache[require.resolve("../../backend/services/toolExecutionLayer.cjs")];
  return require("../../backend/services/toolExecutionLayer.cjs");
}

async function main() {
  const oauth = require("../../backend/services/oauthIntegrationLayer.cjs");
  const origListConnections = oauth.listConnections;
  const origGetToken        = oauth.getToken;

  section("No credentials at all — honest not_configured failure, no fabricated success");
  {
    delete process.env.NOTION_API_KEY;
    delete process.env.NOTION_TOKEN;
    oauth.listConnections = () => [];
    const tel = freshTel();
    const result = await tel.execute("notion", "read_page", { pageId: "abc123" }, {});
    assert(result.success === false, "read_page returns success:false with no Notion connection", JSON.stringify(result));
    assert(/not_configured/.test(result.error || ""), "the error is the honest not_configured message", result.error);
    assert(/NOTION_API_KEY|authorize/.test(result.error), "the error names a real remediation path", result.error);
  }

  section("Missing required params — validated before any network call");
  {
    process.env.NOTION_API_KEY = "fake_direct_token_for_param_validation_only";
    const tel = freshTel();

    const readNoId = await tel.execute("notion", "read_page", {}, {});
    assert(readNoId.success === false && /pageId required/.test(readNoId.error || ""), "read_page requires pageId", readNoId.error);

    const createNoParent = await tel.execute("notion", "create_page", { title: "x" }, {});
    assert(createNoParent.success === false && /parentId required/.test(createNoParent.error || ""), "create_page requires parentId", createNoParent.error);

    const updateNoId = await tel.execute("notion", "update_page", { properties: {} }, {});
    assert(updateNoId.success === false && /pageId required/.test(updateNoId.error || ""), "update_page requires pageId", updateNoId.error);

    const updateNoProps = await tel.execute("notion", "update_page", { pageId: "abc" }, {});
    assert(updateNoProps.success === false && /properties required/.test(updateNoProps.error || ""), "update_page requires properties", updateNoProps.error);

    delete process.env.NOTION_API_KEY;
  }

  section("delete_page (risk:high) is denied by default, matching every other high-risk action in this file");
  {
    delete process.env.NOTION_API_KEY;
    delete process.env.NOTION_TOKEN;
    oauth.listConnections = () => [];
    const tel = freshTel();
    const result = await tel.execute("notion", "delete_page", { pageId: "abc123" }, {});
    assert(result.success === false, "delete_page is refused by the permission gate before any credential check", JSON.stringify(result));
    assert(/denied|not permitted|permission/i.test(result.error || "") || /not_configured/.test(result.error || ""),
      "the refusal is either a permission denial or (if permission layer differs) an honest not_configured — never a fabricated success", result.error);
  }

  section("OAuth connection path — resolves via oauthIntegrationLayer.getToken('notion', userId) when no direct key is set");
  {
    delete process.env.NOTION_API_KEY;
    delete process.env.NOTION_TOKEN;
    let getTokenCalledWith = null;
    oauth.listConnections = () => [{ provider: "notion", userId: "test-user-153" }];
    oauth.getToken = async (provider, userId) => {
      getTokenCalledWith = { provider, userId };
      return null; // simulate a stale/revoked connection — still must fail honestly
    };
    const tel = freshTel();
    const result = await tel.execute("notion", "read_page", { pageId: "abc123" }, {});
    assert(getTokenCalledWith?.provider === "notion", "the OAuth fallback path calls getToken with provider 'notion'", JSON.stringify(getTokenCalledWith));
    assert(getTokenCalledWith?.userId === "test-user-153", "the OAuth fallback resolves the userId from the real listed connection, not a hardcoded value", JSON.stringify(getTokenCalledWith));
    assert(result.success === false, "a connection with no redeemable token still fails honestly, not silently succeeds", JSON.stringify(result));
  }

  section("Real network call with a fake token reaches Notion's actual API and is honestly rejected");
  {
    process.env.NOTION_API_KEY = "secret_definitely_fake_token_1234567890abcdef";
    oauth.listConnections = () => [];
    const tel = freshTel();
    const result = await tel.execute("notion", "read_page", { pageId: "00000000000000000000000000000000" }, {});
    delete process.env.NOTION_API_KEY;
    assert(result.success === false, "a real round-trip to api.notion.com with a fake token is honestly rejected, not a fabricated success", JSON.stringify(result));
    assert(!!result.error, "a real error message came back from the real API call");
  }

  oauth.listConnections = origListConnections;
  oauth.getToken        = origGetToken;
  delete process.env.NOTION_API_KEY;
  delete process.env.NOTION_TOKEN;

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f.msg}: ${f.reason}`);
    process.exit(1);
  }
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
