import React, { useState, useCallback, useEffect } from "react";
import { track } from "../analytics";
import { getMemoryIntelligence, getMemoryInsights } from "../phase20Api";
import { memoryStats } from "../phase18Api";
import "./MemoryIntelligenceCenter.css";

const MEM_KEY = "ooplix_memory_intel_v1";
function _load(k, fb) { try { return JSON.parse(localStorage.getItem(k) || JSON.stringify(fb)); } catch { return fb; } }

const SEED_MEMORIES = [
  { id: "m1", icon: "🏢", key: "Company Profile",   type: "entity",    importance: 98, confidence: 95, staleness: 2,  ageDays: 3,  links: 12, usage: 87 },
  { id: "m2", icon: "👤", key: "CEO Preferences",   type: "person",    importance: 91, confidence: 88, staleness: 8,  ageDays: 7,  links: 5,  usage: 44 },
  { id: "m3", icon: "📋", key: "Sales Playbook",    type: "procedure", importance: 85, confidence: 92, staleness: 15, ageDays: 14, links: 8,  usage: 62 },
  { id: "m4", icon: "🎯", key: "Q3 Goals",          type: "goal",      importance: 94, confidence: 78, staleness: 30, ageDays: 21, links: 6,  usage: 38 },
  { id: "m5", icon: "🔧", key: "Tech Stack",        type: "technical", importance: 72, confidence: 97, staleness: 5,  ageDays: 2,  links: 15, usage: 91 },
  { id: "m6", icon: "📊", key: "MRR Benchmarks",   type: "metric",    importance: 88, confidence: 60, staleness: 45, ageDays: 30, links: 3,  usage: 22 },
  { id: "m7", icon: "💬", key: "Customer Feedback", type: "insight",   importance: 79, confidence: 82, staleness: 10, ageDays: 5,  links: 9,  usage: 55 },
];

const GAPS = [
  { text: "No pricing intelligence stored for top 3 competitors", severity: "critical", dot: "#ff6464" },
  { text: "Customer persona data is 45+ days stale", severity: "critical", dot: "#ff6464" },
  { text: "Product roadmap not in memory — agents guessing", severity: "moderate", dot: "var(--warning)" },
  { text: "ICP (Ideal Customer Profile) only partially defined", severity: "moderate", dot: "var(--warning)" },
  { text: "Team org chart missing for new hires", severity: "low", dot: "#00dc82" },
];

const REL_NODES = [
  { icon: "🏢", name: "Company",   links: 14 },
  { icon: "👤", name: "People",    links: 22 },
  { icon: "🎯", name: "Goals",     links: 8  },
  { icon: "📋", name: "Playbooks", links: 11 },
  { icon: "🔧", name: "Tech",      links: 18 },
  { icon: "📊", name: "Metrics",   links: 9  },
  { icon: "💬", name: "Insights",  links: 16 },
  { icon: "🤖", name: "Agents",    links: 31 },
];

function score(val) {
  if (val >= 80) return "high";
  if (val >= 50) return "med";
  return "low";
}

