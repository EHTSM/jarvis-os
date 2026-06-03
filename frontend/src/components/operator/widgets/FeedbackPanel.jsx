import React, { useState, useCallback } from "react";
import { getRecentTelemetry } from "../../../hooks/useBetaTelemetry";
import { getProductivitySummary, getFrictionSummary, detectConfusionPatterns, generateIncidentSummary } from "../../../hooks/useProductivityAnalytics"; // Phase 169 + 176 + 249

// Phase 193: categorize crash/error messages into human-readable groups
function _categorizeCrash(message = "") {
  const m = message.toLowerCase();
  if (m.includes("eaddrinuse") || m.includes("address in use"))
    return { group: "Port conflict", explanation: "Another process is already using Jarvis's port. Restart with: pm2 restart jarvis-backend", severity: "high" };
  if (m.includes("cannot find module") || m.includes("module not found"))
    return { group: "Missing dependency", explanation: "A required package is missing. Run: npm install", severity: "high" };
  if (m.includes("heap out of memory") || m.includes("javascript heap"))
    return { group: "Memory exhaustion", explanation: "Jarvis ran out of memory. Restart the app or increase Node.js heap: NODE_OPTIONS=--max-old-space-size=4096", severity: "high" };
  if (m.includes("econnrefused") || m.includes("econnreset"))
    return { group: "Connection refused", explanation: "The backend isn't accepting connections. Check it's running: pm2 list", severity: "medium" };
  if (m.includes("etimedout") || m.includes("timeout"))
    return { group: "Timeout", explanation: "A request took too long. The backend may be overloaded — check pm2 logs.", severity: "medium" };
  if (m.includes("permission denied") || m.includes("eacces"))
    return { group: "Permission error", explanation: "Jarvis doesn't have permission to access a file or port. Check file ownership.", severity: "medium" };
  if (m.includes("sqlite") || m.includes("database"))
    return { group: "Database error", explanation: "The local database encountered an issue. A backup may be needed.", severity: "high" };
  if (m.includes("syntaxerror") || m.includes("unexpected token"))
    return { group: "Config parse error", explanation: "A configuration or data file has invalid JSON. Check recent imports.", severity: "medium" };
  return { group: "Unknown error", explanation: "An unexpected error occurred. Include the full error message in your report.", severity: "low" };
}

// Phase 194: sanitize log output — remove potential secrets before including in bundle
function _sanitizeForBundle(obj) {
  if (typeof obj !== "object" || obj === null) return obj;
  const REDACT_KEYS = /token|secret|password|key|auth|credential|api_key/i;
  const result = Array.isArray(obj) ? [] : {};
  for (const [k, v] of Object.entries(obj)) {
    if (REDACT_KEYS.test(k)) { result[k] = "[REDACTED]"; }
    else if (typeof v === "object") { result[k] = _sanitizeForBundle(v); }
    else { result[k] = v; }
  }
  return result;
}

// Phase 200/201: stable support session ID — persists until localStorage is cleared
function _getOrCreateSessionId() {
  const KEY = "jarvis_support_session_id";
  try {
    const existing = localStorage.getItem(KEY);
    if (existing) return existing;
    const id = "jrv-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
    localStorage.setItem(KEY, id);
    return id;
  } catch { return "unknown"; }
}

// Phase 169: build client-side diagnostics bundle (no backend required)
function _buildLocalBundle(connectionState, runtimeDegraded) {
  const jarvisKeys = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith("jarvis_")) {
        try { jarvisKeys[k] = _sanitizeForBundle(JSON.parse(localStorage.getItem(k))); } // Phase 194: sanitize
        catch { jarvisKeys[k] = "<non-JSON>"; }
      }
    }
  } catch {}
  return {
    generatedAt:      new Date().toISOString(),
    supportSessionId: _getOrCreateSessionId(), // Phase 200: stable ID for support correlation
    userAgent:        navigator.userAgent,
    connectionState,
    runtimeDegraded,
    productivity:     getProductivitySummary(),
    friction:         getFrictionSummary(),
    telemetry:        getRecentTelemetry(20),
    localStorage:     jarvisKeys,
    // Phase 193: include crash category summary from friction log
    crashSummary: (() => {
      try {
        const log = JSON.parse(localStorage.getItem("jarvis_friction_signals") || "[]");
        return log
          .filter(e => e.type === "crash" || e.type === "startup_corruption")
          .slice(0, 10)
          .map(e => ({ ..._categorizeCrash(e.message || ""), ts: e.ts, raw: e.message }));
      } catch { return []; }
    })(),
  };
}

