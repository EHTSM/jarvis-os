import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { useRuntimeStore } from "../store/runtimeStore.js";
import clsx from "clsx";

const STATE_META = {
  nominal:  { label: "Nominal",  color: "#22c55e", bg: "bg-success/10",  text: "text-success"  },
  elevated: { label: "Elevated", color: "#f59e0b", bg: "bg-warning/10",  text: "text-warning"  },
  active:   { label: "Active",   color: "#f97316", bg: "bg-orange-400/10", text: "text-orange-400" },
  critical: { label: "Critical", color: "#ef4444", bg: "bg-danger/10",   text: "text-danger"   },
};

function AdmissionRule({ state }) {
  const rules = {
    nominal:  ["All executions admitted"],
    elevated: ["All admitted", "Blocked if retryCount > 2"],
    active:   ["Only critical/emergency priority", "Recovery executions always admitted", "Normal executions blocked"],
    critical: ["Only recovery executions", "root-runtime authority may bypass", "All normal executions blocked"],
  };
  return (
    <div className="space-y-1">
      {(rules[state] ?? rules.nominal).map((r, i) => (
        <div key={i} className="flex items-center gap-2 text-xs text-muted">
          <span className={clsx("text-xs", i === 0 ? "text-success" : "text-danger")}>
            {i === 0 ? "✓" : "✗"}
          </span>
          {r}
        </div>
      ))}
    </div>
  );
}

export default function RuntimePressureMonitor() {
  const { pressureState, pressureHistory } = useRuntimeStore();
  const meta = STATE_META[pressureState.state] ?? STATE_META.nominal;

  return (
    <div className="space-y-4">
      {/* State card */}
      <div className="panel p-5 flex items-center gap-6">
        <div className={clsx("rounded-full w-20 h-20 flex items-center justify-center flex-shrink-0 border-2",
          meta.bg, `border-[${meta.color}]`
        )} style={{ borderColor: meta.color }}>
          <span className={clsx("text-2xl font-bold", meta.text)}>
            {(pressureState.errorRate * 100).toFixed(0)}%
          </span>
        </div>
        <div className="space-y-1">
          <p className={clsx("text-2xl font-semibold", meta.text)}>{meta.label}</p>
          <p className="text-xs text-muted">Error rate in 60-second rolling window</p>
          <p className="text-xs text-muted">
            {pressureState.windowSignals} signals · {pressureState.overridden ? "⚠ overridden" : "live"}
          </p>
        </div>
        <div className="ml-auto text-right">
          <p className="text-xs text-muted mb-2">Admission Rules</p>
          <AdmissionRule state={pressureState.state} />
        </div>
      </div>

      {/* Error rate history chart */}
      <div className="panel p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted uppercase tracking-widest">Error Rate History (2 min window)</p>
          <div className="flex gap-3">
            {Object.entries(STATE_META).map(([k, v]) => (
              <div key={k} className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full" style={{ background: v.color }} />
                <span className="text-xs text-muted">{v.label}</span>
              </div>
            ))}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={pressureHistory} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
            <defs>
              <linearGradient id="pressureGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={meta.color} stopOpacity={0.3} />
                <stop offset="95%" stopColor={meta.color} stopOpacity={0}   />
              </linearGradient>
            </defs>
            <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#64748b" }} tickLine={false} />
            <YAxis domain={[0, 1]} tick={{ fontSize: 9, fill: "#64748b" }} tickLine={false}
              tickFormatter={v => `${(v * 100).toFixed(0)}%`} />
            <Tooltip
              contentStyle={{ background: "#161b27", border: "1px solid #1e2535", borderRadius: 6, fontSize: 11 }}
              formatter={v => [`${(v * 100).toFixed(1)}%`, "Error Rate"]}
              labelStyle={{ color: "#64748b" }}
            />
            <ReferenceLine y={0.5}  stroke="#ef4444" strokeDasharray="4 2" label={{ value: "critical", fill: "#ef4444", fontSize: 9, position: "insideTopRight" }} />
            <ReferenceLine y={0.3}  stroke="#f97316" strokeDasharray="4 2" />
            <ReferenceLine y={0.15} stroke="#f59e0b" strokeDasharray="4 2" />
            <Area type="monotone" dataKey="errorRate" stroke={meta.color}
              fill="url(#pressureGrad)" strokeWidth={2} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Threshold table */}
      <div className="panel p-4 space-y-2">
        <p className="text-xs text-muted uppercase tracking-widest">Thresholds</p>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted border-b border-border">
              <th className="text-left pb-2">State</th>
              <th className="text-left pb-2">Error Rate</th>
              <th className="text-left pb-2">Queue Depth</th>
              <th className="text-left pb-2">Action</th>
            </tr>
          </thead>
          <tbody className="text-muted">
            {[
              ["critical",  "≥ 50%", "≥ 950", "recovery only"],
              ["active",    "≥ 30%", "≥ 800", "critical/emergency only"],
              ["elevated",  "≥ 15%", "≥ 600", "block retryCount > 2"],
              ["nominal",   "< 15%", "< 600", "admit all"],
            ].map(([state, er, qd, action]) => (
              <tr key={state} className={clsx("border-b border-border/40",
                pressureState.state === state && "bg-dim/60"
              )}>
                <td className={clsx("py-1.5", STATE_META[state]?.text)}>{state}</td>
                <td className="py-1.5">{er}</td>
                <td className="py-1.5">{qd}</td>
                <td className="py-1.5">{action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
