import React, { useState, useEffect, useCallback } from 'react';
import { _fetch } from '../_client';
import './BetaChecklist.css';

// ── Checklist definition ──────────────────────────────────────────────────────
const SECTIONS = [
  {
    id: 'install',
    label: 'Installation',
    items: [
      { id: 'i1', check: 'Backend starts without errors (node server.js)', verify: () => _fetch('/health').then(d => d.status === 'ok') },
      { id: 'i2', check: 'Frontend builds successfully (npm run build)', verify: null },
      { id: 'i3', check: 'Electron app loads frontend/build/index.html', verify: null },
      { id: 'i4', check: '.env has JWT_SECRET, OPERATOR_PASSWORD_HASH set', verify: () => _fetch('/p21/readiness/report').then(d => !!(d.checks?.env ?? d.ready)) },
      { id: 'i5', check: 'ALLOWED_ORIGINS includes production domain', verify: null },
    ],
  },
  {
    id: 'auth',
    label: 'Authentication',
    items: [
      { id: 'a1', check: 'User registration via /accounts/register returns 201', verify: null },
      { id: 'a2', check: 'Login sets HTTP-only session cookie', verify: null },
      { id: 'a3', check: 'Auth cookie sent on all subsequent requests', verify: null },
      { id: 'a4', check: '401 interceptor redirects to login on session expiry', verify: null },
      { id: 'a5', check: 'Logout clears cookie and resets app state', verify: null },
    ],
  },
  {
    id: 'crm',
    label: 'CRM',
    items: [
      { id: 'c1', check: 'Lead list loads (GET /crm/leads returns array)', verify: () => _fetch('/crm/leads').then(d => Array.isArray(d) || Array.isArray(d?.leads)) },
      { id: 'c2', check: 'Add lead via Contacts tab saves and appears in list', verify: null },
      { id: 'c3', check: 'Lead status update persists across page refresh', verify: null },
      { id: 'c4', check: 'WhatsApp follow-up sends to correct number', verify: null },
      { id: 'c5', check: 'CRM stats (total/paid/revenue) show real data', verify: () => _fetch('/stats').then(d => d.total != null) },
    ],
  },
  {
    id: 'billing',
    label: 'Billing',
    items: [
      { id: 'b1', check: 'Billing status returns plan info', verify: () => _fetch('/billing/status').then(d => !!d).catch(() => false) },
      { id: 'b2', check: 'Trial banner shows for non-active accounts', verify: null },
      { id: 'b3', check: 'Payment webhook processes Razorpay events', verify: null },
      { id: 'b4', check: 'Upgrade modal opens and links to payment', verify: null },
    ],
  },
  {
    id: 'ai',
    label: 'AI Runtime',
    items: [
      { id: 'r1', check: 'Runtime status reports active/idle', verify: () => _fetch('/runtime/status').then(d => !!d.status) },
      { id: 'r2', check: 'Task queue accepts new tasks without error', verify: null },
      { id: 'r3', check: 'AI chat responds within 10 seconds', verify: null },
      { id: 'r4', check: 'Emergency stop halts execution immediately', verify: null },
      { id: 'r5', check: 'DLQ captures failed tasks, retry works', verify: null },
    ],
  },
  {
    id: 'missions',
    label: 'Executive Brain',
    items: [
      { id: 'm1', check: 'Mission creation returns mission ID', verify: () => _fetch('/p27/missions').then(d => !!(d?.missions ?? d)).catch(() => false) },
      { id: 'm2', check: 'Observer emits recommendations', verify: () => _fetch('/p26/observer/recommendations').then(d => Array.isArray(d?.recommendations ?? d)) },
      { id: 'm3', check: 'Cycle stats return active/total counts', verify: () => _fetch('/p18/cycles/stats').then(d => d.total != null) },
      { id: 'm4', check: 'Memory decisions searchable (q=*)', verify: () => _fetch('/p26/memory/decisions?q=*').then(d => !!(d?.decisions ?? d)) },
      { id: 'm5', check: 'Planning horizons return structured data', verify: () => _fetch('/p27/planning/horizons').then(d => !!d).catch(() => false) },
    ],
  },
  {
    id: 'engineering',
    label: 'Engineering Runtime',
    items: [
      { id: 'e1', check: 'Patch list returns (listPatches)', verify: () => _fetch('/runtime/patches').then(d => !!(d?.patches ?? d)).catch(() => false) },
      { id: 'e2', check: 'Runtime history returns last 40 entries', verify: () => _fetch('/runtime/history?limit=5').then(d => Array.isArray(d?.history ?? d)) },
      { id: 'e3', check: 'Observer status shows 6 active observers', verify: () => _fetch('/p26/observer/status').then(d => (d?.observers?.length ?? 0) > 0) },
      { id: 'e4', check: 'Self-healing probe runs without error', verify: () => _fetch('/p19/heal/status').then(d => !!d) },
      { id: 'e5', check: 'Deployments list returns records', verify: () => _fetch('/p25/deploy').then(d => Array.isArray(d?.deployments ?? d)) },
    ],
  },
  {
    id: 'deploy',
    label: 'Deployment & Ops',
    items: [
      { id: 'd1', check: 'SLOs list returns configured targets', verify: () => _fetch('/p25/obs/slos').then(d => !!(d?.slos ?? d)) },
      { id: 'd2', check: 'Alerts list returns without error', verify: () => _fetch('/p25/obs/alerts').then(d => !!(d?.alerts ?? d)) },
      { id: 'd3', check: 'System metrics return CPU/memory', verify: () => _fetch('/p25/obs/metrics').then(d => !!d) },
      { id: 'd4', check: 'Security report returns status', verify: () => _fetch('/p22/security/report').then(d => !!d) },
      { id: 'd5', check: 'Secrets vault health check passes', verify: () => _fetch('/p22/secrets/validate').then(d => !!d) },
    ],
  },
  {
    id: 'electron',
    label: 'Electron',
    items: [
      { id: 'el1', check: 'App loads without white screen', verify: null },
      { id: 'el2', check: 'Window management (resize/minimize/close) works', verify: null },
      { id: 'el3', check: 'Tray icon appears and context menu opens', verify: null },
      { id: 'el4', check: 'Terminal panel executes commands', verify: null },
      { id: 'el5', check: 'Offline detection shows ElectronOfflineBar', verify: null },
      { id: 'el6', check: 'Crash reporter logs to startup_crashes.json', verify: null },
    ],
  },
  {
    id: 'ux',
    label: 'UX / Accessibility',
    items: [
      { id: 'u1', check: '⌘K opens command palette', verify: null },
      { id: 'u2', check: 'All tabs navigate without white screen', verify: null },
      { id: 'u3', check: 'Back/forward (⌘[ / ⌘]) navigates tab history', verify: null },
      { id: 'u4', check: 'More ▾ search finds any tab in ≤2 keystrokes', verify: null },
      { id: 'u5', check: 'ErrorBoundary catches tab crash — shows Retry', verify: null },
      { id: 'u6', check: 'Loading skeletons shown while lazy chunks load', verify: null },
      { id: 'u7', check: 'Empty states shown on blank screens (not white)', verify: null },
    ],
  },
];

