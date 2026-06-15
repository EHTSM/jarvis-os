import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import "./CommandPalette.css";

// ── Action registry ────────────────────────────────────────────────

const NAV_ACTIONS = [
  // Navigate — primary
  { id: "nav-home",       label: "Dashboard",             icon: "◈", group: "Navigate",            tab: "home"       },
  { id: "nav-chat",       label: "AI Chat",               icon: "◎", group: "Navigate",            tab: "chat"       },
  { id: "nav-insights",   label: "Pipeline",              icon: "◇", group: "Navigate",            tab: "insights"   },
  { id: "nav-clients",    label: "Contacts",              icon: "◈", group: "Navigate",            tab: "clients"    },
  { id: "nav-payments",   label: "Payments",              icon: "◻", group: "Navigate",            tab: "payments"   },
  { id: "nav-activity",   label: "History",               icon: "◻", group: "Navigate",            tab: "activity"   },
  { id: "nav-success",    label: "Getting Started",       icon: "◇", group: "Navigate",            tab: "success"    },
  { id: "nav-overview",   label: "Overview",              icon: "◻", group: "Navigate",            tab: "overview"   },

  // Runtime & Ops
  { id: "nav-runtime",    label: "Execution Engine",      icon: "⬡", group: "Runtime & Ops",       tab: "runtime"    },
  { id: "nav-execution",  label: "Execution Monitor",     icon: "⬡", group: "Runtime & Ops",       tab: "execution"  },
  { id: "nav-operations", label: "Operations",            icon: "◉", group: "Runtime & Ops",       tab: "operations" },
  { id: "nav-reliability",label: "Reliability",           icon: "◈", group: "Runtime & Ops",       tab: "reliability"},
  { id: "nav-selfhealing",label: "Self-Healing",          icon: "✦", group: "Runtime & Ops",       tab: "selfhealing"},
  { id: "nav-orchestrator",label:"Orchestrator",          icon: "◎", group: "Runtime & Ops",       tab: "orchestrator"},
  { id: "nav-taskrouter", label: "Task Router",           icon: "◇", group: "Runtime & Ops",       tab: "taskrouter" },
  { id: "nav-agents",     label: "Agents",                icon: "⬡", group: "Runtime & Ops",       tab: "agents"     },
  { id: "nav-collab",     label: "Collaboration",         icon: "◈", group: "Runtime & Ops",       tab: "collab"     },
  { id: "nav-registry",   label: "Registry",              icon: "◻", group: "Runtime & Ops",       tab: "registry"   },
  { id: "nav-toolfabric", label: "Tool Fabric",           icon: "⚡", group: "Runtime & Ops",       tab: "toolfabric" },
  { id: "nav-autonomy",   label: "Autonomous Coordination",icon:"◎", group: "Runtime & Ops",       tab: "autonomy"   },

  // Engineering
  { id: "nav-engineering",label: "Engineering",           icon: "◈", group: "Engineering",         tab: "engineering"},
  { id: "nav-workspace",  label: "Eng Workspace",         icon: "◇", group: "Engineering",         tab: "workspace"  },
  { id: "nav-copilot",    label: "Copilot",               icon: "◎", group: "Engineering",         tab: "copilot"    },
  { id: "nav-devops",     label: "DevOps",                icon: "⬡", group: "Engineering",         tab: "devops"     },
  { id: "nav-developer",  label: "Developer OS",          icon: "◈", group: "Engineering",         tab: "developer"  },
  { id: "nav-agentactions",label:"Agent Actions",         icon: "⚡", group: "Engineering",         tab: "agentactions"},
  { id: "nav-execconnector",label:"Exec Connectors",      icon: "◇", group: "Engineering",         tab: "execconnector"},
  { id: "nav-agentfactory",label:"Agent Factory",         icon: "◉", group: "Engineering",         tab: "agentfactory"},

  // AI & Intelligence
  { id: "nav-intel",      label: "Intelligence",          icon: "◈", group: "AI & Intelligence",   tab: "intel"      },
  { id: "nav-predict",    label: "Prediction",            icon: "◇", group: "AI & Intelligence",   tab: "predict"    },
  { id: "nav-recommend",  label: "Recommendations",       icon: "✦", group: "AI & Intelligence",   tab: "recommend"  },
  { id: "nav-guardrails", label: "Guardrails",            icon: "◻", group: "AI & Intelligence",   tab: "guardrails" },
  { id: "nav-jarvisbrain",label: "Jarvis Brain",          icon: "◎", group: "AI & Intelligence",   tab: "jarvisbrain"},
  { id: "nav-memoryintel",label: "Memory Intelligence",   icon: "◈", group: "AI & Intelligence",   tab: "memoryintel"},
  { id: "nav-selfimprove",label: "Self-Improve",          icon: "⬡", group: "AI & Intelligence",   tab: "selfimprove"},
  { id: "nav-autonomyscore",label:"Autonomy Score",       icon: "◉", group: "AI & Intelligence",   tab: "autonomyscore"},
  { id: "nav-autonomouswf",label:"Auto Workflows",        icon: "⚡", group: "AI & Intelligence",   tab: "autonomouswf"},

  // Memory & Data
  { id: "nav-memory",     label: "Memory",                icon: "◈", group: "Memory & Data",       tab: "memory"     },
  { id: "nav-knowledge",  label: "Knowledge Base",        icon: "◇", group: "Memory & Data",       tab: "knowledge"  },
  { id: "nav-sharedmem",  label: "Memory Fabric",         icon: "◻", group: "Memory & Data",       tab: "sharedmem"  },
  { id: "nav-dataowner",  label: "Data",                  icon: "◉", group: "Memory & Data",       tab: "dataowner"  },

  // Executive
  { id: "nav-mission",    label: "Mission Control",       icon: "◎", group: "Executive",           tab: "mission"    },
  { id: "nav-executivedash",label:"Executive Dashboard",  icon: "◈", group: "Executive",           tab: "executivedash"},
  { id: "nav-oroplix",    label: "Ooplix Runs Ooplix",    icon: "✦", group: "Executive",           tab: "oroplix"    },

  // Growth & Revenue
  { id: "nav-seo",        label: "SEO",                   icon: "◇", group: "Growth & Revenue",    tab: "seo"        },
  { id: "nav-content",    label: "Content",               icon: "◈", group: "Growth & Revenue",    tab: "content"    },
  { id: "nav-social",     label: "Social",                icon: "◉", group: "Growth & Revenue",    tab: "social"     },
  { id: "nav-email",      label: "Email",                 icon: "◻", group: "Growth & Revenue",    tab: "email"      },
  { id: "nav-referral",   label: "Referral",              icon: "◇", group: "Growth & Revenue",    tab: "referral"   },
  { id: "nav-partners",   label: "Partners",              icon: "◈", group: "Growth & Revenue",    tab: "partners"   },
  { id: "nav-launch",     label: "Launch",                icon: "⚡", group: "Growth & Revenue",    tab: "launch"     },
  { id: "nav-autorevenue",label: "Auto Revenue",          icon: "✦", group: "Growth & Revenue",    tab: "autorevenue"},
  { id: "nav-automarketing",label:"Auto Marketing",       icon: "◎", group: "Growth & Revenue",    tab: "automarketing"},
  { id: "nav-autosupport",label: "Auto Support",          icon: "⬡", group: "Growth & Revenue",    tab: "autosupport"},
  { id: "nav-aicost",     label: "AI Costs",              icon: "◇", group: "Growth & Revenue",    tab: "aicost"     },

  // Enterprise
  { id: "nav-business",   label: "Business OS",           icon: "◉", group: "Enterprise",          tab: "business"   },
  { id: "nav-enterprise", label: "Enterprise OS",         icon: "◎", group: "Enterprise",          tab: "enterprise" },
  { id: "nav-personal",   label: "Personal OS",           icon: "◇", group: "Enterprise",          tab: "personal"   },
  { id: "nav-team",       label: "Team",                  icon: "◈", group: "Enterprise",          tab: "team"       },
  { id: "nav-ecrm",       label: "Enterprise CRM",        icon: "◻", group: "Enterprise",          tab: "ecrm"       },
  { id: "nav-integrations",label:"Integrations",          icon: "⬡", group: "Enterprise",          tab: "integrations"},
  { id: "nav-mobile",     label: "Mobile",                icon: "◇", group: "Enterprise",          tab: "mobile"     },
  { id: "nav-marketplace",label: "Marketplace",           icon: "◈", group: "Enterprise",          tab: "marketplace"},
  { id: "nav-community",  label: "Community",             icon: "◉", group: "Enterprise",          tab: "community"  },
  { id: "nav-trust",      label: "Trust & Compliance",    icon: "✦", group: "Enterprise",          tab: "trustcompliance"},
  { id: "nav-recovery",   label: "Disaster Recovery",     icon: "◎", group: "Enterprise",          tab: "disasterrecovery"},
  { id: "nav-supportos",  label: "Support OS",            icon: "◻", group: "Enterprise",          tab: "supportos"  },

  // Settings
  { id: "nav-settings",   label: "Settings",              icon: "◈", group: "Settings",            tab: "settings"   },
  { id: "nav-billing",    label: "Billing",               icon: "◇", group: "Settings",            tab: "billing"    },
  { id: "nav-help",       label: "Help & Guides",         icon: "◎", group: "Settings",            tab: "help"       },
  { id: "nav-reports",    label: "Reports",               icon: "◻", group: "Settings",            tab: "reports"    },
];

