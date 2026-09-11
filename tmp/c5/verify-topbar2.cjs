const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch();
  const c = await b.newContext({ viewport: { width: 390, height: 844 } });
  const p = await c.newPage();
  await p.goto("http://localhost:5050/", { waitUntil: "domcontentloaded" });
  const loginStatus = await p.evaluate(async d =>
    (await fetch("/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(d) })).status,
    { email: "c2-audit-fixed@test.local", password: "C2Audit!2026x" });
  console.log("login status:", loginStatus);
  await p.goto("http://localhost:5050/", { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(3200);

  const appClass = await p.evaluate(() => document.querySelector(".app")?.className);
  const hasTabs = await p.evaluate(() => !!document.querySelector(".tab"));
  console.log("app class:", appClass, "| hasTabs (auth verified):", hasTabs);
  if (!hasTabs) { console.log("NOT AUTHENTICATED — aborting, would be measuring the wrong page"); await b.close(); return; }

  const skip = await p.$(".cfr-btn-skip");
  if (skip) { await skip.click(); await p.waitForTimeout(900); }

  const docOverflow = await p.evaluate(() => {
    const de = document.documentElement;
    return { scrollWidth: de.scrollWidth, clientWidth: de.clientWidth, overflow: de.scrollWidth - de.clientWidth };
  });
  console.log("document overflow:", JSON.stringify(docOverflow));

  for (const [label, triggerSel, dropdownSel] of [
    ["org-switcher", ".org-switcher-trigger", ".org-switcher-dropdown"],
    ["ws-switcher", ".ws-switcher-trigger", ".ws-switcher-dropdown"],
    ["recent-pages", ".recent-pages .topbar-nav-arrow", ".recent-pages-dropdown"],
  ]) {
    const btn = await p.$(triggerSel);
    if (!btn) { console.log(`${label}: trigger not found`); continue; }
    await btn.click();
    await p.waitForTimeout(500);
    const r = await p.evaluate((sel) => {
      const dd = document.querySelector(sel);
      if (!dd) return { found: false };
      const rect = dd.getBoundingClientRect();
      const cx = Math.round(rect.left + rect.width / 2), cy = Math.round(rect.top + Math.min(20, rect.height / 2));
      const hits = document.elementsFromPoint(cx, cy);
      return {
        found: true, visible: rect.width > 0 && rect.height > 0,
        hitsDropdown: hits.some(el => el === dd || dd.contains(el)),
        topHit: hits[0] ? (hits[0].className || hits[0].tagName) : null,
      };
    }, dropdownSel);
    console.log(`${label}:`, JSON.stringify(r));
    // close it
    await p.keyboard.press("Escape").catch(() => {});
    await p.waitForTimeout(300);
  }

  await b.close();
})();
