"use strict";

const RETRY_BUDGETS = {
    safe:        3,
    elevated:    2,
    dangerous:   1,
    destructive: 0,
};

const VERIFICATION_POLICIES = {
    safe:        "disabled",
    elevated:    "lenient",
    dangerous:   "strict",
    destructive: "strict",
};

function route(classification, opts = {}) {
    const sandboxRedirected = classification === "dangerous" || classification === "destructive";
    const strategy          = sandboxRedirected ? "sandbox" : (opts.defaultStrategy ?? "safe");
    const retryBudget       = RETRY_BUDGETS[classification] ?? 1;
    const verificationPolicy = VERIFICATION_POLICIES[classification] ?? "lenient";
    const redirectReason    = sandboxRedirected
        ? `${classification} classification requires sandbox isolation`
        : null;

    return {
        strategy,
        retryBudget,
        verificationPolicy,
        sandboxRedirected,
        redirectReason,
    };
}

function shouldSandbox(classification) {
    return classification === "dangerous" || classification === "destructive";
}

module.exports = { RETRY_BUDGETS, VERIFICATION_POLICIES, route, shouldSandbox };
