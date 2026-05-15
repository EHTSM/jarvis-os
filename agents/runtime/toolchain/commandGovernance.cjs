"use strict";

// ── Governance rules ──────────────────────────────────────────────────
// Each rule: { pattern, label, reason, severity }
const RULES = [
    // Destructive filesystem
    { pattern: /\brm\s+(-\w*r\w*f|-\w*f\w*r)\b/i,          label: "recursive_force_delete",    reason: "rm -rf is irreversible",                    severity: "destructive" },
    { pattern: /\brm\s+-[a-z]*r[a-z]*\s+\//i,               label: "delete_root",               reason: "deleting from filesystem root",              severity: "destructive" },
    { pattern: /\bdd\s+if=\S+\s+of=\/dev\//i,               label: "disk_overwrite",            reason: "direct disk write via dd",                   severity: "destructive" },
    { pattern: /\b(DROP\s+TABLE|TRUNCATE\s+TABLE|DROP\s+DATABASE)/i, label: "destructive_sql",  reason: "destructive SQL statement",                  severity: "destructive" },
    { pattern: /^git\s+reset\s+--hard\b/i,                   label: "git_hard_reset",            reason: "discards all uncommitted changes",            severity: "destructive" },
    { pattern: /^git\s+clean\s+-[a-z]*f/i,                   label: "git_force_clean",           reason: "permanently removes untracked files",         severity: "destructive" },
    { pattern: /^git\s+push\s+.*--force\b/i,                 label: "git_force_push",            reason: "force-push overwrites remote history",        severity: "destructive" },
    { pattern: /^docker\s+(rm|rmi|system\s+prune)\b/i,       label: "docker_destructive",        reason: "destroys docker resources",                  severity: "destructive" },
    { pattern: /:\s*\(\s*\)\s*\{.*:\|:\s*&\s*\}/,            label: "fork_bomb",                 reason: "fork bomb — crash risk",                     severity: "destructive" },
    { pattern: /^shred\b/i,                                   label: "shred_files",               reason: "shred permanently destroys file data",        severity: "destructive" },

    // Dangerous operations
    { pattern: /\bsudo\b/i,                                   label: "sudo_elevation",            reason: "privilege escalation via sudo",               severity: "dangerous" },
    { pattern: /(curl|wget)\s+.*\|\s*(bash|sh|zsh|node)/i,   label: "pipe_to_shell",             reason: "piping remote content to shell is unsafe",    severity: "dangerous" },
    { pattern: /^chmod\s+(-R\s*)?777\b/i,                    label: "chmod_777",                 reason: "chmod 777 grants world-write access",         severity: "dangerous" },
    { pattern: /^chmod\s+(-R\s*)?a\+/i,                      label: "chmod_all_plus",            reason: "adding permissions for all users",            severity: "dangerous" },
    { pattern: /^chown\s+-R\b/i,                              label: "chown_recursive",           reason: "recursive ownership change",                  severity: "dangerous" },
    { pattern: /^chown\s+.*root\b/i,                          label: "chown_root",                reason: "transferring ownership to root",              severity: "dangerous" },
    { pattern: /^(kill|killall|pkill)\b/i,                    label: "process_kill",              reason: "terminating processes",                      severity: "dangerous" },
    { pattern: /^systemctl\s+(start|stop|restart|enable|disable|daemon-reload)/i, label: "systemctl_mutate", reason: "mutating system services",   severity: "dangerous" },
    { pattern: /^(apt|apt-get|yum|brew|dnf)\s+(install|remove|purge|upgrade)/i,  label: "package_manager",  reason: "system package modification",      severity: "dangerous" },
    { pattern: /^npm\s+publish\b/i,                          label: "npm_publish",               reason: "publishing to npm registry requires approval", severity: "dangerous" },
    { pattern: /^(mount|umount)\b/i,                         label: "mount_operation",           reason: "mounting/unmounting filesystems",             severity: "dangerous" },
    { pattern: /^(iptables|ufw|firewall-cmd)\b/i,            label: "firewall_mutate",           reason: "firewall rule modification",                 severity: "dangerous" },
];

function check(command) {
    if (typeof command !== "string" || !command.trim()) {
        return { blocked: false, violations: [] };
    }
    const cmd        = command.trim();
    const violations = RULES.filter(r => r.pattern.test(cmd)).map(r => ({
        label:    r.label,
        reason:   r.reason,
        severity: r.severity,
    }));

    const blocked = violations.length > 0;
    return { blocked, violations };
}

function checkSteps(steps = []) {
    return steps.map(step => ({
        stepId:  step.id ?? step.name ?? "unknown",
        command: step.command ?? "",
        ...check(step.command ?? ""),
    }));
}

function anyBlocked(steps = []) {
    return checkSteps(steps).some(s => s.blocked);
}

module.exports = { RULES, check, checkSteps, anyBlocked };
