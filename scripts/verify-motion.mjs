// verify-motion.mjs — exercises the new smooth-scroll floor + header follower:
// synthetic wheel ticks (incl. tiny ones), stepped scrollTop sampling of the
// header progress var, legacy-layout removal to activate the desktop zone.
// Usage: node scripts/verify-motion.mjs [url]
import { chromium } from 'playwright';

const url = process.argv.find((a) => a.startsWith('http') || a.startsWith('file:')) || 'http://localhost:5173/';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const logs = [];
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message.slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('discover_seed.json')) logs.push('[error] ' + m.text().slice(0, 200)); });
const out = [];
await page.goto(url, { waitUntil: 'load', timeout: 45000 }).catch((e) => logs.push('[goto] ' + e.message));
await page.waitForTimeout(4000);

// ensure lots of scrollable content
await page.fill('#globalSearchInput', 'dune').catch(() => {});
await page.locator('#globalSearchBtn').first().click().catch(() => {});
await page.waitForTimeout(9000);

// 1. tiny-tick floor: dispatch 3 synthetic small wheel events, assert motion
const tiny = await page.evaluate(async () => {
  const main = document.querySelector('main.results');
  if (!main) return 'no-main';
  main.scrollTop = 200;
  await new Promise((r) => setTimeout(r, 300));
  const before = main.scrollTop;
  for (let i = 0; i < 3; i++) {
    main.dispatchEvent(new WheelEvent('wheel', { deltaY: 12, bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 120));
  }
  await new Promise((r) => setTimeout(r, 600));
  return { before: Math.round(before), after: Math.round(main.scrollTop) };
});
out.push('tiny-tick motion: ' + JSON.stringify(tiny));

// 2. header follower: force desktop zone, step scrollTop, sample progress var
const header = await page.evaluate(async () => {
  document.body.classList.remove('legacy-layout');
  const main = document.querySelector('main.results');
  const hdr = document.querySelector('.results-header');
  if (!main || !hdr) return 'no-elements';
  const samples = [];
  for (const st of [0, 75, 100, 150, 220, 320, 400]) {
    main.scrollTop = st;
    main.dispatchEvent(new Event('scroll', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 350));
    samples.push(st + '->' + (hdr.style.getPropertyValue('--desktop-sticky-progress') || 'off'));
  }
  return samples.join(' | ');
});
out.push('header progress: ' + header);

// 2b. teardown snap: engage deep, fling to top, class must drop near-instantly
const teardown = await page.evaluate(async () => {
  document.body.classList.remove('legacy-layout');
  const main = document.querySelector('main.results');
  const hdr = document.querySelector('.results-header');
  if (!main || !hdr) return 'no-elements';
  main.scrollTop = 400;
  main.dispatchEvent(new Event('scroll', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 800));
  const engaged = hdr.classList.contains('desktop-sticky-active');
  main.scrollTop = 0;
  main.dispatchEvent(new Event('scroll', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));
  const dropped = !hdr.classList.contains('desktop-sticky-active');
  return 'engaged=' + engaged + ' droppedWithin60ms=' + dropped;
});
out.push('header teardown: ' + teardown);

// 2c. teardown latch regression: engage, exit zone upward (teardown), then
// re-engage deep — the header must come back (NaN latch = stuck disengaged).
const relatch = await page.evaluate(async () => {
  document.body.classList.remove('legacy-layout');
  const main = document.querySelector('main.results');
  const hdr = document.querySelector('.results-header');
  if (!main || !hdr) return 'no-elements';
  main.scrollTop = 200;
  main.dispatchEvent(new Event('scroll', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 600));
  main.scrollTop = 0;
  main.dispatchEvent(new Event('scroll', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));
  main.scrollTop = 400;
  main.dispatchEvent(new Event('scroll', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 800));
  const back = hdr.classList.contains('desktop-sticky-active');
  const prog = hdr.style.getPropertyValue('--desktop-sticky-progress') || 'off';
  return 'reengaged=' + back + ' progress=' + prog;
});
out.push('header relatch: ' + relatch);

// 3. scrolldebug flag boots clean
await page.goto(url + (url.includes('?') ? '&' : '?') + 'scrolldebug=1', { waitUntil: 'load', timeout: 45000 }).catch(() => {});
await page.waitForTimeout(3000);
out.push('scrolldebug boot ok');

await browser.close();
console.log(out.join('\n'));
console.log('---ERRORS (' + logs.length + ')---');
console.log(logs.slice(0, 10).join('\n') || '(none)');
process.exit(logs.length > 0 ? 1 : 0);
