import React, { useState, useEffect, useCallback, useRef } from 'react';
import { _fetch } from '../_client';
import './PatchPreviewPanel.css';

async function post(path, body) {
  return _fetch(path, { method: 'POST', body: JSON.stringify(body) });
}
async function get(path) {
  return _fetch(path);
}

// ── Risk badge ─────────────────────────────────────────────────────────
function RiskBadge({ level }) {
  const map = { low: { cls: 'risk--low', label: 'LOW RISK' }, medium: { cls: 'risk--medium', label: 'MEDIUM RISK' }, high: { cls: 'risk--high', label: 'HIGH RISK' } };
  const { cls, label } = map[level] || map.medium;
  return <span className={`ppp-risk-badge ${cls}`}>{label}</span>;
}

// ── Confidence meter ───────────────────────────────────────────────────
function ConfidenceMeter({ value }) {
  const pct  = Math.round((value || 0) * 100);
  const cls  = pct >= 80 ? 'conf--high' : pct >= 50 ? 'conf--medium' : 'conf--low';
  return (
    <div className="ppp-conf">
      <div className="ppp-conf__track">
        <div className={`ppp-conf__fill ${cls}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="ppp-conf__label">{pct}% confidence</span>
    </div>
  );
}

// ── Unified diff viewer ────────────────────────────────────────────────
function DiffViewer({ patchSpecs, unifiedDiff }) {
  const [expanded, setExpanded] = useState({});
  const toggle = (i) => setExpanded(e => ({ ...e, [i]: !e[i] }));

  if (unifiedDiff) {
    const lines = unifiedDiff.split('\n');
    return (
      <div className="ppp-diff">
        {lines.map((line, i) => {
          const cls = line.startsWith('+') && !line.startsWith('+++') ? 'diff-add'
                    : line.startsWith('-') && !line.startsWith('---') ? 'diff-del'
                    : line.startsWith('@@') ? 'diff-meta'
                    : line.startsWith('diff ') || line.startsWith('---') || line.startsWith('+++') ? 'diff-header'
                    : '';
          return <div key={i} className={`ppp-diff__line ${cls}`}>{line || ' '}</div>;
        })}
      </div>
    );
  }

  if (patchSpecs?.length) {
    return (
      <div className="ppp-specs">
        {patchSpecs.map((spec, i) => (
          <div key={i} className={`ppp-spec ${spec.valid === false ? 'ppp-spec--invalid' : ''}`}>
            <div className="ppp-spec__header" onClick={() => toggle(i)}>
              <span className="ppp-spec__arrow">{expanded[i] ? '▾' : '▸'}</span>
              <span className="ppp-spec__file">{spec.targetFile}</span>
              {spec.valid === false && <span className="ppp-spec__error">{spec.error}</span>}
              {spec.valid === true  && <span className="ppp-spec__ok">✓</span>}
              {spec.description && <span className="ppp-spec__desc">{spec.description}</span>}
            </div>
            {expanded[i] && (
              <div className="ppp-spec__body">
                <div className="ppp-diff">
                  {spec.patchTarget?.split('\n').map((line, j) => (
                    <div key={`d${j}`} className="ppp-diff__line diff-del">- {line}</div>
                  ))}
                  {spec.patchReplacement?.split('\n').map((line, j) => (
                    <div key={`a${j}`} className="ppp-diff__line diff-add">+ {line}</div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  return <div className="ppp-empty">No patch data available</div>;
}

// ── Pipeline stage tracker ─────────────────────────────────────────────
function PipelineTracker({ pipelineId }) {
  const [pipeline, setPipeline] = useState(null);
  const intervalRef = useRef(null);

  useEffect(() => {
    if (!pipelineId) return;
    const poll = async () => {
      try {
        const r = await get(`/pipeline/${pipelineId}`);
        if (r?.pipeline) {
          setPipeline(r.pipeline);
          if (['completed', 'failed', 'cancelled'].includes(r.pipeline.status)) {
            clearInterval(intervalRef.current);
          }
        }
      } catch {}
    };
    poll();
    intervalRef.current = setInterval(poll, 2000);
    return () => clearInterval(intervalRef.current);
  }, [pipelineId]);

  if (!pipeline) return (
    <div className="ppp-pipeline">
      <div className="ppp-pipeline__label">Pipeline starting…</div>
    </div>
  );

  const STATUS_ICON = { pending: '○', running: '⟳', completed: '✓', failed: '✗', skipped: '–' };

  return (
    <div className="ppp-pipeline">
      <div className="ppp-pipeline__header">
        <span className="ppp-pipeline__title">Engineering Pipeline</span>
        <span className={`ppp-pipeline__status ppp-pipeline__status--${pipeline.status}`}>
          {pipeline.status}
        </span>
      </div>
      <div className="ppp-pipeline__stages">
        {(pipeline.stages || []).map((stage, i) => (
          <div key={i} className={`ppp-stage ppp-stage--${stage.status}`}>
            <span className="ppp-stage__icon">{STATUS_ICON[stage.status] || '○'}</span>
            <span className="ppp-stage__label">{stage.label || stage.stageId}</span>
            {stage.error && <span className="ppp-stage__error">{stage.error}</span>}
          </div>
        ))}
      </div>
      {pipeline.commitHash && (
        <div className="ppp-pipeline__commit">Committed: {pipeline.commitHash}</div>
      )}
    </div>
  );
}

// ── Patch History sidebar ──────────────────────────────────────────────
function PatchHistory({ onUndo }) {
  const [patches, setPatches] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await get('/coding/patch-history?limit=15');
      setPatches(r?.patches || []);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const undo = async (histId) => {
    try {
      const r = await post('/coding/undo-patch', { histId });
      if (r?.ok) { load(); onUndo?.(); }
    } catch {}
  };

  if (loading) return <div className="ppp-history-empty">Loading…</div>;
  if (!patches.length) return <div className="ppp-history-empty">No AI patches applied yet</div>;

  return (
    <div className="ppp-history">
      {patches.map((p, i) => (
        <div key={i} className={`ppp-hist-item ppp-hist-item--${p.status}`}>
          <div className="ppp-hist-item__goal">{p.goal?.slice(0, 80)}</div>
          <div className="ppp-hist-item__meta">
            <span className={`ppp-hist-status ppp-hist-status--${p.status}`}>{p.status}</span>
            <span className="ppp-hist-files">{p.appliedFiles?.length || 0} file(s)</span>
            <span className="ppp-hist-time">{p.appliedAt ? new Date(p.appliedAt).toLocaleTimeString() : ''}</span>
          </div>
          {p.status !== 'undone' && (
            <button className="ppp-undo-btn" onClick={() => undo(p.id)}>Undo</button>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Main PatchPreviewPanel ─────────────────────────────────────────────
export default function PatchPreviewPanel({
  goal,
  proposal,       // { explanation, reasoning, affectedFiles, confidence, riskLevel, riskReason, patchSpecs, unifiedDiff, commitMsg }
  canApply,
  patchId,
  cwd,
  onApplied,
  onRejected,
  onConvertToMission,
}) {
  const [view,       setView]       = useState('preview'); // 'preview' | 'history'
  const [applying,   setApplying]   = useState(false);
  const [applied,    setApplied]    = useState(false);
  const [converting, setConverting] = useState(false);
  const [pipeline,   setPipeline]   = useState(null);
  const [error,      setError]      = useState(null);
  const [showReason, setShowReason] = useState(false);
  const [reqApproval, setReqApproval] = useState(proposal?.riskLevel === 'high');

  const apply = useCallback(async () => {
    if (!canApply || applying) return;
    setApplying(true);
    setError(null);
    try {
      const r = await post('/coding/apply-patch', {
        patchSpecs:     proposal.patchSpecs,
        goal,
        cwd,
        commitMsg:      proposal.commitMsg,
        requireApproval: reqApproval,
      });
      if (!r?.ok) { setError(r?.error || 'Apply failed'); setApplying(false); return; }
      setApplied(true);
      if (r.pipeline) setPipeline(r.pipeline.pipelineId);
      onApplied?.(r);
    } catch (e) {
      setError(e.message);
      setApplying(false);
    }
  }, [canApply, applying, proposal, goal, cwd, reqApproval, onApplied]);

  const convertToMission = useCallback(async () => {
    if (converting) return;
    setConverting(true);
    try {
      const r = await post('/coding/convert-to-mission', {
        goal,
        patchSpecs:   proposal?.patchSpecs || [],
        affectedFiles: proposal?.affectedFiles || [],
        confidence:   proposal?.confidence,
        riskLevel:    proposal?.riskLevel,
      });
      if (r?.ok) onConvertToMission?.(r.mission);
    } catch {} finally { setConverting(false); }
  }, [converting, goal, proposal, onConvertToMission]);

  if (!proposal) return null;

  return (
    <div className="ppp">
      <div className="ppp-toolbar">
        <button className={`ppp-view-btn${view === 'preview' ? ' ppp-view-btn--active' : ''}`} onClick={() => setView('preview')}>Preview</button>
        <button className={`ppp-view-btn${view === 'history' ? ' ppp-view-btn--active' : ''}`} onClick={() => setView('history')}>History</button>
      </div>

      {view === 'history' && (
        <PatchHistory onUndo={() => {}} />
      )}

      {view === 'preview' && (
        <>
          <div className="ppp-meta">
            <RiskBadge level={proposal.riskLevel} />
            <ConfidenceMeter value={proposal.confidence} />
            {proposal.riskReason && (
              <button className="ppp-risk-reason-btn" onClick={() => setShowReason(r => !r)}>
                {showReason ? 'Hide reason' : 'Why?'}
              </button>
            )}
          </div>
          {showReason && <div className="ppp-risk-reason">{proposal.riskReason}</div>}

          <div className="ppp-explanation">{proposal.explanation}</div>

          {proposal.affectedFiles?.length > 0 && (
            <div className="ppp-affected">
              <div className="ppp-affected__label">Affected files</div>
              {proposal.affectedFiles.map((f, i) => (
                <div key={i} className="ppp-affected__file">{f}</div>
              ))}
            </div>
          )}

          <DiffViewer patchSpecs={proposal.patchSpecs} unifiedDiff={proposal.unifiedDiff} />

          {proposal.commitMsg && (
            <div className="ppp-commit-msg">
              <span className="ppp-commit-msg__label">Commit</span>
              <code className="ppp-commit-msg__text">{proposal.commitMsg}</code>
            </div>
          )}

          {!applied && (
            <div className="ppp-actions">
              {canApply && (
                <label className="ppp-approval-check">
                  <input
                    type="checkbox"
                    checked={reqApproval}
                    onChange={e => setReqApproval(e.target.checked)}
                  />
                  Require pipeline approval gate
                </label>
              )}
              <div className="ppp-action-row">
                {canApply && (
                  <button
                    className="ppp-btn ppp-btn--apply"
                    onClick={apply}
                    disabled={applying}
                  >
                    {applying ? 'Applying…' : 'Apply via Pipeline'}
                  </button>
                )}
                <button
                  className="ppp-btn ppp-btn--mission"
                  onClick={convertToMission}
                  disabled={converting}
                >
                  {converting ? '…' : 'Convert → Mission'}
                </button>
                <button className="ppp-btn ppp-btn--reject" onClick={onRejected}>
                  Reject
                </button>
              </div>
              {!canApply && proposal.patchSpecs?.length === 0 && (
                <div className="ppp-no-apply">
                  AI could not generate a safe patch. Use "Convert → Mission" to create a tracked task instead.
                </div>
              )}
              {!canApply && proposal.patchSpecs?.some(s => !s.valid) && (
                <div className="ppp-no-apply">
                  Some patches failed validation (see errors above). Fix the issues or convert to a Mission.
                </div>
              )}
            </div>
          )}

          {error && <div className="ppp-error">{error}</div>}

          {applied && pipeline && (
            <PipelineTracker pipelineId={pipeline} />
          )}
          {applied && !pipeline && (
            <div className="ppp-success">
              Patch applied and staged. Pipeline launched.
            </div>
          )}
        </>
      )}
    </div>
  );
}
