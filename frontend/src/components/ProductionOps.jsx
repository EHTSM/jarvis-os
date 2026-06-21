// CO1 Production Infrastructure — ProductionOps.jsx
import React, { useState, useCallback, useEffect } from "react";
import "./ProductionOps.css";

const BASE = process.env.REACT_APP_API_URL || "";
const api  = (path, opts = {}) =>
  fetch(`${BASE}${path}`, { credentials: "include", ...opts }).then(r => r.json());

function useOps(path, deps = []) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => {
    setLoading(true);
    api(path).then(r => { setData(r); setLoading(false); }).catch(() => setLoading(false));
  }, [path]);
  useEffect(() => { load(); }, [...deps, load]);
  return { data, loading, reload: load };
}

function useToast() {
  const [msg, setMsg] = useState("");
  const toast = (m) => { setMsg(m); setTimeout(() => setMsg(""), 2800); };
  const el    = msg ? <span className="po-toast">{msg}</span> : null;
  return [toast, el];
}

const score_color = (s) =>
  s >= 90 ? "var(--po-green)" : s >= 70 ? "var(--po-teal)" : s >= 50 ? "var(--po-yellow)" : "var(--po-red)";

function ScoreBar({ label, score }) {
  const c = score_color(score ?? 0);
  return (
    <div className="po-score-row">
      <span className="po-score-label">{label}</span>
      <div className="po-score-track"><div className="po-score-fill" style={{ width: `${score ?? 0}%`, background: c }} /></div>
      <span className="po-score-val" style={{ color: c }}>{score ?? "–"}%</span>
    </div>
  );
}

function StatusChip({ status }) {
  const map = {
    pass: ["po-chip-green", "PASS"],
    present: ["po-chip-green", "OK"],
    complete: ["po-chip-green", "DONE"],
    fail: ["po-chip-red", "FAIL"],
    missing: ["po-chip-red", "MISSING"],
    warn: ["po-chip-yellow", "WARN"],
    unknown: ["po-chip-gray", "?"],
    stub: ["po-chip-yellow", "STUB"],
    optional: ["po-chip-gray", "OPT"],
  };
  const [cls, label] = map[status] || ["po-chip-gray", status];
  return <span className={`po-chip ${cls}`}>{label}</span>;
}

