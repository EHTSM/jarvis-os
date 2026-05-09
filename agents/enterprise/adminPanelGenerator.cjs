/**
 * Admin Panel Generator — generates admin UI config and superadmin views.
 */

const { loadGlobal, requireAuth, NOW, ok, fail, forbidden } = require("./_enterpriseStore.cjs");

function generatePanel(tenantId, requesterId) {
    const auth = requireAuth(tenantId, requesterId, "admin");
    if (!auth.ok) return forbidden("adminPanelGenerator", auth.error);

    const tenants = loadGlobal("tenants", {});
    const tenant  = tenants[tenantId];

    const sections = [
        { id: "overview",    label: "Overview",         icon: "🏠", route: "/admin",            access: "manager"    },
        { id: "members",     label: "Team Members",     icon: "👥", route: "/admin/members",    access: "admin"      },
        { id: "billing",     label: "Billing & Plans",  icon: "💳", route: "/admin/billing",    access: "admin"      },
        { id: "usage",       label: "Usage & Limits",   icon: "📊", route: "/admin/usage",      access: "manager"    },
        { id: "audit",       label: "Audit Logs",       icon: "🔍", route: "/admin/audit",      access: "admin"      },
        { id: "security",    label: "Security",         icon: "🔒", route: "/admin/security",   access: "admin"      },
        { id: "compliance",  label: "Compliance",       icon: "✅", route: "/admin/compliance", access: "admin"      },
        { id: "org",         label: "Org Structure",    icon: "🏢", route: "/admin/org",        access: "manager"    },
        { id: "support",     label: "Support Tickets",  icon: "🎫", route: "/admin/support",    access: "manager"    },
        { id: "settings",    label: "Settings",         icon: "⚙️",  route: "/admin/settings",   access: "admin"      },
        { id: "branding",    label: "Branding",         icon: "🎨", route: "/admin/branding",   access: "admin"      },
        { id: "integrations",label: "Integrations",     icon: "🔌", route: "/admin/integrations",access: "admin"     }
    ];

    return ok("adminPanelGenerator", {
        tenantId,
        tenant:   { name: tenant?.name, plan: tenant?.plan },
        sections,
        quickActions: [
            { label: "Invite Member",   action: "assign_role"     },
            { label: "Upgrade Plan",    action: "change_plan"      },
            { label: "Export Audit Log",action: "query_logs"       },
            { label: "Create Backup",   action: "create_backup"    }
        ],
        generatedAt: NOW()
    });
}

async function run(task) {
    const p = task.payload || {};
    try { return generatePanel(p.tenantId, p.userId); }
    catch (err) { return fail("adminPanelGenerator", err.message); }
}

module.exports = { generatePanel, run };
