/**
 * Knowledge Base — structured store for facts, FAQs, and system knowledge.
 * Persists to data/knowledge-base.json.
 */

const fs   = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "../../data/knowledge-base.json");

const SEED = [
    { key: "jarvis_purpose",    category: "system",   content: "Jarvis OS is an AI automation platform. Send a command → AI understands → routes to the right agent → executes and replies." },
    { key: "pricing",           category: "business", content: "Plans: Free (basic), Pro ₹999/month (all AI agents + WhatsApp), Premium ₹2999/month (everything + priority support + custom agents)." },
    { key: "payment_methods",   category: "business", content: "Payments via Razorpay — UPI, cards, net banking. Request a payment link to get one instantly." },
    { key: "cancellation",      category: "business", content: "Cancel anytime, no lock-in. Access continues until end of billing period." },
    { key: "whatsapp",          category: "feature",  content: "Jarvis sends WhatsApp messages, follow-ups, campaigns, and payment links automatically via WhatsApp Business API." },
    { key: "leads_generation",  category: "feature",  content: "Jarvis scrapes leads from Google Maps, LinkedIn, and Fiverr based on niche + location." },
    { key: "data_safety",       category: "security", content: "All data stored locally on your server. No sharing of leads, payments, or conversations with third parties." },
    { key: "dev_agents",        category: "feature",  content: "Dev agents: Code Generator, Debugger, API Builder, Database, Firebase, Deployment, Version Control, Test Runner, Optimizer, Security Scanner." },
    { key: "business_agents",   category: "feature",  content: "Business agents: Payment, Subscription, Revenue, CRM, Marketing, SEO, Content, Analytics, Growth, Support." },
    { key: "refund_policy",     category: "business", content: "7-day refund if not satisfied. Contact support within 7 days of purchase." }
];

function _load() {
    try {
        if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, "utf8"));
    } catch { /* start fresh */ }
    // Seed with defaults
    const defaultKB = SEED.map(s => ({ ...s, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), uses: 0 }));
    _flush(defaultKB);
    return defaultKB;
}

function _flush(entries) {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(entries, null, 2));
}

let _cache = null;
function _kb() {
    if (!_cache) _cache = _load();
    return _cache;
}

function add(key, content, category = "general") {
    const kb = _kb();
    const exists = kb.findIndex(e => e.key === key);
    const now    = new Date().toISOString();
    if (exists >= 0) {
        kb[exists] = { ...kb[exists], content, category, updatedAt: now };
    } else {
        kb.push({ key, content, category, createdAt: now, updatedAt: now, uses: 0 });
    }
    _flush(kb);
    return { key, content, category };
}

function get(key) {
    const entry = _kb().find(e => e.key === key);
    if (entry) { entry.uses++; _flush(_kb()); }
    return entry || null;
}

function remove(key) {
    const kb  = _kb();
    const idx = kb.findIndex(e => e.key === key);
    if (idx < 0) return false;
    kb.splice(idx, 1);
    _flush(kb);
    _cache = kb;
    return true;
}

function list(category) {
    const kb = _kb();
    return category ? kb.filter(e => e.category === category) : [...kb];
}

/** Keyword search over key + content fields. */
function search(query, limit = 5) {
    const q  = query.toLowerCase();
    const kb = _kb();
    const scored = kb.map(e => {
        const text  = `${e.key} ${e.content}`.toLowerCase();
        const words = q.split(/\s+/).filter(w => w.length > 2);
        const hits  = words.filter(w => text.includes(w)).length;
        return { ...e, _score: hits / Math.max(words.length, 1) };
    });
    return scored
        .filter(e => e._score > 0)
        .sort((a, b) => b._score - a._score)
        .slice(0, limit)
        .map(({ _score, ...e }) => e);
}

function stats() {
    const kb = _kb();
    const cats = {};
    for (const e of kb) cats[e.category] = (cats[e.category] || 0) + 1;
    return { total: kb.length, categories: cats };
}

module.exports = { add, get, remove, list, search, stats };
