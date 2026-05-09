/**
 * Supplier Finder Agent — searches mock + configurable supplier database.
 * Extendable: add real supplier APIs via SUPPLIER_APIS env config.
 */

const groq = require("../core/groqClient.cjs");

const SYSTEM = `You are a sourcing expert. Find the best suppliers for products.
Respond ONLY with valid JSON.`;

// Mock supplier database (realistic data)
const MOCK_SUPPLIERS = [
    { id: "sup-001", name: "TechParts India",     categories: ["Electronics","Components"],       moq: 50,  priceRange: "₹50-500",    leadDays: 7,  rating: 4.5, location: "Shenzhen / Mumbai", contact: "techparts@example.com" },
    { id: "sup-002", name: "FashionWholesale Co", categories: ["Fashion","Apparel","Accessories"], moq: 100, priceRange: "₹100-2000",  leadDays: 5,  rating: 4.2, location: "Surat / Delhi",     contact: "fashion@example.com" },
    { id: "sup-003", name: "HomeGoods Direct",    categories: ["Home & Kitchen","Furniture"],      moq: 20,  priceRange: "₹200-5000",  leadDays: 10, rating: 4.0, location: "Rajkot / Pune",     contact: "homegoods@example.com" },
    { id: "sup-004", name: "DigitalSoft Hub",     categories: ["Software","Digital Services","AI Tools"], moq: 1, priceRange: "₹0-custom", leadDays: 1, rating: 4.8, location: "Remote",       contact: "digital@example.com" },
    { id: "sup-005", name: "HealthVitals Supply", categories: ["Health","Wellness","Supplements"], moq: 200, priceRange: "₹30-1000",   leadDays: 14, rating: 3.9, location: "Hyderabad",        contact: "health@example.com" },
    { id: "sup-006", name: "BookWorld Wholesale", categories: ["Books","Education","Stationery"],  moq: 10,  priceRange: "₹50-500",    leadDays: 3,  rating: 4.6, location: "Chennai / Kolkata", contact: "books@example.com" },
    { id: "sup-007", name: "Alibaba Express IN",  categories: ["Electronics","Fashion","Home & Kitchen","Other"], moq: 1, priceRange: "₹20-10000", leadDays: 20, rating: 4.3, location: "China / Global", contact: "alibaba@example.com" },
    { id: "sup-008", name: "MadeInIndia Crafts",  categories: ["Handicrafts","Fashion","Home & Kitchen"], moq: 5, priceRange: "₹150-3000", leadDays: 7, rating: 4.7, location: "Jaipur / Varanasi", contact: "craft@example.com" }
];

function _searchMock(category, query = "") {
    const q = query.toLowerCase();
    return MOCK_SUPPLIERS.filter(s => {
        const catMatch   = !category || s.categories.some(c => c.toLowerCase().includes(category.toLowerCase()) || category.toLowerCase().includes(c.toLowerCase()));
        const queryMatch = !q || s.name.toLowerCase().includes(q) || s.categories.some(c => c.toLowerCase().includes(q));
        return catMatch || queryMatch;
    }).slice(0, 5);
}

async function findSuppliers({ category = "", product = "", budget = "", moq = 0 }) {
    const mockResults = _searchMock(category, product);

    let aiSuggestions = [];
    try {
        const prompt = `Find 3 supplier recommendations for: product="${product}", category="${category}", budget="${budget}", MOQ=${moq}.
JSON: { "suppliers": [{ "name": "...", "type": "...", "moq": N, "priceRange": "...", "leadDays": N, "pros": "...", "cons": "...", "contact": "..." }], "sourcing_tips": ["..."] }`;
        const raw    = await groq.chat(SYSTEM, prompt, { maxTokens: 600 });
        const parsed = groq.parseJson(raw);
        aiSuggestions = parsed.suppliers || [];
    } catch { /* use mock only */ }

    return {
        query: { category, product, budget, moq },
        mockSuppliers: mockResults,
        aiSuggestions,
        sourcingTips: [
            "Always request 3 samples before committing to a large order",
            "Negotiate Net-30 payment terms once trust is established",
            "Check GST registration and business license before payment",
            "Start with 2× MOQ to test quality before scaling"
        ]
    };
}

async function run(task) {
    const p = task.payload || {};
    try {
        const data = await findSuppliers({ category: p.category || "", product: p.product || p.name || "", budget: p.budget || "", moq: p.moq || 0 });
        return { success: true, type: "business_pro", agent: "supplierFinderAgent", data };
    } catch (err) {
        return { success: false, type: "business_pro", agent: "supplierFinderAgent", data: { error: err.message } };
    }
}

module.exports = { findSuppliers, run };
