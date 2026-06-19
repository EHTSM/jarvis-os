/**
 * GitBlame — inline author/commit/date annotation in gutter.
 * Runs `git blame <file> --porcelain` via window.electronAPI.shellExec.
 * Click on an annotation opens commit detail in VisualGit.
 * Falls back to AI-summarized blame when not in Electron.
 */
import React, { useState, useEffect, useCallback, useMemo } from "react";
import "./GitBlame.css";

const BASE = process.env.REACT_APP_API_URL || "";

function timeAgo(ts) {
  if (!ts) return "";
  const s = Math.floor((Date.now() - ts * 1000) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ts * 1000).toLocaleDateString();
}

function parseBlame(raw) {
  // porcelain format: 40-char hash followed by metadata lines
  const lines = {};
  const commits = {};
  let currentHash = null;
  let lineNum = 0;
  for (const line of raw.split("\n")) {
    const hashMatch = line.match(/^([0-9a-f]{40}) \d+ (\d+)/);
    if (hashMatch) {
      currentHash = hashMatch[1];
      lineNum = parseInt(hashMatch[2], 10);
      if (!commits[currentHash]) commits[currentHash] = { hash: currentHash };
      lines[lineNum] = currentHash;
      continue;
    }
    if (!currentHash) continue;
    if (line.startsWith("author "))           commits[currentHash].author = line.slice(7);
    if (line.startsWith("author-time "))      commits[currentHash].time = parseInt(line.slice(12), 10);
    if (line.startsWith("summary "))          commits[currentHash].summary = line.slice(8);
    if (line.startsWith("author-mail "))      commits[currentHash].email = line.slice(12).replace(/[<>]/g, "");
  }
  return { lines, commits };
}

function BlameGutter({ blameData, lineCount, activeCommit, onCommitClick }) {
  const { lines, commits } = blameData;

  return (
    <div className="git-blame-gutter">
      {Array.from({ length: lineCount }, (_, i) => {
        const lineNum = i + 1;
        const hash    = lines[lineNum];
        const commit  = hash ? commits[hash] : null;
        const isActive = hash && hash === activeCommit;

        // Only show label on first line of a commit block
        const prev = lines[lineNum - 1];
        const showLabel = hash && hash !== prev;

        return (
          <div
            key={lineNum}
            className={`git-blame-gutter__row${isActive ? " git-blame-gutter__row--active" : ""}`}
            onClick={() => hash && onCommitClick(hash, commits[hash])}
            title={commit ? `${commit.summary}\n${commit.author} — ${timeAgo(commit.time)}` : ""}
          >
            {showLabel && commit ? (
              <>
                <span className="git-blame-gutter__hash">{hash.slice(0, 7)}</span>
                <span className="git-blame-gutter__author">{commit.author?.split(" ")[0]}</span>
                <span className="git-blame-gutter__time">{timeAgo(commit.time)}</span>
              </>
            ) : (
              <span className="git-blame-gutter__blank">│</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function CommitPopup({ hash, commit, onClose, onViewHistory }) {
  const ref = React.useRef(null);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onClose]);

  if (!commit) return null;
  return (
    <div ref={ref} className="git-blame-popup">
      <div className="git-blame-popup__header">
        <code className="git-blame-popup__hash">{hash.slice(0, 12)}</code>
        <button className="git-blame-popup__close" onClick={onClose}>✕</button>
      </div>
      <div className="git-blame-popup__summary">{commit.summary}</div>
      <div className="git-blame-popup__meta">
        <span>{commit.author}</span>
        {commit.email && <span className="git-blame-popup__email">{commit.email}</span>}
        <span>{commit.time ? new Date(commit.time * 1000).toLocaleDateString() : ""}</span>
      </div>
      <button
        className="git-blame-popup__history-btn"
        onClick={() => { onViewHistory(hash); onClose(); }}
      >
        View in History ›
      </button>
    </div>
  );
}

export default function GitBlame({ filePath, cwd, lineCount = 0, visible, onViewHistory }) {
  const [blameData,    setBlameData]    = useState(null);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState(null);
  const [activeCommit, setActiveCommit] = useState(null);
  const [popup,        setPopup]        = useState(null); // { hash, commit }

  useEffect(() => {
    if (!visible || !filePath || !cwd) return;
    setLoading(true);
    setError(null);
    setBlameData(null);

    const run = async () => {
      if (window.electronAPI?.shellExec) {
        try {
          const r = await window.electronAPI.shellExec({
            command: `git blame "${filePath}" --porcelain`,
            cwd,
          });
          const raw = r?.stdout || r?.output || "";
          if (raw.trim()) {
            setBlameData(parseBlame(raw));
          } else {
            setError("No blame data (file may be untracked)");
          }
        } catch (e) {
          setError("git blame failed");
        }
      } else {
        // Fallback: ask AI for blame summary
        try {
          const r = await fetch(`${BASE}/coding/ask`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ question: `Briefly summarize who likely wrote ${filePath} and when, based on common patterns. This is a web app, so guess reasonably.`, cwd }),
          });
          const d = await r.json();
          setError("Desktop required for real git blame. AI summary: " + (d.answer || d.text || ""));
        } catch {
          setError("Git blame requires Electron desktop app");
        }
      }
      setLoading(false);
    };

    run();
  }, [visible, filePath, cwd]);

  const handleCommitClick = useCallback((hash, commit) => {
    setActiveCommit(hash);
    setPopup({ hash, commit });
  }, []);

  if (!visible) return null;

  return (
    <div className="git-blame-root">
      {loading && <div className="git-blame-loading">Loading blame…</div>}
      {error && <div className="git-blame-error">{error}</div>}
      {blameData && (
        <BlameGutter
          blameData={blameData}
          lineCount={lineCount}
          activeCommit={activeCommit}
          onCommitClick={handleCommitClick}
        />
      )}
      {popup && (
        <CommitPopup
          hash={popup.hash}
          commit={popup.commit}
          onClose={() => setPopup(null)}
          onViewHistory={onViewHistory || (() => {})}
        />
      )}
    </div>
  );
}