const QUICK_ACTIONS = [
  { id: "qa-ask",         label: "Ask Ooplix",            icon: "✦", group: "Actions",  type: "ask"       },
  { id: "qa-contact",     label: "Add Contact",           icon: "＋", group: "Actions",  type: "nav", tab: "clients" },
  { id: "qa-workflow",    label: "Create Workflow",       icon: "⚡", group: "Actions",  type: "nav", tab: "runtime" },
  { id: "qa-mission",     label: "New Mission",           icon: "◎", group: "Actions",  type: "nav", tab: "mission" },
  { id: "qa-agent",       label: "View Agents",           icon: "⬡", group: "Actions",  type: "nav", tab: "agents" },
];

const ALL_ACTIONS = [...NAV_ACTIONS, ...QUICK_ACTIONS];

// ── Fuzzy scorer ───────────────────────────────────────────────────

function _score(label, query) {
  const l = label.toLowerCase();
  const q = query.toLowerCase().trim();
  if (!q) return 1;
  if (l === q)           return 100;
  if (l.startsWith(q))   return 80;
  if (l.includes(q))     return 60;
  // Character subsequence
  let qi = 0;
  for (let i = 0; i < l.length && qi < q.length; i++) {
    if (l[i] === q[qi]) qi++;
  }
  if (qi === q.length) return 30 + (q.length / l.length) * 20;
  return 0;
}

