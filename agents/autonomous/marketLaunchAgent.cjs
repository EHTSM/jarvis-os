/**
 * Market Launch Agent — simulates and plans controlled go-to-market strategy.
 * All campaign actions flagged as requiring approval before execution.
 */

const groq = require("../core/groqClient.cjs");
const { uid, NOW, logToMemory, ok, fail, approvalRequired } = require("./_autoStore.cjs");

const SYSTEM = `You are a go-to-market strategist. Create specific, actionable launch plans.
Respond ONLY with valid JSON.`;

const LAUNCH_PHASES = {
    "pre_launch": {
        duration: "2 weeks",
        activities: ["Build waitlist", "Teaser content", "Beta user outreach", "Press kit preparation"],
        goal:     "100 waitlist signups"
    },
    "soft_launch": {
        duration: "2 weeks",
        activities: ["Invite waitlist", "Product Hunt prep", "Social proof collection", "Bug fixing"],
        goal:     "50 paying customers"
    },
    "public_launch": {
        duration: "1 week",
        activities: ["Product Hunt launch", "Press release", "Social campaign", "Influencer activation"],
        goal:     "500 signups, 100 customers"
    },
    "growth_phase": {
        duration: "Ongoing",
        activities: ["Paid ads (REQUIRES APPROVAL)", "Referral program", "Content marketing", "SEO"],
        goal:     "MoM 20% growth"
    }
};

const CHANNEL_STRATEGIES = {
    organic:  ["SEO blog content", "YouTube tutorials", "Twitter/LinkedIn threads", "Reddit value posts"],
    paid:     ["Google Ads (REQUIRES APPROVAL)", "Meta Ads (REQUIRES APPROVAL)", "LinkedIn Ads (B2B)"],
    community:["Discord/Slack communities", "Indie Hackers", "Product Hunt", "Twitter networking"],
    outreach: ["Cold email (personal, max 50/day)", "Warm intros via network", "Partnership DMs"]
};

async function plan({ productName = "", niche = "", targetCustomer = "", budget = 5000, channels = ["organic", "community"], userId = "" }) {
    const requiresApproval = channels.some(c => c === "paid");

    let aiStrategy = null;
    try {
        const prompt = `Launch plan for "${productName}" targeting "${targetCustomer}" in "${niche}". Budget: ₹${budget}.
JSON: { "launchHook": "...", "firstWeekTasks": ["..."], "primaryChannel": "...", "messagingAngle": "...", "expectedCAC": "₹..." }`;
        const raw    = await groq.chat(SYSTEM, prompt, { maxTokens: 400 });
        aiStrategy   = groq.parseJson(raw);
    } catch { /* template */ }

    const launchPlan = {
        id:             uid("launch"),
        userId,
        productName,
        niche,
        targetCustomer,
        budget,
        phases:         Object.entries(LAUNCH_PHASES).map(([phase, data]) => ({ phase, ...data })),
        channels:       channels.map(c => ({ channel: c, strategy: CHANNEL_STRATEGIES[c] || [], requiresApproval: c === "paid" })),
        weekOneTasks: [
            "Write 3 SEO-optimized blog posts targeting buyer keywords",
            "Post launch thread on Indie Hackers and Twitter",
            "Submit to 10 relevant directories (free)",
            "Activate beta user referral program",
            "Set up Google Analytics + conversion tracking"
        ],
        kpis:           ["Daily signups", "Activation rate (signup → first action)", "CAC", "Day-7 retention"],
        approvalNeeded: requiresApproval ? ["Paid ad campaigns require human approval before spend"] : [],
        aiStrategy,
        note:           requiresApproval ? "⚠️ Paid channels selected — activate only after approval." : "All selected channels are organic — safe to proceed.",
        createdAt:      NOW()
    };

    logToMemory("marketLaunchAgent", productName || niche, { budget, channels });
    return launchPlan;
}

async function run(task) {
    const p = task.payload || {};
    try {
        const data = await plan({ productName: p.name || p.product || "", niche: p.niche || "", targetCustomer: p.customer || "", budget: p.budget || 5000, channels: p.channels || ["organic", "community"], userId: p.userId || "" });
        if (data.approvalNeeded?.length) {
            // Plan is returned — but paid execution requires approval
        }
        return ok("marketLaunchAgent", data, ["Launch fast — iterate faster", "Distribution beats product quality in early stage"]);
    } catch (err) { return fail("marketLaunchAgent", err.message); }
}

module.exports = { plan, LAUNCH_PHASES, CHANNEL_STRATEGIES, run };
