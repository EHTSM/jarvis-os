"use strict";
/**
 * ReasoningEngine — D3 of Track D: Autonomous Reasoning
 *
 * Wraps every recommendation with structured reasoning: root-cause chains,
 * confidence scoring, risk analysis, rollback/recovery planning, and
 * alternative approach generation.  All logic is rule-based + pattern
 * matching against on-disk data files — no external API calls.
 *
 * Public API:
 *   explainRecommendation(recId, opts)   → full reasoning envelope
 *   scoreConfidence(data)                → number 0-100
 *   analyzeRisk(recommendation, context) → { level, factors[], mitigations[] }
 *   planRollback(recommendation)         → { steps[], estimatedTimeMin, reversible }
 *   batchExplain(opts)                   → { explained[], count }
 *   getReasoning(recId)                  → cached envelope | null
 *   analyzeRootCause(failureContext)     → { rootCause, chain[], confidence }
 *
 * Data read:
 *   data/recommendations.json
 *   data/lessons.json
 *   data/healing-history.json
 *
 * Data written:
 *   data/reasoned-recommendations.json
 */

const fs   = require("fs");
const path = require("path");
const logger = require("../utils/logger");

// ── File paths ─────────────────────────────────────────────────────────────
const DATA_DIR          = path.join(__dirname, "../../data");
const RECS_FILE         = path.join(DATA_DIR, "recommendations.json");
const LESSONS_FILE      = path.join(DATA_DIR, "lessons.json");
const HEAL_FILE         = path.join(DATA_DIR, "healing-history.json");
const REASONED_FILE     = path.join(DATA_DIR, "reasoned-recommendations.json");

// ── I/O helpers ────────────────────────────────────────────────────────────
function _rj(file, fb) {
    try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fb; }
}
function _wj(file, data) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
}

// ── Data loaders (re-read from disk each call so we pick up live changes) ──
function _loadRecs()    { return _rj(RECS_FILE,     []); }
function _loadLessons() { return _rj(LESSONS_FILE,  []); }
function _loadHeal()    { return _rj(HEAL_FILE,      []); }
function _loadReasoned(){ return _rj(REASONED_FILE,  []); }

// ── Utility ────────────────────────────────────────────────────────────────
function _ageMs(isoString) {
    if (!isoString) return Infinity;
    return Date.now() - new Date(isoString).getTime();
}

function _dayMs(n) { return n * 24 * 3600 * 1000; }

/**
 * Normalise a recommendation's category / type to one of the known rollback
 * buckets: "deploy" | "config" | "code" | "security" | "default"
 */
function _category(rec) {
    const t = ((rec.type || "") + " " + (rec.title || "") + " " + (rec.detail || "")).toLowerCase();
    if (t.includes("deploy") || t.includes("release") || t.includes("ship"))   return "deploy";
    if (t.includes("config") || t.includes("env") || t.includes("setting"))    return "config";
    if (t.includes("refactor") || t.includes("code") || t.includes("revert"))  return "code";
    if (t.includes("security") || t.includes("token") || t.includes("secret")
        || t.includes("auth") || t.includes("credential"))                      return "security";
    return "default";
}

// ── 1. scoreConfidence ─────────────────────────────────────────────────────
/**
 * scoreConfidence(data) → number 0-100
 *
 * data shape (all fields optional):
 *   lessonCount        — how many lessons reference this pattern
 *   recurrenceRate     — fraction 0-1 of times this pattern recurred
 *   historicalSuccessRate — fraction 0-1 of past similar fixes that worked
 *   dataFreshnessMs    — age of the most recent data point in ms
 *   severity           — "high"|"medium"|"low"|"info"
 */
function scoreConfidence(data = {}) {
    const {
        lessonCount          = 0,
        recurrenceRate       = 0,
        historicalSuccessRate = 0.5,
        dataFreshnessMs      = _dayMs(7),
        severity             = "medium",
    } = data;

    // Evidence weight — saturates at 20 lessons → 35 pts
    const evidenceScore = Math.min(35, Math.round((lessonCount / 20) * 35));

    // Recurrence confidence — higher recurrence = more predictable → up to 25 pts
    const recurrenceScore = Math.min(25, Math.round(recurrenceRate * 25));

    // Historical fix success rate → up to 25 pts
    const successScore = Math.min(25, Math.round(historicalSuccessRate * 25));

    // Data freshness penalty: full 15 pts if < 1 day, scales to 0 at 14 days
    const freshnessRatio = Math.max(0, 1 - dataFreshnessMs / _dayMs(14));
    const freshnessScore = Math.round(freshnessRatio * 15);

    // Severity adjustment: high severity → we know it matters → small bonus
    const severityBonus = severity === "high" ? 3 : severity === "low" || severity === "info" ? -3 : 0;

    const raw = evidenceScore + recurrenceScore + successScore + freshnessScore + severityBonus;
    return Math.max(0, Math.min(100, raw));
}

