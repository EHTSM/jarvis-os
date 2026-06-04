import React, { useState } from "react";
import { track } from "../analytics";
import "./AutonomousRevenueCenter.css";

const LEAD_AGENTS = [
  { id:"la1", name:"LinkedIn Prospector",     status:"running", leadsToday:14, leadsTotal:312,  successRate:"68%", lastRun:"2m ago",  model:"llama3:8b"       },
  { id:"la2", name:"Inbound Qualifier",       status:"running", leadsToday:7,  leadsTotal:189,  successRate:"82%", lastRun:"4m ago",  model:"deepseek-chat"   },
  { id:"la3", name:"Referral Harvester",      status:"idle",    leadsToday:0,  leadsTotal:94,   successRate:"91%", lastRun:"6h ago",  model:"mistral:7b"      },
  { id:"la4", name:"Cold Outreach Bot",       status:"running", leadsToday:22, leadsTotal:640,  successRate:"31%", lastRun:"1m ago",  model:"qwen2-7b"        },
  { id:"la5", name:"Event Follow-Up Agent",   status:"paused",  leadsToday:0,  leadsTotal:57,   successRate:"74%", lastRun:"2d ago",  model:"phi3:mini"       },
];

const FOLLOWUP_AGENTS = [
  { id:"fa1", name:"WhatsApp Nurture Seq.",   status:"running", actionsToday:48, replyRate:"62%", convRate:"18%", lastRun:"< 1m",  messages:1840 },
  { id:"fa2", name:"Email Drip Executor",     status:"running", actionsToday:31, replyRate:"44%", convRate:"9%",  lastRun:"3m ago",messages:920  },
  { id:"fa3", name:"Objection Handler",       status:"running", actionsToday:9,  replyRate:"71%", convRate:"34%", lastRun:"8m ago",messages:340  },
  { id:"fa4", name:"Re-Engagement Agent",     status:"idle",    actionsToday:0,  replyRate:"28%", convRate:"11%", lastRun:"4h ago",messages:180  },
];

const CONVERSION_AGENTS = [
  { id:"ca1", name:"Proposal Generator",      status:"running", dealsToday:3,  dealsTotal:47,  value:"₹2.4L",  winRate:"41%", lastRun:"12m ago" },
  { id:"ca2", name:"Pricing Negotiator",      status:"running", dealsToday:1,  dealsTotal:29,  value:"₹1.1L",  winRate:"58%", lastRun:"34m ago" },
  { id:"ca3", name:"Contract Closer",         status:"idle",    dealsToday:0,  dealsTotal:18,  value:"₹88K",   winRate:"72%", lastRun:"1h ago"  },
  { id:"ca4", name:"Upsell Trigger Agent",    status:"running", dealsToday:2,  dealsTotal:31,  value:"₹64K",   winRate:"37%", lastRun:"22m ago" },
];

const PIPELINE = [
  { stage:"Awareness",    count:312, value:"₹0",    pct:100 },
  { stage:"Qualified",    count:189, value:"₹9.4L", pct:61  },
  { stage:"Engaged",      count:94,  value:"₹18.8L",pct:30  },
  { stage:"Proposal",     count:47,  value:"₹23.5L",pct:15  },
  { stage:"Closing",      count:18,  value:"₹14.4L",pct:6   },
  { stage:"Won",          count:11,  value:"₹8.8L", pct:4   },
];

const STATUS_COLOR = { running:"var(--success)", idle:"var(--text-faint)", paused:"var(--warning)", error:"var(--danger)" };

function StatusDot({ status }) {
  return <span className="arc-status-dot" style={{background:STATUS_COLOR[status]||"var(--text-faint)"}} title={status} />;
}

