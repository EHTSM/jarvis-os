"use strict";
const { loadUser, flushUser, loadGlobal, flushGlobal, metaLog, uid, hash, NOW, ok, fail } = require("./_metaverseStore.cjs");
const crypto = require("crypto");

const AGENT = "nftGeneratorAI";

// ⚠️ SIMULATION ONLY — generates NFT metadata JSON; no real blockchain minting

const NFT_STANDARDS = ["ERC-721","ERC-1155","SPL","custom"];
const RARITY_TIERS  = { common:0.60, uncommon:0.25, rare:0.10, epic:0.04, legendary:0.01 };
const TRAIT_TYPES   = ["background","body","eyes","mouth","accessory","outfit","effect","aura"];

function _assignRarity() {
    const roll = Math.random();
    let cumulative = 0;
    for (const [tier, prob] of Object.entries(RARITY_TIERS)) {
        cumulative += prob;
        if (roll <= cumulative) return tier;
    }
    return "common";
}

function _generateTraits(traitOverrides = {}) {
    return TRAIT_TYPES.map(type => ({
        trait_type: type,
        value:      traitOverrides[type] || `${type}_${Math.floor(Math.random()*20)+1}`
    }));
}

function generateNFT({ creatorId, collectionId, name, description, externalUrl, traitOverrides = {}, standard = "ERC-721", royaltyPercent = 5 }) {
    if (!creatorId || !name) return fail(AGENT, "creatorId and name required");
    if (!NFT_STANDARDS.includes(standard)) return fail(AGENT, `standard must be: ${NFT_STANDARDS.join(", ")}`);
    if (royaltyPercent < 0 || royaltyPercent > 50) return fail(AGENT, "royaltyPercent must be 0–50");

    const rarity   = _assignRarity();
    const traits   = _generateTraits(traitOverrides);
    const tokenHash = crypto.createHash("sha256").update(creatorId + name + NOW()).digest("hex");

    const metadata = {
        tokenId:         uid("nft"),
        standard,
        name,
        description:     description ? String(description).slice(0,1000) : `A ${rarity} NFT from Jarvis Metaverse`,
        image:           `ipfs://SIMULATED_CID/${tokenHash.slice(0,32)}`,
        externalUrl:     externalUrl || null,
        attributes:      traits,
        rarity,
        rarityScore:     parseFloat((Math.random()*100).toFixed(2)),
        royaltyPercent,
        collectionId:    collectionId || null,
        creatorId,
        tokenHash,
        simulatedMintAt: NOW(),
        status:          "SIMULATED — not minted on any real blockchain",
        blockchain:      "SIMULATION_ONLY"
    };

    const userNFTs = loadUser(creatorId, "nfts", []);
    userNFTs.push({ tokenId: metadata.tokenId, name, rarity, standard, createdAt: metadata.simulatedMintAt });
    flushUser(creatorId, "nfts", userNFTs.slice(-10000));

    // collection registry
    if (collectionId) {
        const col = loadGlobal(`nft_collection_${collectionId}`, { collectionId, tokens:[] });
        col.tokens.push({ tokenId: metadata.tokenId, rarity, createdAt: metadata.simulatedMintAt });
        flushGlobal(`nft_collection_${collectionId}`, col);
    }

    metaLog(AGENT, creatorId, "nft_generated", { tokenId: metadata.tokenId, rarity, standard }, "INFO");
    return ok(AGENT, metadata, { notice: "⚠️ SIMULATION — metadata only; no real NFT was minted" });
}

function createCollection({ creatorId, collectionName, symbol, maxSupply = 10000, description, royaltyPercent = 5 }) {
    if (!creatorId || !collectionName || !symbol) return fail(AGENT, "creatorId, collectionName, and symbol required");
    if (maxSupply < 1 || maxSupply > 1000000) return fail(AGENT, "maxSupply must be 1–1,000,000");

    const collection = {
        collectionId:  uid("col"),
        collectionName,
        symbol:        symbol.toUpperCase().slice(0,10),
        creatorId,
        description:   description ? String(description).slice(0,1000) : null,
        maxSupply,
        minted:        0,
        royaltyPercent,
        tokens:        [],
        createdAt:     NOW(),
        status:        "SIMULATED"
    };

    flushGlobal(`nft_collection_${collection.collectionId}`, collection);
    metaLog(AGENT, creatorId, "nft_collection_created", { collectionId: collection.collectionId, maxSupply }, "INFO");
    return ok(AGENT, collection, { notice: "⚠️ SIMULATION — no real smart contract deployed" });
}

function getUserNFTs({ userId, limit = 50 }) {
    if (!userId) return fail(AGENT, "userId required");
    const nfts = loadUser(userId, "nfts", []);
    return ok(AGENT, { total: nfts.length, nfts: nfts.slice(-limit).reverse(), standards: NFT_STANDARDS, rarityTiers: Object.keys(RARITY_TIERS) });
}

module.exports = { generateNFT, createCollection, getUserNFTs };
