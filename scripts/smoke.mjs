// Smoke harness: evaluates the app's module graph in Node with permissive
// browser stubs. Purpose: catch STRICT-MODE / MISSING-IMPORT / TDZ errors
// (ReferenceError, SyntaxError) introduced while splitting script.js.
// Other TypeErrors are usually stub artifacts — recorded as warnings and
// diffed against baseline, not treated as failures.
//
// Usage: node scripts/smoke.mjs [entry]
// Exit 0 = no ReferenceError/SyntaxError. Nonzero = real breakage.
import { pathToFileURL } from 'node:url';

const entry = process.argv[2] || '../main.js';

// ---- Permissive fake element: any method call returns another fake,
// ---- any property set succeeds. `then` stays undefined so `await el`
// ---- never hangs on thenable assimilation.
const callable = new Proxy(function () {}, {
    get: (t, p) => {
        if (p === 'then') return undefined;
        if (p === Symbol.toPrimitive) return () => 0;
        if (p === 'valueOf') return () => 0;
        return callable;
    },
    set: () => true,
    apply: () => callable
});
function makeEl() {
    const classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
    const style = new Proxy({ setProperty() {} }, { get: (t, p) => (p in t ? t[p] : callable), set: () => true });
    const el = {
        classList, style, dataset: {}, children: [], value: '', textContent: '',
        clientWidth: 0, clientHeight: 0, offsetWidth: 0, offsetHeight: 0,
        scrollWidth: 0, scrollHeight: 0, scrollTop: 0, scrollLeft: 0,
        getBoundingClientRect: () => ({ width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 })
    };
    return new Proxy(el, {
        get: (t, p) => {
            if (p === 'then') return undefined;
            if (p in t) return t[p];
            return callable;
        },
        set: (t, p, v) => { t[p] = v; return true; }
    });
}

const store = new Map();
globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); }
};
globalThis.localforage = {
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
    clear: async () => {}
};
globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}), text: async () => '' });
globalThis.window = globalThis;
globalThis.dispatchEvent = () => false;
globalThis.scrollTo = () => {};
globalThis.open = () => null;
globalThis.innerWidth = 1280;
globalThis.innerHeight = 800;
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
globalThis.MutationObserver = class { constructor() {} observe() {} unobserve() {} disconnect() {} };
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true, hardwareConcurrency: 4, clipboard: { writeText: async () => {} } }, configurable: true });
globalThis.history = { replaceState() {}, pushState() {} };
globalThis.location = { hash: '', search: '', href: 'http://localhost/', pathname: '/' };

const bodyEl = makeEl();
globalThis.document = new Proxy({
    getElementById: () => makeEl(),
    querySelector: () => makeEl(),
    querySelectorAll: () => [],
    createElement: () => makeEl(),
    createDocumentFragment: () => makeEl(),
    addEventListener() {},
    body: bodyEl,
    documentElement: makeEl()
}, {
    get: (t, p) => (p in t ? t[p] : callable),
    set: () => true
});
if (!globalThis.addEventListener) globalThis.addEventListener = () => {};
if (!globalThis.removeEventListener) globalThis.removeEventListener = () => {};

const warnings = [];
const origErr = console.error, origWarn = console.warn;
console.error = (...a) => { warnings.push('ERR: ' + a.map(String).join(' ').slice(0, 160)); };
console.warn = (...a) => { warnings.push('WARN: ' + a.map(String).join(' ').slice(0, 160)); };

let failed = false;
try {
    await import(new URL(entry, import.meta.url).href);
    // Let boot's async chain (Promise.all + timeouts) settle.
    await new Promise((r) => setTimeout(r, 2500));
} catch (e) {
    if (e instanceof ReferenceError || e instanceof SyntaxError || e instanceof TypeError) {
        console.log = origErr; // restore for the fatal report
        origErr('SMOKE-FAIL:', e.constructor.name + ':', e.message);
        origErr((e.stack || '').split('\n').slice(0, 6).join('\n'));
        failed = true;
    } else {
        warnings.push('THROW: ' + e.constructor.name + ': ' + String(e.message).slice(0, 160));
    }
}
console.error = origErr; console.warn = origWarn;
const uniq = [...new Set(warnings)].slice(0, 25);
console.log(JSON.stringify({ entry, failed, warnings: uniq }, null, 1));
process.exit(failed ? 1 : 0);
