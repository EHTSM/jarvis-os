/**
 * ClosedBetaAudit — fresh-eyes developer audit.
 * Reads /coding/beta-audit. Shows blockers, scores, WOW score,
 * commercial readiness, launch score, regression, Build Ooplix score.
 */
import React, { useState, useEffect, useCallback } from "react";
import "./ClosedBetaAudit.css";

const BASE = process.env.REACT_APP_API_URL || "";

const SEV_COLOR = {
  high:   "var(--danger, #f55b5b)",
  medium: "var(--warning, #f0b429)",
  info:   "var(--accent2, #4ecdc4)",
  ok:     "var(--success, #52d68a)",
};

function ScoreRing({ value, label, color }) {
  const c   = Math.min(100, Math.max(0, value));
  const r   = 22;
  const circ= 2 * Math.PI * r;
  const dash= (c / 100) * circ;
  return (
    <div className="cba-ring">
      <svg width="56" height="56" viewBox="0 0 56 56">
        <circle cx="28" cy="28" r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="4" />
        <circle
          cx="28" cy="28" r={r} fill="none"
          stroke={color || "var(--accent)"}
          strokeWidth="4"
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
          transform="rotate(-90 28 28)"
          style={{ transition: "stroke-dasharray 0.6s ease" }}
        />
        <text x="28" y="32" textAnchor="middle" fontSize="13" fontWeight="800" fill={color || "var(--accent)"}>
          {Math.round(c)}
        </text>
      </svg>
      <span className="cba-ring__label">{label}</span>
    </div>
  );
}

function Blocker({ item }) {
  return (
    <div className="cba-blocker" style={{ "--sev": SEV_COLOR[item.severity] }}>
      <span className="cba-blocker__sev">{item.severity}</span>
      <div className="cba-blocker__body">
        <span className="cba-blocker__area">{item.area}</span>
        <span className="cba-blocker__text">{item.text}</span>
      </div>
    </div>
  );
}

function CheckItem({ item }) {
  return (
    <div className={`cba-check${item.ok ? " cba-check--ok" : " cba-check--fail"}`}>
      <span className="cba-check__icon">{item.ok ? "✓" : "✗"}</span>
      <span className="cba-check__label">{item.check}</span>
    </div>
  );
}

const VERDICT_LABELS = {
  ready_for_closed_beta: { label: "Ready for Closed Beta",  color: "var(--success)" },
  close_to_ready:        { label: "Almost Ready",            color: "var(--warning)" },
  needs_work:            { label: "Needs Work",              color: "var(--danger)"  },
};

export default function ClosedBetaAudit() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${BASE}/coding/beta-audit`, { credentials: "include" });
      const d = await r.json();
      setData(d);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => { run(); }, [run]);

  const s        = data?.scores  || {};
  const blockers = data?.blockers || [];
  const verdict  = VERDICT_LABELS[data?.verdict] || VERDICT_LABELS.needs_work;
  const highBlockers = blockers.filter(b => b.severity === "high");

  return (
    <div className="cba-root">
      <div className="cba-header">
        <span className="cba-title">Closed Beta Audit</span>
        <button className="cba-run-btn" onClick={run} disabled={loading}>
          {loading ? "Running…" : "▶ Run audit"}
        </button>
      </div>

      {error && <div className="cba-error">{error}</div>}

      {data && (
        <>
          {/* Verdict */}
          <div className="cba-verdict" style={{ "--verdict-color": verdict.color }}>
            <span className="cba-verdict__label">Verdict</span>
            <span className="cba-verdict__value">{verdict.label}</span>
          </div>

          {/* Score rings */}
          <div className="cba-rings">
            <ScoreRing value={s.commercial}  label="Commercial"  color={s.commercial  >= 80 ? "var(--success)" : "var(--warning)"} />
            <ScoreRing value={s.wow}         label="WOW Score"   color="var(--accent)" />
            <ScoreRing value={s.buildOoplix} label="Build in OS" color="var(--accent2)" />
            <ScoreRing value={s.regression}  label="Regression"  color="var(--success)" />
            <ScoreRing value={s.launch}      label="Launch"      color={s.launch >= 80 ? "var(--success)" : "var(--warning)"} />
          </div>

          {/* Blockers */}
          <div className="cba-section">
            <div className="cba-section-label">
              Blockers
              {highBlockers.length === 0
                ? <span className="cba-all-clear"> — None critical ✓</span>
                : <span className="cba-count-high"> — {highBlockers.length} HIGH</span>}
            </div>
            {blockers.length === 0 ? (
              <div className="cba-empty">No blockers found. Ship it!</div>
            ) : (
              blockers.map((b, i) => <Blocker key={i} item={b} />)
            )}
          </div>

          {/* Onboarding checklist */}
          {data.onboarding?.length > 0 && (
            <div className="cba-section">
              <div className="cba-section-label">First-run experience</div>
              <div className="cba-checks">
                {data.onboarding.map((c, i) => <CheckItem key={i} item={c} />)}
              </div>
            </div>
          )}

          {/* Detailed scores */}
          <div className="cba-section">
            <div className="cba-section-label">Score breakdown</div>
            {Object.entries(s).map(([k, v]) => (
              <div key={k} className="cba-score-row">
                <span className="cba-score-key">{k.replace(/([A-Z])/g, ' $1').toLowerCase()}</span>
                <div className="cba-score-bar-wrap">
                  <div className="cba-score-bar" style={{ width: `${Math.min(100, v)}%`, background: v >= 80 ? "var(--success)" : v >= 50 ? "var(--warning)" : "var(--danger)" }} />
                </div>
                <span className="cba-score-val">{Math.round(v)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {loading && !data && (
        <div className="cba-loading">
          {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: "40px", borderRadius: "var(--radius-sm)" }} />)}
        </div>
      )}
    </div>
  );
}
