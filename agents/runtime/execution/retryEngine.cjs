"use strict";
/**
 * retryEngine — retry with exponential backoff.
 *
 * shouldRetry(exitCode, attemptsDone, policy?)  → boolean
 * getBackoffMs(attemptsDone, policy?)            → ms
 * executeWithRetry(fn, policy?)
 *   → Promise<{ success, attempts, result, exitCode, error? }>
 *   fn signature: (attempt: number) => Promise<{ exitCode, stdout, stderr, ... }>
 *
 * DEFAULT_POLICY = { maxRetries:3, backoffMs:100, backoffMultiplier:2, retryableExitCodes:[1,2] }
 */

const DEFAULT_POLICY = {
    maxRetries:        3,
    backoffMs:         100,
    backoffMultiplier: 2,
    retryableExitCodes: [1, 2],
};

function shouldRetry(exitCode, attemptsDone, policy = DEFAULT_POLICY) {
    if (attemptsDone >= policy.maxRetries) return false;
    if (exitCode === null || exitCode === undefined) return false;   // spawn error or timeout
    return (policy.retryableExitCodes ?? []).includes(exitCode);
}

function getBackoffMs(attemptsDone, policy = DEFAULT_POLICY) {
    const ms = (policy.backoffMs ?? 100) * Math.pow(policy.backoffMultiplier ?? 2, attemptsDone);
    return Math.min(ms, 30_000);   // cap at 30s
}

function _sleep(ms) {
    return new Promise(resolve => {
        const t = setTimeout(resolve, ms);
        if (t.unref) t.unref();
    });
}

async function executeWithRetry(fn, policy = {}) {
    const pol = { ...DEFAULT_POLICY, ...policy };
    let attempts = 0;

    while (true) {
        let result = null;
        let thrownErr = null;

        try {
            result = await fn(attempts);
        } catch (err) {
            thrownErr = err;
        }

        attempts++;

        // Success
        if (!thrownErr && (result.exitCode === 0 || result.success === true)) {
            return { success: true, attempts, result, exitCode: result.exitCode ?? 0 };
        }

        const exitCode = thrownErr ? null : (result?.exitCode ?? null);

        // No more retries
        if (!shouldRetry(exitCode, attempts - 1, pol)) {
            return {
                success:  false,
                attempts,
                result,
                exitCode,
                error: thrownErr?.message ?? null,
            };
        }

        await _sleep(getBackoffMs(attempts - 1, pol));
    }
}

module.exports = { shouldRetry, getBackoffMs, executeWithRetry, DEFAULT_POLICY };
