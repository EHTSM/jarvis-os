import { useRuntimeStore } from "../store/runtimeStore.js";
import clsx from "clsx";

function msUntil(iso) {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return "now";
  if (diff < 1000) return `${diff}ms`;
  if (diff < 60000) return `${(diff / 1000).toFixed(1)}s`;
  return `${(diff / 60000).toFixed(1)}m`;
}

const TYPE_META = {
  recovery: { label: "Recovery", color: "text-orange-400", bg: "bg-orange-400/10", dot: "bg-orange-400" },
  retry:    { label: "Retry",    color: "text-warning",    bg: "bg-warning/10",    dot: "bg-warning"    },
};

const STATE_META = {
  scheduled: { color: "text-accent",   bg: "bg-accent/10"   },
  fired:     { color: "text-success",  bg: "bg-success/10"  },
  cancelled: { color: "text-muted",    bg: "bg-muted/10"    },
};

export default function RecoveryAndRetryPanel() {
  const { retrySchedule } = useRuntimeStore();

  const recoveries = retrySchedule.filter(e => e.type === "recovery");
  const retries    = retrySchedule.filter(e => e.type === "retry");
  const pending    = retrySchedule.filter(e => e.state === "scheduled");
  const maxRetry   = retries.reduce((m, e) => Math.max(m, e.retryCount), 0);

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-3 gap-3">
        <div className="panel p-4">
          <p className="text-xs text-muted uppercase tracking-widest">Pending</p>
          <p className="text-3xl font-semibold text-accent">{pending.length}</p>
          <p className="text-xs text-muted">scheduled</p>
        </div>
        <div className="panel p-4">
          <p className="text-xs text-muted uppercase tracking-widest">Recovery</p>
          <p className="text-3xl font-semibold text-orange-400">{recoveries.length}</p>
          <p className="text-xs text-muted">entries</p>
        </div>
        <div className="panel p-4">
          <p className="text-xs text-muted uppercase tracking-widest">Max Retries</p>
          <p className="text-3xl font-semibold text-warning">{maxRetry}</p>
          <p className="text-xs text-muted">attempts</p>
        </div>
      </div>

      {/* Schedule table */}
      <div className="panel p-4 space-y-3">
        <p className="text-xs text-muted uppercase tracking-widest">Retry / Recovery Schedule</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted border-b border-border">
                {["ID", "Workflow", "Type", "Retries", "Priority", "State", "Runs In"].map(h => (
                  <th key={h} className="text-left pb-2 pr-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {retrySchedule.map(e => {
                const tm = TYPE_META[e.type]   ?? TYPE_META.retry;
                const sm = STATE_META[e.state] ?? STATE_META.scheduled;
                return (
                  <tr key={e.scheduleId} className="border-b border-border/30 hover:bg-dim/40">
                    <td className="py-1.5 pr-3 font-mono text-muted">{e.scheduleId}</td>
                    <td className="py-1.5 pr-3 text-white">{e.workflowId}</td>
                    <td className="py-1.5 pr-3">
                      <span className={clsx("badge", tm.bg, tm.color)}>{tm.label}</span>
                    </td>
                    <td className="py-1.5 pr-3">
                      {e.retryCount > 0 ? (
                        <div className="flex gap-1">
                          {Array.from({ length: Math.min(e.retryCount, 5) }).map((_, i) => (
                            <div key={i} className="w-1.5 h-1.5 rounded-full bg-warning" />
                          ))}
                        </div>
                      ) : <span className="text-muted">—</span>}
                    </td>
                    <td className="py-1.5 pr-3">
                      <div className="flex items-center gap-1">
                        <div className="w-8 bg-dim rounded-full h-1 overflow-hidden">
                          <div className="h-full bg-accent"
                            style={{ width: `${Math.min(100, e.priorityScore)}%` }} />
                        </div>
                        <span className="text-muted">{e.priorityScore}</span>
                      </div>
                    </td>
                    <td className="py-1.5 pr-3">
                      <span className={clsx("badge", sm.bg, sm.color)}>{e.state}</span>
                    </td>
                    <td className="py-1.5 text-muted font-mono">
                      {e.state === "scheduled" ? msUntil(e.scheduledAt) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Backoff explanation */}
      <div className="panel p-4 space-y-2">
        <p className="text-xs text-muted uppercase tracking-widest">Retry Backoff Formula</p>
        <p className="text-xs text-muted font-mono">
          delay = min(1000 × 2^(retryCount−1), 60000) + jitter(0–10%)
        </p>
        <div className="grid grid-cols-5 gap-2 mt-2">
          {[1, 2, 3, 4, 5].map(n => {
            const exp    = Math.min(1000 * Math.pow(2, n - 1), 60000);
            const jitter = Math.round(exp * 0.05);
            return (
              <div key={n} className="text-center">
                <p className="text-warning font-semibold text-sm">
                  {exp >= 1000 ? `${exp / 1000}s` : `${exp}ms`}
                </p>
                <p className="text-muted text-xs">retry {n}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
