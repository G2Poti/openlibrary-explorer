// storage-cache.js — persistence + in-RAM caches (safeStorage, translation,
// library membership, cover/synopsis caches). Hub-owned tuning lets are
// imported read-only; all such uses are deferred (inside function bodies),
// so the interim hub↔storage cycle is evaluation-safe.
import localforage from 'localforage';
import { escapeHTML } from './utils.js';

export const coverStore = typeof localforage.createInstance === 'function'
    ? localforage.createInstance({ name: 'openlibrary_explorer', storeName: 'covers' })
    : localforage;

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
export const setTranslationCache = (cacheKey, title, coverId = null, editionKey = null, isNegative = false) => {
    if (typeof title !== 'string') return;
    const prevTitle = translationCache.get(cacheKey);
    // LRU Refresh: delete and set moves entry to the tail (newest)
    if (translationCache.has(cacheKey)) translationCache.delete(cacheKey);
    translationCache.set(cacheKey, title);
    translationCacheDirty = true;

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
        const langIndex = translationReverseIndex.get(lang);
        if (langIndex && typeof prevTitle === 'string') {
            const prevNorm = prevTitle.trim().toLowerCase();
            if (langIndex.get(prevNorm) === workKey) {
                langIndex.delete(prevNorm);
            }
        }
        if (!isNegative) {
            if (!translationReverseIndex.has(lang)) {
                translationReverseIndex.set(lang, new Map());
            }
            translationReverseIndex.get(lang).set(title.trim().toLowerCase(), workKey);
        }
    }
};
export const deleteTranslationCache = (cacheKey) => {
    if (translationCache.has(cacheKey)) {
        const title = translationCache.get(cacheKey);
        translationCache.delete(cacheKey);
        translationCoverCache.delete(cacheKey);
        translationCacheDirty = true;
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
let translationCacheDirty = false;
let isSavingTranslationCache = false;
let resaveTranslationCachePending = false;
export const saveTranslationCache = (immediate = false) => {
    if (!translationCacheDirty && !immediate) return;
    if (saveTranslationCacheTimer) {
        clearTimeout(saveTranslationCacheTimer);
        saveTranslationCacheTimer = null;
    }
    const doSave = async () => {
        if (!translationCacheDirty) return;
        if (isSavingTranslationCache) {
            resaveTranslationCachePending = true;
            return;
        }
        isSavingTranslationCache = true;
        translationCacheDirty = false;
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
            translationCacheDirty = true;
            console.error('Failed to save translation cache:', e);
        } finally {
            isSavingTranslationCache = false;
            if (resaveTranslationCachePending) {
                resaveTranslationCachePending = false;
                if (translationCacheDirty) doSave();
            }
        }
    };
    if (immediate) {
        return doSave();
    }
    saveTranslationCacheTimer = setTimeout(() => {
        saveTranslationCacheTimer = null;
        doSave();
    }, 2000);
};
if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden' && translationCacheDirty) saveTranslationCache(true);
    });
}
if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => {
        if (translationCacheDirty) saveTranslationCache(true);
    });
}
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

export const coverInFlightPromises = new Map();
export const knownCachedCoverIds = new Set();
export const knownNegCoverIds = new Set();
export let knownCoverIndexReady = false;
let coverIndexInitPromise = null;
export const initCoverIndex = () => {
    if (knownCoverIndexReady) return Promise.resolve();
    if (coverIndexInitPromise) return coverIndexInitPromise;
    if (typeof coverStore.keys !== 'function') {
        knownCoverIndexReady = true;
        return Promise.resolve();
    }
    coverIndexInitPromise = Promise.race([
        coverStore.keys().then(keys => {
            if (Array.isArray(keys)) {
                keys.forEach(k => {
                    if (typeof k !== 'string') return;
                    if (k.startsWith(COVER_DB_PREFIX)) knownCachedCoverIds.add(k.slice(COVER_DB_PREFIX.length));
                    else if (k.startsWith(COVER_404_DB_PREFIX)) knownNegCoverIds.add(k.slice(COVER_404_DB_PREFIX.length));
                });
            }
            knownCoverIndexReady = true;
        }).catch(() => { }),
        new Promise(resolve => setTimeout(resolve, 1200))
    ]);
    return coverIndexInitPromise;
};

