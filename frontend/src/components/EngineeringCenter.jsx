import React, { useState, useEffect, useCallback } from "react";
import { track } from "../analytics";
import { getRuntimeHistory, getRuntimeStatus, listPatches, getDLQ, recoverDLQ } from "../runtimeApi";
import { BASE_URL } from "../_client";

// ── Shared fetch ──────────────────────────────────────────────────────

async function _get(path) {
  const r = await fetch(`${BASE_URL}${path}`, { credentials: "include" });
  return r.json();
}
async function _post(path, body = {}) {
  const r = await fetch(`${BASE_URL}${path}`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}

// ── Helpers ───────────────────────────────────────────────────────────

function _ago(iso) {
  if (!iso) return "—";
  try {
    const s = Math.floor((Date.now() - new Date(iso)) / 1000);
    if (s < 60)    return `${s}s ago`;
    if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  } catch { return "—"; }
}

function _ms(n) {
  if (!n) return "—";
  if (n < 1000) return `${n}ms`;
  return `${(n / 1000).toFixed(1)}s`;
}

const SC = {
  ok: "#52d68a", success: "#52d68a", applied: "#52d68a", resolved: "#52d68a", healthy: "#52d68a",
  warn: "#f0b429", warning: "#f0b429", pending: "#f0b429", degraded: "#f0b429",
  fail: "#f55b5b", failed: "#f55b5b", error: "#f55b5b", critical: "#f55b5b", rolled_back: "#f55b5b",
  running: "#7c6fff", executing: "#7c6fff", active: "#52d68a",
  unknown: "#8994b0",
};
function statusColor(s) { return SC[s] || "#8994b0"; }

function Badge({ s, label }) {
  const col = statusColor(s);
  return (
    <span style={{ fontSize: 9, fontWeight: 600, padding: "1px 6px", borderRadius: 3,
      color: col, background: col + "18", border: `1px solid ${col}30` }}>
      {label || s}
    </span>
  );
}

function EmptyState({ icon = "◌", title, sub }) {
  return (
    <div style={{ textAlign: "center", padding: "40px 20px", color: "#8994b0" }}>
      <div style={{ fontSize: 28, marginBottom: 8 }}>{icon}</div>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, color: "#c8cdd8" }}>{title}</div>
      {sub && <div style={{ fontSize: 11 }}>{sub}</div>}
    </div>
  );
}

function Skel({ w = "100%", h = 12 }) {
  return (
    <span style={{
      display: "block", width: w, height: h, borderRadius: 3,
      background: "rgba(255,255,255,0.06)",
      animation: "ec-pulse 1.4s ease-in-out infinite"
    }} />
  );
}

function Row({ children, style, onClick }) {
  return (
    <div onClick={onClick} style={{
      display: "flex", gap: 8, alignItems: "center",
      padding: "7px 10px", borderBottom: "1px solid rgba(255,255,255,0.05)",
      cursor: onClick ? "pointer" : undefined, ...style
    }}>
      {children}
    </div>
  );
}

function Section({ title, children, action }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "#8994b0" }}>{title}</span>
        {action}
      </div>
      <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 6, overflow: "hidden" }}>
        {children}
      </div>
    </div>
  );
}

function RefreshBtn({ onClick, loading }) {
  return (
    <button onClick={onClick} disabled={loading}
      style={{ fontSize: 9, padding: "2px 8px", background: "none", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 3, cursor: "pointer", color: "#8994b0" }}>
      {loading ? "…" : "⟳"}
    </button>
  );
}

