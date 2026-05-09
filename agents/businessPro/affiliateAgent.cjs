/**
 * Affiliate Agent — manage affiliates, track referrals, calculate commissions.
 * Persists to data/businesspro/affiliates.json
 */

const { load, flush, uid, NOW } = require("./_store.cjs");

const AFF_STORE = "affiliates";
const REF_STORE = "referrals";

function _affs() { return load(AFF_STORE, []); }
function _refs() { return load(REF_STORE, []); }
function _saveAffs(d) { flush(AFF_STORE, d); }
function _saveRefs(d) { flush(REF_STORE, d); }

const DEFAULT_COMMISSION = 0.20; // 20%
const TIERS = [
    { name: "Bronze", minSales: 0,   rate: 0.15 },
    { name: "Silver", minSales: 10,  rate: 0.20 },
    { name: "Gold",   minSales: 30,  rate: 0.25 },
    { name: "Platinum", minSales: 100, rate: 0.30 }
];

function _tier(totalSales) {
    let tier = TIERS[0];
    for (const t of TIERS) { if (totalSales >= t.minSales) tier = t; }
    return tier;
}

function addAffiliate({ name, email, phone, commissionRate }) {
    if (!name || !email) throw new Error("name and email required");
    const affs = _affs();
    if (affs.find(a => a.email === email)) throw new Error("Affiliate already exists");
    const code = `AFF-${name.replace(/\s+/g, "").toUpperCase().slice(0, 6)}-${uid("").slice(-4)}`;
    const aff  = { id: uid("aff"), name, email, phone: phone || "", referralCode: code, commissionRate: commissionRate || DEFAULT_COMMISSION, totalSales: 0, totalEarned: 0, pendingPayout: 0, tier: "Bronze", active: true, joinedAt: NOW() };
    affs.push(aff);
    _saveAffs(affs);
    return aff;
}

function recordReferral({ affiliateCode, orderId, amount }) {
    if (!affiliateCode || !amount) throw new Error("affiliateCode and amount required");
    const affs  = _affs();
    const aff   = affs.find(a => a.referralCode === affiliateCode);
    if (!aff) throw new Error(`Affiliate code "${affiliateCode}" not found`);

    const tier       = _tier(aff.totalSales + 1);
    const commission = Math.round(amount * tier.rate * 100) / 100;

    aff.totalSales   += 1;
    aff.totalEarned  += commission;
    aff.pendingPayout += commission;
    aff.tier          = tier.name;
    _saveAffs(affs);

    const refs = _refs();
    refs.push({ id: uid("ref"), affiliateId: aff.id, affiliateCode, orderId: orderId || uid("ord"), amount, commission, tier: tier.name, status: "pending", createdAt: NOW() });
    _saveRefs(refs);

    return { affiliateName: aff.name, commission, tier: tier.name, totalEarned: aff.totalEarned };
}

function payout(affiliateId) {
    const affs = _affs();
    const aff  = affs.find(a => a.id === affiliateId);
    if (!aff) throw new Error("Affiliate not found");
    const amount = aff.pendingPayout;
    aff.pendingPayout = 0;
    _saveAffs(affs);

    // Mark referrals as paid
    const refs = _refs().map(r => r.affiliateId === affiliateId && r.status === "pending" ? { ...r, status: "paid", paidAt: NOW() } : r);
    _saveRefs(refs);

    return { affiliateId, name: aff.name, amountPaid: amount, paidAt: NOW() };
}

function listAffiliates() { return _affs(); }
function getStats(affiliateId) {
    const aff  = _affs().find(a => a.id === affiliateId);
    if (!aff) throw new Error("Not found");
    const refs = _refs().filter(r => r.affiliateId === affiliateId);
    return { ...aff, referrals: refs };
}

async function run(task) {
    const p = task.payload || {};
    try {
        let data;
        switch (task.type) {
            case "add_affiliate":      data = addAffiliate(p); break;
            case "record_referral":    data = recordReferral(p); break;
            case "affiliate_payout":   data = payout(p.affiliateId); break;
            case "list_affiliates":    data = { affiliates: listAffiliates() }; break;
            case "affiliate_stats":    data = getStats(p.affiliateId); break;
            default:                   data = { affiliates: listAffiliates(), tiers: TIERS };
        }
        return { success: true, type: "business_pro", agent: "affiliateAgent", data };
    } catch (err) {
        return { success: false, type: "business_pro", agent: "affiliateAgent", data: { error: err.message } };
    }
}

module.exports = { addAffiliate, recordReferral, payout, listAffiliates, getStats, run };
