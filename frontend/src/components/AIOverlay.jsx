import React, { useState, useEffect, useCallback, useRef } from 'react';
import './AIOverlay.css';

const BACKEND = 'http://localhost:5050';

async function apiFetch(path, opts = {}) {
  const res = await fetch(`${BACKEND}${path}`, { credentials: 'include', ...opts });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Diff renderer ─────────────────────────────────────────────────────
function DiffView({ diff }) {
  if (!diff) return null;
  const lines = diff.split('\n');
  return (
    <div className="diff-view">
      {lines.map((line, i) => {
        const cls = line.startsWith('+') && !line.startsWith('+++')
          ? 'diff-line--add'
          : line.startsWith('-') && !line.startsWith('---')
          ? 'diff-line--del'
          : line.startsWith('@@')
          ? 'diff-line--meta'
          : '';
        return <div key={i} className={`diff-line ${cls}`}>{line}</div>;
      })}
    </div>
  );
}

// ── Chat message ──────────────────────────────────────────────────────
function Message({ msg }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`ai-message ai-message--${isUser ? 'user' : 'assistant'}`}>
      <div className="ai-message__bubble">
        {msg.content}
        {msg.patch && (
          <details className="ai-patch">
            <summary>View patch</summary>
            <DiffView diff={msg.patch} />
          </details>
        )}
        {msg.actions && msg.actions.length > 0 && (
          <div className="ai-message__actions">
            {msg.actions.map((a, i) => (
              <button key={i} className="ai-action-btn" onClick={a.fn}>{a.label}</button>
            ))}
          </div>
        )}
      </div>
      {msg.ts && <div className="ai-message__ts">{new Date(msg.ts).toLocaleTimeString()}</div>}
    </div>
  );
}

// ── Suggestion card ───────────────────────────────────────────────────
function SuggestionCard({ suggestion, onApprove, onDismiss }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="ai-suggestion">
      <div className="ai-suggestion__header" onClick={() => setExpanded(x => !x)}>
        <span className="ai-suggestion__icon">💡</span>
        <span className="ai-suggestion__title">{suggestion.title || suggestion.description || 'Suggestion'}</span>
        <span className="ai-suggestion__arrow">{expanded ? '▾' : '▸'}</span>
      </div>
      {expanded && (
        <div className="ai-suggestion__body">
          {suggestion.reason && <p className="ai-suggestion__reason">{suggestion.reason}</p>}
          {suggestion.patch && <DiffView diff={suggestion.patch} />}
          <div className="ai-suggestion__footer">
            <button className="ai-action-btn ai-action-btn--green" onClick={() => onApprove(suggestion.id)}>Apply</button>
            <button className="ai-action-btn ai-action-btn--gray"  onClick={() => onDismiss(suggestion.id)}>Dismiss</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Error explainer ───────────────────────────────────────────────────
function ErrorExplainer() {
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const explain = useCallback(async () => {
    if (!error.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await apiFetch('/jarvis/explain-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error }),
      });
      setResult(res);
    } catch (e) {
      setResult({ explanation: `Failed: ${e.message}` });
    } finally {
      setLoading(false);
    }
  }, [error]);

  return (
    <div className="ai-error-explainer">
      <textarea
        className="ai-error-input"
        placeholder="Paste an error message or stack trace…"
        value={error}
        onChange={e => setError(e.target.value)}
        rows={5}
      />
      <button
        className="ai-action-btn ai-action-btn--primary"
        onClick={explain}
        disabled={loading || !error.trim()}
      >
        {loading ? 'Explaining…' : 'Explain Error'}
      </button>
      {result && (
        <div className="ai-error-result">
          <div className="ai-error-result__explanation">{result.explanation}</div>
          {result.fix && (
            <div className="ai-error-result__fix">
              <strong>Fix:</strong> {result.fix}
            </div>
          )}
          {result.patch && <DiffView diff={result.patch} />}
        </div>
      )}
    </div>
  );
}

// ── AI Chat ───────────────────────────────────────────────────────────
function AIChat() {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: 'I\'m your Jarvis AI assistant. Ask me anything about your code, errors, or get suggestions.', ts: Date.now() },
  ]);
  const [input, setInput]     = useState('');
  const [loading, setLoading] = useState(false);
  const bodyRef               = useRef(null);
  const inputRef              = useRef(null);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    const userMsg = { role: 'user', content: text, ts: Date.now() };
    setMessages(m => [...m, userMsg]);
    setLoading(true);
    try {
      const res = await apiFetch('/jarvis/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history: messages.slice(-10) }),
      });
      const reply = { role: 'assistant', content: res.reply || res.message || res.text || JSON.stringify(res), ts: Date.now(), patch: res.patch };
      setMessages(m => [...m, reply]);
    } catch (e) {
      setMessages(m => [...m, { role: 'assistant', content: `Error: ${e.message}`, ts: Date.now() }]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [input, loading, messages]);

  const onKey = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }, [send]);

  return (
    <div className="ai-chat">
      <div className="ai-chat__body" ref={bodyRef}>
        {messages.map((m, i) => <Message key={i} msg={m} />)}
        {loading && (
          <div className="ai-message ai-message--assistant">
            <div className="ai-message__bubble ai-message__bubble--typing">
              <span className="ai-typing-dot" /><span className="ai-typing-dot" /><span className="ai-typing-dot" />
            </div>
          </div>
        )}
      </div>
      <div className="ai-chat__input-row">
        <textarea
          ref={inputRef}
          className="ai-chat__input"
          placeholder="Ask Jarvis…"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKey}
          rows={2}
        />
        <button
          className="ai-action-btn ai-action-btn--primary ai-chat__send"
          onClick={send}
          disabled={loading || !input.trim()}
        >↑</button>
      </div>
    </div>
  );
}

