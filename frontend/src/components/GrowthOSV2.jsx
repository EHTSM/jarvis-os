import React, { useState, useCallback, useEffect } from "react";
import { track } from "../analytics";
import { sendMessage } from "../api";
import "./GrowthOSV2.css";

// ── Tabs ──────────────────────────────────────────────────────────────

const TABS = [
  { id: "seo",      label: "SEO"       },
  { id: "content",  label: "Content"   },
  { id: "social",   label: "Social"    },
  { id: "email",    label: "Email"     },
  { id: "referral", label: "Referral"  },
  { id: "launch",   label: "Launch"    },
];

// ── Shared helpers ────────────────────────────────────────────────────

function Toast({ msg, type, onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 3600); return () => clearTimeout(t); }, [onDone]);
  return <div className={`gov2-toast gov2-toast--${type}`}>{msg}</div>;
}

function CopyBtn({ text, addToast }) {
  return (
    <button
      className="gov2-copy-btn"
      onClick={() => { navigator.clipboard?.writeText(text).then(() => addToast("Copied!", "success")).catch(() => addToast("Copy failed", "error")); }}
    >
      Copy
    </button>
  );
}

// ── SEO Data ──────────────────────────────────────────────────────────

const SEO_CHECKS = [
  { id:"title",       label:"Title tag",           status:"pass",    note:"62 chars — within 60–70 char sweet spot" },
  { id:"desc",        label:"Meta description",    status:"pass",    note:"157 chars — within 150–160 char limit"   },
  { id:"og",          label:"Open Graph tags",     status:"pass",    note:"og:title, og:description, og:image all set" },
  { id:"schema",      label:"Structured data",     status:"pass",    note:"Organization + SoftwareApplication + WebSite" },
  { id:"sitemap",     label:"Sitemap",             status:"pass",    note:"/sitemap.xml — 8 URLs submitted"          },
  { id:"robots",      label:"Robots.txt",          status:"pass",    note:"/robots.txt — Sitemap directive included" },
  { id:"mobile",      label:"Mobile viewport",     status:"pass",    note:"viewport meta tag set, responsive CSS"    },
  { id:"cwv",         label:"Core Web Vitals",     status:"warn",    note:"SPA — consider prerender for first-load LCP" },
  { id:"blog",        label:"Blog / content pages",status:"missing", note:"No blog yet — highest organic opportunity" },
  { id:"backlinks",   label:"Backlink profile",    status:"missing", note:"No external backlinks tracked yet"         },
  { id:"gsc",         label:"Search Console",      status:"action",  note:"Verify ooplix.com at search.google.com/search-console" },
  { id:"analytics",   label:"GA4 tracking",        status:"pass",    note:"GA4 + GTM wired"                          },
];

const KEYWORDS = [
  { kw:"whatsapp follow up automation", vol:"4,400/mo",  diff:"Medium", intent:"Commercial", priority:"high"   },
  { kw:"ai business automation india",  vol:"2,900/mo",  diff:"Medium", intent:"Commercial", priority:"high"   },
  { kw:"lead follow up software india", vol:"1,800/mo",  diff:"Low",    intent:"Commercial", priority:"high"   },
  { kw:"crm for freelancers india",     vol:"1,200/mo",  diff:"Low",    intent:"Commercial", priority:"medium" },
  { kw:"razorpay payment link tool",    vol:"880/mo",    diff:"Low",    intent:"Transactional",priority:"medium"},
  { kw:"whatsapp business automation",  vol:"8,100/mo",  diff:"High",   intent:"Commercial", priority:"medium" },
  { kw:"ai operating system for business",vol:"590/mo",  diff:"Low",    intent:"Informational",priority:"low"  },
];

const STATUS_ICON = { pass:"✓", warn:"⚠", missing:"✗", action:"→" };
const STATUS_COLOR= { pass:"#52d68a", warn:"#f0b429", missing:"#f55b5b", action:"#7c6fff" };
const PRIORITY_COLOR = { high:"#f55b5b", medium:"#f0b429", low:"#8994b0" };

