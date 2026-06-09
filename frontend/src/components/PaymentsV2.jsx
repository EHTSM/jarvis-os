import React, { useState, useEffect, useCallback } from "react";
import { generatePaymentLink, getLeads, testWhatsAppSend } from "../api";
import "./PaymentsV2.css";

// ── Helpers ────────────────────────────────────────────────────────────────────

const WA_TEMPLATES = [
  {
    id: "checkin",
    label: "Follow-up — Check in (casual)",
    text: (name) => `Hi ${name || "there"}! Just checking in — did you get a chance to look at our proposal? Happy to answer any questions. 😊`,
  },
  {
    id: "payment",
    label: "Follow-up — Payment reminder",
    text: (name) => `Hi ${name || "there"}, this is a gentle reminder about the payment. Please let me know if you need any assistance. Thank you!`,
  },
  {
    id: "proposal",
    label: "Follow-up — Proposal send",
    text: (name) => `Hi ${name || "there"}! I wanted to follow up on the proposal I sent. Would love to get your thoughts and move forward. 🙏`,
  },
  { id: "custom", label: "Custom message", text: () => "" },
];

const HISTORY_KEY = "pv2_link_history";

function _loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); }
  catch { return []; }
}

function _saveHistory(item) {
  try {
    const prev = _loadHistory().slice(0, 19);
    localStorage.setItem(HISTORY_KEY, JSON.stringify([item, ...prev]));
  } catch {}
}

