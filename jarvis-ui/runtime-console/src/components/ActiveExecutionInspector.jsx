import { useState } from "react";
import { useRuntimeStore } from "../store/runtimeStore.js";
import clsx from "clsx";

const STAGE_COLOR = {
  executing: "text-success", sandboxed: "text-accent",
  authorized: "text-indigo-400", validated: "text-blue-400",
  queued: "text-muted",
};

const RISK_COLOR = (r) => r > 0.7 ? "text-danger" : r > 0.4 ? "text-warning" : "text-success";

function Inspector({ ex, onClose }) {
  return (
    <div className="panel p-4 space-y-4 border-accent/60">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-muted">Execution</p>
          <p className="text-lg font-mono text-accent">{ex.executionId}</p>
        </div>
        <button onClick={onClose} className="text-muted hover:text-white text-lg">✕</button>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        {[
          ["Workflow",   ex.workflowId],
          ["Adapter",    ex.adapterType],
          ["Capability", ex.capability],
          ["Subsystem",  ex.subsystem],
          ["Authority",  ex.authorityLevel],
          ["Stage",      ex.stage, STAGE_COLOR[ex.stage] ?? "text-white"],
          ["Priority",   ex.priorityClass],
          ["Retries",    ex.retryCount],
        ].map(([label, value, cls]) => (
          <div key={label}>
            <p className="text-muted">{label}</p>
            <p className={clsx("font-medium", cls ?? "text-white")}>{value ?? "—"}</p>
          </div>
        ))}
      </div>

      <div className="border-t border-border pt-3 grid grid-cols-3 gap-3 text-xs">
        <div>
          <p className="text-muted">Risk Score</p>
          <p className={clsx("text-lg font-semibold", RISK_COLOR(ex.riskScore))}>
            {ex.riskScore?.toFixed(2)}
          </p>
        </div>
        <div>
          <p className="text-muted">Elapsed</p>
          <p className="text-lg font-semibold text-white">
            {(ex.elapsedMs / 1000).toFixed(2)}s
          </p>
        </div>
        <div>
          <p className="text-muted">Started</p>
          <p className="text-white">{ex.startedAt?.slice(11, 19)}</p>
        </div>
      </div>

      {/* Risk bar */}
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-muted">
          <span>Risk</span>
          <span>{(ex.riskScore * 100).toFixed(0)}%</span>
        </div>
        <div className="bg-dim rounded-full h-2 overflow-hidden">
          <div className={clsx("h-full rounded-full transition-all",
            ex.riskScore > 0.7 ? "bg-danger" : ex.riskScore > 0.4 ? "bg-warning" : "bg-success"
          )} style={{ width: `${ex.riskScore * 100}%` }} />
        </div>
      </div>
    </div>
  );
}

export default function ActiveExecutionInspector() {
  const { activeExecutions } = useRuntimeStore();
  const [selected, setSelected] = useState(null);

  const selEx = activeExecutions.find(e => e.executionId === selected);

  return (
    <div className="space-y-4">
      <div className="panel p-3 flex items-center justify-between">
        <p className="text-xs text-muted uppercase tracking-widest">
          Active Executions — {activeExecutions.length} running
        </p>
        <span className="text-xs text-muted">click row to inspect</span>
      </div>

      <div className="grid grid-cols-1 gap-2">
        {activeExecutions.map(ex => (
          <div key={ex.executionId}
            onClick={() => setSelected(s => s === ex.executionId ? null : ex.executionId)}
            className={clsx(
              "panel p-3 cursor-pointer hover:border-accent/50 transition-colors grid grid-cols-6 gap-2 items-center text-xs",
              selected === ex.executionId && "border-accent/80"
            )}
          >
            <p className="font-mono text-accent truncate">{ex.executionId}</p>
            <p className="text-muted truncate">{ex.workflowId}</p>
            <span className="badge bg-accent/10 text-accent w-fit">{ex.adapterType}</span>
            <span className={clsx("badge w-fit",
              ex.stage === "executing" ? "bg-success/10 text-success"
              : "bg-muted/10 text-muted"
            )}>{ex.stage}</span>
            <div className="flex items-center gap-1.5">
              <div className="bg-dim rounded-full h-1 flex-1 overflow-hidden">
                <div className={clsx("h-full",
                  ex.riskScore > 0.7 ? "bg-danger" : ex.riskScore > 0.4 ? "bg-warning" : "bg-success"
                )} style={{ width: `${ex.riskScore * 100}%` }} />
              </div>
              <span className="text-muted w-6">{(ex.riskScore * 100).toFixed(0)}</span>
            </div>
            <p className="text-muted text-right">{(ex.elapsedMs / 1000).toFixed(1)}s</p>
          </div>
        ))}
      </div>

      {selEx && (
        <Inspector ex={selEx} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
