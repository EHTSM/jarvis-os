/**
 * Custom Branding Agent — theme, color palette, and brand identity generator.
 */

const { load, flush, requireAuth, auditLog, uid, NOW, ok, fail, forbidden } = require("./_enterpriseStore.cjs");

const COLOR_PALETTES = {
    professional: { primary: "#1e40af", secondary: "#3b82f6", accent: "#93c5fd", bg: "#f8fafc", text: "#1e293b" },
    modern:       { primary: "#6366f1", secondary: "#8b5cf6", accent: "#c4b5fd", bg: "#fafafa",  text: "#111827" },
    corporate:    { primary: "#0f172a", secondary: "#475569", accent: "#94a3b8", bg: "#ffffff",  text: "#0f172a" },
    energetic:    { primary: "#ea580c", secondary: "#f97316", accent: "#fed7aa", bg: "#fff7ed",  text: "#431407" },
    fresh:        { primary: "#16a34a", secondary: "#22c55e", accent: "#86efac", bg: "#f0fdf4",  text: "#14532d" }
};

function applyBranding({ tenantId, userId, palette = "modern", customColors = {}, fontFamily = "Inter", logoText = "", tagline = "" }) {
    const auth = requireAuth(tenantId, userId, "admin");
    if (!auth.ok) return forbidden("customBrandingAgent", auth.error);

    const colors = { ...COLOR_PALETTES[palette], ...customColors };
    const brand  = {
        id:         uid("brand"),
        tenantId,
        palette,
        colors,
        fontFamily,
        logoText,
        tagline,
        cssVars: Object.entries(colors).map(([k, v]) => `--color-${k}: ${v};`).join("\n"),
        appliedAt:  NOW()
    };

    flush(tenantId, "branding", brand);
    auditLog(tenantId, userId, "branding_applied", { palette });
    return ok("customBrandingAgent", brand);
}

function getBranding(tenantId, requesterId) {
    const auth = requireAuth(tenantId, requesterId, "employee");
    if (!auth.ok) return forbidden("customBrandingAgent", auth.error);
    return ok("customBrandingAgent", load(tenantId, "branding", COLOR_PALETTES.modern));
}

async function run(task) {
    const p = task.payload || {};
    try {
        return task.type === "get_branding" ? getBranding(p.tenantId, p.userId) : applyBranding(p);
    } catch (err) { return fail("customBrandingAgent", err.message); }
}

module.exports = { applyBranding, getBranding, COLOR_PALETTES, run };
