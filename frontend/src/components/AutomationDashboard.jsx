import React, { useState, useEffect, useCallback } from "react";
import "./AutomationDashboard.css";

const BASE = process.env.REACT_APP_API_URL || "";

const DANGER_COLOR = { safe: "var(--success)", review: "var(--warning)", dangerous: "var(--danger)" };

function stat(label, value, sub) {
  return (
    <div className="ad-stat">
      <div className="ad-stat-value">{value}</div>
      <div className="ad-stat-label">{label}</div>
      {sub && <div className="ad-stat-sub">{sub}</div>}
    </div>
  );
}

export default function AutomationDashboard() {
  const [tab, setTab]       = useState("overview");
  const [data, setData]     = useState(null);
  const [queue, setQueue]   = useState([]);
  const [market, setMarket] = useState([]);
  const [bench, setBench]   = useState(null);
  const [flows, setFlows]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const [approvingId, setApprovingId] = useState(null);
  const [rejectingId, setRejectingId] = useState(null);

  async function fetchJson(path) {
    const r = await fetch(`${BASE}${path}`, { credentials: "include" });
    return r.json();
  }

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [d, q, m, f] = await Promise.all([
        fetchJson("/browser-platform/dashboard"),
        fetchJson("/browser-platform/hitl/queue"),
        fetchJson("/browser-platform/marketplace"),
        fetchJson("/browser-platform/memory/flows"),
      ]);
      if (d.ok) setData(d);
      if (q.ok) setQueue(q.queue || []);
      if (m.ok) setMarket(m.automations || []);
      if (f.ok) setFlows(f.flows || []);
    } catch { setError("Failed to load dashboard"); }
    finally { setLoading(false); }
  }, []);

  const loadBenchmark = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetchJson("/browser-platform/benchmark");
      if (r.ok) setBench(r);
    } catch { setError("Benchmark failed"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadOverview(); }, [loadOverview]);
  useEffect(() => { if (tab === "benchmark" && !bench) loadBenchmark(); }, [tab, bench, loadBenchmark]);

  const TABS = ["overview", "sessions", "hitl", "marketplace", "memory", "benchmark"];

  async function approve(id) {
    setApprovingId(id);
    try {
      const r = await fetch(`${BASE}/browser-platform/hitl/${id}/approve`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoRun: false }),
      });
      const d = await r.json();
      if (d.ok) loadOverview();
    } finally { setApprovingId(null); }
  }

  async function reject(id) {
    setRejectingId(id);
    try {
      const r = await fetch(`${BASE}/browser-platform/hitl/${id}/reject`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "operator_rejected" }),
      });
      const d = await r.json();
      if (d.ok) loadOverview();
    } finally { setRejectingId(null); }
  }

  return (
    <div className="ad-root">
      <div className="ad-header">
        <h2 className="ad-title">Browser Automation</h2>
        <button className="ad-refresh" onClick={loadOverview} disabled={loading}>
          {loading ? "..." : "Refresh"}
        </button>
      </div>

      <div className="ad-tabs">
        {TABS.map(t => (
          <button key={t} className={`ad-tab${tab === t ? " active" : ""}`} onClick={() => setTab(t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {error && <div className="ad-error">{error}</div>}

      {/* ── OVERVIEW ── */}
      {tab === "overview" && data && (
        <div className="ad-panel">
          <div className="ad-stats-row">
            {stat("Open Tabs",      data.tabs,                "active pages")}
            {stat("Sessions",       data.sessions?.profileCount || 0, "profiles")}
            {stat("Completed",      data.history?.completed || 0,     "runs")}
            {stat("Failed",         data.history?.failed    || 0,     "runs")}
            {stat("HITL Pending",   data.hitl?.pending      || 0,     "approvals")}
            {stat("Memory Flows",   data.memory?.flowKeys   || 0,     "known flows")}
            {stat("Marketplace",    data.marketplace?.total || 0,     "automations")}
          </div>

          {data.history?.recent?.length > 0 && (
            <div className="ad-section">
              <div className="ad-section-title">Recent Runs</div>
              <table className="ad-table">
                <thead><tr><th>Name</th><th>Status</th><th>Time</th></tr></thead>
                <tbody>
                  {data.history.recent.map((h, i) => (
                    <tr key={i}>
                      <td>{h.name || "—"}</td>
                      <td>
                        <span className={`ad-badge ${h.ok ? "success" : "danger"}`}>
                          {h.ok ? "OK" : "FAIL"}
                        </span>
                      </td>
                      <td>{h.recordedAtISO ? new Date(h.recordedAtISO).toLocaleTimeString() : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── SESSIONS ── */}
      {tab === "sessions" && (
        <SessionsPanel fetchJson={fetchJson} />
      )}

      {/* ── HITL ── */}
      {tab === "hitl" && (
        <div className="ad-panel">
          <div className="ad-section-title">Approval Queue ({queue.length} pending)</div>
          {queue.length === 0 ? (
            <div className="ad-empty">No pending approvals</div>
          ) : (
            <div className="ad-hitl-list">
              {queue.map(req => (
                <div key={req.id} className="ad-hitl-card">
                  <div className="ad-hitl-intent">{req.intent}</div>
                  <div className="ad-hitl-meta">
                    <span className="ad-badge" style={{ background: DANGER_COLOR[req.dangerLevel] }}>
                      {req.dangerLevel}
                    </span>
                    <span className="ad-hitl-reason">{req.dangerReason}</span>
                    <span className="ad-hitl-time">{new Date(req.ts).toLocaleTimeString()}</span>
                  </div>
                  <div className="ad-hitl-steps">
                    {(req.steps || []).slice(0, 3).map((s, i) => (
                      <span key={i} className="ad-hitl-step">{s.action}{s.label ? ` — ${s.label}` : ""}</span>
                    ))}
                    {(req.steps || []).length > 3 && <span className="ad-hitl-step">+{req.steps.length - 3} more</span>}
                  </div>
                  <div className="ad-hitl-actions">
                    <button
                      className="ad-btn-approve"
                      onClick={() => approve(req.id)}
                      disabled={approvingId === req.id}
                    >
                      {approvingId === req.id ? "..." : "Approve"}
                    </button>
                    <button
                      className="ad-btn-reject"
                      onClick={() => reject(req.id)}
                      disabled={rejectingId === req.id}
                    >
                      {rejectingId === req.id ? "..." : "Reject"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── MARKETPLACE ── */}
      {tab === "marketplace" && (
        <div className="ad-panel">
          <div className="ad-market-grid">
            {market.map(a => (
              <div key={a.id} className="ad-market-card">
                <div className="ad-market-platform">{a.platform}</div>
                <div className="ad-market-name">{a.name}</div>
                <div className="ad-market-desc">{a.description}</div>
                <div className="ad-market-meta">
                  <span className="ad-badge" style={{ background: DANGER_COLOR[a.dangerLevel] }}>
                    {a.dangerLevel}
                  </span>
                  <span className="ad-market-installs">{a.installs} installs</span>
                  <span className="ad-market-rating">★ {a.rating}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── MEMORY ── */}
      {tab === "memory" && (
        <div className="ad-panel">
          <div className="ad-section-title">Remembered Flows ({flows.length})</div>
          {flows.length === 0 ? (
            <div className="ad-empty">No flows remembered yet. Run some automations first.</div>
          ) : (
            <table className="ad-table">
              <thead><tr><th>Flow Key</th><th>Successes</th><th>Failures</th><th>Last Run</th></tr></thead>
              <tbody>
                {flows.map((f, i) => (
                  <tr key={i}>
                    <td className="ad-mono">{f.key}</td>
                    <td><span className="ad-badge success">{f.successCount}</span></td>
                    <td><span className="ad-badge danger">{f.failCount}</span></td>
                    <td>{f.lastRun ? new Date(f.lastRun).toLocaleDateString() : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── BENCHMARK ── */}
      {tab === "benchmark" && (
        <div className="ad-panel">
          {!bench ? (
            <div className="ad-bench-loading">
              <button className="ad-run-bench" onClick={loadBenchmark} disabled={loading}>
                {loading ? "Running benchmark…" : "Run Commercial Benchmark"}
              </button>
            </div>
          ) : (
            <BenchmarkPanel bench={bench} onRun={loadBenchmark} loading={loading} />
          )}
        </div>
      )}
    </div>
  );
}

function SessionsPanel({ fetchJson }) {
  const [profiles, setProfiles] = useState([]);
  const [tabs,     setTabs]     = useState([]);
  const [loaded,   setLoaded]   = useState(false);

  useEffect(() => {
    Promise.all([
      fetchJson("/browser-platform/sessions"),
      fetchJson("/browser-platform/control/tabs"),
    ]).then(([p, t]) => {
      if (p.ok) setProfiles(p.profiles || []);
      if (t.ok) setTabs(t.tabs || []);
      setLoaded(true);
    });
  }, [fetchJson]);

  if (!loaded) return <div className="ad-panel"><div className="ad-empty">Loading…</div></div>;

  return (
    <div className="ad-panel">
      <div className="ad-section-title">Browser Sessions ({profiles.length} profiles)</div>
      {profiles.length === 0 ? (
        <div className="ad-empty">No profiles created yet.</div>
      ) : (
        <table className="ad-table">
          <thead><tr><th>Name</th><th>Type</th><th>Pages</th><th>Created</th></tr></thead>
          <tbody>
            {profiles.map(p => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td><span className="ad-badge">{p.type}</span></td>
                <td>{(p.pageIds || []).length}</td>
                <td>{new Date(p.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="ad-section-title" style={{ marginTop: 24 }}>Open Tabs ({tabs.length})</div>
      {tabs.length === 0 ? (
        <div className="ad-empty">No open tabs.</div>
      ) : (
        <table className="ad-table">
          <thead><tr><th>Page ID</th><th>URL</th></tr></thead>
          <tbody>
            {tabs.map((t, i) => (
              <tr key={i}>
                <td className="ad-mono">{t.id}</td>
                <td>{t.url || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function BenchmarkPanel({ bench, onRun, loading }) {
  const color = s => s >= 80 ? "var(--success)" : s >= 60 ? "var(--warning)" : "var(--danger)";
  const readinessLabel = { ready: "Commercial Ready", developing: "Developing", pre_commercial: "Pre-Commercial" };

  return (
    <div className="ad-bench">
      <div className="ad-bench-header">
        <div>
          <div className="ad-bench-score" style={{ color: color(bench.overallScore) }}>
            {bench.overallScore}%
          </div>
          <div className="ad-bench-readiness">
            {readinessLabel[bench.commercialReadiness] || bench.commercialReadiness}
          </div>
          <div className="ad-bench-sub">
            {bench.platformsReady}/{bench.totalPlatforms} platforms ready
            &nbsp;·&nbsp;
            Regression: <strong style={{ color: bench.regressionPass ? "var(--success)" : "var(--danger)" }}>
              {bench.regressionPass ? "PASS" : "FAIL"}
            </strong>
          </div>
        </div>
        <button className="ad-run-bench" onClick={onRun} disabled={loading}>
          {loading ? "Running…" : "Re-run"}
        </button>
      </div>

      <div className="ad-bench-grid">
        {(bench.results || []).map(r => (
          <div key={r.platform} className="ad-bench-card">
            <div className="ad-bench-platform">{r.name}</div>
            <div className="ad-bench-platform-score" style={{ color: color(r.score) }}>
              {r.score}%
            </div>
            <div className="ad-bench-checks">
              {(r.checks || []).map((c, i) => (
                <div key={i} className="ad-bench-check">
                  <span className={`ad-bench-dot ${c.ok ? "ok" : "fail"}`} />
                  <span>{c.check.replace(/_/g, " ")}</span>
                </div>
              ))}
            </div>
            <div className={`ad-bench-ready-badge ${r.ready ? "ok" : "fail"}`}>
              {r.ready ? "Ready" : "Not ready"}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
