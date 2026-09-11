const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch();
  const c = await b.newContext();
  const p = await c.newPage();
  await p.goto("http://localhost:5050/", { waitUntil: "domcontentloaded" });
  await p.evaluate(async d => fetch("/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(d) }), { email: "c2-audit-fixed@test.local", password: "C2Audit!2026x" });
  await p.goto("http://localhost:5050/", { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(3200);
  const sk = await p.$(".cfr-btn-skip");
  if (sk) { await sk.click(); await p.waitForTimeout(800); }

  // Inject a tw-toast element directly (simulating what K2 renders) WITHOUT
  // ever having navigated to TeamWorkspace, to test whether its CSS loaded.
  const result = await p.evaluate(() => {
    const el = document.createElement("div");
    el.className = "tw-toast";
    el.textContent = "Token revoked";
    document.body.appendChild(el);
    const cs = getComputedStyle(el);
    const out = {
      position: cs.position,
      background: cs.backgroundColor,
      border: cs.borderStyle,
      borderRadius: cs.borderRadius,
      padding: cs.padding,
      fontWeight: cs.fontWeight,
      zIndex: cs.zIndex,
    };
    el.remove();
    return out;
  });
  console.log(JSON.stringify(result, null, 1));
  await b.close();
})();
