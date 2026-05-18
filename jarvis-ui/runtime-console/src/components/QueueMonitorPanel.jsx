import { useRuntimeStore } from "../store/runtimeStore.js";
import clsx from "clsx";

const QUEUE_META = {
  priority: { label: "Priority",   color: "bg-danger",   text: "text-danger",   dot: "bg-danger" },
  recovery: { label: "Recovery",   color: "bg-orange-400", text: "text-orange-400", dot: "bg-orange-400" },
  retry:    { label: "Retry",      color: "bg-warning",  text: "text-warning",  dot: "bg-warning" },
  default:  { label: "Default",    color: "bg-accent",   text: "text-accent",   dot: "bg-accent" },
};

function QueueCard({ name, data }) {
  const meta  = QUEUE_META[name] ?? QUEUE_META.default;
  const pct   = Math.min(100, (data.depth / data.capacity) * 100);
  const state = pct > 80 ? "full" : pct > 50 ? "warning" : "healthy";

  return (
    <div className="panel p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={clsx("pulse-dot", meta.dot)} />
          <p className={clsx("text-sm font-semibold", meta.text)}>{meta.label}</p>
        </div>
        <span className={clsx("badge text-xs",
          state === "full"    ? "bg-danger/10 text-danger"
          : state === "warning" ? "bg-warning/10 text-warning"
          : "bg-success/10 text-success"
        )}>{state}</span>
      </div>

      {/* Big depth number */}
      <p className={clsx("text-4xl font-semibold", meta.text)}>{data.depth}</p>
      <p className="text-xs text-muted">items queued</p>

      {/* Capacity bar */}
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-muted">
          <span>capacity</span>
          <span>{pct.toFixed(1)}%</span>
        </div>
        <div className="bg-dim rounded-full h-1.5 overflow-hidden">
          <div className={clsx("h-full rounded-full transition-all duration-500", meta.color)}
            style={{ width: `${pct}%` }} />
        </div>
        <p className="text-xs text-muted text-right">{data.capacity.toLocaleString()} max</p>
      </div>
    </div>
  );
}

export default function QueueMonitorPanel() {
  const { queueState } = useRuntimeStore();
  const total = Object.values(queueState).reduce((s, q) => s + q.depth, 0);

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="panel p-4 flex items-center justify-between">
        <div>
          <p className="text-xs text-muted uppercase tracking-widest">Total Queued</p>
          <p className="text-3xl font-semibold text-white">{total}</p>
        </div>
        <div className="grid grid-cols-4 gap-6 text-center">
          {Object.entries(queueState).map(([name, data]) => (
            <div key={name}>
              <p className={clsx("text-lg font-semibold", QUEUE_META[name]?.text ?? "text-muted")}>{data.depth}</p>
              <p className="text-xs text-muted capitalize">{name}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Queue cards */}
      <div className="grid grid-cols-2 gap-3">
        {Object.entries(queueState).map(([name, data]) => (
          <QueueCard key={name} name={name} data={data} />
        ))}
      </div>

      {/* Queue routing legend */}
      <div className="panel p-4 space-y-2">
        <p className="text-xs text-muted uppercase tracking-widest">Routing Rules</p>
        <div className="grid grid-cols-2 gap-2 text-xs text-muted">
          <p><span className="text-danger font-medium">priority</span> — emergency / critical priority class</p>
          <p><span className="text-orange-400 font-medium">recovery</span> — recovery=true flag set</p>
          <p><span className="text-warning font-medium">retry</span> — retryCount &gt; 0</p>
          <p><span className="text-accent font-medium">default</span> — normal / high / low urgency</p>
        </div>
      </div>
    </div>
  );
}
