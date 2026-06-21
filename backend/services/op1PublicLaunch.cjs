"use strict";
/**
 * OP-1 — Ooplix Public Launch
 *
 * No feature development. Only execution.
 *
 * 6-week launch program + ongoing:
 *   Week 1: Production deployment verification
 *   Week 2: 14-day founder usage (100% Ooplix, zero external IDE)
 *   Week 3: 10 alpha users — bugs + suggestions + daily releases
 *   Week 4: Closed Beta — 50 users, NPS, activation, retention
 *   Week 5: Public Beta — website, docs, community, referral, organic
 *   Week 6+: Revenue / conversion / CS / scale
 *
 * Definition of Success:
 *   100 active users · 20 paying users · NPS > 50
 *   Daily active usage · Feature adoption > 60% · Organic referrals
 *   Company officially launched
 *
 * Reuses:
 *   co2FounderOps.cjs   — deploy checklist, dogfood, perf, readiness
 *   co3UserSuccess.cjs  — invites, feedback, CS inbox, KB, crash, usage, beta
 *   launchMetrics.cjs   — NPS, MRR, snapshot
 *   launchReadiness.cjs — system readiness checks
 *   billingService.js   — plan/account data
 *   productionInfra.cjs — CO1 benchmark
 *
 * Storage: data/op1-public-launch.json
 */

const fs   = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "../../data/op1-public-launch.json");
const ROOT      = path.join(__dirname, "../..");

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
  catch {
    return {
      weeks:        _defaultWeeks(),
      escapes:      [],
      blockers:     [],
      dailyReleases:[],
      successKPIs:  _defaultKPIs(),
      launchLog:    [],
    };
  }
}
function _save(s) { fs.writeFileSync(DATA_FILE, JSON.stringify(s, null, 2)); }
function _id(p)   { return `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`; }
function _ts()    { return new Date().toISOString(); }
function _today() { return new Date().toISOString().slice(0, 10); }
function _rj(f, fb){ try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return fb; } }

// ── Week definitions ──────────────────────────────────────────────────────────

