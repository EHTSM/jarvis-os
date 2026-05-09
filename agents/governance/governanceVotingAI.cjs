"use strict";
const crypto = require("crypto");
const { load, flush, uid, NOW, govAudit, ok, fail, blocked, GOV_DISCLAIMER } = require("./_governanceStore.cjs");
const AGENT = "governanceVotingAI";

const VOTE_TYPES   = { simple_majority:"Simple Majority (>50%)", supermajority:"Supermajority (>66.67%)", unanimous:"Unanimous (100%)", plurality:"Plurality (most votes wins)" };
const PROPOSAL_STATUSES = ["DRAFT","OPEN","CLOSED","PASSED","FAILED","VETOED","WITHDRAWN"];

function _calcResult(votes, voteType, quorumPct, totalEligible) {
    const yes   = votes.filter(v => v.choice === "YES").reduce((s,v) => s+v.weight, 0);
    const no    = votes.filter(v => v.choice === "NO").reduce((s,v) => s+v.weight, 0);
    const abst  = votes.filter(v => v.choice === "ABSTAIN").reduce((s,v) => s+v.weight, 0);
    const total = yes + no + abst;
    const eligible = totalEligible || votes.length;
    const quorum   = total / eligible >= (quorumPct || 0.5);

    let passed = false;
    if (voteType === "simple_majority")  passed = quorum && yes / (yes + no) > 0.5;
    if (voteType === "supermajority")    passed = quorum && yes / (yes + no) > 0.6667;
    if (voteType === "unanimous")        passed = quorum && no === 0 && abst === 0 && yes > 0;
    if (voteType === "plurality")        passed = quorum && yes > no;

    return { yes, no, abstain: abst, total, quorumMet: quorum, passed };
}

function createProposal({ userId, organizationId, title, description, voteType = "simple_majority", options, quorumPct = 0.5, totalEligibleVoters, deadline }) {
    if (!userId || !title) return fail(AGENT, "userId and title required");
    if (!VOTE_TYPES[voteType]) return fail(AGENT, `voteType must be: ${Object.keys(VOTE_TYPES).join(", ")}`);
    if (quorumPct < 0 || quorumPct > 1) return fail(AGENT, "quorumPct must be 0–1");

    const orgKey    = organizationId || userId;
    const proposals = load(userId, `proposals_${orgKey}`, []);

    const proposal = {
        id: uid("prp"), title, description: description || null,
        voteType, voteTypeName: VOTE_TYPES[voteType],
        options: options || ["YES","NO","ABSTAIN"],
        quorumPct, totalEligibleVoters: totalEligibleVoters || null,
        deadline: deadline || null,
        status: "OPEN", votes: [],
        createdBy: userId, createdAt: NOW(), closedAt: null
    };

    proposals.push(proposal);
    flush(userId, `proposals_${orgKey}`, proposals);
    govAudit(AGENT, userId, "proposal_created", { proposalId: proposal.id, title, voteType }, "INFO");

    return ok(AGENT, { proposalId: proposal.id, title, voteType: VOTE_TYPES[voteType], status: "OPEN", createdAt: proposal.createdAt, disclaimer: GOV_DISCLAIMER });
}

function castVote({ userId, organizationId, proposalId, choice, weight = 1, comment }) {
    if (!userId || !proposalId || !choice) return fail(AGENT, "userId, proposalId, and choice required");

    const orgKey    = organizationId || userId;
    const proposals = load(userId, `proposals_${orgKey}`, []);
    const proposal  = proposals.find(p => p.id === proposalId);

    if (!proposal)             return fail(AGENT, `Proposal ${proposalId} not found`);
    if (proposal.status !== "OPEN") return blocked(AGENT, `Proposal is ${proposal.status} — voting closed`, "MEDIUM");
    if (proposal.deadline && new Date(proposal.deadline) < new Date()) {
        proposal.status = "CLOSED";
        flush(userId, `proposals_${orgKey}`, proposals);
        return blocked(AGENT, "Voting deadline has passed", "MEDIUM");
    }
    if (!proposal.options.includes(choice)) return fail(AGENT, `Invalid choice. Options: ${proposal.options.join(", ")}`);
    if (proposal.votes.some(v => v.voterId === userId)) return blocked(AGENT, "You have already voted on this proposal", "LOW");

    const vote = {
        voteId:    uid("vot"),
        voterId:   userId,
        choice,
        weight:    Math.max(1, Math.floor(weight)),
        comment:   comment || null,
        timestamp: NOW(),
        hash:      crypto.createHash("sha256").update(`${userId}:${proposalId}:${choice}:${NOW()}`).digest("hex").slice(0,16)
    };

    proposal.votes.push(vote);
    flush(userId, `proposals_${orgKey}`, proposals);

    govAudit(AGENT, userId, "vote_cast", { proposalId, choice, voteId: vote.voteId }, "INFO");
    const current = _calcResult(proposal.votes, proposal.voteType, proposal.quorumPct, proposal.totalEligibleVoters);

    return ok(AGENT, { voteId: vote.voteId, proposalId, choice, current: { yes: current.yes, no: current.no, total: current.total } });
}

function closeProposal({ userId, organizationId, proposalId, forceClose = false }) {
    if (!userId || !proposalId) return fail(AGENT, "userId and proposalId required");

    const orgKey    = organizationId || userId;
    const proposals = load(userId, `proposals_${orgKey}`, []);
    const proposal  = proposals.find(p => p.id === proposalId);

    if (!proposal) return fail(AGENT, `Proposal ${proposalId} not found`);
    if (proposal.status !== "OPEN" && !forceClose) return fail(AGENT, `Proposal already ${proposal.status}`);

    const result    = _calcResult(proposal.votes, proposal.voteType, proposal.quorumPct, proposal.totalEligibleVoters);
    proposal.status = result.quorumMet ? (result.passed ? "PASSED" : "FAILED") : "FAILED";
    proposal.closedAt = NOW();
    proposal.finalResult = result;

    flush(userId, `proposals_${orgKey}`, proposals);
    govAudit(AGENT, userId, "proposal_closed", { proposalId, status: proposal.status, result }, proposal.status === "PASSED" ? "INFO" : "HIGH");

    return ok(AGENT, { proposalId, title: proposal.title, status: proposal.status, result, closedAt: proposal.closedAt, disclaimer: GOV_DISCLAIMER });
}

function getProposals({ userId, organizationId, status }) {
    if (!userId) return fail(AGENT, "userId required");

    const orgKey    = organizationId || userId;
    let   proposals = load(userId, `proposals_${orgKey}`, []);
    if (status) proposals = proposals.filter(p => p.status === status);

    return ok(AGENT, {
        total: proposals.length,
        proposals: proposals.map(p => ({
            id: p.id, title: p.title, status: p.status, voteType: p.voteType,
            voteCount: p.votes.length, deadline: p.deadline, createdAt: p.createdAt
        })),
        disclaimer: GOV_DISCLAIMER
    });
}

module.exports = { createProposal, castVote, closeProposal, getProposals };
