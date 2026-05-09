"use strict";
const crypto = require("crypto");
const { load, flush, uid, NOW, govAudit, ok, fail, blocked, GOV_DISCLAIMER } = require("./_governanceStore.cjs");
const AGENT = "blockchainVerification";

const SUPPORTED_NETWORKS = {
    ethereum:  { name:"Ethereum",     symbol:"ETH", explorer:"etherscan.io",    blockTime:12,   mode:"SIMULATION" },
    polygon:   { name:"Polygon",      symbol:"MATIC",explorer:"polygonscan.com", blockTime:2,   mode:"SIMULATION" },
    solana:    { name:"Solana",       symbol:"SOL", explorer:"solscan.io",       blockTime:0.4,  mode:"SIMULATION" },
    bitcoin:   { name:"Bitcoin",      symbol:"BTC", explorer:"blockstream.info", blockTime:600,  mode:"SIMULATION" },
    hyperledger:{ name:"Hyperledger Fabric", symbol:"N/A", explorer:"N/A (private)", blockTime:1, mode:"SIMULATION" }
};

function _simulateHash(data) {
    return crypto.createHash("sha256").update(JSON.stringify(data) + Date.now()).digest("hex");
}

function _simulateBlockNumber() {
    return Math.floor(17000000 + Math.random() * 3000000);
}

function hashAndRecord({ userId, data, network = "ethereum", label }) {
    if (!userId || !data) return fail(AGENT, "userId and data required");
    if (!SUPPORTED_NETWORKS[network]) return fail(AGENT, `network must be: ${Object.keys(SUPPORTED_NETWORKS).join(", ")}`);

    const net        = SUPPORTED_NETWORKS[network];
    const dataHash   = crypto.createHash("sha256").update(typeof data === "string" ? data : JSON.stringify(data)).digest("hex");
    const txHash     = _simulateHash({ dataHash, network, userId, ts: NOW() });
    const blockNum   = _simulateBlockNumber();

    const record = {
        id:          uid("bvr"),
        label:       label || "Unnamed Record",
        dataHash,
        txHash,
        network,
        networkName: net.name,
        blockNumber: blockNum,
        timestamp:   NOW(),
        recordedBy:  userId,
        status:      "SIMULATED",
        explorerUrl: `https://${net.explorer}/tx/${txHash} (simulation — not a real tx)`
    };

    const log = load(userId, "blockchain_records", []);
    log.push(record);
    flush(userId, "blockchain_records", log.slice(-5000));

    govAudit(AGENT, userId, "data_hashed_and_recorded", { recordId:record.id, network, label:record.label }, "INFO");

    return ok(AGENT, {
        ...record,
        note:       "⚠️ SIMULATION MODE — no real blockchain transaction was submitted",
        disclaimer: GOV_DISCLAIMER
    });
}

function verifyRecord({ userId, recordId, originalData }) {
    if (!userId || !recordId || !originalData) return fail(AGENT, "userId, recordId, and originalData required");

    const log    = load(userId, "blockchain_records", []);
    const record = log.find(r => r.id === recordId);
    if (!record) return fail(AGENT, `Record ${recordId} not found`);

    const checkHash = crypto.createHash("sha256").update(typeof originalData === "string" ? originalData : JSON.stringify(originalData)).digest("hex");
    const matches   = checkHash === record.dataHash;

    govAudit(AGENT, userId, "record_verified", { recordId, matches, network:record.network }, matches ? "INFO" : "HIGH");

    if (!matches) {
        return blocked(AGENT, `Integrity check FAILED for record ${recordId} — data has been tampered with`, "CRITICAL");
    }

    return ok(AGENT, {
        recordId,
        label:      record.label,
        verified:   true,
        dataHash:   record.dataHash,
        network:    record.networkName,
        recordedAt: record.timestamp,
        note:       "Data integrity confirmed — hash matches the stored record",
        disclaimer: GOV_DISCLAIMER
    });
}

function getRecords({ userId, network, label, limit = 50 }) {
    if (!userId) return fail(AGENT, "userId required");

    let log = load(userId, "blockchain_records", []);
    if (network) log = log.filter(r => r.network === network);
    if (label)   log = log.filter(r => r.label.toLowerCase().includes(label.toLowerCase()));

    return ok(AGENT, {
        total:   log.length,
        records: log.slice(-limit).reverse().map(r => ({ id:r.id, label:r.label, network:r.networkName, dataHash:r.dataHash, timestamp:r.timestamp, status:r.status })),
        note:    "All records are simulations — not on a real blockchain",
        disclaimer: GOV_DISCLAIMER
    });
}

function getSupportedNetworks() {
    return ok(AGENT, {
        networks:   Object.entries(SUPPORTED_NETWORKS).map(([k,v]) => ({ id:k, ...v })),
        disclaimer: GOV_DISCLAIMER,
        note:       "All networks operate in SIMULATION mode — no real transactions are submitted"
    });
}

module.exports = { hashAndRecord, verifyRecord, getRecords, getSupportedNetworks };
