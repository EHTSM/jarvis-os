/**
 * Auto SaaS Creator — generates complete SaaS structure: pricing, schema, and tech stack.
 */

const groq = require("../core/groqClient.cjs");
const { uid, NOW, logToMemory, ok, fail } = require("./_autoStore.cjs");

const SYSTEM = `You are a SaaS architect. Design complete, scalable SaaS products.
Respond ONLY with valid JSON.`;

const PRICING_MODELS = {
    freemium:    [
        { tier: "Free",    price: "₹0/mo",    features: 3,  users: 1,  description: "Core features, usage limits" },
        { tier: "Pro",     price: "₹499/mo",  features: 10, users: 5,  description: "Full features, priority support" },
        { tier: "Business",price: "₹1999/mo", features: 20, users: 25, description: "Advanced features, API access" },
        { tier: "Enterprise", price: "Custom", features: -1, users: -1, description: "Unlimited + SLA + custom integrations" }
    ],
    subscription:[
        { tier: "Starter", price: "₹299/mo",  features: 5,  users: 1,  description: "Perfect for individuals" },
        { tier: "Growth",  price: "₹999/mo",  features: 15, users: 10, description: "Best for growing teams" },
        { tier: "Scale",   price: "₹2999/mo", features: 30, users: 50, description: "For established businesses" }
    ],
    usage_based: [
        { tier: "Pay-as-you-go", price: "₹0.10/unit", features: -1, users: -1, description: "Pay only for what you use" },
        { tier: "Bundle",        price: "₹999 / 10,000 units", features: -1, users: -1, description: "Bulk discount" }
    ]
};

const TECH_STACKS = {
    standard: {
        frontend:  "Next.js 14 (React) + TailwindCSS",
        backend:   "Node.js (Express/Fastify)",
        database:  "PostgreSQL (Supabase) or MongoDB Atlas",
        auth:      "NextAuth.js or Clerk",
        payments:  "Razorpay (India) / Stripe (global)",
        hosting:   "Vercel (frontend) + Railway (backend)",
        email:     "Resend or SendGrid",
        monitoring:"Sentry + Posthog"
    },
    firebase: {
        frontend:  "React + TailwindCSS",
        backend:   "Firebase Cloud Functions",
        database:  "Firestore + Firebase Auth",
        auth:      "Firebase Auth",
        payments:  "Razorpay / Stripe",
        hosting:   "Firebase Hosting + Vercel",
        email:     "SendGrid",
        monitoring:"Firebase Analytics"
    }
};

const DB_SCHEMAS = {
    user:         "{ id, email, name, plan, createdAt, updatedAt, stripeCustomerId }",
    subscription: "{ id, userId, plan, status, currentPeriodEnd, cancelAtPeriodEnd }",
    usage:        "{ id, userId, feature, count, periodStart, periodEnd }",
    audit_log:    "{ id, userId, action, metadata, ip, timestamp }"
};

async function create({ name = "", niche = "", pricingModel = "freemium", stack = "standard", userId = "" }) {
    const pricing  = PRICING_MODELS[pricingModel] || PRICING_MODELS.freemium;
    const techStack = TECH_STACKS[stack] || TECH_STACKS.standard;

    let aiDesign = null;
    try {
        const prompt = `Design a SaaS called "${name}" for "${niche}" niche. Pricing: ${pricingModel}.
JSON: { "coreDifferentiator": "...", "keyFeatures": ["..."], "integrations": ["..."], "growthStrategy": "...", "monthlyARRGoal": "₹..." }`;
        const raw  = await groq.chat(SYSTEM, prompt, { maxTokens: 400 });
        aiDesign   = groq.parseJson(raw);
    } catch { /* template */ }

    const saas = {
        id:            uid("saas"),
        userId,
        name,
        niche,
        pricingModel,
        pricing,
        techStack,
        dbSchemas:     DB_SCHEMAS,
        architecture: {
            pattern:     "Monorepo (apps/web + apps/api)",
            deployment:  "CI/CD via GitHub Actions",
            scaling:     "Horizontal — stateless API + managed DB",
            security:    ["JWT tokens", "Rate limiting", "Input sanitization", "HTTPS only", "2FA ready"]
        },
        launchChecklist: [
            "Domain + SSL",
            "Payment gateway live test",
            "Error monitoring (Sentry)",
            "Terms of Service + Privacy Policy",
            "GDPR/data compliance",
            "Backup strategy",
            "Support channel (email/chat)"
        ],
        aiDesign,
        createdAt: NOW()
    };

    logToMemory("autoSaasCreator", name || niche, { pricingModel, stack });
    return saas;
}

async function run(task) {
    const p = task.payload || {};
    try {
        const data = await create({ name: p.name || "", niche: p.niche || "productivity", pricingModel: p.pricing || p.pricingModel || "freemium", stack: p.stack || "standard", userId: p.userId || "" });
        return ok("autoSaasCreator", data, ["Free tier builds trust", "Annual plans improve cash flow"]);
    } catch (err) { return fail("autoSaasCreator", err.message); }
}

module.exports = { create, PRICING_MODELS, TECH_STACKS, run };
