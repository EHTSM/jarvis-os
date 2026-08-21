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

  const r = await p.evaluate(() => {
    const actions = document.querySelector(".topbar-actions");
    if (!actions) return { found: false };
    const kids = [...actions.children].map(el => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return { tag: el.tagName.toLowerCase(), cls: (el.className || "").toString().slice(0, 40),
        left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width),
        flexShrink: cs.flexShrink, display: cs.display, visible: r.width > 0 };
    });
    const ar = actions.getBoundingClientRect();
    return { found: true, actionsRect: { left: Math.round(ar.left), right: Math.round(ar.right), width: Math.round(ar.width) },
      viewportWidth: window.innerWidth, children: kids };
  });
  console.log(JSON.stringify(r, null, 1));
  await b.close();
})();
