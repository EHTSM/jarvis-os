/**
 * Product Listing Agent — creates structured marketplace-ready listings.
 * Integrates with ecommerceManager to persist products.
 */

const groq              = require("../core/groqClient.cjs");
const ecommerceManager  = require("./ecommerceManager.cjs");

const SYSTEM = `You are an e-commerce product listing specialist.
Create compelling, SEO-optimized product listings.
Respond ONLY with valid JSON.`;

const CATEGORIES = ["Electronics","Fashion","Home & Kitchen","Health","Books","Software","Digital Services","AI Tools","Education","Other"];

function _templateListing(name, price, category, features = []) {
    return {
        name,
        price,
        category:    category || "Other",
        sku:         `SKU-${name.replace(/\s+/g, "-").toUpperCase().slice(0, 10)}-${Date.now().toString().slice(-4)}`,
        title:       `${name} — Professional Grade Solution`,
        subtitle:    `The #1 Choice for [Target Audience]`,
        bullet1:     features[0] || `✅ [Key benefit 1 of ${name}]`,
        bullet2:     features[1] || `✅ [Key benefit 2 — faster/better/cheaper]`,
        bullet3:     features[2] || `✅ [Key benefit 3 — guarantee or proof]`,
        bullet4:     features[3] || `✅ 24/7 support included`,
        keywords:    [name.toLowerCase(), category.toLowerCase(), "best", "professional", "buy online"],
        targetAudience: "Small business owners and entrepreneurs",
        searchTerms: `${name} buy online | best ${category} | ${name} for business`
    };
}

async function create({ name, price, category = "Other", features = [], stock = 0, saveToStore = true }) {
    if (!name || !price) throw new Error("name and price required");

    let listing;
    try {
        const prompt = `Create a product listing for "${name}" (${category}, ₹${price}).
Features: ${features.join(", ") || "not specified"}.
JSON: { "title": "...", "subtitle": "...", "sku": "AUTO", "bullet1": "...", "bullet2": "...", "bullet3": "...", "keywords": ["kw1","kw2"], "targetAudience": "...", "searchTerms": "..." }`;
        const raw  = await groq.chat(SYSTEM, prompt, { maxTokens: 600 });
        const data = groq.parseJson(raw);
        listing    = { name, price, category, sku: `SKU-${Date.now()}`, stock, ...data };
    } catch {
        listing = { name, price, category, stock, ..._templateListing(name, price, category, features) };
    }

    if (saveToStore) {
        const saved = ecommerceManager.addProduct({ name: listing.title || name, price, category, sku: listing.sku, stock, description: `${listing.bullet1} ${listing.bullet2}` });
        listing.productId = saved.id;
    }

    return listing;
}

async function run(task) {
    const p = task.payload || {};
    if (!p.name) return { success: false, type: "business_pro", agent: "productListingAgent", data: { error: "name required" } };

    try {
        const data = await create({ name: p.name, price: p.price || 0, category: p.category, features: p.features || [], stock: p.stock || 0, saveToStore: p.save !== false });
        return { success: true, type: "business_pro", agent: "productListingAgent", data };
    } catch (err) {
        return { success: false, type: "business_pro", agent: "productListingAgent", data: { error: err.message } };
    }
}

module.exports = { create, run };
