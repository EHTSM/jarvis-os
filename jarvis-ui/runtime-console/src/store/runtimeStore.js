import { create } from "zustand";
import {
  generateQueueState, generateActiveExecutions, generateTimelineEntries,
  generateWorkflowGraph, generatePressureState, generatePressureHistory,
  generateAgentFeed, generateAgentEvent, generateRetrySchedule,
  generateOrchestrationHealth, generateThroughputHistory,
  generateLatencyHistory, generateAdapterLoad, generateConcurrencyState,
} from "../lib/mockRuntime.js";

let _tick      = 0;
let _evtSeq    = 100;
const MAX_FEED = 60;

export const useRuntimeStore = create((set, get) => ({
  // ── state ────────────────────────────────────────────────────────
  tickCount:         0,
  paused:            false,
  activeTab:         "overview",

  queueState:         generateQueueState(),
  activeExecutions:   generateActiveExecutions(8),
  timelineEntries:    generateTimelineEntries(20),
  workflowGraph:      generateWorkflowGraph(),
  pressureState:      generatePressureState(0),
  pressureHistory:    generatePressureHistory(40),
  agentFeed:          generateAgentFeed(30),
  retrySchedule:      generateRetrySchedule(8),
  orchestrationHealth: generateOrchestrationHealth(0),
  throughputHistory:  generateThroughputHistory(30),
  latencyHistory:     generateLatencyHistory(30),
  adapterLoad:        generateAdapterLoad(),
  concurrencyState:   generateConcurrencyState(),
  selectedExecution:  null,

  // ── actions ──────────────────────────────────────────────────────
  setTab:  (tab) => set({ activeTab: tab }),
  setPaused: (v) => set({ paused: v }),

  selectExecution: (ex) => set({ selectedExecution: ex }),
  clearSelection:  ()   => set({ selectedExecution: null }),

  advance: () => {
    _tick++;
    const { paused } = get();
    if (paused) return;

    // Rolling feed: prepend new event, trim to MAX_FEED
    const newEvt = generateAgentEvent(++_evtSeq);
    set(s => ({
      tickCount:          _tick,
      queueState:         generateQueueState(),
      activeExecutions:   generateActiveExecutions(6 + Math.floor(Math.abs(Math.sin(_tick * 0.3)) * 4)),
      pressureState:      generatePressureState(_tick),
      pressureHistory:    generatePressureHistory(40),
      orchestrationHealth: generateOrchestrationHealth(_tick),
      adapterLoad:        generateAdapterLoad(),
      concurrencyState:   generateConcurrencyState(),
      agentFeed:          [newEvt, ...s.agentFeed].slice(0, MAX_FEED),
      throughputHistory:  generateThroughputHistory(30),
      latencyHistory:     generateLatencyHistory(30),
    }));
  },
}));

// ── polling interval ──────────────────────────────────────────────────
export function startRuntimePolling(intervalMs = 2000) {
  const store = useRuntimeStore.getState();
  const id    = setInterval(() => useRuntimeStore.getState().advance(), intervalMs);
  return () => clearInterval(id);
}
