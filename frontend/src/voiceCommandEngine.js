"use strict";
// V6 Phase 8 (Personal JARVIS): Voice command layer — mic input -> intent ->
// action. Survey confirmed zero existing voice-command interface anywhere
// (creativeStudio.js's /creative/voice/tts+stt is content-generation only,
// unrelated). Uses the browser's real Web Speech API (SpeechRecognition) —
// no new backend transcription service, works natively in Electron's
// Chromium runtime and any modern browser. Real actions route to the
// already-real /planning/tasks (dailyPlanningEngine) and /assistant/ask
// (founderAssistantEngine) APIs built earlier this phase — not a parallel
// command system.
import * as planningApi from "./planningApi";
import * as founderAssistantApi from "./founderAssistantApi";

function _getRecognition() {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

export function isVoiceSupported() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

// ── Intent parsing ───────────────────────────────────────────────────────
// Small, explicit pattern set for direct actions; anything unmatched falls
// through to the Founder Assistant's real conversational context.

const NAV_TARGETS = {
  "dashboard":       "home", "home":            "home",
  "planning":        "planning", "agenda":       "planning", "tasks": "planning",
  "twin":            "twin", "digital twin":     "twin",
  "assistant":       "assistant",
  "customer success":"customersuccess",
  "devops":          "devops",
  "analytics":       "analyticscenter",
};

function parseIntent(transcript) {
  const t = transcript.trim().toLowerCase();

  const addTaskMatch =
    t.match(/^(?:add|create)\s+(?:a\s+)?task\s+(?:to\s+)?(.+)$/) ||
    t.match(/^remind me to\s+(.+)$/);
  if (addTaskMatch) {
    return { type: "create_task", title: addTaskMatch[1].trim() };
  }

  const gotoMatch = t.match(/^(?:go to|open|show|navigate to)\s+(.+)$/);
  if (gotoMatch) {
    const key = gotoMatch[1].trim();
    for (const [phrase, tabId] of Object.entries(NAV_TARGETS)) {
      if (key.includes(phrase)) return { type: "navigate", tabId };
    }
  }

  return { type: "ask", prompt: transcript.trim() };
}

/**
 * Executes a parsed intent. onNavigate is the app's setTab function; the
 * caller supplies it since voiceCommandEngine has no App-level state of
 * its own (kept a pure module, not a React context).
 */
async function executeIntent(intent, { onNavigate } = {}) {
  switch (intent.type) {
    case "create_task": {
      const r = await planningApi.createTask({ title: intent.title, priority: "normal" });
      return { ok: r.ok !== false, message: r.ok !== false ? `Added task: ${intent.title}` : (r.error || "Failed to add task") };
    }
    case "navigate": {
      onNavigate?.(intent.tabId);
      return { ok: true, message: `Navigating to ${intent.tabId}` };
    }
    case "ask": {
      const r = await founderAssistantApi.ask(intent.prompt);
      return { ok: r.ok !== false, message: r.ok !== false ? r.reply : (r.error || "Failed to get a response") };
    }
    default:
      return { ok: false, message: "Didn't understand that command" };
  }
}

/**
 * listenOnce(): starts the real browser recognizer, resolves with the
 * executed result once a final transcript is captured (or rejects on
 * error/no-speech). One-shot, not continuous — matches a deliberate
 * push-to-talk UX rather than an always-on wake-word listener (which
 * would need OS-level permission plumbing well beyond this scope).
 */
export function listenOnce({ onNavigate, onTranscript } = {}) {
  return new Promise((resolve, reject) => {
    const rec = _getRecognition();
    if (!rec) return reject(new Error("Speech recognition not supported in this environment"));

    rec.lang = "en-US";
    rec.interimResults = false;
    rec.maxAlternatives = 1;

    rec.onresult = async (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript || "";
      onTranscript?.(transcript);
      const intent = parseIntent(transcript);
      try {
        const result = await executeIntent(intent, { onNavigate });
        resolve({ transcript, intent, result });
      } catch (e) {
        reject(e);
      }
    };
    rec.onerror = (event) => reject(new Error(event.error || "Speech recognition error"));
    rec.onnomatch = () => reject(new Error("Could not understand speech"));

    rec.start();
  });
}

export { parseIntent };