// Phase 234: predictive recovery suggestions — reads friction log, returns ranked actions
function _getRecoverySuggestions(connectionState, runtimeDegraded) {
  try {
    const log = JSON.parse(localStorage.getItem("jarvis_friction_signals") || "[]");
    const suggestions = [];
    const recent = log.filter(e => Date.now() - e.ts < 30 * 60 * 1000);

    const reconnectCount = recent.filter(e => e.type === "reconnect_event" || e.type === "reconnect_during_input").length;
    const hesitationCount = recent.filter(e => e.type === "hesitation" || e.type === "abandonment").length;
    const crashCount = log.filter(e => e.type === "crash" || e.type === "startup_corruption").length;
    const recoveryPainCount = recent.filter(e => e.type === "reconnect_confusion").length;

    if (connectionState === "offline" || connectionState === "reconnecting") {
      suggestions.push({ priority: 1, action: "Force-refresh the stream", cmd: "forceRefresh", detail: "Tap 'Force Refresh' in the toolbar or press ⌘K → Force Refresh." });
    }
    if (reconnectCount >= 2) {
      suggestions.push({ priority: 2, action: "Check backend process health", detail: "Run: pm2 list — look for jarvis-backend showing 'online'." });
    }
    if (runtimeDegraded) {
      suggestions.push({ priority: 2, action: "Reduce memory pressure", detail: "Close unused browser tabs or panels. Restart the app if memory stays elevated." });
    }
    if (crashCount >= 1) {
      suggestions.push({ priority: 1, action: "Check backend logs for errors", detail: "Run: pm2 logs jarvis-backend --lines 50 — look for FATAL or Error lines." });
    }
    if (hesitationCount >= 3) {
      suggestions.push({ priority: 3, action: "Try the command palette", detail: "Press ⌘K to search macros by name — faster than typing commands manually." });
    }
    if (recoveryPainCount >= 2) {
      suggestions.push({ priority: 2, action: "Enable offline-resilient macros", detail: "Queue macro dispatches — they will auto-retry when the stream reconnects." });
    }

    return suggestions.sort((a, b) => a.priority - b.priority);
  } catch { return []; }
}

// Phase 224: auto-summarize diagnostics bundle into 3-line human-readable support summary
function _buildDiagSummary(connectionState, runtimeDegraded) {
  try {
    const prod     = getProductivitySummary();
    const friction = getFrictionSummary();
    const sessionId = (() => { try { return localStorage.getItem("jarvis_support_session_id") || "unknown"; } catch { return "unknown"; } })();

    const line1 = `Session ${sessionId} | Connection: ${connectionState} | Runtime: ${runtimeDegraded ? "degraded" : "healthy"}`;
    const line2 = prod
      ? `Dispatches: ${prod.totalDispatches} | Success rate: ${prod.avgSuccess}% | Avg latency: ${prod.avgLatencyMs}ms | Deploy confidence: ${prod.deploymentConfidence ?? "n/a"}%`
      : "No dispatch analytics available";
    const line3 = friction
      ? `Friction clusters — confusion: ${friction.clusters?.confusion_points || 0}, recovery pain: ${friction.clusters?.recovery_pain || 0}, onboarding failures: ${friction.clusters?.onboarding_failures || 0}`
      : "No friction data";

    return [line1, line2, line3].join("\n");
  } catch { return "Diagnostics summary unavailable"; }
}

