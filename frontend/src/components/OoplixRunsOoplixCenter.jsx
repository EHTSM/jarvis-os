import React, { useState, useEffect } from "react";
import { track } from "../analytics";
import { getAutonomyStatus, getAutonomyScore, getAutonomyHistory } from "../phase20Api";
import "./OoplixRunsOoplixCenter.css";

const DOMAINS = [
  {
    id:"revenue",     label:"Revenue",     icon:"$",  color:"#52d68a",
    score:88,
    goal:"Close ₹10L MRR autonomously",
    agents:["Lead Prospector","Follow-Up Sequencer","Proposal Generator","Contract Closer"],
    tools:["WhatsApp API","CRM write","PDF gen","Razorpay webhook"],
    memory:["Lead history","Conversation context","Deal stage","Follow-up timing"],
    recentActions:[
      {ts:"2m ago",  action:"Sent follow-up #3 to Arjun (lead_id:0381)"},
      {ts:"14m ago", action:"Generated proposal for Priya Sharma — ₹48K/yr"},
      {ts:"1h ago",  action:"Qualified 7 inbound leads from website form"},
      {ts:"3h ago",  action:"Closed deal with Dev Kumar — ₹36K"},
    ],
    result:"₹8.8L MTD · 11 deals closed · 312 leads in pipeline",
  },
  {
    id:"marketing",   label:"Marketing",   icon:"★",  color:"#7c6fff",
    score:74,
    goal:"Generate 2,500 organic visits/mo with zero ad spend",
    agents:["Blog Writer","SEO Optimizer","Social Poster","Campaign Executor"],
    tools:["Content API","Search Console","LinkedIn API","Twitter API"],
    memory:["Published URLs","Keyword rankings","Engagement history","Audience segments"],
    recentActions:[
      {ts:"8m ago",  action:"Published blog: '7 WhatsApp follow-up mistakes'"},
      {ts:"20m ago", action:"Posted on LinkedIn: Phase 14 product update"},
      {ts:"1h ago",  action:"SERP tracker: +3 positions for 'WhatsApp CRM India'"},
      {ts:"3h ago",  action:"Repurposed blog into 4 short-form posts"},
    ],
    result:"2,340 visits/mo · 47 ranking gains · 142 articles published",
  },
  {
    id:"support",     label:"Support",     icon:"?",  color:"#f0b429",
    score:92,
    goal:"Resolve 90% of tickets autonomously, CSAT > 4.5",
    agents:["KB Search Agent","WA Debug Agent","Pipeline Debugger","Escalation Router"],
    tools:["KB read/write","Ticket system","WhatsApp API","Log reader"],
    memory:["Past resolutions","Error patterns","User history","KB article index"],
    recentActions:[
      {ts:"2h ago",  action:"Resolved: WhatsApp session reconnect (4m, auto)"},
      {ts:"3h ago",  action:"Created KB article on CSV import errors (auto)"},
      {ts:"4h ago",  action:"Deflected billing query → KB self-serve"},
      {ts:"5h ago",  action:"Escalated payment receipt issue to human"},
    ],
    result:"84% auto-resolved · 4.8/5 CSAT · 4 KB articles auto-created",
  },
  {
    id:"operations",  label:"Operations",  icon:"⚙",  color:"#4ecdc4",
    score:81,
    goal:"Zero-downtime platform with self-healing and auto-recovery",
    agents:["Health Monitor","Self-Healing Agent","Alert Router","Recovery Orchestrator"],
    tools:["Metrics API","Process manager","Slack alerts","DB health check"],
    memory:["Incident log","Recovery playbooks","Alert thresholds","Uptime history"],
    recentActions:[
      {ts:"30m ago", action:"Restarted WhatsApp adapter (memory leak detected)"},
      {ts:"2h ago",  action:"Cleared stale cron job locks (4 locks removed)"},
      {ts:"6h ago",  action:"Auto-scaled queue workers from 2→4 (load spike)"},
      {ts:"12h ago", action:"Sent 3am health report to Slack (all green)"},
    ],
    result:"99.8% uptime · 12 incidents self-healed · 0 human pages",
  },
  {
    id:"engineering", label:"Engineering", icon:"< >", color:"#da552f",
    score:67,
    goal:"Ship phase milestones autonomously with < 2% regression rate",
    agents:["Dev Copilot","Test Runner","Deploy Agent","Code Reviewer"],
    tools:["GitHub API","CI/CD","Terminal exec","Semantic search"],
    memory:["Codebase index","Test history","Deploy log","Architecture decisions"],
    recentActions:[
      {ts:"1h ago",  action:"Generated 4 new center components (Phase 15)"},
      {ts:"3h ago",  action:"Ran 40/40 regression tests — all pass"},
      {ts:"5h ago",  action:"Deployed frontend build to production"},
      {ts:"8h ago",  action:"Resolved build error: missing CSS import"},
    ],
    result:"14 phases shipped · 40/40 regression · 0 critical bugs",
  },
];