// ── 2. analyzeRisk ─────────────────────────────────────────────────────────
/**
 * analyzeRisk(recommendation, context) → { level, factors[], mitigations[] }
 */
function analyzeRisk(recommendation = {}, context = {}) {
    const factors     = [];
    const mitigations = [];
    let riskPct       = 0;

    const text = (
        (recommendation.title  || "") + " " +
        (recommendation.detail || "") + " " +
        (recommendation.type   || "")
    ).toLowerCase();

    const cat = _category(recommendation);

    // Structural risk by category
    if (cat === "deploy") {
        riskPct += 30;
        factors.push("Deployment changes can break live services");
        mitigations.push("Use blue-green or canary deployment strategy");
        mitigations.push("Validate staging environment before production push");
    }
    if (cat === "security") {
        riskPct += 35;
        factors.push("Security changes may break authentication flows");
        mitigations.push("Rotate secrets in a staged fashion");
        mitigations.push("Notify all dependent services before credential rotation");
    }
    if (cat === "config") {
        riskPct += 20;
        factors.push("Config changes may have unintended side-effects");
        mitigations.push("Back up current config before applying changes");
    }
    if (cat === "code") {
        riskPct += 15;
        factors.push("Code changes introduce regression risk");
        mitigations.push("Run full regression suite before merging");
        mitigations.push("Consider feature flag to gate the change");
    }

    // Priority-based risk
    const priority = recommendation.priority || 3;
    if (priority === 1) {
        riskPct += 20;
        factors.push("Highest-priority recommendation — urgency increases deployment risk");
    }

    // Keyword signals
    if (text.includes("delete") || text.includes("drop") || text.includes("remove")) {
        riskPct += 20;
        factors.push("Destructive operation detected");
        mitigations.push("Create backup before any deletion");
    }
    if (text.includes("production") || text.includes("prod")) {
        riskPct += 10;
        factors.push("Targets production environment directly");
        mitigations.push("Schedule change during low-traffic window");
    }
    if (text.includes("credential") || text.includes("api_key") || text.includes("token")) {
        riskPct += 15;
        factors.push("Credential change may break integrations");
        mitigations.push("Update all dependent env vars atomically");
    }
    if (text.includes("unknown") || text.includes("unclassified")) {
        riskPct += 10;
        factors.push("Root cause is unclassified — higher uncertainty");
        mitigations.push("Conduct deeper investigation before applying fix");
    }

    // Healing history risk: many failures at this target = more risky
    const healHistory = _loadHeal();
    const failedHeals = healHistory.filter(h => !h.success);
    if (failedHeals.length > 20) {
        riskPct += 10;
        factors.push(`${failedHeals.length} prior healing attempts have failed`);
        mitigations.push("Review healing-history.json for repeated failure patterns");
    }

    // Context overrides
    if (context.hasTests === false) {
        riskPct += 10;
        factors.push("No automated tests detected in context");
        mitigations.push("Add automated tests before applying this recommendation");
    }
    if (context.criticalPath === true) {
        riskPct += 15;
        factors.push("Recommendation touches a critical execution path");
        mitigations.push("Pair with a colleague for review before applying");
    }

    // Ensure at least one mitigation
    if (mitigations.length === 0) {
        mitigations.push("Monitor system metrics closely after applying");
    }

    // Determine level from risk percentage
    riskPct = Math.min(100, riskPct);
    let level;
    if      (riskPct > 75)  level = "critical";
    else if (riskPct > 50)  level = "high";
    else if (riskPct > 25)  level = "medium";
    else                    level = "low";

    return { level, riskPct, factors, mitigations };
}

// ── 3. planRollback ────────────────────────────────────────────────────────
/**
 * planRollback(recommendation) → { steps[], estimatedTimeMin, reversible }
 */
