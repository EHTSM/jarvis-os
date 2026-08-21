const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.request.post('http://localhost:5050/auth/login', {
    data: { email: process.argv[2], password: 'TestPass123!' },
    headers: { 'Content-Type': 'application/json' },
  });

  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

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
  console.log('chat input visible: true');

  await input.focus();
  const isFocused = await input.evaluate(el => document.activeElement === el);
  console.log('input focusable + focus works:', isFocused);

  await input.fill('hello from playwright, respond briefly');
  const t0 = Date.now();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);

  const loadingState = await page.evaluate(() => {
    const inp = document.querySelector('[aria-label="Message Ooplix"]');
    return { disabled: inp?.disabled, placeholder: inp?.placeholder };
  });
  console.log('input state shortly after submit (loading indication):', JSON.stringify(loadingState));

  await page.waitForTimeout(8000);
  const finalState = await page.evaluate(() => {
    const inp = document.querySelector('[aria-label="Message Ooplix"]');
    return { disabled: inp?.disabled, placeholder: inp?.placeholder };
  });
  const elapsed = Date.now() - t0;
  console.log('input state after 8s wait:', JSON.stringify(finalState), 'elapsed:', elapsed, 'ms');

  const messages = await page.evaluate(() => {
    const nodes = document.querySelectorAll('[class*="msg"], [class*="message"]');
    return Array.from(nodes).slice(-6).map(n => n.textContent.slice(0,150));
  });
  console.log('recent messages:', JSON.stringify(messages, null, 2));

  console.log('page errors:', JSON.stringify(errors));
  await page.screenshot({ path: 'tmp/c9/chat_screenshot.png', fullPage: true }).catch(()=>{});
  await browser.close();
})().catch(e => { console.error('SCRIPT ERROR:', e.message); process.exit(1); });