export const rememberCoverNegative = (coverId, reason = '404') => {
    const cleanId = normalizeCoverId(coverId);
    if (!cleanId) return;
    const record = { ts: Date.now(), reason };
    cover404MemoryCache.set(cleanId, record);
    knownNegCoverIds.add(cleanId);
    if (cover404MemoryCache.size > COVER_404_MEMORY_CACHE_MAX) {
        const oldest = cover404MemoryCache.keys().next().value;
        cover404MemoryCache.delete(oldest);
    }
    if (!coverIdbSuspect) {
        coverStore.setItem(`${COVER_404_DB_PREFIX}${cleanId}`, JSON.stringify(record)).catch(() => { });
    }
};

export const raceCoverIdb = (promise, timeoutMs = 1200) => {
    let tid;
    return Promise.race([
        Promise.resolve(promise).catch(() => null),
        new Promise(resolve => {
            tid = setTimeout(() => {
                coverIdbSuspect = true;
                resolve(null);
            }, timeoutMs);
        })
    ]).finally(() => clearTimeout(tid));
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
    if (knownCoverIndexReady && !knownNegCoverIds.has(cleanId)) return null;
    try {
        const raw = await raceCoverIdb(coverStore.getItem(`${COVER_404_DB_PREFIX}${cleanId}`));
        if (!raw) return null;
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!parsed || (parsed.ts && Date.now() - parsed.ts > COVER_CACHE_TTL)) return null;
        cover404MemoryCache.set(cleanId, parsed);
        knownNegCoverIds.add(cleanId);
        if (cover404MemoryCache.size > COVER_404_MEMORY_CACHE_MAX) {
            const oldest = cover404MemoryCache.keys().next().value;
            cover404MemoryCache.delete(oldest);
        }
        return parsed;
    } catch {
        return null;
    }
};

const blobToObjectOrDataUrl = (blob) => {
    if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
        return URL.createObjectURL(blob);
    }
    return null;
};

export const getCachedCoverDataUrl = async (coverId) => {
    const cleanId = normalizeCoverId(coverId);
    if (!cleanId) return null;
    const inMem = getCoverFromMemory(cleanId);
    if (inMem) return inMem;
    if (coverIdbSuspect) return null;
    if (knownCoverIndexReady && !knownCachedCoverIds.has(cleanId)) return null;
    try {
        let raw = await coverStore.getItem(`${COVER_DB_PREFIX}${cleanId}`);
        if (!raw && coverStore !== localforage) {
            raw = await localforage.getItem(`${COVER_DB_PREFIX}${cleanId}`).catch(() => null);
        }
        if (!raw) return null;
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!parsed || Date.now() - parsed.ts > COVER_CACHE_TTL) return null;
        let resolvedUrl = null;
        if (typeof Blob !== 'undefined' && parsed.blob instanceof Blob) {
            resolvedUrl = blobToObjectOrDataUrl(parsed.blob);
        } else if (parsed.dataUrl) {
            resolvedUrl = parsed.dataUrl;
        }
        if (!resolvedUrl) return null;
        rememberCoverInMemory(cleanId, resolvedUrl);
        knownCachedCoverIds.add(cleanId);
        return resolvedUrl;
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

export const clearCoverStore = async () => {
    coverMemoryCache.forEach(val => {
        if (typeof val === 'string' && val.startsWith('blob:')) {
            try { URL.revokeObjectURL(val); } catch { }
        }
    });
    coverMemoryCache.clear();
    cover404MemoryCache.clear();
    knownCachedCoverIds.clear();
    knownNegCoverIds.clear();
    coverFetchInFlight.clear();
    coverInFlightPromises.clear();
    try {
        if (typeof coverStore.clear === 'function') {
            await coverStore.clear();
        }
    } catch { }
    try {
        if (typeof localforage.keys === 'function') {
            const allKeys = await localforage.keys();
            for (const k of allKeys) {
                if (k.startsWith(COVER_DB_PREFIX) || k.startsWith(COVER_404_DB_PREFIX)) {
                    await localforage.removeItem(k).catch(() => {});
                }
            }
        }
    } catch { }
};

export const cacheCoverInBackground = (coverId) => {
    const cleanId = normalizeCoverId(coverId);
    if (!cleanId || coverFetchInFlight.has(cleanId) || coverInFlightPromises.has(cleanId)) return;
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
        fetchCoverDataUrl(cleanId)
            .catch(() => { /* best-effort only */ })
            .finally(() => {
                coverFetchInFlight.delete(coverId);
                coverFetchInFlight.delete(cleanId);
                coverFetchActive--;
                processCoverFetchQueue();
            });
    }
};