function planRollback(recommendation = {}) {
    const cat   = _category(recommendation);
    const title = recommendation.title || "this change";

    switch (cat) {
        case "deploy":
            return {
                steps: [
                    `Identify the previous stable release tag or image digest`,
                    `Trigger rollback deployment to the previous stable version`,
                    `Verify health checks pass on the reverted service`,
                    `Update load balancer / routing rules if needed`,
                    `Notify on-call team that rollback completed`,
                ],
                estimatedTimeMin: 15,
                reversible: true,
            };

        case "config":
            return {
                steps: [
                    `Retrieve the previous configuration from backup or version control`,
                    `Apply the prior configuration values to the environment`,
                    `Restart affected services to pick up restored config`,
                    `Validate that the system behaves as expected after restore`,
                ],
                estimatedTimeMin: 10,
                reversible: true,
            };

        case "code":
            return {
                steps: [
                    `Identify the commit SHA that introduced the change`,
                    `Run: git revert <sha> --no-commit`,
                    `Review the revert diff for correctness`,
                    `Commit and push the revert: git commit -m "revert: ${title}"`,
                    `Trigger CI/CD pipeline and confirm tests pass`,
                    `Deploy the reverted build to production`,
                ],
                estimatedTimeMin: 20,
                reversible: true,
            };

        case "security":
            return {
                steps: [
                    `Immediately revoke the newly issued credentials / tokens`,
                    `Re-issue the previous credentials from the secrets vault`,
                    `Distribute restored credentials to all dependent services`,
                    `Audit access logs for any unauthorised use during the window`,
                    `Confirm all services authenticate successfully with restored credentials`,
                ],
                estimatedTimeMin: 30,
                reversible: true,
            };

        default:
            return {
                steps: [
                    `Stop any processes executing the change mid-flight`,
                    `Restore the affected resource to its last known good state`,
                    `Validate system integrity against baseline metrics`,
                    `Document what was reverted and why in the incident log`,
                ],
                estimatedTimeMin: 20,
                reversible: false,
            };
    }
}

// ── 4. analyzeRootCause ────────────────────────────────────────────────────
/**
 * analyzeRootCause(failureContext) → { rootCause, chain[], confidence }
 *
 * failureContext: { error, agentId, toolId, type, detail, category, pattern }
 */
