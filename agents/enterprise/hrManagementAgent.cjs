/**
 * HR Management Agent — employee records and lifecycle management.
 */

const { load, flush, requireAuth, setMember, auditLog, uid, NOW, ok, fail, forbidden } = require("./_enterpriseStore.cjs");

function addEmployee({ tenantId, userId, employeeId, name, email, department, jobTitle, salary, startDate, role = "employee", manager = "" }) {
    const auth = requireAuth(tenantId, userId, "admin");
    if (!auth.ok) return forbidden("hrManagementAgent", auth.error);
    if (!name || !email || !department) return fail("hrManagementAgent", "name, email, department required");

    const employees = load(tenantId, "employees", []);
    if (employees.some(e => e.email === email)) return fail("hrManagementAgent", `Employee with email ${email} already exists`);

    const employee = {
        id:          uid("emp"),
        employeeId:  employeeId || uid("eid"),
        tenantId,
        name,
        email,
        department,
        jobTitle,
        salary:      salary || 0,
        startDate:   startDate || new Date().toDateString(),
        status:      "active",
        manager,
        role,
        documents:   [],
        addedBy:     userId,
        addedAt:     NOW()
    };

    employees.push(employee);
    flush(tenantId, "employees", employees);
    setMember(tenantId, email, role, { name, department, jobTitle });
    auditLog(tenantId, userId, "employee_added", { name, department });
    return ok("hrManagementAgent", employee);
}

function updateEmployee({ tenantId, userId, employeeId, updates = {} }) {
    const auth = requireAuth(tenantId, userId, "admin");
    if (!auth.ok) return forbidden("hrManagementAgent", auth.error);

    const employees = load(tenantId, "employees", []);
    const emp       = employees.find(e => e.id === employeeId || e.employeeId === employeeId);
    if (!emp) return fail("hrManagementAgent", "Employee not found");

    const allowed = ["jobTitle", "department", "salary", "status", "manager", "role"];
    for (const k of allowed) { if (k in updates) emp[k] = updates[k]; }
    emp.updatedAt = NOW();
    flush(tenantId, "employees", employees);
    auditLog(tenantId, userId, "employee_updated", { employeeId, changes: Object.keys(updates) });
    return ok("hrManagementAgent", emp);
}

function getEmployee(tenantId, requesterId, employeeId) {
    const auth = requireAuth(tenantId, requesterId, "manager");
    if (!auth.ok) return forbidden("hrManagementAgent", auth.error);

    const emp = load(tenantId, "employees", []).find(e => e.id === employeeId || e.employeeId === employeeId);
    if (!emp) return fail("hrManagementAgent", "Employee not found");
    return ok("hrManagementAgent", emp);
}

function listEmployees(tenantId, requesterId, department = null) {
    const auth = requireAuth(tenantId, requesterId, "manager");
    if (!auth.ok) return forbidden("hrManagementAgent", auth.error);

    let employees = load(tenantId, "employees", []).filter(e => e.status === "active");
    if (department) employees = employees.filter(e => e.department === department);
    return ok("hrManagementAgent", { employees: employees.map(e => ({ id: e.id, name: e.name, department: e.department, jobTitle: e.jobTitle, status: e.status })), total: employees.length });
}

async function run(task) {
    const p = task.payload || {};
    try {
        if (task.type === "add_employee")    return addEmployee(p);
        if (task.type === "update_employee") return updateEmployee(p);
        if (task.type === "get_employee")    return getEmployee(p.tenantId, p.userId, p.employeeId);
        return listEmployees(p.tenantId, p.userId, p.department);
    } catch (err) { return fail("hrManagementAgent", err.message); }
}

module.exports = { addEmployee, updateEmployee, getEmployee, listEmployees, run };