// ── Ordered sequential & progressive cover loading ───────────────────────
const scheduleIdleTask = (fn) => {
    if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(fn, { timeout: 1500 });
    } else {
        setTimeout(fn, 100);
    }
};

const persistCoverBlobToCache = async (cleanId, blob, fallbackUrl = '') => {
    if (!blob || blob.size < 100) {
        rememberCoverNegative(cleanId, 'empty_placeholder');
        return null;
    }
    const objectUrl = blobToObjectOrDataUrl(blob);
    if (objectUrl) {
        rememberCoverInMemory(cleanId, objectUrl);
        // Persist Blobs <= 400 KB in dedicated IDB cover store (skips base64/JSON overhead)
        if (blob.size <= 400 * 1024 && !coverIdbSuspect) {
            knownCachedCoverIds.add(cleanId);
            coverStore.setItem(`${COVER_DB_PREFIX}${cleanId}`, { ts: Date.now(), blob }).catch(() => { });
        }
        return objectUrl;
    }
    if (blob.size > 400 * 1024) return fallbackUrl || null;
    const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
    if (dataUrl) {
        rememberCoverInMemory(cleanId, dataUrl);
        if (!coverIdbSuspect) {
            knownCachedCoverIds.add(cleanId);
            coverStore.setItem(`${COVER_DB_PREFIX}${cleanId}`, { ts: Date.now(), dataUrl }).catch(() => { });
        }
    }
    return dataUrl;
};

const archiveStreamedCoverFromCache = (cleanId, url) => {
    if (!cleanId || !url || hasCoverInMemory(cleanId) || cover404MemoryCache.has(cleanId) || coverInFlightPromises.has(cleanId)) {
        return;
    }
    const archivePromise = (async () => {
        try {
            // Matched CORS mode + force-cache reads the streamed response from
            // Chromium's HTTP disk cache without a second network request.
            const res = await fetch(url, { mode: 'cors', credentials: 'omit', cache: 'force-cache', priority: 'low' });
            if (!res.ok) return null;
            const blob = await res.blob();
            return await persistCoverBlobToCache(cleanId, blob, url);
        } catch {
            return null;
        }
    })();
    coverInFlightPromises.set(cleanId, archivePromise);
    archivePromise.finally(() => {
        if (coverInFlightPromises.get(cleanId) === archivePromise) {
            coverInFlightPromises.delete(cleanId);
        }
    });
    return archivePromise;
};

const coverArchiveQueue = [];
const queuedArchiveIds = new Set();
let coverArchiveActive = 0;

const flushCoverArchiveQueue = () => {
    // Only archive after active streamed batches finish so disk-cache reads
    // (or uncacheable misses) never contend with live cover rendering.
    if (coverHydrationActive > 0 || coverArchiveQueue.length === 0) return;
    while (coverArchiveActive < 2 && coverArchiveQueue.length > 0 && coverHydrationActive === 0) {
        const item = coverArchiveQueue.pop();
        queuedArchiveIds.delete(item.cleanId);
        if (hasCoverInMemory(item.cleanId) || cover404MemoryCache.has(item.cleanId)) continue;
        coverArchiveActive++;
        Promise.resolve(archiveStreamedCoverFromCache(item.cleanId, item.url))
            .catch(() => null)
            .finally(() => {
                coverArchiveActive--;
                if (coverArchiveQueue.length > 0 && coverHydrationActive === 0) {
                    scheduleIdleTask(flushCoverArchiveQueue);
                }
            });
    }
};