function analyzeRootCause(failureContext = {}) {
    const lessons     = _loadLessons();
    const healHistory = _loadHeal();

    const needle = (
        (failureContext.error   || "") + " " +
        (failureContext.detail  || "") + " " +
        (failureContext.pattern || "") + " " +
        (failureContext.type    || "")
    ).toLowerCase();

    // ── Match against known lesson patterns ──────────────────────────────
    const matchedLessons = lessons.filter(l => {
        if (!l.sourcePattern) return false;
        const pat = l.sourcePattern.toLowerCase();
        return needle.includes(pat) || pat.split(" ").some(word => word.length > 4 && needle.includes(word));
    });

    // ── Healing history: has this target type been healed before? ────────
    const healedSimilar = healHistory.filter(h => {
        if (failureContext.agentId && h.targetId && h.targetId.includes(failureContext.agentId)) return true;
        if (failureContext.toolId  && h.targetId && h.targetId.includes(failureContext.toolId))  return true;
        return false;
    });
    const healSuccessRate = healedSimilar.length > 0
        ? healedSimilar.filter(h => h.success).length / healedSimilar.length
        : 0.5;

    // ── Rule-based root-cause inference ──────────────────────────────────
    const chain = [];
    let rootCause = "unclassified — insufficient data to determine root cause";

    if (needle.includes("timeout")) {
        rootCause = "Upstream service response exceeded timeout threshold";
        chain.push("Client issued request to upstream service");
        chain.push("Upstream service did not respond within the configured timeout window");
        chain.push("Client threw a timeout error and marked the operation failed");
        chain.push("Root cause: upstream latency spike or network saturation");
    } else if (needle.includes("not_configured") || needle.includes("not set") || needle.includes("api_key") || needle.includes("credential")) {
        rootCause = "Required credential or environment variable is missing from the runtime configuration";
        chain.push("Service attempted to authenticate with an external provider");
        chain.push("Credential lookup returned empty or undefined");
        chain.push("Service threw not_configured error and aborted the operation");
        chain.push("Root cause: environment variable was never set or was cleared during a config reset");
    } else if (needle.includes("401") || needle.includes("unauthorized")) {
        rootCause = "Authentication token is expired, revoked, or was never provided";
        chain.push("Service sent authenticated request to external API");
        chain.push("API returned HTTP 401 Unauthorized");
        chain.push("Service propagated the auth failure as an error");
        chain.push("Root cause: token lifecycle was not managed — rotation or renewal missed");
    } else if (needle.includes("403") || needle.includes("forbidden")) {
        rootCause = "Caller lacks the required permission scope for this operation";
        chain.push("Service attempted a privileged operation on an external resource");
        chain.push("External API returned HTTP 403 Forbidden");
        chain.push("Root cause: service account or API key does not have the required scope");
    } else if (needle.includes("404") || needle.includes("not found")) {
        rootCause = "Target resource does not exist at the referenced path or ID";
        chain.push("Service constructed a request targeting a specific resource ID or path");
        chain.push("Remote server returned HTTP 404 or file-system ENOENT");
        chain.push("Root cause: resource was deleted, moved, or the ID was never valid");
    } else if (needle.includes("enoent") || needle.includes("no such file")) {
        rootCause = "A required local file or directory was not found at the expected path";
        chain.push("Service attempted to read or write a file at a computed path");
        chain.push("Node.js threw ENOENT because the path does not exist");
        chain.push("Root cause: file was not created by a prerequisite step, or path constant is wrong");
    } else if (needle.includes("econnrefused") || needle.includes("enotfound")) {
        rootCause = "Network connection was refused — target service is down or the hostname is wrong";
        chain.push("Service attempted to open a TCP connection to a remote host");
        chain.push("OS returned ECONNREFUSED (port closed) or ENOTFOUND (DNS failure)");
        chain.push("Root cause: target service is not running, or URL / port is misconfigured");
    } else if (needle.includes("rate limit") || needle.includes("429")) {
        rootCause = "Request rate exceeded the provider's API quota";
        chain.push("Service issued requests at a rate above the provider limit");
        chain.push("Provider returned HTTP 429 Too Many Requests");
        chain.push("Root cause: no rate-limiter or back-off strategy in the calling code");
    } else if (needle.includes("quota")) {
        rootCause = "Plan-level API quota has been exhausted";
        chain.push("Cumulative API usage exceeded the plan's monthly or daily quota");
        chain.push("Provider rejected further requests until quota resets");
        chain.push("Root cause: usage has grown beyond the current subscription tier");
    } else if (needle.includes("is not a function") || needle.includes("typeerror")) {
        rootCause = "JavaScript TypeError — a value was used as a function but is not callable";
        chain.push("Runtime evaluated a call expression on a non-function value");
        chain.push("This indicates a stale module cache, incorrect import, or an API contract change");
        chain.push("Root cause: code assumes a certain interface that the actual object no longer satisfies");
    } else if (needle.includes("rename") || needle.includes("enoent")) {
        rootCause = "Atomic file write failed — temp file or target directory does not exist";
        chain.push("Service wrote data to a .tmp file and called fs.renameSync");
        chain.push("Rename failed because the destination directory was missing");
        chain.push("Root cause: data directory was not created before the write operation");
    } else if (matchedLessons.length > 0) {
        const topLesson = matchedLessons[0];
        rootCause = topLesson.recommendation || topLesson.detail || "see matched lesson";
        chain.push(`Pattern matched lesson: "${topLesson.title}"`);
        chain.push(`Lesson detail: ${topLesson.detail || "N/A"}`);
        chain.push(`Recommendation from lesson: ${topLesson.recommendation || "review lesson for action"}`);
    } else {
        chain.push("No matching lesson found for this failure pattern");
        chain.push("Failure is novel or insufficiently described — manual investigation required");
        chain.push("Root cause: unknown");
    }

    // Confidence: boosted by matched lessons and historical heal success
    const lessonBoost  = Math.min(30, matchedLessons.length * 10);
    const healBoost    = Math.round(healSuccessRate * 20);
    const baseConf     = rootCause.includes("unclassified") ? 20 : 55;
    const confidence   = Math.min(95, baseConf + lessonBoost + healBoost);

    return { rootCause, chain, confidence };
}

// ── 5. explainRecommendation ───────────────────────────────────────────────
/**
 * explainRecommendation(recId, opts) → full reasoning envelope
 */
