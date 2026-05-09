"use strict";
/**
 * Addiction Tracker — sobriety tracking and support resources.
 * Does NOT provide medical detox guidance (withdrawal can be medically serious).
 * Always directs to professionals for medical detox.
 */
const { load, flush, uid, NOW, ok, fail, escalate, accessLog, EMERGENCY_NUMBERS } = require("./_healthStore.cjs");

const AGENT = "addictionTracker";

const SUBSTANCE_RESOURCES = {
    alcohol: {
        hotline:  "1800-11-0031 (iDare / AIIMS Addiction helpline)",
        note:     "Alcohol withdrawal can be medically DANGEROUS. Never stop heavy drinking abruptly without medical supervision.",
        safe:     false
    },
    smoking: {
        hotline:  "1800-11-2356 (National Tobacco Quitline)",
        note:     "Nicotine withdrawal is uncomfortable but not medically dangerous. NRT (patches, gum) significantly improves success rates.",
        safe:     true
    },
    drugs: {
        hotline:  "1800-11-0031 (AIIMS) | iDare helpline",
        note:     "Opioid/benzodiazepine withdrawal can be medically serious. Seek professional help before stopping.",
        safe:     false
    },
    gambling: {
        hotline:  "Gamblers Anonymous India: gamblersanonymous.in",
        note:     "Behavioural addiction — psychological support is key.",
        safe:     true
    },
    screens: {
        hotline:  "iCall: 9152987821",
        note:     "Digital addiction is increasingly common. Structured reduction works better than cold-turkey.",
        safe:     true
    },
    other: {
        hotline:  "iCall: 9152987821 | AIIMS: 1800-11-0031",
        note:     "Please seek professional support for addiction recovery.",
        safe:     false
    }
};

function startRecovery({ userId, substance, goal = "reduce", reason = "" }) {
    if (!userId || !substance) return fail(AGENT, "userId and substance required");

    accessLog(userId, AGENT, "recovery_started", { substance });

    const sub      = substance.toLowerCase().replace(/\s+/g, "_");
    const resource = SUBSTANCE_RESOURCES[sub] || SUBSTANCE_RESOURCES.other;

    if (!resource.safe) {
        // Always warn about medically unsafe withdrawal
        const warning = {
            id:           uid("rec"),
            userId, substance, goal, reason,
            startDate:    NOW().slice(0, 10),
            createdAt:    NOW()
        };
        const recoveries = load(userId, "recovery_plans", []);
        recoveries.push(warning);
        flush(userId, "recovery_plans", recoveries.slice(-10));

        return ok(AGENT, {
            plan: warning,
            MEDICAL_WARNING: `⚠️ ${resource.note}`,
            helpline:         resource.hotline,
            emergencyNumbers: EMERGENCY_NUMBERS,
            nextStep:         "Please speak to a doctor BEFORE making significant changes to your substance use.",
            strategies:       ["Consult addiction medicine specialist", "Consider medically supervised detox", "Explore MAT (Medication-Assisted Treatment) options with your doctor"]
        }, { riskLevel: "HIGH" });
    }

    const plan = {
        id:         uid("rec"),
        userId, substance, goal, reason,
        strategies: [
            "Set a quit date or reduction target",
            `Replace the habit with a positive activity when you get the urge`,
            "Track triggers in a diary",
            "Remove all paraphernalia and cues from your environment",
            "Tell one trusted person about your goal",
            `Call ${resource.hotline} for free professional support`
        ],
        startDate:  NOW().slice(0, 10),
        createdAt:  NOW()
    };

    const recoveries = load(userId, "recovery_plans", []);
    recoveries.push(plan);
    flush(userId, "recovery_plans", recoveries.slice(-10));

    return ok(AGENT, { plan, helpline: resource.hotline, note: resource.note });
}

function logSobrietyDay({ userId, substanceType, wasClean, note = "" }) {
    if (!userId || !substanceType) return fail(AGENT, "userId and substanceType required");

    accessLog(userId, AGENT, "sobriety_logged");

    const log   = load(userId, `sobriety_${substanceType.replace(/\s/g,"_")}`, []);
    const entry = { date: NOW().slice(0, 10), clean: !!wasClean, note, loggedAt: NOW() };
    log.push(entry);
    flush(userId, `sobriety_${substanceType.replace(/\s/g,"_")}`, log.slice(-1000));

    const streak = log.slice().reverse().reduce((s, e) => e.clean ? s + 1 : 0, 0);

    const milestones = [1,3,7,14,30,60,90,180,365];
    const nextMilestone = milestones.find(m => m > streak) || streak + 365;

    return ok(AGENT, {
        date: entry.date,
        streak,
        wasClean,
        message: wasClean
            ? streak === 1 ? "Day 1 — the hardest and most important step. Well done."
              : streak === 30 ? "🎉 30 days! A huge milestone. You're rewiring your brain."
              : streak === 90 ? "🏆 90 days — the foundation of recovery is solid."
              : `${streak} days strong. Keep going.`
            : "Recovery isn't linear. A slip is not a failure. What matters is getting back on track today.",
        nextMilestone: `${nextMilestone - streak} days to ${nextMilestone}-day milestone`,
        support: "Remember: professional support significantly improves long-term recovery. You don't have to do this alone."
    });
}

module.exports = { startRecovery, logSobrietyDay };
