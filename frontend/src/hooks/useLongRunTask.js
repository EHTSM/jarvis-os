// Phase 363: Long-run task management
// Reconnect-safe: task state survives page refresh, idle, and reconnect cycles.
// Backed by the existing useWorkflowCheckpoint infrastructure.
// Adds: idle-safe heartbeat, reconnect detection, persistent task registry.

import { useState, useEffect, useCallback, useRef } from "react";
import { saveCheckpoint, loadCheckpoint, clearCheckpoint, getResumableCheckpoints } from "./useWorkflowCheckpoint";

const TASK_REGISTRY_KEY = "jarvis_long_run_tasks";
const TASK_MAX          = 50;
const HEARTBEAT_MS      = 30_000;  // write heartbeat every 30s while a task is active
const STALE_MS          = 5 * 60 * 1000; // task is stale if no heartbeat for 5min

function _loadRegistry() {
  try { return JSON.parse(localStorage.getItem(TASK_REGISTRY_KEY) || "[]"); }
  catch { return []; }
}

function _saveRegistry(tasks) {
  try { localStorage.setItem(TASK_REGISTRY_KEY, JSON.stringify(tasks.slice(0, TASK_MAX))); } catch {}
}

function _upsertTask(task) {
  const tasks = _loadRegistry().filter(t => t.taskId !== task.taskId);
  tasks.unshift(task);
  _saveRegistry(tasks);
}

function _removeTask(taskId) {
  _saveRegistry(_loadRegistry().filter(t => t.taskId !== taskId));
}

// Detect tasks that were running at the time of a page close/refresh
function detectInterruptedTasks() {
  const now = Date.now();
  return _loadRegistry().filter(t =>
    t.state === "running" && (now - (t.heartbeat || t.startedAt)) > STALE_MS
  );
}

/**
 * useLongRunTask — manages a single resumable long-running task.
 *
 * taskId: stable identifier (e.g. "wf-deploy-20260521")
 *
 * Returns:
 *   taskState      — current task record (null if no active task)
 *   interrupted    — list of tasks that were interrupted before this session
 *   startTask      — register + start a new task
 *   progressTask   — update step progress and write checkpoint
 *   completeTask   — mark done and clear checkpoint
 *   failTask       — mark failed, preserve checkpoint for resume
 *   resumeTask     — load checkpoint and return remaining steps
 *   abandonTask    — clear task + checkpoint entirely
 */
export function useLongRunTask(taskId) {
  const [taskState, setTaskState]   = useState(() => _loadRegistry().find(t => t.taskId === taskId) || null);
  const [interrupted, setInterrupted] = useState(() => detectInterruptedTasks());
  const heartbeatRef = useRef(null);

  // Heartbeat: keep lastHeartbeat fresh while task is "running" so reconnect detection works
  useEffect(() => {
    if (taskState?.state !== "running") {
      clearInterval(heartbeatRef.current);
      return;
    }
    heartbeatRef.current = setInterval(() => {
      const updated = { ...taskState, heartbeat: Date.now() };
      _upsertTask(updated);
      setTaskState(updated);
    }, HEARTBEAT_MS);
    return () => clearInterval(heartbeatRef.current);
  }, [taskState?.state, taskId]);

  // On mount: refresh interrupted task list
  useEffect(() => {
    setInterrupted(detectInterruptedTasks());
  }, []);

  const startTask = useCallback((label, totalSteps, meta = {}) => {
    const task = {
      taskId, label, totalSteps, stepIndex: 0,
      state: "running", startedAt: Date.now(), heartbeat: Date.now(), ...meta,
    };
    _upsertTask(task);
    setTaskState(task);
    return task;
  }, [taskId]);

  const progressTask = useCallback((stepIndex, completedSteps, remainingSteps, stepMeta = {}) => {
    const current = _loadRegistry().find(t => t.taskId === taskId);
    if (!current) return;
    const updated = { ...current, stepIndex, heartbeat: Date.now() };
    _upsertTask(updated);
    setTaskState(updated);
    // Write checkpoint so work survives refresh
    saveCheckpoint(taskId, stepIndex, completedSteps, remainingSteps, stepMeta);
  }, [taskId]);

  const completeTask = useCallback(() => {
    const current = _loadRegistry().find(t => t.taskId === taskId);
    if (!current) return;
    const done = { ...current, state: "done", endedAt: Date.now() };
    _upsertTask(done);
    setTaskState(done);
    clearCheckpoint(taskId);
  }, [taskId]);

  const failTask = useCallback((error = "") => {
    const current = _loadRegistry().find(t => t.taskId === taskId);
    if (!current) return;
    const failed = { ...current, state: "failed", error, endedAt: Date.now() };
    _upsertTask(failed);
    setTaskState(failed);
    // Checkpoint is preserved — operator can resume later
  }, [taskId]);

  const resumeTask = useCallback(() => {
    const checkpoint = loadCheckpoint(taskId);
    if (!checkpoint) return null;
    const current = _loadRegistry().find(t => t.taskId === taskId);
    if (current) {
      const resumed = { ...current, state: "running", resumedAt: Date.now(), heartbeat: Date.now() };
      _upsertTask(resumed);
      setTaskState(resumed);
    }
    return checkpoint;
  }, [taskId]);

  const abandonTask = useCallback(() => {
    _removeTask(taskId);
    clearCheckpoint(taskId);
    setTaskState(null);
  }, [taskId]);

  return { taskState, interrupted, startTask, progressTask, completeTask, failTask, resumeTask, abandonTask };
}

/** List all registered long-run tasks — for a task management dashboard view */
export function listLongRunTasks() {
  return _loadRegistry();
}
