"use strict";
/**
 * adaptiveRetryIntelligence — compute retry policy from execution history.
 *
 * computePolicy(context)  → RetryPolicy
 *
 * context:
 *   fingerprint    string    — workflow fingerprint for history lookup
 *   entries        array     — execution memory entries
 *   depStability   0–1       — dependency stability (1 = stable)
 *   rollbackCount  number    — prior rollbacks for this workflow
 *   complexity     0–1       — workflow complexity (1 = most complex)
 *
 * RetryPolicy: { maxRetries, backoffMs, backoffMultiplier, retryableExitCodes }
 */

const BASE_POLICY = {
    maxRetries:        1,
    backoffMs:         100,
    backoffMultiplier: 2,
    retryableExitCodes: [1, 2],
};

function computePolicy(context = {}) {
    const {
        fingerprint    = null,
        entries        = [],
        depStability   = 1.0,
        rollbackCount  = 0,
        complexity     = 0,
    } = context;

    let maxRetries        = BASE_POLICY.maxRetries;
    let backoffMs         = BASE_POLICY.backoffMs;
    let backoffMultiplier = BASE_POLICY.backoffMultiplier;

    // Dependency instability → more retries
    if      (depStability < 0.5) maxRetries += 3;
    else if (depStability < 0.7) maxRetries += 2;
    else if (depStability < 0.9) maxRetries += 1;

    // High complexity → reduce retries (costly to re-run)
    if (complexity > 0.7) maxRetries = Math.max(1, maxRetries - 1);

    // Historical rollbacks → longer backoff
    if (rollbackCount > 2) {
        backoffMs         = 1000;
        backoffMultiplier = 3;
    } else if (rollbackCount > 0) {
        backoffMs         = 500;
        backoffMultiplier = 2;
    }

    // Historical retry success for this fingerprint → allow at least 2 retries
    if (fingerprint && entries.length > 0) {
        const retryWins = entries.filter(e => e.fingerprint === fingerprint && e.success && e.retryCount > 0);
        if (retryWins.length > 0) maxRetries = Math.max(maxRetries, 2);
    }

    return { maxRetries, backoffMs, backoffMultiplier, retryableExitCodes: [...BASE_POLICY.retryableExitCodes] };
}

module.exports = { computePolicy, BASE_POLICY };
