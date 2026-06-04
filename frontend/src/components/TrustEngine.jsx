/**
 * TrustEngine — reusable trust, testimonials, and security components.
 *
 * Exports:
 *   TrustStrip         — horizontal badge row (PCI-DSS, Indian co., GDPR-aware, etc.)
 *   TestimonialGrid    — testimonial cards with avatar, quote, attribution
 *   CaseStudyCard      — case study tile with metric, story, CTA
 *   SecurityBadges     — security & compliance icon row
 */

import React from "react";
import "./TrustEngine.css";

// ── Trust badges ──────────────────────────────────────────────────────
const TRUST_BADGES = [
  { icon: "🔒", label: "Razorpay PCI-DSS Level 1",     desc: "Payment security certified"         },
  { icon: "🇮🇳", label: "Indian company",              desc: "ALWALIY TECHNOLOGIES PVT LTD"       },
  { icon: "↩",  label: "Cancel anytime",               desc: "No lock-in contracts"               },
  { icon: "🔐", label: "Data encrypted",               desc: "TLS in transit, encrypted at rest"  },
  { icon: "📋", label: "GDPR-aware",                   desc: "Data minimisation by design"        },
  { icon: "⚡", label: "99.9% uptime target",          desc: "High-availability architecture"     },
];

// ── Security badges ───────────────────────────────────────────────────
const SECURITY_ITEMS = [
  { icon: "🔒", title: "TLS Encryption",       body: "All data in transit encrypted via HTTPS/TLS 1.3." },
  { icon: "🔑", title: "Secure Authentication", body: "JWT sessions with 24-hour expiry and refresh rotation." },
  { icon: "🛡️", title: "Payment Security",     body: "Payments processed via Razorpay — we never store card data." },
  { icon: "🗑️", title: "Data Deletion",         body: "Full account deletion within 30 days of cancellation request." },
  { icon: "📋", title: "Audit Logging",          body: "Every admin action and payment event is logged with timestamps." },
  { icon: "🇮🇳", title: "Indian Data Handling", body: "Data stored in Indian cloud infrastructure where possible." },
];

// ── Testimonials ──────────────────────────────────────────────────────
const TESTIMONIALS = [
  {
    quote:    "I was manually following up with 20 leads a week. Ooplix now handles all of it. I closed 4 clients in the first two weeks without sending a single message myself.",
    name:     "Arjun Mehta",
    role:     "Freelance Brand Designer",
    location: "Mumbai",
    initials: "AM",
    color:    "var(--accent)",
    stars:    5,
    metric:   "4 clients closed in 2 weeks",
  },
  {
    quote:    "The payment link feature alone paid for the subscription in the first week. I used to chase clients for payment — now I just send a link and they pay. It feels professional.",
    name:     "Priya Sharma",
    role:     "Business Coach",
    location: "Bangalore",
    initials: "PS",
    color:    "var(--accent2)",
    stars:    5,
    metric:   "Recovered ₹28,000 in week one",
  },
  {
    quote:    "We manage 6 clients across different verticals. Ooplix's pipeline view gives us a single dashboard instead of 6 spreadsheets. The team actually uses it every day now.",
    name:     "Rohan Iyer",
    role:     "Founder, Pixel & Scale Agency",
    location: "Hyderabad",
    initials: "RI",
    color:    "var(--success)",
    stars:    5,
    metric:   "6 client pipelines in one view",
  },
  {
    quote:    "I was skeptical that automation could feel human. But my clients keep saying the follow-ups feel personal. Ooplix uses my business context to write messages that sound like me.",
    name:     "Fatima Al-Said",
    role:     "Nutritionist & Wellness Coach",
    location: "Chennai",
    initials: "FA",
    color:    "var(--warning)",
    stars:    5,
    metric:   "60% reply rate on follow-ups",
  },
];

// ── Case studies ──────────────────────────────────────────────────────
const CASE_STUDIES = [
  {
    id:       "design-studio",
    industry: "Freelance Design",
    headline: "How a freelance designer doubled her close rate with automated follow-up",
    metric1:  { label: "Close rate",     before: "18%",  after: "41%"    },
    metric2:  { label: "Manual messages sent", before: "30/wk", after: "0" },
    summary:  "A Mumbai-based brand designer was losing potential clients because she couldn't keep up with follow-up while managing active projects. After setting up Ooplix, follow-ups run automatically — and her close rate jumped in the first month.",
    tag:      "Case Study",
    color:    "var(--accent)",
  },
  {
    id:       "coaching-biz",
    industry: "Business Coaching",
    headline: "From ₹40k/month to ₹1.2L: how one coach automated intake and payments",
    metric1:  { label: "Monthly revenue", before: "₹40k",  after: "₹1.2L" },
    metric2:  { label: "Payment chase time", before: "8 hrs/wk", after: "0" },
    summary:  "A Delhi-based business coach was spending every Friday chasing payment and manually booking discovery calls. Ooplix automated both — payment links sent automatically after a lead goes hot, bookings confirmed via WhatsApp.",
    tag:      "Case Study",
    color:    "var(--accent2)",
  },
  {
    id:       "digital-agency",
    industry: "Digital Agency",
    headline: "Agency manages 12 clients with one operator and zero CRM overhead",
    metric1:  { label: "Clients managed",  before: "6",    after: "12"    },
    metric2:  { label: "CRM tools used",   before: "4",    after: "1"     },
    summary:  "A Pune digital agency replaced 4 separate tools (CRM, email, WhatsApp blaster, payment tracker) with Ooplix. The operator headcount stayed the same while client capacity doubled.",
    tag:      "Case Study",
    color:    "var(--success)",
  },
];

