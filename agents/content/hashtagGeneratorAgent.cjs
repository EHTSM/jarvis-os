/**
 * Hashtag Generator Agent — tiered hashtags (popular/medium/niche) per topic + platform.
 * Platform-aware: Instagram (up to 30), LinkedIn (3-5), Twitter (1-2), TikTok (5-10).
 */

const groq = require("../core/groqClient.cjs");

const SYSTEM = `You are a social media strategist specializing in hashtag research.
Return hashtags in 3 tiers: popular (high volume, competitive), medium (balanced reach), niche (targeted audience).
Respond ONLY with valid JSON.`;

// Pre-built niche hashtag banks — fast fallback with no API
const HASHTAG_BANKS = {
    ai:         { popular: ["#AI","#ArtificialIntelligence","#MachineLearning","#TechNews","#Innovation"], medium: ["#AIStartup","#DeepLearning","#NLP","#ChatGPT","#AITools"], niche: ["#AIForBusiness","#AIAutomation","#GenAI","#LLM","#PromptEngineering"] },
    business:   { popular: ["#Business","#Entrepreneur","#Marketing","#Success","#Startup"], medium: ["#SmallBusiness","#BusinessGrowth","#CEO","#Hustle","#SideHustle"], niche: ["#B2B","#SaaS","#BootstrappedFounder","#GrowthHacking","#StartupLife"] },
    tech:       { popular: ["#Technology","#Tech","#Software","#Developer","#Coding"], medium: ["#WebDev","#Programming","#JavaScript","#Python","#CloudComputing"], niche: ["#BuildInPublic","#OpenSource","#DevCommunity","#SoftwareEngineering","#APIFirst"] },
    fitness:    { popular: ["#Fitness","#Workout","#Health","#Gym","#Motivation"], medium: ["#FitnessGoals","#HealthyLifestyle","#PersonalTrainer","#FitLife","#Weightloss"], niche: ["#FitnessTips","#HomeWorkout","#FunctionalFitness","#StrengthTraining","#NutritionTips"] },
    finance:    { popular: ["#Finance","#Money","#Investing","#WealthBuilding","#Financial"], medium: ["#PassiveIncome","#StockMarket","#Crypto","#FinancialFreedom","#Savings"], niche: ["#PersonalFinance","#DebtFree","#FinancialLiteracy","#InvestingTips","#RetirementPlanning"] },
    content:    { popular: ["#ContentCreator","#DigitalMarketing","#SocialMedia","#Content","#Branding"], medium: ["#ContentStrategy","#ContentMarketing","#Influencer","#CreatorEconomy","#VideoMarketing"], niche: ["#ContentCreation","#UGC","#CreatorTips","#ReelsTips","#GrowOnInstagram"] },
    india:      { popular: ["#India","#IndianBusiness","#MakeInIndia","#Bharat","#IndianStartup"], medium: ["#IndianEntrepreneur","#StartupIndia","#IndianTech","#DigitalIndia","#IndiaGrows"], niche: ["#StartupIndia2024","#IndianFounder","#IndiaInnovates","#VoiceOfIndia","#IndianCreator"] },
    saas:       { popular: ["#SaaS","#Software","#Tech","#Startup","#ProductHunt"], medium: ["#SaaSGrowth","#B2BSaaS","#ProductLed","#MRR","#CustomerSuccess"], niche: ["#SaaSFounder","#IndieHacker","#MicroSaaS","#SaaSMarketing","#PLG"] }
};

const PLATFORM_LIMITS = {
    instagram: 30, linkedin: 5, twitter: 2, tiktok: 10, facebook: 10, youtube: 15
};

function _detectNiche(topic) {
    const t = topic.toLowerCase();
    if (/\bai\b|artificial|machine learn|chatgpt|llm/.test(t))      return "ai";
    if (/saas|software as/.test(t))                                  return "saas";
    if (/tech|cod|software|develop|program/.test(t))                 return "tech";
    if (/business|startup|entrepreneur|company|revenue/.test(t))     return "business";
    if (/fitness|workout|gym|health|diet/.test(t))                   return "fitness";
    if (/financ|invest|money|stock|crypto|wealth/.test(t))           return "finance";
    if (/content|creator|social|reel|post|caption/.test(t))          return "content";
    if (/india|indian|bharat/.test(t))                               return "india";
    return "business";
}

function _templateHashtags(topic, platform, count) {
    const niche  = _detectNiche(topic);
    const bank   = HASHTAG_BANKS[niche] || HASHTAG_BANKS.business;
    const limit  = Math.min(count, PLATFORM_LIMITS[platform] || 30);

    // Mix: 30% popular, 40% medium, 30% niche
    const pop  = bank.popular.slice(0, Math.ceil(limit * 0.30));
    const med  = bank.medium.slice(0,  Math.ceil(limit * 0.40));
    const nic  = bank.niche.slice(0,   Math.ceil(limit * 0.30));
    const all  = [...pop, ...med, ...nic].slice(0, limit);

    // Add topic-derived tags
    const topicTag = "#" + topic.replace(/[^a-zA-Z0-9]/g, "").slice(0, 20);
    if (!all.includes(topicTag)) all.unshift(topicTag);

    return {
        platform, topic, niche,
        hashtags:  all.slice(0, limit),
        breakdown: { popular: pop, medium: med, niche: nic },
        count:     all.length,
        copyable:  all.join(" ")
    };
}

async function _groqHashtags(topic, platform, count) {
    const limit  = Math.min(count, PLATFORM_LIMITS[platform] || 30);
    const prompt = `Generate ${limit} hashtags for "${topic}" on ${platform}.
JSON: { "hashtags": ["#tag1","#tag2",...], "breakdown": { "popular": ["#..."], "medium": ["#..."], "niche": ["#..."] }, "copyable": "#tag1 #tag2 ...", "strategy": "brief strategy tip" }`;
    const raw = await groq.chat(SYSTEM, prompt, { maxTokens: 600 });
    return { platform, topic, ...groq.parseJson(raw) };
}

async function generate({ topic, platform = "instagram", count = 30 }) {
    if (!topic) throw new Error("topic required");
    try {
        return await _groqHashtags(topic, platform, count);
    } catch {
        return _templateHashtags(topic, platform, count);
    }
}

async function run(task) {
    const p        = task.payload || {};
    const topic    = p.topic || p.about || task.input || "";
    const platform = p.platform || "instagram";
    const count    = p.count    || PLATFORM_LIMITS[platform] || 30;

    if (!topic) return { success: false, type: "content", agent: "hashtagGeneratorAgent", data: { error: "topic required" } };

    try {
        const data = await generate({ topic, platform, count });
        return { success: true, type: "content", agent: "hashtagGeneratorAgent", data };
    } catch (err) {
        return { success: false, type: "content", agent: "hashtagGeneratorAgent", data: { error: err.message } };
    }
}

module.exports = { generate, run };
