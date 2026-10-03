// network-engine.js — adaptive fetch scheduler (fetchOpenLibrary), API
// cooldown state, telemetry hub, and proxy-bundle fetch. Scheduler tuning
// lets and setters live here, completely decoupled from main.js.
import { safeStorage } from './storage-cache.js';
import { DOM } from './dom.js';
import { API_CONTACT_EMAIL, getCleanProxyBase, normalizeCacheKey, renderErrorHTML, parseSafeInt } from './utils.js';

export let schedulerMode = safeStorage.getItem('ole_scheduler_mode') || 'optimized';
export let schedulerMinDelayMs = parseSafeInt(safeStorage.getItem('ole_sched_delay'), 334);
export let schedulerMaxConnections = parseSafeInt(safeStorage.getItem('ole_sched_max_conn'), 3);
export let schedulerBurstCapacity = parseSafeInt(safeStorage.getItem('ole_sched_burst'), 3);
export const DEFAULT_PROXY_URL = 'https://openlibrary-proxy.peter-ortenszky.workers.dev';
const savedProxy = safeStorage.getItem('ole_custom_proxy_url');
export let customProxyUrl = savedProxy !== null ? savedProxy : DEFAULT_PROXY_URL;

export const setSchedulerMode = (v) => { schedulerMode = v; };
export const setSchedulerMinDelayMs = (v) => { schedulerMinDelayMs = v; };
export const setSchedulerMaxConnections = (v) => { schedulerMaxConnections = v; };
export const setSchedulerBurstCapacity = (v) => { schedulerBurstCapacity = v; };
export const setCustomProxyUrl = (v) => { customProxyUrl = v; };

export let apiBlockResumeTime = parseInt(safeStorage.getItem('ole_api_block_resume_time') || '0');
export let isApiBlocked = Date.now() < apiBlockResumeTime;

