import React, { useState, useEffect, useCallback } from "react";
import { _fetch } from "../_client";
import { FieldRow } from "./WorkspaceSettingsShared";

// ── K4 Governance helpers ─────────────────────────────────────────
const RISK_COLOR  = { critical: "var(--error)", high: "#ff6b35", medium: "var(--warning)", low: "#52d68a" };
const ENF_COLOR   = { blocking: "var(--error)", advisory: "var(--warning)", logging: "var(--text-dim)" };
const POLICY_TYPES = ["approval","change","deployment","environment","retention","audit_retention","access"];
const ENFORCEMENT  = ["advisory","blocking","logging"];
const LIKELIHOOD   = ["rare","unlikely","possible","likely","almost_certain"];
const IMPACT       = ["negligible","minor","moderate","major","critical"];
const FRAMEWORKS   = ["SOC 2","GDPR","HIPAA","ISO 27001","PCI-DSS","CCPA"];

function _govFmtDate(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString();
}

// ── K4 — Policy Library Panel ─────────────────────────────────────
function PolicyLibraryPanel() {
  const [policies,  setPolicies]  = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [tab,       setTab]       = useState("policies"); // policies | templates
  const [creating,  setCreating]  = useState(false);
  const [form,      setForm]      = useState({ name: "", type: "change", enforcement: "advisory", description: "" });
  const [toast,     setToast]     = useState(null);

  const doToast = msg => { setToast(msg); setTimeout(() => setToast(null), 2800); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, t] = await Promise.all([
        _fetch("/governance/policies").then(r => r.policies || []),
        _fetch("/governance/templates").then(r => r.templates || []),
      ]);
      setPolicies(p); setTemplates(t);
    } catch {}
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function createPolicy() {
    if (!form.name.trim()) return;
    try {
      await _fetch("/governance/policies", { method: "POST", body: JSON.stringify(form) });
      setForm({ name: "", type: "change", enforcement: "advisory", description: "" });
      setCreating(false); doToast("Policy created"); load();
    } catch (e) { doToast(e.message || "Failed"); }
  }

  async function archivePolicy(id) {
    try {
      await _fetch(`/governance/policies/${id}`, { method: "PATCH", body: JSON.stringify({ status: "archived" }) });
      doToast("Policy archived"); load();
    } catch (e) { doToast(e.message || "Failed"); }
  }

  if (loading) return <div className="k2-loading">Loading policies…</div>;

  return (
    <div className="k4-policy-panel">
      {toast && <div className="tw-toast">{toast}</div>}

      <div className="k4-subtabs">
        {[["policies", `Policies (${policies.length})`], ["templates", `Templates (${templates.length})`]].map(([id, label]) => (
          <button key={id} className={`k4-subtab${tab === id ? " k4-subtab--active" : ""}`} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {tab === "policies" && (
        <>
          <div className="k4-list-header">
            <span className="k4-list-count">{policies.length} active</span>
            <button className="k2-create-btn" onClick={() => setCreating(c => !c)}>＋ New policy</button>
          </div>

          {creating && (
            <div className="k4-create-form">
              <input className="k2-form-input" placeholder="Policy name…" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} autoFocus />
              <div className="k4-form-row">
                <select className="k2-form-select" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                  {POLICY_TYPES.map(t => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
                </select>
                <select className="k2-form-select" value={form.enforcement} onChange={e => setForm(f => ({ ...f, enforcement: e.target.value }))}>
                  {ENFORCEMENT.map(e => <option key={e} value={e}>{e}</option>)}
                </select>
              </div>
              <input className="k2-form-input" placeholder="Description (optional)" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
              <div className="k2-form-actions">
                <button className="k2-cancel-btn" onClick={() => setCreating(false)}>Cancel</button>
                <button className="k2-create-confirm" onClick={createPolicy} disabled={!form.name.trim()}>Create</button>
              </div>
            </div>
          )}

          <div className="k4-list">
            {policies.length === 0 && !creating && <div className="k2-empty">No active policies. Create one or apply a template.</div>}
            {policies.map(p => (
              <div key={p.id} className="k4-policy-row">
                <div className="k4-policy-meta">
                  <span className="k4-policy-name">{p.name}</span>
                  <span className="k4-policy-type">{p.type.replace("_"," ")}</span>
                  {p.description && <span className="k4-policy-desc">{p.description}</span>}
                </div>
                <span className="k4-enf-badge" style={{ color: ENF_COLOR[p.enforcement], borderColor: ENF_COLOR[p.enforcement] + "40" }}>
                  {p.enforcement}
                </span>
                <button className="k2-revoke-btn" onClick={() => archivePolicy(p.id)}>Archive</button>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === "templates" && (
        <div className="k4-list">
          {templates.map(t => (
            <div key={t.id} className="k4-template-card">
              <div className="k4-template-top">
                <span className="k4-template-name">{t.name}</span>
                {!t.custom && <span className="k2-badge k2-badge--dim">Built-in</span>}
                {t.custom  && <span className="k2-badge k2-badge--green">Custom</span>}
                <span className="k4-template-cat">{t.category}</span>
              </div>
              {t.description && <span className="k4-template-desc">{t.description}</span>}
              <div className="k4-template-policies">
                {(t.policies || []).map((p, i) => (
                  <span key={i} className="k4-tpl-policy-chip">
                    <span style={{ color: ENF_COLOR[p.enforcement] }}>●</span> {p.name}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── K4 — Compliance Panel ─────────────────────────────────────────
function CompliancePanel() {
  const [compliance, setCompliance] = useState(null);
  const [saving,     setSaving]     = useState(false);
  const [toast,      setToast]      = useState(null);

  const doToast = msg => { setToast(msg); setTimeout(() => setToast(null), 2800); };

  useEffect(() => {
    _fetch("/governance/compliance").then(r => setCompliance(r.compliance)).catch(() => {});
  }, []);

  function toggleFramework(fw) {
    setCompliance(c => {
      const fws = c.frameworks || [];
      return { ...c, frameworks: fws.includes(fw) ? fws.filter(f => f !== fw) : [...fws, fw] };
    });
  }

  async function save() {
    setSaving(true);
    try {
      const r = await _fetch("/governance/compliance", { method: "PATCH", body: JSON.stringify(compliance) });
      setCompliance(r.compliance); doToast("Compliance profile saved");
    } catch (e) { doToast(e.message || "Failed"); }
    setSaving(false);
  }

  if (!compliance) return <div className="k2-loading">Loading compliance profile…</div>;

  return (
    <div className="k4-compliance-panel">
      {toast && <div className="tw-toast">{toast}</div>}

      <div className="k4-section-label">Active Frameworks</div>
      <div className="k4-frameworks-grid">
        {FRAMEWORKS.map(fw => (
          <button key={fw} className={`k4-fw-chip${(compliance.frameworks || []).includes(fw) ? " k4-fw-chip--active" : ""}`}
            onClick={() => toggleFramework(fw)}>{fw}</button>
        ))}
      </div>

      <div className="ws-fields" style={{ marginTop: 16 }}>
        <FieldRow label="Data classification" hint="Default classification level for workspace data">
          <select className="ws-select" value={compliance.dataClassification}
            onChange={e => setCompliance(c => ({ ...c, dataClassification: e.target.value }))}>
            {["public","internal","confidential","restricted"].map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </FieldRow>
        <FieldRow label="Risk tolerance" hint="Organization's overall risk appetite">
          <select className="ws-select" value={compliance.riskTolerance}
            onChange={e => setCompliance(c => ({ ...c, riskTolerance: e.target.value }))}>
            {["low","medium","high"].map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </FieldRow>
        <FieldRow label="Data retention (days)" hint="Default retention period for workspace data">
          <input className="ws-input" type="number" min={30} max={3650}
            value={compliance.retentionDays}
            onChange={e => setCompliance(c => ({ ...c, retentionDays: Number(e.target.value) }))} />
        </FieldRow>
        <FieldRow label="Review cycle (days)" hint="How often compliance posture is reviewed">
          <select className="ws-select" value={compliance.reviewCycleDays}
            onChange={e => setCompliance(c => ({ ...c, reviewCycleDays: Number(e.target.value) }))}>
            {[30, 60, 90, 180, 365].map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </FieldRow>
        <FieldRow label="Notes">
          <textarea className="ws-input k3-textarea" rows={2} value={compliance.notes || ""}
            onChange={e => setCompliance(c => ({ ...c, notes: e.target.value }))} placeholder="Internal compliance notes…" />
        </FieldRow>
      </div>

      {compliance.nextReviewAt && (
        <div className="k4-review-banner">
          Next review: <strong>{_govFmtDate(compliance.nextReviewAt)}</strong>
          {compliance.nextReviewAt < Date.now() && <span className="k4-overdue"> — OVERDUE</span>}
        </div>
      )}

      <button className="ws-save-btn" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save compliance profile"}</button>
    </div>
  );
}

// ── K4 — Risk Matrix Panel ────────────────────────────────────────
function RiskMatrixPanel() {
  const [matrix,  setMatrix]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [toast,   setToast]   = useState(null);

  const doToast = msg => { setToast(msg); setTimeout(() => setToast(null), 2800); };

  const load = useCallback(() => {
    _fetch("/governance/risk").then(r => setMatrix(r.riskMatrix || [])).catch(() => {}).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function saveEntry() {
    if (!editing) return;
    try {
      await _fetch(`/governance/risk/${editing.category}`, {
        method: "PATCH",
        body: JSON.stringify({ likelihood: editing.likelihood, impact: editing.impact, mitigation: editing.mitigation }),
      });
      doToast("Risk entry updated"); setEditing(null); load();
    } catch (e) { doToast(e.message || "Failed"); }
  }

  if (loading) return <div className="k2-loading">Loading risk matrix…</div>;

  return (
    <div className="k4-risk-panel">
      {toast && <div className="tw-toast">{toast}</div>}
      <div className="k4-risk-grid">
        {matrix.map(r => (
          <div key={r.category} className="k4-risk-card" style={{ borderColor: RISK_COLOR[r.riskLevel] + "50" }}>
            <div className="k4-risk-card-top">
              <span className="k4-risk-category">{r.category}</span>
              <span className="k4-risk-level" style={{ color: RISK_COLOR[r.riskLevel] }}>{r.riskLevel}</span>
            </div>
            <div className="k4-risk-score" style={{ color: RISK_COLOR[r.riskLevel] }}>{r.score}</div>
            <div className="k4-risk-dims">
              <span className="k4-risk-dim">L: {r.likelihood}</span>
              <span className="k4-risk-dim">I: {r.impact}</span>
            </div>
            {r.mitigation && <div className="k4-risk-mitigation">{r.mitigation}</div>}
            <button className="k3-edit-btn" style={{ marginTop: 6 }}
              onClick={() => setEditing({ ...r })}>Edit</button>
          </div>
        ))}
      </div>

      {editing && (
        <div className="ws-modal-overlay" onClick={() => setEditing(null)}>
          <div className="ws-modal k3-edit-modal" onClick={e => e.stopPropagation()}>
            <h3 className="k3-modal-title">Edit Risk: {editing.category}</h3>
            <div className="k3-modal-fields">
              <label className="k3-modal-label">Likelihood
                <select className="k3-modal-select" value={editing.likelihood}
                  onChange={e => setEditing(x => ({ ...x, likelihood: e.target.value }))}>
                  {LIKELIHOOD.map(v => <option key={v} value={v}>{v.replace("_"," ")}</option>)}
                </select>
              </label>
              <label className="k3-modal-label">Impact
                <select className="k3-modal-select" value={editing.impact}
                  onChange={e => setEditing(x => ({ ...x, impact: e.target.value }))}>
                  {IMPACT.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>
              <label className="k3-modal-label">Mitigation
                <input className="k3-modal-input" value={editing.mitigation || ""}
                  onChange={e => setEditing(x => ({ ...x, mitigation: e.target.value }))}
                  placeholder="Mitigation strategy…" />
              </label>
            </div>
            <div className="k3-modal-actions">
              <button className="k2-cancel-btn" onClick={() => setEditing(null)}>Cancel</button>
              <button className="k2-create-confirm" onClick={saveEntry}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── K4 — Governance Overview (landing) ────────────────────────────
function GovernanceOverviewPanel() {
  const [report,  setReport]  = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    _fetch("/governance/reports").then(r => setReport(r)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="k2-loading">Loading governance overview…</div>;
  if (!report)  return <div className="k2-empty">No governance data.</div>;

  const { policies, compliance, risk } = report;
  const scoreColor = s => s >= 85 ? "#52d68a" : s >= 70 ? "var(--warning)" : s >= 55 ? "#ffaa00" : "var(--error)";

  return (
    <div className="k4-overview-panel">
      <div className="k4-overview-cards">
        <div className="k4-ov-card">
          <span className="k4-ov-value" style={{ color: scoreColor(compliance?.score || 0) }}>{compliance?.score || 0}</span>
          <span className="k4-ov-label">Compliance Score</span>
          <span className="k4-ov-sub">{compliance?.grade} grade</span>
        </div>
        <div className="k4-ov-card">
          <span className="k4-ov-value" style={{ color: "var(--accent)" }}>{policies?.active || 0}</span>
          <span className="k4-ov-label">Active Policies</span>
          <span className="k4-ov-sub">{policies?.blocking || 0} blocking</span>
        </div>
        <div className="k4-ov-card">
          <span className="k4-ov-value" style={{ color: RISK_COLOR[risk?.summary?.critical > 0 ? "critical" : "low"] }}>
            {(risk?.summary?.critical || 0) + (risk?.summary?.high || 0)}
          </span>
          <span className="k4-ov-label">High+ Risks</span>
          <span className="k4-ov-sub">{risk?.summary?.critical || 0} critical</span>
        </div>
        <div className="k4-ov-card">
          <span className="k4-ov-value" style={{ color: "var(--text-dim)" }}>{compliance?.frameworks?.length || 0}</span>
          <span className="k4-ov-label">Frameworks</span>
          <span className="k4-ov-sub">{(compliance?.frameworks || []).slice(0,2).join(", ") || "None active"}</span>
        </div>
      </div>

      {risk?.highestRisk?.length > 0 && (
        <>
          <div className="k4-section-label" style={{ marginTop: 16 }}>Highest Risk Areas</div>
          {risk.highestRisk.map(r => (
            <div key={r.category} className="k2-row" style={{ borderColor: RISK_COLOR[r.riskLevel] + "40" }}>
              <span className="k4-risk-level" style={{ color: RISK_COLOR[r.riskLevel], minWidth: 56 }}>{r.riskLevel}</span>
              <span className="k4-risk-category" style={{ flex: 1 }}>{r.category}</span>
              <span className="k4-risk-score" style={{ color: RISK_COLOR[r.riskLevel] }}>Score: {r.score}</span>
            </div>
          ))}
        </>
      )}

      {compliance?.nextReview && (
        <div className="k4-review-banner" style={{ marginTop: 14 }}>
          Next compliance review: <strong>{_govFmtDate(compliance.nextReview)}</strong>
        </div>
      )}
    </div>
  );
}

// ── K4 — Governance Reports Panel ────────────────────────────────
function GovReportsPanel() {
  const [report,  setReport]  = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    _fetch("/governance/reports").then(r => setReport(r)).catch(() => {}).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="k2-loading">Generating report…</div>;
  if (!report)  return <div className="k2-empty">Report unavailable.</div>;

  const { policies, audit, members, activity } = report;

  return (
    <div className="k4-report-panel">
      <div className="k4-report-header">
        <span className="k4-report-ts">Generated {_govFmtDate(report.generatedAt)}</span>
        <button className="k2-create-btn" onClick={load}>↺ Refresh</button>
      </div>

      <div className="k4-report-section">
        <div className="k4-section-label">Policy Breakdown</div>
        <div className="k4-report-grid">
          {Object.entries(policies?.byType || {}).filter(([, n]) => n > 0).map(([type, n]) => (
            <div key={type} className="k4-report-cell">
              <span className="k4-report-cell-val">{n}</span>
              <span className="k4-report-cell-key">{type.replace("_"," ")}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="k4-report-section">
        <div className="k4-section-label">Audit Events by Type</div>
        <div className="k4-report-grid">
          {Object.entries(audit?.byType || {}).sort((a,b) => b[1]-a[1]).slice(0,8).map(([type, n]) => (
            <div key={type} className="k4-report-cell">
              <span className="k4-report-cell-val">{n}</span>
              <span className="k4-report-cell-key">{type}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="k4-report-section">
        <div className="k4-section-label">Recent Audit Events</div>
        <div className="k2-audit-list">
          {(audit?.recent || []).slice(0,8).map((e, i) => (
            <div key={e.id || i} className="k2-audit-row">
              <span className="k2-audit-dot" style={{ background: "var(--accent)" }} />
              <span className="k2-audit-ts">{new Date(e.ts).toLocaleDateString()}</span>
              <span className="k2-audit-action">{e.action}</span>
              {e.detail && <span className="k2-audit-detail">{e.detail}</span>}
            </div>
          ))}
          {(!audit?.recent?.length) && <div className="k2-empty">No audit events yet.</div>}
        </div>
      </div>

      <div className="k4-report-section">
        <div className="k4-section-label">Members Summary</div>
        <div className="k4-report-grid">
          {Object.entries(members || {}).filter(([k]) => ["total","active","suspended","pendingInvites"].includes(k)).map(([k, v]) => (
            <div key={k} className="k4-report-cell">
              <span className="k4-report-cell-val">{v}</span>
              <span className="k4-report-cell-key">{k.replace(/([A-Z])/g, " $1").toLowerCase()}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


export { PolicyLibraryPanel, CompliancePanel, RiskMatrixPanel, GovernanceOverviewPanel, GovReportsPanel };
