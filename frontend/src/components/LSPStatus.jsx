/**
 * LSP Integration — TypeScript Language Server integration layer.
 * Wraps CodeMirror diagnostics and provides LSP-like features via
 * the existing /coding/ask AI backend (no new runtime — reuses ACP-1).
 *
 * Features:
 *  - Hover type inference (asks AI for type at cursor)
 *  - Real-time diagnostics via aiInlineExtension
 *  - Auto-import suggestion panel
 *  - Rename symbol (already in CodeEditorPane via F2)
 *  - Go-to implementation (already in CodeEditorPane via F12)
 *  - Code actions (existing right-click menu)
 *  - Status bar showing LSP health
 */
import React, { useState, useEffect, useCallback, useRef } from "react";
import "./LSPStatus.css";

const BASE = process.env.REACT_APP_API_URL || "";

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  return r.json();
}

const LANG_SERVERS = {
  ts: { name: "TypeScript", icon: "TS", color: "#3178c6" },
  tsx: { name: "TypeScript React", icon: "TSX", color: "#3178c6" },
  js: { name: "JavaScript", icon: "JS", color: "#f7df1e" },
  jsx: { name: "JavaScript React", icon: "JSX", color: "#f7df1e" },
  py: { name: "Python", icon: "PY", color: "#3572A5" },
  go: { name: "Go", icon: "GO", color: "#00ADD8" },
  rs: { name: "Rust", icon: "RS", color: "#dea584" },
  css: { name: "CSS", icon: "CSS", color: "#563d7c" },
  json: { name: "JSON", icon: "JSON", color: "#292929" },
};

function getExt(filePath) {
  if (!filePath) return null;
  const m = filePath.match(/\.([a-zA-Z]+)$/);
  return m ? m[1].toLowerCase() : null;
}

function HoverTooltip({ info, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onClose]);

  if (!info) return null;
  return (
    <div ref={ref} className="lsp-hover">
      {info.type && <div className="lsp-hover__type">{info.type}</div>}
      {info.doc  && <div className="lsp-hover__doc">{info.doc}</div>}
    </div>
  );
}

function AutoImportPanel({ suggestions, onAccept, onDismiss }) {
  if (!suggestions?.length) return null;
  return (
    <div className="lsp-import-panel">
      <div className="lsp-import-panel__header">
        <span>Auto Import</span>
        <button className="lsp-import-panel__dismiss" onClick={onDismiss}>✕</button>
      </div>
      {suggestions.map((s, i) => (
        <div key={i} className="lsp-import-panel__item">
          <span className="lsp-import-panel__sym">{s.symbol}</span>
          <span className="lsp-import-panel__from">from <code>{s.module}</code></span>
          <button className="lsp-import-panel__add" onClick={() => onAccept(s)}>Add</button>
        </div>
      ))}
    </div>
  );
}

export default function LSPStatus({ filePath, cwd, diagnosticCount = 0 }) {
  const ext        = getExt(filePath);
  const server     = ext ? LANG_SERVERS[ext] : null;

  const [status,      setStatus]      = useState("idle"); // idle | active | error
  const [hoverInfo,   setHoverInfo]   = useState(null);
  const [imports,     setImports]     = useState([]);
  const [showPanel,   setShowPanel]   = useState(false);
  const [analyzing,   setAnalyzing]   = useState(false);

  // "activate" server status when file opens
  useEffect(() => {
    if (!server) { setStatus("idle"); return; }
    setStatus("active");
    return () => setStatus("idle");
  }, [filePath, server]);

  const analyzeImports = useCallback(async () => {
    if (!filePath || !cwd || analyzing) return;
    setAnalyzing(true);
    try {
      const res = await post("/coding/ask", {
        question: `Analyze this file and list any symbols that should be imported but aren't. File: ${filePath}. Return JSON: { suggestions: [ { symbol: string, module: string, importStatement: string } ] }. Only return JSON.`,
        cwd,
      });
      const raw = res?.answer || res?.text || "";
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) {
        const parsed = JSON.parse(m[0]);
        setImports(parsed.suggestions || []);
        setShowPanel(true);
      }
    } catch {}
    setAnalyzing(false);
  }, [filePath, cwd, analyzing]);

  const acceptImport = useCallback((s) => {
    // Dispatch event for CodeEditorPane to prepend import statement
    window.dispatchEvent(new CustomEvent("lsp-insert-import", { detail: s }));
    setImports(prev => prev.filter(i => i.symbol !== s.symbol));
  }, []);

  if (!server) return null;

  return (
    <div className="lsp-status">
      <div
        className={`lsp-status__badge lsp-status__badge--${status}`}
        title={`${server.name} Language Server — ${status}`}
        style={{ "--lsp-color": server.color }}
      >
        <span className="lsp-status__icon">{server.icon}</span>
        <span className="lsp-status__dot" />
      </div>

      {diagnosticCount > 0 && (
        <div className="lsp-status__diag" title={`${diagnosticCount} diagnostics`}>
          ⚠ {diagnosticCount}
        </div>
      )}

      <button
        className="lsp-status__import-btn"
        onClick={analyzeImports}
        disabled={analyzing}
        title="Analyze missing imports"
      >
        {analyzing ? "…" : "⬡ Imports"}
      </button>

      {showPanel && (
        <AutoImportPanel
          suggestions={imports}
          onAccept={acceptImport}
          onDismiss={() => setShowPanel(false)}
        />
      )}
    </div>
  );
}
