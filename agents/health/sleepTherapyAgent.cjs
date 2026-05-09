"use strict";
const { load, flush, uid, NOW, ok, fail, accessLog } = require("./_healthStore.cjs");

const AGENT = "sleepTherapyAgent";

const SLEEP_HYGIENE_TIPS = [
    "Maintain a consistent sleep/wake time — even on weekends",
    "Avoid screens (phones, laptops, TV) for 1 hour before bed",
    "Keep bedroom cool (18-20°C), dark, and quiet",
    "Avoid caffeine after 2pm (it has a 6-hour half-life)",
    "Avoid alcohol as a sleep aid — it fragments sleep quality",
    "Don't lie in bed awake for more than 20 minutes; get up and do something calm",
    "Exercise regularly, but not within 2 hours of bedtime",
    "Use the bed only for sleep and sex — not work, screens, or eating",
    "Establish a wind-down routine: e.g. shower → reading → 4-7-8 breathing → sleep",
    "If you can't fall asleep in 20 min, get up. Only return when sleepy."
];

const CBT_I_TECHNIQUES = {
    sleep_restriction: {
        name:     "Sleep Restriction Therapy (CBTi core technique)",
        steps:    ["Calculate your average actual sleep time (e.g. 5.5 hours)","Set a fixed wake time (e.g. 7am)","Set bedtime to allow only your actual sleep time (e.g. 1:30am)","Stick strictly to this schedule for 2 weeks","As sleep efficiency improves (>85%), extend window by 15 min"],
        note:     "This is the most evidence-based treatment for chronic insomnia — more effective than sleeping pills long-term."
    },
    stimulus_control: {
        name:     "Stimulus Control Therapy",
        steps:    ["Only go to bed when sleepy (not just tired)","Get out of bed if awake for >20 minutes","Avoid clock-watching","Use the bedroom ONLY for sleep"],
        note:     "Re-associates bed with sleepiness instead of wakefulness and frustration."
    }
};

function logSleep({ userId, bedtime, wakeTime, quality, notes = "" }) {
    if (!userId || !bedtime || !wakeTime)
        return fail(AGENT, "userId, bedtime and wakeTime required");

    accessLog(userId, AGENT, "sleep_logged");

    const bed   = new Date(`2000-01-01T${bedtime}`);
    const wake  = new Date(`2000-01-02T${wakeTime}`);
    const hours = +(( wake - bed) / 3600000).toFixed(2);

    const entry = {
        id:        uid("slp"),
        userId,
        bedtime,
        wakeTime,
        hoursSlept: hours > 0 ? hours : hours + 24,
        quality:   Math.max(1, Math.min(10, Number(quality) || 5)),
        notes,
        date:      NOW().slice(0, 10),
        loggedAt:  NOW()
    };

    const log = load(userId, "sleep_log", []);
    log.push(entry);
    flush(userId, "sleep_log", log.slice(-1000));

    return ok(AGENT, {
        entry,
        assessment: entry.hoursSlept >= 7 && entry.hoursSlept <= 9
            ? "Optimal sleep duration ✓"
            : entry.hoursSlept < 7
            ? `Short sleep (${entry.hoursSlept}h). Adults need 7-9 hours. Review sleep hygiene.`
            : `Long sleep (${entry.hoursSlept}h). Excessive sleep can also indicate health issues — consult a doctor if persistent.`
    });
}

function getSleepAdvice({ userId, issue = "general" }) {
    if (!userId) return fail(AGENT, "userId required");
    accessLog(userId, AGENT, "advice_requested", { issue });

    const log      = load(userId, "sleep_log", []);
    const recent7  = log.slice(-7);
    const avgHours = recent7.length
        ? +(recent7.reduce((s, e) => s + e.hoursSlept, 0) / recent7.length).toFixed(1)
        : null;
    const avgQuality = recent7.length
        ? +(recent7.reduce((s, e) => s + e.quality, 0) / recent7.length).toFixed(1)
        : null;

    const issueMap = {
        insomnia:        CBT_I_TECHNIQUES.sleep_restriction,
        "can't fall asleep": CBT_I_TECHNIQUES.stimulus_control,
        "waking at night":   { name: "Sleep Maintenance Techniques", steps: ["Avoid fluids 2h before bed","Check for sleep apnoea if loud snoring","Reduce alcohol","Consistent wake time is most important"], note: "Night waking can be hormonal, stress-related, or apnoea — see a doctor if persistent." },
        general:         { name: "Sleep Hygiene Programme", steps: SLEEP_HYGIENE_TIPS, note: "Start with 3 changes at a time. Track results." }
    };

    const technique = issueMap[issue.toLowerCase()] || issueMap.general;

    return ok(AGENT, {
        issue,
        technique,
        sleepStats:    { avgHours, avgQuality, tracked: recent7.length },
        recommendation:"For chronic insomnia (>3 months), Cognitive Behavioural Therapy for Insomnia (CBTi) is the first-line treatment. Ask your doctor for a referral.",
        apps:          ["Sleep Cycle","Calm","Headspace (sleep section)"]
    });
}

module.exports = { logSleep, getSleepAdvice };
