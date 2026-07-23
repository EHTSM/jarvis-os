import React, { useState, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { track } from "../analytics";
import {
  getFactoryDashboard, getFactoryStats, createCompany, listTemplates,
  listCompanies, getCompanyDetail, getCompanyComposition, advanceCompanyStage, passCompanyGate,
  getLifecycleStages,
} from "../companyFactoryApi";
import "./IntegrationCenter.css";
import "./CompanyFactoryCenter.css";

const STAGE_COLOR = {
  planning:    "var(--text-faint)",
  building:    "var(--accent2)",
  testing:     "var(--warning)",
  launch:      "var(--accent)",
  growth:      "var(--success)",
  scale:       "var(--success)",
  maintenance: "var(--text-dim)",
};

function StageBadge({ stage }) {
  const color = STAGE_COLOR[stage] || "var(--text-faint)";
  return (
    <span className="cfc-stage-badge" style={{ color, borderColor: color + "40", background: color + "14" }}>
      {stage}
    </span>
  );
}

function RiskBadge({ score }) {
  const color = score >= 60 ? "var(--danger)" : score >= 30 ? "var(--warning)" : "var(--success)";
  return <span className="cfc-risk-badge" style={{ color }}>{score} risk</span>;
}

function StagePipeline({ stages, currentStage }) {
  const idx = stages.indexOf(currentStage);
  return (
    <div className="cfc-pipeline">
      {stages.map((s, i) => (
        <React.Fragment key={s}>
          <div className={`cfc-pipeline-node${i <= idx ? " cfc-pipeline-node--done" : ""}${i === idx ? " cfc-pipeline-node--current" : ""}`}>
            <span className="cfc-pipeline-dot" />
            <span className="cfc-pipeline-label">{s}</span>
          </div>
          {i < stages.length - 1 && <span className={`cfc-pipeline-line${i < idx ? " cfc-pipeline-line--done" : ""}`} />}
        </React.Fragment>
      ))}
    </div>
  );
}

function CompanyCard({ company, selected, onSelect }) {
  return (
    <button className={`cfc-card${selected ? " cfc-card--selected" : ""}`} onClick={() => onSelect(company.id)}>
      <div className="cfc-card-header">
        <span className="cfc-card-name">{company.name}</span>
        <StageBadge stage={company.stage} />
      </div>
      <span className="cfc-card-template">{company.templateId}</span>
      <div className="cfc-card-progress-wrap">
        <div className="cfc-card-progress-track">
          <div className="cfc-card-progress-fill" style={{ width: `${company.progress?.stageProgress || 0}%` }} />
        </div>
        <span className="cfc-card-progress-pct">{company.progress?.stageProgress || 0}%</span>
      </div>
      <div className="cfc-card-footer">
        <RiskBadge score={company.riskScore || 0} />
        <span className="cfc-card-readiness">{company.readiness ?? 0}% ready</span>
      </div>
    </button>
  );
}

function CreateCompanyModal({ templates, onClose, onCreated }) {
  const [name, setName] = useState("");
  const [idea, setIdea] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const submit = useCallback(async () => {
    if (!name.trim() && !idea.trim()) { setErr("Provide a name or a one-line idea."); return; }
    setBusy(true); setErr(null);
    const res = await createCompany({ name: name.trim() || undefined, idea: idea.trim() || undefined, templateId: templateId || undefined });
    setBusy(false);
    if (res?.ok === false) { setErr(res.error || "Failed to create company."); return; }
    track.event("company_factory_created", { templateId });
    onCreated(res);
  }, [name, idea, templateId, onCreated]);

  return createPortal(
    <div className="cfc-modal-overlay" onClick={onClose}>
      <div className="cfc-modal" onClick={e => e.stopPropagation()}>
        <div className="cfc-modal-header">
          <h3 className="cfc-modal-title">Launch a new company</h3>
          <button className="ic-detail-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p className="cfc-modal-sub">The factory generates a blueprint, workspace, and lifecycle roadmap automatically.</p>
        <label className="cfc-field-label">Company name</label>
        <input className="ic-setup-input" placeholder="e.g. Northwind Analytics" value={name} onChange={e => setName(e.target.value)} />
        <label className="cfc-field-label">One-line idea (optional — helps template inference)</label>
        <textarea className="ic-setup-input" placeholder="e.g. Subscription analytics dashboard for e-commerce sellers" value={idea} onChange={e => setIdea(e.target.value)} />
        <label className="cfc-field-label">Template</label>
        <select className="ic-setup-select" value={templateId} onChange={e => setTemplateId(e.target.value)}>
          <option value="">Auto-infer from idea</option>
          {templates.map(t => <option key={t.id} value={t.id}>{t.fullName || t.name}</option>)}
        </select>
        {err && <p className="cfc-error">{err}</p>}
        <div className="ic-detail-actions">
          <button className="ic-detail-btn ic-detail-btn--primary" onClick={submit} disabled={busy}>
            {busy ? "Creating…" : "Create company"}
          </button>
          <button className="ic-detail-btn ic-detail-btn--secondary" onClick={onClose} disabled={busy}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function CompanyDetail({ companyId, stages, gateDefs, onClose, onChanged }) {
  const [detail, setDetail] = useState(null);
  const [composition, setComposition] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await getCompanyDetail(companyId);
    setLoading(false);
    if (res?.ok !== false) setDetail(res);
  }, [companyId]);

  // Composition Inspector (Universal Composition Engine — Completion
  // Gaps Phase 6): fetched alongside detail, keyed by the same
  // companyId dependency — switching the active company (companyId
  // change) refreshes both, matching the mission's requirement that
  // active-company switches refresh composition state correctly.
  const loadComposition = useCallback(async () => {
    const res = await getCompanyComposition(companyId);
    if (res?.ok !== false) setComposition(res);
  }, [companyId]);

  useEffect(() => { load(); loadComposition(); }, [load, loadComposition]);

  const advance = useCallback(async () => {
    setBusy(true);
    const res = await advanceCompanyStage(companyId);
    setBusy(false);
    if (res?.ok === false) { setToast(res.error || "Could not advance stage — gates may be unmet."); return; }
    setToast("Stage advanced.");
    load(); onChanged();
  }, [companyId, load, onChanged]);

  const passGate = useCallback(async (gate) => {
    setBusy(true);
    const res = await passCompanyGate(companyId, gate, "Manually confirmed from Company Factory UI");
    setBusy(false);
    if (res?.ok === false) { setToast(res.error || "Could not pass gate."); return; }
    setToast(`Gate "${gate}" passed.`);
    load(); onChanged();
  }, [companyId, load, onChanged]);

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3000); return () => clearTimeout(t); }, [toast]);

  if (loading) {
    return (
      <div className="ic-detail cfc-detail">
        <div className="cfc-skeleton" />
        <div className="cfc-skeleton" style={{ width: "60%" }} />
        <div className="cfc-skeleton" style={{ height: 80 }} />
      </div>
    );
  }
  if (!detail?.company) {
    return (
      <div className="ic-detail cfc-detail">
        <p className="ic-detail-desc">Company not found.</p>
        <button className="ic-detail-btn ic-detail-btn--secondary" onClick={onClose}>Close</button>
      </div>
    );
  }

  const c = detail.company;
  const nextStageGates = gateDefs?.[stages[stages.indexOf(c.stage) + 1]] || [];
  const unmetGates = nextStageGates.filter(g => !c.gates?.[g]?.passed);

  return (
    <div className="ic-detail cfc-detail">
      <div className="ic-detail-header">
        <h3 className="ic-detail-name">{c.name}</h3>
        <button className="ic-detail-close" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <div className="cfc-detail-badges">
        <StageBadge stage={c.stage} />
        <RiskBadge score={detail.riskScore || 0} />
        <span className="cfc-detail-readiness">{c.readinessScore ?? 0}% readiness</span>
      </div>

      <StagePipeline stages={stages} currentStage={c.stage} />

      {detail.blueprint && (
        <div className="ic-detail-section">
          <p className="ic-detail-label">Blueprint</p>
          <p className="ic-detail-sub">{c.templateId} · {detail.blueprint.techStack?.slice(0, 4).join(", ") || "—"}</p>
        </div>
      )}

      {detail.workspace && (
        <div className="ic-detail-section">
          <p className="ic-detail-label">Workspace</p>
          <p className="ic-detail-sub">{detail.workspace.readinessScore ?? 0}% ready · {detail.workspace.repos ?? 0} repos · {detail.workspace.missions ?? 0} missions</p>
        </div>
      )}

      {detail.departments?.length > 0 && (
        <div className="ic-detail-section">
          <p className="ic-detail-label">Departments ({detail.departments.length})</p>
          <div className="cfc-roadmap-list">
            {detail.departments.map(d => (
              <div key={d.id} className="cfc-roadmap-row">
                <span className="cfc-roadmap-phase">{d.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Composition Inspector (Phase 6) — real backend-driven visibility
          into skills/connectors/credentials/approval policies/capability
          gaps. Backend remains the source of truth: every value below is
          exactly what /company-factory/companies/:id/composition returned,
          no client-side fabrication. */}
      {composition && (
        <>
          {composition.skills?.length > 0 && (
            <div className="ic-detail-section">
              <p className="ic-detail-label">Skills ({composition.skills.filter(s => s.resolved).length}/{composition.skills.length} resolved)</p>
              <div className="cfc-roadmap-list">
                {composition.skills.map(s => (
                  <div key={s.id} className="cfc-roadmap-row">
                    <span className="cfc-roadmap-phase">{s.name}</span>
                    {!s.resolved && <span className="cfc-risk-badge" style={{ color: "var(--warning)" }}>unresolved</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {composition.connectors?.length > 0 && (
            <div className="ic-detail-section">
              <p className="ic-detail-label">Connectors ({composition.connectors.length})</p>
              <div className="cfc-roadmap-list">
                {composition.connectors.map(c => (
                  <div key={c.connectorId} className="cfc-roadmap-row">
                    <span className="cfc-roadmap-phase">{c.connectorId}</span>
                    <span className="cfc-risk-badge" style={{
                      color: c.status === "CONNECTED_VERIFIED" ? "var(--success)"
                        : ["AUTH_FAILED", "UNREACHABLE"].includes(c.status) ? "var(--danger)"
                        : "var(--warning)",
                    }}>{c.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="ic-detail-section">
            <p className="ic-detail-label">Credential Readiness</p>
            <p className="ic-detail-sub">
              {composition.credentials?.length > 0
                ? `${composition.credentials.length} credential(s) configured`
                : "No credentials configured yet"}
            </p>
          </div>

          {composition.approvalPolicies?.length > 0 && (
            <div className="ic-detail-section">
              <p className="ic-detail-label">Approval Policies ({composition.approvalPolicies.length})</p>
              <p className="ic-detail-sub">{composition.approvalPolicies.join(", ")}</p>
            </div>
          )}

          {composition.capabilityStatus && (
            <div className="ic-detail-section">
              <p className="ic-detail-label">Capability Status</p>
              <span className="cfc-risk-badge" style={{
                color: composition.capabilityStatus === "COMPOSABLE_NOW" ? "var(--success)"
                  : ["UNSUPPORTED", "CAPABILITY_GAP"].includes(composition.capabilityStatus) ? "var(--danger)"
                  : "var(--warning)",
              }}>{composition.capabilityStatus}</span>
              {composition.capabilityGap?.missingDepartments?.length > 0 && (
                <p className="ic-detail-sub">Missing: {composition.capabilityGap.missingDepartments.join(", ")}</p>
              )}
            </div>
          )}
        </>
      )}

      <div className="ic-detail-section">
        <p className="ic-detail-label">Gates for next stage{stages[stages.indexOf(c.stage) + 1] ? ` (${stages[stages.indexOf(c.stage) + 1]})` : ""}</p>
        {nextStageGates.length === 0 && <p className="ic-detail-sub">No further gates — final stage reached.</p>}
        <div className="cfc-gates-list">
          {nextStageGates.map(g => {
            const passed = !!c.gates?.[g]?.passed;
            return (
              <div key={g} className="cfc-gate-row">
                <span className={`cfc-gate-dot${passed ? " cfc-gate-dot--passed" : ""}`} />
                <span className="cfc-gate-name">{g.replace(/_/g, " ")}</span>
                {!passed && (
                  <button className="cfc-gate-pass-btn" disabled={busy} onClick={() => passGate(g)}>Pass</button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {c.risks?.length > 0 && (
        <div className="ic-detail-section">
          <p className="ic-detail-label">Risks</p>
          <div className="cfc-risks-list">
            {c.risks.map((r, i) => (
              <div key={i} className="cfc-risk-row">
                <span className={`cfc-risk-sev cfc-risk-sev--${r.severity}`}>{r.severity}</span>
                <div>
                  <span className="cfc-risk-name">{r.risk}</span>
                  <span className="cfc-risk-mitigation">{r.mitigation}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {c.roadmap?.length > 0 && (
        <div className="ic-detail-section">
          <p className="ic-detail-label">Roadmap</p>
          <div className="cfc-roadmap-list">
            {c.roadmap.map((p, i) => (
              <div key={i} className={`cfc-roadmap-row cfc-roadmap-row--${p.status}`}>
                <span className="cfc-roadmap-phase">{p.phase.replace(/_/g, " ")}</span>
                <span className="cfc-roadmap-weeks">{p.estimatedWeeks}w</span>
                <span className="cfc-roadmap-status">{p.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {Object.keys(c.kpis || {}).length > 0 && (
        <div className="ic-detail-section">
          <p className="ic-detail-label">KPIs</p>
          <div className="cfc-kpi-grid">
            {Object.entries(c.kpis).map(([k, v]) => (
              <div key={k} className="cfc-kpi-tile">
                <span className="cfc-kpi-val">{v}</span>
                <span className="cfc-kpi-label">{k.replace(/_/g, " ")}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="ic-detail-actions">
        <button
          className="ic-detail-btn ic-detail-btn--primary"
          onClick={advance}
          disabled={busy || unmetGates.length > 0 || !stages[stages.indexOf(c.stage) + 1]}
          title={unmetGates.length > 0 ? `Unmet gates: ${unmetGates.join(", ")}` : undefined}
        >
          {stages[stages.indexOf(c.stage) + 1] ? `Advance to ${stages[stages.indexOf(c.stage) + 1]}` : "Final stage"}
        </button>
      </div>
      {toast && <div className="ic-toast">{toast}</div>}
    </div>
  );
}

export default function CompanyFactoryCenter() {
  const [dashboard, setDashboard] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [stages, setStages] = useState([]);
  const [gateDefs, setGateDefs] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [stageFilter, setStageFilter] = useState("all");
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const [dashRes, compRes, tplRes, stageRes] = await Promise.all([
      getFactoryDashboard(), listCompanies({ limit: 100 }), listTemplates(), getLifecycleStages(),
    ]);
    setLoading(false);
    if (dashRes?.ok === false && dashRes.status === 401) { setError("Sign in as operator to view the company factory."); return; }
    if (dashRes?.ok === false) { setError(dashRes.error || "Failed to load company factory."); return; }
    setDashboard(dashRes);
    setCompanies(compRes?.ok !== false ? (compRes.companies || []) : []);
    setTemplates(tplRes?.ok !== false ? (tplRes.templates || []) : []);
    setStages(stageRes?.ok !== false ? (stageRes.stages || []) : []);
    setGateDefs(stageRes?.ok !== false ? (stageRes.gates || {}) : {});
  }, []);

  useEffect(() => { load(); track.event("company_factory_viewed"); }, [load]);

  const filtered = useMemo(() => {
    if (stageFilter === "all") return companies;
    return companies.filter(c => c.stage === stageFilter);
  }, [companies, stageFilter]);

  const stageOptions = useMemo(() => ["all", ...stages], [stages]);

  if (loading) {
    return (
      <div className="integration-center cfc-root">
        <div className="cfc-skeleton" style={{ height: 40, width: "40%" }} />
        <div className="ic-grid">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="cfc-skeleton" style={{ height: 120 }} />)}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="integration-center cfc-root">
        <div className="ic-banner">
          <span className="ic-banner-icon">⚠</span>
          <div>
            <p className="ic-banner-title">Couldn't load company factory</p>
            <p className="ic-banner-sub">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="integration-center cfc-root">
      <div className="ic-header">
        <div>
          <h1 className="ic-title">Companies</h1>
          <p className="ic-subtitle">Every business you've launched through the Company Factory — one pipeline, one founder dashboard.</p>
        </div>
        <div className="ic-header-stat">
          <span className="ic-stat-num" style={{ color: "var(--accent)" }}>{dashboard?.summary?.totalCompanies ?? companies.length}</span>
          <span className="ic-stat-label">Companies</span>
        </div>
      </div>

      {dashboard?.summary && (
        <div className="cfc-summary-strip">
          <div className="cfc-summary-tile">
            <span className="cfc-summary-val" style={{ color: "var(--success)" }}>{dashboard.summary.launched}</span>
            <span className="cfc-summary-label">Launched</span>
          </div>
          <div className="cfc-summary-tile">
            <span className="cfc-summary-val" style={{ color: "var(--success)" }}>{dashboard.summary.scaled}</span>
            <span className="cfc-summary-label">Scaled</span>
          </div>
          <div className="cfc-summary-tile">
            <span className="cfc-summary-val" style={{ color: "var(--accent2)" }}>{dashboard.summary.avgReadiness}%</span>
            <span className="cfc-summary-label">Avg readiness</span>
          </div>
          <div className="cfc-summary-tile">
            <span className="cfc-summary-val" style={{ color: "var(--accent2)" }}>{Math.round((dashboard.summary.minutesSaved || 0) / 60)}h</span>
            <span className="cfc-summary-label">Saved</span>
          </div>
        </div>
      )}

      <div className="cfc-toolbar">
        <div className="ic-cats">
          {stageOptions.map(s => (
            <button key={s} className={`ic-cat${stageFilter === s ? " ic-cat--active" : ""}`} onClick={() => setStageFilter(s)}>
              {s === "all" ? "All" : s}
            </button>
          ))}
        </div>
        <button className="ic-detail-btn ic-detail-btn--primary" onClick={() => setShowCreate(true)}>+ New company</button>
      </div>

      {companies.length === 0 ? (
        <div className="cfc-empty">
          <p className="cfc-empty-title">No companies yet</p>
          <p className="cfc-empty-sub">Launch your first business — the factory generates a blueprint, workspace, and roadmap automatically.</p>
          <button className="ic-detail-btn ic-detail-btn--primary" onClick={() => setShowCreate(true)}>+ New company</button>
        </div>
      ) : (
        <div className="ic-layout">
          <div className="ic-grid">
            {filtered.map(c => (
              <CompanyCard key={c.id} company={c} selected={selectedId === c.id} onSelect={setSelectedId} />
            ))}
            {filtered.length === 0 && <p className="ic-detail-sub">No companies in this stage.</p>}
          </div>
          {selectedId && (
            <CompanyDetail
              companyId={selectedId}
              stages={stages}
              gateDefs={gateDefs}
              onClose={() => setSelectedId(null)}
              onChanged={load}
            />
          )}
        </div>
      )}

      {showCreate && (
        <CreateCompanyModal
          templates={templates}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); load(); }}
        />
      )}
    </div>
  );
}
