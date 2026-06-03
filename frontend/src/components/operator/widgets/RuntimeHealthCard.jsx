import React, { useMemo, useState, useEffect } from "react";
import { getProductivitySummary, getRetentionAnalytics, getOperationalAnalytics, getBottleneckSummary } from "../../../hooks/useProductivityAnalytics";

function fmtUptime(secs) {
  if (!secs) return "—";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

const Sparkline = ({ value, max, thresholdWarn, thresholdCrit }) => {
  const percent    = Math.min(100, Math.max(0, (value / max) * 100));
  const colorClass = value >= thresholdCrit ? "bg-crit" : value >= thresholdWarn ? "bg-warn" : "bg-ok";
  return (
    <div className="sparkline-container">
      <div className={`sparkline-fill ${colorClass}`} style={{ width: `${percent}%` }} />
    </div>
  );
};

function StatusBadge({ label, value, scoreClass }) {
  return (
    <div className="op-health-row">
      <span className="label">{label}</span>
      <span className={`op-status-badge ${scoreClass}`}>{value}</span>
    </div>
  );
}

export const RuntimeHealthCard = React.memo(({ ops, rtStatus }) => {
  const status      = ops?.status ?? "unknown";
  const statusClass = status === "ok" ? "ok" : status === "degraded" ? "warn" : "crit";
  const heapMb      = ops?.memory?.current?.heap_mb ?? 0;
  const rssMb       = ops?.memory?.current?.rss_mb  ?? 0;
  const uptime      = fmtUptime(ops?.uptime?.seconds);
  const errRate     = ops?.errors?.errors_per_hour   ?? 0;

  const histStats   = rtStatus?.history;
  const successRate = histStats ? Math.round((histStats.successRate ?? 1) * 100) : null;
  const confClass   = successRate === null ? "dim"
                    : successRate >= 90 ? "ok"
                    : successRate >= 70 ? "warn" : "crit";

  const totalExecs = histStats?.total ?? 0;
  const recentFail = histStats?.recentFailed ?? 0;
  const trendIcon  = recentFail > 3 ? "↓" : successRate !== null && successRate >= 95 ? "↑" : "→";
  const trendClass = recentFail > 3 ? "crit" : successRate !== null && successRate >= 95 ? "ok" : "dim";

  const _analytics  = useMemo(() => { try { return getProductivitySummary(); }  catch { return null; } }, []);
  const deployConf  = _analytics?.deploymentConfidence ?? null;
  const deployLabel = _analytics?.confidenceLabel ?? null;

  const _retention   = useMemo(() => { try { return getRetentionAnalytics();    } catch { return null; } }, []);
  const _opAnalytics = useMemo(() => { try { return getOperationalAnalytics();  } catch { return null; } }, []);
  const _bottleneck  = useMemo(() => { try { return getBottleneckSummary();     } catch { return null; } }, []);

  const qSize  = rtStatus?.queue?.size ?? ops?.queue?.counts?.pending ?? 0;
  const qClass = qSize > 20 ? "crit" : qSize > 5 ? "warn" : "ok";

  const throttle    = rtStatus?.throttle;
  const governor    = rtStatus?.governor;
  const tLevel      = throttle?.level ?? "normal";
  const tClass      = tLevel === "block" ? "crit" : tLevel === "throttle" || tLevel === "warn" ? "warn" : "ok";
  const activeExecs = governor?.active ?? null;

  const driftAlerts = rtStatus?.drift?.recentAlerts?.length ?? 0;

  const stabilityScore = React.useMemo(() => {
    let score = 100;
    if (heapMb > 400) score -= 25;
    else if (heapMb > 250) score -= 10;
    if (errRate > 10) score -= 20;
    else if (errRate > 0) score -= 5;
    if (driftAlerts > 0) score -= 15;
    if (qSize > 20) score -= 15;
    else if (qSize > 10) score -= 5;
    if (successRate !== null && successRate < 70) score -= 20;
    else if (successRate !== null && successRate < 90) score -= 10;
    return Math.max(0, score);
  }, [heapMb, errRate, driftAlerts, qSize, successRate]);

  const scoreClass = stabilityScore >= 85 ? "ok" : stabilityScore >= 60 ? "warn" : "crit";
  const scoreLabel = stabilityScore >= 85 ? "Stable" : stabilityScore >= 60 ? "Monitor" : "At risk";

  const [betaGate, setBetaGate] = useState(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/runtime/beta-candidate", { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (!cancelled && data) setBetaGate(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const fatigueLevel = _opAnalytics?.fatiguRisk;
  const showFatigue  = fatigueLevel && fatigueLevel !== "low";

  return (
    <div className="op-widget-card health-card">
      <div className="op-widget-header">
        <span>Health</span>
        <span className={`op-stat-value ${scoreClass}`} style={{ fontSize: 10, fontWeight: 700 }}>
          {scoreLabel}
        </span>
      </div>

      <div className="op-widget-content">
        <StatusBadge label="Stability" value={`${scoreLabel} ${stabilityScore}/100`} scoreClass={scoreClass} />

        {betaGate && (
          <StatusBadge
            label="Beta Gate"
            scoreClass={betaGate.pass ? "ok" : "crit"}
            value={
              betaGate.pass
                ? `Ready (${betaGate.passed}/${betaGate.total})`
                : `${betaGate.failed?.length} check${betaGate.failed?.length !== 1 ? "s" : ""} failing`
            }
          />
        )}

        {deployConf !== null && (
          <StatusBadge
            label="Deploy confidence"
            scoreClass={deployLabel ?? "dim"}
            value={`${deployConf}% ${deployLabel === "high" ? "✓" : deployLabel === "medium" ? "~" : "⚠"}`}
          />
        )}

        {successRate !== null && (
          <div className="op-conf-block">
            <div className="op-conf-header">
              <span className="label">Success rate</span>
              <span className={`value ${confClass}`}>{successRate}%</span>
            </div>
            <div className="op-confidence-bar">
              <div
                className="op-confidence-fill"
                style={{
                  width: `${successRate}%`,
                  background: successRate >= 90 ? "var(--op-green)"
                            : successRate >= 70 ? "var(--op-amber)"
                            : "var(--op-red)"
                }}
              />
            </div>
          </div>
        )}

        <div className="op-metric">
          <span className="label">Uptime</span>
          <span className="value dim">{uptime}</span>
        </div>

        {successRate !== null && totalExecs > 0 && (
          <div className="op-metric">
            <span className="label">Trend</span>
            <span className={`value ${trendClass}`}>
              {trendIcon} <span className="op-metric-sub">{totalExecs} runs</span>
            </span>
          </div>
        )}

        {_retention && (
          <div className="op-metric">
            <span className="label">Recovery</span>
            <span
              className={`value ${_retention.recoveryRate >= 85 ? "ok" : _retention.recoveryRate >= 60 ? "warn" : "crit"}`}
              title={_retention.avgRecoveryMs ? `Avg reconnect: ${Math.round(_retention.avgRecoveryMs / 1000)}s` : undefined}
            >
              {_retention.recoveryRate}%
              {_retention.avgRecoveryMs && (
                <span className="op-metric-sub"> · {Math.round(_retention.avgRecoveryMs / 1000)}s avg</span>
              )}
            </span>
          </div>
        )}

        <div className="op-metric">
          <span className="label">Queue</span>
          <span className={`value ${qClass}`}>{qSize} pending</span>
        </div>

        {throttle && (
          <div className="op-metric">
            <span className="label">Throttle</span>
            <span className={`value ${tClass}`}>{tLevel.charAt(0).toUpperCase() + tLevel.slice(1)} ({throttle.ratePerMin}/min)</span>
          </div>
        )}

        {activeExecs !== null && (
          <div className="op-metric">
            <span className="label">Active execs</span>
            <span className={`value ${activeExecs > 8 ? "warn" : "dim"}`}>{activeExecs}</span>
          </div>
        )}

        {driftAlerts > 0 && (
          <div className="op-metric">
            <span className="label">Drift alerts</span>
            <span className="value warn">{driftAlerts}</span>
          </div>
        )}

        <div className="op-metric">
          <span className="label">Err/hr</span>
          <span className={`value ${errRate > 10 ? "crit" : errRate > 0 ? "warn" : "ok"}`}>{errRate}</span>
        </div>

        <div className="op-metric-block">
          <div className="op-metric-flex">
            <span className="label">Heap</span>
            <span className={`value ${ops?.memory?.critical ? "crit" : ops?.memory?.warn ? "warn" : ""}`}>{heapMb} MB</span>
          </div>
          <Sparkline value={heapMb} max={250} thresholdWarn={150} thresholdCrit={200} />
        </div>

        <div className="op-metric-block">
          <div className="op-metric-flex">
            <span className="label">RSS</span>
            <span className="value dim">{rssMb} MB</span>
          </div>
          <Sparkline value={rssMb} max={300} thresholdWarn={200} thresholdCrit={250} />
        </div>

        <div className="op-recovery-summary" aria-live="polite">
          {stabilityScore >= 85 && "Everything looks healthy — Ooplix is running well."}
          {stabilityScore >= 60 && stabilityScore < 85 && "Running with minor warnings — keep an eye on things."}
          {stabilityScore < 60 && "System is under stress — avoid heavy workloads for now."}
          {qSize > 10 && ` Queue building up (${qSize} waiting).`}
          {heapMb > 350 && " Memory high — a backend restart can help."}
        </div>

        {_bottleneck && (
          <div className="op-metric" title={`Avg latency: ${_bottleneck.avgLatencyMs}ms | Retry rate: ${_bottleneck.avgRetryRate}%`}>
            <span className="label">Bottleneck</span>
            <span className="value warn op-metric-sub-text">
              {_bottleneck.topBottleneck.replace(/_/g, " ")} <span className="op-metric-sub">×{_bottleneck.topCount}</span>
            </span>
          </div>
        )}

        {showFatigue && (
          <div className={`op-fatigue-signal ${fatigueLevel}`}>
            Operator fatigue signal — success rate declining. Consider a break.
          </div>
        )}
      </div>
    </div>
  );
});
