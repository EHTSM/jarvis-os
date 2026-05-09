/**
 * Wallet Agent — per-user balance management with persistent JSON store.
 */

const fs   = require("fs");
const path = require("path");

const WALLET_DIR  = path.join(__dirname, "../../data/wallets");
const CURRENCY    = "INR";
const MAX_BALANCE = 1_000_000;

function _filePath(userId) {
    return path.join(WALLET_DIR, `${String(userId).replace(/[^a-z0-9_-]/gi, "_")}.json`);
}

function _loadWallet(userId) {
    const file = _filePath(userId);
    if (!fs.existsSync(WALLET_DIR)) fs.mkdirSync(WALLET_DIR, { recursive: true });
    if (!fs.existsSync(file)) return { userId, balance: 0, currency: CURRENCY, transactions: [], createdAt: new Date().toISOString() };
    return JSON.parse(fs.readFileSync(file, "utf8"));
}

function _saveWallet(wallet) {
    if (!fs.existsSync(WALLET_DIR)) fs.mkdirSync(WALLET_DIR, { recursive: true });
    fs.writeFileSync(_filePath(wallet.userId), JSON.stringify(wallet, null, 2));
}

function _addTx(wallet, type, amount, note = "") {
    wallet.transactions.push({
        id:        `tx_${Date.now()}`,
        type,
        amount,
        balance:   wallet.balance,
        note,
        at:        new Date().toISOString()
    });
    wallet.transactions = wallet.transactions.slice(-100);
}

function checkBalance({ userId }) {
    if (!userId) return { success: false, error: "userId is required" };

    const wallet = _loadWallet(userId);
    return {
        success:  true,
        userId,
        balance:  wallet.balance,
        currency: CURRENCY,
        lastTx:   wallet.transactions.at(-1) || null
    };
}

function addFunds({ userId, amount, note = "Top-up" }) {
    if (!userId) return { success: false, error: "userId is required" };

    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0)        return { success: false, error: "Amount must be positive" };
    if (amt > 100_000)                 return { success: false, error: "Single top-up limit is ₹1,00,000" };

    const wallet = _loadWallet(userId);
    if (wallet.balance + amt > MAX_BALANCE) return { success: false, error: `Balance would exceed limit of ₹${MAX_BALANCE}` };

    wallet.balance += amt;
    _addTx(wallet, "credit", amt, note);
    _saveWallet(wallet);

    return {
        success:    true,
        userId,
        added:      amt,
        newBalance: wallet.balance,
        currency:   CURRENCY
    };
}

function deductFunds({ userId, amount, note = "Deduction" }) {
    if (!userId) return { success: false, error: "userId is required" };

    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0)   return { success: false, error: "Amount must be positive" };

    const wallet = _loadWallet(userId);
    if (wallet.balance < amt)     return { success: false, error: "Insufficient balance" };

    wallet.balance -= amt;
    wallet.balance  = parseFloat(wallet.balance.toFixed(2));
    _addTx(wallet, "debit", amt, note);
    _saveWallet(wallet);

    return {
        success:    true,
        userId,
        deducted:   amt,
        newBalance: wallet.balance,
        currency:   CURRENCY
    };
}

function getHistory({ userId, limit = 20 }) {
    if (!userId) return { success: false, error: "userId is required" };

    const wallet = _loadWallet(userId);
    return {
        success:      true,
        userId,
        balance:      wallet.balance,
        currency:     CURRENCY,
        transactions: wallet.transactions.slice(-limit).reverse()
    };
}

module.exports = { checkBalance, addFunds, deductFunds, getHistory };