// ── Telemetry & Workload Metrics Hub ──────────────────────────────────────
export const apiTelemetry = (() => {
    const startTimestamps = []; // Timestamps of request starts (sliding window)
    const latencies = [];       // Network RTT in ms
    const queueWaitTimes = [];  // { t, ms } samples; time-pruned so the HUD average tracks current conditions
    const highPriQueueWaitTimes = [];
    const edgeLatencies = [];   // Latencies for edge hits (~15ms)
    const originLatencies = []; // Latencies for origin requests (~350ms)
    const searchDurations = []; // Search duration history in seconds

    let savedTelemetry = null;
    try {
        const raw = safeStorage.getItem('ole_telemetry_stats');
        if (raw) savedTelemetry = JSON.parse(raw);
    } catch { }

    const stats = Object.assign({
        totalRequests: 0,
        originRequests: 0,
        pass1Requests: 0,
        pass2Requests: 0,
        searchRequests: 0,
        searchDocsReceived: 0,
        autocompleteRequests: 0,
        discoveryRequests: 0,
        workDetailRequests: 0,
        translatedWorksCount: 0,

        // Errors & Status Breakdown
        http429Count: 0,
        http403Count: 0,
        http404Count: 0,
        networkErrorCount: 0,

        // Tier Breakdown Hits
        ramCacheHits: 0,
        idbCacheHits: 0,
        edgeCacheHits: 0,

        // Content Breakdown Hits
        apiHits: 0,
        titleHits: 0,
        coverHits: 0,

        // Rates & Peak
        peak1sStartRate: 0,

        // Search Duration Benchmarks
        lastSearchTotalSec: 0,
        lastSearchQuerySec: 0,
        lastSearchProcSec: 0,
        lastSearchRenderSec: 0,
        minSearchDurationSec: 0,
        maxSearchDurationSec: 0
    }, savedTelemetry && savedTelemetry.stats ? savedTelemetry.stats : {});

    const recentErrors = savedTelemetry && Array.isArray(savedTelemetry.recentErrors) ? savedTelemetry.recentErrors : [];
    if (savedTelemetry && Array.isArray(savedTelemetry.searchDurations)) {
        searchDurations.push(...savedTelemetry.searchDurations.slice(-20));
    }

    let persistTimer = null;
    const persistStats = () => {
        if (persistTimer) clearTimeout(persistTimer);
        persistTimer = setTimeout(() => {
            try {
                safeStorage.setItem('ole_telemetry_stats', JSON.stringify({ 
                    stats, 
                    recentErrors, 
                    searchDurations: searchDurations.slice(-20) 
                }));
            } catch { }
        }, 200);
    };

    // Queue-wait samples carry timestamps so the HUD average reflects CURRENT
    // conditions: without time-pruning, a long translation backlog pins the
    // average at its peak forever (stale huge samples never age out).
    const QUEUE_WAIT_WINDOW_MS = 60000;
    const pruneOldTimestamps = (now = Date.now()) => {
        const cutoff = now - 10000; // Keep last 10s
        while (startTimestamps.length > 0 && startTimestamps[0] < cutoff) {
            startTimestamps.shift();
        }
        const waitCutoff = now - QUEUE_WAIT_WINDOW_MS;
        while (queueWaitTimes.length > 0 && queueWaitTimes[0].t < waitCutoff) {
            queueWaitTimes.shift();
        }
        while (highPriQueueWaitTimes.length > 0 && highPriQueueWaitTimes[0].t < waitCutoff) {
            highPriQueueWaitTimes.shift();
        }
    };

    return {
        recordRequestStart(isHighPriority, queueWaitMs) {
            const now = Date.now();
            startTimestamps.push(now);
            pruneOldTimestamps(now);
            stats.totalRequests++;
            persistStats();

            queueWaitTimes.push({ t: now, ms: queueWaitMs });
            if (queueWaitTimes.length > 100) queueWaitTimes.shift();

            if (isHighPriority) {
                highPriQueueWaitTimes.push({ t: now, ms: queueWaitMs });
                if (highPriQueueWaitTimes.length > 50) highPriQueueWaitTimes.shift();
            }

            const startsIn1s = startTimestamps.filter(t => t >= now - 1000).length;
            if (startsIn1s > stats.peak1sStartRate) {
                stats.peak1sStartRate = startsIn1s;
            }
        },

        recordRequestComplete(durationMs, status, passType, isAborted = false, errDetail = '', rawUrl = '', isEdgeHit = false) {
            if (isAborted) return;

            latencies.push(durationMs);
            if (latencies.length > 100) latencies.shift();

            if (isEdgeHit) {
                edgeLatencies.push(durationMs);
                if (edgeLatencies.length > 50) edgeLatencies.shift();
            } else if (status === 200) {
                originLatencies.push(durationMs);
                if (originLatencies.length > 50) originLatencies.shift();
            }

            let path = '';
            try {
                const u = new URL(rawUrl.startsWith('http') ? rawUrl : `https://openlibrary.org${rawUrl}`);
                path = u.pathname;
            } catch {
                path = rawUrl ? String(rawUrl).split('?')[0] : '';
            }

            const timeStr = new Date().toLocaleTimeString();
            if (status === 429) {
                stats.http429Count++;
                recentErrors.unshift(`[${timeStr}] HTTP 429: Rate Limit Exceeded`);
            } else if (status === 403) {
                stats.http403Count++;
                recentErrors.unshift(`[${timeStr}] HTTP 403: Forbidden / IP Block`);
            } else if (status === 404) {
                stats.http404Count++;
                recentErrors.unshift(`[${timeStr}] 404 Not Found (${path || 'Missing Resource'})`);
            } else if (status >= 400 || status === 0) {
                stats.networkErrorCount++;
                const detail = errDetail || (status === 0 ? 'Network / Offline / CORS Error' : `HTTP ${status} Server Error (${path})`);
                recentErrors.unshift(`[${timeStr}] ${detail}`);
            }
            if (recentErrors.length > 12) recentErrors.length = 12;

            if (passType === 'pass1') stats.pass1Requests++;
            else if (passType === 'pass2') stats.pass2Requests++;
            else if (passType === 'search') stats.searchRequests++;
            else if (passType === 'autocomplete') stats.autocompleteRequests++;
            else if (passType === 'discovery') stats.discoveryRequests++;
            else if (passType === 'work_detail') stats.workDetailRequests++;
            persistStats();
        },

        recordSearchDocs(count) {
            if (typeof count === 'number' && count > 0) {
                stats.searchDocsReceived += count;
                persistStats();
            }
        },

        recordOriginRequest() {
            stats.originRequests++;
            persistStats();
        },

        recordWorkTranslated() {
            stats.translatedWorksCount++;
            persistStats();
        },

        recordCacheHit(tierOrType, contentType) {
            let tier = tierOrType;
            let type = contentType;

            // Backward compatibility: infer tier and normalize types for 1-arg calls
            if (!type) {
                tier = 'ram';
                if (tierOrType === 'cover') type = 'cover';
                else if (tierOrType === 'translation' || tierOrType === 'title') type = 'title';
                else if (tierOrType === 'api') type = 'api';
            }

            // Storage Tiers: 'ram', 'idb', 'edge'
            if (tier === 'ram') stats.ramCacheHits++;
            else if (tier === 'idb') stats.idbCacheHits++;
            else if (tier === 'edge') stats.edgeCacheHits++;

            // Content Types: 'api', 'title', 'cover'
            if (type === 'api') stats.apiHits++;
            else if (type === 'title') stats.titleHits++;
            else if (type === 'cover') stats.coverHits++;

            persistStats();
        },

        recordSearchBenchmark(totalSec, querySec = 0, procSec = 0, renderSec = 0) {
            if (typeof totalSec === 'number' && totalSec > 0) {
                stats.lastSearchTotalSec = totalSec;
                stats.lastSearchQuerySec = querySec;
                stats.lastSearchProcSec = procSec;
                stats.lastSearchRenderSec = renderSec;

                searchDurations.push(totalSec);
                if (searchDurations.length > 30) searchDurations.shift();

                const valid = searchDurations.filter(d => d > 0);
                if (valid.length > 0) {
                    stats.minSearchDurationSec = Math.min(...valid);
                    stats.maxSearchDurationSec = Math.max(...valid);
                }
                persistStats();
            }
        },

        getSnapshot() {
            const now = Date.now();
            pruneOldTimestamps(now);

            const startsIn1s = startTimestamps.filter(t => t >= now - 1000).length;
            const startsIn5s = (startTimestamps.filter(t => t >= now - 5000).length / 5).toFixed(1);

            const avgRtt = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;
            const avgQueueWait = queueWaitTimes.length ? Math.round(queueWaitTimes.reduce((a, b) => a + b.ms, 0) / queueWaitTimes.length) : 0;
            const avgHighPriWait = highPriQueueWaitTimes.length ? Math.round(highPriQueueWaitTimes.reduce((a, b) => a + b.ms, 0) / highPriQueueWaitTimes.length) : 0;

            const avgEdgeLat = edgeLatencies.length ? Math.round(edgeLatencies.reduce((a, b) => a + b, 0) / edgeLatencies.length) : (stats.edgeCacheHits > 0 ? 16 : 0);
            const avgOriginLat = originLatencies.length ? Math.round(originLatencies.reduce((a, b) => a + b, 0) / originLatencies.length) : (stats.originRequests > 0 ? 340 : 0);

            const validDurations = searchDurations.filter(d => d > 0);
            const avgSearchDur = validDurations.length ? (validDurations.reduce((a, b) => a + b, 0) / validDurations.length).toFixed(2) : '—';
            const minSearchDur = stats.minSearchDurationSec > 0 ? stats.minSearchDurationSec.toFixed(2) : '—';
            const maxSearchDur = stats.maxSearchDurationSec > 0 ? stats.maxSearchDurationSec.toFixed(2) : '—';

            const totalEditionReqs = stats.pass1Requests + stats.pass2Requests;
            const reqsPerBook = stats.translatedWorksCount > 0 ? (totalEditionReqs / stats.translatedWorksCount).toFixed(2) : (totalEditionReqs > 0 ? '—' : '1.00');
            const pass1Pct = totalEditionReqs > 0 ? Math.round((stats.pass1Requests / totalEditionReqs) * 100) : 100;
            const pass2Pct = totalEditionReqs > 0 ? Math.round((stats.pass2Requests / totalEditionReqs) * 100) : 0;

            return {
                currentRate1s: startsIn1s,
                sustainedRate5s: parseFloat(startsIn5s),
                peakObservedRate: stats.peak1sStartRate,
                avgRttMs: avgRtt,
                avgQueueWaitMs: avgQueueWait,
                avgHighPriQueueWaitMs: avgHighPriWait,
                avgEdgeLatencyMs: avgEdgeLat,
                avgOriginLatencyMs: avgOriginLat,
                avgRamLatencyMs: 0.2,

                // Search timings
                lastSearchTotalSec: stats.lastSearchTotalSec,
                lastSearchQuerySec: stats.lastSearchQuerySec,
                lastSearchProcSec: stats.lastSearchProcSec,
                lastSearchRenderSec: stats.lastSearchRenderSec || 0,
                minSearchDurationSec: minSearchDur,
                avgSearchDurationSec: avgSearchDur,
                maxSearchDurationSec: maxSearchDur,

                // Counts
                pass1Count: stats.pass1Requests,
                pass2Count: stats.pass2Requests,
                pass1Pct,
                pass2Pct,
                searchCount: stats.searchRequests,
                searchDocs: stats.searchDocsReceived,
                autocompleteCount: stats.autocompleteRequests,
                discoveryCount: stats.discoveryRequests,
                detailCount: stats.workDetailRequests,
                reqsPerBook,
                translatedWorks: stats.translatedWorksCount,

                // Errors
                http429s: stats.http429Count,
                http403s: stats.http403Count,
                http404s: stats.http404Count,
                errors: stats.networkErrorCount,
                lastErrorSummary: recentErrors.length > 0 ? recentErrors.join('\n') : 'No errors logged',

                // Caches
                originRequests: stats.originRequests,
                ramCacheHits: stats.ramCacheHits,
                idbCacheHits: stats.idbCacheHits,
                edgeCacheHits: stats.edgeCacheHits,
                apiHits: stats.apiHits,
                titleHits: stats.titleHits,
                coverHits: stats.coverHits,
                totalRequests: stats.totalRequests
            };
        },

        reset() {
            startTimestamps.length = 0;
            latencies.length = 0;
            queueWaitTimes.length = 0;
            highPriQueueWaitTimes.length = 0;
            edgeLatencies.length = 0;
            originLatencies.length = 0;
            searchDurations.length = 0;
            recentErrors.length = 0;
            Object.keys(stats).forEach(k => stats[k] = 0);
            safeStorage.removeItem('ole_telemetry_stats');
        }
    };
})();