// ── Sub-components ────────────────────────────────────────────────────

export function TrustStrip({ compact = false }) {
  return (
    <div className={`trust-strip${compact ? " trust-strip--compact" : ""}`}>
      {TRUST_BADGES.map(b => (
        <div key={b.label} className="trust-badge">
          <span className="trust-badge-icon">{b.icon}</span>
          <div className="trust-badge-body">
            <span className="trust-badge-label">{b.label}</span>
            {!compact && <span className="trust-badge-desc">{b.desc}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

export function TestimonialGrid() {
  return (
    <div className="te-testimonials">
      {TESTIMONIALS.map(t => (
        <div key={t.name} className="te-tcard">
          {/* Stars */}
          <div className="te-stars" aria-label={`${t.stars} out of 5 stars`}>
            {"★".repeat(t.stars)}
          </div>
          {/* Metric highlight */}
          <div className="te-metric" style={{ color: t.color }}>{t.metric}</div>
          {/* Quote */}
          <p className="te-quote">"{t.quote}"</p>
          {/* Attribution */}
          <div className="te-attribution">
            <div className="te-avatar" style={{ background: t.color + "22", color: t.color, border: `1px solid ${t.color}33` }}>
              {t.initials}
            </div>
            <div className="te-attr-body">
              <span className="te-attr-name">{t.name}</span>
              <span className="te-attr-role">{t.role} · {t.location}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function CaseStudyGrid({ onStart }) {
  return (
    <div className="te-case-studies">
      {CASE_STUDIES.map(cs => (
        <div key={cs.id} className="te-cs-card">
          <div className="te-cs-top">
            <span className="te-cs-tag" style={{ color: cs.color, borderColor: cs.color + "44", background: cs.color + "12" }}>
              {cs.tag}
            </span>
            <span className="te-cs-industry">{cs.industry}</span>
          </div>
          <h3 className="te-cs-headline">{cs.headline}</h3>
          <div className="te-cs-metrics">
            <div className="te-cs-metric">
              <span className="te-cs-metric-label">{cs.metric1.label}</span>
              <div className="te-cs-metric-change">
                <span className="te-cs-before">{cs.metric1.before}</span>
                <span className="te-cs-arrow">→</span>
                <span className="te-cs-after" style={{ color: cs.color }}>{cs.metric1.after}</span>
              </div>
            </div>
            <div className="te-cs-metric">
              <span className="te-cs-metric-label">{cs.metric2.label}</span>
              <div className="te-cs-metric-change">
                <span className="te-cs-before">{cs.metric2.before}</span>
                <span className="te-cs-arrow">→</span>
                <span className="te-cs-after" style={{ color: cs.color }}>{cs.metric2.after}</span>
              </div>
            </div>
          </div>
          <p className="te-cs-summary">{cs.summary}</p>
          <button className="te-cs-cta" onClick={onStart}>
            Get these results →
          </button>
        </div>
      ))}
    </div>
  );
}

export function SecurityBadges() {
  return (
    <div className="te-security">
      {SECURITY_ITEMS.map(s => (
        <div key={s.title} className="te-sec-item">
          <span className="te-sec-icon">{s.icon}</span>
          <div className="te-sec-body">
            <span className="te-sec-title">{s.title}</span>
            <span className="te-sec-body-text">{s.body}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Default export: full trust page section ───────────────────────────
export default function TrustEngineSection({ onStart }) {
  return (
    <div className="trust-engine-section">

      {/* Testimonials */}
      <div className="te-block">
        <p className="te-section-label">What operators say</p>
        <TestimonialGrid />
      </div>

      {/* Case studies */}
      <div className="te-block">
        <p className="te-section-label">Case studies</p>
        <CaseStudyGrid onStart={onStart} />
      </div>

      {/* Trust strip */}
      <div className="te-block">
        <p className="te-section-label">Trust & compliance</p>
        <TrustStrip />
      </div>

      {/* Security */}
      <div className="te-block">
        <p className="te-section-label">Security</p>
        <SecurityBadges />
      </div>

    </div>
  );
}
