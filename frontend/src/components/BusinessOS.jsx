import React, { useState, useEffect, useCallback, useRef } from "react";
import { _fetch } from "../_client";
import {
  getBusinessDashboard, getBusinessDailySummary, getBusinessWeeklySummary, getPipelineSummary,
  getLeadsV5, createBizLead, updateBizLead, qualifyBizLead, disqualifyBizLead, deleteBizLead,
  getContacts, createContact, updateContact, deleteContact,
  getOpportunities, createOpportunity, updateOpportunity, advanceOppStage, closeWon, closeLost,
  getCampaigns, createCampaign, updateCampaign, recordCampaignEvent, completeCampaign,
  getRevenue, recordRevenue, getRevenueStats,
  getCustomers, createCustomer,
  getBusinessRecommendations, acceptBusinessRecommendation, dismissBusinessRecommendation,
} from "../businessApi";
import { useConfirm } from "./ConfirmDialog";
import "./BusinessOS.css";

// ── Helpers ───────────────────────────────────────────────────────

function _timeAgo(isoStr) {
  if (!isoStr) return "";
  const diff = Date.now() - new Date(isoStr).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1)   return "just now";
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function _fmtDate(isoStr) {
  if (!isoStr) return "—";
  return new Date(isoStr).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function _fmtAmt(amount, currency = "USD") {
  if (amount == null) return "—";
  return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0, minimumFractionDigits: 0 }).format(amount);
}

const STAGE_ORDER   = ["prospect", "qualified", "proposal", "negotiation", "closed-won", "closed-lost"];
const STAGE_COLOR   = { prospect: "var(--bos-muted)", qualified: "var(--accent)", proposal: "var(--warning)", negotiation: "var(--accent2)", "closed-won": "var(--success)", "closed-lost": "var(--danger)" };
const LEAD_STATUS_COLOR = { new: "var(--accent)", contacted: "var(--accent2)", qualified: "var(--success)", disqualified: "var(--danger)", converted: "var(--warning)" };

// ── Sub-nav ───────────────────────────────────────────────────────
const VIEWS = [
  { id: "dashboard",     label: "Overview"      },
  { id: "leads",         label: "Leads"         },
  { id: "contacts",      label: "Contacts"      },
  { id: "opportunities", label: "Pipeline"      },
  { id: "customers",     label: "Customers"     },
  { id: "campaigns",     label: "Campaigns"     },
  { id: "revenue",       label: "Revenue"       },
  { id: "suggestions",   label: "AI Suggestions"},
  { id: "reasoning",     label: "Reasoning"     },
];

// ── Shared UI atoms ───────────────────────────────────────────────

function Badge({ label, color }) {
  return <span className="bos-badge" style={{ color, borderColor: color + "44", background: color + "11" }}>{label}</span>;
}

function Skeleton() {
  return <div className="bos-skeleton-wrap"><div className="bos-skeleton" /><div className="bos-skeleton bos-skeleton--sm" /></div>;
}

function Empty({ title, sub }) {
  return <div className="bos-empty"><p className="bos-empty-title">{title}</p><p className="bos-empty-sub">{sub}</p></div>;
}

