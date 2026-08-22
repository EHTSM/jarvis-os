const fs = require("fs");
const path = require("path");

// Static regression guard for category 6 (tenant/permission UI behavior).
// App.jsx gates a handful of tabs behind `user?.role === "operator"` so a
// regular customer never reaches operator-only surfaces (which also poll
// operatorOnly backend routes — see the "devops" comment in App.jsx). Each
// of those tabs pairs an operator branch with an explicit customer-facing
// branch (CustomerDashboard, ConnectorSetupWizard, a "not available" panel)
// rather than leaving a customer with a blank screen. This test asserts
// that pairing holds, so a future edit can't remove one half unnoticed.

const APP_JSX = fs.readFileSync(path.join(__dirname, "..", "App.jsx"), "utf8");

function tabIdsGatedBy(role) {
  const re = new RegExp(`\\{tab === "(\\w+)" && user\\?\\.role ${role === "operator" ? "===" : "!=="} "operator"`, "g");
  const ids = new Set();
  let m;
  while ((m = re.exec(APP_JSX))) ids.add(m[1]);
  return ids;
}

describe("operator/customer render gating — static audit (category 6)", () => {
  const operatorGated = tabIdsGatedBy("operator");
  const customerGated = tabIdsGatedBy("customer");

  test("sanity check: the scan actually finds operator-gated tabs", () => {
    expect(operatorGated.size).toBeGreaterThan(0);
  });

  test.each([...operatorGated])(
    "tab '%s' has both an operator branch and a customer branch (no blank screen for non-operators)",
    (tabId) => {
      expect(customerGated.has(tabId)).toBe(true);
    },
  );

  test("no tab has a customer branch without a matching operator branch (orphaned check)", () => {
    for (const tabId of customerGated) {
      expect(operatorGated.has(tabId)).toBe(true);
    }
  });
});
