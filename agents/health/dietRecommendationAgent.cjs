"use strict";
const { ok, fail, accessLog } = require("./_healthStore.cjs");

const AGENT = "dietRecommendationAgent";

const GOALS      = ["weight_loss","weight_gain","muscle_building","maintenance","heart_health","diabetes_management","digestive_health","energy_boost","general_wellness"];
const CUISINES   = ["indian","mediterranean","continental","asian","mixed"];
const DIET_TYPES = ["omnivore","vegetarian","vegan","eggetarian","pescatarian","keto","low_carb","gluten_free"];

const DIET_PLANS = {
    weight_loss: {
        principle:   "Calorie deficit of 300-500 kcal below TDEE",
        macros:      { protein: "30%", carbs: "35%", fat: "35%" },
        foods_to_eat: ["lean proteins (chicken, fish, legumes)","leafy greens","whole grains","fruits","low-fat dairy"],
        foods_avoid:  ["refined sugar","fried foods","white bread","sugary drinks","ultra-processed snacks"],
        tips:         ["Eat in smaller portions more frequently","Drink water before meals","Prioritise protein to feel full longer"]
    },
    weight_gain: {
        principle:   "Calorie surplus of 300-500 kcal above TDEE with strength training",
        macros:      { protein: "25%", carbs: "50%", fat: "25%" },
        foods_to_eat: ["rice, roti, oats","nuts and nut butters","dairy products","eggs, chicken, fish","avocados, olive oil"],
        foods_avoid:  ["empty calories (junk food)","excessive sugar"],
        tips:         ["Eat every 3 hours","Post-workout meals are critical","Avoid skipping breakfast"]
    },
    muscle_building: {
        principle:   "High protein intake + resistance training + slight calorie surplus",
        macros:      { protein: "35%", carbs: "45%", fat: "20%" },
        foods_to_eat: ["chicken breast","eggs","dal and legumes","cottage cheese (paneer)","whey protein (if needed)","brown rice"],
        foods_avoid:  ["excessive fats","alcohol","sugar-heavy foods"],
        tips:         ["1.6-2.2g protein per kg body weight","Creatine has strong evidence for muscle gain — discuss with nutritionist","Rest days are as important as workout days"]
    },
    heart_health: {
        principle:   "Reduce saturated fats, increase omega-3, high fibre",
        macros:      { protein: "20%", carbs: "55%", fat: "25%" },
        foods_to_eat: ["oily fish (salmon, sardines)","walnuts, flaxseeds","olive oil","oats, barley","berries, fruits","vegetables"],
        foods_avoid:  ["trans fats","processed meats","high-sodium foods","refined carbohydrates","coconut oil in excess"],
        tips:         ["Mediterranean diet has strongest evidence for heart health","Limit salt to 5g/day","Aim for 25-30g dietary fibre daily"]
    },
    diabetes_management: {
        principle:   "Low glycaemic index foods, consistent carbohydrate intake, avoid spikes",
        macros:      { protein: "25%", carbs: "40%", fat: "35%" },
        foods_to_eat: ["brown rice, whole wheat roti","non-starchy vegetables","legumes and lentils","nuts","berries"],
        foods_avoid:  ["white rice in large amounts","refined sugar","fruit juices","white bread","sweetened beverages"],
        tips:         ["Eat at consistent times","Check food labels for hidden sugars","Walk 10-15 min after meals to manage blood sugar","Work with a diabetic dietitian"]
    },
    general_wellness: {
        principle:   "Balanced whole-food diet with variety",
        macros:      { protein: "20%", carbs: "50%", fat: "30%" },
        foods_to_eat: ["colourful vegetables","fruits","whole grains","lean proteins","healthy fats","fermented foods (curd, kimchi)"],
        foods_avoid:  ["ultra-processed foods","excessive sugar","trans fats"],
        tips:         ["Eat the rainbow — variety in colour = variety in nutrients","Stay hydrated: 8 glasses of water daily","Limit screen time while eating"]
    }
};

const VEGETARIAN_SUBS = {
    "chicken breast":    "paneer or tofu",
    "chicken":           "paneer or soy chunks",
    "fish":              "tofu, tempeh or lentils",
    "whey protein":      "plant-based protein powder"
};

function getDietPlan({ userId, goal = "general_wellness", dietType = "omnivore", allergies = [], weightKg, heightCm, age, activityLevel = "moderate" }) {
    if (!userId) return fail(AGENT, "userId required");
    if (!GOALS.includes(goal))      return fail(AGENT, `Invalid goal. Use: ${GOALS.join(", ")}`);
    if (!DIET_TYPES.includes(dietType)) return fail(AGENT, `Invalid dietType. Use: ${DIET_TYPES.join(", ")}`);

    accessLog(userId, AGENT, "diet_plan_requested", { goal, dietType });

    const plan = DIET_PLANS[goal] || DIET_PLANS.general_wellness;

    // Calorie estimate (Mifflin-St Jeor simplified)
    let calories = null;
    if (weightKg && heightCm && age) {
        const bmr    = 10 * weightKg + 6.25 * heightCm - 5 * age + (20); // simplified; gender not required
        const actMul = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9 };
        const tdee   = bmr * (actMul[activityLevel] || 1.55);
        calories     = Math.round(goal === "weight_loss" ? tdee - 400 : goal === "weight_gain" ? tdee + 400 : tdee);
    }

    // Vegetarian substitutions
    let foodsToEat = [...(plan.foods_to_eat || [])];
    if (dietType === "vegetarian" || dietType === "vegan" || dietType === "eggetarian") {
        foodsToEat = foodsToEat.map(f => {
            const sub = Object.entries(VEGETARIAN_SUBS).find(([k]) => f.toLowerCase().includes(k));
            return sub ? `${f} → substitute with ${sub[1]}` : f;
        });
        if (dietType === "vegan") foodsToEat = foodsToEat.filter(f => !f.toLowerCase().includes("dairy") && !f.toLowerCase().includes("egg"));
    }

    // Filter allergens
    if (allergies.length) {
        const allergyLower = allergies.map(a => a.toLowerCase());
        foodsToEat = foodsToEat.filter(f => !allergyLower.some(a => f.toLowerCase().includes(a)));
    }

    // Sample day plan
    const sampleDay = {
        breakfast: ["Oats with banana and nuts", "Whole grain toast with eggs (or paneer)", "Green tea"],
        midMorning: ["A handful of almonds", "One fruit (apple, orange or guava)"],
        lunch:    ["2 whole wheat rotis", "Dal / Rajma / Chicken", "Sabzi (mixed vegetables)", "Curd"],
        evening:  ["Sprouts chaat or roasted makhana", "Herbal tea"],
        dinner:   ["Brown rice or 2 rotis", "Paneer / Fish / Lentils", "Salad with olive oil"],
        hydration:["8-10 glasses of water", "Coconut water post-workout", "Avoid sugary drinks"]
    };

    return ok(AGENT, {
        goal, dietType,
        estimatedCalories: calories,
        principle:   plan.principle,
        macros:      plan.macros,
        foodsToEat,
        foodsToAvoid: plan.foods_avoid,
        tips:         plan.tips,
        sampleDayPlan: sampleDay,
        recommendation: "This is a general guideline. For a personalised diet plan, consult a Registered Dietitian or Nutritionist."
    });
}

module.exports = { getDietPlan };
