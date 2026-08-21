import React, { useState, useEffect, useCallback } from "react";
import { track } from "../analytics";
import { _fetch } from "../_client";
import "./SupportCenter.css";

// ── MASTER FINAL GAP CLOSURE (2026-08-15, C10-012) ─────────────────────────
// This file previously rendered 8 hardcoded seed tickets and 8 hardcoded KB
// articles, persisted only to a localStorage key — never once calling the
// real, already-hardened backend at /customer-org/support/*. The Support OS
// backend pass (2026-08-14) fixed
// two real cross-tenant defects there (leaked analytics, a cross-tenant
// resolve write) but explicitly left this frontend untouched.
//
// This rewrite wires the real ticket list/create/resolve/suggest routes.
// The real ticket shape ({id, customerId, orgId, issue, category, severity,
// status, stage, health, suggestedResolution, createdAt, updatedAt}) is
// materially different from the old fake shape (subject/priority/waitHours/
// assignee/tags/SLA-hours did not exist on any real ticket) — fields that
// don't exist on the real record are not fabricated here. Knowledge Base
// and per-priority SLA-hour targets remain out of scope: no real KB-article
// or SLA-policy backend was found to connect to (matching this session's
// "do not invent data the backend doesn't have" discipline established in
// KnowledgeCenter.jsx's own C10-009 rewrite).
//
// GET /customer-org/support/stats is itself platform-wide, not org-scoped
// (confirmed via source read — a real, separate, pre-existing gap, not
// something to silently paper over) — so the summary tiles below are
// computed from the already org-scoped ticket list instead of that route.

const SEVERITY_COLORS = {
  critical: "var(--danger)",
  high:     "var(--warning)",
  medium:   "var(--accent2)",
  low:      "var(--text-faint)",
};
const STATUS_COLORS = {
  open: "var(--accent2)", in_progress: "var(--warning)",
  resolved: "var(--success)", escalated: "var(--danger)",
};

