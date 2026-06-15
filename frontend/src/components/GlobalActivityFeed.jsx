import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { getMissions } from '../phase27Api';
import { getObserverRecs, getMemoryDecisions } from '../phase26Api';
import { getHealHistory } from '../phase19Api';
import { listDeployments } from '../phase25Api';
import { listPatches, getRuntimeHistory } from '../runtimeApi';
import { getLeads } from '../api';
import './GlobalActivityFeed.css';

// ── Domain colours / icons ────────────────────────────────────────────────────
const DOMAIN = {
  mission:        { icon: '🎯', color: '#7c6fff', label: 'Mission'        },
  planning:       { icon: '🗺️', color: '#7c6fff', label: 'Planning'       },
  execution:      { icon: '⚡', color: '#4ecdc4', label: 'Execution'      },
  deployment:     { icon: '◈',  color: '#3b82f6', label: 'Deploy'         },
  patch:          { icon: '⬡',  color: '#64748b', label: 'Patch'          },
  healing:        { icon: '✦',  color: '#22c55e', label: 'Healing'        },
  memory:         { icon: '🧠', color: '#a78bfa', label: 'Memory'         },
  recommendation: { icon: '✦',  color: '#f0b429', label: 'Recommendation' },
  crm:            { icon: '👤', color: '#4ecdc4', label: 'CRM'            },
  payment:        { icon: '✦',  color: '#52d68a', label: 'Payment'        },
  runtime:        { icon: '◎',  color: '#64748b', label: 'Runtime'        },
  reasoning:      { icon: '◈',  color: '#818cf8', label: 'Reasoning'      },
  approval:       { icon: '◉',  color: '#f0b429', label: 'Approval'       },
};

const ALL_DOMAINS = Object.keys(DOMAIN);

function timeAgo(isoStr) {
  if (!isoStr) return '';
  const ms   = Date.now() - new Date(isoStr).getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 5)    return 'just now';
  if (secs < 60)   return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60)   return `${mins}m ago`;
  const hrs  = Math.floor(mins / 60);
  if (hrs  < 24)   return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Fetch and normalise all domain events ─────────────────────────────────────
