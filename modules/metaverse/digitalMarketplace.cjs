"use strict";
const { loadGlobal, flushGlobal, loadUser, flushUser, metaLog, uid, NOW, hash, ok, fail, blocked } = require("./_metaverseStore.cjs");

const AGENT = "digitalMarketplace";

const ASSET_CATEGORIES = ["avatar","wearable","land","scene_object","audio","video","document","script","nft","bundle"];
const LISTING_STATUS   = ["active","sold","expired","delisted"];
const CURRENCIES       = ["MVC","ETH_SIM","SOL_SIM","USD_SIM"];

function listAsset({ sellerId, assetId, assetName, category, price, currency = "MVC", description, imageUrl, quantity = 1 }) {
    if (!sellerId || !assetId || !assetName) return fail(AGENT, "sellerId, assetId, and assetName required");
    if (!ASSET_CATEGORIES.includes(category)) return fail(AGENT, `category must be: ${ASSET_CATEGORIES.join(", ")}`);
    if (!CURRENCIES.includes(currency))       return fail(AGENT, `currency must be: ${CURRENCIES.join(", ")}`);
    if (typeof price !== "number" || price < 0) return fail(AGENT, "price must be a non-negative number");
    if (quantity < 1) return fail(AGENT, "quantity must be >= 1");

    const listing = {
        listingId:   uid("lst"),
        sellerId,
        assetId,
        assetName,
        category,
        price,
        currency,
        description: description ? String(description).slice(0,1000) : null,
        imageUrl:    imageUrl || null,
        quantity,
        remaining:   quantity,
        status:      "active",
        views:       0,
        sales:       0,
        listingHash: hash({ assetId, sellerId, price, currency }),
        listedAt:    NOW()
    };

    const market = loadGlobal("marketplace_listings", []);
    market.push(listing);
    flushGlobal("marketplace_listings", market);

    metaLog(AGENT, sellerId, "asset_listed", { listingId: listing.listingId, category, price, currency }, "INFO");
    return ok(AGENT, listing);
}

function searchListings({ query, category, currency, maxPrice, status = "active", limit = 50, offset = 0 }) {
    let listings = loadGlobal("marketplace_listings", []);
    if (status)   listings = listings.filter(l => l.status === status);
    if (category) listings = listings.filter(l => l.category === category);
    if (currency) listings = listings.filter(l => l.currency === currency);
    if (maxPrice !== undefined) listings = listings.filter(l => l.price <= maxPrice);
    if (query) {
        const q = String(query).toLowerCase();
        listings = listings.filter(l => l.assetName.toLowerCase().includes(q) || (l.description||"").toLowerCase().includes(q));
    }
    const total = listings.length;
    listings = listings.slice(offset, offset + limit);
    return ok(AGENT, { total, listings, offset, limit, categories: ASSET_CATEGORIES, currencies: CURRENCIES });
}

function purchaseAsset({ buyerId, listingId, quantity = 1 }) {
    if (!buyerId || !listingId) return fail(AGENT, "buyerId and listingId required");

    const market = loadGlobal("marketplace_listings", []);
    const idx    = market.findIndex(l => l.listingId === listingId);
    if (idx === -1)                        return fail(AGENT, `listingId ${listingId} not found`);
    if (market[idx].status !== "active")   return blocked(AGENT, `listing is ${market[idx].status} — cannot purchase`);
    if (market[idx].remaining < quantity)  return blocked(AGENT, `only ${market[idx].remaining} units available`);
    if (market[idx].sellerId === buyerId)  return blocked(AGENT, "cannot purchase your own listing");

    // simulated balance check
    const wallet = loadUser(buyerId, "mv_wallet", { balance: 1000, currency: "MVC" });
    const totalCost = market[idx].price * quantity;
    if (market[idx].currency === "MVC" && wallet.balance < totalCost) {
        return blocked(AGENT, `insufficient MVC balance (need ${totalCost}, have ${wallet.balance})`);
    }

    // deduct from buyer (MVC only, others are simulation)
    if (market[idx].currency === "MVC") {
        wallet.balance = parseFloat((wallet.balance - totalCost).toFixed(4));
        flushUser(buyerId, "mv_wallet", wallet);
    }

    market[idx].remaining -= quantity;
    market[idx].sales     += quantity;
    if (market[idx].remaining <= 0) market[idx].status = "sold";
    flushGlobal("marketplace_listings", market);

    const receipt = {
        receiptId:   uid("rcpt"),
        buyerId,
        sellerId:    market[idx].sellerId,
        listingId,
        assetId:     market[idx].assetId,
        assetName:   market[idx].assetName,
        quantity,
        unitPrice:   market[idx].price,
        totalCost,
        currency:    market[idx].currency,
        purchasedAt: NOW()
    };

    const purchases = loadUser(buyerId, "purchases", []);
    purchases.push(receipt);
    flushUser(buyerId, "purchases", purchases.slice(-10000));

    metaLog(AGENT, buyerId, "asset_purchased", { listingId, quantity, totalCost, currency: receipt.currency }, "INFO");
    return ok(AGENT, receipt, { warning: "SIMULATION — no real crypto or fiat was transferred" });
}

function delistAsset({ sellerId, listingId }) {
    if (!sellerId || !listingId) return fail(AGENT, "sellerId and listingId required");
    const market = loadGlobal("marketplace_listings", []);
    const idx = market.findIndex(l => l.listingId === listingId);
    if (idx === -1) return fail(AGENT, `listingId ${listingId} not found`);
    if (market[idx].sellerId !== sellerId) return blocked(AGENT, "only the seller can delist this asset");

    market[idx].status = "delisted";
    market[idx].delistedAt = NOW();
    flushGlobal("marketplace_listings", market);

    metaLog(AGENT, sellerId, "asset_delisted", { listingId }, "WARN");
    return ok(AGENT, { delisted: listingId });
}

module.exports = { listAsset, searchListings, purchaseAsset, delistAsset };
