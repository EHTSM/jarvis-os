"use strict";

const CLASSIFICATIONS = ["safe", "elevated", "dangerous", "destructive"];

const SAFE_PATTERNS = [
    /^git\s+(status|log|diff|show|branch|tag|describe|shortlog|rev-parse|ls-files|stash\s+list)/i,
    /^npm\s+(list|ls|outdated|audit\s+report|view|info|pack --dry)/i,
    /^yarn\s+(list|info|why|audit)/i,
    /^docker\s+(ps|images|inspect|logs|stats|version|info)/i,
    /^(ls|ll|la|cat|echo|pwd|whoami|date|which|type|env|printenv|uname|hostname)/i,
    /^node\s+--version/i,
    /^(git\s+)?grep\b/i,
    /^find\b/i,
];

const ELEVATED_PATTERNS = [
    /^git\s+(commit|push|pull|fetch|merge|rebase|checkout|switch|add|reset\s+--soft|stash\s+(push|pop|apply))/i,
    /^npm\s+(install|ci|build|test|run\s+\w+|link|unlink)/i,
    /^yarn\s+(install|add|remove|build|test|run\s+\w+|upgrade)/i,
    /^pnpm\s+(install|add|remove|build|test|run\s+\w+)/i,
    /^docker\s+(build|pull|push|create|stop|start|restart|pause|unpause|network|volume)/i,
    /^(mkdir|cp|mv|touch|ln|chmod(?!\s+(777|-R\s*7|a\+)))/i,
    /^(tsc|babel|webpack|vite|rollup|esbuild|parcel)/i,
    /^(jest|mocha|vitest|pytest|go\s+test)\b/i,
];

const DANGEROUS_PATTERNS = [
    /^docker\s+(run|exec|attach)/i,
    /\bsudo\b/i,
    /^(curl|wget).*(bash|sh|zsh|python|ruby|perl|node)\b/i,
    /\|\s*(bash|sh|zsh|python|ruby|perl|node)\b/i,
    /^chmod\s+(-R\s*)?777\b/i,
    /^chmod\s+(-R\s*)?a\+/i,
    /^chown\s+-R\b/i,
    /^(kill|killall|pkill)\b/i,
    /^systemctl\s+(start|stop|restart|enable|disable|daemon-reload)/i,
    /^service\s+(start|stop|restart)\b/i,
    /^(apt|apt-get|yum|brew|dnf)\s+(install|remove|purge|update|upgrade)/i,
    /^npm\s+publish\b/i,
    /^(ssh|scp|rsync)\b/i,
    /^(iptables|ufw|firewall-cmd)\b/i,
    /^(crontab|at)\b/i,
    /^(mount|umount)\b/i,
];

const DESTRUCTIVE_PATTERNS = [
    /\brm\s+(-\w*r\w*f|-\w*f\w*r)\b/i,
    /\brm\s+-rf?\s+\//i,
    /\brm\s+-fr?\s+\//i,
    /^git\s+reset\s+--hard\b/i,
    /^git\s+clean\s+-[a-z]*f/i,
    /^git\s+push\s+.*--force\b/i,
    /^docker\s+(rm|rmi|system\s+prune)\b/i,
    /\bdd\s+if=/i,
    /\b(DROP\s+TABLE|TRUNCATE\s+TABLE|DROP\s+DATABASE)/i,
    /:\s*\(\s*\)\s*\{.*:\|:\s*&\s*\}/,   // fork bomb
    /\bformat\b.*\/dev\//i,
    /\bfdisk\b.*\/dev\//i,
    /^shred\b/i,
];

function classify(command) {
    if (typeof command !== "string" || !command.trim()) {
        return { classification: "safe", confidence: 1.0, patterns: [] };
    }
    const cmd = command.trim();
    const matched = [];

    for (const p of DESTRUCTIVE_PATTERNS) {
        if (p.test(cmd)) matched.push({ level: "destructive", pattern: p.source });
    }
    if (matched.length) return { classification: "destructive", confidence: 1.0, patterns: matched };

    for (const p of DANGEROUS_PATTERNS) {
        if (p.test(cmd)) matched.push({ level: "dangerous", pattern: p.source });
    }
    if (matched.length) return { classification: "dangerous", confidence: 0.9, patterns: matched };

    for (const p of ELEVATED_PATTERNS) {
        if (p.test(cmd)) matched.push({ level: "elevated", pattern: p.source });
    }
    if (matched.length) return { classification: "elevated", confidence: 0.8, patterns: matched };

    return { classification: "safe", confidence: 1.0, patterns: [] };
}

function classifySteps(steps = []) {
    return steps.map(step => ({
        stepId:  step.id ?? step.name ?? "unknown",
        command: step.command ?? "",
        ...classify(step.command ?? ""),
    }));
}

function worstClassification(steps = []) {
    const results = classifySteps(steps);
    const order   = { destructive: 3, dangerous: 2, elevated: 1, safe: 0 };
    return results.reduce((worst, r) =>
        (order[r.classification] ?? 0) > (order[worst] ?? 0) ? r.classification : worst,
        "safe"
    );
}

module.exports = { CLASSIFICATIONS, classify, classifySteps, worstClassification };