const FLOW_STEPS = ["Goal","Agent","Tool","Memory","Action","Result"];

function ScoreGauge({ value, color, label }) {
  const r = 28, circ = 2*Math.PI*r;
  const fill = circ * (value/100);
  return (
    <div className="oro-gauge-wrap">
      <svg className="oro-gauge-svg" viewBox="0 0 70 70">
        <circle cx="35" cy="35" r={r} fill="none" stroke="rgba(255,255,255,.07)" strokeWidth="6"/>
        <circle cx="35" cy="35" r={r} fill="none" stroke={color} strokeWidth="6"
          strokeDasharray={`${fill} ${circ}`} strokeLinecap="round"
          transform="rotate(-90 35 35)" />
      </svg>
      <div className="oro-gauge-inner">
        <span className="oro-gauge-val" style={{color}}>{value}</span>
        <span className="oro-gauge-unit">%</span>
      </div>
      <span className="oro-gauge-label">{label}</span>
    </div>
  );
}

export default function OoplixRunsOoplixCenter({ onNavigate }) {
  const [section,      setSection]      = useState("overview");
  const [activeDomain, setActiveDomain] = useState("revenue");
  const [liveStatus,   setLiveStatus]   = useState(null);
  const [apiError,     setApiError]     = useState(null);

  React.useEffect(() => { track.event("ooplix_runs_ooplix_viewed"); }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getAutonomyStatus(), getAutonomyScore()])
      .then(([statusRes, scoreRes]) => {
        if (cancelled) return;
        if (statusRes || scoreRes) setLiveStatus({ ...statusRes, ...scoreRes });
      })
      .catch(err => { if (!cancelled) setApiError(err.message); });
    return () => { cancelled = true; };
  }, []);

  const liveOverallScore = liveStatus?.overallScore ?? liveStatus?.score;
  const automationScore    = liveOverallScore ?? Math.round(DOMAINS.reduce((a,d)=>a+d.score,0)/DOMAINS.length);
  const humanDependency    = 100 - automationScore;
  const autonomousExecScore= Math.round((DOMAINS.filter(d=>d.score>=80).length/DOMAINS.length)*100);

  const domain = DOMAINS.find(d=>d.id===activeDomain) || DOMAINS[0];

  const SECTIONS = [
    {id:"overview",   label:"Overview"},
    {id:"flow",       label:"Goal → Result Flow"},
    {id:"domains",    label:"Domain Automation"},
    {id:"scores",     label:"Autonomy Scores"},
  ];

  return (
    <div className="ooplix-runs-ooplix-center page-enter">
      {apiError && <div className="ac-api-banner ac-api-banner--error">⚠ Live autonomy data unavailable — showing seed data ({apiError})</div>}
      <div className="oro-header">
        <div>
          <h1 className="oro-title">Ooplix Runs Ooplix</h1>
          <p className="oro-subtitle">Revenue · Marketing · Support · Operations · Engineering — all autonomous. Humans optional.</p>
        </div>
        <div className="oro-live-badge">AUTONOMOUS</div>
      </div>

      <div className="oro-summary-strip">
        {[
          { label:"Automation score",      value:`${automationScore}%`,       color:"var(--success)" },
          { label:"Human dependency",      value:`${humanDependency}%`,       color:"var(--warning)" },
          { label:"Autonomous exec score", value:`${autonomousExecScore}%`,   color:"var(--accent2)" },
          { label:"Domains automated",     value:`${DOMAINS.filter(d=>d.score>=80).length}/${DOMAINS.length}`, color:"var(--accent)" },
          { label:"Agents running 24/7",   value:"31",                        color:"#52d68a"        },
          { label:"Human interventions/d", value:"2",                         color:"var(--text-faint)" },
        ].map(s=>(
          <div key={s.label} className="oro-summary-tile">
            <span className="oro-sv" style={{color:s.color}}>{s.value}</span>
            <span className="oro-sl">{s.label}</span>
          </div>
        ))}
      </div>

      <div className="oro-tabs">
        {SECTIONS.map(t=>(
          <button key={t.id} className={`oro-tab${section===t.id?" oro-tab--active":""}`} onClick={()=>setSection(t.id)}>{t.label}</button>
        ))}
      </div>

      <div className="oro-content" key={section}>

        {section==="overview" && (
          <div className="oro-overview">
            <div className="oro-score-row">
              <ScoreGauge value={automationScore}      color="var(--success)" label="Automation" />
              <ScoreGauge value={100-humanDependency}  color="var(--accent2)" label="Autonomous Exec" />
              <ScoreGauge value={autonomousExecScore}  color="#52d68a"        label="Domain Coverage" />
            </div>

            <div className="oro-domain-cards">
              {DOMAINS.map(d=>(
                <div key={d.id} className="oro-domain-card" onClick={()=>{setActiveDomain(d.id);setSection("flow");}}>
                  <div className="oro-domain-icon" style={{background:d.color+"22",color:d.color}}>{d.icon}</div>
                  <div className="oro-domain-info">
                    <span className="oro-domain-name">{d.label}</span>
                    <span className="oro-domain-goal">{d.goal}</span>
                  </div>
                  <div className="oro-domain-score-bar-wrap">
                    <div className="oro-domain-score-track">
                      <div className="oro-domain-score-fill" style={{width:`${d.score}%`,background:d.color}} />
                    </div>
                    <span className="oro-domain-score-val" style={{color:d.color}}>{d.score}%</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="oro-recent-all">
              <p className="oro-ov-label">Recent autonomous actions (all domains)</p>
              {DOMAINS.flatMap(d=>d.recentActions.slice(0,1).map(a=>({...a,domain:d.label,color:d.color}))).map((a,i)=>(
                <div key={i} className="oro-recent-row">
                  <span className="oro-recent-domain" style={{color:a.color}}>{a.domain}</span>
                  <span className="oro-recent-action">{a.action}</span>
                  <span className="oro-recent-ts">{a.ts}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {section==="flow" && (
          <div className="oro-flow-section">
            <div className="oro-flow-domain-selector">
              {DOMAINS.map(d=>(
                <button key={d.id}
                  className={`oro-flow-domain-btn${activeDomain===d.id?" oro-flow-domain-btn--active":""}`}
                  style={activeDomain===d.id?{borderColor:d.color,color:d.color}:{}}
                  onClick={()=>setActiveDomain(d.id)}>
                  <span className="oro-flow-domain-icon" style={{background:d.color+"22",color:d.color}}>{d.icon}</span>
                  {d.label}
                </button>
              ))}
            </div>

            <div className="oro-flow-diagram">
              {FLOW_STEPS.map((step,i)=>{
                const content = {
                  Goal:   <div className="oro-flow-content"><p className="oro-flow-main">{domain.goal}</p></div>,
                  Agent:  <div className="oro-flow-content">{domain.agents.map(a=><span key={a} className="oro-flow-tag" style={{borderColor:domain.color+"44",color:domain.color}}>{a}</span>)}</div>,
                  Tool:   <div className="oro-flow-content">{domain.tools.map(t=><span key={t} className="oro-flow-tag oro-flow-tag--tool">{t}</span>)}</div>,
                  Memory: <div className="oro-flow-content">{domain.memory.map(m=><span key={m} className="oro-flow-tag oro-flow-tag--mem">{m}</span>)}</div>,
                  Action: <div className="oro-flow-content oro-flow-content--actions">{domain.recentActions.map((a,j)=>(
                    <div key={j} className="oro-flow-action-row">
                      <span className="oro-flow-action-ts">{a.ts}</span>
                      <span className="oro-flow-action-text">{a.action}</span>
                    </div>
                  ))}</div>,
                  Result: <div className="oro-flow-content"><p className="oro-flow-main oro-flow-result" style={{color:domain.color}}>{domain.result}</p></div>,
                }[step];

                return (
                  <React.Fragment key={step}>
                    <div className="oro-flow-step">
                      <div className="oro-flow-step-label">
                        <div className="oro-flow-step-num" style={{background:domain.color+"22",color:domain.color}}>{i+1}</div>
                        <span className="oro-flow-step-name">{step}</span>
                      </div>
                      <div className="oro-flow-step-body">{content}</div>
                    </div>
                    {i < FLOW_STEPS.length-1 && (
                      <div className="oro-flow-connector" style={{borderColor:domain.color+"33"}} />
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        )}

        {section==="domains" && (
          <div className="oro-domains-detail">
            {DOMAINS.map(d=>(
              <div key={d.id} className="oro-domain-detail-card">
                <div className="oro-ddc-header">
                  <div className="oro-ddc-icon" style={{background:d.color+"22",color:d.color}}>{d.icon}</div>
                  <div className="oro-ddc-title-wrap">
                    <span className="oro-ddc-title">{d.label} Automation</span>
                    <span className="oro-ddc-goal">{d.goal}</span>
                  </div>
                  <div className="oro-ddc-score-block">
                    <div className="oro-ddc-score-track">
                      <div className="oro-ddc-score-fill" style={{width:`${d.score}%`,background:d.color}} />
                    </div>
                    <span className="oro-ddc-score-val" style={{color:d.color}}>{d.score}%</span>
                  </div>
                </div>
                <div className="oro-ddc-cols">
                  <div className="oro-ddc-col">
                    <p className="oro-ddc-col-label">Agents</p>
                    {d.agents.map(a=><div key={a} className="oro-ddc-item" style={{borderLeftColor:d.color}}>{a}</div>)}
                  </div>
                  <div className="oro-ddc-col">
                    <p className="oro-ddc-col-label">Recent actions</p>
                    {d.recentActions.map((a,i)=>(
                      <div key={i} className="oro-ddc-action">
                        <span className="oro-ddc-action-ts">{a.ts}</span>
                        <span className="oro-ddc-action-text">{a.action}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="oro-ddc-result">
                  <span className="oro-ddc-result-label">Result: </span>
                  <span className="oro-ddc-result-val" style={{color:d.color}}>{d.result}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {section==="scores" && (
          <div className="oro-scores-section">
            <div className="oro-scores-top">
              <div className="oro-score-big-card">
                <span className="oro-score-big-val" style={{color:"var(--success)"}}>{automationScore}%</span>
                <span className="oro-score-big-label">Automation Score</span>
                <p className="oro-score-big-desc">Percentage of tasks across all domains executed without human involvement in the last 30 days.</p>
              </div>
              <div className="oro-score-big-card">
                <span className="oro-score-big-val" style={{color:"var(--warning)"}}>{humanDependency}%</span>
                <span className="oro-score-big-label">Human Dependency Score</span>
                <p className="oro-score-big-desc">Percentage of tasks that still require a human decision, review, or override. Target: below 10%.</p>
              </div>
              <div className="oro-score-big-card">
                <span className="oro-score-big-val" style={{color:"var(--accent2)"}}>{autonomousExecScore}%</span>
                <span className="oro-score-big-label">Autonomous Exec Score</span>
                <p className="oro-score-big-desc">Domains scoring 80%+ automation as a fraction of total domains. Currently {DOMAINS.filter(d=>d.score>=80).length}/{DOMAINS.length} domains.</p>
              </div>
            </div>

            <div className="oro-domain-scores">
              <p className="oro-ov-label">Domain breakdown</p>
              {DOMAINS.map(d=>(
                <div key={d.id} className="oro-domain-score-row">
                  <div className="oro-domain-score-icon" style={{background:d.color+"22",color:d.color}}>{d.icon}</div>
                  <span className="oro-domain-score-name">{d.label}</span>
                  <div className="oro-domain-score-bar-wrap">
                    <div className="oro-domain-score-track-full">
                      <div className="oro-domain-score-fill-full" style={{width:`${d.score}%`,background:d.color}} />
                    </div>
                  </div>
                  <span className="oro-domain-score-pct" style={{color:d.color}}>{d.score}%</span>
                  <span className={`oro-domain-score-badge ${d.score>=80?"oro-domain-score-badge--high":"oro-domain-score-badge--mid"}`}>
                    {d.score>=80?"High":"Growing"}
                  </span>
                </div>
              ))}
            </div>

            <div className="oro-roadmap-note">
              <span className="oro-roadmap-icon">→</span>
              <span>Target: 95% automation score across all domains by Q3 2026. Engineering (67%) is the primary gap — AI pair-programming and autonomous test writing in progress.</span>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
