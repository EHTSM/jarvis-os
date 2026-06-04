import React, { useState } from "react";
import { track } from "../analytics";
import "./PartnerProgram.css";

// ── Partner tiers ─────────────────────────────────────────────────────
const PARTNER_TIERS = [
  {
    id:        "affiliate",
    name:      "Affiliate",
    icon:      "◎",
    color:     "var(--accent2)",
    threshold: "0 clients",
    commission:"20% recurring",
    desc:      "Refer clients to Ooplix and earn 20% of their monthly subscription — every month they stay.",
    perks:     ["Unique referral link", "Marketing materials", "Monthly commission payouts", "Partner support email"],
    best_for:  "Bloggers, content creators, and professionals who recommend tools to their audience.",
  },
  {
    id:        "reseller",
    name:      "Reseller",
    icon:      "◈",
    color:     "var(--accent)",
    threshold: "5+ active clients",
    commission:"30% recurring",
    desc:      "Sell Ooplix directly to clients under your brand or as part of your service offering.",
    perks:     ["30% commission", "Co-branded materials", "Client management dashboard", "Priority partner support", "Early access to new features"],
    best_for:  "Freelancers and consultants who offer automation or CRM services.",
  },
  {
    id:        "agency",
    name:      "Agency Partner",
    icon:      "◉",
    color:     "var(--warning)",
    threshold: "10+ active clients",
    commission:"40% recurring + setup fee",
    desc:      "White-label Ooplix for your clients. Manage multiple accounts from a single partner dashboard.",
    perks:     ["40% commission", "Setup fee per client", "White-label option", "Dedicated partner manager", "Custom onboarding for your clients", "Revenue sharing on referrals-of-referrals"],
    best_for:  "Digital agencies managing multiple client pipelines and automation workflows.",
  },
];

// ── Revenue model table ───────────────────────────────────────────────
const REV_SCENARIOS = [
  { clients: 1,   plan: "Starter (₹999)",  affiliate: "₹200/mo",  reseller: "₹300/mo",  agency: "₹400/mo" },
  { clients: 5,   plan: "Starter (₹999)",  affiliate: "₹1,000/mo",reseller: "₹1,500/mo",agency: "₹2,000/mo" },
  { clients: 10,  plan: "Growth (₹2,499)", affiliate: "₹5,000/mo",reseller: "₹7,500/mo",agency: "₹10,000/mo" },
  { clients: 25,  plan: "Growth (₹2,499)", affiliate: "₹12,500/mo",reseller: "₹18,750/mo",agency: "₹25,000/mo" },
  { clients: 50,  plan: "Growth (₹2,499)", affiliate: "₹25,000/mo",reseller: "₹37,500/mo",agency: "₹50,000/mo" },
];

// ── Onboarding checklist ──────────────────────────────────────────────
const PARTNER_CHECKLIST = [
  { id: "apply",    label: "Submit partner application (email: partners@ooplix.com)",        tier: ["affiliate","reseller","agency"] },
  { id: "approved", label: "Receive partner approval and welcome kit",                       tier: ["affiliate","reseller","agency"] },
  { id: "link",     label: "Get your unique referral/partner link",                          tier: ["affiliate","reseller","agency"] },
  { id: "materials",label: "Download marketing materials and branding pack",                  tier: ["affiliate","reseller","agency"] },
  { id: "training", label: "Complete product walkthrough (30-min async video)",              tier: ["reseller","agency"]            },
  { id: "clients",  label: "Identify your first 3 potential client referrals",               tier: ["affiliate","reseller","agency"] },
  { id: "demo",     label: "Run a live demo with your first prospect",                        tier: ["reseller","agency"]            },
  { id: "billing",  label: "Set up commission payout method (bank transfer or UPI)",         tier: ["affiliate","reseller","agency"] },
  { id: "dashboard",label: "Access partner dashboard to track referrals and commissions",    tier: ["reseller","agency"]            },
  { id: "manager",  label: "Schedule kickoff call with your dedicated partner manager",      tier: ["agency"]                      },
];

