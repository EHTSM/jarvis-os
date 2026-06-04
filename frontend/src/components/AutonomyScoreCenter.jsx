import React, { useState } from "react";
import { track } from "../analytics";
import "./AutonomyScoreCenter.css";

const SCORES = [
  { icon:"⚙️", name:"Automation",   score:82, prev:76, color:"#00dc82",  circumference:188.5 },
  { icon:"🧠", name:"Memory",       score:74, prev:71, color:"var(--accent)", circumference:188.5 },
  { icon:"⚡", name:"Execution",    score:91, prev:88, color:"var(--accent2)", circumference:188.5 },
  { icon:"📚", name:"Learning",     score:67, prev:60, color:"var(--warning)", circumference:188.5 },
  { icon:"🤝", name:"Coordination", score:78, prev:78, color:"#7c6fff",   circumference:188.5 },
];

const WEEKLY_TREND = [
  { week:"W-5", score:61 },
  { week:"W-4", score:65 },
  { week:"W-3", score:70 },
  { week:"W-2", score:74 },
  { week:"W-1", score:78 },
  { week:"Now", score:82 },
];

const OPPS = [
  { icon:"🚀", title:"Automate approval queue",      desc:"14 low-risk actions still require human sign-off — safe to automate.",    gain:"+8% auto" },
  { icon:"🧠", title:"Stale memory refresh jobs",    desc:"7 memory nodes >30d old reduce agent accuracy by estimated 12%.",         gain:"+6% mem"  },
  { icon:"⚡", title:"Parallel tool execution",      desc:"3 workflows call tools sequentially — parallelizing saves ~40% latency.", gain:"+5% exec" },
  { icon:"📚", title:"Cross-agent lesson sharing",   desc:"Sales agent lessons not propagated to Support agent — share now.",        gain:"+4% learn"},
  { icon:"🤝", title:"Broadcast coordination bus",   desc:"Agents use point-to-point comms — a shared event bus reduces lag.",       gain:"+3% coord"},
];

function trendLabel(cur, prev) {
  const d = cur - prev;
  if (d > 0) return { cls:"asc-trend-up",   txt:`↑ +${d} vs last week` };
  if (d < 0) return { cls:"asc-trend-down", txt:`↓ ${d} vs last week` };
  return       { cls:"asc-trend-flat",  txt:`→ no change` };
}

const R = 30; // ring radius
const CIR = 2 * Math.PI * R;

