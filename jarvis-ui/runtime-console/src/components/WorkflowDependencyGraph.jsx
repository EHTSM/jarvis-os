import { useRuntimeStore } from "../store/runtimeStore.js";
import { useState } from "react";
import clsx from "clsx";

const STATUS_STYLE = {
  completed: { fill: "#22c55e20", stroke: "#22c55e", text: "#22c55e" },
  executing: { fill: "#3b82f620", stroke: "#3b82f6", text: "#3b82f6" },
  queued:    { fill: "#1e253580", stroke: "#64748b", text: "#64748b" },
  failed:    { fill: "#ef444420", stroke: "#ef4444", text: "#ef4444" },
};

const ADAPTER_ICONS = {
  terminal: "⌨", filesystem: "📁", git: "⎇", vscode: "🔵",
  docker: "🐋", browser: "🌐",
};

export default function WorkflowDependencyGraph() {
  const { workflowGraph } = useRuntimeStore();
  const [hovered, setHovered] = useState(null);
  const { nodes = [], edges = [] } = workflowGraph ?? {};

  const NODE_W = 140, NODE_H = 44;

  return (
    <div className="space-y-4">
      <div className="panel p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted uppercase tracking-widest">Workflow Dependency Graph</p>
          <div className="flex gap-3">
            {Object.entries(STATUS_STYLE).map(([s, st]) => (
              <div key={s} className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full" style={{ background: st.stroke }} />
                <span className="text-xs text-muted">{s}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <svg width="640" height="440" className="w-full" viewBox="0 0 640 440">
            <defs>
              <marker id="arrowhead" markerWidth="8" markerHeight="6"
                refX="8" refY="3" orient="auto">
                <polygon points="0 0, 8 3, 0 6" fill="#1e2535" />
              </marker>
            </defs>

            {/* Edges */}
            {edges.map((e, i) => {
              const from = nodes.find(n => n.id === e.from);
              const to   = nodes.find(n => n.id === e.to);
              if (!from || !to) return null;
              const x1 = from.x + NODE_W, y1 = from.y + NODE_H / 2;
              const x2 = to.x,            y2 = to.y   + NODE_H / 2;
              const cx1 = x1 + (x2 - x1) * 0.5, cx2 = x2 - (x2 - x1) * 0.5;
              return (
                <path key={i}
                  d={`M ${x1} ${y1} C ${cx1} ${y1}, ${cx2} ${y2}, ${x2} ${y2}`}
                  fill="none" stroke="#1e2535" strokeWidth="1.5"
                  markerEnd="url(#arrowhead)"
                />
              );
            })}

            {/* Nodes */}
            {nodes.map(n => {
              const style = STATUS_STYLE[n.status] ?? STATUS_STYLE.queued;
              const isHov = hovered === n.id;
              return (
                <g key={n.id}
                  transform={`translate(${n.x}, ${n.y})`}
                  onMouseEnter={() => setHovered(n.id)}
                  onMouseLeave={() => setHovered(null)}
                  style={{ cursor: "pointer" }}
                >
                  <rect
                    width={NODE_W} height={NODE_H} rx="6"
                    fill={style.fill}
                    stroke={isHov ? "#3b82f6" : style.stroke}
                    strokeWidth={isHov ? 2 : 1.5}
                  />
                  {/* Status dot */}
                  <circle cx="12" cy={NODE_H / 2} r="4" fill={style.stroke} />
                  {/* Label */}
                  <text x="24" y="16" fontSize="9" fill={style.text} fontWeight="600"
                    fontFamily="JetBrains Mono, monospace">
                    {n.id}
                  </text>
                  <text x="24" y="31" fontSize="9" fill="#94a3b8"
                    fontFamily="JetBrains Mono, monospace">
                    {ADAPTER_ICONS[n.adapterType] ?? "•"} {n.label}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      {/* Node detail */}
      {hovered && (() => {
        const n = nodes.find(nd => nd.id === hovered);
        const deps = edges.filter(e => e.to === hovered).map(e => e.from);
        const blocks = edges.filter(e => e.from === hovered).map(e => e.to);
        if (!n) return null;
        return (
          <div className="panel p-4 grid grid-cols-3 gap-4 text-xs">
            <div>
              <p className="text-muted mb-1">Execution</p>
              <p className="text-accent font-mono">{n.id}</p>
            </div>
            <div>
              <p className="text-muted mb-1">Status</p>
              <p style={{ color: STATUS_STYLE[n.status]?.stroke }}>{n.status}</p>
            </div>
            <div>
              <p className="text-muted mb-1">Adapter</p>
              <p className="text-white">{ADAPTER_ICONS[n.adapterType]} {n.adapterType}</p>
            </div>
            <div>
              <p className="text-muted mb-1">Depends on</p>
              <p className="text-white">{deps.length ? deps.join(", ") : "—"}</p>
            </div>
            <div>
              <p className="text-muted mb-1">Blocks</p>
              <p className="text-white">{blocks.length ? blocks.join(", ") : "—"}</p>
            </div>
            <div>
              <p className="text-muted mb-1">Capability</p>
              <p className="text-white">{n.label}</p>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
