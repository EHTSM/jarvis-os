import React, { useState, useEffect } from "react";
import { track } from "../analytics";
import "./EnterpriseCRM.css";

// ── Pull from existing CRM data keys used by Dashboard/PaymentPanel ──
function _loadCRM() {
  const contacts = (() => {
    try { return JSON.parse(localStorage.getItem("jarvis_contacts") || "[]"); } catch { return []; }
  })();
  const leads = (() => {
    try { return JSON.parse(localStorage.getItem("jarvis_leads") || JSON.stringify(contacts)); } catch { return contacts; }
  })();
  return { contacts, leads };
}

// ── Pipeline stages ──────────────────────────────────────────────────
const STAGES = [
  { id: "new",         label: "New",          color: "var(--text-faint)" },
  { id: "contacted",   label: "Contacted",    color: "var(--accent2)"    },
  { id: "qualified",   label: "Qualified",    color: "var(--accent)"     },
  { id: "proposal",    label: "Proposal",     color: "var(--warning)"    },
  { id: "negotiation", label: "Negotiation",  color: "#da552f"           },
  { id: "won",         label: "Won",          color: "var(--success)"    },
  { id: "lost",        label: "Lost",         color: "var(--danger)"     },
];

// ── Seed opportunities (used when no CRM data exists) ────────────────
const SEED_OPPS = [
  { id: "o1", name: "Arjun Mehta",         company: "Mehta Realty",      stage: "proposal",    value: 2499, probability: 70, owner: "You", lastContact: "2 days ago",  health: "good"    },
  { id: "o2", name: "Priya Sharma",        company: "PS Consulting",     stage: "qualified",   value: 999,  probability: 55, owner: "You", lastContact: "5 days ago",  health: "warning" },
  { id: "o3", name: "Rohan Singh",         company: "Singh Exports",     stage: "negotiation", value: 2499, probability: 85, owner: "You", lastContact: "1 day ago",   health: "good"    },
  { id: "o4", name: "Fatima Ali",          company: "Ali Ventures",      stage: "new",         value: 999,  probability: 20, owner: "You", lastContact: "10 days ago", health: "cold"    },
  { id: "o5", name: "Karan Verma",         company: "Verma Tech",        stage: "contacted",   value: 999,  probability: 35, owner: "You", lastContact: "3 days ago",  health: "good"    },
  { id: "o6", name: "Sonia Kapoor",        company: "Kapoor Academy",    stage: "won",         value: 2499, probability: 100,owner: "You", lastContact: "Today",       health: "good"    },
  { id: "o7", name: "Dev Kumar",           company: "Kumar Industries",  stage: "lost",        value: 999,  probability: 0,  owner: "You", lastContact: "3 weeks ago", health: "cold"    },
];

const SEED_TEAM = [
  { id: "t1", name: "You",        role: "Owner",   opps: 7, won: 1, pipeline: 12943, quota: 20000 },
];

function fmt(v) {
  if (v >= 100000) return `₹${(v/100000).toFixed(1)}L`;
  if (v >= 1000)   return `₹${(v/1000).toFixed(1)}K`;
  return `₹${v}`;
}

function HealthDot({ health }) {
  const colors = { good: "var(--success)", warning: "var(--warning)", cold: "var(--danger)" };
  return <span className="ecrm-health-dot" style={{ background: colors[health] || "var(--text-faint)" }} title={health} />;
}

function StageBadge({ stage }) {
  const def = STAGES.find(s => s.id === stage) || STAGES[0];
  return <span className="ecrm-stage-badge" style={{ color: def.color, borderColor: def.color + "33" }}>{def.label}</span>;
}

