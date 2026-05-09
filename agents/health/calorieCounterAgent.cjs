"use strict";
const { load, flush, uid, NOW, ok, fail, accessLog } = require("./_healthStore.cjs");

const AGENT = "calorieCounterAgent";

// Per-100g calorie values for common foods
const FOOD_DB = {
    "rice":           { cal: 130, carbs: 28, protein: 2.7, fat: 0.3 },
    "roti":           { cal: 297, carbs: 60, protein: 9,   fat: 3.7 },
    "dal":            { cal: 116, carbs: 20, protein: 8,   fat: 0.5 },
    "chicken breast": { cal: 165, carbs: 0,  protein: 31,  fat: 3.6 },
    "egg":            { cal: 155, carbs: 1,  protein: 13,  fat: 11  },
    "milk":           { cal: 42,  carbs: 5,  protein: 3.4, fat: 1   },
    "banana":         { cal: 89,  carbs: 23, protein: 1.1, fat: 0.3 },
    "apple":          { cal: 52,  carbs: 14, protein: 0.3, fat: 0.2 },
    "bread":          { cal: 265, carbs: 49, protein: 9,   fat: 3.2 },
    "paneer":         { cal: 265, carbs: 1.2,protein: 18,  fat: 20  },
    "potato":         { cal: 77,  carbs: 17, protein: 2,   fat: 0.1 },
    "oats":           { cal: 389, carbs: 66, protein: 17,  fat: 7   },
    "almonds":        { cal: 579, carbs: 22, protein: 21,  fat: 50  },
    "olive oil":      { cal: 884, carbs: 0,  protein: 0,   fat: 100 },
    "salmon":         { cal: 208, carbs: 0,  protein: 20,  fat: 13  },
    "spinach":        { cal: 23,  carbs: 3.6,protein: 2.9, fat: 0.4 },
    "tomato":         { cal: 18,  carbs: 3.9,protein: 0.9, fat: 0.2 },
    "onion":          { cal: 40,  carbs: 9,  protein: 1.1, fat: 0.1 },
    "sugar":          { cal: 387, carbs: 100,protein: 0,   fat: 0   },
    "butter":         { cal: 717, carbs: 0.1,protein: 0.9, fat: 81  },
    "curd":           { cal: 61,  carbs: 4.7,protein: 3.5, fat: 3.3 },
    "orange":         { cal: 47,  carbs: 12, protein: 0.9, fat: 0.1 },
    "coffee":         { cal: 2,   carbs: 0,  protein: 0.3, fat: 0   },
    "tea":            { cal: 1,   carbs: 0,  protein: 0.1, fat: 0   },
    "samosa":         { cal: 261, carbs: 28, protein: 4.5, fat: 14  },
    "idli":           { cal: 58,  carbs: 12, protein: 1.8, fat: 0.2 },
    "dosa":           { cal: 133, carbs: 22, protein: 4,   fat: 3.7 }
};

function _lookup(name) {
    const n = name.toLowerCase().trim();
    if (FOOD_DB[n]) return FOOD_DB[n];
    const partial = Object.entries(FOOD_DB).find(([k]) => k.includes(n) || n.includes(k));
    return partial ? partial[1] : null;
}

function logMeal({ userId, foods = [], mealType = "snack" }) {
    if (!userId)         return fail(AGENT, "userId required");
    if (!foods.length)   return fail(AGENT, "foods array required: [{ name, grams }]");

    const MEAL_TYPES = ["breakfast","lunch","dinner","snack","pre_workout","post_workout"];
    if (!MEAL_TYPES.includes(mealType)) return fail(AGENT, `mealType must be one of: ${MEAL_TYPES.join(", ")}`);

    accessLog(userId, AGENT, "meal_logged", { mealType, count: foods.length });

    const items    = [];
    let totalCal   = 0, totalCarbs = 0, totalProtein = 0, totalFat = 0;

    for (const food of foods) {
        const info = _lookup(food.name);
        const g    = food.grams || 100;
        const factor = g / 100;
        if (info) {
            const cal     = Math.round(info.cal     * factor);
            const carbs   = +(info.carbs   * factor).toFixed(1);
            const protein = +(info.protein * factor).toFixed(1);
            const fat     = +(info.fat     * factor).toFixed(1);
            items.push({ name: food.name, grams: g, calories: cal, carbs, protein, fat });
            totalCal     += cal;
            totalCarbs   += carbs;
            totalProtein += protein;
            totalFat     += fat;
        } else {
            items.push({ name: food.name, grams: g, calories: "unknown", note: "Food not in database — add manually" });
        }
    }

    const meal = {
        id:       uid("meal"),
        userId,
        mealType,
        foods:    items,
        totals:   { calories: totalCal, carbs: +totalCarbs.toFixed(1), protein: +totalProtein.toFixed(1), fat: +totalFat.toFixed(1) },
        date:     NOW().slice(0, 10),
        loggedAt: NOW()
    };

    const log = load(userId, "meal_log", []);
    log.push(meal);
    flush(userId, "meal_log", log.slice(-5000));
    return ok(AGENT, meal);
}

function getDailySummary({ userId, date }) {
    if (!userId) return fail(AGENT, "userId required");
    const d       = date || NOW().slice(0, 10);
    const meals   = load(userId, "meal_log", []).filter(m => m.date === d);
    const totals  = meals.reduce((acc, m) => {
        acc.calories += m.totals.calories || 0;
        acc.carbs    += m.totals.carbs    || 0;
        acc.protein  += m.totals.protein  || 0;
        acc.fat      += m.totals.fat      || 0;
        return acc;
    }, { calories: 0, carbs: 0, protein: 0, fat: 0 });

    const goal      = 2000; // default; can be personalised
    const remaining = goal - totals.calories;
    return ok(AGENT, {
        date, meals: meals.length, totals,
        calorieGoal: goal,
        remaining:   remaining > 0 ? remaining : 0,
        status:      remaining < 0 ? `Over goal by ${Math.abs(remaining)} kcal` : `${remaining} kcal remaining`
    });
}

function lookupFood({ userId, foodName }) {
    if (!userId || !foodName) return fail(AGENT, "userId and foodName required");
    const info = _lookup(foodName);
    if (!info) return ok(AGENT, { foodName, found: false, note: "Not in database. Please consult a nutritionist for accurate values." });
    return ok(AGENT, { foodName, per100g: info, found: true });
}

module.exports = { logMeal, getDailySummary, lookupFood };
