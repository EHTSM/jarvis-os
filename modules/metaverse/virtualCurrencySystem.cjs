"use strict";
const { loadUser, flushUser, loadGlobal, flushGlobal, metaLog, uid, NOW, ok, fail, blocked } = require("./_metaverseStore.cjs");

const AGENT = "virtualCurrencySystem";

// MVC = MetaVerse Coin — internal token, NOT a real cryptocurrency
const CURRENCY        = "MVC";
const INITIAL_BALANCE = 500;
const MAX_TRANSFER    = 100000;
const TX_FEE_RATE     = 0.025; // 2.5%

const WARN = "⚠️ MVC is an internal virtual currency only. It has no real-world monetary value.";

function getWallet({ userId }) {
    if (!userId) return fail(AGENT, "userId required");
    let wallet = loadUser(userId, "mv_wallet");
    if (!wallet) {
        wallet = { userId, balance: INITIAL_BALANCE, currency: CURRENCY, txCount:0, createdAt:NOW() };
        flushUser(userId, "mv_wallet", wallet);
        metaLog(AGENT, userId, "wallet_created", { initialBalance:INITIAL_BALANCE }, "INFO");
    }
    return ok(AGENT, wallet, { warning: WARN });
}

function transfer({ fromUserId, toUserId, amount }) {
    if (!fromUserId || !toUserId) return fail(AGENT, "fromUserId and toUserId required");
    if (fromUserId === toUserId) return fail(AGENT, "cannot transfer to yourself");
    if (typeof amount !== "number" || amount <= 0) return fail(AGENT, "amount must be > 0");
    if (amount > MAX_TRANSFER) return fail(AGENT, `single transfer limit is ${MAX_TRANSFER} MVC`);

    const fromWallet = loadUser(fromUserId, "mv_wallet", { balance:INITIAL_BALANCE, txCount:0 });
    const fee        = parseFloat((amount * TX_FEE_RATE).toFixed(4));
    const totalDebit = amount + fee;

    if (fromWallet.balance < totalDebit) {
        return blocked(AGENT, `insufficient balance (need ${totalDebit} MVC incl fee, have ${fromWallet.balance})`);
    }

    fromWallet.balance = parseFloat((fromWallet.balance - totalDebit).toFixed(4));
    fromWallet.txCount = (fromWallet.txCount || 0) + 1;
    flushUser(fromUserId, "mv_wallet", fromWallet);

    const toWallet = loadUser(toUserId, "mv_wallet", { userId:toUserId, balance:INITIAL_BALANCE, txCount:0, currency:CURRENCY, createdAt:NOW() });
    toWallet.balance = parseFloat((toWallet.balance + amount).toFixed(4));
    toWallet.txCount = (toWallet.txCount || 0) + 1;
    flushUser(toUserId, "mv_wallet", toWallet);

    const tx = { txId:uid("tx"), fromUserId, toUserId, amount, fee, currency:CURRENCY, type:"transfer", timestamp:NOW() };
    const ledger = loadGlobal("mvc_ledger", []);
    ledger.push(tx);
    flushGlobal("mvc_ledger", ledger.slice(-1000000));

    metaLog(AGENT, fromUserId, "mvc_transferred", { toUserId, amount, fee }, "INFO");
    return ok(AGENT, tx, { warning: WARN });
}

function mint({ adminId, recipientId, amount, reason }) {
    if (!adminId || !recipientId || !amount || !reason) return fail(AGENT, "adminId, recipientId, amount, and reason required");
    if (typeof amount !== "number" || amount <= 0 || amount > 100000) return fail(AGENT, "mint amount must be 1–100000");

    const wallet = loadUser(recipientId, "mv_wallet", { userId:recipientId, balance:0, txCount:0, currency:CURRENCY, createdAt:NOW() });
    wallet.balance = parseFloat((wallet.balance + amount).toFixed(4));
    flushUser(recipientId, "mv_wallet", wallet);

    const tx = { txId:uid("tx"), adminId, recipientId, amount, reason, currency:CURRENCY, type:"mint", timestamp:NOW() };
    const ledger = loadGlobal("mvc_ledger", []);
    ledger.push(tx);
    flushGlobal("mvc_ledger", ledger.slice(-1000000));

    metaLog(AGENT, adminId, "mvc_minted", { recipientId, amount, reason }, "WARN");
    return ok(AGENT, tx, { warning: WARN });
}

function getTransactionHistory({ userId, limit = 50 }) {
    if (!userId) return fail(AGENT, "userId required");
    const ledger = loadGlobal("mvc_ledger", []);
    const txs    = ledger.filter(t => t.fromUserId === userId || t.toUserId === userId || t.recipientId === userId);
    return ok(AGENT, { total:txs.length, transactions:txs.slice(-limit).reverse(), currency:CURRENCY, warning:WARN });
}

function getLeaderboard({ limit = 20 }) {
    // simple approach — read from known wallets in global ledger
    return ok(AGENT, { note:"Leaderboard requires indexed wallet aggregation — use analytics pipeline", warning:WARN });
}

module.exports = { getWallet, transfer, mint, getTransactionHistory, getLeaderboard };
