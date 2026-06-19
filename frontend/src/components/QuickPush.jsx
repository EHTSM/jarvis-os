/**
 * QuickPush — one-click Commit → Push → Release → Pipeline workflow.
 * Reuses: /coding/ask (ACP-1) for commit message, /pipeline-run for CI trigger.
 * All git ops via window.electronAPI.shellExec.
 */
import React, { useState, useCallback } from "react";
import "./QuickPush.css";

const BASE = process.env.REACT_APP_API_URL || "";

async function shell(cmd, cwd) {
  if (!window.electronAPI?.shellExec) throw new Error("Desktop only");
  const r = await window.electronAPI.shellExec({ command: cmd, cwd });
  if ((r?.exit ?? 0) !== 0 && r?.stderr?.trim()) throw new Error(r.stderr.trim());
  return r?.stdout || r?.output || "";
}

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    credentials: "include", body: JSON.stringify(body),
  });
  return r.json();
}

const STAGES = [
  { id: "stage",   label: "Stage all"      },
  { id: "commit",  label: "Commit"         },
  { id: "push",    label: "Push"           },
  { id: "release", label: "Create release" },
  { id: "pipeline",label: "Trigger pipeline"},
];

export default function QuickPush({ cwd, onClose }) {
  const [commitMsg,    setCommitMsg]    = useState("");
  const [tag,          setTag]          = useState("");
  const [skipRelease,  setSkipRelease]  = useState(true);
  const [skipPipeline, setSkipPipeline] = useState(true);
  const [stage,        setStage]        = useState(null); // current stage id
  const [done,         setDone]         = useState({});   // { stageId: true }
  const [error,        setError]        = useState(null);
  const [running,      setRunning]      = useState(false);
  const [log,          setLog]          = useState([]);

  const addLog = (msg) => setLog(prev => [...prev, msg]);

  const generateMsg = useCallback(async () => {
    if (!cwd) return;
    try {
      const diff = await shell("git diff HEAD --stat", cwd).catch(() => "");
      const res  = await post("/coding/ask", {
        question: `Write a concise conventional commit message (max 72 chars) for these changes:\n${diff}\nReturn ONLY the commit message, nothing else.`,
        cwd,
      });
      const msg = (res?.answer || res?.text || "").trim().replace(/^["']|["']$/g, "");
      if (msg) setCommitMsg(msg);
    } catch {}
  }, [cwd]);

  const run = useCallback(async () => {
    if (!commitMsg.trim() || running) return;
    setRunning(true);
    setError(null);
    setLog([]);
    setDone({});

    const mark = (id) => setDone(d => ({ ...d, [id]: true }));

    try {
      setStage("stage");
      addLog("Staging all changes…");
      await shell("git add -A", cwd);
      mark("stage");

      setStage("commit");
      addLog(`Committing: ${commitMsg}`);
      await shell(`git commit -m ${JSON.stringify(commitMsg)}`, cwd);
      mark("commit");

      setStage("push");
      addLog("Pushing to origin…");
      const branch = (await shell("git branch --show-current", cwd)).trim() || "main";
      await shell(`git push origin ${branch}`, cwd);
      mark("push");

      if (!skipRelease && tag.trim()) {
        setStage("release");
        addLog(`Creating release tag ${tag}…`);
        await shell(`git tag -a ${tag.trim()} -m ${JSON.stringify(commitMsg)}`, cwd);
        await shell(`git push origin ${tag.trim()}`, cwd);
        mark("release");
      }

      if (!skipPipeline) {
        setStage("pipeline");
        addLog("Triggering pipeline…");
        await post("/pipeline-run", { cwd, trigger: "manual_push", commitMessage: commitMsg });
        mark("pipeline");
      }

      setStage("done");
      addLog("✓ All done!");
    } catch (e) {
      setError(e.message || "Push failed");
    }
    setRunning(false);
  }, [commitMsg, cwd, running, skipRelease, skipPipeline, tag]);

  const isDesktop = !!window.electronAPI?.shellExec;

  return (
    <div className="qp-root">
      <div className="qp-header">
        <span className="qp-title">Quick Push</span>
        {onClose && <button className="qp-close" onClick={onClose}>✕</button>}
      </div>

      {!isDesktop && (
        <div className="qp-warn">Git operations require the Electron desktop app.</div>
      )}

      {/* Pipeline visualization */}
      <div className="qp-pipeline">
        {STAGES.filter(s => s.id !== "release" || !skipRelease).filter(s => s.id !== "pipeline" || !skipPipeline).map(s => (
          <div
            key={s.id}
            className={`qp-stage${done[s.id] ? " qp-stage--done" : stage === s.id ? " qp-stage--active" : ""}`}
          >
            <div className="qp-stage__dot" />
            <span className="qp-stage__label">{s.label}</span>
          </div>
        ))}
      </div>

      {/* Commit message */}
      <div className="qp-field">
        <div className="qp-field-header">
          <label className="qp-label">Commit message</label>
          <button className="qp-gen-btn" onClick={generateMsg} disabled={running || !cwd}>
            ⬡ Generate
          </button>
        </div>
        <textarea
          className="qp-textarea"
          value={commitMsg}
          onChange={e => setCommitMsg(e.target.value)}
          placeholder="feat: describe your change…"
          rows={2}
          spellCheck={false}
        />
      </div>

      {/* Options */}
      <div className="qp-options">
        <label className="qp-check">
          <input type="checkbox" checked={!skipRelease} onChange={e => setSkipRelease(!e.target.checked)} />
          Create release tag
        </label>
        {!skipRelease && (
          <input
            className="qp-tag-input"
            placeholder="e.g. v1.0.3"
            value={tag}
            onChange={e => setTag(e.target.value)}
          />
        )}
        <label className="qp-check">
          <input type="checkbox" checked={!skipPipeline} onChange={e => setSkipPipeline(!e.target.checked)} />
          Trigger CI pipeline
        </label>
      </div>

      {/* Log */}
      {log.length > 0 && (
        <div className="qp-log">
          {log.map((l, i) => <div key={i} className="qp-log__line">{l}</div>)}
        </div>
      )}

      {error && <div className="qp-error">✗ {error}</div>}

      <button
        className="qp-run-btn"
        onClick={run}
        disabled={!commitMsg.trim() || running || !isDesktop}
      >
        {running ? (
          <><span className="qp-spinner" /> Running…</>
        ) : stage === "done" ? "✓ Complete" : "▶ Commit & Push"}
      </button>
    </div>
  );
}