function _defaultWeeks() {
  return {
    w1: {
      id: "w1", label: "Week 1 — Deploy & Verify",
      description: "Deploy production. Verify backups, billing, AI providers, monitoring.",
      status: "in_progress",
      items: [
        { id: "w1_deploy",      label: "Deploy production stack (VPS/Backend/Frontend/PM2/Nginx/SSL)", done: false, critical: true },
        { id: "w1_backups",     label: "Verify backup script runs and restores correctly",              done: false, critical: true },
        { id: "w1_billing",     label: "Verify Razorpay live keys — process test payment ₹1",          done: false, critical: true },
        { id: "w1_ai",          label: "Verify AI providers — Groq + OpenRouter responding",            done: false, critical: true },
        { id: "w1_monitoring",  label: "Verify PM2 alerts + error logs + uptime monitoring active",     done: false, critical: true },
        { id: "w1_ssl",         label: "Verify SSL cert auto-renewal (Let's Encrypt / certbot)",        done: false, critical: false },
        { id: "w1_domain",      label: "Verify app.ooplix.com resolves and loads correctly",            done: false, critical: false },
        { id: "w1_auth",        label: "Verify login/logout/OTP flow end-to-end",                       done: false, critical: true },
        { id: "w1_whatsapp",    label: "Verify WhatsApp webhook receives and processes messages",        done: false, critical: false },
        { id: "w1_crm",         label: "Verify CRM: add lead, set stage, view pipeline",                done: false, critical: false },
      ],
    },
    w2: {
      id: "w2", label: "Week 2 — Founder Usage",
      description: "14-day founder usage — 100% Ooplix, zero external IDE. Log every escape. Fix every blocker.",
      status: "pending",
      items: [
        { id: "w2_d1",   label: "Day 1: Use CRM + WhatsApp for all customer communication",          done: false, critical: true },
        { id: "w2_d2",   label: "Day 2: Use Mission system for all task planning",                   done: false, critical: true },
        { id: "w2_d3",   label: "Day 3: Use AI chat instead of ChatGPT/Claude web — log gaps",       done: false, critical: true },
        { id: "w2_d4",   label: "Day 4: Use Analytics dashboard instead of spreadsheets",            done: false, critical: false },
        { id: "w2_d5",   label: "Day 5: Run browser automation instead of manual web tasks",         done: false, critical: false },
        { id: "w2_d6",   label: "Day 6: Use Creative Studio for all design/content needs",           done: false, critical: false },
        { id: "w2_d7",   label: "Day 7: Weekly review — log all friction points",                    done: false, critical: true },
        { id: "w2_d8",   label: "Day 8-10: Fix all critical blockers from week 1 usage",             done: false, critical: true },
        { id: "w2_d11",  label: "Day 11-12: Use AI Coding to improve Ooplix from within Ooplix",    done: false, critical: false },
        { id: "w2_d13",  label: "Day 13: Final polish — fix all UX rough edges found",               done: false, critical: true },
        { id: "w2_d14",  label: "Day 14: Founder sign-off — ready for alpha users",                  done: false, critical: true },
      ],
    },
    w3: {
      id: "w3", label: "Week 3 — Alpha Users (10)",
      description: "Invite 10 alpha users. Collect every bug. Collect every suggestion. Daily releases.",
      status: "pending",
      items: [
        { id: "w3_invites",  label: "Send 10 invite codes to curated alpha users",          done: false, critical: true },
        { id: "w3_onboard",  label: "Personally onboard each alpha user (call + walkthrough)", done: false, critical: true },
        { id: "w3_kb",       label: "KB: ensure Getting Started + FAQ covers all alpha questions", done: false, critical: false },
        { id: "w3_inbox",    label: "CS inbox: respond to every alpha message within 4h",    done: false, critical: true },
        { id: "w3_bugs",     label: "Triage every bug — fix critical within 24h",            done: false, critical: true },
        { id: "w3_releases", label: "Ship daily releases (at least 5 days of the week)",     done: false, critical: true },
        { id: "w3_nps",      label: "Collect NPS from each alpha user (min 7/10 responses)", done: false, critical: true },
        { id: "w3_record",   label: "Record activation: who hit first value? How long?",     done: false, critical: false },
        { id: "w3_review",   label: "End-of-week: synthesize feedback → Week 4 readiness go/no-go", done: false, critical: true },
      ],
    },
    w4: {
      id: "w4", label: "Week 4 — Closed Beta (50 Users)",
      description: "Launch Closed Beta. 50 users. Track NPS, activation, retention.",
      status: "pending",
      items: [
        { id: "w4_50users",    label: "Invite cohort to 50 beta users (beta_50 tier)",              done: false, critical: true },
        { id: "w4_announce",   label: "Send beta launch announcement email to waitlist",             done: false, critical: true },
        { id: "w4_onboard",    label: "Automated onboarding flow runs without founder hand-holding", done: false, critical: true },
        { id: "w4_nps",        label: "Track NPS — target NPS > 30 from beta cohort",               done: false, critical: true },
        { id: "w4_activation", label: "Track D1/D3/D7 activation — target 60% D7 retention",        done: false, critical: true },
        { id: "w4_retention",  label: "DAU ≥ 25 (50% of beta users active daily)",                  done: false, critical: true },
        { id: "w4_bugs",       label: "Zero P0 (crash/data-loss) bugs open by EOW",                 done: false, critical: true },
        { id: "w4_revenue",    label: "First 5 paid conversions (₹999 Starter plan)",               done: false, critical: true },
        { id: "w4_referrals",  label: "At least 3 organic referrals from beta users",               done: false, critical: false },
        { id: "w4_report",     label: "Beta health report → Public Beta go/no-go decision",         done: false, critical: true },
      ],
    },
    w5: {
      id: "w5", label: "Week 5 — Public Beta",
      description: "Website. Documentation. Community. Referral. Organic marketing.",
      status: "pending",
      items: [
        { id: "w5_website",    label: "Launch ooplix.com landing page (homepage + pricing + demo)",  done: false, critical: true },
        { id: "w5_docs",       label: "Public docs live: getting-started, API reference, integrations", done: false, critical: true },
        { id: "w5_community",  label: "WhatsApp community group live — first 100 members",           done: false, critical: false },
        { id: "w5_referral",   label: "Referral program live: refer 3 → 1 month free",              done: false, critical: false },
        { id: "w5_organic",    label: "3 organic posts: demo video + founder story + product walk",   done: false, critical: false },
        { id: "w5_ph",         label: "Product Hunt listing ready (schedule launch)",                done: false, critical: false },
        { id: "w5_seo",        label: "Core SEO pages indexed (homepage + 3 feature pages)",         done: false, critical: false },
        { id: "w5_open_beta",  label: "Remove invite gate — allow self-signup with email verification", done: false, critical: true },
        { id: "w5_100users",   label: "Target: 100 total registered users by EOW",                   done: false, critical: true },
        { id: "w5_report",     label: "Public beta report → Full launch go/no-go",                   done: false, critical: true },
      ],
    },
    w6plus: {
      id: "w6plus", label: "Week 6+ — Scale",
      description: "Revenue optimization. Conversion optimization. Customer success. Scale.",
      status: "pending",
      items: [
        { id: "w6_revenue",    label: "Revenue: 20 paying users (₹999+/month)",               done: false, critical: true },
        { id: "w6_conversion", label: "Trial→Paid conversion funnel optimized (target 20%)",  done: false, critical: true },
        { id: "w6_cs",         label: "CS: every user has a success plan, <24h response SLA", done: false, critical: true },
        { id: "w6_nps50",      label: "NPS > 50 sustained across 100+ users",                 done: false, critical: true },
        { id: "w6_dau",        label: "DAU ≥ 60 (60% of registered users active daily)",      done: false, critical: true },
        { id: "w6_adoption",   label: "Feature adoption > 60% (avg user uses 4+ features)",   done: false, critical: true },
        { id: "w6_referral",   label: "Organic referrals: 20% of new signups from referral",  done: false, critical: false },
        { id: "w6_mrr",        label: "MRR ≥ ₹20,000 (20 × ₹999)",                          done: false, critical: true },
        { id: "w6_launched",   label: "Company officially launched — announce publicly",       done: false, critical: true },
      ],
    },
  };
}

