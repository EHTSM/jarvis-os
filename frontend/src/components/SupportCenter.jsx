import React, { useState, useCallback } from "react";
import { track } from "../analytics";
import { _fetch } from "../_client";
import "./SupportCenter.css";

const TKT_KEY = "ooplix_support_tickets";
function _load(k,fb){try{return JSON.parse(localStorage.getItem(k)||JSON.stringify(fb));}catch{return fb;}}
function _save(k,v){localStorage.setItem(k,JSON.stringify(v));}

// ── Seed tickets ──────────────────────────────────────────────────────
const SEED_TICKETS = [
  { id:"t001", subject:"WhatsApp QR code not scanning on iPhone",           category:"setup",    priority:"high",   status:"open",      assignee:"Support Agent", createdAt:"14:08", slaHours:4, waitHours:0.2, userId:"u_1019", tags:["whatsapp","ios"],    reply:null },
  { id:"t002", subject:"Payment link not received after generating",        category:"billing",  priority:"critical",status:"open",     assignee:"Support Agent", createdAt:"13:55", slaHours:2, waitHours:0.3, userId:"u_1022", tags:["payments","razorpay"],reply:null },
  { id:"t003", subject:"Follow-up sequence stopped sending after day 3",    category:"automation",priority:"high",  status:"in_progress",assignee:"Support Agent",createdAt:"12:30", slaHours:4, waitHours:1.5, userId:"u_0981", tags:["automation","whatsapp"],reply:"Investigating — checking sequence config. Will update within 30 min." },
  { id:"t004", subject:"How do I add multiple team members?",               category:"how-to",   priority:"medium", status:"resolved",  assignee:"Support Agent", createdAt:"11:00", slaHours:8, waitHours:0.4, userId:"u_0975", tags:["team","onboarding"],   reply:"Team members can be added from Settings → Team → Invite member. See KB article: /docs/team." },
  { id:"t005", subject:"CSV import for contacts not working",               category:"bug",      priority:"high",   status:"escalated", assignee:"Dev Agent",     createdAt:"10:45", slaHours:4, waitHours:3.2, userId:"u_0960", tags:["import","bug"],        reply:"Escalated to Dev Agent. Bug confirmed — fix in progress. ETA 24h." },
  { id:"t006", subject:"Can I use Ooplix for B2B leads on LinkedIn?",       category:"how-to",   priority:"low",    status:"resolved",  assignee:"Support Agent", createdAt:"09:30", slaHours:24,waitHours:0.3, userId:"u_0944", tags:["linkedin","usecase"],  reply:"Yes — add LinkedIn leads manually or via CSV. WhatsApp automation works for any contact with a valid number." },
  { id:"t007", subject:"Trial expired but I haven't used product fully",    category:"billing",  priority:"medium", status:"open",      assignee:"Sales Agent",   createdAt:"09:10", slaHours:8, waitHours:5.0, userId:"u_0938", tags:["trial","billing"],     reply:null },
  { id:"t008", subject:"App crashes on Android 12 (cold start)",           category:"bug",      priority:"critical",status:"escalated",assignee:"Dev Agent",     createdAt:"08:40", slaHours:2, waitHours:5.3, userId:"u_0912", tags:["android","crash","bug"],reply:"Escalated to Dev Agent. PR #3 in review — fix ships today." },
];

// ── KB articles ───────────────────────────────────────────────────────
const KB_ARTICLES = [
  { id:"kb1", title:"How to connect WhatsApp (QR scan guide)",            views:342, helpful:94, category:"Setup",       updated:"2026-06-01" },
  { id:"kb2", title:"Setting up follow-up sequences",                     views:289, helpful:91, category:"Automation",  updated:"2026-05-28" },
  { id:"kb3", title:"Generating and sending Razorpay payment links",      views:201, helpful:88, category:"Payments",    updated:"2026-05-20" },
  { id:"kb4", title:"Importing contacts via CSV",                         views:178, helpful:72, category:"Contacts",    updated:"2026-05-15" },
  { id:"kb5", title:"Managing team members and roles",                    views:134, helpful:96, category:"Team",        updated:"2026-06-02" },
  { id:"kb6", title:"Trial extension requests",                           views:98,  helpful:85, category:"Billing",     updated:"2026-05-10" },
  { id:"kb7", title:"WhatsApp session refresh (QR re-scan)",              views:87,  helpful:90, category:"Setup",       updated:"2026-06-03" },
  { id:"kb8", title:"Ooplix on Android — known issues and workarounds",   views:65,  helpful:78, category:"Mobile",      updated:"2026-06-04" },
];

