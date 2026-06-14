import React, { useState, useEffect, useCallback, useRef, memo, useMemo } from 'react';
import { useVirtualList, VirtualRow } from '../hooks/useVirtualList';
import { useThrottledCallback } from '../hooks/useStableCallback';
import { useLowMemoryGuard } from '../hooks/useResourceManager';
import './EngineeringConsole.css';

const LOG_ITEM_HEIGHT = 18; // px per log line

const BACKEND = 'http://localhost:5050';
const isElectron = () => !!window.electronAPI?.isElectron;

// ── Utility ──────────────────────────────────────────────────────────
function useInterval(fn, delay) {
  const saved = useRef(fn);
  useEffect(() => { saved.current = fn; }, [fn]);
  useEffect(() => {
    if (!delay) return;
    const id = setInterval(() => saved.current(), delay);
    return () => clearInterval(id);
  }, [delay]);
}

// ── Log viewer ────────────────────────────────────────────────────────
const LogLine = memo(function LogLine({ line }) {
  const isErr  = /error|ERR|FAIL/i.test(line);
  const isWarn = /warn|WARN/i.test(line);
  const isInfo = /info|INFO/i.test(line);
  const cls = isErr ? 'log-line--error' : isWarn ? 'log-line--warn' : isInfo ? 'log-line--info' : '';
  return <div className={`log-line ${cls}`}>{line}</div>;
});

