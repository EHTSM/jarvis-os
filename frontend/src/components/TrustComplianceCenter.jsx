import React, { useState, useCallback } from "react";
import { track } from "../analytics";
import "./TrustComplianceCenter.css";

// ── Frameworks ────────────────────────────────────────────────────────
const FRAMEWORKS = [
  {
    id:"gdpr", name:"GDPR", region:"EU", icon:"🇪🇺", color:"#3b82f6",
    description:"General Data Protection Regulation — EU personal data protection law.",
    completeness:72,
    controls:[
      {id:"g1",name:"Lawful basis for processing documented",         status:"done",   mandatory:true },
      {id:"g2",name:"Privacy policy published",                       status:"done",   mandatory:true },
      {id:"g3",name:"Data subject rights workflow (export/delete)",   status:"done",   mandatory:true },
      {id:"g4",name:"Data breach notification procedure",             status:"partial",mandatory:true },
      {id:"g5",name:"Data Processing Agreements with vendors",        status:"todo",   mandatory:true },
      {id:"g6",name:"Cookie consent implementation",                  status:"done",   mandatory:true },
      {id:"g7",name:"Record of processing activities",                status:"partial",mandatory:true },
      {id:"g8",name:"DPO appointed (if applicable)",                  status:"todo",   mandatory:false},
    ],
  },
  {
    id:"soc2", name:"SOC 2 Type II", region:"US", icon:"🇺🇸", color:"#8b5cf6",
    description:"Service Organisation Control 2 — security, availability, and confidentiality.",
    completeness:58,
    controls:[
      {id:"s1",name:"Access control policy documented",               status:"done",   mandatory:true },
      {id:"s2",name:"Encryption at rest and in transit",              status:"done",   mandatory:true },
      {id:"s3",name:"Security incident response plan",                status:"partial",mandatory:true },
      {id:"s4",name:"Change management process",                      status:"partial",mandatory:true },
      {id:"s5",name:"Vendor security review process",                 status:"todo",   mandatory:true },
      {id:"s6",name:"Penetration testing completed",                  status:"todo",   mandatory:true },
      {id:"s7",name:"Audit log retention (12 months minimum)",        status:"done",   mandatory:true },
      {id:"s8",name:"Business continuity plan documented",            status:"todo",   mandatory:false},
    ],
  },
  {
    id:"iso27001", name:"ISO 27001", region:"Global", icon:"🌐", color:"#059669",
    description:"International standard for information security management systems.",
    completeness:45,
    controls:[
      {id:"i1",name:"Information security policy",                    status:"done",   mandatory:true },
      {id:"i2",name:"Risk assessment methodology",                    status:"partial",mandatory:true },
      {id:"i3",name:"Asset inventory",                                status:"partial",mandatory:true },
      {id:"i4",name:"Human resources security (NDA, screening)",      status:"todo",   mandatory:true },
      {id:"i5",name:"Physical and environmental security",            status:"todo",   mandatory:true },
      {id:"i6",name:"Cryptographic key management policy",            status:"todo",   mandatory:true },
      {id:"i7",name:"Business continuity management",                 status:"todo",   mandatory:false},
      {id:"i8",name:"Supplier relationships",                         status:"todo",   mandatory:false},
    ],
  },
  {
    id:"dpdp", name:"DPDP 2023", region:"India", icon:"🇮🇳", color:"#f59e0b",
    description:"Digital Personal Data Protection Act 2023 — Indian personal data law.",
    completeness:82,
    controls:[
      {id:"d1",name:"Consent mechanism for data collection",          status:"done",   mandatory:true },
      {id:"d2",name:"Purpose limitation documented",                  status:"done",   mandatory:true },
      {id:"d3",name:"Data Principal rights implemented",              status:"done",   mandatory:true },
      {id:"d4",name:"Data Fiduciary registration (if applicable)",    status:"partial",mandatory:true },
      {id:"d5",name:"Significant harm assessment",                    status:"done",   mandatory:true },
      {id:"d6",name:"Cross-border data transfer controls",            status:"partial",mandatory:true },
      {id:"d7",name:"Data breach notification (72h to PDPB)",        status:"partial",mandatory:true },
      {id:"d8",name:"Children's data protection measures",            status:"done",   mandatory:false},
    ],
  },
];

// ── Risk register ─────────────────────────────────────────────────────
const RISK_REGISTER = [
  { id:"r1", title:"WhatsApp session token exposure",            likelihood:"medium", impact:"high",    status:"mitigated", mitigation:"Tokens stored in encrypted session. QR re-auth required if session invalidated." },
  { id:"r2", title:"Razorpay API key in environment variables",  likelihood:"low",    impact:"critical",status:"mitigated", mitigation:"Key stored in .env, never committed to repo. Rotate quarterly." },
  { id:"r3", title:"No DPA signed with Razorpay",               likelihood:"high",   impact:"medium",  status:"open",      mitigation:"TODO: Review Razorpay DPA. Use their standard agreement." },
  { id:"r4", title:"Terraform state file local (no encryption)", likelihood:"medium", impact:"high",    status:"open",      mitigation:"Migrate to S3 remote backend with server-side encryption. Tracked in infra backlog." },
  { id:"r5", title:"No formal pen test conducted",              likelihood:"medium", impact:"high",    status:"open",      mitigation:"Schedule external pen test before public launch. Budget allocated." },
  { id:"r6", title:"Single-region deployment (us-east-1)",      likelihood:"low",    impact:"high",    status:"accepted",  mitigation:"Acceptable for current scale. Multi-region in Year 2 roadmap." },
  { id:"r7", title:"Android cold-start auth null crash",        likelihood:"high",   impact:"medium",  status:"in_progress",mitigation:"PR #3 in review. Fix ships today. Affects ~15% Android users." },
];

