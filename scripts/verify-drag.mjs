// scripts/verify-drag.mjs — reproducible verification for the mobile-legacy
// sidebar drag optimization (see app-ui.js drag IIFE).
//
// Unlike CDP LayoutCount deltas (which count ALL background page work —
// cover hydration, translation swaps, the 500ms telemetry tick), this script
// spies on SYNCHRONOUS LAYOUT READS (getBoundingClientRect / offsetWidth /
// clientWidth / scrollWidth / ...) and attributes each one by stack frame to
// the exact app-ui.js source line. The only permitted read during a gesture
// is the single width capture at drag activation; renderDragFrame and
// endDrag must perform zero.
//
// Pin-continuity is asserted deterministically by stubbing requestAnimationFrame
// during the activating move, so the sampled inline transform is purely the
// synchronous first-frame pin with zero rAF influence.
//
// Asserts:
//  1. Plain taps: zero sync layout reads.
//  2. Pin values: left-open (-330/-14), left-close (0/+330), right-open
//     (+330/+14) — exact, no grab pop.
//  3. Slow open drag (80 steps): exactly the 1 allowed activation read,
//     zero elsewhere; snaps open with full cleanup.
//  4. Sub-threshold drag from collapsed: stays collapsed, cleaned up.
//  5. Slow close drag from the backdrop: same read budget; snaps closed.
//  6. Right-side (sidebar-right) open drag: same budget, mirrored math.
//  7. Reports (non-failing) any "[Violation] Forced reflow" console messages.
//
// Usage: node scripts/verify-drag.mjs [url]
// Exit 0 = all assertions pass. Exit 1 = failure with details printed.
// Network (API/images) is aborted so background work cannot pollute readings.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const url = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:5173/';
const failures = [];
const notes = [];
const check = (name, cond, detail = '') => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
    if (!cond) failures.push(name);
};

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const appUiSrc = readFileSync(path.join(repoRoot, 'app-ui.js'), 'utf8').split('\n');
// The single permitted sync-layout read: the width capture at drag activation.
const allowedLines = new Set();
appUiSrc.forEach((line, i) => {
    if (/aside\.offsetWidth/.test(line)) allowedLines.add(i + 1);
});
console.log(`allowed sync-read lines in app-ui.js: ${[...allowedLines].join(', ')}`);

