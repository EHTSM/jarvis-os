const { chromium } = require("playwright");
const CREDS = { email: "c2-audit-fixed@test.local", password: "C2Audit!2026x" };

async function ensureAuth(page) {
  const status = await page.evaluate(async d =>
    (await fetch("/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(d) })).status, CREDS);
  return status;
}

(async () => {
  const b = await chromium.launch();
  const c = await b.newContext({ viewport: { width: 390, height: 844 } });
  const p = await c.newPage();
  await p.goto("http://localhost:5050/", { waitUntil: "domcontentloaded" });
  const loginStatus = await ensureAuth(p);
  console.log("login:", loginStatus);
  await p.goto("http://localhost:5050/", { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(3200);
  const hasTabs = await p.evaluate(() => !!document.querySelector(".tab"));
  console.log("auth verified (hasTabs):", hasTabs);
  if (!hasTabs) { await b.close(); return; }
  const skip = await p.$(".cfr-btn-skip");
  if (skip) { await skip.click(); await p.waitForTimeout(900); }

  // ── FORMS: Payments tab ──────────────────────────────────────────────
  console.log("\n[FORMS — Payments @ 390px]");
  await p.getByText("Payments", { exact: true }).first().click({ timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(1200);
  const forms = await p.evaluate(() => {
    const inputs = [...document.querySelectorAll("input:not([type=hidden]),select,textarea")].filter(e => e.getBoundingClientRect().width > 0);
    const clipped = inputs.filter(e => { const r = e.getBoundingClientRect(); return r.right > window.innerWidth + 1; });
    const btn = document.querySelector("button.pv2-btn--primary, button[class*=primary]");
    const btnRect = btn ? btn.getBoundingClientRect() : null;
    return {
      inputCount: inputs.length, clippedCount: clipped.length,
      submitBtnReachable: btnRect ? (btnRect.right <= window.innerWidth + 1 && btnRect.top < 844) : null,
      docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  console.log(JSON.stringify(forms));

  // ── DIALOGS: Command palette ─────────────────────────────────────────
  console.log("\n[DIALOGS — Command palette @ 390px]");
  await p.keyboard.press("Meta+k");
  await p.waitForTimeout(500);
  const dialog = await p.evaluate(() => {
    const d = document.querySelector("[role=dialog]");
    if (!d) return { found: false };
    const r = d.getBoundingClientRect();
    return {
      found: true, fitsViewport: r.width <= window.innerWidth + 1,
      width: Math.round(r.width), viewportWidth: window.innerWidth,
      docOverflowWithDialogOpen: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  console.log(JSON.stringify(dialog));
  await p.keyboard.press("Escape");
  await p.waitForTimeout(400);
  const closedOk = await p.evaluate(() => !document.querySelector("[role=dialog]"));
  console.log("escape closes:", closedOk);

  // ── CONFIRMATION DIALOG: token revoke (Settings) ─────────────────────
  console.log("\n[DIALOGS — destructive confirmation @ 390px]");
  await p.getByText(/^More/, { exact: false }).first().click({ timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(800);
  const settingsBtn = await p.getByText(/settings/i, { exact: false }).first();
  await settingsBtn.click({ timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(1200);
  const settingsState = await p.evaluate(() => ({
    docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    hasContent: document.body.innerText.length,
  }));
  console.log("settings page:", JSON.stringify(settingsState));

  // ── DASHBOARD: home ───────────────────────────────────────────────────
  console.log("\n[DASHBOARD — Dashboard @ 390px]");
  await p.getByText("Dashboard", { exact: true }).first().click({ timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(2000);
  const dash = await p.evaluate(() => {
    const cards = [...document.querySelectorAll('[class*=card],[class*=metric],[class*=kpi]')].filter(e => e.getBoundingClientRect().width > 0);
    const clipped = cards.filter(e => { const r = e.getBoundingClientRect(); return r.right > window.innerWidth + 1; });
    return {
      cardCount: cards.length, clippedCards: clipped.length,
      docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  console.log(JSON.stringify(dash));

  // ── TABLES: Contacts list ────────────────────────────────────────────
  console.log("\n[TABLES/DATA — Contacts @ 390px]");
  await p.getByText("Contacts", { exact: true }).first().click({ timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(1500);
  const table = await p.evaluate(() => ({
    docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    hasList: !!document.querySelector('[class*=list],[class*=row],table'),
  }));
  console.log(JSON.stringify(table));

  // ── TYPOGRAPHY: long content clipping check ──────────────────────────
  console.log("\n[TYPOGRAPHY — text overflow check]");
  const typo = await p.evaluate(() => {
    const els = [...document.querySelectorAll("h1,h2,h3,button,.tab,span")].filter(e => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && e.textContent && e.textContent.trim().length > 0;
    });
    const overflowing = els.filter(e => e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).overflow !== "hidden" && getComputedStyle(e).textOverflow !== "ellipsis");
    return { checked: els.length, unhandledOverflow: overflowing.length,
      samples: overflowing.slice(0, 5).map(e => ({ tag: e.tagName, cls: (e.className || "").toString().slice(0, 30), text: e.textContent.trim().slice(0, 30) })) };
  });
  console.log(JSON.stringify(typo, null, 1));

  await b.close();
})();
