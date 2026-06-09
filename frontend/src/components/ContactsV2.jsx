import React, { useState, useEffect, useCallback, useMemo } from "react";
import { getLeads, createLead, generatePaymentLink, sendFollowUp } from "../api";
import "./ContactsV2.css";

// ── Helpers ────────────────────────────────────────────────────────────────────

function _initials(name) {
  if (!name) return "?";
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase();
}

const AVATAR_COLORS = [
  "#7c6fff", "#4ecdc4", "#f0b429", "#52d68a", "#f55b5b",
  "#5dc8f5", "#ff8c69", "#b794f4", "#68d391", "#fc8181",
];

function _avatarColor(name) {
  if (!name) return AVATAR_COLORS[0];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

function _timeAgo(ts) {
  if (!ts) return "never";
  const ms   = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function _fmtINR(v) {
  if (!v) return "";
  const n = Number(String(v).replace(/[^\d.]/g, ""));
  if (!n) return "";
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000)   return `₹${(n / 1000).toFixed(0)}k`;
  return `₹${n}`;
}

const STATUS_META = {
  new:       { label: "New",       cls: "chip--new"  },
  hot:       { label: "Hot",       cls: "chip--hot"  },
  qualified: { label: "Qualified", cls: "chip--qual" },
  won:       { label: "Won",       cls: "chip--won"  },
  paid:      { label: "Paid",      cls: "chip--paid" },
  lost:      { label: "Lost",      cls: "chip--lost" },
  onboarded: { label: "Onboarded", cls: "chip--won"  },
};

const ALL_STATUSES = ["all", "new", "hot", "qualified", "won", "paid", "lost"];

const WA_TEMPLATES = [
  { id: "checkin",  label: "Check-in (casual)",    text: (name) => `Hi ${name}! Just checking in — did you get a chance to look at our proposal? Happy to answer any questions. 😊` },
  { id: "payment",  label: "Payment reminder",     text: (name) => `Hi ${name}, this is a gentle reminder about the payment. Please let me know if you need any assistance. Thank you!` },
  { id: "proposal", label: "Proposal follow-up",   text: (name) => `Hi ${name}! I wanted to follow up on the proposal I sent. Would love to get your thoughts and move forward. 🙏` },
];

// ── Toast ──────────────────────────────────────────────────────────────────────

function Toast({ toasts }) {
  if (!toasts.length) return null;
  return (
    <div className="cv2-toast-container" aria-live="polite">
      {toasts.map(t => (
        <div key={t.id} className={`cv2-toast cv2-toast--${t.type}`}>{t.msg}</div>
      ))}
    </div>
  );
}

// ── Add Contact Modal ──────────────────────────────────────────────────────────

const EMPTY_FORM = { name: "", phone: "", service: "", dealValue: "", notes: "" };

function AddContactModal({ onClose, onSaved }) {
  const [fields,  setFields]  = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const [err,     setErr]     = useState("");

  const set = (k, v) => setFields(f => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!fields.name.trim())  { setErr("Name is required."); return; }
    const phone = fields.phone.replace(/\D/g, "");
    if (!phone || phone.length < 7) { setErr("Enter a valid phone with country code (e.g. 919876543210)."); return; }
    setErr(""); setLoading(true);
    try {
      const res = await createLead({ ...fields, phone });
      if (res?.success === false) {
        setErr(res.error || "Could not add contact. Try again.");
      } else if (res?.duplicate) {
        setErr("This number already exists in your contacts.");
      } else {
        localStorage.setItem("jarvis_has_leads", "1");
        onSaved(res?.lead || { ...fields, phone, status: "new", createdAt: new Date().toISOString() });
        onClose();
      }
    } catch (e) { setErr(e.message); }
    finally     { setLoading(false); }
  };

  return (
    <div className="cv2-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="cv2-modal" role="dialog" aria-modal="true" aria-label="New Contact">
        <div className="cv2-modal-header">
          <h2 className="cv2-modal-title">New Contact</h2>
          <button className="cv2-modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="cv2-modal-body">
          <label className="cv2-label">Full Name <span className="cv2-req">*</span></label>
          <input className="cv2-input" placeholder="e.g. Priya Sharma" value={fields.name}
            onChange={e => set("name", e.target.value)} autoFocus />

          <label className="cv2-label">Phone (with country code) <span className="cv2-req">*</span></label>
          <input className="cv2-input" placeholder="919876543210" value={fields.phone}
            onChange={e => set("phone", e.target.value)} inputMode="tel" />

          <div className="cv2-row-2">
            <div>
              <label className="cv2-label">Service / Product</label>
              <input className="cv2-input" placeholder="e.g. Website redesign" value={fields.service}
                onChange={e => set("service", e.target.value)} />
            </div>
            <div>
              <label className="cv2-label">Deal Value (₹)</label>
              <input className="cv2-input" placeholder="15000" value={fields.dealValue}
                onChange={e => set("dealValue", e.target.value)} inputMode="numeric" />
            </div>
          </div>

          <label className="cv2-label">Notes</label>
          <textarea className="cv2-input cv2-textarea" placeholder="Any context about this lead…"
            value={fields.notes} onChange={e => set("notes", e.target.value)} rows={2} />

          {err && <p className="cv2-err">{err}</p>}
        </div>

        <div className="cv2-modal-footer">
          <button className="cv2-btn cv2-btn--ghost" onClick={onClose}>Cancel</button>
          <button className="cv2-btn cv2-btn--primary" onClick={submit} disabled={loading}>
            {loading ? "Adding…" : "Add Contact →"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Payment Link Modal ─────────────────────────────────────────────────────────

function PaymentLinkModal({ prefill, onClose }) {
  const [form,    setForm]    = useState({
    name: prefill?.name || "", phone: prefill?.phone || "",
    amount: "", description: "",
  });
  const [loading, setLoading] = useState(false);
  const [result,  setResult]  = useState(null);
  const [err,     setErr]     = useState("");
  const [copied,  setCopied]  = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const generate = async () => {
    if (!form.amount || isNaN(Number(form.amount))) { setErr("Enter a valid amount."); return; }
    setErr(""); setLoading(true); setResult(null);
    try {
      const res = await generatePaymentLink(form);
      if (res?.success && res?.link) {
        setResult(res.link);
      } else {
        const rawErr = res?.error || "";
        setErr(/razorpay|key|not configured/i.test(rawErr)
          ? "Payments not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to your server .env."
          : rawErr || "Could not generate link. Try again.");
      }
    } catch (e) { setErr(e.message); }
    finally     { setLoading(false); }
  };

  const copy = () => {
    if (!result) return;
    navigator.clipboard.writeText(result);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const waUrl = result && form.phone
    ? `https://wa.me/${form.phone.replace(/\D/g, "")}?text=${encodeURIComponent(`Hi ${form.name || "there"}! Here's your payment link: ${result}`)}`
    : null;

  return (
    <div className="cv2-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="cv2-modal" role="dialog" aria-modal="true" aria-label="Generate Payment Link">
        <div className="cv2-modal-header">
          <h2 className="cv2-modal-title">Generate Payment Link</h2>
          <button className="cv2-modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="cv2-modal-body">
          <label className="cv2-label">Customer Name</label>
          <input className="cv2-input" placeholder="Raj Kumar" value={form.name}
            onChange={e => set("name", e.target.value)} />

          <label className="cv2-label">Phone</label>
          <input className="cv2-input" placeholder="+91-9876543210" value={form.phone}
            onChange={e => set("phone", e.target.value)} inputMode="tel" />

          <label className="cv2-label">Amount (₹) <span className="cv2-req">*</span></label>
          <input className="cv2-input" placeholder="15000" value={form.amount}
            onChange={e => set("amount", e.target.value)} inputMode="numeric" autoFocus={!prefill} />

          <label className="cv2-label">Description</label>
          <input className="cv2-input" placeholder="Website redesign — 50% advance" value={form.description}
            onChange={e => set("description", e.target.value)} />

          {err && <p className="cv2-err">{err}</p>}

          {result && (
            <div className="cv2-pay-result">
              <div className="cv2-pay-result-top">
                <span className="cv2-pay-check">✓</span>
                <span className="cv2-pay-result-label">Payment link created</span>
              </div>
              <div className="cv2-pay-link-row">
                <span className="cv2-pay-link-url">{result}</span>
                <button className="cv2-btn cv2-btn--sm cv2-btn--ghost" onClick={copy}>
                  {copied ? "✓ Copied" : "Copy"}
                </button>
              </div>
              {waUrl && (
                <a href={waUrl} target="_blank" rel="noreferrer" className="cv2-btn cv2-btn--wa">
                  Share on WhatsApp ↗
                </a>
              )}
            </div>
          )}
        </div>

        <div className="cv2-modal-footer">
          {!result
            ? <><button className="cv2-btn cv2-btn--ghost" onClick={onClose}>Cancel</button>
                <button className="cv2-btn cv2-btn--primary" onClick={generate} disabled={loading}>
                  {loading ? "Generating…" : "Generate Link →"}
                </button></>
            : <button className="cv2-btn cv2-btn--ghost" onClick={onClose}>Done</button>
          }
        </div>
      </div>
    </div>
  );
}

// ── Contact Drawer ─────────────────────────────────────────────────────────────

const STATUS_OPTIONS = ["new", "hot", "qualified", "won", "paid", "lost"];

function ContactDrawer({ contact, onClose, onPayLink, onStatusUpdate }) {
  const [sending,   setSending]   = useState(false);
  const [waMsg,     setWaMsg]     = useState("");
  const [waResult,  setWaResult]  = useState(null);
  const [waTemplate, setWaTemplate] = useState("");

  const color = _avatarColor(contact.name);
  const chip  = STATUS_META[contact.status] || STATUS_META.new;
  const waUrl = `https://wa.me/${(contact.phone || "").replace(/\D/g, "")}?text=${encodeURIComponent(`Hi ${contact.name}!`)}`;

  const handleTemplateChange = (id) => {
    setWaTemplate(id);
    const tmpl = WA_TEMPLATES.find(t => t.id === id);
    if (tmpl) setWaMsg(tmpl.text(contact.name || "there"));
    else      setWaMsg("");
  };

  const sendWa = async () => {
    if (!waMsg.trim()) return;
    setSending(true); setWaResult(null);
    try {
      const res = await sendFollowUp(contact.phone, waMsg);
      setWaResult(res?.success ? "success" : "error");
    } catch { setWaResult("error"); }
    finally { setSending(false); }
  };

  return (
    <div className="cv2-drawer-overlay" onClick={e => e.target.classList.contains("cv2-drawer-overlay") && onClose()}>
      <aside className="cv2-drawer" role="complementary" aria-label="Contact details">
        <div className="cv2-drawer-header">
          <button className="cv2-drawer-back" onClick={onClose} aria-label="Close drawer">← Back</button>
          <button className="cv2-drawer-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* Avatar + Identity */}
        <div className="cv2-drawer-identity">
          <div className="cv2-avatar cv2-avatar--lg" style={{ background: color }}>
            {_initials(contact.name)}
          </div>
          <div>
            <h2 className="cv2-drawer-name">{contact.name}</h2>
            <p className="cv2-drawer-phone">{contact.phone || "—"}</p>
            <span className={`cv2-chip ${chip.cls}`}>{chip.label}</span>
          </div>
        </div>

        {/* Details */}
        <section className="cv2-drawer-section">
          <h3 className="cv2-drawer-section-title">Details</h3>
          <div className="cv2-drawer-detail-grid">
            {contact.service    && <><span className="cv2-detail-key">Service</span>   <span className="cv2-detail-val">{contact.service}</span></>}
            {contact.dealValue  && <><span className="cv2-detail-key">Deal value</span><span className="cv2-detail-val">{_fmtINR(contact.dealValue)}</span></>}
            {contact.createdAt  && <><span className="cv2-detail-key">Added</span>     <span className="cv2-detail-val">{_timeAgo(contact.createdAt)}</span></>}
            {contact.notes      && <><span className="cv2-detail-key">Notes</span>     <span className="cv2-detail-val cv2-detail-val--notes">{contact.notes}</span></>}
          </div>
        </section>

        {/* Status update */}
        <section className="cv2-drawer-section">
          <h3 className="cv2-drawer-section-title">Update Status</h3>
          <div className="cv2-status-options">
            {STATUS_OPTIONS.map(s => {
              const m = STATUS_META[s] || STATUS_META.new;
              return (
                <button
                  key={s}
                  className={`cv2-status-opt ${m.cls}${contact.status === s ? " cv2-status-opt--active" : ""}`}
                  onClick={() => onStatusUpdate?.(contact, s)}
                >
                  {m.label}
                </button>
              );
            })}
          </div>
        </section>

        {/* Actions */}
        <section className="cv2-drawer-section">
          <h3 className="cv2-drawer-section-title">Actions</h3>
          <div className="cv2-drawer-actions">
            <a href={waUrl} target="_blank" rel="noreferrer" className="cv2-btn cv2-btn--secondary cv2-btn--block">
              Open WhatsApp ↗
            </a>
            <button className="cv2-btn cv2-btn--primary cv2-btn--block" onClick={() => onPayLink(contact)}>
              Generate Payment Link
            </button>
          </div>
        </section>

        {/* Send follow-up */}
        <section className="cv2-drawer-section">
          <h3 className="cv2-drawer-section-title">Send Follow-up</h3>
          <select className="cv2-input cv2-select" value={waTemplate} onChange={e => handleTemplateChange(e.target.value)}>
            <option value="">— choose template or type below —</option>
            {WA_TEMPLATES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          <textarea
            className="cv2-input cv2-textarea"
            placeholder="Type a message…"
            value={waMsg}
            onChange={e => setWaMsg(e.target.value)}
            rows={3}
            style={{ marginTop: 8 }}
          />
          {waResult === "success" && <p className="cv2-ok-msg">Message sent.</p>}
          {waResult === "error"   && <p className="cv2-err">Failed to send. Check WhatsApp connection.</p>}
          <button
            className="cv2-btn cv2-btn--secondary"
            onClick={sendWa}
            disabled={sending || !waMsg.trim()}
            style={{ marginTop: 8 }}
          >
            {sending ? "Sending…" : "Send via WhatsApp"}
          </button>
        </section>
      </aside>
    </div>
  );
}

// ── Contact Row ────────────────────────────────────────────────────────────────

function ContactRow({ contact, onView, onPayLink }) {
  const color = _avatarColor(contact.name);
  const chip  = STATUS_META[contact.status] || STATUS_META.new;
  const waUrl = `https://wa.me/${(contact.phone || "").replace(/\D/g, "")}?text=${encodeURIComponent(`Hi ${contact.name}!`)}`;

  return (
    <div className="cv2-row">
      <div className="cv2-row-avatar" style={{ background: color }} aria-hidden="true">
        {_initials(contact.name)}
      </div>

      <div className="cv2-row-body">
        <div className="cv2-row-top">
          <span className="cv2-row-name">{contact.name || "—"}</span>
          <span className={`cv2-chip ${chip.cls}`}>{chip.label}</span>
        </div>
        <div className="cv2-row-meta">
          <span className="cv2-row-phone">{contact.phone || "—"}</span>
          {contact.service   && <span className="cv2-row-dot">·</span>}
          {contact.service   && <span className="cv2-row-service">{contact.service}</span>}
          {contact.dealValue && <span className="cv2-row-dot">·</span>}
          {contact.dealValue && <span className="cv2-row-value">{_fmtINR(contact.dealValue)}</span>}
        </div>
        {contact.notes && (
          <p className="cv2-row-notes">{contact.notes.slice(0, 80)}{contact.notes.length > 80 ? "…" : ""}</p>
        )}
      </div>

      <div className="cv2-row-actions">
        <a href={waUrl} target="_blank" rel="noreferrer" className="cv2-row-btn cv2-row-btn--wa" title="Open WhatsApp">
          WhatsApp ↗
        </a>
        <button className="cv2-row-btn" onClick={() => onPayLink(contact)} title="Generate payment link">
          ₹ Link
        </button>
        <button className="cv2-row-btn cv2-row-btn--view" onClick={() => onView(contact)} title="View contact">
          View →
        </button>
      </div>
    </div>
  );
}

// ── Root Contacts V2 ───────────────────────────────────────────────────────────

export default function ContactsV2({ onNavigate }) {
  const [leads,      setLeads]      = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [search,     setSearch]     = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showAdd,    setShowAdd]    = useState(false);
  const [payTarget,  setPayTarget]  = useState(null);
  const [drawer,     setDrawer]     = useState(null);
  const [toasts,     setToasts]     = useState([]);

  const toast = (type, msg) => {
    const id = Date.now();
    setToasts(t => [...t, { id, type, msg }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500);
  };

  const loadLeads = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getLeads();
      setLeads(Array.isArray(data) ? data.slice().reverse() : []);
    } catch { setLeads([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadLeads(); }, [loadLeads]);

  const filtered = useMemo(() => {
    if (!leads) return [];
    return leads.filter(l => {
      const matchStatus = statusFilter === "all" || l.status === statusFilter;
      const q = search.toLowerCase();
      const matchSearch = !q
        || (l.name   || "").toLowerCase().includes(q)
        || (l.phone  || "").includes(q)
        || (l.service|| "").toLowerCase().includes(q);
      return matchStatus && matchSearch;
    });
  }, [leads, search, statusFilter]);

  const handleSaved = (lead) => {
    setLeads(prev => [lead, ...(prev || [])]);
    toast("success", `${lead.name || "Contact"} added successfully.`);
  };

  const handleStatusUpdate = async (contact, newStatus) => {
    setLeads(prev => prev?.map(l =>
      l.phone === contact.phone ? { ...l, status: newStatus } : l
    ));
    if (drawer?.phone === contact.phone) setDrawer(d => ({ ...d, status: newStatus }));
    toast("success", `Status updated to "${STATUS_META[newStatus]?.label || newStatus}"`);
  };

  const statusCounts = useMemo(() => {
    if (!leads) return {};
    return leads.reduce((acc, l) => ({ ...acc, [l.status]: (acc[l.status] || 0) + 1 }), {});
  }, [leads]);

  return (
    <div className="cv2-root page-enter">
      <Toast toasts={toasts} />

      {/* Header */}
      <div className="cv2-header">
        <div className="cv2-header-left">
          <h1 className="cv2-page-title">Contacts</h1>
          <p className="cv2-page-sub">
            {leads !== null
              ? `${leads.length} lead${leads.length !== 1 ? "s" : ""}${leads.length > 0 ? " · " + filtered.length + " shown" : ""}`
              : "Loading…"}
          </p>
        </div>
        <div className="cv2-header-right">
          <button className="cv2-btn cv2-btn--primary" onClick={() => setShowAdd(true)}>
            + New
          </button>
        </div>
      </div>

      {/* Search + Filter */}
      <div className="cv2-toolbar">
        <div className="cv2-search-wrap">
          <span className="cv2-search-icon" aria-hidden="true">⌕</span>
          <input
            className="cv2-search"
            placeholder="Search by name, phone, service…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button className="cv2-search-clear" onClick={() => setSearch("")} aria-label="Clear search">✕</button>
          )}
        </div>
        <div className="cv2-status-filters">
          {ALL_STATUSES.map(s => {
            const count = s === "all" ? leads?.length : (statusCounts[s] || 0);
            const meta  = STATUS_META[s];
            return (
              <button
                key={s}
                className={`cv2-filter-btn${statusFilter === s ? " cv2-filter-btn--active" : ""}`}
                onClick={() => setStatusFilter(s)}
              >
                {meta ? meta.label : "All"}
                {count > 0 && <span className="cv2-filter-count">{count}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Contact List */}
      <div className="cv2-list">
        {loading ? (
          [0, 1, 2, 3].map(i => (
            <div key={i} className="cv2-row cv2-row--skeleton">
              <div className="cv2-skeleton cv2-skeleton--avatar" />
              <div className="cv2-skeleton-body">
                <div className="cv2-skeleton cv2-skeleton--name" />
                <div className="cv2-skeleton cv2-skeleton--meta" />
              </div>
            </div>
          ))
        ) : filtered.length === 0 ? (
          <div className="cv2-empty">
            <div className="cv2-empty-icon">◈</div>
            <p className="cv2-empty-title">
              {leads?.length === 0 ? "No contacts yet" : "No contacts match your search"}
            </p>
            <p className="cv2-empty-sub">
              {leads?.length === 0
                ? "Add your first lead to start tracking deals and sending follow-ups."
                : "Try a different search term or status filter."}
            </p>
            {leads?.length === 0 && (
              <button className="cv2-btn cv2-btn--primary" onClick={() => setShowAdd(true)}>
                + Add First Contact
              </button>
            )}
            {leads?.length > 0 && (
              <button className="cv2-btn cv2-btn--ghost" onClick={() => { setSearch(""); setStatusFilter("all"); }}>
                Clear filters
              </button>
            )}
          </div>
        ) : (
          filtered.map((c, i) => (
            <ContactRow
              key={c.phone || i}
              contact={c}
              onView={setDrawer}
              onPayLink={setPayTarget}
            />
          ))
        )}
      </div>

      {/* Modals */}
      {showAdd && (
        <AddContactModal
          onClose={() => setShowAdd(false)}
          onSaved={handleSaved}
        />
      )}
      {payTarget && (
        <PaymentLinkModal
          prefill={payTarget}
          onClose={() => setPayTarget(null)}
        />
      )}
      {drawer && (
        <ContactDrawer
          contact={drawer}
          onClose={() => setDrawer(null)}
          onPayLink={(c) => { setDrawer(null); setPayTarget(c); }}
          onStatusUpdate={handleStatusUpdate}
        />
      )}
    </div>
  );
}
