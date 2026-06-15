import React, { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import "./ExecutiveDashboard.css";
import PageHeader from "./PageHeader";
import WorkflowNav from "./WorkflowNav";

// ── Animation presets ────────────────────────────────────────────────
const FADE_UP = { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 } };
const fadeUp  = (delay = 0) => ({ ...FADE_UP, transition: { duration: 0.35, delay } });

// ── Fallback / seed data ─────────────────────────────────────────────
const SEED_MISSIONS = [
  { id: "m1", objective: "Grow MRR to $50K via enterprise outreach campaign",  status: "active",   priority: "high",   pct: 62, lastActivity: "2m ago"  },
  { id: "m2", objective: "Close Q3 enterprise pipeline — 10 target accounts",   status: "active",   priority: "high",   pct: 40, lastActivity: "7m ago"  },
  { id: "m3", objective: "Launch SEO content engine — 100 articles by Aug",     status: "active",   priority: "medium", pct: 88, lastActivity: "12m ago" },
  { id: "m4", objective: "Reduce infrastructure spend by 30% via rightsizing",  status: "planning", priority: "medium", pct: 15, lastActivity: "1h ago"  },
  { id: "m5", objective: "Achieve sub-2h customer support SLA at scale",        status: "queued",   priority: "low",    pct: 0,  lastActivity: "3h ago"  },
];

const SEED_RECOMMENDATIONS = [
  { objective: "Accelerate enterprise pipeline outreach",         rationale: "Low pipeline velocity detected — only 3 touches/week avg. Increasing cadence to 7 projected to close 2 additional deals.", confidence: 84 },
  { objective: "Trigger automated SEO content burst",             rationale: "Content velocity stalled at 60% of target. Dispatching Content Agent batch to close gap before quarter end.",            confidence: 79 },
  { objective: "Initiate infra rightsizing for compute clusters", rationale: "CPU utilization consistently below 40%. Rightsizing 4 clusters projected to save $1,200/mo.",                           confidence: 91 },
];

function computeRisks({ errorRate, deploySuccess, missions }) {
  const risks = [];
  if (errorRate !== null && errorRate > 3) {
    risks.push({ level: "high",   desc: `Error rate at ${errorRate.toFixed(1)}% — exceeds 3% threshold. Investigate API layer and agent error handlers.` });
  } else {
    risks.push({ level: "low",    desc: "Error rate within acceptable bounds. No immediate action required." });
  }
  if (deploySuccess !== null && deploySuccess < 90) {
    risks.push({ level: "high",   desc: `Deployment success rate dropped to ${deploySuccess.toFixed(0)}%. Review recent pipeline failures and rollback strategy.` });
  } else {
    risks.push({ level: "medium", desc: "Deployment success rate is healthy but trending slightly downward. Monitor next 3 deployments." });
  }
  const overdue = missions.filter(m => m.status === "active" && m.pct < 20).length;
  if (overdue > 0) {
    risks.push({ level: "medium", desc: `${overdue} active mission${overdue > 1 ? "s" : ""} with under 20% progress. Risk of missing quarterly targets.` });
  } else {
    risks.push({ level: "low",    desc: "All active missions are progressing above 20%. Strategic momentum on track." });
  }
  return risks.slice(0, 3);
}

// ── Sub-components ───────────────────────────────────────────────────

function StatCard({ value, label, sub, colorClass }) {
  return (
    <div className={`ed-stat-card ${colorClass ? `ed-stat-card--${colorClass}` : ""}`}>
      <div className={`ed-stat-value ${colorClass ? `ed-stat-value--${colorClass}` : ""}`}>{value}</div>
      <div className="ed-stat-label">{label}</div>
      {sub && <div className="ed-stat-sub">{sub}</div>}
    </div>
  );
}

function Badge({ status }) {
  const cls = `ed-badge ed-badge--${status}`;
  return <span className={cls}>{status}</span>;
}

function PriorityBadge({ priority }) {
  return <span className={`ed-badge ed-badge--${priority}`}>{priority}</span>;
}

function ProgressBar({ pct }) {
  return (
    <div className="ed-progress-bar">
      <div className="ed-progress-bar__track">
        <div className="ed-progress-bar__fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="ed-progress-bar__pct">{pct}%</div>
    </div>
  );
}

function RecItem({ item }) {
  return (
    <div className="ed-rec-item">
      <div className="ed-rec-item__obj">{item.objective}</div>
      <div className="ed-rec-item__rationale">{item.rationale}</div>
      <div className="ed-rec-item__footer">
        <span className="ed-rec-item__confidence">Confidence: {item.confidence}%</span>
      </div>
    </div>
  );
}

