/**
 * IntelligencePanel — B5
 * Learning → Recommendation
 * 7 tabs: Summary · Similar Fixes · Patterns · Recommend · Incident KB · Search · Correlate
 */
import React, { useState, useEffect, useCallback, useRef } from "react";
import { track } from "../analytics";
import { BASE_URL } from "../_client";
import PageHeader from "./PageHeader";
import WorkflowNav from "./WorkflowNav";

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
  return r.json();
}

// ── palette ───────────────────────────────────────────────────────────

const C = {
  ok: "#52d68a", warn: "#f0b429", fail: "#f55b5b", info: "#44a2ff",
  muted: "#8994b0", text: "#c8cdd8", head: "#e6edf3",
  patch: "#44d9ff", memory: "#7c6fff", knowledge: "#f0b429",
  incident: "#f55b5b", execution: "#52d68a",
};

function typeColor(t) {
  return { patch: C.patch, memory: C.memory, knowledge: C.knowledge,
    incident: C.incident, execution: C.ok, knowledge_base: C.knowledge,
    patch_history: C.patch, eng_memory: C.memory, learning_engine: C.warn }[t] || C.muted;
}

function statusColor(s) {
  return { ok: C.ok, success: C.ok, applied: C.ok, done: C.ok, pass: C.ok,
    failed: C.fail, fail: C.fail, error: C.fail, rolled_back: C.fail,
    pending: C.warn, running: "#7c6fff", open: C.warn, acknowledged: C.info }[s] || C.muted;
}

// ── micro components ──────────────────────────────────────────────────

function Chip({ label, color }) {
  const c = color || C.muted;
  return <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 3, color: c, background: c + "18", border: `1px solid ${c}30` }}>{label}</span>;
}

function ScoreBar({ score = 0 }) {
  const col = score >= 80 ? C.ok : score >= 50 ? C.warn : C.fail;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 60 }}>
      <div style={{ flex: 1, height: 3, borderRadius: 2, background: "rgba(255,255,255,0.08)" }}>
        <div style={{ width: `${Math.min(score, 100)}%`, height: "100%", borderRadius: 2, background: col, transition: "width 0.3s" }} />
      </div>
      <span style={{ fontSize: 9, color: col, width: 26, textAlign: "right", flexShrink: 0 }}>{score}%</span>
    </div>
  );
}

function Empty({ icon = "◌", title, sub }) {
  return (
    <div style={{ textAlign: "center", padding: "36px 20px", color: C.muted }}>
      <div style={{ fontSize: 26, marginBottom: 8 }}>{icon}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 4 }}>{title}</div>
      {sub && <div style={{ fontSize: 11 }}>{sub}</div>}
    </div>
  );
}

function Skel({ w = "100%", h = 12 }) {
  return <span style={{ display: "block", width: w, height: h, borderRadius: 3, background: "rgba(255,255,255,0.06)", animation: "ip-pulse 1.4s ease-in-out infinite" }} />;
}

function Row({ children, style, onClick }) {
  return (
    <div onClick={onClick}
      style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "8px 12px",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
        cursor: onClick ? "pointer" : undefined,
        transition: onClick ? "background 0.15s" : undefined,
        ...style }}
      onMouseEnter={onClick ? e => e.currentTarget.style.background = "rgba(255,255,255,0.03)" : undefined}
      onMouseLeave={onClick ? e => e.currentTarget.style.background = "" : undefined}>
      {children}
    </div>
  );
}

function Section({ title, count, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: C.muted }}>{title}</span>
        {count != null && <span style={{ fontSize: 9, color: C.muted, background: "rgba(255,255,255,0.07)", padding: "0 5px", borderRadius: 3 }}>{count}</span>}
      </div>
      <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 6, overflow: "hidden" }}>
        {children}
      </div>
    </div>
  );
}

