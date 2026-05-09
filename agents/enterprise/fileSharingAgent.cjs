/**
 * File Sharing Agent — tenant-isolated file metadata management.
 */

const { load, flush, requireAuth, auditLog, meter, uid, NOW, ok, fail, forbidden } = require("./_enterpriseStore.cjs");

const ALLOWED_TYPES = ["pdf","docx","xlsx","pptx","png","jpg","csv","txt","zip","mp4"];
const MAX_FILE_MB   = { free: 10, starter: 50, pro: 200, enterprise: 1000 };

function uploadFile({ tenantId, userId, name, sizeKB, type, folderId = "root", description = "" }) {
    const auth = requireAuth(tenantId, userId, "employee");
    if (!auth.ok) return forbidden("fileSharingAgent", auth.error);

    const ext = name.split(".").pop().toLowerCase();
    if (!ALLOWED_TYPES.includes(ext)) return fail("fileSharingAgent", `File type .${ext} not allowed`);

    const { loadGlobal } = require("./_enterpriseStore.cjs");
    const plan   = loadGlobal("tenants", {})[tenantId]?.plan || "free";
    const maxMB  = MAX_FILE_MB[plan] || 10;
    if (sizeKB / 1024 > maxMB) return fail("fileSharingAgent", `File exceeds ${maxMB}MB limit for ${plan} plan`);

    const file = { id: uid("file"), tenantId, name, sizeKB, type: ext, folderId, description, uploadedBy: userId, sharedWith: [], version: 1, uploadedAt: NOW() };
    const files = load(tenantId, "files", []);
    files.push(file);
    flush(tenantId, "files", files.slice(-5000));
    meter(tenantId, userId, "file_upload", 1);
    auditLog(tenantId, userId, "file_uploaded", { name, sizeKB });
    return ok("fileSharingAgent", file);
}

function shareFile({ tenantId, userId, fileId, shareWith = [], permission = "view" }) {
    const auth = requireAuth(tenantId, userId, "employee");
    if (!auth.ok) return forbidden("fileSharingAgent", auth.error);

    const files = load(tenantId, "files", []);
    const file  = files.find(f => f.id === fileId);
    if (!file) return fail("fileSharingAgent", "File not found");
    if (file.uploadedBy !== userId && !auth.member?.role?.includes("admin")) {
        return forbidden("fileSharingAgent", "Cannot share file you don't own");
    }

    file.sharedWith = [...new Set([...file.sharedWith, ...shareWith.map(u => ({ userId: u, permission }))])];
    flush(tenantId, "files", files);
    auditLog(tenantId, userId, "file_shared", { fileId, shareWith });
    return ok("fileSharingAgent", { shared: true, file });
}

function listFiles(tenantId, requesterId, folderId = "root") {
    const auth = requireAuth(tenantId, requesterId, "employee");
    if (!auth.ok) return forbidden("fileSharingAgent", auth.error);

    const files = load(tenantId, "files", []).filter(f =>
        f.folderId === folderId &&
        (f.uploadedBy === requesterId || f.sharedWith.some(s => s.userId === requesterId) || auth.member?.role === "admin")
    );
    const totalKB = files.reduce((s, f) => s + f.sizeKB, 0);
    return ok("fileSharingAgent", { files, total: files.length, totalMB: +(totalKB / 1024).toFixed(2) });
}

async function run(task) {
    const p = task.payload || {};
    try {
        if (task.type === "upload_file") return uploadFile(p);
        if (task.type === "share_file")  return shareFile(p);
        return listFiles(p.tenantId, p.userId, p.folderId || "root");
    } catch (err) { return fail("fileSharingAgent", err.message); }
}

module.exports = { uploadFile, shareFile, listFiles, run };
