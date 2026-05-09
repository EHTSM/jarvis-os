/**
 * Load Balancer Agent — simulates and monitors request distribution across nodes.
 */

const { requireAuth, uid, NOW, ok, fail, forbidden } = require("./_enterpriseStore.cjs");

const NODES = [
    { id: "node-1", region: "ap-south-1", status: "healthy", weight: 1 },
    { id: "node-2", region: "ap-south-1", status: "healthy", weight: 1 },
    { id: "node-3", region: "us-east-1",  status: "healthy", weight: 1 }
];

const _nodeCounters = {};

function route({ tenantId, userId, requestType = "api" }) {
    const healthy = NODES.filter(n => n.status === "healthy");
    if (!healthy.length) return fail("loadBalancerAgent", "No healthy nodes available");

    // Weighted round-robin
    const counter = (_nodeCounters[tenantId] || 0) % healthy.length;
    _nodeCounters[tenantId] = counter + 1;

    const node = healthy[counter];
    return ok("loadBalancerAgent", {
        requestId:  uid("req"),
        routedTo:   node.id,
        region:     node.region,
        algorithm:  "weighted-round-robin",
        latencyMs:  Math.floor(Math.random() * 30) + 10,
        timestamp:  NOW()
    });
}

function getStatus(tenantId, requesterId) {
    const auth = requireAuth(tenantId, requesterId, "admin");
    if (!auth.ok) return forbidden("loadBalancerAgent", auth.error);

    return ok("loadBalancerAgent", {
        nodes:        NODES,
        healthy:      NODES.filter(n => n.status === "healthy").length,
        total:        NODES.length,
        algorithm:    "weighted-round-robin",
        checkedAt:    NOW()
    });
}

async function run(task) {
    const p = task.payload || {};
    try {
        const data = task.type === "lb_status" ? getStatus(p.tenantId, p.userId) : route(p);
        return data;
    } catch (err) { return fail("loadBalancerAgent", err.message); }
}

module.exports = { route, getStatus, NODES, run };