function SearchInput({ value, onChange, onSearch, placeholder, loading }) {
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
      <input value={value} onChange={e => onChange(e.target.value)}
        onKeyDown={e => e.key === "Enter" && onSearch()}
        placeholder={placeholder}
        style={{ flex: 1, padding: "7px 10px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 5, color: C.head, fontSize: 12, fontFamily: "inherit" }} />
      <button onClick={onSearch} disabled={loading}
        style={{ padding: "7px 16px", background: "rgba(68,162,255,0.15)", border: "1px solid rgba(68,162,255,0.3)", borderRadius: 5, color: C.info, fontSize: 11, cursor: "pointer", fontWeight: 600, fontFamily: "inherit" }}>
        {loading ? "…" : "Search"}
      </button>
    </div>
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

// ── Tab: Summary ──────────────────────────────────────────────────────

function TabSummary() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try { setData(await _get("/runtime/intel/summary")); }
    catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); track("intel_summary"); }, [load]);

  if (loading) return <div style={{ padding: 20 }}><Skel w="60%" /><br/><Skel w="80%" /><br/><Skel w="50%" /></div>;
  if (err || !data) return <Empty title="Could not load summary" sub={err} />;

  const cards = [
    { label: "Patch success rate", val: data.patch?.successRate != null ? `${data.patch.successRate}%` : "—", color: (data.patch?.successRate ?? 0) > 70 ? C.ok : C.warn },
    { label: "Total patches",      val: data.patch?.total ?? "—" },
    { label: "Applied",            val: data.patch?.applied ?? "—", color: C.ok },
    { label: "Rolled back",        val: data.patch?.rolled_back ?? "—", color: (data.patch?.rolled_back ?? 0) > 0 ? C.fail : C.muted },
    { label: "Exec history",       val: data.history?.total ?? "—" },
    { label: "Exec succeeded",     val: data.history?.succeeded ?? "—", color: C.ok },
    { label: "Exec failed",        val: data.history?.failed ?? "—", color: (data.history?.failed ?? 0) > 0 ? C.fail : C.muted },
    { label: "KB entries",         val: data.knowledge?.total ?? "—" },
    { label: "Memory entries",     val: data.memory?.total ?? "—" },
    { label: "Open incidents",     val: data.incidents?.open ?? "—", color: (data.incidents?.open ?? 0) > 0 ? C.warn : C.ok },
  ];

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 10, marginBottom: 20 }}>
        {cards.map(c => (
          <div key={c.label} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 6, padding: "10px 12px", textAlign: "center" }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: c.color || C.text }}>{c.val}</div>
            <div style={{ fontSize: 9, color: C.muted, marginTop: 3 }}>{c.label}</div>
          </div>
        ))}
      </div>

      {data.deployRisk && (
        <Section title="Deploy risk">
          <Row>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: C.text }}>{data.deployRisk.recommendation}</div>
              <div style={{ fontSize: 9, color: C.muted, marginTop: 3 }}>Risk score: {data.deployRisk.riskScore} · {data.deployRisk.riskLevel}</div>
              {data.deployRisk.riskFactors?.map((f, i) => (
                <div key={i} style={{ fontSize: 9, color: C.warn, marginTop: 2 }}>⚠ {f}</div>
              ))}
            </div>
            <Chip label={data.deployRisk.riskLevel} color={statusColor(data.deployRisk.riskLevel === "low" ? "ok" : data.deployRisk.riskLevel === "high" ? "fail" : "warn")} />
          </Row>
        </Section>
      )}

      {data.learning && (
        <Section title="Learning engine">
          {data.learning.topFixes?.length > 0 && (
            data.learning.topFixes.slice(0, 4).map((f, i) => (
              <Row key={i}>
                <span style={{ fontSize: 10, color: C.ok, width: 16 }}>#{i + 1}</span>
                <span style={{ fontSize: 11, color: C.text, flex: 1 }}>{typeof f === "string" ? f : JSON.stringify(f)}</span>
              </Row>
            ))
          )}
          {(!data.learning.topFixes || data.learning.topFixes.length === 0) && (
            <Row><span style={{ fontSize: 11, color: C.muted }}>No patterns learned yet — run engineering tasks to build the model.</span></Row>
          )}
        </Section>
      )}

      <div style={{ fontSize: 9, color: C.muted, textAlign: "right" }}>{data.generatedAt ? `Generated ${_ago(data.generatedAt)}` : ""}</div>
    </div>
  );
}

// ── Tab: Similar Fixes ────────────────────────────────────────────────

