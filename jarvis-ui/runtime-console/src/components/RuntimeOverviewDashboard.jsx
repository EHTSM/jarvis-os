import { useRuntimeStore } from "../store/runtimeStore.js";
import clsx from "clsx";

const STATE_COLORS = {
  nominal:  "text-success",  healthy:  "text-success",
  elevated: "text-warning",  warning:  "text-warning",
  active:   "text-orange-400", degraded: "text-orange-400",
  critical: "text-danger",
};

const STATE_BG = {
  nominal:  "bg-success/10",   healthy:  "bg-success/10",
  elevated: "bg-warning/10",   warning:  "bg-warning/10",
  active:   "bg-orange-400/10",degraded: "bg-orange-400/10",
  critical: "bg-danger/10",
};

function StatCard({ label, value, sub, accent = "text-accent" }) {
  return (
    <div className="panel p-4 flex flex-col gap-1">
      <p className="text-xs text-muted uppercase tracking-widest">{label}</p>
      <p className={clsx("text-2xl font-semibold", accent)}>{value}</p>
      {sub && <p className="text-xs text-muted">{sub}</p>}
    </div>
  );
}

export default function RuntimeOverviewDashboard() {
  const { queueState, activeExecutions, pressureState, orchestrationHealth,
          concurrencyState, adapterLoad } = useRuntimeStore();

  const totalQueued  = Object.values(queueState).reduce((s, q) => s + q.depth, 0);
  const totalFailed  = adapterLoad.reduce((s, a) => s + a.failed, 0);
  const totalDone    = adapterLoad.reduce((s, a) => s + a.completed, 0);
  const successRate  = totalDone + totalFailed > 0
    ? ((totalDone / (totalDone + totalFailed)) * 100).toFixed(1) : "—";

  return (
    <div className="space-y-4">
      {/* Top KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Active Executions" value={activeExecutions.length}
          sub={`${concurrencyState.globalActive}/${concurrencyState.globalLimit} slots`} />
        <StatCard label="Queued Items" value={totalQueued}
          sub="across all queues" accent="text-warning" />
        <StatCard label="Success Rate" value={`${successRate}%`}
          sub={`${totalDone} completed`} accent="text-success" />
        <StatCard label="Pressure"
          value={pressureState.state.toUpperCase()}
          sub={`error rate ${(pressureState.errorRate * 100).toFixed(1)}%`}
          accent={STATE_COLORS[pressureState.state] ?? "text-muted"} />
      </div>

      {/* Health + adapter load */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Health */}
        <div className="panel p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted uppercase tracking-widest">Subsystem Health</p>
            <span className={clsx("badge", STATE_BG[orchestrationHealth.state], STATE_COLORS[orchestrationHealth.state])}>
              {orchestrationHealth.state}
            </span>
          </div>
          <div className="space-y-2">
            {orchestrationHealth.subsystems?.map(ss => (
              <div key={ss.subsystem} className="flex items-center gap-2">
                <p className="text-xs w-24 text-muted truncate">{ss.subsystem}</p>
                <div className="flex-1 bg-dim rounded-full h-1.5 overflow-hidden">
                  <div className={clsx("h-full rounded-full transition-all duration-500",
                    ss.state === "healthy" ? "bg-success" : ss.state === "warning" ? "bg-warning"
                    : ss.state === "degraded" ? "bg-orange-400" : "bg-danger"
                  )} style={{ width: `${(ss.score * 100).toFixed(0)}%` }} />
                </div>
                <p className="text-xs text-muted w-10 text-right">{(ss.score * 100).toFixed(0)}%</p>
              </div>
            ))}
          </div>
        </div>

        {/* Adapter load */}
        <div className="panel p-4 space-y-3">
          <p className="text-xs text-muted uppercase tracking-widest">Adapter Load</p>
          <div className="space-y-2">
            {adapterLoad.map(a => (
              <div key={a.adapter} className="flex items-center gap-2">
                <p className="text-xs w-20 text-muted truncate">{a.adapter}</p>
                <div className="flex-1 bg-dim rounded-full h-1.5 overflow-hidden">
                  <div className={clsx("h-full rounded-full transition-all duration-500",
                    a.utilization > 0.8 ? "bg-danger" : a.utilization > 0.5 ? "bg-warning" : "bg-accent"
                  )} style={{ width: `${(a.utilization * 100).toFixed(0)}%` }} />
                </div>
                <p className="text-xs text-muted w-14 text-right">{a.active}/{a.capacity}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Active executions table */}
      <div className="panel p-4 space-y-3">
        <p className="text-xs text-muted uppercase tracking-widest">Active Executions</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted border-b border-border">
                {["Execution ID", "Workflow", "Adapter", "Stage", "Authority", "Elapsed"].map(h => (
                  <th key={h} className="text-left pb-2 pr-4 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {activeExecutions.slice(0, 8).map(ex => (
                <tr key={ex.executionId} className="border-b border-border/40 hover:bg-dim/40 cursor-pointer">
                  <td className="py-1.5 pr-4 font-mono text-accent">{ex.executionId}</td>
                  <td className="py-1.5 pr-4 text-muted">{ex.workflowId}</td>
                  <td className="py-1.5 pr-4">
                    <span className="badge bg-accent/10 text-accent">{ex.adapterType}</span>
                  </td>
                  <td className="py-1.5 pr-4">
                    <span className={clsx("badge",
                      ex.stage === "executing" ? "bg-success/10 text-success"
                      : ex.stage === "sandboxed" ? "bg-accent/10 text-accent"
                      : "bg-muted/10 text-muted"
                    )}>{ex.stage}</span>
                  </td>
                  <td className="py-1.5 pr-4 text-muted">{ex.authorityLevel}</td>
                  <td className="py-1.5 pr-4 text-muted">{(ex.elapsedMs / 1000).toFixed(1)}s</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