function explainRecommendation(recId, opts = {}) {
    const recs    = _loadRecs();
    const lessons = _loadLessons();
    const heal    = _loadHeal();

    const rec = recs.find(r => r.recId === recId);
    if (!rec) {
        logger.warn(`[ReasoningEngine] explainRecommendation: recId "${recId}" not found`);
        return null;
    }

    // ── Root cause analysis ──────────────────────────────────────────────
    const rcAnalysis = analyzeRootCause({
        error:    rec.detail || rec.title || "",
        type:     rec.type   || "",
        detail:   rec.detail || "",
        pattern:  rec.title  || "",
        category: _category(rec),
    });

    // ── Confidence scoring ───────────────────────────────────────────────
    // How many lessons mention patterns from this recommendation
    const titleWords = (rec.title || "").toLowerCase().split(/\s+/).filter(w => w.length > 4);
    const relatedLessons = lessons.filter(l => {
        const text = ((l.title || "") + " " + (l.detail || "") + " " + (l.sourcePattern || "")).toLowerCase();
        return titleWords.some(w => text.includes(w));
    });

    // Historical success rate from healing history for similar fix strategies
    const cat = _category(rec);
    const similarHeals = heal.filter(h => {
        if (cat === "deploy")   return h.strategy && h.strategy.includes("restart");
        if (cat === "security") return h.strategy && h.strategy.includes("escalate");
        if (cat === "code")     return h.strategy && h.strategy.includes("rollback");
        return true;
    });
    const histSuccessRate = similarHeals.length > 0
        ? similarHeals.filter(h => h.success).length / similarHeals.length
        : 0.5;

    const dataAgeMs = _ageMs(rec.updatedAt || rec.createdAt);
    const severity  = rec.priority === 1 ? "high" : rec.priority === 2 ? "medium" : "low";

    // Recurrence: how many recs share the same title prefix
    const titlePrefix = (rec.title || "").slice(0, 30).toLowerCase();
    const similarRecs = recs.filter(r => r.recId !== rec.recId && (r.title || "").toLowerCase().slice(0, 30) === titlePrefix);
    const recurrenceRate = Math.min(1, similarRecs.length / 10);

    const confidence = scoreConfidence({
        lessonCount:           relatedLessons.length,
        recurrenceRate,
        historicalSuccessRate: histSuccessRate,
        dataFreshnessMs:       dataAgeMs,
        severity,
    });

    // ── Confidence factors (human-readable reasons) ──────────────────────
    const confidenceFactors = [];
    if (relatedLessons.length > 0) {
        confidenceFactors.push(`${relatedLessons.length} related lesson(s) corroborate this pattern`);
    } else {
        confidenceFactors.push("No directly corroborating lessons found — lower certainty");
    }
    if (recurrenceRate > 0.3) {
        confidenceFactors.push(`Pattern has recurred ${similarRecs.length} time(s) — higher predictability`);
    }
    if (histSuccessRate >= 0.7) {
        confidenceFactors.push(`Historical fix success rate is ${Math.round(histSuccessRate * 100)}% — strong precedent`);
    } else if (histSuccessRate < 0.4) {
        confidenceFactors.push(`Historical fix success rate is only ${Math.round(histSuccessRate * 100)}% — approach with caution`);
    }
    if (dataAgeMs < _dayMs(1)) {
        confidenceFactors.push("Data is fresh (less than 24 hours old) — high relevance");
    } else if (dataAgeMs > _dayMs(7)) {
        confidenceFactors.push(`Data is ${Math.round(dataAgeMs / _dayMs(1))} days old — may be stale`);
    }

    // ── Risk analysis ────────────────────────────────────────────────────
    const risk = analyzeRisk(rec, opts.context || {});

    // ── Rollback plan ────────────────────────────────────────────────────
    const rollbackPlan = planRollback(rec);

    // ── Recovery plan ────────────────────────────────────────────────────
    const recoveryPlan = _buildRecoveryPlan(rec, cat, rcAnalysis);

    // ── Alternatives ─────────────────────────────────────────────────────
    const alternatives = _buildAlternatives(rec, cat, risk.level);

    // ── Explanation paragraph ─────────────────────────────────────────────
    const explanation = _buildExplanation(rec, rcAnalysis, relatedLessons, confidence);

    // ── Chain-of-thought reasoning steps ─────────────────────────────────
    const reasoning = _buildReasoning(rec, rcAnalysis, relatedLessons, risk, confidence);

    const envelope = {
        recId:             rec.recId,
        title:             rec.title,
        description:       rec.detail || rec.description || "",
        explanation,
        confidence,
        confidenceFactors,
        alternatives,
        risk: {
            level:       risk.level,
            factors:     risk.factors,
            mitigations: risk.mitigations,
        },
        rollbackPlan,
        recoveryPlan,
        rootCause:     rcAnalysis.rootCause,
        reasoning,
        computedAt:    new Date().toISOString(),
        // carry through original rec fields
        priority:      rec.priority,
        status:        rec.status,
        type:          rec.type,
        category:      cat,
        source:        rec.source,
        createdAt:     rec.createdAt,
        updatedAt:     rec.updatedAt,
    };

    return envelope;
}

