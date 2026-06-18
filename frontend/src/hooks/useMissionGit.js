/**
 * useMissionGit — J3 Mission-Aware Git hook
 *
 * Wraps all git IPC operations to:
 * 1. Emit events to executionEventBus (so Observer + Execution panels see them)
 * 2. POST mission timeline records to backend (artifact + decision)
 * 3. Poll the active mission for context (branch suggestion, commit count)
 * 4. Provide AI-generated commit message summaries
 * 5. Support approval-gated commits (mission.requiresApproval)
 * 6. Trigger mission completion when a "final commit" is recorded
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { BASE_URL } from '../_client';
import { bus } from '../runtime/execution/executionEventBus';

const api        = () => window.electronAPI;
const isElectron = () => !!window.electronAPI?.isElectron;

// ── API helpers ───────────────────────────────────────────────────────────────

async function _post(path, body = {}) {
  try {
    const r = await fetch(`${BASE_URL}${path}`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return r.json();
  } catch { return { success: false }; }
}

async function _get(path) {
  try {
    const r = await fetch(`${BASE_URL}${path}`, { credentials: 'include' });
    return r.json();
  } catch { return { success: false }; }
}

// ── Emit git event to execution bus ──────────────────────────────────────────

function emitGitEvent(type, payload = {}) {
  try {
    bus.executionStarted?.(`git.${type}`, { source: 'git', ...payload });
    // Also fire a CustomEvent for Observer panel's git category
    window.dispatchEvent(new CustomEvent('jarvis-git-event', {
      detail: { type, ts: Date.now(), ...payload },
    }));
  } catch {}
}

function emitGitComplete(type, ok, payload = {}) {
  try {
    if (ok) bus.executionCompleted?.(`git.${type}`, true, { source: 'git', ...payload });
    else    bus.executionFailed?.(`git.${type}`, payload.error || 'unknown', { source: 'git', ...payload });
    window.dispatchEvent(new CustomEvent('jarvis-git-event', {
      detail: { type: `${type}.${ok ? 'complete' : 'failed'}`, ts: Date.now(), ...payload },
    }));
  } catch {}
}

// ── Parse git status into staged/unstaged arrays ──────────────────────────────

function parseGitStatus(raw) {
  if (!raw) return { staged: [], unstaged: [], untracked: [] };
  const staged    = [];
  const unstaged  = [];
  const untracked = [];
  const lines = (raw.files || []).length ? null : null; // prebuilt by electron IPC
  // Electron git-status returns { staged, unstaged, untracked, branch, upstream }
  return {
    staged:    raw.staged    || [],
    unstaged:  raw.unstaged  || [],
    untracked: raw.untracked || [],
    branch:    raw.branch    || '',
    upstream:  raw.upstream  || null,
    ahead:     raw.ahead     || 0,
    behind:    raw.behind    || 0,
  };
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useMissionGit(cwd) {
  const [activeMission,      setActiveMission]      = useState(null);
  const [missionContext,     setMissionContext]      = useState(null); // git context for active mission
  const [pendingApproval,    setPendingApproval]     = useState(false);
  const [aiSummary,          setAiSummary]           = useState('');
  const [aiLoading,          setAiLoading]           = useState(false);
  const [gitStatus,          setGitStatus]           = useState(null);
  const pollTimer = useRef(null);

  // ── Poll for active mission ───────────────────────────────────────────────

  const refreshMission = useCallback(async () => {
    try {
      const r = await _get('/mission/runtime/active');
      const m = r?.mission || null;
      setActiveMission(m);
      if (m?.id) {
        const ctx = await _get(`/mission/git/context/${m.id}`);
        if (ctx?.success) setMissionContext(ctx);
      } else {
        setMissionContext(null);
      }
    } catch {}
  }, []);

  useEffect(() => {
    refreshMission();
    pollTimer.current = setInterval(refreshMission, 15000);
    return () => clearInterval(pollTimer.current);
  }, [refreshMission]);

  // ── Refresh git status ────────────────────────────────────────────────────

  const refreshStatus = useCallback(async () => {
    if (!isElectron() || !cwd) return;
    try {
      const raw = await api().gitStatus(cwd);
      const parsed = parseGitStatus(raw);
      setGitStatus(parsed);
      const changed = (parsed?.staged?.length || 0) + (parsed?.unstaged?.length || 0);
      window.dispatchEvent(new CustomEvent('git-status-update', { detail: { changed } }));
    } catch {}
  }, [cwd]);

  useEffect(() => { refreshStatus(); }, [refreshStatus]);

  // Auto-poll git status every 5 s so the panel reflects edits without manual refresh
  useEffect(() => {
    if (!cwd) return;
    const id = setInterval(refreshStatus, 5000);
    return () => clearInterval(id);
  }, [cwd, refreshStatus]);

  // ── AI commit summary ─────────────────────────────────────────────────────

  const generateSummary = useCallback(async (diff, filesChanged) => {
    setAiLoading(true);
    setAiSummary('');
    try {
      const r = await _post('/mission/git/generate-summary', {
        diff,
        filesChanged,
        branch:           gitStatus?.branch,
        missionObjective: activeMission?.objective || missionContext?.objective,
      });
      if (r?.summary) setAiSummary(r.summary);
      return r?.summary || '';
    } catch {
      return '';
    } finally {
      setAiLoading(false);
    }
  }, [gitStatus, activeMission, missionContext]);

  // ── Mission-aware commit ──────────────────────────────────────────────────

  const missionCommit = useCallback(async (message, opts = {}) => {
    const { isFinal = false, skipApproval = false } = opts;
    if (!isElectron() || !cwd) return { error: 'Desktop only' };

    // Check approval gate
    if (activeMission?.requiresApproval && !skipApproval) {
      setPendingApproval(true);
      await _post('/mission/git/record-review', {
        missionId:   activeMission.id,
        reviewType:  'pre-commit-approval',
        requestedBy: 'operator',
        files:       gitStatus?.staged?.map(f => f.path || f) || [],
        summary:     `Approval requested for commit: ${message}`,
      });
      emitGitEvent('commit.approval-requested', { missionId: activeMission.id, message });
      return { pendingApproval: true, missionId: activeMission.id };
    }

    emitGitEvent('commit', { cwd, message, missionId: activeMission?.id });

    try {
      // Stage all + commit
      await api().shellExec({ command: 'git add -A', cwd });
      const result = await api().gitCommit(cwd, message);
      if (result?.error) throw new Error(result.error);

      // Get the commit hash
      let commitHash = '';
      let filesChanged = [];
      try {
        const logR = await api().gitLog(cwd, 1);
        commitHash   = logR?.commits?.[0]?.hash || '';
        const statusR = await api().gitStatus(cwd);
        filesChanged = (statusR?.staged || []).map(f => f.path || f);
      } catch {}

      // Record in mission timeline
      if (activeMission?.id) {
        if (isFinal) {
          await _post('/mission/git/complete-on-commit', {
            missionId:  activeMission.id,
            commitHash,
            summary:    message,
          });
          await refreshMission();
        } else {
          await _post('/mission/git/record-commit', {
            missionId:     activeMission.id,
            commitHash,
            commitMessage: message,
            branch:        gitStatus?.branch,
            author:        'operator',
            filesChanged,
          });
        }
      }

      emitGitComplete('commit', true, { commitHash, message, missionId: activeMission?.id });
      setPendingApproval(false);
      setAiSummary('');
      await refreshStatus();
      return { ok: true, commitHash, result };
    } catch (e) {
      emitGitComplete('commit', false, { error: e.message, missionId: activeMission?.id });
      return { error: e.message };
    }
  }, [cwd, activeMission, gitStatus, refreshStatus, refreshMission]);

  // ── Mission-aware branch create/checkout ─────────────────────────────────

  const missionBranch = useCallback(async (branchName, action = 'create') => {
    if (!isElectron() || !cwd) return { error: 'Desktop only' };
    emitGitEvent(`branch.${action}`, { cwd, branchName, missionId: activeMission?.id });

    try {
      let result;
      if (action === 'create') {
        result = await api().shellExec({ command: `git checkout -b "${branchName}"`, cwd });
      } else {
        result = await api().gitCheckout(cwd, branchName);
      }
      if (result?.code !== 0 && result?.stderr) throw new Error(result.stderr);

      if (activeMission?.id) {
        await _post('/mission/git/record-branch', {
          missionId:  activeMission.id,
          branchName,
          action,
          fromBranch: gitStatus?.branch,
        });
      }

      emitGitComplete(`branch.${action}`, true, { branchName, missionId: activeMission?.id });
      await refreshStatus();
      return { ok: true, branchName };
    } catch (e) {
      emitGitComplete(`branch.${action}`, false, { error: e.message });
      return { error: e.message };
    }
  }, [cwd, activeMission, gitStatus, refreshStatus]);

  // ── Mission-aware rollback ────────────────────────────────────────────────

  const missionRollback = useCallback(async (targetHash, reason) => {
    if (!isElectron() || !cwd) return { error: 'Desktop only' };
    emitGitEvent('rollback', { cwd, targetHash, reason, missionId: activeMission?.id });

    try {
      const result = await api().shellExec({ command: `git revert --no-commit ${targetHash}`, cwd });
      if (result?.code !== 0 && result?.stderr) throw new Error(result.stderr);

      if (activeMission?.id) {
        await _post('/mission/git/record-rollback', {
          missionId:  activeMission.id,
          targetHash,
          reason,
          phase:      'commit',
        });
      }

      emitGitComplete('rollback', true, { targetHash, missionId: activeMission?.id });
      await refreshStatus();
      return { ok: true };
    } catch (e) {
      emitGitComplete('rollback', false, { error: e.message });
      return { error: e.message };
    }
  }, [cwd, activeMission, refreshStatus]);

  // ── Mission-aware review ──────────────────────────────────────────────────

  const missionReview = useCallback(async (files, summary) => {
    if (!activeMission?.id) return { error: 'No active mission' };
    emitGitEvent('review.requested', { files, missionId: activeMission.id });
    try {
      const r = await _post('/mission/git/record-review', {
        missionId:   activeMission.id,
        reviewType:  'code-review',
        requestedBy: 'operator',
        files,
        summary,
      });
      emitGitComplete('review.requested', true, { missionId: activeMission.id });
      return r;
    } catch (e) {
      return { error: e.message };
    }
  }, [activeMission]);

  // ── Mission-linked git history ────────────────────────────────────────────

  const getMissionHistory = useCallback(async (limit = 50) => {
    try {
      const r = await _get(`/mission/git/history?limit=${limit}`);
      return r?.history || [];
    } catch { return []; }
  }, []);

  // ── Approve pending commit ────────────────────────────────────────────────

  const approveCommit = useCallback(async (message) => {
    setPendingApproval(false);
    return missionCommit(message, { skipApproval: true });
  }, [missionCommit]);

  return {
    // State
    activeMission,
    missionContext,
    pendingApproval,
    aiSummary,
    aiLoading,
    gitStatus,
    // Actions
    missionCommit,
    missionBranch,
    missionRollback,
    missionReview,
    approveCommit,
    generateSummary,
    getMissionHistory,
    refreshMission,
    refreshStatus,
    setPendingApproval,
    setAiSummary,
  };
}