function _defaultKPIs() {
  return {
    active_users:     { label: "Active Users",       target: 100, current: 0, unit: "users"   },
    paying_users:     { label: "Paying Users",        target: 20,  current: 0, unit: "users"   },
    nps:              { label: "NPS Score",           target: 50,  current: null, unit: "score" },
    dau:              { label: "Daily Active Users",  target: 60,  current: 0, unit: "users"   },
    feature_adoption: { label: "Feature Adoption",   target: 60,  current: 0, unit: "%"       },
    organic_referrals:{ label: "Organic Referrals",  target: 20,  current: 0, unit: "users"   },
    mrr:              { label: "MRR (₹)",            target: 20000,current: 0, unit: "₹"      },
  };
}

// ── Week operations ────────────────────────────────────────────────────────────

function getWeekStatus(weekId) {
  const s = _load();
  const week = s.weeks[weekId];
  if (!week) throw new Error(`Unknown week: ${weekId}`);
  const items    = week.items;
  const done     = items.filter(i => i.done).length;
  const critical = items.filter(i => i.critical);
  const critDone = critical.filter(i => i.done).length;
  const score    = items.length ? Math.round(done / items.length * 100) : 0;
  const critScore= critical.length ? Math.round(critDone / critical.length * 100) : 100;
  return { ...week, done, total: items.length, score, critScore, critDone, critTotal: critical.length };
}

function updateWeekItem(weekId, itemId, done, note) {
  const s = _load();
  const week = s.weeks[weekId];
  if (!week) throw new Error(`Unknown week: ${weekId}`);
  const item = week.items.find(i => i.id === itemId);
  if (!item) throw new Error(`Unknown item: ${itemId}`);
  item.done    = !!done;
  item.doneAt  = done ? _ts() : null;
  item.note    = note || item.note || null;
  // Auto-advance week status
  const critDone = week.items.filter(i => i.critical && i.done).length;
  const critTotal = week.items.filter(i => i.critical).length;
  if (critDone === critTotal && critTotal > 0) week.status = "complete";
  else if (week.items.some(i => i.done)) week.status = "in_progress";
  _save(s);
  return getWeekStatus(weekId);
}

