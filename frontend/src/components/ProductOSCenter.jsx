"use strict";
// A.8.3 recovery: Product OS Center — exposes productPlannerEngine.cjs +
// productReleaseEngine.cjs (/product-factory/*) and engineeringOrgState.cjs
// (/engorg/v2/*), both fully built with real persisted data (492KB of real
// product plans; 95 objectives / 66 epics / 243 work items / 36 blockers)
// but zero frontend consumers until this component. Same minimal recovery
// pattern already used for CustomerSuccessCenter.jsx — no new backend, no
// new storage, only exposing what already exists.
import React, { useState, useEffect, useCallback } from "react";
import * as pf from "../productFactoryApi";
import * as eo from "../engOrgApi";
import { clickableProps } from "../hooks/useClickableProps";

function Kpi({ value, label, color }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 6, padding: "10px 12px", border: "1px solid rgba(255,255,255,0.06)", textAlign: "center" }}>
      <div style={{ fontSize: 20, fontWeight: 800, color: color || "#e8ecf5", fontFamily: "monospace" }}>{value}</div>
      <div style={{ fontSize: 10, color: "var(--text-dim, #8994b0)", marginTop: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
    </div>
  );
}

const ROW = { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", background: "rgba(255,255,255,0.03)", borderRadius: 5, fontSize: 12, marginBottom: 4 };
const EMPTY = { fontSize: 12, color: "var(--text-dim, #8994b0)" };

const TABS = [
  { id: "plans",      label: "Product Plans" },
  { id: "objectives", label: "Objectives" },
  { id: "epics",      label: "Epics" },
  { id: "workitems",  label: "Work Items" },
  { id: "blockers",   label: "Blockers" },
];

const PRIORITY_COLOR = { critical: "var(--danger)", high: "var(--warning)", medium: "var(--info)", low: "var(--text-dim)" };

export default function ProductOSCenter() {
  const [tab, setTab] = useState("plans");
  const [dashboard, setDashboard]   = useState(null);
  const [plans, setPlans]           = useState([]);
  const [objectives, setObjectives] = useState([]);
  const [epics, setEpics]           = useState([]);
  const [workItems, setWorkItems]   = useState([]);
  const [blockers, setBlockers]     = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const [busy, setBusy]             = useState(false);

  // New-item forms
  const [newObjective, setNewObjective] = useState({ title: "", description: "" });
  const [newEpic, setNewEpic]           = useState({ title: "", description: "", objectiveId: "" });
  const [newPlan, setNewPlan]           = useState({ objective: "" });
  const [expandedPlan, setExpandedPlan] = useState(null);

  const refresh = useCallback(() => {
    setLoading(true);
    Promise.all([
      pf.getDashboard().catch(e => ({ ok: false, error: e.message })),
      pf.listPlans({ limit: 30 }).catch(e => ({ ok: false, error: e.message })),
      eo.listObjectives().catch(e => ({ success: false, error: e.message })),
      eo.listEpics().catch(e => ({ success: false, error: e.message })),
      eo.listWorkItems({ limit: 30 }).catch(e => ({ success: false, error: e.message })),
      eo.listBlockers({ resolved: false }).catch(e => ({ success: false, error: e.message })),
    ]).then(([d, p, o, e, w, b]) => {
      setDashboard(d?.ok !== false ? d : null);
      setPlans(p?.ok !== false ? (p.plans || []) : []);
      setObjectives(o?.success !== false ? (o.objectives || []) : []);
      setEpics(e?.success !== false ? (e.epics || []) : []);
      setWorkItems(w?.success !== false ? (w.workItems || []) : []);
      setBlockers(b?.success !== false ? (b.blockers || []) : []);
      setError(d?.ok === false ? (d.error || "Failed to load Product OS dashboard") : null);
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const submitPlan = async () => {
    if (!newPlan.objective.trim()) return;
    setBusy(true);
    try { await pf.createPlan({ objective: newPlan.objective.trim(), skipResearch: true }); setNewPlan({ objective: "" }); refresh(); }
    finally { setBusy(false); }
  };

  const submitObjective = async () => {
    if (!newObjective.title.trim()) return;
    setBusy(true);
    try { await eo.createObjective({ title: newObjective.title.trim(), description: newObjective.description.trim() }); setNewObjective({ title: "", description: "" }); refresh(); }
    finally { setBusy(false); }
  };

  const submitEpic = async () => {
    if (!newEpic.title.trim() || !newEpic.objectiveId) return;
    setBusy(true);
    try { await eo.createEpic({ title: newEpic.title.trim(), description: newEpic.description.trim(), objectiveId: newEpic.objectiveId }); setNewEpic({ title: "", description: "", objectiveId: "" }); refresh(); }
    finally { setBusy(false); }
  };

  const resolve = async (id) => {
    setBusy(true);
    try { await eo.resolveBlocker(id, { resolvedBy: "product-os-center" }); refresh(); }
    finally { setBusy(false); }
  };

  if (loading && !dashboard) return <div style={{ padding: 24, color: "var(--text-dim, #8994b0)" }}>Loading Product OS…</div>;
  if (error && !dashboard) return (
    <div style={{ padding: 24 }}>
      <div style={{ color: "var(--danger)", marginBottom: 8 }}>⚠ {error}</div>
      <button onClick={refresh}>Retry</button>
    </div>
  );

  const s = dashboard?.summary || {};

  return (
    <div style={{ padding: 20, maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Product OS</h2>
        <button onClick={refresh} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>
      </div>
      <p style={{ fontSize: 12, color: "var(--text-dim, #8994b0)", marginTop: 0, marginBottom: 16 }}>
        Product plans, requirements, roadmaps and release planning (Product Factory) · Objectives, epics, work items and blockers (Engineering Organization).
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10, marginBottom: 16 }}>
        <Kpi value={s.plansCreated ?? "—"} label="Plans Created" color="var(--accent)" />
        <Kpi value={s.releasesReady ?? "—"} label="Releases Ready" color="var(--success)" />
        <Kpi value={objectives.length} label="Objectives" color="var(--info)" />
        <Kpi value={epics.length} label="Epics" color="var(--warning)" />
        <Kpi value={blockers.length} label="Open Blockers" color="var(--danger)" />
      </div>

      <nav style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ fontWeight: tab === t.id ? 700 : 400, opacity: tab === t.id ? 1 : 0.6 }}>
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "plans" && (
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <input
              style={{ flex: 1 }}
              placeholder="Describe a product objective (e.g. Build a customer feedback portal with AI analysis)…"
              value={newPlan.objective}
              onChange={e => setNewPlan({ objective: e.target.value })}
            />
            <button onClick={submitPlan} disabled={busy || !newPlan.objective.trim()}>Generate Plan</button>
          </div>
          {plans.length === 0 ? <div style={EMPTY}>No product plans yet.</div> : plans.map(p => (
            <div key={p.id} style={{ marginBottom: 6 }}>
              <div style={{ ...ROW, cursor: "pointer" }} {...clickableProps(() => setExpandedPlan(expandedPlan === p.id ? null : p.id))}>
                <span>{p.objective}</span>
                <span style={{ color: p.status === "approved" ? "var(--success)" : "var(--warning)" }}>{p.status} · {p.complexity?.level || "—"}</span>
              </div>
              {expandedPlan === p.id && (
                <div style={{ padding: "8px 12px", fontSize: 11, color: "var(--text-dim, #8994b0)", background: "rgba(255,255,255,0.02)", borderRadius: 5, marginTop: -2, marginBottom: 6 }}>
                  <div style={{ marginBottom: 6 }}><strong>Requirements:</strong> {(p.requirements || []).join(" · ")}</div>
                  {p.roadmap && (
                    <div><strong>Roadmap:</strong> {p.roadmap.phases?.map(ph => ph.label).join(" → ")} ({p.roadmap.estimatedDays}d, {p.roadmap.sprints} sprints)</div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === "objectives" && (
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <input style={{ flex: 1 }} placeholder="Objective title…" value={newObjective.title} onChange={e => setNewObjective(o => ({ ...o, title: e.target.value }))} />
            <input style={{ flex: 2 }} placeholder="Description…" value={newObjective.description} onChange={e => setNewObjective(o => ({ ...o, description: e.target.value }))} />
            <button onClick={submitObjective} disabled={busy || !newObjective.title.trim()}>Add Objective</button>
          </div>
          {objectives.length === 0 ? <div style={EMPTY}>No objectives yet.</div> : objectives.map(o => (
            <div key={o.id} style={ROW}>
              <span>{o.title}</span>
              <span style={{ color: o.status === "completed" ? "var(--success)" : "var(--info)" }}>{o.status} · {(o.epicIds || []).length} epics</span>
            </div>
          ))}
        </div>
      )}

      {tab === "epics" && (
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <input style={{ flex: 1 }} placeholder="Epic title…" value={newEpic.title} onChange={e => setNewEpic(x => ({ ...x, title: e.target.value }))} />
            <select value={newEpic.objectiveId} onChange={e => setNewEpic(x => ({ ...x, objectiveId: e.target.value }))}>
              <option value="">Select objective…</option>
              {objectives.map(o => <option key={o.id} value={o.id}>{o.title}</option>)}
            </select>
            <button onClick={submitEpic} disabled={busy || !newEpic.title.trim() || !newEpic.objectiveId}>Add Epic</button>
          </div>
          {epics.length === 0 ? <div style={EMPTY}>No epics yet.</div> : epics.map(ep => (
            <div key={ep.id} style={ROW}>
              <span>{ep.title}</span>
              <span style={{ color: PRIORITY_COLOR[ep.priority] || "var(--text-dim)" }}>{ep.priority} · {ep.status} · {(ep.workItemIds || []).length} items</span>
            </div>
          ))}
        </div>
      )}

      {tab === "workitems" && (
        <div>
          {workItems.length === 0 ? <div style={EMPTY}>No work items yet.</div> : workItems.map(w => (
            <div key={w.id} style={ROW}>
              <span>{w.title}</span>
              <span style={{ color: PRIORITY_COLOR[w.priority] || "var(--text-dim)" }}>{w.priority} · {w.status}</span>
            </div>
          ))}
        </div>
      )}

      {tab === "blockers" && (
        <div>
          {blockers.length === 0 ? <div style={EMPTY}>No open blockers.</div> : blockers.map(b => (
            <div key={b.id} style={ROW}>
              <span>{b.description}</span>
              <button disabled={busy} onClick={() => resolve(b.id)}>Resolve</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
