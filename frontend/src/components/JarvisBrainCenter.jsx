import React, { useState, useEffect } from "react";
import { track } from "../analytics";
import { cycleStats } from "../phase18Api";
import { getAutonomyStatus } from "../phase20Api";
import "./JarvisBrainCenter.css";

const FLOW_NODES = [
  { icon: "🎯", label: "Goal",        key: "goal"       },
  { icon: "🗺️", label: "Planning",    key: "planning"   },
  { icon: "🧠", label: "Memory",      key: "memory"     },
  { icon: "🤖", label: "Agents",      key: "agents"     },
  { icon: "🔧", label: "Tools",       key: "tools"      },
  { icon: "⚡", label: "Execution",   key: "execution"  },
  { icon: "📚", label: "Learning",    key: "learning"   },
  { icon: "🚀", label: "Improvement", key: "improvement"},
];

const GOALS = [
  { icon: "💰", name: "Grow MRR to $50K",          pct: 62, status: "active"   },
  { icon: "🤝", name: "Close 10 enterprise deals",  pct: 40, status: "active"   },
  { icon: "📣", name: "Launch SEO content engine",  pct: 88, status: "active"   },
  { icon: "🔧", name: "Reduce infra cost by 30%",   pct: 15, status: "planning" },
  { icon: "🎧", name: "Achieve <2h support SLA",    pct: 0,  status: "queued"   },
];

const REASONING = [
  { ts: "now",   text: "Evaluating lead score for Acme Corp — confidence 87%. Routing to Sales Agent." },
  { ts: "1m",    text: "Memory node 'Sales Playbook' retrieved. Staleness: 5 days. Confidence: 92%." },
  { ts: "3m",    text: "Planning sub-goals for Q3 MRR target. Breaking into 3 milestones." },
  { ts: "7m",    text: "Research agent dispatched to analyze competitor pricing. ETA: 40s." },
  { ts: "12m",   text: "Content batch scheduled: 5 blog posts, 3 newsletters. Queued for Content Agent." },
];

const COORD = [
  { from: "Jarvis",   to: "Sales",     msg: "Route Acme Corp lead — score 87",    ts: "just now" },
  { from: "Sales",    to: "Memory",    msg: "Lookup: Acme Corp contact history",   ts: "2m ago"   },
  { from: "Research", to: "Jarvis",    msg: "Competitor pricing report ready",     ts: "8m ago"   },
  { from: "Jarvis",   to: "Content",   msg: "Generate blog: AI in SaaS growth",    ts: "15m ago"  },
  { from: "DevOps",   to: "Jarvis",    msg: "Infra alert resolved — cost -12%",    ts: "22m ago"  },
];

const LOOPS = [
  { icon: "🔄", name: "Goal → Learn Loop",        desc: "Execution outcomes feed back into goal refinement.",     count: 142 },
  { icon: "🧠", name: "Memory → Accuracy Loop",   desc: "Agent errors trigger memory quality improvement.",       count: 38  },
  { icon: "📊", name: "Performance → Prompt Loop",desc: "Poor outputs trigger automatic prompt optimization.",    count: 91  },
  { icon: "🚦", name: "Failure → Recovery Loop",  desc: "Failed tasks are retried with adjusted context.",        count: 17  },
];

