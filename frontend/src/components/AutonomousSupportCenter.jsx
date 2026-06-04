import React, { useState } from "react";
import { track } from "../analytics";
import "./AutonomousSupportCenter.css";

const TICKETS = [
  { id:"t1",  subject:"WhatsApp session not reconnecting",      status:"resolved",   auto:true,  sla:"met",  resolution:"4m",  agent:"WA Debug Agent",    ts:"2h ago"  },
  { id:"t2",  subject:"Lead not receiving follow-up messages",  status:"resolved",   auto:true,  sla:"met",  resolution:"6m",  agent:"Pipeline Debugger", ts:"3h ago"  },
  { id:"t3",  subject:"CSV import failing on row 47",           status:"resolved",   auto:true,  sla:"met",  resolution:"2m",  agent:"Data Validator",    ts:"4h ago"  },
  { id:"t4",  subject:"Can I export all contacts to Excel?",    status:"resolved",   auto:true,  sla:"met",  resolution:"1m",  agent:"KB Search Agent",   ts:"5h ago"  },
  { id:"t5",  subject:"Payment receipt not showing in logs",    status:"escalated",  auto:false, sla:"met",  resolution:"28m", agent:"Human (Altamash)",  ts:"6h ago"  },
  { id:"t6",  subject:"How to set up Google Sheets integration",status:"resolved",   auto:true,  sla:"met",  resolution:"3m",  agent:"KB Search Agent",   ts:"8h ago"  },
  { id:"t7",  subject:"Agent not triggering on new lead",       status:"resolved",   auto:true,  sla:"met",  resolution:"9m",  agent:"Trigger Debugger",  ts:"10h ago" },
  { id:"t8",  subject:"Billing plan upgrade question",          status:"escalated",  auto:false, sla:"miss", resolution:"—",   agent:"Human queue",       ts:"12h ago" },
];

const KB_ARTICLES = [
  { id:"kb1", title:"WhatsApp reconnection: 5 common causes and fixes",       views:312, helpful:"94%", auto:true,  ts:"2026-05-28" },
  { id:"kb2", title:"Setting up your first follow-up sequence",               views:284, helpful:"98%", auto:false, ts:"2026-05-20" },
  { id:"kb3", title:"CSV import requirements and common errors",               views:196, helpful:"91%", auto:true,  ts:"2026-06-01" },
  { id:"kb4", title:"Google Sheets integration: step-by-step",                views:178, helpful:"97%", auto:true,  ts:"2026-06-03" },
  { id:"kb5", title:"How agent triggers work: lead lifecycle explained",       views:154, helpful:"96%", auto:true,  ts:"2026-05-30" },
];

const SUPPORT_AGENTS = [
  { id:"sa1", name:"KB Search Agent",      status:"running", resolved:48, avgTime:"1.2m", deflections:48,  model:"deepseek-chat", lastRun:"< 1m"    },
  { id:"sa2", name:"WA Debug Agent",       status:"running", resolved:12, avgTime:"4.1m", deflections:12,  model:"mistral:7b",    lastRun:"2m ago"  },
  { id:"sa3", name:"Pipeline Debugger",    status:"running", resolved:9,  avgTime:"5.8m", deflections:9,   model:"llama3:8b",     lastRun:"3h ago"  },
  { id:"sa4", name:"Trigger Debugger",     status:"running", resolved:7,  avgTime:"9.0m", deflections:7,   model:"deepseek-chat", lastRun:"10h ago" },
  { id:"sa5", name:"Data Validator",       status:"running", resolved:6,  avgTime:"2.3m", deflections:6,   model:"phi3:mini",     lastRun:"4h ago"  },
  { id:"sa6", name:"Escalation Router",    status:"running", resolved:2,  avgTime:"0.4m", deflections:0,   model:"phi3:mini",     lastRun:"6h ago"  },
];

const STATUS_COLOR = { resolved:"var(--success)", escalated:"var(--warning)", open:"var(--accent2)", running:"var(--success)", idle:"var(--text-faint)" };

function Dot({ status }) {
  return <span className="asc-dot" style={{background:STATUS_COLOR[status]||"var(--text-faint)"}} />;
}