export default function AutonomyScoreCenter({ onNavigate }) {
  const [tab, setTab] = useState("scores");
  const overallScore = Math.round(SCORES.reduce((s,x) => s + x.score, 0) / SCORES.length);
  const humanPct = 100 - overallScore;
  const autoPct  = overallScore;

  // donut values
  const total  = 2 * Math.PI * 40; // r=40
  const autoOffset  = total * (1 - autoPct / 100);
  const humanOffset = total * (1 - humanPct / 100);
  const humanDash   = (humanPct / 100) * total;
  const autoDash    = (autoPct  / 100) * total;

  return (
    <div className="asc">
      <div className="asc-header">
        <div>
          <h1 className="asc-title">Autonomy Score Center</h1>
          <p className="asc-subtitle">Measure autonomous execution vs. human dependency across all dimensions.</p>
        </div>
        <div style={{padding:"12px 20px",background:"var(--surface-base)",border:"1px solid var(--border)",borderRadius:"var(--radius)",textAlign:"center"}}>
          <div style={{fontSize:32,fontWeight:800,color:"#00dc82"}}>{overallScore}</div>
          <div style={{fontSize:11,fontWeight:700,color:"var(--text-faint)",textTransform:"uppercase",letterSpacing:"0.06em"}}>Autonomy Score</div>
        </div>
      </div>

      <div className="asc-stats">
        <div className="asc-stat"><span className="asc-stat-val" style={{color:"#00dc82"}}>{overallScore}%</span><span className="asc-stat-lbl">Overall</span></div>
        <div className="asc-stat"><span className="asc-stat-val" style={{color:"var(--accent)"}}>{autoPct}%</span><span className="asc-stat-lbl">Autonomous</span></div>
        <div className="asc-stat"><span className="asc-stat-val" style={{color:"var(--warning)"}}>{humanPct}%</span><span className="asc-stat-lbl">Human Dep.</span></div>
        <div className="asc-stat"><span className="asc-stat-val" style={{color:"var(--accent2)"}}>+{overallScore - WEEKLY_TREND[0].score}pts</span><span className="asc-stat-lbl">5-wk gain</span></div>
        <div className="asc-stat"><span className="asc-stat-val" style={{color:"var(--text)"}}>{OPPS.length}</span><span className="asc-stat-lbl">Opportunities</span></div>
      </div>

      <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
        {["scores","split","trend","opportunities"].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding:"7px 14px", border:"1px solid var(--border)", borderRadius:"var(--radius-pill)",
            background: tab===t ? "var(--accent)" : "var(--surface-raised)",
            color: tab===t ? "#06080e" : "var(--text-dim)", fontSize:12, fontWeight:700, cursor:"pointer",
            fontFamily:"inherit", textTransform:"capitalize"
          }}>{t}</button>
        ))}
      </div>

      {tab === "scores" && (
        <div className="asc-score-grid">
          {SCORES.map(s => {
            const filled = (s.score / 100) * CIR;
            const gap    = CIR - filled;
            const trend  = trendLabel(s.score, s.prev);
            return (
              <div key={s.name} className="asc-score-card">
                <div className="asc-score-icon">{s.icon}</div>
                <div className="asc-score-name">{s.name}</div>
                <div className="asc-score-ring">
                  <svg viewBox="0 0 80 80">
                    <circle className="asc-score-ring-bg" cx="40" cy="40" r={R} />
                    <circle
                      className="asc-score-ring-fill"
                      cx="40" cy="40" r={R}
                      stroke={s.color}
                      strokeDasharray={`${filled} ${gap}`}
                      strokeDashoffset="0"
                    />
                  </svg>
                  <div className="asc-score-val">{s.score}</div>
                </div>
                <div className={`asc-score-trend ${trend.cls}`}>{trend.txt}</div>
              </div>
            );
          })}
        </div>
      )}

      {tab === "split" && (
        <div className="asc-panel">
          <div className="asc-panel-title">Human vs. Autonomous Execution</div>
          <div className="asc-donut-wrap">
            <svg className="asc-donut-svg" viewBox="0 0 100 100">
              <circle className="asc-donut-bg"    cx="50" cy="50" r="40" />
              <circle className="asc-donut-human" cx="50" cy="50" r="40"
                strokeDasharray={`${humanDash.toFixed(1)} ${(total-humanDash).toFixed(1)}`}
                strokeDashoffset="0"
              />
              <circle className="asc-donut-auto"  cx="50" cy="50" r="40"
                strokeDasharray={`${autoDash.toFixed(1)} ${(total-autoDash).toFixed(1)}`}
                strokeDashoffset={`-${humanDash.toFixed(1)}`}
              />
            </svg>
            <div className="asc-donut-legend">
              <div className="asc-legend-row">
                <div className="asc-legend-dot" style={{background:"#00dc82"}} />
                <span className="asc-legend-lbl">Autonomous</span>
                <span className="asc-legend-val">{autoPct}%</span>
              </div>
              <div className="asc-legend-row">
                <div className="asc-legend-dot" style={{background:"var(--warning)"}} />
                <span className="asc-legend-lbl">Human Dependency</span>
                <span className="asc-legend-val">{humanPct}%</span>
              </div>
              <div style={{fontSize:11,color:"var(--text-faint)",marginTop:8,lineHeight:1.5}}>
                Target: 90% autonomous by end of Q3.<br/>
                Current gap: {90 - autoPct} points to target.
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "trend" && (
        <div className="asc-panel">
          <div className="asc-panel-title">Weekly Autonomy Score Trend</div>
          <div className="asc-trend-chart">
            {WEEKLY_TREND.map((w,i) => (
              <div key={i} className="asc-trend-row">
                <div className="asc-trend-week">{w.week}</div>
                <div className="asc-trend-bar-track">
                  <div className="asc-trend-bar-fill" style={{width:w.score+"%"}} />
                </div>
                <div className="asc-trend-val">{w.score}%</div>
              </div>
            ))}
          </div>
          <div style={{fontSize:12,color:"var(--text-faint)",marginTop:8}}>
            5-week gain: +{WEEKLY_TREND[WEEKLY_TREND.length-1].score - WEEKLY_TREND[0].score} points · Avg weekly improvement: +{((WEEKLY_TREND[WEEKLY_TREND.length-1].score - WEEKLY_TREND[0].score) / (WEEKLY_TREND.length-1)).toFixed(1)} pts/week
          </div>
        </div>
      )}

      {tab === "opportunities" && (
        <div className="asc-panel">
          <div className="asc-panel-title">Improvement Opportunities</div>
          {OPPS.map((o,i) => (
            <div key={i} className="asc-opp-row">
              <span className="asc-opp-icon">{o.icon}</span>
              <div className="asc-opp-info">
                <div className="asc-opp-title">{o.title}</div>
                <div className="asc-opp-desc">{o.desc}</div>
              </div>
              <span className="asc-opp-gain">{o.gain}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
