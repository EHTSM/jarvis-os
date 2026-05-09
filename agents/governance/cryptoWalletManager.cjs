"use strict";
const crypto = require("crypto");
const { load, flush, uid, NOW, govAudit, ok, fail, blocked, GOV_DISCLAIMER } = require("./_governanceStore.cjs");
const AGENT = "cryptoWalletManager";

const NETWORK_CONFIG = {
    ethereum:  { name:"Ethereum",  symbol:"ETH",  decimals:18, addressPrefix:"0x" },
    polygon:   { name:"Polygon",   symbol:"MATIC", decimals:18, addressPrefix:"0x" },
    bitcoin:   { name:"Bitcoin",   symbol:"BTC",  decimals:8,  addressPrefix:"1|3|bc1" },
    solana:    { name:"Solana",    symbol:"SOL",  decimals:9,  addressPrefix:"" },
    bnb_chain: { name:"BNB Chain", symbol:"BNB",  decimals:18, addressPrefix:"0x" }
};

const SECURITY_TIERS = {
    hot:      { name:"Hot Wallet",      risk:"HIGH",   recommended:"Development / small amounts only. NEVER store large holdings." },
    warm:     { name:"Warm Wallet",     risk:"MEDIUM", recommended:"Regular operational use with moderate balances." },
    cold:     { name:"Cold Wallet",     risk:"LOW",    recommended:"Long-term storage. Use hardware wallet (Ledger, Trezor)." },
    multisig: { name:"MultiSig Wallet", risk:"LOW",    recommended:"DAO treasury or team funds. Require m-of-n signatures." }
};

function _simulateAddress(network) {
    if (network === "bitcoin") return "bc1q" + crypto.randomBytes(20).toString("hex").slice(0,38);
    if (network === "solana")  return crypto.randomBytes(32).toString("base64url").slice(0,44);
    return "0x" + crypto.randomBytes(20).toString("hex");
}

function createWallet({ userId, network = "ethereum", label, tier = "hot", tags = [] }) {
    if (!userId) return fail(AGENT, "userId required");
    if (!NETWORK_CONFIG[network]) return fail(AGENT, `network must be: ${Object.keys(NETWORK_CONFIG).join(", ")}`);
    if (!SECURITY_TIERS[tier]) return fail(AGENT, `tier must be: ${Object.keys(SECURITY_TIERS).join(", ")}`);

    const net     = NETWORK_CONFIG[network];
    const tierConf= SECURITY_TIERS[tier];
    const address = _simulateAddress(network);
    const walletId= uid("wlt");

    const wallet = {
        id:       walletId,
        label:    label || `${net.name} Wallet`,
        network,
        networkName: net.name,
        symbol:   net.symbol,
        address,
        tier,
        tierName: tierConf.name,
        tags,
        balance:  0,
        transactions: [],
        createdAt:NOW(),
        createdBy:userId
    };

    const wallets = load(userId, "wallets", []);
    wallets.push(wallet);
    flush(userId, "wallets", wallets);

    govAudit(AGENT, userId, "wallet_created", { walletId, network, tier }, "HIGH");

    return ok(AGENT, {
        walletId,
        label:     wallet.label,
        network:   net.name,
        symbol:    net.symbol,
        address,
        tier:      tierConf.name,
        securityNote: tierConf.recommended,
        warning:   tier === "hot" ? "⚠️ Hot wallet — never store significant funds. Use cold/hardware wallet for large amounts." : null,
        note:      "SIMULATION MODE — this is not a real wallet. No private keys are generated or stored.",
        disclaimer:GOV_DISCLAIMER
    });
}

function recordTransaction({ userId, walletId, type, amount, toAddress, fromAddress, network, txHash, note }) {
    if (!userId || !walletId || !type || !amount) return fail(AGENT, "userId, walletId, type, and amount required");

    const validTypes = ["send","receive","swap","stake","unstake","approve","contract_call"];
    if (!validTypes.includes(type)) return fail(AGENT, `type must be: ${validTypes.join(", ")}`);
    if (amount <= 0) return fail(AGENT, "amount must be positive");

    const wallets = load(userId, "wallets", []);
    const wallet  = wallets.find(w => w.id === walletId);
    if (!wallet) return fail(AGENT, `Wallet ${walletId} not found`);

    if (type === "send" && amount > wallet.balance) {
        return blocked(AGENT, `Insufficient simulated balance — wallet has ${wallet.balance} ${wallet.symbol}, tried to send ${amount}`, "MEDIUM");
    }

    const txn = {
        id:         uid("txn"),
        type,
        amount,
        symbol:     wallet.symbol,
        toAddress:  toAddress || null,
        fromAddress:fromAddress || null,
        txHash:     txHash || ("0x" + crypto.randomBytes(32).toString("hex")),
        note:       note || null,
        timestamp:  NOW(),
        status:     "SIMULATED"
    };

    if (type === "send" || type === "swap" || type === "stake")   wallet.balance -= amount;
    if (type === "receive" || type === "unstake")                  wallet.balance += amount;

    wallet.transactions.push(txn);
    flush(userId, "wallets", wallets);

    govAudit(AGENT, userId, "transaction_recorded", { walletId, txnId:txn.id, type, amount }, "HIGH");

    return ok(AGENT, { ...txn, newBalance: wallet.balance, note:"SIMULATION — no real transaction submitted", disclaimer:GOV_DISCLAIMER });
}

function getWallets({ userId, network, tier }) {
    if (!userId) return fail(AGENT, "userId required");

    let wallets = load(userId, "wallets", []);
    if (network) wallets = wallets.filter(w => w.network === network);
    if (tier)    wallets = wallets.filter(w => w.tier === tier);

    return ok(AGENT, {
        total:   wallets.length,
        wallets: wallets.map(w => ({ id:w.id, label:w.label, network:w.networkName, symbol:w.symbol, address:w.address, tier:w.tierName, balance:w.balance, txnCount:w.transactions.length, createdAt:w.createdAt })),
        disclaimer: GOV_DISCLAIMER
    });
}

function getSecurityGuide() {
    return ok(AGENT, {
        tiers:             Object.entries(SECURITY_TIERS).map(([k,v]) => ({ key:k, ...v })),
        bestPractices: [
            "Never share your seed phrase — not even with support",
            "Store seed phrase offline on paper or metal backup — never digitally",
            "Use hardware wallets (Ledger Nano X, Trezor Model T) for holdings > $1,000",
            "Enable 2FA on all exchange accounts",
            "Use a dedicated device for crypto activities",
            "Verify contract addresses from official sources before approving",
            "Be aware of address poisoning attacks — always double-check the last 6 characters",
            "Set token approval limits — never approve unlimited spend"
        ],
        hardwareWallets:["Ledger Nano X", "Trezor Model T", "Coldcard (Bitcoin-only)", "Foundation Passport"],
        disclaimer:    GOV_DISCLAIMER
    });
}

module.exports = { createWallet, recordTransaction, getWallets, getSecurityGuide };