// ── 0. Card entrance must be position-free ─────────────────────────────────
// Regression guard: the cardFadeIn keyframes must not translate (the old
// rise replayed on every mount — refresh, searches, tab switches — and read
// as content "jumping/floating up into their spots"), and Reduce Animations
// must silence the entrance entirely.
{
    const css = readFileSync(path.join(repoRoot, 'style.css'), 'utf8');
    const kf = css.match(/@keyframes\s+cardFadeIn\s*\{([\s\S]*?)\n\}/);
    const kfBody = kf ? kf[1] : '';
    check('cards: entrance has no positional motion', kfBody.length > 0 && !/translate|transform/.test(kfBody),
        kfBody ? kfBody.trim().split('\n').join(' ').slice(0, 90) : 'keyframes not found');
    check('cards: reduce-animations silences entrance',
        /body\.reduce-animations\s+\.book-card\s*\{[^}]*animation\s*:\s*none/.test(css));
    // "Find More Books" visibility must use the in-flight query page size
    // (lastFetchLimit: 50 with the custom limit off), never the slider
    // default of 100 — the mismatch hid the button on default searches.
    // Short-page detection must see the RAW api count (pre-dedup).
    const bf = readFileSync(path.join(repoRoot, 'book-features.js'), 'utf8');
    const au = readFileSync(path.join(repoRoot, 'app-ui.js'), 'utf8');
    check('loadmore: single page-size source of truth',
        /export let lastFetchLimit = 50/.test(bf)
        && /lastFetchLimit = parseInt\(currentLimit/.test(bf)
        && ((bf.match(/currentPage \* lastFetchLimit/g) || []).length >= 1)
        && ((au.match(/currentPage \* lastFetchLimit/g) || []).length >= 1)
        && !/fetchLimitSlider\.value : 100/.test(bf + au));
    check('loadmore: short-page sees raw api count',
        /renderResults\(rawDocs\.length/.test(bf));
    // Scroll-jank guards: no transitions fire on scroll toggles, wheel input
    // skips the measured walk for plain content scrolls, the sticky header
    // drops its blur mid-scroll, covers decode async, and OS reduced-motion
    // gets a one-time notice. Below-fold arrivals simply appear (no scroll
    // entrance animations — they proved visually noisy and layered churn);
    // the mount fade carries first paint.
    check('scroll: transitions silenced on scroll toggles',
        /body\.is-scrolling \.book-card,[\s\S]*?transition: none !important/.test(css)
        && /body\.smooth-scrolling-active \.book-card \{[^}]*transition: none !important/.test(css));
    check('scroll: wheel fast path present',
        /Fast path: a plain wheel over content/.test(au));
    // The non-passive interceptor forces every wheel tick through the main
    // thread, so it must only exist while the engine can engage; otherwise
    // wheel input stays fully native/off-thread.
    check('scroll: wheel interceptor gated on engine state',
        /export function syncWheelListener/.test(au)
        && ((readFileSync(path.join(repoRoot, 'main.js'), 'utf8').match(/syncWheelListener\(\)/g) || []).length >= 4));
    check('scroll: sticky header drops blur mid-scroll',
        /main\.results\.is-scrolling \.results-header\.desktop-sticky-active[\s\S]*?backdrop-filter: none !important/.test(css));
    check('scroll: covers decode async',
        ((au.match(/decoding="async"/g) || []).length >= 6));
    check('scroll: reduced-motion one-time notice',
        /ole_motion_notice_shown/.test(readFileSync(path.join(repoRoot, 'main.js'), 'utf8')));
    // Raster diagnostic flag (?plaincards=1 strips card/cover shadows).
    check('scroll: plain-cards diagnostic flag present',
        /plaincards/.test(au) && /body\.plain-cards \.book-card/.test(css));
    // Title swaps still coalesce past scroll activity (paced slices flushed
    // at rest); cover work loads immediately again by request.
    check('scroll: title coalescing present',
        /pendingGridWrites/.test(au) && /flushDeferredGridWrites/.test(au)
        && /pendingGridWrites\.splice\(0, 15\)/.test(au));
    // Notch-gap hold: is-scrolling removal is debounced (no per-notch style
    // toggle storms on notched wheels) with instant restore on pointerdown.
    check('scroll: notch-gap hold with pointer escape',
        /SCROLL_CLASS_IDLE_MS = 250/.test(au) && /clearScrollingState/.test(au));
    // Entrance fills must never hold forwards: a finished filling animation
    // keeps applying forever, pinning a permanent compositor layer per card
    // — with hundreds of cards every Layerize pass crawls. Backwards covers
    // the stagger delay, then releases everything.
    const cardAnim = (css.match(/animation:\s*cardFadeIn[^;]*;/) || [''])[0];
    const coverAnim = (css.match(/animation:\s*coverIn[^;]*;/) || [''])[0];
    check('cards: entrances release layers after finishing',
        /backwards/.test(cardAnim) && !/\bboth\b/.test(cardAnim)
        && /backwards/.test(coverAnim) && !/\bboth\b/.test(coverAnim),
        `card=[${cardAnim.trim()}] cover=[${coverAnim.trim()}]`);
    // Late-cover fade (coverIn): opacity-only entrance for covers assigned
    // after their card is on screen; build-time covers ride the card fade.
    const ci = css.match(/@keyframes\s+coverIn\s*\{([\s\S]*?)\n\}/);
    const ciBody = ci ? ci[1] : '';
    check('covers: late-cover fade is opacity-only', ciBody.length > 0
        && /opacity/.test(ciBody) && !/transform|width|height/.test(ciBody),
        ciBody ? ciBody.trim().split('\n').join(' ').slice(0, 80) : 'coverIn keyframes not found');
    check('covers: late-cover fade hookup present',
        /\.book-cover\.cover-fresh\s*\{/.test(css)
        && /cover-fresh/.test(readFileSync(path.join(repoRoot, 'storage-cache.js'), 'utf8'))
        && ((readFileSync(path.join(repoRoot, 'app-ui.js'), 'utf8').match(/cover-fresh/g) || []).length === 3));
}

const browser = await chromium.launch();
const context = await browser.newContext({
    viewport: { width: 393, height: 851 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
});
const page = await context.newPage();
const violations = [];
const pageErrors = [];
page.on('console', (m) => {
    if (m.text().includes('Violation')) violations.push(m.text().slice(0, 160));
});
page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 200)));

// Quiet boot: API/images cannot load background work.
await page.route('**/*', (route) => {
    const t = route.request().resourceType();
    if (['document', 'script', 'stylesheet', 'font'].includes(t)) route.continue();
    else route.abort();
});
await page.goto(url, { waitUntil: 'load', timeout: 45000 });
await page.waitForFunction(
    () => document.body.classList.contains('mobile-legacy-layout')
        && !!document.querySelector('.app-container'),
    null, { timeout: 30000 }
);
await page.waitForTimeout(2500); // let boot-time async work settle

// Install sync-layout-read spies + touch-delivery tracing (the latter proves
// the synthetic gesture actually reached the page in each phase).
await page.evaluate(() => {
    window.__reads = [];
    window.__tevts = [];
    const push = (kind) => {
        if (window.__reads.length > 3000) return;
        window.__reads.push({ kind, stack: new Error().stack || '' });
    };
    const g = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (...a) { push('getBoundingClientRect'); return g.apply(this, a); };
    const c = Element.prototype.getClientRects;
    Element.prototype.getClientRects = function (...a) { push('getClientRects'); return c.apply(this, a); };
    for (const prop of ['offsetWidth', 'offsetHeight', 'offsetTop', 'offsetLeft', 'clientWidth', 'clientHeight', 'scrollWidth', 'scrollHeight']) {
        const d = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop);
        if (d && typeof d.get === 'function') {
            const orig = d.get;
            Object.defineProperty(HTMLElement.prototype, prop, {
                get() { push(prop); return orig.call(this); },
                configurable: true,
            });
        }
    }
    for (const t of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
        document.addEventListener(t, (e) => {
            if (window.__tevts.length > 500) return;
            const p = e.touches && e.touches[0];
            let extra = '';
            if (t === 'touchstart' && e.target && e.target.closest) {
                // Mirrors the drag gesture's exclusion list in app-ui.js
                // (dragEligible) so a rejected touchstart explains itself.
                const EXCL = 'button, a, input, select, textarea, label, header, .results-header, .selection-bar, .rail-popover, .settings-dropdown, .details-drawer-overlay, input[type="range"], .tags-compact-badge, .tag-overflow, .tags-popup, .tags-popup-backdrop, .autocomplete-list, .ui-tags-wrap';
                const app = document.querySelector('.app-container');
                const open = app && !app.classList.contains('sidebar-collapsed');
                const bad = e.target.closest(open ? EXCL : `${EXCL}, .filters`);
                extra = ` target=${e.target.tagName}#${e.target.id} elig=${bad ? 'NO' : 'YES'}`;
            }
            window.__tevts.push(`${t}:${e.touches ? e.touches.length : '?'}` +
                (p ? `@${Math.round(p.clientX)},${Math.round(p.clientY)}` : '') + extra);
        }, { capture: true, passive: true });
    }
});

