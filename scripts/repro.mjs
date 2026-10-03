// repro.mjs — headless Chromium against vite dev: dumps console errors,
// page errors, failed requests, and key DOM state. Usage:
//   node scripts/repro.mjs [url] [--shot=path]
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const url = process.argv.find((a) => a.startsWith('http') || a.startsWith('file:')) || 'http://localhost:5173/';
const shotArg = process.argv.find((a) => a.startsWith('--shot='));
const shotPath = shotArg ? shotArg.slice(7) : null;

let vite = null;
if (process.argv.includes('--serve')) {
  vite = spawn('npx', ['vite', '--port', '5173', '--strictPort'], { shell: true, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 6000));
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n  ${String(e.stack).split('\n').slice(0, 4).join('\n  ')}`));
page.on('requestfailed', (r) => logs.push(`[reqfail] ${r.url()} :: ${r.failure()?.errorText}`));

await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 }).catch((e) => logs.push('[goto] ' + e.message));
await page.waitForTimeout(6000);

const state = await page.evaluate(() => ({
  title: document.title,
  bookCards: document.querySelectorAll('.book-card').length,
  skeletons: document.querySelectorAll('.skeleton-card').length,
  gridHtml: (document.getElementById('bookGrid')?.innerHTML || '').slice(0, 200),
  statusText: (document.getElementById('statusMessage')?.textContent || '').slice(0, 200),
  discoverVisible: document.getElementById('discoverDashboard')?.style.display,
  scripts: [...document.scripts].map((s) => s.src || 'inline'),
}));
console.log(JSON.stringify({ state }, null, 1));
if (shotPath) await page.screenshot({ path: shotPath });
await browser.close();
if (vite) vite.kill();
console.log('---CONSOLE/PAGE ERRORS (' + logs.length + ')---');
console.log(logs.slice(0, 30).join('\n') || '(none)');