async function fetchAllEvents() {
  const results = await Promise.allSettled([
    getMissions(),                  // 0
    getObserverRecs(),              // 1
    getMemoryDecisions(),           // 2
    getHealHistory({ limit: 10 }), // 3
    listDeployments({ limit: 10 }), // 4
    listPatches('*'),              // 5
    getRuntimeHistory(15),         // 6
    getLeads(),                    // 7
  ]);

  const events = [];
  let id = 0;
  const push = (domain, title, meta, ts, tab) =>
    events.push({ id: id++, domain, title, meta, ts, tab });

  // Missions
  if (results[0].status === 'fulfilled') {
    const list = Array.isArray(results[0].value) ? results[0].value : (results[0].value?.missions ?? []);
    list.slice(0, 6).forEach(m => {
      push(
        m.status === 'failed' ? 'runtime' : 'mission',
        m.title ?? m.name ?? m.goal ?? 'Mission updated',
        `Status: ${m.status ?? 'unknown'}${m.progress != null ? ` · ${m.progress}% done` : ''}`,
        m.updatedAt ?? m.createdAt,
        'jarvisbrain',
      );
      // Decisions from mission as reasoning events
      (m.decisions ?? []).slice(0, 2).forEach(d => {
        push('reasoning', `Reasoning: ${(d.rationale ?? d.reason ?? 'Decision recorded').slice(0, 60)}`, m.title ?? 'Mission', d.createdAt, 'jarvisbrain');
      });
    });
  }

  // Recommendations
  if (results[1].status === 'fulfilled') {
    const list = Array.isArray(results[1].value) ? results[1].value : (results[1].value?.recommendations ?? []);
    list.slice(0, 4).forEach(r => {
      push('recommendation', r.title ?? r.action ?? 'Recommendation', `Priority: ${r.priority ?? 'normal'} · ${r.confidence ?? '—'}% confidence`, r.createdAt, 'recommend');
    });
  }

  // Memory decisions
  if (results[2].status === 'fulfilled') {
    const list = Array.isArray(results[2].value) ? results[2].value : (results[2].value?.decisions ?? []);
    list.slice(0, 4).forEach(d => {
      push('memory', (d.content ?? d.text ?? d.decision ?? 'Memory recorded').slice(0, 70), d.type ?? 'decision', d.createdAt ?? d.timestamp, 'memory');
    });
  }

  // Healing events
  if (results[3].status === 'fulfilled') {
    const list = Array.isArray(results[3].value) ? results[3].value : (results[3].value?.events ?? results[3].value?.history ?? []);
    list.slice(0, 5).forEach(h => {
      push('healing', h.task ?? h.target ?? 'Heal event', `Status: ${h.status ?? 'unknown'} · ${h.strategy ?? 'auto'}`, h.createdAt ?? h.timestamp, 'selfhealing');
    });
  }

  // Deployments
  if (results[4].status === 'fulfilled') {
    const list = Array.isArray(results[4].value) ? results[4].value : (results[4].value?.deployments ?? []);
    list.slice(0, 5).forEach(d => {
      push('deployment', d.name ?? d.service ?? `Deploy ${d.id ?? ''}`, `${d.status ?? 'unknown'} · ${d.environment ?? 'prod'}`, d.createdAt ?? d.startedAt, 'devops');
    });
  }

  // Patches
  if (results[5].status === 'fulfilled') {
    const list = Array.isArray(results[5].value) ? results[5].value : (results[5].value?.patches ?? []);
    list.slice(0, 5).forEach(p => {
      push('patch', p.description ?? p.file ?? `Patch ${p.id ?? ''}`, `Status: ${p.status ?? 'unknown'}`, p.appliedAt ?? p.createdAt, 'engineering');
    });
  }

  // Runtime history
  if (results[6].status === 'fulfilled') {
    const list = Array.isArray(results[6].value) ? results[6].value : (results[6].value?.items ?? []);
    list.slice(0, 5).forEach(r => {
      const domain = r.type?.includes('error') || r.status === 'failed' ? 'runtime' : 'execution';
      push(domain, (r.input ?? r.task ?? 'Runtime event').slice(0, 60), r.status ?? r.type ?? 'executed', r.ts ?? r.timestamp, 'execution');
    });
  }

  // CRM — leads as crm events
  if (results[7].status === 'fulfilled') {
    const list = Array.isArray(results[7].value) ? results[7].value : (results[7].value?.leads ?? []);
    // Most recently updated
    list
      .filter(l => l.stage === 'paid' || l.stage === 'hot' || l.stage === 'new')
      .slice(0, 3)
      .forEach(l => {
        const domain = l.stage === 'paid' ? 'payment' : 'crm';
        push(domain, l.name ?? l.phone ?? 'Lead', `Stage: ${l.stage ?? 'unknown'}`, l.updatedAt ?? l.createdAt, l.stage === 'paid' ? 'payments' : 'clients');
      });
  }

  // Sort newest-first, put null-ts events last
  return events.sort((a, b) => {
    if (!a.ts && !b.ts) return 0;
    if (!a.ts) return 1;
    if (!b.ts) return -1;
    return new Date(b.ts) - new Date(a.ts);
  });
}

