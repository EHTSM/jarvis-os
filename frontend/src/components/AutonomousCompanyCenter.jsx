import React, { useState } from "react";
import { track } from "../analytics";
import "./AutonomousCompanyCenter.css";

// ── Department definitions ────────────────────────────────────────────
const DEPARTMENTS = [
  {
    id: "sales", name: "Sales", icon: "◇", color: "#da552f",
    mission: "Qualify leads, run outreach sequences, manage pipeline, close deals.",
    agents: [
      { name: "Sales Agent", icon: "◇", color: "#da552f", status: "idle", model: "claude-sonnet-4-6" },
    ],
    activeWork: [
      { title: "Qualify 5 new sign-ups from yesterday",       status: "in_progress" },
      { title: "Follow up: 3 unreplied DMs (day 3)",          status: "queued"      },
      { title: "Pipeline report for 16:00 team sync",         status: "in_progress" },
    ],
    metrics: { throughputToday: 5, successRate: "94%", openItems: 8, closedThisWeek: 3 },
    outcomes: [
      "3 leads qualified as hot this week",
      "₹7,497 pipeline value added",
      "1 deal closed at ₹2,499/mo Growth plan",
    ],
  },
  {
    id: "marketing", name: "Marketing", icon: "◉", color: "#f0b429",
    mission: "Run campaigns, manage content distribution, track channel performance.",
    agents: [
      { name: "Marketing Agent", icon: "◉", color: "#f0b429", status: "active", model: "claude-sonnet-4-6" },
      { name: "SEO Agent",       icon: "⌕", color: "#4ecdc4", status: "active", model: "claude-sonnet-4-6" },
    ],
    activeWork: [
      { title: "LinkedIn post: Phase 9 AI OS release",        status: "in_progress" },
      { title: "Keyword gap analysis vs competitors",         status: "queued"      },
      { title: "Email subject line review — CTR drop -12%",   status: "in_progress" },
    ],
    metrics: { throughputToday: 22, successRate: "99%", openItems: 5, closedThisWeek: 18 },
    outcomes: [
      "SEO: 12 keywords tracked, 3 moved to page 1",
      "Email campaign: 24.1% open rate (above avg)",
      "LinkedIn post: 840 impressions, 42 clicks",
    ],
  },
  {
    id: "support", name: "Support", icon: "◎", color: "#52d68a",
    mission: "Triage tickets, draft responses from knowledge base, escalate critical issues.",
    agents: [
      { name: "Support Agent", icon: "◎", color: "#52d68a", status: "active", model: "claude-haiku-4-5-20251001" },
    ],
    activeWork: [
      { title: "Ticket #1024: WhatsApp QR not scanning",      status: "in_progress" },
      { title: "Ticket #1025: Payment confirmation missing",  status: "queued"      },
      { title: "FAQ update: 4 new entries from this week",    status: "done"        },
    ],
    metrics: { throughputToday: 31, successRate: "98.8%", openItems: 2, closedThisWeek: 28 },
    outcomes: [
      "28 tickets resolved this week (avg 8 min TTR)",
      "2 issues escalated to Dev Agent (bug reports)",
      "1 upsell signal routed to Sales Agent",
    ],
  },
  {
    id: "operations", name: "Operations", icon: "▣", color: "#38bdf8",
    mission: "Monitor system health, collect metrics, generate reports, coordinate cross-department work.",
    agents: [
      { name: "Analytics Agent", icon: "▣", color: "#38bdf8", status: "active", model: "claude-sonnet-4-6" },
      { name: "DevOps Agent",    icon: "⬟", color: "#fc6d26", status: "paused", model: "claude-sonnet-4-6" },
    ],
    activeWork: [
      { title: "Weekly performance dashboard generation",     status: "in_progress" },
      { title: "Mobile API Proxy degraded — monitoring",      status: "in_progress" },
      { title: "Terraform remote state migration",            status: "queued"      },
    ],
    metrics: { throughputToday: 23, successRate: "99.3%", openItems: 3, closedThisWeek: 21 },
    outcomes: [
      "99.97% API uptime this week",
      "1 incident auto-resolved via rollback",
      "Weekly analytics report delivered on schedule",
    ],
  },
  {
    id: "engineering", name: "Engineering", icon: "⬡", color: "#e6edf3",
    mission: "Write, review, test, and ship code. Maintain infra. Ensure quality and reliability.",
    agents: [
      { name: "Dev Agent",      icon: "⬡", color: "#e6edf3", status: "idle", model: "claude-opus-4-8"    },
      { name: "Research Agent", icon: "⊕", color: "#a78bfa", status: "idle", model: "claude-opus-4-8"    },
    ],
    activeWork: [
      { title: "PR #48: DevOps monitoring improvements",      status: "queued"      },
      { title: "Fix Android cold-start Firebase null crash",  status: "in_progress" },
      { title: "Research: pgvector for knowledge base",       status: "in_progress" },
    ],
    metrics: { throughputToday: 9, successRate: "97%", openItems: 6, closedThisWeek: 7 },
    outcomes: [
      "Phase 10 & 11 shipped — 3,496 lines added",
      "1 critical bug fixed (Android crash PR #3)",
      "Research: pgvector vs Pinecone report complete",
    ],
  },
];