function _timeAgo(ts) {
  if (!ts) return "—";
  const ms = Date.now() - ts;
  const m  = Math.floor(ms / 60_000);
  if (m < 1)  return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d}d ago`;
}

// ── Toast ──────────────────────────────────────────────────────────────────────

function Toast({ toasts }) {
  if (!toasts.length) return null;
  return (
    <div className="pv2-toast-container" aria-live="polite">
      {toasts.map(t => (
        <div key={t.id} className={`pv2-toast pv2-toast--${t.type}`}>{t.msg}</div>
      ))}
    </div>
  );
}

// ── Razorpay setup guide (inline) ──────────────────────────────────────────────

function RazorpayGuide({ onDismiss }) {
  return (
    <div className="pv2-rzp-guide">
      <div className="pv2-rzp-guide-header">
        <div>
          <p className="pv2-rzp-guide-title">Set up Razorpay to collect payments</p>
          <p className="pv2-rzp-guide-sub">Free account · Takes 5 minutes · ₹0 until you charge someone</p>
        </div>
        <button className="pv2-rzp-dismiss" onClick={onDismiss} aria-label="Dismiss">✕</button>
      </div>
      <ol className="pv2-rzp-steps">
        <li><strong>Create Razorpay account</strong> at <a href="https://dashboard.razorpay.com/signup" target="_blank" rel="noreferrer" className="pv2-link">razorpay.com ↗</a></li>
        <li><strong>Copy API keys:</strong> Dashboard → Settings → API Keys → Generate Test Key</li>
        <li><strong>Add to server .env:</strong>
          <code className="pv2-code">RAZORPAY_KEY_ID=rzp_test_...</code>
          <code className="pv2-code">RAZORPAY_KEY_SECRET=...</code>
          <code className="pv2-code">pm2 restart jarvis-os</code>
        </li>
      </ol>
    </div>
  );
}

// ── Payment Link Generator Panel ───────────────────────────────────────────────

function LinkGenerator({ leads, onLinkCreated }) {
  const [form,       setForm]       = useState({ name: "", phone: "", amount: "", description: "" });
  const [loading,    setLoading]    = useState(false);
  const [result,     setResult]     = useState(null);
  const [err,        setErr]        = useState("");
  const [copied,     setCopied]     = useState(false);
  const [showSetup,  setShowSetup]  = useState(false);
  const [contactQ,   setContactQ]   = useState("");

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const filteredLeads = (leads || []).filter(l => {
    const q = contactQ.toLowerCase();
    return !q || (l.name || "").toLowerCase().includes(q) || (l.phone || "").includes(q);
  }).slice(0, 5);

  const selectContact = (l) => {
    setForm(f => ({ ...f, name: l.name || "", phone: l.phone || "" }));
    setContactQ("");
  };

  const generate = async () => {
    if (!form.amount || isNaN(Number(form.amount))) { setErr("Enter a valid amount."); return; }
    setErr(""); setLoading(true); setResult(null);
    try {
      const res = await generatePaymentLink(form);
      if (res?.success && res?.link) {
        const item = { url: res.link, name: form.name, phone: form.phone, amount: form.amount, ts: Date.now() };
        setResult(item);
        _saveHistory(item);
        onLinkCreated(item);
        setForm(f => ({ ...f, name: "", phone: "", amount: "", description: "" }));
      } else {
        const rawErr = res?.error || "";
        if (/razorpay|key|not configured/i.test(rawErr)) setShowSetup(true);
        setErr(/razorpay|key|not configured/i.test(rawErr)
          ? "Payments not configured — see setup guide below."
          : rawErr || "Could not generate link. Try again.");
      }
    } catch (e) { setErr(e.message); }
    finally     { setLoading(false); }
  };

  const copy = () => {
    if (!result?.url) return;
    navigator.clipboard.writeText(result.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const waShare = () => {
    if (!result) return;
    const text = encodeURIComponent(`Hi ${result.name || "there"}! Here's your payment link: ${result.url}`);
    const phone = (result.phone || "").replace(/\D/g, "");
    window.open(`https://wa.me/${phone || ""}?text=${text}`, "_blank", "noreferrer");
  };

  return (
    <div className="pv2-panel">
      <h2 className="pv2-panel-title">Payment Link Generator</h2>
      <div className="pv2-panel-body">

        {/* Contact search */}
        <label className="pv2-label">Customer (optional)</label>
        <div className="pv2-contact-search-wrap">
          <input
            className="pv2-input"
            placeholder="Search contacts…"
            value={contactQ}
            onChange={e => setContactQ(e.target.value)}
          />
          {contactQ && filteredLeads.length > 0 && (
            <div className="pv2-contact-dropdown">
              {filteredLeads.map((l, i) => (
                <button key={i} className="pv2-contact-opt" onClick={() => selectContact(l)}>
                  <span className="pv2-contact-name">{l.name}</span>
                  <span className="pv2-contact-phone">{l.phone}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {(form.name || form.phone) && (
          <div className="pv2-prefill-row">
            <span className="pv2-prefill-tag">{form.name} · {form.phone}</span>
            <button className="pv2-prefill-clear" onClick={() => setForm(f => ({ ...f, name: "", phone: "" }))}>✕</button>
          </div>
        )}

        <label className="pv2-label">Amount (₹) <span className="pv2-req">*</span></label>
        <input className="pv2-input" placeholder="15000" value={form.amount}
          onChange={e => set("amount", e.target.value)} inputMode="numeric" />

        <label className="pv2-label">Description</label>
        <input className="pv2-input" placeholder="Website redesign — 50% advance" value={form.description}
          onChange={e => set("description", e.target.value)} />

        {err && <p className="pv2-err">{err}</p>}

        <button className="pv2-btn pv2-btn--primary pv2-btn--full" onClick={generate} disabled={loading}>
          {loading ? "Generating…" : "Generate Link →"}
        </button>

        {/* Success result */}
        {result && (
          <div className="pv2-result">
            <div className="pv2-result-header">
              <span className="pv2-result-ok">✓</span>
              <span className="pv2-result-label">Link created{result.name ? ` for ${result.name}` : ""}</span>
            </div>
            <div className="pv2-result-url-row">
              <span className="pv2-result-url">{result.url}</span>
              <button className="pv2-btn pv2-btn--sm pv2-btn--ghost" onClick={copy}>
                {copied ? "✓ Copied" : "Copy"}
              </button>
            </div>
            <div className="pv2-result-actions">
              <button className="pv2-btn pv2-btn--sm pv2-btn--wa" onClick={waShare}>
                Share on WhatsApp ↗
              </button>
              <button className="pv2-btn pv2-btn--sm pv2-btn--ghost" onClick={() => setResult(null)}>
                Dismiss
              </button>
            </div>
          </div>
        )}

        {showSetup && <RazorpayGuide onDismiss={() => setShowSetup(false)} />}
      </div>
    </div>
  );
}

// ── WhatsApp Follow-up Panel ───────────────────────────────────────────────────

function WaFollowupPanel({ leads }) {
  const [phone,    setPhone]    = useState("");
  const [template, setTemplate] = useState("");
  const [msg,      setMsg]      = useState("");
  const [sending,  setSending]  = useState(false);
  const [result,   setResult]   = useState(null);
  const [history,  setHistory]  = useState([]);

  useEffect(() => {
    try {
      const key = "pv2_wa_history";
      const h = JSON.parse(localStorage.getItem(key) || "[]");
      setHistory(h);
    } catch {}
  }, []);

  const handleTemplate = (id) => {
    setTemplate(id);
    const t = WA_TEMPLATES.find(x => x.id === id);
    if (t) {
      const name = leads?.find(l => (l.phone || "").replace(/\D/g, "").includes(phone.replace(/\D/g, "")))?.name || "";
      setMsg(t.text(name));
    }
  };

  const send = async () => {
    const clean = phone.replace(/\D/g, "");
    if (!clean || clean.length < 7) { setResult({ ok: false, err: "Enter a valid phone number." }); return; }
    if (!msg.trim()) { setResult({ ok: false, err: "Enter a message to send." }); return; }
    setSending(true); setResult(null);
    try {
      const res = await testWhatsAppSend(clean, msg);
      if (res?.success) {
        setResult({ ok: true });
        const entry = { phone: clean, preview: msg.slice(0, 50), ts: Date.now() };
        const key = "pv2_wa_history";
        const prev = JSON.parse(localStorage.getItem(key) || "[]").slice(0, 9);
        const next = [entry, ...prev];
        localStorage.setItem(key, JSON.stringify(next));
        setHistory(next);
        setPhone(""); setMsg(""); setTemplate("");
      } else {
        setResult({ ok: false, err: res?.error || "Failed to send. Check WhatsApp connection." });
      }
    } catch (e) { setResult({ ok: false, err: e.message }); }
    finally     { setSending(false); }
  };

  return (
    <div className="pv2-panel">
      <h2 className="pv2-panel-title">WhatsApp Follow-up</h2>
      <div className="pv2-panel-body">

        <label className="pv2-label">Phone number</label>
        <input className="pv2-input" placeholder="+91-9876543210" value={phone}
          onChange={e => setPhone(e.target.value)} inputMode="tel" />

        <label className="pv2-label">Message template</label>
        <select className="pv2-input pv2-select" value={template} onChange={e => handleTemplate(e.target.value)}>
          <option value="">— choose template —</option>
          {WA_TEMPLATES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>

        <label className="pv2-label">Message</label>
        <textarea
          className="pv2-input pv2-textarea"
          placeholder="Type a message or choose a template above…"
          value={msg}
          onChange={e => setMsg(e.target.value)}
          rows={4}
        />

        {result?.ok  && <p className="pv2-ok-msg">✓ Message sent to {phone}</p>}
        {result?.err && <p className="pv2-err">{result.err}</p>}

        <button className="pv2-btn pv2-btn--wa pv2-btn--full" onClick={send} disabled={sending}>
          {sending ? "Sending…" : "Send via WhatsApp"}
        </button>

        {/* Recent follow-ups */}
        {history.length > 0 && (
          <div className="pv2-wa-history">
            <p className="pv2-history-label">Recent follow-ups</p>
            {history.slice(0, 5).map((h, i) => (
              <div key={i} className="pv2-history-row">
                <span className="pv2-history-phone">{h.phone}</span>
                <span className="pv2-history-preview">{h.preview}…</span>
                <span className="pv2-history-ts">{_timeAgo(h.ts)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Recent Payment Links ───────────────────────────────────────────────────────

function RecentLinks({ links, onCopy }) {
  if (!links.length) return (
    <div className="pv2-links-empty">
      <div className="pv2-links-empty-icon">₹</div>
      <p className="pv2-links-empty-title">No payment links generated yet</p>
      <p className="pv2-links-empty-sub">Generate your first link to start collecting payments.</p>
    </div>
  );

  return (
    <div className="pv2-links-list">
      {links.map((l, i) => (
        <div key={i} className="pv2-link-row">
          <div className="pv2-link-info">
            <span className="pv2-link-name">{l.name || "Anonymous"}</span>
            <span className="pv2-link-meta">
              {l.amount ? `₹${Number(l.amount).toLocaleString("en-IN")}` : ""}
              {l.amount && l.ts ? " · " : ""}
              {_timeAgo(l.ts)}
            </span>
          </div>
          <div className="pv2-link-actions">
            <span className="pv2-link-url-short">{(l.url || "").replace("https://", "").slice(0, 22)}…</span>
            <button className="pv2-btn pv2-btn--sm pv2-btn--ghost" onClick={() => onCopy(l.url)}>Copy</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Root Payments V2 ───────────────────────────────────────────────────────────

export default function PaymentsV2({ onNavigate }) {
  const [leads,     setLeads]     = useState(null);
  const [history,   setHistory]   = useState(() => _loadHistory());
  const [toasts,    setToasts]    = useState([]);

  const toast = (type, msg) => {
    const id = Date.now();
    setToasts(t => [...t, { id, type, msg }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3000);
  };

  const copyLink = (url) => {
    navigator.clipboard.writeText(url);
    toast("success", "Link copied to clipboard!");
  };

  useEffect(() => {
    getLeads().then(d => setLeads(Array.isArray(d) ? d : [])).catch(() => setLeads([]));
  }, []);

  const handleLinkCreated = (item) => {
    setHistory(prev => [item, ...prev]);
    toast("success", `Payment link created${item.name ? ` for ${item.name}` : ""}`);
  };

  return (
    <div className="pv2-root page-enter">
      <Toast toasts={toasts} />

      {/* Header */}
      <div className="pv2-header">
        <div>
          <h1 className="pv2-page-title">Payments</h1>
          <p className="pv2-page-sub">Generate payment links and send WhatsApp follow-ups</p>
        </div>
      </div>

      {/* Two-panel grid */}
      <div className="pv2-grid">
        <div className="pv2-main">
          <LinkGenerator leads={leads} onLinkCreated={handleLinkCreated} />

          {/* Generated links history */}
          <div className="pv2-panel">
            <div className="pv2-panel-title-row">
              <h2 className="pv2-panel-title">Generated Links</h2>
              {history.length > 0 && (
                <span className="pv2-panel-count">{history.length}</span>
              )}
            </div>
            <RecentLinks links={history} onCopy={copyLink} />
          </div>
        </div>

        <div className="pv2-side">
          <WaFollowupPanel leads={leads} />
        </div>
      </div>
    </div>
  );
}