// ── Vendor reviews ────────────────────────────────────────────────────
const VENDORS = [
  { id:"v1", name:"Razorpay",   purpose:"Payment processing",    reviewed:"2026-05-01", nextReview:"2026-11-01", status:"approved",  dpa:"pending",  dataTypes:["PII","Payment data"] },
  { id:"v2", name:"AWS",        purpose:"Cloud infrastructure",  reviewed:"2026-04-01", nextReview:"2026-10-01", status:"approved",  dpa:"signed",   dataTypes:["All platform data"] },
  { id:"v3", name:"Anthropic",  purpose:"AI model inference",    reviewed:"2026-05-15", nextReview:"2026-11-15", status:"approved",  dpa:"signed",   dataTypes:["Prompt data (no PII policy)"] },
  { id:"v4", name:"GitHub",     purpose:"Source code hosting",   reviewed:"2026-03-01", nextReview:"2026-09-01", status:"approved",  dpa:"signed",   dataTypes:["Source code"] },
  { id:"v5", name:"Cloudflare", purpose:"CDN / DNS / DDoS",      reviewed:"2026-04-15", nextReview:"2026-10-15", status:"approved",  dpa:"signed",   dataTypes:["Network traffic (no content)"] },
  { id:"v6", name:"Notion",     purpose:"Knowledge base",        reviewed:"2026-06-01", nextReview:"2026-12-01", status:"pending",   dpa:"pending",  dataTypes:["Internal docs"] },
];

const CTRL_COLORS = { done:"var(--success)", partial:"var(--warning)", todo:"rgba(255,255,255,0.12)" };
const RISK_IMPACT  = { critical:"var(--danger)", high:"var(--warning)", medium:"var(--accent2)", low:"var(--text-faint)" };
const RISK_STATUS  = { mitigated:"var(--success)", open:"var(--danger)", in_progress:"var(--accent2)", accepted:"var(--text-faint)" };

