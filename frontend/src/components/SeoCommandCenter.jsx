import React, { useState, useEffect, useCallback } from "react";
import { track } from "../analytics";
import "./SeoCommandCenter.css";

// ── Static SEO configuration ─────────────────────────────────────────
// These are the pages we own and actively manage.
// Update this list as new content is published.

const INDEXED_PAGES = [
  { url: "https://ooplix.com/",           title: "AI Operating System for Your Business",  priority: 1.0, status: "indexed",    lastmod: "2026-06-04", type: "landing"  },
  { url: "https://ooplix.com/#pricing",   title: "Pricing — Starter, Growth, Scale",        priority: 0.8, status: "indexed",    lastmod: "2026-06-04", type: "pricing"  },
  { url: "https://ooplix.com/#privacy",   title: "Privacy Policy",                          priority: 0.4, status: "indexed",    lastmod: "2026-06-01", type: "legal"    },
  { url: "https://ooplix.com/#terms",     title: "Terms of Service",                        priority: 0.4, status: "indexed",    lastmod: "2026-06-01", type: "legal"    },
  { url: "https://ooplix.com/#refund",    title: "Refund Policy",                           priority: 0.3, status: "indexed",    lastmod: "2026-06-01", type: "legal"    },
  { url: "https://ooplix.com/#contact",   title: "Contact Us",                              priority: 0.5, status: "indexed",    lastmod: "2026-06-01", type: "contact"  },
  { url: "https://ooplix.com/#company",   title: "Company — ALWALIY TECHNOLOGIES",          priority: 0.4, status: "indexed",    lastmod: "2026-06-01", type: "legal"    },
  { url: "https://ooplix.com/#trust",     title: "Trust & Security",                        priority: 0.4, status: "indexed",    lastmod: "2026-06-01", type: "legal"    },
];

// ── SEO readiness checks ─────────────────────────────────────────────
const SEO_CHECKS = [
  { id: "title",         label: "Title tag",               status: "pass",    note: "62 chars — within 60-70 char sweet spot"              },
  { id: "description",   label: "Meta description",        status: "pass",    note: "157 chars — within 150-160 char limit"                },
  { id: "og",            label: "Open Graph tags",         status: "pass",    note: "og:title, og:description, og:image, og:url all set"   },
  { id: "twitter",       label: "Twitter Card",            status: "pass",    note: "summary_large_image with image and alt text"          },
  { id: "canonical",     label: "Canonical URL",           status: "pass",    note: "https://ooplix.com/ set correctly"                    },
  { id: "schema",        label: "Structured data",         status: "pass",    note: "Organization + SoftwareApplication + WebSite"        },
  { id: "sitemap",       label: "Sitemap",                 status: "pass",    note: "/sitemap.xml — 8 URLs submitted"                      },
  { id: "robots",        label: "Robots.txt",              status: "pass",    note: "/robots.txt — Sitemap directive included"             },
  { id: "https",         label: "HTTPS",                   status: "pass",    note: "SSL required at deployment — enforce at nginx layer"  },
  { id: "mobile",        label: "Mobile viewport",         status: "pass",    note: "viewport meta tag set, responsive CSS"                },
  { id: "speedhint",     label: "Core Web Vitals",         status: "warn",    note: "SPA — consider prerender or SSG for first-load LCP"   },
  { id: "analytics",     label: "GA4 tracking",            status: "pass",    note: "GA4 + GTM wired, send_page_view=false (manual)"       },
  { id: "clarity",       label: "Clarity heatmaps",        status: "pass",    note: "Microsoft Clarity tag installed"                      },
  { id: "blog",          label: "Blog / content pages",    status: "missing", note: "No blog yet — highest organic traffic opportunity"    },
  { id: "backlinks",     label: "Backlink profile",        status: "missing", note: "No external backlinks tracked yet"                    },
  { id: "gsc",           label: "Google Search Console",   status: "action",  note: "Verify ooplix.com at search.google.com/search-console" },
];