const cdp = await context.newCDPSession(page);
const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
const resetReads = () => page.evaluate(() => { window.__reads = []; window.__tevts = []; });
const getReads = () => page.evaluate(() => window.__reads.slice());
const getTevts = () => page.evaluate(() => window.__tevts.slice());
const tevSummary = (evts) => {
    const counts = {};
    const xs = [];
    for (const e of evts) {
        const k = e.split('@')[0].split(':')[0];
        counts[k] = (counts[k] || 0) + 1;
        const m = e.match(/@(-?[\d.]+),/);
        if (m) xs.push(Number(m[1]));
    }
    const span = xs.length ? ` x:[${Math.min(...xs)}..${Math.max(...xs)}]n=${xs.length}` : '';
    return `touch delivery [${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' ')}]${span}`;
};
const tevStarts = async () => (await getTevts()).filter((e) => e.startsWith('touchstart')).length;
const state = () => page.evaluate(() => ({
    collapsed: document.querySelector('.app-container').classList.contains('sidebar-collapsed'),
    asideT: document.querySelector('aside.filters').style.getPropertyValue('transform'),
    hintT: document.getElementById('mobileSidebarSwipeHint').style.getPropertyValue('transform'),
    hintVar: document.getElementById('mobileSidebarSwipeHint').style.getPropertyValue('--ear-open-offset'),
    backdrop: document.getElementById('mobileSidebarBackdrop').classList.contains('active'),
    title: document.getElementById('mobileSidebarSwipeHint').title,
}));
const setCollapsed = (collapsed) => page.evaluate((c) => {
    document.querySelector('.app-container').classList.toggle('sidebar-collapsed', c);
    document.getElementById('mobileSidebarBackdrop').classList.toggle('active', !c);
}, collapsed);
await setCollapsed(true);
const asideWidth = await page.evaluate(() => document.querySelector('aside.filters').offsetWidth);
console.log(`aside layout width: ${asideWidth}px`);
const classify = (reads) => {
    const allowed = []; const bad = []; let noise = 0; let unattrOW = 0; let srcSeen = false;
    const noiseLabels = [];
    for (const r of reads) {
        const m = r.stack.match(/app-ui\.js:(\d+):\d+/);
        if (!m) {
            noise++;
            if (r.kind === 'offsetWidth') unattrOW++;
            if (noiseLabels.length < 3) {
                const f = (r.stack.match(/at \S+ \((\S+:\d+:\d+)\)/) || [])[1] || r.kind;
                noiseLabels.push(`${r.kind}@${String(f).split('/').pop()}`);
            }
            continue;
        }
        srcSeen = true;
        const line = Number(m[1]);
        if ([...allowedLines].some((a) => Math.abs(a - line) <= 2)) allowed.push(`${r.kind}@${line}`);
        else bad.push(`${r.kind}@app-ui.js:${line}`);
    }
    return { allowed, bad, noise, unattrOW, srcSeen, noiseLabels };
};
// Read budget: in dev (source-mapped stacks) the activation read attributes
// to app-ui.js; in a minified bundle it is unattributed, so count
// unattributed offsetWidth reads toward the budget there. `bad` always fails.
const okBudget = (cls, min, max) => {
    if (cls.bad.length > 0) return false;
    const n = cls.srcSeen ? cls.allowed.length : cls.allowed.length + cls.unattrOW;
    return n >= min && n <= max;
};
const noiseStr = (cls) => cls.noiseLabels.join(' | ') || `noise=${cls.noise}`;
const stubRAF = () => page.evaluate(() => {
    window.__rafQ = [];
    window.__origRAF = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => { window.__rafQ.push(cb); return 1; };
});
const restoreRAF = () => page.evaluate(() => {
    window.requestAnimationFrame = window.__origRAF;
    window.__rafQ = [];
});
const slowDrag = async (x0, y, x1, steps = 80, probe = null) => {
    await touch('touchStart', [{ x: x0, y, id: 1 }]);
    let probeResult = null;
    for (let i = 1; i <= steps; i++) {
        const x = Math.round(x0 + ((x1 - x0) * i) / steps);
        await touch('touchMove', [{ x, y, id: 1 }]);
        if (probe && i === probe.after) probeResult = await page.evaluate(probe.fn);
        if (i % 4 === 0) await page.waitForTimeout(8);
    }
    await touch('touchEnd', []);
    await page.waitForTimeout(500); // snap transition + reveal settle
    return probeResult;
};
const midDragProbe = () => ({
    dragging: document.querySelector('aside.filters').classList.contains('dragging'),
    t: document.querySelector('aside.filters').style.getPropertyValue('transform'),
    target: (() => {
        const el = document.elementFromPoint(40, 500);
        return el ? `${el.tagName}#${el.id}.${String(el.className).slice(0, 40)}` : 'none';
    })(),
});
// Synthetic input through headless CDP intermittently loses whole gestures
// (moves never reach ANY page listener — proven by capture-phase tracing).
// Real fingers don't do this, so lost gestures are retried (reported via
// notes) instead of failing on environment flakes. Setup re-runs per attempt
// so partial attempts can't leak state into the retry.
const moveCount = async () => (await getTevts()).filter((e) => e.startsWith('touchmove')).length;
const runGesture = async (label, setupFn, x0, y, x1, steps, probe, minMoves) => {
    for (let a = 1; a <= 4; a++) {
        await setupFn();
        // Programmatic state flips run real CSS transitions (0.32s slide).
        // A touch landing mid-transition would legitimately hit the sliding
        // panel (correctly rejected as .filters) — settle first, like a user
        // would experience the settled UI.
        await page.waitForTimeout(400);
        await resetReads();
        const probeResult = await slowDrag(x0, y, x1, steps, probe);
        const evts = await getTevts();
        const reads = await getReads();
        const n = evts.filter((e) => e.startsWith('touchmove')).length;
        const starts = evts.filter((e) => e.startsWith('touchstart')).length;
        const engaged = reads.some((r) => r.stack.includes('app-ui.js') || r.kind === 'offsetWidth');
        if (n >= minMoves && starts >= 1 && engaged) {
            if (a > 1) notes.push(`${label}: input delivered after ${a} attempts`);
            runGesture.lastSummary = tevSummary(evts);
            return probeResult;
        }
        notes.push(`${label}: attempt ${a} lost (starts=${starts} moves=${n} engaged=${engaged}) ${tevSummary(evts)}, retrying`);
    }
    check(`${label}: gesture delivered`, false, 'synthetic input loss persisted after 4 attempts');
    return null;
};

