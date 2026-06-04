import React, { useState, useCallback } from "react";
import { track } from "../analytics";
import "./DataOwnershipCenter.css";

const REQ_KEY = "ooplix_data_requests";
function _load(k,fb){try{return JSON.parse(localStorage.getItem(k)||JSON.stringify(fb));}catch{return fb;}}
function _save(k,v){localStorage.setItem(k,JSON.stringify(v));}

// ── Data inventory ────────────────────────────────────────────────────
const DATA_INVENTORY = [
  { id:"di1", category:"Identity",      items:["Full name","Email address","Phone number","Business name"],                     location:"Ooplix DB (India)",  retention:"Account lifetime + 90 days",  sensitivity:"high",    records: 1 },
  { id:"di2", category:"Contact data",  items:["Lead names","WhatsApp numbers","Email addresses","Notes"],                     location:"Ooplix DB (India)",  retention:"Account lifetime + 90 days",  sensitivity:"high",    records: 247 },
  { id:"di3", category:"Usage data",    items:["Feature interactions","Session timestamps","Page views","Click events"],       location:"Analytics (local)",  retention:"24 months",                    sensitivity:"medium",  records: 18420 },
  { id:"di4", category:"Communication", items:["WhatsApp message logs","Email send history","Campaign records"],               location:"Ooplix DB (India)",  retention:"12 months",                    sensitivity:"high",    records: 3841 },
  { id:"di5", category:"Billing",       items:["Plan type","Payment status","Invoice history","Subscription dates"],           location:"Razorpay / Ooplix",  retention:"7 years (tax)",                sensitivity:"critical",records: 1 },
  { id:"di6", category:"Auth & Sessions",items:["Hashed passwords","Session tokens","Login timestamps","IP addresses"],       location:"Ooplix Auth (India)",retention:"90 days post-session",         sensitivity:"critical",records: 892 },
  { id:"di7", category:"Agent data",    items:["Agent configs","Workflow histories","Memory entries","Task logs"],             location:"Ooplix DB (India)",  retention:"Account lifetime",             sensitivity:"medium",  records: 12044 },
  { id:"di8", category:"Knowledge base",items:["Uploaded documents","Website crawl data","Indexed chunks"],                   location:"Ooplix KB (local)",  retention:"Until deleted by user",        sensitivity:"medium",  records: 174 },
];

// ── Retention policies ────────────────────────────────────────────────
const RETENTION_POLICIES = [
  { id:"rp1", name:"User account data",      policy:"Retained for account lifetime + 90-day grace period after deletion.",     legal:"IT Act 2000 / DPDP 2023",  automated: true  },
  { id:"rp2", name:"Billing records",        policy:"Retained for 7 years minimum for tax and audit compliance.",               legal:"Indian Income Tax Act",    automated: true  },
  { id:"rp3", name:"Communication logs",     policy:"WhatsApp and email logs retained for 12 months, then auto-purged.",       legal:"DPDP 2023",                automated: true  },
  { id:"rp4", name:"Session / auth tokens",  policy:"Sessions purged 90 days post-expiry. Login IPs retained 30 days.",       legal:"IT Act 2000",              automated: true  },
  { id:"rp5", name:"Analytics events",       policy:"Retained 24 months, then aggregated. Raw events deleted after.",         legal:"Best practice",            automated: true  },
  { id:"rp6", name:"Agent memory",           policy:"Retained for account lifetime. User can delete individual entries.",      legal:"DPDP 2023",                automated: false },
];

// ── Access log seed ───────────────────────────────────────────────────
const ACCESS_LOGS = [
  { id:"al1", actor:"You (Owner)",          action:"Exported contact data",           category:"Contact data",    ts:"2026-06-04 10:22", ip:"103.x.x.x", reason:"Manual export"      },
  { id:"al2", actor:"Support Agent",        action:"Read knowledge base (ticket #1024)",category:"Knowledge base",ts:"2026-06-04 13:51", ip:"internal",   reason:"Ticket resolution"  },
  { id:"al3", actor:"Analytics Agent",      action:"Read usage events (weekly report)",category:"Usage data",     ts:"2026-06-04 09:00", ip:"internal",   reason:"Automated report"   },
  { id:"al4", actor:"Sales Agent",          action:"Read contact list (qualification)", category:"Contact data",   ts:"2026-06-04 09:10", ip:"internal",   reason:"Lead qualification" },
  { id:"al5", actor:"You (Owner)",          action:"Viewed billing history",           category:"Billing",         ts:"2026-06-03 17:45", ip:"103.x.x.x", reason:"Manual view"        },
  { id:"al6", actor:"Marketing Agent",      action:"Read email campaign history",      category:"Communication",   ts:"2026-06-04 10:45", ip:"internal",   reason:"CTR analysis"       },
];