function TabSimilarFixes() {
  const [q, setQ]         = useState("");
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(null);

  async function search() {
    setLoading(true);
    try {
      const r = await _get(`/runtime/intel/similar-fixes?q=${encodeURIComponent(q)}&limit=20`);
      setResults(r);
    } catch { setResults(null); }
    finally { setLoading(false); }
    track("intel_similar_fixes");
  }

  useEffect(() => { search(); }, []); // load all on mount

  const items = results?.results || [];

  return (
    <div>
      <SearchInput value={q} onChange={setQ} onSearch={search} loading={loading} placeholder="Describe the problem — e.g. 'fix undefined variable in routes'…" />

      {loading ? [0,1,2,3].map(i => <div key={i} style={{ marginBottom: 6 }}><Skel /></div>) : (
        items.length === 0 ? <Empty title="No similar fixes found" sub="Try different keywords or run more engineering tasks." /> : (
          <Section title="Matches" count={results?.total}>
            {items.map((r, i) => {
              const isOpen = expanded === i;
              const col = typeColor(r.source);
              return (
                <div key={i}>
                  <Row onClick={() => setExpanded(isOpen ? null : i)}>
                    <div style={{ flex: "0 0 52px" }}>
                      <ScoreBar score={r.score} />
                    </div>
                    <Chip label={r.source.replace(/_/g, " ")} color={col} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.filePath || r.key || r.goalPattern || r.chain || r.fix || "(no label)"}
                      </div>
                      {r.reason && <div style={{ fontSize: 9, color: C.muted, marginTop: 1 }}>{r.reason}</div>}
                      {r.problem && <div style={{ fontSize: 9, color: C.muted, marginTop: 1 }}>{r.problem}</div>}
                    </div>
                    {r.status && <Chip label={r.status} color={statusColor(r.status)} />}
                    <span style={{ fontSize: 9, color: C.muted }}>{isOpen ? "▲" : "▼"}</span>
                  </Row>
                  {isOpen && (
                    <div style={{ padding: "8px 12px", background: "rgba(0,0,0,0.15)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                      {r.patchId   && <div style={{ fontSize: 9, color: C.muted, marginBottom: 3 }}>Patch ID: <span style={{ color: C.info, fontFamily: "monospace" }}>{r.patchId}</span></div>}
                      {r.key       && <div style={{ fontSize: 9, color: C.muted, marginBottom: 3 }}>Key: <span style={{ color: C.knowledge }}>{r.key}</span></div>}
                      {r.fix       && <div style={{ fontSize: 10, color: C.text, marginBottom: 4 }}><strong>Fix:</strong> {r.fix}</div>}
                      {r.preview   && <pre style={{ fontSize: 9, color: C.muted, whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 100, overflow: "auto", margin: 0 }}>{typeof r.preview === "string" ? r.preview : JSON.stringify(r.preview)}</pre>}
                      {r.confidence && <div style={{ fontSize: 9, color: C.muted, marginTop: 4 }}>Confidence: {r.confidence}% · Steps: {r.stepCount}</div>}
                      {r.ts && <div style={{ fontSize: 9, color: C.muted, marginTop: 2 }}>{_ago(r.ts)}</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </Section>
        )
      )}
    </div>
  );
}

// ── Tab: Pattern Ranking ──────────────────────────────────────────────

function TabPatterns() {
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView]     = useState("both");

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await _get(`/runtime/intel/pattern-ranking?type=${view}`)); }
    catch { setData(null); }
    finally { setLoading(false); }
    track("intel_patterns");
  }, [view]);

  useEffect(() => { load(); }, [load]);

  const success = data?.successPatterns || [];
  const failure = data?.failurePatterns || [];
  const knownFail = data?.knownFailurePatterns || [];
  const learnPat  = data?.learnPatterns || null;

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        {["both", "success", "failure"].map(v => (
          <button key={v} onClick={() => setView(v)}
            style={{ padding: "4px 12px", fontSize: 10, borderRadius: 3, cursor: "pointer", fontFamily: "inherit",
              background: view === v ? "rgba(68,162,255,0.15)" : "rgba(255,255,255,0.04)",
              border: `1px solid ${view === v ? "rgba(68,162,255,0.35)" : "rgba(255,255,255,0.09)"}`,
              color: view === v ? C.info : C.muted, fontWeight: view === v ? 700 : 400 }}>
            {v}
          </button>
        ))}
        <button onClick={load} disabled={loading}
          style={{ marginLeft: "auto", fontSize: 9, padding: "2px 8px", background: "none", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 3, cursor: "pointer", color: C.muted }}>
          {loading ? "…" : "⟳"}
        </button>
      </div>

      {loading ? [0,1,2,3].map(i => <div key={i} style={{ marginBottom: 6 }}><Skel /></div>) : (
        <>
          {(view === "both" || view === "success") && (
            <Section title="Success patterns" count={success.length}>
              {success.length === 0 ? <Row><span style={{ fontSize: 11, color: C.muted }}>No successful patches yet — apply patches to build this ranking.</span></Row> : (
                success.map((f, i) => (
                  <Row key={i}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, width: 20 }}>#{i + 1}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.file.split("/").slice(-2).join("/")}</div>
                      <div style={{ fontSize: 9, color: C.muted, marginTop: 1 }}>{f.applied} applied · {f.total} total</div>
                    </div>
                    <ScoreBar score={f.successRate ?? 0} />
                  </Row>
                ))
              )}
            </Section>
          )}

          {(view === "both" || view === "failure") && (
            <Section title="Failure hotspots (rollback count)" count={failure.length}>
              {failure.length === 0 ? <Row><span style={{ fontSize: 11, color: C.muted }}>No rollbacks recorded.</span></Row> : (
                failure.map((f, i) => (
                  <Row key={i}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, width: 20 }}>#{i + 1}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.file.split("/").slice(-2).join("/")}</div>
                      <div style={{ fontSize: 9, color: C.muted, marginTop: 1 }}>{f.rolled_back} rollbacks · {f.total} total</div>
                    </div>
                    <Chip label={`${f.rolled_back}↩`} color={C.fail} />
                  </Row>
                ))
              )}
            </Section>
          )}

          {knownFail.length > 0 && (
            <Section title="Known failure patterns">
              {knownFail.map((p, i) => (
                <Row key={i}>
                  <Chip label={p.riskLevel} color={p.riskLevel === "critical" ? C.fail : p.riskLevel === "high" ? C.warn : C.muted} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: C.text }}>{p.rootCause}</div>
                    <div style={{ fontSize: 9, color: C.muted, marginTop: 1 }}>{p.id}{p.recovery ? ` · recovery: ${p.recovery}` : ""}</div>
                  </div>
                </Row>
              ))}
            </Section>
          )}

          {learnPat && (learnPat.incidentPatterns?.length > 0 || learnPat.fixPatterns?.length > 0) && (
            <Section title="Learned patterns">
              {learnPat.fixPatterns?.slice(0, 5).map((p, i) => (
                <Row key={i}>
                  <span style={{ fontSize: 10, color: C.ok }}>✓</span>
                  <span style={{ fontSize: 11, color: C.text, flex: 1 }}>{typeof p === "string" ? p : JSON.stringify(p)}</span>
                </Row>
              ))}
            </Section>
          )}
        </>
      )}
    </div>
  );
}