function StatCard({ label, val, color }) {
  return (
    <div style={{ flex: "1 1 80px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 6, padding: "8px 12px", textAlign: "center" }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: color || "#c8cdd8" }}>{val}</div>
      <div style={{ fontSize: 9, color: "#8994b0", marginTop: 2 }}>{label}</div>
    </div>
  );
}

// ── B3.1 Engineering Memory Explorer ─────────────────────────────────

function TabMemory() {
  const [goal, setGoal]         = useState("");
  const [entries, setEntries]   = useState([]);
  const [sugg, setSugg]         = useState([]);
  const [stats, setStats]       = useState(null);
  const [loading, setLoading]   = useState(false);
  const [execHist, setExecHist] = useState([]);
  const [histLoad, setHistLoad] = useState(true);

  useEffect(() => {
    getRuntimeHistory(20).then(r => {
      setExecHist(Array.isArray(r) ? r : (r?.entries || r?.history || []));
    }).catch(() => {}).finally(() => setHistLoad(false));
    _get("/runtime/memory/engineering").then(r => {
      if (r?.success) { setEntries(r.entries || []); setStats(r.stats); }
    }).catch(() => {});
  }, []);

  async function handleSearch() {
    if (!goal.trim() || loading) return;
    setLoading(true);
    try {
      const r = await _get(`/runtime/memory/engineering?goal=${encodeURIComponent(goal)}&limit=15`);
      if (r?.success) { setEntries(r.entries || []); setSugg(r.suggestions || []); setStats(r.stats); }
    } catch {} finally { setLoading(false); }
    track("eng_memory_search");
  }

  return (
    <div>
      {stats && (
        <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          <StatCard label="Total entries" val={stats.total ?? "—"} />
          <StatCard label="Successful" val={stats.succeeded ?? "—"} color="#52d68a" />
          <StatCard label="Failed" val={stats.failed ?? "—"} color={stats.failed > 0 ? "#f55b5b" : "#8994b0"} />
          <StatCard label="Agents" val={stats.uniqueAgents ?? "—"} />
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input
          value={goal}
          onChange={e => setGoal(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleSearch()}
          placeholder="Search memory by goal or task description…"
          style={{ flex: 1, padding: "7px 10px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 5, color: "#c8cdd8", fontSize: 12, fontFamily: "inherit" }}
        />
        <button onClick={handleSearch} disabled={!goal.trim() || loading}
          style={{ padding: "7px 16px", background: "rgba(68,162,255,0.15)", border: "1px solid rgba(68,162,255,0.3)", borderRadius: 5, color: "#44a2ff", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
          {loading ? "…" : "Search"}
        </button>
      </div>

      {sugg.length > 0 && (
        <Section title="Suggested chains">
          {sugg.slice(0, 4).map((s, i) => (
            <Row key={i}>
              <span style={{ fontSize: 10, color: "#44a2ff" }}>→</span>
              <span style={{ fontSize: 11, color: "#c8cdd8", flex: 1 }}>{typeof s === "string" ? s : (s.chain || JSON.stringify(s))}</span>
            </Row>
          ))}
        </Section>
      )}

      <Section title={`Memory entries${entries.length ? ` (${entries.length})` : ""}`}>
        {entries.length === 0
          ? <EmptyState title="No memory entries yet" sub="Run engineering tasks to build memory context" />
          : entries.map((e, i) => (
            <Row key={i}>
              <Badge s={e.success !== false ? "ok" : "fail"} label={e.success !== false ? "ok" : "fail"} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, color: "#c8cdd8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {e.input || e.goal || e.description || "(no description)"}
                </div>
                <div style={{ fontSize: 9, color: "#8994b0", marginTop: 1 }}>
                  {e.agentId || e.agent || "—"} · {_ago(e.ts)} · {_ms(e.durationMs)}
                </div>
              </div>
              {e.error && (
                <span style={{ fontSize: 9, color: "#f55b5b", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={e.error}>
                  {e.error.slice(0, 40)}
                </span>
              )}
            </Row>
          ))
        }
      </Section>

      <Section title="Recent executions (live)">
        {histLoad
          ? [0, 1, 2, 3].map(i => <Row key={i}><Skel w="100%" /></Row>)
          : execHist.length === 0
            ? <EmptyState title="No executions yet" />
            : execHist.slice(0, 12).map((e, i) => (
              <Row key={i}>
                <Badge s={e.success !== false ? "ok" : "fail"} label={e.success !== false ? "ok" : "fail"} />
                <span style={{ fontSize: 10, color: "#8994b0", width: 60, flexShrink: 0 }}>{e.agentId || "—"}</span>
                <span style={{ fontSize: 11, color: "#c8cdd8", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {e.input || e.description || "(unknown)"}
                </span>
                <span style={{ fontSize: 9, color: "#8994b0", flexShrink: 0 }}>{_ago(e.ts)}</span>
                <span style={{ fontSize: 9, color: "#8994b0", flexShrink: 0, minWidth: 36, textAlign: "right" }}>{_ms(e.durationMs)}</span>
              </Row>
            ))
        }
      </Section>
    </div>
  );
}

// ── B3.2 Execution History Center ─────────────────────────────────────

function TabHistory() {
  const [entries, setEntries]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [filter, setFilter]     = useState("all");
  const [search, setSearch]     = useState("");
  const [expanded, setExpanded] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await getRuntimeHistory(80);
      setEntries(Array.isArray(r) ? r : (r?.entries || r?.history || []));
    } catch { setEntries([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const FILTERS = ["all", "success", "failed", "patched", "deployed"];

  const visible = entries.filter(e => {
    if (filter === "success" && !e.success) return false;
    if (filter === "failed"  && e.success !== false) return false;
    if (filter === "patched" && !/(patch|fix|modify|edit)/i.test(e.input || "")) return false;
    if (filter === "deployed" && !/(deploy|pm2|restart)/i.test((e.input || "") + (e.output || ""))) return false;
    if (search && !(e.input || "").toLowerCase().includes(search.toLowerCase()) &&
                  !(e.agentId || "").toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
        {FILTERS.map(f => (
          <button key={f} onClick={() => setFilter(f)}
            style={{
              padding: "3px 10px", fontSize: 10, borderRadius: 3, cursor: "pointer",
              background: filter === f ? "rgba(68,162,255,0.15)" : "rgba(255,255,255,0.04)",
              border: `1px solid ${filter === f ? "rgba(68,162,255,0.35)" : "rgba(255,255,255,0.09)"}`,
              color: filter === f ? "#44a2ff" : "#8994b0", fontWeight: filter === f ? 600 : 400
            }}>
            {f}
          </button>
        ))}
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search tasks…"
          style={{ flex: 1, minWidth: 120, padding: "3px 8px", fontSize: 10, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 3, color: "#c8cdd8", fontFamily: "inherit" }} />
        <RefreshBtn onClick={load} loading={loading} />
        <span style={{ fontSize: 9, color: "#8994b0" }}>{visible.length} / {entries.length}</span>
      </div>

      <Section title="Execution timeline">
        {loading
          ? [0, 1, 2, 3, 4].map(i => <Row key={i}><Skel w="100%" /></Row>)
          : visible.length === 0
            ? <EmptyState title="No entries in this view" />
            : visible.map((e, i) => {
              const isOpen = expanded === i;
              return (
                <div key={i}>
                  <Row onClick={() => setExpanded(isOpen ? null : i)}>
                    <Badge s={e.success !== false ? "ok" : "fail"} label={e.success !== false ? "ok" : "fail"} />
                    <span style={{ fontSize: 9, color: "#8994b0", width: 64, flexShrink: 0, fontFamily: "monospace" }}>{e.agentId?.slice(0, 8) || "—"}</span>
                    <span style={{ fontSize: 11, color: "#c8cdd8", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {e.input || e.description || "(unknown)"}
                    </span>
                    <span style={{ fontSize: 9, color: "#8994b0", flexShrink: 0 }}>{_ms(e.durationMs)}</span>
                    <span style={{ fontSize: 9, color: "#8994b0", flexShrink: 0, marginLeft: 4 }}>{_ago(e.ts)}</span>
                    <span style={{ fontSize: 9, color: "#8994b0", marginLeft: 4 }}>{isOpen ? "▲" : "▼"}</span>
                  </Row>
                  {isOpen && (
                    <div style={{ padding: "8px 10px", background: "rgba(0,0,0,0.15)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                      {e.output && <div style={{ fontSize: 10, color: "#8994b0", marginBottom: 4 }}><strong style={{ color: "#c8cdd8" }}>Output:</strong> {e.output}</div>}
                      {e.error  && <div style={{ fontSize: 10, color: "#f55b5b" }}><strong>Error:</strong> {e.error}</div>}
                      <div style={{ fontSize: 9, color: "#8994b0", marginTop: 4, display: "flex", gap: 16 }}>
                        <span>Task: {e.taskId || e.taskType || "—"}</span>
                        <span>Duration: {_ms(e.durationMs)}</span>
                        <span>Agent: {e.agentId || "—"}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
        }
      </Section>
    </div>
  );
}

// ── B3.3 Deployment Verification Center ──────────────────────────────

function TabDeploy() {
  const [timeline, setTimeline] = useState([]);
  const [surv, setSurv]         = useState(null);
  const [chains, setChains]     = useState(null);
  const [loading, setLoading]   = useState(true);
  const [snap, setSnap]         = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, t, ch, s] = await Promise.all([
        _get("/runtime/deploy-center").catch(() => null),
        _get("/runtime/deploy-center/timeline?limit=15").catch(() => null),
        _get("/runtime/deploy-center/recovery-chains").catch(() => null),
        _get("/runtime/deployment-survivability/report").catch(() => null),
      ]);
      if (c) setSnap(c.snapshot || c);
      if (t) setTimeline(t.deployments || t.entries || []);
      if (ch?.success) setChains(ch);
      if (s?.success)  setSurv(s);
    } catch {} finally { setLoading(false); }
    track("eng_deploy_center");
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      {surv && (
        <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
          <StatCard label="Health" val={(surv.healthScore ?? surv.score ?? "—") + (surv.healthScore != null ? "%" : "")} color="#52d68a" />
          <StatCard label="Deployments" val={surv.totalDeployments ?? "—"} />
          <StatCard label="Rollbacks" val={surv.totalRollbacks ?? "—"} color={surv.totalRollbacks > 0 ? "#f0b429" : "#8994b0"} />
          <StatCard label="MTTR" val={surv.mttr ? _ms(surv.mttr) : "—"} />
        </div>
      )}

      <Section title="Deployment history" action={<RefreshBtn onClick={load} loading={loading} />}>
        {loading
          ? [0, 1, 2, 3].map(i => <Row key={i}><Skel w="100%" /></Row>)
          : timeline.length === 0
            ? <EmptyState title="No deployments yet" sub="Run a pipeline with autoDeploy=true to record deployments" />
            : timeline.map((d, i) => (
              <Row key={i}>
                <Badge s={d.status || d.state || "unknown"} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: "#c8cdd8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {d.name || d.pipeline || d.request || d.id?.slice(0, 20) || "deployment"}
                  </div>
                  <div style={{ fontSize: 9, color: "#8994b0", marginTop: 1 }}>{_ago(d.startedAt || d.ts)} · {d.environment || d.env || "—"}</div>
                </div>
                {d.rolledBack      && <Badge s="rolled_back" label="rolled back" />}
                {d.healthOk === false && <Badge s="fail" label="health fail" />}
                {d.healthOk === true  && <Badge s="ok"   label="verified" />}
              </Row>
            ))
        }
      </Section>

      {chains && (chains.chains || chains.active || []).length > 0 && (
        <Section title="Recovery chains">
          {(chains.chains || chains.active || []).map((ch, i) => (
            <Row key={i}>
              <Badge s={ch.status || "unknown"} />
              <span style={{ fontSize: 11, color: "#c8cdd8", flex: 1 }}>{ch.name || ch.id || "chain"}</span>
              <span style={{ fontSize: 9, color: "#8994b0" }}>{ch.steps || 0} steps</span>
            </Row>
          ))}
        </Section>
      )}

      {snap && Object.keys(snap).length > 1 && (
        <Section title="Deploy center snapshot">
          <div style={{ padding: "8px 10px" }}>
            <pre style={{ fontSize: 9, color: "#8994b0", whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 160, overflow: "auto", margin: 0 }}>
              {JSON.stringify(snap, null, 2).slice(0, 1000)}
            </pre>
          </div>
        </Section>
      )}
    </div>
  );
}

// ── B3.4 Test Results Dashboard ───────────────────────────────────────

function TabTests() {
  const [patches, setPatches]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [running, setRunning]   = useState(null);
  const [testOut, setTestOut]   = useState({});
  const [filter, setFilter]     = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await listPatches();
      setPatches(r?.patches || []);
    } catch { setPatches([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); track("eng_tests"); }, [load]);

  async function handleVerify(p) {
    if (running) return;
    setRunning(p.id);
    try {
      const r = await fetch(`${BASE_URL}/runtime/patches/${p.id}/verify`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoRollback: false }),
      }).then(x => x.json());
      setTestOut(prev => ({ ...prev, [p.id]: r }));
    } catch (e) {
      setTestOut(prev => ({ ...prev, [p.id]: { error: e.message } }));
    } finally { setRunning(null); }
  }

  const totPass = Object.values(testOut).reduce((s, r) => s + (r.pass || 0), 0);
  const totFail = Object.values(testOut).reduce((s, r) => s + (r.fail || 0), 0);
  const hasTests = Object.keys(testOut).length > 0;

  const visible = (
    filter === "tested"   ? patches.filter(p =>  testOut[p.id])
    : filter === "passed"   ? patches.filter(p =>  testOut[p.id]?.fail === 0 && testOut[p.id]?.pass > 0)
    : filter === "failed"   ? patches.filter(p =>  testOut[p.id]?.fail > 0)
    : filter === "untested" ? patches.filter(p => !testOut[p.id])
    : patches
  );

  return (
    <div>
      {hasTests && (
        <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
          <StatCard label="Tested patches" val={Object.keys(testOut).length} />
          <StatCard label="Total passed" val={totPass} color="#52d68a" />
          <StatCard label="Total failed" val={totFail} color={totFail > 0 ? "#f55b5b" : "#8994b0"} />
        </div>
      )}

      <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
        {["all", "untested", "tested", "passed", "failed"].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            style={{
              padding: "3px 10px", fontSize: 10, borderRadius: 3, cursor: "pointer",
              background: filter === f ? "rgba(68,162,255,0.15)" : "rgba(255,255,255,0.04)",
              border: `1px solid ${filter === f ? "rgba(68,162,255,0.35)" : "rgba(255,255,255,0.09)"}`,
              color: filter === f ? "#44a2ff" : "#8994b0"
            }}>
            {f}
          </button>
        ))}
        <RefreshBtn onClick={load} loading={loading} />
      </div>

      <Section title="Patches + test results">
        {loading
          ? [0, 1, 2].map(i => <Row key={i}><Skel w="100%" /></Row>)
          : visible.length === 0
            ? <EmptyState title="No patches in this view" sub={filter === "untested" ? "All patches tested" : "Ask JARVIS to fix a file to create patches"} />
            : visible.map(p => {
              const out = testOut[p.id];
              const col = out ? (out.fail > 0 ? "#f55b5b" : "#52d68a") : "#8994b0";
              return (
                <div key={p.id}>
                  <Row>
                    <Badge s={p.status || "pending"} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, color: "#c8cdd8", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {p.filePath || p.id?.slice(0, 20)}
                      </div>
                      <div style={{ fontSize: 9, color: "#8994b0", marginTop: 1 }}>
                        +{p.diff?.linesAdded || 0} / −{p.diff?.linesRemoved || 0} · {_ago(p.proposedAt)}
                      </div>
                    </div>
                    {out
                      ? <span style={{ fontSize: 10, fontWeight: 600, color: col }}>{out.fail > 0 ? `✗ ${out.fail} fail` : `✓ ${out.pass} pass`}</span>
                      : <button disabled={running === p.id} onClick={() => handleVerify(p)}
                          style={{ fontSize: 9, padding: "2px 8px", background: "rgba(68,162,255,0.1)", border: "1px solid rgba(68,162,255,0.25)", borderRadius: 3, cursor: "pointer", color: "#44a2ff" }}>
                          {running === p.id ? "Running…" : "Run Tests"}
                        </button>
                    }
                  </Row>
                  {out && (
                    <div style={{ padding: "6px 10px", background: "rgba(0,0,0,0.12)", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                      <div style={{ fontSize: 9, fontWeight: 600, color: col, marginBottom: 4 }}>
                        {out.pass ?? 0} pass · {out.fail ?? 0} fail
                        {out.rolledBack && <span style={{ marginLeft: 8, color: "#f0b429" }}>auto-rolled back</span>}
                        {out.error && <span style={{ marginLeft: 8, color: "#f55b5b" }}>{out.error}</span>}
                      </div>
                      {out.output && (
                        <pre style={{ fontSize: 8, color: "#8994b0", whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 100, overflowY: "auto", margin: 0, fontFamily: "monospace" }}>
                          {out.output.slice(0, 800)}{out.output.length > 800 ? "\n…" : ""}
                        </pre>
                      )}
                      <button onClick={() => handleVerify(p)} disabled={running === p.id}
                        style={{ marginTop: 5, fontSize: 9, padding: "2px 8px", background: "none", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 3, cursor: "pointer", color: "#8994b0" }}>
                        {running === p.id ? "…" : "Re-run"}
                      </button>
                    </div>
                  )}
                </div>
              );
            })
        }
      </Section>
    </div>
  );
}

// ── B3.5 Self-Healing Dashboard ───────────────────────────────────────

function TabHealing() {
  const [incidents, setIncidents] = useState([]);
  const [summary, setSummary]     = useState(null);
  const [runs, setRuns]           = useState([]);
  const [history, setHistory]     = useState([]);
  const [plans, setPlans]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [expanded, setExpanded]   = useState(null);
  const [acking, setAcking]       = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [inc, runs_, hist, plns] = await Promise.all([
        _get("/runtime/incidents?limit=20").catch(() => null),
        _get("/runtime/healing/runs?limit=15").catch(() => null),
        _get("/runtime/healing/history?limit=40").catch(() => null),
        _get("/runtime/autofix/plans?limit=15").catch(() => null),
      ]);
      if (inc?.success)  { setIncidents(inc.incidents || []); setSummary(inc.summary || null); }
      if (runs_?.success)  setRuns(runs_.runs || []);
      if (hist?.success)   setHistory(hist.history || []);
      if (plns?.success)   setPlans(plns.plans || []);
    } catch {} finally { setLoading(false); }
    track("eng_healing");
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleAck(id) {
    setAcking(id);
    try { await _post(`/runtime/incidents/${id}/acknowledge`); await load(); }
    catch {} finally { setAcking(null); }
  }

  return (
    <div>
      {summary && (
        <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
          <StatCard label="Open critical" val={summary.openCritical ?? 0} color={summary.openCritical > 0 ? "#f55b5b" : "#52d68a"} />
          <StatCard label="Open high"    val={summary.openHigh     ?? 0} color={summary.openHigh > 0 ? "#f0b429" : "#8994b0"} />
          <StatCard label="Heal runs"    val={runs.length} />
          <StatCard label="History"      val={history.length} />
        </div>
      )}

      <Section title="Active incidents" action={<RefreshBtn onClick={load} loading={loading} />}>
        {loading
          ? [0, 1, 2].map(i => <Row key={i}><Skel w="100%" /></Row>)
          : incidents.length === 0
            ? <EmptyState icon="✓" title="No incidents" sub="System is clean" />
            : incidents.map(inc => {
              const isOpen = expanded === inc.id;
              return (
                <div key={inc.id}>
                  <Row onClick={() => setExpanded(isOpen ? null : inc.id)}>
                    <Badge s={inc.severity || "unknown"} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, color: "#c8cdd8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {inc.title || inc.message || inc.type || inc.id}
                      </div>
                      <div style={{ fontSize: 9, color: "#8994b0", marginTop: 1 }}>{inc.service || inc.component || "—"} · {_ago(inc.detectedAt || inc.ts)}</div>
                    </div>
                    <Badge s={inc.status || "open"} />
                    <span style={{ fontSize: 9, color: "#8994b0" }}>{isOpen ? "▲" : "▼"}</span>
                  </Row>
                  {isOpen && (
                    <div style={{ padding: "8px 10px", background: "rgba(0,0,0,0.12)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                      {inc.description && <p style={{ fontSize: 10, color: "#8994b0", marginBottom: 6, marginTop: 0 }}>{inc.description}</p>}
                      {inc.rca && (
                        <div style={{ fontSize: 10, color: "#c8cdd8", marginBottom: 6 }}>
                          <strong>RCA:</strong> {typeof inc.rca === "string" ? inc.rca : JSON.stringify(inc.rca)}
                        </div>
                      )}
                      {inc.autoFixPlanId && <div style={{ fontSize: 9, color: "#44a2ff", marginBottom: 4 }}>Auto-fix plan: {inc.autoFixPlanId}</div>}
                      {(inc.status === "open" || inc.status === "detected") && (
                        <button onClick={e => { e.stopPropagation(); handleAck(inc.id); }} disabled={acking === inc.id}
                          style={{ fontSize: 9, padding: "2px 8px", background: "rgba(68,162,255,0.1)", border: "1px solid rgba(68,162,255,0.25)", borderRadius: 3, cursor: "pointer", color: "#44a2ff" }}>
                          {acking === inc.id ? "…" : "Acknowledge"}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })
        }
      </Section>

      {runs.length > 0 && (
        <Section title="Healing pipeline runs">
          {runs.map((r, i) => (
            <Row key={i}>
              <Badge s={r.status || "unknown"} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, color: "#c8cdd8" }}>{r.planId || r.id?.slice(0, 20) || "run"}</div>
                <div style={{ fontSize: 9, color: "#8994b0", marginTop: 1 }}>{r.mode || "approval_required"} · {_ago(r.startedAt || r.ts)}</div>
              </div>
              {r.rolledBack && <Badge s="rolled_back" label="rolled back" />}
            </Row>
          ))}
        </Section>
      )}

      <Section title={`Healing history (${history.length})`}>
        {loading
          ? [0, 1, 2].map(i => <Row key={i}><Skel w="100%" /></Row>)
          : history.length === 0
            ? <EmptyState title="No healing history yet" />
            : history.slice(0, 20).map((h, i) => (
              <Row key={i}>
                <Badge s={h.success !== false ? "ok" : "fail"} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: "#c8cdd8" }}>{h.strategy || h.action || h.recId || "heal"}</div>
                  <div style={{ fontSize: 9, color: "#8994b0", marginTop: 1 }}>
                    {h.targetType || "—"} · attempt {h.attempt || 1} · {_ago(h.ts)}
                  </div>
                </div>
              </Row>
            ))
        }
      </Section>

      {plans.length > 0 && (
        <Section title="Auto-fix plans">
          {plans.map((p, i) => (
            <Row key={i}>
              <Badge s={p.status || "pending"} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, color: "#c8cdd8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.title || p.description || p.id || "plan"}
                </div>
                <div style={{ fontSize: 9, color: "#8994b0", marginTop: 1 }}>{p.steps?.length || 0} steps · risk: {p.risk || "—"} · {_ago(p.createdAt)}</div>
              </div>
              <Badge s={p.risk || "unknown"} label={`risk: ${p.risk || "?"}`} />
            </Row>
          ))}
        </Section>
      )}
    </div>
  );
}

// ── B3.6 Runtime Observability ────────────────────────────────────────

function TabObservability() {
  const [status, setStatus]       = useState(null);
  const [dlq, setDlq]             = useState(null);
  const [pendingPatches, setPending] = useState([]);
  const [health, setHealth]       = useState(null);
  const [failIntel, setFailIntel] = useState(null);
  const [loading, setLoading]     = useState(true);
  const [recovering, setRecovering] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, d, p, h, fi] = await Promise.all([
        getRuntimeStatus().catch(() => null),
        getDLQ(10).catch(() => null),
        listPatches("pending").catch(() => null),
        _get("/runtime/health/deep").catch(() => null),
        _get("/runtime/failure-intel/report").catch(() => null),
      ]);
      setStatus(s);
      setDlq(d);
      setPending(p?.patches || []);
      setHealth(h);
      setFailIntel(fi);
    } catch {} finally { setLoading(false); }
    track("eng_observability");
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  async function handleRecoverDLQ() {
    setRecovering(true);
    try { await recoverDLQ(); await load(); }
    catch {} finally { setRecovering(false); }
  }

  const runtimeOk  = status?.ok || status?.healthy;
  const queueDepth = status?.queue?.depth ?? status?.queueDepth ?? "—";
  const dlqCount   = dlq?.total ?? 0;

  return (
    <div>
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <StatCard label="Runtime"       val={runtimeOk ? "Healthy" : (status ? "Degraded" : "Unknown")} color={runtimeOk ? "#52d68a" : "#f0b429"} />
        <StatCard label="Queue depth"   val={queueDepth} color={queueDepth > 50 ? "#f55b5b" : queueDepth > 10 ? "#f0b429" : "#52d68a"} />
        <StatCard label="Pending patches" val={pendingPatches.length} color={pendingPatches.length > 0 ? "#f0b429" : "#8994b0"} />
        <StatCard label="DLQ failures"  val={dlqCount} color={dlqCount > 0 ? "#f55b5b" : "#52d68a"} />
      </div>

      {status?.activePipelines?.length > 0 && (
        <Section title="Active pipelines">
          {status.activePipelines.map((p, i) => (
            <Row key={i}>
              <Badge s={p.status || "running"} />
              <span style={{ fontSize: 11, color: "#c8cdd8", flex: 1 }}>{p.name || p.id || "pipeline"}</span>
              <span style={{ fontSize: 9, color: "#8994b0" }}>{_ago(p.startedAt)}</span>
            </Row>
          ))}
        </Section>
      )}

      <Section title={`Pending patches (${pendingPatches.length})`} action={<RefreshBtn onClick={load} loading={loading} />}>
        {loading
          ? [0, 1].map(i => <Row key={i}><Skel w="100%" /></Row>)
          : pendingPatches.length === 0
            ? <EmptyState icon="✓" title="No pending patches" sub="All patches applied or no patches proposed" />
            : pendingPatches.map(p => (
              <Row key={p.id}>
                <Badge s="pending" />
                <span style={{ fontSize: 11, color: "#c8cdd8", flex: 1, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.filePath || p.id?.slice(0, 20)}
                </span>
                <span style={{ fontSize: 9, color: "#8994b0" }}>+{p.diff?.linesAdded || 0} / −{p.diff?.linesRemoved || 0}</span>
                <span style={{ fontSize: 9, color: "#8994b0", marginLeft: 6 }}>{_ago(p.proposedAt)}</span>
              </Row>
            ))
        }
      </Section>

      <Section title={`Dead letter queue (${dlqCount})`}>
        {loading
          ? <Row><Skel w="100%" /></Row>
          : dlqCount === 0
            ? <EmptyState icon="✓" title="DLQ empty" />
            : (
              <>
                {(dlq?.entries || []).slice(0, 6).map((e, i) => (
                  <Row key={i}>
                    <Badge s="fail" label="failed" />
                    <span style={{ fontSize: 11, color: "#c8cdd8", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {(e.task?.input || e.input || e.taskId || "").slice(0, 60)}
                    </span>
                    <span style={{ fontSize: 9, color: "#8994b0" }}>{e.attempts || 0}×</span>
                    <span style={{ fontSize: 9, color: "#8994b0", marginLeft: 4 }}>{_ago(e.failedAt || e.ts)}</span>
                  </Row>
                ))}
                <div style={{ padding: "8px 10px", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                  <button onClick={handleRecoverDLQ} disabled={recovering}
                    style={{ fontSize: 10, padding: "4px 14px", background: "rgba(68,162,255,0.12)", border: "1px solid rgba(68,162,255,0.25)", borderRadius: 4, cursor: "pointer", color: "#44a2ff", fontWeight: 600 }}>
                    {recovering ? "Requeuing…" : `↑ Requeue all ${dlqCount} tasks`}
                  </button>
                </div>
              </>
            )
        }
      </Section>

      {failIntel?.success && (
        <Section title="Failure intelligence">
          <div style={{ padding: "8px 10px" }}>
            {(failIntel.topErrors || []).slice(0, 3).map((e, i) => (
              <div key={i} style={{ display: "flex", gap: 8, padding: "3px 0", borderTop: i > 0 ? "1px solid rgba(255,255,255,0.04)" : "none" }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: "#f55b5b", width: 20, flexShrink: 0 }}>#{i + 1}</span>
                <div>
                  <div style={{ fontSize: 10, color: "#c8cdd8" }}>{e.message || e.pattern || e}</div>
                  {e.count && <div style={{ fontSize: 9, color: "#8994b0" }}>{e.count} occurrences</div>}
                </div>
              </div>
            ))}
            {!failIntel.topErrors?.length && (
              <div style={{ fontSize: 10, color: "#8994b0" }}>
                {failIntel.totalFailures != null ? `${failIntel.totalFailures} total failures tracked` : "No failure data yet"}
              </div>
            )}
          </div>
        </Section>
      )}

      {health && !health.error && (
        <Section title="Runtime health detail">
          <div style={{ padding: "8px 10px" }}>
            <pre style={{ fontSize: 9, color: "#8994b0", whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 160, overflowY: "auto", margin: 0 }}>
              {JSON.stringify(health, null, 2).slice(0, 1000)}
            </pre>
          </div>
        </Section>
      )}
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────

const TABS = [
  { id: "observability", label: "Observability" },
  { id: "history",       label: "Exec History"  },
  { id: "memory",        label: "Eng Memory"    },
  { id: "deploy",        label: "Deployments"   },
  { id: "tests",         label: "Test Results"  },
  { id: "healing",       label: "Self-Healing"  },
];

export default function EngineeringCenter() {
  const [tab, setTab] = useState("observability");

  useEffect(() => { track("engineering_center_viewed"); }, []);

  return (
    <div style={{ minHeight: "100vh", background: "#0d1117", color: "#c8cdd8", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <style>{`
        @keyframes ec-pulse {
          0%, 100% { opacity: 0.4; }
          50%       { opacity: 0.8; }
        }
      `}</style>

      <div style={{ padding: "24px 24px 0" }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 4px", color: "#e6edf3" }}>Engineering Center</h1>
        <p style={{ fontSize: 12, color: "#8994b0", margin: "0 0 20px" }}>
          Task → Plan → Patch → Test → Deploy → Verify → Heal → Learn
        </p>

        <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: "1px solid rgba(255,255,255,0.08)", overflowX: "auto" }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{
                padding: "8px 14px", fontSize: 11, fontWeight: 600, cursor: "pointer",
                background: "none", border: "none",
                borderBottom: tab === t.id ? "2px solid #44a2ff" : "2px solid transparent",
                color: tab === t.id ? "#44a2ff" : "#8994b0",
                marginBottom: -1, whiteSpace: "nowrap",
              }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: "0 24px 40px" }}>
        {tab === "observability" && <TabObservability />}
        {tab === "history"       && <TabHistory />}
        {tab === "memory"        && <TabMemory />}
        {tab === "deploy"        && <TabDeploy />}
        {tab === "tests"         && <TabTests />}
        {tab === "healing"       && <TabHealing />}
      </div>
    </div>
  );
}