export default function EnterpriseCRM({ onNavigate }) {
  const [section,    setSection]    = useState("pipeline");
  const [opps,       setOpps]       = useState(SEED_OPPS);
  const [stageFilter,setStageFilter] = useState("all");
  const [sortBy,     setSortBy]     = useState("value");
  const [selected,   setSelected]   = useState(null);

  useEffect(() => { track.event("enterprise_crm_viewed"); }, []);

  // Derive metrics
  const active   = opps.filter(o => o.stage !== "won" && o.stage !== "lost");
  const won      = opps.filter(o => o.stage === "won");
  const pipeline = active.reduce((s, o) => s + o.value, 0);
  const forecast = active.reduce((s, o) => s + (o.value * o.probability / 100), 0);
  const winRate  = opps.length ? Math.round((won.length / opps.length) * 100) : 0;

  const followUpAt = opps.filter(o => {
    const days = o.lastContact.includes("day") ? parseInt(o.lastContact) : o.lastContact.includes("week") ? parseInt(o.lastContact) * 7 : 0;
    return days >= 5 && o.stage !== "won" && o.stage !== "lost";
  });

  // Filtered + sorted list
  const visible = opps
    .filter(o => stageFilter === "all" || o.stage === stageFilter)
    .sort((a, b) => sortBy === "value" ? b.value - a.value : b.probability - a.probability);

  // Stage distribution
  const stageGroups = STAGES.map(s => ({
    ...s,
    count: opps.filter(o => o.stage === s.id).length,
    value: opps.filter(o => o.stage === s.id).reduce((sum, o) => sum + o.value, 0),
  }));

  return (
    <div className="enterprise-crm page-enter">

      <div className="ecrm-header">
        <div>
          <h1 className="ecrm-title">Enterprise CRM</h1>
          <p className="ecrm-subtitle">Pipeline overview, revenue forecast, follow-up health, and team performance.</p>
        </div>
      </div>

      {/* Top KPIs */}
      <div className="ecrm-kpi-strip">
        {[
          { label: "Active pipeline",     value: fmt(pipeline),          hint: `${active.length} opportunities`    },
          { label: "Weighted forecast",   value: fmt(Math.round(forecast)),hint: "Probability-adjusted revenue"    },
          { label: "Win rate",            value: `${winRate}%`,           hint: `${won.length} of ${opps.length} deals` },
          { label: "Need follow-up",      value: followUpAt.length,       hint: "5+ days since contact",           danger: followUpAt.length > 0 },
        ].map(k => (
          <div key={k.label} className={`ecrm-kpi-tile${k.danger ? " ecrm-kpi-tile--danger" : ""}`}>
            <span className="ecrm-kpi-value">{k.value}</span>
            <span className="ecrm-kpi-label">{k.label}</span>
            <span className="ecrm-kpi-hint">{k.hint}</span>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="ecrm-tabs">
        {[
          { id: "pipeline",    label: "Pipeline"        },
          { id: "forecast",    label: "Forecast"        },
          { id: "hot",         label: `Hot Opps${opps.filter(o=>o.probability>=70&&o.stage!=="won"&&o.stage!=="lost").length ? ` (${opps.filter(o=>o.probability>=70&&o.stage!=="won"&&o.stage!=="lost").length})` : ""}` },
          { id: "followup",    label: `Follow-up${followUpAt.length ? ` (${followUpAt.length})` : ""}` },
          { id: "team",        label: "Team"            },
        ].map(t => (
          <button
            key={t.id}
            className={`ecrm-tab${section === t.id ? " ecrm-tab--active" : ""}`}
            onClick={() => setSection(t.id)}
          >{t.label}</button>
        ))}
      </div>

      <div className="ecrm-content" key={section}>

        {/* Pipeline */}
        {section === "pipeline" && (
          <div className="ecrm-pipeline">
            {/* Stage filter + sort */}
            <div className="ecrm-controls">
              <div className="ecrm-stage-chips">
                <button
                  className={`ecrm-chip${stageFilter === "all" ? " ecrm-chip--active" : ""}`}
                  onClick={() => setStageFilter("all")}
                >All ({opps.length})</button>
                {STAGES.map(s => {
                  const cnt = opps.filter(o => o.stage === s.id).length;
                  if (!cnt) return null;
                  return (
                    <button
                      key={s.id}
                      className={`ecrm-chip${stageFilter === s.id ? " ecrm-chip--active" : ""}`}
                      style={stageFilter === s.id ? { color: s.color, borderColor: s.color + "44" } : {}}
                      onClick={() => setStageFilter(s.id)}
                    >{s.label} ({cnt})</button>
                  );
                })}
              </div>
              <select className="ecrm-sort-select" value={sortBy} onChange={e => setSortBy(e.target.value)}>
                <option value="value">Sort: Value</option>
                <option value="probability">Sort: Probability</option>
              </select>
            </div>

            <div className="ecrm-opp-list">
              {visible.map(o => (
                <button
                  key={o.id}
                  className={`ecrm-opp-row${selected === o.id ? " ecrm-opp-row--selected" : ""}`}
                  onClick={() => setSelected(selected === o.id ? null : o.id)}
                >
                  <HealthDot health={o.health} />
                  <div className="ecrm-opp-info">
                    <span className="ecrm-opp-name">{o.name}</span>
                    <span className="ecrm-opp-company">{o.company}</span>
                  </div>
                  <StageBadge stage={o.stage} />
                  <span className="ecrm-opp-prob">{o.probability}%</span>
                  <span className="ecrm-opp-value">{fmt(o.value)}</span>
                  <span className="ecrm-opp-contact">{o.lastContact}</span>
                </button>
              ))}
            </div>

            {selected && (() => {
              const o = opps.find(x => x.id === selected);
              if (!o) return null;
              return (
                <div className="ecrm-opp-detail">
                  <div className="ecrm-detail-row"><span className="ecrm-dl">Name</span><span className="ecrm-dv">{o.name}</span></div>
                  <div className="ecrm-detail-row"><span className="ecrm-dl">Company</span><span className="ecrm-dv">{o.company}</span></div>
                  <div className="ecrm-detail-row"><span className="ecrm-dl">Stage</span><StageBadge stage={o.stage} /></div>
                  <div className="ecrm-detail-row"><span className="ecrm-dl">Value</span><span className="ecrm-dv ecrm-dv--accent">{fmt(o.value)}/mo</span></div>
                  <div className="ecrm-detail-row"><span className="ecrm-dl">Probability</span><span className="ecrm-dv">{o.probability}%</span></div>
                  <div className="ecrm-detail-row"><span className="ecrm-dl">Last contact</span><span className="ecrm-dv">{o.lastContact}</span></div>
                  <div className="ecrm-detail-row"><span className="ecrm-dl">Owner</span><span className="ecrm-dv">{o.owner}</span></div>
                </div>
              );
            })()}
          </div>
        )}

        {/* Forecast */}
        {section === "forecast" && (
          <div className="ecrm-forecast">
            <div className="ecrm-forecast-summary">
              <div className="ecrm-forecast-card ecrm-forecast-card--main">
                <span className="ecrm-fc-label">Weighted forecast</span>
                <span className="ecrm-fc-value">{fmt(Math.round(forecast))}<span className="ecrm-fc-period">/mo</span></span>
                <span className="ecrm-fc-sub">Based on probability × deal value</span>
              </div>
              <div className="ecrm-forecast-card">
                <span className="ecrm-fc-label">Best case (all active close)</span>
                <span className="ecrm-fc-value ecrm-fc-value--sm">{fmt(pipeline)}/mo</span>
              </div>
              <div className="ecrm-forecast-card">
                <span className="ecrm-fc-label">Won ARR</span>
                <span className="ecrm-fc-value ecrm-fc-value--sm ecrm-fc-value--success">{fmt(won.reduce((s,o)=>s+o.value,0)*12)}</span>
              </div>
            </div>

            <p className="ecrm-section-label">Stage breakdown</p>
            <div className="ecrm-stage-breakdown">
              {stageGroups.filter(s => s.count > 0).map(s => (
                <div key={s.id} className="ecrm-stage-row">
                  <span className="ecrm-sb-stage" style={{ color: s.color }}>{s.label}</span>
                  <div className="ecrm-sb-bar-track">
                    <div
                      className="ecrm-sb-bar-fill"
                      style={{ width: `${pipeline ? Math.round(s.value / pipeline * 100) : 0}%`, background: s.color }}
                    />
                  </div>
                  <span className="ecrm-sb-count">{s.count} deal{s.count !== 1 ? "s" : ""}</span>
                  <span className="ecrm-sb-value">{fmt(s.value)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Hot opps */}
        {section === "hot" && (
          <div className="ecrm-hot">
            <p className="ecrm-section-note">Opportunities with ≥70% close probability, still active.</p>
            {opps.filter(o => o.probability >= 70 && o.stage !== "won" && o.stage !== "lost").length === 0 ? (
              <div className="ecrm-empty">
                <span className="ecrm-empty-icon">◉</span>
                <p className="ecrm-empty-title">No hot opportunities yet</p>
                <p className="ecrm-empty-sub">Move deals to Negotiation and update probability to ≥70%.</p>
              </div>
            ) : (
              <div className="ecrm-hot-list">
                {opps
                  .filter(o => o.probability >= 70 && o.stage !== "won" && o.stage !== "lost")
                  .sort((a, b) => b.value - a.value)
                  .map(o => (
                    <div key={o.id} className="ecrm-hot-card">
                      <div className="ecrm-hot-top">
                        <span className="ecrm-hot-name">{o.name}</span>
                        <span className="ecrm-hot-company">{o.company}</span>
                        <span className="ecrm-hot-prob" style={{ color: "var(--success)" }}>{o.probability}%</span>
                      </div>
                      <div className="ecrm-hot-bottom">
                        <StageBadge stage={o.stage} />
                        <span className="ecrm-hot-value">{fmt(o.value)}/mo</span>
                        <span className="ecrm-hot-contact">Last: {o.lastContact}</span>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}

        {/* Follow-up health */}
        {section === "followup" && (
          <div className="ecrm-followup">
            {followUpAt.length === 0 ? (
              <div className="ecrm-empty ecrm-empty--good">
                <span className="ecrm-empty-icon" style={{ color: "var(--success)" }}>✓</span>
                <p className="ecrm-empty-title">Follow-up health is good</p>
                <p className="ecrm-empty-sub">All active deals have been contacted within 5 days.</p>
              </div>
            ) : (
              <>
                <div className="ecrm-followup-alert">
                  <span className="ecrm-fa-icon">⚠</span>
                  <span className="ecrm-fa-text">{followUpAt.length} deal{followUpAt.length !== 1 ? "s" : ""} need immediate follow-up</span>
                </div>
                <div className="ecrm-followup-list">
                  {followUpAt.sort((a,b) => {
                    const daysOf = s => s.includes("week") ? parseInt(s)*7 : parseInt(s) || 0;
                    return daysOf(b.lastContact) - daysOf(a.lastContact);
                  }).map(o => (
                    <div key={o.id} className="ecrm-fu-row">
                      <HealthDot health={o.health} />
                      <div className="ecrm-fu-info">
                        <span className="ecrm-fu-name">{o.name}</span>
                        <span className="ecrm-fu-company">{o.company}</span>
                      </div>
                      <StageBadge stage={o.stage} />
                      <span className="ecrm-fu-since">Last contact: {o.lastContact}</span>
                      <span className="ecrm-fu-value">{fmt(o.value)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Team performance */}
        {section === "team" && (
          <div className="ecrm-team">
            <div className="ecrm-team-list">
              {SEED_TEAM.map(m => {
                const attainment = Math.round(m.pipeline / m.quota * 100);
                return (
                  <div key={m.id} className="ecrm-team-card">
                    <div className="ecrm-tc-header">
                      <div className="ecrm-tc-avatar">{m.name.slice(0,2).toUpperCase()}</div>
                      <div className="ecrm-tc-info">
                        <span className="ecrm-tc-name">{m.name}</span>
                        <span className="ecrm-tc-role">{m.role}</span>
                      </div>
                      <span className={`ecrm-tc-attainment${attainment >= 80 ? " ecrm-tc-attainment--good" : attainment >= 50 ? " ecrm-tc-attainment--warn" : " ecrm-tc-attainment--low"}`}>
                        {attainment}%
                      </span>
                    </div>
                    <div className="ecrm-tc-quota-bar">
                      <div className="ecrm-tc-quota-fill" style={{ width: `${Math.min(attainment, 100)}%` }} />
                    </div>
                    <div className="ecrm-tc-stats">
                      <span className="ecrm-tc-stat"><span className="ecrm-tc-sv">{m.opps}</span> opps</span>
                      <span className="ecrm-tc-stat"><span className="ecrm-tc-sv" style={{color:"var(--success)"}}>{m.won}</span> won</span>
                      <span className="ecrm-tc-stat"><span className="ecrm-tc-sv ecrm-tc-sv--accent">{fmt(m.pipeline)}</span> pipeline</span>
                      <span className="ecrm-tc-stat">Quota: <span className="ecrm-tc-sv">{fmt(m.quota)}</span></span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="ecrm-team-note">
              <span>Add team members in the </span>
              <button className="ecrm-link" onClick={() => onNavigate && onNavigate("team")}>Team Workspace →</button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