const enqueueCoverArchive = (cleanId, url) => {
    if (!cleanId || !url || hasCoverInMemory(cleanId) || cover404MemoryCache.has(cleanId) || queuedArchiveIds.has(cleanId)) {
        return;
    }
    queuedArchiveIds.add(cleanId);
    coverArchiveQueue.push({ cleanId, url });
    if (coverHydrationActive === 0) {
        scheduleIdleTask(flushCoverArchiveQueue);
    }
};

export const fetchCoverDataUrl = async (coverId, skipNegativeCheck = false) => {
    if (!coverId) return null;
    const cleanId = normalizeCoverId(coverId);
    if (!cleanId) return null;

    const inMem = getCoverFromMemory(cleanId);
    if (inMem) return inMem;

    if (coverInFlightPromises.has(cleanId)) {
        return coverInFlightPromises.get(cleanId);
    }

    const taskPromise = (async () => {
        if (!skipNegativeCheck) {
            const isNeg = await getNegativeCachedCover(cleanId);
            if (isNeg) return null;
        }

        if (!coverIdbSuspect) {
            const idbCached = await raceCoverIdb(getCachedCoverDataUrl(cleanId));
            if (idbCached) {
                telemetryHub?.recordCacheHit?.('idb', 'cover');
                return idbCached;
            }
        }

        const url = getCoverUrl(cleanId, 'M', false);
        if (!url) return null;

        try {
            const res = await fetch(url);
            if (!res.ok) {
                if (res.status === 404) {
                    telemetryHub?.recordError?.(404, url);
                    rememberCoverNegative(cleanId, '404');
                }
                throw new Error('Cover fetch failed');
            }
            const blob = await res.blob();
            return await persistCoverBlobToCache(cleanId, blob, url);
        } catch {
            return null;
        }
    })();

    coverInFlightPromises.set(cleanId, taskPromise);
    try {
        return await taskPromise;
    } finally {
        if (coverInFlightPromises.get(cleanId) === taskPromise) {
            coverInFlightPromises.delete(cleanId);
        }
    }
};

export const COVER_SEQ_PARALLEL = 16;
const getCoverConcurrency = () => {
    if (typeof navigator !== 'undefined' && navigator.connection && navigator.connection.saveData) return 6;
    if (typeof window !== 'undefined' && window.innerWidth <= 768) return 10;
    return COVER_SEQ_PARALLEL;
};
export let coverSeqToken = 0;
export let coverIdbSuspect = false;
const coverHydrationQueue = [];
let coverHydrationActive = 0;

export const resetCoverHydration = () => {
    coverSeqToken++;
    coverHydrationQueue.length = 0;
};

const replaceWithNoCover = (img) => {
    if (!img || !img.isConnected) return;
    img.onload = null;
    img.onerror = null;
    img.outerHTML = '<div class=\'no-cover\'>No Cover</div>';
};

