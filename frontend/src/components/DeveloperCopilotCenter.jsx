import React, { useState } from "react";
import { track } from "../analytics";
import "./DeveloperCopilotCenter.css";

// ── Seed data ─────────────────────────────────────────────────────────
const REPOS = [
  { id: "r1", name: "ooplix-backend",   lang: "Node.js",  stars: 0, health: "healthy",  coverage: 84, lastCommit: "2h ago",   branch: "main",  openIssues: 3,  openPRs: 2, ci: "passing" },
  { id: "r2", name: "ooplix-frontend",  lang: "React",    stars: 0, health: "healthy",  coverage: 71, lastCommit: "45m ago",  branch: "main",  openIssues: 5,  openPRs: 3, ci: "passing" },
  { id: "r3", name: "ooplix-mobile",    lang: "Capacitor",stars: 0, health: "warning",  coverage: 52, lastCommit: "1d ago",   branch: "main",  openIssues: 8,  openPRs: 1, ci: "failing" },
  { id: "r4", name: "ooplix-agents",    lang: "CJS",      stars: 0, health: "healthy",  coverage: 67, lastCommit: "3h ago",   branch: "main",  openIssues: 2,  openPRs: 1, ci: "passing" },
  { id: "r5", name: "ooplix-infra",     lang: "Terraform",stars: 0, health: "critical", coverage: 30, lastCommit: "3d ago",   branch: "main",  openIssues: 11, openPRs: 0, ci: "failing" },
];

const BRANCHES = [
  { id: "b1", repo: "ooplix-frontend",  name: "feat/phase-9-ai-os",       author: "You",         ahead: 14, behind: 0, status: "active",  lastCommit: "45m ago",  ci: "passing" },
  { id: "b2", repo: "ooplix-backend",   name: "feat/webhook-engine",      author: "You",         ahead: 7,  behind: 2, status: "active",  lastCommit: "2h ago",   ci: "passing" },
  { id: "b3", repo: "ooplix-mobile",    name: "fix/android-auth-crash",   author: "You",         ahead: 3,  behind: 0, status: "stale",   lastCommit: "4d ago",   ci: "failing" },
  { id: "b4", repo: "ooplix-frontend",  name: "refactor/component-split", author: "You",         ahead: 22, behind: 1, status: "active",  lastCommit: "1d ago",   ci: "passing" },
  { id: "b5", repo: "ooplix-agents",    name: "feat/memory-agent",        author: "You",         ahead: 5,  behind: 0, status: "active",  lastCommit: "3h ago",   ci: "passing" },
];

const PULL_REQUESTS = [
  { id: "pr1", repo: "ooplix-frontend",  title: "Phase 9: Knowledge, Memory, Integration, Agent OS",  author: "You",  branch: "feat/phase-9-ai-os",       status: "open",   reviews: 0, comments: 2, additions: 2285, deletions: 20,  checks: "passing", draft: false },
  { id: "pr2", repo: "ooplix-backend",   title: "Webhook engine — inbound event routing",             author: "You",  branch: "feat/webhook-engine",      status: "open",   reviews: 0, comments: 0, additions: 340,  deletions: 12,  checks: "passing", draft: false },
  { id: "pr3", repo: "ooplix-mobile",    title: "Fix: Android Firebase Auth null crash on cold start",author: "You",  branch: "fix/android-auth-crash",   status: "open",   reviews: 0, comments: 1, additions: 28,   deletions: 6,   checks: "failing", draft: false },
  { id: "pr4", repo: "ooplix-frontend",  title: "Refactor: split BusinessOS into sub-panels",         author: "You",  branch: "refactor/component-split", status: "draft",  reviews: 0, comments: 0, additions: 580,  deletions: 210, checks: "passing", draft: true  },
  { id: "pr5", repo: "ooplix-agents",    title: "Memory agent — cross-session context persistence",   author: "You",  branch: "feat/memory-agent",        status: "open",   reviews: 0, comments: 0, additions: 190,  deletions: 5,   checks: "passing", draft: false },
];

const REVIEWS = [
  { id: "rv1", pr: "Phase 9: Knowledge, Memory, Integration, Agent OS", repo: "ooplix-frontend", finding: "KnowledgeCenter.jsx:214 — consider memoizing visibleDocs with useMemo to avoid re-filtering on every render.", severity: "suggestion", status: "open"   },
  { id: "rv2", pr: "Phase 9: Knowledge, Memory, Integration, Agent OS", repo: "ooplix-frontend", finding: "MemoryCenter.jsx:88 — _load called on every render. Move to useState initialiser or useRef.", severity: "warning",    status: "open"   },
  { id: "rv3", pr: "Fix: Android Firebase Auth null crash",              repo: "ooplix-mobile",   finding: "auth/LoginPage.jsx:43 — null check added correctly. Logic looks sound.", severity: "ok",         status: "resolved" },
  { id: "rv4", pr: "Webhook engine — inbound event routing",            repo: "ooplix-backend",  finding: "routes/webhooks.js:17 — missing rate-limit middleware on inbound endpoint.", severity: "critical",   status: "open"   },
  { id: "rv5", pr: "Memory agent — cross-session context persistence",  repo: "ooplix-agents",   finding: "No issues found. Implementation is clean and follows existing patterns.", severity: "ok",         status: "resolved" },
];