const STATUS_CFG = {
  active:      { color: "var(--success)", pulse: true  },
  idle:        { color: "var(--accent2)", pulse: false },
  paused:      { color: "var(--warning)", pulse: false },
};
const WORK_STATUS_COLORS = { in_progress: "var(--accent2)", queued: "var(--text-faint)", done: "var(--success)" };

function DeptCard({ dept, selected, onSelect }) {
  const activeAgents = dept.agents.filter(a => a.status === "active").length;
  return (
    <button className={`acc2-dept-card${selected ? " acc2-dept-card--sel" : ""}`} onClick={() => onSelect(dept.id)}>
      <div className="acc2-dept-icon-wrap" style={{ background: dept.color + "18", borderColor: dept.color + "2e" }}>
        <span style={{ color: dept.color, fontSize: 20, fontWeight: 900 }}>{dept.icon}</span>
      </div>
      <div className="acc2-dept-info">
        <span className="acc2-dept-name" style={{ color: dept.color }}>{dept.name}</span>
        <span className="acc2-dept-agents">{dept.agents.length} agent{dept.agents.length > 1 ? "s" : ""} · {activeAgents} active</span>
      </div>
      <div className="acc2-dept-quick">
        <span className="acc2-dept-tp">{dept.metrics.throughputToday} tasks today</span>
        <span className="acc2-dept-sr" style={{ color: parseFloat(dept.metrics.successRate) >= 98 ? "var(--success)" : "var(--warning)" }}>
          {dept.metrics.successRate} ok
        </span>
      </div>
    </button>
  );
}