const streamOneCover = async (img, cleanId) => {
    if (coverInFlightPromises.has(cleanId)) {
        const sharedUrl = await coverInFlightPromises.get(cleanId).catch(() => null);
        if (!img.isConnected) return;
        if (sharedUrl) {
            img.onload = () => img.classList.add('cover-fresh');
            img.alt = 'Cover Image';
            img.src = sharedUrl;
            img.classList.remove('cover-pending', 'cover-loading');
            return;
        }
    }

    const url = getCoverUrl(cleanId, 'M', false);
    if (!url) {
        replaceWithNoCover(img);
        return;
    }

    const streamed = await new Promise((resolve) => {
        let done = false;
        const finish = (ok) => {
            if (done) return;
            done = true;
            img.removeEventListener('load', onLoad);
            img.removeEventListener('error', onError);
            clearTimeout(safetyTimer);
            resolve(ok);
        };
        const onLoad = () => finish(true);
        const onError = () => finish(false);
        const safetyTimer = setTimeout(() => finish(false), 15000);
        img.addEventListener('load', onLoad, { once: true });
        img.addEventListener('error', onError, { once: true });
        img.crossOrigin = 'anonymous';
        img.alt = 'Cover Image';
        img.src = url;
    });

    if (streamed) {
        if (img.naturalWidth <= 1 && img.naturalHeight <= 1) {
            rememberCoverNegative(cleanId, 'empty_placeholder');
            replaceWithNoCover(img);
            return;
        }
        img.classList.remove('cover-pending', 'cover-loading');
        enqueueCoverArchive(cleanId, url);
        return;
    }

    // Fallback: inspect HTTP status via fetch() so 404 negative caching still works
    img.removeAttribute('crossorigin');
    const recoveredUrl = await fetchCoverDataUrl(cleanId, true);
    if (!img.isConnected) return;
    if (recoveredUrl) {
        img.onload = () => img.classList.add('cover-fresh');
        img.alt = 'Cover Image';
        img.src = recoveredUrl;
        img.classList.remove('cover-pending', 'cover-loading');
    } else {
        replaceWithNoCover(img);
    }
};

