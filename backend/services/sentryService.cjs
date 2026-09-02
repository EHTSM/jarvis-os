"use strict";
/**
 * Sentry Integration Service — crash reporting, event delivery, release tracking.
 *
 * No SDK dependency — uses Sentry's HTTP Envelope API directly.
 * Sentry DSN format: https://<key>@<host>/sentry/<project-id>
 *
 * Public API:
 *   isConfigured()                          → boolean
 *   captureException(err, context)          → { ok, eventId? }
 *   captureMessage(msg, level, context)     → { ok, eventId? }
 *   createRelease(version, projects)        → { ok }
 *   verifyDelivery()                        → { ok, detail }
 *   getConfig()                             → { dsn, environment, release, configured }
 *
 * OOPLIX V1 MASTER AUDIT — SENTRY_DSN blocker investigation (2026-08-16):
 * sourcemap upload was never implemented (a real upload needs the Sentry
 * CLI, not this HTTP-envelope client) — the doc line claiming a stub
 * existed was itself inaccurate and has been removed rather than left to
 * imply a capability this file doesn't have.
 *
 * Monitoring Ecosystem mission: captureException()/captureMessage()'s
 * tags/extra/user context is now redacted (see _redact() below) before
 * being sent — every current call site already only passes safe static
 * values, but this closes the gap at the shared choke point so a future
 * caller can't accidentally leak a secret/token/password/session value to
 * a real third-party service.
 */

const https  = require("https");
const crypto = require("crypto");

function _env(k) { return process.env[k] || ""; }

// ── Redaction ─────────────────────────────────────────────────────────────────
// Monitoring Ecosystem mission: captureException()/captureMessage() passed
// context.tags/extra/user straight through to Sentry's real envelope with
// zero scrubbing. Every current call site (backend/server.js's global error
// handler + the two process-level handlers) only ever passes safe static
// strings/req.originalUrl — genuinely safe today, by caller discipline, not
// because this function enforces it. A future caller passing req.body,
// req.headers, or a raw user/session object into context would leak
// secrets/tokens/PII to a real third-party service with no guard at the one
// shared choke point every capture call already goes through. Modeled after
// toolExecutionLayer.cjs's _sanitizeParams() key-matching regex for
// consistency, extended with recursion since Sentry context is often nested
// (e.g. context.user, context.extra.request).
const _SENSITIVE_KEY_RE = /token|secret|key|password|passwd|auth|credential|cookie|session|dsn|apikey/i;
const _REDACTED = "[redacted]";

