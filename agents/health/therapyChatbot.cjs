"use strict";
/**
 * Therapy Chatbot — structured CBT-inspired guidance. Safe only.
 * NOT a replacement for professional therapy. Crisis → immediate escalation.
 */
const { load, flush, uid, NOW, ok, fail, escalate, accessLog } = require("./_healthStore.cjs");

const AGENT = "therapyChatbot";

const CRISIS_KEYWORDS = ["suicidal","self harm","self-harm","want to die","kill myself","end my life","hurt myself","overdose on purpose"];

const CBT_MODULES = {
    cognitive_restructuring: {
        title:   "Cognitive Restructuring — Challenge Negative Thoughts",
        steps:   [
            "1. Identify the automatic thought (what your mind says)",
            "2. Rate how much you believe it (0-100%)",
            "3. Find evidence FOR the thought",
            "4. Find evidence AGAINST the thought",
            "5. Create a balanced alternative thought",
            "6. Re-rate belief in original thought — has it reduced?"
        ],
        example: "Thought: 'I always fail.' Evidence for: missed one deadline. Evidence against: completed 10 projects last year. Balanced: 'I sometimes face setbacks but I also have real achievements.'"
    },
    behavioural_activation: {
        title:   "Behavioural Activation — Reconnect with Life",
        steps:   [
            "1. List 5-10 activities that used to bring you joy or achievement",
            "2. Rate how much pleasure/achievement each would give now (0-10)",
            "3. Schedule the highest-rated activity this week",
            "4. Do it, even partially — action precedes motivation",
            "5. Reflect: did it help even 1%?"
        ],
        example: "Activities: walking, cooking, calling a friend. Scheduled: 15-min walk tomorrow morning. Goal: just start."
    },
    worry_time: {
        title:   "Scheduled Worry Time — Contain Rumination",
        steps:   [
            "1. Set a fixed 'worry window' — 15 min at the same time each day",
            "2. When worries come outside that time, write them down and say 'I'll address this at worry time'",
            "3. During worry time: write each worry, assess if actionable",
            "4. For actionable worries: write one next step",
            "5. For unactionable worries: practice acceptance"
        ],
        example: "Worry: 'What if I get sick?' — Not fully actionable. Practice: I'm taking reasonable precautions. I release this worry."
    },
    relaxation_response: {
        title:   "Progressive Muscle Relaxation",
        steps:   [
            "1. Find a quiet place and sit comfortably",
            "2. Start with feet: tense for 5 seconds, then release fully for 10 seconds",
            "3. Move up: calves → thighs → abdomen → hands → shoulders → face",
            "4. Notice the contrast between tension and relaxation",
            "5. End with 5 slow deep breaths"
        ],
        example: "Total time: 15-20 minutes. Best before sleep or when feeling overwhelmed."
    },
    grounding: {
        title:   "5-4-3-2-1 Grounding for Anxiety/Panic",
        steps:   [
            "1. Name 5 things you can SEE right now",
            "2. Name 4 things you can TOUCH/FEEL",
            "3. Name 3 things you can HEAR",
            "4. Name 2 things you can SMELL",
            "5. Name 1 thing you can TASTE"
        ],
        example: "Use this during panic attacks or dissociation to bring yourself back to the present moment."
    }
};

function startSession({ userId, concern, module: moduleName }) {
    if (!userId)  return fail(AGENT, "userId required");
    if (!concern) return fail(AGENT, "concern required");

    accessLog(userId, AGENT, "session_started");

    if (CRISIS_KEYWORDS.some(k => concern.toLowerCase().includes(k))) {
        return escalate(AGENT, "Crisis detected during therapy session. Immediate support required.", "HIGH");
    }

    // Auto-select module based on concern
    let selectedModule = moduleName;
    if (!selectedModule) {
        const lower = concern.toLowerCase();
        if (lower.includes("thought") || lower.includes("negative thinking") || lower.includes("belief")) selectedModule = "cognitive_restructuring";
        else if (lower.includes("motivation") || lower.includes("withdraw") || lower.includes("nothing")) selectedModule = "behavioural_activation";
        else if (lower.includes("worry") || lower.includes("ruminate") || lower.includes("overthink"))    selectedModule = "worry_time";
        else if (lower.includes("anxious") || lower.includes("panic") || lower.includes("overwhelm"))    selectedModule = "grounding";
        else selectedModule = "relaxation_response";
    }

    const mod = CBT_MODULES[selectedModule] || CBT_MODULES.grounding;

    const session = { id: uid("ts"), userId, concern: concern.slice(0, 200), module: selectedModule, startedAt: NOW() };
    const sessions = load(userId, "therapy_sessions", []);
    sessions.push(session);
    flush(userId, "therapy_sessions", sessions.slice(-100));

    return ok(AGENT, {
        sessionId:    session.id,
        module:       selectedModule,
        title:        mod.title,
        steps:        mod.steps,
        example:      mod.example,
        instructions: "Work through these steps at your own pace. You can revisit any step as often as needed.",
        nextSession:  "Once you've practised this technique a few times, log your progress and we can explore other modules.",
        availableModules: Object.keys(CBT_MODULES),
        professionalNote: "CBT is most effective with a licensed therapist. These techniques are self-help tools only."
    });
}

function getModuleList({ userId }) {
    if (!userId) return fail(AGENT, "userId required");
    return ok(AGENT, {
        modules: Object.entries(CBT_MODULES).map(([key, m]) => ({ key, title: m.title }))
    });
}

module.exports = { startSession, getModuleList };