const TASKS = [
  { id: "t1", title: "Add rate-limit middleware to webhook endpoint",   repo: "ooplix-backend",   priority: "critical", status: "todo",        type: "bug"     },
  { id: "t2", title: "Memoize visibleDocs in KnowledgeCenter",         repo: "ooplix-frontend",  priority: "low",      status: "todo",        type: "perf"    },
  { id: "t3", title: "Fix Android cold-start Firebase null crash",      repo: "ooplix-mobile",    priority: "high",     status: "in_progress", type: "bug"     },
  { id: "t4", title: "Write unit tests for webhook routing logic",      repo: "ooplix-backend",   priority: "medium",   status: "todo",        type: "test"    },
  { id: "t5", title: "Add Terraform state backend config",              repo: "ooplix-infra",     priority: "high",     status: "todo",        type: "infra"   },
  { id: "t6", title: "Coverage uplift: mobile auth flows",              repo: "ooplix-mobile",    priority: "medium",   status: "todo",        type: "test"    },
  { id: "t7", title: "Refactor BusinessOS component split",             repo: "ooplix-frontend",  priority: "low",      status: "in_progress", type: "refactor"},
  { id: "t8", title: "Memory agent integration test",                   repo: "ooplix-agents",    priority: "medium",   status: "done",        type: "test"    },
];

// ── Helpers ───────────────────────────────────────────────────────────
const HEALTH_COLORS = { healthy: "var(--success)", warning: "var(--warning)", critical: "var(--danger)" };
const CI_COLORS     = { passing: "var(--success)", failing: "var(--danger)" };
const SEV_COLORS    = { critical: "var(--danger)", warning: "var(--warning)", suggestion: "var(--accent2)", ok: "var(--success)" };
const PRI_COLORS    = { critical: "var(--danger)", high: "var(--warning)", medium: "var(--accent2)", low: "var(--text-faint)" };
const STATUS_COLORS = { todo: "var(--text-faint)", in_progress: "var(--accent2)", done: "var(--success)" };

function Dot({ color }) { return <span className="dcc-dot" style={{ background: color }} />; }
function Badge({ label, color }) {
  return <span className="dcc-badge" style={{ color, borderColor: color + "33" }}>{label}</span>;
}

