import React, { useState } from "react";
import { Browser }            from "@capacitor/browser";
import { useAuth }            from "../context/AuthContext.jsx";
import { useToast }           from "../context/ToastContext.jsx";
import { generateTask, generatePaymentLink, sendFollowUp, getLeads } from "../api.js";
import { saveTask }           from "../firebase.js";

// ── Task Generator ───────────────────────────────────────────────────
function TaskGenerator({ onSave }) {
  const { user } = useAuth();
  const toast    = useToast();
  const [prompt,  setPrompt]  = useState("");
  const [result,  setResult]  = useState("");
  const [loading, setLoading] = useState(false);

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setResult("");
    try {
      const res = await generateTask(prompt.trim());
      if (res.success) {
        setResult(res.reply);
        if (user) {
          await saveTask(user.uid, { prompt: prompt.trim(), result: res.reply });
          onSave?.();
        }
      } else {
        toast.show(res.reply || "Failed to generate task.", "error");
      }
    } catch (err) {
      toast.show(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <p className="card-title">AI Task Generator</p>
      <div className="form-group">
        <textarea
          className="input-field"
          rows={3}
          placeholder="Describe what you want to achieve…&#10;e.g. 'Grow my Instagram following to 10k'"
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          style={{ resize: "none" }}
        />
      </div>
      <button
        className="btn btn-primary"
        onClick={handleGenerate}
        disabled={loading || !prompt.trim()}
        style={{ marginBottom: result ? 14 : 0 }}
      >
        {loading ? "Generating…" : "Generate Plan ✦"}
      </button>

      {result && (
        <div style={{
          background: "var(--surface2)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-sm)",
          padding: "14px",
          fontSize: 14,
          lineHeight: 1.7,
          color: "var(--text)",
          whiteSpace: "pre-wrap",
          userSelect: "text"
        }}>
          {result}
        </div>
      )}
    </div>
  );
}

// ── Payment Link Generator ────────────────────────────────────────────
function PaymentTool() {
  const toast = useToast();
  const [name,    setName]    = useState("");
  const [phone,   setPhone]   = useState("");
  const [amount,  setAmount]  = useState("999");
  const [link,    setLink]    = useState("");
  const [loading, setLoading] = useState(false);

  const handleGenerate = async () => {
    if (!name.trim()) { toast.show("Enter customer name.", "error"); return; }
    setLoading(true);
    setLink("");
    try {
      const res = await generatePaymentLink({
        amount:      parseInt(amount, 10) || 999,
        name:        name.trim(),
        phone:       phone.trim() || undefined,
        description: "JARVIS AI Access"
      });
      if (res.success && res.link) {
        setLink(res.link);
        toast.show("Payment link created!", "success");
      } else {
        toast.show(res.error || "Could not create link. Check backend config.", "error");
      }
    } catch (err) {
      toast.show(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const openLink = async () => {
    if (!link) return;
    await Browser.open({ url: link });
  };

  return (
    <div className="card">
      <p className="card-title">Payment Link</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <input className="input-field" placeholder="Customer name" value={name}   onChange={e => setName(e.target.value)} />
        <input className="input-field" placeholder="Phone (optional)" value={phone}  onChange={e => setPhone(e.target.value)} inputMode="tel" />
        <input className="input-field" placeholder="Amount (₹)" value={amount} onChange={e => setAmount(e.target.value)} inputMode="numeric" />
        <button className="btn btn-primary" onClick={handleGenerate} disabled={loading}>
          {loading ? "Creating…" : "Generate Link"}
        </button>
        {link && (
          <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: 12 }}>
            <p style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 8 }}>Payment link ready:</p>
            <p style={{ fontSize: 13, color: "var(--accent2)", wordBreak: "break-all", userSelect: "text" }}>{link}</p>
            <button className="btn btn-secondary" style={{ marginTop: 10, width: "100%" }} onClick={openLink}>
              Open Link ↗
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── CRM Leads Viewer ─────────────────────────────────────────────────
function LeadsViewer() {
  const toast = useToast();
  const [leads,   setLeads]   = useState(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await getLeads();
      setLeads(Array.isArray(data) ? data : []);
    } catch {
      toast.show("Could not load leads.", "error");
      setLeads([]);
    } finally {
      setLoading(false);
    }
  };

  const statusColor = {
    new: "var(--accent)", hot: "var(--warning)",
    paid: "var(--success)", onboarded: "var(--accent2)"
  };

  return (
    <div className="card">
      <p className="card-title">CRM Leads</p>
      {leads === null ? (
        <button className="btn btn-secondary" onClick={load} disabled={loading} style={{ width: "100%" }}>
          {loading ? "Loading…" : "Load Leads"}
        </button>
      ) : leads.length === 0 ? (
        <div className="empty-state" style={{ padding: "20px 0" }}>
          <span className="empty-icon">📭</span>
          <span className="empty-title">No leads yet</span>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {leads.slice(0, 15).map((l, i) => (
            <div key={i} style={{
              background: "var(--surface2)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              padding: "10px 12px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between"
            }}>
              <div>
                <p style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{l.name || "Unknown"}</p>
                <p style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 2 }}>{l.phone || "—"}</p>
              </div>
              <span style={{
                fontSize: 11,
                fontWeight: 700,
                padding: "3px 8px",
                borderRadius: 20,
                background: `${statusColor[l.status] || "var(--text-muted)"}22`,
                color: statusColor[l.status] || "var(--text-muted)",
                textTransform: "uppercase"
              }}>
                {l.status || "new"}
              </span>
            </div>
          ))}
          <button className="btn btn-secondary" onClick={load} style={{ marginTop: 4, width: "100%" }}>
            Refresh
          </button>
        </div>
      )}
    </div>
  );
}

// ── WhatsApp Follow-up ────────────────────────────────────────────────
function FollowUpTool() {
  const toast = useToast();
  const [phone,   setPhone]   = useState("");
  const [msg,     setMsg]     = useState("");
  const [loading, setLoading] = useState(false);

  const handle = async () => {
    if (!phone.trim() || !msg.trim()) { toast.show("Phone and message are required.", "error"); return; }
    setLoading(true);
    try {
      const res = await sendFollowUp(phone.trim(), msg.trim());
      if (res.success) {
        toast.show("Follow-up sent!", "success");
        setPhone(""); setMsg("");
      } else {
        toast.show(res.error || "Failed to send.", "error");
      }
    } catch (err) {
      toast.show(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <p className="card-title">WhatsApp Follow-up</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <input
          className="input-field"
          placeholder="Phone with country code (e.g. 919876543210)"
          value={phone}
          onChange={e => setPhone(e.target.value)}
          inputMode="tel"
        />
        <textarea
          className="input-field"
          rows={3}
          placeholder="Message to send…"
          value={msg}
          onChange={e => setMsg(e.target.value)}
          style={{ resize: "none" }}
        />
        <button className="btn btn-primary" onClick={handle} disabled={loading || !phone.trim() || !msg.trim()}>
          {loading ? "Sending…" : "Send WhatsApp"}
        </button>
      </div>
    </div>
  );
}

// ── Tools home ────────────────────────────────────────────────────────
const TOOL_VIEWS = {
  task:    <TaskGenerator />,
  payment: <PaymentTool />,
  crm:     <LeadsViewer />,
  followup:<FollowUpTool />
};

const TOOL_DEFS = [
  { id: "task",     icon: "✦", label: "Task Generator",     desc: "AI-powered action plan builder",     bg: "#6c63ff22", fg: "#6c63ff" },
  { id: "payment",  icon: "💳", label: "Payment Links",      desc: "Generate Razorpay payment links",    bg: "#00d4ff22", fg: "#00d4ff" },
  { id: "crm",      icon: "👥", label: "CRM & Leads",        desc: "View and manage your leads",         bg: "#00e67622", fg: "#00e676" },
  { id: "followup", icon: "💬", label: "WhatsApp Follow-up", desc: "Send manual WhatsApp messages",      bg: "#ffab4022", fg: "#ffab40" }
];

export default function Tools() {
  const [active, setActive] = useState(null);

  if (active) {
    return (
      <>
        <header className="mobile-header">
          <button
            onClick={() => setActive(null)}
            style={{ color: "var(--accent)", fontWeight: 600, fontSize: 15 }}
          >
            ← Back
          </button>
          <span style={{ fontWeight: 700, fontSize: 16 }}>
            {TOOL_DEFS.find(t => t.id === active)?.label}
          </span>
          <span style={{ width: 60 }} />
        </header>
        <div className="app-screen">
          <div className="page">
            {TOOL_VIEWS[active]}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <header className="mobile-header">
        <div className="brand">
          <span className="brand-name">Tools</span>
        </div>
      </header>
      <div className="app-screen">
        <div className="page">
          <p className="section-label">Business Tools</p>
          <div className="tool-list">
            {TOOL_DEFS.map(t => (
              <button key={t.id} className="tool-item" onClick={() => setActive(t.id)}>
                <div className="tool-icon" style={{ background: t.bg, color: t.fg }}>
                  {t.icon}
                </div>
                <div className="tool-info">
                  <div className="tool-name">{t.label}</div>
                  <div className="tool-desc">{t.desc}</div>
                </div>
                <span className="tool-arrow">›</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
