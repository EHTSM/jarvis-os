"use strict";
// V6 Phase 8 (Personal JARVIS): Founder Assistant — conversational entrypoint
// with live access to Digital Twin + daily agenda context, via
// founderAssistantEngine.cjs. Distinct from Chat.jsx (repo/coding context).
import React, { useState, useEffect, useRef, useCallback } from "react";
import * as fa from "../founderAssistantApi";
import { isVoiceSupported, listenOnce } from "../voiceCommandEngine";

export default function FounderAssistant({ onNavigate } = {}) {
  const [briefing, setBriefing] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [listening, setListening] = useState(false);
  const voiceSupported = isVoiceSupported();
  const bottomRef = useRef(null);

  useEffect(() => {
    fa.getBriefing().then(b => { if (b.ok !== false) setBriefing(b); }).catch(() => {});
  }, []);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const send = useCallback(async (e) => {
    e.preventDefault();
    const prompt = input.trim();
    if (!prompt || sending) return;
    setInput("");
    setError(null);
    const history = messages.map(m => ({ role: m.role, content: m.content }));
    setMessages(m => [...m, { role: "user", content: prompt }]);
    setSending(true);
    try {
      const r = await fa.ask(prompt, history);
      if (r.ok === false) { setError(r.error || "Failed to get a response"); }
      else setMessages(m => [...m, { role: "assistant", content: r.reply }]);
    } catch (e2) {
      setError(e2.message);
    } finally {
      setSending(false);
    }
  }, [input, sending, messages]);

  const startListening = useCallback(async () => {
    if (listening) return;
    setListening(true);
    setError(null);
    try {
      const { transcript, result } = await listenOnce({
        onNavigate,
        onTranscript: (t) => setMessages(m => [...m, { role: "user", content: t }]),
      });
      setMessages(m => [...m, { role: "assistant", content: result.message }]);
      void transcript;
    } catch (e) {
      setError(e.message);
    } finally {
      setListening(false);
    }
  }, [listening, onNavigate]);

  return (
    <div style={{ padding: 20, maxWidth: 800, margin: "0 auto", display: "flex", flexDirection: "column", height: "calc(100vh - 120px)" }}>
      <h2 style={{ margin: "0 0 8px", fontSize: 18 }}>Founder Assistant</h2>

      {briefing?.summary && (
        <div style={{ fontSize: 12, color: "var(--text-dim, #8994b0)", background: "rgba(255,255,255,0.03)", borderRadius: 6, padding: "10px 12px", marginBottom: 16, whiteSpace: "pre-line" }}>
          {briefing.summary}
        </div>
      )}

      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
        {messages.length === 0 && (
          <div style={{ fontSize: 12, color: "var(--text-dim, #8994b0)", textAlign: "center", padding: 20 }}>
            Ask about your day, priorities, or decision patterns — I have live access to your Digital Twin and agenda.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "80%", background: m.role === "user" ? "rgba(124,111,255,0.15)" : "rgba(255,255,255,0.05)", borderRadius: 8, padding: "8px 12px", fontSize: 13, whiteSpace: "pre-wrap" }}>
            {m.content}
          </div>
        ))}
        {sending && <div style={{ fontSize: 12, color: "var(--text-dim, #8994b0)" }}>Thinking…</div>}
        {error && <div style={{ fontSize: 12, color: "#f55b5b" }}>⚠ {error}</div>}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={send} style={{ display: "flex", gap: 8 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Ask your assistant…"
          style={{ flex: 1 }}
          disabled={sending}
        />
        {voiceSupported && (
          <button type="button" onClick={startListening} disabled={listening || sending} title="Voice command">
            {listening ? "🎤…" : "🎤"}
          </button>
        )}
        <button type="submit" disabled={sending || !input.trim()}>Send</button>
      </form>
    </div>
  );
}