export default function DeveloperCopilotCenter({ onNavigate }) {
  const [section, setSection] = useState("repos");
  const [selRepo, setSelRepo] = useState(null);

  React.useEffect(() => { track.event("dev_copilot_viewed"); }, []);

  const openTasks  = TASKS.filter(t => t.status !== "done").length;
  const openPRs    = PULL_REQUESTS.filter(p => p.status !== "merged" && !p.draft).length;
  const openReviews= REVIEWS.filter(r => r.status === "open").length;
  const failingCI  = REPOS.filter(r => r.ci === "failing").length;

  return (
    <div className="dev-copilot-center page-enter">
      <div className="dcc-header">
        <div>
          <h1 className="dcc-title">Developer Copilot</h1>
          <p className="dcc-subtitle">Repositories, branches, PRs, code reviews, and open tasks — all in one view.</p>
        </div>
      </div>

      {/* Summary strip */}
      <div className="dcc-summary-strip">
        {[
          { label: "Repos",        value: REPOS.length,   color: "var(--accent)"                                              },
          { label: "Open PRs",     value: openPRs,        color: openPRs > 0 ? "var(--accent2)" : "var(--text-faint)"         },
          { label: "Open tasks",   value: openTasks,      color: openTasks > 0 ? "var(--warning)" : "var(--success)"          },
          { label: "Review items", value: openReviews,    color: openReviews > 0 ? "var(--danger)" : "var(--success)"         },
          { label: "Failing CI",   value: failingCI,      color: failingCI > 0 ? "var(--danger)" : "var(--success)"           },
          { label: "Active branches",value: BRANCHES.filter(b=>b.status==="active").length, color: "var(--accent2)"           },
        ].map(s => (
          <div key={s.label} className="dcc-summary-tile">
            <span className="dcc-summary-val" style={{ color: s.color }}>{s.value}</span>
            <span className="dcc-summary-label">{s.label}</span>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="dcc-tabs">
        {[
          { id: "repos",    label: "Repositories" },
          { id: "tasks",    label: `Tasks (${openTasks})` },
          { id: "branches", label: "Branches"     },
          { id: "prs",      label: `Pull Requests (${openPRs})` },
          { id: "reviews",  label: `Code Reviews (${openReviews})` },
        ].map(t => (
          <button key={t.id} className={`dcc-tab${section === t.id ? " dcc-tab--active" : ""}`} onClick={() => setSection(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="dcc-content" key={section}>

        {/* Repos */}
        {section === "repos" && (
          <div className="dcc-repo-list">
            {REPOS.map(r => (
              <div key={r.id} className={`dcc-repo-row${selRepo === r.id ? " dcc-repo-row--sel" : ""}`} onClick={() => setSelRepo(prev => prev === r.id ? null : r.id)}>
                <div className="dcc-repo-left">
                  <Dot color={HEALTH_COLORS[r.health]} />
                  <div className="dcc-repo-info">
                    <span className="dcc-repo-name">{r.name}</span>
                    <span className="dcc-repo-meta">{r.lang} · {r.lastCommit} · {r.openIssues} issues</span>
                  </div>
                </div>
                <div className="dcc-repo-right">
                  <Badge label={`CI: ${r.ci}`} color={CI_COLORS[r.ci]} />
                  <span className="dcc-coverage" style={{ color: r.coverage >= 70 ? "var(--success)" : r.coverage >= 50 ? "var(--warning)" : "var(--danger)" }}>
                    {r.coverage}%
                  </span>
                  <span className="dcc-repo-prs">{r.openPRs} PRs</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Tasks */}
        {section === "tasks" && (
          <div className="dcc-task-list">
            {TASKS.map(t => (
              <div key={t.id} className="dcc-task-row">
                <Dot color={STATUS_COLORS[t.status]} />
                <div className="dcc-task-info">
                  <span className="dcc-task-title" style={{ textDecoration: t.status === "done" ? "line-through" : "none", opacity: t.status === "done" ? 0.5 : 1 }}>{t.title}</span>
                  <span className="dcc-task-meta">{t.repo} · {t.type}</span>
                </div>
                <Badge label={t.priority} color={PRI_COLORS[t.priority]} />
                <span className="dcc-task-status" style={{ color: STATUS_COLORS[t.status] }}>{t.status.replace("_"," ")}</span>
              </div>
            ))}
          </div>
        )}

        {/* Branches */}
        {section === "branches" && (
          <div className="dcc-branch-list">
            {BRANCHES.map(b => (
              <div key={b.id} className="dcc-branch-row">
                <Dot color={b.status === "active" ? "var(--success)" : "var(--warning)"} />
                <div className="dcc-branch-info">
                  <span className="dcc-branch-name">{b.name}</span>
                  <span className="dcc-branch-meta">{b.repo} · {b.lastCommit}</span>
                </div>
                <div className="dcc-branch-commits">
                  <span className="dcc-ahead">+{b.ahead}</span>
                  {b.behind > 0 && <span className="dcc-behind">-{b.behind}</span>}
                </div>
                <Badge label={`CI: ${b.ci}`} color={CI_COLORS[b.ci]} />
                <span className="dcc-branch-status" style={{ color: b.status === "active" ? "var(--success)" : "var(--warning)" }}>{b.status}</span>
              </div>
            ))}
          </div>
        )}

        {/* Pull Requests */}
        {section === "prs" && (
          <div className="dcc-pr-list">
            {PULL_REQUESTS.map(p => (
              <div key={p.id} className="dcc-pr-row">
                <div className="dcc-pr-info">
                  <div className="dcc-pr-title-row">
                    {p.draft && <span className="dcc-draft-badge">Draft</span>}
                    <span className="dcc-pr-title">{p.title}</span>
                  </div>
                  <span className="dcc-pr-meta">{p.repo} · {p.branch}</span>
                </div>
                <div className="dcc-pr-stats">
                  <span className="dcc-pr-add">+{p.additions}</span>
                  <span className="dcc-pr-del">-{p.deletions}</span>
                  {p.comments > 0 && <span className="dcc-pr-comments">💬 {p.comments}</span>}
                </div>
                <Badge label={`CI: ${p.checks}`} color={CI_COLORS[p.checks]} />
              </div>
            ))}
          </div>
        )}

        {/* Code Reviews */}
        {section === "reviews" && (
          <div className="dcc-review-list">
            {REVIEWS.map(r => (
              <div key={r.id} className={`dcc-review-row dcc-review-row--${r.severity}`}>
                <div className="dcc-review-left">
                  <span className="dcc-sev-dot" style={{ background: SEV_COLORS[r.severity] }} />
                  <div className="dcc-review-body">
                    <span className="dcc-review-pr">{r.pr}</span>
                    <span className="dcc-review-repo">{r.repo}</span>
                    <p className="dcc-review-finding">{r.finding}</p>
                  </div>
                </div>
                <div className="dcc-review-right">
                  <Badge label={r.severity} color={SEV_COLORS[r.severity]} />
                  <span className={`dcc-review-status dcc-review-status--${r.status}`}>{r.status}</span>
                </div>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}
