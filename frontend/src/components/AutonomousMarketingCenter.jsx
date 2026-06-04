import React, { useState } from "react";
import { track } from "../analytics";
import "./AutonomousMarketingCenter.css";

const CONTENT_AGENTS = [
  { id:"ca1", name:"Blog Post Writer",       status:"running", today:3,  total:142, output:"articles",  quality:"4.7/5", model:"claude-3-haiku",  lastRun:"8m ago"  },
  { id:"ca2", name:"LinkedIn Post Agent",    status:"running", today:2,  total:84,  output:"posts",     quality:"4.5/5", model:"qwen2-72b",        lastRun:"15m ago" },
  { id:"ca3", name:"Short-Form Repurposer",  status:"running", today:6,  total:320, output:"clips",     quality:"4.3/5", model:"mistral:7b",       lastRun:"3m ago"  },
  { id:"ca4", name:"Newsletter Composer",    status:"idle",    today:0,  total:28,  output:"issues",    quality:"4.8/5", model:"claude-3-haiku",   lastRun:"3d ago"  },
  { id:"ca5", name:"Case Study Builder",     status:"running", today:1,  total:19,  output:"studies",   quality:"4.9/5", model:"deepseek-chat",    lastRun:"1h ago"  },
];

const SEO_AGENTS = [
  { id:"sa1", name:"Keyword Research Bot",   status:"running", today:24, total:840,  output:"keywords",  rank:"#4 avg",  lastRun:"5m ago"  },
  { id:"sa2", name:"On-Page Optimizer",      status:"running", today:8,  total:218,  output:"pages",     rank:"+12 pos", lastRun:"18m ago" },
  { id:"sa3", name:"Backlink Prospector",    status:"idle",    today:0,  total:94,   output:"prospects", rank:"+8 DA",   lastRun:"6h ago"  },
  { id:"sa4", name:"SERP Tracker",           status:"running", today:40, total:1200, output:"keywords",  rank:"↑ 18%",   lastRun:"< 1m"    },
];

const SOCIAL_AGENTS = [
  { id:"soa1", name:"Twitter/X Poster",      status:"running", today:4,  total:312,  reach:"14.2K", engagement:"3.8%", lastRun:"1h ago"  },
  { id:"soa2", name:"Instagram Caption Bot", status:"running", today:2,  total:186,  reach:"8.9K",  engagement:"5.1%", lastRun:"2h ago"  },
  { id:"soa3", name:"WhatsApp Broadcast",    status:"running", today:1,  total:48,   reach:"2.1K",  engagement:"71%",  lastRun:"4h ago"  },
  { id:"soa4", name:"Community Engager",     status:"idle",    today:0,  total:240,  reach:"4.4K",  engagement:"8.2%", lastRun:"8h ago"  },
];

const CAMPAIGN_AGENTS = [
  { id:"cma1", name:"Product Launch Seq.",   status:"running", phase:"Active",   leads:84,  clicks:1240, spend:"₹0",    roi:"∞",    lastRun:"< 1m"    },
  { id:"cma2", name:"Retargeting Agent",     status:"paused",  phase:"Paused",   leads:12,  clicks:380,  spend:"₹4.2K", roi:"6.2x", lastRun:"2d ago"  },
  { id:"cma3", name:"Partnership Outreach",  status:"running", phase:"Week 2/4", leads:31,  clicks:0,    spend:"₹0",    roi:"∞",    lastRun:"3h ago"  },
  { id:"cma4", name:"Trial Activation Seq.", status:"running", phase:"Active",   leads:0,   clicks:640,  spend:"₹0",    roi:"∞",    lastRun:"6m ago"  },
];

const TRAFFIC_HISTORY = [
  {month:"Jan",visits:420},{month:"Feb",visits:610},{month:"Mar",visits:880},
  {month:"Apr",visits:1240},{month:"May",visits:1820},{month:"Jun",visits:2340},
];

const STATUS_COLOR = { running:"var(--success)", idle:"var(--text-faint)", paused:"var(--warning)", error:"var(--danger)" };

function StatusDot({ status }) {
  return <span className="amc-status-dot" style={{background:STATUS_COLOR[status]||"var(--text-faint)"}} title={status} />;
}

