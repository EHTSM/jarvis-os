import React, { useState, useEffect } from "react";
import { track } from "../analytics";
import { listActions, getActionAuditTrail } from "../phase18Api";
import "./AgentActionCenter.css";

const KEY = "ooplix_agent_actions_v1";
function _load(k, fb) { try { return JSON.parse(localStorage.getItem(k) || JSON.stringify(fb)); } catch { return fb; } }
function _save(k, v) { localStorage.setItem(k, JSON.stringify(v)); }

const EXECUTED = [
  { id:"ae01", icon:"📧", name:"Send follow-up email",    agent:"Sales Agent",     ts:"2m ago",  result:"Delivered to lead@acme.com",         status:"executed" },
  { id:"ae02", icon:"🐙", name:"Create GitHub PR",        agent:"Dev Agent",       ts:"5m ago",  result:"PR #142 opened",                     status:"executed" },
  { id:"ae03", icon:"💬", name:"Post Slack update",       agent:"Ops Agent",       ts:"12m ago", result:"Posted to #ops-alerts",              status:"executed" },
  { id:"ae04", icon:"📝", name:"Write blog post draft",   agent:"Content Agent",   ts:"18m ago", result:"2,400 words saved to Notion",        status:"executed" },
  { id:"ae05", icon:"🔍", name:"Run SEO keyword scan",    agent:"SEO Agent",       ts:"24m ago", result:"42 keywords analyzed",               status:"executed" },
  { id:"ae06", icon:"🦙", name:"Run local inference",     agent:"Research Agent",  ts:"30m ago", result:"Competitor brief generated",         status:"executed" },
  { id:"ae07", icon:"📊", name:"Pull analytics report",   agent:"Analytics Agent", ts:"1h ago",  result:"Dashboard updated",                  status:"executed" },
];

const PENDING = [
  { id:"ap01", icon:"📁", name:"Upload report to Drive",  agent:"Analytics Agent", ts:"queued",  result:"Waiting for auth token refresh",     status:"pending" },
  { id:"ap02", icon:"🔀", name:"Route inference batch",   agent:"Dev Agent",       ts:"queued",  result:"Queued behind 3 prior calls",        status:"pending" },
  { id:"ap03", icon:"📧", name:"Send campaign blast",     agent:"Marketing Agent", ts:"queued",  result:"Waiting for human approval",         status:"pending" },
];

const FAILED = [
  { id:"af01", icon:"💬", name:"Post to #alerts channel", agent:"Ops Agent",       ts:"40m ago", result:"Rate limit 429 — retry in 12m",     status:"failed" },
  { id:"af02", icon:"🔀", name:"Call claude-opus-4-8",    agent:"Research Agent",  ts:"55m ago", result:"Timeout 30s — upstream overloaded",  status:"failed" },
  { id:"af03", icon:"📝", name:"Create Notion page",      agent:"Content Agent",   ts:"2h ago",  result:"401 Unauthorized — token expired",   status:"failed" },
];

const HUMAN_APPROVALS_SEED = [
  { id:"ah01", icon:"📧", title:"Send email blast to 4,200 contacts", agent:"Marketing Agent", risk:"high",   desc:"Mass email requires manual approval before send. Estimated 4,200 recipients.", approved: null },
  { id:"ah02", icon:"🗑️", title:"Delete 340 archived leads from CRM", agent:"Ops Agent",       risk:"high",   desc:"Bulk delete action — irreversible. 340 records flagged as stale > 180 days.", approved: null },
  { id:"ah03", icon:"🐙", title:"Merge PR #139 into main",            agent:"Dev Agent",       risk:"med",    desc:"PR merges auth refactor. CI passes. No breaking changes detected.", approved: null },
];

const AUTO_APPROVALS = [
  { icon:"📊", name:"Pull daily analytics",    agent:"Analytics Agent", approved:"Autonomous", ts:"1h ago"  },
  { icon:"🔍", name:"Run SEO rank check",      agent:"SEO Agent",       approved:"Autonomous", ts:"30m ago" },
  { icon:"💬", name:"Post standup to Slack",   agent:"Ops Agent",       approved:"Autonomous", ts:"9am"     },
  { icon:"🦙", name:"Generate research brief", agent:"Research Agent",  approved:"Autonomous", ts:"6am"     },
];

