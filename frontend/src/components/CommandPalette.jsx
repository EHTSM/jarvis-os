import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import "./CommandPalette.css";

// ── Action registry ────────────────────────────────────────────────

const NAV_ACTIONS = [
  // Navigate — primary
  { id: "nav-home",       label: "Dashboard",             icon: "◈", group: "Navigate",            tab: "home"       },
  { id: "nav-chat",       label: "AI Chat",               icon: "◎", group: "Navigate",            tab: "chat"       },
  { id: "nav-insights",   label: "Pipeline",              icon: "◇", group: "Navigate",            tab: "insights"   },
  { id: "nav-clients",    label: "Contacts",              icon: "◈", group: "Navigate",            tab: "clients"    },
  { id: "nav-payments",   label: "Payments",              icon: "◻", group: "Navigate",            tab: "payments"   },
  { id: "nav-activity",   label: "History",               icon: "◻", group: "Navigate",            tab: "activity"   , keywords: "logs" },
  { id: "nav-success",    label: "Getting Started",       icon: "◇", group: "Navigate",            tab: "success", keywords: "onboarding setup tutorial walkthrough first steps welcome guide"    },
  { id: "nav-overview",   label: "Overview",              icon: "◻", group: "Navigate",            tab: "overview", keywords: "capabilities what can ooplix do features feature list modules index"   },

  // Runtime & Ops
  { id: "nav-workflowautomation", label: "Workflow Automation", icon: "⚡", group: "Runtime & Ops", tab: "workflowautomation", keywords: "rule rules trigger triggers zapier recipe builder" },
  // Phase A.10.7 finding: a founder searching "kpi" — the page's own
  // subtitle literally reads "Executive KPIs, workspace health,
  // automation ROI, AI usage, and runtime capacity" — got zero results
  // anywhere (More menu or ⌘K), despite this being the real, correctly-
  // wired destination. Same additive `keywords` mechanism already used
  // for "Sign out"/"logout" above (A.4.3) and MoreMenu's `alias` field.
  { id: "nav-analyticscenter", label: "Analytics",         icon: "◎", group: "Runtime & Ops",       tab: "analyticscenter", keywords: "kpi kpis" },
  // Phase A.11.4 finding: this entry is wired to the right tab, but it is the
  // only in-scope destination whose ⌘K label does not match the name the app
  // itself shows everywhere else — App.jsx's MORE_TABS calls tab "runtime"
  // "Runtime Console", and so do the nav button and the breadcrumb
  // (Dashboard › Operations › Runtime Console). Measured live: ⌘K "runtime
  // console" returned the literal "No commands found" empty state while the
  // More menu found it on the first try. Same additive `keywords` mechanism as
  // "kpi"/"logout" above — label left unchanged so nothing that already worked
  // moves, the destination's own real display name simply becomes findable.
  { id: "nav-runtime",    label: "Execution Engine",      icon: "⬡", group: "Runtime & Ops",       tab: "runtime", keywords: "runtime console operator console queue dispatch worker workers job jobs process background" },
  { id: "nav-execution",  label: "Execution Monitor",     icon: "⬡", group: "Runtime & Ops",       tab: "execution"  , keywords: "execution execute run steps evidence plan progress" },
  { id: "nav-operations", label: "Operations",            icon: "◉", group: "Runtime & Ops",       tab: "operations", keywords: "ops daily control center command" },
  { id: "nav-reliability",label: "Reliability",           icon: "◈", group: "Runtime & Ops",       tab: "reliability", keywords: "incident alert monitoring" },
  { id: "nav-selfhealing",label: "Self-Healing",          icon: "✦", group: "Runtime & Ops",       tab: "selfhealing", keywords: "auto fix recovery repair resilience"},
  { id: "nav-observer",   label: "Runtime Observer",      icon: "◉", group: "Runtime & Ops",       tab: "observer"   , keywords: "observability monitoring git logs" },
  { id: "nav-orglevel-eos",  label: "Executive OS (L6)",     icon: "◈", group: "Org Levels", tab: "orglevel-eos", keywords: "level eos org"  },
  { id: "nav-orglevel-ent",  label: "Enterprise OS (L7)",    icon: "◈", group: "Org Levels", tab: "orglevel-ent", keywords: "level org divisions"  },
  { id: "nav-orglevel-eco",  label: "Ecosystem OS (L8)",     icon: "◈", group: "Org Levels", tab: "orglevel-eco", keywords: "level multi tenant marketplace org"  },
  { id: "nav-orglevel-civ",  label: "Civilization OS (L9)",  icon: "◈", group: "Org Levels", tab: "orglevel-civ", keywords: "level federation council"  },
  { id: "nav-orglevel-auto", label: "Autonomous OS (L10)",   icon: "◈", group: "Org Levels", tab: "orglevel-auto", keywords: "level ooda civilization" },
  { id: "nav-orchestrator",label:"Orchestrator",          icon: "◎", group: "Runtime & Ops",       tab: "orchestrator", keywords: "orchestration coordinate schedule pipeline sequence"},
  { id: "nav-taskrouter", label: "Task Router",           icon: "◇", group: "Runtime & Ops",       tab: "taskrouter", keywords: "routing assign dispatch work distribution" },
  { id: "nav-agents",     label: "Agents",                icon: "⬡", group: "Runtime & Ops",       tab: "agents", keywords: "ai bot assistant worker digital employee staff"     },
  { id: "nav-agentruntime",label:"Agent Runtime",         icon: "⬡", group: "Runtime & Ops",       tab: "agentruntime", keywords: "supervisor lifecycle long running process"},
  { id: "nav-globalactivity",label:"Global Activity",     icon: "◻", group: "Runtime & Ops",       tab: "globalactivity", keywords: "feed events stream timeline whats happening recent"},
  { id: "nav-systemhealth",label:"System Health",         icon: "◈", group: "Runtime & Ops",       tab: "systemhealth", keywords: "status uptime diagnostics server"},
  // A.11.1 UX consistency fix: these 12 destinations are real, working,
  // reachable via the More-menu search (App.jsx's MORE_TABS, which
  // MoreMenu.filtered() searches in full) but were absent from this
  // separately-maintained NAV_ACTIONS list — so ⌘K returned zero results
  // for their own exact names (e.g. "Daily Planning", "Knowledge Base")
  // while the More menu found them instantly. Same two-search-surfaces-
  // should-behave-the-same issue this file's own A.10.7/A.4.3 comments
  // above already document and fixed for other terms — this closes the
  // remaining gap. Group + keywords carried over from MORE_TABS' own
  // group/alias fields where present; tab ids and labels copied verbatim
  // from App.jsx, no new destinations invented.
  { id: "nav-mobile",     label: "Mobile Platform",       icon: "◻", group: "Runtime & Ops",       tab: "mobile", keywords: "android ios app phone tablet device"     },
  // A.10.1 recovery — App.jsx's setTab() already special-cases tab id "eod"
  // to open EndOfDayReview.jsx (a real, fully-wired closing-summary modal)
  // instead of switching tabs; this was the only reachable entrypoint
  // missing anywhere in the app. Same mechanism as every other row here.
  { id: "nav-eod",        label: "End of Day Review",     icon: "◻", group: "Runtime & Ops",       tab: "eod"        , keywords: "shutdown close day daily summary wrap up end my day" },
  { id: "nav-collab",     label: "Collaboration",         icon: "◈", group: "Runtime & Ops",       tab: "collab", keywords: "handoff multi agent teamwork delegate delegation together"     },
  { id: "nav-registry",   label: "Registry",              icon: "◻", group: "Runtime & Ops",       tab: "registry", keywords: "agent catalogue catalog available agents list of"   },
  { id: "nav-toolfabric", label: "Tool Fabric",           icon: "⚡", group: "Runtime & Ops",       tab: "toolfabric", keywords: "tools tooling capability agent integrations" },

  // Engineering
  { id: "nav-engineering",label: "Engineering",           icon: "◈", group: "Engineering",         tab: "engineering", keywords: "dev development software build code intelligence"},
  { id: "nav-workspace",  label: "Eng Workspace",         icon: "◇", group: "Engineering",         tab: "workspace", keywords: "editor ide file explorer code project files"  },
  { id: "nav-copilot",    label: "Copilot",               icon: "◎", group: "Engineering",         tab: "copilot"    , keywords: "review debug test ci github pipeline commit repository project code review" },
  { id: "nav-devops",     label: "DevOps",                icon: "⬡", group: "Engineering",         tab: "devops"     , keywords: "docker deploy deployment rollback blue green canary" },
  { id: "nav-agentactions",label:"Agent Actions",         icon: "⚡", group: "Engineering",         tab: "agentactions", keywords: "approve pending review"},
  { id: "nav-execconnector",label:"Exec Connectors",      icon: "◇", group: "Engineering",         tab: "execconnector", keywords: "execution adapter bridge external link"},
  { id: "nav-agentfactory",label:"Agent Factory",         icon: "◉", group: "Engineering",         tab: "agentfactory", keywords: "create new build builder template"},
  { id: "nav-productos",  label: "Product OS",            icon: "◈", group: "Engineering",         tab: "productos", keywords: "prd roadmap requirements backlog epic epics milestone feature request product planning task hierarchy dependency dependencies release planning objectives work items" },

  // AI & Intelligence
  { id: "nav-intel",      label: "Intelligence",          icon: "◈", group: "AI & Intelligence",   tab: "intel", keywords: "insight insights correlation pattern patterns trend trends analysis"      },
  { id: "nav-predict",    label: "Prediction",            icon: "◇", group: "AI & Intelligence",   tab: "predict", keywords: "forecast projection what will happen risk"    },
  { id: "nav-recommend",  label: "Recommendations",       icon: "✦", group: "AI & Intelligence",   tab: "recommend", keywords: "suggest suggestion advice next best action what should do"  },
  { id: "nav-guardrails", label: "Guardrails",            icon: "◻", group: "AI & Intelligence",   tab: "guardrails", keywords: "limit limits safety constraint boundary policy" },
  { id: "nav-jarvisbrain",label: "Jarvis Brain",          icon: "◎", group: "AI & Intelligence",   tab: "jarvisbrain", keywords: "central intelligence core reasoning"},
  { id: "nav-memoryintel",label: "Memory Intelligence",   icon: "◈", group: "AI & Intelligence",   tab: "memoryintel", keywords: "memory intel recall similarity what do you remember" },
  { id: "nav-selfimprove",label: "Self-Improve",          icon: "⬡", group: "AI & Intelligence",   tab: "selfimprove", keywords: "improvement learning evolution optimise optimize"},
  { id: "nav-autonomyscore",label:"Autonomy Score",       icon: "◉", group: "AI & Intelligence",   tab: "autonomyscore", keywords: "independence how autonomous maturity"},
  { id: "nav-autonomouswf",label:"Auto Workflows",        icon: "⚡", group: "AI & Intelligence",   tab: "autonomouswf", keywords: "autonomous automatic self running"},
  { id: "nav-nlconsole",  label: "Command Console",       icon: "◎", group: "AI & Intelligence",   tab: "nlconsole", keywords: "natural language prompt ask tell instruct operator"  },
  { id: "nav-execloop",   label: "Executive Loop",        icon: "◉", group: "AI & Intelligence",   tab: "execloop", keywords: "decision ceo brief leadership cadence"   },
  { id: "nav-inteloverlay",label:"Reasoning & Risk",      icon: "◈", group: "AI & Intelligence",   tab: "inteloverlay", keywords: "why explanation rationale overlay decision trace"},
  { id: "nav-agentcollab",label: "Live Agent Roster",     icon: "⬡", group: "AI & Intelligence",   tab: "agentcollab", keywords: "agents active who is working online"},
  { id: "nav-memory",     label: "Memory OS",             icon: "◎", group: "AI & Intelligence",   tab: "memory", keywords: "remember history context long term notes"     },
  { id: "nav-knowledge",  label: "Knowledge Base",        icon: "◇", group: "AI & Intelligence",   tab: "knowledge", keywords: "kb docs wiki article faq documentation graph"  },
  { id: "nav-twin",       label: "Digital Twin",          icon: "◈", group: "AI & Intelligence",   tab: "twin", keywords: "founder my preferences decision style approve like me"       },
  { id: "nav-planning",   label: "Daily Planning",        icon: "◉", group: "AI & Intelligence",   tab: "planning", keywords: "my day agenda schedule today todo calendar"   },
  { id: "nav-assistant",  label: "Founder Assistant",     icon: "◎", group: "AI & Intelligence",   tab: "assistant", keywords: "chat ask jarvis help me personal"  },
  { id: "nav-orglevel-ako", label: "Knowledge Org (L4)",  icon: "◈", group: "Org Levels",          tab: "orglevel-ako", keywords: "level ako autonomous" },

  // Memory & Data
  { id: "nav-sharedmem",  label: "Memory Fabric",         icon: "◻", group: "Memory & Data",       tab: "sharedmem", keywords: "shared cross agent context store"  },

  // Executive
  { id: "nav-mission",    label: "Mission Control",       icon: "◎", group: "Executive",           tab: "mission", keywords: "missions goal goals objective task board progress"    },
  { id: "nav-executivedash",label:"Executive Dashboard",  icon: "◈", group: "Executive",           tab: "executivedash", keywords: "executive dash ceo overview leadership summary kpi" },
  { id: "nav-oroplix",    label: "Ooplix Runs Ooplix",    icon: "✦", group: "Executive",           tab: "oroplix", keywords: "dogfood self hosted on internal usage operating"    },

  // Growth & Revenue
  { id: "nav-creative",   label: "Creative Studio",       icon: "✦", group: "Growth & Revenue",    tab: "creative"   , keywords: "brand brand kit" },
  { id: "nav-growth",     label: "Growth",                icon: "◇", group: "Growth & Revenue",    tab: "growth"     , keywords: "marketing campaign email sms push broadcast audience segment newsletter whatsapp message messaging chat outreach" },
  { id: "nav-contentseo", label: "Content & SEO",         icon: "◈", group: "Growth & Revenue",    tab: "contentseo" , keywords: "website forms landing page docs documentation doc blog article keyword calendar" },
  { id: "nav-distribution",label:"Distribution",          icon: "◉", group: "Growth & Revenue",    tab: "distribution", keywords: "publish publishing social post channel influencer community launch"},
  { id: "nav-referral",   label: "Referral Engine",       icon: "★", group: "Growth & Revenue",    tab: "referral", keywords: "affiliate invite reward advocacy word of mouth"   },
  { id: "nav-partners",   label: "Partners",              icon: "◈", group: "Growth & Revenue",    tab: "partners", keywords: "partnership reseller channel agency alliance"   },
  { id: "nav-aicost",     label: "AI Costs",              icon: "◇", group: "Growth & Revenue",    tab: "aicost", keywords: "spend token llm budget credits pricing"     },
  { id: "nav-aiusage",    label: "AI Orchestration",      icon: "◎", group: "Growth & Revenue",    tab: "aiusage", keywords: "usage provider model router llm openai anthropic"    },

  // Enterprise
  { id: "nav-companies",  label: "Companies",             icon: "◈", group: "Enterprise",          tab: "companies"  , keywords: "business company" },
  { id: "nav-orgadmin",   label: "Organization",          icon: "◈", group: "Enterprise",          tab: "orgadmin", keywords: "department departments role roles permission permissions member members hierarchy"   },
  { id: "nav-business",   label: "CRM",                   icon: "◉", group: "Enterprise",          tab: "business", keywords: "deal deals opportunity account customer"   },
  { id: "nav-team",       label: "Team",                  icon: "◈", group: "Enterprise",          tab: "team"       , keywords: "invite employee" },
  // Phase A.11.8: the provider names are the words a founder actually types, and
  // Integrations is the real destination for every one of them, yet "whatsapp",
  // "razorpay" and "stripe" all returned "No commands found". The list below is
  // not invented — it is exactly the nine provider ids the live backend returns
  // from GET /my-connectors (whatsapp, razorpay, stripe, smtp, teams, notion,
  // jira, linear, twitter), which are the nine cards this destination renders.
  { id: "nav-integrations",label:"Integrations",          icon: "⬡", group: "Enterprise",          tab: "integrations", keywords: "gitlab github bitbucket connector connectors whatsapp razorpay stripe smtp email teams notion jira linear twitter payment gateway webhook api oauth developer platform" },
  { id: "nav-marketplace",label: "Marketplace",           icon: "◈", group: "Enterprise",          tab: "marketplace", keywords: "plugin plugins extension extensions app store catalog install"},
  { id: "nav-trust",      label: "Trust & Compliance",    icon: "✦", group: "Enterprise",          tab: "trustcompliance", keywords: "trust gdpr soc2 certification data ownership privacy" },
  // Phase A.11.7 finding: this destination is wired correctly, but it carries
  // three different names — ⌘K calls it "Support OS", App.jsx's MORE_TABS calls
  // it "Support", and the page's own <h1> reads "Support Center". Measured live:
  // ⌘K "Support Center" returned the literal "No commands found" empty state,
  // i.e. the one name the screen actually shows itself was the one name that
  // could not find it. Exactly the A.11.4 `nav-runtime` case ("Execution Engine"
  // vs "Runtime Console"), fixed the same additive way: `keywords` only, label
  // left unchanged so nothing that already worked moves. Terms are the surface's
  // own real vocabulary (its tab bar reads Tickets / Knowledge Base / SLA
  // Tracking / Analytics), not invented ones.
  { id: "nav-supportos",  label: "Support OS",            icon: "◻", group: "Enterprise",          tab: "supportos", keywords: "support center ticket tickets sla knowledge base escalation helpdesk inbox" },
  { id: "nav-legalos",    label: "Legal OS",              icon: "✦", group: "Enterprise",          tab: "legalos", keywords: "contract agreement nda terms policy document drafting"    },
  // Phase A.11.8: "churn" and "customer health" returned "No commands found"
  // even though this destination's own tabs are literally named "Customer Health"
  // and its KPI tiles read "CHURN RISK", "AT RISK" and "EXPANSION OPPS". Words
  // taken verbatim from the surface's own rendered labels, not invented.
  { id: "nav-customersuccess", label: "Customer Success", icon: "◈", group: "Enterprise",          tab: "customersuccess", keywords: "churn customer health at risk retention expansion support tickets score onboarding csm" },
  { id: "nav-launchplatform", label: "Launch Platform",   icon: "◉", group: "Enterprise",          tab: "launchplatform", keywords: "feedback roadmap feature request vote prd release readiness onboarding academy" },

  // Settings
  { id: "nav-settings",   label: "Settings",              icon: "◈", group: "Settings",            tab: "settings"   , keywords: "notification notifications api token tokens webhook audit log policy policies session sessions device devices compliance governance security sso scim" },
  // Phase A.11.6: App.jsx's MORE_TABS `billing` entry already carries
  // `alias: "finance"` (a prior-phase fix), so the More menu resolves "finance"
  // -> Billing correctly. This parallel registry never got the equivalent
  // `keywords` field, so ⌘K "finance" returned Launch Platform and Product OS
  // (fuzzy noise) and never Billing — measured live, both surfaces, same term.
  // Same registry-drift class as A.10.7's `kpi`/`kpis` fix and A.11.1's
  // 12-missing-destinations fix, using the identical mechanism already
  // established one entry away at `nav-analyticscenter`.
  { id: "nav-billing",    label: "Billing",               icon: "◇", group: "Settings",            tab: "billing", keywords: "finance" },
  { id: "nav-help",       label: "Help & Guides",         icon: "◎", group: "Settings",            tab: "help"       , keywords: "shortcut shortcuts keyboard" },
  { id: "nav-reports",    label: "Reports",               icon: "◻", group: "Settings",            tab: "reports", keywords: "export summary weekly monthly business review pdf"    },
  { id: "nav-betachecklist",label:"Beta Checklist",       icon: "◇", group: "Settings",            tab: "betachecklist", keywords: "launch readiness release pre"},
];

