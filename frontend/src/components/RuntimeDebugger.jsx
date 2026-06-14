import React, { useState, useEffect, useCallback, useRef } from 'react';
import './RuntimeDebugger.css';

const BACKEND = 'http://localhost:5050';

async function apiFetch(path) {
  const res = await fetch(`${BACKEND}${path}`, { credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function usePolled(path, interval = 4000) {
  const [data,    setData]    = useState(null);
  const [error,   setError]   = useState(null);
  const [loading, setLoading] = useState(true);

  const run = useCallback(async () => {
    try {
      const d = await apiFetch(path);
      setData(d); setError(null);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [path]);

  useEffect(() => {
    run();
    const id = setInterval(run, interval);
    return () => clearInterval(id);
  }, [run, interval]);

  return { data, error, loading, refresh: run };
}

// ── Status badge ───────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const s = String(status);
  const cls = s.startsWith('2') ? 'green' : s.startsWith('3') ? 'blue' : s.startsWith('4') ? 'yellow' : s.startsWith('5') ? 'red' : 'gray';
  return <span className={`rd-badge rd-badge--${cls}`}>{status}</span>;
}

// ── API Monitor (live request stream) ──────────────────────────────────
function APIMonitor() {
  const [requests, setRequests] = useState([]);
  const [filter,   setFilter]   = useState('');
  const [paused,   setPaused]   = useState(false);
  const [selected, setSelected] = useState(null);
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  useEffect(() => {
    const es = new EventSource(`${BACKEND}/runtime/stream`, { withCredentials: true });
    es.onmessage = (e) => {
      if (pausedRef.current) return;
      try {
        const d = JSON.parse(e.data);
        if (d.type !== 'request') return;
        setRequests(r => [d, ...r.slice(0, 199)]);
      } catch {}
    };
    return () => es.close();
  }, []);

  const visible = filter
    ? requests.filter(r => `${r.method} ${r.path} ${r.status}`.toLowerCase().includes(filter.toLowerCase()))
    : requests;

  return (
    <div className="rd-monitor">
      <div className="rd-toolbar">
        <input
          className="rd-filter"
          placeholder="Filter requests…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
        <button className={`rd-btn${paused ? ' rd-btn--active' : ''}`} onClick={() => setPaused(p => !p)}>
          {paused ? '▶ Resume' : '⏸ Pause'}
        </button>
        <button className="rd-btn" onClick={() => setRequests([])}>Clear</button>
        <span className="rd-count">{requests.length} req</span>
      </div>
      <div className="rd-table-wrap">
        <table className="rd-table">
          <thead>
            <tr><th>Method</th><th>Path</th><th>Status</th><th>Time</th><th>Duration</th></tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr><td colSpan={5} className="rd-table-empty">Waiting for requests… (connect to /runtime/stream)</td></tr>
            ) : visible.map((r, i) => (
              <tr
                key={i}
                className={`rd-table-row${selected === i ? ' rd-table-row--selected' : ''}`}
                onClick={() => setSelected(i === selected ? null : i)}
              >
                <td><span className={`rd-method rd-method--${(r.method||'GET').toLowerCase()}`}>{r.method}</span></td>
                <td className="rd-path">{r.path}</td>
                <td><StatusBadge status={r.status || '—'} /></td>
                <td className="rd-time">{r.ts ? new Date(r.ts).toLocaleTimeString() : '—'}</td>
                <td className="rd-duration">{r.duration != null ? `${r.duration}ms` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selected != null && visible[selected] && (
        <div className="rd-detail">
          <div className="rd-detail__header">
            <span>{visible[selected].method} {visible[selected].path}</span>
            <button className="rd-close" onClick={() => setSelected(null)}>✕</button>
          </div>
          <pre className="rd-detail__body">{JSON.stringify(visible[selected], null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

// ── Webhook inspector ──────────────────────────────────────────────────
function WebhookInspector() {
  const { data, error, loading, refresh } = usePolled('/runtime/webhooks/recent', 5000);
  const [selected, setSelected] = useState(null);

  const hooks = data?.webhooks || data || [];

  if (loading) return <div className="rd-empty">Loading webhooks…</div>;
  if (error)   return <div className="rd-error">Unavailable: {error}</div>;
  if (!hooks.length) return <div className="rd-empty">No webhook events recorded yet.</div>;

  return (
    <div className="rd-inspector">
      <div className="rd-toolbar">
        <span className="rd-count">{hooks.length} events</span>
        <button className="rd-btn" onClick={refresh}>↻ Refresh</button>
      </div>
      <div className="rd-inspector__list">
        {hooks.map((h, i) => (
          <div
            key={i}
            className={`rd-webhook-row${selected === i ? ' rd-webhook-row--selected' : ''}`}
            onClick={() => setSelected(i === selected ? null : i)}
          >
            <span className="rd-webhook-event">{h.event || h.type || '?'}</span>
            <span className="rd-webhook-source">{h.source || h.provider || '—'}</span>
            <StatusBadge status={h.status || '—'} />
            <span className="rd-time">{h.ts ? new Date(h.ts).toLocaleTimeString() : '—'}</span>
          </div>
        ))}
      </div>
      {selected != null && (
        <div className="rd-detail">
          <div className="rd-detail__header">
            <span>{hooks[selected]?.event}</span>
            <button className="rd-close" onClick={() => setSelected(null)}>✕</button>
          </div>
          <pre className="rd-detail__body">{JSON.stringify(hooks[selected], null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

// ── Request timeline ───────────────────────────────────────────────────
function RequestTimeline() {
  const { data, error, loading } = usePolled('/runtime/timeline', 5000);
  const entries = data?.entries || data || [];

  if (loading) return <div className="rd-empty">Loading timeline…</div>;
  if (error)   return <div className="rd-error">Timeline unavailable: {error}</div>;
  if (!entries.length) return <div className="rd-empty">No timeline data.</div>;

  const max = Math.max(...entries.map(e => e.duration || 0), 1);

  return (
    <div className="rd-timeline">
      {entries.map((e, i) => (
        <div key={i} className="rd-timeline-row">
          <div className="rd-timeline-label">
            <span className={`rd-method rd-method--${(e.method||'get').toLowerCase()}`}>{e.method}</span>
            <span className="rd-path">{e.path}</span>
          </div>
          <div className="rd-timeline-bar-wrap">
            <div
              className="rd-timeline-bar"
              style={{ width: `${(e.duration / max) * 100}%`, background: e.duration > 500 ? '#ef4444' : e.duration > 200 ? '#f59e0b' : '#10b981' }}
            />
            <span className="rd-timeline-dur">{e.duration}ms</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Queue inspector ────────────────────────────────────────────────────
function QueueInspector() {
  const { data, error, loading, refresh } = usePolled('/runtime/queue/status', 4000);
  const [queueDetail, setQueueDetail] = useState(null);
  const [jobs, setJobs] = useState(null);

  const queues = Array.isArray(data) ? data : (data?.queues || []);

  const loadJobs = useCallback(async (queueName) => {
    try {
      const res = await apiFetch(`/runtime/queue/${encodeURIComponent(queueName)}/jobs`);
      setJobs({ queue: queueName, data: res });
      setQueueDetail(queueName);
    } catch (e) {
      setJobs({ queue: queueName, data: [], error: e.message });
    }
  }, []);

  if (loading) return <div className="rd-empty">Loading queues…</div>;
  if (error)   return <div className="rd-error">Queue data unavailable: {error}</div>;
  if (!queues.length) return <div className="rd-empty">No queues found.</div>;

  return (
    <div className="rd-queue">
      <div className="rd-toolbar">
        <span className="rd-count">{queues.length} queues</span>
        <button className="rd-btn" onClick={refresh}>↻</button>
      </div>
      <div className="rd-table-wrap">
        <table className="rd-table">
          <thead><tr><th>Queue</th><th>Waiting</th><th>Active</th><th>Done</th><th>Failed</th><th></th></tr></thead>
          <tbody>
            {queues.map((q, i) => (
              <tr key={i}>
                <td className="rd-path">{q.name}</td>
                <td>{q.waiting ?? '—'}</td>
                <td>{q.active ?? '—'}</td>
                <td>{q.completed ?? '—'}</td>
                <td className={q.failed > 0 ? 'rd-cell-warn' : ''}>{q.failed ?? '—'}</td>
                <td><button className="rd-btn rd-btn--sm" onClick={() => loadJobs(q.name)}>Jobs</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {jobs && (
        <div className="rd-detail">
          <div className="rd-detail__header">
            <span>Jobs: {jobs.queue}</span>
            <button className="rd-close" onClick={() => { setJobs(null); setQueueDetail(null); }}>✕</button>
          </div>
          {jobs.error ? (
            <div className="rd-error" style={{ margin: 8 }}>{jobs.error}</div>
          ) : (
            <pre className="rd-detail__body">{JSON.stringify(jobs.data, null, 2)}</pre>
          )}
        </div>
      )}
    </div>
  );
}

// ── Agent execution timeline ───────────────────────────────────────────
function AgentTimeline() {
  const { data, error, loading, refresh } = usePolled('/runtime/agents/timeline', 6000);
  const agents = Array.isArray(data) ? data : (data?.agents || []);
  const [selected, setSelected] = useState(null);

  if (loading) return <div className="rd-empty">Loading agent timeline…</div>;
  if (error)   return <div className="rd-error">Agent timeline unavailable: {error}</div>;
  if (!agents.length) return <div className="rd-empty">No agent execution data.</div>;

  return (
    <div className="rd-agent-timeline">
      <div className="rd-toolbar">
        <span className="rd-count">{agents.length} agents</span>
        <button className="rd-btn" onClick={refresh}>↻</button>
      </div>
      {agents.map((a, i) => (
        <div
          key={i}
          className={`rd-agent-row${selected === i ? ' rd-agent-row--selected' : ''}`}
          onClick={() => setSelected(i === selected ? null : i)}
        >
          <div className="rd-agent-row__header">
            <span className="rd-agent-id" title={a.id}>{a.id?.slice(0, 12) || '?'}</span>
            <span className="rd-agent-type">{a.type || a.kind || '—'}</span>
            <span className={`rd-badge rd-badge--${a.status === 'running' ? 'green' : a.status === 'error' ? 'red' : 'gray'}`}>{a.status}</span>
            <span className="rd-time">{a.duration != null ? `${a.duration}ms` : '—'}</span>
          </div>
          {selected === i && (
            <pre className="rd-agent-row__detail">{JSON.stringify(a, null, 2)}</pre>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Memory graph ───────────────────────────────────────────────────────
function MemoryGraph() {
  const [history, setHistory] = useState([]);
  const MAX_POINTS = 60;

  useEffect(() => {
    const tick = async () => {
      try {
        const data = await apiFetch('/runtime/metrics');
        const mb = data?.memory ? data.memory / 1024 / 1024 : null;
        if (mb != null) {
          setHistory(h => [...h.slice(-(MAX_POINTS - 1)), { ts: Date.now(), mb }]);
        }
      } catch {}
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => clearInterval(id);
  }, []);

  if (!history.length) return <div className="rd-empty">Collecting memory data… (sampling every 3s)</div>;

  const max = Math.max(...history.map(p => p.mb), 1);
  const WIDTH = 100, HEIGHT = 60;
  const pts = history.map((p, i) => {
    const x = (i / (MAX_POINTS - 1)) * WIDTH;
    const y = HEIGHT - (p.mb / max) * HEIGHT;
    return `${x},${y}`;
  }).join(' ');

  const current = history[history.length - 1];

  return (
    <div className="rd-memory">
      <div className="rd-memory__header">
        <span className="rd-memory__label">Heap Memory</span>
        <span className="rd-memory__current">{current?.mb?.toFixed(1)} MB</span>
        <span className="rd-memory__max">peak {max.toFixed(1)} MB</span>
      </div>
      <svg className="rd-memory__chart" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="mem-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polyline
          points={pts}
          fill="none"
          stroke="#10b981"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
        <polygon
          points={`0,${HEIGHT} ${pts} ${WIDTH},${HEIGHT}`}
          fill="url(#mem-grad)"
        />
      </svg>
      <div className="rd-memory__history">
        {history.slice(-5).reverse().map((p, i) => (
          <div key={i} className="rd-memory__row">
            <span className="rd-time">{new Date(p.ts).toLocaleTimeString()}</span>
            <span>{p.mb.toFixed(1)} MB</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Event replay ───────────────────────────────────────────────────────
function EventReplay() {
  const { data, error, loading, refresh } = usePolled('/runtime/events/recent', 8000);
  const [replaying, setReplaying] = useState(null);
  const events = Array.isArray(data) ? data : (data?.events || []);

  const replay = useCallback(async (event) => {
    setReplaying(event.id || event.ts);
    try {
      await fetch(`${BACKEND}/runtime/events/replay`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: event.id, eventType: event.type, payload: event.payload }),
      });
    } catch {}
    setTimeout(() => setReplaying(null), 2000);
  }, []);

  if (loading) return <div className="rd-empty">Loading events…</div>;
  if (error)   return <div className="rd-error">Event log unavailable: {error}</div>;
  if (!events.length) return <div className="rd-empty">No recent events.</div>;

  return (
    <div className="rd-event-list">
      <div className="rd-toolbar">
        <span className="rd-count">{events.length} events</span>
        <button className="rd-btn" onClick={refresh}>↻</button>
      </div>
      {events.map((e, i) => (
        <div key={i} className="rd-event-row">
          <span className="rd-event-type">{e.type || e.event || '?'}</span>
          <span className="rd-path">{e.source || '—'}</span>
          <span className="rd-time">{e.ts ? new Date(e.ts).toLocaleTimeString() : '—'}</span>
          <button
            className="rd-btn rd-btn--sm"
            onClick={() => replay(e)}
            disabled={replaying === (e.id || e.ts)}
          >
            {replaying === (e.id || e.ts) ? '…' : '↺ Replay'}
          </button>
        </div>
      ))}
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────
const TABS = [
  { id: 'api',      label: 'API Monitor' },
  { id: 'webhooks', label: 'Webhooks' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'queue',    label: 'Queue' },
  { id: 'agents',   label: 'Agent Timeline' },
  { id: 'memory',   label: 'Memory' },
  { id: 'events',   label: 'Event Replay' },
];

export default function RuntimeDebugger({ className = '' }) {
  const [tab, setTab] = useState('api');

  return (
    <div className={`runtime-debugger ${className}`}>
      <div className="rd-header">
        <span className="rd-header__title">Runtime Debugger</span>
      </div>
      <div className="rd-tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`rd-tab${tab === t.id ? ' rd-tab--active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="rd-body">
        {tab === 'api'      && <APIMonitor />}
        {tab === 'webhooks' && <WebhookInspector />}
        {tab === 'timeline' && <RequestTimeline />}
        {tab === 'queue'    && <QueueInspector />}
        {tab === 'agents'   && <AgentTimeline />}
        {tab === 'memory'   && <MemoryGraph />}
        {tab === 'events'   && <EventReplay />}
      </div>
    </div>
  );
}