// ── 1. Plain tap: zero reads ─────────────────────────────────────────────
await resetReads();
await touch('touchStart', [{ x: 200, y: 300, id: 1 }]);
await page.waitForTimeout(60);
await touch('touchEnd', []);
await page.waitForTimeout(300);
{
    const tapEvts = await getTevts();
    const cls0 = classify(await getReads());
    check('tap: touch delivered', tapEvts.some((e) => e.startsWith('touchstart')), tevSummary(tapEvts));
    check('tap: zero app-ui layout reads', okBudget(cls0, 0, 0),
        `allowed=[${cls0.allowed.join(',')}] unattrOW=${cls0.unattrOW} | ${noiseStr(cls0)}`);
}

// ── 2. Pin values (rAF stubbed → purely the synchronous first-frame pin) ──
const pinTest = async (name, setup, x0, x1, expAside, expEar) => {
    await stubRAF();
    let pins = null;
    let delivered = false;
    for (let a = 1; a <= 4 && !delivered; a++) {
        await setup();
        await page.waitForTimeout(400); // settle programmatic state flips (see runGesture)
        await resetReads();
        await touch('touchStart', [{ x: x0, y: 500, id: 1 }]);
        await touch('touchMove', [{ x: x1, y: 500, id: 1 }]);
        pins = await page.evaluate(() => ({
            aside: document.querySelector('aside.filters').style.getPropertyValue('transform'),
            hint: document.getElementById('mobileSidebarSwipeHint').style.getPropertyValue('transform'),
        }));
        delivered = (await moveCount()) >= 1;
        if (!delivered) {
            notes.push(`${name}: attempt ${a} lost, retrying`);
            await touch('touchEnd', []);
        }
    }
    if (!delivered) {
        await restoreRAF();
        check(`${name}: gesture delivered`, false, 'synthetic input loss persisted after 4 attempts');
        return null;
    }
    await touch('touchEnd', []);
    await restoreRAF();
    await page.waitForTimeout(500);
    const s = await state();
    check(`${name}: aside pinned`, pins.aside === expAside, `'${pins.aside}'`);
    check(`${name}: ear pinned`, pins.hint === expEar, `'${pins.hint}'`);
    check(`${name}: release settles (no inline leftovers)`, s.asideT === '' && s.hintT === '');
    return s;
};
await pinTest('left-open pin', () => setCollapsed(true), 40, 56,
    `translateX(${-asideWidth}px)`, 'translateY(-50%) translateX(-14px)');
{
    await setCollapsed(false);
    await pinTest('left-close pin', () => setCollapsed(false), 360, 344,
        'translateX(0px)', `translateY(-50%) translateX(${asideWidth}px)`);
}
{
    const s = await pinTest('right-open pin', async () => {
        await page.evaluate(() => document.body.classList.add('sidebar-right'));
        await setCollapsed(true);
        await page.waitForTimeout(200);
    }, 353, 337,
        `translateX(${asideWidth}px)`, 'translateY(-50%) translateX(14px)');
    await page.evaluate(() => document.body.classList.remove('sidebar-right'));
}

// ── 3. Slow open drag (left): read budget + snap + cleanup ───────────────
await runGesture('open-drag', () => setCollapsed(true), 40, 500, 40 + asideWidth, 80, null, 40);
{
    const s = await state();
    const cls = classify(await getReads());
    check('open-drag: read budget = exactly 1 activation read', okBudget(cls, 1, 1),
        `allowed=[${cls.allowed.join(',')}] unattrOW=${cls.unattrOW} srcSeen=${cls.srcSeen} | ${noiseStr(cls)} | ${runGesture.lastSummary}`);
    check('open-drag: zero unexpected reads', cls.bad.length === 0, cls.bad.slice(0, 5).join(' | '));
    check('open-drag: snapped open', s.collapsed === false, JSON.stringify(s.collapsed));
    check('open-drag: inline styles cleaned', s.asideT === '' && s.hintT === '', `aside='${s.asideT}' hint='${s.hintT}'`);
    check('open-drag: backdrop active + hint var set', s.backdrop === true && s.hintVar.trim() === `${asideWidth}px`,
        `backdrop=${s.backdrop} var='${s.hintVar}'`);
    check('open-drag: hint title updated', /close/i.test(s.title), `'${s.title}'`);
}

