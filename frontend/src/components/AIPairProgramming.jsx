import React, { useState, useCallback, useRef, useEffect } from 'react';
import './AIPairProgramming.css';

const BACKEND = 'http://localhost:5050';

async function jarvisPost(path, body) {
  const res = await fetch(`${BACKEND}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Diff display ───────────────────────────────────────────────────────
function PatchPreview({ patch, onApply, onDismiss }) {
  if (!patch) return null;
  const lines = patch.split('\n');
  return (
    <div className="aipp-patch">
      <div className="aipp-patch__header">
        <span className="aipp-patch__label">Patch Preview</span>
        <div style={{ display: 'flex', gap: 6 }}>
          {onApply   && <button className="aipp-btn aipp-btn--green" onClick={onApply}>Apply</button>}
          {onDismiss && <button className="aipp-btn aipp-btn--gray"  onClick={onDismiss}>Dismiss</button>}
        </div>
      </div>
      <div className="aipp-patch__body">
        {lines.map((line, i) => {
          const cls = line.startsWith('+') && !line.startsWith('+++') ? 'aipp-diff-add'
                    : line.startsWith('-') && !line.startsWith('---') ? 'aipp-diff-del'
                    : line.startsWith('@@') ? 'aipp-diff-meta' : '';
          return <div key={i} className={`aipp-diff-line ${cls}`}>{line}</div>;
        })}
      </div>
    </div>
  );
}

// ── Inline Code Action ─────────────────────────────────────────────────
function InlineActions({ code, language, onResult }) {
  const [loading, setLoading] = useState(null);

  const run = useCallback(async (action) => {
    if (!code.trim()) return;
    setLoading(action);
    try {
      const result = await jarvisPost('/jarvis/code-action', { action, code, language });
      onResult?.(action, result);
    } catch (e) {
      onResult?.(action, { error: e.message });
    } finally {
      setLoading(null);
    }
  }, [code, language, onResult]);

  const ACTIONS = [
    { id: 'explain',    label: 'Explain',      icon: '💡' },
    { id: 'refactor',   label: 'Refactor',     icon: '🔧' },
    { id: 'test',       label: 'Gen Tests',    icon: '🧪' },
    { id: 'review',     label: 'Code Review',  icon: '🔍' },
    { id: 'fix',        label: 'Fix Issues',   icon: '🩹' },
    { id: 'document',   label: 'Add Docs',     icon: '📝' },
  ];

  return (
    <div className="aipp-actions-grid">
      {ACTIONS.map(a => (
        <button
          key={a.id}
          className="aipp-action-btn"
          onClick={() => run(a.id)}
          disabled={!!loading}
          title={a.label}
        >
          <span className="aipp-action-btn__icon">{loading === a.id ? '⟳' : a.icon}</span>
          <span>{a.label}</span>
        </button>
      ))}
    </div>
  );
}

// ── Refactor dialog ────────────────────────────────────────────────────
function MultiFileRefactor() {
  const [files,   setFiles]   = useState('');
  const [goal,    setGoal]    = useState('');
  const [result,  setResult]  = useState(null);
  const [loading, setLoading] = useState(false);

  const run = useCallback(async () => {
    if (!goal.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await jarvisPost('/jarvis/refactor', {
        files: files.split('\n').map(f => f.trim()).filter(Boolean),
        goal: goal.trim(),
      });
      setResult(res);
    } catch (e) {
      setResult({ error: e.message });
    } finally {
      setLoading(false);
    }
  }, [files, goal]);

  const apply = useCallback(async () => {
    if (!result?.patches) return;
    for (const patch of result.patches) {
      if (window.electronAPI?.fsWriteFile) {
        await window.electronAPI.fsWriteFile({ path: patch.file, content: patch.content });
      }
    }
    setResult(r => ({ ...r, applied: true }));
  }, [result]);

  return (
    <div className="aipp-section">
      <div className="aipp-section__label">Multi-File Refactor</div>
      <textarea
        className="aipp-input"
        placeholder="File paths (one per line)…"
        value={files}
        onChange={e => setFiles(e.target.value)}
        rows={3}
      />
      <textarea
        className="aipp-input"
        placeholder="Refactor goal: e.g. 'Extract auth logic into service, add error handling'…"
        value={goal}
        onChange={e => setGoal(e.target.value)}
        rows={2}
      />
      <button
        className="aipp-btn aipp-btn--primary"
        onClick={run}
        disabled={loading || !goal.trim()}
      >
        {loading ? 'Working…' : 'Analyze & Refactor'}
      </button>
      {result?.error && <div className="aipp-error">{result.error}</div>}
      {result && !result.error && (
        <div className="aipp-result">
          {result.summary && <p className="aipp-result__summary">{result.summary}</p>}
          {result.patches?.map((p, i) => (
            <details key={i} className="aipp-result__patch">
              <summary>{p.file}</summary>
              <PatchPreview patch={p.diff} />
            </details>
          ))}
          {result.patches?.length > 0 && !result.applied && (
            <button className="aipp-btn aipp-btn--green" onClick={apply}>Apply All Patches</button>
          )}
          {result.applied && <div className="aipp-success">All patches applied.</div>}
        </div>
      )}
    </div>
  );
}

// ── Stack trace explainer ──────────────────────────────────────────────
function StackTraceExplainer() {
  const [trace,  setTrace]  = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const run = useCallback(async () => {
    if (!trace.trim()) return;
    setLoading(true);
    try {
      const res = await jarvisPost('/jarvis/explain-error', { error: trace });
      setResult(res);
    } catch (e) {
      setResult({ explanation: `Failed: ${e.message}` });
    } finally {
      setLoading(false);
    }
  }, [trace]);

  return (
    <div className="aipp-section">
      <div className="aipp-section__label">Stack Trace Explainer</div>
      <textarea
        className="aipp-input aipp-input--mono"
        placeholder="Paste stack trace or error output…"
        value={trace}
        onChange={e => setTrace(e.target.value)}
        rows={5}
      />
      <button className="aipp-btn aipp-btn--primary" onClick={run} disabled={loading || !trace.trim()}>
        {loading ? 'Analyzing…' : 'Explain'}
      </button>
      {result && (
        <div className="aipp-result">
          <p className="aipp-result__summary">{result.explanation}</p>
          {result.fix && <div className="aipp-result__fix"><strong>Fix:</strong> {result.fix}</div>}
          {result.patch && <PatchPreview patch={result.patch} />}
        </div>
      )}
    </div>
  );
}

// ── Code Review mode ───────────────────────────────────────────────────
function CodeReview() {
  const [cwd,    setCwd]    = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const run = useCallback(async () => {
    setLoading(true);
    setResult(null);
    try {
      let diff = '';
      if (window.electronAPI?.gitDiff) {
        const r = await window.electronAPI.gitDiff(cwd || undefined, 'HEAD');
        diff = r?.diff || r?.stdout || '';
      }
      const res = await jarvisPost('/jarvis/code-review', { diff, cwd });
      setResult(res);
    } catch (e) {
      setResult({ error: e.message });
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  return (
    <div className="aipp-section">
      <div className="aipp-section__label">Code Review</div>
      <input
        className="aipp-input"
        placeholder="Working directory (optional, defaults to repo root)…"
        value={cwd}
        onChange={e => setCwd(e.target.value)}
      />
      <button className="aipp-btn aipp-btn--primary" onClick={run} disabled={loading}>
        {loading ? 'Reviewing…' : 'Review HEAD Changes'}
      </button>
      {result?.error && <div className="aipp-error">{result.error}</div>}
      {result && !result.error && (
        <div className="aipp-result">
          {result.summary && <p className="aipp-result__summary">{result.summary}</p>}
          {result.issues?.map((issue, i) => (
            <div key={i} className={`aipp-issue aipp-issue--${issue.severity || 'info'}`}>
              <span className="aipp-issue__sev">{issue.severity?.toUpperCase() || 'INFO'}</span>
              <div className="aipp-issue__body">
                <div className="aipp-issue__title">{issue.title}</div>
                {issue.description && <div className="aipp-issue__desc">{issue.description}</div>}
                {issue.file && <div className="aipp-issue__file">{issue.file}{issue.line ? `:${issue.line}` : ''}</div>}
              </div>
            </div>
          ))}
          {!result.issues?.length && <div className="aipp-success">No issues found.</div>}
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────
const TABS = [
  { id: 'actions',  label: 'Code Actions' },
  { id: 'refactor', label: 'Refactor' },
  { id: 'trace',    label: 'Stack Traces' },
  { id: 'review',   label: 'Code Review' },
];

export default function AIPairProgramming({ className = '' }) {
  const [tab,     setTab]     = useState('actions');
  const [code,    setCode]    = useState('');
  const [lang,    setLang]    = useState('javascript');
  const [result,  setResult]  = useState(null);

  const onResult = useCallback((action, res) => {
    setResult({ action, ...res });
  }, []);

  const applyPatch = useCallback(async () => {
    if (!result?.patch || !window.electronAPI?.shellExec) return;
    await window.electronAPI.shellExec({ cmd: `echo '${result.patch}' | git apply` });
    setResult(r => ({ ...r, applied: true }));
  }, [result]);

  return (
    <div className={`aipp ${className}`}>
      <div className="aipp-header">
        <span className="aipp-header__title">AI Pair Programming</span>
      </div>

      <div className="aipp-tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`aipp-tab${tab === t.id ? ' aipp-tab--active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="aipp-body">
        {tab === 'actions' && (
          <div className="aipp-actions-layout">
            <div className="aipp-code-input-area">
              <div className="aipp-code-label-row">
                <span className="aipp-section__label">Paste Code</span>
                <select className="aipp-lang-select" value={lang} onChange={e => setLang(e.target.value)}>
                  {['javascript', 'typescript', 'python', 'go', 'rust', 'java', 'ruby', 'shell', 'sql'].map(l => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
              </div>
              <textarea
                className="aipp-input aipp-input--code"
                placeholder="Paste code here…"
                value={code}
                onChange={e => setCode(e.target.value)}
                rows={8}
                spellCheck={false}
              />
              <InlineActions code={code} language={lang} onResult={onResult} />
            </div>
            {result && (
              <div className="aipp-result-panel">
                <div className="aipp-result-panel__header">
                  <span className="aipp-result-panel__action">{result.action}</span>
                  <button className="aipp-close-btn" onClick={() => setResult(null)}>✕</button>
                </div>
                {result.error && <div className="aipp-error">{result.error}</div>}
                {result.explanation && <p className="aipp-result__summary">{result.explanation}</p>}
                {result.text && <p className="aipp-result__summary">{result.text}</p>}
                {result.code && (
                  <pre className="aipp-result__code">{result.code}</pre>
                )}
                {result.patch && (
                  <PatchPreview
                    patch={result.patch}
                    onApply={!result.applied ? applyPatch : undefined}
                    onDismiss={() => setResult(null)}
                  />
                )}
                {result.applied && <div className="aipp-success">Patch applied.</div>}
              </div>
            )}
          </div>
        )}

        {tab === 'refactor' && <MultiFileRefactor />}
        {tab === 'trace'    && <StackTraceExplainer />}
        {tab === 'review'   && <CodeReview />}
      </div>
    </div>
  );
}