// Phase 113 + 169: export diagnostics — tries backend first, falls back to local bundle
async function _exportDiagnostics(connectionState, runtimeDegraded) {
  try {
    const r = await fetch("/api/runtime/diagnostics/bundle", { credentials: "include" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const serverData = await r.json();
    const bundle = { ...serverData, clientBundle: _buildLocalBundle(connectionState, runtimeDegraded) };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = `jarvis_diagnostics_${Date.now()}.json`; a.click();
    URL.revokeObjectURL(url);
    return "full";
  } catch {
    // Phase 169: backend unreachable — export local-only bundle
    try {
      const bundle = _buildLocalBundle(connectionState, runtimeDegraded);
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href = url; a.download = `jarvis_client_diagnostics_${Date.now()}.json`; a.click();
      URL.revokeObjectURL(url);
      return "local";
    } catch { return false; }
  }
}

const FB_LOG_KEY  = "jarvis_feedback_log";
const MAX_FB_LOG  = 50;

function _saveFeedback(entry) {
  try {
    const raw = localStorage.getItem(FB_LOG_KEY);
    const log = raw ? JSON.parse(raw) : [];
    log.unshift(entry);
    if (log.length > MAX_FB_LOG) log.length = MAX_FB_LOG;
    localStorage.setItem(FB_LOG_KEY, JSON.stringify(log));
  } catch {}
}

const CATEGORIES = ["Bug", "Crash", "Performance", "UX / Confusion", "Feature Request", "Recovery issue"];

// Phase 181: recovery wizard steps — plain language, operator-safe
const RECOVERY_STEPS = [
  {
    step: 1,
    title: "Is the backend running?",
    body: "Open a terminal and run:",
    code: "pm2 list",
    hint: "Look for 'jarvis-backend' with status 'online'. If it shows 'stopped' or 'errored', continue to step 2.",
    cta: "Backend is running →",
    ctaSkip: "It's stopped / errored →",
  },
  {
    step: 2,
    title: "Check the logs for errors",
    body: "Run this to see what went wrong:",
    code: "pm2 logs jarvis-backend --lines 30",
    hint: "Look for red error lines. Note any 'EADDRINUSE', 'Cannot find module', or 'Out of memory' messages.",
    cta: "I see the error →",
    ctaSkip: "Logs look fine →",
  },
  {
    step: 3,
    title: "Restart the backend",
    body: "Try a clean restart:",
    code: "pm2 restart jarvis-backend",
    hint: "After restarting, wait 5-10 seconds then refresh the Jarvis app. The yellow reconnecting banner should clear.",
    cta: "It's working now ✓",
    ctaSkip: "Still broken →",
  },
  {
    step: 4,
    title: "Export diagnostics and report",
    body: "Click 📦 Diagnostics above to download your bundle, then describe the issue below.",
    code: null,
    hint: "The bundle includes connection history, retry counts, and session analytics. No personal data.",
    cta: "Got it",
    ctaSkip: null,
  },
];

export const FeedbackPanel = React.memo(({ onClose, connectionState, runtimeDegraded }) => {
  const [category, setCategory]       = useState("Bug");
  const [message, setMessage]         = useState("");
  const [submitted, setSubmitted]     = useState(false);
  const [exporting, setExporting]     = useState(false);
  const [exportDone, setExportDone]   = useState(null);
  const [diagSummary, setDiagSummary] = useState(null); // Phase 224: auto-summary
  // Phase 181: recovery wizard state
  const [wizardStep, setWizardStep]   = useState(0);

  const submit = useCallback(() => {
    if (!message.trim()) return;
    const entry = {
      ts:              new Date().toISOString(),
      category,
      message:         message.trim().slice(0, 1000),
      connectionState,
      runtimeDegraded,
      recentTelemetry: getRecentTelemetry(10),
    };
    _saveFeedback(entry);
    // POST to backend — best-effort, no block on failure
    fetch("/api/runtime/feedback", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body:    JSON.stringify(entry),
    }).catch(() => {});
    setSubmitted(true);
  }, [category, message, connectionState, runtimeDegraded]);

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(6,8,10,0.88)", zIndex: 8500,
      display: "flex", alignItems: "center", justifyContent: "center"
    }} onClick={onClose}>
      <div
        style={{
          width: "min(400px, 94vw)", background: "var(--op-surface)",
          border: "1px solid var(--op-border2)", borderRadius: 7,
          padding: "20px 22px", fontFamily: "var(--op-mono)",
          display: "flex", flexDirection: "column", gap: 12
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 12, fontWeight: "bold", color: "var(--op-text)" }}>Send Feedback</span>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {/* Export diagnostics bundle */}
            <button
              onClick={async () => {
                setExporting(true);
                const summary = _buildDiagSummary(connectionState, runtimeDegraded); // Phase 224
                setDiagSummary(summary);
                const result = await _exportDiagnostics(connectionState, runtimeDegraded);
                setExporting(false);
                setExportDone(result ? "ok" : "fail");
                setTimeout(() => setExportDone(null), 4000);
              }}
              disabled={exporting}
              title="Download diagnostics bundle (includes analytics, friction signals, telemetry). Works offline."
              style={{
                fontSize: 9, padding: "2px 7px", background: "none",
                border: "1px solid var(--op-border2)", borderRadius: 3,
                cursor: "pointer",
                color: exportDone === "ok" ? "var(--op-green)" : exportDone === "fail" ? "var(--op-red)" : "var(--op-text2)",
                fontFamily: "inherit"
              }}
            >
              {exporting ? "…" : exportDone === "ok" ? "✓ saved" : exportDone === "fail" ? "✗ failed" : "📦 Diagnostics"}
            </button>
            <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--op-text2)", fontSize: 14 }}>×</button>
          </div>
        </div>

        {/* predictive recovery suggestions — shown when stream is unhealthy */}
        {(connectionState !== "connected" || runtimeDegraded) && (() => {
          const suggestions = _getRecoverySuggestions(connectionState, runtimeDegraded);
          if (!suggestions.length) return null;
          return (
            <div style={{ padding: "6px 8px", background: "rgba(255,193,7,0.06)", border: "1px solid rgba(255,193,7,0.2)", borderRadius: 4 }}>
              <div style={{ fontSize: 8, fontWeight: "bold", color: "var(--op-amber)", marginBottom: 4 }}>Suggested next steps</div>
              {suggestions.slice(0, 3).map((s, i) => (
                <div key={i} style={{ fontSize: 9, color: "var(--op-text2)", padding: "3px 0", borderTop: i > 0 ? "1px solid var(--op-border)" : "none" }}>
                  <span style={{ color: "var(--op-text)", fontWeight: "bold" }}>{s.action}</span>
                  {" — "}{s.detail}
                </div>
              ))}
            </div>
          );
        })()}

        {/* diagnostics auto-summary + AI incident summary — shown after export */}
        {diagSummary && exportDone === "ok" && (
          <div style={{ padding: "5px 8px", background: "rgba(0,255,163,0.05)", border: "1px solid rgba(0,255,163,0.15)", borderRadius: 4 }}>
            <div style={{ fontSize: 8, fontWeight: "bold", color: "var(--op-green)", marginBottom: 3 }}>Diagnostics Summary (for your support ticket)</div>
            <pre style={{ fontSize: 8, color: "var(--op-text2)", margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{diagSummary}</pre>
            {(() => {
              const incident = generateIncidentSummary({ connectionState, runtimeDegraded });
              if (!incident?.lines?.length) return null;
              return (
                <div style={{ marginTop: 6, paddingTop: 5, borderTop: "1px solid rgba(0,255,163,0.1)" }}>
                  <div style={{ fontSize: 8, fontWeight: "bold", color: "var(--op-accent)", marginBottom: 2 }}>AI Incident Analysis</div>
                  <pre style={{ fontSize: 8, color: "var(--op-text2)", margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{incident.text}</pre>
                </div>
              );
            })()}
          </div>
        )}

        {submitted ? (
          <div style={{ textAlign: "center", padding: "20px 0", color: "var(--op-green)" }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>✓</div>
            <div style={{ fontSize: 11 }}>Feedback saved. Thank you!</div>
            <div style={{ fontSize: 9, color: "var(--op-text2)", marginTop: 4 }}>Stored locally and sent to backend if available.</div>
            <button onClick={onClose} style={{
              marginTop: 14, padding: "6px 18px", background: "var(--op-accent)",
              color: "#06080a", border: "none", borderRadius: 4, cursor: "pointer",
              fontSize: 10, fontFamily: "inherit", fontWeight: "bold"
            }}>Close</button>
          </div>
        ) : (
          <>
            <div>
              <div style={{ fontSize: 9, color: "var(--op-text2)", marginBottom: 4 }}>Category</div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {CATEGORIES.map(c => (
                  <button
                    key={c}
                    onClick={() => setCategory(c)}
                    style={{
                      padding: "3px 8px", fontSize: 9, borderRadius: 3, cursor: "pointer",
                      fontFamily: "inherit",
                      background: category === c ? "var(--op-accent)" : "var(--op-surface2)",
                      color: category === c ? "#06080a" : "var(--op-text2)",
                      border: `1px solid ${category === c ? "var(--op-accent)" : "var(--op-border2)"}`,
                      fontWeight: category === c ? "bold" : "normal"
                    }}
                  >{c}</button>
                ))}
              </div>
            </div>

            {/* show confusion pattern summary for UX feedback */}
            {category === "UX / Confusion" && (() => {
              const patterns = detectConfusionPatterns();
              if (!patterns.length) return null;
              return (
                <div className="op-diag-card" style={{ borderColor: "rgba(0,210,255,0.2)" }}>
                  <div className="diag-title" style={{ color: "var(--op-accent)" }}>Detected Friction Patterns</div>
                  <div className="diag-body">
                    {patterns.map((p, i) => (
                      <div key={i} style={{ padding: "2px 0", borderTop: i > 0 ? "1px solid var(--op-border)" : "none" }}>
                        <span style={{ color: p.severity === "high" ? "var(--op-red)" : p.severity === "medium" ? "var(--op-amber)" : "var(--op-text2)" }}>
                          {p.pattern.replace(/_/g, " ")}
                        </span>
                        {p.count != null && <span style={{ opacity: 0.6 }}> ×{p.count}</span>}
                      </div>
                    ))}
                    <div style={{ marginTop: 4, opacity: 0.6 }}>These are auto-detected — include them in your description if relevant.</div>
                  </div>
                </div>
              );
            })()}

            {/* crash category + actionable recovery */}
            {category === "Crash" && (() => {
              const crashLog = (() => {
                try {
                  return JSON.parse(localStorage.getItem("jarvis_friction_signals") || "[]")
                    .filter(e => e.type === "crash" || e.type === "startup_corruption").slice(0, 3);
                } catch { return []; }
              })();
              const topCrash = crashLog[0] ? _categorizeCrash(crashLog[0].message || "") : null;
              return (
                <div className="op-diag-card">
                  <div className="diag-title">
                    Recovery Steps{topCrash ? ` — ${topCrash.group}` : ""}
                  </div>
                  <div className="diag-body">
                    {topCrash && (
                      <div style={{ marginBottom: 5, color: "var(--op-text)", fontWeight: "bold", fontSize: 9 }}>
                        {topCrash.explanation}
                      </div>
                    )}
                    <div>1. Click <strong>📦 Diagnostics</strong> above to download your bundle</div>
                    <div>2. Check backend: <code>pm2 logs jarvis-backend --lines 30</code></div>
                    <div>3. Restart if needed: <code>pm2 restart jarvis-backend</code></div>
                    <div style={{ marginTop: 4, opacity: 0.7 }}>Bundle includes session analytics, crash category, and friction signals. No personal data.</div>
                  </div>
                </div>
              );
            })()}
            {/* recovery wizard */}
            {category === "Recovery issue" && (() => {
              const step = RECOVERY_STEPS[Math.min(wizardStep, RECOVERY_STEPS.length - 1)];
              return (
                <div className="op-diag-card" style={{ borderColor: "rgba(255,193,7,0.3)" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                    <div className="diag-title" style={{ color: "var(--op-amber)", margin: 0 }}>
                      Recovery Wizard — Step {step.step}/{RECOVERY_STEPS.length}
                    </div>
                    {wizardStep > 0 && (
                      <button onClick={() => setWizardStep(s => s - 1)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--op-text2)", fontSize: 9 }}>← Back</button>
                    )}
                  </div>
                  <div className="diag-body">
                    <div style={{ fontWeight: "bold", color: "var(--op-text)", marginBottom: 3 }}>{step.title}</div>
                    <div style={{ marginBottom: 4 }}>{step.body}</div>
                    {step.code && (
                      <div style={{ padding: "4px 8px", background: "rgba(0,0,0,0.3)", borderRadius: 3, fontFamily: "monospace", fontSize: 9, color: "var(--op-accent)", marginBottom: 6 }}>
                        {step.code}
                      </div>
                    )}
                    <div style={{ opacity: 0.75, lineHeight: 1.6 }}>{step.hint}</div>
                    <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                      {wizardStep < RECOVERY_STEPS.length - 1 ? (
                        <>
                          <button
                            onClick={() => setWizardStep(s => s + 1)}
                            style={{ flex: 1, fontSize: 8, padding: "3px 0", background: "var(--op-accent)", color: "#06080a", border: "none", borderRadius: 3, cursor: "pointer", fontWeight: "bold" }}
                          >{step.cta}</button>
                          {step.ctaSkip && (
                            <button
                              onClick={() => setWizardStep(s => s + 1)}
                              style={{ flex: 1, fontSize: 8, padding: "3px 0", background: "none", border: "1px solid var(--op-border2)", borderRadius: 3, cursor: "pointer", color: "var(--op-text2)" }}
                            >{step.ctaSkip}</button>
                          )}
                        </>
                      ) : (
                        <button
                          onClick={() => setWizardStep(0)}
                          style={{ fontSize: 8, padding: "3px 10px", background: "none", border: "1px solid var(--op-border2)", borderRadius: 3, cursor: "pointer", color: "var(--op-text2)" }}
                        >Restart wizard</button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}

            <div>
              <div style={{ fontSize: 9, color: "var(--op-text2)", marginBottom: 4 }}>What happened?</div>
              <textarea
                value={message}
                onChange={e => setMessage(e.target.value)}
                rows={4}
                maxLength={1000}
                placeholder="Describe the issue, steps to reproduce, or what you expected…"
                style={{
                  width: "100%", boxSizing: "border-box", padding: "7px 9px",
                  background: "var(--op-surface2)", color: "var(--op-text)",
                  border: "1px solid var(--op-border2)", borderRadius: 4,
                  fontFamily: "inherit", fontSize: 10, resize: "vertical"
                }}
              />
              <div style={{ fontSize: 8, color: "var(--op-text2)", marginTop: 2, textAlign: "right" }}>
                {message.length}/1000 · runtime context auto-attached
              </div>
            </div>

            <button
              onClick={submit}
              disabled={!message.trim()}
              style={{
                padding: "8px 0", fontFamily: "inherit", fontSize: 11, fontWeight: "bold",
                background: message.trim() ? "var(--op-accent)" : "var(--op-border2)",
                color: message.trim() ? "#06080a" : "var(--op-text2)",
                border: "none", borderRadius: 5, cursor: message.trim() ? "pointer" : "default"
              }}
            >
              Submit Feedback
            </button>
          </>
        )}
      </div>
    </div>
  );
});
