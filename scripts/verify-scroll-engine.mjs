// scripts/diag-toggle.mjs — ONE-OFF: (1) toggle mechanism end-to-end,
// (2) ON-vs-OFF identical wheel flurries compared. Deleted after use.
import { chromium } from 'playwright';
const url = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:5173/';
const failures = [];
const check = (name, cond, detail = '') => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
    if (!cond) failures.push(name);
};
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await context.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', String(e.message).slice(0, 160)));
await page.goto(url, { waitUntil: 'load', timeout: 45000 });
await page.waitForTimeout(2500);
const cdp = await page.context().newCDPSession(page);
await cdp.send('Performance.enable');
const metrics = async () => {
    const { metrics } = await cdp.send('Performance.getMetrics');
    const o = {};
    for (const m of metrics) o[m.name] = m.value;
    return o;
};
// Realistic DOM depth: 150 probe cards.
await page.evaluate(() => {
    const grid = document.getElementById('bookGrid');
    grid.style.display = 'grid';
    const dash = document.getElementById('discoverDashboard');
    if (dash) dash.style.display = 'none';
    const frag = document.createDocumentFragment();
    for (let i = 0; i < 150; i++) {
        const c = document.createElement('div');
        c.className = 'book-card';
        c.style.cssText = 'height:220px;flex:0 0 auto;';
        c.innerHTML = `<div class="card-main"><div class="cover-container"></div><div class="card-details"><div class="book-title">T ${i} With A Fairly Long Title Here</div><div class="book-author">by <span>Author ${i % 13}</span></div><div class="tags-list grid-tags"><span class="tag-row"><span class="tag">Fantasy</span><span class="tag">Adventure</span></span></div></div></div><div class="book-meta"><div class="meta-left"><span class="pub-year">Published: 1999</span></div><strong>★ 4.2 (123)</strong></div>`;
        frag.appendChild(c);
    }
    grid.appendChild(frag);
});
await page.waitForTimeout(800);
const state = () => page.evaluate(() => ({
    toggleChecked: document.getElementById('smoothScrollingToggle')?.checked ?? 'NO_EL',
    storage: (() => { try { return localStorage.getItem('ole_smooth_scrolling'); } catch { return 'ERR'; } })(),
    bodyClass: document.body.classList.contains('smooth-scroll-on'),
    engineActive: document.body.classList.contains('smooth-scrolling-active'),
    scrollTop: Math.round(document.querySelector('main.results').scrollTop),
}));
console.log('default state:', JSON.stringify(await state()));
const wheelTick = (dir = 1) => cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 800, y: 450, deltaX: 0, deltaY: dir * 120 });
// Phase 1: default ON — wheel must engage engine (class appears synchronously)
// and NOT scroll natively (preventDefault owns it; engine glides async).
await wheelTick(1);
const onSync = await state();
console.log('after wheel, sync read (default ON):', JSON.stringify(onSync));
check('toggle default ON engages engine on wheel', onSync.engineActive === true, JSON.stringify(onSync));
// Phase 2: toggle OFF via real click.
await page.evaluate(() => document.getElementById('smoothScrollingToggle').click());
await page.waitForTimeout(200);
console.log('after toggle OFF:', JSON.stringify(await state()));
await page.evaluate(() => { document.querySelector('main.results').scrollTop = 0; });
await page.waitForTimeout(200);
// OFF: engine must stay cold (deterministic, synchronous). Native scroll
// applies on the compositor, so its scrollTop is read after a beat.
await wheelTick(1);
const offSync = await state();
console.log('after wheel, sync read (toggled OFF):', JSON.stringify(offSync));
await page.waitForTimeout(200);
const offSettled = await state();
console.log('after wheel, settled read (toggled OFF):', JSON.stringify(offSettled));
check('toggle OFF leaves engine cold', offSync.engineActive === false, JSON.stringify(offSync));
check('toggle OFF scrolls natively', offSettled.scrollTop > 0 && offSettled.engineActive === false, JSON.stringify(offSettled));
// Phase 3: measured flurries OFF then ON (sampler concurrent with input).
async function flurryMeasured(label) {
    await page.evaluate(() => { document.querySelector('main.results').scrollTop = 0; });
    await page.waitForTimeout(300);
    const m0 = await metrics();
    const sampler = page.evaluate(() => new Promise((resolve) => {
        const d = [];
        let last = performance.now();
        const t0 = last;
        const tick = (now) => {
            d.push(now - last);
            last = now;
            if (now - t0 > 2400) { resolve(d); return; }
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }));
    for (let i = 0; i < 8; i++) {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 800, y: 450, deltaX: 0, deltaY: 240 });
        await page.waitForTimeout(120);
    }
    await page.waitForTimeout(1200);
    const deltas = await sampler;
    deltas.sort((a, b) => a - b);
    const q = (f) => +deltas[Math.min(deltas.length - 1, Math.floor(deltas.length * f))].toFixed(1);
    const m1 = await metrics();
    const dm = (k) => Math.round((m1[k] || 0) - (m0[k] || 0));
    console.log(`${label}: frames=${deltas.length} p50=${q(0.5)} p95=${q(0.95)} max=${+deltas[deltas.length - 1].toFixed(1)} over25=${deltas.filter((d) => d > 25).length} ΔLayout=${dm('LayoutCount')} ΔRecalcStyle=${dm('RecalcStyleCount')}`);
}
console.log('--- toggle currently OFF: measuring OFF ---');
await flurryMeasured('OFF');
await page.evaluate(() => document.getElementById('smoothScrollingToggle').click());
await page.waitForTimeout(200);
console.log('toggled back ON:', JSON.stringify(await state()));
console.log('--- measuring ON ---');
await flurryMeasured('ON ');
console.log(failures.length === 0 ? 'ALL CHECKS PASSED' : `${failures.length} CHECK(S) FAILED`);
await browser.close();
process.exit(failures.length === 0 ? 0 : 1);