// ── Suggestions tab ───────────────────────────────────────────────────
function SuggestionsTab() {
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch('/jarvis/suggestions');
      setSuggestions(Array.isArray(data) ? data : (data.suggestions || []));
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const approve = useCallback(async (id) => {
    try {
      await apiFetch('/jarvis/suggestions/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      setSuggestions(s => s.filter(x => x.id !== id));
    } catch {}
  }, []);

  const dismiss = useCallback((id) => {
    setSuggestions(s => s.filter(x => x.id !== id));
  }, []);

  if (loading) return <div className="ai-status">Loading suggestions…</div>;
  if (error)   return <div className="ai-error">Failed: {error}</div>;
  if (!suggestions.length) return (
    <div className="ai-status">
      No suggestions right now.<br />
      <button className="ai-action-btn ai-action-btn--gray" style={{ marginTop: 12 }} onClick={load}>Refresh</button>
    </div>
  );

  return (
    <div className="ai-suggestions-list">
      {suggestions.map(s => (
        <SuggestionCard key={s.id} suggestion={s} onApprove={approve} onDismiss={dismiss} />
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────
const TABS = [
  { id: 'chat',    label: '💬 Chat' },
  { id: 'suggest', label: '💡 Suggestions' },
  { id: 'error',   label: '🐞 Errors' },
];

export default function AIOverlay({ className = '', collapsed = false, onToggle }) {
  const [tab, setTab] = useState('chat');

  return (
    <div className={`ai-overlay${collapsed ? ' ai-overlay--collapsed' : ''} ${className}`}>
      <div className="ai-overlay__header">
        <span className="ai-overlay__title">Jarvis AI</span>
        <div className="ai-overlay__header-actions">
          {!collapsed && (
            <div className="ai-overlay__tabs-inline">
              {TABS.map(t => (
                <button
                  key={t.id}
                  className={`ai-overlay__tab${tab === t.id ? ' ai-overlay__tab--active' : ''}`}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
          <button className="ai-overlay__toggle" onClick={onToggle} title={collapsed ? 'Expand' : 'Collapse'}>
            {collapsed ? '◀' : '▶'}
          </button>
        </div>
      </div>
      {!collapsed && (
        <div className="ai-overlay__body">
          {tab === 'chat'    && <AIChat />}
          {tab === 'suggest' && <SuggestionsTab />}
          {tab === 'error'   && <ErrorExplainer />}
        </div>
      )}
    </div>
  );
}
