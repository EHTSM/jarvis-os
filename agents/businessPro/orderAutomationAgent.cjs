/**
 * Order Automation Agent — processes orders through a lifecycle pipeline.
 * validate → confirm → fulfill → notify
 * Uses ecommerceManager for order state; WhatsApp for notifications.
 */

const { getProduct, updateOrder, listOrders, createOrder } = require("./ecommerceManager.cjs");
const { NOW, MAX_BATCH } = require("./_store.cjs");

function _sendWA(phone, message) {
    try {
        const { sendWhatsApp } = require("../../utils/whatsapp.cjs");
        return sendWhatsApp(phone, message);
    } catch { return Promise.resolve(false); }
}

const STATUS_FLOW = ["pending", "confirmed", "fulfilling", "shipped", "delivered", "cancelled"];

function _validate(order) {
    const errors = [];
    if (!order.items?.length)       errors.push("No items");
    if (!order.total || order.total <= 0) errors.push("Invalid total");
    for (const item of order.items || []) {
        const prod = getProduct(item.productId);
        if (!prod) { errors.push(`Product ${item.productId} not found`); continue; }
        if (prod.stock < (item.qty || 1)) errors.push(`${prod.name}: insufficient stock (${prod.stock} < ${item.qty || 1})`);
    }
    return errors;
}

async function processOrder(orderId) {
    const orders = listOrders({ limit: 500 });
    const order  = orders.find(o => o.id === orderId);
    if (!order) throw new Error(`Order ${orderId} not found`);

    const log = [];

    // Validate
    const errors = _validate(order);
    if (errors.length) {
        updateOrder(orderId, { status: "cancelled", notes: `Validation failed: ${errors.join("; ")}` });
        return { orderId, status: "cancelled", errors, log };
    }
    log.push("validated");

    // Confirm
    updateOrder(orderId, { status: "confirmed", confirmedAt: NOW() });
    log.push("confirmed");

    // Fulfill (simulate)
    updateOrder(orderId, { status: "fulfilling", fulfillStartAt: NOW() });
    log.push("fulfilling");

    // Assign tracking
    const trackingId = `TRK-${Date.now().toString().slice(-8)}`;
    updateOrder(orderId, { status: "shipped", trackingId, shippedAt: NOW() });
    log.push(`shipped: ${trackingId}`);

    // Notify customer via WhatsApp
    if (order.customerPhone) {
        const msg = `Hi ${order.customerName || "there"}! 📦 Your order #${orderId.slice(-6)} has shipped.\n\nTracking: ${trackingId}\n\nThank you for your purchase! 🙏`;
        await _sendWA(order.customerPhone, msg);
        log.push("customer notified");
    }

    return { orderId, status: "shipped", trackingId, log };
}

async function processAll() {
    const pending = listOrders({ status: "pending" }).slice(0, MAX_BATCH);
    const results = [];
    for (const o of pending) {
        try { results.push(await processOrder(o.id)); }
        catch (err) { results.push({ orderId: o.id, error: err.message }); }
    }
    return { processed: results.length, results };
}

async function run(task) {
    const p = task.payload || {};
    try {
        let data;
        if (task.type === "process_order" && p.orderId) {
            data = await processOrder(p.orderId);
        } else if (task.type === "process_all_orders") {
            data = await processAll();
        } else if (task.type === "create_and_process") {
            const order = createOrder(p);
            data = await processOrder(order.id);
        } else {
            data = await processAll();
        }
        return { success: true, type: "business_pro", agent: "orderAutomationAgent", data };
    } catch (err) {
        return { success: false, type: "business_pro", agent: "orderAutomationAgent", data: { error: err.message } };
    }
}

module.exports = { processOrder, processAll, run };
