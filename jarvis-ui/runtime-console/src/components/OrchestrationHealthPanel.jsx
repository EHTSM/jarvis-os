import { useRuntimeStore } from "../store/runtimeStore.js";
import { RadarChart, PolarGrid, PolarAngleAxis, Radar, ResponsiveContainer, Tooltip } from "recharts";
import clsx from "clsx";

const STATE_STYLE = {
  healthy:  { bar: "bg-success",     text: "text-success",     badge: "bg-success/10 text-success"     },
  warning:  { bar: "bg-warning",     text: "text-warning",     badge: "bg-warning/10 text-warning"     },
  degraded: { bar: "bg-orange-400",  text: "text-orange-400",  badge: "bg-orange-400/10 text-orange-400" },
  critical: { bar: "bg-danger",      text: "text-danger",      badge: "bg-danger/10 text-danger"       },
};

const DEGRADATION_THRESHOLDS = [
  { type: "queue_depth",        label: "Queue Depth",         threshold: "≥ 800 items" },
  { type: "concurrency_saturation", label: "Concurrency",     threshold: "≥ 90% slots" },
  { type: "high_error_rate",    label: "Error Rate",          threshold: "≥ 30%" },
  { type: "high_rejection_rate",label: "Rejection Rate",      threshold: "≥ 20%" },
];

export default function OrchestrationHealthPanel() {
  const { orchestrationHealth, concurrencyState, queueState, pressureState } = useRuntimeStore();
  const { score, state, subsystems = [] } = orchestrationHealth;

  // Radar data
  const radarData = subsystems.map(ss => ({
    subject: ss.subsystem,
    score:   Math.round(ss.score * 100),
  }));

  // Synthetic degradation indicators
  const totalQueued = Object.values(queueState).reduce((s, q) => s + q.depth, 0);
  const degradations = [];
  if (totalQueued >= 50)                      degradations.push({ type: "queue_depth",         value: totalQueued });
  if (concurrencyState.utilization >= 0.7)    degradations.push({ type: "concurrency_saturation", value: concurrencyState.utilization });
  if (pressureState.errorRate >= 0.2)         degradations.push({ type: "high_error_rate",     value: pressureState.errorRate });

  const style = STATE_STYLE[state] ?? STATE_STYLE.healthy;

  return (
    <div className="space-y-4">
      {/* Global score */}
      <div className="panel p-5 flex items-center gap-6">
        <div className="relative w-24 h-24 flex-shrink-0">
          <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
            <circle cx="50" cy="50" r="40" fill="none" stroke="#1e2535" strokeWidth="8" />
            <circle cx="50" cy="50" r="40" fill="none"
              stroke={state === "healthy" ? "#22c55e" : state === "warning" ? "#f59e0b"
                : state === "degraded" ? "#f97316" : "#ef4444"}
              strokeWidth="8"
              strokeDasharray={`${score * 251} 251`}
              strokeLinecap="round"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <p className={clsx("text-xl font-bold", style.text)}>{Math.round(score * 100)}</p>
          </div>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted">Overall Orchestration Health</p>
          <p className={clsx("text-2xl font-semibold capitalize", style.text)}>{state}</p>
          <p className="text-xs text-muted">{subsystems.length} subsystems monitored</p>
        </div>
        <div className="ml-auto text-right space-y-1">
          <p className="text-xs text-muted">Active Degradations</p>
          <p className={clsx("text-2xl font-semibold", degradations.length > 0 ? "text-danger" : "text-success")}>
            {degradations.length}
          </p>
        </div>
      </div>

      {/* Subsystems + radar */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Health bars */}
        <div className="panel p-4 space-y-3">
          <p className="text-xs text-muted uppercase tracking-widest">Subsystem Scores</p>
          <div className="space-y-2">
            {subsystems.map(ss => {
              const st = STATE_STYLE[ss.state] ?? STATE_STYLE.healthy;
              return (
                <div key={ss.subsystem} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted capitalize">{ss.subsystem}</span>
                    <span className={clsx("badge", st.badge)}>{ss.state}</span>
                  </div>
                  <div className="bg-dim rounded-full h-2 overflow-hidden">
                    <div className={clsx("h-full rounded-full transition-all duration-700", st.bar)}
                      style={{ width: `${ss.score * 100}%` }} />
                  </div>
                  <p className={clsx("text-xs text-right", st.text)}>{(ss.score * 100).toFixed(1)}%</p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Radar */}
        <div className="panel p-4">
          <p className="text-xs text-muted uppercase tracking-widest mb-2">Health Radar</p>
          <ResponsiveContainer width="100%" height={220}>
            <RadarChart data={radarData}>
              <PolarGrid stroke="#1e2535" />
              <PolarAngleAxis dataKey="subject"
                tick={{ fontSize: 9, fill: "#64748b", fontFamily: "JetBrains Mono, monospace" }} />
              <Radar name="Health" dataKey="score" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.2} />
              <Tooltip
                contentStyle={{ background: "#161b27", border: "1px solid #1e2535", borderRadius: 6, fontSize: 11 }}
                formatter={v => [`${v}%`, "Health"]}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Degradation indicators */}
      <div className="panel p-4 space-y-3">
        <p className="text-xs text-muted uppercase tracking-widest">Degradation Indicators</p>
        {degradations.length === 0 ? (
          <p className="text-xs text-success">✓ No active degradations detected</p>
        ) : (
          <div className="space-y-2">
            {degradations.map((d, i) => {
              const meta = DEGRADATION_THRESHOLDS.find(t => t.type === d.type);
              return (
                <div key={i} className="flex items-center gap-3 p-2 bg-danger/5 border border-danger/20 rounded text-xs">
                  <span className="text-danger">⚠</span>
                  <span className="text-white">{meta?.label ?? d.type}</span>
                  <span className="text-muted">threshold: {meta?.threshold}</span>
                  <span className="ml-auto text-danger font-mono">
                    {typeof d.value === "number" && d.value < 2
                      ? `${(d.value * 100).toFixed(1)}%`
                      : d.value}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