// Mathematically proven safety invariants for Optimized Mode:
const OPTIMIZED_MAX_STREAMS = 8;        // Max parallel HTTP/2 edge streams to Cloudflare
const OPTIMIZED_MAX_UNCONFIRMED = 3;    // Strictly <= 3 in-flight requests whose cache status is unconfirmed
const OPTIMIZED_ORIGIN_DELAY_MS = 334;  // Strict <= 3.0 req/s Open Library limit (1000ms / 3)

export const fetchOpenLibrary = (() => {
    const apiResponseCache = new Map();
    const API_CACHE_MAX = 50;
    const API_CACHE_TTL = 5 * 60 * 1000;

    let activeConnections = 0;
    let unconfirmedInFlight = 0;
    let lastOriginStartTime = 0;
    let originPacingActive = false;
    let lastRequestStartTime = 0;
    const queue = [];

    // Manual Token Bucket State (for Manual fixed benchmark mode).
    // NOTE: initialized to 0 here and snapshotted via initBurstTokens() by the
    // hub at startup — reading schedulerBurstCapacity at evaluation time would
    // TDZ (the hub evaluates last). Timing is identical to the original.
    let burstTokens = 0;
    let lastRefillTime = Date.now();
    let queueTimer = null;

    const refillTokens = () => {
        const now = Date.now();
        const interval = Math.max(25, schedulerMinDelayMs);
        const elapsed = now - lastRefillTime;
        const newTokens = Math.floor(elapsed / interval);
        if (newTokens > 0) {
            burstTokens = Math.min(schedulerBurstCapacity, burstTokens + newTokens);
            lastRefillTime += (newTokens * interval); // Preserve fractional remainder
        }
    };

    const processQueue = () => {
        const isOptimized = schedulerMode === 'optimized';
        const cleanProxy = getCleanProxyBase(customProxyUrl);
        const isProxy = !!cleanProxy;

        if (isOptimized) {
            // ── OPTIMIZED DUAL-LANE ENGINE ─────────────────────────────────
            // Invariant 1: Unconfirmed in-flight <= 3 always (Zero race condition on cold origin miss)
            // Invariant 2: Total open streams <= 8 (Proxy) or 3 (Direct)
            while (queue.length > 0) {
                // 1. Check if the head entry was aborted while waiting in queue
                const headEntry = queue[0];
                if (headEntry.options && headEntry.options.signal && headEntry.options.signal.aborted) {
                    const abortedEntry = queue.shift();
                    abortedEntry.reject(new DOMException('The operation was aborted.', 'AbortError'));
                    continue;
                }

                // 2. Check 429/403 cooldown state
                if (isApiBlocked) {
                    if (Date.now() < apiBlockResumeTime) {
                        const blockedEntry = queue.shift();
                        blockedEntry.reject(new Error("OpenLibrary API is in a cooldown period."));
                        continue;
                    } else {
                        isApiBlocked = false;
                        safeStorage.removeItem('ole_api_block_resume_time');
                        if (typeof DOM !== 'undefined' && DOM.status) DOM.status.style.display = 'none';
                    }
                }

                const maxStreams = isProxy ? OPTIMIZED_MAX_STREAMS : 3;
                const maxUnconfirmed = OPTIMIZED_MAX_UNCONFIRMED;

                if (activeConnections >= maxStreams || unconfirmedInFlight >= maxUnconfirmed) {
                    break; // Sockets or unconfirmed budget saturated
                }

                // Enforce 334ms start spacing strictly in direct mode, or after an origin miss in proxy mode
                if (!isProxy || originPacingActive) {
                    const now = Date.now();
                    const timeSinceLast = now - lastOriginStartTime;
                    if (timeSinceLast < OPTIMIZED_ORIGIN_DELAY_MS) {
                        if (!queueTimer) {
                            queueTimer = setTimeout(() => {
                                queueTimer = null;
                                processQueue();
                            }, OPTIMIZED_ORIGIN_DELAY_MS - timeSinceLast);
                        }
                        break;
                    }
                    lastOriginStartTime = Date.now();
                    originPacingActive = false;
                }

                activeConnections++;
                unconfirmedInFlight++;

                const entry = queue.shift();
                dispatchEntry(entry, isProxy);
            }
        } else {
            // ── MANUAL MODE (Fixed Slider Loop) ────────────────────────────
            refillTokens();
            while (queue.length > 0 && activeConnections < schedulerMaxConnections) {
                const headEntry = queue[0];
                if (headEntry.options && headEntry.options.signal && headEntry.options.signal.aborted) {
                    const abortedEntry = queue.shift();
                    abortedEntry.reject(new DOMException('The operation was aborted.', 'AbortError'));
                    continue;
                }

                if (isApiBlocked) {
                    if (Date.now() < apiBlockResumeTime) {
                        const blockedEntry = queue.shift();
                        blockedEntry.reject(new Error("OpenLibrary API is in a cooldown period."));
                        continue;
                    } else {
                        isApiBlocked = false;
                        safeStorage.removeItem('ole_api_block_resume_time');
                        if (typeof DOM !== 'undefined' && DOM.status) DOM.status.style.display = 'none';
                    }
                }

                const now = Date.now();
                const hasBurstCredit = schedulerBurstCapacity > 0 && burstTokens > 0;

                if (!hasBurstCredit) {
                    const timeSinceLastStart = now - lastRequestStartTime;
                    if (timeSinceLastStart < schedulerMinDelayMs) {
                        if (!queueTimer) {
                            queueTimer = setTimeout(() => {
                                queueTimer = null;
                                processQueue();
                            }, schedulerMinDelayMs - timeSinceLastStart);
                        }
                        break;
                    }
                }

                if (hasBurstCredit) burstTokens--;
                lastRequestStartTime = Date.now();
                activeConnections++;

                const entry = queue.shift();
                dispatchEntry(entry, isProxy);
            }
        }
    };

    const dispatchEntry = (entry, isProxy) => {
        const queueWaitMs = Date.now() - entry.enqueuedAt;
        const isHighPri = entry.options && entry.options.priority === 'high';
        apiTelemetry.recordRequestStart(isHighPri, queueWaitMs);

        let finalUrl = entry.url;
        const cleanProxy = getCleanProxyBase(customProxyUrl);
        try {
            const base = 'https://openlibrary.org';
            const urlObj = new URL(finalUrl.startsWith('http') ? finalUrl : `${base}${finalUrl.startsWith('/') ? '' : '/'}${finalUrl}`);
            
            if (!urlObj.searchParams.has('contact') && API_CONTACT_EMAIL) {
                urlObj.searchParams.set('contact', API_CONTACT_EMAIL);
            }

            if (isProxy) {
                const proxyObj = new URL(cleanProxy);
                urlObj.protocol = proxyObj.protocol;
                urlObj.host = proxyObj.host;
                urlObj.port = proxyObj.port;
                if (proxyObj.pathname && proxyObj.pathname !== '/') {
                    const prefix = proxyObj.pathname.replace(/\/+$/, '');
                    const cleanPath = urlObj.pathname.replace(/^\/+/, '');
                    urlObj.pathname = `${prefix}/${cleanPath}`;
                }
            }
            finalUrl = urlObj.toString();
        } catch (e) { }

        const cacheKey = normalizeCacheKey(entry.url);
        const reqStartTime = Date.now();
        const isGet = !entry.options.method || entry.options.method.toUpperCase() === 'GET';
        let isRecorded = false;
        let unconfirmedReleased = false;
        const releaseUnconfirmed = () => {
            if (!unconfirmedReleased) {
                unconfirmedReleased = true;
                if (unconfirmedInFlight > 0) unconfirmedInFlight--;
            }
        };

        const timeoutController = new AbortController();
        const timeoutMs = (entry.options && entry.options.timeoutMs) || 30000;
        const fetchTimer = setTimeout(() => {
            try { timeoutController.abort(new Error('Request Timeout (30s)')); } catch { }
        }, timeoutMs);

        const fetchOptions = { ...entry.options };
        if (entry.options && entry.options.signal) {
            if (entry.options.signal.aborted) {
                clearTimeout(fetchTimer);
                timeoutController.abort();
            } else {
                entry.options.signal.addEventListener('abort', () => {
                    clearTimeout(fetchTimer);
                    try { timeoutController.abort(); } catch { }
                }, { once: true });
            }
        }
        fetchOptions.signal = timeoutController.signal;

        fetch(finalUrl, fetchOptions)
            .then(async res => {
                clearTimeout(fetchTimer);
                isRecorded = true;
                const durationMs = Date.now() - reqStartTime;

                // Track Cloudflare Edge Cache Hit vs Open Library Origin
                let isEdgeHit = false;
                if (isProxy) {
                    const cc = (res.headers.get('cache-control') || '').toLowerCase();
                    const cfCache = (res.headers.get('cf-cache-status') || '').toUpperCase();
                    const xEdgeCache = (res.headers.get('x-edge-cache-status') || '').toUpperCase();
                    const ageVal = parseInt(res.headers.get('age') || '0', 10);
                    isEdgeHit = cc.includes('edge-hit') ||
                                cfCache.includes('HIT') ||
                                cfCache.includes('STALE') ||
                                cfCache.includes('REVALIDATED') ||
                                xEdgeCache.includes('HIT') ||
                                ageVal > 0 ||
                                (durationMs < 90 && res.status === 200);

                    if (isEdgeHit) {
                        apiTelemetry.recordCacheHit('edge', 'api');
                    } else {
                        apiTelemetry.recordOriginRequest();
                    }
                } else {
                    apiTelemetry.recordOriginRequest();
                }

                apiTelemetry.recordRequestComplete(durationMs, res.status, entry.options.passType, false, '', entry.url, isEdgeHit);

                // Decrement unconfirmed in-flight now that headers are read!
                releaseUnconfirmed();

                if (!isEdgeHit) {
                    lastOriginStartTime = Date.now();
                    originPacingActive = true;
                }

                if (res.status === 429 || res.status === 403) {
                    if (!isApiBlocked) {
                        isApiBlocked = true;
                        apiBlockResumeTime = Date.now() + (5 * 60 * 1000);
                        safeStorage.setItem('ole_api_block_resume_time', apiBlockResumeTime.toString());
                        if (typeof DOM !== 'undefined' && DOM.status) {
                            DOM.status.innerHTML = renderErrorHTML(
                                "API Cooldown Active",
                                res.status === 429
                                    ? "OpenLibrary rate limit triggered (HTTP 429). Please wait 5 minutes before trying again."
                                    : "OpenLibrary access blocked (HTTP 403). Please wait 5 minutes before trying again."
                            );
                            DOM.status.style.display = 'block';
                        }
                    }
                    throw new Error(`API Blocked: HTTP ${res.status}`);
                }

                // Automatic transient retry for Cloudflare/OpenLibrary gateway timeouts and outages (500/502/503/504/520-525)
                if ([500, 502, 503, 504, 520, 521, 522, 523, 524, 525].includes(res.status)) {
                    const retryCount = (entry.options && entry.options.retryCount) || 0;
                    if (retryCount < 2 && isGet && (!entry.options.signal || !entry.options.signal.aborted)) {
                        entry.options.retryCount = retryCount + 1;
                        console.warn(`[Network] Retrying transient gateway error (${res.status}) for ${entry.url} (Attempt ${retryCount + 1}/2)...`);
                        setTimeout(() => {
                            entry.enqueuedAt = Date.now();
                            queue.unshift(entry);
                            processQueue();
                        }, 1200);
                        return;
                    }
                }

                if (!res.ok) {
                    throw new Error(`HTTP Error ${res.status}: ${res.statusText || 'Request failed'}`);
                }

                const contentType = (res.headers.get("content-type") || '').toLowerCase();
                if (contentType && (contentType.includes("text/html") || contentType.includes("text/xml"))) {
                    throw new Error(`API Error: Unexpected ${contentType.split(';')[0]} received instead of JSON`);
                }

                if (isGet && res.ok) {
                    res.clone().text().then(text => {
                        try {
                            JSON.parse(text);
                            apiResponseCache.set(cacheKey, { text, time: Date.now() });
                            if (apiResponseCache.size > API_CACHE_MAX) {
                                const oldest = apiResponseCache.keys().next().value;
                                apiResponseCache.delete(oldest);
                            }
                        } catch { }
                    });
                }
                entry.resolve(res);
            })
            .catch(err => {
                clearTimeout(fetchTimer);
                releaseUnconfirmed();
                if (!isRecorded) {
                    const durationMs = Date.now() - reqStartTime;
                    const isAborted = !!(err && (err.name === 'AbortError' || (entry.options && entry.options.signal && entry.options.signal.aborted)));
                    apiTelemetry.recordRequestComplete(durationMs, 0, entry.options.passType, isAborted, err ? err.message : 'Network / Fetch Failed', entry.url, false);
                }
                entry.reject(err);
            })
            .finally(() => {
                clearTimeout(fetchTimer);
                releaseUnconfirmed();
                activeConnections--;
                processQueue();
            });
    };

    const queuedFetch = (url, options = {}) => {
        // 1. Cache-Before-Cooldown check: cached entries resolve in 0ms without hitting cooldown block
        const cacheKey = normalizeCacheKey(url);
        const isGet = !options.method || options.method.toUpperCase() === 'GET';
        if (isGet && apiResponseCache.has(cacheKey)) {
            const cached = apiResponseCache.get(cacheKey);
            if (Date.now() - cached.time < API_CACHE_TTL) {
                apiTelemetry.recordCacheHit('ram', 'api');
                return Promise.resolve(new Response(cached.text, {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                }));
            }
            apiResponseCache.delete(cacheKey);
        }

        // 2. Cooldown check for uncached network requests
        const resumeTime = parseInt(safeStorage.getItem('ole_api_block_resume_time') || '0', 10);
        if (Date.now() < resumeTime) {
            isApiBlocked = true;
            apiBlockResumeTime = resumeTime;
            return Promise.reject(new Error("OpenLibrary API is in a cooldown period."));
        }

        return new Promise((resolve, reject) => {
            const entry = { url, options, resolve, reject, enqueuedAt: Date.now() };
            if (options && options.priority === 'high') {
                queue.unshift(entry);
            } else {
                queue.push(entry);
            }
            processQueue();
        });
    };

    queuedFetch.isQueueIdle = () => queue.length === 0 && activeConnections === 0;
    queuedFetch.triggerPacingUpdate = () => {
        if (queueTimer) {
            clearTimeout(queueTimer);
            queueTimer = null;
        }
        processQueue();
    };
    queuedFetch.clampBurstTokens = () => {
        burstTokens = Math.min(burstTokens, schedulerBurstCapacity);
    };
    queuedFetch.resetBurstTokens = () => {
        burstTokens = schedulerBurstCapacity;
        lastRefillTime = Date.now();
    };
    // Startup snapshot (called once by the hub after scheduler lets exist —
    // see below). Separated from resetBurstTokens for intent clarity.
    queuedFetch.initBurstTokens = () => { burstTokens = schedulerBurstCapacity; };
    queuedFetch.getQueueLength = () => queue.length;
    queuedFetch.getActiveConnections = () => activeConnections;

    return queuedFetch;
})();

export const fetchDiscoverBundleFromProxy = async () => {
    if (!customProxyUrl) return null;
    const bundleUrl = `${customProxyUrl.replace(/\/+$/, '')}/api/discover-bundle`;
    try {
        const res = await fetch(bundleUrl);
        if (!res.ok) return null;
        const data = await res.json();
        if (data && Array.isArray(data.trending) && data.trending.length > 0 && data.genres && typeof data.genres === 'object') {
            return data;
        }
    } catch (e) {
        console.warn('Failed to fetch bundle from proxy:', e);
    }
    return null;
};
