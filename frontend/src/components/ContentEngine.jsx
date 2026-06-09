import React, { useState, useCallback } from "react";
import { track } from "../analytics";
import { sendMessage } from "../api";
import "./ContentEngine.css";

// ── Content type catalogue ───────────────────────────────────────────
const CONTENT_TYPES = [
  { id: "blog",      label: "Blog Post",       icon: "◎", color: "var(--accent)"  },
  { id: "landing",   label: "Landing Page",    icon: "◈", color: "var(--accent2)" },
  { id: "linkedin",  label: "LinkedIn Post",   icon: "◉", color: "#0a66c2"        },
  { id: "twitter",   label: "X / Twitter",     icon: "✕", color: "var(--text)"    },
  { id: "email",     label: "Email Draft",     icon: "✉", color: "var(--warning)" },
  { id: "thread",    label: "Twitter Thread",  icon: "⊞", color: "var(--text)"    },
];

// ── Prompt templates ─────────────────────────────────────────────────
const TEMPLATES = {
  blog: [
    { label: "SEO keyword post",  prompt: "Write a 1,200-word SEO blog post about \"whatsapp follow up automation\" targeting small business owners and freelancers in India. Include: what the problem is, how automation solves it, and a step-by-step guide. Add a natural mention of Ooplix as the solution." },
    { label: "Problem/solution",  prompt: "Write a problem/solution blog post about manual lead follow-up being the #1 reason freelancers lose business. Position automated WhatsApp sequences as the fix. 800 words, first-person conversational tone." },
    { label: "Comparison post",   prompt: "Write a comparison post: Manual follow-up vs Ooplix AI OS. Use a table for feature comparison. Tone: honest, not salesy. 1,000 words." },
    { label: "Case study format", prompt: "Write a case study blog post for a freelance graphic designer who added Ooplix and saw 3× more leads reply within the first week. 800 words, first-person narrative." },
  ],
  landing: [
    { label: "Freelancers page",  prompt: "Write copy for a landing page targeting freelancers in India. H1, subheadline, 3 benefit bullets, social proof line, and CTA. Tone: direct, confident, not pushy." },
    { label: "Coaches page",      prompt: "Write landing page copy for business coaches. Focus on automating intake, follow-up, and payment collection. H1 through CTA. 250 words max." },
    { label: "Agencies page",     prompt: "Write landing page copy for digital agencies managing multiple clients. Emphasise the multi-client pipeline, bulk messaging, and revenue dashboard." },
    { label: "Razorpay integration", prompt: "Write a feature landing page about Ooplix + Razorpay integration: automatic payment link generation, one-tap sending, real-time revenue tracking." },
  ],
  linkedin: [
    { label: "Value hook post",   prompt: "Write a LinkedIn post about the hidden cost of manual lead follow-up. Hook: a specific number or surprising stat. 150 words max. End with a subtle CTA about Ooplix." },
    { label: "Story post",        prompt: "Write a LinkedIn story post from the POV of a freelancer who was losing 3-4 deals a month to slow follow-up until they automated it. 200 words. Personal, not salesy." },
    { label: "Insight post",      prompt: "Write a LinkedIn insight post: 3 reasons WhatsApp automation converts better than email follow-up in India. Numbered list, 180 words." },
    { label: "Product launch",    prompt: "Write a LinkedIn product launch post for Ooplix. Announce what it does, who it's for, and invite early adopters. 150 words. Enthusiastic but professional." },
  ],
  twitter: [
    { label: "Hook tweet",        prompt: "Write a hook tweet (280 chars max) about how most freelancers lose 40% of their leads to slow follow-up. No fluff. Punchy." },
    { label: "Product tweet",     prompt: "Write a tweet announcing Ooplix — an AI OS for small businesses that automates WhatsApp follow-ups, collects payments, and runs tasks autonomously." },
    { label: "Stat tweet",        prompt: "Write a tweet sharing a surprising stat about business automation in India. End with a question to drive replies." },
    { label: "CTA tweet",         prompt: "Write a tweet CTA for Ooplix's 7-day free trial. Ultra short, specific benefit, clear action." },
  ],
  email: [
    { label: "Welcome email",     prompt: "Write a welcome email for new Ooplix trial users. Subject line + 200-word body. Warm, helpful tone. Tell them the 3 things to do first." },
    { label: "Trial expiry (3 days)", prompt: "Write a trial expiry reminder email sent 3 days before the trial ends. Urgency without pressure. 150 words. Include a benefit recap and upgrade link placeholder." },
    { label: "Upgrade nudge",     prompt: "Write an upgrade email for trial users who haven't added a contact yet. Subject: 'Your automations are ready — just add a contact'. 180 words." },
    { label: "Win-back email",    prompt: "Write a win-back email for churned users (cancelled or expired). 'We noticed you left' hook. 150 words. Offer to help, not just discount." },
  ],
  thread: [
    { label: "Value thread",      prompt: "Write a 6-tweet thread on '5 reasons businesses lose leads and how to fix each one'. Tweet 1 is the hook, tweets 2-6 cover each reason, tweet 7 is the wrap-up with Ooplix mention." },
    { label: "Tutorial thread",   prompt: "Write a 5-tweet tutorial thread on how to set up automated WhatsApp follow-ups with Ooplix. Step-by-step, each tweet is one action." },
    { label: "Story thread",      prompt: "Write an 8-tweet thread telling the story of how an agency stopped losing clients to slow follow-up using Ooplix. Real narrative, no corporate speak." },
  ],
};

