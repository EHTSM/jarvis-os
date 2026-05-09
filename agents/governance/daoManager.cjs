"use strict";
const { load, flush, uid, NOW, govAudit, ok, fail, blocked, GOV_DISCLAIMER } = require("./_governanceStore.cjs");
const AGENT = "daoManager";

const DAO_TYPES = {
    protocol:    { name:"Protocol DAO",     description:"Governs open-source protocol rules and upgrades" },
    investment:  { name:"Investment DAO",   description:"Pooled capital for collective investment decisions" },
    service:     { name:"Service DAO",      description:"Decentralised service cooperative (talent pools)" },
    social:      { name:"Social DAO",       description:"Community and social coordination organisation" },
    collector:   { name:"Collector DAO",    description:"Collective ownership of NFTs/digital assets" },
    grants:      { name:"Grants DAO",       description:"Funds public-goods projects via member voting" }
};

const TREASURY_ACTIONS = {
    grant:      { name:"Grant Payment",    requiresVote:true,  minApprovalPct:0.60 },
    expense:    { name:"Operational Expense", requiresVote:false, signaturesRequired:2 },
    investment: { name:"Treasury Investment", requiresVote:true, minApprovalPct:0.67 },
    emergency:  { name:"Emergency Withdrawal", requiresVote:false, signaturesRequired:3, note:"Multisig only — no single point of control" }
};

function createDAO({ userId, name, type, description, tokenSymbol, initialMembers = [], governanceRules = {} }) {
    if (!userId || !name || !type) return fail(AGENT, "userId, name, and type required");
    if (!DAO_TYPES[type]) return fail(AGENT, `type must be: ${Object.keys(DAO_TYPES).join(", ")}`);

    const daos = load(userId, "dao_registry", []);
    if (daos.some(d => d.name.toLowerCase() === name.toLowerCase())) {
        return fail(AGENT, `DAO "${name}" already exists`);
    }

    const dao = {
        id:          uid("dao"),
        name,
        type,
        typeName:    DAO_TYPES[type].name,
        description: description || DAO_TYPES[type].description,
        tokenSymbol: tokenSymbol || "GOV",
        members:     [{ userId, role:"FOUNDER", votingWeight:1, joinedAt:NOW() }, ...initialMembers.map(m => ({ userId:m, role:"MEMBER", votingWeight:1, joinedAt:NOW() }))],
        treasury:    { balance:0, currency:"SIMULATION", transactions:[] },
        governanceRules: {
            proposalThreshold:  governanceRules.proposalThreshold  || 1,
            quorumPct:          governanceRules.quorumPct          || 0.5,
            votingPeriodDays:   governanceRules.votingPeriodDays   || 7,
            timelockDays:       governanceRules.timelockDays       || 2,
            ...governanceRules
        },
        status:    "ACTIVE",
        createdBy: userId,
        createdAt: NOW()
    };

    daos.push(dao);
    flush(userId, "dao_registry", daos);
    govAudit(AGENT, userId, "dao_created", { daoId: dao.id, name, type }, "HIGH");

    return ok(AGENT, {
        daoId:           dao.id,
        name:            dao.name,
        type:            dao.typeName,
        memberCount:     dao.members.length,
        governanceRules: dao.governanceRules,
        note:            "DAO is in simulation mode — no real on-chain transactions are executed",
        disclaimer:      GOV_DISCLAIMER
    });
}

function addMember({ userId, daoId, newMemberId, role = "MEMBER", votingWeight = 1 }) {
    if (!userId || !daoId || !newMemberId) return fail(AGENT, "userId, daoId, and newMemberId required");

    const daos = load(userId, "dao_registry", []);
    const dao  = daos.find(d => d.id === daoId);
    if (!dao) return fail(AGENT, `DAO ${daoId} not found`);

    const requestor = dao.members.find(m => m.userId === userId);
    if (!requestor || !["FOUNDER","ADMIN"].includes(requestor.role)) {
        return blocked(AGENT, "Only FOUNDER or ADMIN members can add new members", "MEDIUM");
    }
    if (dao.members.some(m => m.userId === newMemberId)) return fail(AGENT, "Member already in DAO");

    dao.members.push({ userId:newMemberId, role, votingWeight: Math.max(1, votingWeight), joinedAt:NOW(), addedBy:userId });
    flush(userId, "dao_registry", daos);

    govAudit(AGENT, userId, "dao_member_added", { daoId, newMemberId, role }, "INFO");
    return ok(AGENT, { daoId, newMemberId, role, memberCount: dao.members.length });
}

function recordTreasuryAction({ userId, daoId, action, amount, currency = "SIMULATION", recipient, description, signatures = [] }) {
    if (!userId || !daoId || !action || !amount) return fail(AGENT, "userId, daoId, action, and amount required");
    if (!TREASURY_ACTIONS[action]) return fail(AGENT, `action must be: ${Object.keys(TREASURY_ACTIONS).join(", ")}`);

    const daos = load(userId, "dao_registry", []);
    const dao  = daos.find(d => d.id === daoId);
    if (!dao) return fail(AGENT, `DAO ${daoId} not found`);

    const actionConf = TREASURY_ACTIONS[action];
    if (actionConf.signaturesRequired && signatures.length < actionConf.signaturesRequired) {
        return blocked(AGENT, `Action "${actionConf.name}" requires ${actionConf.signaturesRequired} signatures — only ${signatures.length} provided`, "HIGH");
    }
    if (actionConf.requiresVote) {
        return ok(AGENT, {
            requiresVote:   true,
            action,         actionName: actionConf.name,
            amount, currency, recipient,
            note:           `This action requires a DAO proposal and vote with ≥${(actionConf.minApprovalPct*100).toFixed(0)}% approval. Use governanceVotingAI to create a proposal first.`,
            disclaimer:     GOV_DISCLAIMER
        });
    }

    const txn = { id:uid("txn"), action, actionName:actionConf.name, amount, currency, recipient:recipient||null, description:description||null, initiatedBy:userId, signatures, timestamp:NOW(), status:"SIMULATED" };
    dao.treasury.transactions.push(txn);
    dao.treasury.balance = (action === "grant" || action === "expense" || action === "investment") ? dao.treasury.balance - amount : dao.treasury.balance + amount;

    flush(userId, "dao_registry", daos);
    govAudit(AGENT, userId, "treasury_action_recorded", { daoId, txnId:txn.id, action, amount }, "HIGH");

    return ok(AGENT, { ...txn, treasuryBalance: dao.treasury.balance, note:"Simulation only — no real funds moved", disclaimer:GOV_DISCLAIMER });
}

function getDAOInfo({ userId, daoId }) {
    if (!userId || !daoId) return fail(AGENT, "userId and daoId required");

    const daos = load(userId, "dao_registry", []);
    const dao  = daos.find(d => d.id === daoId);
    if (!dao) return fail(AGENT, `DAO ${daoId} not found`);

    govAudit(AGENT, userId, "dao_info_viewed", { daoId }, "INFO");
    return ok(AGENT, {
        id:              dao.id,
        name:            dao.name,
        type:            dao.typeName,
        description:     dao.description,
        memberCount:     dao.members.length,
        members:         dao.members,
        treasury:        { balance:dao.treasury.balance, currency:dao.treasury.currency, txnCount:dao.treasury.transactions.length },
        governanceRules: dao.governanceRules,
        status:          dao.status,
        createdAt:       dao.createdAt,
        disclaimer:      GOV_DISCLAIMER
    });
}

module.exports = { createDAO, addMember, recordTreasuryAction, getDAOInfo };
