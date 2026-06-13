import React, { useState, useEffect, useCallback } from "react";
import { BASE_URL } from "../../_client";

async function _patchFetch(path, opts = {}) {
  const r = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    ...opts,
  });
  return r.json();
}

function getPatch(id)          { return _patchFetch(`/runtime/patches/${id}`); }
function applyPatch(id)        { return _patchFetch(`/runtime/patches/${id}/apply`,    { method: "POST", body: JSON.stringify({ approved: true }) }); }
function rollbackPatch(id)     { return _patchFetch(`/runtime/patches/${id}/rollback`, { method: "POST", body: JSON.stringify({ approved: true }) }); }
function verifyPatch(id, cmd)  { return _patchFetch(`/runtime/patches/${id}/verify`,   { method: "POST", body: JSON.stringify({ command: cmd, autoRollback: false }) }); }

function DiffLine({ line }) {
  const isAdd = line.type === "add";
  const isRem = line.type === "remove";
  const bg  = isAdd ? "rgba(0,255,163,0.08)" : isRem ? "rgba(255,45,85,0.08)" : "transparent";
  const col = isAdd ? "var(--op-green)"       : isRem ? "var(--op-red)"       : "var(--op-text2)";
  const pfx = isAdd ? "+"                     : isRem ? "−"                   : " ";
  return (
    <div style={{ display: "flex", background: bg, fontFamily: "monospace", fontSize: 10, lineHeight: "17px" }}>
      <span style={{ color: col, width: 14, flexShrink: 0, userSelect: "none", paddingLeft: 4 }}>{pfx}</span>
      <span style={{ color: isAdd || isRem ? col : "var(--op-text)", whiteSpace: "pre", overflow: "hidden", textOverflow: "ellipsis" }}>
        {line.content}
      </span>
    </div>
  );
}