const QUICK_ACTIONS = [
  { id: "qa-ask",         label: "Ask Ooplix",            icon: "✦", group: "Actions",  type: "ask"       },
  { id: "qa-contact",     label: "Add Contact",           icon: "＋", group: "Actions",  type: "nav", tab: "clients" },
  { id: "qa-workflow",    label: "Create Workflow",       icon: "⚡", group: "Actions",  type: "nav", tab: "runtime" },
  { id: "qa-mission",     label: "New Mission",           icon: "◎", group: "Actions",  type: "nav", tab: "mission" },
  { id: "qa-agent",       label: "View Agents",           icon: "⬡", group: "Actions",  type: "nav", tab: "agents" },
];

// A.4.3 finding: "logout"/"sign out" returned nothing anywhere search was
// tried (More-menu search, this palette). The real Sign out button only
// lived inside the ORG switcher dropdown (frontend/src/components/
// OrgSwitcher.jsx) — reachable, but not findable by search, and "logout"
// is an explicitly required focus term for this mission. Reusing the
// palette's own existing type:"run" action mechanism (see DESKTOP_ACTIONS
// below) rather than adding any new capability — this is the same pattern
// already used for Open Terminal, just a second caller of it.
function _signOutAction(onSignOut) {
  return onSignOut
    ? [{ id: "qa-signout", label: "Sign out", icon: "◻", group: "Actions", type: "run", run: onSignOut, keywords: "logout log out" }]
    : [];
}