// ── Tab: Recommend ────────────────────────────────────────────────────

function TabRecommend() {
  const [desc, setDesc]         = useState("");
  const [filePath, setFilePath] = useState("");
  const [data, setData]         = useState(null);
  const [loading, setLoading]   = useState(false);
  const [expanded, setExpanded] = useState(null);

  async function recommend() {
    if (!desc.trim() && !filePath.trim()) return;
    setLoading(true);
    try { setData(await _post("/runtime/intel/recommend-patch", { description: desc, filePath, limit: 10 })); }
    catch { setData(null); }
    finally { setLoading(false); }
    track("intel_recommend");
  }

  const recs = data?.recommendations || [];

  return (
    <div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
        <textarea value={desc} onChange={e => setDesc(e.target.value)}
          placeholder="Describe what you want to fix or change…"
          rows={2}
          style={{ padding: "7px 10px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 5, color: C.head, fontSize: 12, fontFamily: "inherit", resize: "vertical" }} />
        <div style={{ display: "flex", gap: 8 }}>
          <input value={filePath} onChange={e => setFilePath(e.target.value)}
            placeholder="File path (optional) — e.g. backend/routes/runtime.js"
            style={{ flex: 1, padding: "6px 10px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 5, color: C.head, fontSize: 11, fontFamily: "inherit" }} />
          <button onClick={recommend} disabled={loading || (!desc.trim() && !filePath.trim())}
            style={{ padding: "6px 16px", background: "rgba(68,162,255,0.15)", border: "1px solid rgba(68,162,255,0.3)", borderRadius: 5, color: C.info, fontSize: 11, cursor: "pointer", fontWeight: 600, fontFamily: "inherit" }}>
            {loading ? "…" : "Get Recommendations"}
          </button>
        </div>
      </div>

      {loading ? [0,1,2,3].map(i => <div key={i} style={{ marginBottom: 6 }}><Skel /></div>) : (
        recs.length === 0 ? (
          data ? <Empty title="No recommendations found" sub="Try a different description or file path." /> :
          <Empty icon="⬡" title="Enter a description to get patch recommendations" sub="The engine searches patch history, knowledge base, and engineering memory." />
        ) : (
          <Section title="Recommendations" count={data?.total}>
            {recs.map((r, i) => {
              const isOpen = expanded === i;
              const col = typeColor(r.source);
              return (
                <div key={i}>
                  <Row onClick={() => setExpanded(isOpen ? null : i)}>
                    <div style={{ flex: "0 0 52px" }}><ScoreBar score={r.score} /></div>
                    <Chip label={r.source.replace(/_/g, " ")} color={col} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.filePath || r.key || r.chain || r.fix?.slice(0, 60) || "(no label)"}
                      </div>
                      {r.reason && <div style={{ fontSize: 9, color: C.muted, marginTop: 1 }}>{r.reason}</div>}
                      {r.problem && <div style={{ fontSize: 9, color: C.muted, marginTop: 1 }}>{r.problem}</div>}
                    </div>
                    {r.status && <Chip label={r.status} color={statusColor(r.status)} />}
                    <span style={{ fontSize: 9, color: C.muted }}>{isOpen ? "▲" : "▼"}</span>
                  </Row>
                  {isOpen && (
                    <div style={{ padding: "8px 12px", background: "rgba(0,0,0,0.15)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                      {r.fix        && <div style={{ fontSize: 10, color: C.text, marginBottom: 4 }}><strong>Recommended fix:</strong> {r.fix}</div>}
                      {r.preview    && <pre style={{ fontSize: 9, color: C.muted, whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 100, overflow: "auto", margin: "0 0 4px", fontFamily: "monospace" }}>{typeof r.preview === "string" ? r.preview : JSON.stringify(r.preview)}</pre>}
                      {r.patchId    && <div style={{ fontSize: 9, color: C.muted }}>Patch: <span style={{ fontFamily: "monospace", color: C.info }}>{r.patchId}</span></div>}
                      {r.confidence && <div style={{ fontSize: 9, color: C.muted, marginTop: 2 }}>Confidence: {r.confidence}%</div>}
                      {r.proposedAt && <div style={{ fontSize: 9, color: C.muted, marginTop: 2 }}>{_ago(r.proposedAt)}</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </Section>
        )
      )}
    </div>
  );
}

// ── Tab: Incident KB ──────────────────────────────────────────────────

function TabIncidentKB() {
  const [q, setQ]           = useState("");
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(null);

  const load = useCallback(async (query = q) => {
    setLoading(true);
    try { setData(await _get(`/runtime/intel/incident-kb?q=${encodeURIComponent(query)}&limit=20`)); }
    catch { setData(null); }
    finally { setLoading(false); }
    track("intel_incident_kb");
  }, [q]);

  useEffect(() => { load(""); }, []);

  const incidents    = data?.incidents     || [];
  const knownPat     = data?.knownPatterns || [];
  const topIncidents = data?.topIncidents  || [];
  const topCauses    = data?.topCauses     || [];
  const topFixes     = data?.topFixes      || [];
  const rcaReports   = data?.rcaReports    || [];

  return (
    <div>
      <SearchInput value={q} onChange={setQ} onSearch={() => load(q)} loading={loading} placeholder="Search incident KB — type, severity, service, message…" />

      {loading ? [0,1,2,3].map(i => <div key={i} style={{ marginBottom: 6 }}><Skel /></div>) : (
        <>
          {/* Known failure patterns always shown */}
          {knownPat.length > 0 && (
            <Section title="Known failure patterns" count={knownPat.length}>
              {knownPat.map((p, i) => (
                <Row key={i}>
                  <Chip label={p.riskLevel} color={p.riskLevel === "critical" ? C.fail : p.riskLevel === "high" ? C.warn : C.muted} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: C.text, fontWeight: 600 }}>{p.rootCause}</div>
                    <div style={{ fontSize: 9, color: C.muted, marginTop: 1 }}>Pattern: {p.id}{p.recovery ? ` · fix: ${p.recovery}` : ""}</div>
                  </div>
                </Row>
              ))}
            </Section>
          )}

          {/* Live incidents */}
          {incidents.length > 0 && (
            <Section title="Incidents" count={incidents.length}>
              {incidents.map((inc, i) => {
                const isOpen = expanded === `inc-${i}`;
                const sev = inc.severity?.toLowerCase();
                const col = sev === "critical" ? C.fail : sev === "high" ? C.warn : sev === "medium" ? C.info : C.muted;
                return (
                  <div key={i}>
                    <Row onClick={() => setExpanded(isOpen ? null : `inc-${i}`)}>
                      <Chip label={inc.severity || "?"} color={col} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {inc.title || inc.message || inc.type || inc.id}
                        </div>
                        <div style={{ fontSize: 9, color: C.muted, marginTop: 1 }}>{inc.service || "—"} · {_ago(inc.detectedAt || inc.ts)}</div>
                      </div>
                      <Chip label={inc.status || "open"} color={statusColor(inc.status)} />
                      <span style={{ fontSize: 9, color: C.muted }}>{isOpen ? "▲" : "▼"}</span>
                    </Row>
                    {isOpen && (
                      <div style={{ padding: "8px 12px", background: "rgba(0,0,0,0.15)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                        {inc.description && <p style={{ fontSize: 10, color: C.muted, margin: "0 0 6px" }}>{inc.description}</p>}
                        {inc.rca && <div style={{ fontSize: 10, color: C.text }}><strong>RCA:</strong> {typeof inc.rca === "string" ? inc.rca : JSON.stringify(inc.rca)}</div>}
                        {inc.autoFixPlanId && <div style={{ fontSize: 9, color: C.info, marginTop: 3 }}>Plan: {inc.autoFixPlanId}</div>}
                      </div>
                    )}
                  </div>
                );
              })}
            </Section>
          )}

          {/* RCA reports */}
          {rcaReports.length > 0 && (
            <Section title="RCA reports" count={rcaReports.length}>
              {rcaReports.map((r, i) => (
                <Row key={i}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: C.text }}>{r.title || r.rootCause || r.id || "report"}</div>
                    <div style={{ fontSize: 9, color: C.muted, marginTop: 1 }}>{_ago(r.ts)}</div>
                  </div>
                </Row>
              ))}
            </Section>
          )}

          {/* Learning engine patterns */}
          {(topCauses.length > 0 || topFixes.length > 0) && (
            <Section title="Learned causes + fixes">
              {topCauses.slice(0, 4).map((c, i) => (
                <Row key={`cause-${i}`}>
                  <span style={{ fontSize: 10, color: C.warn, width: 16 }}>⚡</span>
                  <span style={{ fontSize: 11, color: C.text, flex: 1 }}>{typeof c === "string" ? c : JSON.stringify(c)}</span>
                </Row>
              ))}
              {topFixes.slice(0, 4).map((f, i) => (
                <Row key={`fix-${i}`}>
                  <span style={{ fontSize: 10, color: C.ok, width: 16 }}>✓</span>
                  <span style={{ fontSize: 11, color: C.text, flex: 1 }}>{typeof f === "string" ? f : JSON.stringify(f)}</span>
                </Row>
              ))}
            </Section>
          )}

          {incidents.length === 0 && rcaReports.length === 0 && (
            <Empty icon="✓" title="No incidents in the knowledge base" sub="Incidents appear here as they are detected and resolved." />
          )}
        </>
      )}
    </div>
  );
}

// ── Tab: Engineering Search ───────────────────────────────────────────

const SCOPES = ["all", "patches", "history", "memory", "knowledge", "incidents"];

function TabSearch() {
  const [q, setQ]           = useState("");
  const [scope, setScope]   = useState("all");
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(null);

  async function search() {
    if (!q.trim()) return;
    setLoading(true);
    try { setData(await _get(`/runtime/intel/search?q=${encodeURIComponent(q)}&scope=${scope}&limit=30`)); }
    catch { setData(null); }
    finally { setLoading(false); }
    track("intel_search");
  }

  const results = data?.results || [];

  return (
    <div>
      <SearchInput value={q} onChange={setQ} onSearch={search} loading={loading} placeholder="Search across patches, history, memory, knowledge, incidents…" />

      <div style={{ display: "flex", gap: 5, marginBottom: 14, flexWrap: "wrap" }}>
        {SCOPES.map(s => (
          <button key={s} onClick={() => setScope(s)}
            style={{ padding: "3px 10px", fontSize: 9, borderRadius: 3, cursor: "pointer", fontFamily: "inherit",
              background: scope === s ? "rgba(68,162,255,0.15)" : "rgba(255,255,255,0.04)",
              border: `1px solid ${scope === s ? "rgba(68,162,255,0.35)" : "rgba(255,255,255,0.09)"}`,
              color: scope === s ? C.info : C.muted }}>
            {s}
          </button>
        ))}
      </div>

      {!data && !loading && <Empty icon="⌕" title="Enter a query to search" sub="Searches patches, execution history, memory, knowledge base, and incidents." />}

      {loading ? [0,1,2,3,4].map(i => <div key={i} style={{ marginBottom: 6 }}><Skel /></div>) : (
        data && (
          results.length === 0 ? <Empty title="No results" sub={`No matches for "${q}" in ${scope}.`} /> : (
            <Section title={`Results for "${q}"`} count={data.total}>
              {results.map((r, i) => {
                const isOpen = expanded === i;
                const col = typeColor(r.type);
                return (
                  <div key={i}>
                    <Row onClick={() => setExpanded(isOpen ? null : i)}>
                      <div style={{ flex: "0 0 52px" }}><ScoreBar score={r.score} /></div>
                      <Chip label={r.type} color={col} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title || r.id}</div>
                        {r.subtitle && <div style={{ fontSize: 9, color: C.muted, marginTop: 1 }}>{r.subtitle}</div>}
                      </div>
                      {r.status && <Chip label={r.status} color={statusColor(r.status)} />}
                      <span style={{ fontSize: 9, color: C.muted }}>{_ago(r.ts)}</span>
                      <span style={{ fontSize: 9, color: C.muted }}>{isOpen ? "▲" : "▼"}</span>
                    </Row>
                    {isOpen && (
                      <div style={{ padding: "8px 12px", background: "rgba(0,0,0,0.15)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                        {r.meta && <pre style={{ fontSize: 9, color: C.muted, whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 120, overflow: "auto", margin: 0 }}>{JSON.stringify(r.meta, null, 2).slice(0, 600)}</pre>}
                      </div>
                    )}
                  </div>
                );
              })}
            </Section>
          )
        )
      )}
    </div>
  );
}

// ── Tab: Cross-Execution Correlation ─────────────────────────────────

function TabCorrelate() {
  const [execId, setExecId]   = useState("");
  const [input, setInput]     = useState("");
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(null);

  async function correlate() {
    if (!execId.trim() && !input.trim()) return;
    setLoading(true);
    const qs = execId.trim()
      ? `executionId=${encodeURIComponent(execId.trim())}`
      : `input=${encodeURIComponent(input.trim())}`;
    try { setData(await _get(`/runtime/intel/correlate?${qs}&limit=15`)); }
    catch (e) { setData({ error: e.message }); }
    finally { setLoading(false); }
    track("intel_correlate");
  }

  const correlated    = data?.correlated     || [];
  const relatedPatches = data?.relatedPatches || [];

  return (
    <div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
        <input value={execId} onChange={e => setExecId(e.target.value)}
          placeholder="Execution ID (optional) — paste from history"
          style={{ padding: "7px 10px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 5, color: C.head, fontSize: 11, fontFamily: "inherit" }} />
        <div style={{ fontSize: 9, color: C.muted, textAlign: "center" }}>— or —</div>
        <div style={{ display: "flex", gap: 8 }}>
          <input value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && correlate()}
            placeholder="Task description to find correlations…"
            style={{ flex: 1, padding: "7px 10px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 5, color: C.head, fontSize: 11, fontFamily: "inherit" }} />
          <button onClick={correlate} disabled={loading || (!execId.trim() && !input.trim())}
            style={{ padding: "7px 16px", background: "rgba(68,162,255,0.15)", border: "1px solid rgba(68,162,255,0.3)", borderRadius: 5, color: C.info, fontSize: 11, cursor: "pointer", fontWeight: 600, fontFamily: "inherit" }}>
            {loading ? "…" : "Correlate"}
          </button>
        </div>
      </div>

      {data?.error && <div style={{ fontSize: 11, color: C.fail, marginBottom: 10 }}>{data.error}</div>}

      {data?.anchor && (
        <div style={{ marginBottom: 14, padding: "8px 12px", background: "rgba(68,162,255,0.06)", border: "1px solid rgba(68,162,255,0.15)", borderRadius: 5 }}>
          <div style={{ fontSize: 9, color: C.info, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>Anchor execution</div>
          <div style={{ fontSize: 11, color: C.text }}>{data.anchor.input || data.anchor.executionId}</div>
          <div style={{ fontSize: 9, color: C.muted, marginTop: 2 }}>{data.anchor.agentId || "—"} · {_ago(data.anchor.ts)}</div>
        </div>
      )}

      {loading ? [0,1,2,3].map(i => <div key={i} style={{ marginBottom: 6 }}><Skel /></div>) : (
        <>
          {correlated.length > 0 && (
            <Section title="Correlated executions" count={data?.total}>
              {correlated.map((r, i) => {
                const isOpen = expanded === i;
                return (
                  <div key={i}>
                    <Row onClick={() => setExpanded(isOpen ? null : i)}>
                      <div style={{ flex: "0 0 52px" }}><ScoreBar score={r.score} /></div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.input || r.executionId}</div>
                        <div style={{ fontSize: 9, color: C.muted, marginTop: 1 }}>{r.agentId || "—"} · {r.sharedWords} shared word{r.sharedWords !== 1 ? "s" : ""}</div>
                      </div>
                      <Chip label={r.success === false ? "failed" : "ok"} color={r.success === false ? C.fail : C.ok} />
                      <span style={{ fontSize: 9, color: C.muted }}>{_ago(r.ts)}</span>
                      <span style={{ fontSize: 9, color: C.muted }}>{isOpen ? "▲" : "▼"}</span>
                    </Row>
                    {isOpen && r.error && (
                      <div style={{ padding: "6px 12px", background: "rgba(0,0,0,0.15)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                        <span style={{ fontSize: 9, color: C.fail }}>Error: {r.error}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </Section>
          )}

          {relatedPatches.length > 0 && (
            <Section title="Related patches">
              {relatedPatches.map((p, i) => (
                <Row key={i}>
                  <Chip label={p.status} color={statusColor(p.status)} />
                  <span style={{ fontSize: 11, color: C.text, flex: 1, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.filePath || p.patchId?.slice(0, 16)}</span>
                  <span style={{ fontSize: 9, color: C.muted }}>{_ago(p.proposedAt)}</span>
                </Row>
              ))}
            </Section>
          )}

          {data && !data.error && correlated.length === 0 && relatedPatches.length === 0 && (
            <Empty title="No correlations found" sub="Build execution history by running more engineering tasks." />
          )}

          {!data && !loading && (
            <Empty icon="⊗" title="Cross-execution correlation" sub="Enter an execution ID or task description to find related executions, shared error patterns, and correlated patches." />
          )}
        </>
      )}
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────

const TABS = [
  { id: "summary",  label: "Summary"        },
  { id: "fixes",    label: "Similar Fixes"  },
  { id: "patterns", label: "Patterns"       },
  { id: "recommend",label: "Recommend"      },
  { id: "kb",       label: "Incident KB"    },
  { id: "search",   label: "Search"         },
  { id: "correlate",label: "Correlate"      },
];

export default function IntelligencePanel({ onNavigate }) {
  const [tab, setTab] = useState("summary");

  useEffect(() => { track("intelligence_panel_viewed"); }, []);

  return (
    <div style={{ minHeight: "100vh", background: "#0d1117", color: C.text, fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <style>{`
        @keyframes ip-pulse { 0%,100%{opacity:0.4} 50%{opacity:0.8} }
      `}</style>
      <PageHeader
        icon="◈"
        title="Engineering Intelligence"
        subtitle="Learning → Recommendation — similar fixes, pattern ranking, incident KB, unified search, correlation"
        related={[
          { label: "Prediction", tab: "predict", icon: "◇" },
          { label: "Memory", tab: "memory", icon: "◎" },
          { label: "Recommendation", tab: "recommend", icon: "✦" },
          { label: "Guardrails", tab: "guardrails", icon: "◻" },
          { label: "Self-Improve", tab: "selfimprove", icon: "⬡" },
        ]}
        onNavigate={onNavigate}
      />
      <WorkflowNav currentTab="intel" onNavigate={onNavigate} />
      <div style={{ padding: "16px 24px 0" }}>

        <div style={{ display: "flex", gap: 2, borderBottom: "1px solid rgba(255,255,255,0.08)", overflowX: "auto" }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ padding: "8px 14px", fontSize: 11, fontWeight: 600, cursor: "pointer",
                background: "none", border: "none",
                borderBottom: tab === t.id ? "2px solid #44a2ff" : "2px solid transparent",
                color: tab === t.id ? C.info : C.muted,
                marginBottom: -1, whiteSpace: "nowrap", fontFamily: "inherit" }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: "20px 24px 40px" }}>
        {tab === "summary"   && <TabSummary />}
        {tab === "fixes"     && <TabSimilarFixes />}
        {tab === "patterns"  && <TabPatterns />}
        {tab === "recommend" && <TabRecommend />}
        {tab === "kb"        && <TabIncidentKB />}
        {tab === "search"    && <TabSearch />}
        {tab === "correlate" && <TabCorrelate />}
      </div>
    </div>
  );
}
