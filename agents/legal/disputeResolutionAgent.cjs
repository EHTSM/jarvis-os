"use strict";
const { load, flush, uid, NOW, auditLog, scoreRisk, ok, fail } = require("./_legalStore.cjs");
const AGENT = "disputeResolutionAgent";

const METHODS = {
    negotiation:  { cost:"Minimal",  speed:"Fast (days-weeks)",   binding:false, privacy:true,  recommended:"All disputes — attempt first" },
    mediation:    { cost:"Low-Medium",speed:"Weeks-months",        binding:false, privacy:true,  recommended:"Commercial, family, employment disputes" },
    arbitration:  { cost:"Medium-High",speed:"Months",            binding:true,  privacy:true,  recommended:"Contract disputes with arbitration clause" },
    litigation:   { cost:"High",     speed:"Years",               binding:true,  privacy:false, recommended:"Last resort — large claims, injunctions needed" },
    lok_adalat:   { cost:"Free",     speed:"Fast",                binding:true,  privacy:false, recommended:"India — motor accident, matrimonial, labour disputes" },
    consumer_forum:{ cost:"Low (₹200-₹5000 filing)", speed:"Months", binding:true, privacy:false, recommended:"India — consumer disputes up to ₹2Cr" }
};

const ESCALATION_PATH = [
    { step:1, method:"Negotiation",   timeframe:"0-30 days",  action:"Direct communication with other party in writing" },
    { step:2, method:"Mediation",     timeframe:"30-90 days", action:"Engage a neutral mediator" },
    { step:3, method:"Arbitration",   timeframe:"3-12 months",action:"If contract has arbitration clause — invoke it" },
    { step:4, method:"Litigation",    timeframe:"1-5 years",  action:"File suit in appropriate court" }
];

function analyzeDispute({ userId, description, disputeType, amount, jurisdiction = "India", hasArbitrationClause = false }) {
    if (!userId || !description) return fail(AGENT, "userId and description required");
    auditLog(AGENT, userId, "dispute_analyzed", { disputeType, amount, jurisdiction });

    const riskFactors = [];
    if (amount > 1000000)        riskFactors.push("highValue");
    if (disputeType === "criminal") riskFactors.push("criminalElement");

    const recommended = [];
    if (jurisdiction === "India" && ["motor","matrimonial","labour"].some(t => description.toLowerCase().includes(t))) {
        recommended.push("lok_adalat");
    }
    if (amount && amount <= 20000000) recommended.push("consumer_forum");
    if (hasArbitrationClause) recommended.push("arbitration");
    recommended.push("negotiation","mediation");

    const analysis = {
        id:             uid("dr"),
        userId,
        description,
        disputeType,
        amount,
        jurisdiction,
        hasArbitrationClause,
        recommendedMethods:  [...new Set(recommended)].map(m => ({ method: m, ...METHODS[m] })),
        escalationPath:      ESCALATION_PATH,
        immediateActions:   ["Document all communications in writing", "Preserve evidence (contracts, emails, receipts)", "Note all deadlines — limitation periods apply", "Do not make statements that could be used against you"],
        limitationPeriods:  {
            contract:  "3 years (India) from breach date",
            tort:      "3 years (India) from damage date",
            consumer:  "2 years from cause of action",
            recovery:  "12 years for recovery of possession"
        },
        riskLevel:      scoreRisk(riskFactors),
        createdAt:      NOW()
    };

    const records = load(userId, "disputes", []);
    records.push({ id: analysis.id, disputeType, riskLevel: analysis.riskLevel, createdAt: analysis.createdAt });
    flush(userId, "disputes", records.slice(-100));

    return ok(AGENT, analysis);
}

function getResolutionMethods() { return ok(AGENT, { methods: METHODS, escalationPath: ESCALATION_PATH }); }

module.exports = { analyzeDispute, getResolutionMethods };
