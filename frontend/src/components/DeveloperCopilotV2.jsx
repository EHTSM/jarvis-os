import React, { useState, useEffect, useCallback, useRef } from "react";
import { track } from "../analytics";
import { sendMessage, checkHealth } from "../api";
import { checkHealth as getHealth, getOpsData, getMetrics } from "../telemetryApi";
import { getRuntimeHistory } from "../runtimeApi";
import {
  listIndexedRepos, indexRepo, getRepoStatus, semanticSearch,
  vsCodeChat,
} from "../phase24Api";
import {
  listTools, toolStatus, executeTool,
} from "../phase19Api";
import {
  getOAuthProviderStatus, listOAuthConnections, revokeOAuth, getOAuthUrl,
} from "../phase21Api";
import "./DeveloperCopilotV2.css";

// ── Constants ─────────────────────────────────────────────────────────

const TABS = [
  { id: "copilot",      label: "Copilot Chat"     },
  { id: "repos",        label: "Repo Intelligence" },
  { id: "review",       label: "Code Review"       },
  { id: "architecture", label: "Architecture"      },
  { id: "health",       label: "Eng Health"        },
  { id: "integrations", label: "Integrations"      },
  { id: "tools",        label: "Tool Fabric"       },
];

const COPILOT_PROMPTS = [
  "Review my latest changes",
  "What tests should I write for this feature?",
  "Suggest architecture improvements",
  "Analyze this error and suggest a fix",
  "Help me design an API endpoint",
  "How do I optimise this for performance?",
];

const SEED_REPOS = [
  { id: "ooplix-backend",  name: "ooplix-backend",   lang: "Node.js",   status: "indexed",    coverage: 84, lastCommit: "2h ago",  issues: 3, prs: 2, ci: "passing", health: "healthy"  },
  { id: "ooplix-frontend", name: "ooplix-frontend",  lang: "React",     status: "indexed",    coverage: 71, lastCommit: "45m ago", issues: 5, prs: 3, ci: "passing", health: "healthy"  },
  { id: "ooplix-mobile",   name: "ooplix-mobile",    lang: "Capacitor", status: "indexed",    coverage: 52, lastCommit: "1d ago",  issues: 8, prs: 1, ci: "failing", health: "warning"  },
  { id: "ooplix-agents",   name: "ooplix-agents",    lang: "CJS",       status: "indexed",    coverage: 67, lastCommit: "3h ago",  issues: 2, prs: 1, ci: "passing", health: "healthy"  },
  { id: "ooplix-infra",    name: "ooplix-infra",     lang: "Terraform", status: "not_indexed",coverage: 30, lastCommit: "3d ago",  issues: 11,prs: 0, ci: "failing", health: "critical" },
];

const SEED_REVIEWS = [
  { id: "rv1", file: "MemoryCenter.jsx:88",    finding: "_load called on every render. Move to useState initialiser or useRef to prevent re-computation.", severity: "warning",    pr: "Phase 9: AI OS", status: "open"     },
  { id: "rv2", file: "routes/webhooks.js:17",  finding: "Missing rate-limit middleware on inbound endpoint. Exploitable without throttle.", severity: "critical",   pr: "Webhook engine",  status: "open"     },
  { id: "rv3", file: "KnowledgeCenter.jsx:214",finding: "Consider memoising visibleDocs with useMemo to avoid re-filtering on every render.", severity: "suggestion", pr: "Phase 9: AI OS", status: "open"     },
  { id: "rv4", file: "auth/LoginPage.jsx:43",  finding: "Null check added correctly. Logic looks sound.", severity: "ok", pr: "Android crash fix",  status: "resolved"  },
  { id: "rv5", file: "agents/memory.cjs:12",   finding: "No issues found. Implementation is clean and follows existing patterns.", severity: "ok", pr: "Memory agent", status: "resolved"  },
];

const SEED_SERVICES = [
  { name: "AI Engine",   key: "ai",       icon: "◎", uptime: "99.1%", latency: "320ms", status: "online"   },
  { name: "WhatsApp",    key: "whatsapp", icon: "💬", uptime: "Active", latency: "220ms", status: "online"  },
  { name: "Razorpay",    key: "razorpay", icon: "💳", uptime: "—",     latency: "—",     status: "degraded" },
  { name: "Task Queue",  key: "queue",    icon: "⬟", uptime: "Active", latency: "—",     status: "online"   },
  { name: "Memory Store",key: "memory",   icon: "◈", uptime: "Active", latency: "12ms",  status: "online"   },
];

const PERF_ENDPOINTS = [
  { path: "POST /jarvis",          ms: 320, max: 1000 },
  { path: "GET  /crm",             ms: 45,  max: 1000 },
  { path: "POST /payment/link",    ms: 890, max: 1000 },
  { path: "GET  /billing/status",  ms: 30,  max: 1000 },
  { path: "GET  /ops",             ms: 18,  max: 1000 },
];

const SEED_TOOLS = [
  { id: "whatsapp", name: "WhatsApp",  icon: "💬", color: "#25d366", status: "active",  calls: 847, desc: "Send messages and follow-ups", errorRate: "0.2%" },
  { id: "razorpay", name: "Razorpay",  icon: "💳", color: "#f0b429", status: "degraded",calls: 0,   desc: "Payment link generation",      errorRate: "—"    },
  { id: "crm",      name: "CRM Query", icon: "◈",  color: "#7c6fff", status: "active",  calls: 312, desc: "Lead lookup and updates",      errorRate: "0.1%" },
  { id: "jarvis",   name: "Jarvis AI", icon: "◎",  color: "#4ecdc4", status: "active",  calls: 1204,desc: "Natural language processing",  errorRate: "0.4%" },
  { id: "queue",    name: "Task Queue",icon: "⬟",  color: "#52d68a", status: "active",  calls: 488, desc: "Task dispatch and scheduling", errorRate: "0.0%" },
  { id: "memory",   name: "Memory",    icon: "◉",  color: "#8994b0", status: "active",  calls: 203, desc: "Context read/write",           errorRate: "0.0%" },
  { id: "github",   name: "GitHub",    icon: "◉",  color: "#e6edf3", status: "active",  calls: 47,  desc: "Repo access, PRs, CI status",  errorRate: "0.4%" },
  { id: "notion",   name: "Notion",    icon: "N",  color: "#ffffff", status: "active",  calls: 18,  desc: "Pages read/write, databases",  errorRate: "0.0%" },
];

