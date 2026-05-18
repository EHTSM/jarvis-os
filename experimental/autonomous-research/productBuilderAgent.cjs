/**
 * Product Builder Agent — generates product specs, feature maps, and dev roadmaps.
 */

const groq = require("../core/groqClient.cjs");
const { uid, NOW, logToMemory, ok, fail } = require("./_autoStore.cjs");

const SYSTEM = `You are a product manager. Create detailed, developer-ready product specifications.
Respond ONLY with valid JSON.`;

const PRODUCT_FRAMEWORKS = {
    mvp:  { phases: 1, features: 3,  timeline: "4 weeks",  focus: "Core value only" },
    v1:   { phases: 2, features: 8,  timeline: "12 weeks", focus: "Full feature set" },
    v2:   { phases: 3, features: 15, timeline: "24 weeks", focus: "Growth features" }
};

async function build({ name = "", description = "", users = "individual", version = "mvp", features = [], userId = "" }) {
    const framework = PRODUCT_FRAMEWORKS[version] || PRODUCT_FRAMEWORKS.mvp;

    const coreFeatures = features.length ? features.slice(0, framework.features) : [
        { name: "User Authentication",   priority: "P0", effort: "S", description: "Login, signup, password reset" },
        { name: "Core Feature",          priority: "P0", effort: "M", description: description || "Primary product capability" },
        { name: "Dashboard",             priority: "P0", effort: "M", description: "Main user interface" },
        { name: "Settings / Profile",    priority: "P1", effort: "S", description: "User account management" },
        { name: "Notifications",         priority: "P1", effort: "S", description: "In-app and email alerts" },
        { name: "Payment / Billing",     priority: "P1", effort: "M", description: "Subscription or one-time payment" },
        { name: "Analytics Dashboard",   priority: "P2", effort: "L", description: "Usage metrics for admins" },
        { name: "API / Integrations",    priority: "P2", effort: "L", description: "Third-party connections" }
    ].slice(0, framework.features);

    let aiSpec = null;
    try {
        const prompt = `Product: "${name}". ${description}. Target users: ${users}. Version: ${version}.
Generate a product spec.
JSON: { "productVision": "...", "userPersona": "...", "painPoints": ["..."], "successMetrics": ["..."], "technicalConsiderations": ["..."] }`;
        const raw  = await groq.chat(SYSTEM, prompt, { maxTokens: 400 });
        aiSpec     = groq.parseJson(raw);
    } catch { /* template */ }

    const spec = {
        id:       uid("prod"),
        userId,
        name,
        description,
        users,
        version,
        framework,
        features: coreFeatures,
        roadmap: Array.from({ length: framework.phases }, (_, i) => ({
            phase:       `Phase ${i + 1}`,
            timeline:    `Weeks ${i * 4 + 1}-${(i + 1) * 4}`,
            deliverable: i === 0 ? "MVP with core features" : i === 1 ? "V1 with full feature set" : "V2 with growth features",
            features:    coreFeatures.filter(f => f.priority === `P${i}`).map(f => f.name)
        })),
        aiSpec,
        designPrinciples: ["Mobile-first", "Accessibility (WCAG 2.1)", "Performance (< 2s load)", "Progressive disclosure"],
        createdAt: NOW()
    };

    logToMemory("productBuilderAgent", name || description, { version, features: coreFeatures.length });
    return spec;
}

async function run(task) {
    const p = task.payload || {};
    try {
        const data = await build({ name: p.name, description: p.description || p.idea || "", users: p.users || "individual", version: p.version || "mvp", features: p.features || [], userId: p.userId || "" });
        return ok("productBuilderAgent", data, ["Ship MVP in 4 weeks", "Users define the product — not assumptions"]);
    } catch (err) { return fail("productBuilderAgent", err.message); }
}

module.exports = { build, run };