// ── 4. Sub-threshold drag from collapsed: stays collapsed ─────────────────
const shortProbe = await runGesture('short-drag', () => setCollapsed(true), 40, 500,
    40 + Math.round(asideWidth * 0.25), 20, { after: 8, fn: midDragProbe }, 10);
{
    const s = await state();
    const clsS = classify(await getReads());
    check('short-drag: engaged mid-gesture', !!shortProbe && shortProbe.dragging === true,
        JSON.stringify(shortProbe));
    check('short-drag: gesture was delivered', (await getTevts()).filter((e) => e.startsWith('touchmove')).length >= 8,
        tevSummary(await getTevts()));
    check('short-drag: stays collapsed', s.collapsed === true, JSON.stringify(s.collapsed));
    check('short-drag: inline styles cleaned', s.asideT === '' && s.hintT === '', `aside='${s.asideT}' hint='${s.hintT}'`);
    check('short-drag: read budget = exactly 1 activation read', okBudget(clsS, 1, 1),
        `allowed=[${clsS.allowed.join(',')}] unattrOW=${clsS.unattrOW} srcSeen=${clsS.srcSeen} | ${noiseStr(clsS)} | ${runGesture.lastSummary}`);
    check('short-drag: zero unexpected reads', clsS.bad.length === 0, clsS.bad.slice(0, 5).join(' | '));
}

// ── 4b. Medium open-drag (40% travel): snaps OPEN under the new 0.3
// threshold (the old 0.5 midpoint would have snapped it back shut) ─────────
await runGesture('medium-open', () => setCollapsed(true), 40, 500, 40 + Math.round(asideWidth * 0.4), 32, null, 16);
{
    const s = await state();
    const clsM = classify(await getReads());
    check('medium-open (40%): snaps open', s.collapsed === false, JSON.stringify(s.collapsed));
    check('medium-open: read budget = exactly 1 activation read', okBudget(clsM, 1, 1),
        `allowed=[${clsM.allowed.join(',')}] unattrOW=${clsM.unattrOW} srcSeen=${clsM.srcSeen} | ${noiseStr(clsM)} | ${runGesture.lastSummary}`);
    check('medium-open: zero unexpected reads', clsM.bad.length === 0, clsM.bad.slice(0, 5).join(' | '));
    check('medium-open: backdrop active', s.backdrop === true, JSON.stringify(s.backdrop));
}

// ── 4c. Nudge-and-stay-open: content must never flash ─────────────────────
// A tiny drag from open snaps back open; the panel started open so its
// content must stay visible throughout (no drag-hide at grab, no reveal
// fade at release). Sampled mid-window (+120ms, inside the 340ms reveal
// window) so a flash can't hide behind the settle wait. Bespoke flow with
// retry because the mid-window sample can't go through runGesture.
let nudgeMid = null; let nudgeState = null; let nudgeCls = null; let nudgeOk = false;
for (let a = 1; a <= 3 && !nudgeOk; a++) {
    await setCollapsed(false);
    await page.waitForTimeout(400);
    await resetReads();
    await touch('touchStart', [{ x: 200, y: 500, id: 1 }]);
    for (let i = 1; i <= 8; i++) {
        await touch('touchMove', [{ x: 200 - Math.round((20 * i) / 8), y: 500, id: 1 }]);
    }
    await touch('touchEnd', []);
    await page.waitForTimeout(120);
    nudgeMid = await page.evaluate(() => ({
        revealing: document.body.classList.contains('mobile-legacy-sidebar-revealing'),
        op: (() => {
            const el = document.querySelector('aside.filters > .sidebar-group');
            return el ? getComputedStyle(el).opacity : 'missing';
        })(),
    }));
    await page.waitForTimeout(450);
    nudgeCls = classify(await getReads());
    nudgeState = await state();
    nudgeOk = nudgeMid.revealing === false && nudgeMid.op === '1' && nudgeState.collapsed === false
        && okBudget(nudgeCls, 1, 1) && nudgeCls.bad.length === 0;
    if (!nudgeOk) notes.push(`nudge: attempt ${a} inconclusive, retrying`);
}
check('nudge: no reveal flash mid-window', nudgeMid && nudgeMid.revealing === false, JSON.stringify(nudgeMid));
check('nudge: content stayed visible mid-window', nudgeMid && nudgeMid.op === '1', JSON.stringify(nudgeMid));
check('nudge: stayed open with clean styles', nudgeState && nudgeState.collapsed === false && nudgeState.asideT === '' && nudgeState.hintT === '',
    JSON.stringify(nudgeState));
check('nudge: read budget ok', nudgeCls && okBudget(nudgeCls, 1, 1) && nudgeCls.bad.length === 0,
    nudgeCls ? `allowed=[${nudgeCls.allowed.join(',')}] unattrOW=${nudgeCls.unattrOW}` : 'no data');

// ── 4d. Partial close (40% travel from open): snaps CLOSED under the new ──
// 0.7 close threshold (the old 0.5 midpoint would have kept it open) ───────
await runGesture('partial-close', () => setCollapsed(false), 360, 500, 360 - Math.round(asideWidth * 0.4), 32, null, 16);
{
    const s = await state();
    const clsP = classify(await getReads());
    check('partial-close (60% open): snaps closed', s.collapsed === true, JSON.stringify(s.collapsed));
    check('partial-close: read budget = exactly 1 activation read', okBudget(clsP, 1, 1),
        `allowed=[${clsP.allowed.join(',')}] unattrOW=${clsP.unattrOW} srcSeen=${clsP.srcSeen} | ${noiseStr(clsP)} | ${runGesture.lastSummary}`);
    check('partial-close: zero unexpected reads', clsP.bad.length === 0, clsP.bad.slice(0, 5).join(' | '));
}

