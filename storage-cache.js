// storage-cache.js — persistence + in-RAM caches (safeStorage, translation,
// library membership, cover/synopsis caches). Hub-owned tuning lets are
// imported read-only; all such uses are deferred (inside function bodies),
// so the interim hub↔storage cycle is evaluation-safe.
import localforage from 'localforage';
import { escapeHTML } from './utils.js';

let activeStorageProxyUrl = '';
export const setStorageProxyUrl = (url) => { activeStorageProxyUrl = url || ''; };

// Telemetry sink (dependency injection): apiTelemetry lives in network-engine,
// which reads safeStorage at evaluation time — so storage-cache must NOT
// import network-engine (that edge would pull network in before safeStorage
// exists). The hub injects the hub via setTelemetryHub() at startup instead.
let telemetryHub = null;
export const setTelemetryHub = (hub) => { telemetryHub = hub; };

export const TRENDING_KEY = 'ole_trending_cache_v4';
export const TRENDING_LS_KEY = 'ole_trending_cache_v4_lsmirror';
export const TRENDING_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days
export const safeStorage = (() => {
    const mem = new Map();
    let available = false;
    try {
        const k = '__ole_probe__';
        localStorage.setItem(k, k);
        localStorage.removeItem(k);
        available = true;
    } catch (e) {
        available = false;
    }
    return {
        getItem(k) {
            if (mem.has(k)) return mem.get(k);
            try {
                if (available) {
                    const val = localStorage.getItem(k);
                    if (val !== null) return val;
                }
            } catch { }
            return null;
        },
        setItem(k, v) {
            const valStr = String(v);
            let written = false;
            try {
                if (available) {
                    localStorage.setItem(k, valStr);
                    mem.delete(k);
                    written = true;
                }
            } catch {
                available = false;
            }
            if (!written) {
                mem.set(k, valStr);
            }
        },
        removeItem(k) {
            mem.delete(k);
            try { if (available) localStorage.removeItem(k); } catch { }
        }
    };
})();
// Global Translation Cache to prevent duplicate and rapid CDNs IP-blocking API requests
// Stores pure strings (translated title) for 100% backward compatibility
export const translationCache = new Map();
// Parallel Cover Cache stores localized cover metadata ({ cover_i, edition_key })
export const translationCoverCache = new Map();
export let translationGenerationToken = 0;

// Tiered Cache Quota Configuration
const MAX_SEARCH_CACHE = 2000;
const MAX_LIBRARY_CACHE = 8000;
const MAX_TOTAL_CACHE = MAX_SEARCH_CACHE + MAX_LIBRARY_CACHE; // 10,000 max entries (~1.2 MB RAM)

// Fast O(1) Library Key Set for instant membership checks
let getLibrarySource = null;
export const setLibrarySource = (fn) => { getLibrarySource = fn; };
export let libraryKeySet = new Set();
export const syncLibraryKeySet = (lib) => {
    const list = Array.isArray(lib) ? lib : (typeof getLibrarySource === 'function' ? getLibrarySource() : []);
    libraryKeySet = new Set(list.map(b => b && b.key).filter(Boolean));
};
export const isLibraryWork = (workKey) => {
    if (!workKey) return false;
    return libraryKeySet.has(workKey);
};

// Session cache for work-key -> synopsis, so re-opening the details drawer
// doesn't re-fetch the work JSON just to show the description again.
export const descriptionCache = new Map();
export const translationReverseIndex = new Map();
export const rebuildTranslationReverseIndex = () => {
    translationReverseIndex.clear();
    for (const [cacheKey, translatedTitle] of translationCache.entries()) {
        if (typeof translatedTitle !== 'string') continue;
        const lastUnderscore = cacheKey.lastIndexOf('_');
        if (lastUnderscore === -1) continue;
        const workKey = cacheKey.substring(0, lastUnderscore);
        const lang = cacheKey.substring(lastUnderscore + 1);

        if (!translationReverseIndex.has(lang)) {
            translationReverseIndex.set(lang, new Map());
        }
        translationReverseIndex.get(lang).set(translatedTitle.trim().toLowerCase(), workKey);
    }
};
export const setTranslationCache = (cacheKey, title, coverId = null, editionKey = null) => {
    if (typeof title !== 'string') return;
    // LRU Refresh: delete and set moves entry to the tail (newest)
    if (translationCache.has(cacheKey)) translationCache.delete(cacheKey);
    translationCache.set(cacheKey, title);

    const validCoverId = coverId && parseInt(coverId) > 0 ? parseInt(coverId) : null;
    if (validCoverId) {
        if (translationCoverCache.has(cacheKey)) translationCoverCache.delete(cacheKey);
        translationCoverCache.set(cacheKey, { cover_i: validCoverId });
    } else {
        // If there is no positive localized cover ID, do not store an empty/bogus cover entry
        translationCoverCache.delete(cacheKey);
    }

    const lastUnderscore = cacheKey.lastIndexOf('_');
    if (lastUnderscore !== -1) {
        const workKey = cacheKey.substring(0, lastUnderscore);
        const lang = cacheKey.substring(lastUnderscore + 1);
        if (!translationReverseIndex.has(lang)) {
            translationReverseIndex.set(lang, new Map());
        }
        translationReverseIndex.get(lang).set(title.trim().toLowerCase(), workKey);
    }
};
export const deleteTranslationCache = (cacheKey) => {
    if (translationCache.has(cacheKey)) {
        const title = translationCache.get(cacheKey);
        translationCache.delete(cacheKey);
        translationCoverCache.delete(cacheKey);
        const lastUnderscore = cacheKey.lastIndexOf('_');
        if (lastUnderscore !== -1) {
            const lang = cacheKey.substring(lastUnderscore + 1);
            const langIndex = translationReverseIndex.get(lang);
            if (langIndex && typeof title === 'string') {
                langIndex.delete(title.trim().toLowerCase());
            }
        }
    }
};

