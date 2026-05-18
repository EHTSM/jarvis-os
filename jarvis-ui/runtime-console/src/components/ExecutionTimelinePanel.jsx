import { useState } from "react";
import { useRuntimeStore } from "../store/runtimeStore.js";
import clsx from "clsx";

const STAGE_COLORS = {
  queued:     "bg-muted",
  validated:  "bg-blue-400",
  authorized: "bg-indigo-400",
  sandboxed:  "bg-purple-400",
  executing:  "bg-accent",
  waiting:    "bg-yellow-500",
  retrying:   "bg-warning",
  recovering: "bg-orange-400",
  completed:  "bg-success",
  failed:     "bg-danger",
  quarantined:"bg-red-700",
  cancelled:  "bg-muted",
};

function TimelineRow({ entry, selected, onClick }) {
  if (!entry.stages || entry.stages.length === 0) return null;

  const total  = entry.stages.reduce((s, st) => s + (st.durationMs ?? 0), 0);
  const term   = entry.terminalState;

  return (
    <div
      className={clsx("panel p-3 cursor-pointer transition-colors hover:border-accent/60",
        selected && "border-accent/80"
      )}
      onClick={onClick}
    >
      <div className="flex items-start justify-between mb-2">
        <div>
          <p className="text-xs font-mono text-accent">{entry.executionId}</p>
          <p className="text-xs text-muted">{entry.workflowId} · {entry.adapterType}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={clsx("badge",
            term === "completed" ? "bg-success/10 text-success"
            : term === "failed"  ? "bg-danger/10  text-danger"
            : "bg-muted/10 text-muted"
          )}>{term}</span>
          <span className="text-xs text-muted">{total}ms</span>
        </div>
      </div>

      {/* Timeline bar */}
      <div className="flex h-5 rounded overflow-hidden gap-px">
        {entry.stages.map((st, i) => {
          const w = total > 0 ? (st.durationMs / total) * 100 : 100 / entry.stages.length;
          return (
            <div key={i}
              className={clsx("timeline-bar", STAGE_COLORS[st.stage] ?? "bg-muted")}
              style={{ width: `${w}%` }}
              title={`${st.stage}: ${st.durationMs}ms`}
            />
          );
        })}
      </div>

      {/* Stage labels */}
      {selected && (
        <div className="mt-3 space-y-1">
          {entry.stages.map((st, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <div className={clsx("w-2 h-2 rounded-full flex-shrink-0", STAGE_COLORS[st.stage] ?? "bg-muted")} />
              <span className="text-muted w-20">{st.stage}</span>
              <span className="text-white">{st.durationMs}ms</span>
              <span className="text-muted text-xs">{st.timestamp?.slice(11, 23)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ExecutionTimelinePanel() {
  const { timelineEntries } = useRuntimeStore();
  const [selected, setSelected] = useState(null);
  const [filter, setFilter]     = useState("all");

  const filtered = filter === "all" ? timelineEntries
    : timelineEntries.filter(e => e.terminalState === filter);

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="panel p-3 flex items-center gap-2">
        <p className="text-xs text-muted uppercase tracking-widest mr-2">Filter</p>
        {["all", "completed", "failed"].map(f => (
          <button key={f}
            onClick={() => setFilter(f)}
            className={clsx("px-3 py-1 rounded text-xs font-medium transition-colors",
              filter === f ? "bg-accent text-white" : "bg-dim text-muted hover:text-white"
            )}
          >{f}</button>
        ))}
        <span className="ml-auto text-xs text-muted">{filtered.length} entries</span>
      </div>

      {/* Legend */}
      <div className="panel p-3 flex flex-wrap gap-3">
        {Object.entries(STAGE_COLORS).slice(0, 8).map(([stage, color]) => (
          <div key={stage} className="flex items-center gap-1.5">
            <div className={clsx("w-2 h-2 rounded-full", color)} />
            <span className="text-xs text-muted">{stage}</span>
          </div>
        ))}
      </div>

      {/* Timeline list */}
      <div className="space-y-2 max-h-[calc(100vh-320px)] overflow-y-auto pr-1">
        {filtered.map(e => (
          <TimelineRow
            key={e.executionId}
            entry={e}
            selected={selected === e.executionId}
            onClick={() => setSelected(s => s === e.executionId ? null : e.executionId)}
          />
        ))}
        {filtered.length === 0 && (
          <div className="panel p-8 text-center text-muted text-xs">No entries match filter.</div>
        )}
      </div>
    </div>
  );
}