// ── 4e. Scroll-in-progress locks out swipe birth ───────────────────────────
// Baselines captured, then the list moves under the held finger: however
// horizontal the motion, no drag may birth (stays collapsed, zero reads).
// A spacer forces real scrollability so the test is content-independent
// (flex:0 0 auto is load-bearing: a bare div shrink-wraps to zero height
// inside the column-flex scrollers and scrolls nothing).
let lockALast = null; let lockAOk = false;
for (let a = 1; a <= 3 && !lockAOk; a++) {
    await setCollapsed(true);
    await page.waitForTimeout(400);
    const scrollableA = await page.evaluate(() => {
        if (!document.getElementById('locktest-spacer')) {
            const sp = document.createElement('div');
            sp.id = 'locktest-spacer';
            sp.style.cssText = 'height:3000px;min-height:3000px;flex:0 0 auto;width:1px;';
            document.querySelector('main.results').appendChild(sp);
        }
        document.querySelector('main.results').scrollTop = 0;
        const m = document.querySelector('main.results');
        return m.scrollHeight - m.clientHeight >= 200;
    });
    await resetReads();
    await touch('touchStart', [{ x: 40, y: 500, id: 1 }]);
    await touch('touchMove', [{ x: 44, y: 500, id: 1 }]);
    await page.evaluate(() => { document.querySelector('main.results').scrollTop = 200; });
    for (let i = 2; i <= 20; i++) {
        await touch('touchMove', [{ x: Math.round(40 + (200 * i) / 20), y: 500, id: 1 }]);
        if (i % 4 === 0) await page.waitForTimeout(8);
    }
    await touch('touchEnd', []);
    await page.waitForTimeout(500);
    const evtsA = await getTevts();
    lockALast = {
        moves: evtsA.filter((e) => e.startsWith('touchmove')).length,
        s: await state(),
        cls: classify(await getReads()),
    };
    lockAOk = scrollableA && lockALast.moves >= 10 && lockALast.s.collapsed === true
        && lockALast.s.asideT === '' && lockALast.s.hintT === ''
        && okBudget(lockALast.cls, 0, 0) && lockALast.cls.bad.length === 0;
    if (!lockAOk) notes.push(`scroll-lock-A: attempt ${a} inconclusive (scrollable=${scrollableA} moves=${lockALast.moves} collapsed=${lockALast.s.collapsed}), retrying`);
}
check('scroll-lock: gesture was delivered', lockALast && lockALast.moves >= 10, lockALast ? `moves=${lockALast.moves}` : 'no data');
check('scroll-lock: scrolling content blocks drag birth', lockALast && lockALast.s.collapsed === true && lockALast.s.asideT === '' && lockALast.s.hintT === '',
    lockALast ? JSON.stringify({ collapsed: lockALast.s.collapsed, asideT: lockALast.s.asideT }) : 'no data');
check('scroll-lock: zero reads (never activated)', lockALast && okBudget(lockALast.cls, 0, 0) && lockALast.cls.bad.length === 0,
    lockALast ? `allowed=[${lockALast.cls.allowed.join(',')}] unattrOW=${lockALast.cls.unattrOW} | ${noiseStr(lockALast.cls)}` : 'no data');

// ── 4f. Active drag pins both scrollers ────────────────────────────────────
// Mid-drag both lists are shoved (simulating diagonal drift); frames must
// restore grab-time offsets — nothing scrolls under the finger.
let lockBLast = null; let lockBOk = false;
for (let a = 1; a <= 3 && !lockBOk; a++) {
    // Start collapsed on content (x=40): when open, x=40 would be sidebar
    // territory (possibly an excluded control) instead of grabbable content.
    await setCollapsed(true);
    await page.waitForTimeout(400);
    const scrollableB = await page.evaluate(() => {
        let sp = document.getElementById('locktest-spacer');
        if (!sp) {
            sp = document.createElement('div');
            sp.id = 'locktest-spacer';
            sp.style.cssText = 'height:3000px;min-height:3000px;flex:0 0 auto;width:1px;';
            document.querySelector('main.results').appendChild(sp);
        }
        let sp2 = document.getElementById('locktest-spacer-aside');
        if (!sp2) {
            sp2 = document.createElement('div');
            sp2.id = 'locktest-spacer-aside';
            sp2.style.cssText = 'height:3000px;min-height:3000px;flex:0 0 auto;width:1px;';
            document.querySelector('aside.filters').appendChild(sp2);
        }
        document.querySelector('main.results').scrollTop = 0;
        document.querySelector('aside.filters').scrollTop = 0;
        const m = document.querySelector('main.results');
        const f = document.querySelector('aside.filters');
        return (m.scrollHeight - m.clientHeight >= 200) && (f.scrollHeight - f.clientHeight >= 200);
    });
    await resetReads();
    await touch('touchStart', [{ x: 40, y: 500, id: 1 }]);
    for (let i = 1; i <= 10; i++) {
        await touch('touchMove', [{ x: Math.round(40 + (330 * i) / 40), y: 500, id: 1 }]);
        if (i % 4 === 0) await page.waitForTimeout(8);
    }
    await page.evaluate(() => {
        document.querySelector('main.results').scrollTop = 200;
        document.querySelector('aside.filters').scrollTop = 200;
    });
    for (let i = 11; i <= 40; i++) {
        await touch('touchMove', [{ x: Math.round(40 + (330 * i) / 40), y: 500, id: 1 }]);
        if (i % 4 === 0) await page.waitForTimeout(8);
    }
    await touch('touchEnd', []);
    await page.waitForTimeout(500);
    const evtsB = await getTevts();
    lockBLast = {
        moves: evtsB.filter((e) => e.startsWith('touchmove')).length,
        tops: await page.evaluate(() => ({
            main: document.querySelector('main.results').scrollTop,
            aside: document.querySelector('aside.filters').scrollTop,
        })),
        s: await state(),
        cls: classify(await getReads()),
    };
    lockBOk = scrollableB && lockBLast.moves >= 20 && lockBLast.tops.main === 0 && lockBLast.tops.aside === 0
        && lockBLast.s.collapsed === false && okBudget(lockBLast.cls, 1, 1) && lockBLast.cls.bad.length === 0;
    if (!lockBOk) notes.push(`scroll-lock-B: attempt ${a} inconclusive (scrollable=${scrollableB} moves=${lockBLast.moves} tops=${JSON.stringify(lockBLast.tops)}), retrying`);
}
check('scroll-lock: gesture was delivered', lockBLast && lockBLast.moves >= 20, lockBLast ? `moves=${lockBLast.moves}` : 'no data');
check('scroll-lock: drag pins both scrollers', lockBLast && lockBLast.tops.main === 0 && lockBLast.tops.aside === 0,
    lockBLast ? JSON.stringify(lockBLast.tops) : 'no data');
