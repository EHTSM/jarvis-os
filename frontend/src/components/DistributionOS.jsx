import React, { useState, useEffect, useCallback } from "react";
import "./DistributionOS.css";

const BASE  = process.env.REACT_APP_API_URL || "";
const api   = (path, opts = {}) =>
  fetch(`${BASE}${path}`, { credentials: "include", ...opts }).then(r => r.json());
const post  = (path, body) => api(path, { method: "POST",  headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const patch = (path, body) => api(path, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const TABS = [
  { id: "executive",   label: "Executive",    icon: "◎" },
  { id: "publisher",   label: "Publisher",    icon: "◉" },
  { id: "campaigns",   label: "Campaigns",    icon: "⚡" },
  { id: "influencers", label: "Influencers",  icon: "◇" },
  { id: "community",   label: "Community",    icon: "⬡" },
  { id: "referral",    label: "Referral",     icon: "⊞" },
  { id: "launches",    label: "Launches",     icon: "◈" },
  { id: "analytics",   label: "Analytics",    icon: "◎" },
  { id: "performance", label: "Performance",  icon: "✦" },
  { id: "benchmark",   label: "Benchmark",    icon: "⬢" },
];

// ── helpers ───────────────────────────────────────────────────────────────────

function Chip({ children, color }) {
  return <span className={`do-chip${color ? ` do-chip-${color}` : ""}`}>{children}</span>;
}

function StatCard({ label, value, sub, accent }) {
  return (
    <div className="do-stat-card" style={accent ? { borderTop: `2px solid ${accent}` } : {}}>
      <div className="do-stat-val" style={accent ? { color: accent } : {}}>{value ?? "—"}</div>
      <div className="do-stat-lbl">{label}</div>
      {sub && <div className="do-stat-sub">{sub}</div>}
    </div>
  );
}

function StatusDot({ status }) {
  const c = ["published","live","active","approved","launched"].includes(status) ? "green"
          : ["scheduled","in_review","ready"].includes(status) ? "yellow"
          : ["failed","cancelled","rejected"].includes(status) ? "red"
          : "gray";
  return <span className={`do-dot do-dot-${c}`} />;
}

function ScoreBar({ label, value, accent }) {
  const pct = Math.min(100, Math.max(0, value || 0));
  const col = accent || (pct >= 80 ? "#22c55e" : pct >= 50 ? "#f59e0b" : "#ef4444");
  return (
    <div className="do-score-row">
      <span className="do-score-label">{label}</span>
      <div className="do-score-track"><div className="do-score-fill" style={{ width: `${pct}%`, background: col }} /></div>
      <span className="do-score-val" style={{ color: col }}>{pct}</span>
    </div>
  );
}

function useDistrib(path, deps = []) {
  const [data, setData] = useState(null);
  const load = useCallback(() => { api(path).then(r => r.ok !== false && setData(r)); }, [path]);
  useEffect(() => { load(); }, [...deps, load]);
  return [data, load];
}

function useToast() {
  const [msg, setMsg] = useState("");
  const toast = (m) => { setMsg(m); setTimeout(() => setMsg(""), 3000); };
  const Toast = msg ? <span className="do-toast">{msg}</span> : null;
  return [toast, Toast];
}

// ── MODULE 9: Executive Growth Center ────────────────────────────────────────

function ExecutivePanel() {
  const [dash, reload] = useDistrib("/distrib/executive");
  if (!dash?.dashboard) return <div className="do-loading">Loading…</div>;
  const d = dash.dashboard;

  return (
    <div>
      <div className="do-section-hdr">
        <span className="do-section-title">Executive Growth Center — G3 Distribution Engine</span>
        <button className="do-btn-sm" onClick={reload}>Refresh</button>
      </div>

      <div className="do-channel-grid">
        {[
          { label: "Traffic & Reach",  icon: "◎", color: "#7c6fff", stats: [`${(d.traffic?.totalReach||0).toLocaleString()} total reach`, `${(d.traffic?.totalClicks||0).toLocaleString()} clicks`, `${d.traffic?.publishJobs||0} publish jobs`, `Top: ${d.traffic?.topPlatform||"—"}`] },
          { label: "Social Growth",    icon: "◉", color: "#22c55e", stats: [`${d.social?.posts||0} published posts`, `${(d.social?.totalEngagement||0).toLocaleString()} engagement`, `${d.social?.engagementRate}% rate`, `Virality ${d.social?.viralityScore}`] },
          { label: "Community",        icon: "⬡", color: "#4ecdc4", stats: [`${d.community?.total||0} communities`, `${(d.community?.totalMembers||0).toLocaleString()} members`, `${(d.community?.activeMembers||0).toLocaleString()} active`, `Top: ${d.community?.topCommunity||"—"}`] },
          { label: "Referrals",        icon: "⊞", color: "#f59e0b", stats: [`${d.referrals?.activeCampaigns||0} active campaigns`, `${d.referrals?.totalInvites||0} invites`, `${d.referrals?.conversions||0} conversions`, ""] },
          { label: "Influencers",      icon: "◇", color: "#ef4444", stats: [`${d.influencers?.total||0} discovered`, `${d.influencers?.contacted||0} contacted`, `${d.influencers?.inConversation||0} in convo`, `${(d.influencers?.totalFollowers||0).toLocaleString()} total followers`] },
          { label: "Launches",         icon: "◈", color: "#a78bfa", stats: [`${d.launches?.active||0} active`, `${d.launches?.launched||0} launched`, `${d.launches?.upcoming||0} upcoming`, ""] },
        ].map(({ label, icon, color, stats }) => (
          <div key={label} className="do-exec-card" style={{ borderTop: `2px solid ${color}` }}>
            <div className="do-exec-icon" style={{ color }}>{icon}</div>
            <div className="do-exec-label">{label}</div>
            {stats.filter(Boolean).map((s, i) => <div key={i} className="do-exec-stat">{s}</div>)}
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
        <div className="do-card">
          <div className="do-card-title">Campaign Overview</div>
          <div className="do-kv-row"><span className="do-kv-key">Active Campaigns</span><span className="do-kv-val" style={{ color: "#22c55e" }}>{d.campaigns?.live || 0}</span></div>
          <div className="do-kv-row"><span className="do-kv-key">Total Campaigns</span><span className="do-kv-val">{d.campaigns?.total || 0}</span></div>
          <div className="do-kv-row"><span className="do-kv-key">Campaign Reach</span><span className="do-kv-val">{(d.campaigns?.totalCampaignReach||0).toLocaleString()}</span></div>
        </div>
        <div className="do-card">
          <div className="do-card-title">Organic Growth (Content AI)</div>
          <div className="do-kv-row"><span className="do-kv-key">Top Performers</span><span className="do-kv-val">{d.organic?.topPerformers?.length || 0} tracked</span></div>
          <div className="do-kv-row"><span className="do-kv-key">Republish Ready</span><span className="do-kv-val" style={{ color: "#f59e0b" }}>{d.organic?.republishReady || 0} pieces</span></div>
          {(d.organic?.topPerformers||[]).slice(0,2).map(p => (
            <div key={p.jobId} className="do-kv-row">
              <span className="do-kv-key">{p.title?.slice(0,24) || p.jobId}</span>
              <span className="do-kv-val" style={{ color: "#7c6fff" }}>score {p.score}</span>
            </div>
          ))}
        </div>
      </div>

      {(d.referrals?.leaderboard||[]).length > 0 && (
        <div className="do-card" style={{ marginTop: 12 }}>
          <div className="do-card-title">Referral Leaderboard (top 5)</div>
          <div className="do-list">
            {d.referrals.leaderboard.slice(0,5).map((r, i) => (
              <div key={r.accountId} className="do-row">
                <span className="do-rank">#{i+1}</span>
                <span className="do-row-name">{r.accountId}</span>
                <span className="do-row-meta">{r.invites} invites</span>
                <span className="do-row-meta">{r.totalEarned} credits</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── MODULE 1: Universal Publisher ─────────────────────────────────────────────

const PLATFORM_ICONS = { linkedin: "◉", facebook: "◈", instagram: "◇", x: "✕", threads: "⬡", pinterest: "⬢", youtube: "▷", telegram: "◎", whatsapp_channel: "⊞", medium: "✦", wordpress: "◈", discord: "◉", reddit: "◈", github_discussions: "⬡", slack: "◇", whatsapp_group: "⊞", circle: "◎", skool: "✦" };

function PublisherPanel() {
  const [jobs,    reload]  = useDistrib("/distrib/publish/jobs");
  const [plats]            = useDistrib("/distrib/platforms");
  const [view,    setView] = useState("jobs");
  const [selected, setSelected] = useState([]);
  const [form,    setForm] = useState({ title: "", content: "", contentType: "post", requireApproval: false, scheduledAt: "" });
  const [toast,   Toast]   = useToast();

  const allPlatforms = plats?.platforms || [];
  const toggle = (id) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

  const create = async () => {
    if (!form.title || !form.content) return;
    const platforms = selected.length > 0 ? selected : allPlatforms.map(p => p.id);
    const job = await post("/distrib/publish/jobs", { ...form, platforms });
    if (job.ok !== false) { toast("Publish job created"); reload(); setView("jobs"); setForm({ title: "", content: "", contentType: "post", requireApproval: false, scheduledAt: "" }); setSelected([]); }
  };

  const approve = async (id) => {
    await post(`/distrib/publish/jobs/${id}/approve`, {});
    toast("Job approved");
    reload();
  };

  const publish = async (id) => {
    const r = await post(`/distrib/publish/jobs/${id}/publish`, {});
    if (r.error) { toast(`Error: ${r.error}`); } else { toast("Published to all platforms!"); reload(); }
  };

  const list = jobs?.jobs || [];

  return (
    <div>
      <div className="do-sub-tabs">
        {["jobs","create"].map(v => (
          <button key={v} className={`do-sub-tab${view === v ? " active" : ""}`} onClick={() => setView(v)}>
            {v === "create" ? "+ New Post" : `Jobs (${list.length})`}
          </button>
        ))}
        {Toast}
      </div>

      {view === "jobs" && (
        <div>
          <div className="do-stats-grid" style={{ marginBottom: 10 }}>
            <StatCard label="Total"     value={list.length} />
            <StatCard label="Published" value={list.filter(j => j.platforms?.every(p => p.status === "published")).length} accent="#22c55e" />
            <StatCard label="Pending"   value={list.filter(j => j.approvalState === "pending").length} accent="#f59e0b" />
            <StatCard label="Platforms" value={allPlatforms.length} />
          </div>

          <div className="do-platform-row">
            {allPlatforms.map(p => (
              <div key={p.id} className="do-platform-badge">
                <span>{PLATFORM_ICONS[p.id] || "◎"}</span>
                <span>{p.label}</span>
              </div>
            ))}
          </div>

          <div className="do-list" style={{ marginTop: 8 }}>
            {list.length === 0 && <div className="do-empty">No publish jobs. Create your first one-click multi-platform post.</div>}
            {list.map(j => (
              <div key={j.id} className="do-row">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="do-row-name">{j.title}</div>
                  <div className="do-row-meta">
                    {j.platforms?.length} platforms · reach {(j.stats?.reach||0).toLocaleString()} · {j.stats?.engagement||0} eng.
                  </div>
                  <div className="do-platform-status-row">
                    {j.platforms?.map(p => (
                      <span key={p.platform} className={`do-pf-pill do-pf-${p.status === "published" ? "ok" : p.status === "failed" ? "fail" : "pending"}`}>
                        {PLATFORM_ICONS[p.platform] || "◎"} {p.platform}
                      </span>
                    ))}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexDirection: "column", alignItems: "flex-end" }}>
                  {j.requireApproval && j.approvalState === "pending" && (
                    <button className="do-btn-sm" style={{ color: "#f59e0b" }} onClick={() => approve(j.id)}>Approve</button>
                  )}
                  {(j.approvalState === "approved" || !j.requireApproval) && j.platforms?.some(p => p.status === "queued") && (
                    <button className="do-btn-sm" style={{ color: "#22c55e" }} onClick={() => publish(j.id)}>Publish All</button>
                  )}
                  <Chip color={j.approvalState === "approved" ? "green" : "gray"}>{j.approvalState}</Chip>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {view === "create" && (
        <div>
          <div className="do-platform-selector">
            {allPlatforms.map(p => (
              <button key={p.id} className={`do-pf-toggle${selected.includes(p.id) ? " active" : ""}`} onClick={() => toggle(p.id)}>
                <span>{PLATFORM_ICONS[p.id] || "◎"}</span>
                <span>{p.label}</span>
                <span className="do-pf-cat">{p.category}</span>
              </button>
            ))}
          </div>
          <div className="do-form">
            <div className="do-form-title">New Publish Job — {selected.length === 0 ? "All 11 Platforms" : `${selected.length} selected`}</div>
            <div className="do-form-row">
              <input className="do-input" style={{ flex: 1 }} placeholder="Title *" value={form.title} onChange={e => setForm(f => ({...f, title: e.target.value}))} />
              <select className="do-select" value={form.contentType} onChange={e => setForm(f => ({...f, contentType: e.target.value}))}>
                {["post","article","video","reel","story","thread"].map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <textarea className="do-textarea" placeholder="Content *" value={form.content} onChange={e => setForm(f => ({...f, content: e.target.value}))} />
            <div className="do-form-row" style={{ marginTop: 8 }}>
              <input type="datetime-local" className="do-input" value={form.scheduledAt} onChange={e => setForm(f => ({...f, scheduledAt: e.target.value}))} />
              <label className="do-check-label">
                <input type="checkbox" checked={form.requireApproval} onChange={e => setForm(f => ({...f, requireApproval: e.target.checked}))} />
                Require Approval
              </label>
              <button className="do-btn" onClick={create}>Create Job</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── MODULE 2: Campaign Orchestrator ──────────────────────────────────────────

function CampaignPanel() {
  const [camps,  reload] = useDistrib("/distrib/campaigns");
  const [view,   setView] = useState("list");
  const [form,   setForm] = useState({ name: "", description: "", type: "launch", channels: "", startDate: "", endDate: "", approvalRequired: false });
  const [toast,  Toast]  = useToast();

  const create = async () => {
    if (!form.name) return;
    const payload = { ...form, channels: form.channels.split(",").map(c => c.trim()).filter(Boolean) };
    await post("/distrib/campaigns", payload);
    setForm({ name: "", description: "", type: "launch", channels: "", startDate: "", endDate: "", approvalRequired: false });
    toast("Campaign created");
    reload();
    setView("list");
  };

  const approve = async (id) => {
    await post(`/distrib/campaigns/${id}/approve`, { note: "Approved" });
    toast("Campaign approved");
    reload();
  };

  const launch = async (id) => {
    const r = await post(`/distrib/campaigns/${id}/launch`, {});
    if (r.error) toast(`Error: ${r.error}`);
    else { toast("Campaign launched!"); reload(); }
  };

  const list = camps?.campaigns || [];
  const STATUS_COLOR = { live: "#22c55e", ready: "#4ecdc4", planning: "#888", completed: "#7c6fff", paused: "#f59e0b", cancelled: "#ef4444" };

  return (
    <div>
      <div className="do-sub-tabs">
        {["list","create"].map(v => (
          <button key={v} className={`do-sub-tab${view === v ? " active" : ""}`} onClick={() => setView(v)}>
            {v === "create" ? "+ New Campaign" : `Campaigns (${list.length})`}
          </button>
        ))}
        {Toast}
      </div>

      {view === "list" && (
        <div>
          <div className="do-stats-grid" style={{ marginBottom: 10 }}>
            {["planning","ready","live","completed"].map(s => (
              <StatCard key={s} label={s} value={list.filter(c => c.status === s).length} accent={STATUS_COLOR[s]} />
            ))}
          </div>
          <div className="do-list">
            {list.length === 0 && <div className="do-empty">No campaigns. Orchestrate multi-channel launches with scheduling, approval, and retry.</div>}
            {list.map(c => (
              <div key={c.id} className="do-row">
                <StatusDot status={c.status} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="do-row-name">{c.name}</div>
                  <div className="do-row-meta">
                    {c.type} · {c.channels?.length || 0} channels
                    {c.schedule?.startDate ? ` · Start: ${c.schedule.startDate}` : ""}
                  </div>
                  {c.channels?.length > 0 && (
                    <div className="do-tag-row">{c.channels.slice(0,5).map(ch => <Chip key={ch}>{ch}</Chip>)}</div>
                  )}
                  {(c.stats?.reach || 0) > 0 && (
                    <div className="do-row-meta">Reach: {c.stats.reach.toLocaleString()} · Engagement: {c.stats.engagement.toLocaleString()}</div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 4, flexDirection: "column", alignItems: "flex-end" }}>
                  <Chip color={c.status === "live" ? "green" : c.status === "ready" ? "" : "gray"}>{c.status}</Chip>
                  {c.approvalRequired && c.approvalState === "pending" && <button className="do-btn-sm" style={{ color: "#f59e0b" }} onClick={() => approve(c.id)}>Approve</button>}
                  {c.status === "ready" && <button className="do-btn-sm" style={{ color: "#22c55e" }} onClick={() => launch(c.id)}>Launch</button>}
                  {c.status === "planning" && !c.approvalRequired && <button className="do-btn-sm" style={{ color: "#22c55e" }} onClick={() => launch(c.id)}>Launch</button>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {view === "create" && (
        <div className="do-form">
          <div className="do-form-title">New Campaign</div>
          <div className="do-form-row">
            <input className="do-input" style={{ flex: 1 }} placeholder="Campaign name *" value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} />
            <select className="do-select" value={form.type} onChange={e => setForm(f => ({...f, type: e.target.value}))}>
              {["launch","awareness","conversion","retargeting","community"].map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <input className="do-input" style={{ width: "100%", marginBottom: 8 }} placeholder="Description" value={form.description} onChange={e => setForm(f => ({...f, description: e.target.value}))} />
          <input className="do-input" style={{ width: "100%", marginBottom: 8 }} placeholder="Channels (email, social, community, press…)" value={form.channels} onChange={e => setForm(f => ({...f, channels: e.target.value}))} />
          <div className="do-form-row">
            <input type="date" className="do-input" value={form.startDate} onChange={e => setForm(f => ({...f, startDate: e.target.value}))} />
            <input type="date" className="do-input" value={form.endDate}   onChange={e => setForm(f => ({...f, endDate: e.target.value}))} />
            <label className="do-check-label">
              <input type="checkbox" checked={form.approvalRequired} onChange={e => setForm(f => ({...f, approvalRequired: e.target.checked}))} />
              Require Approval
            </label>
            <button className="do-btn" onClick={create}>Create</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── MODULE 3: Influencer Outreach ─────────────────────────────────────────────

function InfluencerPanel() {
  const [infls,  reload]  = useDistrib("/distrib/influencers");
  const [view,   setView] = useState("list");
  const [filter, setFilter] = useState("all");
  const [form,   setForm] = useState({ name: "", handle: "", platform: "instagram", followers: "", niche: "", email: "" });
  const [draft,  setDraft] = useState(null);
  const [draftId, setDraftId] = useState(null);
  const [toast,  Toast]  = useToast();

  const add = async () => {
    if (!form.name) return;
    const payload = { ...form, followers: Number(form.followers) || 0, niche: form.niche.split(",").map(n => n.trim()).filter(Boolean) };
    await post("/distrib/influencers", payload);
    setForm({ name: "", handle: "", platform: "instagram", followers: "", niche: "", email: "" });
    toast("Influencer added");
    reload();
    setView("list");
  };

  const getDraft = async (id) => {
    const r = await post(`/distrib/influencers/${id}/draft`, { campaign: "Ooplix Distribution", senderName: "Altamash" });
    if (r.ok !== false) { setDraft(r.draft); setDraftId(id); }
  };

  const logOutreach = async (id) => {
    await post(`/distrib/influencers/${id}/outreach`, { type: "dm", message: "Sent AI draft", status: "sent" });
    toast("Outreach logged");
    reload();
  };

  const list    = infls?.influencers || [];
  const intel   = infls?.intelligence;
  const TIERS   = ["nano","micro","macro","mega"];
  const TIER_COLOR = { nano: "#888", micro: "#f59e0b", macro: "#7c6fff", mega: "#22c55e" };
  const STATUS_LABEL = { discovered: "discovered", contacted: "contacted", in_conversation: "talking", partner: "partner" };

  const filtered = filter === "all" ? list : list.filter(i => i.tier === filter || i.platform === filter || i.status === filter);

  return (
    <div>
      <div className="do-sub-tabs">
        {["list","add"].map(v => (
          <button key={v} className={`do-sub-tab${view === v ? " active" : ""}`} onClick={() => setView(v)}>
            {v === "add" ? "+ Add Influencer" : `Creators (${list.length})`}
          </button>
        ))}
        {Toast}
      </div>

      {intel && (
        <div className="do-stats-grid" style={{ margin: "8px 0" }}>
          <StatCard label="Total"          value={intel.total} />
          <StatCard label="Contacted"      value={intel.contacted}       accent="#f59e0b" />
          <StatCard label="In Convo"       value={intel.inConversation}  accent="#22c55e" />
          <StatCard label="Total Followers" value={`${((intel.totalFollowers||0)/1000).toFixed(0)}K`} accent="#7c6fff" />
          <StatCard label="Follow-ups Due"  value={intel.followUpsDue}    accent="#ef4444" />
        </div>
      )}

      {view === "list" && (
        <div>
          <div className="do-filter-row">
            {["all","nano","micro","macro","mega"].map(f => (
              <button key={f} className={`do-filter-btn${filter === f ? " active" : ""}`} onClick={() => setFilter(f)}>{f}</button>
            ))}
          </div>
          <div className="do-list" style={{ marginTop: 8 }}>
            {filtered.length === 0 && <div className="do-empty">No influencers discovered yet. Add creators to your outreach pipeline.</div>}
            {filtered.map(inf => (
              <div key={inf.id} className="do-row">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="do-row-name">{inf.name} <span style={{ color: "#555" }}>{inf.handle}</span></div>
                  <div className="do-row-meta">
                    {inf.platform} · {(inf.followers||0).toLocaleString()} followers · {(inf.niche||[]).join(", ")}
                  </div>
                  {inf.outreachHistory?.length > 0 && (
                    <div className="do-row-meta">{inf.outreachHistory.length} outreach touchpoints · relationship: {inf.relationship}</div>
                  )}
                </div>
                <Chip color={TIER_COLOR[inf.tier] ? "" : "gray"}><span style={{ color: TIER_COLOR[inf.tier] }}>{inf.tier}</span></Chip>
                <Chip color={inf.status === "in_conversation" ? "green" : "gray"}>{STATUS_LABEL[inf.status] || inf.status}</Chip>
                <button className="do-btn-sm" onClick={() => getDraft(inf.id)}>AI Draft</button>
                {inf.status === "discovered" && <button className="do-btn-sm" onClick={() => logOutreach(inf.id)}>Log Outreach</button>}
              </div>
            ))}
          </div>
          {draft && (
            <div className="do-prompt-box" style={{ marginTop: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span className="do-sub-title">AI Outreach Draft</span>
                <button className="do-btn-sm" onClick={() => { setDraft(null); setDraftId(null); }}>✕</button>
              </div>
              <div className="do-row-name" style={{ marginBottom: 4 }}>{draft.subject}</div>
              <pre className="do-prompt-body">{draft.body}</pre>
              <div className="do-form-row" style={{ marginTop: 8 }}>
                <Chip>via {draft.channel}</Chip>
                <button className="do-btn-sm" onClick={() => { logOutreach(draftId); setDraft(null); }}>Mark as Sent</button>
              </div>
            </div>
          )}
        </div>
      )}

      {view === "add" && (
        <div className="do-form">
          <div className="do-form-title">Add Influencer</div>
          <div className="do-form-row">
            <input className="do-input" placeholder="Full name *" value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} />
            <input className="do-input" placeholder="Handle (@username)" value={form.handle} onChange={e => setForm(f => ({...f, handle: e.target.value}))} />
            <select className="do-select" value={form.platform} onChange={e => setForm(f => ({...f, platform: e.target.value}))}>
              {["instagram","youtube","linkedin","x","threads","tiktok","pinterest"].map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="do-form-row">
            <input type="number" className="do-input" placeholder="Followers" value={form.followers} onChange={e => setForm(f => ({...f, followers: e.target.value}))} />
            <input className="do-input" placeholder="Niches (tech, automation, india…)" style={{ flex: 2 }} value={form.niche} onChange={e => setForm(f => ({...f, niche: e.target.value}))} />
            <input className="do-input" placeholder="Email (optional)" value={form.email} onChange={e => setForm(f => ({...f, email: e.target.value}))} />
          </div>
          <button className="do-btn" onClick={add}>Add to Pipeline</button>
        </div>
      )}
    </div>
  );
}

// ── MODULE 4: Community Hub ───────────────────────────────────────────────────

function CommunityPanel() {
  const [comms,  reload] = useDistrib("/distrib/communities");
  const [view,   setView] = useState("list");
  const [form,   setForm] = useState({ platform: "discord", name: "", url: "", inviteUrl: "", memberCount: "" });
  const [calForm, setCalForm] = useState({ title: "", type: "post", date: "", content: "" });
  const [wfForm,  setWfForm]  = useState({ name: "", trigger: "new_member", actions: "" });
  const [activeCom, setActiveCom] = useState(null);
  const [toast,  Toast]  = useToast();

  const add = async () => {
    if (!form.name) return;
    await post("/distrib/communities", { ...form, memberCount: Number(form.memberCount) || 0 });
    setForm({ platform: "discord", name: "", url: "", inviteUrl: "", memberCount: "" });
    toast("Community added");
    reload();
    setView("list");
  };

  const addCalEntry = async (id) => {
    if (!calForm.title) return;
    await post(`/distrib/communities/${id}/calendar`, calForm);
    toast("Calendar entry added");
    setCalForm({ title: "", type: "post", date: "", content: "" });
    reload();
  };

  const addWorkflow = async (id) => {
    if (!wfForm.name) return;
    await post(`/distrib/communities/${id}/workflow`, { ...wfForm, actions: wfForm.actions.split(",").map(a => a.trim()).filter(Boolean) });
    toast("Workflow created");
    setWfForm({ name: "", trigger: "new_member", actions: "" });
    reload();
  };

  const list  = comms?.communities || [];
  const stats = comms?.stats;

  return (
    <div>
      <div className="do-sub-tabs">
        {["list","add"].map(v => (
          <button key={v} className={`do-sub-tab${view === v ? " active" : ""}`} onClick={() => setView(v)}>
            {v === "add" ? "+ Add Community" : `Communities (${list.length})`}
          </button>
        ))}
        {Toast}
      </div>

      {stats && (
        <div className="do-stats-grid" style={{ margin: "8px 0" }}>
          <StatCard label="Communities"   value={stats.total} />
          <StatCard label="Total Members" value={(stats.totalMembers||0).toLocaleString()} accent="#22c55e" />
          <StatCard label="Active Members" value={(stats.totalActive||0).toLocaleString()} accent="#7c6fff" />
          <StatCard label="Top Community" value={stats.topCommunity?.name || "—"} />
        </div>
      )}

      {view === "list" && (
        <div>
          <div className="do-list">
            {list.length === 0 && <div className="do-empty">No communities. Add Discord, Telegram, Reddit, or GitHub Discussions to your hub.</div>}
            {list.map(c => (
              <div key={c.id}>
                <div className="do-row" onClick={() => setActiveCom(activeCom?.id === c.id ? null : c)} style={{ cursor: "pointer" }}>
                  <span style={{ fontSize: 14, color: "#7c6fff" }}>{PLATFORM_ICONS[c.platform] || "◎"}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="do-row-name">{c.name}</div>
                    <div className="do-row-meta">{c.platform} · {(c.memberCount||0).toLocaleString()} members · {c.calendarEntries?.length||0} calendar · {c.workflows?.length||0} workflows</div>
                  </div>
                  {c.inviteUrl && <a className="do-btn-sm" href={c.inviteUrl} target="_blank" rel="noopener noreferrer">Join</a>}
                  <Chip color="green">{c.status}</Chip>
                </div>
                {activeCom?.id === c.id && (
                  <div style={{ marginLeft: 16, borderLeft: "2px solid #2a2a3a", paddingLeft: 12, marginBottom: 8 }}>
                    <div className="do-sub-title">Community Calendar</div>
                    {c.calendarEntries?.length === 0 && <div className="do-hint">No calendar entries yet.</div>}
                    {(c.calendarEntries||[]).map(e => <div key={e.id} className="do-row"><span className="do-row-name">{e.title}</span><span className="do-row-meta">{e.type} · {e.date}</span></div>)}
                    <div className="do-form-row" style={{ marginTop: 6 }}>
                      <input className="do-input" placeholder="Entry title" value={calForm.title} onChange={e => setCalForm(f => ({...f, title: e.target.value}))} />
                      <input type="date" className="do-input" style={{ width: 140, flex: "none" }} value={calForm.date} onChange={e => setCalForm(f => ({...f, date: e.target.value}))} />
                      <button className="do-btn-sm" onClick={() => addCalEntry(c.id)}>Add</button>
                    </div>

                    <div className="do-sub-title" style={{ marginTop: 8 }}>Workflows</div>
                    {c.workflows?.length === 0 && <div className="do-hint">No workflows yet.</div>}
                    {(c.workflows||[]).map(w => <div key={w.id} className="do-row"><span className="do-row-name">{w.name}</span><Chip>{w.trigger}</Chip><Chip color="green">active</Chip></div>)}
                    <div className="do-form-row" style={{ marginTop: 6 }}>
                      <input className="do-input" placeholder="Workflow name" value={wfForm.name} onChange={e => setWfForm(f => ({...f, name: e.target.value}))} />
                      <select className="do-select" value={wfForm.trigger} onChange={e => setWfForm(f => ({...f, trigger: e.target.value}))}>
                        {["new_member","new_post","keyword","weekly","daily"].map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <input className="do-input" placeholder="Actions (welcome, pin_post…)" value={wfForm.actions} onChange={e => setWfForm(f => ({...f, actions: e.target.value}))} />
                      <button className="do-btn-sm" onClick={() => addWorkflow(c.id)}>Add</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {view === "add" && (
        <div className="do-form">
          <div className="do-form-title">Add Community</div>
          <div className="do-form-row">
            <select className="do-select" value={form.platform} onChange={e => setForm(f => ({...f, platform: e.target.value}))}>
              {(comms?.platforms || []).map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            <input className="do-input" style={{ flex: 1 }} placeholder="Community name *" value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} />
          </div>
          <div className="do-form-row">
            <input className="do-input" style={{ flex: 1 }} placeholder="Community URL" value={form.url} onChange={e => setForm(f => ({...f, url: e.target.value}))} />
            <input className="do-input" style={{ flex: 1 }} placeholder="Invite URL" value={form.inviteUrl} onChange={e => setForm(f => ({...f, inviteUrl: e.target.value}))} />
            <input type="number" className="do-input" style={{ width: 100, flex: "none" }} placeholder="Members" value={form.memberCount} onChange={e => setForm(f => ({...f, memberCount: e.target.value}))} />
            <button className="do-btn" onClick={add}>Add</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── MODULE 5: Referral Campaign Manager ─────────────────────────────────────

function ReferralPanel() {
  const [camps,  reload] = useDistrib("/distrib/referral-campaigns");
  const [view,   setView] = useState("list");
  const [form,   setForm] = useState({ name: "", rewardValue: "100", rewardType: "credits", description: "" });
  const [invForm, setInvForm] = useState({ campaignId: "", referrerId: "", invitedEmail: "" });
  const [lb,     setLb]   = useState(null);
  const [toast,  Toast]  = useToast();

  const create = async () => {
    if (!form.name) return;
    await post("/distrib/referral-campaigns", { ...form, rewardValue: Number(form.rewardValue) || 100 });
    setForm({ name: "", rewardValue: "100", rewardType: "credits", description: "" });
    toast("Referral campaign created");
    reload();
    setView("list");
  };

  const addInvite = async () => {
    if (!invForm.campaignId || !invForm.invitedEmail) return;
    const r = await post(`/distrib/referral-campaigns/${invForm.campaignId}/invite`, { referrerId: invForm.referrerId || "user-default", invitedEmail: invForm.invitedEmail });
    toast(r.blocked ? `Blocked: ${r.reason}` : "Invite sent!");
    setInvForm(f => ({...f, invitedEmail: "", referrerId: ""}));
    reload();
  };

  const loadLB = async (id) => {
    const r = await api(`/distrib/referral-campaigns/${id}/leaderboard`);
    if (r.ok !== false) setLb({ id, data: r.leaderboard });
  };

  const list = camps?.campaigns || [];

  return (
    <div>
      <div className="do-sub-tabs">
        {["list","create","invite"].map(v => (
          <button key={v} className={`do-sub-tab${view === v ? " active" : ""}`} onClick={() => setView(v)}>
            {v === "create" ? "+ New Campaign" : v === "invite" ? "Send Invite" : `Campaigns (${list.length})`}
          </button>
        ))}
        {Toast}
      </div>

      {view === "list" && (
        <div className="do-list">
          {list.length === 0 && <div className="do-empty">No referral campaigns. Create your first invite campaign with rewards and milestones.</div>}
          {list.map(c => (
            <div key={c.id} className="do-row">
              <StatusDot status={c.status} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="do-row-name">{c.name}</div>
                <div className="do-row-meta">
                  Reward: {c.rewardValue} {c.rewardType} · {c.milestones?.length||0} milestones
                  {c.fraudDetection?.blockedCount > 0 && ` · ${c.fraudDetection.blockedCount} fraud blocked`}
                </div>
                <div className="do-stats-mini">
                  <span>{c.stats?.totalInvites||0} invites</span>
                  <span style={{ color: "#22c55e" }}>{c.stats?.conversions||0} converted</span>
                  {c.stats?.fraudBlocked > 0 && <span style={{ color: "#ef4444" }}>{c.stats.fraudBlocked} blocked</span>}
                </div>
              </div>
              <Chip color="green">{c.status}</Chip>
              <button className="do-btn-sm" onClick={() => loadLB(c.id)}>Leaderboard</button>
            </div>
          ))}

          {lb && (
            <div className="do-card" style={{ marginTop: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <div className="do-card-title">Leaderboard</div>
                <button className="do-btn-sm" onClick={() => setLb(null)}>✕</button>
              </div>
              {lb.data.length === 0 && <div className="do-hint">No conversions yet.</div>}
              {lb.data.map((r, i) => (
                <div key={r.referrerId} className="do-row">
                  <span className="do-rank">#{i+1}</span>
                  <span className="do-row-name">{r.referrerId}</span>
                  <span className="do-row-meta">{r.invites} invites · {r.conversions} converted</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {view === "create" && (
        <div className="do-form">
          <div className="do-form-title">New Referral Campaign</div>
          <div className="do-form-row">
            <input className="do-input" style={{ flex: 1 }} placeholder="Campaign name *" value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} />
            <select className="do-select" value={form.rewardType} onChange={e => setForm(f => ({...f, rewardType: e.target.value}))}>
              {["credits","discount","free_month","cash"].map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <input type="number" className="do-input" style={{ width: 100, flex: "none" }} placeholder="Reward amount" value={form.rewardValue} onChange={e => setForm(f => ({...f, rewardValue: e.target.value}))} />
          </div>
          <input className="do-input" style={{ width: "100%", marginBottom: 8 }} placeholder="Description" value={form.description} onChange={e => setForm(f => ({...f, description: e.target.value}))} />
          <div className="do-hint" style={{ marginBottom: 8 }}>Auto-includes: 5/10/25 referral milestones + fraud detection (burst signups, no-activation, bot patterns)</div>
          <button className="do-btn" onClick={create}>Create Campaign</button>
        </div>
      )}

      {view === "invite" && (
        <div className="do-form">
          <div className="do-form-title">Send Campaign Invite</div>
          <div className="do-form-row">
            <select className="do-select" style={{ flex: 1 }} value={invForm.campaignId} onChange={e => setInvForm(f => ({...f, campaignId: e.target.value}))}>
              <option value="">— Select campaign —</option>
              {list.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="do-form-row">
            <input className="do-input" placeholder="Referrer ID (user-xxx)" value={invForm.referrerId} onChange={e => setInvForm(f => ({...f, referrerId: e.target.value}))} />
            <input className="do-input" style={{ flex: 1 }} placeholder="Invited email *" value={invForm.invitedEmail} onChange={e => setInvForm(f => ({...f, invitedEmail: e.target.value}))} />
            <button className="do-btn" onClick={addInvite}>Send Invite</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── MODULE 6: Launch Manager ──────────────────────────────────────────────────

function LaunchPanel() {
  const [launches, reload] = useDistrib("/distrib/launches");
  const [view, setView]   = useState("list");
  const [form, setForm]   = useState({ name: "", version: "v3.0", description: "", targetDate: "" });
  const [active, setActive] = useState(null);
  const [toast, Toast]    = useToast();

  const create = async () => {
    if (!form.name) return;
    await post("/distrib/launches", form);
    setForm({ name: "", version: "v3.0", description: "", targetDate: "" });
    toast("Launch plan created");
    reload();
    setView("list");
  };

  const tickChannel = async (launchId, channel, done) => {
    await patch(`/distrib/launches/${launchId}/channel`, { channel, status: done ? "done" : "pending" });
    toast(`${channel} ${done ? "done" : "reset"}`);
    reload();
  };

  const tickChecklist = async (launchId, itemId, done) => {
    await patch(`/distrib/launches/${launchId}/checklist`, { itemId, done });
    reload();
  };

  const list = launches?.launches || [];
  const CHANNEL_ICONS = { website: "◎", email: "✉", social: "◉", community: "⬡", docs: "◻", release_notes: "◈", press: "✦", producthunt: "◇", appstore: "⬢" };
  const STATUS_COLOR  = { planning: "#888", ready: "#4ecdc4", live: "#f59e0b", launched: "#22c55e", cancelled: "#ef4444" };

  return (
    <div>
      <div className="do-sub-tabs">
        {["list","create"].map(v => (
          <button key={v} className={`do-sub-tab${view === v ? " active" : ""}`} onClick={() => setView(v)}>
            {v === "create" ? "+ New Launch" : `Launches (${list.length})`}
          </button>
        ))}
        {Toast}
      </div>

      {view === "list" && (
        <div className="do-list">
          {list.length === 0 && <div className="do-empty">No launches. Coordinate your next product launch across website, email, social, community, docs, and press.</div>}
          {list.map(l => (
            <div key={l.id}>
              <div className="do-row" onClick={() => setActive(active?.id === l.id ? null : l)} style={{ cursor: "pointer" }}>
                <StatusDot status={l.status} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="do-row-name">{l.name} <span style={{ color: "#666" }}>{l.version}</span></div>
                  <div className="do-row-meta">
                    {l.stats?.channelsDone||0}/{l.channels?.length||0} channels done · {l.stats?.checklistDone||0}/{l.checklistItems?.length||0} checklist
                    {l.targetDate && ` · Target: ${l.targetDate}`}
                  </div>
                </div>
                <div style={{ fontSize: 18, fontWeight: 700, color: STATUS_COLOR[l.status] }}>
                  {Math.round((l.stats?.channelsDone||0) / Math.max(1, l.channels?.length||1) * 100)}%
                </div>
                <Chip color={l.status === "launched" ? "green" : "gray"}>{l.status}</Chip>
              </div>

              {active?.id === l.id && (
                <div style={{ marginLeft: 12, borderLeft: "2px solid #2a2a3a", paddingLeft: 12, marginBottom: 8 }}>
                  <div className="do-sub-title">Channels</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                    {l.channels?.map(ch => (
                      <button key={ch.channel}
                        className={`do-channel-check${ch.status === "done" ? " done" : ""}`}
                        onClick={() => tickChannel(l.id, ch.channel, ch.status !== "done")}
                      >
                        <span>{CHANNEL_ICONS[ch.channel] || "◎"}</span>
                        <span>{ch.channel}</span>
                        {ch.status === "done" && <span style={{ color: "#22c55e" }}>✓</span>}
                      </button>
                    ))}
                  </div>

                  <div className="do-sub-title">Launch Checklist</div>
                  <div className="do-checklist">
                    {l.checklistItems?.map(item => (
                      <label key={item.id} className="do-check-item">
                        <input type="checkbox" checked={item.done} onChange={e => tickChecklist(l.id, item.id, e.target.checked)} />
                        <span style={{ color: item.done ? "#22c55e" : "#ccc" }}>{item.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {view === "create" && (
        <div className="do-form">
          <div className="do-form-title">New Launch Plan</div>
          <div className="do-form-row">
            <input className="do-input" style={{ flex: 1 }} placeholder="Launch name *" value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} />
            <input className="do-input" style={{ width: 100, flex: "none" }} placeholder="Version" value={form.version} onChange={e => setForm(f => ({...f, version: e.target.value}))} />
            <input type="date" className="do-input" style={{ width: 140, flex: "none" }} value={form.targetDate} onChange={e => setForm(f => ({...f, targetDate: e.target.value}))} />
          </div>
          <input className="do-input" style={{ width: "100%", marginBottom: 8 }} placeholder="Description" value={form.description} onChange={e => setForm(f => ({...f, description: e.target.value}))} />
          <div className="do-hint" style={{ marginBottom: 8 }}>Auto-creates 9 channels (website/email/social/community/docs/release_notes/press/producthunt/appstore) + 8-item checklist</div>
          <button className="do-btn" onClick={create}>Create Launch Plan</button>
        </div>
      )}
    </div>
  );
}

// ── MODULE 7: Distribution Analytics ─────────────────────────────────────────

function AnalyticsPanel() {
  const [analytics, reload] = useDistrib("/distrib/analytics");
  const a = analytics?.analytics;

  const byPlatform = a?.byPlatform || {};
  const sorted = Object.entries(byPlatform).sort((a, b) => b[1].reach - a[1].reach);

  return (
    <div>
      <div className="do-section-hdr">
        <span className="do-section-title">Distribution Analytics</span>
        <button className="do-btn-sm" onClick={reload}>Refresh</button>
      </div>

      {a && (
        <>
          <div className="do-stats-grid" style={{ marginBottom: 12 }}>
            <StatCard label="Total Reach"      value={(a.totalReach||0).toLocaleString()} accent="#7c6fff" />
            <StatCard label="Total Engagement" value={(a.totalEngagement||0).toLocaleString()} accent="#22c55e" />
            <StatCard label="Total Shares"     value={(a.totalShares||0).toLocaleString()} />
            <StatCard label="Total Clicks"     value={(a.totalClicks||0).toLocaleString()} />
            <StatCard label="Engagement Rate"  value={`${a.engagementRate}%`} accent="#4ecdc4" />
            <StatCard label="Virality Score"   value={`${a.viralityScore}/100`} accent="#f59e0b" />
            <StatCard label="Publish Jobs"     value={a.totalPublishJobs} />
            <StatCard label="Top Platform"     value={a.topPlatform || "—"} accent="#22c55e" />
          </div>

          <div className="do-sub-title">Platform Comparison</div>
          <div className="do-list">
            {sorted.length === 0 && <div className="do-empty">No published content yet. Publish posts to see channel comparison.</div>}
            {sorted.map(([platform, s]) => (
              <div key={platform} className="do-row">
                <span style={{ fontSize: 14 }}>{PLATFORM_ICONS[platform] || "◎"}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="do-row-name">{platform}</div>
                  <div className="do-row-meta">{s.posts} posts · {s.reach.toLocaleString()} reach · {s.engagement.toLocaleString()} eng.</div>
                </div>
                <div className="do-bar-wrap">
                  <div className="do-bar-fill" style={{ width: `${sorted[0]?.[1]?.reach > 0 ? Math.round(s.reach/sorted[0][1].reach*100) : 0}%` }} />
                </div>
                <span className="do-row-meta" style={{ width: 60, textAlign: "right" }}>{s.reach.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── MODULE 8: Content Performance AI ─────────────────────────────────────────

function PerformancePanel() {
  const [top,   reloadTop]  = useDistrib("/distrib/performance/top?limit=10");
  const [recs,  reloadRecs] = useDistrib("/distrib/performance/recommendations");
  const [optim, reloadOpt]  = useDistrib("/distrib/performance/optimization");
  const [toast, Toast]      = useToast();

  const snapshot = async (jobId) => {
    await post(`/distrib/performance/snapshot/${jobId}`, {});
    toast("Snapshot taken");
    reloadTop();
  };

  const RECO_COLOR  = { republish: "#22c55e", repost_highlight: "#f59e0b", archive: "#666" };

  return (
    <div>
      <div className="do-section-hdr">
        <span className="do-section-title">Content Performance AI</span>
        {Toast}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="do-card">
          <div className="do-card-title">Top Performers</div>
          {(top?.top||[]).length === 0 && <div className="do-hint">Snapshot published jobs to see performance rankings.</div>}
          {(top?.top||[]).map((p, i) => (
            <div key={p.id} className="do-kv-row">
              <span className="do-rank">#{i+1}</span>
              <span className="do-kv-key">{p.title?.slice(0,30)||p.jobId}</span>
              <span className="do-kv-val" style={{ color: p.score >= 60 ? "#22c55e" : "#f59e0b" }}>score {p.score}</span>
            </div>
          ))}
        </div>
        <div className="do-card">
          <div className="do-card-title">Publishing Optimization — Best Hours</div>
          {(optim?.optimization||[]).map(o => (
            <div key={o.platform} className="do-kv-row">
              <span className="do-kv-key">{o.platform}</span>
              <span className="do-kv-val">{o.bestHours.join(", ")}h</span>
              {o.isOptimalNow && <Chip color="green">optimal now</Chip>}
            </div>
          ))}
        </div>
      </div>

      <div className="do-sub-title" style={{ marginTop: 12 }}>Republish & Evergreen Recommendations</div>
      <div className="do-list">
        {(recs?.recommendations||[]).length === 0 && <div className="do-empty">No recommendations yet. Snapshot your published posts to get AI republish suggestions.</div>}
        {(recs?.recommendations||[]).map(r => (
          <div key={r.jobId} className="do-row">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="do-row-name">{r.title||r.jobId}</div>
              <div className="do-row-meta">Score {r.score} · Age {r.ageDays} days{r.evergreen ? " · Evergreen ✓" : ""}</div>
              <div className="do-tag-row">{(r.bestPlatforms||[]).map(p => <Chip key={p}>{p}</Chip>)}</div>
            </div>
            <span style={{ color: RECO_COLOR[r.recommendation], fontWeight: 600, fontSize: 11 }}>{r.recommendation}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── MODULE 10: Commercial Benchmark ──────────────────────────────────────────

function BenchmarkPanel() {
  const [result,  setResult]  = useState(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    const r = await api("/distrib/benchmark");
    if (r.ok !== false) setResult(r);
    setRunning(false);
  };

  const READINESS_COLOR = { production_ready: "#22c55e", nearly_ready: "#f59e0b", needs_work: "#ef4444" };

  return (
    <div>
      <div className="do-section-hdr">
        <span className="do-section-title">Commercial Benchmark — G3 Distribution Engine</span>
        <button className="do-btn" onClick={run} disabled={running}>{running ? "Running…" : "Run Benchmark"}</button>
      </div>
      <p className="do-hint">Validates all 10 G3 modules: Universal Publisher (11 platforms + approval + retry), Campaign Orchestrator (multi-channel + dependencies), Influencer Outreach (AI drafts + CRM), Community Hub (Discord/Telegram/Reddit/GitHub + calendar + workflows), Referral Campaign Manager (fraud detection + milestones + leaderboard), Launch Manager (website+email+social+community+docs+release_notes), Distribution Analytics (reach/engagement/virality/channel comparison), Content Performance AI (top performers + republish + evergreen + optimization), Executive Growth Center, Commercial Readiness.</p>

      {result && (
        <>
          <div className="do-stats-grid" style={{ marginBottom: 16 }}>
            <StatCard label="Score"      value={`${result.score}%`}              accent={READINESS_COLOR[result.distributionReadiness]} />
            <StatCard label="Passed"     value={`${result.passing}/${result.total}`} accent="#22c55e" />
            <StatCard label="Readiness"  value={result.distributionReadiness?.replace(/_/g," ")} accent={READINESS_COLOR[result.distributionReadiness]} />
            <StatCard label="Regression" value={result.regressionPass ? "PASS" : "FAIL"} accent={result.regressionPass ? "#22c55e" : "#ef4444"} />
          </div>
          <div className="do-list">
            {(result.checks||[]).map(c => (
              <div key={c.id} className={`do-row${c.ok ? "" : " do-row-fail"}`}>
                <span style={{ color: c.ok ? "#22c55e" : "#ef4444", fontWeight: 700, flexShrink: 0 }}>{c.ok ? "✓" : "✗"}</span>
                <span className="do-row-name" style={{ flex: 1 }}>{c.label}</span>
                {c.error && <span className="do-row-meta" style={{ color: "#ef4444" }}>{c.error}</span>}
                <Chip color={c.ok ? "green" : "red"}>{c.ok ? "pass" : "fail"}</Chip>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export default function DistributionOS() {
  const [tab, setTab] = useState("executive");
  const panels = {
    executive:   <ExecutivePanel />,
    publisher:   <PublisherPanel />,
    campaigns:   <CampaignPanel />,
    influencers: <InfluencerPanel />,
    community:   <CommunityPanel />,
    referral:    <ReferralPanel />,
    launches:    <LaunchPanel />,
    analytics:   <AnalyticsPanel />,
    performance: <PerformancePanel />,
    benchmark:   <BenchmarkPanel />,
  };
  return (
    <div className="do-root">
      <div className="do-header">
        <span className="do-title">Growth OS — G3</span>
        <span className="do-subtitle">Distribution Engine · Publisher · Campaigns · Influencers · Community · Referral · Launches · Analytics · Performance AI</span>
      </div>
      <div className="do-tabs">
        {TABS.map(t => (
          <button key={t.id} className={`do-tab${tab === t.id ? " active" : ""}`} onClick={() => setTab(t.id)}>
            <span className="do-tab-icon">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>
      <div className="do-content">{panels[tab]}</div>
    </div>
  );
}
