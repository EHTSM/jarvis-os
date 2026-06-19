/**
 * CommitAssistant — pre-commit AI review panel.
 * Wired into AIPairProgramming as a "Commit" tab.
 * Uses /coding/ask to summarize diff, predict risk, and suggest message.
 */
import React, { useState, useEffect, useCallback } from "react";
import "./CommitAssistant.css";

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

function RiskBadge({ level }) {
  const map = { low: "success", medium: "warning", high: "danger" };
  const col = map[level] || "info";
  return <span className={`ca-risk ca-risk--${col}`}>{level || "—"} risk</span>;
}

export default function CommitAssistant({ cwd }) {
  const [diff,     setDiff]     = useState("");
  const [loading,  setLoading]  = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [copied,   setCopied]   = useState(null);

  // Auto-load git diff when cwd is known
  useEffect(() => {
    if (!cwd || !window.electronAPI?.shellExec) return;
    window.electronAPI.shellExec({ command: "git diff HEAD", cwd })
      .then(r => {
        const text = r?.stdout || r?.output || "";
        if (text.trim()) setDiff(text.trim().slice(0, 8000));
      }).catch(() => {});
  }, [cwd]);

  const analyze = useCallback(async () => {
    if (!diff.trim() || loading) return;
    setLoading(true);
    setAnalysis(null);
    try {
      const prompt = `Analyze this git diff and provide:
1. A one-line summary of what changed (keep it under 72 chars)
2. Risk level: low / medium / high
3. Risk reason (1 sentence)
4. Suggested commit message (Conventional Commits format)
5. Suggested PR description (2-3 bullet points)

Return as JSON: { summary, risk, riskReason, commitMessage, prDescription }

Diff:
\`\`\`diff
${diff.slice(0, 6000)}
\`\`\``;

      const res = await post("/coding/ask", { question: prompt, cwd });
      const raw = res?.answer || res?.text || res?.response || "{}";
      // Extract JSON from markdown code block if present
      const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, raw];
      const parsed = JSON.parse(jsonMatch[1].trim());
      setAnalysis(parsed);
    } catch (e) {
      setAnalysis({ error: "Could not parse AI response. Try again." });
    }
    setLoading(false);
  }, [diff, loading, cwd]);

  const copy = useCallback((text, key) => {
    try {
      if (window.electronAPI?.clipboardWrite) window.electronAPI.clipboardWrite(text);
      else navigator.clipboard?.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1600);
    } catch {}
  }, []);

  return (
    <div className="ca-root">
      <div className="ca-header">
        <span className="ca-title">Commit Assistant</span>
        {cwd && <span className="ca-cwd" title={cwd}>📁 {cwd.split("/").pop()}</span>}
      </div>

      {/* Diff area */}
      <div className="ca-diff-section">
        <div className="ca-label-row">
          <span className="ca-label">Git diff (auto-loaded)</span>
          <span className="ca-char-count">{diff.length} chars</span>
        </div>
        <textarea
          className="ca-diff-area"
          value={diff}
          onChange={e => setDiff(e.target.value)}
          placeholder="Paste git diff here, or open a project folder to auto-load…"
          rows={6}
          spellCheck={false}
        />
      </div>

      <button
        className="ca-analyze-btn"
        onClick={analyze}
        disabled={!diff.trim() || loading}
      >
        {loading ? "Analyzing…" : "✦ Analyze Changes"}
      </button>

      {analysis?.error && (
        <div className="ca-error">{analysis.error}</div>
      )}

      {analysis && !analysis.error && (
        <div className="ca-results">
          {/* Summary + Risk */}
          <div className="ca-result-block">
            <div className="ca-result-header">
              <span className="ca-result-label">Summary</span>
              <RiskBadge level={analysis.risk} />
            </div>
            <p className="ca-result-body">{analysis.summary}</p>
            {analysis.riskReason && (
              <p className="ca-risk-reason">{analysis.riskReason}</p>
            )}
          </div>

          {/* Commit message */}
          <div className="ca-result-block">
            <div className="ca-result-header">
              <span className="ca-result-label">Commit Message</span>
              <button className="ca-copy-btn" onClick={() => copy(analysis.commitMessage, "commit")}>
                {copied === "commit" ? "✓ Copied" : "Copy"}
              </button>
            </div>
            <pre className="ca-commit-msg">{analysis.commitMessage}</pre>
          </div>

          {/* PR description */}
          {analysis.prDescription && (
            <div className="ca-result-block">
              <div className="ca-result-header">
                <span className="ca-result-label">PR Description</span>
                <button className="ca-copy-btn" onClick={() => copy(analysis.prDescription, "pr")}>
                  {copied === "pr" ? "✓ Copied" : "Copy"}
                </button>
              </div>
              <pre className="ca-pr-desc">{analysis.prDescription}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