export default function AutonomousRevenueCenter({ onNavigate }) {
  const [section, setSection] = useState("overview");

  React.useEffect(() => { track.event("autonomous_revenue_viewed"); }, []);

  const runningAgents  = [...LEAD_AGENTS,...FOLLOWUP_AGENTS,...CONVERSION_AGENTS].filter(a=>a.status==="running").length;
  const totalAgents    = LEAD_AGENTS.length + FOLLOWUP_AGENTS.length + CONVERSION_AGENTS.length;
  const leadsToday     = LEAD_AGENTS.reduce((a,x)=>a+x.leadsToday,0);
  const actionsToday   = FOLLOWUP_AGENTS.reduce((a,x)=>a+x.actionsToday,0);
  const dealsToday     = CONVERSION_AGENTS.reduce((a,x)=>a+x.dealsToday,0);

  const SECTIONS = [
    {id:"overview",    label:"Overview"},
    {id:"leads",       label:"Lead Agents"},
    {id:"followup",    label:"Follow-Up Agents"},
    {id:"conversion",  label:"Conversion Agents"},
    {id:"pipeline",    label:"Pipeline Health"},
  ];

  return (
    <div className="autonomous-revenue-center page-enter">
      <div className="arc-header">
        <div>
          <h1 className="arc-title">Autonomous Revenue Engine</h1>
          <p className="arc-subtitle">Lead generation · Follow-up · Conversion · Pipeline health — running 24/7 without human input.</p>
        </div>
        <div className="arc-live-badge">LIVE</div>
      </div>

      <div className="arc-summary-strip">
        {[
          { label:"Agents running",    value:`${runningAgents}/${totalAgents}`, color:"var(--success)" },
          { label:"Leads today",       value:leadsToday,                        color:"var(--accent2)" },
          { label:"Actions today",     value:actionsToday,                      color:"var(--accent)"  },
          { label:"Deals today",       value:dealsToday,                        color:"var(--warning)" },
          { label:"Pipeline value",    value:"₹74.9L",                          color:"var(--success)" },
          { label:"Revenue (MTD)",     value:"₹8.8L",                           color:"#52d68a"        },
        ].map(s=>(
          <div key={s.label} className="arc-summary-tile">
            <span className="arc-sv" style={{color:s.color}}>{s.value}</span>
            <span className="arc-sl">{s.label}</span>
          </div>
        ))}
      </div>

      <div className="arc-tabs">
        {SECTIONS.map(t=>(
          <button key={t.id} className={`arc-tab${section===t.id?" arc-tab--active":""}`} onClick={()=>setSection(t.id)}>{t.label}</button>
        ))}
      </div>

      <div className="arc-content" key={section}>

        {section==="overview" && (
          <div className="arc-overview">
            <div className="arc-ov-cards">
              {[
                {title:"Lead Agents",       count:LEAD_AGENTS.length,       running:LEAD_AGENTS.filter(a=>a.status==="running").length,      metric:`${leadsToday} leads today`,   color:"var(--accent2)", id:"leads"},
                {title:"Follow-Up Agents",  count:FOLLOWUP_AGENTS.length,   running:FOLLOWUP_AGENTS.filter(a=>a.status==="running").length,  metric:`${actionsToday} actions today`,color:"var(--accent)",  id:"followup"},
                {title:"Conversion Agents", count:CONVERSION_AGENTS.length, running:CONVERSION_AGENTS.filter(a=>a.status==="running").length,metric:`${dealsToday} deals today`,   color:"var(--warning)", id:"conversion"},
              ].map(c=>(
                <div key={c.id} className="arc-ov-card" onClick={()=>setSection(c.id)}>
                  <div className="arc-ov-card-top">
                    <span className="arc-ov-card-title">{c.title}</span>
                    <span className="arc-ov-running" style={{color:c.color}}>{c.running}/{c.count} running</span>
                  </div>
                  <span className="arc-ov-metric" style={{color:c.color}}>{c.metric}</span>
                </div>
              ))}
            </div>

            <div className="arc-ov-pipeline">
              <p className="arc-ov-label">Revenue pipeline health</p>
              <div className="arc-pipeline-funnel">
                {PIPELINE.map((s,i)=>(
                  <div key={s.stage} className="arc-funnel-row">
                    <span className="arc-funnel-stage">{s.stage}</span>
                    <div className="arc-funnel-bar-wrap">
                      <div className="arc-funnel-bar" style={{width:`${s.pct}%`,background:`hsl(${160-i*20},70%,${55-i*3}%)`}} />
                    </div>
                    <span className="arc-funnel-count">{s.count}</span>
                    <span className="arc-funnel-value">{s.value}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="arc-opps-row">
              <div className="arc-opp-card">
                <span className="arc-opp-val" style={{color:"var(--success)"}}>₹23.5L</span>
                <span className="arc-opp-label">Proposal stage opportunities</span>
              </div>
              <div className="arc-opp-card">
                <span className="arc-opp-val" style={{color:"var(--warning)"}}>₹14.4L</span>
                <span className="arc-opp-label">Closing stage (hot)</span>
              </div>
              <div className="arc-opp-card">
                <span className="arc-opp-val" style={{color:"var(--accent2)"}}>₹36.9L</span>
                <span className="arc-opp-label">Total at-risk opportunities</span>
              </div>
            </div>
          </div>
        )}

        {section==="leads" && (
          <div className="arc-agent-list">
            {LEAD_AGENTS.map(a=>(
              <div key={a.id} className={`arc-agent-row arc-agent-row--${a.status}`}>
                <StatusDot status={a.status} />
                <div className="arc-agent-info">
                  <span className="arc-agent-name">{a.name}</span>
                  <span className="arc-agent-model">{a.model}</span>
                </div>
                <div className="arc-agent-metrics">
                  <span className="arc-agent-metric"><span className="arc-agent-mv" style={{color:"var(--accent2)"}}>{a.leadsToday}</span> today</span>
                  <span className="arc-agent-metric"><span className="arc-agent-mv">{a.leadsTotal}</span> total</span>
                  <span className="arc-agent-metric"><span className="arc-agent-mv" style={{color:"var(--success)"}}>{a.successRate}</span> success</span>
                </div>
                <span className="arc-agent-ts">{a.lastRun}</span>
                <span className={`arc-agent-status arc-agent-status--${a.status}`}>{a.status}</span>
              </div>
            ))}
          </div>
        )}

        {section==="followup" && (
          <div className="arc-agent-list">
            {FOLLOWUP_AGENTS.map(a=>(
              <div key={a.id} className={`arc-agent-row arc-agent-row--${a.status}`}>
                <StatusDot status={a.status} />
                <div className="arc-agent-info">
                  <span className="arc-agent-name">{a.name}</span>
                  <span className="arc-agent-model">{a.messages.toLocaleString("en-IN")} msgs total</span>
                </div>
                <div className="arc-agent-metrics">
                  <span className="arc-agent-metric"><span className="arc-agent-mv" style={{color:"var(--accent)"}}>{a.actionsToday}</span> actions today</span>
                  <span className="arc-agent-metric"><span className="arc-agent-mv">{a.replyRate}</span> reply rate</span>
                  <span className="arc-agent-metric"><span className="arc-agent-mv" style={{color:"var(--success)"}}>{a.convRate}</span> conv.</span>
                </div>
                <span className="arc-agent-ts">{a.lastRun}</span>
                <span className={`arc-agent-status arc-agent-status--${a.status}`}>{a.status}</span>
              </div>
            ))}
          </div>
        )}

        {section==="conversion" && (
          <div className="arc-agent-list">
            {CONVERSION_AGENTS.map(a=>(
              <div key={a.id} className={`arc-agent-row arc-agent-row--${a.status}`}>
                <StatusDot status={a.status} />
                <div className="arc-agent-info">
                  <span className="arc-agent-name">{a.name}</span>
                  <span className="arc-agent-model">{a.dealsTotal} deals closed total</span>
                </div>
                <div className="arc-agent-metrics">
                  <span className="arc-agent-metric"><span className="arc-agent-mv" style={{color:"var(--warning)"}}>{a.dealsToday}</span> today</span>
                  <span className="arc-agent-metric"><span className="arc-agent-mv" style={{color:"var(--success)"}}>{a.value}</span> value</span>
                  <span className="arc-agent-metric"><span className="arc-agent-mv">{a.winRate}</span> win rate</span>
                </div>
                <span className="arc-agent-ts">{a.lastRun}</span>
                <span className={`arc-agent-status arc-agent-status--${a.status}`}>{a.status}</span>
              </div>
            ))}
          </div>
        )}

        {section==="pipeline" && (
          <div className="arc-pipeline-section">
            <div className="arc-pipeline-funnel arc-pipeline-funnel--full">
              {PIPELINE.map((s,i)=>(
                <div key={s.stage} className="arc-funnel-row arc-funnel-row--full">
                  <span className="arc-funnel-stage">{s.stage}</span>
                  <div className="arc-funnel-bar-wrap">
                    <div className="arc-funnel-bar" style={{width:`${s.pct}%`,background:`hsl(${160-i*20},70%,${55-i*3}%)`}} />
                    <span className="arc-funnel-bar-pct">{s.pct}%</span>
                  </div>
                  <span className="arc-funnel-count">{s.count} leads</span>
                  <span className="arc-funnel-value">{s.value}</span>
                </div>
              ))}
            </div>
            <div className="arc-pipeline-health-kpis">
              {[
                {label:"Avg deal velocity",  value:"11d", note:"lead→close"},
                {label:"Pipeline coverage",  value:"8.5x", note:"vs quota"},
                {label:"Win rate",           value:"41%", note:"last 90d"},
                {label:"Avg deal size",      value:"₹80K", note:"closed deals"},
              ].map(k=>(
                <div key={k.label} className="arc-kpi-card">
                  <span className="arc-kpi-val">{k.value}</span>
                  <span className="arc-kpi-label">{k.label}</span>
                  <span className="arc-kpi-note">{k.note}</span>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
