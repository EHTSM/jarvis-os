/**
 * Engineering Workspace — B4.5
 * Single screen: Prompt → Pipeline → Patch → Tests → Deploy → Observability → Healing
 * No manual steps — each stage auto-advances where possible.
 */
import React, { useState, useEffect, useCallback, useRef } from "react";
import { track } from "../analytics";
import { BASE_URL } from "../_client";
import { getRuntimeStatus, getDLQ, listPatches, getRuntimeHistory } from "../runtimeApi";

// ── fetch helpers ─────────────────────────────────────────────────────

async function _get(path) {
  const r = await fetch(`${BASE_URL}${path}`, { credentials: "include" });
  return r.json();
}
async function _post(path, body = {}) {
  const r = await fetch(`${BASE_URL}${path}`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}

// ── constants ─────────────────────────────────────────────────────────

const STAGE_ORDER = ["plan", "patch", "test", "apply", "deploy", "observe", "heal", "learn"];

const STAGE_META = {
  plan:    { label: "Plan",    icon: "◎", color: "#7c6fff" },
  patch:   { label: "Patch",   icon: "⧗", color: "#f0b429" },
  test:    { label: "Test",    icon: "⬡", color: "#44a2ff" },
  apply:   { label: "Apply",   icon: "⬢", color: "#44d9ff" },
  deploy:  { label: "Deploy",  icon: "⇪", color: "#52d68a" },
  observe: { label: "Observe", icon: "◉", color: "#c8cdd8" },
  heal:    { label: "Heal",    icon: "⊕", color: "#f55b5b" },
  learn:   { label: "Learn",   icon: "★", color: "#f0b429" },
};

const STATUS_COLOR = {
  running: "#7c6fff", pending: "#f0b429", ok: "#52d68a", success: "#52d68a",
  pass: "#52d68a", fail: "#f55b5b", error: "#f55b5b", skipped: "#8994b0",
  rolled_back: "#f55b5b", done: "#52d68a", idle: "#8994b0",
};
function sc(s) { return STATUS_COLOR[s] || "#8994b0"; }

// ── tiny components ───────────────────────────────────────────────────

function StatusDot({ s }) {
  const col = sc(s);
  const anim = s === "running" ? "ws-spin 1s linear infinite" : "none";
  return <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: col, marginRight: 5, animation: anim }} />;
}

function Tag({ label, color }) {
  return (
    <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 3,
      color: color || "#8994b0", background: (color || "#8994b0") + "18",
      border: `1px solid ${(color || "#8994b0")}30` }}>
      {label}
    </span>
  );
}

function Pill({ children, onClick, disabled, variant = "default" }) {
  const variants = {
    default: { bg: "rgba(255,255,255,0.06)", border: "rgba(255,255,255,0.12)", color: "#c8cdd8" },
    primary: { bg: "rgba(68,162,255,0.15)",  border: "rgba(68,162,255,0.35)",   color: "#44a2ff" },
    danger:  { bg: "rgba(245,91,91,0.12)",   border: "rgba(245,91,91,0.3)",     color: "#f55b5b" },
    success: { bg: "rgba(82,214,138,0.12)",  border: "rgba(82,214,138,0.3)",    color: "#52d68a" },
    warn:    { bg: "rgba(240,180,41,0.12)",  border: "rgba(240,180,41,0.3)",    color: "#f0b429" },
  };
  const v = variants[variant] || variants.default;
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ padding: "4px 12px", fontSize: 10, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer",
        background: v.bg, border: `1px solid ${v.border}`, borderRadius: 4, color: v.color,
        opacity: disabled ? 0.5 : 1, fontFamily: "inherit" }}>
      {children}
    </button>
  );
}

function Card({ title, children, status, onRefresh, style }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, overflow: "hidden", ...style }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#8994b0" }}>
          {status && <StatusDot s={status} />}{title}
        </span>
        {onRefresh && (
          <button onClick={onRefresh} style={{ fontSize: 9, padding: "1px 6px", background: "none", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 3, cursor: "pointer", color: "#8994b0" }}>⟳</button>
        )}
      </div>
      <div style={{ padding: "10px 12px" }}>{children}</div>
    </div>
  );
}