export default function AutonomousSupportCenter({ onNavigate }) {
  const [section, setSection] = useState("overview");

  React.useEffect(() => { track.event("autonomous_support_viewed"); }, []);

  const resolvedCount   = TICKETS.filter(t=>t.status==="resolved").length;
  const autoResolved    = TICKETS.filter(t=>t.auto).length;
  const escalated       = TICKETS.filter(t=>t.status==="escalated").length;
  const slaMet          = TICKETS.filter(t=>t.sla==="met").length;
  const automationPct   = Math.round(autoResolved/TICKETS.length*100);
  const kbTotal         = KB_ARTICLES.reduce((a,k)=>a+k.views,0);

  const SECTIONS = [
    {id:"overview",   label:"Overview"},
    {id:"tickets",    label:"Tickets"},
    {id:"agents",     label:"Support Agents"},
    {id:"knowledge",  label:"Knowledge Base"},
  ];

  return (
    <div className="autonomous-support-center page-enter">
      <div className="asc-header">
        <div>
          <h1 className="asc-title">Autonomous Support Engine</h1>
          <p className="asc-subtitle">Ticket resolution · Knowledge creation · Escalation prevention · SLA · Automation % — no human queue.</p>
        </div>
        <div className="asc-live-badge">LIVE</div>
      </div>

      <div className="asc-summary-strip">
        {[
          { label:"Resolved today",      value:resolvedCount,          color:"var(--success)" },
          { label:"Automation %",        value:`${automationPct}%`,   color:"var(--accent2)" },
          { label:"Escalated",           value:escalated,              color:"var(--warning)" },
          { label:"SLA compliance",      value:`${Math.round(slaMet/TICKETS.length*100)}%`, color:"var(--success)" },
          { label:"KB articles",         value:KB_ARTICLES.length,     color:"var(--accent)"  },
          { label:"KB views (MTD)",      value:kbTotal.toLocaleString("en-IN"), color:"#7c6fff" },
        ].map(s=>(
          <div key={s.label} className="asc-summary-tile">
            <span className="asc-sv" style={{color:s.color}}>{s.value}</span>
            <span className="asc-sl">{s.label}</span>
          </div>
        ))}
      </div>

      <div className="asc-tabs">
        {SECTIONS.map(t=>(
          <button key={t.id} className={`asc-tab${section===t.id?" asc-tab--active":""}`} onClick={()=>setSection(t.id)}>{t.label}</button>
        ))}
      </div>

      <div className="asc-content" key={section}>

        {section==="overview" && (
          <div className="asc-overview">
            <div className="asc-ov-top">
              <div className="asc-ov-card asc-ov-card--score">
                <p className="asc-ov-label">Resolution automation</p>
                <div className="asc-score-ring-wrap">
                  <svg className="asc-score-ring" viewBox="0 0 80 80">
                    <circle cx="40" cy="40" r="34" fill="none" stroke="rgba(255,255,255,.07)" strokeWidth="7"/>
                    <circle cx="40" cy="40" r="34" fill="none" stroke="var(--success)" strokeWidth="7"
                      strokeDasharray={`${automationPct*2.136} 213.6`} strokeLinecap="round"
                      transform="rotate(-90 40 40)" />
                  </svg>
                  <span className="asc-score-val">{automationPct}%</span>
                </div>
                <span className="asc-score-sub">{autoResolved} of {TICKETS.length} tickets today</span>
              </div>

              <div className="asc-ov-card">
                <p className="asc-ov-label">SLA compliance</p>
                <div className="asc-sla-ring-wrap">
                  <svg className="asc-score-ring" viewBox="0 0 80 80">
                    <circle cx="40" cy="40" r="34" fill="none" stroke="rgba(255,255,255,.07)" strokeWidth="7"/>
                    <circle cx="40" cy="40" r="34" fill="none" stroke="var(--accent2)" strokeWidth="7"
                      strokeDasharray={`${Math.round(slaMet/TICKETS.length*100)*2.136} 213.6`} strokeLinecap="round"
                      transform="rotate(-90 40 40)" />
                  </svg>
                  <span className="asc-score-val">{Math.round(slaMet/TICKETS.length*100)}%</span>
                </div>
                <span className="asc-score-sub">{slaMet} of {TICKETS.length} within SLA</span>
              </div>

              <div className="asc-ov-card">
                <p className="asc-ov-label">Escalations prevented</p>
                <span className="asc-big-num" style={{color:"var(--warning)"}}>84</span>
                <span className="asc-big-sub">this month · {escalated} escalated today</span>
                <div className="asc-escalation-breakdown">
                  {[
                    {label:"Auto-resolved (no escalation)", pct:automationPct, color:"var(--success)"},
                    {label:"Escalated",                     pct:100-automationPct, color:"var(--warning)"},
                  ].map(r=>(
                    <div key={r.label} className="asc-esc-row">
                      <span className="asc-esc-label">{r.label}</span>
                      <div className="asc-esc-bar-track"><div className="asc-esc-bar-fill" style={{width:`${r.pct}%`,background:r.color}} /></div>
                      <span className="asc-esc-pct">{r.pct}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="asc-kpi-row">
              {[
                {label:"Avg resolution time",     value:"3.8m",  note:"automated tickets",  color:"var(--success)"},
                {label:"Articles auto-generated", value:"4",     note:"this week",           color:"var(--accent2)"},
                {label:"Deflection rate",         value:"76%",   note:"tickets→KB self-serve",color:"var(--accent)"},
                {label:"CSAT (avg)",              value:"4.8/5", note:"last 30 responses",   color:"var(--warning)"},
              ].map(k=>(
                <div key={k.label} className="asc-kpi-card">
                  <span className="asc-kpi-val" style={{color:k.color}}>{k.value}</span>
                  <span className="asc-kpi-label">{k.label}</span>
                  <span className="asc-kpi-note">{k.note}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {section==="tickets" && (
          <div className="asc-ticket-list">
            {TICKETS.map(t=>(
              <div key={t.id} className={`asc-ticket-row asc-ticket-row--${t.status}`}>
                <Dot status={t.status} />
                <div className="asc-ticket-info">
                  <span className="asc-ticket-subject">{t.subject}</span>
                  <div className="asc-ticket-meta">
                    <span>{t.agent}</span>
                    <span className="asc-ticket-sep">·</span>
                    {t.auto && <span className="asc-auto-badge">Auto</span>}
                    <span>SLA: <span style={{color:t.sla==="met"?"var(--success)":"var(--danger)"}}>{t.sla}</span></span>
                  </div>
                </div>
                <div className="asc-ticket-right">
                  <span className="asc-ticket-time">{t.resolution !== "—" ? `Resolved in ${t.resolution}` : "Pending"}</span>
                  <span className="asc-ticket-ts">{t.ts}</span>
                  <span className={`asc-ticket-status asc-ticket-status--${t.status}`}>{t.status}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {section==="agents" && (
          <div className="asc-agent-list">
            {SUPPORT_AGENTS.map(a=>(
              <div key={a.id} className={`asc-agent-row asc-agent-row--${a.status}`}>
                <span className="asc-agent-dot" style={{background:STATUS_COLOR[a.status]||"var(--text-faint)"}} />
                <div className="asc-agent-info">
                  <span className="asc-agent-name">{a.name}</span>
                  <span className="asc-agent-model">{a.model}</span>
                </div>
                <div className="asc-agent-metrics">
                  <span className="asc-agent-metric"><span className="asc-agent-mv" style={{color:"var(--success)"}}>{a.resolved}</span> resolved</span>
                  <span className="asc-agent-metric"><span className="asc-agent-mv">{a.avgTime}</span> avg</span>
                  <span className="asc-agent-metric"><span className="asc-agent-mv" style={{color:"var(--accent2)"}}>{a.deflections}</span> deflections</span>
                </div>
                <span className="asc-agent-ts">{a.lastRun}</span>
                <span className={`asc-agent-status asc-agent-status--${a.status}`}>{a.status}</span>
              </div>
            ))}
          </div>
        )}

        {section==="knowledge" && (
          <div className="asc-kb-list">
            {KB_ARTICLES.map(k=>(
              <div key={k.id} className="asc-kb-row">
                <div className="asc-kb-info">
                  <span className="asc-kb-title">{k.title}</span>
                  <div className="asc-kb-meta">
                    <span>{k.ts}</span>
                    {k.auto && <span className="asc-auto-badge">Auto-generated</span>}
                  </div>
                </div>
                <div className="asc-kb-stats">
                  <span className="asc-kb-stat"><span className="asc-kb-mv">{k.views}</span> views</span>
                  <span className="asc-kb-helpful" style={{color:"var(--success)"}}>{k.helpful} helpful</span>
                </div>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}
