import React, {
  useState, useEffect, useCallback, memo,
} from "react";
import {
  searchP26Memory, calcRisk, calcConfidence,
  getMemoryFailures, getMemoryDecisions, getMemorySuccesses,
  getRollbackPlan,
} from "./operatorApi";
import "./IntelligenceOverlay.css";

// ── Helpers ────────────────────────────────────────────────────────────
const RiskBar = memo(({ score }) => {
  const pct = Math.min(100, Math.round((score || 0) * 100));
  const cls = pct >= 70 ? "high" : pct >= 40 ? "med" : "low";
  return (
    <div className="io-risk-wrap">
      <div className="io-risk-bar">
        <div className={`io-risk-fill io-risk-fill--${cls}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`io-risk-val io-risk-val--${cls}`}>{pct}% risk</span>
    </div>
  );
});

const ConfBar = memo(({ score }) => {
  const pct = Math.min(100, Math.round((score || 0) * 100));
  return (
    <div className="io-conf-wrap">
      <div className="io-conf-bar">
        <div className="io-conf-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="io-conf-val">{pct}% conf</span>
    </div>
  );
});

const MemoryHit = memo(({ m }) => (
  <div className="io-mem">
    <div className="io-mem-head">
      <span className="io-mem-type">{m.type || m.kind || "memory"}</span>
      {m.confidence && <ConfBar score={m.confidence} />}
    </div>
    <div className="io-mem-content">
      {(m.content || m.summary || m.text || JSON.stringify(m)).slice(0, 200)}
    </div>
    {m.createdAt && (
      <div className="io-mem-time">
        {new Date(m.createdAt).toLocaleDateString()}
      </div>
    )}
  </div>
));

const SectionHead = memo(({ label, count }) => (
  <div className="io-sec-head">
    <span className="io-sec-label">{label}</span>
    {count != null && <span className="io-sec-count">{count}</span>}
  </div>
));

// ══════════════════════════════════════════════════════════════════════
// Main IntelligenceOverlay
// Props: filePath (string, optional) — currently open file
// ══════════════════════════════════════════════════════════════════════
export default function IntelligenceOverlay({ filePath }) {
  const [query,     setQuery]     = useState(filePath || "");
  const [searching, setSearching] = useState(false);

  const [memories,  setMemories]  = useState([]);
  const [failures,  setFailures]  = useState([]);
  const [decisions, setDecisions] = useState([]);
  const [successes, setSuccesses] = useState([]);
  const [riskData,  setRiskData]  = useState(null);
  const [confData,  setConfData]  = useState(null);
  const [rollback,  setRollback]  = useState(null);

  const [loaded,    setLoaded]    = useState(false);
  const [error,     setError]     = useState(null);

  // When filePath changes, update query and auto-search
  useEffect(() => {
    if (filePath) {
      setQuery(filePath);
      runSearch(filePath);
    }
  }, [filePath]); // eslint-disable-line

  const runSearch = useCallback(async (q) => {
    const term = (q || query).trim();
    if (!term) return;
    setSearching(true);
    setError(null);
    try {
      const [mem, fail, dec, succ, risk, conf, rb] = await Promise.allSettled([
        searchP26Memory(term, "all"),
        getMemoryFailures(),
        getMemoryDecisions(),
        getMemorySuccesses(),
        calcRisk({ context: term, file: term }),
        calcConfidence({ context: term, file: term }),
        getRollbackPlan({ context: term, file: term }),
      ]);

      if (mem.status  === "fulfilled") setMemories(mem.value?.results || mem.value || []);
      if (fail.status === "fulfilled") setFailures(
        (fail.value?.failures || fail.value || [])
          .filter(f => {
            const s = (f.file || f.context || f.message || "").toLowerCase();
            return s.includes(term.toLowerCase().split("/").pop() || term.toLowerCase());
          })
          .slice(0, 5)
      );
      if (dec.status  === "fulfilled") setDecisions(
        (dec.value?.decisions || dec.value || []).slice(0, 5)
      );
      if (succ.status === "fulfilled") setSuccesses(
        (succ.value?.successes || succ.value || []).slice(0, 5)
      );
      if (risk.status === "fulfilled") setRiskData(risk.value);
      if (conf.status === "fulfilled") setConfData(conf.value);
      if (rb.status   === "fulfilled") setRollback(rb.value);

      setLoaded(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setSearching(false);
    }
  }, [query]);

  function handleSearch(e) {
    e.preventDefault();
    runSearch(query);
  }

  const riskScore = riskData?.risk  ?? riskData?.score ?? null;
  const confScore = confData?.confidence ?? confData?.score ?? null;
  const action    = riskData?.recommendedAction || confData?.recommendedAction || null;

  return (
    <div className="io-root">
      <header className="io-header">
        <div className="io-title">Engineering Intelligence</div>
        <div className="io-subtitle">Memory · Risk · Decisions · Failures</div>
      </header>

      {/* Search */}
      <form className="io-search-form" onSubmit={handleSearch}>
        <input
          className="io-search-input"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search by file path, component, or topic…"
        />
        <button type="submit" className="io-search-btn" disabled={searching}>
          {searching ? "…" : "⌕"}
        </button>
      </form>

      {error && <div className="io-error">{error}</div>}

      {!loaded && !searching && (
        <div className="io-prompt">Enter a file path or topic to load engineering intelligence.</div>
      )}

      {searching && (
        <div className="io-loading">
          <div className="io-loading-bar" />
          Searching intelligence layer…
        </div>
      )}

      {loaded && (
        <div className="io-body">

          {/* Risk + Confidence at top */}
          {(riskScore != null || confScore != null) && (
            <div className="io-scores">
              {riskScore != null && (
                <div className="io-score-card">
                  <div className="io-score-label">Predicted Risk</div>
                  <RiskBar score={riskScore} />
                  {riskData?.reason && (
                    <div className="io-score-reason">{riskData.reason.slice(0, 120)}</div>
                  )}
                </div>
              )}
              {confScore != null && (
                <div className="io-score-card">
                  <div className="io-score-label">Confidence</div>
                  <ConfBar score={confScore} />
                  {confData?.reason && (
                    <div className="io-score-reason">{confData.reason.slice(0, 120)}</div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Recommended action */}
          {action && (
            <div className="io-action">
              <span className="io-action-label">Recommended Action</span>
              <span className="io-action-text">{action}</span>
            </div>
          )}

          {/* Rollback plan */}
          {rollback?.plan && (
            <div className="io-rollback">
              <SectionHead label="Rollback Plan" />
              <div className="io-rollback-text">{rollback.plan.slice(0, 400)}</div>
              {rollback.steps?.length > 0 && (
                <ol className="io-rollback-steps">
                  {rollback.steps.slice(0, 5).map((s, i) => (
                    <li key={i}>{(s.step || s.action || String(s)).slice(0, 100)}</li>
                  ))}
                </ol>
              )}
            </div>
          )}

          {/* Relevant memories */}
          {memories.length > 0 && (
            <div className="io-section">
              <SectionHead label="Related Memories" count={memories.length} />
              <div className="io-mem-list">
                {memories.slice(0, 6).map((m, i) => <MemoryHit key={i} m={m} />)}
              </div>
            </div>
          )}

          {/* Previous failures */}
          {failures.length > 0 && (
            <div className="io-section">
              <SectionHead label="Previous Failures" count={failures.length} />
              <div className="io-fail-list">
                {failures.map((f, i) => (
                  <div key={i} className="io-fail">
                    <div className="io-fail-msg">{(f.error || f.message || "—").slice(0, 120)}</div>
                    {f.fix && <div className="io-fail-fix">Fix: {f.fix.slice(0, 100)}</div>}
                    {f.failedAt && (
                      <div className="io-fail-time">{new Date(f.failedAt).toLocaleDateString()}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Architecture decisions */}
          {decisions.length > 0 && (
            <div className="io-section">
              <SectionHead label="Architecture Decisions" count={decisions.length} />
              <div className="io-dec-list">
                {decisions.map((d, i) => (
                  <div key={i} className="io-dec">
                    <div className="io-dec-title">{(d.decision || d.title || d.type || "Decision").slice(0, 80)}</div>
                    {(d.rationale || d.reason) && (
                      <div className="io-dec-rationale">{(d.rationale || d.reason).slice(0, 120)}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Successes */}
          {successes.length > 0 && (
            <div className="io-section">
              <SectionHead label="Similar Fixes" count={successes.length} />
              <div className="io-succ-list">
                {successes.slice(0, 4).map((s, i) => (
                  <div key={i} className="io-succ">
                    <span className="io-succ-icon">✓</span>
                    <span className="io-succ-text">{(s.summary || s.action || s.description || "—").slice(0, 100)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {memories.length === 0 && failures.length === 0 && decisions.length === 0 && (
            <div className="io-no-results">No intelligence data found for this context.</div>
          )}

        </div>
      )}
    </div>
  );
}