export const loadOneCover = async (img) => {
    const rawCoverId = img.dataset.coverId;
    if (!rawCoverId || !img.isConnected) return;
    const cleanId = normalizeCoverId(rawCoverId);
    if (!cleanId) return;

    // Fast RAM check first (zero IDB round-trip on memory hit)
    let dataUrl = getCoverFromMemory(cleanId);
    if (dataUrl) {
        telemetryHub?.recordCacheHit?.('ram', 'cover');
    } else {
        // Negative cache check before IDB positive lookup or network stream
        const neg = await getNegativeCachedCover(cleanId);
        if (!img.isConnected) return;
        if (neg) {
            replaceWithNoCover(img);
            return;
        }

        if (!coverIdbSuspect) {
            try {
                dataUrl = await raceCoverIdb(getCachedCoverDataUrl(cleanId));
                if (dataUrl) {
                    telemetryHub?.recordCacheHit?.('idb', 'cover');
                }
            } catch { dataUrl = null; }
        }
    }
    if (!img.isConnected) return;
    if (dataUrl) {
        img.onload = () => img.classList.add('cover-fresh');
        img.alt = 'Cover Image';
        img.src = dataUrl;
        img.classList.remove('cover-pending', 'cover-loading');
        return;
    }

    // Cache miss: stream progressively straight into <img>, then idle-archive from cache
    await streamOneCover(img, cleanId);
};
export const hydrateCachedCovers = (container, targetImgs = null) => {
    if (!container) return;
    const imgs = Array.isArray(targetImgs)
        ? targetImgs.filter(img => img && img.isConnected && img.classList.contains('cover-pending') && img.dataset.coverId)
        : Array.from(container.querySelectorAll('img.cover-pending[data-cover-id]'));
    if (imgs.length === 0) return;
    // Mark as loading synchronously before enqueuing so subsequent chunk appends never re-pick them
    imgs.forEach(img => {
        img.classList.remove('cover-pending');
        img.classList.add('cover-loading');
        coverHydrationQueue.push(img);
    });
    const token = coverSeqToken;
    const maxParallel = getCoverConcurrency();
    const spawnWorker = () => {
        if (coverHydrationActive >= maxParallel || coverHydrationQueue.length === 0) return;
        coverHydrationActive++;
        (async () => {
            try {
                while (token === coverSeqToken && coverHydrationQueue.length > 0) {
                    const img = coverHydrationQueue.shift();
                    if (!img || !img.isConnected) continue;
                    await loadOneCover(img);
                }
            } finally {
                coverHydrationActive--;
                if (token === coverSeqToken && coverHydrationQueue.length > 0) {
                    spawnWorker();
                } else if (coverHydrationActive === 0 && coverArchiveQueue.length > 0) {
                    scheduleIdleTask(flushCoverArchiveQueue);
                }
            }
        })();
    };
    while (coverHydrationActive < maxParallel && coverHydrationQueue.length > 0) {
        spawnWorker();
    }
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
        const raw = await Promise.race([
            localforage.getItem(`${SYNOPSIS_DB_PREFIX}${workKey}`).catch(() => null),
            new Promise(resolve => setTimeout(() => resolve(null), 1200))
        ]);
        if (!raw) return null;
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
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
    const tokens = [];
    const stashToken = (html) => {
        const idx = tokens.length;
        tokens.push(html);
        return `\u0000SYN_TOK_${idx}\u0000`;
    };
    const isSafeHttpUrl = (url) => /^https?:\/\//i.test(String(url || '').trim());

    // 1. Strip Promotional / Spam Download Links & SEO spam tags
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
    text = text.replace(refDefRegex, '').trim();
    text = text.replace(/^[ \t]*:\s*https?:\/\/\S+[ \t]*$/gim, '').trim();

    // 3. Extract Source Citations into Footer Attribution Badge before general link tokenization
    let sourceAttribution = '';
    const sourceRegex = /(?:[-–—]\s*)?(?:\(|\[)?\s*(?:Source|From Wikipedia|From Goodreads|Wikipedia)\s*:\s*(?:\[([^\]]+)\]\((https?:\/\/[^\)]+)\)|<a\s+(?:[^>]*?\s+)?href=(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>|([^)\n\]]+))(?:\)|\])?/i;
    const sourceMatch = text.match(sourceRegex);
    if (sourceMatch) {
        const sourceName = (sourceMatch[1] || sourceMatch[5] || sourceMatch[6] || 'Source').replace(/<[^>]*>/g, '').trim() || 'Source';
        const rawUrl = sourceMatch[2] || sourceMatch[3] || sourceMatch[4] || '';
        const sourceUrl = isSafeHttpUrl(rawUrl)
            ? rawUrl.trim()
            : (sourceName.toLowerCase().includes('wikipedia') ? 'https://wikipedia.org' : null);

        sourceAttribution = sourceUrl
            ? `<div class="synopsis-source-badge">Source: <a href="${escapeHTML(sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHTML(sourceName)} ↗</a></div>`
            : `<div class="synopsis-source-badge">Source: ${escapeHTML(sourceName)}</div>`;

        text = text.replace(sourceMatch[0], '').trim();
    } else {
        const endWikiRegex = /(?:[-–—]\s*)?<a\s+(?:[^>]*?\s+)?href=(?:"([^"]*)"|'([^']*)')[^>]*>(Wikipedia|Goodreads)<\/a>\s*$/i;
        const endWikiMatch = text.match(endWikiRegex);
        if (endWikiMatch) {
            const rawUrl = endWikiMatch[1] || endWikiMatch[2] || '';
            const sourceName = endWikiMatch[3];
            sourceAttribution = isSafeHttpUrl(rawUrl)
                ? `<div class="synopsis-source-badge">Source: <a href="${escapeHTML(rawUrl.trim())}" target="_blank" rel="noopener noreferrer">${escapeHTML(sourceName)} ↗</a></div>`
                : `<div class="synopsis-source-badge">Source: ${escapeHTML(sourceName)}</div>`;
            text = text.replace(endWikiRegex, '').trim();
        }
    }

    // Replace reference links into safe stashed tokens
    text = text.replace(/\[([^\]]+)\](?:\[([^\]]*)\])?/g, (fullMatch, p1, p2) => {
        const targetId = (p2 !== undefined && p2 !== '' ? p2 : p1).trim().toLowerCase();
        if (refMap.has(targetId)) {
            const { url } = refMap.get(targetId);
            if (!isSafeHttpUrl(url) || isSpamLink(p1, url)) return '';
            if (/^\d+$/.test(p1.trim()) && (!p2 || p2 === '')) return '';
            return stashToken(`<a href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer" class="synopsis-link">${escapeHTML(p1)}</a>`);
        }
        return fullMatch;
    });

    // 4. Comprehensive Inline Markdown Link Filter: [anchor](url)
    text = text.replace(/(?:\*{0,2})\[([^\]]*)\]\((https?:\/\/[^\)]+)\)(?:\*{0,2})/gi, (m, anchor, url) => {
        if (!isSafeHttpUrl(url) || isSpamLink(anchor, url)) return '';
        return stashToken(`<a href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer" class="synopsis-link">${escapeHTML(anchor)}</a>`);
    });

    // 5. Strip Wikipedia / Academic Citation Markers (e.g. [1], [citation needed], [note 2])
    text = text.replace(/\[\s*(?:\d+|citation needed|note \d+|when\?|who\?|source\?)\s*\]/gi, '');

    // 6. Tokenize pre-existing safe <a> tags (single- or double-quoted) and reject unsafe schemes
    text = text.replace(/<a\s+(?:[^>]*?\s+)?href=(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi, (m, dblUrl, sglUrl, linkText) => {
        const rawUrl = (dblUrl !== undefined ? dblUrl : sglUrl || '').trim();
        const plainText = String(linkText || '').replace(/<[^>]*>/g, '');
        if (!isSafeHttpUrl(rawUrl)) return plainText;
        if (isSpamLink(plainText, rawUrl)) return '';
        return stashToken(`<a href="${escapeHTML(rawUrl)}" target="_blank" rel="noopener noreferrer" class="synopsis-link">${escapeHTML(plainText)}</a>`);
    });

    // Strip harmless formatting wrappers and convert explicit <br> to newlines before escaping
    text = text.replace(/<br\s*\/?>/gi, '\n');
    text = text.replace(/<\/?(?:div|span|font|p)[^>]*>/gi, '');

    // 7. Handle Scene Breaks / Horizontal Decorative Dividers
    text = text.replace(/^[ \t]*(?:\*\s*){3,}$/gm, () => stashToken('<hr class="synopsis-divider">'));
    text = text.replace(/^[ \t]*(?:-\s*){3,}$/gm, () => stashToken('<hr class="synopsis-divider">'));
    text = text.replace(/^[ \t]*(?:_\s*){3,}$/gm, () => stashToken('<hr class="synopsis-divider">'));

    // 8. Escape ALL remaining raw HTML so no <img>, <svg>, <details>, <script>, etc. can execute
    text = escapeHTML(text);

    // 9. Markdown Typographic Formatting (on already-escaped text; '*' and '_' are preserved by escapeHTML)
    text = text.replace(/\*\*\*([\s\S]+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    text = text.replace(/___([\s\S]+?)___/g, '<strong><em>$1</em></strong>');
    text = text.replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/__([\s\S]+?)__/g, '<strong>$1</strong>');
    text = text.replace(/(?<!\*)\*([^*\n\s](?:[^*\n]*?[^*\n\s])?)\*(?!\*)/g, '<em>$1</em>');
    text = text.replace(/(?<!\*)\*([^*\n\s])\*(?!\*)/g, '<em>$1</em>');
    text = text.replace(/(?<![a-zA-Z0-9_])_([^_\n\s](?:[^_\n]*?[^_\n\s])?)_(?![a-zA-Z0-9_])/g, '<em>$1</em>');
    text = text.replace(/^#+\s*(.*?)$/gm, '<strong>$1</strong>');

    // 10. Cleanup Stray / Hanging Formatting Asterisks
    text = text.replace(/(?:^\s*\*{1,2}|\*{1,2}\s*$)/gm, '');

    // 11. Semantic Paragraphs & Line Breaks, then restore stashed safe HTML tokens
    const restoreTokens = (str) => str.replace(/\u0000SYN_TOK_(\d+)\u0000/g, (_, i) => tokens[Number(i)] || '');
    const paragraphs = text
        .split(/\r?\n\s*\r?\n/)
        .map(p => p.trim())
        .filter(p => p.length > 0)
        .map(p => `<p class="synopsis-paragraph">${restoreTokens(p.replace(/\r?\n/g, '<br>'))}</p>`);

    return (paragraphs.join('') || `<p class="synopsis-paragraph">${restoreTokens(text)}</p>`) + sourceAttribution;
};