function DeptDetail({ dept }) {
  return (
    <div className="acc2-detail">
      {/* Header */}
      <div className="acc2-detail-head">
        <div className="acc2-detail-icon-wrap" style={{ background: dept.color + "18", borderColor: dept.color + "2e" }}>
          <span style={{ color: dept.color, fontSize: 22, fontWeight: 900 }}>{dept.icon}</span>
        </div>
        <div>
          <span className="acc2-detail-name" style={{ color: dept.color }}>{dept.name} Department</span>
          <p className="acc2-detail-mission">{dept.mission}</p>
        </div>
      </div>

      {/* Metrics */}
      <div className="acc2-metrics-grid">
        {[
          { label: "Throughput today", value: dept.metrics.throughputToday, color: "var(--accent2)" },
          { label: "Success rate",     value: dept.metrics.successRate,     color: parseFloat(dept.metrics.successRate)>=98?"var(--success)":"var(--warning)" },
          { label: "Open items",       value: dept.metrics.openItems,       color: dept.metrics.openItems>5?"var(--warning)":"var(--text)" },
          { label: "Closed this week", value: dept.metrics.closedThisWeek,  color: "var(--success)" },
        ].map(m => (
          <div key={m.label} className="acc2-metric-tile">
            <span className="acc2-mt-val" style={{ color: m.color }}>{m.value}</span>
            <span className="acc2-mt-label">{m.label}</span>
          </div>
        ))}
      </div>

      {/* Agents */}
      <div className="acc2-detail-section">
        <p className="acc2-ds-label">Agents</p>
        <div className="acc2-agents-list">
          {dept.agents.map(ag => {
            const sc = STATUS_CFG[ag.status] || STATUS_CFG.idle;
            return (
              <div key={ag.name} className="acc2-agent-row">
                <div className="acc2-agent-icon-wrap" style={{ background: ag.color + "18", borderColor: ag.color + "2e" }}>
                  <span style={{ color: ag.color }}>{ag.icon}</span>
                </div>
                <div className="acc2-agent-info">
                  <span className="acc2-agent-name">{ag.name}</span>
                  <span className="acc2-agent-model">{ag.model.replace("claude-","").replace("-20251001","")}</span>
                </div>
                <div className="acc2-agent-status">
                  {sc.pulse && <span className="acc2-pulse" style={{ background: sc.color }} />}
                  <span style={{ color: sc.color, fontSize: 12, fontWeight: 700, textTransform: "uppercase" }}>{ag.status}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Active work */}
      <div className="acc2-detail-section">
        <p className="acc2-ds-label">Active work</p>
        <div className="acc2-work-list">
          {dept.activeWork.map((w, i) => (
            <div key={i} className="acc2-work-row">
              <span className="acc2-work-dot" style={{ background: WORK_STATUS_COLORS[w.status] }} />
              <span className="acc2-work-title">{w.title}</span>
              <span className="acc2-work-status" style={{ color: WORK_STATUS_COLORS[w.status] }}>{w.status.replace("_"," ")}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Outcomes */}
      <div className="acc2-detail-section">
        <p className="acc2-ds-label">This week's outcomes</p>
        <div className="acc2-outcomes-list">
          {dept.outcomes.map((o, i) => (
            <div key={i} className="acc2-outcome-row">
              <span className="acc2-outcome-check" style={{ color: dept.color }}>✓</span>
              <span className="acc2-outcome-text">{o}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function AutonomousCompanyCenter({ onNavigate }) {
  const [selected, setSelected] = useState("sales");

  React.useEffect(() => { track.event("autonomous_company_viewed"); }, []);

  const selDept   = DEPARTMENTS.find(d => d.id === selected);
  const totalAgents = DEPARTMENTS.reduce((s,d) => s + d.agents.length, 0);
  const activeAgents = DEPARTMENTS.reduce((s,d) => s + d.agents.filter(a=>a.status==="active").length, 0);
  const totalTasks  = DEPARTMENTS.reduce((s,d) => s + d.metrics.throughputToday, 0);

  return (
    <div className="autonomous-company-center page-enter">
      <div className="acc2-header">
        <div>
          <h1 className="acc2-title">Autonomous Company</h1>
          <p className="acc2-subtitle">5 departments, {totalAgents} agents running autonomously. Sales · Marketing · Support · Operations · Engineering.</p>
        </div>
        <div className="acc2-header-stats">
          <div className="acc2-hstat">
            <span className="acc2-hstat-v" style={{ color: "var(--success)" }}>{activeAgents}</span>
            <span className="acc2-hstat-l">Active now</span>
          </div>
          <div className="acc2-hstat">
            <span className="acc2-hstat-v" style={{ color: "var(--accent2)" }}>{totalTasks}</span>
            <span className="acc2-hstat-l">Tasks today</span>
          </div>
        </div>
      </div>

      <div className="acc2-layout">
        <div className="acc2-dept-list">
          {DEPARTMENTS.map(d => (
            <DeptCard key={d.id} dept={d} selected={selected===d.id} onSelect={setSelected} />
          ))}
        </div>
        {selDept && <DeptDetail dept={selDept} />}
      </div>
    </div>
  );
}