// ── Partner types landing ─────────────────────────────────────────────
const PARTNER_PROFILES = [
  {
    type:     "Agencies",
    icon:     "◉",
    color:    "var(--warning)",
    headline: "Add an automation revenue line to your agency",
    desc:     "Offer Ooplix as a managed service to your clients. Set it up, train them, and earn 40% of their subscription every month — without ongoing work.",
    action:   "Become an Agency Partner",
  },
  {
    type:     "Freelancers",
    icon:     "◈",
    color:    "var(--accent)",
    headline: "Earn recurring income from your client base",
    desc:     "You already advise clients on tools. Recommend Ooplix, get them set up, and earn 30% recurring commission — as long as they're subscribed.",
    action:   "Become a Reseller",
  },
  {
    type:     "Consultants",
    icon:     "◎",
    color:    "var(--accent2)",
    headline: "A tool your clients will thank you for",
    desc:     "Your clients need automation. Ooplix is the simplest path to it. Refer them with your affiliate link and earn 20% recurring commission with zero ongoing work.",
    action:   "Become an Affiliate",
  },
];

function TierCard({ tier, active, onSelect }) {
  return (
    <button
      className={`pp-tier-card${active ? " pp-tier-card--active" : ""}`}
      onClick={() => onSelect(tier.id)}
    >
      <div className="pp-tier-header">
        <span className="pp-tier-icon" style={{ color: tier.color }}>{tier.icon}</span>
        <div className="pp-tier-name-block">
          <span className="pp-tier-name">{tier.name}</span>
          <span className="pp-tier-threshold">{tier.threshold}</span>
        </div>
        <span className="pp-tier-commission" style={{ color: tier.color }}>{tier.commission}</span>
      </div>
      <p className="pp-tier-desc">{tier.desc}</p>
      <ul className="pp-tier-perks">
        {tier.perks.map((p, i) => (
          <li key={i} className="pp-tier-perk">
            <span className="pp-perk-check" style={{ color: tier.color }}>✓</span>
            {p}
          </li>
        ))}
      </ul>
      <p className="pp-tier-best-for"><strong>Best for:</strong> {tier.best_for}</p>
    </button>
  );
}

