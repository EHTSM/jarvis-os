import React, { useState } from "react";
import "./PricingPage.css";

const PLANS = [
  {
    id:       "starter",
    name:     "Starter",
    price:    "₹999",
    period:   "/month",
    tagline:  "For freelancers and solo operators",
    featured: false,
    cta:      "Start Free Trial",
    features: [
      "Up to 100 leads",
      "WhatsApp follow-up sequences (4 tiers)",
      "Payment link generation",
      "Pipeline & revenue dashboard",
      "7-day message history",
      "Email support",
    ],
    limits: "100 leads · 500 messages/month",
  },
  {
    id:       "growth",
    name:     "Growth",
    price:    "₹2,499",
    period:   "/month",
    tagline:  "For growing businesses and small teams",
    featured: true,
    badge:    "Most Popular",
    cta:      "Start Free Trial",
    features: [
      "Up to 1,000 leads",
      "WhatsApp follow-up sequences (6 tiers)",
      "Payment links + bulk messaging",
      "Full pipeline & revenue analytics",
      "Activity timeline (90 days)",
      "Control Room — task execution",
      "Developer & Business OS modules",
      "Priority support",
    ],
    limits: "1,000 leads · 5,000 messages/month",
  },
  {
    id:       "scale",
    name:     "Scale",
    price:    "Custom",
    period:   "",
    tagline:  "For agencies and high-volume operators",
    featured: false,
    cta:      "Contact Us",
    features: [
      "Unlimited leads",
      "Custom automation sequences",
      "White-label options",
      "Dedicated onboarding",
      "SLA-backed uptime",
      "Enterprise OS + audit log",
      "Custom integrations",
      "Dedicated support",
    ],
    limits: "Unlimited",
  },
];

const FAQ = [
  {
    q: "Do I need a credit card for the free trial?",
    a: "No. The 7-day trial requires no credit card. You only pay if you choose to continue.",
  },
  {
    q: "What happens after the trial ends?",
    a: "You'll be prompted to select a plan. Your data and leads are preserved either way — nothing is deleted.",
  },
  {
    q: "Does Ooplix charge per message?",
    a: "No. The subscription covers Ooplix platform access. WhatsApp API usage is billed separately by Meta (typically very low cost). Razorpay charges a small transaction fee per payment collected.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes. Cancel from your account at any time. Cancellation takes effect at the end of your billing period. See our Refund Policy for details.",
  },
  {
    q: "Is my data safe if I cancel?",
    a: "Yes. You can export your leads and data at any time. After cancellation, data is retained for 30 days then deleted.",
  },
];

// onUpgrade(planId) — called when user is already authenticated and wants to pay.
// onStart() — called from public landing page (routes to onboarding/signup flow).
export default function PricingPage({ onBack, onStart, onUpgrade }) {
  const [openFaq, setOpenFaq] = useState(null);
  const isAuthenticated = !!onUpgrade;

  return (
    <div className="pricing-page">
      <div className="pricing-inner">

        {onBack && (
          <button className="pricing-back" onClick={onBack}>← Back</button>
        )}

        <div className="pricing-header">
          <h1 className="pricing-title">Simple, honest pricing</h1>
          <p className="pricing-sub">
            Start free for 7 days. No credit card required.
            Cancel anytime. All plans include WhatsApp automation, payment links, and pipeline management.
          </p>
        </div>

        <div className="pricing-grid">
          {PLANS.map(plan => (
            <div
              key={plan.id}
              className={`pricing-card${plan.featured ? " pricing-card--featured" : ""}`}
            >
              {plan.badge && (
                <div className="pricing-badge">{plan.badge}</div>
              )}
              <div className="pricing-card-top">
                <h2 className="pricing-plan-name">{plan.name}</h2>
                <p className="pricing-plan-tagline">{plan.tagline}</p>
                <div className="pricing-price-row">
                  <span className="pricing-price">{plan.price}</span>
                  {plan.period && <span className="pricing-period">{plan.period}</span>}
                </div>
                <p className="pricing-limits">{plan.limits}</p>
              </div>

              <ul className="pricing-features">
                {plan.features.map((f, i) => (
                  <li key={i} className="pricing-feature">
                    <span className="pricing-check" aria-hidden="true">✓</span>
                    {f}
                  </li>
                ))}
              </ul>

              <button
                className={`pricing-cta${plan.featured ? " pricing-cta--featured" : ""}`}
                onClick={() => {
                  if (plan.id === "scale") { window.location.href = "mailto:sales@ooplix.com"; return; }
                  if (isAuthenticated) onUpgrade(plan.id);
                  else onStart?.();
                }}
              >
                {plan.id === "scale" ? plan.cta : isAuthenticated ? `Upgrade to ${plan.name}` : plan.cta}
              </button>
            </div>
          ))}
        </div>

        <div className="pricing-trust">
          <div className="pricing-trust-item">
            <span className="pricing-trust-icon">🔒</span>
            <span>Payments via Razorpay — PCI-DSS Level 1</span>
          </div>
          <div className="pricing-trust-item">
            <span className="pricing-trust-icon">🇮🇳</span>
            <span>Indian company — ALWALIY TECHNOLOGIES PRIVATE LIMITED</span>
          </div>
          <div className="pricing-trust-item">
            <span className="pricing-trust-icon">↩</span>
            <span>Cancel anytime · 30-day data retention after cancellation</span>
          </div>
        </div>

        <div className="pricing-faq">
          <h2 className="pricing-faq-title">Frequently asked questions</h2>
          <div className="pricing-faq-list">
            {FAQ.map((item, i) => (
              <div
                key={i}
                className={`pricing-faq-item${openFaq === i ? " pricing-faq-item--open" : ""}`}
              >
                <button
                  className="pricing-faq-q"
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  aria-expanded={openFaq === i}
                >
                  {item.q}
                  <span className="pricing-faq-chevron" aria-hidden="true">
                    {openFaq === i ? "−" : "+"}
                  </span>
                </button>
                {openFaq === i && (
                  <p className="pricing-faq-a">{item.a}</p>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="pricing-footer-note">
          &copy; {new Date().getFullYear()} ALWALIY TECHNOLOGIES PRIVATE LIMITED.
          Prices in INR. GST applicable as per Indian tax law.
          By subscribing you agree to our{" "}
          <a href="#terms" className="pricing-footer-link">Terms of Service</a>
          {" "}and{" "}
          <a href="#refund" className="pricing-footer-link">Refund Policy</a>.
        </div>

      </div>
    </div>
  );
}