// ── Content opportunities ────────────────────────────────────────────
const CONTENT_OPPORTUNITIES = [
  {
    keyword:  "whatsapp follow up automation",
    volume:   "4,400/mo",
    difficulty: "Medium",
    intent:   "Commercial",
    type:     "Blog post",
    angle:    "How Ooplix automates WhatsApp follow-up sequences — step-by-step",
    priority: "high",
  },
  {
    keyword:  "ai crm for freelancers india",
    volume:   "1,900/mo",
    difficulty: "Low",
    intent:   "Commercial",
    type:     "Landing page",
    angle:    "Ooplix for freelancers: AI CRM that sends follow-ups automatically",
    priority: "high",
  },
  {
    keyword:  "razorpay payment link automation",
    volume:   "2,200/mo",
    difficulty: "Low",
    intent:   "Informational",
    type:     "Blog post",
    angle:    "How to automate payment collection using Razorpay + WhatsApp",
    priority: "high",
  },
  {
    keyword:  "business automation tool india",
    volume:   "6,600/mo",
    difficulty: "High",
    intent:   "Commercial",
    type:     "Landing page",
    angle:    "Ooplix: The business automation OS for Indian operators",
    priority: "medium",
  },
  {
    keyword:  "whatsapp crm small business",
    volume:   "3,100/mo",
    difficulty: "Medium",
    intent:   "Commercial",
    type:     "Blog post",
    angle:    "5 ways a WhatsApp CRM pays for itself in the first month",
    priority: "medium",
  },
  {
    keyword:  "lead follow up software",
    volume:   "8,100/mo",
    difficulty: "High",
    intent:   "Commercial",
    type:     "Comparison",
    angle:    "Ooplix vs manual follow-up: why automation wins every time",
    priority: "medium",
  },
  {
    keyword:  "saas for coaches india",
    volume:   "1,200/mo",
    difficulty: "Low",
    intent:   "Commercial",
    type:     "Landing page",
    angle:    "Ooplix for coaches: automate intake, follow-up, and payments",
    priority: "low",
  },
  {
    keyword:  "autonomous ai for business",
    volume:   "2,900/mo",
    difficulty: "Medium",
    intent:   "Informational",
    type:     "Blog post",
    angle:    "What an AI Operating System actually does for your business",
    priority: "low",
  },
];

// ── Score calculation ────────────────────────────────────────────────
function _calcScore(checks) {
  const pass    = checks.filter(c => c.status === "pass").length;
  const warn    = checks.filter(c => c.status === "warn").length;
  const missing = checks.filter(c => c.status === "missing" || c.status === "action").length;
  const total   = checks.length;
  return Math.round(((pass + warn * 0.5) / total) * 100);
}

// ── Sub-components ────────────────────────────────────────────────────
function ScoreRing({ score }) {
  const r    = 34;
  const circ = 2 * Math.PI * r;
  const fill = (score / 100) * circ;
  const color = score >= 80 ? "var(--success)"
              : score >= 60 ? "var(--warning)"
              : "var(--danger)";
  const grade = score >= 80 ? "Good" : score >= 60 ? "Needs work" : "Critical";
  return (
    <div className="seo-score-ring">
      <svg width={84} height={84} viewBox="0 0 84 84">
        <circle cx={42} cy={42} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={6}/>
        <circle cx={42} cy={42} r={r} fill="none" stroke={color} strokeWidth={6}
          strokeDasharray={`${fill} ${circ}`} strokeLinecap="round"
          transform="rotate(-90 42 42)"
          style={{ transition: "stroke-dasharray 800ms var(--ease-out)" }}
        />
        <text x="50%" y="44%" dominantBaseline="middle" textAnchor="middle"
          fill={color} fontSize="18" fontWeight="800" fontFamily="inherit">
          {score}
        </text>
        <text x="50%" y="62%" dominantBaseline="middle" textAnchor="middle"
          fill="rgba(255,255,255,0.35)" fontSize="9" fontFamily="inherit">
          /100
        </text>
      </svg>
      <span className="seo-score-grade" style={{ color }}>{grade}</span>
    </div>
  );
}

function CheckRow({ check }) {
  const icon  = check.status === "pass"    ? "✓"
              : check.status === "warn"    ? "⚠"
              : check.status === "action"  ? "→"
              : "✗";
  const cls   = check.status === "pass"    ? "seo-check--pass"
              : check.status === "warn"    ? "seo-check--warn"
              : check.status === "action"  ? "seo-check--action"
              : "seo-check--fail";
  return (
    <div className={`seo-check-row ${cls}`}>
      <span className="seo-check-icon">{icon}</span>
      <div className="seo-check-body">
        <span className="seo-check-label">{check.label}</span>
        <span className="seo-check-note">{check.note}</span>
      </div>
    </div>
  );
}

function OpportunityRow({ op, onDraft }) {
  return (
    <div className={`seo-op-row seo-op-row--${op.priority}`}>
      <div className="seo-op-left">
        <span className={`seo-op-priority seo-op-priority--${op.priority}`}>{op.priority}</span>
        <div className="seo-op-body">
          <span className="seo-op-keyword">{op.keyword}</span>
          <span className="seo-op-angle">{op.angle}</span>
        </div>
      </div>
      <div className="seo-op-right">
        <div className="seo-op-meta">
          <span className="seo-op-chip">{op.volume}</span>
          <span className="seo-op-chip seo-op-chip--type">{op.type}</span>
          <span className={`seo-op-chip seo-op-chip--diff seo-op-diff--${op.difficulty.toLowerCase()}`}>
            {op.difficulty}
          </span>
        </div>
        <button className="seo-op-draft" onClick={() => onDraft(op)}>
          Draft →
        </button>
      </div>
    </div>
  );
}

