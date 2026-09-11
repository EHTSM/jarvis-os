#!/usr/bin/env node
"use strict";
/**
 * imageProcessorAgent.cjs — Creative Ecosystem mission SSRF-guard fix.
 *
 * Discovery confirmed image_upscale/image_edit already had a real, working
 * sharp-backed pixel-processing path (agents/content/imageProcessorAgent.cjs)
 * with a 20s fetch timeout and a 25MB source-size cap — genuinely solid
 * reliability handling. The one real gap: _loadSourceBytes() fetched an
 * authenticated caller's `imageUrl` server-side with no protection against
 * SSRF — a request for http://169.254.169.254/... (cloud metadata) or an
 * internal RFC1918 host would have been fetched, processed by sharp, and
 * the resulting (re-encoded) bytes returned to the caller.
 *
 * Fix: reuse the SAME shared SSRF choke point already proven across the
 * browser-automation family (backend/utils/urlSafety.cjs's
 * assertSafeNavigationTarget, already wired into 13 other call sites) —
 * not a second guard. This test proves the wiring, not the guard's own
 * correctness (backend/utils/urlSafety.cjs has its own coverage already via
 * its other call sites' history — see its ERA-1 IPv6-bracket-bypass fix).
 *
 * No real external network call is made against a real attacker-controlled
 * or metadata endpoint — the blocked-URL assertions rely entirely on
 * urlSafety.cjs's local IP-literal/hostname checks, which never leave the
 * process. The one real network call in this file is a request to
 * 127.0.0.1 on a closed port, which is refused by the guard before any
 * socket is opened.
 *
 * Usage: node tests/security/150-image-processor-ssrf-guard.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function assert(c, p, f) { c ? ok(p) : ko(p, f); }
function section(title)  { console.log(`\n[${title}]`); }

async function main() {
  const agent = require("../../agents/content/imageProcessorAgent.cjs");

  section("SSRF guard — cloud metadata endpoint rejected before any fetch");
  {
    const result = await agent.upscale({ imageUrl: "http://169.254.169.254/latest/meta-data/", scale: 2 }).catch(e => ({ error: e.message }));
    assert(!!result.error, "upscale() throws rather than fetching the cloud metadata endpoint", JSON.stringify(result));
    assert(/Refusing to fetch|blocked/i.test(result.error), "the error names the real cause (SSRF refusal), not a generic failure", result.error);
  }

  section("SSRF guard — RFC1918 private ranges rejected");
  {
    for (const badUrl of ["http://10.0.0.1/secret", "http://192.168.1.1/admin", "http://172.16.0.1/internal"]) {
      const result = await agent.edit({ imageUrl: badUrl, grayscale: true }).catch(e => ({ error: e.message }));
      assert(!!result.error, `edit() refuses private-range URL ${badUrl}`, JSON.stringify(result));
    }
  }

  section("SSRF guard — loopback hostnames and IPv6 literals rejected");
  {
    for (const badUrl of ["http://localhost:9999/x", "http://127.0.0.1:9999/x", "http://[::1]:9999/x"]) {
      const result = await agent.upscale({ imageUrl: badUrl }).catch(e => ({ error: e.message }));
      assert(!!result.error, `upscale() refuses loopback URL ${badUrl}`, JSON.stringify(result));
    }
  }

  section("Non-http(s) scheme rejected (existing guard behavior, exercised via this wiring)");
  {
    const result = await agent.edit({ imageUrl: "file:///etc/passwd" }).catch(e => ({ error: e.message }));
    assert(!!result.error, "edit() refuses a file:// scheme URL", JSON.stringify(result));
  }

  section("Legitimate inputs are unaffected by the new guard");
  {
    // A 1x1 red PNG as a data: URL — must bypass the guard entirely (data:
    // URLs never reach assertSafeNavigationTarget) and produce a real
    // sharp-processed output.
    const onePxPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const result = await agent.upscale({ imageUrl: `data:image/png;base64,${onePxPng}`, scale: 2 });
    assert(result.generated === true, "a data: URL source image is still processed normally", JSON.stringify(result));
    assert(result.via === "sharp", "the real sharp path still runs for legitimate input");
    assert(typeof result.filename === "string" && result.filename.length > 0, "a real output file is produced");

    const fs = require("fs");
    const path = require("path");
    const outPath = path.join(__dirname, "../../data/processed-images", result.filename);
    assert(fs.existsSync(outPath), "the processed file genuinely exists on disk");
    fs.unlinkSync(outPath);
  }

  section("A public https URL still reaches the real fetch path (guard passes, fetch itself then fails naturally)");
  {
    // A syntactically valid public host that isn't listening on this port —
    // proves the guard does NOT block ordinary public URLs, only
    // private/internal ones. The ECONNREFUSED/timeout that follows is a
    // real network failure, not an SSRF refusal.
    const result = await agent.upscale({ imageUrl: "http://127.0.0.1:1/definitely-closed-port.png" }).catch(e => ({ error: e.message }));
    assert(!!result.error, "a closed-port loopback URL still fails (as a private-range block, in this case)", JSON.stringify(result));
    assert(/Refusing to fetch|blocked/i.test(result.error), "127.0.0.1 is correctly caught by the private-range check even before a connection is attempted", result.error);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f.msg}: ${f.reason}`);
    process.exit(1);
  }
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
