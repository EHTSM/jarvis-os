"use strict";
/**
 * knowledgeExchangeEngine.cjs — POST-Ω P14 Universal Knowledge Network
 *
 * Enables structured knowledge sharing between:
 *   Engineering ↔ Business ↔ Design ↔ Research ↔ Customer ↔ Marketplace ↔ Platform
 *
 * Exchange = pull knowledge from one domain, normalize, publish to another.
 * Does NOT duplicate storage — creates exchange records pointing at source items.
 *
 * Storage: data/knowledge-exchange.json
 */

const fs   = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "knowledge-exchange.json");

const _try = fn => { try { return fn(); } catch { return null; } };

const _cle  = () => _try(() => require("./continuousLearningEngine.cjs"));
const _rke  = () => _try(() => require("./researchKnowledgeEngine.cjs"));
const _obi  = () => _try(() => require("./businessReasoningEngine.cjs"));
const _oai  = () => _try(() => require("./engineeringReasoningEngine.cjs"));
const _mce  = () => _try(() => require("./marketplaceCatalogEngine.cjs"));
const _cje  = () => _try(() => require("./customerJourneyEngine.cjs"));
const _pb   = () => _try(() => require("./productionBibleEngine.cjs"));
const _err  = () => _try(() => require("./engineeringRuleRegistry.cjs"));
const _kqe  = () => _try(() => require("./knowledgeQualityEngine.cjs"));
const _kre  = () => _try(() => require("./knowledgeReasoningEngine.cjs"));
const _dt   = () => _try(() => require("./digitalTwinEngine.cjs"));
const _sie  = () => _try(() => require("./selfImprovementEngine.cjs"));
const _kfe  = () => _try(() => require("./knowledgeFederationEngine.cjs"));
const _kgov = () => _try(() => require("./knowledgeGovernanceEngine.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `kex_${Date.now()}_${Math.random().toString(36).slice(2,6)}`; }

const EXCHANGE_DOMAINS = ["engineering", "business", "design", "research", "customer", "marketplace", "platform"];

// Predefined exchange channels
const EXCHANGE_CHANNELS = [
  { id: "eng_to_biz",   from: "engineering", to: "business",    desc: "Engineering patterns → Business intelligence" },
  { id: "res_to_mkt",   from: "research",    to: "marketplace",  desc: "Research findings → Marketplace knowledge packs" },
  { id: "cust_to_prod", from: "customer",    to: "platform",     desc: "Customer signals → Platform improvements" },
  { id: "biz_to_eng",   from: "business",    to: "engineering",  desc: "Business decisions → Engineering priorities" },
  { id: "eng_to_res",   from: "engineering", to: "research",     desc: "Engineering learnings → Research radar" },
  { id: "mkt_to_all",   from: "marketplace", to: "platform",     desc: "Marketplace trends → Platform strategy" },
  { id: "des_to_eng",   from: "design",      to: "engineering",  desc: "Design quality → Engineering standards" },
];

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  const defaults = {
    exchanges:  [],
    stats:      { total: 0, byChannel: {}, itemsExchanged: 0, minutesSaved: 0 },
    updatedAt:  null,
  };
  try {
    const d = JSON.parse(fs.readFileSync(DATA, "utf8"));
    if (!Array.isArray(d.exchanges)) return defaults;
    return d;
  } catch { return defaults; }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.exchanges.length > 2000) d.exchanges = d.exchanges.slice(-2000);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Channel executors ─────────────────────────────────────────────────────────

function _runChannel(channelId) {
  const runners = {
    eng_to_biz: () => {
      const s   = _oai()?.getStats?.() || {};
      const biz = _obi()?.getStats?.() || {};
      const items = [];
      if ((s.total || 0) > 0) {
        items.push({ ref: "engineering_analyses", count: s.total, payload: { avgScore: s.avgScore } });
      }
      const errStats = _err()?.getStats?.() || {};
      if ((errStats.total || 0) > 0) {
        items.push({ ref: "engineering_rules", count: errStats.total, payload: errStats });
      }
      return { items, minutesSaved: items.length * 15 };
    },

    res_to_mkt: () => {
      const rke = _rke()?.getStats?.() || {};
      const mkt = _mce()?.listAssets?.({ type: "knowledge_pack", limit: 5 })?.total || 0;
      const items = [];
      if ((rke.findingsIndexed || 0) > 0) {
        items.push({ ref: "research_findings", count: rke.findingsIndexed, payload: { recs: rke.recommendationsGenerated } });
        items.push({ ref: "marketplace_knowledge_packs", count: mkt, payload: {} });
      }
      return { items, minutesSaved: items.length * 20 };
    },

    cust_to_prod: () => {
      const s = _cje()?.getStats?.() || {};
      const items = [];
      if ((s.total || 0) > 0) {
        items.push({ ref: "customer_journeys", count: s.total, payload: { stages: s.byStage } });
      }
      return { items, minutesSaved: items.length * 10 };
    },

    biz_to_eng: () => {
      const s   = _obi()?.getStats?.() || {};
      const cle = _cle()?.getStats?.() || {};
      const items = [];
      if ((s.total || 0) > 0) {
        items.push({ ref: "business_analyses", count: s.total, payload: {} });
      }
      const founder_actions = cle.lessonsByType?.founder_action || 0;
      if (founder_actions > 0) {
        items.push({ ref: "founder_action_lessons", count: founder_actions, payload: {} });
      }
      return { items, minutesSaved: items.length * 15 };
    },

    eng_to_res: () => {
      const s  = _cle()?.getStats?.() || {};
      const rke = _rke()?.getStats?.() || {};
      const items = [];
      const eng = s.lessonsByType?.engineering_playbook || 0;
      if (eng > 0) {
        items.push({ ref: "engineering_playbooks", count: eng, payload: {} });
      }
      if ((rke.radarEntries || 0) > 0) {
        items.push({ ref: "research_radar", count: rke.radarEntries, payload: {} });
      }
      return { items, minutesSaved: items.length * 25 };
    },

    mkt_to_all: () => {
      const mkt  = _mce()?.getStats?.() || {};
      const items = [];
      if ((mkt.total || 0) > 0) {
        items.push({ ref: "marketplace_catalog", count: mkt.total, payload: { byType: mkt.byType } });
      }
      return { items, minutesSaved: items.length * 10 };
    },

    des_to_eng: () => {
      const s  = _kqe()?.getStats?.() || {};
      const items = [];
      if ((s.total || 0) > 0) {
        items.push({ ref: "knowledge_quality_scores", count: s.total, payload: { avg: s.avgScore } });
      }
      return { items, minutesSaved: items.length * 12 };
    },
  };

  try {
    const runner = runners[channelId];
    if (!runner) return { items: [], minutesSaved: 0 };
    return runner();
  } catch {
    return { items: [], minutesSaved: 0 };
  }
}

// ── Core: exchange ────────────────────────────────────────────────────────────

function exchange(channelId, { context } = {}) {
  const channel = EXCHANGE_CHANNELS.find(c => c.id === channelId);
  if (!channel) return { ok: false, error: `unknown channel: ${channelId}` };

  const result = _runChannel(channelId);
  const record = {
    id: _id(), channelId, channelDesc: channel.desc,
    from: channel.from, to: channel.to,
    itemsExchanged: result.items.length,
    minutesSaved:   result.minutesSaved,
    items:          result.items,
    context:        context || {},
    exchangedAt:    _ts(),
  };

  const d = _load();
  d.exchanges.push(record);

  // Update stats
  const byChannel = {};
  EXCHANGE_CHANNELS.forEach(c => { byChannel[c.id] = 0; });
  d.exchanges.forEach(e => { if (byChannel[e.channelId] !== undefined) byChannel[e.channelId]++; });
  d.stats = {
    total: d.exchanges.length,
    byChannel,
    itemsExchanged: d.exchanges.reduce((s, e) => s + e.itemsExchanged, 0),
    minutesSaved:   d.exchanges.reduce((s, e) => s + e.minutesSaved, 0),
  };
  _save(d);

  return { ok: true, exchange: record };
}

function runAllChannels({ context } = {}) {
  const results = EXCHANGE_CHANNELS.map(c => exchange(c.id, { context }));
  const success = results.filter(r => r.ok).length;
  return {
    ok:      true,
    total:   results.length,
    success,
    failed:  results.length - success,
    results: results.map(r => ({ channelId: r.exchange?.channelId, ok: r.ok, items: r.exchange?.itemsExchanged || 0 })),
    totalItemsExchanged: results.reduce((s, r) => s + (r.exchange?.itemsExchanged || 0), 0),
    totalMinutesSaved:   results.reduce((s, r) => s + (r.exchange?.minutesSaved || 0), 0),
  };
}

function getExchange(id) {
  return _load().exchanges.find(e => e.id === id) || null;
}

function listExchanges({ channelId, from, to, limit = 50 } = {}) {
  let exs = _load().exchanges;
  if (channelId) exs = exs.filter(e => e.channelId === channelId);
  if (from)      exs = exs.filter(e => e.from === from);
  if (to)        exs = exs.filter(e => e.to === to);
  return { ok: true, exchanges: exs.slice(-limit), total: exs.length };
}

function getStats() {
  const d = _load();
  return { ...d.stats, EXCHANGE_CHANNELS: EXCHANGE_CHANNELS.length, EXCHANGE_DOMAINS, updatedAt: d.updatedAt };
}

module.exports = {
  EXCHANGE_DOMAINS,
  EXCHANGE_CHANNELS,
  exchange,
  runAllChannels,
  getExchange,
  listExchanges,
  getStats,
};
