const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

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

  await page.locator('[aria-label="AI Chat"]').first().click({ timeout: 5000 });
  const input = page.locator('[aria-label="Message Ooplix"]');
  await input.waitFor({ state: 'visible', timeout: 8000 });
  await input.fill('hello, respond briefly please');
  const t0 = Date.now();
  await page.keyboard.press('Enter');

  // Poll every 2s up to 40s for the input to re-enable (request settled, success or failure)
  let settled = false;
  let elapsed = 0;
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(2000);
    elapsed = Date.now() - t0;
    const disabled = await page.locator('[aria-label="Message Ooplix"]').isDisabled();
    console.log(`t+${elapsed}ms: input disabled=${disabled}`);
    if (!disabled) { settled = true; break; }
  }
  console.log('settled:', settled, 'total elapsed:', elapsed, 'ms');

  const finalMessages = await page.evaluate(() => {
    const nodes = document.querySelectorAll('[class*="msg"]');
    return Array.from(nodes).slice(-4).map(n => n.textContent.slice(0,200));
  });
  console.log('final messages:', JSON.stringify(finalMessages, null, 2));

  await browser.close();
})().catch(e => { console.error('SCRIPT ERROR:', e.message); process.exit(1); });
