import React, { useState } from "react";
import { track } from "../analytics";
import "./MobilePlatformCenter.css";

const RELEASES = [
  { id:"r1", version:"v3.2.1", platform:["android"],        status:"failed",   date:"2026-06-03", size:"18.4 MB", notes:"Firebase null crash on Android 12+ cold start. Rolled back.",        crashRate:"14.2%", adoptionPct:0  },
  { id:"r2", version:"v3.2.0", platform:["android","ios"],  status:"live",     date:"2026-05-28", size:"18.1 MB", notes:"Phase 9 features: Knowledge, Memory, Integration, Agent OS.",        crashRate:"0.4%",  adoptionPct:71 },
  { id:"r3", version:"v3.1.5", platform:["android","ios"],  status:"archived", date:"2026-05-10", size:"16.8 MB", notes:"Stability fixes: WhatsApp session persistence improvement.",         crashRate:"0.6%",  adoptionPct:18 },
  { id:"r4", version:"v3.1.0", platform:["android","ios"],  status:"archived", date:"2026-04-15", size:"15.2 MB", notes:"Phase 8 Enterprise Layer shipped to mobile.",                       crashRate:"1.1%",  adoptionPct:8  },
  { id:"r5", version:"v3.0.0", platform:["android"],        status:"archived", date:"2026-03-01", size:"14.0 MB", notes:"Initial Capacitor rewrite. Firebase Auth. Feature filtering.",       crashRate:"2.3%",  adoptionPct:3  },
];

const TABLET_RELEASES = [
  { id:"t1", version:"v3.2.0-tablet", platform:["android"], status:"live",     date:"2026-05-28", size:"19.2 MB", notes:"Adaptive layout for 10\" Android tablets. Split-pane navigation.", crashRate:"0.6%", adoptionPct:62 },
  { id:"t2", version:"v3.1.5-tablet", platform:["android"], status:"archived", date:"2026-05-10", size:"17.4 MB", notes:"Tablet UI beta. Single-column fallback on older Android.",          crashRate:"1.2%", adoptionPct:38 },
];

const ANDROID_DEVICES = [
  { model:"Samsung Galaxy S23",   pct:18, os:"Android 13" },
  { model:"OnePlus Nord",         pct:14, os:"Android 12" },
  { model:"Realme 9 Pro",         pct:11, os:"Android 12" },
  { model:"Redmi Note 12",        pct:9,  os:"Android 13" },
  { model:"Motorola G54",         pct:7,  os:"Android 13" },
  { model:"Other",                pct:41, os:"Mixed"       },
];

const IOS_DEVICES = [
  { model:"iPhone 14 Pro",        pct:24, os:"iOS 17" },
  { model:"iPhone 13",            pct:19, os:"iOS 17" },
  { model:"iPhone 12",            pct:15, os:"iOS 16" },
  { model:"iPhone SE (3rd gen)",  pct:10, os:"iOS 16" },
  { model:"Other",                pct:32, os:"Mixed"  },
];

const TABLET_DEVICES = [
  { model:"Samsung Tab S8",       pct:31, os:"Android 13" },
  { model:"Samsung Tab A8",       pct:22, os:"Android 12" },
  { model:"Lenovo Tab P11",       pct:18, os:"Android 12" },
  { model:"Realme Pad X",         pct:13, os:"Android 12" },
  { model:"Other",                pct:16, os:"Mixed"       },
];

const PUSH_STATS = [
  { id:"pn1", title:"Follow-up sent confirmation",    sent:1240, delivered:1198, opened:892,  ctr:"74%", ts:"Realtime"     },
  { id:"pn2", title:"New lead added alert",           sent:318,  delivered:312,  opened:280,  ctr:"90%", ts:"Realtime"     },
  { id:"pn3", title:"Payment received",               sent:87,   delivered:86,   opened:83,   ctr:"97%", ts:"Realtime"     },
  { id:"pn4", title:"Weekly activity summary",        sent:452,  delivered:440,  opened:210,  ctr:"48%", ts:"Every Monday" },
  { id:"pn5", title:"Trial expiry reminder (3 days)", sent:64,   delivered:63,   opened:51,   ctr:"81%", ts:"Triggered"    },
];

