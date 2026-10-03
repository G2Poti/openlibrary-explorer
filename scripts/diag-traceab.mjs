// scripts/diag-traceab.mjs — ONE-OFF: A/B isolate Layerize drivers during a
// fling: content-visibility vs reveal animations. CDP tracing (blink only).
// Deleted after use. Usage: node scripts/diag-traceab.mjs [url]
import { chromium } from 'playwright';
const url = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:5173/';

const CARDS = 150;
async function measure(page, cdp, label, cssOverride) {
    await page.evaluate((css) => {
        let el = document.getElementById('ab-override');
        if (!el) {
            el = document.createElement('style');
            el.id = 'ab-override';
            document.head.appendChild(el);
        }
        el.textContent = css;
    }, cssOverride);
    // (re)build cards + observe
    await page.evaluate(() => {
        const grid = document.getElementById('bookGrid');
        grid.style.display = 'grid';
        const dash = document.getElementById('discoverDashboard');
        if (dash) dash.style.display = 'none';
        grid.innerHTML = '';
        const frag = document.createDocumentFragment();
        for (let i = 0; i < 150; i++) {
            const c = document.createElement('div');
            c.className = 'book-card rv';
            c.dataset.testid = 'ab-probe';
            c.style.cssText = 'height:220px;flex:0 0 auto;';
            c.innerHTML = `<div class="card-main"><div class="cover-container"></div><div class="card-details"><div class="book-title">AB Probe ${i} With A Fairly Long Title Here</div><div class="book-author">by <span>Author ${i % 13}</span></div><div class="tags-list grid-tags"><span class="tag-row"><span class="tag">Fantasy</span><span class="tag">Adventure</span></span></div></div></div><div class="book-meta"><div class="meta-left"><span class="pub-year">Published: 1999</span></div><strong>★ 4.2 (123)</strong></div>`;
            frag.appendChild(c);
        }
        grid.appendChild(frag);
        document.querySelector('main.results').scrollTop = 0;
        window.__oleObserveReveal(document.getElementById('bookGrid'));
    });
    await page.waitForTimeout(800); // settle: above-fold instant path done
    const events = [];
    const onData = (e) => { if (e.value) events.push(...e.value); };
    cdp.on('Tracing.dataCollected', onData);
    await cdp.send('Tracing.start', { traceConfig: { includedCategories: ['blink'] }, transferMode: 'ReportEvents' });
    // fling: full descent in ~1.8s
    await page.evaluate(async () => {
        const main = document.querySelector('main.results');
        const t0 = performance.now();
        await new Promise((resolve) => {
            const tick = () => {
                if (performance.now() - t0 > 1800) { resolve(); return; }
                main.scrollTop = ((performance.now() - t0) / 1800) * (main.scrollHeight - main.clientHeight);
                requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
        });
    });
    await page.waitForTimeout(400);
    await cdp.send('Tracing.end');
    await page.waitForTimeout(500);
    cdp.off('Tracing.dataCollected', onData);
    const sum = {};
    const cnt = {};
    for (const e of events) {
        if (e.ph !== 'X' || !e.name) continue;
        const d = e.dur || 0;
        sum[e.name] = (sum[e.name] || 0) + d;
        cnt[e.name] = (cnt[e.name] || 0) + 1;
    }
    const pick = (...names) => {
        const o = {};
        for (const n of names) o[n] = { ms: Math.round((sum[n] || 0) / 1000), n: cnt[n] || 0 };
        return o;
    };
    console.log(`--- ${label} ---`);
    console.log(JSON.stringify(pick('Layerize', 'PrePaint', 'Paint', 'UpdateLayoutTree', 'Layout', 'RecalculateStyles', 'Commit', 'HitTest', 'RasterTask', 'DecodeImage'), null, 1));
    await page.evaluate(() => { document.getElementById('ab-override').textContent = ''; });
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await context.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', String(e.message).slice(0, 160)));
await page.goto(url, { waitUntil: 'load', timeout: 45000 });
await page.waitForTimeout(2500);
const cdp = await page.context().newCDPSession(page);
await measure(page, cdp, 'A: current (c-v on, reveal on)', '');
await measure(page, cdp, 'B: c-v off, reveal on', '.book-card{content-visibility:visible !important}');
await measure(page, cdp, 'C: c-v on, reveal off', '.book-card.rv-in{animation:none !important}');
await measure(page, cdp, 'D: c-v off, reveal off', '.book-card{content-visibility:visible !important} .book-card.rv-in{animation:none !important}');
await browser.close();