export default function AutonomousMarketingCenter({ onNavigate }) {
  const [section, setSection] = useState("overview");

  React.useEffect(() => { track.event("autonomous_marketing_viewed"); }, []);

  const runningAll   = [...CONTENT_AGENTS,...SEO_AGENTS,...SOCIAL_AGENTS,...CAMPAIGN_AGENTS].filter(a=>a.status==="running").length;
  const totalAll     = CONTENT_AGENTS.length + SEO_AGENTS.length + SOCIAL_AGENTS.length + CAMPAIGN_AGENTS.length;
  const contentToday = CONTENT_AGENTS.reduce((a,x)=>a+x.today,0);
  const seoToday     = SEO_AGENTS.reduce((a,x)=>a+x.today,0);
  const totalReach   = "29.6K";

  const SECTIONS = [
    {id:"overview",  label:"Overview"},
    {id:"content",   label:"Content Agents"},
    {id:"seo",       label:"SEO Agents"},
    {id:"social",    label:"Social Agents"},
    {id:"campaign",  label:"Campaign Agents"},
  ];

  return (
    <div className="autonomous-marketing-center page-enter">
      <div className="amc-header">
        <div>
          <h1 className="amc-title">Autonomous Marketing Engine</h1>
          <p className="amc-subtitle">Content · SEO · Social · Campaigns — producing, ranking, and distributing without human input.</p>
        </div>
        <div className="amc-live-badge">LIVE</div>
      </div>

      <div className="amc-summary-strip">
        {[
          { label:"Agents running",     value:`${runningAll}/${totalAll}`, color:"var(--success)" },
          { label:"Content today",      value:contentToday,                color:"var(--accent2)" },
          { label:"Keywords tracked",   value:seoToday,                    color:"var(--accent)"  },
          { label:"Total reach",        value:totalReach,                  color:"#7c6fff"        },
          { label:"Organic visits/mo",  value:"2,340",                     color:"var(--success)" },
          { label:"Campaigns active",   value:CAMPAIGN_AGENTS.filter(a=>a.status==="running").length, color:"var(--warning)" },
        ].map(s=>(
          <div key={s.label} className="amc-summary-tile">
            <span className="amc-sv" style={{color:s.color}}>{s.value}</span>
            <span className="amc-sl">{s.label}</span>
          </div>
        ))}
      </div>

      <div className="amc-tabs">
        {SECTIONS.map(t=>(
          <button key={t.id} className={`amc-tab${section===t.id?" amc-tab--active":""}`} onClick={()=>setSection(t.id)}>{t.label}</button>
        ))}
      </div>

      <div className="amc-content" key={section}>

        {section==="overview" && (
          <div className="amc-overview">
            <div className="amc-ov-top">
              <div className="amc-ov-card">
                <p className="amc-ov-label">Monthly organic traffic</p>
                <div className="amc-traffic-bars">
                  {TRAFFIC_HISTORY.map(m=>{
                    const max=Math.max(...TRAFFIC_HISTORY.map(x=>x.visits));
                    return (
                      <div key={m.month} className="amc-traffic-col">
                        <span className="amc-traffic-val">{m.visits>=1000?(m.visits/1000).toFixed(1)+"K":m.visits}</span>
                        <div className="amc-traffic-bar-track">
                          <div className="amc-traffic-bar-fill" style={{height:`${m.visits/max*100}%`,background:m.month==="Jun"?"var(--accent2)":"rgba(255,255,255,.18)"}} />
                        </div>
                        <span className="amc-traffic-month">{m.month}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="amc-ov-card">
                <p className="amc-ov-label">Content produced (total)</p>
                {[
                  {label:"Blog articles",  val:142, color:"var(--accent2)"},
                  {label:"Social posts",   val:782, color:"#7c6fff"},
                  {label:"Newsletters",    val:28,  color:"var(--warning)"},
                  {label:"Case studies",   val:19,  color:"var(--success)"},
                  {label:"Short-form",     val:320, color:"var(--accent)"},
                ].map(r=>(
                  <div key={r.label} className="amc-content-row">
                    <span className="amc-content-label">{r.label}</span>
                    <div className="amc-content-bar-track"><div className="amc-content-bar-fill" style={{width:`${Math.min(r.val/800*100,100)}%`,background:r.color}} /></div>
                    <span className="amc-content-val" style={{color:r.color}}>{r.val}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="amc-kpi-row">
              {[
                {label:"Rankings improved", value:"+47",     note:"positions, last 30d", color:"var(--success)"},
                {label:"Campaigns executed",value:"14",      note:"this quarter",        color:"var(--accent2)"},
                {label:"Avg SEO position",  value:"#4.2",    note:"tracked keywords",    color:"var(--accent)" },
                {label:"Content ROI",       value:"∞",       note:"zero ad spend",       color:"#52d68a"       },
              ].map(k=>(
                <div key={k.label} className="amc-kpi-card">
                  <span className="amc-kpi-val" style={{color:k.color}}>{k.value}</span>
                  <span className="amc-kpi-label">{k.label}</span>
                  <span className="amc-kpi-note">{k.note}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {section==="content" && (
          <div className="amc-agent-list">
            {CONTENT_AGENTS.map(a=>(
              <div key={a.id} className={`amc-agent-row amc-agent-row--${a.status}`}>
                <StatusDot status={a.status} />
                <div className="amc-agent-info">
                  <span className="amc-agent-name">{a.name}</span>
                  <span className="amc-agent-model">{a.model}</span>
                </div>
                <div className="amc-agent-metrics">
                  <span className="amc-agent-metric"><span className="amc-agent-mv" style={{color:"var(--accent2)"}}>{a.today}</span> {a.output} today</span>
                  <span className="amc-agent-metric"><span className="amc-agent-mv">{a.total}</span> total</span>
                  <span className="amc-agent-metric"><span className="amc-agent-mv" style={{color:"var(--warning)"}}>{a.quality}</span> quality</span>
                </div>
                <span className="amc-agent-ts">{a.lastRun}</span>
                <span className={`amc-agent-status amc-agent-status--${a.status}`}>{a.status}</span>
              </div>
            ))}
          </div>
        )}

        {section==="seo" && (
          <div className="amc-agent-list">
            {SEO_AGENTS.map(a=>(
              <div key={a.id} className={`amc-agent-row amc-agent-row--${a.status}`}>
                <StatusDot status={a.status} />
                <div className="amc-agent-info">
                  <span className="amc-agent-name">{a.name}</span>
                  <span className="amc-agent-model">{a.output}</span>
                </div>
                <div className="amc-agent-metrics">
                  <span className="amc-agent-metric"><span className="amc-agent-mv" style={{color:"var(--accent)"}}>{a.today}</span> today</span>
                  <span className="amc-agent-metric"><span className="amc-agent-mv">{a.total}</span> total</span>
                  <span className="amc-agent-metric"><span className="amc-agent-mv" style={{color:"var(--success)"}}>{a.rank}</span></span>
                </div>
                <span className="amc-agent-ts">{a.lastRun}</span>
                <span className={`amc-agent-status amc-agent-status--${a.status}`}>{a.status}</span>
              </div>
            ))}
          </div>
        )}

        {section==="social" && (
          <div className="amc-agent-list">
            {SOCIAL_AGENTS.map(a=>(
              <div key={a.id} className={`amc-agent-row amc-agent-row--${a.status}`}>
                <StatusDot status={a.status} />
                <div className="amc-agent-info">
                  <span className="amc-agent-name">{a.name}</span>
                  <span className="amc-agent-model">{a.total} posts total</span>
                </div>
                <div className="amc-agent-metrics">
                  <span className="amc-agent-metric"><span className="amc-agent-mv" style={{color:"#7c6fff"}}>{a.today}</span> today</span>
                  <span className="amc-agent-metric"><span className="amc-agent-mv">{a.reach}</span> reach</span>
                  <span className="amc-agent-metric"><span className="amc-agent-mv" style={{color:"var(--success)"}}>{a.engagement}</span> eng.</span>
                </div>
                <span className="amc-agent-ts">{a.lastRun}</span>
                <span className={`amc-agent-status amc-agent-status--${a.status}`}>{a.status}</span>
              </div>
            ))}
          </div>
        )}

        {section==="campaign" && (
          <div className="amc-agent-list">
            {CAMPAIGN_AGENTS.map(a=>(
              <div key={a.id} className={`amc-agent-row amc-agent-row--${a.status}`}>
                <StatusDot status={a.status} />
                <div className="amc-agent-info">
                  <span className="amc-agent-name">{a.name}</span>
                  <span className="amc-agent-model">{a.phase}</span>
                </div>
                <div className="amc-agent-metrics">
                  <span className="amc-agent-metric"><span className="amc-agent-mv" style={{color:"var(--accent2)"}}>{a.leads}</span> leads</span>
                  <span className="amc-agent-metric"><span className="amc-agent-mv">{a.clicks}</span> clicks</span>
                  <span className="amc-agent-metric"><span className="amc-agent-mv" style={{color:"var(--success)"}}>{a.roi}</span> ROI</span>
                </div>
                <span className="amc-agent-ts">{a.lastRun}</span>
                <span className={`amc-agent-status amc-agent-status--${a.status}`}>{a.status}</span>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}
