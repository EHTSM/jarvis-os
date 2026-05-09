"use strict";
const { loadUser, flushUser, loadGlobal, flushGlobal, metaLog, uid, hash, NOW, ok, fail, blocked } = require("./_metaverseStore.cjs");

const AGENT = "virtualLandManager";

const LAND_ZONES    = ["residential","commercial","industrial","park","government","special"];
const GRID_SIZE     = 1000; // 1000×1000 virtual grid

function _coordId(x, z) { return `${Math.round(x)}_${Math.round(z)}`; }
function _validateCoords(x, z) { return Number.isFinite(x) && Number.isFinite(z) && Math.abs(x) <= GRID_SIZE/2 && Math.abs(z) <= GRID_SIZE/2; }

function claimLand({ userId, worldId, x, z, width = 10, depth = 10, plotName, zone = "residential" }) {
    if (!userId || !worldId) return fail(AGENT, "userId and worldId required");
    if (!_validateCoords(x, z)) return fail(AGENT, `coordinates out of bounds — grid is ${GRID_SIZE}×${GRID_SIZE}`);
    if (width < 1 || width > 100 || depth < 1 || depth > 100) return fail(AGENT, "width and depth must be 1–100");
    if (!LAND_ZONES.includes(zone)) return fail(AGENT, `zone must be: ${LAND_ZONES.join(", ")}`);

    const registry = loadGlobal(`land_registry_${worldId}`, {});
    // check overlap
    for (let px = Math.round(x); px < Math.round(x)+width; px++) {
        for (let pz = Math.round(z); pz < Math.round(z)+depth; pz++) {
            const cid = _coordId(px, pz);
            if (registry[cid] && registry[cid].ownerId !== userId) return blocked(AGENT, `plot (${px},${pz}) already owned by another user`);
        }
    }

    const plot = {
        plotId:   uid("plot"),
        worldId,
        ownerId:  userId,
        plotName: plotName || `Plot_(${Math.round(x)},${Math.round(z)})`,
        origin:   { x: Math.round(x), z: Math.round(z) },
        width,
        depth,
        area:     width * depth,
        zone,
        buildings:[],
        forSale:  false,
        salePrice:null,
        claimedAt:NOW()
    };

    for (let px = Math.round(x); px < Math.round(x)+width; px++) {
        for (let pz = Math.round(z); pz < Math.round(z)+depth; pz++) {
            registry[_coordId(px, pz)] = { ownerId: userId, plotId: plot.plotId };
        }
    }
    flushGlobal(`land_registry_${worldId}`, registry);

    const userLands = loadUser(userId, `lands_${worldId}`, []);
    userLands.push({ plotId:plot.plotId, plotName:plot.plotName, origin:plot.origin, area:plot.area, zone, claimedAt:plot.claimedAt });
    flushUser(userId, `lands_${worldId}`, userLands);
    flushGlobal(`land_plot_${plot.plotId}`, plot);

    metaLog(AGENT, userId, "land_claimed", { worldId, plotId:plot.plotId, area:plot.area, zone }, "INFO");
    return ok(AGENT, plot);
}

function listLandForSale({ ownerId, plotId, salePrice, currency = "MVC" }) {
    if (!ownerId || !plotId) return fail(AGENT, "ownerId and plotId required");
    if (typeof salePrice !== "number" || salePrice < 0) return fail(AGENT, "salePrice must be >= 0");
    const plot = loadGlobal(`land_plot_${plotId}`);
    if (!plot) return fail(AGENT, `plotId ${plotId} not found`);
    if (plot.ownerId !== ownerId) return blocked(AGENT, "only the owner can list land for sale");

    plot.forSale = true;
    plot.salePrice = salePrice;
    plot.saleCurrency = currency;
    plot.listedAt = NOW();
    flushGlobal(`land_plot_${plotId}`, plot);

    metaLog(AGENT, ownerId, "land_listed", { plotId, salePrice, currency }, "INFO");
    return ok(AGENT, { plotId, salePrice, currency, status: "listed_for_sale" });
}

function purchaseLand({ buyerId, plotId }) {
    if (!buyerId || !plotId) return fail(AGENT, "buyerId and plotId required");
    const plot = loadGlobal(`land_plot_${plotId}`);
    if (!plot) return fail(AGENT, `plotId ${plotId} not found`);
    if (!plot.forSale) return blocked(AGENT, "this land is not for sale");
    if (plot.ownerId === buyerId) return blocked(AGENT, "cannot purchase your own land");

    // balance check (MVC)
    if (plot.saleCurrency === "MVC") {
        const wallet = loadUser(buyerId, "mv_wallet", { balance:1000 });
        if (wallet.balance < plot.salePrice) return blocked(AGENT, `insufficient MVC balance (need ${plot.salePrice}, have ${wallet.balance})`);
        wallet.balance = parseFloat((wallet.balance - plot.salePrice).toFixed(4));
        flushUser(buyerId, "mv_wallet", wallet);
    }

    const previousOwner = plot.ownerId;
    plot.ownerId = buyerId;
    plot.forSale = false;
    plot.salePrice = null;
    plot.transferredAt = NOW();
    flushGlobal(`land_plot_${plotId}`, plot);

    // update user land registries
    let prevLands = loadUser(previousOwner, `lands_${plot.worldId}`, []);
    prevLands = prevLands.filter(l => l.plotId !== plotId);
    flushUser(previousOwner, `lands_${plot.worldId}`, prevLands);
    const buyerLands = loadUser(buyerId, `lands_${plot.worldId}`, []);
    buyerLands.push({ plotId, plotName:plot.plotName, origin:plot.origin, area:plot.area, zone:plot.zone, acquiredAt:NOW() });
    flushUser(buyerId, `lands_${plot.worldId}`, buyerLands);

    metaLog(AGENT, buyerId, "land_purchased", { plotId, previousOwner, price:plot.salePrice }, "INFO");
    return ok(AGENT, { purchased:plotId, buyerId, previousOwner, price:plot.salePrice });
}

function getUserLands({ userId, worldId }) {
    if (!userId || !worldId) return fail(AGENT, "userId and worldId required");
    const lands = loadUser(userId, `lands_${worldId}`, []);
    return ok(AGENT, { total:lands.length, lands, zones:LAND_ZONES });
}

module.exports = { claimLand, listLandForSale, purchaseLand, getUserLands };
