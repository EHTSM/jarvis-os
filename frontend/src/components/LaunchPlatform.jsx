import React, { useState, useEffect, useCallback } from "react";
import "./LaunchPlatform.css";

const BASE = process.env.REACT_APP_API_URL || "";
const api  = (path, opts = {}) =>
  fetch(`${BASE}${path}`, { credentials: "include", ...opts }).then(r => r.json());
const post = (path, body) => api(path, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const put = (path, body) => api(path, {
  method: "PUT", headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const TABS = [
  { id: "dashboard",   label: "Dashboard"   },
  { id: "onboarding",  label: "Onboarding"  },
  { id: "workspaces",  label: "Workspaces"  },
  { id: "docs",        label: "Docs"        },
  { id: "academy",     label: "Academy"     },
  { id: "referral",    label: "Referral"    },
  { id: "cst",         label: "Success"     },
  { id: "feedback",    label: "Feedback"    },
  { id: "readiness",   label: "Readiness"   },
  { id: "benchmark",   label: "Benchmark"   },
  { id: "pcpreport",   label: "PCP Report"  },
  { id: "pipreport",   label: "PIP Report"  },
];

// ─────────────────────────────────────────────────────────────────────────────
// MODULE 1: Launch Dashboard
// ─────────────────────────────────────────────────────────────────────────────
function DashboardPanel() {
  const [snap, setSnap]     = useState(null);
  const [npsScore, setNpsScore] = useState(null);
  const [npsComment, setNpsComment] = useState("");
  const [npsSel, setNpsSel] = useState(null);
  const [msg, setMsg]       = useState("");

  useEffect(() => {
    api("/launch/dashboard").then(r => r.ok && setSnap(r.snapshot));
    api("/launch/dashboard/nps").then(r => r.ok && setNpsScore(r.nps));
  }, []);

  const submitNPS = async () => {
    if (npsSel === null) return;
    await post("/launch/dashboard/nps", { score: npsSel, comment: npsComment });
    setMsg("Thanks for your feedback!");
    const r = await api("/launch/dashboard/nps");
    if (r.ok) setNpsScore(r.nps);
  };

  const fmt = n => n === undefined || n === null ? "–" : n.toLocaleString();
  const npsColor = !npsScore || npsScore.score === null ? "" :
    npsScore.score > 50 ? "positive" : npsScore.score > 0 ? "neutral" : "negative";

  return (
    <div>
      <p className="launch-section-title">Executive Dashboard</p>
      {snap ? (
        <>
          <div className="launch-grid">
            <div className="launch-card"><h4>Beta Users</h4><div className="val">{fmt(snap.users?.beta)}</div><div className="sub">of {fmt(snap.users?.total)} total</div></div>
            <div className="launch-card"><h4>Active This Week</h4><div className="val">{fmt(snap.users?.activeWeek)}</div><div className="sub">{fmt(snap.users?.activeMonth)} this month</div></div>
            <div className="launch-card accent"><h4>MRR</h4><div className="val">${fmt(snap.revenue?.mrrUsd)}</div><div className="sub">ARR ${fmt(snap.revenue?.arrUsd)}</div></div>
            <div className="launch-card"><h4>AI Requests</h4><div className="val">{fmt(snap.ai?.totalAiRequests)}</div><div className="sub">{fmt(snap.ai?.totalCreditsUsed)} credits used</div></div>
            <div className="launch-card"><h4>7-Day Retention</h4><div className="val">{fmt(snap.retention?.day7)}%</div><div className="sub">{fmt(snap.retention?.day30)}% 30-day</div></div>
            <div className="launch-card"><h4>Activation Rate</h4><div className="val">{fmt(snap.activation?.rate)}%</div><div className="sub">{fmt(snap.activation?.activated)} activated</div></div>
          </div>

          <p className="launch-section-title">Plan Distribution</p>
          <div className="launch-grid">
            {Object.entries(snap.revenue?.byPlan || {}).map(([plan, count]) => (
              <div key={plan} className="launch-card">
                <h4>{plan}</h4>
                <div className="val">{fmt(count)}</div>
                <div className="sub">users</div>
              </div>
            ))}
          </div>
        </>
      ) : <div className="loading-txt">Loading dashboard…</div>}

      <p className="launch-section-title" style={{ marginTop: 24 }}>NPS Score</p>
      {npsScore && (
        <div className="launch-card" style={{ marginBottom: 16 }}>
          <div className={`nps-big-score ${npsColor}`}>{npsScore.score ?? "–"}</div>
          <div style={{ textAlign: "center", fontSize: 11, color: "#666" }}>
            {npsScore.promoters}P · {npsScore.passives}N · {npsScore.detractors}D · {npsScore.responses} responses
          </div>
        </div>
      )}
      <div className="nps-form">
        <div style={{ fontSize: 12, color: "#ccc", marginBottom: 8 }}>How likely are you to recommend Ooplix? (0–10)</div>
        <div className="nps-scores">
          {[...Array(11)].map((_, i) => (
            <button key={i} className={`nps-btn${npsSel === i ? " sel" : ""}`} onClick={() => setNpsSel(i)}>{i}</button>
          ))}
        </div>
        <input className="fb-input" style={{ width: "100%", boxSizing: "border-box", marginTop: 8 }}
          placeholder="Optional comment…" value={npsComment} onChange={e => setNpsComment(e.target.value)} />
        {msg && <div className="success-msg">{msg}</div>}
        <button className="nps-submit" onClick={submitNPS}>Submit NPS</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE 2: Interactive Onboarding
// ─────────────────────────────────────────────────────────────────────────────
function OnboardingPanel() {
  const [roles, setRoles]       = useState([]);
  const [state, setState]       = useState(null);
  const [progress, setProgress] = useState(null);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    Promise.all([
      api("/launch/onboarding/roles"),
      api("/launch/onboarding/state"),
    ]).then(([r, s]) => {
      if (r.ok) setRoles(r.roles || []);
      if (s.ok) { setState(s.state); setProgress(s.progress); }
      setLoading(false);
    });
  }, []);

  const selectRole = async (roleId) => {
    const r = await post("/launch/onboarding/start", { role: roleId });
    if (r.ok) { setState(r.state); setProgress(r.progress || null); }
  };

  const completeStep = async (stepId) => {
    const r = await post(`/launch/onboarding/step/${stepId}`, {});
    if (r.ok) { setState(r.state); setProgress(r.progress); }
  };

  if (loading) return <div className="loading-txt">Loading onboarding…</div>;

  if (!state) return (
    <div>
      <p className="launch-section-title">What's your role?</p>
      <div className="role-grid">
        {roles.map(role => (
          <div key={role.id} className="role-card" onClick={() => selectRole(role.id)}>
            <div className="role-icon">{role.icon}</div>
            <div className="role-label">{role.label}</div>
            <div className="role-desc">{role.welcome?.slice(0, 80)}…</div>
          </div>
        ))}
      </div>
    </div>
  );

  const role = roles.find(r => r.id === state.roleId) || {};

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <span style={{ fontSize: 28 }}>{role.icon}</span>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#ddd" }}>{role.label} Onboarding</div>
          <div style={{ fontSize: 11, color: "#777" }}>{role.welcome}</div>
        </div>
        <button className="btn-secondary" style={{ marginLeft: "auto" }} onClick={() => setState(null)}>Change Role</button>
      </div>

      {progress && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#888", marginBottom: 6 }}>
            <span>{progress.done}/{progress.total} steps</span>
            <span>{progress.pct}%</span>
          </div>
          <div className="path-progress-bar"><div className="path-progress-fill" style={{ width: `${progress.pct}%` }} /></div>
          {progress.completed && <div className="success-msg" style={{ marginTop: 8 }}>Onboarding complete!</div>}
        </div>
      )}

      <div className="step-list">
        {(state.steps || []).map((step, i) => (
          <div key={step.id} className={`step-row${step.done ? " done" : ""}`}>
            <span className="step-icon">{step.done ? "✓" : `${i+1}.`}</span>
            <span className="step-label">{step.label}</span>
            {step.done
              ? <span className="step-done">Done</span>
              : <button className="step-btn" onClick={() => completeStep(step.id)}>Mark Done</button>
            }
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE 3: Sample Workspaces
// ─────────────────────────────────────────────────────────────────────────────
function WorkspacesPanel() {
  const [workspaces, setWorkspaces] = useState([]);
  const [msg, setMsg] = useState({});

  useEffect(() => { api("/launch/workspaces").then(r => r.ok && setWorkspaces(r.workspaces || [])); }, []);

  const provision = async (id) => {
    const r = await post(`/launch/workspaces/${id}/provision`, {});
    setMsg(prev => ({ ...prev, [id]: r.message || "Provisioned!" }));
  };

  return (
    <div>
      <p className="launch-section-title">Sample Workspaces</p>
      <div className="ws-grid">
        {workspaces.map(ws => (
          <div key={ws.id} className="ws-card">
            <div className="ws-icon">{ws.icon}</div>
            <div className="ws-name">{ws.name}</div>
            <div className="ws-stack">{(ws.stack || []).map(s => <span key={s} className="ws-tag">{s}</span>)}</div>
            {msg[ws.id]
              ? <div className="success-msg" style={{ marginTop: 8 }}>{msg[ws.id]}</div>
              : <button className="ws-btn" onClick={() => provision(ws.id)}>Open Workspace</button>
            }
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE 4: Documentation Center
// ─────────────────────────────────────────────────────────────────────────────
function DocsPanel() {
  const [docs, setDocs]           = useState([]);
  const [shortcuts, setShortcuts] = useState([]);
  const [search, setSearch]       = useState("");
  const [tab, setTab]             = useState("docs");

  useEffect(() => {
    api("/launch/docs").then(r => r.ok && setDocs(r.docs || []));
    api("/launch/docs/shortcuts").then(r => r.ok && setShortcuts(r.shortcuts || []));
  }, []);

  const filtered = docs.filter(d =>
    !search || d.title.toLowerCase().includes(search.toLowerCase()) ||
    (d.tags || []).some(t => t.includes(search.toLowerCase()))
  );

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {["docs", "shortcuts"].map(t => (
          <button key={t} className={tab === t ? "btn-primary" : "btn-secondary"} onClick={() => setTab(t)}>
            {t === "docs" ? "Documentation" : "Keyboard Shortcuts"}
          </button>
        ))}
      </div>

      {tab === "docs" && (
        <>
          <input className="docs-search" placeholder="Search docs…" value={search} onChange={e => setSearch(e.target.value)} />
          <div className="doc-list">
            {filtered.map(d => (
              <div key={d.id} className="doc-item">
                <div className="doc-item-title">{d.title}</div>
                <div className="doc-item-cat">{d.category}</div>
                <div className="doc-item-tags">{(d.tags || []).map(t => <span key={t} className="doc-item-tag">{t}</span>)}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === "shortcuts" && (
        <div className="shortcut-grid">
          {shortcuts.map(s => (
            <div key={s.key} className="shortcut-row">
              <span className="shortcut-key">{s.key}</span>
              <span className="shortcut-action">{s.action}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE 5: Academy
// ─────────────────────────────────────────────────────────────────────────────
function AcademyPanel() {
  const [paths, setPaths]       = useState([]);
  const [badges, setBadges]     = useState([]);
  const [progress, setProgress] = useState(null);
  const [view, setView]         = useState("paths");

  useEffect(() => {
    api("/launch/academy/paths").then(r => { if (r.ok) { setPaths(r.paths || []); setBadges(r.badges || []); } });
    api("/launch/academy/progress").then(r => r.ok && setProgress(r.progress));
  }, []);

  const enroll = async (pathId) => {
    await post(`/launch/academy/enroll/${pathId}`, {});
    api("/launch/academy/progress").then(r => r.ok && setProgress(r.progress));
  };

  const getPathProg = (pathId) => (progress?.paths || []).find(p => p.pathId === pathId);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {["paths", "badges"].map(v => (
          <button key={v} className={view === v ? "btn-primary" : "btn-secondary"} onClick={() => setView(v)}>
            {v === "paths" ? "Learning Paths" : "My Badges"}
          </button>
        ))}
      </div>

      {view === "paths" && (
        <div className="path-list">
          {paths.map(p => {
            const prog = getPathProg(p.id);
            return (
              <div key={p.id} className="path-card">
                <div className="path-card-header">
                  <span className="path-title">{p.title}</span>
                  <span className={`path-level ${p.level}`}>{p.level}</span>
                </div>
                <div className="path-desc">{p.description}</div>
                <div className="path-progress-bar">
                  <div className="path-progress-fill" style={{ width: `${prog?.pct || 0}%` }} />
                </div>
                <div className="path-meta">
                  <span>{prog ? `${prog.done}/${prog.total} modules` : `${p.modules?.length || 0} modules · ~${p.estimatedHours}h`}</span>
                  {prog?.completed
                    ? <span style={{ color: "#22c55e", fontSize: 11, fontWeight: 600 }}>✓ Complete</span>
                    : <button className="path-enroll-btn" disabled={!!prog} onClick={() => enroll(p.id)}>
                        {prog ? "In Progress" : "Enroll"}
                      </button>
                  }
                </div>
              </div>
            );
          })}
        </div>
      )}

      {view === "badges" && (
        <>
          <div className="badge-grid">
            {(progress?.badges || []).map(b => (
              <div key={b.id} className="badge-chip" style={{ borderColor: b.color + "55", color: b.color }}>
                {b.icon} {b.title}
              </div>
            ))}
            {!progress?.badges?.length && <div className="empty-state">Complete a learning path to earn badges.</div>}
          </div>
          {(progress?.certificates || []).length > 0 && (
            <>
              <p className="launch-section-title" style={{ marginTop: 16 }}>Certificates</p>
              {progress.certificates.map(c => (
                <div key={c.id} className="launch-card" style={{ marginBottom: 8 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: "#ddd" }}>{c.pathTitle}</div>
                  <div style={{ fontSize: 11, color: "#666" }}>Issued {new Date(c.issuedAt).toLocaleDateString()}</div>
                </div>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE 6: Referral System
// ─────────────────────────────────────────────────────────────────────────────
function ReferralPanel() {
  const [dash, setDash]   = useState(null);
  const [code, setCode]   = useState("");
  const [msg, setMsg]     = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => { api("/launch/referral").then(r => r.ok && setDash(r.dashboard)); }, []);

  const useCode = async () => {
    const r = await post("/launch/referral/use", { code });
    setMsg(r.ok ? "Referral applied! Credits will be issued." : r.error || "Invalid code");
  };

  const redeem = async () => {
    const r = await post("/launch/referral/redeem", {});
    setMsg(r.ok ? `Redeemed ${r.credits} credits!` : "No pending credits");
    api("/launch/referral").then(r2 => r2.ok && setDash(r2.dashboard));
  };

  const copy = () => {
    if (dash?.link) { navigator.clipboard.writeText(dash.link); setCopied(true); setTimeout(() => setCopied(false), 2000); }
  };

  return (
    <div>
      <p className="launch-section-title">Your Referral Code</p>
      {dash && (
        <>
          <div className="ref-code-box">
            <span className="ref-code">{dash.code}</span>
            <button className="ref-copy-btn" onClick={copy}>{copied ? "Copied!" : "Copy Link"}</button>
          </div>
          <div style={{ fontSize: 11, color: "#666", marginBottom: 12 }}>Share: {dash.link}</div>

          <div className="ref-stats">
            <div className="ref-stat"><div className="val">{dash.invites}</div><div className="lbl">Invites</div></div>
            <div className="ref-stat"><div className="val">{dash.paid}</div><div className="lbl">Paid</div></div>
            <div className="ref-stat"><div className="val">{dash.totalEarned}</div><div className="lbl">Credits Earned</div></div>
          </div>

          {dash.pendingCredits > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
              <span style={{ fontSize: 12, color: "#ddd" }}>{dash.pendingCredits} credits pending</span>
              <button className="btn-primary" onClick={redeem}>Redeem</button>
            </div>
          )}
        </>
      )}

      <p className="launch-section-title" style={{ marginTop: 20 }}>Have a Referral Code?</p>
      <div style={{ display: "flex", gap: 8 }}>
        <input className="fb-input" placeholder="Enter referral code…" value={code} onChange={e => setCode(e.target.value.toUpperCase())} />
        <button className="btn-primary" onClick={useCode}>Apply</button>
      </div>
      {msg && <div className={msg.includes("!") ? "success-msg" : "error-msg"}>{msg}</div>}

      <p className="launch-section-title" style={{ marginTop: 20 }}>Rewards</p>
      {dash && Object.entries(dash.rewards || {}).map(([k, v]) => (
        <div key={k} className="launch-card" style={{ marginBottom: 8 }}>
          <div style={{ fontWeight: 600, fontSize: 12, color: "#ddd" }}>{v.label}</div>
          <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>{v.description}</div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE 7: Customer Success Center
// ─────────────────────────────────────────────────────────────────────────────
function CSTPanel() {
  const [health, setHealth]   = useState(null);
  const [overview, setOverview] = useState(null);

  useEffect(() => {
    api("/launch/cst/health").then(r => r.ok && setHealth(r.health));
    api("/launch/cst/overview").then(r => r.ok && setOverview(r.overview));
  }, []);

  const scoreClass = h => h >= 60 ? "high" : h >= 30 ? "medium" : "low";

  return (
    <div>
      <p className="launch-section-title">Your Success Health</p>
      {health ? (
        <>
          <div className="health-meter">
            <div className={`health-score-big ${scoreClass(health.healthScore)}`}>{health.healthScore}</div>
            <div className="health-bar-wrap">
              <div className="health-bar">
                <div className={`health-bar-fill ${scoreClass(health.healthScore)}`} style={{ width: `${health.healthScore}%` }} />
              </div>
              <div style={{ fontSize: 11, color: "#666" }}>Risk level: {health.riskLevel}</div>
            </div>
          </div>

          {health.tasks?.length > 0 && (
            <>
              <p className="launch-section-title">Recommended Next Steps</p>
              <div className="task-list">
                {health.tasks.map(t => <div key={t.id} className="task-item">{t.label}</div>)}
              </div>
            </>
          )}
        </>
      ) : <div className="loading-txt">Loading health…</div>}

      {overview && (
        <>
          <p className="launch-section-title" style={{ marginTop: 24 }}>Platform Overview</p>
          <div className="launch-grid">
            <div className="launch-card"><h4>Total Accounts</h4><div className="val">{overview.totalAccounts}</div></div>
            <div className="launch-card"><h4>Avg Health</h4><div className="val">{overview.avgHealthScore}</div></div>
            <div className="launch-card"><h4>High Risk</h4><div className="val" style={{ color: "#ef4444" }}>{overview.highRisk}</div></div>
            <div className="launch-card"><h4>Healthy</h4><div className="val" style={{ color: "#22c55e" }}>{overview.healthy}</div></div>
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE 8: Feedback Hub
// ─────────────────────────────────────────────────────────────────────────────
function FeedbackPanel() {
  const [items, setItems]   = useState([]);
  const [stats, setStats]   = useState(null);
  const [view, setView]     = useState("list");
  const [roadmap, setRoadmap] = useState(null);
  const [form, setForm]     = useState({ type: "feature", title: "", body: "" });
  const [msg, setMsg]       = useState("");

  const load = useCallback(() => {
    api("/launch/feedback").then(r => { if (r.ok) { setItems(r.items || []); setStats(r.stats); } });
  }, []);

  useEffect(() => {
    load();
    api("/launch/feedback/roadmap").then(r => r.ok && setRoadmap(r.roadmap));
  }, [load]);

  const submit = async () => {
    if (!form.title.trim()) { setMsg("Title required"); return; }
    const r = await post("/launch/feedback", form);
    if (r.ok) { setMsg("Submitted!"); setForm({ type: "feature", title: "", body: "" }); load(); }
    else setMsg(r.error || "Error");
  };

  const vote = async (id) => {
    await post(`/launch/feedback/${id}/vote`, {});
    load();
  };

  const typeColor = t => t === "bug" ? "fb-type-bug" : t === "feature" ? "fb-type-feature" : "fb-type-improvement";

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {["list", "submit", "roadmap"].map(v => (
          <button key={v} className={view === v ? "btn-primary" : "btn-secondary"} onClick={() => setView(v)}>
            {v === "list" ? "All Feedback" : v === "submit" ? "Submit" : "Roadmap"}
          </button>
        ))}
        {stats && <div style={{ marginLeft: "auto", fontSize: 11, color: "#666" }}>{stats.total} total</div>}
      </div>

      {view === "submit" && (
        <div className="feedback-form">
          <div className="fb-row">
            <select className="fb-select" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
              {["bug","feature","improvement","question"].map(t => <option key={t}>{t}</option>)}
            </select>
            <input className="fb-input" placeholder="Title…" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
          </div>
          <textarea className="fb-textarea" placeholder="Describe in detail…" value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} />
          {msg && <div className={msg.includes("!") ? "success-msg" : "error-msg"}>{msg}</div>}
          <button className="fb-submit" onClick={submit}>Submit</button>
        </div>
      )}

      {view === "list" && (
        <>
          {items.length === 0 && <div className="empty-state">No feedback yet.</div>}
          {items.map(item => (
            <div key={item.id} className="fb-item">
              <div className="fb-item-header">
                <span className={`fb-type-badge ${typeColor(item.type)}`}>{item.type}</span>
                <span className="fb-title">{item.title}</span>
                <span className="fb-votes">▲ {item.votes}</span>
                <button className="fb-vote-btn" onClick={() => vote(item.id)}>Vote</button>
              </div>
              {item.body && <div style={{ fontSize: 11, color: "#777", marginTop: 4 }}>{item.body.slice(0, 120)}{item.body.length > 120 ? "…" : ""}</div>}
            </div>
          ))}
        </>
      )}

      {view === "roadmap" && roadmap && (
        <>
          {["planned","in_progress","shipped"].map(status => (
            roadmap[status]?.length > 0 && (
              <div key={status}>
                <p className="launch-section-title">{status.replace("_"," ").toUpperCase()}</p>
                {roadmap[status].map(item => (
                  <div key={item.id} className="fb-item">
                    <div className="fb-item-header">
                      <span className={`fb-type-badge ${typeColor(item.type)}`}>{item.type}</span>
                      <span className="fb-title">{item.title}</span>
                      <span className="fb-votes">▲ {item.votes}</span>
                    </div>
                  </div>
                ))}
              </div>
            )
          ))}
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE 9: Launch Readiness Center
// ─────────────────────────────────────────────────────────────────────────────
function ReadinessPanel() {
  const [report, setReport] = useState(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    const r = await api("/launch/readiness");
    if (r.ok) setReport(r.report);
    setRunning(false);
  };

  useEffect(() => {
    api("/launch/readiness/last").then(r => r.ok && r.report && setReport(r.report));
  }, []);

  const statusLabel = s => s === "launch_ready" ? "Launch Ready" : s === "ready_with_warnings" ? "Ready (with warnings)" : "Blocked";

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <p className="launch-section-title" style={{ margin: 0 }}>Launch Readiness Center</p>
        <button className="btn-primary" onClick={run} disabled={running}>{running ? "Checking…" : "Run Checks"}</button>
      </div>

      {report ? (
        <>
          <div className="readiness-score">{report.score}%</div>
          <div className={`readiness-status ${report.status}`}>{statusLabel(report.status)}</div>

          <div className="launch-grid" style={{ marginBottom: 16 }}>
            <div className="launch-card"><h4>Passing</h4><div className="val" style={{ color: "#22c55e" }}>{report.passing}</div><div className="sub">of {report.total}</div></div>
            <div className="launch-card"><h4>Critical Fails</h4><div className="val" style={{ color: report.criticalFail ? "#ef4444" : "#22c55e" }}>{report.criticalFail}</div></div>
            <div className="launch-card"><h4>Warnings</h4><div className="val" style={{ color: report.warningFail ? "#f59e0b" : "#22c55e" }}>{report.warningFail}</div></div>
          </div>

          <div className="check-list">
            {(report.results || []).map(c => (
              <div key={c.id} className={`check-row ${c.pass ? "pass" : "fail"}`}>
                <span className="check-icon">{c.pass ? "✓" : "✗"}</span>
                <div style={{ flex: 1 }}>
                  <div className="check-label">{c.label}</div>
                  <div className="check-detail">{c.detail}</div>
                  {!c.pass && c.fix && <div className="check-detail" style={{ color: "#f59e0b" }}>Fix: {c.fix}</div>}
                </div>
                <span className={`check-sev ${c.severity}`}>{c.severity}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="empty-state">Click "Run Checks" to assess launch readiness.</div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE 10: Commercial Benchmark
// ─────────────────────────────────────────────────────────────────────────────
function BenchmarkPanel() {
  const [result, setResult]     = useState(null);
  const [running, setRunning]   = useState(false);
  const [custom, setCustom]     = useState(5000);
  const [customResult, setCustomResult] = useState(null);

  const run = async () => {
    setRunning(true);
    const r = await api("/launch/benchmark");
    if (r.ok) setResult(r);
    setRunning(false);
  };

  const simulate = async () => {
    const r = await post("/launch/benchmark/simulate", { users: custom });
    if (r.ok) setCustomResult(r.simulation);
  };

  const fmt = n => typeof n === "number" ? n.toLocaleString() : "–";

  const TierCard = ({ tier }) => (
    <div className="tier-card">
      <div className="tier-header">
        <span className="tier-users">{fmt(tier.userCount)} users</span>
        <span className={`tier-readiness ${tier.readiness}`}>{tier.readiness.replace("_", " ")}</span>
      </div>
      <div className="tier-row"><span className="t-lbl">Monthly Revenue</span><span className="t-val">${fmt(tier.revenue?.monthly)}</span></div>
      <div className="tier-row"><span className="t-lbl">AI Cost</span><span className="t-val">${fmt(tier.costs?.ai)}</span></div>
      <div className="tier-row"><span className="t-lbl">Gross Margin</span><span className="t-val">{tier.profit?.margin}%</span></div>
      <div className="tier-row"><span className="t-lbl">Infra Load</span><span className="t-val">{tier.ai?.load}</span></div>
      <div className="tier-row"><span className="t-lbl">Paying Users</span><span className="t-val">{fmt(tier.payingUsers)}</span></div>
    </div>
  );

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <p className="launch-section-title" style={{ margin: 0 }}>Commercial Benchmark</p>
        <button className="btn-primary" onClick={run} disabled={running}>{running ? "Simulating…" : "Run Benchmark"}</button>
      </div>

      {result && (
        <>
          <div className="launch-grid" style={{ marginBottom: 16 }}>
            <div className="launch-card accent"><h4>Score</h4><div className="val">{result.score}%</div><div className="sub">{result.passing}/{result.total} checks</div></div>
            <div className="launch-card"><h4>Regression</h4><div className="val">{result.regressionPass ? "PASS" : "FAIL"}</div><div className="sub" style={{ color: result.regressionPass ? "#22c55e" : "#ef4444" }}>{result.regressionPass ? "All checks pass" : "See issues below"}</div></div>
          </div>

          <div className="check-list" style={{ marginBottom: 20 }}>
            {(result.checks || []).map(c => (
              <div key={c.id} className={`check-row ${c.ok ? "pass" : "fail"}`}>
                <span className="check-icon">{c.ok ? "✓" : "✗"}</span>
                <span className="check-label">{c.label}</span>
              </div>
            ))}
          </div>

          <p className="launch-section-title">Scale Projections</p>
          <div className="tier-grid">
            {(result.tiers || []).map(t => <TierCard key={t.userCount} tier={t} />)}
          </div>
        </>
      )}

      <p className="launch-section-title" style={{ marginTop: 20 }}>Custom Simulation</p>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <input
          type="number" className="fb-input" style={{ width: 140 }}
          value={custom} min="1" max="10000000"
          onChange={e => setCustom(parseInt(e.target.value) || 1000)}
        />
        <span style={{ fontSize: 12, color: "#888" }}>users</span>
        <button className="btn-primary" onClick={simulate}>Simulate</button>
      </div>
      {customResult && (
        <div className="tier-card" style={{ maxWidth: 300 }}>
          <TierCard tier={customResult} />
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE 11: Product Completion Report
// ─────────────────────────────────────────────────────────────────────────────
function PCPReportPanel() {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [section, setSection] = useState("summary");

  const load = async () => {
    setLoading(true);
    const r = await api("/launch/pcp-report");
    if (r.ok) setReport(r.report);
    setLoading(false);
  };

  const SECTIONS = [
    { id: "summary",      label: "Summary"      },
    { id: "workflows",    label: "100 Workflows" },
    { id: "friction",     label: "Friction"      },
    { id: "blockers",     label: "Blockers"      },
    { id: "scores",       label: "Scores"        },
    { id: "selfbuild",    label: "Self-Build"    },
    { id: "a11y",         label: "Accessibility" },
    { id: "recommendation", label: "Verdict"     },
  ];

  const sevColor = s => s === "critical" ? "#ef4444" : s === "warning" ? "#f59e0b" : "#888";

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <p className="launch-section-title" style={{ margin: 0 }}>Product Completion Report — PCP-1</p>
        <button className="btn-primary" onClick={load} disabled={loading}>{loading ? "Generating…" : "Generate Report"}</button>
      </div>

      {!report && !loading && (
        <div style={{ textAlign: "center", padding: "40px 0", color: "#888" }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>◎</div>
          <div>Click Generate Report for a full audit — 100 workflows, friction points, accessibility, scores, and launch verdict.</div>
          <div style={{ marginTop: 8, fontSize: 11, color: "#666" }}>Shortcut: open Launch tab → PCP Report → Generate</div>
        </div>
      )}

      {report && (
        <>
          <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
            {SECTIONS.map(s => (
              <button
                key={s.id}
                className={`launch-tab${section === s.id ? " active" : ""}`}
                style={{ fontSize: 11, padding: "4px 10px" }}
                onClick={() => setSection(s.id)}
              >{s.label}</button>
            ))}
          </div>

          {section === "summary" && (
            <div className="launch-grid">
              <div className="launch-card accent">
                <h4>Daily Driver</h4>
                <div className="val">{report.dailyDriverScore?.overall}/100</div>
                <div className="sub">Reachability · Speed · Friction</div>
              </div>
              <div className="launch-card">
                <h4>Commercial</h4>
                <div className="val">{report.commercialScore?.overall}/100</div>
                <div className="sub">Revenue · Maturity · GTM</div>
              </div>
              <div className="launch-card">
                <h4>Workflows</h4>
                <div className="val">{report.summary?.reachability}</div>
                <div className="sub">{report.summary?.within2Interactions}</div>
              </div>
              <div className="launch-card">
                <h4>Self-Build?</h4>
                <div className="val" style={{ fontSize: 14 }}>{report.selfBuildAssessment?.verdict}</div>
                <div className="sub">{report.selfBuildAssessment?.available}/{report.selfBuildAssessment?.total} capabilities available</div>
              </div>
              <div className="launch-card">
                <h4>Friction Points</h4>
                <div className="val">{report.summary?.frictionPoints}</div>
                <div className="sub">Low severity, no blockers</div>
              </div>
              <div className="launch-card">
                <h4>Critical Blockers</h4>
                <div className="val" style={{ color: report.summary?.criticalBlockers > 0 ? "#ef4444" : "#22c55e" }}>
                  {report.summary?.criticalBlockers}
                </div>
                <div className="sub">{report.summary?.recommendation}</div>
              </div>
            </div>
          )}

          {section === "workflows" && (
            <div>
              <div style={{ fontSize: 12, color: "#888", marginBottom: 10 }}>
                {report.workflowAudit?.reachable}/{report.workflowAudit?.total} reachable &nbsp;·&nbsp;
                {report.workflowAudit?.within2Interactions} in ≤2 interactions &nbsp;·&nbsp;
                {report.workflowAudit?.frictionCount} with friction
              </div>
              <div className="check-list">
                {(report.workflowAudit?.workflows || []).map(w => (
                  <div key={w.id} className={`check-row ${w.reachable ? "pass" : "fail"}`}>
                    <span className="check-icon">{w.reachable ? "✓" : "✗"}</span>
                    <span className="check-label">[{w.id}] {w.category} — {w.flow}</span>
                    {w.interactions > 2 && <span style={{ marginLeft: "auto", fontSize: 10, color: "#f59e0b" }}>{w.interactions} interactions</span>}
                    {w.friction && <span style={{ marginLeft: 8, fontSize: 10, color: "#f59e0b" }}>{w.friction}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {section === "friction" && (
            <div className="check-list">
              {(report.frictionPoints || []).map(f => (
                <div key={f.id} className="check-row" style={{ borderLeft: `3px solid ${sevColor(f.severity)}` }}>
                  <span className="check-label">[{f.id}] <strong>{f.area}</strong> — {f.description}</span>
                  <span style={{ marginLeft: "auto", fontSize: 10, color: sevColor(f.severity), textTransform: "uppercase" }}>{f.severity}</span>
                </div>
              ))}
            </div>
          )}

          {section === "blockers" && (
            <div className="check-list">
              {(report.launchBlockers || []).map(b => (
                <div key={b.id} className={`check-row ${b.severity === "critical" ? "fail" : ""}`}>
                  <span className="check-icon" style={{ color: sevColor(b.severity) }}>!</span>
                  <span className="check-label"><strong>[{b.severity.toUpperCase()}]</strong> {b.blocker}</span>
                </div>
              ))}
            </div>
          )}

          {section === "scores" && (
            <div>
              <p className="launch-section-title">Daily Driver Breakdown</p>
              {Object.entries(report.dailyDriverScore?.scores || {}).map(([k, v]) => (
                <div key={k} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                  <span style={{ width: 160, fontSize: 12, color: "#aaa", textTransform: "capitalize" }}>{k.replace(/([A-Z])/g, " $1")}</span>
                  <div style={{ flex: 1, background: "#1a1a24", borderRadius: 4, height: 8 }}>
                    <div style={{ width: `${v}%`, background: v >= 80 ? "#22c55e" : v >= 60 ? "#f59e0b" : "#ef4444", height: "100%", borderRadius: 4 }} />
                  </div>
                  <span style={{ width: 40, fontSize: 12, textAlign: "right" }}>{v}%</span>
                </div>
              ))}
              <p className="launch-section-title" style={{ marginTop: 20 }}>Commercial Breakdown</p>
              {Object.entries(report.commercialScore?.scores || {}).map(([k, v]) => (
                <div key={k} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                  <span style={{ width: 160, fontSize: 12, color: "#aaa", textTransform: "capitalize" }}>{k.replace(/([A-Z])/g, " $1")}</span>
                  <div style={{ flex: 1, background: "#1a1a24", borderRadius: 4, height: 8 }}>
                    <div style={{ width: `${v}%`, background: v >= 80 ? "#22c55e" : v >= 60 ? "#f59e0b" : "#ef4444", height: "100%", borderRadius: 4 }} />
                  </div>
                  <span style={{ width: 40, fontSize: 12, textAlign: "right" }}>{v}%</span>
                </div>
              ))}
            </div>
          )}

          {section === "selfbuild" && (
            <div>
              <div style={{ marginBottom: 12 }}>
                <span style={{ fontSize: 18, fontWeight: 700 }}>Can Ehtesham build Ooplix using only Ooplix?</span>
                <span style={{ marginLeft: 12, fontSize: 16, color: "#7c6af7" }}>{report.selfBuildAssessment?.verdict}</span>
              </div>
              <div style={{ fontSize: 12, color: "#888", marginBottom: 12 }}>
                {report.selfBuildAssessment?.available}/{report.selfBuildAssessment?.total} capabilities available
                ({report.selfBuildAssessment?.pct}%)
              </div>
              <div className="check-list">
                {(report.selfBuildAssessment?.capabilities || []).map((c, i) => (
                  <div key={i} className={`check-row ${c.available ? "pass" : "fail"}`}>
                    <span className="check-icon">{c.available ? "✓" : "✗"}</span>
                    <span className="check-label">{c.task}</span>
                    <span style={{ marginLeft: "auto", fontSize: 10, color: "#888" }}>{c.tool}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {section === "a11y" && (
            <div>
              <div style={{ marginBottom: 12, fontSize: 12, color: "#888" }}>
                Score: {report.accessibilityAudit?.score}% &nbsp;·&nbsp;
                {report.accessibilityAudit?.pass} pass, {report.accessibilityAudit?.partial} partial, {report.accessibilityAudit?.fail} fail
              </div>
              <div className="check-list">
                {(report.accessibilityAudit?.checks || []).map(c => (
                  <div key={c.id} className={`check-row ${c.status === "pass" ? "pass" : c.status === "fail" ? "fail" : ""}`}>
                    <span className="check-icon" style={{ color: c.status === "pass" ? "#22c55e" : c.status === "fail" ? "#ef4444" : "#f59e0b" }}>
                      {c.status === "pass" ? "✓" : c.status === "fail" ? "✗" : "~"}
                    </span>
                    <div>
                      <div className="check-label">{c.area}</div>
                      <div style={{ fontSize: 10, color: "#888" }}>{c.note}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {section === "recommendation" && (
            <div>
              <div style={{
                padding: 20,
                borderRadius: 8,
                border: `2px solid ${
                  report.launchRecommendation?.recommendation === "LAUNCH READY" ? "#22c55e" :
                  report.launchRecommendation?.recommendation === "LAUNCH WITH WARNINGS" ? "#f59e0b" : "#ef4444"
                }`,
                marginBottom: 20,
              }}>
                <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>{report.launchRecommendation?.recommendation}</div>
                <div style={{ fontSize: 13, color: "#aaa" }}>{report.launchRecommendation?.reason}</div>
                {report.launchRecommendation?.daysToLaunch > 0 && (
                  <div style={{ marginTop: 8, fontSize: 12, color: "#888" }}>
                    Estimated {report.launchRecommendation?.daysToLaunch} day(s) to clear blockers
                  </div>
                )}
              </div>
              {(report.launchRecommendation?.priority || []).length > 0 && (
                <>
                  <p className="launch-section-title">Priority Actions</p>
                  <div className="check-list">
                    {report.launchRecommendation.priority.map((p, i) => (
                      <div key={i} className="check-row">
                        <span className="check-icon" style={{ color: "#7c6af7" }}>{i + 1}</span>
                        <span className="check-label">{p}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE 12: Production Integration Report (PIP-1)
// ─────────────────────────────────────────────────────────────────────────────
function PIPReportPanel() {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("all");

  const load = async () => {
    setLoading(true);
    const r = await api("/launch/pip-report");
    if (r.ok) setReport(r.report);
    setLoading(false);
  };

  const STATUS_META = {
    production_ready:       { label: "Production Ready",       color: "#22c55e", bg: "#0f2e1e" },
    needs_credentials:      { label: "Needs Credentials",      color: "#f59e0b", bg: "#2e2a0f" },
    needs_external_account: { label: "Needs External Account", color: "#7c6af7", bg: "#1e1a2e" },
    deferred_by_design:     { label: "Deferred by Design",     color: "#888",    bg: "#1a1a1a" },
  };

  const filteredList = report
    ? (filter === "all" ? report.integrations : report.integrations.filter(i => i.status === filter))
    : [];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <p className="launch-section-title" style={{ margin: 0 }}>Production Integration Report — PIP-1</p>
        <button className="btn-primary" onClick={load} disabled={loading}>{loading ? "Auditing…" : "Run Audit"}</button>
      </div>

      {!report && !loading && (
        <div style={{ textAlign: "center", padding: "40px 0", color: "#888" }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>⬡</div>
          <div>Audits every integration point — AI providers, billing, email, SMS, WhatsApp, browser automation, creative studio, marketplace, analytics, growth, founder OS, and launch platform.</div>
          <div style={{ marginTop: 8, fontSize: 11, color: "#555" }}>Classifies as: Production Ready · Needs Credentials · Needs External Account · Deferred by Design</div>
        </div>
      )}

      {report && (
        <>
          <div className="launch-grid" style={{ marginBottom: 16 }}>
            <div className="launch-card accent">
              <h4>Readiness Score</h4>
              <div className="val">{report.readinessScore}%</div>
              <div className="sub">{report.total} integrations audited</div>
            </div>
            {Object.entries(report.summary).map(([status, count]) => {
              const m = STATUS_META[status] || {};
              return (
                <div key={status} className="launch-card" style={{ borderLeft: `3px solid ${m.color}` }}>
                  <h4 style={{ color: m.color }}>{m.label}</h4>
                  <div className="val">{count}</div>
                  <div className="sub">{Math.round(count / report.total * 100)}% of integrations</div>
                </div>
              );
            })}
          </div>

          <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
            <button className={`launch-tab${filter === "all" ? " active" : ""}`} style={{ fontSize: 11, padding: "3px 10px" }} onClick={() => setFilter("all")}>All ({report.total})</button>
            {Object.entries(STATUS_META).map(([s, m]) => (
              <button key={s} className={`launch-tab${filter === s ? " active" : ""}`} style={{ fontSize: 11, padding: "3px 10px", color: m.color }} onClick={() => setFilter(s)}>
                {m.label} ({report.summary[s] || 0})
              </button>
            ))}
          </div>

          <div className="check-list">
            {filteredList.map(intg => {
              const m = STATUS_META[intg.status] || {};
              return (
                <div key={intg.id} className="check-row" style={{ borderLeft: `3px solid ${m.color}`, flexDirection: "column", alignItems: "flex-start", gap: 3 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", width: "100%" }}>
                    <span style={{ fontSize: 10, color: "#555", width: 120, flexShrink: 0 }}>{intg.category}</span>
                    <span className="check-label" style={{ flex: 1 }}>{intg.name}</span>
                    <span style={{ fontSize: 10, color: m.color, background: m.bg, padding: "1px 6px", borderRadius: 8, whiteSpace: "nowrap" }}>{m.label}</span>
                  </div>
                  <div style={{ fontSize: 10, color: "#666", paddingLeft: 128 }}>{intg.detail}</div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Root component
// ─────────────────────────────────────────────────────────────────────────────
export default function LaunchPlatform() {
  const [tab, setTab] = useState("dashboard");

  const panels = {
    dashboard:  <DashboardPanel  />,
    onboarding: <OnboardingPanel />,
    workspaces: <WorkspacesPanel />,
    docs:       <DocsPanel       />,
    academy:    <AcademyPanel    />,
    referral:   <ReferralPanel   />,
    cst:        <CSTPanel        />,
    feedback:   <FeedbackPanel   />,
    readiness:  <ReadinessPanel  />,
    benchmark:  <BenchmarkPanel  />,
    pcpreport:  <PCPReportPanel  />,
    pipreport:  <PIPReportPanel  />,
  };

  return (
    <div className="launch-platform">
      <div className="launch-tabs">
        {TABS.map(t => (
          <button key={t.id} className={`launch-tab${tab === t.id ? " active" : ""}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="launch-content">
        {panels[tab]}
      </div>
    </div>
  );
}
