/**
 * Payroll Agent — salary structure, deductions, and payslip generation.
 */

const { load, flush, requireAuth, auditLog, uid, NOW, ok, fail, forbidden } = require("./_enterpriseStore.cjs");

function _calcDeductions(gross) {
    const pf        = Math.round(Math.min(gross * 0.12, 1800));  // PF: 12% up to ₹1800
    const esi       = gross <= 21000 ? Math.round(gross * 0.0075) : 0; // ESI: 0.75% if gross ≤ 21k
    const tax       = gross > 50000 ? Math.round((gross - 50000) * 0.1) : 0;
    const professional = 200; // Professional tax (fixed)
    const total     = pf + esi + tax + professional;
    return { pf, esi, tax, professional, total };
}

function generatePayslip({ tenantId, userId, employeeId, month, overrides = {} }) {
    const auth = requireAuth(tenantId, userId, "admin");
    if (!auth.ok) return forbidden("payrollAgent", auth.error);

    const employees = load(tenantId, "employees", []);
    const emp       = employees.find(e => e.id === employeeId || e.employeeId === employeeId);
    if (!emp) return fail("payrollAgent", "Employee not found");

    const gross      = overrides.gross || emp.salary || 0;
    const deductions = _calcDeductions(gross);
    const net        = gross - deductions.total;

    const payslip = {
        id:           uid("pay"),
        tenantId,
        employeeId,
        employeeName: emp.name,
        month:        month || new Date().toISOString().slice(0, 7),
        grossSalary:  gross,
        deductions,
        netSalary:    net,
        status:       "generated",
        generatedBy:  userId,
        generatedAt:  NOW()
    };

    const payroll = load(tenantId, "payroll", []);
    payroll.push(payslip);
    flush(tenantId, "payroll", payroll.slice(-10000));
    auditLog(tenantId, userId, "payslip_generated", { employeeId, month, net });
    return ok("payrollAgent", payslip);
}

function runPayroll({ tenantId, userId, month }) {
    const auth = requireAuth(tenantId, userId, "admin");
    if (!auth.ok) return forbidden("payrollAgent", auth.error);

    const employees = load(tenantId, "employees", []).filter(e => e.status === "active");
    const results   = employees.map(emp => {
        const gross  = emp.salary || 0;
        const deductions = _calcDeductions(gross);
        return { id: emp.id, name: emp.name, gross, net: gross - deductions.total };
    });

    const totalGross = results.reduce((s, r) => s + r.gross, 0);
    const totalNet   = results.reduce((s, r) => s + r.net, 0);

    auditLog(tenantId, userId, "payroll_run", { month, employees: employees.length, totalNet });
    return ok("payrollAgent", { month: month || new Date().toISOString().slice(0, 7), employees: results.length, totalGross, totalNet, currency: "INR" });
}

async function run(task) {
    const p = task.payload || {};
    try {
        if (task.type === "generate_payslip") return generatePayslip(p);
        if (task.type === "run_payroll")      return runPayroll(p);
        const auth = requireAuth(p.tenantId, p.userId, "admin");
        if (!auth.ok) return forbidden("payrollAgent", auth.error);
        return ok("payrollAgent", load(p.tenantId, "payroll", []).slice(-50));
    } catch (err) { return fail("payrollAgent", err.message); }
}

module.exports = { generatePayslip, runPayroll, run };
