const fs = require("fs");
const path = require("path");

// Static regression guard for category 8 (fake/mock/sample-data detection).
// Two prior audit missions found the same recurring bug shape: a component
// fetches real data into state, but the render path (or a sibling `useState`)
// keeps reading a permanent SEED_/MOCK_/FAKE_ constant instead, so fabricated
// rows get shown to real users with no disclosure. This doesn't re-derive
// business logic — it just asserts the invariant "if a file defines a
// SEED_/MOCK_/FAKE_ constant, the file must also disclose when it's showing
// sample data" so a future regression fails CI instead of surviving to the
// next manual audit.

const COMPONENTS_DIR = path.join(__dirname, "..", "components");

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith(".jsx")) out.push(full);
  }
  return out;
}

const SEED_CONST_RE = /^const (SEED_|MOCK_|FAKE_|DUMMY_)\w+\s*=/m;
// Any of these signal the file is honest about sample data:
//  - an explicit disclosure component/flag driven by a real fetch result
//  - `_load(key, SEED_X)` — reads localStorage first, seed is only a
//    first-run default for a client-local feature, not a backend fetch
//    silently discarded (a materially different, defensible pattern)
const DISCLOSURE_RE = /isSample|SampleDataNotice|missionsLive|recsLive|showingFallback|apiDown|liveData|_load\(/;

// Frontend A-Z audit (Mission 21, 2026-08-22) found these components are
// fully orphaned — imported by nothing, unreachable from any nav path — so
// their fabricated data is never shown to a real user. Mission 22 was
// explicitly told not to delete orphan components, so they're excluded here
// rather than "fixed": there is no live-user-facing bug to guard against
// until/unless a future mission wires one of these back into the app, at
// which point removing it from this list is the correct next step.
const KNOWN_ORPHAN_COMPONENTS = new Set([
  "ActivityStream.jsx", "AgentCenter.jsx", "AutonomousCompanyCenter.jsx",
  "AutonomousMarketingCenter.jsx", "AutonomousRevenueCenter.jsx",
  "AutonomousSupportCenter.jsx", "CommunityCenter.jsx", "ContentEngine.jsx",
  "DataOwnershipCenter.jsx", "DeveloperOS.jsx", "DisasterRecoveryCenter.jsx",
  "EmailMarketingOS.jsx", "EnterpriseCRM.jsx", "EnterpriseOS.jsx",
  "ExecutiveReports.jsx", "LaunchCommandCenter.jsx", "PaymentPanel.jsx",
  "PersonalOS.jsx", "SeoCommandCenter.jsx", "SocialHub.jsx",
]);

describe("sample-data disclosure — static audit (category 8)", () => {
  const files = walk(COMPONENTS_DIR)
    .filter((f) => SEED_CONST_RE.test(fs.readFileSync(f, "utf8")))
    .filter((f) => !KNOWN_ORPHAN_COMPONENTS.has(path.basename(f)));

  test("at least one component file defines a SEED_/MOCK_ constant (sanity check the scan itself works)", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  test.each(files.map((f) => [path.relative(COMPONENTS_DIR, f), f]))(
    "%s: SEED_/MOCK_ data is disclosed to the user, not presented as real",
    (_name, file) => {
      const src = fs.readFileSync(file, "utf8");
      expect(DISCLOSURE_RE.test(src)).toBe(true);
    },
  );
});