export default function MemoryIntelligenceCenter({ onNavigate }) {
  const [tab,     setTab]     = useState("overview");
  const [stats,   setStats]   = useState(null);
  const [insights, setInsights] = useState([]);
  const [apiError, setApiError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([memoryStats(), getMemoryIntelligence(), getMemoryInsights()])
      .then(([statsRes, intelRes, insightRes]) => {
        if (cancelled) return;
        if (statsRes) setStats(statsRes);
        const ins = insightRes?.insights || intelRes?.patterns || [];
        if (Array.isArray(ins) && ins.length > 0) setInsights(ins);
      })
      .catch(err => { if (!cancelled) setApiError(err.message); });
    return () => { cancelled = true; };
  }, []);

  const totalMem  = stats?.total ?? SEED_MEMORIES.length;
  const avgImp    = Math.round(SEED_MEMORIES.reduce((s,m) => s + m.importance, 0) / totalMem);
  const avgConf   = Math.round(SEED_MEMORIES.reduce((s,m) => s + m.confidence, 0) / totalMem);
  const stale     = SEED_MEMORIES.filter(m => m.staleness > 20).length;
  const gapCount  = GAPS.filter(g => g.severity === "critical").length;

  const TABS = ["overview","relationships","quality","decay","gaps"];

  return (
    <div className="mic">
      {apiError && <div className="ac-api-banner ac-api-banner--error">⚠ Live memory intelligence unavailable — showing cached data ({apiError})</div>}
      <div className="mic-header">
        <div>
          <h1 className="mic-title">Memory Intelligence</h1>
          <p className="mic-subtitle">Importance scoring, confidence, staleness detection and knowledge gap analysis.</p>
        </div>
        <div style={{display:"flex",gap:8}}>
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding:"7px 14px", border:"1px solid var(--border)", borderRadius:"var(--radius-pill)",
              background: tab===t ? "var(--accent)" : "var(--surface-raised)",
              color: tab===t ? "#06080e" : "var(--text-dim)", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit",
              textTransform:"capitalize"
            }}>{t}</button>
          ))}
        </div>
      </div>

      <div className="mic-stats">
        <div className="mic-stat"><span className="mic-stat-val">{totalMem}</span><span className="mic-stat-lbl">Memories</span></div>
        <div className="mic-stat"><span className="mic-stat-val" style={{color:"var(--accent)"}}>{avgImp}%</span><span className="mic-stat-lbl">Avg Importance</span></div>
        <div className="mic-stat"><span className="mic-stat-val" style={{color:"#00dc82"}}>{avgConf}%</span><span className="mic-stat-lbl">Avg Confidence</span></div>
        <div className="mic-stat"><span className="mic-stat-val" style={{color:"var(--warning)"}}>{stale}</span><span className="mic-stat-lbl">Stale</span></div>
        <div className="mic-stat"><span className="mic-stat-val" style={{color:"#ff6464"}}>{gapCount}</span><span className="mic-stat-lbl">Critical Gaps</span></div>
      </div>

      {tab === "overview" && (
        <div className="mic-grid">
          <div className="mic-panel mic-panel-full">
            <div className="mic-panel-title">All Memories — Importance × Confidence</div>
            {SEED_MEMORIES.map(m => (
              <div key={m.id} className="mic-memory-row">
                <span className="mic-memory-icon">{m.icon}</span>
                <div className="mic-memory-info">
                  <div className="mic-memory-key">{m.key}</div>
                  <div className="mic-memory-meta">{m.type} · {m.links} links · used {m.usage}x · {m.ageDays}d old</div>
                </div>
                <div className="mic-memory-scores">
                  <span className={`mic-score-badge mic-score-${score(m.importance)}`}>IMP {m.importance}</span>
                  <span className={`mic-score-badge mic-score-${score(m.confidence)}`}>CONF {m.confidence}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "relationships" && (
        <div className="mic-panel">
          <div className="mic-panel-title">Memory Relationship Map</div>
          <div className="mic-rel-map">
            {REL_NODES.map(n => (
              <div key={n.name} className="mic-rel-node">
                <div className="mic-rel-node-icon">{n.icon}</div>
                <div className="mic-rel-node-name">{n.name}</div>
                <div className="mic-rel-node-links">{n.links} links</div>
              </div>
            ))}
          </div>
          <div style={{fontSize:12,color:"var(--text-faint)",marginTop:8}}>
            Total edges: {REL_NODES.reduce((s,n) => s+n.links, 0)} · Avg degree: {(REL_NODES.reduce((s,n) => s+n.links, 0)/REL_NODES.length).toFixed(1)}
          </div>
        </div>
      )}

      {tab === "quality" && (
        <div className="mic-panel">
          <div className="mic-panel-title">Memory Quality Scores</div>
          <div className="mic-bar-row">
            {SEED_MEMORIES.map(m => (
              <div key={m.id} className="mic-bar-row">
                <div className="mic-bar-label"><span>{m.key}</span><span>I:{m.importance} C:{m.confidence}</span></div>
                <div className="mic-bar-track">
                  <div className="mic-bar-fill" style={{ width: m.importance + "%", background: m.importance>=80?"#00dc82":m.importance>=50?"var(--warning)":"#ff6464" }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "decay" && (
        <div className="mic-panel">
          <div className="mic-panel-title">Memory Staleness (days without refresh)</div>
          <div className="mic-decay-list">
            {[...SEED_MEMORIES].sort((a,b) => b.staleness - a.staleness).map(m => (
              <div key={m.id} className="mic-decay-item">
                <span style={{fontSize:16}}>{m.icon}</span>
                <span className="mic-decay-name">{m.key}</span>
                <span className="mic-decay-age">{m.staleness}d</span>
                <div className="mic-decay-bar">
                  <div className="mic-decay-fill" style={{ width: Math.min(m.staleness*2, 100)+"%", background: m.staleness>30?"#ff6464":m.staleness>15?"var(--warning)":"#00dc82" }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "gaps" && (
        <div className="mic-panel">
          <div className="mic-panel-title">Knowledge Gaps</div>
          {GAPS.map((g,i) => (
            <div key={i} className="mic-gap-row">
              <div className="mic-gap-dot" style={{background:g.dot}} />
              <span className="mic-gap-text">{g.text}</span>
              <span className={`mic-gap-severity mic-gap-${g.severity}`}>{g.severity}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