// ── SLA config ────────────────────────────────────────────────────────
const SLA_CONFIG = { critical: 2, high: 4, medium: 8, low: 24 };

const PRI_COLORS = { critical:"var(--danger)", high:"var(--warning)", medium:"var(--accent2)", low:"var(--text-faint)" };
const STA_COLORS = { open:"var(--accent2)", in_progress:"var(--warning)", resolved:"var(--success)", escalated:"var(--danger)" };

function slaStatus(t) {
  const sla = SLA_CONFIG[t.priority] || 8;
  const pct = (t.waitHours / sla) * 100;
  if (t.status === "resolved") return { color:"var(--success)", label:"Met", pct:100 };
  if (pct >= 100) return { color:"var(--danger)",  label:"Breached", pct:100 };
  if (pct >= 75)  return { color:"var(--warning)", label:"At risk",  pct };
  return            { color:"var(--success)", label:"On track", pct };
}

function TicketRow({ ticket, selected, onSelect }) {
  const sla = slaStatus(ticket);
  return (
    <button className={`sc-ticket-row${selected?" sc-ticket-row--sel":""}`} onClick={()=>onSelect(ticket.id)}>
      <div className="sc-tkt-left">
        <span className="sc-tkt-pri-dot" style={{background:PRI_COLORS[ticket.priority]}} />
        <div className="sc-tkt-info">
          <span className="sc-tkt-subject">{ticket.subject}</span>
          <span className="sc-tkt-meta">{ticket.category} · {ticket.createdAt} · {ticket.assignee}</span>
        </div>
      </div>
      <div className="sc-tkt-right">
        <span className="sc-tkt-status" style={{color:STA_COLORS[ticket.status],borderColor:STA_COLORS[ticket.status]+"33"}}>{ticket.status.replace("_"," ")}</span>
        <span className="sc-tkt-sla" style={{color:sla.color}}>{sla.label}</span>
      </div>
    </button>
  );
}