function activateWeek(weekId) {
  const s = _load();
  if (!s.weeks[weekId]) throw new Error(`Unknown week: ${weekId}`);
  s.weeks[weekId].status = "in_progress";
  s.weeks[weekId].startedAt = _ts();
  _save(s);
  return s.weeks[weekId];
}

// ── Escape log (Week 2) ───────────────────────────────────────────────────────

const ESCAPE_CATEGORIES = [
  "used_external_ide", "used_chatgpt_web", "used_google_sheets", "used_slack",
  "used_linear", "used_notion", "used_figma", "used_zapier", "friction_too_high", "feature_missing",
];

function logEscape(opts = {}) {
  const s = _load();
  const escape = {
    id:          _id("esc"),
    date:        _today(),
    category:    opts.category    || "friction_too_high",
    description: opts.description || "",
    tool:        opts.tool        || "",
    severity:    opts.severity    || "medium",
    blocked:     opts.blocked     !== false,
    fixedAt:     null,
    createdAt:   _ts(),
  };
  s.escapes.push(escape);
  _save(s);
  return escape;
}

function resolveEscape(id) {
  const s = _load();
  const esc = s.escapes.find(e => e.id === id);
  if (!esc) throw new Error(`Escape not found: ${id}`);
  esc.fixedAt = _ts();
  _save(s);
  return esc;
}

function getEscapes() {
  const s = _load();
  const escapes = s.escapes || [];
  const byCategory = {};
  for (const e of escapes) {
    byCategory[e.category] = (byCategory[e.category] || 0) + 1;
  }
  return {
    escapes: escapes.slice(-50),
    total:   escapes.length,
    unresolved: escapes.filter(e => !e.fixedAt).length,
    byCategory,
    ESCAPE_CATEGORIES,
  };
}

// ── Blocker log ───────────────────────────────────────────────────────────────

const BLOCKER_SEVERITIES = ["P0", "P1", "P2", "P3"];

function reportBlocker(opts = {}) {
  const s = _load();
  const blocker = {
    id:          _id("blk"),
    title:       opts.title       || "Untitled blocker",
    description: opts.description || "",
    severity:    opts.severity    || "P1",
    week:        opts.week        || "w1",
    module:      opts.module      || "",
    status:      "open",
    fixedAt:     null,
    createdAt:   _ts(),
  };
  s.blockers.push(blocker);
  _save(s);
  return blocker;
}

function resolveBlocker(id) {
  const s = _load();
  const b = s.blockers.find(b => b.id === id);
  if (!b) throw new Error(`Blocker not found: ${id}`);
  b.status  = "resolved";
  b.fixedAt = _ts();
  _save(s);
  return b;
}

function getBlockers(filter = {}) {
  const s       = _load();
  const blockers = s.blockers || [];
  let filtered  = blockers;
  if (filter.status) filtered = filtered.filter(b => b.status === filter.status);
  if (filter.week)   filtered = filtered.filter(b => b.week   === filter.week);
  const bySev   = {};
  for (const b of blockers) bySev[b.severity] = (bySev[b.severity] || 0) + 1;
  return {
    blockers: filtered.sort((a, b) => {
      const ord = { P0: 0, P1: 1, P2: 2, P3: 3 };
      return (ord[a.severity] || 99) - (ord[b.severity] || 99);
    }),
    total:    blockers.length,
    open:     blockers.filter(b => b.status === "open").length,
    p0Open:   blockers.filter(b => b.severity === "P0" && b.status === "open").length,
    bySev,
    BLOCKER_SEVERITIES,
  };
}

// ── Daily release log ─────────────────────────────────────────────────────────

function logRelease(opts = {}) {
  const s = _load();
  const release = {
    id:      _id("rel"),
    date:    _today(),
    version: opts.version || "",
    notes:   opts.notes   || "",
    fixes:   opts.fixes   || [],
    week:    opts.week    || "w3",
    shippedAt: _ts(),
  };
  s.dailyReleases.push(release);
  _save(s);
  return release;
}

