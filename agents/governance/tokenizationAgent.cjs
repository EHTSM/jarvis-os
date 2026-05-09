"use strict";
const { load, flush, uid, NOW, govAudit, ok, fail, blocked, GOV_DISCLAIMER } = require("./_governanceStore.cjs");
const AGENT = "tokenizationAgent";

const ASSET_CLASSES = {
    real_estate:    { name:"Real Estate",        minFractions:10,   regulatoryNote:"Subject to local property and securities laws", riskLevel:"MEDIUM" },
    equity:         { name:"Equity / Shares",    minFractions:100,  regulatoryNote:"Security token — requires securities regulation compliance (SEBI/SEC)", riskLevel:"HIGH" },
    debt:           { name:"Debt / Bonds",       minFractions:100,  regulatoryNote:"Regulated financial instrument — requires registration", riskLevel:"HIGH" },
    commodity:      { name:"Commodity",          minFractions:1,    regulatoryNote:"Subject to commodity exchange regulations", riskLevel:"MEDIUM" },
    art_collectible:{ name:"Art & Collectibles", minFractions:10,   regulatoryNote:"Provenance and authenticity must be independently verified", riskLevel:"MEDIUM" },
    ip_rights:      { name:"Intellectual Property Rights", minFractions:10, regulatoryNote:"IP assignment and licensing must be clearly defined in legal docs", riskLevel:"MEDIUM" },
    revenue_share:  { name:"Revenue Share",      minFractions:100,  regulatoryNote:"Likely a security — seek legal opinion before launch", riskLevel:"HIGH" },
    utility:        { name:"Utility Token",      minFractions:1,    regulatoryNote:"Must provide genuine utility — not a security in disguise (Howey Test)", riskLevel:"MEDIUM" }
};

const COMPLIANCE_FRAMEWORKS = {
    india:   { name:"India", regulator:"SEBI + RBI", notes:["No tokenized securities framework yet — proceed with extreme caution", "RBI sandbox for pilots", "DPDP Act applies to investor PII"] },
    usa:     { name:"USA",   regulator:"SEC + FinCEN", notes:["Security tokens require Reg D, Reg S, or Reg A+ exemptions", "KYC/AML mandatory", "SAB 121 applies to custodians"] },
    eu:      { name:"EU",    regulator:"ESMA (MiCA)",  notes:["MiCA Regulation effective 2024 — comprehensive crypto framework", "Asset-referenced tokens and e-money tokens have specific requirements"] },
    uae:     { name:"UAE",   regulator:"VARA + DFSA",  notes:["VARA framework active in Dubai", "DIFC has specific tokenisation guidelines"] }
};

function tokenizeAsset({ userId, assetName, assetClass, totalValue, currency = "INR", totalFractions, jurisdiction = "india", description, legalDocumentRef }) {
    if (!userId || !assetName || !assetClass || !totalValue || !totalFractions) {
        return fail(AGENT, "userId, assetName, assetClass, totalValue, and totalFractions required");
    }
    if (!ASSET_CLASSES[assetClass]) return fail(AGENT, `assetClass must be: ${Object.keys(ASSET_CLASSES).join(", ")}`);
    if (!COMPLIANCE_FRAMEWORKS[jurisdiction]) return fail(AGENT, `jurisdiction must be: ${Object.keys(COMPLIANCE_FRAMEWORKS).join(", ")}`);

    const cls   = ASSET_CLASSES[assetClass];
    const frame = COMPLIANCE_FRAMEWORKS[jurisdiction];

    if (totalFractions < cls.minFractions) {
        return fail(AGENT, `${cls.name} tokenization requires at least ${cls.minFractions} fractions`);
    }

    if (cls.riskLevel === "HIGH") {
        return blocked(AGENT,
            `${cls.name} is a high-risk asset class requiring regulatory approval before tokenization. ` +
            `Jurisdiction: ${frame.name} — Regulator: ${frame.regulator}. ` +
            `Notes: ${frame.notes.join("; ")}`,
            "HIGH"
        );
    }

    const pricePerFraction = totalValue / totalFractions;
    const tokenId = uid("tok");

    const token = {
        id:              tokenId,
        assetName,
        assetClass,
        assetClassName:  cls.name,
        totalValue,
        currency,
        totalFractions,
        pricePerFraction,
        jurisdiction,
        legalDocumentRef:legalDocumentRef || null,
        description:     description || null,
        fractionsSold:   0,
        fractionsAvailable: totalFractions,
        investors:       [],
        regulatoryNote:  cls.regulatoryNote,
        complianceNotes: frame.notes,
        status:          "DRAFT",
        createdBy:       userId,
        createdAt:       NOW()
    };

    const registry = load(userId, "token_registry", []);
    registry.push(token);
    flush(userId, "token_registry", registry);

    govAudit(AGENT, userId, "asset_tokenized", { tokenId, assetName, assetClass, totalValue, currency }, "HIGH");

    return ok(AGENT, {
        tokenId,
        assetName,
        assetClass:         cls.name,
        totalValue,         currency,
        pricePerFraction,   totalFractions,
        regulatoryNote:     cls.regulatoryNote,
        complianceNotes:    frame.notes,
        status:             "DRAFT — legal review required before offering to investors",
        note:               "SIMULATION MODE — no real token was minted on any blockchain",
        disclaimer:         GOV_DISCLAIMER
    });
}

