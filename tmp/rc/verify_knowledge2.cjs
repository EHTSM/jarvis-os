const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

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
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => /^More\s*\(\d+\)/i.test((b.textContent||'').trim()));
    if (btn) btn.click();
  });
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('li, button, div[role="option"], a, span'));
    const hit = all.find(el => el.children.length === 0 && /Knowledge/i.test(el.textContent||''));
    if (hit) hit.click();
  });
  await page.waitForTimeout(2000);

  // Click the opportunity node
  const clicked = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.kg-node-row'));
    const opp = rows.find(r => r.textContent.includes('opp_'));
    if (opp) { opp.click(); return true; }
    return false;
  });
  console.log('clicked opportunity node:', clicked);
  await page.waitForTimeout(1500);

  const bodyText = await page.evaluate(() => document.body.innerText);
  console.log('--- impact panel area ---');
  console.log(bodyText.slice(bodyText.indexOf('Impact of'), bodyText.indexOf('Impact of') + 500));
  console.log('page errors:', JSON.stringify(errors));

  await browser.close();
})().catch(e => { console.error('SCRIPT ERROR:', e.message); process.exit(1); });