check('scroll-lock: drag still snaps open cleanly', lockBLast && lockBLast.s.collapsed === false && lockBLast.s.asideT === '' && lockBLast.s.hintT === '',
    lockBLast ? JSON.stringify({ collapsed: lockBLast.s.collapsed }) : 'no data');
check('scroll-lock: read budget ok', lockBLast && okBudget(lockBLast.cls, 1, 1) && lockBLast.cls.bad.length === 0,
    lockBLast ? `allowed=[${lockBLast.cls.allowed.join(',')}] unattrOW=${lockBLast.cls.unattrOW}` : 'no data');
await page.evaluate(() => {
    document.getElementById('locktest-spacer')?.remove();
    document.getElementById('locktest-spacer-aside')?.remove();
    document.querySelector('main.results').scrollTop = 0;
});

// ── 5. Slow close drag from the backdrop (x > sidebar width) ─────────────
await runGesture('close-drag', () => setCollapsed(false), 360, 500, 40, 80, null, 40);
{
    const s = await state();
    const clsC = classify(await getReads());
    check('close-drag: read budget = exactly 1 activation read', okBudget(clsC, 1, 1),
        `allowed=[${clsC.allowed.join(',')}] unattrOW=${clsC.unattrOW} srcSeen=${clsC.srcSeen} | ${noiseStr(clsC)} | ${runGesture.lastSummary}`);
    check('close-drag: zero unexpected reads', clsC.bad.length === 0, clsC.bad.slice(0, 5).join(' | '));
    check('close-drag: snapped closed', s.collapsed === true, JSON.stringify(s.collapsed));
    check('close-drag: inline styles cleaned', s.asideT === '' && s.hintT === '', `aside='${s.asideT}' hint='${s.hintT}'`);
    check('close-drag: backdrop released', s.backdrop === false, JSON.stringify(s.backdrop));
}

// ── 6. Right-side open drag (mirrored): budget + snap ─────────────────────
await runGesture('right-drag', async () => {
    await page.evaluate(() => document.body.classList.add('sidebar-right'));
    await setCollapsed(true);
    await page.waitForTimeout(200);
}, 353, 500, 353 - asideWidth, 80, null, 40);
{
    const s = await state();
    const clsR = classify(await getReads());
    check('right-drag: read budget = exactly 1 activation read', okBudget(clsR, 1, 1),
        `allowed=[${clsR.allowed.join(',')}] unattrOW=${clsR.unattrOW} srcSeen=${clsR.srcSeen} | ${noiseStr(clsR)} | ${runGesture.lastSummary}`);
    check('right-drag: zero unexpected reads', clsR.bad.length === 0, clsR.bad.slice(0, 5).join(' | '));
    check('right-drag: snapped open', s.collapsed === false, JSON.stringify(s.collapsed));
    check('right-drag: inline styles cleaned', s.asideT === '' && s.hintT === '', `aside='${s.asideT}' hint='${s.hintT}'`);
}
await page.evaluate(() => document.body.classList.remove('sidebar-right'));

