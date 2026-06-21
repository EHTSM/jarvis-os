"use strict";
/**
 * Object Storage Service — AWS S3 + Cloudflare R2 (S3-compatible).
 *
 * No SDK dependency — raw AWS Signature V4 over HTTPS.
 * R2 is S3-compatible; same code path with a custom endpoint.
 *
 * Auto-detection priority:
 *   1. Cloudflare R2  — R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY + R2_BUCKET + R2_ACCOUNT_ID
 *   2. AWS S3         — S3_ACCESS_KEY (or AWS_ACCESS_KEY_ID) + S3_SECRET_KEY + S3_BUCKET
 *
 * Public API:
 *   detectProvider()                        → { provider, configured, bucket, endpoint }
 *   upload(key, body, contentType)          → { ok, url?, error? }
 *   download(key)                           → { ok, body?, contentType?, error? }
 *   deleteObject(key)                       → { ok, error? }
 *   signedUrl(key, expiresSeconds)          → { ok, url?, error? }
 *   listObjects(prefix)                     → { ok, keys[], error? }
 *   verifyProvider()                        → { ok, provider, detail }
 */

const https  = require("https");
const http   = require("http");
const crypto = require("crypto");
const stream = require("stream");

function _env(k)    { return process.env[k] || ""; }
function _has(...ks){ return ks.every(k => !!_env(k)); }

// ── Provider detection ────────────────────────────────────────────────────────

