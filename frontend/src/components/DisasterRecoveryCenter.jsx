import React, { useState } from "react";
import { track } from "../analytics";
import "./DisasterRecoveryCenter.css";

// ── Backup inventory ──────────────────────────────────────────────────
const BACKUPS = [
  { id:"b1",  type:"database",  name:"PostgreSQL — ooplix_prod",     size:"2.4 GB",  frequency:"Every 6h",  lastRun:"2h ago",      status:"success", encrypted:true,  location:"S3 us-east-1", copies:3, rpo:"6h",  rto:"30m" },
  { id:"b2",  type:"database",  name:"Redis — session + queue state",size:"180 MB",  frequency:"Every 1h",  lastRun:"42m ago",     status:"success", encrypted:true,  location:"S3 us-east-1", copies:3, rpo:"1h",  rto:"10m" },
  { id:"b3",  type:"storage",   name:"User uploaded files (S3)",     size:"840 MB",  frequency:"Daily",     lastRun:"12h ago",     status:"success", encrypted:true,  location:"S3 us-west-2 (cross-region)", copies:2, rpo:"24h", rto:"1h" },
  { id:"b4",  type:"code",      name:"All GitHub repos (mirror)",    size:"1.2 GB",  frequency:"Daily",     lastRun:"18h ago",     status:"success", encrypted:false, location:"Private mirror (GitLab)", copies:1, rpo:"24h", rto:"2h" },
  { id:"b5",  type:"config",    name:"Terraform state + infra config",size:"12 MB",  frequency:"On change", lastRun:"3d ago",      status:"warning", encrypted:false, location:"Local file — NOT remote", copies:1, rpo:"Manual",rto:"4h"},
  { id:"b6",  type:"analytics", name:"Event log archive",            size:"5.8 GB",  frequency:"Weekly",    lastRun:"5d ago",      status:"success", encrypted:true,  location:"S3 us-east-1 (Glacier)", copies:1, rpo:"7d",  rto:"4h" },
];

// ── Recovery plans ────────────────────────────────────────────────────
const RECOVERY_PLANS = [
  {
    id:"rp1", name:"Database failure",      rto:"30 min", rpo:"6h",  readiness:"ready",
    steps:["Detect failure via health check (auto-alert)","Trigger automated restore from latest S3 snapshot","Verify data integrity (row count + checksum)","Switch DNS to restored instance","Run smoke tests against restored DB","Notify team via Telegram bot"],
    lastTested:"2026-05-15", testedBy:"DevOps Agent",
  },
  {
    id:"rp2", name:"Full server failure",   rto:"2h",     rpo:"6h",  readiness:"ready",
    steps:["Detect via uptime monitor (Cloudflare)","Spin new EC2 instance from AMI snapshot","Restore latest DB backup to new instance","Point load balancer to new instance","Restore Redis from latest snapshot","Validate via smoke test suite","Notify users if >5 min outage"],
    lastTested:"2026-05-01", testedBy:"DevOps Agent",
  },
  {
    id:"rp3", name:"Data corruption event", rto:"4h",     rpo:"6h",  readiness:"partial",
    steps:["Identify corrupted records (audit log diff)","Halt affected write operations","Restore from last known-good snapshot","Reconcile delta (replay event log)","Validate data integrity","Resume operations","Post-mortem within 24h"],
    lastTested:"Never", testedBy:"—",
  },
  {
    id:"rp4", name:"Security breach",       rto:"1h",     rpo:"0",   readiness:"partial",
    steps:["Activate incident response team","Revoke all active sessions","Rotate all API keys and secrets","Assess scope of breach","Notify affected users within 72h (GDPR/DPDP)","Engage forensic review","File regulatory report if required"],
    lastTested:"Never", testedBy:"—",
  },
];

// ── Restore history ───────────────────────────────────────────────────
const RESTORE_HISTORY = [
  { id:"rh1", target:"Redis — session state",  trigger:"Deploy rollback (v3.2.0)",            duration:"8 min",  status:"success", ts:"2026-06-03 16:23", dataLoss:"0" },
  { id:"rh2", target:"PostgreSQL — ooplix_prod",trigger:"Test restore (DR drill)",           duration:"22 min", status:"success", ts:"2026-05-15 10:00", dataLoss:"0" },
  { id:"rh3", target:"PostgreSQL — ooplix_prod",trigger:"Full server test (AMI snapshot)",   duration:"1h 45m", status:"success", ts:"2026-05-01 14:00", dataLoss:"0" },
];

