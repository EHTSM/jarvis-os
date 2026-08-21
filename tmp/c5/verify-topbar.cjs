const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch();
  const c = await b.newContext({ viewport: { width: 390, height: 844 } });
  const p = await c.newPage();
  await p.goto("http://localhost:5050/", { waitUntil: "domcontentloaded" });
  await p.evaluate(async d => fetch("/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(d) }), { email: "c2-audit-fixed@test.local", password: "C2Audit!2026x" });
  await p.goto("http://localhost:5050/", { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(3200);
  const skip = await p.$(".cfr-btn-skip");
  if (skip) { await skip.click(); await p.waitForTimeout(900); }

  const docOverflow = await p.evaluate(() => {
    const de = document.documentElement;
    return { scrollWidth: de.scrollWidth, clientWidth: de.clientWidth, overflow: de.scrollWidth - de.clientWidth };
  });
  console.log("document overflow:", JSON.stringify(docOverflow));

  const actionsScroll = await p.evaluate(() => {
    const a = document.querySelector(".topbar-actions");
    return { scrollWidth: a.scrollWidth, clientWidth: a.clientWidth, overflowX: getComputedStyle(a).overflowX, overflowY: getComputedStyle(a).overflowY };
  });
  console.log("topbar-actions:", JSON.stringify(actionsScroll));

  // Scroll the row to reach the org-switcher, then open its dropdown and prove
  // it actually paints and receives clicks (the exact test that caught the
  // .tabs defect previously).
  const orgBtn = await p.$(".org-switcher-trigger");
  await orgBtn.scrollIntoViewIfNeeded();
  await orgBtn.click();
  await p.waitForTimeout(500);

  const dropdownCheck = await p.evaluate(() => {
    const dd = document.querySelector(".org-switcher-dropdown");
    if (!dd) return { found: false };
    const r = dd.getBoundingClientRect();
    const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + Math.min(20, r.height / 2));
    const hits = document.elementsFromPoint(cx, cy);
    const hitsDropdown = hits.some(el => el === dd || dd.contains(el));
    return {
      found: true, rect: { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) },
      receivesClicksAtCenter: hitsDropdown,
      visible: r.width > 0 && r.height > 0,
    };
  });
  console.log("org-switcher-dropdown:", JSON.stringify(dropdownCheck));

  await b.close();
})();