function _highlight(label, query) {
  if (!query.trim()) return label;
  const q = query.toLowerCase().trim();
  const l = label.toLowerCase();
  const idx = l.indexOf(q);
  if (idx === -1) return label;
  return (
    <>
      {label.slice(0, idx)}
      <mark>{label.slice(idx, idx + q.length)}</mark>
      {label.slice(idx + q.length)}
    </>
  );
}

// ── Component ──────────────────────────────────────────────────────

export default function CommandPalette({ open, onClose, onNavigate, onAsk }) {
  const [query,   setQuery]   = useState("");
  const [active,  setActive]  = useState(0);
  const inputRef  = useRef(null);
  const listRef   = useRef(null);

  // Reset on open
  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const results = useMemo(() => {
    return ALL_ACTIONS
      .map(a => ({ ...a, score: _score(a.label, query) }))
      .filter(a => a.score > 0)
      .sort((a, b) => b.score - a.score);
  }, [query]);

  // Clamp active index when results change
  useEffect(() => {
    setActive(prev => Math.min(prev, Math.max(0, results.length - 1)));
  }, [results.length]);

  // Scroll active item into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const execute = useCallback((action) => {
    if (!action) return;
    onClose();
    if (action.type === "ask") {
      onNavigate?.("chat");
      // Pre-fill the chat with the query as a task
      if (query.trim() && query.trim().toLowerCase() !== "ask ooplix") {
        setTimeout(() => onAsk?.(query.trim()), 120);
      }
      return;
    }
    if (action.tab) {
      onNavigate?.(action.tab);
    }
  }, [onClose, onNavigate, onAsk, query]);

  const handleKey = useCallback((e) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(i => Math.min(i + 1, results.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(i => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      execute(results[active]);
    }
  }, [results, active, execute, onClose]);

  if (!open) return null;

  // Group results for display
  const grouped = results.reduce((acc, action, idx) => {
    const g = action.group;
    if (!acc[g]) acc[g] = [];
    acc[g].push({ ...action, _idx: idx });
    return acc;
  }, {});

  return (
    <div className="cp-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="cp-panel animate-fade-up" onClick={e => e.stopPropagation()}>

        {/* Input */}
        <div className="cp-input-row">
          <span className="cp-search-icon" aria-hidden="true">⌕</span>
          <input
            ref={inputRef}
            className="cp-input"
            placeholder="Type a command or search…"
            value={query}
            onChange={e => { setQuery(e.target.value); setActive(0); }}
            onKeyDown={handleKey}
            autoComplete="off"
            spellCheck={false}
            aria-label="Command search"
          />
          {query && (
            <button className="cp-clear" onClick={() => { setQuery(""); inputRef.current?.focus(); }}>
              ✕
            </button>
          )}
          <kbd className="cp-esc-hint">ESC</kbd>
        </div>

        {/* Results */}
        <div className="cp-results" ref={listRef} role="listbox">
          {results.length === 0 ? (
            <div className="cp-empty">
              <span className="cp-empty-icon">◎</span>
              <p>No commands found for <strong>"{query}"</strong></p>
            </div>
          ) : (
            Object.entries(grouped).map(([group, items]) => (
              <div key={group} className="cp-group">
                <div className="cp-group-label section-label">{group}</div>
                {items.map(action => (
                  <button
                    key={action.id}
                    data-idx={action._idx}
                    className={`cp-item${action._idx === active ? " cp-item--active" : ""}`}
                    onMouseEnter={() => setActive(action._idx)}
                    onClick={() => execute(action)}
                    role="option"
                    aria-selected={action._idx === active}
                  >
                    <span className="cp-item-icon" aria-hidden="true">{action.icon}</span>
                    <span className="cp-item-label">
                      {_highlight(action.label, query)}
                    </span>
                    {action._idx === active && (
                      <kbd className="cp-item-enter">↵</kbd>
                    )}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="cp-footer">
          <span className="cp-hint"><kbd>↑↓</kbd> navigate</span>
          <span className="cp-hint"><kbd>↵</kbd> select</span>
          <span className="cp-hint"><kbd>ESC</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