function RiskItem({ risk }) {
  const modifier = risk.level === "medium" ? "ed-risk-item--medium" : risk.level === "low" ? "ed-risk-item--low" : "";
  return (
    <div className={`ed-risk-item ${modifier}`}>
      <div className="ed-risk-item__body">
        <PriorityBadge priority={risk.level} />
        <div className="ed-risk-item__desc">{risk.desc}</div>
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────

function fmt(val, fallback = "—") {
  if (val === null || val === undefined) return fallback;
  return val;
}

function pct(val, fallback = "—") {
  if (val === null || val === undefined) return fallback;
  return `${Number(val).toFixed(0)}%`;
}

function timeStr() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// ── Main component ───────────────────────────────────────────────────

export default function ExecutiveDashboard({ onNavigate }) {
  const [lastRefresh, setLastRefresh]   = useState(timeStr());

  // Mission status
  const [missions,    setMissions]      = useState(SEED_MISSIONS);

  // Engineering throughput
  const [cycleStats,  setCycleStats]    = useState(null);

  // Runtime health
  const [healthData,  setHealthData]    = useState(null);

  // Recommendations
  const [recs,        setRecs]          = useState(SEED_RECOMMENDATIONS);

  // Improvement metrics
  const [impMetrics,  setImpMetrics]    = useState(null);

  // ── Fetch helpers ──────────────────────────────────────────────────

  const fetchAll = useCallback(async () => {
    const safe = async (url, setter, transform) => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(res.status);
        const data = await res.json();
        setter(transform ? transform(data) : data);
      } catch (_) {
        // leave existing / seed state intact
      }
    };

    // Mission status
    safe("/metrics/dashboard", data => {
      if (data?.missions && Array.isArray(data.missions)) {
        setMissions(data.missions.slice(0, 5));
      }
    });

    // Engineering throughput (p18)
    safe("/p18/cycles/stats", data => {
      setCycleStats({
        tasksCompleted:  data?.tasksCompleted  ?? data?.completedToday ?? null,
        deploySuccess:   data?.deploySuccess   ?? data?.deploymentSuccessRate ?? null,
        avgCycleTime:    data?.avgCycleTime    ?? data?.avgDurationSec ?? null,
        agentUtilization:data?.agentUtilization ?? data?.utilization ?? null,
      });
    });

    // Runtime health
    safe("/metrics/errors/rate", data => {
      setHealthData(prev => ({ ...prev, errorRate: data?.rate ?? data?.errorRate ?? null }));
    });

    safe("/metrics/health", data => {
      setHealthData(prev => ({
        ...prev,
        cpu:           data?.cpu            ?? null,
        memory:        data?.memory         ?? null,
        activeAgents:  data?.activeAgents   ?? null,
        lastDeploy:    data?.lastDeploy     ?? null,
        uptime:        data?.uptime         ?? null,
      }));
    });

    // Recommendations (p27 primary, p20 fallback)
    try {
      const r27 = await fetch("/p27/planning/recommend");
      if (r27.ok) {
        const d27 = await r27.json();
        if (Array.isArray(d27?.recommendations) && d27.recommendations.length > 0) {
          setRecs(d27.recommendations.slice(0, 3).map(r => ({
            objective:  r.nextObjective ?? r.objective ?? "—",
            rationale:  r.rationale     ?? r.reasoning ?? "",
            confidence: r.confidence    ?? r.score     ?? 0,
          })));
        } else {
          throw new Error("empty");
        }
      } else {
        throw new Error("not ok");
      }
    } catch (_) {
      try {
        const r20 = await fetch("/p20/improve/recommendations");
        if (r20.ok) {
          const d20 = await r20.json();
          if (Array.isArray(d20) && d20.length > 0) {
            setRecs(d20.slice(0, 3).map(r => ({
              objective:  r.title       ?? r.objective ?? "—",
              rationale:  r.description ?? r.rationale ?? "",
              confidence: r.score       ?? r.confidence ?? 0,
            })));
          }
        }
      } catch (_) {
        // keep seed recs
      }
    }

    // Improvement metrics
    safe("/p27/improvement/metrics", data => {
      setImpMetrics({
        predictionAccuracy:      data?.predictionAccuracy      ?? data?.accuracy      ?? null,
        recommendationAcceptance:data?.recommendationAcceptance ?? data?.acceptance    ?? null,
        missionCompletionRate:   data?.missionCompletionRate   ?? data?.completionRate ?? null,
        selfImprovementScore:    data?.selfImprovementScore    ?? data?.score          ?? null,
      });
    });

    setLastRefresh(timeStr());
  }, []);

  // ── Mount + 30s polling ────────────────────────────────────────────

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, 30_000);
    return () => clearInterval(id);
  }, [fetchAll]);

  // ── Derived values ─────────────────────────────────────────────────

  const activeMissions   = missions.filter(m => m.status === "active").length;
  const completedToday   = missions.filter(m => m.status === "completed").length;
  const failedToday      = missions.filter(m => m.status === "failed").length;
  const pendingApproval  = missions.filter(m => m.status === "pending").length;

  const errorRate      = healthData?.errorRate   ?? null;
  const deploySuccess  = cycleStats?.deploySuccess ?? null;
  const risks          = computeRisks({ errorRate, deploySuccess, missions });

  const fmtCycleTime = v => {
    if (v === null || v === undefined) return "—";
    if (v >= 3600) return `${(v / 3600).toFixed(1)}h`;
    if (v >= 60)   return `${Math.round(v / 60)}m`;
    return `${Math.round(v)}s`;
  };

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div className="ed-root">
      <PageHeader
        icon="◉"
        title="Executive Dashboard"
        subtitle="CEO-level view of missions, engineering throughput, runtime health and strategic intelligence"
        related={[
          { label: "Missions", tab: "jarvisbrain", icon: "🎯" },
          { label: "Recommendation", tab: "recommend", icon: "✦" },
          { label: "Reliability", tab: "reliability", icon: "◈" },
          { label: "Memory", tab: "memory", icon: "◎" },
          { label: "Self-Improve", tab: "selfimprove", icon: "⬡" },
        ]}
        onNavigate={onNavigate}
      />
      <WorkflowNav currentTab="executivedash" onNavigate={onNavigate} />

      {/* ── Header ── */}
      <motion.div className="ed-header" {...fadeUp(0)}>
        <div>
          <h1 className="ed-header__title">Executive Dashboard</h1>
          <p className="ed-header__subtitle">CEO-level view of missions, engineering throughput, runtime health and strategic intelligence.</p>
        </div>
        <div className="ed-header__right">
          <span className="ed-ts">Refreshed {lastRefresh}</span>
          <div className="ed-live-badge">
            <div className="ed-live-dot" />
            LIVE
          </div>
        </div>
      </motion.div>

      {/* ── Row 1: Mission Status ── */}
      <motion.div className="ed-section" {...fadeUp(0.05)}>
        <div className="ed-section__title">Mission Status</div>
        <div className="ed-stat-row">
          <StatCard
            value={fmt(activeMissions, "—")}
            label="Active Missions"
            colorClass="green"
          />
          <StatCard
            value={fmt(completedToday, "—")}
            label="Completed Today"
            colorClass="teal"
          />
          <StatCard
            value={fmt(failedToday, "—")}
            label="Failed Today"
            colorClass={failedToday > 0 ? "red" : "dim"}
          />
          <StatCard
            value={fmt(pendingApproval, "—")}
            label="Pending Approval"
            colorClass={pendingApproval > 0 ? "amber" : "dim"}
          />
        </div>
      </motion.div>

      {/* ── Row 2: Engineering Throughput ── */}
      <motion.div className="ed-section" {...fadeUp(0.1)}>
        <div className="ed-section__title">Engineering Throughput</div>
        <div className="ed-stat-row">
          <StatCard
            value={fmt(cycleStats?.tasksCompleted, "—")}
            label="Tasks Completed"
            sub="last 24h"
            colorClass="accent"
          />
          <StatCard
            value={deploySuccess !== null ? `${deploySuccess.toFixed(0)}%` : "—"}
            label="Deploy Success Rate"
            colorClass={deploySuccess === null ? "dim" : deploySuccess >= 90 ? "green" : deploySuccess >= 75 ? "amber" : "red"}
          />
          <StatCard
            value={fmtCycleTime(cycleStats?.avgCycleTime)}
            label="Avg Cycle Time"
            colorClass="teal"
          />
          <StatCard
            value={cycleStats?.agentUtilization !== null && cycleStats?.agentUtilization !== undefined
              ? `${Number(cycleStats.agentUtilization).toFixed(0)}%`
              : "—"}
            label="Agent Utilization"
            colorClass="accent"
          />
        </div>
      </motion.div>

      {/* ── Row 3: Runtime Health ── */}
      <motion.div className="ed-section" {...fadeUp(0.15)}>
        <div className="ed-section__title">Runtime Health</div>
        <div className="ed-health-grid">
          <StatCard
            value={healthData?.cpu !== null && healthData?.cpu !== undefined ? `${Number(healthData.cpu).toFixed(0)}%` : "monitoring"}
            label="CPU Usage"
            colorClass={healthData?.cpu > 80 ? "red" : healthData?.cpu > 60 ? "amber" : "green"}
          />
          <StatCard
            value={healthData?.memory !== null && healthData?.memory !== undefined ? `${Number(healthData.memory).toFixed(0)}%` : "monitoring"}
            label="Memory"
            colorClass={healthData?.memory > 85 ? "red" : healthData?.memory > 70 ? "amber" : "teal"}
          />
          <StatCard
            value={errorRate !== null ? `${Number(errorRate).toFixed(2)}%` : "—"}
            label="Error Rate"
            colorClass={errorRate === null ? "dim" : errorRate > 5 ? "red" : errorRate > 2 ? "amber" : "green"}
          />
          <StatCard
            value={healthData?.activeAgents !== null && healthData?.activeAgents !== undefined ? healthData.activeAgents : "—"}
            label="Active Agents"
            colorClass="accent"
          />
          <StatCard
            value={healthData?.lastDeploy ?? "—"}
            label="Last Deployment"
            colorClass="teal"
          />
          <StatCard
            value={healthData?.uptime ?? "—"}
            label="Uptime"
            colorClass="green"
          />
        </div>
      </motion.div>

      {/* ── Row 4: Active Missions ── */}
      <motion.div className="ed-section" {...fadeUp(0.2)}>
        <div className="ed-section__title">Active Missions</div>
        <div className="ed-mission-list">
          <div className="ed-mission-list__head">
            <span>Objective</span>
            <span>Status</span>
            <span>Priority</span>
            <span>Progress</span>
            <span>Last Activity</span>
          </div>
          {missions.length === 0 && (
            <div className="ed-empty">No missions found.</div>
          )}
          {missions.map(m => (
            <div
              key={m.id ?? m.objective}
              className="ed-mission-row"
              onClick={() => onNavigate && onNavigate("missionMemory")}
              role="button"
              tabIndex={0}
              onKeyDown={e => e.key === "Enter" && onNavigate && onNavigate("missionMemory")}
              title={m.objective}
            >
              <div className="ed-mission-obj">{m.objective}</div>
              <Badge status={m.status} />
              <PriorityBadge priority={m.priority} />
              <ProgressBar pct={m.pct ?? 0} />
              <span className="ed-mission-ts">{m.lastActivity ?? "—"}</span>
            </div>
          ))}
        </div>
      </motion.div>

      {/* ── Row 5: Predictions & Recommendations ── */}
      <motion.div className="ed-section" {...fadeUp(0.25)}>
        <div className="ed-section__title">Predictions &amp; Recommendations</div>
        <div className="ed-two-col">
          <div className="ed-panel">
            <div className="ed-panel__title">Strategic Recommendations</div>
            {recs.length === 0 ? (
              <div className="ed-empty">No recommendations available.</div>
            ) : (
              recs.map((r, i) => <RecItem key={i} item={r} />)
            )}
          </div>
          <div className="ed-panel">
            <div className="ed-panel__title">Strategic Risks</div>
            {risks.map((risk, i) => <RiskItem key={i} risk={risk} />)}
          </div>
        </div>
      </motion.div>

      {/* ── Row 6: Improvement Metrics ── */}
      <motion.div className="ed-section" {...fadeUp(0.3)}>
        <div className="ed-section__title">Improvement Metrics</div>
        <div className="ed-improve-row">
          <div className="ed-improve-cell">
            <div className="ed-improve-val" style={{ color: "var(--accent)" }}>
              {pct(impMetrics?.predictionAccuracy)}
            </div>
            <div className="ed-improve-lbl">Prediction Accuracy</div>
          </div>
          <div className="ed-improve-cell">
            <div className="ed-improve-val" style={{ color: "var(--accent2)" }}>
              {pct(impMetrics?.recommendationAcceptance)}
            </div>
            <div className="ed-improve-lbl">Rec. Acceptance Rate</div>
          </div>
          <div className="ed-improve-cell">
            <div className="ed-improve-val" style={{ color: "#22c55e" }}>
              {pct(impMetrics?.missionCompletionRate)}
            </div>
            <div className="ed-improve-lbl">Mission Completion</div>
          </div>
          <div className="ed-improve-cell">
            <div className="ed-improve-val" style={{ color: "#f59e0b" }}>
              {impMetrics?.selfImprovementScore !== null && impMetrics?.selfImprovementScore !== undefined
                ? `${Number(impMetrics.selfImprovementScore).toFixed(1)}`
                : "—"}
            </div>
            <div className="ed-improve-lbl">Self-Improvement Score</div>
          </div>
        </div>
      </motion.div>

    </div>
  );
}