function TicketDetail({ ticket, onReply, onResolve, onEscalate }) {
  const [replyText,    setReplyText]    = useState(ticket.reply||"");
  const [aiGenerating, setAiGenerating] = useState(false);
  const sla = slaStatus(ticket);

  async function handleAIReply() {
    setAiGenerating(true);
    try {
      const r = await _fetch("/ai/chat", {
        method: "POST",
        body: JSON.stringify({
          input: `You are a helpful customer support agent for Ooplix, an AI business automation platform. Draft a professional, empathetic reply to this support ticket:\n\nSubject: ${ticket.subject}\nPriority: ${ticket.priority}\nCategory: ${ticket.category}\n\nExisting reply (if any): ${ticket.reply || "None"}\n\nProvide a concise, helpful response in 2-3 sentences.`,
          mode: "support",
        }),
      });
      const text = r?.reply || r?.message || r?.result;
      if (text) setReplyText(text);
    } catch {
      // silently fall back — textarea stays blank for manual entry
    } finally {
      setAiGenerating(false);
    }
  }

  return (
    <div className="sc-ticket-detail">
      <div className="sc-td-header">
        <span className="sc-td-id">#{ticket.id}</span>
        <span className="sc-td-cat">{ticket.category}</span>
        <span className="sc-td-pri" style={{color:PRI_COLORS[ticket.priority],borderColor:PRI_COLORS[ticket.priority]+"33"}}>{ticket.priority}</span>
        <span className="sc-td-status" style={{color:STA_COLORS[ticket.status],borderColor:STA_COLORS[ticket.status]+"33"}}>{ticket.status.replace("_"," ")}</span>
      </div>
      <h3 className="sc-td-subject">{ticket.subject}</h3>
      <div className="sc-td-meta-grid">
        <span className="sc-tdml">Assignee</span><span className="sc-tdmv">{ticket.assignee}</span>
        <span className="sc-tdml">Created</span><span className="sc-tdmv">{ticket.createdAt}</span>
        <span className="sc-tdml">SLA</span><span className="sc-tdmv">{SLA_CONFIG[ticket.priority]}h</span>
        <span className="sc-tdml">Wait time</span><span className="sc-tdmv">{ticket.waitHours}h</span>
        <span className="sc-tdml">Tags</span>
        <div className="sc-tdmv sc-td-tags">{ticket.tags.map(t=><span key={t} className="sc-tag">{t}</span>)}</div>
      </div>
      <div className="sc-sla-bar-row">
        <span className="sc-sla-label" style={{color:sla.color}}>SLA: {sla.label}</span>
        <div className="sc-sla-bar-track">
          <div className="sc-sla-bar-fill" style={{width:`${sla.pct}%`,background:sla.color}} />
        </div>
        <span className="sc-sla-pct" style={{color:sla.color}}>{Math.round(sla.pct)}%</span>
      </div>
      {ticket.reply && (
        <div className="sc-td-existing-reply">
          <span className="sc-td-reply-label">Agent reply</span>
          <p className="sc-td-reply-text">{ticket.reply}</p>
        </div>
      )}
      {ticket.status !== "resolved" && (
        <div className="sc-td-reply-section">
          <div className="sc-td-reply-header">
            <label className="sc-td-reply-form-label">Reply</label>
            <button className="sc-td-ai-btn" onClick={handleAIReply} disabled={aiGenerating}>
              {aiGenerating ? "⟳ Generating…" : "◎ AI Draft"}
            </button>
          </div>
          <textarea className="sc-td-reply-input" value={replyText} onChange={e=>setReplyText(e.target.value)} rows={3} placeholder="Type response or use AI Draft…" />
          <div className="sc-td-actions">
            {ticket.status !== "escalated" && (
              <button className="sc-td-act sc-td-act--escalate" onClick={()=>onEscalate(ticket.id)}>Escalate</button>
            )}
            <button className="sc-td-act sc-td-act--resolve" onClick={()=>onResolve(ticket.id, replyText)}>Resolve</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SupportCenter({ onNavigate }) {
  const [tickets,  setTickets]  = useState(() => _load(TKT_KEY, SEED_TICKETS));
  const [section,  setSection]  = useState("tickets");
  const [selected, setSelected] = useState("t001");
  const [priFilter,setPriFilter] = useState("all");
  const [staFilter,setStaFilter] = useState("all");
  const [toast,    setToast]    = useState(null);

  React.useEffect(() => { track.event("support_center_viewed"); }, []);
  const showToast = m => { setToast(m); setTimeout(()=>setToast(null),2400); };
  const persist = next => { _save(TKT_KEY,next); setTickets(next); };

  const handleResolve = useCallback((id, reply) => {
    persist(tickets.map(t => t.id===id ? {...t, status:"resolved", reply: reply||t.reply} : t));
    showToast("Ticket resolved"); track.event("ticket_resolved");
  }, [tickets]);

  const handleEscalate = useCallback(id => {
    const t = tickets.find(x=>x.id===id);
    const newAssignee = t?.category==="bug" ? "Dev Agent" : t?.category==="billing" ? "Sales Agent" : "Human";
    persist(tickets.map(t => t.id===id ? {...t, status:"escalated", assignee:newAssignee} : t));
    showToast(`Escalated to ${newAssignee}`); track.event("ticket_escalated");
  }, [tickets]);

  const visible = tickets.filter(t =>
    (priFilter==="all"||t.priority===priFilter) &&
    (staFilter==="all"||t.status===staFilter)
  );
  const selTicket = selected ? tickets.find(t=>t.id===selected) : null;

  const openCount      = tickets.filter(t=>t.status==="open").length;
  const inProgCount    = tickets.filter(t=>t.status==="in_progress").length;
  const escalatedCount = tickets.filter(t=>t.status==="escalated").length;
  const resolvedCount  = tickets.filter(t=>t.status==="resolved").length;
  const breachedSLA    = tickets.filter(t=>slaStatus(t).label==="Breached").length;
  const avgWait        = (tickets.reduce((s,t)=>s+t.waitHours,0)/tickets.length).toFixed(1);

  return (
    <div className="support-center page-enter">
      {toast && <div className="sc-toast">{toast}</div>}
      <div className="coming-soon-banner">
        <span className="csb-icon">◎</span>
        <div className="csb-body">
          <span className="csb-title">Support Ticket Engine <span className="csb-beta-badge">BETA</span></span>
          <span className="csb-sub">Tickets are stored locally with full SLA tracking and AI-assisted replies via the connected AI provider. Cloud sync and multi-agent routing coming in a future release.</span>
        </div>
      </div>

      <div className="sc-header">
        <div>
          <h1 className="sc-title">Support Center</h1>
          <p className="sc-subtitle">Tickets, knowledge base, SLA tracking, escalations, and resolution analytics.</p>
        </div>
      </div>

      <div className="sc-summary-strip">
        {[
          {label:"Open",     value:openCount,      color:"var(--accent2)"                              },
          {label:"In progress",value:inProgCount,  color:"var(--warning)"                              },
          {label:"Escalated",value:escalatedCount, color:escalatedCount>0?"var(--danger)":"var(--success)"},
          {label:"Resolved", value:resolvedCount,  color:"var(--success)"                              },
          {label:"SLA breached",value:breachedSLA, color:breachedSLA>0?"var(--danger)":"var(--success)"},
          {label:"Avg wait", value:`${avgWait}h`,  color:"var(--text-faint)"                           },
        ].map(s=>(
          <div key={s.label} className="sc-summary-tile">
            <span className="sc-sv" style={{color:s.color}}>{s.value}</span>
            <span className="sc-sl">{s.label}</span>
          </div>
        ))}
      </div>

      <div className="sc-tabs">
        {[
          {id:"tickets",   label:`Tickets (${tickets.length})`},
          {id:"kb",        label:"Knowledge Base"},
          {id:"sla",       label:"SLA Tracking"},
          {id:"analytics", label:"Analytics"},
        ].map(t=>(
          <button key={t.id} className={`sc-tab${section===t.id?" sc-tab--active":""}`} onClick={()=>setSection(t.id)}>{t.label}</button>
        ))}
      </div>

      <div className="sc-content" key={section}>

        {section==="tickets" && (
          <>
            <div className="sc-filters">
              <div className="sc-filter-row">
                {["all","critical","high","medium","low"].map(p=>(
                  <button key={p} className={`sc-chip${priFilter===p?" sc-chip--active":""}`}
                    style={priFilter===p&&p!=="all"?{color:PRI_COLORS[p],borderColor:PRI_COLORS[p]+"44"}:{}}
                    onClick={()=>setPriFilter(p)}>{p}</button>
                ))}
              </div>
              <div className="sc-filter-row">
                {["all","open","in_progress","resolved","escalated"].map(s=>(
                  <button key={s} className={`sc-chip${staFilter===s?" sc-chip--active":""}`}
                    onClick={()=>setStaFilter(s)}>{s.replace("_"," ")}</button>
                ))}
              </div>
            </div>
            <div className="sc-tickets-layout">
              <div className="sc-ticket-list">
                {visible.map(t=>(
                  <TicketRow key={t.id} ticket={t} selected={selected===t.id} onSelect={setSelected} />
                ))}
              </div>
              {selTicket && (
                <TicketDetail ticket={selTicket} onResolve={handleResolve} onEscalate={handleEscalate} onReply={()=>{}} />
              )}
            </div>
          </>
        )}

        {section==="kb" && (
          <div className="sc-kb-list">
            {KB_ARTICLES.map(a=>(
              <div key={a.id} className="sc-kb-row">
                <div className="sc-kb-info">
                  <span className="sc-kb-title">{a.title}</span>
                  <span className="sc-kb-meta">{a.category} · Updated {a.updated}</span>
                </div>
                <div className="sc-kb-stats">
                  <span className="sc-kb-stat"><span className="sc-kb-sv">{a.views}</span> views</span>
                  <span className="sc-kb-stat"><span className="sc-kb-sv" style={{color:a.helpful>=90?"var(--success)":"var(--accent2)"}}>{a.helpful}%</span> helpful</span>
                </div>
                <span className="sc-kb-cat">{a.category}</span>
              </div>
            ))}
          </div>
        )}

        {section==="sla" && (
          <div className="sc-sla-section">
            <div className="sc-sla-config">
              <p className="sc-sla-config-label">SLA targets by priority</p>
              <div className="sc-sla-tiers">
                {Object.entries(SLA_CONFIG).map(([pri,hrs])=>(
                  <div key={pri} className="sc-sla-tier">
                    <span className="sc-sla-tier-pri" style={{color:PRI_COLORS[pri]}}>{pri}</span>
                    <span className="sc-sla-tier-hrs">{hrs}h first response</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="sc-sla-ticket-list">
              {tickets.filter(t=>t.status!=="resolved").map(t=>{
                const sla = slaStatus(t);
                return (
                  <div key={t.id} className="sc-sla-row">
                    <span className="sc-sla-row-pri-dot" style={{background:PRI_COLORS[t.priority]}} />
                    <span className="sc-sla-row-subject">{t.subject.slice(0,50)}{t.subject.length>50?"…":""}</span>
                    <div className="sc-sla-row-bar-wrap">
                      <div className="sc-sla-bar-track">
                        <div className="sc-sla-bar-fill" style={{width:`${sla.pct}%`,background:sla.color}} />
                      </div>
                      <span className="sc-sla-row-pct" style={{color:sla.color}}>{Math.round(sla.pct)}%</span>
                    </div>
                    <span className="sc-sla-row-status" style={{color:sla.color}}>{sla.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {section==="analytics" && (
          <div className="sc-analytics-section">
            <div className="sc-analytics-cards">
              {[
                {label:"Resolution rate",  value:`${Math.round((resolvedCount/tickets.length)*100)}%`, color:"var(--success)", detail:`${resolvedCount} of ${tickets.length} tickets resolved`},
                {label:"Escalation rate",  value:`${Math.round((escalatedCount/tickets.length)*100)}%`,color:escalatedCount>0?"var(--danger)":"var(--success)",detail:`${escalatedCount} escalated to Dev/Sales`},
                {label:"SLA compliance",   value:`${Math.round(((tickets.length-breachedSLA)/tickets.length)*100)}%`,color:"var(--accent2)",detail:`${breachedSLA} breach${breachedSLA!==1?"es":""}` },
                {label:"Avg wait time",    value:`${avgWait}h`,                                          color:"var(--warning)",  detail:"Across all open tickets"},
              ].map(c=>(
                <div key={c.label} className="sc-analytics-card">
                  <span className="sc-ac-label">{c.label}</span>
                  <span className="sc-ac-value" style={{color:c.color}}>{c.value}</span>
                  <span className="sc-ac-detail">{c.detail}</span>
                </div>
              ))}
            </div>
            <div className="sc-cat-breakdown">
              <p className="sc-cat-label">Tickets by category</p>
              {[...new Set(tickets.map(t=>t.category))].map(cat=>{
                const cnt = tickets.filter(t=>t.category===cat).length;
                const pct = Math.round((cnt/tickets.length)*100);
                return (
                  <div key={cat} className="sc-cat-row">
                    <span className="sc-cat-name">{cat}</span>
                    <div className="sc-cat-bar-track">
                      <div className="sc-cat-bar-fill" style={{width:`${pct}%`}} />
                    </div>
                    <span className="sc-cat-cnt">{cnt}</span>
                    <span className="sc-cat-pct">{pct}%</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
