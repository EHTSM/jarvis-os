import React, { useMemo } from "react";

function fmtAge(dateStr) {
  if (!dateStr) return "—";
  const secs = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (secs < 60)   return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h < 24) return `${h}h${m > 0 ? ` ${m}m` : ""}`;
  return `${Math.floor(h / 24)}d`;
}

function statusOrder(s) {
  return { running: 0, pending: 1, failed: 2, completed: 3 }[s] ?? 4;
}

export default function TaskQueuePanel({ tasks }) {
  const list = useMemo(() => {
    if (!tasks?.tasks) return [];
    return [...tasks.tasks].sort((a, b) => statusOrder(a.status) - statusOrder(b.status));
  }, [tasks]);

  const counts = useMemo(() => {
    const c = { pending: 0, running: 0, failed: 0, completed: 0 };
    list.forEach(t => { if (c[t.status] !== undefined) c[t.status]++; });
    return c;
  }, [list]);

  return (
    <div className="op-panel" style={{ height: "100%" }}>
      <div className="op-panel-header">
        <span className="op-panel-title">Task Queue</span>
        <span className="op-panel-meta">
          {counts.running > 0 && <span style={{ color: "var(--op-green)", marginRight: 6 }}>▶ {counts.running}</span>}
          {counts.pending > 0 && <span style={{ color: "var(--op-accent)", marginRight: 6 }}>● {counts.pending}</span>}
          {counts.failed  > 0 && <span style={{ color: "var(--op-red)" }}>✗ {counts.failed}</span>}
        </span>
      </div>
      <div className="op-panel-body">
        {!tasks && (
          <div className="op-loading" />
        )}
        {tasks && list.length === 0 && (
          <div className="op-log-empty">No tasks</div>
        )}
        {list.map(task => (
          <div key={task.id} className="op-task op-fade-in">
            <div className="op-task-header">
              <span className={`op-badge ${task.status}`}>{task.status}</span>
              <span className="op-task-input" title={task.input}>{task.input}</span>
              <span className="op-task-age">{fmtAge(task.createdAt)}</span>
            </div>
            <div className="op-task-meta">
              <span className="op-badge type">{task.type || "auto"}</span>
              {task.retries > 0 && (
                <span style={{ fontSize: 10, color: "var(--op-amber)" }}>
                  retry {task.retries}/{task.maxRetries ?? "?"}
                  {task.scheduledFor && task.status === "pending" && (
                    <> · next {fmtAge(task.scheduledFor)}</>
                  )}
                </span>
              )}
              {task.lastError && (
                <span
                  style={{ fontSize: 10, color: "var(--op-red)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140 }}
                  title={task.lastError}
                >
                  {task.lastError.slice(0, 50)}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
