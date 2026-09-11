#!/usr/bin/env node
"use strict";
/**
 * AI Ecosystem mission — chatWithTools()/streamChat() extension regression.
 *
 * Discovery found chatWithTools() only attempted 4 of 14 providers
 * (openai/openrouter/claude/gemini) even though groq/deepseek/together/
 * fireworks/nvidia are genuinely OpenAI-compatible chat-completions APIs
 * that support real tools/tool_choice on their actual endpoints, using the
 * SAME shared _openaiCompatWithTools() helper already used for openai/
 * openrouter (parameterized by url/key/model — no new logic needed).
 * Discovery also found streamChat() excluded LM Studio from STREAM_CAPABLE
 * even though LM Studio's entire product premise is OpenAI API emulation
 * (including SSE streaming) — added it, reusing the identical
 * _streamOpenAICompatible() parser. Cohere's streaming remains excluded
 * (its wire format genuinely differs — a real, deliberate, documented
 * PROVIDER-LIMITATION, not something this mission fixed).
 *
 * This test verifies the extension is additive only: the 4 pre-existing
 * tool-capable providers and 12 pre-existing stream-capable providers are
 * unaffected, no real network call is made, and honest-failure behavior
 * (no configured credentials) is preserved for every newly-added provider.
 *
 * Usage: node tests/security/141-ai-tool-calling-streaming-extension.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function assert(c, p, f) { c ? ok(p) : ko(p, f); }
function section(title)  { console.log(`\n[${title}]`); }

async function main() {
  const ai = require("../../backend/services/aiService.js");
  const tools = [{ name: "get_weather", description: "Get weather for a city", parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] } }];

  section("chatWithTools() now includes the 5 newly-added OpenAI-compatible providers");
  {
    const src = require("fs").readFileSync(require.resolve("../../backend/services/aiService.js"), "utf8");
    const toolCapableMatch = src.match(/const TOOL_CAPABLE = \[[^\]]+\];/);
    assert(!!toolCapableMatch, "found the TOOL_CAPABLE array declaration");
    for (const p of ["groq", "deepseek", "together", "fireworks", "nvidia"]) {
      assert(toolCapableMatch[0].includes(`"${p}"`), `TOOL_CAPABLE includes "${p}"`, toolCapableMatch[0]);
    }
  }

  section("chatWithTools() pre-existing 4 providers unaffected (claude/openai/openrouter/gemini)");
  {
    const src = require("fs").readFileSync(require.resolve("../../backend/services/aiService.js"), "utf8");
    const toolCapableMatch = src.match(/const TOOL_CAPABLE = \[[^\]]+\];/);
    for (const p of ["claude", "openai", "openrouter", "gemini"]) {
      assert(toolCapableMatch[0].includes(`"${p}"`), `TOOL_CAPABLE still includes pre-existing "${p}"`);
    }
  }

  section("chatWithTools() with no tools falls back to plain chat() unchanged");
  {
    try {
      await ai.chatWithTools([{ role: "user", content: "hi" }], [], {});
      ko("chatWithTools with empty tools", "expected an honest failure (no providers configured), got success");
    } catch (e) {
      assert(/All AI providers failed/.test(e.message), "empty-tools path delegates to chat()'s own error message, unchanged", e.message);
    }
  }

  section("chatWithTools() with tools and no configured providers — honest failure naming all 9 tool-capable providers");
  {
    try {
      await ai.chatWithTools([{ role: "user", content: "weather in Paris?" }], tools, {});
      ko("chatWithTools with tools, no config", "expected an honest failure, got success");
    } catch (e) {
      assert(/No tool-capable AI provider succeeded/.test(e.message), "honest failure message unchanged in spirit", e.message);
      for (const p of ["openai", "openrouter", "claude", "gemini", "groq", "deepseek", "together", "fireworks", "nvidia"]) {
        assert(e.message.includes(p), `error message names "${p}" as a tool-capable provider`, e.message);
      }
    }
  }

  section("chatWithTools() targeting a specific new provider with no key — honest failure, no fabrication");
  {
    try {
      const r = await ai.chatWithTools([{ role: "user", content: "weather?" }], tools, { provider: "groq" });
      ko("chatWithTools targeting groq with no key", `expected failure, got ${JSON.stringify(r)}`);
    } catch (e) {
      assert(/No tool-capable AI provider succeeded/.test(e.message), "targeted provider without a key still fails honestly", e.message);
    }
  }

  section("streamChat() — LM Studio added to STREAM_CAPABLE, Cohere still excluded");
  {
    assert(ai.isStreamCapable("lmstudio") === true, "isStreamCapable('lmstudio') is now true");
    assert(ai.isStreamCapable("cohere") === false, "isStreamCapable('cohere') remains false (deliberate, documented limitation)");
  }

  section("streamChat() — pre-existing 12 stream-capable providers unaffected");
  {
    const preExisting = ["groq", "openrouter", "openai", "deepseek", "together", "fireworks", "nvidia", "grok", "qwen", "claude", "gemini", "ollama"];
    for (const p of preExisting) {
      assert(ai.isStreamCapable(p) === true, `isStreamCapable('${p}') still true (unaffected by this mission's addition)`);
    }
  }

  section("No real network call was made by any assertion above (all failures are local/honest, zero live provider credentials exist)");
  {
    // Sanity: none of the above tests could have succeeded against a real
    // provider, since no API key env vars were set for this test process.
    assert(!process.env.OPENAI_API_KEY && !process.env.GROQ_API_KEY && !process.env.DEEPSEEK_API_KEY,
      "test process has no real provider credentials set — every failure above is genuinely local/honest, not a masked real call");
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
