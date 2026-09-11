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
  await page.locator('[aria-label="AI Chat"]').first().click({ timeout: 5000 }).catch(e=>console.log('click err', e.message));
  await page.waitForTimeout(1500);
  const inputs = await page.evaluate(() => Array.from(document.querySelectorAll('input')).map(i => ({ariaLabel:i.getAttribute('aria-label'), placeholder:i.getAttribute('placeholder'), type:i.type})));
  console.log('all inputs:', JSON.stringify(inputs));
  const bodyText = await page.evaluate(() => document.body.innerText.slice(0,600));
  console.log('body:', bodyText);
  await browser.close();
})();