// ── Root ─────────────────────────────────────────────────────────────
export default function SeoCommandCenter({ onNavigate }) {
  const [section, setSection] = useState("overview");
  const score = _calcScore(SEO_CHECKS);
  const passCount    = SEO_CHECKS.filter(c => c.status === "pass").length;
  const warnCount    = SEO_CHECKS.filter(c => c.status === "warn").length;
  const missingCount = SEO_CHECKS.filter(c => c.status === "missing" || c.status === "action").length;

  useEffect(() => { track.event("seo_dashboard_viewed"); }, []);

  const handleDraft = useCallback((op) => {
    track.event("seo_content_draft_started", { keyword: op.keyword, type: op.type });
    onNavigate?.("content");
  }, [onNavigate]);

  return (
    <div className="seo-center page-enter">

      {/* Header */}
      <div className="seo-header">
        <div>
          <h1 className="seo-title">SEO Command Center</h1>
          <p className="seo-subtitle">Search readiness, content opportunities, and indexing status.</p>
        </div>
        <a
          href="https://search.google.com/search-console"
          target="_blank" rel="noopener noreferrer"
          className="seo-gsc-btn"
          onClick={() => track.event("seo_gsc_opened")}
        >
          Open Search Console ↗
        </a>
      </div>

      {/* Score strip */}
      <div className="seo-score-strip">
        <ScoreRing score={score} />
        <div className="seo-score-meta">
          <div className="seo-score-stat seo-score-stat--pass">
            <span className="seo-score-num">{passCount}</span>
            <span className="seo-score-lbl">Passing</span>
          </div>
          <div className="seo-score-stat seo-score-stat--warn">
            <span className="seo-score-num">{warnCount}</span>
            <span className="seo-score-lbl">Warnings</span>
          </div>
          <div className="seo-score-stat seo-score-stat--fail">
            <span className="seo-score-num">{missingCount}</span>
            <span className="seo-score-lbl">Actions needed</span>
          </div>
          <div className="seo-score-stat">
            <span className="seo-score-num">{INDEXED_PAGES.length}</span>
            <span className="seo-score-lbl">Indexed pages</span>
          </div>
        </div>
        <div className="seo-score-actions">
          <div className="seo-sitemap-status">
            <span className="seo-sitemap-dot" />
            <span className="seo-sitemap-text">sitemap.xml — 8 URLs</span>
          </div>
          <div className="seo-sitemap-status">
            <span className="seo-sitemap-dot seo-sitemap-dot--warn" />
            <span className="seo-sitemap-text">Search Console — not verified</span>
          </div>
        </div>
      </div>

      {/* Section tabs */}
      <div className="seo-tabs">
        {[
          { id: "overview",       label: "Readiness Checks" },
          { id: "pages",          label: "Indexed Pages"    },
          { id: "opportunities",  label: "Content Opportunities" },
        ].map(t => (
          <button
            key={t.id}
            className={`seo-tab${section === t.id ? " seo-tab--active" : ""}`}
            onClick={() => setSection(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="seo-content" key={section}>

        {/* Readiness checks */}
        {section === "overview" && (
          <div className="seo-checks-list">
            {SEO_CHECKS.map(c => <CheckRow key={c.id} check={c} />)}
          </div>
        )}

        {/* Indexed pages */}
        {section === "pages" && (
          <div className="seo-pages-list">
            <div className="seo-pages-header-row">
              <span className="seo-pages-th">Page</span>
              <span className="seo-pages-th">Priority</span>
              <span className="seo-pages-th">Status</span>
              <span className="seo-pages-th">Last updated</span>
            </div>
            {INDEXED_PAGES.map(p => (
              <div key={p.url} className="seo-page-row">
                <div className="seo-page-url-cell">
                  <span className={`seo-page-type-badge seo-page-type--${p.type}`}>{p.type}</span>
                  <div className="seo-page-url-body">
                    <span className="seo-page-title">{p.title}</span>
                    <a href={p.url} target="_blank" rel="noopener noreferrer" className="seo-page-url">
                      {p.url}
                    </a>
                  </div>
                </div>
                <span className="seo-page-priority">{p.priority}</span>
                <span className="seo-page-status">
                  <span className="seo-status-dot seo-status-dot--pass" />
                  {p.status}
                </span>
                <span className="seo-page-lastmod">{p.lastmod}</span>
              </div>
            ))}
          </div>
        )}

        {/* Opportunities */}
        {section === "opportunities" && (
          <div className="seo-ops-list">
            <p className="seo-ops-note">
              Keyword data is manually curated. Connect Google Search Console for live impression and click data.
            </p>
            {CONTENT_OPPORTUNITIES.map(op => (
              <OpportunityRow key={op.keyword} op={op} onDraft={handleDraft} />
            ))}
          </div>
        )}

      </div>

      {/* Footer nudge */}
      <div className="seo-footer">
        <span className="seo-footer-tip">
          💡 Highest ROI action: publish a blog post targeting "whatsapp follow up automation" — 4,400 searches/month, medium difficulty.
        </span>
        <button className="seo-footer-cta" onClick={() => onNavigate?.("content")}>
          Open Content Engine →
        </button>
      </div>

    </div>
  );
}