export default function PartnerProgram({ onNavigate }) {
  const [section,    setSection]    = useState("overview");
  const [activeTier, setActiveTier] = useState(null);
  const [checkedItems, setCheckedItems] = useState({});

  React.useEffect(() => { track.event("partner_program_viewed"); }, []);

  const handleApply = (tierName) => {
    track.event("partner_apply_clicked", { tier: tierName });
    window.location.href = "mailto:partners@ooplix.com?subject=Partner Application — " + tierName;
  };

  const checklistForTier = activeTier
    ? PARTNER_CHECKLIST.filter(c => c.tier.includes(activeTier))
    : PARTNER_CHECKLIST;

  return (
    <div className="partner-program page-enter">

      <div className="pp-header">
        <div>
          <h1 className="pp-title">Partner Program</h1>
          <p className="pp-subtitle">Earn recurring commission by bringing Ooplix to your clients and audience.</p>
        </div>
        <button
          className="pp-apply-btn"
          onClick={() => handleApply("General")}
        >
          Apply to partner →
        </button>
      </div>

      <div className="pp-tabs">
        {[
          { id: "overview",   label: "Overview"        },
          { id: "tiers",      label: "Partner Tiers"   },
          { id: "revenue",    label: "Revenue Model"   },
          { id: "checklist",  label: "Onboarding"      },
        ].map(t => (
          <button
            key={t.id}
            className={`pp-tab${section === t.id ? " pp-tab--active" : ""}`}
            onClick={() => setSection(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="pp-content" key={section}>

        {/* Overview — partner profiles */}
        {section === "overview" && (
          <div className="pp-overview">
            <div className="pp-profiles">
              {PARTNER_PROFILES.map(p => (
                <div key={p.type} className="pp-profile-card">
                  <div className="pp-profile-top">
                    <span className="pp-profile-icon" style={{ color: p.color }}>{p.icon}</span>
                    <span className="pp-profile-type" style={{ color: p.color }}>{p.type}</span>
                  </div>
                  <h3 className="pp-profile-headline">{p.headline}</h3>
                  <p className="pp-profile-desc">{p.desc}</p>
                  <button
                    className="pp-profile-cta"
                    style={{ borderColor: p.color + "44", color: p.color }}
                    onClick={() => handleApply(p.type)}
                  >
                    {p.action} →
                  </button>
                </div>
              ))}
            </div>
            <div className="pp-summary-strip">
              {[
                { label: "Commission",  value: "Up to 40%",    sub: "Recurring monthly"      },
                { label: "Payout",      value: "Monthly",      sub: "Bank transfer or UPI"   },
                { label: "Min clients", value: "0",            sub: "Start as affiliate now"  },
                { label: "Contract",    value: "None",         sub: "Cancel anytime"          },
              ].map(s => (
                <div key={s.label} className="pp-summary-item">
                  <span className="pp-summary-value">{s.value}</span>
                  <span className="pp-summary-label">{s.label}</span>
                  <span className="pp-summary-sub">{s.sub}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tiers */}
        {section === "tiers" && (
          <div className="pp-tiers-grid">
            {PARTNER_TIERS.map(t => (
              <TierCard
                key={t.id}
                tier={t}
                active={activeTier === t.id}
                onSelect={id => {
                  setActiveTier(prev => prev === id ? null : id);
                  track.event("partner_tier_viewed", { tier: id });
                }}
              />
            ))}
          </div>
        )}

        {/* Revenue model */}
        {section === "revenue" && (
          <div className="pp-revenue">
            <p className="pp-revenue-intro">
              Estimated monthly commission based on client count and plan. Actual figures vary by plan mix.
            </p>
            <div className="pp-rev-table-wrap">
              <table className="pp-rev-table">
                <thead>
                  <tr>
                    <th className="pp-rth">Clients</th>
                    <th className="pp-rth">Plan</th>
                    <th className="pp-rth pp-rth--affiliate">Affiliate (20%)</th>
                    <th className="pp-rth pp-rth--reseller">Reseller (30%)</th>
                    <th className="pp-rth pp-rth--agency">Agency (40%)</th>
                  </tr>
                </thead>
                <tbody>
                  {REV_SCENARIOS.map((r, i) => (
                    <tr key={i} className="pp-rtr">
                      <td className="pp-rtd pp-rtd--clients">{r.clients}</td>
                      <td className="pp-rtd pp-rtd--plan">{r.plan}</td>
                      <td className="pp-rtd pp-rtd--affiliate">{r.affiliate}</td>
                      <td className="pp-rtd pp-rtd--reseller">{r.reseller}</td>
                      <td className="pp-rtd pp-rtd--agency">{r.agency}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pp-rev-cta">
              <p className="pp-rev-note">
                Commission is paid on the net subscription value after taxes. Scale-tier clients are handled separately — contact us for custom pricing.
              </p>
              <button className="pp-rev-apply-btn" onClick={() => handleApply("Reseller")}>
                Apply to become a partner →
              </button>
            </div>
          </div>
        )}

        {/* Onboarding checklist */}
        {section === "checklist" && (
          <div className="pp-checklist-section">
            <div className="pp-checklist-filter">
              <p className="pp-cl-label">Filter by tier</p>
              <div className="pp-cl-chips">
                <button
                  className={`pp-cl-chip${!activeTier ? " pp-cl-chip--active" : ""}`}
                  onClick={() => setActiveTier(null)}
                >All tiers</button>
                {PARTNER_TIERS.map(t => (
                  <button
                    key={t.id}
                    className={`pp-cl-chip${activeTier === t.id ? " pp-cl-chip--active" : ""}`}
                    style={activeTier === t.id ? { color: t.color, borderColor: t.color + "44" } : {}}
                    onClick={() => setActiveTier(prev => prev === t.id ? null : t.id)}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="pp-checklist-list">
              {checklistForTier.map(c => (
                <label
                  key={c.id}
                  className={`pp-check-item${checkedItems[c.id] ? " pp-check-item--done" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={!!checkedItems[c.id]}
                    onChange={() => setCheckedItems(p => ({ ...p, [c.id]: !p[c.id] }))}
                    className="pp-checkbox"
                  />
                  <span className="pp-check-label">{c.label}</span>
                  <div className="pp-check-tiers">
                    {c.tier.map(t => (
                      <span
                        key={t}
                        className="pp-check-tier-badge"
                        style={{ color: PARTNER_TIERS.find(pt=>pt.id===t)?.color }}
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </label>
              ))}
            </div>
            <div className="pp-checklist-cta">
              <p className="pp-cl-cta-text">Ready to start? Email us to apply.</p>
              <a
                href="mailto:partners@ooplix.com?subject=Partner Application"
                className="pp-cl-cta-link"
                onClick={() => track.event("partner_email_clicked")}
              >
                partners@ooplix.com →
              </a>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
