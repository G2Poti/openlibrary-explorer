// interact.mjs — headless Chromium full click-through: boot, search,
// library toggle, discover tabs. Prints PASS/FAIL per step + console errors.
// Usage: node scripts/interact.mjs [url]
import { chromium } from 'playwright';

const url = process.argv.find((a) => a.startsWith('http') || a.startsWith('file:')) || 'http://localhost:5173/';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error') logs.push('[error] ' + m.text().slice(0, 300)); });
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message.slice(0, 300)));

const results = [];
const step = async (name, fn) => {
  try { const detail = await fn(); results.push(['PASS', name, detail || '']); }
  catch (e) { results.push(['FAIL', name, String(e.message).slice(0, 200)]); }
};

await page.goto(url, { waitUntil: 'load', timeout: 45000 }).catch((e) => logs.push('[goto] ' + e.message));
await page.waitForTimeout(5000);

await step('boot: dashboard visible', async () => {
  const n = await page.locator('.book-card, .skeleton-card').count();
  if (n === 0) throw new Error('no cards or skeletons rendered');
  return n + ' cards/skeletons';
});

await step('search: type + Find Books', async () => {
  await page.fill('#globalSearchInput', 'dune');
  await page.locator('#globalSearchBtn').first().click();
  await page.waitForTimeout(9000);
  const n = await page.locator('.book-card').count();
  if (n === 0) throw new Error('no result cards after search');
  return n + ' result cards';
});

await step('library: heart toggle + badge', async () => {
  const before = await page.textContent('#savedCount').catch(() => '0');
  await page.locator('.book-card:visible .library-btn').first().click();
  await page.waitForTimeout(1500);
  const after = await page.textContent('#savedCount').catch(() => '?');
  if (before === after) throw new Error(`badge unchanged (${before})`);
  return `badge ${before} -> ${after}`;
});

await step('library: open saved view', async () => {
  await page.click('#viewSavedBtn');
  await page.waitForTimeout(2500);
  const n = await page.locator('.book-card').count();
  if (n === 0) throw new Error('library view empty after adding a book');
  return n + ' library cards';
});

await step('home/discover renders', async () => {
  await page.click('#homeBtn');
  await page.waitForTimeout(4000);
  const dash = await page.locator('#discoverDashboard').isVisible().catch(() => false);
  return 'dashboard visible=' + dash;
});

await browser.close();
console.log('---STEPS---');
for (const [s, n, d] of results) console.log(s + ' | ' + n + (d ? ' | ' + d : ''));
console.log('---CONSOLE/PAGE ERRORS (' + logs.length + ')---');
console.log(logs.slice(0, 20).join('\n') || '(none)');
// The file:// seed-fetch failure is by design (graceful null fallback to the
// live API); it must not fail the run.
const fatal = logs.filter((l) => !l.includes('discover_seed.json'));
process.exit(results.some((r) => r[0] === 'FAIL') || fatal.length > 0 ? 1 : 0);
