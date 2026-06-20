"use strict";
/**
 * Natural Language Browser — converts natural language into browser action sequences.
 *
 * AI converts intent into steps, reusing:
 *   - capabilityRouter for AI model selection
 *   - aiService for LLM call
 *   - browserMemory for known flows
 *   - humanInTheLoop for dangerous action detection
 *
 * Examples:
 *   "Login to LinkedIn"           → navigate + fill form + submit
 *   "Publish Instagram post"       → navigate + upload + caption + post
 *   "Create Razorpay payment link" → navigate + fill payment form + submit
 *   "Reply to Gmail"               → navigate + click email + reply + send
 *   "Book Google Meet"             → navigate + pick time + invite
 */

const logger = require("../utils/logger");

// ── Known flow templates ──────────────────────────────────────────
// These are intent-to-step-template mappings used as few-shot context for the AI.
const KNOWN_FLOWS = {
  linkedin_login: {
    intent: "Login to LinkedIn",
    steps: [
      { action: "navigate",     url: "https://www.linkedin.com/login" },
      { action: "waitForElement", selector: "#username",  label: "Email field" },
      { action: "type",         selector: "#username",    value: "{{email}}"    },
      { action: "type",         selector: "#password",    value: "{{password}}" },
      { action: "click",        selector: "button[type=submit]", label: "Sign In" },
      { action: "waitForNavigation", label: "Login complete" },
      { action: "screenshot",   label: "Login result" },
    ],
    dangerLevel: "safe",
    params: ["email","password"],
    tags:   ["linkedin","login","auth"],
  },
  instagram_post: {
    intent: "Publish Instagram post",
    steps: [
      { action: "navigate",     url: "https://www.instagram.com/" },
      { action: "waitForElement", selector: "svg[aria-label='New post']", label: "New post button" },
      { action: "click",        selector: "svg[aria-label='New post']" },
      { action: "screenshot",   label: "Post dialog" },
    ],
    dangerLevel: "review",
    params: ["caption","imagePath"],
    tags:   ["instagram","post","social"],
    note:   "Instagram requires active login session — use a saved profile.",
  },
  razorpay_payment_link: {
    intent: "Create Razorpay payment link",
    steps: [
      { action: "navigate",     url: "https://dashboard.razorpay.com/app/payment-links/create" },
      { action: "waitForElement", selector: "input[name='amount']", label: "Amount field", timeout: 10000 },
      { action: "type",         selector: "input[name='amount']",      value: "{{amount}}"      },
      { action: "type",         selector: "input[name='description']", value: "{{description}}" },
      { action: "click",        selector: "button[type=submit]",       label: "Create Link" },
      { action: "waitForNavigation", label: "Link created" },
      { action: "screenshot",   label: "Payment link result" },
    ],
    dangerLevel: "review",
    params: ["amount","description"],
    tags:   ["razorpay","payment","fintech"],
    note:   "Requires Razorpay dashboard login.",
  },
  gmail_reply: {
    intent: "Reply to Gmail",
    steps: [
      { action: "navigate",     url: "https://mail.google.com/" },
      { action: "waitForElement", selector: "div[role=main]", label: "Gmail inbox" },
      { action: "click",        selector: "tr.zA:first-child",  label: "First email" },
      { action: "waitForElement", selector: "div[data-tooltip='Reply']", label: "Reply button" },
      { action: "click",        selector: "div[data-tooltip='Reply']" },
      { action: "type",         selector: "div[aria-label='Message Body']", value: "{{replyText}}" },
      { action: "screenshot",   label: "Reply drafted" },
    ],
    dangerLevel: "review",
    params: ["replyText"],
    tags:   ["gmail","email","reply"],
    note:   "Requires Gmail login session.",
  },
  google_meet_book: {
    intent: "Book Google Meet",
    steps: [
      { action: "navigate",     url: "https://meet.google.com/new" },
      { action: "waitForElement", selector: "[data-call-id]", label: "Meeting created", timeout: 10000 },
      { action: "screenshot",   label: "Meeting link" },
      { action: "getText",      selector: "[data-call-id]", label: "Meeting ID" },
    ],
    dangerLevel: "safe",
    params: [],
    tags:   ["google","meet","calendar"],
  },
};

