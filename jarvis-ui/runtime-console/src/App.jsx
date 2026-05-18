import { useEffect } from "react";
import { useRuntimeStore, startRuntimePolling } from "./store/runtimeStore.js";
import clsx from "clsx";

import RuntimeOverviewDashboard   from "./components/RuntimeOverviewDashboard.jsx";
import QueueMonitorPanel          from "./components/QueueMonitorPanel.jsx";
import ExecutionTimelinePanel     from "./components/ExecutionTimelinePanel.jsx";
import WorkflowDependencyGraph    from "./components/WorkflowDependencyGraph.jsx";
import RuntimePressureMonitor     from "./components/RuntimePressureMonitor.jsx";
import ActiveExecutionInspector   from "./components/ActiveExecutionInspector.jsx";
import AgentActivityFeed          from "./components/AgentActivityFeed.jsx";
import RecoveryAndRetryPanel      from "./components/RecoveryAndRetryPanel.jsx";
import OrchestrationHealthPanel   from "./components/OrchestrationHealthPanel.jsx";
import RuntimeMetricsAggregator   from "./components/RuntimeMetricsAggregator.jsx";

const TABS = [
  { id: "overview",    label: "Overview",      icon: "⊞" },
  { id: "queues",      label: "Queues",         icon: "≡" },
  { id: "timeline",    label: "Timeline",       icon: "⏱" },
  { id: "graph",       label: "DAG",            icon: "⎇" },
  { id: "pressure",    label: "Pressure",       icon: "⚡" },
  { id: "executions",  label: "Executions",     icon: "▶" },
  { id: "feed",        label: "Activity",       icon: "◉" },
  { id: "recovery",    label: "Recovery",       icon: "↺" },
  { id: "health",      label: "Health",         icon: "♡" },
  { id: "metrics",     label: "Metrics",        icon: "◈" },
];

const PANEL_MAP = {
  overview:   RuntimeOverviewDashboard,
  queues:     QueueMonitorPanel,
  timeline:   ExecutionTimelinePanel,
  graph:      WorkflowDependencyGraph,
  pressure:   RuntimePressureMonitor,
  executions: ActiveExecutionInspector,
  feed:       AgentActivityFeed,
  recovery:   RecoveryAndRetryPanel,
  health:     OrchestrationHealthPanel,
  metrics:    RuntimeMetricsAggregator,
};

export default function App() {
  const { activeTab, setTab, paused, setPaused, pressureState, tickCount } = useRuntimeStore();

  useEffect(() => {
    const stop = startRuntimePolling(2000);
    return stop;
  }, []);

  const ActivePanel = PANEL_MAP[activeTab] ?? RuntimeOverviewDashboard;

  const pressureColor = {
    nominal: "text-success", elevated: "text-warning",
    active: "text-orange-400", critical: "text-danger",
  }[pressureState.state] ?? "text-muted";

  return (
    <div className="min-h-screen bg-surface flex flex-col">
      {/* Top bar */}
      <header className="border-b border-border px-4 py-2.5 flex items-center gap-4 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-accent font-bold tracking-wider text-sm">JARVIS</span>
          <span className="text-muted text-xs">runtime console</span>
        </div>

        <div className="flex items-center gap-1.5 ml-4">
          <span className={clsx("pulse-dot", paused ? "bg-warning" : "bg-success")} />
          <span className="text-xs text-muted">{paused ? "paused" : "live"}</span>
        </div>

        <div className="flex items-center gap-2 ml-2">
          <span className="text-xs text-muted">pressure:</span>
          <span className={clsx("text-xs font-semibold", pressureColor)}>
            {pressureState.state}
          </span>
          <span className="text-xs text-muted">
            ({(pressureState.errorRate * 100).toFixed(1)}%)
          </span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted font-mono">tick #{tickCount}</span>
          <button
            onClick={() => setPaused(!paused)}
            className={clsx("text-xs px-3 py-1 rounded border transition-colors",
              paused
                ? "border-success/40 text-success hover:bg-success/10"
                : "border-warning/40 text-warning hover:bg-warning/10"
            )}
          >
            {paused ? "▶ Resume" : "⏸ Pause"}
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar nav */}
        <nav className="w-36 border-r border-border flex-shrink-0 py-3 flex flex-col gap-1 px-2">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setTab(tab.id)}
              className={clsx(
                "flex items-center gap-2 px-2 py-2 rounded text-xs transition-colors text-left w-full",
                activeTab === tab.id
                  ? "bg-accent/15 text-accent"
                  : "text-muted hover:text-white hover:bg-dim"
              )}
            >
              <span className="w-4 text-center">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </nav>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto p-4">
          <ActivePanel />
        </main>
      </div>
    </div>
  );
}