// ── Failover status ───────────────────────────────────────────────────
const FAILOVER_STATUS = [
  { component:"API Server",       primary:"EC2 us-east-1a", standby:"AMI snapshot",        readiness:"partial", lastTest:"2026-05-01" },
  { component:"PostgreSQL",       primary:"RDS us-east-1",  standby:"S3 snapshot + restore",readiness:"ready",   lastTest:"2026-05-15" },
  { component:"Redis",            primary:"ElastiCache",    standby:"Snapshot restore",     readiness:"ready",   lastTest:"2026-06-03" },
  { component:"Frontend CDN",     primary:"Cloudflare",     standby:"S3 static fallback",   readiness:"ready",   lastTest:"2026-04-10" },
  { component:"Terraform state",  primary:"Local file",     standby:"None",                 readiness:"not_ready",lastTest:"Never"    },
];

const BACKUP_TYPE_COLORS = { database:"var(--accent2)", storage:"var(--warning)", code:"#e6edf3", config:"var(--danger)", analytics:"#a78bfa" };
const READY_COLORS = { ready:"var(--success)", partial:"var(--warning)", not_ready:"var(--danger)" };
const STA_COLORS   = { success:"var(--success)", warning:"var(--warning)", failed:"var(--danger)" };

function RecoveryScore({ plans }) {
  const readyCount   = plans.filter(p=>p.readiness==="ready").length;
  const partialCount = plans.filter(p=>p.readiness==="partial").length;
  const score = Math.round((readyCount * 100 + partialCount * 50) / (plans.length * 100) * 100);
  const color = score>=80?"var(--success)":score>=50?"var(--warning)":"var(--danger)";
  return (
    <div className="drc-score-card">
      <span className="drc-score-val" style={{color}}>{score}</span>
      <span className="drc-score-label">Recovery score</span>
      <div className="drc-score-bar-track">
        <div className="drc-score-bar-fill" style={{width:`${score}%`,background:color}} />
      </div>
      <span className="drc-score-sub">{readyCount}/{plans.length} plans ready · {partialCount} partial</span>
    </div>
  );
}

