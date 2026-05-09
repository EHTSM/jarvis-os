/**
 * Travel Planner Agent — generate travel itineraries and packing lists.
 */

const groq = require("../core/groqClient.cjs");
const { uid, NOW, logToMemory, ok, fail } = require("./_lifeStore.cjs");

const SYSTEM = `You are an expert travel planner. Create detailed, practical travel itineraries.
Respond ONLY with valid JSON.`;

const PACKING_TEMPLATES = {
    beach:    ["Sunscreen SPF50+", "Swimwear", "Flip-flops", "Light cotton clothes", "Hat", "Sunglasses", "Insect repellent"],
    mountain: ["Warm jacket", "Layering clothes", "Trekking shoes", "Woolen socks", "Gloves", "Beanie", "Rain poncho"],
    city:     ["Comfortable walking shoes", "Smart-casual outfits", "Day bag/backpack", "Power bank", "City map/offline maps"],
    desert:   ["Loose long sleeves", "High-SPF sunscreen", "Sunglasses", "Wide-brim hat", "Extra water bottles", "Lip balm"],
    general:  ["Passport/ID", "Travel insurance docs", "Universal adapter", "First aid kit", "Medications", "Chargers", "Earphones"]
};

const BUDGET_GUIDES = {
    budget:  { accommodation: "Hostels/budget hotels (₹500-1500/night)", food: "Local dhabas/street food (₹200-400/day)", transport: "Public transport/shared cabs" },
    mid:     { accommodation: "3-star hotels (₹2000-5000/night)",       food: "Mid-range restaurants (₹500-1000/day)",  transport: "Cabs + occasional flights" },
    luxury:  { accommodation: "5-star/boutique (₹8000+/night)",          food: "Fine dining (₹2000+/day)",              transport: "Private transfers/business class" }
};

async function plan({ destination, days = 3, budget = "mid", tripType = "leisure", interests = [], startDate, userId = "" }) {
    if (!destination) throw new Error("destination required");

    const tripKey    = tripType.toLowerCase().includes("beach") ? "beach" : tripType.toLowerCase().includes("mountain") || tripType.toLowerCase().includes("trek") ? "mountain" : tripType.toLowerCase().includes("city") ? "city" : "general";
    const packingList = [...PACKING_TEMPLATES.general, ...(PACKING_TEMPLATES[tripKey] || [])];
    const budgetGuide = BUDGET_GUIDES[budget] || BUDGET_GUIDES.mid;

    let itinerary = null;
    let aiPlan    = null;
    try {
        const prompt = `Create a ${days}-day travel itinerary for ${destination}. Trip type: ${tripType}. Budget: ${budget}.
Interests: ${interests.join(", ") || "sightseeing, food, culture"}.
JSON: {
  "overview": "...",
  "bestTimeToVisit": "...",
  "itinerary": [{"day": 1, "theme": "...", "morning": "...", "afternoon": "...", "evening": "...", "accommodation": "...", "meals": ["..."]}],
  "mustSee": ["..."],
  "localTips": ["..."],
  "budgetBreakdown": {"accommodation": "₹...", "food": "₹...", "activities": "₹...", "transport": "₹...", "total": "₹..."}
}`;
        const raw = await groq.chat(SYSTEM, prompt, { maxTokens: 800 });
        aiPlan    = groq.parseJson(raw);
        itinerary = aiPlan?.itinerary || null;
    } catch { /* fallback */ }

    const result = {
        id:          uid("trip"),
        userId,
        destination,
        days,
        budget,
        tripType,
        interests,
        startDate:   startDate || "Flexible",
        itinerary:   itinerary || Array.from({ length: days }, (_, i) => ({
            day:         i + 1,
            theme:       i === 0 ? "Arrival & Orientation" : i === days - 1 ? "Departure" : `Exploration Day ${i}`,
            morning:     "Sightseeing — check top-rated attractions nearby",
            afternoon:   "Local food experience + leisure",
            evening:     "Local market or cultural experience",
            accommodation: budgetGuide.accommodation
        })),
        packingList,
        budgetGuide,
        generalTips: [
            "Book accommodation 2-4 weeks in advance for best rates",
            "Download offline maps before leaving",
            "Keep scanned copies of all documents on cloud",
            "Carry some cash — not everywhere accepts cards",
            "Buy travel insurance — it's worth it"
        ],
        aiInsights:  aiPlan,
        createdAt:   NOW()
    };

    logToMemory("travelPlannerAgent", `${userId}:${destination}`, { days, budget });
    return result;
}

async function run(task) {
    const p = task.payload || {};
    try {
        const data = await plan({ destination: p.destination || p.place, days: p.days || 3, budget: p.budget || "mid", tripType: p.type || p.tripType || "leisure", interests: p.interests || [], startDate: p.startDate, userId: p.userId || "" });
        return ok("travelPlannerAgent", data, ["Travel slow — deeper experiences", "Overplanning kills spontaneity"]);
    } catch (err) { return fail("travelPlannerAgent", err.message); }
}

module.exports = { plan, PACKING_TEMPLATES, run };