export default function TrustComplianceCenter({ onNavigate }) {
  const [section,  setSection]  = useState("overview");
  const [selFw,    setSelFw]    = useState("gdpr");

  React.useEffect(() => { track.event("trust_compliance_viewed"); }, []);

  const selFramework = FRAMEWORKS.find(f=>f.id===selFw);
  const overallScore = Math.round(FRAMEWORKS.reduce((s,f)=>s+f.completeness,0)/FRAMEWORKS.length);
  const openRisks    = RISK_REGISTER.filter(r=>r.status==="open").length;
  const critRisks    = RISK_REGISTER.filter(r=>r.impact==="critical").length;

  return (
    <div className="trust-compliance-center page-enter">
      <div className="tcc-header">
        <div>
          <h1 className="tcc-title">Trust & Compliance</h1>
          <p className="tcc-subtitle">Security controls, compliance checklists, risk register, and vendor reviews. GDPR · SOC2 · ISO 27001 · DPDP India.</p>
        </div>
        <div className="tcc-overall-score">
          <span className="tcc-score-val" style={{color:overallScore>=80?"var(--success)":overallScore>=60?"var(--warning)":"var(--danger)"}}>{overallScore}%</span>
          <span className="tcc-score-label">Compliance score</span>
        </div>
      </div>

      <div className="tcc-framework-strip">
        {FRAMEWORKS.map(f=>(
          <button key={f.id}
            className={`tcc-fw-tile${selFw===f.id?" tcc-fw-tile--active":""}`}
            style={selFw===f.id?{borderColor:f.color+"44",background:f.color+"0d"}:{}}
            onClick={()=>{setSelFw(f.id);setSection("controls");}}
          >
            <span className="tcc-fw-icon">{f.icon}</span>
            <span className="tcc-fw-name" style={{color:f.color}}>{f.name}</span>
            <span className="tcc-fw-pct" style={{color:f.completeness>=80?"var(--success)":f.completeness>=60?"var(--warning)":"var(--danger)"}}>{f.completeness}%</span>
            <div className="tcc-fw-bar-track">
              <div className="tcc-fw-bar-fill" style={{width:`${f.completeness}%`,background:f.color}} />
            </div>
          </button>
        ))}
      </div>

      <div className="tcc-tabs">
        {[
          {id:"overview",  label:"Overview"},
          {id:"controls",  label:"Controls"},
          {id:"risks",     label:`Risk Register${openRisks>0?` (${openRisks} open)`:""}` },
          {id:"vendors",   label:"Vendor Reviews"},
        ].map(t=>(
          <button key={t.id} className={`tcc-tab${section===t.id?" tcc-tab--active":""}`} onClick={()=>setSection(t.id)}>{t.label}</button>
        ))}
      </div>

      <div className="tcc-content" key={section+selFw}>

        {section==="overview" && (
          <div className="tcc-overview">
            <div className="tcc-ov-cards">
              {FRAMEWORKS.map(f=>{
                const done    = f.controls.filter(c=>c.status==="done").length;
                const partial = f.controls.filter(c=>c.status==="partial").length;
                const todo    = f.controls.filter(c=>c.status==="todo").length;
                return (
                  <div key={f.id} className="tcc-ov-card" style={{borderColor:f.color+"2e"}}>
                    <div className="tcc-ov-card-header">
                      <span className="tcc-ov-icon">{f.icon}</span>
                      <span className="tcc-ov-name" style={{color:f.color}}>{f.name}</span>
                      <span className="tcc-ov-region">{f.region}</span>
                    </div>
                    <p className="tcc-ov-desc">{f.description}</p>
                    <div className="tcc-ov-bar-track">
                      <div className="tcc-ov-bar-fill" style={{width:`${f.completeness}%`,background:f.color}} />
                    </div>
                    <div className="tcc-ov-counts">
                      <span style={{color:"var(--success)"}}>✓ {done}</span>
                      <span style={{color:"var(--warning)"}}>◑ {partial}</span>
                      <span style={{color:"rgba(255,255,255,0.25)"}}>○ {todo}</span>
                    </div>
                    <button className="tcc-ov-cta" style={{color:f.color,borderColor:f.color+"33"}} onClick={()=>{setSelFw(f.id);setSection("controls");}}>
                      View controls →
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="tcc-ov-risk-summary">
              <span className="tcc-ors-label">Open risks: </span>
              <span style={{color:openRisks>0?"var(--danger)":"var(--success)",fontWeight:800}}>{openRisks}</span>
              {critRisks>0 && <span className="tcc-ors-critical"> · {critRisks} critical impact</span>}
            </div>
          </div>
        )}

        {section==="controls" && selFramework && (
          <div className="tcc-controls-section">
            <div className="tcc-controls-header">
              <span className="tcc-ov-icon">{selFramework.icon}</span>
              <span className="tcc-controls-fw-name" style={{color:selFramework.color}}>{selFramework.name}</span>
              <span className="tcc-controls-completeness" style={{color:selFramework.completeness>=80?"var(--success)":"var(--warning)"}}>{selFramework.completeness}% complete</span>
            </div>
            <div className="tcc-controls-list">
              {selFramework.controls.map(c=>(
                <div key={c.id} className={`tcc-ctrl-row tcc-ctrl-row--${c.status}`}>
                  <span className="tcc-ctrl-dot" style={{background:CTRL_COLORS[c.status]}} />
                  <span className="tcc-ctrl-name">{c.name}</span>
                  {c.mandatory && <span className="tcc-ctrl-mandatory">mandatory</span>}
                  <span className={`tcc-ctrl-status tcc-ctrl-status--${c.status}`}>{c.status}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {section==="risks" && (
          <div className="tcc-risk-list">
            {RISK_REGISTER.map(r=>(
              <div key={r.id} className="tcc-risk-row">
                <div className="tcc-risk-info">
                  <div className="tcc-risk-title-row">
                    <span className="tcc-risk-title">{r.title}</span>
                    <span className="tcc-risk-likelihood">Likelihood: <strong>{r.likelihood}</strong></span>
                  </div>
                  <p className="tcc-risk-mitigation">{r.mitigation}</p>
                </div>
                <div className="tcc-risk-badges">
                  <span className="tcc-risk-impact" style={{color:RISK_IMPACT[r.impact],borderColor:RISK_IMPACT[r.impact]+"33"}}>{r.impact}</span>
                  <span className="tcc-risk-status" style={{color:RISK_STATUS[r.status],borderColor:RISK_STATUS[r.status]+"33"}}>{r.status.replace("_"," ")}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {section==="vendors" && (
          <div className="tcc-vendor-list">
            {VENDORS.map(v=>(
              <div key={v.id} className="tcc-vendor-row">
                <div className="tcc-vendor-info">
                  <span className="tcc-vendor-name">{v.name}</span>
                  <span className="tcc-vendor-purpose">{v.purpose}</span>
                  <div className="tcc-vendor-data-types">
                    {v.dataTypes.map(d=><span key={d} className="tcc-data-type-chip">{d}</span>)}
                  </div>
                </div>
                <div className="tcc-vendor-meta">
                  <span className={`tcc-vendor-dpa tcc-vendor-dpa--${v.dpa}`}>DPA: {v.dpa}</span>
                  <span className="tcc-vendor-review">Last review: {v.reviewed}</span>
                  <span className="tcc-vendor-next">Next: {v.nextReview}</span>
                  <span className={`tcc-vendor-status tcc-vendor-status--${v.status}`}>{v.status}</span>
                </div>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}
