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

  await p.getByText(/^More/, { exact: false }).first().click({ timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(900);
  const items = await p.evaluate(() =>
    [...document.querySelectorAll("button")].map(b => b.textContent.trim()).filter(t => /setting/i.test(t)));
  console.log("settings-like items in More menu:", JSON.stringify(items.slice(0, 5)));

  const target = await p.getByText(/settings/i, { exact: false }).first();
  await target.click({ timeout: 8000 }).catch(e => console.log("click err:", e.message.slice(0, 80)));
  await p.waitForTimeout(1500);

  const chunkLoaded = await p.evaluate(() => {
    const links = [...document.querySelectorAll('link[rel=stylesheet]')].map(l => l.href);
    return links.filter(h => /\d+\.[a-f0-9]+\.chunk\.css/.test(h));
  });
  console.log("loaded CSS chunks:", chunkLoaded.length);

  const twToastStyled = await p.evaluate(() => {
    // does a rule for .tw-toast now exist in any loaded stylesheet?
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (rule.selectorText === ".tw-toast") return true;
        }
      } catch { /* cross-origin sheet, skip */ }
    }
    return false;
  });
  console.log(".tw-toast rule present in loaded stylesheets:", twToastStyled);

  await b.close();
})();
