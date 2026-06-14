import React, {
  useState, useEffect, useRef, useCallback, useMemo, memo,
} from "react";
import {
  dispatchJarvis, getRuntimeStatus, emergencyStop, emergencyResume,
  recoverQueue, recoverGovernor, getRecommendations, getObserverStatus,
  triggerObserver, getGraphList, createGraph, executeGraph,
  getMemoryStats, searchP26Memory, getHealth, getOps,
  getDeployHistory, getAgents, getCycleStats, getActions,
} from "./operatorApi";
import "./OperatorCommandLayer.css";

// ── Built-in slash commands ────────────────────────────────────────────
const COMMANDS = [
  { cmd: "/mission",     desc: "Create + launch a mission",         usage: "/mission <description>" },
  { cmd: "/deploy",      desc: "Show deployment history",           usage: "/deploy" },
  { cmd: "/heal",        desc: "Trigger recovery procedures",       usage: "/heal [queue|governor|all]" },
  { cmd: "/analyze",     desc: "Get AI recommendations",            usage: "/analyze" },
  { cmd: "/review",      desc: "Trigger code review observer",      usage: "/review" },
  { cmd: "/rollback",    desc: "Get rollback plan",                 usage: "/rollback <context>" },
  { cmd: "/restart",     desc: "Resume runtime after stop",         usage: "/restart" },
  { cmd: "/stop",        desc: "Emergency stop all agents",         usage: "/stop" },
  { cmd: "/graph",       desc: "List active task graphs/missions",  usage: "/graph" },
  { cmd: "/memory",      desc: "Search memory/knowledge graph",     usage: "/memory <query>" },
  { cmd: "/incidents",   desc: "Show active warnings",              usage: "/incidents" },
  { cmd: "/runtime",     desc: "Show runtime status",               usage: "/runtime" },
  { cmd: "/project",     desc: "Jarvis natural language dispatch",  usage: "/project <anything>" },
  { cmd: "/agents",      desc: "List running agents",               usage: "/agents" },
  { cmd: "/cycles",      desc: "Show autonomy cycle stats",         usage: "/cycles" },
  { cmd: "/help",        desc: "Show all commands",                 usage: "/help" },
];

