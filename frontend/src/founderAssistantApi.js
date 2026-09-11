"use strict";
// V6 Phase 8 (Personal JARVIS): /assistant/* client — founderAssistantEngine.cjs
import { _fetch } from "./_client";

export async function ask(prompt, history = []) {
  return _fetch("/assistant/ask", { method: "POST", body: JSON.stringify({ prompt, history }) });
}

export async function getBriefing() {
  return _fetch("/assistant/briefing");
}