// Two-Pass True LRU Pruner: Counts quotas, then evicts OLDEST entries (head of Map) first
export const pruneTranslationCacheIfLarge = () => {
    if (translationCache.size <= MAX_TOTAL_CACHE) return;

    let searchTotal = 0;
    let libTotal = 0;
    for (const [cacheKey] of translationCache.entries()) {
        const lastUnderscore = cacheKey.lastIndexOf('_');
        if (lastUnderscore === -1) continue;
        const workKey = cacheKey.substring(0, lastUnderscore);
        if (isLibraryWork(workKey)) libTotal++;
        else searchTotal++;
    }

    let searchToPrune = Math.max(0, searchTotal - MAX_SEARCH_CACHE);
    let libToPrune = Math.max(0, libTotal - MAX_LIBRARY_CACHE);

    if (searchToPrune === 0 && libToPrune === 0) return;

    const keysToDelete = [];
    // Map iterates in insertion order (oldest first). We collect from head until quotas are satisfied.
    for (const [cacheKey] of translationCache.entries()) {
        const lastUnderscore = cacheKey.lastIndexOf('_');
        if (lastUnderscore === -1) continue;
        const workKey = cacheKey.substring(0, lastUnderscore);

        if (isLibraryWork(workKey)) {
            if (libToPrune > 0) {
                keysToDelete.push(cacheKey);
                libToPrune--;
            }
        } else {
            if (searchToPrune > 0) {
                keysToDelete.push(cacheKey);
                searchToPrune--;
            }
        }
        if (searchToPrune === 0 && libToPrune === 0) break;
    }

    for (const key of keysToDelete) {
        deleteTranslationCache(key);
    }
};

