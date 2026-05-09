import React, { useState } from "react";
import { createLead } from "../api";
import "./AddClientForm.css";

const EMPTY = { name: "", phone: "", service: "", dealValue: "", notes: "" };

// Next-touch schedule (mirrors automationService.js FOLLOW_UP_SEQUENCES)
const SCHEDULE = [
  { label: "First message",   when: "~10 minutes"  },
  { label: "Second follow-up", when: "6 hours"     },
  { label: "Daily reminder",  when: "24 hours"     },
  { label: "Final reminder",  when: "3 days"       },
];

export default function AddClientForm({ onSuccess, whatsappConnected }) {
  const [open,    setOpen]    = useState(false);
  const [fields,  setFields]  = useState(EMPTY);
  const [loading, setLoading] = useState(false);
  const [saved,   setSaved]   = useState(null);   // null | { name, phone }
  const [error,   setError]   = useState("");

  const set = (k, v) => setFields(f => ({ ...f, [k]: v }));

  const handleSubmit = async () => {
    if (!fields.name.trim())  { setError("Client name is required."); return; }
    const cleanPhone = fields.phone.replace(/\D/g, "");
    if (!cleanPhone)          { setError("WhatsApp number is required."); return; }
    if (cleanPhone.length < 7) { setError("Enter a valid number with country code (e.g. 919876543210)."); return; }
    setError("");
    setLoading(true);

    try {
      const res = await createLead(fields);
      if (res.success === false) {
        setError(res.error || "Could not add client. Please try again.");
      } else if (res.duplicate) {
        setError("This number is already in your client list.");
      } else {
        setSaved({ name: fields.name.trim(), phone: fields.phone.trim() });
        setFields(EMPTY);
        onSuccess?.();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleKey = (e) => {
    if (e.key === "Enter" && e.target.tagName !== "TEXTAREA") handleSubmit();
  };

  // ── Success state ─────────────────────────────────────────────────
  if (saved) {
    return (
      <div className="acf-success">
        <div className="acf-success-top">
          <span className="acf-check">✓</span>
          <div>
            <p className="acf-success-title">{saved.name} added!</p>
            <p className="acf-success-sub">
              {whatsappConnected
                ? "JARVIS will send the first follow-up automatically."
                : "Connect WhatsApp below to activate follow-ups."}
            </p>
          </div>
        </div>

        {whatsappConnected && (
          <div className="acf-schedule">
            <p className="acf-sched-title">Scheduled follow-up sequence:</p>
            <div className="acf-sched-list">
              {SCHEDULE.map((s, i) => (
                <div key={i} className="acf-sched-row">
                  <span className="acf-sched-dot" />
                  <span className="acf-sched-label">{s.label}</span>
                  <span className="acf-sched-when">{s.when}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <button
          className="acf-add-another"
          onClick={() => { setSaved(null); setOpen(true); }}
        >
          + Add another client
        </button>
      </div>
    );
  }

  // ── Collapsed state ───────────────────────────────────────────────
  if (!open) {
    return (
      <button className="acf-toggle" onClick={() => setOpen(true)}>
        <span className="acf-toggle-icon">+</span>
        Add New Client
      </button>
    );
  }

  // ── Form ──────────────────────────────────────────────────────────
  return (
    <div className="acf-form">
      <div className="acf-form-header">
        <h3 className="acf-form-title">Add New Client</h3>
        <button className="acf-close" onClick={() => { setOpen(false); setError(""); }}>✕</button>
      </div>

      <div className="acf-fields">
        <div className="acf-field">
          <label className="acf-label">Name <span className="acf-req">*</span></label>
          <input
            className="acf-input"
            placeholder="e.g. Priya Sharma"
            value={fields.name}
            onChange={e => set("name", e.target.value)}
            onKeyDown={handleKey}
            autoFocus
          />
        </div>

        <div className="acf-field">
          <label className="acf-label">WhatsApp Number <span className="acf-req">*</span></label>
          <input
            className="acf-input"
            placeholder="e.g. 919876543210 (with country code)"
            value={fields.phone}
            onChange={e => set("phone", e.target.value)}
            onKeyDown={handleKey}
            inputMode="tel"
          />
        </div>

        <div className="acf-row-2">
          <div className="acf-field">
            <label className="acf-label">What they want</label>
            <input
              className="acf-input"
              placeholder="e.g. Logo design, SEO package…"
              value={fields.service}
              onChange={e => set("service", e.target.value)}
              onKeyDown={handleKey}
            />
          </div>

          <div className="acf-field">
            <label className="acf-label">Deal value (₹)</label>
            <input
              className="acf-input"
              placeholder="e.g. 5000"
              value={fields.dealValue}
              onChange={e => set("dealValue", e.target.value)}
              onKeyDown={handleKey}
              inputMode="numeric"
            />
          </div>
        </div>

        <div className="acf-field">
          <label className="acf-label">Notes</label>
          <textarea
            className="acf-input acf-textarea"
            placeholder="Any context about this lead…"
            value={fields.notes}
            onChange={e => set("notes", e.target.value)}
            rows={2}
          />
        </div>
      </div>

      {error && <p className="acf-error">{error}</p>}

      <div className="acf-actions">
        <button className="acf-submit" onClick={handleSubmit} disabled={loading}>
          {loading ? "Adding…" : "Add Client →"}
        </button>
        <button className="acf-cancel" onClick={() => { setOpen(false); setError(""); }}>
          Cancel
        </button>
      </div>
    </div>
  );
}
