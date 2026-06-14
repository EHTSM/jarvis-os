import React, { useState, useEffect, useCallback, useRef } from 'react';
import './EngineeringConsole.css';

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
function LogLine({ line }) {
  const isErr  = /error|ERR|FAIL/i.test(line);
  const isWarn = /warn|WARN/i.test(line);
  const isInfo = /info|INFO/i.test(line);
  const cls = isErr ? 'log-line--error' : isWarn ? 'log-line--warn' : isInfo ? 'log-line--info' : '';
  return <div className={`log-line ${cls}`}>{line}</div>;
}

function RuntimeLogs() {
  const [lines, setLines] = useState([]);
  const [follow, setFollow] = useState(true);
  const [filter, setFilter] = useState('');
  const bodyRef = useRef(null);
  const esRef   = useRef(null);

  useEffect(() => {
    const token = document.cookie.match(/jarvis_auth=([^;]+)/)?.[1] || '';
    const url = `${BACKEND}/runtime/stream`;
    const es = new EventSource(url, { withCredentials: true });
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        const text = typeof data === 'string' ? data : (data.message || data.log || JSON.stringify(data));
        setLines(l => [...l.slice(-1000), text]);
      } catch {
        setLines(l => [...l.slice(-1000), e.data]);
      }
    };
    es.onerror = () => {
      setLines(l => [...l, '[SSE disconnected]']);
    };
    return () => es.close();
  }, []);

  // Auto-scroll
  useEffect(() => {
    if (follow && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [lines, follow]);

  const visible = filter ? lines.filter(l => l.toLowerCase().includes(filter.toLowerCase())) : lines;

  return (
    <div className="ec-logs">
      <div className="ec-logs__toolbar">
        <input
          className="ec-filter-input"
          placeholder="Filter…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
        <label className="ec-toggle">
          <input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)} />
          Follow
        </label>
        <button className="ec-btn" onClick={() => setLines([])}>Clear</button>
      </div>
      <div className="ec-logs__body" ref={bodyRef}>
        {visible.length === 0 ? (
          <div className="ec-empty">No log output yet. Connecting to /runtime/stream…</div>
        ) : visible.map((line, i) => (
          <LogLine key={i} line={line} />
        ))}
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

// ── Agent monitor ─────────────────────────────────────────────────────
function AgentMonitor() {
  const [agents, setAgents] = useState([]);
  const [err, setErr]       = useState(null);
  const [page, setPage]     = useState(0);
  const PAGE_SIZE = 15;

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

  const page_ = agents.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  if (err) return <div className="ec-error">Agent monitor unavailable: {err}</div>;
  if (!agents.length) return <div className="ec-empty">No agents running.</div>;

  return (
    <div className="ec-agents">
      <div className="ec-agents__count">{agents.length} agents</div>
      <div className="ec-table-wrap">
        <table className="ec-table">
          <thead>
            <tr><th>ID</th><th>Type</th><th>Status</th><th>Started</th><th>Last Active</th></tr>
          </thead>
          <tbody>
            {page_.map(a => (
              <tr key={a.id}>
                <td className="ec-table__id" title={a.id}>{a.id?.slice(0, 10)}…</td>
                <td>{a.type || a.kind || '—'}</td>
                <td>
                  <span className={`ec-badge ec-badge--${a.status === 'running' ? 'green' : a.status === 'error' ? 'red' : 'gray'}`}>
                    {a.status}
                  </span>
                </td>
                <td className="ec-table__time">{a.startedAt ? new Date(a.startedAt).toLocaleTimeString() : '—'}</td>
                <td className="ec-table__time">{a.lastActive ? new Date(a.lastActive).toLocaleTimeString() : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {agents.length > PAGE_SIZE && (
        <div className="ec-pagination">
          <button className="ec-btn ec-btn--sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>←</button>
          <span>{page + 1} / {Math.ceil(agents.length / PAGE_SIZE)}</span>
          <button className="ec-btn ec-btn--sm" disabled={(page + 1) * PAGE_SIZE >= agents.length} onClick={() => setPage(p => p + 1)}>→</button>
        </div>
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
        {tab === 'logs'   && <RuntimeLogs />}
        {tab === 'pm2'    && <PM2Monitor />}
        {tab === 'queue'  && <QueueMonitor />}
        {tab === 'agents' && <AgentMonitor />}
      </div>
    </div>
  );
}
