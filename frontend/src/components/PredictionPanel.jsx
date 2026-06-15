/**
 * PredictionPanel — B6
 * Learning → Prediction
 * 6 tabs: Readiness · Failure Risk · Deploy Risk · Cross-Project · Pre-Patch · Advisor
 */
import React, { useState, useEffect, useCallback } from "react";
import { track } from "../analytics";
import { BASE_URL } from "../_client";
import PageHeader from "./PageHeader";

// ── fetch ─────────────────────────────────────────────────────────────

async function _get(path) {
  const r = await fetch(`${BASE_URL}${path}`, { credentials: "include" });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}
async function _post(path, body = {}) {
  const r = await fetch(`${BASE_URL}${path}`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

// ── colour helpers ────────────────────────────────────────────────────

const LEVEL_COLOR = {
  production_ready: "#52d68a", mostly_ready: "#f0b429",
  needs_attention: "#f0a028", not_ready: "#f55b5b",
  low: "#52d68a", moderate: "#f0b429", high: "#f0a028", critical: "#f55b5b",
};
const WEIGHT_COLOR = { high: "#f55b5b", medium: "#f0b429", low: "#52d68a" };

function lc(level) { return LEVEL_COLOR[level] || "#8994b0"; }
function wc(w)     { return WEIGHT_COLOR[w]     || "#8994b0"; }

// ── micro components ──────────────────────────────────────────────────

function Chip({ label, color }) {
  const c = color || "#8994b0";
  return <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 3, color: c, background: c + "18", border: `1px solid ${c}30` }}>{label}</span>;
}

function Empty({ icon = "◌", title, sub }) {
  return (
    <div style={{ textAlign: "center", padding: "36px 20px", color: "#8994b0" }}>
      <div style={{ fontSize: 26, marginBottom: 8 }}>{icon}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: "#c8cdd8", marginBottom: 4 }}>{title}</div>
      {sub && <div style={{ fontSize: 11 }}>{sub}</div>}
    </div>
  );
}

function Skel({ w = "100%", h = 12 }) {
  return <span style={{ display: "block", width: w, height: h, borderRadius: 3, background: "rgba(255,255,255,0.06)", animation: "pp-pulse 1.4s ease-in-out infinite" }} />;
}

function Row({ children, style }) {
  return <div style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "8px 12px", borderBottom: "1px solid rgba(255,255,255,0.05)", ...style }}>{children}</div>;
}

function Section({ title, children, count }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "#8994b0" }}>{title}</span>
        {count != null && <span style={{ fontSize: 9, color: "#8994b0", background: "rgba(255,255,255,0.07)", padding: "0 5px", borderRadius: 3 }}>{count}</span>}
      </div>
      <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 6, overflow: "hidden" }}>
        {children}
      </div>
    </div>
  );
}

function RefBtn({ onClick, loading }) {
  return <button onClick={onClick} disabled={loading} style={{ fontSize: 9, padding: "2px 8px", background: "none", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 3, cursor: "pointer", color: "#8994b0" }}>{loading ? "…" : "⟳"}</button>;
}