const INTEGRATIONS_CATALOG = [
  { id: "github",      name: "GitHub",          icon: "◉",  color: "#e6edf3", category: "engineering",    desc: "Repository access, PR reviews, CI status",      connected: true,  detail: "Connected Jun 3",    permissions: ["read_repos","write_code","read_ci"]    },
  { id: "whatsapp",    name: "WhatsApp Business",icon: "💬", color: "#25d366", category: "communication",  desc: "Send follow-ups and payment reminders",          connected: true,  detail: "Phone: +91-XXXXXXXXXX",  permissions: ["send_messages","read_status"]     },
  { id: "razorpay",    name: "Razorpay",         icon: "💳", color: "#f0b429", category: "payments",       desc: "Payment link generation",                        connected: true,  detail: "Auth error — check API keys", degraded: true, permissions: []                                  },
  { id: "firebase",    name: "Firebase",         icon: "🔥", color: "#ff9800", category: "infrastructure", desc: "Auth, Firestore, Analytics, FCM push",           connected: false, detail: null, permissions: [] },
  { id: "gmail",       name: "Gmail",            icon: "G",  color: "#ea4335", category: "communication",  desc: "Read and send email, manage contacts",           connected: false, detail: null, permissions: [] },
  { id: "gdrive",      name: "Google Drive",     icon: "▲",  color: "#fbbc04", category: "storage",        desc: "Files, docs, and reports",                       connected: false, detail: null, permissions: [] },
  { id: "slack",       name: "Slack",            icon: "#",  color: "#4a154b", category: "communication",  desc: "Post alerts and pipeline updates",               connected: false, detail: null, permissions: [] },
  { id: "notion",      name: "Notion",           icon: "N",  color: "#dde2ec", category: "knowledge",      desc: "Pages, databases, and knowledge base",           connected: true,  detail: "Connected May 28",   permissions: ["read_pages","write_pages"] },
  { id: "telegram",    name: "Telegram",         icon: "✈",  color: "#2ca5e0", category: "communication",  desc: "Bot messaging and notification channels",        connected: false, detail: null, permissions: [] },
  { id: "razorpay_x",  name: "RazorpayX",        icon: "💸", color: "#3395ff", category: "payments",       desc: "Payouts, current accounts, business banking",   connected: false, detail: null, permissions: [] },
];

// ── Helpers ───────────────────────────────────────────────────────────

function _timeAgo(iso) {
  if (!iso) return "—";
  try {
    const diff = Math.floor((Date.now() - new Date(iso)) / 1000);
    if (diff < 60)    return `${diff}s ago`;
    if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  } catch { return "—"; }
}

function Toast({ msg, type, onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 3500); return () => clearTimeout(t); }, [onDone]);
  return <div className={`dcv2-toast dcv2-toast--${type}`}>{msg}</div>;
}

function SkelLine({ w = "100%", h = 12 }) {
  return <span className="dcv2-skeleton" style={{ width: w, height: h, borderRadius: 4, display: "block" }} />;
}

// ── Tab: Copilot Chat ─────────────────────────────────────────────────

const CHAT_KEY = "dcv2_chat_history";
function _loadChat() { try { return JSON.parse(localStorage.getItem(CHAT_KEY) || "[]"); } catch { return []; } }
function _saveChat(msgs) { try { localStorage.setItem(CHAT_KEY, JSON.stringify(msgs.slice(-60))); } catch {} }