// ── Result item ────────────────────────────────────────────────────────
const ResultItem = memo(({ item }) => {
  const isErr  = item.type === "error";
  const isOk   = item.type === "success";
  const isSys  = item.type === "system";
  const isCmd  = item.type === "command";
  const isData = item.type === "data";

  return (
    <div className={`ocl-item ocl-item--${isErr ? "err" : isOk ? "ok" : isSys ? "sys" : isCmd ? "cmd" : "data"}`}>
      {isCmd && <span className="ocl-item-prefix">❯</span>}
      {isOk  && <span className="ocl-item-prefix">✓</span>}
      {isErr && <span className="ocl-item-prefix">✕</span>}
      {isSys && <span className="ocl-item-prefix">⬡</span>}
      <div className="ocl-item-body">
        <pre className="ocl-item-text">{item.text}</pre>
        {item.ts && (
          <span className="ocl-item-time">
            {new Date(item.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
        )}
      </div>
    </div>
  );
});

// ── Autocomplete suggestion ────────────────────────────────────────────
const Suggestion = memo(({ cmd, active, onClick }) => (
  <div className={`ocl-suggestion${active ? " ocl-suggestion--active" : ""}`} onClick={onClick}>
    <span className="ocl-sug-cmd">{cmd.cmd}</span>
    <span className="ocl-sug-usage">{cmd.usage.slice(cmd.cmd.length)}</span>
    <span className="ocl-sug-desc">{cmd.desc}</span>
  </div>
));

// ── Format data for display ────────────────────────────────────────────
function fmt(data) {
  if (data == null) return "—";
  if (typeof data === "string") return data;
  if (typeof data === "number") return String(data);
  return JSON.stringify(data, null, 2);
}

// ══════════════════════════════════════════════════════════════════════
// Main OperatorCommandLayer
// ══════════════════════════════════════════════════════════════════════
export default function OperatorCommandLayer() {
  const [input,     setInput]     = useState("");
  const [history,   setHistory]   = useState([{
    type: "system",
    text: "Operator Command Layer — type /help for commands or natural language for Jarvis dispatch",
    ts: Date.now(),
  }]);
  const [loading,   setLoading]   = useState(false);
  const [cmdHist,   setCmdHist]   = useState([]);  // input history for ↑/↓
  const [histIdx,   setHistIdx]   = useState(-1);
  const [suggestions, setSuggestions] = useState([]);
  const [sugIdx,    setSugIdx]    = useState(-1);

  const inputRef = useRef(null);
  const bodyRef  = useRef(null);

  // Auto-scroll
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: "smooth" });
  }, [history]);

  // Suggestions
  useEffect(() => {
    if (input.startsWith("/")) {
      const q = input.toLowerCase();
      const matches = COMMANDS.filter(c => c.cmd.startsWith(q) || (input.length > 1 && c.cmd.includes(q)));
      setSuggestions(matches.slice(0, 6));
      setSugIdx(-1);
    } else {
      setSuggestions([]);
    }
  }, [input]);

  function push(type, text) {
    setHistory(prev => [...prev, { type, text, ts: Date.now() }]);
  }

  // ── Command router ────────────────────────────────────────────────
  const execute = useCallback(async (raw) => {
    const cmd = raw.trim();
    if (!cmd) return;

    // Save to input history
    setCmdHist(prev => [cmd, ...prev.slice(0, 49)]);
    setHistIdx(-1);
    push("command", cmd);
    setLoading(true);

    try {
      // ── Slash commands ──────────────────────────────────────────
      if (cmd.startsWith("/help")) {
        push("data", COMMANDS.map(c => `${c.cmd.padEnd(16)} ${c.desc}`).join("\n"));

      } else if (cmd.startsWith("/stop")) {
        if (!window.confirm("Emergency stop all agents?")) { push("system", "Cancelled."); return; }
        const r = await emergencyStop();
        push("success", fmt(r));

      } else if (cmd.startsWith("/restart") || cmd.startsWith("/resume")) {
        const r = await emergencyResume();
        push("success", fmt(r));

      } else if (cmd.startsWith("/heal")) {
        const arg = cmd.replace("/heal", "").trim();
        const results = [];
        if (!arg || arg === "all" || arg === "queue") {
          const r = await recoverQueue().catch(e => ({ error: e.message }));
          results.push("Queue: " + fmt(r));
        }
        if (!arg || arg === "all" || arg === "governor") {
          const r = await recoverGovernor().catch(e => ({ error: e.message }));
          results.push("Governor: " + fmt(r));
        }
        push("success", results.join("\n"));

      } else if (cmd.startsWith("/analyze")) {
        const r = await getRecommendations();
        const recs = r?.recommendations || r || [];
        if (!recs.length) { push("data", "No recommendations."); return; }
        push("data", recs.slice(0, 5).map((r, i) =>
          `[${r.priority || "med"}] ${r.title || r.type || "Rec"}\n  ${(r.reason || "").slice(0, 100)}`
        ).join("\n\n"));

      } else if (cmd.startsWith("/review")) {
        const r = await triggerObserver("code-review");
        push("success", "Code review observer triggered: " + fmt(r));

      } else if (cmd.startsWith("/runtime")) {
        const [rt, hl, op] = await Promise.all([getRuntimeStatus(), getHealth(), getOps()]);
        const lines = [
          `Status:   ${rt?.status || hl?.status || "unknown"}`,
          `Uptime:   ${op?.uptime?.human || hl?.uptime_seconds + "s" || "—"}`,
          `Queue:    ${op?.queue?.counts?.running || 0} running / ${op?.queue?.counts?.pending || 0} pending`,
          `Heap:     ${op?.memory?.current?.heap_mb || "—"} MB`,
          `AI:       ${hl?.services?.ai ? "online" : "offline"}`,
          `DB:       ${hl?.services?.db !== false ? "online" : "offline"}`,
        ];
        push("data", lines.join("\n"));

      } else if (cmd.startsWith("/incidents")) {
        const op = await getOps();
        const w = op?.warnings || [];
        if (!w.length) { push("data", "No active incidents."); return; }
        push("data", w.map(x => `[${x.code}] ${x.detail}`).join("\n"));

      } else if (cmd.startsWith("/agents")) {
        const r = await getAgents();
        const ag = r?.agents || r || [];
        const run = ag.filter(a => a.status === "running" || a.status === "active");
        push("data", [
          `Total: ${ag.length} · Running: ${run.length}`,
          ...run.slice(0, 10).map(a => `  ${(a.name || a.id || "?").padEnd(30)} ${a.status}`)
        ].join("\n"));

      } else if (cmd.startsWith("/graph")) {
        const r = await getGraphList();
        const graphs = r?.graphs || r || [];
        if (!graphs.length) { push("data", "No missions/graphs."); return; }
        push("data", graphs.slice(0, 10).map(g =>
          `${(g.status || "?").padEnd(12)} ${(g.mission || g.name || g.id || "—").slice(0, 60)}`
        ).join("\n"));

      } else if (cmd.startsWith("/memory")) {
        const q = cmd.replace("/memory", "").trim();
        if (!q) { const s = await getMemoryStats(); push("data", fmt(s)); return; }
        const r = await searchP26Memory(q, "all");
        const results = r?.results || r || [];
        if (!results.length) { push("data", `No memories for "${q}".`); return; }
        push("data", results.slice(0, 5).map(m =>
          `[${m.type || "mem"}] ${(m.content || m.summary || "—").slice(0, 100)}`
        ).join("\n\n"));

      } else if (cmd.startsWith("/deploy")) {
        const r = await getDeployHistory();
        const deps = r?.deployments || r || [];
        if (!deps.length) { push("data", "No deployments."); return; }
        push("data", deps.slice(0, 10).map(d =>
          `${(d.status || "?").padEnd(12)} ${(d.name || d.id || "—").slice(0, 40)}  ${d.deployedAt ? new Date(d.deployedAt).toLocaleString() : ""}`
        ).join("\n"));

      } else if (cmd.startsWith("/cycles")) {
        const r = await getCycleStats();
        push("data", fmt(r));

      } else if (cmd.startsWith("/mission")) {
        const mission = cmd.replace("/mission", "").trim();
        if (!mission) { push("error", "Usage: /mission <description>"); return; }
        push("system", `Creating mission: "${mission}"…`);
        const g = await createGraph({ mission, auto_execute: true });
        const graph = g?.graph || g;
        if (graph?.id) {
          push("success", `Mission created (${graph.id}). Executing…`);
          await executeGraph(graph.id).catch(() => {});
          push("success", `Mission launched: "${mission}"`);
        } else {
          push("data", fmt(g));
        }

      } else if (cmd.startsWith("/rollback")) {
        const ctx = cmd.replace("/rollback", "").trim();
        const { getRollbackPlan } = await import("./operatorApi");
        const r = await getRollbackPlan({ context: ctx });
        push("data", fmt(r?.plan || r));

      } else if (cmd.startsWith("/project")) {
        const q = cmd.replace("/project", "").trim() || cmd;
        push("system", "Dispatching to Jarvis…");
        const r = await dispatchJarvis(q, "smart");
        push(r?.success ? "success" : "data", r?.reply || fmt(r));

      } else {
        // Natural language → Jarvis
        push("system", "Dispatching to Jarvis…");
        const r = await dispatchJarvis(cmd, "smart");
        push(r?.success !== false ? "success" : "error", r?.reply || fmt(r));
      }

    } catch (e) {
      push("error", "Error: " + e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  function handleKeyDown(e) {
    if (suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSugIdx(i => Math.min(i + 1, suggestions.length - 1));
        return;
      }
      if (e.key === "ArrowUp" && sugIdx >= 0) {
        e.preventDefault();
        setSugIdx(i => i - 1);
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && sugIdx >= 0)) {
        e.preventDefault();
        const s = suggestions[sugIdx >= 0 ? sugIdx : 0];
        setInput(s.cmd + " ");
        setSuggestions([]);
        inputRef.current?.focus();
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (loading) return;
      const cmd = input.trim();
      setInput("");
      setSuggestions([]);
      execute(cmd);
      return;
    }

    if (e.key === "ArrowUp" && !suggestions.length) {
      e.preventDefault();
      const idx = Math.min(histIdx + 1, cmdHist.length - 1);
      setHistIdx(idx);
      if (cmdHist[idx]) setInput(cmdHist[idx]);
      return;
    }
    if (e.key === "ArrowDown" && !suggestions.length) {
      e.preventDefault();
      const idx = histIdx - 1;
      setHistIdx(Math.max(idx, -1));
      setInput(idx < 0 ? "" : cmdHist[idx] || "");
      return;
    }
    if (e.key === "Escape") {
      setSuggestions([]);
      setSugIdx(-1);
    }
  }

  return (
    <div className="ocl-root">
      <header className="ocl-header">
        <span className="ocl-title">Operator Command</span>
        <span className="ocl-subtitle">Slash commands · Natural language · Jarvis dispatch</span>
        <button className="ocl-clear" onClick={() => setHistory([])} title="Clear">⌫ Clear</button>
      </header>

      {/* Output */}
      <div className="ocl-body" ref={bodyRef}>
        {history.map((item, i) => <ResultItem key={i} item={item} />)}
        {loading && (
          <div className="ocl-item ocl-item--sys">
            <span className="ocl-item-prefix">⬡</span>
            <div className="ocl-item-body"><span className="ocl-thinking">processing…</span></div>
          </div>
        )}
      </div>

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <div className="ocl-suggestions">
          {suggestions.map((c, i) => (
            <Suggestion
              key={c.cmd}
              cmd={c}
              active={i === sugIdx}
              onClick={() => { setInput(c.cmd + " "); setSuggestions([]); inputRef.current?.focus(); }}
            />
          ))}
        </div>
      )}

      {/* Input */}
      <div className="ocl-input-wrap">
        <span className="ocl-prompt">❯</span>
        <input
          ref={inputRef}
          className="ocl-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type /help, a slash command, or natural language…"
          disabled={loading}
          autoFocus
          spellCheck={false}
        />
        {loading && <span className="ocl-spinner">●</span>}
      </div>
    </div>
  );
}
