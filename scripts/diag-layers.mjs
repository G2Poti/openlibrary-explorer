// scripts/diag-layers.mjs — ONE-OFF: which feature churns the compositor
// layer tree during a fling? Counts layerTreeDidChange events per config:
// current / no-reveal-anim / no-content-visibility / neither.
// Deleted after use. Usage: node scripts/diag-layers.mjs [url]
import { chromium } from 'playwright';
const url = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:5173/';
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await context.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', String(e.message).slice(0, 160)));
await page.goto(url, { waitUntil: 'load', timeout: 45000 });
await page.waitForTimeout(2500);
const cdp = await page.context().newCDPSession(page);
try {
    await cdp.send('LayerTree.enable');
} catch (e) {
    console.log('LayerTree domain unavailable:', String(e).slice(0, 120));
}
async function measure(label, cssOverride) {
    await page.evaluate((css) => {
        let el = document.getElementById('ab-override');
        if (!el) {
            el = document.createElement('style');
            el.id = 'ab-override';
            document.head.appendChild(el);
        }
        el.textContent = css;
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
    }, cssOverride);
    await page.waitForTimeout(800);
    let changes = 0;
    const onChange = () => { changes++; };
    cdp.on('layerTreeDidChange', onChange);
    await page.evaluate(async () => {
        const main = document.querySelector('main.results');
        const t0 = performance.now();
        await new Promise((resolve) => {
            const tick = () => {
                if (performance.now() - t0 > 2000) { resolve(); return; }
                main.scrollTop = ((performance.now() - t0) / 2000) * (main.scrollHeight - main.clientHeight);
                requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
        });
    });
    await page.waitForTimeout(300);
    cdp.off('layerTreeDidChange', onChange);
    console.log(`${label}: layerTreeDidChange events during 2s fling = ${changes}`);
}
await measure('A: current (c-v on, reveal on)      ', '');
await measure('B: c-v off, reveal on               ', '.book-card{content-visibility:visible !important}');
await measure('C: c-v on, reveal off               ', '.book-card.rv-in{animation:none !important}');
await measure('D: c-v off, reveal off              ', '.book-card{content-visibility:visible !important} .book-card.rv-in{animation:none !important}');
await browser.close();
