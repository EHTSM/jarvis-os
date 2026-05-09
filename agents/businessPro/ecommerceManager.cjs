/**
 * E-commerce Manager — central orchestrator for products and orders.
 * Product data: data/businesspro/products.json
 * Order data:   data/businesspro/orders.json
 */

const { load, flush, uid, NOW } = require("./_store.cjs");

const P_STORE = "products";
const O_STORE = "orders";

// ── Products ──────────────────────────────────────────────────────
function _products()      { return load(P_STORE, []); }
function _orders()        { return load(O_STORE, []); }
function _saveProducts(d) { flush(P_STORE, d); }
function _saveOrders(d)   { flush(O_STORE, d); }

function addProduct({ name, price, currency = "INR", sku, category, stock = 0, description = "", images = [] }) {
    if (!name || !price) throw new Error("name and price required");
    const products = _products();
    if (products.find(p => p.sku === sku)) throw new Error(`SKU "${sku}" already exists`);

    const product = {
        id:          uid("prod"),
        name, price, currency, category,
        sku:         sku || uid("sku"),
        stock,
        description,
        images,
        active:      true,
        sales:       0,
        revenue:     0,
        createdAt:   NOW(),
        updatedAt:   NOW()
    };
    products.push(product);
    _saveProducts(products);
    return product;
}

function updateProduct(id, updates) {
    const products = _products();
    const p        = products.find(p => p.id === id || p.sku === id);
    if (!p) throw new Error("Product not found");
    Object.assign(p, { ...updates, updatedAt: NOW() });
    _saveProducts(products);
    return p;
}

function getProduct(id)  { return _products().find(p => p.id === id || p.sku === id) || null; }
function listProducts(filter = {}) {
    let products = _products();
    if (filter.category) products = products.filter(p => p.category === filter.category);
    if (filter.active !== undefined) products = products.filter(p => p.active === filter.active);
    return products;
}

// ── Orders ────────────────────────────────────────────────────────
function createOrder({ customerId, customerName, customerPhone, items, total, currency = "INR" }) {
    if (!items?.length) throw new Error("items array required");
    if (!total)         throw new Error("total required");

    const orders = _orders();
    const order  = {
        id:            uid("order"),
        customerId:    customerId || customerPhone,
        customerName:  customerName || "Customer",
        customerPhone: customerPhone || "",
        items,         // [{ productId, name, qty, price }]
        total,
        currency,
        status:        "pending",
        paymentStatus: "unpaid",
        trackingId:    null,
        notes:         "",
        createdAt:     NOW(),
        updatedAt:     NOW()
    };
    orders.push(order);
    _saveOrders(orders);

    // Update product stats
    for (const item of items) {
        try {
            const products = _products();
            const prod     = products.find(p => p.id === item.productId || p.sku === item.productId);
            if (prod) {
                prod.sales   += item.qty || 1;
                prod.revenue += (item.price || 0) * (item.qty || 1);
                prod.stock    = Math.max(0, prod.stock - (item.qty || 1));
            }
            _saveProducts(products);
        } catch { /* non-critical */ }
    }

    return order;
}

function updateOrder(id, updates) {
    const orders = _orders();
    const o      = orders.find(o => o.id === id);
    if (!o) throw new Error("Order not found");
    Object.assign(o, { ...updates, updatedAt: NOW() });
    _saveOrders(orders);
    return o;
}

function listOrders({ status, limit = 50 } = {}) {
    let orders = _orders();
    if (status) orders = orders.filter(o => o.status === status);
    return orders.slice(-limit).reverse();
}

function stats() {
    const products = _products();
    const orders   = _orders();
    const revenue  = orders.filter(o => o.paymentStatus === "paid").reduce((s, o) => s + o.total, 0);
    return {
        products: { total: products.length, active: products.filter(p => p.active).length },
        orders:   { total: orders.length, pending: orders.filter(o => o.status === "pending").length, revenue: `₹${revenue}` }
    };
}

async function run(task) {
    const p = task.payload || {};
    try {
        let data;
        switch (task.type) {
            case "add_product":      data = addProduct(p); break;
            case "update_product":   data = updateProduct(p.id, p.updates || p); break;
            case "get_product":      data = getProduct(p.id) || { error: "Not found" }; break;
            case "list_products":    data = { products: listProducts(p), stats: stats().products }; break;
            case "create_order":     data = createOrder(p); break;
            case "update_order":     data = updateOrder(p.id, p.updates || p); break;
            case "list_orders":      data = { orders: listOrders(p), stats: stats().orders }; break;
            case "ecommerce_stats":  data = stats(); break;
            default:                 data = stats();
        }
        return { success: true, type: "business_pro", agent: "ecommerceManager", data };
    } catch (err) {
        return { success: false, type: "business_pro", agent: "ecommerceManager", data: { error: err.message } };
    }
}

module.exports = { addProduct, updateProduct, getProduct, listProducts, createOrder, updateOrder, listOrders, stats, run };