function RuntimeLogs() {
  const [lines,  setLines]  = useState([]);
  const [follow, setFollow] = useState(true);
  const [filter, setFilter] = useState('');
  const esRef = useRef(null);

  // Trim buffer to 200 lines on memory pressure to free heap
  useLowMemoryGuard(() => setLines(l => l.slice(-200)));

  useEffect(() => {
    const es = new EventSource(`${BACKEND}/runtime/stream`, { withCredentials: true });
    esRef.current = es;
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        const text = typeof data === 'string' ? data : (data.message || data.log || JSON.stringify(data));
        setLines(l => [...l.slice(-2000), text]);
      } catch {
        setLines(l => [...l.slice(-2000), e.data]);
      }
    };
    es.onerror = () => setLines(l => [...l, '[SSE disconnected]']);
    return () => es.close();
  }, []);

  const visible = filter
    ? lines.filter(l => l.toLowerCase().includes(filter.toLowerCase()))
    : lines;

  const { containerRef, outerStyle, innerStyle, virtualItems } = useVirtualList({
    itemCount: visible.length,
    itemHeight: LOG_ITEM_HEIGHT,
    overscan: 10,
  });

  // Auto-scroll to bottom when following
  useEffect(() => {
    if (!follow) return;
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [visible.length, follow]); // eslint-disable-line

  return (
    <div className="ec-logs">
      <div className="ec-logs__toolbar">
        <input
          className="ec-filter-input"
          placeholder={`Filter… (${visible.length} lines)`}
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
        <label className="ec-toggle">
          <input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)} />
          Follow
        </label>
        <button className="ec-btn" onClick={() => setLines([])}>Clear</button>
      </div>
      {/* Virtualized log body */}
      <div ref={containerRef} style={{ ...outerStyle, flex: 1 }}>
        {visible.length === 0 ? (
          <div className="ec-empty">No log output yet. Connecting to /runtime/stream…</div>
        ) : (
          <div style={innerStyle}>
            {virtualItems.map(item => (
              <VirtualRow key={item.index} top={item.top} height={LOG_ITEM_HEIGHT}>
                <LogLine line={visible[item.index]} />
              </VirtualRow>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── PM2 monitor ───────────────────────────────────────────────────────
function PM2Monitor() {
  const [procs, setProcs] = useState([]);
  const [err, setErr]     = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchProcs = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND}/runtime/pm2/list`, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setProcs(Array.isArray(data) ? data : (data.processes || []));
      setErr(null);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchProcs(); }, [fetchProcs]);
  useInterval(fetchProcs, 5000);

  const action = useCallback(async (name, cmd) => {
    try {
      await fetch(`${BACKEND}/runtime/pm2/${cmd}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      setTimeout(fetchProcs, 800);
    } catch {}
  }, [fetchProcs]);

  if (loading) return <div className="ec-empty">Loading processes…</div>;
  if (err) return <div className="ec-error">PM2 unavailable: {err}</div>;
  if (!procs.length) return <div className="ec-empty">No PM2 processes running.</div>;

  return (
    <div className="ec-table-wrap">
      <table className="ec-table">
        <thead>
          <tr>
            <th>Name</th><th>Status</th><th>CPU</th><th>Mem</th><th>Restarts</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {procs.map(p => (
            <tr key={p.name || p.pm_id}>
              <td className="ec-table__name">{p.name}</td>
              <td>
                <span className={`ec-badge ec-badge--${p.pm2_env?.status === 'online' ? 'green' : 'red'}`}>
                  {p.pm2_env?.status || 'unknown'}
                </span>
              </td>
              <td>{p.monit?.cpu ?? '—'}%</td>
              <td>{p.monit?.memory ? `${(p.monit.memory / 1024 / 1024).toFixed(1)}M` : '—'}</td>
              <td>{p.pm2_env?.restart_time ?? '—'}</td>
              <td className="ec-table__actions">
                <button className="ec-btn ec-btn--sm" onClick={() => action(p.name, 'restart')}>↺</button>
                <button className="ec-btn ec-btn--sm ec-btn--red" onClick={() => action(p.name, 'stop')}>■</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Queue monitor ─────────────────────────────────────────────────────
function QueueMonitor() {
  const [queues, setQueues] = useState([]);
  const [err, setErr]       = useState(null);

  const fetch_ = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND}/runtime/queue/status`, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setQueues(Array.isArray(data) ? data : (data.queues || []));
      setErr(null);
    } catch (e) {
      setErr(e.message);
    }
  }, []);

  useEffect(() => { fetch_(); }, [fetch_]);
  useInterval(fetch_, 4000);

  if (err) return <div className="ec-error">Queue unavailable: {err}</div>;
  if (!queues.length) return <div className="ec-empty">No queue data available.</div>;

  return (
    <div className="ec-table-wrap">
      <table className="ec-table">
        <thead>
          <tr><th>Queue</th><th>Waiting</th><th>Active</th><th>Completed</th><th>Failed</th></tr>
        </thead>
        <tbody>
          {queues.map(q => (
            <tr key={q.name}>
              <td className="ec-table__name">{q.name}</td>
              <td>{q.waiting ?? '—'}</td>
              <td>{q.active ?? '—'}</td>
              <td>{q.completed ?? '—'}</td>
              <td className={q.failed > 0 ? 'ec-cell--warn' : ''}>{q.failed ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Agent row (memoized so only changed rows re-render) ───────────────
const AGENT_ROW_H = 26;

const AgentRow = memo(function AgentRow({ agent }) {
  const cls = agent.status === 'running' ? 'green' : agent.status === 'error' ? 'red' : 'gray';
  return (
    <div className="ec-vrow" style={{ height: AGENT_ROW_H }}>
      <span className="ec-vrow__id"    title={agent.id}>{(agent.id || '').slice(0, 10)}{agent.id?.length > 10 ? '…' : ''}</span>
      <span className="ec-vrow__type">{agent.type || agent.kind || '—'}</span>
      <span className={`ec-badge ec-badge--${cls}`}>{agent.status || '—'}</span>
      <span className="ec-vrow__time">{agent.startedAt  ? new Date(agent.startedAt).toLocaleTimeString()  : '—'}</span>
      <span className="ec-vrow__time">{agent.lastActive ? new Date(agent.lastActive).toLocaleTimeString() : '—'}</span>
    </div>
  );
});

// ── Agent monitor — virtualized, handles 1000+ agents without pagination ──
function AgentMonitor() {
  const [agents,  setAgents] = useState([]);
  const [filter,  setFilter] = useState('');
  const [err,     setErr]    = useState(null);

  const fetch_ = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND}/runtime/agents/status`, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setAgents(Array.isArray(data) ? data : (data.agents || []));
      setErr(null);
    } catch (e) {
      setErr(e.message);
    }
  }, []);

  useEffect(() => { fetch_(); }, [fetch_]);
  useInterval(fetch_, 6000);

  const visible = useMemo(() => {
    if (!filter) return agents;
    const q = filter.toLowerCase();
    return agents.filter(a =>
      (a.id || '').toLowerCase().includes(q) ||
      (a.type || a.kind || '').toLowerCase().includes(q) ||
      (a.status || '').toLowerCase().includes(q)
    );
  }, [agents, filter]);

  const { containerRef, outerStyle, innerStyle, virtualItems } = useVirtualList({
    itemCount: visible.length,
    itemHeight: AGENT_ROW_H,
    overscan: 8,
  });

  if (err) return <div className="ec-error">Agent monitor unavailable: {err}</div>;

  return (
    <div className="ec-agents" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="ec-agents__toolbar">
        <span className="ec-agents__count">{agents.length} agents{filter ? ` (${visible.length} shown)` : ''}</span>
        <input
          className="ec-filter-input ec-filter-input--sm"
          placeholder="Filter agents…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
      </div>
      {visible.length === 0 ? (
        <div className="ec-empty">{filter ? 'No agents match filter.' : 'No agents running.'}</div>
      ) : (
        <>
          <div className="ec-vrow ec-vrow--header">
            <span className="ec-vrow__id">ID</span>
            <span className="ec-vrow__type">Type</span>
            <span>Status</span>
            <span className="ec-vrow__time">Started</span>
            <span className="ec-vrow__time">Last Active</span>
          </div>
          <div ref={containerRef} style={{ ...outerStyle, flex: 1 }}>
            <div style={innerStyle}>
              {virtualItems.map(item => (
                <VirtualRow key={item.index} top={item.top} height={AGENT_ROW_H}>
                  <AgentRow agent={visible[item.index]} />
                </VirtualRow>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Metrics strip ─────────────────────────────────────────────────────
function MetricsStrip() {
  const [metrics, setMetrics] = useState(null);

  const fetch_ = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND}/runtime/metrics`, { credentials: 'include' });
      if (!res.ok) return;
      setMetrics(await res.json());
    } catch {}
  }, []);

  useEffect(() => { fetch_(); }, [fetch_]);
  useInterval(fetch_, 5000);

  if (!metrics) return null;

  const m = metrics;
  return (
    <div className="ec-metrics">
      {m.uptime  !== undefined && <span className="ec-metric">⬆ {Math.floor(m.uptime / 3600)}h uptime</span>}
      {m.cpu     !== undefined && <span className="ec-metric">CPU {m.cpu?.toFixed(1)}%</span>}
      {m.memory  !== undefined && <span className="ec-metric">Mem {(m.memory / 1024 / 1024).toFixed(0)}M</span>}
      {m.requests !== undefined && <span className="ec-metric">Req {m.requests}</span>}
      {m.errors  !== undefined && <span className={`ec-metric${m.errors > 0 ? ' ec-metric--warn' : ''}`}>Err {m.errors}</span>}
    </div>
  );
}

// ── Mounted-tab panel: keeps component alive after first visit ────────
function MountedTab({ active, children }) {
  const [everMounted, setEverMounted] = useState(false);
  useEffect(() => { if (active) setEverMounted(true); }, [active]);
  return (
    <div style={{ display: active ? 'flex' : 'none', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {everMounted && children}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────
const TABS = [
  { id: 'logs',   label: 'Runtime Logs' },
  { id: 'pm2',    label: 'PM2' },
  { id: 'queue',  label: 'Queue' },
  { id: 'agents', label: 'Agents' },
];

export default function EngineeringConsole({ className = '' }) {
  const [tab, setTab] = useState('logs');

  return (
    <div className={`engineering-console ${className}`}>
      <div className="ec-header">
        <span className="ec-header__title">Engineering Console</span>
        <MetricsStrip />
      </div>
      <div className="ec-tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`ec-tab${tab === t.id ? ' ec-tab--active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="ec-body">
        <MountedTab active={tab === 'logs'}>   <RuntimeLogs />   </MountedTab>
        <MountedTab active={tab === 'pm2'}>    <PM2Monitor />    </MountedTab>
        <MountedTab active={tab === 'queue'}>  <QueueMonitor />  </MountedTab>
        <MountedTab active={tab === 'agents'}> <AgentMonitor />  </MountedTab>
      </div>
    </div>
  );
}
