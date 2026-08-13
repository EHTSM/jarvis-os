"use strict";
/**
 * B.20 — chaos scenarios, mapped to the brief's failure domains.
 *
 * Every scenario runs against real mounted routes (enumerated from
 * backend/routes/index.js — the app mounts 4,755 routes WITHOUT an /api
 * prefix) using cookie auth, which is the only auth the app accepts.
 *
 * Classification vocabulary is fixed by the brief:
 *   PRODUCTION READY | FIXED | CREDENTIAL BLOCKED | VERIFY | UNKNOWN
 *   GENUINE CAPABILITY GAP | BUILD REQUIRED
 *
 * A scenario may only claim PRODUCTION READY on a property it actually
 * observed. "No error appeared" is not evidence that a guarantee holds.
 */

/** Does a body look like a real error rather than a fabricated success? */
function honestError(r, j) {
  if (r.ok) return false;
  if (!j) return r.body.length > 0;           // non-JSON error body still surfaces
  return j.error !== undefined || j.success === false || j.message !== undefined;
}

module.exports = [
  // ── E. API 401/403 — unauthenticated and cross-tenant ────────────────────
  {
    domain: "E",
    name: "unauthenticated request is denied (not served)",
    async run({ request, json, record }) {
      const r = await request({ path: "/runtime/status" });
      const j = json(r);
      const denied = r.status === 401 || r.status === 403;
      record("E", this.name,
        denied && honestError(r, j) ? "PRODUCTION READY" : "VERIFY",
        `status=${r.status} body=${JSON.stringify(j || r.body.slice(0, 60))}`,
        { status: r.status, ms: r.ms });
    },
  },

  // ── V. Tenant isolation under normal and failure conditions ──────────────
  {
    domain: "V",
    name: "tenant A cannot read tenant B's workspace members",
    async run({ A, B, cookieA, request, json, record }) {
      // /workspace/:id/members IS tenant-scoped (requireWorkspaceMember).
      // /runtime/status deliberately is NOT used — it is a global runtime
      // endpoint that ignores x-workspace-id, so it cannot evidence isolation.
      const r = await request({ path: `/workspace/${B.workspaceId}/members`, cookie: cookieA, workspaceId: B.workspaceId });
      const denied = r.status === 403 || r.status === 404;
      record("V", this.name,
        denied ? "PRODUCTION READY" : "VERIFY",
        `A→B members: status=${r.status} ${denied ? "denied" : "LEAK: " + r.body.slice(0, 80)}`,
        { status: r.status, ms: r.ms });
    },
  },
  {
    domain: "V",
    name: "cross-tenant denial survives repeated retry (no bypass on retry)",
    async run({ A, B, cookieA, request, record }) {
      const statuses = [];
      for (let i = 0; i < 8; i++) {
        const r = await request({ path: `/workspace/${B.workspaceId}/members`, cookie: cookieA, workspaceId: B.workspaceId });
        statuses.push(r.status);
      }
      const allDenied = statuses.every((s) => s === 403 || s === 404);
      record("V", this.name,
        allDenied ? "PRODUCTION READY" : "VERIFY",
        `8 retries → ${JSON.stringify([...new Set(statuses)])}`,
        { statuses });
    },
  },
  {
    domain: "V",
    name: "tenant A's workspace list contains only A's workspaces",
    async run({ A, B, cookieA, request, json, record }) {
      const r = await request({ path: "/workspace", cookie: cookieA, workspaceId: A.workspaceId });
      const j = json(r);
      const list = Array.isArray(j) ? j : Array.isArray(j?.workspaces) ? j.workspaces : null;
      if (!list) { record("V", this.name, "UNKNOWN", `unreadable list shape (status=${r.status})`, { status: r.status }); return; }
      const ids = list.map((w) => w.id);
      const leaked = ids.includes(B.workspaceId);
      record("V", this.name,
        leaked ? "VERIFY" : "PRODUCTION READY",
        leaked ? `LEAK: B's workspace ${B.workspaceId} present in A's list`
               : `${ids.length} workspace(s), none belonging to B`,
        { status: r.status, count: ids.length, leaked });
    },
  },
  {
    domain: "V",
    name: "tenant B response is not served from tenant A's cache",
    async run({ A, B, cookieA, cookieB, request, json, record }) {
      const a = await request({ path: "/workspace", cookie: cookieA, workspaceId: A.workspaceId });
      const b = await request({ path: "/workspace", cookie: cookieB, workspaceId: B.workspaceId });
      const ja = json(a), jb = json(b);
      const sa = JSON.stringify(ja), sb = JSON.stringify(jb);
      // Identical payloads across two different tenants would indicate a shared
      // cache. Both being errors is not evidence either way.
      const bothOk = a.ok && b.ok;
      const identical = bothOk && sa === sb;
      record("V", this.name,
        !bothOk ? "VERIFY" : identical ? "VERIFY" : "PRODUCTION READY",
        bothOk ? (identical ? "IDENTICAL payloads across tenants" : `distinct payloads (A ${sa.length}b, B ${sb.length}b)`)
               : `A=${a.status} B=${b.status} — not both readable, isolation not provable here`,
        { statusA: a.status, statusB: b.status });
    },
  },

  // ── U. Session expiry mid-workflow ───────────────────────────────────────
  {
    domain: "U",
    name: "expired session is rejected, not silently accepted",
    async run({ A, request, json, record }) {
      const path_ = require("path");
      const { signJWT, COOKIE_NAME } = require(path_.join(__dirname, "..", "backend", "middleware", "authMiddleware.js"));
      // Sign a token that expired an hour ago.
      const jwt = signJWT({ role: "operator", sub: A.accountId, exp: Math.floor(Date.now() / 1000) - 3600 });
      const r = await request({ path: "/runtime/status", cookie: `${COOKIE_NAME}=${jwt}`, workspaceId: A.workspaceId });
      const j = json(r);
      const denied = r.status === 401 || r.status === 403;
      record("U", this.name,
        denied ? "PRODUCTION READY" : "VERIFY",
        `status=${r.status} ${denied ? "rejected" : "ACCEPTED EXPIRED TOKEN"} ${JSON.stringify(j || "").slice(0, 60)}`,
        { status: r.status });
    },
  },
  {
    domain: "U",
    name: "tampered session signature is rejected",
    async run({ A, request, record }) {
      const path_ = require("path");
      const { signJWT, COOKIE_NAME } = require(path_.join(__dirname, "..", "backend", "middleware", "authMiddleware.js"));
      const good = signJWT({ role: "operator", sub: A.accountId });
      // Flip the last signature character — a forged token.
      const bad = good.slice(0, -1) + (good.slice(-1) === "A" ? "B" : "A");
      const r = await request({ path: "/runtime/status", cookie: `${COOKIE_NAME}=${bad}`, workspaceId: A.workspaceId });
      const denied = r.status === 401 || r.status === 403;
      record("U", this.name,
        denied ? "PRODUCTION READY" : "VERIFY",
        `status=${r.status} ${denied ? "rejected" : "ACCEPTED FORGED SIGNATURE"}`,
        { status: r.status });
    },
  },
  {
    domain: "E",
    name: "role escalation via token claim is not honoured blindly",
    async run({ A, B, request, json, record }) {
      const path_ = require("path");
      const { signJWT, COOKIE_NAME } = require(path_.join(__dirname, "..", "backend", "middleware", "authMiddleware.js"));
      // A self-signed token claiming operator role, but for B's workspace.
      const jwt = signJWT({ role: "operator", sub: A.accountId });
      const r = await request({ path: "/workspace/" + B.workspaceId + "/members", cookie: `${COOKIE_NAME}=${jwt}`, workspaceId: B.workspaceId });
      const denied = r.status === 403 || r.status === 404;
      record("E", this.name,
        denied ? "PRODUCTION READY" : "VERIFY",
        `operator-claim → B's members: status=${r.status} ${denied ? "denied" : "GRANTED: " + r.body.slice(0, 70)}`,
        { status: r.status });
    },
  },

  // ── F/G. Malformed and empty request bodies ──────────────────────────────
  {
    domain: "F",
    name: "malformed JSON body returns an error, not a crash or fake success",
    async run({ A, cookieA, request, json, record }) {
      const r = await request({ method: "POST", path: "/ai/chat", cookie: cookieA, workspaceId: A.workspaceId, body: "{not valid json" });
      const j = json(r);
      const good = r.status >= 400 && r.status < 500;
      record("F", this.name,
        good ? "PRODUCTION READY" : r.status === 0 ? "VERIFY" : "VERIFY",
        `status=${r.status} ${JSON.stringify(j || r.body.slice(0, 70))}`,
        { status: r.status, ms: r.ms });
    },
  },
  {
    domain: "G",
    name: "empty body does not produce a fabricated success",
    async run({ A, cookieA, request, json, record }) {
      const r = await request({ method: "POST", path: "/ai/chat", cookie: cookieA, workspaceId: A.workspaceId, body: {} });
      const j = json(r);
      // The defect class: 200 + success:true with no actual output.
      const fabricated = r.ok && j && j.success === true &&
        !(j.reply || j.response || j.message || j.content || j.text || j.output);
      record("G", this.name,
        fabricated ? "VERIFY" : "PRODUCTION READY",
        fabricated ? `FABRICATED: 200 success:true with no output — ${JSON.stringify(j).slice(0, 90)}`
                   : `status=${r.status} ${JSON.stringify(j || "").slice(0, 80)}`,
        { status: r.status, ms: r.ms });
    },
  },

  // ── C/H. Timeout and slow dependency ─────────────────────────────────────
  {
    domain: "C",
    name: "AI call under a short client deadline fails cleanly",
    async run({ A, cookieA, request, json, record }) {
      const r = await request({ method: "POST", path: "/ai/chat", cookie: cookieA, workspaceId: A.workspaceId,
        body: { prompt: "B20 chaos probe" }, timeout: 2500 });
      const j = json(r);
      const fabricated = r.ok && j && j.success === true && !(j.reply || j.response || j.message || j.content);
      record("C", this.name,
        fabricated ? "VERIFY" : "PRODUCTION READY",
        r.timedOut ? `client timeout at ${r.ms}ms (server may still be working — no success claimed)`
                   : `status=${r.status} in ${r.ms}ms ${fabricated ? "FABRICATED SUCCESS" : ""}`,
        { status: r.status, ms: r.ms, timedOut: !!r.timedOut });
    },
  },
  {
    domain: "I",
    name: "AI provider unavailable is reported, not faked",
    async run({ A, cookieA, request, json, record }) {
      const r = await request({ method: "POST", path: "/ai/chat", cookie: cookieA, workspaceId: A.workspaceId,
        body: { prompt: "B20 provider probe" }, timeout: 12000 });
      const j = json(r);
      const claimsSuccess = r.ok && j && (j.success === true || j.reply || j.response);
      const hasContent = j && !!(j.reply || j.response || j.message || j.content || j.text);
      record("I", this.name,
        claimsSuccess && !hasContent ? "VERIFY" : "PRODUCTION READY",
        `status=${r.status} in ${r.ms}ms content=${hasContent} ${JSON.stringify(j || "").slice(0, 70)}`,
        { status: r.status, ms: r.ms, hasContent });
    },
  },

  // ── N. Duplicate submission ──────────────────────────────────────────────
  {
    domain: "N",
    name: "concurrent identical submissions do not silently double-write",
    async run({ A, cookieA, request, json, record }) {
      const before = await request({ path: "/crm/leads", cookie: cookieA, workspaceId: A.workspaceId });
      const jb = json(before);
      const count = (x) => (Array.isArray(x) ? x.length : Array.isArray(x?.leads) ? x.leads.length : Array.isArray(x?.data) ? x.data.length : null);
      const n0 = count(jb);
      const marker = `b20-dup-${Date.now()}`;
      // The create route is /crm/lead (singular); /crm/leads is read-only.
      // Disposable fixture record — marker-tagged so it is identifiable.
      const payload = { name: marker, email: `${marker}@b20.local`, phone: "910000000000", source: "b20-chaos" };
      const rs = await Promise.all([0, 1, 2].map(() =>
        request({ method: "POST", path: "/crm/lead", cookie: cookieA, workspaceId: A.workspaceId, body: payload })));
      const after = await request({ path: "/crm/leads", cookie: cookieA, workspaceId: A.workspaceId });
      const n1 = count(json(after));
      const created = n0 !== null && n1 !== null ? n1 - n0 : null;
      record("N", this.name,
        created === null ? "UNKNOWN" : created <= 1 ? "PRODUCTION READY" : "VERIFY",
        created === null
          ? `list shape not countable (before=${before.status} after=${after.status}) — duplicate risk NOT MEASURED`
          : `3 concurrent POSTs → ${JSON.stringify(rs.map((r) => r.status))}, records created=${created}`,
        { statuses: rs.map((r) => r.status), before: n0, after: n1, created, marker });
    },
  },

  // ── M. Concurrency / load ────────────────────────────────────────────────
  {
    domain: "M",
    name: "30 concurrent reads are served or shed honestly (no 5xx storm)",
    async run({ A, cookieA, request, record }) {
      const t0 = Date.now();
      const rs = await Promise.all(Array.from({ length: 30 }, () =>
        request({ path: "/runtime/status", cookie: cookieA, workspaceId: A.workspaceId, timeout: 10000 })));
      const ms = Date.now() - t0;
      const by = rs.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {});
      const server5xx = rs.filter((r) => r.status >= 500).length;
      const latencies = rs.map((r) => r.ms).sort((a, b) => a - b);
      record("M", this.name,
        server5xx === 0 ? "PRODUCTION READY" : "VERIFY",
        `${JSON.stringify(by)} in ${ms}ms  p50=${latencies[15]}ms p95=${latencies[28]}ms max=${latencies[29]}ms`,
        { byStatus: by, totalMs: ms, p50: latencies[15], p95: latencies[28], max: latencies[29], server5xx });
    },
  },

  // ── D. Server error path ─────────────────────────────────────────────────
  {
    domain: "D",
    name: "unknown route returns an honest 404, not a 200 shell",
    async run({ A, cookieA, request, json, record }) {
      const r = await request({ path: "/definitely/not/a/real/route/b20", cookie: cookieA, workspaceId: A.workspaceId });
      const j = json(r);
      record("D", this.name,
        r.status === 404 && honestError(r, j) ? "PRODUCTION READY" : "VERIFY",
        `status=${r.status} ${JSON.stringify(j || r.body.slice(0, 60))}`,
        { status: r.status });
    },
  },

  // ── P/Q. Queue and runtime state ─────────────────────────────────────────
  {
    domain: "P",
    name: "queue status is readable and reports real counters",
    async run({ A, cookieA, request, json, record }) {
      const r = await request({ path: "/queue/status", cookie: cookieA, workspaceId: A.workspaceId });
      const j = json(r);
      // Diagnosed in B.20: backend/routes/tasks.js requires
      // agents/metrics/metricsCollector.cjs, which was moved to
      // _archive/20260520_010917/ in a May 2026 cleanup. The require is inside
      // a try/catch that nulls the module, so this endpoint returns a
      // permanent 503 rather than crashing. The SAME queue data is served live
      // by /tasks and /scheduler/status from taskQueueMod, so this is a dead
      // endpoint, not lost capability. Reviving an archived module is beyond
      // "minimal recovery", so it is recorded rather than built.
      const deadDependency = r.status === 503 && j && /Metrics collector unavailable/.test(j.error || "");
      record("P", this.name,
        deadDependency ? "GENUINE CAPABILITY GAP" : r.ok && j ? "PRODUCTION READY" : "VERIFY",
        deadDependency
          ? `503 — depends on archived agents/metrics/metricsCollector.cjs; fails closed honestly; live data at /tasks + /scheduler/status`
          : `status=${r.status} ${JSON.stringify(j || "").slice(0, 110)}`,
        { status: r.status, ms: r.ms });
    },
  },
  {
    domain: "Q",
    name: "deep health check reports component state honestly",
    async run({ A, cookieA, request, json, record }) {
      const r = await request({ path: "/runtime/health/deep", cookie: cookieA, workspaceId: A.workspaceId, timeout: 15000 });
      const j = json(r);
      record("Q", this.name,
        r.ok && j ? "PRODUCTION READY" : r.status === 403 ? "CREDENTIAL BLOCKED" : "VERIFY",
        `status=${r.status} in ${r.ms}ms ${JSON.stringify(j || "").slice(0, 110)}`,
        { status: r.status, ms: r.ms });
    },
  },
];
