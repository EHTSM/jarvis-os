import React, { useState, useEffect, useCallback, useRef, memo, useMemo } from 'react';
import { _fetch } from '../_client';
import { useVirtualList, VirtualRow } from '../hooks/useVirtualList';
import { useThrottledCallback } from '../hooks/useStableCallback';
import { useLowMemoryGuard } from '../hooks/useResourceManager';
import './EngineeringConsole.css';

const LOG_ITEM_HEIGHT = 18; // px per log line

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
    const streamUrl = (process.env.REACT_APP_API_URL || '') + '/runtime/stream';
    const es = new EventSource(streamUrl, { withCredentials: true });
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
      const data = await _fetch('/runtime/pm2/list');
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
      await _fetch(`/runtime/pm2/${cmd}`, {
        method: 'POST',
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
      const data = await _fetch('/runtime/queue/status');
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
      const data = await _fetch('/runtime/agents/status');
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
      setMetrics(await _fetch('/runtime/metrics'));
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

// ── Agent Collaboration — Conversation + Delegation + Status Matrix ───────────
const COLLAB_SUB_TABS = [
  { id: 'pipeline', label: 'Agent Pipeline' },
  { id: 'convo',    label: 'Conversation' },
  { id: 'timeline', label: 'Delegation Timeline' },
];

const PIPELINE_STATUS_COLOR = {
  completed: '#22c55e',
  running:   '#3b82f6',
  failed:    '#ef4444',
  escalated: '#f59e0b',
  skipped:   '#6b7280',
  pending:   '#374151',
  idle:      '#1f2937',
};

function AgentStatusMatrix({ missionId }) {
  const [data, setData]   = useState(null);
  const [err, setErr]     = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await _fetch(`/agents/status/${missionId}`);
      setData(r.status || null);
      setErr(null);
    } catch (e) { setErr(e.message); }
  }, [missionId]);

  useEffect(() => { load(); }, [load]);
  useInterval(load, 4000);

  if (err)  return <div className="ec-error">Status unavailable: {err}</div>;
  if (!data) return <div className="ec-empty">Loading agent pipeline…</div>;

  return (
    <div className="ec-collab-matrix">
      {data.matrix.map((agent, i) => (
        <div key={agent.id} className="ec-collab-agent">
          <div className="ec-collab-agent__pos">{i + 1}</div>
          <div className="ec-collab-agent__body">
            <div className="ec-collab-agent__name">{agent.name}</div>
            <div className="ec-collab-agent__caps">{agent.capabilities.slice(0, 3).join(' · ')}</div>
          </div>
          <div
            className="ec-collab-agent__status"
            style={{ color: PIPELINE_STATUS_COLOR[agent.nodeStatus] || '#6b7280' }}
          >
            {agent.nodeStatus}
            {agent.durationMs ? ` ${(agent.durationMs / 1000).toFixed(1)}s` : ''}
          </div>
          {agent.delegatedTo && (
            <div className="ec-collab-agent__badge ec-collab-agent__badge--delegated">
              → {agent.delegatedTo}
            </div>
          )}
          {agent.claimedTasks.length > 0 && (
            <div className="ec-collab-agent__badge ec-collab-agent__badge--claimed">
              {agent.claimedTasks.length} claimed
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function AgentConversation({ missionId }) {
  const [data,    setData]    = useState(null);
  const [msgBody, setMsgBody] = useState('');
  const [from,    setFrom]    = useState('operator');
  const [to,      setTo]      = useState('planner');
  const [err,     setErr]     = useState(null);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const r = await _fetch(`/agents/conversation/${missionId}`);
      setData(r.conversation || null);
      setErr(null);
    } catch (e) { setErr(e.message); }
  }, [missionId]);

  useEffect(() => { load(); }, [load]);
  useInterval(load, 3000);

  useEffect(() => {
    if (bottomRef.current) bottomRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [data?.thread?.length]);

  const send = useCallback(async () => {
    if (!msgBody.trim() || sending) return;
    setSending(true);
    try {
      await _fetch('/agents/message', {
        method: 'POST',
        body: JSON.stringify({ missionId, from, to, body: msgBody.trim() }),
      });
      setMsgBody('');
      await load();
    } catch (e) { setErr(e.message); }
    finally { setSending(false); }
  }, [msgBody, from, to, missionId, load, sending]);

  const handleKey = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }, [send]);

  if (err)  return <div className="ec-error">Conversation unavailable: {err}</div>;
  if (!data) return <div className="ec-empty">Loading conversation…</div>;

  const TYPE_COLOR = {
    message:    '#60a5fa',
    delegation: '#f59e0b',
    feedback:   '#a78bfa',
    approval:   '#22c55e',
    override:   '#ef4444',
    claim:      '#34d399',
  };

  return (
    <div className="ec-collab-convo">
      <div className="ec-collab-convo__thread">
        {data.thread.length === 0 && (
          <div className="ec-empty">No messages yet. Start the conversation.</div>
        )}
        {data.thread.map(msg => (
          <div key={msg.id} className={`ec-collab-msg ec-collab-msg--${msg.type}`}>
            <div className="ec-collab-msg__meta">
              <span className="ec-collab-msg__from">{msg.from}</span>
              <span className="ec-collab-msg__arrow">→</span>
              <span className="ec-collab-msg__to">{msg.to}</span>
              <span
                className="ec-collab-msg__type"
                style={{ color: TYPE_COLOR[msg.type] || '#6b7280' }}
              >
                {msg.type}
              </span>
              <span className="ec-collab-msg__ts">{new Date(msg.ts).toLocaleTimeString()}</span>
            </div>
            <div className="ec-collab-msg__body">{msg.body}</div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="ec-collab-convo__compose">
        <select
          className="ec-collab-select"
          value={from}
          onChange={e => setFrom(e.target.value)}
        >
          {['operator','planner','developer','reviewer','tester','security','devops'].map(a => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        <span className="ec-collab-arrow">→</span>
        <select
          className="ec-collab-select"
          value={to}
          onChange={e => setTo(e.target.value)}
        >
          {['planner','developer','reviewer','tester','security','devops','operator','all'].map(a => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        <input
          className="ec-collab-input"
          placeholder="Message…"
          value={msgBody}
          onChange={e => setMsgBody(e.target.value)}
          onKeyDown={handleKey}
          maxLength={2000}
        />
        <button
          className="ec-collab-btn"
          onClick={send}
          disabled={sending || !msgBody.trim()}
        >
          {sending ? '…' : 'Send'}
        </button>
      </div>
    </div>
  );
}

function DelegationTimeline({ missionId }) {
  const [data, setData] = useState(null);
  const [err,  setErr]  = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await _fetch(`/agents/delegation/${missionId}`);
      setData(r.delegation || null);
      setErr(null);
    } catch (e) { setErr(e.message); }
  }, [missionId]);

  useEffect(() => { load(); }, [load]);
  useInterval(load, 5000);

  if (err)  return <div className="ec-error">Delegation log unavailable: {err}</div>;
  if (!data) return <div className="ec-empty">Loading delegation timeline…</div>;

  const TYPE_ICON = { delegation: '⇢', override: '!', claim: '✓' };

  return (
    <div className="ec-collab-timeline">
      <div className="ec-collab-timeline__header">
        <span>{data.total} delegation events</span>
      </div>
      {data.delegations.length === 0 ? (
        <div className="ec-empty">No delegation events yet.</div>
      ) : (
        <div className="ec-collab-timeline__events">
          {[...data.delegations].reverse().map(d => (
            <div key={d.id} className={`ec-collab-event ec-collab-event--${d.type}`}>
              <div className="ec-collab-event__icon">{TYPE_ICON[d.type] || '·'}</div>
              <div className="ec-collab-event__body">
                <div className="ec-collab-event__actors">
                  <span className="ec-collab-event__from">{d.from}</span>
                  {d.to && <><span> → </span><span className="ec-collab-event__to">{d.to}</span></>}
                  {d.taskId && <span className="ec-collab-event__task"> [{d.taskId.slice(0, 12)}]</span>}
                </div>
                {d.reason && <div className="ec-collab-event__reason">{d.reason}</div>}
                <div className="ec-collab-event__ts">{new Date(d.ts).toLocaleString()}</div>
              </div>
              {d.status && (
                <div className={`ec-collab-event__status ec-collab-event__status--${d.status}`}>
                  {d.status}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AgentCollaborationPanel() {
  const [subTab, setSubTab] = useState('pipeline');
  const [missionId, setMissionId] = useState('');
  const [inputId, setInputId]     = useState('');
  const [starting, setStarting]   = useState(false);
  const [startErr, setStartErr]   = useState(null);

  const startCollab = useCallback(async () => {
    if (!inputId.trim()) return;
    setStarting(true);
    setStartErr(null);
    try {
      await _fetch(`/agents/collaborate/${inputId.trim()}`, { method: 'POST', body: '{}' });
      setMissionId(inputId.trim());
    } catch (e) { setStartErr(e.message); }
    finally { setStarting(false); }
  }, [inputId]);

  return (
    <div className="ec-collab" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Mission selector */}
      <div className="ec-collab-toolbar">
        <span className="ec-collab-toolbar__label">Mission ID</span>
        <input
          className="ec-filter-input"
          placeholder="msn_…"
          value={inputId}
          onChange={e => setInputId(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') startCollab(); }}
          style={{ maxWidth: 260 }}
        />
        <button className="ec-collab-btn" onClick={startCollab} disabled={starting || !inputId.trim()}>
          {starting ? 'Starting…' : 'Load / Start'}
        </button>
        {startErr && <span className="ec-collab-err">{startErr}</span>}
      </div>

      {!missionId ? (
        <div className="ec-empty">Enter a mission ID above to view agent collaboration.</div>
      ) : (
        <>
          {/* Sub-tabs */}
          <div className="ec-tabs ec-tabs--sm" role="tablist" aria-label="Agent Collaboration sub-tabs">
            {COLLAB_SUB_TABS.map(t => (
              <button
                key={t.id}
                role="tab"
                aria-selected={subTab === t.id}
                className={`ec-tab${subTab === t.id ? ' ec-tab--active' : ''}`}
                onClick={() => setSubTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="ec-body" style={{ flex: 1, minHeight: 0 }}>
            <MountedTab active={subTab === 'pipeline'}>
              <AgentStatusMatrix missionId={missionId} />
            </MountedTab>
            <MountedTab active={subTab === 'convo'}>
              <AgentConversation missionId={missionId} />
            </MountedTab>
            <MountedTab active={subTab === 'timeline'}>
              <DelegationTimeline missionId={missionId} />
            </MountedTab>
          </div>
        </>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────
const TABS = [
  { id: 'logs',   label: 'Runtime Logs' },
  { id: 'pm2',    label: 'PM2' },
  { id: 'queue',  label: 'Queue' },
  { id: 'agents', label: 'Agents' },
  { id: 'collab', label: 'Agent Collaboration' },
];

export default function EngineeringConsole({ className = '' }) {
  const [tab, setTab] = useState('logs');

  return (
    <div className={`engineering-console ${className}`}>
      <div className="ec-header">
        <span className="ec-header__title">Engineering Console</span>
        <MetricsStrip />
      </div>
      <div className="ec-tabs" role="tablist" aria-label="Engineering Console tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`ec-tab${tab === t.id ? ' ec-tab--active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="ec-body">
        <MountedTab active={tab === 'logs'}>   <RuntimeLogs />        </MountedTab>
        <MountedTab active={tab === 'pm2'}>    <PM2Monitor />         </MountedTab>
        <MountedTab active={tab === 'queue'}>  <QueueMonitor />       </MountedTab>
        <MountedTab active={tab === 'agents'}> <AgentMonitor />       </MountedTab>
        <MountedTab active={tab === 'collab'}> <AgentCollaborationPanel /> </MountedTab>
      </div>
    </div>
  );
}