// Desktop-only action — shell-open-terminal (real OS terminal app hand-off:
// Terminal.app / cmd.exe / gnome-terminal) was fully implemented in
// electron/main.cjs and exposed via preload as shellOpenTerminal, but had
// zero frontend caller anywhere in the repo. Only shown inside Electron.
const DESKTOP_ACTIONS = (typeof window !== "undefined" && window.electronAPI?.isElectron)
  ? [{ id: "qa-terminal", label: "Open Terminal", icon: "▸", group: "Actions", type: "run",
       run: () => window.electronAPI.shellOpenTerminal() }]
  : [];

const STATIC_ACTIONS = [...NAV_ACTIONS, ...QUICK_ACTIONS, ...DESKTOP_ACTIONS];

// ── Fuzzy scorer ───────────────────────────────────────────────────

function _scoreOne(label, query) {
  const l = label.toLowerCase();
  const q = query;
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

// A.4.3 finding: "logout" (the exact word this mission names) doesn't
// fuzzy-match the label "Sign out" — no shared substring/subsequence
// close enough to score. Reused the same additive-synonym idea as
// MoreMenu's `alias` field (App.jsx), applied to this scorer: an optional
// `keywords` string on an action is checked too, and the best of the two
// scores wins. No new matching system — same scorer, one more input.
function _score(label, query, keywords) {
  const q = query.toLowerCase().trim();
  const labelScore = _scoreOne(label, q);
  if (!keywords) return labelScore;
  return Math.max(labelScore, _scoreOne(keywords, q));
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

// ── Recent + Pin persistence ───────────────────────────────────────

const CP_RECENT_KEY = "ooplix_cmd_recent";
const CP_PINS_KEY   = "ooplix_cmd_pins";
const MAX_RECENTS   = 8;

function getStoredRecents() {
  try { return JSON.parse(localStorage.getItem(CP_RECENT_KEY) || "[]"); } catch { return []; }
}
function pushStoredRecent(id) {
  try {
    const prev = getStoredRecents().filter(r => r !== id);
    localStorage.setItem(CP_RECENT_KEY, JSON.stringify([id, ...prev].slice(0, MAX_RECENTS)));
  } catch {}
}
function getStoredPins() {
  try { return JSON.parse(localStorage.getItem(CP_PINS_KEY) || "[]"); } catch { return []; }
}
function toggleStoredPin(id, setPins) {
  const current = getStoredPins();
  const next = current.includes(id) ? current.filter(x => x !== id) : [id, ...current];
  try { localStorage.setItem(CP_PINS_KEY, JSON.stringify(next)); } catch {}
  setPins(next);
}

// ── Component ──────────────────────────────────────────────────────

export default function CommandPalette({ open, onClose, onNavigate, onAsk, onSignOut }) {
  const [query,   setQuery]   = useState("");
  const [active,  setActive]  = useState(0);
  const [recents, setRecents] = useState(getStoredRecents);
  const [pins,    setPins]    = useState(getStoredPins);
  const [listKey, setListKey] = useState(0);
  const inputRef  = useRef(null);
  const listRef   = useRef(null);

  const ALL_ACTIONS = useMemo(() => [...STATIC_ACTIONS, ..._signOutAction(onSignOut)], [onSignOut]);

  // Reset on open
  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      setRecents(getStoredRecents());
      setPins(getStoredPins());
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  // Animate list when query changes
  useEffect(() => { setListKey(k => k + 1); }, [query]);

  // Recent items surfaced at top when no query
  const recentActions = useMemo(() => {
    if (query.trim()) return [];
    return recents
      .map(id => ALL_ACTIONS.find(a => a.id === id))
      .filter(Boolean)
      .map(a => ({ ...a, _recent: true }));
  }, [recents, query, ALL_ACTIONS]);

  const pinnedActions = useMemo(() => {
    if (query.trim()) return [];
    return pins
      .map(id => ALL_ACTIONS.find(a => a.id === id))
      .filter(Boolean)
      .map(a => ({ ...a, _pinned: true }));
  }, [pins, query, ALL_ACTIONS]);


  const results = useMemo(() => {
    const base = ALL_ACTIONS
      .map(a => ({ ...a, score: _score(a.label, query, a.keywords) }))
      .filter(a => a.score > 0)
      .sort((a, b) => b.score - a.score);
    if (!query.trim()) {
      const pinnedIds  = new Set(pinnedActions.map(p => p.id));
      const recentIds  = new Set(recentActions.map(r => r.id));
      const combined   = new Set([...pinnedIds, ...recentIds]);
      return [
        ...pinnedActions,
        ...recentActions.filter(r => !pinnedIds.has(r.id)),
        ...base.filter(a => !combined.has(a.id)),
      ];
    }
    return base;
  }, [query, recentActions, pinnedActions, ALL_ACTIONS]);

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
    pushStoredRecent(action.id);
    setRecents(getStoredRecents());
    onClose();
    if (action.type === "ask") {
      onNavigate?.("chat");
      if (query.trim() && query.trim().toLowerCase() !== "ask ooplix") {
        setTimeout(() => onAsk?.(query.trim()), 120);
      }
      return;
    }
    if (action.type === "run") {
      action.run?.();
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

  // Group results for display — pins and recents get special groups
  const grouped = results.reduce((acc, action, idx) => {
    let g;
    if (action._pinned) g = "Pinned";
    else if (action._recent) g = "Recent";
    else g = action.group;
    if (!acc[g]) acc[g] = [];
    acc[g].push({ ...action, _idx: idx });
    return acc;
  }, {});

  return (
    <motion.div
      className="cp-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <motion.div
        className="cp-panel"
        initial={{ opacity: 0, y: -12, scale: 0.97 }}
        animate={{ opacity: 1, y: 0,   scale: 1    }}
        exit={{    opacity: 0, y: -8,  scale: 0.97 }}
        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        onClick={e => e.stopPropagation()}
      >

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
        <div className="cp-results cp-list-animate" key={listKey} ref={listRef} role="listbox">
          {results.length === 0 ? (
            <div className="cp-empty">
              <span className="cp-empty-icon">◎</span>
              <p>No commands found for <strong>"{query}"</strong></p>
            </div>
          ) : (
            Object.entries(grouped).map(([group, items]) => (
              <div key={group} className={`cp-group${group === "Pinned" ? " cp-pin-section" : ""}`}>
                <div className="cp-group-label section-label" data-group={group}>{group}</div>
                {items.map(action => {
                  const isPinned = pins.includes(action.id);
                  return (
                    <div key={action.id} className="cp-row">
                      <button
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
                        {action.shortcut && <kbd className="cp-kbd">{action.shortcut}</kbd>}
                        {action._idx === active && !action.shortcut && (
                          <kbd className="cp-item-enter">↵</kbd>
                        )}
                      </button>
                      <button
                        className={`cp-pin-btn${isPinned ? " cp-pin-btn--active" : ""}`}
                        title={isPinned ? "Unpin" : "Pin"}
                        onClick={e => { e.stopPropagation(); toggleStoredPin(action.id, setPins); }}
                        aria-label={isPinned ? "Unpin command" : "Pin command"}
                      >
                        {isPinned ? "★" : "☆"}
                      </button>
                    </div>
                  );
                })}
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
      </motion.div>
    </motion.div>
  );
}