export default function DisasterRecoveryCenter({ onNavigate }) {
  const [section,  setSection]  = useState("backups");
  const [selPlan,  setSelPlan]  = useState("rp1");

  React.useEffect(() => { track.event("disaster_recovery_viewed"); }, []);

  const warningBackups = BACKUPS.filter(b=>b.status==="warning").length;
  const totalSize      = "10.4 GB";
  const notReadyCount  = FAILOVER_STATUS.filter(f=>f.readiness==="not_ready").length;

  return (
    <div className="disaster-recovery-center page-enter">
      <div className="drc-header">
        <div>
          <h1 className="drc-title">Disaster Recovery Center</h1>
          <p className="drc-subtitle">Backups, snapshots, recovery plans, restore history, and failover readiness.</p>
        </div>
      </div>

      <div className="drc-summary-strip">
        {[
          {label:"Backup sources",     value:BACKUPS.length,      color:"var(--text)"    },
          {label:"Total backup size",  value:totalSize,            color:"var(--accent2)" },
          {label:"Backup warnings",    value:warningBackups,       color:warningBackups>0?"var(--warning)":"var(--success)"},
          {label:"Recovery plans",     value:RECOVERY_PLANS.length,color:"var(--accent)"  },
          {label:"Restore events",     value:RESTORE_HISTORY.length,color:"var(--text-faint)"},
          {label:"Failover gaps",      value:notReadyCount,        color:notReadyCount>0?"var(--danger)":"var(--success)"},
        ].map(s=>(
          <div key={s.label} className="drc-summary-tile">
            <span className="drc-sv" style={{color:s.color}}>{s.value}</span>
            <span className="drc-sl">{s.label}</span>
          </div>
        ))}
      </div>

      <div className="drc-tabs">
        {[
          {id:"backups",  label:`Backups${warningBackups>0?` (${warningBackups} ⚠)`:""}` },
          {id:"plans",    label:"Recovery Plans"},
          {id:"history",  label:"Restore History"},
          {id:"failover", label:`Failover${notReadyCount>0?` (${notReadyCount} gaps)`:""}` },
        ].map(t=>(
          <button key={t.id} className={`drc-tab${section===t.id?" drc-tab--active":""}`} onClick={()=>setSection(t.id)}>{t.label}</button>
        ))}
      </div>

      <div className="drc-content" key={section}>

        {section==="backups" && (
          <div className="drc-backup-list">
            {BACKUPS.map(b=>(
              <div key={b.id} className={`drc-backup-row${b.status==="warning"?" drc-backup-row--warn":""}`}>
                <div className="drc-backup-type-dot" style={{background:BACKUP_TYPE_COLORS[b.type]||"var(--text-faint)"}} />
                <div className="drc-backup-info">
                  <div className="drc-backup-header">
                    <span className="drc-backup-name">{b.name}</span>
                    {b.status==="warning" && <span className="drc-backup-warn-badge">⚠ needs attention</span>}
                  </div>
                  <div className="drc-backup-meta">
                    <span>{b.size}</span>
                    <span>{b.frequency}</span>
                    <span>Last: {b.lastRun}</span>
                    <span>{b.location}</span>
                    <span>{b.copies} cop{b.copies===1?"y":"ies"}</span>
                    {b.encrypted && <span className="drc-encrypted-badge">🔒 encrypted</span>}
                  </div>
                </div>
                <div className="drc-backup-rpo-rto">
                  <span className="drc-rpo-rto-item">RPO: <strong>{b.rpo}</strong></span>
                  <span className="drc-rpo-rto-item">RTO: <strong>{b.rto}</strong></span>
                </div>
                <span className={`drc-backup-status drc-backup-status--${b.status}`}>{b.status}</span>
              </div>
            ))}
          </div>
        )}

        {section==="plans" && (
          <div className="drc-plans-layout">
            <div className="drc-plans-list">
              <RecoveryScore plans={RECOVERY_PLANS} />
              {RECOVERY_PLANS.map(p=>(
                <button key={p.id}
                  className={`drc-plan-card${selPlan===p.id?" drc-plan-card--sel":""}`}
                  onClick={()=>setSelPlan(p.id)}
                >
                  <div className="drc-plan-header">
                    <span className="drc-plan-ready-dot" style={{background:READY_COLORS[p.readiness]}} />
                    <span className="drc-plan-name">{p.name}</span>
                  </div>
                  <div className="drc-plan-targets">
                    <span className="drc-plan-target">RTO: <strong>{p.rto}</strong></span>
                    <span className="drc-plan-target">RPO: <strong>{p.rpo}</strong></span>
                  </div>
                  <span className={`drc-plan-readiness drc-plan-readiness--${p.readiness}`}>{p.readiness.replace("_"," ")}</span>
                  <span className="drc-plan-tested">Last tested: {p.lastTested}</span>
                </button>
              ))}
            </div>
            {selPlan && (() => {
              const plan = RECOVERY_PLANS.find(p=>p.id===selPlan);
              if (!plan) return null;
              return (
                <div className="drc-plan-detail">
                  <div className="drc-pd-header">
                    <span className="drc-pd-name">{plan.name}</span>
                    <div className="drc-pd-badges">
                      <span className="drc-pd-badge">RTO: {plan.rto}</span>
                      <span className="drc-pd-badge">RPO: {plan.rpo}</span>
                      <span className={`drc-pd-ready drc-pd-ready--${plan.readiness}`}>{plan.readiness.replace("_"," ")}</span>
                    </div>
                  </div>
                  <div className="drc-pd-steps">
                    {plan.steps.map((s,i)=>(
                      <div key={i} className="drc-pd-step">
                        <span className="drc-pd-step-num">{i+1}</span>
                        <span className="drc-pd-step-text">{s}</span>
                      </div>
                    ))}
                  </div>
                  <div className="drc-pd-test-info">
                    <span>Last tested: <strong>{plan.lastTested}</strong></span>
                    <span>By: <strong>{plan.testedBy}</strong></span>
                    {plan.readiness==="partial" && (
                      <div className="drc-pd-test-warning">⚠ Plan not yet tested. Schedule a DR drill to validate.</div>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {section==="history" && (
          <div className="drc-restore-list">
            {RESTORE_HISTORY.length===0 ? (
              <div className="drc-empty">
                <span style={{color:"var(--success)",fontSize:24}}>✓</span>
                <p>No restore events yet</p>
              </div>
            ) : RESTORE_HISTORY.map(r=>(
              <div key={r.id} className="drc-restore-row">
                <span className={`drc-restore-dot`} style={{background:STA_COLORS[r.status]}} />
                <div className="drc-restore-info">
                  <span className="drc-restore-target">{r.target}</span>
                  <span className="drc-restore-trigger">{r.trigger}</span>
                </div>
                <div className="drc-restore-meta">
                  <span>{r.ts}</span>
                  <span>Duration: <strong>{r.duration}</strong></span>
                  <span>Data loss: <strong style={{color:r.dataLoss==="0"?"var(--success)":"var(--danger)"}}>{r.dataLoss==="0"?"None":r.dataLoss}</strong></span>
                </div>
                <span className={`drc-restore-status drc-restore-status--${r.status}`}>{r.status}</span>
              </div>
            ))}
          </div>
        )}

        {section==="failover" && (
          <div className="drc-failover-list">
            {FAILOVER_STATUS.map(f=>(
              <div key={f.component} className={`drc-failover-row drc-failover-row--${f.readiness}`}>
                <div className="drc-failover-info">
                  <span className="drc-failover-component">{f.component}</span>
                  <div className="drc-failover-detail">
                    <span>Primary: <strong>{f.primary}</strong></span>
                    <span>Standby: <strong>{f.standby}</strong></span>
                  </div>
                  <span className="drc-failover-tested">Last tested: {f.lastTest}</span>
                </div>
                <span className={`drc-failover-readiness drc-failover-readiness--${f.readiness}`} style={{color:READY_COLORS[f.readiness],borderColor:READY_COLORS[f.readiness]+"33"}}>
                  {f.readiness.replace("_"," ")}
                </span>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}