// Promise-based cache for in-flight requests to avoid duplicate fetches
export const translationPromiseCache = new Map();
export class TranslationQueue {
    constructor() {
        this.queue = [];
        this.queuedKeys = new Set();
        this.activeCount = 0;
    }
    get maxConcurrent() {
        // Scale dynamically: feed enough concurrent tasks to saturate the network scheduler.
        const maxConn = parseInt(safeStorage.getItem('ole_sched_max_conn') || '3');
        return Math.max(4, maxConn * 2);
    }
    add(cacheKey, taskFn) {
        // Prevent duplicate queuing with O(1) Set check
        if (this.queuedKeys.has(cacheKey)) return;
        this.queuedKeys.add(cacheKey);
        this.queue.push({ cacheKey, taskFn });
        this.process();
    }
    clear() {
        this.queue = [];
        this.queuedKeys.clear();
    }
    process() {
        // Drain loop: Fill all available worker slots concurrently
        while (this.activeCount < this.maxConcurrent && this.queue.length > 0) {
            const { cacheKey, taskFn } = this.queue.shift();
            this.queuedKeys.delete(cacheKey);
            this.activeCount++;
            
            // Fire and forget the async task so the while-loop continues instantly
            (async () => {
                try {
                    await taskFn();
                } catch (e) {
                    console.error('Translation task failed:', e);
                } finally {
                    this.activeCount--;
                    // Immediately check for the next task
                    this.process();
                }
            })();
        }
    }
}
export const translationQueue = new TranslationQueue();
export const loadTranslationCache = async () => {
    try {
        let cachedTitles = await localforage.getItem('ole_translation_cache_v10');
        if (!cachedTitles) {
            // Safe migration from v9: only migrate non-empty strings
            const v9Titles = await localforage.getItem('ole_translation_cache_v9');
            if (v9Titles && typeof v9Titles === 'object') {
                cachedTitles = {};
                for (const [k, v] of Object.entries(v9Titles)) {
                    if (typeof v === 'string' && v.trim().length > 0) cachedTitles[k] = v;
                }
            }
        }
        if (cachedTitles) {
            for (const [k, v] of Object.entries(cachedTitles)) {
                if (typeof v === 'string') translationCache.set(k, v);
            }
            rebuildTranslationReverseIndex();
        }
        const cachedCovers = await localforage.getItem('ole_translation_cover_cache_v3')
            || await localforage.getItem('ole_translation_cover_cache_v2');
        if (cachedCovers) {
            for (const [k, v] of Object.entries(cachedCovers)) {
                if (v && typeof v === 'object' && v.cover_i && parseInt(v.cover_i) > 0) {
                    translationCoverCache.set(k, { cover_i: parseInt(v.cover_i) });
                }
            }
        }
        // Clean up legacy cache versions
        localforage.removeItem('ole_translation_cache_v9').catch(() => { });
        localforage.removeItem('ole_translation_cache_v8').catch(() => { });
        localforage.removeItem('ole_translation_cover_cache_v2').catch(() => { });
        localforage.removeItem('ole_translation_cover_cache_v1').catch(() => { });
    } catch (e) {
        console.error('Failed to load translation cache:', e);
    }
};
export let saveTranslationCacheTimer = null;
export const saveTranslationCache = (immediate = false) => {
    if (saveTranslationCacheTimer) clearTimeout(saveTranslationCacheTimer);
    const doSave = async () => {
        try {
            pruneTranslationCacheIfLarge();
            const titlesObj = {};
            for (const [k, v] of translationCache.entries()) {
                if (typeof v === 'string') titlesObj[k] = v;
            }
            const coversObj = {};
            for (const [k, v] of translationCoverCache.entries()) {
                if (v && typeof v === 'object' && v.cover_i && parseInt(v.cover_i) > 0) {
                    coversObj[k] = { cover_i: parseInt(v.cover_i) };
                }
            }
            await localforage.setItem('ole_translation_cache_v10', titlesObj);
            await localforage.setItem('ole_translation_cover_cache_v3', coversObj);
        } catch (e) {
            console.error('Failed to save translation cache:', e);
        }
    };
    if (immediate) {
        return doSave();
    }
    saveTranslationCacheTimer = setTimeout(doSave, 500);
};
// Hub entry point for Developer Cache Clear: ESM forbids reassigning an
// imported let, so the hub invalidates the generation through this setter.
export const bumpTranslationGeneration = () => { translationGenerationToken++; };
// ---- Cover image caching ----
// The metadata caches below (trending/genres) only ever saved *which* books
// to show — the actual cover images still had to hit covers.openlibrary.org
// over the network every single time, which is most of what "slow to load"
// actually was. This caches the decoded image itself (as a data URL) in
// IndexedDB, so a repeat view can paint the cover with zero network request
// at all. Non-destructive by design: every <img> still gets its normal live
// URL as `src` immediately, so nothing is slower than before if the cache
// misses or fails — this only ever swaps in something faster when it hits.
export const COVER_CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days
export const COVER_DB_PREFIX = 'ole_cover_v1_';
export const COVER_404_DB_PREFIX = 'ole_cover_404_';
export const coverFetchInFlight = new Set();
export const coverMemoryCache = new Map();
export const cover404MemoryCache = new Map(); // coverId -> { ts, reason: '404' | 'empty_placeholder' }
// Data URLs run ~133KB each (base64 of a ~100KB cover), so an unbounded
// in-memory map would quietly eat tens of MB over a long session (library +
// every trending/search cover ever painted). Keep only the most recent ones
// in RAM — IndexedDB still holds the rest, and re-hydration is cheap.
export const COVER_MEMORY_CACHE_MAX = 300;
// hydrateCachedCovers can hand us a whole grid of uncached covers at once
// (24 on the trending dashboard). Firing every fetch simultaneously is a
// needless burst against covers.openlibrary.org; run them a few at a time.
export const COVER_FETCH_MAX_CONCURRENT = 6;
export let coverFetchActive = 0;
export const coverFetchQueue = [];

/**
 * Unified Cover ID and URL Normalizer
 */
