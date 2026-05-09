"use strict";
const { loadUser, flushUser, loadGlobal, flushGlobal, metaLog, uid, hash, NOW, ok, fail, blocked } = require("./_metaverseStore.cjs");

const AGENT = "nftTradingAgent";

// ⚠️ SIMULATION ONLY — no real crypto, no real blockchain, no real trading

const ORDER_TYPES = ["fixed_price","auction","offer"];
const TRADE_WARN  = "⚠️ SIMULATION ONLY — no real cryptocurrency or blockchain transaction occurs";

function createListing({ sellerId, tokenId, price, currency = "MVC", orderType = "fixed_price", auctionEndAt }) {
    if (!sellerId || !tokenId) return fail(AGENT, "sellerId and tokenId required");
    if (!ORDER_TYPES.includes(orderType)) return fail(AGENT, `orderType must be: ${ORDER_TYPES.join(", ")}`);
    if (typeof price !== "number" || price < 0) return fail(AGENT, "price must be >= 0");

    // verify seller owns token
    const userNFTs = loadUser(sellerId, "nfts", []);
    if (!userNFTs.find(n => n.tokenId === tokenId)) return blocked(AGENT, `tokenId ${tokenId} not found in seller's inventory`);

    const order = {
        orderId:    uid("ord"),
        sellerId,
        tokenId,
        price,
        currency,
        orderType,
        highestBid: orderType === "auction" ? null : undefined,
        auctionEndAt: orderType === "auction" ? (auctionEndAt || null) : undefined,
        bids:       orderType === "auction" ? [] : undefined,
        status:     "active",
        listedAt:   NOW()
    };

    const orders = loadGlobal("nft_orders", []);
    orders.push(order);
    flushGlobal("nft_orders", orders);

    metaLog(AGENT, sellerId, "nft_listed", { orderId: order.orderId, tokenId, price, orderType }, "INFO");
    return ok(AGENT, order, { warning: TRADE_WARN });
}

function buyNFT({ buyerId, orderId }) {
    if (!buyerId || !orderId) return fail(AGENT, "buyerId and orderId required");

    const orders = loadGlobal("nft_orders", []);
    const idx = orders.findIndex(o => o.orderId === orderId);
    if (idx === -1) return fail(AGENT, `orderId ${orderId} not found`);
    const order = orders[idx];
    if (order.status !== "active") return blocked(AGENT, `order is ${order.status}`);
    if (order.orderType !== "fixed_price") return blocked(AGENT, "use placeBid for auction orders");
    if (order.sellerId === buyerId) return blocked(AGENT, "cannot buy your own NFT");

    const wallet = loadUser(buyerId, "mv_wallet", { balance: 1000, currency: "MVC" });
    if (order.currency === "MVC" && wallet.balance < order.price) {
        return blocked(AGENT, `insufficient balance (need ${order.price} MVC, have ${wallet.balance})`);
    }

    // transfer
    if (order.currency === "MVC") {
        wallet.balance = parseFloat((wallet.balance - order.price).toFixed(4));
        flushUser(buyerId, "mv_wallet", wallet);
        const sellerWallet = loadUser(order.sellerId, "mv_wallet", { balance:0, currency:"MVC" });
        sellerWallet.balance = parseFloat((sellerWallet.balance + order.price * 0.975).toFixed(4));
        flushUser(order.sellerId, "mv_wallet", sellerWallet);
    }

    // transfer NFT
    let buyerNFTs = loadUser(buyerId, "nfts", []);
    let sellerNFTs = loadUser(order.sellerId, "nfts", []);
    const nft = sellerNFTs.find(n => n.tokenId === order.tokenId);
    if (nft) {
        sellerNFTs = sellerNFTs.filter(n => n.tokenId !== order.tokenId);
        buyerNFTs.push({ ...nft, acquiredFrom: order.sellerId, acquiredAt: NOW() });
        flushUser(order.sellerId, "nfts", sellerNFTs);
        flushUser(buyerId, "nfts", buyerNFTs);
    }

    orders[idx].status = "sold";
    orders[idx].buyerId = buyerId;
    orders[idx].soldAt = NOW();
    flushGlobal("nft_orders", orders);

    const trade = { tradeId:uid("trd"), orderId, buyerId, sellerId:order.sellerId, tokenId:order.tokenId, price:order.price, currency:order.currency, tradedAt:NOW() };
    const history = loadGlobal("nft_trade_history", []);
    history.push(trade);
    flushGlobal("nft_trade_history", history.slice(-100000));

    metaLog(AGENT, buyerId, "nft_sold", { orderId, tokenId:order.tokenId, price:order.price }, "INFO");
    return ok(AGENT, trade, { warning: TRADE_WARN });
}

function placeBid({ bidderId, orderId, bidAmount, currency = "MVC" }) {
    if (!bidderId || !orderId) return fail(AGENT, "bidderId and orderId required");
    const orders = loadGlobal("nft_orders", []);
    const idx = orders.findIndex(o => o.orderId === orderId);
    if (idx === -1) return fail(AGENT, `orderId ${orderId} not found`);
    if (orders[idx].orderType !== "auction") return blocked(AGENT, "this order is not an auction");
    if (orders[idx].status !== "active") return blocked(AGENT, `order is ${orders[idx].status}`);
    if (bidAmount <= (orders[idx].highestBid?.amount || orders[idx].price)) return fail(AGENT, `bid must exceed current highest (${orders[idx].highestBid?.amount || orders[idx].price})`);

    const bid = { bidId:uid("bid"), bidderId, amount:bidAmount, currency, placedAt:NOW() };
    orders[idx].bids.push(bid);
    orders[idx].highestBid = { bidderId, amount:bidAmount, currency, placedAt:bid.placedAt };
    flushGlobal("nft_orders", orders);

    metaLog(AGENT, bidderId, "nft_bid_placed", { orderId, bidAmount }, "INFO");
    return ok(AGENT, bid, { warning: TRADE_WARN });
}

function getTradeHistory({ userId, limit = 50 }) {
    let history = loadGlobal("nft_trade_history", []);
    if (userId) history = history.filter(t => t.buyerId === userId || t.sellerId === userId);
    return ok(AGENT, { total: history.length, trades: history.slice(-limit).reverse(), warning: TRADE_WARN });
}

module.exports = { createListing, buyNFT, placeBid, getTradeHistory };
