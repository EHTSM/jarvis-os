const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const resp = await page.request.post('http://localhost:5050/auth/login', {
    data: { email: process.argv[2], password: 'TestPass123!' },
    headers: { 'Content-Type': 'application/json' },
  });
  console.log('login status:', resp.status());

  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push('console.error: ' + msg.text()); });

  await page.goto('http://localhost:5050/', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  await page.evaluate(() => {
    const skip = Array.from(document.querySelectorAll('button')).find(b => /skip for now/i.test(b.textContent||''));
    if (skip) skip.click();
  });
  await page.waitForTimeout(500);

  // Click "More (82)" to expand nav
  const moreClicked = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => /^More\s*\(\d+\)/i.test((b.textContent||'').trim()));
    if (btn) { btn.click(); return true; }
    return false;
  });
  console.log('more clicked:', moreClicked);
  await page.waitForTimeout(800);

  const navSnapshot = await page.evaluate(() => document.body.innerText.slice(0, 3000));
  console.log('--- nav after More click ---');
  console.log(navSnapshot);

  const clicked = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('li, button, div[role="option"], a, span'));
    const hit = all.find(el => el.children.length === 0 && el.textContent.trim() === 'AI Costs');
    if (hit) { hit.click(); return hit.textContent.trim(); }
    return null;
  });
  console.log('result clicked:', clicked);
  await page.waitForTimeout(2000);

  const bodyText = await page.evaluate(() => document.body.innerText);
  const hasFabricatedMarkers = /claude-3-haiku|2,180,000|\$2\.69|17% of Qwen/i.test(bodyText);
  const hasHonestEmptyState = /No AI usage recorded yet/i.test(bodyText);
  const hasTitle = /AI Cost Management/i.test(bodyText);

  console.log('page has title:', hasTitle);
  console.log('has fabricated markers (should be false):', hasFabricatedMarkers);
  console.log('has honest empty state (should be true if reached):', hasHonestEmptyState);
  console.log('page errors:', JSON.stringify(errors));
  console.log('--- body snippet ---');
  console.log(bodyText.slice(0, 2500));

  await page.screenshot({ path: 'tmp/c9/aicost_screenshot.png', fullPage: true }).catch(()=>{});
  await browser.close();
})().catch(e => { console.error('SCRIPT ERROR:', e.message); process.exit(1); });
