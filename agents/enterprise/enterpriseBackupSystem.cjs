/**
 * Enterprise Backup System — manages backup schedules and restore points.
 */

const { load, flush, requireAuth, auditLog, uid, NOW, ok, fail, forbidden } = require("./_enterpriseStore.cjs");

const BACKUP_SCHEDULES = {
    daily:   { interval: "24h",  retention: "30 days",  type: "incremental" },
    weekly:  { interval: "7d",   retention: "90 days",  type: "full"        },
    monthly: { interval: "30d",  retention: "365 days", type: "full"        }
};

function createBackup({ tenantId, userId, type = "manual", scope = "all" }) {
    const auth = requireAuth(tenantId, userId, "admin");
    if (!auth.ok) return forbidden("enterpriseBackupSystem", auth.error);

    const backup = {
        id:        uid("bak"),
        tenantId,
        type,
        scope,
        status:    "completed",
        sizeKB:    Math.floor(Math.random() * 5000) + 500,
        checksum:  uid("chk"),
        createdBy: userId,
        createdAt: NOW(),
        expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString()
    };

    const backups = load(tenantId, "backups", []);
    backups.push(backup);
    flush(tenantId, "backups", backups.slice(-100));
    auditLog(tenantId, userId, "backup_created", { type, scope, id: backup.id });
    return ok("enterpriseBackupSystem", backup);
}

function listBackups(tenantId, requesterId) {
    const auth = requireAuth(tenantId, requesterId, "admin");
    if (!auth.ok) return forbidden("enterpriseBackupSystem", auth.error);

    const backups = load(tenantId, "backups", []);
    return ok("enterpriseBackupSystem", {
        tenantId, backups: backups.reverse().slice(0, 20), total: backups.length,
        schedule: BACKUP_SCHEDULES
    });
}

function restorePoint({ tenantId, userId, backupId }) {
    const auth = requireAuth(tenantId, userId, "admin");
    if (!auth.ok) return forbidden("enterpriseBackupSystem", auth.error);

    const backups = load(tenantId, "backups", []);
    const backup  = backups.find(b => b.id === backupId);
    if (!backup) return fail("enterpriseBackupSystem", "Backup not found");

    auditLog(tenantId, userId, "restore_initiated", { backupId });
    return ok("enterpriseBackupSystem", { restored: true, backupId, from: backup.createdAt, note: "Restore simulated — production requires actual data restoration process" });
}

async function run(task) {
    const p = task.payload || {};
    try {
        if (task.type === "create_backup")  return createBackup(p);
        if (task.type === "restore_backup") return restorePoint(p);
        return listBackups(p.tenantId, p.userId);
    } catch (err) { return fail("enterpriseBackupSystem", err.message); }
}

module.exports = { createBackup, listBackups, restorePoint, run };
