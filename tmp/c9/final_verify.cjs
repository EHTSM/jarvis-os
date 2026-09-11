const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  const consoleErrors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  await page.request.post('http://localhost:5050/auth/login', {
    data: { email: process.argv[2], password: 'TestPass123!' },
    headers: { 'Content-Type': 'application/json' },
  });

  await page.goto('http://localhost:5050/', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    const skip = Array.from(document.querySelectorAll('button')).find(b => /skip for now/i.test(b.textContent||''));
    if (skip) skip.click();
  });
  await page.waitForTimeout(500);

  // Visit every AI-related surface
  const surfaces = ['AI Chat', 'AI Costs'];
  for (const label of surfaces) {
    try {
      await page.locator(`[aria-label="${label}"]`).first().click({ timeout: 3000 });
    } catch {
      // AI Costs is under More menu — expand it
      const btn = await page.evaluate(() => {
        const b = Array.from(document.querySelectorAll('button')).find(x => /^More\s*\(\d+\)/i.test((x.textContent||'').trim()));
        if (b) { b.click(); return true; }
        return false;
      });
      await page.waitForTimeout(600);
      await page.evaluate((lbl) => {
        const all = Array.from(document.querySelectorAll('li, button, div[role="option"], a, span'));
        const hit = all.find(el => el.children.length === 0 && el.textContent.trim() === lbl);
        if (hit) hit.click();
      }, label);
    }
    await page.waitForTimeout(1500);
  }

  console.log('pageerrors:', JSON.stringify(errors));
  console.log('console errors:', JSON.stringify(consoleErrors));
  await browser.close();
})().catch(e => { console.error('SCRIPT ERROR:', e.message); process.exit(1); });