function ScoreGauge({ score, level, size = 96 }) {
  const col   = lc(level);
  const r     = size / 2 - 8;
  const circ  = 2 * Math.PI * r;
  const fill  = circ * (1 - score / 100);
  return (
    <svg width={size} height={size} style={{ display: "block" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={8} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={col} strokeWidth={8}
        strokeDasharray={circ} strokeDashoffset={fill}
        strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dashoffset 0.6s cubic-bezier(.4,0,.2,1)" }} />
      <text x={size / 2} y={size / 2 + 1} textAnchor="middle" dominantBaseline="middle"
        style={{ fontSize: 18, fontWeight: 700, fill: col }}>{score}</text>
      <text x={size / 2} y={size / 2 + 14} textAnchor="middle" dominantBaseline="middle"
        style={{ fontSize: 8, fill: "#8994b0" }}>/ 100</text>
    </svg>
  );
}

function SignalBar({ name, score, weight, rawValue, detail }) {
  const col = score >= 80 ? "#52d68a" : score >= 60 ? "#f0b429" : "#f55b5b";
  return (
    <div style={{ padding: "8px 12px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 10, color: "#c8cdd8", flex: 1 }}>{name}</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: col }}>{score}%</span>
        <span style={{ fontSize: 8, color: "#8994b0" }}>w={Math.round(weight * 100)}%</span>
      </div>
      <div style={{ height: 4, borderRadius: 2, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
        <div style={{ width: `${score}%`, height: "100%", background: col, borderRadius: 2, transition: "width 0.5s ease" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3 }}>
        <span style={{ fontSize: 8, color: col }}>{rawValue}</span>
        {detail && <span style={{ fontSize: 8, color: "#8994b0" }}>{detail}</span>}
      </div>
    </div>
  );
}

function FactorRow({ factor, weight, detail, evidence }) {
  const col = lc(weight > 25 ? "critical" : weight > 12 ? "high" : weight > 5 ? "moderate" : "low");
  return (
    <Row>
      <span style={{ fontSize: 10, fontWeight: 700, color: col, width: 28, flexShrink: 0, textAlign: "right" }}>+{weight}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 10, color: "#c8cdd8" }}>{detail}</div>
        {evidence && <div style={{ fontSize: 8, color: "#8994b0", marginTop: 1 }}>{evidence}</div>}
      </div>
      <Chip label={factor.replace(/_/g, " ")} color={col} />
    </Row>
  );
}

function _ago(ts) {
  if (!ts) return "—";
  try {
    const s = Math.floor((Date.now() - new Date(ts)) / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return new Date(ts).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  } catch { return "—"; }
}

// ── B6.6 Readiness Score ──────────────────────────────────────────────

function TabReadiness() {
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr]       = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try { setData(await _get("/runtime/predict/readiness-score")); }
    catch (e) { setErr(e.message); }
    finally { setLoading(false); }
    track("predict_readiness");
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 8 }}>{[0,1,2].map(i => <Skel key={i} />)}</div>;
  if (err || !data) return <Empty title="Could not load readiness score" sub={err} />;

  const col = lc(data.level);

  return (
    <div>
      {/* Hero score */}
      <div style={{ display: "flex", alignItems: "center", gap: 24, marginBottom: 24, padding: "20px 0" }}>
        <ScoreGauge score={data.compositeScore} level={data.level} size={112} />
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: col, marginBottom: 4 }}>{data.badge || data.level}</div>
          <div style={{ fontSize: 12, color: "#8994b0", marginBottom: 10 }}>
            Based on {data.meta?.patchTotal ?? "—"} patches · {data.meta?.incidentTotal ?? "—"} incidents · {data.meta?.healTotal ?? "—"} healing events
          </div>
          {data.strengths?.length > 0 && (
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {data.strengths.map((s, i) => <Chip key={i} label={`✓ ${s}`} color="#52d68a" />)}
            </div>
          )}
        </div>
      </div>

      {/* Signal breakdown */}
      <Section title="Signal breakdown">
        {(data.signals || []).map((s, i) => (
          <SignalBar key={i} name={s.name} score={s.score} weight={s.weight} rawValue={s.rawValue} detail={s.detail} />
        ))}
      </Section>

      {/* Blockers */}
      {data.blockers?.length > 0 && (
        <Section title="Blockers" count={data.blockers.length}>
          {data.blockers.map((b, i) => (
            <Row key={i}>
              <span style={{ fontSize: 12, color: "#f55b5b" }}>✗</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: "#c8cdd8", fontWeight: 600 }}>{b.signal}</div>
                <div style={{ fontSize: 9, color: "#8994b0", marginTop: 2 }}>{b.recommendation}</div>
              </div>
              <Chip label={`${b.score}%`} color="#f55b5b" />
            </Row>
          ))}
        </Section>
      )}

      <div style={{ fontSize: 9, color: "#8994b0", textAlign: "right" }}>{_ago(data.generatedAt)}</div>
    </div>
  );
}

// ── B6.1 Failure Risk ─────────────────────────────────────────────────

