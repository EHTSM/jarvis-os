// Phase 371: Operator Timeline
// Extracts: execution timeline, completion digest, recovery summaries, operational history.
// Reads from dispatch history and execution bus — never holds duplicate state.
// WorkflowPanel reads these, never re-derives them inline.

import { useState, useCallback, useMemo } from "react";
import { subscribe, unsubscribe, recentEvents } from "./executionEventBus";
import { useEffect } from "react";

const TIMELINE_MAX = 50; // keep last 50 timeline entries

/**
 * useOperatorTimeline
 *
 * @param {Array} dispatchHist — from WorkflowPanel's localStorage-backed history
 */
export function useOperatorTimeline(dispatchHist = []) {
  const [timelineEntries, setTimelineEntries] = useState(() => recentEvents(20));

  // Subscribe to bus events and append to timeline
  useEffect(() => {
    const id = subscribe((event) => {
      setTimelineEntries(prev => {
        const next = [event, ...prev].slice(0, TIMELINE_MAX);
        return next;
      });
    });
    return () => { if (id) unsubscribe(id); };
  }, []);

  // Completion digest: last 5 commands with ok/fail and duration
  const completionDigest = useMemo(() => {
    return dispatchHist.slice(0, 5).map(h => ({
      cmd:       h.cmd.slice(0, 50),
      ok:        h.ok,
      summary:   h.summary || "",
      ts:        h.ts,
      ageMin:    Math.floor((Date.now() - h.ts) / 60_000),
    }));
  }, [dispatchHist]);

  // Recovery summary: recent recovery events from bus
  const recoverySummaries = useMemo(() => {
    return timelineEntries
      .filter(e => e.type === "recovery-triggered" || e.type === "recovery-completed")
      .slice(0, 5)
      .map(e => ({
        type:   e.type,
        cmd:    e.cmd?.slice(0, 40),
        ok:     e.ok,
        ts:     e.ts,
      }));
  }, [timelineEntries]);

  // Session success rate
  const sessionStats = useMemo(() => {
    if (!dispatchHist.length) return null;
    const last20  = dispatchHist.slice(0, 20);
    const ok      = last20.filter(h => h.ok).length;
    const total   = last20.length;
    const rate    = Math.round((ok / total) * 100);
    const avgMs   = null; // timestamps don't include duration — skip
    return { ok, total, rate, avgMs };
  }, [dispatchHist]);

  const clearTimeline = useCallback(() => setTimelineEntries([]), []);

  return { timelineEntries, completionDigest, recoverySummaries, sessionStats, clearTimeline };
}