// ── Single event row ──────────────────────────────────────────────────────────
function EventRow({ ev, onNavigate }) {
  const d = DOMAIN[ev.domain] ?? DOMAIN.runtime;
  return (
    <div
      className="gaf-row"
      onClick={() => ev.tab && onNavigate?.(ev.tab)}
      title={ev.tab ? `Navigate to ${ev.tab}` : undefined}
      style={{ cursor: ev.tab ? 'pointer' : 'default' }}
    >
      <div className="gaf-spine">
        <span className="gaf-icon" style={{ color: d.color }}>{d.icon}</span>
        <div className="gaf-line" />
      </div>
      <div className="gaf-body">
        <div className="gaf-row-top">
          <span className="gaf-domain-badge" style={{ color: d.color, borderColor: d.color + '44', background: d.color + '12' }}>
            {d.label}
          </span>
          <span className="gaf-title">{ev.title}</span>
          {ev.ts && <span className="gaf-ts">{timeAgo(ev.ts)}</span>}
        </div>
        {ev.meta && <div className="gaf-meta">{ev.meta}</div>}
      </div>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────
export default function GlobalActivityFeed({ onNavigate, maxItems = 50 }) {
  const [events,      setEvents]      = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [filter,      setFilter]      = useState('all');
  const [search,      setSearch]      = useState('');
  const [lastRefresh, setLastRefresh] = useState(null);

  const refresh = useCallback(() => {
    setLoading(true);
    fetchAllEvents()
      .then(evs => { setEvents(evs); setLoading(false); setLastRefresh(new Date()); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 25000);
    return () => clearInterval(t);
  }, [refresh]);

  const filtered = useMemo(() => {
    let list = events;
    if (filter !== 'all') list = list.filter(e => e.domain === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(e =>
        e.title.toLowerCase().includes(q) ||
        (e.meta ?? '').toLowerCase().includes(q) ||
        e.domain.includes(q)
      );
    }
    return list.slice(0, maxItems);
  }, [events, filter, search, maxItems]);

  // Domain counts for filter badges
  const counts = useMemo(() => {
    const c = {};
    events.forEach(e => { c[e.domain] = (c[e.domain] ?? 0) + 1; });
    return c;
  }, [events]);

  return (
    <div className="gaf-root">
      {/* Toolbar */}
      <div className="gaf-toolbar">
        <input
          className="gaf-search"
          placeholder="Filter activity…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <button className={`gaf-filter-btn ${filter === 'all' ? 'gaf-filter-btn--active' : ''}`} onClick={() => setFilter('all')}>
          All <span className="gaf-count">{events.length}</span>
        </button>
        {ALL_DOMAINS.filter(d => counts[d]).map(d => (
          <button
            key={d}
            className={`gaf-filter-btn ${filter === d ? 'gaf-filter-btn--active' : ''}`}
            onClick={() => setFilter(d)}
            style={{ '--dot-color': DOMAIN[d].color }}
          >
            <span className="gaf-filter-dot" style={{ background: DOMAIN[d].color }} />
            {DOMAIN[d].label}
            <span className="gaf-count">{counts[d]}</span>
          </button>
        ))}
        <button className="gaf-refresh" onClick={refresh} title="Refresh">↺</button>
      </div>

      {/* Feed */}
      <div className="gaf-feed" role="log" aria-live="polite">
        {loading && events.length === 0 && (
          <div className="gaf-loading">
            {[1,2,3,4,5].map(i => (
              <div key={i} className="gaf-skeleton-row">
                <div className="sk-row sk-row--sm" style={{ width: 24, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div className="sk-row sk-row--w75" style={{ marginBottom: 4 }} />
                  <div className="sk-row sk-row--w50 sk-row--sm" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="gaf-empty">
            <div className="gaf-empty-icon">◎</div>
            <div className="gaf-empty-title">No activity yet</div>
            <div className="gaf-empty-sub">
              Events from missions, deployments, patches, healing, memory, CRM, and payments all appear here in real time.
            </div>
          </div>
        )}

        {filtered.map(ev => (
          <EventRow key={ev.id} ev={ev} onNavigate={onNavigate} />
        ))}
      </div>

      {lastRefresh && (
        <div className="gaf-footer">
          {filtered.length} events · Updated {lastRefresh.toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}