function _redact(value, depth = 0) {
  if (depth > 6) return "[max-depth]"; // guard against pathological/circular input, not a real use case
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(v => _redact(v, depth + 1));
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = _SENSITIVE_KEY_RE.test(k) ? _REDACTED : _redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

// ── DSN parsing ───────────────────────────────────────────────────────────────

function _parseDSN(dsn) {
  if (!dsn) return null;
  try {
    const u       = new URL(dsn);
    const key     = u.username;
    const host    = u.hostname;
    const project = u.pathname.replace("/", "").split("/").pop();
    const port    = u.port || (u.protocol === "https:" ? "443" : "80");
    const storeUrl= `${u.protocol}//${host}:${port}/api/${project}/envelope/`;
    return { key, host, project, port, storeUrl };
  } catch { return null; }
}

function _parsed() { return _parseDSN(_env("SENTRY_DSN")); }

function isConfigured() { return !!_parsed(); }

// ── Sentry Envelope format ────────────────────────────────────────────────────

function _makeEnvelope(header, itemHeader, payload) {
  const h = JSON.stringify(header);
  const i = JSON.stringify(itemHeader);
  const p = JSON.stringify(payload);
  return `${h}\n${i}\n${p}\n`;
}

function _send(envelope) {
  const cfg = _parsed();
  if (!cfg) return Promise.resolve({ ok: false, error: "SENTRY_DSN not configured" });

  return new Promise(resolve => {
    const data = Buffer.from(envelope, "utf8");
    const req  = https.request({
      hostname: cfg.host, port: cfg.port || 443,
      path:     new URL(cfg.storeUrl).pathname,
      method:   "POST",
      headers: {
        "Content-Type":   "application/x-sentry-envelope",
        "Content-Length": data.length,
        "X-Sentry-Auth":  `Sentry sentry_version=7, sentry_client=ooplix-sentry/1.0, sentry_key=${cfg.key}`,
      },
    }, res => {
      let body = "";
      res.on("data", c => { body += c; });
      res.on("end", () => {
        const ok = res.statusCode === 200;
        let eventId;
        try { eventId = JSON.parse(body)?.id; } catch { /* ignore */ }
        resolve({ ok, status: res.statusCode, eventId, error: ok ? null : `HTTP ${res.statusCode}: ${body.slice(0, 100)}` });
      });
    });
    req.setTimeout(8000, () => { req.destroy(); resolve({ ok: false, error: "timeout" }); });
    req.on("error", e => resolve({ ok: false, error: e.message }));
    req.write(data);
    req.end();
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

async function captureException(err, context = {}) {
  const cfg = _parsed();
  if (!cfg) return { ok: false, error: "SENTRY_DSN not set" };

  const eventId  = crypto.randomBytes(16).toString("hex");
  const envelope = _makeEnvelope(
    { event_id: eventId, dsn: _env("SENTRY_DSN"), sent_at: new Date().toISOString() },
    { type: "event", length: 0 },
    {
      event_id:    eventId,
      timestamp:   new Date().toISOString(),
      platform:    "node",
      level:       "error",
      environment: _env("SENTRY_ENVIRONMENT") || _env("NODE_ENV") || "production",
      release:     _env("SENTRY_RELEASE") || _env("npm_package_version") || "unknown",
      exception: {
        values: [{
          type:       err?.name || "Error",
          value:      err?.message || String(err),
          stacktrace: { frames: _parseStack(err?.stack || "") },
        }],
      },
      tags:   _redact(context.tags || {}),
      extra:  _redact(context.extra || {}),
      user:   _redact(context.user || {}),
    }
  );
  return _send(envelope);
}

async function captureMessage(message, level = "info", context = {}) {
  const cfg = _parsed();
  if (!cfg) return { ok: false, error: "SENTRY_DSN not set" };

  const eventId  = crypto.randomBytes(16).toString("hex");
  const envelope = _makeEnvelope(
    { event_id: eventId, dsn: _env("SENTRY_DSN"), sent_at: new Date().toISOString() },
    { type: "event" },
    {
      event_id:    eventId,
      timestamp:   new Date().toISOString(),
      platform:    "node",
      level,
      environment: _env("SENTRY_ENVIRONMENT") || _env("NODE_ENV") || "production",
      release:     _env("SENTRY_RELEASE") || "unknown",
      message:     { formatted: message },
      tags:        _redact(context.tags || {}),
      extra:       _redact(context.extra || {}),
    }
  );
  return _send(envelope);
}

// Release tracking via Sentry REST API (requires auth token, falls back to DSN key)
async function createRelease(version, projects = ["ooplix"]) {
  const cfg   = _parsed();
  if (!cfg) return { ok: false, error: "SENTRY_DSN not set" };

  const org    = _env("SENTRY_ORG") || "ooplix";
  const token  = _env("SENTRY_AUTH_TOKEN");
  if (!token) return { ok: false, error: "SENTRY_AUTH_TOKEN required for release tracking — set it in .env" };

  return new Promise(resolve => {
    const body = JSON.stringify({ version, projects, dateStarted: new Date().toISOString() });
    const req  = https.request({
      hostname: cfg.host, port: 443,
      path:     `/api/0/organizations/${org}/releases/`,
      method:   "POST",
      headers: {
        "Content-Type":   "application/json",
        "Content-Length": Buffer.byteLength(body),
        "Authorization":  `Bearer ${token}`,
      },
    }, res => {
      let data = "";
      res.on("data", c => { data += c; });
      res.on("end", () => resolve({ ok: res.statusCode === 201 || res.statusCode === 208, status: res.statusCode, error: res.statusCode >= 300 ? `HTTP ${res.statusCode}` : null }));
    });
    req.on("error", e => resolve({ ok: false, error: e.message }));
    req.write(body);
    req.end();
  });
}

// Verify delivery by sending a test message and checking for HTTP 200
async function verifyDelivery() {
  if (!isConfigured()) return { ok: false, detail: "SENTRY_DSN not configured" };
  const result = await captureMessage("Ooplix production wiring verification — ignore this event", "debug",
    { tags: { source: "pcs_verification" } });
  return { ok: result.ok, detail: result.ok ? `Event delivered (id: ${result.eventId})` : `Delivery failed: ${result.error}`, eventId: result.eventId };
}

function getConfig() {
  const cfg = _parsed();
  return {
    dsn:         _env("SENTRY_DSN") ? `${_env("SENTRY_DSN").slice(0,30)}...` : null,
    environment: _env("SENTRY_ENVIRONMENT") || _env("NODE_ENV") || "production",
    release:     _env("SENTRY_RELEASE") || "not set",
    org:         _env("SENTRY_ORG") || "not set",
    authToken:   _env("SENTRY_AUTH_TOKEN") ? "set" : "missing",
    configured:  isConfigured(),
  };
}

function _parseStack(stack) {
  if (!stack) return [];
  return stack.split("\n").slice(1).map(line => {
    const m = line.trim().match(/at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?/);
    if (!m) return { filename: line, lineno: 0 };
    return { function: m[1] || "<anonymous>", filename: m[2], lineno: parseInt(m[3]), colno: parseInt(m[4]) };
  }).filter(f => f.filename).slice(0, 20);
}

module.exports = { isConfigured, captureException, captureMessage, createRelease, verifyDelivery, getConfig };