function Timeline({ steps }) {
  if (!steps || steps.length === 0) return <span style={{ fontSize: 10, color: "#8994b0" }}>No steps yet</span>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {steps.map((s, i) => (
        <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <StatusDot s={s.ok === false ? "fail" : s.ok === true ? "ok" : "pending"} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: "#c8cdd8" }}>{s.step}</span>
            {s.detail && <span style={{ fontSize: 9, color: "#8994b0", marginLeft: 6 }}>{String(s.detail).slice(0, 80)}</span>}
            {s.verdict && <Tag label={s.verdict} color={s.verdict === "pass" ? "#52d68a" : "#f55b5b"} />}
            {s.pass != null && <span style={{ fontSize: 9, color: "#52d68a", marginLeft: 4 }}>+{s.pass}</span>}
            {s.fail != null && s.fail > 0 && <span style={{ fontSize: 9, color: "#f55b5b", marginLeft: 4 }}>−{s.fail}</span>}
          </div>
          {s.ts && <span style={{ fontSize: 8, color: "#8994b0", flexShrink: 0 }}>{new Date(s.ts).toLocaleTimeString()}</span>}
        </div>
      ))}
    </div>
  );
}

function DiffView({ diff }) {
  if (!diff) return null;
  const lines = diff.split("\n");
  return (
    <pre style={{ fontSize: 9, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 200, overflow: "auto", margin: 0, background: "rgba(0,0,0,0.2)", borderRadius: 4, padding: "6px 8px", fontFamily: "monospace" }}>
      {lines.map((l, i) => (
        <span key={i} style={{ display: "block", color: l.startsWith("+") ? "#52d68a" : l.startsWith("-") ? "#f55b5b" : "#8994b0" }}>{l}</span>
      ))}
    </pre>
  );
}

function TapOutput({ output, pass, fail }) {
  if (!output && pass == null) return null;
  return (
    <div style={{ marginTop: 6 }}>
      {(pass != null || fail != null) && (
        <div style={{ display: "flex", gap: 10, marginBottom: 4 }}>
          {pass != null && <Tag label={`${pass} pass`} color="#52d68a" />}
          {fail != null && fail > 0 && <Tag label={`${fail} fail`} color="#f55b5b" />}
        </div>
      )}
      {output && (
        <pre style={{ fontSize: 8, color: "#8994b0", whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 120, overflow: "auto", margin: 0, fontFamily: "monospace", background: "rgba(0,0,0,0.2)", borderRadius: 4, padding: "4px 6px" }}>
          {output.slice(0, 1200)}{output.length > 1200 ? "\n…" : ""}
        </pre>
      )}
    </div>
  );
}

// ── Stage progress bar ────────────────────────────────────────────────

