import React, { useState, useEffect, useCallback, useRef } from 'react';
import { _fetch } from '../_client';
import './VisualArchitecture.css';

async function apiFetch(path) {
  return _fetch(path);
}

function useGraph(path, interval = 10000) {
  const [data,    setData]    = useState(null);
  const [error,   setError]   = useState(null);
  const [loading, setLoading] = useState(true);

  const run = useCallback(async () => {
    try { setData(await apiFetch(path)); setError(null); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [path]);

  useEffect(() => { run(); const id = setInterval(run, interval); return () => clearInterval(id); }, [run, interval]);
  return { data, error, loading, refresh: run };
}

// ── Simple SVG graph renderer ──────────────────────────────────────────
function GraphCanvas({ nodes = [], edges = [], onNodeClick, highlighted }) {
  const svgRef   = useRef(null);
  const [pan, setPan]   = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const dragging = useRef(false);
  const last     = useRef({ x: 0, y: 0 });

  // Simple force-layout: nodes spread in circle
  const positioned = nodes.map((n, i) => {
    const angle = (i / nodes.length) * 2 * Math.PI;
    const r     = Math.min(200, 50 * nodes.length / Math.PI);
    return {
      ...n,
      cx: 300 + r * Math.cos(angle),
      cy: 200 + r * Math.sin(angle),
    };
  });

  const posMap = Object.fromEntries(positioned.map(n => [n.id, n]));

  const onWheel = (e) => {
    e.preventDefault();
    setZoom(z => Math.max(0.3, Math.min(3, z - e.deltaY * 0.001)));
  };

  const onMouseDown = (e) => {
    dragging.current = true;
    last.current = { x: e.clientX, y: e.clientY };
  };
  const onMouseMove = (e) => {
    if (!dragging.current) return;
    setPan(p => ({ x: p.x + e.clientX - last.current.x, y: p.y + e.clientY - last.current.y }));
    last.current = { x: e.clientX, y: e.clientY };
  };
  const onMouseUp = () => { dragging.current = false; };

  const NODE_COLORS = {
    service: '#10b981', agent: '#60a5fa', queue: '#fbbf24',
    database: '#a78bfa', api: '#34d399', module: '#6b7280',
  };

  if (!nodes.length) return <div className="va-canvas-empty">No graph data available.</div>;

  return (
    <svg
      ref={svgRef}
      className="va-canvas"
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
    >
      <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
        {/* Edges */}
        {edges.map((e, i) => {
          const from = posMap[e.from];
          const to   = posMap[e.to];
          if (!from || !to) return null;
          return (
            <line
              key={i}
              x1={from.cx} y1={from.cy}
              x2={to.cx}   y2={to.cy}
              stroke="#2d3748" strokeWidth="1.5"
              markerEnd="url(#arrow)"
              opacity={highlighted && e.from !== highlighted && e.to !== highlighted ? 0.2 : 1}
            />
          );
        })}
        {/* Nodes */}
        {positioned.map(n => {
          const color = NODE_COLORS[n.type] || '#6b7280';
          const isHighlighted = highlighted === n.id;
          return (
            <g key={n.id} onClick={() => onNodeClick?.(n)} style={{ cursor: 'pointer' }}>
              <circle
                cx={n.cx} cy={n.cy} r={isHighlighted ? 22 : 18}
                fill={`${color}20`} stroke={color}
                strokeWidth={isHighlighted ? 2.5 : 1.5}
              />
              <text
                x={n.cx} y={n.cy}
                textAnchor="middle" dominantBaseline="middle"
                fill={color} fontSize="8" fontWeight="600"
                style={{ userSelect: 'none', pointerEvents: 'none' }}
              >
                {(n.label || n.id || '').slice(0, 12)}
              </text>
              <text
                x={n.cx} y={n.cy + 28}
                textAnchor="middle"
                fill="#4b5563" fontSize="7"
                style={{ userSelect: 'none', pointerEvents: 'none' }}
              >
                {n.type}
              </text>
            </g>
          );
        })}
        <defs>
          <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L0,6 L6,3 z" fill="#374151" />
          </marker>
        </defs>
      </g>
    </svg>
  );
}

// ── Graph view wrapper ─────────────────────────────────────────────────
function GraphView({ path, title }) {
  const { data, error, loading, refresh } = useGraph(path);
  const [selected, setSelected] = useState(null);
  const nodes = data?.nodes || [];
  const edges = data?.edges || [];

  if (loading) return <div className="va-empty">Loading {title}…</div>;
  if (error)   return <div className="va-error">{title} unavailable: {error}</div>;

  return (
    <div className="va-graph-view">
      <div className="va-graph-toolbar">
        <span className="va-graph-title">{title}</span>
        <span className="va-graph-count">{nodes.length} nodes · {edges.length} edges</span>
        <button className="va-btn" onClick={refresh}>↻</button>
        {selected && <button className="va-btn" onClick={() => setSelected(null)}>✕ Deselect</button>}
      </div>
      <GraphCanvas
        nodes={nodes}
        edges={edges}
        highlighted={selected?.id}
        onNodeClick={n => setSelected(n === selected ? null : n)}
      />
      {selected && (
        <div className="va-node-detail">
          <div className="va-node-detail__header">
            <strong>{selected.label || selected.id}</strong>
            <span className="va-node-type">{selected.type}</span>
          </div>
          {selected.meta && (
            <pre className="va-node-detail__meta">{JSON.stringify(selected.meta, null, 2)}</pre>
          )}
        </div>
      )}
    </div>
  );
}

// ── Service health map ─────────────────────────────────────────────────
function ServiceHealthMap() {
  const { data, error, loading, refresh } = useGraph('/runtime/health/services', 5000);
  const services = Array.isArray(data) ? data : (data?.services || []);

  if (loading) return <div className="va-empty">Loading services…</div>;
  if (error)   return <div className="va-error">Health map unavailable: {error}</div>;
  if (!services.length) return <div className="va-empty">No service health data.</div>;

  return (
    <div className="va-health-map">
      <div className="va-graph-toolbar">
        <span className="va-graph-title">Service Health</span>
        <span className="va-graph-count">{services.length} services</span>
        <button className="va-btn" onClick={refresh}>↻</button>
      </div>
      <div className="va-health-grid">
        {services.map((s, i) => {
          const ok = s.status === 'ok' || s.status === 'healthy' || s.status === 'up';
          const warn = s.status === 'degraded' || s.status === 'warn';
          return (
            <div key={i} className={`va-service-tile${ok ? ' va-service-tile--ok' : warn ? ' va-service-tile--warn' : ' va-service-tile--err'}`}>
              <div className="va-service-tile__name">{s.name || s.service || '?'}</div>
              <div className={`va-service-tile__dot va-service-tile__dot--${ok ? 'ok' : warn ? 'warn' : 'err'}`} />
              <div className="va-service-tile__status">{s.status}</div>
              {s.latency != null && <div className="va-service-tile__meta">{s.latency}ms</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────
const TABS = [
  { id: 'deps',     label: 'Dependency Graph' },
  { id: 'modules',  label: 'Module Graph' },
  { id: 'agents',   label: 'Agent Communication' },
  { id: 'topology', label: 'Runtime Topology' },
  { id: 'health',   label: 'Service Health' },
  { id: 'knowledge',label: 'Knowledge Graph' },
];

const PATHS = {
  deps:      '/runtime/graph/dependencies',
  modules:   '/runtime/graph/modules',
  agents:    '/runtime/graph/agents',
  topology:  '/runtime/graph/topology',
  knowledge: '/runtime/graph/knowledge',
};

export default function VisualArchitecture({ className = '' }) {
  const [tab, setTab] = useState('health');

  return (
    <div className={`visual-architecture ${className}`}>
      <div className="va-header">
        <span className="va-header__title">Visual Architecture</span>
      </div>
      <div className="va-tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`va-tab${tab === t.id ? ' va-tab--active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="va-body">
        {tab === 'health'
          ? <ServiceHealthMap />
          : <GraphView path={PATHS[tab]} title={TABS.find(t => t.id === tab)?.label} />
        }
      </div>
    </div>
  );
}