function getReleases() {
  const s = _load();
  return {
    releases: (s.dailyReleases || []).slice(-30),
    total:    (s.dailyReleases || []).length,
    thisWeek: (s.dailyReleases || []).filter(r => {
      const d = new Date(r.shippedAt);
      const now = new Date();
      const weekStart = new Date(now - 7 * 24 * 3600_000);
      return d >= weekStart;
    }).length,
  };
}

// ── KPI tracking ──────────────────────────────────────────────────────────────

function updateKPI(kpiId, value) {
  const s = _load();
  if (!s.successKPIs[kpiId]) throw new Error(`Unknown KPI: ${kpiId}`);
  s.successKPIs[kpiId].current   = value;
  s.successKPIs[kpiId].updatedAt = _ts();
  _save(s);
  return s.successKPIs[kpiId];
}

function _computeKPIs(s) {
  // Pull live data from existing services where possible
  const kpis = { ...s.successKPIs };

  // Active users from accounts
  try {
    const accounts = _rj(path.join(ROOT, "data/local-accounts.json"), []);
    const list = Array.isArray(accounts) ? accounts : Object.values(accounts);
    kpis.active_users.current = list.length;
  } catch { /* non-fatal */ }

  // Paying users from billing
  try {
    const billing = _rj(path.join(ROOT, "data/billing.json"), {});
    const paid = Object.values(billing).filter(a => !["trial", "free", "cancelled"].includes(a.plan || "trial")).length;
    kpis.paying_users.current = paid;
    const prices = { starter: 999, growth: 2499, scale: 9999 };
    kpis.mrr.current = Object.values(billing).reduce((s, a) => s + (prices[a.plan] || 0), 0);
  } catch { /* non-fatal */ }

  // NPS from launchMetrics
  try {
    const lm = require("./launchMetrics.cjs");
    const nps = lm.getNPS();
    if (nps?.avg !== undefined) kpis.nps.current = Math.round(nps.avg);
  } catch { /* non-fatal */ }

  // Feature adoption from CO3 usage insights
  try {
    const co3 = require("./co3UserSuccess.cjs");
    const usage = co3.getUsageInsights();
    if (usage?.latest?.featureFreq) {
      const userFeatureCounts = {};
      const featureFreq = usage.latest.featureFreq;
      // If we tracked events, estimate avg features per user
      const uniqueUsers = usage.latest.uniqueAccounts || 1;
      const featuresUsed = Object.keys(featureFreq).length;
      // Feature adoption % = (features with >0 uses / total features)
      kpis.feature_adoption.current = Math.min(100, Math.round(featuresUsed / 16 * 100));
    }
  } catch { /* non-fatal */ }

  // Organic referrals from CO3 invite system
  try {
    const co3 = require("./co3UserSuccess.cjs");
    const invites = co3.getInviteDashboard();
    kpis.organic_referrals.current = invites.totalActivations || 0;
  } catch { /* non-fatal */ }

  return kpis;
}

function getKPIDashboard() {
  const s    = _load();
  const kpis = _computeKPIs(s);
  const entries = Object.entries(kpis).map(([id, kpi]) => {
    const pct = kpi.target ? Math.min(100, Math.round((kpi.current || 0) / kpi.target * 100)) : 0;
    return { id, ...kpi, progressPct: pct, met: pct >= 100, current: kpi.current ?? 0 };
  });
  const metCount = entries.filter(e => e.met).length;
  const launched = metCount >= 5 && (kpis.paying_users?.current >= 20) && (kpis.nps?.current >= 50);
  return {
    kpis: entries,
    metCount,
    totalKPIs: entries.length,
    launchScore: Math.round(metCount / entries.length * 100),
    officiallyLaunched: launched,
    SUCCESS_DEFINITION: {
      active_users: "100 Active Users",
      paying_users: "20 Paying Users",
      nps:          "NPS > 50",
      dau:          "Daily Active Usage",
      adoption:     "Feature Adoption > 60%",
      referrals:    "Organic Referrals",
      launched:     "Company Officially Launched",
    },
    checkedAt: _ts(),
  };
}

// ── Launch log ────────────────────────────────────────────────────────────────