// ── M1: GitHub ────────────────────────────────────────────────────────────────
function GitHubPanel() {
  const { data, loading, reload } = useOps("/ops/infra/github", []);
  if (loading) return <div className="po-loading">Auditing GitHub configuration…</div>;
  if (!data?.ok) return <div className="po-loading">Error loading GitHub audit</div>;
  return (
    <div>
      <div className="po-section-hdr">
        <div className="po-section-title">Production GitHub</div>
        <ScoreBar label="" score={data.score} />
        <button className="po-btn-sm" onClick={reload}>Refresh</button>
      </div>
      <div className="po-card">
        <div className="po-card-title">Repository Files</div>
        <div className="po-list">
          {data.files?.map(f => (
            <div key={f.path} className={`po-row ${f.exists ? "po-row-pass" : f.required ? "po-row-fail" : "po-row-unknown"}`}>
              <div className="po-row-body">
                <div className="po-row-name">{f.label}</div>
                <div className="po-row-meta">{f.path}</div>
              </div>
              <StatusChip status={f.exists ? "present" : f.required ? "missing" : "optional"} />
            </div>
          ))}
        </div>
      </div>
      <div className="po-card">
        <div className="po-card-title">Branch Strategy</div>
        {Object.entries(data.branchStrategy || {}).map(([k, v]) => (
          <div key={k} className="po-kv-row">
            <span className="po-kv-key">{k.replace(/([A-Z])/g, " $1").trim()}</span>
            <span className="po-kv-val" style={{ maxWidth: 400, textAlign: "right", color: "var(--po-muted)" }}>{v}</span>
          </div>
        ))}
      </div>
      {data.missingRequired?.length > 0 && (
        <div className="po-card" style={{ borderColor: "rgba(239,68,68,.3)" }}>
          <div className="po-card-title" style={{ color: "var(--po-red)" }}>Missing Required Files</div>
          {data.missingRequired.map(f => (
            <div key={f.path} className="po-row po-row-fail">
              <span className="po-row-name">{f.path}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── M2: VPS ───────────────────────────────────────────────────────────────────
function VPSPanel() {
  const { data, loading, reload } = useOps("/ops/infra/vps", []);
  if (loading) return <div className="po-loading">Auditing VPS configuration…</div>;
  if (!data?.ok) return <div className="po-loading">Error loading VPS audit</div>;
  const byCategory = {};
  for (const c of (data.checks || [])) {
    if (!byCategory[c.category]) byCategory[c.category] = [];
    byCategory[c.category].push(c);
  }
  const statusClass = { pass: "po-row-pass", fail: "po-row-fail", warn: "po-row-warn", unknown: "po-row-unknown" };
  return (
    <div>
      <div className="po-section-hdr">
        <div className="po-section-title">Production VPS</div>
        <ScoreBar label="" score={data.score} />
        <button className="po-btn-sm" onClick={reload}>Refresh</button>
      </div>
      <div className="po-stats-grid">
        <div className="po-stat-card"><div className="po-stat-val" style={{ color: score_color(data.score) }}>{data.score}%</div><div className="po-stat-lbl">VPS Score</div></div>
        <div className="po-stat-card"><div className="po-stat-val">{data.critical?.passed}/{data.critical?.total}</div><div className="po-stat-lbl">Critical Passed</div></div>
        <div className="po-stat-card"><div className="po-stat-val" style={{ color: data.ready ? "var(--po-green)" : "var(--po-yellow)" }}>{data.ready ? "OK" : "REVIEW"}</div><div className="po-stat-lbl">Status</div></div>
      </div>
      {Object.entries(byCategory).map(([cat, items]) => (
        <div key={cat} className="po-cat-group">
          <div className="po-cat-hdr">{cat.toUpperCase()}</div>
          <div className="po-list">
            {items.map(c => (
              <div key={c.id} className={`po-row ${statusClass[c.status] || "po-row-unknown"}`}>
                <div className="po-row-body">
                  <div className="po-row-name">{c.label}</div>
                  {c.critical && <span className="po-chip po-chip-red" style={{ fontSize: 9 }}>CRITICAL</span>}
                </div>
                <StatusChip status={c.status} />
              </div>
            ))}
          </div>
        </div>
      ))}
      <div className="po-card" style={{ marginTop: 8 }}>
        <div className="po-card-title">Self-Report</div>
        <div className="po-row-meta" style={{ color: "var(--po-muted)", fontSize: 11 }}>
          Unknown items require self-certification. Mark items complete after verifying on your VPS:
          <br /><code style={{ fontSize: 10, color: "var(--po-teal)" }}>POST /ops/infra/vps/update</code> with a JSON body of check IDs set to true.
        </div>
      </div>
    </div>
  );
}

// ── M3: Environment ───────────────────────────────────────────────────────────
function EnvironmentPanel() {
  const { data, loading, reload } = useOps("/ops/infra/environment", []);
  if (loading) return <div className="po-loading">Auditing environment variables…</div>;
  if (!data?.ok) return <div className="po-loading">Error loading environment audit</div>;
  const required = (data.checks || []).filter(c => c.required);
  const optional = (data.checks || []).filter(c => !c.required);
  return (
    <div>
      <div className="po-section-hdr">
        <div className="po-section-title">Production Environment</div>
        <ScoreBar label="" score={data.score} />
        <button className="po-btn-sm" onClick={reload}>Refresh</button>
      </div>
      <div className="po-stats-grid">
        <div className="po-stat-card"><div className="po-stat-val" style={{ color: score_color(data.score) }}>{data.score}%</div><div className="po-stat-lbl">Env Score</div></div>
        <div className="po-stat-card"><div className="po-stat-val">{data.requiredPassing}/{data.requiredTotal}</div><div className="po-stat-lbl">Required Set</div></div>
        <div className="po-stat-card"><div className="po-stat-val" style={{ color: data.ready ? "var(--po-green)" : "var(--po-red)" }}>{data.ready ? "READY" : "GAPS"}</div><div className="po-stat-lbl">Status</div></div>
      </div>
      <div className="po-sub-title">Required Variables</div>
      <div className="po-list">
        {required.map(c => (
          <div key={c.key} className={`po-row ${c.ok ? "po-row-pass" : "po-row-fail"}`}>
            <div className="po-row-body">
              <div className="po-row-name" style={{ fontFamily: "monospace" }}>{c.key}</div>
              <div className="po-row-meta">{c.label}{c.issue ? ` — ⚠ ${c.issue}` : ""}</div>
            </div>
            <span className={`po-chip ${c.ok ? "po-chip-green" : "po-chip-red"}`}>{c.ok ? "OK" : "FAIL"}</span>
          </div>
        ))}
      </div>
      {optional.length > 0 && <>
        <div className="po-sub-title">Optional Variables</div>
        <div className="po-list">
          {optional.map(c => (
            <div key={c.key} className={`po-row ${c.ok ? "po-row-pass" : "po-row-unknown"}`}>
              <div className="po-row-body">
                <div className="po-row-name" style={{ fontFamily: "monospace" }}>{c.key}</div>
                <div className="po-row-meta">{c.label}</div>
              </div>
              <span className={`po-chip ${c.set ? "po-chip-green" : "po-chip-gray"}`}>{c.set ? "SET" : "UNSET"}</span>
            </div>
          ))}
        </div>
      </>}
    </div>
  );
}

// ── M4: Database ──────────────────────────────────────────────────────────────
function DatabasePanel() {
  const { data, loading, reload } = useOps("/ops/infra/database", []);
  if (loading) return <div className="po-loading">Auditing database…</div>;
  if (!data?.ok) return <div className="po-loading">Error loading database audit</div>;
  return (
    <div>
      <div className="po-section-hdr">
        <div className="po-section-title">Production Database</div>
        <button className="po-btn-sm" onClick={reload}>Refresh</button>
      </div>
      <div className="po-stats-grid">
        <div className="po-stat-card"><div className="po-stat-val" style={{ color: score_color(data.integrityScore) }}>{data.integrityScore}%</div><div className="po-stat-lbl">Integrity</div></div>
        <div className="po-stat-card"><div className="po-stat-val">{data.validFiles}/{data.dataFiles}</div><div className="po-stat-lbl">Valid Files</div></div>
        <div className="po-stat-card"><div className="po-stat-val">{data.totalSizeKB}KB</div><div className="po-stat-lbl">Total Size</div></div>
        <div className="po-stat-card"><div className="po-stat-val" style={{ color: data.backupCount > 0 ? "var(--po-green)" : "var(--po-red)" }}>{data.backupCount}</div><div className="po-stat-lbl">Backups</div></div>
        <div className="po-stat-card"><div className="po-stat-val" style={{ color: data.ready ? "var(--po-green)" : "var(--po-red)" }}>{data.ready ? "OK" : "ISSUE"}</div><div className="po-stat-lbl">Status</div></div>
      </div>
      {data.invalidFiles?.length > 0 && (
        <div className="po-card" style={{ borderColor: "rgba(239,68,68,.3)" }}>
          <div className="po-card-title" style={{ color: "var(--po-red)" }}>Invalid JSON Files</div>
          {data.invalidFiles.map(f => <div key={f.file} className="po-row po-row-fail"><span className="po-row-name">{f.file}</span></div>)}
        </div>
      )}
      {data.latestBackup && (
        <div className="po-card">
          <div className="po-card-title">Latest Backup</div>
          <div className="po-kv-row"><span className="po-kv-key">File</span><span className="po-kv-val" style={{ color: "var(--po-muted)", fontFamily: "monospace", fontSize: 10 }}>{data.latestBackup.file}</span></div>
          <div className="po-kv-row"><span className="po-kv-key">Size</span><span className="po-kv-val">{data.latestBackup.sizeKB}KB</span></div>
          <div className="po-kv-row"><span className="po-kv-key">Created</span><span className="po-kv-val" style={{ color: "var(--po-muted)" }}>{new Date(data.latestBackup.createdAt).toLocaleString()}</span></div>
        </div>
      )}
      {data.backups?.length > 0 && (
        <div className="po-card">
          <div className="po-card-title">Backup History</div>
          {data.backups.map(b => (
            <div key={b.file} className="po-row po-row-pass">
              <div className="po-row-body">
                <div className="po-row-name" style={{ fontFamily: "monospace", fontSize: 10 }}>{b.file}</div>
                <div className="po-row-meta">{b.sizeKB}KB · {new Date(b.createdAt).toLocaleString()}</div>
              </div>
              <span className="po-chip po-chip-green">BACKUP</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── M5: Monitoring ────────────────────────────────────────────────────────────
function MonitoringPanel() {
  const { data, loading, reload } = useOps("/ops/infra/monitoring", []);
  if (loading) return <div className="po-loading">Checking monitoring stack…</div>;
  if (!data?.ok) return <div className="po-loading">Error loading monitoring</div>;
  const statusClass = { pass: "po-row-pass", fail: "po-row-fail", warn: "po-row-warn" };
  return (
    <div>
      <div className="po-section-hdr">
        <div className="po-section-title">Monitoring</div>
        <ScoreBar label="" score={data.score} />
        <button className="po-btn-sm" onClick={reload}>Refresh</button>
      </div>
      <div className="po-stats-grid">
        {Object.entries(data.features || {}).map(([k, v]) => (
          <div key={k} className="po-stat-card">
            <div className="po-stat-val" style={{ color: v ? "var(--po-green)" : "var(--po-red)", fontSize: 14 }}>{v ? "✓" : "✗"}</div>
            <div className="po-stat-lbl">{k.replace(/([A-Z])/g, " $1").trim()}</div>
          </div>
        ))}
      </div>
      <div className="po-card">
        <div className="po-card-title">Monitoring Components</div>
        <div className="po-list">
          {(data.checks || []).map(c => (
            <div key={c.id} className={`po-row ${statusClass[c.status] || "po-row-unknown"}`}>
              <div className="po-row-body">
                <div className="po-row-name">{c.label}</div>
                {c.file && <div className="po-row-meta" style={{ fontFamily: "monospace", fontSize: 10 }}>{c.file}</div>}
              </div>
              <StatusChip status={c.status} />
            </div>
          ))}
        </div>
      </div>
      {data.recentLogs?.length > 0 && (
        <div className="po-card">
          <div className="po-card-title">Log Files</div>
          {data.recentLogs.map(l => (
            <div key={l.file} className="po-kv-row">
              <span className="po-kv-key" style={{ fontFamily: "monospace" }}>{l.file}</span>
              <span className="po-kv-val" style={{ color: "var(--po-muted)" }}>{l.sizeKB}KB</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── M6: Security ──────────────────────────────────────────────────────────────
function SecurityPanel() {
  const [toast, toastEl] = useToast();
  const { data, loading, reload } = useOps("/ops/infra/security/run", []);
  const runAudit = () => {
    api("/ops/infra/security/run").then(() => { reload(); toast("Security audit complete"); });
  };
  if (loading) return <div className="po-loading">Running security audit…</div>;
  if (!data?.ok) return <div className="po-loading">Error loading security audit</div>;
  const gradeColor = { A: "var(--po-green)", B: "var(--po-teal)", C: "var(--po-yellow)", D: "var(--po-red)" };
  const byCategory = {};
  for (const c of (data.checks || [])) {
    if (!byCategory[c.category]) byCategory[c.category] = [];
    byCategory[c.category].push(c);
  }
  return (
    <div>
      <div className="po-section-hdr">
        <div className="po-section-title">Security Audit</div>
        {toastEl}
        <button className="po-btn" onClick={runAudit}>Run Audit</button>
      </div>
      <div className="po-stats-grid">
        <div className="po-stat-card"><div className="po-stat-val" style={{ color: gradeColor[data.grade] || "var(--po-accent)" }}>{data.grade}</div><div className="po-stat-lbl">Grade</div></div>
        <div className="po-stat-card"><div className="po-stat-val" style={{ color: score_color(data.score) }}>{data.score}%</div><div className="po-stat-lbl">Score</div></div>
        <div className="po-stat-card"><div className="po-stat-val">{data.critical?.passing}/{data.critical?.total}</div><div className="po-stat-lbl">Critical Pass</div></div>
        <div className="po-stat-card"><div className="po-stat-val" style={{ color: data.ready ? "var(--po-green)" : "var(--po-red)" }}>{data.ready ? "PASS" : "FAIL"}</div><div className="po-stat-lbl">Status</div></div>
      </div>
      {Object.entries(byCategory).map(([cat, items]) => (
        <div key={cat} className="po-cat-group">
          <div className="po-cat-hdr">{cat.toUpperCase()}</div>
          <div className="po-list">
            {items.map(c => (
              <div key={c.id} className={`po-row ${c.pass ? "po-row-pass" : c.critical ? "po-row-fail" : "po-row-warn"}`}>
                <div className="po-row-body">
                  <div className="po-row-name">{c.label}</div>
                  {c.critical && <span className="po-chip po-chip-red" style={{ fontSize: 9 }}>CRITICAL</span>}
                </div>
                <span className={`po-chip ${c.pass ? "po-chip-green" : c.critical ? "po-chip-red" : "po-chip-yellow"}`}>{c.pass ? "PASS" : "FAIL"}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── M7: Deployment ────────────────────────────────────────────────────────────
function DeploymentPanel() {
  const { data, loading, reload } = useOps("/ops/infra/deployment", []);
  const { data: hist } = useOps("/ops/infra/deployment/history", []);
  if (loading) return <div className="po-loading">Auditing deployment pipeline…</div>;
  if (!data?.ok) return <div className="po-loading">Error loading deployment audit</div>;
  const statusClass = { pass: "po-row-pass", fail: "po-row-fail", warn: "po-row-warn", unknown: "po-row-unknown" };
  return (
    <div>
      <div className="po-section-hdr">
        <div className="po-section-title">Deployment Pipeline</div>
        <ScoreBar label="" score={data.score} />
        <button className="po-btn-sm" onClick={reload}>Refresh</button>
      </div>
      <div className="po-stats-grid">
        <div className="po-stat-card"><div className="po-stat-val" style={{ color: score_color(data.score) }}>{data.score}%</div><div className="po-stat-lbl">Score</div></div>
        <div className="po-stat-card"><div className="po-stat-val" style={{ color: data.rollback ? "var(--po-green)" : "var(--po-red)" }}>{data.rollback ? "✓" : "✗"}</div><div className="po-stat-lbl">Rollback</div></div>
        <div className="po-stat-card"><div className="po-stat-val" style={{ color: data.scriptsExecutable > 0 ? "var(--po-green)" : "var(--po-yellow)" }}>{data.scriptsExecutable}/{data.scriptsTotal}</div><div className="po-stat-lbl">Executable</div></div>
        <div className="po-stat-card"><div className="po-stat-val" style={{ color: data.releaseTags ? "var(--po-green)" : "var(--po-red)" }}>{"✓"}</div><div className="po-stat-lbl">Release Tags</div></div>
      </div>
      <div className="po-card">
        <div className="po-card-title">Deploy Scripts & Config</div>
        <div className="po-list">
          {(data.checks || []).map(c => (
            <div key={c.id} className={`po-row ${c.present ? "po-row-pass" : "po-row-fail"}`}>
              <div className="po-row-body">
                <div className="po-row-name">{c.label}</div>
                <div className="po-row-meta" style={{ fontFamily: "monospace", fontSize: 10 }}>{c.file}</div>
              </div>
              <StatusChip status={c.present ? "pass" : "missing"} />
            </div>
          ))}
        </div>
      </div>
      {hist?.history?.length > 0 && (
        <div className="po-card">
          <div className="po-card-title">Recent Deployments</div>
          {hist.history.slice(0, 5).map(d => (
            <div key={d.id} className="po-row po-row-pass">
              <div className="po-row-body">
                <div className="po-row-name">{d.version} <span className="po-chip po-chip-gray" style={{ marginLeft: 4 }}>{d.method}</span></div>
                <div className="po-row-meta">{new Date(d.deployedAt).toLocaleString()}</div>
              </div>
              <span className={`po-chip ${d.status === "success" || d.status === "test" ? "po-chip-green" : "po-chip-red"}`}>{d.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── M8: Documentation ─────────────────────────────────────────────────────────
function DocsPanel() {
  const { data, loading, reload } = useOps("/ops/infra/docs", []);
  if (loading) return <div className="po-loading">Auditing documentation…</div>;
  if (!data?.ok) return <div className="po-loading">Error loading docs audit</div>;
  return (
    <div>
      <div className="po-section-hdr">
        <div className="po-section-title">Production Documentation</div>
        <ScoreBar label="" score={data.score} />
        <button className="po-btn-sm" onClick={reload}>Refresh</button>
      </div>
      <div className="po-stats-grid">
        <div className="po-stat-card"><div className="po-stat-val" style={{ color: score_color(data.score) }}>{data.score}%</div><div className="po-stat-lbl">Doc Score</div></div>
        <div className="po-stat-card"><div className="po-stat-val">{data.present}/{data.requiredTotal}</div><div className="po-stat-lbl">Present</div></div>
        <div className="po-stat-card"><div className="po-stat-val">{data.complete}</div><div className="po-stat-lbl">Complete</div></div>
        <div className="po-stat-card"><div className="po-stat-val" style={{ color: data.ready ? "var(--po-green)" : "var(--po-red)" }}>{data.ready ? "READY" : "GAPS"}</div><div className="po-stat-lbl">Status</div></div>
      </div>
      <div className="po-card">
        <div className="po-card-title">Required Documentation</div>
        <div className="po-list">
          {(data.checks || []).filter(c => c.required).map(d => (
            <div key={d.id} className={`po-row ${d.status === "complete" ? "po-row-pass" : d.status === "stub" ? "po-row-warn" : "po-row-fail"}`}>
              <div className="po-row-body">
                <div className="po-row-name">{d.label}</div>
                <div className="po-row-meta" style={{ fontFamily: "monospace", fontSize: 10 }}>{d.file}{d.sizeBytes > 0 ? ` · ${Math.round(d.sizeBytes / 1024)}KB` : ""}</div>
              </div>
              <StatusChip status={d.status} />
            </div>
          ))}
        </div>
      </div>
      {(data.checks || []).filter(c => !c.required && c.present).length > 0 && (
        <div className="po-card">
          <div className="po-card-title">Optional Documentation (Present)</div>
          {(data.checks || []).filter(c => !c.required && c.present).map(d => (
            <div key={d.id} className="po-row po-row-pass">
              <span className="po-row-name">{d.label}</span>
              <StatusChip status="present" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── M9: Launch Checklist ──────────────────────────────────────────────────────
function LaunchChecklistPanel() {
  const [toast, toastEl] = useToast();
  const { data, loading, reload } = useOps("/ops/infra/launch", []);
  const [filter, setFilter] = useState("all");

  const toggle = useCallback(async (itemId, done) => {
    await api(`/ops/infra/launch/${itemId}/${done ? "done" : "undone"}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
    });
    reload();
    toast(done ? "Marked done" : "Marked incomplete");
  }, [reload, toast]);

  const reset = async () => {
    if (!window.confirm("Reset ALL launch checklist items?")) return;
    await api("/ops/infra/launch/reset", { method: "POST" });
    reload();
    toast("Checklist reset");
  };

  if (loading) return <div className="po-loading">Loading launch checklist…</div>;
  if (!data?.ok) return <div className="po-loading">Error loading launch checklist</div>;

  const cats = [...new Set((data.items || []).map(i => i.category))];
  const filtered = (data.items || []).filter(i => filter === "all" || i.category === filter || (filter === "blockers" && i.critical && !i.done));

  return (
    <div>
      <div className="po-section-hdr">
        <div className="po-section-title">Launch Checklist</div>
        {toastEl}
        <button className="po-btn-danger" onClick={reset}>Reset</button>
      </div>
      <div className="po-stats-grid">
        <div className="po-stat-card"><div className="po-stat-val" style={{ color: score_color(data.score) }}>{data.score}%</div><div className="po-stat-lbl">Overall</div></div>
        <div className="po-stat-card"><div className="po-stat-val" style={{ color: score_color(data.critScore) }}>{data.critScore}%</div><div className="po-stat-lbl">Critical</div></div>
        <div className="po-stat-card"><div className="po-stat-val">{data.done}/{data.total}</div><div className="po-stat-lbl">Done</div></div>
        <div className="po-stat-card"><div className="po-stat-val">{data.critDone}/{data.critTotal}</div><div className="po-stat-lbl">Crit Done</div></div>
        <div className="po-stat-card"><div className="po-stat-val" style={{ color: data.goLive ? "var(--po-green)" : "var(--po-red)", fontSize: 12, fontWeight: 800 }}>{data.goLive ? "GO LIVE" : "NOT YET"}</div><div className="po-stat-lbl">Status</div></div>
      </div>
      <div className="po-tag-row" style={{ marginBottom: 10 }}>
        {["all", "blockers", ...cats].map(f => (
          <button key={f} className={`po-btn-sm ${filter === f ? "active" : ""}`}
            style={filter === f ? { borderColor: "var(--po-accent)", color: "var(--po-accent)" } : {}}
            onClick={() => setFilter(f)}>{f}</button>
        ))}
      </div>
      <div className="po-list">
        {filtered.map(item => (
          <div key={item.id} className={`po-checklist-item ${item.done ? "done" : ""} ${item.critical ? "critical" : ""}`}
            onClick={() => toggle(item.id, !item.done)}>
            <div className={`po-check-box ${item.done ? "done" : ""}`}>{item.done ? "✓" : ""}</div>
            <div style={{ flex: 1 }}>
              <div className="po-check-lbl">{item.label}</div>
              <div className="po-check-cat">{item.category}{item.critical ? " · CRITICAL" : ""}</div>
              {item.doneAt && <div className="po-check-note">Done {new Date(item.doneAt).toLocaleDateString()}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── M10: Benchmark ────────────────────────────────────────────────────────────
function BenchmarkPanel() {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const run = () => {
    setLoading(true);
    api("/ops/infra/benchmark").then(r => { setResult(r); setLoading(false); }).catch(() => setLoading(false));
  };

  useEffect(() => { run(); }, []);
  const readinessColor = { production_ready: "var(--po-green)", nearly_ready: "var(--po-yellow)", needs_work: "var(--po-red)" };

  return (
    <div>
      <div className="po-section-hdr">
        <div className="po-section-title">Production Benchmark</div>
        <button className="po-btn" onClick={run} disabled={loading}>{loading ? "Running…" : "Run Benchmark"}</button>
      </div>
      {loading && <div className="po-loading">Running all 10 production checks…</div>}
      {result && !loading && <>
        <div className="po-stats-grid">
          <div className="po-stat-card"><div className="po-stat-val" style={{ color: score_color(result.score) }}>{result.score}%</div><div className="po-stat-lbl">Score</div></div>
          <div className="po-stat-card"><div className="po-stat-val">{result.passing}/{result.total}</div><div className="po-stat-lbl">Passing</div></div>
          <div className="po-stat-card"><div className="po-stat-val" style={{ color: result.regressionPass ? "var(--po-green)" : "var(--po-red)" }}>{result.regressionPass ? "PASS" : "FAIL"}</div><div className="po-stat-lbl">Regression</div></div>
          <div className="po-stat-card">
            <div className="po-stat-val" style={{ color: readinessColor[result.launchReadiness] || "var(--po-accent)", fontSize: 10, fontWeight: 800, textTransform: "uppercase" }}>
              {(result.launchReadiness || "").replace(/_/g, " ")}
            </div>
            <div className="po-stat-lbl">Readiness</div>
          </div>
        </div>
        <div className="po-card">
          <div className="po-card-title">Benchmark Checks</div>
          <div className="po-list">
            {(result.checks || []).map((c, i) => (
              <div key={c.id} className={`po-row ${c.ok ? "po-row-pass" : "po-row-fail"}`}>
                <div className="po-row-body">
                  <div className="po-row-name">M{i + 1}. {c.label}</div>
                  {c.error && <div className="po-row-meta" style={{ color: "var(--po-red)" }}>Error: {c.error}</div>}
                </div>
                <span className={`po-chip ${c.ok ? "po-chip-green" : "po-chip-red"}`}>{c.ok ? "PASS" : "FAIL"}</span>
              </div>
            ))}
          </div>
        </div>
        {result.runAt && <div className="po-row-meta" style={{ textAlign: "right", marginTop: 8 }}>Last run: {new Date(result.runAt).toLocaleString()}</div>}
      </>}
    </div>
  );
}

// ── Executive Panel ───────────────────────────────────────────────────────────
function ExecutivePanel() {
  const { data, loading, reload } = useOps("/ops/infra/executive", []);
  if (loading) return <div className="po-loading">Loading production status…</div>;
  if (!data?.ok) return <div className="po-loading">Error loading executive view</div>;
  const m = data.modules || {};
  const modules = [
    { id: "github",     label: "GitHub",       score: m.github?.score,              ready: m.github?.ready                    },
    { id: "env",        label: "Environment",  score: m.env?.score,                 ready: m.env?.ready                       },
    { id: "database",   label: "Database",     score: m.database?.integrityScore,   ready: m.database?.ready                  },
    { id: "monitoring", label: "Monitoring",   score: m.monitoring?.score,          ready: m.monitoring?.ready                },
    { id: "security",   label: "Security",     score: m.security?.score,            ready: m.security?.ready,  grade: m.security?.grade },
    { id: "deploy",     label: "Deployment",   score: m.deploy?.score,              ready: m.deploy?.ready                    },
    { id: "docs",       label: "Docs",         score: m.docs?.score,                ready: m.docs?.ready                      },
    { id: "launch",     label: "Launch Checklist", score: m.launch?.critScore,      ready: m.launch?.goLive                   },
  ];
  return (
    <div>
      <div className="po-section-hdr">
        <div className="po-section-title">Executive Production Status</div>
        <button className="po-btn-sm" onClick={reload}>Refresh</button>
      </div>
      <div className="po-overall">
        <div className="po-overall-score" style={{ color: score_color(data.overall) }}>{data.overall}%</div>
        <div className="po-overall-meta">
          <div className="po-overall-grade" style={{ color: score_color(data.overall) }}>
            {data.overall >= 90 ? "Production Ready" : data.overall >= 75 ? "Nearly Ready" : data.overall >= 60 ? "In Progress" : "Needs Work"}
          </div>
          <div className="po-overall-sub">Overall production readiness · {new Date(data.checkedAt).toLocaleString()}</div>
        </div>
      </div>
      <div className="po-card">
        <div className="po-card-title">Module Scores</div>
        {modules.map(m2 => (
          <ScoreBar key={m2.id} label={`${m2.label}${m2.grade ? ` (${m2.grade})` : ""}`} score={m2.score} />
        ))}
      </div>
      <div className="po-exec-grid">
        {modules.map(m2 => (
          <div key={m2.id} className="po-exec-card">
            <div className="po-exec-icon">{m2.ready ? "✓" : "○"}</div>
            <div className="po-exec-val" style={{ color: score_color(m2.score ?? 0), fontSize: 16 }}>{m2.score ?? "–"}%</div>
            <div className="po-exec-label">{m2.label}</div>
            <div className="po-exec-sub" style={{ color: m2.ready ? "var(--po-green)" : "var(--po-yellow)" }}>{m2.ready ? "Ready" : "Pending"}</div>
          </div>
        ))}
      </div>
      {m.launch && (
        <div className="po-card" style={{ borderColor: m.launch.goLive ? "rgba(34,197,94,.3)" : "rgba(239,68,68,.3)" }}>
          <div className="po-card-title">Launch Gate</div>
          <div className="po-kv-row"><span className="po-kv-key">Critical Checklist</span><span className="po-kv-val">{m.launch.critDone}/{m.launch.critTotal} done</span></div>
          <div className="po-kv-row"><span className="po-kv-key">Go-Live Status</span><span className="po-kv-val" style={{ color: m.launch.goLive ? "var(--po-green)" : "var(--po-red)", fontWeight: 800 }}>{m.launch.goLive ? "APPROVED — GO LIVE" : "BLOCKERS REMAIN"}</span></div>
        </div>
      )}
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────
const TABS = [
  { id: "executive",    label: "Overview",    icon: "◎" },
  { id: "github",       label: "GitHub",      icon: "◈" },
  { id: "vps",          label: "VPS",         icon: "⬡" },
  { id: "environment",  label: "Environment", icon: "⊞" },
  { id: "database",     label: "Database",    icon: "◉" },
  { id: "monitoring",   label: "Monitoring",  icon: "◇" },
  { id: "security",     label: "Security",    icon: "⬢" },
  { id: "deployment",   label: "Deployment",  icon: "▷" },
  { id: "docs",         label: "Docs",        icon: "✦" },
  { id: "launch",       label: "Launch",      icon: "◎" },
  { id: "benchmark",    label: "Benchmark",   icon: "⚡" },
];

const PANEL = {
  executive:   <ExecutivePanel />,
  github:      <GitHubPanel />,
  vps:         <VPSPanel />,
  environment: <EnvironmentPanel />,
  database:    <DatabasePanel />,
  monitoring:  <MonitoringPanel />,
  security:    <SecurityPanel />,
  deployment:  <DeploymentPanel />,
  docs:        <DocsPanel />,
  launch:      <LaunchChecklistPanel />,
  benchmark:   <BenchmarkPanel />,
};

export default function ProductionOps() {
  const [tab, setTab] = useState("executive");
  return (
    <div className="po-root">
      <div className="po-header">
        <span className="po-title">Production Ops</span>
        <span className="po-subtitle">CO1 · Company Operations · Production Infrastructure</span>
      </div>
      <div className="po-tabs">
        {TABS.map(t => (
          <button key={t.id} className={`po-tab${tab === t.id ? " active" : ""}`} onClick={() => setTab(t.id)}>
            <span className="po-tab-icon">{t.icon}</span>{t.label}
          </button>
        ))}
      </div>
      <div className="po-content">{PANEL[tab] || null}</div>
    </div>
  );
}
