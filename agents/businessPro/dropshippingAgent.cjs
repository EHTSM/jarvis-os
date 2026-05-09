/**
 * Dropshipping Agent — simulates the dropshipping pipeline.
 * source → list → order → fulfill
 * Uses supplierFinder + ecommerceManager. No real carrier integration.
 */

const { findSuppliers }           = require("./supplierFinderAgent.cjs");
const { addProduct, createOrder } = require("./ecommerceManager.cjs");
const { load, flush, uid, NOW }   = require("./_store.cjs");

const DS_STORE = "dropshipping";

function _load() { return load(DS_STORE, []); }
function _save(d) { flush(DS_STORE, d); }

const DEFAULT_MARGIN = 0.40; // 40% markup

async function sourceProduct({ name, category, supplierMoq = 1, margin = DEFAULT_MARGIN }) {
    if (!name) throw new Error("name required");

    // Find supplier
    const { mockSuppliers } = await findSuppliers({ category, product: name, moq: supplierMoq });
    const supplier = mockSuppliers[0];
    if (!supplier) throw new Error("No suitable supplier found");

    // Parse supplier price (take lower end of range)
    const rawPrice  = parseFloat((supplier.priceRange || "₹100-500").replace(/[₹,]/g, "").split("-")[0]) || 100;
    const sellPrice = Math.ceil(rawPrice * (1 + margin));

    // List in e-commerce store
    const product = addProduct({
        name:        `${name} (DS)`,
        price:       sellPrice,
        category:    category || supplier.categories[0] || "Other",
        sku:         `DS-${uid("sku").slice(-6)}`,
        stock:       999, // virtual stock for dropshipping
        description: `Dropshipped via ${supplier.name}. ${supplier.leadDays} day delivery.`
    });

    // Track DS entry
    const entries = _load();
    const entry   = { id: uid("ds"), productId: product.id, supplierId: supplier.id, supplierName: supplier.name, supplierContact: supplier.contact, costPrice: rawPrice, sellPrice, margin, leadDays: supplier.leadDays, createdAt: NOW() };
    entries.push(entry);
    _save(entries);

    return { dsEntry: entry, product, supplier };
}

async function fulfillOrder({ orderId, customerId, customerPhone, items, total }) {
    if (!items?.length) throw new Error("items required");

    const entries = _load();
    const fulfillments = [];

    for (const item of items) {
        const dsEntry = entries.find(e => e.productId === item.productId);
        const trackingId = `DS-TRK-${Date.now().toString().slice(-8)}`;

        if (dsEntry) {
            fulfillments.push({ productId: item.productId, supplierName: dsEntry.supplierName, contact: dsEntry.supplierContact, qty: item.qty || 1, trackingId, estimatedDelivery: `${dsEntry.leadDays} business days` });
        } else {
            fulfillments.push({ productId: item.productId, supplierName: "Unknown", qty: item.qty || 1, trackingId: null, note: "Not a tracked dropship product" });
        }
    }

    return { orderId: orderId || uid("order"), customerId, customerPhone, fulfillments, fulfilledAt: NOW() };
}

function listDsProducts() {
    return _load();
}

async function run(task) {
    const p = task.payload || {};
    try {
        let data;
        switch (task.type) {
            case "ds_source":  data = await sourceProduct({ name: p.name || p.product, category: p.category, supplierMoq: p.moq || 1, margin: p.margin || DEFAULT_MARGIN }); break;
            case "ds_fulfill": data = await fulfillOrder(p); break;
            case "ds_list":    data = { products: listDsProducts() }; break;
            default:           data = { products: listDsProducts(), usage: "ds_source | ds_fulfill | ds_list" };
        }
        return { success: true, type: "business_pro", agent: "dropshippingAgent", data };
    } catch (err) {
        return { success: false, type: "business_pro", agent: "dropshippingAgent", data: { error: err.message } };
    }
}

module.exports = { sourceProduct, fulfillOrder, listDsProducts, run };