function TabSEO({ addToast }) {
  const [generating, setGenerating] = useState(false);
  const [report, setReport] = useState(null);

  const passCount    = SEO_CHECKS.filter(c => c.status === "pass").length;
  const warnCount    = SEO_CHECKS.filter(c => c.status === "warn").length;
  const missingCount = SEO_CHECKS.filter(c => c.status !== "pass" && c.status !== "warn").length;
  const score = Math.round((passCount / SEO_CHECKS.length) * 100);

  async function handleGenerateReport() {
    if (generating) return;
    setGenerating(true);
    try {
      const r = await sendMessage("Generate an SEO improvement action plan for ooplix.com based on the current technical SEO checks and keyword opportunities", "smart");
      setReport(r?.reply || r?.output || "Report generation requires AI to be online.");
      addToast("SEO report generated", "success");
      track("seo_report_generated");
    } catch (e) { addToast(`Failed: ${e.message}`, "error"); }
    finally    { setGenerating(false); }
  }

  return (
    <div className="gov2-tab-body">
      <div className="gov2-seo-score-row">
        <div className="gov2-score-ring">
          <span className="gov2-score-val" style={{ color: score >= 80 ? "#52d68a" : score >= 60 ? "#f0b429" : "#f55b5b" }}>{score}</span>
          <span className="gov2-score-sub">SEO score</span>
        </div>
        <div className="gov2-seo-kpis">
          <div className="gov2-kpi"><span className="gov2-kpi-val" style={{ color:"#52d68a" }}>{passCount}</span><span className="gov2-kpi-label">Passing</span></div>
          <div className="gov2-kpi"><span className="gov2-kpi-val" style={{ color:"#f0b429" }}>{warnCount}</span><span className="gov2-kpi-label">Warnings</span></div>
          <div className="gov2-kpi"><span className="gov2-kpi-val" style={{ color:"#f55b5b" }}>{missingCount}</span><span className="gov2-kpi-label">Missing</span></div>
          <button className="gov2-btn gov2-btn--primary gov2-btn--sm" onClick={handleGenerateReport} disabled={generating}>
            {generating ? "⟳ Generating…" : "AI Report"}
          </button>
        </div>
      </div>

      {report && (
        <div className="gov2-panel gov2-report-panel">
          <div className="gov2-panel-header">
            <p className="gov2-section-label">AI SEO Report</p>
            <CopyBtn text={report} addToast={addToast} />
          </div>
          <p className="gov2-report-text">{report}</p>
        </div>
      )}

      <div className="gov2-panel">
        <p className="gov2-section-label">Technical SEO Checks</p>
        <div className="gov2-checks-list">
          {SEO_CHECKS.map(c => (
            <div key={c.id} className="gov2-check-row">
              <span className="gov2-check-icon" style={{ color: STATUS_COLOR[c.status] }}>{STATUS_ICON[c.status]}</span>
              <span className="gov2-check-label">{c.label}</span>
              <span className="gov2-check-note">{c.note}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="gov2-panel">
        <p className="gov2-section-label">Keyword Opportunities</p>
        <div className="gov2-kw-list">
          {KEYWORDS.map(k => (
            <div key={k.kw} className="gov2-kw-row">
              <span className="gov2-kw-term">{k.kw}</span>
              <span className="gov2-kw-vol">{k.vol}</span>
              <span className="gov2-kw-diff">{k.diff}</span>
              <span className="gov2-kw-intent">{k.intent}</span>
              <span className="gov2-priority-chip" style={{ color: PRIORITY_COLOR[k.priority], background: PRIORITY_COLOR[k.priority]+"15" }}>{k.priority}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Content Engine ────────────────────────────────────────────────────

const CONTENT_TYPES = [
  { id:"blog",     label:"Blog Post",      icon:"◎", color:"#7c6fff"  },
  { id:"landing",  label:"Landing Page",   icon:"◈", color:"#4ecdc4"  },
  { id:"linkedin", label:"LinkedIn Post",  icon:"in",color:"#0a66c2"  },
  { id:"twitter",  label:"X / Twitter",   icon:"𝕏", color:"#e7e9ea"  },
  { id:"email",    label:"Email Draft",    icon:"✉", color:"#f0b429"  },
  { id:"thread",   label:"Twitter Thread", icon:"⊞", color:"#c0c8dc"  },
];

const QUICK_PROMPTS = {
  blog:     "Write a 1,200-word SEO blog post about 'whatsapp follow up automation' for small business owners in India. Include what the problem is, how automation solves it, and a step-by-step guide. Mention Ooplix naturally as the solution.",
  landing:  "Write copy for a landing page targeting freelancers in India. H1, subheadline, 3 benefit bullets, social proof line, and CTA. Tone: direct, confident, not pushy.",
  linkedin: "Write a LinkedIn post about the hidden cost of manual lead follow-up. Hook: a specific number or surprising stat. 150 words max. End with a subtle CTA about Ooplix.",
  twitter:  "Write a hook tweet (280 chars max) about how most freelancers lose 40% of their leads to slow follow-up. Punchy, no fluff.",
  email:    "Write a welcome email for new Ooplix trial users. Subject line + 200-word body. Warm, helpful tone. Tell them the 3 things to do first.",
  thread:   "Write a 6-tweet thread on '5 reasons businesses lose leads and how to fix each one'. Tweet 1 is the hook, tweets 2–6 cover each reason, tweet 7 is the wrap-up with Ooplix mention.",
};

const CONTENT_KEY = "gov2_content_history";
function _loadHistory() { try { return JSON.parse(localStorage.getItem(CONTENT_KEY) || "[]"); } catch { return []; } }
function _saveHistory(h) { try { localStorage.setItem(CONTENT_KEY, JSON.stringify(h.slice(-20))); } catch {} }

function TabContent({ addToast }) {
  const [type,      setType]      = useState("blog");
  const [prompt,    setPrompt]    = useState(QUICK_PROMPTS["blog"]);
  const [generating,setGenerating]= useState(false);
  const [output,    setOutput]    = useState("");
  const [history,   setHistory]   = useState(_loadHistory);

  function handleTypeChange(t) {
    setType(t);
    if (!prompt || prompt === QUICK_PROMPTS[type]) setPrompt(QUICK_PROMPTS[t] || "");
  }

  async function handleGenerate() {
    if (!prompt.trim() || generating) return;
    setGenerating(true);
    setOutput("");
    try {
      const r = await sendMessage(prompt.trim(), "smart");
      const text = r?.reply || r?.output || "No response from AI.";
      setOutput(text);
      const entry = { id: Date.now(), type, prompt: prompt.trim().slice(0, 80), output: text, ts: new Date().toLocaleTimeString("en-IN", { hour:"2-digit", minute:"2-digit" }) };
      const updated = [entry, ...history.slice(0, 19)];
      setHistory(updated);
      _saveHistory(updated);
      addToast("Content generated", "success");
      track("content_generated", { type });
    } catch (e) { addToast(`Generation failed: ${e.message}`, "error"); }
    finally    { setGenerating(false); }
  }

  return (
    <div className="gov2-tab-body">
      <div className="gov2-content-types">
        {CONTENT_TYPES.map(t => (
          <button
            key={t.id}
            className={`gov2-type-btn${type === t.id ? " gov2-type-btn--active" : ""}`}
            style={{ "--tc": t.color }}
            onClick={() => handleTypeChange(t.id)}
          >
            <span className="gov2-type-icon" style={{ color: t.color }}>{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      <div className="gov2-panel gov2-content-panel">
        <div className="gov2-panel-header">
          <p className="gov2-section-label">Prompt</p>
          <button
            className="gov2-btn gov2-btn--ghost gov2-btn--xs"
            onClick={() => setPrompt(QUICK_PROMPTS[type] || "")}
          >Reset</button>
        </div>
        <textarea
          className="gov2-prompt-textarea"
          rows={4}
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder="Describe what content you want to generate…"
          disabled={generating}
        />
        <div className="gov2-content-actions">
          <button className="gov2-btn gov2-btn--primary" onClick={handleGenerate} disabled={!prompt.trim() || generating}>
            {generating ? "⟳ Generating…" : "Generate →"}
          </button>
          {output && <CopyBtn text={output} addToast={addToast} />}
        </div>
      </div>

      {output && (
        <div className="gov2-panel gov2-output-panel">
          <div className="gov2-panel-header">
            <p className="gov2-section-label">Output</p>
            <CopyBtn text={output} addToast={addToast} />
          </div>
          <pre className="gov2-output-text">{output}</pre>
        </div>
      )}

      {history.length > 0 && (
        <div className="gov2-panel">
          <p className="gov2-section-label">Recent Generations</p>
          {history.slice(0, 5).map(h => (
            <div key={h.id} className="gov2-hist-row" onClick={() => { setOutput(h.output); setPrompt(h.prompt); setType(h.type); }}>
              <span className="gov2-hist-type">{h.type}</span>
              <span className="gov2-hist-prompt">{h.prompt}</span>
              <span className="gov2-hist-ts">{h.ts}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Social Hub ────────────────────────────────────────────────────────

const CHANNELS = [
  { id:"linkedin", name:"LinkedIn",  icon:"in", color:"#0a66c2",  status:"not_connected", tips:["Stories outperform posts 3×","End with a question","Optimal: 150–300 words"], bestTime:"Tue–Thu, 9–11am IST" },
  { id:"twitter",  name:"X/Twitter", icon:"𝕏",  color:"#e7e9ea",  status:"not_connected", tips:["Threads get 4× more reach","Use 1–2 hashtags max","Hook in first 8 words"], bestTime:"Mon–Fri, 8–10am & 6–9pm IST" },
  { id:"instagram",name:"Instagram", icon:"◉",  color:"#e1306c",  status:"not_connected", tips:["Reels get highest organic reach","Stories daily for top-of-mind","Carousels save rate is 3×"], bestTime:"Mon/Wed/Fri, 11am–1pm IST" },
  { id:"whatsapp", name:"WhatsApp",  icon:"💬", color:"#25d366",  status:"connected",     tips:["Send at 9am–11am or 6pm–8pm","Keep under 280 chars","Use broadcast lists, not groups"], bestTime:"9–11am & 6–8pm IST" },
];

const SOCIAL_PROMPTS = [
  { label:"Value hook",   ch:"linkedin", prompt:"Write a LinkedIn post about the hidden cost of manual lead follow-up. Hook: a surprising stat. 150 words max. Subtle CTA for Ooplix." },
  { label:"Story post",   ch:"linkedin", prompt:"Write a LinkedIn story post from the POV of a freelancer who was losing 3–4 deals/month to slow follow-up until they automated it. 200 words." },
  { label:"Hook tweet",   ch:"twitter",  prompt:"Write a hook tweet (280 chars) about how most freelancers lose 40% of their leads to slow follow-up. Punchy." },
  { label:"Product tweet",ch:"twitter",  prompt:"Write a tweet announcing Ooplix — an AI OS that automates WhatsApp follow-ups, generates Razorpay payment links, and runs tasks autonomously." },
];

function TabSocial({ addToast }) {
  const [genPrompt, setGenPrompt] = useState("");
  const [genChannel, setGenChannel] = useState("linkedin");
  const [generating, setGenerating] = useState(false);
  const [output, setOutput] = useState("");

  async function handleGenerate() {
    if (!genPrompt.trim() || generating) return;
    setGenerating(true);
    setOutput("");
    try {
      const r = await sendMessage(genPrompt.trim(), "smart");
      setOutput(r?.reply || r?.output || "No response.");
      addToast("Social post generated", "success");
      track("social_generated", { channel: genChannel });
    } catch (e) { addToast(`Failed: ${e.message}`, "error"); }
    finally    { setGenerating(false); }
  }

  return (
    <div className="gov2-tab-body">
      <div className="gov2-channel-grid">
        {CHANNELS.map(ch => {
          const isConn = ch.status === "connected";
          return (
            <div key={ch.id} className={`gov2-channel-card${isConn ? " gov2-channel-card--connected" : ""}`}>
              <div className="gov2-ch-top">
                <span className="gov2-ch-icon" style={{ color: ch.color, background: ch.color+"18" }}>{ch.icon}</span>
                <div className="gov2-ch-ident">
                  <span className="gov2-ch-name">{ch.name}</span>
                  <span className="gov2-ch-best">{ch.bestTime}</span>
                </div>
                <span className={`gov2-conn-chip${isConn ? " gov2-conn-chip--ok" : ""}`}>{isConn ? "Connected" : "Not connected"}</span>
              </div>
              <div className="gov2-ch-tips">
                {ch.tips.map((tip, i) => <span key={i} className="gov2-ch-tip">◦ {tip}</span>)}
              </div>
              {!isConn && (
                <button className="gov2-btn gov2-btn--ghost gov2-btn--sm" onClick={() => addToast(`${ch.name} OAuth <span className="csb-beta-badge">BETA</span>`, "info")}>Connect →</button>
              )}
            </div>
          );
        })}
      </div>

      <div className="gov2-panel gov2-social-gen">
        <p className="gov2-section-label">AI Post Generator</p>
        <div className="gov2-social-channel-pick">
          {CHANNELS.map(ch => (
            <button key={ch.id} className={`gov2-filter-chip${genChannel === ch.id ? " gov2-filter-chip--active" : ""}`} onClick={() => setGenChannel(ch.id)}>{ch.name}</button>
          ))}
        </div>
        <div className="gov2-quick-prompts">
          {SOCIAL_PROMPTS.filter(p => p.ch === genChannel).map(p => (
            <button key={p.label} className="gov2-quick-chip" onClick={() => setGenPrompt(p.prompt)}>{p.label}</button>
          ))}
        </div>
        <textarea
          className="gov2-prompt-textarea"
          rows={3}
          value={genPrompt}
          onChange={e => setGenPrompt(e.target.value)}
          placeholder="Describe the post you want to generate…"
          disabled={generating}
        />
        <div className="gov2-content-actions">
          <button className="gov2-btn gov2-btn--primary" onClick={handleGenerate} disabled={!genPrompt.trim() || generating}>
            {generating ? "⟳ Generating…" : "Generate Post →"}
          </button>
          {output && <CopyBtn text={output} addToast={addToast} />}
        </div>
        {output && (
          <pre className="gov2-social-output">{output}</pre>
        )}
      </div>

      <div className="gov2-coming-soon">
        <span className="gov2-cs-icon">◎</span>
        <div>
          <p className="gov2-cs-title">Auto-posting & Scheduling <span className="csb-beta-badge">BETA</span></p>
          <p className="gov2-cs-sub">Direct publish to LinkedIn, Twitter, and Instagram. Content calendar with optimal scheduling. Performance analytics per post.</p>
        </div>
      </div>
    </div>
  );
}

// ── Email Marketing ───────────────────────────────────────────────────

const CAMP_KEY = "gov2_campaigns";
function _loadCamps() { try { return JSON.parse(localStorage.getItem(CAMP_KEY) || "[]"); } catch { return []; } }
function _saveCamps(c) { try { localStorage.setItem(CAMP_KEY, JSON.stringify(c.slice(-20))); } catch {} }

const SEGMENTS = [
  { id:"all",         label:"All subscribers",   desc:"Everyone who opted in" },
  { id:"trial",       label:"Active trial",       desc:"Users currently in trial" },
  { id:"hot_leads",   label:"Hot leads",          desc:"Leads marked hot in pipeline" },
  { id:"paid",        label:"Paid customers",     desc:"Active subscribers" },
  { id:"churned",     label:"Churned",            desc:"Cancelled or expired" },
  { id:"inactive",    label:"No activity (7d)",   desc:"Signed up but haven't used the product" },
];

const EMAIL_TEMPLATES = [
  { id:"welcome",   label:"Welcome email",         subject:"Welcome to Ooplix — here's how to start", body:"Hi {{first_name}},\n\nWelcome to Ooplix — your AI Operating System for business.\n\nHere's what to do in the next 10 minutes:\n\n1. Add your first contact (name + WhatsApp number)\n2. Connect WhatsApp (one-time QR scan)\n3. Open the Control Center\n\n— The Ooplix Team" },
  { id:"trial_d3",  label:"Trial day 3 check-in",  subject:"3 days in — have you tried this yet?",    body:"Hi {{first_name}},\n\nYou're 3 days into your Ooplix trial.\n\nThe single highest-leverage thing you can do today: add a contact and let Ooplix send the first follow-up automatically.\n\nTakes 2 minutes.\n\n— Ooplix" },
  { id:"upgrade",   label:"Upgrade nudge",          subject:"Your automations are ready — just add a contact", body:"Hi {{first_name}},\n\nYour Ooplix trial is active but we noticed you haven't added a contact yet.\n\nHere's the fastest path to value:\n→ Add one contact with a WhatsApp number\n→ Watch Ooplix queue the first follow-up automatically\n\nIf you have questions, reply here.\n\n— Ooplix" },
  { id:"winback",   label:"Win-back",               subject:"We noticed you left — here's what changed", body:"Hi {{first_name}},\n\nWe noticed you haven't been back in a while.\n\nA lot has changed since you last visited:\n• WhatsApp follow-up automation is now fully self-healing\n• Payment link generation is faster\n• New AI models with faster response times\n\nIf you'd like to try again, your data is still here.\n\n— Ooplix" },
];

function TabEmail({ addToast }) {
  const [campaigns,  setCampaigns]  = useState(_loadCamps);
  const [subject,    setSubject]    = useState("");
  const [body,       setBody]       = useState("");
  const [segment,    setSegment]    = useState("all");
  const [creating,   setCreating]   = useState(false);
  const [selectedTpl,setSelectedTpl]= useState(null);

  function applyTemplate(tpl) {
    setSubject(tpl.subject);
    setBody(tpl.body);
    setSelectedTpl(tpl.id);
  }

  async function handleSchedule() {
    if (!subject.trim() || !body.trim() || creating) return;
    setCreating(true);
    const camp = { id: `camp_${Date.now()}`, subject: subject.trim(), segment, status:"scheduled", created: new Date().toLocaleTimeString("en-IN", { hour:"2-digit", minute:"2-digit" }), recipients: "—" };
    try {
      await sendMessage(`Schedule email campaign: "${subject.trim()}" to ${segment} segment`, "smart").catch(() => {});
      const updated = [camp, ...campaigns.slice(0, 19)];
      setCampaigns(updated);
      _saveCamps(updated);
      setSubject("");
      setBody("");
      setSelectedTpl(null);
      addToast("Campaign scheduled", "success");
      track("email_campaign_created");
    } catch (e) { addToast(`Failed: ${e.message}`, "error"); }
    finally    { setCreating(false); }
  }

  async function handleGenerateBody() {
    if (!subject.trim()) return;
    try {
      const r = await sendMessage(`Write a short, warm marketing email with subject "${subject}" for Ooplix users in the "${segment}" segment. 150–200 words.`, "smart");
      setBody(r?.reply || r?.output || "");
      addToast("Email body generated", "success");
    } catch { addToast("AI unavailable", "error"); }
  }

  return (
    <div className="gov2-tab-body">
      <div className="gov2-email-templates">
        <p className="gov2-section-label" style={{ marginBottom: 8 }}>Quick templates</p>
        <div className="gov2-template-chips">
          {EMAIL_TEMPLATES.map(t => (
            <button
              key={t.id}
              className={`gov2-template-chip${selectedTpl === t.id ? " gov2-template-chip--active" : ""}`}
              onClick={() => applyTemplate(t)}
            >{t.label}</button>
          ))}
        </div>
      </div>

      <div className="gov2-panel gov2-email-compose">
        <p className="gov2-section-label">Compose</p>

        <div className="gov2-compose-row">
          <label className="gov2-compose-label">Segment</label>
          <div className="gov2-segment-chips">
            {SEGMENTS.map(s => (
              <button key={s.id} className={`gov2-filter-chip${segment === s.id ? " gov2-filter-chip--active" : ""}`} onClick={() => setSegment(s.id)} title={s.desc}>{s.label}</button>
            ))}
          </div>
        </div>

        <div className="gov2-compose-row">
          <label className="gov2-compose-label">Subject</label>
          <input
            className="gov2-input"
            value={subject}
            onChange={e => setSubject(e.target.value)}
            placeholder="Email subject line…"
          />
        </div>

        <div className="gov2-compose-row">
          <label className="gov2-compose-label">Body</label>
          <div style={{ position:"relative" }}>
            <textarea
              className="gov2-prompt-textarea"
              rows={7}
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder="Email body. Use {{first_name}} for personalisation."
            />
            <button className="gov2-ai-body-btn" onClick={handleGenerateBody} disabled={!subject.trim()} title="Generate body with AI">AI ✦</button>
          </div>
        </div>

        <div className="gov2-content-actions">
          <button className="gov2-btn gov2-btn--primary" onClick={handleSchedule} disabled={!subject.trim() || !body.trim() || creating}>
            {creating ? "⟳ Scheduling…" : "Schedule Campaign →"}
          </button>
          {body && <CopyBtn text={`Subject: ${subject}\n\n${body}`} addToast={addToast} />}
        </div>
      </div>

      {campaigns.length > 0 && (
        <div className="gov2-panel">
          <p className="gov2-section-label">Campaigns</p>
          {campaigns.map(c => (
            <div key={c.id} className="gov2-camp-row">
              <div className="gov2-camp-info">
                <span className="gov2-camp-subject">{c.subject}</span>
                <span className="gov2-camp-meta">{c.segment} · {c.created}</span>
              </div>
              <span className={`gov2-conn-chip${c.status === "sent" ? " gov2-conn-chip--ok" : ""}`}>{c.status}</span>
            </div>
          ))}
        </div>
      )}

      <div className="gov2-coming-soon">
        <span className="gov2-cs-icon">✉</span>
        <div>
          <p className="gov2-cs-title">Email Provider Integration <span className="csb-beta-badge">BETA</span></p>
          <p className="gov2-cs-sub">Send directly via SendGrid, Resend, or Mailgun. Open/click tracking, unsubscribe management, and list hygiene.</p>
        </div>
      </div>
    </div>
  );
}

// ── Referral ──────────────────────────────────────────────────────────

const REFERRAL_TIERS = [
  { milestone:1,  reward:"1 month free",          icon:"✦", color:"#4ecdc4" },
  { milestone:3,  reward:"3 months free",          icon:"◉", color:"#7c6fff" },
  { milestone:10, reward:"1 year free + Growth",   icon:"★", color:"#f0b429" },
  { milestone:25, reward:"Lifetime Growth access", icon:"⬟", color:"#52d68a" },
];

const SHARE_TEMPLATES = [
  { id:"whatsapp",  channel:"WhatsApp",  icon:"💬", color:"#25d366", msg:"Hey — I've been using Ooplix for automated WhatsApp follow-ups and it's saved me hours every week. Free 7-day trial (no card): {{referral_link}}" },
  { id:"linkedin",  channel:"LinkedIn",  icon:"in", color:"#0a66c2", msg:"If you're running a business and manually following up with leads, there's a better way. I've been using Ooplix — an AI OS that automates follow-ups, generates payment links, and runs tasks autonomously. Free trial: {{referral_link}}" },
  { id:"twitter",   channel:"X/Twitter", icon:"𝕏",  color:"#e7e9ea", msg:"Spent way too long manually chasing leads this year. Then found Ooplix — it automates the whole follow-up sequence on WhatsApp. Free trial: {{referral_link}}" },
  { id:"email",     channel:"Email",     icon:"✉",  color:"#f0b429", msg:"Hi,\n\nThought you'd find this useful — Ooplix automates lead follow-ups via WhatsApp and takes care of payment collection. Free 7-day trial (no card required): {{referral_link}}" },
];

const REF_KEY = "gov2_referral_link";

function TabReferral({ addToast }) {
  const [referrals, setReferrals] = useState(0);
  const [referralLink] = useState(() => {
    const stored = localStorage.getItem(REF_KEY);
    if (stored) return stored;
    const link = `https://ooplix.com/r/${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem(REF_KEY, link);
    return link;
  });
  const [selectedShare, setSelectedShare] = useState("whatsapp");

  const earned = referrals >= 25 ? REFERRAL_TIERS[3] : referrals >= 10 ? REFERRAL_TIERS[2] : referrals >= 3 ? REFERRAL_TIERS[1] : referrals >= 1 ? REFERRAL_TIERS[0] : null;
  const nextTier = REFERRAL_TIERS.find(t => t.milestone > referrals) || REFERRAL_TIERS[3];

  const currentShare = SHARE_TEMPLATES.find(t => t.id === selectedShare);
  const shareText = currentShare ? currentShare.msg.replace("{{referral_link}}", referralLink) : "";

  return (
    <div className="gov2-tab-body">
      <div className="gov2-ref-header">
        <div className="gov2-ref-link-box">
          <p className="gov2-section-label">Your referral link</p>
          <div className="gov2-ref-link-row">
            <span className="gov2-ref-link gov2-mono">{referralLink}</span>
            <CopyBtn text={referralLink} addToast={addToast} />
          </div>
        </div>
        <div className="gov2-ref-stats">
          <div className="gov2-kpi"><span className="gov2-kpi-val" style={{ color:"#7c6fff" }}>{referrals}</span><span className="gov2-kpi-label">Referrals</span></div>
          <div className="gov2-kpi"><span className="gov2-kpi-val" style={{ color:"#52d68a" }}>{earned ? earned.reward : "None yet"}</span><span className="gov2-kpi-label">Current reward</span></div>
          <div className="gov2-kpi"><span className="gov2-kpi-val">{nextTier.reward}</span><span className="gov2-kpi-label">Next: {nextTier.milestone} refs</span></div>
        </div>
      </div>

      <div className="gov2-ref-tiers">
        {REFERRAL_TIERS.map(tier => {
          const unlocked = referrals >= tier.milestone;
          return (
            <div key={tier.milestone} className={`gov2-tier-card${unlocked ? " gov2-tier-card--unlocked" : ""}`} style={{ borderColor: unlocked ? tier.color+"40" : undefined }}>
              <span className="gov2-tier-icon" style={{ color: tier.color }}>{tier.icon}</span>
              <div className="gov2-tier-body">
                <span className="gov2-tier-milestone">{tier.milestone} referral{tier.milestone > 1 ? "s" : ""}</span>
                <span className="gov2-tier-reward" style={{ color: unlocked ? tier.color : "#8994b0" }}>{tier.reward}</span>
              </div>
              {unlocked && <span className="gov2-tier-check" style={{ color: tier.color }}>✓</span>}
            </div>
          );
        })}
      </div>

      <div className="gov2-panel gov2-share-panel">
        <p className="gov2-section-label">Share</p>
        <div className="gov2-share-channel-pick">
          {SHARE_TEMPLATES.map(t => (
            <button key={t.id} className={`gov2-filter-chip${selectedShare === t.id ? " gov2-filter-chip--active" : ""}`} onClick={() => setSelectedShare(t.id)}>{t.channel}</button>
          ))}
        </div>
        {currentShare && (
          <div className="gov2-share-msg-box">
            <pre className="gov2-share-msg">{shareText}</pre>
            <div className="gov2-share-actions">
              <CopyBtn text={shareText} addToast={addToast} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Launch Center ─────────────────────────────────────────────────────

const LAUNCH_CHECKLIST = [
  { id:"l1",  phase:"Pre-launch",  item:"Google Search Console verified",           done:false, link:"https://search.google.com/search-console" },
  { id:"l2",  phase:"Pre-launch",  item:"GA4 + GTM events firing",                  done:true,  link:null },
  { id:"l3",  phase:"Pre-launch",  item:"Landing page hero copy finalised",          done:true,  link:null },
  { id:"l4",  phase:"Pre-launch",  item:"Razorpay live keys configured",             done:false, link:null },
  { id:"l5",  phase:"Pre-launch",  item:"WhatsApp Business number connected",        done:true,  link:null },
  { id:"l6",  phase:"Pre-launch",  item:"Privacy Policy & Terms on landing page",   done:true,  link:null },
  { id:"l7",  phase:"Pre-launch",  item:"First 10 beta users invited",               done:true,  link:null },
  { id:"l8",  phase:"Launch week", item:"ProductHunt launch post drafted",           done:false, link:null },
  { id:"l9",  phase:"Launch week", item:"LinkedIn announcement post scheduled",      done:false, link:null },
  { id:"l10", phase:"Launch week", item:"WhatsApp broadcast to warm leads sent",     done:false, link:null },
  { id:"l11", phase:"Launch week", item:"Welcome email sequence active",             done:false, link:null },
  { id:"l12", phase:"Post-launch", item:"Support ticket SLA monitored (<4h)",        done:false, link:null },
  { id:"l13", phase:"Post-launch", item:"First 5 customer reviews collected",        done:false, link:null },
  { id:"l14", phase:"Post-launch", item:"Referral program announced to users",       done:false, link:null },
];

const CK_KEY = "gov2_launch_checklist";
function _loadCK() { try { const s = localStorage.getItem(CK_KEY); return s ? JSON.parse(s) : LAUNCH_CHECKLIST; } catch { return LAUNCH_CHECKLIST; } }
function _saveCK(list) { try { localStorage.setItem(CK_KEY, JSON.stringify(list)); } catch {} }

function TabLaunch({ addToast }) {
  const [items, setItems] = useState(_loadCK);

  function toggle(id) {
    const updated = items.map(x => x.id === id ? { ...x, done: !x.done } : x);
    setItems(updated);
    _saveCK(updated);
  }

  const phases = [...new Set(items.map(i => i.phase))];
  const doneCount = items.filter(i => i.done).length;
  const pct = Math.round((doneCount / items.length) * 100);

  return (
    <div className="gov2-tab-body">
      <div className="gov2-launch-progress">
        <div className="gov2-lp-top">
          <span className="gov2-lp-label">Launch readiness</span>
          <span className="gov2-lp-val" style={{ color: pct >= 80 ? "#52d68a" : pct >= 50 ? "#f0b429" : "#f55b5b" }}>{pct}%</span>
        </div>
        <div className="gov2-bar-track">
          <div className="gov2-bar-fill" style={{ width:`${pct}%`, background: pct >= 80 ? "#52d68a" : pct >= 50 ? "#f0b429" : "#f55b5b" }} />
        </div>
        <span className="gov2-lp-sub">{doneCount} of {items.length} items done</span>
      </div>

      {phases.map(phase => (
        <div key={phase} className="gov2-panel">
          <p className="gov2-section-label">{phase}</p>
          {items.filter(i => i.phase === phase).map(item => (
            <div key={item.id} className="gov2-launch-item" onClick={() => toggle(item.id)}>
              <span className="gov2-check-box" style={{ background: item.done ? "#52d68a" : "transparent", borderColor: item.done ? "#52d68a" : "#4a5470" }}>
                {item.done && <span style={{ color:"#10121a", fontWeight:800, fontSize:".7rem" }}>✓</span>}
              </span>
              <span className={`gov2-launch-item-text${item.done ? " gov2-launch-item-text--done" : ""}`}>{item.item}</span>
              {item.link && (
                <a className="gov2-launch-link" href={item.link} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>→</a>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────

export default function GrowthOSV2({ onNavigate }) {
  const [tab,    setTab]    = useState("seo");
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((msg, type = "info") => {
    const id = Date.now();
    setToasts(t => [...t, { id, msg, type }]);
  }, []);
  const removeToast = useCallback(id => setToasts(t => t.filter(x => x.id !== id)), []);

  useEffect(() => { track("growth_os_v2_viewed"); }, []);

  return (
    <div className="gov2-root">
      <div className="gov2-header">
        <div>
          <h1 className="gov2-page-title">Growth OS</h1>
          <p className="gov2-page-sub">SEO · Content engine · Social publishing · Email marketing · Referral · Launch</p>
        </div>
      </div>

      <div className="gov2-subnav">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`gov2-subnav-tab${tab === t.id ? " gov2-subnav-tab--active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="gov2-tab-content">
        {tab === "seo"      && <TabSEO      addToast={addToast} />}
        {tab === "content"  && <TabContent  addToast={addToast} />}
        {tab === "social"   && <TabSocial   addToast={addToast} />}
        {tab === "email"    && <TabEmail    addToast={addToast} />}
        {tab === "referral" && <TabReferral addToast={addToast} />}
        {tab === "launch"   && <TabLaunch   addToast={addToast} />}
      </div>

      <div className="gov2-toast-container">
        {toasts.map(t => (
          <Toast key={t.id} msg={t.msg} type={t.type} onDone={() => removeToast(t.id)} />
        ))}
      </div>
    </div>
  );
}