function logLaunchEvent(opts = {}) {
  const s = _load();
  const event = {
    id:   _id("le"),
    type: opts.type    || "milestone",
    body: opts.body    || "",
    week: opts.week    || null,
    milestone: opts.milestone || null,
    ts: _ts(),
  };
  s.launchLog.push(event);
  if (s.launchLog.length > 200) s.launchLog = s.launchLog.slice(-200);
  _save(s);
  return event;
}

function getLaunchLog() {
  const s = _load();
  return { events: (s.launchLog || []).slice(-50), total: (s.launchLog || []).length };
}

// ── Executive summary ─────────────────────────────────────────────────────────

function getExecutive() {
  const s    = _load();
  const weeks = ["w1", "w2", "w3", "w4", "w5", "w6plus"].map(id => getWeekStatus(id));
  const kpis = getKPIDashboard();
  const blockers = getBlockers();
  const escapes = getEscapes();

  const currentWeek = weeks.find(w => w.status === "in_progress") || weeks[0];
  const completedWeeks = weeks.filter(w => w.status === "complete").length;
  const overallScore   = Math.round(weeks.reduce((s, w) => s + w.score, 0) / weeks.length);

  // Live system health from CO1/CO2/CO3
  let systemHealth = null;
  try {
    const pi = require("./productionInfra.cjs");
    const bm = pi.runBenchmark();
    systemHealth = { score: bm.score, regressionPass: bm.regressionPass };
  } catch { /* non-fatal */ }

  return {
    ok: true,
    programTitle:   "OP-1 — Ooplix Public Launch",
    currentWeek:    currentWeek?.id,
    currentWeekLabel: currentWeek?.label,
    completedWeeks,
    totalWeeks:     weeks.length,
    overallScore,
    weeks:          weeks.map(w => ({ id: w.id, label: w.label, status: w.status, score: w.score, critScore: w.critScore })),
    kpis:           kpis.kpis,
    launchScore:    kpis.launchScore,
    officiallyLaunched: kpis.officiallyLaunched,
    blockers: { total: blockers.total, open: blockers.open, p0: blockers.p0Open },
    escapes:  { total: escapes.total, unresolved: escapes.unresolved },
    systemHealth,
    checkedAt: _ts(),
  };
}

// ── Benchmark ─────────────────────────────────────────────────────────────────

