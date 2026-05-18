import { useRuntimeStore } from "../store/runtimeStore.js";
import clsx from "clsx";

const EVENT_META = {
  execution_submitted:  { icon: "→", color: "text-accent"      },
  execution_completed:  { icon: "✓", color: "text-success"     },
  execution_failed:     { icon: "✗", color: "text-danger"      },
  workflow_started:     { icon: "▶", color: "text-accent"      },
  workflow_completed:   { icon: "◼", color: "text-success"     },
  policy_event:         { icon: "⚑", color: "text-warning"     },
  circuit_event:        { icon: "⚡", color: "text-orange-400"  },
  sandbox_event:        { icon: "⬡", color: "text-indigo-400"  },
  recovery_event:       { icon: "↺", color: "text-orange-400"  },
  audit_event:          { icon: "⊞", color: "text-muted"       },
};

function FeedRow({ event }) {
  const meta = EVENT_META[event.eventType] ?? { icon: "•", color: "text-muted" };
  const ts   = event.timestamp?.slice(11, 23) ?? "";

  return (
    <div className="flex items-start gap-3 py-1.5 border-b border-border/30 hover:bg-dim/30 px-2 rounded">
      <span className={clsx("text-sm w-4 flex-shrink-0 font-mono mt-px", meta.color)}>{meta.icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={clsx("text-xs font-medium", meta.color)}>{event.eventType}</span>
          <span className="badge bg-accent/10 text-accent text-xs">{event.adapterType}</span>
          <span className="text-xs text-muted">{event.subsystem}</span>
        </div>
        <p className="text-xs text-muted truncate">{event.workflowId}</p>
      </div>
      <span className="text-xs text-muted flex-shrink-0 font-mono">{ts}</span>
    </div>
  );
}

export default function AgentActivityFeed() {
  const { agentFeed, paused, setPaused } = useRuntimeStore();

  const byType = agentFeed.reduce((acc, e) => {
    acc[e.eventType] = (acc[e.eventType] ?? 0) + 1;
    return acc;
  }, {});

  const successes = agentFeed.filter(e => e.outcome === "completed" || e.outcome === "ok").length;
  const failures  = agentFeed.filter(e => e.outcome === "failed").length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="panel p-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className={clsx("pulse-dot", paused ? "bg-warning" : "bg-success")} />
          <p className="text-xs text-muted uppercase tracking-widest">
            Agent Activity Feed
          </p>
          <span className="text-xs text-muted">({agentFeed.length} events)</span>
        </div>
        <button
          onClick={() => setPaused(!paused)}
          className={clsx("text-xs px-3 py-1 rounded transition-colors",
            paused ? "bg-success/10 text-success hover:bg-success/20"
                   : "bg-warning/10 text-warning hover:bg-warning/20"
          )}
        >
          {paused ? "▶ Resume" : "⏸ Pause"}
        </button>
      </div>

      {/* Mini stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="panel p-3 text-center">
          <p className="text-xl font-semibold text-success">{successes}</p>
          <p className="text-xs text-muted">successes</p>
        </div>
        <div className="panel p-3 text-center">
          <p className="text-xl font-semibold text-danger">{failures}</p>
          <p className="text-xs text-muted">failures</p>
        </div>
        <div className="panel p-3 text-center">
          <p className="text-xl font-semibold text-accent">{Object.keys(byType).length}</p>
          <p className="text-xs text-muted">event types</p>
        </div>
      </div>

      {/* Feed */}
      <div className="panel p-2 max-h-[calc(100vh-360px)] overflow-y-auto">
        {agentFeed.map(e => <FeedRow key={e.id} event={e} />)}
      </div>

      {/* Frequency breakdown */}
      <div className="panel p-4 space-y-2">
        <p className="text-xs text-muted uppercase tracking-widest">Event Frequency</p>
        <div className="space-y-1.5">
          {Object.entries(byType).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([type, count]) => {
            const meta = EVENT_META[type] ?? { color: "text-muted" };
            const pct  = agentFeed.length > 0 ? (count / agentFeed.length) * 100 : 0;
            return (
              <div key={type} className="flex items-center gap-2">
                <p className={clsx("text-xs w-40 truncate", meta.color)}>{type}</p>
                <div className="flex-1 bg-dim rounded-full h-1 overflow-hidden">
                  <div className="h-full bg-accent/50 rounded-full" style={{ width: `${pct}%` }} />
                </div>
                <span className="text-xs text-muted w-6 text-right">{count}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
