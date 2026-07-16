import { readFileSync } from "fs";
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const files = execSync("find backend/services -type f \\( -name '*.cjs' -o -name '*.js' \\)", { cwd: REPO_ROOT })
  .toString().trim().split("\n").filter(Boolean).sort();

// Known real external-vendor integration files (verified by hand in the validation
// pass: real hostnames/SDKs for GitHub, Razorpay, email providers, WhatsApp,
// Telegram, S3/R2, Sentry, OAuth token exchange, and the multi-provider AI router).
const KNOWN_REAL_EXTERNAL = new Set([
  "backend/services/aiService.js",
  "backend/services/gitHubEngineeringAgent.cjs",
  "backend/services/paymentService.js",
  "backend/services/emailService.cjs",
  "backend/services/whatsappService.js",
  "backend/services/telegramService.js",
  "backend/services/storageService.cjs",
  "backend/services/sentryService.cjs",
  "backend/services/oauthIntegrationLayer.cjs",
]);

// Markers of real local process/OS execution (git, pm2, filesystem scans of the
// actual repo) as opposed to manipulating a self-contained JSON registry.
const LOCAL_EXEC_MARKERS = [/execSync\s*\(/, /\bexec\s*\(/, /spawn\s*\(/, /child_process/];

// Markers of any outbound network call to a third party.
const EXTERNAL_IO_MARKERS = [
  /require\(["']axios["']\)/, /require\(["']https?["']\)/, /require\(["']node-fetch["']\)/,
  /\bfetch\(/, /https?:\/\/api\./, /\.request\s*\(/,
];

// Markers of local-only JSON persistence (the "simulation" substrate: reading/
// writing self-generated state under data/*.json).
const LOCAL_PERSIST_MARKERS = [/writeFileSync/, /readFileSync/];

// Markers suggesting the file is cross-cutting plumbing rather than a feature:
// config loaders, logger, generic middleware helpers, DB access shims.
const INFRA_NAME_MARKERS = [
  /^backend\/services\/(logger|config|secretVault|billingService|organizationService)/,
  /Middleware/i,
];

function classify(file) {
  let src = "";
  try { src = readFileSync(path.join(REPO_ROOT, file), "utf8"); } catch { return { file, category: "UNKNOWN", reason: "unreadable" }; }

  if (KNOWN_REAL_EXTERNAL.has(file)) {
    return { file, category: "REAL_EXTERNAL_INTEGRATION", reason: "verified real vendor HTTP/SDK call (manual audit)" };
  }

  const hasExternalIO = EXTERNAL_IO_MARKERS.some((r) => r.test(src));
  const hasLocalExec = LOCAL_EXEC_MARKERS.some((r) => r.test(src));
  const hasLocalPersist = LOCAL_PERSIST_MARKERS.some((r) => r.test(src));
  const isInfraName = INFRA_NAME_MARKERS.some((r) => r.test(file));

  // Vendor hostname present -> treat as real external integration even if not
  // in the hand-verified list (catches any the manual pass missed).
  const vendorHostMatch = src.match(/https?:\/\/(api\.[a-z0-9.\-]+|[a-z0-9.\-]+\.amazonaws\.com|graph\.facebook\.com|api\.telegram\.org|api\.anthropic\.com|api\.openai\.com|generativelanguage\.googleapis\.com)/i);
  if (vendorHostMatch && hasExternalIO) {
    return { file, category: "REAL_EXTERNAL_INTEGRATION", reason: `external vendor host referenced: ${vendorHostMatch[1]}` };
  }

  if (hasLocalExec && !hasExternalIO) {
    return { file, category: "LOCAL_EXECUTION", reason: "runs local process/OS commands (execSync/spawn) with no external network call" };
  }

  if (isInfraName) {
    return { file, category: "INFRASTRUCTURE", reason: "cross-cutting plumbing (config/logging/vault/core org-account service), not a feature engine" };
  }

  // Heuristic for "fabricates business reality" simulation vs plain internal
  // orchestration: filename patterns matching the audited *Org/company/civ/
  // ecosystem/enterprise family that persist local JSON and model self-generated
  // entities (customers, revenue, agents) rather than the product's own state.
  const SIMULATION_NAME_MARKERS = [
    /Org(State|Workflow)?\.cjs$/, /civilization/i, /ecosystem/i, /enterprise/i,
    /autonomous(Org|Platform|Marketplace|Revenue|Investment|Evolution|Knowledge)/i, /workforceOS/i,
    /companyFactory/i, /customerOrg/i, /productFactory/i, /knowledgeNetwork/i,
    /physicalWorld/i, /scientificDiscovery/i, /globalInfrastructure/i,
    /organizationNetwork/i, /founderTwin/i, /founderIdentityOS/i, /-x\.cjs$/,
    // Abbreviated org-family state/workflow siblings — same registry+tick
    // pattern as the *Org.cjs files but named after the routes/index.js
    // short prefix (aeo/ako/eos/ent/eco/civ/auto/bizorg/engorg) rather than
    // the full "...Org" name, e.g. aeoState.cjs, ecoWorkflow.cjs, evolutionOrg.cjs.
    /^backend\/services\/(aeo|ako|eos|ent|eco|civ|bizorg|engorg)(State|Workflow|Summary|Dashboard)?\.cjs$/,
    /platformOrgState\.cjs$/, /^backend\/services\/(pomega|postOmega)/i,
  ];
  const looksSimulated = SIMULATION_NAME_MARKERS.some((r) => r.test(file));

  if (hasLocalPersist && !hasExternalIO) {
    return {
      file,
      category: looksSimulated ? "SIMULATION" : "BUSINESS_LOGIC",
      reason: looksSimulated
        ? "persists to local data/*.json only; models self-generated org/company/civilization/knowledge entities with no external I/O"
        : "persists to local data/*.json only; orchestrates the product's own real feature state (missions/workspace/etc), not fabricated business entities",
    };
  }

  if (!hasLocalPersist && !hasExternalIO && !hasLocalExec) {
    return {
      file,
      category: looksSimulated ? "SIMULATION" : "BUSINESS_LOGIC",
      reason: "pure in-memory logic, no persistence and no external I/O",
    };
  }

  return { file, category: "BUSINESS_LOGIC", reason: "internal orchestration logic not matching other categories" };
}

const results = files.map(classify);
const totals = {};
for (const r of results) totals[r.category] = (totals[r.category] || 0) + 1;

const out = { generatedAt: new Date().toISOString(), totalFiles: files.length, totals, files: results };
console.log(JSON.stringify(out, null, 2));