export const normalizeCoverId = (coverId) => {
    if (!coverId) return '';
    return String(coverId).replace(/^\/books\//, '').trim();
};

/**
 * Unified Cover URL Resolver
 * Routes through the Cloudflare Worker proxy (/covers/...) when customProxyUrl is active,
 * and falls back cleanly to covers.openlibrary.org in non-proxy mode.
 */
export const getCoverUrl = (coverId, size = 'M', defaultFalse = false) => {
    if (!coverId) return null;
    const cleanId = normalizeCoverId(coverId);
    if (!cleanId) return null;
    const isOlid = cleanId.startsWith('OL') || cleanId.endsWith('M');
    const path = isOlid ? `b/olid/${cleanId}-${size}.jpg` : `b/id/${cleanId}-${size}.jpg`;
    const query = defaultFalse ? '?default=false' : '';
    const proxy = activeStorageProxyUrl || safeStorage.getItem('ole_custom_proxy_url');
    if (proxy) {
        return `${proxy.replace(/\/+$/, '')}/covers/${path}${query}`;
    }
    return `https://covers.openlibrary.org/${path}${query}`;
};

export const rememberCoverInMemory = (coverId, dataUrl) => {
    const cleanId = normalizeCoverId(coverId);
    if (!cleanId || !dataUrl) return;
    coverMemoryCache.set(cleanId, dataUrl);
    if (coverMemoryCache.size > COVER_MEMORY_CACHE_MAX) {
        const oldest = coverMemoryCache.keys().next().value;
        coverMemoryCache.delete(oldest);
    }
};

export const getCoverFromMemory = (coverId) => {
    const cleanId = normalizeCoverId(coverId);
    if (!cleanId) return null;
    return coverMemoryCache.get(cleanId) || null;
};

export const hasCoverInMemory = (coverId) => {
    const cleanId = normalizeCoverId(coverId);
    if (!cleanId) return false;
    return coverMemoryCache.has(cleanId);
};

export const COVER_404_MEMORY_CACHE_MAX = 500;

export const rememberCoverNegative = (coverId, reason = '404') => {
    const cleanId = normalizeCoverId(coverId);
    if (!cleanId) return;
    const record = { ts: Date.now(), reason };
    cover404MemoryCache.set(cleanId, record);
    if (cover404MemoryCache.size > COVER_404_MEMORY_CACHE_MAX) {
        const oldest = cover404MemoryCache.keys().next().value;
        cover404MemoryCache.delete(oldest);
    }
    if (!coverIdbSuspect) {
        localforage.setItem(`${COVER_404_DB_PREFIX}${cleanId}`, JSON.stringify(record)).catch(() => { });
    }
};

export const getNegativeCachedCover = async (coverId) => {
    const cleanId = normalizeCoverId(coverId);
    if (!cleanId) return null;
    if (cover404MemoryCache.has(cleanId)) {
        const memRecord = cover404MemoryCache.get(cleanId);
        if (memRecord && memRecord.ts && (Date.now() - memRecord.ts > COVER_CACHE_TTL)) {
            cover404MemoryCache.delete(cleanId);
        } else {
            return memRecord;
        }
    }
    if (coverIdbSuspect) return null;
    try {
        const raw = await Promise.race([
            localforage.getItem(`${COVER_404_DB_PREFIX}${cleanId}`).catch(() => null),
            new Promise(resolve => setTimeout(() => { resolve(null); }, 1200))
        ]);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || (parsed.ts && Date.now() - parsed.ts > COVER_CACHE_TTL)) return null;
        cover404MemoryCache.set(cleanId, parsed);
        if (cover404MemoryCache.size > COVER_404_MEMORY_CACHE_MAX) {
            const oldest = cover404MemoryCache.keys().next().value;
            cover404MemoryCache.delete(oldest);
        }
        return parsed;
    } catch {
        return null;
    }
};

export const getCachedCoverDataUrl = async (coverId) => {
    const cleanId = normalizeCoverId(coverId);
    if (!cleanId) return null;
    const inMem = getCoverFromMemory(cleanId);
    if (inMem) return inMem;
    try {
        const raw = await localforage.getItem(`${COVER_DB_PREFIX}${cleanId}`);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || Date.now() - parsed.ts > COVER_CACHE_TTL) return null;
        rememberCoverInMemory(cleanId, parsed.dataUrl);
        return parsed.dataUrl;
    } catch {
        return null;
    }
};

export const getWorkApiUrl = (key) => {
    if (!key) return '';
    if (key.startsWith('http')) return key.endsWith('.json') ? key : `${key}.json`;
    const cleanKey = key.startsWith('/') ? key : `/${key}`;
    if (!cleanKey.startsWith('/works/') && !cleanKey.startsWith('/books/')) {
        return `https://openlibrary.org/works${cleanKey}.json`;
    }
    return `https://openlibrary.org${cleanKey}.json`;
};

export const cacheCoverInBackground = (coverId) => {
    const cleanId = normalizeCoverId(coverId);
    if (!cleanId || coverFetchInFlight.has(cleanId)) return;
    if (cover404MemoryCache.has(cleanId) || hasCoverInMemory(cleanId)) return;
    coverFetchInFlight.add(cleanId);
    coverFetchQueue.push(cleanId);
    processCoverFetchQueue();
};