function StageRail({ stages, active }) {
  return (
    <div style={{ display: "flex", gap: 2, marginBottom: 20, overflowX: "auto", paddingBottom: 2 }}>
      {STAGE_ORDER.map((sid, i) => {
        const meta  = STAGE_META[sid];
        const stg   = stages[sid] || {};
        const isAct = active === sid;
        const isDone = stg.status === "done" || stg.status === "ok" || stg.status === "pass";
        const isFail = stg.status === "fail" || stg.status === "error" || stg.status === "rolled_back";
        const isRun  = stg.status === "running";
        const col    = isDone ? "#52d68a" : isFail ? "#f55b5b" : isRun ? meta.color : isAct ? meta.color : "#3a3f4b";
        const textCol = isDone || isFail || isRun || isAct ? "#e6edf3" : "#8994b0";
        return (
          <React.Fragment key={sid}>
            <div style={{ flex: "0 0 auto", display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
              <div style={{ width: 32, height: 32, borderRadius: "50%", background: col + "22", border: `2px solid ${col}`,
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14,
                transition: "all 0.3s", boxShadow: isAct ? `0 0 10px ${col}55` : "none" }}>
                {isDone ? "✓" : isFail ? "✗" : isRun ? "⊙" : meta.icon}
              </div>
              <span style={{ fontSize: 8, fontWeight: 600, color: textCol, whiteSpace: "nowrap" }}>{meta.label}</span>
            </div>
            {i < STAGE_ORDER.length - 1 && (
              <div style={{ flex: 1, height: 2, alignSelf: "center", marginBottom: 14,
                background: isDone ? "#52d68a33" : "#3a3f4b", minWidth: 10 }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ── Main workspace ────────────────────────────────────────────────────

const INIT_STAGES = STAGE_ORDER.reduce((acc, s) => ({ ...acc, [s]: { status: "idle" } }), {});

export default function EngineeringWorkspace() {
  const [prompt,      setPrompt]      = useState("");
  const [activeStage, setActiveStage] = useState(null);
  const [stages,      setStages]      = useState(INIT_STAGES);
  const [running,     setRunning]     = useState(false);
  const [sessionId,   setSessionId]   = useState(null);

  // live data panels
  const [pipelineResult, setPipelineResult] = useState(null);
  const [patchList,      setPatchList]      = useState([]);
  const [activePatch,    setActivePatch]    = useState(null);  // { patchId, diff, filePath }
  const [autoPipelineResult, setAutoPipelineResult] = useState(null);
  const [runtimeStatus,  setRuntimeStatus]  = useState(null);
  const [dlq,            setDlq]            = useState(null);
  const [incidents,      setIncidents]      = useState([]);
  const [healTimeline,   setHealTimeline]   = useState([]);
  const [learnSummary,   setLearnSummary]   = useState(null);
  const [history,        setHistory]        = useState([]);

  const promptRef = useRef(null);

  // helper to update a single stage
  const setStage = useCallback((name, patch) => {
    setStages(prev => ({ ...prev, [name]: { ...prev[name], ...patch } }));
    setActiveStage(name);
  }, []);

  // Load observability data on mount and periodically
  const refreshObs = useCallback(async () => {
    const [stat, d, inc, hist] = await Promise.all([
      getRuntimeStatus().catch(() => null),
      getDLQ(5).catch(() => null),
      _get("/runtime/incidents?limit=10").catch(() => null),
      getRuntimeHistory(20).catch(() => null),
    ]);
    if (stat) setRuntimeStatus(stat);
    if (d)    setDlq(d);
    if (inc?.success) setIncidents(inc.incidents || []);
    setHistory(Array.isArray(hist) ? hist : (hist?.entries || hist?.history || []));
  }, []);

  const refreshPatches = useCallback(async () => {
    const r = await listPatches().catch(() => null);
    if (r?.patches) setPatchList(r.patches);
  }, []);

  const refreshLearn = useCallback(async () => {
    const r = await _get("/runtime/patches/learning/summary").catch(() => null);
    if (r?.success) setLearnSummary(r);
  }, []);

  useEffect(() => {
    refreshObs();
    refreshPatches();
    refreshLearn();
    const t = setInterval(refreshObs, 20000);
    return () => clearInterval(t);
  }, [refreshObs, refreshPatches, refreshLearn]);

  // ── MAIN LOOP: Prompt → Plan → Patch → Test → Apply → Deploy → Observe → Heal → Learn ──

  async function runLoop() {
    if (!prompt.trim() || running) return;
    setRunning(true);
    setStages(INIT_STAGES);
    setAutoPipelineResult(null);
    setPipelineResult(null);
    setActivePatch(null);
    setHealTimeline([]);
    const sid = `ws-${Date.now()}`;
    setSessionId(sid);
    track("workspace_loop_started");

    try {
      // ── Stage 1: Plan ──
      setStage("plan", { status: "running" });
      let pipeResult = null;
      try {
        const r = await _post("/runtime/pipeline/run", { request: prompt, sessionId: sid });
        pipeResult = r;
        setPipelineResult(r);
        const ok = r.success && r.stages?.every(s => s.status !== "failed");
        setStage("plan", { status: ok ? "done" : "fail", stages: r.stages });
        if (!ok) { setRunning(false); return; }
      } catch (err) {
        setStage("plan", { status: "fail", error: err.message });
        setRunning(false); return;
      }

      // ── Stage 2: Patch ──
      setStage("patch", { status: "running" });
      await refreshPatches();
      // Also check if pipeline returned a patchId directly
      const newPatchId = pipeResult?.patchId || pipeResult?.result?.patchId || null;
      const freshPatches = await listPatches("pending").catch(() => null);
      const pending = freshPatches?.patches || [];
      const targetPatch = newPatchId
        ? pending.find(p => p.id === newPatchId) || pending[0]
        : pending[0];

      if (!targetPatch) {
        setStage("patch", { status: "skipped", note: "No patch proposed by pipeline" });
        setStage("test",  { status: "skipped" });
        setStage("apply", { status: "skipped" });
      } else {
        // Load diff
        const patchDetail = await _get(`/runtime/patches/${targetPatch.id}`).catch(() => null);
        const diff = patchDetail?.patch?.diff || targetPatch.diff || null;
        setActivePatch({ patchId: targetPatch.id, diff, filePath: targetPatch.filePath });
        setPatchList(prev => [targetPatch, ...prev.filter(p => p.id !== targetPatch.id)]);
        setStage("patch", { status: "done", patchId: targetPatch.id, filePath: targetPatch.filePath, diff });

        // ── Stage 3+4+5: Test → Apply → Deploy (auto-pipeline) ──
        setStage("test",  { status: "running" });
        const auto = await _post(`/runtime/patches/${targetPatch.id}/auto-pipeline`, {
          autoRollback: true,
          operatorId: "workspace",
        });
        setAutoPipelineResult(auto);

        // update stages from auto-pipeline timeline
        const tl = auto.timeline || [];
        const applyStep  = tl.find(s => s.step === "apply");
        const verifyStep = tl.find(s => s.step === "verify");
        const rollStep   = tl.find(s => s.step === "rollback");

        if (verifyStep) {
          setStage("test", {
            status: verifyStep.verdict === "pass" ? "done" : verifyStep.verdict === "skipped" ? "skipped" : "fail",
            pass: verifyStep.pass, fail: verifyStep.fail, output: verifyStep.output,
          });
        } else {
          setStage("test", { status: "skipped" });
        }

        if (applyStep?.ok) {
          setStage("apply", { status: rollStep ? "rolled_back" : "done", filePath: applyStep.detail });
        } else {
          setStage("apply", { status: "fail", error: applyStep?.detail });
        }

        // record learning immediately
        if (auto.patchId) {
          await _post(`/runtime/patches/${auto.patchId}/learn`, {
            outcome: auto.passed ? "success" : "failure",
            verdict: auto.verdict,
            pass: auto.pass,
            fail: auto.fail,
          }).catch(() => {});
        }
      }

      // ── Stage 5: Deploy ──
      setStage("deploy", { status: "running" });
      try {
        const deploy = await _post("/runtime/pipeline/run", {
          request: prompt, sessionId: sid, autoDeploy: true, skipCodeGen: true
        });
        const deployed = deploy?.stages?.some(s => s.stage === "deploy" && s.status === "success");
        setStage("deploy", { status: deployed ? "done" : "skipped", note: deployed ? "Deployed" : "No deploy stage in pipeline" });
      } catch {
        setStage("deploy", { status: "skipped" });
      }

      // ── Stage 6: Observe ──
      setStage("observe", { status: "running" });
      await refreshObs();
      const runtimeOk = runtimeStatus?.ok || runtimeStatus?.healthy;
      setStage("observe", { status: "done", healthy: runtimeOk });

      // ── Stage 7: Heal ──
      setStage("heal", { status: "running" });
      const openInc = incidents.filter(i => i.status === "open" || i.status === "detected");
      const healTL  = [];
      if (openInc.length > 0) {
        const topInc = openInc[0];
        const fixRes = await _post(`/runtime/incidents/${topInc.id}/auto-fix`, { operatorId: "workspace", queueApproval: true }).catch(() => null);
        if (fixRes?.success) {
          healTL.push(...(fixRes.timeline || []));
          setStage("heal", { status: "done", incidentId: topInc.id, patchId: fixRes.patchId, planId: fixRes.planId });
        } else {
          setStage("heal", { status: "skipped", note: "No actionable incidents" });
        }
      } else {
        setStage("heal", { status: "done", note: "No open incidents" });
      }
      setHealTimeline(healTL);

      // ── Stage 8: Learn ──
      setStage("learn", { status: "running" });
      await refreshLearn();
      await refreshPatches();
      setStage("learn", { status: "done" });

    } catch (err) {
      setStage(activeStage || "plan", { status: "fail", error: err.message });
    } finally {
      setRunning(false);
      setActiveStage(null);
    }
  }

  // ── Incident → Fix handler (from Heal panel) ──
  async function handleIncidentFix(incidentId) {
    setStage("heal", { status: "running" });
    const r = await _post(`/runtime/incidents/${incidentId}/auto-fix`, { operatorId: "workspace", queueApproval: true }).catch(() => null);
    if (r?.success) {
      setHealTimeline(r.timeline || []);
      setStage("heal", { status: "done", incidentId, patchId: r.patchId, planId: r.planId });
      await refreshPatches();
    } else {
      setStage("heal", { status: "fail", error: r?.error || "auto-fix failed" });
    }
    track("workspace_incident_fix");
  }

  // ── Manual patch auto-pipeline ──
  async function handleManualAutoPipeline(patchId) {
    setStage("test",  { status: "running" });
    setStage("apply", { status: "running" });
    const r = await _post(`/runtime/patches/${patchId}/auto-pipeline`, { autoRollback: true, operatorId: "workspace" }).catch(() => null);
    setAutoPipelineResult(r);
    if (r) {
      const tl = r.timeline || [];
      const v  = tl.find(s => s.step === "verify");
      const a  = tl.find(s => s.step === "apply");
      const rb = tl.find(s => s.step === "rollback");
      setStage("test",  { status: v ? (v.verdict === "pass" ? "done" : "fail") : "skipped", pass: v?.pass, fail: v?.fail, output: v?.output });
      setStage("apply", { status: a?.ok ? (rb ? "rolled_back" : "done") : "fail" });
      if (r.patchId) await _post(`/runtime/patches/${r.patchId}/learn`, { outcome: r.passed ? "success" : "failure", verdict: r.verdict, pass: r.pass, fail: r.fail }).catch(() => {});
      await refreshPatches();
      await refreshLearn();
    }
    track("workspace_manual_auto_pipeline");
  }

  const pipelineStages = pipelineResult?.stages || [];
  const stgPatch  = stages.patch;
  const stgTest   = stages.test;
  const stgApply  = stages.apply;
  const stgHeal   = stages.heal;
  const stgLearn  = stages.learn;
  const stgObs    = stages.observe;
  const dlqCount  = dlq?.total ?? 0;
  const openIncCount = incidents.filter(i => i.status === "open" || i.status === "detected").length;

  return (
    <div style={{ minHeight: "100vh", background: "#0d1117", color: "#c8cdd8", fontFamily: "system-ui, -apple-system, sans-serif", padding: "24px" }}>
      <style>{`
        @keyframes ws-spin { to { transform: rotate(360deg); } }
        @keyframes ws-pulse { 0%,100%{opacity:0.4} 50%{opacity:1} }
      `}</style>

      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: "#e6edf3" }}>Engineering Workspace</h1>
          {running && <Tag label="RUNNING" color="#7c6fff" />}
          {sessionId && !running && <Tag label={`Session ${sessionId.slice(-6)}`} color="#8994b0" />}
        </div>
        <p style={{ fontSize: 11, color: "#8994b0", margin: 0 }}>
          Prompt → Plan → Patch → Test → Deploy → Observe → Heal → Learn
        </p>
      </div>

      {/* Stage rail */}
      <StageRail stages={stages} active={activeStage} />

      {/* Prompt */}
      <div style={{ marginBottom: 16 }}>
        <textarea
          ref={promptRef}
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); runLoop(); } }}
          placeholder="Describe the engineering task — fix a bug, add a feature, resolve an incident…"
          rows={3}
          style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, color: "#e6edf3", fontSize: 13, fontFamily: "inherit", resize: "vertical", lineHeight: 1.5 }}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
          <Pill variant="primary" onClick={runLoop} disabled={!prompt.trim() || running}>
            {running ? "Running loop…" : "⟳  Run Full Loop  ⌘↵"}
          </Pill>
          <Pill onClick={() => { setStages(INIT_STAGES); setActiveStage(null); setPipelineResult(null); setActivePatch(null); setAutoPipelineResult(null); setHealTimeline([]); setPrompt(""); }}>
            Clear
          </Pill>
          <span style={{ fontSize: 9, color: "#8994b0", marginLeft: "auto" }}>
            Patch → Test → Apply → Heal with minimal human intervention
          </span>
        </div>
      </div>

      {/* 3-column grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>

        {/* ── Col 1: Pipeline + Patch ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

          {/* Pipeline */}
          <Card title="Pipeline" status={stages.plan.status === "running" ? "running" : stages.plan.status === "done" ? "ok" : stages.plan.status === "fail" ? "error" : undefined}>
            {!pipelineResult ? (
              <span style={{ fontSize: 11, color: "#8994b0" }}>No pipeline run yet. Enter a prompt and run the loop.</span>
            ) : (
              <>
                {pipelineStages.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: 8 }}>
                    {pipelineStages.map((s, i) => {
                      const isDone = s.status === "success" || s.status === "done";
                      const isFail = s.status === "failed" || s.status === "error";
                      const isRun  = s.status === "running";
                      const col = isDone ? "#52d68a" : isFail ? "#f55b5b" : isRun ? "#7c6fff" : "#8994b0";
                      return (
                        <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <span style={{ fontSize: 11, color: col, width: 12, textAlign: "center" }}>
                            {isDone ? "✓" : isFail ? "✗" : isRun ? "⊙" : "○"}
                          </span>
                          <span style={{ fontSize: 10, color: "#c8cdd8", textTransform: "capitalize" }}>{s.stage || s.name}</span>
                          {s.durationMs && <span style={{ fontSize: 8, color: "#8994b0", marginLeft: "auto" }}>{s.durationMs}ms</span>}
                        </div>
                      );
                    })}
                  </div>
                )}
                {pipelineResult.error && <div style={{ fontSize: 10, color: "#f55b5b", marginTop: 4 }}>Error: {pipelineResult.error}</div>}
              </>
            )}
          </Card>

          {/* Patch */}
          <Card title={`Patch${stgPatch.filePath ? `: ${stgPatch.filePath.split("/").pop()}` : ""}`}
            status={stgPatch.status === "running" ? "running" : stgPatch.status === "done" ? "ok" : stgPatch.status === "fail" ? "error" : undefined}>
            {!activePatch ? (
              <span style={{ fontSize: 11, color: "#8994b0" }}>{stgPatch.note || "No patch yet"}</span>
            ) : (
              <>
                <div style={{ display: "flex", gap: 6, marginBottom: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <Tag label={activePatch.filePath?.split("/").pop() || "file"} color="#44a2ff" />
                  <Tag label={activePatch.patchId?.slice(0, 8)} color="#8994b0" />
                  {stgPatch.status === "done" && <Tag label="proposed" color="#f0b429" />}
                  <Pill variant="primary" onClick={() => handleManualAutoPipeline(activePatch.patchId)} disabled={running}>
                    Auto-Test+Apply
                  </Pill>
                </div>
                <DiffView diff={activePatch.diff} />
              </>
            )}
            {/* Pending patches list */}
            {patchList.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 9, color: "#8994b0", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>All patches</div>
                {patchList.slice(0, 5).map(p => (
                  <div key={p.id} style={{ display: "flex", gap: 6, alignItems: "center", padding: "3px 0", borderBottom: "1px solid rgba(255,255,255,0.04)", cursor: "pointer" }}
                    onClick={() => setActivePatch({ patchId: p.id, diff: p.diff, filePath: p.filePath })}>
                    <StatusDot s={p.status === "applied" ? "ok" : p.status === "rolled_back" ? "error" : "pending"} />
                    <span style={{ fontSize: 10, color: "#c8cdd8", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.filePath?.split("/").pop() || p.id?.slice(0, 12)}</span>
                    <Tag label={p.status} color={sc(p.status)} />
                    {p.status === "pending" && (
                      <button onClick={e => { e.stopPropagation(); handleManualAutoPipeline(p.id); }} disabled={running}
                        style={{ fontSize: 8, padding: "1px 6px", background: "rgba(68,162,255,0.1)", border: "1px solid rgba(68,162,255,0.2)", borderRadius: 3, cursor: "pointer", color: "#44a2ff" }}>
                        Run
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* ── Col 2: Test + Apply + Deploy ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

          {/* Test + Apply */}
          <Card title="Test → Apply Pipeline"
            status={stgTest.status === "running" ? "running" : stgApply.status === "done" ? "ok" : stgApply.status === "rolled_back" ? "error" : undefined}>
            {!autoPipelineResult ? (
              <span style={{ fontSize: 11, color: "#8994b0" }}>
                Auto-pipeline runs after a patch is proposed. No manual steps required.
              </span>
            ) : (
              <>
                <Timeline steps={autoPipelineResult.timeline || []} />
                {autoPipelineResult.passed !== undefined && (
                  <div style={{ marginTop: 8, padding: "6px 8px", background: autoPipelineResult.passed ? "rgba(82,214,138,0.08)" : "rgba(245,91,91,0.08)", borderRadius: 4, border: `1px solid ${autoPipelineResult.passed ? "rgba(82,214,138,0.2)" : "rgba(245,91,91,0.2)"}` }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: autoPipelineResult.passed ? "#52d68a" : "#f55b5b" }}>
                      {autoPipelineResult.passed ? "✓ Passed & Applied" : "✗ Failed" + (autoPipelineResult.rolledBack ? " — Auto-rolled back" : "")}
                    </span>
                  </div>
                )}
                <TapOutput output={(autoPipelineResult.timeline || []).find(s => s.step === "verify")?.output} pass={autoPipelineResult.pass} fail={autoPipelineResult.fail} />
              </>
            )}
          </Card>

          {/* Deploy */}
          <Card title="Deploy" status={stages.deploy.status === "running" ? "running" : stages.deploy.status === "done" ? "ok" : undefined}>
            {stages.deploy.status === "idle" ? (
              <span style={{ fontSize: 11, color: "#8994b0" }}>Deploy runs automatically after successful apply.</span>
            ) : stages.deploy.status === "running" ? (
              <span style={{ fontSize: 11, color: "#7c6fff", animation: "ws-pulse 1s ease-in-out infinite" }}>Deploying…</span>
            ) : stages.deploy.status === "done" ? (
              <span style={{ fontSize: 11, color: "#52d68a" }}>✓ {stages.deploy.note || "Deployed"}</span>
            ) : stages.deploy.status === "skipped" ? (
              <span style={{ fontSize: 11, color: "#8994b0" }}>Skipped — {stages.deploy.note || "no deploy stage"}</span>
            ) : (
              <span style={{ fontSize: 11, color: "#f55b5b" }}>Deploy failed: {stages.deploy.error}</span>
            )}
          </Card>

          {/* Learn */}
          <Card title="Pattern Learning" status={stgLearn.status === "running" ? "running" : stgLearn.status === "done" ? "ok" : undefined}
            onRefresh={refreshLearn}>
            {!learnSummary ? (
              <span style={{ fontSize: 11, color: "#8994b0" }}>Learning stats load after first run.</span>
            ) : (
              <>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "#c8cdd8" }}>{learnSummary.total}</div>
                    <div style={{ fontSize: 8, color: "#8994b0" }}>total</div>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "#52d68a" }}>{learnSummary.applied}</div>
                    <div style={{ fontSize: 8, color: "#8994b0" }}>applied</div>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: learnSummary.rolled_back > 0 ? "#f55b5b" : "#8994b0" }}>{learnSummary.rolled_back}</div>
                    <div style={{ fontSize: 8, color: "#8994b0" }}>rolled back</div>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "#f0b429" }}>{learnSummary.pending}</div>
                    <div style={{ fontSize: 8, color: "#8994b0" }}>pending</div>
                  </div>
                </div>
                {learnSummary.hotspots?.length > 0 && (
                  <>
                    <div style={{ fontSize: 9, color: "#8994b0", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Rollback hotspots</div>
                    {learnSummary.hotspots.map((h, i) => (
                      <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", padding: "2px 0" }}>
                        <span style={{ fontSize: 9, color: h.rolled_back > 0 ? "#f55b5b" : "#8994b0", width: 14 }}>{h.rolled_back > 0 ? "⚠" : "·"}</span>
                        <span style={{ fontSize: 9, color: "#c8cdd8", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.file.split("/").slice(-2).join("/")}</span>
                        <span style={{ fontSize: 8, color: "#f55b5b" }}>{h.rolled_back}↩</span>
                      </div>
                    ))}
                  </>
                )}
                {learnSummary.memoryStats && (
                  <div style={{ fontSize: 9, color: "#8994b0", marginTop: 6 }}>
                    Memory: {learnSummary.memoryStats.total ?? "—"} entries · {learnSummary.memoryStats.uniqueAgents ?? "—"} agents
                  </div>
                )}
              </>
            )}
          </Card>
        </div>

        {/* ── Col 3: Observe + Heal + History ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

          {/* Observability */}
          <Card title="Observability" onRefresh={refreshObs}
            status={stgObs.status === "running" ? "running" : stgObs.status === "done" ? "ok" : undefined}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
              {[
                { label: "Runtime",    val: runtimeStatus?.ok || runtimeStatus?.healthy ? "OK" : runtimeStatus ? "Degraded" : "—", color: runtimeStatus?.ok || runtimeStatus?.healthy ? "#52d68a" : "#f0b429" },
                { label: "Queue",      val: runtimeStatus?.queue?.depth ?? runtimeStatus?.queueDepth ?? "—" },
                { label: "DLQ",        val: dlqCount, color: dlqCount > 0 ? "#f55b5b" : "#52d68a" },
                { label: "Incidents",  val: openIncCount, color: openIncCount > 0 ? "#f0b429" : "#52d68a" },
              ].map(s => (
                <div key={s.label} style={{ flex: "1 1 40px", textAlign: "center" }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: s.color || "#c8cdd8" }}>{s.val}</div>
                  <div style={{ fontSize: 8, color: "#8994b0" }}>{s.label}</div>
                </div>
              ))}
            </div>
            {/* Recent history */}
            {history.slice(0, 5).map((e, i) => (
              <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", padding: "2px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                <StatusDot s={e.success !== false ? "ok" : "error"} />
                <span style={{ fontSize: 9, color: "#c8cdd8", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {e.input || e.description || "(unknown)"}
                </span>
                <span style={{ fontSize: 8, color: "#8994b0" }}>{e.agentId?.slice(0, 6) || "—"}</span>
              </div>
            ))}
          </Card>

          {/* Heal */}
          <Card title={`Self-Healing${openIncCount > 0 ? ` (${openIncCount} open)` : ""}`}
            status={stgHeal.status === "running" ? "running" : stgHeal.status === "done" ? "ok" : stgHeal.status === "fail" ? "error" : undefined}>
            {healTimeline.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 9, color: "#8994b0", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Last heal run</div>
                <Timeline steps={healTimeline} />
              </div>
            )}
            {incidents.slice(0, 5).map(inc => {
              const isOpen = inc.status === "open" || inc.status === "detected";
              const col = inc.severity === "critical" ? "#f55b5b" : inc.severity === "high" ? "#f0b429" : "#8994b0";
              return (
                <div key={inc.id} style={{ display: "flex", gap: 6, alignItems: "center", padding: "4px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                  <Tag label={inc.severity || "??"} color={col} />
                  <span style={{ fontSize: 10, color: "#c8cdd8", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {inc.title || inc.message || inc.type || inc.id}
                  </span>
                  {isOpen && (
                    <button onClick={() => handleIncidentFix(inc.id)} disabled={running}
                      style={{ fontSize: 8, padding: "2px 7px", background: "rgba(245,91,91,0.1)", border: "1px solid rgba(245,91,91,0.25)", borderRadius: 3, cursor: "pointer", color: "#f55b5b", flexShrink: 0 }}>
                      Auto-Fix
                    </button>
                  )}
                  {!isOpen && <Tag label={inc.status} color="#8994b0" />}
                </div>
              );
            })}
            {incidents.length === 0 && (
              <div style={{ fontSize: 11, color: "#8994b0", display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ color: "#52d68a" }}>✓</span> No open incidents
              </div>
            )}
          </Card>

          {/* DLQ mini */}
          {dlqCount > 0 && (
            <Card title={`Dead Letter Queue (${dlqCount})`} status="error">
              {(dlq?.entries || []).slice(0, 3).map((e, i) => (
                <div key={i} style={{ display: "flex", gap: 6, padding: "2px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <StatusDot s="error" />
                  <span style={{ fontSize: 9, color: "#c8cdd8", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {(e.task?.input || e.input || e.taskId || "failed task").slice(0, 50)}
                  </span>
                  <span style={{ fontSize: 8, color: "#f55b5b" }}>{e.attempts || 0}×</span>
                </div>
              ))}
              <div style={{ marginTop: 6 }}>
                <Pill variant="warn" onClick={async () => {
                  await _post("/runtime/recover/dlq");
                  await refreshObs();
                }}>Requeue all</Pill>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
