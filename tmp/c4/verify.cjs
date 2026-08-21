const { chromium } = require("playwright");
const AXE = require.resolve("axe-core/axe.min.js");
(async () => {
  const b = await chromium.launch();
  for (const theme of ["dark", "light"]) {
    const c = await b.newContext({ colorScheme: theme });
    const p = await c.newPage();
    await p.goto("http://localhost:5050/", { waitUntil: "domcontentloaded" });
    await p.evaluate(async d => fetch("/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(d) }), { email: "c2-audit-fixed@test.local", password: "C2Audit!2026x" });
    await p.goto("http://localhost:5050/", { waitUntil: "domcontentloaded" });
    await p.waitForTimeout(3200);
    await p.evaluate(t => document.documentElement.setAttribute("data-theme", t), theme);
    const sk = await p.$(".cfr-btn-skip");
    if (sk) { await sk.click(); await p.waitForTimeout(800); }

    const r = await p.evaluate(() => {
      const mk = (cls, tag = "div") => { const e = document.createElement(tag); e.className = cls; e.textContent = "x"; document.body.appendChild(e); const cs = getComputedStyle(e).color; e.remove(); return cs; };
      const tokVal = getComputedStyle(document.documentElement).getPropertyValue("--success").trim();
      const warnVal = getComputedStyle(document.documentElement).getPropertyValue("--warning").trim();
      return {
        btnSuccessColor: mk("btn-success", "button"),
        successToken: tokVal,
        warningToken: warnVal,
      };
    });
    console.log(`[${theme}]`, JSON.stringify(r));

    await p.addScriptTag({ path: AXE });
    const axeR = await p.evaluate(async () => {
      const res = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
      return res.violations.map(v => v.id + "(" + v.nodes.length + ")");
    });
    console.log(`[${theme}] axe violations:`, axeR.length ? axeR.join(",") : "0");
    await c.close();
  }
  await b.close();
})();