function statusIcon(s) {
  if (s === 'pass') return '✓';
  if (s === 'fail') return '✗';
  if (s === 'running') return '…';
  return '○';
}

function statusClass(s) {
  if (s === 'pass') return 'bc-pass';
  if (s === 'fail') return 'bc-fail';
  if (s === 'running') return 'bc-running';
  return 'bc-pending';
}

export default function BetaChecklist({ onNavigate }) {
  const [results,  setResults]  = useState({});
  const [running,  setRunning]  = useState(false);
  const [expanded, setExpanded] = useState({});

  const runAll = useCallback(async () => {
    setRunning(true);
    const auto = SECTIONS.flatMap(s => s.items.filter(i => i.verify));
    for (const item of auto) {
      setResults(r => ({ ...r, [item.id]: 'running' }));
      try {
        const ok = await item.verify();
        setResults(r => ({ ...r, [item.id]: ok ? 'pass' : 'fail' }));
      } catch {
        setResults(r => ({ ...r, [item.id]: 'fail' }));
      }
    }
    setRunning(false);
  }, []);

  useEffect(() => { runAll(); }, [runAll]);

  const allItems   = SECTIONS.flatMap(s => s.items);
  const autoItems  = allItems.filter(i => i.verify);
  const passed     = autoItems.filter(i => results[i.id] === 'pass').length;
  const failed     = autoItems.filter(i => results[i.id] === 'fail').length;
  const pct        = autoItems.length > 0 ? Math.round((passed / autoItems.length) * 100) : 0;

  return (
    <div className="bc-root">
      <div className="bc-header">
        <div className="bc-header-left">
          <span className="bc-title">Beta Launch Checklist</span>
          <span className="bc-subtitle">{allItems.length} checks · {autoItems.length} automated</span>
        </div>
        <div className="bc-header-right">
          <div className="bc-score">
            <span className={`bc-score-pct ${pct === 100 ? 'bc-score-pct--all' : pct >= 70 ? 'bc-score-pct--ok' : 'bc-score-pct--warn'}`}>{pct}%</span>
            <span className="bc-score-label">auto pass</span>
          </div>
          <div className="bc-counts">
            {passed > 0 && <span className="bc-chip bc-chip--pass">✓ {passed}</span>}
            {failed > 0 && <span className="bc-chip bc-chip--fail">✗ {failed}</span>}
          </div>
          <button className="bc-run-btn" onClick={runAll} disabled={running}>
            {running ? 'Running…' : '↻ Re-run auto'}
          </button>
        </div>
      </div>

      <div className="bc-progress">
        <div className="bc-progress-fill" style={{ width: `${pct}%` }} />
      </div>

      <div className="bc-body">
        {SECTIONS.map(sec => {
          const open  = expanded[sec.id] !== false;
          const items = sec.items;
          const sPassed = items.filter(i => results[i.id] === 'pass').length;
          const sFailed = items.filter(i => results[i.id] === 'fail').length;
          const allPass = sPassed === items.length;

          return (
            <div key={sec.id} className={`bc-section ${allPass ? 'bc-section--pass' : ''}`}>
              <button
                className="bc-section-header"
                onClick={() => setExpanded(e => ({ ...e, [sec.id]: !open }))}
              >
                <span className="bc-section-arrow">{open ? '▾' : '▸'}</span>
                <span className="bc-section-label">{sec.label}</span>
                <span className="bc-section-counts">
                  {sPassed > 0 && <span className="bc-chip bc-chip--pass bc-chip--sm">✓ {sPassed}</span>}
                  {sFailed > 0 && <span className="bc-chip bc-chip--fail bc-chip--sm">✗ {sFailed}</span>}
                  <span className="bc-chip bc-chip--dim bc-chip--sm">{items.length}</span>
                </span>
              </button>

              {open && (
                <div className="bc-items">
                  {items.map(item => {
                    const s = results[item.id] ?? (item.verify ? 'pending' : 'manual');
                    return (
                      <div key={item.id} className={`bc-item ${statusClass(s)}`}>
                        <span className="bc-item-icon">{item.verify ? statusIcon(s) : '□'}</span>
                        <span className="bc-item-text">{item.check}</span>
                        {!item.verify && (
                          <span className="bc-manual-badge">manual</span>
                        )}
                        {s === 'fail' && item.verify && (
                          <button
                            className="bc-retry-btn"
                            onClick={async () => {
                              setResults(r => ({ ...r, [item.id]: 'running' }));
                              try {
                                const ok = await item.verify();
                                setResults(r => ({ ...r, [item.id]: ok ? 'pass' : 'fail' }));
                              } catch {
                                setResults(r => ({ ...r, [item.id]: 'fail' }));
                              }
                            }}
                          >retry</button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="bc-footer">
        <span>{allItems.length} total · {autoItems.length} automated · {allItems.length - autoItems.length} manual · Last run: {new Date().toLocaleTimeString()}</span>
      </div>
    </div>
  );
}
