import React, { useRef, useEffect, useState } from "react";
import { motion, useInView, useScroll, useTransform } from "framer-motion";
import { OoplixWordmark } from "../design/OoplixWordmark";
import { spring, transition } from "../design/motion";
import "./LandingPage.css";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const NAV_LINKS = [
  { label: "Features",     id: "features" },
  { label: "How it works", id: "how-it-works" },
  { label: "Compare",      id: "compare" },
];

function _scrollTo(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

const TRUST_ITEMS = [
  "Solo founders",
  "Small teams",
  "Technical founders",
  "Growth operators",
  "Service businesses",
];

const HOW_IT_WORKS = [
  {
    symbol: "◉",
    num: "01",
    title: "Describe",
    body: "Tell Ooplix a goal in plain language — a lead to follow up, a campaign to run, a feature to ship.",
  },
  {
    symbol: "⊕",
    num: "02",
    title: "Plan",
    body: "Ooplix plans the work and routes it across the right agents — CRM, growth, engineering, or all three.",
  },
  {
    symbol: "▶",
    num: "03",
    title: "Execute",
    body: "Work is queued for your approval or runs autonomously based on your confidence thresholds.",
  },
];

const CAPABILITIES = [
  {
    title: "Business OS",
    desc: "CRM with WhatsApp + Telegram automation, deal pipeline, and payment links.",
    color: "violet",
  },
  {
    title: "Mission Feed",
    desc: "Live stream of every agent action across your business.",
    color: "teal",
  },
  {
    title: "Approval Queue",
    desc: "Human-in-loop for high-risk actions. One click.",
    color: "blue",
  },
  {
    title: "Guardrail System",
    desc: "Safety scores, regression checks, blast radius analysis.",
    color: "amber",
  },
  {
    title: "Growth OS",
    desc: "Email, SMS, and WhatsApp campaigns with real-time lead intelligence.",
    color: "green",
  },
  {
    title: "Command Dispatch",
    desc: "Run any task in plain language. The OS routes it.",
    color: "violet",
  },
];

const TERMINAL_ROWS = [
  { id: "crm-agent-001", status: "RUNNING",  task: "Following up with lead \"Acme Co\" on WhatsApp",       elapsed: "3s"  },
  { id: "growth-agent-02", status: "THINKING", task: "Scoring 14 new leads by engagement signal",          elapsed: "1s"  },
  { id: "pay-agent-05", status: "DONE",     task: "Payment link sent — deal moved to Won",                elapsed: "12s" },
  { id: "guard-003",    status: "RUNNING",  task: "Regression check: 47 tests passing, 0 failures",      elapsed: "6s"  },
  { id: "intel-01",     status: "DONE",     task: "Weekly follow-up sequence completed for 8 leads",       elapsed: "28s" },
  { id: "eng-agent-09", status: "RUNNING",  task: "Drafting a fix for the failing checkout test",         elapsed: "2s"  },
];

const BEFORE_ITEMS = [
  "Leads followed up manually, if at all",
  "Payment links created one at a time",
  "Marketing campaigns built by hand each time",
  "Engineering work planned and tracked separately",
  "Reports assembled the night before a meeting",
  "No single view of the business",
];

const AFTER_ITEMS = [
  "Ooplix follows up with leads on WhatsApp automatically",
  "Payment links generated in one click from a deal",
  "Campaigns run from reusable templates and triggers",
  "Engineering missions planned, executed, and tracked in one pipeline",
  "Reports and the executive dashboard stay current on their own",
  "One operating system for the whole business",
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function InView({ children, delay = 0, className, style, y = 20 }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  return (
    <motion.div
      ref={ref}
      className={className}
      style={style}
      initial={{ opacity: 0, y }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ ...transition.enter, delay }}
    >
      {children}
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Nav
// ─────────────────────────────────────────────────────────────────────────────

function Nav({ onAccess, onPricing, onLogin }) {
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    return scrollY.on("change", (v) => setScrolled(v > 24));
  }, [scrollY]);

  return (
    <motion.nav
      className={`lp-nav${scrolled ? " lp-nav--scrolled" : ""}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* The landing nav is a fixed dark surface in both themes
          (rgba(3,5,10,.82)), so the wordmark opts into light-on-dark. */}
      <OoplixWordmark size={26} dark />

      <ul className="lp-nav-links" role="list">
        {NAV_LINKS.map((l) => (
          <li key={l.id}>
            <button className="lp-nav-link" onClick={() => _scrollTo(l.id)}>{l.label}</button>
          </li>
        ))}
        {/* A.4.3 finding: PricingPage.jsx and the onPricing callback already
            existed end-to-end (wired from App.jsx through LandingPage), but
            Nav dropped the prop instead of rendering a trigger for it — a
            founder deciding whether to trial the product had no way to see
            pricing without signing up first. Recovered, not rebuilt: same
            nav-link pattern as Features/How it works/Compare above. */}
        {onPricing && (
          <li>
            <button className="lp-nav-link" onClick={onPricing}>Pricing</button>
          </li>
        )}
      </ul>

      <div className="lp-nav-actions">
        {/* A.4.3 finding: a returning founder had NO way to log in from the
            public site at all — App.jsx already builds and passes down a
            real, working onLogin (routes to the real login screen, itself
            already wired to a real ForgotPassword flow), but it was never
            rendered anywhere in Nav/Hero/CTASection, and even a direct
            /login URL fell through to onboarding instead. Recovered the
            existing callback with a visible trigger — no new auth screen,
            no new routing logic. */}
        {onLogin && (
          <button className="lp-nav-link lp-nav-login" onClick={onLogin}>Log in</button>
        )}
        <motion.button
          className="lp-btn-primary lp-nav-cta"
          onClick={onAccess}
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          transition={spring.snappy}
        >
          Start free trial
        </motion.button>
      </div>
    </motion.nav>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Hero
// ─────────────────────────────────────────────────────────────────────────────

const HERO_WORDS_LINE1 = ["Your", "business"];
const HERO_WORDS_LINE2 = ["runs", "itself."];

function HeroWordStagger({ words, className, delay = 0 }) {
  return (
    <span className={className}>
      {words.map((word, i) => (
        <motion.span
          key={word + i}
          className="lp-hero-word"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...transition.enter, delay: delay + i * 0.10 }}
        >
          {word}
          {i < words.length - 1 ? " " : ""}
        </motion.span>
      ))}
    </span>
  );
}

// Below-fold mock terminal in hero (scroll teaser)
const HERO_TERMINAL_ROWS = [
  { label: "◉ Tracking 14 leads across 3 campaigns", color: "violet" },
  { label: "⊕ Hot lead detected: \"Acme Co\" opened pricing page", color: "amber" },
  { label: "▶ Follow-up: WhatsApp message queued", color: "teal" },
  { label: "✓ Payment link sent · awaiting approval", color: "green" },
];

function HeroTerminal() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "0px" });
  const [visible, setVisible] = useState(0);

  useEffect(() => {
    if (!inView) return;
    const timers = HERO_TERMINAL_ROWS.map((_, i) =>
      setTimeout(() => setVisible((v) => Math.max(v, i + 1)), i * 540)
    );
    return () => timers.forEach(clearTimeout);
  }, [inView]);

  return (
    <motion.div
      ref={ref}
      className="lp-hero-terminal"
      initial={{ opacity: 0, y: 32, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ ...transition.slow, delay: 0.55 }}
    >
      <div className="lp-term-bar">
        <span className="lp-term-dot lp-term-dot--red" />
        <span className="lp-term-dot lp-term-dot--amber" />
        <span className="lp-term-dot lp-term-dot--green" />
        <span className="lp-term-title">ooplix — mission feed</span>
      </div>
      <div className="lp-term-body">
        <div className="lp-term-prompt">
          <span className="lp-term-ps">$</span>
          <span className="lp-term-cmd">ooplix run --live</span>
          <motion.span
            className="lp-term-cursor"
            animate={{ opacity: [1, 0, 1] }}
            transition={{ duration: 1.1, repeat: Infinity, ease: "steps(1)" }}
          />
        </div>
        {HERO_TERMINAL_ROWS.slice(0, visible).map((row, i) => (
          <motion.div
            key={i}
            className={`lp-term-row lp-term-row--${row.color}`}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          >
            {row.label}
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}

function Hero({ onAccess }) {
  return (
    <section className="lp-hero">
      <div className="lp-hero-grid-overlay" aria-hidden="true" />
      <div className="lp-hero-glow" aria-hidden="true" />

      <div className="lp-hero-inner">
        {/* Eyebrow */}
        <motion.div
          className="lp-eyebrow"
          initial={{ opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ ...transition.enter, delay: 0.08 }}
        >
          <motion.span
            className="lp-eyebrow-dot"
            animate={{ scale: [1, 1.45, 1], opacity: [1, 0.55, 1] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
          />
          AI Operating System
        </motion.div>

        {/* H1 */}
        <h1 className="lp-hero-h1">
          <HeroWordStagger words={HERO_WORDS_LINE1} className="lp-hero-line lp-hero-line--white" delay={0.18} />
          <br />
          <HeroWordStagger words={HERO_WORDS_LINE2} className="lp-hero-line lp-hero-line--gradient" delay={0.36} />
        </h1>

        {/* Sub */}
        <motion.p
          className="lp-hero-sub"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...transition.enter, delay: 0.56 }}
        >
          Ooplix runs workflows, follows up with leads on WhatsApp,
          collects payments, and executes tasks autonomously.
        </motion.p>

        {/* CTAs */}
        <motion.div
          className="lp-hero-ctas"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...transition.enter, delay: 0.66 }}
        >
          <motion.button
            className="lp-btn-primary lp-btn-pulse"
            onClick={onAccess}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            transition={spring.snappy}
          >
            <motion.span
              className="lp-btn-dot"
              animate={{ scale: [1, 1.4, 1], opacity: [1, 0.55, 1] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
            />
            Start free trial
          </motion.button>
          <motion.button
            className="lp-btn-ghost"
            onClick={() => _scrollTo("how-it-works")}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            transition={spring.snappy}
          >
            See how it works →
          </motion.button>
        </motion.div>

        {/* Hero terminal teaser */}
        <HeroTerminal />
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Social proof strip
// ─────────────────────────────────────────────────────────────────────────────

function TrustStrip() {
  return (
    <InView className="lp-trust">
      <span className="lp-trust-label">Built for</span>
      <div className="lp-trust-items">
        {TRUST_ITEMS.map((t) => (
          <span key={t} className="lp-trust-item">{t}</span>
        ))}
      </div>
    </InView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// How it works
// ─────────────────────────────────────────────────────────────────────────────

function HowItWorks() {
  return (
    <section id="how-it-works" className="lp-how">
      <div className="lp-section-inner">
        <InView className="lp-section-header">
          <div className="lp-label">How it works</div>
          <h2 className="lp-section-title">
            Describe. Plan. Execute.
          </h2>
          <p className="lp-section-sub">
            Three phases. No human required unless you want one.
          </p>
        </InView>

        <div className="lp-steps">
          {HOW_IT_WORKS.map((step, i) => (
            <InView key={step.num} delay={0.08 * i} className="lp-step">
              <div className="lp-step-num">{step.num}</div>
              <div className="lp-step-symbol">{step.symbol}</div>
              <h3 className="lp-step-title">{step.title}</h3>
              <p className="lp-step-body">{step.body}</p>
            </InView>
          ))}
          {/* Connector lines (desktop only, CSS handles visibility) */}
          <div className="lp-step-connector" aria-hidden="true" />
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Capability grid
// ─────────────────────────────────────────────────────────────────────────────

function CapabilityGrid() {
  return (
    <section id="features" className="lp-caps">
      <div className="lp-section-inner">
        <InView className="lp-section-header">
          <div className="lp-label">Capabilities</div>
          <h2 className="lp-section-title">
            What the OS does.
          </h2>
          <p className="lp-section-sub">
            Each capability is live. No configuration required to start.
          </p>
        </InView>

        <div className="lp-cap-grid">
          {CAPABILITIES.map((cap, i) => (
            <motion.div
              key={cap.title}
              className={`lp-cap-card lp-cap-card--${cap.color}`}
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ ...transition.enter, delay: 0.05 * i }}
              whileHover={{ y: -3, transition: spring.snappy }}
            >
              <h3 className="lp-cap-title">{cap.title}</h3>
              <p className="lp-cap-desc">{cap.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Terminal demo section
// ─────────────────────────────────────────────────────────────────────────────

function TerminalDemo() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  const [visibleRows, setVisibleRows] = useState(0);

  useEffect(() => {
    if (!inView) return;
    setVisibleRows(0);
    const timers = TERMINAL_ROWS.map((_, i) =>
      setTimeout(() => setVisibleRows((v) => Math.max(v, i + 1)), 300 + i * 600)
    );
    return () => timers.forEach(clearTimeout);
  }, [inView]);

  return (
    <section className="lp-terminal-section">
      <div className="lp-section-inner">
        <InView className="lp-section-header">
          <div className="lp-label">Mission Feed</div>
          <h2 className="lp-section-title">
            Watch it work.
          </h2>
          <p className="lp-section-sub">
            Every action the OS takes is logged here, in real time.
          </p>
        </InView>

        <motion.div
          ref={ref}
          className="lp-terminal"
          initial={{ opacity: 0, y: 28, scale: 0.985 }}
          whileInView={{ opacity: 1, y: 0, scale: 1 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ ...transition.slow, delay: 0.1 }}
        >
          <div className="lp-term-bar">
            <span className="lp-term-dot lp-term-dot--red" />
            <span className="lp-term-dot lp-term-dot--amber" />
            <span className="lp-term-dot lp-term-dot--green" />
            <span className="lp-term-title">ooplix — mission feed</span>
          </div>

          {/* Column header */}
          <div className="lp-feed-header">
            <span className="lp-feed-col lp-feed-col--id">AGENT</span>
            <span className="lp-feed-col lp-feed-col--status">STATUS</span>
            <span className="lp-feed-col lp-feed-col--task">TASK</span>
            <span className="lp-feed-col lp-feed-col--elapsed">ELAPSED</span>
          </div>

          <div className="lp-feed-body">
            {TERMINAL_ROWS.slice(0, visibleRows).map((row, i) => (
              <motion.div
                key={row.id}
                className={`lp-feed-row lp-feed-row--${row.status.toLowerCase()}`}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              >
                <span className="lp-feed-col lp-feed-col--id">{row.id}</span>
                <span className="lp-feed-col lp-feed-col--status">
                  <span className={`lp-feed-badge lp-feed-badge--${row.status.toLowerCase()}`}>
                    {row.status}
                  </span>
                </span>
                <span className="lp-feed-col lp-feed-col--task">{row.task}</span>
                <span className="lp-feed-col lp-feed-col--elapsed">{row.elapsed}</span>
              </motion.div>
            ))}

            {/* Blinking cursor row */}
            {visibleRows > 0 && visibleRows <= TERMINAL_ROWS.length && (
              <div className="lp-feed-row lp-feed-row--cursor">
                <span className="lp-feed-col lp-feed-col--id">
                  <motion.span
                    className="lp-term-cursor"
                    animate={{ opacity: [1, 0, 1] }}
                    transition={{ duration: 1.1, repeat: Infinity, ease: "steps(1)" }}
                  />
                </span>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Comparison section
// ─────────────────────────────────────────────────────────────────────────────

function Comparison() {
  return (
    <section id="compare" className="lp-compare">
      <div className="lp-section-inner">
        <InView className="lp-section-header">
          <div className="lp-label">The difference</div>
          <h2 className="lp-section-title">
            Before and after.
          </h2>
        </InView>

        <div className="lp-compare-cols">
          <InView delay={0} className="lp-compare-col lp-compare-col--before">
            <div className="lp-compare-head">Before Ooplix</div>
            <ul className="lp-compare-list" role="list">
              {BEFORE_ITEMS.map((item) => (
                <li key={item} className="lp-compare-item lp-compare-item--before">
                  <span className="lp-compare-icon">✕</span>
                  {item}
                </li>
              ))}
            </ul>
          </InView>

          <InView delay={0.12} className="lp-compare-col lp-compare-col--after">
            <div className="lp-compare-head">With Ooplix</div>
            <ul className="lp-compare-list" role="list">
              {AFTER_ITEMS.map((item) => (
                <li key={item} className="lp-compare-item lp-compare-item--after">
                  <span className="lp-compare-icon">✓</span>
                  {item}
                </li>
              ))}
            </ul>
          </InView>
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CTA section
// ─────────────────────────────────────────────────────────────────────────────

function CTASection({ onAccess }) {
  return (
    <section className="lp-cta-section">
      <div className="lp-cta-glow" aria-hidden="true" />
      <InView className="lp-cta-inner">
        <h2 className="lp-cta-title">
          Ready to let your business run itself?
        </h2>
        <p className="lp-cta-sub">
          Ooplix is the operating system of your business. No re-architecture.
          No onboarding call. No demo request form.
        </p>
        <div className="lp-cta-actions">
          <motion.button
            className="lp-btn-primary lp-btn-pulse lp-btn-lg"
            onClick={onAccess}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            transition={spring.snappy}
          >
            <motion.span
              className="lp-btn-dot"
              animate={{ scale: [1, 1.4, 1], opacity: [1, 0.55, 1] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
            />
            Start free trial
          </motion.button>
        </div>
        <p className="lp-cta-fine">
          No credit card. 7-day free trial. Running in minutes.
        </p>
      </InView>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Footer
// ─────────────────────────────────────────────────────────────────────────────

function Footer({ onLegal }) {
  return (
    <footer className="lp-footer">
      {/* The footer is a hard #03050a in both themes → light-on-dark.
          B19.2.2: opacity was 0.52, which composited the wordmark to ~2.3:1.
          Raised to 0.78 (≥4.5:1) — still visibly recessed, now legible. */}
      <OoplixWordmark size={22} dark style={{ opacity: 0.78 }} />

      <nav className="lp-footer-nav" aria-label="Footer navigation">
        <button className="lp-footer-link" onClick={() => onLegal?.("privacy")}>Privacy</button>
        <button className="lp-footer-link" onClick={() => onLegal?.("terms")}>Terms</button>
        <button className="lp-footer-link" onClick={() => onLegal?.("contact")}>Contact</button>
      </nav>

      <span className="lp-footer-copy">© 2026 Ooplix</span>
    </footer>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Root
// ─────────────────────────────────────────────────────────────────────────────

export default function LandingPage({ onLogin, onStart, onLegal, onPricing }) {
  const handleAccess = () => (onStart ?? onLogin)?.();

  return (
    <div className="lp">
      <Nav onAccess={handleAccess} onPricing={onPricing} onLogin={onLogin} />
      <Hero onAccess={handleAccess} />
      <TrustStrip />
      <HowItWorks />
      <CapabilityGrid />
      <TerminalDemo />
      <Comparison />
      <CTASection onAccess={handleAccess} />
      <Footer onLegal={onLegal} />
    </div>
  );
}
