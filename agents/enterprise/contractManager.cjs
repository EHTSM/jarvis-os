/**
 * Contract Manager — full contract lifecycle: draft, review, sign, expire.
 */

const { load, flush, requireAuth, auditLog, uid, NOW, ok, fail, forbidden } = require("./_enterpriseStore.cjs");

const CONTRACT_TYPES = ["vendor","client","employment","nda","partnership","service_agreement","lease"];
const STATUSES = ["draft","review","sent","signed","active","expired","terminated"];

function createContract({ tenantId, userId, title, type, parties = [], value = 0, startDate, endDate, terms = "" }) {
    const auth = requireAuth(tenantId, userId, "manager");
    if (!auth.ok) return forbidden("contractManager", auth.error);
    if (!CONTRACT_TYPES.includes(type)) return fail("contractManager", `Invalid type. Use: ${CONTRACT_TYPES.join(", ")}`);

    const contract = {
        id:        uid("con"),
        tenantId,
        title,
        type,
        parties,
        value,
        startDate: startDate || NOW(),
        endDate:   endDate   || null,
        terms:     terms.slice(0, 5000),
        status:    "draft",
        version:   1,
        history:   [],
        createdBy: userId,
        createdAt: NOW(),
        updatedAt: NOW()
    };

    const contracts = load(tenantId, "contracts", []);
    contracts.push(contract);
    flush(tenantId, "contracts", contracts.slice(-1000));
    auditLog(tenantId, userId, "contract_created", { title, type, value });
    return ok("contractManager", contract);
}

function updateStatus({ tenantId, userId, contractId, status, note = "" }) {
    const auth = requireAuth(tenantId, userId, "manager");
    if (!auth.ok) return forbidden("contractManager", auth.error);
    if (!STATUSES.includes(status)) return fail("contractManager", `Invalid status: ${status}`);

    const contracts = load(tenantId, "contracts", []);
    const contract  = contracts.find(c => c.id === contractId);
    if (!contract) return fail("contractManager", "Contract not found");

    contract.history.push({ from: contract.status, to: status, by: userId, note, at: NOW() });
    contract.status    = status;
    contract.updatedAt = NOW();
    flush(tenantId, "contracts", contracts);
    auditLog(tenantId, userId, "contract_status_changed", { contractId, status });
    return ok("contractManager", contract);
}

function getExpiring(tenantId, requesterId, days = 30) {
    const auth = requireAuth(tenantId, requesterId, "manager");
    if (!auth.ok) return forbidden("contractManager", auth.error);

    const cutoff    = Date.now() + days * 86_400_000;
    const contracts = load(tenantId, "contracts", []).filter(c =>
        c.status === "active" && c.endDate && new Date(c.endDate).getTime() <= cutoff
    );

    return ok("contractManager", { expiring: contracts, count: contracts.length, withinDays: days });
}

function listContracts(tenantId, requesterId, status = null) {
    const auth = requireAuth(tenantId, requesterId, "employee");
    if (!auth.ok) return forbidden("contractManager", auth.error);

    let contracts = load(tenantId, "contracts", []);
    if (status) contracts = contracts.filter(c => c.status === status);
    return ok("contractManager", { contracts: contracts.slice(-50), total: contracts.length });
}

async function run(task) {
    const p = task.payload || {};
    try {
        if (task.type === "create_contract") return createContract(p);
        if (task.type === "update_contract") return updateStatus(p);
        if (task.type === "expiring_contracts") return getExpiring(p.tenantId, p.userId, p.days || 30);
        return listContracts(p.tenantId, p.userId, p.status);
    } catch (err) { return fail("contractManager", err.message); }
}

module.exports = { createContract, updateStatus, getExpiring, listContracts, run };