export default function JarvisBrainCenter({ onNavigate }) {
  const [activeNode, setActiveNode] = useState("execution");
  const [tick,       setTick]       = useState(0);
  const [liveStats,  setLiveStats]  = useState(null);

  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 2800);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const idx = tick % FLOW_NODES.length;
    setActiveNode(FLOW_NODES[idx].key);
  }, [tick]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([cycleStats(), getAutonomyStatus()])
      .then(([statsRes, statusRes]) => {
        if (!cancelled) setLiveStats({ ...statsRes, ...statusRes });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const totalRuns   = liveStats?.totalCycles ?? liveStats?.totalRuns ?? 1847;
  const activeGoals = GOALS.filter(g => g.status === "active").length;
  const loopCycles  = liveStats?.totalCycles ?? LOOPS.reduce((s,l) => s + l.count, 0);

  return (
    <div className="jbc">
      <div className="jbc-header">
        <div>
          <h1 className="jbc-title">Jarvis Brain Center</h1>
          <p className="jbc-subtitle">Live visualization of goals, planning, memory, agents, tools, execution and learning loops.</p>
        </div>
        <div className="jbc-live-badge">
          <div className="jbc-live-dot" />
          LIVE
        </div>
      </div>

      <div className="jbc-stats">
        <div className="jbc-stat"><span className="jbc-stat-val" style={{color:"var(--accent)"}}>{activeGoals}</span><span className="jbc-stat-lbl">Active Goals</span></div>
        <div className="jbc-stat"><span className="jbc-stat-val" style={{color:"#00dc82"}}>{totalRuns}</span><span className="jbc-stat-lbl">Total Runs</span></div>
        <div className="jbc-stat"><span className="jbc-stat-val" style={{color:"var(--accent2)"}}>{loopCycles}</span><span className="jbc-stat-lbl">Loop Cycles</span></div>
        <div className="jbc-stat"><span className="jbc-stat-val" style={{color:"var(--warning)"}}>{COORD.length}</span><span className="jbc-stat-lbl">Coord Events</span></div>
        <div className="jbc-stat"><span className="jbc-stat-val" style={{color:"#00dc82"}}>91%</span><span className="jbc-stat-lbl">Brain Health</span></div>
      </div>

      <div className="jbc-flow">
        <div className="jbc-flow-title">Brain Activity Flow</div>
        <div className="jbc-flow-nodes">
          {FLOW_NODES.map((n, i) => (
            <React.Fragment key={n.key}>
              <div className="jbc-flow-node">
                <div className={`jbc-flow-circle ${activeNode === n.key ? "pulsing" : ""}`}>{n.icon}</div>
                <div className="jbc-flow-label">{n.label}</div>
              </div>
              {i < FLOW_NODES.length - 1 && <div className="jbc-flow-arrow">→</div>}
            </React.Fragment>
          ))}
        </div>
      </div>

      <div className="jbc-grid">
        <div className="jbc-panel">
          <div className="jbc-panel-title">Active Goals</div>
          {GOALS.map((g,i) => (
            <div key={i} className="jbc-goal-row">
              <span className="jbc-goal-icon">{g.icon}</span>
              <div className="jbc-goal-info">
                <div className="jbc-goal-name">{g.name}</div>
                <div className="jbc-goal-progress-row">
                  <div className="jbc-goal-bar"><div className="jbc-goal-fill" style={{width:g.pct+"%"}} /></div>
                  <span className="jbc-goal-pct">{g.pct}%</span>
                </div>
              </div>
              <span className={`jbc-goal-status jbc-status-${g.status}`}>{g.status}</span>
            </div>
          ))}
        </div>

        <div className="jbc-panel">
          <div className="jbc-panel-title">Reasoning Chains</div>
          {REASONING.map((r,i) => (
            <div key={i} className="jbc-reasoning-row">
              <span className="jbc-reasoning-ts">{r.ts}</span>
              <span className="jbc-reasoning-text">{r.text}</span>
            </div>
          ))}
        </div>

        <div className="jbc-panel">
          <div className="jbc-panel-title">Coordination Events</div>
          {COORD.map((c,i) => (
            <div key={i} className="jbc-coord-row">
              <span className="jbc-coord-from">{c.from}</span>
              <span className="jbc-coord-arrow">→</span>
              <span className="jbc-coord-to">{c.to}</span>
              <span className="jbc-coord-msg">{c.msg}</span>
              <span className="jbc-coord-ts">{c.ts}</span>
            </div>
          ))}
        </div>

        <div className="jbc-panel">
          <div className="jbc-panel-title">Learning Loops</div>
          {LOOPS.map((l,i) => (
            <div key={i} className="jbc-loop-row">
              <span className="jbc-loop-icon">{l.icon}</span>
              <div className="jbc-loop-info">
                <div className="jbc-loop-name">{l.name}</div>
                <div className="jbc-loop-desc">{l.desc}</div>
              </div>
              <span className="jbc-loop-count">{l.count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