function detectProvider() {
  // R2 check
  if (_has("R2_ACCESS_KEY_ID","R2_SECRET_ACCESS_KEY","R2_BUCKET","R2_ACCOUNT_ID")) {
    const accountId = _env("R2_ACCOUNT_ID");
    const endpoint  = _env("R2_ENDPOINT") || `https://${accountId}.r2.cloudflarestorage.com`;
    return { provider: "r2", configured: true, bucket: _env("R2_BUCKET"), endpoint, region: "auto" };
  }
  // Cloudflare alias keys
  if (_has("CLOUDFLARE_ACCOUNT_ID","R2_ACCESS_KEY_ID","R2_SECRET_ACCESS_KEY","CLOUDFLARE_R2_BUCKET")) {
    const accountId = _env("CLOUDFLARE_ACCOUNT_ID");
    return { provider: "r2", configured: true, bucket: _env("CLOUDFLARE_R2_BUCKET"),
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`, region: "auto" };
  }
  // S3
  const s3Key    = _env("S3_ACCESS_KEY") || _env("AWS_ACCESS_KEY_ID");
  const s3Secret = _env("S3_SECRET_KEY") || _env("AWS_SECRET_ACCESS_KEY");
  const s3Bucket = _env("S3_BUCKET");
  if (s3Key && s3Secret && s3Bucket) {
    const region   = _env("S3_REGION") || _env("AWS_REGION") || "us-east-1";
    const endpoint = _env("S3_ENDPOINT") || `https://s3.${region}.amazonaws.com`;
    return { provider: "s3", configured: true, bucket: s3Bucket, endpoint, region };
  }
  return { provider: null, configured: false, bucket: null, endpoint: null, region: null };
}

// ── AWS Sig V4 ────────────────────────────────────────────────────────────────

function _hmac(key, data, enc) {
  return crypto.createHmac("sha256", key).update(data).digest(enc || undefined);
}

function _sigV4({ method, endpoint, bucket, key, body = "", contentType = "application/octet-stream",
                  accessKey, secretKey, region, service = "s3", extraHeaders = {}, queryParams = {} }) {
  const now      = new Date();
  const dateStr  = now.toISOString().replace(/[:\-]|\.\d{3}/g, "").slice(0, 15) + "Z";
  const dateKey  = dateStr.slice(0, 8);
  const host     = new URL(endpoint).hostname;
  const path     = `/${bucket}/${key}`.replace(/\/+/g, "/");

  const payload  = typeof body === "string" ? body : "";
  const bodyHash = crypto.createHash("sha256").update(payload).digest("hex");

  const qp      = new URLSearchParams({ ...queryParams });
  const queryStr= qp.toString();

  const allHeaders = { host, "x-amz-date": dateStr, "x-amz-content-sha256": bodyHash, ...extraHeaders };
  if (contentType && method !== "GET" && method !== "DELETE") allHeaders["content-type"] = contentType;

  const sortedKeys     = Object.keys(allHeaders).sort();
  const canonicalHeaders = sortedKeys.map(k => `${k}:${allHeaders[k]}`).join("\n") + "\n";
  const signedHeaders    = sortedKeys.join(";");

  const canonicalReq = [method, path, queryStr, canonicalHeaders, signedHeaders, bodyHash].join("\n");
  const credScope    = `${dateKey}/${region}/${service}/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${dateStr}\n${credScope}\n${crypto.createHash("sha256").update(canonicalReq).digest("hex")}`;

  const sigKey  = _hmac(_hmac(_hmac(_hmac(`AWS4${secretKey}`, dateKey), region), service), "aws4_request");
  const sig     = _hmac(sigKey, stringToSign, "hex");
  const auth    = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credScope}, SignedHeaders=${signedHeaders}, Signature=${sig}`;

  return { auth, dateStr, bodyHash, host, path, queryStr };
}

function _creds(prov) {
  if (prov.provider === "r2") {
    return {
      accessKey: _env("R2_ACCESS_KEY_ID"),
      secretKey: _env("R2_SECRET_ACCESS_KEY"),
      region:    "auto",
    };
  }
  return {
    accessKey: _env("S3_ACCESS_KEY") || _env("AWS_ACCESS_KEY_ID"),
    secretKey: _env("S3_SECRET_KEY") || _env("AWS_SECRET_ACCESS_KEY"),
    region:    prov.region || "us-east-1",
  };
}

// ── HTTP request ─────────────────────────────────────────────────────────────

function _httpsReq(opts, body, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const mod = opts.hostname?.startsWith("localhost") ? http : https;
    const req = mod.request(opts, res => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.setTimeout(timeoutMs, () => { req.destroy(new Error("timeout")); });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function _s3Req({ method, prov, key, body, contentType, queryParams = {}, timeoutMs = 15000 }) {
  const cr   = _creds(prov);
  const bodyBuf = body ? (Buffer.isBuffer(body) ? body : Buffer.from(body)) : Buffer.alloc(0);
  const bodyStr = bodyBuf.toString();

  const sig = _sigV4({
    method, endpoint: prov.endpoint, bucket: prov.bucket, key,
    body: bodyStr, contentType, ...cr, queryParams,
  });

  const u    = new URL(prov.endpoint);
  const path = `/${prov.bucket}/${key}`.replace(/\/+/, "/") + (sig.queryStr ? `?${sig.queryStr}` : "");

  const headers = {
    Host:                   sig.host,
    "X-Amz-Date":           sig.dateStr,
    "X-Amz-Content-Sha256": sig.bodyHash,
    Authorization:          sig.auth,
  };
  if (contentType && method !== "GET" && method !== "DELETE") headers["Content-Type"] = contentType;
  if (bodyBuf.length) headers["Content-Length"] = bodyBuf.length;

  return _httpsReq({
    hostname: sig.host, port: u.port || 443, path, method, headers,
  }, bodyBuf.length ? bodyBuf : null, timeoutMs);
}

// ── Public API ────────────────────────────────────────────────────────────────

async function upload(key, body, contentType = "application/octet-stream") {
  const prov = detectProvider();
  if (!prov.configured) return { ok: false, error: "No storage provider configured" };
  try {
    const res = await _s3Req({ method: "PUT", prov, key, body, contentType });
    const ok  = res.status === 200;
    const url = ok ? `${prov.endpoint}/${prov.bucket}/${key}` : null;
    return { ok, provider: prov.provider, url, status: res.status,
      error: ok ? null : `HTTP ${res.status}: ${res.body.toString().slice(0, 100)}` };
  } catch (e) { return { ok: false, provider: prov.provider, error: e.message }; }
}

async function download(key) {
  const prov = detectProvider();
  if (!prov.configured) return { ok: false, error: "No storage provider configured" };
  try {
    const res = await _s3Req({ method: "GET", prov, key });
    const ok  = res.status === 200;
    return { ok, provider: prov.provider, body: ok ? res.body : null,
      contentType: res.headers["content-type"] || null, status: res.status,
      error: ok ? null : `HTTP ${res.status}` };
  } catch (e) { return { ok: false, provider: prov.provider, error: e.message }; }
}

async function deleteObject(key) {
  const prov = detectProvider();
  if (!prov.configured) return { ok: false, error: "No storage provider configured" };
  try {
    const res = await _s3Req({ method: "DELETE", prov, key });
    const ok  = res.status === 204 || res.status === 200;
    return { ok, provider: prov.provider, status: res.status,
      error: ok ? null : `HTTP ${res.status}` };
  } catch (e) { return { ok: false, provider: prov.provider, error: e.message }; }
}

async function listObjects(prefix = "") {
  const prov = detectProvider();
  if (!prov.configured) return { ok: false, error: "No storage provider configured" };
  try {
    const res = await _s3Req({ method: "GET", prov, key: "", queryParams: { "list-type": "2", prefix, "max-keys": "100" } });
    const ok  = res.status === 200;
    const xml = res.body.toString();
    const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map(m => m[1]);
    return { ok, provider: prov.provider, keys, count: keys.length, status: res.status,
      error: ok ? null : `HTTP ${res.status}` };
  } catch (e) { return { ok: false, provider: prov.provider, error: e.message }; }
}

// Presigned URL — generates the URL client-side without a network call
function signedUrl(key, expiresSeconds = 3600) {
  const prov = detectProvider();
  if (!prov.configured) return { ok: false, error: "No storage provider configured" };
  const cr = _creds(prov);
  try {
    const now     = new Date();
    const dateStr = now.toISOString().replace(/[:\-]|\.\d{3}/g, "").slice(0, 15) + "Z";
    const dateKey = dateStr.slice(0, 8);
    const region  = cr.region || "us-east-1";
    const service = "s3";
    const host    = new URL(prov.endpoint).hostname;
    const path    = `/${prov.bucket}/${key}`.replace(/\/+/, "/");

    const credScope   = `${dateKey}/${region}/${service}/aws4_request`;
    const credential  = `${cr.accessKey}/${credScope}`;
    const qp = new URLSearchParams({
      "X-Amz-Algorithm":  "AWS4-HMAC-SHA256",
      "X-Amz-Credential": credential,
      "X-Amz-Date":       dateStr,
      "X-Amz-Expires":    String(expiresSeconds),
      "X-Amz-SignedHeaders": "host",
    });

    const canonicalReq = `GET\n${path}\n${qp.toString()}\nhost:${host}\n\nhost\nUNSIGNED-PAYLOAD`;
    const stringToSign = `AWS4-HMAC-SHA256\n${dateStr}\n${credScope}\n${crypto.createHash("sha256").update(canonicalReq).digest("hex")}`;
    const sigKey = _hmac(_hmac(_hmac(_hmac(`AWS4${cr.secretKey}`, dateKey), region), service), "aws4_request");
    qp.set("X-Amz-Signature", _hmac(sigKey, stringToSign, "hex"));

    const url = `${prov.endpoint}/${prov.bucket}/${key}?${qp.toString()}`;
    return { ok: true, provider: prov.provider, url, expiresIn: expiresSeconds };
  } catch (e) { return { ok: false, provider: prov.provider, error: e.message }; }
}

async function verifyProvider() {
  const prov = detectProvider();
  if (!prov.configured) return { ok: false, provider: null, detail: "No storage provider configured — set S3_BUCKET+S3_ACCESS_KEY+S3_SECRET_KEY or R2_BUCKET+R2_ACCESS_KEY_ID+R2_SECRET_ACCESS_KEY+R2_ACCOUNT_ID" };

  // Lightweight: list objects in bucket root (max 1) — if bucket accessible we're good
  try {
    const res = await listObjects("");
    // 200 = accessible, 403 = exists but no list permission (still wired)
    if (res.ok || res.status === 403) {
      return { ok: true, provider: prov.provider, bucket: prov.bucket, endpoint: prov.endpoint,
        detail: res.ok ? `Bucket accessible — ${res.count} objects` : "Bucket exists (list permission denied — bucket still accessible)" };
    }
    return { ok: false, provider: prov.provider, detail: `HTTP ${res.status} — ${res.error}` };
  } catch (e) {
    return { ok: false, provider: prov.provider, detail: e.message };
  }
}

module.exports = { detectProvider, upload, download, deleteObject, signedUrl, listObjects, verifyProvider };
