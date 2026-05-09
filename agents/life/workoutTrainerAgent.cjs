/**
 * Workout Trainer Agent — beginner/intermediate exercise routines. General fitness only.
 */

const groq = require("../core/groqClient.cjs");
const { uid, NOW, logToMemory, ok, fail, HEALTH_DISCLAIMER } = require("./_lifeStore.cjs");

const SYSTEM = `You are a certified fitness coach. Create safe, effective workout plans for general fitness.
Always advise consulting a doctor before starting. Respond ONLY with valid JSON.`;

const ROUTINES = {
    beginner: {
        fullBody: [
            { exercise: "Jumping Jacks",   sets: 3, reps: "20",     rest: "30s", muscle: "Full Body"  },
            { exercise: "Push-Ups",        sets: 3, reps: "8-10",   rest: "45s", muscle: "Chest/Arms" },
            { exercise: "Bodyweight Squat",sets: 3, reps: "12",     rest: "45s", muscle: "Legs"       },
            { exercise: "Plank",           sets: 3, reps: "20 sec", rest: "30s", muscle: "Core"       },
            { exercise: "Mountain Climbers",sets:3, reps: "10/side",rest: "30s", muscle: "Core/Cardio"},
            { exercise: "Glute Bridge",    sets: 3, reps: "15",     rest: "30s", muscle: "Glutes"     }
        ]
    },
    intermediate: {
        fullBody: [
            { exercise: "Burpees",          sets: 4, reps: "10",    rest: "60s", muscle: "Full Body"  },
            { exercise: "Diamond Push-Ups", sets: 4, reps: "12",    rest: "60s", muscle: "Chest/Tri"  },
            { exercise: "Jump Squats",      sets: 4, reps: "12",    rest: "60s", muscle: "Legs"       },
            { exercise: "Pull-Ups",         sets: 3, reps: "6-8",   rest: "90s", muscle: "Back/Bi"    },
            { exercise: "Hollow Hold",      sets: 3, reps: "30 sec",rest: "45s", muscle: "Core"       },
            { exercise: "Bulgarian Squat",  sets: 3, reps: "10/leg",rest: "60s", muscle: "Legs"       }
        ]
    }
};

const WEEKLY_SPLITS = {
    "3-day": ["Full Body", "Rest", "Full Body", "Rest", "Full Body", "Rest", "Rest"],
    "4-day": ["Upper", "Lower", "Rest", "Upper", "Lower", "Rest", "Rest"],
    "5-day": ["Chest", "Back", "Legs", "Shoulders", "Arms", "Rest", "Rest"]
};

async function generate({ level = "beginner", goal = "general fitness", daysPerWeek = 3, equipment = "none", userId = "" }) {
    const splitKey = `${daysPerWeek}-day`;
    const split    = WEEKLY_SPLITS[splitKey] || WEEKLY_SPLITS["3-day"];
    const routine  = ROUTINES[level]?.fullBody || ROUTINES.beginner.fullBody;

    const weekPlan = split.map((type, i) => ({
        day:       ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"][i],
        type:      type === "Rest" ? "Rest Day" : type,
        duration:  type === "Rest" ? "Active recovery / walk" : "45-60 min",
        exercises: type === "Rest" ? [] : routine,
        warmup:    type !== "Rest" ? "5 min light cardio + dynamic stretching" : null,
        cooldown:  type !== "Rest" ? "5 min stretching + deep breathing" : null
    }));

    let aiPlan = null;
    try {
        const prompt = `Create a ${daysPerWeek}-day/week ${level} workout plan for ${goal}. Equipment: ${equipment}.
JSON: { "weeklyOverview": "...", "progressionTip": "...", "warmupRoutine": ["..."], "recoveryTips": ["..."], "expectedResults": "..." }`;
        const raw = await groq.chat(SYSTEM, prompt, { maxTokens: 500 });
        aiPlan    = groq.parseJson(raw);
    } catch { /* template only */ }

    const plan = {
        id: uid("workout"), userId, level, goal, daysPerWeek, equipment,
        weekPlan, aiInsights: aiPlan,
        tips: ["Progressive overload: add 1 rep or 5% weight weekly", "Rest 48hrs before training same muscle group", "Sleep 7-8hrs for optimal recovery"],
        disclaimer: HEALTH_DISCLAIMER, createdAt: NOW()
    };
    logToMemory("workoutTrainerAgent", `${level}:${goal}`, { daysPerWeek });
    return plan;
}

async function run(task) {
    const p = task.payload || {};
    try {
        const data = await generate({ level: p.level || "beginner", goal: p.goal || "general fitness", daysPerWeek: p.days || p.daysPerWeek || 3, equipment: p.equipment || "none", userId: p.userId || "" });
        return ok("workoutTrainerAgent", data, ["Take rest days seriously", "Track your lifts to measure progress"]);
    } catch (err) { return fail("workoutTrainerAgent", err.message); }
}

module.exports = { generate, ROUTINES, run };