// ── Draft storage ─────────────────────────────────────────────────────
const DRAFTS_KEY = "ooplix_content_drafts";
function _loadDrafts() {
  try { return JSON.parse(localStorage.getItem(DRAFTS_KEY) || "[]"); }
  catch { return []; }
}
function _saveDraft(draft) {
  const drafts = _loadDrafts();
  const existing = drafts.findIndex(d => d.id === draft.id);
  if (existing >= 0) drafts[existing] = draft;
  else drafts.unshift(draft);
  localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts.slice(0, 50)));
}
function _deleteDraft(id) {
  const drafts = _loadDrafts().filter(d => d.id !== id);
  localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
}

function _newDraft(type) {
  return {
    id:        `draft_${Date.now()}`,
    type,
    title:     "",
    content:   "",
    prompt:    "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status:    "draft",
  };
}

// ── Character counter ─────────────────────────────────────────────────
function CharCount({ content, type }) {
  const len     = content.length;
  const limits  = { twitter: 280, linkedin: 3000, thread: 280 };
  const limit   = limits[type];
  if (!limit) return <span className="ce-charcount">{len} chars</span>;
  const over    = len > limit;
  return (
    <span className={`ce-charcount${over ? " ce-charcount--over" : ""}`}>
      {len} / {limit}{over ? " — over limit" : ""}
    </span>
  );
}

