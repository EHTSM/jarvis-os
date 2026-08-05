import React, { useState, useCallback, useEffect } from "react";
import { track } from "../analytics";
import { getMemoryConflicts, rankMemories } from "../phase20Api";
import { memoryStats } from "../phase18Api";
import "./MemoryIntelligenceCenter.css";

const MEM_KEY = "ooplix_memory_intel_v1";
function _load(k, fb) { try { return JSON.parse(localStorage.getItem(k) || JSON.stringify(fb)); } catch { return fb; } }

// Generic per-type icon — real memory items don't carry a custom icon field,
// so we key off the real `type` returned by the backend instead of fabricating one.
const TYPE_ICONS = {
  entity: "🏢", person: "👤", procedure: "📋", goal: "🎯",
  technical: "🔧", metric: "📊", insight: "💬",
};
function iconForType(type) { return TYPE_ICONS[type] || "🧠"; }

function _daysSince(iso) {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.round(ms / 86_400_000));
}

// Maps a real /p20/memory/rank node → the fields this view renders.
function mapMemoryNode(n) {
  const ageDays = _daysSince(n.updatedAt || n.createdAt);
  return {
    id: n.id,
    icon: iconForType(n.type),
    key: n.key || "untitled",
    type: n.type || "insight",
    importance: n.importance ?? 0,
    confidence: n.confidence ?? 0,
    staleness: ageDays ?? 0,
    ageDays: ageDays ?? 0,
    links: (n.agentIds || []).length,
    usage: n.usageCount ?? 0,
  };
}

// Maps a real /p20/memory/conflicts entry → the gap-row shape this view renders.
// Conflicts (same/near-identical key, diverging values) are the real signal the
// backend can detect today — framed here as knowledge gaps needing review.
function mapConflict(c) {
  const severity = c.valueDivergence >= 80 ? "critical" : c.valueDivergence >= 50 ? "moderate" : "low";
  const dot = severity === "critical" ? "#ff6464" : severity === "moderate" ? "var(--warning)" : "#00dc82";
  return {
    text: `"${c.keyA}" and "${c.keyB}" conflict — ${c.valueDivergence}% value divergence. ${c.recommendation}`,
    severity, dot,
  };
}

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
  const [gaps,    setGaps]    = useState([]);
  const [memories, setMemories] = useState([]);
  const [memLoading, setMemLoading] = useState(true);
  const [apiError, setApiError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([memoryStats(), getMemoryConflicts(), rankMemories({ limit: 100 })])
      .then(([statsRes, conflictRes, rankRes]) => {
        if (cancelled) return;
        if (statsRes) setStats(statsRes);
        const conflicts = conflictRes?.conflicts;
        if (Array.isArray(conflicts)) setGaps(conflicts.map(mapConflict));
        const ranked = rankRes?.ranked;
        if (Array.isArray(ranked)) setMemories(ranked.map(mapMemoryNode));
      })
      .catch(err => { if (!cancelled) setApiError(err.message); })
      .finally(() => { if (!cancelled) setMemLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const totalMem  = stats?.total ?? memories.length;
  const avgImp    = memories.length ? Math.round(memories.reduce((s,m) => s + m.importance, 0) / memories.length) : 0;
  const avgConf   = memories.length ? Math.round(memories.reduce((s,m) => s + m.confidence, 0) / memories.length) : 0;
  const stale     = memories.filter(m => m.staleness > 20).length;
  const gapCount  = gaps.filter(g => g.severity === "critical").length;

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
            {memLoading ? (
              <div style={{padding:16,color:"var(--text-faint)",fontSize:13}}>Loading memories…</div>
            ) : memories.length === 0 ? (
              <div style={{padding:16,color:"var(--text-faint)",fontSize:13}}>No memories recorded yet.</div>
            ) : memories.map(m => (
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
            {memories.length === 0 ? (
              <div style={{padding:16,color:"var(--text-faint)",fontSize:13}}>{memLoading ? "Loading…" : "No memories recorded yet."}</div>
            ) : memories.map(m => (
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
            {memories.length === 0 ? (
              <div style={{padding:16,color:"var(--text-faint)",fontSize:13}}>{memLoading ? "Loading…" : "No memories recorded yet."}</div>
            ) : [...memories].sort((a,b) => b.staleness - a.staleness).map(m => (
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
          <div className="mic-panel-title">Knowledge Gaps &amp; Conflicts</div>
          {memLoading ? (
            <div style={{padding:16,color:"var(--text-faint)",fontSize:13}}>Loading…</div>
          ) : gaps.length === 0 ? (
            <div style={{padding:16,color:"var(--text-faint)",fontSize:13}}>No conflicting memory entries detected.</div>
          ) : gaps.map((g,i) => (
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
