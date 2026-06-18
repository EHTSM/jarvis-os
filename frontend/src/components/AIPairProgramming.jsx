import React, { useState, useCallback, useRef, useEffect, lazy, Suspense } from 'react';
import { _fetch } from '../_client';
import './AIPairProgramming.css';

const PatchPreviewPanel = lazy(() => import('./PatchPreviewPanel'));

async function codingPost(path, body) {
  return _fetch(path, { method: 'POST', body: JSON.stringify(body) });
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

// ── Context indicator ──────────────────────────────────────────────────
function ContextBadge({ cwd, filePath, symbolContext }) {
  const items = [];
  if (cwd)           items.push({ icon: '📁', label: cwd.split('/').pop() || cwd, title: cwd });
  if (filePath)      items.push({ icon: '📄', label: filePath.split('/').pop(), title: filePath });
  if (symbolContext) items.push({ icon: 'ƒ', label: symbolContext, title: `Symbol: ${symbolContext}` });
  if (!items.length) return null;
  return (
    <div className="aipp-ctx-badges">
      {items.map((it, i) => (
        <span key={i} className="aipp-ctx-badge" title={it.title}>
          {it.icon} {it.label}
        </span>
      ))}
    </div>
  );
}

// ── Ask tab — free-form repo-aware chat + patch generation ────────────
function RepoAsk({ cwd, filePath, fileContent, symbolContext }) {
  const [mode,     setMode]     = useState('chat'); // 'chat' | 'patch'
  const [question, setQuestion] = useState('');
  const [history,  setHistory]  = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [patch,    setPatch]    = useState(null);   // { patchId, proposal, canApply, goal }
  const [patchLoading, setPatchLoading] = useState(false);
  const bottomRef = useRef(null);

  const QUICK = [
    { label: 'Explain this repository',    q: 'Give me an overview of this repository: its purpose, architecture, key modules, and entry points.' },
    { label: 'Where is X implemented?',    q: 'Where is authentication implemented in this repository?' },
    { label: 'Summarize current file',     q: 'Summarize the current file: what it does, its exports, and key design decisions.' },
    { label: 'Review before commit',       q: 'Review the current uncommitted changes. List any bugs, security issues, or style problems.' },
  ];

  const ask = useCallback(async (q) => {
    const text = (q || question).trim();
    if (!text || loading) return;
    const newHistory = [...history, { role: 'user', content: text }];
    setHistory(newHistory);
    setQuestion('');
    setLoading(true);
    try {
      const res = await codingPost('/coding/ask', {
        question: text,
        cwd,
        filePath,
        fileContent,
        symbolContext,
        history: newHistory.slice(-10),
      });
      setHistory(h => [...h, { role: 'assistant', content: res?.reply || res?.error || 'No response' }]);
    } catch (e) {
      setHistory(h => [...h, { role: 'assistant', content: `Error: ${e.message}` }]);
    } finally {
      setLoading(false);
    }
  }, [question, history, loading, cwd, filePath, fileContent, symbolContext]);

  const generatePatch = useCallback(async () => {
    const goal = question.trim();
    if (!goal || patchLoading) return;
    setPatch(null);
    setPatchLoading(true);
    setQuestion('');
    try {
      const res = await codingPost('/coding/generate-patch', {
        goal,
        cwd,
        filePath,
        fileContent,
        symbolContext,
      });
      if (res?.ok) {
        setPatch({ patchId: res.patchId, proposal: res.proposal, canApply: res.canApply, goal });
        setMode('patch');
      } else {
        setHistory(h => [...h, { role: 'assistant', content: `Patch generation failed: ${res?.error || 'unknown'}` }]);
        setMode('chat');
      }
    } catch (e) {
      setHistory(h => [...h, { role: 'assistant', content: `Error: ${e.message}` }]);
      setMode('chat');
    } finally {
      setPatchLoading(false);
    }
  }, [question, patchLoading, cwd, filePath, fileContent, symbolContext]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (mode === 'patch' || e.altKey) generatePatch();
      else ask();
    }
  };

  const handleApplied = (r) => {
    setHistory(h => [...h, {
      role: 'assistant',
      content: `Patch applied to ${r.appliedFiles?.join(', ')}. ${r.pipeline ? `Pipeline ${r.pipeline.pipelineId} running.` : ''}`,
    }]);
    setMode('chat');
    setPatch(null);
  };

  const handleConvertToMission = (mission) => {
    setHistory(h => [...h, {
      role: 'assistant',
      content: `Created mission: ${mission?.objective || 'untitled'} (${mission?.id || ''})`,
    }]);
    setMode('chat');
    setPatch(null);
  };

  return (
    <div className="aipp-ask">
      <ContextBadge cwd={cwd} filePath={filePath} symbolContext={symbolContext} />

      <div className="aipp-mode-tabs">
        <button className={`aipp-mode-tab${mode === 'chat'  ? ' aipp-mode-tab--active' : ''}`} onClick={() => setMode('chat')}>Chat</button>
        <button className={`aipp-mode-tab${mode === 'patch' ? ' aipp-mode-tab--active' : ''}`} onClick={() => setMode('patch')}>
          Patch {patch ? '●' : ''}
        </button>
      </div>

      {mode === 'chat' && (
        <>
          {!history.length && (
            <div className="aipp-quick-cmds">
              {QUICK.map((q, i) => (
                <button key={i} className="aipp-quick-btn" onClick={() => ask(q.q)}>{q.label}</button>
              ))}
            </div>
          )}
          <div className="aipp-chat-history">
            {history.map((msg, i) => (
              <div key={i} className={`aipp-chat-msg aipp-chat-msg--${msg.role}`}>
                <span className="aipp-chat-msg__role">{msg.role === 'user' ? 'You' : 'AI'}</span>
                <pre className="aipp-chat-msg__content">{msg.content}</pre>
              </div>
            ))}
            {(loading || patchLoading) && (
              <div className="aipp-chat-msg aipp-chat-msg--assistant">
                <span className="aipp-chat-msg__role">AI</span>
                <span className="aipp-chat-msg__thinking">
                  {patchLoading ? 'Generating patch proposal…' : 'Gathering repository context…'}
                </span>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
          {history.length > 0 && (
            <button className="aipp-clear-btn" onClick={() => setHistory([])}>Clear</button>
          )}
        </>
      )}

      {mode === 'patch' && patch && (
        <Suspense fallback={<div className="aipp-chat-thinking">Loading patch panel…</div>}>
          <PatchPreviewPanel
            goal={patch.goal}
            proposal={patch.proposal}
            canApply={patch.canApply}
            patchId={patch.patchId}
            cwd={cwd}
            onApplied={handleApplied}
            onRejected={() => { setPatch(null); setMode('chat'); }}
            onConvertToMission={handleConvertToMission}
          />
        </Suspense>
      )}
      {mode === 'patch' && !patch && !patchLoading && (
        <div className="aipp-patch-prompt">
          <div className="aipp-patch-prompt__label">Generate Patch</div>
          <div className="aipp-patch-prompt__hint">
            Describe the change you want. The AI will generate a structured patch proposal with affected files, risk score, and confidence. You can then Apply via Pipeline, Convert → Mission, or Reject.
          </div>
        </div>
      )}

      <div className="aipp-ask-input-row">
        <textarea
          className="aipp-input aipp-ask-input"
          placeholder={mode === 'patch'
            ? 'Describe the change… e.g. "Rename auth middleware to authGuard" (Enter to generate patch)'
            : 'Ask anything about the repository… (Enter to send)'}
          value={question}
          onChange={e => setQuestion(e.target.value)}
          onKeyDown={onKey}
          rows={2}
          disabled={loading || patchLoading}
          data-no-shortcuts
        />
        <div className="aipp-ask-btn-col">
          <button
            className="aipp-btn aipp-btn--primary aipp-ask-send"
            onClick={mode === 'patch' ? generatePatch : ask}
            disabled={(loading || patchLoading) || !question.trim()}
            title={mode === 'patch' ? 'Generate Patch' : 'Ask AI'}
          >
            {(loading || patchLoading) ? '⟳' : mode === 'patch' ? '⚡' : '→'}
          </button>
          {mode === 'chat' && question.trim() && (
            <button
              className="aipp-btn aipp-btn--patch-toggle"
              onClick={generatePatch}
              disabled={patchLoading || !question.trim()}
              title="Generate patch for this goal"
            >
              ⚡
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Inline Code Action ─────────────────────────────────────────────────
function InlineActions({ code, language, onResult, cwd, filePath, symbolContext }) {
  const [loading, setLoading] = useState(null);
  const runRef = useRef(null);

  const run = useCallback(async (action) => {
    if (!code.trim()) return;
    setLoading(action);
    try {
      const result = await codingPost('/coding/action', { action, code, language, cwd, filePath, symbolContext });
      onResult?.(action, result);
    } catch (e) {
      onResult?.(action, { error: e.message });
    } finally {
      setLoading(null);
    }
  }, [code, language, onResult, cwd, filePath, symbolContext]);

  runRef.current = run;

  useEffect(() => {
    const handler = (e) => {
      const { action } = e.detail || {};
      if (action) runRef.current?.(action);
    };
    window.addEventListener('aipp-auto-run', handler);
    return () => window.removeEventListener('aipp-auto-run', handler);
  }, []);

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
function MultiFileRefactor({ cwd }) {
  const [files,   setFiles]   = useState('');
  const [goal,    setGoal]    = useState('');
  const [result,  setResult]  = useState(null);
  const [loading, setLoading] = useState(false);

  const run = useCallback(async () => {
    if (!goal.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await codingPost('/coding/refactor', {
        files: files.split('\n').map(f => f.trim()).filter(Boolean),
        goal: goal.trim(),
        cwd,
      });
      setResult(res);
    } catch (e) {
      setResult({ error: e.message });
    } finally {
      setLoading(false);
    }
  }, [files, goal, cwd]);

  const apply = useCallback(async () => {
    if (!result?.patches) return;
    for (const patch of result.patches) {
      if (window.electronAPI?.fsWriteFile) {
        await window.electronAPI.fsWriteFile({ filePath: patch.file, data: patch.content });
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
        data-no-shortcuts
      />
      <textarea
        className="aipp-input"
        placeholder="Refactor goal: e.g. 'Extract auth logic into service, add error handling'…"
        value={goal}
        onChange={e => setGoal(e.target.value)}
        rows={2}
        data-no-shortcuts
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
function StackTraceExplainer({ cwd, filePath, fileContent }) {
  const [trace,  setTrace]  = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const run = useCallback(async () => {
    if (!trace.trim()) return;
    setLoading(true);
    try {
      const res = await codingPost('/coding/explain-error', { error: trace, cwd, filePath, fileContent });
      setResult(res);
    } catch (e) {
      setResult({ explanation: `Failed: ${e.message}` });
    } finally {
      setLoading(false);
    }
  }, [trace, cwd, filePath, fileContent]);

  return (
    <div className="aipp-section">
      <div className="aipp-section__label">Stack Trace Explainer</div>
      <textarea
        className="aipp-input aipp-input--mono"
        placeholder="Paste stack trace or error output…"
        value={trace}
        onChange={e => setTrace(e.target.value)}
        rows={5}
        data-no-shortcuts
      />
      <button className="aipp-btn aipp-btn--primary" onClick={run} disabled={loading || !trace.trim()}>
        {loading ? 'Analyzing…' : 'Explain'}
      </button>
      {result && (
        <div className="aipp-result">
          <p className="aipp-result__summary">{result.explanation || result.text}</p>
          {result.fix && <div className="aipp-result__fix"><strong>Fix:</strong> {result.fix}</div>}
          {result.patch && <PatchPreview patch={result.patch} />}
        </div>
      )}
    </div>
  );
}

// ── Code Review mode ───────────────────────────────────────────────────
function CodeReview({ cwd: defaultCwd }) {
  const [cwd,    setCwd]    = useState(defaultCwd || '');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  // Sync cwd prop when it changes (editor changes project)
  useEffect(() => { if (defaultCwd) setCwd(defaultCwd); }, [defaultCwd]);

  const run = useCallback(async () => {
    setLoading(true);
    setResult(null);
    try {
      let diff = '';
      if (window.electronAPI?.gitDiff) {
        const r = await window.electronAPI.gitDiff(cwd || undefined, 'HEAD');
        diff = r?.diff || r?.stdout || '';
      }
      const res = await codingPost('/coding/review', { diff, cwd });
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
          {!result.issues?.length && result.reply && (
            <pre className="aipp-result__code" style={{ whiteSpace: 'pre-wrap' }}>{result.reply}</pre>
          )}
          {!result.issues?.length && !result.reply && <div className="aipp-success">No issues found.</div>}
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────
const TABS = [
  { id: 'ask',      label: 'Ask AI' },
  { id: 'actions',  label: 'Code Actions' },
  { id: 'refactor', label: 'Refactor' },
  { id: 'trace',    label: 'Stack Traces' },
  { id: 'review',   label: 'Code Review' },
];

export default function AIPairProgramming({ className = '', cwd, filePath, symbolContext }) {
  const [tab,         setTab]         = useState('ask');
  const [code,        setCode]        = useState('');
  const [lang,        setLang]        = useState('javascript');
  const [result,      setResult]      = useState(null);
  const [fileContent, setFileContent] = useState('');

  // Read file content when filePath changes (for context-aware AI)
  useEffect(() => {
    if (!filePath || !window.electronAPI?.fsReadFile) { setFileContent(''); return; }
    window.electronAPI.fsReadFile({ filePath }).then(r => {
      setFileContent(typeof r === 'string' ? r : (r?.data || ''));
    }).catch(() => setFileContent(''));
  }, [filePath]);

  const onResult = useCallback((action, res) => {
    setResult({ action, ...res });
  }, []);

  // Listen for selection pushed from the code editor right-click menu
  useEffect(() => {
    const handler = (e) => {
      const { capability, payload } = e.detail || {};
      if (!payload?.selection) return;
      setCode(payload.selection);
      setTab('actions');
      const capToAction = {
        'code.explain': 'explain',
        'code.review':  'review',
        'code.generatePatch': 'refactor',
      };
      const action = capToAction[capability];
      if (action) {
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('aipp-auto-run', { detail: { action, code: payload.selection, lang: 'javascript' } }));
        }, 80);
      }
    };
    window.addEventListener('jarvis-capability', handler);
    return () => window.removeEventListener('jarvis-capability', handler);
  }, []);

  const applyPatch = useCallback(async () => {
    if (!result?.patch || !window.electronAPI?.shellExec) return;
    const tmp = `${Date.now()}-ooplix.patch`;
    const appInfo = await window.electronAPI.getAppInfo?.() || {};
    const tmpPath = `${appInfo.userData || ''}/ooplix-patches/${tmp}`;
    const wr = await window.electronAPI.fsWriteFile({ filePath: tmpPath, data: result.patch });
    if (!wr?.ok) { setResult(rv => ({ ...rv, error: wr?.error || 'Failed to write patch' })); return; }
    const r = await window.electronAPI.shellExec({ command: `git apply "${tmpPath}"` });
    if (!r?.ok) { setResult(rv => ({ ...rv, error: r?.stderr || 'Patch apply failed' })); return; }
    setResult(rv => ({ ...rv, applied: true }));
  }, [result]);

  return (
    <div className={`aipp ${className}`}>
      <div className="aipp-header">
        <span className="aipp-header__title">AI Engineering Assistant</span>
        {(cwd || filePath) && (
          <span className="aipp-header__ctx" title={filePath || cwd}>
            {filePath ? filePath.split('/').pop() : cwd?.split('/').pop()}
          </span>
        )}
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
        {tab === 'ask' && (
          <RepoAsk
            cwd={cwd}
            filePath={filePath}
            fileContent={fileContent}
            symbolContext={symbolContext}
          />
        )}

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
                placeholder="Paste code here, or right-click in editor and choose an AI action…"
                value={code}
                onChange={e => setCode(e.target.value)}
                rows={8}
                spellCheck={false}
                data-no-shortcuts
              />
              <InlineActions
                code={code}
                language={lang}
                onResult={onResult}
                cwd={cwd}
                filePath={filePath}
                symbolContext={symbolContext}
              />
            </div>
            {result && (
              <div className="aipp-result-panel">
                <div className="aipp-result-panel__header">
                  <span className="aipp-result-panel__action">{result.action}</span>
                  <button className="aipp-close-btn" onClick={() => setResult(null)}>✕</button>
                </div>
                {result.error && <div className="aipp-error">{result.error}</div>}
                {result.explanation && !result.code && <pre className="aipp-result__code" style={{ whiteSpace: 'pre-wrap' }}>{result.explanation}</pre>}
                {result.text && !result.explanation && !result.code && <pre className="aipp-result__code" style={{ whiteSpace: 'pre-wrap' }}>{result.text}</pre>}
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

        {tab === 'refactor' && <MultiFileRefactor cwd={cwd} />}
        {tab === 'trace'    && <StackTraceExplainer cwd={cwd} filePath={filePath} fileContent={fileContent} />}
        {tab === 'review'   && <CodeReview cwd={cwd} />}
      </div>
    </div>
  );
}
