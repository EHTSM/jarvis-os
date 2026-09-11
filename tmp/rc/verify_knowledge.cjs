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

  // Expand "More" and click Knowledge
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => /^More\s*\(\d+\)/i.test((b.textContent||'').trim()));
    if (btn) btn.click();
  });
  await page.waitForTimeout(600);
  const clicked = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('li, button, div[role="option"], a, span'));
    const hit = all.find(el => el.children.length === 0 && /Knowledge/i.test(el.textContent||''));
    if (hit) { hit.click(); return hit.textContent.trim(); }
    return null;
  });
  console.log('nav clicked:', clicked);
  await page.waitForTimeout(2000);

  const bodyText = await page.evaluate(() => document.body.innerText);
  const hasFabricatedMarkers = /Product Roadmap Q3 2026|Ooplix Pitch Deck|Technical Architecture\.docx/i.test(bodyText);
  const hasRealTitle = /Knowledge Graph/i.test(bodyText);
  const hasRealCounts = /Indexed entities/i.test(bodyText);

  console.log('has real title:', hasRealTitle);
  console.log('has fabricated markers (should be false):', hasFabricatedMarkers);
  console.log('has real counts label:', hasRealCounts);
  console.log('page errors:', JSON.stringify(errors));
  console.log('--- body snippet ---');
  console.log(bodyText.slice(bodyText.indexOf('Knowledge Graph'), bodyText.indexOf('Knowledge Graph') + 1500));

  await page.screenshot({ path: 'tmp/rc/knowledge_screenshot.png', fullPage: true }).catch(()=>{});
  await browser.close();
})().catch(e => { console.error('SCRIPT ERROR:', e.message); process.exit(1); });