const ANDROID_OS = [
  {os:"Android 13", pct:44}, {os:"Android 12", pct:31}, {os:"Android 11", pct:14}, {os:"Android 10", pct:7}, {os:"Other", pct:4},
];
const IOS_OS = [
  {os:"iOS 17", pct:52}, {os:"iOS 16", pct:33}, {os:"iOS 15", pct:11}, {os:"Other", pct:4},
];

const STA_COLORS = { live:"var(--success)", failed:"var(--danger)", archived:"var(--text-faint)", beta:"var(--warning)" };

function PlatformBadge({ platforms }) {
  return (
    <div className="mpc-platform-badges">
      {platforms.includes("android") && <span className="mpc-plat-badge mpc-plat-badge--android">Android</span>}
      {platforms.includes("ios")     && <span className="mpc-plat-badge mpc-plat-badge--ios">iOS</span>}
    </div>
  );
}

function BarRow({ label, pct, color }) {
  return (
    <div className="mpc-os-row">
      <span className="mpc-os-name">{label}</span>
      <div className="mpc-os-bar-track"><div className="mpc-os-bar-fill" style={{width:`${pct}%`,background:color}} /></div>
      <span className="mpc-os-pct">{pct}%</span>
    </div>
  );
}

export default function MobilePlatformCenter({ onNavigate }) {
  const [section, setSection] = useState("android");
  const [devicePlatform, setDevicePlatform] = useState("android");

  React.useEffect(() => { track.event("mobile_platform_viewed"); }, []);

  const liveRelease    = RELEASES.find(r => r.status === "live");
  const liveTablet     = TABLET_RELEASES.find(r => r.status === "live");
  const totalInstalls  = 1247;
  const tabletInstalls = 312;

  const SECTIONS = [
    {id:"android",   label:"Android"},
    {id:"ios",       label:"iOS"},
    {id:"tablet",    label:"Tablet"},
    {id:"releases",  label:"Releases"},
    {id:"push",      label:"Push Notifications"},
  ];

  return (
    <div className="mobile-platform-center page-enter">
      <div className="mpc-header">
        <div>
          <h1 className="mpc-title">Mobile Platform</h1>
          <p className="mpc-subtitle">Android · iOS · Tablet · Releases · Push Notifications — version history, crash rates, adoption, and device breakdown.</p>
        </div>
      </div>

      <div className="mpc-summary-strip">
        {[
          { label:"Android installs", value:totalInstalls.toLocaleString("en-IN"), color:"#4ecdc4"        },
          { label:"Tablet installs",  value:tabletInstalls.toLocaleString("en-IN"),color:"var(--accent)"  },
          { label:"Live version",     value:liveRelease?.version || "—",           color:"var(--success)" },
          { label:"Avg crash rate",   value:"0.4%",                                color:"var(--success)" },
          { label:"Android share",    value:"68%",                                 color:"#4ecdc4"        },
          { label:"iOS share",        value:"32%",                                 color:"#e6edf3"        },
        ].map(s => (
          <div key={s.label} className="mpc-summary-tile">
            <span className="mpc-sv" style={{color:s.color}}>{s.value}</span>
            <span className="mpc-sl">{s.label}</span>
          </div>
        ))}
      </div>

      <div className="mpc-tabs">
        {SECTIONS.map(t => (
          <button key={t.id} className={`mpc-tab${section===t.id?" mpc-tab--active":""}`} onClick={()=>setSection(t.id)}>{t.label}</button>
        ))}
      </div>

      <div className="mpc-content" key={section}>

        {section === "android" && (
          <div className="mpc-platform-section">
            <div className="mpc-ov-top">
              <div className="mpc-ov-card">
                <p className="mpc-ov-label">Version adoption</p>
                {RELEASES.filter(r=>r.status!=="failed").slice(0,3).map(r=>(
                  <div key={r.id} className="mpc-adoption-row">
                    <span className="mpc-adoption-ver">{r.version}</span>
                    <div className="mpc-adoption-bar-track">
                      <div className="mpc-adoption-bar-fill" style={{width:`${r.adoptionPct}%`,background:r.status==="live"?"var(--success)":"rgba(255,255,255,.18)"}} />
                    </div>
                    <span className="mpc-adoption-pct">{r.adoptionPct}%</span>
                  </div>
                ))}
              </div>
              <div className="mpc-ov-card">
                <p className="mpc-ov-label">OS distribution</p>
                {ANDROID_OS.map(o=><BarRow key={o.os} label={o.os} pct={o.pct} color="#4ecdc4" />)}
              </div>
            </div>
            <div className="mpc-ov-card mpc-ov-card--wide">
              <p className="mpc-ov-label">Device breakdown</p>
              {ANDROID_DEVICES.map((d,i)=>(
                <div key={i} className="mpc-device-row">
                  <span className="mpc-device-model">{d.model}</span>
                  <div className="mpc-device-bar-track"><div className="mpc-device-bar-fill" style={{width:`${d.pct}%`,background:"#4ecdc4"}} /></div>
                  <span className="mpc-device-pct">{d.pct}%</span>
                  <span className="mpc-device-os">{d.os}</span>
                </div>
              ))}
            </div>
            <div className="mpc-metrics-row">
              {[
                {label:"Crash rate",    value:"0.4%",  note:"last 30d",    good:true},
                {label:"Avg session",   value:"6m 12s", note:"per user",   good:true},
                {label:"Active daily",  value:"847",    note:"DAU",        good:true},
                {label:"Installs / day",value:"23",     note:"avg rolling",good:true},
              ].map(m=>(
                <div key={m.label} className="mpc-metric-card">
                  <span className="mpc-metric-val" style={{color:m.good?"var(--success)":"var(--danger)"}}>{m.value}</span>
                  <span className="mpc-metric-label">{m.label}</span>
                  <span className="mpc-metric-note">{m.note}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {section === "ios" && (
          <div className="mpc-platform-section">
            <div className="mpc-ov-top">
              <div className="mpc-ov-card">
                <p className="mpc-ov-label">Version adoption</p>
                {RELEASES.filter(r=>r.platform.includes("ios")&&r.status!=="failed").slice(0,3).map(r=>(
                  <div key={r.id} className="mpc-adoption-row">
                    <span className="mpc-adoption-ver">{r.version}</span>
                    <div className="mpc-adoption-bar-track">
                      <div className="mpc-adoption-bar-fill" style={{width:`${r.adoptionPct}%`,background:r.status==="live"?"var(--success)":"rgba(255,255,255,.18)"}} />
                    </div>
                    <span className="mpc-adoption-pct">{r.adoptionPct}%</span>
                  </div>
                ))}
              </div>
              <div className="mpc-ov-card">
                <p className="mpc-ov-label">OS distribution</p>
                {IOS_OS.map(o=><BarRow key={o.os} label={o.os} pct={o.pct} color="#e6edf3" />)}
              </div>
            </div>
            <div className="mpc-ov-card mpc-ov-card--wide">
              <p className="mpc-ov-label">Device breakdown</p>
              {IOS_DEVICES.map((d,i)=>(
                <div key={i} className="mpc-device-row">
                  <span className="mpc-device-model">{d.model}</span>
                  <div className="mpc-device-bar-track"><div className="mpc-device-bar-fill" style={{width:`${d.pct}%`,background:"#e6edf3"}} /></div>
                  <span className="mpc-device-pct">{d.pct}%</span>
                  <span className="mpc-device-os">{d.os}</span>
                </div>
              ))}
            </div>
            <div className="mpc-metrics-row">
              {[
                {label:"Crash rate",    value:"0.3%",  note:"last 30d",   good:true},
                {label:"Avg session",   value:"7m 44s", note:"per user",  good:true},
                {label:"Active daily",  value:"396",    note:"DAU",       good:true},
                {label:"Installs / day",value:"11",     note:"avg rolling",good:true},
              ].map(m=>(
                <div key={m.label} className="mpc-metric-card">
                  <span className="mpc-metric-val" style={{color:m.good?"var(--success)":"var(--danger)"}}>{m.value}</span>
                  <span className="mpc-metric-label">{m.label}</span>
                  <span className="mpc-metric-note">{m.note}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {section === "tablet" && (
          <div className="mpc-platform-section">
            <div className="mpc-ov-top">
              <div className="mpc-ov-card">
                <p className="mpc-ov-label">Tablet releases</p>
                {TABLET_RELEASES.map(r=>(
                  <div key={r.id} className="mpc-adoption-row">
                    <span className="mpc-adoption-ver">{r.version}</span>
                    <div className="mpc-adoption-bar-track">
                      <div className="mpc-adoption-bar-fill" style={{width:`${r.adoptionPct}%`,background:r.status==="live"?"var(--accent)":"rgba(255,255,255,.18)"}} />
                    </div>
                    <span className="mpc-adoption-pct">{r.adoptionPct}%</span>
                  </div>
                ))}
              </div>
              <div className="mpc-ov-card">
                <p className="mpc-ov-label">Tablet device breakdown</p>
                {TABLET_DEVICES.map((d,i)=>(
                  <div key={i} className="mpc-device-row">
                    <span className="mpc-device-model">{d.model}</span>
                    <div className="mpc-device-bar-track"><div className="mpc-device-bar-fill" style={{width:`${d.pct}%`,background:"var(--accent)"}} /></div>
                    <span className="mpc-device-pct">{d.pct}%</span>
                    <span className="mpc-device-os">{d.os}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="mpc-metrics-row">
              {[
                {label:"Tablet installs",  value:"312",  note:"total",      good:true},
                {label:"Crash rate",       value:"0.6%", note:"last 30d",   good:true},
                {label:"Avg session",      value:"11m 8s",note:"per tablet",good:true},
                {label:"Split-pane usage", value:"78%",  note:"of sessions",good:true},
              ].map(m=>(
                <div key={m.label} className="mpc-metric-card">
                  <span className="mpc-metric-val" style={{color:"var(--accent)"}}>{m.value}</span>
                  <span className="mpc-metric-label">{m.label}</span>
                  <span className="mpc-metric-note">{m.note}</span>
                </div>
              ))}
            </div>
            <div className="mpc-tablet-note">
              <span className="mpc-tablet-note-icon">ℹ</span>
              iOS iPad support is planned for v3.3.0 — currently Android tablet only.
            </div>
          </div>
        )}

        {section === "releases" && (
          <div className="mpc-releases-list">
            {RELEASES.map(r => (
              <div key={r.id} className={`mpc-release-row mpc-release-row--${r.status}`}>
                <div className="mpc-release-left">
                  <span className="mpc-release-ver">{r.version}</span>
                  <PlatformBadge platforms={r.platform} />
                  <span className="mpc-release-date">{r.date}</span>
                  <span className="mpc-release-size">{r.size}</span>
                </div>
                <div className="mpc-release-center">
                  <p className="mpc-release-notes">{r.notes}</p>
                </div>
                <div className="mpc-release-right">
                  <span className="mpc-release-status" style={{color:STA_COLORS[r.status],borderColor:STA_COLORS[r.status]+"33"}}>{r.status}</span>
                  <span className="mpc-crash-rate" style={{color:parseFloat(r.crashRate)>2?"var(--danger)":parseFloat(r.crashRate)>1?"var(--warning)":"var(--success)"}}>
                    crash: {r.crashRate}
                  </span>
                  {r.adoptionPct > 0 && <span className="mpc-adoption-badge">{r.adoptionPct}% users</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        {section === "push" && (
          <div className="mpc-push-section">
            <div className="mpc-push-summary">
              {[
                {label:"Total sent",      value:"2,161", color:"var(--accent2)"},
                {label:"Delivered",       value:"2,099", color:"var(--success)"},
                {label:"Opened",          value:"1,516", color:"var(--success)"},
                {label:"Avg CTR",         value:"78%",   color:"var(--accent)"},
              ].map(s=>(
                <div key={s.label} className="mpc-push-stat">
                  <span className="mpc-push-stat-val" style={{color:s.color}}>{s.value}</span>
                  <span className="mpc-push-stat-label">{s.label}</span>
                </div>
              ))}
            </div>
            <div className="mpc-push-list">
              {PUSH_STATS.map(p=>(
                <div key={p.id} className="mpc-push-row">
                  <div className="mpc-push-info">
                    <span className="mpc-push-title">{p.title}</span>
                    <span className="mpc-push-timing">{p.ts}</span>
                  </div>
                  <div className="mpc-push-metrics">
                    <span className="mpc-push-metric"><span className="mpc-push-mv">{p.sent.toLocaleString("en-IN")}</span> sent</span>
                    <span className="mpc-push-metric"><span className="mpc-push-mv">{p.delivered.toLocaleString("en-IN")}</span> delivered</span>
                    <span className="mpc-push-metric"><span className="mpc-push-mv">{p.opened.toLocaleString("en-IN")}</span> opened</span>
                    <span className="mpc-push-ctr" style={{color:parseInt(p.ctr)>=80?"var(--success)":parseInt(p.ctr)>=50?"var(--accent2)":"var(--warning)"}}>{p.ctr} CTR</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