export default function PatchApprovalPanel({ patchId, targetFile, onDone, addNotification }) {
  const [patch,      setPatch]      = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [applying,   setApplying]   = useState(false);
  const [verifying,  setVerifying]  = useState(false);
  const [testCmd,    setTestCmd]    = useState("");
  const [testResult, setTestResult] = useState(null);
  const [status,     setStatus]     = useState("pending"); // pending | applied | rolled_back | verified

  useEffect(() => {
    setLoading(true);
    getPatch(patchId)
      .then(r => { if (r.success && r.patch) setPatch(r.patch); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [patchId]);

  const handleApply = useCallback(async () => {
    setApplying(true);
    try {
      const r = await applyPatch(patchId);
      if (r.success) {
        setStatus("applied");
        addNotification?.(`Patch applied: ${targetFile}`, "ok");
        onDone?.("applied");
      } else {
        addNotification?.(`Apply failed: ${r.error || "unknown"}`, "warn");
      }
    } catch (e) {
      addNotification?.(`Apply error: ${e.message}`, "warn");
    } finally {
      setApplying(false);
    }
  }, [patchId, targetFile, addNotification, onDone]);

  const handleReject = useCallback(async () => {
    try {
      await rollbackPatch(patchId);
    } catch {}
    setStatus("rolled_back");
    addNotification?.("Patch rejected.", "info");
    onDone?.("rejected");
  }, [patchId, addNotification, onDone]);

  const handleVerify = useCallback(async () => {
    setVerifying(true);
    setTestResult(null);
    try {
      const r = await verifyPatch(patchId, testCmd || undefined);
      setTestResult(r);
      if (r.pass > 0 && r.fail === 0) {
        addNotification?.(`Tests passed: ${r.pass}/${r.pass + r.fail}`, "ok");
      } else if (r.fail > 0) {
        addNotification?.(`Tests failed: ${r.fail} fail / ${r.pass} pass`, "warn");
      } else {
        addNotification?.("Verify complete.", "info");
      }
    } catch (e) {
      addNotification?.(`Verify error: ${e.message}`, "warn");
    } finally {
      setVerifying(false);
    }
  }, [patchId, testCmd, addNotification]);

  if (loading) {
    return (
      <div className="patch-approval" style={{ padding: "8px 10px", fontSize: 10, color: "var(--op-text2)" }}>
        Loading patch…
      </div>
    );
  }

  const diff = patch?.diff;
  const lines = diff?.lines || [];
  const stats = diff ? `+${diff.linesAdded} / −${diff.linesRemoved}` : "";

  return (
    <div className="patch-approval" style={{
      border: "1px solid rgba(68,162,255,0.35)",
      borderRadius: 4,
      marginTop: 6,
      background: "rgba(68,162,255,0.04)",
      overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "6px 10px",
        background: "rgba(68,162,255,0.08)",
        borderBottom: "1px solid rgba(68,162,255,0.2)",
      }}>
        <span style={{ fontWeight: "bold", fontSize: 10, color: "var(--op-blue)" }}>
          PATCH READY
        </span>
        <span style={{ fontSize: 9, color: "var(--op-text2)", fontFamily: "monospace", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {targetFile || patch?.filePath || "file"}
        </span>
        {stats && (
          <span style={{ fontSize: 9, color: "var(--op-text2)", flexShrink: 0 }}>{stats}</span>
        )}
        {status !== "pending" && (
          <span style={{
            fontSize: 9, fontWeight: "bold", flexShrink: 0,
            color: status === "applied" || status === "verified" ? "var(--op-green)" : "var(--op-red)"
          }}>
            {status === "applied" ? "APPLIED" : status === "verified" ? "VERIFIED" : "REJECTED"}
          </span>
        )}
      </div>

      {/* Diff viewer */}
      {lines.length > 0 ? (
        <div style={{
          maxHeight: 220,
          overflowY: "auto",
          borderBottom: "1px solid rgba(68,162,255,0.15)",
        }}>
          {lines.map((line, i) => <DiffLine key={i} line={line} />)}
        </div>
      ) : (
        <div style={{ padding: "6px 10px", fontSize: 9, color: "var(--op-text2)" }}>
          Diff unavailable — patch stored (ID: {patchId?.slice(0, 8)}…)
        </div>
      )}

      {/* Test output */}
      {testResult && (
        <div style={{
          padding: "5px 10px",
          background: testResult.fail > 0 ? "rgba(255,45,85,0.06)" : "rgba(0,255,163,0.05)",
          borderBottom: "1px solid rgba(68,162,255,0.15)",
          fontSize: 9,
        }}>
          <div style={{ fontWeight: "bold", color: testResult.fail > 0 ? "var(--op-red)" : "var(--op-green)", marginBottom: 3 }}>
            Test results: {testResult.pass} pass / {testResult.fail} fail
            {testResult.rolledBack && " — auto-rolled back"}
          </div>
          {testResult.output && (
            <pre style={{
              margin: 0, fontFamily: "monospace", fontSize: 8,
              color: "var(--op-text2)", whiteSpace: "pre-wrap", wordBreak: "break-all",
              maxHeight: 100, overflowY: "auto"
            }}>
              {testResult.output.slice(0, 1200)}
              {testResult.output.length > 1200 ? "\n… (truncated)" : ""}
            </pre>
          )}
        </div>
      )}

      {/* Action bar */}
      {status === "pending" && (
        <div style={{ padding: "6px 10px", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <button
            onClick={handleApply}
            disabled={applying || verifying}
            style={{
              padding: "3px 12px", fontSize: 10, fontWeight: "bold", borderRadius: 3, cursor: "pointer",
              background: "rgba(0,255,163,0.15)", border: "1px solid rgba(0,255,163,0.4)",
              color: "var(--op-green)",
              opacity: applying ? 0.6 : 1,
            }}
          >
            {applying ? "Applying…" : "Apply"}
          </button>

          <button
            onClick={handleVerify}
            disabled={applying || verifying}
            style={{
              padding: "3px 12px", fontSize: 10, borderRadius: 3, cursor: "pointer",
              background: "rgba(68,162,255,0.08)", border: "1px solid rgba(68,162,255,0.3)",
              color: "var(--op-blue)",
              opacity: verifying ? 0.6 : 1,
            }}
          >
            {verifying ? "Running…" : "Run Tests"}
          </button>

          <button
            onClick={handleReject}
            disabled={applying || verifying}
            style={{
              padding: "3px 12px", fontSize: 10, borderRadius: 3, cursor: "pointer",
              background: "rgba(255,45,85,0.06)", border: "1px solid rgba(255,45,85,0.25)",
              color: "var(--op-red)",
            }}
          >
            Reject
          </button>

          {/* optional custom test command */}
          <input
            type="text"
            value={testCmd}
            onChange={e => setTestCmd(e.target.value)}
            placeholder="Test cmd (optional)"
            style={{
              flex: 1, minWidth: 120, padding: "2px 6px", fontSize: 9, borderRadius: 3,
              background: "rgba(0,0,0,0.2)", border: "1px solid var(--op-border2)",
              color: "var(--op-text)", fontFamily: "inherit",
            }}
          />
        </div>
      )}

      {status !== "pending" && (
        <div style={{ padding: "5px 10px", fontSize: 9, color: "var(--op-text2)" }}>
          Patch ID: <code style={{ fontFamily: "monospace" }}>{patchId?.slice(0, 16)}…</code>
          <button
            onClick={() => onDone?.("dismissed")}
            style={{ marginLeft: 10, fontSize: 9, background: "none", border: "none", cursor: "pointer", color: "var(--op-text2)", textDecoration: "underline" }}
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