// ── Danger detection ──────────────────────────────────────────────
const DANGER_PATTERNS = [
  { pattern: /pay|payment|transfer|send money|wire/i,  level: "dangerous", reason: "payment_action"  },
  { pattern: /delete|remove|destroy|drop|erase/i,       level: "dangerous", reason: "destructive"     },
  { pattern: /publish|post|submit|send|broadcast/i,     level: "review",    reason: "public_publish"  },
  { pattern: /login|sign in|authenticate/i,             level: "review",    reason: "auth_flow"       },
  { pattern: /book|reserve|schedule|invite/i,           level: "review",    reason: "calendar_action" },
];

function detectDanger(intent) {
  for (const { pattern, level, reason } of DANGER_PATTERNS) {
    if (pattern.test(intent)) return { level, reason };
  }
  return { level: "safe", reason: "no_risk_detected" };
}

/**
 * Find a matching known flow from the library.
 */
function matchKnownFlow(intent) {
  const intentLower = intent.toLowerCase();
  for (const [key, flow] of Object.entries(KNOWN_FLOWS)) {
    if (flow.tags.some(t => intentLower.includes(t)) ||
        flow.intent.toLowerCase().includes(intentLower.slice(0, 20))) {
      return { key, flow };
    }
  }
  return null;
}

/**
 * Build an AI prompt to convert natural language into browser steps.
 */
function buildPrompt(intent, context = {}) {
  const examples = Object.values(KNOWN_FLOWS).slice(0, 3).map(f =>
    `Intent: "${f.intent}"\nSteps: ${JSON.stringify(f.steps.slice(0, 3), null, 2)}`
  ).join("\n\n");

  return `You are a browser automation expert. Convert the user's intent into a JSON array of browser automation steps.

Available actions: navigate, click, type, scroll, screenshot, waitForElement, waitForNavigation, getText, getUrl, fillForm, pressKey, selectOption, hoverElement

Each step must be: { "action": string, "selector"?: string, "url"?: string, "value"?: string, "label"?: string, "timeout"?: number }

Use "{{paramName}}" for user-supplied values (credentials, text etc).

Examples:
${examples}

Now convert this intent to steps:
Intent: "${intent}"
${context.currentUrl ? `Current URL: ${context.currentUrl}` : ""}
${context.params ? `Params available: ${JSON.stringify(context.params)}` : ""}

Return ONLY a valid JSON array of steps. No explanation.`;
}

/**
 * Convert natural language to browser steps.
 *
 * @param {string} intent
 * @param {object} opts  { params, currentUrl, accountId, useKnownFlow }
 * @returns { steps, dangerLevel, knownFlow, source, params }
 */
async function parse(intent, opts = {}) {
  // 1. Check known flows first (fast, no AI needed)
  const known = matchKnownFlow(intent);
  if (known && opts.useKnownFlow !== false) {
    const danger = detectDanger(intent);
    return {
      steps:      known.flow.steps,
      dangerLevel:known.flow.dangerLevel || danger.level,
      dangerReason: danger.reason,
      knownFlow:  known.key,
      source:     "known_flow",
      params:     known.flow.params,
      note:       known.flow.note,
    };
  }

  // 2. AI conversion
  const danger = detectDanger(intent);
  let steps    = [];
  let source   = "ai";

  try {
    const aiService = require("./aiService");
    const prompt    = buildPrompt(intent, opts);
    const result    = await aiService.callAI(
      [{ role: "user", content: prompt }],
      { maxTokens: 1000 }
    );
    const text = result?.content || result?.text || String(result || "");
    // Extract JSON array from response
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed)) steps = parsed;
    }
  } catch (e) {
    logger.warn("[NLBrowser] AI parse failed, returning navigation fallback:", e.message);
    // Fallback: navigate + screenshot
    steps = [
      { action: "navigate",   url: `https://www.google.com/search?q=${encodeURIComponent(intent)}`, label: "Search for intent" },
      { action: "screenshot", label: "Result" },
    ];
    source = "fallback";
  }

  // 3. Auto-add screenshot at end if missing
  if (steps.length && steps[steps.length - 1]?.action !== "screenshot") {
    steps.push({ action: "screenshot", label: "Final state" });
  }

  return {
    steps,
    dangerLevel:  danger.level,
    dangerReason: danger.reason,
    knownFlow:    null,
    source,
    params:       opts.params || [],
  };
}

/**
 * List all known flows (for discovery UI).
 */
function listKnownFlows() {
  return Object.entries(KNOWN_FLOWS).map(([key, f]) => ({
    key, intent: f.intent, dangerLevel: f.dangerLevel, tags: f.tags,
    params: f.params, stepCount: f.steps.length, note: f.note,
  }));
}

module.exports = { parse, matchKnownFlow, detectDanger, listKnownFlows, buildPrompt, KNOWN_FLOWS };