export const processCoverFetchQueue = () => {
    while (coverFetchActive < COVER_FETCH_MAX_CONCURRENT && coverFetchQueue.length > 0) {
        const coverId = coverFetchQueue.shift();
        const cleanId = normalizeCoverId(coverId);
        if (!cleanId || cover404MemoryCache.has(cleanId) || hasCoverInMemory(cleanId)) {
            coverFetchInFlight.delete(coverId);
            coverFetchInFlight.delete(cleanId);
            continue;
        }
        coverFetchActive++;
        const url = getCoverUrl(cleanId, 'M', false);
        fetch(url)
            .then(async (res) => {
                if (!res.ok) {
                    if (res.status === 404) {
                        telemetryHub?.recordError?.(404, url);
                        rememberCoverNegative(cleanId, '404');
                    }
                    throw new Error('Cover fetch failed');
                }
                const blob = await res.blob();
                if (blob.size < 100) {
                    // Open Library transparent placeholder rejection (1x1 dummy image defense)
                    rememberCoverNegative(cleanId, 'empty_placeholder');
                    throw new Error('Placeholder dummy image');
                }
                if (blob.size > 400 * 1024) return null;
                return new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result);
                    reader.onerror = () => reject(reader.error);
                    reader.readAsDataURL(blob);
                });
            })
            .then((dataUrl) => {
                if (!dataUrl) return;
                rememberCoverInMemory(cleanId, dataUrl);
                return localforage.setItem(`${COVER_DB_PREFIX}${cleanId}`, JSON.stringify({ ts: Date.now(), dataUrl }));
            })
            .catch(() => { /* best-effort only */ })
            .finally(() => {
                coverFetchInFlight.delete(coverId);
                coverFetchInFlight.delete(cleanId);
                coverFetchActive--;
                processCoverFetchQueue();
            });
    }
};