// ── 7. Sidebar-origin close from a summary + phantom-click suppressor ─────
// The swipe starts ON the open panel (a section header), travels 150px
// (progress ~0.55: closes under 0.7, would have stayed open under old 0.5).
// The release click is then synthesized immediately — inside the 350ms
// suppression window it must be swallowed; after expiry clicks work again.
let sideDone = false;
for (let a = 1; a <= 3 && !sideDone; a++) {
    await setCollapsed(false);
    await page.waitForTimeout(400);
    const wasOpen = await page.evaluate(() => document.getElementById('filterGroup').open);
    const pt = await page.evaluate(() => {
        const el = document.querySelector('#filterGroup > summary');
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    });
    await resetReads();
    await touch('touchStart', [{ x: pt.x, y: pt.y, id: 1 }]);
    for (let i = 1; i <= 24; i++) {
        await touch('touchMove', [{ x: pt.x - Math.round((150 * i) / 24), y: pt.y, id: 1 }]);
        if (i % 4 === 0) await page.waitForTimeout(8);
    }
    await touch('touchEnd', []);
    // Inside the suppression window: must be swallowed (details unchanged).
    const open1 = await page.evaluate(() => {
        const d = document.getElementById('filterGroup');
        d.querySelector('summary').click();
        return d.open;
    });
    await page.waitForTimeout(500);
    const clsD = classify(await getReads());
    const sD = await state();
    if (open1 === wasOpen && sD.collapsed === true && okBudget(clsD, 1, 1) && clsD.bad.length === 0) {
        sideDone = true;
        check('sidebar-close: snapped closed from panel swipe', true);
        check('sidebar-close: phantom click suppressed', true);
        check('sidebar-close: read budget ok', true);
        // Window expired: clicks toggle again; restore the section state.
        await page.waitForTimeout(450);
        const open2 = await page.evaluate(() => {
            const d = document.getElementById('filterGroup');
            d.querySelector('summary').click();
            return d.open;
        });
        check('sidebar-origin: clicks work after window', open2 === !wasOpen, `open=${open2} wasOpen=${wasOpen}`);
        await page.evaluate((w) => {
            const d = document.getElementById('filterGroup');
            if (d.open !== w) d.querySelector('summary').click();
        }, wasOpen);
    } else {
        notes.push(`sidebar-close: attempt ${a} inconclusive (open1=${open1} wasOpen=${wasOpen} collapsed=${sD.collapsed}), retrying`);
    }
}
if (!sideDone) {
    check('sidebar-close: snapped closed from panel swipe', false, 'see notes');
    check('sidebar-close: phantom click suppressed', false, 'see notes');
    check('sidebar-close: read budget ok', false, 'see notes');
}

// ── 8. (Scroll-reveal sections removed with the feature: below-fold cards
// simply appear; mount fade carries first paint. See fill guards above for
// the layer-release contract that remains.)

// ── 9. Late-cover fade runtime: class → animation wiring ───────────────────
// Offline-safe (1px data-URL gif): a cover given .cover-fresh on paint must
// run coverIn; a plain cover must not animate at all.
{
    const cover = await page.evaluate(() => new Promise((resolve) => {
        const results = {};
        const plain = document.createElement('img');
        plain.className = 'book-cover';
        plain.style.cssText = 'position:fixed;left:-9999px;width:90px;height:130px;';
        document.body.appendChild(plain);
        results.plainAnim = getComputedStyle(plain).animationName;
        const fresh = document.createElement('img');
        fresh.className = 'book-cover';
        fresh.style.cssText = 'position:fixed;left:-9999px;width:90px;height:130px;';
        fresh.onload = () => {
            fresh.classList.add('cover-fresh'); // mirrors loadOneCover hook
            results.freshAnim = getComputedStyle(fresh).animationName;
            plain.remove();
            fresh.remove();
            resolve(results);
        };
        fresh.onerror = () => {
            results.freshAnim = 'LOAD_ERROR';
            plain.remove();
            fresh.remove();
            resolve(results);
        };
        document.body.appendChild(fresh);
        fresh.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///////yH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
        setTimeout(() => resolve({ ...results, timeout: true }), 5000);
    }));
    check('covers: fresh cover runs coverIn', cover.freshAnim === 'coverIn', JSON.stringify(cover));
    check('covers: plain cover has no entrance', cover.plainAnim === 'none' || cover.plainAnim === '',
        JSON.stringify(cover));
}

// ── 10. Scroll-idle signal: present mid-scroll, cleared at rest ────────────
// Every parking gate depends on this class; verify the signal itself with a
// self-contained tall spacer (no network, no content dependence).
{
    await page.evaluate(() => {
        let sp = document.getElementById('sig-spacer');
        if (!sp) {
            sp = document.createElement('div');
            sp.id = 'sig-spacer';
            sp.style.cssText = 'height:4000px;min-height:4000px;flex:0 0 auto;width:1px;';
            document.querySelector('main.results').appendChild(sp);
        }
    });
    await page.evaluate(async () => {
        const main = document.querySelector('main.results');
        const t0 = performance.now();
        await new Promise((resolve) => {
            const tick = () => {
                if (performance.now() - t0 > 400) { resolve(); return; }
                main.scrollTop += 60;
                requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
        });
    });
    const mid = await page.evaluate(() => document.body.classList.contains('is-scrolling'));
    check('scroll: is-scrolling present mid-scroll', mid === true);
    await page.waitForTimeout(600);
    const rest = await page.evaluate(() => document.body.classList.contains('is-scrolling'));
    check('scroll: is-scrolling cleared at rest', rest === false);
    // Notch-gap hold: the class must survive short idle gaps (no per-notch
    // toggle storms), but a real pointer-down restores instantly.
    await page.evaluate(async () => {
        const main = document.querySelector('main.results');
        main.scrollTop += 120;
    });
    await page.waitForTimeout(120);
    const held = await page.evaluate(() => document.body.classList.contains('is-scrolling'));
    await page.mouse.move(200, 400);
    await page.mouse.down();
    await page.mouse.up();
    const escaped = await page.evaluate(() => document.body.classList.contains('is-scrolling'));
    check('scroll: class held across notch gaps', held === true);
    check('scroll: pointerdown restores instantly', escaped === false);
    await page.evaluate(() => { document.getElementById('sig-spacer')?.remove(); });
}

// ── Report violations (informational) ─────────────────────────────────────
console.log(`forced-reflow violation messages: ${violations.length}`);
violations.slice(0, 5).forEach((v) => console.log(`  [violation] ${v}`));
check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

if (notes.length > 0) {
    console.log(`---NOTES (${notes.length})---`);
    notes.forEach((n) => console.log(`  ${n}`));
}
await browser.close();
console.log(failures.length === 0 ? 'ALL CHECKS PASSED' : `${failures.length} CHECK(S) FAILED`);
process.exit(failures.length === 0 ? 0 : 1);
