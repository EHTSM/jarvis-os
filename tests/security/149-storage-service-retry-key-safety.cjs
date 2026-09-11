#!/usr/bin/env node
"use strict";
/**
 * storageService.cjs (AWS S3 / Cloudflare R2) — Cloud category completion.
 *
 * Discovery confirmed storageService.cjs already had a real, working
 * SigV4-signed execution path (upload/download/delete/list/signedUrl) with
 * no SDK dependency — genuinely CODE-COMPLETE for basic execution, but with
 * three real gaps relative to every other completed category's connectors:
 *   1. No retry/backoff on transient failures (timeout/ECONNRESET/429/5xx) —
 *      every call was single-attempt, unlike aiService.js/twilioService.js/
 *      whatsappService.js's established retry pattern.
 *   2. No key-traversal guard inside the service itself — every current
 *      caller (enterprisePhysical.js, exportFileService.cjs) already
 *      validates/sanitizes the key or orgId at the call site, but a future
 *      caller that forgot to would silently reintroduce cross-tenant object
 *      access via "../other-org/...". This is the exact repeated-defect
 *      class CLAUDE.md §6 flags — a check present on some siblings but not
 *      enforced at the shared choke point.
 *   3. signedUrl() didn't clamp/validate expiresSeconds — a caller passing
 *      an unbounded or negative value would silently produce a malformed or
 *      effectively-unlimited-window signed URL.
 *   4. Zero tests existed for this file despite it performing real writes/
 *      deletes (a materially higher-risk class than the read-only health
 *      probes elsewhere in integrationConnectors.cjs, which this repo's own
 *      precedent — Figma etc. — correctly leaves untested).
 *
 * This test never touches a real AWS/R2 bucket. Two techniques are used:
 *   - A local HTTP server (loopback only) stands in for S3/R2 to prove real
 *     retry/backoff behavior against real HTTP responses, using the same
 *     "localhost => http module" branch _httpsReq() already has.
 *   - One deliberate real-network call to AWS's actual S3 endpoint with a
 *     syntactically valid but fake key pair, proving the SigV4 wiring is
 *     genuine (not a mock) and is honestly rejected — mirroring test 147's
 *     Twilio precedent. Zero real objects are read, written, or deleted.
 *
 * Usage: node tests/security/149-storage-service-retry-key-safety.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

const http = require("http");

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function assert(c, p, f) { c ? ok(p) : ko(p, f); }
function section(title)  { console.log(`\n[${title}]`); }

function freshStorage() {
  delete require.cache[require.resolve("../../backend/services/storageService.cjs")];
  return require("../../backend/services/storageService.cjs");
}

function clearS3Env() {
  for (const k of ["R2_ACCESS_KEY_ID","R2_SECRET_ACCESS_KEY","R2_BUCKET","R2_ACCOUNT_ID","R2_ENDPOINT",
                    "CLOUDFLARE_ACCOUNT_ID","CLOUDFLARE_R2_BUCKET",
                    "S3_ACCESS_KEY","S3_SECRET_KEY","S3_BUCKET","S3_ENDPOINT","S3_REGION",
                    "AWS_ACCESS_KEY_ID","AWS_SECRET_ACCESS_KEY","AWS_REGION"]) {
    delete process.env[k];
  }
}

// Minimal loopback stand-in for an S3/R2-compatible endpoint. `behavior` is
// an array of HTTP status codes to return on successive requests (cycling
// on the last entry once exhausted) so tests can script "500, then 200".
function startFakeS3(behavior) {
  let calls = 0;
  const server = http.createServer((req, res) => {
    const status = behavior[Math.min(calls, behavior.length - 1)];
    calls++;
    if (req.method === "GET" && req.url.includes("list-type")) {
      res.writeHead(status, { "content-type": "application/xml" });
      res.end(status === 200 ? "<ListBucketResult></ListBucketResult>" : "denied");
    } else {
      res.writeHead(status, { "content-type": "text/plain" });
      res.end(status === 200 || status === 204 ? "" : "error body");
    }
  });
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port, callCount: () => calls })));
}

async function main() {
  section("Not configured — honest failure, no fabricated success");
  {
    clearS3Env();
    const svc = freshStorage();
    const up = await svc.upload("some/key.txt", Buffer.from("x"));
    assert(up.ok === false, "upload() returns ok:false when no provider is configured", JSON.stringify(up));
    assert(/not configured|No storage provider/i.test(up.error || ""), "error names the real cause", up.error);
    const dl = await svc.download("some/key.txt");
    assert(dl.ok === false && !dl.body, "download() returns ok:false with no body fabricated");
    const del = await svc.deleteObject("some/key.txt");
    assert(del.ok === false, "deleteObject() returns ok:false when unconfigured");
    const detect = svc.detectProvider();
    assert(detect.configured === false && detect.provider === null, "detectProvider() reports unconfigured honestly");
  }

  section("Key-traversal rejected at the service choke point (defense-in-depth)");
  {
    process.env.S3_ACCESS_KEY = "fakeKey";
    process.env.S3_SECRET_KEY = "fakeSecret";
    process.env.S3_BUCKET     = "fake-bucket";
    process.env.S3_ENDPOINT   = "https://s3.us-east-1.amazonaws.com";
    const svc = freshStorage();

    for (const badKey of ["../other-org/secret.txt", "/etc/passwd", "org/a/../../org/b/file.txt"]) {
      const up = await svc.upload(badKey, Buffer.from("x"));
      assert(up.ok === false && /Invalid storage key/.test(up.error || ""), `upload() rejects traversal key "${badKey}"`, JSON.stringify(up));
      const dl = await svc.download(badKey);
      assert(dl.ok === false && /Invalid storage key/.test(dl.error || ""), `download() rejects traversal key "${badKey}"`);
      const del = await svc.deleteObject(badKey);
      assert(del.ok === false && /Invalid storage key/.test(del.error || ""), `deleteObject() rejects traversal key "${badKey}"`);
      const su = svc.signedUrl(badKey);
      assert(su.ok === false && /Invalid storage key/.test(su.error || ""), `signedUrl() rejects traversal key "${badKey}"`);
    }

    const legit = await svc.upload("org/abc123/folder-sync/report.pdf", Buffer.from("x")).catch(e => ({ ok: false, error: e.message }));
    assert(!/Invalid storage key/.test(legit.error || ""), "a legitimate org-scoped key is not rejected by the guard itself", JSON.stringify(legit));
  }

  section("signedUrl() clamps expiry to a sane, bounded window");
  {
    process.env.S3_ACCESS_KEY = "fakeKey";
    process.env.S3_SECRET_KEY = "fakeSecret";
    process.env.S3_BUCKET     = "fake-bucket";
    process.env.S3_ENDPOINT   = "https://s3.us-east-1.amazonaws.com";
    const svc = freshStorage();

    const huge = svc.signedUrl("org/x/file.txt", 999999999);
    assert(huge.ok === true, "signedUrl() still succeeds with an out-of-range expiry");
    assert(huge.expiresIn <= 7 * 24 * 3600, "an oversized expiresSeconds is clamped to the 7-day SigV4 ceiling", huge.expiresIn);

    const negative = svc.signedUrl("org/x/file.txt", -50);
    assert(negative.expiresIn >= 1, "a negative expiresSeconds is clamped to a positive minimum", negative.expiresIn);

    const normal = svc.signedUrl("org/x/file.txt", 1800);
    assert(normal.expiresIn === 1800, "a normal in-range expiry passes through unchanged", normal.expiresIn);
    assert(normal.url.includes("X-Amz-Expires=1800"), "the clamped value is what actually gets signed into the URL");
  }

  section("Retry — 500 then 200 succeeds without surfacing the transient failure");
  {
    const { server, port, callCount } = await startFakeS3([500, 200]);
    process.env.S3_ACCESS_KEY = "fakeKey";
    process.env.S3_SECRET_KEY = "fakeSecret";
    process.env.S3_BUCKET     = "fake-bucket";
    process.env.S3_ENDPOINT   = `http://localhost:${port}`;
    const svc = freshStorage();
    const res = await svc.upload("org/x/file.txt", Buffer.from("hello"));
    server.close();
    assert(res.ok === true, "upload() succeeds after one transient 500 is retried", JSON.stringify(res));
    assert(callCount() === 2, "exactly one retry attempt was made (2 total calls)", callCount());
  }

  section("Retry — 429 is retried the same as 5xx");
  {
    const { server, port, callCount } = await startFakeS3([429, 200]);
    process.env.S3_ACCESS_KEY = "fakeKey";
    process.env.S3_SECRET_KEY = "fakeSecret";
    process.env.S3_BUCKET     = "fake-bucket";
    process.env.S3_ENDPOINT   = `http://localhost:${port}`;
    const svc = freshStorage();
    const res = await svc.listObjects("");
    server.close();
    assert(res.ok === true, "listObjects() succeeds after a 429 is retried", JSON.stringify(res));
    assert(callCount() === 2, "429 triggers exactly one retry", callCount());
  }

  section("Retry — persistent 500 exhausts retries and returns an honest failure");
  {
    const { server, port, callCount } = await startFakeS3([500]);
    process.env.S3_ACCESS_KEY = "fakeKey";
    process.env.S3_SECRET_KEY = "fakeSecret";
    process.env.S3_BUCKET     = "fake-bucket";
    process.env.S3_ENDPOINT   = `http://localhost:${port}`;
    const svc = freshStorage();
    const res = await svc.upload("org/x/file.txt", Buffer.from("hello"));
    server.close();
    assert(res.ok === false, "upload() reports failure once retries are exhausted, never a fabricated success", JSON.stringify(res));
    assert(callCount() === 3, "exactly 2 retries were attempted (3 total calls: initial + 2 retries)", callCount());
  }

  section("No retry on a permanent 403/404 — fails fast");
  {
    const { server, port, callCount } = await startFakeS3([403]);
    process.env.S3_ACCESS_KEY = "fakeKey";
    process.env.S3_SECRET_KEY = "fakeSecret";
    process.env.S3_BUCKET     = "fake-bucket";
    process.env.S3_ENDPOINT   = `http://localhost:${port}`;
    const svc = freshStorage();
    const res = await svc.download("org/x/file.txt");
    server.close();
    assert(res.ok === false && res.status === 403, "download() surfaces a 403 immediately", JSON.stringify(res));
    assert(callCount() === 1, "a non-retryable 4xx status makes exactly one attempt, no wasted retries", callCount());
  }

  section("verifyProvider() treats 403 as 'wired but unauthorized', not a hard failure");
  {
    const { server, port } = await startFakeS3([403]);
    process.env.S3_ACCESS_KEY = "fakeKey";
    process.env.S3_SECRET_KEY = "fakeSecret";
    process.env.S3_BUCKET     = "fake-bucket";
    process.env.S3_ENDPOINT   = `http://localhost:${port}`;
    const svc = freshStorage();
    const res = await svc.verifyProvider();
    server.close();
    assert(res.ok === true, "verifyProvider() still reports ok:true on a permission-denied-but-reachable bucket", JSON.stringify(res));
  }

  section("R2 auto-detection takes priority over S3 when both credential sets are present");
  {
    clearS3Env();
    process.env.R2_ACCESS_KEY_ID     = "r2key";
    process.env.R2_SECRET_ACCESS_KEY = "r2secret";
    process.env.R2_BUCKET            = "r2-bucket";
    process.env.R2_ACCOUNT_ID        = "acct123";
    process.env.S3_ACCESS_KEY        = "s3key";
    process.env.S3_SECRET_KEY        = "s3secret";
    process.env.S3_BUCKET            = "s3-bucket";
    const svc = freshStorage();
    const detect = svc.detectProvider();
    assert(detect.provider === "r2", "R2 wins auto-detection when both R2 and S3 env vars are set", JSON.stringify(detect));
    assert(detect.endpoint.includes("acct123"), "R2 endpoint is derived from the account ID");
  }

  section("Real network call with a syntactically valid but fake key pair — genuine SigV4 wiring, honestly rejected");
  {
    clearS3Env();
    process.env.S3_ACCESS_KEY = "AKIAFAKEFAKEFAKEFAKE";
    process.env.S3_SECRET_KEY = "fakeSecretKeyThatIsDefinitelyNotReal1234567890";
    process.env.S3_BUCKET     = "ooplix-mission76-nonexistent-probe-bucket";
    process.env.S3_REGION     = "us-east-1";
    const svc = freshStorage();
    const res = await svc.download("mission76-probe-key-never-real.txt");
    assert(res.ok === false, "a real network round-trip to AWS's actual S3 endpoint with fake credentials is honestly rejected", JSON.stringify(res));
    assert(!res.body, "no object body is fabricated after the real rejection");
    assert(typeof res.status === "number" && res.status >= 400, "a real HTTP error status came back from AWS, not a synthetic one", res.status);
  }

  clearS3Env();

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f.msg}: ${f.reason}`);
    process.exit(1);
  }
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