// ── Ordered sequential cover loading ─────────────────────────────────────
// Covers used to race in whatever order the network/cache resolved them.
// Now every rendered batch loads strictly in READING ORDER (left→right,
// top→bottom = DOM order): exactly ONE network cover in flight at a time,
// while memory/IndexedDB hits fill instantly without stealing the slot.
// A generation token cancels stale sequences the moment a newer batch is
// scheduled (searches, view switches, chunk renders).
export const fetchCoverDataUrl = async (coverId) => {
    if (!coverId) return null;
    const cleanId = String(coverId).replace(/^\/books\//, '');
    const isNeg = await getNegativeCachedCover(cleanId);
    if (isNeg) return null;

    const url = getCoverUrl(cleanId, 'M', false);
    if (!url) return null;

    return fetch(url)
        .then(async (res) => {
            if (!res.ok) {
                if (res.status === 404) {
                    telemetryHub?.recordError?.(404, url);
                    rememberCoverNegative(cleanId, '404');
                }
                throw new Error('Cover fetch failed');
            }
            return res.blob();
        })
        .then((blob) => new Promise((resolve, reject) => {
            // Guard: 1x1 transparent placeholders from Open Library are <= 43 bytes
            if (blob.size < 100) {
                rememberCoverNegative(cleanId, 'empty_placeholder');
                resolve(null);
                return;
            }
            if (blob.size > 400 * 1024) { resolve(null); return; }
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
        }))
        .then((dataUrl) => {
            if (dataUrl) {
                rememberCoverInMemory(cleanId, dataUrl);
                if (!coverIdbSuspect) localforage.setItem(`${COVER_DB_PREFIX}${cleanId}`, JSON.stringify({ ts: Date.now(), dataUrl })).catch(() => { });
            }
            return dataUrl;
        })
        .catch(() => null /* best-effort only */);
};

// Call after inserting a batch of pending cover <img class="cover-pending"
// data-cover-id="..."> elements. Cached covers swap in near-instantly; the
// rest load through a SLIDING WINDOW of parallel requests that always starts
// work in reading order (left→right, top→bottom). covers.openlibrary.org is
// a CDN and comfortably sustains the old system's 6 concurrent image fetches,
// while strictly serial loading was ~6× slower for no benefit.
export const COVER_SEQ_PARALLEL = 6;
export let coverSeqToken = 0;
// Set when an IndexedDB cover read stalls past its timeout (private windows
// and quota-pressure states can hang the driver): all further covers skip
// the cache check entirely and load straight from the network, so one hung
// storage backend can never freeze the whole sequence.
export let coverIdbSuspect = false;
export const loadOneCover = async (img) => {
    const rawCoverId = img.dataset.coverId;
    if (!rawCoverId || !img.isConnected) return;
    const cleanId = normalizeCoverId(rawCoverId);
    if (!cleanId) return;

    // Fast check RAM / Negative cache
    const neg = await getNegativeCachedCover(cleanId);
    if (neg) {
        img.onerror = null;
        img.outerHTML = '<div class=\'no-cover\'>No Cover</div>';
        return;
    }

    let dataUrl = getCoverFromMemory(cleanId);
    if (dataUrl) {
        telemetryHub?.recordCacheHit?.('ram', 'cover');
    } else if (!coverIdbSuspect) {
        // Race a short timeout: a stalled IndexedDB read must never freeze
        // the cover sequence. First timeout poisons the flag above.
        try {
            dataUrl = await Promise.race([
                getCachedCoverDataUrl(cleanId),
                new Promise(resolve => setTimeout(() => { coverIdbSuspect = true; resolve(null); }, 1200))
            ]);
            if (dataUrl) {
                telemetryHub?.recordCacheHit?.('idb', 'cover');
            }
        } catch { dataUrl = null; }
    }
    if (!dataUrl) dataUrl = await fetchCoverDataUrl(cleanId);
    if (!img.isConnected) return;
    if (dataUrl) {
        // Fade in on paint, not on src-set: a slow cover would otherwise
        // finish the animation before it decodes. Instant cached covers
        // resolve inside the card's own mount fade, so this melts in.
        img.onload = () => img.classList.add('cover-fresh');
        img.src = dataUrl;
        img.classList.remove('cover-pending');
    } else {
        img.onerror = null;
        img.outerHTML = '<div class=\'no-cover\'>No Cover</div>';
    }
};
export const hydrateCachedCovers = (container) => {
    if (!container) return;
    const token = ++coverSeqToken;
    const imgs = Array.from(container.querySelectorAll('img.cover-pending[data-cover-id]'));
    let cursor = 0;
    const worker = async () => {
        while (token === coverSeqToken) {
            const i = cursor++;
            if (i >= imgs.length) return;
            await loadOneCover(imgs[i]);
        }
    };
    for (let w = 0; w < COVER_SEQ_PARALLEL && w < imgs.length; w++) worker();
};

// Persistent Synopsis Cache (IndexedDB + RAM)
export const SYNOPSIS_DB_PREFIX = 'ole_desc_v1_';
export const SYNOPSIS_CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days

export const getCachedSynopsis = async (workKey) => {
    if (!workKey) return null;
    if (descriptionCache.has(workKey)) {
        const val = descriptionCache.get(workKey);
        if (val && val !== 'No synopsis available for this work.') return val;
    }
    try {
        const raw = await localforage.getItem(`${SYNOPSIS_DB_PREFIX}${workKey}`);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || Date.now() - parsed.ts > SYNOPSIS_CACHE_TTL) return null;
        if (parsed.desc && parsed.desc !== 'No synopsis available for this work.') {
            descriptionCache.set(workKey, parsed.desc);
            return parsed.desc;
        }
        return null;
    } catch {
        return null;
    }
};

export const cacheSynopsis = (workKey, desc) => {
    if (!workKey || !desc) return;
    descriptionCache.set(workKey, desc);
    localforage.setItem(`${SYNOPSIS_DB_PREFIX}${workKey}`, JSON.stringify({ ts: Date.now(), desc })).catch(() => { });
};

export const TITLE_CASE_LOWER = new Set([
    'and', 'or', 'nor', 'but', 'a', 'an', 'the', 'as', 'at', 'by',
    'for', 'in', 'of', 'on', 'per', 'to', 'up', 'via', 'with', 'vs', 'v',
    'from', 'into', 'onto', 'upon', 'about'
]);
export const ROMAN_NUMERALS = new Set(['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii']);

export const toCleanSubjectTitleCase = (subject) => {
    if (!subject || typeof subject !== 'string') return subject || '';
    const words = subject.split(/\s+/);
    return words.map((w, idx) => {
        if (w.includes('-')) {
            return w.split('-').map((subW, subIdx) => {
                const cleanSub = subW.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
                if (ROMAN_NUMERALS.has(cleanSub)) return subW.toUpperCase();
                if (idx > 0 && subIdx > 0 && TITLE_CASE_LOWER.has(cleanSub)) return subW.toLowerCase();
                if (subW.length === 0) return subW;
                return subW.charAt(0).toUpperCase() + subW.slice(1).toLowerCase();
            }).join('-');
        }
        const cleanWord = w.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '').toLowerCase();
        if (ROMAN_NUMERALS.has(cleanWord)) return w.toUpperCase();
        if (idx > 0 && TITLE_CASE_LOWER.has(cleanWord)) {
            const match = w.match(/^([^a-zA-Z0-9]*)(.*?)([^a-zA-Z0-9]*)$/);
            if (match) return match[1] + match[2].toLowerCase() + match[3];
            return w.toLowerCase();
        }
        const match = w.match(/^([^a-zA-Z0-9]*)(.*?)([^a-zA-Z0-9]*)$/);
        if (match && match[2].length > 0) {
            const capped = match[2].charAt(0).toUpperCase() + match[2].slice(1).toLowerCase();
            return match[1] + capped + match[3];
        }
        return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    }).join(' ');
};

