/**
 * Diet Planner Agent — general healthy eating suggestions. NOT medical advice.
 */

const groq = require("../core/groqClient.cjs");
const { uid, NOW, logToMemory, ok, fail, HEALTH_DISCLAIMER } = require("./_lifeStore.cjs");

const SYSTEM = `You are a certified nutritionist assistant. Suggest balanced, healthy meal plans.
Always recommend consulting a doctor for medical dietary needs. Respond ONLY with valid JSON.`;

const MEAL_TEMPLATES = {
    balanced: {
        breakfast: ["Oats with fruits + nuts", "Eggs + whole grain toast", "Greek yogurt + berries"],
        lunch:     ["Dal + rice + sabzi + salad", "Grilled chicken + quinoa + vegetables", "Rajma + chapati + curd"],
        dinner:    ["Soup + whole grain bread", "Grilled fish + steamed vegetables", "Paneer tikka + roti + salad"],
        snacks:    ["Handful of nuts", "Fresh fruit", "Hummus + veggies"]
    },
    veg:   { breakfast: ["Poha + tea", "Idli + sambhar", "Upma + coconut chutney"], lunch: ["Dal + rice", "Chole + rice", "Rajma + chapati"], dinner: ["Palak paneer + roti", "Mixed dal khichdi", "Vegetable pulao"], snacks: ["Roasted chana", "Fruit bowl", "Sprouts salad"] },
    lowCarb: { breakfast: ["Eggs + avocado", "Chia pudding", "Paneer bhurji"], lunch: ["Grilled chicken salad", "Fish + vegetables", "Tofu stir-fry"], dinner: ["Grilled meat + salad", "Zucchini pasta", "Egg curry"], snacks: ["Nuts", "Cheese", "Boiled eggs"] }
};

function _pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

async function plan({ goal = "balanced", diet = "balanced", calories = 2000, days = 7, userId = "" }) {
    const template = MEAL_TEMPLATES[diet] || MEAL_TEMPLATES.balanced;

    const weekPlan = Array.from({ length: Math.min(days, 7) }, (_, i) => ({
        day:       ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"][i],
        breakfast: _pick(template.breakfast),
        lunch:     _pick(template.lunch),
        dinner:    _pick(template.dinner),
        snack:     _pick(template.snacks),
        water:     "2.5-3L",
        estimatedCalories: Math.round(calories * (0.9 + Math.random() * 0.2))
    }));

    let aiPlan = null;
    try {
        const prompt = `Create a ${days}-day ${diet} diet plan for ${goal} goal, ~${calories} cal/day.
JSON: { "overview": "...", "nutritionTargets": { "protein": "...g", "carbs": "...g", "fats": "...g" }, "tips": ["..."], "foodsToAvoid": ["..."], "supplements": ["..."] }`;
        const raw = await groq.chat(SYSTEM, prompt, { maxTokens: 500 });
        aiPlan    = groq.parseJson(raw);
    } catch { /* template only */ }

    const result = { id: uid("diet"), userId, goal, diet, calories, days, weekPlan, aiInsights: aiPlan, disclaimer: HEALTH_DISCLAIMER, createdAt: NOW() };
    logToMemory("dietPlannerAgent", `${goal}:${diet}`, { days, calories });
    return result;
}

async function run(task) {
    const p = task.payload || {};
    try {
        const data = await plan({ goal: p.goal || "balanced", diet: p.diet || p.type || "balanced", calories: p.calories || 2000, days: p.days || 7, userId: p.userId || "" });
        return ok("dietPlannerAgent", data, ["Meal prep on Sunday for the week", "Track your meals daily"]);
    } catch (err) { return fail("dietPlannerAgent", err.message); }
}

module.exports = { plan, run };