// ── Editor pane ───────────────────────────────────────────────────────
function DraftEditor({ draft, onSave, onClose, onDelete }) {
  const [title,      setTitle]      = useState(draft.title   || "");
  const [content,    setContent]    = useState(draft.content || "");
  const [prompt,     setPrompt]     = useState(draft.prompt  || "");
  const [copied,     setCopied]     = useState(false);
  const [generating, setGenerating] = useState(false);
  const typeDef  = CONTENT_TYPES.find(t => t.id === draft.type) || CONTENT_TYPES[0];
  const templates = TEMPLATES[draft.type] || [];

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) return;
    setGenerating(true);
    track.event("content_generate_clicked", { type: draft.type });
    const res = await sendMessage(prompt.trim(), "smart");
    if (res?.reply) setContent(res.reply);
    setGenerating(false);
  }, [prompt, draft.type]);

  const handleSave = useCallback(() => {
    const updated = { ...draft, title, content, prompt, updatedAt: new Date().toISOString() };
    _saveDraft(updated);
    onSave(updated);
    track.event("content_draft_saved", { type: draft.type });
  }, [draft, title, content, prompt, onSave]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      track.event("content_draft_copied", { type: draft.type });
    });
  }, [content]);

  return (
    <div className="ce-editor">
      <div className="ce-editor-header">
        <div className="ce-editor-type">
          <span className="ce-type-icon" style={{ color: typeDef.color }}>{typeDef.icon}</span>
          <span className="ce-type-label">{typeDef.label}</span>
        </div>
        <div className="ce-editor-actions">
          <button className="ce-btn-icon" onClick={handleCopy} title="Copy content">
            {copied ? "✓ Copied" : "Copy"}
          </button>
          <button className="ce-btn-icon ce-btn-icon--save" onClick={handleSave}>Save</button>
          <button className="ce-btn-icon ce-btn-icon--delete" onClick={() => { onDelete(draft.id); onClose(); }} title="Delete draft">✕</button>
          <button className="ce-btn-icon" onClick={onClose}>← Back</button>
        </div>
      </div>

      <input
        className="ce-title-input"
        placeholder="Draft title (internal only)…"
        value={title}
        onChange={e => setTitle(e.target.value)}
      />

      {/* Prompt section */}
      <div className="ce-prompt-section">
        <p className="ce-section-label">
          Prompt
          <span className="ce-section-hint"> — paste into ChatGPT, Claude, or any AI to generate</span>
        </p>
        {templates.length > 0 && (
          <div className="ce-template-chips">
            {templates.map(t => (
              <button
                key={t.label}
                className="ce-template-chip"
                onClick={() => { setPrompt(t.prompt); track.event("content_template_selected", { type: draft.type, template: t.label }); }}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
        <textarea
          className="ce-prompt-textarea"
          placeholder="Write or select a prompt above…"
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          rows={4}
        />
        <button
          className="ce-generate-btn"
          onClick={handleGenerate}
          disabled={generating || !prompt.trim()}
        >
          {generating ? "Generating…" : "⚡ Generate with Jarvis"}
        </button>
      </div>

      {/* Content section */}
      <div className="ce-content-section">
        <div className="ce-content-header">
          <p className="ce-section-label">Content</p>
          <CharCount content={content} type={draft.type} />
        </div>
        <textarea
          className="ce-content-textarea"
          placeholder="Paste AI-generated content here, then edit…"
          value={content}
          onChange={e => setContent(e.target.value)}
          rows={16}
        />
      </div>
    </div>
  );
}

// ── Draft list item ───────────────────────────────────────────────────
function DraftItem({ draft, onOpen }) {
  const typeDef = CONTENT_TYPES.find(t => t.id === draft.type) || CONTENT_TYPES[0];
  const preview = draft.content ? draft.content.slice(0, 90) + (draft.content.length > 90 ? "…" : "") : "No content yet";
  const date    = new Date(draft.updatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  return (
    <button className="ce-draft-item" onClick={() => onOpen(draft)}>
      <div className="ce-draft-type-col">
        <span className="ce-draft-icon" style={{ color: typeDef.color }}>{typeDef.icon}</span>
        <span className="ce-draft-type-label">{typeDef.label}</span>
      </div>
      <div className="ce-draft-body">
        <span className="ce-draft-title">{draft.title || "(Untitled)"}</span>
        <span className="ce-draft-preview">{preview}</span>
      </div>
      <span className="ce-draft-date">{date}</span>
    </button>
  );
}

// ── Root ──────────────────────────────────────────────────────────────
export default function ContentEngine({ onNavigate }) {
  const [drafts,  setDrafts]  = useState(_loadDrafts);
  const [editing, setEditing] = useState(null);
  const [filter,  setFilter]  = useState("all");

  const handleNew = useCallback((typeId) => {
    const draft = _newDraft(typeId);
    _saveDraft(draft);
    setDrafts(_loadDrafts());
    setEditing(draft);
    track.event("content_draft_created", { type: typeId });
  }, []);

  const handleSave = useCallback((updated) => {
    setDrafts(_loadDrafts());
  }, []);

  const handleDelete = useCallback((id) => {
    _deleteDraft(id);
    setDrafts(_loadDrafts());
    track.event("content_draft_deleted");
  }, []);

  const filtered = filter === "all" ? drafts : drafts.filter(d => d.type === filter);

  if (editing) {
    return (
      <div className="content-engine page-enter">
        <DraftEditor
          draft={editing}
          onSave={handleSave}
          onClose={() => setEditing(null)}
          onDelete={handleDelete}
        />
      </div>
    );
  }

  return (
    <div className="content-engine page-enter">
      <div className="ce-header">
        <div>
          <h1 className="ce-title">Content Engine</h1>
          <p className="ce-subtitle">Draft, organise, and publish content across every channel.</p>
        </div>
      </div>

      {/* New content buttons */}
      <div className="ce-new-section">
        <p className="ce-section-label">New draft</p>
        <div className="ce-new-grid">
          {CONTENT_TYPES.map(t => (
            <button key={t.id} className="ce-new-btn" onClick={() => handleNew(t.id)}>
              <span className="ce-new-icon" style={{ color: t.color }}>{t.icon}</span>
              <span className="ce-new-label">{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Filter + drafts */}
      <div className="ce-drafts-section">
        <div className="ce-filter-row">
          <p className="ce-section-label">Drafts ({drafts.length})</p>
          <div className="ce-filter-chips">
            <button className={`ce-filter-chip${filter === "all" ? " ce-filter-chip--active" : ""}`} onClick={() => setFilter("all")}>All</button>
            {CONTENT_TYPES.map(t => (
              <button
                key={t.id}
                className={`ce-filter-chip${filter === t.id ? " ce-filter-chip--active" : ""}`}
                onClick={() => setFilter(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="ce-empty">
            <span className="ce-empty-icon">◎</span>
            <p className="ce-empty-title">{filter === "all" ? "No drafts yet" : `No ${CONTENT_TYPES.find(t=>t.id===filter)?.label} drafts`}</p>
            <p className="ce-empty-sub">Select a content type above to create your first draft.</p>
          </div>
        ) : (
          <div className="ce-drafts-list">
            {filtered.map(d => (
              <DraftItem key={d.id} draft={d} onOpen={setEditing} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