function recordFractionPurchase({ userId, tokenId, investorId, fractionCount }) {
    if (!userId || !tokenId || !investorId || !fractionCount) {
        return fail(AGENT, "userId, tokenId, investorId, and fractionCount required");
    }

    const registry = load(userId, "token_registry", []);
    const token    = registry.find(t => t.id === tokenId);
    if (!token) return fail(AGENT, `Token ${tokenId} not found`);
    if (token.status === "DRAFT") return blocked(AGENT, "Token is still DRAFT — cannot sell fractions before legal approval", "HIGH");
    if (fractionCount > token.fractionsAvailable) return blocked(AGENT, `Only ${token.fractionsAvailable} fractions available — requested ${fractionCount}`, "MEDIUM");

    const purchase = {
        id:           uid("pch"),
        investorId,
        fractionCount,
        pricePerFraction: token.pricePerFraction,
        totalPaid:    fractionCount * token.pricePerFraction,
        currency:     token.currency,
        purchasedAt:  NOW(),
        status:       "SIMULATED"
    };

    token.investors.push(purchase);
    token.fractionsSold      += fractionCount;
    token.fractionsAvailable -= fractionCount;

    flush(userId, "token_registry", registry);
    govAudit(AGENT, userId, "fraction_purchased", { tokenId, investorId, fractionCount, totalPaid:purchase.totalPaid }, "HIGH");

    return ok(AGENT, { ...purchase, fractionsAvailable: token.fractionsAvailable, note:"SIMULATION — no real payment processed", disclaimer:GOV_DISCLAIMER });
}

function approveToken({ userId, tokenId, legalApprovalRef }) {
    if (!userId || !tokenId || !legalApprovalRef) return fail(AGENT, "userId, tokenId, and legalApprovalRef required");

    const registry = load(userId, "token_registry", []);
    const token    = registry.find(t => t.id === tokenId);
    if (!token) return fail(AGENT, `Token ${tokenId} not found`);
    if (token.status !== "DRAFT") return fail(AGENT, `Token is already ${token.status}`);

    token.status           = "ACTIVE";
    token.legalApprovalRef = legalApprovalRef;
    token.approvedBy       = userId;
    token.approvedAt       = NOW();
    flush(userId, "token_registry", registry);

    govAudit(AGENT, userId, "token_approved", { tokenId, legalApprovalRef }, "HIGH");
    return ok(AGENT, { tokenId, assetName:token.assetName, status:"ACTIVE", legalApprovalRef, approvedAt:token.approvedAt, disclaimer:GOV_DISCLAIMER });
}

function getTokenRegistry({ userId, assetClass, status }) {
    if (!userId) return fail(AGENT, "userId required");

    let registry = load(userId, "token_registry", []);
    if (assetClass) registry = registry.filter(t => t.assetClass === assetClass);
    if (status)     registry = registry.filter(t => t.status === status);

    return ok(AGENT, {
        total:    registry.length,
        tokens:   registry.map(t => ({ id:t.id, assetName:t.assetName, assetClass:t.assetClassName, totalValue:t.totalValue, currency:t.currency, fractionsSold:t.fractionsSold, fractionsAvailable:t.fractionsAvailable, status:t.status, createdAt:t.createdAt })),
        disclaimer: GOV_DISCLAIMER
    });
}

module.exports = { tokenizeAsset, recordFractionPurchase, approveToken, getTokenRegistry };
