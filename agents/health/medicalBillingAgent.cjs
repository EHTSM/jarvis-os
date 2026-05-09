"use strict";
const { load, flush, uid, NOW, ok, fail, accessLog } = require("./_healthStore.cjs");

const AGENT = "medicalBillingAgent";

function analyzeBill({ userId, billItems = [], hospitalName, totalAmount }) {
    if (!userId)          return fail(AGENT, "userId required");
    if (!billItems.length) return fail(AGENT, "billItems array required: [{ item, amount, quantity }]");

    accessLog(userId, AGENT, "bill_analyzed", { itemCount: billItems.length, totalAmount });

    const computed = billItems.map(item => ({
        item:      item.item,
        quantity:  item.quantity || 1,
        unitRate:  item.unitRate || item.amount || 0,
        total:     (item.unitRate || item.amount || 0) * (item.quantity || 1)
    }));

    const sumTotal    = computed.reduce((s, i) => s + i.total, 0);
    const discrepancy = totalAmount ? Math.abs(totalAmount - sumTotal) > 1 : false;

    // Flag potentially unusual items
    const flags = [];
    for (const item of computed) {
        const name = (item.item || "").toLowerCase();
        if (name.includes("cotton") && item.total > 500)      flags.push({ item: item.item, reason: "Cotton/consumables at high cost — verify quantity" });
        if (name.includes("glove")  && item.total > 1000)     flags.push({ item: item.item, reason: "Verify glove count and type" });
        if (name.includes("saline") && item.unitRate > 200)   flags.push({ item: item.item, reason: "Saline typically <₹50-100 per bottle" });
        if (name.includes("bed charges") && item.unitRate > 20000) flags.push({ item: item.item, reason: "Verify bed category (general/deluxe/suite)" });
        if (item.total > 50000) flags.push({ item: item.item, reason: "High-value item — verify against procedure/admission notes" });
    }

    const bill = {
        id:           uid("bill"),
        userId,
        hospitalName: hospitalName || "Not specified",
        billItems:    computed,
        computedTotal: sumTotal,
        billedTotal:  totalAmount,
        discrepancy,
        flags,
        savedAt:      NOW()
    };

    const bills = load(userId, "medical_bills", []);
    bills.push(bill);
    flush(userId, "medical_bills", bills.slice(-100));

    return ok(AGENT, {
        bill,
        rightsInfo: [
            "You have the right to an itemised bill from any hospital",
            "Government hospitals must follow CGHS/state rate lists",
            "Private hospitals: check for NABH accreditation rate limits",
            "Under Clinical Establishments Act — patients have right to information",
            "If overcharged: file complaint with State Health Department or Consumer Forum"
        ],
        govRates: "CGHS rates available at cghs.gov.in — benchmark for government scheme rates"
    });
}

function getBills({ userId }) {
    if (!userId) return fail(AGENT, "userId required");
    accessLog(userId, AGENT, "bills_viewed");
    return ok(AGENT, load(userId, "medical_bills", []).slice(-20).reverse());
}

module.exports = { analyzeBill, getBills };