// ── Helper: build natural-language explanation ────────────────────────────
function _buildExplanation(rec, rcAnalysis, relatedLessons, confidence) {
    const parts = [];
    parts.push(`This recommendation targets "${rec.title || rec.recId}".`);
    parts.push(`Root cause identified: ${rcAnalysis.rootCause}.`);

    if (relatedLessons.length > 0) {
        parts.push(
            `The pattern is supported by ${relatedLessons.length} lesson(s) in the knowledge base, ` +
            `most recently: "${relatedLessons[0].title}".`
        );
    } else {
        parts.push("No prior lessons directly match this pattern; the recommendation is derived from failure-cluster analysis alone.");
    }

    parts.push(
        `Confidence is ${confidence}% — ${
            confidence >= 70 ? "the system has strong evidence this fix will resolve the issue" :
            confidence >= 40 ? "the system has moderate evidence; manual validation is advised" :
                               "evidence is limited; treat this as a hypothesis requiring investigation"
        }.`
    );

    return parts.join(" ");
}

// ── Helper: chain-of-thought reasoning steps ─────────────────────────────
function _buildReasoning(rec, rcAnalysis, relatedLessons, risk, confidence) {
    const steps = [];

    steps.push(
        `Observed signal: "${(rec.title || "").slice(0, 80)}" — type: ${rec.type || "unknown"}, priority: ${rec.priority || "N/A"}.`
    );
    steps.push(
        `Root-cause chain traced: ${rcAnalysis.chain.length > 0 ? rcAnalysis.chain[0] : "no chain available"}.`
    );

    if (relatedLessons.length > 0) {
        steps.push(
            `Cross-referenced ${relatedLessons.length} lesson(s) from the knowledge base — ` +
            `pattern recognition increased confidence to ${confidence}%.`
        );
    } else {
        steps.push("Knowledge base cross-reference: no matching lessons — confidence derived from heuristics only.");
    }

    steps.push(
        `Risk assessed as ${risk.level.toUpperCase()}: ` +
        (risk.factors.length > 0 ? risk.factors[0] : "standard operational risk.") + "."
    );

    steps.push(
        `Recommended action: ${
            rec.type === "fix"         ? "apply the fix with rollback plan ready" :
            rec.type === "investigate" ? "investigate root cause before making changes" :
            rec.type === "optimise"    ? "apply optimisation in a non-production slot first" :
                                         "review the recommendation and decide on action"
        }.`
    );

    return steps;
}

// ── Helper: build recovery plan ────────────────────────────────────────────
function _buildRecoveryPlan(rec, cat, rcAnalysis) {
    const fallbackAgents = {
        deploy:   "deployment_recovery_agent",
        config:   "config_restore_agent",
        code:     "code_revert_agent",
        security: "security_response_agent",
        default:  "general_recovery_agent",
    };

    const steps = [];

    steps.push("Confirm the failure is still active by checking current system health metrics.");

    if (rcAnalysis.rootCause.includes("timeout")) {
        steps.push("Increase timeout thresholds and retry the operation with exponential back-off.");
        steps.push("If timeouts persist, route traffic to a healthy replica.");
    } else if (rcAnalysis.rootCause.includes("credential") || rcAnalysis.rootCause.includes("token")) {
        steps.push("Re-inject the missing credential from the secrets vault into the runtime environment.");
        steps.push("Restart affected services to pick up the new credential.");
    } else if (rcAnalysis.rootCause.includes("ENOENT") || rcAnalysis.rootCause.includes("file")) {
        steps.push("Re-create the missing file or directory from the last known backup.");
        steps.push("Re-run the initialisation step that is responsible for creating this path.");
    } else {
        steps.push("Execute the rollback plan to restore the last known good state.");
        steps.push("Monitor error rate for 5 minutes after rollback to confirm recovery.");
    }

    steps.push("Update lessons.json with findings from this incident to improve future confidence scoring.");

    return {
        steps,
        fallbackAgent: fallbackAgents[cat] || fallbackAgents.default,
    };
}