// A real fetch failure is tracked as a distinct error state instead of
// falling through to the "no records yet" empty state.
function BosError({ error, onRetry }) {
  return (
    <div className="bos-error">
      <p className="bos-error-title">Couldn't load this data</p>
      <p className="bos-error-sub">{error}</p>
      <button className="bos-error-retry" onClick={onRetry}>Retry</button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// DASHBOARD VIEW
// ═══════════════════════════════════════════════════════════════════

function DashboardView({ onToast }) {
  const [dash,    setDash]    = useState(null);
  const [daily,   setDaily]   = useState(null);
  const [weekly,  setWeekly]  = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, s, w] = await Promise.all([
        getBusinessDashboard(),
        getBusinessDailySummary(),
        getBusinessWeeklySummary(),
      ]);
      if (d.success !== false) setDash(d);
      if (s.success !== false) setDaily(s);
      if (w.success !== false) setWeekly(w);
      setError(null);
    } catch (e) {
      setError(e.message || "Failed to load business overview");
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Skeleton />;
  if (error) return <BosError error={error} onRetry={load} />;

  return (
    <div className="bos-section">
      <div className="bos-section-header">
        <h3 className="bos-section-title">Business Overview</h3>
        <button className="bos-btn outline" onClick={load}>Refresh</button>
      </div>

      {/* KPI grid */}
      {dash && (
        <div className="bos-stats-grid">
          <div className="bos-stat-card">
            <div className="bos-stat-val" style={{ color: "var(--accent)" }}>{dash.leads?.total ?? 0}</div>
            <div className="bos-stat-lbl">Total Leads</div>
            <div className="bos-stat-sub">{dash.leads?.new ?? 0} new</div>
          </div>
          <div className="bos-stat-card">
            <div className="bos-stat-val" style={{ color: "var(--accent2)" }}>{dash.pipeline?.openCount ?? 0}</div>
            <div className="bos-stat-lbl">Open Deals</div>
            <div className="bos-stat-sub">{_fmtAmt(dash.pipeline?.totalPipelineValue)} pipeline</div>
          </div>
          <div className="bos-stat-card">
            <div className="bos-stat-val" style={{ color: "var(--success)" }}>{_fmtAmt(dash.revenue?.thisMonth)}</div>
            <div className="bos-stat-lbl">Revenue (Month)</div>
            <div className="bos-stat-sub">{_fmtAmt(dash.revenue?.today)} today</div>
          </div>
          <div className="bos-stat-card">
            <div className="bos-stat-val" style={{ color: "var(--warning)" }}>{dash.campaigns?.active ?? 0}</div>
            <div className="bos-stat-lbl">Active Campaigns</div>
          </div>
        </div>
      )}

      {/* Weighted pipeline */}
      {dash?.pipeline?.stages && (
        <div className="bos-dash-block">
          <h4 className="bos-block-title">Pipeline by Stage</h4>
          <div className="bos-pipeline-bars">
            {STAGE_ORDER.filter(s => !["closed-won","closed-lost"].includes(s)).map(stage => {
              const d = dash.pipeline.stages[stage] || { count: 0, value: 0 };
              return (
                <div key={stage} className="bos-pipe-row">
                  <span className="bos-pipe-label" style={{ color: STAGE_COLOR[stage] }}>{stage}</span>
                  <div className="bos-pipe-track">
                    <div className="bos-pipe-fill"
                      style={{ width: d.count > 0 ? `${Math.min(100, d.count * 15)}%` : "0%", background: STAGE_COLOR[stage] }} />
                  </div>
                  <span className="bos-pipe-count">{d.count}</span>
                  <span className="bos-pipe-val">{_fmtAmt(d.value)}</span>
                </div>
              );
            })}
          </div>
          <div className="bos-pipeline-footer">
            Weighted value: <strong style={{ color: "var(--accent2)" }}>{_fmtAmt(dash.pipeline.weightedValue)}</strong>
          </div>
        </div>
      )}

      {/* Today highlights */}
      {daily?.highlights?.length > 0 && (
        <div className="bos-dash-block">
          <h4 className="bos-block-title">Today</h4>
          {daily.highlights.map((h, i) => (
            <div key={i} className="bos-highlight-row">
              <span className="bos-highlight-dot" />
              <span>{h}</span>
            </div>
          ))}
        </div>
      )}

      {weekly && (
        <div className="bos-dash-block">
          <h4 className="bos-block-title">Weekly Summary</h4>
          <div className="bos-split-row">
            <div>
              <strong>{_fmtAmt(weekly.revenue?.weekTotal)}</strong>
              <div className="bos-text-dim">Revenue this week</div>
            </div>
            <div>
              <strong>{weekly.newLeads ?? 0}</strong>
              <div className="bos-text-dim">New leads</div>
            </div>
            <div>
              <strong>{weekly.closedDeals ?? 0}</strong>
              <div className="bos-text-dim">Closed deals</div>
            </div>
          </div>
        </div>
      )}

      {/* Urgent opportunities */}
      {dash?.urgentOpportunities?.length > 0 && (
        <div className="bos-dash-block">
          <h4 className="bos-block-title">High-Probability Deals</h4>
          {dash.urgentOpportunities.map(o => (
            <div key={o.id} className="bos-opp-compact">
              <span className="bos-opp-title">{o.title}</span>
              <span className="bos-opp-val">{_fmtAmt(o.value, o.currency)}</span>
              <Badge label={o.stage} color={STAGE_COLOR[o.stage]} />
            </div>
          ))}
        </div>
      )}

      {/* Active campaigns */}
      {dash?.campaigns?.list?.length > 0 && (
        <div className="bos-dash-block">
          <h4 className="bos-block-title">Active Campaigns</h4>
          {dash.campaigns.list.map(c => (
            <div key={c.id} className="bos-camp-compact">
              <span className="bos-camp-name">{c.name}</span>
              <span className="bos-camp-channel">{c.channel}</span>
              <span className="bos-camp-budget">Budget: {_fmtAmt(c.budget)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// LEADS VIEW
// ═══════════════════════════════════════════════════════════════════

const EMPTY_LEAD = { name: "", email: "", phone: "", company: "", source: "inbound", score: 50, notes: "" };

function LeadsView({ onToast }) {
  const [leads,    setLeads]   = useState(null);
  const [loading,  setLoading] = useState(true);
  const [error,    setError]   = useState(null);
  const [filter,   setFilter]  = useState("new");
  const [form,     setForm]    = useState(EMPTY_LEAD);
  const [editing,  setEditing] = useState(null);
  const [saving,   setSaving]  = useState(false);
  const [showForm, setShowForm]= useState(false);
  const nameRef = useRef(null);
  const [confirm, ConfirmUI] = useConfirm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await getLeadsV5({ status: filter === "all" ? undefined : filter, limit: 100 });
      setLeads(r.leads ?? (Array.isArray(r) ? r : []));
      setError(null);
    } catch (e) {
      setError(e.message || "Failed to load leads");
    }
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const openNew = () => {
    setForm(EMPTY_LEAD); setEditing(null); setShowForm(true);
    setTimeout(() => nameRef.current?.focus(), 50);
  };

  const openEdit = (lead) => {
    setForm({ name: lead.name, email: lead.email || "", phone: lead.phone || "", company: lead.company || "", source: lead.source, score: lead.score, notes: lead.notes || "" });
    setEditing(lead.id); setShowForm(true);
    setTimeout(() => nameRef.current?.focus(), 50);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { onToast?.("error", "Name is required"); return; }
    setSaving(true);
    const payload = { ...form, score: Number(form.score) };
    const r = editing ? await updateBizLead(editing, payload) : await createBizLead(payload);
    if (r.ok === false || r.success === false) onToast?.("error", r.error || "Save failed");
    else { onToast?.("success", editing ? "Lead updated" : "Lead created"); setShowForm(false); load(); }
    setSaving(false);
  };

  const handleQualify = async (leadId) => {
    const r = await qualifyBizLead(leadId);
    if (r.success !== false) { onToast?.("success", "Lead qualified"); load(); }
    else onToast?.("error", r.error || "Failed to qualify lead");
  };

  const handleDisqualify = async (leadId) => {
    const r = await disqualifyBizLead(leadId, "Not a fit");
    if (r.success !== false) { onToast?.("success", "Lead disqualified"); load(); }
    else onToast?.("error", r.error || "Failed to disqualify lead");
  };

  const handleConvert = async (leadId) => {
    const r = await updateBizLead(leadId, { status: "converted" });
    if (r.success !== false) { onToast?.("success", "Lead converted to customer"); load(); }
    else onToast?.("error", r.error || "Failed to convert lead");
  };

  const handleDelete = async (leadId) => {
    if (!await confirm({ title: "Delete this lead?", message: "This cannot be undone.", danger: true, confirmLabel: "Delete" })) return;
    const r = await deleteBizLead(leadId);
    if (r.success !== false) { onToast?.("success", "Lead deleted"); load(); }
    else onToast?.("error", r.error || "Failed to delete lead");
  };

  return (
    <div className="bos-section">
      {ConfirmUI}
      <div className="bos-section-header">
        <h3 className="bos-section-title">Leads</h3>
        <button className="bos-btn primary" onClick={openNew}>+ New Lead</button>
      </div>

      <div className="bos-filter-row">
        {["new","contacted","qualified","disqualified","all"].map(f => (
          <button key={f} className={`bos-filter-btn ${filter === f ? "active" : ""}`} onClick={() => setFilter(f)}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {showForm && (
        <div className="bos-form-card">
          <div className="bos-form-row">
            <input ref={nameRef} className="bos-input" placeholder="Name *" value={form.name} onChange={e => setF("name", e.target.value)} />
            <input className="bos-input" placeholder="Company" value={form.company} onChange={e => setF("company", e.target.value)} />
          </div>
          <div className="bos-form-row">
            <input className="bos-input" placeholder="Email" value={form.email} onChange={e => setF("email", e.target.value)} />
            <input className="bos-input" placeholder="Phone" value={form.phone} onChange={e => setF("phone", e.target.value)} />
          </div>
          <div className="bos-form-row">
            <select className="bos-select" value={form.source} onChange={e => setF("source", e.target.value)}>
              {["inbound","referral","ads","event","cold","other"].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <div className="bos-score-row">
              <label className="bos-score-label">Score: {form.score}</label>
              <input type="range" min="1" max="100" value={form.score} onChange={e => setF("score", e.target.value)} className="bos-range" />
            </div>
          </div>
          <textarea className="bos-input bos-textarea" placeholder="Notes" rows={2} value={form.notes} onChange={e => setF("notes", e.target.value)} />
          <div className="bos-form-actions">
            <button className="bos-btn primary" onClick={handleSave} disabled={saving}>{saving ? "Saving…" : editing ? "Save Changes" : "Create Lead"}</button>
            <button className="bos-btn outline" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      {loading ? <Skeleton /> : error ? (
        <BosError error={error} onRetry={load} />
      ) : !leads?.length ? (
        <Empty title={`No ${filter === "all" ? "" : filter} leads`} sub="Create your first lead above." />
      ) : (
        <table className="bos-table">
          <thead><tr><th>Name</th><th>Company</th><th>Source</th><th>Score</th><th>Status</th><th>Created</th><th></th></tr></thead>
          <tbody>
            {leads.map(l => (
              <tr key={l.id}>
                <td className="bos-td-name">{l.name}</td>
                <td className="bos-td-dim">{l.company || "—"}</td>
                <td className="bos-td-dim">{l.source}</td>
                <td><div className="bos-score-bar"><div className="bos-score-fill" style={{ width: `${l.score}%` }} /></div></td>
                <td><Badge label={l.status} color={LEAD_STATUS_COLOR[l.status] || "var(--text-dim)"} /></td>
                <td className="bos-td-dim">{_fmtDate(l.createdAt)}</td>
                <td className="bos-td-actions">
                  {l.status === "new" || l.status === "contacted"
                    ? <button className="bos-icon-btn" title="Qualify" onClick={() => handleQualify(l.id)}>✓</button>
                    : l.status === "qualified"
                    ? <button className="bos-icon-btn warn" title="Disqualify" onClick={() => handleDisqualify(l.id)}>✗</button>
                    : null}
                  {l.status === "qualified" &&
                    <button className="bos-icon-btn" title="Convert to Customer" onClick={() => handleConvert(l.id)}>⇒</button>}
                  <button className="bos-icon-btn" title="Edit" onClick={() => openEdit(l)}>✎</button>
                  <button className="bos-icon-btn danger" title="Delete" onClick={() => handleDelete(l.id)}>🗑</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// CONTACTS VIEW
// ═══════════════════════════════════════════════════════════════════

const EMPTY_CONTACT = { name: "", email: "", phone: "", company: "", title: "", notes: "" };

function ContactsView({ onToast }) {
  const [contacts, setContacts] = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [search,   setSearch]   = useState("");
  const [form,     setForm]     = useState(EMPTY_CONTACT);
  const [editing,  setEditing]  = useState(null);
  const [saving,   setSaving]   = useState(false);
  const [showForm, setShowForm] = useState(false);
  const nameRef = useRef(null);
  const [confirm, ConfirmUI] = useConfirm();

  const load = useCallback(async () => {
    setLoading(true);
    const r = await getContacts({ search: search || undefined, limit: 100 });
    setContacts(r.contacts ?? (Array.isArray(r) ? r : []));
    setLoading(false);
  }, [search]);

  useEffect(() => {
    const t = setTimeout(() => load(), search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const openNew = () => {
    setForm(EMPTY_CONTACT); setEditing(null); setShowForm(true);
    setTimeout(() => nameRef.current?.focus(), 50);
  };

  const openEdit = (c) => {
    setForm({ name: c.name, email: c.email || "", phone: c.phone || "", company: c.company || "", title: c.title || "", notes: c.notes || "" });
    setEditing(c.id); setShowForm(true);
    setTimeout(() => nameRef.current?.focus(), 50);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { onToast?.("error", "Name is required"); return; }
    setSaving(true);
    const r = editing ? await updateContact(editing, form) : await createContact(form);
    if (r.ok === false || r.success === false) onToast?.("error", r.error || "Save failed");
    else { onToast?.("success", editing ? "Contact updated" : "Contact created"); setShowForm(false); load(); }
    setSaving(false);
  };

  const handleDelete = async (contactId) => {
    if (!await confirm({ title: "Delete this contact?", message: "This cannot be undone.", danger: true, confirmLabel: "Delete" })) return;
    const r = await deleteContact(contactId);
    if (r.success !== false) { onToast?.("success", "Contact deleted"); load(); }
    else onToast?.("error", r.error || "Failed to delete contact");
  };

  return (
    <div className="bos-section">
      {ConfirmUI}
      <div className="bos-section-header">
        <h3 className="bos-section-title">Contacts</h3>
        <button className="bos-btn primary" onClick={openNew}>+ New Contact</button>
      </div>

      <input className="bos-input bos-search" placeholder="Search by name, email, or company…" value={search} onChange={e => setSearch(e.target.value)} />

      {showForm && (
        <div className="bos-form-card">
          <div className="bos-form-row">
            <input ref={nameRef} className="bos-input" placeholder="Name *" value={form.name} onChange={e => setF("name", e.target.value)} />
            <input className="bos-input" placeholder="Title / Role" value={form.title} onChange={e => setF("title", e.target.value)} />
          </div>
          <div className="bos-form-row">
            <input className="bos-input" placeholder="Email" value={form.email} onChange={e => setF("email", e.target.value)} />
            <input className="bos-input" placeholder="Phone" value={form.phone} onChange={e => setF("phone", e.target.value)} />
          </div>
          <input className="bos-input" placeholder="Company" value={form.company} onChange={e => setF("company", e.target.value)} />
          <textarea className="bos-input bos-textarea" placeholder="Notes" rows={2} value={form.notes} onChange={e => setF("notes", e.target.value)} />
          <div className="bos-form-actions">
            <button className="bos-btn primary" onClick={handleSave} disabled={saving}>{saving ? "Saving…" : editing ? "Save Changes" : "Create Contact"}</button>
            <button className="bos-btn outline" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      {loading ? <Skeleton /> : !contacts?.length ? (
        <Empty title={search ? "No contacts found" : "No contacts yet"} sub={search ? "Try a different search." : "Add your first contact above."} />
      ) : (
        <table className="bos-table">
          <thead><tr><th>Name</th><th>Title</th><th>Company</th><th>Email</th><th>Opportunities</th><th></th></tr></thead>
          <tbody>
            {contacts.map(c => (
              <tr key={c.id}>
                <td className="bos-td-name">{c.name}</td>
                <td className="bos-td-dim">{c.title || "—"}</td>
                <td className="bos-td-dim">{c.company || "—"}</td>
                <td className="bos-td-dim">{c.email || "—"}</td>
                <td className="bos-td-dim">{c.opportunityIds?.length ?? 0}</td>
                <td className="bos-td-actions">
                  <button className="bos-icon-btn" title="Edit" onClick={() => openEdit(c)}>✎</button>
                  <button className="bos-icon-btn danger" title="Delete" onClick={() => handleDelete(c.id)}>🗑</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// OPPORTUNITIES / PIPELINE VIEW
// ═══════════════════════════════════════════════════════════════════

const EMPTY_OPP = { title: "", value: "", currency: "USD", stage: "prospect", company: "", assignee: "", notes: "" };

function OpportunitiesView({ onToast }) {
  const [opps,    setOpps]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [filter,  setFilter]  = useState("all");
  const [form,    setForm]    = useState(EMPTY_OPP);
  const [editing, setEditing] = useState(null);
  const [saving,  setSaving]  = useState(false);
  const [showForm,setShowForm]= useState(false);
  const titleRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await getOpportunities({ stage: filter === "all" ? undefined : filter, limit: 100 });
      setOpps(r.opportunities ?? (Array.isArray(r) ? r : []));
      setError(null);
    } catch (e) {
      setError(e.message || "Failed to load pipeline");
    }
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const openNew = () => {
    setForm(EMPTY_OPP); setEditing(null); setShowForm(true);
    setTimeout(() => titleRef.current?.focus(), 50);
  };

  const openEdit = (o) => {
    setForm({ title: o.title, value: String(o.value), currency: o.currency, stage: o.stage, company: o.company || "", assignee: o.assignee || "", notes: o.notes || "" });
    setEditing(o.id); setShowForm(true);
    setTimeout(() => titleRef.current?.focus(), 50);
  };

  const handleSave = async () => {
    if (!form.title.trim()) { onToast?.("error", "Title is required"); return; }
    setSaving(true);
    const payload = { ...form, value: Number(form.value) || 0 };
    const r = editing ? await updateOpportunity(editing, payload) : await createOpportunity(payload);
    if (r.ok === false || r.success === false) onToast?.("error", r.error || "Save failed");
    else { onToast?.("success", editing ? "Deal updated" : "Deal created"); setShowForm(false); load(); }
    setSaving(false);
  };

  const handleAdvance = async (oppId, currentStage) => {
    const idx  = STAGE_ORDER.indexOf(currentStage);
    const next = STAGE_ORDER[Math.min(idx + 1, 3)];   // max advance to negotiation
    const r = await advanceOppStage(oppId, next);
    if (r.success !== false) { onToast?.("success", `Advanced to ${next}`); load(); }
    else onToast?.("error", r.error || "Failed to advance deal");
  };

  const handleCloseWon = async (oppId) => {
    const r = await closeWon(oppId, { notes: "Closed from UI" });
    if (r.success !== false) { onToast?.("success", "Deal closed — won! 🎉"); load(); }
    else onToast?.("error", r.error || "Failed to close deal");
  };

  const handleCloseLost = async (oppId) => {
    const r = await closeLost(oppId, "Closed from UI");
    if (r.success !== false) { onToast?.("success", "Deal marked closed-lost"); load(); }
    else onToast?.("error", r.error || "Failed to close deal");
  };

  const openDeals = opps?.filter(o => !["closed-won","closed-lost"].includes(o.stage));

  return (
    <div className="bos-section">
      <div className="bos-section-header">
        <h3 className="bos-section-title">Pipeline</h3>
        <button className="bos-btn primary" onClick={openNew}>+ New Deal</button>
      </div>

      <div className="bos-filter-row">
        {["all", ...STAGE_ORDER].map(f => (
          <button key={f} className={`bos-filter-btn ${filter === f ? "active" : ""}`}
            style={filter === f && f !== "all" ? { color: STAGE_COLOR[f] } : {}}
            onClick={() => setFilter(f)}>
            {f.charAt(0).toUpperCase() + f.slice(1).replace("-", " ")}
          </button>
        ))}
      </div>

      {showForm && (
        <div className="bos-form-card">
          <input ref={titleRef} className="bos-input" placeholder="Deal title *" value={form.title} onChange={e => setF("title", e.target.value)} />
          <div className="bos-form-row">
            <input className="bos-input" placeholder="Value (amount)" value={form.value} type="number" min="0" onChange={e => setF("value", e.target.value)} />
            <select className="bos-select" value={form.currency} onChange={e => setF("currency", e.target.value)}>
              {["USD","EUR","GBP","INR","AUD","CAD"].map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="bos-form-row">
            <select className="bos-select" value={form.stage} onChange={e => setF("stage", e.target.value)}>
              {STAGE_ORDER.slice(0, 4).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <input className="bos-input" placeholder="Company" value={form.company} onChange={e => setF("company", e.target.value)} />
          </div>
          <input className="bos-input" placeholder="Assignee" value={form.assignee} onChange={e => setF("assignee", e.target.value)} />
          <textarea className="bos-input bos-textarea" placeholder="Notes" rows={2} value={form.notes} onChange={e => setF("notes", e.target.value)} />
          <div className="bos-form-actions">
            <button className="bos-btn primary" onClick={handleSave} disabled={saving}>{saving ? "Saving…" : editing ? "Save Changes" : "Create Deal"}</button>
            <button className="bos-btn outline" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      {loading ? <Skeleton /> : error ? (
        <BosError error={error} onRetry={load} />
      ) : !opps?.length ? (
        <Empty title="No deals" sub="Create your first opportunity above." />
      ) : (
        <div className="bos-opp-list">
          {opps.map(o => {
            const isOpen = !["closed-won","closed-lost"].includes(o.stage);
            return (
              <div key={o.id} className={`bos-opp-card ${o.stage}`}>
                <div className="bos-opp-card-top">
                  <div className="bos-opp-card-left">
                    <span className="bos-opp-card-title">{o.title}</span>
                    {o.company && <span className="bos-opp-card-company">{o.company}</span>}
                  </div>
                  <div className="bos-opp-card-right">
                    <span className="bos-opp-card-value">{_fmtAmt(o.value, o.currency)}</span>
                    <Badge label={o.stage} color={STAGE_COLOR[o.stage]} />
                  </div>
                </div>
                <div className="bos-opp-card-meta">
                  {/* MASTER GAP CLOSURE (2026-08-15, C10-026 pass): the backend
                      opportunity record (businessDataService.cjs) has no
                      `probability` field — this line previously rendered
                      "Probability: undefined%" on every card, a fabricated-
                      looking number with no real measurement behind it.
                      Removed rather than invented; if a real probability
                      model is added to the backend later, render it here
                      from that real field. */}
                  {o.assignee && <span className="bos-opp-assign">{o.assignee}</span>}
                  <span className="bos-opp-age">{_timeAgo(o.createdAt)}</span>
                </div>
                {isOpen && (
                  <div className="bos-opp-card-actions">
                    {STAGE_ORDER.indexOf(o.stage) < 3 &&
                      <button className="bos-btn outline bos-btn--xs" onClick={() => handleAdvance(o.id, o.stage)}>Advance →</button>}
                    <button className="bos-btn success bos-btn--xs" onClick={() => handleCloseWon(o.id)}>Won ✓</button>
                    <button className="bos-btn danger  bos-btn--xs" onClick={() => handleCloseLost(o.id)}>Lost ✗</button>
                    <button className="bos-icon-btn" title="Edit" onClick={() => openEdit(o)}>✎</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// CUSTOMERS VIEW — mission-layer entities (customer success plays),
// distinct from CRM Contacts. Each "customer" is a tracked Mission
// Runtime record, not a bds row — no PATCH/DELETE, only create + list.
// ═══════════════════════════════════════════════════════════════════

const EMPTY_CUSTOMER = { name: "", phone: "", email: "", plan: "", status: "active", action: "" };
const CUSTOMER_STATUS_COLOR = { active: "var(--success)", at_risk: "var(--danger)", churned: "var(--text-dim)" };

function CustomersView({ onToast, onNavigate }) {
  const [missions, setMissions] = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);
  const [filter,   setFilter]   = useState("all");
  const [form,     setForm]     = useState(EMPTY_CUSTOMER);
  const [saving,   setSaving]   = useState(false);
  const [showForm, setShowForm] = useState(false);
  const nameRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await getCustomers({ status: filter === "all" ? undefined : filter });
      setMissions(r.missions ?? (Array.isArray(r) ? r : []));
      setError(null);
    } catch (e) {
      setError(e.message || "Failed to load customers");
    }
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const openNew = () => {
    setForm(EMPTY_CUSTOMER); setShowForm(true);
    setTimeout(() => nameRef.current?.focus(), 50);
  };

  const handleSave = async () => {
    if (!form.name.trim() && !form.phone.trim() && !form.email.trim()) { onToast?.("error", "Name, phone, or email is required"); return; }
    setSaving(true);
    const r = await createCustomer(form);
    if (r.success === false) onToast?.("error", r.error || "Save failed");
    else { onToast?.("success", "Customer success mission created"); setShowForm(false); load(); }
    setSaving(false);
  };

  return (
    <div className="bos-section">
      <div className="bos-section-header">
        <h3 className="bos-section-title">Customers</h3>
        <button className="bos-btn primary" onClick={openNew}>+ New Customer Play</button>
      </div>
      <p className="bos-text-dim" style={{ marginBottom: 12 }}>
        Customer success plays run as tracked missions — health checks, retention actions, and at-risk escalation, separate from the Contacts directory.
      </p>

      <div className="bos-filter-row">
        {["all","active","at_risk","churned"].map(f => (
          <button key={f} className={`bos-filter-btn ${filter === f ? "active" : ""}`} onClick={() => setFilter(f)}>
            {f === "at_risk" ? "At Risk" : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {showForm && (
        <div className="bos-form-card">
          <div className="bos-form-row">
            <input ref={nameRef} className="bos-input" placeholder="Customer name" value={form.name} onChange={e => setF("name", e.target.value)} />
            <input className="bos-input" placeholder="Plan" value={form.plan} onChange={e => setF("plan", e.target.value)} />
          </div>
          <div className="bos-form-row">
            <input className="bos-input" placeholder="Phone" value={form.phone} onChange={e => setF("phone", e.target.value)} />
            <input className="bos-input" placeholder="Email" value={form.email} onChange={e => setF("email", e.target.value)} />
          </div>
          <div className="bos-form-row">
            <select className="bos-select" value={form.status} onChange={e => setF("status", e.target.value)}>
              {["active","at_risk","churned"].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <input className="bos-input" placeholder="Action (e.g. Retain, Onboard, Renew)" value={form.action} onChange={e => setF("action", e.target.value)} />
          </div>
          <div className="bos-form-actions">
            <button className="bos-btn primary" onClick={handleSave} disabled={saving}>{saving ? "Creating…" : "Create Play"}</button>
            <button className="bos-btn outline" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      {loading ? <Skeleton /> : error ? (
        <BosError error={error} onRetry={load} />
      ) : !missions?.length ? (
        <Empty title={`No ${filter === "all" ? "" : filter.replace("_"," ")} customer plays`} sub="Create a customer success play above." />
      ) : (
        <div className="bos-opp-list">
          {missions.map(m => {
            const meta = m.metadata || {};
            return (
              <div key={m.id || m.missionId} className="bos-opp-card">
                <div className="bos-opp-card-top">
                  <div className="bos-opp-card-left">
                    <span className="bos-opp-card-title">{m.objective}</span>
                    {meta.plan && <span className="bos-opp-card-company">{meta.plan}</span>}
                  </div>
                  <div className="bos-opp-card-right">
                    <Badge label={meta.status || "active"} color={CUSTOMER_STATUS_COLOR[meta.status] || "var(--text-dim)"} />
                  </div>
                </div>
                <div className="bos-opp-card-meta">
                  <span className="bos-opp-prob">Priority: {m.priority}</span>
                  <span className="bos-opp-age">{_timeAgo(m.createdAt)}</span>
                </div>
                {m.subtasks?.length > 0 && (
                  <div className="bos-camp-metrics" style={{ marginTop: 8 }}>
                    {m.subtasks.map((s, i) => (
                      <div key={i} className="bos-highlight-row"><span className="bos-highlight-dot" /><span>{s.description}</span></div>
                    ))}
                  </div>
                )}
                {onNavigate && (
                  <div className="bos-opp-card-actions">
                    <button className="bos-btn outline bos-btn--xs" onClick={() => onNavigate('mission')}>Open in Mission Control →</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// CAMPAIGNS VIEW
// ═══════════════════════════════════════════════════════════════════

const EMPTY_CAMP = { name: "", channel: "email", budget: "", startDate: "", endDate: "", notes: "" };
const CHANNELS   = ["email","social","ads","seo","events","content","other"];
const STATUS_COLOR = { draft: "var(--text-dim)", active: "var(--success)", paused: "var(--warning)", completed: "var(--accent2)" };

function CampaignsView({ onToast }) {
  const [camps,   setCamps]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [filter,  setFilter]  = useState("all");
  const [form,    setForm]    = useState(EMPTY_CAMP);
  const [editing, setEditing] = useState(null);
  const [saving,  setSaving]  = useState(false);
  const [showForm,setShowForm]= useState(false);
  const nameRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await getCampaigns({ status: filter === "all" ? undefined : filter, limit: 50 });
      setCamps(r.campaigns ?? (Array.isArray(r) ? r : []));
      setError(null);
    } catch (e) {
      setError(e.message || "Failed to load campaigns");
    }
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const openNew = () => {
    setForm(EMPTY_CAMP); setEditing(null); setShowForm(true);
    setTimeout(() => nameRef.current?.focus(), 50);
  };

  const openEdit = (c) => {
    setForm({ name: c.name, channel: c.channel, budget: String(c.budget || ""), startDate: c.startDate?.slice(0,10) || "", endDate: c.endDate?.slice(0,10) || "", notes: c.notes || "" });
    setEditing(c.id); setShowForm(true);
    setTimeout(() => nameRef.current?.focus(), 50);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { onToast?.("error", "Name is required"); return; }
    setSaving(true);
    const payload = { ...form, budget: Number(form.budget) || 0 };
    const r = editing ? await updateCampaign(editing, payload) : await createCampaign(payload);
    if (r.success === false) onToast?.("error", r.error || "Save failed");
    else { onToast?.("success", editing ? "Campaign updated" : "Campaign created"); setShowForm(false); load(); }
    setSaving(false);
  };

  const handleActivate = async (c) => {
    const r = await updateCampaign(c.id, { status: "active" });
    if (r.success !== false) { onToast?.("success", "Campaign activated"); load(); }
    else onToast?.("error", r.error || "Activate failed");
  };

  const handleComplete = async (campaignId) => {
    const r = await completeCampaign(campaignId);
    if (r.success !== false) { onToast?.("success", "Campaign completed"); load(); }
    else onToast?.("error", r.error || "Complete failed");
  };

  const handleEvent = async (campaignId, type) => {
    const r = await recordCampaignEvent(campaignId, { type, value: 1 });
    if (r.success !== false) { onToast?.("success", `${type} recorded`); load(); }
    else onToast?.("error", r.error || "Failed to record event");
  };

  return (
    <div className="bos-section">
      <div className="bos-section-header">
        <h3 className="bos-section-title">Campaigns</h3>
        <button className="bos-btn primary" onClick={openNew}>+ New Campaign</button>
      </div>

      <div className="bos-filter-row">
        {["all","draft","active","paused","completed"].map(f => (
          <button key={f} className={`bos-filter-btn ${filter === f ? "active" : ""}`} onClick={() => setFilter(f)}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {showForm && (
        <div className="bos-form-card">
          <input ref={nameRef} className="bos-input" placeholder="Campaign name *" value={form.name} onChange={e => setF("name", e.target.value)} />
          <div className="bos-form-row">
            <select className="bos-select" value={form.channel} onChange={e => setF("channel", e.target.value)}>
              {CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <input className="bos-input" placeholder="Budget" type="number" min="0" value={form.budget} onChange={e => setF("budget", e.target.value)} />
          </div>
          <div className="bos-form-row">
            <input type="date" className="bos-input" value={form.startDate} onChange={e => setF("startDate", e.target.value)} />
            <input type="date" className="bos-input" value={form.endDate}   onChange={e => setF("endDate",   e.target.value)} />
          </div>
          <textarea className="bos-input bos-textarea" placeholder="Notes" rows={2} value={form.notes} onChange={e => setF("notes", e.target.value)} />
          <div className="bos-form-actions">
            <button className="bos-btn primary" onClick={handleSave} disabled={saving}>{saving ? "Saving…" : editing ? "Save Changes" : "Create Campaign"}</button>
            <button className="bos-btn outline" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      {loading ? <Skeleton /> : error ? (
        <BosError error={error} onRetry={load} />
      ) : !camps?.length ? (
        <Empty title={`No ${filter === "all" ? "" : filter} campaigns`} sub="Create your first campaign above." />
      ) : (
        <div className="bos-camp-list">
          {camps.map(c => (
            <div key={c.id} className="bos-camp-card">
              <div className="bos-camp-card-top">
                <div>
                  <span className="bos-camp-card-name">{c.name}</span>
                  <span className="bos-camp-card-channel">{c.channel}</span>
                </div>
                <div className="bos-camp-card-right">
                  <Badge label={c.status} color={STATUS_COLOR[c.status] || "var(--text-dim)"} />
                  <span className="bos-camp-budget">Budget: {_fmtAmt(c.budget)} · Spent: {_fmtAmt(c.spent)}</span>
                </div>
              </div>
              {/* Metrics */}
              {c.metrics && (
                <div className="bos-camp-metrics">
                  {[["Impressions", c.metrics.impressions],["Clicks", c.metrics.clicks],["Leads", c.metrics.leadsGen],["Conversions", c.metrics.conversions]].map(([lbl, val]) => (
                    <div key={lbl} className="bos-camp-metric"><span className="bos-camp-metric-val">{val}</span><span className="bos-camp-metric-lbl">{lbl}</span></div>
                  ))}
                </div>
              )}
              <div className="bos-camp-card-actions">
                {c.status === "draft"  && <button className="bos-btn success bos-btn--xs" onClick={() => handleActivate(c)}>Activate</button>}
                {c.status === "active" && <>
                  <button className="bos-btn outline bos-btn--xs" onClick={() => handleEvent(c.id, "click")}>+Click</button>
                  <button className="bos-btn outline bos-btn--xs" onClick={() => handleEvent(c.id, "lead")}>+Lead</button>
                  <button className="bos-btn outline bos-btn--xs" onClick={() => handleEvent(c.id, "conversion")}>+Conv</button>
                  <button className="bos-btn danger  bos-btn--xs" onClick={() => handleComplete(c.id)}>Complete</button>
                </>}
                <button className="bos-icon-btn" title="Edit" onClick={() => openEdit(c)}>✎</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// REVENUE VIEW
// ═══════════════════════════════════════════════════════════════════

const EMPTY_REV = { amount: "", currency: "USD", type: "sale", source: "direct", description: "" };
const REV_TYPES = ["sale","subscription","service","refund","other"];

function RevenueView({ onToast }) {
  const [records,  setRecords]  = useState(null);
  const [stats,    setStats]    = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);
  const [typeFilter,setType]    = useState("all");
  const [form,     setForm]     = useState(EMPTY_REV);
  const [saving,   setSaving]   = useState(false);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, s] = await Promise.all([
        getRevenue({ type: typeFilter === "all" ? undefined : typeFilter, limit: 50 }),
        getRevenueStats({}),
      ]);
      setRecords(r.revenue ?? (Array.isArray(r) ? r : []));
      if (s.success !== false) setStats(s);
      setError(null);
    } catch (e) {
      setError(e.message || "Failed to load revenue");
    }
    setLoading(false);
  }, [typeFilter]);

  useEffect(() => { load(); }, [load]);

  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.amount || isNaN(Number(form.amount))) { onToast?.("error", "Valid amount is required"); return; }
    setSaving(true);
    const r = await recordRevenue({ ...form, amount: Number(form.amount) });
    if (r.success === false) onToast?.("error", r.error || "Could not record revenue");
    else { onToast?.("success", "Revenue recorded"); setForm(EMPTY_REV); setShowForm(false); load(); }
    setSaving(false);
  };

  const REV_TYPE_COLOR = { sale: "var(--success)", subscription: "var(--accent)", service: "var(--accent2)", refund: "var(--danger)", other: "var(--text-dim)" };

  return (
    <div className="bos-section">
      <div className="bos-section-header">
        <h3 className="bos-section-title">Revenue</h3>
        <button className="bos-btn primary" onClick={() => setShowForm(!showForm)}>+ Record Revenue</button>
      </div>

      {/* Stats strip */}
      {stats && (
        <div className="bos-stats-grid bos-stats-grid--3">
          <div className="bos-stat-card">
            <div className="bos-stat-val" style={{ color: "var(--success)" }}>{_fmtAmt(stats.total)}</div>
            <div className="bos-stat-lbl">Total Revenue</div>
          </div>
          <div className="bos-stat-card">
            <div className="bos-stat-val" style={{ color: "var(--accent)" }}>{_fmtAmt(stats.mrr)}</div>
            <div className="bos-stat-lbl">MRR (30d)</div>
          </div>
          <div className="bos-stat-card">
            <div className="bos-stat-val" style={{ color: "var(--accent2)" }}>{stats.count ?? 0}</div>
            <div className="bos-stat-lbl">Transactions</div>
          </div>
        </div>
      )}

      {/* Revenue by type breakdown */}
      {stats?.byType && Object.keys(stats.byType).length > 0 && (
        <div className="bos-rev-breakdown">
          {Object.entries(stats.byType).map(([type, amount]) => (
            <div key={type} className="bos-rev-type-row">
              <span className="bos-rev-type-label" style={{ color: REV_TYPE_COLOR[type] }}>{type}</span>
              <div className="bos-rev-track">
                <div className="bos-rev-fill" style={{ width: `${Math.min(100, (amount / (stats.total || 1)) * 100)}%`, background: REV_TYPE_COLOR[type] }} />
              </div>
              <span className="bos-rev-type-val">{_fmtAmt(amount)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="bos-filter-row">
        {["all", ...REV_TYPES].map(f => (
          <button key={f} className={`bos-filter-btn ${typeFilter === f ? "active" : ""}`} onClick={() => setType(f)}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {showForm && (
        <div className="bos-form-card">
          <div className="bos-form-row">
            <input className="bos-input" placeholder="Amount *" type="number" min="0" value={form.amount} onChange={e => setF("amount", e.target.value)} />
            <select className="bos-select" value={form.currency} onChange={e => setF("currency", e.target.value)}>
              {["USD","EUR","GBP","INR","AUD","CAD"].map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="bos-form-row">
            <select className="bos-select" value={form.type} onChange={e => setF("type", e.target.value)}>
              {REV_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <input className="bos-input" placeholder="Source (e.g. stripe, invoice)" value={form.source} onChange={e => setF("source", e.target.value)} />
          </div>
          <input className="bos-input" placeholder="Description" value={form.description} onChange={e => setF("description", e.target.value)} />
          <div className="bos-form-actions">
            <button className="bos-btn primary" onClick={handleSave} disabled={saving}>{saving ? "Recording…" : "Record Revenue"}</button>
            <button className="bos-btn outline" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      {loading ? <Skeleton /> : error ? (
        <BosError error={error} onRetry={load} />
      ) : !records?.length ? (
        <Empty title={`No ${typeFilter === "all" ? "" : typeFilter} revenue`} sub="Record your first transaction above." />
      ) : (
        <table className="bos-table">
          <thead><tr><th>Amount</th><th>Type</th><th>Source</th><th>Description</th><th>Date</th></tr></thead>
          <tbody>
            {records.map(r => (
              <tr key={r.revenueId}>
                <td><span style={{ color: r.type === "refund" ? "var(--danger)" : "var(--success)", fontWeight: 700 }}>{r.type === "refund" ? "−" : "+"}{_fmtAmt(r.amount, r.currency)}</span></td>
                <td><Badge label={r.type} color={REV_TYPE_COLOR[r.type]} /></td>
                <td className="bos-td-dim">{r.source}</td>
                <td className="bos-td-dim">{r.description || "—"}</td>
                <td className="bos-td-dim">{_fmtDate(r.recordedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// AI SUGGESTIONS VIEW — business.js /intelligence/recommendations,
// generated by the continuous learning engine from lead/deal/customer/
// campaign signals (Phase B3). Distinct from the graph Reasoning view
// below, which reasons over the engineering knowledge graph, not CRM data.
// ═══════════════════════════════════════════════════════════════════

const REC_PRIORITY_LABEL = { 1: "Critical", 2: "High", 3: "Medium", 4: "Low" };
const REC_PRIORITY_COLOR = { 1: "var(--danger)", 2: "var(--warning)", 3: "var(--accent2)", 4: "var(--text-dim)" };

function SuggestionsView({ onToast }) {
  const [recs,    setRecs]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [filter,  setFilter]  = useState("open");
  const [busyId,  setBusyId]  = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await getBusinessRecommendations({ status: filter === "all" ? undefined : filter, limit: 50 });
      setRecs(r.recommendations ?? (Array.isArray(r) ? r : []));
      setError(null);
    } catch (e) {
      setError(e.message || "Failed to load suggestions");
    }
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const handleAccept = async (recId) => {
    setBusyId(recId);
    const r = await acceptBusinessRecommendation(recId, { createMission: true });
    setBusyId(null);
    if (r.success === false) onToast?.("error", r.error || "Could not accept");
    else { onToast?.("success", "Accepted — mission created"); load(); }
  };

  const handleDismiss = async (recId) => {
    setBusyId(recId);
    const r = await dismissBusinessRecommendation(recId);
    setBusyId(null);
    if (r.success === false) onToast?.("error", r.error || "Could not dismiss");
    else { onToast?.("success", "Dismissed"); load(); }
  };

  return (
    <div className="bos-section">
      <div className="bos-section-header">
        <h3 className="bos-section-title">AI Suggestions</h3>
        <button className="bos-btn outline" onClick={load}>Refresh</button>
      </div>
      <p className="bos-text-dim" style={{ marginBottom: 12 }}>
        Recommendations from the shared continuous learning engine — currently system-wide (engineering, ops, and business
        signals together), not yet filtered to CRM-only activity.
      </p>

      <div className="bos-filter-row">
        {["open","accepted","dismissed","all"].map(f => (
          <button key={f} className={`bos-filter-btn ${filter === f ? "active" : ""}`} onClick={() => setFilter(f)}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {loading ? <Skeleton /> : error ? (
        <BosError error={error} onRetry={load} />
      ) : !recs?.length ? (
        <Empty title={`No ${filter === "all" ? "" : filter} suggestions`} sub="Suggestions appear here as the learning engine analyzes CRM activity." />
      ) : (
        <div className="bos-opp-list">
          {recs.map(r => (
            <div key={r.recId} className="bos-opp-card">
              <div className="bos-opp-card-top">
                <div className="bos-opp-card-left">
                  <span className="bos-opp-card-title">{r.title}</span>
                </div>
                <div className="bos-opp-card-right">
                  <Badge label={REC_PRIORITY_LABEL[r.priority] || `P${r.priority}`} color={REC_PRIORITY_COLOR[r.priority] || "var(--text-dim)"} />
                </div>
              </div>
              {r.detail && <p className="bos-text-dim" style={{ margin: "6px 0" }}>{r.detail}</p>}
              <div className="bos-opp-card-meta">
                <span className="bos-opp-age">{_timeAgo(r.createdAt)}</span>
              </div>
              {r.status === "open" && (
                <div className="bos-opp-card-actions">
                  <button className="bos-btn success bos-btn--xs" onClick={() => handleAccept(r.recId)} disabled={busyId === r.recId}>Accept → Mission</button>
                  <button className="bos-btn outline bos-btn--xs" onClick={() => handleDismiss(r.recId)} disabled={busyId === r.recId}>Dismiss</button>
                </div>
              )}
              {r.status !== "open" && <Badge label={r.status} color={r.status === "accepted" ? "var(--success)" : "var(--text-dim)"} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// REASONING VIEW (Q2)
// ═══════════════════════════════════════════════════════════════════

function ReasoningView({ onNavigate }) {
  const [data, setData]       = useState(null);
  const [recs, setRecs]       = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      _fetch('/graph/reasoning/executive'),
      _fetch('/graph/reasoning/recommendations'),
    ]).then(([exec, recsR]) => {
      if (exec?.ok)  setData(exec);
      if (recsR?.ok) setRecs(recsR);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="bos-empty"><p className="bos-empty-title">Loading reasoning engine…</p></div>;
  if (!data)   return <div className="bos-empty"><p className="bos-empty-title">Reasoning unavailable</p><p className="bos-empty-sub">Graph may not be indexed yet. Try POST /graph/index first.</p></div>;

  const health  = data.healthScore;
  const summary = data.summary;
  const risks   = data.topRisks || [];
  const blocked = data.topBlockers || [];
  const gaps    = data.topKnowledgeGaps || [];
  const rList   = recs?.recommendations || [];

  const riskColor = r => r.risk === 'critical' || r.severity === 'critical' ? 'var(--danger)' : r.risk === 'high' || r.severity === 'warning' ? 'var(--warning)' : '#3b82f6';

  return (
    <div className="bos-section">
      <div className="bos-section-header">
        <h3 className="bos-section-title">Graph Reasoning Engine</h3>
        {health != null && (
          <span style={{ fontSize: 12, fontWeight: 600, color: health >= 70 ? 'var(--success)' : health >= 40 ? 'var(--warning)' : 'var(--danger)' }}>
            System Health: {health}/100
          </span>
        )}
      </div>
      {summary && <p style={{ fontSize: 12, color: 'var(--text-dim,#888)', marginBottom: 16 }}>{summary}</p>}

      {risks.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8, color: 'var(--text-dim,#888)' }}>Top Risks</div>
          {risks.map((r, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8, padding: '8px 10px', background: 'var(--bg2,#18181b)', borderRadius: 6, borderLeft: `3px solid ${riskColor(r)}` }}>
              <span style={{ background: riskColor(r), borderRadius: 3, padding: '1px 6px', fontSize: 10, color: '#fff', flexShrink: 0, marginTop: 1 }}>
                {(r.type || '').replace(/_/g,' ')}
              </span>
              <span style={{ fontSize: 12 }}>{r.explanation || r.description || r.objective || r.id}</span>
            </div>
          ))}
        </div>
      )}

      {blocked.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8, color: 'var(--text-dim,#888)' }}>Blocked Missions</div>
          {blocked.map((b, i) => (
            <div key={i} style={{ fontSize: 12, padding: '6px 10px', background: 'var(--bg2,#18181b)', borderRadius: 6, marginBottom: 6, borderLeft: '3px solid var(--warning)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <span>
                <strong>{b.objective || b.missionId}</strong>
                {b.blockers && <span style={{ color: 'var(--text-dim,#888)', marginLeft: 8 }}>{b.blockers.join(' · ')}</span>}
              </span>
              {onNavigate && (
                <button className="bos-icon-btn" style={{ flexShrink: 0 }} onClick={() => onNavigate('mission')} title="Open in Mission Control">→</button>
              )}
            </div>
          ))}
        </div>
      )}

      {rList.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8, color: 'var(--text-dim,#888)' }}>Recommended Actions</div>
          {rList.slice(0, 6).map((r, i) => (
            <div key={i} style={{ fontSize: 12, padding: '8px 10px', background: 'var(--bg2,#18181b)', borderRadius: 6, marginBottom: 6, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ background: r.priority === 'critical' ? 'var(--danger)' : r.priority === 'high' ? 'var(--warning)' : '#3b82f6', borderRadius: 3, padding: '1px 6px', fontSize: 10, color: '#fff', flexShrink: 0, marginTop: 1 }}>
                {r.priority}
              </span>
              <div>
                <div style={{ fontWeight: 500 }}>{r.title}</div>
                {r.description && <div style={{ color: 'var(--text-dim,#888)', marginTop: 2 }}>{r.description.slice(0,120)}</div>}
              </div>
            </div>
          ))}
        </div>
      )}

      {gaps.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8, color: 'var(--text-dim,#888)' }}>Knowledge Gaps</div>
          {gaps.map((g, i) => (
            <div key={i} style={{ fontSize: 12, color: 'var(--text-dim,#888)', padding: '4px 0' }}>• {g.objective} <em>({g.ageDays}d old)</em></div>
          ))}
        </div>
      )}

      {risks.length === 0 && blocked.length === 0 && rList.length === 0 && (
        <Empty title="No reasoning signals" sub="Index the graph first with POST /graph/index, then re-open this view." />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ROOT COMPONENT
// ═══════════════════════════════════════════════════════════════════

export default function BusinessOS({ onToast, onNavigate }) {
  const [view, setView] = useState("dashboard");

  return (
    <div className="bos-root">
      <nav className="bos-subnav">
        {VIEWS.map(v => (
          <button key={v.id} className={`bos-subnav-btn ${view === v.id ? "active" : ""}`}
            onClick={() => setView(v.id)}>
            {v.label}
          </button>
        ))}
      </nav>
      <div className="bos-content">
        {view === "dashboard"     && <DashboardView     onToast={onToast} />}
        {view === "leads"         && <LeadsView         onToast={onToast} />}
        {view === "contacts"      && <ContactsView      onToast={onToast} />}
        {view === "opportunities" && <OpportunitiesView onToast={onToast} />}
        {view === "customers"     && <CustomersView     onToast={onToast} onNavigate={onNavigate} />}
        {view === "campaigns"     && <CampaignsView     onToast={onToast} />}
        {view === "revenue"       && <RevenueView       onToast={onToast} />}
        {view === "suggestions"   && <SuggestionsView   onToast={onToast} />}
        {view === "reasoning"     && <ReasoningView     onNavigate={onNavigate} />}
      </div>
    </div>
  );
}