function TabFailureRisk() {
  const [request,      setRequest]      = useState("");
  const [filePath,     setFilePath]     = useState("");
  const [pipelineName, setPipelineName] = useState("standard-deploy");
  const [data,         setData]         = useState(null);
  const [loading,      setLoading]      = useState(false);

  async function predict() {
    if (!request.trim() && !filePath.trim()) return;
    setLoading(true);
    try { setData(await _post("/runtime/predict/failure-risk", { request, filePath, pipelineName })); }
    catch (e) { setData({ error: e.message }); }
    finally { setLoading(false); }
    track("predict_failure_risk");
  }

  return (
    <div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
        <textarea value={request} onChange={e => setRequest(e.target.value)}
          placeholder="Describe the task / change you're about to run…"
          rows={2} style={{ padding: "7px 10px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 5, color: "#e6edf3", fontSize: 12, fontFamily: "inherit", resize: "vertical" }} />
        <div style={{ display: "flex", gap: 8 }}>
          <input value={filePath} onChange={e => setFilePath(e.target.value)}
            placeholder="File path (optional)"
            style={{ flex: 2, padding: "6px 10px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 5, color: "#e6edf3", fontSize: 11, fontFamily: "inherit" }} />
          <input value={pipelineName} onChange={e => setPipelineName(e.target.value)}
            placeholder="Pipeline name"
            style={{ flex: 1, padding: "6px 10px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 5, color: "#e6edf3", fontSize: 11, fontFamily: "inherit" }} />
          <button onClick={predict} disabled={loading || (!request.trim() && !filePath.trim())}
            style={{ padding: "6px 16px", background: "rgba(68,162,255,0.15)", border: "1px solid rgba(68,162,255,0.3)", borderRadius: 5, color: "#44a2ff", fontSize: 11, cursor: "pointer", fontWeight: 600, fontFamily: "inherit" }}>
            {loading ? "…" : "Predict Risk"}
          </button>
        </div>
      </div>

      {data?.error && <div style={{ fontSize: 11, color: "#f55b5b", marginBottom: 10 }}>Error: {data.error}</div>}

      {data && !data.error && (
        <>
          {/* Risk hero */}
          <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 20, padding: 16,
            background: lc(data.riskLevel) + "0d", border: `1px solid ${lc(data.riskLevel)}30`, borderRadius: 8 }}>
            <ScoreGauge score={data.riskScore} level={data.riskLevel} size={88} />
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: lc(data.riskLevel), marginBottom: 4 }}>
                {data.riskLevel?.toUpperCase()} RISK
              </div>
              <div style={{ fontSize: 11, color: "#c8cdd8", marginBottom: 6 }}>{data.recommendation}</div>
              <div style={{ fontSize: 9, color: "#8994b0" }}>Confidence: {data.confidence}%</div>
            </div>
          </div>

          {/* Factors */}
          <Section title="Risk factors" count={data.factors?.length}>
            {data.factors?.length === 0
              ? <Row><span style={{ fontSize: 11, color: "#8994b0" }}>No risk factors detected.</span></Row>
              : data.factors?.map((f, i) => <FactorRow key={i} {...f} />)
            }
          </Section>

          {/* Mitigations */}
          {data.mitigations?.length > 0 && (
            <Section title="Positive signals">
              {data.mitigations.map((m, i) => (
                <Row key={i}>
                  <span style={{ fontSize: 11, color: "#52d68a" }}>✓</span>
                  <span style={{ fontSize: 11, color: "#c8cdd8" }}>{m}</span>
                </Row>
              ))}
            </Section>
          )}

          {/* Meta */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
            {Object.entries(data.meta || {}).map(([k, v]) => (
              <div key={k} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 5, padding: "5px 10px", textAlign: "center" }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#c8cdd8" }}>{v}</div>
                <div style={{ fontSize: 8, color: "#8994b0" }}>{k.replace(/([A-Z])/g, " $1").toLowerCase()}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {!data && !loading && <Empty icon="⬡" title="Enter task details to predict failure risk" sub="Analyzes patch history, execution history, incidents, and healing events." />}
    </div>
  );
}

// ── B6.2 Deploy Risk ──────────────────────────────────────────────────

function TabDeployRisk() {
  const [pipelineName, setPipelineName] = useState("standard-deploy");
  const [request,      setRequest]      = useState("");
  const [filePaths,    setFilePaths]    = useState("");
  const [data,         setData]         = useState(null);
  const [loading,      setLoading]      = useState(false);

  async function assess() {
    setLoading(true);
    try {
      const fps = filePaths.split("\n").map(s => s.trim()).filter(Boolean);
      setData(await _post("/runtime/predict/deploy-risk", { pipelineName, request, filePaths: fps }));
    } catch (e) { setData({ error: e.message }); }
    finally { setLoading(false); }
    track("predict_deploy_risk");
  }

  useEffect(() => { assess(); }, []); // load on mount with defaults

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <input value={pipelineName} onChange={e => setPipelineName(e.target.value)}
          placeholder="Pipeline name"
          style={{ flex: 1, padding: "6px 10px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 5, color: "#e6edf3", fontSize: 11, fontFamily: "inherit" }} />
        <input value={request} onChange={e => setRequest(e.target.value)}
          placeholder="Change description (optional)"
          style={{ flex: 2, padding: "6px 10px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 5, color: "#e6edf3", fontSize: 11, fontFamily: "inherit" }} />
        <button onClick={assess} disabled={loading}
          style={{ padding: "6px 16px", background: "rgba(68,162,255,0.15)", border: "1px solid rgba(68,162,255,0.3)", borderRadius: 5, color: "#44a2ff", fontSize: 11, cursor: "pointer", fontWeight: 600, fontFamily: "inherit" }}>
          {loading ? "…" : "Assess"}
        </button>
      </div>
      <textarea value={filePaths} onChange={e => setFilePaths(e.target.value)}
        placeholder="File paths to deploy (one per line, optional)"
        rows={2} style={{ width: "100%", boxSizing: "border-box", padding: "6px 10px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 5, color: "#e6edf3", fontSize: 10, fontFamily: "monospace", resize: "vertical", marginBottom: 14 }} />

      {data?.error && <div style={{ fontSize: 11, color: "#f55b5b", marginBottom: 10 }}>Error: {data.error}</div>}

      {loading && [0,1,2].map(i => <div key={i} style={{ marginBottom: 8 }}><Skel /></div>)}

      {data && !data.error && !loading && (
        <>
          {/* Risk + confidence hero */}
          <div style={{ display: "flex", gap: 16, marginBottom: 20 }}>
            <div style={{ flex: 1, padding: 16, background: lc(data.riskLevel) + "0d", border: `1px solid ${lc(data.riskLevel)}30`, borderRadius: 8, textAlign: "center" }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: lc(data.riskLevel) }}>{data.riskPercentage}%</div>
              <div style={{ fontSize: 10, color: "#8994b0", marginTop: 2 }}>Deploy Risk</div>
              <Chip label={data.riskLevel?.toUpperCase()} color={lc(data.riskLevel)} />
            </div>
            <div style={{ flex: 1, padding: 16, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, textAlign: "center" }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: "#44a2ff" }}>{data.confidenceScore}%</div>
              <div style={{ fontSize: 10, color: "#8994b0", marginTop: 2 }}>Confidence</div>
            </div>
          </div>

          <div style={{ fontSize: 11, color: "#c8cdd8", padding: "8px 12px", background: "rgba(255,255,255,0.03)", borderRadius: 5, marginBottom: 16, borderLeft: `3px solid ${lc(data.riskLevel)}` }}>
            {data.recommendation}
          </div>

          {/* Base risk detail */}
          {data.baseRisk?.factors?.length > 0 && (
            <Section title="Risk factors">
              {data.baseRisk.factors.map((f, i) => (
                <Row key={i}>
                  <span style={{ fontSize: 10, color: "#f0b429" }}>⚠</span>
                  <span style={{ fontSize: 11, color: "#c8cdd8", flex: 1 }}>{f}</span>
                </Row>
              ))}
            </Section>
          )}

          {/* Similar history */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Section title={`Similar successful (${data.similarSuccessful?.length ?? 0})`}>
              {data.similarSuccessful?.length === 0
                ? <Row><span style={{ fontSize: 11, color: "#8994b0" }}>None yet</span></Row>
                : data.similarSuccessful?.map((p, i) => (
                  <Row key={i}>
                    <span style={{ fontSize: 10, color: "#52d68a" }}>✓</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 10, color: "#c8cdd8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{(p.filePath || p.patchId)?.split("/").pop()}</div>
                      <div style={{ fontSize: 8, color: "#8994b0" }}>{_ago(p.proposedAt)}</div>
                    </div>
                  </Row>
                ))
              }
            </Section>

            <Section title={`Similar failed (${data.similarFailed?.length ?? 0})`}>
              {data.similarFailed?.length === 0
                ? <Row><span style={{ fontSize: 11, color: "#8994b0" }}>None recorded</span></Row>
                : data.similarFailed?.map((p, i) => (
                  <Row key={i}>
                    <span style={{ fontSize: 10, color: "#f55b5b" }}>✗</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 10, color: "#c8cdd8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{(p.filePath || p.patchId)?.split("/").pop()}</div>
                    </div>
                  </Row>
                ))
              }
            </Section>
          </div>

          {/* Platform stats */}
          <Section title="Platform stats">
            {Object.entries(data.platformStats || {}).map(([k, v]) => (
              <Row key={k}>
                <span style={{ fontSize: 10, color: "#8994b0", flex: 1 }}>{k.replace(/([A-Z])/g, " $1").toLowerCase()}</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: v != null && v < 50 ? "#f55b5b" : v != null && v < 70 ? "#f0b429" : "#52d68a" }}>{v != null ? `${v}${typeof v === "number" && k.toLowerCase().includes("rate") ? "%" : ""}` : "—"}</span>
              </Row>
            ))}
          </Section>

          {data.recoveryConfidence && (
            <Section title="Recovery confidence">
              <Row>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: "#c8cdd8" }}>{data.recoveryConfidence.chainName}</div>
                  <div style={{ fontSize: 9, color: "#8994b0", marginTop: 2 }}>{data.recoveryConfidence.recommendation}</div>
                </div>
                <Chip label={`${data.recoveryConfidence.confidence}% ${data.recoveryConfidence.label}`} color={data.recoveryConfidence.confidence >= 70 ? "#52d68a" : "#f0b429"} />
              </Row>
            </Section>
          )}
        </>
      )}
    </div>
  );
}

// ── B6.3 Cross-Project Knowledge ──────────────────────────────────────

function TabCrossProject() {
  const [q, setQ]           = useState("");
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(null);

  async function search() {
    setLoading(true);
    try { setData(await _get(`/runtime/predict/cross-project?q=${encodeURIComponent(q)}&limit=20`)); }
    catch (e) { setData({ error: e.message }); }
    finally { setLoading(false); }
    track("predict_cross_project");
  }

  useEffect(() => { search(); }, []);

  const results = data?.results || [];

  const bySource = results.reduce((acc, r) => { (acc[r.source] = acc[r.source] || []).push(r); return acc; }, {});
  const sourceColors = { knowledge_base: "#f0b429", eng_memory: "#7c6fff", patch_history: "#44d9ff" };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <input value={q} onChange={e => setQ(e.target.value)}
          onKeyDown={e => e.key === "Enter" && search()}
          placeholder="Search shared knowledge — fix, pattern, problem description…"
          style={{ flex: 1, padding: "7px 10px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 5, color: "#e6edf3", fontSize: 12, fontFamily: "inherit" }} />
        <button onClick={search} disabled={loading}
          style={{ padding: "7px 16px", background: "rgba(68,162,255,0.15)", border: "1px solid rgba(68,162,255,0.3)", borderRadius: 5, color: "#44a2ff", fontSize: 11, cursor: "pointer", fontWeight: 600, fontFamily: "inherit" }}>
          {loading ? "…" : "Search"}
        </button>
      </div>

      {data?.error && <div style={{ fontSize: 11, color: "#f55b5b", marginBottom: 10 }}>Error: {data.error}</div>}

      {loading ? [0,1,2,3].map(i => <div key={i} style={{ marginBottom: 6 }}><Skel /></div>) : (
        results.length === 0 ? (
          <Empty title="No cross-project knowledge yet" sub="Apply patches, record incidents, and run the engineering loop to build the knowledge graph." />
        ) : (
          Object.entries(bySource).map(([source, items]) => (
            <Section key={source} title={source.replace(/_/g, " ")} count={items.length}>
              {items.slice(0, 8).map((r, i) => {
                const isOpen = expanded === `${source}-${i}`;
                const col    = sourceColors[source] || "#8994b0";
                return (
                  <div key={i}>
                    <div onClick={() => setExpanded(isOpen ? null : `${source}-${i}`)}
                      style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "8px 12px", borderBottom: "1px solid rgba(255,255,255,0.05)", cursor: "pointer" }}
                      onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.02)"}
                      onMouseLeave={e => e.currentTarget.style.background = ""}>
                      <Chip label={r.kind || r.source.replace(/_/g, " ")} color={col} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, color: "#c8cdd8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {r.key || r.chainName || r.goalPattern || r.filePath?.split("/").pop() || r.reason || "(no label)"}
                        </div>
                        {r.problem && <div style={{ fontSize: 9, color: "#8994b0", marginTop: 1 }}>{r.problem}</div>}
                      </div>
                      <Chip label={`${r.score}%`} color={r.score >= 70 ? "#52d68a" : r.score >= 40 ? "#f0b429" : "#8994b0"} />
                      <span style={{ fontSize: 9, color: "#8994b0" }}>{isOpen ? "▲" : "▼"}</span>
                    </div>
                    {isOpen && (
                      <div style={{ padding: "8px 12px", background: "rgba(0,0,0,0.15)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                        {r.fix         && <div style={{ fontSize: 10, color: "#c8cdd8", marginBottom: 4 }}><strong>Fix:</strong> {r.fix}</div>}
                        {r.description && <div style={{ fontSize: 10, color: "#c8cdd8", marginBottom: 4 }}>{r.description}</div>}
                        {r.confidence  && <div style={{ fontSize: 9, color: "#8994b0" }}>Confidence: {r.confidence}% · Steps: {r.stepCount}</div>}
                        {r.ts          && <div style={{ fontSize: 8, color: "#8994b0", marginTop: 3 }}>{_ago(r.ts)}</div>}
                      </div>
                    )}
                  </div>
                );
              })}
            </Section>
          ))
        )
      )}
    </div>
  );
}

// ── B6.4 Pre-Patch Advice ─────────────────────────────────────────────

function TabPrePatch() {
  const [filePath,    setFilePath]    = useState("");
  const [description, setDescription] = useState("");
  const [data,        setData]        = useState(null);
  const [loading,     setLoading]     = useState(false);

  async function advise() {
    if (!filePath.trim() && !description.trim()) return;
    setLoading(true);
    try { setData(await _post("/runtime/predict/pre-patch-advice", { filePath, description })); }
    catch (e) { setData({ error: e.message }); }
    finally { setLoading(false); }
    track("predict_pre_patch");
  }

  return (
    <div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
        <input value={filePath} onChange={e => setFilePath(e.target.value)}
          placeholder="Target file path — e.g. backend/routes/runtime.js"
          style={{ padding: "7px 10px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 5, color: "#e6edf3", fontSize: 11, fontFamily: "monospace" }} />
        <div style={{ display: "flex", gap: 8 }}>
          <textarea value={description} onChange={e => setDescription(e.target.value)}
            placeholder="What are you trying to fix or change?"
            rows={2} style={{ flex: 1, padding: "7px 10px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 5, color: "#e6edf3", fontSize: 12, fontFamily: "inherit", resize: "vertical" }} />
          <button onClick={advise} disabled={loading || (!filePath.trim() && !description.trim())}
            style={{ padding: "0 18px", background: "rgba(68,162,255,0.15)", border: "1px solid rgba(68,162,255,0.3)", borderRadius: 5, color: "#44a2ff", fontSize: 11, cursor: "pointer", fontWeight: 600, fontFamily: "inherit" }}>
            {loading ? "…" : "Get Advice"}
          </button>
        </div>
      </div>

      {data?.error && <div style={{ fontSize: 11, color: "#f55b5b", marginBottom: 10 }}>Error: {data.error}</div>}

      {loading ? [0,1,2,3].map(i => <div key={i} style={{ marginBottom: 8 }}><Skel /></div>) : (
        data && !data.error && (
          <>
            {/* File history */}
            {data.fileHistory && (
              <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
                {[
                  { label: "Applied", val: data.fileHistory.applied, color: "#52d68a" },
                  { label: "Rolled back", val: data.fileHistory.rolledBack, color: data.fileHistory.rolledBack > 0 ? "#f55b5b" : "#8994b0" },
                  { label: "Pending", val: data.fileHistory.pending, color: "#f0b429" },
                  { label: "Rollback rate", val: `${data.fileHistory.rollbackRate}%`, color: data.fileHistory.rollbackRate > 30 ? "#f55b5b" : "#52d68a" },
                ].map(s => (
                  <div key={s.label} style={{ flex: "1 1 70px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 6, padding: "8px 10px", textAlign: "center" }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: s.color }}>{s.val}</div>
                    <div style={{ fontSize: 8, color: "#8994b0", marginTop: 2 }}>{s.label}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Safest path */}
            <Section title="Recommended path">
              {data.safestPath?.map((s, i) => (
                <Row key={i}>
                  <span style={{ fontSize: 10, color: s.startsWith("Warning") ? "#f0b429" : "#52d68a" }}>{s.startsWith("Warning") ? "⚠" : "→"}</span>
                  <span style={{ fontSize: 11, color: "#c8cdd8" }}>{s}</span>
                </Row>
              ))}
            </Section>

            {/* Success patterns */}
            <Section title={`Top success patterns (${data.successPatterns?.length ?? 0})`}>
              {data.successPatterns?.length === 0
                ? <Row><span style={{ fontSize: 11, color: "#8994b0" }}>No clean-patch files yet.</span></Row>
                : data.successPatterns?.map((p, i) => (
                  <Row key={i}>
                    <span style={{ fontSize: 10, color: "#52d68a" }}>✓</span>
                    <span style={{ fontSize: 10, color: "#c8cdd8", flex: 1 }}>{p.file}</span>
                    <Chip label={`${p.applied} applied`} color="#52d68a" />
                  </Row>
                ))
              }
            </Section>

            {/* Failure patterns */}
            <Section title={`Top failure patterns (${data.failurePatterns?.length ?? 0})`}>
              {data.failurePatterns?.length === 0
                ? <Row><span style={{ fontSize: 11, color: "#8994b0" }}>No rollbacks recorded yet.</span></Row>
                : data.failurePatterns?.map((p, i) => (
                  <Row key={i}>
                    <span style={{ fontSize: 10, color: "#f55b5b" }}>✗</span>
                    <span style={{ fontSize: 10, color: "#c8cdd8", flex: 1 }}>{p.file}</span>
                    <Chip label={`${p.rollbackRate}% rollback`} color="#f55b5b" />
                  </Row>
                ))
              }
            </Section>

            {/* Platform health */}
            {data.platformHealth && (
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 4 }}>
                {Object.entries(data.platformHealth).filter(([,v]) => v != null).map(([k, v]) => (
                  <div key={k} style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: v >= 70 ? "#52d68a" : v >= 40 ? "#f0b429" : "#f55b5b" }}>{v}%</div>
                    <div style={{ fontSize: 8, color: "#8994b0" }}>{k.replace(/([A-Z])/g, " $1").toLowerCase()}</div>
                  </div>
                ))}
              </div>
            )}
          </>
        )
      )}

      {!data && !loading && <Empty icon="⧗" title="Enter a file path to get pre-patch advice" sub="Shows success/failure history, safe path, and known risk patterns for the target file." />}
    </div>
  );
}

// ── B6.5 Engineering Advisor ──────────────────────────────────────────

function TabAdvisor() {
  const [subject,     setSubject]     = useState("");
  const [subjectType, setSubjectType] = useState("patch");
  const [filePath,    setFilePath]    = useState("");
  const [riskScore,   setRiskScore]   = useState("");
  const [data,        setData]        = useState(null);
  const [loading,     setLoading]     = useState(false);

  async function explain() {
    if (!subject.trim() && !filePath.trim()) return;
    setLoading(true);
    try {
      setData(await _post("/runtime/predict/explain", {
        subject, subjectType, filePath,
        riskScore: riskScore ? parseInt(riskScore) : null,
      }));
    } catch (e) { setData({ error: e.message }); }
    finally { setLoading(false); }
    track("predict_advisor");
  }

  const TYPES = ["patch", "file", "incident", "deploy"];

  return (
    <div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {TYPES.map(t => (
            <button key={t} onClick={() => setSubjectType(t)}
              style={{ padding: "4px 12px", fontSize: 10, borderRadius: 3, cursor: "pointer", fontFamily: "inherit",
                background: subjectType === t ? "rgba(124,111,255,0.15)" : "rgba(255,255,255,0.04)",
                border: `1px solid ${subjectType === t ? "rgba(124,111,255,0.35)" : "rgba(255,255,255,0.09)"}`,
                color: subjectType === t ? "#7c6fff" : "#8994b0", fontWeight: subjectType === t ? 700 : 400 }}>
              {t}
            </button>
          ))}
        </div>
        <textarea value={subject} onChange={e => setSubject(e.target.value)}
          placeholder={`Describe what you want explained — e.g. "Why is this patch risky?" or "Why is this recommended?"…`}
          rows={2} style={{ padding: "7px 10px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 5, color: "#e6edf3", fontSize: 12, fontFamily: "inherit", resize: "vertical" }} />
        <div style={{ display: "flex", gap: 8 }}>
          <input value={filePath} onChange={e => setFilePath(e.target.value)}
            placeholder="File path (optional)"
            style={{ flex: 2, padding: "6px 10px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 5, color: "#e6edf3", fontSize: 11, fontFamily: "inherit" }} />
          <input value={riskScore} onChange={e => setRiskScore(e.target.value)} type="number" min="0" max="100"
            placeholder="Risk score (opt)"
            style={{ flex: 1, padding: "6px 10px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 5, color: "#e6edf3", fontSize: 11, fontFamily: "inherit" }} />
          <button onClick={explain} disabled={loading || (!subject.trim() && !filePath.trim())}
            style={{ padding: "6px 18px", background: "rgba(124,111,255,0.15)", border: "1px solid rgba(124,111,255,0.3)", borderRadius: 5, color: "#7c6fff", fontSize: 11, cursor: "pointer", fontWeight: 600, fontFamily: "inherit" }}>
            {loading ? "…" : "Explain"}
          </button>
        </div>
      </div>

      {data?.error && <div style={{ fontSize: 11, color: "#f55b5b", marginBottom: 10 }}>Error: {data.error}</div>}

      {loading ? [0,1,2,3].map(i => <div key={i} style={{ marginBottom: 8 }}><Skel /></div>) : (
        data && !data.error && (
          <>
            {/* Verdict */}
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20, padding: 14,
              background: lc(data.verdict === "risky" ? "critical" : data.verdict === "safe" ? "low" : "moderate") + "0d",
              border: `1px solid ${lc(data.verdict === "risky" ? "critical" : data.verdict === "safe" ? "low" : "moderate")}30`,
              borderRadius: 8 }}>
              <ScoreGauge score={data.riskScore || 0} level={data.verdict === "risky" ? "critical" : data.verdict === "safe" ? "low" : "moderate"} size={80} />
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: lc(data.verdict === "risky" ? "critical" : data.verdict === "safe" ? "low" : "moderate"), marginBottom: 6 }}>
                  {data.verdict === "risky" ? "⚠ RISKY" : data.verdict === "safe" ? "✓ SAFE" : "~ NEUTRAL"}
                </div>
                <div style={{ fontSize: 11, color: "#c8cdd8" }}>{data.summary}</div>
              </div>
            </div>

            {/* Reasoning chain */}
            <Section title="Evidence-backed reasoning" count={data.reasoning?.length}>
              {data.reasoning?.map((r, i) => (
                <Row key={i}>
                  <span style={{ fontSize: 10, color: "#7c6fff", flexShrink: 0 }}>{i + 1}.</span>
                  <span style={{ fontSize: 11, color: "#c8cdd8", flex: 1 }}>{r}</span>
                </Row>
              ))}
            </Section>

            {/* Evidence detail */}
            <Section title="Evidence" count={data.evidence?.length}>
              {data.evidence?.map((e, i) => (
                <Row key={i}>
                  <Chip label={e.type?.replace(/_/g, " ")} color={wc(e.weight)} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 10, color: "#c8cdd8", fontWeight: 600 }}>{e.label}</div>
                    <div style={{ fontSize: 9, color: "#8994b0", marginTop: 1 }}>{e.value}</div>
                  </div>
                  <Chip label={e.weight} color={wc(e.weight)} />
                </Row>
              ))}
            </Section>

            {/* KB matches */}
            {data.kbMatches?.length > 0 && (
              <Section title="Knowledge base matches">
                {data.kbMatches.map((k, i) => (
                  <Row key={i}>
                    <Chip label={k.kind} color="#f0b429" />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 10, color: "#c8cdd8" }}>{k.key || k.description}</div>
                      {k.fix && <div style={{ fontSize: 9, color: "#52d68a", marginTop: 1 }}>Fix: {k.fix}</div>}
                    </div>
                  </Row>
                ))}
              </Section>
            )}
          </>
        )
      )}

      {!data && !loading && (
        <Empty icon="◎" title="Ask the Engineering Advisor" sub={`"Why is this risky?" • "Why is this recommended?" • "Explain this rollback rate" — backed by real execution evidence.`} />
      )}
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────

const TABS = [
  { id: "readiness", label: "Readiness"      },
  { id: "risk",      label: "Failure Risk"   },
  { id: "deploy",    label: "Deploy Risk"    },
  { id: "xproject",  label: "Cross-Project"  },
  { id: "prepatch",  label: "Pre-Patch"      },
  { id: "advisor",   label: "Advisor"        },
];

export default function PredictionPanel({ onNavigate }) {
  const [tab, setTab] = useState("readiness");

  useEffect(() => { track("prediction_panel_viewed"); }, []);

  return (
    <div style={{ minHeight: "100vh", background: "#0d1117", color: "#c8cdd8", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <style>{`
        @keyframes pp-pulse { 0%,100%{opacity:0.4} 50%{opacity:0.8} }
      `}</style>
      <PageHeader
        icon="◇"
        title="Prediction Engine"
        subtitle="Failure risk · Deploy risk · Cross-project knowledge · Pre-patch advice · Evidence-backed advisor"
        related={[
          { label: "Intelligence", tab: "intel", icon: "◈" },
          { label: "Guardrails", tab: "guardrails", icon: "◻" },
          { label: "Reliability", tab: "reliability", icon: "◈" },
          { label: "Recommendation", tab: "recommend", icon: "✦" },
          { label: "Self-Healing", tab: "selfhealing", icon: "✦" },
        ]}
        onNavigate={onNavigate}
      />
      <div style={{ padding: "16px 24px 0" }}>

        <div style={{ display: "flex", gap: 2, borderBottom: "1px solid rgba(255,255,255,0.08)", overflowX: "auto" }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ padding: "8px 14px", fontSize: 11, fontWeight: 600, cursor: "pointer",
                background: "none", border: "none",
                borderBottom: tab === t.id ? "2px solid #44a2ff" : "2px solid transparent",
                color: tab === t.id ? "#44a2ff" : "#8994b0",
                marginBottom: -1, whiteSpace: "nowrap", fontFamily: "inherit" }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: "20px 24px 40px" }}>
        {tab === "readiness" && <TabReadiness />}
        {tab === "risk"      && <TabFailureRisk />}
        {tab === "deploy"    && <TabDeployRisk />}
        {tab === "xproject"  && <TabCrossProject />}
        {tab === "prepatch"  && <TabPrePatch />}
        {tab === "advisor"   && <TabAdvisor />}
      </div>
    </div>
  );
}