// ── Helper: build 2-3 alternative approaches ─────────────────────────────
function _buildAlternatives(rec, cat, riskLevel) {
    const alts = [];

    // Alternative 1 — conservative / lower-risk
    alts.push({
        approach:       "Monitor and defer",
        tradeoffs:      "No immediate risk; the problem may worsen before it is addressed",
        estimatedRisk:  "low",
    });

    // Alternative 2 — category-specific
    if (cat === "deploy") {
        alts.push({
            approach:      "Stage the fix to a canary environment and observe for 30 minutes before full rollout",
            tradeoffs:     "Slower than direct deployment but dramatically reduces blast radius if the fix is incorrect",
            estimatedRisk: "low",
        });
    } else if (cat === "config") {
        alts.push({
            approach:      "Use a feature flag to toggle the new config value without a full restart",
            tradeoffs:     "Requires feature-flag infrastructure; allows instant toggle-off if issues arise",
            estimatedRisk: "low",
        });
    } else if (cat === "code") {
        alts.push({
            approach:      "Cherry-pick only the specific commit that fixes the root cause rather than applying the full recommendation",
            tradeoffs:     "More surgical and less likely to introduce regressions; may miss related fixes",
            estimatedRisk: "medium",
        });
    } else if (cat === "security") {
        alts.push({
            approach:      "Rotate only the affected credential rather than a full secrets refresh",
            tradeoffs:     "Faster and less disruptive; limits blast radius of the rotation operation",
            estimatedRisk: "medium",
        });
    } else {
        alts.push({
            approach:      "Isolate the affected component and run it in degraded mode while investigating",
            tradeoffs:     "Maintains partial service availability; root cause may take longer to resolve",
            estimatedRisk: "medium",
        });
    }

    // Alternative 3 — aggressive / fast
    if (riskLevel === "critical" || riskLevel === "high") {
        alts.push({
            approach:      "Escalate to senior engineer immediately and apply emergency rollback in parallel",
            tradeoffs:     "Highest disruption but fastest path to a stable state under critical risk conditions",
            estimatedRisk: "high",
        });
    } else {
        alts.push({
            approach:      "Auto-remediate using the self-healing runtime with circuit-breaking enabled",
            tradeoffs:     "Fully automated — fastest resolution but depends on healing strategy accuracy",
            estimatedRisk: "medium",
        });
    }

    return alts;
}

// ── 6. batchExplain ────────────────────────────────────────────────────────
/**
 * batchExplain(opts) → { explained[], count }
 * Reads all recommendations, explains each, and persists to
 * data/reasoned-recommendations.json.
 */
function batchExplain(opts = {}) {
    const recs    = _loadRecs();
    const existing = _loadReasoned();
    const existingMap = new Map(existing.map(e => [e.recId, e]));

    const explained = [];

    for (const rec of recs) {
        try {
            // Skip already-computed unless force flag set
            if (!opts.force && existingMap.has(rec.recId)) {
                explained.push(existingMap.get(rec.recId));
                continue;
            }
            const envelope = explainRecommendation(rec.recId, opts);
            if (envelope) {
                existingMap.set(rec.recId, envelope);
                explained.push(envelope);
            }
        } catch (err) {
            logger.warn(`[ReasoningEngine] batchExplain: failed for ${rec.recId} — ${err.message}`);
        }
    }

    // Persist
    try {
        _wj(REASONED_FILE, Array.from(existingMap.values()));
        logger.info(`[ReasoningEngine] batchExplain: persisted ${existingMap.size} reasoned recommendations`);
    } catch (err) {
        logger.warn(`[ReasoningEngine] batchExplain: persist failed — ${err.message}`);
    }

    return { explained, count: explained.length };
}

// ── 7. getReasoning ────────────────────────────────────────────────────────
/**
 * getReasoning(recId) → previously computed reasoning envelope | null
 */
function getReasoning(recId) {
    const store = _loadReasoned();
    return store.find(e => e.recId === recId) || null;
}

// ── Module export ──────────────────────────────────────────────────────────
module.exports = {
    explainRecommendation,
    scoreConfidence,
    analyzeRisk,
    planRollback,
    batchExplain,
    getReasoning,
    analyzeRootCause,
};
