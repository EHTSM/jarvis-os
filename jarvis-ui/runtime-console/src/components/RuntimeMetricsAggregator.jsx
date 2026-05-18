import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer, CartesianGrid,
} from "recharts";
import { useRuntimeStore } from "../store/runtimeStore.js";
import clsx from "clsx";

const TT_STYLE = {
  contentStyle: { background: "#161b27", border: "1px solid #1e2535", borderRadius: 6, fontSize: 11 },
  labelStyle:   { color: "#64748b" },
};

export default function RuntimeMetricsAggregator() {
  const { throughputHistory, latencyHistory, adapterLoad, concurrencyState } = useRuntimeStore();

  const totalCompleted = throughputHistory.reduce((s, t) => s + t.completed, 0);
  const totalFailed    = throughputHistory.reduce((s, t) => s + t.failed, 0);
  const avgThroughput  = throughputHistory.length
    ? (throughputHistory.reduce((s, t) => s + t.throughput, 0) / throughputHistory.length).toFixed(2)
    : "0";

  return (
    <div className="space-y-4">
      {/* KPI row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="panel p-4">
          <p className="text-xs text-muted uppercase tracking-widest">Completed (30s)</p>
          <p className="text-3xl font-semibold text-success">{totalCompleted}</p>
        </div>
        <div className="panel p-4">
          <p className="text-xs text-muted uppercase tracking-widest">Failed (30s)</p>
          <p className="text-3xl font-semibold text-danger">{totalFailed}</p>
        </div>
        <div className="panel p-4">
          <p className="text-xs text-muted uppercase tracking-widest">Avg Throughput</p>
          <p className="text-3xl font-semibold text-accent">{avgThroughput}<span className="text-sm text-muted">/s</span></p>
        </div>
      </div>

      {/* Throughput chart */}
      <div className="panel p-4 space-y-3">
        <p className="text-xs text-muted uppercase tracking-widest">Execution Throughput (30s window)</p>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={throughputHistory} margin={{ top: 5, right: 5, bottom: 5, left: -15 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e2535" />
            <XAxis dataKey="t" tick={{ fontSize: 8, fill: "#64748b" }} tickLine={false} interval={4} />
            <YAxis tick={{ fontSize: 9, fill: "#64748b" }} tickLine={false} />
            <Tooltip {...TT_STYLE} />
            <Legend wrapperStyle={{ fontSize: 10, color: "#64748b" }} />
            <Bar dataKey="completed" fill="#22c55e" stackId="a" radius={[0, 0, 0, 0]} />
            <Bar dataKey="failed"    fill="#ef4444" stackId="a" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Latency chart */}
      <div className="panel p-4 space-y-3">
        <p className="text-xs text-muted uppercase tracking-widest">Latency Percentiles (ms)</p>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={latencyHistory} margin={{ top: 5, right: 5, bottom: 5, left: -15 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e2535" />
            <XAxis dataKey="t" tick={{ fontSize: 8, fill: "#64748b" }} tickLine={false} interval={4} />
            <YAxis tick={{ fontSize: 9, fill: "#64748b" }} tickLine={false} />
            <Tooltip {...TT_STYLE} formatter={v => [`${v}ms`]} />
            <Legend wrapperStyle={{ fontSize: 10, color: "#64748b" }} />
            <Line type="monotone" dataKey="p50" stroke="#22c55e" dot={false} strokeWidth={1.5} />
            <Line type="monotone" dataKey="p95" stroke="#f59e0b" dot={false} strokeWidth={1.5} />
            <Line type="monotone" dataKey="p99" stroke="#ef4444" dot={false} strokeWidth={1.5} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Adapter performance */}
      <div className="panel p-4 space-y-3">
        <p className="text-xs text-muted uppercase tracking-widest">Adapter Performance</p>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={adapterLoad} layout="vertical" margin={{ top: 0, right: 20, bottom: 0, left: 60 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e2535" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 9, fill: "#64748b" }} tickLine={false} />
            <YAxis type="category" dataKey="adapter" tick={{ fontSize: 9, fill: "#64748b" }} tickLine={false} width={55} />
            <Tooltip {...TT_STYLE} />
            <Bar dataKey="completed" fill="#3b82f6" radius={[0, 2, 2, 0]} name="completed" />
            <Bar dataKey="failed"    fill="#ef4444" radius={[0, 2, 2, 0]} name="failed" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Concurrency heatmap */}
      <div className="panel p-4 space-y-3">
        <p className="text-xs text-muted uppercase tracking-widest">Concurrency Distribution</p>
        <div className="flex items-center gap-4 mb-2">
          <div className="flex items-center gap-2">
            <div className="w-16 bg-dim rounded-full h-2 overflow-hidden">
              <div className="h-full bg-accent" style={{ width: `${concurrencyState.utilization * 100}%` }} />
            </div>
            <span className="text-xs text-muted">
              {concurrencyState.globalActive}/{concurrencyState.globalLimit} global
              ({(concurrencyState.utilization * 100).toFixed(0)}%)
            </span>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {Object.entries(concurrencyState.byAdapter ?? {}).map(([k, v]) => (
            <div key={k} className="bg-dim rounded p-2">
              <p className="text-xs text-muted capitalize">{k}</p>
              <div className="flex items-center gap-1.5 mt-1">
                <div className="flex-1 bg-panel rounded-full h-1 overflow-hidden">
                  <div className={clsx("h-full",
                    v / 10 > 0.7 ? "bg-danger" : v / 10 > 0.4 ? "bg-warning" : "bg-accent"
                  )} style={{ width: `${(v / 10) * 100}%` }} />
                </div>
                <span className="text-xs text-muted">{v}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