function TabCopilot({ addToast }) {
  const [messages, setMessages] = useState(_loadChat);
  const [input,    setInput]    = useState("");
  const [thinking, setThinking] = useState(false);
  const [online,   setOnline]   = useState(true);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { checkHealth().then(r => setOnline(!!r?.online)).catch(() => setOnline(false)); }, []);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, thinking]);
  useEffect(() => { _saveChat(messages); }, [messages]);

  function _ts() { return new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }); }

  async function handleSend(text) {
    const q = (text || input).trim();
    if (!q || thinking) return;
    setInput("");
    const userMsg = { id: Date.now(), role: "user", text: q, ts: _ts() };
    setMessages(prev => [...prev, userMsg]);
    setThinking(true);
    try {
      const r = await sendMessage(q, "code");
      const reply = r?.reply || r?.output || r?.text || "No response from Copilot.";
      setMessages(prev => [...prev, { id: Date.now() + 1, role: "jarvis", text: reply, ts: _ts() }]);
    } catch (e) {
      setMessages(prev => [...prev, { id: Date.now() + 1, role: "jarvis", text: `Error: ${e.message}`, ts: _ts(), error: true }]);
    } finally {
      setThinking(false);
    }
  }

  function handleKey(e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  const hasMessages = messages.length > 0;

  return (
    <div className="dcv2-chat-root">
      <div className="dcv2-chat-topbar">
        <div className="dcv2-chat-ident">
          <span className="dcv2-chat-avatar">⬟</span>
          <div>
            <p className="dcv2-chat-title">Developer Copilot</p>
            <p className="dcv2-chat-sub">AI-assisted code review · Architecture · Debugging</p>
          </div>
        </div>
        <div className="dcv2-chat-status">
          <span className={`dcv2-status-dot dcv2-status-dot--${online ? "ok" : "off"}`} />
          <span className="dcv2-status-label">{online ? "Online" : "Offline"}</span>
          {hasMessages && (
            <button className="dcv2-clear-btn" onClick={() => { setMessages([]); _saveChat([]); }}>Clear</button>
          )}
        </div>
      </div>

      <div className="dcv2-chat-messages">
        {!hasMessages && (
          <div className="dcv2-chat-welcome">
            <span className="dcv2-welcome-icon">⬟</span>
            <p className="dcv2-welcome-title">Developer Copilot ready</p>
            <p className="dcv2-welcome-sub">I can help with code review, architecture decisions, debugging, API design, and performance analysis.</p>
          </div>
        )}
        {messages.map(m => (
          <div key={m.id} className={`dcv2-msg dcv2-msg--${m.role}`}>
            <span className="dcv2-msg-avatar">
              {m.role === "user" ? "◎" : "⬟"}
            </span>
            <div className={`dcv2-msg-bubble${m.error ? " dcv2-msg-bubble--error" : ""}`}>
              <p className="dcv2-msg-text">{m.text}</p>
              <span className="dcv2-msg-ts">{m.ts}</span>
            </div>
          </div>
        ))}
        {thinking && (
          <div className="dcv2-msg dcv2-msg--jarvis">
            <span className="dcv2-msg-avatar">⬟</span>
            <div className="dcv2-msg-bubble dcv2-msg-bubble--thinking">
              <div className="dcv2-thinking-dots">
                <span /><span /><span />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {!hasMessages && (
        <div className="dcv2-suggestions">
          {COPILOT_PROMPTS.map(p => (
            <button key={p} className="dcv2-suggestion" onClick={() => handleSend(p)}>{p}</button>
          ))}
        </div>
      )}

      <div className="dcv2-chat-input-row">
        <textarea
          ref={inputRef}
          className="dcv2-chat-input"
          rows={1}
          placeholder="Ask Copilot about your code, architecture, or errors…"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          disabled={thinking}
        />
        <button
          className="dcv2-chat-send"
          onClick={() => handleSend()}
          disabled={!input.trim() || thinking}
        >
          {thinking ? "⟳" : "▶"}
        </button>
      </div>
    </div>
  );
}

// ── Tab: Repository Intelligence ──────────────────────────────────────

const LANG_COLORS = { "Node.js": "#68a063", React: "#61dafb", Capacitor: "#119eff", CJS: "#f7df1e", Terraform: "#7b42bc", Dart: "#00b4ab", Python: "#3572a5", Go: "#00add8" };

function TabRepos({ addToast }) {
  const [repos,    setRepos]    = useState(SEED_REPOS);
  const [search,   setSearch]   = useState("");
  const [loading,  setLoading]  = useState(true);
  const [analyzing, setAnalyzing] = useState(null);
  const [searchQ,  setSearchQ]  = useState("");
  const [searchResults, setSearchResults] = useState(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    listIndexedRepos().then(r => {
      const arr = Array.isArray(r) ? r : (r?.repos || r?.items || []);
      if (arr.length > 0) setRepos(arr);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const filtered = repos.filter(r => !search || r.name.toLowerCase().includes(search.toLowerCase()) || (r.lang || "").toLowerCase().includes(search.toLowerCase()));

  const HEALTH_CHIP = { healthy: "dcv2-chip--ok", warning: "dcv2-chip--warn", critical: "dcv2-chip--error" };
  const CI_CHIP     = { passing: "dcv2-chip--ok", failing: "dcv2-chip--error" };

  async function handleAnalyze(repo) {
    if (analyzing) return;
    setAnalyzing(repo.id);
    try {
      const r = await sendMessage(`analyze repo ${repo.name}`, "code");
      addToast(`Analysis started for ${repo.name}`, "success");
      track("repo_analyze", { name: repo.name });
    } catch (e) {
      addToast(`Analysis failed: ${e.message}`, "error");
    } finally {
      setAnalyzing(null);
    }
  }

  async function handleSearch() {
    if (!searchQ.trim() || searching) return;
    setSearching(true);
    try {
      const firstRepo = repos[0];
      const r = await semanticSearch(firstRepo?.id || "ooplix-backend", searchQ.trim());
      const hits = Array.isArray(r) ? r : (r?.results || r?.matches || []);
      setSearchResults({ query: searchQ, hits });
      track("repo_search", { q: searchQ });
    } catch {
      setSearchResults({ query: searchQ, hits: [] });
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="dcv2-repos-root">
      <div className="dcv2-repos-toolbar">
        <div className="dcv2-search-wrap">
          <span className="dcv2-search-icon">🔍</span>
          <input
            className="dcv2-search"
            placeholder="Search repositories…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="dcv2-semantic-search">
        <div className="dcv2-sem-row">
          <input
            className="dcv2-sem-input"
            placeholder="Semantic code search across all repos… (e.g. 'where is auth handled?')"
            value={searchQ}
            onChange={e => setSearchQ(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSearch()}
            disabled={searching}
          />
          <button className="dcv2-sem-btn" onClick={handleSearch} disabled={!searchQ.trim() || searching}>
            {searching ? "⟳" : "Search"}
          </button>
        </div>
        {searchResults && (
          <div className="dcv2-sem-results">
            <p className="dcv2-sem-count">{searchResults.hits.length} result{searchResults.hits.length !== 1 ? "s" : ""} for "{searchResults.query}"</p>
            {searchResults.hits.length === 0 ? (
              <p className="dcv2-sem-empty">No matches found. Try different keywords.</p>
            ) : (
              searchResults.hits.map((h, i) => (
                <div key={i} className="dcv2-sem-hit">
                  <span className="dcv2-sem-file">{h.file || h.path || "unknown"}</span>
                  <p className="dcv2-sem-snippet">{h.snippet || h.content || h.text || JSON.stringify(h)}</p>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {loading ? (
        <div className="dcv2-repo-list">
          {[0,1,2].map(i => (
            <div key={i} className="dcv2-repo-card">
              <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
                <SkelLine w="40%" h={14} />
                <SkelLine w="65%" h={11} />
                <SkelLine w="50%" h={11} />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="dcv2-empty">
          <span className="dcv2-empty-icon">◎</span>
          <p className="dcv2-empty-title">Repository tracking <span className="csb-beta-badge">BETA</span></p>
          <p className="dcv2-empty-sub">Link your repositories to enable AI code review and analysis.</p>
        </div>
      ) : (
        <div className="dcv2-repo-list">
          {filtered.map(repo => {
            const lc = LANG_COLORS[repo.lang] || "#8994b0";
            const hcls = HEALTH_CHIP[repo.health] || "dcv2-chip--warn";
            const ccls = CI_CHIP[repo.ci] || "dcv2-chip--error";
            return (
              <div key={repo.id} className="dcv2-repo-card">
                <div className="dcv2-repo-top">
                  <span className="dcv2-lang-dot" style={{ background: lc }} />
                  <div className="dcv2-repo-ident">
                    <span className="dcv2-repo-name">{repo.name}</span>
                    <span className="dcv2-repo-lang" style={{ color: lc }}>{repo.lang}</span>
                  </div>
                  <span className={`dcv2-chip ${hcls}`}>{repo.health || "unknown"}</span>
                </div>
                <div className="dcv2-repo-metrics">
                  <span className="dcv2-rm-item">Coverage: <strong>{repo.coverage}%</strong></span>
                  <span className="dcv2-rm-sep">·</span>
                  <span className="dcv2-rm-item">Issues: <strong>{repo.issues}</strong></span>
                  <span className="dcv2-rm-sep">·</span>
                  <span className="dcv2-rm-item">PRs: <strong>{repo.prs}</strong></span>
                  <span className="dcv2-rm-sep">·</span>
                  <span className="dcv2-rm-item">Last: <strong>{repo.lastCommit}</strong></span>
                  <span className="dcv2-rm-sep">·</span>
                  <span className={`dcv2-chip ${ccls} dcv2-chip--xs`}>CI {repo.ci}</span>
                </div>
                <div className="dcv2-repo-actions">
                  <button
                    className="dcv2-btn dcv2-btn--ghost dcv2-btn--sm"
                    onClick={() => handleAnalyze(repo)}
                    disabled={analyzing === repo.id}
                  >
                    {analyzing === repo.id ? "⟳ Analyzing…" : "Analyze"}
                  </button>
                  <button
                    className="dcv2-btn dcv2-btn--ghost dcv2-btn--sm"
                    onClick={async () => {
                      addToast(`Code review requested for ${repo.name}`, "info");
                      await sendMessage(`code review ${repo.name}`, "code").catch(() => {});
                    }}
                  >
                    Review →
                  </button>
                  <span className={`dcv2-chip ${repo.status === "indexed" ? "dcv2-chip--ok" : "dcv2-chip--idle"} dcv2-chip--xs`}>
                    {repo.status === "indexed" ? "indexed" : "not indexed"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Tab: Code Review ──────────────────────────────────────────────────

const SEV_META = {
  critical:   { label: "critical",   cls: "dcv2-sev--critical",  color: "#f55b5b" },
  warning:    { label: "warning",    cls: "dcv2-sev--warning",   color: "#f0b429" },
  suggestion: { label: "suggestion", cls: "dcv2-sev--suggestion",color: "#4ecdc4" },
  ok:         { label: "ok",         cls: "dcv2-sev--ok",        color: "#52d68a" },
};

function TabReview({ addToast }) {
  const [reviews,  setReviews]  = useState(SEED_REVIEWS);
  const [prInput,  setPrInput]  = useState("");
  const [running,  setRunning]  = useState(false);
  const [sevF,     setSevF]     = useState("all");

  const filtered = reviews.filter(r => sevF === "all" || r.severity === sevF);

  async function handleReview() {
    if (!prInput.trim() || running) return;
    setRunning(true);
    try {
      const r = await sendMessage(`code review: ${prInput.trim()}`, "code");
      const reply = r?.reply || r?.output || "";
      if (reply) {
        setReviews(prev => [{
          id: `rv${Date.now()}`,
          file: prInput.trim(),
          finding: reply.slice(0, 200),
          severity: "suggestion",
          pr: prInput.trim(),
          status: "open",
        }, ...prev]);
        addToast("AI review completed", "success");
      } else {
        addToast("Review returned no findings", "info");
      }
      setPrInput("");
      track("code_review_ai");
    } catch (e) {
      addToast(`Review failed: ${e.message}`, "error");
    } finally {
      setRunning(false);
    }
  }

  const counts = { critical: 0, warning: 0, suggestion: 0, ok: 0 };
  reviews.filter(r => r.status === "open").forEach(r => { if (counts[r.severity] !== undefined) counts[r.severity]++; });

  return (
    <div className="dcv2-review-root">
      <div className="dcv2-coming-soon">
        <span className="dcv2-coming-icon">◈</span>
        <div>
          <p className="dcv2-coming-title">Automated PR Code Review <span className="csb-beta-badge">BETA</span></p>
          <p className="dcv2-coming-sub">Connect GitHub/GitLab to enable PR-level AI review, security scanning, and architecture analysis. Use the AI reviewer below for on-demand review.</p>
        </div>
      </div>

      <div className="dcv2-review-summary">
        {Object.entries(counts).map(([sev, count]) => (
          <div key={sev} className="dcv2-rs-cell" style={{ borderColor: SEV_META[sev].color + "30" }}>
            <span className="dcv2-rs-val" style={{ color: SEV_META[sev].color }}>{count}</span>
            <span className="dcv2-rs-label">{sev}</span>
          </div>
        ))}
      </div>

      <div className="dcv2-review-input-section">
        <p className="dcv2-section-label">AI Code Review</p>
        <div className="dcv2-review-input-row">
          <input
            className="dcv2-search"
            placeholder="Paste code snippet, file path, or describe what to review…"
            value={prInput}
            onChange={e => setPrInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleReview()}
            disabled={running}
            style={{ flex: 1 }}
          />
          <button className="dcv2-btn dcv2-btn--primary dcv2-btn--sm" onClick={handleReview} disabled={!prInput.trim() || running}>
            {running ? "⟳ Reviewing…" : "Review"}
          </button>
        </div>
      </div>

      <div className="dcv2-review-filter">
        {["all", "critical", "warning", "suggestion", "ok"].map(s => (
          <button key={s} className={`dcv2-filter-chip${sevF === s ? " dcv2-filter-chip--active" : ""}`} onClick={() => setSevF(s)}>{s}</button>
        ))}
      </div>

      <div className="dcv2-review-list">
        {filtered.length === 0 ? (
          <div className="dcv2-empty"><span className="dcv2-empty-icon" style={{ color: "#52d68a" }}>✓</span><p className="dcv2-empty-title">No findings</p></div>
        ) : (
          filtered.map(r => {
            const sm = SEV_META[r.severity] || SEV_META.suggestion;
            return (
              <div key={r.id} className="dcv2-review-row">
                <span className={`dcv2-sev-chip ${sm.cls}`}>{sm.label}</span>
                <div className="dcv2-rv-body">
                  <span className="dcv2-rv-file">{r.file}</span>
                  <p className="dcv2-rv-finding">{r.finding}</p>
                  <span className="dcv2-rv-pr">PR: {r.pr}</span>
                </div>
                <span className={`dcv2-chip dcv2-chip--xs ${r.status === "resolved" ? "dcv2-chip--ok" : "dcv2-chip--idle"}`}>{r.status}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── Tab: Architecture ─────────────────────────────────────────────────

const ARCH_SERVICES = [
  { name: "Frontend (React)",     type: "client",   health: "ok",   risk: "low",    depends: ["backend"],         size: 421  },
  { name: "Backend (Express)",    type: "server",   health: "ok",   risk: "medium", depends: ["db","whatsapp","razorpay","redis"], size: 284 },
  { name: "Agents Runtime",       type: "runtime",  health: "ok",   risk: "medium", depends: ["backend","openrouter"],            size: 190 },
  { name: "WhatsApp Bridge",      type: "service",  health: "ok",   risk: "high",   depends: ["backend"],         size: 62   },
  { name: "Razorpay Gateway",     type: "service",  health: "warn", risk: "high",   depends: ["backend"],         size: 28   },
  { name: "OpenRouter / Claude",  type: "external", health: "ok",   risk: "medium", depends: [],                  size: null },
  { name: "MongoDB / Data Files", type: "data",     health: "ok",   risk: "low",    depends: [],                  size: null },
  { name: "Electron Shell",       type: "shell",    health: "ok",   risk: "low",    depends: ["frontend","backend"],size: null },
];

const RISK_COLORS = { low: "#52d68a", medium: "#f0b429", high: "#f55b5b" };
const H_COLORS    = { ok: "#52d68a", warn: "#f0b429", error: "#f55b5b" };

function TabArchitecture({ addToast }) {
  const [selected, setSelected] = useState(null);
  const [asking,   setAsking]   = useState(false);
  const [arcQ,     setArcQ]     = useState("");
  const [arcAns,   setArcAns]   = useState(null);

  async function handleAsk() {
    if (!arcQ.trim() || asking) return;
    setAsking(true);
    try {
      const r = await sendMessage(`architecture advisor: ${arcQ.trim()}`, "code");
      setArcAns(r?.reply || r?.output || "No response from advisor.");
      track("arch_ask");
    } catch (e) {
      setArcAns(`Error: ${e.message}`);
    } finally {
      setAsking(false);
    }
  }

  const overallScore = Math.round((ARCH_SERVICES.filter(s => s.health === "ok").length / ARCH_SERVICES.length) * 100);

  return (
    <div className="dcv2-arch-root">
      <div className="dcv2-coming-soon">
        <span className="dcv2-coming-icon">⬡</span>
        <div>
          <p className="dcv2-coming-title">Architecture Advisor <span className="csb-beta-badge">BETA</span></p>
          <p className="dcv2-coming-sub">Upload your codebase schema or describe your architecture. Jarvis will identify bottlenecks and suggest improvements. Ask the advisor below.</p>
        </div>
      </div>

      <div className="dcv2-arch-score">
        <div className="dcv2-score-ring">
          <span className="dcv2-score-val" style={{ color: overallScore >= 80 ? "#52d68a" : overallScore >= 60 ? "#f0b429" : "#f55b5b" }}>{overallScore}</span>
          <span className="dcv2-score-label">Health Score</span>
        </div>
        <div className="dcv2-score-breakdown">
          <p className="dcv2-sb-title">Service Map</p>
          <p className="dcv2-sb-sub">{ARCH_SERVICES.length} services · {ARCH_SERVICES.filter(s => s.health === "ok").length} healthy · {ARCH_SERVICES.filter(s => s.health !== "ok").length} degraded</p>
        </div>
      </div>

      <div className="dcv2-arch-map">
        {ARCH_SERVICES.map(svc => (
          <div
            key={svc.name}
            className={`dcv2-arch-node${selected === svc.name ? " dcv2-arch-node--selected" : ""}`}
            style={{ borderColor: selected === svc.name ? H_COLORS[svc.health] + "50" : undefined }}
            onClick={() => setSelected(v => v === svc.name ? null : svc.name)}
          >
            <div className="dcv2-an-top">
              <span className="dcv2-an-dot" style={{ background: H_COLORS[svc.health] }} />
              <span className="dcv2-an-name">{svc.name}</span>
              <span className="dcv2-an-type">{svc.type}</span>
            </div>
            <div className="dcv2-an-meta">
              <span className="dcv2-risk-chip" style={{ color: RISK_COLORS[svc.risk], background: RISK_COLORS[svc.risk] + "18" }}>risk: {svc.risk}</span>
              {svc.size && <span className="dcv2-an-size">{svc.size} kB</span>}
            </div>
            {selected === svc.name && svc.depends.length > 0 && (
              <div className="dcv2-an-deps">
                <span className="dcv2-an-dep-label">Depends on: </span>
                {svc.depends.map(d => <span key={d} className="dcv2-dep-tag">{d}</span>)}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="dcv2-arch-qa">
        <p className="dcv2-section-label">Ask the Architecture Advisor</p>
        <div className="dcv2-arch-input-row">
          <input
            className="dcv2-search"
            placeholder="e.g. 'What are the bottlenecks?' or 'How do I scale the agent runtime?'"
            value={arcQ}
            onChange={e => setArcQ(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleAsk()}
            disabled={asking}
            style={{ flex: 1 }}
          />
          <button className="dcv2-btn dcv2-btn--primary dcv2-btn--sm" onClick={handleAsk} disabled={!arcQ.trim() || asking}>
            {asking ? "⟳" : "Ask"}
          </button>
        </div>
        {arcAns && (
          <div className="dcv2-arch-answer">
            <p className="dcv2-arch-answer-text">{arcAns}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tab: Engineering Health ───────────────────────────────────────────

function TabHealth({ addToast }) {
  const [health,   setHealth]   = useState(null);
  const [ops,      setOps]      = useState(null);
  const [metrics,  setMetrics]  = useState(null);
  const [history,  setHistory]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [subTab,   setSubTab]   = useState("overview");

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getHealth().catch(() => null),
      getOpsData().catch(() => null),
      getMetrics().catch(() => null),
      getRuntimeHistory(20).catch(() => []),
    ]).then(([h, o, m, hist]) => {
      setHealth(h);
      setOps(o);
      setMetrics(m);
      const arr = Array.isArray(hist) ? hist : (hist?.history || []);
      setHistory(arr.filter(i => i.status === "failed" || i.status === "error"));
    }).finally(() => setLoading(false));
  }, []);

  const q = ops?.queue || {};
  const uptimeSecs = ops?.uptime ?? 0;
  const uptimeH = Math.floor(uptimeSecs / 3600);
  const uptimeM = Math.floor((uptimeSecs % 3600) / 60);
  const memUsed = ops?.memory?.used ?? metrics?.memory_mb ?? null;
  const avgMs   = metrics?.avg_response_ms ?? null;

  const services = (health?.services || ops?.services || SEED_SERVICES).slice(0, 6);

  const HEALTH_SUB_TABS = ["overview", "performance", "self-healing"];

  return (
    <div className="dcv2-health-root">
      <div className="dcv2-hsub">
        {HEALTH_SUB_TABS.map(t => (
          <button key={t} className={`dcv2-hsub-tab${subTab === t ? " dcv2-hsub-tab--active" : ""}`} onClick={() => setSubTab(t)}>
            {t}
          </button>
        ))}
      </div>

      {subTab === "overview" && (
        <div className="dcv2-health-overview">
          <div className="dcv2-kpi-row">
            <div className="dcv2-kpi">
              <span className="dcv2-kpi-icon">⬡</span>
              <span className="dcv2-kpi-label">Uptime</span>
              <span className="dcv2-kpi-val" style={{ color: "#52d68a" }}>{uptimeSecs > 0 ? `${uptimeH}h ${uptimeM}m` : "—"}</span>
            </div>
            <div className="dcv2-kpi">
              <span className="dcv2-kpi-icon">◈</span>
              <span className="dcv2-kpi-label">Memory</span>
              <span className="dcv2-kpi-val">{memUsed ? `${memUsed} MB` : "—"}</span>
            </div>
            <div className="dcv2-kpi">
              <span className="dcv2-kpi-icon">◎</span>
              <span className="dcv2-kpi-label">Avg Response</span>
              <span className="dcv2-kpi-val">{avgMs ? `${avgMs}ms` : "—"}</span>
            </div>
            <div className="dcv2-kpi">
              <span className="dcv2-kpi-icon">●</span>
              <span className="dcv2-kpi-label">Running</span>
              <span className="dcv2-kpi-val" style={{ color: "#7c6fff" }}>{q.running ?? "—"}</span>
            </div>
          </div>

          <div className="dcv2-services-panel">
            <p className="dcv2-section-label">Services</p>
            {(loading ? SEED_SERVICES : services).map(svc => {
              const s = typeof svc === "string" ? { name: svc, status: "online" } : svc;
              const sc = s.status === "online" || s.status === "active" ? "#52d68a" : s.status === "degraded" ? "#f0b429" : "#f55b5b";
              return (
                <div key={s.name || s.key} className="dcv2-svc-row">
                  <span className="dcv2-svc-dot" style={{ background: sc }} />
                  <span className="dcv2-svc-name">{s.name || s.key}</span>
                  <span className="dcv2-svc-status" style={{ color: sc }}>{s.status?.toUpperCase() || "UNKNOWN"}</span>
                  {s.uptime && <span className="dcv2-svc-uptime">{s.uptime}</span>}
                  {s.latency && <span className="dcv2-svc-lat">{s.latency}</span>}
                </div>
              );
            })}
          </div>

          {history.length > 0 && (
            <div className="dcv2-errors-panel">
              <p className="dcv2-section-label">Recent Errors</p>
              {history.slice(0, 5).map((e, i) => (
                <div key={e.id || i} className="dcv2-err-row">
                  <span className="dcv2-err-ts">{_timeAgo(e.timestamp || e.createdAt)}</span>
                  <span className="dcv2-err-msg">{e.input || e.goal || e.error || "Unknown error"}</span>
                  <span className="dcv2-err-badge">ERROR</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {subTab === "performance" && (
        <div className="dcv2-perf-root">
          <p className="dcv2-section-label">Endpoint Response Times (avg, last 1h)</p>
          {PERF_ENDPOINTS.map(ep => {
            const pct = Math.min(Math.round((ep.ms / ep.max) * 100), 100);
            const color = ep.ms < 200 ? "#52d68a" : ep.ms < 600 ? "#f0b429" : "#f55b5b";
            return (
              <div key={ep.path} className="dcv2-perf-row">
                <span className="dcv2-perf-path">{ep.path}</span>
                <div className="dcv2-perf-bar-wrap">
                  <div className="dcv2-perf-track">
                    <div className="dcv2-perf-fill" style={{ width: `${pct}%`, background: color }} />
                  </div>
                </div>
                <span className="dcv2-perf-ms" style={{ color }}>{ep.ms}ms</span>
              </div>
            );
          })}
          <div className="dcv2-coming-soon" style={{ marginTop: 12 }}>
            <span className="dcv2-coming-icon">◎</span>
            <div>
              <p className="dcv2-coming-title">Historical Performance Charts <span className="csb-beta-badge">BETA</span></p>
              <p className="dcv2-coming-sub">Time-series latency graphs and percentile analysis are under development.</p>
            </div>
          </div>
        </div>
      )}

      {subTab === "self-healing" && (
        <div className="dcv2-heal-root">
          <div className="dcv2-heal-list">
            {[
              { title: "Agent restart monitor",        status: "ACTIVE",     detail: "Restarts crashed agents automatically",                  stat: "24 restarts prevented this week" },
              { title: "Task retry on failure",        status: "ACTIVE",     detail: "Failed tasks retried up to 3× before dead-letter queue",  stat: "12 tasks recovered this week"    },
              { title: "Dead-letter queue",            status: "ACTIVE",     detail: "Unprocessable tasks stored in data/dead-letter.json",     stat: "4 items in DLQ"                 },
              { title: "Renderer crash recovery",      status: "MONITORING", detail: "Electron renderer auto-reloads on crash",                 stat: "Electron only"                  },
            ].map(item => (
              <div key={item.title} className="dcv2-heal-card">
                <div className="dcv2-heal-top">
                  <span className="dcv2-heal-dot" style={{ color: item.status === "ACTIVE" ? "#52d68a" : "#f0b429" }}>●</span>
                  <span className="dcv2-heal-title">{item.title}</span>
                  <span className="dcv2-heal-status" style={{ color: item.status === "ACTIVE" ? "#52d68a" : "#f0b429" }}>{item.status}</span>
                </div>
                <p className="dcv2-heal-detail">{item.detail}</p>
                <span className="dcv2-heal-stat">{item.stat}</span>
              </div>
            ))}
          </div>

          <div className="dcv2-heal-events">
            <p className="dcv2-section-label">Recovery Events (last 7 days)</p>
            {[
              { ts: "Jun 6", event: "Agent jarvis-core restarted after crash",    outcome: "RECOVERED",    ok: true  },
              { ts: "Jun 4", event: "Task retried 3× — moved to dead-letter queue",outcome: "DEAD LETTER",  ok: false },
              { ts: "Jun 3", event: "Renderer crash #2 — auto-reloaded",           outcome: "RECOVERED",    ok: true  },
            ].map((ev, i) => (
              <div key={i} className="dcv2-ev-row">
                <span className="dcv2-ev-ts">{ev.ts}</span>
                <span className="dcv2-ev-msg">{ev.event}</span>
                <span className={`dcv2-chip dcv2-chip--xs ${ev.ok ? "dcv2-chip--ok" : "dcv2-chip--error"}`}>{ev.outcome}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab: Integrations ─────────────────────────────────────────────────

function TabIntegrations({ addToast, onNavigate }) {
  const [connections, setConnections] = useState(null);
  const [oauthStatus, setOAuthStatus] = useState(null);
  const [filterTab,   setFilterTab]   = useState("all");
  const [revoking,    setRevoking]    = useState(null);
  const [connecting,  setConnecting]  = useState(null);

  useEffect(() => {
    Promise.all([
      listOAuthConnections().catch(() => null),
      getOAuthProviderStatus().catch(() => null),
    ]).then(([conns, status]) => {
      setConnections(Array.isArray(conns) ? conns : (conns?.connections || null));
      setOAuthStatus(status);
    });
  }, []);

  function _isConnected(intg) {
    if (connections) {
      return connections.some(c => c.provider === intg.id || c.id === intg.id);
    }
    return intg.connected;
  }
  function _isDegraded(intg) { return intg.degraded; }

  const shown = INTEGRATIONS_CATALOG.filter(i => {
    if (filterTab === "connected") return _isConnected(i);
    if (filterTab === "available") return !_isConnected(i);
    return true;
  });

  async function handleConnect(intg) {
    if (connecting) return;
    setConnecting(intg.id);
    try {
      const r = await getOAuthUrl(intg.id);
      if (r?.url) window.open(r.url, "_blank");
      else addToast(`OAuth URL not configured for ${intg.name}`, "info");
    } catch { addToast(`Could not get OAuth URL for ${intg.name}`, "error"); }
    finally   { setConnecting(null); }
  }

  async function handleRevoke(intg) {
    if (revoking) return;
    setRevoking(intg.id);
    try {
      await revokeOAuth(intg.id);
      addToast(`${intg.name} disconnected`, "info");
      const updated = INTEGRATIONS_CATALOG.map(i => i.id === intg.id ? { ...i, connected: false } : i);
      track("integration_revoke", { provider: intg.id });
    } catch (e) { addToast(`Could not disconnect: ${e.message}`, "error"); }
    finally     { setRevoking(null); }
  }

  const FILTER_TABS = ["all", "connected", "available"];

  return (
    <div className="dcv2-integ-root">
      <div className="dcv2-integ-filter">
        {FILTER_TABS.map(f => (
          <button key={f} className={`dcv2-filter-chip${filterTab === f ? " dcv2-filter-chip--active" : ""}`} onClick={() => setFilterTab(f)}>{f}</button>
        ))}
      </div>

      <div className="dcv2-integ-list">
        {shown.map(intg => {
          const connected = _isConnected(intg);
          const degraded  = _isDegraded(intg);
          const statusColor = degraded ? "#f0b429" : connected ? "#52d68a" : "#4a5470";
          const statusLabel = degraded ? "DEGRADED" : connected ? "CONNECTED" : "NOT CONNECTED";

          return (
            <div key={intg.id} className={`dcv2-integ-card${degraded ? " dcv2-integ-card--degraded" : ""}`}>
              <div className="dcv2-ic-top">
                <span className="dcv2-ic-icon" style={{ color: intg.color, background: intg.color + "18" }}>{intg.icon}</span>
                <div className="dcv2-ic-ident">
                  <span className="dcv2-ic-name">{intg.name}</span>
                  <span className="dcv2-ic-cat">{intg.category}</span>
                </div>
                <span className="dcv2-ic-status" style={{ color: statusColor, background: statusColor + "15" }}>{statusLabel}</span>
              </div>
              <p className="dcv2-ic-desc">{intg.desc}</p>
              {intg.detail && <p className="dcv2-ic-detail" style={{ color: degraded ? "#f0b429" : "#4a5470" }}>{intg.detail}</p>}
              <div className="dcv2-ic-actions">
                {connected && !degraded && (
                  <>
                    <button className="dcv2-btn dcv2-btn--ghost dcv2-btn--sm" onClick={() => addToast("Configuration coming soon", "info")}>Configure</button>
                    <button className="dcv2-btn dcv2-btn--ghost dcv2-btn--sm" onClick={() => handleRevoke(intg)} disabled={revoking === intg.id}>{revoking === intg.id ? "Disconnecting…" : "Disconnect"}</button>
                  </>
                )}
                {degraded && (
                  <button className="dcv2-btn dcv2-btn--ghost dcv2-btn--sm" onClick={() => onNavigate?.("settings")}>Fix credentials →</button>
                )}
                {!connected && !degraded && (
                  <button className="dcv2-btn dcv2-btn--primary dcv2-btn--sm" onClick={() => handleConnect(intg)} disabled={connecting === intg.id}>
                    {connecting === intg.id ? "Opening…" : "Connect"}
                  </button>
                )}
                {intg.permissions.length > 0 && (
                  <div className="dcv2-ic-perms">
                    {intg.permissions.slice(0, 3).map(p => <span key={p} className="dcv2-perm-tag">{p}</span>)}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="dcv2-api-keys-note">
        <p className="dcv2-akn-title">API Keys</p>
        <p className="dcv2-akn-body">Manage API keys (Razorpay, OpenRouter, Telegram) in your server's <code>.env</code> file. <button className="dcv2-link" onClick={() => onNavigate?.("settings")}>Open Settings →</button></p>
      </div>
    </div>
  );
}

// ── Tab: Tool Fabric ──────────────────────────────────────────────────

function TabTools({ addToast }) {
  const [tools,    setTools]    = useState(SEED_TOOLS);
  const [liveTools,setLiveTools]= useState(null);
  const [execId,   setExecId]   = useState(null);
  const [execInput,setExecInput]= useState("");
  const [execRes,  setExecRes]  = useState(null);
  const [history,  setHistory]  = useState([]);
  const [showExec, setShowExec] = useState(null);

  useEffect(() => {
    Promise.all([
      listTools().catch(() => null),
      toolStatus().catch(() => null),
    ]).then(([list, status]) => {
      if (Array.isArray(list) && list.length > 0) setLiveTools(list);
    });
  }, []);

  const displayTools = (liveTools || tools);
  const activeCount = displayTools.filter(t => t.status === "active").length;

  async function handleExec(tool) {
    if (!execInput.trim() || execId) return;
    setExecId(tool.id);
    try {
      const r = await executeTool(tool.id, execInput.trim());
      const result = r?.output || r?.result || r?.data || JSON.stringify(r);
      const entry = { tool: tool.name, input: execInput.trim(), result: typeof result === "string" ? result : JSON.stringify(result), ts: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) };
      setHistory(prev => [entry, ...prev.slice(0, 9)]);
      setExecRes(entry);
      addToast(`Tool "${tool.name}" executed`, "success");
      track("tool_execute", { toolId: tool.id });
    } catch (e) {
      addToast(`Tool execution failed: ${e.message}`, "error");
      setExecRes({ tool: tool.name, input: execInput.trim(), result: `Error: ${e.message}`, ts: "—" });
    } finally {
      setExecId(null);
    }
  }

  return (
    <div className="dcv2-tools-root">
      <div className="dcv2-tools-header">
        <div className="dcv2-tools-count">
          <span className="dcv2-tc-val">{displayTools.length}</span>
          <span className="dcv2-tc-label">Total Tools</span>
        </div>
        <div className="dcv2-tools-count">
          <span className="dcv2-tc-val" style={{ color: "#52d68a" }}>{activeCount}</span>
          <span className="dcv2-tc-label">Active</span>
        </div>
        <div className="dcv2-tools-count">
          <span className="dcv2-tc-val" style={{ color: "#f0b429" }}>{displayTools.filter(t => t.status === "degraded").length}</span>
          <span className="dcv2-tc-label">Degraded</span>
        </div>
      </div>

      <div className="dcv2-tool-grid">
        {displayTools.map(tool => {
          const sc = tool.status === "active" ? "#52d68a" : tool.status === "degraded" ? "#f0b429" : "#4a5470";
          return (
            <div
              key={tool.id}
              className={`dcv2-tool-card${showExec === tool.id ? " dcv2-tool-card--open" : ""}`}
              style={{ borderColor: showExec === tool.id ? tool.color + "40" : undefined }}
            >
              <div className="dcv2-tc-top">
                <span className="dcv2-tc-icon" style={{ color: tool.color }}>{tool.icon}</span>
                <div className="dcv2-tc-ident">
                  <span className="dcv2-tc-name">{tool.name}</span>
                  <span className="dcv2-tc-desc">{tool.desc}</span>
                </div>
                <span className="dcv2-tc-status-dot" style={{ background: sc }} />
              </div>
              <div className="dcv2-tc-stats">
                <span className="dcv2-tc-stat">{tool.calls?.toLocaleString() || 0} calls</span>
                <span className="dcv2-tc-sep">·</span>
                <span className="dcv2-tc-stat">err: {tool.errorRate || "—"}</span>
              </div>
              <div className="dcv2-tc-actions">
                <button
                  className="dcv2-btn dcv2-btn--ghost dcv2-btn--sm"
                  disabled={tool.status !== "active"}
                  onClick={() => setShowExec(v => v === tool.id ? null : tool.id)}
                >
                  {showExec === tool.id ? "Close" : "Execute"}
                </button>
              </div>
              {showExec === tool.id && (
                <div className="dcv2-tool-exec">
                  <input
                    className="dcv2-search"
                    placeholder="Enter tool input…"
                    value={execInput}
                    onChange={e => setExecInput(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleExec(tool)}
                    disabled={execId === tool.id}
                  />
                  <button
                    className="dcv2-btn dcv2-btn--primary dcv2-btn--sm"
                    onClick={() => handleExec(tool)}
                    disabled={!execInput.trim() || execId === tool.id}
                  >
                    {execId === tool.id ? "⟳" : "Run"}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {execRes && (
        <div className="dcv2-exec-result">
          <div className="dcv2-er-header">
            <span className="dcv2-er-tool">{execRes.tool}</span>
            <span className="dcv2-er-input">→ "{execRes.input}"</span>
            <span className="dcv2-er-ts">{execRes.ts}</span>
          </div>
          <pre className="dcv2-er-output">{execRes.result}</pre>
        </div>
      )}

      {history.length > 0 && (
        <div className="dcv2-tool-history">
          <p className="dcv2-section-label">Execution History</p>
          {history.map((h, i) => (
            <div key={i} className="dcv2-th-row">
              <span className="dcv2-th-ts">{h.ts}</span>
              <span className="dcv2-th-tool">{h.tool}</span>
              <span className="dcv2-th-input">{h.input}</span>
              <span className="dcv2-chip dcv2-chip--ok dcv2-chip--xs">ok</span>
            </div>
          ))}
        </div>
      )}

      <div className="dcv2-coming-soon">
        <span className="dcv2-coming-icon">◈</span>
        <div>
          <p className="dcv2-coming-title">Custom Tool Registration <span className="csb-beta-badge">BETA</span></p>
          <p className="dcv2-coming-sub">Register custom API endpoints as agent tools. Define input schemas, output formats, and rate limits from this interface.</p>
        </div>
      </div>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────

export default function DeveloperCopilotV2({ onNavigate }) {
  const [tab,    setTab]    = useState("copilot");
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((msg, type = "info") => {
    const id = Date.now();
    setToasts(t => [...t, { id, msg, type }]);
  }, []);
  const removeToast = useCallback(id => setToasts(t => t.filter(x => x.id !== id)), []);

  return (
    <div className="dcv2-root">
      <div className="dcv2-header">
        <div>
          <h1 className="dcv2-page-title">Developer Copilot</h1>
          <p className="dcv2-page-sub">AI-assisted development · Repo intelligence · Engineering health · Integrations</p>
        </div>
      </div>

      <div className="dcv2-subnav">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`dcv2-subnav-tab${tab === t.id ? " dcv2-subnav-tab--active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="dcv2-tab-content">
        {tab === "copilot"      && <TabCopilot      addToast={addToast} />}
        {tab === "repos"        && <TabRepos         addToast={addToast} />}
        {tab === "review"       && <TabReview        addToast={addToast} />}
        {tab === "architecture" && <TabArchitecture  addToast={addToast} />}
        {tab === "health"       && <TabHealth        addToast={addToast} />}
        {tab === "integrations" && <TabIntegrations  addToast={addToast} onNavigate={onNavigate} />}
        {tab === "tools"        && <TabTools         addToast={addToast} />}
      </div>

      <div className="dcv2-toast-container">
        {toasts.map(t => (
          <Toast key={t.id} msg={t.msg} type={t.type} onDone={() => removeToast(t.id)} />
        ))}
      </div>
    </div>
  );
}