function fmtTime(ts) {
  if (!ts) return "—";
  try { return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch { return "—"; }
}

function TicketRow({ ticket, selected, onSelect }) {
  return (
    <button className={`sc-ticket-row${selected ? " sc-ticket-row--sel" : ""}`} onClick={() => onSelect(ticket.id)}>
      <div className="sc-tkt-left">
        <span className="sc-tkt-pri-dot" style={{ background: SEVERITY_COLORS[ticket.severity] || "var(--text-faint)" }} />
        <div className="sc-tkt-info">
          <span className="sc-tkt-subject">{ticket.issue}</span>
          <span className="sc-tkt-meta">{ticket.category} · {fmtTime(ticket.createdAt)} · {ticket.customerId}</span>
        </div>
      </div>
      <div className="sc-tkt-right">
        <span className="sc-tkt-status" style={{ color: STATUS_COLORS[ticket.status], borderColor: (STATUS_COLORS[ticket.status] || "") + "33" }}>
          {(ticket.status || "").replace("_", " ")}
        </span>
      </div>
    </button>
  );
}

function TicketDetail({ ticket, onResolve, resolving }) {
  const [resolution, setResolution] = useState("");
  const sr = ticket.suggestedResolution;

  return (
    <div className="sc-ticket-detail">
      <div className="sc-td-header">
        <span className="sc-td-id">#{ticket.id}</span>
        <span className="sc-td-cat">{ticket.category}</span>
        <span className="sc-td-pri" style={{ color: SEVERITY_COLORS[ticket.severity], borderColor: (SEVERITY_COLORS[ticket.severity] || "") + "33" }}>{ticket.severity}</span>
        <span className="sc-td-status" style={{ color: STATUS_COLORS[ticket.status], borderColor: (STATUS_COLORS[ticket.status] || "") + "33" }}>
          {(ticket.status || "").replace("_", " ")}
        </span>
      </div>
      <h3 className="sc-td-subject">{ticket.issue}</h3>
      <div className="sc-td-meta-grid">
        <span className="sc-tdml">Customer</span><span className="sc-tdmv">{ticket.customerId}</span>
        <span className="sc-tdml">Created</span><span className="sc-tdmv">{fmtTime(ticket.createdAt)}</span>
        <span className="sc-tdml">Updated</span><span className="sc-tdmv">{fmtTime(ticket.updatedAt)}</span>
        {ticket.stage && (<><span className="sc-tdml">Journey stage</span><span className="sc-tdmv">{ticket.stage}</span></>)}
        {ticket.health && (<><span className="sc-tdml">Customer health</span><span className="sc-tdmv">{ticket.health}</span></>)}
      </div>

      {sr && (
        <div className="sc-td-existing-reply">
          <span className="sc-td-reply-label">Suggested resolution — {sr.template}{sr.churnRisk ? ` (churn risk: ${sr.churnRisk})` : ""}</span>
          {Array.isArray(sr.steps) && sr.steps.length > 0 && (
            <ul className="sc-suggested-steps">
              {sr.steps.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          )}
        </div>
      )}

      {ticket.status === "resolved" ? (
        <div className="sc-td-existing-reply">
          <span className="sc-td-reply-label">Resolution</span>
          <p className="sc-td-reply-text">{ticket.resolution || "Resolved."}</p>
        </div>
      ) : (
        <div className="sc-td-reply-section">
          <div className="sc-td-reply-header">
            <label className="sc-td-reply-form-label">Resolve with</label>
          </div>
          <textarea
            className="sc-td-reply-input"
            value={resolution}
            onChange={e => setResolution(e.target.value)}
            rows={3}
            placeholder={sr?.steps?.length ? "Use the suggested steps above, or type your own…" : "Describe the resolution…"}
          />
          <div className="sc-td-actions">
            <button className="sc-td-act sc-td-act--resolve" disabled={resolving} onClick={() => onResolve(ticket.id, resolution)}>
              {resolving ? "Resolving…" : "Resolve"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SupportCenter({ onNavigate }) {
  const [orgId, setOrgId]     = useState(undefined); // undefined = loading, null = no org
  const [tickets, setTickets] = useState(null);       // null = loading, [] = loaded empty
  const [loadError, setLoadError] = useState(null);
  const [selected, setSelected]   = useState(null);
  const [priFilter, setPriFilter] = useState("all");
  const [staFilter, setStaFilter] = useState("all");
  const [resolving, setResolving] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = m => { setToast(m); setTimeout(() => setToast(null), 2400); };

  const loadTickets = useCallback(() => {
    setLoadError(null);
    _fetch("/customer-org/support/tickets?limit=200")
      .then(r => {
        if (r?.ok === false) { setLoadError(r.error || "Failed to load tickets"); setTickets([]); return; }
        setTickets(Array.isArray(r?.tickets) ? r.tickets : []);
      })
      .catch(e => { setLoadError(e.message || "Failed to load tickets"); setTickets([]); });
  }, []);

  useEffect(() => {
    track.event("support_center_viewed");
    _fetch("/orgs/me/context")
      .then(r => {
        const id = r?.ok !== false ? (r?.primaryOrg?.orgId || null) : null;
        setOrgId(id);
      })
      .catch(() => setOrgId(null));
  }, []);

  useEffect(() => { loadTickets(); }, [loadTickets]);

  const handleResolve = useCallback((id, resolution) => {
    setResolving(true);
    _fetch(`/customer-org/support/ticket/${id}/resolve`, {
      method: "POST",
      body: JSON.stringify({ resolution: resolution || undefined, automated: false }),
    })
      .then(r => {
        if (r?.ok === false) { showToast(r.error || "Resolve failed"); return; }
        showToast("Ticket resolved");
        track.event("ticket_resolved");
        loadTickets();
      })
      .catch(e => showToast(e.message || "Resolve failed"))
      .finally(() => setResolving(false));
  }, [loadTickets]);

  if (orgId === undefined || tickets === null) {
    return (
      <div className="support-center page-enter">
        <div className="sc-header"><div><h1 className="sc-title">Support Center</h1></div></div>
        <div className="kc-empty"><span className="kc-empty-icon">◎</span><p className="kc-empty-title">Loading support tickets…</p></div>
      </div>
    );
  }

  if (!orgId) {
    return (
      <div className="support-center page-enter">
        <div className="sc-header"><div><h1 className="sc-title">Support Center</h1></div></div>
        <div className="kc-empty">
          <span className="kc-empty-icon">◎</span>
          <p className="kc-empty-title">No organization context</p>
          <p className="kc-empty-sub">Join or create an organization to see support tickets.</p>
        </div>
      </div>
    );
  }

  const visible = tickets.filter(t =>
    (priFilter === "all" || t.severity === priFilter) &&
    (staFilter === "all" || t.status === staFilter)
  );
  const selTicket = selected ? tickets.find(t => t.id === selected) : null;

  const openCount      = tickets.filter(t => t.status === "open").length;
  const inProgCount    = tickets.filter(t => t.status === "in_progress").length;
  const escalatedCount = tickets.filter(t => t.status === "escalated").length;
  const resolvedCount  = tickets.filter(t => t.status === "resolved").length;

  return (
    <div className="support-center page-enter">
      {toast && <div className="sc-toast">{toast}</div>}

      <div className="sc-header">
        <div>
          <h1 className="sc-title">Support Center</h1>
          <p className="sc-subtitle">Real tickets from your organization's customer support queue.</p>
        </div>
      </div>

      {loadError && (
        <div className="kc-empty kc-empty--error">
          <span className="kc-empty-icon">⚠</span>
          <p className="kc-empty-title">Couldn't load tickets</p>
          <p className="kc-empty-sub">{loadError}</p>
        </div>
      )}

      {!loadError && (
        <>
          <div className="sc-summary-strip">
            {[
              { label: "Open",        value: openCount,      color: "var(--accent2)" },
              { label: "In progress", value: inProgCount,    color: "var(--warning)" },
              { label: "Escalated",   value: escalatedCount, color: escalatedCount > 0 ? "var(--danger)" : "var(--success)" },
              { label: "Resolved",    value: resolvedCount,  color: "var(--success)" },
            ].map(s => (
              <div key={s.label} className="sc-summary-tile">
                <span className="sc-sv" style={{ color: s.color }}>{s.value}</span>
                <span className="sc-sl">{s.label}</span>
              </div>
            ))}
          </div>

          {tickets.length === 0 ? (
            <div className="kc-empty">
              <span className="kc-empty-icon">◎</span>
              <p className="kc-empty-title">No support tickets yet</p>
              <p className="kc-empty-sub">Tickets created via the customer support pipeline will appear here.</p>
            </div>
          ) : (
            <>
              <div className="sc-filters">
                <div className="sc-filter-row">
                  {["all", "critical", "high", "medium", "low"].map(p => (
                    <button key={p} className={`sc-chip${priFilter === p ? " sc-chip--active" : ""}`}
                      style={priFilter === p && p !== "all" ? { color: SEVERITY_COLORS[p], borderColor: SEVERITY_COLORS[p] + "44" } : {}}
                      onClick={() => setPriFilter(p)}>{p}</button>
                  ))}
                </div>
                <div className="sc-filter-row">
                  {["all", "open", "in_progress", "resolved", "escalated"].map(s => (
                    <button key={s} className={`sc-chip${staFilter === s ? " sc-chip--active" : ""}`}
                      onClick={() => setStaFilter(s)}>{s.replace("_", " ")}</button>
                  ))}
                </div>
              </div>
              <div className="sc-tickets-layout">
                <div className="sc-ticket-list">
                  {visible.map(t => (
                    <TicketRow key={t.id} ticket={t} selected={selected === t.id} onSelect={setSelected} />
                  ))}
                  {visible.length === 0 && <p className="kc-empty-sub" style={{ padding: "1rem" }}>No tickets match this filter.</p>}
                </div>
                {selTicket && (
                  <TicketDetail ticket={selTicket} onResolve={handleResolve} resolving={resolving} />
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