function runBenchmark() {
  const checks = [
    {
      id: "week_structure", label: "6-week launch program structure (W1–W5 + W6+)",
      run: () => {
        const s = _load();
        const weekIds = ["w1","w2","w3","w4","w5","w6plus"];
        return weekIds.every(id => s.weeks[id] && s.weeks[id].items.length >= 5);
      },
    },
    {
      id: "w1_verify", label: "Week 1: Deploy + verify backups/billing/AI/monitoring checklist",
      run: () => {
        const w = getWeekStatus("w1");
        return w.total >= 8 && w.critTotal >= 5 && Array.isArray(w.items);
      },
    },
    {
      id: "w2_founder", label: "Week 2: 14-day founder dogfood — escape logging + blocker tracking",
      run: () => {
        const esc = logEscape({ category: "friction_too_high", description: "benchmark test escape", severity: "low" });
        const esc2 = resolveEscape(esc.id);
        const blk  = reportBlocker({ title: "benchmark blocker", severity: "P2", week: "w2" });
        resolveBlocker(blk.id);
        const escData = getEscapes();
        const blkData = getBlockers();
        return !!esc.id && esc2.fixedAt && escData.ESCAPE_CATEGORIES.length >= 8 && blkData.BLOCKER_SEVERITIES.length >= 4;
      },
    },
    {
      id: "w3_alpha", label: "Week 3: Alpha release cadence — daily release logging",
      run: () => {
        logRelease({ version: "1.0.1-alpha", notes: "Benchmark test release", week: "w3", fixes: ["test fix 1"] });
        const r = getReleases();
        const w = getWeekStatus("w3");
        return r.total >= 1 && w.total >= 8 && Array.isArray(w.items);
      },
    },
    {
      id: "w4_beta", label: "Week 4: Closed Beta — NPS/activation/retention/revenue items",
      run: () => {
        const w = getWeekStatus("w4");
        return w.total >= 8 && w.critTotal >= 6 &&
          w.items.some(i => i.id.includes("nps")) &&
          w.items.some(i => i.id.includes("activation")) &&
          w.items.some(i => i.id.includes("revenue"));
      },
    },
    {
      id: "w5_public", label: "Week 5: Public Beta — website/docs/community/referral/organic",
      run: () => {
        const w = getWeekStatus("w5");
        return w.total >= 8 && w.critTotal >= 4 &&
          w.items.some(i => i.id.includes("website")) &&
          w.items.some(i => i.id.includes("docs")) &&
          w.items.some(i => i.id.includes("community")) &&
          w.items.some(i => i.id.includes("referral"));
      },
    },
    {
      id: "w6_scale", label: "Week 6+: Revenue/conversion/CS/scale — 9 scale items",
      run: () => {
        const w = getWeekStatus("w6plus");
        return w.total >= 7 && w.items.some(i => i.id.includes("revenue")) &&
          w.items.some(i => i.id.includes("conversion")) &&
          w.items.some(i => i.id.includes("nps50"));
      },
    },
    {
      id: "kpi_definition", label: "Success definition: 100 users / 20 paying / NPS>50 / DAU / adoption / referrals",
      run: () => {
        const kpis = getKPIDashboard();
        return kpis.totalKPIs >= 6 &&
          kpis.kpis.some(k => k.id === "active_users"  && k.target === 100) &&
          kpis.kpis.some(k => k.id === "paying_users"  && k.target === 20) &&
          kpis.kpis.some(k => k.id === "nps"           && k.target === 50) &&
          kpis.kpis.some(k => k.id === "feature_adoption" && k.target === 60) &&
          kpis.kpis.some(k => k.id === "mrr"           && k.target === 20000);
      },
    },
    {
      id: "week_item_ops", label: "Week item update (tick/untick) + activate week operations",
      run: () => {
        activateWeek("w1");
        const w = getWeekStatus("w1");
        updateWeekItem("w1", "w1_deploy", true, "benchmark: marked done");
        const w2 = getWeekStatus("w1");
        updateWeekItem("w1", "w1_deploy", false);
        return w.status === "in_progress" && w2.done === 1;
      },
    },
    {
      id: "executive_view", label: "Executive view: current week, KPIs, blockers, escapes, system health",
      run: () => {
        const exec = getExecutive();
        return exec.ok && exec.weeks.length === 6 && typeof exec.overallScore === "number" &&
          typeof exec.launchScore === "number" && Array.isArray(exec.kpis);
      },
    },
    {
      id: "launch_log", label: "Launch event log: milestone + activity feed",
      run: () => {
        logLaunchEvent({ type: "milestone", body: "Benchmark: OP-1 launch operations verified", week: "w1" });
        const log = getLaunchLog();
        return log.total >= 1 && Array.isArray(log.events);
      },
    },
  ];

  const results = checks.map(c => {
    try   { const ok = !!c.run(); return { id: c.id, label: c.label, ok, error: null }; }
    catch (e) { return { id: c.id, label: c.label, ok: false, error: e.message }; }
  });

  const passing = results.filter(r => r.ok).length;
  const score   = Math.round(passing / results.length * 100);
  return {
    score,
    passing,
    total:          results.length,
    launchReadiness: score === 100 ? "launch_operations_ready" : score >= 80 ? "nearly_ready" : "needs_work",
    regressionPass:  passing === results.length,
    checks:          results,
    runAt:           _ts(),
  };
}

module.exports = {
  // Week management
  getWeekStatus, updateWeekItem, activateWeek,
  // Escape log
  logEscape, resolveEscape, getEscapes, ESCAPE_CATEGORIES,
  // Blocker log
  reportBlocker, resolveBlocker, getBlockers, BLOCKER_SEVERITIES,
  // Releases
  logRelease, getReleases,
  // KPIs
  updateKPI, getKPIDashboard,
  // Launch log
  logLaunchEvent, getLaunchLog,
  // Executive
  getExecutive,
  // Benchmark
  runBenchmark,
};