export default function AgentActionCenter({ onNavigate }) {
  const [tab, setTab] = useState("executed");
  const [approvals, setApprovals] = useState(() => _load(KEY, HUMAN_APPROVALS_SEED));
  const [liveExecuted, setLiveExecuted] = useState(EXECUTED);
  const [liveFailed,   setLiveFailed]   = useState(FAILED);
  const [livePending,  setLivePending]  = useState(PENDING);
  const [apiError,     setApiError]     = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      listActions({ status: "completed", limit: 20 }),
      listActions({ status: "failed",    limit: 10 }),
      listActions({ status: "pending",   limit: 10 }),
      getActionAuditTrail(20),
    ]).then(([doneRes, failRes, pendRes]) => {
      if (cancelled) return;
      const toRow = (a) => ({
        id: a.id, icon: "▷", name: a.input?.slice(0, 60) || "Action",
        agent: a.agentId || "Runtime", ts: a.createdAt ? new Date(a.createdAt).toLocaleTimeString() : "recently",
        result: a.result?.message || a.result?.reply || a.error || "—",
        status: a.status || "executed",
      });
      if (doneRes?.actions?.length) setLiveExecuted(doneRes.actions.map(toRow));
      if (failRes?.actions?.length) setLiveFailed(failRes.actions.map(toRow));
      if (pendRes?.actions?.length) setLivePending(pendRes.actions.map(toRow));
    }).catch(err => { if (!cancelled) setApiError(err.message); });
    return () => { cancelled = true; };
  }, []);

  function approve(id, val) {
    const next = approvals.map(a => a.id === id ? { ...a, approved: val } : a);
    setApprovals(next); _save(KEY, next);
    track("aac_approval", { id, val });
  }

  const pending    = approvals.filter(a => a.approved === null).length;
  const TABS = ["executed","pending","failed","human","autonomous"];

  return (
    <div className="aac">
      <div className="aac-header">
        <div>
          <h1 className="aac-title">Agent Action Center</h1>
          <p className="aac-subtitle">Actions executed, pending, failed, and approval queue.</p>
        </div>
        {pending > 0 && (
          <div style={{padding:"6px 14px",background:"rgba(255,186,0,0.12)",border:"1px solid rgba(255,186,0,0.3)",borderRadius:"var(--radius-pill)",fontSize:12,fontWeight:700,color:"var(--warning)"}}>
            {pending} awaiting approval
          </div>
        )}
      </div>

      {apiError && <div className="ac-api-banner ac-api-banner--error">⚠ Live data unavailable — showing cached data ({apiError})</div>}
      <div className="aac-stats">
        <div className="aac-stat"><span className="aac-stat-val" style={{color:"#00dc82"}}>{liveExecuted.length}</span><span className="aac-stat-lbl">Executed</span></div>
        <div className="aac-stat"><span className="aac-stat-val" style={{color:"var(--warning)"}}>{livePending.length}</span><span className="aac-stat-lbl">Pending</span></div>
        <div className="aac-stat"><span className="aac-stat-val" style={{color:"#ff6464"}}>{liveFailed.length}</span><span className="aac-stat-lbl">Failed</span></div>
        <div className="aac-stat"><span className="aac-stat-val" style={{color:"var(--accent)"}}>{pending}</span><span className="aac-stat-lbl">Need Approval</span></div>
        <div className="aac-stat"><span className="aac-stat-val" style={{color:"var(--accent2)"}}>{AUTO_APPROVALS.length}</span><span className="aac-stat-lbl">Auto-Approved</span></div>
      </div>

      <div className="aac-tabs">
        {TABS.map(t => (
          <button key={t} className={`aac-tab${tab===t?" active":""}`} onClick={() => setTab(t)} style={{textTransform:"capitalize"}}>{t}</button>
        ))}
      </div>

      {(tab === "executed" || tab === "pending" || tab === "failed") && (
        <div className="aac-action-list">
          {(tab==="executed"?liveExecuted:tab==="pending"?livePending:liveFailed).map(a => (
            <div key={a.id} className="aac-action-row">
              <span className="aac-action-icon">{a.icon}</span>
              <div className="aac-action-info">
                <div className="aac-action-name">{a.name}</div>
                <div className="aac-action-meta">{a.ts}</div>
              </div>
              <span className="aac-action-agent">{a.agent}</span>
              <span className="aac-action-result">{a.result}</span>
              <span className={`aac-action-status aac-status-${a.status}`}>{a.status}</span>
            </div>
          ))}
        </div>
      )}

      {tab === "human" && (
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          {approvals.map(a => (
            <div key={a.id} className="aac-approval-card">
              <div className="aac-approval-head">
                <span className="aac-approval-icon">{a.icon}</span>
                <span className="aac-approval-title">{a.title}</span>
                <span className={`aac-approval-risk aac-risk-${a.risk}`}>{a.risk} risk</span>
              </div>
              <div className="aac-approval-desc">
                <strong style={{color:"var(--accent)"}}>Agent: {a.agent}</strong> — {a.desc}
              </div>
              {a.approved === null ? (
                <div className="aac-approval-footer">
                  <button className="aac-approve-btn aac-approve-btn-no"  onClick={() => approve(a.id, false)}>Deny</button>
                  <button className="aac-approve-btn aac-approve-btn-yes" onClick={() => approve(a.id, true)}>Approve</button>
                </div>
              ) : (
                <div style={{textAlign:"right",fontSize:12,fontWeight:700,color:a.approved?"#00dc82":"#ff6464"}}>
                  {a.approved ? "✓ Approved" : "✗ Denied"}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === "autonomous" && (
        <div className="aac-action-list">
          {AUTO_APPROVALS.map((a,i) => (
            <div key={i} className="aac-action-row">
              <span className="aac-action-icon">{a.icon}</span>
              <div className="aac-action-info">
                <div className="aac-action-name">{a.name}</div>
                <div className="aac-action-meta">{a.ts}</div>
              </div>
              <span className="aac-action-agent">{a.agent}</span>
              <span className="aac-action-result">Auto-approved by Jarvis</span>
              <span className="aac-action-status aac-status-approved">autonomous</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