const SEED_REQUESTS = [
  { id:"req1", type:"export",   email:"altamashjauhar@gmail.com", categories:["Contact data","Usage data"], status:"completed", requestedAt:"2026-06-01", completedAt:"2026-06-01", note:"Full data package delivered." },
];

const SENS_COLORS = { critical:"var(--danger)", high:"var(--warning)", medium:"var(--accent2)", low:"var(--text-faint)" };

export default function DataOwnershipCenter({ onNavigate }) {
  const [section,  setSection]  = useState("inventory");
  const [requests, setRequests] = useState(() => _load(REQ_KEY, SEED_REQUESTS));
  const [showReqForm, setShowReqForm] = useState(false);
  const [reqType,  setReqType]  = useState("export");
  const [reqEmail, setReqEmail] = useState("altamashjauhar@gmail.com");
  const [reqCats,  setReqCats]  = useState([]);
  const [toast,    setToast]    = useState(null);

  React.useEffect(() => { track.event("data_ownership_viewed"); }, []);
  const showToast = m => { setToast(m); setTimeout(()=>setToast(null),2400); };

  const handleSubmitRequest = useCallback(e => {
    e.preventDefault();
    const req = {
      id: `req${Date.now()}`, type: reqType, email: reqEmail,
      categories: reqCats.length ? reqCats : ["All data"],
      status: "pending", requestedAt: new Date().toISOString().slice(0,10),
      completedAt: null, note: null,
    };
    const next = [req, ...requests];
    _save(REQ_KEY, next); setRequests(next);
    setShowReqForm(false); setReqCats([]);
    showToast(`${reqType === "export" ? "Export" : "Deletion"} request submitted`);
    track.event("data_request_submitted", { type: reqType });
  }, [reqType, reqEmail, reqCats, requests]);

  const toggleCat = cat => setReqCats(prev => prev.includes(cat) ? prev.filter(c=>c!==cat) : [...prev,cat]);

  const totalRecords = DATA_INVENTORY.reduce((s,d)=>s+d.records,0);
  const pendingReqs  = requests.filter(r=>r.status==="pending").length;

  return (
    <div className="data-ownership-center page-enter">
      {toast && <div className="doc2-toast">{toast}</div>}

      <div className="doc2-header">
        <div>
          <h1 className="doc2-title">Data Ownership Center</h1>
          <p className="doc2-subtitle">Your data inventory, retention policies, access logs, and subject rights requests.</p>
        </div>
        <button className="doc2-req-btn" onClick={()=>setShowReqForm(p=>!p)}>+ New request</button>
      </div>

      <div className="doc2-summary-strip">
        {[
          { label:"Data categories",  value:DATA_INVENTORY.length,   color:"var(--accent2)"  },
          { label:"Total records",    value:totalRecords.toLocaleString("en-IN"), color:"var(--text)" },
          { label:"Retention policies",value:RETENTION_POLICIES.length,color:"var(--accent)" },
          { label:"Pending requests", value:pendingReqs, color:pendingReqs>0?"var(--warning)":"var(--success)" },
          { label:"Access log entries",value:ACCESS_LOGS.length, color:"var(--text-faint)" },
        ].map(s=>(
          <div key={s.label} className="doc2-summary-tile">
            <span className="doc2-sv" style={{color:s.color}}>{s.value}</span>
            <span className="doc2-sl">{s.label}</span>
          </div>
        ))}
      </div>

      {showReqForm && (
        <form className="doc2-req-form" onSubmit={handleSubmitRequest}>
          <h3 className="doc2-rf-title">Subject rights request</h3>
          <div className="doc2-rf-row">
            <div className="doc2-rf-field">
              <label className="doc2-rf-label">Request type</label>
              <select className="doc2-rf-input" value={reqType} onChange={e=>setReqType(e.target.value)}>
                <option value="export">Data export (Right to access)</option>
                <option value="deletion">Data deletion (Right to erasure)</option>
                <option value="correction">Data correction (Right to rectify)</option>
              </select>
            </div>
            <div className="doc2-rf-field">
              <label className="doc2-rf-label">Email address</label>
              <input className="doc2-rf-input" type="email" value={reqEmail} onChange={e=>setReqEmail(e.target.value)} required />
            </div>
          </div>
          <div className="doc2-rf-field">
            <label className="doc2-rf-label">Categories (leave blank for all)</label>
            <div className="doc2-rf-cats">
              {DATA_INVENTORY.map(d=>(
                <button type="button" key={d.id}
                  className={`doc2-cat-chip${reqCats.includes(d.category)?" doc2-cat-chip--sel":""}`}
                  onClick={()=>toggleCat(d.category)}>{d.category}</button>
              ))}
            </div>
          </div>
          <div className="doc2-rf-actions">
            <button type="button" className="doc2-cancel-btn" onClick={()=>setShowReqForm(false)}>Cancel</button>
            <button type="submit" className="doc2-submit-btn">Submit request</button>
          </div>
        </form>
      )}

      <div className="doc2-tabs">
        {[
          {id:"inventory",  label:"Data Inventory"},
          {id:"retention",  label:"Retention Policies"},
          {id:"requests",   label:`Requests${requests.length?` (${requests.length})`:""}` },
          {id:"accesslogs", label:"Access Log"},
        ].map(t=>(
          <button key={t.id} className={`doc2-tab${section===t.id?" doc2-tab--active":""}`} onClick={()=>setSection(t.id)}>{t.label}</button>
        ))}
      </div>

      <div className="doc2-content" key={section}>

        {section==="inventory" && (
          <div className="doc2-inventory-list">
            {DATA_INVENTORY.map(d=>(
              <div key={d.id} className="doc2-inv-row">
                <div className="doc2-inv-left">
                  <div className="doc2-inv-info">
                    <div className="doc2-inv-header">
                      <span className="doc2-inv-cat">{d.category}</span>
                      <span className="doc2-sens-badge" style={{color:SENS_COLORS[d.sensitivity],borderColor:SENS_COLORS[d.sensitivity]+"33"}}>{d.sensitivity}</span>
                    </div>
                    <div className="doc2-inv-items">
                      {d.items.map(i=><span key={i} className="doc2-inv-item">{i}</span>)}
                    </div>
                  </div>
                </div>
                <div className="doc2-inv-right">
                  <div className="doc2-inv-meta">
                    <span className="doc2-inv-meta-label">Location</span>
                    <span className="doc2-inv-meta-val">{d.location}</span>
                  </div>
                  <div className="doc2-inv-meta">
                    <span className="doc2-inv-meta-label">Retention</span>
                    <span className="doc2-inv-meta-val">{d.retention}</span>
                  </div>
                  <div className="doc2-inv-meta">
                    <span className="doc2-inv-meta-label">Records</span>
                    <span className="doc2-inv-meta-val doc2-inv-meta-records">{d.records.toLocaleString("en-IN")}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {section==="retention" && (
          <div className="doc2-retention-list">
            {RETENTION_POLICIES.map(r=>(
              <div key={r.id} className="doc2-ret-row">
                <div className="doc2-ret-info">
                  <span className="doc2-ret-name">{r.name}</span>
                  <p className="doc2-ret-policy">{r.policy}</p>
                  <span className="doc2-ret-legal">Legal basis: {r.legal}</span>
                </div>
                <div className="doc2-ret-right">
                  <span className={`doc2-ret-auto${r.automated?" doc2-ret-auto--yes":""}`}>
                    {r.automated?"Auto-enforced":"Manual"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {section==="requests" && (
          <div className="doc2-requests-list">
            {requests.length===0 ? (
              <div className="doc2-empty"><span>◎</span><p>No requests submitted</p></div>
            ) : requests.map(r=>(
              <div key={r.id} className={`doc2-req-row doc2-req-row--${r.status}`}>
                <div className="doc2-req-info">
                  <div className="doc2-req-header">
                    <span className="doc2-req-type">{r.type}</span>
                    <span className="doc2-req-email">{r.email}</span>
                  </div>
                  <div className="doc2-req-cats">
                    {(r.categories||[]).map(c=><span key={c} className="doc2-req-cat">{c}</span>)}
                  </div>
                  {r.note && <p className="doc2-req-note">{r.note}</p>}
                </div>
                <div className="doc2-req-right">
                  <span className={`doc2-req-status doc2-req-status--${r.status}`}>{r.status}</span>
                  <span className="doc2-req-date">Requested: {r.requestedAt}</span>
                  {r.completedAt && <span className="doc2-req-date">Completed: {r.completedAt}</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        {section==="accesslogs" && (
          <div className="doc2-access-list">
            <p className="doc2-access-note">All data access events — by users and agents — are recorded here.</p>
            {ACCESS_LOGS.map(a=>(
              <div key={a.id} className="doc2-access-row">
                <span className="doc2-access-ts">{a.ts}</span>
                <div className="doc2-access-info">
                  <span className="doc2-access-actor">{a.actor}</span>
                  <span className="doc2-access-action">{a.action}</span>
                </div>
                <span className="doc2-access-cat">{a.category}</span>
                <span className="doc2-access-ip">{a.ip}</span>
                <span className="doc2-access-reason">{a.reason}</span>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}