export const isCleanLibrarySubjectsEnabled = () => safeStorage.getItem('ole_clean_library_subjects') !== 'false';

export const isSynopsisCleanupEnabled = () => safeStorage.getItem('ole_clean_synopsis') !== 'false';

export const cleanSynopsis = (rawDesc) => {
    if (!rawDesc || typeof rawDesc !== 'string') return '';
    if (rawDesc === 'No synopsis available for this work.') {
        return `<span style="opacity: 0.7; font-style: italic;">No synopsis available for this work.</span>`;
    }

    let text = rawDesc.trim();

    // 1. Strip Promotional / Spam Download Links & SEO spam tags
    // e.g. **A Court of Silver Flames pdf[ https://... ](...)**
    text = text.replace(/(?:\*{0,2})[^*\n]*?\b(?:pdf|epub|download|free ebook|ebook)\b[^*\n]*?\[\s*https?:\/\/[^\]]+\]\([^\)]+\)\s*(?:\*{0,2})/gi, '');

    const isSpamLink = (anchor, url) => {
        const a = (anchor || '').toLowerCase();
        const u = (url || '').toLowerCase();
        const spamWords = /\b(pdf|epub|ebook|download|free book|free download|read online|full book)\b/i;
        const spamDomains = /(chesserresources|oceanofpdf|z-lib|libgen|vk\.com|archive\.org\/details\/.*(?:pdf|epub)|\.pdf|\.epub|\/doc\/)/i;
        return spamWords.test(a) || spamDomains.test(u) || /^https?:\/\//i.test(a.trim()) || !a.trim();
    };

    // 2. Extract and resolve Markdown Reference-Style Links: [id]: https://url "optional title"
    const refMap = new Map();
    const refDefRegex = /^[ \t]*\[([^\]]+)\]:\s*<?(https?:\/\/[^\s>]+)>?(?:\s+["'(](.*?)["')])?[ \t]*$/gim;
    let match;
    while ((match = refDefRegex.exec(text)) !== null) {
        const id = match[1].trim().toLowerCase();
        const url = match[2].trim();
        const title = match[3] ? match[3].trim() : '';
        refMap.set(id, { url, title });
    }
    // Remove reference link definition lines
    text = text.replace(refDefRegex, '').trim();
    // Also remove any dangling reference lines (e.g. ^: https://...)
    text = text.replace(/^[ \t]*:\s*https?:\/\/\S+[ \t]*$/gim, '').trim();

    // Replace reference links: [anchor][id], [anchor][], or [id] where id exists in refMap
    text = text.replace(/\[([^\]]+)\](?:\[([^\]]*)\])?/g, (fullMatch, p1, p2) => {
        const targetId = (p2 !== undefined && p2 !== '' ? p2 : p1).trim().toLowerCase();
        if (refMap.has(targetId)) {
            const { url } = refMap.get(targetId);
            if (isSpamLink(p1, url)) return '';
            // If p1 is a pure digit citation [1] without anchor text, strip it
            if (/^\d+$/.test(p1.trim()) && (!p2 || p2 === '')) return '';
            return `<a href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer" class="synopsis-link">${escapeHTML(p1)}</a>`;
        }
        return fullMatch;
    });

    // 3. Comprehensive Inline Markdown Link Filter: [anchor](url)
    text = text.replace(/(?:\*{0,2})\[([^\]]*)\]\((https?:\/\/[^\)]+)\)(?:\*{0,2})/gi, (match, anchor, url) => {
        if (isSpamLink(anchor, url)) {
            return ''; // Strip spam link completely
        }
        return `<a href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer" class="synopsis-link">${escapeHTML(anchor)}</a>`;
    });

    // 4. Strip Wikipedia / Academic Citation Markers (e.g. [1], [citation needed], [note 2])
    text = text.replace(/\[\s*(?:\d+|citation needed|note \d+|when\?|who\?|source\?)\s*\]/gi, '');

    // 5. Extract Source Citations into Footer Attribution Badge
    let sourceAttribution = '';
    const sourceRegex = /(?:[-–—]\s*)?(?:\(|\[)?\s*(?:Source|From Wikipedia|From Goodreads|Wikipedia)\s*:\s*(?:\[([^\]]+)\]\((https?:\/\/[^\)]+)\)|<a\s+(?:[^>]*?\s+)?href="([^"]*)"[^>]*>(.*?)<\/a>|([^)\n\]]+))(?:\)|\])?/i;
    const sourceMatch = text.match(sourceRegex);
    if (sourceMatch) {
        const sourceName = (sourceMatch[1] || sourceMatch[4] || sourceMatch[5] || 'Source').trim();
        const sourceUrl = sourceMatch[2] || sourceMatch[3] || (sourceName.toLowerCase().includes('wikipedia') ? 'https://wikipedia.org' : null);

        sourceAttribution = sourceUrl
            ? `<div class="synopsis-source-badge">Source: <a href="${escapeHTML(sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHTML(sourceName)} ↗</a></div>`
            : `<div class="synopsis-source-badge">Source: ${escapeHTML(sourceName)}</div>`;

        text = text.replace(sourceMatch[0], '').trim();
    } else {
        const endWikiRegex = /(?:[-–—]\s*)?<a\s+href="([^"]*)"[^>]*>(Wikipedia|Goodreads)<\/a>\s*$/i;
        const endWikiMatch = text.match(endWikiRegex);
        if (endWikiMatch) {
            const sourceUrl = endWikiMatch[1];
            const sourceName = endWikiMatch[2];
            sourceAttribution = `<div class="synopsis-source-badge">Source: <a href="${escapeHTML(sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHTML(sourceName)} ↗</a></div>`;
            text = text.replace(endWikiRegex, '').trim();
        }
    }

    // 6. Handle Scene Breaks / Horizontal Decorative Dividers
    // e.g. *** or * * * or --- or ___
    text = text.replace(/^[ \t]*(?:\*\s*){3,}$/gm, '<hr class="synopsis-divider">');
    text = text.replace(/^[ \t]*(?:-\s*){3,}$/gm, '<hr class="synopsis-divider">');
    text = text.replace(/^[ \t]*(?:_\s*){3,}$/gm, '<hr class="synopsis-divider">');

    // 7. Safe HTML sanitization for pre-existing raw HTML
    text = text.replace(/<a\s+(?:[^>]*?\s+)?href="([^"]*)"[^>]*>(.*?)<\/a>/gi, (match, url, linkText) => {
        if (/^(javascript:|data:)/i.test(url)) return escapeHTML(linkText);
        if (isSpamLink(linkText, url)) return '';
        return `<a href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer" class="synopsis-link">${escapeHTML(linkText)}</a>`;
    });
    text = text.replace(/<\/?(?:div|span|font|style|script|iframe|object|embed)[^>]*>/gi, '');

    // 8. Markdown Typographic Formatting (CommonMark-compliant emphasis)
    // Bold + Italic: ***text*** or ___text___
    text = text.replace(/\*\*\*([\s\S]+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    text = text.replace(/___([\s\S]+?)___/g, '<strong><em>$1</em></strong>');

    // Bold: **text** (allowing single * inside for nested italics) or __text__
    text = text.replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/__([\s\S]+?)__/g, '<strong>$1</strong>');

    // Italic: *text* (word-boundary safe, handles *word*, *multiple words*, *decoration*)
    text = text.replace(/(?<!\*)\*([^*\n\s](?:[^*\n]*?[^*\n\s])?)\*(?!\*)/g, '<em>$1</em>');
    // Italic single character or standalone word: e.g. *x*
    text = text.replace(/(?<!\*)\*([^*\n\s])\*(?!\*)/g, '<em>$1</em>');
    // Italic underscore: _text_
    text = text.replace(/(?<![a-zA-Z0-9_])_([^_\n\s](?:[^_\n]*?[^_\n\s])?)_(?![a-zA-Z0-9_])/g, '<em>$1</em>');

    // Headings: # Heading -> <strong>Heading</strong>
    text = text.replace(/^#+\s*(.*?)$/gm, '<strong>$1</strong>');

    // 9. Cleanup Stray / Hanging Formatting Asterisks
    text = text.replace(/(?:^\s*\*{1,2}|\*{1,2}\s*$)/gm, '');

    // 10. Semantic Paragraphs & Line Breaks
    const paragraphs = text
        .split(/\r?\n\s*\r?\n/)
        .map(p => p.trim())
        .filter(p => p.length > 0)
        .map(p => `<p class="synopsis-paragraph">${p.replace(/\r?\n/g, '<br>')}</p>`);

    return (paragraphs.join('') || `<p class="synopsis-paragraph">${escapeHTML(text)}</p>`) + sourceAttribution;
};
